# Frontend contract

## Integration rules

Use the API origin configured for your frontend, e.g. `http://localhost:8080`. Every browser request that uses or receives an identity must include `credentials: "include"`. Cookies are HttpOnly: the browser owns them and JavaScript must not try to create or parse them. A and B need separate browser profiles/cookie jars in the demo. After a reload, fetch the saved session ID; the backend remains the authority for stage, current turn, locks, and progress.

The browser onboarding uses four short steps for relationship/optional partner name, conflict style, repair need, and optional referral source. Its flow is: create A → optionally submit personality → create fight → opening intensity slider → story → three contextual questions → private insight → two-opening preview → plans → demo checkout and confirm → reload the same fight → rehearsal → final intensity slider and ready confirmation → fetch A's shareable invite from `/couples/me` → B previews/joins → optionally tests personality → B starts/finishes → each polls their own result → journal details and rating. With `DISABLE_PAYWALL=true`, omit the checkout steps. Show privacy/disclosure copy in the frontend; there is no disclosure endpoint. Bootstrap with `/couples/me`: `partnerRole` identifies this browser and `currentSessionId` restores its own latest available attempt in the current round (including terminal states). A null ID means there is no stored attempt for this owner, including when an incomplete attempt was lost on restart; never substitute the partner's ID. Results provide `fightRecordId` for the exact completed round once both partners are ready; use it for details and rating rather than choosing the latest journal row.

Render by `currentTurn.type` / `TurnResponse.type`, not by guessed turn counts. Use `stage` to choose thermometer controls, and use `progressStageIndex` (null for thermometers) for stage progress. Submit the current zero-based `turnIndex`; disable duplicate sends while pending. Card clicks select an answer without submitting; **Next** sends the exact server option or omits `answerText`. Free text requires a nonempty value. Question prompts are bounded to 12 words and cards to eight words / 60 characters, with stacked cards and a separate free-text entry. `answerText` is limited to 300 Unicode code points, counted with `[...text].length` in JavaScript and rune counting in Go. Enforce the limit for both button and Enter submission; Shift+Enter may insert a newline. Thermometer free text is an integer string from `"1"` to `"10"`. The final `ready` question requires the user's explicit confirmation.

At `paywall_required`, retain the session ID and show the three returned plans with their exact prices. The private result endpoint supplies the teaser insight with an empty locked opening line. A Stripe redirect is not proof of payment: POST the checkout ID to `/subscriptions/confirm`, handle unpaid/conflict errors, then reload the original session. The mock URL opens the labeled local `/checkout/demo` form as a native modal dialog, centered on desktop and a bottom sheet on mobile, over a dimmed plan summary. It prefills `Demo User`, `4242 4242 4242 4242`, December three years from the current year, and `123`. A reload restores those demo defaults, never previously typed card data. Accept only the test number `4242 4242 4242 4242`, a nonempty test name, a current or future expiry month in `MM/YY`, and a three-digit CVC. Validate those fields in browser memory only; never send or persist them. On explicit form submission, confirm using only the issued checkout ID. No bank charge or Stripe request occurs. Loading the demo checkout, reloading it, or returning from a canceled checkout must not activate a pending plan. A direct visit to `/checkout/success` with a pending mock ID returns to the form instead of confirming automatically.

At `safety_stop`, replace the conversation with its private resource screen and discard local raw conversation text. Do not broadcast a partner event. At completed/skipped state, erase local answer history and use only the allowed derived result. Never put raw answers, private results, invitation tokens, or cookie values in analytics or console logs.

Show an empty state for `[]` journal data, a missing-personality prompt for 404, an onboarding entry for 401, and plans for 402. A 409 stale turn should trigger a reload before another send. Render a checkout retry error for 502 or a generation retry error for 503 without advancing local state. Error messages are display text; use `code` and HTTP status for branching. Do not automatically retry a mutation without reconciling its current state.

After both are ready, either partner can submit `{"rating": 8}` or `{"rating": null}` immediately. The null choice means “we have not talked”; omitting `rating` is invalid. `averageRating: null` must not render as zero. Poll `/couples/me` or the owner's `/result` for readiness; the backend sends no SMS or push notifications. `partnerBInviteSentAt` denotes current-round availability, not actual delivery. It resets when a new round begins.

## Navigation, owned history and repeat conversations

The main pages have separate responsibilities:

- `/journal`: the current user's current and previous conversations, links to resume or read their own result, shared check-ins where available, and **New conversation** for A (**Prepare your side** for B).
- `/partner`: the other partner's current-round preparation status from `CoupleResponse.partnerStatus`, with a refresh action and visible-tab polling. Values are `not_started`, `in_progress`, and `ready`. Private stops are not disclosed as a distinct status. Never infer A's readiness from B's invitation status.
- `/home`: **My space**, combining an overview with personal patterns from the About me test and shared conversation trends. Until `personalityDone` is true, show the test CTA and do not request personal results or shared statistics. `/stats` redirects to `/home`.
- `/profile`: only the caller's saved onboarding information in `ownProfile`, their test state, access and data settings. Omit unanswered optional fields; never infer age, children, or other demographics from the partner's profile.

`GET /fight-sessions` is authenticated but does not require payment. It returns `ConversationListResponse`: `conversations` contains only the caller's preparations, most recent first, including incomplete and completed attempts; `canStartNew` tells the UI whether the current round allows a start. It is not a payment entitlement: `POST /fight-sessions` remains authoritative for both state and access. Each `ConversationSummary` contains metadata and readiness, not raw answers, generated result text or the other partner's profile. Use `isCurrent` to split current and previous sections, `resultAvailable` together with `status` for result/resume links, and `fightRecordId` to retrieve the shared entry where available. Existing `GET /journal`, `/journal/{fightRecordId}`, and `/journal/stats` retain their paid shared-record behavior.

An active couple subscription applies to every subsequent conversation. Do not open plan selection or checkout simply because **New conversation** was clicked. A may start another round once their preparation is completed or closed and the other partner is not currently preparing; B starts their own side of the existing ready round. Check `canStartNew` rather than recreating the state rules in the browser. On a successful new A round, the server rotates the invitation token and expires the previous link. The new link becomes shareable only after A finishes and access is active. Render only the returned `inviteUrl`, which is empty for older rounds and unavailable invitations; never construct or reuse an old invitation URL.

## Short flow and checkpoints

The environment examples, Compose and Render Blueprint use `FUNNEL=full`, `FREE_TURNS=5`, and `ENABLE_REHEARSAL=true` for the prototype flow. With no environment configuration the legacy `FUNNEL=short` remains the server default: `thermometer_start`, `facts`, `feelings`, `needs`, `ready`. `FUNNEL=full` also includes `partner_view` and `thermometer_end`. `ENABLE_REHEARSAL=true` inserts `rehearsal` before closing steps in either flow. The API does not expose a funnel configuration field: render the actual current stage and returned history. The sidebar must not promise seven steps or mark an omitted perspective stage as completed. `turnsMax` is the configured answer budget, not the number of questions that remain. Short-flow results have `thermometerEnd: null`; show only starting intensity, with no invented ending score or comparison.

When `ENABLE_CHECKPOINTS=true`, a full-access session may return `CheckpointResponse` from both `/turns` and `GET /fight-sessions/{id}`. In short flow it follows `feelings`; in full flow it follows `needs`, and may also follow `partner_view` if rehearsal is enabled. The free teaser has no checkpoints.

Render the private `summary` and returned `question`, with **Continue** for `decision: "continue"` and **Wrap up** for `decision: "stop"`. Send the choice to `POST /fight-sessions/{id}/checkpoint`; its response is `TurnResponse`, not `FightSessionResponse`. Continue resumes the next content stage. Wrap up skips remaining content and goes to `ready` in short flow, or `thermometer_end` then `ready` in full flow. It does not complete the preparation or notify the partner automatically.

Until a checkpoint is answered, reloading returns the same checkpoint and `/turns` returns `409`. Back can reopen a previously answered turn using its index and clears the checkpoint; Skip still closes the private preparation. Disable duplicate decisions and reconcile with GET after a timeout or uncertain mutation result before allowing another send. Checkpoint summaries are private and must not be persisted in browser storage.

## Journal detail and persistence

The UI route `/journal/:recordId` requests `GET /journal/{fightRecordId}`. The response contains the shared `FightRecordResponse` fields at the top level and a nullable `myResult` for the current caller. It never contains the partner's private result. Display topic, dates, ratings and status separately from the private guide. Keep the shared entry visible when `myResult` is null. **Check in** targets `/journal/:recordId/rating` for that same ID. Use cache keys scoped by couple, partner role and record ID; clear private state on identity changes. Shared journal-entry access requires full access (`402` otherwise); missing or foreign records return `404`. The owned conversation list used by the Journal page is available separately through `GET /fight-sessions` without that payment gate.

With a configured server `DATA_FILE` and a stable `SESSION_SECRET`, profiles, subscriptions, personality summaries, completed private results and journal entries survive restart. Raw answers, generated questions/cards and incomplete sessions are never written. Without `DATA_FILE`, server state is memory-only. The API exposes no persistence flag, so settings copy must describe these modes conditionally instead of claiming the local server has persistence enabled.

After restart, an incomplete session URL can return `404` and `currentSessionId` becomes null. Offer a route back home and let the server decide whether a new start is allowed. Free access already consumed by A remains consumed and a new start returns `402`. B may restart its missing preparation if A's completed result remains; the saved B status can still say `in_progress` until then. A known backend limitation affects pending mock checkout: its subscription record is restored but the mock provider's checkout map is not. Retrying the saved checkout returns `409 payment_unconfirmed`; active subscriptions restore normally. Frontend retries cannot repair that provider state.

The browser must keep raw text and private results out of localStorage/sessionStorage. Server persistence of a completed result does not authorize copying it into persistent browser caches.

## Contextual questions and conversation reflection

The hosted generator receives the current owner's prior questions, answer sources, answers, selected onboarding context, and optional questionnaire trait levels. Follow-up questions should refer to the actual situation without repeating an answered question or guessing the partner's experience. Thermometers and readiness remain fixed controls. The offline mode uses context-aware rules rather than remote model calls; it does not claim equivalent depth to a hosted model.

`FightSessionResultResponse.reflection` is optional for older results. When present, it contains a short `summary` and three to five `facets`. Each facet has `id`, `label`, `kind` (`strength` or `growth`), `explanation`, and `practice`. These are tentative themes from this conversation, not measured personality traits. Render equal-size chart sectors with no percentages or scores. Labels such as “aggressiveness” or “not willing to talk” are not supported conclusions; a reported pause is not a refusal to communicate.

In the unpaid preview, summary, facet labels, and explanations are available, while `practice` is explicit JSON `null`. Blur decorative practical-step placeholders; never put withheld text in the DOM. The insight page keeps this detailed reflection in an optional expandable section; the following opening preview and compact plan page are separate screens. Never fabricate a predicted partner reaction from the two opening sentences. Full access returns practical steps as text, including for an existing preview; an older result with no reflection should show an honest unavailable state, not fabricated chart data. The report always belongs to the caller and contains no partner's private answers or profile.

The reflection adds one hosted-model request when reaching the teaser paywall and one when completing the final readiness step, after safety screening. Result and reflection generate concurrently within a shared 25-second action deadline; reflection output has an 1800-token budget and a maximum 22-second budget, shortened to reserve response time. A content repair is attempted only if at least 12 seconds remain. Invalid or timed-out reflection content uses a basic, answer-based reflection whose summary explicitly identifies it as such; render that summary without hiding the qualification. Provider/configuration errors and parent cancellation still fail the request and leave the submitted turn uncommitted. Checkpoints do not request a separate reflection. Generation does not run again for GET requests. Only the completed derived report is persisted with `DATA_FILE`; raw answers remain excluded and incomplete sessions are not persisted. Existing operation payloads remain compatible; the schema also includes the optional rehearsal preview, saved own-profile fields, and the additive owned-conversation list.

Generated questions, cards, results, and reflection prose use respectful, non-graphic paraphrases. User-supplied profanity or explicit descriptions are not instructions to repeat that language. Invalid output is rewritten or replaced by a safe contextual template; this does not censor the user's own answer field.

## Mini-IPIP screen input

Ask “How accurately does this describe you?” Use the scale 1 = Very inaccurate, 2 = Moderately inaccurate, 3 = Neither inaccurate nor accurate, 4 = Moderately accurate, 5 = Very accurate. Submit the original selected numbers without reversing them; scoring happens in the backend. Preserve this exact array order from the supplied project documents:

1. Am the life of the party.
2. Sympathize with others’ feelings.
3. Get chores done right away.
4. Have frequent mood swings.
5. Have a vivid imagination.
6. Don’t talk a lot.
7. Am not interested in other people’s problems.
8. Often forget to put things back in their proper place.
9. Am relaxed most of the time.
10. Am not interested in abstract ideas.
11. Talk to a lot of different people at parties.
12. Feel others’ emotions.
13. Like order.
14. Get upset easily.
15. Have difficulty understanding abstract ideas.
16. Keep in the background.
17. Am not really interested in others.
18. Make a mess of things.
19. Seldom feel blue.
20. Do not have a good imagination.

Do not label a user with a trait name or treat the low/mid/high product display bands as diagnostic scores. Display the returned strengths before tips. There is no backend endpoint serving question copy.

## Browser example

```ts
const API_ORIGIN = "http://localhost:8080";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_ORIGIN}/api/v1${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw { status: response.status, ...(await response.json()) };
  return response.json() as Promise<T>;
}
const fight = await api<FightSessionResponse>("/fight-sessions", {});
// Persist only fight.sessionId for reload, never a second partner's private data.
```

## Complete TypeScript payload types

All response properties below are present. A `| null` value is explicit JSON null; an optional `?` property may be omitted. Backend integers are JSON numbers; no 64-bit identifiers are converted to numbers. IDs are opaque strings and timestamps are RFC 3339 UTC strings. Prices are displayed USD decimals; the payment adapter performs monetary checks in integer cents.

```ts
export type Age = "25-29" | "30-34" | "35-39" | "40-45" | "other";

export type RelationshipStatus = "dating" | "living_together" | "engaged" | "married";

export type TogetherDuration = "<1" | "1-3" | "3-7" | "7+";

export type HasKids = "no" | "expecting" | "yes";

export type ConflictStyle = "talk_now" | "need_space" | "get_loud" | "shut_down";

export type RepairNeed = "being_heard" | "apology" | "plan" | "closeness" | "alone_time";

export type FightTopic = "money" | "chores" | "family" | "time_attention" | "phone" | "jealousy" | "closeness" | "plans_decisions" | "kids" | "other";

export type Goal = "fewer_fights" | "understand_each_other" | "prepare_marriage" | "feel_close";

export type ReferralSource = "instagram_facebook" | "tiktok" | "google" | "partner_link" | "friend" | "other";

export type PartnerRole = "A" | "B";

export type PartnerBStatus = "not_invited" | "invited" | "in_progress" | "ready";

export type PartnerPreparationStatus = "not_started" | "in_progress" | "ready";

export type FightStage = "thermometer_start" | "facts" | "feelings" | "needs" | "partner_view" | "rehearsal" | "thermometer_end" | "ready";

export type AnswerSource = "card_left" | "card_right" | "free_text";

export type Plan = "monthly" | "yearly" | "program";

export type SubscriptionStatus = "none" | "pending" | "active";

export type RatingColor = "green" | "yellow" | "red" | "gray";

export type PersonalityLevel = "low" | "mid" | "high";

export type SessionTier = "free_short" | "full";

export type SessionStatus = "in_progress" | "awaiting_payment" | "completed" | "stopped_safety" | "skipped";

export type RecordStatus = "pending" | "rated" | "not_discussed";

export interface CreateCoupleRequest {
  age?: Age;
  relationshipStatus: RelationshipStatus;
  togetherDuration?: TogetherDuration;
  hasKids?: HasKids;
  conflictStyle: ConflictStyle;
  repairNeed: RepairNeed;
  /** One to three distinct topics. */
  fightTopics?: (FightTopic)[];
  goal?: Goal;
  /** Optional name, trimmed to 1–20 Unicode characters when provided. */
  partnerName?: string;
  source?: ReferralSource;
}

export interface JoinInviteRequest {
  age?: Age;
  conflictStyle: ConflictStyle;
  repairNeed: RepairNeed;
}

export interface SubscriptionResponse {
  plan: Plan;
  status: SubscriptionStatus;
  /** RFC 3339 timestamp in UTC. */
  activatedAt: string | null;
}

export interface OwnProfile {
  partnerName?: string;
  source?: string;
  age: string;
  relationshipStatus: string;
  togetherDuration: string;
  hasKids: string;
  conflictStyle: string;
  repairNeed: string;
  fightTopics: FightTopic[] | null;
  goal: string;
}

export interface CoupleResponse {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  coupleId: string;
  /** Current browser's server-verified role. */
  partnerRole: PartnerRole;
  /** Only the caller's saved onboarding information; optional answers remain empty. */
  ownProfile: OwnProfile | null;
  /** The other partner's readiness in the current round; no private-stop disclosure. */
  partnerStatus: PartnerPreparationStatus;
  /** Own latest attempt in the current round, including terminal states; never another owner's ID. */
  currentSessionId: string | null;
  /** Empty until paid and A is ready; unique to the current round. A new round expires older links. Returned only to A. */
  inviteUrl: string;
  partnerBStatus: PartnerBStatus;
  /** Time invitation became shareable in the current round; null before readiness; not delivery confirmation. */
  partnerBInviteSentAt: string | null;
  /** Program for engaged couples, yearly otherwise. */
  defaultPlan: Plan;
  /** Own profile only; omitted when not supplied. */
  partnerName?: string;
  subscription: SubscriptionResponse | null;
  /** Whether the current role has completed the personality test. */
  personalityDone: boolean;
  /** RFC 3339 timestamp in UTC. */
  createdAt: string;
}

export interface InviteResponse {
  neutralTopic: FightTopic | null;
  /** Neutral invitation text without A’s private data. */
  message: string;
}

export interface JoinInviteResponse {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  coupleId: string;
  partnerRole: "B";
  neutralTopic: FightTopic | null;
}

export interface SubmitPersonalityTestRequest {
  /** Mini-IPIP answers in the specified 1–20 item order. */
  answers: (number)[];
}

export interface TraitResult {
  /** Sum of four direction-corrected item scores. */
  score: number;
  level: PersonalityLevel;
}

export interface Traits {
  e: TraitResult;
  a: TraitResult;
  c: TraitResult;
  n: TraitResult;
  i: TraitResult;
}

export interface PersonalityTestResponse {
  traits: Traits;
  /** Three plain-language strengths. */
  strengths: (string)[];
  /** Two plain-language tips. */
  tips: (string)[];
  /** RFC 3339 timestamp in UTC. */
  completedAt: string;
}

export type SubmitTurnRequest =
  // answerText, when present, is limited to 300 Unicode code points.
  | { turnIndex: number; answerSource: "free_text"; answerText: string }
  | { turnIndex: number; answerSource: "card_left" | "card_right"; answerText?: string };

export interface BackRequest {
  /** Previously answered index to reopen. Its answer and all later history are erased. */
  turnIndex: number;
}

export interface NextTurnResponse {
  type: "next_turn";
  stage: FightStage;
  turnIndex: number;
  /** Question for the owner of this session. */
  agentQuestion: string;
  /** First answer card. */
  optionLeft: string;
  /** Second answer card. */
  optionRight: string;
  /** Short: counts actual content stages (ready=4 without rehearsal). Full: historical numbering (ready=6). Null on thermometers. */
  progressStageIndex: number | null;
  /** Number of answers accepted in the current branch. */
  turnsUsed: number;
  /** Answer budget, not remaining steps: FREE_TURNS (3–5 for full flow; 3–4 for short flow) for teaser, MAX_TURNS (5–12 short / 7–12 full; rehearsal adds 1 to the minimum). */
  turnsMax: number;
}

export interface PlanOption {
  plan: Plan;
  /** Displayed per-plan USD price. */
  priceUsd: number;
  /** Selected by relationship status, not an imposed purchase. */
  isDefault: boolean;
}

export interface PaywallResponse {
  type: "paywall_required";
  availablePlans: (PlanOption)[];
}

export interface Hotline {
  /** Name and locale of the support resource. */
  name: string;
  /** Display/dial string; never interpret it as a numeric value. */
  phone: string;
}

export interface SafetyStopResponse {
  type: "safety_stop";
  hotlines: (Hotline)[];
}

export interface CheckpointSummary {
  feltText: string;
  needText: string;
  openingLine: string;
}

export interface CheckpointResponse {
  type: "checkpoint";
  afterStage: "feelings" | "needs" | "partner_view";
  summary: CheckpointSummary;
  question: string;
  decisions: ("stop" | "continue")[];
}

export interface CheckpointRequest {
  decision: "stop" | "continue";
}

export interface CompletedResponse {
  type: "completed";
  /** API path to the private session result. */
  resultUrl: string;
}

export type TurnResponse = NextTurnResponse | PaywallResponse | SafetyStopResponse | CheckpointResponse | CompletedResponse;

export interface FightTurn {
  turnIndex: number;
  stage: FightStage;
  agentQuestion: string;
  optionLeft: string;
  optionRight: string;
  answerSource: AnswerSource;
  answerText: string;
}

export interface ConversationListResponse {
  conversations: ConversationSummary[];
  /** Whether the round allows a start; POST still checks subscription access. */
  canStartNew: boolean;
}

export interface ConversationSummary {
  sessionId: string;
  status: SessionStatus;
  tier: SessionTier;
  stage: FightStage;
  neutralTopic: FightTopic | null;
  createdAt: string;
  completedAt: string | null;
  isCurrent: boolean;
  resultAvailable: boolean;
  fightRecordId: string | null;
  partnerStatus: PartnerPreparationStatus;
  /** Current ready A invitation only; otherwise empty. */
  inviteUrl: string;
}

export interface FightSessionResponse {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  sessionId: string;
  status: SessionStatus;
  tier: SessionTier;
  stage: FightStage;
  /** Answered history for this owner only; empty after terminal cleanup. */
  turns: (FightTurn)[];
  currentTurn: TurnResponse | null;
  /** Integer scale from 1 through 10. */
  thermometerStart: number | null;
  /** Integer scale from 1 through 10. */
  thermometerEnd: number | null;
  /** RFC 3339 timestamp in UTC. */
  createdAt: string;
}

export interface FightSessionResultResponse {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  sessionId: string;
  /** Journal record for this exact round after both partners are ready; old sessions keep the old record. */
  fightRecordId: string | null;
  neutralTopic: FightTopic;
  /** Private derived feeling summary. */
  feltText: string;
  /** Private derived need summary. */
  needText: string;
  /** Selected or edited respectful rehearsal sentence, up to 300 characters; empty while locked. */
  openingLine: string;
  /** The same three neutral conversation rules. */
  sharedRules: (string)[];
  partnerStatus: PartnerBStatus;
  /** Integer scale from 1 through 10. */
  thermometerStart: number | null;
  /** Integer scale from 1 through 10. */
  thermometerEnd: number | null;
  tier: SessionTier;
  /** Empty when full access is available. */
  locked: ("openingLine" | "inviteUrl")[];
  /** Optional for older results. Practical steps are null until full access. */
  reflection?: ConversationReflection;
  /** Available when a rehearsal was generated, including its unpaid preview. */
  rehearsal?: { optionA: string; optionB: string };
}

export interface ConversationReflection {
  summary: string;
  facets: ReflectionFacet[];
}

export interface ReflectionFacet {
  id: string;
  label: string;
  kind: "strength" | "growth";
  explanation: string;
  practice: string | null;
}

export interface CreateCheckoutRequest {
  plan: Plan;
}

export interface CreateCheckoutResponse {
  /** Absolute Stripe test checkout URL, or clearly marked frontend demo checkout URL. Do not infer payment success from this URL. */
  checkoutUrl: string;
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  checkoutSessionId: string;
}

export interface ConfirmCheckoutRequest {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  checkoutSessionId: string;
}

export interface SubmitRatingRequest {
  /** Integer scale from 1 through 10. */
  rating: number | null;
}

export interface FightRecordResponse {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  id: string;
  topic: FightTopic;
  /** RFC 3339 timestamp in UTC. */
  startedAt: string;
  /** RFC 3339 timestamp in UTC. */
  bothReadyAt: string | null;
  /** Integer scale from 1 through 10. */
  ratingA: number | null;
  /** Integer scale from 1 through 10. */
  ratingB: number | null;
  /** Mean of both numeric ratings; absent average is null. */
  averageRating: number | null;
  color: RatingColor;
  status: RecordStatus;
  /** True only with two numeric ratings whose difference reaches the configured threshold (default 4). */
  divergenceFlag: boolean;
}

export type JournalResponse = (FightRecordResponse)[];

export interface JournalEntryResponse extends FightRecordResponse {
  /** Only the calling partner's derived result; null when unavailable. */
  myResult: FightSessionResultResponse | null;
}

export interface JournalStatsResponse {
  totalFights: number;
  /** Only topics present in the journal; {} when empty. */
  topicCounts: Partial<Record<FightTopic, number>>;
  /** Available two-person averages in chronological order. */
  averageRatingTrend: (number)[];
  /** Mean elapsed seconds, truncated to integer; zero when there are no records. */
  avgTimeToBothReadySeconds: number;
  recurringTopicHint: FightTopic | null;
}

export interface ErrorResponse {
  /** Stable machine-readable error code. */
  code: string;
  /** User-readable explanation; do not branch on its wording. */
  message: string;
}

export interface EmptyRequest {
}
```

## Mock transport

[MOCK_RESPONSES.json](MOCK_RESPONSES.json) is a fixture manifest. Each `scenarios` entry supplies a method, concrete path, HTTP status, and `response` body. Only `response` is the actual API payload; fixture metadata is not part of the endpoint contract. Match method/path/status and select the desired branch to develop success, empty, paywall, safety, and error screens. OpenAPI is the authoritative machine-readable schema.
