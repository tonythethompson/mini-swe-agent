// Package model provides tests for model variants.
package model

import (
	"testing"

	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
)

func TestNewLitellmTextbasedModel(t *testing.T) {
	m := NewLitellmTextbasedModel(map[string]any{
		"model_name": "openai/gpt-4o",
	})
	if m == nil {
		t.Fatal("expected non-nil model")
	}
	serialized := m.Serialize()
	modelType := serialized["info"].(map[string]any)["config"].(map[string]any)["model_type"]
	if modelType != "LitellmTextbasedModel" {
		t.Errorf("expected model_type=LitellmTextbasedModel, got %v", modelType)
	}
}

func TestNewOpenRouterModel(t *testing.T) {
	m := NewOpenRouterModel(map[string]any{
		"model_name": "anthropic/claude-sonnet-4-5",
	})
	if m == nil {
		t.Fatal("expected non-nil model")
	}
	serialized := m.Serialize()
	modelType := serialized["info"].(map[string]any)["config"].(map[string]any)["model_type"]
	if modelType != "OpenRouterModel" {
		t.Errorf("expected model_type=OpenRouterModel, got %v", modelType)
	}
	vars := m.GetTemplateVars()
	if vars["model_name"] != "anthropic/claude-sonnet-4-5" {
		t.Errorf("expected model_name in template vars")
	}
}

func TestNewRequestyModel(t *testing.T) {
	m := NewRequestyModel(map[string]any{
		"model_name": "openai/gpt-4o",
	})
	if m == nil {
		t.Fatal("expected non-nil model")
	}
	serialized := m.Serialize()
	modelType := serialized["info"].(map[string]any)["config"].(map[string]any)["model_type"]
	if modelType != "RequestyModel" {
		t.Errorf("expected model_type=RequestyModel, got %v", modelType)
	}
}

func TestNewPortkeyModel(t *testing.T) {
	// PortkeyModel without API key should not panic
	m := NewPortkeyModel(map[string]any{
		"model_name": "openai/gpt-4o",
	})
	if m == nil {
		t.Fatal("expected non-nil model")
	}
	serialized := m.Serialize()
	modelType := serialized["info"].(map[string]any)["config"].(map[string]any)["model_type"]
	if modelType != "PortkeyModel" {
		t.Errorf("expected model_type=PortkeyModel, got %v", modelType)
	}
}

func TestStripProvider(t *testing.T) {
	tests := []struct {
		input, expected string
	}{
		{"openai/gpt-4o", "gpt-4o"},
		{"anthropic/claude-sonnet-4-5", "claude-sonnet-4-5"},
		{"gpt-4o", "gpt-4o"},
		{"openrouter/anthropic/claude-3", "anthropic/claude-3"},
	}
	for _, tt := range tests {
		result := stripProvider(tt.input)
		if result != tt.expected {
			t.Errorf("stripProvider(%q) = %q, want %q", tt.input, result, tt.expected)
		}
	}
}

func TestResolveProvider(t *testing.T) {
	tests := []struct {
		modelName    string
		expectBaseURL string
	}{
		{"openrouter/anthropic/claude", "https://openrouter.ai/api/v1"},
		{"anthropic/claude-sonnet", "https://api.anthropic.com/v1/openai"},
		{"gemini/gemini-pro", "https://generativelanguage.googleapis.com/v1beta/openai"},
		{"requesty/openai/gpt-4o", "https://api.requesty.ai/v1"},
		{"portkey/openai/gpt-4o", "https://api.portkey.ai/v1"},
		{"openai/gpt-4o", ""},
	}
	for _, tt := range tests {
		baseURL, _ := resolveProvider(tt.modelName)
		if baseURL != tt.expectBaseURL {
			t.Errorf("resolveProvider(%q) baseURL = %q, want %q", tt.modelName, baseURL, tt.expectBaseURL)
		}
	}
}

func TestExceptionsActionType(t *testing.T) {
	// Verify that exceptions.Action has the expected fields
	a := exceptions.Action{Command: "echo hello"}
	if a.Command != "echo hello" {
		t.Errorf("expected command=echo hello")
	}
}
