// Package env provides environment factory functions.
// Ported from src/minisweagent/environments/__init__.py
package env

import (
	"fmt"

	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
)

// GetEnvironment returns an initialized environment from config.
func GetEnvironment(config map[string]any, defaultType string) (core.Environment, error) {
	cfg := make(map[string]any)
	for k, v := range config {
		cfg[k] = v
	}
	envClass := defaultType
	if ec, ok := cfg["environment_class"].(string); ok && ec != "" {
		envClass = ec
	}
	delete(cfg, "environment_class")

	switch envClass {
	case "local", "":
		return NewLocalEnvironment(cfg), nil
	case "docker":
		return NewDockerEnvironment(cfg), nil
	case "singularity":
		return NewSingularityEnvironment(cfg), nil
	default:
		return nil, fmt.Errorf("unknown environment type: %s", envClass)
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

func getInt(m map[string]any, key string, def int) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case int:
			return n
		case int64:
			return int(n)
		case float64:
			return int(n)
		}
	}
	return def
}

func getStrMap(m map[string]any, key string) map[string]string {
	result := map[string]string{}
	if v, ok := m[key]; ok {
		if mp, ok := v.(map[string]any); ok {
			for k, val := range mp {
				if s, ok := val.(string); ok {
					result[k] = s
				}
			}
		}
	}
	return result
}
