# Claude implementation brief — role-separated onboarding, minimalist UI, taxi verification

## Intake update — 2026-09-16
Read `docs/PROGRESS.md` for current status, `docs/API_CONTRACT.md` plus `docs/openapi.json` for the production boundary and `docs/HANDOVER_REVIEW_2026-09-16.md` for the historical intake. Run `node prototypes/api-contract-check.cjs` and `node prototypes/http-contract-runner.cjs` before implementing or changing an endpoint. The HTTP runner uses only ephemeral loopback mocks by default. It covers 14 authorization/ownership/input scenarios, authenticated current-ride discovery without a caller-supplied ride ID, selection/cancellation and cancellation/ride-start races in both orders, exact and conflicting replays, role-shaped current-state recovery with private role/revision ETags, bodyless conditional 304, Retry-After, bounded exponential retry/stop behavior, monotonic revision merging, non-sensitive notification hints, read/command session-generation isolation, account-scoped structured idempotency keys and bounded reconcile-before-replay handling for unknown command outcomes, plus server-clock expiry boundaries, current driver eligibility, vehicle-confirmation invalidation, the guarded assigned-to-completed path and allowlisted audit events without credential/private-input leakage or idempotent-replay duplication. The HTML prototype presents role-specific command feedback, locks duplicate commands until explicit recovery, carries only a four-field expiring restart marker, and limits startup reconciliation to one initial `GET /v1/rides/current` plus one explicit connectivity/reauthentication reread. It validates the six-field response allowlist and role before routing a passenger to history or assigned driver to trips, routes a 204 to that role's home, and keeps ambiguous/extended/wrong-role results locked. Startup discovery is bound to a private principal object and session generation: logout, role switch and account switch abort old work and late 200/204/failure results cannot navigate or recreate the old marker. Principal references are absent from request and UI state. It never saves or auto-replays command content, identifiers, credentials or idempotency keys. Use `runHttpContract` against a real environment only after that environment and its fictional test tokens are explicitly authorized. The original supplied HTML is preserved in commit `dcad5dcaa376729e1c77626d9c47cb49b22cb9aa`; the working prototype preserves HANDOVER-01, cancellation, scheduled pickup, expiry/re-quote and request-revision behavior. All 172 reference tests pass (20 verification + 152 role/lifecycle/API/HTTP-contract), with no TODOs. `docs/openapi.json` defines nine operations including authenticated current-ride discovery and the resilient passenger/assigned-driver ride-state read. This remains a browser-memory prototype plus static and loopback-mock contracts, not production authorization, cache/proxy/push/mobile-network/auth-SDK/persistent-idempotency validation or live issuer verification. Claude must replace the mock clock, Promise lock, Map, local marker, injected delays and audit array with authenticated server time, transactions, platform-protected expiring recovery state, persistent idempotency, a durable/tamper-evident audit outbox and real multi-request tests. Cloud-browser visual revalidation is still unperformed due to the prior URL-policy block.

## Continuing development
The user asked to continue building in a loop. GDP may continue design prototypes, acceptance tests and review work, committing bounded changes to the existing draft PR. Production implementation remains assigned to Claude; record actual connection and execution state without claiming it has been started. Read the latest remote head and `docs/PROGRESS.md` before each iteration, complete one meaningful item, verify it and update the progress record. Do not recreate completed fixes or generate empty progress commits.

## Role split and actual status
- GDP / ChatGPT: product design, interaction prototype and acceptance criteria.
- Claude: requested production implementer. No Claude agent has been invoked by this update.
- Standalone interaction prototypes were generated and tested in the conversation. The existing root application files are NOT replaced by these documentation commits. Do not report production implementation or deployment as complete.
- The prototypes use fictional records only: no real registration, driver authentication, regulator access, uploads, dispatch or identity certification.

## Latest priority: separate passengers and drivers from the first screen
Read `docs/ROLE_SPLIT_AND_ONBOARDING.md` FIRST. It supersedes the earlier mixed-role home/menu.

First choose Passenger or Driver -> collect that role's registration fields -> route using its profile to its own home. Passenger tabs: Ride / Vehicle Check / History / Profile. Driver tabs: Home / Requests / Trips / Profile. Driver registration remains pending until reviewer/issuer confirmation; it must not grant operational privileges. A separate reviewed-driver fixture exists only for the demo and must never approve an applicant or ship in production.

The conversation's `taxi_protection_role_test.html` and `taxi_protection_role_source.zip` were the original handoff. The supplied standalone HTML is now at `prototypes/role-split/index.html`; the ZIP and its original role/browser test suite were not included in this intake. The root app remains separate. Local state propagates driver-entered quotes to passenger comparison and accepted offers back to driver assignments in one open document, not across real users or devices.

Production must use authenticated server-owned roles/profile completeness/review status, ownership checks on every API, private documents and transactional offer selection. Do not treat a URL, local role selector, uploaded document or browser-approved flag as authority. Preserve both user groups' separate data and review states.

## Visual direction
White/grey surfaces, charcoal typography, restrained green status accents, simple line icons. Preserve the map-first information architecture without Rova branding/artwork. Add genuine permit/driver/vehicle checks rather than a self-declared verified flag.

## Design acceptance
1. No emoji vehicles/packages, gradients, decorative glows, large black marketing panels or heavy shadows.
2. Passenger Map -> destination input -> offers remains the primary passenger path.
3. Driver registration belongs behind the Driver entry, not in Passenger's home tabs. Vehicle Check belongs to Passenger; application/review status and quoting belong to Driver.
4. Use 1.6px SVG strokes; 44px touch targets, 48px primary actions; no horizontal overflow at 360/390/430px.
5. Map fallback must say schematic/demo, not detected current location. Never claim Google Maps is connected without a successful load.
6. Google Maps JavaScript API, Places PlaceAutocompleteElement and Route.computeRoutes need restricted browser keys and separate live testing. Keep keys out of public GitHub, app URL query strings and browser storage.

## Registration and verification acceptance
Read `docs/MINIMAL_UI_AND_VERIFICATION.md`.
- Registration never grants approval. Applicant cannot set approved/reviewer/issuer-confirmed fields.
- Bind permit holder, driver, vehicle, plate and authorized assignment separately.
- Store source, reviewer, evidence reference, verification method, checked-at, effective/expiry date, recheck date, jurisdiction and operating scope.
- Expired, revoked, suspended, missing/stale or reassigned records must not be offered or start rides.
- Airport pickup requires separately verified permission and operational access.
- Passenger compares observed plate, booked driver photo and actual vehicle. QR/uploaded photo/plate alone is not authenticity proof.
- Unknown in our registry is not proof of illegal operation.
- No public LTA integration/API was established. Arrange authorized/manual issuer confirmation; do not invent endpoints or request passwords/OTPs.
- Actual authorization is enforced by the authenticated server, not a browser predicate.

## Previously reported prototype validation (prior session)
The following is the earlier handoff report, not this intake's rerun. See `docs/HANDOVER_REVIEW_2026-09-16.md` for the historical intake's 28 passes, one then-known regression and the blocked browser revalidation; `docs/PROGRESS.md` records the current result.
44 Node reference-model tests passed (20 verification + 24 role/quote/lifecycle). 18 Chromium browser scenarios passed, including separate onboarding, profile propagation, role route guards, pending-driver restrictions, driver quote -> passenger selection -> driver assignment, vehicle matching, editing and 360/390/430px layout checks.

Tests rendered local HTML using Chromium set_content. They are NOT Android-device, published-URL, backend-security or regulator/Google-API integration tests. New document load clears the in-memory demo; no persisted account/login is claimed.

## Production deliverables expected from Claude
A PR with implemented role-specific UI, actual authentication, server-side role/ownership checks, reviewer permissions, private document storage, audit schema, issuer workflow, eligibility gates, tests, mobile screenshots and an exact integration/deployment status list. Preserve other work; do not merge/deploy unreviewed code, identity documents or secrets. Keep fixture mode explicit until real services exist.
