/** Parse actions & format observations without tool calls (text-based, v1 style).
 * Ported from src/minisweagent/models/utils/actions_text.py */
import nunjucks from "nunjucks";
import { FormatError, type Action, type EnvOutput, type Message } from "../../exceptions.js";
import { expandMultimodalContent } from "./multimodal.js";

/** Parse actions from text content using regex. Raises FormatError if not exactly one action. */
export function parseRegexActions(
  content: string,
  opts: { actionRegex: string; formatErrorTemplate: string; templateKwargs?: Record<string, unknown> },
): Action[] {
  const { actionRegex, formatErrorTemplate, templateKwargs = {} } = opts;
  const matches = [...content.matchAll(new RegExp(actionRegex, "gs"))];
  const actions = matches.map((m) => (m[1] ?? m[0]).trim());
  if (actions.length !== 1) {
    const errorMsg = `Expected exactly 1 action, found ${actions.length}.`;
    throw new FormatError({
      role: "user",
      content: nunjucks.renderString(formatErrorTemplate, {
        actions,
        error: errorMsg,
        ...templateKwargs,
      }),
      extra: { interrupt_type: "FormatError", n_actions: actions.length, model_response: content },
    });
  }
  return [{ command: actions[0] }];
}

/** Format execution outputs into user observation messages. */
export function formatObservationMessages(
  outputs: EnvOutput[],
  opts: { observationTemplate: string; templateVars?: Record<string, unknown>; multimodalRegex?: string },
): Message[] {
  const { observationTemplate, templateVars = {}, multimodalRegex = "" } = opts;
  const results: Message[] = [];
  for (const output of outputs) {
    const content = nunjucks.renderString(observationTemplate, { output, ...templateVars });
    let msg: Message = {
      role: "user",
      content,
      extra: {
        raw_output: output.output,
        returncode: output.returncode,
        timestamp: Date.now() / 1000,
        exception_info: output.exception_info,
        ...(output.extra || {}),
      },
    };
    if (multimodalRegex) msg = expandMultimodalContent(msg, multimodalRegex);
    results.push(msg);
  }
  return results;
}
