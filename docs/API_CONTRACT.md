# Production API acceptance contract — role-separated Fiji taxi flow

Status: GDP / ChatGPT acceptance contract for Claude's future production implementation. No backend, authentication provider, database, notification service, payment service or regulator connection is implemented by this document.

Machine-readable companion: `docs/openapi.json`. Run `node prototypes/api-contract-check.cjs` to check its required operations, authentication, idempotency headers, optimistic revisions, safe input fields, money/time representations and error envelope. This is a static contract check, not an HTTP or backend integration test.

HTTP acceptance runner: `node prototypes/http-contract-runner.cjs`. Its default mode starts ephemeral servers on `127.0.0.1`, sends real HTTP requests, then closes them. Fourteen scenarios cover unauthenticated access, passenger/driver role confusion, pending-driver denial, foreign passenger resources, unassigned-driver transitions, caller-supplied identity, missing idempotency keys and three positive controls. Additional flows cover selection/cancellation races, offer validity, vehicle confirmation, the assigned-to-completed ride path, role-shaped recovery reads after a stale conflict and authenticated unfinished-ride discovery without a caller-supplied ride ID. `runHttpContract(baseUrl, tokens)` is transport-reusable for a future authorized test environment, but no remote base URL or real token is configured or contacted here.

The same command also sends offer selection and cancellation concurrently from revision 2 with different idempotency keys. Exactly one returns 200 and revision 3; the loser returns `409 stale_revision`. An exact retry of the winner returns the frozen original response without another state change, while the same key with changed content returns `409 idempotency_conflict`. This loopback mock serializes with an in-memory promise lock and stores replay records in a Map; it is executable acceptance behavior, not evidence of database locks, multi-process safety or persistent idempotency storage.

Offer-selection validity scenarios use an injected trusted server clock. A quote is rejected with `409 offer_expired` when server time is equal to or later than `expiresAt`; one millisecond before expiry is accepted. Current driver eligibility is rechecked inside the same serialized selection and returns `409 driver_unavailable` without assigning or incrementing the ride when eligibility has been lost. A caller-supplied `clientNow` is rejected as an unknown input rather than influencing the decision. This deterministic clock is a test fixture, not a live time service, background expiry worker or regulator check.

The loopback runner also records allowlisted audit events for offer selection and ride cancellation inside the same serialized callback as their state decision. Committed commands and rejected `stale_revision`, `invalid_transition`, `offer_expired` and `driver_unavailable` decisions carry event type, outcome/reason, server-owned actor reference, request/offer reference, before/after revision and trusted server time. An exact idempotent replay returns the saved result without creating another event. The executable check rejects unexpected event fields and credentials or private request inputs such as bearer tokens, idempotency keys, contact details, observed plates and permit data. The mock array is neither durable nor tamper-evident and does not prove that a production database commits business state and audit outbox atomically.

Vehicle confirmation and ride-transition scenarios use the same revision, idempotency and audit mechanism. The booked plate is normalized server-side; the raw observed plate is never copied into audit events. A later mismatch invalidates an existing confirmation and advances the revision so a stale ride-start command cannot reuse it. `arriving -> on_trip` requires both a confirmation current for that exact revision and a currently eligible assigned driver. Exact confirmation/transition replays do not advance state or duplicate audit records.

The boarding race sends passenger cancellation and driver `arriving -> on_trip` from the same revision over concurrent loopback HTTP requests. Both deterministic orderings are exercised: cancellation-first clears vehicle proof and makes ride start return `409 stale_revision`; start-first enters `on_trip` and makes cancellation return the same safe conflict. Exactly one command returns 200 and revision 7, the loser receives current revision 7, and replaying the winner does not add a state or audit change. Small injected mock delays control which request reaches the serialized section first; they are test scaffolding, not evidence of production scheduling, database isolation or multi-server locking.

After either race, both the owning passenger and the currently assigned driver read `GET /v1/rides/{requestId}`. Each receives the same current status and revision with a role-specific `nextAction`; unrelated passengers and drivers receive a concealed `404 resource_not_found`. The response uses a six-field allowlist and excludes assignment identifiers, vehicle-confirmation internals, plates, contact details and permit data. Reads do not consume idempotency keys, advance revision or append audit events.

The recovery read also returns an opaque ETag scoped to the current revision and authenticated viewer role. A matching strong or weak `If-None-Match` returns `304 Not Modified` with no body; an old or other-role validator returns 200 with the current role-shaped body and replacement ETag. Authorization and assignment checks happen before evaluating `If-None-Match`, including the wildcard, so a validator cannot reveal a foreign ride. Both 200 and 304 require `Cache-Control: private, no-cache` and `Vary: Authorization`. This is an executable loopback contract, not evidence of production proxy/CDN behavior, push delivery or cross-device synchronization.

Temporary recovery pressure returns `429 rate_limited` and temporary outage returns `503 service_unavailable`, both with `Retry-After`. The reference client accepts delta-seconds or HTTP dates, clamps server-directed delays to 1–60 seconds, and otherwise uses jittered exponential backoff capped at 30 seconds. It stops after four attempts by default, stops immediately for 401/403/404, and sends no request while the view is hidden. Injected sleep, clock and randomness make these policies deterministic in acceptance tests; they are not evidence of mobile OS scheduling or real network behavior.

Notification and recovery results are merged only by the role-shaped ride `revision`. A lower revision never replaces the current display, regardless of arrival source. An identical same-revision delivery is a no-op; conflicting content at the same revision is not guessed and instead requests a fresh authorized recovery read. A notification that skips one or more revisions is not partially applied; a newer full recovery snapshot may establish the missing state. Ride ID and viewer role must match the current view, and a notification cannot establish the initial trusted baseline. This executable client rule does not prove push, WebSocket or cross-device delivery.

A notification is an untrusted wake-up hint, not a ride representation. Its allowlist is exactly `type`, `rideId` and positive integer `revision`; it must not contain status, route, passenger/driver identity, contact details, fare, ETA, vehicle, plate, permit, document or free-form text. A newer in-scope hint triggers the authenticated `GET /v1/rides/{requestId}` and only that role-shaped response may update the display. Stale, duplicate, invalid or foreign-ride hints do not cause a read. A 401/403/404 recovery result clears cached ride state, while a 304 received for a supposedly newer hint does not fabricate state and remains pending for a later bounded recovery. Push destination authorization and real delivery are not implemented here.

Ride state, role-scoped ETag, scheduled retry and in-flight recovery all belong to one authenticated session generation. Logout, account change or passenger/driver role change increments that generation, clears state and ETag, cancels scheduled retry and aborts old reads. Every completion checks the generation and exact session binding again; an old result is discarded even when the new account has the same role and ride ID. A newly selected role begins with no cached ride and accepts only its own authorized role-shaped response. Session identifiers are internal and must not be emitted in UI state, logs or notification payloads. This reference uses AbortController and an in-memory generation, not a production authentication SDK or token-revocation proof.

State-changing commands are bound to the authenticated account and session generation at send time. Logout or account change aborts the client request and any late success is discarded from the new UI. A 401/403 response never triggers an automatic command retry: require reauthentication and an authorized state read. A network/5xx outcome is unknown, not a failure proof; reconcile state first and only an explicit same-account retry may reuse the same key. Server idempotency storage is scoped by the authenticated account plus raw key as a structured pair, so another account using the same raw key cannot receive or conflict with the first account's result. This reference does not prove durable idempotency or transactional reconciliation.

Before a client sends a state-changing command, it may persist only a short-lived restart marker containing schema version, role, unresolved-state category and save time. It must not persist the command body, action, ride/account identifiers, credentials or `Idempotency-Key` in that marker. On reload or restart, the marker only locks same-role mutations and requests an authorized state read; it never reconstructs or automatically resends the command. Unknown fields, malformed/future/expired markers and role mismatches are discarded. The HTML reference uses a 24-hour local marker; production must use platform-protected storage and clear it after confirmed completion, explicit recovery or account/role change.

Startup reconciliation makes one authorized state read. Network/rate-limit/5xx failures and a bodyless 304 retain the original marker and command lock; after connectivity is explicitly restored, one additional state read is allowed. A 401/403 likewise retains the marker and permits one additional read only after explicit reauthentication. A successful 200 clears the marker. A concealed 404 clears it and stops. The reason must match the failed state, concurrent reads are rejected, and no third read or command replay is allowed. Response bodies, tokens and session identifiers are not retained by this controller.

Unknown command outcomes use a bounded reconcile-before-replay flow. Read the authorized current ride state in the same session. If the intended transition is present, finish without replay. If the state is still exactly at the command's baseline revision, one explicit replay may reuse the original action and idempotency key. If the revision changed differently, access is lost, the session changes, recovery is incomplete or that single replay is also inconclusive, stop and require another state read or support path. Never generate a fresh key, loop replays or infer success from a notification.

The client exposes this lifecycle without encouraging duplicate taps. While a command is pending, state-changing controls are disabled. Confirmed, unresolved, reauthentication, conflict and rejected outcomes use role-specific passenger/driver copy. Unresolved, reauthentication and conflict remain locked until an explicit authorized refresh or session restart; switching roles clears the old role's feedback. The banner contains no token, idempotency key, private vehicle data or internal account reference.

## Common rules

- Prefix examples with `/v1`. HTTPS and authenticated sessions are mandatory in production.
- Derive `passengerId`, `driverId`, reviewer identity and permissions from the authenticated session. Never accept them as authority from request JSON.
- Return only data allowed for the current participant. Use `404` where revealing another user's resource existence would leak information.
- Each ride request has a monotonically increasing integer `revision`, beginning at `1`. State-changing commands carry `expectedRevision`; a mismatch returns `409 stale_revision` and must not partly update any record.
- State transitions, eligibility recheck, selected-offer snapshot and audit event are one database transaction. Use a trusted server clock for `createdAt`, `expiresAt`, `selectedAt`, `cancelledAt` and transition timestamps.
- Audit successful and rejected security-relevant commands with an allowlist. Store internal actor/resource references, outcome, stable reason code, before/after revision, correlation ID and server time; do not copy authorization headers, idempotency keys, contact data, observed plates, permit/document contents or free-form request bodies into audit payloads.
- Require an `Idempotency-Key` for create, quote, cancel, select, vehicle confirmation and transition commands. Repeating the same actor/key/body returns the original result; reusing a key with different content returns `409 idempotency_conflict`.
- Prices use integer Fiji cents. Times use ISO 8601 UTC instants plus the intended IANA time zone (normally `Pacific/Fiji`). Documents and private identifiers are never returned in public passenger views.

## Endpoints and atomic behavior

### `POST /v1/ride-requests` — passenger

Input: pickup/drop-off place references and display labels, airport condition, passenger count, language, payment preference, `pickupAt` (`null` for now), `pickupTimeZone`.

Acceptance:
- Reject missing/invalid places and past scheduled times with `422 invalid_request`.
- The same passenger, idempotency key and body returns the same request.
- Creating a changed route/time may cancel only that passenger's prior `collecting` request, expire its offers and create the replacement in one transaction.
- Response includes server-owned `id`, `status=collecting`, `revision=1`, timestamps and sanitized request fields.

### `GET /v1/ride-requests/{requestId}/offers` — owning passenger

Acceptance:
- Refresh active offers against server time and current eligibility before returning them.
- Return only selectable offers plus a summary count for `active`, `expired` and `unavailable`.
- Never reactivate an expired or eligibility-invalidated offer. A fresh driver quote is a new offer ID.

### `POST /v1/ride-requests/{requestId}/offers` — eligible on-duty driver

Input: `fareCents`, `etaMinutes`, `expectedRequestRevision`.

Acceptance:
- Recheck role, on-duty state, review/expiry/revocation, vehicle-driver-holder binding, operating scope and airport permission.
- Reject non-collecting or stale requests. Create a 15-minute offer using server time.
- Supersede only the driver's current active offer; retain expired/unavailable records for audit.

### `POST /v1/offers/{offerId}/select` — owning passenger

Input: `expectedRequestRevision`.

Acceptance:
- In one transaction: lock the request and offer, compare revision, recheck offer expiry and driver eligibility/availability, set `assigned`, increment revision, expire alternatives, stop automatic duty and save an immutable snapshot of fare, ETA, basis, pickup time and selected time.
- Competing selection/cancellation commands from the same revision produce exactly one successful state change. Losers receive `409 stale_revision`.

### `POST /v1/ride-requests/{requestId}/cancel` — owning passenger

Input: `expectedRevision`, reason enum (`passenger_requested`, `route_changed`, `schedule_changed`).

Acceptance:
- Permit `collecting`, `assigned` and `arriving`; reject `on_trip` and `completed` with `409 invalid_transition`.
- Atomically set `cancelled`, increment revision, expire all offers and invalidate vehicle confirmation while retaining selected quote/driver history.
- If cancellation races with `arriving -> on_trip` from the same revision, only the command that locks and commits first may succeed. Cancellation-first must clear confirmation; start-first must make cancellation stale because `on_trip` is not cancellable.
- An exact retry with the same idempotency key returns the original cancellation even when the submitted expected revision is now old.
- Do not automatically return an assigned driver to on-duty state. No fee is charged by this endpoint unless a separately approved policy and payment flow exists.

### `GET /v1/rides/current` — authenticated passenger or driver

Acceptance:
- Accept no ride ID, account ID or role selector in the path, query or body. Derive the account and role from the authenticated session and search only unfinished rides visible to that actor.
- Return 200 with the same six-field `RideStateView` used by the scoped read when exactly one unfinished ride exists for the owning passenger or assigned driver.
- Return bodyless 204 when the authenticated role has no unfinished ride, including when only completed or cancelled records exist. Do not distinguish no record from another account's record.
- Return `409 ambiguous_current_ride` without candidate IDs when data corruption or a missing uniqueness rule yields multiple unfinished rides. Never select one arbitrarily.
- Startup discovery needs a complete representation, so it does not accept `If-None-Match` and does not return 304. Use `Cache-Control: private, no-cache` and `Vary: Authorization`; 200 may provide a role-shaped ETag for later scoped reads.
- Keep the read side-effect free and return bounded `Retry-After` for 429/503. Production must enforce the one-unfinished-ride invariant transactionally; the loopback duplicate fixture is only an executable failure-mode check.

### `GET /v1/rides/{requestId}` — owning passenger or assigned driver

Acceptance:
- Return the latest `id`, `status`, `revision`, trusted `updatedAt`, authenticated `viewerRole` and a role-specific `nextAction` after `stale_revision`, reconnect or foreground resume.
- The owner may read the passenger view. Only the currently assigned driver may read the driver view, including a retained cancelled assignment needed to show cancellation history.
- Return `404 resource_not_found` for another passenger or an unassigned driver so ownership and assignment are not disclosed.
- Do not return actor IDs, contact details, permits, document references, raw or booked plates, confirmation evidence, internal assignment fields or server authorization decisions.
- The read is side-effect free: it does not change revision, consume an idempotency key or create a command audit event.
- Return a representation-specific ETag that changes with revision and authenticated viewer role. Do not expose an internal database version, account ID or secret in the tag.
- Accept optional `If-None-Match`. Evaluate ownership/assignment first; then return bodyless 304 only for the same authorized role-shaped representation. Return 200 and the new ETag for an old or other-role tag.
- Send `Cache-Control: private, no-cache` and `Vary: Authorization` on both 200 and 304 so shared caches do not reuse authenticated role-specific responses.
- Return `429 rate_limited` or `503 service_unavailable` with `Retry-After` when recovery should pause. A client must bound both the delay and total attempts, add jitter when using its own exponential backoff, and must not retry 401/403/404 as transient failures.
- Stop scheduled recovery while the view is hidden or the account no longer has access. Foreground/network resumption must start a fresh authorized conditional read rather than replaying a state-changing command.
- Merge notification and recovery results monotonically by `revision`. Ignore older or exact duplicate results, recover on a same-revision conflict or notification gap, and reject another ride or viewer-role representation.
- Treat Push/WebSocket input only as a three-field non-sensitive hint. Never render it directly; obtain the role-shaped display through this authenticated endpoint and clear cached state if access is lost.
- Scope state, ETag, retry and in-flight reads to an authenticated session generation. Logout or account/role change clears and aborts them; late completions from an older generation never enter the new view.
- Bind state-changing commands and idempotency records to the authenticated account. Do not auto-retry after session expiry or an unknown outcome; reconcile first, discard old-session completions and never share a raw key's result across accounts.
- After an unknown command result, confirm the authorized current state. Complete without replay when already applied; replay once with the original key only when the baseline revision is unchanged, and stop on any conflicting revision, access/session loss or second unknown outcome.
- Disable duplicate state-changing controls while confirmation is pending. Keep unresolved, reauthentication and conflict states locked until explicit recovery, and never carry one role's command feedback into the other role.
- Across reload/restart, persist only an allowlisted, expiring unresolved marker. Never persist or reconstruct a command or idempotency key from it, and never auto-replay; authorize and reconcile current state first.
- Bound startup reconciliation to one initial read plus at most one explicit reason-matched reread after connectivity or authentication recovery. Keep the marker on inconclusive results, clear it on 200/404, reject duplicate reads and never interpret 304 as restored state after restart.

### `POST /v1/rides/{requestId}/vehicle-confirmations` — owning passenger

Input: observed plate, person/car comparison attestations, `expectedRevision`.

Acceptance:
- Check current assignment, current eligibility and the booked driver/vehicle. A failed or withdrawn check invalidates prior confirmation.
- Permit confirmation only while the assigned ride is arriving. Compare a normalized observed plate plus explicit person/vehicle attestations; return `409 vehicle_mismatch` without exposing booked private data.
- Bind successful confirmation to request, selected offer, assignment revision, scheduled time, driver, vehicle, holder, normalized plate, vehicle appearance and review revision.
- Advance the ride revision when confirmation is created or an existing confirmation is invalidated. Exact idempotent replay returns the first confirmation without another revision or audit event.
- Store only the minimum evidence required; never treat self-attestation, a QR code, photo or unknown registry result as official proof.

### `POST /v1/rides/{requestId}/transitions` — assigned driver

Input: `from`, `to`, `expectedRevision`; allowed path is `assigned -> arriving -> on_trip -> completed`.

Acceptance:
- Lock the ride, compare revision, confirm assigned driver and current eligibility, and increment revision atomically.
- `arriving -> on_trip` additionally requires a bound vehicle confirmation valid for the exact current revision; otherwise return `409 vehicle_confirmation_required` without advancing state.
- Recheck the assigned driver's current eligibility inside the serialized transition. Revocation returns `409 driver_unavailable` without consuming the confirmation or changing the ride.
- A cancellation or another transition that commits first makes the stale transition return `409 stale_revision` without changing state.
- When ride start commits first, a concurrent cancellation from the prior revision returns `409 stale_revision`; the cancellation path must not overwrite `on_trip`.

## Standard errors

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `authentication_required` | No valid session |
| 403 | `role_or_eligibility_denied` | Authenticated actor lacks role/current eligibility |
| 404 | `resource_not_found` | Missing resource or deliberately concealed foreign resource |
| 409 | `stale_revision` | Resource changed since the client read it |
| 409 | `invalid_transition` | State does not allow this command |
| 409 | `offer_expired` / `driver_unavailable` | Offer cannot be selected now |
| 409 | `vehicle_mismatch` | Observed driver or vehicle does not match the booking; prior proof is invalidated |
| 409 | `vehicle_confirmation_required` | Ride start lacks a confirmation bound to the current revision |
| 409 | `idempotency_conflict` | Same key was used for different content |
| 409 | `ambiguous_current_ride` | More than one unfinished ride matched; no candidate was selected or disclosed |
| 429 | `rate_limited` | Too many recovery reads; honor bounded `Retry-After` |
| 503 | `service_unavailable` | Recovery read is temporarily unavailable; honor bounded `Retry-After` |
| 422 | `invalid_request` | Field validation failed |

Error bodies contain a stable `code`, safe localized message, `requestId` for support correlation and current `revision` only when the actor is allowed to read the resource. They do not expose permits, document paths, reviewer notes or another account's identifiers.

## Executable reference acceptance

`prototypes/tests/role-handover.test.cjs` exercises the in-memory equivalent of the critical transaction rules. The current race tests prove:

1. selecting an offer increments request revision;
2. cancellation-first rejects stale selection without partial changes;
3. selection-first rejects stale cancellation until the current revision is used;
4. an exact cancellation retry is idempotent;
5. a stale driver transition cannot skip a newer ride state.
6. assigned-to-arriving transition and exact replay change state once;
7. normalized booked-vehicle confirmation and exact replay change state once;
8. a later mismatch invalidates proof and advances revision;
9. missing proof or revoked eligibility blocks ride start without advancing state;
10. fresh confirmation permits only the allowed `arriving -> on_trip -> completed` path.
11. cancellation/start races in both commit orders have one winner, one stale loser, stable replay and two non-duplicated audit decisions.
12. both race participants can recover current role-shaped state, while unrelated actors receive a concealed error and reads remain side-effect free.
13. role/revision ETags support strong, weak and wildcard revalidation; old or other-role tags return the current 200 representation, and authorization precedes cache validation.
14. 429/503 and network failures wait without a tight loop, attempts and delays are bounded, access denials do not retry, and hidden views send no request.
15. delayed notifications or recovery responses cannot roll state backward; duplicates are no-ops, same-revision conflicts and notification gaps require recovery, and cross-ride/cross-role input is rejected.
16. notification hints allow only type/ride ID/revision, reject private or display fields, avoid reads for stale/foreign hints, and derive all visible state from an authorized recovery response.
17. logout and account/role switches clear cached state, ETag and retry work, abort old reads, reject late completions, and accept only the new role-bound response.
18. command completion after logout/account change is discarded, 401/403 and unknown outcomes do not auto-retry, and idempotency scope is stable for same-account reauth but distinct and collision-safe across accounts.
19. an unknown command outcome is resolved from authorized current state when already applied, replayed exactly once with its original key only when the baseline is unchanged, and stopped on conflict, access/session loss or another unknown result.
20. passenger/driver command feedback uses role-specific safe copy, rejects duplicate activation while pending, locks unresolved/session/conflict outcomes until explicit recovery and clears on role change.
21. reload/restart recovery stores only a four-field expiring marker, rejects extended/malformed/expired data, never stores identifiers or command material, and resumes as locked reconciliation with `autoResend=false`.
22. startup reconciliation retains that marker across network/5xx/304 and 401/403 failures, permits one explicit reason-matched reread, rejects in-flight/extra reads, clears on 200/404 and never replays the command.
23. authenticated current-ride discovery accepts no ride identifier, returns role-shaped 200 for one unfinished ride, bodyless 204 for none, non-disclosing 409 for ambiguity and remains side-effect free.

These are sequential reference-model tests, not proof of database locking, real concurrency, HTTP authentication or cross-device behavior. Claude's production PR must add integration tests that send concurrent commands to the real persistence layer and verify one winner, stable idempotent replay and complete audit events.
