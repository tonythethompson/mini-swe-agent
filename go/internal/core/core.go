// Package core provides the core interfaces for mini-SWE-agent.
// Ported from src/minisweagent/__init__.py
package core

import (
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
)

// Version is the current version of the Go port.
const Version = "2.4.6-go"

// Model is the interface for language models.
type Model interface {
	GetConfig() map[string]any
	Query(messages []exceptions.Message) (exceptions.Message, error)
	FormatMessage(kwargs map[string]any) exceptions.Message
	FormatObservationMessages(message exceptions.Message, outputs []exceptions.EnvOutput, templateVars map[string]any) []exceptions.Message
	GetTemplateVars() map[string]any
	Serialize() map[string]any
}

// Environment is the interface for execution environments.
type Environment interface {
	GetConfig() map[string]any
	Execute(action exceptions.Action, cwd string) (exceptions.EnvOutput, error)
	GetTemplateVars() map[string]any
	Serialize() map[string]any
}

// Agent is the interface for agents.
type Agent interface {
	GetConfig() map[string]any
	Run(task string) (map[string]any, error)
	Save(filePath string, extraDicts ...map[string]any) map[string]any
}
