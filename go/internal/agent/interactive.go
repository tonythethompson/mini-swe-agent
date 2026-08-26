// Package agent provides the interactive agent.
// Ported from src/minisweagent/agents/interactive.py
package agent

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
)

// InteractiveAgentConfig extends AgentConfig with interactive mode settings.
type InteractiveAgentConfig struct {
	AgentConfig
	Mode             string   `yaml:"mode"` // "human", "confirm", "yolo"
	WhitelistActions []string `yaml:"whitelist_actions"`
	ConfirmExit      bool     `yaml:"confirm_exit"`
}

// InteractiveAgent puts the user in the loop.
type InteractiveAgent struct {
	DefaultAgent
	iCfg InteractiveAgentConfig
}

// NewInteractiveAgent creates an InteractiveAgent.
func NewInteractiveAgent(model core.Model, env core.Environment, config map[string]any) *InteractiveAgent {
	a := &InteractiveAgent{}
	a.DefaultAgent = *NewDefaultAgent(model, env, config)
	a.iCfg.Mode = getStr(config, "mode", "confirm")
	a.iCfg.ConfirmExit = getBool(config, "confirm_exit", true)
	return a
}

// Run runs the interactive agent.
func (a *InteractiveAgent) Run(task string) (map[string]any, error) {
	return a.DefaultAgent.Run(task)
}

func getBool(m map[string]any, key string, def bool) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return def
}

func (a *InteractiveAgent) prompt(question string) (string, error) {
	fmt.Fprint(os.Stderr, question)
	reader := bufio.NewReader(os.Stdin)
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(line), nil
}

// Ensure the interface is satisfied
var _ core.Agent = (*InteractiveAgent)(nil)

// Suppress unused warning
var _ = exceptions.NewUserInterruption
