// 라벨코스트 데모 데이터 + 규칙 파일. 회사·거래처는 마스킹.
// 규칙 파일은 나라별 1개 객체. 각 check 는 (label, product) => {status:'pass'|'fix'|'check', msg, fix}
var LC = (typeof LC !== 'undefined') ? LC : {};

LC.TODAY = '2026-10-31';

// ---------- 품목 (태국 라벨 배합비 + 대만 라벨 영양값, 100g) ----------
LC.product = {
  code: 'LB', name_ko: '냉동 자숙 홍게 다리 파살', name_en: 'COOKED RED SNOW CRAB LEG BROKEN MEAT',
  net: '250 g', pack: '250 g × 40 = 10 kg', storage: '-18℃ 이하 냉동', shelf_months: 24,
  ingredients: [
    { name_ko: '홍게 다리살', pct: 80.0, type: 'raw' },
    { name_ko: '정제수', pct: 17.0, type: 'raw' },
    { name_ko: '정제소금', pct: 0.6, type: 'raw' },
    { name_ko: 'L-글루탐산나트륨', ins: 621, func: '향미증진제', type: 'additive' },
    { name_ko: 'D-소비톨', ins: 420, func: '감미료', type: 'additive' },
    { name_ko: '구아검', ins: 412, func: '증점제', type: 'additive' }
  ],
  allergens: ['crustacea'],
  nutrition100: { kcal: 38.2, protein: 7.9, fat: 0.2, satfat: 0.18, transfat: 0, carb: 1.2, sugar: 0, sodium_mg: 220 },
  nutrition_source: '바이어별 추정값이 다름(T사 76·U사 40·S사 42kcal). 자사 성적서는 조미 전 다른 제품(68.3kcal). LB 조미 제품 실측 성적서 없음',
  process: '원어 입고 → 자숙 → 탈각 → 선별 → 조미 → 급속동결 → 포장 → 금속검출 → 냉동보관',
  factory: { name: 'A사 (경북 영덕)', lic: '199005660**', haccp: 'HACCP 제2009-4-8012호 (~2029-01-22)' }
};

LC.product.name_ja = '紅ずわいがに棒くずれ（LB）';
// ---------- 품목 여러 개. LB 는 위 객체 그대로, SR 은 T사 신규 규격서(2026-09-14) 기준 ----------
LC.products = {
  LB: LC.product,
  WF: { code: 'WF', name_ko: '냉동 자숙 홍게 플레이크 (WF, 화이트 플레이크)', name_en: 'FROZEN COOKED RED SNOW CRAB WHITE FLAKE', name_ja: '紅ずわいがにフレーク',
    net: '1 kg', pack: '1 kg × 12 (12 kg/C/T)', storage: '-18℃ 이하 냉동', shelf_months: 24,
    ingredients: [{ name_ko: '홍게 살 플레이크', pct: null, type: 'raw' }], allergens: ['crustacea'], nutrition100: null, nutrition_source: '성적서 없음',
    process: LC.product.process, factory: LC.product.factory, note: '포장일지 2026-04-15 U사 WF 174 C/T(LOT AJ). 배합·영양은 미확인' },
  SR: { code: 'SR', name_ko: '냉동 자숙 홍게 믹스살 (파살 4 : 플레이크 6)', name_en: 'FROZEN COOKED RED SNOW CRAB MEAT (SR)', name_ja: '紅ズワイミート（SR）韓国',
    net: '250 g (NET 200 g)', pack: '250 g × 40팩 (T사 박스, HIGH BARRIER 봉투)', storage: '-18℃ 이하 냉동', shelf_months: 24,
    ingredients: [
      { name_ko: '홍게 다리 파살(棒くずれ) 80g', pct: 32.0, type: 'raw' },
      { name_ko: '홍게 플레이크(ボイルフレーク) 120g', pct: 48.0, type: 'raw' },
      { name_ko: '조미액 50g (코드 2, SEASONED 1, 하프미트 250g 과 동일)', pct: 20.0, type: 'raw' }
    ],
    allergens: ['crustacea'], nutrition100: null, nutrition_source: '성적서 없음 (T사 규격서에 영양값 없음)',
    process: '채육 → 트레이에 플레이크 120g + 파살 80g 토핑 → 계량 200g → 조미액 50g 첨가 → 동결 → 글레이즈 → 트레이째 진공 → 금속검출 → 냉동보관',
    factory: LC.product.factory, note: 'T사 신규 규격서 2026-09-14. 하프미트 250g 과 같고 파살:플레이크 비율만 4:6 으로 변경. 賞味期限은 하프미트(2年) 준용 가정' }
};

// ---------- 바이어 ----------
LC.buyers = [
  { code: 'U사', country: 'JP', port: '사카이미나토', spec_form: '商品規格書', cert: '요청 시(비협약국 양식)' },
  { code: 'T사', country: 'JP', port: '사카이미나토', spec_form: '原材料規格書·製造工程表', cert: '요청 시' },
  { code: 'S사', country: 'JP', port: '요나고', spec_form: '修正表示案(라벨 지시서)', cert: '요청 시' }
];

// ---------- 홍콩 라벨 (실제 파일 홍콩_LABEL_CNEN_11.1.xlsx, B-裂肉 시트에서 추출) ----------
LC.sampleLabels = {
  HK: {
    file: '홍콩_LABEL_CNEN_11.1.xlsx', country: 'HK', made: null,
    fields: {
      name: '冷凍雪蟹肉棒裂肉 / FROZEN COOKED RED SNOW CRAB LEG BROKEN MEAT',
      ingredients: '雪蟹 Snow crab、食鹽 salt／山梨醇 Sorbitol、調味料（胺基酸）Seasoning (aminoic acid)、增稠劑 Thickening agent (GUAR GUM)、(一部分包含蟹 some including crab)',
      net: '250克, GRAM',
      mfg: '生產日期 / Date of Manufacture YYYY.MM.DD',
      expiry: '有効日期 / Expiration date YYYY.MM.DD',
      storage: '冷凍-18度以下保存, Freeze below -18 degrees',
      origin: '原産地 韓國, REPUBLIC OF KOREA',
      importer: 'AMAZING FINE FOOD LIMITED / RM 1015, 10/F, TSUEN WAN ... HONG KONG / 23669308',
      manufacturer: '',
      allergen: '※本產品部分含有小麥，大豆，雞肉，不適合其過敏者 / This product contains wheat, soy, chicken',
      nutrition: ''
    }
  },
  TW: {
    file: '대만_260115_TAIWAN-LABEL_REV3.xlsx', country: 'TW', made: '2026-01-15',
    fields: {
      name: '冷凍調製紅雪蟹碎肉', ingredients: '紅雪蟹、食鹽、D-山梨醇（甜味劑）、L-麩酸鈉（調味劑）、關華豆膠',
      net: '250克', mfg: '製造日期 YYYY.MM.DD', expiry: '有効期限 YYYY.MM.DD', storage: '冷凍-18℃以下保存',
      origin: '産地 韓國', importer: '福溢水產有限公司 / 台中市南屯區... / 04-23823397', manufacturer: '',
      allergen: '本產品含有螃蟹，不適合對其過敏體質者食用',
      nutrition: '熱量38.2大卡 蛋白質7.9 脂肪0.2 飽和脂肪0.18 反式脂肪0 碳水化合物1.2 糖0 鈉220毫克'
    }
  },
  TH: {
    file: '태국_2025_LB_라벨.xlsx', country: 'TH', made: '2025-06',
    fields: {
      name: 'คุก เรด สโนว์ แครป เลก โบรคเคน มีท / COOKED RED SNOW CRAB LEG BROKEN MEAT',
      ingredients: 'เนื้อขาปูหิมะสีแดง 80.00% น้ำ 17.00% เกลือ 0.60% วัตถุปรุงแต่งรสอาหาร (มอโนโซเดียมแอล-กลูทาเมต) วัตถุที่ให้ความหวานแทนน้ำตาล (ซอร์บิทอล) วัตถุเจือปนอาหาร (INS 412)',
      net: '250 กรัม', mfg: 'PRODUCTION DATE', expiry: 'วันหมดอายุ (EXP) / BEST BEFORE', storage: '< -18°C',
      origin: 'ประเทศ สาธารณรัฐเกาหลี', importer: 'JALUX ASIA LTD. / 02-258-6531', manufacturer: 'ผู้ผลิต : บริษัท เซอุง ฟิชเชอรี จำกัด',
      allergen: '', nutrition: '', fda_no: '10-3-00445-5-1408'
    }
  },
  JP: {
    file: '일본_T사_하프미트_1kg_라벨.xlsx', country: 'JP', made: '2019-04-02',
    fields: {
      name: '冷凍紅ズワイガニムキ身', ingredients: '紅ズワイガニ(韓国)､食塩／甘味料(ソルビトール)､酸味料､調味料(アミノ酸)､酸化防止剤(ビタミンＣ)',
      net: '７００ｇ（総重量：１ｋｇ）', mfg: '', expiry: '賞味期限', storage: '要冷凍（－18℃以下で保存）',
      origin: '原産国名 韓国', importer: '友田セーリング株式会社 / 鳥取県境港市', manufacturer: '',
      allergen: '(원재료명에 かに 포함)', nutrition: 'エネルギー76kcal たんぱく質16.7g 脂質0.7g 炭水化物0.7g 食塩相当量2.1g 推定値', pack: 'トレー：PP 袋：PE，PA (마크 유무는 엑셀 원고로 확인 불가)'
    }
  },
  JP_U: {
    file: 'U사_LB_1kg_실물라벨.jpg', country: 'JP', made: '2026',
    fields: {
      name: '紅ずわいがにむき身', ingredients: '紅ずわいがに（韓国）、食塩、デキストリン／トレハロース、調味料（アミノ酸等）',
      net: '1キログラム', mfg: '', expiry: '賞味期限 2028.10.01', storage: '要冷凍（－18℃以下）',
      origin: '原産国名 韓国', importer: 'U사 (境港)', manufacturer: '',
      allergen: '', nutrition: 'エネルギー40kcal たんぱく質8.3g 脂質0.4g 炭水化物0.9g 食塩相当量0.6g (推定値)', pack: 'プラ トレー:PP 内装袋:PE,PA (실물 사진에 マーク 있음)'
    }
  },
  JP_S: {
    file: 'S사_棒肉_1kg_표시안.xlsx', country: 'JP', made: '2021-06-10',
    fields: {
      name: '紅ずわいがに加工品', ingredients: '紅ずわいがに（韓国産）、食塩／調味料（アミノ酸等）、（一部にかにを含む）',
      net: '1キログラム', mfg: '', expiry: 'YYYY.MM/製造ロット/工場記号', storage: '－18℃以下で保存してください',
      origin: '原産国名 韓国', importer: 'S사 (米子)', manufacturer: '',
      allergen: '（一部にかにを含む）', nutrition: 'エネルギー42kcal たんぱく質9.2g 脂質0.2g 炭水化物0.4g 食塩相当量1.6g (目安)', pack: '袋 トレー (표시안에 역할명만, 마크 그림 여부 미확인)'
    }
  }
};

// ---------- 규칙 파일 ----------
function has(s, re) { return !!(s && re.test(s)); }

LC.rules = {
  HK: {
    name: '홍콩', short: 'Cap.132W', law: 'Cap.132W 식품및药物(成分組合及標籤)規例', effective: '2010-07-01', lang: '중문 또는 영문',
    required: ['품명', '성분표(함량순)', '첨가물 기능분류+명칭/INS', '알레르겐(8종)', '영양표시 1+7', '유통기한 규정문구', '내용량', '보존방법', '제조자 또는 포장자 이름·주소', '원산지'],
    checks: [
      { id: 'nutrition', item: '영양표시 1+7', run: function (f) {
        if (!f.nutrition) return { status: 'fix', msg: '영양표시 없음. 홍콩은 열량 + 단백질·총지방·포화지방·트랜스지방·탄수화물·당·나트륨 7종 의무', fix: '품목 영양값으로 1+7 표 생성 (연 3만 개 이하 소량 면제는 별도 신청)' };
        return { status: 'pass', msg: '영양표시 있음' }; } },
      { id: 'allergen', item: '알레르겐', run: function (f) {
        var bad = /小麥|大豆|雞肉|wheat|soy|chicken/i.test(f.allergen) && !/小麥|大豆|雞肉|wheat|soy|chicken/i.test(f.ingredients);
        var crab = /蟹|crab/i.test(f.ingredients);
        if (bad) return { status: 'fix', msg: '성분에 없는 밀·대두·닭고기를 알레르겐으로 선언 (다른 제품 문구 복사)', fix: crab ? '含甲殼類動物（蟹）/ Contains crustacea (crab)' : '성분 기준으로 재작성' };
        if (crab && !/甲殼|crustacea|蟹/i.test(f.allergen)) return { status: 'fix', msg: '갑각류 미선언', fix: '含甲殼類動物（蟹）/ Contains crustacea (crab)' };
        return { status: 'pass', msg: '알레르겐 선언 적정' }; } },
      { id: 'additive', item: '첨가물 표기', run: function (f) {
        var probs = [];
        if (/調味料（胺基酸）|調味料\(胺基酸\)|aminoic/i.test(f.ingredients)) probs.push('調味料（胺基酸）→ 增味劑(621) / flavour enhancer (621)');
        if (/山梨醇/.test(f.ingredients) && !/甜味劑/.test(f.ingredients)) probs.push('山梨醇 → 甜味劑(420) / sweetener (sorbitol)');
        if (/增稠劑/.test(f.ingredients) && !/412/.test(f.ingredients)) probs.push('增稠劑(GUAR GUM) → 增稠劑(412) / thickener (guar gum)');
        if (probs.length) return { status: 'fix', msg: '첨가물은 기능분류 + 명칭 또는 INS 번호. 일본식 직역 흔적', fix: probs.join(' · ') };
        return { status: 'pass', msg: '첨가물 표기 적정' }; } },
      { id: 'expiry', item: '유통기한 문구', run: function (f) {
        if (/此日期前最佳|此日期前食用|best before|use by/i.test(f.expiry)) return { status: 'pass', msg: '규정 문구' };
        return { status: 'fix', msg: '"有効日期 / Expiration date"는 규정 문구 아님 (有効는 일본 한자)', fix: '此日期前最佳 / Best before, 날짜는 일·월·년 또는 순서 명시' }; } },
      { id: 'maker', item: '제조자·포장자 이름·주소', run: function (f) {
        if (f.manufacturer) return { status: 'pass', msg: '제조자 기재' };
        return { status: 'check', msg: '수입자만 기재. 홍콩은 제조자 또는 포장자 이름·주소 요구, 수입품은 현지 유통자로 대체 가능 조건 확인', fix: '제조자 A사 주소 추가 또는 대체 조건 확인' }; } },
      { id: 'kanji', item: '한자 표기', run: function (f) {
        var all = Object.values(f).join(' ');
        if (/原産|有効/.test(all)) return { status: 'check', msg: '일본 한자(原産·有効) 사용', fix: '原產地 · 有效' };
        return { status: 'pass', msg: '번체 한자' }; } },
      { id: 'basic', item: '품명·내용량·보존·원산지', run: function (f) {
        var miss = ['name', 'net', 'storage', 'origin'].filter(function (k) { return !f[k]; });
        return miss.length ? { status: 'fix', msg: '누락: ' + miss.join(', ') } : { status: 'pass', msg: '기재됨' }; } }
    ]
  },
  TW: {
    name: '대만', short: '식품안전위생관리법 22조', law: '식품안전위생관리법 22조 (포장식품 표시 10항목)', effective: '2019-01-01', lang: '번체 중문',
    required: ['품명', '내용물(함량 내림차순)', '첨가물 기능+명칭', '淨重', '製造日期·有效日期', '보존방법', '原產地', '수입업자 명·전화·주소', '영양 8항목', '알레르겐(11종) 螃蟹'],
    checks: [
      { id: 'nutrition', item: '영양 8항목', run: function (f) { return f.nutrition && /反式|糖/.test(f.nutrition) ? { status: 'pass', msg: '8항목 있음' } : { status: 'fix', msg: '열량·단백질·지방·포화지방·반식지방·탄수화물·당·나트륨 8항목 필요', fix: '품목 영양값으로 생성' }; } },
      { id: 'allergen', item: '알레르겐', run: function (f) { return /螃蟹|甲殼/.test(f.allergen) ? { status: 'pass', msg: '螃蟹 선언' } : { status: 'fix', msg: '갑각류 미선언', fix: '本產品含有螃蟹，不適合對其過敏體質者食用' }; } },
      { id: 'additive', item: '첨가물 기능+명칭', run: function (f) { return /（甜味劑）|（調味劑）|\(甜味劑\)/.test(f.ingredients) ? { status: 'pass', msg: '기능 분류 병기' } : { status: 'fix', msg: '첨가물에 용도 명칭 병기 필요', fix: 'D-山梨醇（甜味劑）、L-麩酸鈉（調味劑）' }; } },
      { id: 'kanji', item: '한자 표기', run: function (f) { var all = Object.values(f).join(' '); return /産地|有効/.test(all) ? { status: 'check', msg: '일본 한자(産·有効)', fix: '產地 · 有效期限' } : { status: 'pass', msg: '번체 한자' }; } },
      { id: 'importer', item: '수입업자 명·전화·주소', run: function (f) { return /\d{2}-\d{7,8}/.test(f.importer) ? { status: 'pass', msg: '기재됨' } : { status: 'fix', msg: '전화 누락' }; } },
      { id: 'basic', item: '품명·淨重·보존·原產地', run: function (f) { var miss = ['name', 'net', 'storage', 'origin'].filter(function (k) { return !f[k]; }); return miss.length ? { status: 'fix', msg: '누락: ' + miss.join(', ') } : { status: 'pass', msg: '기재됨' }; } }
    ]
  },
  TH: {
    name: '태국', short: '보건부 고시 450호', law: '보건부 고시 450호 (포장식품 표시), 367호 대체', effective: '2024-07-19', grace_end: '2026-07-19', lang: '태국어',
    required: ['품명', '식품등록번호 13자리', '제조자·수입자', '원재료 %', '첨가물 기능+명칭/INS', '알레르겐 정보', '내용량', '제조일·유통기한', '보존방법'],
    checks: [
      { id: 'allergen', item: '알레르겐 정보', run: function (f) { return /ข้อมูลสำหรับผู้แพ้อาหาร|แพ้/.test(f.allergen) ? { status: 'pass', msg: '알레르겐 줄 있음' } : { status: 'fix', msg: '450호 알레르겐 정보 줄 없음', fix: 'ข้อมูลสำหรับผู้แพ้อาหาร : มี ปู (갑각류)' }; } },
      { id: 'fda', item: '식품등록번호', run: function (f) { return /\d{2}-\d-\d{5}-\d-\d{4}/.test(f.fda_no || '') ? { status: 'pass', msg: f.fda_no } : { status: 'fix', msg: '13자리 등록번호 누락' }; } },
      { id: 'pct', item: '원재료 %', run: function (f) { return /%/.test(f.ingredients) ? { status: 'pass', msg: '함량 % 기재' } : { status: 'fix', msg: '주요 원재료 % 필요' }; } },
      { id: 'additive', item: '첨가물 INS', run: function (f) { return /INS/.test(f.ingredients) ? { status: 'pass', msg: 'INS 기재' } : { status: 'check', msg: 'INS 번호 확인' }; } },
      { id: 'maker', item: '제조자·수입자', run: function (f) { return f.manufacturer && f.importer ? { status: 'pass', msg: '기재됨' } : { status: 'fix', msg: '제조자 또는 수입자 누락' }; } },
      { id: 'nutrition', item: '영양표시', run: function () { return { status: 'pass', msg: '이 품목은 의무 아님 (영양 강조 없음)' }; } }
    ]
  },
  JP: {
    name: '일본', short: '식품표시기준', law: '식품표시법·식품표시기준 (가공식품 수입품)', effective: '2020-04-01', lang: '일본어',
    required: ['名称', '原材料名(첨가물 ／구분)', '内容量', '賞味期限', '保存方法', '原産国名', '輸入者', '영양 5항목', '아레르겐 특정원재료(かに)'],
    checks: [
      { id: 'nutrition', item: '영양 5항목', run: function (f) { return /食塩相当量/.test(f.nutrition) ? { status: 'pass', msg: '5항목 + 식염상당량' } : { status: 'fix', msg: '熱量·たんぱく質·脂質·炭水化物·食塩相当量 필요' }; } },
      { id: 'additive', item: '첨가물 ／구분', run: function (f) { return /[／/]/.test(f.ingredients) ? { status: 'pass', msg: '／로 첨가물 구분' } : { status: 'fix', msg: '원재료와 첨가물 사이 ／ 필요' }; } },
      { id: 'allergen', item: '특정원재료', run: function (f) { return /かに|がに|カニ|蟹/.test(f.ingredients + f.allergen) ? { status: 'pass', msg: 'かに 표기' } : { status: 'fix', msg: 'かに 특정원재료 표기 필요' }; } },
      { id: 'importer', item: '輸入者', run: function (f) { return f.importer ? { status: 'pass', msg: '기재됨' } : { status: 'fix', msg: '輸入者 누락' }; } },
      { id: 'basic', item: '名称·内容量·保存·原産国', run: function (f) { var miss = ['name', 'net', 'storage', 'origin'].filter(function (k) { return !f[k]; }); return miss.length ? { status: 'fix', msg: '누락: ' + miss.join(', ') } : { status: 'pass', msg: '기재됨' }; } },
      // 容器包装 識別表示: 플라스틱·종이 용기포장은 식별마크(プラ·紙)가 법정 의무. 수입품도 수입자가 소재·구조·상표를 지시했거나 일본어 표시가 있으면 대상(Q22). 의무자는 용기 제조자와 제조를 발주한 사업자(Q30)
      { id: 'pack_mark', item: '容器包装 識別表示(プラ)', src: '資源有効利用促進法 識別表示 · 経産省 Q&A 1.1.1(대상), Q22(수입품), Q30(의무자), 2.3.1(一括表示)',
        run: function (f) {
          var t = String(f.pack || '');
          if (/プラ|紙マーク|識別/.test(t)) return { status: 'pass', msg: '식별마크 + 역할명·재질 일괄표시: ' + t };
          if (/PP|PE|PA|PET|トレー|袋/.test(t)) return { status: 'check', msg: '재질·역할명은 있으나 プラ 식별마크 확인 필요(마크는 그림이라 사진에서 눈으로 확인)', fix: 'プラ 마크 + 役割名(トレー·袋)·재질을 한곳에 一括表示' };
          return { status: 'check', msg: '포장 식별표시 정보 없음. 플라스틱 트레이·봉투면 プラ 마크 의무(수입품도 대상)', fix: 'プラ 마크와 トレー:PP／袋:PE,PA 같은 일괄표시 추가' };
        } }
    ]
  },
  CN: {
    name: '중국', short: 'GB 7718-2025', law: 'GB 7718-2025 食品安全国家标准 预包装食品标签通则 (2025-03-16 발포, 2027-03-16 시행)', effective: '2027-03-16', lang: '중문(简体, 规范汉字)',
    note: '시행 전. 2027-03-16 이전 생산분은 GB 7718-2011 적용. 수입식품은 제4장(4.9·4.10 제외)+제8장 동시 적용(8.1.3). 조항 번호는 원문 전문(국가위건위·시장감관총국 발포본) 기준',
    required: ['중문 라벨(8.1.2)', '食品名称(4.2)', '配料表(4.3)', '营养标签(4.13→GB 28050)', '净含量(4.5)', '进口商/代理商 + 在华注册编号(8.3)', '生产日期·保质期到期日(4.7/8.5)', '贮存条件(4.8)', '原产国(8.4)', '致敏物质 提示(4.12)'],
    checks: [
      { id: 'cn_label', item: '중문 라벨', src: 'GB 7718-2025 8.1.2', run: function (f) {
        var has = /[\u4e00-\u9fff]/.test((f.name || '') + (f.ingredients || ''));
        return has ? { status: 'pass', msg: '중문 표시 있음. 강제 표시 항목은 중외문 1:1 대응(8.1.2)' } : { status: 'fix', msg: '인쇄 또는 加贴 중문 라벨 필요. 강제 항목은 중외문 1:1 대응', fix: '중문 라벨 작성(8.1.2)' }; } },
      { id: 'ingredients', item: '配料表', src: 'GB 7718-2025 4.3.1·4.3.2·8.2', run: function (f) {
        if (!f.ingredients) return { status: 'fix', msg: '配料表 없음. 引导词와 함께 가입량 내림차순(2% 이하 예외)', fix: '配料：…' };
        return /配料/.test(f.ingredients) ? { status: 'pass', msg: '引导词 있음. 내림차순 여부는 배합비로 확인' } : { status: 'check', msg: '引导词 “配料” 표기와 가입량 내림차순 확인(4.3.1·4.3.2). 외문 配料表 내용은 중문에 전부 대응(8.2)' }; } },
      { id: 'additive', item: '식품첨가물 명칭', src: 'GB 7718-2025 4.3.4·4.3.4.2·4.3.4.3', run: function (f) {
        var bare = /(^|[、,，\s(（])\d{3}([)）、,，\s]|$)/.test(f.ingredients || '');
        if (bare) return { status: 'check', msg: 'INS 번호 단독 표기는 통용명칭+功能类别 병기 시 최대 표면적 60cm² 이하 포장에서만 허용(4.3.4.3)', fix: 'GB 2760 통용명칭으로 표기 (예: 山梨糖醇、谷氨酸钠、瓜尔胶)' };
        return { status: 'pass', msg: 'GB 2760 통용명칭 또는 功能类别+통용명칭(附录B) 중 한 형식만 사용(4.3.4.2)' }; } },
      { id: 'allergen', item: '致敏物质 提示', src: 'GB 7718-2025 4.12.1 b)·附录D', run: function (f) {
        var crab = /蟹|虾|甲壳/.test((f.ingredients || '') + (f.name || ''));
        if (!crab) return { status: 'pass', msg: '8종 致敏物质 해당 없음' };
        return /含有|致敏|过敏|甲壳纲/.test((f.allergen || '') + (f.ingredients || '')) ? { status: 'pass', msg: '甲壳纲类 提示 있음' } : { status: 'fix', msg: '甲壳纲类动物(蟹)은 8종 致敏物质. 配料表 안 강조 또는 配料表 临近位置 提示 필요(강제, 4.12.1)', fix: '致敏物质提示：含有甲壳纲类动物（蟹）— 형식은 附录D' }; } },
      { id: 'dates', item: '生产日期·保质期到期日', src: 'GB 7718-2025 4.7.1·4.7.2·8.5', run: function (f, p) {
        if (!f.expiry) return { status: 'fix', msg: '保质期到期日 필수. 年·月·日 순서(4.7.1)', fix: '保质期至：YYYY年MM月DD日' };
        var ymd = /^\s*\d{4}\s*[-./年]\s*\d{1,2}\s*[-./月]\s*\d{1,2}/.test(f.expiry);
        var long = p && p.shelf_months >= 6;
        if (!f.mfg && !long) return { status: 'fix', msg: '生产日期 + 保质期到期日 둘 다 표시(4.7.1). 보질기 6개월 미만은 생산일자 생략 불가', fix: '生产日期：YYYY年MM月DD日' };
        return ymd ? { status: 'pass', msg: (long ? '보질기 6개월 이상 → 保质期+到期日만으로 가능(4.7.1·8.5)' : '生产日期·到期日 年月日 순서') } : { status: 'check', msg: '날짜가 年·月·日 순서인지 확인(4.7.1). 가첩·보인·수정 금지' }; } },
      { id: 'net', item: '净含量', src: 'GB 7718-2025 4.5', run: function (f) { return f.net ? { status: 'pass', msg: '食品名称과 같은 展示版面에 표시' } : { status: 'fix', msg: '净含量 누락(4.5)', fix: '净含量：250 g' }; } },
      { id: 'storage', item: '贮存条件', src: 'GB 7718-2025 4.8', run: function (f) { return f.storage ? { status: 'pass', msg: '기재됨' } : { status: 'fix', msg: '贮存条件 누락(4.8)', fix: '贮存条件：-18℃以下冷冻保存' }; } },
      { id: 'origin', item: '原产国(地区)', src: 'GB 7718-2025 8.4', run: function (f) { return f.origin ? { status: 'pass', msg: '기재됨. 분장국이 다르면 병기(8.4)' } : { status: 'fix', msg: '原产国(地区) 누락(8.4)', fix: '原产国：韩国' }; } },
      { id: 'importer', item: '进口商/代理商·在华注册编号', src: 'GB 7718-2025 8.3·8.7', run: function (f) {
        if (!f.importer) return { status: 'fix', msg: '进口商 또는 代理商의 名称·地址·联系方式 필요(8.3)', fix: '进口商：… 地址：… 电话：…' };
        return f.manufacturer ? { status: 'pass', msg: '境外生产企业 在华注册编号(GACC) 포함. 生产许可证编号·产品标准代号는 수입식품 생략 가능(8.7)' } : { status: 'check', msg: '境外生产企业在华注册编号(GACC 등록번호) 표기 확인(8.3)' }; } },
      { id: 'nutrition', item: '营养标签', src: 'GB 7718-2025 4.13', run: function (f) { return f.nutrition ? { status: 'pass', msg: '표시 있음. 항목·형식은 GB 28050 기준(4.13)' } : { status: 'check', msg: '营养标签은 GB 28050(또는 GB 13432)에 따름(4.13). 해당 여부와 항목은 GB 28050에서 확인' }; } },
      { id: 'claims', item: '“不添加”·“无” 표현', src: 'GB 7718-2025 4.4.2.1·4.4.2.2', run: function (f) {
        var all = Object.keys(f).map(function (k) { return f[k] || ''; }).join(' ');
        if (/不添加|不使用|零添加/.test(all)) return { status: 'fix', msg: '“不添加”“不使用” 및 동의어 사용 금지(4.4.2.2)', fix: '해당 문구 삭제' };
        if (/无防腐剂|不含防腐剂|无添加剂|不含添加剂/.test(all)) return { status: 'fix', msg: '식품첨가물·오염물에 “无”“不含” 선언 금지(4.4.2.1)', fix: '해당 문구 삭제' };
        return { status: 'pass', msg: '금지 표현 없음' }; } }
    ]
  }
};

// 고시 개정 목록 (라벨 기준일 < 시행일 이면 재검토)
// ---------- 중국 영양성분표 (GB 28050-2025, 2025-03 발포·2027-03-16 시행) ----------
// 근거: 4.1 强制标示内容 = 能量·蛋白质·脂肪·饱和脂肪(或饱和脂肪酸)·碳水化合物·糖·钠 + NRV% ("1+6", 2011판은 1+4).
//       2.3 能量 환산계수 蛋白质 17 kJ/g·脂肪 37 kJ/g·碳水化合物 17 kJ/g. 성분표 아래 "儿童青少年应避免过量摄入盐油糖".
//       NRV% 는 附录A 표 수치를 원문으로 확인하지 못해 넣지 않음(확인 후 추가).
LC.nutritionCN = function (product) {
  var n = product && product.nutrition100;
  if (!n) return [['营养成分表', '성적서 필요']];
  var kj = Math.round(n.protein * 17 + n.fat * 37 + n.carb * 17);
  return [
    ['能量', kj + ' kJ (2.3 환산계수 기준. 성적서 ' + n.kcal + ' kcal ≈ ' + Math.round(n.kcal * 4.184) + ' kJ)'],
    ['蛋白质', n.protein + ' g'], ['脂肪', n.fat + ' g'], ['—饱和脂肪', (n.satfat == null ? '값 필요' : n.satfat + ' g')],
    ['碳水化合物', n.carb + ' g'], ['—糖', (n.sugar == null ? '값 필요' : n.sugar + ' g')], ['钠', n.sodium_mg + ' mg'],
    ['NRV%', '附录A 원문 확인 후 추가'], ['하단 문구', '儿童青少年应避免过量摄入盐油糖'],
    ['근거', 'GB 28050-2025 4.1 强制标示内容, 2.3 能量 (시행 2027-03-16, GB 28050-2011 대체)']
  ];
};

LC.revisions = [
  { country: 'TH', title: '태국 고시 450호 (367호 대체)', effective: '2024-07-19', note: '구 라벨 판매 유예 2026-07-18 종료(USDA 보고 기준). 알레르겐·첨가물 표기 강화' },
  { country: 'CN', title: '중국 GB 7718-2025 예포장식품 표시 통칙', effective: '2027-03-16', note: '영양·알레르겐·디지털 라벨. 중국 진출 시 적용' },
  { country: 'CN', title: '중국 GB 28050-2025 영양표시 통칙 (2011판 대체)', effective: '2027-03-16', note: '강제 표시 1+4 → 1+6 (饱和脂肪·糖 추가), 성분표 아래 "儿童青少年应避免过量摄入盐油糖" 문구. 4.1' },
  { country: 'JP', title: '일본 특정원재료 くるみ 추가', effective: '2025-04-01', note: '게 제품 영향 없음' },
  { country: 'ID', title: '인도네시아 할랄 수입식품 의무', effective: '2026-10-17', note: '수출국 아님, 정보' }
];

// 등록·인증 레지스트리
LC.registry = [
  { kind: '법정등록', name: '미국 FDA 식품시설등록 갱신', no: '등록됨 (번호 확인)', issuer: 'US FDA', expiry: '2026-12-31', lead: 30, countries: 'US', note: '짝수년 10~12월 갱신 창. 지금이 갱신 기간(담당자 확인: 등록되어 있음)' },
  { kind: '법정등록', name: 'EU 승인 작업장', no: 'KORP-091', issuer: '수품원 → EU', expiry: null, lead: 0, countries: 'EU/IT', note: '공개 목록. 정해진 만료일 없음(수품원 등록 유지 조건). 유지 심사 주기는 수품원에 확인' },
  { kind: '참고', name: '태국 라벨 기재 번호', no: 'KTH-134', issuer: 'Thai FDA', expiry: null, lead: 0, countries: 'TH', note: '라벨에 적힌 번호. 누구 명의인지(수입자/제조자) 확인 필요' },
  { kind: '참고', name: '태국 식품등록번호(수입자 명의)', no: '10-3-00445-5-1408', issuer: 'Thai FDA', expiry: null, lead: 0, countries: 'TH', note: '태국 수입자 허가번호 기반. A사가 관리하는 번호 아님, 바뀌면 라벨 재검토' },
  { kind: '법정등록', name: '중국 GACC 해외생산기업 등록', no: '등록됨 (번호·만료일 확인)', issuer: 'GACC', expiry: null, lead: 180, countries: 'CN', note: '수품원 수출공장등록 경유(담당자 확인). 5년 유효. 2026-06 시행 280호령부터 대부분 품목 자동 갱신. CIFER 공개 조회' },
  { kind: '법정등록', name: '수품원 수출공장등록 (베트남·태국)', no: '등록됨', issuer: '수품원', expiry: null, lead: 0, countries: 'VN TH', note: '협약국. 수출 시 해당국 양식 위생증명서 발급(담당자 확인)' },
  { kind: '법정인증', name: 'HACCP 적용업소 인증 (기타수산물가공품)', no: '제2009-4-8012호', issuer: '식약처 (식품위생법 48조)', expiry: '2029-01-22', lead: 90, countries: 'ALL', note: '유효 2026-01-23~2029-01-22. CCP 자숙·가열(농축)·금속검출. 최초 2009-08-07. 인증서 원본 기준' },
  { kind: '선적별', name: '위생증명서', no: '선적마다', issuer: '수품원', expiry: null, lead: 0, countries: 'TW TH HK JP?', note: '협약국은 해당국 양식. 일본은 국내 유통분은 불필요, 바이어 요청 시 비협약국 양식(담당자 확인). 2026-05 U사 선적은 발급받음' },
  { kind: '선적별', name: '야생동식물 수출허가서 (71-A)', no: '선적마다', issuer: '환경부/지방청', expiry: null, lead: 0, countries: 'JP', note: '게 미소·껍데기 품목' },
  { kind: '법정등록', name: '해외제조업소 등록 (수입, 식약처)', no: '제조소별 확인', issuer: '식약처', expiry: null, lead: 60, countries: 'KR(수입)', note: '유효 2년. 수입신고 전 등록 필수. 2026-10 홋카이도 건 제조소 K사 등 만료일 확인' }
];

// 원어 입고 로트 (축산 개체번호에 해당). 선박·공급처 마스킹
// ---------- 클레임 종류 → 꺼낼 기록. 껍질·이물은 손 공정(탈갑·채육·선별)이라 배가 아니라 그날 일지 ----------
LC.claimMap = [
  { kind: '껍질·힘줄·이물', records: '{mfg} 가공일지(탈갑·채육·선별 인원·시간, 결근 메모) · {mfg} 금속검출 CCP 기록 · 포장일지(포장 인원·능률)', raw: false },
  { kind: '선도·냄새·변색·흑변', records: '원료입고검사서(중심온도, 흑변 공제, 조업 기간) · {mfg} 가공일지 원료 약어', raw: true },
  { kind: '중량 부족·해동 수율', records: '포장일지({mfg} 생산분 C/T) · 규격서 중점관리(해동 중량 560g 이상, 수율 80%)', raw: false },
  { kind: '미생물', records: '{mfg} 자숙 CCP 기록 · 원료 월 1회 미생물 검사(입고검사서) · 바이어 위생기준(일반세균 1.0×10⁴ 이하)', raw: true }
];

// ---------- 영양값 출처 (100g 기준). 바이어마다 조미액이 달라 값이 다름. 자사 성적서는 LB가 아님 ----------
LC.nutritionSources = [
  { buyer: 'T사', product: 'LB·하프미트 (1kg)', kcal: 76, protein: 16.7, fat: 0.7, carb: 0.7, salt_g: 2.1, basis: '推定値 (바이어 제공)', src: 'T사 라벨 2019.4 작성, 2026.9 개정' },
  { buyer: 'U사', product: 'LB (1kg)', kcal: 40, protein: 8.3, fat: 0.4, carb: 0.9, salt_g: 0.6, basis: '推定値 (바이어 제공)', src: 'U사 실물 라벨 사진, 商品コード 379006' },
  { buyer: 'S사', product: '棒肉·精肉·フレーク (1kg)', kcal: 42, protein: 9.2, fat: 0.2, carb: 0.4, salt_g: 1.6, basis: '目安 (바이어 제공)', src: 'S사 수정표시안 2021.6' },
  { buyer: '자사 성적서', product: '홍게모둠살 (조미 전, LB 아님)', kcal: 68.3, protein: 15.1, fat: 0.7, carb: 0.4, salt_g: 0.25, basis: '실측 참고용 (2022-09-27)', src: '참고용 시험성적서. 나트륨 97.3mg → 식염상당량 환산' }
];

// ---------- 선적 (패킹리스트 기준, 단가·금액·계좌 제외) ----------
LC.shipmentsSeed = [
  { no: 'UE-2606', date: '2026-05-19', etd: '2026-05-20', buyer: '일본 바이어 U사', vessel: 'HONOR BRIGHT 2619E', route: '부산 → 사카이미나토', incoterms: 'CFR', hs: '1605.10',
    items: [ { desc: 'LEG(L)', ct: 75, kg: 900 }, { desc: 'LEG(M)', ct: 68, kg: 816 }, { desc: 'BROKEN(LB)', ct: 220, kg: 2640 }, { desc: 'BROKEN(SBF)', ct: 50, kg: 600 }, { desc: 'WHITE FLAKE', ct: 250, kg: 3000 }, { desc: 'BROKEN(FMB)', ct: 30, kg: 360 }, { desc: 'WHITE FLAKE塩', ct: 40, kg: 480 }, { desc: 'TEST SAMPLE (무상)', ct: 1, kg: 7.2 } ],
    total_ct: 734, total_kg: 8803.2, cert: '수품원 위생증명서 2026-05-20 (바이어 요청, 비협약국 양식)', note: '단가·금액·계좌 제외. 포장 12kg(1kg×12)' }
];

LC.rawLots = [
  { id: 'R-20260408-01', species: '붉은대게 (Chionoecetes japonicus)', caught: '2026-04-03~04-08', vessel: '삼○호', landing: '동해 연근해 (국내산)', received: '2026-04-08', kg: 17400, boxes_in: 638, boxes_ok: 580, note: '원료입고검사서 SW-S-양식17. 흑변·사이즈미달 공제 58상자. 가공일지 약어 "삼"' },
  { id: 'R-20260409-01', species: '붉은대게', caught: '', vessel: '구○호 (약어 "구")', landing: '동해 연근해', received: '2026-04-09', kg: 0, note: '가공일지 약어만 확인. 입고검사서 미수령' },
  { id: 'R-20260409-02', species: '붉은대게', caught: '', vessel: '대○호 (약어 "대")', landing: '동해 연근해', received: '2026-04-09', kg: 0, note: '가공일지 약어만 확인. 입고검사서 미수령' },
  { id: 'R-20260409-03', species: '붉은대게', caught: '', vessel: '화○호 (약어 "화")', landing: '동해 연근해', received: '2026-04-09', kg: 0, note: '가공일지 약어만 확인. 입고검사서 미수령' }
];

// 선적(원장) 시드 — 실제 TD-06 선적을 제조일 단위로 쪼갠 가정
LC.seedLedger = [
  { lot: '20260409-LB', company_code: 'I',  product: 'LB', mfg: '2026-04-09', expiry: '2028-04-01', qty_ct: 27,  kg: 324,  raw: ['R-20260409-01'], country: 'JP', buyer: '일본 바이어 U사', ship: 'UE-2606 / 2026-05-20 부산→사카이미나토', cert: '수품원 위생증명서 2026-05-20 (바이어 요청, 비협약국 양식)', spec_sent: '2026-05-19' },
  { lot: '20260410-LB', company_code: 'AJ', product: 'LB', mfg: '2026-04-10', expiry: '2028-04-01', qty_ct: 31, kg: 372, raw: ['R-20260408-01'], country: 'JP', buyer: '일본 바이어 U사', ship: 'UE-2606 / 2026-05-20 부산→사카이미나토', cert: '수품원 위생증명서 2026-05-20 (바이어 요청, 비협약국 양식)', spec_sent: '2026-05-19' },
  { lot: '20260410-WF', company_code: 'AJ', product: 'WF', mfg: '2026-04-10', expiry: '2028-04-01', qty_ct: 174, kg: 2088, raw: ['R-20260408-01'], country: 'JP', buyer: '일본 바이어 U사', ship: '', cert: '', spec_sent: '' },
  { lot: '20260413-LB', company_code: 'AC', product: 'LB', mfg: '2026-04-13', expiry: '2028-04-01', qty_ct: 29,  kg: 348,  raw: ['R-20260409-02'], country: 'JP', buyer: '일본 바이어 U사', ship: '미선적 (재고)', cert: '', spec_sent: '' },
  { lot: '20260414-LB', company_code: 'AD', product: 'LB', mfg: '2026-04-14', expiry: '2028-04-01', qty_ct: 19,  kg: 228,  raw: ['R-20260409-02'], country: 'JP', buyer: '일본 바이어 U사', ship: '미선적 (재고)', cert: '', spec_sent: '' }
];

if (typeof module !== 'undefined') module.exports = LC;
