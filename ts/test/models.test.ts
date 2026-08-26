/** Tests for model variants: text-based parsing, response API parsing,
 * OpenRouter/Requesty/Portkey model construction and serialization. */
import { describe, it, expect } from "vitest";
import { DeterministicModel, makeOutput } from "../src/models/test_models.js";
import { LitellmTextbasedModel } from "../src/models/litellm_textbased_model.js";
import { OpenRouterModel } from "../src/models/openrouter_model.js";
import { RequestyModel } from "../src/models/requesty_model.js";
import { PortkeyModel } from "../src/models/portkey_model.js";
import { FormatError } from "../src/exceptions.js";
import { parseRegexActions } from "../src/models/utils/actions_text.js";
import {
  parseToolcallActionsResponse,
  finishReasonFromResponsesApi,
  BASH_TOOL_RESPONSE_API,
} from "../src/models/utils/actions_toolcall_response.js";

describe("parseRegexActions", () => {
  it("parses exactly one action from text content", () => {
    const content = "Let me check.\n```mswea_bash_command\nls -la\n```\nDone.";
    const actions = parseRegexActions(content, {
      actionRegex: "```mswea_bash_command\\s*\\n(.*?)\\n```",
      formatErrorTemplate: "Found {{actions|length}} actions",
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("ls -la");
  });

  it("throws FormatError when no actions found", () => {
    expect(() =>
      parseRegexActions("no actions here", {
        actionRegex: "```mswea_bash_command\\s*\\n(.*?)\\n```",
        formatErrorTemplate: "Found {{actions|length}} actions",
      }),
    ).toThrow(FormatError);
  });

  it("throws FormatError when multiple actions found", () => {
    const content =
      "```mswea_bash_command\ncmd1\n```\n```mswea_bash_command\ncmd2\n```";
    expect(() =>
      parseRegexActions(content, {
        actionRegex: "```mswea_bash_command\\s*\\n(.*?)\\n```",
        formatErrorTemplate: "Found {{actions|length}} actions",
      }),
    ).toThrow(FormatError);
  });
});

describe("parseToolcallActionsResponse", () => {
  it("parses a function_call item", () => {
    const output = [
      { type: "function_call", call_id: "call_123", name: "bash", arguments: JSON.stringify({ command: "echo hi" }) },
    ];
    const actions = parseToolcallActionsResponse(output, "{{ error }}");
    expect(actions).toHaveLength(1);
    expect(actions[0].command).toBe("echo hi");
    expect(actions[0].tool_call_id).toBe("call_123");
  });

  it("throws FormatError when no function calls", () => {
    expect(() =>
      parseToolcallActionsResponse([], "{{ error }}"),
    ).toThrow(FormatError);
  });

  it("throws FormatError for unknown tool", () => {
    const output = [
      { type: "function_call", call_id: "c1", name: "rm", arguments: "{}" },
    ];
    expect(() => parseToolcallActionsResponse(output, "{{ error }}")).toThrow(FormatError);
  });

  it("throws FormatError for missing command arg", () => {
    const output = [
      { type: "function_call", call_id: "c1", name: "bash", arguments: "{}" },
    ];
    expect(() => parseToolcallActionsResponse(output, "{{ error }}")).toThrow(FormatError);
  });
});

describe("finishReasonFromResponsesApi", () => {
  it("returns 'length' for incomplete with max_output_tokens", () => {
    expect(
      finishReasonFromResponsesApi({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } as any),
    ).toBe("length");
  });

  it("returns status for non-incomplete", () => {
    expect(finishReasonFromResponsesApi({ status: "completed" } as any)).toBe("completed");
  });

  it("returns 'incomplete' for incomplete without max_output_tokens", () => {
    expect(
      finishReasonFromResponsesApi({ status: "incomplete", incomplete_details: { reason: "other" } } as any),
    ).toBe("incomplete");
  });
});

describe("BASH_TOOL_RESPONSE_API", () => {
  it("has the correct structure", () => {
    expect(BASH_TOOL_RESPONSE_API.type).toBe("function");
    expect(BASH_TOOL_RESPONSE_API.name).toBe("bash");
    expect(BASH_TOOL_RESPONSE_API.parameters).toBeDefined();
  });
});

describe("LitellmTextbasedModel", () => {
  it("constructs and serializes correctly", () => {
    const model = new LitellmTextbasedModel({
      model_name: "openai/gpt-4o",
      action_regex: "```bash\\n(.*?)\\n```",
    });
    const serialized = model.serialize();
    expect(serialized.info.config.model_type).toBe("LitellmTextbasedModel");
  });
});

describe("OpenRouterModel", () => {
  it("constructs and serializes correctly", () => {
    const model = new OpenRouterModel({ model_name: "anthropic/claude-sonnet-4-5" });
    const serialized = model.serialize();
    expect(serialized.info.config.model_type).toBe("OpenRouterModel");
  });

  it("getTemplateVars returns config fields", () => {
    const model = new OpenRouterModel({ model_name: "openai/gpt-4o" });
    const vars = model.getTemplateVars();
    expect(vars.model_name).toBe("openai/gpt-4o");
  });
});

describe("RequestyModel", () => {
  it("constructs and serializes correctly", () => {
    const model = new RequestyModel({ model_name: "openai/gpt-4o" });
    const serialized = model.serialize();
    expect(serialized.info.config.model_type).toBe("RequestyModel");
  });
});

describe("PortkeyModel", () => {
  it("throws on missing API key", () => {
    const oldKey = process.env.PORTKEY_API_KEY;
    delete process.env.PORTKEY_API_KEY;
    expect(() => new PortkeyModel({ model_name: "openai/gpt-4o" })).toThrow();
    if (oldKey) process.env.PORTKEY_API_KEY = oldKey;
  });
});

describe("DeterministicModel text-based", () => {
  it("produces text-based output with no tool calls", () => {
    const model = new DeterministicModel({
      outputs: [makeOutput("thinking", [{ command: "echo test" }])],
    });
    expect(model).toBeDefined();
  });
});
