/** Requesty model (raw HTTP).
 * Ported from src/minisweagent/models/requesty_model.py */
import { type Message, type Action, type EnvOutput } from "../exceptions.js";
import { FormatError } from "../exceptions.js";
import { GLOBAL_MODEL_STATS } from "./global_stats.js";
import { BASH_TOOL, parseToolcallActions, formatToolcallObservationMessages } from "./utils/actions_toolcall.js";
import { reorderAnthropicThinkingBlocks } from "./utils/anthropic_utils.js";
import { setCacheControl } from "./utils/cache_control.js";
import { expandMultimodalContent } from "./utils/multimodal.js";
import { retryWithBackoff } from "./utils/retry.js";
import { logger } from "../utils/log.js";

export class RequestyAPIError extends Error {}
export class RequestyAuthenticationError extends Error {}
export class RequestyRateLimitError extends Error {}

const DEFAULT_OBSERVATION_TEMPLATE =
  "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
  "<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>";

export class RequestyModel {
  config: Record<string, unknown> = {};
  private modelName = "";
  private modelKwargs: Record<string, unknown> = {};
  private setCacheControlMode: "default_end" | null = null;
  private formatErrorTemplate = "{{ error }}";
  private observationTemplate = DEFAULT_OBSERVATION_TEMPLATE;
  private multimodalRegex = "";
  private apiKey = "";
  private apiUrl = "https://router.requesty.ai/v1/chat/completions";
  abortExceptions: (new (...args: any[]) => Error)[] = [RequestyAuthenticationError, Error];

  init(config: Record<string, unknown>): void {
    this.modelName = config.model_name as string;
    this.modelKwargs = (config.model_kwargs as Record<string, unknown>) ?? {};
    this.setCacheControlMode = (config.set_cache_control as "default_end" | null) ?? null;
    this.formatErrorTemplate = (config.format_error_template as string) ?? "{{ error }}";
    this.observationTemplate = (config.observation_template as string) ?? DEFAULT_OBSERVATION_TEMPLATE;
    this.multimodalRegex = (config.multimodal_regex as string) ?? "";
    this.apiKey = process.env.REQUESTY_API_KEY ?? "";
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  private async _query(messages: Record<string, unknown>[], kwargs: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const payload = {
      model: this.modelName,
      messages,
      tools: [BASH_TOOL],
      ...this.modelKwargs,
      ...kwargs,
    };
    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/SWE-agent/mini-swe-agent",
        "X-Title": "mini-swe-agent",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      if (response.status === 401) throw new RequestyAuthenticationError("Auth failed. Set REQUESTY_API_KEY.");
      if (response.status === 429) throw new RequestyRateLimitError("Rate limit exceeded");
      throw new RequestyAPIError(`HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<Record<string, unknown>>;
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
    const response = await retryWithBackoff(
      () => this._query(this._prepareMessagesForApi(messages), kwargs),
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
    const choices = response.choices as Record<string, unknown>[];
    const msgData = choices[0].message as Record<string, unknown>;
    return {
      role: msgData.role as string,
      content: msgData.content as string,
      tool_calls: msgData.tool_calls as Message["tool_calls"],
      extra: { actions, response, cost, timestamp: Date.now() / 1000 },
    };
  }

  private _calculateCost(response: Record<string, unknown>): number {
    const usage = (response.usage as Record<string, unknown>) ?? {};
    return (usage.cost as number) ?? 0.0;
  }

  private _parseActions(response: Record<string, unknown>): Action[] {
    const choices = response.choices as Record<string, unknown>[];
    const msg = choices[0].message as Record<string, unknown>;
    const toolCalls = (msg.tool_calls as Record<string, unknown>[]) ?? [];
    return parseToolcallActions(toolCalls as unknown as Parameters<typeof parseToolcallActions>[0], {
      formatErrorTemplate: this.formatErrorTemplate,
      templateKwargs: { finish_reason: choices[0].finish_reason },
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
      format_error_template: this.formatErrorTemplate,
      observation_template: this.observationTemplate,
      multimodal_regex: this.multimodalRegex,
    };
  }

  serialize(): Record<string, unknown> {
    return { info: { config: { model: this.config, model_type: "RequestyModel" } } };
  }
}


