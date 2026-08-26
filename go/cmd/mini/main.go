// Package main is the CLI entry point for mini-SWE-agent (Go).
// Ported from src/minisweagent/run/mini.py (typer -> cobra)
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/spf13/cobra"
	"github.com/tonythethompson/mini-swe-agent/go/internal/config"
	"github.com/tonythethompson/mini-swe-agent/go/internal/run"
)

func main() {
	// Set builtin config dir relative to this source file
	// When running from source, configs are in ../internal/config/
	exePath, _ := os.Executable()
	config.SetBuiltinConfigDir(filepath.Join(filepath.Dir(exePath), "..", "config"))

	var opts run.MiniOptions

	cmd := &cobra.Command{
		Use:   "mini",
		Short: "Run mini-SWE-agent in your local environment",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run.RunMini(opts)
		},
	}

	cmd.Flags().StringVarP(&opts.Model, "model", "m", "", "Model to use")
	cmd.Flags().StringVar(&opts.ModelClass, "model-class", "", "Model class to use (e.g., 'litellm')")
	cmd.Flags().StringVar(&opts.AgentClass, "agent-class", "", "Agent class to use (e.g., 'interactive')")
	cmd.Flags().StringVar(&opts.EnvironmentClass, "environment-class", "", "Environment class to use (e.g., 'local')")
	cmd.Flags().StringVarP(&opts.Task, "task", "t", "", "Task/problem statement")
	cmd.Flags().BoolVarP(&opts.Yolo, "yolo", "y", false, "Run without confirmation")
	cmd.Flags().Float64VarP(&opts.CostLimit, "cost-limit", "l", 0, "Cost limit. Set to 0 to disable.")
	cmd.Flags().StringArrayVarP(&opts.ConfigSpec, "config", "c", nil, "Config file paths, filenames, or key-value pairs")
	cmd.Flags().StringVarP(&opts.Output, "output", "o", "", "Output trajectory file")
	cmd.Flags().BoolVar(&opts.ExitImmediately, "exit-immediately", false, "Exit immediately when the agent wants to finish")

	if err := cmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
