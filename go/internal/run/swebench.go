// Package run provides the SWE-Bench benchmark runner.
// Ported from src/minisweagent/run/benchmarks/swebench.py
package run

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/tonythethompson/mini-swe-agent/go/internal/agent"
	"github.com/tonythethompson/mini-swe-agent/go/internal/config"
	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
	"github.com/tonythethompson/mini-swe-agent/go/internal/env"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model"
	"github.com/tonythethompson/mini-swe-agent/go/internal/serialize"
)

// DatasetMapping maps subset names to HuggingFace dataset paths.
var DatasetMapping = map[string]string{
	"full":         "princeton-nlp/SWE-Bench",
	"verified":     "princeton-nlp/SWE-Bench_Verified",
	"lite":         "princeton-nlp/SWE-Bench_Lite",
	"multimodal":   "princeton-nlp/SWE-Bench_Multimodal",
	"multilingual": "swe-bench/SWE-Bench_Multilingual",
	"smith":        "SWE-bench/SWE-smith",
	"_test":        "klieret/swe-bench-dummy-test-dataset",
	"rebench":      "nebius/SWE-rebench",
}

// GetSwebenchDockerImageName returns the Docker image name for a SWE-Bench instance.
func GetSwebenchDockerImageName(instance map[string]any) string {
	if imageName, ok := instance["image_name"].(string); ok && imageName != "" {
		return imageName
	}
	if dockerImage, ok := instance["docker_image"].(string); ok && dockerImage != "" {
		return dockerImage
	}
	iid, _ := instance["instance_id"].(string)
	idDockerCompatible := strings.ReplaceAll(iid, "__", "_1776_")
	return strings.ToLower(fmt.Sprintf("docker.io/swebench/sweb.eval.x86_64.%s:latest", idDockerCompatible))
}

// GetSbEnvironment returns the environment for a SWE-Bench instance.
func GetSbEnvironment(cfg map[string]any, instance map[string]any) (core.Environment, error) {
	envConfig := map[string]any{}
	if envCfg, ok := cfg["environment"].(map[string]any); ok {
		for k, v := range envCfg {
			envConfig[k] = v
		}
	}
	if _, ok := envConfig["environment_class"]; !ok {
		envConfig["environment_class"] = "docker"
	}
	imageName := GetSwebenchDockerImageName(instance)
	envClass, _ := envConfig["environment_class"].(string)
	if envClass == "docker" || envClass == "swerex_modal" {
		envConfig["image"] = imageName
	} else if envClass == "singularity" || envClass == "contree" {
		envConfig["image"] = "docker://" + imageName
	}
	return env.GetEnvironment(envConfig, "docker")
}

// UpdatePredsFile updates the predictions JSON file.
func UpdatePredsFile(outputDir, instanceID, modelName, result string) error {
	predsPath := filepath.Join(outputDir, "preds.json")
	data := map[string]any{}
	if content, err := os.ReadFile(predsPath); err == nil {
		json.Unmarshal(content, &data)
	}
	data[instanceID] = map[string]any{
		"model_name_or_path": modelName,
		"instance_id":        instanceID,
		"model_patch":        result,
	}
	content, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(predsPath, content, 0644)
}

// FilterInstances filters and slices instances.
func FilterInstances(instances []map[string]any, filterSpec, sliceSpec string, shuffle bool) []map[string]any {
	result := instances
	if filterSpec != "" {
		re := regexp.MustCompile(filterSpec)
		filtered := make([]map[string]any, 0)
		for _, inst := range result {
			iid, _ := inst["instance_id"].(string)
			if re.MatchString(iid) {
				filtered = append(filtered, inst)
			}
		}
		result = filtered
	}
	if sliceSpec != "" {
		parts := strings.Split(sliceSpec, ":")
		start, end := 0, len(result)
		if len(parts) >= 1 && parts[0] != "" {
			fmt.Sscanf(parts[0], "%d", &start)
		}
		if len(parts) >= 2 && parts[1] != "" {
			fmt.Sscanf(parts[1], "%d", &end)
		}
		if start < 0 {
			start = len(result) + start
		}
		if end < 0 {
			end = len(result) + end
		}
		if start > len(result) {
			start = len(result)
		}
		if end > len(result) {
			end = len(result)
		}
		result = result[start:end]
	}
	if shuffle {
		sort.Slice(result, func(i, j int) bool {
			ai, _ := result[i]["instance_id"].(string)
			aj, _ := result[j]["instance_id"].(string)
			return ai < aj
		})
	}
	return result
}

// SwebenchOptions holds options for the SWE-Bench runner.
type SwebenchOptions struct {
	Subset           string
	Split            string
	Slice            string
	Filter           string
	Shuffle          bool
	Output           string
	Workers          int
	Model            string
	ModelClass       string
	RedoExisting     bool
	ConfigSpec       []string
	EnvironmentClass string
}

// RunSwebench runs SWE-Bench in batch mode.
func RunSwebench(opts SwebenchOptions) error {
	subset := opts.Subset
	if subset == "" {
		subset = "lite"
	}
	split := opts.Split
	if split == "" {
		split = "dev"
	}
	outputDir := opts.Output
	if outputDir != "" {
		os.MkdirAll(outputDir, 0755)
	}

	datasetPath, ok := DatasetMapping[subset]
	if !ok {
		datasetPath = subset
	}
	fmt.Fprintf(os.Stderr, "Loading dataset %s, split %s...\n", datasetPath, split)

	localFile := filepath.Join(outputDir, "instances.json")
	content, err := os.ReadFile(localFile)
	if err != nil {
		return fmt.Errorf("no instances file found at %s: %w", localFile, err)
	}
	var instances []map[string]any
	if err := json.Unmarshal(content, &instances); err != nil {
		return fmt.Errorf("failed to parse instances: %w", err)
	}

	instances = FilterInstances(instances, opts.Filter, opts.Slice, opts.Shuffle)

	if !opts.RedoExisting {
		predsPath := filepath.Join(outputDir, "preds.json")
		if content, err := os.ReadFile(predsPath); err == nil {
			var existing map[string]any
			json.Unmarshal(content, &existing)
			filtered := make([]map[string]any, 0)
			for _, inst := range instances {
				iid, _ := inst["instance_id"].(string)
				if _, exists := existing[iid]; !exists {
					filtered = append(filtered, inst)
				}
			}
			instances = filtered
		}
	}

	fmt.Fprintf(os.Stderr, "Running on %d instances...\n", len(instances))

	// Build config
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
	configs = append(configs, map[string]any{
		"environment": map[string]any{"environment_class": serialize.UnsetIfEmpty(opts.EnvironmentClass)},
		"model":       map[string]any{"model_name": serialize.UnsetIfEmpty(opts.Model), "model_class": serialize.UnsetIfEmpty(opts.ModelClass)},
	})
	finalConfig := serialize.RecursiveMerge(configs...)

	for _, instance := range instances {
		if err := ProcessInstance(instance, outputDir, finalConfig); err != nil {
			fmt.Fprintf(os.Stderr, "Error processing instance: %v\n", err)
		}
	}
	return nil
}

// ProcessInstance processes a single SWE-Bench instance.
func ProcessInstance(instance map[string]any, outputDir string, cfg map[string]any) error {
	instanceID, _ := instance["instance_id"].(string)
	instanceDir := filepath.Join(outputDir, instanceID)
	os.MkdirAll(instanceDir, 0755)

	modelCfg := map[string]any{}
	if m, ok := cfg["model"].(map[string]any); ok {
		for k, v := range m {
			modelCfg[k] = v
		}
	}
	m, err := model.GetModel(modelCfg)
	if err != nil {
		return err
	}

	task, _ := instance["problem_statement"].(string)

	envInterface, err := GetSbEnvironment(cfg, instance)
	if err != nil {
		return err
	}

	agentCfg := map[string]any{}
	if a, ok := cfg["agent"].(map[string]any); ok {
		for k, v := range a {
			agentCfg[k] = v
		}
	}
	a, err := agent.GetAgent(m, envInterface, agentCfg, "interactive")
	if err != nil {
		return err
	}

	info, err := a.Run(task)
	if err != nil {
		return err
	}

	exitStatus, _ := info["exit_status"].(string)
	submission, _ := info["submission"].(string)

	trajPath := filepath.Join(instanceDir, instanceID+".traj.json")
	a.Save(trajPath, map[string]any{
		"info":        map[string]any{"exit_status": exitStatus, "submission": submission},
		"instance_id": instanceID,
	})

	modelName := ""
	if mc := m.GetConfig(); mc != nil {
		if mn, ok := mc["model_name"].(string); ok {
			modelName = mn
		}
	}
	return UpdatePredsFile(outputDir, instanceID, modelName, submission)
}
