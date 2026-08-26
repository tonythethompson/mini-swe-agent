#!/usr/bin/env node
/** CLI entry point for swebench benchmark runner. */
import { Command } from "commander";
import { runSwebench } from "../run/benchmarks/swebench.js";

const program = new Command();

program
  .name("mini-swebench")
  .description("Run mini-SWE-agent on SWEBench instances in batch mode.")
  .option("--subset <subset>", "SWEBench subset", "lite")
  .option("--split <split>", "Dataset split", "dev")
  .option("--slice <slice>", "Slice specification (e.g., '0:5')")
  .option("--filter <filter>", "Filter instance IDs by regex")
  .option("--shuffle", "Shuffle instances")
  .option("-o, --output <output>", "Output directory")
  .option("-w, --workers <workers>", "Number of worker threads", "1")
  .option("-m, --model <model>", "Model to use")
  .option("--model-class <modelClass>", "Model class to use")
  .option("--redo-existing", "Redo existing instances")
  .option("-c, --config <config...>", "Config file paths or key=value specs")
  .option("--environment-class <environmentClass>", "Environment type")
  .action(async (opts) => {
    await runSwebench({
      subset: opts.subset,
      split: opts.split,
      slice: opts.slice,
      filter: opts.filter,
      shuffle: opts.shuffle,
      output: opts.output,
      workers: parseInt(opts.workers, 10),
      model: opts.model,
      modelClass: opts.modelClass,
      redoExisting: opts.redoExisting,
      configSpec: opts.config,
      environmentClass: opts.environmentClass,
    });
  });

program.parse(process.argv);
