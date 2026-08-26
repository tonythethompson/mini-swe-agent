/** Configuration files and utilities for mini-SWE-agent (TS).
 * Ported from src/minisweagent/config/__init__.py */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const builtinConfigDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export function getConfigPath(configSpec: string): string {
  let spec = configSpec;
  if (!spec.endsWith(".yaml")) spec = spec + ".yaml";
  const candidates = [
    path.resolve(spec),
    path.join(process.env.MSWEA_CONFIG_DIR ?? ".", spec),
    path.join(builtinConfigDir, spec),
    path.join(builtinConfigDir, "extra", spec),
    path.join(builtinConfigDir, "benchmarks", spec),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find config file for ${spec} (tried: ${candidates})`);
}

/** Interpret key-value specs from the command line.
 * e.g. "model.model_name=anthropic/claude-sonnet-4-5" -> { model: { model_name: "..." } } */
export function keyValueSpecToNestedDict(configSpec: string): Record<string, unknown> {
  const [key, ...rest] = configSpec.split("=");
  const value = rest.join("=");
  let parsed: unknown = value;
  try {
    parsed = JSON.parse(value);
  } catch {
    // keep as string
  }
  const keys = key.split(".");
  if (keys.some((k) => k === "")) {
    throw new Error(`Invalid config spec '${configSpec}': empty config key`);
  }
  const result: Record<string, unknown> = {};
  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    current[keys[i]] = {};
    current = current[keys[i]] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = parsed;
  return result;
}

export function getConfigFromSpec(configSpec: string): Record<string, unknown> {
  if (configSpec.includes("=")) return keyValueSpecToNestedDict(configSpec);
  const p = getConfigPath(configSpec);
  return YAML.parse(fs.readFileSync(p, "utf-8"));
}
