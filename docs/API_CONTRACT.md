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

Startup reconciliation calls `GET /v1/rides/current` without a caller-supplied ride, role or account identifier. A six-field role-shaped 200 is validated again before navigation: the passenger returns to passenger history and the assigned driver to driver trips. A bodyless 204 clears the marker and returns that role to its own home. A 409 ambiguity, wrong-role body, unexpected field or invalid active state keeps commands locked and exposes no candidate. Network/rate-limit/5xx failures and a bodyless 304 retain the original marker and command lock; after connectivity is explicitly restored, one additional discovery read is allowed. A 401/403 likewise retains the marker and permits one additional read only after explicit reauthentication. A concealed 404 clears it and stops. The reason must match the failed state, concurrent reads are rejected, and no third read or command replay is allowed.

That discovery is also bound to an internal authenticated principal and monotonically increasing session generation. Logout, account change or passenger/driver switch advances the generation, signals cancellation to every in-flight discovery and immediately clears the old restart marker. A completion checks the exact principal object and generation again; a late 200, 204 or failure is discarded as `stale_session`, cannot navigate, unlock a new session or recreate an old marker. Account references, tokens and session identifiers are not included in the discovery request or returned controller state. Token refresh/explicit reauthentication for the same principal uses the bounded reauthentication reread and is not a principal replacement.

After a principal change, startup discovery is initialized explicitly and at most once for that new generation. Initialization first removes the old marker, then creates a fresh four-field marker for the matching role; it never copies a prior marker or stores either account reference. A role mismatch or repeated initialization is rejected before HTTP. If old and new reads overlap, in-flight state is derived from the set of generation-bound handles, so completion cleanup from an old generation cannot release the new generation's duplicate-read lock. The new generation still gets only the bounded initial read and applicable one-time connectivity/reauthentication reread.

The screen lifecycle bridge registers visibility, page-show and online listeners once per active role flow. Visibility and page-show events only synchronize the flow's visible state; overlapping events rely on the controller's in-flight guard and must not produce duplicate discovery reads. Online events may invoke the single connectivity reread only when the screen is visible and the controller is specifically in an unresolved connectivity-retry state; they never substitute for explicit reauthentication. Detaching the role screen removes every listener and disposes its flow so late read results and later events cannot navigate, unlock or send another request. The bridge's public state contains no principal, ride identifier or response body. The executable reference uses a browser-compatible fake event target, not a real browser or mobile operating-system lifecycle.

One role-screen lifecycle owns exactly one flow/bridge pair. Duplicate entry to the same active role is a no-op. Switching roles detaches the previous bridge before constructing the next role's pair; leaving and later re-entering the same role also creates a new monotonically increasing lifecycle generation. A startup or online result from a departed generation is stale even when the new screen has the same role, and cannot navigate or unlock it. Hidden entry waits for the first visible page-show signal before discovery. The lifecycle's public snapshot may identify the active role and generation, but never a principal, ride or response payload. This reference is a dependency-injected screen model and does not prove integration with a browser router or authentication SDK.

Routes owned by the active role share that lifecycle generation: bottom-menu and registration navigation must not recreate its flow, bridge or startup read. Returning to role selection leaves and disposes the lifecycle; cross-role navigation detaches before entering a fresh generation. A monotonically increasing navigation revision rejects late asynchronous entry completion so rapid taps cannot roll the page back. Unknown pages and caller-provided role hints that do not match the route owner fail without changing the active lifecycle. This reference does not prove browser history, back-button or framework-router integration.

Explicit latest-state and post-reauthentication reads are bound to the active role and lifecycle generation. Only `connectivity` and `reauth` reasons are accepted; another action in the same generation is rejected before a read. Leaving or switching roles makes the old completion stale, while the new role may start its own independent action. A stale role, generation or departed page cannot navigate or unlock commands. This reference does not prove authentication-SDK completion, OS request cancellation or real button wiring.

The role lifecycle injects that same single-flight recovery request into its online-event bridge. Manual-first and online-first races therefore issue one authorized read, hidden completion remains deferred until the active page returns, and online never substitutes for explicit reauthentication. Switching roles discards the old online completion without preventing an independent read in the new generation. This reference uses a fake event target and does not prove browser or OS connectivity semantics.

Notification-triggered recovery uses the same active role/generation single flight as manual and online recovery. The client accepts only the exact three-field hint allowlist, verifies ride scope and a newer revision before I/O, and rejects private, foreign, stale and duplicate hints without a read. Only a validated six-field authorized response may update the local ride view; 401/403/404 clear it, 304 does not manufacture the hinted state, and a completion from a departed role generation is discarded. The public coordinator snapshot excludes the ride identifier and all notification/response bodies. This reference does not prove push destination authorization, delivery or operating-system background behavior.

While that authorized notification read is in flight, later valid hints for the same ride are reduced to one maximum positive revision; no hint body or list is retained. If the first response reaches that maximum, no extra request is sent. Otherwise exactly one follow-up authorized read targets the maximum. A still-newer hint arriving during the follow-up may update the retained maximum, but it cannot start a third automatic read; the client remains explicitly unresolved instead of looping. Invalid/private/foreign hints never enter the retained maximum, and role-generation exit clears it. This is a bounded client acceptance rule, not evidence of push ordering, durability or delivery.

If that bounded follow-up still does not reach the retained maximum revision, the role view disables state-changing commands and exposes only an explicit latest-state action. Passenger copy names the ride request and driver copy names the operation; both state that automatic recovery has stopped. Later valid hints update only the retained maximum without I/O. One explicit action reads that maximum once: catching up clears the lock, remaining behind keeps it, and neither outcome starts another automatic loop. Leaving the role clears the retained target and old-role lock. This is an executable UI-state contract, not a browser-button, authentication or production-network result.

That explicit notification recovery action distinguishes safe failure outcomes. A network exception, 429 or 5xx keeps the retained maximum revision and the passenger-request or driver-operation command lock, exposes only a connectivity/latest-state action, and never retries automatically. A 401 or 403 clears the cached ride view, keeps commands locked and exposes only role-specific reauthentication. A 404 clears the stale ride and retained target, returns the role to its empty current-ride state and unlocks commands. Later hints after a connectivity failure may update only the retained maximum without I/O. This is an executable injected-read/UI-state contract, not proof of a real authentication SDK, push transport or mobile network.

A notification-feedback flow copies only the allowlisted title, message, command-lock boolean and `refresh`/`reauth` action from that recovery state into the existing role-specific command banner. It binds every action to the command UI's current role generation, permits one action in flight, and rejects duplicate activation before recovery or reauthentication I/O. If the role generation changes while an action is pending, its delayed result cannot alter the new role's banner or lock. A 404 empty result uses the same shared banner path to show the role-specific empty state and unlock commands. The adapter snapshot contains no ride ID, notification body or principal reference. This is an executable UI-state adapter contract, not proof of browser DOM events or a live login flow.

The notification-feedback event bridge attaches the banner click listener once per role generation and forwards only the currently allowlisted `refresh` or `reauth` action. It rejects double clicks while work is active, removes the listener before disposing the role flow, and discards delayed rendering and stale button events after detach or role switch. Its public state contains only attachment, busy and event-count metadata. This is verified with an injected fake event target and renderer; it is not proof of real DOM lifecycle or browser event ordering.

The role-screen lifecycle owns that feedback bridge beside its startup recovery bridge. One role entry creates and attaches one feedback bridge; duplicate same-role entry is inert. Leaving or switching roles detaches the old feedback bridge before disposing the startup flow, and re-entry creates a fresh role generation. An old button or delayed action result cannot render into the replacement generation. This is a lifecycle ownership contract exercised with fake event targets, not proof of a production router or DOM teardown.

Notification-hint intake is bound to that lifecycle's active role and generation before it reaches the feedback bridge. Cross-role, stale-generation and post-exit input stops before hint processing, rendering or authorized recovery I/O. Same-role re-entry accepts only the fresh generation, and a read completing after role switch is discarded as stale rather than rendered into the replacement role. The hint remains subject to the three-field allowlist downstream. This injected intake contract is not proof of push delivery or subscriber authorization.

The role-screen lifecycle also owns the notification event subscription. Entry attaches one listener whose callback closes over the current role and generation; the event caller supplies only `detail`, so caller-provided role or generation fields cannot select authorization context. Exit and role switch detach that listener before other recovery teardown, and same-role re-entry creates a fresh subscription. Completion from a detached or replaced listener is stale and cannot update the replacement banner or command lock. This fake-event-target acceptance does not prove push/WebSocket subscription authorization, operating-system delivery or real browser event ordering.

The notification subscription also belongs to a private authenticated-session binding. Re-entering the same role with the identical binding is inert, while a different binding first tears down the old listener and creates a fresh lifecycle generation even when the visible role is unchanged. Logout removes that listener before later events, and an old-account read completion is discarded after the replacement session starts. The binding may be injected into private flow/subscription factories but is excluded from lifecycle, feedback and event-bridge snapshots. This object-identity reference is not proof of an authentication SDK, token revocation or server-authorized push destination.

Asynchronous notification subscription setup receives an abort signal and is started once for the active role/authentication-session generation. Logout, role switch or same-role account replacement aborts a connection still being established. If that obsolete setup resolves afterward, its returned unsubscribe operation runs immediately and the bridge never becomes connected. Old callbacks stop before authorized reads, and an old notification read already in flight becomes stale before it can render into the replacement session. Public bridge state excludes the session binding, credentials, endpoint, abort signal and notification body. This injected subscription contract does not prove real Push/WebSocket cancellation, token revocation or network timing.

An initial notification-subscription failure or a disconnect after connection locks role-specific state-changing commands and exposes one explicit reconnect action; it never starts an automatic reconnect loop. That action is single-use and single-flight. A successful transport reconnection remains locked until one authorized latest-state verification returns an explicit verified result. Reconnection or verification failure removes the reconnect action while retaining the lock, and logout/role exit aborts pending setup and discards late success. Passenger feedback names the request and driver feedback names the operation. Public recovery state excludes session references, credentials, endpoints, abort signals, notification bodies and verification responses. This executable injected-transport contract is not proof of real Push/WebSocket reconnect behavior, authentication or mobile-network recovery.

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
22. startup reconciliation retains that marker across network/5xx/304 and 401/403 failures, permits one explicit reason-matched reread, rejects in-flight/extra reads and never replays the command.
23. authenticated current-ride discovery accepts no ride identifier, returns role-shaped 200 for one unfinished ride, bodyless 204 for none, non-disclosing 409 for ambiguity and remains side-effect free.
24. the startup controller consumes that discovery endpoint directly: validated 200 returns to the matching role screen, 204 returns to the matching home, and ambiguous, extended or wrong-role responses fail closed without exposing ride data.
25. startup discovery is principal/generation-bound: logout, role switch and same-role account switch abort old work; late success, empty and failure results are discarded without navigation, stale marker recreation or principal disclosure.
26. a new principal generation can initialize role-matched discovery once with a fresh minimal marker; repeated or cross-role initialization sends no request, and old completion cleanup cannot unlock a concurrent new read.
27. the startup UI adapter applies a validated role/generation result once: passenger and driver recover only to their own screens, stale/duplicate/cross-role results cannot navigate or unlock commands, and connectivity, reauthentication or invalid-view results remain safely locked.
28. the startup screen flow connects initial discovery, explicit connectivity/reauthentication rereads and new-session initialization to that adapter; disposing the role flow aborts work and rejects late completion, while role mismatch, duplicate initialization and unsupported recovery actions send no read.
29. hidden startup screens send no discovery or explicit connectivity reread; a result completing while hidden is privately deferred and applied once when visible, rapid hide/show does not duplicate a read, and disposal permanently drops the deferred result.
30. the lifecycle event bridge attaches visibility, page-show and online listeners once, coalesces duplicate foreground/connectivity signals, keeps reauthentication separate, defers a read completed while hidden and removes all listeners plus stale flow state on detach.
31. role-screen entry owns one flow/bridge generation: duplicate entry is inert, role switch detaches the old generation first, same-role re-entry is fresh, hidden entry waits for page-show, and delayed work from a departed generation cannot affect the active screen.
32. role-internal routes keep that generation and read, role selection alone leaves it, cross-role routes start fresh, and a navigation revision prevents delayed entry completion from rolling back the last selected page.
33. explicit latest-state and post-reauthentication actions send at most one read in the active role generation; duplicates and stale role/generation requests stop before I/O, and leaving or switching makes the old result unusable without blocking a fresh action in the new role.
34. manual and online-triggered connectivity recovery share the same role-generation single flight: either ordering sends one read, hidden completion is deferred once, reauthentication stays explicit, and an old online result cannot cross a role switch.
35. a three-field notification hint shares that single flight with manual and online recovery: invalid/private/foreign/stale input stops before I/O, only the authorized six-field response updates state, and a delayed result cannot cross a role-generation change.
36. valid same-ride hints arriving during notification recovery retain only the maximum revision, send no follow-up when the first response catches up, otherwise send exactly one follow-up, never a third automatic read, and discard the retained maximum on role exit.
37. if the bounded notification recovery still trails the retained maximum, passenger/driver UI uses role-specific wording, locks state changes and offers one explicit latest-state read; success unlocks, another short read remains locked without looping, and role exit clears the target.
38. explicit notification recovery failures are classified without automatic replay: network/429/5xx retain the maximum revision and role-specific lock, 401/403 clear cached state and require reauthentication, 404 clears stale state into an unlocked role-specific empty view, and later hints after connectivity failure perform no I/O.
39. notification recovery feedback is allowlisted into the shared role command banner; latest-state and reauthentication actions are single-flight, duplicate taps stop before I/O, delayed completion cannot cross a command-UI role generation, and 404 produces an unlocked role-specific empty banner.
40. a notification-feedback event bridge attaches one click listener per role generation, accepts only the currently allowlisted refresh or reauthentication action, rejects double clicks before I/O, removes its listener on role exit, and drops delayed rendering or stale button events after detach or role switch.
41. the role-screen lifecycle owns one notification-feedback bridge per generation: duplicate entry does not attach again, leave detaches before later clicks, role switch detaches old before attaching new, same-role re-entry is fresh, and delayed old action rendering cannot affect the active generation.
42. notification-hint intake accepts only the active role/generation before feedback processing: cross-role, stale-generation and post-exit hints cause no read or render, same-role re-entry accepts only the fresh generation, and a delayed old hint result cannot alter the replacement role.
43. role entry owns one notification event listener whose callback captures the active role/generation and accepts only event detail; duplicate entry does not attach again, exit/switch detaches first, re-entry uses a fresh generation, and delayed completion from an old listener is discarded.
44. notification subscription ownership includes a private authenticated-session binding: identical same-role entry is inert, same-role account replacement detaches and creates a fresh generation, logout blocks later events, old-account reads cannot update the replacement session, and no session reference appears in public snapshots.
45. asynchronous subscription setup receives an abort signal: logout or session replacement aborts pending setup, a late success is immediately unsubscribed without becoming active, old callbacks perform no authorized read, and an in-flight old result cannot render into the replacement session.
46. subscription failure or post-connect disconnect locks passenger/driver commands and offers one explicit reconnect only; duplicate or repeated reconnects stop before I/O, transport success stays locked until one authorized latest-state verification succeeds, failures never auto-loop, and logout discards a late reconnect without exposing private connection data.

These are sequential reference-model tests, not proof of database locking, real concurrency, HTTP authentication or cross-device behavior. Claude's production PR must add integration tests that send concurrent commands to the real persistence layer and verify one winner, stable idempotent replay and complete audit events.
