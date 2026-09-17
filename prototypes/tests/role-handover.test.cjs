'use strict';
// Acceptance review of the supplied HTML, not production authorization tests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {OPERATIONS, loadContract, validateContract} = require('../api-contract-check.cjs');
const {FIXTURE, AUDIT_FIELDS, scenarios: httpScenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract, runRideSafetyContract, runBoardingRaceContract, runRecoveryRetryContract, runRevisionMergeContract, runAuditContract, parseRetryAfterMs} = require('../http-contract-runner.cjs');
const source = fs.readFileSync(path.join(__dirname, '../role-split/index.html'), 'utf8');
const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x => x[1]);
let auditContract;
function auditedHttpResults() { return auditContract ||= runAuditContract(); }
let rideSafetyContract;
function rideSafetyResults() { return rideSafetyContract ||= runRideSafetyContract(); }
let boardingRaceContract;
function boardingRaceResults() { return boardingRaceContract ||= runBoardingRaceContract(); }
let recoveryRetryContract;
function recoveryRetryResults() { return recoveryRetryContract ||= runRecoveryRetryContract(); }
let revisionMergeContract;
function revisionMergeResults() { return revisionMergeContract ||= runRevisionMergeContract(); }
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
function selected() {
  const s=setup(), {m}=s;
  passenger(m);
  const ride=m.requestRide({pickup:'Demo Hotel', destination:'Demo Beach'});
  m.useReviewedFixture(); m.setOnline(true);
  const offer=m.submitOffer(ride.id,{fare:'23.50',eta:'7'});
  m.chooseRole('passenger'); m.selectOffer(offer.id);
  return {...s,ride,offer};
}
test('role routing keeps passenger and driver controls separate', () => {
  const {R}=setup();
  assert.equal(R.route(null,null,'driver-home'),'role');
  assert.equal(R.route('passenger',null,'home'),'passenger-register');
  assert.equal(R.route('driver',null,'driver-home'),'register');
  assert.equal(R.route('passenger',{},'driver-home'),'home');
  assert.equal(R.route('driver',{},'offers'),'driver-home');
});
test('profile and contact/payment preferences survive an in-document role switch', () => {
  const {m}=setup(),p=passenger(m);
  m.leave(); m.chooseRole('passenger');
  assert.equal(m.state.profile.id,p.id);
  const r=m.requestRide({pickup:p.pickup,destination:'Demo Beach'});
  assert.equal(r.passengerName,'Review Guest'); assert.equal(r.language,'ja'); assert.equal(r.payment,'card');
});
test('new application cannot inject approval or enable quoting', () => {
  const {m,V}=setup(); m.chooseRole('driver');
  m.registerDriver({...application(V),status:'reviewed',approved:true,eligible:true});
  assert.equal(m.gate().eligible,false);
  assert.throws(()=>m.setOnline(true));
  assert.equal(m.driverRequests().length,0);
  assert.throws(()=>m.submitOffer('sample-city',{fare:'20',eta:'5'}));
});
test('reviewed demo account does not approve the separately submitted application', () => {
  const {m,V}=setup(); m.chooseRole('driver'); const p=m.registerDriver(application(V));
  m.useReviewedFixture(); assert.equal(m.gate().eligible,true);
  m.leave(); m.chooseRole('driver');
  assert.equal(m.state.profile.id,p.id); assert.equal(m.gate().eligible,false);
});
test('quoting is not assignment; selection preserves the agreed quote snapshot', () => {
  const {m}=setup(); passenger(m);
  const r=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  m.useReviewedFixture(); m.setOnline(true);
  const o=m.submitOffer(r.id,{fare:'23.50',eta:'7'});
  assert.equal(m.driverTrips().length,0);
  m.chooseRole('passenger'); m.selectOffer(o.id);
  assert.equal(r.quoteSnapshot.fareCents,2350); assert.equal(r.quoteSnapshot.eta,7);
  assert.throws(()=>m.selectOffer(o.id));
  m.useReviewedFixture(); assert.equal(m.driverTrips().length,1);
  assert.throws(()=>m.submitOffer(r.id,{fare:'30',eta:'5'}));
  assert.equal(r.quoteSnapshot.fareCents,2350);
});
test('ride cannot start without confirmation of the booked vehicle and driver', () => {
  const {m,ride}=selected();
  assert.throws(()=>m.confirmVehicle(ride.id,'DEMO 002',true,true));
  assert.throws(()=>m.confirmVehicle(ride.id,'DEMO 001',false,true));
  m.useReviewedFixture(); m.advanceTrip(ride.id);
  assert.equal(ride.status,'arriving'); assert.throws(()=>m.advanceTrip(ride.id));
  m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
  m.useReviewedFixture(); m.advanceTrip(ride.id); assert.equal(ride.status,'on_trip');
  m.advanceTrip(ride.id); assert.equal(ride.status,'completed');
});
test('expired quotes and revoked eligibility are rechecked at selection', () => {
  for(const reason of ['expired','revoked']) {
    const {m}=setup(); passenger(m); const r=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
    const o=m.getOffers(r.id)[0];
    if(reason==='expired') o.expiresAt=Date.now()-1;
    else m.state.records.find(x=>x.id===o.driverId).status='suspended';
    assert.throws(()=>m.selectOffer(o.id)); assert.equal(r.status,'collecting');
  }
});
test('changing a collecting route invalidates earlier quotes', () => {
  const {m}=setup(); passenger(m);
  const first=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'}), old=m.getOffers(first.id)[0];
  m.requestRide({pickup:'Demo Hotel',destination:'Demo Town'});
  assert.equal(first.status,'cancelled'); assert.throws(()=>m.selectOffer(old.id));
});
test('a later vehicle mismatch revokes an earlier confirmation', () => {
  const {m,ride}=selected();
  m.useReviewedFixture(); m.advanceTrip(ride.id);
  m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
  assert.throws(()=>m.confirmVehicle(ride.id,'DEMO 002',true,true));
  m.useReviewedFixture();
  assert.throws(()=>m.advanceTrip(ride.id),'Start must remain blocked after the new mismatch');
});

test('withdrawing either identity check requires a fresh successful confirmation', () => {
  for(const checks of [[false,true],[true,false]]) {
    const {m,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
    m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
    assert.throws(()=>m.confirmVehicle(ride.id,'DEMO 001',...checks));
    m.useReviewedFixture(); assert.equal(m.canStartTrip(ride.id),false); assert.throws(()=>m.advanceTrip(ride.id));
    m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
    m.useReviewedFixture(); assert.equal(m.canStartTrip(ride.id),true);
    m.advanceTrip(ride.id); assert.equal(ride.status,'on_trip');
  }
});
test('editing observed vehicle information clears confirmation before another lookup', () => {
  const {m,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
  m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
  m.invalidateVehicleConfirmation(ride.id);
  m.useReviewedFixture(); assert.equal(m.canStartTrip(ride.id),false); assert.throws(()=>m.advanceTrip(ride.id));
});
test('drivers and unrelated passengers cannot clear another passenger confirmation', () => {
  const {m,ride}=selected(); m.confirmVehicle(ride.id,'DEMO 001',true,true);
  m.useReviewedFixture(); assert.throws(()=>m.invalidateVehicleConfirmation(ride.id),/この操作/);
  m.chooseRole('passenger');
  const owner=m.state.profile; m.state.profile={...owner,id:'unrelated-passenger'};
  assert.throws(()=>m.invalidateVehicleConfirmation(ride.id),/この依頼/);
  m.state.profile=owner; assert.equal(ride.vehicleConfirmed,true);
});
test('an approved replacement vehicle, driver, or changed assignment needs a new confirmation', () => {
  for(const kind of ['vehicle','driver','holder','appearance','assignment','offer','schedule']) {
    const {m,V,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
    m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
    const record=m.state.records.find(x=>x.id===ride.driverId);
    if(kind==='vehicle') record.vehicleId='replacement-vehicle';
    if(kind==='driver') record.driverId='replacement-driver';
    if(kind==='holder') record.holderId='replacement-holder';
    if(kind==='appearance') record.color='different-color';
    if(kind==='assignment') ride.assignmentRevision++;
    if(kind==='offer') ride.selectedOfferId='replacement-offer';
    if(kind==='schedule') ride.pickupAt=new Date(Date.now()+3600000).toISOString();
    for(const doc of Object.values(record.documents)) doc.binding=record.holderId+'/'+record.vehicleId+'/'+record.driverId;
    assert.equal(V.assess(record).eligible,true,'test replacement retains valid current evidence');
    m.useReviewedFixture(); assert.equal(m.canStartTrip(ride.id),false,kind); assert.throws(()=>m.advanceTrip(ride.id));
  }
});
test('a boolean flag without a matching confirmation record cannot start a ride', () => {
  const {m,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
  ride.vehicleConfirmed=true;
  assert.equal(m.canStartTrip(ride.id),false); assert.throws(()=>m.advanceTrip(ride.id));
});
test('revocation after a successful check still blocks ride start', () => {
  const {m,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
  m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
  m.state.records.find(x=>x.id===ride.driverId).status='suspended';
  m.useReviewedFixture(); assert.equal(m.canStartTrip(ride.id),false); assert.throws(()=>m.advanceTrip(ride.id));
});

test('passenger cancels a collecting request and all stale quotes become unusable', () => {
  const {m}=setup(); passenger(m);
  const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'}), offer=m.getOffers(ride.id)[0];
  m.cancelRide(ride.id);
  assert.equal(ride.status,'cancelled'); assert.equal(m.getOffers(ride.id).length,0);
  assert.ok(m.state.offers.filter(o=>o.requestId===ride.id).every(o=>o.status==='expired'));
  assert.throws(()=>m.selectOffer(offer.id));
  m.useReviewedFixture(); m.setOnline(true);
  assert.ok(!m.driverRequests().some(r=>r.id===ride.id));
  assert.throws(()=>m.submitOffer(ride.id,{fare:'25',eta:'3'}));
});
test('assigned cancellation preserves the agreed price and driver history, not vehicle proof', () => {
  const {m,ride,offer}=selected(), snapshot=ride.quoteSnapshot, driverId=ride.driverId;
  m.confirmVehicle(ride.id,'DEMO 001',true,true);
  m.cancelRide(ride.id);
  assert.equal(ride.quoteSnapshot,snapshot); assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.fareCents,2350); assert.equal(snapshot.eta,7);
  assert.equal(ride.driverId,driverId); assert.equal(ride.selectedOfferId,offer.id);
  assert.equal(offer.status,'expired'); assert.equal(ride.vehicleConfirmed,false); assert.equal(ride.vehicleConfirmation,null);
  assert.equal(ride.cancelledFrom,'assigned'); assert.equal(ride.cancelledBy,'passenger');
  assert.ok(Number.isFinite(Date.parse(ride.cancelledAt)));
  assert.throws(()=>m.confirmVehicle(ride.id,'DEMO 001',true,true));
  m.useReviewedFixture(); assert.equal(m.driverTrips()[0],ride);
  assert.equal(m.state.online[driverId],false); assert.equal(m.canStartTrip(ride.id),false);
  assert.throws(()=>m.advanceTrip(ride.id));
});
test('cancellation during pickup wins over a stale ride-start action even after confirmation', () => {
  const {m,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
  m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
  m.cancelRide(ride.id); assert.equal(ride.cancelledFrom,'arriving');
  m.useReviewedFixture(); assert.equal(m.canStartTrip(ride.id),false); assert.throws(()=>m.advanceTrip(ride.id));
});
test('cancellation requires the owning passenger and a known request', () => {
  const {m,ride}=selected(); m.useReviewedFixture(); assert.throws(()=>m.cancelRide(ride.id),/この操作/);
  m.chooseRole('passenger'); const owner=m.state.profile;
  m.state.profile={...owner,id:'unrelated-passenger'}; assert.throws(()=>m.cancelRide(ride.id),/この依頼を取り消せません/);
  m.state.profile=owner; assert.throws(()=>m.cancelRide('missing-ride'),/この依頼を取り消せません/);
  assert.equal(ride.status,'assigned'); assert.equal(ride.cancelledAt,undefined);
  m.leave(); assert.throws(()=>m.cancelRide(ride.id),/この操作/);
});
test('repeated cancellation is idempotent and cannot be performed by another passenger', () => {
  const {m,ride}=selected(); m.cancelRide(ride.id); const first=JSON.stringify(ride);
  assert.equal(m.cancelRide(ride.id),ride); assert.equal(JSON.stringify(ride),first);
  m.state.profile={...m.state.profile,id:'unrelated-passenger'}; assert.throws(()=>m.cancelRide(ride.id));
  assert.equal(JSON.stringify(ride),first);
});
test('an already started or completed ride cannot be cancelled from a stale dialog', () => {
  for(const status of ['on_trip','completed']) {
    const {m,ride}=selected(); m.confirmVehicle(ride.id,'DEMO 001',true,true);
    m.useReviewedFixture(); m.advanceTrip(ride.id); m.advanceTrip(ride.id);
    if(status==='completed') m.advanceTrip(ride.id);
    m.chooseRole('passenger'); const before=JSON.stringify(ride);
    assert.throws(()=>m.cancelRide(ride.id),/乗車開始後・完了後/); assert.equal(JSON.stringify(ride),before);
  }
});
test('after cancellation a new ride can be requested and the driver explicitly resumes receiving requests', () => {
  const {m,ride,offer}=selected(); m.cancelRide(ride.id);
  const next=m.requestRide({pickup:ride.pickup,destination:ride.destination});
  assert.notEqual(next.id,ride.id); assert.equal(next.status,'collecting');
  assert.equal(m.myRequests().length,2); assert.throws(()=>m.selectOffer(offer.id));
  m.useReviewedFixture(); assert.equal(m.driverRequests().length,0);
  m.setOnline(true); assert.ok(m.driverRequests().some(r=>r.id===next.id));
  assert.throws(()=>m.submitOffer(ride.id,{fare:'20',eta:'5'}));
  m.submitOffer(next.id,{fare:'20',eta:'5'});
});
test('route replacement records a distinct cancellation reason and invalidates the old request', () => {
  const {m}=setup(); passenger(m);
  const first=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  m.requestRide({pickup:'Demo Hotel',destination:'Demo Town'});
  assert.equal(first.cancelReason,'route_changed'); assert.equal(first.cancelledFrom,'collecting');
  const at=first.cancelledAt; m.cancelRide(first.id); assert.equal(first.cancelReason,'route_changed'); assert.equal(first.cancelledAt,at);
});

test('a future pickup time is normalized and shared with an eligible driver', () => {
  const {m}=setup(); passenger(m);
  const pickupAt=new Date(Date.now()+3600000).toISOString();
  const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt});
  assert.equal(ride.pickupAt,pickupAt);
  m.useReviewedFixture(); m.setOnline(true);
  assert.equal(m.driverRequests().find(r=>r.id===ride.id).pickupAt,pickupAt);
});
test('immediate rides remain explicit and do not inherit an earlier schedule', () => {
  const {m}=setup(); passenger(m);
  const scheduled=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt:new Date(Date.now()+3600000).toISOString()});
  const immediate=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  assert.equal(immediate.pickupAt,null); assert.notEqual(immediate.id,scheduled.id);
  assert.equal(scheduled.status,'cancelled'); assert.equal(scheduled.cancelReason,'schedule_changed');
});
test('invalid or past pickup times are rejected without creating or replacing a request', () => {
  const {m}=setup(); passenger(m); const count=m.state.requests.length;
  for(const pickupAt of ['not-a-date',new Date(Date.now()-60000).toISOString()]) {
    assert.throws(()=>m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt}),/現在より後/);
    assert.equal(m.state.requests.length,count);
  }
});
test('the same scheduled request is idempotent while a changed time replaces it', () => {
  const {m}=setup(); passenger(m);
  const firstAt=new Date(Date.now()+3600000).toISOString();
  const secondAt=new Date(Date.now()+7200000).toISOString();
  const first=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt:firstAt});
  assert.equal(m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt:firstAt}),first);
  const second=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt:secondAt});
  assert.equal(first.status,'cancelled'); assert.equal(first.cancelReason,'schedule_changed');
  assert.equal(second.pickupAt,secondAt); assert.equal(second.status,'collecting');
});
test('selection snapshots the scheduled pickup alongside the agreed quote', () => {
  const {m}=setup(); passenger(m); const pickupAt=new Date(Date.now()+3600000).toISOString();
  const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt});
  m.useReviewedFixture(); m.setOnline(true); const offer=m.submitOffer(ride.id,{fare:'23.50',eta:'7'});
  m.chooseRole('passenger'); m.selectOffer(offer.id);
  assert.equal(ride.pickupAt,pickupAt); assert.equal(ride.quoteSnapshot.pickupAt,pickupAt);
  assert.ok(Object.isFrozen(ride.quoteSnapshot));
});
test('cancelling a scheduled assignment retains its pickup time for both histories', () => {
  const {m}=setup(); passenger(m); const pickupAt=new Date(Date.now()+3600000).toISOString();
  const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach',pickupAt});
  m.useReviewedFixture(); m.setOnline(true); const offer=m.submitOffer(ride.id,{fare:'23.50',eta:'7'});
  m.chooseRole('passenger'); m.selectOffer(offer.id); m.cancelRide(ride.id);
  assert.equal(m.myRequests().find(r=>r.id===ride.id).pickupAt,pickupAt);
  m.useReviewedFixture(); assert.equal(m.driverTrips().find(r=>r.id===ride.id).pickupAt,pickupAt);
});

test('offer refresh records time expiry and explains why no quote is selectable', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  m.state.offers.filter(o=>o.requestId===ride.id).forEach(o=>o.expiresAt=Date.now()-1);
  assert.equal(m.getOffers(ride.id).length,0);
  const summary=m.offerSummary(ride.id);
  assert.equal(summary.active,0); assert.ok(summary.expired>0); assert.equal(summary.unavailable,0);
  assert.ok(m.state.offers.filter(o=>o.requestId===ride.id).every(o=>o.status==='expired'&&o.statusReason==='time'));
});
test('one expired offer does not hide another current offer', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  const before=m.getOffers(ride.id); assert.ok(before.length>1);
  before[0].expiresAt=Date.now()-1;
  const after=m.getOffers(ride.id),summary=m.offerSummary(ride.id);
  assert.equal(after.length,before.length-1); assert.equal(summary.active,after.length); assert.equal(summary.expired,1);
  assert.ok(!after.some(o=>o.id===before[0].id));
});
test('an eligible driver can re-quote after expiry without reviving the old offer', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  m.useReviewedFixture(); m.setOnline(true); const old=m.submitOffer(ride.id,{fare:'23.50',eta:'7'});
  old.expiresAt=Date.now()-1; m.driverRequests();
  assert.equal(old.status,'expired');
  const fresh=m.submitOffer(ride.id,{fare:'24.00',eta:'6'});
  assert.notEqual(fresh.id,old.id); assert.equal(old.status,'expired'); assert.equal(fresh.status,'active');
  m.chooseRole('passenger'); const visible=m.getOffers(ride.id);
  assert.ok(visible.some(o=>o.id===fresh.id)); assert.ok(!visible.some(o=>o.id===old.id));
  m.selectOffer(fresh.id); assert.equal(ride.quoteSnapshot.fareCents,2400);
});
test('an offer made unavailable by eligibility cannot silently revive', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  const offer=m.getOffers(ride.id)[0],record=m.state.records.find(r=>r.id===offer.driverId);
  record.status='suspended'; assert.ok(!m.getOffers(ride.id).some(o=>o.id===offer.id));
  assert.equal(offer.status,'unavailable'); assert.equal(offer.statusReason,'eligibility');
  record.status='reviewed'; assert.ok(!m.getOffers(ride.id).some(o=>o.id===offer.id));
  assert.throws(()=>m.selectOffer(offer.id));
});
test('offer-state guidance is limited to the owning passenger', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'}),owner=m.state.profile;
  m.useReviewedFixture(); assert.throws(()=>m.offerSummary(ride.id),/この操作/);
  m.chooseRole('passenger'); m.state.profile={...owner,id:'unrelated-passenger'};
  assert.throws(()=>m.offerSummary(ride.id),/閲覧できません/);
  m.state.profile=owner; assert.throws(()=>m.offerSummary('missing-ride'),/閲覧できません/);
});

test('offer selection advances the request revision and rejects a stale repeat', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'}),offer=m.getOffers(ride.id)[0];
  assert.equal(ride.revision,1); m.selectOffer(offer.id,1);
  assert.equal(ride.status,'assigned'); assert.equal(ride.revision,2);
  assert.throws(()=>m.selectOffer(offer.id,1),/別の画面で更新/);
});
test('cancellation wins an accept/cancel race and stale selection changes nothing', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'}),offer=m.getOffers(ride.id)[0];
  m.cancelRide(ride.id,1); const afterCancel=JSON.stringify(ride);
  assert.equal(ride.revision,2); assert.throws(()=>m.selectOffer(offer.id,1),/別の画面で更新/);
  assert.equal(JSON.stringify(ride),afterCancel);
});
test('selection wins an accept/cancel race and stale cancellation must refresh first', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'}),offer=m.getOffers(ride.id)[0];
  m.selectOffer(offer.id,1); const afterSelect=JSON.stringify(ride);
  assert.throws(()=>m.cancelRide(ride.id,1),/別の画面で更新/); assert.equal(JSON.stringify(ride),afterSelect);
  m.cancelRide(ride.id,2); assert.equal(ride.status,'cancelled'); assert.equal(ride.revision,3);
});
test('a cancellation retry is idempotent even with the original expected revision', () => {
  const {m}=setup(); passenger(m); const ride=m.requestRide({pickup:'Demo Hotel',destination:'Demo Beach'});
  m.cancelRide(ride.id,1); const once=JSON.stringify(ride);
  assert.equal(m.cancelRide(ride.id,1),ride); assert.equal(JSON.stringify(ride),once); assert.equal(ride.revision,2);
});
test('a stale driver transition cannot skip a newer trip state', () => {
  const {m,ride}=selected(); assert.equal(ride.revision,2);
  m.useReviewedFixture(); m.advanceTrip(ride.id,2); assert.equal(ride.status,'arriving'); assert.equal(ride.revision,3);
  assert.throws(()=>m.advanceTrip(ride.id,2),/別の画面で更新/); assert.equal(ride.status,'arriving');
});

test('machine-readable API contract passes the executable acceptance checker', () => {
  assert.deepEqual(validateContract(loadContract()),[]);
});
test('API contract enumerates every passenger and driver operation exactly once', () => {
  const spec=loadContract(),ids=[];
  for(const [method,route,id] of OPERATIONS){assert.equal(spec.paths[route][method].operationId,id);ids.push(id);}
  assert.equal(new Set(ids).size,OPERATIONS.length);
});
test('all state-changing API commands require an idempotency key', () => {
  const spec=loadContract();
  for(const [method,route,id] of OPERATIONS.filter(([method])=>method==='post')){
    const pathItem=spec.paths[route],parameters=[...(pathItem.parameters||[]),...(pathItem[method].parameters||[])];
    const resolved=parameters.map(p=>p.$ref?spec.components.parameters[p.$ref.split('/').at(-1)]:p);
    assert.ok(resolved.some(p=>p.name==='Idempotency-Key'&&p.in==='header'&&p.required),id);
  }
});
test('API inputs never accept caller-controlled actor or approval fields', () => {
  const text=JSON.stringify(loadContract().components.schemas);
  for(const field of ['passengerId','driverId','reviewerId','approved','eligible','reviewStatus']) assert.ok(!text.includes(`\"${field}\"`),field);
});
test('API contract fixes money, revision and scheduled pickup representations', () => {
  const schemas=loadContract().components.schemas;
  assert.deepEqual(schemas.Revision,{type:'integer',minimum:1});
  assert.equal(schemas.CreateOfferInput.properties.fareCents.type,'integer');
  assert.equal(schemas.CreateRideRequestInput.properties.pickupAt.format,'date-time');
  assert.equal(schemas.CreateRideRequestInput.properties.pickupTimeZone.const,'Pacific/Fiji');
  assert.equal(schemas.SelectedQuote.readOnly,true);
});
test('API checker fails closed when safety requirements are removed', () => {
  const noKey=structuredClone(loadContract());
  noKey.paths['/v1/offers/{offerId}/select'].post.parameters=noKey.paths['/v1/offers/{offerId}/select'].post.parameters.filter(p=>!p.$ref.endsWith('/IdempotencyKey'));
  assert.ok(validateContract(noKey).some(message=>message.includes('selectRideOffer requires Idempotency-Key')));
  const injected=structuredClone(loadContract());
  injected.components.schemas.CreateOfferInput.properties.driverId={type:'string'};
  assert.ok(validateContract(injected).some(message=>message.includes('server-owned driverId')));
  const missingVehicleError=structuredClone(loadContract());
  missingVehicleError.components.schemas.Error.properties.code.enum=missingVehicleError.components.schemas.Error.properties.code.enum.filter(code=>code!=='vehicle_confirmation_required');
  assert.ok(validateContract(missingVehicleError).some(message=>message.includes('Error code enum requires vehicle_confirmation_required')));
  const leakedRideState=structuredClone(loadContract());
  leakedRideState.components.schemas.RideStateView.properties.assignedDriverId={type:'string'};
  assert.ok(validateContract(leakedRideState).some(message=>message.includes('RideStateView must not expose private field assignedDriverId')));
  const noConditional=structuredClone(loadContract());
  delete noConditional.paths['/v1/rides/{requestId}'].get.responses['304'];
  assert.ok(validateContract(noConditional).some(message=>message.includes('getRideState must document bodyless 304')));
  const sharedCache=structuredClone(loadContract());
  sharedCache.components.headers.PrivateNoCache.schema.const='public, max-age=60';
  assert.ok(validateContract(sharedCache).some(message=>message.includes('ride state cache control must be private, no-cache')));
  const noRateLimit=structuredClone(loadContract());
  delete noRateLimit.paths['/v1/rides/{requestId}'].get.responses['429'];
  assert.ok(validateContract(noRateLimit).some(message=>message.includes('getRideState must document 429')));
  const noRetryAfter=structuredClone(loadContract());
  delete noRetryAfter.components.responses.ServiceUnavailable.headers['Retry-After'];
  assert.ok(validateContract(noRetryAfter).some(message=>message.includes('getRideState 503 requires Retry-After header')));
});
test('HTTP contract runner enforces role, ownership, eligibility and safe errors over loopback', async () => {
  const results=await runMockContract();
  assert.equal(results.length,14);
  assert.equal(results.filter(r=>r.status===404).length,5);
  assert.equal(results.filter(r=>r.status===403).length,3);
  assert.equal(results.filter(r=>r.status===401).length,1);
  assert.equal(results.filter(r=>r.status===422).length,2);
  assert.equal(results.filter(r=>r.status<300).length,3);
});
test('HTTP contract scenarios conceal foreign resources instead of leaking ownership', () => {
  const hidden=httpScenarios().filter(s=>s.concealed);
  assert.deepEqual(hidden.map(s=>s.expected[0]),[404,404,404,404,404]);
  assert.ok(hidden.every(s=>s.expected[1]==='resource_not_found'));
});
test('HTTP contract runner fails when a permissive transport returns success for every request', async () => {
  const permissiveFetch=async()=>({status:200,text:async()=>'{}',headers:{get:()=>null}});
  await assert.rejects(runHttpContract('http://mock.invalid',undefined,permissiveFetch),/no session cannot read offers/);
});
test('concurrent offer selection and cancellation produce exactly one HTTP winner', async () => {
  const race=await runConcurrencyContract();
  assert.deepEqual(race.pair.map(result=>result.status).sort((a,b)=>a-b),[200,409]);
  assert.equal(race.loser.body.code,'stale_revision');
  assert.equal(race.loser.body.revision,3);
  assert.equal(race.state.revision,3);
  assert.equal(race.state.status,race.winner.body.status);
});
test('exact Idempotency-Key replay returns the frozen first success without another change', async () => {
  const race=await runConcurrencyContract();
  assert.equal(race.replay.status,200);
  assert.deepEqual(race.replay.body,race.winner.body);
  assert.equal(race.state.revision,3);
  assert.equal(race.storedKeys,2);
});
test('reusing an Idempotency-Key with changed content is rejected', async () => {
  const race=await runConcurrencyContract();
  assert.equal(race.conflict.status,409);
  assert.equal(race.conflict.body.code,'idempotency_conflict');
  assert.match(race.conflict.body.requestId,/^trace-mock-/);
});
test('server clock rejects an expired offer without changing the ride', async () => {
  const validity=await runOfferValidityContract();
  assert.equal(validity.expired.result.status,409);
  assert.equal(validity.expired.result.body.code,'offer_expired');
  assert.equal(validity.expired.result.body.revision,2);
  assert.equal(validity.expired.offer.status,'expired');
  assert.deepEqual(validity.expired.ride,{id:'ride-owner-1',status:'collecting',revision:2,assignedDriverId:null,vehicleConfirmation:null});
});
test('offer is expired at the exact server-side expiry boundary', async () => {
  const validity=await runOfferValidityContract();
  assert.equal(validity.boundary.result.body.code,'offer_expired');
  assert.equal(validity.boundary.offer.statusReason,'time');
  assert.equal(validity.valid.result.status,200,'one millisecond before expiry remains selectable');
  assert.equal(validity.valid.ride.selectedQuote.selectedAt,'2026-09-17T03:00:00.000Z');
});
test('selection rechecks current driver eligibility and invalidates the offer', async () => {
  const validity=await runOfferValidityContract();
  assert.equal(validity.ineligible.result.status,409);
  assert.equal(validity.ineligible.result.body.code,'driver_unavailable');
  assert.equal(validity.ineligible.offer.status,'unavailable');
  assert.equal(validity.ineligible.offer.statusReason,'eligibility');
  assert.equal(validity.ineligible.ride.revision,2);
});
test('client cannot override the trusted offer-selection clock', async () => {
  const validity=await runOfferValidityContract();
  assert.equal(validity.clientClock.result.status,422);
  assert.equal(validity.clientClock.result.body.code,'invalid_request');
  assert.equal(validity.clientClock.ride.status,'collecting');
  assert.equal(validity.clientClock.offer.status,'active');
});
test('successful offer selection records a minimal server-timestamped audit event', async () => {
  const {validity}=await auditedHttpResults(),event=validity.valid.auditEvents[0];
  assert.deepEqual(event,{
    id:'audit-1',type:'offer.selection',outcome:'committed',reason:null,
    actorRole:'passenger',actorRef:'passenger-owner',requestId:FIXTURE.requestId,
    offerId:FIXTURE.offerId,fromRevision:2,toRevision:3,occurredAt:'2026-09-17T03:00:00.000Z'
  });
});
test('expiry and eligibility selection rejections are audited without advancing the ride', async () => {
  const {validity}=await auditedHttpResults();
  for(const [result,reason] of [[validity.expired,'offer_expired'],[validity.ineligible,'driver_unavailable']]){
    assert.equal(result.auditEvents.length,1);
    assert.equal(result.auditEvents[0].outcome,'rejected');
    assert.equal(result.auditEvents[0].reason,reason);
    assert.equal(result.auditEvents[0].fromRevision,2);
    assert.equal(result.auditEvents[0].toRevision,2);
    assert.equal(result.ride.revision,2);
  }
});
test('concurrent commands record one commit and one stale rejection without replay duplication', async () => {
  const {race}=await auditedHttpResults();
  assert.equal(race.auditEvents.length,2);
  assert.equal(race.auditEvents.filter(event=>event.outcome==='committed').length,1);
  assert.equal(race.auditEvents.filter(event=>event.reason==='stale_revision').length,1);
  assert.deepEqual(race.auditEvents.map(event=>event.id),['audit-1','audit-2']);
});
test('audit events use only the allowlist and exclude credentials and private request inputs', async () => {
  const {events}=await auditedHttpResults();
  for(const event of events) assert.deepEqual(Object.keys(event),AUDIT_FIELDS);
  const encoded=JSON.stringify(events).toLowerCase();
  for(const forbidden of [...Object.values(FIXTURE.tokens),'idempotency-key','phone','email','observedplate','permit','+679','@']){
    assert.ok(!encoded.includes(forbidden.toLowerCase()),forbidden);
  }
});
test('assigned driver transition advances one revision and exact replay changes nothing', async () => {
  const result=await rideSafetyResults();
  assert.deepEqual(result.arriving,{status:200,body:{id:FIXTURE.requestId,status:'arriving',revision:3}});
  assert.deepEqual(result.arrivingReplay,result.arriving);
  assert.equal(result.auditEvents.filter(event=>event.type==='ride.transition'&&event.fromRevision===2).length,1);
});
test('vehicle confirmation normalizes the booked plate and is idempotent', async () => {
  const result=await rideSafetyResults();
  assert.equal(result.confirmation.status,201);
  assert.deepEqual(result.confirmation.body,{requestId:FIXTURE.requestId,assignmentRevision:3,confirmedAt:'2026-09-17T03:00:00.000Z'});
  assert.deepEqual(result.confirmationReplay,result.confirmation);
  assert.equal(result.auditEvents.filter(event=>event.type==='vehicle.confirmation'&&event.outcome==='committed').length,2,'initial and fresh reconfirmation only');
});
test('a later vehicle mismatch clears proof and advances the revision once', async () => {
  const result=await rideSafetyResults(),event=result.auditEvents.find(item=>item.reason==='vehicle_mismatch');
  assert.equal(result.mismatch.status,409);
  assert.equal(result.mismatch.body.code,'vehicle_mismatch');
  assert.equal(result.mismatch.body.revision,5);
  assert.deepEqual([event.fromRevision,event.toRevision],[4,5]);
});
test('ride start needs current vehicle proof and current driver eligibility', async () => {
  const result=await rideSafetyResults();
  assert.equal(result.startWithoutConfirmation.body.code,'vehicle_confirmation_required');
  assert.equal(result.startWithoutConfirmation.body.revision,5);
  assert.equal(result.revokedDriver.body.code,'driver_unavailable');
  assert.equal(result.revokedDriver.body.revision,6);
  assert.deepEqual([result.started.body.status,result.started.body.revision],['on_trip',7]);
  assert.deepEqual([result.completed.body.status,result.completed.body.revision],['completed',8]);
  assert.equal(result.state.status,'completed');
  assert.equal(result.state.revision,8);
});
test('ride safety audit records decisions without observed plate or replay duplicates', async () => {
  const result=await rideSafetyResults();
  assert.equal(result.auditEvents.length,8);
  assert.deepEqual(result.auditEvents.map(event=>event.id),['audit-1','audit-2','audit-3','audit-4','audit-5','audit-6','audit-7','audit-8']);
  assert.ok(result.auditEvents.every(event=>Object.keys(event).join('|')===AUDIT_FIELDS.join('|')));
  const encoded=JSON.stringify(result.auditEvents).toLowerCase();
  assert.ok(!encoded.includes('demo 001'));
  assert.ok(!encoded.includes('demo 999'));
  assert.ok(!encoded.includes('observedplate'));
});
test('boarding race commits exactly one of cancellation and ride start', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.deepEqual([race.cancel.status,race.start.status].sort((a,b)=>a-b),[200,409]);
    assert.equal(race.state.revision,7);
    assert.equal(race.auditEvents.filter(event=>event.outcome==='committed').length,1);
    assert.equal(race.auditEvents.filter(event=>event.reason==='stale_revision').length,1);
  }
});
test('cancellation-first prevents stale ride start and clears vehicle proof', async () => {
  const {cancelFirst}=await boardingRaceResults();
  assert.equal(cancelFirst.cancel.status,200);
  assert.equal(cancelFirst.state.status,'cancelled');
  assert.equal(cancelFirst.state.vehicleConfirmation,null);
  assert.equal(cancelFirst.start.body.code,'stale_revision');
  assert.equal(cancelFirst.start.body.revision,7);
});
test('ride-start-first prevents stale cancellation after boarding begins', async () => {
  const {startFirst}=await boardingRaceResults();
  assert.equal(startFirst.start.status,200);
  assert.equal(startFirst.state.status,'on_trip');
  assert.equal(startFirst.cancel.body.code,'stale_revision');
  assert.equal(startFirst.cancel.body.revision,7);
});
test('boarding-race winner replay is stable without duplicate state or audit', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    const winnerResult=race.winner==='cancel'?race.cancel:race.start;
    assert.deepEqual(race.replay,winnerResult);
    assert.equal(race.state.revision,7);
    assert.equal(race.auditEvents.length,2);
    assert.deepEqual(race.auditEvents.map(event=>event.id),['audit-1','audit-2']);
  }
});
test('cancellation-race participants recover role-shaped cancelled state', async () => {
  const {recovery}= (await boardingRaceResults()).cancelFirst;
  assert.deepEqual(recovery.passenger,{status:200,body:{
    id:FIXTURE.requestId,status:'cancelled',revision:7,viewerRole:'passenger',
    nextAction:'show_cancelled_history',updatedAt:'2026-09-17T03:00:00.000Z'
  },headers:{etag:recovery.passenger.headers.etag,cacheControl:'private, no-cache',vary:'Authorization'}});
  assert.deepEqual(recovery.driver,{status:200,body:{
    id:FIXTURE.requestId,status:'cancelled',revision:7,viewerRole:'driver',
    nextAction:'show_cancelled_trip',updatedAt:'2026-09-17T03:00:00.000Z'
  },headers:{etag:recovery.driver.headers.etag,cacheControl:'private, no-cache',vary:'Authorization'}});
});
test('ride-start-race participants recover role-shaped on-trip state', async () => {
  const {recovery}= (await boardingRaceResults()).startFirst;
  assert.deepEqual([recovery.passenger.body.status,recovery.passenger.body.revision,recovery.passenger.body.nextAction],['on_trip',7,'show_on_trip']);
  assert.deepEqual([recovery.driver.body.status,recovery.driver.body.revision,recovery.driver.body.nextAction],['on_trip',7,'continue_trip']);
  assert.deepEqual([recovery.passenger.body.viewerRole,recovery.driver.body.viewerRole],['passenger','driver']);
});
test('recovery read conceals the ride from unrelated passengers and drivers', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    for(const result of [race.recovery.otherPassenger,race.recovery.otherDriver]){
      assert.equal(result.status,404);
      assert.equal(result.body.code,'resource_not_found');
      assert.match(result.body.requestId,/^trace-mock-/);
      assert.ok(!JSON.stringify(result.body).includes('passenger-owner'));
      assert.ok(!JSON.stringify(result.body).includes('driver-assigned'));
    }
  }
});
test('recovery response exposes only the documented safe field allowlist', async () => {
  const safeFields=['id','status','revision','viewerRole','nextAction','updatedAt'];
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.deepEqual(Object.keys(race.recovery.passenger.body),safeFields);
    assert.deepEqual(Object.keys(race.recovery.driver.body),safeFields);
    const encoded=JSON.stringify([race.recovery.passenger.body,race.recovery.driver.body]).toLowerCase();
    for(const forbidden of ['assigneddriverid','vehicleconfirmation','selectedofferid','plate','phone','permit']) assert.ok(!encoded.includes(forbidden),forbidden);
  }
});
test('recovery reads do not advance revision, consume idempotency keys or add audit events', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.equal(race.state.revision,7);
    assert.equal(race.storedKeys,2);
    assert.equal(race.auditEvents.length,2);
    assert.deepEqual(race.auditEvents.map(event=>event.id),['audit-1','audit-2']);
  }
});
test('ride-state responses use private role-scoped validators', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.match(race.recovery.passenger.headers.etag,/^"[A-Za-z0-9_-]{24}"$/);
    assert.match(race.recovery.driver.headers.etag,/^"[A-Za-z0-9_-]{24}"$/);
    assert.notEqual(race.recovery.passenger.headers.etag,race.recovery.driver.headers.etag);
    for(const result of [race.recovery.passenger,race.recovery.driver]){
      assert.equal(result.headers.cacheControl,'private, no-cache');
      assert.equal(result.headers.vary,'Authorization');
    }
  }
});
test('matching strong and weak validators return bodyless 304', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.deepEqual([race.recovery.passengerNotModified.status,race.recovery.passengerNotModified.body],[304,null]);
    assert.deepEqual([race.recovery.driverNotModified.status,race.recovery.driverNotModified.body],[304,null]);
    assert.equal(race.recovery.passengerNotModified.headers.etag,race.recovery.passenger.headers.etag);
    assert.equal(race.recovery.driverNotModified.headers.etag,race.recovery.driver.headers.etag);
  }
});
test('a stale validator returns the current representation and replacement ETag', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.equal(race.recovery.stalePassenger.status,200);
    assert.equal(race.recovery.stalePassenger.body.revision,7);
    assert.equal(race.recovery.stalePassenger.body.status,race.state.status);
    assert.equal(race.recovery.stalePassenger.headers.etag,race.recovery.passenger.headers.etag);
  }
});
test('a passenger validator cannot suppress the driver representation', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.equal(race.recovery.crossRoleValidator.status,200);
    assert.equal(race.recovery.crossRoleValidator.body.viewerRole,'driver');
    assert.equal(race.recovery.crossRoleValidator.headers.etag,race.recovery.driver.headers.etag);
  }
});
test('wildcard revalidation occurs only after participant authorization', async () => {
  const races=await boardingRaceResults();
  for(const race of [races.cancelFirst,races.startFirst]){
    assert.deepEqual([race.recovery.wildcardPassenger.status,race.recovery.wildcardPassenger.body],[304,null]);
    assert.equal(race.recovery.wildcardOther.status,404);
    assert.equal(race.recovery.wildcardOther.body.code,'resource_not_found');
    assert.equal(race.recovery.wildcardOther.headers.etag,null);
  }
});
test('429 recovery honors Retry-After before succeeding', async () => {
  const {rateLimited}=await recoveryRetryResults();
  assert.deepEqual(rateLimited.delays,[3000]);
  assert.deepEqual(rateLimited.result.attempts.map(attempt=>attempt.status),[429,200]);
  assert.equal(rateLimited.result.stopped,'success');
  assert.equal(rateLimited.result.result.body.revision,7);
});
test('503 recovery uses capped exponential backoff when Retry-After is absent', async () => {
  const {unavailable}=await recoveryRetryResults();
  assert.deepEqual(unavailable.delays,[1000,2000]);
  assert.deepEqual(unavailable.result.attempts.map(attempt=>attempt.status),[503,503,200]);
  assert.equal(unavailable.result.stopped,'success');
});
test('network failure retries with backoff and then recovers', async () => {
  const {network}=await recoveryRetryResults();
  assert.equal(network.calls,2);
  assert.deepEqual(network.delays,[1000]);
  assert.deepEqual(network.result.attempts.map(attempt=>attempt.status),[0,200]);
  assert.equal(network.result.stopped,'success');
});
test('retry delays and attempts are bounded during a sustained outage', async () => {
  const {exhausted}=await recoveryRetryResults();
  assert.deepEqual(exhausted.delays,[60000,60000,60000]);
  assert.equal(exhausted.result.attempts.length,4);
  assert.equal(exhausted.result.stopped,'exhausted');
  assert.ok(exhausted.result.attempts.every(attempt=>attempt.status===503));
});
test('access denial stops recovery without retrying or revealing the ride', async () => {
  const {accessDenied}=await recoveryRetryResults();
  assert.deepEqual(accessDenied.delays,[]);
  assert.equal(accessDenied.result.attempts.length,1);
  assert.equal(accessDenied.result.stopped,'access');
  assert.equal(accessDenied.result.result.status,404);
  assert.equal(accessDenied.result.result.body.code,'resource_not_found');
});
test('a hidden screen stops recovery before any network request', async () => {
  const {hidden}=await recoveryRetryResults();
  assert.equal(hidden.calls,0);
  assert.deepEqual(hidden.result.attempts,[]);
  assert.equal(hidden.result.stopped,'hidden');
});
test('Retry-After accepts an HTTP date but rejects invalid input and clamps extremes', () => {
  const now=Date.parse('2026-09-17T03:00:00Z');
  assert.equal(parseRetryAfterMs('Thu, 17 Sep 2026 03:00:05 GMT',now),5000);
  assert.equal(parseRetryAfterMs('invalid',now),null);
  assert.equal(parseRetryAfterMs('0',now),1000);
  assert.equal(parseRetryAfterMs('999',now),60000);
});
test('a delayed recovery response cannot roll back a newer notification', () => {
  const {newerNotification,delayedRecovery}=revisionMergeResults();
  assert.equal(newerNotification.applied,true);
  assert.equal(newerNotification.state.revision,8);
  assert.equal(newerNotification.state.status,'cancelled');
  assert.equal(delayedRecovery.applied,false);
  assert.equal(delayedRecovery.reason,'stale');
  assert.equal(delayedRecovery.state.revision,8);
  assert.equal(delayedRecovery.state.status,'cancelled');
});
test('a delayed notification cannot roll back a newer recovery response', () => {
  const {newerRecovery,delayedNotification}=revisionMergeResults();
  assert.equal(newerRecovery.state.revision,9);
  assert.equal(newerRecovery.state.status,'on_trip');
  assert.equal(delayedNotification.applied,false);
  assert.equal(delayedNotification.reason,'stale');
  assert.equal(delayedNotification.state.status,'on_trip');
});
test('an exact duplicate revision is ignored without requesting recovery', () => {
  const {duplicate}=revisionMergeResults();
  assert.equal(duplicate.applied,false);
  assert.equal(duplicate.reason,'duplicate');
  assert.equal(duplicate.needsRecovery,false);
  assert.equal(duplicate.state.revision,8);
});
test('conflicting content at the same revision is not applied and requests recovery', () => {
  const {conflicting}=revisionMergeResults();
  assert.equal(conflicting.applied,false);
  assert.equal(conflicting.reason,'same_revision_conflict');
  assert.equal(conflicting.needsRecovery,true);
  assert.equal(conflicting.state.status,'cancelled');
});
test('a notification revision gap waits for an authoritative recovery snapshot', () => {
  const {gap,gapRecovery}=revisionMergeResults();
  assert.equal(gap.applied,false);
  assert.equal(gap.reason,'revision_gap');
  assert.equal(gap.needsRecovery,true);
  assert.equal(gap.state.revision,7);
  assert.equal(gapRecovery.applied,true);
  assert.equal(gapRecovery.state.revision,10);
  assert.equal(gapRecovery.state.status,'completed');
});
test('cross-ride, cross-role and notification-only baselines never enter the current view', () => {
  const {wrongRide,wrongRole,missingBaseline,recoveredBaseline}=revisionMergeResults();
  for(const result of [wrongRide,wrongRole]){
    assert.equal(result.applied,false);
    assert.equal(result.reason,'scope_mismatch');
    assert.equal(result.needsRecovery,false);
    assert.equal(result.state.revision,7);
  }
  assert.equal(missingBaseline.reason,'missing_baseline');
  assert.equal(missingBaseline.needsRecovery,true);
  assert.equal(missingBaseline.state,null);
  assert.equal(recoveredBaseline.applied,true);
  assert.equal(recoveredBaseline.reason,'baseline');
  assert.equal(recoveredBaseline.state.revision,8);
});
