#!/usr/bin/env node
/** CLI entry point for mini-SWE-agent (TS).
 * Ported from src/minisweagent/run/mini.py (typer -> commander) */
import { Command } from "commander";
import { runMini, DEFAULT_CONFIG_FILE, DEFAULT_OUTPUT_FILE } from "../run/mini.js";

const program = new Command();

program
  .name("mini")
  .description("Run mini-SWE-agent in your local environment.")
  .option("-m, --model <model>", "Model to use")
  .option("--model-class <class>", "Model class to use (e.g., 'litellm')")
  .option("--agent-class <class>", "Agent class to use (e.g., 'interactive')")
  .option("--environment-class <class>", "Environment class to use (e.g., 'local')")
  .option("-t, --task <task>", "Task/problem statement")
  .option("-y, --yolo", "Run without confirmation", false)
  .option("-l, --cost-limit <limit>", "Cost limit. Set to 0 to disable.", (v) => parseFloat(v))
  .option("-c, --config <spec...>", "Config file paths, filenames, or key-value pairs", [DEFAULT_CONFIG_FILE])
  .option("-o, --output <path>", "Output trajectory file", DEFAULT_OUTPUT_FILE)
  .option("--exit-immediately", "Exit immediately when the agent wants to finish instead of prompting", false)
  .action(async (opts) => {
    await runMini({
      model: opts.model,
      modelClass: opts.modelClass,
      agentClass: opts.agentClass,
      environmentClass: opts.environmentClass,
      task: opts.task,
      yolo: opts.yolo,
      costLimit: opts.costLimit,
      configSpec: opts.config,
      output: opts.output,
      exitImmediately: opts.exitImmediately,
    });
  });

program.parse(process.argv);
