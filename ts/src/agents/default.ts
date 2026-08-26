/** Basic agent class.
 * Ported from src/minisweagent/agents/default.py */
import fs from "node:fs";
import path from "node:path";
import nunjucks from "nunjucks";
import { type Agent, type Model, type Environment, type Message } from "../index.js";
import { __version__ } from "../index.js";
import { FormatError, InterruptAgentFlow, LimitsExceeded, TimeExceeded } from "../exceptions.js";
import { recursiveMerge } from "../utils/serialize.js";

export interface AgentConfig {
  system_template: string;
  instance_template: string;
  step_limit: number;
  cost_limit: number;
  wall_time_limit_seconds: number;
  max_consecutive_format_errors: number;
  output_path: string | null;
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  system_template: "",
  instance_template: "",
  step_limit: 0,
  cost_limit: 3.0,
  wall_time_limit_seconds: 0,
  max_consecutive_format_errors: 3,
  output_path: null,
};

nunjucks.configure({ autoescape: false });

export class DefaultAgent implements Agent {
  config: Record<string, unknown> = {};
  protected cfg!: AgentConfig;
  messages: Message[] = [];
  protected model!: Model;
  protected env!: Environment;
  protected extraTemplateVars: Record<string, unknown> = {};
  cost = 0.0;
  nCalls = 0;
  protected nConsecutiveFormatErrors = 0;
  protected startTime = Date.now();

  init(model: Model, env: Environment, config: Record<string, unknown>): void {
    this.cfg = { ...DEFAULT_AGENT_CONFIG, ...(config as Partial<AgentConfig>) };
    this.config = config;
    this.model = model;
    this.env = env;
  }

  constructor(model?: Model, env?: Environment, config?: Record<string, unknown>) {
    if (model && env && config) {
      this.init(model, env, config);
    }
  }

  getTemplateVars(kwargs: Record<string, unknown> = {}): Record<string, unknown> {
    return recursiveMerge(
      this.cfg as unknown as Record<string, unknown>,
      this.env.getTemplateVars(),
      this.model.getTemplateVars(),
      {
        n_model_calls: this.nCalls,
        model_cost: this.cost,
        elapsed_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      },
      this.extraTemplateVars,
      kwargs,
    );
  }

  protected renderTemplate(template: string): string {
    return nunjucks.renderString(template, this.getTemplateVars());
  }

  addMessages(...messages: Message[]): Message[] {
    this.messages.push(...messages);
    return messages;
  }

  handleUncaughtException(e: Error): Message[] {
    return this.addMessages(
      this.model.formatMessage({
        role: "exit",
        content: String(e),
        extra: {
          exit_status: e.constructor.name,
          submission: "",
          exception_str: String(e),
          traceback: e.stack ?? "",
        },
      }),
    );
  }

  async run(task = "", kwargs: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.extraTemplateVars = { ...this.extraTemplateVars, task, ...kwargs };
    this.messages = [];
    this.addMessages(
      this.model.formatMessage({ role: "system", content: this.renderTemplate(this.cfg.system_template) }),
      this.model.formatMessage({ role: "user", content: this.renderTemplate(this.cfg.instance_template) }),
    );
    while (true) {
      try {
        await this.step();
        this.nConsecutiveFormatErrors = 0;
      } catch (e) {
        if (e instanceof FormatError) {
          const cost = (e.messages[0].extra?.cost as number) ?? 0.0;
          this.cost += cost;
          this.nConsecutiveFormatErrors += 1;
          if (
            this.cfg.max_consecutive_format_errors > 0 &&
            this.nConsecutiveFormatErrors >= this.cfg.max_consecutive_format_errors
          ) {
            this.addMessages(
              ...e.messages,
              {
                role: "exit",
                content: "RepeatedFormatError",
                extra: { exit_status: "RepeatedFormatError", submission: "" },
              },
            );
          } else {
            this.addMessages(...e.messages);
          }
        } else if (e instanceof InterruptAgentFlow) {
          this.addMessages(...e.messages);
        } else {
          this.handleUncaughtException(e as Error);
          throw e;
        }
      } finally {
        this.save(this.cfg.output_path);
      }
      if (this.messages[this.messages.length - 1]?.role === "exit") break;
    }
    return (this.messages[this.messages.length - 1]?.extra ?? {}) as Record<string, unknown>;
  }

  async step(): Promise<Message[]> {
    return this.executeActions(await this.query());
  }

  async query(): Promise<Message> {
    if (
      (this.cfg.step_limit > 0 && this.cfg.step_limit <= this.nCalls) ||
      (this.cfg.cost_limit > 0 && this.cfg.cost_limit <= this.cost)
    ) {
      throw new LimitsExceeded({
        role: "exit",
        content: "LimitsExceeded",
        extra: { exit_status: "LimitsExceeded", submission: "" },
      });
    }
    if (
      this.cfg.wall_time_limit_seconds > 0 &&
      this.cfg.wall_time_limit_seconds <= Math.floor((Date.now() - this.startTime) / 1000)
    ) {
      throw new TimeExceeded({
        role: "exit",
        content: "TimeExceeded",
        extra: { exit_status: "TimeExceeded", submission: "" },
      });
    }
    this.nCalls += 1;
    const message = await this.model.query(this.messages);
    this.cost += (message.extra?.cost as number) ?? 0.0;
    this.addMessages(message);
    return message;
  }

  async executeActions(message: Message): Promise<Message[]> {
    const actions = (message.extra?.actions as Parameters<Environment["execute"]>[0][]) ?? [];
    const outputs = [];
    for (const action of actions) {
      outputs.push(await this.env.execute(action));
    }
    return this.addMessages(
      ...this.model.formatObservationMessages(message, outputs, this.getTemplateVars()),
    );
  }

  serialize(...extraDicts: Record<string, unknown>[]): Record<string, unknown> {
    const lastMessage = this.messages[this.messages.length - 1] ?? ({} as Message);
    const lastExtra = (lastMessage.extra ?? {}) as Record<string, unknown>;
    const agentData: Record<string, unknown> = {
      info: {
        model_stats: { instance_cost: this.cost, api_calls: this.nCalls },
        config: { agent: this.cfg, agent_type: "DefaultAgent" },
        mini_version: __version__,
        exit_status: lastExtra.exit_status ?? "",
        submission: lastExtra.submission ?? "",
      },
      messages: this.messages,
      trajectory_format: "mini-swe-agent-1.1",
    };
    return recursiveMerge(agentData, this.model.serialize(), this.env.serialize(), ...extraDicts);
  }

  save(filePath: string | null, ...extraDicts: Record<string, unknown>[]): Record<string, unknown> {
    const data = this.serialize(...extraDicts);
    if (filePath) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
    return data;
  }
}
