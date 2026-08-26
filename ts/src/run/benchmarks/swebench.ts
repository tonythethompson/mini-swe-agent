/** SWE-Bench benchmark runner.
 * Ported from src/minisweagent/run/benchmarks/swebench.py
 *
 * Runs mini-SWE-agent on SWE-bench instances in batch mode. */
import fs from "node:fs";
import path from "node:path";
import { DefaultAgent } from "../../agents/default.js";
import { getEnvironment } from "../../environments/index.js";
import { getModel } from "../../models/index.js";
import { getAgent } from "../../agents/index.js";
import { getConfigFromSpec, builtinConfigDir } from "../../config/index.js";
import { recursiveMerge, UNSET } from "../../utils/serialize.js";
import { logger } from "../../utils/log.js";

export const DATASET_MAPPING: Record<string, string> = {
  full: "princeton-nlp/SWE-Bench",
  verified: "princeton-nlp/SWE-Bench_Verified",
  lite: "princeton-nlp/SWE-Bench_Lite",
  multimodal: "princeton-nlp/SWE-Bench_Multimodal",
  multilingual: "swe-bench/SWE-Bench_Multilingual",
  smith: "SWE-bench/SWE-smith",
  _test: "klieret/swe-bench-dummy-test-dataset",
  rebench: "nebius/SWE-rebench",
};

/** Get the Docker image name for a SWE-Bench instance. */
export function getSwebenchDockerImageName(instance: Record<string, unknown>): string {
  const imageName = (instance.image_name as string) || (instance.docker_image as string);
  if (imageName) return imageName;
  const iid = instance.instance_id as string;
  const idDockerCompatible = iid.replace(/__/g, "_1776_");
  return `docker.io/swebench/sweb.eval.x86_64.${idDockerCompatible}:latest`.toLowerCase();
}

/** Get the environment for a SWE-Bench instance. */
export function getSbEnvironment(
  config: Record<string, unknown>,
  instance: Record<string, unknown>,
) {
  const envConfig: Record<string, unknown> = { ...(config.environment as Record<string, unknown> ?? {}) };
  envConfig.environment_class = envConfig.environment_class ?? "docker";
  const imageName = getSwebenchDockerImageName(instance);
  if (envConfig.environment_class === "docker" || envConfig.environment_class === "swerex_modal") {
    envConfig.image = imageName;
  } else if (envConfig.environment_class === "singularity" || envConfig.environment_class === "contree") {
    envConfig.image = "docker://" + imageName;
  }
  return getEnvironment(envConfig);
}

/** Update the predictions JSON file with results from a single instance. */
export function updatePredsFile(
  outputDir: string,
  instanceId: string,
  modelName: string,
  result: string,
): void {
  const predsPath = path.join(outputDir, "preds.json");
  let data: Record<string, unknown> = {};
  if (fs.existsSync(predsPath)) {
    data = JSON.parse(fs.readFileSync(predsPath, "utf-8"));
  }
  data[instanceId] = {
    model_name_or_path: modelName,
    instance_id: instanceId,
    model_patch: result,
  };
  fs.writeFileSync(predsPath, JSON.stringify(data, null, 2));
}

/** Process a single SWE-Bench instance. */
export async function processInstance(
  instance: Record<string, unknown>,
  outputDir: string,
  config: Record<string, unknown>,
): Promise<void> {
  const instanceId = instance.instance_id as string;
  const instanceDir = path.join(outputDir, instanceId);
  fs.mkdirSync(instanceDir, { recursive: true });

  const model = getModel(undefined, config.model as Record<string, unknown> ?? {});
  const task = instance.problem_statement as string;

  let exitStatus: string | null = null;
  let result: string | null = null;
  let agent: DefaultAgent | null = null;

  try {
    const env = getSbEnvironment(config, instance);
    agent = getAgent(model, env, config.agent as Record<string, unknown> ?? {}, "interactive") as DefaultAgent;
    const info = await agent.run(task);
    exitStatus = (info.exit_status as string) ?? null;
    result = (info.submission as string) ?? null;
  } catch (e) {
    logger.error(`Error processing instance ${instanceId}: ${e}`);
    exitStatus = e instanceof Error ? e.constructor.name : "Error";
    result = "";
  } finally {
    if (agent) {
      const trajPath = path.join(instanceDir, `${instanceId}.traj.json`);
      agent.save(trajPath, {
        info: { exit_status: exitStatus, submission: result },
        instance_id: instanceId,
      });
    }
    updatePredsFile(outputDir, instanceId, (model as any).cfg?.model_name ?? "unknown", result ?? "");
  }
}

/** Filter and slice instances. */
export function filterInstances(
  instances: Record<string, unknown>[],
  filterSpec: string,
  sliceSpec: string,
  shuffle: boolean,
): Record<string, unknown>[] {
  let filtered = instances;
  if (filterSpec) {
    filtered = filtered.filter((inst) => new RegExp(filterSpec).test(inst.instance_id as string));
  }
  if (sliceSpec) {
    const parts = sliceSpec.split(":").map((x) => (x ? parseInt(x, 10) : undefined));
    filtered = filtered.slice(parts[0], parts[1]);
  }
  return filtered;
}

export interface SwebenchOptions {
  subset?: string;
  split?: string;
  slice?: string;
  filter?: string;
  shuffle?: boolean;
  output?: string;
  workers?: number;
  model?: string;
  modelClass?: string;
  redoExisting?: boolean;
  configSpec?: string[];
  environmentClass?: string;
}

/** Run SWE-Bench in batch mode. */
export async function runSwebench(opts: SwebenchOptions): Promise<void> {
  const subset = opts.subset ?? "lite";
  const split = opts.split ?? "dev";
  const outputDir = opts.output ?? "";
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });

  const datasetPath = DATASET_MAPPING[subset] ?? subset;
  logger.info(`Loading dataset ${datasetPath}, split ${split}...`);

  // In a real implementation, this would use a HuggingFace datasets client.
  // For now, we support loading from a local JSON file.
  const localFile = path.join(outputDir, "instances.json");
  if (!fs.existsSync(localFile)) {
    logger.error(`No instances file found at ${localFile}. Please provide instances.`);
    return;
  }
  let instances: Record<string, unknown>[] = JSON.parse(fs.readFileSync(localFile, "utf-8"));

  instances = filterInstances(instances, opts.filter ?? "", opts.slice ?? "", opts.shuffle ?? false);

  if (!opts.redoExisting && fs.existsSync(path.join(outputDir, "preds.json"))) {
    const existing = Object.keys(JSON.parse(fs.readFileSync(path.join(outputDir, "preds.json"), "utf-8")));
    instances = instances.filter((inst) => !existing.includes(inst.instance_id as string));
  }

  logger.info(`Running on ${instances.length} instances...`);

  const configSpec = opts.configSpec ?? [path.join(builtinConfigDir, "benchmarks", "swebench.yaml")];
  const configs = configSpec.map((spec) => getConfigFromSpec(spec));
  configs.push({
    environment: { environment_class: opts.environmentClass ?? UNSET },
    model: { model_name: opts.model ?? UNSET, model_class: opts.modelClass ?? UNSET },
  });
  const config = recursiveMerge(...configs);

  for (const instance of instances) {
    await processInstance(instance, outputDir, config);
  }
}
