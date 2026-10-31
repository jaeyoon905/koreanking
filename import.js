// 수입 체크 — 수입 건 데이터 + 화면. 수출 체크리스트와 같은 구조(서류 = 행, 상태 = 배지). 회사·거래처는 마스킹.
var LC = (typeof LC !== 'undefined') ? LC : {};

LC.importSeed = [
  { no: 'NCSEW26004', date: '2026-09-15', exporter: '홋카이도 어련 N사(삿포로)', importer: 'A사 수입 법인(서울)', route: '이시카리 → 부산', vessel: 'STAR SKIPPER 2618W',
    etd: '2026-10-09(실제 출항 10-12)', eta: '2026-10-16 부산 신선대', incoterms: 'CFR BUSAN', containers: '리퍼 20ft ×1', total: '851 C/T, 순중량 6,895kg(B/L) / 8,020팩(인보이스)',
    items: [
      { desc: 'FROZEN SCALLOP MEAT 3S (Mizuhopecten yessoensis)', ct: 49, kg: 490, packer: 'K사(왓카나이)' },
      { desc: 'FROZEN STEAMED SCALLOP L', ct: 500, packs: 5000 },
      { desc: 'FROZEN STEAMED SCALLOP M', ct: 300, packs: 3000 },
      { desc: 'FROZEN BOILED KING CRAB LEG MEAT (샘플, 무상)', ct: 1, packs: 10 },
      { desc: 'FROZEN SCALLOP MEAT 300g (샘플, 무상)', ct: 1, packs: 10 }
    ],
    checklist: [
      { doc: '인보이스·패킹리스트', required: true, status: '있음', date: '2026-09-15', note: '단가·금액은 가림', src: '인보이스_패킹리스트_NCSEW26004.pdf' },
      { doc: 'B/L 원본', required: true, status: '있음', date: '2026-10-09', note: 'KMTC KMTCISI0269980. 원본은 DHL(8941050963)로 부산 관세사에게 10-12 도착', src: '선하증권·DHL 운송장' },
      { doc: '일본 정부 수입용 식품 신고서 (제품·제조소별)', required: true, status: '확인', count_expected: 4, count_have: 1, note: '확인한 것: NS0161KR1377 (가리비 조갯살 49ct, 제조소 K사 왓카나이, 홋카이도 농정사무소 2026-10-08). 신고서 묶음 12쪽에 나머지 제품분이 있는지 세야 함', src: '수출신고_Declaration_NCSEW26004.pdf' },
      { doc: '방사능 분석 보고서 (요오드-131, 세슘-134·137)', required: true, status: '있음', date: '2026-09-28', note: '보고서 26-07496, 홋카이도 약제사회 공중위생검사센터, 게르마늄 검출기, 검출한계 0.7Bq/kg. 신고서에 첨부', src: '신고서 본문' },
      { doc: '해외제조업소 등록 (식약처)', required: true, status: '확인', note: 'K사 등 제조소별 등록 여부·만료일(2년) 확인. 수입신고 전 필수', src: '' },
      { doc: '한글표시 라벨(스티커)', required: true, status: '확인', note: '수입자가 작성. 가리비는 알레르기 표시 대상 아님, 대게는 갑각류 표시', src: '' },
      { doc: '식약처 수입식품 신고 / 세관 수입신고', required: true, status: '확인', note: '관세사 대행. 일본산 수산물은 방사능 검사 별도', src: '' },
      { doc: '선박 일정', required: false, status: '있음', note: 'ETD 10-12 13:00 이시카리, ETA 10-16 02:00 부산', src: '선박일정_캡처' }
    ],
    notes: [
      '신고서 체크 문구: 홋카이도는 방사능 검사가 필요한 17개 도현에 포함(신고서 본문 기준)',
      '위생증명서 개념이 아니라 일본 정부 신고서+분석서로 대체되는 구조',
      '관세: 한일 FTA 없음. RCEP 적용 여부는 품목별 확인'
    ] }
];

LC.importShipments = LC.importSeed; // 호환 별칭

LC.renderImport = function (state) {
  var live = !!(state && state.importShipments && state.importShipments.length), list = live ? state.importShipments : LC.importSeed;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var CLS = { '있음': 'ok', '확인': 'warn', '없음': 'bad' };
  var tr = function (cells) { return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; };
  var fold = function (x, n) { x = String(x == null ? '' : x); n = n || 40; return x.length <= n ? esc(x) : '<details class="fold"><summary>' + esc(x.slice(0, n)) + '…</summary>' + esc(x) + '</details>'; };
  return '<h2>수입 체크</h2><p class="sub">수입 선적 서류가 다 왔는지 봅니다.' + (live ? '' : ' <span class="muted">(아직 승인한 수입 서류가 없어 예시로 보여 줘요)</span>') + '</p>' +
    list.map(function (s) {
      s.checklist = s.checklist || []; s.items = s.items || []; s.notes = s.notes || [];
      var req = s.checklist.filter(function (c) { return c.required; });
      var cnt = { '있음': 0, '확인': 0, '없음': 0 };
      req.forEach(function (c) { cnt[c.status] = (cnt[c.status] || 0) + 1; });
      var worst = cnt['없음'] ? 'bad' : cnt['확인'] ? 'warn' : 'ok';
      var overview = [['수입 건', s.no], ['인보이스일', s.date], ['수출자', s.exporter], ['수입자', s.importer], ['구간', s.route], ['선박', s.vessel], ['출항', s.etd], ['도착', s.eta], ['조건', s.incoterms], ['컨테이너', s.containers], ['수량', s.total]];
      return '<div class="card"><h3>선적 개요 · ' + esc(s.no) + '</h3><table>' + overview.map(function (r) { return '<tr><th>' + r[0] + '</th><td>' + esc(r[1]) + '</td></tr>'; }).join('') + '</table></div>' +
        '<div class="card"><h3>품목</h3><table><tr><th>품목</th><th>C/T</th><th>수량</th><th>제조소</th></tr>' +
        s.items.map(function (i) { return tr([esc(i.desc), i.ct, i.kg ? i.kg + ' kg' : i.packs ? i.packs.toLocaleString() + ' 팩' : '-', esc(i.packer || '-')]); }).join('') + '</table></div>' +
        '<div class="card"><h3>서류 체크리스트</h3><p><span class="b ' + worst + '">필수 ' + req.length + '건 중 있음 ' + cnt['있음'] + ', 확인 ' + cnt['확인'] + ', 없음 ' + cnt['없음'] + '</span></p>' +
        '<table><tr><th>필수</th><th>서류</th><th>상태</th><th>날짜</th><th>비고</th><th>출처</th></tr>' +
        s.checklist.map(function (c) {
          var st = '<span class="b ' + (CLS[c.status] || 'warn') + '">' + esc(c.status) + '</span>' + (c.count_expected ? ' <span class="muted">' + c.count_have + '/' + c.count_expected + '장</span>' : '');
          return tr([c.required ? '필수' : '<span class="muted">선택</span>', esc(c.doc), st, esc(c.date || '-'), fold(c.note), '<span class="muted">' + esc(c.src || '-') + '</span>']);
        }).join('') + '</table>' +
        '<ul class="muted">' + s.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' +
        '<p class="muted">서류 PDF를 서류 넣기에 넣으면 상태가 채워진다. 해외제조업소 등록 만료는 대시보드에서.</p></div>';
    }).join('');
};
