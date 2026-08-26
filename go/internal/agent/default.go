// Package agent provides agent implementations.
// Ported from src/minisweagent/agents/default.py
package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/serialize"
	"github.com/tonythethompson/mini-swe-agent/go/internal/utils/jinja"
)

// AgentConfig holds configuration for the default agent.
type AgentConfig struct {
	SystemTemplate             string  `yaml:"system_template"`
	InstanceTemplate           string  `yaml:"instance_template"`
	StepLimit                  int     `yaml:"step_limit"`
	CostLimit                  float64 `yaml:"cost_limit"`
	WallTimeLimitSeconds       int     `yaml:"wall_time_limit_seconds"`
	MaxConsecutiveFormatErrors int     `yaml:"max_consecutive_format_errors"`
	OutputPath                 string  `yaml:"output_path"`
}

// DefaultAgent is the basic agent that runs step() until finished.
type DefaultAgent struct {
	Config                   AgentConfig
	cfgMap                   map[string]any
	Messages                 []exceptions.Message
	model                    core.Model
	env                      core.Environment
	extraTemplateVars        map[string]any
	Cost                     float64
	NCalls                   int
	nConsecutiveFormatErrors int
	startTime                time.Time
}

// NewDefaultAgent creates a DefaultAgent from model, env, and config.
func NewDefaultAgent(model core.Model, env core.Environment, config map[string]any) *DefaultAgent {
	a := &DefaultAgent{
		cfgMap:            config,
		model:             model,
		env:               env,
		extraTemplateVars: map[string]any{},
		startTime:         time.Now(),
	}
	a.Config.SystemTemplate = getStr(config, "system_template", "")
	a.Config.InstanceTemplate = getStr(config, "instance_template", "")
	a.Config.StepLimit = getInt(config, "step_limit", 0)
	a.Config.CostLimit = getFloat(config, "cost_limit", 3.0)
	a.Config.WallTimeLimitSeconds = getInt(config, "wall_time_limit_seconds", 0)
	a.Config.MaxConsecutiveFormatErrors = getInt(config, "max_consecutive_format_errors", 3)
	a.Config.OutputPath = getStr(config, "output_path", "")
	return a
}

// GetConfig returns the agent config as a map.
func (a *DefaultAgent) GetConfig() map[string]any { return a.cfgMap }

// GetTemplateVars returns all template variables merged together.
func (a *DefaultAgent) GetTemplateVars() map[string]any {
	return serialize.RecursiveMerge(
		map[string]any{
			"system_template":               a.Config.SystemTemplate,
			"instance_template":             a.Config.InstanceTemplate,
			"step_limit":                    a.Config.StepLimit,
			"cost_limit":                    a.Config.CostLimit,
			"wall_time_limit_seconds":       a.Config.WallTimeLimitSeconds,
			"max_consecutive_format_errors": a.Config.MaxConsecutiveFormatErrors,
			"output_path":                   a.Config.OutputPath,
		},
		a.env.GetTemplateVars(),
		a.model.GetTemplateVars(),
		map[string]any{
			"n_model_calls":   a.NCalls,
			"model_cost":      a.Cost,
			"elapsed_seconds": int(time.Since(a.startTime).Seconds()),
		},
		a.extraTemplateVars,
	)
}

func (a *DefaultAgent) renderTemplate(tmpl string) string {
	return jinja.Render(tmpl, a.GetTemplateVars())
}

// AddMessages appends messages to the conversation.
func (a *DefaultAgent) AddMessages(messages ...exceptions.Message) []exceptions.Message {
	a.Messages = append(a.Messages, messages...)
	return messages
}

// Run runs step() until the agent is finished.
func (a *DefaultAgent) Run(task string) (map[string]any, error) {
	// Merge task into extra template vars
	for k, v := range map[string]any{"task": task} {
		a.extraTemplateVars[k] = v
	}
	a.Messages = nil
	a.AddMessages(
		a.model.FormatMessage(map[string]any{"role": "system", "content": a.renderTemplate(a.Config.SystemTemplate)}),
		a.model.FormatMessage(map[string]any{"role": "user", "content": a.renderTemplate(a.Config.InstanceTemplate)}),
	)

	for {
		func() {
			defer func() {
				// Save on every iteration
				a.Save(a.Config.OutputPath)
			}()
			err := a.step()
			if err != nil {
				if isInterruptError(err) {
					// Handle FormatError specially (track consecutive errors)
					if fe, ok := err.(*exceptions.FormatError); ok {
						cost := 0.0
						if len(fe.Messages) > 0 && fe.Messages[0].Extra != nil {
							if c, ok := fe.Messages[0].Extra["cost"].(float64); ok {
								cost = c
							}
						}
						a.Cost += cost
						a.nConsecutiveFormatErrors++
						if a.Config.MaxConsecutiveFormatErrors > 0 && a.nConsecutiveFormatErrors >= a.Config.MaxConsecutiveFormatErrors {
							a.AddMessages(fe.Messages...)
							a.AddMessages(exceptions.Message{
								Role:    "exit",
								Content: "RepeatedFormatError",
								Extra:   map[string]any{"exit_status": "RepeatedFormatError", "submission": ""},
							})
						} else {
							a.AddMessages(fe.Messages...)
						}
					} else {
						// Submitted, LimitsExceeded, TimeExceeded, UserInterruption, InterruptAgentFlow
						msgs := getInterruptMessages(err)
						if msgs != nil {
							a.AddMessages(msgs...)
						}
						// If no messages (e.g. "no more outputs"), add an exit message
						if len(a.Messages) == 0 || a.Messages[len(a.Messages)-1].Role != "exit" {
							a.AddMessages(exceptions.Message{
								Role:    "exit",
								Content: err.Error(),
								Extra:   map[string]any{"exit_status": err.Error(), "submission": ""},
							})
						}
					}
				} else {
					a.handleUncaughtException(err)
					panic(err)
				}
			} else {
				a.nConsecutiveFormatErrors = 0
			}
		}()

		if len(a.Messages) > 0 && a.Messages[len(a.Messages)-1].Role == "exit" {
			break
		}
	}

	if len(a.Messages) > 0 {
		if extra := a.Messages[len(a.Messages)-1].Extra; extra != nil {
			return extra, nil
		}
	}
	return map[string]any{}, nil
}

func (a *DefaultAgent) step() error {
	msg, err := a.query()
	if err != nil {
		return err
	}
	return a.executeActions(msg)
}

func (a *DefaultAgent) query() (exceptions.Message, error) {
	if (a.Config.StepLimit > 0 && a.Config.StepLimit <= a.NCalls) ||
		(a.Config.CostLimit > 0 && a.Config.CostLimit <= a.Cost) {
		return exceptions.Message{}, exceptions.NewLimitsExceeded(exceptions.Message{
			Role: "exit", Content: "LimitsExceeded",
			Extra: map[string]any{"exit_status": "LimitsExceeded", "submission": ""},
		})
	}
	if a.Config.WallTimeLimitSeconds > 0 && a.Config.WallTimeLimitSeconds <= int(time.Since(a.startTime).Seconds()) {
		return exceptions.Message{}, exceptions.NewTimeExceeded(exceptions.Message{
			Role: "exit", Content: "TimeExceeded",
			Extra: map[string]any{"exit_status": "TimeExceeded", "submission": ""},
		})
	}
	a.NCalls++
	msg, err := a.model.Query(a.Messages)
	if err != nil {
		return exceptions.Message{}, err
	}
	if msg.Extra != nil {
		if cost, ok := msg.Extra["cost"].(float64); ok {
			a.Cost += cost
		}
	}
	a.AddMessages(msg)
	return msg, nil
}

func (a *DefaultAgent) executeActions(message exceptions.Message) error {
	var actionList []exceptions.Action
	if message.Extra != nil {
		if actionsRaw, ok := message.Extra["actions"]; ok {
			if actionsSlice, ok := actionsRaw.([]exceptions.Action); ok {
				actionList = actionsSlice
			}
		}
	}
	var outputs []exceptions.EnvOutput
	for _, action := range actionList {
		out, err := a.env.Execute(action, "")
		if err != nil {
			if isInterruptError(err) {
				outputs = append(outputs, out)
				a.AddMessages(a.model.FormatObservationMessages(message, outputs, a.GetTemplateVars())...)
				return err
			}
			return err
		}
		outputs = append(outputs, out)
	}
	obsMessages := a.model.FormatObservationMessages(message, outputs, a.GetTemplateVars())
	a.AddMessages(obsMessages...)
	return nil
}

func (a *DefaultAgent) handleUncaughtException(e error) {
	a.AddMessages(a.model.FormatMessage(map[string]any{
		"role":    "exit",
		"content": e.Error(),
		"extra": map[string]any{
			"exit_status":   fmt.Sprintf("%T", e),
			"submission":    "",
			"exception_str": e.Error(),
		},
	}))
}

// Serialize returns the agent state as a nested map for saving.
func (a *DefaultAgent) Serialize(extraDicts ...map[string]any) map[string]any {
	lastExtra := map[string]any{}
	if len(a.Messages) > 0 && a.Messages[len(a.Messages)-1].Extra != nil {
		lastExtra = a.Messages[len(a.Messages)-1].Extra
	}
	agentData := map[string]any{
		"info": map[string]any{
			"model_stats": map[string]any{
				"instance_cost": a.Cost,
				"api_calls":     a.NCalls,
			},
			"config": map[string]any{
				"agent":      a.cfgMap,
				"agent_type": "DefaultAgent",
			},
			"mini_version": core.Version,
			"exit_status":  lastExtra["exit_status"],
			"submission":   lastExtra["submission"],
		},
		"messages":          a.Messages,
		"trajectory_format": "mini-swe-agent-1.1",
	}
	dicts := append([]map[string]any{agentData, a.model.Serialize(), a.env.Serialize()}, extraDicts...)
	return serialize.RecursiveMerge(dicts...)
}

// Save saves the trajectory to a file if path is given. Returns full serialized data.
func (a *DefaultAgent) Save(filePath string, extraDicts ...map[string]any) map[string]any {
	data := a.Serialize(extraDicts...)
	if filePath != "" {
		dir := filepath.Dir(filePath)
		os.MkdirAll(dir, 0755)
		b, _ := json.MarshalIndent(data, "", "  ")
		os.WriteFile(filePath, b, 0644)
	}
	return data
}

// isInterruptError returns true if the error is any InterruptAgentFlow-derived exception.
func isInterruptError(err error) bool {
	switch err.(type) {
	case *exceptions.InterruptAgentFlow, *exceptions.Submitted, *exceptions.LimitsExceeded,
		*exceptions.TimeExceeded, *exceptions.UserInterruption, *exceptions.FormatError:
		return true
	}
	return false
}

// getInterruptMessages returns the messages from any InterruptAgentFlow-derived error,
// or nil if the error is not an interrupt-type exception or has no messages.
func getInterruptMessages(err error) []exceptions.Message {
	switch e := err.(type) {
	case *exceptions.InterruptAgentFlow:
		return e.Messages
	case *exceptions.Submitted:
		return e.Messages
	case *exceptions.LimitsExceeded:
		return e.Messages
	case *exceptions.TimeExceeded:
		return e.Messages
	case *exceptions.UserInterruption:
		return e.Messages
	case *exceptions.FormatError:
		return e.Messages
	}
	return nil
}

func getStr(m map[string]any, key, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

func getInt(m map[string]any, key string, def int) int {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case int:
			return n
		case int64:
			return int(n)
		case float64:
			return int(n)
		}
	}
	return def
}

func getFloat(m map[string]any, key string, def float64) float64 {
	if v, ok := m[key]; ok {
		switch n := v.(type) {
		case float64:
			return n
		case int:
			return float64(n)
		case int64:
			return float64(n)
		}
	}
	return def
}
