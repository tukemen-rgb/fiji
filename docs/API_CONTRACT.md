# Production API acceptance contract — role-separated Fiji taxi flow

Status: GDP / ChatGPT acceptance contract for Claude's future production implementation. No backend, authentication provider, database, notification service, payment service or regulator connection is implemented by this document.

Machine-readable companion: `docs/openapi.json`. Run `node prototypes/api-contract-check.cjs` to check its required operations, authentication, idempotency headers, optimistic revisions, safe input fields, money/time representations and error envelope. This is a static contract check, not an HTTP or backend integration test.

HTTP acceptance runner: `node prototypes/http-contract-runner.cjs`. Its default mode starts ephemeral servers on `127.0.0.1`, sends real HTTP requests, then closes them. Fourteen scenarios cover unauthenticated access, passenger/driver role confusion, pending-driver denial, foreign passenger resources, unassigned-driver transitions, caller-supplied identity, missing idempotency keys and three positive controls. Additional flows cover selection/cancellation races, offer validity, vehicle confirmation and the assigned-to-completed ride path. `runHttpContract(baseUrl, tokens)` is transport-reusable for a future authorized test environment, but no remote base URL or real token is configured or contacted here.

The same command also sends offer selection and cancellation concurrently from revision 2 with different idempotency keys. Exactly one returns 200 and revision 3; the loser returns `409 stale_revision`. An exact retry of the winner returns the frozen original response without another state change, while the same key with changed content returns `409 idempotency_conflict`. This loopback mock serializes with an in-memory promise lock and stores replay records in a Map; it is executable acceptance behavior, not evidence of database locks, multi-process safety or persistent idempotency storage.

Offer-selection validity scenarios use an injected trusted server clock. A quote is rejected with `409 offer_expired` when server time is equal to or later than `expiresAt`; one millisecond before expiry is accepted. Current driver eligibility is rechecked inside the same serialized selection and returns `409 driver_unavailable` without assigning or incrementing the ride when eligibility has been lost. A caller-supplied `clientNow` is rejected as an unknown input rather than influencing the decision. This deterministic clock is a test fixture, not a live time service, background expiry worker or regulator check.

The loopback runner also records allowlisted audit events for offer selection and ride cancellation inside the same serialized callback as their state decision. Committed commands and rejected `stale_revision`, `invalid_transition`, `offer_expired` and `driver_unavailable` decisions carry event type, outcome/reason, server-owned actor reference, request/offer reference, before/after revision and trusted server time. An exact idempotent replay returns the saved result without creating another event. The executable check rejects unexpected event fields and credentials or private request inputs such as bearer tokens, idempotency keys, contact details, observed plates and permit data. The mock array is neither durable nor tamper-evident and does not prove that a production database commits business state and audit outbox atomically.

Vehicle confirmation and ride-transition scenarios use the same revision, idempotency and audit mechanism. The booked plate is normalized server-side; the raw observed plate is never copied into audit events. A later mismatch invalidates an existing confirmation and advances the revision so a stale ride-start command cannot reuse it. `arriving -> on_trip` requires both a confirmation current for that exact revision and a currently eligible assigned driver. Exact confirmation/transition replays do not advance state or duplicate audit records.

The boarding race sends passenger cancellation and driver `arriving -> on_trip` from the same revision over concurrent loopback HTTP requests. Both deterministic orderings are exercised: cancellation-first clears vehicle proof and makes ride start return `409 stale_revision`; start-first enters `on_trip` and makes cancellation return the same safe conflict. Exactly one command returns 200 and revision 7, the loser receives current revision 7, and replaying the winner does not add a state or audit change. Small injected mock delays control which request reaches the serialized section first; they are test scaffolding, not evidence of production scheduling, database isolation or multi-server locking.

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

These are sequential reference-model tests, not proof of database locking, real concurrency, HTTP authentication or cross-device behavior. Claude's production PR must add integration tests that send concurrent commands to the real persistence layer and verify one winner, stable idempotent replay and complete audit events.
