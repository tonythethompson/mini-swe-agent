// Package run provides the mini run script.
// Ported from src/minisweagent/run/mini.py
package run

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/joho/godotenv"
	"github.com/tonythethompson/mini-swe-agent/go/internal/agent"
	"github.com/tonythethompson/mini-swe-agent/go/internal/config"
	"github.com/tonythethompson/mini-swe-agent/go/internal/env"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model"
	"github.com/tonythethompson/mini-swe-agent/go/internal/serialize"
)

// MiniOptions holds CLI options for the mini command.
type MiniOptions struct {
	Model            string
	ModelClass       string
	AgentClass       string
	EnvironmentClass string
	Task             string
	Yolo             bool
	CostLimit        float64
	ConfigSpec       []string
	Output           string
	ExitImmediately  bool
}

// RunMini runs the mini agent.
func RunMini(opts MiniOptions) error {
	// Load .env
	configDir := os.Getenv("MSWEA_GLOBAL_CONFIG_DIR")
	if configDir == "" {
		configDir = filepath.Join(os.Getenv("HOME"), ".config", "mini-swe-agent")
	}
	godotenv.Load(filepath.Join(configDir, ".env"))

	defaultConfigFile := os.Getenv("MSWEA_MINI_CONFIG_PATH")
	if defaultConfigFile == "" {
		defaultConfigFile = filepath.Join(config.BuiltinConfigDir, "mini.yaml")
	}

	configSpecs := opts.ConfigSpec
	if len(configSpecs) == 0 {
		configSpecs = []string{defaultConfigFile}
	}

	fmt.Fprintf(os.Stderr, "Building agent config from specs: %v\n", configSpecs)

	var configs []map[string]any
	for _, spec := range configSpecs {
		c, err := config.GetConfigFromSpec(spec)
		if err != nil {
			return fmt.Errorf("error loading config %s: %w", spec, err)
		}
		configs = append(configs, c)
	}

	// Add CLI overrides
	cliConfig := map[string]any{
		"run": map[string]any{"task": opts.Task},
		"agent": map[string]any{
			"agent_class":  opts.AgentClass,
			"mode":         "",
			"cost_limit":   opts.CostLimit,
			"confirm_exit": !opts.ExitImmediately,
			"output_path":  opts.Output,
		},
		"model": map[string]any{
			"model_class": opts.ModelClass,
			"model_name":  opts.Model,
		},
		"environment": map[string]any{
			"environment_class": opts.EnvironmentClass,
		},
	}
	if opts.Yolo {
		cliConfig["agent"].(map[string]any)["mode"] = "yolo"
	}
	if opts.Task == "" {
		cliConfig["run"].(map[string]any)["task"] = serialize.Unset
	}
	if opts.AgentClass == "" {
		cliConfig["agent"].(map[string]any)["agent_class"] = serialize.Unset
	}
	if opts.ModelClass == "" {
		cliConfig["model"].(map[string]any)["model_class"] = serialize.Unset
	}
	if opts.Model == "" {
		cliConfig["model"].(map[string]any)["model_name"] = serialize.Unset
	}
	if opts.EnvironmentClass == "" {
		cliConfig["environment"].(map[string]any)["environment_class"] = serialize.Unset
	}
	if opts.CostLimit == 0 {
		cliConfig["agent"].(map[string]any)["cost_limit"] = serialize.Unset
	}

	configs = append(configs, cliConfig)
	merged := serialize.RecursiveMerge(configs...)

	// Get task
	runTask := ""
	if runCfg, ok := merged["run"].(map[string]any); ok {
		if t, ok := runCfg["task"].(string); ok {
			runTask = t
		}
	}
	if runTask == "" {
		fmt.Fprintln(os.Stderr, "What do you want to do?")
		// Read from stdin
		line := ""
		fmt.Scanln(&line)
		runTask = line
	}

	// Build model, env, agent
	modelCfg := map[string]any{}
	if m, ok := merged["model"].(map[string]any); ok {
		modelCfg = m
	}
	m, err := model.GetModel(modelCfg)
	if err != nil {
		return err
	}

	envCfg := map[string]any{}
	if e, ok := merged["environment"].(map[string]any); ok {
		envCfg = e
	}
	e, err := env.GetEnvironment(envCfg, "local")
	if err != nil {
		return err
	}

	agentCfg := map[string]any{}
	if a, ok := merged["agent"].(map[string]any); ok {
		agentCfg = a
	}
	a, err := agent.GetAgent(m, e, agentCfg, "interactive")
	if err != nil {
		return err
	}

	_, err = a.Run(runTask)
	if err != nil {
		return err
	}

	if outputPath, ok := agentCfg["output_path"].(string); ok && outputPath != "" {
		fmt.Fprintf(os.Stderr, "Saved trajectory to %s\n", outputPath)
	}
	return nil
}
