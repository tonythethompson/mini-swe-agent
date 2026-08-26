/** Docker environment.
 * Ported from src/minisweagent/environments/docker.py */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import crypto from "node:crypto";
import { type Environment, type Action, type EnvOutput } from "../index.js";
import { Submitted, InterruptAgentFlow } from "../exceptions.js";
import { recursiveMerge } from "../utils/serialize.js";

const execFileAsync = promisify(execFile);

export interface DockerEnvironmentConfig {
  image: string;
  cwd: string;
  env: Record<string, string>;
  forward_env: string[];
  timeout: number;
  executable: string;
  run_args: string[];
  container_timeout: string;
  pull_timeout: number;
  interpreter: string[];
}

export class DockerEnvironment implements Environment {
  config: Record<string, unknown> = {};
  private cfg!: DockerEnvironmentConfig;
  private containerId: string | null = null;

  init(config: Record<string, unknown>): void {
    this.cfg = {
      image: config.image as string,
      cwd: (config.cwd as string) ?? "/",
      env: (config.env as Record<string, string>) ?? {},
      forward_env: (config.forward_env as string[]) ?? [],
      timeout: (config.timeout as number) ?? 30,
      executable: (config.executable as string) ?? process.env.MSWEA_DOCKER_EXECUTABLE ?? "docker",
      run_args: (config.run_args as string[]) ?? ["--rm"],
      container_timeout: (config.container_timeout as string) ?? "2h",
      pull_timeout: (config.pull_timeout as number) ?? 120,
      interpreter: (config.interpreter as string[]) ?? ["bash", "-lc"],
    };
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
      this._startContainer();
    }
  }

  private async _startContainer(): Promise<void> {
    const containerName = `minisweagent-${crypto.randomUUID().slice(0, 8)}`;
    const cmd = [
      this.cfg.executable, "run", "-d", "--name", containerName,
      "-w", this.cfg.cwd, ...this.cfg.run_args, this.cfg.image,
      "sleep", this.cfg.container_timeout,
    ];
    try {
      const { stdout } = await execFileAsync(this.cfg.executable, cmd.slice(1), {
        timeout: this.cfg.pull_timeout * 1000,
      });
      this.containerId = stdout.trim();
    } catch (e) {
      throw new Error(`Failed to start container: ${e}`);
    }
  }

  async execute(action: Action, cwd = ""): Promise<EnvOutput> {
    const command = action.command ?? "";
    const workDir = cwd || this.cfg.cwd;
    if (!this.containerId) {
      if (this.containerId === null) await this._startContainer();
    }
    const cmd = [this.cfg.executable, "exec", "-w", workDir];
    for (const key of this.cfg.forward_env) {
      const value = process.env[key];
      if (value !== undefined) cmd.push("-e", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(this.cfg.env)) {
      cmd.push("-e", `${key}=${value}`);
    }
    cmd.push(this.containerId!, ...this.cfg.interpreter, command);
    try {
      const { stdout } = await execFileAsync(this.cfg.executable, cmd.slice(1), {
        timeout: this.cfg.timeout * 1000,
        maxBuffer: 10 * 1024 * 1024,
      });
      const output: EnvOutput = { output: stdout, returncode: 0, exception_info: "" };
      this._checkFinished(output);
      return output;
    } catch (e) {
      if (e instanceof InterruptAgentFlow) throw e;
      const err = e as { stdout?: string; code?: number; message: string };
      const output: EnvOutput = {
        output: err.stdout ?? "",
        returncode: err.code ?? -1,
        exception_info: `An error occurred while executing the command: ${e}`,
        extra: { exception_type: "ExecError", exception: String(e) },
      };
      this._checkFinished(output);
      return output;
    }
  }

  private _checkFinished(output: EnvOutput): void {
    const lines = (output.output ?? "").trimStart().match(/[^\n]*\n?/g)?.filter((l) => l !== "") ?? [];
    if (lines.length > 0 && lines[0].trim() === "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" && output.returncode === 0) {
      const submission = lines.slice(1).join("");
      throw new Submitted({
        role: "exit",
        content: submission,
        extra: { exit_status: "Submitted", submission },
      });
    }
  }

  getTemplateVars(kwargs: Record<string, unknown> = {}): Record<string, unknown> {
    return recursiveMerge(
      this.cfg as unknown as Record<string, unknown>,
      { system: os.platform(), release: os.release(), version: "", machine: os.arch() },
      kwargs,
    );
  }

  serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          environment: this.cfg,
          environment_type: "DockerEnvironment",
        },
      },
    };
  }

  cleanup(): void {
    if (this.containerId) {
      const cmd = `(timeout 60 ${this.cfg.executable} stop ${this.containerId} || ${this.cfg.executable} rm -f ${this.containerId}) >/dev/null 2>&1 &`;
      const { spawn } = require("node:child_process");
      spawn(cmd, { shell: true, detached: true, stdio: "ignore" }).unref();
    }
  }
}
