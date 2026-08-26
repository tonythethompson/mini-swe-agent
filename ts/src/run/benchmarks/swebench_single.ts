/** Run on a single SWE-Bench instance.
 * Ported from src/minisweagent/run/benchmarks/swebench_single.py */
import path from "node:path";
import fs from "node:fs";
import { getAgent } from "../../agents/index.js";
import { getModel } from "../../models/index.js";
import { getConfigFromSpec, builtinConfigDir } from "../../config/index.js";
import { globalConfigDir } from "../../index.js";
import { recursiveMerge, UNSET } from "../../utils/serialize.js";
import { getSbEnvironment, DATASET_MAPPING } from "./swebench.js";
import { logger } from "../../utils/log.js";

export const DEFAULT_OUTPUT_FILE = path.join(globalConfigDir, "last_swebench_single_run.traj.json");
export const DEFAULT_CONFIG_FILE = path.join(builtinConfigDir, "benchmarks", "swebench.yaml");

export interface SwebenchSingleOptions {
  subset?: string;
  split?: string;
  instance?: string | number;
  model?: string;
  modelClass?: string;
  agentClass?: string;
  environmentClass?: string;
  yolo?: boolean;
  costLimit?: number;
  configSpec?: string[];
  exitImmediately?: boolean;
  output?: string;
}

/** Run on a single SWE-Bench instance. */
export async function runSwebenchSingle(opts: SwebenchSingleOptions): Promise<void> {
  const subset = opts.subset ?? "lite";
  const split = opts.split ?? "dev";
  const instanceSpec = opts.instance ?? 0;

  const datasetPath = DATASET_MAPPING[subset] ?? subset;
  logger.info(`Loading dataset from ${datasetPath}, split ${split}...`);

  // Load instances from local file
  const localFile = path.join(process.cwd(), "instances.json");
  if (!fs.existsSync(localFile)) {
    logger.error(`No instances file found at ${localFile}.`);
    return;
  }
  const allInstances: Record<string, unknown>[] = JSON.parse(fs.readFileSync(localFile, "utf-8"));
  const instances: Record<string, Record<string, unknown>> = {};
  for (const inst of allInstances) {
    instances[inst.instance_id as string] = inst;
  }

  let instanceId: string;
  if (typeof instanceSpec === "number") {
    const sortedIds = Object.keys(instances).sort();
    instanceId = sortedIds[instanceSpec];
  } else {
    instanceId = instanceSpec;
  }
  const instance = instances[instanceId];

  const configSpec = opts.configSpec ?? [DEFAULT_CONFIG_FILE];
  const configs = configSpec.map((spec) => getConfigFromSpec(spec));
  configs.push({
    agent: {
      agent_class: opts.agentClass ?? UNSET,
      mode: opts.yolo ? "yolo" : UNSET,
      cost_limit: opts.costLimit !== undefined ? opts.costLimit : UNSET,
      confirm_exit: opts.exitImmediately ? false : UNSET,
      output_path: opts.output ?? UNSET,
    },
    model: {
      model_class: opts.modelClass ?? UNSET,
      model_name: opts.model ?? UNSET,
    },
    environment: {
      environment_class: opts.environmentClass ?? UNSET,
    },
  });
  const config = recursiveMerge(...configs);

  const env = getSbEnvironment(config, instance);
  const agent = getAgent(
    getModel(undefined, config.model as Record<string, unknown> ?? {}),
    env,
    config.agent as Record<string, unknown> ?? {},
    "interactive",
  );
  await agent.run(instance.problem_statement as string);
}
