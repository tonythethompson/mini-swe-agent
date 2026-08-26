// Package exceptions provides control-flow exceptions for the agent loop.
// Ported from src/minisweagent/exceptions.py
package exceptions

// InterruptAgentFlow is raised to interrupt the agent flow and add messages.
type InterruptAgentFlow struct {
	Messages []Message
	Msg      string
}

func (e *InterruptAgentFlow) Error() string {
	if e.Msg != "" {
		return e.Msg
	}
	return "InterruptAgentFlow"
}

// NewInterrupt creates an InterruptAgentFlow with the given messages.
func NewInterrupt(messages ...Message) *InterruptAgentFlow {
	return &InterruptAgentFlow{Messages: messages}
}

// Submitted is raised when the agent has completed its task.
type Submitted struct{ InterruptAgentFlow }

// NewSubmitted creates a Submitted with the given messages.
func NewSubmitted(messages ...Message) *Submitted {
	return &Submitted{InterruptAgentFlow: *NewInterrupt(messages...)}
}

// LimitsExceeded is raised when the agent has exceeded its cost or step limit.
type LimitsExceeded struct{ InterruptAgentFlow }

// NewLimitsExceeded creates a LimitsExceeded with the given messages.
func NewLimitsExceeded(messages ...Message) *LimitsExceeded {
	return &LimitsExceeded{InterruptAgentFlow: *NewInterrupt(messages...)}
}

// TimeExceeded is raised when the agent has exceeded its wall-clock time limit.
type TimeExceeded struct{ LimitsExceeded }

// NewTimeExceeded creates a TimeExceeded with the given messages.
func NewTimeExceeded(messages ...Message) *TimeExceeded {
	return &TimeExceeded{LimitsExceeded: *NewLimitsExceeded(messages...)}
}

// UserInterruption is raised when the user interrupts the agent.
type UserInterruption struct{ InterruptAgentFlow }

// NewUserInterruption creates a UserInterruption with the given messages.
func NewUserInterruption(messages ...Message) *UserInterruption {
	return &UserInterruption{InterruptAgentFlow: *NewInterrupt(messages...)}
}

// FormatError is raised when the LM's output is not in the expected format.
type FormatError struct{ InterruptAgentFlow }

// NewFormatError creates a FormatError with the given messages.
func NewFormatError(messages ...Message) *FormatError {
	return &FormatError{InterruptAgentFlow: *NewInterrupt(messages...)}
}

// Message is a message in the agent's conversation history.
type Message struct {
	Role       string            `json:"role"`
	Content    interface{}       `json:"content,omitempty"`
	Extra      map[string]any    `json:"extra,omitempty"`
	ToolCalls  []ToolCall        `json:"tool_calls,omitempty"`
	ToolCallID string            `json:"tool_call_id,omitempty"`
}

// ToolCall represents a tool call in the OpenAI format.
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Action is an action parsed from the model's output.
type Action struct {
	Command    string `json:"command"`
	ToolCallID string `json:"tool_call_id,omitempty"`
}

// EnvOutput is the output of executing an action in an environment.
type EnvOutput struct {
	Output        string         `json:"output"`
	ReturnCode    int            `json:"returncode"`
	ExceptionInfo string         `json:"exception_info"`
	Extra         map[string]any `json:"extra,omitempty"`
}
