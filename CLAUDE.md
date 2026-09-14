# Claude implementation brief

## Role split
- GDP / product design: ChatGPT defines product requirements, information architecture, UX priorities, and acceptance criteria.
- Claude: implement/refactor code to satisfy those requirements without changing the product intent.

## Current task
Improve the Taxi Protection mobile passenger flow.

### Must keep
1. The top of the passenger screen is a Google Maps route view, not a black explanatory hero card.
2. Show pickup and destination pins plus driving route.
3. Show trip duration and distance on top of the map.
4. Pickup can use device geolocation.
5. Destination supports Google Places autocomplete.
6. Nadi Airport Protection rule remains directly below the route controls.
7. Driver offers show fare, ETA, verified rating, verified ride count, fare-issue count, and verification state.
8. Selecting a taxi must lock the quoted fare for later Fare Protection comparison.
9. Mobile-first target width: 360–430px; no horizontal scroll.
10. Keep the product visually calmer and more trustworthy than a generic rideshare app.

## Google Maps requirements
Use Maps JavaScript API + Places + Directions for this prototype.
Do not commit unrestricted production API keys. Browser keys must be HTTP-referrer restricted in Google Cloud Console.

## Next implementation targets
- Replace static sample offers with API-backed offers.
- Add map markers for live drivers.
- Add selected driver approach route.
- Add passenger ride-state screen.
- Add camera evidence capture for taxi meter and receipt.
- Add fare discrepancy warning screen.
- Add English/Japanese language switch.

## Acceptance criteria
A visitor arriving at Nadi Airport should be able to open the web app, allow location access, search a hotel, see the route, compare verified taxi offers, select one, and understand the fare-protection rules without knowing Fiji taxi regulations.
