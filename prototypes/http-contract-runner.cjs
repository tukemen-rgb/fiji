'use strict';

const http = require('node:http');

const FIXTURE = Object.freeze({
  requestId: 'ride-owner-1',
  offerId: 'offer-reviewed-1',
  revision: 2,
  tokens: Object.freeze({
    owner: 'token-passenger-owner',
    otherPassenger: 'token-passenger-other',
    assignedDriver: 'token-driver-assigned',
    reviewedDriver: 'token-driver-reviewed',
    otherDriver: 'token-driver-other',
    pendingDriver: 'token-driver-pending'
  })
});

const ACTORS = new Map([
  [FIXTURE.tokens.owner, {id: 'passenger-owner', role: 'passenger'}],
  [FIXTURE.tokens.otherPassenger, {id: 'passenger-other', role: 'passenger'}],
  [FIXTURE.tokens.assignedDriver, {id: 'driver-assigned', role: 'driver', eligible: true}],
  [FIXTURE.tokens.reviewedDriver, {id: 'driver-reviewed', role: 'driver', eligible: true}],
  [FIXTURE.tokens.otherDriver, {id: 'driver-other', role: 'driver', eligible: true}],
  [FIXTURE.tokens.pendingDriver, {id: 'driver-pending', role: 'driver', eligible: false}]
]);
const FORBIDDEN_INPUTS = new Set(['passengerId', 'driverId', 'reviewerId', 'approved', 'eligible', 'reviewStatus']);
const AUDIT_FIELDS = Object.freeze(['id', 'type', 'outcome', 'reason', 'actorRole', 'actorRef', 'requestId', 'offerId', 'fromRevision', 'toRevision', 'occurredAt']);

function errorBody(code, message, suffix = 'error') {
  return {code, message, requestId: `trace-mock-${suffix}`};
}

function send(res, status, body) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded)});
  res.end(encoded);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}

function hasForbiddenInput(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasForbiddenInput);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_INPUTS.has(key) || hasForbiddenInput(child));
}

function actorFrom(req) {
  const match = /^Bearer (.+)$/i.exec(req.headers.authorization || '');
  return match ? ACTORS.get(match[1]) : null;
}

function createMockState(options = {}) {
  const clockMs = options.clockMs ?? Date.parse('2026-09-17T03:00:00Z');
  return {
    ride: {id: FIXTURE.requestId, status: 'collecting', revision: FIXTURE.revision},
    offer: {
      id: FIXTURE.offerId,
      driverId: 'driver-reviewed',
      status: 'active',
      fareCents: 2300,
      etaMinutes: 7,
      expiresAtMs: options.offerExpiresAtMs ?? clockMs + 15 * 60 * 1000
    },
    driverEligibility: {'driver-reviewed': options.offerDriverEligible ?? true},
    clockMs,
    auditEvents: [],
    auditSequence: 0,
    idempotency: new Map(),
    lock: Promise.resolve()
  };
}

function recordAudit(state, actor, event) {
  const entry = Object.freeze({
    id: `audit-${++state.auditSequence}`,
    type: event.type,
    outcome: event.outcome,
    reason: event.reason || null,
    actorRole: actor.role,
    actorRef: actor.id,
    requestId: FIXTURE.requestId,
    offerId: event.offerId || null,
    fromRevision: event.fromRevision,
    toRevision: event.toRevision,
    occurredAt: new Date(state.clockMs).toISOString()
  });
  state.auditEvents.push(entry);
  return entry;
}

function serialize(state, action) {
  const pending = state.lock.then(action, action);
  state.lock = pending.then(() => undefined, () => undefined);
  return pending;
}

function commandFingerprint(req, url, body) {
  return JSON.stringify({method: req.method, path: url.pathname, body});
}

async function atomicCommand(state, actor, req, url, body, action) {
  const key = `${actor.id}:${req.headers['idempotency-key']}`;
  const fingerprint = commandFingerprint(req, url, body);
  return serialize(state, async () => {
    const saved = state.idempotency.get(key);
    if (saved) {
      if (saved.fingerprint !== fingerprint) return {status: 409, body: errorBody('idempotency_conflict', 'Idempotency-Key was already used for different content.', 'idempotency-conflict')};
      return structuredClone(saved.response);
    }
    // Let concurrent HTTP handlers overlap before the serialized state change.
    await new Promise(resolve => setImmediate(resolve));
    const response = action();
    state.idempotency.set(key, {fingerprint, response: structuredClone(response)});
    return response;
  });
}

function createMockHandler(state = createMockState()) {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const actor = actorFrom(req);
    if (!actor) return send(res, 401, errorBody('authentication_required', 'Authentication is required.', 'auth'));
    if (req.method === 'POST' && !req.headers['idempotency-key']) {
      return send(res, 422, errorBody('invalid_request', 'Idempotency-Key is required.', 'idempotency'));
    }
    const body = req.method === 'POST' ? await readBody(req) : {};
    if (body === null || hasForbiddenInput(body)) {
      return send(res, 422, errorBody('invalid_request', 'Request fields are invalid.', 'input'));
    }

    const offersPath = `/v1/ride-requests/${FIXTURE.requestId}/offers`;
    const selectPath = `/v1/offers/${FIXTURE.offerId}/select`;
    const cancelPath = `/v1/ride-requests/${FIXTURE.requestId}/cancel`;
    const confirmationPath = `/v1/rides/${FIXTURE.requestId}/vehicle-confirmations`;
    const transitionPath = `/v1/rides/${FIXTURE.requestId}/transitions`;

    if (req.method === 'GET' && url.pathname === offersPath) {
      if (actor.role !== 'passenger') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'passenger-owner') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      return send(res, 200, {offers: [], summary: {active: 0, expired: 0, unavailable: 0}});
    }
    if (req.method === 'POST' && url.pathname === offersPath) {
      if (actor.role !== 'driver' || !actor.eligible) return send(res, 403, errorBody('role_or_eligibility_denied', 'This role or eligibility cannot perform the operation.', 'eligibility'));
      return send(res, 201, {id: 'offer-new', requestId: FIXTURE.requestId, fareCents: body.fareCents, etaMinutes: body.etaMinutes, status: 'active', expiresAt: '2026-09-17T02:15:00Z'});
    }
    if (req.method === 'POST' && url.pathname === selectPath) {
      if (actor.role !== 'passenger') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'passenger-owner') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      if (Object.keys(body).some(key => key !== 'expectedRequestRevision')) return send(res, 422, errorBody('invalid_request', 'Request fields are invalid.', 'input'));
      const response = await atomicCommand(state, actor, req, url, body, () => {
        const fromRevision = state.ride.revision;
        if (Number(body.expectedRequestRevision) !== state.ride.revision) {
          recordAudit(state, actor, {type: 'offer.selection', outcome: 'rejected', reason: 'stale_revision', offerId: FIXTURE.offerId, fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('stale_revision', 'The request changed. Refresh before retrying.', 'stale'), revision: state.ride.revision}};
        }
        if (state.ride.status !== 'collecting') {
          recordAudit(state, actor, {type: 'offer.selection', outcome: 'rejected', reason: 'invalid_transition', offerId: FIXTURE.offerId, fromRevision, toRevision: fromRevision});
          return {status: 409, body: errorBody('invalid_transition', 'The request can no longer accept an offer.', 'transition')};
        }
        if (state.offer.status === 'expired' || state.clockMs >= state.offer.expiresAtMs) {
          state.offer.status = 'expired'; state.offer.statusReason = 'time';
          recordAudit(state, actor, {type: 'offer.selection', outcome: 'rejected', reason: 'offer_expired', offerId: FIXTURE.offerId, fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('offer_expired', 'The offer has expired. Request a new quote.', 'expired'), revision: state.ride.revision}};
        }
        if (state.offer.status === 'unavailable' || !state.driverEligibility[state.offer.driverId]) {
          state.offer.status = 'unavailable'; state.offer.statusReason = 'eligibility';
          recordAudit(state, actor, {type: 'offer.selection', outcome: 'rejected', reason: 'driver_unavailable', offerId: FIXTURE.offerId, fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('driver_unavailable', 'The driver is no longer eligible or available.', 'eligibility'), revision: state.ride.revision}};
        }
        state.ride.status = 'assigned'; state.ride.revision += 1; state.ride.selectedOfferId = FIXTURE.offerId; state.offer.status = 'selected';
        state.ride.selectedQuote = {fareCents: state.offer.fareCents, etaMinutes: state.offer.etaMinutes, selectedAt: new Date(state.clockMs).toISOString()};
        recordAudit(state, actor, {type: 'offer.selection', outcome: 'committed', offerId: FIXTURE.offerId, fromRevision, toRevision: state.ride.revision});
        return {status: 200, body: structuredClone(state.ride)};
      });
      return send(res, response.status, response.body);
    }
    if (req.method === 'POST' && url.pathname === cancelPath) {
      if (actor.role !== 'passenger') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'passenger-owner') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      const response = await atomicCommand(state, actor, req, url, body, () => {
        const fromRevision = state.ride.revision;
        if (Number(body.expectedRevision) !== state.ride.revision) {
          recordAudit(state, actor, {type: 'ride.cancellation', outcome: 'rejected', reason: 'stale_revision', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('stale_revision', 'The request changed. Refresh before retrying.', 'stale'), revision: state.ride.revision}};
        }
        if (!['collecting', 'assigned', 'arriving'].includes(state.ride.status)) {
          recordAudit(state, actor, {type: 'ride.cancellation', outcome: 'rejected', reason: 'invalid_transition', fromRevision, toRevision: fromRevision});
          return {status: 409, body: errorBody('invalid_transition', 'The request can no longer be cancelled.', 'transition')};
        }
        state.ride.status = 'cancelled'; state.ride.revision += 1; state.ride.cancelReason = body.reason;
        recordAudit(state, actor, {type: 'ride.cancellation', outcome: 'committed', fromRevision, toRevision: state.ride.revision});
        return {status: 200, body: structuredClone(state.ride)};
      });
      return send(res, response.status, response.body);
    }
    if (req.method === 'POST' && url.pathname === confirmationPath) {
      if (actor.role !== 'passenger') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'passenger-owner') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      return send(res, 201, {requestId: FIXTURE.requestId, assignmentRevision: FIXTURE.revision, confirmedAt: '2026-09-17T02:00:00Z'});
    }
    if (req.method === 'POST' && url.pathname === transitionPath) {
      if (actor.role !== 'driver') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'driver-assigned') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      return send(res, 200, {id: FIXTURE.requestId, status: body.to, revision: 3});
    }
    return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'route'));
  };
  handler.state = state;
  return handler;
}

function scenarios(tokens = FIXTURE.tokens) {
  const idempotent = {'Idempotency-Key': 'test-key-0000000001'};
  return [
    {name: 'no session cannot read offers', method: 'GET', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, expected: [401, 'authentication_required']},
    {name: 'owner can read offers', method: 'GET', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.owner, expected: [200]},
    {name: 'unrelated passenger cannot discover offers', method: 'GET', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.otherPassenger, expected: [404, 'resource_not_found'], concealed: true},
    {name: 'driver cannot use passenger offer-list API', method: 'GET', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.reviewedDriver, expected: [403, 'role_or_eligibility_denied']},
    {name: 'passenger cannot create a driver offer', method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.owner, headers: idempotent, body: {fareCents: 2300, etaMinutes: 7, expectedRequestRevision: 2}, expected: [403, 'role_or_eligibility_denied']},
    {name: 'pending driver cannot create an offer', method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.pendingDriver, headers: idempotent, body: {fareCents: 2300, etaMinutes: 7, expectedRequestRevision: 2}, expected: [403, 'role_or_eligibility_denied']},
    {name: 'reviewed driver can create an offer', method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.reviewedDriver, headers: idempotent, body: {fareCents: 2300, etaMinutes: 7, expectedRequestRevision: 2}, expected: [201]},
    {name: 'other passenger cannot select the owner offer', method: 'POST', path: `/v1/offers/${FIXTURE.offerId}/select`, token: tokens.otherPassenger, headers: idempotent, body: {expectedRequestRevision: 2}, expected: [404, 'resource_not_found'], concealed: true},
    {name: 'other passenger cannot cancel the owner request', method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/cancel`, token: tokens.otherPassenger, headers: idempotent, body: {expectedRevision: 2, reason: 'passenger_requested'}, expected: [404, 'resource_not_found'], concealed: true},
    {name: 'other passenger cannot confirm the owner vehicle', method: 'POST', path: `/v1/rides/${FIXTURE.requestId}/vehicle-confirmations`, token: tokens.otherPassenger, headers: idempotent, body: {observedPlate: 'DEMO 001', samePerson: true, sameVehicle: true, expectedRevision: 2}, expected: [404, 'resource_not_found'], concealed: true},
    {name: 'unassigned driver cannot transition the ride', method: 'POST', path: `/v1/rides/${FIXTURE.requestId}/transitions`, token: tokens.otherDriver, headers: idempotent, body: {from: 'assigned', to: 'arriving', expectedRevision: 2}, expected: [404, 'resource_not_found'], concealed: true},
    {name: 'assigned driver can transition the ride', method: 'POST', path: `/v1/rides/${FIXTURE.requestId}/transitions`, token: tokens.assignedDriver, headers: idempotent, body: {from: 'assigned', to: 'arriving', expectedRevision: 2}, expected: [200]},
    {name: 'caller supplied driver identity is rejected', method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: tokens.reviewedDriver, headers: idempotent, body: {driverId: 'driver-assigned', fareCents: 2300, etaMinutes: 7, expectedRequestRevision: 2}, expected: [422, 'invalid_request']},
    {name: 'missing idempotency key is rejected', method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/cancel`, token: tokens.owner, body: {expectedRevision: 2, reason: 'passenger_requested'}, expected: [422, 'invalid_request']}
  ];
}

async function requestJson(baseUrl, scenario, fetchImpl) {
  const headers = {...scenario.headers};
  if (scenario.token) headers.authorization = `Bearer ${scenario.token}`;
  if (scenario.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetchImpl(`${baseUrl}${scenario.path}`, {method: scenario.method, headers, body: scenario.body === undefined ? undefined : JSON.stringify(scenario.body)});
  return {status: response.status, body: await response.json()};
}

async function runHttpContract(baseUrl, tokens = FIXTURE.tokens, fetchImpl = fetch) {
  const results = [];
  for (const scenario of scenarios(tokens)) {
    const actual = await requestJson(baseUrl, scenario, fetchImpl);
    const [expectedStatus, expectedCode] = scenario.expected;
    if (actual.status !== expectedStatus) throw new Error(`${scenario.name}: expected HTTP ${expectedStatus}, received ${actual.status}`);
    if (expectedCode && actual.body?.code !== expectedCode) throw new Error(`${scenario.name}: expected ${expectedCode}, received ${actual.body?.code || 'no code'}`);
    if (actual.status >= 400 && (!actual.body?.message || !actual.body?.requestId)) throw new Error(`${scenario.name}: unsafe or incomplete error envelope`);
    if (scenario.concealed && JSON.stringify(actual.body).includes('passenger-owner')) throw new Error(`${scenario.name}: concealed owner identity leaked`);
    results.push({name: scenario.name, status: actual.status, code: actual.body?.code || null});
  }
  return results;
}

async function startMockServer(options = {}) {
  const state = createMockState(options);
  const server = http.createServer(createMockHandler(state));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

async function selectOnFreshMock(options, suffix, body = {expectedRequestRevision: FIXTURE.revision}) {
  const mock = await startMockServer(options);
  try {
    const result = await requestJson(mock.baseUrl, {
      method: 'POST',
      path: `/v1/offers/${FIXTURE.offerId}/select`,
      token: FIXTURE.tokens.owner,
      headers: {'Idempotency-Key': `validity-key-${suffix}-0001`},
      body
    }, fetch);
    return {result, ride: structuredClone(mock.state.ride), offer: structuredClone(mock.state.offer), auditEvents: structuredClone(mock.state.auditEvents)};
  } finally {
    await mock.close();
  }
}

async function runOfferValidityContract() {
  const clockMs = Date.parse('2026-09-17T03:00:00Z');
  const [expired, boundary, ineligible, valid, clientClock] = await Promise.all([
    selectOnFreshMock({clockMs, offerExpiresAtMs: clockMs - 1}, 'expired'),
    selectOnFreshMock({clockMs, offerExpiresAtMs: clockMs}, 'boundary'),
    selectOnFreshMock({clockMs, offerDriverEligible: false}, 'ineligible'),
    selectOnFreshMock({clockMs, offerExpiresAtMs: clockMs + 1}, 'valid'),
    selectOnFreshMock({clockMs, offerExpiresAtMs: clockMs - 1}, 'client-clock', {expectedRequestRevision: FIXTURE.revision, clientNow: new Date(clockMs - 60_000).toISOString()})
  ]);
  if (expired.result.status !== 409 || expired.result.body?.code !== 'offer_expired') throw new Error('server clock did not reject an expired offer');
  if (boundary.result.status !== 409 || boundary.result.body?.code !== 'offer_expired') throw new Error('offer remained selectable at its exact expiry instant');
  if (ineligible.result.status !== 409 || ineligible.result.body?.code !== 'driver_unavailable') throw new Error('selection did not recheck current driver eligibility');
  if (valid.result.status !== 200 || valid.ride.status !== 'assigned' || valid.ride.revision !== 3) throw new Error('a current eligible offer could not be selected');
  if (clientClock.result.status !== 422 || clientClock.result.body?.code !== 'invalid_request') throw new Error('client-controlled clock input was not rejected');
  for (const rejected of [expired, boundary, ineligible]) {
    if (rejected.ride.status !== 'collecting' || rejected.ride.revision !== FIXTURE.revision) throw new Error('invalid offer selection changed the ride');
  }
  return {expired, boundary, ineligible, valid, clientClock};
}

async function runMockContract() {
  const mock = await startMockServer();
  try {
    return await runHttpContract(mock.baseUrl);
  } finally {
    await mock.close();
  }
}

async function runConcurrencyContract() {
  const mock = await startMockServer();
  const common = {method: 'POST', token: FIXTURE.tokens.owner};
  const commands = [
    {...common, name: 'select', path: `/v1/offers/${FIXTURE.offerId}/select`, headers: {'Idempotency-Key': 'race-key-select-0001'}, body: {expectedRequestRevision: FIXTURE.revision}},
    {...common, name: 'cancel', path: `/v1/ride-requests/${FIXTURE.requestId}/cancel`, headers: {'Idempotency-Key': 'race-key-cancel-0001'}, body: {expectedRevision: FIXTURE.revision, reason: 'passenger_requested'}}
  ];
  try {
    const pair = await Promise.all(commands.map(command => requestJson(mock.baseUrl, command, fetch)));
    const winnerIndex = pair.findIndex(result => result.status === 200);
    const loserIndex = pair.findIndex(result => result.status === 409 && result.body?.code === 'stale_revision');
    if (winnerIndex < 0 || loserIndex < 0 || winnerIndex === loserIndex) throw new Error(`concurrent select/cancel must have one winner and one stale loser: ${JSON.stringify(pair)}`);
    const winnerCommand = commands[winnerIndex], winner = pair[winnerIndex], loser = pair[loserIndex];
    const replay = await requestJson(mock.baseUrl, winnerCommand, fetch);
    if (replay.status !== 200 || JSON.stringify(replay.body) !== JSON.stringify(winner.body)) throw new Error('exact Idempotency-Key replay did not return the original success');
    const changedCommand = structuredClone(winnerCommand);
    changedCommand.body = winnerCommand.name === 'select' ? {expectedRequestRevision: 999} : {expectedRevision: FIXTURE.revision, reason: 'route_changed'};
    const conflict = await requestJson(mock.baseUrl, changedCommand, fetch);
    if (conflict.status !== 409 || conflict.body?.code !== 'idempotency_conflict') throw new Error('Idempotency-Key reuse with changed content was not rejected');
    if (mock.state.ride.revision !== FIXTURE.revision + 1 || mock.state.ride.status !== winner.body.status) throw new Error('race changed the ride more than once');
    return {
      pair,
      winner: {command: winnerCommand.name, ...winner},
      loser: {command: commands[loserIndex].name, ...loser},
      replay,
      conflict,
      state: structuredClone(mock.state.ride),
      storedKeys: mock.state.idempotency.size,
      auditEvents: structuredClone(mock.state.auditEvents)
    };
  } finally {
    await mock.close();
  }
}

async function runAuditContract() {
  const [race, validity] = await Promise.all([runConcurrencyContract(), runOfferValidityContract()]);
  if (race.auditEvents.length !== 2) throw new Error('concurrent commands and exact replay did not produce exactly two audit events');
  if (race.auditEvents.filter(event => event.outcome === 'committed').length !== 1) throw new Error('race audit did not record exactly one committed command');
  if (race.auditEvents.filter(event => event.reason === 'stale_revision').length !== 1) throw new Error('race audit did not record the stale loser');
  if (validity.expired.auditEvents[0]?.reason !== 'offer_expired') throw new Error('expired selection rejection was not audited');
  if (validity.ineligible.auditEvents[0]?.reason !== 'driver_unavailable') throw new Error('eligibility rejection was not audited');
  if (validity.valid.auditEvents[0]?.outcome !== 'committed') throw new Error('successful selection was not audited');
  const events = [...race.auditEvents, ...validity.expired.auditEvents, ...validity.ineligible.auditEvents, ...validity.valid.auditEvents];
  for (const event of events) {
    if (Object.keys(event).join('|') !== AUDIT_FIELDS.join('|')) throw new Error(`audit event contains unexpected fields: ${Object.keys(event).join(',')}`);
  }
  const encoded = JSON.stringify(events);
  const forbidden = [...Object.values(FIXTURE.tokens), 'Idempotency-Key', 'phone', 'email', 'observedPlate', 'permit', '+679', '@'];
  if (forbidden.some(value => encoded.toLowerCase().includes(value.toLowerCase()))) throw new Error('audit events contain a credential or private input');
  return {race, validity, events};
}

if (require.main === module) {
  Promise.all([runMockContract(), runAuditContract()]).then(([results, audit]) => {
    const {race, validity} = audit;
    const denied = results.filter(r => r.status >= 400).length;
    console.log(`HTTP contract OK: ${results.length} scenarios (${denied} safe denials, ${results.length - denied} positive controls)`);
    console.log(`HTTP race OK: ${race.winner.command} won, ${race.loser.command} received stale_revision, exact replay was stable, changed replay was rejected`);
    console.log(`HTTP validity OK: ${validity.expired.result.body.code}, exact-boundary expiry, ${validity.ineligible.result.body.code}, client clock rejected, current offer selected`);
    console.log(`HTTP audit OK: ${audit.events.length} allowlisted events, one race commit, one stale rejection, no replay duplicate or private input`);
  }).catch(error => {
    console.error(`HTTP contract failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {FIXTURE, AUDIT_FIELDS, createMockHandler, scenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract, runAuditContract, startMockServer};
