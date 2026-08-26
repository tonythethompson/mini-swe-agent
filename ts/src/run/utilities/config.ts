/** Config management utility.
 * Ported from src/minisweagent/run/utilities/config.py */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { globalConfigFile } from "../../index.js";

function ensureConfigDir(): void {
  const dir = path.dirname(globalConfigFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(globalConfigFile)) {
    fs.writeFileSync(globalConfigFile, "");
  }
}

/** Set a key in the .env config file. */
export function setKey(key: string, value: string): void {
  ensureConfigDir();
  const content = fs.readFileSync(globalConfigFile, "utf-8");
  const lines = content.split("\n");
  let found = false;
  const newLines = lines.map((line) => {
    if (line.startsWith(`${key}=`) || line.startsWith(`${key} `)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) {
    newLines.push(`${key}=${value}`);
  }
  fs.writeFileSync(globalConfigFile, newLines.join("\n"));
}

/** Unset a key in the .env config file. */
export function unsetKey(key: string): void {
  if (!fs.existsSync(globalConfigFile)) return;
  const content = fs.readFileSync(globalConfigFile, "utf-8");
  const lines = content.split("\n").filter((line) => {
    const trimmed = line.trim();
    return !(trimmed.startsWith(`${key}=`) || trimmed.startsWith(`${key} `));
  });
  fs.writeFileSync(globalConfigFile, lines.join("\n"));
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Run the setup wizard. */
export async function setup(): Promise<void> {
  process.stderr.write(
    `\nTo get started, we need to set up your global config file.\n` +
    `It is located at ${globalConfigFile}\n\n` +
    `Here's a few popular models and the required API keys:\n` +
    `  anthropic/claude-sonnet-4-5 (ANTHROPIC_API_KEY)\n` +
    `  openai/gpt-4o (OPENAI_API_KEY)\n` +
    `  gemini/gemini-2.5-pro (GEMINI_API_KEY)\n\n` +
    `Note: Please always include the provider (e.g., "openai/") in the model name.\n` +
    `You can leave any setting blank to skip it.\n\n`,
  );
  const defaultModel = await prompt("Enter your default model (e.g., anthropic/claude-sonnet-4-5): ");
  if (defaultModel) {
    setKey("MSWEA_MODEL_NAME", defaultModel);
  }
  process.stderr.write(
    "If you already have your API keys set as environment variables, you can ignore the next question.\n",
  );
  const keyName = await prompt("Enter your API key name (e.g., ANTHROPIC_API_KEY): ");
  if (keyName) {
    const keyValue = await prompt("Enter your API key value: ");
    if (keyValue) {
      setKey(keyName, keyValue);
    }
  }
  setKey("MSWEA_CONFIGURED", "true");
  process.stderr.write(
    "\nConfig finished. If you want to revisit it, run `mini-extra config setup`.\n",
  );
}
