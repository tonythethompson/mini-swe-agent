/** Run mini-SWE-agent in your local environment. Default executable `mini`.
 * Ported from src/minisweagent/run/mini.py */
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { globalConfigDir } from "../index.js";
import { getAgent } from "../agents/index.js";
import { getEnvironment } from "../environments/index.js";
import { getModel } from "../models/index.js";
import { builtinConfigDir, getConfigFromSpec } from "../config/index.js";
import { recursiveMerge, UNSET, type MaybeUnset } from "../utils/serialize.js";
import readline from "node:readline";

export const DEFAULT_CONFIG_FILE = process.env.MSWEA_MINI_CONFIG_PATH
  ? path.resolve(process.env.MSWEA_MINI_CONFIG_PATH)
  : path.join(builtinConfigDir, "mini.yaml");
export const DEFAULT_OUTPUT_FILE = path.join(globalConfigDir, "last_mini_run.traj.json");

export interface MiniOptions {
  model?: string;
  modelClass?: string;
  agentClass?: string;
  environmentClass?: string;
  task?: string;
  yolo?: boolean;
  costLimit?: number;
  configSpec?: string[];
  output?: string;
  exitImmediately?: boolean;
}

async function multilinePrompt(): Promise<string> {
  return new Promise((resolve) => {
    const lines: string[] = [];
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    process.stderr.write("(multiline - Ctrl+D or empty line to submit)\n");
    rl.on("line", (line) => {
      if (line === "") {
        rl.close();
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
    rl.on("close", () => resolve(lines.join("\n")));
  });
}

export async function runMini(opts: MiniOptions = {}): Promise<unknown> {
  const configSpec = opts.configSpec ?? [DEFAULT_CONFIG_FILE];
  process.stderr.write(`Building agent config from specs: ${chalk.green(configSpec.join(", "))}\n`);

  const configs = configSpec.map((spec) => getConfigFromSpec(spec));
  configs.push({
    run: { task: opts.task ?? UNSET },
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

  let runTask = ((config.run as Record<string, unknown>)?.task as MaybeUnset<unknown>) ?? UNSET;
  if (runTask === UNSET) {
    process.stderr.write(chalk.yellow("What do you want to do?\n"));
    runTask = await multilinePrompt();
    process.stderr.write(chalk.green("Got that, thanks!\n"));
  }

  const model = getModel(undefined, (config.model as Record<string, unknown>) ?? {});
  const env = getEnvironment((config.environment as Record<string, unknown>) ?? {}, "local");
  const agent = getAgent(model, env, (config.agent as Record<string, unknown>) ?? {}, "interactive");
  await agent.run(runTask as string);

  const outputPath = (config.agent as Record<string, unknown>)?.output_path as string | undefined;
  if (outputPath) {
    process.stderr.write(`Saved trajectory to ${chalk.green(outputPath)}\n`);
  }
  return agent;
}
