/** Tests for environments: local env execution, submission detection,
 * Singularity env construction, and Docker env construction. */
import { describe, it, expect } from "vitest";
import { LocalEnvironment } from "../src/environments/local.js";
import { DockerEnvironment } from "../src/environments/docker.js";
import { SingularityEnvironment } from "../src/environments/singularity.js";
import { Submitted } from "../src/exceptions.js";

describe("LocalEnvironment", () => {
  it("executes a simple command", async () => {
    const env = new LocalEnvironment({});
    const output = await env.execute({ command: "echo hello" }, "");
    expect(output.returncode).toBe(0);
    expect((output.output as string).trim()).toBe("hello");
  });

  it("captures non-zero return code", async () => {
    const env = new LocalEnvironment({});
    const output = await env.execute({ command: "exit 42" }, "");
    expect(output.returncode).toBe(42);
  });

  it("detects COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT and throws Submitted", async () => {
    const env = new LocalEnvironment({});
    await expect(
      env.execute({ command: "echo COMPLETE_TASK_AND_SUBMIT_FINALOLUTION" }, ""),
    ).resolves.toBeDefined();
    // The above command won't trigger because it's not the exact marker.
    // Test the actual marker:
    await expect(
      env.execute({ command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT&&echo my sub" }, ""),
    ).rejects.toThrow(Submitted);
  });

  it("serializes correctly", () => {
    const env = new LocalEnvironment({ cwd: "/tmp" });
    const serialized = env.serialize();
    expect(serialized.info.config.environment_type).toBe("LocalEnvironment");
  });

  it("provides template vars", () => {
    const env = new LocalEnvironment({ cwd: "/tmp" });
    const vars = env.getTemplateVars();
    expect(vars).toBeDefined();
  });
});

describe("DockerEnvironment", () => {
  it("constructs and serializes correctly", () => {
    const env = new DockerEnvironment({ image: "ubuntu:latest" });
    const serialized = env.serialize();
    expect(serialized.info.config.environment_type).toBe("DockerEnvironment");
  });

  it("getTemplateVars returns config", () => {
    const env = new DockerEnvironment({ image: "ubuntu:latest", cwd: "/app" });
    const vars = env.getTemplateVars();
    expect(vars).toBeDefined();
  });
});

describe("SingularityEnvironment", () => {
  it("constructs and serializes correctly", () => {
    const env = new SingularityEnvironment({ image: "docker://ubuntu:latest" });
    const serialized = env.serialize();
    expect(serialized.info.config.environment_type).toBe("SingularityEnvironment");
  });

  it("getTemplateVars returns config", () => {
    const env = new SingularityEnvironment({ image: "docker://ubuntu:latest", cwd: "/" });
    const vars = env.getTemplateVars();
    expect(vars).toBeDefined();
  });
});
