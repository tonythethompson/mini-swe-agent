// Package agent provides tests for the default agent.
package agent

import (
	"testing"

	"github.com/tonythethompson/mini-swe-agent/go/internal/env"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model"
)

func TestDefaultAgentFullTrajectory(t *testing.T) {
	mdl := model.NewDeterministicModel(map[string]any{
		"outputs": []exceptions.Message{
			model.MakeOutput("Let me check", []exceptions.Action{{Command: "echo hello"}}, 1.0),
			model.MakeOutput("Done", []exceptions.Action{{Command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT&&echo my submission"}}, 1.0),
		},
	})
	e := env.NewLocalEnvironment(map[string]any{"cwd": "."})
	a := NewDefaultAgent(mdl, e, map[string]any{
		"system_template":             "You are a helpful assistant.",
		"instance_template":           "Solve: {{task}}",
		"step_limit":                  0,
		"cost_limit":                  0,
		"max_consecutive_format_errors": 3,
	})

	result, err := a.Run("test task")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["exit_status"] != "Submitted" {
		t.Errorf("expected exit_status=Submitted, got %v", result["exit_status"])
	}
	if a.NCalls != 2 {
		t.Errorf("expected 2 calls, got %d", a.NCalls)
	}
	if a.Cost != 2.0 {
		t.Errorf("expected cost 2.0, got %f", a.Cost)
	}
}

func TestDefaultAgentLimitsExceeded(t *testing.T) {
	mdl := model.NewDeterministicModel(map[string]any{
		"outputs": []exceptions.Message{
			model.MakeOutput("step 1", []exceptions.Action{{Command: "echo a"}}, 1.0),
			model.MakeOutput("step 2", []exceptions.Action{{Command: "echo b"}}, 1.0),
		},
	})
	e := env.NewLocalEnvironment(map[string]any{})
	a := NewDefaultAgent(mdl, e, map[string]any{
		"system_template":             "sys",
		"instance_template":           "task: {{task}}",
		"cost_limit":                  1.0,
		"max_consecutive_format_errors": 3,
	})

	result, err := a.Run("t")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["exit_status"] != "LimitsExceeded" {
		t.Errorf("expected exit_status=LimitsExceeded, got %v", result["exit_status"])
	}
}

func TestDefaultAgentStepLimit(t *testing.T) {
	mdl := model.NewDeterministicModel(map[string]any{
		"outputs": []exceptions.Message{
			model.MakeOutput("step 1", []exceptions.Action{{Command: "echo a"}}, 1.0),
			model.MakeOutput("step 2", []exceptions.Action{{Command: "echo b"}}, 1.0),
			model.MakeOutput("step 3", []exceptions.Action{{Command: "echo c"}}, 1.0),
		},
	})
	e := env.NewLocalEnvironment(map[string]any{})
	a := NewDefaultAgent(mdl, e, map[string]any{
		"system_template":             "sys",
		"instance_template":           "task: {{task}}",
		"step_limit":                  2,
		"cost_limit":                  0,
		"max_consecutive_format_errors": 3,
	})

	result, err := a.Run("t")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result["exit_status"] != "LimitsExceeded" {
		t.Errorf("expected exit_status=LimitsExceeded, got %v", result["exit_status"])
	}
	if a.NCalls != 2 {
		t.Errorf("expected 2 calls, got %d", a.NCalls)
	}
}

func TestDefaultAgentSerialize(t *testing.T) {
	mdl := model.NewDeterministicModel(map[string]any{
		"outputs": []exceptions.Message{
			model.MakeOutput("done", []exceptions.Action{{Command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"}}, 1.0),
		},
	})
	e := env.NewLocalEnvironment(map[string]any{})
	a := NewDefaultAgent(mdl, e, map[string]any{
		"system_template":   "sys",
		"instance_template": "task: {{task}}",
		"cost_limit":        0,
	})

	_, _ = a.Run("t")
	data := a.Serialize()

	if data["trajectory_format"] != "mini-swe-agent-1.1" {
		t.Errorf("expected trajectory_format=mini-swe-agent-1.1, got %v", data["trajectory_format"])
	}
	info := data["info"].(map[string]any)
	if info["exit_status"] != "Submitted" {
		t.Errorf("expected exit_status=Submitted, got %v", info["exit_status"])
	}
}
