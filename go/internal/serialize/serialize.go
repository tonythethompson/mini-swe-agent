// Package serialize provides recursive merge and UNSET sentinel.
// Ported from src/minisweagent/utils/serialize.py
package serialize

// Unset is a sentinel value that is skipped during recursive merge.
type UnsetType struct{}

var Unset = UnsetType{}

// IsUnset returns true if the value is the Unset sentinel.
func IsUnset(v any) bool {
	_, ok := v.(UnsetType)
	return ok
}

// UnsetIfEmpty returns Unset if s is empty, otherwise returns s.
func UnsetIfEmpty(s string) any {
	if s == "" {
		return Unset
	}
	return s
}

// RecursiveMerge merges multiple maps recursively.
// Later maps take precedence over earlier ones.
// Nested maps are merged recursively.
// Unset values are skipped.
func RecursiveMerge(dicts ...map[string]any) map[string]any {
	if len(dicts) == 0 {
		return map[string]any{}
	}
	result := map[string]any{}
	for _, d := range dicts {
		if d == nil {
			continue
		}
		for key, value := range d {
			if IsUnset(value) {
				continue
			}
			if existing, ok := result[key]; ok {
				if existMap, ok1 := existing.(map[string]any); ok1 {
					if valMap, ok2 := value.(map[string]any); ok2 {
						result[key] = RecursiveMerge(existMap, valMap)
						continue
					}
				}
			}
			if valMap, ok := value.(map[string]any); ok {
				// Recursively merge to filter out nested Unset values
				result[key] = RecursiveMerge(valMap)
			} else {
				result[key] = value
			}
		}
	}
	return result
}
