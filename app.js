/*
 * app.js — 役割別オンボーディングUI（利用者/運転手の選択 → 役割別登録 → 専用ホーム）
 *
 * 対応範囲（Issue #3 の最初の成果物）:
 *   役割選択、利用者登録→利用者ホーム、運転手3段階登録→審査待ちホーム。
 * 未接続（このコミット時点）:
 *   実認証・サーバー保存・別端末同期・審査API・配車/料金提示・Google Maps 実通信。
 *   登録内容はこの端末の localStorage のみに保存し、審査状態は常に「審査待ち」。
 */
(function () {
  'use strict';

  var Core = window.OnboardingCore;
  var root = document.getElementById('app');
  var STORAGE_KEY = 'taxiProtection.onboarding.v1';

  var store = loadStore();

  function loadStore() {
    try {
      return Core.deserializeStore(window.localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return Core.emptyStore();
    }
  }

  function saveStore() {
    try {
      window.localStorage.setItem(STORAGE_KEY, Core.serializeStore(store));
    } catch (e) {
      /* 保存できない環境（プライベートモード等）でも操作は継続できる */
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function labelOf(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].label;
    return id || '';
  }

  // ---- 線画アイコン（1.6px ストローク） ----------------------------------
  function icon(name, size) {
    var s = size || 22;
    var paths = {
      user: '<circle cx="12" cy="8" r="3.4"/><path d="M5 19c1.4-3 4-4.4 7-4.4S17.6 16 19 19"/>',
      wheel: '<circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="2.2"/><path d="M12 14.2V20M9.9 11 4 9.8M14.1 11 20 9.8"/>',
      car: '<path d="M5 12.5 6.6 8c.3-.8 1-1.3 1.9-1.3h7c.9 0 1.6.5 1.9 1.3L19 12.5"/><path d="M4.5 12.5h15c.6 0 1 .4 1 1v3.2h-2.2M4.5 12.5c-.6 0-1 .4-1 1v3.2h2.2"/><circle cx="7.8" cy="16.7" r="1.7"/><circle cx="16.2" cy="16.7" r="1.7"/><path d="M9.5 16.7h5"/>',
      shield: '<path d="M12 3.5 5.5 6v5c0 4.2 2.8 7.3 6.5 9 3.7-1.7 6.5-4.8 6.5-9V6Z"/><path d="m9.2 11.8 2 2 3.8-3.9"/>',
      clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/>',
      card: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><circle cx="8.6" cy="11" r="1.8"/><path d="M6.4 15.3c.5-1.2 1.3-1.8 2.2-1.8s1.7.6 2.2 1.8M13.8 9.8h4M13.8 12.8h4"/>',
      home: '<path d="m4.5 11 7.5-6.5L19.5 11"/><path d="M6.5 9.5V19h11V9.5"/>',
      inbox: '<path d="M4.5 13.5h4l1.5 2h4l1.5-2h4"/><path d="M6 5.5h12l1.5 8V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18v-4.5Z"/>',
      route: '<circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="6.5" r="2"/><path d="M8.5 17.5H15a2.5 2.5 0 0 0 0-5H9a2.5 2.5 0 0 1 0-5h6.5"/>',
      back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
      next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
      warn: '<path d="M12 4.5 3.5 19h17Z"/><path d="M12 10v4M12 16.4v.4"/>',
      pin: '<path d="M12 21s-6.5-5.7-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.3 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.3"/>'
    };
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true">' + (paths[name] || '') + '</svg>';
  }

  // ---- ルーティング --------------------------------------------------------
  function currentRoute() {
    var h = (window.location.hash || '').replace(/^#\/?/, '');
    return h ? h.split('/') : [];
  }

  function go(path) {
    if (('#/' + path) === window.location.hash) render();
    else window.location.hash = '#/' + path;
  }

  window.addEventListener('hashchange', render);

  function render() {
    var r = currentRoute();
    window.scrollTo(0, 0);
    if (r[0] === 'passenger' && r[1] === 'register') return renderPassengerRegister();
    if (r[0] === 'passenger' && r[1] === 'home') {
      if (!store.passengerProfile) return go('passenger/register');
      return renderPassengerHome(r[2] || 'ride');
    }
    if (r[0] === 'driver' && r[1] === 'register') return renderDriverRegister();
    if (r[0] === 'driver' && r[1] === 'home') {
      if (!store.driverApplication) return go('driver/register');
      return renderDriverHome(r[2] || 'main');
    }
    return renderRoleChooser();
  }

  function topbar(showBack, control) {
    return '<header class="topbar">' +
      (showBack
        ? '<button class="text-control" data-go="roles">' + icon('back', 16) + '役割選択</button>'
        : '<span class="brand">Taxi Protection</span>') +
      (control || '') +
      '</header>';
  }

  // ---- 役割選択 ------------------------------------------------------------
  function renderRoleChooser() {
    var p = store.passengerProfile;
    var d = store.driverApplication;
    root.innerHTML =
      topbar(false) +
      '<h1>どちらで利用しますか？</h1>' +
      '<p class="lede">役割ごとに登録内容と画面が分かれます。あとからもう一方も登録できます。</p>' +
      '<div class="stack">' +
        '<button class="role-card" id="choose-passenger">' +
          '<span class="role-icon">' + icon('user', 26) + '</span>' +
          '<span class="role-copy"><strong>利用者として使う</strong>' +
          '<small>' + (p ? esc(p.displayName) + ' さん・登録済み' : '行き先を伝えて、料金と車両を比べて選ぶ') + '</small></span>' +
          (p ? '<span class="role-status">ホームへ</span>' : '<span class="chev">' + icon('next', 16) + '</span>') +
        '</button>' +
        '<button class="role-card" id="choose-driver">' +
          '<span class="role-icon">' + icon('wheel', 26) + '</span>' +
          '<span class="role-copy"><strong>運転手として使う</strong>' +
          '<small>' + (d ? esc(d.identity.fullName) + ' さん・申請済み（審査待ち）' : '本人・車両・営業許可を登録して審査を受ける') + '</small></span>' +
          (d ? '<span class="role-status">ホームへ</span>' : '<span class="chev">' + icon('next', 16) + '</span>') +
        '</button>' +
      '</div>' +
      '<p class="footnote">登録内容はこの端末にのみ保存されます（本人確認・サーバー保存・別端末同期は未接続の試験版です）。</p>';

    bind('#choose-passenger', function () {
      go(store.passengerProfile ? 'passenger/home/ride' : 'passenger/register');
    });
    bind('#choose-driver', function () {
      go(store.driverApplication ? 'driver/home/main' : 'driver/register');
    });
  }

  // ---- フォーム部品 ----------------------------------------------------------
  function fieldText(id, label, value, opts) {
    opts = opts || {};
    return '<label class="field" for="' + id + '"><span>' + esc(label) +
      (opts.hint ? ' <span class="hint">' + esc(opts.hint) + '</span>' : '') + '</span>' +
      '<input id="' + id + '" type="' + (opts.type || 'text') + '" value="' + esc(value || '') + '"' +
      (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') +
      ' autocomplete="off" />' +
      '<p class="error-text" id="' + id + '-error" hidden></p></label>';
  }

  function fieldSelect(id, label, options, value) {
    var opts = options.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === value ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    return '<label class="field" for="' + id + '"><span>' + esc(label) + '</span>' +
      '<select id="' + id + '">' + opts + '</select>' +
      '<p class="error-text" id="' + id + '-error" hidden></p></label>';
  }

  function fieldPhone(ccId, phoneId, label, cc, phone) {
    var opts = Core.COUNTRY_CODES.map(function (o) {
      return '<option value="' + esc(o.id) + '"' + (o.id === (cc || '+679') ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
    return '<div class="field"><span>' + esc(label) + '</span>' +
      '<div class="phone-row">' +
        '<select id="' + ccId + '" aria-label="国番号">' + opts + '</select>' +
        '<input id="' + phoneId + '" type="tel" inputmode="numeric" value="' + esc(phone || '') + '" placeholder="7012345" aria-label="電話番号" />' +
      '</div><p class="error-text" id="' + phoneId + '-error" hidden></p></div>';
  }

  function fieldConsent(id, text, isChecked) {
    return '<label class="checkbox"><input type="checkbox" id="' + id + '"' + (isChecked ? ' checked' : '') + ' />' +
      '<span>' + esc(text) + '</span></label>' +
      '<p class="error-text" id="' + id + '-error" hidden></p>';
  }

  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function checkedOf(id) { var el = document.getElementById(id); return !!(el && el.checked); }

  function showErrors(errors, idMap) {
    root.querySelectorAll('.error-text').forEach(function (el) { el.hidden = true; });
    root.querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); });
    var firstId = null;
    Object.keys(errors || {}).forEach(function (key) {
      var id = idMap[key];
      if (!id) return;
      var msg = document.getElementById(id + '-error');
      var input = document.getElementById(id);
      if (msg) { msg.textContent = errors[key]; msg.hidden = false; }
      if (input) input.classList.add('invalid');
      if (!firstId) firstId = id;
    });
    if (firstId) {
      var el = document.getElementById(firstId);
      if (el && el.focus) el.focus();
    }
  }

  function bind(sel, fn) {
    var el = root.querySelector(sel);
    if (el) el.addEventListener('click', fn);
  }

  function bindNav() {
    root.querySelectorAll('[data-go]').forEach(function (el) {
      el.addEventListener('click', function () { go(el.getAttribute('data-go')); });
    });
  }

  // ---- 利用者登録 ------------------------------------------------------------
  function renderPassengerRegister() {
    var editing = !!store.passengerProfile;
    var src = store.passengerProfile || store.passengerDraft || {};
    var phoneLocal = src.phoneLocal != null ? src.phoneLocal
      : (src.phone ? String(src.phone).split(' ')[1] || '' : '');

    root.innerHTML =
      topbar(true, '<button class="small-action" id="fill-sample" type="button">サンプル情報を入力する</button>') +
      '<h1>' + (editing ? '利用者の登録情報を編集' : '利用者の登録') + '</h1>' +
      '<p class="lede">配車の連絡に必要な項目だけを確認します。免許や営業許可の入力は不要です。</p>' +
      '<form class="card stack" id="passenger-form" novalidate>' +
        fieldText('p-name', '表示名', src.displayName, { placeholder: '例: 佐藤 花子' }) +
        fieldPhone('p-cc', 'p-phone', '連絡先（国番号付き）', src.countryCode, phoneLocal) +
        fieldText('p-email', 'メールアドレス', src.email, { type: 'email', hint: '（任意）', placeholder: 'hana@example.com' }) +
        fieldSelect('p-lang', '連絡に使う言語', Core.LANGUAGES, src.language || 'ja') +
        fieldText('p-pickup', '滞在先・よく使う乗車地点', src.defaultPickup, { hint: '（任意）', placeholder: '例: Nadi マリーナホテル' }) +
        fieldSelect('p-pay', '希望する支払い方法', Core.PAYMENTS, src.payment || 'cash') +
        fieldConsent('p-consent', '利用条件と、連絡先を配車の連絡にのみ使うことに同意します。', editing) +
        '<button class="primary" type="submit">' + (editing ? '変更を保存する' : '登録して利用者ホームへ') + '</button>' +
      '</form>' +
      '<p class="footnote">連絡先の実認証（SMS等）は未接続です。入力途中の内容はこの端末に自動保存されます。</p>';

    bindNav();
    var form = document.getElementById('passenger-form');

    function collect() {
      return {
        displayName: val('p-name'),
        countryCode: val('p-cc'),
        phone: val('p-phone'),
        email: val('p-email'),
        language: val('p-lang'),
        defaultPickup: val('p-pickup'),
        payment: val('p-pay'),
        consent: checkedOf('p-consent')
      };
    }

    // 登録途中の復帰: 入力のたびに下書き保存（既存プロフィール編集中は下書きにしない）
    form.addEventListener('input', function () {
      if (editing) return;
      var c = collect();
      store.passengerDraft = {
        displayName: c.displayName, countryCode: c.countryCode, phoneLocal: c.phone,
        email: c.email, language: c.language, defaultPickup: c.defaultPickup, payment: c.payment
      };
      saveStore();
    });

    bind('#fill-sample', function () {
      var samples = {
        'p-name': '佐藤 花子', 'p-cc': '+679', 'p-phone': '7012345',
        'p-email': 'hana@example.com', 'p-lang': 'ja',
        'p-pickup': 'Nadi マリーナホテル', 'p-pay': 'cash'
      };
      Object.keys(samples).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = samples[id];
      });
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var result = Core.validatePassengerProfile(collect());
      if (!result.ok) {
        showErrors(result.errors, {
          displayName: 'p-name', phone: 'p-phone', email: 'p-email',
          language: 'p-lang', defaultPickup: 'p-pickup', payment: 'p-pay', consent: 'p-consent'
        });
        return;
      }
      store.passengerProfile = result.profile;
      store.passengerDraft = null;
      saveStore();
      go('passenger/home/ride');
    });
  }

  // ---- 利用者ホーム ------------------------------------------------------------
  var PASSENGER_TABS = [
    { id: 'ride', label: '配車', icon: 'car' },
    { id: 'check', label: '車両確認', icon: 'shield' },
    { id: 'history', label: '履歴', icon: 'clock' },
    { id: 'profile', label: '登録情報', icon: 'card' }
  ];

  function tabbar(tabs, active, basePath) {
    return '<nav class="tabbar" aria-label="メニュー"><div class="tabbar-inner">' +
      tabs.map(function (t) {
        return '<button data-go="' + basePath + '/' + t.id + '" class="' + (t.id === active ? 'active' : '') + '"' +
          (t.id === active ? ' aria-current="page"' : '') + '>' + icon(t.icon, 22) + esc(t.label) + '</button>';
      }).join('') + '</div></nav>';
  }

  function kvRow(k, v) {
    return '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>';
  }

  function resetDevice() {
    if (!window.confirm('この端末に保存した登録・申請データをすべて消します。よろしいですか？')) return;
    store = Core.emptyStore();
    saveStore();
    go('roles');
  }

  function renderPassengerHome(tab) {
    var p = store.passengerProfile;
    var body = '';

    if (tab === 'ride') {
      body =
        '<h1>こんにちは、' + esc(p.displayName) + ' さん</h1>' +
        '<p class="lede">どこへ行きますか？</p>' +
        '<div class="stack-lg">' +
          '<div class="map-demo" role="img" aria-label="略地図（デモ表示）">' +
            '<span class="map-tag">略地図・デモ表示（Google Maps 未接続）</span>' +
            '<span class="pin">' + icon('pin', 30) + '</span>' +
          '</div>' +
          '<div class="card stack">' +
            fieldText('ride-pickup', '乗車地点', p.defaultPickup, { placeholder: '例: Nadi マリーナホテル' }) +
            fieldText('ride-dest', '行き先', '', { placeholder: '例: ナンディ国際空港' }) +
            '<button class="primary" id="find-offers">料金を比較する</button>' +
            '<p class="inline-note" id="ride-note" hidden>運転手の料金提示・比較は本番APIが未接続のため、この次の実装で有効になります。今回は行き先の入力までを確認できます。</p>' +
          '</div>' +
          '<div class="banner info">' + icon('shield', 20) +
            '<span><strong>Taxi Protection</strong>配車が確定すると、予約した車両・運転手との照合を「車両確認」タブで行えます。</span>' +
          '</div>' +
        '</div>';
    } else if (tab === 'check') {
      body =
        '<h1>車両確認</h1>' +
        '<p class="lede">迎えに来た車が予約どおりか、乗る前に照合します。</p>' +
        '<div class="card stack">' +
          '<p>配車が確定すると、ここで観測したナンバープレートと予約車両・運転手の登録情報を照合できます。</p>' +
          '<p class="inline-note">現在、配車と車両照合の本番APIは未接続です。配車機能の接続後に有効になります。</p>' +
        '</div>';
    } else if (tab === 'history') {
      body =
        '<h1>依頼・乗車履歴</h1>' +
        '<div class="card"><div class="empty">まだ依頼はありません。<br />配車の接続後、ここに依頼と乗車の記録が表示されます。</div></div>';
    } else {
      body =
        '<h1>利用者の登録情報</h1>' +
        '<div class="stack-lg">' +
          '<dl class="kv card">' +
            kvRow('表示名', p.displayName) +
            kvRow('連絡先', p.phone) +
            kvRow('メール', p.email || '未登録') +
            kvRow('連絡に使う言語', labelOf(Core.LANGUAGES, p.language)) +
            kvRow('既定の乗車地点', p.defaultPickup || '未設定') +
            kvRow('支払い方法', labelOf(Core.PAYMENTS, p.payment)) +
          '</dl>' +
          '<button class="secondary" data-go="passenger/register">登録情報を編集する</button>' +
          '<button class="small-action" id="reset-device">この端末の登録データをすべて消す</button>' +
        '</div>';
    }

    root.innerHTML = topbar(true) + body + tabbar(PASSENGER_TABS, tab, 'passenger/home');
    bindNav();
    bind('#find-offers', function () {
      var note = document.getElementById('ride-note');
      if (note) note.hidden = false;
    });
    bind('#reset-device', resetDevice);
  }

  // ---- 運転手登録（3段階） ------------------------------------------------------
  var DRIVER_STEPS = ['本人・運転資格', '車両・営業許可', '確認書類・期限'];

  function renderDriverRegister() {
    var editing = !!store.driverApplication;
    var draft = store.driverDraft || {};
    var app = store.driverApplication;
    var values = draft.values || (app ? {
      fullName: app.identity.fullName,
      countryCode: app.identity.countryCode,
      phone: (app.identity.phone || '').split(' ')[1] || '',
      licenceNumber: app.identity.licenceNumber,
      psvNumber: app.identity.psvNumber,
      plate: app.vehicle.plate,
      vehicleDesc: app.vehicle.vehicleDesc,
      taxiPermitNumber: app.vehicle.taxiPermitNumber,
      permitHolder: app.vehicle.permitHolder,
      operatingScope: app.vehicle.operatingScope,
      licenceExpiry: app.documents.licenceExpiry,
      psvExpiry: app.documents.psvExpiry,
      permitExpiry: app.documents.permitExpiry
    } : {});
    var step = Math.min(Math.max(draft.step || 0, 0), 2);

    var stepsHtml = '<ol class="steps">' + DRIVER_STEPS.map(function (label, i) {
      var cls = i === step ? 'current' : (i < step ? 'done' : '');
      return '<li class="' + cls + '">' + (i + 1) + '. ' + esc(label) + '</li>';
    }).join('') + '</ol>';

    var fields = '';
    if (step === 0) {
      fields =
        fieldText('d-name', '運転手氏名', values.fullName, { placeholder: '例: ジョネ・ラウ' }) +
        fieldPhone('d-cc', 'd-phone', '連絡先（国番号を含む）', values.countryCode, values.phone) +
        fieldText('d-licence', '運転免許番号', values.licenceNumber, { placeholder: '例: FJ-DL-48213' }) +
        fieldText('d-psv', 'PSV運転手許可番号', values.psvNumber, { placeholder: '例: PSV-2291' });
    } else if (step === 1) {
      fields =
        fieldText('d-plate', '車両ナンバー', values.plate, { placeholder: '例: LT 4821' }) +
        fieldText('d-vehicle', '車種・色', values.vehicleDesc, { placeholder: '例: トヨタ・カローラ／白' }) +
        fieldText('d-permit', 'Taxi Permit番号', values.taxiPermitNumber, { placeholder: '例: TP-0771' }) +
        fieldText('d-holder', '営業許可の名義人', values.permitHolder, { hint: '（運転手本人と別でも可）', placeholder: '例: ナンディ・タクシー組合' }) +
        fieldText('d-scope', 'Base / Stand・営業範囲', values.operatingScope, { placeholder: '例: Nadi Base（空港送迎を除く）' });
    } else {
      fields =
        '<h2>確認書類と有効期限</h2>' +
        '<p class="footnote">書類画像のアップロードは未接続です。有効期限のみ入力してください。期限切れの書類では申請できません。</p>' +
        fieldText('d-exp-licence', '運転免許の有効期限', values.licenceExpiry, { type: 'date' }) +
        fieldText('d-exp-psv', 'PSV運転手許可の有効期限', values.psvExpiry, { type: 'date' }) +
        fieldText('d-exp-permit', 'Taxi Permitの有効期限', values.permitExpiry, { type: 'date' }) +
        fieldConsent('d-consent', '申請内容が事実であること、審査（発行元確認を含む）が完了するまで営業できないことに同意します。', false);
    }

    root.innerHTML =
      topbar(true, '<button class="small-action" id="fill-sample" type="button">サンプル情報を入力する</button>') +
      '<h1>' + (editing ? '申請内容の修正' : 'タクシー登録申請') + '</h1>' +
      '<p class="lede">' + (editing
        ? '修正した内容も、あらためて審査の対象になります。'
        : '3つのステップで申請します。申請は承認ではなく、審査完了までは営業できません。') + '</p>' +
      stepsHtml +
      '<form class="card stack" id="driver-form" novalidate>' +
        fields +
        '<div class="btn-row">' +
          (step > 0 ? '<button class="secondary" type="button" id="step-back">戻る</button>' : '') +
          '<button class="primary" type="submit" id="step-next">' +
            (step < 2 ? '次へ' : (editing ? '修正を申請する' : '申請する')) + '</button>' +
        '</div>' +
      '</form>' +
      '<p class="footnote">入力途中の内容はこの端末に自動保存され、途中から再開できます。</p>';

    bindNav();
    var form = document.getElementById('driver-form');

    function collectStep() {
      if (step === 0) {
        return {
          fullName: val('d-name'), countryCode: val('d-cc'), phone: val('d-phone'),
          licenceNumber: val('d-licence'), psvNumber: val('d-psv')
        };
      }
      if (step === 1) {
        return {
          plate: val('d-plate'), vehicleDesc: val('d-vehicle'),
          taxiPermitNumber: val('d-permit'), permitHolder: val('d-holder'),
          operatingScope: val('d-scope')
        };
      }
      return {
        licenceExpiry: val('d-exp-licence'), psvExpiry: val('d-exp-psv'),
        permitExpiry: val('d-exp-permit'), consent: checkedOf('d-consent')
      };
    }

    function saveDraft(nextStep) {
      var merged = Object.assign({}, values, collectStep());
      store.driverDraft = { step: nextStep != null ? nextStep : step, values: merged };
      saveStore();
      return merged;
    }

    form.addEventListener('input', function () { saveDraft(); });

    bind('#fill-sample', function () {
      var now = new Date();
      var nextYear = (now.getFullYear() + 1) + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
      // 全ステップ分を下書きへ入れ、表示中のステップの入力欄にも反映する
      values = Object.assign({}, values, {
        fullName: 'ジョネ・ラウ', countryCode: '+679', phone: '9923456',
        licenceNumber: 'FJ-DL-48213', psvNumber: 'PSV-2291',
        plate: 'LT 4821', vehicleDesc: 'トヨタ・カローラ／白',
        taxiPermitNumber: 'TP-0771', permitHolder: 'ナンディ・タクシー組合',
        operatingScope: 'Nadi Base（空港送迎を除く）',
        licenceExpiry: nextYear, psvExpiry: nextYear, permitExpiry: nextYear
      });
      var domIds = {
        'd-name': values.fullName, 'd-cc': values.countryCode, 'd-phone': values.phone,
        'd-licence': values.licenceNumber, 'd-psv': values.psvNumber,
        'd-plate': values.plate, 'd-vehicle': values.vehicleDesc,
        'd-permit': values.taxiPermitNumber, 'd-holder': values.permitHolder,
        'd-scope': values.operatingScope,
        'd-exp-licence': values.licenceExpiry, 'd-exp-psv': values.psvExpiry,
        'd-exp-permit': values.permitExpiry
      };
      Object.keys(domIds).forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = domIds[id];
      });
      saveDraft();
    });

    bind('#step-back', function () {
      saveDraft(step - 1);
      renderDriverRegister();
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var merged = saveDraft();
      var now = Date.now();

      if (step === 0) {
        var r1 = Core.validateDriverIdentity(merged);
        if (!r1.ok) return showErrors(r1.errors, { fullName: 'd-name', phone: 'd-phone', licenceNumber: 'd-licence', psvNumber: 'd-psv' });
        saveDraft(1);
        return renderDriverRegister();
      }
      if (step === 1) {
        var r2 = Core.validateDriverVehicle(merged);
        if (!r2.ok) return showErrors(r2.errors, { plate: 'd-plate', vehicleDesc: 'd-vehicle', taxiPermitNumber: 'd-permit', permitHolder: 'd-holder', operatingScope: 'd-scope' });
        saveDraft(2);
        return renderDriverRegister();
      }

      var result = Core.submitDriverApplication({
        identity: merged, vehicle: merged, documents: merged
      }, now);
      if (!result.ok) {
        var errs = result.errors;
        if (Object.keys(errs.identity).length) { saveDraft(0); return renderDriverRegister(); }
        if (Object.keys(errs.vehicle).length) { saveDraft(1); return renderDriverRegister(); }
        return showErrors(errs.documents, {
          licenceExpiry: 'd-exp-licence', psvExpiry: 'd-exp-psv',
          permitExpiry: 'd-exp-permit', consent: 'd-consent'
        });
      }
      store.driverApplication = result.application;
      store.driverDraft = null;
      saveStore();
      go('driver/home/main');
    });
  }

  // ---- 運転手ホーム --------------------------------------------------------------
  var DRIVER_TABS = [
    { id: 'main', label: 'ホーム', icon: 'home' },
    { id: 'requests', label: '依頼', icon: 'inbox' },
    { id: 'trips', label: '運行', icon: 'route' },
    { id: 'profile', label: '登録情報', icon: 'card' }
  ];

  function pendingBanner(caps) {
    return '<div class="banner warn" role="status">' + icon('warn', 20) +
      '<span><strong>審査待ちです</strong>' + esc(caps.reason) +
      ' 書類の提出は承認ではありません。審査の完了をお待ちください。</span></div>';
  }

  function renderDriverHome(tab) {
    var app = store.driverApplication;
    var caps = Core.driverCapabilities(app.reviewStatus);
    var body = '';

    if (tab === 'main') {
      body =
        '<h1>' + esc(app.identity.fullName) + ' さんの運転手ホーム</h1>' +
        '<div class="stack-lg">' +
          pendingBanner(caps) +
          '<div class="card">' +
            '<h2>登録車両と営業範囲</h2>' +
            '<dl class="kv">' +
              kvRow('車両ナンバー', app.vehicle.plate) +
              kvRow('車種・色', app.vehicle.vehicleDesc) +
              kvRow('営業許可の名義人', app.vehicle.permitHolder) +
              kvRow('Base / Stand・営業範囲', app.vehicle.operatingScope) +
              '<div><dt>審査状態</dt><dd><span class="status-pill">審査待ち</span></dd></div>' +
            '</dl>' +
          '</div>' +
          '<div class="card stack">' +
            '<h2>依頼の受付</h2>' +
            '<button class="primary" disabled>審査待ちのため受付できません</button>' +
            '<p class="footnote">審査が完了すると、ここから受付を開始し、依頼への料金提示ができるようになります。</p>' +
          '</div>' +
        '</div>';
    } else if (tab === 'requests') {
      body =
        '<h1>依頼と料金提示</h1>' +
        '<div class="stack-lg">' +
          pendingBanner(caps) +
          '<div class="card"><div class="empty">審査完了後に、営業範囲内の依頼がここに表示され、料金提示ができるようになります。</div></div>' +
        '</div>';
    } else if (tab === 'trips') {
      body =
        '<h1>担当する運行</h1>' +
        '<div class="stack-lg">' +
          pendingBanner(caps) +
          '<div class="card"><div class="empty">利用者に提示額が選ばれると、担当する運行がここに表示されます。審査完了後に有効になります。</div></div>' +
        '</div>';
    } else {
      body =
        '<h1>運転手の登録情報</h1>' +
        '<div class="stack-lg">' +
          '<div class="card">' +
            '<h2>本人・運転資格</h2>' +
            '<dl class="kv">' +
              kvRow('氏名', app.identity.fullName) +
              kvRow('連絡先', app.identity.phone) +
              kvRow('運転免許番号', app.identity.licenceNumber) +
              kvRow('PSV運転手許可番号', app.identity.psvNumber) +
            '</dl>' +
          '</div>' +
          '<div class="card">' +
            '<h2>車両・営業許可</h2>' +
            '<dl class="kv">' +
              kvRow('車両ナンバー', app.vehicle.plate) +
              kvRow('車種・色', app.vehicle.vehicleDesc) +
              kvRow('Taxi Permit番号', app.vehicle.taxiPermitNumber) +
              kvRow('営業許可の名義人', app.vehicle.permitHolder) +
              kvRow('営業範囲', app.vehicle.operatingScope) +
            '</dl>' +
          '</div>' +
          '<div class="card">' +
            '<h2>確認書類の有効期限</h2>' +
            '<dl class="kv">' +
              kvRow('運転免許', app.documents.licenceExpiry) +
              kvRow('PSV運転手許可', app.documents.psvExpiry) +
              kvRow('Taxi Permit', app.documents.permitExpiry) +
              kvRow('申請日時', new Date(app.submittedAt).toLocaleString('ja-JP')) +
            '</dl>' +
          '</div>' +
          '<button class="secondary" data-go="driver/register">申請内容を修正する（再審査になります）</button>' +
          '<button class="small-action" id="reset-device">この端末の登録データをすべて消す</button>' +
        '</div>';
    }

    root.innerHTML = topbar(true) + body + tabbar(DRIVER_TABS, tab, 'driver/home');
    bindNav();
    bind('#reset-device', resetDevice);
  }

  render();
})();
