# Claude implementation brief — minimalist UI + taxi verification

## Role split and actual status
- GDP / ChatGPT: product design, interaction prototype and acceptance criteria.
- Claude: requested production implementer. No Claude agent has been invoked by this update.
- A new standalone interaction prototype was generated and tested in the conversation. The existing root application files are NOT replaced by this documentation commit. Do not report production implementation or deployment as complete.
- The prototype uses fictional records only: no real registration, driver authentication, regulator access, uploads, dispatch or identity certification.

## Latest user direction
Reduce the AI-looking styling: white and grey surfaces, charcoal typography, restrained green status accents, simple line icons. Preserve the map-first Rova-like information architecture without its branding/artwork. Add official-taxi registration and meaningful authenticity checks rather than a self-declared verified flag.

## Design acceptance
1. No emoji vehicles/packages, gradients, decorative glows, large black marketing panels or heavy drop shadows.
2. Map -> destination input -> offers remains the primary passenger path.
3. Add Vehicle Check and Driver Registration. Unimplemented parcel service must not look live.
4. Use 1.6px stroke SVG icons; 44px touch targets, 48px primary actions; no horizontal overflow at 360/390/430px.
5. The map fallback must say schematic/demo, not detected current location. Do not claim Google Maps is connected without an actual successful load.
6. Use Google Maps JavaScript API, Places PlaceAutocompleteElement and Route.computeRoutes; keep keys out of public GitHub, URL query strings and browser storage. Restrict browser keys by website and API. Live calls still require configured credentials and testing.

## Registration and verification acceptance
Read docs/MINIMAL_UI_AND_VERIFICATION.md.
- Registration never grants approval. Applicant cannot set approved/reviewer/issuer-confirmed fields.
- Separately bind permit holder, driver, vehicle, plate and authorized assignment; allow a lawfully employed driver who is not the permit holder.
- Store source, reviewer, evidence reference, verification method, checked-at, effective/expiry date, recheck date, jurisdiction and operating scope.
- Expired, revoked, suspended, missing/stale or reassigned records must not be offered or start rides.
- Airport pickup requires separately verified airport permission and operational access; ordinary taxi approval is insufficient.
- Passenger checks observed plate, booked driver photo and actual vehicle; a QR, uploaded photo or plate string alone does not establish authenticity.
- Unknown in OUR registry is not proof of illegal operation. Never label an unknown driver fraudulent.
- No public LTA integration/API was established. Build an authorized/manual issuer-confirmation workflow first; do not invent endpoints or request an operator's password/OTP.
- Actual dispatch authorization belongs to the authenticated server, not a client predicate or localStorage flag.

## Prototype checks already run locally
20 reference-model unit tests passed, covering missing/expired evidence, revocation-like suspension, stale dates, future dates, self-approval, forged approval input, driver/vehicle/holder/plate reassignment, airport scope and wrong-booked-car checks. Browser smoke checks passed for sample offers, plate lookup, pending-only application, airport filtering and 360/390/430px overflow. These are NOT backend/security/regulator integration tests.

## Production deliverables expected from Claude
A PR with implemented UI; authentication and reviewer permissions; private document storage; application/review audit schema; server-side eligibility gates; issuer confirmation workflow; tests; mobile screenshots; and a precise list of unconnected services. Use branches/PRs; preserve other work. Do not merge or publish unreviewed identity documents or secrets. Keep sample mode explicit until the real system is connected.
