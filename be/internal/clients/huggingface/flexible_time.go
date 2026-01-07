package huggingface

import (
	"bytes"
	"fmt"
	"strings"
	"time"
)

// FlexibleTime unmarshals timestamps that may be RFC3339/RFC3339Nano or lack a timezone.
// Some upstream APIs return values like "2025-04-14T02:31:00.353" (no offset).
type FlexibleTime struct {
	time.Time
}

func (t *FlexibleTime) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	if bytes.Equal(b, []byte("null")) {
		t.Time = time.Time{}
		return nil
	}
	if len(b) < 2 || b[0] != '"' || b[len(b)-1] != '"' {
		return fmt.Errorf("invalid time JSON: %q", string(b))
	}

	s := strings.TrimSpace(string(b[1 : len(b)-1]))
	if s == "" {
		t.Time = time.Time{}
		return nil
	}

	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.999999999", // no tz, fractional seconds
		"2006-01-02T15:04:05",           // no tz
	}
	for _, layout := range layouts {
		parsed, err := time.Parse(layout, s)
		if err == nil {
			t.Time = parsed
			return nil
		}
	}

	return fmt.Errorf("invalid time %q", s)
}
