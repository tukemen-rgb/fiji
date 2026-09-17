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
  ['get', '/v1/rides/{requestId}', 'getRideState', null],
  ['post', '/v1/rides/{requestId}/vehicle-confirmations', 'confirmAssignedVehicle', 'expectedRevision'],
  ['post', '/v1/rides/{requestId}/transitions', 'transitionRide', 'expectedRevision']
];
const FORBIDDEN_INPUT_FIELDS = new Set(['passengerId', 'driverId', 'reviewerId', 'approved', 'eligible', 'reviewStatus']);

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
  for (const code of ['vehicle_mismatch', 'vehicle_confirmation_required']) {
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
  const rideState = spec.components?.schemas?.RideStateView;
  const safeRideStateFields = new Set(['id', 'status', 'revision', 'viewerRole', 'nextAction', 'updatedAt']);
  if (rideState?.additionalProperties !== false) add('RideStateView must reject unlisted response fields');
  for (const field of safeRideStateFields) {
    if (!rideState?.required?.includes(field) || !rideState?.properties?.[field]) add(`RideStateView requires safe field ${field}`);
  }
  for (const field of Object.keys(rideState?.properties || {})) {
    if (!safeRideStateFields.has(field)) add(`RideStateView must not expose private field ${field}`);
  }
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
      console.log(`API contract OK: ${OPERATIONS.length} operations, authentication, idempotency, revision, safe-input and recovery-output checks`);
    }
  } catch (error) {
    console.error(`API contract could not be read: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {DEFAULT_SPEC, OPERATIONS, loadContract, validateContract};
