/** Interactive agent with user-in-the-loop.
 * Ported from src/minisweagent/agents/interactive.py */
import readline from "node:readline";
import chalk from "chalk";
import { type Model, type Environment, type Message } from "../index.js";
import { DefaultAgent, type AgentConfig } from "./default.js";
import { FormatError, LimitsExceeded, Submitted, TimeExceeded, UserInterruption } from "../exceptions.js";
import { getContentString } from "../models/utils/content_string.js";

export interface InteractiveAgentConfig extends AgentConfig {
  mode: "human" | "confirm" | "yolo";
  whitelist_actions: string[];
  confirm_exit: boolean;
}

const DEFAULT_INTERACTIVE_CONFIG: InteractiveAgentConfig = {
  system_template: "",
  instance_template: "",
  step_limit: 0,
  cost_limit: 3.0,
  wall_time_limit_seconds: 0,
  max_consecutive_format_errors: 3,
  output_path: null,
  mode: "confirm",
  whitelist_actions: [],
  confirm_exit: true,
};

const MODE_COMMANDS_MAPPING: Record<string, string> = {
  "/u": "human",
  "/c": "confirm",
  "/y": "yolo",
};

export class InteractiveAgent extends DefaultAgent {
  protected declare cfg: InteractiveAgentConfig;
  protected costLastConfirmed = 0.0;
  private rl: readline.Interface | null = null;

  init(model: Model, env: Environment, config: Record<string, unknown>): void {
    this.cfg = { ...DEFAULT_INTERACTIVE_CONFIG, ...(config as Partial<InteractiveAgentConfig>) };
    this.config = config;
    this.model = model;
    this.env = env;
  }

  private getRL(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    }
    return this.rl;
  }

  protected interrupt(content: string, itype = "UserInterruption"): never {
    throw new UserInterruption({ role: "user", content, extra: { interrupt_type: itype } });
  }

  addMessages(...messages: Message[]): Message[] {
    for (const msg of messages) {
      const role = (msg.role as string) ?? (msg.type as string) ?? "unknown";
      const content = getContentString(msg as unknown as Record<string, unknown>);
      if (role === "assistant") {
        process.stderr.write(
          chalk.red(`\nmini-swe-agent (step ${chalk.bold(this.nCalls)}, ${chalk.bold(`$${this.cost.toFixed(2)}`)}):\n\n`),
        );
      } else {
        process.stderr.write(chalk.green(`\n${role.charAt(0).toUpperCase() + role.slice(1)}:\n\n`));
      }
      process.stderr.write(content + "\n");
    }
    return super.addMessages(...messages);
  }

  async query(): Promise<Message> {
    if (this.cfg.mode === "human") {
      const command = await this.promptAndHandleSlashCommands(chalk.yellow("> "));
      if (command !== "/y" && command !== "/c") {
        const msg: Message = {
          role: "user",
          content: `User command: \n\`\`\`bash\n${command}\n\`\`\``,
          extra: { actions: [{ command }] },
        };
        this.addMessages(msg);
        return msg;
      }
    }
    try {
      return await super.query();
    } catch (e) {
      if (e instanceof TimeExceeded) throw e;
      if (e instanceof LimitsExceeded) {
        if (!this.stdinIsInteractive()) throw e;
        process.stderr.write(
          `Limits exceeded. Limits: ${this.cfg.step_limit} steps, $${this.cfg.cost_limit}.\n` +
            `Current spend: ${this.nCalls} steps, $${this.cost.toFixed(2)}.\n`,
        );
        const newStepLimit = await this.prompt("New step limit: ");
        const newCostLimit = await this.prompt("New cost limit: ");
        this.cfg.step_limit = parseInt(newStepLimit, 10);
        this.cfg.cost_limit = parseFloat(newCostLimit);
        return super.query();
      }
      throw e;
    }
  }

  private static stdinIsInteractive(): boolean {
    return process.stdin.isTTY ?? false;
  }
  private stdinIsInteractive(): boolean {
    return InteractiveAgent.stdinIsInteractive();
  }

  async step(): Promise<Message[]> {
    try {
      process.stderr.write("\n" + "─".repeat(60) + "\n");
      return await super.step();
    } catch (e) {
      if (e instanceof Error && e.name === "KeyboardInterrupt" /* node doesn't throw this normally */) {
        const interruption = (
          await this.promptAndHandleSlashCommands(
            chalk.yellow("\n\nInterrupted. ") +
              chalk.green("Type a comment/command (/h for available commands)") +
              chalk.yellow("\n> "),
          )
        ).trim();
        const msg = !interruption || interruption in MODE_COMMANDS_MAPPING
          ? "Temporary interruption caught."
          : interruption;
        this.interrupt(`Interrupted by user: ${msg}`);
      }
      throw e;
    }
  }

  async executeActions(message: Message): Promise<Message[]> {
    const actions = (message.extra?.actions as { command: string }[]) ?? [];
    const commands = actions.map((a) => a.command);
    const outputs = [];
    try {
      await this.askConfirmationOrInterrupt(commands);
      for (const action of actions) {
        outputs.push(await this.env.execute(action));
      }
    } catch (e) {
      if (e instanceof Submitted) {
        this.checkForNewTaskOrSubmit(e);
      }
      throw e;
    } finally {
      const result = this.addMessages(
        ...this.model.formatObservationMessages(message, outputs, this.getTemplateVars()),
      );
      return result;
    }
  }

  private checkForNewTaskOrSubmit(e: Submitted): never {
    if (this.cfg.confirm_exit) {
      this.promptAndHandleSlashCommands(
        chalk.yellow("Agent wants to finish. ") +
          chalk.green("Type new task") +
          " or Enter to quit (/h for commands)\n" +
          chalk.yellow("> "),
      ).then((userInput) => {
        const input = userInput.trim();
        if (input === "/u") this.interrupt("Switched to human mode.");
        else if (input in MODE_COMMANDS_MAPPING) return this.checkForNewTaskOrSubmit(e);
        else if (input) this.interrupt(`The user added a new task: ${input}`, "UserNewTask");
      });
    }
    throw e;
  }

  private shouldAskConfirmation(action: string): boolean {
    if (this.cfg.mode !== "confirm") return false;
    return !this.cfg.whitelist_actions.some((r) => new RegExp(r).test(action));
  }

  private async askConfirmationOrInterrupt(commands: string[]): Promise<void> {
    if (!commands.some((c) => this.shouldAskConfirmation(c))) return;
    const prompt =
      chalk.yellow(`Execute ${commands.length} action(s)? `) +
      chalk.green("Enter to confirm") + ", " +
      chalk.red("type comment to reject") + ", or " +
      chalk.blue("/h to show available commands") + "\n" +
      chalk.yellow("> ");
    const userInput = (await this.promptAndHandleSlashCommands(prompt)).trim();
    if (userInput === "" || userInput === "/y") return;
    if (userInput === "/u") {
      this.interrupt("Commands not executed. Switching to human mode", "UserRejection");
    }
    this.interrupt(
      `Commands not executed. The user rejected your commands with the following message: ${userInput}`,
      "UserRejection",
    );
  }

  private async promptAndHandleSlashCommands(prompt: string, multiline = false): Promise<string> {
    process.stderr.write(prompt);
    if (multiline) {
      return this.multilinePrompt();
    }
    const userInput = await this.prompt("");
    if (userInput === "/m") return this.promptAndHandleSlashCommands(prompt, true);
    if (userInput === "/h") {
      process.stderr.write(
        `Current mode: ${chalk.green(this.cfg.mode)}\n` +
          `${chalk.green("/y")} to switch to yolo mode\n` +
          `${chalk.green("/c")} to switch to confirmation mode\n` +
          `${chalk.green("/u")} to switch to human mode\n` +
          `${chalk.green("/m")} to enter multiline comment\n`,
      );
      return this.promptAndHandleSlashCommands(prompt);
    }
    if (userInput in MODE_COMMANDS_MAPPING) {
      if (this.cfg.mode === MODE_COMMANDS_MAPPING[userInput]) {
        return this.promptAndHandleSlashCommands(chalk.red(`Already in ${this.cfg.mode} mode.\n`) + prompt);
      }
      this.cfg.mode = MODE_COMMANDS_MAPPING[userInput] as InteractiveAgentConfig["mode"];
      process.stderr.write(`Switched to ${chalk.green(this.cfg.mode)} mode.\n`);
      return userInput;
    }
    return userInput;
  }

  private async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = this.getRL();
      rl.question(question, (answer) => resolve(answer));
    });
  }

  private async multilinePrompt(): Promise<string> {
    const lines: string[] = [];
    return new Promise((resolve) => {
      const rl = this.getRL();
      const onData = (line: string) => {
        if (line === "") {
          rl.off("line", onData);
          resolve(lines.join("\n"));
        } else {
          lines.push(line);
        }
      };
      rl.on("line", onData);
    });
  }
}
