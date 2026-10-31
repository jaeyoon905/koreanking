// 라벨코스트 데모 — 단일 페이지, 프레임워크 없음. 상태는 localStorage.
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmtDate = function (d) { return d ? d : '-'; };
  var daysTo = function (iso) { return Math.round((new Date(iso) - new Date(LC.TODAY)) / 86400000); };
  var STATUS = { pass: ['통과', 'ok'], fix: ['수정', 'bad'], check: ['확인', 'warn'] };

  // ---------- 상태 ----------
  // 시드값. 모든 상태는 여기서 복원한다
  function seeds() {
    return {
      ledger: LC.seedLedger.slice(), raw: LC.rawLots.slice(), registry: LC.registry.slice(),
      shipments: (LC.shipmentsSeed || []).slice(), nutritionSources: (LC.nutritionSources || []).slice(), docs: [], specForms: {},
      labels: Object.values(LC.sampleLabels).map(function (l) { return { file: l.file, country: l.country, made: l.made }; }),
      importShipments: [], processLog: {}, importWaybills: []
    };
  }
  var SAVED = ['ledger', 'raw', 'registry', 'shipments', 'nutritionSources', 'docs', 'specForms', 'labels', 'importShipments', 'processLog', 'importWaybills'];
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
  function modeBadge() {
    if (!API) return '오프라인(브라우저 저장)';
    if (!health) return '서버 확인 중';
    return health.ok ? '서버 연결 · AI 추출 ' + (health.llm ? '켜짐' : '꺼짐') : '서버 없음(브라우저 저장)';
  }
  if (API) {
    api('/health').then(function (h) { health = h; if (h && h.today) LC.TODAY = h.today; return api('/state'); })
      .then(function (s) { var seeded = seeds(); SAVED.forEach(function (k) { if (s && s[k] != null) state[k] = s[k]; else if (!localStorage.getItem('lc.' + k)) state[k] = seeded[k]; }); route(); })
      .catch(function () { health = { ok: false }; route(); });
  }

  // ---------- 판정 엔진 ----------
  function judge(country, fields) {
    var r = LC.rules[country];
    return r.checks.map(function (c) { var out = c.run(fields, P()); out.item = c.item; out.id = c.id; return out; });
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

  screens.label = function () {
    var sel = Object.keys(LC.sampleLabels).map(function (k) { var sl = LC.sampleLabels[k]; return '<option value="' + k + '">' + ((LC.rules[sl.country] || LC.rules[k] || {}).name || sl.country) + ' — ' + sl.file + '</option>'; }).join('');
    return '<h2>① 라벨 판정</h2><p class="sub">라벨 파일을 올리거나 받은 파일을 고르고 도착국을 정하면 규칙 파일로 항목별 판정. 추출만 자동, 판정은 규칙, 최종 확인은 사람.</p>' +
      '<div class="row"><label>받은 파일 <select id="lbl-sample">' + sel + '</select></label>' +
      '<label>또는 엑셀 업로드 <input type="file" id="lbl-file" accept=".xlsx,.xls"></label>' +
      '<label>도착국 <select id="lbl-country">' + Object.keys(LC.rules).map(function (k) { return '<option value="' + k + '">' + LC.rules[k].name + '</option>'; }).join('') + '</select></label>' +
      '<label>라벨 기준일 <input type="date" id="lbl-made"></label><button id="lbl-run">판정</button></div><div id="lbl-out"></div>' + nutritionSourceTable();
  };
  // 영양값 출처: 바이어마다 다른 추정값이 어디서 왔는지. 비어 있으면 안 그림
  function nutritionSourceTable() {
    var ns = state.nutritionSources || [];
    if (!ns.length) return '';
    return '<div class="card"><h3>영양값 출처 (100g)</h3><table><tr><th>바이어</th><th>제품</th><th>kcal</th><th>단백질</th><th>식염상당량</th><th>근거</th><th>출처</th></tr>' +
      ns.map(function (x) { return '<tr><td>' + esc(x.buyer) + '</td><td>' + esc(x.product) + '</td><td>' + esc(x.kcal) + '</td><td>' + esc(x.protein) + '</td><td>' + esc(x.salt_g) + '</td><td>' + esc(x.basis) + '</td><td class="muted">' + esc(x.source) + '</td></tr>'; }).join('') +
      '</table><p class="muted">값이 다른 건 바이어마다 조미액이 달라서. 라벨 값은 바이어 제공, 자사 성적서는 조미 전 다른 제품.</p></div>';
  }
  function renderJudge(country, fields, meta) {
    var res = judge(country, fields); var s = summarize(res); var r = LC.rules[country];
    var rev = LC.revisions.filter(function (v) { return v.country === country && meta.made && meta.made < v.effective; });
    var html = '<div class="card"><div class="badges"><span class="b bad">수정 ' + s.fix + '</span><span class="b warn">확인 ' + s.check + '</span><span class="b ok">통과 ' + s.pass + '</span>' +
      '<span class="muted">' + esc(r.name) + ' · ' + esc(r.law) + ' · 라벨 기준일 ' + fmtDate(meta.made) + (meta.file ? ' · ' + esc(meta.file) : '') + '</span></div>' +
      (rev.length ? '<p class="alert">고시 개정 이후 라벨: ' + rev.map(function (v) { return esc(v.title) + ' (시행 ' + v.effective + ')'; }).join(', ') + ' → 재검토 필요</p>' : '') +
      '<table><tr><th>항목</th><th>판정</th><th>현재</th><th>고칠 것</th></tr>' +
      res.map(function (x) { return '<tr><td>' + esc(x.item) + '</td><td><span class="b ' + STATUS[x.status][1] + '">' + STATUS[x.status][0] + '</span></td><td>' + esc(x.msg) + '</td><td>' + esc(x.fix || '') + '</td></tr>'; }).join('') +
      '</table><p class="muted">확인 항목만 모아 검사기관·대행사에 질의. 수정 항목은 품목 입력값에서 문구 생성 (② 화면).</p>' +
      '<details><summary>추출된 필드</summary><pre>' + esc(JSON.stringify(fields, null, 1)) + '</pre></details></div>';
    $('#lbl-out').innerHTML = html;
    state.lastLabel = { country: country, made: meta.made, file: meta.file, summary: s };
  }
  screens.label.bind = function () {
    var sampleSel = $('#lbl-sample');
    function syncSample() { var l = LC.sampleLabels[sampleSel.value]; $('#lbl-country').value = l.country; $('#lbl-made').value = l.made && l.made.length === 10 ? l.made : ''; }
    sampleSel.onchange = syncSample; syncSample();
    var uploaded = null;
    $('#lbl-file').onchange = function (e) {
      var file = e.target.files[0]; if (!file) return;
      var fr = new FileReader();
      fr.onload = function () { var wb = XLSX.read(fr.result, { type: 'array' }); uploaded = { file: file.name, fields: parseSheet(wb.Sheets[wb.SheetNames[0]]) }; $('#lbl-out').innerHTML = '<p class="muted">' + esc(file.name) + ' 읽음 (' + wb.SheetNames[0] + '). 판정을 누르세요.</p>'; };
      fr.readAsArrayBuffer(file);
    };
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
    var nut = p.nutrition100 ? '<table>' + Object.keys(n).map(function (k) { return '<tr><td>' + k + '</td><td><input data-n="' + k + '" value="' + n[k] + '" size="6"></td></tr>'; }).join('') + '</table>' : '<p class="alert">성적서 필요 · 이 품목은 영양값이 없음</p>';
    return '<h2>② 품목 입력 → 4개국 판정표</h2><p class="sub">한 번 입력. 배합비는 태국 라벨, 영양값은 대만 라벨에서 가져옴(추정값). 나라별 영양 항목·알레르겐·첨가물 문구가 같은 값에서 나오므로 나라마다 두 배씩 다른 일이 없어짐.</p>' +
      '<div class="row">' + productSelect('prd-prod') + '</div><div class="cols"><div class="card"><h3>' + esc(p.name_ko) + ' (' + p.code + ')</h3><table><tr><th>원재료</th><th>배합비</th><th>구분</th></tr>' + ing + '</table><p class="muted">알레르겐: 갑각류(게) · 공정: ' + esc(p.process) + '</p></div>' +
      '<div class="card"><h3>영양 (100g)</h3>' + nut + '<p class="muted">' + esc(p.nutrition_source) + '</p>' + (p.nutrition100 ? '<button id="prd-apply">환산</button>' : '') + '</div></div><div id="prd-out"></div>';
  };
  function renderProductOut() {
    if (!P().nutrition100) { $('#prd-out').innerHTML = '<p class="alert">성적서 필요 · 영양 성적서가 들어오면(⑦ 서류 넣기) 4개국 환산표가 나옴</p>'; return; }
    var html = '<div class="grid4">' + Object.keys(LC.rules).map(function (k) {
      var r = LC.rules[k];
      return '<div class="card"><h3>' + r.name + '</h3><p class="muted">' + esc(r.law) + '</p><table>' + (k === 'CN' && typeof LC.nutritionCN === 'function' ? LC.nutritionCN(P()) : nutritionBy[k] ? nutritionBy[k]() : [['영양표시', '환산표 미구현']]).map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + esc(x[1]) + '</td></tr>'; }).join('') + '</table>' +
        '<p><b>알레르겐</b> ' + esc(allergenBy[k] || '(문구 미정)') + '</p><p><b>첨가물</b> ' + esc(additiveBy[k] || '(문구 미정)') + '</p><p class="muted">필수 항목 ' + r.required.length + '개: ' + esc(r.required.join(', ')) + '</p></div>';
    }).join('') + '</div>';
    $('#prd-out').innerHTML = html;
  }
  screens.product.bind = function () {
    bindProductSelect('prd-prod');
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
  // ③ 바이어 양식 규격서: ⑦에서 승인한 양식(state.specForms[buyer])의 칸 순서 그대로. 우리 데이터에 없는 값은 노란 빈칸
  function buyerFormSheet(buyer, lot) {
    var f = state.specForms[buyer] || {}, p = (lot && LC.products && LC.products[lot.product]) || P(), miss = ' style="background:#fff3bf"';
    var code = (String(f.spec || '').match(/商品コード\s*([\w\-－]+)/) || [])[1] || '';
    var val = { '会社名': buyer, '作成日': LC.TODAY, '韓国商品名': p.name_en, '日本商品名': p.name_ja || '', '商品コード': code, '工場': 'A사', '規格': p.pack,
      '賞味期限': p.shelf_months + '개월 (' + Math.round(p.shelf_months / 12) + '年間)', '単位': 'ケース', '形態': p.note || '' };
    if (lot) { val['LOT'] = lot.lot + (lot.company_code ? ' (' + lot.company_code + ')' : ''); val['製造日'] = lot.mfg; val['賞味期限'] = lot.expiry; }
    var gf = function (x) { return typeof x === 'string' ? x : x.name + (x.g != null ? ' ' + x.g + 'g' : '') + (x.pct != null ? ' (' + x.pct + '%)' : ''); };
    var td = function (k) { var v = val[k]; return '<tr><th>' + esc(k) + '</th><td' + (v ? '' : miss) + '>' + esc(v || '') + '</td></tr>'; };
    var list = function (title, arr) { return '<tr><th colspan="2">' + title + '</th></tr>' + (arr && arr.length ? arr.map(function (x, i) { return '<tr><td>' + (i + 1) + '</td><td>' + esc(gf(x)) + '</td></tr>'; }).join('') : '<tr><td colspan="2"' + miss + '></td></tr>'); };
    var sections = ['重点管理', '配合', '調味液', '包装資材'], basic = (f.fields || Object.keys(val)).filter(function (k) { return sections.indexOf(k) < 0; });
    if (lot) basic = basic.concat(['LOT', '製造日']);
    return '<div class="sheet"><h3>' + esc(f.form_title || '商品規格書') + ' — ' + esc(buyer) + '</h3><p class="muted">' + esc(buyer) + ' 양식 칸 순서 그대로 · 노란 칸은 우리 데이터에 없는 값 · 발행일 ' + LC.TODAY + '</p><table>' +
      basic.map(td).join('') + list('重点管理', f.qc) + list('配合', f.recipe) + list('調味液', f.seasoning) + list('包装資材', f.packaging) + '</table></div>';
  }
  function formSelect(id) {
    var ks = Object.keys(state.specForms || {}); if (!ks.length) return '';
    return '<label>양식 <select id="' + id + '"><option value="">기본</option>' + ks.map(function (k) { return '<option value="' + esc(k) + '"' + (k === state.specBuyer ? ' selected' : '') + '>' + esc(k) + ' ' + esc(state.specForms[k].form_title || '規格書') + '</option>'; }).join('') + '</select></label>';
  }
  function sheetFor(lot) { return state.specBuyer && state.specForms[state.specBuyer] ? buyerFormSheet(state.specBuyer, lot) : specSheet(lot); }
  screens.spec = function () {
    return '<h2>③ 품목 규격서</h2><p class="sub">②의 값 + 인증 목록이 그대로 들어감. 거래 시작 때 1회. ⑦에서 바이어 규격서 양식을 승인하면 그 양식으로도 나옴. 인쇄 → PDF.</p>' +
      '<div class="row">' + productSelect('sp-prod') + formSelect('sp-form') + '</div><button onclick="window.print()">PDF로 저장(인쇄)</button>' + sheetFor(null);
  };
  screens.spec.bind = function () { bindProductSelect('sp-prod'); var el = $('#sp-form'); if (el) el.onchange = function () { state.specBuyer = el.value; route(); }; };

  screens.ship = function () {
    var raw = state.raw.map(function (r) { return '<label class="chk"><input type="checkbox" name="raw" value="' + r.id + '"> ' + r.id + ' · ' + r.species + ' 어획 ' + r.caught + ' ' + r.landing + ' ' + r.kg + 'kg' + (r.note ? ' <small class="muted">' + esc(r.note) + '</small>' : '') + '</label>'; }).join('');
    return '<h2>④ 선적 입력 → 로트 규격서 + 원장</h2><p class="sub">선적 때 넣는 건 세 칸(제조일·수량·증명서 번호(요구하는 바이어만))과 원어 로트 체크. LOT = 제조일-품목코드. 원장 한 줄과 LOT 링크가 생김.</p>' +
      '<div class="card"><div class="row">' + productSelect('sh-prod') + '<label>제조일 <input type="date" id="sh-mfg" value="2026-10-14"></label><label>수량(C/T) <input type="number" id="sh-qty" value="100"></label><label>중량(kg) <input type="number" id="sh-kg" value="1000"></label>' +
      '<label>위생증명서 번호 <input id="sh-cert" value="해당 없음" placeholder="요구하는 바이어만 번호 입력"></label><label>도착국 <select id="sh-country"><option>TW</option><option>JP</option><option>HK</option><option>TH</option><option>CN</option></select></label>' +
      '<label>바이어 <input id="sh-buyer" list="buyer-list" value="' + (LC.buyers && LC.buyers.length ? '일본 바이어 ' + LC.buyers[0].code : '대만 바이어 F사') + '"><datalist id="buyer-list">' + (LC.buyers || []).map(function (b) { return '<option value="' + (b.country === 'JP' ? '일본' : b.country) + ' 바이어 ' + esc(b.code) + '">' + esc(b.port + ' · ' + b.spec_form + ' · 증명서 ' + b.cert) + '</option>'; }).join('') + '</datalist></label><label>선적 <input id="sh-ship" value="2026-10-20 부산→기륭"></label></div><div class="rawbox"><b>원어 입고 로트</b><br>' + raw + '</div><button id="sh-add">원장에 추가 + 로트 규격서</button></div>' +
      '<div id="sh-out"></div><h3>선적 목록</h3>' + shipmentCards() + '<h3>로트 원장</h3><div id="sh-ledger"></div><button class="ghost" id="sh-reset">시드로 초기화</button>';
  };
  function shipmentCards() {  // state.shipments(⑦ 패킹리스트 승인 또는 시드) → 선적별 카드
    if (!state.shipments.length) return '<p class="muted">선적 없음 · ⑦에서 패킹리스트를 승인하면 생김</p>';
    return state.shipments.map(function (sh) {
      var lots = state.ledger.filter(function (l) { return (l.ship || '').indexOf(sh.no) >= 0; });
      return '<div class="card"><b>' + esc(sh.no) + '</b> · 출항 ' + esc(sh.etd || sh.date) + ' · ' + esc(sh.buyer) + ' · ' + esc(sh.vessel) + ' · ' + esc(sh.route) + ' · 증명서: ' + esc(sh.cert || '해당 없음') +
        '<table><tr><th>품목</th><th class="num">C/T</th><th class="num">kg</th></tr>' + (sh.items || []).map(function (it) { return '<tr><td>' + esc(it.desc) + '</td><td class="num">' + it.ct + '</td><td class="num">' + (it.kg != null ? it.kg : '-') + '</td></tr>'; }).join('') +
        '<tr><th>합계</th><th class="num">' + (sh.total_ct != null ? sh.total_ct : '') + '</th><th class="num">' + (sh.total_kg != null ? sh.total_kg : '') + '</th></tr></table>' +
        '<p><b>이 선적에 연결된 LOT</b> ' + (lots.length ? lots.map(function (l) { return '<a href="#lot/' + l.lot + '">' + l.lot + (l.company_code ? ' (' + l.company_code + ')' : '') + '</a>'; }).join(', ') : '연결된 LOT 없음 · ⑦에서 패킹리스트를 승인하면 연결') + '</p>' +
        (sh.note ? '<p class="muted">' + esc(sh.note) + '</p>' : '') + '</div>';
    }).join('');
  }
  function ledgerTable() {
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
    return '<h2>⑤ LOT 조회</h2><p class="sub">바이어 면은 지금 메일로 보내는 서류 수준만. 회사 면에서만 원어 로트·출고처 역추적. 원어 로트 번호를 넣으면 거꾸로 제품 로트→선적이 나옴.</p>' +
      '<div class="row"><input id="lot-q" placeholder="LOT 또는 원어 로트 (예: 20260930-LB, R-20260928-01)" value="' + esc(arg || '') + '" size="40"><button id="lot-go">조회</button><label class="chk"><input type="checkbox" id="lot-inside"> 회사 면(내부)</label></div><div id="lot-out"></div>';
  };
  function renderLot(q, inside) {
    var out = $('#lot-out');
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
    var html = '<div class="card face-buyer"><h3>바이어 면 — ' + lot.lot + '</h3><table>' + buyer.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table><p class="muted">새로 공개되는 정보 0. 지금 메일로 보내는 서류와 같은 수준.</p>' +
      (pub ? '<p class="muted">바이어 공개 주소: <a href="' + esc(pub) + '" target="_blank">' + esc(pub) + '</a></p>' : '') + '</div>';
    if (inside) {
      var raws = state.raw.filter(function (r) { return lot.raw.indexOf(r.id) >= 0; });
      var siblings = state.ledger.filter(function (l) { return l.lot !== lot.lot && l.raw.some(function (r) { return lot.raw.indexOf(r) >= 0; }); });
      html += '<div class="card face-inside"><h3>회사 면 — 원어 로트 · 출고처</h3><table><tr><th>원어 로트</th><th>어획일</th><th>선박</th><th>위판장</th><th>입고</th><th>kg</th></tr>' + raws.map(function (r) { return '<tr><td><a href="#lot/' + r.id + '">' + r.id + '</a></td><td>' + r.caught + '</td><td>' + esc(r.vessel) + '</td><td>' + esc(r.landing) + '</td><td>' + r.received + '</td><td>' + r.kg + '</td></tr>'; }).join('') + '</table>' +
        '<p><b>출고처</b> ' + esc(lot.buyer) + ' · ' + esc(lot.ship) + ' · ' + lot.country + '</p><p><b>같은 원어가 들어간 다른 로트</b> ' + (siblings.length ? siblings.map(function (l) { return '<a href="#lot/' + l.lot + '">' + l.lot + '</a> (' + l.country + ' ' + esc(l.buyer) + ')'; }).join(', ') : '없음') + '</p>' +
        '<h4>클레임 종류별로 꺼낼 기록 (제조일 ' + lot.mfg + ')</h4><table><tr><th>클레임</th><th>먼저 볼 기록</th><th>원료(배) 추적</th></tr>' +
        LC.claimMap.map(function (c) { return '<tr><td>' + c.kind + '</td><td>' + esc(c.records.split('{mfg}').join(lot.mfg)) + '</td><td>' + (c.raw ? '필요 · 위 원어 로트 ' + raws.length + '건' : '불필요') + '</td></tr>'; }).join('') +
        '</table><p class="muted">CCP 측정값·일지 원본은 수집하지 않음. 날짜와 장부 이름만 가리키고 원본은 공장 서류함에서 꺼낸다.</p>' +
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
    var go = function () { renderLot($('#lot-q').value.trim(), $('#lot-inside').checked); };
    $('#lot-go').onclick = go; $('#lot-inside').onchange = go;
    if (arg) go();
  };

  screens.dash = function () {
    var rows = state.registry.map(function (r) {
      var d = r.expiry ? daysTo(r.expiry) : null; var cls = d == null ? '' : d <= r.lead || d <= 30 ? 'bad' : d <= 90 ? 'warn' : 'ok';
      return '<tr><td>' + r.kind + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.no) + '</td><td>' + esc(r.issuer) + '</td><td>' + fmtDate(r.expiry) + '</td><td>' + (d == null ? '-' : '<span class="b ' + cls + '">D-' + d + '</span>') + '</td><td>' + r.countries + '</td><td class="muted">' + esc(r.note) + '</td></tr>';
    }).join('');
    var rev = LC.revisions.map(function (v) {
      var d = daysTo(v.effective);
      var hit = state.labels.filter(function (l) { return l.country === v.country && (!l.made || l.made < v.effective); });
      return '<tr><td>' + v.country + '</td><td>' + esc(v.title) + '</td><td>' + v.effective + ' (' + (d < 0 ? '시행 중' : 'D-' + d) + ')</td><td>' + (hit.length ? hit.map(function (l) { return esc(l.file) + ' (기준일 ' + fmtDate(l.made) + ')'; }).join('<br>') : '-') + '</td><td class="muted">' + esc(v.note) + '</td></tr>';
    }).join('');
    return '<h2>⑥ 대시보드 — 등록·인증 D-day, 고시 개정</h2><p class="sub">평소엔 안 봄. 90일·30일 전 알림. HACCP 끊기면 EU·GACC 등록까지 흔들리므로 최상위.</p>' +
      '<div class="card"><h3>등록·인증 레지스트리 (오늘 ' + LC.TODAY + ')</h3><table><tr><th>층</th><th>종류</th><th>번호</th><th>발급</th><th>만료</th><th>D-day</th><th>국가</th><th>비고</th></tr>' + rows + '</table></div>' +
      '<div class="card"><h3>고시 개정 → 영향받는 라벨</h3><table><tr><th>국</th><th>고시</th><th>시행일</th><th>재검토 라벨</th><th>비고</th></tr>' + rev + '</table></div>' +
      '<div class="card"><h3>식약처 공개데이터 (OpenAPI 조회값, 키는 서버 측)</h3><p>영업등록 199005660** 식품제조가공업 (1990-09-05) · 품목제조보고 46건 (수출용 품목 포함) · HACCP I0610 조회 0건 → 수산물 HACCP(수품원) 인증서 수기 입력</p></div>';
  };

  // ---------- ⑦ 서류 넣기: 접수부 → 읽기부 → 검증부 → 결재부 ----------
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
    return esc(v);
  }
  var DIFF = { ok: ['통과', 'ok'], add: ['추가', 'warn'], check: ['확인', 'warn'], bad: ['불일치', 'bad'] };
  var MODE = { llm: ['추출: AI(Claude)', 'ok'], fixture: ['추출: 미리 읽어 둔 값 · API 키 연결 시 실시간', 'warn'], none: ['종류 미확인 · 수동 입력', 'bad'] };
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
  function intakeCard(c, i) {
    var h = '<div class="card" id="ic-' + i + '"><h3>' + esc(c.name) + (c.done ? ' <span class="b ' + (c.done === '승인' ? 'ok' : 'bad') + '">' + (c.done === '승인' ? '반영됨' : '반려') + '</span>' : '') + '</h3>';
    h += '<p><b>접수부</b> 종류: ' + (c.doc_type ? esc(c.doc_type) : '종류 미확인 · 추출 불가(키 없음) · 수동 입력') + '</p>';
    if (c.doc_type && c.sensitive && !c.masked) return h + '<p class="alert">접수부 차단: 계좌·단가가 있을 수 있는 서류는 가린 뒤 처리. LLM에 보내지 않음</p><label class="chk"><input type="checkbox" data-mask="' + i + '"> 계좌·단가 가렸음</label></div>';
    if (!c.doc_type || c.mode === 'none') return h + '</div>';
    var m = MODE[c.mode] || MODE.none;
    h += '<p><b>읽기부</b> <span class="b ' + m[1] + '">' + m[0] + '</span>' + (c.loading ? ' <span class="muted">읽는 중…</span>' : '') + '</p><table><tr><th>라벨</th><th>값</th><th>읽은 위치</th></tr>' +
      (c.fields || []).map(function (x) { return '<tr><td>' + esc(x.label || x.k) + '</td><td>' + cell(x.value !== undefined ? x.value : x.v) + '</td><td class="muted">' + esc(x.src) + '</td></tr>'; }).join('') + '</table>';
    var diffs = []; try { diffs = reconcileCard(c); } catch (e) { diffs = [{ item: '대조 오류', status: 'bad', note: String(e) }]; }
    h += '<p><b>검증부</b></p>' + (diffs.length ? '<table><tr><th>항목</th><th>상태</th><th>비고</th></tr>' + diffs.map(function (d) { var s = DIFF[d.status] || [d.status, '']; return '<tr><td>' + esc(d.item) + '</td><td><span class="b ' + s[1] + '">' + s[0] + '</span></td><td class="muted">' + esc(d.note) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">대조할 항목 없음</p>');
    h += '<p><b>결재부</b> ' + (c.done ? esc(c.result || '') : '<button data-ok="' + i + '">승인</button> <button class="ghost" data-no="' + i + '">반려</button>') + '</p></div>';
    return h;
  }
  // 서버에 추출 요청. b64 없으면 fixture 모드 결과를 받는다. 응답이 오면 카드를 갱신
  function extractOnServer(c) {
    c.loading = true;
    return api('/extract', 'POST', { filename: c.name, b64: c.b64, masked: !!c.masked }).then(function (r) {
      var n = cardFromServer(c.name, r, c.b64); n.masked = c.masked; var i = intakeCards.indexOf(c); if (i >= 0) intakeCards[i] = n;
    }).catch(function () { c.loading = false; c.mode = c.fixture ? 'fixture' : 'none'; c.fields = c.fixture ? c.fixture.fields : []; }).then(renderIntake);
  }
  function addFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var b64 = String(fr.result).split(',')[1] || '';
      var c = API ? { name: file.name, doc_type: '', mode: 'fixture', fields: [], fixture: matchFixture(file.name), b64: b64 } : cardFromFixture(matchFixture(file.name), file.name);
      intakeCards.push(c); renderIntake();
      if (API) extractOnServer(c);
    };
    fr.readAsDataURL(file);
  }
  function intakeSummary() { return '로트 ' + state.ledger.length + '건 · 입고 ' + state.raw.length + '건 · 선적 ' + state.shipments.length + '건 · 영양 출처 ' + state.nutritionSources.length + '건'; }
  screens.intake = function () {
    var demo = fixtures().map(function (f, i) { return '<button class="ghost" data-fx="' + i + '">받은 파일로 시연: ' + esc(f.source) + '</button>'; }).join(' ');
    return '<h2>⑦ 서류 넣기</h2><p class="sub">사진·PDF를 올리면 접수부가 종류를 정하고, 읽기부가 칸을 뽑고, 검증부가 원장과 대조하고, 결재(사람)가 승인해야 반영된다.</p>' +
      '<div class="card"><div class="row"><label>사진·PDF 올리기 <input type="file" id="in-file" multiple></label><button class="ghost" id="in-empty">시연 초기화(빈 원장)</button><button class="ghost" id="in-seed">시드로 복원</button></div>' +
      (demo ? '<div class="row">' + demo + '</div>' : '<p class="muted">fixtures.js 없음. 파일명으로 종류만 봄.</p>') + '<p class="muted" id="in-sum">' + intakeSummary() + '</p></div>' +
      '<div id="in-cards"></div><h3>처리 기록</h3><div id="in-docs"></div>';
  };
  function renderIntake() {
    $('#in-cards').innerHTML = intakeCards.map(intakeCard).join('');
    $('#in-sum').textContent = intakeSummary();
    var docs = state.docs.slice().reverse();
    $('#in-docs').innerHTML = docs.length ? '<table><tr><th>일자</th><th>파일</th><th>종류</th><th>결과</th></tr>' + docs.map(function (d) { return '<tr><td>' + esc(d.at) + '</td><td>' + esc(d.file) + '</td><td>' + esc(d.doc_type) + '</td><td>' + esc(d.result) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">없음</p>';
    document.querySelectorAll('[data-mask]').forEach(function (el) { el.onchange = function () { var c = intakeCards[+el.dataset.mask]; c.masked = el.checked; if (API && c.blocked && el.checked) extractOnServer(c); else renderIntake(); }; });
    document.querySelectorAll('[data-ok]').forEach(function (el) { el.onclick = function () { decide(+el.dataset.ok, true); }; });
    document.querySelectorAll('[data-no]').forEach(function (el) { el.onclick = function () { decide(+el.dataset.no, false); }; });
  }
  function decide(i, ok) {
    var c = intakeCards[i]; var result = '반려';
    if (ok) { try { result = applyCard(c); } catch (e) { result = '반영 실패: ' + e; } }
    c.done = ok ? '승인' : '반려'; c.result = result;
    state.docs.push({ file: c.name, doc_type: c.doc_type, at: LC.TODAY, result: result }); save(); renderIntake();
    if (API) api('/docs', 'POST', { file: c.name, doc_type: c.doc_type, mode: c.mode, decision: c.done, result: result, fields: c.fields }).catch(function () {});
  }
  screens.intake.bind = function () {
    $('#in-file').onchange = function (e) { Array.prototype.forEach.call(e.target.files, addFile); };
    document.querySelectorAll('[data-fx]').forEach(function (el) { el.onclick = function () {
      var f = fixtures()[+el.dataset.fx]; var c = cardFromFixture(f, f.source); intakeCards.push(c); renderIntake();
      if (API) extractOnServer(c);  // 서버가 있으면 같은 경로(fixture 모드)로 받아 흐름을 맞춘다
    }; });
    $('#in-empty').onclick = function () { state.ledger = []; state.raw = []; state.shipments = []; state.nutritionSources = []; state.docs = []; state.specForms = {}; state.importShipments = []; state.processLog = {}; state.importWaybills = []; intakeCards = []; save(); renderIntake(); };
    $('#in-seed').onclick = function () { resetAll(); intakeCards = []; renderIntake(); };
    renderIntake();
  };

  // ---------- ⑧ 수입 체크: 본문은 import.js ----------
  screens['import'] = function () { return typeof LC.renderImport === 'function' ? LC.renderImport(state) : '<h2>⑧ 수입 체크</h2><p class="muted">import.js 준비 중</p>'; };
  screens['import'].bind = function () { if (LC.bindImport) LC.bindImport(state, $); };

  // ---------- ⑨ 내보내기: CSV(UTF-8 BOM)·JSON 백업. 전부 브라우저 Blob, 서버 불필요 ----------
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
    return '<h2>⑨ 내보내기</h2><p class="sub">원장을 CSV(엑셀)로. 백업은 JSON 한 파일. 서버 없이 브라우저에서 바로 내려받는다.</p>' +
      '<div class="card"><h3>표 내보내기 (CSV)</h3><div class="row">' + EXPORTS.map(function (e, i) { return '<button data-csv="' + i + '">' + e[0] + '</button>'; }).join('') + '</div><p class="muted">파일명 라벨코스트_표이름_' + ymd + '.csv</p></div>' +
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
  var NAV = [['label', '① 라벨 판정'], ['product', '② 품목·4개국'], ['spec', '③ 규격서'], ['ship', '④ 선적·원장'], ['lot', '⑤ LOT 조회'], ['dash', '⑥ 대시보드'], ['intake', '⑦ 서류 넣기'], ['import', '⑧ 수입 체크'], ['export', '⑨ 내보내기']];
  function route() {
    var h = location.hash.replace('#', '') || 'label'; var parts = h.split('/'); var name = parts[0]; var arg = decodeURIComponent(parts.slice(1).join('/'));
    if (!screens[name]) name = 'label';
    $('#nav').innerHTML = NAV.map(function (x) { return '<a href="#' + x[0] + '" class="' + (x[0] === name ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') + ' <span class="muted" id="mode">' + esc(modeBadge()) + '</span>';
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
