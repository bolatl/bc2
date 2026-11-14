package handler

import (
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"log/slog"
	"lovelab/internal/dto"
	"lovelab/internal/httpx"
	"lovelab/internal/service"
	"lovelab/internal/session"
	"net/http"
	"time"
)

type Handler struct {
	app      *service.App
	sessions *session.Manager
}

func New(app *service.App) http.Handler {
	h := &Handler{app: app, sessions: session.New(app.Config.SessionSecret, app.Config.CookieSecure)}
	r := chi.NewRouter()
	r.Use(middleware.RequestID, recoverer, logger, cors(app.Config.AllowedOrigins), h.sessions.Resolve)
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, 404, httpx.ErrorResponse{Code: "not_found", Message: "Resource not found."})
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, 405, httpx.ErrorResponse{Code: "method_not_allowed", Message: "Method not allowed."})
	})
	r.Route("/api/v1", func(r chi.Router) {
		r.Post("/couples", h.createCouple)
		r.Get("/invites/{inviteToken}", h.invite)
		r.Post("/invites/{inviteToken}/join", h.join)
		r.Group(func(r chi.Router) {
			r.Use(requireSession)
			r.Get("/couples/me", h.couple)
			r.Delete("/couples/me", h.deleteCouple)
			r.Post("/personality-tests", h.personality)
			r.Get("/personality-tests/me", h.personalityMe)
			r.Post("/fight-sessions", h.start)
			r.Get("/fight-sessions/{sessionId}", h.fight)
			r.Post("/fight-sessions/{sessionId}/turns", h.turn)
			r.Post("/fight-sessions/{sessionId}/back", h.back)
			r.Post("/fight-sessions/{sessionId}/skip-topic", h.skip)
			r.Get("/fight-sessions/{sessionId}/result", h.result)
			r.Post("/subscriptions/checkout", h.checkout)
			r.Post("/subscriptions/confirm", h.confirm)
			r.Get("/subscriptions/me", h.subscription)
			r.Get("/journal", h.journal)
			r.Get("/journal/stats", h.stats)
			r.Post("/journal/{fightRecordId}/rating", h.rating)
		})
	})
	return r
}
func respond(w http.ResponseWriter, status int, result any, err error) {
	if err != nil {
		httpx.Error(w, err)
		return
	}
	httpx.JSON(w, status, result)
}
func (h *Handler) createCouple(w http.ResponseWriter, r *http.Request) {
	var req dto.CreateCoupleRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	out, actor, err := h.app.CreateCouple(req)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	h.sessions.Issue(w, actor)
	httpx.JSON(w, 201, out)
}
func (h *Handler) couple(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.CoupleMe(actor)
	respond(w, 200, out, err)
}
func (h *Handler) deleteCouple(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	if err := h.app.DeleteCouple(actor); err != nil {
		httpx.Error(w, err)
		return
	}
	h.sessions.Clear(w)
	w.WriteHeader(204)
}
func (h *Handler) invite(w http.ResponseWriter, r *http.Request) {
	out, err := h.app.InvitePreview(chi.URLParam(r, "inviteToken"))
	respond(w, 200, out, err)
}
func (h *Handler) join(w http.ResponseWriter, r *http.Request) {
	var req dto.JoinInviteRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	existing, ok := session.Actor(r.Context())
	var actorPtr = &existing
	if !ok {
		actorPtr = nil
	}
	out, actor, err := h.app.JoinInvite(chi.URLParam(r, "inviteToken"), req, actorPtr)
	if err != nil {
		httpx.Error(w, err)
		return
	}
	h.sessions.Issue(w, actor)
	httpx.JSON(w, 200, out)
}
func (h *Handler) personality(w http.ResponseWriter, r *http.Request) {
	var req dto.SubmitPersonalityTestRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.SubmitPersonality(actor, req.Answers)
	respond(w, 200, out, err)
}
func (h *Handler) personalityMe(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.PersonalityMe(actor)
	respond(w, 200, out, err)
}
func (h *Handler) start(w http.ResponseWriter, r *http.Request) {
	var req struct{}
	if err := httpx.Decode(w, r, &req, true); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.FightStart(r.Context(), actor)
	respond(w, 201, out, err)
}
func (h *Handler) fight(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.FightGet(actor, chi.URLParam(r, "sessionId"))
	respond(w, 200, out, err)
}
func (h *Handler) turn(w http.ResponseWriter, r *http.Request) {
	var req dto.SubmitTurnRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.FightTurn(r.Context(), actor, chi.URLParam(r, "sessionId"), req)
	respond(w, 200, out, err)
}
func (h *Handler) back(w http.ResponseWriter, r *http.Request) {
	var req dto.BackRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.FightBack(r.Context(), actor, chi.URLParam(r, "sessionId"), req)
	respond(w, 200, out, err)
}
func (h *Handler) skip(w http.ResponseWriter, r *http.Request) {
	var req struct{}
	if err := httpx.Decode(w, r, &req, true); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.FightSkip(actor, chi.URLParam(r, "sessionId"))
	respond(w, 200, out, err)
}
func (h *Handler) result(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.FightResult(actor, chi.URLParam(r, "sessionId"))
	respond(w, 200, out, err)
}
func (h *Handler) checkout(w http.ResponseWriter, r *http.Request) {
	var req dto.CreateCheckoutRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.Checkout(r.Context(), actor, req.Plan)
	respond(w, 201, out, err)
}
func (h *Handler) confirm(w http.ResponseWriter, r *http.Request) {
	var req dto.ConfirmCheckoutRequest
	if err := httpx.Decode(w, r, &req, false); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.ConfirmCheckout(r.Context(), actor, req.CheckoutSessionID)
	respond(w, 200, out, err)
}
func (h *Handler) subscription(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.SubscriptionMe(actor)
	respond(w, 200, out, err)
}
func (h *Handler) journal(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.JournalList(actor)
	respond(w, 200, out, err)
}
func (h *Handler) stats(w http.ResponseWriter, r *http.Request) {
	actor, _ := session.Actor(r.Context())
	out, err := h.app.JournalStats(actor)
	respond(w, 200, out, err)
}
func (h *Handler) rating(w http.ResponseWriter, r *http.Request) {
	var req dto.SubmitRatingRequest
	if err := httpx.Decode(w, r, &req, false, "rating"); err != nil {
		httpx.Error(w, err)
		return
	}
	actor, _ := session.Actor(r.Context())
	out, err := h.app.Rate(actor, chi.URLParam(r, "fightRecordId"), req.Rating)
	respond(w, 200, out, err)
}

func requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := session.Actor(r.Context()); !ok {
			httpx.JSON(w, 401, httpx.ErrorResponse{Code: "unauthorized", Message: "A valid session is required."})
			return
		}
		next.ServeHTTP(w, r)
	})
}
func recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recover() != nil {
				slog.Error("request panic", "request_id", middleware.GetReqID(r.Context()))
				httpx.JSON(w, 500, httpx.ErrorResponse{Code: "internal_error", Message: "An internal error occurred."})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
func logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(wrapped, r)
		route := chi.RouteContext(r.Context()).RoutePattern()
		if route == "" {
			route = "unmatched"
		}
		slog.Info("http request", "method", r.Method, "route", route, "status", wrapped.Status(), "duration", time.Since(start), "request_id", middleware.GetReqID(r.Context()))
	})
}
func cors(origins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Add("Vary", "Origin")
			origin := r.Header.Get("Origin")
			if origin != "" {
				allowed := false
				for _, o := range origins {
					if o == origin {
						allowed = true
						break
					}
				}
				if !allowed {
					httpx.JSON(w, 403, httpx.ErrorResponse{Code: "forbidden_origin", Message: "Origin is not allowed."})
					return
				}
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(204)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
