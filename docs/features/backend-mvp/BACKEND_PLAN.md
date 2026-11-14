# Backend implementation map

## Architecture

The requested flow is HTTP handler → service → per-aggregate repository. The server owns route registration, middleware, request limits, graceful shutdown, and environment configuration. Services own authorization, state transitions, payment gates, and cleanup. The repository holds in-memory aggregates with synchronization. External behavior is behind small LLM and payment interfaces, allowing deterministic keyless startup and test doubles.

| Package | Responsibility | Inputs → outputs |
|---|---|---|
| `cmd/server` | Construct dependencies, start HTTP server, graceful shutdown | Environment → listening server |
| `internal/config` | Validate runtime options and integration settings | Environment → typed config |
| `internal/model` | Private aggregate state, role and stage vocabulary | Domain data → stored values |
| `internal/dto` | Stable request/response payloads and mappings | Domain values ↔ public JSON |
| `internal/httpx` | Strict JSON parsing and uniform errors | HTTP body/error → validated value/error JSON |
| `internal/session` | Signed anonymous cookie and request context | Cookie → couple ID and role |
| `internal/safety` | Pre-generation crisis checks and private resources | Own session text → allow/stop |
| `internal/personality` | Mini-IPIP scoring and report templates | Exactly 20 answers → five traits/report |
| `internal/llm` | Bounded turn generation, topic selection, final summaries | Own private context → structured text |
| `internal/payment` | Demo checkout and Stripe test verification | Couple/plan → checkout → verified settlement |
| `internal/repository` | Couple, session, personality, subscription, journal stores | Aggregate key/value → synchronized storage |
| `internal/service` | Couple lifecycle, session machine, payment, journal | Actor + request → authorized response |
| `internal/handler` | Register the 19 business endpoints and map status codes | HTTP → service call → DTO |

## Delivery sequence

1. Define domain vocabulary, DTOs, errors, configuration, signed cookie identities, and aggregate repositories.
2. Implement onboarding, invite preview/join, own personality profile, and complete couple deletion.
3. Implement deterministic LLM boundaries and the session state machine: teaser, payment resume, backtrack, skip, terminal cleanup, private results, partner readiness, and journal pairing.
4. Implement checkout creation/confirmation with server-side ownership and settlement checks, never trusting a success URL as payment proof.
5. Implement journal access, explicit-null ratings, divergence/color derivation, and statistics.
6. Wire middleware in the prescribed order, cross-origin credentials only for configured origins, request validation, and graceful server shutdown.
7. Exercise the complete two-partner flow and adverse paths; reconcile schemas, TypeScript, mocks, and route status codes with the code.

## Verification priorities

- Golden path from onboarding and personality through teaser, upgrade, A/B completion, ratings, journal, and deletion.
- Cross-partner and cross-couple access must not reveal private session or report data.
- No LLM call after a crisis is detected; terminal histories are empty; skip is available to an owner without a subscription.
- Duplicate/stale turns and concurrent updates must not consume the same turn twice.
- Payment confirmation must reject foreign, unpaid, wrong-plan/amount/currency, or live-mode checkout sessions.
- Personality reverse scoring and input bounds; readiness pairing; rating null versus missing; divergence/color edges.
- Rehearsal both enabled and disabled, stable session ID and turn on upgrade, correct backtrack invalidation.
- `go test ./...`, `go test -race ./...`, `go vet ./...`, and schema/mock validation; actual commands and outcomes are recorded in the project handoff.

## Production work deliberately deferred

A durable datastore and migrations, shared session coordination, hosted LLM adapter and evaluation, broader safety screening and resource localization, webhook-driven billing lifecycle, retention jobs, monitoring, abuse protection, and backup/recovery all require separate design. Current test-mode billing activation represents demo entitlement and does not model cancellation, expiry, refunds, or recurring payment failures.
