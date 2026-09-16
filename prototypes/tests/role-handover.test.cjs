'use strict';
// Acceptance review of the supplied HTML, not production authorization tests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../role-split/index.html'), 'utf8');
const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x => x[1]);
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
  for(const kind of ['vehicle','driver','holder','appearance','assignment','offer']) {
    const {m,V,ride}=selected(); m.useReviewedFixture(); m.advanceTrip(ride.id);
    m.chooseRole('passenger'); m.confirmVehicle(ride.id,'DEMO 001',true,true);
    const record=m.state.records.find(x=>x.id===ride.driverId);
    if(kind==='vehicle') record.vehicleId='replacement-vehicle';
    if(kind==='driver') record.driverId='replacement-driver';
    if(kind==='holder') record.holderId='replacement-holder';
    if(kind==='appearance') record.color='different-color';
    if(kind==='assignment') ride.assignmentRevision++;
    if(kind==='offer') ride.selectedOfferId='replacement-offer';
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
