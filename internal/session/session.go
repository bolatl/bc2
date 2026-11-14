package session

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"lovelab/internal/model"
	"net/http"
	"strings"
	"time"
)

const CookieName = "lovelab_session"

type contextKey struct{}
type payload struct {
	CoupleID string `json:"c"`
	Role     string `json:"r"`
	Expires  int64  `json:"e"`
}
type Manager struct {
	secret []byte
	secure bool
}

func New(secret string, secure bool) *Manager {
	return &Manager{secret: []byte(secret), secure: secure}
}
func (m *Manager) signature(value string) []byte {
	mac := hmac.New(sha256.New, m.secret)
	mac.Write([]byte(value))
	return mac.Sum(nil)
}
func (m *Manager) Issue(w http.ResponseWriter, actor model.Actor) {
	expires := time.Now().Add(30 * 24 * time.Hour)
	b, _ := json.Marshal(payload{CoupleID: actor.CoupleID, Role: actor.PartnerRole, Expires: expires.Unix()})
	value := base64.RawURLEncoding.EncodeToString(b)
	token := value + "." + base64.RawURLEncoding.EncodeToString(m.signature(value))
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: token, Path: "/", HttpOnly: true, Secure: m.secure, SameSite: http.SameSiteLaxMode, Expires: expires, MaxAge: 30 * 24 * 60 * 60})
}
func (m *Manager) Clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", HttpOnly: true, Secure: m.secure, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
}
func (m *Manager) Resolve(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(CookieName)
		if err == nil {
			if actor, ok := m.verify(cookie.Value); ok {
				r = r.WithContext(context.WithValue(r.Context(), contextKey{}, actor))
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (m *Manager) verify(token string) (model.Actor, bool) {
	var actor model.Actor
	if len(token) > 2048 {
		return actor, false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return actor, false
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(sig, m.signature(parts[0])) {
		return actor, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return actor, false
	}
	var p payload
	if json.Unmarshal(raw, &p) != nil || p.CoupleID == "" || (p.Role != "A" && p.Role != "B") || p.Expires <= time.Now().Unix() {
		return actor, false
	}
	return model.Actor{CoupleID: p.CoupleID, PartnerRole: p.Role}, true
}
func Actor(ctx context.Context) (model.Actor, bool) {
	a, ok := ctx.Value(contextKey{}).(model.Actor)
	return a, ok
}
