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

function normalizePlate(value) {
  return String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function rideStateView(state, actor) {
  const passengerActions = {
    collecting: 'compare_offers',
    assigned: 'track_pickup',
    arriving: 'confirm_vehicle',
    on_trip: 'show_on_trip',
    completed: 'show_completed',
    cancelled: 'show_cancelled_history'
  };
  const driverActions = {
    assigned: 'start_pickup',
    arriving: 'wait_for_vehicle_confirmation',
    on_trip: 'continue_trip',
    completed: 'show_completed',
    cancelled: 'show_cancelled_trip'
  };
  return {
    id: state.ride.id,
    status: state.ride.status,
    revision: state.ride.revision,
    viewerRole: actor.role,
    nextAction: (actor.role === 'passenger' ? passengerActions : driverActions)[state.ride.status],
    updatedAt: new Date(state.clockMs).toISOString()
  };
}

function createMockState(options = {}) {
  const clockMs = options.clockMs ?? Date.parse('2026-09-17T03:00:00Z');
  const rideStatus = options.rideStatus ?? 'collecting';
  return {
    ride: {
      id: FIXTURE.requestId,
      status: rideStatus,
      revision: options.rideRevision ?? FIXTURE.revision,
      assignedDriverId: options.assignedDriverId ?? (rideStatus === 'collecting' ? null : 'driver-assigned'),
      vehicleConfirmation: options.vehicleConfirmation ? structuredClone(options.vehicleConfirmation) : null
    },
    offer: {
      id: FIXTURE.offerId,
      driverId: 'driver-reviewed',
      status: 'active',
      fareCents: 2300,
      etaMinutes: 7,
      expiresAtMs: options.offerExpiresAtMs ?? clockMs + 15 * 60 * 1000
    },
    driverEligibility: {
      'driver-reviewed': options.offerDriverEligible ?? true,
      'driver-assigned': options.assignedDriverEligible ?? true
    },
    bookedPlate: normalizePlate(options.bookedPlate ?? 'DEMO 001'),
    commandDelays: {...(options.commandDelays || {})},
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
    const ridePath = `/v1/rides/${FIXTURE.requestId}`;
    const confirmationPath = `/v1/rides/${FIXTURE.requestId}/vehicle-confirmations`;
    const transitionPath = `/v1/rides/${FIXTURE.requestId}/transitions`;

    if (req.method === 'GET' && url.pathname === ridePath) {
      const ownsRide = actor.role === 'passenger' && actor.id === 'passenger-owner';
      const isAssignedDriver = actor.role === 'driver' && actor.id === state.ride.assignedDriverId;
      if (!ownsRide && !isAssignedDriver) return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      return send(res, 200, rideStateView(state, actor));
    }

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
      if (state.commandDelays.cancel) await new Promise(resolve => setTimeout(resolve, state.commandDelays.cancel));
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
        state.ride.status = 'cancelled'; state.ride.revision += 1; state.ride.cancelReason = body.reason; state.ride.vehicleConfirmation = null;
        recordAudit(state, actor, {type: 'ride.cancellation', outcome: 'committed', fromRevision, toRevision: state.ride.revision});
        return {status: 200, body: structuredClone(state.ride)};
      });
      return send(res, response.status, response.body);
    }
    if (req.method === 'POST' && url.pathname === confirmationPath) {
      if (actor.role !== 'passenger') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'passenger-owner') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      const confirmationFields = ['observedPlate', 'samePerson', 'sameVehicle', 'expectedRevision'];
      if (Object.keys(body).some(key => !confirmationFields.includes(key)) ||
          typeof body.observedPlate !== 'string' || !body.observedPlate.trim() ||
          typeof body.samePerson !== 'boolean' || typeof body.sameVehicle !== 'boolean') {
        return send(res, 422, errorBody('invalid_request', 'Request fields are invalid.', 'input'));
      }
      const response = await atomicCommand(state, actor, req, url, body, () => {
        const fromRevision = state.ride.revision;
        if (Number(body.expectedRevision) !== fromRevision) {
          recordAudit(state, actor, {type: 'vehicle.confirmation', outcome: 'rejected', reason: 'stale_revision', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('stale_revision', 'The ride changed. Refresh before retrying.', 'stale'), revision: fromRevision}};
        }
        if (state.ride.status !== 'arriving' || !state.ride.assignedDriverId) {
          recordAudit(state, actor, {type: 'vehicle.confirmation', outcome: 'rejected', reason: 'invalid_transition', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('invalid_transition', 'Vehicle confirmation is not available in this ride state.', 'transition'), revision: fromRevision}};
        }
        if (!state.driverEligibility[state.ride.assignedDriverId]) {
          recordAudit(state, actor, {type: 'vehicle.confirmation', outcome: 'rejected', reason: 'driver_unavailable', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('driver_unavailable', 'The assigned driver is no longer eligible.', 'eligibility'), revision: fromRevision}};
        }
        const matches = normalizePlate(body.observedPlate) === state.bookedPlate && body.samePerson && body.sameVehicle;
        if (!matches) {
          if (state.ride.vehicleConfirmation) {
            state.ride.vehicleConfirmation = null;
            state.ride.revision += 1;
          }
          recordAudit(state, actor, {type: 'vehicle.confirmation', outcome: 'rejected', reason: 'vehicle_mismatch', fromRevision, toRevision: state.ride.revision});
          return {status: 409, body: {...errorBody('vehicle_mismatch', 'The observed driver or vehicle does not match the booking.', 'vehicle-mismatch'), revision: state.ride.revision}};
        }
        const confirmation = {
          requestId: FIXTURE.requestId,
          assignmentRevision: fromRevision,
          confirmedAt: new Date(state.clockMs).toISOString()
        };
        state.ride.revision += 1;
        state.ride.vehicleConfirmation = {...confirmation, validForRevision: state.ride.revision};
        recordAudit(state, actor, {type: 'vehicle.confirmation', outcome: 'committed', fromRevision, toRevision: state.ride.revision});
        return {status: 201, body: confirmation};
      });
      return send(res, response.status, response.body);
    }
    if (req.method === 'POST' && url.pathname === transitionPath) {
      if (actor.role !== 'driver') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== state.ride.assignedDriverId) return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      const transitionFields = ['from', 'to', 'expectedRevision'];
      if (Object.keys(body).some(key => !transitionFields.includes(key)) ||
          typeof body.from !== 'string' || typeof body.to !== 'string') {
        return send(res, 422, errorBody('invalid_request', 'Request fields are invalid.', 'input'));
      }
      if (state.commandDelays.transition) await new Promise(resolve => setTimeout(resolve, state.commandDelays.transition));
      const response = await atomicCommand(state, actor, req, url, body, () => {
        const fromRevision = state.ride.revision;
        if (Number(body.expectedRevision) !== fromRevision) {
          recordAudit(state, actor, {type: 'ride.transition', outcome: 'rejected', reason: 'stale_revision', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('stale_revision', 'The ride changed. Refresh before retrying.', 'stale'), revision: fromRevision}};
        }
        if (!state.driverEligibility[actor.id]) {
          recordAudit(state, actor, {type: 'ride.transition', outcome: 'rejected', reason: 'driver_unavailable', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('driver_unavailable', 'The assigned driver is no longer eligible.', 'eligibility'), revision: fromRevision}};
        }
        const next = {assigned: 'arriving', arriving: 'on_trip', on_trip: 'completed'}[state.ride.status];
        if (body.from !== state.ride.status || body.to !== next) {
          recordAudit(state, actor, {type: 'ride.transition', outcome: 'rejected', reason: 'invalid_transition', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('invalid_transition', 'The requested ride transition is not allowed.', 'transition'), revision: fromRevision}};
        }
        if (body.to === 'on_trip' && state.ride.vehicleConfirmation?.validForRevision !== fromRevision) {
          recordAudit(state, actor, {type: 'ride.transition', outcome: 'rejected', reason: 'vehicle_confirmation_required', fromRevision, toRevision: fromRevision});
          return {status: 409, body: {...errorBody('vehicle_confirmation_required', 'A current vehicle confirmation is required before starting the ride.', 'vehicle-confirmation'), revision: fromRevision}};
        }
        state.ride.status = body.to;
        state.ride.revision += 1;
        recordAudit(state, actor, {type: 'ride.transition', outcome: 'committed', fromRevision, toRevision: state.ride.revision});
        return {status: 200, body: {id: state.ride.id, status: state.ride.status, revision: state.ride.revision}};
      });
      return send(res, response.status, response.body);
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
  const mock = await startMockServer({rideStatus: 'assigned', assignedDriverId: 'driver-assigned'});
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
  const [race, validity, rideSafety, boardingRace] = await Promise.all([runConcurrencyContract(), runOfferValidityContract(), runRideSafetyContract(), runBoardingRaceContract()]);
  if (race.auditEvents.length !== 2) throw new Error('concurrent commands and exact replay did not produce exactly two audit events');
  if (race.auditEvents.filter(event => event.outcome === 'committed').length !== 1) throw new Error('race audit did not record exactly one committed command');
  if (race.auditEvents.filter(event => event.reason === 'stale_revision').length !== 1) throw new Error('race audit did not record the stale loser');
  if (validity.expired.auditEvents[0]?.reason !== 'offer_expired') throw new Error('expired selection rejection was not audited');
  if (validity.ineligible.auditEvents[0]?.reason !== 'driver_unavailable') throw new Error('eligibility rejection was not audited');
  if (validity.valid.auditEvents[0]?.outcome !== 'committed') throw new Error('successful selection was not audited');
  const events = [...race.auditEvents, ...validity.expired.auditEvents, ...validity.ineligible.auditEvents, ...validity.valid.auditEvents, ...rideSafety.auditEvents, ...boardingRace.cancelFirst.auditEvents, ...boardingRace.startFirst.auditEvents];
  for (const event of events) {
    if (Object.keys(event).join('|') !== AUDIT_FIELDS.join('|')) throw new Error(`audit event contains unexpected fields: ${Object.keys(event).join(',')}`);
  }
  const encoded = JSON.stringify(events);
  const forbidden = [...Object.values(FIXTURE.tokens), 'Idempotency-Key', 'phone', 'email', 'observedPlate', 'permit', '+679', '@'];
  if (forbidden.some(value => encoded.toLowerCase().includes(value.toLowerCase()))) throw new Error('audit events contain a credential or private input');
  return {race, validity, rideSafety, boardingRace, events};
}

async function runRideSafetyContract() {
  const mock = await startMockServer({rideStatus: 'assigned', rideRevision: 2, assignedDriverId: 'driver-assigned'});
  const transition = (key, body) => requestJson(mock.baseUrl, {
    method: 'POST', path: `/v1/rides/${FIXTURE.requestId}/transitions`, token: FIXTURE.tokens.assignedDriver,
    headers: {'Idempotency-Key': key}, body
  }, fetch);
  const confirm = (key, body) => requestJson(mock.baseUrl, {
    method: 'POST', path: `/v1/rides/${FIXTURE.requestId}/vehicle-confirmations`, token: FIXTURE.tokens.owner,
    headers: {'Idempotency-Key': key}, body
  }, fetch);
  try {
    const arrivingCommand = {from: 'assigned', to: 'arriving', expectedRevision: 2};
    const arriving = await transition('ride-arriving-0001', arrivingCommand);
    const arrivingReplay = await transition('ride-arriving-0001', arrivingCommand);
    const confirmationCommand = {observedPlate: 'ＤＥＭＯ－００１', samePerson: true, sameVehicle: true, expectedRevision: 3};
    const confirmation = await confirm('vehicle-confirm-0001', confirmationCommand);
    const confirmationReplay = await confirm('vehicle-confirm-0001', confirmationCommand);
    const mismatch = await confirm('vehicle-mismatch-0001', {observedPlate: 'DEMO 999', samePerson: true, sameVehicle: true, expectedRevision: 4});
    const startWithoutConfirmation = await transition('ride-start-blocked-0001', {from: 'arriving', to: 'on_trip', expectedRevision: 5});
    const reconfirmation = await confirm('vehicle-reconfirm-0001', {observedPlate: 'DEMO 001', samePerson: true, sameVehicle: true, expectedRevision: 5});
    mock.state.driverEligibility['driver-assigned'] = false;
    const revokedDriver = await transition('ride-start-revoked-0001', {from: 'arriving', to: 'on_trip', expectedRevision: 6});
    mock.state.driverEligibility['driver-assigned'] = true;
    const started = await transition('ride-start-0001', {from: 'arriving', to: 'on_trip', expectedRevision: 6});
    const completed = await transition('ride-complete-0001', {from: 'on_trip', to: 'completed', expectedRevision: 7});
    if (arriving.status !== 200 || arriving.body.revision !== 3 || JSON.stringify(arrivingReplay.body) !== JSON.stringify(arriving.body)) throw new Error('assigned-to-arriving transition or replay failed');
    if (confirmation.status !== 201 || confirmation.body.assignmentRevision !== 3 || JSON.stringify(confirmationReplay.body) !== JSON.stringify(confirmation.body)) throw new Error('vehicle confirmation or replay failed');
    if (mismatch.status !== 409 || mismatch.body?.code !== 'vehicle_mismatch' || mismatch.body.revision !== 5) throw new Error('vehicle mismatch did not invalidate current confirmation');
    if (startWithoutConfirmation.status !== 409 || startWithoutConfirmation.body?.code !== 'vehicle_confirmation_required') throw new Error('ride start was not blocked without current confirmation');
    if (revokedDriver.status !== 409 || revokedDriver.body?.code !== 'driver_unavailable') throw new Error('ride start did not recheck assigned driver eligibility');
    if (started.status !== 200 || started.body.status !== 'on_trip' || completed.status !== 200 || completed.body.status !== 'completed') throw new Error('confirmed eligible ride could not complete the allowed transition path');
    return {
      arriving, arrivingReplay, confirmation, confirmationReplay, mismatch, startWithoutConfirmation,
      reconfirmation, revokedDriver, started, completed,
      state: structuredClone(mock.state.ride),
      auditEvents: structuredClone(mock.state.auditEvents),
      storedKeys: mock.state.idempotency.size
    };
  } finally {
    await mock.close();
  }
}

async function runBoardingRaceCase(winner) {
  const delayLoser = winner === 'cancel' ? {transition: 15} : {cancel: 15};
  const mock = await startMockServer({
    rideStatus: 'arriving',
    rideRevision: 6,
    assignedDriverId: 'driver-assigned',
    vehicleConfirmation: {
      requestId: FIXTURE.requestId,
      assignmentRevision: 5,
      confirmedAt: '2026-09-17T03:00:00.000Z',
      validForRevision: 6
    },
    commandDelays: delayLoser
  });
  const commands = {
    cancel: {
      method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/cancel`, token: FIXTURE.tokens.owner,
      headers: {'Idempotency-Key': `boarding-race-${winner}-cancel-0001`},
      body: {expectedRevision: 6, reason: 'passenger_requested'}
    },
    start: {
      method: 'POST', path: `/v1/rides/${FIXTURE.requestId}/transitions`, token: FIXTURE.tokens.assignedDriver,
      headers: {'Idempotency-Key': `boarding-race-${winner}-start-0001`},
      body: {from: 'arriving', to: 'on_trip', expectedRevision: 6}
    }
  };
  try {
    const [cancel, start] = await Promise.all([
      requestJson(mock.baseUrl, commands.cancel, fetch),
      requestJson(mock.baseUrl, commands.start, fetch)
    ]);
    const expected = winner === 'cancel' ? {cancel: 200, start: 409} : {cancel: 409, start: 200};
    if (cancel.status !== expected.cancel || start.status !== expected.start) throw new Error(`${winner}-first boarding race produced an unexpected winner`);
    const loser = winner === 'cancel' ? start : cancel;
    if (loser.body?.code !== 'stale_revision' || loser.body?.revision !== 7) throw new Error(`${winner}-first boarding race loser did not receive current revision`);
    const winningCommand = commands[winner];
    const winningResult = winner === 'cancel' ? cancel : start;
    const replay = await requestJson(mock.baseUrl, winningCommand, fetch);
    if (replay.status !== 200 || JSON.stringify(replay.body) !== JSON.stringify(winningResult.body)) throw new Error(`${winner}-first exact replay was not stable`);
    if (mock.state.ride.revision !== 7 || mock.state.auditEvents.length !== 2) throw new Error(`${winner}-first race changed state or audit more than once`);
    if (winner === 'cancel' && mock.state.ride.vehicleConfirmation !== null) throw new Error('cancellation winner retained vehicle confirmation');
    const read = token => requestJson(mock.baseUrl, {
      method: 'GET', path: `/v1/rides/${FIXTURE.requestId}`, token
    }, fetch);
    const auditCount = mock.state.auditEvents.length;
    const storedKeys = mock.state.idempotency.size;
    const [passenger, driver, otherPassenger, otherDriver] = await Promise.all([
      read(FIXTURE.tokens.owner),
      read(FIXTURE.tokens.assignedDriver),
      read(FIXTURE.tokens.otherPassenger),
      read(FIXTURE.tokens.otherDriver)
    ]);
    if (passenger.status !== 200 || driver.status !== 200) throw new Error(`${winner}-first participants could not recover current ride state`);
    if (passenger.body.status !== mock.state.ride.status || driver.body.status !== mock.state.ride.status || passenger.body.revision !== 7 || driver.body.revision !== 7) {
      throw new Error(`${winner}-first recovery returned stale state`);
    }
    if (otherPassenger.status !== 404 || otherDriver.status !== 404) throw new Error(`${winner}-first recovery exposed the ride to a non-participant`);
    if (mock.state.auditEvents.length !== auditCount || mock.state.idempotency.size !== storedKeys || mock.state.ride.revision !== 7) {
      throw new Error(`${winner}-first recovery read mutated command state`);
    }
    return {
      winner,
      cancel,
      start,
      replay,
      recovery: {passenger, driver, otherPassenger, otherDriver},
      state: structuredClone(mock.state.ride),
      auditEvents: structuredClone(mock.state.auditEvents),
      storedKeys
    };
  } finally {
    await mock.close();
  }
}

async function runBoardingRaceContract() {
  const [cancelFirst, startFirst] = await Promise.all([
    runBoardingRaceCase('cancel'),
    runBoardingRaceCase('start')
  ]);
  return {cancelFirst, startFirst};
}

if (require.main === module) {
  Promise.all([runMockContract(), runAuditContract()]).then(([results, audit]) => {
    const {race, validity, rideSafety, boardingRace} = audit;
    const denied = results.filter(r => r.status >= 400).length;
    console.log(`HTTP contract OK: ${results.length} scenarios (${denied} safe denials, ${results.length - denied} positive controls)`);
    console.log(`HTTP race OK: ${race.winner.command} won, ${race.loser.command} received stale_revision, exact replay was stable, changed replay was rejected`);
    console.log(`HTTP validity OK: ${validity.expired.result.body.code}, exact-boundary expiry, ${validity.ineligible.result.body.code}, client clock rejected, current offer selected`);
    console.log(`HTTP ride safety OK: vehicle mismatch invalidated confirmation, unconfirmed/revoked start blocked, allowed path completed at revision ${rideSafety.state.revision}`);
    console.log(`HTTP boarding race OK: ${boardingRace.cancelFirst.winner} and ${boardingRace.startFirst.winner} each won their ordered race; every loser received stale_revision and both participants recovered current state`);
    console.log(`HTTP audit OK: ${audit.events.length} allowlisted events, no replay duplicate or private input`);
  }).catch(error => {
    console.error(`HTTP contract failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {FIXTURE, AUDIT_FIELDS, createMockHandler, scenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract, runRideSafetyContract, runBoardingRaceContract, runAuditContract, startMockServer};
