'use strict';
/*
 * onboarding-core.test.cjs — 役割別オンボーディング（Issue #3 最初の成果物）の判定テスト。
 * 対象: 利用者/運転手の登録検証、運転手の審査待ち固定、登録途中の復帰。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../../onboarding-core.js');

const NOW = Date.parse('2026-09-20T00:00:00Z');

function validPassenger(overrides) {
  return Object.assign({
    displayName: '佐藤 花子',
    countryCode: '+679',
    phone: '7012345',
    email: 'hana@example.com',
    language: 'ja',
    defaultPickup: 'Nadi マリーナホテル',
    payment: 'cash',
    consent: true
  }, overrides);
}

function validDriverSteps(overrides) {
  return Object.assign({
    identity: {
      fullName: 'ジョネ・ラウ', countryCode: '+679', phone: '9923456',
      licenceNumber: 'FJ-DL-48213', psvNumber: 'PSV-2291'
    },
    vehicle: {
      plate: 'lt  4821', vehicleDesc: 'トヨタ・カローラ／白',
      taxiPermitNumber: 'TP-0771', permitHolder: 'ナンディ・タクシー組合',
      operatingScope: 'Nadi Base（空港送迎を除く）'
    },
    documents: {
      licenceExpiry: '2027-09-20', psvExpiry: '2027-01-15',
      permitExpiry: '2026-12-31', consent: true
    }
  }, overrides);
}

// ---- 利用者登録 ----

test('利用者登録: 有効な入力を受理し role=passenger で確定する', () => {
  const r = Core.validatePassengerProfile(validPassenger());
  assert.equal(r.ok, true);
  assert.equal(r.profile.role, 'passenger');
  assert.equal(r.profile.phone, '+679 7012345');
});

test('利用者登録: メールと乗車地点は任意', () => {
  const r = Core.validatePassengerProfile(validPassenger({ email: '', defaultPickup: '' }));
  assert.equal(r.ok, true);
  assert.equal(r.profile.email, '');
  assert.equal(r.profile.defaultPickup, '');
});

test('利用者登録: 表示名なし・不正電話・不正メール・未同意を項目別に拒否する', () => {
  const r = Core.validatePassengerProfile(validPassenger({
    displayName: ' ', phone: '12', email: 'bad@', consent: false
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.displayName);
  assert.ok(r.errors.phone);
  assert.ok(r.errors.email);
  assert.ok(r.errors.consent);
});

test('利用者登録: 一覧にない国番号・言語・支払い方法を拒否する', () => {
  const r = Core.validatePassengerProfile(validPassenger({
    countryCode: '+999', language: 'xx', payment: 'gold'
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.phone);
  assert.ok(r.errors.language);
  assert.ok(r.errors.payment);
});

test('利用者登録: 電話番号の空白・ハイフンを除去して国番号付きで保存する', () => {
  const r = Core.validatePassengerProfile(validPassenger({ phone: ' 701-23 45 ' }));
  assert.equal(r.ok, true);
  assert.equal(r.profile.phone, '+679 7012345');
});

// ---- 運転手登録 ----

test('運転手登録: 3段階の有効な入力で申請でき、審査状態は必ず審査待ちになる', () => {
  const r = Core.submitDriverApplication(validDriverSteps(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.application.reviewStatus, 'pending_review');
  assert.equal(r.application.role, 'driver');
  assert.equal(r.application.vehicle.plate, 'LT 4821'); // 正規化（大文字・空白1つ）
});

test('運転手登録: 本人情報の欠落をステップ1のエラーとして返す', () => {
  const steps = validDriverSteps();
  steps.identity = Object.assign({}, steps.identity, { fullName: '', licenceNumber: 'x' });
  const r = Core.submitDriverApplication(steps, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.identity.fullName);
  assert.ok(r.errors.identity.licenceNumber);
  assert.deepEqual(r.errors.vehicle, {});
});

test('運転手登録: 期限切れ書類では申請できない', () => {
  const steps = validDriverSteps();
  steps.documents = Object.assign({}, steps.documents, { permitExpiry: '2026-09-19' });
  const r = Core.submitDriverApplication(steps, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.documents.permitExpiry);
});

test('運転手登録: 審査への同意なしでは申請できない', () => {
  const steps = validDriverSteps();
  steps.documents = Object.assign({}, steps.documents, { consent: false });
  const r = Core.submitDriverApplication(steps, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.documents.consent);
});

test('運転手登録: 名義人が運転手本人と別名でも受理する（許可された割当は審査側で確認）', () => {
  const r = Core.submitDriverApplication(validDriverSteps(), NOW);
  assert.equal(r.ok, true);
  assert.notEqual(r.application.vehicle.permitHolder, r.application.identity.fullName);
});

test('運転手登録: クライアントからの承認系フィールドを拒否する', () => {
  const steps = validDriverSteps();
  steps.documents = Object.assign({}, steps.documents, { approved: true, reviewer: 'self' });
  const r = Core.submitDriverApplication(steps, NOW);
  assert.equal(r.ok, false);
  assert.ok(r.errors.documents.approved);
  assert.ok(r.errors.documents.reviewer);
});

// ---- Google 登録連携 ----

function fakeIdToken(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64(payload) + '.sig';
}

test('Google連携: IDトークンから sub・メール・表示名だけを取り出す', () => {
  const parsed = Core.parseGoogleIdToken(fakeIdToken({
    sub: '10769150350006150715113082367',
    email: 'hana@example.com',
    email_verified: true,
    name: '佐藤 花子',
    picture: 'https://example.com/x.png'
  }));
  assert.equal(parsed.sub, '10769150350006150715113082367');
  assert.equal(parsed.email, 'hana@example.com');
  assert.equal(parsed.name, '佐藤 花子');
  assert.equal(parsed.emailVerified, true);
  assert.equal('picture' in parsed, false);
});

test('Google連携: 壊れたトークン・不正なsub/メールは null を返す', () => {
  assert.equal(Core.parseGoogleIdToken('not-a-jwt'), null);
  assert.equal(Core.parseGoogleIdToken('a.b'), null);
  assert.equal(Core.parseGoogleIdToken(null), null);
  assert.equal(Core.parseGoogleIdToken(fakeIdToken({ sub: 'abc', email: 'hana@example.com' })), null);
  assert.equal(Core.parseGoogleIdToken(fakeIdToken({ sub: '1234567', email: 'bad@' })), null);
});

test('Google連携: 連携ありの登録は googleLinked と sub を保存し、なしは false になる', () => {
  const linked = Core.validatePassengerProfile(validPassenger({
    googleLinked: true, googleSub: '1234567890'
  }));
  assert.equal(linked.ok, true);
  assert.equal(linked.profile.googleLinked, true);
  assert.equal(linked.profile.googleSub, '1234567890');

  const plain = Core.validatePassengerProfile(validPassenger());
  assert.equal(plain.ok, true);
  assert.equal(plain.profile.googleLinked, false);
});

test('Google連携: sub が不正な連携は拒否する', () => {
  const r = Core.validatePassengerProfile(validPassenger({
    googleLinked: true, googleSub: 'DROP TABLE'
  }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.googleSub);
});

// ---- 審査状態と操作可否 ----

test('審査待ちの運転手は受付・料金提示・迎車のすべてが不可', () => {
  const caps = Core.driverCapabilities('pending_review');
  assert.equal(caps.canGoOnDuty, false);
  assert.equal(caps.canQuote, false);
  assert.equal(caps.canStartPickup, false);
  assert.ok(caps.reason.includes('審査待ち'));
});

test('期限切れ・停止・不明状態も営業系操作をすべて拒否する', () => {
  for (const status of ['expired', 'suspended', undefined, 'hacked']) {
    const caps = Core.driverCapabilities(status);
    assert.equal(caps.canGoOnDuty, false, String(status));
    assert.equal(caps.canQuote, false, String(status));
    assert.equal(caps.canStartPickup, false, String(status));
    assert.ok(caps.reason);
  }
});

test('approved のみ営業系操作を許可する（本番ではサーバー応答からのみ設定）', () => {
  const caps = Core.driverCapabilities('approved');
  assert.equal(caps.canGoOnDuty, true);
  assert.equal(caps.canQuote, true);
  assert.equal(caps.canStartPickup, true);
});

// ---- 保存・復帰 ----

test('保存と復帰: プロフィール・申請・下書きが往復しても失われない', () => {
  const passenger = Core.validatePassengerProfile(validPassenger()).profile;
  const driver = Core.submitDriverApplication(validDriverSteps(), NOW).application;
  const store = Core.emptyStore();
  store.passengerProfile = passenger;
  store.driverApplication = driver;
  store.driverDraft = { step: 1, values: { fullName: '途中 まで' } };
  const restored = Core.deserializeStore(Core.serializeStore(store));
  assert.deepEqual(restored.passengerProfile, passenger);
  assert.deepEqual(restored.driverApplication, driver);
  assert.equal(restored.driverDraft.step, 1);
  assert.equal(restored.driverDraft.values.fullName, '途中 まで');
});

test('復帰: 壊れたJSON・別スキーマ版は安全に空状態へ戻す', () => {
  assert.deepEqual(Core.deserializeStore('{oops'), Core.emptyStore());
  assert.deepEqual(Core.deserializeStore(JSON.stringify({ version: 999 })), Core.emptyStore());
  assert.deepEqual(Core.deserializeStore(null), Core.emptyStore());
});

test('復帰: 端末保存に approved が書かれていても審査待ちへ戻す（自己承認の禁止）', () => {
  const driver = Core.submitDriverApplication(validDriverSteps(), NOW).application;
  const tampered = Object.assign({}, driver, { reviewStatus: 'approved' });
  const store = Core.emptyStore();
  store.driverApplication = tampered;
  const restored = Core.deserializeStore(Core.serializeStore(store));
  assert.equal(restored.driverApplication.reviewStatus, 'pending_review');
});

test('復帰: 役割の食い違うレコードは読み込まない', () => {
  const store = Core.emptyStore();
  store.passengerProfile = { role: 'driver', displayName: 'x' };
  const restored = Core.deserializeStore(Core.serializeStore(store));
  assert.equal(restored.passengerProfile, null);
});
