/** Singularity environment.
 * Ported from src/minisweagent/environments/singularity.py */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { type Environment, type Action, type EnvOutput } from "../index.js";
import { Submitted, InterruptAgentFlow } from "../exceptions.js";
import { recursiveMerge } from "../utils/serialize.js";

const execFileAsync = promisify(execFile);

export interface SingularityEnvironmentConfig {
  image: string;
  cwd: string;
  env: Record<string, string>;
  forward_env: string[];
  timeout: number;
  executable: string;
  sandbox_build_retries: number;
  global_args: string[];
  exec_args: string[];
}

export class SingularityEnvironment implements Environment {
  config: Record<string, unknown> = {};
  private cfg!: SingularityEnvironmentConfig;
  private sandboxDir: string | null = null;

  init(config: Record<string, unknown>): void {
    this.cfg = {
      image: config.image as string,
      cwd: (config.cwd as string) ?? "/",
      env: (config.env as Record<string, string>) ?? {},
      forward_env: (config.forward_env as string[]) ?? [],
      timeout: (config.timeout as number) ?? 30,
      executable: (config.executable as string) ?? process.env.MSWEA_SINGULARITY_EXECUTABLE ?? "singularity",
      sandbox_build_retries: (config.sandbox_build_retries as number) ?? 3,
      global_args: (config.global_args as string[]) ?? ["--quiet"],
      exec_args: (config.exec_args as string[]) ?? ["--contain", "--cleanenv", "--fakeroot"],
    };
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  private async _buildSandbox(): Promise<string> {
    const maxRetries = this.cfg.sandbox_build_retries;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const sandboxDir = path.join(os.tmpdir(), `minisweagent-${crypto.randomUUID().slice(0, 8)}`);
      try {
        await execFileAsync(this.cfg.executable, [
          ...this.cfg.global_args, "build", "--sandbox", sandboxDir, this.cfg.image,
        ], { timeout: 120000 });
        return sandboxDir;
      } catch (e) {
        try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch {}
        if (attempt === maxRetries - 1) throw e;
      }
    }
    throw new Error("Failed to build sandbox");
  }

  async execute(action: Action, cwd = ""): Promise<EnvOutput> {
    if (!this.sandboxDir) {
      this.sandboxDir = await this._buildSandbox();
    }
    const command = action.command ?? "";
    const workDir = cwd || this.cfg.cwd;
    const cmd = [this.cfg.executable, ...this.cfg.global_args, "exec", ...this.cfg.exec_args];
    if (workDir && workDir !== "/") {
      cmd.push("--pwd", workDir);
    }
    for (const key of this.cfg.forward_env) {
      const value = process.env[key];
      if (value !== undefined) cmd.push("--env", `${key}=${value}`);
    }
    for (const [key, value] of Object.entries(this.cfg.env)) {
      cmd.push("--env", `${key}=${value}`);
    }
    cmd.push("--writable", this.sandboxDir, "bash", "-c", command);

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
        exception_info: `An error occurred: ${e}`,
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
      kwargs,
    );
  }

  serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          environment: this.cfg,
          environment_type: "SingularityEnvironment",
        },
      },
    };
  }

  cleanup(): void {
    if (this.sandboxDir) {
      try { fs.rmSync(this.sandboxDir, { recursive: true, force: true }); } catch {}
    }
  }
}
