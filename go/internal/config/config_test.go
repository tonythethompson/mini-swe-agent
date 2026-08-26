// Package config provides tests for config spec parsing.
package config

import (
	"testing"
)

func TestKeyValueSpecToNestedDict(t *testing.T) {
	result, err := KeyValueSpecToNestedDict("model.model_name=anthropic/claude")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	model := result["model"].(map[string]any)
	if model["model_name"] != "anthropic/claude" {
		t.Errorf("expected model_name=anthropic/claude, got %v", model["model_name"])
	}
}

func TestKeyValueSpecToNestedDictFloat(t *testing.T) {
	result, err := KeyValueSpecToNestedDict("agent.cost_limit=3.5")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	agent := result["agent"].(map[string]any)
	costLimit := agent["cost_limit"]
	if costLimit != 3.5 {
		t.Errorf("expected cost_limit=3.5, got %v (%T)", costLimit, costLimit)
	}
}

func TestKeyValueSpecEmptyKey(t *testing.T) {
	_, err := KeyValueSpecToNestedDict("model..name=test")
	if err == nil {
		t.Error("expected error for empty key segment")
	}
}
