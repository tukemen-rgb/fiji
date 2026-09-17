'use strict';
// Acceptance review of the supplied HTML, not production authorization tests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {OPERATIONS, loadContract, validateContract} = require('../api-contract-check.cjs');
const {scenarios: httpScenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract} = require('../http-contract-runner.cjs');
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
  const permissiveFetch=async()=>({status:200,json:async()=>({})});
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
  assert.deepEqual(validity.expired.ride,{id:'ride-owner-1',status:'collecting',revision:2});
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
