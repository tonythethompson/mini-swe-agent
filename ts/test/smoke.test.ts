/** Smoke test: run the agent loop end-to-end with a deterministic model.
 * Verifies the core control flow: system/instance templates, query, parse actions,
 * execute in local env, observation messages, submit on COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT. */
import { describe, it, expect } from "vitest";
import { DefaultAgent } from "../src/agents/default.js";
import { LocalEnvironment } from "../src/environments/local.js";
import { DeterministicModel, makeOutput } from "../src/models/test_models.js";

describe("DefaultAgent end-to-end", () => {
  it("runs a full trajectory and submits", async () => {
    const model = new DeterministicModel({
      outputs: [
        makeOutput("Let me check the directory", [{ command: "echo hello" }]),
        makeOutput("Done", [{ command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT&&echo my submission" }]),
      ],
    });
    const env = new LocalEnvironment({ cwd: process.cwd() });
    const agent = new DefaultAgent(model, env, {
      system_template: "You are a helpful assistant.",
      instance_template: "Solve: {{task}}",
      step_limit: 0,
      cost_limit: 0,
      max_consecutive_format_errors: 3,
    });
    const result = await agent.run("test task");
    expect(result.exit_status).toBe("Submitted");
    expect((result.submission as string).trim()).toBe("my submission");
    expect(agent.nCalls).toBe(2);
    expect(agent.cost).toBe(2.0);
  });

  it("hits LimitsExceeded when cost_limit is reached", async () => {
    const model = new DeterministicModel({
      outputs: [
        makeOutput("step 1", [{ command: "echo a" }]),
        makeOutput("step 2", [{ command: "echo b" }]),
      ],
    });
    const env = new LocalEnvironment({});
    const agent = new DefaultAgent(model, env, {
      system_template: "sys",
      instance_template: "task: {{task}}",
      cost_limit: 1.0,
      max_consecutive_format_errors: 3,
    });
    const result = await agent.run("t");
    expect(result.exit_status).toBe("LimitsExceeded");
  });

  it("handles step_limit correctly", async () => {
    const model = new DeterministicModel({
      outputs: [
        makeOutput("step 1", [{ command: "echo a" }]),
        makeOutput("step 2", [{ command: "echo b" }]),
        makeOutput("step 3", [{ command: "echo c" }]),
      ],
    });
    const env = new LocalEnvironment({});
    const agent = new DefaultAgent(model, env, {
      system_template: "sys",
      instance_template: "task: {{task}}",
      step_limit: 2,
      cost_limit: 0,
      max_consecutive_format_errors: 3,
    });
    const result = await agent.run("t");
    expect(result.exit_status).toBe("LimitsExceeded");
    expect(agent.nCalls).toBe(2);
  });

  it("serializes trajectory correctly", async () => {
    const model = new DeterministicModel({
      outputs: [makeOutput("done", [{ command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" }])],
    });
    const env = new LocalEnvironment({});
    const agent = new DefaultAgent(model, env, {
      system_template: "sys",
      instance_template: "task: {{task}}",
      cost_limit: 0,
    });
    await agent.run("t");
    const data = agent.serialize();
    expect(data.trajectory_format).toBe("mini-swe-agent-1.1");
    expect((data.info as Record<string, unknown>).exit_status).toBe("Submitted");
    expect(Array.isArray(data.messages)).toBe(true);
  });
});

describe("recursiveMerge", () => {
  it("merges nested dicts with later taking precedence", async () => {
    const { recursiveMerge, UNSET } = await import("../src/utils/serialize.js");
    const result = recursiveMerge(
      { a: 1, b: { c: 2, d: 3 } },
      { b: { d: 4, e: 5 }, f: UNSET },
    );
    expect(result).toEqual({ a: 1, b: { c: 2, d: 4, e: 5 } });
  });
});

describe("config spec parsing", () => {
  it("parses key=value specs into nested dicts", async () => {
    const { keyValueSpecToNestedDict } = await import("../src/config/index.js");
    expect(keyValueSpecToNestedDict("model.model_name=anthropic/claude")).toEqual({
      model: { model_name: "anthropic/claude" },
    });
    expect(keyValueSpecToNestedDict("agent.cost_limit=3.5")).toEqual({
      agent: { cost_limit: 3.5 },
    });
  });
});
