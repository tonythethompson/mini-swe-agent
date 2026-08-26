// Package env provides the Singularity environment.
// Ported from src/minisweagent/environments/singularity.py
package env

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/serialize"
)

// SingularityEnvironment executes commands in a Singularity container.
type SingularityEnvironment struct {
	Config              map[string]any
	image               string
	cwd                 string
	envVars             map[string]string
	forwardEnv          []string
	timeout             int
	executable          string
	sandboxBuildRetries int
	globalArgs          []string
	execArgs            []string
	sandboxDir          string
	mu                  sync.Mutex
}

// NewSingularityEnvironment creates a SingularityEnvironment from config.
func NewSingularityEnvironment(config map[string]any) *SingularityEnvironment {
	m := &SingularityEnvironment{
		Config:              config,
		image:               getStr(config, "image", ""),
		cwd:                 getStr(config, "cwd", "/"),
		envVars:             getStrMap(config, "env"),
		forwardEnv:          getAnySliceStr(config, "forward_env"),
		timeout:             getInt(config, "timeout", 30),
		executable:          getStr(config, "executable", envOr("MSWEA_SINGULARITY_EXECUTABLE", "singularity")),
		sandboxBuildRetries: getInt(config, "sandbox_build_retries", 3),
		globalArgs:          getAnySliceStr(config, "global_args"),
		execArgs:            getAnySliceStr(config, "exec_args"),
	}
	if len(m.globalArgs) == 0 {
		m.globalArgs = []string{"--quiet"}
	}
	if len(m.execArgs) == 0 {
		m.execArgs = []string{"--contain", "--cleanenv", "--fakeroot"}
	}
	return m
}

func (e *SingularityEnvironment) buildSandbox() error {
	maxRetries := e.sandboxBuildRetries
	for attempt := 0; attempt < maxRetries; attempt++ {
		sandboxDir := filepath.Join(os.TempDir(), "minisweagent-"+uuid.New().String()[:8])
		cmd := exec.CommandContext(context.Background(), e.executable,
			append(append([]string{}, e.globalArgs...), "build", "--sandbox", sandboxDir, e.image)...)
		output, err := cmd.CombinedOutput()
		if err != nil {
			os.RemoveAll(sandboxDir)
			_ = output
			if attempt == maxRetries-1 {
				return fmt.Errorf("failed to build sandbox: %w", err)
			}
			continue
		}
		e.sandboxDir = sandboxDir
		return nil
	}
	return fmt.Errorf("failed to build sandbox after %d retries", maxRetries)
}

// GetConfig returns the environment config.
func (e *SingularityEnvironment) GetConfig() map[string]any { return e.Config }

// Execute runs a command in the Singularity container.
func (e *SingularityEnvironment) Execute(action exceptions.Action, cwd string) (exceptions.EnvOutput, error) {
	e.mu.Lock()
	if e.sandboxDir == "" {
		if err := e.buildSandbox(); err != nil {
			e.mu.Unlock()
			return exceptions.EnvOutput{}, err
		}
	}
	e.mu.Unlock()

	command := action.Command
	workDir := cwd
	if workDir == "" {
		workDir = e.cwd
	}

	args := append(append([]string{}, e.globalArgs...), "exec")
	args = append(args, e.execArgs...)
	if workDir != "" && workDir != "/" {
		args = append(args, "--pwd", workDir)
	}
	for _, key := range e.forwardEnv {
		if value, ok := os.LookupEnv(key); ok {
			args = append(args, "--env", key+"="+value)
		}
	}
	for key, value := range e.envVars {
		args = append(args, "--env", key+"="+value)
	}
	args = append(args, "--writable", e.sandboxDir, "bash", "-c", command)

	ctx := context.Background()
	if e.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(e.timeout)*time.Second)
		defer cancel()
	}

	cmd := exec.CommandContext(ctx, e.executable, args...)
	output, err := cmd.CombinedOutput()
	outputStr := string(output)

	if err != nil {
		out := exceptions.EnvOutput{
			Output:        outputStr,
			ReturnCode:    -1,
			ExceptionInfo: fmt.Sprintf("An error occurred: %v", err),
			Extra:         map[string]any{"exception_type": "ExecError", "exception": err.Error()},
		}
		if checkErr := e.checkFinished(out); checkErr != nil {
			return out, checkErr
		}
		return out, nil
	}

	out := exceptions.EnvOutput{
		Output:     outputStr,
		ReturnCode: 0,
	}
	if checkErr := e.checkFinished(out); checkErr != nil {
		return out, checkErr
	}
	return out, nil
}

func (e *SingularityEnvironment) checkFinished(output exceptions.EnvOutput) error {
	lines := strings.Split(strings.TrimLeft(output.Output, " \t\r\n"), "\n")
	if len(lines) > 0 && strings.TrimSpace(lines[0]) == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT" && output.ReturnCode == 0 {
		submission := strings.Join(lines[1:], "\n")
		return exceptions.NewSubmitted(exceptions.Message{
			Role:    "exit",
			Content: submission,
			Extra:   map[string]any{"exit_status": "Submitted", "submission": submission},
		})
	}
	return nil
}

// GetTemplateVars returns template variables.
func (e *SingularityEnvironment) GetTemplateVars() map[string]any {
	return serialize.RecursiveMerge(map[string]any{
		"image":                 e.image,
		"cwd":                   e.cwd,
		"env":                   e.envVars,
		"forward_env":           e.forwardEnv,
		"timeout":               e.timeout,
		"executable":            e.executable,
		"sandbox_build_retries": e.sandboxBuildRetries,
		"global_args":           e.globalArgs,
		"exec_args":             e.execArgs,
	})
}

// Serialize returns the environment state.
func (e *SingularityEnvironment) Serialize() map[string]any {
	return map[string]any{
		"info": map[string]any{
			"config": map[string]any{
				"environment":      e.Config,
				"environment_type": "SingularityEnvironment",
			},
		},
	}
}

// Cleanup removes the sandbox directory.
func (e *SingularityEnvironment) Cleanup() {
	if e.sandboxDir != "" {
		os.RemoveAll(e.sandboxDir)
	}
}

func getAnySliceStr(m map[string]any, key string) []string {
	if v, ok := m[key]; ok {
		if s, ok := v.([]any); ok {
			result := make([]string, 0, len(s))
			for _, item := range s {
				if str, ok := item.(string); ok {
					result = append(result, str)
				}
			}
			return result
		}
	}
	return nil
}
