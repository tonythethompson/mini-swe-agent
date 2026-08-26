/** OpenAI-compatible model (litellm equivalent).
 * Ported from src/minisweagent/models/litellm_model.py
 *
 * Uses the `openai` SDK to talk to any OpenAI-compatible endpoint.
 * Provider routing is done via model name prefix (e.g. "anthropic/...", "openrouter/...")
 * and base_url / api_key env vars. */
import { OpenAI } from "openai";
import type { Model } from "../model_types.js";
import { type Message, type Action, type EnvOutput } from "../exceptions.js";
import { FormatError } from "../exceptions.js";
import { GLOBAL_MODEL_STATS } from "./global_stats.js";
import { logger } from "../utils/log.js";
import { BASH_TOOL, parseToolcallActions, formatToolcallObservationMessages } from "./utils/actions_toolcall.js";
import { reorderAnthropicThinkingBlocks } from "./utils/anthropic_utils.js";
import { setCacheControl } from "./utils/cache_control.js";
import { expandMultimodalContent } from "./utils/multimodal.js";
import { retryWithBackoff } from "./utils/retry.js";

export interface LitellmModelConfig {
  model_name: string;
  model_kwargs?: Record<string, unknown>;
  set_cache_control?: "default_end" | null;
  cost_tracking?: "default" | "ignore_errors";
  format_error_template?: string;
  observation_template?: string;
  multimodal_regex?: string;
  api_base?: string;
  api_key?: string;
}

const DEFAULT_OBSERVATION_TEMPLATE =
  "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
  "<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>";

const DEFAULT_FORMAT_ERROR_TEMPLATE = "{{ error }}";

/** Resolve provider-specific base_url and api_key from the model name. */
function resolveProvider(modelName: string): { baseURL?: string; apiKey?: string } {
  const lower = modelName.toLowerCase();
  // Strip provider prefix for the actual API call
  if (lower.startsWith("openrouter/")) {
    return {
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    };
  }
  if (lower.startsWith("anthropic/")) {
    // OpenAI SDK can talk to Anthropic's OpenAI-compatible endpoint
    return {
      baseURL: "https://api.anthropic.com/v1/openai",
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  if (lower.startsWith("gemini/")) {
    return {
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKey: process.env.GEMINI_API_KEY,
    };
  }
  if (lower.startsWith("requesty/")) {
    return { baseURL: "https://api.requesty.ai/v1", apiKey: process.env.REQUESTY_API_KEY };
  }
  if (lower.startsWith("portkey/")) {
    return { baseURL: "https://api.portkey.ai/v1", apiKey: process.env.PORTKEY_API_KEY };
  }
  // Default: OpenAI
  return { apiKey: process.env.OPENAI_API_KEY };
}

/** Strip the provider prefix from the model name for the API call. */
function stripProvider(modelName: string): string {
  const idx = modelName.indexOf("/");
  if (idx === -1) return modelName;
  return modelName.slice(idx + 1);
}

export class LitellmModel implements Model {
  config: Record<string, unknown> = {};
  protected cfg!: LitellmModelConfig;
  protected client!: OpenAI;

  abortExceptions: (new (...args: any[]) => Error)[] = [Error]; // broad; specific ones checked in retry

  init(config: Record<string, unknown>): void {
    this.cfg = {
      model_name: config.model_name as string,
      model_kwargs: (config.model_kwargs as Record<string, unknown>) ?? {},
      set_cache_control: (config.set_cache_control as "default_end" | null) ?? null,
      cost_tracking: (config.cost_tracking as "default" | "ignore_errors") ?? "default",
      format_error_template: (config.format_error_template as string) ?? DEFAULT_FORMAT_ERROR_TEMPLATE,
      observation_template: (config.observation_template as string) ?? DEFAULT_OBSERVATION_TEMPLATE,
      multimodal_regex: (config.multimodal_regex as string) ?? "",
      api_base: config.api_base as string,
      api_key: config.api_key as string,
    };
    const provider = resolveProvider(this.cfg.model_name);
    this.client = new OpenAI({
      baseURL: this.cfg.api_base ?? provider.baseURL,
      apiKey: this.cfg.api_key ?? provider.apiKey,
    });
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  protected async _query(messages: Message[], kwargs: Record<string, unknown> = {}): Promise<OpenAI.ChatCompletion> {
    const apiModel = stripProvider(this.cfg.model_name);
    return this.client.chat.completions.create({
      model: apiModel,
      messages: messages as unknown as OpenAI.ChatCompletionMessageParam[],
      tools: [BASH_TOOL as unknown as OpenAI.ChatCompletionTool],
      ...this.cfg.model_kwargs,
      ...kwargs,
    });
  }

  protected _prepareMessagesForApi(messages: Message[]): Message[] {
    const prepared = messages.map((m) => {
      const { extra, ...rest } = m as Message & { extra?: unknown };
      return rest as Message;
    });
    const reordered = reorderAnthropicThinkingBlocks(prepared as unknown as Record<string, unknown>[]) as unknown as Message[];
    return setCacheControl(reordered as unknown as Record<string, unknown>[], this.cfg.set_cache_control ?? null) as unknown as Message[];
  }

  async query(messages: Message[], kwargs: Record<string, unknown> = {}): Promise<Message> {
    const response = await retryWithBackoff(
      () => this._query(this._prepareMessagesForApi(messages), kwargs),
      { logger, abortExceptions: this.abortExceptions },
    );
    const costOutput = this._calculateCost(response);
    GLOBAL_MODEL_STATS.add(costOutput.cost);
    let actions: Action[];
    try {
      actions = this._parseActions(response);
    } catch (e) {
      if (e instanceof FormatError) {
        (e.messages[0].extra ?? {}).cost = costOutput.cost;
        (e.messages[0].extra ?? {}).response = response;
        throw e;
      }
      throw e;
    }
    const choice = response.choices[0];
    const message: Message = {
      role: choice.message.role,
      content: choice.message.content,
      tool_calls: choice.message.tool_calls as unknown as Message["tool_calls"],
    };
    message.extra = {
      actions,
      response,
      ...costOutput,
      timestamp: Date.now() / 1000,
    };
    return message;
  }

  protected _calculateCost(response: OpenAI.ChatCompletion): { cost: number } {
    // LiteLLM has a cost calculator; we approximate from usage if available.
    // Without a cost registry, we report 0 and warn unless ignore_errors.
    try {
      const usage = response.usage;
      if (!usage) {
        if (this.cfg.cost_tracking !== "ignore_errors") {
          logger.warning(`No usage data for model ${this.cfg.model_name}, cost set to 0.`);
        }
        return { cost: 0.0 };
      }
      // Rough cost estimate: $0.15/1M input, $0.60/1M output (placeholder)
      const cost = (usage.prompt_tokens * 0.15 + usage.completion_tokens * 0.6) / 1_000_000;
      if (cost <= 0.0 && this.cfg.cost_tracking !== "ignore_errors") {
        logger.warning(`Cost must be > 0.0, got ${cost} for ${this.cfg.model_name}`);
      }
      return { cost };
    } catch (e) {
      if (this.cfg.cost_tracking !== "ignore_errors") {
        logger.critical(`Error calculating cost for model ${this.cfg.model_name}: ${e}`);
      }
      return { cost: 0.0 };
    }
  }

  protected _parseActions(response: OpenAI.ChatCompletion): Action[] {
    const toolCalls = response.choices[0].message.tool_calls as unknown as
      | { id: string; function: { name: string; arguments: string } }[]
      | null;
    return parseToolcallActions(toolCalls as unknown as Parameters<typeof parseToolcallActions>[0], {
      formatErrorTemplate: this.cfg.format_error_template!,
      templateKwargs: { finish_reason: response.choices[0].finish_reason },
    });
  }

  formatMessage(kwargs: Record<string, unknown>): Message {
    return expandMultimodalContent(kwargs, this.cfg.multimodal_regex!) as Message;
  }

  formatObservationMessages(
    message: Message,
    outputs: EnvOutput[],
    templateVars?: Record<string, unknown>,
  ): Message[] {
    const actions = (message.extra?.actions as Action[]) ?? [];
    return formatToolcallObservationMessages({
      actions,
      outputs,
      observationTemplate: this.cfg.observation_template!,
      templateVars,
      multimodalRegex: this.cfg.multimodal_regex,
    });
  }

  getTemplateVars(): Record<string, unknown> {
    return { ...this.cfg };
  }

  serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          model: this.cfg,
          model_type: "LitellmModel",
        },
      },
    };
  }
}


