package webapp

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fixture(t *testing.T) (*Handler, string) {
	t.Helper()
	dir := t.TempDir()
	for name, content := range map[string]string{
		"index.html":              "<!doctype html><title>Kintsugi</title>",
		"assets/app-aB123456.js":  "console.log('build');",
		"assets/app-aB123456.css": "body { color: white; }",
		"fonts/body.woff2":        "font-fixture",
		".env":                    "PRIVATE_FIXTURE",
		".git/config":             "PRIVATE_FIXTURE",
	} {
		full := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"code":"not_found"}`))
	})
	handler, err := New(api, dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = handler.Close() })
	return handler, dir
}

func request(h http.Handler, method, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func TestSPADeepLinksAndStaticCachePolicies(t *testing.T) {
	h, _ := fixture(t)
	for _, path := range []string{"/", "/index.html", "/onboarding", "/fight-sessions/example/result", "/checkout/success?session_id=fixture"} {
		w := request(h, "GET", path)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "<title>Kintsugi</title>") || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("deep link failed at %s: status=%d", path, w.Code)
		}
	}
	for _, path := range []string{"/assets/app-aB123456.js", "/assets/app-aB123456.css"} {
		w := request(h, "GET", path)
		if w.Code != http.StatusOK || !strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
			t.Fatalf("hashed asset was not cached: %s", path)
		}
	}
	w := request(h, "GET", "/fonts/body.woff2")
	if w.Code != http.StatusOK || strings.Contains(w.Header().Get("Cache-Control"), "immutable") {
		t.Fatal("unhashed public file cache policy is wrong")
	}
	w = request(h, "HEAD", "/profile")
	if w.Code != http.StatusOK || w.Body.Len() != 0 {
		t.Fatal("HEAD should have the same status without an HTML body")
	}
}

func TestAPIRoutesNeverFallBackToHTML(t *testing.T) {
	h, _ := fixture(t)
	for _, path := range []string{"/api", "/api/v1/unknown", "/api/v99/test", "/api/v1/assets/no.js"} {
		w := request(h, "GET", path)
		if w.Code != http.StatusNotFound || w.Header().Get("Content-Type") != "application/json" || strings.Contains(w.Body.String(), "doctype") {
			t.Fatalf("API namespace escaped to frontend: %s", path)
		}
	}
}

func TestMissingAssetsHiddenFilesTraversalAndSymlinksAreNotServed(t *testing.T) {
	h, dir := fixture(t)
	outside := filepath.Join(t.TempDir(), "private.txt")
	if err := os.WriteFile(outside, []byte("PRIVATE_FIXTURE"), 0o600); err != nil {
		t.Fatal(err)
	}
	for name, target := range map[string]string{"escape.txt": outside, "alias.js": ".env"} {
		if err := os.Symlink(target, filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"/.env", "/.git/config", "/%2eenv", "/../private.txt", "/assets/../../private.txt", "/assets%5c..%5c.env", "/assets/missing.js", "/assets/missing", "/favicon.ico", "/escape.txt", "/alias.js"} {
		w := request(h, "GET", path)
		if w.Code != http.StatusNotFound || strings.Contains(w.Body.String(), "PRIVATE_FIXTURE") || strings.Contains(w.Body.String(), "doctype") {
			t.Fatalf("unsafe/missing path served: %s status=%d", path, w.Code)
		}
	}
}

func TestHealthAndMethodsDoNotDependOnAuthenticationOrFrontend(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) })
	h, err := New(api, "")
	if err != nil {
		t.Fatal(err)
	}
	w := request(h, "GET", "/healthz")
	if w.Code != http.StatusOK || w.Body.String() != "{\"status\":\"ok\"}\n" || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("health check requires API state or exposes unexpected data")
	}
	if request(h, "GET", "/api/v1/couples/me").Code != http.StatusUnauthorized {
		t.Fatal("API-only behavior changed")
	}
	static, _ := fixture(t)
	for _, path := range []string{"/", "/profile", "/healthz", "/assets/app-aB123456.js"} {
		w = request(static, "POST", path)
		if w.Code != http.StatusMethodNotAllowed || w.Header().Get("Allow") != "GET, HEAD" {
			t.Fatalf("unsafe method accepted at %s", path)
		}
	}
}

func TestInvalidFrontendBuildFailsStartup(t *testing.T) {
	for _, dir := range []string{filepath.Join(t.TempDir(), "missing"), t.TempDir()} {
		if h, err := New(http.NotFoundHandler(), dir); err == nil {
			_ = h.Close()
			t.Fatal("missing frontend build was silently accepted")
		}
	}
}
