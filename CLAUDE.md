# Claude implementation brief — role-separated onboarding, minimalist UI, taxi verification

## Intake update — 2026-09-16
Read `docs/HANDOVER_REVIEW_2026-09-16.md` before implementation. The user's complete supplied HTML is now preserved byte-for-byte at `prototypes/role-split/index.html`; it is still an in-memory demo. `prototypes/tests/role-handover.test.cjs` tests that embedded model directly. Current reproducible results are 28 passes (20 verification + 8 role acceptance) and one explicit TODO regression, HANDOVER-01: a later vehicle mismatch does not invalidate an earlier successful confirmation and ride start remains possible. Fix that defect and remove the TODO before accepting the ride-start flow. This intake update does not invoke Claude, integrate the root app or deploy anything.

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
The following is the earlier handoff report, not this intake's rerun. See `docs/HANDOVER_REVIEW_2026-09-16.md` for the 28 current passes, one known regression and the blocked browser revalidation.
44 Node reference-model tests passed (20 verification + 24 role/quote/lifecycle). 18 Chromium browser scenarios passed, including separate onboarding, profile propagation, role route guards, pending-driver restrictions, driver quote -> passenger selection -> driver assignment, vehicle matching, editing and 360/390/430px layout checks.

Tests rendered local HTML using Chromium set_content. They are NOT Android-device, published-URL, backend-security or regulator/Google-API integration tests. New document load clears the in-memory demo; no persisted account/login is claimed.

## Production deliverables expected from Claude
A PR with implemented role-specific UI, actual authentication, server-side role/ownership checks, reviewer permissions, private document storage, audit schema, issuer workflow, eligibility gates, tests, mobile screenshots and an exact integration/deployment status list. Preserve other work; do not merge/deploy unreviewed code, identity documents or secrets. Keep fixture mode explicit until real services exist.
