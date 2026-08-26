/** Response API model (litellm_response equivalent).
 * Ported from src/minisweagent/models/litellm_response_model.py
 *
 * Uses the OpenAI Responses API instead of chat completions. */
import { type Message, type Action, type EnvOutput } from "../index.js";
import { FormatError } from "../exceptions.js";
import { LitellmModel } from "./litellm_model.js";
import { GLOBAL_MODEL_STATS } from "./index.js";
import {
  BASH_TOOL_RESPONSE_API,
  finishReasonFromResponsesApi,
  parseToolcallActionsResponse,
  formatToolcallObservationMessagesResponse,
} from "./utils/actions_toolcall_response.js";
import { retryWithBackoff } from "./utils/retry.js";
import { logger } from "../utils/log.js";

type AnyResponse = Record<string, any>;

export class LitellmResponseModel extends LitellmModel {
  private _prepareResponseMessagesForApi(messages: Message[]): Record<string, unknown>[] {
    const result: Record<string, unknown>[] = [];
    for (const msg of messages) {
      const obj = msg as unknown as Record<string, unknown>;
      if (obj.object === "response") {
        const output = (obj.output as Record<string, unknown>[]) ?? [];
        for (const item of output) {
          const { extra, ...rest } = item as Record<string, unknown>;
          result.push(rest);
        }
      } else {
        const { extra, ...rest } = obj;
        result.push(rest);
      }
    }
    return result;
  }

  private async _queryResponse(messages: Message[], kwargs: Record<string, unknown> = {}): Promise<AnyResponse> {
    const baseURL = this.client.baseURL;
    const apiKey = process.env.OPENAI_API_KEY;
    const apiModel = this.cfg.model_name.replace(/^[^/]+\//, "");
    const response = await fetch(`${baseURL}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: apiModel,
        input: this._prepareResponseMessagesForApi(messages),
        tools: [BASH_TOOL_RESPONSE_API],
        ...this.cfg.model_kwargs,
        ...kwargs,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Responses API error ${response.status}: ${text}`);
    }
    return response.json() as Promise<AnyResponse>;
  }

  override async query(messages: Message[], kwargs: Record<string, unknown> = {}): Promise<Message> {
    const response = await retryWithBackoff(
      () => this._queryResponse(messages, kwargs),
      { logger, abortExceptions: this.abortExceptions },
    );
    const costOutput = this._calculateCostFromResponse(response);
    GLOBAL_MODEL_STATS.add(costOutput.cost);
    let actions: Action[];
    try {
      actions = this._parseActionsResponse(response);
    } catch (e) {
      if (e instanceof FormatError) {
        (e.messages[0].extra ?? {}).cost = costOutput.cost;
        (e.messages[0].extra ?? {}).response = response;
        throw e;
      }
      throw e;
    }
    const message: Message = {
      role: "assistant",
      content: (response.output_text as string) ?? "",
      extra: {
        actions,
        ...costOutput,
        timestamp: Date.now() / 1000,
        response,
      },
    } as Message;
    (message as unknown as Record<string, unknown>).object = "response";
    (message as unknown as Record<string, unknown>).output = response.output;
    return message;
  }

  private _calculateCostFromResponse(response: AnyResponse): { cost: number } {
    const usage = response.usage as Record<string, unknown> | undefined;
    if (!usage) return { cost: 0.0 };
    const input = (usage.input_tokens as number) ?? 0;
    const output = (usage.output_tokens as number) ?? 0;
    const cost = (input * 0.15 + output * 0.6) / 1_000_000;
    return { cost };
  }

  private _parseActionsResponse(response: AnyResponse): Action[] {
    const output = (response.output as Record<string, unknown>[]) ?? [];
    return parseToolcallActionsResponse(
      output as unknown as Parameters<typeof parseToolcallActionsResponse>[0],
      this.cfg.format_error_template!,
      { finish_reason: finishReasonFromResponsesApi(response) },
    );
  }

  override formatObservationMessages(
    message: Message,
    outputs: EnvOutput[],
    templateVars?: Record<string, unknown>,
  ): Message[] {
    const actions = (message.extra?.actions as Action[]) ?? [];
    return formatToolcallObservationMessagesResponse(
      actions,
      outputs,
      this.cfg.observation_template!,
      templateVars,
      this.cfg.multimodal_regex,
    );
  }

  override serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          model: this.cfg,
          model_type: "LitellmResponseModel",
        },
      },
    };
  }
}
