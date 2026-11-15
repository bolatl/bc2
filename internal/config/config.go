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
	Addr, FrontendURL, SessionSecret, StripeSecretKey, LLMAPIKey, LLMProvider, LLMModel, LLMBaseURL, DataFile, Funnel string
	Environment, StaticDir                                                                                            string
	AllowedOrigins                                                                                                    []string
	CookieSecure, EnableRehearsal, DisablePaywall, EnableCheckpoints                                                  bool
	FreeTurns, MaxTurns, DivergenceThreshold                                                                          int
}

func Default() Config {
	return Config{Environment: "development", Addr: ":8080", FrontendURL: "http://localhost:5173", AllowedOrigins: []string{"http://localhost:5173"}, Funnel: "short", FreeTurns: 4, MaxTurns: 12, DivergenceThreshold: 4}
}
func Load() (Config, error) {
	c := Default()
	for key, dst := range map[string]*string{"APP_ENV": &c.Environment, "STATIC_DIR": &c.StaticDir, "ADDR": &c.Addr, "FRONTEND_URL": &c.FrontendURL, "SESSION_SECRET": &c.SessionSecret, "STRIPE_SECRET_KEY": &c.StripeSecretKey, "LLM_API_KEY": &c.LLMAPIKey, "LLM_PROVIDER": &c.LLMProvider, "LLM_MODEL": &c.LLMModel, "LLM_BASE_URL": &c.LLMBaseURL, "DATA_FILE": &c.DataFile, "FUNNEL": &c.Funnel} {
		if v := os.Getenv(key); v != "" {
			*dst = v
		}
	}
	// Render supplies its assigned HTTPS URL even on the free plan. An explicit
	// FRONTEND_URL still wins, for example when a custom domain is configured.
	if os.Getenv("FRONTEND_URL") == "" && os.Getenv("RENDER_EXTERNAL_URL") != "" {
		c.FrontendURL = os.Getenv("RENDER_EXTERNAL_URL")
	}
	c.Environment = strings.ToLower(strings.TrimSpace(c.Environment))
	if c.Environment != "development" && c.Environment != "test" && c.Environment != "production" {
		return c, fmt.Errorf("APP_ENV must be development, test, or production")
	}
	if port := os.Getenv("PORT"); os.Getenv("ADDR") == "" && port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return c, fmt.Errorf("PORT must be an integer from 1 to 65535")
		}
		c.Addr = ":" + strconv.Itoa(number)
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
	for key, dst := range map[string]*bool{"COOKIE_SECURE": &c.CookieSecure, "ENABLE_REHEARSAL": &c.EnableRehearsal, "DISABLE_PAYWALL": &c.DisablePaywall, "ENABLE_CHECKPOINTS": &c.EnableCheckpoints} {
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
	c.Funnel = strings.ToLower(strings.TrimSpace(c.Funnel))
	minTurns := 5
	switch c.Funnel {
	case "short":
	case "full":
		minTurns = 7
	default:
		return c, fmt.Errorf("FUNNEL must be short or full")
	}
	if c.EnableRehearsal {
		minTurns++
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
	if c.Environment == "production" {
		if c.SessionSecret == "" {
			return c, fmt.Errorf("SESSION_SECRET must be explicitly configured in production")
		}
		if !c.CookieSecure {
			return c, fmt.Errorf("COOKIE_SECURE must be true in production")
		}
		if c.DataFile == "" {
			return c, fmt.Errorf("DATA_FILE must be configured in production")
		}
		for _, origin := range append([]string{c.FrontendURL}, c.AllowedOrigins...) {
			if !strings.HasPrefix(origin, "https://") {
				return c, fmt.Errorf("FRONTEND_URL and ALLOWED_ORIGINS must use HTTPS in production")
			}
		}
		if weakProductionSecret(c.SessionSecret) {
			return c, fmt.Errorf("SESSION_SECRET must be at least 32 random characters, not a placeholder")
		}
	}
	if c.DataFile != "" && c.SessionSecret == "" {
		return c, fmt.Errorf("SESSION_SECRET is required when DATA_FILE is set: cookies must stay valid after a restart")
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

func weakProductionSecret(secret string) bool {
	if len(secret) < 32 || strings.ContainsAny(secret, " \t\r\n") {
		return true
	}
	lower := strings.ToLower(secret)
	for _, placeholder := range []string{"replace", "changeme", "change-me", "example", "your-secret"} {
		if strings.Contains(lower, placeholder) {
			return true
		}
	}
	unique := map[rune]bool{}
	for _, char := range secret {
		unique[char] = true
	}
	return len(unique) < 8
}
func validURL(s string) error {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" {
		return fmt.Errorf("expected an http(s) origin without path")
	}
	return nil
}
