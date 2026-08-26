// Package model provides the text-based litellm model variant.
// Ported from src/minisweagent/models/litellm_textbased_model.py
package model

import (
	"context"
	"regexp"
	"strconv"
	"strings"

	"github.com/sashabaranov/go-openai"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model/actions"
)

const defaultActionRegex = "(?s)```mswea_bash_command\\s*\\n(.*?)\\n```"
const defaultTextFormatError = "Please always provide EXACTLY ONE action in triple backticks, found {{actions|length}} actions."

// LitellmTextbasedModel uses regex-based action parsing instead of tool calls.
type LitellmTextbasedModel struct {
	LitellmModel
	actionRegex         *regexp.Regexp
	textFormatErrorTmpl string
}

// NewLitellmTextbasedModel creates a LitellmTextbasedModel from config.
func NewLitellmTextbasedModel(config map[string]any) *LitellmTextbasedModel {
	m := &LitellmTextbasedModel{
		LitellmModel: *NewLitellmModel(config),
	}
	regexStr := defaultActionRegex
	if r, ok := config["action_regex"].(string); ok && r != "" {
		regexStr = r
	}
	m.actionRegex = regexp.MustCompile(regexStr)
	m.textFormatErrorTmpl = defaultTextFormatError
	if t, ok := config["format_error_template"].(string); ok && t != "" {
		m.textFormatErrorTmpl = t
	}
	return m
}

// Query overrides to use text-based action parsing (no tools sent).
func (m *LitellmTextbasedModel) Query(messages []exceptions.Message) (exceptions.Message, error) {
	apiMessages := make([]openai.ChatCompletionMessage, 0, len(messages))
	for _, msg := range messages {
		apiMsg := openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: toStr(msg.Content),
		}
		if msg.ToolCallID != "" {
			apiMsg.ToolCallID = msg.ToolCallID
		}
		apiMessages = append(apiMessages, apiMsg)
	}

	resp, err := m.Client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    m.APIModelName,
		Messages: apiMessages,
	})
	if err != nil {
		return exceptions.Message{}, err
	}

	cost := m.CalculateCost(&resp)
	_ = GlobalModelStatsInstance.Add(cost)

	content := resp.Choices[0].Message.Content
	matches := m.actionRegex.FindAllStringSubmatch(content, -1)
	actionStrs := make([]string, len(matches))
	for i, match := range matches {
		if len(match) > 1 {
			actionStrs[i] = strings.TrimSpace(match[1])
		} else {
			actionStrs[i] = strings.TrimSpace(match[0])
		}
	}

	if len(actionStrs) != 1 {
		errMsg := strings.Replace(m.textFormatErrorTmpl, "{{actions|length}}", strconv.Itoa(len(actionStrs)), 1)
		return exceptions.Message{}, exceptions.NewFormatError(exceptions.Message{
			Role:    "user",
			Content: errMsg,
			Extra:   map[string]any{"interrupt_type": "FormatError", "n_actions": len(actionStrs), "model_response": content},
		})
	}

	actionList := []exceptions.Action{{Command: actionStrs[0]}}

	msg := exceptions.Message{
		Role:    string(resp.Choices[0].Message.Role),
		Content: content,
		Extra: map[string]any{
			"actions":   actionList,
			"cost":      cost,
			"timestamp": float64Time(),
		},
	}
	return msg, nil
}

// FormatObservationMessages uses text-based observation formatting.
func (m *LitellmTextbasedModel) FormatObservationMessages(_ exceptions.Message, outputs []exceptions.EnvOutput, templateVars map[string]any) []exceptions.Message {
	return actions.FormatObservationMessages(outputs, m.ObservationTmpl, templateVars, m.MultimodalRegex)
}

// Serialize returns model state with text-based type.
func (m *LitellmTextbasedModel) Serialize() map[string]any {
	return map[string]any{
		"info": map[string]any{
			"config": map[string]any{
				"model":      m.Config,
				"model_type": "LitellmTextbasedModel",
			},
		},
	}
}
