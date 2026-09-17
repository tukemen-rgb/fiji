# Passenger / driver entry, onboarding and role-specific screens

## Latest user request
Select Passenger or Driver FIRST. Register the information required for that role. Route to the corresponding home using that registered information. Each role must see different information and input controls, not a shared mixed-role menu.

## Status and ownership
Current update: the standalone HTML at `prototypes/role-split/index.html` carries scheduled pickup time through both role-specific interfaces, handles offer expiry/re-quote and rejects stale ride commands by request revision, alongside pre-boarding cancellation and the vehicle-confirmation fix. `docs/openapi.json` makes eight production-boundary operations machine-readable, including a role-shaped current-ride read with private role/revision ETags, conditional 304, Retry-After and bounded retry behavior; the static checker rejects missing authentication/idempotency/revision, caller-controlled actor or approval fields, private recovery fields and unsafe cache/retry metadata. `prototypes/http-contract-runner.cjs` includes role/ownership/input, concurrent select/cancel and cancel/ride-start races, resilient conditional recovery reads, monotonic revision merging, non-sensitive notification hints that never supply display state, idempotent replay, server-clock expiry boundary, current-driver-eligibility, vehicle-confirmation invalidation, guarded trip transitions and allowlisted audit-event checks. All 117 reference tests pass; see `PROGRESS.md` and `API_CONTRACT.md`. The original user-supplied bytes remain in the intake commit, and `HANDOVER_REVIEW_2026-09-16.md` preserves that earlier review. The prototype has not been integrated into the root application.
GDP / ChatGPT created and locally tested an interaction prototype, delivered in the conversation as `taxi_protection_role_test.html` and `taxi_protection_role_source.zip`. The complete UI source is in that downloadable archive, NOT in this repository's root application. This commit records the production implementation contract; it does not deploy the prototype or invoke Claude. Claude remains the requested production implementer.

All accounts, permits, fares, vehicles, matches and approval records in the preview are fictional. State is in memory in one open document. No authentication, OTP, database persistence, cross-device synchronization, issuer verification, upload, notification, payment or real dispatch is connected. Existing optional Maps adapters were retained, but live Google Maps requests were not tested in this update.

## Screen map
- First entry: role chooser -> passenger registration OR three-stage driver registration.
- Passenger registration -> passenger home.
- Driver submission -> driver home showing review pending, never immediate eligibility.
- Selecting a previously registered role again within the open demo reuses that role's profile and home.
- Production returning-login flow must resolve roles, profile completeness and driver review state from the authenticated server. A client role flag is not an authorization source. A second role requires its own approved membership/onboarding.

### Passenger registration and home
Fields: display name, country-code phone, optional email, communication language, optional default pickup/hotel, preferred payment method, required consent. Do not ask passengers for taxi permits or driver licences. Real contact verification is a separate pending production feature.

Copy name into the greeting, default pickup into the route input, communication language and payment preference into the booking request. Keep the interface Japanese in this preview; selecting English means communication preference, not a completed UI translation.

Tabs: Ride / Vehicle Check / History / Profile.
Passenger controls: pickup/destination, compare multiple driver quotes/ETA, select an offer, compare observed car and driver, view own requests and locked quote, edit own passenger profile. Never display full driver licence numbers, personal addresses or submitted identity documents to passengers.

### Driver registration and home
Steps: identity/contact and driving qualifications -> vehicle/plate/permit holder/operating scope -> sample documents/expiry/consent. Owner and driver are separate entities; validate their authorized assignment rather than requiring identical names.

Tabs: Home / Requests / Trips / Profile.
Home displays registered name, plate, vehicle, operating scope and review state. Pending, expired, suspended or otherwise unconfirmed drivers cannot start accepting requests, submit quotes or begin pickup. Document submission is not approval.

Eligible drivers can toggle on-duty status. Request detail shows pickup/dropoff, people count, communication language and payment preference; not bulk passenger contact data. Driver inputs fare in FJD (two decimal places) and ETA (1-180 minutes in the prototype). Fee quotes are recorded as estimates; the demo does not settle their legal relationship to meter/fixed fares.

After quoting, show 'Waiting for passenger acceptance'. Do not show 'Go to pickup' until the passenger actually chooses that offer. A driver's new quote supersedes that driver's old active quote, not an already selected snapshot.

Trips shows only assignments selected for that driver: assigned -> arriving -> passenger vehicle check -> on_trip -> completed. Completion is not proof of payment. Profile shows that driver's own application details and permits, with edits remaining pending.

Any new vehicle lookup, observed-plate edit or withdrawal of the person/car match invalidates earlier confirmation. A failed recheck must leave ride start blocked. The confirmation belongs to the current trip, selected quote, assignment revision and observed driver/vehicle binding; a replacement or changed appearance requires fresh confirmation. The driver button and transition use the same current confirmation rule. Retrying plate input preserves the booked assignment instead of silently clearing it. These prototype rules must be enforced on the authenticated server in production.

## Separate approved-driver fixture
The role chooser has an explicitly labelled test-only entry for a different already-reviewed fictional driver (DEMO 001). It does NOT approve the applicant or mutate the applicant's submitted evidence. Returning to the applicant still shows pending. Remove this fixture switch from production.

## Cross-role interaction test
1. Register Passenger, create a request.
2. Return to role selection, open the reviewed-driver fixture and go on duty.
3. Enter a quote for that request.
4. Return to Passenger, open History -> offers, select that quote.
5. Return to the reviewed-driver fixture -> Trips; the selected request is now assigned.
6. Driver begins pickup; passenger checks the assigned vehicle; driver can then start/complete the simulated trip.

This is one in-memory state observed through two interfaces, NOT real multi-user messaging or notification.

## Pre-boarding cancellation — prototype contract (2026-09-17 Fiji)
- Passenger History offers a cancellation dialog for the owner's collecting, assigned and arriving requests. The non-destructive dialog action keeps the request; final confirmation rechecks ownership and status.
- Only the owning passenger can cancel. A repeated cancellation returns the same record without changing timestamps, reason or price history. An unknown/foreign request or a ride already on_trip/completed is rejected without changes.
- Cancellation expires all offers (including the selected offer) and clears vehicle confirmation. Old quote/select/confirm/pickup/start operations are rejected. No automatic driver-duty resumption.
- Retain driverId, selectedOfferId and the immutable quoteSnapshot (fare, ETA, estimate basis, selection time). Record cancelledAt (ISO UTC), cancelledFrom, cancelledBy and cancelReason. Route replacement uses route_changed; explicit cancellation uses passenger_requested.
- Passenger history and assigned-driver Trips retain the cancelled record and explain that quoted amounts are not charges. Remove cancelled rides from eligible request lists and active-trip counts; do not show ride-advance controls.
- No real notification, refund or cancellation fee is implemented. Production needs an authenticated server transaction coordinating cancel/select/start and an idempotent audit/event record. Client state and sequential Node tests are not evidence of backend authorization or multi-device atomicity.

### Manual cancellation acceptance steps — NOT executed in this update
1. Register the sample passenger, request a ride, open History -> cancel; choose Continue or Escape and confirm the request is unchanged. Reopen and confirm; History must show cancelled and no actionable offers.
2. Quote from the reviewed driver, accept as passenger, begin pickup and confirm the correct car; cancel from passenger History. Driver Trips must show the cancellation, preserved price and no start button; Home must show no active trip.
3. Explicitly resume driver duty and create a new passenger request. The new request can receive a quote, but the cancelled request cannot.
4. Start a confirmed trip first; History must no longer offer cancellation. Recheck at 360/390/430px and on an Android device when authorized browser/device access is available.
The model equivalents are covered by the eight added Node tests; dialog clicks, focus, mobile layout and real browser event dispatch remain unverified.

## Scheduled pickup — prototype contract (2026-09-17 Fiji)
- A passenger may choose immediate pickup (`pickupAt: null`) or a future local date/time. The browser converts a valid future selection to an ISO UTC timestamp before creating the request; invalid or past values are rejected without replacing an open request.
- The request carries the same `pickupAt` through passenger comparison/history and driver request/trip views. The UI labels rendered values as this device's time. Production must store an absolute instant plus the intended IANA time zone and define daylight-saving behavior; this prototype does not test cross-time-zone devices.
- The same route, airport condition and pickup time is idempotent. Changing only the time cancels the older collecting request with `schedule_changed`, expires its offers and creates a new request. Returning to immediate pickup is also a schedule change.
- Offer selection copies `pickupAt` into the immutable quote snapshot with fare, ETA, basis and selection time. Vehicle confirmation is bound to the pickup time, so a changed assignment time needs fresh confirmation.
- Driver ETA copy says “arrival estimate relative to the booked time” for scheduled requests. This does not define a legal dispatch window, driver reminder, no-show rule, cancellation fee or guaranteed arrival.
- No scheduler, push notification, background job, database persistence or multi-device synchronization is connected. Production needs authenticated, transactional schedule/change/cancel operations and explicit Fiji/local-time handling.

### Manual scheduled-pickup acceptance steps — NOT executed in this update
1. Set a future time, create a request and verify the same local display in passenger Offers/History and driver Requests.
2. Quote and accept the scheduled request; verify passenger History and driver Trips retain the time and quote snapshot.
3. Before acceptance, change the time and compare again; the previous request must be cancelled with no usable offer. Switch back to “Now” and verify it creates an immediate request.
4. Try a past time and malformed value; no request may be created or replaced. Recheck behavior in different device time zones and at 360/390/430px when browser access is available.
The six added Node tests cover the model rules, not dialog events, locale formatting, background execution or real notifications.

## Offer expiry and re-quote — prototype contract (2026-09-17 Fiji)
- Each prototype offer is valid for 15 minutes. Reading or selecting offers refreshes active records against the current time and driver eligibility. Time expiry becomes `expired/time`; failed current eligibility becomes `unavailable/eligibility`.
- The passenger comparison shows an approximate remaining time. When no selectable offer remains, it distinguishes expired quotes from no currently eligible vehicle and offers a refresh action. It never makes an expired amount selectable again.
- The driver's Requests view detects their stale input, explains the state, prefills the prior fare/ETA for convenience and submits a new offer record. The stale record remains expired/unavailable for audit; it is not overwritten or revived.
- A new active offer can be selected after refresh. If only one of several offers expires, the others remain comparable. A passenger can read the summary only for their own request.
- Production must use a trusted server clock, persist status transitions/audit events, enforce ownership and current eligibility transactionally at selection, and deliver notifications or polling across devices. This in-memory prototype refreshes only on a relevant screen/model action.

### Manual offer-expiry acceptance steps — NOT executed in this update
1. Create a request with multiple offers; expire one test record and refresh. The expired card must disappear while other current offers remain.
2. Expire every offer and refresh. The passenger must see that old prices cannot be selected plus a “check latest offers” action.
3. As the reviewed driver, reopen Requests. The stale fare/ETA should be shown with a re-quote action; submit a new amount, return as passenger and refresh to see only the new selectable offer.
4. Suspend a quoted driver in the fictional record. The offer must become unavailable and must not revive merely by editing the record back; a fresh quote is required after eligibility is restored.
The five added Node tests cover status transitions, re-quote and ownership. Countdown updates, focus behavior, real waiting, notifications and multi-device refresh remain unverified.

## Stale-command and race acceptance (2026-09-17 Fiji)
- Each request begins with `revision: 1`. Successful selection, cancellation and driver trip transitions increment it. UI buttons carry the revision that was rendered with the action.
- If another action changed the request first, a select/cancel/trip command with the old revision is rejected without partial changes and the UI refreshes. This covers both cancellation-first and selection-first orderings.
- An exact retry of an already completed cancellation returns the same cancelled record without another timestamp or revision increment. Production additionally requires a persisted Idempotency-Key; the browser-memory prototype does not implement HTTP replay storage.
- A stale driver screen cannot skip a newer trip state. Vehicle-confirmation binding remains a separate condition for `arriving -> on_trip`.
- `docs/API_CONTRACT.md` defines the production endpoints, authenticated actor derivation, server clock, expected revision, idempotency, atomic invariants and safe error codes.

The five race tests execute sequential orderings in the reference model. They are not evidence of real database locks, simultaneous HTTP requests, authentication, persistence or multi-device behavior.

## Production authorization acceptance criteria
- Separate account/membership, passenger_profile, driver_profile and reviewer permissions.
- Derive passenger_id/driver_id from the authenticated session, not caller-supplied identifiers.
- Every endpoint checks role, ownership, trip participation and permitted action. Protect direct URLs, not just navigation visibility.
- Passenger can access only their own profiles/requests. Driver sees own documents and eligible/assigned requests only. Minimal trip-specific contact data only after authorized assignment.
- Approval, issuer-check provenance, reviewer identity, revocations and eligibility are server-owned. Reject client attempts to set these fields.
- Recheck expiry/revocation, vehicle-driver-holder binding, permitted operating scope/base/stand and separate airport eligibility when bidding, accepting an offer and starting the trip.
- Validate an offer belongs to that passenger's request, is live and available; atomically select exactly once and invalidate alternatives. Selected quote snapshots must not be silently altered.
- Registration corrections, partial onboarding recovery, phone/email re-verification, expiry of sessions, logout, duplicate submissions and cross-device sync require real backend tests.
- Preserve private document storage and issuer verification requirements in MINIMAL_UI_AND_VERIFICATION.md.

Security reference: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html (checked 2026-09-16). A browser UI guard is not authorization enforcement.

## Prior-session prototype test report
These counts were reported in the earlier handoff. This intake independently reran 20 verification tests and added 8 passing role tests plus one known TODO regression. Browser revalidation was blocked; see `HANDOVER_REVIEW_2026-09-16.md`.
- Node reference-model tests: 44 PASS (20 previous verification + 24 role/quote/lifecycle).
- Browser scenarios: 18 PASS, including profile propagation, role route separation, pending-driver blocks, quote/acceptance round-trip, vehicle mismatch gate, profile edits and 360/390/430px overflow checks.
- Browser test used Chromium set_content rendering of the standalone HTML. No external requests or JS runtime errors during tested flows. This is NOT an Android-device/file-navigation/live-API/production-authentication test.
- Existing main/root application was not overwritten or deployed by this documentation update.
