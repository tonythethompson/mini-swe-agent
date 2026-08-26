/** Environment implementations for mini-SWE-agent (TS).
 * Ported from src/minisweagent/environments/__init__.py */
import { type Environment } from "../index.js";
import { LocalEnvironment } from "./local.js";
import { DockerEnvironment } from "./docker.js";

const ENVIRONMENT_MAPPING: Record<string, new (config?: Record<string, unknown>) => Environment> = {
  docker: DockerEnvironment,
  local: LocalEnvironment,
};

export function getEnvironmentClass(spec: string): new (config?: Record<string, unknown>) => Environment {
  const cls = ENVIRONMENT_MAPPING[spec];
  if (cls) return cls;
  throw new Error(`Unknown environment type: ${spec} (available: ${Object.keys(ENVIRONMENT_MAPPING)})`);
}

export function getEnvironment(config: Record<string, unknown>, defaultType = ""): Environment {
  const cfg = { ...config };
  const envClass = (cfg.environment_class as string) || defaultType;
  delete cfg.environment_class;
  return new (getEnvironmentClass(envClass))(cfg);
}

export { LocalEnvironment, DockerEnvironment };
