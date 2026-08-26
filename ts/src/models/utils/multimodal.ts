/** Utilities for handling multimodal content in OpenAI-style messages.
 * Ported from src/minisweagent/models/utils/openai_multimodal.py */
import { type Message } from "../../exceptions.js";

export const DEFAULT_MULTIMODAL_REGEX =
  "(?s)<MSWEA_MULTIMODAL_CONTENT><CONTENT_TYPE>(.+?)</CONTENT_TYPE>(.+?)</MSWEA_MULTIMODAL_CONTENT>";

type ContentPart = { type: string; text?: string; image_url?: { url: string } };

function expandContentString(content: string, pattern: string): ContentPart[] {
  const matches = [...content.matchAll(new RegExp(pattern, "gs"))];
  if (matches.length === 0) return [{ type: "text", text: content }];
  const result: ContentPart[] = [];
  let lastEnd = 0;
  for (const match of matches) {
    const textBefore = content.slice(lastEnd, match.index);
    if (textBefore) result.push({ type: "text", text: textBefore });
    const contentType = (match[1] ?? "").trim();
    const extracted = (match[2] ?? "").trim();
    if (contentType === "image_url") result.push({ type: "image_url", image_url: { url: extracted } });
    lastEnd = (match.index ?? 0) + match[0].length;
  }
  const textAfter = content.slice(lastEnd);
  if (textAfter) result.push({ type: "text", text: textAfter });
  return result;
}

/** Recursively expand multimodal content in messages. Returns a copy. */
export function expandMultimodalContent<T>(content: T, pattern: string): T {
  if (!pattern) return content;
  return _expand(structuredClone(content), pattern) as T;
}

function _expand(node: unknown, pattern: string): unknown {
  if (typeof node === "string") return expandContentString(node, pattern);
  if (Array.isArray(node)) return node.map((item) => _expand(item, pattern));
  if (typeof node === "object" && node !== null) {
    const obj = node as Record<string, unknown>;
    if ("content" in obj) obj.content = _expand(obj.content, pattern);
    return obj;
  }
  return String(node);
}
