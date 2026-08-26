/** Text-based model (litellm_textbased equivalent).
 * Ported from src/minisweagent/models/litellm_textbased_model.py
 *
 * Uses regex-based action parsing instead of tool calls. */
import type { ChatCompletion } from "openai/resources/chat/completions.js";
import { type Message, type EnvOutput, type Action } from "../index.js";
import { LitellmModel } from "./litellm_model.js";
import { parseRegexActions, formatObservationMessages } from "./utils/actions_text.js";

const DEFAULT_ACTION_REGEX = "```mswea_bash_command\\s*\\n(.*?)\\n```";
const DEFAULT_TEXT_FORMAT_ERROR = "Please always provide EXACTLY ONE action in triple backticks, found {{actions|length}} actions.";

export class LitellmTextbasedModel extends LitellmModel {
  private actionRegex = DEFAULT_ACTION_REGEX;
  private textFormatErrorTemplate = DEFAULT_TEXT_FORMAT_ERROR;

  init(config: Record<string, unknown>): void {
    super.init(config);
    this.actionRegex = (config.action_regex as string) ?? this.actionRegex;
    this.textFormatErrorTemplate = (config.format_error_template as string) ?? this.textFormatErrorTemplate;
  }

  protected override _parseActions(response: ChatCompletion): Action[] {
    const content = response.choices[0].message.content ?? "";
    return parseRegexActions(content, {
      actionRegex: this.actionRegex,
      formatErrorTemplate: this.textFormatErrorTemplate,
      templateKwargs: { finish_reason: response.choices[0].finish_reason },
    });
  }

  override formatObservationMessages(
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

  override serialize(): Record<string, unknown> {
    return {
      info: {
        config: {
          model: this.cfg,
          model_type: "LitellmTextbasedModel",
        },
      },
    };
  }
}
