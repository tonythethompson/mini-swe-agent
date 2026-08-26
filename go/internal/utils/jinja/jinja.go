// Package jinja provides a minimal Jinja2-compatible template renderer.
// It supports the subset of Jinja2 syntax used by mini-swe-agent configs:
//   - {{ variable }} and {{ object.field }}
//   - {% if condition %} ... {% endif %}
//   - {% if %} ... {% else %} ... {% endif %}
//   - {%- ... -%} whitespace trimming
//   - {{ value | tojson }} filter
//   - {{ value | length }} filter
//   - string slicing: value[:5000], value[-5000:]
package jinja

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Render renders a Jinja2 template string with the given variables.
func Render(template string, vars map[string]any) string {
	return renderString(template, vars)
}

func renderString(tmpl string, vars map[string]any) string {
	// Handle {%- ... -%} and {% ... %} blocks (if/else/endif)
	tmpl = processConditionals(tmpl, vars)
	// Handle {{ ... }} expressions
	tmpl = processExpressions(tmpl, vars)
	return tmpl
}

// processConditionals handles {% if %}, {% else %}, {% endif %} blocks.
func processConditionals(tmpl string, vars map[string]any) string {
	// Pattern for if/else/endif blocks with optional whitespace trimming
	ifPattern := regexp.MustCompile(`\{%-?\s*if\s+(.+?)\s*-?%\}(.*?)(?:\{%-?\s*else\s*-?%\}(.*?))?\{%-?\s*endif\s*-?%\}`)
	for {
		loc := ifPattern.FindStringSubmatchIndex(tmpl)
		if loc == nil {
			break
		}
		condition := tmpl[loc[2]:loc[3]]
		ifBody := tmpl[loc[4]:loc[5]]
		var elseBody string
		if loc[6] != -1 {
			elseBody = tmpl[loc[6]:loc[7]]
		}
		var result string
		if evalCondition(condition, vars) {
			result = ifBody
		} else {
			result = elseBody
		}
		tmpl = tmpl[:loc[0]] + result + tmpl[loc[1]:]
	}
	return tmpl
}

// processExpressions handles {{ ... }} expressions.
func processExpressions(tmpl string, vars map[string]any) string {
	exprPattern := regexp.MustCompile(`\{\{\s*(.+?)\s*\}\}`)
	return exprPattern.ReplaceAllStringFunc(tmpl, func(match string) string {
		sub := exprPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		return evalExpression(sub[1], vars)
	})
}

// evalCondition evaluates a Jinja2 condition string.
func evalCondition(cond string, vars map[string]any) bool {
	cond = strings.TrimSpace(cond)
	// Handle "X is defined" / "X is not defined"
	if strings.Contains(cond, " is defined") {
		varName := strings.TrimSpace(strings.TrimSuffix(cond, " is defined"))
		return getVar(varName, vars) != nil
	}
	if strings.Contains(cond, " is not defined") {
		varName := strings.TrimSpace(strings.TrimSuffix(cond, " is not defined"))
		return getVar(varName, vars) == nil
	}
	// Handle simple truthiness
	val := getVar(cond, vars)
	return isTruthy(val)
}

// evalExpression evaluates a Jinja2 expression string and returns the result as a string.
func evalExpression(expr string, vars map[string]any) string {
	expr = strings.TrimSpace(expr)
	// Handle filters: value | filter
	if parts := strings.Split(expr, " | "); len(parts) > 1 {
		base := strings.TrimSpace(parts[0])
		val := getVar(base, vars)
		for _, filter := range parts[1:] {
			val = applyFilter(val, strings.TrimSpace(filter))
		}
		return valToString(val)
	}
	// Handle slicing: value[:N] or value[-N:]
	if idx := strings.Index(expr, "["); idx != -1 && strings.HasSuffix(expr, "]") {
		base := expr[:idx]
		sliceExpr := expr[idx+1 : len(expr)-1]
		val := getVar(base, vars)
		return valToString(applySlice(val, sliceExpr))
	}
	// Simple variable lookup
	val := getVar(expr, vars)
	return valToString(val)
}

// getVar resolves a variable path like "output.returncode" or "task" from vars.
func getVar(path string, vars map[string]any) any {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil
	}
	parts := strings.Split(path, ".")
	var current any = vars
	for _, part := range parts {
		switch v := current.(type) {
		case map[string]any:
			current = v[part]
		case map[any]any:
			current = v[part]
		default:
			// Try struct field access via JSON-like approach
			return nil
		}
		if current == nil {
			return nil
		}
	}
	return current
}

// isTruthy returns true if the value is truthy in Jinja2 terms.
func isTruthy(val any) bool {
	if val == nil {
		return false
	}
	switch v := val.(type) {
	case bool:
		return v
	case string:
		return v != ""
	case int:
		return v != 0
	case int64:
		return v != 0
	case float64:
		return v != 0
	case []any:
		return len(v) > 0
	case map[string]any:
		return len(v) > 0
	default:
		return true
	}
}

// applyFilter applies a Jinja2 filter to a value.
func applyFilter(val any, filter string) any {
	switch filter {
	case "tojson":
		b, _ := json.Marshal(val)
		return string(b)
	case "length":
		switch v := val.(type) {
		case string:
			return len(v)
		case []any:
			return len(v)
		case map[string]any:
			return len(v)
		}
		return 0
	default:
		return val
	}
}

// applySlice applies a Python-style slice to a string value.
func applySlice(val any, sliceExpr string) any {
	s, ok := val.(string)
	if !ok {
		return val
	}
	sliceExpr = strings.TrimSpace(sliceExpr)
	if strings.HasPrefix(sliceExpr, ":") {
		// [:N] - take first N characters
		n, err := strconv.Atoi(sliceExpr[1:])
		if err != nil {
			return s
		}
		if n < len(s) {
			return s[:n]
		}
		return s
	}
	if strings.HasSuffix(sliceExpr, ":") {
		// [N:] - take from N to end
		n, err := strconv.Atoi(sliceExpr[:len(sliceExpr)-1])
		if err != nil {
			return s
		}
		if n < 0 {
			n = len(s) + n
		}
		if n > len(s) {
			return ""
		}
		return s[n:]
	}
	if strings.Contains(sliceExpr, ":") {
		parts := strings.Split(sliceExpr, ":")
		if len(parts) == 2 {
			start, _ := strconv.Atoi(parts[0])
			end, _ := strconv.Atoi(parts[1])
			if start < 0 {
				start = len(s) + start
			}
			if end < 0 {
				end = len(s) + end
			}
			if start < 0 {
				start = 0
			}
			if end > len(s) {
				end = len(s)
			}
			if start > end {
				return ""
			}
			return s[start:end]
		}
	}
	return s
}

// valToString converts any value to its string representation.
func valToString(val any) string {
	if val == nil {
		return ""
	}
	switch v := val.(type) {
	case string:
		return v
	case bool:
		if v {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case json.Number:
		return v.String()
	default:
		b, err := json.Marshal(val)
		if err != nil {
			return fmt.Sprintf("%v", val)
		}
		return string(b)
	}
}
