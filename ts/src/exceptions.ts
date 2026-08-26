/** Exceptions used to interrupt the agent control flow.
 * Ported from src/minisweagent/exceptions.py */
export class InterruptAgentFlow extends Error {
  messages: Message[];
  constructor(...messages: Message[]) {
    super();
    this.messages = messages;
  }
}

export class Submitted extends InterruptAgentFlow {
  /** Raised when the agent has completed its task. */
}

export class LimitsExceeded extends InterruptAgentFlow {
  /** Raised when the agent has exceeded its cost or step limit. */
}

export class TimeExceeded extends LimitsExceeded {
  /** Raised when the agent has exceeded its wall-clock time limit. */
}

export class UserInterruption extends InterruptAgentFlow {
  /** Raised when the user interrupts the agent. */
}

export class FormatError extends InterruptAgentFlow {
  /** Raised when the LM's output is not in the expected format. */
}

/** A message in the agent's conversation history.
 * Mirrors the Python dict-based message format with an optional `extra` bag. */
export interface Message {
  role: string;
  content: unknown;
  extra?: Record<string, unknown>;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

/** An action parsed from the model's output, to be executed by the environment. */
export interface Action {
  command: string;
  tool_call_id?: string;
}

/** Output of executing an action in an environment. */
export interface EnvOutput {
  output: string;
  returncode: number;
  exception_info: string;
  extra?: Record<string, unknown>;
}
