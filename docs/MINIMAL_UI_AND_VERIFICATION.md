# Minimal UI and genuine taxi verification

## Design specification
Use white #ffffff, charcoal #232524, muted grey #6e7470, borders #e5e7e3, washed grey #f4f5f2. Use muted green #365e51 for evidence-backed positive states and restrained #85402e for warnings. No emoji illustration, gradient, decorative glow, heavy shadow, fake safety score or giant promotional panel. Use simple 1.6px line SVGs for car, person, search, location and shield. Cards 10–14px radius; primary controls at least 48px high. Preserve map-first home, destination input and calm offer comparison. The home should offer Vehicle Check and Driver Registration, not pretend an unimplemented parcel service is available.

## Demonstration scope
The conversation contains a tested standalone HTML design prototype and source ZIP. All names, plates, fares, ETA values and approval records are fictional. No live authentication, database, driver onboarding, permit approval, document upload, dispatch or regulator lookup was implemented. The repository's root application is still awaiting Claude's production implementation of this design. This documentation does not mean an agent has begun work.

## Passenger flow
Destination -> sample offer comparison -> chosen taxi -> observed plate entry -> compare driver and vehicle -> demo completion. The badge must disclose what was checked, by whom, how, when, and until when. Separate a permit check from physical identity/vehicle matching. Changing the plate, vehicle or driver invalidates the prior binding until reviewed. A second legally approved vehicle is still NOT the vehicle assigned to the booking.

## Registration
Application state: draft -> submitted -> document review -> issuer check -> approved/rejected. Submission alone must never permit dispatch. Suspended, expired, revoked, recheck-due and unknown records are blocked. Client input cannot set approval, issuer status or reviewer identity.

Platform onboarding evidence proposed for review with LTA:
- Taxi Permit; vehicle registration/PSV licensing; driver's licence and PSV driver's permit.
- Vehicle fitness; insurance with the intended commercial use/coverage; permit-holder consent/authorization and actual driver/vehicle assignment.
- Authorized base/stand/operating scope, and separate airport authorization for airport pickups.
A permit application receipt is not an activated operating permit. The driver may lawfully differ from the permit holder; verify the authorization instead of requiring identical names.

Each evidence record needs document/issuer/type, permit/driver/vehicle/holder association, relevant plate/chassis details, issue/effective/expiry times, status, verification method, checked_at, reviewer actor, private evidence reference, operating scope and next_review_at. Recheck intervals are internal policy to agree with authorities, not a statutory interval invented by the app. Multiple documents have independent expiries. Preserve corrections/revocations in an audit history.

## Actual issuer confirmation
No public LTA third-party taxi-verification API was established in this work. LTA eServices describes access to the account holder's own licence, registration and permit information; that is not an integration granted to our app. Do not invent an API, scrape authenticated records or request passwords/OTPs.

Initial production workflow: obtain lawful consent; ask LTA through an authorized written/process-based channel to confirm permit, vehicle, driver, assignment and scope. A holder may log in to their own portal for an authorized reviewer to witness, but an uploaded screenshot is not equivalent to a live issuer check. Check airport permissions and insurance with their own issuers. Store the reference, date, reviewer and exact scope. Display a historical check as historical, not live. Arrange revocation/recheck procedures before launch.

## Server requirements for Claude
Authenticated applicant/staff roles and staff MFA; reviewer cannot self-approve. Private upload storage with short-lived authorizations, file limits/validation, malware review, audit and retention/deletion policy. No sensitive identity material in public GitHub, static HTML, logs, query parameters or browser storage. Idempotent application submission and uniqueness/reassignment controls. Server-owned reviewer decisions, not browser-controlled flags.

Dispatch, offer acceptance and ride start must re-evaluate current evidence, relevant expiries/revocations, permitted area/base/stand, airport access and driver-vehicle assignment. Use transactions to avoid races between approval/expiry and booking. The client reference model is not an authorization boundary.

Restrict public lookup to minimal information and exact-match/rate-limited requests. Detailed driver identity/photos belong to an authorized booked passenger view, not bulk public search. Never publicly expose full licence images, personal addresses, phone numbers, chassis or identity identifiers. An absent registry result must say 'Not found in this app; this does not establish illegal operation.'

## Prevent swapped cars and copied QR stickers
Passenger compares booked driver photo, actual person, car/model/colour and observed plate. OCR, if added later, is only input assistance with manual correction, not a legitimacy or biometric check.

A future QR must resolve an opaque, signed, short-lived server token tied to trip/driver/vehicle and be checked online with expiry/revocation, nonce and one-time ride-start challenge/PIN. A static QR sticker or screenshot can be copied and does not prove authenticity. If offline or lookup is unavailable, show unknown/current-status-unavailable rather than a green live certification. QR scanning is not included in the current prototype.

## Important wording
Use 'Documents received', 'Issuer check recorded by operator', 'Needs recheck', 'Expired', 'Suspended' and 'Not in this registry'. Never use an unqualified 'LTA certified', 'official partner' or 'safe taxi' badge without the exact supporting authorization. Reviews are separate from legal status; unverified complaints must not automatically become confirmed violations.

## Source checkpoints — accessed 2026-09-15
- LTA eServices/account-holder information: https://www.lta.com.fj/faqs
- Taxi base/stand framework: https://www.lta.com.fj/ViewContent?ResourceId=10421
- PSV driver licensing provision: https://laws.gov.fj/Acts/ViewSection/65689
- Airport operator approval and meter guidance: https://fijiairports.com/taxis-services/
- Maps key restrictions: https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys
- Current Places widget: https://developers.google.com/maps/documentation/javascript/place-autocomplete-new
- Route API in Maps JavaScript: https://developers.google.com/maps/documentation/javascript/routes/get-a-route

These sources are not an approval of our platform. Resolve pricing/meter rules, platform permissions, commissions, airport access/queue rules and permitted operational scope with LTA/FCCC/Fiji Airports before live service. Google's live services need a configured restricted browser key, enabled APIs/billing, allowed origin and separate live tests.
