// Package serialize provides tests for recursive merge.
package serialize

import (
	"testing"
)

func TestRecursiveMerge(t *testing.T) {
	result := RecursiveMerge(
		map[string]any{"a": 1, "b": map[string]any{"c": 2, "d": 3}},
		map[string]any{"b": map[string]any{"d": 4, "e": 5}, "f": Unset},
	)
	if result["a"] != 1 {
		t.Errorf("expected a=1, got %v", result["a"])
	}
	b := result["b"].(map[string]any)
	if b["c"] != 2 {
		t.Errorf("expected b.c=2, got %v", b["c"])
	}
	if b["d"] != 4 {
		t.Errorf("expected b.d=4, got %v", b["d"])
	}
	if b["e"] != 5 {
		t.Errorf("expected b.e=5, got %v", b["e"])
	}
	if _, ok := result["f"]; ok {
		t.Errorf("expected f to be unset (absent)")
	}
}

func TestRecursiveMergeUnset(t *testing.T) {
	result := RecursiveMerge(
		map[string]any{"a": Unset, "b": 2},
	)
	if _, ok := result["a"]; ok {
		t.Errorf("expected a to be absent (Unset)")
	}
	if result["b"] != 2 {
		t.Errorf("expected b=2, got %v", result["b"])
	}
}
