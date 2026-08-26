#!/usr/bin/env node
/** CLI entry point for trajectory inspector. */
import { Command } from "commander";
import { findTrajectoryFiles, runInspector } from "../run/utilities/inspector.js";

const program = new Command();

program
  .name("mini-inspector")
  .description("Simple trajectory inspector for browsing agent conversation trajectories.")
  .argument("[path]", "Directory to search for trajectory files or specific trajectory file", ".")
  .option("--no-reasoning", "Hide reasoning content")
  .action(async (path, opts) => {
    const files = findTrajectoryFiles(path);
    if (files.length === 0) {
      console.error("No trajectory files found.");
      process.exit(1);
    }
    await runInspector(files, opts.reasoning !== false);
  });

program.parse(process.argv);
