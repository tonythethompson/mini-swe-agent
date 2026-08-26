/** Shared model interface, separated from index.ts to avoid circular imports. */
export interface Model {
  config: Record<string, unknown>;
  query(messages: import("./exceptions.js").Message[], kwargs?: Record<string, unknown>): Promise<import("./exceptions.js").Message> | import("./exceptions.js").Message;
  formatMessage(kwargs: Record<string, unknown>): import("./exceptions.js").Message;
  formatObservationMessages(
    message: import("./exceptions.js").Message,
    outputs: import("./exceptions.js").EnvOutput[],
    templateVars?: Record<string, unknown>,
  ): import("./exceptions.js").Message[];
  getTemplateVars(kwargs?: Record<string, unknown>): Record<string, unknown>;
  serialize(): Record<string, unknown>;
}
