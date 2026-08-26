/** Convenience functions for selecting models.
 * Ported from src/minisweagent/models/__init__.py */
import os from "node:os";
import type { Model } from "../model_types.js";
import { LitellmModel } from "./litellm_model.js";
import { LitellmTextbasedModel } from "./litellm_textbased_model.js";
import { LitellmResponseModel } from "./litellm_response_model.js";
import { OpenRouterModel, OpenRouterTextbasedModel } from "./openrouter_model.js";
import { RequestyModel } from "./requesty_model.js";
import { PortkeyModel } from "./portkey_model.js";
import { DeterministicModel } from "./test_models.js";

export { GLOBAL_MODEL_STATS } from "./global_stats.js";

export function getModelName(
  inputModelName?: string | null,
  config?: Record<string, unknown>,
): string {
  if (inputModelName) return inputModelName;
  if (config?.model_name) return config.model_name as string;
  if (process.env.MSWEA_MODEL_NAME) return process.env.MSWEA_MODEL_NAME;
  throw new Error("No default model set. Please run `mini config setup` to set one.");
}

const MODEL_CLASS_MAPPING: Record<string, new (config?: Record<string, unknown>) => Model> = {
  litellm: LitellmModel,
  litellm_textbased: LitellmTextbasedModel,
  litellm_response: LitellmResponseModel,
  openrouter: OpenRouterModel,
  openrouter_textbased: OpenRouterTextbasedModel,
  portkey: PortkeyModel,
  requesty: RequestyModel,
  deterministic: DeterministicModel,
};

export function getModelClass(modelName: string, modelClass = ""): new (config?: Record<string, unknown>) => Model {
  if (modelClass) {
    const cls = MODEL_CLASS_MAPPING[modelClass];
    if (cls) return cls;
    throw new Error(`Unknown model class: ${modelClass} (available: ${Object.keys(MODEL_CLASS_MAPPING)})`);
  }
  return LitellmModel;
}

export function getModel(inputModelName?: string | null, config?: Record<string, unknown>): Model {
  const resolvedName = getModelName(inputModelName, config);
  const cfg: Record<string, unknown> = { ...(config ?? {}), model_name: resolvedName };
  const modelClass = getModelClass(resolvedName, (cfg.model_class as string) ?? "");
  delete cfg.model_class;

  if (
    ["anthropic", "sonnet", "opus", "claude"].some((s) => resolvedName.toLowerCase().includes(s)) &&
    !("set_cache_control" in cfg)
  ) {
    cfg.set_cache_control = "default_end";
  }

  const instance = new modelClass(cfg);
  return instance;
}


