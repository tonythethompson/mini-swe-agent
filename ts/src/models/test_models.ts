/** Deterministic test models for testing.
 * Ported from src/minisweagent/models/test_models.py */
import { type Model, type Message, type Action, type EnvOutput } from "../index.js";
import { GLOBAL_MODEL_STATS } from "./index.js";
import { formatObservationMessages } from "./utils/actions_text.js";
import { formatToolcallObservationMessages } from "./utils/actions_toolcall.js";
import { expandMultimodalContent } from "./utils/multimodal.js";

const DEFAULT_OBSERVATION_TEMPLATE =
  "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
  "<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>";

export function makeOutput(content: string, actions: Action[], cost = 1.0): Message {
  return {
    role: "assistant",
    content,
    extra: { actions, cost, timestamp: Date.now() / 1000 },
  };
}

export function makeToolcallOutput(
  content: string | null,
  toolCalls: Message["tool_calls"],
  actions: Action[],
): Message {
  return {
    role: "assistant",
    content,
    tool_calls: toolCalls,
    extra: { actions, cost: 1.0, timestamp: Date.now() / 1000 },
  };
}

function processTestActions(actions: Action[]): boolean {
  for (const action of actions) {
    if ("raise" in action) throw (action as unknown as { raise: Error }).raise;
    const cmd = action.command;
    if (cmd.startsWith("/sleep ")) {
      const ms = parseFloat(cmd.split("/sleep ")[1]) * 1000;
      const start = Date.now();
      while (Date.now() - start < ms) {
        // busy wait (sync)
      }
      return true;
    }
    if (cmd.startsWith("/warning")) {
      console.error("[WARN]", cmd.split("/warning")[1]);
      return true;
    }
  }
  return false;
}

interface DeterministicConfig {
  outputs: Message[];
  model_name?: string;
  cost_per_call?: number;
  observation_template?: string;
  multimodal_regex?: string;
}

/** Deterministic model that returns pre-set outputs in sequence. */
export class DeterministicModel implements Model {
  config: Record<string, unknown> = {};
  private cfg!: DeterministicConfig;
  private currentIndex = -1;

  init(config: Record<string, unknown>): void {
    this.cfg = {
      outputs: config.outputs as Message[],
      model_name: (config.model_name as string) ?? "deterministic",
      cost_per_call: (config.cost_per_call as number) ?? 1.0,
      observation_template: (config.observation_template as string) ?? DEFAULT_OBSERVATION_TEMPLATE,
      multimodal_regex: (config.multimodal_regex as string) ?? "",
    };
  }

  constructor(config?: Record<string, unknown>) {
    if (config) {
      this.config = config;
      this.init(config);
    }
  }

  query(_messages: Message[]): Message {
    this.currentIndex += 1;
    const output = this.cfg.outputs[this.currentIndex];
    if (processTestActions((output.extra?.actions as Action[]) ?? [])) {
      return this.query(_messages);
    }
    GLOBAL_MODEL_STATS.add(this.cfg.cost_per_call!);
    return output;
  }

  formatMessage(kwargs: Record<string, unknown>): Message {
    return expandMultimodalContent(kwargs, this.cfg.multimodal_regex!) as Message;
  }

  formatObservationMessages(
    _message: Message,
    outputs: EnvOutput[],
    templateVars?: Record<string, unknown>,
  ): Message[] {
    return formatObservationMessages(outputs, {
      observationTemplate: this.cfg.observation_template!,
      templateVars,
      multimodalRegex: this.cfg.multimodal_regex,
    });
  }

  getTemplateVars(): Record<string, unknown> {
    return { ...this.cfg };
  }

  serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          model: this.cfg,
          model_type: "DeterministicModel",
        },
      },
    };
  }
}
