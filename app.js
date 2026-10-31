// 라벨코스트 데모 — 단일 페이지, 프레임워크 없음. 상태는 localStorage.
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmtDate = function (d) { return d ? d : '-'; };
  var daysTo = function (iso) { return Math.round((new Date(iso) - new Date(LC.TODAY)) / 86400000); };
  var STATUS = { pass: ['통과', 'ok'], fix: ['수정', 'bad'], check: ['확인', 'warn'] };
  // 긴 비고: 앞 n자만 보이고 누르면 펼침
  function fold(t, n) { t = String(t == null ? '' : t); n = n || 40; return t.length <= n ? esc(t) : '<details class="fold"><summary>' + esc(t.slice(0, n)) + '…</summary>' + esc(t) + '</details>'; }

  // ---------- 상태 ----------
  // 시드값. 모든 상태는 여기서 복원한다
  function seeds() {
    return {
      ledger: LC.seedLedger.slice(), raw: LC.rawLots.slice(), registry: LC.registry.slice(),
      shipments: (LC.shipmentsSeed || []).slice(), nutritionSources: (LC.nutritionSources || []).slice(), docs: [], specForms: {}, revisions: [],
      labels: Object.values(LC.sampleLabels).map(function (l) { return { file: l.file, country: l.country, made: l.made }; }),
      importShipments: [], processLog: {}, importWaybills: [], publicData: {}, extraProducts: [], productNutrition: {}
    };
  }
  var SAVED = ['ledger', 'raw', 'registry', 'shipments', 'nutritionSources', 'docs', 'specForms', 'revisions', 'labels', 'importShipments', 'processLog', 'importWaybills', 'publicData', 'extraProducts', 'productNutrition'];
  var state = { lastLabel: null };
  (function load() { var s = seeds(); SAVED.forEach(function (k) { state[k] = JSON.parse(localStorage.getItem('lc.' + k) || 'null') || s[k]; }); })();
  // 서버(server/app.py)가 있으면 서버 상태가 원본, 없으면(file://) 브라우저 저장. 동작은 같다
  var API = /^https?:/.test(location.protocol) ? '/api' : null;
  var health = null; var saveTimer = null;
  function api(path, method, body) {
    return fetch(API + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json(); });
  }
  function save() {
    SAVED.forEach(function (k) { localStorage.setItem('lc.' + k, JSON.stringify(state[k])); });
    if (!API) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { var s = {}; SAVED.forEach(function (k) { s[k] = state[k]; }); api('/state', 'PUT', s).catch(function () {}); }, 300);
  }
  function resetAll() { var s = seeds(); SAVED.forEach(function (k) { state[k] = s[k]; }); save(); }
  // 식약처 품목제조보고에서 추가한 품목: 기본 품목(LB)을 틀로 쓰고 이름·코드만 덮는다. 영양값은 없음(성적서 필요)
  function addExtraProduct(o) {
    LC.products = LC.products || { LB: LC.product };
    if (LC.products[o.code]) return LC.products[o.code];
    var np = {}; for (var k in LC.product) np[k] = LC.product[k];
    np.code = o.code; np.name_ko = o.name_ko; np.name_en = o.name_en || o.name_ko; np.name_ja = ''; np.type = o.type || ''; np.report_no = o.report_no || '';
    np.ingredients = []; np.nutrition100 = null; np.nutrition_source = '성적서 없음'; np.shelf_months = o.shelf_months || 24; np.source = o.source || '식약처 품목제조보고';
    LC.products[o.code] = np; return np;
  }
  function mergeExtraProducts() {
    (state.extraProducts || []).forEach(addExtraProduct);
    var pn = state.productNutrition || {};   // 승인된 자사 성적서 → 품목 영양값
    Object.keys(pn).forEach(function (k) { if (LC.products && LC.products[k] && pn[k] && pn[k].n) { LC.products[k].nutrition100 = pn[k].n; LC.products[k].nutrition_source = pn[k].source || '자사 성적서'; } });
  }
  mergeExtraProducts();
  // 토스트: 승인 결과 같은 짧은 알림. 3초 뒤 사라짐
  function toast(msg) {
    var t = $('#toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show'; clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.className = ''; }, 3000);
  }
  // 빈 원장 안내 (선적·LOT·내보내기 공용)
  function shipped(l) { return !!(l.ship && !/미선적/.test(l.ship)); }   // 시드의 '미선적 (재고)' 문자열은 선적 아님
  function emptyLedger() { return '<p class="alert">아직 로트가 없습니다 → <a href="#quick">한 번에 처리에서 서류를 넣으세요</a></p>'; }
  function modeBadge() {
    if (!API) return '오프라인';
    if (!health) return '서버 확인 중';
    return health.ok ? '서버' + (health.llm ? ' · AI' : '') : '오프라인';
  }
  if (API) {
    api('/health').then(function (h) { health = h; if (h && h.today) LC.TODAY = h.today; return api('/state'); })
      .then(function (s) { var seeded = seeds(); SAVED.forEach(function (k) { if (s && s[k] != null) state[k] = s[k]; else if (!localStorage.getItem('lc.' + k)) state[k] = seeded[k]; }); mergeExtraProducts(); setProduct(state.productCode); route(); })
      .catch(function () { health = { ok: false }; route(); });
  }

  // ---------- 판정 엔진 ----------
  function judge(country, fields) {
    var r = LC.rules[country];
    return r.checks.map(function (c) { var out = c.run(fields, P()); out.item = c.item; out.id = c.id; out.src = c.src; return out; });
  }
  function summarize(results) {
    var s = { pass: 0, fix: 0, check: 0 };
    results.forEach(function (x) { s[x.status]++; });
    return s;
  }

  // ---------- 영양 환산 ----------
  // ---------- 품목 선택 (여러 품목) ----------
  state.productCode = localStorage.getItem('lc.productCode') || 'LB';
  function P() { return (LC.products && LC.products[state.productCode]) || LC.product; }
  function setProduct(code) { state.productCode = code; try { localStorage.setItem('lc.productCode', code); } catch (e) {} n = P().nutrition100 || {}; }
  function productSelect(id) {
    var ps = LC.products || { LB: LC.product };
    return '<label>품목 <select id="' + id + '">' + Object.keys(ps).map(function (k) { return '<option value="' + k + '"' + (k === state.productCode ? ' selected' : '') + '>' + k + ' · ' + esc(ps[k].name_ko) + '</option>'; }).join('') + '</select></label>';
  }
  function bindProductSelect(id) { var el = $('#' + id); if (el) el.onchange = function () { setProduct(el.value); route(); }; }
  var n = P().nutrition100 || {};
  // 화면 표시용 한글 이름. 데이터 키는 그대로
  var NUT_KO = { kcal: '열량(kcal)', protein: '단백질(g)', fat: '지방(g)', satfat: '포화지방(g)', transfat: '트랜스지방(g)', carb: '탄수화물(g)', sugar: '당류(g)', sodium_mg: '나트륨(mg)' };
  var nutritionBy = {
    JP: function () { return [['エネルギー', n.kcal + ' kcal'], ['たんぱく質', n.protein + ' g'], ['脂質', n.fat + ' g'], ['炭水化物', n.carb + ' g'], ['食塩相当量', (n.sodium_mg * 2.54 / 1000).toFixed(2) + ' g'], ['(推定値)', '']]; },
    HK: function () { return [['能量 Energy', n.kcal + ' kcal / ' + Math.round(n.kcal * 4.184) + ' kJ'], ['蛋白質 Protein', n.protein + ' g'], ['總脂肪 Total fat', n.fat + ' g'], ['飽和脂肪 Saturated fat', n.satfat + ' g'], ['反式脂肪 Trans fat', n.transfat + ' g'], ['碳水化合物 Carbohydrates', n.carb + ' g'], ['糖 Sugars', n.sugar + ' g'], ['鈉 Sodium', n.sodium_mg + ' mg']]; },
    TW: function () { return [['熱量', n.kcal + ' 大卡'], ['蛋白質', n.protein + ' 公克'], ['脂肪', n.fat + ' 公克'], ['  飽和脂肪', n.satfat + ' 公克'], ['  反式脂肪', n.transfat + ' 公克'], ['碳水化合物', n.carb + ' 公克'], ['  糖', n.sugar + ' 公克'], ['鈉', n.sodium_mg + ' 毫克']]; },
    TH: function () { return [['영양표시', '이 품목 의무 아님']]; },
    CN: function () { return [['营养成分表', 'GB 28050 기준. 환산표는 GB 28050 원문 확인 뒤 추가 (규칙 4.13)']]; }
  };
  var allergenBy = { CN: '甲壳纲类（蟹） (GB 7718-2025 4.12.1, 표시 형식은 附录D 확인)', JP: 'かに', HK: '含甲殼類動物（蟹）/ Contains crustacea (crab)', TW: '本產品含有螃蟹', TH: 'ข้อมูลสำหรับผู้แพ้อาหาร : มี ปู' };
  var additiveBy = {
    CN: '增味剂（谷氨酸钠）、甜味剂（山梨糖醇）、增稠剂（瓜尔胶） (功能类别+通用名称, 4.3.4. 명칭은 GB 2760 대조 필요)',
    JP: '食塩／調味料(アミノ酸)、甘味料(ソルビトール)、増粘剤(グァーガム)',
    HK: '增味劑(621)、甜味劑(420)、增稠劑(412) / flavour enhancer (621), sweetener (sorbitol), thickener (guar gum)',
    TW: 'L-麩酸鈉（調味劑）、D-山梨醇（甜味劑）、關華豆膠（黏稠劑）',
    TH: 'วัตถุปรุงแต่งรสอาหาร (INS 621) วัตถุที่ให้ความหวานแทนน้ำตาล (INS 420) สารให้ความคงตัว (INS 412)'
  };

  // ---------- 엑셀 파싱 (SheetJS) : 라벨 셀의 키워드로 필드 매핑 ----------
  var KEYS = [
    ['name', /品名|名称|名　*称|product name|ชื่อ/i], ['ingredients', /成分|原材料|ingredient|ส่วนประกอบ/i], ['net', /内容量|內容量|淨重|content|net|น้ำหนัก/i],
    ['mfg', /生產日期|製造日期|manufacture|production date/i], ['expiry', /有効|有效|賞味|expir|best before|วันหมดอายุ/i], ['storage', /保存|preserv|storage|จัดเก็บ/i],
    ['origin', /原産|原產|産地|產地|origin|ประเทศ/i], ['importer', /進口商|輸入者|import|นำเข้า/i], ['manufacturer', /製造者|製造商|manufacturer|ผู้ผลิต/i],
    ['allergen', /過敏|アレル|allerg|แพ้/i], ['nutrition', /營養|栄養|nutrition|熱量|エネルギー/i]
  ];
  function parseSheet(ws) {
    var f = {}; var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
    rows.forEach(function (row) {
      var cells = row.map(function (c) { return (c == null ? '' : String(c)).trim(); }).filter(Boolean);
      if (!cells.length) return;
      var line = cells.join(' ');
      KEYS.forEach(function (k) {
        if (k[1].test(cells[0]) || (k[0] === 'allergen' && k[1].test(line))) {
          var val = k[0] === 'allergen' ? line : cells.slice(1).join(' ');
          if (val && !f[k[0]]) f[k[0]] = val; else if (!f[k[0]]) f[k[0]] = cells[0];
        }
      });
      if (/營養|栄養|nutrition/i.test(line)) f.nutrition = (f.nutrition || '') + ' ' + line;
    });
    return f;
  }

  // ---------- 화면 ----------
  var screens = {};

  // 홈: 오늘 할 일 4종을 줄 단위로. 0건은 숨김. 아래에 최근 로트·이달 요약 작은 줄과 시작하기
  function todos() {
    var out = [], pend = intakeCards.filter(function (c) { return !c.done; }).length;
    if (pend) out.push({ cls: 'warn', text: '승인 기다리는 서류 ' + pend + '건', href: '#intake', go: '서류 넣기' });
    var soon = state.registry.filter(function (r) { return r.expiry && daysTo(r.expiry) <= 90; }).sort(function (a, b) { return daysTo(a.expiry) - daysTo(b.expiry); });
    if (soon.length) out.push({ cls: daysTo(soon[0].expiry) <= 30 ? 'bad' : 'warn', text: '만료 임박 ' + soon.length + '건 · ' + soon[0].name + ' D-' + daysTo(soon[0].expiry), href: '#dash', go: '대시보드' });
    allRevisions().forEach(function (v) {
      var d = daysTo(v.effective); if (d < 0 || d > 180 || !LC.rules[v.country]) return;
      var hits = affectedLabels(v), fix = hits.reduce(function (t, h) { return t + (h.s ? h.s.fix : 0); }, 0);
      if (!hits.length) return;   // 영향 라벨 0건은 할 일 아님 (대시보드에서 봄)
      out.push({ cls: fix ? 'bad' : 'warn', text: '규정 개정 D-' + d + ' · ' + v.title + ' · 영향 라벨 ' + hits.length + '건' + (fix ? ' (수정 ' + fix + ')' : ''), href: hits.length ? '#label/' + hits[0].key + '/' + v.country : '#label/' + (LC.sampleLabels.HK ? 'HK' : Object.keys(LC.sampleLabels)[0]) + '/' + v.country, go: '라벨 판정' });
    });
    var ps = LC.products || { LB: LC.product }, noNut = Object.keys(ps).filter(function (k) { return !ps[k].nutrition100; });
    if (noNut.length) out.push({ cls: 'warn', text: '성적서 없는 품목 ' + noNut.length + '건 · ' + noNut.join(', '), href: '#product', go: '품목' });
    return out;
  }
  function listRow(href, badge, main, meta) { return '<a class="list-row" href="' + href + '">' + badge + '<span class="lr-main">' + main + '</span>' + (meta ? '<span class="lr-meta">' + meta + '</span>' : '') + '<span class="chev">›</span></a>'; }
  screens.home = function () {
    var items = todos(), recent = state.ledger.slice(-3).reverse();
    var k0 = LC.sampleLabels.HK ? 'HK' : Object.keys(LC.sampleLabels)[0], l0 = LC.sampleLabels[k0], s0 = summarize(judge(l0.country, l0.fields)), go0 = '#label/' + k0 + '/' + l0.country;
    return '<div class="home"><div>' +
      '<p class="hero">수출 라벨 규정 위반을<br><em>선적 전에</em> 잡습니다</p>' +
      '<p class="hero-sub">홍콩 · 대만 · 태국 · 일본 · 중국 규칙으로 항목별 판정, 공장 LOT 기록까지 한 줄로.</p>' +
      '<div class="search"><input id="home-q" list="lot-list" placeholder="LOT 번호나 회사 코드로 찾기 (예: 20260410-LB)" aria-label="LOT 찾기"><button id="home-go" aria-label="LOT 조회">찾기</button></div>' + lotDatalist() +
      '<div class="panel feature"><a class="lead-tile" href="' + go0 + '"><span class="lt-k">라벨 판정 · ' + esc(LC.rules[l0.country].name) + ' 라벨</span><span class="lt-v">' + (s0.fix ? '수정 ' + s0.fix + '항목' : '통과') + '</span><span class="lt-d">확인 ' + s0.check + ' · 통과 ' + s0.pass + ' · ' + esc(l0.file) + '</span></a>' +
      '<div class="list">' + listRow('#quick', '', '한 번에 처리', '서류 → 판정 → 기록') + listRow('#lot', '', 'LOT 조회', '원어 입고까지') + listRow('#intake', '', '서류 넣기', '사진·PDF 읽기') + '</div></div>' +
      '</div><div class="card"><div class="sec-head"><h3>오늘 할 일</h3><span class="muted">' + LC.TODAY + '</span></div>' +
      (items.length ? '<div class="list">' + items.map(function (t) { var badge = t.href === '#intake' ? '<span class="tag">대기</span>' : '<span class="b ' + t.cls + '">' + (t.cls === 'bad' ? '수정' : '확인') + '</span>'; return listRow(t.href, badge, esc(t.text), t.go); }).join('') + '</div>' : '<p class="muted">오늘 할 일 없음</p>') +
      '<p class="muted home-recent">' + (recent.length ? '최근 LOT ' + recent.map(function (l) { return '<a href="#lot/' + l.lot + '">' + l.lot + '</a>'; }).join(' · ') : 'LOT 없음') + monthLine() + '</p>' +
      '<a class="btn lg" href="' + go0 + '">예시로 보기</a></div></div>';
  };
  // 이달(없으면 데이터가 있는 마지막 달) 생산·선적 한 줄
  function monthLine() {
    if (typeof LC.stats !== 'function' || !state.ledger.length) return '';
    var st = LC.stats(state), keys = Object.keys(st.monthly), m = LC.TODAY.slice(0, 7);
    if (keys.indexOf(m) < 0 && keys.length) m = keys[keys.length - 1];
    var row = st.monthly[m] || {}, sum = function (pre) { return Object.keys(row).filter(function (k) { return k.indexOf(pre) === 0; }).reduce(function (t, k) { return t + row[k]; }, 0); };
    return ' · ' + (m === LC.TODAY.slice(0, 7) ? '이달' : m) + ' 생산 ' + sum('prod_ct_') + ' C/T · 선적 ' + sum('ship_ct_') + ' C/T · <a href="#stats">집계 ›</a>';
  }
  screens.home.bind = function () {
    var go = function () { var q = $('#home-q').value.trim(); if (q) location.hash = '#lot/' + encodeURIComponent(q); };
    $('#home-go').onclick = go; $('#home-q').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  };
  // LOT 자동완성: 원장 LOT·회사 코드·입고 ID
  function lotDatalist() {
    var opts = [];
    state.ledger.forEach(function (l) { opts.push(l.lot); if (l.company_code) opts.push(l.company_code); });
    state.raw.forEach(function (r) { opts.push(r.id); });
    return '<datalist id="lot-list">' + opts.filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
  }

  // 수정안: 규칙이 지적한 칸만 AI가 고쳐 쓰고(영양표·알레르겐·첨가물 문구는 코드가 품목 데이터로 만들어 넘김), 고친 라벨을 같은 규칙으로 다시 판정해 전후를 보여 준다
  function labelFix(country, fields, res, meta) {
    var hints = {};
    try { if (nutritionBy[country] && P().nutrition100) hints.nutrition = nutritionBy[country]().map(function (x) { return x[0] + ' ' + x[1]; }).join(' / '); } catch (e) {}
    if (allergenBy[country]) hints.allergen = allergenBy[country];
    if (additiveBy[country]) hints.additive = additiveBy[country];
    var out = $('#lbl-fixout'); out.innerHTML = '<p class="muted">지적된 칸만 고친 수정안을 만들고 같은 규칙으로 다시 판정합니다…</p>';
    return api('/label/fix', 'POST', { country: country, fields: fields, results: res.filter(function (x) { return x.status !== 'pass'; }), hints: hints }).then(function (r) {
      if (!r || !r.fields) { out.innerHTML = '<p class="alert">수정안 실패: ' + esc((r && r.error) || '응답 없음') + '</p>'; return; }
      var fixed = r.fields, res2 = judge(country, fixed), s0 = summarize(res), s2 = summarize(res2);
      var keys = Object.keys(fixed).filter(function (k) { return String(fixed[k] || '') !== String(fields[k] || ''); });
      var why = {}; (r.changes || []).forEach(function (c) { if (c && c.k) why[c.k] = c.why || ''; });
      var v = s2.fix ? ['bad', '수정안도 수정 ' + s2.fix + '항목 남음'] : s2.check ? ['warn', '수정안: 수정 0 · 확인 ' + s2.check + '항목 (자료 확인 필요)'] : ['ok', '수정안 통과 · ' + s2.pass + '항목 충족'];
      out.innerHTML = '<div class="card" id="lbl-fixcard"><h3>수정안 <span class="muted">(AI가 고친 칸 ' + keys.length + '개 · 규칙으로 다시 판정 · 보내기 전 사람이 확인)</span></h3>' +
        '<div class="verdict ' + v[0] + '">' + v[1] + '<span class="v-sub">전: 수정 ' + s0.fix + ' · 확인 ' + s0.check + ' → 후: 수정 ' + s2.fix + ' · 확인 ' + s2.check + '</span></div>' +
        (keys.length ? '<table><tr><th>칸</th><th>현재</th><th>수정안</th><th>이유</th></tr>' + keys.map(function (k) { return '<tr><td><b>' + esc(k) + '</b></td><td>' + fold(fields[k] || '', 80) + '</td><td>' + fold(fixed[k] || '', 80) + '</td><td class="muted">' + esc(why[k] || '') + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">바뀐 칸 없음</p>') +
        ((r.changes || []).some(function (c) { return /자료 필요/.test(String(c && (c.after || c.why))); }) ? '<p class="alert">자료가 없어 못 고친 칸이 있습니다. 표의 "이유"를 보고 자료를 넣으세요.</p>' : '') +
        '<div class="actions"><button class="lg" id="lbl-fixpdf">수정안 PDF</button></div></div>';
      state.lastFix = { country: country, file: meta.file, before: s0, after: s2, fields: fixed }; save();
      $('#lbl-fixpdf').onclick = function () { window.print(); };
    }).catch(function (e) { out.innerHTML = '<p class="alert">수정안 실패: ' + esc(e) + '</p>'; });
  }
  function labelArg(arg) { var a = String(arg || '').split('/'); return { key: LC.sampleLabels[a[0]] ? a[0] : null, country: LC.rules[a[1]] ? a[1] : null }; }
  screens.label = function (arg) {
    var la = labelArg(arg);
    var sel = Object.keys(LC.sampleLabels).map(function (k) { var sl = LC.sampleLabels[k]; return '<option value="' + k + '"' + (k === la.key ? ' selected' : '') + '>' + ((LC.rules[sl.country] || LC.rules[k] || {}).name || sl.country) + ' — ' + sl.file + '</option>'; }).join('');
    return '<h2>라벨 판정</h2><p class="sub">라벨 파일과 도착국을 고르세요.</p>' +
      '<div class="card no-print"><div class="chips" id="lbl-countries">' + Object.keys(LC.rules).map(function (k) { return '<button class="chip" data-ctry="' + k + '" aria-label="' + esc(LC.rules[k].name) + ' 규칙으로 판정">' + esc(LC.rules[k].name) + '</button>'; }).join('') + '</div>' +
      '<div class="row"><label>받은 파일 <select id="lbl-sample">' + sel + '</select></label>' +
      '<label>또는 엑셀 업로드 <input type="file" id="lbl-file" accept=".xlsx,.xls"></label>' +
      '<label>도착국 <select id="lbl-country">' + Object.keys(LC.rules).map(function (k) { return '<option value="' + k + '">' + LC.rules[k].name + '</option>'; }).join('') + '</select></label>' +
      '<label>라벨 기준일 <input type="date" id="lbl-made"></label><button class="ghost" id="lbl-run">판정</button></div></div>' +
      '<div id="lbl-out"></div>' + nutritionSourceTable();
  };
  // 영양값 출처: 바이어마다 다른 추정값이 어디서 왔는지. 비어 있으면 안 그림
  function nutritionSourceTable() {
    var ns = state.nutritionSources || [];
    if (!ns.length) return '';
    return '<div class="card"><h3>영양값 출처 (100g)</h3><table><tr><th>바이어</th><th>제품</th><th>열량(kcal)</th><th>단백질(g)</th><th>식염상당량(g)</th><th>근거</th><th>출처</th></tr>' +
      ns.map(function (x) { return '<tr><td>' + esc(x.buyer) + '</td><td>' + esc(x.product) + '</td><td>' + esc(x.kcal) + '</td><td>' + esc(x.protein) + '</td><td>' + esc(x.salt_g) + '</td><td>' + esc(x.basis) + '</td><td class="muted">' + esc(x.source) + '</td></tr>'; }).join('') +
      '</table><p class="muted">값이 다른 건 바이어마다 조미액이 달라서. 라벨 값은 바이어 제공, 자사 성적서는 조미 전 다른 제품.</p></div>';
  }
  function nutritionAlert() {
    var ns = state.nutritionSources || [], own = ns.filter(function (x) { return /성적서/.test(x.buyer); })[0], buy = ns.filter(function (x) { return x !== own && x.kcal != null; });
    var kc = buy.map(function (x) { return x.kcal; }).filter(function (k, i, a) { return a.indexOf(k) === i; });
    if (kc.length < 2) return '';
    return '<p class="alert bad">같은 제품인데 바이어별 열량이 <b>' + kc.map(esc).join(' · ') + ' kcal</b>로 달라요.' + (own ? ' 자사 성적서는 다른 제품(' + esc(own.kcal) + ' kcal)이에요.' : '') + '</p>';
  }
  function renderJudge(country, fields, meta) {
    var res = judge(country, fields); var s = summarize(res); var r = LC.rules[country];
    var rev = allRevisions().filter(function (v) { return v.country === country && meta.made && meta.made < v.effective; });
    var ref = function (x) { return x.src || r.short || r.law; };
    var v = s.fix ? ['bad', '수출 전 수정 필요 · ' + s.fix + '항목'] : s.check ? ['warn', '확인 필요 · ' + s.check + '항목'] : ['ok', '통과 · ' + r.name + ' 규정 ' + s.pass + '항목 충족'];
    var stat = function (cls, k, n) { return '<div class="stat ' + cls + '"><span class="k">' + k + '</span><span class="v">' + n + '<small>항목</small></span></div>'; };
    var html = '<div class="verdict ' + v[0] + '">' + v[1] + '<span class="v-sub">' + esc(r.name) + ' ' + esc(r.short || '') + ' 기준 · 라벨 기준일 ' + fmtDate(meta.made) + '</span></div>' +
      '<div class="stats">' + stat('bad', '수정', s.fix) + stat('warn', '확인', s.check) + stat('ok', '통과', s.pass) + '</div>' +
      (rev.length ? '<p class="alert">고시 개정 이후 라벨이에요: ' + rev.map(function (x) { return esc(x.title) + ' (시행 ' + x.effective + ')'; }).join(', ') + '</p>' : '') + nutritionAlert() +
      '<table><tr><th>항목</th><th>판정</th><th>근거</th><th>현재</th><th>고칠 것</th></tr>' +
      res.map(function (x) { return '<tr class="' + (x.status === 'fix' ? 'st-bad' : x.status === 'check' ? 'st-check' : '') + '"><td><b>' + esc(x.item) + '</b></td><td><span class="b ' + STATUS[x.status][1] + '">' + STATUS[x.status][0] + '</span></td><td><span class="ref" title="' + esc(ref(x)) + '">' + esc(ref(x)) + '</span></td><td class="muted">' + fold(x.msg, 40) + '</td><td class="fixto">' + fold(x.fix || '', 40) + '</td></tr>'; }).join('') +
      '</table>' +
      '<div class="actions"><details class="no-print"><summary>읽은 값</summary><pre>' + esc(JSON.stringify(fields, null, 1)) + '</pre></details><button class="lg" id="lbl-pdf">수정 요청서 PDF</button>' +
      (API && (s.fix || s.check) ? '<button class="lg" id="lbl-fix" aria-label="지적된 칸을 고친 수정안 만들기">수정안 만들기</button>' : '') + '</div><div id="lbl-fixout"></div>';
    $('#lbl-out').innerHTML = html;
    state.lastLabel = { country: country, made: meta.made, file: meta.file, summary: s };
    $('#lbl-pdf').onclick = function () { window.print(); };
    var fb = $('#lbl-fix'); if (fb) fb.onclick = function () { fb.disabled = true; fb.textContent = '수정안 만드는 중…'; labelFix(country, fields, res, meta).then(function () { fb.disabled = false; fb.textContent = '수정안 만들기'; }); };
    document.querySelectorAll('[data-ctry]').forEach(function (b) { b.classList.toggle('on', b.dataset.ctry === country); });
  }
  screens.label.bind = function (arg) {
    var sampleSel = $('#lbl-sample'), la = labelArg(arg);
    function syncSample() { var l = LC.sampleLabels[sampleSel.value]; $('#lbl-country').value = l.country; $('#lbl-made').value = l.made && l.made.length === 10 ? l.made : ''; }
    sampleSel.onchange = syncSample; syncSample();
    if (la.country) $('#lbl-country').value = la.country;   // 대시보드·홈에서 "이 나라 규칙으로" 들어온 경우
    document.querySelectorAll('[data-ctry]').forEach(function (b) { b.onclick = function () { $('#lbl-country').value = b.dataset.ctry; $('#lbl-run').click(); }; });
    var uploaded = null;
    $('#lbl-file').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var fr = new FileReader();
      fr.onload = function () { var wb = XLSX.read(fr.result, { type: 'array' }); uploaded = { file: file.name, fields: parseSheet(wb.Sheets[wb.SheetNames[0]]) }; $('#lbl-out').innerHTML = '<p class="muted">' + esc(file.name) + ' 읽음 (' + wb.SheetNames[0] + '). 판정을 누르세요.</p>'; };
      fr.readAsArrayBuffer(file);
    };
    if (state.pendingLabel && state.pendingLabel.fields) {   // 서류 넣기 "라벨 판정" 링크로 들어온 경우
      var pl = state.pendingLabel; state.pendingLabel = null; uploaded = { file: pl.file, fields: pl.fields };
      if (LC.rules[pl.country]) $('#lbl-country').value = pl.country;
      $('#lbl-out').innerHTML = '<p class="muted">' + esc(pl.file) + ' (서류 넣기에서 가져옴)</p>'; setTimeout(function () { $('#lbl-run').click(); }, 50);
    }
    $('#lbl-run').onclick = function () {
      var country = $('#lbl-country').value; var made = $('#lbl-made').value || null;
      if (uploaded) renderJudge(country, uploaded.fields, { made: made, file: uploaded.file });
      else { var l = LC.sampleLabels[sampleSel.value]; renderJudge(country, l.fields, { made: made, file: l.file }); }
    };
    $('#lbl-run').click();
  };

  screens.product = function () {
    var p = P();
    var ing = p.ingredients.map(function (i) { return '<tr><td>' + esc(i.name_ko) + '</td><td>' + (i.pct != null ? i.pct + '%' : '') + '</td><td>' + (i.type === 'additive' ? esc(i.func) + ' / INS ' + i.ins : '원료') + '</td></tr>'; }).join('');
    var nut = p.nutrition100 ? '<table>' + Object.keys(n).map(function (k) { return '<tr><td>' + esc(NUT_KO[k] || k) + '</td><td><input data-n="' + k + '" value="' + n[k] + '" size="6" aria-label="' + esc(NUT_KO[k] || k) + '"></td></tr>'; }).join('') + '</table>' : '<p class="alert">성적서 필요 · 이 품목은 영양값이 없음</p>';
    return '<h2>품목</h2><p class="sub">품목을 고르고 영양값을 확인하세요.</p>' +
      '<div class="row">' + productSelect('prd-prod') + '</div><div class="cols"><div class="card"><h3>' + esc(p.name_ko) + ' (' + p.code + ')</h3><table><tr><th>원재료</th><th>배합비</th><th>구분</th></tr>' + ing + '</table><p class="muted">알레르겐: 갑각류(게) · 공정: ' + esc(p.process) + '</p></div>' +
      '<div class="card"><h3>영양 (100g)</h3>' + nut + '<p class="muted">' + esc(p.nutrition_source) + '</p>' + (p.nutrition100 ? '<button id="prd-apply">환산</button>' : '') + '</div></div>' +
      (API ? '<details class="demo" id="prd-pub"><summary>품목제조보고에서 가져오기 (식약처 OpenAPI)</summary><div id="prd-pub-out" class="muted">열면 조회합니다</div></details>' : '<p class="muted">품목제조보고 가져오기는 서버 모드(run.bat)에서</p>') +
      '<div id="prd-out"></div>';
  };
  // 식약처 I1250 품목제조보고 → 표 → "품목으로 추가". 원재료명은 I1250 에 없어 비워 둔다
  function renderPubProducts() {
    var box = $('#prd-pub-out'); box.textContent = '조회 중…';
    api('/public/products').then(function (r) {
      if (r.error) { box.textContent = '조회 실패: ' + r.error; return; }
      var have = LC.products || {};
      box.innerHTML = '<p class="muted">' + esc(r.source || '') + ' · ' + (r.rows || []).length + '건' + (r.note ? ' · ' + esc(r.note) : '') + '</p><table><tr><th>보고번호</th><th>품명</th><th>식품유형</th><th>보고일</th><th></th></tr>' +
        (r.rows || []).map(function (x, i) { var code = 'P' + String(x.report_no || '').slice(-4); return '<tr><td>' + esc(x.report_no) + '</td><td>' + esc(x.prdlst_nm) + '</td><td>' + esc(x.prdlst_dcnm) + '</td><td>' + esc(x.report_date) + '</td><td>' + (have[code] ? '<span class="b ok">등록됨</span>' : '<button data-pub-add="' + i + '" aria-label="품목으로 추가">품목으로 추가</button>') + '</td></tr>'; }).join('') + '</table>';
      document.querySelectorAll('[data-pub-add]').forEach(function (b) {
        b.onclick = function () {
          var x = r.rows[+b.dataset.pubAdd], m = /(\d+)\s*개월/.exec(String(x.shelf_life || ''));
          var o = { code: 'P' + String(x.report_no || '').slice(-4), name_ko: x.prdlst_nm, type: x.prdlst_dcnm, report_no: x.report_no, shelf_months: m ? +m[1] : 24, source: '식약처 품목제조보고 ' + (x.report_date || '') };
          state.extraProducts = (state.extraProducts || []).filter(function (e) { return e.code !== o.code; }).concat([o]); addExtraProduct(o); setProduct(o.code); save();
          toast('품목 추가: ' + o.code + ' ' + o.name_ko + ' (영양 성적서는 서류 넣기에서)'); route();
        };
      });
    }).catch(function (e) { box.textContent = '조회 실패: ' + e; });
  }
  function renderProductOut() {
    if (!P().nutrition100) { $('#prd-out').innerHTML = '<p class="alert">성적서 필요 · 영양 성적서가 들어오면(서류 넣기) 나라별 환산표가 나옴</p>'; return; }
    var html = '<div class="grid4">' + Object.keys(LC.rules).map(function (k) {
      var r = LC.rules[k];
      return '<div class="card"><h3>' + r.name + '</h3><p class="muted">' + esc(r.law) + '</p><table>' + (k === 'CN' && typeof LC.nutritionCN === 'function' ? LC.nutritionCN(P()) : nutritionBy[k] ? nutritionBy[k]() : [['영양표시', '환산표 미구현']]).map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; }).join('') + '</table>' +
        '<p><b>알레르겐</b> ' + esc(allergenBy[k] || '(문구 미정)') + '</p><p><b>첨가물</b> ' + esc(additiveBy[k] || '(문구 미정)') + '</p><p class="muted">필수 항목 ' + r.required.length + '개: ' + esc(r.required.join(', ')) + '</p></div>';
    }).join('') + '</div>';
    $('#prd-out').innerHTML = html;
  }
  screens.product.bind = function () {
    bindProductSelect('prd-prod');
    var d = $('#prd-pub'); if (d) d.ontoggle = function () { if (d.open) renderPubProducts(); };
    if ($('#prd-apply')) $('#prd-apply').onclick = function () { document.querySelectorAll('[data-n]').forEach(function (i) { n[i.dataset.n] = parseFloat(i.value) || 0; }); renderProductOut(); };
    renderProductOut();
  };

  function certList() { return state.registry.filter(function (r) { return r.kind !== '선적별' && r.kind !== '참고' && !/미등록/.test(r.no); }).map(function (r) { return r.name + ' ' + r.no; }); }
  function specSheet(lot) {
    var p = (lot && LC.products && LC.products[lot.product]) || P();
    var rows = [['品名 / 제품명', p.name_en + ' / ' + p.name_ko], ['原材料・配合 / 원재료·배합', p.ingredients.map(function (i) { return i.name_ko + (i.pct != null ? ' ' + i.pct + '%' : ' (INS ' + i.ins + ')'); }).join(', ')],
      ['添加物 / 첨가물', p.ingredients.filter(function (i) { return i.type === 'additive'; }).map(function (i) { return i.func + ' ' + i.name_ko + ' INS ' + i.ins; }).join(', ')],
      ['アレルゲン / 알레르겐', '甲殻類(かに) / 갑각류(게)'], ['栄養成分 100g / 영양', p.nutrition100 ? nutritionBy.JP().slice(0, 5).map(function (x) { return x[0] + ' ' + x[1]; }).join(', ') + ' (' + p.nutrition_source + ')' : '성적서 필요 (' + p.nutrition_source + ')'],
      ['製造工程 / 공정', p.process], ['内容量・荷姿 / 내용량·포장', p.net + ' / ' + p.pack], ['保存 / 보존', p.storage + ', 소비기한 제조일로부터 ' + p.shelf_months + '개월'],
      ['製造者 / 제조자', p.factory.name + ' · 영업등록 ' + p.factory.lic], ['認証・登録 / 인증·등록', certList().join(' · ')]];
    if (lot) rows = rows.concat([['LOT', lot.lot + (lot.company_code ? ' (회사 코드 ' + lot.company_code + ')' : '')], ['製造日 / 제조일', lot.mfg], ['賞味期限 / 소비기한', lot.expiry], ['数量 / 수량', lot.qty_ct + ' C/T, ' + lot.kg + ' kg'], ['衛生証明書 / 위생증명서', lot.cert], ['出荷 / 선적', lot.ship], ['LOT 조회', location.origin + location.pathname + '#lot/' + lot.lot]]);
    return '<div class="sheet"><h3>' + (lot ? '로트 규격서 (出荷ロット規格書)' : '품목 규격서 (原材料規格書・製造工程表)') + '</h3><p class="muted">바이어 양식 템플릿 기준 · 발행일 ' + LC.TODAY + '</p><table>' + rows.map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table></div>';
  }
  // 바이어 양식 규격서: 서류 넣기에서 승인한 양식(state.specForms[buyer])의 칸 순서 그대로. 우리 데이터에 없는 값은 노란 빈칸
  // 우리 데이터를 agent/graph.py OURS 키로 펼친다. 바이어 양식 칸은 승인된 mapping(라벨 → 키)으로 여기서 값을 가져간다
  function oursValues(p, lot, buyer) {
    var adds = p.ingredients.filter(function (i) { return i.type === 'additive'; }), certs = certList();
    var v = { 'buyer.name': buyer, 'doc.date': LC.TODAY, 'doc.issuer': 'A사',
      'product.name_ko': p.name_ko, 'product.name_en': p.name_en, 'product.name_ja': p.name_ja || '', 'product.code': p.code,
      'product.species': (p.ingredients[0] || {}).name_ko || '', 'product.origin': '韓国 / 한국산',
      'product.ingredients': p.ingredients.map(function (i) { return i.name_ko + (i.pct != null ? ' ' + i.pct + '%' : ''); }).join(', '),
      'product.additives': adds.map(function (i) { return i.func + ' ' + i.name_ko + ' INS ' + i.ins; }).join(', '),
      'product.allergen': Array.isArray(p.allergens) ? p.allergens.join(', ') : (p.allergens || '甲殻類(かに) / 갑각류(게)'),
      'product.nutrition': p.nutrition100 ? nutritionBy.JP().slice(0, 5).map(function (x) { return x[0] + ' ' + x[1]; }).join(', ') : '',
      'product.shelf_life_months': p.shelf_months + '개월 (' + Math.round(p.shelf_months / 12) + '年間)', 'product.net': p.net, 'product.pack': p.pack, 'product.process': p.process, 'product.storage': p.storage,
      'factory.name': p.factory.name, 'factory.lic': p.factory.lic, 'factory.haccp': certs.filter(function (c) { return /HACCP/i.test(c); }).join(' · '), 'factory.registrations': certs.join(' · ') };
    if (lot) { v['lot.lot'] = lot.lot; v['lot.company_code'] = lot.company_code || ''; v['lot.mfg'] = lot.mfg; v['lot.expiry'] = lot.expiry; v['lot.qty_ct'] = lot.qty_ct + ' C/T'; v['lot.kg'] = lot.kg + ' kg'; v['lot.raw'] = lot.raw_by || lot.raw || ''; v['lot.ship'] = lot.ship || ''; v['lot.cert'] = lot.cert || ''; }
    return v;
  }
  function buyerFormSheet(buyer, lot) {
    var f = state.specForms[buyer] || {}, p = (lot && LC.products && LC.products[lot.product]) || P(), miss = ' style="background:#fff3bf"';
    var mp = f.mapping || {}, ours = oursValues(p, lot, buyer);
    var code = (String(f.spec || '').match(/商品コード\s*([\w\-－]+)/) || [])[1] || '';
    var val = { '会社名': buyer, '作成日': LC.TODAY, '韓国商品名': p.name_en, '日本商品名': p.name_ja || '', '商品コード': code, '工場': 'A사', '規格': p.pack,
      '賞味期限': p.shelf_months + '개월 (' + Math.round(p.shelf_months / 12) + '年間)', '単位': 'ケース', '形態': p.note || '' };
    if (lot) { val['LOT'] = lot.lot + (lot.company_code ? ' (' + lot.company_code + ')' : ''); val['製造日'] = lot.mfg; val['賞味期限'] = lot.expiry; }
    var gf = function (x) { return typeof x === 'string' ? x : x.name + (x.g != null ? ' ' + x.g + 'g' : '') + (x.pct != null ? ' (' + x.pct + '%)' : ''); };
    var td = function (k) { var v = mp[k] && ours[mp[k]] ? ours[mp[k]] : val[k]; return '<tr><th>' + esc(k) + '</th><td' + (v ? '' : miss) + '>' + esc(v || '') + '</td></tr>'; };
    var list = function (title, arr) { if ((f.fields || []).indexOf(title) < 0 && !(arr && arr.length)) return ''; return '<tr><th colspan="2">' + title + '</th></tr>' + (arr && arr.length ? arr.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(gf(x)) + '</td></tr>'; }).join('') : '<tr><td colspan="2"' + miss + '></td></tr>'); };
    var sections = ['重点管理', '配合', '調味液', '包装資材'], basic = (f.fields || Object.keys(val)).filter(function (k) { return sections.indexOf(k) < 0; });
    if (lot) basic = basic.concat(['LOT', '製造日']);
    var hit = Object.keys(mp).filter(function (k) { return mp[k] && ours[mp[k]]; }).length;
    return '<div class="sheet"><h3>' + esc(f.form_title || '商品規格書') + ' — ' + esc(buyer) + '</h3><p class="muted">' + esc(buyer) + ' 양식 칸 순서 그대로 · 노란 칸은 우리 데이터에 없는 값' + (f.mapping ? ' · AI가 짝지은 칸 ' + hit + '/' + Object.keys(mp).length + ' (승인됨)' : '') + ' · 발행일 ' + LC.TODAY + '</p><table>' +
      basic.map(td).join('') + list('重点管理', f.qc) + list('配合', f.recipe) + list('調味液', f.seasoning) + list('包装資材', f.packaging) + '</table></div>';
  }
  function formSelect(id) {
    var ks = Object.keys(state.specForms || {}); if (!ks.length) return '';
    return '<label>양식 <select id="' + id + '"><option value="">기본</option>' + ks.map(function (k) { return '<option value="' + esc(k) + '"' + (k === state.specBuyer ? ' selected' : '') + '>' + esc(k) + ' ' + esc(state.specForms[k].form_title || '規格書') + '</option>'; }).join('') + '</select></label>';
  }
  function sheetFor(lot) { return state.specBuyer && state.specForms[state.specBuyer] ? buyerFormSheet(state.specBuyer, lot) : specSheet(lot); }
  screens.spec = function () {
    return '<h2>규격서</h2><p class="sub">품목과 양식을 고르고 인쇄하세요.</p>' +
      '<div class="row">' + productSelect('sp-prod') + formSelect('sp-form') + '</div><button onclick="window.print()">PDF로 저장(인쇄)</button>' + sheetFor(null);
  };
  screens.spec.bind = function () { bindProductSelect('sp-prod'); var el = $('#sp-form'); if (el) el.onchange = function () { state.specBuyer = el.value; route(); }; };

  screens.ship = function () {
    var raw = state.raw.map(function (r) { return '<label class="chk"><input type="checkbox" name="raw" value="' + r.id + '"> ' + r.id + ' · ' + r.species + ' 어획 ' + r.caught + ' ' + r.landing + ' ' + r.kg + 'kg' + (r.note ? ' <small class="muted">' + esc(r.note) + '</small>' : '') + '</label>'; }).join('');
    return '<h2>선적·원장</h2><p class="sub">제조일·수량을 넣고 원어 로트를 고르세요.</p>' +
      '<div class="card"><div class="row">' + productSelect('sh-prod') + '<label>제조일 <input type="date" id="sh-mfg" value="2026-10-14"></label><label>수량(C/T) <input type="number" id="sh-qty" value="100"></label><label>중량(kg) <input type="number" id="sh-kg" value="1000"></label>' +
      '<label>위생증명서 번호 <input id="sh-cert" value="해당 없음" placeholder="요구하는 바이어만 번호 입력"></label><label>도착국 <select id="sh-country"><option>TW</option><option>JP</option><option>HK</option><option>TH</option><option>CN</option></select></label>' +
      '<label>바이어 <input id="sh-buyer" list="buyer-list" value="' + (LC.buyers && LC.buyers.length ? '일본 바이어 ' + LC.buyers[0].code : '대만 바이어 F사') + '"><datalist id="buyer-list">' + (LC.buyers || []).map(function (b) { return '<option value="' + (b.country === 'JP' ? '일본' : b.country) + ' 바이어 ' + esc(b.code) + '">' + esc(b.port + ' · ' + b.spec_form + ' · 증명서 ' + b.cert) + '</option>'; }).join('') + '</datalist></label><label>선적 <input id="sh-ship" value="2026-10-20 부산→기륭"></label></div><div class="rawbox"><b>원어 입고 로트</b><br>' + raw + '</div><button id="sh-add">원장에 추가 + 로트 규격서</button></div>' +
      '<div id="sh-out"></div><h3>선적 목록</h3>' + shipmentCards() + '<h3>로트 원장</h3><div id="sh-ledger"></div><button class="ghost" id="sh-reset">시드로 초기화</button>';
  };
  function shipmentCards() {  // state.shipments(패킹리스트 승인 또는 시드) → 선적별 카드
    if (!state.shipments.length) return '<p class="muted">선적 없음 · 서류 넣기에서 패킹리스트를 승인하면 생김</p>';
    return state.shipments.map(function (sh) {
      var lots = state.ledger.filter(function (l) { return (l.ship || '').indexOf(sh.no) >= 0; });
      return '<div class="card"><b>' + esc(sh.no) + '</b> · 출항 ' + esc(sh.etd || sh.date) + ' · ' + esc(sh.buyer) + ' · ' + esc(sh.vessel) + ' · ' + esc(sh.route) + ' · 증명서: ' + esc(sh.cert || '해당 없음') +
        '<table><tr><th>품목</th><th class="num">C/T</th><th class="num">kg</th></tr>' + (sh.items || []).map(function (it) { return '<tr><td>' + esc(it.desc) + '</td><td class="num">' + it.ct + '</td><td class="num">' + (it.kg != null ? it.kg : '-') + '</td></tr>'; }).join('') +
        '<tr><th>합계</th><th class="num">' + (sh.total_ct != null ? sh.total_ct : '') + '</th><th class="num">' + (sh.total_kg != null ? sh.total_kg : '') + '</th></tr></table>' +
        '<p><b>이 선적에 연결된 LOT</b> ' + (lots.length ? lots.map(function (l) { return '<a href="#lot/' + l.lot + '">' + l.lot + (l.company_code ? ' (' + l.company_code + ')' : '') + '</a>'; }).join(', ') : '연결된 LOT 없음 · 서류 넣기에서 패킹리스트를 승인하면 연결') + '</p>' +
        (sh.note ? '<p class="muted">' + esc(sh.note) + '</p>' : '') + shipDocLinks(sh.no) + '</div>';
    }).join('');
  }
  // 선적 서류 자동 생성(서버 agent/shipdocs.py). 오프라인이면 안내만
  function shipDocLinks(no) {
    if (!API) return '<p class="muted">선적 서류 자동 생성(제조일자 리스트·패킹리스트 초안·위생증명서 신청값)은 서버 모드에서 가능</p>';
    var q = encodeURIComponent(no);
    return '<p class="docs"><b>서류 생성</b> <a href="/api/shipdocs/mdl?no=' + q + '" download>제조일자 리스트 xlsx</a> · <a href="/api/shipdocs/pl?no=' + q + '" download>패킹리스트 초안 xlsx</a> · <a href="/api/shipdocs/cert?no=' + q + '" download>위생증명서 신청값 xlsx</a></p>';
  }
  function ledgerTable() {
    if (!state.ledger.length) return emptyLedger();
    return '<table><tr><th>LOT</th><th>제조일</th><th>소비기한</th><th>수량</th><th>원어 로트</th><th>도착국</th><th>바이어</th><th>선적</th><th>증명서</th><th>규격서 발송</th></tr>' +
      state.ledger.map(function (l) { return '<tr><td><a href="#lot/' + l.lot + '">' + l.lot + '</a></td><td>' + l.mfg + (l.company_code ? '<br><small>코드 ' + l.company_code + '</small>' : '') + '</td><td>' + l.expiry + '</td><td>' + l.qty_ct + ' C/T</td><td>' + l.raw.join('<br>') + '</td><td>' + l.country + '</td><td>' + esc(l.buyer) + '</td><td>' + esc(l.ship) + '</td><td>' + esc(l.cert) + '</td><td>' + l.spec_sent + '</td></tr>'; }).join('') + '</table>';
  }
  function addMonths(iso, m) { var d = new Date(iso); d.setMonth(d.getMonth() + m); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
  screens.ship.bind = function () {
    bindProductSelect('sh-prod');
    $('#sh-ledger').innerHTML = ledgerTable();
    $('#sh-add').onclick = function () {
      var mfg = $('#sh-mfg').value; var base = mfg.replace(/-/g, '') + '-' + P().code;
      var same = state.ledger.filter(function (l) { return l.lot.indexOf(base) === 0; }).length;
      var lot = { lot: base + (same ? '-' + (same + 1) : ''), product: P().code, mfg: mfg, expiry: addMonths(mfg, P().shelf_months), qty_ct: +$('#sh-qty').value, kg: +$('#sh-kg').value,
        raw: Array.prototype.map.call(document.querySelectorAll('input[name=raw]:checked'), function (c) { return c.value; }), country: $('#sh-country').value, buyer: $('#sh-buyer').value, ship: $('#sh-ship').value, cert: $('#sh-cert').value, spec_sent: LC.TODAY };
      if (!lot.raw.length) { alert('원어 로트를 하나 이상 고르세요'); return; }
      state.ledger.push(lot); save();
      $('#sh-out').innerHTML = '<p class="alert ok">원장 1줄 추가: <b>' + lot.lot + '</b> · 바이어 메일에 첨부할 링크 <a href="#lot/' + lot.lot + '">#lot/' + lot.lot + '</a></p><button onclick="window.print()">PDF로 저장(인쇄)</button>' + sheetFor(lot);
      $('#sh-ledger').innerHTML = ledgerTable();
    };
    $('#sh-reset').onclick = function () { resetAll(); route(); };
  };

  screens.lot = function (arg) {
    return '<h2>LOT 조회</h2><p class="sub">LOT 번호나 회사 코드를 넣으세요.</p>' +
      (state.ledger.length ? '' : emptyLedger()) +
      '<div class="row"><input id="lot-q" list="lot-list" placeholder="LOT · 회사 코드(AJ) · 입고 ID(R-…)" value="' + esc(arg || '') + '" size="34" aria-label="LOT 검색">' + lotDatalist() + '<button id="lot-go" aria-label="조회">조회</button>' +
      '<span class="tabs" role="tablist"><button class="tab' + (lotInside ? ' ghost' : '') + '" id="lot-tab-buyer" role="tab" aria-selected="' + !lotInside + '">바이어 면</button><button class="tab' + (lotInside ? '' : ' ghost') + '" id="lot-tab-inside" role="tab" aria-selected="' + lotInside + '">회사 면(내부)</button></span></div><div id="lot-out">' + (arg ? '' : recentLots()) + '</div>';
  };
  // 검색 전: 최근 LOT 표. 누르면 바로 조회
  function recentLots() {
    if (!state.ledger.length) return '';
    var rows = state.ledger.slice(-10).reverse();
    return '<div class="card"><h3>최근 LOT</h3><table><tr><th>LOT</th><th>회사 코드</th><th>제조일</th><th>바이어</th><th>선적</th></tr>' +
      rows.map(function (l) { return '<tr><td><a href="#lot/' + l.lot + '">' + l.lot + '</a></td><td>' + esc(l.company_code || '') + '</td><td>' + l.mfg + '</td><td>' + esc(l.buyer) + '</td><td>' + (shipped(l) ? '<span class="b ok">선적됨</span> ' + esc(String(l.ship).split(' / ')[0]) : '<span class="b warn">미선적</span>') + '</td></tr>'; }).join('') + '</table></div>';
  }
  var lotInside = false;   // 바이어 면 / 회사 면 탭
  function renderLot(q, inside) {
    var out = $('#lot-out');
    if (!/^R-/.test(q)) { var byCode = state.ledger.filter(function (l) { return l.company_code === q; }); if (byCode.length && !state.ledger.some(function (l) { return l.lot === q; })) q = byCode[byCode.length - 1].lot; }
    if (/^R-/.test(q)) {
      var raw = state.raw.filter(function (r) { return r.id === q; })[0];
      var lots = state.ledger.filter(function (l) { return l.raw.indexOf(q) >= 0; });
      out.innerHTML = '<div class="card"><h3>원어 로트 ' + esc(q) + ' → 역추적 (회사 면)</h3>' + (raw ? '<p>' + raw.species + ' · 어획 ' + raw.caught + ' · ' + esc(raw.vessel) + ' · ' + esc(raw.landing) + ' · 입고 ' + raw.received + ' · ' + raw.kg + 'kg' + (raw.note ? ' · <span class="muted">' + esc(raw.note) + '</span>' : '') + '</p>' : '<p class="muted">입고 기록 없음</p>') +
        '<table><tr><th>제품 LOT</th><th>제조일</th><th>수량</th><th>도착국</th><th>바이어</th><th>선적</th></tr>' + lots.map(function (l) { return '<tr><td><a href="#lot/' + l.lot + '">' + l.lot + (l.company_code ? ' (' + l.company_code + ')' : '') + '</a></td><td>' + l.mfg + '</td><td>' + l.qty_ct + ' C/T</td><td>' + l.country + '</td><td>' + esc(l.buyer) + '</td><td>' + esc(l.ship) + '</td></tr>'; }).join('') + '</table>' +
        '<p class="alert">영향 범위: 같은 원어가 들어간 제품 로트 ' + lots.length + '건, ' + lots.reduce(function (a, l) { return a + l.qty_ct; }, 0) + ' C/T. 바이어 문의에 이 표로 답한다. 회수 여부는 바이어·현지 절차.</p></div>';
      return;
    }
    var lot = state.ledger.filter(function (l) { return l.lot === q; })[0];
    if (!lot) { out.innerHTML = '<p class="alert">LOT 없음</p>'; return; }
    var p = (LC.products && LC.products[lot.product]) || LC.product;
    var buyer = [['제품', p.name_en], ['LOT', lot.lot + (lot.company_code ? ' / ' + lot.company_code : '')], ['제조일', lot.mfg], ['소비기한', lot.expiry], ['수량', lot.qty_ct + ' C/T / ' + lot.kg + ' kg'], ['보존', p.storage], ['위생증명서', lot.cert || '해당 없음'], ['규격서', '로트 규격서 발송 ' + (lot.spec_sent || '-')], ['제조자 인증·등록', certList().join(' · ')]];
    var pub = API ? location.origin + '/lot/' + encodeURIComponent(lot.lot) : '';
    var html = '<div class="card face-buyer"><h3>바이어 면 — ' + lot.lot + '</h3><table>' + buyer.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table><p class="muted">서류로 이미 보낸 정보만.</p>' +
      (pub ? '<p class="muted">바이어 공개 주소: <a href="' + esc(pub) + '" target="_blank">' + esc(pub) + '</a></p>' : '') + '</div>';
    if (inside) {
      var raws = state.raw.filter(function (r) { return lot.raw.indexOf(r.id) >= 0; });
      var siblings = state.ledger.filter(function (l) { return l.lot !== lot.lot && l.raw.some(function (r) { return lot.raw.indexOf(r) >= 0; }); });
      html += '<div class="card face-inside"><h3>회사 면 — 원어 로트 · 출고처' + (lot.raw_by ? ' <small class="muted">연결 근거: ' + esc(lot.raw_by) + '</small>' : '') + '</h3><table><tr><th>원어 로트</th><th>어획일</th><th>선박</th><th>위판장</th><th>입고</th><th>kg</th></tr>' + raws.map(function (r) { return '<tr><td><a href="#lot/' + r.id + '">' + r.id + '</a></td><td>' + r.caught + '</td><td>' + esc(r.vessel) + '</td><td>' + esc(r.landing) + '</td><td>' + r.received + '</td><td>' + r.kg + '</td></tr>'; }).join('') + '</table>' +
        '<p><b>출고처</b> ' + esc(lot.buyer) + ' · ' + esc(lot.ship) + ' · ' + lot.country + '</p><p><b>같은 원어가 들어간 다른 로트</b> ' + (siblings.length ? siblings.map(function (l) { return '<a href="#lot/' + l.lot + '">' + l.lot + '</a> (' + l.country + ' ' + esc(l.buyer) + ')'; }).join(', ') : '없음') + '</p>' +
        '<h4>클레임 종류별로 꺼낼 기록 (제조일 ' + lot.mfg + ')</h4><table><tr><th>클레임</th><th>먼저 볼 기록</th><th>원료(배) 추적</th></tr>' +
        LC.claimMap.map(function (c) { return '<tr><td>' + c.kind + '</td><td>' + esc(c.records.split('{mfg}').join(lot.mfg)) + '</td><td>' + (c.raw ? '필요 · 위 원어 로트 ' + raws.length + '건' : '불필요') + '</td></tr>'; }).join('') +
        '</table><p class="muted">원본 일지는 공장 서류함에서.</p>' +
        (API ? '<p><a href="/api/lot/' + encodeURIComponent(lot.lot) + '/qr.png" target="_blank" aria-label="QR 라벨 열기">QR 라벨 (PNG)</a> <span class="muted">포장·박스에 붙이면 공개 페이지로 연결</span> · <a href="/api/shipdocs/buyer?lot=' + encodeURIComponent(lot.lot) + '" download aria-label="바이어 패키지 받기">바이어 패키지 zip</a> <span class="muted">규격서·LOT 정보·인증 목록</span></p>' : '<p class="muted">QR 라벨·바이어 패키지 zip 은 서버 모드에서 가능</p>') +
        '<div class="row"><label>클레임 종류 <select id="claim-kind">' + LC.claimMap.map(function (c) { return '<option>' + esc(c.kind) + '</option>'; }).join('') + '</select></label><button id="claim-go">대응 보고서 만들기</button></div></div><div id="claim-out"></div>';
    }
    out.innerHTML = html;
    var cg = $('#claim-go');
    if (cg) cg.onclick = function () {
      var kind = $('#claim-kind').value;
      $('#claim-out').innerHTML = claimReport(lot, kind);
      $('#claim-print').onclick = function () { window.print(); };
      state.docs.push({ at: LC.TODAY, file: '클레임 보고서 ' + lot.lot, doc_type: '클레임대응', result: kind }); save();
    };
  }
  // 클레임 대응 기록 한 장. 사실(기록 이름·날짜)만 적고 원인은 단정하지 않는다. 회신 문안은 템플릿(AI 아님)
  function claimReport(lot, kind) {
    var p = (LC.products && LC.products[lot.product]) || LC.product;
    var c = LC.claimMap.filter(function (x) { return x.kind === kind; })[0] || LC.claimMap[0];
    var raws = state.raw.filter(function (r) { return lot.raw.indexOf(r.id) >= 0; });
    var sib = state.ledger.filter(function (l) { return l.lot !== lot.lot && (l.mfg === lot.mfg || l.raw.some(function (r) { return lot.raw.indexOf(r) >= 0; })); });
    var recs = c.records.split('{mfg}').join(lot.mfg);
    var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + esc(v) + '</td></tr>'; };
    var rawTbl = c.raw
      ? '<table><tr><th>입고 ID</th><th>선박</th><th>조업</th><th>입고</th><th>kg</th><th>비고</th></tr>' + raws.map(function (r) { return '<tr><td>' + r.id + '</td><td>' + esc(r.vessel) + '</td><td>' + esc(r.caught) + '</td><td>' + r.received + '</td><td class="num">' + r.kg + '</td><td class="muted">' + esc(r.note || '') + '</td></tr>'; }).join('') + '</table>'
      : '<p class="muted">이 클레임 종류는 원료 추적 대상 아님 (손 공정 기록을 본다)</p>';
    var rawDates = raws.map(function (r) { return r.received; }).filter(function (d, i, a) { return a.indexOf(d) === i; }).join(', ');
    var ko = '귀사에서 문의하신 LOT ' + lot.lot + (lot.company_code ? '(' + lot.company_code + ')' : '') + ' 건에 대해 알려드립니다. 해당 로트는 ' + lot.mfg + ' 생산분이며' + (c.raw && rawDates ? ' 원료 입고일은 ' + rawDates + '입니다' : '') + '. 당사는 다음 기록을 확인했습니다: ' + recs + '. 확인 결과와 조치 내용은 정리되는 대로 다시 안내드리겠습니다.';
    var ja = 'お問い合わせのLOT ' + lot.lot + (lot.company_code ? '(' + lot.company_code + ')' : '') + ' についてご連絡いたします。当該ロットは ' + lot.mfg + ' 製造分で' + (c.raw && rawDates ? '、原料入荷日は ' + rawDates + ' です' : 'す') + '。弊社では次の記録を確認いたしました: ' + recs + '。確認結果と対応内容は、整い次第あらためてご案内いたします。';
    return '<div class="card sheet"><h3>클레임 대응 기록 — LOT ' + esc(lot.lot) + (lot.company_code ? ' (' + esc(lot.company_code) + ')' : '') + '</h3><p class="muted">작성일 ' + LC.TODAY + ' · 작성 A사 품질·무역 담당</p>' +
      '<h4>1. 제품·로트</h4><table>' + row('품목', p.name_ko + ' (' + p.code + ')') + row('제조일', lot.mfg) + row('소비기한', lot.expiry) + row('수량', lot.qty_ct + ' C/T / ' + lot.kg + ' kg') + row('선적', lot.ship || '미선적') + row('증명서', lot.cert || '해당 없음') + '</table>' +
      '<h4>2. 클레임 종류와 먼저 볼 기록</h4><table>' + row('종류', kind) + row('기록', recs) + '</table>' +
      '<h4>3. 원료</h4>' + rawTbl +
      '<h4>4. 같은 날 생산분 · 같은 원료가 들어간 다른 로트</h4>' + (sib.length ? '<table><tr><th>LOT</th><th>제조일</th><th>수량</th><th>출고처</th></tr>' + sib.map(function (l) { return '<tr><td>' + l.lot + (l.company_code ? ' (' + l.company_code + ')' : '') + '</td><td>' + l.mfg + '</td><td class="num">' + l.qty_ct + ' C/T</td><td>' + esc(l.buyer) + ' · ' + esc(l.ship || '미선적') + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">없음</p>') +
      '<h4>5. 조치</h4><p>☐ 일지 확인 &nbsp; ☐ 보관 샘플 확인 &nbsp; ☐ 바이어 회신 &nbsp; ☐ 재발 방지</p><p style="border:1px solid #ccc;height:70px"></p>' +
      '<h4>6. 바이어 회신 문안 초안 (템플릿)</h4><p>' + esc(ko) + '</p><p>' + esc(ja) + '</p>' +
      '<button id="claim-print">인쇄 / PDF</button></div>';
  }
  screens.lot.bind = function (arg) {
    var go = function () { var q = $('#lot-q').value.trim(); if (q) renderLot(q, lotInside); };
    $('#lot-go').onclick = go; $('#lot-q').onkeydown = function (e) { if (e.key === 'Enter') go(); };
    var setTab = function (inside) { lotInside = inside; $('#lot-tab-buyer').className = 'tab' + (inside ? ' ghost' : ''); $('#lot-tab-inside').className = 'tab' + (inside ? '' : ' ghost'); $('#lot-tab-buyer').setAttribute('aria-selected', !inside); $('#lot-tab-inside').setAttribute('aria-selected', inside); go(); };
    $('#lot-tab-buyer').onclick = function () { setTab(false); }; $('#lot-tab-inside').onclick = function () { setTab(true); };
    if (arg) go();
  };

  // 고시 개정 목록 = 규칙 파일에 적힌 것 + 서류 넣기에서 고시문을 승인해 추가한 것(state.revisions)
  function allRevisions() { var mine = state.revisions || []; return LC.revisions.filter(function (v) { return !mine.some(function (m) { return m.country === v.country && m.effective === v.effective; }); }).concat(mine); }   // 같은 나라·같은 시행일이면 고시문에서 읽은 것이 기존 줄을 대신한다
  // 고시 개정 한 줄에 영향받는 라벨: 같은 나라 샘플 중 기준일이 시행일보다 이른 것. 각각 그 나라 규칙으로 판정해 수정 N 배지
  function affectedLabels(v) {
    return Object.keys(LC.sampleLabels).filter(function (k) { var l = LC.sampleLabels[k]; return l.country === v.country && (!l.made || l.made < v.effective); })
      .map(function (k) { var l = LC.sampleLabels[k], s = LC.rules[v.country] ? summarize(judge(v.country, l.fields)) : null; return { key: k, file: l.file, made: l.made, s: s }; });
  }
  function revisionLabels(v) {
    if (!LC.rules[v.country]) return '<span class="muted">규칙 파일 없음</span>';
    var hits = affectedLabels(v);
    if (!hits.length) { var alt = LC.sampleLabels.HK ? 'HK' : Object.keys(LC.sampleLabels)[0]; return '<span class="muted">이 나라 라벨 없음</span> · <a href="#label/' + alt + '/' + v.country + '">' + esc(LC.sampleLabels[alt].file) + '로 이 규칙 검사</a>'; }
    return hits.map(function (h) { return '<a href="#label/' + h.key + '/' + v.country + '">' + esc(h.file) + '</a> <span class="b ' + (h.s.fix ? 'bad' : h.s.check ? 'warn' : 'ok') + '">수정 ' + h.s.fix + '</span><small class="muted"> 확인 ' + h.s.check + ' · 기준일 ' + fmtDate(h.made) + '</small>'; }).join('<br>');
  }
  function dashCounts() {
    var cnt = { bad: 0, warn: 0, ok: 0 };
    state.registry.forEach(function (r) { if (!r.expiry) return; var d = daysTo(r.expiry); cnt[d <= r.lead || d <= 30 ? 'bad' : d <= 90 ? 'warn' : 'ok']++; });
    return cnt;
  }
  // 상단 숫자 3개: 만료 임박(90일 이내) / 개정 대응(시행 전 개정 중 영향 라벨 있는 건) / 확인 필요(번호·만료일 확인이 남은 등록)
  function dashStats() {
    var soon = state.registry.filter(function (r) { return r.expiry && daysTo(r.expiry) <= 90; }).length;
    var rev = allRevisions().filter(function (v) { return daysTo(v.effective) >= 0 && LC.rules[v.country] && affectedLabels(v).length; }).length;
    var need = state.registry.filter(function (r) { return /확인/.test(String(r.no) + ' ' + String(r.note)) && r.kind !== '참고'; }).length;
    var stat = function (n, label, cls, href) { return '<a class="stat ' + cls + '" href="' + href + '"><span class="k">' + label + '</span><span class="v">' + n + '</span></a>'; };
    return '<div class="stats">' + stat(soon, '만료 임박', soon ? 'warn' : 'ok', '#dash') + stat(rev, '개정 대응', rev ? 'warn' : 'ok', '#dash') + stat(need, '확인 필요', need ? 'warn' : 'ok', '#dash') + '</div>';
  }
  screens.dash = function () {
    var sorted = state.registry.slice().sort(function (a, b) { var da = a.expiry ? daysTo(a.expiry) : 1e9, db = b.expiry ? daysTo(b.expiry) : 1e9; return da - db; });   // 급한 것 위, 만료일 없는 행은 아래
    var rows = sorted.map(function (r) {
      var d = r.expiry ? daysTo(r.expiry) : null; var cls = d == null ? '' : d <= r.lead || d <= 30 ? 'bad' : d <= 90 ? 'warn' : 'ok';
      return '<tr><td>' + r.kind + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.no) + '</td><td>' + esc(r.issuer) + '</td><td>' + fmtDate(r.expiry) + '</td><td>' + (d == null ? '-' : '<span class="b ' + cls + '">D-' + d + '</span>') + '</td><td>' + r.countries + '</td><td class="muted">' + fold(r.note) + '</td></tr>';
    }).join('');
    var rev = allRevisions().map(function (v) {
      var d = daysTo(v.effective);
      return '<tr><td>' + v.country + '</td><td>' + esc(v.title) + (v.added ? ' <span class="b ok">고시문에서 추가</span>' : '') + '</td><td>' + v.effective + ' (' + (d < 0 ? '시행 중' : 'D-' + d) + ')</td><td>' + revisionLabels(v) + '</td><td class="muted">' + fold(v.note) + '</td></tr>';
    }).join('');
    return '<h2>대시보드</h2>' + dashStats() +
      '<div class="card"><h3>등록·인증 레지스트리 (오늘 ' + LC.TODAY + ')</h3><table><tr><th>층</th><th>종류</th><th>번호</th><th>발급</th><th>만료</th><th>D-day</th><th>국가</th><th>비고</th></tr>' + rows + '</table></div>' +
      '<div class="card"><h3>고시 개정 → 영향받는 라벨</h3><table><tr><th>국</th><th>고시</th><th>시행일</th><th>재검토 라벨</th><th>비고</th></tr>' + rev + '</table></div>' +
      '<div class="card" id="pub-card"><h3>식약처 공공데이터 조회</h3>' +
      (API ? '<div class="row"><button id="pub-go" aria-label="식약처 조회">조회</button><span class="muted">업소 인허가(I2500) · HACCP(I0610) · 회수(I0490) · 인증서 대조</span></div><div id="pub-out">' + pubView(state.publicData) + '</div>' : '<p class="muted">서버 모드(run.bat)에서 조회. 오프라인에서는 저장된 결과만</p>' + pubView(state.publicData)) + '</div>';
  };
  // 식약처 조회 결과 표시. 값은 그대로, 판단은 note 그대로 보여 준다
  function pubView(d) {
    if (!d || !d.at) return '<p class="muted">아직 조회 안 함</p>';
    var c = d.company || {}, h = d.compare && d.compare.haccp || {}, rc = d.recalls || {};
    var inds = (c.rows || []).map(function (r) { return r.industry; }).filter(function (v, i, a) { return v && a.indexOf(v) === i; });
    var row = function (k, v) { return '<tr><th>' + k + '</th><td>' + v + '</td></tr>'; };
    return '<table>' +
      row('업소 인허가', c.error ? '오류: ' + esc(c.error) : (c.rows || []).length + '건 · 업종: ' + esc(inds.join(', ') || '-') + ' · 최초 허가 ' + esc((c.rows || []).map(function (r) { return r.permit_date; }).filter(Boolean).sort()[0] || '-')) +
      row('HACCP 대조', h.error ? '오류: ' + esc(h.error) : '<span class="b ' + (h.match ? 'ok' : 'warn') + '">' + (h.match ? '일치' : '불일치·미확인') + '</span> 우리 ' + esc(h.ours ? h.ours.no + ' ~' + h.ours.expiry : '-') + ' / 식약처 ' + esc(h.mfds ? (h.mfds.haccp_no || '') + ' ~' + (h.mfds.valid_to || '') : '기록 없음') + (h.note ? '<br><small class="muted">' + esc(h.note) + '</small>' : '')) +
      row('회수·판매중지', rc.error ? '오류: ' + esc(rc.error) : '우리 업소 해당 ' + (rc.rows || []).length + '건' + (rc.scanned ? ' (전국 ' + rc.scanned + '건 중)' : '')) +
      row('출처·시각', esc([c.source, rc.source].filter(Boolean).join(' · ')) + ' · ' + esc(d.at) + (d.cached ? ' · 캐시' : '')) + '</table>';
  }
  screens.dash.bind = function () {
    var b = $('#pub-go'); if (!b) return;
    b.onclick = function () {
      var out = $('#pub-out'); out.innerHTML = '<p class="muted">조회 중… (식약처 서버 응답 3~10초)</p>'; b.disabled = true;
      var get = function (p) { return api('/public/' + p).catch(function (e) { return { error: String(e) }; }); };
      // 식약처 API 는 같은 키의 동시 호출을 거부(INFO-500) → 순차 호출
      get('company').then(function (a) { return get('haccp').then(function (b) { return get('compare').then(function (c) { return get('recalls').then(function (d) { return [a, b, c, d]; }); }); }); }).then(function (r) {
        state.publicData = { company: r[0], haccp: r[1], compare: r[2], recalls: r[3], at: new Date().toISOString().slice(0, 16).replace('T', ' '), cached: !!(r[0] && r[0].cached) };
        save(); out.innerHTML = pubView(state.publicData); b.disabled = false; toast('식약처 조회 완료');
      });
    };
  };

  // ---------- 서류 넣기: 접수부 → 읽기부 → 검증부 → 결재부 ----------
  var intakeCards = [];   // 이번 화면에서 올린 파일들 (새로고침하면 비움)
  function fixtures() { return LC.extractFixtures || []; }
  function matchFixture(name) { return fixtures().filter(function (f) { return f.match && f.match.test ? f.match.test(name) : name.indexOf(f.match) >= 0; })[0] || null; }
  function cell(v) {
    if (Array.isArray(v)) {
      if (!v.length) return '-';
      if (typeof v[0] !== 'object') return esc(v.join(', '));
      var ks = Object.keys(v[0]);
      return '<details><summary>' + v.length + '행</summary><table><tr>' + ks.map(function (k) { return '<th>' + esc(k) + '</th>'; }).join('') + '</tr>' +
        v.map(function (r) { return '<tr>' + ks.map(function (k) { return '<td>' + esc(r[k]) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table></details>';
    }
    if (typeof v === 'string' && v.length > 300) return '<details><summary>' + esc(v.slice(0, 80)) + '… (' + v.length + '자)</summary><pre style="white-space:pre-wrap">' + esc(v) + '</pre></details>';
    if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return esc(k) + ' → ' + (v[k] ? '<b>' + esc(v[k]) + '</b>' : '<span class="muted">(우리 데이터 없음 → 빈칸)</span>'); }).join('<br>');
    return esc(v);
  }
  var DIFF = { ok: ['통과', 'ok'], add: ['추가', 'warn'], check: ['확인', 'warn'], bad: ['불일치', 'bad'] };
  var MODE = { llm: ['추출: AI(Claude)', 'ok'], fixture: ['추출: 미리 읽어 둔 값 · API 키 연결 시 실시간', 'warn'], none: ['종류 미확인 · 수동 입력', 'bad'], manual: ['직접 입력', 'ok'] };
  // 카드 = {name, doc_type, mode, sensitive, blocked, fields, fixture, b64, masked, done, result}. fixture(오프라인)·서버 응답 둘 다 이 모양으로 맞춘다
  function cardFromFixture(f, name) { return { name: name, doc_type: f ? f.doc_type : '', mode: f ? 'fixture' : 'none', sensitive: !!(f && f.sensitive), fields: f ? f.fields : [], fixture: f }; }
  function cardFromServer(name, r, b64) { var f = matchFixture(name); return { name: name, doc_type: r.doc_type || (f && f.doc_type) || '', mode: r.mode || 'none', sensitive: !!(r.blocked || (f && f.sensitive)), blocked: !!r.blocked, fields: r.fields || [], fixture: f, b64: b64 }; }
  function fieldsObj(c) { return typeof LC.fieldsToObj === 'function' ? LC.fieldsToObj(c.fields) : null; }
  function reconcileCard(c) {
    var o = fieldsObj(c);
    if (o && typeof LC.reconcileDoc === 'function') return LC.reconcileDoc(c.doc_type, o, state) || [];
    return c.fixture && c.fixture.reconcile ? c.fixture.reconcile(state) || [] : [];
  }
  function applyCard(c) {
    var o = fieldsObj(c);
    if (o && typeof LC.applyDoc === 'function') return LC.applyDoc(c.doc_type, o, state) || '반영';
    return c.fixture && c.fixture.apply ? c.fixture.apply(state) || '반영' : '반영(apply 없음)';
  }
  // ---------- 직접 입력: 키 없어 못 읽은 서류(손글씨 일지 등)를 사람이 칸에 적는다. 키는 apply.js 가 먹는 obj 키 그대로 ----------
  var F = function (k, label, type) { return { k: k, label: label, type: type || 'text' }; };
  var FORMS = {
    '포장일지': { fields: [F('date', '날짜', 'date')], rows: { k: 'rows', label: '포장 행', cols: [F('buyer', '바이어'), F('product', '품목'), F('ct', 'C/T', 'number'), F('mfg', '제조일', 'date'), F('expiry', '소비기한', 'date'), F('lot_code', '회사 LOT 코드')] } },
    '입고검사서': { fields: [F('species', '원료명'), F('fishing_period', '조업 기간'), F('received', '입고일', 'date'), F('vessel', '선박 (첫 글자 = 가공일지 약어)'), F('landing', '위판장'), F('boxes_in', '입고 상자', 'number'), F('boxes_ok', '판정 상자', 'number'), F('total_kg', '총 kg', 'number'), F('deduct', '공제 상자', 'number'), F('note', '비고')] },
    '가공일지': { fields: [F('date', '날짜', 'date'), F('raw_sources', '원료 약어 (한 글자씩 공백 구분)'), F('products_made', '만든 품목'), F('notes', '메모 (이름 없이)')] },
    '패킹리스트': { fields: [F('invoice_no', '선적번호'), F('date', '날짜', 'date'), F('departure', '출항일', 'date'), F('buyer', '바이어'), F('vessel', '선박'), F('from', '출발항'), F('to', '도착항'), F('total_ct', '합계 C/T', 'number'), F('total_kg', '합계 kg', 'number'), F('hs', 'HS 코드'), F('linked_lot_codes', '연결 로트 코드 (쉼표)')], rows: { k: 'items', label: '품목', cols: [F('desc', '품목'), F('ct', 'C/T', 'number'), F('kg', 'kg', 'number')] } },
    '위생증명서': { fields: [F('issuer', '발급기관'), F('serial', '발행번호'), F('date', '발급일', 'date'), F('applicant', '신청인'), F('commodity', '품명'), F('quantity_ct', '수량 C/T', 'number'), F('quantity_kg', '수량 kg', 'number'), F('form', '양식'), F('shipment_no', '선적번호')] },
    'HACCP인증서': { fields: [F('cert_no', '인증번호'), F('valid_from', '유효 시작', 'date'), F('valid_to', '유효 끝', 'date'), F('category', '식품종별'), F('ccp', 'CCP'), F('issuer', '발급')] },
    '영양성적서': { fields: [F('issuer', '기관'), F('report_no', '성적서 번호'), F('date', '일자', 'date'), F('product', '제품'), F('kcal', '열량 kcal', 'number'), F('protein', '단백질 g', 'number'), F('fat', '지방 g', 'number'), F('carb', '탄수화물 g', 'number'), F('sodium_mg', '나트륨 mg', 'number')] },
    '라벨': { fields: [F('buyer', '바이어'), F('country', '나라 코드 (JP 등)'), F('name', '명칭'), F('ingredients', '원재료명'), F('net', '내용량'), F('expiry', '賞味期限 표기'), F('storage', '보존'), F('origin', '원산국'), F('importer', '수입자'), F('nutrition.kcal', 'kcal', 'number'), F('nutrition.protein', '단백질 g', 'number'), F('nutrition.fat', '지방 g', 'number'), F('nutrition.carb', '탄수화물 g', 'number'), F('nutrition.salt_g', '식염상당량 g', 'number'), F('basis', '근거 (推定値 등)')] }
  };
  var SPLIT_KEYS = { raw_sources: /\s+/, linked_lot_codes: /\s*,\s*/ };   // 문자열 → 배열로 바꿀 칸
  function manualForm(c, i) {
    var t = c.doc_type && FORMS[c.doc_type] ? c.doc_type : '', v = c.manVals || {}, rows = c.manRows || 1;
    var inp = function (f, name) { return '<label>' + esc(f.label) + ' <input type="' + f.type + '" name="' + name + '" data-man-of="' + i + '" value="' + esc(v[name] || '') + '"' + (f.type === 'number' ? ' step="any"' : '') + '></label>'; };
    var h = '<div class="manual" id="man-' + i + '"><p><b>직접 입력</b> <label>종류 <select data-mantype="' + i + '"><option value="">선택</option>' + Object.keys(FORMS).map(function (k) { return '<option' + (k === t ? ' selected' : '') + '>' + k + '</option>'; }).join('') + '</select></label></p>';
    if (!t) return h + '<p class="muted">서류 종류를 고르면 칸이 나온다</p></div>';
    var def = FORMS[t];
    h += '<div class="row">' + def.fields.map(function (f) { return inp(f, f.k); }).join('') + '</div>';
    if (def.rows) {
      h += '<p><b>' + esc(def.rows.label) + '</b></p><table class="kv"><tr>' + def.rows.cols.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '<th></th></tr>';
      for (var r = 0; r < rows; r++) h += '<tr>' + def.rows.cols.map(function (f) { var name = def.rows.k + '.' + r + '.' + f.k; return '<td><input type="' + f.type + '" name="' + name + '" data-man-of="' + i + '" value="' + esc(v[name] || '') + '"' + (f.type === 'number' ? ' step="any"' : '') + ' aria-label="' + esc(f.label) + '"></td>'; }).join('') + '<td><button class="ghost" data-manrow-del="' + i + ':' + r + '" aria-label="행 삭제">−</button></td></tr>';
      h += '</table><button class="ghost" data-manrow-add="' + i + '" aria-label="행 추가">+ 행</button> ';
    }
    return h + '<button data-manapply="' + i + '" aria-label="입력값 적용">적용</button></div>';
  }
  function harvest(i) { var c = intakeCards[i]; c.manVals = c.manVals || {}; document.querySelectorAll('[data-man-of="' + i + '"]').forEach(function (el) { c.manVals[el.name] = el.value; }); }
  function manualApply(i) {
    harvest(i); var c = intakeCards[i], def = FORMS[c.doc_type], v = c.manVals || {}, obj = {}, fields = [];
    var put = function (k, val) { if (val === '' || val == null) return; var ks = k.split('.'); if (ks.length === 2) { obj[ks[0]] = obj[ks[0]] || {}; obj[ks[0]][ks[1]] = val; } else obj[k] = val; };
    def.fields.forEach(function (f) { var val = v[f.k]; if (val == null || val === '') return; if (f.type === 'number') val = parseFloat(val); if (SPLIT_KEYS[f.k]) val = String(val).trim().split(SPLIT_KEYS[f.k]).filter(Boolean); put(f.k, val); });
    if (def.rows) {
      var arr = [];
      for (var r = 0; r < (c.manRows || 1); r++) { var row = {}, any = false; def.rows.cols.forEach(function (f) { var val = v[def.rows.k + '.' + r + '.' + f.k]; if (val == null || val === '') return; row[f.k] = f.type === 'number' ? parseFloat(val) : val; any = true; }); if (any) arr.push(row); }
      obj[def.rows.k] = arr;
    }
    Object.keys(obj).forEach(function (k) { var lab = (def.fields.filter(function (f) { return f.k === k; })[0] || def.rows && def.rows.k === k && def.rows || { label: k }).label; fields.push({ k: k, label: lab, v: obj[k], src: '직접 입력' }); });
    c.fields = fields; c.mode = 'manual'; c.manual = false; c.sensitive = false; c.open = true;
  }
  // 서류 넣기 카드·한 번에 처리 표 공용 바인딩. rerenderFn 은 그 화면의 다시 그리기
  function bindManual(rerenderFn) {
    document.querySelectorAll('[data-man]').forEach(function (el) { el.onclick = function () { var c = intakeCards[+el.dataset.man]; c.manual = !c.manual; c.open = true; rerenderFn(); }; });
    document.querySelectorAll('[data-mantype]').forEach(function (el) { el.onchange = function () { var i = +el.dataset.mantype; harvest(i); intakeCards[i].doc_type = el.value; rerenderFn(); }; });
    document.querySelectorAll('[data-manrow-add]').forEach(function (el) { el.onclick = function () { var i = +el.dataset.manrowAdd; harvest(i); intakeCards[i].manRows = (intakeCards[i].manRows || 1) + 1; rerenderFn(); }; });
    document.querySelectorAll('[data-manrow-del]').forEach(function (el) { el.onclick = function () {
      var x = el.dataset.manrowDel.split(':'), i = +x[0], r = +x[1], c = intakeCards[i]; harvest(i); var def = FORMS[c.doc_type], rows = c.manRows || 1, v = c.manVals;
      for (var q = r; q < rows - 1; q++) def.rows.cols.forEach(function (f) { v[def.rows.k + '.' + q + '.' + f.k] = v[def.rows.k + '.' + (q + 1) + '.' + f.k] || ''; });
      def.rows.cols.forEach(function (f) { delete v[def.rows.k + '.' + (rows - 1) + '.' + f.k]; }); c.manRows = Math.max(1, rows - 1); rerenderFn();
    }; });
    document.querySelectorAll('[data-manapply]').forEach(function (el) { el.onclick = function () { var i = +el.dataset.manapply; if (!intakeCards[i].doc_type) { toast('서류 종류를 먼저 고르세요'); return; } manualApply(i); rerenderFn(); toast('직접 입력 적용 · 검증부 대조 결과를 확인하고 승인'); }; });
  }
  // 승인된 서류에서 바로 나오는 결과물. 서류 종류별로 어디서 무엇을 받는지 한 줄로
  function outputsFor(c, i) {
    if (!c.done || c.done !== '승인') return '';
    var o = fieldsObj(c) || {}, out = [], m = /[_\-\s](LB|WF|SR|LEG|CL)(?=[_\-\s.]|$)/i.exec(c.name), code = m ? m[1].toUpperCase() : null;
    var a = function (href, text, attr) { return '<a class="btn small" href="' + href + '"' + (attr || '') + '>' + text + '</a>'; };
    if (c.doc_type === '규격서양식' && o.buyer) out.push(a('#spec', '이 양식으로 채운 규격서 → PDF', ' data-out-spec="' + i + '"'));
    if (c.doc_type === '메일') { if (o.reply_draft) out.push(a('#', '답장 초안 .txt 받기', ' data-out-reply="' + i + '"')); out.push(a('#spec', '규격서 PDF 첨부용', ' data-out-prod="' + i + '"')); }
    if (c.doc_type === '영양성적서') out.push(a('#product', '품목 영양 환산표(나라별)', ' data-out-prod="' + i + '"'));
    if (c.doc_type === '포장일지') (typeof LC.lotRows === 'function' ? LC.lotRows(o) : []).slice(0, 3).forEach(function (r) {
      out.push(a('#lot/' + encodeURIComponent(r.lot), 'LOT ' + r.lot + ' 조회·클레임 보고서'));
      if (API) out.push(a('/api/shipdocs/buyer?lot=' + encodeURIComponent(r.lot), '바이어 패키지 zip', ' download') + a('/api/lot/' + encodeURIComponent(r.lot) + '/qr.png', 'QR 라벨', ' target="_blank"'));
    });
    if (c.doc_type === '라벨' && o.name) out.push(a('#label', '라벨 판정 → 수정안 만들기', ' data-out-label="' + i + '"'));
    if (c.doc_type === '고시문') out.push(a('#dash', '대시보드: 개정 → 영향 라벨'));
    if (c.doc_type === '패킹리스트' || c.doc_type === '위생증명서') out.push(a('#ship', '선적 카드: 제조일자 리스트·패킹리스트 초안·위생증명서 신청값'));
    if (c.doc_type === '입고검사서' || c.doc_type === '가공일지') out.push(a('#ship', '선적·원장'), a('#stats', '집계'));
    if (/^수입|^BL$|^운송장$/.test(c.doc_type || '')) out.push(a('#import', '수입 체크리스트'));
    if (c.doc_type === 'HACCP인증서') out.push(a('#dash', '만료 대시보드'));
    return out.length ? '<p class="outs"><b>나온 것</b> ' + out.join(' ') + '</p>' : '';
  }
  function bindOutputs(rerenderFn) {
    document.querySelectorAll('[data-out-spec]').forEach(function (el) { el.onclick = function () { var c = intakeCards[+el.dataset.outSpec], o = fieldsObj(c) || {}; state.specBuyer = o.buyer; var m = /[_\-\s](LB|WF|SR|LEG|CL)(?=[_\-\s.]|$)/i.exec(c.name); if (m) setProduct(m[1].toUpperCase()); }; });
    document.querySelectorAll('[data-out-prod]').forEach(function (el) { el.onclick = function () { var c = intakeCards[+el.dataset.outProd], o = fieldsObj(c) || {}; var m = /\b(LB|WF|SR|LEG|CL)\b/i.exec(String(o.product || '') + ' ' + c.name); if (m) setProduct(m[1].toUpperCase()); }; });
    document.querySelectorAll('[data-out-reply]').forEach(function (el) { el.onclick = function (e) { e.preventDefault(); var c = intakeCards[+el.dataset.outReply], o = fieldsObj(c) || {}; download('답장초안_' + c.name.replace(/\.[^.]+$/, '') + '.txt', String(o.reply_draft || '')); }; });
    document.querySelectorAll('[data-out-label]').forEach(function (el) { el.onclick = function () { var c = intakeCards[+el.dataset.outLabel], o = fieldsObj(c) || {}; var cc = String(o.country || '').slice(0, 2).toUpperCase(); if (!LC.rules[cc]) { var nm = { '일본': 'JP', '홍콩': 'HK', '대만': 'TW', '태국': 'TH', '중국': 'CN' }; Object.keys(nm).forEach(function (k) { if (c.name.indexOf(k) >= 0) cc = nm[k]; }); } state.pendingLabel = { file: c.name, country: cc, fields: o }; }; });   // 나라는 읽은 값 → 없으면 파일명(일본·홍콩…)
  }
  function needsManual(c) { return !c.done && !c.loading && (!c.doc_type || c.mode === 'none' || !(c.fields && c.fields.length)) && !(c.doc_type && c.sensitive && !c.masked); }
  function manualButton(c, i) { return needsManual(c) ? ' <button class="ghost" data-man="' + i + '" aria-label="직접 입력 폼 열기">' + (c.manual ? '입력 닫기' : '직접 입력') + '</button>' : ''; }

  // 4단 진행 표시: 접수 → 읽기 → 검증 → 결재. 현재 단계 강조, 완료 .done, 차단 .locked
  function pipeline(c) {
    var locked = c.doc_type && c.sensitive && !c.masked, read = !!(c.fields && c.fields.length) && !locked;
    var st = [['접수부', c.doc_type ? (locked ? 'locked' : 'done') : 'now'], ['읽기부', read ? 'done' : (c.doc_type && !locked ? 'now' : '')], ['검증부', read ? (c.done ? 'done' : 'now') : ''], ['결재부', c.done ? 'done' : (read ? 'now' : '')]];
    return '<div class="pipeline mini" aria-label="진행 단계">' + st.map(function (x) { return '<div class="stage ' + x[1] + '"><h4>' + x[0] + '</h4></div>'; }).join('') + '</div>';
  }
  function intakeCard(c, i) {
    if (c.open === undefined) c.open = true;
    var h = '<div class="card ic' + (c.open ? '' : ' closed') + '" id="ic-' + i + '"><h3 class="ic-title" data-toggle="' + i + '" title="접기/펼치기"><span class="caret">' + (c.open ? '▾' : '▸') + '</span> ' + esc(c.name) + (c.done ? ' <span class="b ' + (c.done === '승인' ? 'ok' : 'bad') + '">' + (c.done === '승인' ? '반영됨' : '반려') + '</span>' : '') + (c.doc_type ? ' <span class="muted">' + esc(c.doc_type) + '</span>' : '') + '</h3>';
    if (!c.open) return h + outputsFor(c, i) + '</div>';
    h += pipeline(c);
    if (c.loading) return h + '<p><b>접수부</b> 종류: ' + (c.doc_type ? esc(c.doc_type) : '<span class="muted">파일 내용으로 판별 중</span>') + '</p><p><b>읽기부</b> <span class="b warn">AI가 읽는 중… 10~40초</span> <span class="muted">끝나면 값과 대조 결과가 여기 나오고 승인할 수 있어요</span></p></div>';
    h += '<p><b>접수부</b> 종류: ' + (c.doc_type ? esc(c.doc_type) : '종류 미확인 · 추출 불가(키 없음) · 수동 입력') + '</p>';
    if (c.doc_type && c.sensitive && !c.masked) return h + '<p class="alert">접수부 차단: 계좌·단가가 있을 수 있는 서류는 가린 뒤 처리. LLM에 보내지 않음</p><label class="chk"><input type="checkbox" data-mask="' + i + '"> 계좌·단가 가렸음</label></div>';
    if (needsManual(c)) return h + '<p>' + manualButton(c, i) + '</p>' + (c.manual ? manualForm(c, i) : '') + '</div>';
    var m = MODE[c.mode] || MODE.none;
    h += '<p><b>읽기부</b> <span class="b ' + m[1] + '">' + m[0] + '</span>' + (c.loading ? ' <span class="muted">읽는 중…</span>' : '') + '</p><table><tr><th>라벨</th><th>값</th><th>읽은 위치</th></tr>' +
      (c.fields || []).map(function (x) { return '<tr><td>' + esc(x.label || x.k) + '</td><td>' + cell(x.value !== undefined ? x.value : x.v) + '</td><td class="muted">' + esc(x.src) + '</td></tr>'; }).join('') + '</table>';
    var diffs = []; try { diffs = reconcileCard(c); } catch (e) { diffs = [{ item: '대조 오류', status: 'bad', note: String(e) }]; }
    h += '<p><b>검증부</b></p>' + (diffs.length ? '<table><tr><th>항목</th><th>상태</th><th>비고</th></tr>' + diffs.map(function (d) { var s = DIFF[d.status] || [d.status, '']; return '<tr class="st-' + esc(d.status) + '"><td>' + esc(d.item) + '</td><td><span class="b ' + s[1] + '">' + s[0] + '</span></td><td class="muted">' + esc(d.note) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">대조할 항목 없음</p>');
    h += '<p><b>결재부</b> ' + (c.done ? esc(c.result || '') : '<button data-ok="' + i + '" aria-label="승인하여 원장에 반영">승인</button> <button class="ghost" data-no="' + i + '" aria-label="반려">반려</button>') + '</p></div>';
    return h;
  }
  // 서버에 추출 요청. b64 없으면 fixture 모드 결과를 받는다. 응답이 오면 카드를 갱신
  function extractOnServer(c) {
    c.loading = true;
    return api('/extract', 'POST', { filename: c.name, b64: c.b64, masked: !!c.masked }).then(function (r) {
      var n = cardFromServer(c.name, r, c.b64); n.masked = c.masked; var i = intakeCards.indexOf(c); if (i >= 0) intakeCards[i] = n;
    }).catch(function () { c.loading = false; c.mode = c.fixture ? 'fixture' : 'none'; c.fields = c.fixture ? c.fixture.fields : []; }).then(rerender);
  }
  function rerender() { if ($('#in-cards')) renderIntake(); else if ($('#qk-table')) renderQuick(); 
  }
  function addFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var b64 = String(fr.result).split(',')[1] || '';
      var c = API ? { name: file.name, doc_type: (matchFixture(file.name) || {}).doc_type || '', mode: 'fixture', fields: [], fixture: matchFixture(file.name), b64: b64, loading: true } : cardFromFixture(matchFixture(file.name), file.name);
      intakeCards.push(c); rerender();
      if (API) extractOnServer(c);
    };
    fr.readAsDataURL(file);
  }
  // fixture 를 큐에 넣는다 (서류 넣기·한 번에 처리 공용)
  function queueFixture(f) { var c = cardFromFixture(f, f.source); intakeCards.push(c); if (API) extractOnServer(c); return c; }
  function intakeSummary() { return '로트 ' + state.ledger.length + '건 · 입고 ' + state.raw.length + '건 · 선적 ' + state.shipments.length + '건 · 영양 출처 ' + state.nutritionSources.length + '건'; }
  // 받은 파일 묶음: 4월 수출(실제) / 6월 가상 / 수입. fixture id 로 나눈다
  var FX_GROUPS = [['4월 수출', function (f) { return !/^imp-/.test(f.id) && !/b$/.test(f.id); }, true], ['6월 선적', function (f) { return /b$/.test(f.id); }, false], ['수입', function (f) { return /^imp-/.test(f.id); }, false]];
  // 서류함: 받은 파일을 표로. 상태는 이번에 연 카드와 처리 기록(state.docs)으로
  function docName(f) { return String(f.source || '').replace(/\s*·\s*시연용 가상/, '').replace(/\s*\(시연[^)]*\)/, ''); }
  function docDate(f) { var m = /(\d{4}-\d{2}-\d{2})/.exec(String(f.source || '')); if (m) return m[1]; var x = (f.fields || []).filter(function (x) { return /^(date|received|issued|valid_from|date_embark|shipped)$/.test(x.k) && /^\d{4}-\d{2}-\d{2}/.test(String(x.v)); })[0]; return x ? String(x.v).slice(0, 10) : ''; }
  function docStatus(f) {
    var card = intakeCards.filter(function (c) { return c.fixture === f; }).pop();
    if (card && card.done) return [card.done, card.done === '승인' ? 'ok' : 'bad'];
    if (card) return ['열림', 'warn'];
    var d = state.docs.filter(function (d) { return d.file === f.source; }).pop();
    if (d) return [/^반려/.test(String(d.result)) ? '반려' : '승인', /^반려/.test(String(d.result)) ? 'bad' : 'ok'];
    return ['대기', ''];
  }
  function docBox() {
    var fx = fixtures(); if (!fx.length) return '<p class="muted">서류함 비어 있음</p>';
    var grp = function (f) { for (var i = 0; i < FX_GROUPS.length; i++) if (FX_GROUPS[i][1](f)) return FX_GROUPS[i][0]; return ''; };
    return '<table class="docbox"><tr><th>서류</th><th>종류</th><th>날짜</th><th>묶음</th><th>상태</th><th></th></tr>' + fx.map(function (f, i) {
      var st = docStatus(f), open = st[0] === '열림';
      return '<tr><td>' + esc(docName(f)) + '</td><td>' + esc(f.doc_type) + '</td><td>' + esc(docDate(f)) + '</td><td class="muted">' + esc(grp(f)) + '</td><td>' + (st[1] ? '<span class="b ' + st[1] + '">' + st[0] + '</span>' : '<span class="muted">' + st[0] + '</span>') + '</td><td><button class="ghost small" data-fxopen="' + i + '"' + (open ? ' disabled' : '') + ' aria-label="' + esc(docName(f)) + ' 열기">열기</button></td></tr>';
    }).join('') + '</table>';
  }
  function bindDocBox(rerenderFn) { document.querySelectorAll('[data-fxopen]').forEach(function (el) { el.onclick = function () { queueFixture(fixtures()[+el.dataset.fxopen]); rerenderFn(); }; }); }
  screens.intake = function () {
    return '<h2>서류 넣기</h2><p class="sub">파일을 올리고 승인하세요.</p>' +
      '<div class="card"><div id="in-guide">' + docGuide() + '</div>' + dropZone('in') + '<p class="summary-bar" id="in-sum">' + intakeSummary() + '</p></div>' +
      '<div class="card"><h3>서류함</h3><div id="in-docbox">' + docBox() + '</div></div>' +
      '<div id="in-cards"></div><h3>처리 기록</h3><div id="in-docs"></div>' +
      '<div class="row"><button class="ghost small" id="in-empty" aria-label="원장을 비움">빈 원장</button><button class="ghost small" id="in-seed" aria-label="예시 데이터로 되돌리기">예시 데이터로 되돌리기</button></div>';
  };
  function renderIntake() {
    $('#in-cards').innerHTML = intakeCards.map(intakeCard).join('');
    $('#in-sum').textContent = intakeSummary();
    if ($('#in-guide')) $('#in-guide').innerHTML = docGuide();
    if ($('#in-docbox')) { $('#in-docbox').innerHTML = docBox(); bindDocBox(renderIntake); }
    var docs = state.docs.slice().reverse();
    $('#in-docs').innerHTML = docs.length ? '<table><tr><th>일자</th><th>파일</th><th>종류</th><th>결과</th></tr>' + docs.map(function (d) { return '<tr><td>' + esc(d.at) + '</td><td>' + esc(d.file) + '</td><td>' + esc(d.doc_type) + '</td><td>' + esc(d.result) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">없음</p>';
    document.querySelectorAll('[data-mask]').forEach(function (el) { el.onchange = function () { var c = intakeCards[+el.dataset.mask]; c.masked = el.checked; if (API && c.blocked && el.checked) extractOnServer(c); else renderIntake(); }; });
    document.querySelectorAll('[data-ok]').forEach(function (el) { el.onclick = function () { decide(+el.dataset.ok, true); }; });
    document.querySelectorAll('[data-no]').forEach(function (el) { el.onclick = function () { decide(+el.dataset.no, false); }; });
    document.querySelectorAll('[data-toggle]').forEach(function (el) { el.onclick = function () { var c = intakeCards[+el.dataset.toggle]; c.open = !c.open; renderIntake(); }; });
    bindManual(renderIntake); bindOutputs(renderIntake);
  }
  // 어떤 서류를 올리면 무엇이 나오는지. 올린 것은 ✓ (승인된 처리 기록 + 지금 올린 카드 기준)
  var DOC_GUIDE = [
    ['라벨 (기본)', ['라벨'], '라벨 사진 또는 문안', '나라별 규정 판정서 · 개정 영향'],
    ['생산 기록', ['입고검사서', '가공일지', '포장일지'], '원료입고검사서 · 가공일지 · 포장일지', '로트 원장 · 원료 역추적 · 클레임 보고서'],
    ['수출 서류', ['패킹리스트', '위생증명서'], '패킹리스트(계좌·단가는 자동으로 가림) · 위생증명서', '선적 ↔ 로트 연결 · 선적 서류 초안 5종'],
    ['인증·성적', ['HACCP인증서', '영양성적서'], 'HACCP 인증서 · 영양성분 성적서', '만료 알림 · 영양표시 값과 출처'],
    ['바이어·정부가 보낸 것', ['규격서양식', '고시문'], '바이어 규격서 양식(아무 양식) · 개정 고시문', '그 양식대로 채운 규격서 · 바뀐 조항과 영향 라벨'],
    ['수입 (선택)', ['수입인보이스', 'BL', '수입신고서', '운송장'], '인보이스 · 선하증권 · 수입신고서 · 운송장', '수입 서류 체크리스트']
  ];
  function docGuide() {
    var have = {};
    state.docs.forEach(function (d) { if (!/^반려/.test(String(d.result))) have[d.doc_type] = (have[d.doc_type] || 0) + 1; });
    intakeCards.forEach(function (c) { if (c.doc_type && !c.done) have[c.doc_type] = (have[c.doc_type] || 0) + 1; });
    var rows = DOC_GUIDE.map(function (g) {
      var got = g[1].filter(function (t) { return have[t]; }), all = got.length === g[1].length, cls = all ? 'ok' : got.length ? 'warn' : '';
      return '<tr><td>' + (all ? '<span class="b ok">✓</span>' : got.length ? '<span class="b warn">' + got.length + '/' + g[1].length + '</span>' : '<span class="muted">—</span>') + '</td><th>' + g[0] + '</th><td>' + g[2] + '</td><td class="muted">' + g[3] + '</td></tr>';
    }).join('');
    return '<details class="guide" open><summary>어떤 서류를 올리나 <span class="muted">(올린 것은 ✓ · 사진·PDF·엑셀 그대로, 이름은 아무거나)</span></summary><table><tr><th></th><th>묶음</th><th>올릴 것</th><th>나오는 것</th></tr>' + rows + '</table></details>';
  }
  // 드롭 영역 + 파일 선택. prefix 로 id 를 나눈다(서류 넣기: in, 한 번에: qk)
  function dropZone(prefix) { return '<div class="drop" id="' + prefix + '-drop"><b>여기에 사진·PDF 놓기</b><span class="muted">또는 파일 선택 · 여러 개 가능</span><label>사진·PDF 올리기 <input type="file" id="' + prefix + '-file" multiple aria-label="서류 파일 선택"></label></div>'; }
  function bindDrop(prefix, onFiles) {
    var dz = $('#' + prefix + '-drop'); if (!dz) return;
    $('#' + prefix + '-file').onchange = function (e) { onFiles(e.target.files); };
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = function () { dz.classList.remove('over'); };
    dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); onFiles(e.dataTransfer.files); };
  }
  function decide(i, ok) {
    var c = intakeCards[i]; var result = '반려';
    if (ok) { try { result = applyCard(c); } catch (e) { result = '반영 실패: ' + e; } }
    c.done = ok ? '승인' : '반려'; c.result = result; c.open = false;   // 반영된 카드는 접는다
    state.docs.push({ file: c.name, doc_type: c.doc_type, at: LC.TODAY, result: result }); save(); renderIntake();
    toast(ok ? '승인 · ' + result + ' → ' + intakeSummary() : '반려 · ' + c.name);
    if (API) api('/docs', 'POST', { file: c.name, doc_type: c.doc_type, mode: c.mode, decision: c.done, result: result, fields: c.fields }).catch(function () {});
  }
  screens.intake.bind = function () {
    bindDrop('in', function (files) { Array.prototype.forEach.call(files, addFile); });
    $('#in-empty').onclick = function () { state.ledger = []; state.raw = []; state.shipments = []; state.nutritionSources = []; state.docs = []; state.specForms = {}; state.importShipments = []; state.processLog = {}; state.importWaybills = []; intakeCards = []; save(); renderIntake(); };
    $('#in-seed').onclick = function () { resetAll(); intakeCards = []; renderIntake(); };
    renderIntake();
  };

  // ---------- 한 번에 처리: 서류 넣기 → 확인(한 표) → 결과물 ----------
  function cardStatus(c) {
    if (c.done) return c.done === '승인' ? ['반영됨', 'ok'] : ['반려', 'bad'];
    if (c.loading) return ['AI 읽는 중…', 'warn'];
    if (!c.doc_type || c.mode === 'none') return [c.doc_type ? '직접 입력 필요' : '종류 미확인', 'bad'];
    if (c.sensitive && !c.masked) return ['가림 확인 필요', 'warn'];
    if (c.loading) return ['읽는 중', 'warn'];
    return ['승인 대기', 'warn'];
  }
  function cardDiffs(c) { if (c.done || !c.doc_type || c.mode === 'none' || (c.sensitive && !c.masked)) return []; try { return reconcileCard(c); } catch (e) { return [{ item: '대조 오류', status: 'bad', note: String(e) }]; } }
  function quickRow(c, i) {
    var st = cardStatus(c), diffs = c.loading ? [] : cardDiffs(c), bad = diffs.filter(function (d) { return d.status === 'check' || d.status === 'bad'; });
    var cnt = { ok: 0, add: 0, check: 0, bad: 0 }; diffs.forEach(function (d) { cnt[d.status] = (cnt[d.status] || 0) + 1; });
    var summary = diffs.length ? '통과 ' + cnt.ok + (cnt.add ? ' · 추가 ' + cnt.add : '') + (cnt.check ? ' · <b>확인 ' + cnt.check + '</b>' : '') + (cnt.bad ? ' · <b>불일치 ' + cnt.bad + '</b>' : '') : '-';
    var mask = c.doc_type && c.sensitive && !c.masked && !c.done ? '<label class="chk"><input type="checkbox" data-qmask="' + i + '"> 계좌·단가 가렸음</label>' : '';
    var h = '<tr class="' + (bad.length ? 'st-check' : '') + '"><td>' + esc(c.name) + (mask ? '<br>' + mask : '') + '</td><td>' + (c.doc_type ? esc(c.doc_type) : '<span class="muted">미확인</span>') + '</td><td class="num">' + ((c.fields || []).length || '-') + '</td><td>' + summary + '</td><td><span class="b ' + st[1] + '">' + st[0] + '</span>' + (c.done ? '' : ' <button class="ghost small" data-qdetail="' + i + '" aria-label="값 전체 보기">자세히</button>') + '</td></tr>';
    if (bad.length && !c.done) h += '<tr class="qk-sub"><td colspan="5"><b>확인할 것</b><ul class="log">' + bad.map(function (d) { return '<li><span class="b ' + (DIFF[d.status] || ['', ''])[1] + '">' + (DIFF[d.status] || [d.status])[0] + '</span> ' + esc(d.item) + ' <span class="muted">' + esc(d.note) + '</span></li>'; }).join('') + '</ul></td></tr>';
    if (needsManual(c)) h += '<tr class="qk-sub"><td colspan="5">' + manualButton(c, i) + (c.manual ? manualForm(c, i) : '') + '</td></tr>';
    var outs = outputsFor(c, i); if (outs) h += '<tr class="qk-sub"><td colspan="5">' + outs + '</td></tr>';
    if (c.detail) h += '<tr class="qk-sub"><td colspan="5"><table class="kv"><tr><th>라벨</th><th>값</th><th>읽은 위치</th></tr>' + (c.fields || []).map(function (x) { return '<tr><td>' + esc(x.label || x.k) + '</td><td>' + cell(x.value !== undefined ? x.value : x.v) + '</td><td class="muted">' + esc(x.src) + '</td></tr>'; }).join('') + '</table></td></tr>';
    return h;
  }
  function approveAll() {
    var skipped = 0, done = 0;
    intakeCards.forEach(function (c, i) {
      if (c.done) return;
      if (c.loading || !c.doc_type || c.mode === 'none' || (c.sensitive && !c.masked)) { skipped++; return; }
      var result; try { result = applyCard(c); } catch (e) { result = '반영 실패: ' + e; }
      c.done = '승인'; c.result = result; c.open = false; done++;
      state.docs.push({ file: c.name, doc_type: c.doc_type, at: LC.TODAY, result: result });
      if (API) api('/docs', 'POST', { file: c.name, doc_type: c.doc_type, mode: c.mode, decision: '승인', result: result, fields: c.fields }).catch(function () {});
    });
    save(); renderQuick();
    toast('승인 ' + done + '건 반영' + (skipped ? ' · 건너뜀 ' + skipped + '건(가림 미확인·종류 미확인)' : '') + ' → ' + intakeSummary());
  }
  function resultCards() {
    if (!state.ledger.length) return '';
    var ymd = LC.TODAY.replace(/-/g, '');
    var card = function (href, title, body) { return '<div class="card result"><h3>' + title + (href ? ' <a class="more" href="' + href + '">자세히 ›</a>' : '') + '</h3>' + body + '</div>'; };
    var lots = state.ledger.slice(-5).reverse();
    var ledger = card('#ship', '로트 원장 · ' + state.ledger.length + '건',
      '<table><tr><th>LOT</th><th>코드</th><th>제조일</th><th class="num">C/T</th><th>선적</th></tr>' + lots.map(function (l) { return '<tr><td><a href="#lot/' + l.lot + '">' + l.lot + '</a></td><td>' + esc(l.company_code || '') + '</td><td>' + l.mfg + '</td><td class="num">' + l.qty_ct + '</td><td>' + esc((l.ship || '미선적').split(' / ')[0]) + '</td></tr>'; }).join('') + '</table>' +
      (state.ledger.length > 5 ? '<p class="muted">최근 5건만 미리보기</p>' : '') + '<button data-csv1="0" aria-label="로트 원장 CSV 받기">CSV 받기</button>');
    var combos = [];
    state.shipments.forEach(function (sh) {
      if (typeof LC.reconcileDoc !== 'function') return;
      try { LC.reconcileDoc('패킹리스트', { invoice_no: sh.no, date: sh.date, departure: sh.etd, buyer: sh.buyer, vessel: sh.vessel, items: sh.items || [], total_ct: sh.total_ct, total_kg: sh.total_kg }, state).forEach(function (d) { if (/조합/.test(d.note || '')) combos.push(sh.no + ': ' + d.note); }); } catch (e) {}
    });
    var link = card('#ship', '원료 · 선적 연결', '<p>선적 <b>' + state.shipments.length + '</b>건 · 입고분 <b>' + state.raw.length + '</b>건 (실측 ' + state.raw.filter(function (r) { return r.kg; }).length + ')</p>' + (combos.length ? '<ul class="log">' + combos.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<p class="muted">선적 구성 제안 없음</p>'));
    var spec = card('#spec', '규격서', '<div class="row">' + productSelect('qk-prod') + formSelect('qk-form') + '<button id="qk-spec" aria-label="규격서 열어서 인쇄">열어서 인쇄</button></div><p class="muted">' + (Object.keys(state.specForms || {}).length ? '바이어 양식 ' + Object.keys(state.specForms).join(', ') + ' 사용 가능' : '바이어 규격서 양식을 넣으면 그 양식으로도 나옴') + '</p>');
    var claim = card('#lot', '클레임 조회', '<div class="row"><input id="qk-lot" list="lot-list" placeholder="LOT 또는 회사 코드(AJ)" size="22" aria-label="클레임 LOT"><button id="qk-claim" aria-label="회사 면으로 조회">회사 면 열기</button></div>' + lotDatalist() + '<p class="muted">회사 면에서 대응 보고서까지.</p>');
    var cnt = dashCounts();
    var dash = card('#dash', '만료 D-day', '<p><span class="b bad">30일 이내 ' + cnt.bad + '</span><span class="b warn">90일 이내 ' + cnt.warn + '</span><span class="b ok">여유 ' + cnt.ok + '</span></p>');
    var imp = '';
    if ((state.importShipments || []).length) {
      imp = card('#import', '수입 체크', (state.importShipments || []).map(function (x) { var d = (x.checklist || []).filter(function (c) { return c.count_expected; })[0]; var open = (x.checklist || []).filter(function (c) { return c.status !== '있음'; }).length; return '<p><b>' + esc(x.no) + '</b> · 신고서 ' + (d ? (d.count_have || 0) + '/' + d.count_expected + '장' : '-') + ' · 미완 ' + open + '건</p>'; }).join(''));
    }
    var pub = '';
    if (API) { var sl = state.ledger.filter(shipped); pub = card(null, '바이어 공개 링크', sl.length ? '<ul class="log">' + sl.map(function (l) { var u = location.origin + '/lot/' + encodeURIComponent(l.lot); return '<li><a href="' + esc(u) + '" target="_blank">' + esc(u) + '</a></li>'; }).join('') + '</ul>' : '<p class="muted">선적된 로트가 생기면 링크가 나옴</p>'); }
    var sd = '';
    if (state.shipments.length) { var last = state.shipments[state.shipments.length - 1]; sd = card('#ship', '선적 서류 · ' + esc(last.no), shipDocLinks(last.no) + (API && state.ledger.filter(shipped).length ? '<p><a href="/api/shipdocs/buyer?lot=' + encodeURIComponent(state.ledger.filter(shipped)[0].lot) + '" download>바이어 패키지 zip (' + esc(state.ledger.filter(shipped)[0].lot) + ')</a></p>' : '')); }
    var ntf = API ? '<details id="qk-notify"><summary class="muted">알림 미리보기 (만료·수입 미완, 매일 08:00 메일용)</summary><pre id="qk-notify-txt" class="muted">불러오는 중…</pre></details>' : '';
    var all = card('#export', '전체 CSV 묶음', '<button id="qk-all" aria-label="CSV 7개 전부 받기">CSV ' + EXPORTS.length + '개 전부 받기</button><p class="muted">로트원장·입고분·선적·만료·영양출처·수입체크·처리기록 (파일명 라벨코스트_표_' + ymd + ')</p>');
    return '<h3 class="step">3. 결과물</h3><div class="grid4">' + ledger + link + spec + claim + dash + imp + sd + pub + all + '</div>' + ntf;
  }
  screens.quick = function () {
    var fx = fixtures();
    var g = function (i) { return fx.filter(FX_GROUPS[i][1]).length; };
    return '<h2>한 번에 처리</h2><p class="sub">서류를 넣고, 확인하고, 승인하세요.</p>' +
      '<h3 class="step">1. 서류 넣기</h3><div class="card"><div id="qk-guide">' + docGuide() + '</div>' + dropZone('qk') +
      (fx.length ? '<div class="row"><button id="qk-all9" aria-label="서류함의 4월 수출 서류 전부 열기">서류함 전부 열기 (4월 ' + g(0) + '건)</button><a href="#" id="qk-jun" class="muted">+ 6월 ' + g(1) + '건</a><a href="#" id="qk-imp" class="muted">+ 수입 ' + g(2) + '건</a><button class="ghost small" id="qk-empty" aria-label="원장 비우기">빈 원장으로 시작</button></div>' +
      '<details class="docbox-wrap"><summary>서류함 (' + fx.length + ')</summary><div id="qk-docbox">' + docBox() + '</div></details>' : '') + '</div>' +
      '<h3 class="step">2. 확인</h3><div class="card" id="qk-table"></div>' +
      '<div id="qk-results">' + resultCards() + '</div>';
  };
  function renderQuick() {
    var box = $('#qk-table'); if (!box) return;
    if (!intakeCards.length) { box.innerHTML = '<p class="muted">넣은 서류가 없습니다. 위에서 파일을 올리거나 "받은 파일 전부 넣기"를 누르세요.</p>'; }
    else {
      var wait = intakeCards.filter(function (c) { return !c.done && !c.loading; }).length, loading = intakeCards.filter(function (c) { return c.loading; }).length;
      box.innerHTML = '<table><tr><th>파일</th><th>종류</th><th class="num">읽은 칸</th><th>대조</th><th>상태</th></tr>' + intakeCards.map(quickRow).join('') + '</table>' +
        '<div class="row"><button id="qk-approve" ' + (wait ? '' : 'disabled') + ' aria-label="대기 중인 서류 전부 승인">전부 승인 (' + wait + '건)</button>' + (loading ? '<span class="b warn">AI 읽는 중 ' + loading + '건 · 끝나면 표가 바뀝니다</span>' : '') + '<a class="btn ghost" href="#intake">하나씩 보기</a><span class="summary-bar">' + intakeSummary() + '</span></div>';
      $('#qk-approve').onclick = approveAll;
      document.querySelectorAll('[data-qmask]').forEach(function (el) { el.onchange = function () { var c = intakeCards[+el.dataset.qmask]; c.masked = el.checked; if (API && c.blocked && el.checked) extractOnServer(c); else renderQuick(); }; });
      document.querySelectorAll('[data-qdetail]').forEach(function (el) { el.onclick = function () { var c = intakeCards[+el.dataset.qdetail]; c.detail = !c.detail; renderQuick(); }; });
      bindManual(renderQuick); bindOutputs(renderQuick);
    }
    if ($('#qk-docbox')) { $('#qk-docbox').innerHTML = docBox(); bindDocBox(renderQuick); }
    if ($('#qk-guide')) $('#qk-guide').innerHTML = docGuide();
    $('#qk-results').innerHTML = resultCards(); bindResults();
  }
  function bindResults() {
    var b = $('#qk-spec'); if (b) b.onclick = function () { if ($('#qk-prod')) setProduct($('#qk-prod').value); if ($('#qk-form')) state.specBuyer = $('#qk-form').value; location.hash = '#spec'; setTimeout(function () { window.print(); }, 400); };
    var c = $('#qk-claim'); if (c) c.onclick = function () { var q = $('#qk-lot').value.trim(); if (q) { lotInside = true; location.hash = '#lot/' + encodeURIComponent(q); } };
    var k = $('#qk-lot'); if (k) k.onkeydown = function (e) { if (e.key === 'Enter') $('#qk-claim').click(); };
    document.querySelectorAll('[data-csv1]').forEach(function (el) { el.onclick = function () { var e = EXPORTS[+el.dataset.csv1]; var rc = e[1](); download('라벨코스트_' + e[0] + '_' + LC.TODAY.replace(/-/g, '') + '.csv', csvText(rc[0], rc[1])); }; });
    var nt = $('#qk-notify'); if (nt) nt.ontoggle = function () { if (nt.open && !nt.dataset.done) { nt.dataset.done = '1'; api('/notify/preview', 'GET').then(function (r) { $('#qk-notify-txt').textContent = r.text || JSON.stringify(r); }).catch(function (e) { $('#qk-notify-txt').textContent = '불러오기 실패: ' + e; }); } };
    var a = $('#qk-all'); if (a) a.onclick = function () { EXPORTS.forEach(function (e, i) { setTimeout(function () { var rc = e[1](); download('라벨코스트_' + e[0] + '_' + LC.TODAY.replace(/-/g, '') + '.csv', csvText(rc[0], rc[1])); }, i * 400); }); toast('CSV ' + EXPORTS.length + '개 내려받는 중'); };
  }
  screens.quick.bind = function () {
    bindDrop('qk', function (files) { Array.prototype.forEach.call(files, addFile); });
    var addGroup = function (gi) { fixtures().forEach(function (f) { if (FX_GROUPS[gi][1](f) && !intakeCards.some(function (c) { return c.fixture === f; })) queueFixture(f); }); renderQuick(); };
    if ($('#qk-all9')) $('#qk-all9').onclick = function () { addGroup(0); };
    if ($('#qk-jun')) $('#qk-jun').onclick = function (e) { e.preventDefault(); addGroup(1); };
    if ($('#qk-imp')) $('#qk-imp').onclick = function (e) { e.preventDefault(); addGroup(2); };
    if ($('#qk-empty')) $('#qk-empty').onclick = function () { state.ledger = []; state.raw = []; state.shipments = []; state.nutritionSources = []; state.docs = []; state.specForms = {}; state.importShipments = []; state.processLog = {}; state.importWaybills = []; intakeCards = []; save(); renderQuick(); toast('빈 원장'); };
    renderQuick();
  };

  // ---------- 집계: 본문 계산은 stats.js ----------
  var STAT_CSV = {};   // 섹션 이름 → CSV 문자열 (렌더 때 채움)
  screens.stats = function () {
    if (typeof LC.stats !== 'function') return '<h2>집계</h2><p class="muted">stats.js 없음</p>';
    if (!state.ledger.length) return '<h2>집계</h2>' + emptyLedger();
    var st = LC.stats(state), fmt = function (v) { return v == null ? '-' : (typeof v === 'number' ? v.toLocaleString() : esc(v)); };
    var cardOf = function (key, title, body, csv) { STAT_CSV[key] = csv; return '<div class="card"><h3>' + title + ' <button class="ghost" data-stcsv="' + key + '" aria-label="' + title + ' CSV">CSV</button></h3>' + body + '</div>'; };
    var months = Object.keys(st.monthly), codes = function (pre) { var c = []; months.forEach(function (m) { Object.keys(st.monthly[m]).forEach(function (k) { if (k.indexOf(pre) === 0 && c.indexOf(k.slice(pre.length)) < 0) c.push(k.slice(pre.length)); }); }); return c; };
    var pc = codes('prod_ct_'), sc = codes('ship_ct_');
    var monthly = '<table><tr><th>월</th><th class="num">입고 kg</th>' + pc.map(function (c) { return '<th class="num">생산 ' + c + ' C/T</th>'; }).join('') + sc.map(function (c) { return '<th class="num">선적 ' + c + ' C/T</th>'; }).join('') + '</tr>' +
      months.map(function (m) { var r = st.monthly[m]; return '<tr><td>' + m + '</td><td class="num">' + fmt(r.raw_kg || 0) + '</td>' + pc.map(function (c) { return '<td class="num">' + fmt(r['prod_ct_' + c] || 0) + '</td>'; }).join('') + sc.map(function (c) { return '<td class="num">' + fmt(r['ship_ct_' + c] || 0) + '</td>'; }).join('') + '</tr>'; }).join('') + '</table>';
    var inv = '<table><tr><th>품목</th><th class="num">생산 C/T</th><th class="num">선적 C/T</th><th class="num">재고 C/T</th><th>비고</th></tr>' + Object.keys(st.inventory).map(function (k) { var x = st.inventory[k]; return '<tr><td>' + k + '</td><td class="num">' + fmt(x.prod_ct) + '</td><td class="num">' + fmt(x.ship_items_ct) + '</td><td class="num"><b>' + fmt(x.stock_ct) + '</b></td><td class="muted">' + esc(x.note || '') + '</td></tr>'; }).join('') + '</table>';
    var yld = '<table><tr><th>입고분</th><th>선박</th><th>입고일</th><th class="num">입고 kg</th><th class="num">제품 kg</th><th class="num">수율</th></tr>' + st.yield.rows.map(function (y) { return '<tr><td>' + y.id + '</td><td>' + esc(y.vessel) + '</td><td>' + y.received + '</td><td class="num">' + fmt(y.in_kg) + '</td><td class="num">' + fmt(y.out_kg) + '</td><td class="num">' + fmt(y.yield_pct) + '%</td></tr>'; }).join('') + '</table><p class="muted">' + esc(st.yield.note) + '</p>';
    var buyers = '<table><tr><th>바이어</th><th class="num">선적</th><th class="num">C/T</th><th class="num">kg</th><th>마지막</th><th class="num">평균 간격(일)</th></tr>' + st.buyers.map(function (b) { return '<tr><td>' + esc(b.buyer) + '</td><td class="num">' + b.shipments + '</td><td class="num">' + fmt(b.ct) + '</td><td class="num">' + fmt(b.kg) + '</td><td>' + fmt(b.last) + '</td><td class="num">' + fmt(b.avg_gap_days) + '</td></tr>'; }).join('') + '</table>';
    var lt = st.lead_times, lead = '<table><tr><th></th><th class="num">평균(일)</th><th class="num">최대(일)</th></tr><tr><td>입고 → 제조</td><td class="num">' + fmt(lt.raw_to_mfg.avg) + '</td><td class="num">' + fmt(lt.raw_to_mfg.max) + '</td></tr><tr><td>제조 → 선적</td><td class="num">' + fmt(lt.mfg_to_ship.avg) + '</td><td class="num">' + fmt(lt.mfg_to_ship.max) + '</td></tr></table>';
    var dc = st.docs, docs = '<table><tr><th>서류 종류</th><th class="num">건수</th></tr>' + Object.keys(dc.by_type || {}).map(function (k) { return '<tr><td>' + esc(k) + '</td><td class="num">' + dc.by_type[k] + '</td></tr>'; }).join('') + '</table><p class="muted">반려 ' + (dc.rejected || 0) + '건 · 마지막 처리 ' + fmt(dc.last) + '</p>';
    return '<h2>집계</h2><p class="sub">원장에서 바로 계산합니다.</p><div class="cols">' +
      cardOf('monthly', '월별 입고·생산·선적', monthly, LC.stats.toCSV(st.monthly)) + cardOf('inventory', '재고 (생산 − 선적)', inv, LC.stats.toCSV(st.inventory)) +
      cardOf('yield', '입고분별 수율', yld, LC.stats.toCSV(st.yield.rows)) + cardOf('buyers', '바이어별 선적', buyers, LC.stats.toCSV(st.buyers)) +
      cardOf('lead', '리드타임', lead, LC.stats.toCSV(lt.lots)) + cardOf('docs', '처리 기록', docs, LC.stats.toCSV(Object.keys(dc.by_type || {}).map(function (k) { return { doc_type: k, count: dc.by_type[k] }; }))) + '</div>' +
      '<div class="card"><h3>기록 묶음 PDF (HACCP 심사·바이어 실사용)</h3>' + (API ? '<div class="row"><label>부터 <input type="date" id="bd-from" value="' + (months[0] ? months[0] + '-01' : LC.TODAY) + '"></label><label>까지 <input type="date" id="bd-to" value="' + LC.TODAY + '"></label><button id="bd-go" aria-label="기록 묶음 PDF 받기">PDF 받기</button></div><p class="muted">기간 안의 입고·로트(원료 연결 근거)·선적·등록인증·처리 기록을 한 PDF로</p>' : '<p class="muted">서버 모드에서 가능</p>') + '</div>';
  };
  screens.stats.bind = function () {
    var g = $('#bd-go'); if (g) g.onclick = function () { window.open('/api/shipdocs/bundle?from=' + $('#bd-from').value + '&to=' + $('#bd-to').value, '_blank'); };
    document.querySelectorAll('[data-stcsv]').forEach(function (b) { b.onclick = function () { download('라벨코스트_집계_' + b.dataset.stcsv + '_' + LC.TODAY.replace(/-/g, '') + '.csv', '\ufeff' + STAT_CSV[b.dataset.stcsv]); }; });
  };

  // ---------- 수입 체크: 본문은 import.js ----------
  screens['import'] = function () { return typeof LC.renderImport === 'function' ? LC.renderImport(state) : '<h2>수입 체크</h2><p class="muted">import.js 준비 중</p>'; };
  screens['import'].bind = function () { if (LC.bindImport) LC.bindImport(state, $); };

  // ---------- 내보내기: CSV(UTF-8 BOM)·JSON 백업. 전부 브라우저 Blob, 서버 불필요 ----------
  function csvText(rows, cols) {
    var q = function (v) { if (Array.isArray(v)) v = v.join('; '); v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return '\ufeff' + [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); })).join('\r\n');
  }
  function download(name, text, type) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/csv;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  var EXPORTS = [
    ['로트원장', function () { return [state.ledger, ['lot', 'company_code', 'product', 'mfg', 'expiry', 'qty_ct', 'kg', 'raw', 'country', 'buyer', 'ship', 'cert', 'spec_sent']]; }],
    ['원어입고분', function () { return [state.raw, ['id', 'species', 'caught', 'vessel', 'landing', 'received', 'kg', 'boxes_in', 'boxes_ok', 'note']]; }],
    ['수출선적_품목', function () { var rows = []; state.shipments.forEach(function (s) { (s.items || []).forEach(function (i) { rows.push({ no: s.no, date: s.date, etd: s.etd || s.departure, buyer: s.buyer, vessel: s.vessel, route: s.route || ((s.from || '') + '→' + (s.to || '')), desc: i.desc, ct: i.ct, kg: i.kg, cert: s.cert }); }); }); return [rows, ['no', 'date', 'etd', 'buyer', 'vessel', 'route', 'desc', 'ct', 'kg', 'cert']]; }],
    ['등록인증_만료', function () { return [state.registry.map(function (r) { var o = {}; for (var k in r) o[k] = r[k]; o.dday = r.expiry ? daysTo(r.expiry) : ''; return o; }), ['kind', 'name', 'no', 'issuer', 'expiry', 'dday', 'lead', 'countries', 'note']]; }],
    ['영양값_출처', function () { return [state.nutritionSources, ['buyer', 'product', 'kcal', 'protein', 'fat', 'carb', 'salt_g', 'basis', 'src']]; }],
    ['수입_서류체크리스트', function () { var rows = []; (state.importShipments || []).forEach(function (s) { (s.checklist || []).forEach(function (c) { rows.push({ no: s.no, doc: c.doc, required: c.required ? '필수' : '', status: c.status, count: c.count_expected ? (c.count_have || 0) + '/' + c.count_expected : '', date: c.date, note: c.note }); }); }); return [rows, ['no', 'doc', 'required', 'status', 'count', 'date', 'note']]; }],
    ['처리기록', function () { return [state.docs, ['at', 'file', 'doc_type', 'result']]; }]
  ];
  screens['export'] = function () {
    var ymd = LC.TODAY.replace(/-/g, '');
    return '<h2>내보내기</h2><p class="sub">CSV나 JSON으로 내려받습니다.</p>' + (state.ledger.length ? '' : emptyLedger()) +
      '<div class="card"><h3>표 내보내기 (CSV)</h3><div class="row">' + EXPORTS.map(function (e, i) { return '<button class="ghost" data-csv="' + i + '">' + e[0] + '</button>'; }).join('') + '</div><p class="muted">파일명 라벨코스트_표이름_' + ymd + '.csv</p></div>' +
      '<div class="card"><h3>백업</h3><div class="row"><button id="exp-json">전체 백업(JSON)</button><label>백업 불러오기 <input type="file" id="exp-load" accept=".json"></label>' + (API ? '<a href="' + API + '/backup" target="_blank">서버 백업 내려받기</a>' : '') + '</div><p id="exp-msg" class="muted">' + intakeSummary() + '</p></div>';
  };
  screens['export'].bind = function () {
    var ymd = LC.TODAY.replace(/-/g, '');
    document.querySelectorAll('[data-csv]').forEach(function (b) { b.onclick = function () { var e = EXPORTS[+b.dataset.csv]; var rc = e[1](); download('라벨코스트_' + e[0] + '_' + ymd + '.csv', csvText(rc[0], rc[1])); }; });
    $('#exp-json').onclick = function () { var s = {}; SAVED.forEach(function (k) { s[k] = state[k]; }); download('라벨코스트_백업_' + ymd + '.json', JSON.stringify(s, null, 1), 'application/json'); };
    $('#exp-load').onchange = function () {
      var f = this.files[0]; if (!f) return; var fr = new FileReader();
      fr.onload = function () { try { var s = JSON.parse(fr.result); SAVED.forEach(function (k) { if (s[k] !== undefined) state[k] = s[k]; }); save(); $('#exp-msg').textContent = '불러옴: ' + intakeSummary(); } catch (e) { $('#exp-msg').textContent = '불러오기 실패: ' + e; } };
      fr.readAsText(f);
    };
  };

  // ---------- 라우팅 ----------
  // 첫 줄: 묶음 6개. 둘째 줄: 현재 묶음 안의 화면들
  var NAV_MAIN = [['home', '홈', '오늘 할 일'], ['quick', '한 번에 처리', '서류 넣기 → 확인 → 결과물'], ['label', '라벨', '라벨 판정 · 품목 · 규격서'], ['ship', '생산·LOT', '선적·원장 · LOT 조회'], ['intake', '서류', '서류 넣기 · 대시보드 · 수입 체크 · 내보내기']];
  var NAV_SUB = { label: [['label', '라벨 판정'], ['product', '품목'], ['spec', '규격서']], ship: [['ship', '선적·원장'], ['lot', 'LOT 조회']], intake: [['intake', '서류 넣기'], ['dash', '대시보드'], ['import', '수입 체크'], ['stats', '집계'], ['export', '내보내기']] };
  function groupOf(name) { for (var g in NAV_SUB) if (NAV_SUB[g].some(function (x) { return x[0] === name; })) return g; return name; }
  function navLink(x, on) { return '<a href="#' + x[0] + '" class="' + (on ? 'on' : '') + '" title="' + esc(x[2] || x[1]) + '"' + (on ? ' aria-current="page"' : '') + '>' + x[1] + '</a>'; }
  function route() {
    var h = location.hash.replace('#', '') || 'home'; var parts = h.split('/'); var name = parts[0]; var arg = decodeURIComponent(parts.slice(1).join('/'));
    if (!screens[name]) name = 'home';
    var g = groupOf(name), sub = NAV_SUB[g];
    $('#nav').innerHTML = '<div class="nav-main">' + NAV_MAIN.map(function (x) { return navLink(x, x[0] === g); }).join('') + ' <span class="muted" id="mode">' + esc(modeBadge()) + ' · ' + LC.TODAY + '</span></div>' +
      (sub ? '<div class="nav-sub">' + sub.map(function (x) { return navLink(x, x[0] === name); }).join('') + '</div>' : '');
    $('#main').innerHTML = screens[name](arg);
    if (screens[name].bind) screens[name].bind(arg);
  }
  window.addEventListener('hashchange', route);
  route();

  // 자체 점검: 홍콩 샘플은 수정 4·확인 2 가 나와야 함
  (function selfTest() {
    var s = summarize(judge('HK', LC.sampleLabels.HK.fields));
    console.log('[selftest] HK', s, s.fix === 4 && s.check === 2 ? 'OK' : 'FAIL');
  })();
  window.LC_judge = judge;
})();
