// Package actions provides content string extraction for display.
// Ported from src/minisweagent/models/utils/content_string.py

package actions

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
)

func formatToolCall(argsStr string) string {
	var args map[string]any
	if err := json.Unmarshal([]byte(argsStr), &args); err == nil {
		if cmd, ok := args["command"].(string); ok {
			return "```\n" + cmd + "\n```"
		}
	}
	return "```\n" + argsStr + "\n```"
}

func formatObservation(content string) string {
	var data map[string]any
	if err := json.Unmarshal([]byte(content), &data); err == nil {
		if _, ok := data["returncode"]; ok {
			var lines []string
			for key, value := range data {
				lines = append(lines, fmt.Sprintf("<%s>", key))
				lines = append(lines, fmt.Sprintf("%v", value))
			}
			return strings.Join(lines, "\n")
		}
	}
	return content
}

// GetContentString extracts text content from any message format for display.
func GetContentString(message exceptions.Message) string {
	var texts []string

	switch content := message.Content.(type) {
	case string:
		texts = append(texts, formatObservation(content))
	}

	if len(message.ToolCalls) > 0 {
		for _, tc := range message.ToolCalls {
			texts = append(texts, formatToolCall(tc.Function.Arguments))
		}
	}

	return strings.Join(texts, "\n\n")
}
