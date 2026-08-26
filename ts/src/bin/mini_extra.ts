#!/usr/bin/env node
/** CLI entry point for mini-extra (config management utilities).
 * Ported from src/minisweagent/run/utilities/config.py and mini_extra.py */
import { Command } from "commander";
import { setKey, unsetKey, setup } from "../run/utilities/config.js";

const program = new Command();

program
  .name("mini-extra")
  .description("Extra utilities for mini-SWE-agent")
  .addCommand(
    new Command("config")
      .description("Manage the global config file")
      .addCommand(
        new Command("setup")
          .description("Setup the global config file")
          .action(async () => {
            await setup();
          }),
      )
      .addCommand(
        new Command("set")
          .description("Set a key in the global config file")
          .argument("[key]", "The key to set")
          .argument("[value]", "The value to set")
          .action(async (key?: string, value?: string) => {
            if (!key) key = await prompt("Enter the key to set: ");
            if (!value) value = await prompt(`Enter the value for ${key}: `);
            setKey(key, value);
          }),
      )
      .addCommand(
        new Command("unset")
          .description("Unset a key in the global config file")
          .argument("[key]", "The key to unset")
          .action(async (key?: string) => {
            if (!key) key = await prompt("Enter the key to unset: ");
            unsetKey(key);
          }),
      ),
  );

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

program.parse(process.argv);
