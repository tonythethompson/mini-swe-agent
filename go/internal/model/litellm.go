// Package model provides model implementations.
// Ported from src/minisweagent/models/litellm_model.py
package model

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model/actions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/utils/jinja"
)

func ctx() context.Context {
	return context.Background()
}

func float64Time() float64 {
	return float64(time.Now().UnixNano()) / 1e9
}

const defaultObservationTemplate = "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
	"<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>"

const defaultFormatErrorTemplate = "{{ error }}"

// GlobalModelStats tracks global model statistics with optional limits.
type GlobalModelStats struct {
	cost      float64
	nCalls    int
	CostLimit float64
	CallLimit int
}

// NewGlobalModelStats creates a GlobalModelStats from env vars.
func NewGlobalModelStats() *GlobalModelStats {
	return &GlobalModelStats{}
}

// Add adds a model call with its cost, checking limits.
func (g *GlobalModelStats) Add(cost float64) error {
	g.cost += cost
	g.nCalls++
	if (g.CostLimit > 0 && g.CostLimit < g.cost) || (g.CallLimit > 0 && g.CallLimit < g.nCalls) {
		return fmt.Errorf("global cost/call limit exceeded: $%.4f / %d", g.cost, g.nCalls)
	}
	return nil
}

// Cost returns the total cost.
func (g *GlobalModelStats) Cost() float64 { return g.cost }

// NCalls returns the total number of calls.
func (g *GlobalModelStats) NCalls() int { return g.nCalls }

// GlobalModelStatsInstance is the shared global stats tracker.
var GlobalModelStatsInstance = NewGlobalModelStats()

// LitellmModel is an OpenAI-compatible model.
type LitellmModel struct {
	Config          map[string]any
	ModelName       string
	modelKwargs     map[string]any
	setCacheControl string
	costTracking    string
	FormatErrorTmpl string
	ObservationTmpl string
	MultimodalRegex string
	Client          *openai.Client
	APIModelName    string
}

// NewLitellmModel creates a LitellmModel from config.
func NewLitellmModel(config map[string]any) *LitellmModel {
	m := &LitellmModel{Config: config}
	m.init(config)
	return m
}

func (m *LitellmModel) init(config map[string]any) {
	m.ModelName = getStr(config, "model_name", "")
	m.modelKwargs = getMap(config, "model_kwargs")
	m.setCacheControl = getStr(config, "set_cache_control", "")
	m.costTracking = getStr(config, "cost_tracking", "default")
	m.FormatErrorTmpl = getStr(config, "format_error_template", defaultFormatErrorTemplate)
	m.ObservationTmpl = getStr(config, "observation_template", defaultObservationTemplate)
	m.MultimodalRegex = getStr(config, "multimodal_regex", "")

	// Resolve provider
	baseURL, apiKey := resolveProvider(m.ModelName)
	m.APIModelName = stripProvider(m.ModelName)

	cfg := openai.DefaultConfig(apiKey)
	if baseURL != "" {
		cfg.BaseURL = baseURL
	}
	m.Client = openai.NewClientWithConfig(cfg)
}

func resolveProvider(modelName string) (baseURL, apiKey string) {
	lower := strings.ToLower(modelName)
	switch {
	case strings.HasPrefix(lower, "openrouter/"):
		return "https://openrouter.ai/api/v1", os.Getenv("OPENROUTER_API_KEY")
	case strings.HasPrefix(lower, "anthropic/"):
		return "https://api.anthropic.com/v1/openai", os.Getenv("ANTHROPIC_API_KEY")
	case strings.HasPrefix(lower, "gemini/"):
		return "https://generativelanguage.googleapis.com/v1beta/openai", os.Getenv("GEMINI_API_KEY")
	case strings.HasPrefix(lower, "requesty/"):
		return "https://api.requesty.ai/v1", os.Getenv("REQUESTY_API_KEY")
	case strings.HasPrefix(lower, "portkey/"):
		return "https://api.portkey.ai/v1", os.Getenv("PORTKEY_API_KEY")
	default:
		return "", os.Getenv("OPENAI_API_KEY")
	}
}

func stripProvider(modelName string) string {
	idx := strings.Index(modelName, "/")
	if idx == -1 {
		return modelName
	}
	return modelName[idx+1:]
}

// GetConfig returns the model config.
func (m *LitellmModel) GetConfig() map[string]any { return m.Config }

// Query queries the model and returns a message.
func (m *LitellmModel) Query(messages []exceptions.Message) (exceptions.Message, error) {
	// Prepare messages for API
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
					"command": map[string]any{
						"type":        "string",
						"description": "The bash command to execute",
					},
				},
				"required": []string{"command"},
			},
		},
	}}

	resp, err := m.Client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    m.APIModelName,
		Messages: apiMessages,
		Tools:    tools,
	})
	if err != nil {
		return exceptions.Message{}, err
	}

	cost := m.CalculateCost(&resp)
	_ = GlobalModelStatsInstance.Add(cost)

	// Parse actions
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

	actionList, err := actions.ParseToolcallActions(toolCalls, m.FormatErrorTmpl, map[string]any{
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

	msg := exceptions.Message{
		Role:      string(choice.Message.Role),
		Content:   choice.Message.Content,
		ToolCalls: toolCalls,
		Extra: map[string]any{
			"actions":   actionList,
			"cost":      cost,
			"timestamp": float64(time.Now().UnixNano()) / 1e9,
		},
	}
	return msg, nil
}

func (m *LitellmModel) CalculateCost(resp *openai.ChatCompletionResponse) float64 {
	// In go-openai v1.x, Usage is a struct (not a pointer)
	// Zero values mean no usage data
	if resp.Usage.PromptTokens == 0 && resp.Usage.CompletionTokens == 0 {
		return 0.0
	}
	// Rough cost estimate
	cost := float64(resp.Usage.PromptTokens)*0.15/1e6 + float64(resp.Usage.CompletionTokens)*0.6/1e6
	return cost
}

// FormatMessage formats a message, expanding multimodal content if configured.
func (m *LitellmModel) FormatMessage(kwargs map[string]any) exceptions.Message {
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

// FormatObservationMessages formats execution outputs into tool result messages.
func (m *LitellmModel) FormatObservationMessages(message exceptions.Message, outputs []exceptions.EnvOutput, templateVars map[string]any) []exceptions.Message {
	var actionList []exceptions.Action
	if message.Extra != nil {
		if actionsRaw, ok := message.Extra["actions"]; ok {
			if actionsSlice, ok := actionsRaw.([]exceptions.Action); ok {
				actionList = actionsSlice
			}
		}
	}
	return actions.FormatToolcallObservationMessages(actionList, outputs, m.ObservationTmpl, templateVars, m.MultimodalRegex)
}

// GetTemplateVars returns the model config as template variables.
func (m *LitellmModel) GetTemplateVars() map[string]any {
	return map[string]any{
		"model_name":            m.ModelName,
		"model_kwargs":          m.modelKwargs,
		"set_cache_control":     m.setCacheControl,
		"cost_tracking":         m.costTracking,
		"format_error_template": m.FormatErrorTmpl,
		"observation_template":  m.ObservationTmpl,
		"multimodal_regex":      m.MultimodalRegex,
	}
}

// Serialize returns the model state for trajectory saving.
func (m *LitellmModel) Serialize() map[string]any {
	return map[string]any{
		"info": map[string]any{
			"config": map[string]any{
				"model":      m.Config,
				"model_type": "LitellmModel",
			},
		},
	}
}

func getStr(m map[string]any, key, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

func getMap(m map[string]any, key string) map[string]any {
	if v, ok := m[key]; ok {
		if mp, ok := v.(map[string]any); ok {
			return mp
		}
	}
	return map[string]any{}
}

func toStr(v any) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case fmt.Stringer:
		return val.String()
	default:
		return fmt.Sprintf("%v", v)
	}
}

// Ensure jinja is imported
var _ = jinja.Render
