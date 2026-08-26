// Package model provides model implementations.
// Ported from src/minisweagent/models/test_models.py
package model

import (
	"time"

	"github.com/tonythethompson/mini-swe-agent/go/internal/core"
	"github.com/tonythethompson/mini-swe-agent/go/internal/exceptions"
	"github.com/tonythethompson/mini-swe-agent/go/internal/model/actions"
)

// MakeOutput creates an output message for DeterministicModel.
func MakeOutput(content string, actionList []exceptions.Action, cost float64) exceptions.Message {
	return exceptions.Message{
		Role:    "assistant",
		Content: content,
		Extra: map[string]any{
			"actions":   actionList,
			"cost":      cost,
			"timestamp": float64(time.Now().UnixNano()) / 1e9,
		},
	}
}

// DeterministicModel returns pre-set outputs in sequence.
type DeterministicModel struct {
	Config          map[string]any
	outputs         []exceptions.Message
	costPerCall     float64
	obsTemplate     string
	multimodalRegex string
	currentIndex    int
}

// NewDeterministicModel creates a DeterministicModel from config.
func NewDeterministicModel(config map[string]any) *DeterministicModel {
	m := &DeterministicModel{Config: config, currentIndex: -1}
	if outputs, ok := config["outputs"].([]exceptions.Message); ok {
		m.outputs = outputs
	} else if outputs, ok := config["outputs"].([]any); ok {
		for _, o := range outputs {
			if msg, ok := o.(exceptions.Message); ok {
				m.outputs = append(m.outputs, msg)
			}
		}
	}
	m.costPerCall = 1.0
	if cpc, ok := config["cost_per_call"].(float64); ok {
		m.costPerCall = cpc
	}
	m.obsTemplate = defaultObservationTemplate
	if t, ok := config["observation_template"].(string); ok {
		m.obsTemplate = t
	}
	m.multimodalRegex = ""
	if r, ok := config["multimodal_regex"].(string); ok {
		m.multimodalRegex = r
	}
	return m
}

// GetConfig returns the model config.
func (m *DeterministicModel) GetConfig() map[string]any { return m.Config }

// Query returns the next pre-set output.
func (m *DeterministicModel) Query(_ []exceptions.Message) (exceptions.Message, error) {
	m.currentIndex++
	if m.currentIndex >= len(m.outputs) {
		return exceptions.Message{}, &exceptions.InterruptAgentFlow{Msg: "no more outputs"}
	}
	output := m.outputs[m.currentIndex]
	_ = GlobalModelStatsInstance.Add(m.costPerCall)
	return output, nil
}

// FormatMessage formats a message.
func (m *DeterministicModel) FormatMessage(kwargs map[string]any) exceptions.Message {
	role := getStr(kwargs, "role", "user")
	content := kwargs["content"]
	msg := exceptions.Message{Role: role, Content: content}
	if extra, ok := kwargs["extra"]; ok {
		if em, ok := extra.(map[string]any); ok {
			msg.Extra = em
		}
	}
	return msg
}

// FormatObservationMessages formats execution outputs into observation messages.
func (m *DeterministicModel) FormatObservationMessages(_ exceptions.Message, outputs []exceptions.EnvOutput, templateVars map[string]any) []exceptions.Message {
	return actions.FormatObservationMessages(outputs, m.obsTemplate, templateVars, m.multimodalRegex)
}

// GetTemplateVars returns the model config as template variables.
func (m *DeterministicModel) GetTemplateVars() map[string]any {
	return map[string]any{
		"outputs":              m.outputs,
		"cost_per_call":        m.costPerCall,
		"observation_template": m.obsTemplate,
		"multimodal_regex":     m.multimodalRegex,
	}
}

// Serialize returns the model state for trajectory saving.
func (m *DeterministicModel) Serialize() map[string]any {
	return map[string]any{
		"info": map[string]any{
			"config": map[string]any{
				"model":      m.Config,
				"model_type": "DeterministicModel",
			},
		},
	}
}

// Ensure core is used
var _ core.Model = (*LitellmModel)(nil)
var _ core.Model = (*DeterministicModel)(nil)
