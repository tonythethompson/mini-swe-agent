// Package config provides configuration loading.
// Ported from src/minisweagent/config/__init__.py
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// BuiltinConfigDir is the directory containing builtin config files.
var BuiltinConfigDir string

func init() {
	// Resolve relative to the executable or module
	BuiltinConfigDir = "."
}

// SetBuiltinConfigDir sets the builtin config directory.
func SetBuiltinConfigDir(dir string) {
	BuiltinConfigDir = dir
}

// GetConfigPath finds the path to a config file.
func GetConfigPath(configSpec string) (string, error) {
	spec := configSpec
	if !strings.HasSuffix(spec, ".yaml") {
		spec += ".yaml"
	}
	candidates := []string{
		filepath.Join(".", spec),
		filepath.Join(os.Getenv("MSWEA_CONFIG_DIR"), spec),
		filepath.Join(BuiltinConfigDir, spec),
		filepath.Join(BuiltinConfigDir, "extra", spec),
		filepath.Join(BuiltinConfigDir, "benchmarks", spec),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("could not find config file for %s (tried: %v)", spec, candidates)
}

// KeyValueSpecToNestedDict interprets key-value specs from the command line.
func KeyValueSpecToNestedDict(configSpec string) (map[string]any, error) {
	parts := strings.SplitN(configSpec, "=", 2)
	if len(parts) != 2 {
		return nil, fmt.Errorf("invalid config spec: %s", configSpec)
	}
	key := parts[0]
	value := parts[1]
	var parsed any = value
	if jsonErr := json.Unmarshal([]byte(value), &parsed); jsonErr == nil {
		// value was valid JSON
	} else {
		// keep as string
		parsed = value
	}
	keys := strings.Split(key, ".")
	for _, k := range keys {
		if k == "" {
			return nil, fmt.Errorf("invalid config spec '%s': empty config key", configSpec)
		}
	}
	result := map[string]any{}
	current := result
	for i := 0; i < len(keys)-1; i++ {
		current[keys[i]] = map[string]any{}
		current = current[keys[i]].(map[string]any)
	}
	current[keys[len(keys)-1]] = parsed
	return result, nil
}

// GetConfigFromSpec returns a config from a spec (file path or key=value).
func GetConfigFromSpec(configSpec string) (map[string]any, error) {
	if strings.Contains(configSpec, "=") {
		return KeyValueSpecToNestedDict(configSpec)
	}
	path, err := GetConfigPath(configSpec)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := yaml.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}
