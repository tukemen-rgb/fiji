'use strict';
// Acceptance review of the supplied HTML, not production authorization tests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {OPERATIONS, loadContract, validateContract} = require('../api-contract-check.cjs');
const {FIXTURE, AUDIT_FIELDS, scenarios: httpScenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract, runRideSafetyContract, runBoardingRaceContract, runCurrentRideDiscoveryContract, runRecoveryRetryContract, runRevisionMergeContract, runNotificationHintContract, runSessionIsolationContract, runCommandSessionContract, runCommandRecoveryContract, runAuditContract, parseRetryAfterMs} = require('../http-contract-runner.cjs');
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
test('command feedback uses separate passenger and driver wording', () => {
  const {R}=setup();
  const passenger=R.commandFeedback('passenger','pending');
  const driver=R.commandFeedback('driver','pending');
  assert.match(passenger.title,/依頼/);
  assert.match(driver.title,/運行/);
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
  assert.match(expired.title,/再ログイン/);
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
  assert.match(restored.feedback.title,/確認できません/);
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
  assert.match(restored.feedback.message,/最新状態/);
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
  assert.equal(result.reason,'explicit_refresh_required');assert.equal(calls,2);assert.equal(state.needsRefresh,true);assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.match(state.feedback.title,/依頼/);assert.match(state.feedback.message,/最新状態を確認する/);
});
test('driver UI uses operation wording when notification recovery remains behind', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return {status:200,body:currentRideView('driver',{revision:8,status:'assigned'})};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:10});const state=notifications.snapshot();
  assert.equal(calls,2);assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.match(state.feedback.title,/運行/);assert.equal(state.pendingRevision,10);
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
  assert.equal(failed.reason,'connectivity_required');assert.equal(calls,3);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.equal(state.pendingRevision,9);assert.match(state.feedback.title,/依頼/);assert.match(state.feedback.message,/通信/);
});
test('a 503 explicit refresh keeps the driver operation locked without retrying', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:503}:{status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:10});const failed=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(failed.reason,'connectivity_required');assert.equal(calls,3);assert.equal(state.commandsLocked,true);assert.equal(state.pendingRevision,10);assert.match(state.feedback.title,/運行/);
});
test('401 and 403 explicit refreshes clear cached state and require reauthentication', async () => {
  for(const status of [401,403]){
    const {R}=setup();let calls=0;
    const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('home','passenger');
    const current=currentRideView('passenger',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'passenger',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status}:{status:304};}});
    await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});const failed=await notifications.refresh(),state=notifications.snapshot();
    assert.equal(failed.reason,'reauthentication_required');assert.equal(calls,3);assert.equal(state.hasRide,false);assert.equal(state.guidance,'reauth');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reauth');assert.equal(state.pendingRevision,null);assert.match(state.feedback.message,/依頼/);
  }
});
test('a 404 explicit refresh clears the stale ride and returns to an unlocked empty state', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),notifications=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:404}:{status:304};}});
  await notifications.handle({type:'ride.changed',rideId:current.id,revision:9});const empty=await notifications.refresh(),state=notifications.snapshot();
  assert.equal(empty.reason,'ride_not_found');assert.equal(calls,3);assert.equal(state.hasRide,false);assert.equal(state.guidance,'empty');assert.equal(state.commandsLocked,false);assert.equal(state.action,null);assert.equal(state.pendingRevision,null);assert.match(state.feedback.title,/運行/);
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
  assert.equal(result.processed,true);assert.equal(calls,2);assert.equal(view.outcome,'unresolved');assert.equal(view.action,'refresh');assert.equal(view.disableCommands,true);assert.match(view.title,/依頼/);assert.match(view.message,/最新状態を確認する/);
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
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});await flow.trigger('refresh');assert.equal(commandUi.snapshot().action,'reauth');assert.match(commandUi.snapshot().message,/運行/);
  const first=flow.trigger('reauth');await Promise.resolve();const duplicate=await flow.trigger('reauth');assert.equal(duplicate.reason,'action_in_progress');assert.equal(reauthCalls,1);release({requested:true});await first;assert.equal(reauthCalls,1);assert.equal(commandUi.snapshot().action,'reauth');
});
test('a not-found explicit refresh updates the shared driver banner to an unlocked empty state', async () => {
  const {R}=setup();let calls=0;
  const fixture=roleLifecycleFixture(R,{readCurrentRide:async()=>({status:204})}),boundary=R.createRoleRoutingBoundary({lifecycle:fixture.lifecycle});await boundary.navigate('driver-home','driver');
  const current=currentRideView('driver',{revision:8,status:'assigned'}),recovery=R.createRoleNotificationRecovery({lifecycle:fixture.lifecycle,role:'driver',currentRide:current,recover:async()=>{calls+=1;return calls===3?{status:404}:{status:304};}}),commandUi=R.createCommandUiController('driver'),flow=R.createNotificationFeedbackFlow({role:'driver',recovery,commandUi});
  await flow.handle({type:'ride.changed',rideId:current.id,revision:9});const empty=await flow.trigger('refresh'),view=commandUi.snapshot();
  assert.equal(empty.processed,true);assert.equal(calls,3);assert.equal(view.outcome,'confirmed');assert.equal(view.disableCommands,false);assert.equal(view.action,null);assert.match(view.title,/運行/);assert.match(view.message,/運転手ホーム/);
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
  assert.equal(subscriptions,1);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reconnect');assert.match(state.feedback.title,/依頼/);assert.equal(renders.at(-1).action,'reconnect');
  await Promise.resolve();await bridge.idle();assert.equal(subscriptions,1);
});
test('connected driver subscription disconnects into a role-specific lock without automatic retry', async () => {
  const {R}=setup();let subscriptions=0,disconnect,deliver,unsubscribes=0,reads=0;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'driver',subscribe:async input=>{subscriptions+=1;disconnect=input.onDisconnect;deliver=input.onHint;return()=>{unsubscribes+=1;};},onHint:async()=>{reads+=1;return {processed:true};},verifyLatest:async()=>({verified:true})});
  bridge.attach();await bridge.idle();assert.equal(bridge.snapshot().commandsLocked,false);disconnect();const state=bridge.snapshot();
  assert.equal(subscriptions,1);assert.equal(unsubscribes,1);assert.equal(state.guidance,'connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reconnect');assert.match(state.feedback.title,/運行/);
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
    assert.equal(reconnect.reason,'connectivity_required');assert.equal(state.connected,true);assert.equal(state.guidance,'verification_connectivity');assert.equal(state.commandsLocked,true);assert.equal(state.action,'refresh');assert.match(state.feedback.title,/依頼/);assert.equal(verifications,1);
    const refreshing=bridge.refresh(),duplicate=await bridge.refresh();assert.equal(duplicate.reason,'action_in_progress');const refreshed=await refreshing;
    assert.equal(refreshed.reason,'verification_refreshed');assert.equal(bridge.snapshot().commandsLocked,false);assert.equal(bridge.snapshot().guidance,'connected');assert.equal(verifications,2);assert.equal((await bridge.refresh()).reason,'refresh_unavailable');
  }
});
test('401 and 403 after reconnect require role-specific reauthentication without retry', async () => {
  const {R}=setup();
  for(const [role,status,subject] of [['passenger',401,'依頼'],['driver',403,'運行']]){
    let disconnect,verifications=0;const bridge=R.createRecoverableNotificationSubscriptionBridge({role,subscribe:async input=>{disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:async()=>{verifications+=1;return {status};}});
    bridge.attach();await bridge.idle();disconnect();const result=await bridge.reconnect(),state=bridge.snapshot();
    assert.equal(result.reason,'reauthentication_required');assert.equal(state.guidance,'reauth');assert.equal(state.commandsLocked,true);assert.equal(state.action,'reauth');assert.match(state.feedback.message,new RegExp(subject));assert.equal(verifications,1);await bridge.idle();assert.equal(verifications,1);assert.equal((await bridge.refresh()).reason,'refresh_unavailable');
  }
});
test('404 after reconnect clears the role lock into a safe empty state', async () => {
  const {R}=setup();let disconnect;
  const bridge=R.createRecoverableNotificationSubscriptionBridge({role:'driver',subscribe:async input=>{disconnect=input.onDisconnect;return()=>{};},onHint:async()=>({processed:true}),verifyLatest:async()=>({status:404})});
  bridge.attach();await bridge.idle();disconnect();const result=await bridge.reconnect(),state=bridge.snapshot();
  assert.equal(result.reason,'ride_not_found');assert.equal(state.connected,true);assert.equal(state.guidance,'empty');assert.equal(state.commandsLocked,false);assert.equal(state.action,null);assert.match(state.feedback.title,/運行/);assert.equal(state.feedback.disableCommands,false);
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
  assert.equal(result.reason,'ride_not_found');assert.equal(state.guidance,'empty');assert.equal(state.commandsLocked,false);assert.equal(state.action,null);assert.match(state.feedback.title,/運行/);
  assert.equal((await fixture.lifecycle.handleSubscriptionAction({role:'driver',generation,action:'reconnect'})).reason,'action_not_available');
});
test('subscription failure renders one reconnect action on the active role button', async () => {
  const {R}=setup(),fixture=roleSubscriptionFeedbackLifecycleFixture(R,{subscribe:async()=>{throw Error('offline');}});
  await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const record=fixture.subscriptions[0],view=record.commandUi.snapshot();
  assert.equal(record.target.listenerCount('click'),1);assert.equal(record.target.addCount('click'),1);assert.equal(view.outcome,'unresolved');assert.equal(view.action,'reconnect');assert.equal(view.disableCommands,true);assert.match(view.title,/依頼/);assert.equal(record.renders.at(-1).action,'reconnect');
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
  assert.equal(result.reason,'ride_not_found');assert.equal(view.outcome,'confirmed');assert.equal(view.action,null);assert.equal(view.disableCommands,false);assert.match(view.title,/運行/);assert.match(view.message,/運転手ホーム/);assert.equal((await record.bridge.activate()).reason,'action_not_available');
});
test('prototype DOM bridge renders notification recovery state and accessibility locks', () => {
  const {R}=setup(),commandUi=R.createCommandUiController('passenger'),elements=feedbackDomElements(),bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>({processed:true})});
  bridge.attach();commandUi.applyFeedback('passenger',commandUi.snapshot().generation,'unresolved',{title:'依頼の通知に接続できません',message:'通信を確認してください。',disableCommands:true,action:'reconnect'});bridge.render();
  assert.equal(elements.box.hidden,false);assert.match(elements.box.className,/error/);assert.equal(elements.box.attributes['aria-busy'],'false');assert.equal(elements.title.textContent,'依頼の通知に接続できません');assert.equal(elements.action.textContent,'通知を再接続する');assert.equal(elements.action.hidden,false);assert.equal(elements.action.disabled,false);assert.equal(elements.action.attributes['aria-disabled'],'false');
  for(const button of elements.commandButtons){assert.equal(button.disabled,true);assert.equal(button.attributes['aria-disabled'],'true');}
});
test('prototype DOM feedback action is single-flight and exposes pending ARIA state', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('driver'),elements=feedbackDomElements();let calls=0,release;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:()=>{calls+=1;return new Promise(resolve=>{release=resolve;});}});bridge.attach();commandUi.applyFeedback('driver',commandUi.snapshot().generation,'unresolved',{title:'運行の通知に接続できません',message:'再接続してください。',disableCommands:true,action:'reconnect'});bridge.render();
  const pending=bridge.activate();await Promise.resolve();const duplicate=await bridge.activate();assert.equal(calls,1);assert.equal(duplicate.reason,'action_in_progress');assert.equal(elements.action.disabled,true);assert.equal(elements.action.attributes['aria-disabled'],'true');assert.equal(elements.box.attributes['aria-busy'],'true');
  release({processed:true,reason:'reconnected'});assert.equal((await pending).reason,'reconnected');assert.equal(elements.box.attributes['aria-busy'],'false');
});
test('role-page exit removes the actual feedback click listener and hides its banner', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('passenger'),elements=feedbackDomElements();let calls=0;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>{calls+=1;return {processed:true};}});bridge.attach();commandUi.applyFeedback('passenger',commandUi.snapshot().generation,'unresolved',{title:'確認が必要です',message:'',disableCommands:true,action:'refresh'});bridge.render();assert.equal(elements.action.listenerCount('click'),1);
  bridge.detach();elements.action.dispatch('click');await Promise.resolve();assert.equal(calls,0);assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal((await bridge.activate()).reason,'dom_bridge_inactive');
});
test('detaching fallback feedback releases its stale command lock', () => {
  const {R}=setup(),commandUi=R.createCommandUiController('driver'),elements=feedbackDomElements();
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>({processed:true})});bridge.attach();commandUi.applyFeedback('driver',commandUi.snapshot().generation,'unresolved',{title:'役割画面を開始できません',message:'役割選択へ戻ってください。',disableCommands:true,action:'reauth'});bridge.render();
  assert.equal(elements.commandButtons[0].disabled,true);assert.equal(elements.commandButtons[0].attributes['aria-disabled'],'true');bridge.detach();
  for(const button of elements.commandButtons){assert.equal(button.disabled,false);assert.equal(button.attributes['aria-disabled'],'false');}
});
test('delayed feedback completion cannot repaint after role-page exit', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('driver'),elements=feedbackDomElements();let release;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:()=>new Promise(resolve=>{release=resolve;})});bridge.attach();commandUi.applyFeedback('driver',commandUi.snapshot().generation,'reauth',{title:'再ログインが必要です',message:'認証してください。',disableCommands:true,action:'reauth'});bridge.render();const pending=bridge.activate();await Promise.resolve();bridge.detach();release({processed:true,reason:'reauthentication_requested'});
  assert.equal((await pending).reason,'dom_bridge_stale');assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(bridge.snapshot().attached,false);
});
test('same-role page re-entry uses a fresh DOM generation without duplicate listeners', async () => {
  const {R}=setup(),commandUi=R.createCommandUiController('passenger'),elements=feedbackDomElements();let calls=0;
  const bridge=R.createCommandFeedbackDomBridge({commandUi,elements,activate:async()=>{calls+=1;return {processed:true,reason:'refreshed'};}});bridge.attach();const first=bridge.snapshot().generation;bridge.detach();bridge.attach();const second=bridge.snapshot().generation;
  commandUi.applyFeedback('passenger',commandUi.snapshot().generation,'unresolved',{title:'最新状態を確認',message:'',disableCommands:true,action:'refresh'});bridge.render();elements.action.dispatch('click');await Promise.resolve();await Promise.resolve();assert.ok(second>first);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.action.addCount('click'),2);assert.equal(calls,1);assert.deepEqual(Object.keys(bridge.snapshot()).sort(),['attached','busy','generation','lastEvent']);
});
test('role-owned subscription failure reaches the prototype DOM through one listener', async () => {
  const {R}=setup(),fixture=roleSubscriptionDomLifecycleFixture(R,{subscribe:async()=>{throw Error('offline');}});await fixture.lifecycle.enter('passenger');await fixture.lifecycle.idle();const record=fixture.subscriptions[0],state=record.bridge.snapshot();
  assert.equal(record.elements.action.listenerCount('click'),1);assert.equal(record.elements.action.addCount('click'),1);assert.equal(record.elements.action.textContent,'通知を再接続する');assert.equal(record.elements.action.hidden,false);assert.equal(record.elements.commandButtons[0].disabled,true);assert.equal(record.elements.commandButtons[0].attributes['aria-disabled'],'true');assert.equal(state.action,'reconnect');assert.equal(state.commandsLocked,true);
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
  old.elements.action.dispatch('click');await Promise.resolve();assert.equal(connections,2);assert.equal(old.elements.action.listenerCount('click'),0);assert.equal(fresh.elements.action.listenerCount('click'),1);assert.equal(fresh.elements.action.textContent,'通知を再接続する');assert.equal(old.bridge.snapshot().detached,true);assert.equal(fresh.bridge.snapshot().detached,false);assert.ok(fresh.generation>old.generation);
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
  const entered=await router.navigate('home');await router.idle();assert.equal(entered.navigated,true);assert.equal(entered.reason,'entered');assert.equal(reads,1);assert.equal(connections,1);assert.equal(router.snapshot().revision,1);assert.equal(elements.action.textContent,'通知を再接続する');assert.equal(elements.action.listenerCount('click'),1);
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
  while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal(unsubscribes,1);assert.equal(fallbackUi.snapshot().action,'reauth');assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);assert.match(elements.title.textContent,/認証セッション/);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('attacker'),false);
  releaseOld({verified:true});await Promise.resolve();await Promise.resolve();session=accountB;eventTarget.dispatch('fiji:auth-session-changed');await router.idle();assert.deepEqual(accounts,['passenger-a','passenger-a','passenger-b']);assert.equal(connections,3);assert.equal(runtime.snapshot().activeRole,'passenger');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('passenger-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('passenger-b'),false);
});
test('auth session listener is single, ignores event payload and is removed with the router', async () => {
  const {R}=setup(),target=recoveryEventTarget(),entries=[];let page='home';
  const runtime={snapshot:()=>({}),enter:async(targetPage,role)=>{entries.push([targetPage,role]);return {entered:true,reason:'within_role'};},leave:()=>({left:true}),idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>({page:targetPage,role:'passenger'}),render:value=>{page=value.page;}});router.attach();router.attach();await router.navigate('home');target.dispatch('fiji:auth-session-changed',{detail:{role:'driver',sessionBinding:{accountRef:'injected'}}});await router.idle();
  assert.equal(target.listenerCount('fiji:auth-session-changed'),1);assert.equal(target.addCount('fiji:auth-session-changed'),1);assert.deepEqual(entries,[['home','passenger'],['home','passenger']]);assert.equal(JSON.stringify(entries).includes('injected'),false);router.detach();assert.equal(target.listenerCount('fiji:auth-session-changed'),0);target.dispatch('fiji:auth-session-changed');await Promise.resolve();assert.equal(entries.length,2);
});
test('same-session entry joins the pending lifecycle and never reports success early', async () => {
  const {R}=setup(),session=Object.freeze({accountRef:'passenger-a'});let release,calls=0,settled=false;
  const lifecycle={snapshot:()=>({}),enter:()=>{calls+=1;return new Promise(resolve=>{release=resolve;});},leave:()=>({left:true}),idle:async()=>({})};
  const runtime=R.createRolePageRuntime({services:allowedRoleServices({sessionForRole:()=>session}),createLifecycle:()=>lifecycle});
  const first=runtime.enter('home','passenger');while(!release)await new Promise(resolve=>setImmediate(resolve));const joined=runtime.enter('passenger-history','passenger');joined.then(()=>{settled=true;});await Promise.resolve();
  assert.equal(first,joined);assert.equal(calls,1);assert.equal(settled,false);assert.equal(runtime.snapshot().lastAction,'entry_joined');assert.equal(runtime.snapshot().busy,true);
  release({entered:true,reason:'entered'});const [one,two]=await Promise.all([first,joined]);assert.equal(one.entered,true);assert.equal(two.entered,true);assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(runtime.snapshot().page,'passenger-history');
});
test('a delayed old-session rejection cannot stop a newer successful entry', async () => {
  const {R}=setup(),accountA=Object.freeze({accountRef:'passenger-a'}),accountB=Object.freeze({accountRef:'passenger-b'});let session=accountA,rejectOld,leaves=0;
  const lifecycle={snapshot:()=>({}),enter:(_role,{sessionBinding})=>sessionBinding===accountA?new Promise((_resolve,reject)=>{rejectOld=reject;}):Promise.resolve({entered:true,reason:'entered'}),leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const runtime=R.createRolePageRuntime({services:allowedRoleServices({sessionForRole:()=>session}),createLifecycle:()=>lifecycle});
  const old=runtime.enter('home','passenger');while(!rejectOld)await new Promise(resolve=>setImmediate(resolve));session=accountB;const fresh=await runtime.enter('passenger-history','passenger');rejectOld(Error('old session failed'));const stale=await old;
  assert.equal(fresh.entered,true);assert.equal(stale.reason,'stale_entry');assert.equal(runtime.snapshot().activeRole,'passenger');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(leaves,0);assert.equal(JSON.stringify(runtime.snapshot()).includes('passenger-a'),false);assert.equal(JSON.stringify(runtime.snapshot()).includes('passenger-b'),false);
});
test('auth-change bursts coalesce before and during a pending fresh-session entry', async () => {
  const {R}=setup(),target=recoveryEventTarget(),accountA=Object.freeze({accountRef:'passenger-a'}),accountB=Object.freeze({accountRef:'passenger-b'});let session=accountA,page='role',releaseFresh,calls=0;
  const lifecycle={snapshot:()=>({}),enter:(_role,{sessionBinding})=>{calls+=1;return sessionBinding===accountB?new Promise(resolve=>{releaseFresh=resolve;}):Promise.resolve({entered:true,reason:'entered'});},leave:()=>({left:true}),idle:async()=>({})};
  const runtime=R.createRolePageRuntime({services:allowedRoleServices({sessionForRole:()=>session}),createLifecycle:()=>lifecycle});
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>({page:targetPage,role:'passenger'}),render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');session=accountB;
  target.dispatch('fiji:auth-session-changed');target.dispatch('fiji:auth-session-changed');target.dispatch('fiji:auth-session-changed');while(!releaseFresh)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);assert.equal(router.snapshot().revision,2);assert.equal(router.snapshot().lastAction,'entering');
  target.dispatch('fiji:auth-session-changed');target.dispatch('fiji:auth-session-changed');await Promise.resolve();assert.equal(calls,2);releaseFresh({entered:true,reason:'entered'});await router.idle();
  assert.equal(calls,2);assert.equal(router.snapshot().revision,3);assert.equal(router.snapshot().lastAction,'within_role');assert.equal(runtime.snapshot().lastAction,'within_role');assert.equal(router.snapshot().busy,false);
});
test('role chooser invalidates a pending authentication sync without a late re-entry', async () => {
  const {R}=setup(),target=recoveryEventTarget(),accountA=Object.freeze({accountRef:'passenger-a'}),accountB=Object.freeze({accountRef:'passenger-b'});let session=accountA,page='role',releaseFresh,entries=0,leaves=0;
  const lifecycle={snapshot:()=>({}),enter:(_role,{sessionBinding})=>{entries+=1;return sessionBinding===accountB?new Promise(resolve=>{releaseFresh=resolve;}):Promise.resolve({entered:true,reason:'entered'});},leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const runtime=R.createRolePageRuntime({services:allowedRoleServices({sessionForRole:()=>session}),createLifecycle:()=>lifecycle});
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'passenger'},render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');session=accountB;target.dispatch('fiji:auth-session-changed');while(!releaseFresh)await new Promise(resolve=>setImmediate(resolve));
  const chosen=await router.navigate('role');assert.equal(chosen.reason,'role_chooser');assert.equal(router.snapshot().page,'role');assert.equal(router.snapshot().activeRole,null);assert.equal(runtime.snapshot().activeRole,null);target.dispatch('fiji:auth-session-changed');releaseFresh({entered:true,reason:'entered'});await router.idle();
  assert.equal(entries,2);assert.equal(leaves,1);assert.equal(router.snapshot().page,'role');assert.equal(router.snapshot().lastAction,'role_chooser');assert.equal(runtime.snapshot().lastAction,'left');
});
test('cross-role navigation replaces a pending authentication sync with the new role only', async () => {
  const {R}=setup(),target=recoveryEventTarget(),passengerA=Object.freeze({accountRef:'passenger-a'}),passengerB=Object.freeze({accountRef:'passenger-b'}),driver=Object.freeze({accountRef:'driver-a'});let passengerSession=passengerA,page='role',releasePassenger;const entries=[];
  const lifecycle={snapshot:()=>({}),enter:(role,{sessionBinding})=>{entries.push([role,sessionBinding]);return sessionBinding===passengerB?new Promise(resolve=>{releasePassenger=resolve;}):Promise.resolve({entered:true,reason:'entered'});},leave:()=>({left:true}),idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:role=>role==='driver'?driver:passengerSession}),runtime=R.createRolePageRuntime({services,createLifecycle:()=>lifecycle});
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>({page:targetPage,role:targetPage.startsWith('driver')?'driver':'passenger'}),render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');passengerSession=passengerB;target.dispatch('fiji:auth-session-changed');while(!releasePassenger)await new Promise(resolve=>setImmediate(resolve));
  const switched=await router.navigate('driver-home');assert.equal(switched.navigated,true);assert.equal(runtime.snapshot().activeRole,'driver');target.dispatch('fiji:auth-session-changed');await Promise.resolve();releasePassenger({entered:true,reason:'entered'});await router.idle();
  assert.equal(entries.length,3);assert.deepEqual(entries.map(([role])=>role),['passenger','passenger','driver']);assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().lastAction,'within_role');assert.equal(JSON.stringify([router.snapshot(),runtime.snapshot()]).includes('passenger-'),false);
});
test('switching to a role without a session stops there and never restores the old role', async () => {
  const {R}=setup(),target=recoveryEventTarget(),passenger=Object.freeze({accountRef:'passenger-a'}),views=[];let entries=0,leaves=0,page='role';
  const lifecycle={snapshot:()=>({}),enter:async()=>{entries+=1;return {entered:true,reason:'entered'};},leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:role=>role==='passenger'?passenger:null}),runtime=R.createRolePageRuntime({services,createLifecycle:()=>lifecycle,renderUnavailable:view=>views.push(view)});
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:targetPage.startsWith('driver')?'driver':'passenger'},render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');const failed=await router.navigate('driver-home');
  assert.equal(failed.navigated,false);assert.equal(failed.reason,'session_unavailable');assert.equal(entries,1);assert.equal(leaves,1);assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(views.at(-1).role,'driver');assert.equal(views.at(-1).action,'reauth');assert.equal(views.at(-1).disableCommands,true);
  await router.navigate('role');assert.equal(router.snapshot().activeRole,null);assert.equal(runtime.snapshot().activeRole,null);assert.notEqual(router.snapshot().page,'home');
});
test('a failed target-role entry remains locked even when an auth sync joined it', async () => {
  const {R}=setup(),target=recoveryEventTarget(),passenger=Object.freeze({accountRef:'passenger-a'}),driver=Object.freeze({accountRef:'driver-a'}),views=[];let page='role',rejectDriver,entries=0,leaves=0;
  const lifecycle={snapshot:()=>({}),enter:(role)=>{entries+=1;return role==='driver'?new Promise((_resolve,reject)=>{rejectDriver=reject;}):Promise.resolve({entered:true,reason:'entered'});},leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:role=>role==='driver'?driver:passenger}),runtime=R.createRolePageRuntime({services,createLifecycle:()=>lifecycle,renderUnavailable:view=>views.push(view)});
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:targetPage.startsWith('driver')?'driver':'passenger'},render:destination=>{page=destination.page;}});router.attach();await router.navigate('home');const switching=router.navigate('driver-home');while(!rejectDriver)await new Promise(resolve=>setImmediate(resolve));target.dispatch('fiji:auth-session-changed');await Promise.resolve();assert.equal(entries,2);rejectDriver(Error('driver startup failed'));await switching;await router.idle();
  assert.equal(entries,2);assert.equal(leaves,1);assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().activeRole,'driver');assert.equal(router.snapshot().lastAction,'entry_failed');assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entry_failed');assert.equal(views.length,1);assert.equal(views[0].role,'driver');assert.equal(views[0].action,'reauth');assert.match(views[0].title,/開始できません/);assert.equal(views[0].disableCommands,true);
  await router.navigate('role');assert.equal(router.snapshot().activeRole,null);assert.equal(runtime.snapshot().activeRole,null);
});
test('failed target-role entry returns through the visible action and safely re-enters', async () => {
  const {R}=setup(),target=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),session=Object.freeze({accountRef:'driver-a',viewerRole:'driver'});let page='role',attempts=0,leaves=0,router;
  const lifecycle={snapshot:()=>({attempts}),enter:async()=>{attempts+=1;return attempts===1?{entered:false,reason:'entry_rejected'}:{entered:true,reason:'entered'};},leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services:allowedRoleServices({sessionForRole:()=>session}),createLifecycle:()=>lifecycle,renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();
  const failed=await router.navigate('driver-home');assert.equal(failed.reason,'entry_failed');assert.equal(attempts,1);assert.equal(elements.title.textContent,'役割画面を開始できません');assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);const failedGeneration=fallbackDom.snapshot().generation;
  const returned=await fallbackDom.activate();await router.idle();assert.equal(returned.reason,'dom_bridge_stale');assert.equal(router.snapshot().lastAction,'role_chooser');assert.equal(page,'role');assert.equal(runtime.snapshot().activeRole,null);assert.equal(fallbackDom.snapshot().attached,false);assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.commandButtons[0].disabled,false);
  const restored=await router.navigate('driver-home');await router.idle();assert.equal(restored.navigated,true);assert.equal(restored.reason,'entered');assert.equal(attempts,2);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.ok(fallbackDom.snapshot().generation>failedGeneration);assert.ok(leaves>=2);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-a'),false);
});
test('a repeated explicit entry failure stays single and never becomes an auth retry loop', async () => {
  const {R}=setup(),target=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),session=Object.freeze({accountRef:'driver-a',viewerRole:'driver'});let page='role',attempts=0,unavailable=0,router;
  const lifecycle={snapshot:()=>({}),enter:async()=>{attempts+=1;return {entered:false,reason:'entry_rejected'};},leave:()=>({left:true}),idle:async()=>({})};
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services:allowedRoleServices({sessionForRole:()=>session}),createLifecycle:()=>lifecycle,renderUnavailable:view=>{unavailable+=1;fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();
  assert.equal((await router.navigate('driver-home')).reason,'entry_failed');target.dispatch('fiji:auth-session-changed');target.dispatch('fiji:auth-session-changed');await router.idle();assert.equal(attempts,1);assert.equal(unavailable,1);assert.equal(router.snapshot().lastAction,'entry_failed');
  assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');await router.idle();assert.equal(router.snapshot().page,'role');assert.equal((await router.navigate('driver-home')).reason,'entry_failed');const failedRevision=router.snapshot().revision;
  target.dispatch('fiji:auth-session-changed');target.dispatch('fiji:auth-session-changed');target.dispatch('fiji:auth-session-changed');await router.idle();assert.equal(attempts,2);assert.equal(unavailable,2);assert.equal(router.snapshot().revision,failedRevision);assert.equal(router.snapshot().lastAction,'entry_failed');assert.equal(runtime.snapshot().lastAction,'entry_failed');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.action.addCount('click'),2);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.commandButtons[0].disabled,true);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-a'),false);
});
test('double role selection and duplicate hash entry share one lifecycle subscription', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),session=Object.freeze({accountRef:'driver-a',viewerRole:'driver'});let page='role',reads=0,connections=0,releaseRead,router;
  const services=allowedRoleServices({sessionForRole:()=>session,readCurrentRide:async()=>{reads+=1;return new Promise(resolve=>{releaseRead=resolve;});},subscribeNotifications:async()=>{connections+=1;return()=>{};}});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()})});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();
  const first=router.navigate('driver-home');while(!releaseRead||connections!==1)await new Promise(resolve=>setImmediate(resolve));const second=router.navigate('driver-home');eventTarget.dispatch('hashchange');eventTarget.dispatch('hashchange');await Promise.resolve();assert.equal(reads,1);assert.equal(connections,1);assert.equal(runtime.snapshot().busy,true);
  releaseRead({status:204});const [firstResult,secondResult]=await Promise.all([first,second]);await router.idle();assert.equal(firstResult.reason,'stale_navigation');assert.equal(secondResult.reason,'stale_navigation');assert.equal(reads,1);assert.equal(connections,1);assert.equal(runtime.snapshot().revision,1);assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().activeRole,'driver');assert.equal(router.snapshot().lastAction,'entered');assert.equal(elements.action.listenerCount('click'),1);assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('driver-a'),false);
});
test('account change during coalesced entry discards the old read and subscription', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),accountA=Object.freeze({accountRef:'driver-a',viewerRole:'driver'}),accountB=Object.freeze({accountRef:'driver-b',viewerRole:'driver'});let page='role',session=accountA,releaseOld,router;
  const reads=[],connections=[],disconnections=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return sessionBinding===accountA?new Promise(resolve=>{releaseOld=resolve;}):{status:204};},
    subscribeNotifications:async({sessionBinding})=>{connections.push(sessionBinding.accountRef);return()=>disconnections.push(sessionBinding.accountRef);}
  });
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()})});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();
  const oldEntry=router.navigate('driver-home');while(!releaseOld||connections.length!==1)await new Promise(resolve=>setImmediate(resolve));session=accountB;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');
  while(reads.length!==2||connections.length!==2)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(reads,['driver-a','driver-b']);assert.deepEqual(connections,['driver-a','driver-b']);assert.deepEqual(disconnections,['driver-a']);assert.equal(runtime.snapshot().activeRole,'driver');
  releaseOld({status:200,body:currentRideView('driver')});const oldResult=await oldEntry;await router.idle();assert.equal(oldResult.reason,'stale_navigation');assert.deepEqual(reads,['driver-a','driver-b']);assert.deepEqual(connections,['driver-a','driver-b']);assert.deepEqual(disconnections,['driver-a']);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().activeRole,'driver');assert.equal(elements.action.listenerCount('click'),1);assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('driver-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot()]).includes('driver-b'),false);
});
test('replacement entry stops both account generations when the new session disappears', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accountA=Object.freeze({accountRef:'driver-a',viewerRole:'driver'}),accountB=Object.freeze({accountRef:'driver-b',viewerRole:'driver'});let page='role',session=accountA,releaseA,releaseB,unavailable=0,router;
  const reads=[],connections=[],disconnections=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return new Promise(resolve=>{if(sessionBinding===accountA)releaseA=resolve;else releaseB=resolve;});},
    subscribeNotifications:async({sessionBinding})=>{connections.push(sessionBinding.accountRef);return()=>disconnections.push(sessionBinding.accountRef);}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{unavailable+=1;fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();
  const oldEntry=router.navigate('driver-home');while(!releaseA||connections.length!==1)await new Promise(resolve=>setImmediate(resolve));session=accountB;eventTarget.dispatch('fiji:auth-session-changed');while(!releaseB||connections.length!==2)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(disconnections,['driver-a']);
  session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal(unavailable,1);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b']);assert.deepEqual(connections,['driver-a','driver-b']);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.hidden,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);
  releaseB({status:200,body:currentRideView('driver')});releaseA({status:200,body:currentRideView('driver')});const oldResult=await oldEntry;await router.idle();assert.equal(oldResult.reason,'stale_navigation');assert.equal(runtime.snapshot().lastAction,'session_unavailable');assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().lastAction,'session_unavailable');assert.equal(router.snapshot().page,'driver-home');assert.deepEqual(reads,['driver-a','driver-b']);assert.deepEqual(connections,['driver-a','driver-b']);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(unavailable,1);assert.equal(elements.action.listenerCount('click'),1);assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-b'),false);
});
test('reauthentication round trip admits only a third session after two stale entries', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accountA=Object.freeze({accountRef:'driver-a',viewerRole:'driver'}),accountB=Object.freeze({accountRef:'driver-b',viewerRole:'driver'}),accountC=Object.freeze({accountRef:'driver-c',viewerRole:'driver'});let page='role',session=accountA,releaseA,releaseB,unavailable=0,router;
  const reads=[],connections=[],disconnections=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);if(sessionBinding===accountC)return {status:204};return new Promise(resolve=>{if(sessionBinding===accountA)releaseA=resolve;else releaseB=resolve;});},
    subscribeNotifications:async({sessionBinding})=>{connections.push(sessionBinding.accountRef);return()=>disconnections.push(sessionBinding.accountRef);}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{unavailable+=1;fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();
  const oldEntry=router.navigate('driver-home');while(!releaseA||connections.length!==1)await new Promise(resolve=>setImmediate(resolve));session=accountB;eventTarget.dispatch('fiji:auth-session-changed');while(!releaseB||connections.length!==2)await new Promise(resolve=>setImmediate(resolve));session=null;eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal(unavailable,1);assert.deepEqual(disconnections,['driver-a','driver-b']);
  const chooser=await fallbackDom.activate();assert.equal(chooser.reason,'dom_bridge_stale');assert.equal(router.snapshot().page,'role');assert.equal(runtime.snapshot().activeRole,null);assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.commandButtons[0].disabled,false);
  session=accountC;const fresh=await router.navigate('driver-home');assert.equal(fresh.navigated,true);assert.equal(fresh.reason,'entered');assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.deepEqual(connections,['driver-a','driver-b','driver-c']);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');
  releaseB({status:200,body:currentRideView('driver')});releaseA({status:200,body:currentRideView('driver')});const oldResult=await oldEntry;await router.idle();assert.equal(oldResult.reason,'stale_navigation');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.deepEqual(connections,['driver-a','driver-b','driver-c']);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(unavailable,1);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-b'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-c'),false);
});
test('repeated logout and reauthentication keep only the current subscription and listeners', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],unavailable=0,router;
  const reads=[],connections=[],disconnections=[];
  const services=allowedRoleServices({sessionForRole:()=>session,readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},subscribeNotifications:async({sessionBinding})=>{connections.push(sessionBinding.accountRef);return()=>disconnections.push(sessionBinding.accountRef);}});
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{unavailable+=1;fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  for(let index=0;index<2;index+=1){session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');await router.idle();assert.equal(runtime.snapshot().lastAction,'session_unavailable');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.commandButtons[0].disabled,true);assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');assert.equal(router.snapshot().page,'role');assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.commandButtons[0].disabled,false);session=accounts[index+1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,false);}
  assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.deepEqual(connections,['driver-a','driver-b','driver-c']);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(unavailable,2);assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);assert.equal(eventTarget.addCount('fiji:auth-session-changed'),1);for(const type of ['visibilitychange','pageshow','online'])assert.equal(eventTarget.listenerCount(type),1);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.action.addCount('click'),5);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-b'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-c'),false);
});
test('saved callbacks from prior authentication cycles stop before authorized notification handling', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router;
  const reads=[],subscriptions=[],disconnections=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);return {processed:true};}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  for(let index=0;index<2;index+=1){session=null;eventTarget.dispatch('fiji:auth-session-changed');await router.idle();assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');session=accounts[index+1];assert.equal((await router.navigate('driver-home')).reason,'entered');}
  assert.equal(subscriptions.length,3);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.deepEqual(disconnections,['driver-a','driver-b']);
  const hint={type:'ride.changed',rideId:'fixture-ride',revision:9},oldA=await subscriptions[0].onHint(hint),oldB=await subscriptions[1].onHint(hint);
  assert.equal(oldA.reason,'subscription_inactive');assert.equal(oldB.reason,'subscription_inactive');assert.deepEqual(handled,[]);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);
  const current=await subscriptions[2].onHint(hint);await router.idle();assert.equal(current.processed,true);assert.deepEqual(handled,[['driver-c',9]]);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot(),handled]).includes('driver-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot(),handled]).includes('driver-b'),false);
});
test('current disconnect wins a stale callback race and reconnects once', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,verifications=0;
  const reads=[],subscriptions=[],disconnections=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding})=>{handled.push(sessionBinding.accountRef);return {processed:true};},
    verifyLatest:async({sessionBinding})=>{verifications+=1;assert.equal(sessionBinding,accounts[2]);return {verified:true};}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  for(let index=0;index<2;index+=1){session=null;eventTarget.dispatch('fiji:auth-session-changed');await router.idle();await fallbackDom.activate();session=accounts[index+1];assert.equal((await router.navigate('driver-home')).reason,'entered');}
  const disconnected=subscriptions[2].onDisconnect(),staleA=subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:10}),staleB=subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:10});
  assert.equal(disconnected.reason,'subscription_disconnected');assert.equal((await staleA).reason,'subscription_inactive');assert.equal((await staleB).reason,'subscription_inactive');assert.deepEqual(handled,[]);assert.deepEqual(disconnections,['driver-a','driver-b','driver-c']);assert.equal(elements.action.textContent,'通知を再接続する');assert.equal(elements.action.hidden,false);assert.equal(elements.commandButtons[0].disabled,true);
  elements.action.dispatch('click');elements.action.dispatch('click');await router.idle();assert.equal(subscriptions.length,4);assert.equal(subscriptions[3].sessionBinding,accounts[2]);assert.equal(verifications,1);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.deepEqual(handled,[]);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-a'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-b'),false);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes('driver-c'),false);
});
test('account switch during reconnect verification keeps only the replacement session', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c','driver-d'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,releaseVerification;
  const reads=[],subscriptions=[],disconnections=[],verifications=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding})=>{handled.push(sessionBinding.accountRef);return {processed:true};},
    verifyLatest:({sessionBinding})=>{verifications.push(sessionBinding.accountRef);return sessionBinding===accounts[2]?new Promise(resolve=>{releaseVerification=resolve;}):Promise.resolve({verified:true});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  for(let index=0;index<2;index+=1){session=null;eventTarget.dispatch('fiji:auth-session-changed');await router.idle();await fallbackDom.activate();session=accounts[index+1];assert.equal((await router.navigate('driver-home')).reason,'entered');}
  subscriptions[2].onDisconnect();elements.action.dispatch('click');while(!releaseVerification)await new Promise(resolve=>setImmediate(resolve));assert.equal(subscriptions.length,4);assert.deepEqual(verifications,['driver-c']);assert.equal(elements.commandButtons[0].disabled,true);
  session=accounts[3];eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(subscriptions.length!==5||reads.length!==4)await new Promise(resolve=>setImmediate(resolve));assert.equal(subscriptions[4].sessionBinding,accounts[3]);assert.deepEqual(reads,['driver-a','driver-b','driver-c','driver-d']);assert.deepEqual(disconnections,['driver-a','driver-b','driver-c','driver-c']);assert.equal(elements.commandButtons[0].disabled,false);
  releaseVerification({verified:true});await new Promise(resolve=>setImmediate(resolve));await router.idle();assert.equal((await subscriptions[3].onHint({type:'ride.changed',rideId:'fixture-ride',revision:11})).reason,'subscription_inactive');const current=await subscriptions[4].onHint({type:'ride.changed',rideId:'fixture-ride',revision:11});assert.equal(current.processed,true);assert.deepEqual(handled,['driver-d']);assert.deepEqual(verifications,['driver-c']);assert.equal(subscriptions.length,5);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('replacement notification wins over delayed old reconnect verification', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,releaseVerification,releaseHint;
  const reads=[],subscriptions=[],disconnections=[],verifications=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);return new Promise(resolve=>{releaseHint=resolve;});},
    verifyLatest:({sessionBinding})=>{verifications.push(sessionBinding.accountRef);return new Promise(resolve=>{releaseVerification=resolve;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  subscriptions[0].onDisconnect();elements.action.dispatch('click');while(!releaseVerification)await new Promise(resolve=>setImmediate(resolve));assert.equal(subscriptions.length,2);assert.deepEqual(verifications,['driver-a']);assert.equal(elements.commandButtons[0].disabled,true);
  session=accounts[1];eventTarget.dispatch('fiji:auth-session-changed');while(subscriptions.length!==3||reads.length!==2)await new Promise(resolve=>setImmediate(resolve));assert.equal(subscriptions[2].sessionBinding,accounts[1]);assert.deepEqual(reads,['driver-a','driver-b']);assert.deepEqual(disconnections,['driver-a','driver-a']);assert.equal(elements.commandButtons[0].disabled,false);
  const currentHint=subscriptions[2].onHint({type:'ride.changed',rideId:'fixture-ride',revision:12});while(!releaseHint)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(handled,[['driver-b',12]]);
  releaseVerification({verified:true});await new Promise(resolve=>setImmediate(resolve));assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:12})).reason,'subscription_inactive');assert.equal(subscriptions.length,3);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');
  releaseHint({processed:true,reason:'notification_applied'});const current=await currentHint;await router.idle();assert.equal(current.processed,true);assert.equal(current.reason,'notification_applied');assert.deepEqual(handled,[['driver-b',12]]);assert.deepEqual(verifications,['driver-a']);assert.equal(elements.action.listenerCount('click'),1);for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('authentication loss discards a pending notification and renders one reauthentication action', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),account=Object.freeze({accountRef:'driver-a',viewerRole:'driver'});let page='role',session=account,router,releaseHint;
  const reads=[],subscriptions=[],disconnections=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);return new Promise(resolve=>{releaseHint=resolve;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  const pending=subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:13});while(!releaseHint)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(handled,[['driver-a',13]]);
  session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(disconnections,['driver-a']);assert.deepEqual(reads,['driver-a']);assert.equal(subscriptions.length,1);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.hidden,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);assert.match(elements.title.textContent,/認証セッション/);assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:14})).reason,'subscription_inactive');
  const stopped={title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,disabled:elements.commandButtons[0].disabled};releaseHint({processed:true,reason:'notification_applied'});const stale=await pending;await router.idle();assert.equal(stale.processed,false);assert.equal(stale.reason,'bridge_stale');assert.deepEqual({title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,disabled:elements.commandButtons[0].disabled},stopped);assert.deepEqual(handled,[['driver-a',13]]);assert.equal(runtime.snapshot().lastAction,'session_unavailable');assert.equal(router.snapshot().lastAction,'session_unavailable');assert.equal(router.snapshot().page,'driver-home');assert.equal(fallbackUi.snapshot().action,'reauth');assert.equal(elements.action.listenerCount('click'),1);assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('fresh reentry stays active when a pre-logout notification completes late', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,releaseOldHint;
  const reads=[],subscriptions=[],disconnections=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);return sessionBinding===accounts[0]?new Promise(resolve=>{releaseOldHint=resolve;}):Promise.resolve({processed:true,reason:'notification_applied'});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  const oldHint=subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:15});while(!releaseOldHint)await new Promise(resolve=>setImmediate(resolve));session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(disconnections,['driver-a']);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);
  assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');assert.equal(router.snapshot().page,'role');assert.equal(runtime.snapshot().activeRole,null);assert.equal(elements.action.listenerCount('click'),0);session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.equal(subscriptions[1].sessionBinding,accounts[1]);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);
  const current=await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:16});assert.equal(current.processed,true);assert.equal(current.reason,'notification_applied');assert.deepEqual(handled,[['driver-a',15],['driver-b',16]]);const currentView={boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};
  releaseOldHint({processed:true,reason:'notification_applied'});const stale=await oldHint;await router.idle();assert.equal(stale.processed,false);assert.equal(stale.reason,'bridge_stale');assert.deepEqual({boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},currentView);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.deepEqual(disconnections,['driver-a']);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('stale notification failure cannot interrupt a pending fresh-session notification', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,rejectOldHint,releaseNewHint;
  const reads=[],subscriptions=[],disconnections=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);return sessionBinding===accounts[0]?new Promise((_resolve,reject)=>{rejectOldHint=reject;}):new Promise(resolve=>{releaseNewHint=resolve;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  const oldHint=subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:17});while(!rejectOldHint)await new Promise(resolve=>setImmediate(resolve));session=null;eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.deepEqual(disconnections,['driver-a']);
  const newHint=subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:18});while(!releaseNewHint)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(handled,[['driver-a',17],['driver-b',18]]);const freshView={boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};
  rejectOldHint(Error('old notification failed'));const stale=await oldHint;await new Promise(resolve=>setImmediate(resolve));assert.equal(stale.processed,false);assert.equal(stale.reason,'bridge_stale');assert.deepEqual({boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},freshView);assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');
  releaseNewHint({processed:true,reason:'notification_applied'});const current=await newHint;await router.idle();assert.equal(current.processed,true);assert.equal(current.reason,'notification_applied');assert.deepEqual(handled,[['driver-a',17],['driver-b',18]]);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.deepEqual(disconnections,['driver-a']);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(eventTarget.listenerCount('fiji:auth-session-changed'),1);for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('current notification failure locks only the active session and offers one explicit refresh', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),account=Object.freeze({accountRef:'driver-current',viewerRole:'driver'});let page='role',router,verifications=0;
  const reads=[],subscriptions=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>account,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>{};},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);throw Error('notification transport failed');},
    verifyLatest:async({sessionBinding})=>{verifications+=1;assert.equal(sessionBinding,account);return {verified:true};}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  const failed=await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:19});assert.equal(failed.processed,false);assert.equal(failed.reason,'notification_failed');assert.deepEqual(handled,[['driver-current',19]]);assert.match(elements.title.textContent,/運行の最新状態を取得できません/);assert.equal(elements.action.textContent,'最新状態を確認する');assert.equal(elements.action.hidden,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);
  elements.action.dispatch('click');elements.action.dispatch('click');await router.idle();assert.equal(verifications,1);assert.deepEqual(reads,['driver-current']);assert.equal(subscriptions.length,1);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('failed explicit refresh after a notification failure stays locked without an automatic loop', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),account=Object.freeze({accountRef:'driver-current',viewerRole:'driver'});let page='role',router,verifications=0;
  const reads=[],subscriptions=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>account,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>{};},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);throw Error('notification transport failed');},
    verifyLatest:async({sessionBinding})=>{verifications+=1;assert.equal(sessionBinding,account);throw Error('verification transport failed');}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  const failed=await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:20});assert.equal(failed.reason,'notification_failed');assert.equal(elements.action.textContent,'最新状態を確認する');assert.equal(elements.action.hidden,false);assert.equal(elements.commandButtons[0].disabled,true);
  elements.action.dispatch('click');elements.action.dispatch('click');await router.idle();await new Promise(resolve=>setImmediate(resolve));assert.equal(verifications,1);assert.deepEqual(handled,[['driver-current',20]]);assert.deepEqual(reads,['driver-current']);assert.equal(subscriptions.length,1);assert.match(elements.title.textContent,/運行の最新状態を確認できません/);assert.match(elements.message.textContent,/自動確認は停止しました/);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,true);assert.equal(elements.action.listenerCount('click'),1);
  elements.action.dispatch('click');await router.idle();assert.equal(verifications,1);assert.equal(subscriptions.length,1);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,true);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('role chooser clears a terminal notification failure before fresh-session reentry', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,verifications=0;
  const reads=[],subscriptions=[],disconnections=[],handled=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);if(sessionBinding===accounts[0])throw Error('notification transport failed');return {processed:true,reason:'notification_applied'};},
    verifyLatest:async({sessionBinding})=>{verifications+=1;assert.equal(sessionBinding,accounts[0]);throw Error('verification transport failed');}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:21})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.equal(verifications,1);assert.match(elements.message.textContent,/自動確認は停止しました/);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,true);
  assert.equal((await router.navigate('role')).reason,'role_chooser');assert.equal(runtime.snapshot().activeRole,null);assert.equal(router.snapshot().page,'role');assert.deepEqual(disconnections,['driver-a']);assert.equal(elements.box.hidden,true);assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.commandButtons[0].disabled,false);
  session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.equal(subscriptions[1].sessionBinding,accounts[1]);assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:22})).reason,'subscription_inactive');const current=await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:22});await router.idle();assert.equal(current.processed,true);assert.equal(current.reason,'notification_applied');assert.deepEqual(handled,[['driver-a',21],['driver-b',22]]);assert.equal(verifications,1);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('fresh-session notification failure owns one new recovery action after terminal reentry', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);throw Error('notification transport failed');},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return {verified:true};}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:23})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a']);assert.match(elements.message.textContent,/自動確認は停止しました/);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,true);
  assert.equal((await router.navigate('role')).reason,'role_chooser');assert.deepEqual(disconnections,['driver-a']);assert.equal(elements.box.hidden,true);assert.equal(elements.action.listenerCount('click'),0);assert.equal(elements.commandButtons[0].disabled,false);
  session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);const freshFailure=await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:24});assert.equal(freshFailure.reason,'notification_failed');assert.match(elements.title.textContent,/運行の最新状態を取得できません/);assert.equal(elements.action.textContent,'最新状態を確認する');assert.equal(elements.action.hidden,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);
  const freshView={title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:25})).reason,'subscription_inactive');assert.deepEqual({title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},freshView);
  elements.action.dispatch('click');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(handled,[['driver-a',23],['driver-b',24]]);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.deepEqual(disconnections,['driver-a']);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('stale callback cannot interrupt a fresh-session notification verification', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,releaseFreshVerification;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);throw Error('notification transport failed');},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return new Promise(resolve=>{releaseFreshVerification=()=>resolve({verified:true});});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:25})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a']);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,true);
  assert.equal((await router.navigate('role')).reason,'role_chooser');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(disconnections,['driver-a']);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);
  assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:26})).reason,'notification_failed');elements.action.dispatch('click');elements.action.dispatch('click');while(!releaseFreshVerification)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(verifications,['driver-a','driver-b']);assert.equal(elements.commandButtons[0].disabled,true);assert.equal(elements.action.listenerCount('click'),1);
  const pendingView={title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};const stale=await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:27});assert.equal(stale.processed,false);assert.equal(stale.reason,'subscription_inactive');assert.deepEqual({title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},pendingView);assert.deepEqual(handled,[['driver-a',25],['driver-b',26]]);assert.deepEqual(verifications,['driver-a','driver-b']);assert.equal(subscriptions.length,2);
  releaseFreshVerification();await router.idle();assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.deepEqual(disconnections,['driver-a']);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('stale callback cannot alter a fresh-session verification failure', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,rejectFreshVerification;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);throw Error('notification transport failed');},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return new Promise((_resolve,reject)=>{rejectFreshVerification=reject;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:28})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a']);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,true);
  assert.equal((await router.navigate('role')).reason,'role_chooser');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(disconnections,['driver-a']);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);
  assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:29})).reason,'notification_failed');elements.action.dispatch('click');elements.action.dispatch('click');while(!rejectFreshVerification)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(verifications,['driver-a','driver-b']);assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:30})).reason,'subscription_inactive');assert.deepEqual(handled,[['driver-a',28],['driver-b',29]]);assert.equal(elements.commandButtons[0].disabled,true);
  rejectFreshVerification(Error('fresh verification transport failed'));await router.idle();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(verifications,['driver-a','driver-b']);assert.match(elements.title.textContent,/運行の最新状態を確認できません/);assert.match(elements.message.textContent,/自動確認は停止しました/);assert.equal(elements.action.hidden,true);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);
  const stopped={title:elements.title.textContent,message:elements.message.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:31})).reason,'subscription_inactive');elements.action.dispatch('click');await router.idle();assert.deepEqual({title:elements.title.textContent,message:elements.message.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},stopped);assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.deepEqual(disconnections,['driver-a']);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(router.snapshot().page,'driver-home');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('authentication loss replaces a fresh-session pending verification with one reauthentication action', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,rejectFreshVerification,unavailable=0;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);throw Error('notification transport failed');},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return new Promise((_resolve,reject)=>{rejectFreshVerification=reject;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{unavailable+=1;fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:32})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a']);assert.equal((await router.navigate('role')).reason,'role_chooser');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(disconnections,['driver-a']);
  assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:33})).reason,'notification_failed');elements.action.dispatch('click');elements.action.dispatch('click');while(!rejectFreshVerification)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(verifications,['driver-a','driver-b']);assert.equal(elements.commandButtons[0].disabled,true);
  session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal(unavailable,1);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.hidden,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);assert.match(elements.title.textContent,/認証セッション/);
  const reauthView={title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};rejectFreshVerification(Error('late verification failure'));await router.idle();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual({title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},reauthView);assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:34})).reason,'subscription_inactive');assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:34})).reason,'subscription_inactive');assert.deepEqual(handled,[['driver-a',32],['driver-b',33]]);assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b']);assert.equal(subscriptions.length,2);assert.equal(runtime.snapshot().lastAction,'session_unavailable');assert.equal(router.snapshot().page,'driver-home');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('third session remains active after authentication loss during fresh verification', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,rejectFreshVerification;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:async({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);if(sessionBinding!==accounts[2])throw Error('notification transport failed');return {processed:true,reason:'notification_applied'};},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return new Promise((_resolve,reject)=>{rejectFreshVerification=reject;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:35})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a']);assert.equal((await router.navigate('role')).reason,'role_chooser');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:36})).reason,'notification_failed');elements.action.dispatch('click');elements.action.dispatch('click');while(!rejectFreshVerification)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(verifications,['driver-a','driver-b']);
  session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);
  assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');assert.equal(router.snapshot().page,'role');assert.equal(elements.action.listenerCount('click'),0);session=accounts[2];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.equal(subscriptions.length,3);assert.equal(subscriptions[2].sessionBinding,accounts[2]);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);
  const current=await subscriptions[2].onHint({type:'ride.changed',rideId:'fixture-ride',revision:37});assert.equal(current.processed,true);assert.equal(current.reason,'notification_applied');assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:38})).reason,'subscription_inactive');assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:38})).reason,'subscription_inactive');
  const currentView={boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};rejectFreshVerification(Error('late verification failure'));await router.idle();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual({boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},currentView);assert.deepEqual(handled,[['driver-a',35],['driver-b',36],['driver-c',37]]);assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.equal(subscriptions.length,3);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('third-session notification wins over delayed old verification success', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,releaseOldVerification,releaseCurrentHint;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);if(sessionBinding!==accounts[2])return Promise.reject(Error('notification transport failed'));return new Promise(resolve=>{releaseCurrentHint=resolve;});},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return new Promise(resolve=>{releaseOldVerification=resolve;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:39})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.deepEqual(verifications,['driver-a']);assert.equal((await router.navigate('role')).reason,'role_chooser');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:40})).reason,'notification_failed');elements.action.dispatch('click');elements.action.dispatch('click');while(!releaseOldVerification)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(verifications,['driver-a','driver-b']);
  session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');session=accounts[2];assert.equal((await router.navigate('driver-home')).reason,'entered');assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.equal(subscriptions.length,3);assert.deepEqual(disconnections,['driver-a','driver-b']);
  const currentHint=subscriptions[2].onHint({type:'ride.changed',rideId:'fixture-ride',revision:41});while(!releaseCurrentHint)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(handled,[['driver-a',39],['driver-b',40],['driver-c',41]]);const currentView={boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};
  releaseOldVerification({verified:true});await new Promise(resolve=>setImmediate(resolve));assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:42})).reason,'subscription_inactive');assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:42})).reason,'subscription_inactive');assert.deepEqual({boxHidden:elements.box.hidden,actionHidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},currentView);assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');
  releaseCurrentHint({processed:true,reason:'notification_applied'});const current=await currentHint;await router.idle();assert.equal(current.processed,true);assert.equal(current.reason,'notification_applied');assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.equal(subscriptions.length,3);assert.deepEqual(disconnections,['driver-a','driver-b']);assert.equal(elements.box.hidden,true);assert.equal(elements.action.hidden,true);assert.equal(elements.commandButtons[0].disabled,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().lastAction,'entered');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('authentication loss during third-session notification discards both current and old work', async () => {
  const {R}=setup(),eventTarget=recoveryEventTarget(),elements=feedbackDomElements(),fallbackUi=R.createCommandUiController('driver'),accounts=['driver-a','driver-b','driver-c'].map(accountRef=>Object.freeze({accountRef,viewerRole:'driver'}));let page='role',session=accounts[0],router,releaseOldVerification,releaseCurrentHint,unavailable=0;
  const reads=[],subscriptions=[],disconnections=[],handled=[],verifications=[];
  const services=allowedRoleServices({
    sessionForRole:()=>session,
    readCurrentRide:async({sessionBinding})=>{reads.push(sessionBinding.accountRef);return {status:204};},
    subscribeNotifications:async context=>{subscriptions.push(context);return()=>disconnections.push(context.sessionBinding.accountRef);},
    handleNotificationHint:({sessionBinding,hint})=>{handled.push([sessionBinding.accountRef,hint.revision]);if(sessionBinding!==accounts[2])return Promise.reject(Error('notification transport failed'));return new Promise(resolve=>{releaseCurrentHint=resolve;});},
    verifyLatest:async({sessionBinding})=>{verifications.push(sessionBinding.accountRef);if(sessionBinding===accounts[0])throw Error('verification transport failed');return new Promise(resolve=>{releaseOldVerification=resolve;});}
  });
  const fallbackDom=R.createCommandFeedbackDomBridge({commandUi:fallbackUi,elements,activate:action=>action==='reauth'?router.navigate('role'):Promise.resolve({processed:false,reason:'action_not_available'})});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>R.createRoleServiceLifecycle({services:injected,elements,eventTarget,documentState:{visibilityState:'visible'},navigate:target=>page===target?null:router.navigate(target),storage:memoryStorage()}),renderUnavailable:view=>{unavailable+=1;fallbackUi.setRole(view.role);fallbackUi.applyFeedback(view.role,fallbackUi.snapshot().generation,view.outcome,{title:view.title,message:view.message,disableCommands:view.disableCommands,action:view.action});fallbackDom.attach();fallbackDom.render();},clearUnavailable:()=>{fallbackUi.clear();fallbackDom.detach();}});
  router=R.createRolePageRouter({runtime,eventTarget,readHash:()=>page,resolve:targetPage=>targetPage==='role'?{page:'role',role:null}:{page:targetPage,role:'driver'},render:destination=>{page=destination.page;}});router.attach();assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[0].onHint({type:'ride.changed',rideId:'fixture-ride',revision:43})).reason,'notification_failed');elements.action.dispatch('click');await router.idle();assert.equal((await router.navigate('role')).reason,'role_chooser');session=accounts[1];assert.equal((await router.navigate('driver-home')).reason,'entered');
  assert.equal((await subscriptions[1].onHint({type:'ride.changed',rideId:'fixture-ride',revision:44})).reason,'notification_failed');elements.action.dispatch('click');elements.action.dispatch('click');while(!releaseOldVerification)await new Promise(resolve=>setImmediate(resolve));session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable')await new Promise(resolve=>setImmediate(resolve));assert.equal(unavailable,1);assert.equal((await fallbackDom.activate()).reason,'dom_bridge_stale');
  session=accounts[2];assert.equal((await router.navigate('driver-home')).reason,'entered');const currentHint=subscriptions[2].onHint({type:'ride.changed',rideId:'fixture-ride',revision:45});while(!releaseCurrentHint)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(handled,[['driver-a',43],['driver-b',44],['driver-c',45]]);
  session=null;eventTarget.dispatch('fiji:auth-session-changed');eventTarget.dispatch('fiji:auth-session-changed');while(runtime.snapshot().lastAction!=='session_unavailable'||unavailable!==2)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(disconnections,['driver-a','driver-b','driver-c']);assert.equal(elements.action.textContent,'役割選択へ戻る');assert.equal(elements.action.hidden,false);assert.equal(elements.action.listenerCount('click'),1);assert.equal(elements.commandButtons[0].disabled,true);assert.match(elements.title.textContent,/認証セッション/);
  const reauthView={title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')};releaseOldVerification({verified:true});releaseCurrentHint({processed:true,reason:'notification_applied'});const staleCurrent=await currentHint;await router.idle();await new Promise(resolve=>setImmediate(resolve));assert.equal(staleCurrent.processed,false);assert.equal(staleCurrent.reason,'bridge_stale');assert.deepEqual({title:elements.title.textContent,message:elements.message.textContent,action:elements.action.textContent,hidden:elements.action.hidden,disabled:elements.commandButtons[0].disabled,listeners:elements.action.listenerCount('click')},reauthView);
  for(const subscription of subscriptions)assert.equal((await subscription.onHint({type:'ride.changed',rideId:'fixture-ride',revision:46})).reason,'subscription_inactive');assert.deepEqual(verifications,['driver-a','driver-b']);assert.deepEqual(reads,['driver-a','driver-b','driver-c']);assert.equal(subscriptions.length,3);assert.deepEqual(disconnections,['driver-a','driver-b','driver-c']);assert.equal(runtime.snapshot().lastAction,'session_unavailable');assert.equal(router.snapshot().lastAction,'session_unavailable');assert.equal(router.snapshot().page,'driver-home');assert.equal(fallbackUi.snapshot().action,'reauth');for(const account of accounts)assert.equal(JSON.stringify([runtime.snapshot(),router.snapshot(),fallbackUi.snapshot()]).includes(account.accountRef),false);
});
test('role-page runtime stops safely when injected services are not configured', async () => {
  const {R}=setup(),views=[];let factories=0;
  const runtime=R.createRolePageRuntime({services:null,createLifecycle:()=>{factories+=1;},renderUnavailable:view=>views.push(view)});
  const result=await runtime.enter('home','passenger');
  assert.equal(result.entered,false);assert.equal(result.reason,'services_unavailable');assert.equal(factories,0);assert.equal(views.length,1);assert.equal(views[0].role,'passenger');assert.equal(views[0].disableCommands,true);assert.equal(views[0].action,null);assert.match(views[0].title,/未設定/);assert.match(views[0].message,/通信は行っていません/);
  assert.deepEqual(Object.keys(runtime.snapshot()).sort(),['activeRole','busy','lastAction','page','revision','serviceState']);assert.equal(runtime.snapshot().serviceState,'unconfigured');
});
test('partial role service injection cannot be mistaken for a live connection', async () => {
  const {R}=setup(),views=[];let sessions=0,factories=0;
  const services={configured:true,sessionForRole(){sessions+=1;return {viewerRole:'driver'};}};
  const runtime=R.createRolePageRuntime({services,createLifecycle:()=>{factories+=1;},renderUnavailable:view=>views.push(view)});
  const result=await runtime.enter('driver-home','driver');
  assert.equal(result.reason,'services_unavailable');assert.equal(runtime.snapshot().serviceState,'unconfigured');assert.equal(sessions,0);assert.equal(factories,0);assert.equal(views[0].action,null);
});
test('configured role-page runtime enters once and preserves its generation across role navigation', async () => {
  const {R}=setup(),session={account:'private-passenger'},calls=[];let factories=0,clears=0;
  const lifecycle={snapshot:()=>({activeRole:'passenger'}),enter:async(role,options)=>{calls.push(['enter',role,options.sessionBinding]);return {entered:true,reason:'entered'};},leave:()=>{calls.push(['leave']);return {left:true};},idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:()=>session});
  const runtime=R.createRolePageRuntime({services,createLifecycle:injected=>{factories+=1;assert.equal(injected,services);return lifecycle;},clearUnavailable:()=>{clears+=1;}});
  assert.equal((await runtime.enter('home','passenger')).reason,'entered');assert.equal((await runtime.enter('passenger-history','passenger')).reason,'within_role');
  assert.equal(factories,1);assert.equal(calls.length,1);assert.equal(calls[0][2],session);assert.equal(runtime.snapshot().page,'passenger-history');assert.equal(runtime.snapshot().activeRole,'passenger');assert.ok(clears>=2);assert.equal(JSON.stringify(runtime.snapshot()).includes('private-passenger'),false);
  const left=runtime.leave();assert.equal(left.left,true);assert.equal(calls.at(-1)[0],'leave');assert.equal(runtime.snapshot().activeRole,null);
});
test('missing authenticated session blocks lifecycle creation and all service I/O', async () => {
  const {R}=setup(),views=[];let factories=0;
  const services=allowedRoleServices({sessionForRole:()=>null});
  const runtime=R.createRolePageRuntime({services,createLifecycle:()=>{factories+=1;},renderUnavailable:view=>views.push(view)});
  const result=await runtime.enter('driver-trips','driver');
  assert.equal(result.reason,'session_unavailable');assert.equal(factories,0);assert.equal(views[0].role,'driver');assert.match(views[0].title,/認証セッション/);assert.equal(views[0].outcome,'reauth');assert.equal(views[0].disableCommands,true);assert.equal(views[0].action,'reauth');
});
test('configured lifecycle entry failure stops and cannot be reused as an active page', async () => {
  const {R}=setup(),session={account:'private'},views=[];let entries=0,leaves=0;
  const lifecycle={snapshot:()=>({}),enter:async()=>{entries+=1;return {entered:false,reason:'entry_rejected'};},leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:()=>session});
  const runtime=R.createRolePageRuntime({services,createLifecycle:()=>lifecycle,renderUnavailable:view=>views.push(view)});
  const first=await runtime.enter('home','passenger'),second=await runtime.enter('passenger-history','passenger');
  assert.equal(first.reason,'entry_failed');assert.equal(second.reason,'entry_failed');assert.equal(entries,2);assert.equal(leaves,2);assert.equal(views.length,2);assert.equal(views[0].action,'reauth');assert.match(views[0].title,/開始できません/);assert.equal(runtime.snapshot().lastAction,'entry_failed');
});
test('role switch rejects a delayed old runtime entry without exposing session bindings', async () => {
  const {R}=setup(),passengerSession={account:'private-a'},driverSession={account:'private-b'};let releasePassenger;
  const lifecycle={snapshot:()=>({}),enter:role=>role==='passenger'?new Promise(resolve=>{releasePassenger=resolve;}):Promise.resolve({entered:true,reason:'entered'}),leave:()=>({left:true}),idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:role=>role==='passenger'?passengerSession:driverSession});
  const runtime=R.createRolePageRuntime({services,createLifecycle:()=>lifecycle});
  const old=runtime.enter('home','passenger');while(!releasePassenger)await new Promise(resolve=>setImmediate(resolve));const fresh=await runtime.enter('driver-home','driver');releasePassenger({entered:true,reason:'entered'});const stale=await old;
  assert.equal(fresh.entered,true);assert.equal(stale.reason,'stale_entry');assert.equal(runtime.snapshot().activeRole,'driver');assert.equal(runtime.snapshot().page,'driver-home');const publicState=JSON.stringify(runtime.snapshot());assert.equal(publicState.includes('private-a'),false);assert.equal(publicState.includes('private-b'),false);
});
test('role-page router attaches one hash listener and routes its current target', async () => {
  const {R}=setup(),target=recoveryEventTarget(),entries=[],renders=[];let hash='home';
  const runtime={snapshot:()=>({}),enter:async(page,role)=>{entries.push([page,role]);return {entered:true,reason:'entered'};},leave:()=>({left:true}),idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>hash,resolve:page=>({page,role:'passenger'}),render:value=>renders.push(value.page)});
  assert.equal(router.attach().started,true);assert.equal(router.attach().reason,'already_attached');assert.equal(target.listenerCount('hashchange'),1);assert.equal(target.addCount('hashchange'),1);
  target.dispatch('hashchange');await router.idle();assert.deepEqual(entries,[['home','passenger']]);assert.deepEqual(renders,['home']);assert.equal(router.snapshot().page,'home');
});
test('bottom-menu navigation preserves one injected role lifecycle generation', async () => {
  const {R}=setup(),target=recoveryEventTarget(),session={account:'private'},renders=[];let entries=0;
  const lifecycle={snapshot:()=>({}),enter:async()=>{entries+=1;return {entered:true,reason:'entered'};},leave:()=>({left:true}),idle:async()=>({})};
  const services=allowedRoleServices({sessionForRole:()=>session});
  const runtime=R.createRolePageRuntime({services,createLifecycle:()=>lifecycle});
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>'',resolve:page=>({page,role:'passenger'}),render:value=>renders.push(value.page)});
  assert.equal((await router.navigate('home')).navigated,true);assert.equal((await router.navigate('passenger-history')).reason,'within_role');assert.equal((await router.navigate('passenger-account')).reason,'within_role');
  assert.equal(entries,1);assert.deepEqual(renders,['home','passenger-history','passenger-account']);assert.equal(runtime.snapshot().revision,3);assert.equal(router.snapshot().revision,3);
});
test('role chooser leaves the runtime before rendering the chooser', async () => {
  const {R}=setup(),target=recoveryEventTarget(),order=[];
  const runtime={snapshot:()=>({}),enter:async()=>({entered:true}),leave:()=>{order.push('leave');return {left:true};},idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>'',resolve:()=>({page:'role',role:null}),render:()=>order.push('render')});
  const result=await router.navigate('role');assert.equal(result.reason,'role_chooser');assert.deepEqual(order,['leave','render']);assert.equal(router.snapshot().activeRole,null);
});
test('rapid role navigation cannot repaint or restore a delayed old page', async () => {
  const {R}=setup(),target=recoveryEventTarget(),renders=[];let releasePassenger;
  const runtime={snapshot:()=>({}),enter:(page,role)=>role==='passenger'?new Promise(resolve=>{releasePassenger=resolve;}):Promise.resolve({entered:true,reason:'entered'}),leave:()=>({left:true}),idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>'',resolve:page=>({page,role:page.startsWith('driver-')?'driver':'passenger'}),render:value=>renders.push(value.page)});
  const old=router.navigate('home');while(!releasePassenger)await new Promise(resolve=>setImmediate(resolve));const fresh=await router.navigate('driver-home');releasePassenger({entered:true,reason:'entered'});const stale=await old;
  assert.equal(fresh.navigated,true);assert.equal(stale.reason,'stale_navigation');assert.deepEqual(renders,['home','driver-home']);assert.equal(router.snapshot().page,'driver-home');assert.equal(router.snapshot().activeRole,'driver');
});
test('delayed failure from a departed role cannot replace the fresh router result', async () => {
  const {R}=setup(),target=recoveryEventTarget();let rejectPassenger;
  const runtime={snapshot:()=>({}),enter:(page,role)=>role==='passenger'?new Promise((resolve,reject)=>{rejectPassenger=reject;}):Promise.resolve({entered:true,reason:'entered'}),leave:()=>({left:true}),idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>'',resolve:page=>({page,role:page.startsWith('driver-')?'driver':'passenger'}),render:()=>{}});
  const old=router.navigate('home');while(!rejectPassenger)await new Promise(resolve=>setImmediate(resolve));const fresh=await router.navigate('driver-home');rejectPassenger(Error('offline'));const stale=await old;
  assert.equal(fresh.navigated,true);assert.equal(stale.reason,'stale_navigation');assert.equal(router.snapshot().lastAction,'entered');assert.equal(router.snapshot().page,'driver-home');
});
test('detached role-page router ignores future hash changes and leaves its runtime', async () => {
  const {R}=setup(),target=recoveryEventTarget();let entries=0,leaves=0,hash='home';
  const runtime={snapshot:()=>({}),enter:async()=>{entries+=1;return {entered:true};},leave:()=>{leaves+=1;return {left:true};},idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>hash,resolve:page=>({page,role:'passenger'}),render:()=>{}});router.attach();router.detach();target.dispatch('hashchange');await Promise.resolve();
  assert.equal(entries,0);assert.equal(leaves,1);assert.equal(target.listenerCount('hashchange'),0);assert.equal((await router.navigate('home')).reason,'router_detached');
});
test('invalid router destination stops before rendering or entering services', async () => {
  const {R}=setup(),target=recoveryEventTarget();let entries=0,renders=0;
  const runtime={snapshot:()=>({}),enter:async()=>{entries+=1;return {entered:true};},leave:()=>({left:true}),idle:async()=>({})};
  const router=R.createRolePageRouter({runtime,eventTarget:target,readHash:()=>'',resolve:()=>({page:'driver-home',role:'passenger'}),render:()=>{renders+=1;}});
  const result=await router.navigate('driver-home');assert.equal(result.reason,'invalid_destination');assert.equal(entries,0);assert.equal(renders,0);
});
test('prototype show path is wired through one explicit role-page router', () => {
  assert.match(source,/window\.FijiPrototypeServices\|\|null/);assert.match(source,/R\.createRolePageRouter\(/);assert.match(source,/rolePageRouter\.attach\(\)/);assert.match(source,/fiji:auth-session-changed/);assert.match(source,/commandFeedbackDom\.attach\(\)/);assert.match(source,/clearUnavailable:\(\)=>\{commandUi\.clear\(\);commandFeedbackDom\.detach\(\);\}/);assert.match(source,/navigate:page=>state\.page===page\?null:show\(page\)/);assert.match(source,/function show\(target\)\{return rolePageRouter\.navigate\(target\);\}/);
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
test('current-ride discovery contract derives scope from authentication and fails closed', () => {
  const spec=loadContract(),operation=spec.paths['/v1/rides/current'].get;
  assert.equal(operation.operationId,'getCurrentRide');
  assert.deepEqual(operation.parameters,undefined);
  assert.ok(operation.responses['200']);
  assert.ok(operation.responses['204']);
  assert.ok(operation.responses['409']);
  assert.equal(operation.responses['304'],undefined);
  const withRideId=structuredClone(spec);
  withRideId.paths['/v1/rides/current'].get.parameters=[{name:'requestId',in:'query',required:false,schema:{type:'string'}}];
  assert.ok(validateContract(withRideId).some(message=>message.includes('without path or query identifiers')));
  const withoutEmpty=structuredClone(spec);
  delete withoutEmpty.paths['/v1/rides/current'].get.responses['204'];
  assert.ok(validateContract(withoutEmpty).some(message=>message.includes('getCurrentRide must document 204')));
  const conditional=structuredClone(spec);
  conditional.paths['/v1/rides/current'].get.responses['304']={description:'unsafe empty startup response'};
  assert.ok(validateContract(conditional).some(message=>message.includes('full startup result instead of 304')));
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
test('authenticated passenger and assigned driver discover role-shaped current state without a ride ID', async () => {
  const {passenger,driver}=await currentRideDiscoveryResults();
  assert.deepEqual([passenger.status,passenger.body.viewerRole,passenger.body.nextAction],[200,'passenger','track_pickup']);
  assert.deepEqual([driver.status,driver.body.viewerRole,driver.body.nextAction],[200,'driver','start_pickup']);
  const safeFields=['id','status','revision','viewerRole','nextAction','updatedAt'];
  assert.deepEqual(Object.keys(passenger.body),safeFields);
  assert.deepEqual(Object.keys(driver.body),safeFields);
});
test('unrelated authenticated actors receive bodyless 204 without foreign ride details', async () => {
  const {otherPassenger,otherDriver}=await currentRideDiscoveryResults();
  for(const result of [otherPassenger,otherDriver]){
    assert.deepEqual([result.status,result.body],[204,null]);
    assert.equal(result.headers.cacheControl,'private, no-cache');
    assert.equal(result.headers.vary,'Authorization');
    assert.equal(result.headers.etag,null);
  }
});
test('completed and cancelled rides are excluded from current-ride discovery', async () => {
  const {completedPassenger,completedDriver,cancelledPassenger,cancelledDriver}=await currentRideDiscoveryResults();
  assert.deepEqual([completedPassenger.status,completedPassenger.body],[204,null]);
  assert.deepEqual([completedDriver.status,completedDriver.body],[204,null]);
  assert.deepEqual([cancelledPassenger.status,cancelledPassenger.body],[204,null]);
  assert.deepEqual([cancelledDriver.status,cancelledDriver.body],[204,null]);
});
test('multiple unfinished candidates stop with a non-disclosing conflict', async () => {
  const {multiple}=await currentRideDiscoveryResults();
  assert.equal(multiple.status,409);
  assert.equal(multiple.body.code,'ambiguous_current_ride');
  assert.match(multiple.body.requestId,/^trace-mock-/);
  assert.ok(!JSON.stringify(multiple.body).includes(FIXTURE.requestId));
  assert.ok(!JSON.stringify(multiple.body).includes('ride-duplicate-fixture'));
});
test('current-ride discovery rejects missing authentication and caller-supplied ride IDs', async () => {
  const {unauthenticated,injectedId}=await currentRideDiscoveryResults();
  assert.deepEqual([unauthenticated.status,unauthenticated.body.code],[401,'authentication_required']);
  assert.deepEqual([injectedId.status,injectedId.body.code],[422,'invalid_request']);
});
test('current-ride discovery is a side-effect-free private full read', async () => {
  const {passenger,driver,before,after}=await currentRideDiscoveryResults();
  assert.deepEqual(after,before);
  assert.equal(passenger.headers.cacheControl,'private, no-cache');
  assert.equal(passenger.headers.vary,'Authorization');
  assert.match(passenger.headers.etag,/^"[A-Za-z0-9_-]{24}"$/);
  assert.notEqual(passenger.headers.etag,driver.headers.etag);
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
test('a minimal notification hint obtains display state only from an authorized recovery read', async () => {
  const {authorized}=await notificationHintResults();
  assert.equal(authorized.calls,1);
  assert.deepEqual(authorized.recoveredFrom,{type:'ride.changed',rideId:FIXTURE.requestId,revision:9});
  assert.equal(authorized.fetched,true);
  assert.equal(authorized.applied,true);
  assert.equal(authorized.state.revision,9);
  assert.equal(authorized.state.status,'on_trip');
  assert.equal(authorized.state.nextAction,'show_on_trip');
});
test('notification payloads containing private or display fields are rejected without a read', async () => {
  const {sensitive,rejectedCalls}=await notificationHintResults();
  assert.equal(rejectedCalls,0);
  assert.equal(sensitive.fetched,false);
  assert.equal(sensitive.applied,false);
  assert.equal(sensitive.reason,'invalid_hint');
  assert.equal(sensitive.state.status,'cancelled');
});
test('stale, duplicate and foreign ride hints do not trigger recovery traffic', async () => {
  const {stale,duplicate,foreign,rejectedCalls}=await notificationHintResults();
  assert.equal(rejectedCalls,0);
  assert.deepEqual([stale.reason,duplicate.reason,foreign.reason],['stale_or_duplicate_hint','stale_or_duplicate_hint','foreign_hint']);
  for(const result of [stale,duplicate,foreign]){
    assert.equal(result.fetched,false);
    assert.equal(result.state.revision,8);
  }
});
test('an authorized 404 clears cached ride state after access is lost', async () => {
  const {accessLost}=await notificationHintResults();
  assert.equal(accessLost.fetched,true);
  assert.equal(accessLost.reason,'access_lost');
  assert.equal(accessLost.state,null);
  assert.equal(accessLost.needsRecovery,false);
});
test('a newer hint with a 304 response never fabricates the hinted state', async () => {
  const {notYetVisible}=await notificationHintResults();
  assert.equal(notYetVisible.fetched,true);
  assert.equal(notYetVisible.applied,false);
  assert.equal(notYetVisible.reason,'hint_not_yet_visible');
  assert.equal(notYetVisible.needsRecovery,true);
  assert.equal(notYetVisible.state.revision,8);
  assert.equal(notYetVisible.state.status,'cancelled');
});
test('a notification can request but cannot itself establish an initial display baseline', async () => {
  const {initial}=await notificationHintResults();
  assert.equal(initial.fetched,true);
  assert.equal(initial.applied,true);
  assert.equal(initial.reason,'baseline');
  assert.equal(initial.state.revision,4);
  assert.equal(initial.state.status,'assigned');
  assert.equal(initial.state.viewerRole,'passenger');
});
test('logout clears ride state, ETag and scheduled retry state', () => {
  const {loggedOut,retryCancelled}=sessionIsolationResults();
  assert.equal(retryCancelled,1);
  assert.equal(loggedOut.active,false);
  assert.equal(loggedOut.state,null);
  assert.equal(loggedOut.etag,null);
  assert.equal(loggedOut.retryScheduled,false);
  assert.equal(loggedOut.inFlight,0);
});
test('logout aborts an in-flight recovery request', () => {
  const {logoutSignalAborted}=sessionIsolationResults();
  assert.equal(logoutSignalAborted,true);
});
test('a recovery response completing after logout cannot restore cached state', () => {
  const {delayedAfterLogout}=sessionIsolationResults();
  assert.equal(delayedAfterLogout.applied,false);
  assert.equal(delayedAfterLogout.reason,'stale_session');
  assert.equal(delayedAfterLogout.state,null);
});
test('role switching clears passenger cache and rejects its delayed response', () => {
  const {afterRoleSwitch,passengerSignalAborted,delayedPassenger}=sessionIsolationResults();
  assert.equal(afterRoleSwitch.active,true);
  assert.equal(afterRoleSwitch.viewerRole,'driver');
  assert.equal(afterRoleSwitch.state,null);
  assert.equal(afterRoleSwitch.etag,null);
  assert.equal(passengerSignalAborted,true);
  assert.equal(delayedPassenger.reason,'stale_session');
  assert.equal(delayedPassenger.state,null);
});
test('the new role can apply only its own authorized recovery response', () => {
  const {driverRecovery,driverState}=sessionIsolationResults();
  assert.equal(driverRecovery.applied,true);
  assert.equal(driverRecovery.state.viewerRole,'driver');
  assert.equal(driverState.viewerRole,'driver');
  assert.equal(driverState.state.status,'on_trip');
  assert.equal(driverState.state.nextAction,'continue_trip');
  assert.equal(driverState.etag,'"driver-etag"');
});
test('switching accounts rejects an old response even when role and ride ID match', () => {
  const {delayedAccountA,accountBState}=sessionIsolationResults();
  assert.equal(delayedAccountA.applied,false);
  assert.equal(delayedAccountA.reason,'stale_session');
  assert.equal(delayedAccountA.state,null);
  assert.equal(accountBState.active,true);
  assert.equal(accountBState.viewerRole,'passenger');
  assert.equal(accountBState.state,null);
  assert.equal(accountBState.etag,null);
});
test('a command success completing after logout is discarded', () => {
  const {loggedOut,logoutAborted,delayedSuccess}=commandSessionResults();
  assert.equal(loggedOut.active,false);
  assert.equal(loggedOut.inFlight,0);
  assert.equal(logoutAborted,true);
  assert.equal(delayedSuccess.committed,false);
  assert.equal(delayedSuccess.reason,'stale_session');
  assert.equal(delayedSuccess.autoRetry,false);
});
test('session expiry during a state-changing command requires reauthentication without auto-retry', () => {
  const {sessionExpired}=commandSessionResults();
  assert.equal(sessionExpired.committed,false);
  assert.equal(sessionExpired.reason,'session_expired');
  assert.equal(sessionExpired.autoRetry,false);
  assert.equal(sessionExpired.needsReauth,true);
  assert.equal(sessionExpired.needsRecovery,true);
});
test('an unknown command outcome is reconciled before an explicit same-key retry', () => {
  const {outcomeUnknown}=commandSessionResults();
  assert.equal(outcomeUnknown.committed,false);
  assert.equal(outcomeUnknown.reason,'outcome_unknown');
  assert.equal(outcomeUnknown.autoRetry,false);
  assert.equal(outcomeUnknown.needsRecovery,true);
  assert.equal(outcomeUnknown.reuseSameKey,true);
});
test('account switching rejects the old command but allows the new account command', () => {
  const {delayedAccountA,accountBCommitted}=commandSessionResults();
  assert.equal(delayedAccountA.reason,'stale_session');
  assert.equal(delayedAccountA.committed,false);
  assert.equal(accountBCommitted.reason,'committed');
  assert.equal(accountBCommitted.committed,true);
});
test('the same raw Idempotency-Key is isolated by authenticated account', () => {
  const {accountAScope,reauthScope,accountBScope,accountAHandleScope,accountBHandleScope}=commandSessionResults();
  assert.equal(accountAScope,reauthScope);
  assert.equal(accountAScope,accountAHandleScope);
  assert.equal(accountBScope,accountBHandleScope);
  assert.notEqual(accountAScope,accountBScope);
});
test('structured idempotency scoping avoids delimiter collisions', () => {
  const {delimiterA,delimiterB}=commandSessionResults();
  assert.notEqual(delimiterA,delimiterB);
});
test('an already-applied unknown command completes from recovered state without replay', async () => {
  const {alreadyApplied,appliedReplayCalls}=await commandRecoveryResults();
  assert.equal(alreadyApplied.committed,true);
  assert.equal(alreadyApplied.reason,'confirmed_by_recovery');
  assert.equal(alreadyApplied.resent,false);
  assert.equal(alreadyApplied.state.status,'cancelled');
  assert.equal(appliedReplayCalls,0);
});
test('an unchanged recovered state permits exactly one explicit same-key replay', async () => {
  const {replayed,replayCalls}=await commandRecoveryResults();
  assert.equal(replayed.committed,true);
  assert.equal(replayed.reason,'committed_by_replay');
  assert.equal(replayed.resent,true);
  assert.equal(replayCalls.length,1);
  assert.equal(replayCalls[0].action,'cancel_ride');
  assert.equal(replayCalls[0].idempotencyKey,'recover-cancel-key');
});
test('a newer conflicting state stops recovery without replaying the command', async () => {
  const {changed,changedReplayCalls}=await commandRecoveryResults();
  assert.equal(changed.committed,false);
  assert.equal(changed.reason,'state_changed');
  assert.equal(changed.resent,false);
  assert.equal(changed.state.status,'on_trip');
  assert.equal(changedReplayCalls,0);
});
test('loss of recovery access stops the command without replay', async () => {
  const {denied,deniedReplayCalls}=await commandRecoveryResults();
  assert.equal(denied.committed,false);
  assert.equal(denied.reason,'access_lost');
  assert.equal(denied.resent,false);
  assert.equal(deniedReplayCalls,0);
});
test('an unknown replay outcome stops after the single explicit replay', async () => {
  const {replayUnknown,unknownReplayCalls}=await commandRecoveryResults();
  assert.equal(replayUnknown.committed,false);
  assert.equal(replayUnknown.reason,'replay_unresolved');
  assert.equal(replayUnknown.resent,true);
  assert.equal(unknownReplayCalls,1);
});
test('a session switch during recovery discards the result and prevents replay', async () => {
  const {staleSession,staleReplayCalls}=await commandRecoveryResults();
  assert.equal(staleSession.committed,false);
  assert.equal(staleSession.reason,'stale_session');
  assert.equal(staleSession.resent,false);
  assert.equal(staleReplayCalls,0);
});
