#!/usr/bin/env node
/** CLI entry point for hello-world.
 * Ported from src/minisweagent/run/hello_world.py */
import { Command } from "commander";
import { runHelloWorld } from "../run/hello_world.js";

const program = new Command();

program
  .name("mini-hello-world")
  .description("Simplest possible example of using mini-SWE-agent.")
  .requiredOption("-t, --task <task>", "Task/problem statement")
  .requiredOption("-m, --model <model>", "Model name (e.g., anthropic/claude-sonnet-4-5)")
  .action(async (opts) => {
    await runHelloWorld(opts.task, opts.model);
  });

program.parse(process.argv);
