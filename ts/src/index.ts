/** Core protocols/interfaces, version, and path settings.
 * Ported from src/minisweagent/__init__.py */
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { logger } from "./utils/log.js";
import type { Message, ToolCall, Action, EnvOutput } from "./exceptions.js";

export const __version__ = "2.4.6-ts";

export const packageDir = path.resolve(new URL(".", import.meta.url).pathname);

function userConfigDir(appName: string): string {
  const home = os.homedir();
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), appName);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), appName);
}

export const globalConfigDir = path.resolve(
  process.env.MSWEA_GLOBAL_CONFIG_DIR || userConfigDir("mini-swe-agent"),
);
fs.mkdirSync(globalConfigDir, { recursive: true });
export const globalConfigFile = path.join(globalConfigDir, ".env");

if (!process.env.MSWEA_SILENT_STARTUP) {
  console.error(
    `This is mini-swe-agent (TS) version ${__version__}.\n` +
      `Loading global config from '${globalConfigFile}'`,
  );
}
dotenv.config({ path: globalConfigFile });

// === Interfaces (Protocols) ===

/** Interface for language models. */
export interface Model {
  config: Record<string, unknown>;
  query(messages: Message[], kwargs?: Record<string, unknown>): Promise<Message> | Message;
  formatMessage(kwargs: Record<string, unknown>): Message;
  formatObservationMessages(
    message: Message,
    outputs: EnvOutput[],
    templateVars?: Record<string, unknown>,
  ): Message[];
  getTemplateVars(kwargs?: Record<string, unknown>): Record<string, unknown>;
  serialize(): Record<string, unknown>;
}

/** Interface for execution environments. */
export interface Environment {
  config: Record<string, unknown>;
  execute(action: Action, cwd?: string): Promise<EnvOutput> | EnvOutput;
  getTemplateVars(kwargs?: Record<string, unknown>): Record<string, unknown>;
  serialize(): Record<string, unknown>;
}

/** Interface for agents. */
export interface Agent {
  config: Record<string, unknown>;
  run(task: string, kwargs?: Record<string, unknown>): Promise<Record<string, unknown>>;
  save(filePath: string | null, ...extraDicts: Record<string, unknown>[]): Record<string, unknown>;
}

export { logger };
export type { Message, ToolCall, Action, EnvOutput } from "./exceptions.js";
