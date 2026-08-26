// Package model provides model factory functions.
// Ported from src/minisweagent/models/__init__.py
package model

import (
	"fmt"
	"os"
	"strings"

	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
)

// GetModelName resolves the model name from input, config, or env.
func GetModelName(inputModelName string, config map[string]any) (string, error) {
	if inputModelName != "" {
		return inputModelName, nil
	}
	if config != nil {
		if name, ok := config["model_name"].(string); ok && name != "" {
			return name, nil
		}
	}
	if envName := os.Getenv("MSWEA_MODEL_NAME"); envName != "" {
		return envName, nil
	}
	return "", fmt.Errorf("no default model set. Please run `mini config setup` to set one")
}

// GetModel returns an initialized model from config.
func GetModel(config map[string]any) (core.Model, error) {
	resolvedName, err := GetModelName("", config)
	if err != nil {
		return nil, err
	}
	cfg := make(map[string]any)
	for k, v := range config {
		cfg[k] = v
	}
	cfg["model_name"] = resolvedName

	modelClass := ""
	if mc, ok := cfg["model_class"].(string); ok {
		modelClass = mc
	}
	delete(cfg, "model_class")

	// Auto-select cache control for Anthropic models
	lower := strings.ToLower(resolvedName)
	if (strings.Contains(lower, "anthropic") || strings.Contains(lower, "sonnet") ||
		strings.Contains(lower, "opus") || strings.Contains(lower, "claude")) &&
		cfg["set_cache_control"] == nil {
		cfg["set_cache_control"] = "default_end"
	}

	switch modelClass {
	case "deterministic":
		return NewDeterministicModel(cfg), nil
	case "litellm", "":
		return NewLitellmModel(cfg), nil
	case "litellm_textbased":
		return NewLitellmTextbasedModel(cfg), nil
	case "openrouter":
		return NewOpenRouterModel(cfg), nil
	case "requesty":
		return NewRequestyModel(cfg), nil
	case "portkey":
		return NewPortkeyModel(cfg), nil
	default:
		return nil, fmt.Errorf("unknown model class: %s", modelClass)
	}
}
