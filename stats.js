// 라벨코스트 — 집계. 원장만으로 월별 생산·선적·입고, 재고, 수율, 바이어, 만료, 리드타임, 처리기록을 낸다.
// 사용: LC.stats(state) → 객체. LC.stats.toCSV(section) → CSV 문자열(BOM 은 호출자가). 외부 의존 없음.
var LC = (typeof LC !== 'undefined') ? LC : {};
(function () {
  var ISO = /^\d{4}-\d{2}-\d{2}$/;
  function d(iso) { return ISO.test(iso || '') ? new Date(iso) : null; }
  function days(a, b) { var x = d(a), y = d(b); return x && y ? Math.round((y - x) / 86400000) : null; }
  function ym(iso) { return ISO.test(iso || '') ? iso.slice(0, 7) : null; }
  function n(v) { var x = parseFloat(v); return isNaN(x) ? 0 : x; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function add(o, k, f, v) { o[k] = o[k] || {}; o[k][f] = (o[k][f] || 0) + v; }
  function avg(a) { return a.length ? r1(a.reduce(function (s, x) { return s + x; }, 0) / a.length) : null; }
  function max(a) { return a.length ? Math.max.apply(null, a) : null; }
  // 선적 품목 desc → 품목 코드. 'BROKEN(LB)' → LB, 'WHITE FLAKE' → WF, 그 외는 desc 그대로
  function itemCode(desc) { var m = /\(([A-Z]{2,4})\)/.exec(desc || ''); if (m) return m[1]; if (/WHITE FLAKE/i.test(desc)) return 'WF'; if (/LEG/i.test(desc)) return 'LEG'; return desc || '?'; }
  function shipNo(lot) { return (lot.ship || '').split('/')[0].trim(); }
  function shipped(lot) { return !!lot.ship && !/미선적/.test(lot.ship); }

  LC.stats = function (state) {
    var s = state || {}, ledger = s.ledger || [], raw = s.raw || [], ships = s.shipments || [], reg = s.registry || LC.registry || [], docs = s.docs || [];
    var today = LC.TODAY || new Date().toISOString().slice(0, 10);

    // monthly: {월: {prod_ct_LB, prod_kg_LB, ship_ct_LB, ship_kg_LB, raw_kg}}
    var monthly = {};
    ledger.forEach(function (l) { var m = ym(l.mfg); if (!m) return; add(monthly, m, 'prod_ct_' + l.product, n(l.qty_ct)); add(monthly, m, 'prod_kg_' + l.product, n(l.kg)); });
    ships.forEach(function (sh) { var m = ym(sh.etd || sh.departure || sh.date); if (!m) return; (sh.items || []).forEach(function (it) { var c = itemCode(it.desc); add(monthly, m, 'ship_ct_' + c, n(it.ct)); add(monthly, m, 'ship_kg_' + c, n(it.kg)); }); });
    raw.forEach(function (r) { var m = ym(r.received); if (m && n(r.kg)) add(monthly, m, 'raw_kg', n(r.kg)); });
    var sorted = {}; Object.keys(monthly).sort().forEach(function (k) { sorted[k] = monthly[k]; }); monthly = sorted;

    // inventory: 품목별 생산 − 선적. 두 방식(선적 items 합 / 로트 ship 연결)을 같이 내고 다르면 note
    var inv = {};
    ledger.forEach(function (l) { add(inv, l.product, 'prod_ct', n(l.qty_ct)); add(inv, l.product, 'prod_kg', n(l.kg)); if (!shipped(l)) add(inv, l.product, 'unshipped_lot_ct', n(l.qty_ct)); else add(inv, l.product, 'shipped_lot_ct', n(l.qty_ct)); });
    ships.forEach(function (sh) { (sh.items || []).forEach(function (it) { var c = itemCode(it.desc); if (inv[c]) add(inv, c, 'ship_items_ct', n(it.ct)); }); });
    Object.keys(inv).forEach(function (p) {
      var x = inv[p]; x.unshipped_lot_ct = x.unshipped_lot_ct || 0; x.shipped_lot_ct = x.shipped_lot_ct || 0; x.ship_items_ct = x.ship_items_ct || 0;
      x.stock_ct = x.prod_ct - x.ship_items_ct;
      if (x.shipped_lot_ct !== x.ship_items_ct) x.note = '로트에 연결된 선적분 ' + x.shipped_lot_ct + ' C/T ≠ 패킹리스트 품목 합 ' + x.ship_items_ct + ' C/T. 다른 날 생산분 포함 가능';
    });

    // yield: 입고분별. 여러 입고분 쓴 로트는 입고 kg 비율로 안분. 자리표시(kg 0)는 제외
    var yieldBy = {}, placeholders = [];
    raw.forEach(function (r) { if (n(r.kg)) yieldBy[r.id] = { id: r.id, vessel: r.vessel, received: r.received, in_kg: n(r.kg), out_kg: 0, lots: [] }; else placeholders.push(r.id); });
    ledger.forEach(function (l) {
      var rs = (l.raw || []).filter(function (id) { return yieldBy[id]; }), tot = rs.reduce(function (t, id) { return t + yieldBy[id].in_kg; }, 0);
      rs.forEach(function (id) { var share = n(l.kg) * yieldBy[id].in_kg / tot; yieldBy[id].out_kg += share; yieldBy[id].lots.push(l.lot); });
    });
    var yld = Object.keys(yieldBy).map(function (id) { var y = yieldBy[id]; y.out_kg = r1(y.out_kg); y.yield_pct = r1(y.out_kg / y.in_kg * 100); return y; });
    var yieldNote = '수율 = 그 입고분을 쓴 로트 kg ÷ 입고 kg(원어 대비 제품). U사 규격서 歩留まり 80%는 해동 중량 수율이라 다른 개념. ' + (placeholders.length ? '약어만 확인된 입고분 ' + placeholders.length + '건은 kg 없어 제외' : '');

    // buyers: 선적 기준
    var by = {};
    ships.forEach(function (sh) { var b = (sh.buyer || '?').replace(/^일본 바이어 /, ''), dt = sh.etd || sh.departure || sh.date; by[b] = by[b] || { buyer: b, shipments: 0, ct: 0, kg: 0, dates: [] }; by[b].shipments++; by[b].ct += n(sh.total_ct); by[b].kg += n(sh.total_kg); if (d(dt)) by[b].dates.push(dt); });
    var buyers = Object.keys(by).map(function (k) { var b = by[k]; b.dates.sort(); b.last = b.dates[b.dates.length - 1] || null; var gaps = []; for (var i = 1; i < b.dates.length; i++) gaps.push(days(b.dates[i - 1], b.dates[i])); b.avg_gap_days = avg(gaps); delete b.dates; return b; });

    // expiry: 등록·인증 D-day 분포 + 로트 소비기한 임박
    var dist = { bad: 0, warn: 0, ok: 0, none: 0 }, urgent = [];
    reg.forEach(function (r) { var dd = days(today, r.expiry); if (dd == null) { dist.none++; return; } var cls = dd <= (r.lead || 0) || dd <= 30 ? 'bad' : dd <= 90 ? 'warn' : 'ok'; dist[cls]++; urgent.push({ name: r.name, expiry: r.expiry, dday: dd, cls: cls }); });
    urgent.sort(function (a, b) { return a.dday - b.dday; });
    var lotsSoon = ledger.filter(function (l) { var dd = days(today, l.expiry); return dd != null && dd <= 90; }).map(function (l) { return { lot: l.lot, expiry: l.expiry, dday: days(today, l.expiry), shipped: shipped(l) }; });

    // lead_times: 입고→제조, 제조→선적
    var shipDate = {}; ships.forEach(function (sh) { shipDate[sh.no] = sh.etd || sh.departure || sh.date; });
    var rawDate = {}; raw.forEach(function (r) { rawDate[r.id] = r.received; });
    var rows = ledger.map(function (l) {
      var ins = (l.raw || []).map(function (id) { return days(rawDate[id], l.mfg); }).filter(function (x) { return x != null; });
      var sd = shipDate[shipNo(l)];
      return { lot: l.lot, raw_to_mfg: ins.length ? Math.max.apply(null, ins) : null, mfg_to_ship: sd ? days(l.mfg, sd) : null };
    });
    var a1 = rows.map(function (r) { return r.raw_to_mfg; }).filter(function (x) { return x != null; }), a2 = rows.map(function (r) { return r.mfg_to_ship; }).filter(function (x) { return x != null; });
    var lead = { raw_to_mfg: { avg: avg(a1), max: max(a1) }, mfg_to_ship: { avg: avg(a2), max: max(a2) }, lots: rows };

    // docs
    var byType = {}, rejected = 0, last = null;
    docs.forEach(function (x) { byType[x.doc_type || '?'] = (byType[x.doc_type || '?'] || 0) + 1; if (/반려/.test(x.decision || x.result || '')) rejected++; if (x.at && (!last || x.at > last)) last = x.at; });

    return { today: today, monthly: monthly, inventory: inv, yield: { rows: yld, note: yieldNote }, buyers: buyers, expiry: { dist: dist, urgent: urgent.slice(0, 3), lots_soon: lotsSoon }, lead_times: lead, docs: { by_type: byType, rejected: rejected, last: last, total: docs.length } };
  };

  // 섹션 → CSV. 객체-of-객체(monthly, inventory)는 키를 첫 열로, 배열은 그대로
  LC.stats.toCSV = function (section) {
    var rows = [];
    if (Array.isArray(section)) rows = section;
    else if (section && typeof section === 'object') rows = Object.keys(section).map(function (k) { var o = { key: k }; var v = section[k]; if (v && typeof v === 'object') Object.keys(v).forEach(function (f) { if (typeof v[f] !== 'object') o[f] = v[f]; }); else o.value = v; return o; });
    var cols = []; rows.forEach(function (r) { Object.keys(r).forEach(function (c) { if (cols.indexOf(c) < 0 && typeof r[c] !== 'object') cols.push(c); }); });
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols.join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c]); }).join(','); })).join('\n');
  };
})();
