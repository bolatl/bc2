package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// Match the provider's schema restrictions, instead of accepting every request
// as the older HTTP fixtures did. Bounds still belong in reflectionProblem.
func TestAnthropicReflectionUsesSupportedArraySchema(t *testing.T) {
	response, err := NewMock().AnalyzeReflection(context.Background(), Input{})
	if err != nil {
		t.Fatal(err)
	}
	response.Summary = "A reflection returned by the provider."
	content, _ := json.Marshal(response)
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		format := request["output_config"].(map[string]any)["format"].(map[string]any)
		if unsupportedArrayConstraint(format["schema"]) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Unsupported array constraint"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "msg_reflection", "type": "message", "role": "assistant", "model": "test",
			"stop_reason": "end_turn", "usage": map[string]int{"input_tokens": 1, "output_tokens": 1},
			"content": []map[string]string{{"type": "text", "text": string(content)}},
		})
	}))
	defer server.Close()
	client, err := NewAnthropic("test-key", "test", server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	got, err := client.AnalyzeReflection(context.Background(), Input{})
	if err != nil || got.Summary != response.Summary || calls != 1 {
		t.Fatalf("provider reflection failed: err=%v calls=%d summary=%q", err, calls, got.Summary)
	}
}

func unsupportedArrayConstraint(value any) bool {
	switch node := value.(type) {
	case map[string]any:
		for key, child := range node {
			if key == "maxItems" || key == "minItems" && child.(float64) > 1 {
				return true
			}
			if unsupportedArrayConstraint(child) {
				return true
			}
		}
	case []any:
		for _, child := range node {
			if unsupportedArrayConstraint(child) {
				return true
			}
		}
	}
	return false
}
