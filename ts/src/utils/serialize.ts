/** Recursive merge utility and UNSET sentinel.
 * Ported from src/minisweagent/utils/serialize.py */

export const UNSET = Symbol("UNSET");

export type MaybeUnset<T> = T | typeof UNSET;

/** Merge multiple dictionaries recursively.
 * Later dictionaries take precedence over earlier ones.
 * Nested dictionaries are merged recursively.
 * UNSET values are skipped. */
export function recursiveMerge(...dicts: (Record<string, unknown> | null | undefined)[]): Record<string, unknown> {
  if (dicts.length === 0) return {};
  const result: Record<string, unknown> = {};
  for (const d of dicts) {
    if (d == null) continue;
    for (const [key, value] of Object.entries(d)) {
      if (value === UNSET) continue;
      if (key in result && isPlainObject(result[key]) && isPlainObject(value)) {
        result[key] = recursiveMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else if (isPlainObject(value)) {
        // Recursively merge dict values to filter out nested UNSET values
        result[key] = recursiveMerge(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
