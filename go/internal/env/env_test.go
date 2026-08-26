// Package env provides tests for environments.
package env

import (
	"testing"
)

func TestNewSingularityEnvironment(t *testing.T) {
	m := NewSingularityEnvironment(map[string]any{
		"image": "docker://ubuntu:latest",
		"cwd":   "/app",
	})
	if m == nil {
		t.Fatal("expected non-nil environment")
	}
	serialized := m.Serialize()
	envType := serialized["info"].(map[string]any)["config"].(map[string]any)["environment_type"]
	if envType != "SingularityEnvironment" {
		t.Errorf("expected environment_type=SingularityEnvironment, got %v", envType)
	}
}

func TestSingularityGetTemplateVars(t *testing.T) {
	m := NewSingularityEnvironment(map[string]any{
		"image": "docker://ubuntu:latest",
		"cwd":   "/app",
	})
	vars := m.GetTemplateVars()
	if vars["image"] != "docker://ubuntu:latest" {
		t.Errorf("expected image in template vars")
	}
	if vars["cwd"] != "/app" {
		t.Errorf("expected cwd=/app in template vars")
	}
}

func TestSingularityDefaultArgs(t *testing.T) {
	m := NewSingularityEnvironment(map[string]any{
		"image": "docker://ubuntu:latest",
	})
	if len(m.globalArgs) == 0 || m.globalArgs[0] != "--quiet" {
		t.Errorf("expected default global_args=[--quiet], got %v", m.globalArgs)
	}
	if len(m.execArgs) != 3 {
		t.Errorf("expected 3 default exec_args, got %v", m.execArgs)
	}
}

func TestDockerSerialize(t *testing.T) {
	m := NewDockerEnvironment(map[string]any{
		"image": "ubuntu:latest",
	})
	serialized := m.Serialize()
	envType := serialized["info"].(map[string]any)["config"].(map[string]any)["environment_type"]
	if envType != "DockerEnvironment" {
		t.Errorf("expected environment_type=DockerEnvironment, got %v", envType)
	}
}
