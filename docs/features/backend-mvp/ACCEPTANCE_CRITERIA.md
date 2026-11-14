# Backend MVP acceptance criteria

Each criterion is independently observable with two cookie jars (A/B) and, where necessary, an injected LLM/payment test double. A third couple is used for isolation checks.

## Onboarding and identity

1. A valid eight-field profile creates one couple, returns the stated default plan, and sets a signed HttpOnly cookie for role A.
2. Missing, null, unknown, or out-of-enum required input is rejected with the documented error shape; extra JSON objects after a valid body are rejected.
3. The unsigned or modified cookie cannot authorize a protected endpoint. A valid actor cannot access a different couple through a guessed ID.
4. An unpaid/not-ready couple cannot expose or consume a usable invitation. A valid ready invitation preview contains no A profile fields, raw answers, or private summaries.
5. Joining assigns role B using three fields. It does not overwrite an occupied B profile through an unrelated anonymous browser.
6. “Delete everything” removes onboarding profiles, invite access, personality data, fight state/results, subscription state, and journal records; an old B cookie also becomes unusable.

## Personality

7. Either role can submit exactly twenty integers from one through five and receive five scores from four through twenty, exactly three strengths and two tips, and a completion timestamp.
8. Reverse-coded answers use `6 - answer`; scores 9/10 and 14/15 cross the low/mid/high boundaries correctly.
9. The personality report is private to the role. It is deterministic and incurs zero LLM calls. A missing report is distinguishable from a completed report.

## Session and payment

10. A new session begins with the initial thermometer and remains bounded by server configuration. Questions have exactly two cards, and supported stages follow the documented order.
11. Out-of-range thermometer values and absent turn indexes fail validation. Stale/duplicate indexes fail without advancing state.
12. The free teaser returns `paywall_required` at its configured boundary; its result preview omits the opening line value and declares paid locks. Journal/statistics remain gated.
13. Confirming a valid own checkout upgrades entitlement and resumes the same session ID and unconsumed next turn without replaying an answer.
14. Foreign, fabricated, unpaid, or mismatched checkout confirmations do not activate a subscription. Repeating confirmation of the same settled checkout is safe. Repeating creation for the same pending plan returns its existing ID/URL; a different pending plan conflicts.
15. Returning to an earlier turn removes that answer and all later answers and derived state, and permits a new branch. A terminal session cannot be backtracked.
16. The owner can skip an active or paywall-paused topic. Reload then contains no raw questions, cards, or answers, and no journal record is fabricated.
17. With rehearsal disabled, partner view leads to the final thermometer. With it enabled, a rehearsal stage appears under the same response union.
18. The explicit ready confirmation completes the session and removes all raw history. The owner's derived result remains readable; the other role cannot read it.

## Safety and privacy

19. A representative recognized crisis statement produces `safety_stop` before calling any LLM method. The private response includes resources and the session becomes terminal.
20. The partner's public state and journal do not disclose a crisis stop or the text that caused it. No partner notification is emitted.
21. A session's LLM input never contains the other partner's answers or generated private questions. Invite preview and shared records expose only their documented fields.
22. Request logs do not store request bodies, signed cookie values, invite tokens, or private session text.

## Pair completion and journal

23. B's session is associated with the matching A round. A and B completing different rounds cannot accidentally produce a shared record.
24. A record is created exactly once after both partners are ready, with its neutral topic and `bothReadyAt`. Ratings are immediately allowed for the demo.
25. A numeric rating updates only the caller's rating. Explicit null records “not discussed”; a missing rating is not silently treated as null.
26. Until both numeric ratings are present, no two-person average or divergence is fabricated. Both numeric ratings produce their arithmetic mean and a divergence flag at difference ≥4.
27. The mean maps continuously to red below 5, yellow from 5 to below 8, and green from 8; a not-discussed/pending record is gray.
28. Empty journal/stats use empty arrays/maps and zero totals, with null for an unavailable recurring-topic hint. Nonempty statistics agree with stored shared records and chronological rating trend.

## Artifacts and operations

29. The server starts without real keys using the documented mock modes and returns the same public response shapes as configured integrations.
30. All nineteen business operations appear in OpenAPI, the prose contract, frontend types, and backend routing. Every mock response validates against its operation/status schema.
31. Normal tests, race checks, vet, and contract validation complete successfully, or the exact environmental limitation is reported in the final handoff.
32. Shutdown handles termination gracefully; a restart intentionally clears in-memory state.
