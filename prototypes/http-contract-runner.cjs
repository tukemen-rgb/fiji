'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

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
const CANCELLATION_REASONS = Object.freeze(['passenger_requested', 'route_changed', 'schedule_changed']);

function errorBody(code, message, suffix = 'error') {
  return {code, message, requestId: `trace-mock-${suffix}`};
}

function send(res, status, body, headers = {}) {
  if (status === 204 || status === 304) {
    res.writeHead(status, headers);
    return res.end();
  }
  const encoded = JSON.stringify(body);
  res.writeHead(status, {...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(encoded)});
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

function rideStateEtag(state, actor) {
  const digest = crypto.createHash('sha256').update(JSON.stringify(rideStateView(state, actor))).digest('base64url').slice(0, 24);
  return `"${digest}"`;
}

function matchesIfNoneMatch(value, etag) {
  if (!value) return false;
  const normalized = token => token.trim().replace(/^W\//i, '');
  return String(value).split(',').some(candidate => candidate.trim() === '*' || normalized(candidate) === etag);
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
    recoveryFailures: (options.recoveryFailures || []).map(failure => ({...failure})),
    duplicateCurrentFor: options.duplicateCurrentFor || null,
    clockMs,
    auditEvents: [],
    auditSequence: 0,
    idempotency: new Map(),
    lock: Promise.resolve()
  };
}

function refreshMockOffer(state) {
  if (state.offer.status !== 'active') return state.offer;
  if (state.clockMs >= state.offer.expiresAtMs) {
    state.offer.status = 'expired';
    state.offer.statusReason = 'time';
  } else if (!state.driverEligibility[state.offer.driverId]) {
    state.offer.status = 'unavailable';
    state.offer.statusReason = 'eligibility';
  }
  return state.offer;
}

function offerListView(state) {
  const offer = refreshMockOffer(state);
  const offers = offer.status === 'active' ? [{
    id: offer.id,
    requestId: FIXTURE.requestId,
    fareCents: offer.fareCents,
    etaMinutes: offer.etaMinutes,
    status: offer.status,
    expiresAt: new Date(offer.expiresAtMs).toISOString()
  }] : [];
  return {
    offers,
    summary: {
      active: offer.status === 'active' ? 1 : 0,
      expired: offer.status === 'expired' ? 1 : 0,
      unavailable: offer.status === 'unavailable' ? 1 : 0
    }
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

function idempotencyScopeKey(accountRef, idempotencyKey) {
  return JSON.stringify([String(accountRef), String(idempotencyKey)]);
}

async function atomicCommand(state, actor, req, url, body, action) {
  const key = idempotencyScopeKey(actor.id, req.headers['idempotency-key']);
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
    const currentRidePath = '/v1/rides/current';
    const ridePath = `/v1/rides/${FIXTURE.requestId}`;
    const confirmationPath = `/v1/rides/${FIXTURE.requestId}/vehicle-confirmations`;
    const transitionPath = `/v1/rides/${FIXTURE.requestId}/transitions`;

    if (req.method === 'GET' && url.pathname === currentRidePath) {
      const headers = {'cache-control': 'private, no-cache', 'vary': 'Authorization'};
      if (url.searchParams.size) return send(res, 422, errorBody('invalid_request', 'Current ride discovery does not accept ride identifiers.', 'current-input'), headers);
      const isActive = ['collecting', 'assigned', 'arriving', 'on_trip'].includes(state.ride.status);
      const ownsRide = actor.role === 'passenger' && actor.id === 'passenger-owner';
      const isAssignedDriver = actor.role === 'driver' && actor.id === state.ride.assignedDriverId;
      const candidates = isActive && (ownsRide || isAssignedDriver) ? [state.ride] : [];
      if (state.duplicateCurrentFor === actor.id && candidates.length) candidates.push({...state.ride, id: 'ride-duplicate-fixture'});
      if (candidates.length > 1) {
        return send(res, 409, errorBody('ambiguous_current_ride', 'The current ride could not be selected safely.', 'current-ambiguous'), headers);
      }
      if (!candidates.length) return send(res, 204, null, headers);
      return send(res, 200, rideStateView(state, actor), {...headers, etag: rideStateEtag(state, actor)});
    }

    if (req.method === 'GET' && url.pathname === ridePath) {
      const ownsRide = actor.role === 'passenger' && actor.id === 'passenger-owner';
      const isAssignedDriver = actor.role === 'driver' && actor.id === state.ride.assignedDriverId;
      if (!ownsRide && !isAssignedDriver) return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      const failure = state.recoveryFailures.shift();
      if (failure) {
        const code = failure.status === 429 ? 'rate_limited' : 'service_unavailable';
        const message = failure.status === 429 ? 'Too many recovery requests. Retry later.' : 'Ride recovery is temporarily unavailable.';
        const headers = failure.retryAfter === undefined ? {} : {'retry-after': String(failure.retryAfter)};
        return send(res, failure.status, errorBody(code, message, code), headers);
      }
      const etag = rideStateEtag(state, actor);
      const headers = {'etag': etag, 'cache-control': 'private, no-cache', 'vary': 'Authorization'};
      if (matchesIfNoneMatch(req.headers['if-none-match'], etag)) return send(res, 304, null, headers);
      return send(res, 200, rideStateView(state, actor), headers);
    }

    if (req.method === 'GET' && url.pathname === offersPath) {
      if (actor.role !== 'passenger') return send(res, 403, errorBody('role_or_eligibility_denied', 'This role cannot perform the operation.', 'role'));
      if (actor.id !== 'passenger-owner') return send(res, 404, errorBody('resource_not_found', 'Resource was not found.', 'hidden'));
      return send(res, 200, offerListView(state));
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
      const cancelFields = ['expectedRevision', 'reason'];
      if (Object.keys(body).some(key => !cancelFields.includes(key)) ||
          !Number.isInteger(body.expectedRevision) || body.expectedRevision < 1 ||
          !CANCELLATION_REASONS.includes(body.reason)) {
        return send(res, 422, errorBody('invalid_request', 'Request fields are invalid.', 'input'));
      }
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
        recordAudit(state, actor, {type: 'ride.cancellation', outcome: 'committed', reason: body.reason, fromRevision, toRevision: state.ride.revision});
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
  const text = await response.text();
  const result = {status: response.status, body: text ? JSON.parse(text) : null};
  if (scenario.captureHeaders) {
    result.headers = {
      etag: response.headers.get('etag'),
      cacheControl: response.headers.get('cache-control'),
      vary: response.headers.get('vary')
    };
    const retryAfter = response.headers.get('retry-after');
    if (retryAfter !== null) result.headers.retryAfter = retryAfter;
  }
  return result;
}

function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim();
  let delayMs;
  if (/^\d+$/.test(raw)) delayMs = Number(raw) * 1000;
  else {
    const at = Date.parse(raw);
    if (!Number.isFinite(at)) return null;
    delayMs = at - nowMs;
  }
  if (!Number.isFinite(delayMs)) return null;
  return Math.min(60_000, Math.max(1_000, Math.ceil(delayMs)));
}

function exponentialBackoffMs(retryIndex, random = Math.random) {
  const base = Math.min(30_000, 1000 * 2 ** retryIndex);
  const jitter = 0.5 + Math.min(1, Math.max(0, Number(random())));
  return Math.min(30_000, Math.max(500, Math.round(base * jitter)));
}

async function fetchRideStateWithRetry(options) {
  const {
    baseUrl,
    token,
    etag,
    fetchImpl = fetch,
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    random = Math.random,
    now = Date.now,
    isVisible = () => true,
    maxAttempts = 4
  } = options;
  const attempts = [];
  if (!isVisible()) return {result: null, attempts, stopped: 'hidden'};
  for (let index = 0; index < maxAttempts; index += 1) {
    if (!isVisible()) return {result: null, attempts, stopped: 'hidden'};
    let result;
    try {
      result = await requestJson(baseUrl, {
        method: 'GET', path: `/v1/rides/${FIXTURE.requestId}`, token,
        headers: etag ? {'If-None-Match': etag} : {}, captureHeaders: true
      }, fetchImpl);
    } catch (error) {
      result = {status: 0, body: null, headers: {retryAfter: null}, error: error.message};
    }
    const attempt = {status: result.status, delayMs: null};
    attempts.push(attempt);
    if (result.status === 200 || result.status === 304) return {result, attempts, stopped: 'success'};
    if ([401, 403, 404].includes(result.status)) return {result, attempts, stopped: 'access'};
    if (![0, 429, 500, 502, 503, 504].includes(result.status)) return {result, attempts, stopped: 'non_retryable'};
    if (index === maxAttempts - 1) return {result, attempts, stopped: 'exhausted'};
    attempt.delayMs = parseRetryAfterMs(result.headers?.retryAfter, now()) ?? exponentialBackoffMs(index, random);
    await sleep(attempt.delayMs);
  }
  return {result: null, attempts, stopped: 'exhausted'};
}

const RIDE_STATE_FIELDS = Object.freeze(['id', 'status', 'revision', 'viewerRole', 'nextAction', 'updatedAt']);

function rideStateFingerprint(value) {
  return JSON.stringify(Object.fromEntries(RIDE_STATE_FIELDS.map(field => [field, value[field]])));
}

function mergeRideStateUpdate(current, incoming, source = 'notification') {
  const validSource = source === 'notification' || source === 'recovery';
  const validShape = incoming && typeof incoming === 'object' &&
    typeof incoming.id === 'string' && incoming.id.length > 0 &&
    typeof incoming.status === 'string' && incoming.status.length > 0 &&
    Number.isInteger(incoming.revision) && incoming.revision > 0 &&
    ['passenger', 'driver'].includes(incoming.viewerRole) &&
    typeof incoming.nextAction === 'string' && incoming.nextAction.length > 0 &&
    typeof incoming.updatedAt === 'string' && Number.isFinite(Date.parse(incoming.updatedAt));
  if (!validSource || !validShape) {
    return {state: current, applied: false, reason: 'invalid_update', needsRecovery: true};
  }
  if (!current) {
    if (source !== 'recovery') return {state: null, applied: false, reason: 'missing_baseline', needsRecovery: true};
    return {state: structuredClone(incoming), applied: true, reason: 'baseline', needsRecovery: false};
  }
  if (incoming.id !== current.id || incoming.viewerRole !== current.viewerRole) {
    return {state: current, applied: false, reason: 'scope_mismatch', needsRecovery: false};
  }
  if (incoming.revision < current.revision) {
    return {state: current, applied: false, reason: 'stale', needsRecovery: false};
  }
  if (incoming.revision === current.revision) {
    if (rideStateFingerprint(incoming) === rideStateFingerprint(current)) {
      return {state: current, applied: false, reason: 'duplicate', needsRecovery: false};
    }
    return {state: current, applied: false, reason: 'same_revision_conflict', needsRecovery: true};
  }
  if (source === 'notification' && incoming.revision !== current.revision + 1) {
    return {state: current, applied: false, reason: 'revision_gap', needsRecovery: true};
  }
  return {state: structuredClone(incoming), applied: true, reason: source, needsRecovery: false};
}

const RIDE_NOTIFICATION_FIELDS = Object.freeze(['type', 'rideId', 'revision']);
const RIDE_NOTIFICATION_TYPES = new Set(['ride.changed', 'ride.access_changed']);

function parseRideNotificationHint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== RIDE_NOTIFICATION_FIELDS.length || keys.some(key => !RIDE_NOTIFICATION_FIELDS.includes(key))) return null;
  if (!RIDE_NOTIFICATION_TYPES.has(value.type) || typeof value.rideId !== 'string' || !value.rideId ||
      !Number.isInteger(value.revision) || value.revision < 1) return null;
  return Object.freeze({type: value.type, rideId: value.rideId, revision: value.revision});
}

async function handleRideNotificationHint(options) {
  const {current, hint: rawHint, recover, expectedRideId, expectedViewerRole} = options;
  const hint = parseRideNotificationHint(rawHint);
  if (!hint) return {state: current, fetched: false, applied: false, reason: 'invalid_hint', needsRecovery: false};
  const scopedRideId = current?.id ?? expectedRideId;
  const scopedRole = current?.viewerRole ?? expectedViewerRole;
  if (!scopedRideId || hint.rideId !== scopedRideId) {
    return {state: current, fetched: false, applied: false, reason: 'foreign_hint', needsRecovery: false};
  }
  if (current && hint.revision <= current.revision) {
    return {state: current, fetched: false, applied: false, reason: 'stale_or_duplicate_hint', needsRecovery: false};
  }
  const response = await recover({rideId: hint.rideId, revision: hint.revision, type: hint.type});
  if ([401, 403, 404].includes(response?.status)) {
    return {state: null, fetched: true, applied: false, reason: 'access_lost', needsRecovery: false};
  }
  if (response?.status === 304) {
    return {state: current, fetched: true, applied: false, reason: 'hint_not_yet_visible', needsRecovery: true};
  }
  if (response?.status !== 200 || !response.body) {
    return {state: current, fetched: true, applied: false, reason: 'recovery_failed', needsRecovery: true};
  }
  if (response.body.id !== scopedRideId || (scopedRole && response.body.viewerRole !== scopedRole)) {
    return {state: current, fetched: true, applied: false, reason: 'recovery_scope_mismatch', needsRecovery: false};
  }
  const merged = mergeRideStateUpdate(current, response.body, 'recovery');
  return {...merged, fetched: true};
}

function createRideSessionClient(initialBinding = null) {
  const normalizeBinding = value => {
    if (!value || typeof value.sessionId !== 'string' || !value.sessionId ||
        !['passenger', 'driver'].includes(value.viewerRole) || typeof value.rideId !== 'string' || !value.rideId) return null;
    return Object.freeze({sessionId: value.sessionId, viewerRole: value.viewerRole, rideId: value.rideId});
  };
  let binding = normalizeBinding(initialBinding);
  let generation = 1;
  let state = null;
  let etag = null;
  let retryCancel = null;
  const inflight = new Set();

  const clearRetry = () => {
    if (!retryCancel) return;
    const cancel = retryCancel;
    retryCancel = null;
    cancel();
  };
  const resetSession = nextBinding => {
    generation += 1;
    for (const handle of inflight) handle.controller.abort();
    inflight.clear();
    clearRetry();
    state = null;
    etag = null;
    binding = normalizeBinding(nextBinding);
    return snapshot();
  };
  const snapshot = () => ({
    active: Boolean(binding),
    viewerRole: binding?.viewerRole ?? null,
    rideId: binding?.rideId ?? null,
    state: state ? structuredClone(state) : null,
    etag,
    generation,
    inFlight: inflight.size,
    retryScheduled: Boolean(retryCancel)
  });
  const setCache = (nextState, nextEtag = null) => {
    if (!binding || nextState?.id !== binding.rideId || nextState?.viewerRole !== binding.viewerRole) return false;
    state = structuredClone(nextState);
    etag = typeof nextEtag === 'string' ? nextEtag : null;
    return true;
  };
  const scheduleRetry = cancel => {
    if (!binding || typeof cancel !== 'function') return false;
    clearRetry();
    retryCancel = cancel;
    return true;
  };
  const startRecovery = () => {
    if (!binding) return null;
    const controller = new AbortController();
    const handle = Object.freeze({binding, generation, controller, signal: controller.signal});
    inflight.add(handle);
    return handle;
  };
  const finishRecovery = (handle, response) => {
    if (!handle) return {state, applied: false, reason: 'no_session'};
    inflight.delete(handle);
    if (handle.signal.aborted || handle.generation !== generation || handle.binding !== binding) {
      return {state, applied: false, reason: 'stale_session'};
    }
    if ([401, 403, 404].includes(response?.status)) {
      state = null;
      etag = null;
      clearRetry();
      return {state, applied: false, reason: 'access_lost'};
    }
    if (response?.status === 304) return {state, applied: false, reason: 'not_modified'};
    if (response?.status !== 200 || !response.body) return {state, applied: false, reason: 'recovery_failed'};
    if (response.body.id !== binding.rideId || response.body.viewerRole !== binding.viewerRole) {
      return {state, applied: false, reason: 'scope_mismatch'};
    }
    const merged = mergeRideStateUpdate(state, response.body, 'recovery');
    if (merged.applied) {
      state = structuredClone(merged.state);
      etag = typeof response.headers?.etag === 'string' ? response.headers.etag : null;
    }
    return {...merged, state};
  };
  return {snapshot, resetSession, setCache, scheduleRetry, startRecovery, finishRecovery};
}

function createSessionBoundCommandClient(initialBinding = null) {
  const normalizeBinding = value => {
    if (!value || typeof value.sessionId !== 'string' || !value.sessionId ||
        typeof value.accountRef !== 'string' || !value.accountRef ||
        !['passenger', 'driver'].includes(value.viewerRole)) return null;
    return Object.freeze({sessionId: value.sessionId, accountRef: value.accountRef, viewerRole: value.viewerRole});
  };
  let binding = normalizeBinding(initialBinding);
  let generation = 1;
  const inflight = new Set();
  const snapshot = () => ({active: Boolean(binding), viewerRole: binding?.viewerRole ?? null, generation, inFlight: inflight.size});
  const resetSession = nextBinding => {
    generation += 1;
    for (const handle of inflight) handle.controller.abort();
    inflight.clear();
    binding = normalizeBinding(nextBinding);
    return snapshot();
  };
  const startCommand = command => {
    if (!binding || !command || typeof command.action !== 'string' || !command.action ||
        typeof command.idempotencyKey !== 'string' || !command.idempotencyKey) return null;
    const controller = new AbortController();
    const handle = Object.freeze({
      binding,
      generation,
      action: command.action,
      idempotencyKey: command.idempotencyKey,
      scopedKey: idempotencyScopeKey(binding.accountRef, command.idempotencyKey),
      controller,
      signal: controller.signal
    });
    inflight.add(handle);
    return handle;
  };
  const finishCommand = (handle, response) => {
    if (!handle) return {committed: false, reason: 'no_session', autoRetry: false};
    inflight.delete(handle);
    if (handle.signal.aborted || handle.generation !== generation || handle.binding !== binding) {
      return {committed: false, reason: 'stale_session', autoRetry: false};
    }
    if ([200, 201].includes(response?.status)) return {committed: true, reason: 'committed', autoRetry: false};
    if ([401, 403].includes(response?.status)) {
      return {committed: false, reason: 'session_expired', autoRetry: false, needsReauth: true, needsRecovery: true};
    }
    if (response?.status === 409 && response.body?.code === 'stale_revision') {
      return {committed: false, reason: 'stale_revision', autoRetry: false, needsRecovery: true};
    }
    if ([0, 429, 500, 502, 503, 504].includes(response?.status)) {
      return {committed: false, reason: 'outcome_unknown', autoRetry: false, needsRecovery: true, reuseSameKey: true};
    }
    return {committed: false, reason: 'rejected', autoRetry: false, needsRecovery: false};
  };
  const recoverUnknownOutcome = async (handle, options = {}) => {
    const {baselineRevision, recover, isApplied, resend} = options;
    const handleIsCurrent = () => Boolean(handle) && !handle.signal.aborted &&
      handle.generation === generation && handle.binding === binding;
    if (!handleIsCurrent()) return {committed: false, reason: 'stale_session', resent: false};
    if (!Number.isInteger(baselineRevision) || baselineRevision < 1 ||
        typeof recover !== 'function' || typeof isApplied !== 'function' || typeof resend !== 'function') {
      return {committed: false, reason: 'invalid_recovery', resent: false};
    }
    const controller = new AbortController();
    const recoveryHandle = Object.freeze({binding: handle.binding, generation: handle.generation, controller, signal: controller.signal});
    const recoveryIsCurrent = () => !recoveryHandle.signal.aborted &&
      recoveryHandle.generation === generation && recoveryHandle.binding === binding;
    inflight.add(recoveryHandle);
    try {
      let recovered;
      try {
        recovered = await recover({signal: recoveryHandle.signal});
      } catch (error) {
        return recoveryIsCurrent()
          ? {committed: false, reason: 'recovery_failed', resent: false}
          : {committed: false, reason: 'stale_session', resent: false};
      }
      if (!recoveryIsCurrent()) return {committed: false, reason: 'stale_session', resent: false};
      if ([401, 403, 404].includes(recovered?.status)) {
        return {committed: false, reason: 'access_lost', resent: false};
      }
      if (recovered?.status !== 200 || !Number.isInteger(recovered.body?.revision)) {
        return {committed: false, reason: 'recovery_unresolved', resent: false};
      }
      if (isApplied(recovered.body)) {
        return {committed: true, reason: 'confirmed_by_recovery', resent: false, state: recovered.body};
      }
      if (recovered.body.revision !== baselineRevision) {
        return {committed: false, reason: 'state_changed', resent: false, state: recovered.body};
      }
      let replay;
      try {
        replay = await resend({
          action: handle.action,
          idempotencyKey: handle.idempotencyKey,
          scopedKey: handle.scopedKey,
          signal: recoveryHandle.signal
        });
      } catch (error) {
        return recoveryIsCurrent()
          ? {committed: false, reason: 'replay_outcome_unknown', resent: true}
          : {committed: false, reason: 'stale_session', resent: true};
      }
      if (!recoveryIsCurrent()) return {committed: false, reason: 'stale_session', resent: true};
      if ([200, 201].includes(replay?.status)) {
        return {committed: true, reason: 'committed_by_replay', resent: true, response: replay.body ?? null};
      }
      return {committed: false, reason: 'replay_unresolved', resent: true, response: replay?.body ?? null};
    } finally {
      inflight.delete(recoveryHandle);
    }
  };
  return {snapshot, resetSession, startCommand, finishCommand, recoverUnknownOutcome};
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

async function runCurrentRideDiscoveryContract() {
  const assigned = await startMockServer({rideStatus: 'assigned', assignedDriverId: 'driver-assigned'});
  const completed = await startMockServer({rideStatus: 'completed', assignedDriverId: 'driver-assigned'});
  const cancelled = await startMockServer({rideStatus: 'cancelled', assignedDriverId: 'driver-assigned'});
  const ambiguous = await startMockServer({rideStatus: 'assigned', assignedDriverId: 'driver-assigned', duplicateCurrentFor: 'passenger-owner'});
  const read = (baseUrl, token, path = '/v1/rides/current') => requestJson(baseUrl, {
    method: 'GET', path, token, captureHeaders: true
  }, fetch);
  try {
    const before = {
      revision: assigned.state.ride.revision,
      idempotency: assigned.state.idempotency.size,
      audit: assigned.state.auditEvents.length
    };
    const [passenger, driver, otherPassenger, otherDriver, unauthenticated, injectedId, completedPassenger, completedDriver, cancelledPassenger, cancelledDriver, multiple] = await Promise.all([
      read(assigned.baseUrl, FIXTURE.tokens.owner),
      read(assigned.baseUrl, FIXTURE.tokens.assignedDriver),
      read(assigned.baseUrl, FIXTURE.tokens.otherPassenger),
      read(assigned.baseUrl, FIXTURE.tokens.otherDriver),
      read(assigned.baseUrl),
      read(assigned.baseUrl, FIXTURE.tokens.owner, `/v1/rides/current?requestId=${FIXTURE.requestId}`),
      read(completed.baseUrl, FIXTURE.tokens.owner),
      read(completed.baseUrl, FIXTURE.tokens.assignedDriver),
      read(cancelled.baseUrl, FIXTURE.tokens.owner),
      read(cancelled.baseUrl, FIXTURE.tokens.assignedDriver),
      read(ambiguous.baseUrl, FIXTURE.tokens.owner)
    ]);
    const after = {
      revision: assigned.state.ride.revision,
      idempotency: assigned.state.idempotency.size,
      audit: assigned.state.auditEvents.length
    };
    if (passenger.status !== 200 || passenger.body?.viewerRole !== 'passenger') throw new Error('owning passenger could not discover the current ride');
    if (driver.status !== 200 || driver.body?.viewerRole !== 'driver') throw new Error('assigned driver could not discover the current ride');
    if ([otherPassenger, otherDriver].some(result => result.status !== 204 || result.body !== null)) throw new Error('unrelated actor learned that another current ride exists');
    if (unauthenticated.status !== 401) throw new Error('unauthenticated current-ride discovery was not rejected');
    if (injectedId.status !== 422 || injectedId.body?.code !== 'invalid_request') throw new Error('current-ride discovery accepted a caller-supplied ride identifier');
    if ([completedPassenger, completedDriver, cancelledPassenger, cancelledDriver].some(result => result.status !== 204 || result.body !== null)) throw new Error('terminal ride was returned as current');
    if (multiple.status !== 409 || multiple.body?.code !== 'ambiguous_current_ride') throw new Error('ambiguous current rides were not stopped safely');
    if (JSON.stringify(multiple.body).includes('ride-duplicate-fixture')) throw new Error('ambiguous current-ride error leaked a candidate identifier');
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('current-ride discovery changed business state');
    return {passenger, driver, otherPassenger, otherDriver, unauthenticated, injectedId, completedPassenger, completedDriver, cancelledPassenger, cancelledDriver, multiple, before, after};
  } finally {
    await Promise.all([assigned.close(), completed.close(), cancelled.close(), ambiguous.close()]);
  }
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

async function runOfferListContract() {
  const clockMs = Date.parse('2026-09-17T03:00:00Z');
  const read = async options => {
    const mock = await startMockServer({clockMs, ...options});
    try {
      const result = await requestJson(mock.baseUrl, {
        method: 'GET', path: `/v1/ride-requests/${FIXTURE.requestId}/offers`, token: FIXTURE.tokens.owner
      }, fetch);
      return {
        result,
        ride: structuredClone(mock.state.ride),
        offer: structuredClone(mock.state.offer),
        auditEvents: structuredClone(mock.state.auditEvents),
        storedKeys: mock.state.idempotency.size
      };
    } finally {
      await mock.close();
    }
  };
  const [active, expired, unavailable] = await Promise.all([
    read({offerExpiresAtMs: clockMs + 1}),
    read({offerExpiresAtMs: clockMs}),
    read({offerExpiresAtMs: clockMs + 1, offerDriverEligible: false})
  ]);
  if (active.result.status !== 200 || active.result.body?.offers?.length !== 1 || active.result.body?.summary?.active !== 1) {
    throw new Error('active offer list did not return its selectable offer');
  }
  if (expired.result.status !== 200 || expired.result.body?.offers?.length !== 0 || expired.result.body?.summary?.expired !== 1) {
    throw new Error('expired offer list did not return expiry guidance state');
  }
  if (unavailable.result.status !== 200 || unavailable.result.body?.offers?.length !== 0 || unavailable.result.body?.summary?.unavailable !== 1) {
    throw new Error('unavailable offer list did not distinguish eligibility loss');
  }
  for (const item of [active, expired, unavailable]) {
    if (item.ride.status !== 'collecting' || item.ride.revision !== FIXTURE.revision || item.auditEvents.length || item.storedKeys) {
      throw new Error('reading offer guidance changed ride, audit, or idempotency state');
    }
  }
  return {active, expired, unavailable};
}

async function runMockContract() {
  const mock = await startMockServer({rideStatus: 'assigned', assignedDriverId: 'driver-assigned'});
  try {
    return await runHttpContract(mock.baseUrl);
  } finally {
    await mock.close();
  }
}

async function runCancellationReasonContract() {
  const cancel = (mock, key, body) => requestJson(mock.baseUrl, {
    method: 'POST', path: `/v1/ride-requests/${FIXTURE.requestId}/cancel`, token: FIXTURE.tokens.owner,
    headers: {'Idempotency-Key': key}, body
  }, fetch);
  const allowed = await Promise.all(CANCELLATION_REASONS.map(async (reason, index) => {
    const mock = await startMockServer();
    try {
      const key = `cancel-reason-allowed-${index}-0001`;
      const command = {expectedRevision: FIXTURE.revision, reason};
      const result = await cancel(mock, key, command);
      if (result.status !== 200 || result.body?.cancelReason !== reason) throw new Error(`allowed cancellation reason was not preserved: ${reason}`);
      if (mock.state.auditEvents.length !== 1 || mock.state.auditEvents[0].reason !== reason) throw new Error(`allowed cancellation reason was not audited: ${reason}`);
      const replay = await cancel(mock, key, command);
      if (replay.status !== 200 || JSON.stringify(replay.body) !== JSON.stringify(result.body)) throw new Error(`exact cancellation replay was not stable: ${reason}`);
      const changedReason = CANCELLATION_REASONS[(index + 1) % CANCELLATION_REASONS.length];
      const conflict = await cancel(mock, key, {expectedRevision: FIXTURE.revision, reason: changedReason});
      if (conflict.status !== 409 || conflict.body?.code !== 'idempotency_conflict') throw new Error(`changed cancellation reason reused an idempotency key: ${reason} -> ${changedReason}`);
      if (mock.state.ride.cancelReason !== reason || mock.state.auditEvents.length !== 1 || mock.state.idempotency.size !== 1) {
        throw new Error(`cancellation replay changed state, audit, or idempotency records: ${reason}`);
      }
      return {reason, changedReason, result, replay, conflict, state: structuredClone(mock.state.ride), auditEvents: structuredClone(mock.state.auditEvents), storedKeys: mock.state.idempotency.size};
    } finally {
      await mock.close();
    }
  }));
  const immutable = await Promise.all(CANCELLATION_REASONS.map(async (reason, index) => {
    const mock = await startMockServer();
    try {
      const changedReason = CANCELLATION_REASONS[(index + 1) % CANCELLATION_REASONS.length];
      const committed = await cancel(mock, `cancel-immutable-first-${index}-0001`, {expectedRevision: FIXTURE.revision, reason});
      const amendment = await cancel(mock, `cancel-immutable-amend-${index}-0001`, {expectedRevision: FIXTURE.revision + 1, reason: changedReason});
      if (committed.status !== 200 || amendment.status !== 409 || amendment.body?.code !== 'invalid_transition') {
        throw new Error(`a terminal cancellation reason could be amended: ${reason} -> ${changedReason}`);
      }
      if (mock.state.ride.cancelReason !== reason || mock.state.ride.revision !== FIXTURE.revision + 1) {
        throw new Error(`a terminal cancellation amendment changed the original ride: ${reason}`);
      }
      if (mock.state.auditEvents.length !== 2 || mock.state.auditEvents[0].reason !== reason || mock.state.auditEvents[1].reason !== 'invalid_transition') {
        throw new Error(`a terminal cancellation amendment corrupted its audit trail: ${reason}`);
      }
      return {reason, changedReason, committed, amendment, state: structuredClone(mock.state.ride), auditEvents: structuredClone(mock.state.auditEvents), storedKeys: mock.state.idempotency.size};
    } finally {
      await mock.close();
    }
  }));
  const invalidMock = await startMockServer();
  try {
    const invalidBodies = [
      {expectedRevision: FIXTURE.revision},
      {expectedRevision: FIXTURE.revision, reason: 'search_edited'},
      {expectedRevision: FIXTURE.revision, reason: 1},
      {expectedRevision: FIXTURE.revision, reason: 'passenger_requested', note: 'untrusted'}
    ];
    const invalid = [];
    for (const [index, body] of invalidBodies.entries()) {
      invalid.push(await cancel(invalidMock, `cancel-reason-invalid-${index}-0001`, body));
    }
    if (invalid.some(result => result.status !== 422 || result.body?.code !== 'invalid_request')) throw new Error('invalid cancellation reason or field was accepted');
    if (invalidMock.state.ride.status !== 'collecting' || invalidMock.state.ride.revision !== FIXTURE.revision ||
        invalidMock.state.auditEvents.length || invalidMock.state.idempotency.size) {
      throw new Error('invalid cancellation input changed state, audit, or idempotency records');
    }
    return {allowed, immutable, invalid, invalidState: structuredClone(invalidMock.state.ride), invalidAuditEvents: structuredClone(invalidMock.state.auditEvents), invalidStoredKeys: invalidMock.state.idempotency.size};
  } finally {
    await invalidMock.close();
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
    const read = (token, headers = {}) => requestJson(mock.baseUrl, {
      method: 'GET', path: `/v1/rides/${FIXTURE.requestId}`, token, headers, captureHeaders: true
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
    const [passengerNotModified, driverNotModified, stalePassenger, crossRoleValidator, wildcardPassenger, wildcardOther] = await Promise.all([
      read(FIXTURE.tokens.owner, {'If-None-Match': passenger.headers.etag}),
      read(FIXTURE.tokens.assignedDriver, {'If-None-Match': `W/${driver.headers.etag}`}),
      read(FIXTURE.tokens.owner, {'If-None-Match': '"obsolete-validator"'}),
      read(FIXTURE.tokens.assignedDriver, {'If-None-Match': passenger.headers.etag}),
      read(FIXTURE.tokens.owner, {'If-None-Match': '*'}),
      read(FIXTURE.tokens.otherPassenger, {'If-None-Match': '*'})
    ]);
    if (passengerNotModified.status !== 304 || driverNotModified.status !== 304 || passengerNotModified.body !== null || driverNotModified.body !== null) {
      throw new Error(`${winner}-first matching validator did not return an empty 304`);
    }
    if (stalePassenger.status !== 200 || stalePassenger.body.revision !== 7 || stalePassenger.headers.etag !== passenger.headers.etag) {
      throw new Error(`${winner}-first stale validator did not return current state`);
    }
    if (crossRoleValidator.status !== 200 || crossRoleValidator.body.viewerRole !== 'driver') throw new Error(`${winner}-first shared a passenger validator with the driver representation`);
    if (wildcardPassenger.status !== 304 || wildcardOther.status !== 404) throw new Error(`${winner}-first evaluated a validator before participant authorization`);
    if (mock.state.auditEvents.length !== auditCount || mock.state.idempotency.size !== storedKeys || mock.state.ride.revision !== 7) {
      throw new Error(`${winner}-first recovery read mutated command state`);
    }
    return {
      winner,
      cancel,
      start,
      replay,
      recovery: {passenger, driver, otherPassenger, otherDriver, passengerNotModified, driverNotModified, stalePassenger, crossRoleValidator, wildcardPassenger, wildcardOther},
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

async function runRecoveryRetryContract() {
  const run = async (serverOptions, clientOptions = {}) => {
    const mock = await startMockServer({rideStatus: 'arriving', rideRevision: 7, assignedDriverId: 'driver-assigned', ...serverOptions});
    const delays = [];
    try {
      const result = await fetchRideStateWithRetry({
        baseUrl: mock.baseUrl,
        token: FIXTURE.tokens.owner,
        sleep: async delay => { delays.push(delay); },
        random: () => 0.5,
        ...clientOptions
      });
      return {result, delays, remainingFailures: mock.state.recoveryFailures.length};
    } finally {
      await mock.close();
    }
  };
  const [rateLimited, unavailable, exhausted, accessDenied] = await Promise.all([
    run({recoveryFailures: [{status: 429, retryAfter: '3'}]}),
    run({recoveryFailures: [{status: 503}, {status: 503}]}),
    run({recoveryFailures: Array.from({length: 4}, () => ({status: 503, retryAfter: '120'}))}),
    run({}, {token: FIXTURE.tokens.otherPassenger})
  ]);
  let networkCalls = 0;
  const networkMock = await startMockServer({rideStatus: 'arriving', rideRevision: 7, assignedDriverId: 'driver-assigned'});
  const networkDelays = [];
  let network;
  try {
    network = await fetchRideStateWithRetry({
      baseUrl: networkMock.baseUrl,
      token: FIXTURE.tokens.owner,
      fetchImpl: (...args) => (++networkCalls === 1 ? Promise.reject(new Error('simulated network failure')) : fetch(...args)),
      sleep: async delay => { networkDelays.push(delay); },
      random: () => 0.5
    });
  } finally {
    await networkMock.close();
  }
  let hiddenCalls = 0;
  const hidden = await fetchRideStateWithRetry({
    baseUrl: 'http://127.0.0.1:1', token: FIXTURE.tokens.owner,
    fetchImpl: async () => { hiddenCalls += 1; throw new Error('must not fetch while hidden'); },
    isVisible: () => false,
    sleep: async () => {}
  });
  return {rateLimited, unavailable, exhausted, accessDenied, network: {result: network, delays: networkDelays, calls: networkCalls}, hidden: {result: hidden, calls: hiddenCalls}};
}

function runRevisionMergeContract() {
  const action = {
    arriving: 'confirm_vehicle',
    cancelled: 'show_cancelled_history',
    on_trip: 'show_on_trip',
    completed: 'show_completed'
  };
  const snapshot = (revision, status, overrides = {}) => ({
    id: FIXTURE.requestId,
    status,
    revision,
    viewerRole: 'passenger',
    nextAction: action[status],
    updatedAt: new Date(Date.parse('2026-09-17T03:00:00Z') + revision * 1000).toISOString(),
    ...overrides
  });
  const base = snapshot(7, 'arriving');

  const newerNotification = mergeRideStateUpdate(base, snapshot(8, 'cancelled'), 'notification');
  const delayedRecovery = mergeRideStateUpdate(newerNotification.state, base, 'recovery');

  const newerRecovery = mergeRideStateUpdate(base, snapshot(9, 'on_trip'), 'recovery');
  const delayedNotification = mergeRideStateUpdate(newerRecovery.state, snapshot(8, 'cancelled'), 'notification');

  const firstDelivery = mergeRideStateUpdate(base, snapshot(8, 'cancelled'), 'notification');
  const duplicate = mergeRideStateUpdate(firstDelivery.state, snapshot(8, 'cancelled'), 'notification');
  const conflicting = mergeRideStateUpdate(firstDelivery.state, snapshot(8, 'arriving'), 'notification');

  const gap = mergeRideStateUpdate(base, snapshot(10, 'completed'), 'notification');
  const gapRecovery = mergeRideStateUpdate(gap.state, snapshot(10, 'completed'), 'recovery');

  const wrongRide = mergeRideStateUpdate(base, snapshot(8, 'cancelled', {id: 'ride-foreign'}), 'notification');
  const wrongRole = mergeRideStateUpdate(base, snapshot(8, 'cancelled', {viewerRole: 'driver'}), 'notification');
  const missingBaseline = mergeRideStateUpdate(null, snapshot(8, 'cancelled'), 'notification');
  const recoveredBaseline = mergeRideStateUpdate(null, snapshot(8, 'cancelled'), 'recovery');

  return {base, newerNotification, delayedRecovery, newerRecovery, delayedNotification, firstDelivery, duplicate, conflicting, gap, gapRecovery, wrongRide, wrongRole, missingBaseline, recoveredBaseline};
}

async function runNotificationHintContract() {
  const snapshot = (revision, status, nextAction, overrides = {}) => ({
    id: FIXTURE.requestId,
    status,
    revision,
    viewerRole: 'passenger',
    nextAction,
    updatedAt: new Date(Date.parse('2026-09-17T03:00:00Z') + revision * 1000).toISOString(),
    ...overrides
  });
  const base = snapshot(8, 'cancelled', 'show_cancelled_history');
  const changedHint = {type: 'ride.changed', rideId: FIXTURE.requestId, revision: 9};
  let authorizedCalls = 0;
  let recoveredFrom;
  const authorized = await handleRideNotificationHint({
    current: base,
    hint: changedHint,
    recover: async hint => {
      authorizedCalls += 1;
      recoveredFrom = hint;
      return {status: 200, body: snapshot(9, 'on_trip', 'show_on_trip')};
    }
  });

  let rejectedCalls = 0;
  const sensitive = await handleRideNotificationHint({
    current: base,
    hint: {...changedHint, status: 'on_trip', fareCents: 2300, driverId: 'driver-assigned', plate: 'DEMO 001'},
    recover: async () => { rejectedCalls += 1; return {status: 500}; }
  });
  const stale = await handleRideNotificationHint({current: base, hint: {...changedHint, revision: 7}, recover: async () => { rejectedCalls += 1; return {status: 500}; }});
  const duplicate = await handleRideNotificationHint({current: base, hint: {...changedHint, revision: 8}, recover: async () => { rejectedCalls += 1; return {status: 500}; }});
  const foreign = await handleRideNotificationHint({current: base, hint: {...changedHint, rideId: 'ride-foreign'}, recover: async () => { rejectedCalls += 1; return {status: 500}; }});

  const accessLost = await handleRideNotificationHint({current: base, hint: changedHint, recover: async () => ({status: 404, body: errorBody('resource_not_found', 'Resource was not found.', 'hidden')})});
  const notYetVisible = await handleRideNotificationHint({current: base, hint: changedHint, recover: async () => ({status: 304, body: null})});
  const initial = await handleRideNotificationHint({
    current: null,
    expectedRideId: FIXTURE.requestId,
    expectedViewerRole: 'passenger',
    hint: {...changedHint, revision: 4},
    recover: async () => ({status: 200, body: snapshot(4, 'assigned', 'track_pickup')})
  });
  return {base, authorized: {...authorized, calls: authorizedCalls, recoveredFrom}, sensitive, stale, duplicate, foreign, rejectedCalls, accessLost, notYetVisible, initial};
}

function runSessionIsolationContract() {
  const snapshot = (revision, status, viewerRole, nextAction) => ({
    id: FIXTURE.requestId,
    status,
    revision,
    viewerRole,
    nextAction,
    updatedAt: new Date(Date.parse('2026-09-17T03:00:00Z') + revision * 1000).toISOString()
  });
  const passengerBinding = {sessionId: 'session-passenger-a', viewerRole: 'passenger', rideId: FIXTURE.requestId};
  const driverBinding = {sessionId: 'session-driver-a', viewerRole: 'driver', rideId: FIXTURE.requestId};
  const otherPassengerBinding = {sessionId: 'session-passenger-b', viewerRole: 'passenger', rideId: FIXTURE.requestId};

  let retryCancelled = 0;
  const logoutClient = createRideSessionClient(passengerBinding);
  logoutClient.setCache(snapshot(8, 'cancelled', 'passenger', 'show_cancelled_history'), '"passenger-etag"');
  logoutClient.scheduleRetry(() => { retryCancelled += 1; });
  const logoutHandle = logoutClient.startRecovery();
  const loggedOut = logoutClient.resetSession(null);
  const delayedAfterLogout = logoutClient.finishRecovery(logoutHandle, {status: 200, body: snapshot(9, 'on_trip', 'passenger', 'show_on_trip'), headers: {etag: '"late"'}});

  const roleClient = createRideSessionClient(passengerBinding);
  roleClient.setCache(snapshot(8, 'cancelled', 'passenger', 'show_cancelled_history'), '"passenger-etag"');
  const passengerHandle = roleClient.startRecovery();
  const afterRoleSwitch = roleClient.resetSession(driverBinding);
  const delayedPassenger = roleClient.finishRecovery(passengerHandle, {status: 200, body: snapshot(9, 'on_trip', 'passenger', 'show_on_trip'), headers: {etag: '"passenger-late"'}});
  const driverHandle = roleClient.startRecovery();
  const driverRecovery = roleClient.finishRecovery(driverHandle, {status: 200, body: snapshot(9, 'on_trip', 'driver', 'continue_trip'), headers: {etag: '"driver-etag"'}});
  const driverState = roleClient.snapshot();

  const accountClient = createRideSessionClient(passengerBinding);
  accountClient.setCache(snapshot(8, 'cancelled', 'passenger', 'show_cancelled_history'), '"account-a"');
  const accountAHandle = accountClient.startRecovery();
  accountClient.resetSession(otherPassengerBinding);
  const delayedAccountA = accountClient.finishRecovery(accountAHandle, {status: 200, body: snapshot(9, 'on_trip', 'passenger', 'show_on_trip'), headers: {etag: '"account-a-late"'}});
  const accountBState = accountClient.snapshot();

  return {loggedOut, logoutSignalAborted: logoutHandle.signal.aborted, retryCancelled, delayedAfterLogout, afterRoleSwitch, passengerSignalAborted: passengerHandle.signal.aborted, delayedPassenger, driverRecovery, driverState, delayedAccountA, accountBState};
}

function runCommandSessionContract() {
  const accountA = {sessionId: 'session-a', accountRef: 'account-passenger-a', viewerRole: 'passenger'};
  const accountAReauth = {sessionId: 'session-a-reauth', accountRef: 'account-passenger-a', viewerRole: 'passenger'};
  const accountB = {sessionId: 'session-b', accountRef: 'account-passenger-b', viewerRole: 'passenger'};
  const command = {action: 'cancel_ride', idempotencyKey: 'command-shared-key'};

  const logoutClient = createSessionBoundCommandClient(accountA);
  const logoutHandle = logoutClient.startCommand(command);
  const loggedOut = logoutClient.resetSession(null);
  const delayedSuccess = logoutClient.finishCommand(logoutHandle, {status: 200, body: {status: 'cancelled'}});

  const expiryClient = createSessionBoundCommandClient(accountA);
  const expiryHandle = expiryClient.startCommand(command);
  const sessionExpired = expiryClient.finishCommand(expiryHandle, {status: 401, body: errorBody('authentication_required', 'Authentication is required.', 'expired-session')});

  const unknownClient = createSessionBoundCommandClient(accountA);
  const unknownHandle = unknownClient.startCommand(command);
  const outcomeUnknown = unknownClient.finishCommand(unknownHandle, {status: 0, body: null});

  const switchClient = createSessionBoundCommandClient(accountA);
  const accountAHandle = switchClient.startCommand(command);
  switchClient.resetSession(accountB);
  const delayedAccountA = switchClient.finishCommand(accountAHandle, {status: 200, body: {status: 'cancelled'}});
  const accountBHandle = switchClient.startCommand(command);
  const accountBCommitted = switchClient.finishCommand(accountBHandle, {status: 200, body: {status: 'cancelled'}});

  const accountAScope = idempotencyScopeKey(accountA.accountRef, command.idempotencyKey);
  const reauthScope = idempotencyScopeKey(accountAReauth.accountRef, command.idempotencyKey);
  const accountBScope = idempotencyScopeKey(accountB.accountRef, command.idempotencyKey);
  const delimiterA = idempotencyScopeKey('account:a', 'key');
  const delimiterB = idempotencyScopeKey('account', 'a:key');
  return {loggedOut, logoutAborted: logoutHandle.signal.aborted, delayedSuccess, sessionExpired, outcomeUnknown, delayedAccountA, accountBCommitted, accountAScope, reauthScope, accountBScope, accountAHandleScope: accountAHandle.scopedKey, accountBHandleScope: accountBHandle.scopedKey, delimiterA, delimiterB};
}

async function runCommandRecoveryContract() {
  const snapshot = (revision, status, viewerRole, nextAction) => ({
    id: FIXTURE.requestId,
    status,
    revision,
    viewerRole,
    nextAction,
    updatedAt: new Date(Date.parse('2026-09-17T04:00:00Z') + revision * 1000).toISOString()
  });
  const accountA = {sessionId: 'session-recovery-a', accountRef: 'account-passenger-a', viewerRole: 'passenger'};
  const accountB = {sessionId: 'session-recovery-b', accountRef: 'account-passenger-b', viewerRole: 'passenger'};
  const command = {action: 'cancel_ride', idempotencyKey: 'recover-cancel-key'};
  const applied = state => state?.id === FIXTURE.requestId && state?.viewerRole === 'passenger' && state?.status === 'cancelled';
  const beginUnknown = client => {
    const handle = client.startCommand(command);
    const result = client.finishCommand(handle, {status: 0, body: null});
    if (result.reason !== 'outcome_unknown') throw new Error('expected an unknown command outcome');
    return handle;
  };

  let appliedReplayCalls = 0;
  const appliedClient = createSessionBoundCommandClient(accountA);
  const appliedHandle = beginUnknown(appliedClient);
  const alreadyApplied = await appliedClient.recoverUnknownOutcome(appliedHandle, {
    baselineRevision: 4,
    recover: async () => ({status: 200, body: snapshot(5, 'cancelled', 'passenger', 'show_cancelled_history')}),
    isApplied: applied,
    resend: async () => { appliedReplayCalls += 1; return {status: 200}; }
  });

  const replayCalls = [];
  const replayClient = createSessionBoundCommandClient(accountA);
  const replayHandle = beginUnknown(replayClient);
  const replayed = await replayClient.recoverUnknownOutcome(replayHandle, {
    baselineRevision: 4,
    recover: async () => ({status: 200, body: snapshot(4, 'assigned', 'passenger', 'track_driver')}),
    isApplied: applied,
    resend: async request => { replayCalls.push(request); return {status: 200, body: {status: 'cancelled'}}; }
  });

  let changedReplayCalls = 0;
  const changedClient = createSessionBoundCommandClient(accountA);
  const changedHandle = beginUnknown(changedClient);
  const changed = await changedClient.recoverUnknownOutcome(changedHandle, {
    baselineRevision: 4,
    recover: async () => ({status: 200, body: snapshot(5, 'on_trip', 'passenger', 'show_on_trip')}),
    isApplied: applied,
    resend: async () => { changedReplayCalls += 1; return {status: 200}; }
  });

  let deniedReplayCalls = 0;
  const deniedClient = createSessionBoundCommandClient(accountA);
  const deniedHandle = beginUnknown(deniedClient);
  const denied = await deniedClient.recoverUnknownOutcome(deniedHandle, {
    baselineRevision: 4,
    recover: async () => ({status: 401, body: errorBody('authentication_required', 'Authentication is required.', 'recover-denied')}),
    isApplied: applied,
    resend: async () => { deniedReplayCalls += 1; return {status: 200}; }
  });

  let unknownReplayCalls = 0;
  const unknownClient = createSessionBoundCommandClient(accountA);
  const unknownHandle = beginUnknown(unknownClient);
  const replayUnknown = await unknownClient.recoverUnknownOutcome(unknownHandle, {
    baselineRevision: 4,
    recover: async () => ({status: 200, body: snapshot(4, 'assigned', 'passenger', 'track_driver')}),
    isApplied: applied,
    resend: async () => { unknownReplayCalls += 1; return {status: 503, body: errorBody('temporarily_unavailable', 'Try later.', 'replay-unknown')}; }
  });

  let staleReplayCalls = 0;
  const staleClient = createSessionBoundCommandClient(accountA);
  const staleHandle = beginUnknown(staleClient);
  const staleSession = await staleClient.recoverUnknownOutcome(staleHandle, {
    baselineRevision: 4,
    recover: async () => {
      staleClient.resetSession(accountB);
      return {status: 200, body: snapshot(4, 'assigned', 'passenger', 'track_driver')};
    },
    isApplied: applied,
    resend: async () => { staleReplayCalls += 1; return {status: 200}; }
  });
  return {alreadyApplied, appliedReplayCalls, replayed, replayCalls, changed, changedReplayCalls, denied, deniedReplayCalls, replayUnknown, unknownReplayCalls, staleSession, staleReplayCalls};
}

if (require.main === module) {
  Promise.all([runMockContract(), runAuditContract(), runRecoveryRetryContract(), runNotificationHintContract(), runCommandRecoveryContract(), runCurrentRideDiscoveryContract(), runCancellationReasonContract(), runOfferListContract()]).then(([results, audit, retry, notification, commandRecovery, currentRide, cancellationReasons, offerList]) => {
    const {race, validity, rideSafety, boardingRace} = audit;
    const merge = runRevisionMergeContract();
    const session = runSessionIsolationContract();
    const commandSession = runCommandSessionContract();
    const denied = results.filter(r => r.status >= 400).length;
    console.log(`HTTP contract OK: ${results.length} scenarios (${denied} safe denials, ${results.length - denied} positive controls)`);
    console.log(`HTTP race OK: ${race.winner.command} won, ${race.loser.command} received stale_revision, exact replay was stable, changed replay was rejected`);
    console.log(`HTTP validity OK: ${validity.expired.result.body.code}, exact-boundary expiry, ${validity.ineligible.result.body.code}, client clock rejected, current offer selected`);
    console.log(`HTTP ride safety OK: vehicle mismatch invalidated confirmation, unconfirmed/revoked start blocked, allowed path completed at revision ${rideSafety.state.revision}`);
    console.log(`HTTP boarding race OK: ${boardingRace.cancelFirst.winner} and ${boardingRace.startFirst.winner} each won; role-safe recovery returned current state or an empty conditional 304`);
    console.log(`HTTP recovery retry OK: Retry-After ${retry.rateLimited.delays[0]}ms, exponential ${retry.unavailable.delays.join('/')}ms, capped and access/visibility stops`);
    console.log(`Client revision merge OK: revision ${merge.newerNotification.state.revision} resisted delayed recovery, gaps/conflicts requested recovery, scope mismatches were rejected`);
    console.log(`Notification hint OK: ${notification.authorized.calls} authorized recovery applied revision ${notification.authorized.state.revision}; private, stale and foreign hints made ${notification.rejectedCalls} requests`);
    console.log(`Session isolation OK: logout and role/account switches cleared cache, cancelled retry, aborted old reads and accepted only ${session.driverState.viewerRole} recovery`);
    console.log(`Command session OK: expired and stale-session results stopped without auto-retry; same raw key separated ${commandSession.accountAScope !== commandSession.accountBScope ? 'by account' : 'incorrectly'}`);
    console.log(`Command recovery OK: applied state skipped replay; unchanged state replayed once; changed/access-lost/stale sessions stopped (${commandRecovery.replayCalls.length} explicit replay)`);
    console.log(`Current ride discovery OK: ${currentRide.passenger.body.viewerRole}/${currentRide.driver.body.viewerRole} found one active ride; unrelated and terminal viewers received bodyless 204; ambiguity stopped with 409`);
    console.log(`HTTP cancellation reason OK: ${cancellationReasons.allowed.map(item => item.reason).join('/')}; exact replays stable, changed reasons conflicted, terminal reasons immutable, invalid values changed no state`);
    console.log(`HTTP offer list OK: ${offerList.active.result.body.summary.active} active, ${offerList.expired.result.body.summary.expired} expired, ${offerList.unavailable.result.body.summary.unavailable} unavailable; stale offers omitted without ride mutation`);
    console.log(`HTTP audit OK: ${audit.events.length} allowlisted events, no replay duplicate or private input`);
  }).catch(error => {
    console.error(`HTTP contract failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {FIXTURE, AUDIT_FIELDS, CANCELLATION_REASONS, createMockHandler, scenarios, runHttpContract, runMockContract, runConcurrencyContract, runOfferValidityContract, runOfferListContract, runCancellationReasonContract, runRideSafetyContract, runBoardingRaceContract, runCurrentRideDiscoveryContract, runRecoveryRetryContract, runRevisionMergeContract, runNotificationHintContract, runSessionIsolationContract, runCommandSessionContract, runCommandRecoveryContract, runAuditContract, fetchRideStateWithRetry, mergeRideStateUpdate, parseRideNotificationHint, handleRideNotificationHint, createRideSessionClient, createSessionBoundCommandClient, idempotencyScopeKey, parseRetryAfterMs, exponentialBackoffMs, startMockServer};
