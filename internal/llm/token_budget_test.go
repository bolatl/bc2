package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestProviderTokenBudgetsAllowLongerReflection(t *testing.T) {
	for _, provider := range []string{"openai", "anthropic"} {
		t.Run(provider, func(t *testing.T) {
			requests := []map[string]any{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request map[string]any
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
				}
				requests = append(requests, request)
				w.Header().Set("Content-Type", "application/json")
				if provider == "openai" {
					_, _ = w.Write([]byte(`{"choices":[{"finish_reason":"stop","message":{"content":"{}"}}]}`))
				} else {
					_, _ = w.Write([]byte(`{"id":"msg_test","type":"message","role":"assistant","model":"m","stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1},"content":[{"type":"text","text":"{}"}]}`))
				}
			}))
			defer server.Close()
			var client *Generator
			var err error
			if provider == "openai" {
				client, err = NewOpenAI("test-key", "", server.URL, server.Client())
			} else {
				client, err = NewAnthropic("test-key", "", server.URL, server.Client())
			}
			if err != nil {
				t.Fatal(err)
			}
			for _, task := range []string{"question", "conversation_reflection"} {
				var out map[string]any
				if err := client.c.complete(context.Background(), task, objectSchema(map[string]any{}), "test", Input{}, &out); err != nil {
					t.Fatal(err)
				}
			}
			field, defaultBudget := "max_completion_tokens", float64(400)
			if provider == "anthropic" {
				field, defaultBudget = "max_tokens", 1024
			}
			if len(requests) != 2 || requests[0][field] != defaultBudget || requests[1][field] != float64(1800) {
				t.Fatalf("unexpected %s token budgets: %+v", provider, requests)
			}
		})
	}
}
