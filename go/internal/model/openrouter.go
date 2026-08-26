// Package model provides the OpenRouter model (raw HTTP).
// Ported from src/minisweagent/models/openrouter_model.py
package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model/actions"
)

const openrouterDefaultObservation = "{% if output.exception_info %}<exception>{{output.exception_info}}</exception>\n{% endif %}" +
	"<returncode>{{output.returncode}}</returncode>\n<output>\n{{output.output}}</output>"

var bashToolOpenRouter = map[string]any{
	"type":     "function",
	"function": map[string]any{"name": "bash", "description": "Execute a bash command", "parameters": map[string]any{"type": "object", "properties": map[string]any{"command": map[string]any{"type": "string", "description": "The bash command to execute"}}, "required": []string{"command"}}},
}

// OpenRouterModel makes direct HTTP requests to the OpenRouter API.
type OpenRouterModel struct {
	Config          map[string]any
	modelName       string
	modelKwargs     map[string]any
	setCacheControl string
	costTracking    string
	formatErrorTmpl string
	observationTmpl string
	multimodalRegex string
	apiKey          string
	apiURL          string
}

// NewOpenRouterModel creates an OpenRouterModel from config.
func NewOpenRouterModel(config map[string]any) *OpenRouterModel {
	m := &OpenRouterModel{
		Config:          config,
		modelName:       getStr(config, "model_name", ""),
		modelKwargs:     getMap(config, "model_kwargs"),
		setCacheControl: getStr(config, "set_cache_control", ""),
		costTracking:    getStr(config, "cost_tracking", "default"),
		formatErrorTmpl: getStr(config, "format_error_template", "{{ error }}"),
		observationTmpl: getStr(config, "observation_template", openrouterDefaultObservation),
		multimodalRegex: getStr(config, "multimodal_regex", ""),
		apiKey:          os.Getenv("OPENROUTER_API_KEY"),
		apiURL:          "https://openrouter.ai/api/v1/chat/completions",
	}
	return m
}

func (m *OpenRouterModel) queryHTTP(messages []map[string]any, kwargs map[string]any) (map[string]any, error) {
	payload := map[string]any{
		"model":    m.modelName,
		"messages": messages,
		"tools":    []map[string]any{bashToolOpenRouter},
		"usage":    map[string]any{"include": true},
	}
	for k, v := range m.modelKwargs {
		payload[k] = v
	}
	for k, v := range kwargs {
		payload[k] = v
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", m.apiURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+m.apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 401 {
		return nil, fmt.Errorf("authentication failed. Set OPENROUTER_API_KEY")
	}
	if resp.StatusCode == 429 {
		return nil, fmt.Errorf("rate limit exceeded")
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	var result map[string]any
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}
	return result, nil
}

func (m *OpenRouterModel) prepareMessages(messages []exceptions.Message) []map[string]any {
	prepared := make([]map[string]any, 0, len(messages))
	for _, msg := range messages {
		m2 := map[string]any{"role": msg.Role, "content": toStr(msg.Content)}
		if msg.ToolCallID != "" {
			m2["tool_call_id"] = msg.ToolCallID
		}
		if len(msg.ToolCalls) > 0 {
			tcs := make([]map[string]any, 0, len(msg.ToolCalls))
			for _, tc := range msg.ToolCalls {
				tcs = append(tcs, map[string]any{
					"id":       tc.ID,
					"type":     tc.Type,
					"function": map[string]any{"name": tc.Function.Name, "arguments": tc.Function.Arguments},
				})
			}
			m2["tool_calls"] = tcs
		}
		prepared = append(prepared, m2)
	}
	return prepared
}

// GetConfig returns the model config.
func (m *OpenRouterModel) GetConfig() map[string]any { return m.Config }

// Query queries the OpenRouter API.
func (m *OpenRouterModel) Query(messages []exceptions.Message) (exceptions.Message, error) {
	resp, err := m.queryHTTP(m.prepareMessages(messages), nil)
	if err != nil {
		return exceptions.Message{}, err
	}
	cost := m.calculateCost(resp)
	_ = GlobalModelStatsInstance.Add(cost)

	choices, _ := resp["choices"].([]any)
	if len(choices) == 0 {
		return exceptions.Message{}, fmt.Errorf("no choices in response")
	}
	choice := choices[0].(map[string]any)
	msgData := choice["message"].(map[string]any)

	toolCalls := []exceptions.ToolCall{}
	if tcs, ok := msgData["tool_calls"].([]any); ok {
		for _, tc := range tcs {
			tcMap := tc.(map[string]any)
			fn := tcMap["function"].(map[string]any)
			toolCalls = append(toolCalls, exceptions.ToolCall{
				ID:   getStr(tcMap, "id", ""),
				Type: getStr(tcMap, "type", "function"),
				Function: struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				}{getStr(fn, "name", ""), getStr(fn, "arguments", "{}")},
			})
		}
	}

	actionList, err := actions.ParseToolcallActions(toolCalls, m.formatErrorTmpl, map[string]any{
		"finish_reason": getStr(choice, "finish_reason", ""),
	})
	if err != nil {
		if fe, ok := err.(*exceptions.FormatError); ok {
			if len(fe.Messages) > 0 {
				if fe.Messages[0].Extra == nil {
					fe.Messages[0].Extra = map[string]any{}
				}
				fe.Messages[0].Extra["cost"] = cost
				fe.Messages[0].Extra["response"] = resp
			}
		}
		return exceptions.Message{}, err
	}

	return exceptions.Message{
		Role:      getStr(msgData, "role", "assistant"),
		Content:   getStr(msgData, "content", ""),
		ToolCalls: toolCalls,
		Extra: map[string]any{
			"actions":   actionList,
			"response":  resp,
			"cost":      cost,
			"timestamp": float64Time(),
		},
	}, nil
}

func (m *OpenRouterModel) calculateCost(resp map[string]any) float64 {
	usage, _ := resp["usage"].(map[string]any)
	if usage == nil {
		return 0.0
	}
	cost, _ := usage["cost"].(float64)
	return cost
}

// FormatMessage formats a message.
func (m *OpenRouterModel) FormatMessage(kwargs map[string]any) exceptions.Message {
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
func (m *OpenRouterModel) FormatObservationMessages(message exceptions.Message, outputs []exceptions.EnvOutput, templateVars map[string]any) []exceptions.Message {
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
func (m *OpenRouterModel) GetTemplateVars() map[string]any {
	return map[string]any{
		"model_name":            m.modelName,
		"model_kwargs":          m.modelKwargs,
		"set_cache_control":     m.setCacheControl,
		"cost_tracking":         m.costTracking,
		"format_error_template": m.formatErrorTmpl,
		"observation_template":  m.observationTmpl,
		"multimodal_regex":      m.multimodalRegex,
	}
}

// Serialize returns the model state.
func (m *OpenRouterModel) Serialize() map[string]any {
	return map[string]any{
		"info": map[string]any{
			"config": map[string]any{
				"model":      m.Config,
				"model_type": "OpenRouterModel",
			},
		},
	}
}

// Ensure strings import is used
var _ = strings.TrimSpace
