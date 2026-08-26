/** Parse actions & format observations for OpenAI Responses API toolcalls.
 * Ported from src/minisweagent/models/utils/actions_toolcall_response.py */
import nunjucks from "nunjucks";
import { type Message, type Action, type EnvOutput } from "../../index.js";
import { FormatError } from "../../exceptions.js";

/** Bash tool definition for the Responses API (flat structure, no nested "function" key). */
export const BASH_TOOL_RESPONSE_API = {
  type: "function",
  name: "bash",
  description: "Execute a bash command",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
    },
    required: ["command"],
  },
};

/** Map a Responses API response to a finish_reason-like string. */
export function finishReasonFromResponsesApi(response: Record<string, unknown>): string | null {
  const status = response.status as string;
  if (status !== "incomplete") return status;
  const incompleteDetails = response.incomplete_details as Record<string, unknown> | undefined;
  return incompleteDetails?.reason === "max_output_tokens" ? "length" : status;
}

interface ResponseItem {
  type?: string;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
  [key: string]: unknown;
}

/** Parse tool calls from a Responses API response output. */
export function parseToolcallActionsResponse(
  output: ResponseItem[],
  formatErrorTemplate: string,
  templateKwargs: Record<string, unknown> = {},
): Action[] {
  const toolCalls = output.filter((item) => item.type === "function_call");
  if (toolCalls.length === 0) {
    const errorText = nunjucks.renderString(formatErrorTemplate, {
      error: "No tool calls found in the response. Every response MUST include at least one tool call.",
      actions: [],
      has_tool_calls: false,
      ...templateKwargs,
    });
    throw new FormatError({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: errorText }],
      extra: { interrupt_type: "FormatError" },
    } as unknown as Message);
  }
  const actions: Action[] = [];
  for (const tc of toolCalls) {
    let errorMsg = "";
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.arguments ?? "{}");
    } catch (e) {
      errorMsg = `Error parsing tool call arguments: ${e}.`;
    }
    if (tc.name !== "bash") {
      errorMsg += `Unknown tool '${tc.name}'.`;
    }
    if (typeof args !== "object" || args === null || !("command" in args)) {
      errorMsg += "Missing 'command' argument in bash tool call.";
    }
    if (errorMsg) {
      const errorText = nunjucks.renderString(formatErrorTemplate, {
        error: errorMsg.trim(),
        actions: [],
        has_tool_calls: true,
        ...templateKwargs,
      });
      throw new FormatError({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: errorText }],
        extra: { interrupt_type: "FormatError" },
      } as unknown as Message);
    }
    actions.push({
      command: args.command as string,
      tool_call_id: tc.call_id ?? tc.id ?? "",
    });
  }
  return actions;
}

/** Format execution outputs into function_call_output messages for Responses API. */
export function formatToolcallObservationMessagesResponse(
  actions: Action[],
  outputs: EnvOutput[],
  observationTemplate: string,
  templateVars: Record<string, unknown> = {},
  multimodalRegex = "",
): Message[] {
  const notExecuted: EnvOutput = { output: "", returncode: -1, exception_info: "action was not executed" };
  const paddedOutputs = [...outputs, ...Array(Math.max(0, actions.length - outputs.length)).fill(notExecuted)];
  const results: Message[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const output = paddedOutputs[i];
    const content = nunjucks.renderString(observationTemplate, { output, ...templateVars });
    const msg: Message = {
      role: "",
      content,
      extra: {
        raw_output: output.output,
        returncode: output.returncode,
        timestamp: Date.now() / 1000,
        exception_info: output.exception_info,
        ...(output.extra || {}),
      },
    } as Message;
    if (action.tool_call_id) {
      (msg as unknown as Record<string, unknown>).type = "function_call_output";
      (msg as unknown as Record<string, unknown>).call_id = action.tool_call_id;
      (msg as unknown as Record<string, unknown>).output = content;
    } else {
      (msg as unknown as Record<string, unknown>).type = "message";
      msg.role = "user";
      msg.content = [{ type: "input_text", text: content }];
    }
    results.push(msg);
  }
  return results;
}

