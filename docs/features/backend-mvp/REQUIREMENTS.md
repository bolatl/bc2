# Love Lab backend MVP requirements

## Source precedence and scope

This implementation follows the user's explicit precedence: `LoveLab_BACKEND_PROMPT.md` first, then `LoveLab_FINAL.md`, `LoveLab_PRODUCT_BRIEF.md`, and the historical `LoveLab_dev_flow_v0.md`. These source files are local inputs excluded from version control; the requirements needed for implementation are recorded in this documentation. Older proposals for registration, card collection before the teaser, SMS, and push delivery are not requirements. The requested deliverable includes implementation and the seven contract documents.

The supplied workspace contained no Go skeleton or Item example. The requested `cmd/` and `internal/` structure is therefore created at the project root. Storage is in memory. Optionally (`DATA_FILE`), a JSON snapshot of couples, subscriptions, personality results, completed sessions' derived results and the journal is kept on disk so history survives a restart; raw answers, generated questions and in-progress sessions are never written, and restart durability beyond that remains out of scope. The demo is a backend API; frontend screens, public deployment, repository publication, a pitch deck, and real payment collection are separate work.

## Confirmed behavior

- Partner A creates an anonymous couple with eight onboarding fields. A browser cookie identifies the couple and partner role. Partner B joins through an invitation with three personal fields. A used invite is idempotent only for the existing B cookie; unrelated browsers cannot take over that role.
- Either partner may submit the optional 20-answer Mini-IPIP. Scoring and the three-strength/two-tip report are deterministic, without an LLM call.
- A structured private session uses a question, exactly two answer cards, optional free text, stage progress, an initial/final thermometer, backtracking, and topic skipping.
- The first short session is free. Its insight can be previewed, but the opening line, partner invitation, journal, and statistics require payment. Payment resumes the same session and turn.
- Partner A pays for the couple. Supported plans are monthly USD 14.99, yearly USD 99, and program USD 149. Engaged defaults to program; married/living together defaults to yearly; dating defaults to monthly.
- B receives only a neutral topic, public readiness state, and shared conversation rules. Neither partner can read the other's answers, questions, personality report, or private result.
- Safety screening runs before every LLM operation. A detected crisis stops the private session without a partner notification. Supported resources are returned as data for the private screen.
- Completing, safety-stopping, or skipping a session deletes raw answers and generated questions/cards. Journal records contain derived shared data only.
- When both partners complete the same round, a shared journal record permits each partner to submit an integer 1–10 or explicit null for “we have not talked.” No clock waiting is required for the demo.
- Journal statistics include topic counts, rating trend, and mean seconds to both ready. One-click deletion removes every stored aggregate for the couple and invalidates its cookie identity and invite.
- Rehearsal is optional, disabled by default through `ENABLE_REHEARSAL`. The same contract supports it without a second API variant.

## Decisions used to close the prompt's gaps

These decisions are explicit implementation defaults, not newly inferred product requirements:

1. The user confirmed the prompt's three defaults: two cards, rating divergence at an absolute difference of at least four, and session reload support.
2. The invite token is generated internally at onboarding, but `inviteUrl` is an empty string until payment is active and A is ready. This resolves the conflict between “create an invite” and the paid invitation gate without leaking a usable token.
3. `partnerBInviteSentAt` is the time an invitation becomes available to share in the current round; it resets when A starts a new round. The backend does not observe messenger delivery and does not send messages.
4. One outstanding round per couple avoids accidentally pairing unrelated sessions. A new A round waits for both previous partners to finish or an allowed terminal cancellation. B enters the corresponding current round.
5. Turn indexes are zero-based. Backtracking accepts `{ "turnIndex": n }`, removes the answer at that index and later history, and presents that question again. A stale submitted index is a conflict.
6. Thermometer answers use `answerSource: "free_text"` and a string containing an integer 1–10. The source's integer rating and optional values must remain distinguishable from missing properties.
7. A free teaser pauses; it is not a terminal completion. Its raw history is retained so an upgrade can continue. Terminal sessions cannot be reopened by backtracking.
8. The `ready` stage is the explicit final confirmation. Completing it, rather than merely viewing the result, marks that partner ready.
9. Monthly/yearly are recurring in Stripe test mode; program is a one-time test payment. Keyless mock checkout is a clearly marked demo shortcut and does not represent money movement.
10. Generated text is educational, avoids verdicts and prohibited labels, and uses bounded structured stages. A deterministic mock is not a general language model or a comprehensive crisis classifier.

## Non-goals and operational limits

There are no accounts, passwords, pagination, filtering, Stripe webhooks, durable database, background notification scheduler, or real SMS/push. The eight-week plan is a purchasable demo plan, not an implemented course. Anonymous identity is browser-specific; clearing a cookie loses access. Use separate browser profiles for A and B. In-memory state and mock integrations are designed for a single-process demonstration, not a production service. The exact transport contract and boundary behavior are in [API_CONTRACT.md](API_CONTRACT.md) and [OPENAPI.yaml](OPENAPI.yaml).

## Integration evidence and remaining limits

The Mini-IPIP direction keys were checked against the [official Mini-IPIP key](https://www.ipip.ori.org/MiniIPIPKey.htm). The low/mid/high ranges are the product's display bands, not population norms or diagnostic cutoffs. The LLM package provides a deterministic, profile-aware English mock (default, no network calls) and OpenAI (Chat Completions) and Anthropic (Messages API, official Go SDK) adapters enabled by `LLM_API_KEY` and selected by `LLM_PROVIDER`. With the adapter, the current partner's answers and profile are sent to the chosen provider after the safety gate passes; output is schema-constrained, checked for prohibited words, and validated by the service. Thermometer and `ready` stages stay deterministic. There is no retry, evaluation suite, or fallback to the mock on failure: errors surface as `generation_unavailable`.

Safety is a conservative English/Russian phrase gate. It can miss unfamiliar wording and languages, and may stop on negated or quoted phrases. The backend prompt specifies US resources; these are fixed for the US-targeted demo, not selected through geolocation. The connected hotline lookup verified the crisis resource during implementation.

Stripe integration uses the official [Checkout creation](https://docs.stripe.com/api/checkout/sessions/create), [retrieval](https://docs.stripe.com/api/checkout/sessions/retrieve), and [session object](https://docs.stripe.com/api/checkout/sessions/object) contracts. The adapter accepts only test keys and verifies completed, paid, non-live sessions with exact USD amount and matching couple/plan metadata. Without a key, the local mock marks only its own issued checkout IDs as paid when confirmed. Deleting a couple removes local checkout references; it does not cancel a Stripe subscription or erase Stripe's provider-retained records.
