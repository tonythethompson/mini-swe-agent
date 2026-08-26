/** Cache control utilities for Anthropic models.
 * Ported from src/minisweagent/models/utils/cache_control.py */

type Msg = Record<string, unknown>;

function getContentText(entry: Msg): string | null {
  const content = entry.content;
  if (content === null || content === undefined) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content) && content.length === 1) {
    return (content[0] as Record<string, unknown>).text as string;
  }
  throw new Error("Expected single message in content");
}

function _clearCacheControl(entry: Msg): void {
  if (Array.isArray(entry.content)) {
    delete (entry.content[0] as Record<string, unknown>).cache_control;
  }
  delete entry.cache_control;
}


function _setCacheControl(entry: Msg): void {
  const content = entry.content as unknown;
  if (content === null || content === undefined) {
    entry.cache_control = { type: "ephemeral" };
    return;
  }
  if (!Array.isArray(content)) {
    entry.content = [
      { type: "text", text: getContentText(entry), cache_control: { type: "ephemeral" } },
    ];
  } else {
    (content[0] as Record<string, unknown>).cache_control = { type: "ephemeral" };
  }
  if (entry.role === "tool") {
    const c = entry.content as unknown[];
    delete (c[0] as Record<string, unknown>).cache_control;
    entry.cache_control = { type: "ephemeral" };
  }
}

/** Add manual cache control marks to messages. */
export function setCacheControl(
  messages: Msg[],
  mode: "default_end" | null = "default_end",
): Msg[] {
  if (mode === null) return messages;
  if (mode !== "default_end") throw new Error(`Invalid mode: ${mode}`);
  const cloned = structuredClone(messages);
  const reversed = [...cloned].reverse();
  for (let i = 0; i < reversed.length; i++) {
    _clearCacheControl(reversed[i]);
    if (i === 0) _setCacheControl(reversed[i]);
  }
  return reversed.reverse();
}


