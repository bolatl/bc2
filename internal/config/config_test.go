package config

import (
	"strings"
	"testing"
)

func cleanEnvironment(t *testing.T) {
	t.Helper()
	for _, key := range []string{"APP_ENV", "STATIC_DIR", "ADDR", "PORT", "FRONTEND_URL", "ALLOWED_ORIGINS", "SESSION_SECRET", "COOKIE_SECURE", "DATA_FILE", "LLM_API_KEY", "LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "STRIPE_SECRET_KEY", "FUNNEL", "FREE_TURNS", "MAX_TURNS", "DIVERGENCE_THRESHOLD", "ENABLE_REHEARSAL", "DISABLE_PAYWALL", "ENABLE_CHECKPOINTS"} {
		t.Setenv(key, "")
	}
	t.Setenv("RENDER_EXTERNAL_URL", "")
}

func TestRenderAssignedURLAndExplicitDomain(t *testing.T) {
	productionEnvironment(t)
	t.Setenv("FRONTEND_URL", "")
	t.Setenv("RENDER_EXTERNAL_URL", "https://lovelab-demo.onrender.com")
	t.Setenv("DATA_FILE", "/tmp/lovelab/data.json")
	t.Setenv("DISABLE_PAYWALL", "true")
	cfg, err := Load()
	if err != nil || cfg.FrontendURL != "https://lovelab-demo.onrender.com" || cfg.AllowedOrigins[0] != cfg.FrontendURL || !cfg.DisablePaywall {
		t.Fatalf("free Render configuration failed: %v", err)
	}
	t.Setenv("FRONTEND_URL", "https://judges.example.test")
	cfg, err = Load()
	if err != nil || cfg.FrontendURL != "https://judges.example.test" || cfg.AllowedOrigins[0] != cfg.FrontendURL {
		t.Fatalf("custom domain did not take precedence: %v", err)
	}
	t.Setenv("FRONTEND_URL", "")
	t.Setenv("RENDER_EXTERNAL_URL", "http://insecure.example.test")
	if _, err := Load(); err == nil {
		t.Fatal("assigned URL bypassed HTTPS validation")
	}
}

func productionEnvironment(t *testing.T) {
	t.Helper()
	cleanEnvironment(t)
	t.Setenv("APP_ENV", "production")
	t.Setenv("FRONTEND_URL", "https://app.example.test")
	t.Setenv("COOKIE_SECURE", "true")
	t.Setenv("DATA_FILE", "/data/lovelab.json")
	t.Setenv("SESSION_SECRET", "047cd2bfa1e6d7e8f9bc4759ac25796dfc870b1afc345dc71a1a97af64239fb8")
}

func TestDevelopmentDefaultsRemainUsable(t *testing.T) {
	cleanEnvironment(t)
	cfg, err := Load()
	if err != nil || cfg.Addr != ":8080" || cfg.CookieSecure || cfg.StaticDir != "" || len(cfg.SessionSecret) < 32 {
		t.Fatalf("development defaults changed: err=%v", err)
	}
}

func TestPrototypeFunnelConfiguration(t *testing.T) {
	productionEnvironment(t)
	t.Setenv("FUNNEL", "full")
	t.Setenv("FREE_TURNS", "5")
	t.Setenv("ENABLE_REHEARSAL", "true")
	cfg, err := Load()
	if err != nil || cfg.Funnel != "full" || cfg.FreeTurns != 5 || !cfg.EnableRehearsal {
		t.Fatalf("prototype deployment settings rejected: %+v, %v", cfg, err)
	}
	t.Setenv("FREE_TURNS", "6")
	if _, err := Load(); err == nil {
		t.Fatal("free preparation allowed past the contextual questions")
	}
	t.Setenv("FREE_TURNS", "5")
	t.Setenv("FUNNEL", "short")
	if _, err := Load(); err == nil {
		t.Fatal("short funnel accepted five free turns")
	}
}

func TestProductionRejectsUnsafeDeploymentSettings(t *testing.T) {
	for _, test := range []struct {
		key, value, message string
	}{
		{"SESSION_SECRET", "", "SESSION_SECRET"},
		{"SESSION_SECRET", "replace-with-at-least-32-random-characters", "SESSION_SECRET"},
		{"SESSION_SECRET", strings.Repeat("a", 64), "SESSION_SECRET"},
		{"SESSION_SECRET", "too-short", "SESSION_SECRET"},
		{"COOKIE_SECURE", "false", "COOKIE_SECURE"},
		{"DATA_FILE", "", "DATA_FILE"},
		{"FRONTEND_URL", "http://app.example.test", "HTTPS"},
		{"ALLOWED_ORIGINS", "http://app.example.test", "HTTPS"},
		{"ALLOWED_ORIGINS", "https://app.example.test,http://localhost:5173", "HTTPS"},
	} {
		t.Run(test.key+"/"+test.message+"/"+test.value, func(t *testing.T) {
			productionEnvironment(t)
			t.Setenv(test.key, test.value)
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("setting was accepted or had wrong error: %v", err)
			}
		})
	}
}

func TestProductionAcceptsExplicitDeploymentSettings(t *testing.T) {
	productionEnvironment(t)
	t.Setenv("STATIC_DIR", "/app/frontend")
	t.Setenv("PORT", "10000")
	cfg, err := Load()
	if err != nil || cfg.Addr != ":10000" || cfg.StaticDir != "/app/frontend" || !cfg.CookieSecure || cfg.LLMAPIKey != "" {
		t.Fatalf("valid production configuration failed: %v", err)
	}
	if len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != cfg.FrontendURL {
		t.Fatal("production CORS did not default to the public frontend origin")
	}
}

func TestManagedPortValidationAndExplicitAddressPrecedence(t *testing.T) {
	for _, port := range []string{"abc", "0", "-1", "65536", "8080/inject"} {
		t.Run(port, func(t *testing.T) {
			cleanEnvironment(t)
			t.Setenv("PORT", port)
			if _, err := Load(); err == nil {
				t.Fatal("invalid managed port was accepted")
			}
			t.Setenv("ADDR", "127.0.0.1:8081")
			cfg, err := Load()
			if err != nil || cfg.Addr != "127.0.0.1:8081" {
				t.Fatalf("explicit ADDR did not take precedence: %v", err)
			}
		})
	}
}
