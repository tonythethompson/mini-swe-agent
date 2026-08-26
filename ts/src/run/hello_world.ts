/** Simplest possible example of using mini-SWE-agent with programmatic bindings.
 * Ported from src/minisweagent/run/hello_world.py */
import path from "node:path";
import YAML from "yaml";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { DefaultAgent } from "../agents/default.js";
import { LocalEnvironment } from "../environments/local.js";
import { LitellmModel } from "../models/litellm_model.js";

export async function runHelloWorld(task: string, modelName: string): Promise<DefaultAgent> {
  const configDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "config");
  const configPath = path.join(configDir, "default.yaml");
  const config = YAML.parse(fs.readFileSync(configPath, "utf-8"));
  const agent = new DefaultAgent(
    new LitellmModel({ model_name: modelName }),
    new LocalEnvironment({}),
    config.agent as Record<string, unknown>,
  );
  await agent.run(task);
  return agent;
}
