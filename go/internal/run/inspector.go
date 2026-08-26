// Package run provides a simple trajectory inspector.
// Ported from src/minisweagent/run/utilities/inspector.py
package run

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model/actions"
)

// MessagesToSteps groups messages into "pages" as shown by the UI.
func MessagesToSteps(messages []exceptions.Message) [][]exceptions.Message {
	var steps [][]exceptions.Message
	var currentStep []exceptions.Message
	for _, message := range messages {
		if (message.Extra != nil && message.Extra["actions"] != nil) || message.Role == "assistant" {
			steps = append(steps, currentStep)
			currentStep = []exceptions.Message{message}
		} else {
			currentStep = append(currentStep, message)
		}
	}
	if len(currentStep) > 0 {
		steps = append(steps, currentStep)
	}
	return steps
}

// LoadTrajectory loads a trajectory file.
func LoadTrajectory(filePath string) ([]exceptions.Message, error) {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}
	// Try as array first
	var messages []exceptions.Message
	if err := json.Unmarshal(content, &messages); err == nil {
		return messages, nil
	}
	// Try as object with "messages" field
	var data map[string]json.RawMessage
	if err := json.Unmarshal(content, &data); err != nil {
		return nil, fmt.Errorf("unrecognized trajectory format")
	}
	if msgRaw, ok := data["messages"]; ok {
		if err := json.Unmarshal(msgRaw, &messages); err != nil {
			return nil, fmt.Errorf("failed to parse messages: %w", err)
		}
		return messages, nil
	}
	return nil, fmt.Errorf("unrecognized trajectory format")
}

// FindTrajectoryFiles finds trajectory files in a directory or returns a single file.
func FindTrajectoryFiles(p string) ([]string, error) {
	absPath, err := filepath.Abs(p)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, fmt.Errorf("path '%s' does not exist", p)
	}
	if !info.IsDir() {
		return []string{absPath}, nil
	}
	var files []string
	err = filepath.Walk(absPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".traj.json") {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(files)
	if len(files) == 0 {
		return nil, fmt.Errorf("no trajectory files found in '%s'", p)
	}
	return files, nil
}

// PrintStep prints a step's messages to the terminal.
func PrintStep(steps [][]exceptions.Message, iStep int) {
	fmt.Print("\033[2J\033[H") // clear screen
	if len(steps) == 0 {
		fmt.Println("No trajectory loaded or empty trajectory")
		return
	}
	step := steps[iStep]
	for _, message := range step {
		contentStr := actions.GetContentString(message)
		role := message.Role
		if role == "" {
			role = "unknown"
		}
		fmt.Printf("\n%s\n%s\n%s\n", strings.Repeat("=", 60), strings.ToUpper(role), strings.Repeat("=", 60))
		fmt.Println(strings.ReplaceAll(contentStr, "\x00", ""))
	}
	fmt.Printf("\n%s\nStep %d/%d\n", strings.Repeat("-", 60), iStep+1, len(steps))
}

// InspectorOptions holds options for the trajectory inspector.
type InspectorOptions struct {
	Path      string
	Reasoning bool
}

// RunInspector runs the interactive trajectory inspector.
// This is a simplified terminal-based viewer.
func RunInspector(opts InspectorOptions) error {
	files, err := FindTrajectoryFiles(opts.Path)
	if err != nil {
		return err
	}

	iTrajectory := 0
	iStep := 0

	loadCurrent := func() ([]exceptions.Message, [][]exceptions.Message) {
		if len(files) == 0 {
			return nil, nil
		}
		msgs, err := LoadTrajectory(files[iTrajectory])
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error loading %s: %v\n", filepath.Base(files[iTrajectory]), err)
			return nil, nil
		}
		steps := MessagesToSteps(msgs)
		iStep = 0
		return msgs, steps
	}

	_, steps := loadCurrent()

	display := func() {
		PrintStep(steps, iStep)
		if len(files) > 0 {
			fmt.Printf("Trajectory %d/%d: %s\n", iTrajectory+1, len(files), filepath.Base(files[iTrajectory]))
		}
	}

	display()

	// Simple command loop
	scanner := NewLineScanner(os.Stdin)
	fmt.Println("Trajectory Inspector - press h for help, q to quit")

	for {
		line, ok := scanner.ReadLine()
		if !ok {
			break
		}
		cmd := strings.TrimSpace(strings.ToLower(line))
		switch cmd {
		case "h":
			fmt.Println("Commands: l/next step, h/prev step, n/next traj, p/prev traj, q/quit")
		case "l", "right":
			if iStep < len(steps)-1 {
				iStep++
				display()
			}
		case "left":
			if iStep > 0 {
				iStep--
				display()
			}
		case "0":
			iStep = 0
			display()
		case "$":
			if len(steps) > 0 {
				iStep = len(steps) - 1
				display()
			}
		case "n":
			if iTrajectory < len(files)-1 {
				iTrajectory++
				_, steps = loadCurrent()
				display()
			}
		case "p":
			if iTrajectory > 0 {
				iTrajectory--
				_, steps = loadCurrent()
				display()
			}
		case "q":
			fmt.Println("\nGoodbye.")
			return nil
		default:
			if cmd != "" {
				fmt.Println("Unknown command. Press h for help.")
			}
		}
	}
	return nil
}
