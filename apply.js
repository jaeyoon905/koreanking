// 라벨코스트 — 검증부. 서류 종류별 "대조(reconcile)"와 "반영(apply)" 규칙. 추출이 AI로 오든 fixture로 오든 여기로 들어온다.
// 입력은 {k: v} 객체, 상태는 app.js 가 소유(ledger, raw, registry, shipments, nutritionSources, docs, specForms, labels, processLog).
var LC = (typeof LC !== 'undefined') ? LC : {};

(function () {
  function upsert(arr, key, val, row) { // 같은 key 있으면 row 의 키만 덮어쓰고 false, 없으면 push 하고 true
    for (var i = 0; i < arr.length; i++) if (arr[i][key] === val) { for (var k in row) arr[i][k] = row[k]; return false; }
    arr.push(row); return true;
  }
  function find(arr, key, val) { for (var i = 0; i < arr.length; i++) if (arr[i][key] === val) return arr[i]; return null; }
  function ymd(iso) { return String(iso || '').replace(/-/g, '').slice(0, 8); }
  function prevDay(iso) { var d = new Date(iso); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  function num(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? null : n; }
  function abbrOf(raw) { return raw && raw.vessel ? raw.vessel.charAt(0) : ''; }
  function rawByAbbr(s, a) { // 약어 → 입고분. 실측(kg>0) 우선
    var hit = null;
    s.raw.forEach(function (r) { if (abbrOf(r) === a && (!hit || (!hit.kg && r.kg))) hit = r; });
    return hit;
  }
  function ensure(s) { // app.js 가 안 만든 키 방어
    ['ledger', 'raw', 'registry', 'shipments', 'nutritionSources', 'labels', 'importShipments'].forEach(function (k) { s[k] = s[k] || []; });
    s.specForms = s.specForms || {}; s.processLog = s.processLog || {};
  }
  // 로트의 원료 연결. 그날 가공일지 약어가 있으면 그 입고분들, 없으면 제조일 이전 가장 가까운 입고분 1건
  function linkRaw(s, lot) {
    var abbrs = s.processLog[lot.mfg];
    if (abbrs) {
      var ids = []; abbrs.forEach(function (a) { var r = rawByAbbr(s, a); if (r && ids.indexOf(r.id) < 0) ids.push(r.id); });
      if (ids.length) { lot.raw = ids; return; }
    }
    if (lot.raw && lot.raw.length) return;
    var best = null;
    s.raw.forEach(function (r) { if (r.received <= lot.mfg && (!best || r.received > best.received)) best = r; });
    lot.raw = best ? [best.id] : [];
  }
  function relinkAll(s) { s.ledger.forEach(function (l) { linkRaw(s, l); }); }
  function shipLabel(o) { return o.invoice_no + ' / ' + o.departure + ' ' + (o.route ? o.route.replace(/\s*→\s*/, '→') : (o.from || '') + '→' + (o.to || '')); }
  function certLabel(o) { return '수품원 위생증명서 ' + o.date + (o.form ? ' (' + o.form + ')' : ''); }
  function parseNutrition(v) {
    if (v && typeof v === 'object') return v;
    var t = String(v || ''), g = function (re) { var m = t.match(re); return m ? parseFloat(m[1]) : null; };
    return { kcal: g(/([\d.]+)\s*kcal/i), protein: g(/たんぱく質\s*([\d.]+)/), fat: g(/脂質\s*([\d.]+)/), carb: g(/炭水化物\s*([\d.]+)/), salt_g: g(/食塩相当量\s*([\d.]+)/) };
  }
  function ingredientsOf(ingredients) { // 일본 라벨 原材料名: 、로 나누고 ／(첨가물 구분)도 경계로. 첫 항목(주원료)은 뺀다
    return String(ingredients || '').replace(/／|\//g, '、').split(/、|,/).map(function (x) { return x.replace(/（.*?）|\(.*?\)/g, '').trim(); }).filter(Boolean).slice(1);
  }
  function missingAdditives(label, form) { // 라벨 부원료·첨가물 중 규격서 배합·조미액 어디에도 없는 것
    var txt = JSON.stringify(form.seasoning || '') + JSON.stringify(form.recipe || '');
    return ingredientsOf(label.ingredients).filter(function (a) { return txt.indexOf(a) < 0; });
  }

  LC.docTypes = ['입고검사서', '가공일지', '포장일지', '패킹리스트', '위생증명서', 'HACCP인증서', '영양성적서', '규격서양식', '라벨', '수입인보이스', 'BL', '수입신고서', '운송장'];

  LC.fieldsToObj = function (fields) {
    if (!fields || !Array.isArray(fields)) return fields || {};
    var o = {}; fields.forEach(function (f) { o[f.k] = f.v; }); return o;
  };

  var R = {}, A = {}; // R[doc_type](obj, s) → 대조 목록, A[doc_type](obj, s) → 결과 문자열

  // ---------- 입고검사서 ----------
  R['입고검사서'] = function (o, s) {
    var id = o.id || 'R-' + ymd(o.received) + '-01', hit = find(s.raw, 'id', id), a = (o.vessel || '').charAt(0);
    var days = Object.keys(s.processLog).filter(function (d) { return s.processLog[d].indexOf(a) >= 0; });
    return [{ item: '입고분 ' + id, status: hit ? 'ok' : 'add', note: hit ? '원장에 있음 → 갱신' : '원장에 없음 → 새 줄' },
      { item: '가공일지 약어 "' + a + '" ↔ 이 입고분', status: days.length ? 'ok' : 'check', note: days.length ? days.join(', ') + ' 가공분에 연결' : '아직 이 약어를 쓴 가공일지 없음. 선박명 첫 글자로 연결 예정' }];
  };
  A['입고검사서'] = function (o, s) {
    var id = o.id || 'R-' + ymd(o.received) + '-01', a = (o.vessel || '').charAt(0);
    // 같은 약어의 "약어만 확인" 자리표시 입고분이 있으면 이 실측으로 대체
    var ph = s.raw.filter(function (r) { return abbrOf(r) === a && !r.kg && /약어만/.test(r.note || ''); });
    ph.forEach(function (p) { s.raw.splice(s.raw.indexOf(p), 1); s.ledger.forEach(function (l) { l.raw = (l.raw || []).map(function (x) { return x === p.id ? id : x; }); }); });
    var added = upsert(s.raw, 'id', id, { id: id, species: o.species, caught: o.fishing_period, vessel: o.vessel, landing: o.landing, received: o.received,
      kg: num(o.total_kg) || 0, boxes_in: o.boxes_in, boxes_ok: o.boxes_ok, note: '원료입고검사서. 공제 ' + (o.deduct || '-') + '상자. 가공일지 약어 "' + a + '"' + (o.note ? '. ' + o.note : '') });
    relinkAll(s);
    return '입고분 ' + id + ' ' + (added ? '추가' : '갱신') + ' (' + o.vessel + ' ' + (num(o.total_kg) || 0).toLocaleString() + 'kg)' + (ph.length ? ', 약어 자리표시 ' + ph.length + '건 대체' : '');
  };

  // ---------- 가공일지 ----------
  R['가공일지'] = function (o, s) {
    var seen = [];
    return (o.raw_sources || []).filter(function (a) { return seen.indexOf(a) < 0 && seen.push(a); }).map(function (a) {
      var hit = rawByAbbr(s, a);
      return { item: '약어 "' + a + '" → 입고분', status: hit && hit.kg ? 'ok' : 'check', note: hit && hit.kg ? hit.id + ' (' + hit.vessel + ')' : '입고검사서 없음. 선박명 첫 글자로만 추정' };
    });
  };
  A['가공일지'] = function (o, s) {
    var seen = [], n = 0, i = 1;
    (o.raw_sources || []).forEach(function (a) { if (seen.indexOf(a) < 0) seen.push(a); });
    s.processLog[o.date] = seen;
    seen.forEach(function (a) {
      if (rawByAbbr(s, a)) return;
      var id; do { id = 'R-' + ymd(prevDay(o.date)) + '-' + (i < 10 ? '0' : '') + i; i++; } while (find(s.raw, 'id', id));
      s.raw.push({ id: id, species: '붉은대게', caught: '', vessel: a + '○호 (약어 "' + a + '")', landing: '동해 연근해', received: prevDay(o.date), kg: 0, note: '가공일지 약어만 확인. 입고검사서 미수령' }); n++;
    });
    relinkAll(s);
    var linked = s.ledger.filter(function (l) { return l.mfg === o.date; }).length;
    return '약어 ' + seen.join('·') + ' 기록, 입고분 ' + n + '건 새로 추가(약어만), ' + o.date + ' 생산 로트 ' + linked + '건에 원료 연결';
  };

  // ---------- 포장일지 ----------
  function lotRows(o) { // 같은 제조일+품목 합산
    var m = {}, out = [];
    (o.rows || []).forEach(function (r) {
      var lot = ymd(r.mfg) + '-' + r.product;
      if (!m[lot]) { m[lot] = { lot: lot, company_code: r.lot_code, product: r.product, mfg: r.mfg, expiry: r.expiry, qty_ct: 0, buyer: r.buyer, parts: [] }; out.push(m[lot]); }
      m[lot].qty_ct += num(r.ct) || 0; m[lot].parts.push({ ct: num(r.ct) || 0, lot_code: r.lot_code, buyer: r.buyer, expiry: r.expiry });
    });
    return out;
  }
  R['포장일지'] = function (o, s) {
    return lotRows(o).map(function (r) {
      var hit = find(s.ledger, 'company_code', r.company_code);
      return { item: '회사 LOT ' + r.company_code + ' (' + r.mfg + ', ' + r.qty_ct + ' C/T)', status: hit ? 'ok' : 'add', note: hit ? '원장에 있음 ' + hit.lot : '원장에 없음 → 새 줄' };
    });
  };
  A['포장일지'] = function (o, s) {
    var n = 0, names = [];
    lotRows(o).forEach(function (r) {
      var old = find(s.ledger, 'lot', r.lot);
      var row = { lot: r.lot, company_code: r.company_code, product: r.product, mfg: r.mfg, expiry: r.expiry, qty_ct: r.qty_ct, kg: r.qty_ct * 12, country: 'JP', buyer: '일본 바이어 ' + r.buyer, pack_rows: r.parts };
      if (!old) { row.raw = []; row.ship = ''; row.cert = ''; row.spec_sent = ''; }
      if (upsert(s.ledger, 'lot', r.lot, row)) n++;
      names.push(r.company_code + (r.parts.length > 1 ? '(' + r.parts.map(function (x) { return x.ct; }).join('+') + ')' : ''));
    });
    relinkAll(s);
    return '원장 ' + n + '줄 추가 (' + names.join('·') + ')';
  };

  // ---------- 패킹리스트 ----------
  function lbCt(items) { var t = 0; (items || []).forEach(function (it) { if (/LB/.test(it.desc)) t += num(it.ct) || 0; }); return t; }
  function packCombos(s, product, target) { // 포장일지 행(pack_rows) 부분합. ponytail: 전수 탐색, 행 12개 넘으면 포기
    var rows = []; s.ledger.forEach(function (l) { if (l.product === product) (l.pack_rows || []).forEach(function (r) { rows.push(r); }); });
    if (!rows.length || rows.length > 12) return null;
    var out = [];
    for (var mask = 1; mask < (1 << rows.length); mask++) {
      var t = 0, pick = [];
      for (var i = 0; i < rows.length; i++) if (mask & (1 << i)) { t += rows[i].ct; pick.push(rows[i]); }
      if (t === target) out.push(pick);
    }
    return out;
  }
  function comboText(c) { return c.map(function (r) { return r.ct + '(' + r.lot_code + ')'; }).join('+'); }
  R['패킹리스트'] = function (o, s) {
    var sum = 0; s.ledger.forEach(function (l) { if (l.product === 'LB') sum += l.qty_ct; });
    var out = [{ item: '선적 ' + o.invoice_no, status: find(s.shipments, 'no', o.invoice_no) ? 'ok' : 'add', note: (o.total_ct || '?') + ' C/T · ' + (o.total_kg || '?') + ' kg' }];
    var lb = lbCt(o.items);
    if (lb) {
      var combos = packCombos(s, 'LB', lb), row = { item: 'LB ' + lb + ' C/T ↔ 원장 LB 로트 합계 ' + sum + ' C/T', status: 'check', note: '어느 로트 조합이 실렸는지는 포장일지만으로 단정 못 함. 조합 확인 필요' };
      if (combos === null) row.note = '포장일지 행이 없거나 12행 초과. 조합 추정 생략';
      else if (!combos.length) row.note = '포장일지 행 조합으로 ' + lb + ' C/T 를 만들 수 없음. 다른 날 생산분 포함 가능';
      else {
        var codes = []; combos[0].forEach(function (r) { if (codes.indexOf(r.lot_code) < 0) codes.push(r.lot_code); });
        row.note = '포장일지 행 조합으로 ' + lb + ' C/T 가능: ' + comboText(combos[0]) + (combos.length > 1 ? ' 외 ' + (combos.length - 1) + '가지' : '');
        if (combos.length === 1) { row.status = 'ok'; row.note += ' → 로트 ' + codes.join('·') + ' 연결 제안 (linked_lot_codes)'; row.linked_lot_codes = codes; }
      }
      out.push(row);
    }
    return out;
  };
  A['패킹리스트'] = function (o, s) {
    var row = { no: o.invoice_no, date: o.date, departure: o.departure, buyer: o.buyer, vessel: o.vessel, route: o.route || (o.from + ' → ' + o.to), items: o.items || [],
      total_ct: num(o.total_ct), total_kg: num(o.total_kg), hs: o.hs, note: o.note || '' };
    var added = upsert(s.shipments, 'no', o.invoice_no, row), sh = find(s.shipments, 'no', o.invoice_no), n = 0;
    (o.linked_lot_codes || []).forEach(function (c) {
      s.ledger.forEach(function (l) { if (l.company_code === c) { l.ship = shipLabel(o); l.spec_sent = o.date; if (sh.cert) l.cert = sh.cert; n++; } });
    });
    return '선적 ' + o.invoice_no + ' ' + (added ? '추가' : '갱신') + (n ? ', 로트 ' + n + '건에 선적 연결 (' + o.linked_lot_codes.join('·') + ')' : '');
  };

  // ---------- 위생증명서 ----------
  function targetShip(s, o) { return find(s.shipments, 'no', o.shipment_no) || (o.shipment_no ? null : s.shipments[s.shipments.length - 1] || null); }
  R['위생증명서'] = function (o, s) {
    var sh = targetShip(s, o);
    if (!sh) return [{ item: '수량 ↔ 선적 ' + (o.shipment_no || '(최근)'), status: 'check', note: '패킹리스트를 먼저 넣어야 대조됨. 증명서는 선적 번호로만 기록' }];
    var ok = num(o.quantity_ct) === sh.total_ct && num(o.quantity_kg) === sh.total_kg;
    return [{ item: '수량 ↔ 패킹리스트 ' + sh.no, status: ok ? 'ok' : 'check', note: ok ? o.quantity_ct + ' C/T · ' + o.quantity_kg + ' kg 일치' : '증명서 ' + o.quantity_ct + '/' + o.quantity_kg + ' ↔ 선적 ' + sh.total_ct + '/' + sh.total_kg + ' 불일치' }];
  };
  A['위생증명서'] = function (o, s) {
    var sh = targetShip(s, o), cert = certLabel(o);
    if (!sh && o.shipment_no) { sh = { no: o.shipment_no, items: [], note: '증명서로 먼저 등록. 패킹리스트 대기' }; s.shipments.push(sh); }
    if (sh) sh.cert = cert;
    var n = 0; s.ledger.forEach(function (l) { if (sh && l.ship && l.ship.indexOf(sh.no) >= 0) { l.cert = cert; n++; } });
    return '증명서(' + o.date + ')를 선적 ' + (sh ? sh.no : '(없음)') + '과 로트 ' + n + '건에 기록';
  };

  // ---------- HACCP 인증서 ----------
  function haccpRow(s) { var r = null; s.registry.forEach(function (x) { if (/HACCP/.test(x.name)) r = x; }); return r; }
  R['HACCP인증서'] = function (o, s) {
    var r = haccpRow(s), left = Math.round((new Date(o.valid_to) - new Date(LC.TODAY || Date.now())) / 86400000), out = [];
    if (!isNaN(left) && left <= 90) out.push({ item: 'HACCP 만료 D-' + left, status: 'bad', note: '90일 이내. 연장 신청 확인 (만료 ' + o.valid_to + ')' });
    return out.concat([{ item: '레지스트리 HACCP 행', status: r ? (r.expiry === o.valid_to && r.no === o.cert_no ? 'ok' : 'check') : 'add', note: r ? '현재 ' + r.no + ' / ' + r.expiry + ' → 인증서 ' + o.cert_no + ' / ' + o.valid_to : '행 없음 → 추가' }]);
  };
  A['HACCP인증서'] = function (o, s) {
    var r = haccpRow(s), note = '유효 ' + o.valid_from + '~' + o.valid_to + '. CCP ' + (o.ccp || '-') + (o.first ? '. 최초 ' + o.first : '') + '. 인증서 원본 기준';
    if (!r) { r = { kind: '법정인증', name: 'HACCP 적용업소 인증 (' + (o.category || '') + ')', lead: 90, countries: 'ALL' }; s.registry.push(r); }
    r.no = o.cert_no; r.expiry = o.valid_to; r.issuer = o.issuer; r.note = note;
    return 'HACCP 행 갱신 (' + o.cert_no + ', 만료 ' + o.valid_to + ')';
  };

  // ---------- 영양 성적서 ----------
  function saltOf(o) { return Math.round(num(o.sodium_mg) * 2.54 / 10) / 100; }
  function reportKey(o) { return '자사 성적서(' + String(o.date || '').slice(0, 4) + ', ' + (o.product || '') + ')'; }
  R['영양성적서'] = function (o, s) {
    var salt = saltOf(o), others = s.nutritionSources.filter(function (x) { return x.buyer !== reportKey(o) && x.salt_g != null; });
    var diff = others.filter(function (x) { return Math.abs(x.salt_g - salt) > 0.3; }).map(function (x) { return x.buyer + ' ' + x.salt_g; });
    return [{ item: '식염상당량 환산 ' + salt + 'g (Na ' + o.sodium_mg + 'mg×2.54)', status: diff.length ? 'check' : (others.length ? 'ok' : 'check'),
      note: diff.length ? '라벨 값과 차이: ' + diff.join(' / ') + '. 조미 전 다른 제품이면 직접 비교 불가' : (others.length ? '등록된 라벨 값과 0.3g 이내' : '비교할 라벨 영양값이 아직 없음') }];
  };
  A['영양성적서'] = function (o, s) {
    upsert(s.nutritionSources, 'buyer', reportKey(o), { buyer: reportKey(o), product: o.product, kcal: num(o.kcal), protein: num(o.protein), fat: num(o.fat), carb: num(o.carb), salt_g: saltOf(o), basis: '실측', src: (o.issuer || '성적서') + ' ' + (o.report_no || '') + ' ' + (o.date || '') });
    return '영양값 출처 1건 기록 (' + reportKey(o) + ', 식염 ' + saltOf(o) + 'g 환산)';
  };

  // ---------- 바이어 규격서 양식 ----------
  R['규격서양식'] = function (o, s) {
    var lab = null; s.labels.forEach(function (l) { if (l.ingredients && (!o.buyer || l.buyer === o.buyer)) lab = l; });
    if (!lab) return [{ item: '양식 ' + (o.form_title || '') + ' (' + o.buyer + ')', status: s.specForms[o.buyer] ? 'ok' : 'add', note: '라벨을 넣으면 원재료 ↔ 배합·조미액 대조' }];
    var miss = missingAdditives(lab, o);
    return [{ item: '라벨 원재료 첨가물 ↔ 규격서 배합·조미액', status: miss.length ? 'check' : 'ok', note: miss.length ? '라벨에만 있음: ' + miss.join(', ') + ' → 바이어에 확인' : '라벨 첨가물이 모두 규격서에 있음' }];
  };
  A['규격서양식'] = function (o, s) {
    s.specForms[o.buyer] = { fields: o.fields, recipe: o.recipe, seasoning: o.seasoning, qc: o.qc, packaging: o.packaging, spec: o.spec, form_title: o.form_title };
    return o.buyer + ' 규격서 양식 저장 (칸 ' + (o.fields || []).length + '개, 배합·조미액·중점관리·포장자재)';
  };

  // ---------- 라벨 ----------
  R['라벨'] = function (o, s) {
    var c = (o.country || 'JP').slice(0, 2).toUpperCase(), rules = LC.rules && LC.rules[c], out = [];
    if (rules) {
      var res = rules.checks.map(function (ck) { return { item: ck.item, r: ck.run(o, LC.product) }; });
      var fix = res.filter(function (x) { return x.r.status !== 'pass'; });
      out.push({ item: c + ' 규칙 판정 ' + res.length + '항목', status: fix.length ? 'check' : 'ok', note: fix.length ? fix.map(function (x) { return x.item + '=' + x.r.status + (x.r.msg ? ' (' + x.r.msg + ')' : ''); }).join(', ') : '전부 통과' });
    }
    var form = o.buyer && s.specForms[o.buyer];
    if (form) { var miss = missingAdditives(o, form); out.push({ item: '라벨 첨가물 ↔ ' + o.buyer + ' 규격서', status: miss.length ? 'check' : 'ok', note: miss.length ? '라벨에만 있음: ' + miss.join(', ') + ' → 바이어에 확인' : '일치' }); }
    var nu = parseNutrition(o.nutrition); if (nu.kcal != null) out.push({ item: '영양값 ' + nu.kcal + 'kcal · 식염 ' + nu.salt_g + 'g', status: 'ok', note: (o.basis || (/推定値|目安/.test(String(o.nutrition)) ? '推定値' : '근거 미표기')) + ' · 출처 ' + (o.buyer || '라벨') });
    return out;
  };
  A['라벨'] = function (o, s) {
    var nu = parseNutrition(o.nutrition), who = o.buyer || o.importer || '라벨', basis = o.basis || (/推定値|目安/.test(String(o.nutrition)) ? '推定値 (바이어 제공)' : '라벨 표기');
    if (nu.kcal != null) upsert(s.nutritionSources, 'buyer', who, { buyer: who, product: o.brand || o.name, kcal: nu.kcal, protein: nu.protein, fat: nu.fat, carb: nu.carb, salt_g: nu.salt_g, basis: basis, src: o.source || '라벨' });
    var file = o.source || (who + ' 라벨' + (o.code ? ' ' + o.code : ''));
    var added = upsert(s.labels, 'file', file, { file: file, country: (o.country || 'JP').slice(0, 2).toUpperCase(), made: o.made || String(o.expiry || '').slice(0, 4), buyer: who, ingredients: o.ingredients });
    return who + ' 라벨 영양값(' + basis + ') 출처 기록' + (added ? ', 라벨 목록에 추가' : '');
  };


  // ---------- 수입 서류 4종: 수입인보이스 → 수입 선적 생성, BL·수입신고서·운송장 → 그 선적의 체크리스트를 채운다 ----------
  function blankChecklist() { // 시드(import.js)의 체크리스트 구조를 빈 상태로 복사. 시드가 없으면 최소 4행
    var seed = (LC.importSeed || LC.importShipments || [])[0];
    var rows = seed ? seed.checklist : [{ doc: '인보이스·패킹리스트', required: true }, { doc: 'B/L 원본', required: true }, { doc: '일본 정부 수입용 식품 신고서 (제품·제조소별)', required: true, count_expected: 4 }, { doc: '방사능 분석 보고서 (요오드-131, 세슘-134·137)', required: true }];
    return rows.map(function (c) { var r = { doc: c.doc, required: c.required, status: '확인', date: '', note: '', src: '' }; if (c.count_expected) { r.count_expected = c.count_expected; r.count_have = 0; } return r; });
  }
  function ckRow(sh, re) { var hit = null; (sh.checklist || []).forEach(function (c) { if (!hit && re.test(c.doc)) hit = c; }); return hit; }
  function impShip(s, o) { // shipment_no·consignment_code·invoice_no 로 찾고, 없으면 선박명으로
    s.importShipments = s.importShipments || [];
    var no = o.shipment_no || o.consignment_code || o.invoice_no, hit = no ? find(s.importShipments, 'no', no) : null;
    if (!hit && o.vessel) s.importShipments.forEach(function (x) { if (!hit && x.vessel && x.vessel.split(' ')[0] === String(o.vessel).split(' ')[0]) hit = x; });
    return hit;
  }
  function productCount(sh) { var n = (sh.items || []).filter(function (i) { return !/샘플|SAMPLE/i.test(i.desc); }).length; return n || 4; }
  function declRow(sh) { // 신고서 행의 n/m 갱신
    var c = ckRow(sh, /신고서/); if (!c) return;
    c.count_have = (sh.declarations || []).length; c.count_expected = productCount(sh);
    c.status = c.count_have >= c.count_expected ? '있음' : '확인';
    c.note = c.count_have ? '확인한 것: ' + sh.declarations.map(function (d) { return d.declaration_no + ' (' + d.product + ' ' + d.packages + ', 제조소 ' + d.establishment + ')'; }).join(' / ') : '';
    c.src = c.count_have ? '일본 정부 신고서' : '';
  }
  function newImp(no, note) { return { no: no, items: [], checklist: blankChecklist(), declarations: [], notes: note ? [note] : [], etd: '', eta: '', containers: '', total: '' }; }

  R['수입인보이스'] = function (o, s) {
    s.importShipments = s.importShipments || [];
    return [{ item: '수입 선적 ' + o.invoice_no, status: find(s.importShipments, 'no', o.invoice_no) ? 'ok' : 'add', note: (o.total_ct || '?') + ' C/T · ' + (o.items || []).length + '품목 · ' + (o.from || '') + '→' + (o.to || '') }];
  };
  A['수입인보이스'] = function (o, s) {
    s.importShipments = s.importShipments || [];
    var sh = find(s.importShipments, 'no', o.invoice_no), added = !sh;
    if (!sh) { sh = newImp(o.invoice_no); s.importShipments.push(sh); }
    sh.date = o.date; sh.exporter = o.exporter; sh.importer = o.importer; sh.route = (o.from || '') + ' → ' + (o.to || ''); sh.vessel = o.vessel || sh.vessel; sh.incoterms = o.incoterms;
    sh.items = o.items || []; sh.total = (o.total_ct || '?') + ' C/T' + (sh.total && /순중량/.test(sh.total) ? sh.total.slice(sh.total.indexOf(', 순중량')) : '');
    var c = ckRow(sh, /인보이스/); if (c) { c.status = '있음'; c.date = o.date; c.note = '단가·금액은 가림'; c.src = o.source || '인보이스·패킹리스트'; }
    declRow(sh);
    return '수입 선적 ' + o.invoice_no + ' ' + (added ? '추가' : '갱신') + ' (' + (o.items || []).length + '품목, ' + (o.total_ct || '?') + ' C/T)';
  };

  R['BL'] = function (o, s) {
    var sh = impShip(s, o);
    if (!sh) return [{ item: 'B/L ' + o.bl_no + ' ↔ 수입 선적', status: 'check', note: '인보이스를 먼저 넣어야 수량 대조됨. 선적은 B/L 로 먼저 만든다' }];
    var inv = num(sh.total), ok = inv != null && num(o.cartons) === inv;
    return [{ item: 'B/L 수량 ' + o.cartons + ' C/T ↔ 인보이스 ' + (inv == null ? '?' : inv) + ' C/T', status: ok ? 'ok' : 'check', note: ok ? '일치 (' + sh.no + ')' : '수량 다름 또는 인보이스 없음' }];
  };
  A['BL'] = function (o, s) {
    var sh = impShip(s, o);
    if (!sh) { sh = newImp(o.shipment_no || o.bl_no, 'B/L 로 먼저 등록. 인보이스 대기'); s.importShipments.push(sh); }
    sh.vessel = sh.vessel || (o.vessel + (o.voyage ? ' ' + o.voyage : '')); sh.route = sh.route || (o.pol + ' → ' + o.pod);
    sh.containers = o.containers || sh.containers; if (o.issued) sh.etd = o.issued + ' 선적(B/L)';
    if (o.net_kg) sh.total = (sh.total || '').replace(/,\s*순중량.*$/, '') + ', 순중량 ' + num(o.net_kg).toLocaleString() + 'kg(B/L)';
    var c = ckRow(sh, /B\/L/); if (c) { var dhl = (c.note || '').match(/원본 DHL.*$/); c.status = '있음'; c.date = o.issued || ''; c.note = ((o.carrier || '') + ' ' + o.bl_no).trim() + (dhl ? '. ' + dhl[0] : ''); c.src = o.source || '선하증권'; }
    (s.importWaybills || []).splice(0).forEach(function (w) { dhlNote(sh, w.waybill, w.eta); }); // 먼저 들어와 보류된 운송장 붙이기
    return 'B/L ' + o.bl_no + ' 을 수입 선적 ' + sh.no + ' 에 기록 (' + o.cartons + ' C/T, ' + o.net_kg + 'kg)';
  };

  R['수입신고서'] = function (o, s) {
    var sh = impShip(s, o), others = sh ? (sh.declarations || []).filter(function (d) { return d.declaration_no !== o.declaration_no; }).length : 0, need = sh ? productCount(sh) : 4;
    return [{ item: '일본 정부 신고서 ' + o.declaration_no + ' (' + (o.product || '') + ')', status: others + 1 >= need ? 'ok' : 'check', note: (sh ? '' : '수입 선적 ' + o.consignment_code + ' 아직 없음. ') + '제품·제조소별 ' + (others + 1) + '/' + need + '장' },
      { item: '방사능 분석 보고서 ' + (o.report_no || '-'), status: o.report_no ? 'ok' : 'check', note: o.report_no ? (o.lab || '') + ' ' + (o.analyzed || '') : '보고서 번호 없음' }]
      .concat(sh && (sh.items || []).length ? [(function () {
        var p = String(o.product || '').toLowerCase(), hit = (sh.items || []).filter(function (it) { var d = String(it.desc || '').toLowerCase(); return p && (d.indexOf(p) >= 0 || p.indexOf(d) >= 0); });
        return { item: '신고서 제품명 ↔ 인보이스 품목', status: hit.length ? 'ok' : 'check', note: hit.length ? hit.map(function (it) { return it.desc; }).join(' / ') : '인보이스 품목에 "' + o.product + '" 없음' };
      })()] : []);
  };
  A['수입신고서'] = function (o, s) {
    var sh = impShip(s, o);
    if (!sh) { sh = newImp(o.consignment_code, '신고서로 먼저 등록. 인보이스 대기'); s.importShipments.push(sh); }
    sh.declarations = sh.declarations || [];
    upsert(sh.declarations, 'declaration_no', o.declaration_no, { declaration_no: o.declaration_no, product: o.product, packages: o.packages, net_kg: o.net_kg, establishment: o.establishment, issued: o.issued, report_no: o.report_no });
    declRow(sh);
    if (o.report_no) { var c = ckRow(sh, /방사능/); if (c) { c.status = '있음'; c.date = o.analyzed || ''; c.note = '보고서 ' + o.report_no + ', ' + (o.lab || '') + '. 신고서에 첨부'; c.src = '신고서 본문'; } }
    if (o.prefecture_flag && sh.notes.indexOf(o.prefecture_flag) < 0) sh.notes.push(o.prefecture_flag);
    var d = ckRow(sh, /신고서/);
    return '신고서 ' + o.declaration_no + ' 기록 → ' + sh.no + ' 제품·제조소별 ' + d.count_have + '/' + d.count_expected + '장';
  };

  function dhlNote(sh, waybill, eta) { var c = ckRow(sh, /B\/L/); if (c) c.note = (c.note ? c.note.replace(/\.?\s*원본 DHL.*$/, '') + '. ' : '') + '원본 DHL ' + waybill + ' ' + (eta || '') + ' 도착'; }
  function shipWithBL(s) { var hit = null; (s.importShipments || []).forEach(function (x) { var c = ckRow(x, /B\/L/); if (!hit && c && c.status === '있음') hit = x; }); return hit; }
  R['운송장'] = function (o, s) {
    var sh = shipWithBL(s);
    return [{ item: '운송장 ' + o.waybill + ' (' + (o.contents || '') + ')', status: sh ? 'ok' : 'check', note: sh ? 'B/L 원본 → ' + sh.no + ' 에 도착일 보강' : 'B/L 이 아직 없음. 가장 최근 수입 선적에 기록' }];
  };
  A['운송장'] = function (o, s) {
    s.importShipments = s.importShipments || [];
    var sh = shipWithBL(s) || s.importShipments[s.importShipments.length - 1];
    if (!sh) { s.importWaybills = s.importWaybills || []; upsert(s.importWaybills, 'waybill', o.waybill, { waybill: o.waybill, eta: o.eta || '' }); return '수입 선적이 아직 없어 운송장 보류 (' + o.waybill + '). B/L 이 들어오면 붙인다'; }
    dhlNote(sh, o.waybill, o.eta);
    return 'B/L 원본 운송장 ' + o.waybill + ' → ' + sh.no + ' (' + (o.eta || '') + ' 도착)';
  };

  LC.reconcileDoc = function (doc_type, obj, state) { ensure(state); var f = R[doc_type]; return f ? f(obj || {}, state) : [{ item: doc_type, status: 'check', note: '대조 규칙 없는 서류 종류. 사람이 확인' }]; };
  LC.applyDoc = function (doc_type, obj, state) { ensure(state); var f = A[doc_type]; return f ? f(obj || {}, state) : '반영 규칙 없음 (' + doc_type + '). 기록만 남김'; };
})();
