# Frontend contract

## Integration rules

Use the API origin configured for your frontend, e.g. `http://localhost:8080`. Every browser request that uses or receives an identity must include `credentials: "include"`. Cookies are HttpOnly: the browser owns them and JavaScript must not try to create or parse them. A and B need separate browser profiles/cookie jars in the demo. After a reload, fetch the saved session ID; the backend remains the authority for stage, current turn, locks, and progress.

The browser onboarding flow is: create A → optionally submit personality → create fight → answer until paywall → checkout and confirm → reload the same fight → finish → fetch A's shareable invite from `/couples/me` → B previews/joins → optionally tests personality → B starts/finishes → each polls their own result → journal rating. Show privacy/disclosure copy in the frontend; there is no disclosure endpoint.

Render by `currentTurn.type` / `TurnResponse.type`, not by guessed turn counts. Use `stage` to choose thermometer controls, and use `progressStageIndex` (null for thermometers) for stage progress. Submit the current zero-based `turnIndex`; disable duplicate sends while pending. Card clicks use the exact server option or omit `answerText`; free text requires a nonempty value. Thermometer free text is an integer string from `"1"` to `"10"`. The final `ready` question requires the user's explicit confirmation.

At `paywall_required`, retain the session ID and show the three returned plans with their exact prices. The private result endpoint supplies the teaser insight with an empty locked opening line. A Stripe redirect is not proof of payment: POST the checkout ID to `/subscriptions/confirm`, handle unpaid/conflict errors, then reload the original session. The mock URL is a labeled local demo flow; no card or money is used in mock mode.

At `safety_stop`, replace the conversation with its private resource screen and discard local raw conversation text. Do not broadcast a partner event. At completed/skipped state, erase local answer history and use only the allowed derived result. Never put raw answers, private results, invitation tokens, or cookie values in analytics or console logs.

Show an empty state for `[]` journal data, a missing-personality prompt for 404, an onboarding entry for 401, and plans for 402. A 409 stale turn should trigger a reload before another send. Render a checkout retry error for 502 or a generation retry error for 503 without advancing local state. Error messages are display text; use `code` and HTTP status for branching. Do not automatically retry a mutation without reconciling its current state.

After both are ready, either partner can submit `{"rating": 8}` or `{"rating": null}` immediately. The null choice means “we have not talked”; omitting `rating` is invalid. `averageRating: null` must not render as zero. Poll `/couples/me` or the owner's `/result` for readiness; the backend sends no SMS or push notifications. `partnerBInviteSentAt` denotes current-round availability, not actual delivery. It resets when a new round begins.

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

export type PartnerRole = "A" | "B";

export type PartnerBStatus = "not_invited" | "invited" | "in_progress" | "ready";

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
  age: Age;
  relationshipStatus: RelationshipStatus;
  togetherDuration: TogetherDuration;
  hasKids: HasKids;
  conflictStyle: ConflictStyle;
  repairNeed: RepairNeed;
  /** One to three distinct topics. */
  fightTopics: (FightTopic)[];
  goal: Goal;
}

export interface JoinInviteRequest {
  age: Age;
  conflictStyle: ConflictStyle;
  repairNeed: RepairNeed;
}

export interface SubscriptionResponse {
  plan: Plan;
  status: SubscriptionStatus;
  /** RFC 3339 timestamp in UTC. */
  activatedAt: string | null;
}

export interface CoupleResponse {
  /** Opaque server-generated identifier. Do not infer order or encode user data. */
  coupleId: string;
  /** Empty until paid and A is ready; then an absolute frontend invitation URL. Returned only to A. */
  inviteUrl: string;
  partnerBStatus: PartnerBStatus;
  /** Time invitation became shareable in the current round; null before readiness; not delivery confirmation. */
  partnerBInviteSentAt: string | null;
  defaultPlan: Plan;
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
  /** Stage progress: facts=1, feelings=2, needs=3, partner_view=4, rehearsal=5, ready=6; null on thermometers. */
  progressStageIndex: number | null;
  /** Number of answers accepted in the current branch. */
  turnsUsed: number;
  /** Current budget: FREE_TURNS (3 or 4) for teaser, MAX_TURNS (7–12) for full. */
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

export interface CompletedResponse {
  type: "completed";
  /** API path to the private session result. */
  resultUrl: string;
}

export type TurnResponse = NextTurnResponse | PaywallResponse | SafetyStopResponse | CompletedResponse;

export interface FightTurn {
  turnIndex: number;
  stage: FightStage;
  agentQuestion: string;
  optionLeft: string;
  optionRight: string;
  answerSource: AnswerSource;
  answerText: string;
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
  neutralTopic: FightTopic;
  /** Private derived feeling summary. */
  feltText: string;
  /** Private derived need summary. */
  needText: string;
  /** Private first sentence; empty while locked. */
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
