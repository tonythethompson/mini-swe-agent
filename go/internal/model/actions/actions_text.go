// Package actions provides text-based action parsing (v1 style).
// Ported from src/minisweagent/models/utils/actions_text.py
package actions

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/utils/jinja"
)

// ParseRegexActions parses actions from text content using regex.
// Returns FormatError if not exactly one action.
func ParseRegexActions(content string, actionRegex string, formatErrorTemplate string, templateKwargs map[string]any) ([]exceptions.Action, error) {
	re := regexp.MustCompile("(?s)" + actionRegex)
	matches := re.FindAllStringSubmatch(content, -1)
	actions := make([]string, len(matches))
	for i, m := range matches {
		if len(m) > 1 {
			actions[i] = strings.TrimSpace(m[1])
		} else {
			actions[i] = strings.TrimSpace(m[0])
		}
	}
	if len(actions) != 1 {
		errorMsg := fmt.Sprintf("Expected exactly 1 action, found %d.", len(actions))
		rendered := jinja.Render(formatErrorTemplate, mergeMaps(map[string]any{
			"actions": actions,
			"error":   errorMsg,
		}, templateKwargs))
		return nil, exceptions.NewFormatError(exceptions.Message{
			Role:    "user",
			Content: rendered,
			Extra:   map[string]any{"interrupt_type": "FormatError", "n_actions": len(actions), "model_response": content},
		})
	}
	return []exceptions.Action{{Command: actions[0]}}, nil
}

// FormatObservationMessages formats execution outputs into user observation messages (text-based).
func FormatObservationMessages(outputs []exceptions.EnvOutput, observationTemplate string, templateVars map[string]any, multimodalRegex string) []exceptions.Message {
	var results []exceptions.Message
	for _, output := range outputs {
		content := jinja.Render(observationTemplate, mergeMaps(map[string]any{"output": output}, templateVars))
		msg := exceptions.Message{
			Role:    "user",
			Content: content,
			Extra: map[string]any{
				"raw_output":     output.Output,
				"returncode":     output.ReturnCode,
				"timestamp":      float64(time.Now().UnixNano()) / 1e9,
				"exception_info": output.ExceptionInfo,
			},
		}
		for k, v := range output.Extra {
			msg.Extra[k] = v
		}
		results = append(results, msg)
	}
	return results
}
