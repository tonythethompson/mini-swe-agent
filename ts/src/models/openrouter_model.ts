/** OpenRouter model (raw HTTP).
 * Ported from src/minisweagent/models/openrouter_model.py
 *
 * Makes direct HTTP requests to the OpenRouter API. */
import { type Message, type Action, type EnvOutput, type ToolCall } from "../index.js";
import { FormatError } from "../exceptions.js";
import { GLOBAL_MODEL_STATS } from "./index.js";
import { BASH_TOOL, parseToolcallActions, formatToolcallObservationMessages } from "./utils/actions_toolcall.js";
import { reorderAnthropicThinkingBlocks } from "./utils/anthropic_utils.js";
import { setCacheControl } from "./utils/cache_control.js";
import { expandMultimodalContent } from "./utils/multimodal.js";
import { retryWithBackoff } from "./utils/retry.js";
import { logger } from "../utils/log.js";

export class OpenRouterAPIError extends Error {}
export class OpenRouterAuthenticationError extends Error {}
export class OpenRouterRateLimitError extends Error {}

interface OpenRouterConfig {
  model_name: string;
  model_kwargs?: Record<string, unknown>;
  set_cache_control?: "default_end" | null;
  cost_tracking?: "default" | "ignore_errors";
  format_error_template?: string;
  observation_template?: string;
  multimodal_regex?: string;
}

const DEFAULT_OBSERVATION_TEMPLATE =
  "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
  "<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>";

export class OpenRouterModel {
  config: Record<string, unknown> = {};
  protected cfg!: OpenRouterConfig;
  protected apiKey = "";
  protected apiUrl = "https://openrouter.ai/api/v1/chat/completions";
  abortExceptions: (new (...args: any[]) => Error)[] = [OpenRouterAuthenticationError, Error];

  init(config: Record<string, unknown>): void {
    this.cfg = {
      model_name: config.model_name as string,
      model_kwargs: (config.model_kwargs as Record<string, unknown>) ?? {},
      set_cache_control: (config.set_cache_control as "default_end" | null) ?? null,
      cost_tracking: (config.cost_tracking as "default" | "ignore_errors") ?? "default",
      format_error_template: (config.format_error_template as string) ?? "{{ error }}",
      observation_template: (config.observation_template as string) ?? DEFAULT_OBSERVATION_TEMPLATE,
      multimodal_regex: (config.multimodal_regex as string) ?? "",
    };
    this.apiKey = process.env.OPENROUTER_API_KEY ?? "";
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  private async _query(messages: Record<string, unknown>[], kwargs: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const payload = {
      model: this.cfg.model_name,
      messages,
      tools: [BASH_TOOL],
      usage: { include: true },
      ...this.cfg.model_kwargs,
      ...kwargs,
    };
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new OpenRouterAuthenticationError(
          "Authentication failed. Set OPENROUTER_API_KEY env var.",
        );
      } else if (response.status === 429) {
        throw new OpenRouterRateLimitError("Rate limit exceeded");
      }
      const text = await response.text();
      throw new OpenRouterAPIError(`HTTP ${response.status}: ${text}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
  }

  protected _prepareMessagesForApi(messages: Message[]): Record<string, unknown>[] {
    const prepared = messages.map((m) => {
      const { extra, ...rest } = m as Message & { extra?: unknown };
      return rest;
    });
    const reordered = reorderAnthropicThinkingBlocks(prepared as unknown as Record<string, unknown>[]);
    return setCacheControl(reordered, this.cfg.set_cache_control ?? null);
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
    const choices = response.choices as Record<string, unknown>[];
    const msgData = choices[0].message as Record<string, unknown>;
    const message: Message = {
      role: msgData.role as string,
      content: msgData.content as string,
      tool_calls: msgData.tool_calls as Message["tool_calls"],
      extra: {
        actions,
        response,
        ...costOutput,
        timestamp: Date.now() / 1000,
      },
    };
    return message;
  }

  protected _calculateCost(response: Record<string, unknown>): { cost: number } {
    const usage = (response.usage as Record<string, unknown>) ?? {};
    const cost = (usage.cost as number) ?? 0.0;
    if (cost <= 0.0 && this.cfg.cost_tracking !== "ignore_errors") {
      logger.warning(`No valid cost from OpenRouter for ${this.cfg.model_name}.`);
    }
    return { cost };
  }

  private _parseActions(response: Record<string, unknown>): Action[] {
    const choices = response.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    const toolCalls = (msg.tool_calls as Record<string, unknown>[]) ?? [];
    return parseToolcallActions(toolCalls as unknown as Parameters<typeof parseToolcallActions>[0], {
      formatErrorTemplate: this.cfg.format_error_template!,
      templateKwargs: { finish_reason: choices[0].finish_reason },
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
    return { ...this.cfg } as Record<string, unknown>;
  }

  serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          model: this.cfg,
          model_type: "OpenRouterModel",
        },
      },
    };
  }
}

// Text-based variant
export class OpenRouterTextbasedModel extends OpenRouterModel {
  private actionRegex = "```mswea_bash_command\\s*\\n(.*?)\\n```";
  private textFormatErrorTemplate = "Please always provide EXACTLY ONE action in triple backticks, found {{actions|length}} actions.";

  init(config: Record<string, unknown>): void {
    super.init(config);
    this.actionRegex = (config.action_regex as string) ?? this.actionRegex;
    this.textFormatErrorTemplate = (config.format_error_template as string) ?? this.textFormatErrorTemplate;
  }

  private _parseActionsText(response: Record<string, unknown>): Action[] {
    const choices = response.choices as Record<string, unknown>[];
    const content = (choices[0].message as Record<string, unknown>).content as string ?? "";
    const matches = [...content.matchAll(new RegExp(this.actionRegex, "gs"))];
    const actions = matches.map((m) => (m[1] ?? m[0]).trim());
    if (actions.length !== 1) {
      throw new FormatError({
        role: "user",
        content: this.textFormatErrorTemplate.replace("{{actions|length}}", String(actions.length)),
        extra: { interrupt_type: "FormatError", n_actions: actions.length, model_response: content },
      });
    }
    return [{ command: actions[0] }];
  }

  async query(messages: Message[], kwargs: Record<string, unknown> = {}): Promise<Message> {
    // Override to use text-based parsing - don't send tools
    const prepared = this._prepareMessagesForApi(messages);
    const payload = {
      model: this.cfg.model_name,
      messages: prepared,
      usage: { include: true },
      ...this.cfg.model_kwargs,
      ...kwargs,
    };
    const response = await retryWithBackoff(
      async () => {
        const r = await fetch(this.apiUrl, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) throw new OpenRouterAPIError(`HTTP ${r.status}: ${await r.text()}`);
        return r.json() as Promise<Record<string, unknown>>;
      },
      { logger, abortExceptions: this.abortExceptions },
    );
    const costOutput = this._calculateCost(response);
    GLOBAL_MODEL_STATS.add(costOutput.cost);
    const actions = this._parseActionsText(response);
    const choices = response.choices as Record<string, unknown>[];
    const msgData = choices[0].message as Record<string, unknown>;
    return {
      role: msgData.role as string,
      content: msgData.content as string,
      extra: { actions, response, ...costOutput, timestamp: Date.now() / 1000 },
    };
  }

  serialize(): Record<string, unknown> {
    return { info: { config: { model: this.cfg, model_type: "OpenRouterTextbasedModel" } } };
  }
}
