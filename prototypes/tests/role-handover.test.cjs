'use strict';
// Acceptance review of the supplied HTML, not production authorization tests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {OPERATIONS, CANCELLATION_REASONS, loadContract, validateContract} = require('../api-contract-check.cjs');
const {FIXTURE, AUDIT_FIELDS, scenarios: httpScenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract, runCancellationReasonContract, runRideSafetyContract, runBoardingRaceContract, runCurrentRideDiscoveryContract, runRecoveryRetryContract, runRevisionMergeContract, runNotificationHintContract, runSessionIsolationContract, runCommandSessionContract, runCommandRecoveryContract, runAuditContract, parseRetryAfterMs} = require('../http-contract-runner.cjs');
const source = fs.readFileSync(path.join(__dirname, '../role-split/index.html'), 'utf8');
const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x => x[1]);
let auditContract;
function auditedHttpResults() { return auditContract ||= runAuditContract(); }
let rideSafetyContract;
function rideSafetyResults() { return rideSafetyContract ||= runRideSafetyContract(); }
let boardingRaceContract;
function boardingRaceResults() { return boardingRaceContract ||= runBoardingRaceContract(); }
let currentRideDiscoveryContract;
function currentRideDiscoveryResults() { return currentRideDiscoveryContract ||= runCurrentRideDiscoveryContract(); }
let recoveryRetryContract;
function recoveryRetryResults() { return recoveryRetryContract ||= runRecoveryRetryContract(); }
let revisionMergeContract;
function revisionMergeResults() { return revisionMergeContract ||= runRevisionMergeContract(); }
let notificationHintContract;
function notificationHintResults() { return notificationHintContract ||= runNotificationHintContract(); }
let sessionIsolationContract;
function sessionIsolationResults() { return sessionIsolationContract ||= runSessionIsolationContract(); }
let commandSessionContract;
function commandSessionResults() { return commandSessionContract ||= runCommandSessionContract(); }
let commandRecoveryContract;
function commandRecoveryResults() { return commandRecoveryContract ||= runCommandRecoveryContract(); }
let cancellationReasonContract;
function cancellationReasonResults() { return cancellationReasonContract ||= runCancellationReasonContract(); }
function setup() {
  const sandbox = vm.createContext({});
  scripts.slice(0, 2).forEach(script => vm.runInContext(script, sandbox));
  return {m: sandbox.TaxiRoles.create(), V: sandbox.TaxiVerification, R: sandbox.TaxiRoles};
}
function passenger(m) {
  m.chooseRole('passenger');
  return m.registerPassenger({name:'Review Guest', phone:'+819000000000', language:'ja', payment:'card', pickup:'Demo Hotel', consent:true});
}
function application(V) {
  return {name:'Review Applicant', phone:'+6790000000', plate:'DEMO 005', holder:'Demo Holder', vehicle:'Demo Car', taxiPermit:'DEMO-TAXI', driverLicence:'DEMO-LIC', psvPermit:'DEMO-PSV', base:'Nadi demo', consent:true, documents:Object.fromEntries(V.REQUIRED.map(k => [k,{attachment:'DEMO-'+k+'.pdf', expiresAt:new Date(Date.now()+86400000).toISOString()}]))};
}
test('client-decoded Google claims remain input assistance until trusted server verification', () => {
  const {R,m}=setup();
  const clientOnly=R.googleIdentityConnectionView({
    credentialImported:true,googleLinked:true,serverVerified:true,sub:'10769150350006150715113082367',
    verification:{source:'client',signature:true,audience:true,issuer:true,notExpired:true}
  });
  assert.deepEqual({...clientOnly},{state:'input_assist',label:'Googleе…ҐеЉ›иЈњеЉ©пј€жњ¬дєєзўєиЄЌжњЄжЋҐз¶љпј‰',canAuthenticate:false,persistSubject:false});
  m.chooseRole('passenger');
  const p=m.registerPassenger({name:'Google Input Guest',phone:'+6790000000',language:'ja',payment:'card',pickup:'Demo Hotel',consent:true,googleLinked:true,googleSub:'10769150350006150715113082367'});
  assert.equal('googleLinked' in p,false);assert.equal('googleSub' in p,false);
  const verified=R.googleIdentityConnectionView({credentialImported:true,verification:{source:'authenticated_server',signature:true,audience:true,issuer:true,notExpired:true}});
  assert.deepEqual({...verified},{state:'verified',label:'Googleжњ¬дєєзўєиЄЌжё€гЃї',canAuthenticate:true,persistSubject:true});
});
test('Google input assistance registration snapshot strips unverified link and subject claims', () => {
  const {R}=setup();
  const snapshot=R.googleIdentityRegistrationSnapshot({
    credentialImported:true,googleLinked:true,googleSub:'10769150350006150715113082367',serverVerified:true,
    verification:{source:'client',signature:true,audience:true,issuer:true,notExpired:true}
  });
  assert.deepEqual({...snapshot},{
    googleInputAssisted:true,googleIdentityState:'unverified',
    label:'Googleе…ҐеЉ›иЈњеЉ©жё€гЃїпј€жњ¬дєєзўєиЄЌжњЄжЋҐз¶љпј‰',canAuthenticate:false,needsServerRefresh:false
  });
  assert.equal('googleLinked' in snapshot,false);assert.equal('googleSub' in snapshot,false);assert.equal('subject' in snapshot,false);
});
test('Google identity cannot be restored as verified or authenticating from client storage', () => {
  const {R}=setup();
  const tampered=JSON.stringify({
    googleInputAssisted:true,googleIdentityState:'verified',googleLinked:true,
    googleSub:'10769150350006150715113082367',subject:'10769150350006150715113082367',
    canAuthenticate:true,verification:{source:'authenticated_server',signature:true,audience:true,issuer:true,notExpired:true}
  });
  const restored=R.restoreGoogleIdentityRegistrationSnapshot(tampered);
  assert.deepEqual({...restored},{
    googleInputAssisted:true,googleIdentityState:'unverified',
    label:'Googleе…ҐеЉ›иЈњеЉ©жё€гЃїпј€жњ¬дєєзўєиЄЌжњЄжЋҐз¶љпј‰',canAuthenticate:false,needsServerRefresh:false
  });
  const corrupt=R.restoreGoogleIdentityRegistrationSnapshot('{bad json');
  assert.equal(corrupt.googleIdentityState,'unavailable');assert.equal(corrupt.canAuthenticate,false);
});
test('Google Maps reports connected only after API load and map idle, then fails closed', () => {
  const {R}=setup();
  assert.deepEqual({...R.googleMapsConnectionView({})},{state:'demo',label:'з•Ґењ°е›ігѓ»гѓ‡гѓўиЎЁз¤єпј€Google Maps жњЄжЋҐз¶љпј‰',live:false,action:'configure'});
  for(const input of [{configured:true},{configured:true,apiLoaded:true},{configured:true,mapIdle:true}]){
    const view=R.googleMapsConnectionView(input);assert.equal(view.state,'connecting');assert.equal(view.live,false);assert.doesNotMatch(view.label,/жЋҐз¶љжё€гЃї/);
  }
  const connected=R.googleMapsConnectionView({configured:true,apiLoaded:true,mapIdle:true});
  assert.equal(connected.state,'connected');assert.equal(connected.live,true);assert.match(connected.label,/жЋҐз¶љжё€гЃї/);
  for(const failure of [{configured:true,apiLoaded:true,mapIdle:true,authFailure:true},{configured:true,loadFailed:true}]){
    const view=R.googleMapsConnectionView(failure);assert.equal(view.state,'failed');assert.equal(view.live,false);assert.equal(view.action,'reload');assert.match(view.label,/гѓ‡гѓўиЎЁз¤є/);
  }
});
test('Google Maps geolocation cannot report connected before the active map reaches idle', () => {
  const {R}=setup(),maps=R.createGoogleMapsReadinessController();
  const first=maps.begin(true);
  assert.equal(first.state.state,'connecting');
  const located=maps.location(first.token);
  assert.equal(located.state.locationReady,true);assert.equal(located.state.live,false);assert.doesNotMatch(located.state.label,/жЋҐз¶љжё€гЃї/);
  const loaded=maps.apiReady(first.token);
  assert.equal(loaded.state.live,false);assert.doesNotMatch(loaded.state.label,/жЋҐз¶љжё€гЃї/);
  const idle=maps.idle(first.token);
  assert.equal(idle.state.live,true);assert.equal(idle.state.label,'Google Maps жЋҐз¶љжё€гЃїгѓ»зЏѕењЁењ°г‚’иЎЁз¤є');
});
test('Google Maps auth failure removes connected state and requires reload', () => {
  const {R}=setup(),maps=R.createGoogleMapsReadinessController();
  const first=maps.begin(true);
  maps.apiReady(first.token);maps.location(first.token);maps.idle(first.token);
  assert.equal(maps.snapshot().state,'connected');
  const failed=maps.fail(first.token);
  assert.equal(failed.state.state,'failed');assert.equal(failed.state.live,false);assert.equal(failed.state.locationReady,false);
  const retry=maps.begin(true);assert.equal(retry.accepted,false);assert.equal(retry.reason,'reload_required');
  assert.equal(maps.idle(first.token).accepted,false);
  assert.equal(maps.location(first.token).accepted,false);
  assert.equal(maps.snapshot().generation,retry.token);assert.equal(maps.snapshot().state,'failed');assert.equal(maps.snapshot().reloadRequired,true);
});
test('Google Maps failure returns destination entry to the manual fallback', () => {
  assert.match(source,/function mapFail\(text\)\{\s*placeSelection\.cancel\(\);state\.routeSeq\+\+;clearLines\(\);/);
  assert.match(source,/state\.mapReady=false;state\.loadingMap=false;state\.map=null;state\.routeLib=null;state\.mapConnectionToken=null;state\.mapScript\?\.remove\(\);state\.mapScript=null;state\.destination=\$\('destination'\)\.value\.trim\(\);pickupInput\.mapFailure\(\);/);
  assert.match(source,/\$\('google-search'\)\.replaceChildren\(\);\$\('google-search'\)\.hidden=true;\$\('offline-search'\)\.hidden=false;/);
  assert.match(source,/\$\('live-summary'\)\.hidden=true;\$\('route-status'\)\.textContent='ењ°е›іжњЄжЋҐз¶љгЂ‚з›®зљ„ењ°гЃЇж‰‹е…ҐеЉ›гЃ§гЃЌгЃѕгЃ™гЂ‚';/);
});
test('Google Maps failure makes a pending place callback stale before fallback input resumes', () => {
  const {R}=setup(),selection=R.createGooglePlaceSelectionController(),pending=selection.begin();
  selection.cancel();
  assert.equal(selection.canApply(pending.token),false);
  assert.equal(selection.apply(pending.token).reason,'stale_place');
  assert.equal(selection.fail(pending.token).reason,'stale_place');
});
test('live Google Maps connection uses a generation-specific callback and waits for idle', () => {
  assert.match(source,/const connection=mapsReadiness\.begin\(true\);if\(!connection\.accepted\)return[\s\S]*?const callbackName='taxiInitMap'\+connection\.token;let init,timer;/);
  assert.match(source,/state\.mapConnectionToken=connection\.token;state\.loadingMap=true;[\s\S]*?mapsReadiness\.apiReady\(connection\.token\)/);
  assert.match(source,/google\.maps\.event\.addListenerOnce\(state\.map,'idle',[\s\S]*?mapsReadiness\.idle\(connection\.token\);if\(!current\(\)\|\|!idle\.accepted\|\|idle\.state\.state!=='connected'\)return;/);
  assert.match(source,/callback='\+encodeURIComponent\(callbackName\)/);
  assert.doesNotMatch(source,/callback=taxiInitMap(?:['&])/);
});
test('an old Maps callback cannot create a same-page retry generation', () => {
  const {R}=setup(),maps=R.createGoogleMapsReadinessController();
  const old=maps.begin(true);maps.fail(old.token);const retry=maps.begin(true);
  assert.equal(retry.accepted,false);assert.equal(retry.token,old.token);assert.equal(maps.snapshot().reloadRequired,true);
  assert.equal(maps.apiReady(old.token).state.state,'failed');assert.equal(maps.idle(old.token).state.state,'failed');
});
test('live Maps failure removes the injected script and disables unsafe reconnect', () => {
  assert.match(source,/state\.mapScript\?\.remove\(\);state\.mapScript=null;[\s\S]*?\$\('connect-maps'\)\.disabled=true;/);
  assert.match(source,/е®‰е…ЁгЃЄе†ЌжЋҐз¶љгЃ«гЃЇгѓљгѓјг‚ёг‚’е†ЌиЄ­гЃїиѕјгЃїгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„/);
  assert.match(source,/script\.onerror=fail;state\.mapScript=script;document\.head\.appendChild\(script\);/);
});
test('Google place selection uses a stable address and rejects missing coordinates', () => {
  const {R}=setup();
  const selected=R.googlePlaceDestination({displayName:'Airport',formattedAddress:'Nadi International Airport, Fiji',location:{lat:()=>-17.755,lng:()=>177.443}});
  assert.deepEqual({...selected},{label:'Nadi International Airport, Fiji',route:selected.route});
  assert.deepEqual({...selected.route},{lat:-17.755,lng:177.443});
  assert.equal(R.googlePlaceDestination({displayName:'No location'}),null);
  assert.equal(R.googlePlaceDestination({location:{lat:NaN,lng:177.443}}),null);
});
test('Google place selection invalidates old quotes before replacing the route destination', () => {
  assert.match(source,/if\(!placeSelection\.canApply\(selection\.token\)\)return;const selected=R\.googlePlaceDestination\(p\);if\(!selected\)\{placeSelection\.apply\(selection\.token\);return;\}if\(!invalidateCurrentSearch\(\{destination:selected\.label\}\)\)\{placeSelection\.apply\(selection\.token\);return;\}if\(!placeSelection\.apply\(selection\.token\)\.accepted\)return;\s*state\.destination=selected\.route;\$\('destination'\)\.value=selected\.label;/);
  const {R,m}=setup();passenger(m);
  const ride=m.requestRide({pickup:'Demo Hotel',destination:'Nadi Town'}),offer=m.getOffers(ride.id)[0];
  const selected=R.googlePlaceDestination({displayName:'Airport',formattedAddress:'Nadi International Airport, Fiji',location:{lat:-17.755,lng:177.443}});
  assert.equal(m.invalidateRideSearch(ride.id,{destination:selected.label}).invalidated,true);
  assert.equal(ride.status,'cancelled');assert.equal(offer.status,'expired');assert.throws(()=>m.selectOffer(offer.id));
});
test('a newer Google place selection rejects the delayed older result', () => {
  const {R}=setup(),selection=R.createGooglePlaceSelectionController();
  const old=selection.begin(),current=selection.begin();
  assert.equal(selection.canApply(old.token),false);assert.equal(selection.apply(old.token).reason,'stale_place');
  assert.equal(selection.canApply(current.token),true);assert.equal(selection.apply(current.token).accepted,true);
  assert.deepEqual({...selection.snapshot()},{generation:current.token,pending:false});
});
test('manual destination and ride submission cancel a pending Google place result', () => {
  assert.match(source,/\$\('destination'\)\.addEventListener\('input', \(\) => \{ placeSelection\.cancel\(\);/);
  assert.match(source,/\$\('find-offers'\)\.onclick = \(\) => \{\s*try \{\s*placeSelection\.cancel\(\);/);
  assert.match(source,/if\(!placeSelection\.canApply\(selection\.token\)\)return;const selected=R\.googlePlaceDestination\(p\);/);
  const {R}=setup(),selection=R.createGooglePlaceSelectionController(),pending=selection.begin();
  selection.cancel();assert.equal(selection.canApply(pending.token),false);assert.equal(selection.apply(pending.token).accepted,false);
});
test('a delayed Google place failure stays silent after a newer selection', () => {
  const {R}=setup(),selection=R.createGooglePlaceSelectionController();
  const old=selection.begin(),current=selection.begin();
  assert.equal(selection.fail(old.token).accepted,false);
  assert.equal(selection.canApply(current.token),true);
  assert.equal(selection.apply(current.token).accepted,true);
});
test('only the current Google place failure closes the pending selection and shows guidance', () => {
  assert.match(source,/catch\{if\(placeSelection\.fail\(selection\.token\)\.accepted\)toast\('з›®зљ„ењ°г‚’еЏ–еѕ—гЃ§гЃЌгЃѕгЃ›г‚“гЂ‚е†ЌйЃёжЉћгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚'\);\}/);
  const {R}=setup(),selection=R.createGooglePlaceSelectionController(),current=selection.begin();
  const failed=selection.fail(current.token);
  assert.equal(failed.accepted,true);assert.equal(failed.reason,'place_failed');
  assert.deepEqual({...selection.snapshot()},{generation:current.token,pending:false});
  assert.equal(selection.fail(current.token).accepted,false);
});
test('manual pickup survives map and geolocation failure and can still create a request', () => {
  const {R,m}=setup(),pickup=R.createPickupInputController('Ramada Wailoaloa');
  const locating=pickup.beginLocation();
  const failed=pickup.locationFailure(locating.token);
  assert.equal(failed.state.value,'Ramada Wailoaloa');assert.equal(failed.state.source,'manual');assert.equal(failed.state.canRequest,true);assert.match(failed.state.message,/ж‰‹е…ҐеЉ›гЃ—гЃџд№—и»Љењ°з‚№/);
  const mapFailed=pickup.mapFailure();
  assert.equal(mapFailed.value,'Ramada Wailoaloa');assert.equal(mapFailed.canRequest,true);assert.match(mapFailed.message,/ж‰‹е…ҐеЉ›гЃ—гЃџд№—и»Љењ°з‚№/);
  passenger(m);
  const ride=m.requestRide({pickup:mapFailed.value,destination:'Nadi Airport'});
  assert.equal(ride.pickup,'Ramada Wailoaloa');assert.equal(ride.destination,'Nadi Airport');
});
test('late geolocation result cannot overwrite a newer manual pickup', () => {
  const {R}=setup(),pickup=R.createPickupInputController('Nadi Town');
  const old=pickup.beginLocation();
  pickup.setManual('Radisson Blu Denarau');
  const stale=pickup.locationSuccess(old.token,'зЏѕењЁењ°');
  assert.equal(stale.accepted,false);assert.equal(stale.reason,'stale_location');assert.equal(stale.state.value,'Radisson Blu Denarau');assert.equal(stale.state.source,'manual');
  assert.equal(pickup.canApplyLocation(old.token).accepted,false);
  const fresh=pickup.beginLocation();
  const applied=pickup.locationSuccess(fresh.token,'зЏѕењЁењ°');
  assert.equal(applied.accepted,true);assert.equal(applied.state.value,'зЏѕењЁењ°');assert.equal(applied.state.source,'geolocation');
});
test('passenger registration synchronizes its default pickup into the first ride request', () => {
  assert.match(source,/const validated=R\.passengerRegistrationInput\(input\),pickup=validated\.pickup;\s*if\(!invalidateCurrentSearch\(\{pickup,airport:false\}\)\)return;\s*const p=model\.registerPassenger\(validated\);state\.pickup=p\.pickup\|\|'';/);
  const {R,m}=setup(),pickup=R.createPickupInputController('Nadi, Fiji');
  m.chooseRole('passenger');
  const profile=m.registerPassenger({name:'Hotel Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'Ramada Suites Wailoaloa',consent:true});
  pickup.setManual(profile.pickup||'Nadi, Fiji');
  const ride=m.requestRide({pickup:pickup.snapshot().value,destination:'Nadi Airport'});
  assert.equal(ride.pickup,'Ramada Suites Wailoaloa');assert.notEqual(ride.pickup,'Nadi, Fiji');
});
test('profile pickup change wins over a location request started before re-registration', () => {
  const {R,m}=setup(),pickup=R.createPickupInputController('Nadi, Fiji');
  m.chooseRole('passenger');
  m.registerPassenger({name:'Hotel Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'Ramada Suites Wailoaloa',consent:true});
  const oldLocation=pickup.beginLocation();
  const updated=m.registerPassenger({name:'Hotel Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'Radisson Blu Denarau',consent:true});
  pickup.setManual(updated.pickup||'Nadi, Fiji');
  const stale=pickup.locationSuccess(oldLocation.token,'зЏѕењЁењ°');
  assert.equal(stale.accepted,false);assert.equal(stale.state.value,'Radisson Blu Denarau');
  const ride=m.requestRide({pickup:pickup.snapshot().value,destination:'Nadi Airport'});
  assert.equal(ride.pickup,'Radisson Blu Denarau');
});
test('profile pickup update invalidates the old search and clears its airport scope', () => {
  assert.match(source,/const validated=R\.passengerRegistrationInput\(input\),pickup=validated\.pickup;\s*if\(!invalidateCurrentSearch\(\{pickup,airport:false\}\)\)return;\s*const p=model\.registerPassenger\(validated\)/);
  assert.match(source,/pickupInput\.setManual\(state\.pickup\);state\.airport=false;\$\('airport-pickup'\)\.checked=false;\$\('airport-check'\)\.checked=false;/);
  const {R,m}=setup(),pickup=R.createPickupInputController('Nadi Airport');
  m.chooseRole('passenger');m.registerPassenger({name:'Airport Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'Nadi Airport',consent:true});
  const ride=m.requestRide({pickup:'Nadi Airport',destination:'Denarau',airport:true}),offer=m.getOffers(ride.id)[0];
  const change=m.invalidateRideSearch(ride.id,{pickup:'Radisson Blu Denarau',airport:false});
  assert.equal(change.invalidated,true);assert.equal(ride.status,'cancelled');assert.throws(()=>m.selectOffer(offer.id));
  const profile=m.registerPassenger({name:'Airport Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'Radisson Blu Denarau',consent:true});pickup.setManual(profile.pickup);
  assert.equal(pickup.snapshot().value,'Radisson Blu Denarau');assert.equal(R.pickupAirportScope({source:'manual',confirmedAirport:false}),false);
});
test('invalid passenger profile input leaves the active request and offers untouched', () => {
  const {R,m}=setup();passenger(m);
  const oldPickup=m.state.profile.pickup,ride=m.requestRide({pickup:oldPickup,destination:'Nadi Airport'}),offer=m.getOffers(ride.id)[0];
  assert.throws(()=>R.passengerRegistrationInput({name:'Review Guest',phone:'+819000000000',email:'invalid-email',language:'ja',payment:'card',pickup:'New Hotel',consent:true}),/гѓЎгѓјгѓ«г‚ўгѓ‰гѓ¬г‚№/);
  assert.equal(ride.status,'collecting');assert.equal(offer.status,'active');assert.equal(m.state.profile.pickup,oldPickup);
});
test('validated passenger profile input invalidates old quotes before profile replacement', () => {
  const {R,m}=setup();passenger(m);
  const ride=m.requestRide({pickup:m.state.profile.pickup,destination:'Nadi Airport'}),offer=m.getOffers(ride.id)[0];
  const values=R.passengerRegistrationInput({name:'  Review Guest  ',phone:' +6790000000 ',email:'guest@example.com',language:'en',payment:'cash',pickup:' New Hotel ',consent:true});
  assert.equal(values.pickup,'New Hotel');assert.equal(values.phone,'+6790000000');
  assert.equal(m.invalidateRideSearch(ride.id,{pickup:values.pickup,airport:false}).invalidated,true);
  const updated=m.registerPassenger(values);
  assert.equal(ride.status,'cancelled');assert.equal(offer.status,'expired');assert.equal(updated.pickup,'New Hotel');
});
test('assigned ride blocks profile pickup replacement before the profile is mutated', () => {
  const {m}=setup();passenger(m);
  const original=m.state.profile.pickup,ride=m.requestRide({pickup:original,destination:'Demo Beach'}),offer=m.getOffers(ride.id)[0];m.selectOffer(offer.id);
  assert.throws(()=>m.invalidateRideSearch(ride.id,{pickup:'New Hotel',airport:false}),/йЃёжЉћжё€гЃїгѓ»д№—и»Љдё­/);
  assert.equal(m.state.profile.pickup,original);assert.equal(ride.pickup,original);assert.equal(ride.status,'assigned');
});
test('blank registered pickup remains unset and blocks a ride until explicit input', () => {
  assert.match(source,/\$\('pickup-label'\)\.textContent=state\.pickup\?state\.pickup\+' В· гѓ‡гѓў':'д№—и»Љењ°з‚№г‚’иЁ­е®љ';/);
  const {R,m}=setup(),pickup=R.createPickupInputController('Nadi, Fiji');
  m.chooseRole('passenger');
  const profile=m.registerPassenger({name:'No Pickup Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'   ',consent:true});
  pickup.setManual(profile.pickup||'');
  assert.equal(pickup.snapshot().value,'');assert.equal(pickup.snapshot().source,'empty');assert.equal(pickup.snapshot().canRequest,false);
  assert.throws(()=>m.requestRide({pickup:pickup.snapshot().value,destination:'Nadi Airport'}),/д№—и»Љењ°з‚№гЃЁз›®зљ„ењ°/);
  assert.equal(m.myRequests().length,0);
});
test('clearing profile pickup discards an old value and rejects delayed geolocation', () => {
  const {R,m}=setup(),pickup=R.createPickupInputController('Ramada Suites Wailoaloa');
  m.chooseRole('passenger');
  m.registerPassenger({name:'Hotel Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'Ramada Suites Wailoaloa',consent:true});
  const oldLocation=pickup.beginLocation();
  const updated=m.registerPassenger({name:'Hotel Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'',consent:true});
  pickup.setManual(updated.pickup||'');
  const stale=pickup.locationSuccess(oldLocation.token,'зЏѕењЁењ°');
  assert.equal(stale.accepted,false);assert.equal(stale.state.value,'');assert.equal(stale.state.canRequest,false);
  assert.throws(()=>m.requestRide({pickup:pickup.snapshot().value,destination:'Nadi Airport'}),/д№—и»Љењ°з‚№гЃЁз›®зљ„ењ°/);
  assert.equal(m.myRequests().length,0);
});
test('pickup request view distinguishes missing, locating and ready states', () => {
  const {R}=setup();
  assert.deepEqual({...R.pickupRequestView({value:'',pending:false})},{ready:false,value:'',action:'edit_pickup',message:'д№—и»Љењ°з‚№г‚’е…ҐеЉ›гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚'});
  assert.deepEqual({...R.pickupRequestView({value:'Ramada Suites Wailoaloa',pending:true})},{ready:false,value:'Ramada Suites Wailoaloa',action:'wait_or_edit',message:'зЏѕењЁењ°г‚’зўєиЄЌдё­гЃ§гЃ™гЂ‚е®Њдє†г‚’еѕ…гЃ¤гЃ‹гЂЃд№—и»Љењ°з‚№г‚’ж‰‹е…ҐеЉ›гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚'});
  assert.deepEqual({...R.pickupRequestView({value:'Ramada Suites Wailoaloa',pending:false})},{ready:true,value:'Ramada Suites Wailoaloa',action:null,message:''});
});
test('missing pickup opens manual recovery and explicit input enables the request', () => {
  assert.match(source,/if\(!pickupView\.ready\)\{if\(pickupView\.action==='edit_pickup'\)showPickupFallback\(pickupView\.message\);else toast\(pickupView\.message\);return;\}/);
  assert.match(source,/if\(!pickupInput\.snapshot\(\)\.canRequest\)openPickupEditor\(\);/);
  const {R,m}=setup(),pickup=R.createPickupInputController('');
  m.chooseRole('passenger');m.registerPassenger({name:'No Pickup Guest',phone:'+6790000000',language:'en',payment:'cash',pickup:'',consent:true});
  assert.equal(R.pickupRequestView(pickup.snapshot()).action,'edit_pickup');
  pickup.setManual('Ramada Suites Wailoaloa');
  const ready=R.pickupRequestView(pickup.snapshot());
  assert.equal(ready.ready,true);
  const ride=m.requestRide({pickup:ready.value,destination:'Nadi Airport'});
  assert.equal(ride.pickup,'Ramada Suites Wailoaloa');
});
test('airport pickup requires an explicit manual confirmation', () => {
  const {R}=setup();
  assert.equal(R.pickupAirportScope({source:'manual',confirmedAirport:true}),true);
  for(const input of [
    {source:'manual',confirmedAirport:false},
    {source:'geolocation',confirmedAirport:true},
    {source:'empty',confirmedAirport:true},
    {source:'manual',confirmedAirport:'true'}
  ])assert.equal(R.pickupAirportScope(input),false);
});
test('switching an airport pickup to current location clears airport dispatch scope', () => {
  assert.match(source,/const airport=R\.pickupAirportScope\(\{source:'geolocation',confirmedAirport:state\.airport\}\);if\(!invalidateCurrentSearch\(\{pickup:'зЏѕењЁењ°',airport\}\)\)/);
  assert.match(source,/state\.airport=airport;\$\('airport-pickup'\)\.checked=false;\$\('airport-check'\)\.checked=false;/);
  const {R,m}=setup(),pickup=R.createPickupInputController('Nadi Airport');
  passenger(m);pickup.setManual('Nadi Airport');
  let airport=R.pickupAirportScope({source:'manual',confirmedAirport:true});
  const first=m.requestRide({pickup:pickup.snapshot().value,destination:'Denarau',airport});
  assert.equal(first.airport,true);
  const locating=pickup.beginLocation(),located=pickup.locationSuccess(locating.token,'зЏѕењЁењ°');
  assert.equal(located.accepted,true);
  airport=R.pickupAirportScope({source:located.state.source,confirmedAirport:airport});
  const second=m.requestRide({pickup:located.state.value,destination:'Denarau',airport});
  assert.equal(second.airport,false);assert.equal(first.status,'cancelled');assert.equal(second.status,'collecting');
});
test('pickup editor restores only the active manual pickup and its airport confirmation', () => {
  const {R}=setup();
  assert.deepEqual({...R.pickupEditorView({source:'manual',value:'Nadi Airport',airport:true})},{value:'Nadi Airport',airport:true,placeholder:'дѕ‹пјљгѓ›гѓ†гѓ«еђЌгѓ»ж–ЅиЁ­еђЌ'});
  assert.deepEqual({...R.pickupEditorView({source:'geolocation',value:'зЏѕењЁењ°',airport:true})},{value:'',airport:false,placeholder:'зЏѕењЁењ°г‚’дЅїз”Ёдё­гЃ§гЃ™гЂ‚ж–ЅиЁ­еђЌгЃёе¤‰ж›ґгЃ™г‚‹е ґеђ€гЃЇе…ҐеЉ›гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚'});
  assert.deepEqual({...R.pickupEditorView({source:'empty',value:'Old Hotel',airport:true})},{value:'',airport:false,placeholder:'дѕ‹пјљгѓ›гѓ†гѓ«еђЌгѓ»ж–ЅиЁ­еђЌ'});
  assert.match(source,/\$\('pickup-open'\)\.onclick = openPickupEditor;/);
  assert.match(source,/const editor=R\.pickupEditorView\(\{\.\.\.pickupInput\.snapshot\(\),airport:state\.airport\}\);/);
});
test('opening the editor after current location cannot revive an old airport pickup', () => {
  const {R,m}=setup(),pickup=R.createPickupInputController('Nadi Airport');
  passenger(m);pickup.setManual('Nadi Airport');
  let airport=R.pickupAirportScope({source:'manual',confirmedAirport:true});
  const locating=pickup.beginLocation(),located=pickup.locationSuccess(locating.token,'зЏѕењЁењ°');
  airport=R.pickupAirportScope({source:located.state.source,confirmedAirport:airport});
  const editor=R.pickupEditorView({...located.state,airport});
  assert.equal(editor.value,'');assert.equal(editor.airport,false);
  assert.throws(()=>m.requestRide({pickup:editor.value,destination:'Denarau',airport:editor.airport}),/д№—и»Љењ°з‚№гЃЁз›®зљ„ењ°/);
  pickup.setManual('Radisson Blu Denarau');
  const ride=m.requestRide({pickup:pickup.snapshot().value,destination:'Denarau',airport:editor.airport});
  assert.equal(ride.pickup,'Radisson Blu Denarau');assert.equal(ride.airport,false);
});
function selected() {
  const s=setup(), {m}=s;
  passenger(m);
  const ride=m.requestRide({pickup:'Demo Hotel', destination:'Demo Beach'});
  m.useReviewedFixture(); m.setOnline(true);
  const offer=m.submitOffer(ride.id,{fare:'23.50',eta:'7'});
  m.chooseRole('passenger'); m.selectOffer(offer.id);
  return {...s,ride,offer};
}
// Run the actual registration DOM handlers with deterministic form controls.
// This checks submit routing, not native browser keyboard/constraint behavior.
function registrationWizard() {
  const {m,V}=setup();m.chooseRole('driver');
  const nodes={},fields={},reports=[],pages=[],messages=[];
  const stepFields=[['name','phone','driverLicence','psvPermit'],['plate','vehicle','taxiPermit','holder','base'],[]];
  const $=id=>nodes[id] ||= {hidden:false};
  stepFields.forEach((keys,step)=>{
    const html=source.split(`<div id="reg-step-${step}"`)[1].split('</div>')[0];
    keys.forEach(key=>{
      assert.match(html,new RegExp(`name="${key}"[^>]*required`));
      fields[key]={value:'',checkValidity(){return !!this.value.trim();},reportValidity(){
        assert.equal($('reg-step-'+step).hidden,false,'invalid field must be visible');
        reports.push(key);return this.checkValidity();
      }};
    });
    $('reg-step-'+step).querySelectorAll=()=>keys.map(key=>fields[key]);
  });
  fields.consent={checked:false};
  $('register-airport').checked=false;
  $('registration-form').elements=fields;
  $('progress').children=stepFields.map(()=>({classList:{toggle(){}}}));
  const state={regStep:0,documents:{}};
  let attempts=0;
  const sandbox=vm.createContext({$,state,V,names:{},esc:String,
    document:{querySelectorAll:()=>[],querySelector:()=>null},
    model:{state:m.state,registerDriver(input){attempts++;return m.registerDriver(input);}},
    records:m.state.records,show:page=>pages.push(page),toast:message=>messages.push(message),
    FormData:class {constructor(form){this.form=form;}entries(){return Object.entries(this.form.elements).filter(([k])=>k!=='consent').map(([k,field])=>[k,field.value]);}}
  });
  vm.runInContext(source.slice(source.indexOf('function currentTypes()'),source.indexOf('// Optional live map.')),sandbox);
  sandbox.setStep(0);
  return {m,V,$,fields,state,reports,pages,messages,attempts:()=>attempts,
    issues:now=>JSON.parse(JSON.stringify(sandbox.registrationDocumentIssues(now))),
    updateFeedback:key=>sandbox.updateDocumentFeedback(key),
    submit(){let prevented=false;$('registration-form').onsubmit({currentTarget:$('registration-form'),preventDefault(){prevented=true;}});assert.equal(prevented,true);}};
}
test('registration wizard submit advances each step before creating a pending driver', () => {
  const w=registrationWizard();w.$('fill-sample').onclick();
  for(const step of [1,2]){
    w.submit();assert.equal(w.state.regStep,step);assert.equal(w.attempts(),0);
    assert.equal(w.m.state.profiles.driver,null);assert.deepEqual(w.pages,[]);
  }
  assert.equal(w.$('reg-submit').hidden,false);
  w.submit();assert.equal(w.attempts(),1);assert.deepEqual(w.pages,['driver-home']);
  assert.equal(w.m.state.profile.status,'submitted');assert.equal(w.m.gate().eligible,false);
  assert.throws(()=>w.m.setOnline(true));assert.equal(w.m.driverRequests().length,0);
  assert.throws(()=>w.m.submitOffer('sample-city',{fare:'20',eta:'5'}));
});
test('registration wizard next and submit both stop on missing current-step fields', () => {
  for(const action of ['next','submit']){
    const w=registrationWizard();w.$('fill-sample').onclick();
    w.fields.phone.value='';
    const advance=()=>action==='next'?w.$('reg-next').onclick():w.submit();
    advance();assert.equal(w.state.regStep,0);assert.equal(w.reports.at(-1),'phone');
    w.fields.phone.value='+6790000000';advance();assert.equal(w.state.regStep,1);
    w.fields.plate.value='';advance();assert.equal(w.state.regStep,1);
    assert.equal(w.reports.at(-1),'plate');assert.equal(w.attempts(),0);assert.deepEqual(w.pages,[]);
  }
});
test('registration wizard final submit reveals invalid earlier fields without losing input', () => {
  for(const [key,step] of [['name',0],['vehicle',1]]){
    const w=registrationWizard();w.$('fill-sample').onclick();
    w.$('reg-next').onclick();w.$('reg-next').onclick();
    const documents=JSON.stringify(w.state.documents),phone=w.fields.phone.value;
    w.fields[key].value='';w.submit();
    assert.equal(w.state.regStep,step);assert.equal(w.$('reg-step-'+step).hidden,false);
    assert.equal(w.reports.at(-1),key);assert.equal(w.attempts(),0);assert.deepEqual(w.pages,[]);
    assert.equal(w.fields.phone.value,phone);assert.equal(JSON.stringify(w.state.documents),documents);
  }
});
test('registration wizard keeps final document and consent rejection on the review step', () => {
  for(const invalid of ['documents','consent']){
    const w=registrationWizard();w.$('fill-sample').onclick();
    w.$('reg-next').onclick();w.$('reg-next').onclick();
    if(invalid==='documents')w.state.documents={};else w.fields.consent.checked=false;
    w.submit();assert.equal(w.attempts(),invalid==='documents'?0:1);assert.equal(w.state.regStep,2);
    assert.equal(w.$('registration-error').hidden,false);assert.deepEqual(w.pages,[]);
    assert.equal(w.m.state.profiles.driver,null);
  }
});
test('registration wizard names missing, invalid and expired document evidence per item', () => {
  const w=registrationWizard(),now=Date.parse('2030-01-10T00:00:00Z');
  w.$('register-airport').checked=true;
  w.state.documents=Object.fromEntries([...w.V.REQUIRED,'airport_authorization'].map(k=>[k,{attachment:'DEMO-'+k+'.pdf',expiresAt:'2031-01-10T00:00:00+12:00'}]));
  w.state.documents.taxi_permit.attachment='';
  w.state.documents.vehicle_licence.expiresAt='not-a-date';
  w.state.documents.driver_licence.expiresAt='2029-01-10T00:00:00+12:00';
  w.state.documents.psv_driver_permit.expiresAt='';
  const issues=w.issues(now);
  assert.deepEqual(issues.taxi_permit,['гѓ‡гѓўж›ёйЎћг‚’ж·»д»гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚']);
  assert.deepEqual(issues.vehicle_licence,['жњ‰еЉ№жњџй™ђг‚’зўєиЄЌгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚']);
  assert.deepEqual(issues.driver_licence,['жњ‰еЉ№жњџй™ђгЃЊе€‡г‚ЊгЃ¦гЃ„гЃѕгЃ™гЂ‚е°†жќҐгЃ®ж—Ґд»г‚’е…ҐеЉ›гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚']);
  assert.deepEqual(issues.psv_driver_permit,['жњ‰еЉ№жњџй™ђг‚’е…ҐеЉ›гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚']);
  assert.deepEqual(issues.fitness,[]);assert.deepEqual(issues.airport_authorization,[]);
});
test('registration wizard shows document-level alerts and accepts a corrected retry', () => {
  const w=registrationWizard();w.$('fill-sample').onclick();
  w.$('reg-next').onclick();w.$('reg-next').onclick();
  delete w.state.documents.taxi_permit.attachment;
  w.state.documents.vehicle_licence.expiresAt='2020-01-01T00:00:00+12:00';
  w.submit();
  assert.equal(w.attempts(),0);assert.equal(w.$('registration-error').hidden,false);
  assert.match(w.$('registration-error').textContent,/2д»¶гЃ®ж›ёйЎћ/);
  assert.match(w.$('doc-fields').innerHTML,/id="doc-error-taxi_permit"[^>]*data-doc-error role="alert"/);
  assert.match(w.$('doc-fields').innerHTML,/гѓ‡гѓўж›ёйЎћг‚’ж·»д»гЃ—гЃ¦гЃЏгЃ гЃ•гЃ„/);
  assert.match(w.$('doc-fields').innerHTML,/жњ‰еЉ№жњџй™ђгЃЊе€‡г‚ЊгЃ¦гЃ„гЃѕгЃ™/);
  w.state.documents.taxi_permit.attachment='DEMO-taxi_permit.pdf';w.updateFeedback('taxi_permit');
  assert.match(w.$('registration-error').textContent,/1д»¶гЃ®ж›ёйЎћ/);
  w.state.documents.vehicle_licence.expiresAt=new Date(Date.now()+86400000).toISOString();w.updateFeedback('vehicle_licence');
  assert.equal(w.$('registration-error').hidden,true);
  w.$('fill-sample').onclick();w.submit();
  assert.equal(w.attempts(),1);assert.deepEqual(w.pages,['driver-home']);
  assert.equal(w.m.state.profile.status,'submitted');assert.equal(w.m.gate().eligible,false);
});
test('role routing keeps passenger and driver controls separate', () => {
  const {R}=setup();
  assert.equal(R.route(null,null,'driver-home'),'role');
  assert.equal(R.route('passenger',null,'home'),'passenger-register');
  assert.equal(R.route('driver',null,'driver-home'),'register');
  assert.equal(R.route('passenger',{},'driver-home'),'home');
  assert.equal(R.route('driver',{},'offers'),'driver-home');
});
test('command feedback uses separate passenger and driver wording', () => {
  const {R}=setup();
  const passenger=R.commandFeedback('passenger','pending');
  const driver=R.commandFeedback('driver','pending');
  assert.match(passenger.title,/дѕќй ј/);
  assert.match(driver.title,/йЃ‹иЎЊ/);
  assert.notEqual(passenger.title,driver.title);
  assert.equal(passenger.disableCommands,true);
  assert.equal(driver.disableCommands,true);
});
test('a pending command rejects duplicate button activation', () => {
  const {R}=setup(),ui=R.createCommandUiController('passenger');
  const first=ui.begin('passenger'),duplicate=ui.begin('passenger');
  assert.equal(first.accepted,true);
  assert.equal(duplicate.accepted,false);
  assert.equal(duplicate.state.outcome,'pending');
  assert.equal(duplicate.state.disableCommands,true);
});
test('confirmed command feedback unlocks state-changing controls', () => {
  const {R}=setup(),ui=R.createCommandUiController('driver');
  ui.begin('driver');const confirmed=ui.finish('confirmed');
  assert.equal(confirmed.role,'driver');
  assert.equal(confirmed.outcome,'confirmed');
  assert.equal(confirmed.disableCommands,false);
  assert.equal(confirmed.action,null);
});
test('an unresolved command stays locked until explicit latest-state acknowledgement', () => {
  const {R}=setup(),ui=R.createCommandUiController('passenger');
  ui.begin('passenger');const unresolved=ui.finish('unresolved');
  assert.equal(unresolved.disableCommands,true);
  assert.equal(unresolved.action,'refresh');
  assert.equal(ui.begin('passenger').accepted,false);
  assert.equal(ui.clear().outcome,'idle');
  assert.equal(ui.begin('passenger').accepted,true);
});
test('session expiry presents reauthentication instead of another command attempt', () => {
  const {R}=setup(),ui=R.createCommandUiController('driver');
  ui.begin('driver');const expired=ui.finish('reauth');
  assert.equal(expired.disableCommands,true);
  assert.equal(expired.action,'reauth');
  assert.match(expired.title,/е†Ќгѓ­г‚°г‚¤гѓі/);
  assert.equal(ui.begin('driver').accepted,false);
});
test('role switching clears old command feedback before showing the other role', () => {
  const {R}=setup(),ui=R.createCommandUiController('passenger');
  ui.begin('passenger');ui.finish('unresolved');
  const switched=ui.setRole('driver');
  assert.equal(switched.role,'driver');
  assert.equal(switched.outcome,'idle');
  assert.equal(switched.disableCommands,false);
});
function memoryStorage(seed={}) {
  const values=new Map(Object.entries(seed));
  return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),value:key=>values.get(key)};
}
test('restart guard persists only a minimal allowlisted marker', () => {
  const {R}=setup(),storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});
  assert.equal(guard.mark('passenger','pending'),true);
  const marker=JSON.parse(storage.value(guard.key));
  assert.deepEqual(Object.keys(marker).sort(),['outcome','role','savedAt','version']);
  assert.deepEqual(marker,{version:1,role:'passenger',outcome:'pending',savedAt:1000});
  for(const forbidden of ['command','action','rideId','accountId','token','idempotencyKey'])assert.equal(forbidden in marker,false);
});
test('restart guard converts an interrupted command into locked reconciliation without replay', () => {
  const {R}=setup(),storage=memoryStorage(),writer=R.createCommandRestartGuard(storage,{now:()=>1000});
  writer.mark('driver','pending');
  const restored=R.createCommandRestartGuard(storage,{now:()=>1500}).restore();
  assert.equal(restored.role,'driver');
  assert.equal(restored.outcome,'unresolved');
  assert.equal(restored.resumedFrom,'pending');
  assert.equal(restored.autoResend,false);
  assert.equal(restored.feedback.disableCommands,true);
  assert.match(restored.feedback.title,/зўєиЄЌгЃ§гЃЌгЃѕгЃ›г‚“/);
});
test('restart guard discards an expired marker', () => {
  const {R}=setup(),storage=memoryStorage(),writer=R.createCommandRestartGuard(storage,{now:()=>1000,maxAgeMs:500});
  writer.mark('passenger','unresolved');
  const restored=R.createCommandRestartGuard(storage,{now:()=>1501,maxAgeMs:500}).restore();
  assert.equal(restored,null);
  assert.equal(storage.value(writer.key),undefined);
});
test('restart guard rejects malformed or extended markers instead of trusting them', () => {
  const {R}=setup(),storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});
  storage.setItem(guard.key,JSON.stringify({version:1,role:'passenger',outcome:'pending',savedAt:900,rideId:'private-ride'}));
  assert.equal(guard.restore(),null);
  assert.equal(storage.value(guard.key),undefined);
  storage.setItem(guard.key,'not-json');
  assert.equal(guard.restore(),null);
});
test('restart guard keeps passenger and driver recovery wording separate', () => {
  const {R}=setup(),storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});
  guard.mark('driver','conflict');
  const restored=guard.restore();
  assert.equal(restored.role,'driver');
  assert.match(restored.feedback.message,/жњЂж–°зЉ¶ж…‹/);
  assert.notEqual(restored.feedback.role,'passenger');
});
test('restart guard clears markers and fails safely when storage is unavailable', () => {
  const {R}=setup(),storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});
  guard.mark('passenger','pending');
  assert.equal(guard.clear(),true);
  assert.equal(guard.restore(),null);
  const broken={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
  const unavailable=R.createCommandRestartGuard(broken,{now:()=>1000});
  assert.equal(unavailable.mark('passenger','pending'),false);
  assert.equal(unavailable.restore(),null);
});
function currentRideView(role,overrides={}) {
  return {id:FIXTURE.requestId,status:role==='driver'?'assigned':'collecting',revision:2,viewerRole:role,nextAction:role==='driver'?'start_pickup':'compare_offers',updatedAt:'2026-09-17T03:00:00.000Z',...overrides};
}
function startupRecovery(R,role,readCurrentRide,principal={accountRef:`demo-${role}-account`,viewerRole:role}) {
  const storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});
  guard.mark(role,'pending');
  return {storage,guard,controller:R.createStartupRecoveryController({guard,role,principal,readCurrentRide})};
}
test('startup network failure retains the marker without replaying a command', async () => {
  const {R}=setup();let reads=0;
  const {guard,controller}=startupRecovery(R,'passenger',async()=>{reads+=1;throw Error('offline');});
  const result=await controller.reconcile();
  assert.equal(result.requested,true);
  assert.equal(reads,1);
  assert.equal(result.state.outcome,'unresolved');
  assert.equal(result.state.markerRetained,true);
  assert.equal(result.state.canRetry,true);
  assert.equal(result.state.autoCommandReplay,false);
  assert.equal(guard.restore().role,'passenger');
});
test('connectivity recovery permits one explicit state reread and then clears the marker', async () => {
  const {R}=setup();let reads=0;
  const {guard,controller}=startupRecovery(R,'driver',async()=>{reads+=1;if(reads===1)throw Error('offline');return {status:200,body:currentRideView('driver')};});
  await controller.reconcile();
  const recovered=await controller.reconcile('connectivity');
  assert.equal(recovered.requested,true);
  assert.equal(recovered.state.outcome,'confirmed');
  assert.equal(recovered.state.markerRetained,false);
  assert.equal(reads,2);
  assert.equal(guard.restore(),null);
  assert.equal((await controller.reconcile('connectivity')).requested,false);
});
test('authentication recovery waits for explicit reauthentication and rereads once', async () => {
  const {R}=setup();let reads=0;
  const {guard,controller}=startupRecovery(R,'passenger',async()=>++reads===1?{status:401}:{status:200,body:currentRideView('passenger')});
  const expired=await controller.reconcile();
  assert.equal(expired.state.outcome,'reauth');
  assert.equal(expired.state.markerRetained,true);
  assert.equal((await controller.reconcile('connectivity')).requested,false);
  assert.equal(reads,1);
  const recovered=await controller.reconcile('reauth');
  assert.equal(recovered.state.outcome,'confirmed');
  assert.equal(reads,2);
  assert.equal(guard.restore(),null);
});
test('startup recovery clears a concealed not-found result without retry', async () => {
  const {R}=setup();let reads=0;
  const {guard,controller}=startupRecovery(R,'driver',async()=>{reads+=1;return {status:404};});
  const result=await controller.reconcile();
  assert.equal(result.state.outcome,'rejected');
  assert.equal(result.state.markerRetained,false);
  assert.equal(result.state.canRetry,false);
  assert.equal(guard.restore(),null);
  assert.equal((await controller.reconcile('connectivity')).requested,false);
  assert.equal(reads,1);
});
test('startup recovery does not treat a bodyless 304 as restored state', async () => {
  const {R}=setup();
  const {guard,controller}=startupRecovery(R,'passenger',async()=>({status:304}));
  const result=await controller.reconcile();
  assert.equal(result.state.outcome,'unresolved');
  assert.equal(result.state.markerRetained,true);
  assert.equal(result.state.canRetry,true);
  assert.equal(guard.restore().role,'passenger');
});
test('startup recovery discards a marker for another role before any read', async () => {
  const {R}=setup(),storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});let reads=0;
  guard.mark('passenger','pending');
  const controller=R.createStartupRecoveryController({guard,role:'driver',principal:{accountRef:'demo-driver-account',viewerRole:'driver'},readCurrentRide:async()=>{reads+=1;return {status:200,body:currentRideView('driver')};}});
  const result=await controller.reconcile();
  assert.equal(result.requested,false);
  assert.equal(result.state.markerRetained,false);
  assert.equal(reads,0);
  assert.equal(guard.restore(),null);
});
test('startup recovery rejects duplicate reads while one is in flight', async () => {
  const {R}=setup();let release,reads=0;
  const {controller}=startupRecovery(R,'passenger',()=>{reads+=1;return new Promise(resolve=>{release=resolve;});});
  const first=controller.reconcile();
  const duplicate=await controller.reconcile();
  assert.equal(duplicate.requested,false);
  assert.equal(duplicate.reason,'in_flight');
  assert.equal(reads,1);
  release({status:200,body:currentRideView('passenger')});
  assert.equal((await first).state.outcome,'confirmed');
});
test('startup discovery restores a passenger ride to the passenger history without a caller-supplied ride id', async () => {
  const {R}=setup(),requests=[];
  const {guard,controller}=startupRecovery(R,'passenger',async request=>{requests.push(request);return {status:200,body:currentRideView('passenger')};});
  const result=await controller.reconcile();
  assert.equal(requests.length,1);
  assert.equal(requests[0].method,'GET');
  assert.equal(requests[0].path,'/v1/rides/current');
  assert.equal(requests[0].reason,'startup');
  assert.equal(requests[0].signal.aborted,false);
  assert.equal(result.state.outcome,'confirmed');
  assert.equal(result.view.kind,'ride');
  assert.equal(result.view.page,'passenger-history');
  assert.deepEqual(Object.keys(result.view.ride),['id','status','revision','viewerRole','nextAction','updatedAt']);
  assert.equal(result.view.ride.viewerRole,'passenger');
  assert.equal(guard.restore(),null);
  assert.equal(Object.hasOwn(requests[0],'rideId'),false);
  assert.equal(Object.hasOwn(requests[0],'role'),false);
  assert.equal(Object.hasOwn(requests[0],'accountRef'),false);
});
test('startup discovery restores an assigned driver ride to the driver trips screen', async () => {
  const {R}=setup();
  const {guard,controller}=startupRecovery(R,'driver',async()=>({status:200,body:currentRideView('driver',{status:'arriving',nextAction:'start_trip'})}));
  const result=await controller.reconcile();
  assert.equal(result.state.outcome,'confirmed');
  assert.equal(result.view.kind,'ride');
  assert.equal(result.view.page,'driver-trips');
  assert.equal(result.view.ride.viewerRole,'driver');
  assert.equal(result.view.ride.status,'arriving');
  assert.equal(guard.restore(),null);
});
test('startup discovery clears the recovery lock and returns each role to its own home when no ride exists', async () => {
  const {R}=setup();
  for(const [role,page] of [['passenger','home'],['driver','driver-home']]){
    const {guard,controller}=startupRecovery(R,role,async()=>({status:204}));
    const result=await controller.reconcile();
    assert.equal(result.state.outcome,'empty');
    assert.equal(result.state.markerRetained,false);
    assert.equal(result.view.kind,'empty');
    assert.equal(result.view.page,page);
    assert.equal(result.view.ride,null);
    assert.equal(guard.restore(),null);
  }
});
test('startup discovery keeps commands locked when current-ride lookup is ambiguous', async () => {
  const {R}=setup(),body={code:'ambiguous_current_ride',message:'Current ride is ambiguous',requestId:'trace-only'};
  const {guard,controller}=startupRecovery(R,'passenger',async()=>({status:409,body}));
  const result=await controller.reconcile();
  assert.equal(result.state.outcome,'conflict');
  assert.equal(result.state.markerRetained,true);
  assert.equal(result.state.canRetry,false);
  assert.equal(result.view.kind,'blocked');
  assert.equal(result.view.page,null);
  assert.equal(result.view.ride,null);
  assert.equal(result.view.reason,'ambiguous_current_ride');
  assert.equal(guard.restore().resumedFrom,'conflict');
  assert.equal((await controller.reconcile()).requested,false);
  assert.equal(JSON.stringify(result).includes(FIXTURE.requestId),false);
});
test('startup discovery rejects extended current-ride bodies instead of exposing private fields', async () => {
  const {R}=setup(),extended={...currentRideView('passenger'),assignedDriverId:'private-driver'};
  const {guard,controller}=startupRecovery(R,'passenger',async()=>({status:200,body:extended}));
  const result=await controller.reconcile();
  assert.equal(result.state.outcome,'conflict');
  assert.equal(result.state.markerRetained,true);
  assert.equal(result.view.kind,'blocked');
  assert.equal(result.view.page,null);
  assert.equal(result.view.ride,null);
  assert.equal(result.view.reason,'invalid_current_ride');
  assert.equal(JSON.stringify(result).includes('private-driver'),false);
  assert.equal(guard.restore().resumedFrom,'conflict');
});
test('startup discovery rejects a valid shape for the other role without navigating or exposing the ride', async () => {
  const {R}=setup();
  const {guard,controller}=startupRecovery(R,'passenger',async()=>({status:200,body:currentRideView('driver')}));
  const result=await controller.reconcile();
  assert.equal(result.state.outcome,'conflict');
  assert.equal(result.view.kind,'blocked');
  assert.equal(result.view.page,null);
  assert.equal(result.view.ride,null);
  assert.equal(guard.restore().role,'passenger');
});
test('logout aborts startup discovery and a delayed success cannot restore the passenger screen', async () => {
  const {R}=setup();let release,request;
  const {guard,controller}=startupRecovery(R,'passenger',value=>{request=value;return new Promise(resolve=>{release=resolve;});});
  const pending=controller.reconcile();
  const loggedOut=controller.replacePrincipal(null);
  assert.equal(request.signal.aborted,true);
  assert.equal(loggedOut.sessionActive,false);
  assert.equal(loggedOut.markerRetained,false);
  assert.equal(loggedOut.outcome,'session_changed');
  assert.equal(guard.restore(),null);
  release({status:200,body:currentRideView('passenger')});
  const delayed=await pending;
  assert.equal(delayed.reason,'stale_session');
  assert.equal(delayed.view,null);
  assert.equal(delayed.state.outcome,'session_changed');
});
test('role switching rejects a delayed passenger discovery even when the response is otherwise valid', async () => {
  const {R}=setup();let release;
  const {controller}=startupRecovery(R,'passenger',()=>new Promise(resolve=>{release=resolve;}));
  const pending=controller.reconcile();
  const switched=controller.replacePrincipal({accountRef:'demo-driver-account',viewerRole:'driver'});
  assert.equal(switched.role,'passenger');
  assert.equal(switched.sessionActive,false);
  assert.equal(switched.sessionGeneration,2);
  release({status:200,body:currentRideView('passenger')});
  const delayed=await pending;
  assert.equal(delayed.reason,'stale_session');
  assert.equal(delayed.view,null);
  assert.equal(delayed.state.markerRetained,false);
});
test('account switching rejects a delayed discovery for the same role without exposing account references', async () => {
  const {R}=setup();let release,request;
  const {controller}=startupRecovery(R,'passenger',value=>{request=value;return new Promise(resolve=>{release=resolve;});},{accountRef:'passenger-a',viewerRole:'passenger'});
  const pending=controller.reconcile();
  const switched=controller.replacePrincipal({accountRef:'passenger-b',viewerRole:'passenger'});
  assert.equal(switched.sessionActive,true);
  assert.equal(switched.sessionGeneration,2);
  assert.equal(JSON.stringify(switched).includes('passenger-a'),false);
  assert.equal(JSON.stringify(switched).includes('passenger-b'),false);
  assert.equal(Object.hasOwn(request,'accountRef'),false);
  release({status:200,body:currentRideView('passenger')});
  const delayed=await pending;
  assert.equal(delayed.reason,'stale_session');
  assert.equal(delayed.view,null);
  assert.equal(JSON.stringify(delayed).includes('passenger-a'),false);
});
test('a delayed no-current-ride response cannot navigate the new session home', async () => {
  const {R}=setup();let release;
  const {controller}=startupRecovery(R,'driver',()=>new Promise(resolve=>{release=resolve;}));
  const pending=controller.reconcile();
  controller.replacePrincipal({accountRef:'other-driver-account',viewerRole:'driver'});
  release({status:204});
  const delayed=await pending;
  assert.equal(delayed.reason,'stale_session');
  assert.equal(delayed.view,null);
  assert.equal(delayed.state.outcome,'session_changed');
});
test('an old network failure cannot recreate a restart marker after the session changes', async () => {
  const {R}=setup();let reject;
  const {guard,controller}=startupRecovery(R,'passenger',()=>new Promise((resolve,rejectRead)=>{reject=rejectRead;}));
  const pending=controller.reconcile();
  controller.replacePrincipal(null);
  reject(Error('offline after logout'));
  const delayed=await pending;
  assert.equal(delayed.reason,'stale_session');
  assert.equal(delayed.state.markerRetained,false);
  assert.equal(guard.restore(),null);
  assert.equal((await controller.reconcile()).requested,false);
});
test('a new account starts one fresh discovery after aborting the old account read', async () => {
  const {R}=setup(),pending=[];
  const {guard,controller}=startupRecovery(R,'passenger',request=>new Promise(resolve=>pending.push({request,resolve})),{accountRef:'passenger-a',viewerRole:'passenger'});
  const oldRead=controller.reconcile();
  const initialized=controller.beginSessionRecovery({accountRef:'passenger-b',viewerRole:'passenger'});
  assert.equal(initialized.started,true);
  assert.equal(initialized.reason,'initialized');
  assert.equal(initialized.state.sessionGeneration,2);
  assert.equal(initialized.state.sessionRecoveryInitialized,true);
  assert.equal(initialized.state.markerRetained,true);
  assert.equal(pending[0].request.signal.aborted,true);
  const newRead=controller.reconcile();
  assert.equal(pending.length,2);
  assert.equal(pending[1].request.signal.aborted,false);
  pending[0].resolve({status:200,body:currentRideView('passenger')});
  const stale=await oldRead;
  assert.equal(stale.reason,'stale_session');
  assert.equal(stale.view,null);
  const duplicate=await controller.reconcile();
  assert.equal(duplicate.requested,false);
  assert.equal(duplicate.reason,'in_flight');
  assert.equal(pending.length,2);
  pending[1].resolve({status:200,body:currentRideView('passenger')});
  const recovered=await newRead;
  assert.equal(recovered.state.outcome,'confirmed');
  assert.equal(recovered.view.page,'passenger-history');
  assert.equal(guard.restore(),null);
});
test('the same session cannot initialize startup discovery twice', async () => {
  const {R}=setup();let reads=0;
  const {controller}=startupRecovery(R,'driver',async()=>{reads+=1;return {status:204};});
  await controller.reconcile();
  const duplicate=controller.beginSessionRecovery({accountRef:'demo-driver-account',viewerRole:'driver'});
  assert.equal(duplicate.started,false);
  assert.equal(duplicate.reason,'already_initialized');
  assert.equal((await controller.reconcile()).requested,false);
  assert.equal(reads,1);
});
test('a role-specific controller refuses to initialize recovery for the other role', async () => {
  const {R}=setup();let reads=0;
  const {guard,controller}=startupRecovery(R,'passenger',async()=>{reads+=1;return {status:204};});
  controller.replacePrincipal(null);
  const mismatched=controller.beginSessionRecovery({accountRef:'driver-account',viewerRole:'driver'});
  assert.equal(mismatched.started,false);
  assert.equal(mismatched.reason,'role_mismatch');
  assert.equal(mismatched.state.sessionActive,false);
  assert.equal(mismatched.state.markerRetained,false);
  assert.equal(guard.restore(),null);
  assert.equal((await controller.reconcile()).requested,false);
  assert.equal(reads,0);
});
test('fresh session recovery writes a new minimal marker without principal data', () => {
  const {R}=setup(),storage=memoryStorage();let now=1000;
  const guard=R.createCommandRestartGuard(storage,{now:()=>now});
  guard.mark('passenger','pending');
  const controller=R.createStartupRecoveryController({guard,role:'passenger',principal:{accountRef:'passenger-a',viewerRole:'passenger'},readCurrentRide:async()=>({status:204})});
  controller.replacePrincipal(null);now=2000;
  const initialized=controller.beginSessionRecovery({accountRef:'passenger-b',viewerRole:'passenger'});
  const fresh=JSON.parse(storage.value(guard.key));
  assert.equal(initialized.started,true);
  assert.deepEqual(fresh,{version:1,role:'passenger',outcome:'unresolved',savedAt:2000});
  assert.equal(JSON.stringify(fresh).includes('passenger-a'),false);
  assert.equal(JSON.stringify(fresh).includes('passenger-b'),false);
});
test('a newly initialized driver session returns only to the driver home when no ride exists', async () => {
  const {R}=setup();let requests=0;
  const {guard,controller}=startupRecovery(R,'driver',async request=>{requests+=1;assert.equal(Object.hasOwn(request,'accountRef'),false);return {status:204};});
  controller.replacePrincipal(null);
  const initialized=controller.beginSessionRecovery({accountRef:'new-driver',viewerRole:'driver'});
  const result=await controller.reconcile();
  assert.equal(initialized.started,true);
  assert.equal(result.state.outcome,'empty');
  assert.equal(result.view.page,'driver-home');
  assert.equal(result.view.ride,null);
  assert.equal(requests,1);
  assert.equal(guard.restore(),null);
});
function recoveryUi(R,role='passenger',generation=1) {
  const pages=[],commandUi=R.createCommandUiController(role);
  commandUi.finish('unresolved');
  return {pages,commandUi,adapter:R.createStartupRecoveryUiAdapter({role,sessionGeneration:generation,navigate:page=>pages.push(page),commandUi})};
}
function recoveryResult(role,outcome,view,overrides={}) {
  return {requested:true,state:{role,outcome,attempts:1,sessionGeneration:1,...overrides},view};
}
test('passenger startup recovery navigates and unlocks exactly once', () => {
  const {R}=setup(),{pages,commandUi,adapter}=recoveryUi(R);
  const view={kind:'ride',page:'passenger-history',ride:currentRideView('passenger'),reason:'current_ride'};
  const first=adapter.apply(recoveryResult('passenger','confirmed',view));
  const duplicate=adapter.apply(recoveryResult('passenger','confirmed',view));
  assert.equal(first.applied,true);assert.equal(first.reason,'ride_restored');
  assert.deepEqual(pages,['passenger-history']);
  assert.equal(commandUi.snapshot().disableCommands,false);
  assert.equal(duplicate.applied,false);assert.equal(duplicate.reason,'already_settled');
});
test('driver empty recovery returns only to driver home', () => {
  const {R}=setup(),{pages,adapter}=recoveryUi(R,'driver');
  const result=adapter.apply(recoveryResult('driver','empty',{kind:'empty',page:'driver-home',ride:null,reason:'no_current_ride'}));
  assert.equal(result.applied,true);assert.equal(result.reason,'home_restored');
  assert.deepEqual(pages,['driver-home']);assert.equal(result.state.command.role,'driver');
});
test('stale session recovery cannot navigate or unlock the current session', () => {
  const {R}=setup(),{pages,commandUi,adapter}=recoveryUi(R,'passenger',2);
  const stale=recoveryResult('passenger','confirmed',{kind:'ride',page:'passenger-history',ride:currentRideView('passenger')},{sessionGeneration:1});
  assert.equal(adapter.apply(stale).applied,false);
  assert.deepEqual(pages,[]);assert.equal(commandUi.snapshot().disableCommands,true);
});
test('a new UI session ignores an old completion and accepts its own result once', () => {
  const {R}=setup(),{pages,adapter}=recoveryUi(R,'driver');
  assert.equal(adapter.beginSession(2).started,true);
  const old=recoveryResult('driver','empty',{kind:'empty',page:'driver-home',ride:null},{sessionGeneration:1});
  assert.equal(adapter.apply(old).applied,false);
  const fresh=recoveryResult('driver','empty',{kind:'empty',page:'driver-home',ride:null},{sessionGeneration:2});
  assert.equal(adapter.apply(fresh).applied,true);assert.deepEqual(pages,['driver-home']);
  assert.equal(adapter.beginSession(2).started,false);
});
test('reauthentication and unresolved results update the role lock without navigation', () => {
  const {R}=setup(),{pages,commandUi,adapter}=recoveryUi(R,'driver');
  const reauth=adapter.apply(recoveryResult('driver','reauth',null));
  assert.equal(reauth.applied,true);assert.equal(commandUi.snapshot().action,'reauth');
  const unresolved=adapter.apply(recoveryResult('driver','unresolved',null,{attempts:2}));
  assert.equal(unresolved.applied,true);assert.equal(commandUi.snapshot().action,'refresh');
  assert.deepEqual(pages,[]);
});
test('cross-role or unexpected recovery views fail closed', () => {
  const {R}=setup(),{pages,commandUi,adapter}=recoveryUi(R,'passenger');
  const wrongRole=recoveryResult('driver','confirmed',{kind:'ride',page:'driver-trips',ride:currentRideView('driver')});
  assert.equal(adapter.apply(wrongRole).applied,false);
  const wrongPage=recoveryResult('passenger','confirmed',{kind:'ride',page:'driver-trips',ride:currentRideView('passenger')});
  const blocked=adapter.apply(wrongPage);
  assert.equal(blocked.applied,true);assert.equal(blocked.reason,'invalid_view');
  assert.deepEqual(pages,[]);assert.equal(commandUi.snapshot().outcome,'conflict');assert.equal(commandUi.snapshot().disableCommands,true);
});
function recoveryFlow(R,role,readCurrentRide,principal={accountRef:`demo-${role}-account`,viewerRole:role},options={}) {
  const storage=memoryStorage(),guard=R.createCommandRestartGuard(storage,{now:()=>1000});guard.mark(role,'pending');
  const controller=R.createStartupRecoveryController({guard,role,principal,readCurrentRide});
  const pages=[],commandUi=R.createCommandUiController(role);commandUi.finish('unresolved');
  const uiAdapter=R.createStartupRecoveryUiAdapter({role,sessionGeneration:controller.snapshot().sessionGeneration,navigate:page=>pages.push(page),commandUi});
  const flow=R.createStartupRecoveryFlow({role,controller,uiAdapter,...options});
  return {storage,guard,controller,pages,commandUi,uiAdapter,flow};
}
test('startup screen flow applies passenger recovery to navigation and lock once', async () => {
  const {R}=setup(),{flow,pages,commandUi}=recoveryFlow(R,'passenger',async()=>({status:200,body:currentRideView('passenger')}));
  const recovered=await flow.recoverOnStartup();
  assert.equal(recovered.processed,true);assert.equal(recovered.reason,'ride_restored');
  assert.deepEqual(pages,['passenger-history']);assert.equal(commandUi.snapshot().disableCommands,false);
  const duplicate=await flow.recoverOnStartup();
  assert.equal(duplicate.processed,false);assert.equal(duplicate.result.reason,'no_recovery');assert.deepEqual(pages,['passenger-history']);
});
test('connectivity recovery action rereads once and then unlocks the correct role', async () => {
  const {R}=setup();let reads=0;
  const {flow,pages,commandUi}=recoveryFlow(R,'driver',async()=>{reads+=1;if(reads===1)throw Error('offline');return {status:200,body:currentRideView('driver')};});
  const offline=await flow.recoverOnStartup();
  assert.equal(offline.processed,true);assert.equal(commandUi.snapshot().action,'refresh');assert.deepEqual(pages,[]);
  const restored=await flow.resume('connectivity');
  assert.equal(restored.processed,true);assert.deepEqual(pages,['driver-trips']);assert.equal(commandUi.snapshot().disableCommands,false);assert.equal(reads,2);
  assert.equal((await flow.resume('connectivity')).processed,false);assert.equal(reads,2);
});
test('reauthentication action keeps commands locked until the authorized reread succeeds', async () => {
  const {R}=setup();let reads=0;
  const {flow,pages,commandUi}=recoveryFlow(R,'passenger',async()=>{reads+=1;return reads===1?{status:401}:{status:204};});
  await flow.recoverOnStartup();assert.equal(commandUi.snapshot().action,'reauth');assert.deepEqual(pages,[]);
  const restored=await flow.resume('reauth');
  assert.equal(restored.processed,true);assert.deepEqual(pages,['home']);assert.equal(commandUi.snapshot().disableCommands,false);
});
test('a new authenticated session is initialized and applied through one flow', async () => {
  const {R}=setup();let reads=0;
  const {flow,controller,pages}=recoveryFlow(R,'driver',async()=>{reads+=1;return {status:204};},{accountRef:'driver-a',viewerRole:'driver'});
  controller.replacePrincipal(null);
  const started=await flow.beginSession({accountRef:'driver-b',viewerRole:'driver'});
  assert.equal(started.processed,true);assert.equal(started.reason,'home_restored');assert.deepEqual(pages,['driver-home']);assert.equal(reads,1);
  const duplicate=await flow.beginSession({accountRef:'driver-b',viewerRole:'driver'});
  assert.equal(duplicate.processed,false);assert.equal(duplicate.reason,'already_initialized');assert.equal(reads,1);
});
test('disposing a role flow aborts its read and rejects the delayed completion', async () => {
  const {R}=setup();let resolve;
  const {flow,pages,commandUi}=recoveryFlow(R,'passenger',()=>new Promise(done=>{resolve=done;}));
  const pending=flow.recoverOnStartup();
  const disposed=flow.dispose();assert.equal(disposed.disposed,true);
  resolve({status:200,body:currentRideView('passenger')});
  const stale=await pending;
  assert.equal(stale.processed,false);assert.equal(stale.reason,'flow_stale');assert.deepEqual(pages,[]);assert.equal(commandUi.snapshot().disableCommands,true);
  assert.equal((await flow.resume('connectivity')).reason,'flow_disposed');
});
test('role mismatch and invalid recovery actions send no discovery request', async () => {
  const {R}=setup();let reads=0;
  const {flow,pages}=recoveryFlow(R,'passenger',async()=>{reads+=1;return {status:204};});
  const wrong=await flow.beginSession({accountRef:'driver-account',viewerRole:'driver'});
  assert.equal(wrong.processed,false);assert.equal(wrong.reason,'role_mismatch');
  const invalid=await flow.resume('automatic');
  assert.equal(invalid.processed,false);assert.equal(invalid.reason,'invalid_resume_reason');assert.equal(reads,0);assert.deepEqual(pages,[]);
});
test('a hidden startup screen sends no read until it becomes visible', async () => {
  const {R}=setup();let reads=0;
  const {flow,pages}=recoveryFlow(R,'passenger',async()=>{reads+=1;return {status:204};},undefined,{initiallyVisible:false});
  const hidden=await flow.recoverOnStartup();
  assert.equal(hidden.reason,'screen_hidden');assert.equal(reads,0);assert.deepEqual(pages,[]);
  const visible=await flow.setVisible(true);
  assert.equal(visible.processed,true);assert.equal(visible.reason,'home_restored');assert.equal(reads,1);assert.deepEqual(pages,['home']);
});
test('a result completed while hidden is deferred and applied once on return', async () => {
  const {R}=setup();let resolve;
  const {flow,pages,commandUi}=recoveryFlow(R,'driver',()=>new Promise(done=>{resolve=done;}));
  const pending=flow.recoverOnStartup();await flow.setVisible(false);
  resolve({status:200,body:currentRideView('driver')});
  const deferred=await pending;
  assert.equal(deferred.reason,'hidden_result_deferred');assert.deepEqual(pages,[]);assert.equal(commandUi.snapshot().disableCommands,true);
  const restored=await flow.setVisible(true);
  assert.equal(restored.processed,true);assert.deepEqual(pages,['driver-trips']);assert.equal(commandUi.snapshot().disableCommands,false);
  assert.equal((await flow.setVisible(true)).reason,'visibility_unchanged');assert.deepEqual(pages,['driver-trips']);
});
test('a hidden connectivity action does not consume the one allowed reread', async () => {
  const {R}=setup();let reads=0;
  const {flow,pages}=recoveryFlow(R,'passenger',async()=>{reads+=1;if(reads===1)throw Error('offline');return {status:204};});
  await flow.recoverOnStartup();await flow.setVisible(false);
  assert.equal((await flow.resume('connectivity')).reason,'screen_hidden');assert.equal(reads,1);
  assert.equal((await flow.setVisible(true)).reason,'visible_noop');assert.equal(reads,1);
  const restored=await flow.resume('connectivity');
  assert.equal(restored.processed,true);assert.equal(reads,2);assert.deepEqual(pages,['home']);
});
test('rapid hide and show during one read does not start another read', async () => {
  const {R}=setup();let resolve,reads=0;
  const {flow,pages}=recoveryFlow(R,'driver',()=>{reads+=1;return new Promise(done=>{resolve=done;});});
  const pending=flow.recoverOnStartup();await flow.setVisible(false);await flow.setVisible(true);
  assert.equal(reads,1);assert.equal(flow.snapshot().controller.busy,true);
  resolve({status:204});const restored=await pending;
  assert.equal(restored.processed,true);assert.equal(reads,1);assert.deepEqual(pages,['driver-home']);
});
test('a session initialized while hidden performs one discovery when shown', async () => {
  const {R}=setup();let reads=0;
  const {flow,controller,pages}=recoveryFlow(R,'passenger',async()=>{reads+=1;return {status:204};},{accountRef:'passenger-a',viewerRole:'passenger'},{initiallyVisible:false});
  controller.replacePrincipal(null);
  const hidden=await flow.beginSession({accountRef:'passenger-b',viewerRole:'passenger'});
  assert.equal(hidden.reason,'screen_hidden');assert.equal(reads,0);
  const visible=await flow.setVisible(true);
  assert.equal(visible.processed,true);assert.equal(reads,1);assert.deepEqual(pages,['home']);
});
test('disposing a hidden flow discards its deferred result permanently', async () => {
  const {R}=setup();let resolve;
  const {flow,pages}=recoveryFlow(R,'passenger',()=>new Promise(done=>{resolve=done;}));
  const pending=flow.recoverOnStartup();await flow.setVisible(false);resolve({status:204});
  assert.equal((await pending).reason,'hidden_result_deferred');assert.equal(flow.snapshot().deferredResult,true);
  flow.dispose();assert.equal(flow.snapshot().deferredResult,false);
  assert.equal((await flow.setVisible(true)).reason,'flow_disposed');assert.deepEqual(pages,[]);
});
function recoveryEventTarget() {
  const listeners=new Map(),adds=new Map();
  return {
    addEventListener(type,handler){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(handler);adds.set(type,(adds.get(type)||0)+1);},
    removeEventListener(type,handler){listeners.get(type)?.delete(handler);},
    dispatch(type,event={}){for(const handler of [...(listeners.get(type)||[])])handler({type,...event});},
    listenerCount(type){return listeners.get(type)?.size||0;},
    addCount(type){return adds.get(type)||0;}
  };
}
function feedbackDomElements() {
  const target=recoveryEventTarget(),element=()=>({hidden:false,disabled:false,textContent:'',className:'',attributes:{},setAttribute(name,value){this.attributes[name]=String(value);}}),action=Object.assign(element(),target);
  return {box:element(),title:element(),message:element(),action,commandButtons:[element(),element()]};
}
test('startup recovery event bridge attaches each lifecycle listener once', async () => {
  const {R}=setup(),target=recoveryEventTarget(),documentState={visibilityState:'visible'};
  const {flow}=recoveryFlow(R,'passenger',async()=>({status:204}));
  const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState});
  assert.equal(bridge.start().started,true);assert.equal(bridge.start().reason,'already_attached');await bridge.idle();
  for(const type of ['visibilitychange','pageshow','online']){assert.equal(target.listenerCount(type),1);assert.equal(target.addCount(type),1);}
  assert.deepEqual(Object.keys(bridge.snapshot()).sort(),['attached','busy','detached','handledEvents','lastEvent']);
});
test('visibilitychange and pageshow restore a hidden startup screen with one read', async () => {
  const {R}=setup(),target=recoveryEventTarget(),documentState={visibilityState:'hidden'};let reads=0;
  const {flow,pages}=recoveryFlow(R,'driver',async()=>{reads+=1;return {status:204};},undefined,{initiallyVisible:false});
  const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState});bridge.start();await bridge.idle();
  target.dispatch('pageshow');await bridge.idle();assert.equal(reads,0);
  documentState.visibilityState='visible';target.dispatch('visibilitychange');target.dispatch('pageshow');await bridge.idle();
  assert.equal(reads,1);assert.deepEqual(pages,['driver-home']);assert.equal(flow.snapshot().visible,true);
});
test('duplicate online events coalesce into the single permitted connectivity reread', async () => {
  const {R}=setup(),target=recoveryEventTarget(),documentState={visibilityState:'visible'};let reads=0,release;
  const {flow,pages}=recoveryFlow(R,'passenger',async()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});});
  await flow.recoverOnStartup();const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState});bridge.start();await bridge.idle();
  target.dispatch('online');target.dispatch('online');await Promise.resolve();await Promise.resolve();
  assert.equal(reads,2);target.dispatch('online');assert.equal(reads,2);
  release({status:204});await bridge.idle();assert.equal(reads,2);assert.deepEqual(pages,['home']);
});
test('online does not substitute for the explicit reauthentication recovery action', async () => {
  const {R}=setup(),target=recoveryEventTarget(),documentState={visibilityState:'visible'};let reads=0;
  const {flow,pages}=recoveryFlow(R,'driver',async()=>{reads+=1;return {status:401};});
  await flow.recoverOnStartup();const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState});bridge.start();await bridge.idle();
  target.dispatch('online');await bridge.idle();assert.equal(reads,1);assert.deepEqual(pages,[]);assert.equal(flow.snapshot().controller.outcome,'reauth');
});
test('hiding during an online reread defers its result until pageshow without another read', async () => {
  const {R}=setup(),target=recoveryEventTarget(),documentState={visibilityState:'visible'};let reads=0,release;
  const {flow,pages}=recoveryFlow(R,'driver',async()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});});
  await flow.recoverOnStartup();const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState});bridge.start();await bridge.idle();
  target.dispatch('online');await Promise.resolve();await Promise.resolve();assert.equal(reads,2);
  documentState.visibilityState='hidden';target.dispatch('visibilitychange');assert.equal(flow.snapshot().visible,false);
  release({status:200,body:currentRideView('driver')});await bridge.idle();assert.deepEqual(pages,[]);assert.equal(flow.snapshot().deferredResult,true);
  documentState.visibilityState='visible';target.dispatch('pageshow');await bridge.idle();assert.equal(reads,2);assert.deepEqual(pages,['driver-trips']);
});
test('detaching the event bridge removes listeners and prevents late or future navigation', async () => {
  const {R}=setup(),target=recoveryEventTarget(),documentState={visibilityState:'visible'};let reads=0,release;
  const {flow,pages}=recoveryFlow(R,'passenger',async()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});});
  await flow.recoverOnStartup();const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState});bridge.start();await bridge.idle();
  target.dispatch('online');await Promise.resolve();await Promise.resolve();assert.equal(reads,2);
  assert.equal(bridge.detach().detached,true);for(const type of ['visibilitychange','pageshow','online'])assert.equal(target.listenerCount(type),0);
  release({status:204});await bridge.idle();target.dispatch('online');target.dispatch('pageshow');await bridge.idle();
  assert.equal(reads,2);assert.deepEqual(pages,[]);assert.equal(flow.snapshot().disposed,true);assert.equal(bridge.start().reason,'bridge_detached');
});
function roleLifecycleFixture(R,{target=recoveryEventTarget(),documentState={visibilityState:'visible'},readCurrentRide}={}) {
  const bundles=[],bridges=[];
  const lifecycle=R.createRoleRecoveryLifecycle({
    createRoleFlow({role,generation}){
      const bundle=recoveryFlow(R,role,request=>readCurrentRide({role,generation,request}),{accountRef:`${role}-${generation}`,viewerRole:role},{initiallyVisible:documentState.visibilityState!=='hidden'});
      bundles.push({...bundle,role,generation});return bundle.flow;
    },
    createEventBridge({flow,role,generation,requestRecovery}){
      const bridge=R.createStartupRecoveryEventBridge({flow,eventTarget:target,documentState,requestRecovery});bridges.push({bridge,role,generation});return bridge;
    }
  });
  return {lifecycle,target,documentState,bundles,bridges};
}
function roleFeedbackLifecycleFixture(R,{notificationRead=async()=>({status:304}),onReauthenticate=()=>({requested:true}),notificationSubscribe=null}={}) {
  const startupTarget=recoveryEventTarget(),notificationTarget=recoveryEventTarget(),documentState={visibilityState:'visible'},feedbacks=[],notificationBridges=[],events=[];let lifecycle;
  lifecycle=R.createRoleRecoveryLifecycle({
    createRoleFlow({role,generation}){return recoveryFlow(R,role,async()=>({status:204}),{accountRef:`${role}-${generation}`,viewerRole:role}).flow;},
    createEventBridge({flow,requestRecovery}){return R.createStartupRecoveryEventBridge({flow,eventTarget:startupTarget,documentState,requestRecovery});},
    createFeedbackBridge({role,generation}){
      const current=currentRideView(role,{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle,role,currentRide:current,recover:hint=>notificationRead({role,generation,hint})}),commandUi=R.createCommandUiController(role),flow=R.createNotificationFeedbackFlow({role,recovery,commandUi,onReauthenticate:context=>onReauthenticate({...context,generation})}),target=recoveryEventTarget(),renders=[];
      const inner=R.createNotificationFeedbackEventBridge({flow,eventTarget:target,render:view=>renders.push(view)});
      const bridge={snapshot:()=>inner.snapshot(),attach(){events.push(`attach:${role}:${generation}`);return inner.attach();},activate:()=>inner.activate(),handleNotification:hint=>inner.handleNotification(hint),detach(){events.push(`detach:${role}:${generation}`);return inner.detach();},idle:()=>inner.idle()};
      feedbacks.push({role,generation,current,recovery,commandUi,flow,target,renders,bridge,inner});return bridge;
    },
    createNotificationBridge({role,generation,sessionBinding,onHint}){
      const inner=notificationSubscribe?R.createAsyncNotificationSubscriptionBridge({subscribe:({signal,onHint:deliver})=>notificationSubscribe({role,generation,sessionBinding,signal,onHint:deliver}),onHint}):R.createNotificationHintEventBridge({eventTarget:notificationTarget,onHint});
      notificationBridges.push({role,generation,sessionBinding,inner});return inner;
    }
  });
  return {lifecycle,feedbacks,notificationBridges,events,startupTarget,notificationTarget};
}
function roleSubscriptionLifecycleFixture(R,{verifyLatest=async()=>({verified:true}),onReauthenticate=async()=>({requested:true})}={}) {
  const startupTarget=recoveryEventTarget(),documentState={visibilityState:'visible'},subscriptions=[];let lifecycle;
  lifecycle=R.createRoleRecoveryLifecycle({
    createRoleFlow({role,generation}){return recoveryFlow(R,role,async()=>({status:204}),{accountRef:`${role}-${generation}`,viewerRole:role}).flow;},
    createEventBridge({flow,requestRecovery}){return R.createStartupRecoveryEventBridge({flow,eventTarget:startupTarget,documentState,requestRecovery});},
    createSubscriptionBridge({role,generation,sessionBinding}){
      const record={role,generation,sessionBinding,connects:0,unsubscribes:0,disconnect:null,renders:[]};
      const bridge=R.createRecoverableNotificationSubscriptionBridge({
        role,
        subscribe:async input=>{record.connects+=1;record.disconnect=input.onDisconnect;return()=>{record.unsubscribes+=1;};},
        onHint:async()=>({processed:true}),
        verifyLatest:()=>verifyLatest({role,generation,sessionBinding,record}),
        onReauthenticate:()=>onReauthenticate({role,generation,sessionBinding,record}),
        render:value=>record.renders.push(value)
      });
      record.bridge=bridge;subscriptions.push(record);return bridge;
    }
  });
  return {lifecycle,subscriptions,startupTarget};
}
function roleSubscriptionFeedbackLifecycleFixture(R,{subscribe,verifyLatest=async()=>({verified:true}),onReauthenticate=async()=>({requested:true})}={}) {
  const startupTarget=recoveryEventTarget(),documentState={visibilityState:'visible'},subscriptions=[];let lifecycle;
  lifecycle=R.createRoleRecoveryLifecycle({
    createRoleFlow({role,generation}){return recoveryFlow(R,role,async()=>({status:204}),{accountRef:`${role}-${generation}`,viewerRole:role}).flow;},
    createEventBridge({flow,requestRecovery}){return R.createStartupRecoveryEventBridge({flow,eventTarget:startupTarget,documentState,requestRecovery});},
    createSubscriptionBridge({role,generation,sessionBinding}){
      const target=recoveryEventTarget(),commandUi=R.createCommandUiController(role),record={role,generation,sessionBinding,target,commandUi,renders:[],connects:0,unsubscribes:0,disconnect:null};
      const bridge=R.createNotificationSubscriptionFeedbackBridge({
        role,generation,lifecycle,commandUi,eventTarget:target,
        subscribe:async input=>{record.connects+=1;record.disconnect=input.onDisconnect;if(subscribe)return subscribe({...input,role,generation,sessionBinding,record});return()=>{record.unsubscribes+=1;};},
        onHint:async()=>({processed:true}),verifyLatest:()=>verifyLatest({role,generation,sessionBinding,record}),onReauthenticate:()=>onReauthenticate({role,generation,sessionBinding,record}),render:view=>record.renders.push(view)
      });
      record.bridge=bridge;subscriptions.push(record);return bridge;
    }
  });
  return {lifecycle,subscriptions,startupTarget};
}
function roleSubscriptionDomLifecycleFixture(R,{subscribe,verifyLatest=async()=>({verified:true}),onReauthenticate=async()=>({requested:true})}={}) {
  const startupTarget=recoveryEventTarget(),documentState={visibilityState:'visible'},subscriptions=[];let lifecycle;
  lifecycle=R.createRoleRecoveryLifecycle({
    createRoleFlow({role,generation}){return recoveryFlow(R,role,async()=>({status:204}),{accountRef:`${role}-${generation}`,viewerRole:role}).flow;},
    createEventBridge({flow,requestRecovery}){return R.createStartupRecoveryEventBridge({flow,eventTarget:startupTarget,documentState,requestRecovery});},
    createSubscriptionBridge({role,generation,sessionBinding}){
      const elements=feedbackDomElements(),record={role,generation,sessionBinding,elements,connects:0,disconnect:null,renders:[]};
      const bridge=R.createNotificationSubscriptionDomBridge({role,generation,lifecycle,elements,
        subscribe:async input=>{record.connects+=1;record.disconnect=input.onDisconnect;if(subscribe)return subscribe({...input,role,generation,sessionBinding,record});return()=>{};},
        onHint:async()=>({processed:true}),verifyLatest:()=>verifyLatest({role,generation,sessionBinding,record}),onReauthenticate:()=>onReauthenticate({role,generation,sessionBinding,record}),render:view=>record.renders.push(view)
      });
      record.bridge=bridge;subscriptions.push(record);return bridge;
    }
  });
  return {lifecycle,subscriptions,startupTarget};
}
function allowedRoleServices(overrides={}) {
  return {
    configured:true,
    sessionForRole:overrides.sessionForRole||(()=>({accountRef:'demo-account',viewerRole:'passenger'})),
    readCurrentRide:overrides.readCurrentRide||(async()=>({status:204})),
    subscribeNotifications:overrides.subscribeNotifications||(async()=>()=>{}),
    verifyLatest:overrides.verifyLatest||(async()=>({verified:true})),
    handleNotificationHint:overrides.handleNotificationHint||(async()=>({processed:true})),
    reauthenticate:overrides.reauthenticate||(async()=>({requested:true}))
  };
}
test('role screen entry creates one flow and bridge without duplicate startup reads', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}});
  const entered=await fixture.lifecycle.enter('passenger');assert.equal(entered.entered,true);assert.equal(reads,1);
  const duplicate=await fixture.lifecycle.enter('passenger');assert.equal(duplicate.reason,'already_entered');assert.equal(reads,1);
  assert.equal(fixture.bundles.length,1);assert.equal(fixture.bridges.length,1);
  for(const type of ['visibilitychange','pageshow','online'])assert.equal(fixture.target.listenerCount(type),1);
});
test('switching role screens disposes the old entry before accepting the new role', async () => {
  const {R}=setup();let releasePassenger;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:({role})=>role==='passenger'?new Promise(resolve=>{releasePassenger=resolve;}):Promise.resolve({status:204})});
  const passenger=fixture.lifecycle.enter('passenger');await Promise.resolve();await Promise.resolve();
  const driver=await fixture.lifecycle.enter('driver');assert.equal(driver.entered,true);
  releasePassenger({status:200,body:currentRideView('passenger')});const old=await passenger;
  assert.equal(old.reason,'stale_entry');assert.equal(fixture.bundles[0].flow.snapshot().disposed,true);assert.deepEqual(fixture.bundles[0].pages,[]);
  assert.deepEqual(fixture.bundles[1].pages,['driver-home']);assert.equal(fixture.lifecycle.snapshot().activeRole,'driver');
  for(const type of ['visibilitychange','pageshow','online'])assert.equal(fixture.target.listenerCount(type),1);
});
test('leaving a role screen removes every listener and ignores later events', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}});
  await fixture.lifecycle.enter('driver');const left=fixture.lifecycle.leave();assert.equal(left.left,true);assert.equal(left.role,'driver');
  for(const type of ['visibilitychange','pageshow','online'])assert.equal(fixture.target.listenerCount(type),0);
  fixture.target.dispatch('online');fixture.target.dispatch('pageshow');await fixture.lifecycle.idle();assert.equal(reads,1);
  assert.deepEqual(Object.keys(fixture.lifecycle.snapshot()).sort(),['activeRole','busy','entered','generation','lastAction']);
});
test('re-entering the same role after leaving creates a fresh isolated generation', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}});
  await fixture.lifecycle.enter('passenger');const first=fixture.bundles[0];fixture.lifecycle.leave();
  const secondEntry=await fixture.lifecycle.enter('passenger');const second=fixture.bundles[1];
  assert.equal(secondEntry.entered,true);assert.equal(reads,2);assert.notEqual(first.flow,second.flow);assert.equal(first.flow.snapshot().disposed,true);
  assert.equal(first.generation+1,second.generation);assert.equal(fixture.target.listenerCount('online'),1);
});
test('entering a hidden role screen waits for pageshow before its first discovery', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{documentState:{visibilityState:'hidden'},readCurrentRide:async()=>{reads+=1;return {status:204};}});
  const entered=await fixture.lifecycle.enter('driver');assert.equal(entered.startup.reason,'screen_hidden');assert.equal(reads,0);
  fixture.documentState.visibilityState='visible';fixture.target.dispatch('pageshow');await fixture.lifecycle.idle();
  assert.equal(reads,1);assert.deepEqual(fixture.bundles[0].pages,['driver-home']);
});
test('a delayed online result from a departed entry cannot affect a re-entered role', async () => {
  const {R}=setup();let phase=0,releaseOld;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:({generation})=>{
    if(generation===1){phase+=1;if(phase===1)throw Error('offline');return new Promise(resolve=>{releaseOld=resolve;});}
    return Promise.resolve({status:204});
  }});
  await fixture.lifecycle.enter('passenger');fixture.target.dispatch('online');await Promise.resolve();await Promise.resolve();
  fixture.lifecycle.leave();const reentered=await fixture.lifecycle.enter('passenger');assert.equal(reentered.entered,true);
  releaseOld({status:200,body:currentRideView('passenger')});await fixture.bridges[0].bridge.idle();
  assert.deepEqual(fixture.bundles[0].pages,[]);assert.deepEqual(fixture.bundles[1].pages,['home']);assert.equal(fixture.lifecycle.snapshot().generation,2);
});
test('passenger bottom navigation and registration keep one recovery generation', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  assert.equal((await boundary.navigate('home','passenger')).reason,'role_entered');
  for(const page of ['offers','verify','passenger-history','passenger-account','passenger-register'])assert.equal((await boundary.navigate(page,'passenger')).reason,'within_role');
  assert.equal(reads,1);assert.equal(fixture.bundles.length,1);assert.equal(fixture.lifecycle.snapshot().generation,1);assert.equal(boundary.snapshot().page,'passenger-register');
});
test('driver bottom navigation and pending registration keep one recovery generation', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('driver-home','driver');
  for(const page of ['driver-requests','driver-trips','driver-account','register','driver-home'])await boundary.navigate(page,'driver');
  assert.equal(reads,1);assert.equal(fixture.bundles.length,1);assert.equal(fixture.lifecycle.snapshot().generation,1);assert.equal(boundary.snapshot().page,'driver-home');
});
test('returning to the role chooser detaches recovery and blocks a delayed page restoration', async () => {
  const {R}=setup();let release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>new Promise(resolve=>{release=resolve;})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  const entering=boundary.navigate('home','passenger');await Promise.resolve();await Promise.resolve();
  const chooser=await boundary.navigate('role');assert.equal(chooser.reason,'role_chooser');assert.equal(boundary.snapshot().page,'role');
  for(const type of ['visibilitychange','pageshow','online'])assert.equal(fixture.target.listenerCount(type),0);
  release({status:200,body:currentRideView('passenger')});assert.equal((await entering).reason,'stale_navigation');assert.equal(boundary.snapshot().page,'role');assert.deepEqual(fixture.bundles[0].pages,[]);
});
test('routing from passenger to driver creates a new generation after detaching passenger', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');const passenger=fixture.bundles[0];
  const driver=await boundary.navigate('driver-home','driver');assert.equal(driver.reason,'role_entered');
  assert.equal(reads,2);assert.equal(passenger.flow.snapshot().disposed,true);assert.equal(fixture.lifecycle.snapshot().generation,2);assert.equal(boundary.snapshot().page,'driver-home');
  for(const type of ['visibilitychange','pageshow','online'])assert.equal(fixture.target.listenerCount(type),1);
});
test('rapid same-role route changes during startup keep the last page without another read', async () => {
  const {R}=setup();let reads=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;return new Promise(resolve=>{release=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  const home=boundary.navigate('home','passenger');await Promise.resolve();await Promise.resolve();
  const history=await boundary.navigate('passenger-history','passenger');assert.equal(history.reason,'within_role');assert.equal(boundary.snapshot().page,'passenger-history');assert.equal(reads,1);
  release({status:204});assert.equal((await home).reason,'stale_navigation');assert.equal(boundary.snapshot().page,'passenger-history');assert.equal(reads,1);
});
test('unknown pages and cross-role route hints fail without changing the active role', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');const generation=fixture.lifecycle.snapshot().generation;
  assert.equal((await boundary.navigate('admin','passenger')).reason,'unknown_page');
  assert.equal((await boundary.navigate('driver-trips','passenger')).reason,'role_mismatch');
  assert.equal(reads,1);assert.equal(fixture.lifecycle.snapshot().activeRole,'passenger');assert.equal(fixture.lifecycle.snapshot().generation,generation);assert.equal(boundary.snapshot().page,'home');
});
test('latest-state action is limited to one request in the active passenger generation', async () => {
  const {R}=setup();let reads=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');const generation=fixture.lifecycle.snapshot().generation;
  const first=boundary.recover('refresh');await Promise.resolve();await Promise.resolve();assert.equal(reads,2);
  const duplicate=await boundary.recover('refresh');assert.equal(duplicate.recovered,false);assert.equal(duplicate.reason,'recovery_in_progress');assert.equal(reads,2);
  release({status:204});const recovered=await first;
  assert.equal(recovered.recovered,true);assert.equal(recovered.reason,'recovered');assert.equal(fixture.lifecycle.snapshot().generation,generation);assert.deepEqual(fixture.bundles[0].pages,['home']);
});
test('reauthentication action rereads once inside the active driver generation', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return reads===1?{status:401}:{status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('driver-home','driver');const generation=fixture.lifecycle.snapshot().generation;
  const recovered=await boundary.recover('reauth');
  assert.equal(recovered.recovered,true);assert.equal(reads,2);assert.equal(fixture.lifecycle.snapshot().generation,generation);assert.deepEqual(fixture.bundles[0].pages,['driver-home']);
});
test('recovery actions without an active role or with an unknown action send no read', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return {status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  assert.equal((await boundary.recover('refresh')).reason,'no_active_role');
  assert.equal((await boundary.recover('retry-everything')).reason,'invalid_recovery_action');
  assert.equal(reads,0);assert.equal(fixture.lifecycle.snapshot().generation,0);assert.equal(boundary.snapshot().page,'role');
});
test('leaving for role selection makes an in-flight latest-state result stale', async () => {
  const {R}=setup();let reads=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');const recovery=boundary.recover('refresh');await Promise.resolve();await Promise.resolve();
  await boundary.navigate('role');release({status:204});const stale=await recovery;
  assert.equal(stale.recovered,false);assert.equal(stale.reason,'stale_recovery');assert.equal(boundary.snapshot().page,'role');assert.equal(fixture.lifecycle.snapshot().activeRole,null);assert.deepEqual(fixture.bundles[0].pages,[]);
});
test('role switch permits a fresh action while the departed role action is still pending', async () => {
  const {R}=setup();const reads={passenger:0,driver:0};let releasePassenger;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:({role})=>{
    reads[role]+=1;
    if(role==='passenger'&&reads.passenger===1)throw Error('offline');
    if(role==='passenger')return new Promise(resolve=>{releasePassenger=resolve;});
    if(reads.driver===1)throw Error('offline');
    return Promise.resolve({status:204});
  }}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');const oldAction=boundary.recover('refresh');await Promise.resolve();await Promise.resolve();
  await boundary.navigate('driver-home','driver');const fresh=await boundary.recover('refresh');
  assert.equal(fresh.recovered,true);assert.deepEqual(reads,{passenger:2,driver:2});assert.deepEqual(fixture.bundles[1].pages,['driver-home']);
  releasePassenger({status:204});const stale=await oldAction;
  assert.equal(stale.reason,'stale_recovery');assert.equal(boundary.snapshot().page,'driver-home');assert.equal(fixture.lifecycle.snapshot().activeRole,'driver');assert.deepEqual(fixture.bundles[0].pages,[]);
});
test('lifecycle rejects a stale role or generation before starting recovery', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;throw Error('offline');}});
  await fixture.lifecycle.enter('passenger');const generation=fixture.lifecycle.snapshot().generation;
  assert.equal((await fixture.lifecycle.requestRecovery({role:'driver',generation,reason:'connectivity'})).reason,'stale_role_generation');
  assert.equal((await fixture.lifecycle.requestRecovery({role:'passenger',generation:generation-1,reason:'connectivity'})).reason,'stale_role_generation');
  assert.equal((await fixture.lifecycle.requestRecovery({role:'passenger',generation,reason:'force'})).reason,'invalid_recovery_reason');
  assert.equal(reads,1);
});
test('manual latest-state recovery wins over a simultaneous online event with one read', async () => {
  const {R}=setup();let reads=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');const manual=boundary.recover('refresh');await Promise.resolve();await Promise.resolve();
  fixture.target.dispatch('online');await fixture.bridges[0].bridge.idle();assert.equal(reads,2);
  release({status:204});const recovered=await manual;
  assert.equal(recovered.recovered,true);assert.equal(reads,2);assert.deepEqual(fixture.bundles[0].pages,['home']);
});
test('online recovery wins over a simultaneous manual tap with one read', async () => {
  const {R}=setup();let reads=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');fixture.target.dispatch('online');await Promise.resolve();await Promise.resolve();assert.equal(reads,2);
  const manual=await boundary.recover('refresh');assert.equal(manual.recovered,false);assert.equal(manual.reason,'recovery_in_progress');assert.equal(reads,2);
  release({status:204});await fixture.bridges[0].bridge.idle();assert.equal(reads,2);assert.deepEqual(fixture.bundles[0].pages,['home']);
});
test('hiding during unified online recovery defers one result and blocks a manual duplicate', async () => {
  const {R}=setup();let reads=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{release=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('driver-home','driver');fixture.target.dispatch('online');await Promise.resolve();await Promise.resolve();
  fixture.documentState.visibilityState='hidden';fixture.target.dispatch('visibilitychange');
  assert.equal((await boundary.recover('refresh')).reason,'recovery_in_progress');assert.equal(reads,2);
  release({status:204});await fixture.bridges[0].bridge.idle();assert.deepEqual(fixture.bundles[0].pages,[]);assert.equal(fixture.bundles[0].flow.snapshot().deferredResult,true);
  fixture.documentState.visibilityState='visible';fixture.target.dispatch('pageshow');await fixture.bridges[0].bridge.idle();assert.equal(reads,2);assert.deepEqual(fixture.bundles[0].pages,['driver-home']);
});
test('online never consumes the explicit reauthentication action', async () => {
  const {R}=setup();let reads=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{reads+=1;return reads===1?{status:401}:{status:204};}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('driver-home','driver');fixture.target.dispatch('online');await fixture.bridges[0].bridge.idle();assert.equal(reads,1);
  const reauthenticated=await boundary.recover('reauth');assert.equal(reauthenticated.recovered,true);assert.equal(reads,2);assert.deepEqual(fixture.bundles[0].pages,['driver-home']);
});
test('switching roles during online recovery allows one independent action in the new role', async () => {
  const {R}=setup();const reads={passenger:0,driver:0};let releasePassenger;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:({role})=>{
    reads[role]+=1;
    if(role==='passenger'&&reads.passenger===1)throw Error('offline');
    if(role==='passenger')return new Promise(resolve=>{releasePassenger=resolve;});
    if(reads.driver===1)throw Error('offline');
    return Promise.resolve({status:204});
  }}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');fixture.target.dispatch('online');await Promise.resolve();await Promise.resolve();
  await boundary.navigate('driver-home','driver');const fresh=await boundary.recover('refresh');
  assert.equal(fresh.recovered,true);assert.deepEqual(reads,{passenger:2,driver:2});assert.deepEqual(fixture.bundles[1].pages,['driver-home']);
  releasePassenger({status:204});await fixture.bridges[0].bridge.idle();assert.deepEqual(fixture.bundles[0].pages,[]);assert.equal(boundary.snapshot().page,'driver-home');
});
test('a minimal notification hint applies only an authorized role-scoped recovery', async () => {
  const {R}=setup();let calls=0,received;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});
  await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned',nextAction:'track_driver'});
  const notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async hint=>{calls+=1;received=hint;return {status:200,body:currentRideView('passenger',{revision:9,status:'on_trip',nextAction:'show_on_trip'})};}});
  const result=await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});
  assert.equal(result.processed,true);assert.equal(result.reason,'notification_recovered');assert.equal(calls,1);assert.equal(received.type,'ride.changed');assert.equal(received.rideId,current.id);assert.equal(received.revision,9);
  const snapshot=notifications.snapshot();
  assert.equal(snapshot.role,'passenger');assert.equal(snapshot.hasRide,true);assert.equal(snapshot.revision,9);assert.equal(snapshot.status,'on_trip');assert.equal(snapshot.busy,false);assert.equal(snapshot.lastReason,'notification_recovered');
});
test('private, foreign and stale notification hints stop before authorized recovery', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned',nextAction:'start_pickup'});
  const notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return {status:500};}});
  assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:9,plate:'DEMO 001'})).reason,'invalid_hint');
  assert.equal((await notifications.handle({type:'ride.changed',rideId:'foreign',revision:9})).reason,'foreign_hint');
  assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:8})).reason,'stale_or_duplicate_hint');
  assert.equal(calls,0);assert.equal(notifications.snapshot().revision,8);
});
test('notification-first recovery rejects a simultaneous manual refresh without another read', async () => {
  const {R}=setup();let notificationCalls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'});
  const notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:()=>{notificationCalls+=1;return new Promise(resolve=>{release=resolve;});}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();
  const manual=await boundary.recover('refresh');assert.equal(manual.reason,'recovery_in_progress');assert.equal(notificationCalls,1);
  release({status:200,body:currentRideView('passenger',{revision:9,status:'on_trip'})});assert.equal((await pending).processed,true);assert.equal(notificationCalls,1);
});
test('manual-first recovery rejects a notification without calling its reader', async () => {
  const {R}=setup();let reads=0,releaseManual,notificationCalls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:()=>{reads+=1;if(reads===1)throw Error('offline');return new Promise(resolve=>{releaseManual=resolve;});}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{notificationCalls+=1;return {status:500};}});
  const manual=boundary.recover('refresh');await Promise.resolve();await Promise.resolve();
  const notification=await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});assert.equal(notification.reason,'recovery_in_progress');assert.equal(notificationCalls,0);assert.equal(reads,2);
  releaseManual({status:204});assert.equal((await manual).recovered,true);
});
test('notification-first recovery coalesces a simultaneous online event', async () => {
  const {R}=setup();let startupReads=0,notificationCalls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>{startupReads+=1;throw Error('offline');}}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:()=>{notificationCalls+=1;return new Promise(resolve=>{release=resolve;});}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();fixture.target.dispatch('online');await fixture.bridges[0].bridge.idle();
  assert.equal(startupReads,1);assert.equal(notificationCalls,1);
  release({status:200,body:currentRideView('passenger',{revision:9,status:'on_trip'})});assert.equal((await pending).processed,true);assert.equal(startupReads,1);
});
test('a notification result arriving after a role switch cannot update the old role state', async () => {
  const {R}=setup();let release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:()=>new Promise(resolve=>{release=resolve;})});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();await boundary.navigate('driver-home','driver');
  release({status:200,body:currentRideView('passenger',{revision:9,status:'on_trip'})});const stale=await pending;
  assert.equal(stale.processed,false);assert.equal(stale.reason,'stale_recovery');assert.equal(notifications.snapshot().revision,8);assert.equal(boundary.snapshot().activeRole,'driver');assert.equal(boundary.snapshot().page,'driver-home');
});
test('newer hints during a notification read keep only the maximum revision and add one follow-up', async () => {
  const {R}=setup(),calls=[],releases=[];
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:hint=>{calls.push(hint);return new Promise(resolve=>releases.push(resolve));}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();
  assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:10})).reason,'notification_coalesced');
  assert.equal((await notifications.handle({type:'ride.access_changed',rideId:current.id,revision:12})).reason,'notification_coalesced');
  assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:11})).reason,'stale_or_duplicate_hint');
  assert.equal(notifications.snapshot().pendingRevision,12);assert.equal(calls.length,1);
  releases[0]({status:200,body:currentRideView('passenger',{revision:9,status:'arriving'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);assert.equal(calls[1].type,'ride.changed');assert.equal(calls[1].rideId,current.id);assert.equal(calls[1].revision,12);
  releases[1]({status:200,body:currentRideView('passenger',{revision:12,status:'on_trip'})});
  const recovered=await pending;
  assert.equal(recovered.processed,true);assert.equal(recovered.followup,true);assert.equal(calls.length,2);assert.equal(notifications.snapshot().revision,12);assert.equal(notifications.snapshot().pendingRevision,null);
});
test('a first notification read that already reaches the queued maximum sends no follow-up', async () => {
  const {R}=setup();let calls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:()=>{calls+=1;return new Promise(resolve=>{release=resolve;});}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:12});release({status:200,body:currentRideView('passenger',{revision:12,status:'on_trip'})});
  const recovered=await pending;
  assert.equal(recovered.processed,true);assert.equal(recovered.followup,false);assert.equal(calls,1);assert.equal(notifications.snapshot().revision,12);assert.equal(notifications.snapshot().pendingRevision,null);
});
test('a newer hint during the single follow-up is retained without starting a third read', async () => {
  const {R}=setup(),releases=[];let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:()=>{calls+=1;return new Promise(resolve=>releases.push(resolve));}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:12});releases[0]({status:200,body:currentRideView('passenger',{revision:9,status:'arriving'})});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,2);assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:13})).reason,'notification_coalesced');
  releases[1]({status:200,body:currentRideView('passenger',{revision:12,status:'on_trip'})});
  const recovered=await pending;
  assert.equal(recovered.reason,'explicit_refresh_required');assert.equal(recovered.followup,true);assert.equal(calls,2);assert.equal(notifications.snapshot().revision,12);assert.equal(notifications.snapshot().pendingRevision,13);
});
test('invalid and foreign hints are not queued behind a notification read', async () => {
  const {R}=setup();let calls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:()=>{calls+=1;return new Promise(resolve=>{release=resolve;});}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();
  assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:10,fare:20})).reason,'invalid_hint');
  assert.equal((await notifications.handle({type:'ride.changed',rideId:'another-ride',revision:11})).reason,'foreign_hint');
  assert.equal(notifications.snapshot().pendingRevision,null);assert.equal(calls,1);
  release({status:200,body:currentRideView('driver',{revision:9,status:'arriving'})});await pending;assert.equal(calls,1);
});
test('role switching discards a queued maximum revision without a follow-up read', async () => {
  const {R}=setup();let calls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:()=>{calls+=1;return new Promise(resolve=>{release=resolve;});}});
  const pending=notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await Promise.resolve();await Promise.resolve();
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:12});await boundary.navigate('driver-home','driver');
  release({status:200,body:currentRideView('passenger',{revision:9,status:'arriving'})});const stale=await pending;
  assert.equal(stale.reason,'stale_recovery');assert.equal(calls,1);assert.equal(notifications.snapshot().revision,8);assert.equal(notifications.snapshot().pendingRevision,null);
});
test('passenger UI locks after the bounded follow-up misses the notified revision', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return {status:304};}});
  const result=await notifications.handle({type:'ride.changed',rideId:current.id,revision:9}),state=notifications.snapshot();
  assert.equal(result.reason,'explicit_refresh_required');assert.equal(calls,2);assert.equal(state.needsRefresh,true);assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.match(state.feedback.title,/дѕќй ј/);assert.match(state.feedback.message,/жњЂж–°зЉ¶ж…‹г‚’зўєиЄЌгЃ™г‚‹/);
});
test('driver UI uses operation wording when notification recovery remains behind', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return {status:200,body:currentRideView('driver',{revision:8,status:'assigned'})};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:10});const state=notifications.snapshot();
  assert.equal(calls,2);assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.match(state.feedback.title,/йЃ‹иЎЊ/);assert.equal(state.pendingRevision,10);
});
test('explicit latest-state refresh catches the retained maximum and unlocks commands', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async hint=>{calls+=1;return calls<3?{status:304}:{status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});
  assert.equal((await notifications.handle({type:'ride.changed',rideId:current.id,revision:12})).reason,'explicit_refresh_required');assert.equal(calls,2);assert.equal(notifications.snapshot().pendingRevision,12);
  const refreshed=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(refreshed.processed,true);assert.equal(refreshed.manual,true);assert.equal(calls,3);assert.equal(state.revision,12);assert.equal(state.pendingRevision,null);assert.equal(state.needsRefresh,false);assert.equal(state.commandsLocked,false);assert.equal(state.action,null);
});
test('an explicit refresh that is still behind stays locked without an automatic loop', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return {status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:11});const refreshed=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(refreshed.reason,'explicit_refresh_required');assert.equal(calls,3);assert.equal(state.commandsLocked,true);assert.equal(state.pendingRevision,11);assert.equal(state.action,'refresh');
});
test('role exit clears a locked notification target and rejects its explicit refresh', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return {status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});assert.equal(notifications.snapshot().commandsLocked,true);
  await boundary.navigate('driver-home','driver');const rejected=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(rejected.reason,'inactive_role');assert.equal(calls,2);assert.equal(state.pendingRevision,null);assert.equal(state.needsRefresh,false);assert.equal(state.commandsLocked,false);
});
test('a network failure during explicit refresh keeps the passenger request safely locked', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;if(calls===3)throw Error('offline');return {status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});const failed=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(failed.reason,'connectivity_required');assert.equal(calls,3);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.equal(state.pendingRevision,9);assert.match(state.feedback.title,/дѕќй ј/);assert.match(state.feedback.message,/йЂљдїЎ/);
});
test('a 503 explicit refresh keeps the driver operation locked without retrying', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:503}:{status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:10});const failed=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(failed.reason,'connectivity_required');assert.equal(calls,3);assert.equal(state.commandsLocked,true);assert.equal(state.pendingRevision,10);assert.match(state.feedback.title,/йЃ‹иЎЊ/);
});
test('401 and 403 explicit refreshes clear cached state and require reauthentication', async () => {
  for(const status of [401,403]){
    const {R}=setup();let calls=0;
    const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
    const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status}:{status:304};}});
    await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});const failed=await notifications.refresh(),state=notifications.snapshot();
    assert.equal(failed.reason,'reauthentication_required');assert.equal(calls,3);assert.equal(state.hasRide,false);assert.equal(state.guidance,'reauth');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reauth');assert.equal(state.pendingRevision,null);assert.match(state.feedback.message,/дѕќй ј/);
  }
});
test('a 404 explicit refresh clears the stale ride and returns to an unlocked empty state', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:404}:{status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});const empty=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(empty.reason,'ride_not_found');assert.equal(calls,3);assert.equal(state.hasRide,false);assert.equal(state.guidance,'empty');assert.equal(state.commandsLocked,false);assert.equal(state.action,null);assert.equal(state.pendingRevision,null);assert.match(state.feedback.title,/йЃ‹иЎЊ/);
});
test('new hints after a connectivity failure update only the retained maximum', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:503}:{status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});await notifications.refresh();
  const queued=await notifications.handle({type:'ride.changed',rideId:current.id,revision:12}),state=notifications.snapshot();
  assert.equal(queued.reason,'explicit_refresh_required');assert.equal(calls,3);assert.equal(state.pendingRevision,12);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);
});
test('notification recovery feedback is applied to the existing passenger command banner', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return {status:304};}}),commandUi=R.createCommandUiController('passenger'),flow=R.createNotificationFeedbackFlow({role:'passenger',recovery,commandUi});
  const result=await flow.handle({type:'ride.changed',rideId:current.id,revision:9}),view=commandUi.snapshot();
  assert.equal(result.processed,true);assert.equal(calls,2);assert.equal(view.outcome,'unresolved');assert.equal(view.action,'refresh');assert.equal(view.disableCommands,true);assert.match(view.title,/дѕќй ј/);assert.match(view.message,/жњЂж–°зЉ¶ж…‹г‚’зўєиЄЌгЃ™г‚‹/);
});
test('notification feedback allows one explicit refresh and rejects a double tap', async () => {
  const {R}=setup();let calls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async hint=>{calls+=1;if(calls<3)return {status:304};return new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})});});}}),commandUi=R.createCommandUiController('passenger'),flow=R.createNotificationFeedbackFlow({role:'passenger',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const first=flow.trigger('refresh');await Promise.resolve();
  const duplicate=await flow.trigger('refresh');assert.equal(duplicate.reason,'action_in_progress');assert.equal(calls,3);assert.equal(commandUi.snapshot().disableCommands,true);
  release();const completed=await first;assert.equal(completed.processed,true);assert.equal(commandUi.snapshot().disableCommands,false);assert.equal(commandUi.snapshot().action,null);assert.equal(calls,3);
});
test('a role switch prevents delayed notification feedback from overwriting the new role', async () => {
  const {R}=setup();let calls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async hint=>{calls+=1;if(calls<3)return {status:304};return new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})});});}}),commandUi=R.createCommandUiController('passenger'),flow=R.createNotificationFeedbackFlow({role:'passenger',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const pending=flow.trigger('refresh');await Promise.resolve();commandUi.setRole('driver');release();const stale=await pending,view=commandUi.snapshot();
  assert.equal(stale.reason,'stale_role_generation');assert.equal(view.role,'driver');assert.equal(view.outcome,'idle');assert.equal(view.disableCommands,false);
});
test('reauthentication feedback invokes the role action once and blocks duplicate activation', async () => {
  const {R}=setup();let calls=0,reauthCalls=0,release;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:401}:{status:304};}}),commandUi=R.createCommandUiController('driver'),flow=R.createNotificationFeedbackFlow({role:'driver',recovery,commandUi,onReauthenticate:()=>{reauthCalls+=1;return new Promise(resolve=>{release=resolve;});}});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});await flow.trigger('refresh');assert.equal(commandUi.snapshot().action,'reauth');assert.match(commandUi.snapshot().message,/йЃ‹иЎЊ/);
  const first=flow.trigger('reauth');await Promise.resolve();const duplicate=await flow.trigger('reauth');assert.equal(duplicate.reason,'action_in_progress');assert.equal(reauthCalls,1);release({requested:true});await first;assert.equal(reauthCalls,1);assert.equal(commandUi.snapshot().action,'reauth');
});
test('a not-found explicit refresh updates the shared driver banner to an unlocked empty state', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:404}:{status:304};}}),commandUi=R.createCommandUiController('driver'),flow=R.createNotificationFeedbackFlow({role:'driver',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const empty=await flow.trigger('refresh'),view=commandUi.snapshot();
  assert.equal(empty.processed,true);assert.equal(calls,3);assert.equal(view.outcome,'confirmed');assert.equal(view.disableCommands,false);assert.equal(view.action,null);assert.match(view.title,/йЃ‹иЎЊ/);assert.match(view.message,/йЃ‹и»ўж‰‹гѓ›гѓјгѓ /);
});
test('notification feedback button bridge attaches one click listener and removes it on role exit', async () => {
  const {R}=setup(),target=recoveryEventTarget(),renders=[];
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>({status:304})}),commandUi=R.createCommandUiController('passenger'),flow=R.createNotificationFeedbackFlow({role:'passenger',recovery,commandUi}),bridge=R.createNotificationFeedbackEventBridge({flow,eventTarget:target,render:view=>renders.push(view)});
  assert.equal(bridge.attach().started,true);assert.equal(bridge.attach().reason,'already_attached');assert.equal(target.listenerCount('click'),1);assert.equal(target.addCount('click'),1);assert.equal(renders.length,1);
  bridge.detach();assert.equal(target.listenerCount('click'),0);assert.equal(bridge.snapshot().detached,true);target.dispatch('click');assert.equal(renders.length,1);
});
test('a double click on the notification refresh button starts one read only', async () => {
  const {R}=setup();let calls=0,release;const target=recoveryEventTarget(),renders=[];
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async hint=>{calls+=1;if(calls<3)return {status:304};return new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})});});}}),commandUi=R.createCommandUiController('passenger'),flow=R.createNotificationFeedbackFlow({role:'passenger',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const bridge=R.createNotificationFeedbackEventBridge({flow,eventTarget:target,render:view=>renders.push(view)});bridge.attach();
  const first=bridge.activate();await Promise.resolve();const duplicate=await bridge.activate();assert.equal(duplicate.reason,'action_in_progress');assert.equal(calls,3);release();const completed=await first;
  assert.equal(completed.processed,true);assert.equal(calls,3);assert.equal(commandUi.snapshot().disableCommands,false);assert.ok(renders.some(view=>view.outcome==='pending'));assert.equal(renders.at(-1).action,null);
});
test('detaching the notification button during a read drops its delayed render', async () => {
  const {R}=setup();let calls=0,release;const target=recoveryEventTarget(),renders=[];
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async hint=>{calls+=1;if(calls<3)return {status:304};return new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('driver',{revision:hint.revision,status:'arriving'})});});}}),commandUi=R.createCommandUiController('driver'),flow=R.createNotificationFeedbackFlow({role:'driver',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const bridge=R.createNotificationFeedbackEventBridge({flow,eventTarget:target,render:view=>renders.push(view)});bridge.attach();const pending=bridge.activate();await Promise.resolve();const before=renders.length;bridge.detach();release();const stale=await pending;
  assert.equal(stale.reason,'bridge_stale');assert.equal(renders.length,before);assert.equal(target.listenerCount('click'),0);assert.equal(calls,3);
});
test('an old notification button cannot act after the command UI switches role', async () => {
  const {R}=setup();let calls=0;const target=recoveryEventTarget();
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
  const current=currentRideView('passenger',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return {status:304};}}),commandUi=R.createCommandUiController('passenger'),flow=R.createNotificationFeedbackFlow({role:'passenger',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const bridge=R.createNotificationFeedbackEventBridge({flow,eventTarget:target,render:()=>{}});bridge.attach();commandUi.setRole('driver');const rejected=await bridge.activate();
  assert.equal(rejected.reason,'action_not_available');assert.equal(calls,2);assert.equal(commandUi.snapshot().role,'driver');assert.equal(commandUi.snapshot().outcome,'idle');
});
test('the reauthentication button event is single-flight and remains locked until a new session', async () => {
  const {R}=setup();let calls=0,reauthCalls=0,release;const target=recoveryEventTarget();
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:403}:{status:304};}}),commandUi=R.createCommandUiController('driver'),flow=R.createNotificationFeedbackFlow({role:'driver',recovery,commandUi,onReauthenticate:()=>{reauthCalls+=1;return new Promise(resolve=>{release=resolve;});}});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});await flow.trigger('refresh');const bridge=R.createNotificationFeedbackEventBridge({flow,eventTarget:target,render:()=>{}});bridge.attach();const first=bridge.activate();await Promise.resolve();const duplicate=await bridge.activate();
  assert.equal(duplicate.reason,'action_in_progress');assert.equal(reauthCalls,1);release({requested:true});await first;assert.equal(reauthCalls,1);assert.equal(commandUi.snapshot().action,'reauth');assert.equal(commandUi.snapshot().disableCommands,true);
});
test('role entry owns one notification feedback bridge without duplicate attachment', async () => {
  const {R}=setup(),fixture=roleFeedbackLifecycleFixture(R);
  assert.equal((await fixture.lifecycle.enter('passenger')).entered,true);assert.equal((await fixture.lifecycle.enter('passenger')).reason,'already_entered');
  assert.equal(fixture.feedbacks.length,1);assert.deepEqual(fixture.events,['attach:passenger:1']);assert.equal(fixture.feedbacks[0].target.listenerCount('click'),1);assert.equal(fixture.feedbacks[0].target.addCount('click'),1);
});
test('leaving a role detaches its notification button before later clicks can act', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('passenger');const first=fixture.feedbacks[0];await first.flow.handle({type:'ride.changed',rideId:first.current.id,revision:9});assert.equal(first.commandUi.snapshot().action,'refresh');const before=reads;
  fixture.lifecycle.leave();assert.equal(first.target.listenerCount('click'),0);first.target.dispatch('click');await first.bridge.idle();
  assert.equal(reads,before);assert.equal(first.inner.snapshot().detached,true);assert.equal((await first.inner.activate()).reason,'bridge_inactive');
});
test('role switching detaches the old notification bridge before attaching the new one', async () => {
  const {R}=setup(),fixture=roleFeedbackLifecycleFixture(R);
  await fixture.lifecycle.enter('passenger');await fixture.lifecycle.enter('driver');
  assert.deepEqual(fixture.events,['attach:passenger:1','detach:passenger:1','attach:driver:2']);assert.equal(fixture.feedbacks[0].target.listenerCount('click'),0);assert.equal(fixture.feedbacks[1].target.listenerCount('click'),1);assert.equal(fixture.lifecycle.snapshot().activeRole,'driver');
});
test('re-entering the same role creates a fresh notification button generation', async () => {
  const {R}=setup(),fixture=roleFeedbackLifecycleFixture(R);
  await fixture.lifecycle.enter('driver');const first=fixture.feedbacks[0];fixture.lifecycle.leave();await fixture.lifecycle.enter('driver');const second=fixture.feedbacks[1];
  assert.notEqual(first.inner,second.inner);assert.equal(first.generation+1,second.generation);assert.equal(first.target.listenerCount('click'),0);assert.equal(second.target.listenerCount('click'),1);assert.equal((await first.inner.activate()).reason,'bridge_inactive');
});
test('a delayed old notification action cannot render into a switched role generation', async () => {
  const {R}=setup();let oldCalls=0,release;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:({role,hint})=>{
    if(role!=='passenger')return Promise.resolve({status:304});oldCalls+=1;if(oldCalls<3)return Promise.resolve({status:304});return new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})});});
  }});
  await fixture.lifecycle.enter('passenger');const old=fixture.feedbacks[0];await old.flow.handle({type:'ride.changed',rideId:old.current.id,revision:9});const pending=old.inner.activate();await Promise.resolve();const oldRenderCount=old.renders.length;
  await fixture.lifecycle.enter('driver');const current=fixture.feedbacks[1];release();const result=await pending;await old.inner.idle();
  assert.equal(result.reason,'bridge_stale');assert.equal(old.renders.length,oldRenderCount);assert.equal(current.commandUi.snapshot().role,'driver');assert.equal(current.commandUi.snapshot().outcome,'idle');assert.equal(current.target.listenerCount('click'),1);
});
test('the active role generation accepts a notification hint through its owned bridge', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async({role,hint})=>{reads+=1;return {status:200,body:currentRideView(role,{revision:hint.revision,status:'assigned'})};}});
  await fixture.lifecycle.enter('passenger');const generation=fixture.lifecycle.snapshot().generation,current=fixture.feedbacks[0].current;
  const result=await fixture.lifecycle.handleNotification({role:'passenger',generation,hint:{type:'ride.changed',rideId:current.id,revision:9}});
  assert.equal(result.processed,true);assert.equal(reads,1);assert.equal(fixture.feedbacks[0].recovery.snapshot().revision,9);assert.equal(fixture.feedbacks[0].commandUi.snapshot().role,'passenger');
});
test('cross-role and stale-generation notification hints stop before feedback or reads', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('passenger');const generation=fixture.lifecycle.snapshot().generation,current=fixture.feedbacks[0].current,hint={type:'ride.changed',rideId:current.id,revision:9};
  assert.equal((await fixture.lifecycle.handleNotification({role:'driver',generation,hint})).reason,'stale_role_generation');assert.equal((await fixture.lifecycle.handleNotification({role:'passenger',generation:generation+1,hint})).reason,'stale_role_generation');assert.equal(reads,0);assert.equal(fixture.feedbacks[0].inner.snapshot().handledEvents,0);
});
test('notification hints after role exit stop before the detached bridge', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('driver');const generation=fixture.lifecycle.snapshot().generation,current=fixture.feedbacks[0].current;fixture.lifecycle.leave();
  const result=await fixture.lifecycle.handleNotification({role:'driver',generation,hint:{type:'ride.changed',rideId:current.id,revision:9}});
  assert.equal(result.reason,'not_entered');assert.equal(reads,0);assert.equal(fixture.feedbacks[0].inner.snapshot().handledEvents,0);
});
test('same-role re-entry accepts only the fresh notification generation', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async({role,hint})=>{reads+=1;return {status:200,body:currentRideView(role,{revision:hint.revision,status:'assigned'})};}});
  await fixture.lifecycle.enter('passenger');const old=fixture.feedbacks[0];fixture.lifecycle.leave();await fixture.lifecycle.enter('passenger');const fresh=fixture.feedbacks[1],hint={type:'ride.changed',rideId:fresh.current.id,revision:9};
  assert.equal((await fixture.lifecycle.handleNotification({role:'passenger',generation:old.generation,hint})).reason,'stale_role_generation');assert.equal(reads,0);
  assert.equal((await fixture.lifecycle.handleNotification({role:'passenger',generation:fresh.generation,hint})).processed,true);assert.equal(reads,1);assert.equal(old.inner.snapshot().handledEvents,0);assert.equal(fresh.inner.snapshot().handledEvents,1);
});
test('a delayed notification hint from a departed role cannot render into the new role', async () => {
  const {R}=setup();let release;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:({role,hint})=>role==='passenger'?new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})});}):Promise.resolve({status:304})});
  await fixture.lifecycle.enter('passenger');const old=fixture.feedbacks[0],pending=fixture.lifecycle.handleNotification({role:'passenger',generation:old.generation,hint:{type:'ride.changed',rideId:old.current.id,revision:9}});await Promise.resolve();await Promise.resolve();const oldRenderCount=old.renders.length;
  await fixture.lifecycle.enter('driver');const current=fixture.feedbacks[1];release();const result=await pending;await old.inner.idle();
  assert.equal(result.reason,'stale_notification');assert.equal(old.renders.length,oldRenderCount);assert.equal(current.commandUi.snapshot().role,'driver');assert.equal(current.commandUi.snapshot().outcome,'idle');assert.equal(current.inner.snapshot().handledEvents,0);
});
test('role entry binds one notification listener without caller role or generation', async () => {
  const {R}=setup();let seen;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async input=>{seen=input;return {status:304};}});
  await fixture.lifecycle.enter('passenger');assert.equal((await fixture.lifecycle.enter('passenger')).reason,'already_entered');const current=fixture.feedbacks[0].current;
  fixture.notificationTarget.dispatch('notification',{role:'driver',generation:999,detail:{type:'ride.changed',rideId:current.id,revision:9}});await fixture.notificationBridges[0].inner.idle();
  assert.equal(fixture.notificationTarget.listenerCount('notification'),1);assert.equal(fixture.notificationTarget.addCount('notification'),1);assert.equal(seen.role,'passenger');assert.equal(seen.generation,1);assert.equal(seen.hint.revision,9);
});
test('role exit removes the bound notification listener before future events', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('driver');const current=fixture.feedbacks[0].current;fixture.lifecycle.leave();fixture.notificationTarget.dispatch('notification',{detail:{type:'ride.changed',rideId:current.id,revision:9}});await fixture.notificationBridges[0].inner.idle();
  assert.equal(fixture.notificationTarget.listenerCount('notification'),0);assert.equal(reads,0);assert.equal(fixture.notificationBridges[0].inner.snapshot().detached,true);
});
test('role switch replaces the bound notification listener with the current generation', async () => {
  const {R}=setup(),seen=[];const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async input=>{seen.push(input);return {status:304};}});
  await fixture.lifecycle.enter('passenger');const old=fixture.notificationBridges[0];await fixture.lifecycle.enter('driver');const fresh=fixture.notificationBridges[1],current=fixture.feedbacks[1].current;
  fixture.notificationTarget.dispatch('notification',{detail:{type:'ride.changed',rideId:current.id,revision:9}});await fresh.inner.idle();
  assert.equal(fixture.notificationTarget.listenerCount('notification'),1);assert.equal(fixture.notificationTarget.addCount('notification'),2);assert.equal(old.inner.snapshot().handledEvents,0);assert.equal(fresh.inner.snapshot().handledEvents,1);assert.deepEqual(seen.map(value=>[value.role,value.generation]),[['driver',2],['driver',2]]);
});
test('same-role re-entry does not reuse an old notification listener', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('passenger');const old=fixture.notificationBridges[0];fixture.lifecycle.leave();await fixture.lifecycle.enter('passenger');const fresh=fixture.notificationBridges[1],current=fixture.feedbacks[1].current;
  fixture.notificationTarget.dispatch('notification',{detail:{type:'ride.changed',rideId:current.id,revision:9}});await fresh.inner.idle();
  assert.notEqual(old.inner,fresh.inner);assert.equal(old.inner.snapshot().detached,true);assert.equal(old.inner.snapshot().handledEvents,0);assert.equal(fresh.inner.snapshot().handledEvents,1);assert.equal(reads,2);
});
test('a delayed notification event cannot update after its listener generation is replaced', async () => {
  const {R}=setup();let release;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:({role,hint})=>role==='passenger'?new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView('passenger',{revision:hint.revision,status:'on_trip'})});}):Promise.resolve({status:304})});
  await fixture.lifecycle.enter('passenger');const oldNotification=fixture.notificationBridges[0],oldFeedback=fixture.feedbacks[0],hint={type:'ride.changed',rideId:oldFeedback.current.id,revision:9},pending=oldNotification.inner.receive(hint);await Promise.resolve();await Promise.resolve();const oldRenderCount=oldFeedback.renders.length;
  await fixture.lifecycle.enter('driver');const current=fixture.feedbacks[1];release();const result=await pending;await oldNotification.inner.idle();await oldFeedback.inner.idle();
  assert.equal(result.reason,'bridge_stale');assert.equal(oldFeedback.renders.length,oldRenderCount);assert.equal(current.commandUi.snapshot().role,'driver');assert.equal(current.commandUi.snapshot().outcome,'idle');assert.equal(fixture.notificationTarget.listenerCount('notification'),1);
});
test('an authenticated session binding stays private and duplicate entry does not resubscribe', async () => {
  const {R}=setup(),sessionBinding=Object.freeze({accountRef:'private-passenger-a'}),fixture=roleFeedbackLifecycleFixture(R);
  await fixture.lifecycle.enter('passenger',{sessionBinding});const duplicate=await fixture.lifecycle.enter('passenger',{sessionBinding});
  assert.equal(duplicate.reason,'already_entered');assert.equal(fixture.notificationBridges.length,1);assert.equal(fixture.notificationBridges[0].sessionBinding,sessionBinding);assert.equal(fixture.notificationTarget.addCount('notification'),1);
  assert.deepEqual(Object.keys(fixture.lifecycle.snapshot()).sort(),['activeRole','busy','entered','generation','lastAction']);assert.deepEqual(Object.keys(fixture.notificationBridges[0].inner.snapshot()).sort(),['attached','busy','detached','handledEvents','lastEvent']);
});
test('same-role account switch replaces the notification subscription generation', async () => {
  const {R}=setup(),firstSession={},secondSession={},fixture=roleFeedbackLifecycleFixture(R);
  await fixture.lifecycle.enter('driver',{sessionBinding:firstSession});const old=fixture.notificationBridges[0];await fixture.lifecycle.enter('driver',{sessionBinding:secondSession});const fresh=fixture.notificationBridges[1];
  assert.equal(old.inner.snapshot().detached,true);assert.equal(fresh.sessionBinding,secondSession);assert.equal(old.generation+1,fresh.generation);assert.equal(fixture.notificationTarget.listenerCount('notification'),1);assert.equal(fixture.notificationTarget.addCount('notification'),2);
});
test('an old account subscription cannot process another hint after same-role switch', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});const old=fixture.notificationBridges[0],hint={type:'ride.changed',rideId:fixture.feedbacks[0].current.id,revision:9};await fixture.lifecycle.enter('passenger',{sessionBinding:{account:2}});
  assert.equal((await old.inner.receive(hint)).reason,'bridge_inactive');assert.equal(reads,0);assert.equal(old.inner.snapshot().handledEvents,0);assert.equal(fixture.lifecycle.snapshot().generation,2);
});
test('logout removes the session notification subscription before later events', async () => {
  const {R}=setup();let reads=0;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};}});
  await fixture.lifecycle.enter('driver',{sessionBinding:{account:'driver-a'}});const current=fixture.feedbacks[0].current;fixture.lifecycle.leave();fixture.notificationTarget.dispatch('notification',{detail:{type:'ride.changed',rideId:current.id,revision:9}});await fixture.notificationBridges[0].inner.idle();
  assert.equal(fixture.notificationTarget.listenerCount('notification'),0);assert.equal(reads,0);assert.equal(fixture.lifecycle.snapshot().activeRole,null);assert.equal(fixture.notificationBridges[0].inner.snapshot().detached,true);
});
test('a delayed old-account notification result cannot update the replacement session', async () => {
  const {R}=setup();let release;const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:({generation,role,hint})=>generation===1?new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView(role,{revision:hint.revision,status:'on_trip'})});}):Promise.resolve({status:304})});
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});const oldNotification=fixture.notificationBridges[0],oldFeedback=fixture.feedbacks[0],pending=oldNotification.inner.receive({type:'ride.changed',rideId:oldFeedback.current.id,revision:9});await Promise.resolve();await Promise.resolve();const oldRenderCount=oldFeedback.renders.length;
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:2}});const current=fixture.feedbacks[1];release();const result=await pending;await oldNotification.inner.idle();await oldFeedback.inner.idle();
  assert.equal(result.reason,'bridge_stale');assert.equal(oldFeedback.renders.length,oldRenderCount);assert.equal(current.commandUi.snapshot().outcome,'idle');assert.equal(current.inner.snapshot().handledEvents,0);assert.equal(fixture.notificationTarget.listenerCount('notification'),1);
});
test('async notification subscription starts once and connects without exposing session data', async () => {
  const {R}=setup(),sessionBinding={accountRef:'private-passenger-a'};let subscriptions=0,connect,signal;
  const fixture=roleFeedbackLifecycleFixture(R,{notificationSubscribe:input=>{subscriptions+=1;signal=input.signal;return new Promise(resolve=>{connect=()=>resolve(()=>{});});}});
  await fixture.lifecycle.enter('passenger',{sessionBinding});const duplicate=await fixture.lifecycle.enter('passenger',{sessionBinding}),bridge=fixture.notificationBridges[0].inner;
  assert.equal(duplicate.reason,'already_entered');assert.equal(subscriptions,1);assert.equal(signal.aborted,false);assert.equal(bridge.snapshot().connected,false);
  connect();await bridge.idle();assert.equal(bridge.snapshot().connected,true);assert.deepEqual(Object.keys(bridge.snapshot()).sort(),['attached','busy','connected','detached','handledEvents','lastEvent']);
  for(const secret of ['sessionBinding','accountRef','signal','endpoint','token'])assert.equal(Object.prototype.hasOwnProperty.call(bridge.snapshot(),secret),false);
});
test('logout aborts a connecting notification subscription and cleans up a late success', async () => {
  const {R}=setup();let resolveConnection,signal,deliver,unsubscribes=0,reads=0;
  const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async()=>{reads+=1;return {status:304};},notificationSubscribe:input=>{signal=input.signal;deliver=input.onHint;return new Promise(resolve=>{resolveConnection=resolve;});}});
  await fixture.lifecycle.enter('driver',{sessionBinding:{account:'driver-a'}});const bridge=fixture.notificationBridges[0].inner,current=fixture.feedbacks[0].current;fixture.lifecycle.leave();
  assert.equal(signal.aborted,true);assert.equal(bridge.snapshot().detached,true);resolveConnection(()=>{unsubscribes+=1;});await bridge.idle();
  assert.equal(unsubscribes,1);assert.equal(bridge.snapshot().connected,false);assert.equal(bridge.snapshot().lastEvent,'detached');assert.equal((await deliver({type:'ride.changed',rideId:current.id,revision:9})).reason,'subscription_inactive');assert.equal(reads,0);
});
test('same-role account switch aborts the old async subscription before starting the new one', async () => {
  const {R}=setup(),records=[];
  const fixture=roleFeedbackLifecycleFixture(R,{notificationSubscribe:input=>new Promise(resolve=>records.push({...input,resolve,unsubscribes:0}))});
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});const old=fixture.notificationBridges[0].inner;await fixture.lifecycle.enter('passenger',{sessionBinding:{account:2}});const fresh=fixture.notificationBridges[1].inner;
  assert.equal(records.length,2);assert.equal(records[0].signal.aborted,true);assert.equal(records[1].signal.aborted,false);
  records[0].resolve(()=>{records[0].unsubscribes+=1;});await old.idle();records[1].resolve(()=>{records[1].unsubscribes+=1;});await fresh.idle();
  assert.equal(records[0].unsubscribes,1);assert.equal(records[1].unsubscribes,0);assert.equal(old.snapshot().connected,false);assert.equal(fresh.snapshot().connected,true);assert.equal(fixture.lifecycle.snapshot().generation,2);
});
test('late callback from an old async subscription cannot trigger an authorized read', async () => {
  const {R}=setup(),records=[];let reads=0;
  const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:async({role,hint})=>{reads+=1;return {status:200,body:currentRideView(role,{revision:hint.revision,status:'assigned'})};},notificationSubscribe:input=>new Promise(resolve=>records.push({...input,resolve}))});
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});const old=fixture.notificationBridges[0].inner,rideId=fixture.feedbacks[0].current.id;await fixture.lifecycle.enter('passenger',{sessionBinding:{account:2}});const fresh=fixture.notificationBridges[1].inner;
  records[0].resolve(()=>{});records[1].resolve(()=>{});await Promise.all([old.idle(),fresh.idle()]);
  assert.equal((await records[0].onHint({type:'ride.changed',rideId,revision:9})).reason,'subscription_inactive');assert.equal(reads,0);
  const current=await records[1].onHint({type:'ride.changed',rideId,revision:9});await fresh.idle();assert.equal(current.processed,true);assert.equal(reads,1);assert.equal(fixture.lifecycle.snapshot().generation,2);
});
test('notification read started by an async subscription becomes stale on account switch', async () => {
  const {R}=setup(),records=[];let release;
  const fixture=roleFeedbackLifecycleFixture(R,{notificationRead:({generation,role,hint})=>generation===1?new Promise(resolve=>{release=()=>resolve({status:200,body:currentRideView(role,{revision:hint.revision,status:'on_trip'})});}):Promise.resolve({status:304}),notificationSubscribe:input=>new Promise(resolve=>records.push({...input,resolve,unsubscribes:0}))});
  await fixture.lifecycle.enter('driver',{sessionBinding:{account:1}});const old=fixture.notificationBridges[0].inner,oldFeedback=fixture.feedbacks[0],rideId=oldFeedback.current.id;records[0].resolve(()=>{records[0].unsubscribes+=1;});await old.idle();
  const pending=records[0].onHint({type:'ride.changed',rideId,revision:9});await Promise.resolve();await Promise.resolve();const renderCount=oldFeedback.renders.length;
  await fixture.lifecycle.enter('driver',{sessionBinding:{account:2}});const fresh=fixture.notificationBridges[1].inner;records[1].resolve(()=>{records[1].unsubscribes+=1;});await fresh.idle();release();const result=await pending;await old.idle();await oldFeedback.inner.idle();
  assert.equal(result.reason,'bridge_stale');assert.equal(records[0].unsubscribes,1);assert.equal(oldFeedback.renders.length,renderCount);assert.equal(fresh.snapshot().connected,true);assert.equal(fixture.feedbacks[1].commandUi.snapshot().outcome,'idle');
});
test('initial subscription failure locks passenger commands and offers one explicit reconnect', async () => {
  const {R}=setup(),renders=[];let subscriptions=0;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'passenger',subscribe:async()=>{subscriptions+=1;throw Error('offline');},onHint:async()=>({processed:true}),verifyLatest:async()=>({verified:true}),render:value=>renders.push(value)});
  bridge.attach();await bridge.idle();const state=bridge.snapshot();
  assert.equal(subscriptions,1);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reconnect');assert.match(state.feedback.title,/дѕќй ј/);assert.equal(renders.at(-1).action,'reconnect');
  await Promise.resolve();await bridge.idle();assert.equal(subscriptions,1);
});
test('connected driver subscription disconnects into a role-specific lock without automatic retry', async () => {
  const {R}=setup();let subscriptions=0,disconnect,deliver,unsubscribes=0,reads=0;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'driver',subscribe:async input=>{subscriptions+=1;disconnect=input.onDisconnect;deliver=input.onHint;return()=>{unsubscribes+=1;};},onHint:async()=>{reads+=1;return {processed:true};},verifyLatest:async()=>({verified:true})});
  bridge.attach();await bridge.idle();assert.equal(bridge.snapshot().commandsLocked,false);disconnect();const state=bridge.snapshot();
  assert.equal(subscriptions,1);assert.equal(unsubscribes,1);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reconnect');assert.match(state.feedback.title,/йЃ‹иЎЊ/);
  assert.equal((await deliver({type:'ride.changed',rideId:'private',revision:9})).reason,'subscription_inactive');assert.equal(reads,0);await bridge.idle();assert.equal(subscriptions,1);
});
test('one explicit reconnect verifies the latest authorized state before unlocking', async () => {
  const {R}=setup();let subscriptions=0,disconnect,verifyResolve,verifications=0;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'passenger',subscribe:async input=>{subscriptions+=1;disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:()=>{verifications+=1;return new Promise(resolve=>{verifyResolve=resolve;});}});
  bridge.attach();await bridge.idle();disconnect();const reconnecting=bridge.reconnect(),duplicate=await bridge.reconnect();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(duplicate.reason,'action_in_progress');assert.equal(subscriptions,2);assert.equal(verifications,1);assert.equal(bridge.snapshot().guidance,'verifying');assert.equal(bridge.snapshot().commandsLocked,true);
  verifyResolve({verified:true});const result=await reconnecting;assert.equal(result.reconnected,true);assert.equal(bridge.snapshot().guidance,'connected');assert.equal(bridge.snapshot().commandsLocked,false);assert.equal(bridge.snapshot().reconnects,1);
});
test('network, status 0, 429 and 5xx after reconnect offer one explicit latest-state refresh', async () => {
  const {R}=setup(),failures=[()=>{throw Error('offline');},()=>({status:0}),()=>({status:429}),()=>({status:503})];
  for(const failure of failures){
    let disconnect,verifications=0;const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'passenger',subscribe:async input=>{disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:async()=>{verifications+=1;return verifications===1?failure():{verified:true};}});
    bridge.attach();await bridge.idle();disconnect();const reconnect=await bridge.reconnect(),state=bridge.snapshot();
    assert.equal(reconnect.reason,'connectivity_required');assert.equal(state.connected,true);assert.equal(state.guidance,'verification_connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.match(state.feedback.title,/дѕќй ј/);assert.equal(verifications,1);
    const refreshing=bridge.refresh(),duplicate=await bridge.refresh();assert.equal(duplicate.reason,'action_in_progress');const refreshed=await refreshing;
    assert.equal(refreshed.reason,'verification_refreshed');assert.equal(bridge.snapshot().commandsLocked,false);assert.equal(bridge.snapshot().guidance,'connected');assert.equal(verifications,2);assert.equal((await bridge.refresh()).reason,'refresh_unavailable');
  }
});
test('401 and 403 after reconnect require role-specific reauthentication without retry', async () => {
  const {R}=setup();
  for(const [role,status,subject] of [['passenger',401,'дѕќй ј'],['driver',403,'йЃ‹иЎЊ']]){
    let disconnect,verifications=0;const bridge=R.createRecoverableNotificationSubscriptionBridge({role,subscribe:async input=>{disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:async()=>{verifications+=1;return {status};}});
    bridge.attach();await bridge.idle();disconnect();const result=await bridge.reconnect(),state=bridge.snapshot();
    assert.equal(result.reason,'reauthentication_required');assert.equal(state.guidance,'reauth');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reauth');assert.match(state.feedback.message,new RegExp(subject));assert.equal(verifications,1);await bridge.idle();assert.equal(verifications,1);assert.equal((await bridge.refresh()).reason,'refresh_unavailable');
  }
});
test('404 after reconnect clears the role lock into a safe empty state', async () => {
  const {R}=setup();let disconnect;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'driver',subscribe:async input=>{disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:async()=>({status:404})});
  bridge.attach();await bridge.idle();disconnect();const result=await bridge.reconnect(),state=bridge.snapshot();
  assert.equal(result.reason,'ride_not_found');assert.equal(state.connected,true);assert.equal(state.guidance,'empty');assert.equal(state.commandsLocked,false);assert.equal(state.action,null);assert.match(state.feedback.title,/йЃ‹иЎЊ/);assert.equal(state.feedback.disableCommands,false);
});
test('unexpected reconnect verification stays locked without leaking its response', async () => {
  const {R}=setup();let disconnect;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'passenger',subscribe:async input=>{disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:async()=>({status:200,body:{token:'private',rideId:'private'}})});
  bridge.attach();await bridge.idle();disconnect();const result=await bridge.reconnect(),state=bridge.snapshot();
  assert.equal(result.reason,'verification_failed');assert.equal(state.guidance,'retry_failed');assert.equal(state.commandsLocked,true);assert.equal(state.action,null);for(const secret of ['body','token','rideId','response'])assert.equal(JSON.stringify(state).includes(secret),false);
});
test('failed explicit reconnect stops without an automatic connection loop', async () => {
  const {R}=setup();let subscriptions=0;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'driver',subscribe:async()=>{subscriptions+=1;throw Error('offline');},onHint:async()=>({processed:true}),verifyLatest:async()=>({verified:true})});
  bridge.attach();await bridge.idle();const failed=await bridge.reconnect();await bridge.idle();
  assert.equal(failed.reason,'reconnect_failed');assert.equal(subscriptions,2);assert.equal(bridge.snapshot().guidance,'retry_failed');assert.equal(bridge.snapshot().commandsLocked,true);assert.equal(bridge.snapshot().action,null);
  assert.equal((await bridge.reconnect()).reason,'reconnect_unavailable');await Promise.resolve();assert.equal(subscriptions,2);
});
test('logout during reconnect cleans up a late connection without verifying or exposing private fields', async () => {
  const {R}=setup(),records=[];let verifications=0;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'passenger',subscribe:input=>new Promise(resolve=>records.push({...input,resolve,unsubscribes:0})),onHint:async()=>({processed:true}),verifyLatest:async()=>{verifications+=1;return {verified:true};}});
  bridge.attach();records[0].resolve(()=>{records[0].unsubscribes+=1;});await bridge.idle();records[0].onDisconnect();const reconnecting=bridge.reconnect();assert.equal(records[1].signal.aborted,false);bridge.detach();assert.equal(records[1].signal.aborted,true);
  records[1].resolve(()=>{records[1].unsubscribes+=1;});const result=await reconnecting;await bridge.idle();const state=bridge.snapshot();
  assert.equal(result.reason,'subscription_stale');assert.equal(records[1].unsubscribes,1);assert.equal(verifications,0);assert.equal(state.detached,true);assert.equal(state.action,null);assert.equal(state.commandsLocked,false);
  assert.deepEqual(Object.keys(state).sort(),['action','attached','busy','commandsLocked','connected','detached','feedback','guidance','lastEvent','reconnects']);for(const secret of ['sessionBinding','accountRef','signal','endpoint','token','hint','response'])assert.equal(Object.prototype.hasOwnProperty.call(state,secret),false);
});
test('role lifecycle owns one notification subscription bridge per active generation', async () => {
  const {R}=setup(),fixture=roleSubscriptionLifecycleFixture(R);
  const entered=await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});await fixture.lifecycle.idle();
  assert.equal(entered.entered,true);assert.equal(fixture.subscriptions.length,1);assert.equal(fixture.subscriptions[0].connects,1);assert.equal(fixture.subscriptions[0].bridge.snapshot().connected,true);
  assert.equal((await fixture.lifecycle.enter('passenger',{sessionBinding:fixture.subscriptions[0].sessionBinding})).reason,'already_entered');assert.equal(fixture.subscriptions.length,1);
  assert.deepEqual(Object.keys(fixture.lifecycle.snapshot()).sort(),['activeRole','busy','entered','generation','lastAction']);
});
test('current role generation alone can reconnect and explicitly refresh verification', async () => {
  const {R}=setup();let verifications=0;
  const fixture=roleSubscriptionLifecycleFixture(R,{verifyLatest:async()=>{verifications+=1;return verifications===1?{status:503}:{verified:true};}});
  await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const generation=fixture.lifecycle.snapshot().generation,record=fixture.subscriptions[0];record.disconnect();
  const reconnecting=fixture.lifecycle.handleSubscriptionAction({role:'passenger',generation,action:'reconnect'}),duplicate=await fixture.lifecycle.handleSubscriptionAction({role:'passenger',generation,action:'reconnect'});assert.equal(duplicate.reason,'recovery_in_progress');
  const reconnect=await reconnecting;assert.equal(reconnect.reason,'connectivity_required');assert.equal(record.connects,2);assert.equal(record.bridge.snapshot().action,'refresh');
  assert.equal((await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation,action:'refresh'})).reason,'stale_role_generation');
  const refreshing=fixture.lifecycle.handleSubscriptionAction({role:'passenger',generation,action:'refresh'}),doubleRefresh=await fixture.lifecycle.handleSubscriptionAction({role:'passenger',generation,action:'refresh'});assert.equal(doubleRefresh.reason,'recovery_in_progress');
  const refreshed=await refreshing;assert.equal(refreshed.reason,'verification_refreshed');assert.equal(record.bridge.snapshot().commandsLocked,false);assert.equal(verifications,2);
});
test('role switch invalidates an in-flight reauthentication action and keeps the new role isolated', async () => {
  const {R}=setup();let release,reauthCalls=0;
  const fixture=roleSubscriptionLifecycleFixture(R,{verifyLatest:async()=>({status:401}),onReauthenticate:()=>{reauthCalls+=1;return new Promise(resolve=>{release=resolve;});}});
  await fixture.lifecycle.enter('driver',{sessionBinding:{account:'driver-a'}});await fixture.lifecycle.idle();const oldGeneration=fixture.lifecycle.snapshot().generation,old=fixture.subscriptions[0];old.disconnect();
  const reconnect=await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation:oldGeneration,action:'reconnect'});assert.equal(reconnect.reason,'reauthentication_required');
  const pending=fixture.lifecycle.handleSubscriptionAction({role:'driver',generation:oldGeneration,action:'reauth'});await Promise.resolve();assert.equal(reauthCalls,1);assert.equal((await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation:oldGeneration,action:'reauth'})).reason,'recovery_in_progress');
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:'passenger-b'}});const fresh=fixture.subscriptions[1];await fresh.bridge.idle();assert.equal(old.bridge.snapshot().detached,true);assert.equal(fresh.bridge.snapshot().guidance,'connected');
  release({requested:true});const result=await pending;assert.equal(result.reason,'stale_subscription_action');assert.equal(fresh.bridge.snapshot().commandsLocked,false);assert.equal(reauthCalls,1);
  assert.equal((await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation:oldGeneration,action:'reauth'})).reason,'stale_role_generation');
});
test('404 verification clears only the active role generation into its empty state', async () => {
  const {R}=setup(),fixture=roleSubscriptionLifecycleFixture(R,{verifyLatest:async()=>({status:404})});
  await fixture.lifecycle.enter('driver');await fixture.lifecycle.idle();const generation=fixture.lifecycle.snapshot().generation,record=fixture.subscriptions[0];record.disconnect();
  const result=await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation,action:'reconnect'}),state=record.bridge.snapshot();
  assert.equal(result.reason,'ride_not_found');assert.equal(state.guidance,'empty');assert.equal(state.commandsLocked,false);assert.equal(state.action,null);assert.match(state.feedback.title,/йЃ‹иЎЊ/);
  assert.equal((await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation,action:'reconnect'})).reason,'action_not_available');
});
test('subscription failure renders one reconnect action on the active role button', async () => {
  const {R}=setup(),fixture=roleSubscriptionFeedbackLifecycleFixture(R,{subscribe:async()=>{throw Error('offline');}});
  await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const record=fixture.subscriptions[0],view=record.commandUi.snapshot();
  assert.equal(record.target.listenerCount('click'),1);assert.equal(record.target.addCount('click'),1);assert.equal(view.outcome,'unresolved');assert.equal(view.action,'reconnect');assert.equal(view.disableCommands,true);assert.match(view.title,/дѕќй ј/);assert.equal(record.renders.at(-1).action,'reconnect');
  assert.deepEqual(Object.keys(record.bridge.snapshot()).sort(),['action','attached','busy','commandsLocked','detached','handledEvents','lastEvent']);for(const secret of ['sessionBinding','account','signal','endpoint','token','response'])assert.equal(Object.prototype.hasOwnProperty.call(record.bridge.snapshot(),secret),false);
  assert.equal((await fixture.lifecycle.enter('passenger')).reason,'already_entered');assert.equal(fixture.subscriptions.length,1);assert.equal(record.connects,1);
});
test('shared feedback button reconnects then refreshes once without duplicate work', async () => {
  const {R}=setup();let connects=0,verifications=0,release;
  const fixture=roleSubscriptionFeedbackLifecycleFixture(R,{subscribe:async()=>{connects+=1;if(connects===1)throw Error('offline');return()=>{};},verifyLatest:()=>{verifications+=1;if(verifications===1)return {status:503};return new Promise(resolve=>{release=resolve;});}});
  await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const record=fixture.subscriptions[0];
  const reconnected=await record.bridge.activate();assert.equal(reconnected.reason,'connectivity_required');assert.equal(record.commandUi.snapshot().action,'refresh');assert.equal(connects,2);assert.equal(verifications,1);
  const refreshing=record.bridge.activate();await Promise.resolve();const duplicate=await record.bridge.activate();assert.equal(duplicate.reason,'action_in_progress');assert.equal(verifications,2);assert.equal(record.commandUi.snapshot().disableCommands,true);
  release({verified:true});const refreshed=await refreshing;assert.equal(refreshed.reason,'verification_refreshed');assert.equal(record.commandUi.snapshot().action,null);assert.equal(record.commandUi.snapshot().disableCommands,false);assert.equal(verifications,2);
});
test('reauthentication button stays single-flight and becomes stale after a role switch', async () => {
  const {R}=setup();let release,reauthCalls=0;
  const fixture=roleSubscriptionFeedbackLifecycleFixture(R,{verifyLatest:async()=>({status:401}),onReauthenticate:()=>{reauthCalls+=1;return new Promise(resolve=>{release=resolve;});}});
  await fixture.lifecycle.enter('driver');await fixture.lifecycle.idle();const old=fixture.subscriptions[0];old.disconnect();await old.bridge.activate();assert.equal(old.commandUi.snapshot().action,'reauth');
  const pending=old.bridge.activate();await Promise.resolve();const duplicate=await old.bridge.activate();assert.equal(duplicate.reason,'action_in_progress');assert.equal(reauthCalls,1);
  await fixture.lifecycle.enter('passenger');await fixture.subscriptions[1].bridge.idle();const fresh=fixture.subscriptions[1],freshRenders=fresh.renders.length;assert.equal(old.target.listenerCount('click'),0);assert.equal(fresh.target.listenerCount('click'),1);
  release({requested:true});const stale=await pending;assert.equal(stale.reason,'bridge_stale');assert.equal(fresh.renders.length,freshRenders);assert.equal(fresh.commandUi.snapshot().outcome,'idle');assert.equal(reauthCalls,1);
});
test('same-role re-entry removes the old subscription button before another click', async () => {
  const {R}=setup();let connects=0;
  const fixture=roleSubscriptionFeedbackLifecycleFixture(R,{subscribe:async()=>{connects+=1;throw Error('offline');}});
  await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});await fixture.lifecycle.idle();const old=fixture.subscriptions[0];fixture.lifecycle.leave();await fixture.lifecycle.enter('passenger',{sessionBinding:{account:2}});await fixture.lifecycle.idle();const fresh=fixture.subscriptions[1];
  assert.equal(old.target.listenerCount('click'),0);old.target.dispatch('click');assert.equal((await old.bridge.activate()).reason,'bridge_inactive');assert.equal(fresh.target.listenerCount('click'),1);assert.equal(fresh.commandUi.snapshot().action,'reconnect');assert.equal(connects,2);
});
test('404 reconnect verification renders the active driver empty state without an action', async () => {
  const {R}=setup(),fixture=roleSubscriptionFeedbackLifecycleFixture(R,{verifyLatest:async()=>({status:404})});
  await fixture.lifecycle.enter('driver');await fixture.lifecycle.idle();const record=fixture.subscriptions[0];record.disconnect();const result=await record.bridge.activate(),view=record.commandUi.snapshot();
  assert.equal(result.reason,'ride_not_found');assert.equal(view.outcome,'confirmed');assert.equal(view.action,null);assert.equal(view.disableCommands,false);assert.match(view.title,/йЃ‹иЎЊ/);assert.match(view.message,/йЃ‹и»ўж‰‹гѓ›гѓјгѓ /);assert.equal((await record.bridge.activate()).reason,'action_not_available');
});
test('prototype DOM bridge renders notification recovery state and accessibility locks', () => {
  const {R}=setup(),commandUi=R.createCommandUiController('passenger'),elements=feedbackDomElements(),bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>({processed:true})});
  bridge.attach();commandUi.applyFeedback('passenger',commandUi.snapshot().generation,'unresolved',{title:'дѕќй јгЃ®йЂљзџҐгЃ«жЋҐз¶љгЃ§гЃЌгЃѕгЃ›г‚“',message:'йЂљдїЎг‚’зўєиЄЌгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚',disableCommands:true,action:'reconnect'});bridge.render();
  assert.equal(elements.box.hidden,false);assert.match(elements.box.className,/error/);assert.equal(elements.box.attributes['aria-busy'],'false');assert.equal(elements.title.textContent,'дѕќй јгЃ®йЂљзџҐгЃ«жЋҐз¶љгЃ§гЃЌгЃѕгЃ›г‚“');assert.equal(elements.action.textContent,'йЂљзџҐг‚’е†ЌжЋҐз¶љгЃ™г‚‹');assert.equal(elements.action.hidden,false);assert.equal(elements.action.disabled,false);assert.equal(elements.action.attributes['aria-disabled'],'false');
  for(const button of elements.commandButtons){assert.equal(button.disabled,true);assert.equal(button.attributes['aria-disabled'],'true');}
});
test('prototype DOM feedback action is single-flight and exposes pending ARIA state', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('driver'),elements=feedbackDomElements();let calls=0,release;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:()=>{calls+=1;return new Promise(resolve=>{release=resolve;});}});bridge.attach();commandUi.applyFeedback('driver',commandUi.snapshot().generation,'unresolved',{title:'йЃ‹иЎЊгЃ®йЂљзџҐгЃ«жЋҐз¶љгЃ§гЃЌгЃѕгЃ›г‚“',message:'е†ЌжЋҐз¶љгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚',disableCommands:true,action:'reconnect'});bridge.render();
  const pending=bridge.activate();await Promise.resolve();const duplicate=await bridge.activate();assert.equal(calls,1);assert.equal(duplicate.reason,'action_in_progress');assert.equal(elements.action.disabled,true);assert.equal(elements.action.attributes['aria-disabled'],'true');assert.equal(elements.box.attributes['aria-busy'],'true');
  release({processed:true,reason:'reconnected'});assert.equal((await pending).reason,'reconnected');assert.equal(elements.box.attributes['aria-busy'],'false');
});
test('role-page exit removes the actual feedback click listener and hides its banner', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('passenger'),elements=feedbackDomElements();let calls=0;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>{calls+=1;return {processed:true};}});bridge.attach();commandUi.applyFeedback('passenger',commandUi.snapshot().generation,'unresolved',{title:'зўєиЄЌгЃЊеї…и¦ЃгЃ§гЃ™',message:'',disableCommands:true,action:'refresh'});bridge.render();assert.equal(elements.action.listenerCount('click'),1);
  bridge.detach();elements.action.dispatch('click');await Promise.resolve();assert.equal(calls,0);assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal((await bridge.activate()).reason,'dom_bridge_inactive');
});
test('detaching fallback feedback releases its stale command lock', () => {
  const {R}=setup(),commandUi=R.createCommandUiController('driver'),elements=feedbackDomElements();
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>({processed:true})});bridge.attach();commandUi.applyFeedback('driver',commandUi.snapshot().generation,'unresolved',{title:'еЅ№е‰Із”»йќўг‚’й–‹е§‹гЃ§гЃЌгЃѕгЃ›г‚“',message:'еЅ№е‰ІйЃёжЉћгЃёж€»гЃЈгЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚',disableCommands:true,action:'reauth'});bridge.render();
  assert.equal(elements.commandButtons[0].disabled,true);assert.equal(elements.commandButtons[0].attributes['aria-disabled'],'true');bridge.detach();
  for(const button of elements.commandButtons){assert.equal(button.disabled,false);assert.equal(button.attributes['aria-disabled'],'false');}
});
test('delayed feedback completion cannot repaint after role-page exit', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('driver'),elements=feedbackDomElements();let release;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:()=>new Promise(resolve=>{release=resolve;})});bridge.attach();commandUi.applyFeedback('driver',commandUi.snapshot().generation,'reauth',{title:'е†Ќгѓ­г‚°г‚¤гѓігЃЊеї…и¦ЃгЃ§гЃ™',message:'иЄЌиЁјгЃ—гЃ¦гЃЏгЃ гЃ•гЃ„гЂ‚',disableCommands:true,action:'reauth'});bridge.render();const pending=bridge.activate();await Promise.resolve();bridge.detach();release({processed:true,reason:'reauthentication_requested'});
  assert.equal((await pending).reason,'dom_bridge_stale');assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(bridge.snapshot().attached,false);
});
test('same-role page re-entry uses a fresh DOM generation without duplicate listeners', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('passenger'),elements=feedbackDomElements();let calls=0;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>{calls+=1;return {processed:true,reason:'refreshed'};}});bridge.attach();const first=bridge.snapshot().generation;bridge.detach();bridge.attach();const second=bridge.snapshot().generation;
  commandUi.applyFeedback('passenger',commandUi.snapshot().generation,'unresolved',{title:'жњЂж–°зЉ¶ж…‹г‚’зўєиЄЌ',message:'',disableCommands:true,action:'refresh'});bridge.render();elements.action.dispatch('click');await Promise.resolve();await Promise.resolve();assert.ok(second>first);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.action.addCount('click'),2);assert.equal(calls,1);assert.deepEqual(Object.keys(bridge.snapshot()).sort(),['attached','busy','generation','lastEvent']);
});
test('role-owned subscription failure reaches the prototype DOM through one listener', async () => {
  const {R}=setup(),fixture=roleSubscriptionDomLifecycleFixture(R,{subscribe:async()=>{throw Error('offline');}});await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const record=fixture.subscriptions[0],state=record.bridge.snapshot();
  assert.equal(record.elements.action.listenerCount('click'),1);assert.equal(record.elements.action.addCount('click'),1);assert.equal(record.elements.action.textContent,'йЂљзџҐг‚’е†ЌжЋҐз¶љгЃ™г‚‹');assert.equal(record.elements.action.hidden,false);assert.equal(record.elements.commandButtons[0].disabled,true);assert.equal(record.elements.commandButtons[0].attributes['aria-disabled'],'true');assert.equal(state.action,'reconnect');assert.equal(state.commandsLocked,true);
});
test('prototype DOM reconnect path is single-flight through the active lifecycle generation', async () => {
  const {R}=setup();let connections=0,release;
  const fixture=roleSubscriptionDomLifecycleFixture(R,{subscribe:async()=>{connections+=1;if(connections===1)throw Error('offline');return()=>{};},verifyLatest:()=>new Promise(resolve=>{release=resolve;})});await fixture.lifecycle.enter('driver');await fixture.lifecycle.idle();const record=fixture.subscriptions[0];
  const reconnect=record.bridge.activate();while(!release)await new Promise(resolve=>setImmediate(resolve));const duplicate=await record.bridge.activate();assert.equal(connections,2);assert.equal(duplicate.reason,'action_in_progress');assert.equal(record.elements.action.disabled,true);assert.equal(record.elements.box.attributes['aria-busy'],'true');
  release({verified:true});assert.equal((await reconnect).processed,true);await record.bridge.idle();assert.equal(record.bridge.snapshot().commandsLocked,false);assert.equal(record.elements.action.hidden,true);assert.equal(record.elements.box.attributes['aria-busy'],'false');
});
test('role lifecycle exit detaches the prototype DOM before later clicks', async () => {
  const {R}=setup();let connections=0;const fixture=roleSubscriptionDomLifecycleFixture(R,{subscribe:async()=>{connections+=1;throw Error('offline');}});await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const record=fixture.subscriptions[0];fixture.lifecycle.leave();
  record.elements.action.dispatch('click');await Promise.resolve();assert.equal(connections,1);assert.equal(record.elements.action.listenerCount('click'),0);assert.equal(record.elements.box.hidden,true);assert.equal(record.bridge.snapshot().detached,true);assert.equal((await record.bridge.activate()).reason,'bridge_inactive');
});
test('role switch drops delayed prototype DOM recovery without repainting the new role', async () => {
  const {R}=setup();let connections=0,release;
  const fixture=roleSubscriptionDomLifecycleFixture(R,{subscribe:async({role})=>{connections+=1;if(role==='passenger'&&connections===1)throw Error('offline');return()=>{};},verifyLatest:({role})=>role==='passenger'?new Promise(resolve=>{release=resolve;}):Promise.resolve({verified:true})});await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const old=fixture.subscriptions[0],pending=old.bridge.activate();while(!release)await new Promise(resolve=>setImmediate(resolve));await fixture.lifecycle.enter('driver');const fresh=fixture.subscriptions[1];await fresh.bridge.idle();const freshRenders=fresh.renders.length;
  release({verified:true});assert.equal((await pending).reason,'dom_bridge_stale');assert.equal(old.elements.action.listenerCount('click'),0);assert.equal(old.elements.box.hidden,true);assert.equal(fresh.elements.action.listenerCount('click'),1);assert.equal(fresh.renders.length,freshRenders);assert.equal(fresh.bridge.snapshot().commandsLocked,false);
});
test('same-role account re-entry replaces the prototype DOM subscription generation', async () => {
  const {R}=setup();let connections=0;const fixture=roleSubscriptionDomLifecycleFixture(R,{subscribe:async()=>{connections+=1;throw Error('offline');}});await fixture.lifecycle.enter('passenger',{sessionBinding:{account:1}});await fixture.lifecycle.idle();const old=fixture.subscriptions[0];await fixture.lifecycle.enter('passenger',{sessionBinding:{account:2}});await fixture.lifecycle.idle();const fresh=fixture.subscriptions[1];
  old.elements.action.dispatch('click');await Promise.resolve();assert.equal(connections,2);assert.equal(old.elements.action.listenerCount('click'),0);assert.equal(fresh.elements.action.listenerCount('click'),1);assert.equal(fresh.elements.action.textContent,'йЂљзџҐг‚’е†ЌжЋҐз¶љгЃ™г‚‹');assert.equal(old.bridge.snapshot().detached,true);assert.equal(fresh.bridge.snapshot().detached,false);assert.ok(fresh.generation>old.generation);
});
test('role service provider accepts only the explicit six-method allowlist', async () => {
  const {R}=setup();let calls=0;
  const valid=allowedRoleServices({sessionForRole:()=>{calls+=1;return {accountRef:'passenger-a',viewerRole:'passenger'};}});
  assert.equal(R.isAllowedRoleServiceProvider(valid),true);
  assert.equal(R.isAllowedRoleServiceProvider({...valid,token:'secret'}),false);
  const {verifyLatest,...missing}=valid;assert.equal(R.isAllowedRoleServiceProvider(missing),false);
  const runtime=R.createRolePageRuntime({services:{...valid,endpoint:'https://example.invalid'},createLifecycle:()=>{throw Error('must not create');}});
  assert.equal((await runtime.enter('home','passenger')).reason,'services_unavailable');assert.equal(calls,0);assert.equal(runtime.snapshot().serviceState,'unconfigured');
});
test('allowed service adapter assembles startup recovery, notification subscription and DOM once', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),documentState={visibilityState:'visible'},elements=feedbackDomElements(),navigations=[],contexts=[];let subscription,unsubscribes=0;
  const services=allowedRoleServices({
    readCurrentRide:async context=>{contexts.push(['read',context]);return {status:204};},
    subscribeNotifications:async context=>{contexts.push(['subscribe',context]);subscription=context;return()=>{unsubscribes+=1;};},
    handleNotificationHint:async context=>{contexts.push(['hint',context]);return {processed:true};}
  });
  const lifecycle=R.createRoleServiceLifecycle({services,elements,eventTarget,documentState,navigate:page=>navigations.push(page),storage:memoryStorage()});
  const sessionBinding=Object.freeze({accountRef:'passenger-a',viewerRole:'passenger'}),entered=await lifecycle.enter('passenger',{sessionBinding});await lifecycle.idle();
  assert.equal(entered.entered,true);assert.deepEqual(navigations,['home']);assert.deepEqual(contexts.map(([name])=>name),['subscribe','read']);assert.equal(elements.action.listenerCount('click'),1);
  await subscription.onHint({type:'ride.changed',rideId:'fixture-ride',revision:2});await lifecycle.idle();assert.deepEqual(contexts.map(([name])=>name),['subscribe','read','hint']);
  for(const [,context] of contexts){assert.equal(context.role,'passenger');assert.equal(context.generation,1);assert.equal(context.sessionBinding,sessionBinding);}
  const state=lifecycle.snapshot(),encoded=JSON.stringify(state);assert.deepEqual(Object.keys(state).sort(),['activeRole','busy','entered','generation','lastAction']);assert.equal(encoded.includes('passenger-a'),false);assert.equal(encoded.includes('fixture-ride'),false);assert.equal(unsubscribes,0);
});
test('allowed service adapter aborts and detaches every injected entry on role exit', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements();let signal,unsubscribes=0;
  const services=allowedRoleServices({subscribeNotifications:async context=>{signal=context.signal;return()=>{unsubscribes+=1;};}}),lifecycle=R.createRoleServiceLifecycle({services,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:()=>{},storage:memoryStorage()});
  await lifecycle.enter('driver',{sessionBinding:{accountRef:'driver-a',viewerRole:'driver'}});await lifecycle.idle();assert.equal(signal.aborted,false);for(const type of ['visibilitychange','pageshow','online'])assert.equal(eventTarget.listenerCount(type),1);
  const left=lifecycle.leave();assert.equal(left.left,true);assert.equal(signal.aborted,true);assert.equal(unsubscribes,1);assert.equal(elements.action.listenerCount('click'),0);for(const type of ['visibilitychange','pageshow','online'])assert.equal(eventTarget.listenerCount(type),0);
});
test('allowed service adapter drops delayed old-account recovery after a role switch', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),navigations=[];let releasePassenger;
  const services=allowedRoleServices({readCurrentRide:context=>context.role==='passenger'?new Promise(resolve=>{releasePassenger=resolve;}):Promise.resolve({status:204})}),lifecycle=R.createRoleServiceLifecycle({services,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:page=>navigations.push(page),storage:memoryStorage()});
  const old=lifecycle.enter('passenger',{sessionBinding:{accountRef:'passenger-a',viewerRole:'passenger'}});while(!releasePassenger)await new Promise(resolve=>setImmediate(resolve));const fresh=await lifecycle.enter('driver',{sessionBinding:{accountRef:'driver-b',viewerRole:'driver'}});releasePassenger({status:200,body:currentRideView('passenger')});const stale=await old;await lifecycle.idle();
  assert.equal(fresh.entered,true);assert.equal(stale.reason,'stale_entry');assert.deepEqual(navigations,['driver-home']);assert.equal(lifecycle.snapshot().activeRole,'driver');const publicState=JSON.stringify(lifecycle.snapshot());assert.equal(publicState.includes('passenger-a'),false);assert.equal(publicState.includes('driver-b'),false);
});
test('router, runtime and adapter reconnect through one DOM action without duplicate work', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),session=Object.freeze({accountRef:'passenger-a',viewerRole:'passenger'});let page='role',role='passenger',connections=0,reads=0,verifications=0,unsubscribes=0,router;
  const services=allowedRoleServices({sessionForRole:()=>session,readCurrentRide:async()=>{reads+=1;return {status:204};},subscribeNotifications:async()=>{connections+=1;if(connections===1)throw Error('offline');return()=>{unsubscribes+=1;};},verifyLatest:async()=>{verifications+=1;return {verified:true};}});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()})});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:target=>target==='role'?{page:'role',role:null}:{page:target,role},render:destination=>{page=destination.page;}});router.attach();
  const entered=await router.navigate('home');await router.idle();assert.equal(entered.navigated,true);assert.equal(entered.reason,'entered');assert.equal(reads,1);assert.equal(connections,1);assert.equal(router.snapshot().revision,1);assert.equal(elements.action.textContent,'йЂљзџҐг‚’е†ЌжЋҐз¶љгЃ™г‚‹');assert.equal(elements.action.listenerCount('click'),1);
  elements.action.dispatch('click');elements.action.dispatch('click');await router.idle();assert.equal(connections,2);assert.equal(verifications,1);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);
  role=null;await router.navigate('role');assert.equal(unsubscribes,1);assert.equal(elements.action.listenerCount('click'),0);for(const type of ['visibilitychange','pageshow','online'])assert.equal(eventTarget.listenerCount(type),0);
});
test('integrated same-role account switch detaches a pending reconnect before fresh entry', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),accountA=Object.freeze({accountRef:'passenger-a',viewerRole:'passenger'}),accountB=Object.freeze({accountRef:'passenger-b',viewerRole:'passenger'});let session=accountA,page='role',connections=0,unsubscribes=0,releaseOld,router;const accounts=[];
  const services=allowedRoleServices({sessionForRole:()=>session,subscribeNotifications:async context=>{connections+=1;accounts.push(context.sessionBinding.accountRef);if(connections===1)throw Error('offline');return()=>{unsubscribes+=1;};},verifyLatest:context=>context.sessionBinding===accountA?new Promise(resolve=>{releaseOld=resolve;}):Promise.resolve({verified:true})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()})});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:target=>({page:target,role:'passenger'}),render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');await router.idle();
  elements.action.dispatch('click');while(!releaseOld)await new Promise(resolve=>setImmediate(resolve));session=accountB;const fresh=await router.navigate('passenger-history');await Promise.resolve();await Promise.resolve();assert.equal(fresh.reason,'stale_navigation');assert.equal(router.snapshot().page,'home');assert.equal(runtime.snapshot().activeRole,'passenger');assert.deepEqual(accounts,['passenger-a','passenger-a','passenger-b']);assert.equal(unsubscribes,1);assert.equal(elements.action.listenerCount('click'),1);
  const before={text:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled};releaseOld({verified:true});await Promise.resolve();await Promise.resolve();await router.idle();assert.deepEqual({text:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled},before);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('passenger-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('passenger-b'),false);
});
test('auth session loss tears down pending reconnect before safe fresh-session re-entry', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController(),accountA=Object.freeze({accountRef:'passenger-a',viewerRole:'passenger'}),accountB=Object.freeze({accountRef:'passenger-b',viewerRole:'passenger'});let session=accountA,page='role',connections=0,unsubscribes=0,releaseOld,router;const accounts=[];
  const services=allowedRoleServices({sessionForRole:()=>session,subscribeNotifications:async context=>{connections+=1;accounts.push(context.sessionBinding.accountRef);if(connections===1)throw Error('offline');return()=>{unsubscribes+=1;};},verifyLatest:context=>context.sessionBinding===accountA?new Promise(resolve=>{releaseOld=resolve;}):Promise.resolve({verified:true})});
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:target=>target==='role'?{page:'role',role:null}:{page:target,role:'passenger'},render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');await router.idle();
  elements.action.dispatch('click');while(!releaseOld)await new Promise(resolve=>setImmediate(resolve));session=null;eventTarget.dispatch('fiji:auth-session-changed',{detail:{sessionBinding:{accountRef:'attacker'}}});
  while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal(unsubscribes,1);assert.equal(fallbackUi.snapshot().action,'reauth');assert.equal(elements.action.textContent,'еЅ№е‰ІйЃёжЉћгЃёж€»г‚‹');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);assert.match(elements.title.textContent,/иЄЌиЁјг‚»гѓѓг‚·гѓ§гѓі/);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('attacker'),false);
  releaseOld({verified:true});await Promise.resolve();await Promise.resolve();session=accountB;eventTarget.dispatch('fiji:auth-session-changed');await router.idle();assert.deepEqual(accounts,['passenger-a','passenger-a','passenger-b']);assert.equal(connections,3);assert.equal(runtime.snapshot().activeRole,'passenger');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('passenger-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('passenger-b'),false);
});
test('auth session listener is single, ignores event payload and is removed with the router', async () => {
  const {R}=setup(),target=recoveryEventTarget(),entries=[];let page='home';
  const runtime={snapshot:()=>({}),enter:async(targetPage,role)=>{entries.push([targetPage,role]);return {entered:true,reason:'within_role'};},leave:()=>({left:true}),idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>({page:targetPage,role:'passenger'}),render:value=>{page=value.page;}});router.attach();router.attach();await router.navigate('home');target.dispatch('fiji:auth-session-changed',{detail:{role:'driver',sessionBinding:{accountRef:'injected'}}});await router.idle();
  assert.equal(target.listenerCount('fiji:auth-session-changed'),1);assert.equal(target.addCount('fiji:auth-session-changed'),1);assert.deepEqual(entries,[['home','passenger'],['home','passenger']]);assert.equal(JSON.stringify(entries).includes('injected'),false);router.detach();assert.equal(target.listenerCount('fiji:auth-session-changed'),0);target.dispatch('fiji:auth-session-changed');await Promise.resolve();assert.equal(entries.length,2);
});
test('same-session entry joins the pending lчћё¶‰ћЛkєwµзXЫЫњЭЪЫЬЩ\ЏX]ШZ][XЪСЫKXЭ]]J
NШ\ЬЩ\ќ™\]X[
ЪЫЬЩ\‹њ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Ь›ЫIКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫKќ[
NШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКK
NШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€Щ\ЬЪ[ЫЏXXШЫЭ[ќОШЫЫњЭњ™\ЪX]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
њ™\Ъ›]љYШ]YќYJNШ\ЬЩ\ќ™\]X[
њ™\Ъњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
ЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNВ€™[X\ЩPЉЬЭ]\ОЊЊ›ЩNЭ\њ™[ќљYUљY]К	Щљ]™\‰К_JNЬ™[X\ЩPJЬЭ]\ОЊЊ›ЩNЭ\њ™[ќљYUљY]К	Щљ]™\‰К_JNШЫЫњЭЫ™\Э[X]ШZ]Ы[ќћNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Ы™\Э[њ™X\ЫЫ‹	ЬЭ[WЫ]љYШ][Ы‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
ЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[]Z[X›KJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
]™[ќ\™Щ]›\Э[™\ђЫЭ[ќ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КKJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹XIКK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹X‰КK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹XЙКK[ЩJNВџJNВќ\Э
	Ь™\X]YЩЫЭ][™™X]][ќXШ][Ы€ЩY\Ы›HHЭ\њ™[ќЭXњШЬљ\[Ы€[™\Э[™\њЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK[]Z[X›OL›Э]\ЋВ€ЫЫњЭ™XYПVЧKЫЫ›™XЭ[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КЬЩ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯKЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћШЫЫ›™XЭ[ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯ_JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЭ[]Z[X›JПLNЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€›ЬЉ][™^LЪ[™^ЋЪ[™^
ПLJ^ЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щonyblє`n9ў§ёаn9ў.шаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Ь›ЫIКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКK
NШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦЪ[™^
МWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNЯB€\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
ЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[]Z[X›KЉNШ\ЬЩ\ќ™\]X[
]™[ќ\™Щ]›\Э[™\ђЫЭ[ќ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КKJNШ\ЬЩ\ќ™\]X[
]™[ќ\™Щ]YЫЭ[ќ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КKJNЩ›ЬЉЫЫњЭ\HЩ€ЙЭљ\ЪXљ[]XЪ[™ЩIЛ	ЬYЩ\ЪЭЙЛ	ЫЫ›[™IЧJX\ЬЩ\ќ™\]X[
]™[ќ\™Щ]›\Э[™\ђЫЭ[ќ
\JKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹YЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹XIКK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹X‰КK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹XЙКK[ЩJNВџJNВќ\Э
	ЬШ]™YШ[XЪЬИњ›ЫHљ[Ь€]][ќXШ][Ы€ЮXЫ\ИЭЬ™Y›Ь™H]]Ьљ^™Y›ЭYљXШ][Ы€[™[™ЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\ЋВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЬ™]\›€Ь›ШЩ\ЬЩYќќY_NЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€›ЬЉ][™^LЪ[™^ЋЪ[™^
ПLJ^ЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦЪ[™^
МWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNЯB€\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNВ€ЫЫњЭ[ќ^Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЋ_KЫOX]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
[ќ
KЫЏX]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
[ќ
NВ€\ЬЩ\ќ™\]X[
ЫKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™\]X[
Ы‹њ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
[™YЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNВ€ЫЫњЭЭ\њ™[ќX]ШZ]ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
[ќ
NШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XЙЛWWJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

K[™YJKљ[ЫY\К	Щљ]™\‹XIКK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

K[™YJKљ[ЫY\К	Щљ]™\‹X‰КK[ЩJNВџJNВќ\Э
	ШЭ\њ™[ќ\ШЫЫ›™XЭЪ[њИHЭ[HШ[XЪИXЩH[™™XЫЫ›™XЭИЫЩIЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™\љYљXШ][ЫњПLВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЪ[™Yњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€Ь›ШЩ\ЬЩYќќY_NЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњКПLNШ\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМ—JNЬ™]\›€Э™\љYљYYќќY_NЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€›ЬЉ][™^LЪ[™^ЋЪ[™^
ПLJ^ЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNШ]ШZ]›Э]\‹љYJ
NШ]ШZ][XЪСЫKXЭ]]J
NЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦЪ[™^
МWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNЯB€ЫЫњЭ\ШЫЫ›™XЭY\ЭXњШЬљ\[ЫњЦМ—K›Ы‘\ШЫЫ›™XЭ

KЭ[PO\ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊLJKЭ[PЏ\ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊLJNВ€\ЬЩ\ќ™\]X[
\ШЫЫ›™XЭYњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Щ\ШЫЫ›™XЭY	КNШ\ЬЩ\ќ™\]X[

]ШZ]Э[PJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™\]X[

]ШZ]Э[PЉKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
[™YЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	ъ`&№зйxа¤№aЈyЈ©yн¦ёаfxаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™Э
NШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦМЧKњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМ—JNШ\ЬЩ\ќ™\]X[
™\љYљXШ][ЫњЛJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™Y\\]X[
[™YЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹XIКK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹X‰КK[ЩJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\К	Щљ]™\‹XЙКK[ЩJNВџJNВќ\Э
	ШXШЫЭ[ќЭЪ]Ъ\љ[™И™XЫЫ›™XЭ™\љYљXШ][Ы€ЩY\ИЫ›HH™\XЩ[Y[ќЩ\ЬЪ[Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩU™\љYљXШ][ЫЋВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK™\љYљXШ][ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЪ[™Yњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€Ь›ШЩ\ЬЩYќќY_NЯK€™\љYћS]\ЭЉЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€Щ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМ—OЫ™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩU™\љYљXШ][ЫЏ\™\ЫЫ™NЯJN”›ЫZ\ЩKњ™\ЫЫ™JЭ™\љYљYYќќY_JNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€›ЬЉ][™^LЪ[™^ЋЪ[™^
ПLJ^ЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNШ]ШZ]›Э]\‹љYJ
NШ]ШZ][XЪСЫKXЭ]]J
NЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦЪ[™^
МWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNЯB€ЭXњШЬљ\[ЫњЦМ—K›Ы‘\ШЫЫ›™XЭ

NЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™[X\ЩU™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™Э
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€Щ\ЬЪ[ЫЏXXШЫЭ[ќЦМЧNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[JЭXњШЬљ\[ЫњЛ›[™ЭOOM_™XYЛ›[™ЭOOM
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦНKњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€™[X\ЩU™\љYљXШ][ЫЉЭ™\љYљYYќќY_JNШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМЧK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊL_JJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШЫЫњЭЭ\њ™[ќX]ШZ]ЭXњШЬљ\[ЫњЦНK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊL_JNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™Y\\]X[
[™YЙЩљ]™\‹Y	ЧJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Ь™\XЩ[Y[ќ›ЭYљXШ][Ы€Ъ[њИЭ™\€[^YYЫ™XЫЫ›™XЭ™\љYљXШ][Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩU™\љYљXШ][Ы‹™[X\ЩR[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK™\љYљXШ][ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩR[ќ\™\ЫЫ™NЯJNЯK€™\љYћS]\ЭЉЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩU™\љYљXШ][ЫЏ\™\ЫЫ™NЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЭXњШЬљ\[ЫњЦМK›Ы‘\ШЫЫ›™XЭ

NЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™[X\ЩU™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€Щ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[JЭXњШЬљ\[ЫњЛ›[™ЭOOLЯ™XYЛ›[™ЭOOLЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦМ—KњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМWJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€ЫЫњЭЭ\њ™[ќ[ќ\ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊLџJNЭЪ[J\™[X\ЩR[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹X‰ЛL—WJNВ€™[X\ЩU™\љYљXШ][ЫЉЭ™\љYљYYќќY_JNШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊLџJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNВ€™[X\ЩR[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ\њ™[ќX]ШZ]Э\њ™[ќ[ќШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹X‰ЛL—WJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Ш]][ќXШ][Ы€ЬЬИ\ШШ\™ИH[™[™И›ЭYљXШ][Ы€[™™[™\њИЫ™H™X]][ќXШ][Ы€XЭ[Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќSШљ™XЭ™њ™Y^™JШXШЫЭ[ќ™YЋ‰Щљ]™\‹XIЛљY]Щ\”›ЫN‰Щљ]™\‰ЯJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќ›Э]\‹™[X\ЩR[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩR[ќ\™\ЫЫ™NЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЫЫњЭ[™[™П\ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊLЯJNЭЪ[J\™[X\ЩR[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛLЧWJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щonyblє`n9ў§ёаn9ў.шаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ*Јz*/8а®шааша­шайшамЛКNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊMJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNВ€ЫЫњЭЭЬY^Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YNЬ™[X\ЩR[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ[OX]ШZ][™[™ОШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э[Kњ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™Y\\]X[
Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YKЭЬY
NШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛLЧWJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
[XЪХZKњЫ\ЪЭ

KXЭ[Ы‹	Ь™X]]	КNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
]™[ќ\™Щ]›\Э[™\ђЫЭ[ќ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КKJNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Щњ™\Ъ™Y[ќћHЭ^\ИXЭ]™HЪ[€H™K[ЩЫЭ]›ЭYљXШ][Ы€ЫЫ\]\И]IЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩSЫ[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЬ™]\›€Щ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМOЫ™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩSЫ[ќ\™\ЫЫ™NЯJN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЫЫњЭЫ[ќ\ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊM_JNЭЪ[J\™[X\ЩSЫ[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щonyblє`n9ў§ёаn9ў.шаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Ь›ЫIКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫKќ[
NШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКK
NЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦМWKњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМWJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€ЫЫњЭЭ\њ™[ќX]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊMџJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛMWKЙЩљ]™\‹X‰ЛM—WJNШЫЫњЭЭ\њ™[ќљY]П^Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NВ€™[X\ЩSЫ[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ[OX]ШZ]Ы[ќШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э[Kњ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™Y\\]X[
Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_KЭ\њ™[ќљY]КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
]™[ќ\™Щ]›\Э[™\ђЫЭ[ќ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КKJNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	ЬЭ[H›ЭYљXШ][Ы€Z[\™HШ[››Э[ќ\њќ\H[™[™Ињ™\Ъ\Щ\ЬЪ[Ы€›ЭYљXШ][Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™Z™XЭЫ[ќ™[X\ЩS™]Т[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЬ™]\›€Щ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМOЫ™]И›ЫZ\ЩJ
Ь™\ЫЫ™K™Z™XЭ
OOћЬ™Z™XЭЫ[ќ\™Z™XЭЯJN›™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩS™]Т[ќ\™\ЫЫ™NЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЫЫњЭЫ[ќ\ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊMЯJNЭЪ[J\™Z™XЭЫ[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNВ€ЫЫњЭ™]Т[ќ\ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊNJNЭЪ[J\™[X\ЩS™]Т[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛMЧKЙЩљ]™\‹X‰ЛNWJNШЫЫњЭњ™\ЪљY]П^Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NВ€™Z™XЭЫ[ќ
\њ›ЬЉ	ЫЫ›ЭYљXШ][Ы€Z[Y	КJNШЫЫњЭЭ[OX]ШZ]Ы[ќШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
Э[Kњ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™Y\\]X[
Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_Kњ™\ЪљY]КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNВ€™[X\ЩS™]Т[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ\њ™[ќX]ШZ]™]Т[ќШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛMЧKЙЩљ]™\‹X‰ЛNWJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
]™[ќ\™Щ]›\Э[™\ђЫЭ[ќ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КKJNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	ШЭ\њ™[ќ›ЭYљXШ][Ы€Z[\™HШЪЬИЫ›HHXЭ]™HЩ\ЬЪ[Ы€[™Щ™™\њИЫ™H^XЪ]™Yњ™\Ъ	Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќSШљ™XЭ™њ™Y^™JШXШЫЭ[ќ™YЋ‰Щљ]™\‹XЭ\њ™[ќ	ЛљY]Щ\”›ЫN‰Щљ]™\‰ЯJNЫ]YЩOIЬ›ЫIЛ›Э]\‹™\љYљXШ][ЫњПLВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOXШЫЭ[ќ€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OOћЯNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЭ›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњКПLNШ\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ
NЬ™]\›€Э™\љYљYYќќY_NЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЫЫњЭZ[YX]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊN_JNШ\ЬЩ\ќ™\]X[
Z[Yњ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Z[Yњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XЭ\њ™[ќ	ЛNWWJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ`bъ(c8аk№§ 9Ґ¬9в­№Ўbша¤№cе№oҐшаiшаcxаoёаfша¤ЛКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щ§ 9Ґ¬9в­№Ўbша¤№и®є*ЈxаfxаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
™\љYљXШ][ЫњЛJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XЭ\њ™[ќ	ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	ЩZ[Y^XЪ]™Yњ™\ЪYќ\€H›ЭYљXШ][Ы€Z[\™HЭ^\ИШЪЩYЪ]Э][€]]ЫX]XИЫЬ	Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќSШљ™XЭ™њ™Y^™JШXШЫЭ[ќ™YЋ‰Щљ]™\‹XЭ\њ™[ќ	ЛљY]Щ\”›ЫN‰Щљ]™\‰ЯJNЫ]YЩOIЬ›ЫIЛ›Э]\‹™\љYљXШ][ЫњПLВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOXШЫЭ[ќ€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OOћЯNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЭ›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњКПLNШ\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ
NЭ›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЫЫњЭZ[YX]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЊJNШ\ЬЩ\ќ™\]X[
Z[Yњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щ§ 9Ґ¬9в­№Ўbша¤№и®є*ЈxаfxаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
™\љYљXШ][ЫњЛJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XЭ\њ™[ќ	ЛЊWJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XЭ\њ™[ќ	ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ`bъ(c8аk№§ 9Ґ¬9в­№Ўbша¤№и®є*Јxаiшаcxаoёаfша¤ЛКNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќъ!к№bеyи®є*Јxаkщ`g9«hёаeшаoёаeшаgЛКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNВ€[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
™\љYљXШ][ЫњЛJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Ь›ЫHЪЫЬЩ\€ЫX\њИH\›Z[[›ЭYљXШ][Ы€Z[\™H™Y›Ь™Hњ™\Ъ\Щ\ЬЪ[Ы€™Y[ќћIЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™\љYљXШ][ЫњПLВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњКПLNШ\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМJNЭ›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЊ_JJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
™\љYљXШ][ЫњЛJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќъ!к№bеyи®є*Јxаkщ`g9«hёаeшаoёаeшаgЛКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫKќ[
NШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Ь›ЫIКNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКK
NШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€Щ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦМWKњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМWJNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЊџJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШЫЫњЭЭ\њ™[ќX]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЊџJNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛЊWKЙЩљ]™\‹X‰ЛЊ—WJNШ\ЬЩ\ќ™\]X[
™\љYљXШ][ЫњЛJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Щњ™\Ъ\Щ\ЬЪ[Ы€›ЭYљXШ][Ы€Z[\™HЭЫњИЫ™H™]И™XЫЭ™\ћHXЭ[Ы€Yќ\€\›Z[[™Y[ќћIЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\ЋВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЭ›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€Э™\љYљYYќќY_NЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЊЯJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќъ!к№bеyи®є*Јxаkщ`g9«hёаeшаoёаeшаgЛКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКK
NШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€Щ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШЫЫњЭњ™\ЪZ[\™OX]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЌJNШ\ЬЩ\ќ™\]X[
њ™\ЪZ[\™Kњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ`bъ(c8аk№§ 9Ґ¬9в­№Ўbша¤№cе№oҐшаiшаcxаoёаfша¤ЛКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щ§ 9Ґ¬9в­№Ўbша¤№и®є*ЈxаfxаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€ЫЫњЭњ™\ЪљY]П^Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЌ_JJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_Kњ™\ЪљY]КNВ€[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛЊЧKЙЩљ]™\‹X‰ЛЌWJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	ЬЭ[HШ[XЪИШ[››Э[ќ\њќ\Hњ™\Ъ\Щ\ЬЪ[Ы€›ЭYљXШ][Ы€™\љYљXШ][Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩQњ™\Ъ™\љYљXШ][ЫЋВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЭ›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩQњ™\Ъ™\љYљXШ][ЫЏJ
OOњ™\ЫЫ™JЭ™\љYљYYќќY_JNЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЌ_JJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЌџJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™[X\ЩQњ™\Ъ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNВ€ЫЫњЭ[™[™ХљY]П^Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NШЫЫњЭЭ[OX]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЌЯJNШ\ЬЩ\ќ™\]X[
Э[Kњ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_K[™[™ХљY]КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛЌWKЙЩљ]™\‹X‰ЛЌ—WJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNВ€™[X\ЩQњ™\Ъ™\љYљXШ][ЫЉ
NШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	ЬЭ[HШ[XЪИШ[››Э[\€Hњ™\Ъ\Щ\ЬЪ[Ы€™\љYљXШ][Ы€Z[\™IЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™Z™XЭњ™\Ъ™\љYљXШ][ЫЋВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЭ›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ
Ь™\ЫЫ™K™Z™XЭ
OOћЬ™Z™XЭњ™\Ъ™\љYљXШ][ЫЏ\™Z™XЭЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЋJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊЋ_JJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™Z™XЭњ™\Ъ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊМJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛЋKЙЩљ]™\‹X‰ЛЋWWJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€™Z™XЭњ™\Ъ™\љYљXШ][ЫЉ\њ›ЬЉ	Щњ™\Ъ™\љYљXШ][Ы€[њЬЬќZ[Y	КJNШ]ШZ]›Э]\‹љYJ
NШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ`bъ(c8аk№§ 9Ґ¬9в­№Ўbша¤№и®є*Јxаiшаcxаoёаfша¤ЛКNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќъ!к№bеyи®є*Јxаkщ`g9«hёаeшаoёаeшаgЛКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€ЫЫњЭЭЬY^Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊМ_JJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_KЭЬY
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Ш]][ќXШ][Ы€ЬЬИ™\XЩ\ИHњ™\Ъ\Щ\ЬЪ[Ы€[™[™И™\љYљXШ][Ы€Ъ]Ы™H™X]][ќXШ][Ы€XЭ[Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™Z™XЭњ™\Ъ™\љYљXШ][Ы‹[]Z[X›OLВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЭ›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ
Ь™\ЫЫ™K™Z™XЭ
OOћЬ™Z™XЭњ™\Ъ™\љYљXШ][ЫЏ\™Z™XЭЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЭ[]Z[X›JПLNЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊМџJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЧJNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊМЯJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™Z™XЭњ™\Ъ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
[]Z[X›KJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щonyblє`n9ў§ёаn9ў.шаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ*Јz*/8а®шааша­шайшамЛКNВ€ЫЫњЭ™X]]љY]П^Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NЬ™Z™XЭњ™\Ъ™\љYљXШ][ЫЉ\њ›ЬЉ	Ы]H™\љYљXШ][Ы€Z[\™IКJNШ]ШZ]›Э]\‹љYJ
NШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_K™X]]љY]КNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊНJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊНJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛМ—KЙЩљ]™\‹X‰ЛМЧWJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭЉNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Э\™Щ\ЬЪ[Ы€™[XZ[њИXЭ]™HYќ\€]][ќXШ][Ы€ЬЬИ\љ[™Ињ™\Ъ™\љYљXШ][Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™Z™XЭњ™\Ъ™\љYљXШ][ЫЋВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќ\Ю[КЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЪYЉЩ\ЬЪ[Ыђљ[™[™ИOOXXШЫЭ[ќЦМ—J]›ЭИ\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ
Ь™\ЫЫ™K™Z™XЭ
OOћЬ™Z™XЭњ™\Ъ™\љYљXШ][ЫЏ\™Z™XЭЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊН_JJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊНџJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™Z™XЭњ™\Ъ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щonyblє`n9ў§ёаn9ў.шаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNВ€\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Ь›ЫIКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКK
NЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМ—NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦМ—KњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМ—JNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNВ€ЫЫњЭЭ\њ™[ќX]ШZ]ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊНЯJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊОJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊОJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNВ€ЫЫњЭЭ\њ™[ќљY]П^Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NЬ™Z™XЭњ™\Ъ™\љYљXШ][ЫЉ\њ›ЬЉ	Ы]H™\љYљXШ][Ы€Z[\™IКJNШ]ШZ]›Э]\‹љYJ
NШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_KЭ\њ™[ќљY]КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛНWKЙЩљ]™\‹X‰ЛН—KЙЩљ]™\‹XЙЛНЧWJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Э\™\Щ\ЬЪ[Ы€›ЭYљXШ][Ы€Ъ[њИЭ™\€[^YYЫ™\љYљXШ][Ы€ЭXШЩ\ЬЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩSЫ™\љYљXШ][Ы‹™[X\ЩPЭ\њ™[ќ[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЪYЉЩ\ЬЪ[Ыђљ[™[™ИOOXXШЫЭ[ќЦМ—J\™]\›€›ЫZ\ЩKњ™Z™XЭ
\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КJNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩPЭ\њ™[ќ[ќ\™\ЫЫ™NЯJNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩSЫ™\љYљXШ][ЫЏ\™\ЫЫ™NЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЊО_JJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЧJNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™[X\ЩSЫ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМ—NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNВ€ЫЫњЭЭ\њ™[ќ[ќ\ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌ_JNЭЪ[J\™[X\ЩPЭ\њ™[ќ[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛОWKЙЩљ]™\‹X‰ЛKЙЩљ]™\‹XЙЛWWJNШЫЫњЭЭ\њ™[ќљY]П^Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NВ€™[X\ЩSЫ™\љYљXШ][ЫЉЭ™\љYљYYќќY_JNШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌџJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌџJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_KЭ\њ™[ќљY]КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNВ€™[X\ЩPЭ\њ™[ќ[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ\њ™[ќX]ШZ]Э\њ™[ќ[ќШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
Э\њ™[ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Ш]][ќXШ][Ы€ЬЬИ\љ[™И\™\Щ\ЬЪ[Ы€›ЭYљXШ][Ы€\ШШ\™И›ЭЭ\њ™[ќ[™ЫЫЬљЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩSЫ™\љYљXШ][Ы‹™[X\ЩPЭ\њ™[ќ[ќ[]Z[X›OLВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЪYЉЩ\ЬЪ[Ыђљ[™[™ИOOXXШЫЭ[ќЦМ—J\™]\›€›ЫZ\ЩKњ™Z™XЭ
\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КJNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩPЭ\њ™[ќ[ќ\™\ЫЫ™NЯJNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩSЫ™\љYљXШ][ЫЏ\™\ЫЫ™NЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЭ[]Z[X›JПLNЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌЯJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™[X\ЩSЫ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
[]Z[X›KJNШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNВ€Щ\ЬЪ[ЫЏXXШЫЭ[ќЦМ—NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШЫЫњЭЭ\њ™[ќ[ќ\ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌ_JNЭЪ[J\™[X\ЩPЭ\њ™[ќ[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛЧKЙЩљ]™\‹X‰ЛKЙЩљ]™\‹XЙЛWWJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IЯ[]Z[X›HOOLЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќ	щonyblє`n9ў§ёаn9ў.шаўЙКNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹[ЩJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›YќYJNШ\ЬЩ\ќ›X]Ъ
[[Y[ќЛќ]Kќ^ЫЫќ[ќъ*Јz*/8а®шааша­шайшамЛКNВ€ЫЫњЭ™X]]љY]П^Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NЬ™[X\ЩSЫ™\љYљXШ][ЫЉЭ™\љYљYYќќY_JNЬ™[X\ЩPЭ\њ™[ќ[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ[PЭ\њ™[ќX]ШZ]Э\њ™[ќ[ќШ]ШZ]›Э]\‹љYJ
NШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
Э[PЭ\њ™[ќњ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[PЭ\њ™[ќњ™X\ЫЫ‹	ШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™Y\\]X[
Э]N™[[Y[ќЛќ]Kќ^ЫЫќ[ќY\ЬШYЩN™[[Y[ќЛ›Y\ЬШYЩKќ^ЫЫќ[ќXЭ[ЫЋ™[[Y[ќЛXЭ[Ы‹ќ^ЫЫќ[ќY[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_K™X]]љY]КNВ€›ЬЉЫЫњЭЭXњШЬљ\[Ы€Щ€ЭXњШЬљ\[ЫњКX\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[Ы‹›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌџJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™ЭКNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
[XЪХZKњЫ\ЪЭ

KXЭ[Ы‹	Ь™X]]	КNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Щ›Э\ќЩ\ЬЪ[Ы€™Y[ќћH™Z™XЭИ[™YH\\ќYЩ[™\][ЫњЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™[X\ЩSЫ™\љYљXШ][Ы‹™[X\ЩU\™[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМ—J\™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩU\™[ќ\™\ЫЫ™NЯJNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМЧJ\™]\›€›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNЬ™]\›€›ЫZ\ЩKњ™Z™XЭ
\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КJNЯK€™\љYћS]\Э\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ]›ЭИ\њ›ЬЉ	Э™\љYљXШ][Ы€[њЬЬќZ[Y	КNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩSЫ™\љYљXШ][ЫЏ\™\ЫЫ™NЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌЯJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™[X\ЩSЫ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМ—NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШЫЫњЭ\™[ќ\ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌ_JNЭЪ[J\™[X\ЩU\™[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNВ€Щ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЩ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[

]ШZ][XЪСЫKXЭ]]J
JKњ™X\ЫЫ‹	ЩЫWШњљYЩWЬЭ[IКNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМЧNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™Э
NШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЦМЧKњЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќЦМЧJNВ€ЫЫњЭ›Э\ќX]ШZ]ЭXњШЬљ\[ЫњЦМЧK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌLJNШ\ЬЩ\ќ™\]X[
›Э\ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
›Э\ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNШЫЫњЭ›Э\ќљY]П^Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_NЬ™[X\ЩSЫ™\љYљXШ][ЫЉЭ™\љYљYYќќY_JNЬ™[X\ЩU\™[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭЭ[U\™X]ШZ]\™[ќШ]ШZ]›Э]\‹љYJ
NШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
Э[U\™њ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[U\™њ™X\ЫЫ‹	ШњљYЩWЬЭ[IКNВ€›ЬЉЫЫњЭЭXњШЬљ\[Ы€Щ€ЭXњШЬљ\[ЫњЛњЫXЩJКJX\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[Ы‹›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌL_JJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙК_K›Э\ќљY]КNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛЧKЙЩљ]™\‹X‰ЛKЙЩљ]™\‹XЙЛWKЙЩљ]™\‹Y	ЛLWJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧJNШ\ЬЩ\ќ™\]X[
ЭXњШЬљ\[ЫњЛ›[™Э
NШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Щ›Э\ќ\Щ\ЬЪ[Ы€›ЭYљXШ][Ы€Э\ќљ]™\И[^YYZ[\™\Ињ›ЫH[\\ќYЩ[™\][ЫњЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K]™[ќ\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[[Y[ќПY™YYXЪСЫQ[[Y[ќК
K[XЪХZOT‹Ь™X]PЫЫ[X[™ZPЫЫќ›Ы\Љ	Щљ]™\‰КKXШЫЭ[ќПVЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧK›X\
XШЫЭ[ќ™YЏO“Шљ™XЭ™њ™Y^™JШXШЫЭ[ќ™Y‹љY]Щ\”›ЫN‰Щљ]™\‰ЯJJNЫ]YЩOIЬ›ЫIЛЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМK›Э]\‹™Z™XЭљ\њЭ™\љYљXШ][Ы‹™Z™XЭЩXЫЫ™™\љYљXШ][Ы‹™Z™XЭ\™[ќ™[X\ЩQ›Э\ќ[ќВ€ЫЫњЭ™XYПVЧKЭXњШЬљ\[ЫњПVЧK\ШЫЫ›™XЭ[ЫњПVЧK[™YVЧK™\љYљXШ][ЫњПVЧNВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КВ€Щ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[Ы‹€™XYЭ\њ™[ќљYN\Ю[КЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЬ™XYЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€ЬЭ]\ОЊЊNЯK€ЭXњШЬљX™S›ЭYљXШ][ЫњО\Ю[ИЫЫќ^OћЬЭXњШЬљ\[ЫњЛњ\Ъ
ЫЫќ^
NЬ™]\›Љ
OO™\ШЫЫ›™XЭ[ЫњЛњ\Ъ
ЫЫќ^њЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЯK€[™S›ЭYљXШ][Ы’[ќЉЬЩ\ЬЪ[Ыђљ[™[™Л[ќJOOћЪ[™Yњ\Ъ
ЬЩ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™Y‹[ќњ™]љ\Ъ[Ы—JNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМ_Щ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМWJ\™]\›€›ЫZ\ЩKњ™Z™XЭ
\њ›ЬЉ	Ы›ЭYљXШ][Ы€[њЬЬќZ[Y	КJNЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМ—J\™]\›€™]И›ЫZ\ЩJ
™\ЫЫ™K™Z™XЭ
OOћЬ™Z™XЭ\™[ќ\™Z™XЭЯJNЬ™]\›€™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩQ›Э\ќ[ќ\™\ЫЫ™NЯJNЯK€™\љYћS]\ЭЉЬЩ\ЬЪ[Ыђљ[™[™ЯJOOћЭ™\љYљXШ][ЫњЛњ\Ъ
Щ\ЬЪ[Ыђљ[™[™ЛXШЫЭ[ќ™YЉNЬ™]\›€™]И›ЫZ\ЩJ
™\ЫЫ™K™Z™XЭ
OOћЪYЉЩ\ЬЪ[Ыђљ[™[™ПOOXXШЫЭ[ќЦМJ\™Z™XЭљ\њЭ™\љYљXШ][ЫЏ\™Z™XЭЩ[ЩH™Z™XЭЩXЫЫ™™\љYљXШ][ЫЏ\™Z™XЭЯJNЯB€JNВ€ЫЫњЭ[XЪСЫOT‹Ь™X]PЫЫ[X[™™YYXЪСЫPњљYЩJШЫЫ[X[™ZN™[XЪХZK[[Y[ќЛXЭ]]NXЭ[ЫЏOXЭ[ЫЏOOIЬ™X]]	ПЬ›Э]\‹›]љYШ]J	Ь›ЫIКN”›ЫZ\ЩKњ™\ЫЫ™JЬ›ШЩ\ЬЩY™[ЩK™X\ЫЫЋ‰ШXЭ[Ы—Ы›ЭШ]Z[X›IЯJ_JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYO”‹Ь™X]T›ЫTЩ\ќљXЩSY™XЮXЫJЬЩ\ќљXЩ\Ољ[љ™XЭY[[Y[ќЛ]™[ќ\™Щ]ШЭ[Y[ќЭ]NћЭљ\ЪXљ[]TЭ]N‰Эљ\ЪX›IЯK]љYШ]Nќ\™Щ]OњYЩOOO]\™Щ]Ыќ[њ›Э]\‹›]љYШ]J\™Щ]
KЭЬYЩN›Y[[ЬћTЭЬYЩJ
_JK™[™\•[]Z[X›NќљY]ПOћЩ[XЪХZKњЩ]›ЫJљY]Лњ›ЫJNЩ[XЪХZK\Q™YYXЪКљY]Лњ›ЫK[XЪХZKњЫ\ЪЭ

K™Щ[™\][Ы‹љY]Л›Э]ЫЫYKЭ]NќљY]Лќ]KY\ЬШYЩNќљY]Л›Y\ЬШYЩK\ШX›PЫЫ[X[™ОќљY]Л™\ШX›PЫЫ[X[™ЛXЭ[ЫЋќљY]ЛXЭ[ЫџJNЩ[XЪСЫK]XЪ

NЩ[XЪСЫKњ™[™\Љ
NЯKЫX\•[]Z[X›NЉ
OOћЩ[XЪХZKЫX\Љ
NЩ[XЪСЫK™]XЪ

NЯ_JNВ€›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]™XY\ЪЉ
OOњYЩK™\ЫЫ™Nќ\™Щ]YЩOOќ\™Щ]YЩOOOIЬ›ЫIПЮЬYЩN‰Ь›ЫIЛ›ЫN›ќ[NћЬYЩNќ\™Щ]YЩK›ЫN‰Щљ]™\‰ЯK™[™\Ћ™\Э[][ЫЏOћЬYЩOY\Э[][Ы‹њYЩNЯ_JNЬ›Э]\‹]XЪ

NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌLџJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™Z™XЭљ\њЭ™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКJKњ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМWNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[ЫњЦМWK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌLЯJJKњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—ЩZ[Y	КNЩ[[Y[ќЛXЭ[Ы‹™\Ь]Ъ
	ШЫXЪЙКNЭЪ[J\™Z™XЭЩXЫЫ™™\љYљXШ][ЫЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМ—NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNВ€ЫЫњЭ\™[ќ\ЭXњШЬљ\[ЫњЦМ—K›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌMJNЭЪ[J\™Z™XЭ\™[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏ[ќ[Щ]™[ќ\™Щ]™\Ь]Ъ
	ЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩY	КNЭЪ[Jќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы€OOIЬЩ\ЬЪ[Ы—Э[]Z[X›IКX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNЬЩ\ЬЪ[ЫЏXXШЫЭ[ќЦМЧNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШЫЫњЭ›Э\ќ[ќ\ЭXњШЬљ\[ЫњЦМЧK›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌM_JNЭЪ[J\™[X\ЩQ›Э\ќ[ќ
X]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNВ€ЫЫњЭ›Э\ќљY]П^Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKќ[ќ[YPXЭ[ЫЋњќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹›Э]\ђXЭ[ЫЋњ›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[ЫџNЬ™Z™XЭљ\њЭ™\љYљXШ][ЫЉ\њ›ЬЉ	ЫЫљ\њЭ™\љYљXШ][Ы€Z[Y	КJNЬ™Z™XЭЩXЫЫ™™\љYљXШ][ЫЉ\њ›ЬЉ	ЫЫЩXЫЫ™™\љYљXШ][Ы€Z[Y	КJNЬ™Z™XЭ\™[ќ
\њ›ЬЉ	ЫЫ\™›ЭYљXШ][Ы€Z[Y	КJNШЫЫњЭЭ[U\™X]ШZ]\™[ќШ]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШ\ЬЩ\ќ™\]X[
Э[U\™њ›ШЩ\ЬЩY[ЩJNШ\ЬЩ\ќ™\]X[
Э[U\™њ™X\ЫЫ‹	ШњљYЩWЬЭ[IКNШ\ЬЩ\ќ™Y\\]X[
Ш›ЮY[Ћ™[[Y[ќЛ›ЮљY[‹XЭ[Ы’Y[Ћ™[[Y[ќЛXЭ[Ы‹љY[‹\ШX›Y™[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y\Э[™\њО™[[Y[ќЛXЭ[Ы‹›\Э[™\ђЫЭ[ќ
	ШЫXЪЙКKќ[ќ[YPXЭ[ЫЋњќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹›Э]\ђXЭ[ЫЋњ›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[ЫџK›Э\ќљY]КNВ€™[X\ЩQ›Э\ќ[ќ
Ь›ШЩ\ЬЩYќќYK™X\ЫЫЋ‰Ы›ЭYљXШ][Ы—Ш\YY	ЯJNШЫЫњЭ›Э\ќX]ШZ]›Э\ќ[ќШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™\]X[
›Э\ќњ›ШЩ\ЬЩYќYJNШ\ЬЩ\ќ™\]X[
›Э\ќњ™X\ЫЫ‹	Ы›ЭYљXШ][Ы—Ш\YY	КNЩ›ЬЉЫЫњЭЭXњШЬљ\[Ы€Щ€ЭXњШЬљ\[ЫњЛњЫXЩJКJX\ЬЩ\ќ™\]X[

]ШZ]ЭXњШЬљ\[Ы‹›Ы’[ќ
Э\N‰ЬљYKЪ[™ЩY	ЛљYRY‰Щљ^\™K\љYIЛ™]љ\Ъ[ЫЋЌMџJJKњ™X\ЫЫ‹	ЬЭXњШЬљ\[Ы—Ъ[XЭ]™IКNШ\ЬЩ\ќ™Y\\]X[
[™YЦЙЩљ]™\‹XIЛL—KЙЩљ]™\‹X‰ЛLЧKЙЩљ]™\‹XЙЛMKЙЩљ]™\‹Y	ЛMWWJNШ\ЬЩ\ќ™Y\\]X[
™\љYљXШ][ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰ЧJNШ\ЬЩ\ќ™Y\\]X[
™XYЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЛ	Щљ]™\‹Y	ЧJNШ\ЬЩ\ќ™Y\\]X[
\ШЫЫ›™XЭ[ЫњЛЙЩљ]™\‹XIЛ	Щљ]™\‹X‰Л	Щљ]™\‹XЙЧJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛ›ЮљY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛXЭ[Ы‹љY[‹ќYJNШ\ЬЩ\ќ™\]X[
[[Y[ќЛЫЫ[X[™ќ]ЫњЦМK™\ШX›Y[ЩJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNЩ›ЬЉЫЫњЭXШЫЭ[ќЩ€XШЫЭ[ќКX\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJЬќ[ќ[YKњЫ\ЪЭ

K›Э]\‹њЫ\ЪЭ

K[XЪХZKњЫ\ЪЭ

WJKљ[ЫY\КXШЫЭ[ќXШЫЭ[ќ™YЉK[ЩJNВџJNВќ\Э
	Ь›ЫK\YЩHќ[ќ[YHЭЬИШY™[HЪ[€[љ™XЭYЩ\ќљXЩ\И\™H›ЭЫЫ™љYЭ\™Y	Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

KљY]ЬПVЧNЫ]XЭЬљY\ПLВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\О›ќ[Ь™X]SY™XЮXЫNЉ
OOћЩXЭЬљY\КПLNЯK™[™\•[]Z[X›NќљY]ПOќљY]ЬЛњ\Ъ
љY]К_JNВ€ЫЫњЭ™\Э[X]ШZ]ќ[ќ[YK™[ќ\Љ	ЪЫYIЛ	Ь\ЬЩ[™Щ\‰КNВ€\ЬЩ\ќ™\]X[
™\Э[™[ќ\™Y[ЩJNШ\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹	ЬЩ\ќљXЩ\ЧЭ[]Z[X›IКNШ\ЬЩ\ќ™\]X[
XЭЬљY\Л
NШ\ЬЩ\ќ™\]X[
љY]ЬЛ›[™ЭJNШ\ЬЩ\ќ™\]X[
љY]ЬЦМKњ›ЫK	Ь\ЬЩ[™Щ\‰КNШ\ЬЩ\ќ™\]X[
љY]ЬЦМK™\ШX›PЫЫ[X[™ЛќYJNШ\ЬЩ\ќ™\]X[
љY]ЬЦМKXЭ[Ы‹ќ[
NШ\ЬЩ\ќ›X]Ъ
љY]ЬЦМKќ]Kщ§*є*+yk¦‹КNШ\ЬЩ\ќ›X]Ъ
љY]ЬЦМK›Y\ЬШYЩKъ`&№/иxаkъ(c8аhшаiёаa8аoёаfша¤ЛКNВ€\ЬЩ\ќ™Y\\]X[
Шљ™XЭљЩ^\Кќ[ќ[YKњЫ\ЪЭ

JKњЫЬќ

KЙШXЭ]™T›ЫIЛ	Шќ\ЮIЛ	Ы\ЭXЭ[Ы‰Л	ЬYЩIЛ	Ь™]љ\Ъ[Ы‰Л	ЬЩ\ќљXЩTЭ]IЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KњЩ\ќљXЩTЭ]K	Э[ЫЫ™љYЭ\™Y	КNВџJNВќ\Э
	Ь\ќX[›ЫHЩ\ќљXЩH[љ™XЭ[Ы€Ш[››Э™HZ\ЭZЩ[€›Ь€H]™HЫЫ›™XЭ[Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

KљY]ЬПVЧNЫ]Щ\ЬЪ[ЫњПLXЭЬљY\ПLВ€ЫЫњЭЩ\ќљXЩ\П^ШЫЫ™љYЭ\™YќќYKЩ\ЬЪ[Ы‘›Ь”›ЫJ
^ЬЩ\ЬЪ[ЫњКПLNЬ™]\›€ЭљY]Щ\”›ЫN‰Щљ]™\‰ЯNЯ_NВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNЉ
OOћЩXЭЬљY\КПLNЯK™[™\•[]Z[X›NќљY]ПOќљY]ЬЛњ\Ъ
љY]К_JNВ€ЫЫњЭ™\Э[X]ШZ]ќ[ќ[YK™[ќ\Љ	Щљ]™\‹ZЫYIЛ	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹	ЬЩ\ќљXЩ\ЧЭ[]Z[X›IКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KњЩ\ќљXЩTЭ]K	Э[ЫЫ™љYЭ\™Y	КNШ\ЬЩ\ќ™\]X[
Щ\ЬЪ[ЫњЛ
NШ\ЬЩ\ќ™\]X[
XЭЬљY\Л
NШ\ЬЩ\ќ™\]X[
љY]ЬЦМKXЭ[Ы‹ќ[
NВџJNВќ\Э
	ШЫЫ™љYЭ\™Y›ЫK\YЩHќ[ќ[YH[ќ\њИЫЩH[™™\Щ\ќ™\И]ИЩ[™\][Ы€XЬ›ЬЬИ›ЫH]љYШ][Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

KЩ\ЬЪ[ЫЏ^ШXШЫЭ[ќ‰Ьљ]]K\\ЬЩ[™Щ\‰ЯKШ[ПVЧNЫ]XЭЬљY\ПLЫX\њПLВ€ЫЫњЭY™XЮXЫO^ЬЫ\ЪЭЉ
OOЉШXЭ]™T›ЫN‰Ь\ЬЩ[™Щ\‰ЯJK[ќ\Ћ\Ю[К›ЫKЬ[ЫњКOOћШШ[Лњ\Ъ
ЙЩ[ќ\‰Л›ЫKЬ[ЫњЛњЩ\ЬЪ[Ыђљ[™[™ЧJNЬ™]\›€Щ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯNЯKX]™NЉ
OOћШШ[Лњ\Ъ
ЙЫX]™IЧJNЬ™]\›€ЫYќќќY_NЯKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КЬЩ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[ЫџJNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNљ[љ™XЭYOћЩXЭЬљY\КПLNШ\ЬЩ\ќ™\]X[
[љ™XЭYЩ\ќљXЩ\КNЬ™]\›€Y™XЮXЫNЯKЫX\•[]Z[X›NЉ
OOћШЫX\њКПLNЯ_JNВ€\ЬЩ\ќ™\]X[

]ШZ]ќ[ќ[YK™[ќ\Љ	ЪЫYIЛ	Ь\ЬЩ[™Щ\‰КJKњ™X\ЫЫ‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[

]ШZ]ќ[ќ[YK™[ќ\Љ	Ь\ЬЩ[™Щ\‹Z\ЭЬћIЛ	Ь\ЬЩ[™Щ\‰КJKњ™X\ЫЫ‹	ЭЪ][—Ь›ЫIКNВ€\ЬЩ\ќ™\]X[
XЭЬљY\ЛJNШ\ЬЩ\ќ™\]X[
Ш[Л›[™ЭJNШ\ЬЩ\ќ™\]X[
Ш[ЦМVМ—KЩ\ЬЪ[ЫЉNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KњYЩK	Ь\ЬЩ[™Щ\‹Z\ЭЬћIКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Ь\ЬЩ[™Щ\‰КNШ\ЬЩ\ќ›ЪКЫX\њПЏLЉNШ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJќ[ќ[YKњЫ\ЪЭ

JKљ[ЫY\К	Ьљ]]K\\ЬЩ[™Щ\‰КK[ЩJNВ€ЫЫњЭYќ\ќ[ќ[YK›X]™J
NШ\ЬЩ\ќ™\]X[
Yќ›YќќYJNШ\ЬЩ\ќ™\]X[
Ш[Л]
LJVМK	ЫX]™IКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫKќ[
NВџJNВќ\Э
	ЫZ\ЬЪ[™И]][ќXШ]YЩ\ЬЪ[Ы€›ШЪЬИY™XЮXЫHЬ™X][Ы€[™[Щ\ќљXЩHKУЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

KљY]ЬПVЧNЫ]XЭЬљY\ПLВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КЬЩ\ЬЪ[Ы‘›Ь”›ЫNЉ
OO›ќ[JNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNЉ
OOћЩXЭЬљY\КПLNЯK™[™\•[]Z[X›NќљY]ПOќљY]ЬЛњ\Ъ
љY]К_JNВ€ЫЫњЭ™\Э[X]ШZ]ќ[ќ[YK™[ќ\Љ	Щљ]™\‹]љ\ЙЛ	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹	ЬЩ\ЬЪ[Ы—Э[]Z[X›IКNШ\ЬЩ\ќ™\]X[
XЭЬљY\Л
NШ\ЬЩ\ќ™\]X[
љY]ЬЦМKњ›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ›X]Ъ
љY]ЬЦМKќ]Kъ*Јz*/8а®шааша­шайшамЛКNШ\ЬЩ\ќ™\]X[
љY]ЬЦМK›Э]ЫЫYK	Ь™X]]	КNШ\ЬЩ\ќ™\]X[
љY]ЬЦМK™\ШX›PЫЫ[X[™ЛќYJNШ\ЬЩ\ќ™\]X[
љY]ЬЦМKXЭ[Ы‹	Ь™X]]	КNВџJNВќ\Э
	ШЫЫ™љYЭ\™YY™XЮXЫH[ќћHZ[\™HЭЬИ[™Ш[››Э™H™]\ЩY\И[€XЭ]™HYЩIЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

KЩ\ЬЪ[ЫЏ^ШXШЫЭ[ќ‰Ьљ]]IЯKљY]ЬПVЧNЫ][ќљY\ПLX]™\ПLВ€ЫЫњЭY™XЮXЫO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћ\Ю[К
OOћЩ[ќљY\КПLNЬ™]\›€Щ[ќ\™Y™[ЩK™X\ЫЫЋ‰Щ[ќћWЬ™Z™XЭY	ЯNЯKX]™NЉ
OOћЫX]™\КПLNЬ™]\›€ЫYќќќY_NЯKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КЬЩ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[ЫџJNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNЉ
OO›Y™XЮXЫK™[™\•[]Z[X›NќљY]ПOќљY]ЬЛњ\Ъ
љY]К_JNВ€ЫЫњЭљ\њЭX]ШZ]ќ[ќ[YK™[ќ\Љ	ЪЫYIЛ	Ь\ЬЩ[™Щ\‰КKЩXЫЫ™X]ШZ]ќ[ќ[YK™[ќ\Љ	Ь\ЬЩ[™Щ\‹Z\ЭЬћIЛ	Ь\ЬЩ[™Щ\‰КNВ€\ЬЩ\ќ™\]X[
љ\њЭњ™X\ЫЫ‹	Щ[ќћWЩZ[Y	КNШ\ЬЩ\ќ™\]X[
ЩXЫЫ™њ™X\ЫЫ‹	Щ[ќћWЩZ[Y	КNШ\ЬЩ\ќ™\]X[
[ќљY\ЛЉNШ\ЬЩ\ќ™\]X[
X]™\ЛЉNШ\ЬЩ\ќ™\]X[
љY]ЬЛ›[™ЭЉNШ\ЬЩ\ќ™\]X[
љY]ЬЦМKXЭ[Ы‹	Ь™X]]	КNШ\ЬЩ\ќ›X]Ъ
љY]ЬЦМKќ]Kъeўщiвшаiшаcxаoёаfша¤ЛКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќћWЩZ[Y	КNВџJNВќ\Э
	Ь›ЫHЭЪ]Ъ™Z™XЭИH[^YYЫќ[ќ[YH[ќћHЪ]Э]^ЬЪ[™ИЩ\ЬЪ[Ы€љ[™[™ЬЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\ЬЩ[™Щ\”Щ\ЬЪ[ЫЏ^ШXШЫЭ[ќ‰Ьљ]]KXIЯKљ]™\”Щ\ЬЪ[ЫЏ^ШXШЫЭ[ќ‰Ьљ]]KX‰ЯNЫ]™[X\ЩT\ЬЩ[™Щ\ЋВ€ЫЫњЭY™XЮXЫO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћњ›ЫOOњ›ЫOOOIЬ\ЬЩ[™Щ\‰ПЫ™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩT\ЬЩ[™Щ\Џ\™\ЫЫ™NЯJN”›ЫZ\ЩKњ™\ЫЫ™JЩ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯJKX]™NЉ
OOЉЫYќќќY_JKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КЬЩ\ЬЪ[Ы‘›Ь”›ЫNњ›ЫOOњ›ЫOOOIЬ\ЬЩ[™Щ\‰ПЬ\ЬЩ[™Щ\”Щ\ЬЪ[ЫЋ™љ]™\”Щ\ЬЪ[ЫџJNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNЉ
OO›Y™XЮXЫ_JNВ€ЫЫњЭЫ\ќ[ќ[YK™[ќ\Љ	ЪЫYIЛ	Ь\ЬЩ[™Щ\‰КNЭЪ[J\™[X\ЩT\ЬЩ[™Щ\ЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШЫЫњЭњ™\ЪX]ШZ]ќ[ќ[YK™[ќ\Љ	Щљ]™\‹ZЫYIЛ	Щљ]™\‰КNЬ™[X\ЩT\ЬЩ[™Щ\ЉЩ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯJNШЫЫњЭЭ[OX]ШZ]ЫВ€\ЬЩ\ќ™\]X[
њ™\Ъ™[ќ\™YќYJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ЬЭ[WЩ[ќћIКNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШЫЫњЭX›XФЭ]OR”УУ‹њЭљ[™ЪYћJќ[ќ[YKњЫ\ЪЭ

JNШ\ЬЩ\ќ™\]X[
X›XФЭ]Kљ[ЫY\К	Ьљ]]KXIКK[ЩJNШ\ЬЩ\ќ™\]X[
X›XФЭ]Kљ[ЫY\К	Ьљ]]KX‰КK[ЩJNВџJNВќ\Э
	Ь›ЫK\YЩH›Э]\€]XЪ\ИЫ™H\Ъ\Э[™\€[™›Э]\И]ИЭ\њ™[ќ\™Щ]	Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K[ќљY\ПVЧK™[™\њПVЧNЫ]\ЪIЪЫYIОВ€ЫЫњЭќ[ќ[YO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћ\Ю[КYЩK›ЫJOOћЩ[ќљY\Лњ\Ъ
ЬYЩK›ЫWJNЬ™]\›€Щ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯNЯKX]™NЉ
OOЉЫYќќќY_JKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OOљ\Ъ™\ЫЫ™NњYЩOOЉЬYЩK›ЫN‰Ь\ЬЩ[™Щ\‰ЯJK™[™\Ћќ[YOOњ™[™\њЛњ\Ъ
[YKњYЩJ_JNВ€\ЬЩ\ќ™\]X[
›Э]\‹]XЪ

KњЭ\ќYќYJNШ\ЬЩ\ќ™\]X[
›Э]\‹]XЪ

Kњ™X\ЫЫ‹	Ш[™XYWШ]XЪY	КNШ\ЬЩ\ќ™\]X[
\™Щ]›\Э[™\ђЫЭ[ќ
	Ъ\ЪЪ[™ЩIКKJNШ\ЬЩ\ќ™\]X[
\™Щ]YЫЭ[ќ
	Ъ\ЪЪ[™ЩIКKJNВ€\™Щ]™\Ь]Ъ
	Ъ\ЪЪ[™ЩIКNШ]ШZ]›Э]\‹љYJ
NШ\ЬЩ\ќ™Y\\]X[
[ќљY\ЛЦЙЪЫYIЛ	Ь\ЬЩ[™Щ\‰ЧWJNШ\ЬЩ\ќ™Y\\]X[
™[™\њЛЙЪЫYIЧJNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	ЪЫYIКNВџJNВќ\Э
	Ш›ЭЫK[Y[ќH]љYШ][Ы€™\Щ\ќ™\ИЫ™H[љ™XЭY›ЫHY™XЮXЫHЩ[™\][Ы‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

KЩ\ЬЪ[ЫЏ^ШXШЫЭ[ќ‰Ьљ]]IЯK™[™\њПVЧNЫ][ќљY\ПLВ€ЫЫњЭY™XЮXЫO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћ\Ю[К
OOћЩ[ќљY\КПLNЬ™]\›€Щ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯNЯKX]™NЉ
OOЉЫYќќќY_JKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭЩ\ќљXЩ\ПX[ЭЩY›ЫTЩ\ќљXЩ\КЬЩ\ЬЪ[Ы‘›Ь”›ЫNЉ
OOњЩ\ЬЪ[ЫџJNВ€ЫЫњЭќ[ќ[YOT‹Ь™X]T›ЫTYЩTќ[ќ[YJЬЩ\ќљXЩ\ЛЬ™X]SY™XЮXЫNЉ
OO›Y™XЮXЫ_JNВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OO‰ЙЛ™\ЫЫ™NњYЩOOЉЬYЩK›ЫN‰Ь\ЬЩ[™Щ\‰ЯJK™[™\Ћќ[YOOњ™[™\њЛњ\Ъ
[YKњYЩJ_JNВ€\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	ЪЫYIКJK›]љYШ]YќYJNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь\ЬЩ[™Щ\‹Z\ЭЬћIКJKњ™X\ЫЫ‹	ЭЪ][—Ь›ЫIКNШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	Ь\ЬЩ[™Щ\‹XXШЫЭ[ќ	КJKњ™X\ЫЫ‹	ЭЪ][—Ь›ЫIКNВ€\ЬЩ\ќ™\]X[
[ќљY\ЛJNШ\ЬЩ\ќ™Y\\]X[
™[™\њЛЙЪЫYIЛ	Ь\ЬЩ[™Щ\‹Z\ЭЬћIЛ	Ь\ЬЩ[™Щ\‹XXШЫЭ[ќ	ЧJNШ\ЬЩ\ќ™\]X[
ќ[ќ[YKњЫ\ЪЭ

Kњ™]љ\Ъ[Ы‹КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

Kњ™]љ\Ъ[Ы‹КNВџJNВќ\Э
	Ь›ЫHЪЫЬЩ\€X]™\ИHќ[ќ[YH™Y›Ь™H™[™\љ[™ИHЪЫЬЩ\‰Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

KЬ™\ЏVЧNВ€ЫЫњЭќ[ќ[YO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћ\Ю[К
OOЉЩ[ќ\™YќќY_JKX]™NЉ
OOћЫЬ™\‹њ\Ъ
	ЫX]™IКNЬ™]\›€ЫYќќќY_NЯKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OO‰ЙЛ™\ЫЫ™NЉ
OOЉЬYЩN‰Ь›ЫIЛ›ЫN›ќ[JK™[™\ЋЉ
OO›Ь™\‹њ\Ъ
	Ь™[™\‰К_JNВ€ЫЫњЭ™\Э[X]ШZ]›Э]\‹›]љYШ]J	Ь›ЫIКNШ\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹	Ь›ЫWШЪЫЬЩ\‰КNШ\ЬЩ\ќ™Y\\]X[
Ь™\‹ЙЫX]™IЛ	Ь™[™\‰ЧJNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KXЭ]™T›ЫKќ[
NВџJNВќ\Э
	Ь\Y›ЫH]љYШ][Ы€Ш[››Э™\Z[ќЬ€™\ЭЬ™HH[^YYЫYЩIЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

K™[™\њПVЧNЫ]™[X\ЩT\ЬЩ[™Щ\ЋВ€ЫЫњЭќ[ќ[YO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\ЋЉYЩK›ЫJOOњ›ЫOOOIЬ\ЬЩ[™Щ\‰ПЫ™]И›ЫZ\ЩJ™\ЫЫ™OOћЬ™[X\ЩT\ЬЩ[™Щ\Џ\™\ЫЫ™NЯJN”›ЫZ\ЩKњ™\ЫЫ™JЩ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯJKX]™NЉ
OOЉЫYќќќY_JKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OO‰ЙЛ™\ЫЫ™NњYЩOOЉЬYЩK›ЫNњYЩKњЭ\ќХЪ]
	Щљ]™\‹IКOЙЩљ]™\‰О‰Ь\ЬЩ[™Щ\‰ЯJK™[™\Ћќ[YOOњ™[™\њЛњ\Ъ
[YKњYЩJ_JNВ€ЫЫњЭЫ\›Э]\‹›]љYШ]J	ЪЫYIКNЭЪ[J\™[X\ЩT\ЬЩ[™Щ\ЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШЫЫњЭњ™\ЪX]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКNЬ™[X\ЩT\ЬЩ[™Щ\ЉЩ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯJNШЫЫњЭЭ[OX]ШZ]ЫВ€\ЬЩ\ќ™\]X[
њ™\Ъ›]љYШ]YќYJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ЬЭ[WЫ]љYШ][Ы‰КNШ\ЬЩ\ќ™Y\\]X[
™[™\њЛЙЪЫYIЛ	Щљ]™\‹ZЫYIЧJNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KXЭ]™T›ЫK	Щљ]™\‰КNВџJNВќ\Э
	Щ[^YYZ[\™Hњ›ЫHH\\ќY›ЫHШ[››Э™\XЩHHњ™\Ъ›Э]\€™\Э[	Л\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

NЫ]™Z™XЭ\ЬЩ[™Щ\ЋВ€ЫЫњЭќ[ќ[YO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\ЋЉYЩK›ЫJOOњ›ЫOOOIЬ\ЬЩ[™Щ\‰ПЫ™]И›ЫZ\ЩJ
™\ЫЫ™K™Z™XЭ
OOћЬ™Z™XЭ\ЬЩ[™Щ\Џ\™Z™XЭЯJN”›ЫZ\ЩKњ™\ЫЫ™JЩ[ќ\™YќќYK™X\ЫЫЋ‰Щ[ќ\™Y	ЯJKX]™NЉ
OOЉЫYќќќY_JKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OO‰ЙЛ™\ЫЫ™NњYЩOOЉЬYЩK›ЫNњYЩKњЭ\ќХЪ]
	Щљ]™\‹IКOЙЩљ]™\‰О‰Ь\ЬЩ[™Щ\‰ЯJK™[™\ЋЉ
OOћЯ_JNВ€ЫЫњЭЫ\›Э]\‹›]љYШ]J	ЪЫYIКNЭЪ[J\™Z™XЭ\ЬЩ[™Щ\ЉX]ШZ]™]И›ЫZ\ЩJ™\ЫЫ™OOњЩ][[YYX]J™\ЫЫ™JJNШЫЫњЭњ™\ЪX]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКNЬ™Z™XЭ\ЬЩ[™Щ\Љ\њ›ЬЉ	ЫЩ™›[™IКJNШЫЫњЭЭ[OX]ШZ]ЫВ€\ЬЩ\ќ™\]X[
њ™\Ъ›]љYШ]YќYJNШ\ЬЩ\ќ™\]X[
Э[Kњ™X\ЫЫ‹	ЬЭ[WЫ]љYШ][Ы‰КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

K›\ЭXЭ[Ы‹	Щ[ќ\™Y	КNШ\ЬЩ\ќ™\]X[
›Э]\‹њЫ\ЪЭ

KњYЩK	Щљ]™\‹ZЫYIКNВџJNВќ\Э
	Щ]XЪY›ЫK\YЩH›Э]\€YЫ›Ь™\Иќ]\™H\ЪЪ[™Щ\И[™X]™\И]Иќ[ќ[YIЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

NЫ][ќљY\ПLX]™\ПL\ЪIЪЫYIОВ€ЫЫњЭќ[ќ[YO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћ\Ю[К
OOћЩ[ќљY\КПLNЬ™]\›€Щ[ќ\™YќќY_NЯKX]™NЉ
OOћЫX]™\КПLNЬ™]\›€ЫYќќќY_NЯKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OOљ\Ъ™\ЫЫ™NњYЩOOЉЬYЩK›ЫN‰Ь\ЬЩ[™Щ\‰ЯJK™[™\ЋЉ
OOћЯ_JNЬ›Э]\‹]XЪ

NЬ›Э]\‹™]XЪ

NЭ\™Щ]™\Ь]Ъ
	Ъ\ЪЪ[™ЩIКNШ]ШZ]›ЫZ\ЩKњ™\ЫЫ™J
NВ€\ЬЩ\ќ™\]X[
[ќљY\Л
NШ\ЬЩ\ќ™\]X[
X]™\ЛJNШ\ЬЩ\ќ™\]X[
\™Щ]›\Э[™\ђЫЭ[ќ
	Ъ\ЪЪ[™ЩIКK
NШ\ЬЩ\ќ™\]X[

]ШZ]›Э]\‹›]љYШ]J	ЪЫYIКJKњ™X\ЫЫ‹	Ь›Э]\—Щ]XЪY	КNВџJNВќ\Э
	Ъ[ќ[Y›Э]\€\Э[][Ы€ЭЬИ™Y›Ь™H™[™\љ[™ИЬ€[ќ\љ[™ИЩ\ќљXЩ\ЙЛ\Ю[И

HO€В€ЫЫњЭФџO\Щ]\

K\™Щ]\™XЫЭ™\ћQ]™[ќ\™Щ]

NЫ][ќљY\ПL™[™\њПLВ€ЫЫњЭќ[ќ[YO^ЬЫ\ЪЭЉ
OOЉЯJK[ќ\Ћ\Ю[К
OOћЩ[ќљY\КПLNЬ™]\›€Щ[ќ\™YќќY_NЯKX]™NЉ
OOЉЫYќќќY_JKYN\Ю[К
OOЉЯJ_NВ€ЫЫњЭ›Э]\ЏT‹Ь™X]T›ЫTYЩT›Э]\ЉЬќ[ќ[YK]™[ќ\™Щ]ќ\™Щ]™XY\ЪЉ
OO‰ЙЛ™\ЫЫ™NЉ
OOЉЬYЩN‰Щљ]™\‹ZЫYIЛ›ЫN‰Ь\ЬЩ[™Щ\‰ЯJK™[™\ЋЉ
OOћЬ™[™\њКПLNЯ_JNВ€ЫЫњЭ™\Э[X]ШZ]›Э]\‹›]љYШ]J	Щљ]™\‹ZЫYIКNШ\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹	Ъ[ќ[YЩ\Э[][Ы‰КNШ\ЬЩ\ќ™\]X[
[ќљY\Л
NШ\ЬЩ\ќ™\]X[
™[™\њЛ
NВџJNВќ\Э
	Ь›ЭЭ\HЪЭИ]\ИЪ\™Y›ЭYЪЫ™H^XЪ]›ЫK\YЩH›Э]\‰Л

HO€В€\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKЭЪ[™ЭЧ‘љZљT›ЭЭ\TЩ\ќљXЩ\Чќ[КNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKФ—Ь™X]T›ЫTYЩT›Э]\—
КNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKЬ›ЫTYЩT›Э]\—]XЪ

KКNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKЩљZљN]]\Щ\ЬЪ[Ы‹XЪ[™ЩYКNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKШЫЫ[X[™™YYXЪСЫW]XЪ

KКNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKШЫX\•[]Z[X›N—

OO—ШЫЫ[X[™ZWЫX\—

NШЫЫ[X[™™YYXЪСЫW™]XЪ

NЧKКNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKЫ]љYШ]NњYЩOOњЭ]WњYЩOOO\YЩWЫќ[њЪЭЧ
YЩW
KКNШ\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKЩќ[Э[Ы€ЪЭЧ
\™Щ]
WЬ™]\›€›ЫTYЩT›Э]\—›]љYШ]W
\™Щ]
NЧKКNВџJNВќ\Э
	Ь›Щљ[H[™ЫЫќXЭЬ^[Y[ќ™Y™\™[Щ\ИЭ\ќљ]™H[€[‹YШЭ[Y[ќ›ЫHЭЪ]Ъ	Л

HO€В€ЫЫњЭЫ_O\Щ]\

K\\ЬЩ[™Щ\ЉJNВ€K›X]™J
NИKЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNВ€\ЬЩ\ќ™\]X[
KњЭ]Kњ›Щљ[KљYљY
NВ€ЫЫњЭЏ[Kњ™\]Y\ЭљYJЬXЪЭ\њњXЪЭ\\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€\ЬЩ\ќ™\]X[
‹њ\ЬЩ[™Щ\“[YK	Ф™]љY]ИЭY\Э	КNИ\ЬЩ\ќ™\]X[
‹›[™ЭXYЩK	ЪIКNИ\ЬЩ\ќ™\]X[
‹њ^[Y[ќ	ШШ\™	КNВџJNВќ\Э
	Ы™]И\XШ][Ы€Ш[››Э[љ™XЭ\›Э[Ь€[X›H][Э[™ЙЛ

HO€В€ЫЫњЭЫKџO\Щ]\

NИKЪЫЬЩT›ЫJ	Щљ]™\‰КNВ€Kњ™YЪ\Э\‘љ]™\ЉЛ‹‹\XШ][ЫЉЉKЭ]\О‰Ь™]љY]ЩY	Л\›Э™YќќYK[YЪX›NќќY_JNВ€\ЬЩ\ќ™\]X[
K™Ш]J
K™[YЪX›K[ЩJNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЩ]Ы›[™JќYJJNВ€\ЬЩ\ќ™\]X[
K™љ]™\”™\]Y\ЭК
K›[™Э
NВ€\ЬЩ\ќќ›ЭЬК

OO›KњЭX›Z]Щ™™\Љ	ЬШ[\KXЪ]IЛЩ\™N‰МЊ	Л]N‰НIЯJJNВџJNВќ\Э
	Ь™]љY]ЩY[[ИXШЫЭ[ќЩ\И›Э\›Э™HHЩ\\][HЭX›Z]Y\XШ][Ы‰Л

HO€В€ЫЫњЭЫKџO\Щ]\

NИKЪЫЬЩT›ЫJ	Щљ]™\‰КNИЫЫњЭ[Kњ™YЪ\Э\‘љ]™\Љ\XШ][ЫЉЉJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
K™Ш]J
K™[YЪX›KќYJNВ€K›X]™J
NИKЪЫЬЩT›ЫJ	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
KњЭ]Kњ›Щљ[KљYљY
NИ\ЬЩ\ќ™\]X[
K™Ш]J
K™[YЪX›K[ЩJNВџJNВќ\Э
	Ь][Э[™И\И›Э\ЬЪYЫ›Y[ќИЩ[XЭ[Ы€™\Щ\ќ™\ИHYЬ™YY][ЭHЫ\ЪЭ	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭЏ[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKњЩ]Ы›[™JќYJNВ€ЫЫњЭП[KњЭX›Z]Щ™™\Љ‹љYЩ\™N‰МЊЛЌL	Л]N‰НЙЯJNВ€\ЬЩ\ќ™\]X[
K™љ]™\•љ\К
K›[™Э
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKњЩ[XЭЩ™™\ЉЛљY
NВ€\ЬЩ\ќ™\]X[
‹њ][ЭTЫ\ЪЭ™\™PЩ[ќЛЊНL
NИ\ЬЩ\ќ™\]X[
‹њ][ЭTЫ\ЪЭ™]KКNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЛљY
JNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
K™љ]™\•љ\К
K›[™ЭJNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЭX›Z]Щ™™\Љ‹љYЩ\™N‰ММ	Л]N‰НIЯJJNВ€\ЬЩ\ќ™\]X[
‹њ][ЭTЫ\ЪЭ™\™PЩ[ќЛЊНL
NВџJNВќ\Э
	ЬљYHШ[››ЭЭ\ќЪ]Э]ЫЫ™љ\›X][Ы€Щ€H›ЫЪЩY™ZXЫH[™љ]™\‰Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NВ€\ЬЩ\ќќ›ЭЬК

OO›KЫЫ™љ\›U™ZXЫJљYKљY	СSSИ‰ЛќYKќYJJNВ€\ЬЩ\ќќ›ЭЬК

OO›KЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛ[ЩKќYJJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€\ЬЩ\ќ™\]X[
љYKњЭ]\Л	Ш\њљ]љ[™ЙКNИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NИ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ЫЫ—Эљ\	КNВ€KY[ЩUљ\
љYKљY
NИ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ШЫЫ\]Y	КNВџJNВќ\Э
	Щ^\™Y][Э\И[™™]›ЪЩY[YЪXљ[]H\™H™XЪXЪЩY]Щ[XЭ[Ы‰Л

HO€В€›ЬЉЫЫњЭ™X\ЫЫ€Щ€ЙЩ^\™Y	Л	Ь™]›ЪЩY	ЧJHВ€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭЏ[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€ЫЫњЭП[K™Щ]Щ™™\њК‹љY
VМNВ€YЉ™X\ЫЫЏOOIЩ^\™Y	КHЛ™^\™\Р]Q]K››ЭК
KLNВ€[ЩHKњЭ]Kњ™XЫЬ™Л™љ[™
OћљYOO[Л™љ]™\’Y
KњЭ]\ПIЬЭ\Ь[™Y	ОВ€\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЛљY
JNИ\ЬЩ\ќ™\]X[
‹њЭ]\Л	ШЫЫXЭ[™ЙКNВ€BџJNВќ\Э
	ШЪ[™Ъ[™ИHЫЫXЭ[™И›Э]H[ќ[Y]\ИX\›Y\€][Э\ЙЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭљ\њЭ[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЫ[K™Щ]Щ™™\њКљ\њЭљY
VМNВ€Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[ИЭЫ‰ЯJNВ€\ЬЩ\ќ™\]X[
љ\њЭњЭ]\Л	ШШ[Щ[Y	КNИ\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЫљY
JNВџJNВќ\Э
	ЩY][™ИXЪЭ\\Э[][Ы€Ь€ШЪY[H[[YYX][H[ќ[Y]\ИHXЭ]™HЩX\Ъ[™][Э\ЙЛ

HO€В€›ЬЉЫЫњЭШЪ[™Щ\Л™X\ЫЫ—HЩ€ЦЮЬXЪЭ\‰У™]ИЭ[	ЯK	Ь›Э]WШЪ[™ЩY	ЧKЮЩ\Э[][ЫЋ‰С[[ИЭЫ‰ЯK	Ь›Э]WШЪ[™ЩY	ЧKЮЬXЪЭ\]›™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
_K	ЬШЪY[WШЪ[™ЩY	ЧWJ^В€ЫЫњЭЫ_O\Щ]\

NЬ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМNВ€ЫЫњЭ™\Э[[Kљ[ќ[Y]TљYTЩX\Ъ
љYKљYЪ[™Щ\КNВ€\ЬЩ\ќ™\]X[
™\Э[љ[ќ[Y]YќYJNШ\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹™X\ЫЫЉNШ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ШШ[Щ[Y	КNШ\ЬЩ\ќ™\]X[
љYKШ[Щ[™X\ЫЫ‹™X\ЫЫЉNВ€\ЬЩ\ќ›ЪКKњЭ]K›Щ™™\њЛ™љ[\ЉПO›Лњ™\]Y\ЭYOO\љYKљY
K™]™\ћJПO›ЛњЭ]\ПOOIЩ^\™Y	КJNШ\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЩ™™\‹љY
JNВ€B€\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKЬЭ]WЭ\њ™[ќ™\]Y\Э[ќ[ЬЭ]W™^XЭYY[ќ[ЬЭ]WњЩ[XЭY[ќ[Ч	
	Ы]™K\Э[[X\ћIЧ
WљY[Џ]ќYNЧ	
	ЫЩ™™\њЙЧ
Wњ™\XЩPЪ[™[—

NШЫX\“[™\Ч

NЛКNВџJNВќ\Э
	ШШ[Щ[Y\ЭЬћH\Э[™ЭZ\Ъ\И›Э]HY]ЛШЪY[HY]И[™^XЪ]Ш[Щ[][Ы‰Л

HO€В€ЫЫњЭФџO\Щ]\

NВ€\ЬЩ\ќ™Y\\]X[
Л‹‹”‹Ш[Щ[][Ы”™X\ЫЫ•љY]К	Ь›Э]WШЪ[™ЩY	К_KЪЪ[™‰ЬЩX\ЪШЪ[™ЩIЛY\ЬШYЩN‰щ.eъ.в№g,9а®xаoёаgшаkъ(c8аcyab8аk№i"y¦н8аjшаў8аўёа xаdшаk№/§zh/8а¤№cеёаў№­ў8аeшаoёаeшаgша ‰ЯJNВ€\ЬЩ\ќ™Y\\]X[
Л‹‹”‹Ш[Щ[][Ы”™X\ЫЫ•љY]К	ЬШЪY[WШЪ[™ЩY	К_KЪЪ[™‰ЬШЪY[WШЪ[™ЩIЛY\ЬШYЩN‰щ.ў9н!9Ґйy¦`ёаk№i"y¦н8аjшаў8аўёа xаdшаk№/§zh/8а¤№cеёаў№­ў8аeшаoёаeшаgша ‰ЯJNВ€\ЬЩ\ќ™Y\\]X[
Л‹‹”‹Ш[Щ[][Ы”™X\ЫЫ•љY]К	Ь\ЬЩ[™Щ\—Ь™\]Y\ЭY	К_KЪЪ[™‰Ь\ЬЩ[™Щ\‰ЛY\ЬШYЩN‰щb*yе*: !xаc9/§zh/8а¤№cеёаў№­ў8аeшаoёаeшаgша ‰ЯJNВ€\ЬЩ\ќ™Y\\]X[
Л‹‹”‹Ш[Щ[][Ы”™X\ЫЫ•љY]К	Э[\\™Y	К_KЪЪ[™‰Э[љЫ›ЭЫ‰ЛY\ЬШYЩN‰шаdшаk№/§zh/8аkщcеёаў№­ў8аexаЈ8аoёаeшаgша ‰ЯJNВ€\ЬЩ\ќ›X]Ъ
ЫЭ\ЩKШЫЫњЭ™X\ЫЫЏT—Ш[Щ[][Ы”™X\ЫЫ•љY]Ч
—Ш[Щ[™X\ЫЫ—
NЦЧЧЧJЏЩ\ШЧ
™X\ЫЫ—›Y\ЬШYЩW
KКNВџJNВќ\Э
	Э[Ъ[™ЩYЩX\Ъ[њ]\И™]Z[™Y[™\ЬЪYЫ™YљY\ИШ[››Э™HЪ[[ќHY]Y	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NЬ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМNВ€\ЬЩ\ќ™Y\\]X[
Л‹‹›Kљ[ќ[Y]TљYTЩX\Ъ
љYKљYЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛZ\њЬќ™[ЩKXЪЭ\]›ќ[J_KЪ[ќ[Y]Y™[ЩK™X\ЫЫЋ‰Э[Ъ[™ЩY	ЯJNВ€\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ШЫЫXЭ[™ЙКNШ\ЬЩ\ќ™\]X[
Щ™™\‹њЭ]\Л	ШXЭ]™IКNВ€KњЩ[XЭЩ™™\ЉЩ™™\‹љY
NВ€\ЬЩ\ќќ›ЭЬК

OO›Kљ[ќ[Y]TљYTЩX\Ъ
љYKљYЬXЪЭ\‰У™]ИЭ[	ЯJKъ`n9ў§№®"8аoшаощ.eъ.в№.+KКNШ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	Ш\ЬЪYЫ™Y	КNШ\ЬЩ\ќ™\]X[
љYKњXЪЭ\	С[[ИЭ[	КNВџJNВќ\Э
	ШH]\€™ZXЫHZ\ЫX]Ъ™]›ЪЩ\И[€X\›Y\€ЫЫ™љ\›X][Ы‰Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€\ЬЩ\ќќ›ЭЬК

OO›KЫЫ™љ\›U™ZXЫJљYKљY	СSSИ‰ЛќYKќYJJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NВ€\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
K	ФЭ\ќ]\Э™[XZ[€›ШЪЩYYќ\€H™]ИZ\ЫX]Ъ	КNВџJNВ‚ќ\Э
	ЭЪ]]Ъ[™ИZ]\€Y[ќ]HЪXЪИ™\]Z\™\ИHњ™\ЪЭXШЩ\ЬЩќ[ЫЫ™љ\›X][Ы‰Л

HO€В€›ЬЉЫЫњЭЪXЪЬИЩ€ЦЩ[ЩKќYWKЭќYK[ЩWWJHВ€ЫЫњЭЫKљY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€\ЬЩ\ќќ›ЭЬК

OO›KЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛ‹‹ЪXЪЬКJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩJNИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
KќYJNВ€KY[ЩUљ\
љYKљY
NИ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ЫЫ—Эљ\	КNВ€BџJNВќ\Э
	ЩY][™ИШњЩ\ќ™Y™ZXЫH[™›Ь›X][Ы€ЫX\њИЫЫ™љ\›X][Ы€™Y›Ь™H[›Э\€ЫЪЭ\	Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€Kљ[ќ[Y]U™ZXЫPЫЫ™љ\›X][ЫЉљYKљY
NВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩJNИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВџJNВќ\Э
	Щљ]™\њИ[™[њ™[]Y\ЬЩ[™Щ\њИШ[››ЭЫX\€[›Э\€\ЬЩ[™Щ\€ЫЫ™љ\›X][Ы‰Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќќ›ЭЬК

OO›Kљ[ќ[Y]U™ZXЫPЫЫ™љ\›X][ЫЉљYKљY
Kшаdшаk№¤гy/gКNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNВ€ЫЫњЭЭЫ™\Џ[KњЭ]Kњ›Щљ[NИKњЭ]Kњ›Щљ[O^Л‹‹›ЭЫ™\‹Y‰Э[њ™[]Y\\ЬЩ[™Щ\‰ЯNВ€\ЬЩ\ќќ›ЭЬК

OO›Kљ[ќ[Y]U™ZXЫPЫЫ™љ\›X][ЫЉљYKљY
Kшаdшаk№/§zh/КNВ€KњЭ]Kњ›Щљ[O[ЭЫ™\ЋИ\ЬЩ\ќ™\]X[
љYKќ™ZXЫPЫЫ™љ\›YYќYJNВџJNВќ\Э
	Ш[€\›Э™Y™\XЩ[Y[ќ™ZXЫKљ]™\‹Ь€Ъ[™ЩY\ЬЪYЫ›Y[ќ™YYИH™]ИЫЫ™љ\›X][Ы‰Л

HO€В€›ЬЉЫЫњЭЪ[™Щ€ЙЭ™ZXЫIЛ	Щљ]™\‰Л	ЪЫ\‰Л	Ш\X\[ЩIЛ	Ш\ЬЪYЫ›Y[ќ	Л	ЫЩ™™\‰Л	ЬШЪY[IЧJHВ€ЫЫњЭЫK‹љY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€ЫЫњЭ™XЫЬ™[KњЭ]Kњ™XЫЬ™Л™љ[™
OћљYOO\љYK™љ]™\’Y
NВ€YЉЪ[™OOIЭ™ZXЫIКH™XЫЬ™ќ™ZXЫRYIЬ™\XЩ[Y[ќ]™ZXЫIОВ€YЉЪ[™OOIЩљ]™\‰КH™XЫЬ™™љ]™\’YIЬ™\XЩ[Y[ќYљ]™\‰ОВ€YЉЪ[™OOIЪЫ\‰КH™XЫЬ™љЫ\’YIЬ™\XЩ[Y[ќZЫ\‰ОВ€YЉЪ[™OOIШ\X\[ЩIКH™XЫЬ™ЫЫЬЏIЩY™™\™[ќXЫЫЬ‰ОВ€YЉЪ[™OOIШ\ЬЪYЫ›Y[ќ	КHљYK\ЬЪYЫ›Y[ќ™]љ\Ъ[ЫЉКОВ€YЉЪ[™OOIЫЩ™™\‰КHљYKњЩ[XЭYЩ™™\’YIЬ™\XЩ[Y[ќ[Щ™™\‰ОВ€YЉЪ[™OOIЬШЪY[IКHљYKњXЪЭ\][™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
NВ€›ЬЉЫЫњЭШИЩ€Шљ™XЭќ[Y\К™XЫЬ™™ШЭ[Y[ќКJHШЛљ[™[™П\™XЫЬ™љЫ\’Y
ЙЛЙКЬ™XЫЬ™ќ™ZXЫRY
ЙЛЙКЬ™XЫЬ™™љ]™\’YВ€\ЬЩ\ќ™\]X[
‹\ЬЩ\ЬК™XЫЬ™
K™[YЪX›KќYK	Э\Э™\XЩ[Y[ќ™]Z[њИ[YЭ\њ™[ќ]љY[ЩIКNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩKЪ[™
NИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВ€BџJNВќ\Э
	ШH›ЫЫX[€›YИЪ]Э]HX]Ъ[™ИЫЫ™љ\›X][Ы€™XЫЬ™Ш[››ЭЭ\ќHљYIЛ

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€љYKќ™ZXЫPЫЫ™љ\›YY]ќYNВ€\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩJNИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВџJNВќ\Э
	Ь™]›ШШ][Ы€Yќ\€HЭXШЩ\ЬЩќ[ЪXЪИЭ[›ШЪЬИљYHЭ\ќ	Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€KњЭ]Kњ™XЫЬ™Л™љ[™
OћљYOO\љYK™љ]™\’Y
KњЭ]\ПIЬЭ\Ь[™Y	ОВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩJNИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВџJNВ‚ќ\Э
	Ь\ЬЩ[™Щ\€Ш[Щ[ИHЫЫXЭ[™И™\]Y\Э[™[Э[H][Э\И™XЫЫYH[ќ\ШX›IЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМNВ€KШ[Щ[љYJљYKљY
NВ€\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ШШ[Щ[Y	КNИ\ЬЩ\ќ™\]X[
K™Щ]Щ™™\њКљYKљY
K›[™Э
NВ€\ЬЩ\ќ›ЪКKњЭ]K›Щ™™\њЛ™љ[\ЉПO›Лњ™\]Y\ЭYOO\љYKљY
K™]™\ћJПO›ЛњЭ]\ПOOIЩ^\™Y	КJNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЩ™™\‹љY
JNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKњЩ]Ы›[™JќYJNВ€\ЬЩ\ќ›ЪК[K™љ]™\”™\]Y\ЭК
KњЫЫYJЏOњ‹љYOO\љYKљY
JNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЭX›Z]Щ™™\ЉљYKљYЩ\™N‰МЌIЛ]N‰МЙЯJJNВџJNВќ\Э
	Ш\ЬЪYЫ™YШ[Щ[][Ы€™\Щ\ќ™\ИHYЬ™YYљXЩH[™љ]™\€\ЭЬћK›Э™ZXЫH›ЫЩ‰Л

HO€В€ЫЫњЭЫKљYKЩ™™\џO\Щ[XЭY

KЫ\ЪЭ\љYKњ][ЭTЫ\ЪЭљ]™\’Y\љYK™љ]™\’YВ€KЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€KШ[Щ[љYJљYKљY
NВ€\ЬЩ\ќ™\]X[
љYKњ][ЭTЫ\ЪЭЫ\ЪЭ
NИ\ЬЩ\ќ›ЪКШљ™XЭљ\Сњ›Ю™[ЉЫ\ЪЭ
JNВ€\ЬЩ\ќ™\]X[
Ы\ЪЭ™\™PЩ[ќЛЊНL
NИ\ЬЩ\ќ™\]X[
Ы\ЪЭ™]KКNВ€\ЬЩ\ќ™\]X[
љYK™љ]™\’Yљ]™\’Y
NИ\ЬЩ\ќ™\]X[
љYKњЩ[XЭYЩ™™\’YЩ™™\‹љY
NВ€\ЬЩ\ќ™\]X[
Щ™™\‹њЭ]\Л	Щ^\™Y	КNИ\ЬЩ\ќ™\]X[
љYKќ™ZXЫPЫЫ™љ\›YY[ЩJNИ\ЬЩ\ќ™\]X[
љYKќ™ZXЫPЫЫ™љ\›X][Ы‹ќ[
NВ€\ЬЩ\ќ™\]X[
љYKШ[Щ[Yњ›ЫK	Ш\ЬЪYЫ™Y	КNИ\ЬЩ\ќ™\]X[
љYKШ[Щ[YћK	Ь\ЬЩ[™Щ\‰КNВ€\ЬЩ\ќ›ЪКќ[X™\‹љ\Сљ[љ]J]Kњ\њЩJљYKШ[Щ[Y]
JJNВ€\ЬЩ\ќќ›ЭЬК

OO›KЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
K™љ]™\•љ\К
VМKљYJNВ€\ЬЩ\ќ™\]X[
KњЭ]K›Ы›[™VЩљ]™\’YK[ЩJNИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩJNВ€\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВџJNВќ\Э
	ШШ[Щ[][Ы€\љ[™ИXЪЭ\Ъ[њИЭ™\€HЭ[HљYK\Э\ќXЭ[Ы€]™[€Yќ\€ЫЫ™љ\›X][Ы‰Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€KШ[Щ[љYJљYKљY
NИ\ЬЩ\ќ™\]X[
љYKШ[Щ[Yњ›ЫK	Ш\њљ]љ[™ЙКNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
KШ[”Э\ќљ\
љYKљY
K[ЩJNИ\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљY
JNВџJNВќ\Э
	ШШ[Щ[][Ы€™\]Z\™\ИHЭЫљ[™И\ЬЩ[™Щ\€[™HЫ›ЭЫ€™\]Y\Э	Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJљYKљY
Kшаdшаk№¤гy/gКNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИЫЫњЭЭЫ™\Џ[KњЭ]Kњ›Щљ[NВ€KњЭ]Kњ›Щљ[O^Л‹‹›ЭЫ™\‹Y‰Э[њ™[]Y\\ЬЩ[™Щ\‰ЯNИ\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJљYKљY
Kшаdшаk№/§zh/8а¤№cеёаў№­ў8аfшаoёаfша¤ЛКNВ€KњЭ]Kњ›Щљ[O[ЭЫ™\ЋИ\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJ	ЫZ\ЬЪ[™Л\љYIКKшаdшаk№/§zh/8а¤№cеёаў№­ў8аfшаoёаfша¤ЛКNВ€\ЬЩ\ќ™\]X[
љYKњЭ]\Л	Ш\ЬЪYЫ™Y	КNИ\ЬЩ\ќ™\]X[
љYKШ[Щ[Y][™Yљ[™Y
NВ€K›X]™J
NИ\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJљYKљY
Kшаdшаk№¤гy/gКNВџJNВќ\Э
	Ь™\X]YШ[Щ[][Ы€\ИY[\Э[ќ[™Ш[››Э™H\™›Ь›YYћH[›Э\€\ЬЩ[™Щ\‰Л

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИKШ[Щ[љYJљYKљY
NИЫЫњЭљ\њЭR”УУ‹њЭљ[™ЪYћJљYJNВ€\ЬЩ\ќ™\]X[
KШ[Щ[љYJљYKљY
KљYJNИ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJљYJKљ\њЭ
NВ€KњЭ]Kњ›Щљ[O^Л‹‹›KњЭ]Kњ›Щљ[KY‰Э[њ™[]Y\\ЬЩ[™Щ\‰ЯNИ\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJљYKљY
JNВ€\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJљYJKљ\њЭ
NВџJNВќ\Э
	Ш[€[™XYHЭ\ќYЬ€ЫЫ\]YљYHШ[››Э™HШ[Щ[Yњ›ЫHHЭ[HX[ЩЙЛ

HO€В€›ЬЉЫЫњЭЭ]\ИЩ€ЙЫЫ—Эљ\	Л	ШЫЫ\]Y	ЧJHВ€ЫЫњЭЫKљY_O\Щ[XЭY

NИKЫЫ™љ\›U™ZXЫJљYKљY	СSSИIЛќYKќYJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљY
NИKY[ЩUљ\
љYKљY
NВ€YЉЭ]\ПOOIШЫЫ\]Y	КHKY[ЩUљ\
љYKљY
NВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИЫЫњЭ™Y›Ь™OR”УУ‹њЭљ[™ЪYћJљYJNВ€\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJљYKљY
Kщ.eъ.вєeўщiвщoЈ8аощkЈ9.Ў№oЈКNИ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJљYJK™Y›Ь™JNВ€BџJNВќ\Э
	ШYќ\€Ш[Щ[][Ы€H™]ИљYHШ[€™H™\]Y\ЭY[™Hљ]™\€^XЪ]H™\Э[Y\И™XЩZ]љ[™И™\]Y\ЭЙЛ

HO€В€ЫЫњЭЫKљYKЩ™™\џO\Щ[XЭY

NИKШ[Щ[љYJљYKљY
NВ€ЫЫњЭ™^[Kњ™\]Y\ЭљYJЬXЪЭ\њљYKњXЪЭ\\Э[][ЫЋњљYK™\Э[][ЫџJNВ€\ЬЩ\ќ››Э\]X[
™^љYљYKљY
NИ\ЬЩ\ќ™\]X[
™^њЭ]\Л	ШЫЫXЭ[™ЙКNВ€\ЬЩ\ќ™\]X[
K›^T™\]Y\ЭК
K›[™ЭЉNИ\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЩ™™\‹љY
JNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
K™љ]™\”™\]Y\ЭК
K›[™Э
NВ€KњЩ]Ы›[™JќYJNИ\ЬЩ\ќ›ЪКK™љ]™\”™\]Y\ЭК
KњЫЫYJЏOњ‹љYOO[™^љY
JNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЭX›Z]Щ™™\ЉљYKљYЩ\™N‰МЊ	Л]N‰НIЯJJNВ€KњЭX›Z]Щ™™\Љ™^љYЩ\™N‰МЊ	Л]N‰НIЯJNВџJNВќ\Э
	Ь›Э]H™\XЩ[Y[ќ™XЫЬ™ИH\Э[ЭШ[Щ[][Ы€™X\ЫЫ€[™[ќ[Y]\ИHЫ™\]Y\Э	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭљ\њЭ[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[ИЭЫ‰ЯJNВ€\ЬЩ\ќ™\]X[
љ\њЭШ[Щ[™X\ЫЫ‹	Ь›Э]WШЪ[™ЩY	КNИ\ЬЩ\ќ™\]X[
љ\њЭШ[Щ[Yњ›ЫK	ШЫЫXЭ[™ЙКNВ€ЫЫњЭ]Yљ\њЭШ[Щ[Y]ИKШ[Щ[љYJљ\њЭљY
NИ\ЬЩ\ќ™\]X[
љ\њЭШ[Щ[™X\ЫЫ‹	Ь›Э]WШЪ[™ЩY	КNИ\ЬЩ\ќ™\]X[
љ\њЭШ[Щ[Y]]
NВџJNВ‚ќ\Э
	ШHќ]\™HXЪЭ\[YH\И›Ь›X[^™Y[™Ъ\™YЪ][€[YЪX›Hљ]™\‰Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭXЪЭ\][™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
NВ€ЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]JNВ€\ЬЩ\ќ™\]X[
љYKњXЪЭ\]XЪЭ\]
NВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKњЩ]Ы›[™JќYJNВ€\ЬЩ\ќ™\]X[
K™љ]™\”™\]Y\ЭК
K™љ[™
ЏOњ‹љYOO\љYKљY
KњXЪЭ\]XЪЭ\]
NВџJNВќ\Э
	Ъ[[YYX]HљY\И™[XZ[€^XЪ][™И›Э[љ\љ][€X\›Y\€ШЪY[IЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭШЪY[Y[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]›™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
_JNВ€ЫЫњЭ[[YYX]O[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€\ЬЩ\ќ™\]X[
[[YYX]KњXЪЭ\]ќ[
NИ\ЬЩ\ќ››Э\]X[
[[YYX]KљYШЪY[YљY
NВ€\ЬЩ\ќ™\]X[
ШЪY[YњЭ]\Л	ШШ[Щ[Y	КNИ\ЬЩ\ќ™\]X[
ШЪY[YШ[Щ[™X\ЫЫ‹	ЬШЪY[WШЪ[™ЩY	КNВџJNВќ\Э
	Ъ[ќ[YЬ€\ЭXЪЭ\[Y\И\™H™Z™XЭYЪ]Э]Ь™X][™ИЬ€™\XЪ[™ИH™\]Y\Э	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭЫЭ[ќ[KњЭ]Kњ™\]Y\ЭЛ›[™ЭВ€›ЬЉЫЫњЭXЪЭ\]Щ€ЙЫ›ЭXKY]IЛ™]И]J]K››ЭК
KMЊ
KќТTУФЭљ[™К
WJHВ€\ЬЩ\ќќ›ЭЬК

OO›Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]JKщгп№g*8аў8аў№oЈКNВ€\ЬЩ\ќ™\]X[
KњЭ]Kњ™\]Y\ЭЛ›[™ЭЫЭ[ќ
NВ€BџJNВќ\Э
	ЭHШ[YHШЪY[Y™\]Y\Э\ИY[\Э[ќЪ[HHЪ[™ЩY[YH™\XЩ\И]	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNВ€ЫЫњЭљ\њЭ][™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
NВ€ЫЫњЭЩXЫЫ™][™]И]J]K››ЭК
JНМЊ
KќТTУФЭљ[™К
NВ€ЫЫњЭљ\њЭ[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]™љ\њЭ]JNВ€\ЬЩ\ќ™\]X[
Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]™љ\њЭ]JKљ\њЭ
NВ€ЫЫњЭЩXЫЫ™[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]њЩXЫЫ™]JNВ€\ЬЩ\ќ™\]X[
љ\њЭњЭ]\Л	ШШ[Щ[Y	КNИ\ЬЩ\ќ™\]X[
љ\њЭШ[Щ[™X\ЫЫ‹	ЬШЪY[WШЪ[™ЩY	КNВ€\ЬЩ\ќ™\]X[
ЩXЫЫ™њXЪЭ\]ЩXЫЫ™]
NИ\ЬЩ\ќ™\]X[
ЩXЫЫ™њЭ]\Л	ШЫЫXЭ[™ЙКNВџJNВќ\Э
	ЬЩ[XЭ[Ы€Ы\ЪЭИHШЪY[YXЪЭ\[Ы™ЬЪYHHYЬ™YY][ЭIЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭXЪЭ\][™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
NВ€ЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]JNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKњЩ]Ы›[™JќYJNИЫЫњЭЩ™™\Џ[KњЭX›Z]Щ™™\ЉљYKљYЩ\™N‰МЊЛЌL	Л]N‰НЙЯJNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKњЩ[XЭЩ™™\ЉЩ™™\‹љY
NВ€\ЬЩ\ќ™\]X[
љYKњXЪЭ\]XЪЭ\]
NИ\ЬЩ\ќ™\]X[
љYKњ][ЭTЫ\ЪЭњXЪЭ\]XЪЭ\]
NВ€\ЬЩ\ќ›ЪКШљ™XЭљ\Сњ›Ю™[ЉљYKњ][ЭTЫ\ЪЭ
JNВџJNВќ\Э
	ШШ[Щ[[™ИHШЪY[Y\ЬЪYЫ›Y[ќ™]Z[њИ]ИXЪЭ\[YH›Ь€›Э\ЭЬљY\ЙЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭXЪЭ\][™]И]J]K››ЭК
JМНЊ
KќТTУФЭљ[™К
NВ€ЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЛXЪЭ\]JNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKњЩ]Ы›[™JќYJNИЫЫњЭЩ™™\Џ[KњЭX›Z]Щ™™\ЉљYKљYЩ\™N‰МЊЛЌL	Л]N‰НЙЯJNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKњЩ[XЭЩ™™\ЉЩ™™\‹љY
NИKШ[Щ[љYJљYKљY
NВ€\ЬЩ\ќ™\]X[
K›^T™\]Y\ЭК
K™љ[™
ЏOњ‹љYOO\љYKљY
KњXЪЭ\]XЪЭ\]
NВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќ™\]X[
K™љ]™\•љ\К
K™љ[™
ЏOњ‹љYOO\љYKљY
KњXЪЭ\]XЪЭ\]
NВџJNВ‚ќ\Э
	ЫЩ™™\€™Yњ™\Ъ™XЫЬ™И[YH^\ћH[™^Z[њИЪH›И][ЭH\ИЩ[XЭX›IЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€KњЭ]K›Щ™™\њЛ™љ[\ЉПO›Лњ™\]Y\ЭYOO\љYKљY
K™›Ь‘XXЪ
ПO›Л™^\™\Р]Q]K››ЭК
KLJNВ€\ЬЩ\ќ™\]X[
K™Щ]Щ™™\њКљYKљY
K›[™Э
NВ€ЫЫњЭЭ[[X\ћO[K›Щ™™\”Э[[X\ћJљYKљY
NВ€\ЬЩ\ќ™\]X[
Э[[X\ћKXЭ]™K
NИ\ЬЩ\ќ›ЪКЭ[[X\ћK™^\™YЊ
NИ\ЬЩ\ќ™\]X[
Э[[X\ћKќ[]Z[X›K
NВ€\ЬЩ\ќ›ЪКKњЭ]K›Щ™™\њЛ™љ[\ЉПO›Лњ™\]Y\ЭYOO\љYKљY
K™]™\ћJПO›ЛњЭ]\ПOOIЩ^\™Y	Й‰›ЛњЭ]\Ф™X\ЫЫЏOOIЭ[YIКJNВџJNВќ\Э
	ЫЫ™H^\™YЩ™™\€Щ\И›ЭYH[›Э\€Э\њ™[ќЩ™™\‰Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€ЫЫњЭ™Y›Ь™O[K™Щ]Щ™™\њКљYKљY
NИ\ЬЩ\ќ›ЪК™Y›Ь™K›[™ЭЊJNВ€™Y›Ь™VМK™^\™\Р]Q]K››ЭК
KLNВ€ЫЫњЭYќ\Џ[K™Щ]Щ™™\њКљYKљY
KЭ[[X\ћO[K›Щ™™\”Э[[X\ћJљYKљY
NВ€\ЬЩ\ќ™\]X[
Yќ\‹›[™Э™Y›Ь™K›[™ЭLJNИ\ЬЩ\ќ™\]X[
Э[[X\ћKXЭ]™KYќ\‹›[™Э
NИ\ЬЩ\ќ™\]X[
Э[[X\ћK™^\™YJNВ€\ЬЩ\ќ›ЪКXYќ\‹њЫЫYJПO›ЛљYOOX™Y›Ь™VМKљY
JNВџJNВќ\Э
	Ш[€[YЪX›Hљ]™\€Ш[€™K\][ЭHYќ\€^\ћHЪ]Э]™]љ]љ[™ИHЫЩ™™\‰Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKњЩ]Ы›[™JќYJNИЫЫњЭЫ[KњЭX›Z]Щ™™\ЉљYKљYЩ\™N‰МЊЛЌL	Л]N‰НЙЯJNВ€Ы™^\™\Р]Q]K››ЭК
KLNИK™љ]™\”™\]Y\ЭК
NВ€\ЬЩ\ќ™\]X[
ЫњЭ]\Л	Щ^\™Y	КNВ€ЫЫњЭњ™\Ъ[KњЭX›Z]Щ™™\ЉљYKљYЩ\™N‰МЌЊ	Л]N‰Н‰ЯJNВ€\ЬЩ\ќ››Э\]X[
њ™\ЪљYЫљY
NИ\ЬЩ\ќ™\]X[
ЫњЭ]\Л	Щ^\™Y	КNИ\ЬЩ\ќ™\]X[
њ™\ЪњЭ]\Л	ШXЭ]™IКNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИЫЫњЭљ\ЪX›O[K™Щ]Щ™™\њКљYKљY
NВ€\ЬЩ\ќ›ЪКљ\ЪX›KњЫЫYJПO›ЛљYOOYњ™\ЪљY
JNИ\ЬЩ\ќ›ЪК]љ\ЪX›KњЫЫYJПO›ЛљYOO[ЫљY
JNВ€KњЩ[XЭЩ™™\Љњ™\ЪљY
NИ\ЬЩ\ќ™\]X[
љYKњ][ЭTЫ\ЪЭ™\™PЩ[ќЛЌ
NВџJNВќ\Э
	Ш[€Щ™™\€XYH[]Z[X›HћH[YЪXљ[]HШ[››ЭЪ[[ќH™]љ]™IЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€ЫЫњЭЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМK™XЫЬ™[KњЭ]Kњ™XЫЬ™Л™љ[™
ЏOњ‹љYOO[Щ™™\‹™љ]™\’Y
NВ€™XЫЬ™њЭ]\ПIЬЭ\Ь[™Y	ОИ\ЬЩ\ќ›ЪК[K™Щ]Щ™™\њКљYKљY
KњЫЫYJПO›ЛљYOO[Щ™™\‹љY
JNВ€\ЬЩ\ќ™\]X[
Щ™™\‹њЭ]\Л	Э[]Z[X›IКNИ\ЬЩ\ќ™\]X[
Щ™™\‹њЭ]\Ф™X\ЫЫ‹	Щ[YЪXљ[]IКNВ€™XЫЬ™њЭ]\ПIЬ™]љY]ЩY	ОИ\ЬЩ\ќ›ЪК[K™Щ]Щ™™\њКљYKљY
KњЫЫYJПO›ЛљYOO[Щ™™\‹љY
JNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЩ™™\‹љY
JNВџJNВќ\Э
	ЫЩ™™\‹\Э]HЭZY[ЩH\И[Z]YИHЭЫљ[™И\ЬЩ[™Щ\‰Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЭЫ™\Џ[KњЭ]Kњ›Щљ[NВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИ\ЬЩ\ќќ›ЭЬК

OO›K›Щ™™\”Э[[X\ћJљYKљY
Kшаdшаk№¤гy/gКNВ€KЪЫЬЩT›ЫJ	Ь\ЬЩ[™Щ\‰КNИKњЭ]Kњ›Щљ[O^Л‹‹›ЭЫ™\‹Y‰Э[њ™[]Y\\ЬЩ[™Щ\‰ЯNВ€\ЬЩ\ќќ›ЭЬК

OO›K›Щ™™\”Э[[X\ћJљYKљY
Kъe¬є)©шаiшаcxаoёаfша¤ЛКNВ€KњЭ]Kњ›Щљ[O[ЭЫ™\ЋИ\ЬЩ\ќќ›ЭЬК

OO›K›Щ™™\”Э[[X\ћJ	ЫZ\ЬЪ[™Л\љYIКKъe¬є)©шаiшаcxаoёаfша¤ЛКNВџJNВ‚ќ\Э
	ЫЩ™™\€Щ[XЭ[Ы€Y[Щ\ИH™\]Y\Э™]љ\Ъ[Ы€[™™Z™XЭИHЭ[H™\X]	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМNВ€\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹JNИKњЩ[XЭЩ™™\ЉЩ™™\‹љYJNВ€\ЬЩ\ќ™\]X[
љYKњЭ]\Л	Ш\ЬЪYЫ™Y	КNИ\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹ЉNВ€\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЩ™™\‹љYJKщb)xаk№е.ъghёаiщ¦н9Ґ¬КNВџJNВќ\Э
	ШШ[Щ[][Ы€Ъ[њИ[€XШЩ\ШШ[Щ[XЩH[™Э[HЩ[XЭ[Ы€Ъ[™Щ\И›Э[™ЙЛ

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМNВ€KШ[Щ[љYJљYKљYJNИЫЫњЭYќ\ђШ[Щ[R”УУ‹њЭљ[™ЪYћJљYJNВ€\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹ЉNИ\ЬЩ\ќќ›ЭЬК

OO›KњЩ[XЭЩ™™\ЉЩ™™\‹љYJKщb)xаk№е.ъghёаiщ¦н9Ґ¬КNВ€\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJљYJKYќ\ђШ[Щ[
NВџJNВќ\Э
	ЬЩ[XЭ[Ы€Ъ[њИ[€XШЩ\ШШ[Щ[XЩH[™Э[HШ[Щ[][Ы€]\Э™Yњ™\Ъљ\њЭ	Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJKЩ™™\Џ[K™Щ]Щ™™\њКљYKљY
VМNВ€KњЩ[XЭЩ™™\ЉЩ™™\‹љYJNИЫЫњЭYќ\”Щ[XЭR”УУ‹њЭљ[™ЪYћJљYJNВ€\ЬЩ\ќќ›ЭЬК

OO›KШ[Щ[љYJљYKљYJKщb)xаk№е.ъghёаiщ¦н9Ґ¬КNИ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJљYJKYќ\”Щ[XЭ
NВ€KШ[Щ[љYJљYKљYЉNИ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	ШШ[Щ[Y	КNИ\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹КNВџJNВќ\Э
	ШHШ[Щ[][Ы€™]ћH\ИY[\Э[ќ]™[€Ъ]HЬљYЪ[[^XЭY™]љ\Ъ[Ы‰Л

HO€В€ЫЫњЭЫ_O\Щ]\

NИ\ЬЩ[™Щ\ЉJNИЫЫњЭљYO[Kњ™\]Y\ЭљYJЬXЪЭ\‰С[[ИЭ[	Л\Э[][ЫЋ‰С[[И™XXЪ	ЯJNВ€KШ[Щ[љYJљYKљYJNИЫЫњЭЫЩOR”УУ‹њЭљ[™ЪYћJљYJNВ€\ЬЩ\ќ™\]X[
KШ[Щ[љYJљYKљYJKљYJNИ\ЬЩ\ќ™\]X[
”УУ‹њЭљ[™ЪYћJљYJKЫЩJNИ\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹ЉNВџJNВќ\Э
	ШHЭ[Hљ]™\€[њЪ][Ы€Ш[››ЭЪЪ\H™]Щ\€љ\Э]IЛ

HO€В€ЫЫњЭЫKљY_O\Щ[XЭY

NИ\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹ЉNВ€Kќ\ЩT™]љY]ЩYљ^\™J
NИKY[ЩUљ\
љYKљYЉNИ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	Ш\њљ]љ[™ЙКNИ\ЬЩ\ќ™\]X[
љYKњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќќ›ЭЬК

OO›KY[ЩUљ\
љYKљYЉKщb)xаk№е.ъghёаiщ¦н9Ґ¬КNИ\ЬЩ\ќ™\]X[
љYKњЭ]\Л	Ш\њљ]љ[™ЙКNВџJNВ‚ќ\Э
	ЫXXЪ[™K\™XYX›HTHЫЫќXЭ\ЬЩ\ИH^XЭ]X›HXШЩ\[ЩHЪXЪЩ\‰Л

HO€В€\ЬЩ\ќ™Y\\]X[
[Y]PЫЫќXЭ
ШYЫЫќXЭ

JKЧJNВџJNВќ\Э
	РTHЫЫќXЭ[ќ[Y\]\И]™\ћH\ЬЩ[™Щ\€[™љ]™\€Ь\][Ы€^XЭHЫЩIЛ

HO€В€ЫЫњЭЬXП[ШYЫЫќXЭ

KYПVЧNВ€›ЬЉЫЫњЭЫY]Щ›Э]KYHЩ€ФTђUSУ”К^Ш\ЬЩ\ќ™\]X[
ЬXЛњ]ЦЬ›Э]WVЫY]ЩK›Ь\][Ы’YY
NЪYЛњ\Ъ
Y
NЯB€\ЬЩ\ќ™\]X[
™]ИЩ]
YКKњЪ^™KФTђUSУ”Л›[™Э
NВџJNВќ\Э
	Ш[Э]KXЪ[™Ъ[™ИTHЫЫ[X[™И™\]Z\™H[€Y[\Э[ЮHЩ^IЛ

HO€В€ЫЫњЭЬXП[ШYЫЫќXЭ

NВ€›ЬЉЫЫњЭЫY]Щ›Э]KYHЩ€ФTђUSУ”Л™љ[\Љ
ЫY]ЩJOO›Y]ЩOOIЬЬЭ	КJ^В€ЫЫњЭ]][O\ЬXЛњ]ЦЬ›Э]WK\[Y]\њПVЛ‹‹Љ]][Kњ\[Y]\њЯЧJK‹‹Љ]][VЫY]ЩKњ\[Y]\њЯЧJWNВ€ЫЫњЭ™\ЫЫ™Y\\[Y]\њЛ›X\
Oњ‰™YЏЬЬXЛЫЫ\Ы™[ќЛњ\[Y]\њЦЬ‰™Y‹њЬ]
	ЛЙКK]
LJWNњ
NВ€\ЬЩ\ќ›ЪК™\ЫЫ™YњЫЫYJOњ›[YOOOIТY[\Э[ЮKRЩ^IЙ‰њљ[ЏOOIЪXY\‰Й‰њњ™\]Z\™Y
KY
NВ€BџJNВќ\Э
	РTH[њ]И™]™\€XШЩ\Ш[\‹XЫЫќ›ЫYXЭЬ€Ь€\›Э[љY[ЙЛ

HO€В€ЫЫњЭ^R”УУ‹њЭљ[™ЪYћJШYЫЫќXЭ

KЫЫ\Ы™[ќЛњШЪ[X\КNВ€›ЬЉЫЫњЭљY[Щ€ЙЬ\ЬЩ[™Щ\’Y	Л	Щљ]™\’Y	Л	Ь™]љY]Щ\’Y	Л	Ш\›Э™Y	Л	Щ[YЪX›IЛ	Ь™]љY]ФЭ]\ЙЧJH\ЬЩ\ќ›ЪК]^љ[ЫY\К‰ЩљY[W
KљY[
NВџJNВќ\Э
	РTHЫЫќXЭљ^\И[Ы™^K™]љ\Ъ[Ы€[™ШЪY[YXЪЭ\™\™\Щ[ќ][ЫњЙЛ

HO€В€ЫЫњЭШЪ[X\П[ШYЫЫќXЭ

KЫЫ\Ы™[ќЛњШЪ[X\ОВ€\ЬЩ\ќ™Y\\]X[
ШЪ[X\Л”™]љ\Ъ[Ы‹Э\N‰Ъ[ќYЩ\‰ЛZ[љ[][NЊ_JNВ€\ЬЩ\ќ™\]X[
ШЪ[X\ЛђЬ™X]SЩ™™\’[њ]њ›Ь\ќY\Л™\™PЩ[ќЛќ\K	Ъ[ќYЩ\‰КNВ€\ЬЩ\ќ™\]X[
ШЪ[X\ЛђЬ™X]TљYT™\]Y\Э[њ]њ›Ь\ќY\ЛњXЪЭ\]™›Ь›X]	Щ]K][YIКNВ€\ЬЩ\ќ™\]X[
ШЪ[X\ЛђЬ™X]TљYT™\]Y\Э[њ]њ›Ь\ќY\ЛњXЪЭ\[YV›Ы™KЫЫњЭ	ФXЪYљXЛСљZљIКNВ€\ЬЩ\ќ™\]X[
ШЪ[X\Л”Щ[XЭY][ЭKњ™XYЫ›KќYJNВџJNВќ\Э
	РTHЫЫќXЭ[Z]ИШ[Щ[][Ы€™X\ЫЫњИИH™YH™]љY]ЩYYX[љ[™ЬЙЛ

HO€В€ЫЫњЭШЪ[XO[ШYЫЫќXЭ

KЫЫ\Ы™[ќЛњШЪ[X\ЛђШ[Щ[љYR[њ]В€\ЬЩ\ќ™Y\\]X[
ШЪ[XKњ›Ь\ќY\Лњ™X\ЫЫ‹™[ќ[KРSђСSUSУ—Ф‘PTУУ”КNВ€\ЬЩ\ќ›ЪКШЪ[XKњ™\]Z\™Yљ[ЫY\К	Ь™X\ЫЫ‰КJNВ€›ЬЉЫЫњЭЪ[™ЩHЩ€В€™X\ЫЫњПOњ™X\ЫЫњЛЫЫШ]
	ЬЩX\ЪЩY]Y	КK€™X\ЫЫњПOњ™X\ЫЫњЛ™љ[\Љ™X\ЫЫЏOњ™X\ЫЫ€OOIЬШЪY[WШЪ[™ЩY	КB€J^В€ЫЫњЭЪ[™ЩY\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€Ъ[™ЩYЫЫ\Ы™[ќЛњШЪ[X\ЛђШ[Щ[љYR[њ]њ›Ь\ќY\Лњ™X\ЫЫ‹™[ќ[OXЪ[™ЩJЪ[™ЩYЫЫ\Ы™[ќЛњШЪ[X\ЛђШ[Щ[љYR[њ]њ›Ь\ќY\Лњ™X\ЫЫ‹™[ќ[JNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
Ъ[™ЩY
KњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	РШ[Щ[љYR[њ]™X\ЫЫ€]\Э[ЭИ^XЭIКJJNВ€BџJNВќ\Э
	РTHЪXЪЩ\€Z[ИЫЬЩYЪ[€ШY™]H™\]Z\™[Y[ќИ\™H™[[Э™Y	Л

HO€В€ЫЫњЭ›ТЩ^O\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€›ТЩ^Kњ]ЦЙЛЭЊKЫЩ™™\њЛЮЫЩ™™\’YKЬЩ[XЭ	ЧKњЬЭњ\[Y]\њП[›ТЩ^Kњ]ЦЙЛЭЊKЫЩ™™\њЛЮЫЩ™™\’YKЬЩ[XЭ	ЧKњЬЭњ\[Y]\њЛ™љ[\ЉO€\‰™Y‹™[™ХЪ]
	ЛТY[\Э[ЮRЩ^IКJNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
›ТЩ^JKњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЬЩ[XЭљYSЩ™™\€™\]Z\™\ИY[\Э[ЮKRЩ^IКJJNВ€ЫЫњЭ[љ™XЭY\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€[љ™XЭYЫЫ\Ы™[ќЛњШЪ[X\ЛђЬ™X]SЩ™™\’[њ]њ›Ь\ќY\Л™љ]™\’Y^Э\N‰ЬЭљ[™ЙЯNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
[љ™XЭY
KњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЬЩ\ќ™\‹[ЭЫ™Yљ]™\’Y	КJJNВ€ЫЫњЭZ\ЬЪ[™Х™ZXЫQ\њ›ЬЏ\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€Z\ЬЪ[™Х™ZXЫQ\њ›Ь‹ЫЫ\Ы™[ќЛњШЪ[X\Л‘\њ›Ь‹њ›Ь\ќY\ЛЫЩK™[ќ[O[Z\ЬЪ[™Х™ZXЫQ\њ›Ь‹ЫЫ\Ы™[ќЛњШЪ[X\Л‘\њ›Ь‹њ›Ь\ќY\ЛЫЩK™[ќ[K™љ[\ЉЫЩOOЫЩHOOIЭ™ZXЫWШЫЫ™љ\›X][Ы—Ь™\]Z\™Y	КNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
Z\ЬЪ[™Х™ZXЫQ\њ›ЬЉKњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	С\њ›Ь€ЫЩH[ќ[H™\]Z\™\И™ZXЫWШЫЫ™љ\›X][Ы—Ь™\]Z\™Y	КJJNВ€ЫЫњЭXZЩYљYTЭ]O\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€XZЩYљYTЭ]KЫЫ\Ы™[ќЛњШЪ[X\Л”љYTЭ]UљY]Лњ›Ь\ќY\Л\ЬЪYЫ™Yљ]™\’Y^Э\N‰ЬЭљ[™ЙЯNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
XZЩYљYTЭ]JKњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ФљYTЭ]UљY]И]\Э›Э^ЬЩHљ]]HљY[\ЬЪYЫ™Yљ]™\’Y	КJJNВ€ЫЫњЭ›РЫЫ™][Ы[\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€[]H›РЫЫ™][Ы[њ]ЦЙЛЭЊKЬљY\ЛЮЬ™\]Y\ЭYIЧK™Щ]њ™\ЬЫњЩ\ЦЙММ	ЧNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
›РЫЫ™][Ы[
KњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЩЩ]љYTЭ]H]\ЭШЭ[Y[ќ›Щ[\ЬИМ	КJJNВ€ЫЫњЭЪ\™YШXЪO\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€Ъ\™YШXЪKЫЫ\Ы™[ќЛљXY\њЛ”љ]]S›РШXЪKњШЪ[XKЫЫњЭIЬX›XЛX^XYЩOMЊ	ОВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
Ъ\™YШXЪJKњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЬљYHЭ]HШXЪHЫЫќ›Ы]\Э™Hљ]]K›ЛXШXЪIКJJNВ€ЫЫњЭ›Ф]S[Z]\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€[]H›Ф]S[Z]њ]ЦЙЛЭЊKЬљY\ЛЮЬ™\]Y\ЭYIЧK™Щ]њ™\ЬЫњЩ\ЦЙНЋIЧNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
›Ф]S[Z]
KњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЩЩ]љYTЭ]H]\ЭШЭ[Y[ќЋIКJJNВ€ЫЫњЭ›Ф™]ћPYќ\Џ\ЭќXЭ\™YЫЫ™JШYЫЫќXЭ

JNВ€[]H›Ф™]ћPYќ\‹ЫЫ\Ы™[ќЛњ™\ЬЫњЩ\Л”Щ\ќљXЩU[]Z[X›KљXY\њЦЙФ™]ћKPYќ\‰ЧNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
›Ф™]ћPYќ\ЉKњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЩЩ]љYTЭ]HLИ™\]Z\™\И™]ћKPYќ\€XY\‰КJJNВџJNВќ\Э
	ШЭ\њ™[ќ\љYH\ШЫЭ™\ћHЫЫќXЭ\љ]™\ИШЫЬHњ›ЫH]][ќXШ][Ы€[™Z[ИЫЬЩY	Л

HO€В€ЫЫњЭЬXП[ШYЫЫќXЭ

KЬ\][ЫЏ\ЬXЛњ]ЦЙЛЭЊKЬљY\ЛШЭ\њ™[ќ	ЧK™Щ]В€\ЬЩ\ќ™\]X[
Ь\][Ы‹›Ь\][Ы’Y	ЩЩ]Э\њ™[ќљYIКNВ€\ЬЩ\ќ™Y\\]X[
Ь\][Ы‹њ\[Y]\њЛ[™Yљ[™Y
NВ€\ЬЩ\ќ›ЪКЬ\][Ы‹њ™\ЬЫњЩ\ЦЙМЊ	ЧJNВ€\ЬЩ\ќ›ЪКЬ\][Ы‹њ™\ЬЫњЩ\ЦЙМЊ	ЧJNВ€\ЬЩ\ќ›ЪКЬ\][Ы‹њ™\ЬЫњЩ\ЦЙНIЧJNВ€\ЬЩ\ќ™\]X[
Ь\][Ы‹њ™\ЬЫњЩ\ЦЙММ	ЧK[™Yљ[™Y
NВ€ЫЫњЭЪ]љYRY\ЭќXЭ\™YЫЫ™JЬXКNВ€Ъ]љYRYњ]ЦЙЛЭЊKЬљY\ЛШЭ\њ™[ќ	ЧK™Щ]њ\[Y]\њПVЮЫ[YN‰Ь™\]Y\ЭY	Л[Ћ‰Ь]Y\ћIЛ™\]Z\™Y™[ЩKШЪ[XNћЭ\N‰ЬЭљ[™ЙЯ_WNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
Ъ]љYRY
KњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЭЪ]Э]]Ь€]Y\ћHY[ќYљY\њЙКJJNВ€ЫЫњЭЪ]Э][\O\ЭќXЭ\™YЫЫ™JЬXКNВ€[]HЪ]Э][\Kњ]ЦЙЛЭЊKЬљY\ЛШЭ\њ™[ќ	ЧK™Щ]њ™\ЬЫњЩ\ЦЙМЊ	ЧNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
Ъ]Э][\JKњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	ЩЩ]Э\њ™[ќљYH]\ЭШЭ[Y[ќЊ	КJJNВ€ЫЫњЭЫЫ™][Ы[\ЭќXЭ\™YЫЫ™JЬXКNВ€ЫЫ™][Ы[њ]ЦЙЛЭЊKЬљY\ЛШЭ\њ™[ќ	ЧK™Щ]њ™\ЬЫњЩ\ЦЙММ	ЧO^Щ\ШЬљ\[ЫЋ‰Э[њШY™H[\HЭ\ќ\™\ЬЫњЩIЯNВ€\ЬЩ\ќ›ЪК[Y]PЫЫќXЭ
ЫЫ™][Ы[
KњЫЫYJY\ЬШYЩOO›Y\ЬШYЩKљ[ЫY\К	Щќ[Э\ќ\™\Э[[њЭXYЩ€М	КJJNВџJNВќ\Э
	ТЫЫќXЭќ[›™\€[™›ЬЩ\И›ЫKЭЫ™\њЪ\[YЪXљ[]H[™ШY™H\њ›ЬњИЭ™\€ЫЬXЪЙЛ\Ю[И

HO€В€ЫЫњЭ™\Э[ПX]ШZ]ќ[“[ШЪРЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
™\Э[Л›[™ЭM
NВ€\ЬЩ\ќ™\]X[
™\Э[Л™љ[\ЉЏOњ‹њЭ]\ПOOM
K›[™ЭJNВ€\ЬЩ\ќ™\]X[
™\Э[Л™љ[\ЉЏOњ‹њЭ]\ПOOMКK›[™ЭКNВ€\ЬЩ\ќ™\]X[
™\Э[Л™љ[\ЉЏOњ‹њЭ]\ПOOMJK›[™ЭJNВ€\ЬЩ\ќ™\]X[
™\Э[Л™љ[\ЉЏOњ‹њЭ]\ПOOMЊЉK›[™ЭЉNВ€\ЬЩ\ќ™\]X[
™\Э[Л™љ[\ЉЏOњ‹њЭ]\ПМ
K›[™ЭКNВџJNВќ\Э
	ТШ[Щ[][Ы€™\Щ\ќ™\ИЫ›H™]љY]ЩY™X\ЫЫњИ[™™Z™XЭИ[\\™Y[њ]Ъ]Э]ЪYHY™™XЭЙЛ\Ю[И

HO€В€ЫЫњЭЫЫќXЭX]ШZ]Ш[Щ[][Ы”™X\ЫЫ”™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
ЫЫќXЭ[ЭЩY›X\
][OOљ][Kњ™X\ЫЫЉKРSђСSUSУ—Ф‘PTУУ”КNВ€›ЬЉЫЫњЭ][HЩ€ЫЫќXЭ[ЭЩY
^В€\ЬЩ\ќ™\]X[
][Kњ™\Э[њЭ]\ЛЊ
NВ€\ЬЩ\ќ™\]X[
][KњЭ]KШ[Щ[™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™\]X[
][K]Y]]™[ќЦМKњ™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™\]X[
][K]Y]]™[ќЦМK›Э]ЫЫYK	ШЫЫ[Z]Y	КNВ€B€\ЬЩ\ќ™Y\\]X[
ЫЫќXЭљ[ќ[Y›X\
][OO–Ъ][KњЭ]\Л][K›ЩKЫЩWJK\њ^J
K™љ[
НЊ‹	Ъ[ќ[YЬ™\]Y\Э	ЧJJNВ€\ЬЩ\ќ™Y\\]X[
ЫЫќXЭљ[ќ[YЭ]KЪY‘’VT‘Kњ™\]Y\ЭYЭ]\О‰ШЫЫXЭ[™ЙЛ™]љ\Ъ[ЫЋ‘’VT‘Kњ™]љ\Ъ[Ы‹\ЬЪYЫ™Yљ]™\’Y›ќ[™ZXЫPЫЫ™љ\›X][ЫЋ›ќ[JNВ€\ЬЩ\ќ™Y\\]X[
ЫЫќXЭљ[ќ[Y]Y]]™[ќЛЧJNВ€\ЬЩ\ќ™\]X[
ЫЫќXЭљ[ќ[YЭЬ™YЩ^\Л
NВџJNВќ\Э
	Щ^XЭШ[Щ[][Ы€™\^H™]\›њИHЬљYЪ[[™X\ЫЫ€Ъ]Э]\XШ]HЭ]HЬ€]Y]	Л\Ю[И

HO€В€ЫЫњЭШ[ЭЩYOX]ШZ]Ш[Щ[][Ы”™X\ЫЫ”™\Э[К
NВ€›ЬЉЫЫњЭ][HЩ€[ЭЩY
^В€\ЬЩ\ќ™Y\\]X[
][Kњ™\^K][Kњ™\Э[
NВ€\ЬЩ\ќ™\]X[
][KњЭ]KШ[Щ[™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™\]X[
][KњЭ]Kњ™]љ\Ъ[Ы‹’VT‘Kњ™]љ\Ъ[ЫЉМJNВ€\ЬЩ\ќ™\]X[
][K]Y]]™[ќЛ›[™ЭJNВ€\ЬЩ\ќ™\]X[
][KњЭЬ™YЩ^\ЛJNВ€BџJNВќ\Э
	Ш[€Y[\Э[ЮHЩ^HШ[››Э™H™]\ЩYИ™\XЩHH™XЫЬ™YШ[Щ[][Ы€™X\ЫЫ‰Л\Ю[И

HO€В€ЫЫњЭШ[ЭЩYOX]ШZ]Ш[Щ[][Ы”™X\ЫЫ”™\Э[К
NВ€›ЬЉЫЫњЭ][HЩ€[ЭЩY
^В€\ЬЩ\ќ››Э\]X[
][KЪ[™ЩY™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™Y\\]X[
Ъ][KЫЫ™›XЭњЭ]\Л][KЫЫ™›XЭ›ЩKЫЩWKНK	ЪY[\Э[ЮWШЫЫ™›XЭ	ЧJNВ€\ЬЩ\ќ™\]X[
][KњЭ]KШ[Щ[™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™\]X[
][K]Y]]™[ќЦМKњ™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€BџJNВќ\Э
	ШH™]ИY[\Э[ЮHЩ^HШ[››Э™XЫ\ЬЪYћH[€[™XYHШ[Щ[Y™\]Y\Э	Л\Ю[И

HO€В€ЫЫњЭЪ[[]]X›_OX]ШZ]Ш[Щ[][Ы”™X\ЫЫ”™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
[[]]X›K›X\
][OOљ][Kњ™X\ЫЫЉKРSђСSUSУ—Ф‘PTУУ”КNВ€›ЬЉЫЫњЭ][HЩ€[[]]X›J^В€\ЬЩ\ќ››Э\]X[
][KЪ[™ЩY™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™Y\\]X[
Ъ][KЫЫ[Z]YњЭ]\Л][K[Y[™Y[ќњЭ]\Л][K[Y[™Y[ќ›ЩKЫЩWKМЊK	Ъ[ќ[YЭ[њЪ][Ы‰ЧJNВ€\ЬЩ\ќ™\]X[
][KњЭ]KШ[Щ[™X\ЫЫ‹][Kњ™X\ЫЫЉNВ€\ЬЩ\ќ™\]X[
][KњЭ]Kњ™]љ\Ъ[Ы‹’VT‘Kњ™]љ\Ъ[ЫЉМJNВ€\ЬЩ\ќ™Y\\]X[
][K]Y]]™[ќЛ›X\
]™[ќO–Щ]™[ќ›Э]ЫЫYK]™[ќњ™X\ЫЫ—JKЦЙШЫЫ[Z]Y	Л][Kњ™X\ЫЫ—KЙЬ™Z™XЭY	Л	Ъ[ќ[YЭ[њЪ][Ы‰ЧWJNВ€\ЬЩ\ќ™\]X[
][KњЭЬ™YЩ^\ЛЉNВ€BџJNВќ\Э
	ТЫЫќXЭШЩ[\љ[ЬИЫЫЩX[›Ь™ZYЫ€™\ЫЭ\Щ\И[њЭXYЩ€XZЪ[™ИЭЫ™\њЪ\	Л

HO€В€ЫЫњЭY[ЏZШЩ[\љ[ЬК
K™љ[\ЉПOњЛЫЫЩX[Y
NВ€\ЬЩ\ќ™Y\\]X[
Y[‹›X\
ПOњЛ™^XЭYМJKНJNВ€\ЬЩ\ќ›ЪКY[‹™]™\ћJПOњЛ™^XЭYМWOOOIЬ™\ЫЭ\ЩWЫ›ЭЩ›Э[™	КJNВџJNВќ\Э
	ТЫЫќXЭќ[›™\€Z[ИЪ[€H\›Z\ЬЪ]™H[њЬЬќ™]\›њИЭXШЩ\ЬИ›Ь€]™\ћH™\]Y\Э	Л\Ю[И

HO€В€ЫЫњЭ\›Z\ЬЪ]™Q™]ЪX\Ю[К
OOЉЬЭ]\ОЊЊ^\Ю[К
OO‰ЮЯIЛXY\њОћЩЩ]Љ
OO›ќ[_JNВ€]ШZ]\ЬЩ\ќњ™Z™XЭКќ[’ЫЫќXЭ
	Ъ‹ЛЫ[ШЪЛљ[ќ[Y	Л[™Yљ[™Y\›Z\ЬЪ]™Q™]Ъ
KЫ›ИЩ\ЬЪ[Ы€Ш[››Э™XYЩ™™\њЛКNВџJNВќ\Э
	Ш]][ќXШ]Y\ЬЩ[™Щ\€[™\ЬЪYЫ™Yљ]™\€\ШЫЭ™\€›ЫK\Ъ\YЭ\њ™[ќЭ]HЪ]Э]HљYHQ	Л\Ю[И

HO€В€ЫЫњЭЬ\ЬЩ[™Щ\‹љ]™\џOX]ШZ]Э\њ™[ќљYQ\ШЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
Ь\ЬЩ[™Щ\‹њЭ]\Л\ЬЩ[™Щ\‹›ЩKќљY]Щ\”›ЫK\ЬЩ[™Щ\‹›ЩK›™^XЭ[Ы—KМЊ	Ь\ЬЩ[™Щ\‰Л	ЭXЪЧЬXЪЭ\	ЧJNВ€\ЬЩ\ќ™Y\\]X[
Щљ]™\‹њЭ]\Лљ]™\‹›ЩKќљY]Щ\”›ЫKљ]™\‹›ЩK›™^XЭ[Ы—KМЊ	Щљ]™\‰Л	ЬЭ\ќЬXЪЭ\	ЧJNВ€ЫЫњЭШY™QљY[ПVЙЪY	Л	ЬЭ]\ЙЛ	Ь™]љ\Ъ[Ы‰Л	ЭљY]Щ\”›ЫIЛ	Ы™^XЭ[Ы‰Л	Э\]Y]	ЧNВ€\ЬЩ\ќ™Y\\]X[
Шљ™XЭљЩ^\К\ЬЩ[™Щ\‹›ЩJKШY™QљY[КNВ€\ЬЩ\ќ™Y\\]X[
Шљ™XЭљЩ^\Кљ]™\‹›ЩJKШY™QљY[КNВџJNВќ\Э
	Э[њ™[]Y]][ќXШ]YXЭЬњИ™XЩZ]™H›Щ[\ЬИЊЪ]Э]›Ь™ZYЫ€љYH]Z[ЙЛ\Ю[И

HO€В€ЫЫњЭЫЭ\”\ЬЩ[™Щ\‹Э\‘љ]™\џOX]ШZ]Э\њ™[ќљYQ\ШЫЭ™\ћT™\Э[К
NВ€›ЬЉЫЫњЭ™\Э[Щ€ЫЭ\”\ЬЩ[™Щ\‹Э\‘љ]™\—J^В€\ЬЩ\ќ™Y\\]X[
Ь™\Э[њЭ]\Л™\Э[›ЩWKМЊќ[JNВ€\ЬЩ\ќ™\]X[
™\Э[љXY\њЛШXЪPЫЫќ›Ы	Ьљ]]K›ЛXШXЪIКNВ€\ЬЩ\ќ™\]X[
™\Э[љXY\њЛќ\ћK	Р]]Ьљ^][Ы‰КNВ€\ЬЩ\ќ™\]X[
™\Э[љXY\њЛ™]YЛќ[
NВ€BџJNВќ\Э
	ШЫЫ\]Y[™Ш[Щ[YљY\И\™H^ЫYYњ›ЫHЭ\њ™[ќ\љYH\ШЫЭ™\ћIЛ\Ю[И

HO€В€ЫЫњЭШЫЫ\]Y\ЬЩ[™Щ\‹ЫЫ\]Yљ]™\‹Ш[Щ[Y\ЬЩ[™Щ\‹Ш[Щ[Yљ]™\џOX]ШZ]Э\њ™[ќљYQ\ШЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
ШЫЫ\]Y\ЬЩ[™Щ\‹њЭ]\ЛЫЫ\]Y\ЬЩ[™Щ\‹›ЩWKМЊќ[JNВ€\ЬЩ\ќ™Y\\]X[
ШЫЫ\]Yљ]™\‹њЭ]\ЛЫЫ\]Yљ]™\‹›ЩWKМЊќ[JNВ€\ЬЩ\ќ™Y\\]X[
ШШ[Щ[Y\ЬЩ[™Щ\‹њЭ]\ЛШ[Щ[Y\ЬЩ[™Щ\‹›ЩWKМЊќ[JNВ€\ЬЩ\ќ™Y\\]X[
ШШ[Щ[Yљ]™\‹њЭ]\ЛШ[Щ[Yљ]™\‹›ЩWKМЊќ[JNВџJNВќ\Э
	Ы][\H[™љ[љ\ЪYШ[™Y]\ИЭЬЪ]H›Ы‹Y\ШЫЬЪ[™ИЫЫ™›XЭ	Л\Ю[И

HO€В€ЫЫњЭЫ][\_OX]ШZ]Э\њ™[ќљYQ\ШЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
][\KњЭ]\ЛJNВ€\ЬЩ\ќ™\]X[
][\K›ЩKЫЩK	Ш[XљYЭ[Э\ЧШЭ\њ™[ќЬљYIКNВ€\ЬЩ\ќ›X]Ъ
][\K›ЩKњ™\]Y\ЭYЧќXЩK[[ШЪЛKКNВ€\ЬЩ\ќ›ЪКR”УУ‹њЭљ[™ЪYћJ][\K›ЩJKљ[ЫY\К’VT‘Kњ™\]Y\ЭY
JNВ€\ЬЩ\ќ›ЪКR”УУ‹њЭљ[™ЪYћJ][\K›ЩJKљ[ЫY\К	ЬљYKY\XШ]KYљ^\™IКJNВџJNВќ\Э
	ШЭ\њ™[ќ\љYH\ШЫЭ™\ћH™Z™XЭИZ\ЬЪ[™И]][ќXШ][Ы€[™Ш[\‹\Э\YYљYHQЙЛ\Ю[И

HO€В€ЫЫњЭЭ[]][ќXШ]Y[љ™XЭYYOX]ШZ]Э\њ™[ќљYQ\ШЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
Э[]][ќXШ]YњЭ]\Л[]][ќXШ]Y›ЩKЫЩWKНK	Ш]][ќXШ][Ы—Ь™\]Z\™Y	ЧJNВ€\ЬЩ\ќ™Y\\]X[
Ъ[љ™XЭYYњЭ]\Л[љ™XЭYY›ЩKЫЩWKНЊ‹	Ъ[ќ[YЬ™\]Y\Э	ЧJNВџJNВќ\Э
	ШЭ\њ™[ќ\љYH\ШЫЭ™\ћH\ИHЪYKYY™™XЭYњ™YHљ]]Hќ[™XY	Л\Ю[И

HO€В€ЫЫњЭЬ\ЬЩ[™Щ\‹љ]™\‹™Y›Ь™KYќ\џOX]ШZ]Э\њ™[ќљYQ\ШЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
Yќ\‹™Y›Ь™JNВ€\ЬЩ\ќ™\]X[
\ЬЩ[™Щ\‹љXY\њЛШXЪPЫЫќ›Ы	Ьљ]]K›ЛXШXЪIКNВ€\ЬЩ\ќ™\]X[
\ЬЩ[™Щ\‹љXY\њЛќ\ћK	Р]]Ьљ^][Ы‰КNВ€\ЬЩ\ќ›X]Ъ
\ЬЩ[™Щ\‹љXY\њЛ™]YЛЧ€–РKVK^ЊNWЛW^МЌH‰КNВ€\ЬЩ\ќ››Э\]X[
\ЬЩ[™Щ\‹љXY\њЛ™]YЛљ]™\‹љXY\њЛ™]YКNВџJNВќ\Э
	ШЫЫЭ\њ™[ќЩ™™\€Щ[XЭ[Ы€[™Ш[Щ[][Ы€›ЩXЩH^XЭHЫ™HЪ[›™\‰Л\Ю[И

HO€В€ЫЫњЭXЩOX]ШZ]ќ[ђЫЫЭ\њ™[ЮPЫЫќXЭ

NВ€\ЬЩ\ќ™Y\\]X[
XЩKњZ\‹›X\
™\Э[Oњ™\Э[њЭ]\КKњЫЬќ

KЉOOKXЉKМЊWJNВ€\ЬЩ\ќ™\]X[
XЩK›ЬЩ\‹›ЩKЫЩK	ЬЭ[WЬ™]љ\Ъ[Ы‰КNВ€\ЬЩ\ќ™\]X[
XЩK›ЬЩ\‹›ЩKњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩKњЭ]Kњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩKњЭ]KњЭ]\ЛXЩKќЪ[›™\‹›ЩKњЭ]\КNВџJNВќ\Э
	Щ^XЭY[\Э[ЮKRЩ^H™\^H™]\›њИHњ›Ю™[€љ\њЭЭXШЩ\ЬИЪ]Э][›Э\€Ъ[™ЩIЛ\Ю[И

HO€В€ЫЫњЭXЩOX]ШZ]ќ[ђЫЫЭ\њ™[ЮPЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
XЩKњ™\^KњЭ]\ЛЊ
NВ€\ЬЩ\ќ™Y\\]X[
XЩKњ™\^K›ЩKXЩKќЪ[›™\‹›ЩJNВ€\ЬЩ\ќ™\]X[
XЩKњЭ]Kњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩKњЭЬ™YЩ^\ЛЉNВџJNВќ\Э
	Ь™]\Ъ[™И[€Y[\Э[ЮKRЩ^HЪ]Ъ[™ЩYЫЫќ[ќ\И™Z™XЭY	Л\Ю[И

HO€В€ЫЫњЭXЩOX]ШZ]ќ[ђЫЫЭ\њ™[ЮPЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
XЩKЫЫ™›XЭњЭ]\ЛJNВ€\ЬЩ\ќ™\]X[
XЩKЫЫ™›XЭ›ЩKЫЩK	ЪY[\Э[ЮWШЫЫ™›XЭ	КNВ€\ЬЩ\ќ›X]Ъ
XЩKЫЫ™›XЭ›ЩKњ™\]Y\ЭYЧќXЩK[[ШЪЛKКNВџJNВќ\Э
	ЬЩ\ќ™\€ЫШЪИ™Z™XЭИ[€^\™YЩ™™\€Ъ]Э]Ъ[™Ъ[™ИHљYIЛ\Ю[И

HO€В€ЫЫњЭ[Y]OX]ШZ]ќ[“Щ™™\•[Y]PЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
[Y]K™^\™Yњ™\Э[њЭ]\ЛJNВ€\ЬЩ\ќ™\]X[
[Y]K™^\™Yњ™\Э[›ЩKЫЩK	ЫЩ™™\—Щ^\™Y	КNВ€\ЬЩ\ќ™\]X[
[Y]K™^\™Yњ™\Э[›ЩKњ™]љ\Ъ[Ы‹ЉNВ€\ЬЩ\ќ™\]X[
[Y]K™^\™Y›Щ™™\‹њЭ]\Л	Щ^\™Y	КNВ€\ЬЩ\ќ™Y\\]X[
[Y]K™^\™YњљYKЪY‰ЬљYK[ЭЫ™\‹LIЛЭ]\О‰ШЫЫXЭ[™ЙЛ™]љ\Ъ[ЫЋЊ‹\ЬЪYЫ™Yљ]™\’Y›ќ[™ZXЫPЫЫ™љ\›X][ЫЋ›ќ[JNВџJNВќ\Э
	ЫЩ™™\€\И^\™Y]H^XЭЩ\ќ™\‹\ЪYH^\ћH›Э[™\ћIЛ\Ю[И

HO€В€ЫЫњЭ[Y]OX]ШZ]ќ[“Щ™™\•[Y]PЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
[Y]K›Э[™\ћKњ™\Э[›ЩKЫЩK	ЫЩ™™\—Щ^\™Y	КNВ€\ЬЩ\ќ™\]X[
[Y]K›Э[™\ћK›Щ™™\‹њЭ]\Ф™X\ЫЫ‹	Э[YIКNВ€\ЬЩ\ќ™\]X[
[Y]Kќ[Yњ™\Э[њЭ]\ЛЊ	ЫЫ™HZ[\ЩXЫЫ™™Y›Ь™H^\ћH™[XZ[њИЩ[XЭX›IКNВ€\ЬЩ\ќ™\]X[
[Y]Kќ[YњљYKњЩ[XЭY][ЭKњЩ[XЭY]	МЊЌ‹LKLMХОЊЊЊ‰КNВџJNВќ\Э
	ЬЩ[XЭ[Ы€™XЪXЪЬИЭ\њ™[ќљ]™\€[YЪXљ[]H[™[ќ[Y]\ИHЩ™™\‰Л\Ю[И

HO€В€ЫЫњЭ[Y]OX]ШZ]ќ[“Щ™™\•[Y]PЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
[Y]Kљ[™[YЪX›Kњ™\Э[њЭ]\ЛJNВ€\ЬЩ\ќ™\]X[
[Y]Kљ[™[YЪX›Kњ™\Э[›ЩKЫЩK	Щљ]™\—Э[]Z[X›IКNВ€\ЬЩ\ќ™\]X[
[Y]Kљ[™[YЪX›K›Щ™™\‹њЭ]\Л	Э[]Z[X›IКNВ€\ЬЩ\ќ™\]X[
[Y]Kљ[™[YЪX›K›Щ™™\‹њЭ]\Ф™X\ЫЫ‹	Щ[YЪXљ[]IКNВ€\ЬЩ\ќ™\]X[
[Y]Kљ[™[YЪX›KњљYKњ™]љ\Ъ[Ы‹ЉNВџJNВќ\Э
	ШЫY[ќШ[››ЭЭ™\њљYHHќ\ЭYЩ™™\‹\Щ[XЭ[Ы€ЫШЪЙЛ\Ю[И

HO€В€ЫЫњЭ[Y]OX]ШZ]ќ[“Щ™™\•[Y]PЫЫќXЭ

NВ€\ЬЩ\ќ™\]X[
[Y]KЫY[ќЫШЪЛњ™\Э[њЭ]\ЛЊЉNВ€\ЬЩ\ќ™\]X[
[Y]KЫY[ќЫШЪЛњ™\Э[›ЩKЫЩK	Ъ[ќ[YЬ™\]Y\Э	КNВ€\ЬЩ\ќ™\]X[
[Y]KЫY[ќЫШЪЛњљYKњЭ]\Л	ШЫЫXЭ[™ЙКNВ€\ЬЩ\ќ™\]X[
[Y]KЫY[ќЫШЪЛ›Щ™™\‹њЭ]\Л	ШXЭ]™IКNВџJNВќ\Э
	ЬЭXШЩ\ЬЩќ[Щ™™\€Щ[XЭ[Ы€™XЫЬ™ИHZ[љ[X[Щ\ќ™\‹][Y\Э[\Y]Y]]™[ќ	Л\Ю[И

HO€В€ЫЫњЭЭ[Y]_OX]ШZ]]Y]Y™\Э[К
K]™[ќ][Y]Kќ[Y]Y]]™[ќЦМNВ€\ЬЩ\ќ™Y\\]X[
]™[ќВ€Y‰Ш]Y]LIЛ\N‰ЫЩ™™\‹њЩ[XЭ[Ы‰ЛЭ]ЫЫYN‰ШЫЫ[Z]Y	Л™X\ЫЫЋ›ќ[€XЭЬ”›ЫN‰Ь\ЬЩ[™Щ\‰ЛXЭЬ”™YЋ‰Ь\ЬЩ[™Щ\‹[ЭЫ™\‰Л™\]Y\ЭY‘’VT‘Kњ™\]Y\ЭY€Щ™™\’Y‘’VT‘K›Щ™™\’Yњ›ЫT™]љ\Ъ[ЫЋЊ‹Ф™]љ\Ъ[ЫЋЊЛШШЭ\њ™Y]‰МЊЌ‹LKLMХОЊЊЊ‰В€JNВџJNВќ\Э
	Щ^\ћH[™[YЪXљ[]HЩ[XЭ[Ы€™Z™XЭ[ЫњИ\™H]Y]YЪ]Э]Y[Ъ[™ИHљYIЛ\Ю[И

HO€В€ЫЫњЭЭ[Y]_OX]ШZ]]Y]Y™\Э[К
NВ€›ЬЉЫЫњЭЬ™\Э[™X\ЫЫ—HЩ€ЦЭ[Y]K™^\™Y	ЫЩ™™\—Щ^\™Y	ЧKЭ[Y]Kљ[™[YЪX›K	Щљ]™\—Э[]Z[X›IЧWJ^В€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЛ›[™ЭJNВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЦМK›Э]ЫЫYK	Ь™Z™XЭY	КNВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЦМKњ™X\ЫЫ‹™X\ЫЫЉNВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЦМK™њ›ЫT™]љ\Ъ[Ы‹ЉNВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЦМKќФ™]љ\Ъ[Ы‹ЉNВ€\ЬЩ\ќ™\]X[
™\Э[њљYKњ™]љ\Ъ[Ы‹ЉNВ€BџJNВќ\Э
	ШЫЫЭ\њ™[ќЫЫ[X[™И™XЫЬ™Ы™HЫЫ[Z][™Ы™HЭ[H™Z™XЭ[Ы€Ъ]Э]™\^H\XШ][Ы‰Л\Ю[И

HO€В€ЫЫњЭЬXЩ_OX]ШZ]]Y]Y™\Э[К
NВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ›[™ЭЉNВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ™љ[\Љ]™[ќO™]™[ќ›Э]ЫЫYOOOIШЫЫ[Z]Y	КK›[™ЭJNВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ™љ[\Љ]™[ќO™]™[ќњ™X\ЫЫЏOOIЬЭ[WЬ™]љ\Ъ[Ы‰КK›[™ЭJNВ€\ЬЩ\ќ™Y\\]X[
XЩK]Y]]™[ќЛ›X\
]™[ќO™]™[ќљY
KЙШ]Y]LIЛ	Ш]Y]L‰ЧJNВџJNВќ\Э
	Ш]Y]]™[ќИ\ЩHЫ›HH[ЭЫ\Э[™^ЫYHЬ™Y[ќX[И[™љ]]H™\]Y\Э[њ]ЙЛ\Ю[И

HO€В€ЫЫњЭЩ]™[ќЯOX]ШZ]]Y]Y™\Э[К
NВ€›ЬЉЫЫњЭ]™[ќЩ€]™[ќКH\ЬЩ\ќ™Y\\]X[
Шљ™XЭљЩ^\К]™[ќ
KUQUС’QSКNВ€ЫЫњЭ[ЫЩYR”УУ‹њЭљ[™ЪYћJ]™[ќКKќУЭЩ\ђШ\ЩJ
NВ€›ЬЉЫЫњЭ›ЬљY[€Щ€Л‹‹“Шљ™XЭќ[Y\К’VT‘KќЪЩ[њКK	ЪY[\Э[ЮKZЩ^IЛ	ЬЫ™IЛ	Щ[XZ[	Л	ЫШњЩ\ќ™Y]IЛ	Ь\›Z]	Л	КНЌОIЛ	Р	ЧJ^В€\ЬЩ\ќ›ЪКY[ЫЩYљ[ЫY\К›ЬљY[‹ќУЭЩ\ђШ\ЩJ
JK›ЬљY[ЉNВ€BџJNВќ\Э
	Ш\ЬЪYЫ™Yљ]™\€[њЪ][Ы€Y[Щ\ИЫ™H™]љ\Ъ[Ы€[™^XЭ™\^HЪ[™Щ\И›Э[™ЙЛ\Ю[И

HO€В€ЫЫњЭ™\Э[X]ШZ]љYTШY™]T™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
™\Э[\њљ]љ[™ЛЬЭ]\ОЊЊ›ЩNћЪY‘’VT‘Kњ™\]Y\ЭYЭ]\О‰Ш\њљ]љ[™ЙЛ™]љ\Ъ[ЫЋЊЯ_JNВ€\ЬЩ\ќ™Y\\]X[
™\Э[\њљ]љ[™Ф™\^K™\Э[\њљ]љ[™КNВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЛ™љ[\Љ]™[ќO™]™[ќќ\OOOIЬљYKќ[њЪ][Ы‰Й‰™]™[ќ™њ›ЫT™]љ\Ъ[ЫЏOOLЉK›[™ЭJNВџJNВќ\Э
	Э™ZXЫHЫЫ™љ\›X][Ы€›Ь›X[^™\ИH›ЫЪЩY]H[™\ИY[\Э[ќ	Л\Ю[И

HO€В€ЫЫњЭ™\Э[X]ШZ]љYTШY™]T™\Э[К
NВ€\ЬЩ\ќ™\]X[
™\Э[ЫЫ™љ\›X][Ы‹њЭ]\ЛЊJNВ€\ЬЩ\ќ™Y\\]X[
™\Э[ЫЫ™љ\›X][Ы‹›ЩKЬ™\]Y\ЭY‘’VT‘Kњ™\]Y\ЭY\ЬЪYЫ›Y[ќ™]љ\Ъ[ЫЋЊЛЫЫ™љ\›YY]‰МЊЌ‹LKLMХОЊЊЊ‰ЯJNВ€\ЬЩ\ќ™Y\\]X[
™\Э[ЫЫ™љ\›X][Ы”™\^K™\Э[ЫЫ™љ\›X][ЫЉNВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЛ™љ[\Љ]™[ќO™]™[ќќ\OOOIЭ™ZXЫKЫЫ™љ\›X][Ы‰Й‰™]™[ќ›Э]ЫЫYOOOIШЫЫ[Z]Y	КK›[™Э‹	Ъ[љ]X[[™њ™\Ъ™XЫЫ™љ\›X][Ы€Ы›IКNВџJNВќ\Э
	ШH]\€™ZXЫHZ\ЫX]ЪЫX\њИ›ЫЩ€[™Y[Щ\ИH™]љ\Ъ[Ы€ЫЩIЛ\Ю[И

HO€В€ЫЫњЭ™\Э[X]ШZ]љYTШY™]T™\Э[К
K]™[ќ\™\Э[]Y]]™[ќЛ™љ[™
][OOљ][Kњ™X\ЫЫЏOOIЭ™ZXЫWЫZ\ЫX]Ъ	КNВ€\ЬЩ\ќ™\]X[
™\Э[›Z\ЫX]ЪњЭ]\ЛJNВ€\ЬЩ\ќ™\]X[
™\Э[›Z\ЫX]Ъ›ЩKЫЩK	Э™ZXЫWЫZ\ЫX]Ъ	КNВ€\ЬЩ\ќ™\]X[
™\Э[›Z\ЫX]Ъ›ЩKњ™]љ\Ъ[Ы‹JNВ€\ЬЩ\ќ™Y\\]X[
Щ]™[ќ™њ›ЫT™]љ\Ъ[Ы‹]™[ќќФ™]љ\Ъ[Ы—KНWJNВџJNВќ\Э
	ЬљYHЭ\ќ™YYИЭ\њ™[ќ™ZXЫH›ЫЩ€[™Э\њ™[ќљ]™\€[YЪXљ[]IЛ\Ю[И

HO€В€ЫЫњЭ™\Э[X]ШZ]љYTШY™]T™\Э[К
NВ€\ЬЩ\ќ™\]X[
™\Э[њЭ\ќЪ]Э]ЫЫ™љ\›X][Ы‹›ЩKЫЩK	Э™ZXЫWШЫЫ™љ\›X][Ы—Ь™\]Z\™Y	КNВ€\ЬЩ\ќ™\]X[
™\Э[њЭ\ќЪ]Э]ЫЫ™љ\›X][Ы‹›ЩKњ™]љ\Ъ[Ы‹JNВ€\ЬЩ\ќ™\]X[
™\Э[њ™]›ЪЩYљ]™\‹›ЩKЫЩK	Щљ]™\—Э[]Z[X›IКNВ€\ЬЩ\ќ™\]X[
™\Э[њ™]›ЪЩYљ]™\‹›ЩKњ™]љ\Ъ[Ы‹ЉNВ€\ЬЩ\ќ™Y\\]X[
Ь™\Э[њЭ\ќY›ЩKњЭ]\Л™\Э[њЭ\ќY›ЩKњ™]љ\Ъ[Ы—KЙЫЫ—Эљ\	ЛЧJNВ€\ЬЩ\ќ™Y\\]X[
Ь™\Э[ЫЫ\]Y›ЩKњЭ]\Л™\Э[ЫЫ\]Y›ЩKњ™]љ\Ъ[Ы—KЙШЫЫ\]Y	ЛJNВ€\ЬЩ\ќ™\]X[
™\Э[њЭ]KњЭ]\Л	ШЫЫ\]Y	КNВ€\ЬЩ\ќ™\]X[
™\Э[њЭ]Kњ™]љ\Ъ[Ы‹
NВџJNВќ\Э
	ЬљYHШY™]H]Y]™XЫЬ™ИXЪ\Ъ[ЫњИЪ]Э]ШњЩ\ќ™Y]HЬ€™\^H\XШ]\ЙЛ\Ю[И

HO€В€ЫЫњЭ™\Э[X]ШZ]љYTШY™]T™\Э[К
NВ€\ЬЩ\ќ™\]X[
™\Э[]Y]]™[ќЛ›[™Э
NВ€\ЬЩ\ќ™Y\\]X[
™\Э[]Y]]™[ќЛ›X\
]™[ќO™]™[ќљY
KЙШ]Y]LIЛ	Ш]Y]L‰Л	Ш]Y]LЙЛ	Ш]Y]M	Л	Ш]Y]MIЛ	Ш]Y]M‰Л	Ш]Y]MЙЛ	Ш]Y]N	ЧJNВ€\ЬЩ\ќ›ЪК™\Э[]Y]]™[ќЛ™]™\ћJ]™[ќO“Шљ™XЭљЩ^\К]™[ќ
Kљ›Ъ[Љ	Я	КOOOPUQUС’QSЛљ›Ъ[Љ	Я	КJJNВ€ЫЫњЭ[ЫЩYR”УУ‹њЭљ[™ЪYћJ™\Э[]Y]]™[ќКKќУЭЩ\ђШ\ЩJ
NВ€\ЬЩ\ќ›ЪКY[ЫЩYљ[ЫY\К	Щ[[ИIКJNВ€\ЬЩ\ќ›ЪКY[ЫЩYљ[ЫY\К	Щ[[ИNNIКJNВ€\ЬЩ\ќ›ЪКY[ЫЩYљ[ЫY\К	ЫШњЩ\ќ™Y]IКJNВџJNВќ\Э
	Ш›Ш\™[™ИXЩHЫЫ[Z]И^XЭHЫ™HЩ€Ш[Щ[][Ы€[™љYHЭ\ќ	Л\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™Y\\]X[
ЬXЩKШ[Щ[њЭ]\ЛXЩKњЭ\ќњЭ]\ЧKњЫЬќ

KЉOOKXЉKМЊWJNВ€\ЬЩ\ќ™\]X[
XЩKњЭ]Kњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ™љ[\Љ]™[ќO™]™[ќ›Э]ЫЫYOOOIШЫЫ[Z]Y	КK›[™ЭJNВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ™љ[\Љ]™[ќO™]™[ќњ™X\ЫЫЏOOIЬЭ[WЬ™]љ\Ъ[Ы‰КK›[™ЭJNВ€BџJNВќ\Э
	ШШ[Щ[][Ы‹Yљ\њЭ™]™[ќИЭ[HљYHЭ\ќ[™ЫX\њИ™ZXЫH›ЫЩ‰Л\Ю[И

HO€В€ЫЫњЭШШ[Щ[љ\њЭOX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
Ш[Щ[љ\њЭШ[Щ[њЭ]\ЛЊ
NВ€\ЬЩ\ќ™\]X[
Ш[Щ[љ\њЭњЭ]KњЭ]\Л	ШШ[Щ[Y	КNВ€\ЬЩ\ќ™\]X[
Ш[Щ[љ\њЭњЭ]Kќ™ZXЫPЫЫ™љ\›X][Ы‹ќ[
NВ€\ЬЩ\ќ™\]X[
Ш[Щ[љ\њЭњЭ\ќ›ЩKЫЩK	ЬЭ[WЬ™]љ\Ъ[Ы‰КNВ€\ЬЩ\ќ™\]X[
Ш[Щ[љ\њЭњЭ\ќ›ЩKњ™]љ\Ъ[Ы‹КNВџJNВќ\Э
	ЬљYK\Э\ќYљ\њЭ™]™[ќИЭ[HШ[Щ[][Ы€Yќ\€›Ш\™[™И™YЪ[њЙЛ\Ю[И

HO€В€ЫЫњЭЬЭ\ќљ\њЭOX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
Э\ќљ\њЭњЭ\ќњЭ]\ЛЊ
NВ€\ЬЩ\ќ™\]X[
Э\ќљ\њЭњЭ]KњЭ]\Л	ЫЫ—Эљ\	КNВ€\ЬЩ\ќ™\]X[
Э\ќљ\њЭШ[Щ[›ЩKЫЩK	ЬЭ[WЬ™]љ\Ъ[Ы‰КNВ€\ЬЩ\ќ™\]X[
Э\ќљ\њЭШ[Щ[›ЩKњ™]љ\Ъ[Ы‹КNВџJNВќ\Э
	Ш›Ш\™[™Л\XЩHЪ[›™\€™\^H\ИЭX›HЪ]Э]\XШ]HЭ]HЬ€]Y]	Л\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€ЫЫњЭЪ[›™\”™\Э[\XЩKќЪ[›™\ЏOOIШШ[Щ[	ПЬXЩKШ[Щ[њXЩKњЭ\ќВ€\ЬЩ\ќ™Y\\]X[
XЩKњ™\^KЪ[›™\”™\Э[
NВ€\ЬЩ\ќ™\]X[
XЩKњЭ]Kњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ›[™ЭЉNВ€\ЬЩ\ќ™Y\\]X[
XЩK]Y]]™[ќЛ›X\
]™[ќO™]™[ќљY
KЙШ]Y]LIЛ	Ш]Y]L‰ЧJNВ€BџJNВќ\Э
	ШШ[Щ[][Ы‹\XЩH\ќXЪ\[ќИ™XЫЭ™\€›ЫK\Ъ\YШ[Щ[YЭ]IЛ\Ю[И

HO€В€ЫЫњЭЬ™XЫЭ™\ћ_OH
]ШZ]›Ш\™[™ФXЩT™\Э[К
JKШ[Щ[љ\њЭВ€\ЬЩ\ќ™Y\\]X[
™XЫЭ™\ћKњ\ЬЩ[™Щ\‹ЬЭ]\ОЊЊ›ЩNћВ€Y‘’VT‘Kњ™\]Y\ЭYЭ]\О‰ШШ[Щ[Y	Л™]љ\Ъ[ЫЋЌЛљY]Щ\”›ЫN‰Ь\ЬЩ[™Щ\‰Л€™^XЭ[ЫЋ‰ЬЪЭЧШШ[Щ[YЪ\ЭЬћIЛ\]Y]‰МЊЌ‹LKLMХОЊЊЊ‰В€KXY\њОћЩ]YОњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹љXY\њЛ™]YЛШXЪPЫЫќ›Ы‰Ьљ]]K›ЛXШXЪIЛ\ћN‰Р]]Ьљ^][Ы‰Я_JNВ€\ЬЩ\ќ™Y\\]X[
™XЫЭ™\ћK™љ]™\‹ЬЭ]\ОЊЊ›ЩNћВ€Y‘’VT‘Kњ™\]Y\ЭYЭ]\О‰ШШ[Щ[Y	Л™]љ\Ъ[ЫЋЌЛљY]Щ\”›ЫN‰Щљ]™\‰Л€™^XЭ[ЫЋ‰ЬЪЭЧШШ[Щ[YЭљ\	Л\]Y]‰МЊЌ‹LKLMХОЊЊЊ‰В€KXY\њОћЩ]YОњ™XЫЭ™\ћK™љ]™\‹љXY\њЛ™]YЛШXЪPЫЫќ›Ы‰Ьљ]]K›ЛXШXЪIЛ\ћN‰Р]]Ьљ^][Ы‰Я_JNВџJNВќ\Э
	ЬљYK\Э\ќ\XЩH\ќXЪ\[ќИ™XЫЭ™\€›ЫK\Ъ\YЫ‹]љ\Э]IЛ\Ю[И

HO€В€ЫЫњЭЬ™XЫЭ™\ћ_OH
]ШZ]›Ш\™[™ФXЩT™\Э[К
JKњЭ\ќљ\њЭВ€\ЬЩ\ќ™Y\\]X[
Ь™XЫЭ™\ћKњ\ЬЩ[™Щ\‹›ЩKњЭ]\Л™XЫЭ™\ћKњ\ЬЩ[™Щ\‹›ЩKњ™]љ\Ъ[Ы‹™XЫЭ™\ћKњ\ЬЩ[™Щ\‹›ЩK›™^XЭ[Ы—KЙЫЫ—Эљ\	ЛЛ	ЬЪЭЧЫЫ—Эљ\	ЧJNВ€\ЬЩ\ќ™Y\\]X[
Ь™XЫЭ™\ћK™љ]™\‹›ЩKњЭ]\Л™XЫЭ™\ћK™љ]™\‹›ЩKњ™]љ\Ъ[Ы‹™XЫЭ™\ћK™љ]™\‹›ЩK›™^XЭ[Ы—KЙЫЫ—Эљ\	ЛЛ	ШЫЫќ[ќYWЭљ\	ЧJNВ€\ЬЩ\ќ™Y\\]X[
Ь™XЫЭ™\ћKњ\ЬЩ[™Щ\‹›ЩKќљY]Щ\”›ЫK™XЫЭ™\ћK™љ]™\‹›ЩKќљY]Щ\”›ЫWKЙЬ\ЬЩ[™Щ\‰Л	Щљ]™\‰ЧJNВџJNВќ\Э
	Ь™XЫЭ™\ћH™XYЫЫЩX[ИHљYHњ›ЫH[њ™[]Y\ЬЩ[™Щ\њИ[™љ]™\њЙЛ\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€›ЬЉЫЫњЭ™\Э[Щ€ЬXЩKњ™XЫЭ™\ћK›Э\”\ЬЩ[™Щ\‹XЩKњ™XЫЭ™\ћK›Э\‘љ]™\—J^В€\ЬЩ\ќ™\]X[
™\Э[њЭ]\Л
NВ€\ЬЩ\ќ™\]X[
™\Э[›ЩKЫЩK	Ь™\ЫЭ\ЩWЫ›ЭЩ›Э[™	КNВ€\ЬЩ\ќ›X]Ъ
™\Э[›ЩKњ™\]Y\ЭYЧќXЩK[[ШЪЛKКNВ€\ЬЩ\ќ›ЪКR”УУ‹њЭљ[™ЪYћJ™\Э[›ЩJKљ[ЫY\К	Ь\ЬЩ[™Щ\‹[ЭЫ™\‰КJNВ€\ЬЩ\ќ›ЪКR”УУ‹њЭљ[™ЪYћJ™\Э[›ЩJKљ[ЫY\К	Щљ]™\‹X\ЬЪYЫ™Y	КJNВ€B€BџJNВќ\Э
	Ь™XЫЭ™\ћH™\ЬЫњЩH^ЬЩ\ИЫ›HHШЭ[Y[ќYШY™HљY[[ЭЫ\Э	Л\Ю[И

HO€В€ЫЫњЭШY™QљY[ПVЙЪY	Л	ЬЭ]\ЙЛ	Ь™]љ\Ъ[Ы‰Л	ЭљY]Щ\”›ЫIЛ	Ы™^XЭ[Ы‰Л	Э\]Y]	ЧNВ€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™Y\\]X[
Шљ™XЭљЩ^\КXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹›ЩJKШY™QљY[КNВ€\ЬЩ\ќ™Y\\]X[
Шљ™XЭљЩ^\КXЩKњ™XЫЭ™\ћK™љ]™\‹›ЩJKШY™QљY[КNВ€ЫЫњЭ[ЫЩYR”УУ‹њЭљ[™ЪYћJЬXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹›ЩKXЩKњ™XЫЭ™\ћK™љ]™\‹›ЩWJKќУЭЩ\ђШ\ЩJ
NВ€›ЬЉЫЫњЭ›ЬљY[€Щ€ЙШ\ЬЪYЫ™Yљ]™\љY	Л	Э™ZXЫXЫЫ™љ\›X][Ы‰Л	ЬЩ[XЭYЩ™™\љY	Л	Ь]IЛ	ЬЫ™IЛ	Ь\›Z]	ЧJH\ЬЩ\ќ›ЪКY[ЫЩYљ[ЫY\К›ЬљY[ЉK›ЬљY[ЉNВ€BџJNВќ\Э
	Ь™XЫЭ™\ћH™XYИИ›ЭY[ЩH™]љ\Ъ[Ы‹ЫЫњЭ[YHY[\Э[ЮHЩ^\ИЬ€Y]Y]]™[ќЙЛ\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™\]X[
XЩKњЭ]Kњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩKњЭЬ™YЩ^\ЛЉNВ€\ЬЩ\ќ™\]X[
XЩK]Y]]™[ќЛ›[™ЭЉNВ€\ЬЩ\ќ™Y\\]X[
XЩK]Y]]™[ќЛ›X\
]™[ќO™]™[ќљY
KЙШ]Y]LIЛ	Ш]Y]L‰ЧJNВ€BџJNВќ\Э
	ЬљYK\Э]H™\ЬЫњЩ\И\ЩHљ]]H›ЫK\ШЫЬY[Y]ЬњЙЛ\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ›X]Ъ
XЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹љXY\њЛ™]YЛЧ€–РKVK^ЊNWЛW^МЌH‰КNВ€\ЬЩ\ќ›X]Ъ
XЩKњ™XЫЭ™\ћK™љ]™\‹љXY\њЛ™]YЛЧ€–РKVK^ЊNWЛW^МЌH‰КNВ€\ЬЩ\ќ››Э\]X[
XЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹љXY\њЛ™]YЛXЩKњ™XЫЭ™\ћK™љ]™\‹љXY\њЛ™]YКNВ€›ЬЉЫЫњЭ™\Э[Щ€ЬXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹XЩKњ™XЫЭ™\ћK™љ]™\—J^В€\ЬЩ\ќ™\]X[
™\Э[љXY\њЛШXЪPЫЫќ›Ы	Ьљ]]K›ЛXШXЪIКNВ€\ЬЩ\ќ™\]X[
™\Э[љXY\њЛќ\ћK	Р]]Ьљ^][Ы‰КNВ€B€BџJNВќ\Э
	ЫX]Ъ[™ИЭ›Ы™И[™ЩXZИ[Y]ЬњИ™]\›€›Щ[\ЬИМ	Л\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™Y\\]X[
ЬXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\“›Э[ЩYљYYњЭ]\ЛXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\“›Э[ЩYљYY›ЩWKММќ[JNВ€\ЬЩ\ќ™Y\\]X[
ЬXЩKњ™XЫЭ™\ћK™љ]™\“›Э[ЩYљYYњЭ]\ЛXЩKњ™XЫЭ™\ћK™љ]™\“›Э[ЩYљYY›ЩWKММќ[JNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\“›Э[ЩYљYYљXY\њЛ™]YЛXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹љXY\њЛ™]YКNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћK™љ]™\“›Э[ЩYљYYљXY\њЛ™]YЛXЩKњ™XЫЭ™\ћK™љ]™\‹љXY\њЛ™]YКNВ€BџJNВќ\Э
	ШHЭ[H[Y]Ь€™]\›њИHЭ\њ™[ќ™\™\Щ[ќ][Ы€[™™\XЩ[Y[ќUYЙЛ\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKњЭ[T\ЬЩ[™Щ\‹њЭ]\ЛЊ
NВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKњЭ[T\ЬЩ[™Щ\‹›ЩKњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKњЭ[T\ЬЩ[™Щ\‹›ЩKњЭ]\ЛXЩKњЭ]KњЭ]\КNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKњЭ[T\ЬЩ[™Щ\‹љXY\њЛ™]YЛXЩKњ™XЫЭ™\ћKњ\ЬЩ[™Щ\‹љXY\њЛ™]YКNВ€BџJNВќ\Э
	ШH\ЬЩ[™Щ\€[Y]Ь€Ш[››ЭЭ\™\ЬИHљ]™\€™\™\Щ[ќ][Ы‰Л\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKЬ›ЬЬФ›ЫU[Y]Ь‹њЭ]\ЛЊ
NВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKЬ›ЬЬФ›ЫU[Y]Ь‹›ЩKќљY]Щ\”›ЫK	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKЬ›ЬЬФ›ЫU[Y]Ь‹љXY\њЛ™]YЛXЩKњ™XЫЭ™\ћK™љ]™\‹љXY\њЛ™]YКNВ€BџJNВќ\Э
	ЭЪ[Ш\™™][Y][Ы€ШШЭ\њИЫ›HYќ\€\ќXЪ\[ќ]]Ьљ^][Ы‰Л\Ю[И

HO€В€ЫЫњЭXЩ\ПX]ШZ]›Ш\™[™ФXЩT™\Э[К
NВ€›ЬЉЫЫњЭXЩHЩ€ЬXЩ\ЛШ[Щ[љ\њЭXЩ\ЛњЭ\ќљ\њЭJ^В€\ЬЩ\ќ™Y\\]X[
ЬXЩKњ™XЫЭ™\ћKќЪ[Ш\™\ЬЩ[™Щ\‹њЭ]\ЛXЩKњ™XЫЭ™\ћKќЪ[Ш\™\ЬЩ[™Щ\‹›ЩWKММќ[JNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKќЪ[Ш\™Э\‹њЭ]\Л
NВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKќЪ[Ш\™Э\‹›ЩKЫЩK	Ь™\ЫЭ\ЩWЫ›ЭЩ›Э[™	КNВ€\ЬЩ\ќ™\]X[
XЩKњ™XЫЭ™\ћKќЪ[Ш\™Э\‹љXY\њЛ™]YЛќ[
NВ€BџJNВќ\Э
	НЋH™XЫЭ™\ћHЫ›ЬњИ™]ћKPYќ\€™Y›Ь™HЭXШЩYY[™ЙЛ\Ю[И

HO€В€ЫЫњЭЬ]S[Z]YOX]ШZ]™XЫЭ™\ћT™]ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
]S[Z]Y™[^\ЛММJNВ€\ЬЩ\ќ™Y\\]X[
]S[Z]Yњ™\Э[][\Л›X\
][\O][\њЭ]\КKНЋKЊJNВ€\ЬЩ\ќ™\]X[
]S[Z]Yњ™\Э[њЭЬY	ЬЭXШЩ\ЬЙКNВ€\ЬЩ\ќ™\]X[
]S[Z]Yњ™\Э[њ™\Э[›ЩKњ™]љ\Ъ[Ы‹КNВџJNВќ\Э
	НLИ™XЫЭ™\ћH\Щ\ИШ\Y^Ы™[ќX[XЪЫЩ™€Ъ[€™]ћKPYќ\€\ИXњЩ[ќ	Л\Ю[И

HO€В€ЫЫњЭЭ[]Z[X›_OX]ШZ]™XЫЭ™\ћT™]ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
[]Z[X›K™[^\ЛМLЊJNВ€\ЬЩ\ќ™Y\\]X[
[]Z[X›Kњ™\Э[][\Л›X\
][\O][\њЭ]\КKНLЛLЛЊJNВ€\ЬЩ\ќ™\]X[
[]Z[X›Kњ™\Э[њЭЬY	ЬЭXШЩ\ЬЙКNВџJNВќ\Э
	Ы™]ЫЬљИZ[\™H™]љY\ИЪ]XЪЫЩ™€[™[€™XЫЭ™\њЙЛ\Ю[И

HO€В€ЫЫњЭЫ™]ЫЬљЯOX]ШZ]™XЫЭ™\ћT™]ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
™]ЫЬљЛШ[ЛЉNВ€\ЬЩ\ќ™Y\\]X[
™]ЫЬљЛ™[^\ЛМLJNВ€\ЬЩ\ќ™Y\\]X[
™]ЫЬљЛњ™\Э[][\Л›X\
][\O][\њЭ]\КKМЊJNВ€\ЬЩ\ќ™\]X[
™]ЫЬљЛњ™\Э[њЭЬY	ЬЭXШЩ\ЬЙКNВџJNВќ\Э
	Ь™]ћH[^\И[™][\И\™H›Э[™Y\љ[™ИHЭ\ЭZ[™YЭ]YЩIЛ\Ю[И

HO€В€ЫЫњЭЩ^]\ЭYOX]ШZ]™XЫЭ™\ћT™]ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
^]\ЭY™[^\ЛНЊЊЊJNВ€\ЬЩ\ќ™\]X[
^]\ЭYњ™\Э[][\Л›[™Э
NВ€\ЬЩ\ќ™\]X[
^]\ЭYњ™\Э[њЭЬY	Щ^]\ЭY	КNВ€\ЬЩ\ќ›ЪК^]\ЭYњ™\Э[][\Л™]™\ћJ][\O][\њЭ]\ПOOMLКJNВџJNВќ\Э
	ШXШЩ\ЬИ[љX[ЭЬИ™XЫЭ™\ћHЪ]Э]™]ћZ[™ИЬ€™]™X[[™ИHљYIЛ\Ю[И

HO€В€ЫЫњЭШXШЩ\ЬС[љYYOX]ШZ]™XЫЭ™\ћT™]ћT™\Э[К
NВ€\ЬЩ\ќ™Y\\]X[
XШЩ\ЬС[љYY™[^\ЛЧJNВ€\ЬЩ\ќ™\]X[
XШЩ\ЬС[љYYњ™\Э[][\Л›[™ЭJNВ€\ЬЩ\ќ™\]X[
XШЩ\ЬС[љYYњ™\Э[њЭЬY	ШXШЩ\ЬЙКNВ€\ЬЩ\ќ™\]X[
XШЩ\ЬС[љYYњ™\Э[њ™\Э[њЭ]\Л
NВ€\ЬЩ\ќ™\]X[
XШЩ\ЬС[љYYњ™\Э[њ™\Э[›ЩKЫЩK	Ь™\ЫЭ\ЩWЫ›ЭЩ›Э[™	КNВџJNВќ\Э
	ШHY[€ШЬ™Y[€ЭЬИ™XЫЭ™\ћH™Y›Ь™H[ћH™]ЫЬљИ™\]Y\Э	Л\Ю[И

HO€В€ЫЫњЭЪY[џOX]ШZ]™XЫЭ™\ћT™]ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
Y[‹Ш[Л
NВ€\ЬЩ\ќ™Y\\]X[
Y[‹њ™\Э[][\ЛЧJNВ€\ЬЩ\ќ™\]X[
Y[‹њ™\Э[њЭЬY	ЪY[‰КNВџJNВќ\Э
	Ф™]ћKPYќ\€XШЩ\И[€]Hќ]™Z™XЭИ[ќ[Y[њ][™Ы[\И^™[Y\ЙЛ

HO€В€ЫЫњЭ›ЭПQ]Kњ\њЩJ	МЊЌ‹LKLMХОЊЊ‰КNВ€\ЬЩ\ќ™\]X[
\њЩT™]ћPYќ\“\К	ХKMИЩ\ЊЌ€ОЊЊHУU	Л›ЭКKL
NВ€\ЬЩ\ќ™\]X[
\њЩT™]ћPYќ\“\К	Ъ[ќ[Y	Л›ЭКKќ[
NВ€\ЬЩ\ќ™\]X[
\њЩT™]ћPYќ\“\К	М	Л›ЭКKL
NВ€\ЬЩ\ќ™\]X[
\њЩT™]ћPYќ\“\К	ОNNIЛ›ЭКKЊ
NВџJNВќ\Э
	ШH[^YY™XЫЭ™\ћH™\ЬЫњЩHШ[››Э›ЫXЪИH™]Щ\€›ЭYљXШ][Ы‰Л

HO€В€ЫЫњЭЫ™]Щ\“›ЭYљXШ][Ы‹[^YY™XЫЭ™\ћ_O\™]љ\Ъ[Ы“Y\™ЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
™]Щ\“›ЭYљXШ][Ы‹\YYќYJNВ€\ЬЩ\ќ™\]X[
™]Щ\“›ЭYљXШ][Ы‹њЭ]Kњ™]љ\Ъ[Ы‹
NВ€\ЬЩ\ќ™\]X[
™]Щ\“›ЭYљXШ][Ы‹њЭ]KњЭ]\Л	ШШ[Щ[Y	КNВ€\ЬЩ\ќ™\]X[
[^YY™XЫЭ™\ћK\YY[ЩJNВ€\ЬЩ\ќ™\]X[
[^YY™XЫЭ™\ћKњ™X\ЫЫ‹	ЬЭ[IКNВ€\ЬЩ\ќ™\]X[
[^YY™XЫЭ™\ћKњЭ]Kњ™]љ\Ъ[Ы‹
NВ€\ЬЩ\ќ™\]X[
[^YY™XЫЭ™\ћKњЭ]KњЭ]\Л	ШШ[Щ[Y	КNВџJNВќ\Э
	ШH[^YY›ЭYљXШ][Ы€Ш[››Э›ЫXЪИH™]Щ\€™XЫЭ™\ћH™\ЬЫњЩIЛ

HO€В€ЫЫњЭЫ™]Щ\”™XЫЭ™\ћK[^YY›ЭYљXШ][ЫџO\™]љ\Ъ[Ы“Y\™ЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
™]Щ\”™XЫЭ™\ћKњЭ]Kњ™]љ\Ъ[Ы‹JNВ€\ЬЩ\ќ™\]X[
™]Щ\”™XЫЭ™\ћKњЭ]KњЭ]\Л	ЫЫ—Эљ\	КNВ€\ЬЩ\ќ™\]X[
[^YY›ЭYљXШ][Ы‹\YY[ЩJNВ€\ЬЩ\ќ™\]X[
[^YY›ЭYљXШ][Ы‹њ™X\ЫЫ‹	ЬЭ[IКNВ€\ЬЩ\ќ™\]X[
[^YY›ЭYљXШ][Ы‹њЭ]KњЭ]\Л	ЫЫ—Эљ\	КNВџJNВќ\Э
	Ш[€^XЭ\XШ]H™]љ\Ъ[Ы€\ИYЫ›Ь™YЪ]Э]™\]Y\Э[™И™XЫЭ™\ћIЛ

HO€В€ЫЫњЭЩ\XШ]_O\™]љ\Ъ[Ы“Y\™ЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
\XШ]K\YY[ЩJNВ€\ЬЩ\ќ™\]X[
\XШ]Kњ™X\ЫЫ‹	Щ\XШ]IКNВ€\ЬЩ\ќ™\]X[
\XШ]K›™YYФ™XЫЭ™\ћK[ЩJNВ€\ЬЩ\ќ™\]X[
\XШ]KњЭ]Kњ™]љ\Ъ[Ы‹
NВџJNВќ\Э
	ШЫЫ™›XЭ[™ИЫЫќ[ќ]HШ[YH™]љ\Ъ[Ы€\И›Э\YY[™™\]Y\ЭИ™XЫЭ™\ћIЛ

HO€В€ЫЫњЭШЫЫ™›XЭ[™ЯO\™]љ\Ъ[Ы“Y\™ЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
ЫЫ™›XЭ[™Л\YY[ЩJNВ€\ЬЩ\ќ™\]X[
ЫЫ™›XЭ[™Лњ™X\ЫЫ‹	ЬШ[YWЬ™]љ\Ъ[Ы—ШЫЫ™›XЭ	КNВ€\ЬЩ\ќ™\]X[
ЫЫ™›XЭ[™Л›™YYФ™XЫЭ™\ћKќYJNВ€\ЬЩ\ќ™\]X[
ЫЫ™›XЭ[™ЛњЭ]KњЭ]\Л	ШШ[Щ[Y	КNВџJNВќ\Э
	ШH›ЭYљXШ][Ы€™]љ\Ъ[Ы€Ш\ШZ]И›Ь€[€]]Ьљ]]]™H™XЫЭ™\ћHЫ\ЪЭ	Л

HO€В€ЫЫњЭЩШ\Ш\™XЫЭ™\ћ_O\™]љ\Ъ[Ы“Y\™ЩT™\Э[К
NВ€\ЬЩ\ќ™\]X[
Ш\\YY[ЩJNВ€\ЬЩ\ќ™\]X[
Ш\њ™X\ЫЫ‹	Ь™]љ\Ъ[Ы—ЩШ\	КNВ€\ЬЩ\ќ™\]X[
Ш\›™YYФ™XЫЭ™\ћKќYJNВ€\ЬЩ\ќ™\]X[
Ш\њЭ]Kњ™]љ\Ъ[Ы‹КNВ€\ЬЩ\ќ™\]X[
Ш\™XЫЭ™\ћK\YYќYJNВ€\ЬЩ\ќ™\]X[
Ш\™XЫЭ™\ћKњЭ]Kњ™]љ\Ъ[Ы‹L
NВ€\ЬЩ\ќ™\]X[
Ш\™XЫЭ™\ћKњЭ]KњЭ]\Л	ШЫЫ\]Y	КNВџJNВќ\Э
	ШЬ›ЬЬЛ\љYKЬ›ЬЬЛ\›ЫH[™›ЭYљXШ][Ы‹[Ы›H\Щ[[™\И™]™\€[ќ\€HЭ\њ™[ќљY]ЙЛ

HO€В€ЫЫњЭЭЬ›Ы™ФљYKЬ›Ы™Ф›ЫKZ\ЬЪ[™Р\Щ[[™K™XЫЭ™\™Y\Щ[[™_O\™]љ\Ъ[Ы“Y\™ЩT™\Э[К
NВ€›ЬЉЫЫњЭ™\Э[Щ€ЭЬ›Ы™ФљYKЬ›Ы™Ф›ЫWJ^В€\ЬЩ\ќ™\]X[
™\Э[\YY[ЩJNВ€\ЬЩ\ќ™\]X[
™\Э[њ™X\ЫЫ‹	ЬШЫЬWЫZ\ЫX]Ъ	КNВ€\ЬЩ\ќ™\]X[
™\Э[›™YYФ™XЫЭ™\ћK[ЩJNВ€\ЬЩ\ќ™\]X[
™\Э[њЭ]Kњ™]љ\Ъ[Ы‹КNВ€B€\ЬЩ\ќ™\]X[
Z\ЬЪ[™Р\Щ[[™Kњ™X\ЫЫ‹	ЫZ\ЬЪ[™ЧШ\Щ[[™IКNВ€\ЬЩ\ќ™\]X[
Z\ЬЪ[™Р\Щ[[™K›™YYФ™XЫЭ™\ћKќYJNВ€\ЬЩ\ќ™\]X[
Z\ЬЪ[™Р\Щ[[™KњЭ]Kќ[
NВ€\ЬЩ\ќ™\]X[
™XЫЭ™\™Y\Щ[[™K\YYќYJNВ€\ЬЩ\ќ™\]X[
™XЫЭ™\™Y\Щ[[™Kњ™X\ЫЫ‹	Ш\Щ[[™IКNВ€\ЬЩ\ќ™\]X[
™XЫЭ™\™Y\Щ[[™KњЭ]Kњ™]љ\Ъ[Ы‹
NВџJNВќ\Э
	ШHZ[љ[X[›ЭYљXШ][Ы€[ќШќZ[њИ\Ь^HЭ]HЫ›Hњ›ЫH[€]]Ьљ^™Y™XЫЭ™\ћH™XY	Л\Ю[И

HO€В€ЫЫњЭШ]]Ьљ^™YOX]ШZ]›ЭYљXШ][Ы’[ќ™\Э[К
NВ€\ЬЩ\ќ™\]X[
]]Ьљ^™YШ[ЛJNВ€\ЬЩ\ќ™Y\\]X[
]]Ьљ^™Yњ™XЫЭ™\™Yњ›ЫKЭ\N‰ЬљYKЪ[™ЩY	ЛљYRY‘’VT‘Kњ™\]Y\ЭY™]љ\Ъ[ЫЋЋ_JNВ€\ЬЩ\ќ™\]X[
]]Ьљ^™Y™™]ЪYќYJNВ€\ЬЩ\ќ™\]X[
]]Ьљ^™Y\YYќYJNВ€\ЬЩ\ќ™\]X[
]]Ьљ^™YњЭ]Kњ™]љ\Ъ[Ы‹JNВ€\ЬЩ\ќ™\]X[
]]Ьљ^™YњЭ]KњЭ]\Л	ЫЫ—Эљ\	КNВ€\ЬЩ\ќ™\]X[
]]Ьљ^™YњЭ]K›™^XЭ[Ы‹	ЬЪЭЧЫЫ—Эљ\	КNВџJNВќ\Э
	Ы›ЭYљXШ][Ы€^[ШYИЫЫќZ[љ[™Иљ]]HЬ€\Ь^HљY[И\™H™Z™XЭYЪ]Э]H™XY	Л\Ю[И

HO€В€ЫЫњЭЬЩ[њЪ]]™K™Z™XЭYШ[ЯOX]ШZ]›ЭYљXШ][Ы’[ќ™\Э[К
NВ€\ЬЩ\ќ™\]X[
™Z™XЭYШ[Л
NВ€\ЬЩ\ќ™\]X[
Щ[њЪ]]™K™™]ЪY[ЩJNВ€\ЬЩ\ќ™\]X[
Щ[њЪ]]™K\YY[ЩJNВ€\ЬЩ\ќ™\]X[
Щ[њЪ]]™Kњ™X\ЫЫ‹	Ъ[ќ[YЪ[ќ	КNВ€\ЬЩ\ќ™\]X[
Щ[њЪ]]™KњЭ]KњЭ]\Л	ШШ[Щ[Y	КNВџJNВќ\Э
	ЬЭ[K\XШ]H[™›Ь™ZYЫ€љYH[ќИИ›ЭљYЩЩ\€™XЫЭ™\ћHY™љXЙЛ\Ю[И

HO€В€ЫЫњЭЬЭ[K\XШ]K›Ь™ZYЫ‹™Z™XЭYШ[ЯOX]ШZ]›ЭYљXШ][Ы’[ќ™\Э[К
NВ€\ЬЩ\ќ™\]X[
™Z™XЭYШ[Л
NВ€\ЬЩ\ќ™Y\\]X[
ЬЭ[Kњ™X\ЫЫ‹\XШ]Kњ™X\ЫЫ‹›Ь™ZYЫ‹њ™X\ЫЫ—KЙЬЭ[WЫЬ—Щ\XШ]WЪ[ќ	Л	ЬЭ[WЫЬ—Щ\XШ]WЪ[ќ	Л	Щ›Ь™ZYЫ—Ъ[ќ	ЧJNВ€›ЬЉЫЫњЭ™\Э[Щ€ЬЭ[K\XШ]K›Ь™ZYЫ—J^В€\ЬЩ\ќ™\]X[
™\Э[™™]ЪY[ЩJNВ€\ЬЩ\ќ™\]X[
™\Э[њЭ]Kњ™]љ\Ъ[Ы‹
NВ€BџJNВќ\Э
	Ш[€]]Ьљ^™YЫX\њИШXЪYљYHЭ]HYќ\€XШЩ\ЬИ\ИЬЭ	Л\Ю[И

HO€В€ЫЫњЭШXШЩ\ЬУЬЭOX]ШZ]›ЭYљXШ][Ы’[ќ™\Э[К
NВ€\ЬЩ\ќ™\]X[
XШЩ\ЬУЬЭ™™]ЪYќYJNВ€\ЬЩ\ќ™\]X[
XШЩ\ЬУЬЭњ™X\ЫЫ‹	ШXШЩ\ЬЧЫЬЭ	КNВ€\ЬЩ\ќ™\]X[
XШЩ\ЬУЬЭњЭ]Kќ[
NВ€\ЬЩ\ќ™\]X[
XШЩ\ЬУЬЭ›™YYФ™XЫЭ™\ћK[ЩJNВџJNВќ\Э
	ШH™]Щ\€[ќЪ]HМ™\ЬЫњЩH™]™\€XњљXШ]\ИH[ќYЭ]IЛ\Ю[И

HO€В€ЫЫњЭЫ›ЭY]љ\ЪX›_OX]ШZ]›ЭYљXШ][Ы’[ќ™\Э[К
NВ€\ЬЩ\ќ™\]X[
›ЭY]љ\ЪX›K™™]ЪYќYJNВ€\ЬЩ\ќ™\]X[
›ЭY]љ\ЪX›K\YY[ЩJNВ€\ЬЩ\ќ™\]X[
›ЭY]љ\ЪX›Kњ™X\ЫЫ‹	Ъ[ќЫ›ЭЮY]Эљ\ЪX›IКNВ€\ЬЩ\ќ™\]X[
›ЭY]љ\ЪX›K›™YYФ™XЫЭ™\ћKќYJNВ€\ЬЩ\ќ™\]X[
›ЭY]љ\ЪX›KњЭ]Kњ™]љ\Ъ[Ы‹
NВ€\ЬЩ\ќ™\]X[
›ЭY]љ\ЪX›KњЭ]KњЭ]\Л	ШШ[Щ[Y	КNВџJNВќ\Э
	ШH›ЭYљXШ][Ы€Ш[€™\]Y\Эќ]Ш[››Э]Щ[€\ЭX›\Ъ[€[љ]X[\Ь^H\Щ[[™IЛ\Ю[И

HO€В€ЫЫњЭЪ[љ]X[OX]ШZ]›ЭYљXШ][Ы’[ќ™\Э[К
NВ€\ЬЩ\ќ™\]X[
[љ]X[™™]ЪYќYJNВ€\ЬЩ\ќ™\]X[
[љ]X[\YYќYJNВ€\ЬЩ\ќ™\]X[
[љ]X[њ™X\ЫЫ‹	Ш\Щ[[™IКNВ€\ЬЩ\ќ™\]X[
[љ]X[њЭ]Kњ™]љ\Ъ[Ы‹
NВ€\ЬЩ\ќ™\]X[
[љ]X[њЭ]KњЭ]\Л	Ш\ЬЪYЫ™Y	КNВ€\ЬЩ\ќ™\]X[
[љ]X[њЭ]KќљY]Щ\”›ЫK	Ь\ЬЩ[™Щ\‰КNВџJNВќ\Э
	ЫЩЫЭ]ЫX\њИљYHЭ]KUYИ[™ШЪY[Y™]ћHЭ]IЛ

HO€В€ЫЫњЭЫЩЩЩYЭ]™]ћPШ[Щ[YO\Щ\ЬЪ[Ы’\ЫЫ][Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
™]ћPШ[Щ[YJNВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]XЭ]™K[ЩJNВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]њЭ]Kќ[
NВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]™]YЛќ[
NВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]њ™]ћTШЪY[Y[ЩJNВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]љ[‘›YЪ
NВџJNВќ\Э
	ЫЩЫЭ]X›ЬќИ[€[‹Y›YЪ™XЫЭ™\ћH™\]Y\Э	Л

HO€В€ЫЫњЭЫЩЫЭ]ЪYЫ[X›ЬќYO\Щ\ЬЪ[Ы’\ЫЫ][Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
ЩЫЭ]ЪYЫ[X›ЬќYќYJNВџJNВќ\Э
	ШH™XЫЭ™\ћH™\ЬЫњЩHЫЫ\][™ИYќ\€ЩЫЭ]Ш[››Э™\ЭЬ™HШXЪYЭ]IЛ

HO€В€ЫЫњЭЩ[^YYYќ\“ЩЫЭ]O\Щ\ЬЪ[Ы’\ЫЫ][Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
[^YYYќ\“ЩЫЭ]\YY[ЩJNВ€\ЬЩ\ќ™\]X[
[^YYYќ\“ЩЫЭ]њ™X\ЫЫ‹	ЬЭ[WЬЩ\ЬЪ[Ы‰КNВ€\ЬЩ\ќ™\]X[
[^YYYќ\“ЩЫЭ]њЭ]Kќ[
NВџJNВќ\Э
	Ь›ЫHЭЪ]Ъ[™ИЫX\њИ\ЬЩ[™Щ\€ШXЪH[™™Z™XЭИ]И[^YY™\ЬЫњЩIЛ

HO€В€ЫЫњЭШYќ\”›ЫTЭЪ]Ъ\ЬЩ[™Щ\”ЪYЫ[X›ЬќY[^YY\ЬЩ[™Щ\џO\Щ\ЬЪ[Ы’\ЫЫ][Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
Yќ\”›ЫTЭЪ]ЪXЭ]™KќYJNВ€\ЬЩ\ќ™\]X[
Yќ\”›ЫTЭЪ]ЪќљY]Щ\”›ЫK	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
Yќ\”›ЫTЭЪ]ЪњЭ]Kќ[
NВ€\ЬЩ\ќ™\]X[
Yќ\”›ЫTЭЪ]Ъ™]YЛќ[
NВ€\ЬЩ\ќ™\]X[
\ЬЩ[™Щ\”ЪYЫ[X›ЬќYќYJNВ€\ЬЩ\ќ™\]X[
[^YY\ЬЩ[™Щ\‹њ™X\ЫЫ‹	ЬЭ[WЬЩ\ЬЪ[Ы‰КNВ€\ЬЩ\ќ™\]X[
[^YY\ЬЩ[™Щ\‹њЭ]Kќ[
NВџJNВќ\Э
	ЭH™]И›ЫHШ[€\HЫ›H]ИЭЫ€]]Ьљ^™Y™XЫЭ™\ћH™\ЬЫњЩIЛ

HO€В€ЫЫњЭЩљ]™\”™XЫЭ™\ћKљ]™\”Э]_O\Щ\ЬЪ[Ы’\ЫЫ][Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
љ]™\”™XЫЭ™\ћK\YYќYJNВ€\ЬЩ\ќ™\]X[
љ]™\”™XЫЭ™\ћKњЭ]KќљY]Щ\”›ЫK	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
љ]™\”Э]KќљY]Щ\”›ЫK	Щљ]™\‰КNВ€\ЬЩ\ќ™\]X[
љ]™\”Э]KњЭ]KњЭ]\Л	ЫЫ—Эљ\	КNВ€\ЬЩ\ќ™\]X[
љ]™\”Э]KњЭ]K›™^XЭ[Ы‹	ШЫЫќ[ќYWЭљ\	КNВ€\ЬЩ\ќ™\]X[
љ]™\”Э]K™]YЛ	И™љ]™\‹Y]YИ‰КNВџJNВќ\Э
	ЬЭЪ]Ъ[™ИXШЫЭ[ќИ™Z™XЭИ[€Ы™\ЬЫњЩH]™[€Ъ[€›ЫH[™љYHQX]Ъ	Л

HO€В€ЫЫњЭЩ[^YYXШЫЭ[ќKXШЫЭ[ќ”Э]_O\Щ\ЬЪ[Ы’\ЫЫ][Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
[^YYXШЫЭ[ќK\YY[ЩJNВ€\ЬЩ\ќ™\]X[
[^YYXШЫЭ[ќKњ™X\ЫЫ‹	ЬЭ[WЬЩ\ЬЪ[Ы‰КNВ€\ЬЩ\ќ™\]X[
[^YYXШЫЭ[ќKњЭ]Kќ[
NВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќ”Э]KXЭ]™KќYJNВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќ”Э]KќљY]Щ\”›ЫK	Ь\ЬЩ[™Щ\‰КNВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќ”Э]KњЭ]Kќ[
NВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќ”Э]K™]YЛќ[
NВџJNВќ\Э
	ШHЫЫ[X[™ЭXШЩ\ЬИЫЫ\][™ИYќ\€ЩЫЭ]\И\ШШ\™Y	Л

HO€В€ЫЫњЭЫЩЩЩYЭ]ЩЫЭ]X›ЬќY[^YYЭXШЩ\ЬЯOXЫЫ[X[™Щ\ЬЪ[Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]XЭ]™K[ЩJNВ€\ЬЩ\ќ™\]X[
ЩЩЩYЭ]љ[‘›YЪ
NВ€\ЬЩ\ќ™\]X[
ЩЫЭ]X›ЬќYќYJNВ€\ЬЩ\ќ™\]X[
[^YYЭXШЩ\ЬЛЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
[^YYЭXШЩ\ЬЛњ™X\ЫЫ‹	ЬЭ[WЬЩ\ЬЪ[Ы‰КNВ€\ЬЩ\ќ™\]X[
[^YYЭXШЩ\ЬЛ]]Ф™]ћK[ЩJNВџJNВќ\Э
	ЬЩ\ЬЪ[Ы€^\ћH\љ[™ИHЭ]KXЪ[™Ъ[™ИЫЫ[X[™™\]Z\™\И™X]][ќXШ][Ы€Ъ]Э]]]Л\™]ћIЛ

HO€В€ЫЫњЭЬЩ\ЬЪ[Ы‘^\™YOXЫЫ[X[™Щ\ЬЪ[Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ы‘^\™YЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ы‘^\™Yњ™X\ЫЫ‹	ЬЩ\ЬЪ[Ы—Щ^\™Y	КNВ€\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ы‘^\™Y]]Ф™]ћK[ЩJNВ€\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ы‘^\™Y›™YYФ™X]]ќYJNВ€\ЬЩ\ќ™\]X[
Щ\ЬЪ[Ы‘^\™Y›™YYФ™XЫЭ™\ћKќYJNВџJNВќ\Э
	Ш[€[љЫ›ЭЫ€ЫЫ[X[™Э]ЫЫYH\И™XЫЫЪ[Y™Y›Ь™H[€^XЪ]Ш[YKZЩ^H™]ћIЛ

HO€В€ЫЫњЭЫЭ]ЫЫYU[љЫ›ЭЫџOXЫЫ[X[™Щ\ЬЪ[Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
Э]ЫЫYU[љЫ›ЭЫ‹ЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
Э]ЫЫYU[љЫ›ЭЫ‹њ™X\ЫЫ‹	ЫЭ]ЫЫYWЭ[љЫ›ЭЫ‰КNВ€\ЬЩ\ќ™\]X[
Э]ЫЫYU[љЫ›ЭЫ‹]]Ф™]ћK[ЩJNВ€\ЬЩ\ќ™\]X[
Э]ЫЫYU[љЫ›ЭЫ‹›™YYФ™XЫЭ™\ћKќYJNВ€\ЬЩ\ќ™\]X[
Э]ЫЫYU[љЫ›ЭЫ‹њ™]\ЩTШ[YRЩ^KќYJNВџJNВќ\Э
	ШXШЫЭ[ќЭЪ]Ъ[™И™Z™XЭИHЫЫЫ[X[™ќ][ЭЬИH™]ИXШЫЭ[ќЫЫ[X[™	Л

HO€В€ЫЫњЭЩ[^YYXШЫЭ[ќKXШЫЭ[ќђЫЫ[Z]YOXЫЫ[X[™Щ\ЬЪ[Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
[^YYXШЫЭ[ќKњ™X\ЫЫ‹	ЬЭ[WЬЩ\ЬЪ[Ы‰КNВ€\ЬЩ\ќ™\]X[
[^YYXШЫЭ[ќKЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќђЫЫ[Z]Yњ™X\ЫЫ‹	ШЫЫ[Z]Y	КNВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќђЫЫ[Z]YЫЫ[Z]YќYJNВџJNВќ\Э
	ЭHШ[YH]ИY[\Э[ЮKRЩ^H\И\ЫЫ]YћH]][ќXШ]YXШЫЭ[ќ	Л

HO€В€ЫЫњЭШXШЫЭ[ќTШЫЬK™X]]ШЫЬKXШЫЭ[ќ”ШЫЬKXШЫЭ[ќR[™TШЫЬKXШЫЭ[ќ’[™TШЫЬ_OXЫЫ[X[™Щ\ЬЪ[Ы”™\Э[К
NВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќTШЫЬK™X]]ШЫЬJNВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќTШЫЬKXШЫЭ[ќR[™TШЫЬJNВ€\ЬЩ\ќ™\]X[
XШЫЭ[ќ”ШЫЬKXШЫЭ[ќ’[™TШЫЬJNВ€\ЬЩ\ќ››Э\]X[
XШЫЭ[ќTШЫЬKXШЫЭ[ќ”ШЫЬJNВџJNВќ\Э
	ЬЭќXЭ\™YY[\Э[ЮHШЫЬ[™И]›ЪYИ[[Z]\€ЫЫ\Ъ[ЫњЙЛ

HO€В€ЫЫњЭЩ[[Z]\ђK[[Z]\ђџOXЫЫ[X[™Щ\ЬЪ[Ы”™\Э[К
NВ€\ЬЩ\ќ››Э\]X[
[[Z]\ђK[[Z]\ђЉNВџJNВќ\Э
	Ш[€[™XYKX\YY[љЫ›ЭЫ€ЫЫ[X[™ЫЫ\]\Ињ›ЫH™XЫЭ™\™YЭ]HЪ]Э]™\^IЛ\Ю[И

HO€В€ЫЫњЭШ[™XYP\YY\YY™\^PШ[ЯOX]ШZ]ЫЫ[X[™™XЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
[™XYP\YYЫЫ[Z]YќYJNВ€\ЬЩ\ќ™\]X[
[™XYP\YYњ™X\ЫЫ‹	ШЫЫ™љ\›YYШћWЬ™XЫЭ™\ћIКNВ€\ЬЩ\ќ™\]X[
[™XYP\YYњ™\Щ[ќ[ЩJNВ€\ЬЩ\ќ™\]X[
[™XYP\YYњЭ]KњЭ]\Л	ШШ[Щ[Y	КNВ€\ЬЩ\ќ™\]X[
\YY™\^PШ[Л
NВџJNВќ\Э
	Ш[€[Ъ[™ЩY™XЫЭ™\™YЭ]H\›Z]И^XЭHЫ™H^XЪ]Ш[YKZЩ^H™\^IЛ\Ю[И

HO€В€ЫЫњЭЬ™\^YY™\^PШ[ЯOX]ШZ]ЫЫ[X[™™XЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
™\^YYЫЫ[Z]YќYJNВ€\ЬЩ\ќ™\]X[
™\^YYњ™X\ЫЫ‹	ШЫЫ[Z]YШћWЬ™\^IКNВ€\ЬЩ\ќ™\]X[
™\^YYњ™\Щ[ќќYJNВ€\ЬЩ\ќ™\]X[
™\^PШ[Л›[™ЭJNВ€\ЬЩ\ќ™\]X[
™\^PШ[ЦМKXЭ[Ы‹	ШШ[Щ[ЬљYIКNВ€\ЬЩ\ќ™\]X[
™\^PШ[ЦМKљY[\Э[ЮRЩ^K	Ь™XЫЭ™\‹XШ[Щ[ZЩ^IКNВџJNВќ\Э
	ШH™]Щ\€ЫЫ™›XЭ[™ИЭ]HЭЬИ™XЫЭ™\ћHЪ]Э]™\^Z[™ИHЫЫ[X[™	Л\Ю[И

HO€В€ЫЫњЭШЪ[™ЩYЪ[™ЩY™\^PШ[ЯOX]ШZ]ЫЫ[X[™™XЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
Ъ[™ЩYЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
Ъ[™ЩYњ™X\ЫЫ‹	ЬЭ]WШЪ[™ЩY	КNВ€\ЬЩ\ќ™\]X[
Ъ[™ЩYњ™\Щ[ќ[ЩJNВ€\ЬЩ\ќ™\]X[
Ъ[™ЩYњЭ]KњЭ]\Л	ЫЫ—Эљ\	КNВ€\ЬЩ\ќ™\]X[
Ъ[™ЩY™\^PШ[Л
NВџJNВќ\Э
	ЫЬЬИЩ€™XЫЭ™\ћHXШЩ\ЬИЭЬИHЫЫ[X[™Ъ]Э]™\^IЛ\Ю[И

HO€В€ЫЫњЭЩ[љYY[љYY™\^PШ[ЯOX]ШZ]ЫЫ[X[™™XЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
[љYYЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
[љYYњ™X\ЫЫ‹	ШXШЩ\ЬЧЫЬЭ	КNВ€\ЬЩ\ќ™\]X[
[љYYњ™\Щ[ќ[ЩJNВ€\ЬЩ\ќ™\]X[
[љYY™\^PШ[Л
NВџJNВќ\Э
	Ш[€[љЫ›ЭЫ€™\^HЭ]ЫЫYHЭЬИYќ\€HЪ[™ЫH^XЪ]™\^IЛ\Ю[И

HO€В€ЫЫњЭЬ™\^U[љЫ›ЭЫ‹[љЫ›ЭЫ”™\^PШ[ЯOX]ШZ]ЫЫ[X[™™XЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
™\^U[љЫ›ЭЫ‹ЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
™\^U[љЫ›ЭЫ‹њ™X\ЫЫ‹	Ь™\^WЭ[њ™\ЫЫ™Y	КNВ€\ЬЩ\ќ™\]X[
™\^U[љЫ›ЭЫ‹њ™\Щ[ќќYJNВ€\ЬЩ\ќ™\]X[
[љЫ›ЭЫ”™\^PШ[ЛJNВџJNВќ\Э
	ШHЩ\ЬЪ[Ы€ЭЪ]Ъ\љ[™И™XЫЭ™\ћH\ШШ\™ИH™\Э[[™™]™[ќИ™\^IЛ\Ю[И

HO€В€ЫЫњЭЬЭ[TЩ\ЬЪ[Ы‹Э[T™\^PШ[ЯOX]ШZ]ЫЫ[X[™™XЫЭ™\ћT™\Э[К
NВ€\ЬЩ\ќ™\]X[
Э[TЩ\ЬЪ[Ы‹ЫЫ[Z]Y[ЩJNВ€\ЬЩ\ќ™\]X[
Э[TЩ\ЬЪ[Ы‹њ™X\ЫЫ‹	ЬЭ[WЬЩ\ЬЪ[Ы‰КNВ€\ЬЩ\ќ™\]X[
Э[TЩ\ЬЪ[Ы‹њ™\Щ[ќ[ЩJNВ€\ЬЩ\ќ™\]X[
Э[T™\^PШ[Л
NВџJNВ