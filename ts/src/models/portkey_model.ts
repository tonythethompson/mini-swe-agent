/** Portkey model.
 * Ported from src/minisweagent/models/portkey_model.py
 *
 * Uses the OpenAI SDK with Portkey's OpenAI-compatible endpoint. */
import { OpenAI } from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources.js";
import { type Message, type Action, type EnvOutput } from "../exceptions.js";
import { FormatError } from "../exceptions.js";
import { GLOBAL_MODEL_STATS } from "./global_stats.js";
import { BASH_TOOL, parseToolcallActions, formatToolcallObservationMessages } from "./utils/actions_toolcall.js";
import { reorderAnthropicThinkingBlocks } from "./utils/anthropic_utils.js";
import { setCacheControl } from "./utils/cache_control.js";
import { expandMultimodalContent } from "./utils/multimodal.js";
import { retryWithBackoff } from "./utils/retry.js";
import { logger } from "../utils/log.js";

const DEFAULT_OBSERVATION_TEMPLATE =
  "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
  "<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>";

export class PortkeyModel {
  config: Record<string, unknown> = {};
  private modelName = "";
  private modelKwargs: Record<string, unknown> = {};
  private setCacheControlMode: "default_end" | null = null;
  private costTracking = "default";
  private formatErrorTemplate = "{{ error }}";
  private observationTemplate = DEFAULT_OBSERVATION_TEMPLATE;
  private multimodalRegex = "";
  private provider = "";
  private client!: OpenAI;
  abortExceptions: (new (...args: any[]) => Error)[] = [Error];

  init(config: Record<string, unknown>): void {
    this.modelName = config.model_name as string;
    this.modelKwargs = (config.model_kwargs as Record<string, unknown>) ?? {};
    this.setCacheControlMode = (config.set_cache_control as "default_end" | null) ?? null;
    this.costTracking = (config.cost_tracking as string) ?? "default";
    this.formatErrorTemplate = (config.format_error_template as string) ?? "{{ error }}";
    this.observationTemplate = (config.observation_template as string) ?? DEFAULT_OBSERVATION_TEMPLATE;
    this.multimodalRegex = (config.multimodal_regex as string) ?? "";
    this.provider = (config.provider as string) ?? "";

    const apiKey = process.env.PORTKEY_API_KEY;
    if (!apiKey) {
      throw new Error("Portkey API key required. Set PORTKEY_API_KEY env var.");
    }
    const clientConfig: ConstructorParameters<typeof OpenAI>[0] = { apiKey, baseURL: "https://api.portkey.ai/v1" };
    const virtualKey = process.env.PORTKEY_VIRTUAL_KEY;
    if (virtualKey) {
      clientConfig.defaultHeaders = { "x-portkey-virtual-key": virtualKey };
    } else if (this.provider) {
      clientConfig.defaultHeaders = { "x-portkey-provider": this.provider };
    }
    this.client = new OpenAI(clientConfig);
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  private _prepareMessagesForApi(messages: Message[]): Record<string, unknown>[] {
    const prepared = messages.map((m) => {
      const { extra, ...rest } = m as Message & { extra?: unknown };
      return rest;
    });
    const reordered = reorderAnthropicThinkingBlocks(prepared as unknown as Record<string, unknown>[]);
    return setCacheControl(reordered, this.setCacheControlMode);
  }

  async query(messages: Message[], kwargs: Record<string, unknown> = {}): Promise<Message> {
    const apiMessages = this._prepareMessagesForApi(messages) as unknown as ChatCompletionMessageParam[];
    const response = await retryWithBackoff(
      () => this.client.chat.completions.create({
        model: this.modelName,
        messages: apiMessages,
        tools: [BASH_TOOL as unknown as ChatCompletionTool],
        ...this.modelKwargs,
        ...kwargs,
      }),
      { logger, abortExceptions: this.abortExceptions },
    );
    const cost = this._calculateCost(response);
    GLOBAL_MODEL_STATS.add(cost);
    let actions: Action[];
    try {
      actions = this._parseActions(response);
    } catch (e) {
      if (e instanceof FormatError) {
        (e.messages[0].extra ?? {}).cost = cost;
        (e.messages[0].extra ?? {}).response = response;
        throw e;
      }
      throw e;
    }
    const choice = response.choices[0];
    return {
      role: choice.message.role,
      content: choice.message.content,
      tool_calls: choice.message.tool_calls as Message["tool_calls"],
      extra: { actions, response, cost, timestamp: Date.now() / 1000 },
    };
  }

  private _calculateCost(response: ChatCompletion): number {
    if (!response.usage) return 0.0;
    return (response.usage.prompt_tokens * 0.15 + response.usage.completion_tokens * 0.6) / 1_000_000;
  }

  private _parseActions(response: ChatCompletion): Action[] {
    const toolCalls = response.choices[0].message.tool_calls as unknown as
      | { id: string; function: { name: string; arguments: string } }[]
      | null;
    return parseToolcallActions(toolCalls as unknown as Parameters<typeof parseToolcallActions>[0], {
      formatErrorTemplate: this.formatErrorTemplate,
      templateKwargs: { finish_reason: response.choices[0].finish_reason },
    });
  }

  formatMessage(kwargs: Record<string, unknown>): Message {
    return expandMultimodalContent(kwargs, this.multimodalRegex) as Message;
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
      observationTemplate: this.observationTemplate,
      templateVars,
      multimodalRegex: this.multimodalRegex,
    });
  }

  getTemplateVars(): Record<string, unknown> {
    return {
      model_name: this.modelName,
      model_kwargs: this.modelKwargs,
      set_cache_control: this.setCacheControlMode,
      cost_tracking: this.costTracking,
      format_error_template: this.formatErrorTemplate,
      observation_template: this.observationTemplate,
      multimodal_regex: this.multimodalRegex,
      provider: this.provider,
    };
  }

  serialize(): Record<string, unknown> {
    return { info: { config: { model: this.config, model_type: "PortkeyModel" } } };
  }
}


