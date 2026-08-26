// Package actions provides action parsing and observation formatting.
// Ported from src/minisweagent/models/utils/actions_toolcall.py
package actions

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/utils/jinja"
)

// BashTool is the OpenAI tool definition for the bash command.
var BashTool = map[string]any{
	"type": "function",
	"function": map[string]any{
		"name":        "bash",
		"description": "Execute a bash command",
		"parameters": map[string]any{
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
}

// ParseToolcallActions parses tool calls from the response.
// Returns FormatError if unknown tool or invalid args.
func ParseToolcallActions(toolCalls []exceptions.ToolCall, formatErrorTemplate string, templateKwargs map[string]any) ([]exceptions.Action, error) {
	if len(toolCalls) == 0 {
		content := jinja.Render(formatErrorTemplate, mergeMaps(map[string]any{
			"error":           "No tool calls found in the response. Every response MUST include at least one tool call.",
			"actions":         []any{},
			"has_tool_calls":  false,
		}, templateKwargs))
		return nil, exceptions.NewFormatError(exceptions.Message{
			Role:    "user",
			Content: content,
			Extra:   map[string]any{"interrupt_type": "FormatError"},
		})
	}
	var actions []exceptions.Action
	for _, tc := range toolCalls {
		var errMsg string
		var args map[string]any
		if err := json.Unmarshal([]byte(tc.Function.Arguments), &args); err != nil {
			errMsg = fmt.Sprintf("Error parsing tool call arguments: %v.", err)
		}
		if tc.Function.Name != "bash" {
			errMsg += fmt.Sprintf("Unknown tool '%s'.", tc.Function.Name)
		}
		if args == nil || args["command"] == nil {
			errMsg += "Missing 'command' argument in bash tool call."
		}
		if errMsg != "" {
			content := jinja.Render(formatErrorTemplate, mergeMaps(map[string]any{
				"actions":        []any{},
				"error":           errMsg,
				"has_tool_calls":  true,
			}, templateKwargs))
			return nil, exceptions.NewFormatError(exceptions.Message{
				Role:    "user",
				Content: content,
				Extra:   map[string]any{"interrupt_type": "FormatError"},
			})
		}
		actions = append(actions, exceptions.Action{
			Command:    args["command"].(string),
			ToolCallID: tc.ID,
		})
	}
	return actions, nil
}

// FormatToolcallObservationMessages formats execution outputs into tool result messages.
func FormatToolcallObservationMessages(actions []exceptions.Action, outputs []exceptions.EnvOutput, observationTemplate string, templateVars map[string]any, multimodalRegex string) []exceptions.Message {
	notExecuted := exceptions.EnvOutput{Output: "", ReturnCode: -1, ExceptionInfo: "action was not executed"}
	paddedOutputs := make([]exceptions.EnvOutput, len(actions))
	for i := range paddedOutputs {
		if i < len(outputs) {
			paddedOutputs[i] = outputs[i]
		} else {
			paddedOutputs[i] = notExecuted
		}
	}
	var results []exceptions.Message
	for i, action := range actions {
		output := paddedOutputs[i]
		content := jinja.Render(observationTemplate, mergeMaps(map[string]any{"output": output}, templateVars))
		msg := exceptions.Message{
			Content: content,
			Extra: map[string]any{
				"raw_output":      output.Output,
				"returncode":      output.ReturnCode,
				"timestamp":       float64(time.Now().UnixNano()) / 1e9,
				"exception_info":  output.ExceptionInfo,
			},
		}
		for k, v := range output.Extra {
			msg.Extra[k] = v
		}
		if action.ToolCallID != "" {
			msg.ToolCallID = action.ToolCallID
			msg.Role = "tool"
		} else {
			msg.Role = "user"
		}
		results = append(results, msg)
	}
	return results
}

func mergeMaps(base, overlay map[string]any) map[string]any {
	result := make(map[string]any, len(base)+len(overlay))
	for k, v := range base {
		result[k] = v
	}
	for k, v := range overlay {
		result[k] = v
	}
	return result
}
