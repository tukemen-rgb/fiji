/* Reference model for UI testing, NOT a regulator connection or authorization API.
 * In production, load this model only from authenticated server-owned records.
 * A browser-side result must never authorize dispatch or certify a taxi. */
(function (root) {
  'use strict';
  const REQUIRED = ['taxi_permit', 'vehicle_licence', 'driver_licence', 'psv_driver_permit', 'fitness', 'insurance', 'operator_assignment'];
  const METHODS = new Set(['issuer_written', 'issuer_portal_witnessed', 'issuer_api']);
  const normalizePlate = v => String(v || '').normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');
  const time = v => typeof v === 'string' && v.trim() ? Date.parse(v) : NaN;

  function assess(record, options = {}) {
    const now = options.now === undefined ? Date.now() : time(options.now);
    const fail = (code, reasons) => ({ eligible: false, code, reasons });
    if (!Number.isFinite(now)) return fail('unavailable', ['確認日時が無効です']);
    if (!record) return fail('not_found', ['当アプリの登録情報に見つかりません。無許可と断定するものではありません。']);
    if (record.status !== 'reviewed') return fail(record.status === 'suspended' ? 'suspended' : 'pending', ['審査が完了していないか、利用を停止しています']);
    if (!record.id || !record.vehicleId || !record.driverId || !record.holderId || !normalizePlate(record.plate)) return fail('incomplete', ['車両・運転手・許可名義人の紐付けが不完全です']);
    const reasons = [];
    const types = options.airport ? [...REQUIRED, 'airport_authorization'] : REQUIRED;
    for (const type of types) {
      const d = record.documents?.[type];
      if (!d || d.status !== 'confirmed' || !METHODS.has(d.method) || !d.evidenceRef || !d.reviewerId) {
        reasons.push(type + ': 確認根拠が不足'); continue;
      }
      if (d.reviewerId === record.driverId || d.reviewerId === record.holderId) reasons.push(type + ': 自己承認は禁止');
      if (normalizePlate(d.plate) !== normalizePlate(record.plate)) reasons.push(type + ': 車両番号が確認記録と不一致');
      if (d.binding !== `${record.holderId}/${record.vehicleId}/${record.driverId}`) reasons.push(type + ': 対象の組み合わせが不一致');
      const checked = time(d.checkedAt), expiry = time(d.expiresAt), recheck = time(d.recheckAt);
      if (![checked, expiry, recheck].every(Number.isFinite)) reasons.push(type + ': 日付不明');
      else {
        if (checked > now) reasons.push(type + ': 確認日時が未来');
        if (expiry <= now) reasons.push(type + ': 有効期限切れ');
        if (recheck <= now || recheck <= checked) reasons.push(type + ': 再確認が必要');
      }
    }
    return reasons.length ? fail('recheck', reasons) : { eligible: true, code: 'reviewed', reasons: [] };
  }

  function matchVehicle(record, enteredPlate, options = {}) {
    const a = assess(record, options);
    if (!a.eligible) return a;
    if (options.expectedId && options.expectedId !== record.id) return { eligible: false, code: 'wrong_vehicle', reasons: ['予約した車両とは別の車両です'] };
    if (!normalizePlate(enteredPlate) || normalizePlate(enteredPlate) !== normalizePlate(record.plate)) return { eligible: false, code: 'plate_mismatch', reasons: ['目の前の車のナンバーと一致しません'] };
    return a;
  }

  function submitApplication(input, now = new Date().toISOString()) {
    const errors = [];
    const required = ['name','phone','plate','holder','vehicle','taxiPermit','driverLicence','psvPermit','base'];
    required.forEach(k => { if (typeof input[k] !== 'string' || !input[k].trim() || input[k].length > 160) errors.push(k); });
    if (!/^\+?[0-9\s()-]{7,22}$/.test(input.phone || '')) errors.push('phone');
    if (!/^[A-Z0-9]{3,14}$/.test(normalizePlate(input.plate))) errors.push('plate');
    if (input.consent !== true) errors.push('consent');
    const kinds = input.airport === true ? [...REQUIRED, 'airport_authorization'] : REQUIRED;
    kinds.forEach(k => {
      const d = input.documents?.[k];
      if (!d?.attachment || !(time(d.expiresAt) > time(now))) errors.push(k);
    });
    if (errors.length) return { ok: false, errors: [...new Set(errors)] };
    // Whitelist data; never accept a client-supplied reviewed/approved flag.
    return { ok: true, application: {
      name: input.name.trim(), plate: normalizePlate(input.plate), status: 'submitted',
      airportRequested: input.airport === true, submittedAt: now, eligible: false
    }};
  }

  function samples() {
    const now = Date.now();
    const iso = delta => new Date(now + delta * 86400000).toISOString();
    const make = (id, plate, airport) => {
      const r = { id, plate, name: 'Sample Driver ' + id.slice(-1), holderId: 'demo-holder', vehicleId: 'v-' + id, driverId: 'd-' + id, vehicle: 'Toyota Prius', color: 'シルバー', status: 'reviewed', demo: true, documents: {} };
      for (const type of [...REQUIRED, ...(airport ? ['airport_authorization'] : [])]) {
        r.documents[type] = { status: 'confirmed', plate: r.plate, method: 'issuer_written', reviewerId: 'demo-reviewer', evidenceRef: 'DEMO-NOT-REAL/' + type, binding: `${r.holderId}/${r.vehicleId}/${r.driverId}`, checkedAt: iso(-1), recheckAt: iso(6), expiresAt: iso(180) };
      }
      return r;
    };
    const a = make('demo-1', 'DEMO 001', true), b = make('demo-2', 'DEMO 002', false), c = make('demo-3', 'DEMO 003', true), d = make('demo-4', 'DEMO 004', false);
    b.vehicle = 'Toyota Fielder'; b.color = 'ホワイト';
    c.documents.taxi_permit.expiresAt = iso(-1);
    d.status = 'submitted'; d.documents = {};
    return [a,b,c,d];
  }
  const api = { REQUIRED, normalizePlate, assess, matchVehicle, submitApplication, samples };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaxiVerification = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
