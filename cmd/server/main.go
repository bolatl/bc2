package main

import (
	"context"
	"errors"
	"log/slog"
	"lovelab/internal/config"
	"lovelab/internal/handler"
	"lovelab/internal/llm"
	"lovelab/internal/payment"
	"lovelab/internal/service"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}
	var payments payment.Client = payment.NewMock(cfg.FrontendURL)
	paymentMode := "mock"
	if cfg.StripeSecretKey != "" {
		stripe, e := payment.NewStripe(cfg.StripeSecretKey, cfg.FrontendURL, &http.Client{Timeout: 15 * time.Second})
		if e != nil {
			slog.Error("invalid Stripe test configuration", "error", e)
			os.Exit(1)
		}
		payments = stripe
		paymentMode = "stripe_test"
	}
	var generator llm.Client = llm.NewMock()
	llmMode := "mock"
	if cfg.LLMAPIKey != "" {
		httpClient := &http.Client{Timeout: 30 * time.Second}
		var g *llm.Generator
		var e error
		if cfg.LLMProvider == "anthropic" {
			g, e = llm.NewAnthropic(cfg.LLMAPIKey, cfg.LLMModel, cfg.LLMBaseURL, httpClient)
		} else {
			g, e = llm.NewOpenAI(cfg.LLMAPIKey, cfg.LLMModel, cfg.LLMBaseURL, httpClient)
		}
		if e != nil {
			slog.Error("invalid LLM configuration", "error", e)
			os.Exit(1)
		}
		generator = g
		llmMode = cfg.LLMProvider
	}
	app := service.New(cfg, generator, payments)
	server := &http.Server{Addr: cfg.Addr, Handler: handler.New(app), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	stopped := make(chan struct{})
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := server.Shutdown(shutdown); err != nil {
			slog.Error("shutdown failed", "error", err)
			_ = server.Close()
		}
		close(stopped)
	}()
	slog.Info("Love Lab backend listening", "address", cfg.Addr, "llm_mode", llmMode, "payment_mode", paymentMode)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
	<-stopped
}
