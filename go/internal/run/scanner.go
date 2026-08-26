// Package run provides a simple line scanner for the inspector.
package run

import (
	"bufio"
	"io"
)

// LineScanner reads lines from an io.Reader.
type LineScanner struct {
	scanner *bufio.Scanner
}

// NewLineScanner creates a new LineScanner.
func NewLineScanner(r io.Reader) *LineScanner {
	s := bufio.NewScanner(r)
	s.Buffer(make([]byte, 1024*1024), 1024*1024)
	return &LineScanner{scanner: s}
}

// ReadLine reads a single line. Returns ok=false at EOF.
func (ls *LineScanner) ReadLine() (string, bool) {
	if ls.scanner.Scan() {
		return ls.scanner.Text(), true
	}
	return "", false
}
