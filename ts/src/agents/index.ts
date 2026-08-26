/** Agent implementations for mini-SWE-agent (TS).
 * Ported from src/minisweagent/agents/__init__.py */
import { type Agent, type Model, type Environment } from "../index.js";
import { DefaultAgent } from "./default.js";
import { InteractiveAgent } from "./interactive.js";

type AgentConstructor = new (model?: Model, env?: Environment, config?: Record<string, unknown>) => Agent;

const AGENT_MAPPING: Record<string, AgentConstructor> = {
  default: DefaultAgent as AgentConstructor,
  interactive: InteractiveAgent as AgentConstructor,
};

export function getAgentClass(spec: string): AgentConstructor {
  const cls = AGENT_MAPPING[spec];
  if (cls) return cls;
  throw new Error(`Unknown agent type: ${spec} (available: ${Object.keys(AGENT_MAPPING)})`);
}

export function getAgent(
  model: Model,
  env: Environment,
  config: Record<string, unknown>,
  defaultType = "",
): Agent {
  const cfg = { ...config };
  const agentClass = (cfg.agent_class as string) || defaultType;
  delete cfg.agent_class;
  const instance = new (getAgentClass(agentClass))(model, env, cfg);
  return instance;
}

export { DefaultAgent, InteractiveAgent };
