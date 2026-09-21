'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SPEC = path.join(__dirname, '../docs/openapi.json');
const OPERATIONS = [
  ['post', '/v1/ride-requests', 'createRideRequest', null],
  ['get', '/v1/ride-requests/{requestId}/offers', 'listRideOffers', null],
  ['post', '/v1/ride-requests/{requestId}/offers', 'createRideOffer', 'expectedRequestRevision'],
  ['post', '/v1/offers/{offerId}/select', 'selectRideOffer', 'expectedRequestRevision'],
  ['post', '/v1/ride-requests/{requestId}/cancel', 'cancelRideRequest', 'expectedRevision'],
  ['get', '/v1/rides/current', 'getCurrentRide', null],
  ['get', '/v1/rides/{requestId}', 'getRideState', null],
  ['post', '/v1/rides/{requestId}/vehicle-confirmations', 'confirmAssignedVehicle', 'expectedRevision'],
  ['post', '/v1/rides/{requestId}/transitions', 'transitionRide', 'expectedRevision']
];
const FORBIDDEN_INPUT_FIELDS = new Set(['passengerId', 'driverId', 'reviewerId', 'approved', 'eligible', 'reviewStatus']);
const CANCELLATION_REASONS = Object.freeze(['passenger_requested', 'route_changed', 'schedule_changed']);

function loadContract(file = DEFAULT_SPEC) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveRef(spec, value) {
  if (!value || typeof value !== 'object' || !value.$ref) return value;
  if (!value.$ref.startsWith('#/')) return null;
  return value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], spec);
}

function parametersFor(spec, pathItem, operation) {
  return [...(pathItem.parameters || []), ...(operation.parameters || [])].map(p => resolveRef(spec, p));
}

function inputSchema(spec, operation) {
  return resolveRef(spec, operation.requestBody?.content?.['application/json']?.schema);
}

function collectPropertyNames(spec, schema, seen = new Set()) {
  schema = resolveRef(spec, schema);
  if (!schema || seen.has(schema)) return new Set();
  seen.add(schema);
  const names = new Set(Object.keys(schema.properties || {}));
  for (const value of Object.values(schema.properties || {})) {
    for (const name of collectPropertyNames(spec, value, seen)) names.add(name);
  }
  for (const group of ['allOf', 'oneOf', 'anyOf']) {
    for (const value of schema[group] || []) for (const name of collectPropertyNames(spec, value, seen)) names.add(name);
  }
  return names;
}

function validateContract(spec) {
  const errors = [];
  const add = message => errors.push(message);
  if (!/^3\.1\./.test(spec.openapi || '')) add('openapi must use the 3.1 specification');
  const auth = spec.components?.securitySchemes?.sessionAuth;
  if (auth?.type !== 'http' || auth?.scheme !== 'bearer') add('sessionAuth must be an HTTP bearer scheme');
  if (!spec.security?.some(s => Object.hasOwn(s, 'sessionAuth'))) add('authenticated security must be the default');

  const ids = new Set();
  for (const [method, route, operationId, revisionField] of OPERATIONS) {
    const pathItem = spec.paths?.[route];
    const operation = pathItem?.[method];
    if (!operation) { add(`${method.toUpperCase()} ${route} is missing`); continue; }
    if (operation.operationId !== operationId) add(`${method.toUpperCase()} ${route} must use operationId ${operationId}`);
    if (ids.has(operation.operationId)) add(`duplicate operationId ${operation.operationId}`);
    ids.add(operation.operationId);

    for (const code of ['401', '403']) if (!operation.responses?.[code]) add(`${operationId} must document ${code}`);
    if (!Object.keys(operation.responses || {}).some(code => /^2\d\d$/.test(code))) add(`${operationId} needs a success response`);

    if (method === 'post') {
      const params = parametersFor(spec, pathItem, operation);
      if (!params.some(p => p?.in === 'header' && p.name === 'Idempotency-Key' && p.required === true)) add(`${operationId} requires Idempotency-Key`);
      for (const code of ['409', '422']) if (!operation.responses?.[code]) add(`${operationId} must document ${code}`);
      const schema = inputSchema(spec, operation);
      if (!schema) add(`${operationId} needs an application/json request schema`);
      if (schema?.additionalProperties !== false) add(`${operationId} input must reject unknown fields`);
      if (revisionField && (!schema.required?.includes(revisionField) || !schema.properties?.[revisionField])) add(`${operationId} requires ${revisionField}`);
      const fields = collectPropertyNames(spec, schema);
      for (const field of FORBIDDEN_INPUT_FIELDS) if (fields.has(field)) add(`${operationId} must not accept server-owned ${field}`);
    }
  }

  const error = spec.components?.schemas?.Error;
  for (const field of ['code', 'message', 'requestId']) if (!error?.required?.includes(field)) add(`Error requires ${field}`);
  for (const code of ['vehicle_mismatch', 'vehicle_confirmation_required', 'ambiguous_current_ride', 'rate_limited', 'service_unavailable']) {
    if (!error?.properties?.code?.enum?.includes(code)) add(`Error code enum requires ${code}`);
  }
  const fare = spec.components?.schemas?.CreateOfferInput?.properties?.fareCents;
  if (fare?.type !== 'integer' || fare?.minimum !== 0) add('fareCents must be a non-negative integer in Fiji cents');
  const zone = spec.components?.schemas?.CreateRideRequestInput?.properties?.pickupTimeZone;
  if (zone?.const !== 'Pacific/Fiji') add('pickupTimeZone must preserve Pacific/Fiji');
  const quote = spec.components?.schemas?.SelectedQuote;
  if (quote?.readOnly !== true || quote?.properties?.selectedAt?.format !== 'date-time') add('selected quote must be a server-owned dated snapshot');
  const revision = spec.components?.schemas?.Revision;
  if (revision?.type !== 'integer' || revision?.minimum !== 1) add('revision must be an integer beginning at 1');
  const cancellation = spec.components?.schemas?.CancelRideInput;
  const cancellationReasons = cancellation?.properties?.reason?.enum;
  if (!cancellation?.required?.includes('reason') ||
      !Array.isArray(cancellationReasons) ||
      cancellationReasons.length !== CANCELLATION_REASONS.length ||
      CANCELLATION_REASONS.some(reason => !cancellationReasons.includes(reason))) {
    add(`CancelRideInput reason must allow exactly ${CANCELLATION_REASONS.join(', ')}`);
  }
  const rideState = spec.components?.schemas?.RideStateView;
  const safeRideStateFields = new Set(['id', 'status', 'revision', 'viewerRole', 'nextAction', 'updatedAt']);
  if (rideState?.additionalProperties !== false) add('RideStateView must reject unlisted response fields');
  for (const field of safeRideStateFields) {
    if (!rideState?.required?.includes(field) || !rideState?.properties?.[field]) add(`RideStateView requires safe field ${field}`);
  }
  for (const field of Object.keys(rideState?.properties || {})) {
    if (!safeRideStateFields.has(field)) add(`RideStateView must not expose private field ${field}`);
  }
  const ridePath = spec.paths?.['/v1/rides/{requestId}'];
  const rideRead = ridePath?.get;
  const rideReadParameters = parametersFor(spec, ridePath || {}, rideRead || {});
  if (!rideReadParameters.some(parameter => parameter?.in === 'header' && parameter.name === 'If-None-Match' && parameter.required === false)) {
    add('getRideState must accept optional If-None-Match');
  }
  if (!rideRead?.responses?.['304']) add('getRideState must document bodyless 304');
  for (const code of ['200', '304']) {
    const headers = rideRead?.responses?.[code]?.headers || {};
    for (const name of ['ETag', 'Cache-Control', 'Vary']) if (!headers[name]) add(`getRideState ${code} requires ${name} header`);
  }
  if (rideRead?.responses?.['304']?.content) add('getRideState 304 must not define a response body');
  for (const code of ['429', '503']) {
    const response = resolveRef(spec, rideRead?.responses?.[code]);
    if (!response) add(`getRideState must document ${code}`);
    else if (!response.headers?.['Retry-After']) add(`getRideState ${code} requires Retry-After header`);
  }
  const currentPath = spec.paths?.['/v1/rides/current'];
  const currentRead = currentPath?.get;
  const currentParameters = parametersFor(spec, currentPath || {}, currentRead || {});
  if (currentParameters.some(parameter => ['path', 'query'].includes(parameter?.in) || parameter?.name === 'requestId')) {
    add('getCurrentRide must derive scope from authentication without path or query identifiers');
  }
  for (const code of ['200', '204', '409', '422']) {
    if (!currentRead?.responses?.[code]) add(`getCurrentRide must document ${code}`);
  }
  if (currentRead?.responses?.['304']) add('getCurrentRide must return a full startup result instead of 304');
  if (currentRead?.responses?.['204']?.content) add('getCurrentRide 204 must not define a response body');
  for (const [code, names] of [['200', ['ETag', 'Cache-Control', 'Vary']], ['204', ['Cache-Control', 'Vary']]]) {
    const headers = currentRead?.responses?.[code]?.headers || {};
    for (const name of names) if (!headers[name]) add(`getCurrentRide ${code} requires ${name} header`);
  }
  for (const code of ['429', '503']) {
    const response = resolveRef(spec, currentRead?.responses?.[code]);
    if (!response) add(`getCurrentRide must document ${code}`);
    else if (!response.headers?.['Retry-After']) add(`getCurrentRide ${code} requires Retry-After header`);
  }
  const offerRead = spec.paths?.['/v1/ride-requests/{requestId}/offers']?.get;
  for (const code of ['200', '401', '403', '404']) {
    const offerHeaders = resolveRef(spec, offerRead?.responses?.[code])?.headers || {};
    for (const name of ['Cache-Control', 'Vary']) {
      if (!offerHeaders[name]) add(`listRideOffers ${code} requires ${name} header`);
    }
  }
  if (spec.components?.headers?.PrivateNoCache?.schema?.const !== 'private, no-cache') add('ride state cache control must be private, no-cache');
  if (spec.components?.headers?.PrivateNoStore?.schema?.const !== 'private, no-store') add('offer list cache control must be private, no-store');
  if (spec.components?.headers?.VaryAuthorization?.schema?.const !== 'Authorization') add('ride state response must vary by Authorization');
  return errors;
}

if (require.main === module) {
  try {
    const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SPEC;
    const errors = validateContract(loadContract(file));
    if (errors.length) {
      console.error(`API contract failed (${errors.length})\n- ${errors.join('\n- ')}`);
      process.exitCode = 1;
    } else {
      console.log(`API contract OK: ${OPERATIONS.length} operations, authentication, idempotency, revision, safe discovery/recovery, conditional-read and retry-control checks`);
    }
  } catch (error) {
    console.error(`API contract could not be read: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {DEFAULT_SPEC, OPERATIONS, CANCELLATION_REASONS, loadContract, validateContract};
