package huggingface

import (
	"encoding/json"
	"testing"
	"time"
)

func TestFlexibleTime_UnmarshalJSON(t *testing.T) {
	t.Run("rfc3339", func(t *testing.T) {
		var ft FlexibleTime
		if err := json.Unmarshal([]byte(`"2025-04-14T02:31:00.353Z"`), &ft); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		want := time.Date(2025, 4, 14, 2, 31, 0, 353_000_000, time.UTC)
		if !ft.Time.Equal(want) {
			t.Fatalf("got %s want %s", ft.Time.Format(time.RFC3339Nano), want.Format(time.RFC3339Nano))
		}
	})

	t.Run("no_timezone", func(t *testing.T) {
		var ft FlexibleTime
		if err := json.Unmarshal([]byte(`"2025-04-14T02:31:00.353"`), &ft); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		want := time.Date(2025, 4, 14, 2, 31, 0, 353_000_000, time.UTC)
		if !ft.Time.Equal(want) {
			t.Fatalf("got %s want %s", ft.Time.Format(time.RFC3339Nano), want.Format(time.RFC3339Nano))
		}
	})

	t.Run("null", func(t *testing.T) {
		var ft FlexibleTime
		if err := json.Unmarshal([]byte(`null`), &ft); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		if !ft.Time.IsZero() {
			t.Fatalf("expected zero time, got %s", ft.Time)
		}
	})
}
