// Package agent provides agent factory functions.
// Ported from src/minisweagent/agents/__init__.py
package agent

import (
	"fmt"

	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
)

// GetAgent returns an initialized agent from model, env, and config.
func GetAgent(model core.Model, env core.Environment, config map[string]any, defaultType string) (core.Agent, error) {
	cfg := make(map[string]any)
	for k, v := range config {
		cfg[k] = v
	}
	agentClass := defaultType
	if ac, ok := cfg["agent_class"].(string); ok && ac != "" {
		agentClass = ac
	}
	delete(cfg, "agent_class")

	switch agentClass {
	case "default", "":
		return NewDefaultAgent(model, env, cfg), nil
	case "interactive":
		return NewInteractiveAgent(model, env, cfg), nil
	default:
		return nil, fmt.Errorf("unknown agent type: %s", agentClass)
	}
}
