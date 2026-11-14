package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Addr, FrontendURL, SessionSecret, StripeSecretKey, LLMAPIKey, LLMProvider, LLMModel, LLMBaseURL string
	AllowedOrigins                                                                                  []string
	CookieSecure, EnableRehearsal                                                                   bool
	FreeTurns, MaxTurns, DivergenceThreshold                                                        int
}

func Default() Config {
	return Config{Addr: ":8080", FrontendURL: "http://localhost:5173", AllowedOrigins: []string{"http://localhost:5173"}, FreeTurns: 4, MaxTurns: 12, DivergenceThreshold: 4}
}
func Load() (Config, error) {
	c := Default()
	for key, dst := range map[string]*string{"ADDR": &c.Addr, "FRONTEND_URL": &c.FrontendURL, "SESSION_SECRET": &c.SessionSecret, "STRIPE_SECRET_KEY": &c.StripeSecretKey, "LLM_API_KEY": &c.LLMAPIKey, "LLM_PROVIDER": &c.LLMProvider, "LLM_MODEL": &c.LLMModel, "LLM_BASE_URL": &c.LLMBaseURL} {
		if v := os.Getenv(key); v != "" {
			*dst = v
		}
	}
	c.LLMProvider = strings.ToLower(strings.TrimSpace(c.LLMProvider))
	if c.LLMProvider == "" && c.LLMAPIKey != "" && strings.HasPrefix(c.LLMAPIKey, "sk-ant-") {
		c.LLMProvider = "anthropic"
	} else if c.LLMProvider == "" && c.LLMAPIKey != "" {
		c.LLMProvider = "openai"
	}
	if c.LLMProvider != "" && c.LLMProvider != "openai" && c.LLMProvider != "anthropic" {
		return c, fmt.Errorf("LLM_PROVIDER must be openai or anthropic")
	}
	c.FrontendURL = strings.TrimRight(c.FrontendURL, "/")
	if err := validURL(c.FrontendURL); err != nil {
		return c, fmt.Errorf("FRONTEND_URL: %w", err)
	}
	c.AllowedOrigins = []string{c.FrontendURL}
	if s := os.Getenv("ALLOWED_ORIGINS"); s != "" {
		c.AllowedOrigins = strings.Split(s, ",")
	}
	for i, s := range c.AllowedOrigins {
		c.AllowedOrigins[i] = strings.TrimSpace(s)
		if err := validURL(c.AllowedOrigins[i]); err != nil {
			return c, fmt.Errorf("ALLOWED_ORIGINS: %w", err)
		}
	}
	for key, dst := range map[string]*bool{"COOKIE_SECURE": &c.CookieSecure, "ENABLE_REHEARSAL": &c.EnableRehearsal} {
		if v := os.Getenv(key); v != "" {
			b, err := strconv.ParseBool(v)
			if err != nil {
				return c, fmt.Errorf("%s must be true or false", key)
			}
			*dst = b
		}
	}
	for key, dst := range map[string]*int{"FREE_TURNS": &c.FreeTurns, "MAX_TURNS": &c.MaxTurns, "DIVERGENCE_THRESHOLD": &c.DivergenceThreshold} {
		if v := os.Getenv(key); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				return c, fmt.Errorf("%s must be an integer", key)
			}
			*dst = n
		}
	}
	minTurns := 7
	if c.EnableRehearsal {
		minTurns = 8
	}
	if c.MaxTurns < minTurns || c.MaxTurns > 12 {
		return c, fmt.Errorf("MAX_TURNS must be %d..12", minTurns)
	}
	if c.FreeTurns < 3 || c.FreeTurns > 4 {
		return c, fmt.Errorf("FREE_TURNS must be 3 or 4")
	}
	if c.DivergenceThreshold < 1 || c.DivergenceThreshold > 9 {
		return c, fmt.Errorf("DIVERGENCE_THRESHOLD must be 1..9")
	}
	if c.SessionSecret == "" {
		var b [32]byte
		if _, err := rand.Read(b[:]); err != nil {
			return c, err
		}
		c.SessionSecret = hex.EncodeToString(b[:])
	}
	if len(c.SessionSecret) < 32 {
		return c, fmt.Errorf("SESSION_SECRET must contain at least 32 characters")
	}
	return c, nil
}
func validURL(s string) error {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return fmt.Errorf("expected an http(s) origin without path")
	}
	return nil
}
