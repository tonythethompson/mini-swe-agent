/** Helper function for pretty-printing content strings.
 * Ported from src/minisweagent/models/utils/content_string.py */

function formatToolCall(argsStr: string): string {
  try {
    const args = typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr;
    if (typeof args === "object" && args !== null && "command" in args) {
      return "```\n" + (args as Record<string, unknown>).command + "\n```";
    }
  } catch {
    // fall through
  }
  return "```\n" + argsStr + "\n```";
}

function formatObservation(content: string): string {
  try {
    const data = JSON.parse(content);
    if (typeof data === "object" && data !== null && "returncode" in data) {
      const lines: string[] = [];
      for (const [key, value] of Object.entries(data)) {
        lines.push(`<${key}>`);
        lines.push(String(value));
      }
      return lines.join("\n");
    }
    return content;
  } catch {
    return content;
  }
}

/** Extract text content from any message format for display. */
export function getContentString(message: Record<string, unknown>): string {
  const texts: string[] = [];
  const content = message.content;
  if (typeof content === "string") {
    texts.push(formatObservation(content));
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as Record<string, unknown>;
      if (it.type === "tool_use") {
        texts.push(formatToolCall(JSON.stringify(it.input ?? {})));
      } else if (it.type === "tool_result") {
        const rc = it.content;
        if (typeof rc === "string") texts.push(formatObservation(rc));
      } else if (typeof it.text === "string") {
        texts.push(it.text);
      }
    }
  }

  const toolCalls = message.tool_calls as Record<string, unknown>[] | undefined;
  if (Array.isArray(toolCalls)) {
    for (const tc of toolCalls) {
      const func = (tc.function ?? {}) as Record<string, unknown>;
      const args = (func.arguments as string) ?? "{}";
      texts.push(formatToolCall(args));
    }
  }

  const output = message.output;
  if (typeof output === "string") {
    texts.push(formatObservation(output));
  } else if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item !== "object" || item === null) continue;
      const it = item as Record<string, unknown>;
      if (it.type === "message") {
        const cs = it.content as Record<string, unknown>[];
        if (Array.isArray(cs)) {
          for (const c of cs) {
            if (typeof c?.text === "string") texts.push(c.text);
          }
        }
      } else if (it.type === "function_call") {
        texts.push(formatToolCall((it.arguments as string) ?? "{}"));
      }
    }
  }

  return texts.filter(Boolean).join("\n\n");
}


