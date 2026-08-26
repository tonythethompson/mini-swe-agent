// Package run provides the SWE-Bench single instance runner.
// Ported from src/minisweagent/run/benchmarks/swebench_single.py
package run

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/tonythethompson/mini-swe-agent/go/internal/agent"
	"github.com/tonythethompson/mini-swe-agent/go/internal/config"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model"
	"github.com/tonythethompson/mini-swe-agent/go/internal/serialize"
)

// SwebenchSingleOptions holds options for running a single SWE-Bench instance.
type SwebenchSingleOptions struct {
	Subset           string
	Split            string
	Instance         string
	Model            string
	ModelClass       string
	AgentClass       string
	EnvironmentClass string
	Yolo             bool
	CostLimit        float64
	ConfigSpec       []string
	ExitImmediately  bool
	Output           string
}

// RunSwebenchSingle runs on a single SWE-Bench instance.
func RunSwebenchSingle(opts SwebenchSingleOptions) error {
	subset := opts.Subset
	if subset == "" {
		subset = "lite"
	}
	split := opts.Split
	if split == "" {
		split = "dev"
	}

	datasetPath, ok := DatasetMapping[subset]
	if !ok {
		datasetPath = subset
	}
	fmt.Fprintf(os.Stderr, "Loading dataset from %s, split %s...\n", datasetPath, split)

	localFile := filepath.Join(".", "instances.json")
	content, err := os.ReadFile(localFile)
	if err != nil {
		return fmt.Errorf("no instances file found at %s: %w", localFile, err)
	}
	var allInstances []map[string]any
	if err := json.Unmarshal(content, &allInstances); err != nil {
		return fmt.Errorf("failed to parse instances: %w", err)
	}

	instances := map[string]map[string]any{}
	for _, inst := range allInstances {
		iid, _ := inst["instance_id"].(string)
		instances[iid] = inst
	}

	var instanceID string
	if opts.Instance == "" || isNumeric(opts.Instance) {
		sortedIds := make([]string, 0, len(instances))
		for k := range instances {
			sortedIds = append(sortedIds, k)
		}
		sort.Strings(sortedIds)
		idx := 0
		if opts.Instance != "" {
			fmt.Sscanf(opts.Instance, "%d", &idx)
		}
		if idx >= 0 && idx < len(sortedIds) {
			instanceID = sortedIds[idx]
		}
	} else {
		instanceID = opts.Instance
	}

	instance, exists := instances[instanceID]
	if !exists {
		return fmt.Errorf("instance %s not found", instanceID)
	}

	configSpec := opts.ConfigSpec
	if len(configSpec) == 0 {
		configSpec = []string{filepath.Join(config.BuiltinConfigDir, "benchmarks", "swebench.yaml")}
	}
	configs := make([]map[string]any, 0, len(configSpec)+1)
	for _, spec := range configSpec {
		cfg, err := config.GetConfigFromSpec(spec)
		if err != nil {
			return fmt.Errorf("failed to load config %s: %w", spec, err)
		}
		configs = append(configs, cfg)
	}

	var costLimitAny any = serialize.Unset
	if opts.CostLimit > 0 {
		costLimitAny = opts.CostLimit
	}
	var modeAny any = serialize.Unset
	if opts.Yolo {
		modeAny = "yolo"
	}
	var confirmExitAny any = serialize.Unset
	if opts.ExitImmediately {
		confirmExitAny = false
	}

	configs = append(configs, map[string]any{
		"agent": map[string]any{
			"agent_class":  serialize.UnsetIfEmpty(opts.AgentClass),
			"mode":         modeAny,
			"cost_limit":   costLimitAny,
			"confirm_exit": confirmExitAny,
			"output_path":  serialize.UnsetIfEmpty(opts.Output),
		},
		"model": map[string]any{
			"model_class": serialize.UnsetIfEmpty(opts.ModelClass),
			"model_name":  serialize.UnsetIfEmpty(opts.Model),
		},
		"environment": map[string]any{
			"environment_class": serialize.UnsetIfEmpty(opts.EnvironmentClass),
		},
	})
	finalConfig := serialize.RecursiveMerge(configs...)

	envInterface, err := GetSbEnvironment(finalConfig, instance)
	if err != nil {
		return err
	}

	modelCfg := map[string]any{}
	if m, ok := finalConfig["model"].(map[string]any); ok {
		for k, v := range m {
			modelCfg[k] = v
		}
	}
	m, err := model.GetModel(modelCfg)
	if err != nil {
		return err
	}

	agentCfg := map[string]any{}
	if a, ok := finalConfig["agent"].(map[string]any); ok {
		for k, v := range a {
			agentCfg[k] = v
		}
	}
	a, err := agent.GetAgent(m, envInterface, agentCfg, "interactive")
	if err != nil {
		return err
	}

	task, _ := instance["problem_statement"].(string)
	_, err = a.Run(task)
	return err
}

func isNumeric(s string) bool {
	if s == "" {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
