// Package model provides the Portkey model.
// Ported from src/minisweagent/models/portkey_model.py
package model

import (
	"context"
	"fmt"
	"os"

	"github.com/sashabaranov/go-openai"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model/actions"
)

// PortkeyModel uses the OpenAI SDK with Portkey's OpenAI-compatible endpoint.
type PortkeyModel struct {
	Config          map[string]any
	modelName       string
	modelKwargs     map[string]any
	setCacheControl string
	costTracking    string
	formatErrorTmpl string
	observationTmpl string
	multimodalRegex string
	provider        string
	client          *openai.Client
}

// NewPortkeyModel creates a PortkeyModel from config.
func NewPortkeyModel(config map[string]any) *PortkeyModel {
	m := &PortkeyModel{
		Config:          config,
		modelName:       getStr(config, "model_name", ""),
		modelKwargs:     getMap(config, "model_kwargs"),
		setCacheControl: getStr(config, "set_cache_control", ""),
		costTracking:    getStr(config, "cost_tracking", "default"),
		formatErrorTmpl: getStr(config, "format_error_template", "{{ error }}"),
		observationTmpl: getStr(config, "observation_template", openrouterDefaultObservation),
		multimodalRegex: getStr(config, "multimodal_regex", ""),
		provider:        getStr(config, "provider", ""),
	}

	apiKey := os.Getenv("PORTKEY_API_KEY")
	if apiKey == "" {
		return m
	}

	cfg := openai.DefaultConfig(apiKey)
	cfg.BaseURL = "https://api.portkey.ai/v1"
	m.client = openai.NewClientWithConfig(cfg)
	return m
}

// GetConfig returns the model config.
func (m *PortkeyModel) GetConfig() map[string]any { return m.Config }

// Query queries the Portkey API via OpenAI SDK.
func (m *PortkeyModel) Query(messages []exceptions.Message) (exceptions.Message, error) {
	if m.client == nil {
		return exceptions.Message{}, fmt.Errorf("Portkey API key required. Set PORTKEY_API_KEY env var")
	}
	apiMessages := make([]openai.ChatCompletionMessage, 0, len(messages))
	for _, msg := range messages {
		apiMsg := openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: toStr(msg.Content),
		}
		if msg.ToolCallID != "" {
			apiMsg.ToolCallID = msg.ToolCallID
		}
		if len(msg.ToolCalls) > 0 {
			for _, tc := range msg.ToolCalls {
				apiMsg.ToolCalls = append(apiMsg.ToolCalls, openai.ToolCall{
					ID:   tc.ID,
					Type: openai.ToolTypeFunction,
					Function: openai.FunctionCall{
						Name:      tc.Function.Name,
						Arguments: tc.Function.Arguments,
					},
				})
			}
		}
		apiMessages = append(apiMessages, apiMsg)
	}

	tools := []openai.Tool{{
		Type: openai.ToolTypeFunction,
		Function: &openai.FunctionDefinition{
			Name:        "bash",
			Description: "Execute a bash command",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{"type": "string", "description": "The bash command to execute"},
				},
				"required": []string{"command"},
			},
		},
	}}

	resp, err := m.client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    m.modelName,
		Messages: apiMessages,
		Tools:    tools,
	})
	if err != nil {
		return exceptions.Message{}, err
	}

	cost := m.CalculateCost(&resp)
	_ = GlobalModelStatsInstance.Add(cost)

	choice := resp.Choices[0]
	var toolCalls []exceptions.ToolCall
	for _, tc := range choice.Message.ToolCalls {
		toolCalls = append(toolCalls, exceptions.ToolCall{
			ID:   tc.ID,
			Type: string(tc.Type),
			Function: struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			}{tc.Function.Name, tc.Function.Arguments},
		})
	}

	actionList, err := actions.ParseToolcallActions(toolCalls, m.formatErrorTmpl, map[string]any{
		"finish_reason": string(choice.FinishReason),
	})
	if err != nil {
		if fe, ok := err.(*exceptions.FormatError); ok {
			if len(fe.Messages) > 0 {
				if fe.Messages[0].Extra == nil {
					fe.Messages[0].Extra = map[string]any{}
				}
				fe.Messages[0].Extra["cost"] = cost
			}
		}
		return exceptions.Message{}, err
	}

	return exceptions.Message{
		Role:      string(choice.Message.Role),
		Content:   choice.Message.Content,
		ToolCalls: toolCalls,
		Extra: map[string]any{
			"actions":   actionList,
			"cost":      cost,
			"timestamp": float64Time(),
		},
	}, nil
}

// CalculateCost calculates the cost from a response.
func (m *PortkeyModel) CalculateCost(resp *openai.ChatCompletionResponse) float64 {
	if resp.Usage.PromptTokens == 0 && resp.Usage.CompletionTokens == 0 {
		return 0.0
	}
	return float64(resp.Usage.PromptTokens)*0.15/1e6 + float64(resp.Usage.CompletionTokens)*0.6/1e6
}

// FormatMessage formats a message.
func (m *PortkeyModel) FormatMessage(kwargs map[string]any) exceptions.Message {
	role := getStr(kwargs, "role", "user")
	content := kwargs["content"]
	msg := exceptions.Message{Role: role, Content: content}
	if extra, ok := kwargs["extra"]; ok {
		if em, ok := extra.(map[string]any); ok {
			msg.Extra = em
		}
	}
	return msg
}

// FormatObservationMessages formats execution outputs.
func (m *PortkeyModel) FormatObservationMessages(message exceptions.Message, outputs []exceptions.EnvOutput, templateVars map[string]any) []exceptions.Message {
	var actionList []exceptions.Action
	if message.Extra != nil {
		if actionsRaw, ok := message.Extra["actions"]; ok {
			if actionsSlice, ok := actionsRaw.([]exceptions.Action); ok {
				actionList = actionsSlice
			}
		}
	}
	return actions.FormatToolcallObservationMessages(actionList, outputs, m.observationTmpl, templateVars, m.multimodalRegex)
}

// GetTemplateVars returns template variables.
func (m *PortkeyModel) GetTemplateVars() map[string]any {
	return map[string]any{
		"model_name":            m.modelName,
		"model_kwargs":          m.modelKwargs,
		"set_cache_control":     m.setCacheControl,
		"cost_tracking":         m.costTracking,
		"format_error_template": m.formatErrorTmpl,
		"observation_template":  m.observationTmpl,
		"multimodal_regex":      m.multimodalRegex,
		"provider":              m.provider,
	}
}

// Serialize returns the model state.
func (m *PortkeyModel) Serialize() map[string]any {
	return map[string]any{
		"info": map[string]any{
			"config": map[string]any{
				"model":      m.Config,
				"model_type": "PortkeyModel",
			},
		},
	}
}
