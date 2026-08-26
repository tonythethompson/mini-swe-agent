/** Local shell environment.
 * Ported from src/minisweagent/environments/local.py */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { type Environment, type Action, type EnvOutput } from "../index.js";
import { Submitted, InterruptAgentFlow } from "../exceptions.js";
import { recursiveMerge } from "../utils/serialize.js";

export interface LocalEnvironmentConfig {
  cwd: string;
  env: Record<string, string>;
  timeout: number;
}

/** Execute a shell command and return stdout+stderr, returncode.
 * Kills the process group on timeout. */
function run(command: string, cwd: string, env: Record<string, string>, timeout: number): Promise<EnvOutput> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "cmd.exe" : "/bin/bash";
    const shellArgs = isWin ? ["/c", command] : ["-c", command];
    const child = spawn(shell, shellArgs, {
      cwd: cwd || undefined,
      env: { ...process.env, ...env } as Record<string, string>,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!isWin) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          // process group may not exist
        }
      }
    }, timeout * 1000);
    child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d) => (stdout += d.toString("utf8")));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output: stdout, returncode: code ?? -1, exception_info: "" });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export class LocalEnvironment implements Environment {
  config: Record<string, unknown> = {};
  private cfg!: LocalEnvironmentConfig;

  init(config: Record<string, unknown>): void {
    this.cfg = {
      cwd: (config.cwd as string) ?? "",
      env: (config.env as Record<string, string>) ?? {},
      timeout: (config.timeout as number) ?? 30,
    };
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  async execute(action: Action, cwd = ""): Promise<EnvOutput> {
    const command = action.command ?? "";
    const workDir = cwd || this.cfg.cwd || process.cwd();
    try {
      const result = await run(command, workDir, { ...this.cfg.env }, this.cfg.timeout);
      this._checkFinished(result);
      return result;
    } catch (e) {
      if (e instanceof InterruptAgentFlow) throw e;
      const err = e as NodeJS.ErrnoException & { output?: string };
      const rawOutput = typeof err.output === "string" ? err.output : "";
      const output: EnvOutput = {
        output: rawOutput,
        returncode: -1,
        exception_info: `An error occurred while executing the command: ${e}`,
        extra: { exception_type: err.constructor?.name ?? "Error", exception: String(e) },
      };
      this._checkFinished(output);
      return output;
    }
  }

  private _checkFinished(output: EnvOutput): void {
    // Match Python's splitlines(keepends=True) to preserve line endings in submission
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
      {
        system: os.platform(),
        release: os.release(),
        version: os.version?.() ?? "",
        machine: os.arch(),
      },
      process.env as Record<string, unknown>,
      kwargs,
    );
  }

  serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          environment: this.cfg,
          environment_type: "LocalEnvironment",
        },
      },
    };
  }
}
