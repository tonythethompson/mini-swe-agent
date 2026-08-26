/** Utilities for Anthropic API compatibility.
 * Ported from src/minisweagent/models/utils/anthropic_utils.py */

type Msg = Record<string, unknown>;
type ContentBlock = Record<string, unknown>;

function isAnthropicThinkingBlock(block: unknown): boolean {
  if (typeof block !== "object" || block === null) return false;
  const type = (block as ContentBlock).type;
  return type === "thinking" || type === "redacted_thinking";
}

/** Reorder thinking blocks so they are not the final block in assistant messages. */
export function reorderAnthropicThinkingBlocks(messages: Msg[]): Msg[] {
  const result: Msg[] = [];
  for (let msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const content = msg.content as ContentBlock[];
      const thinkingBlocks = content.filter(isAnthropicThinkingBlock);
      if (thinkingBlocks.length > 0) {
        const otherBlocks = content.filter((b) => !isAnthropicThinkingBlock(b));
        if (otherBlocks.length > 0) {
          msg = { ...msg, content: [...thinkingBlocks, ...otherBlocks] };
        } else {
          msg = { ...msg, content: [...thinkingBlocks, { type: "text", text: "" }] };
        }
      }
    }
    result.push(msg);
  }
  return result;
}
