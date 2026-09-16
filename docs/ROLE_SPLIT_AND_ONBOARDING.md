# Passenger / driver entry, onboarding and role-specific screens

## Latest user request
Select Passenger or Driver FIRST. Register the information required for that role. Route to the corresponding home using that registered information. Each role must see different information and input controls, not a shared mixed-role menu.

## Status and ownership
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

## Actual prototype test results
- Node reference-model tests: 44 PASS (20 previous verification + 24 role/quote/lifecycle).
- Browser scenarios: 18 PASS, including profile propagation, role route separation, pending-driver blocks, quote/acceptance round-trip, vehicle mismatch gate, profile edits and 360/390/430px overflow checks.
- Browser test used Chromium set_content rendering of the standalone HTML. No external requests or JS runtime errors during tested flows. This is NOT an Android-device/file-navigation/live-API/production-authentication test.
- Existing main/root application was not overwritten or deployed by this documentation update.
