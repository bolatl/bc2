package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	body, err := json.Marshal(map[string]any{
		"model": o.model,
		"messages": []map[string]string{
			{"role": "system", "content": SystemPrompt},
			{"role": "user", "content": userMessage(task, data)},
		},
		"response_format":       map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": name, "strict": true, "schema": schema}},
		"max_completion_tokens": 400,
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
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		// The body is deliberately omitted: it can echo prompt content.
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
		return fmt.Errorf("openai: decode response: %w", err)
	}
	if len(parsed.Choices) == 0 {
		return errors.New("openai: empty response")
	}
	choice := parsed.Choices[0]
	if choice.Message.Refusal != "" || choice.FinishReason != "stop" {
		return fmt.Errorf("openai: no usable completion (finish_reason %q)", choice.FinishReason)
	}
	return decodeStrict(choice.Message.Content, dst)
}
