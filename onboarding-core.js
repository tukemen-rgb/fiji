/*
 * onboarding-core.js — 役割別オンボーディングの参照ロジック（ブラウザ / Node 共用）
 *
 * ここにあるのは入力検証・登録途中の復帰・審査状態の「クライアント側」ルールのみ。
 * 承認・審査者・発行元確認はサーバー所有であり、このモジュールは
 * 申請を常に「審査待ち (pending_review)」としてしか生成しない。
 * クライアントから承認系フィールドを渡された場合は拒否する。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OnboardingCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  var COUNTRY_CODES = [
    { id: '+679', label: 'フィジー (+679)' },
    { id: '+81', label: '日本 (+81)' },
    { id: '+61', label: 'オーストラリア (+61)' },
    { id: '+64', label: 'ニュージーランド (+64)' },
    { id: '+1', label: 'アメリカ / カナダ (+1)' },
    { id: '+44', label: 'イギリス (+44)' },
    { id: '+91', label: 'インド (+91)' }
  ];

  var LANGUAGES = [
    { id: 'ja', label: '日本語' },
    { id: 'en', label: 'English（英語）' },
    { id: 'fj', label: 'フィジー語' },
    { id: 'hif', label: 'フィジー・ヒンディー語' }
  ];

  var PAYMENTS = [
    { id: 'cash', label: '現金' },
    { id: 'card', label: 'カード' },
    { id: 'mobile', label: 'モバイル送金（M-PAiSA など）' }
  ];

  var DOCUMENT_KEYS = [
    { id: 'licence', label: '運転免許' },
    { id: 'psv', label: 'PSV運転手許可' },
    { id: 'permit', label: 'Taxi Permit' }
  ];

  // クライアントが設定してはならないサーバー所有フィールド
  var SERVER_OWNED_FIELDS = [
    'reviewStatus', 'approved', 'reviewer', 'reviewerId', 'issuerConfirmed',
    'eligibility', 'verifiedAt', 'revoked'
  ];

  function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
  }

  function trimmed(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function hasId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return true;
    return false;
  }

  function rejectServerOwnedFields(input, errors) {
    SERVER_OWNED_FIELDS.forEach(function (key) {
      if (input && Object.prototype.hasOwnProperty.call(input, key)) {
        errors[key] = 'この項目は審査側が管理します。申請から設定できません。';
      }
    });
  }

  // ---- 共通フィールド検証 -------------------------------------------------

  function validateName(value, label) {
    var v = trimmed(value);
    if (!v) return { error: label + 'を入力してください。' };
    if (v.length > 40) return { error: label + 'は40文字以内で入力してください。' };
    return { value: v };
  }

  function validatePhone(countryCode, localNumber) {
    if (!hasId(COUNTRY_CODES, countryCode)) {
      return { error: '国番号を一覧から選んでください。' };
    }
    var digits = trimmed(localNumber).replace(/[\s\-()]/g, '');
    if (!/^\d{5,12}$/.test(digits)) {
      return { error: '電話番号は数字5〜12桁で入力してください。' };
    }
    if (/^0/.test(digits) && countryCode !== '+81') {
      // フィジー等の国内番号は先頭0なしで保存（+81のみ0始まり入力を許容し正規化）
      digits = digits.replace(/^0+/, '');
      if (digits.length < 5) return { error: '電話番号は数字5〜12桁で入力してください。' };
    }
    if (countryCode === '+81') digits = digits.replace(/^0/, '');
    return { value: countryCode + ' ' + digits };
  }

  function validateEmailOptional(value) {
    var v = trimmed(value);
    if (!v) return { value: '' };
    if (v.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
      return { error: 'メールアドレスの形式を確認してください。' };
    }
    return { value: v };
  }

  function validateFutureDate(value, nowMs, label) {
    var v = trimmed(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return { error: label + 'の有効期限を日付で入力してください。' };
    }
    var t = Date.parse(v + 'T23:59:59Z');
    if (isNaN(t)) return { error: label + 'の有効期限が正しい日付ではありません。' };
    if (t <= nowMs) return { error: label + 'の有効期限が過去です。有効な書類が必要です。' };
    return { value: v };
  }

  function normalizePlate(value) {
    var v = trimmed(value).toUpperCase().replace(/\s+/g, ' ');
    if (!/^[A-Z0-9][A-Z0-9 \-]{1,9}$/.test(v)) {
      return { error: '車両ナンバーは英数字2〜10文字で入力してください。' };
    }
    return { value: v };
  }

  // ---- Google 登録連携（クライアント側の取り込みのみ） --------------------

  function base64UrlDecode(s) {
    try {
      s = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      if (typeof atob === 'function') {
        var bin = atob(s);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      }
      return Buffer.from(s, 'base64').toString('utf8');
    } catch (e) {
      return null;
    }
  }

  /**
   * Google Identity Services の ID トークンから表示用の項目だけを取り出す。
   * これは登録フォームの入力補助であり、認証ではない。
   * 本番はサーバー側で署名・aud・iss・有効期限を検証すること（未接続）。
   */
  function parseGoogleIdToken(jwt) {
    if (typeof jwt !== 'string') return null;
    var parts = jwt.split('.');
    if (parts.length !== 3) return null;
    var json = base64UrlDecode(parts[1]);
    if (!json) return null;
    var payload;
    try {
      payload = JSON.parse(json);
    } catch (e) {
      return null;
    }
    if (!isPlainObject(payload)) return null;
    var sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    var email = typeof payload.email === 'string' ? payload.email.trim() : '';
    if (!/^[0-9]{5,64}$/.test(sub)) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 80) return null;
    var name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 40) : '';
    return {
      sub: sub,
      email: email,
      name: name,
      emailVerified: payload.email_verified === true
    };
  }

  // ---- 利用者登録 ---------------------------------------------------------

  function validatePassengerProfile(input) {
    input = isPlainObject(input) ? input : {};
    var errors = {};
    var profile = {};
    rejectServerOwnedFields(input, errors);

    var name = validateName(input.displayName, '表示名');
    if (name.error) errors.displayName = name.error; else profile.displayName = name.value;

    var phone = validatePhone(input.countryCode, input.phone);
    if (phone.error) errors.phone = phone.error; else {
      profile.countryCode = input.countryCode;
      profile.phone = phone.value;
    }

    var email = validateEmailOptional(input.email);
    if (email.error) errors.email = email.error; else profile.email = email.value;

    if (!hasId(LANGUAGES, input.language)) {
      errors.language = '連絡に使う言語を選んでください。';
    } else profile.language = input.language;

    var pickup = trimmed(input.defaultPickup);
    if (pickup.length > 80) errors.defaultPickup = '乗車地点は80文字以内で入力してください。';
    else profile.defaultPickup = pickup;

    if (!hasId(PAYMENTS, input.payment)) {
      errors.payment = '希望する支払い方法を選んでください。';
    } else profile.payment = input.payment;

    if (input.consent !== true) {
      errors.consent = '利用条件への同意が必要です。';
    }

    // Google連携は入力補助の記録のみ（sub は数字のGoogleアカウントID）。
    // サーバーでのIDトークン検証が接続されるまで、認証・権限には使わない。
    if (input.googleLinked === true) {
      var sub = trimmed(input.googleSub);
      if (/^[0-9]{5,64}$/.test(sub)) {
        profile.googleLinked = true;
        profile.googleSub = sub;
      } else {
        errors.googleSub = 'Google連携の情報を確認できませんでした。もう一度連携してください。';
      }
    } else {
      profile.googleLinked = false;
    }

    if (Object.keys(errors).length) return { ok: false, errors: errors };
    profile.role = 'passenger';
    return { ok: true, profile: profile };
  }

  // ---- 運転手登録（3段階） ------------------------------------------------

  function validateDriverIdentity(input) {
    input = isPlainObject(input) ? input : {};
    var errors = {};
    var out = {};
    rejectServerOwnedFields(input, errors);

    var name = validateName(input.fullName, '運転手氏名');
    if (name.error) errors.fullName = name.error; else out.fullName = name.value;

    var phone = validatePhone(input.countryCode, input.phone);
    if (phone.error) errors.phone = phone.error; else {
      out.countryCode = input.countryCode;
      out.phone = phone.value;
    }

    var licence = trimmed(input.licenceNumber).toUpperCase();
    if (!/^[A-Z0-9\-]{3,20}$/.test(licence)) {
      errors.licenceNumber = '運転免許番号は英数字3〜20文字で入力してください。';
    } else out.licenceNumber = licence;

    var psv = trimmed(input.psvNumber).toUpperCase();
    if (!/^[A-Z0-9\-]{3,20}$/.test(psv)) {
      errors.psvNumber = 'PSV運転手許可番号は英数字3〜20文字で入力してください。';
    } else out.psvNumber = psv;

    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, identity: out };
  }

  function validateDriverVehicle(input) {
    input = isPlainObject(input) ? input : {};
    var errors = {};
    var out = {};
    rejectServerOwnedFields(input, errors);

    var plate = normalizePlate(input.plate);
    if (plate.error) errors.plate = plate.error; else out.plate = plate.value;

    var model = validateName(input.vehicleDesc, '車種・色');
    if (model.error) errors.vehicleDesc = model.error; else out.vehicleDesc = model.value;

    var permit = trimmed(input.taxiPermitNumber).toUpperCase();
    if (!/^[A-Z0-9\-]{3,20}$/.test(permit)) {
      errors.taxiPermitNumber = 'Taxi Permit番号は英数字3〜20文字で入力してください。';
    } else out.taxiPermitNumber = permit;

    // 名義人と運転手は別人でよい（許可された割当を審査で確認する）
    var holder = validateName(input.permitHolder, '営業許可の名義人');
    if (holder.error) errors.permitHolder = holder.error; else out.permitHolder = holder.value;

    var scope = validateName(input.operatingScope, 'Base / Stand・営業範囲');
    if (scope.error) errors.operatingScope = scope.error; else out.operatingScope = scope.value;

    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, vehicle: out };
  }

  function validateDriverDocuments(input, nowMs) {
    input = isPlainObject(input) ? input : {};
    var errors = {};
    var out = {};
    rejectServerOwnedFields(input, errors);

    DOCUMENT_KEYS.forEach(function (doc) {
      var res = validateFutureDate(input[doc.id + 'Expiry'], nowMs, doc.label);
      if (res.error) errors[doc.id + 'Expiry'] = res.error;
      else out[doc.id + 'Expiry'] = res.value;
    });

    if (input.consent !== true) {
      errors.consent = '申請内容の確認と審査への同意が必要です。';
    }

    if (Object.keys(errors).length) return { ok: false, errors: errors };
    return { ok: true, documents: out };
  }

  /**
   * 3段階すべてを検証し、申請を「審査待ち」として確定する。
   * 承認状態は常に pending_review。クライアントは承認を設定できない。
   */
  function submitDriverApplication(steps, nowMs) {
    steps = isPlainObject(steps) ? steps : {};
    var identity = validateDriverIdentity(steps.identity);
    var vehicle = validateDriverVehicle(steps.vehicle);
    var documents = validateDriverDocuments(steps.documents, nowMs);
    if (!identity.ok || !vehicle.ok || !documents.ok) {
      return {
        ok: false,
        errors: {
          identity: identity.ok ? {} : identity.errors,
          vehicle: vehicle.ok ? {} : vehicle.errors,
          documents: documents.ok ? {} : documents.errors
        }
      };
    }
    return {
      ok: true,
      application: {
        role: 'driver',
        identity: identity.identity,
        vehicle: vehicle.vehicle,
        documents: documents.documents,
        reviewStatus: 'pending_review', // サーバー審査が完了するまで固定
        submittedAt: new Date(nowMs).toISOString()
      }
    };
  }

  // ---- 審査状態と操作可否 --------------------------------------------------

  var BLOCKED_REASONS = {
    pending_review: '審査待ちのため、依頼の受付・料金提示・迎車はできません。',
    expired: '書類の有効期限が切れています。更新後に再審査が必要です。',
    suspended: '営業資格が停止中です。受付できません。',
    unknown: '審査状態を確認できません。受付できません。'
  };

  /**
   * 運転手の操作可否。approved 以外はすべて営業系操作を拒否する。
   * approved は本番ではサーバー応答からのみ与えられる想定。
   */
  function driverCapabilities(reviewStatus) {
    if (reviewStatus === 'approved') {
      return { canGoOnDuty: true, canQuote: true, canStartPickup: true, reason: '' };
    }
    var reason = BLOCKED_REASONS[reviewStatus] || BLOCKED_REASONS.unknown;
    return { canGoOnDuty: false, canQuote: false, canStartPickup: false, reason: reason };
  }

  // ---- 保存・復帰（登録途中の下書きを含む） --------------------------------

  function emptyStore() {
    return {
      version: SCHEMA_VERSION,
      passengerProfile: null,
      driverApplication: null,
      passengerDraft: null,
      driverDraft: null
    };
  }

  function serializeStore(store) {
    var s = isPlainObject(store) ? store : {};
    return JSON.stringify({
      version: SCHEMA_VERSION,
      passengerProfile: isPlainObject(s.passengerProfile) ? s.passengerProfile : null,
      driverApplication: isPlainObject(s.driverApplication) ? s.driverApplication : null,
      passengerDraft: isPlainObject(s.passengerDraft) ? s.passengerDraft : null,
      driverDraft: isPlainObject(s.driverDraft) ? s.driverDraft : null
    });
  }

  /**
   * 保存文字列から状態を復元。壊れた/別版のデータは黙って初期状態に戻す
   * （復帰できないより、安全な空状態を優先する）。
   * 運転手申請は復元時も pending 系以外の承認値を信用しない。
   */
  function deserializeStore(raw) {
    var fallback = emptyStore();
    if (typeof raw !== 'string' || !raw) return fallback;
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
    if (!isPlainObject(parsed) || parsed.version !== SCHEMA_VERSION) return fallback;
    var store = emptyStore();
    if (isPlainObject(parsed.passengerProfile) && parsed.passengerProfile.role === 'passenger') {
      store.passengerProfile = parsed.passengerProfile;
    }
    if (isPlainObject(parsed.driverApplication) && parsed.driverApplication.role === 'driver') {
      var app = parsed.driverApplication;
      // 端末保存から承認状態を復元しない。サーバー確認まで常に審査待ち扱い。
      if (app.reviewStatus !== 'pending_review') {
        app = Object.assign({}, app, { reviewStatus: 'pending_review' });
      }
      store.driverApplication = app;
    }
    if (isPlainObject(parsed.passengerDraft)) store.passengerDraft = parsed.passengerDraft;
    if (isPlainObject(parsed.driverDraft)) store.driverDraft = parsed.driverDraft;
    return store;
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    COUNTRY_CODES: COUNTRY_CODES,
    LANGUAGES: LANGUAGES,
    PAYMENTS: PAYMENTS,
    DOCUMENT_KEYS: DOCUMENT_KEYS,
    parseGoogleIdToken: parseGoogleIdToken,
    validatePassengerProfile: validatePassengerProfile,
    validateDriverIdentity: validateDriverIdentity,
    validateDriverVehicle: validateDriverVehicle,
    validateDriverDocuments: validateDriverDocuments,
    submitDriverApplication: submitDriverApplication,
    driverCapabilities: driverCapabilities,
    emptyStore: emptyStore,
    serializeStore: serializeStore,
    deserializeStore: deserializeStore
  };
});
