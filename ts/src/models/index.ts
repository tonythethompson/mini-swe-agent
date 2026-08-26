/** Convenience functions for selecting models.
 * Ported from src/minisweagent/models/__init__.py */
import os from "node:os";
import { type Model } from "../index.js";
import { LitellmModel } from "./litellm_model.js";
import { DeterministicModel } from "./test_models.js";

/** Global model statistics tracker with optional limits. */
class GlobalModelStats {
  private _cost = 0.0;
  private _nCalls = 0;
  costLimit = parseFloat(process.env.MSWEA_GLOBAL_COST_LIMIT ?? "0");
  callLimit = parseInt(process.env.MSWEA_GLOBAL_CALL_LIMIT ?? "0", 10);

  add(cost: number): void {
    this._cost += cost;
    this._nCalls += 1;
    if ((this.costLimit > 0 && this.costLimit < this._cost) || (this.callLimit > 0 && this.callLimit < this._nCalls)) {
      throw new Error(`Global cost/call limit exceeded: $${this._cost.toFixed(4)} / ${this._nCalls}`);
    }
  }

  get cost(): number {
    return this._cost;
  }
  get nCalls(): number {
    return this._nCalls;
  }
}

export const GLOBAL_MODEL_STATS = new GlobalModelStats();

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
