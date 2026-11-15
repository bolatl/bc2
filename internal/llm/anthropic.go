package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
)

const DefaultAnthropicModel = "claude-opus-5-5"

// anthropicClient calls the Messages API with schema-constrained output.
type anthropicClient struct {
	client anthropic.Client
	model  string
}

// NewAnthropic builds a Claude-backed generator. baseURL is optional.
func NewAnthropic(apiKey, model, baseURL string, client *http.Client) (*Generator, error) {
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("Anthropic API key is empty")
	}
	if model == "" {
		model = DefaultAnthropicModel
	}
	opts := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" {
		opts = append(opts, option.WithBaseURL(baseURL))
	}
	if client != nil {
		opts = append(opts, option.WithHTTPClient(client))
	}
	return newGenerator(&anthropicClient{client: anthropic.NewClient(opts...), model: model}), nil
}

func (a *anthropicClient) complete(ctx context.Context, name string, schema map[string]any, task string, in Input, dst any) error {
	data, err := json.Marshal(promptData(in))
	if err != nil {
		return err
	}
	maxTokens := int64(1024)
	if name == "conversation_reflection" {
		maxTokens = 1800
	}
	msg, err := a.client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.Model(a.model),
		MaxTokens: maxTokens,
		System:    []anthropic.TextBlockParam{{Text: SystemPrompt}},
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock(userMessage(task, data)))},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
			Format: anthropic.JSONOutputFormatParam{Schema: schema},
		},
	})
	if err != nil {
		// Surface only the status: API errors can echo prompt content.
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) {
			logProviderFailure("anthropic", name, "http_status", "http_status", apiErr.StatusCode)
			return fmt.Errorf("anthropic: unexpected status %d", apiErr.StatusCode)
		}
		logProviderTransportFailure("anthropic", name, ctx, err)
		return err
	}
	if msg.StopReason != anthropic.StopReasonEndTurn {
		logProviderFailure("anthropic", name, "unusable_completion", "stop_reason", safeCompletionReason(string(msg.StopReason)))
		return fmt.Errorf("anthropic: no usable completion (stop_reason %q)", msg.StopReason)
	}
	for _, block := range msg.Content {
		if text, ok := block.AsAny().(anthropic.TextBlock); ok {
			if err := decodeStrict(text.Text, dst); err != nil {
				logProviderFailure("anthropic", name, "decode_content")
				return err
			}
			return nil
		}
	}
	logProviderFailure("anthropic", name, "empty_response")
	return errors.New("anthropic: no text block in response")
}
