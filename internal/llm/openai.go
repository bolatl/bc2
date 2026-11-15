package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
)

const (
	DefaultOpenAIModel   = "gpt-4o-mini"
	DefaultOpenAIBaseURL = "https://api.openai.com/v1"
	maxResponseBytes     = 1 << 20
)

// openAI calls the Chat Completions API with strict structured outputs.
type openAI struct {
	apiKey, model, baseURL string
	http                   *http.Client
}

func NewOpenAI(apiKey, model, baseURL string, client *http.Client) (*Generator, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("OpenAI API key is empty")
	}
	if model == "" {
		model = DefaultOpenAIModel
	}
	if baseURL == "" {
		baseURL = DefaultOpenAIBaseURL
	}
	if client == nil {
		client = http.DefaultClient
	}
	return newGenerator(&openAI{apiKey: apiKey, model: model, baseURL: strings.TrimRight(baseURL, "/"), http: client}), nil
}

// complete sends input as a JSON data block, so user text is never concatenated
// into instructions, and decodes the strictly schema-bound reply into dst.
func (o *openAI) complete(ctx context.Context, name string, schema map[string]any, task string, in Input, dst any) error {
	data, err := json.Marshal(promptData(in))
	if err != nil {
		return err
	}
	maxTokens := 400
	if name == "conversation_reflection" {
		maxTokens = 1800
	}
	body, err := json.Marshal(map[string]any{
		"model": o.model,
		"messages": []map[string]string{
			{"role": "system", "content": SystemPrompt},
			{"role": "user", "content": userMessage(task, data)},
		},
		"response_format":       map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": name, "strict": true, "schema": schema}},
		"max_completion_tokens": maxTokens,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+o.apiKey)
	req.Header.Set("Content-Type", "application/json")
	resp, err := o.http.Do(req)
	if err != nil {
		logProviderTransportFailure("openai", name, ctx, err)
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		logProviderFailure("openai", name, "response_read")
		return err
	}
	if resp.StatusCode != http.StatusOK {
		// The body is deliberately omitted: it can echo prompt content.
		logProviderFailure("openai", name, "http_status", "http_status", resp.StatusCode)
		return fmt.Errorf("openai: unexpected status %d", resp.StatusCode)
	}
	var parsed struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string `json:"content"`
				Refusal string `json:"refusal"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		logProviderFailure("openai", name, "decode_response")
		return fmt.Errorf("openai: decode response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		logProviderFailure("openai", name, "empty_response")
		return errors.New("openai: empty response")
	}
	choice := parsed.Choices[0]
	if choice.Message.Refusal != "" || choice.FinishReason != "stop" {
		logProviderFailure("openai", name, "unusable_completion", "stop_reason", safeCompletionReason(choice.FinishReason), "refused", choice.Message.Refusal != "")
		return fmt.Errorf("openai: no usable completion (finish_reason %q)", choice.FinishReason)
	}
	if err := decodeStrict(choice.Message.Content, dst); err != nil {
		logProviderFailure("openai", name, "decode_content")
		return err
	}
	return nil
}

// Diagnostic fields are deliberately allowlisted: provider errors and generated
// bodies can contain private prompt text and must never be logged verbatim.
func logProviderFailure(provider, operation, reason string, fields ...any) {
	switch operation {
	case "question", "topic", "result", "conversation_reflection":
	default:
		operation = "unknown"
	}
	attrs := []any{"provider", provider, "operation", operation, "reason_code", reason}
	slog.Warn("LLM provider request failed", append(attrs, fields...)...)
}

func logProviderTransportFailure(provider, operation string, ctx context.Context, err error) {
	reason := "transport"
	var networkError net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.Is(ctx.Err(), context.DeadlineExceeded):
		reason = "timeout"
	case errors.Is(err, context.Canceled), errors.Is(ctx.Err(), context.Canceled):
		reason = "canceled"
	case errors.As(err, &networkError) && networkError.Timeout():
		reason = "timeout"
	}
	logProviderFailure(provider, operation, reason)
}

func safeCompletionReason(reason string) string {
	switch reason {
	case "stop", "length", "content_filter", "tool_calls", "function_call", "end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal", "model_context_window_exceeded":
		return reason
	default:
		return "unknown"
	}
}
