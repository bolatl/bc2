// Package webapp serves a built frontend beside the API under one origin.
package webapp

import (
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"
)

type Handler struct {
	api  http.Handler
	root *os.Root
}

// New keeps API-only development unchanged when staticDir is empty. A configured
// directory must already contain the build so deployment mistakes fail at startup.
func New(api http.Handler, staticDir string) (*Handler, error) {
	h := &Handler{api: api}
	if staticDir == "" {
		return h, nil
	}
	root, err := os.OpenRoot(staticDir)
	if err != nil {
		return nil, fmt.Errorf("open STATIC_DIR: %w", err)
	}
	h.root = root
	index, err := h.open("index.html")
	if err != nil {
		_ = root.Close()
		return nil, fmt.Errorf("STATIC_DIR must contain a regular index.html file")
	}
	_ = index.Close()
	return h, nil
}

func (h *Handler) Close() error {
	if h.root == nil {
		return nil
	}
	return h.root.Close()
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Reserve the entire API namespace, including unknown versions and routes.
	// A missing API endpoint must never be a successful HTML response.
	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
		h.api.ServeHTTP(w, r)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path == "/healthz" {
		if !readMethod(w, r) {
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte("{\"status\":\"ok\"}\n"))
		}
		return
	}
	if h.root == nil {
		h.api.ServeHTTP(w, r)
		return
	}
	if !readMethod(w, r) {
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if !safePath(name) {
		http.NotFound(w, r)
		return
	}
	file, err := h.open(name)
	if err != nil {
		// Assets are never rewritten to HTML, nor are directory listings exposed.
		// Extensionless browser routes are resolved by React's router.
		if path.Ext(name) != "" || name == "assets" || strings.HasPrefix(name, "assets/") || !wantsHTML(r) {
			http.NotFound(w, r)
			return
		}
		file, err = h.open("index.html")
		name = "index.html"
		if err != nil {
			http.Error(w, "Frontend is unavailable.", http.StatusServiceUnavailable)
			return
		}
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if name != "index.html" {
		w.Header().Set("Cache-Control", "public, max-age=0, must-revalidate")
		if hashedAsset.MatchString(name) {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
	}
	http.ServeContent(w, r, name, info.ModTime(), file)
}

var hashedAsset = regexp.MustCompile(`^assets/(?:[^/]+/)*[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$`)

func readMethod(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	http.Error(w, "Method not allowed.", http.StatusMethodNotAllowed)
	return false
}

func wantsHTML(r *http.Request) bool {
	accept := r.Header.Get("Accept")
	return accept == "" || strings.Contains(accept, "text/html") || strings.Contains(accept, "*/*")
}

func safePath(name string) bool {
	if !fs.ValidPath(name) || strings.ContainsAny(name, "\\\x00") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return false
		}
	}
	return true
}

func (h *Handler) open(name string) (*os.File, error) {
	// os.Root prevents escapes, including symlink races. Reject symlinks as well
	// so a normal-looking asset cannot alias an internal hidden file.
	parts := strings.Split(name, "/")
	for i := range parts {
		info, err := h.root.Lstat(strings.Join(parts[:i+1], "/"))
		if err != nil || info.Mode()&os.ModeSymlink != 0 {
			return nil, fs.ErrNotExist
		}
	}
	file, err := h.root.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = file.Close()
		return nil, fs.ErrNotExist
	}
	return file, nil
}
