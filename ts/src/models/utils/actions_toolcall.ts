/** Parse actions & format observations with tool calls.
 * Ported from src/minisweagent/models/utils/actions_toolcall.py */
import nunjucks from "nunjucks";
import { FormatError, type Action, type EnvOutput, type Message, type ToolCall } from "../../exceptions.js";
import { expandMultimodalContent } from "./multimodal.js";

export const BASH_TOOL = {
  type: "function",
  function: {
    name: "bash",
    description: "Execute a bash command",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command to execute" },
      },
      required: ["command"],
    },
  },
};

/** Parse tool calls from the response. Raises FormatError if unknown tool or invalid args. */
export function parseToolcallActions(
  toolCalls: ToolCall[] | null | undefined,
  opts: { formatErrorTemplate: string; templateKwargs?: Record<string, unknown> },
): Action[] {
  const { formatErrorTemplate, templateKwargs = {} } = opts;
  if (!toolCalls || toolCalls.length === 0) {
    throw new FormatError({
      role: "user",
      content: nunjucks.renderString(formatErrorTemplate, {
        error: "No tool calls found in the response. Every response MUST include at least one tool call.",
        actions: [],
        has_tool_calls: false,
        ...templateKwargs,
      }),
      extra: { interrupt_type: "FormatError" },
    });
  }
  const actions: Action[] = [];
  for (const tc of toolCalls) {
    let errorMsg = "";
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch (e) {
      errorMsg = `Error parsing tool call arguments: ${e}.`;
    }
    if (tc.function.name !== "bash") errorMsg += `Unknown tool '${tc.function.name}'.`;
    if (typeof args !== "object" || args === null || !("command" in args)) {
      errorMsg += "Missing 'command' argument in bash tool call.";
    }
    if (errorMsg) {
      throw new FormatError({
        role: "user",
        content: nunjucks.renderString(formatErrorTemplate, {
          actions: [],
          error: errorMsg.trim(),
          has_tool_calls: true,
          ...templateKwargs,
        }),
        extra: { interrupt_type: "FormatError" },
      });
    }
    actions.push({ command: args.command as string, tool_call_id: tc.id });
  }
  return actions;
}

/** Format execution outputs into tool result messages. */
export function formatToolcallObservationMessages(opts: {
  actions: Action[];
  outputs: EnvOutput[];
  observationTemplate: string;
  templateVars?: Record<string, unknown>;
  multimodalRegex?: string;
}): Message[] {
  const { actions, outputs, observationTemplate, templateVars = {}, multimodalRegex = "" } = opts;
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
    };
    if ("tool_call_id" in action && action.tool_call_id) {
      msg.tool_call_id = action.tool_call_id;
      msg.role = "tool";
    } else {
      msg.role = "user"; // human issued commands
    }
    results.push(multimodalRegex ? expandMultimodalContent(msg, multimodalRegex) : msg);
  }
  return results;
}


