// 라벨코스트 — 읽기부 추출 결과(미리 읽어 둔 값). API 키 연결 시 agent/graph.py extract 노드가 같은 {k, v} 형태로 만든다.
// 회사 서류 13건(수출 9 + 수입 4)을 사람이 읽어 칸으로 옮긴 것. 회사 'A사', 바이어 'U사·T사·S사', 선박 '삼○호' 식으로 가림.
// 대조·반영 로직은 여기 없다. apply.js 의 LC.reconcileDoc / LC.applyDoc 에 서류 종류와 칸 값만 넘긴다.
var LC = (typeof LC !== 'undefined') ? LC : {};

(function () {
  LC.extractFixtures = [
    // 수입 서류 4건 (NCSEW26004, 홋카이도 → 부산). 수출 서류보다 앞에 둔다: '인보이스_패킹리스트_NCSEW…' 가 수출 패킹리스트 패턴에 먼저 걸리지 않게
    { id: 'imp-inv', match: /NCSEW26004.*인보이스|인보이스_패킹리스트_NCSEW/i, doc_type: '수입인보이스', sensitive: true, source: '인보이스_패킹리스트_NCSEW26004.pdf (2026-09-15)',
      fields: [
        { k: 'invoice_no', label: '인보이스 번호', v: 'NCSEW26004', src: 'p1 INVOICE NO' },
        { k: 'date', label: '날짜', v: '2026-09-15', src: 'p1 DATE' },
        { k: 'exporter', label: '수출자', v: 'N사(삿포로)', src: 'p1 상단' },
        { k: 'importer', label: '수입자', v: 'A사 수입 법인', src: 'p1 SOLD TO' },
        { k: 'from', label: '선적항', v: '이시카리', src: 'p1 SHIPPED FROM' },
        { k: 'to', label: '도착항', v: '부산', src: 'p1 SHIPPED TO' },
        { k: 'vessel', label: '선박', v: 'STAR SKIPPER 2618W', src: 'p1 SHIPPED PER' },
        { k: 'items', label: '품목', v: [
          { desc: 'FROZEN SCALLOP MEAT 3S (가리비 조갯살)', ct: 49, kg: 490, packer: 'K사(왓카나이)' },
          { desc: 'FROZEN STEAMED SCALLOP L (자숙 가리비)', ct: 500, packs: 5000 },
          { desc: 'FROZEN STEAMED SCALLOP M (자숙 가리비)', ct: 300, packs: 3000 },
          { desc: 'FROZEN BOILED KING CRAB LEG MEAT (대게 다리살, 샘플 무상)', ct: 1, packs: 10 },
          { desc: 'FROZEN SCALLOP MEAT 300g (조갯살, 샘플 무상)', ct: 1, packs: 10 } ], src: 'p1 표' },
        { k: 'total_ct', label: '합계 C/T', v: 851, src: 'p1 TOTAL' },
        { k: 'incoterms', label: '조건', v: 'CFR BUSAN', src: 'p1 하단' },
        { k: 'source', label: '파일', v: '인보이스_패킹리스트_NCSEW26004.pdf', src: '-' }
      ] },
    { id: 'imp-bl', match: /선하증권|KMTCISI/i, doc_type: 'BL', sensitive: false, source: '선하증권_BL_KMTCISI0269980.pdf (2026-10-09)',
      fields: [
        { k: 'bl_no', label: 'B/L 번호', v: 'KMTCISI0269980', src: 'p1 B/L No.' },
        { k: 'carrier', label: '선사', v: 'KMTC', src: 'p1 양식' },
        { k: 'vessel', label: '선박', v: 'STAR SKIPPER', src: 'p1 Vessel' },
        { k: 'voyage', label: '항차', v: '2618W', src: 'p1 Voy. No.' },
        { k: 'pol', label: '선적항', v: '이시카리', src: 'p1 Port of Loading' },
        { k: 'pod', label: '양하항', v: '부산', src: 'p1 Port of Discharge' },
        { k: 'containers', label: '컨테이너', v: '리퍼 20ft ×1 (FBIU7530248)', src: 'p1 Container No.' },
        { k: 'cartons', label: '수량 C/T', v: 851, src: 'p1 851 CARTONS' },
        { k: 'net_kg', label: '순중량 kg', v: 6895, src: 'p1 NET WEIGHT' },
        { k: 'issued', label: '발행', v: '2026-10-09', src: 'p1 Place and Date of Issue (도쿄)' },
        { k: 'shipment_no', label: '수입 건', v: 'NCSEW26004', src: '인보이스와 대조' },
        { k: 'source', label: '파일', v: '선하증권_BL_KMTCISI0269980.pdf', src: '-' }
      ] },
    { id: 'imp-decl', match: /Declaration|수출신고_Declaration/i, doc_type: '수입신고서', sensitive: false, source: '수출신고_Declaration_NCSEW26004.pdf (일본 정부 신고서 12쪽 중 1장)',
      fields: [
        { k: 'declaration_no', label: '신고 번호', v: 'NS0161KR1377', src: 'p1 Declaration Number' },
        { k: 'consignment_code', label: '수입 건', v: 'NCSEW26004', src: 'p1 Consignment Code' },
        { k: 'product', label: '제품', v: 'FROZEN SCALLOP MEAT', src: 'p1 Product' },
        { k: 'packages', label: '포장', v: '49 c/t', src: 'p1 Number and type of package' },
        { k: 'net_kg', label: '순중량 kg', v: 490, src: 'p1 Net' },
        { k: 'establishment', label: '제조소', v: 'K사(왓카나이)', src: 'p1 establishment' },
        { k: 'embarkation', label: '선적지', v: '이시카리', src: 'p1 embarked at' },
        { k: 'date_embark', label: '선적일', v: '2026-10-09', src: 'p1 date of embarkation' },
        { k: 'sampled', label: '시료 채취', v: '2026-09-25', src: 'p1 sampled on' },
        { k: 'analyzed', label: '분석일', v: '2026-09-28', src: 'p1 laboratory analysis on' },
        { k: 'lab', label: '분석 기관', v: '홋카이도 약제사회 공중위생검사센터', src: 'p1 name of laboratory' },
        { k: 'report_no', label: '분석 보고서', v: '26-07496', src: 'p1 Report number' },
        { k: 'issued', label: '발급', v: '2026-10-08 홋카이도 농정사무소(MAFF)', src: 'p1 Done at' },
        { k: 'prefecture_flag', label: '도현 구분', v: '방사능 검사 필요 17개 도현(홋카이도 포함)에 해당 체크', src: 'p1 체크박스 3번째' },
        { k: 'source', label: '파일', v: '수출신고_Declaration_NCSEW26004.pdf', src: '-' }
      ] },
    { id: 'imp-dhl', match: /DHL|운송장/i, doc_type: '운송장', sensitive: false, source: 'DHL_운송장.pdf (2026-10-09)',
      fields: [
        { k: 'waybill', label: '운송장 번호', v: '8941050963', src: 'p1 WAYBILL' },
        { k: 'from', label: '보낸 곳', v: 'N사(삿포로)', src: 'p1 From' },
        { k: 'to', label: '받는 곳', v: '부산 관세사', src: 'p1 To' },
        { k: 'contents', label: '내용물', v: 'Bill of lading', src: 'p1 Contents' },
        { k: 'shipped', label: '발송', v: '2026-10-09', src: 'p1 Shipment Date' },
        { k: 'eta', label: '도착 예정', v: '2026-10-12', src: 'p2 Estimated Del date' }
      ] },

    // 1. 원료입고검사서
    { id: '7-1', match: /^7-1\./i, doc_type: '입고검사서', sensitive: false, source: '7-1.원료입고검사서.pdf (SW-S-양식17, 2026-04-08)',
      fields: [
        { k: 'species', label: '원료명', v: '붉은대게 (Chionoecetes japonicus)', src: 'p1 원료명' },
        { k: 'fishing_period', label: '조업일자', v: '2026-04-03 ~ 04-08', src: 'p1 조업일자' },
        { k: 'received', label: '입고일', v: '2026-04-08', src: 'p1 입고일' },
        { k: 'vessel', label: '공급자(어선)', v: '삼○호', src: 'p1 공급자' },
        { k: 'landing', label: '원산지', v: '국내산 (동해 연근해)', src: 'p1 원산지' },
        { k: 'boxes_in', label: '입고 상자', v: 638, src: 'p1 3.원료판정 입고량' },
        { k: 'boxes_ok', label: '판정 상자', v: 580, src: 'p1 3.원료판정 판정수량' },
        { k: 'deduct', label: '공제 상자', v: 58, src: 'p1 비고 (흑변 26 + 기본공제 5% 32)' },
        { k: 'total_kg', label: '총중량 kg', v: 17400, src: 'p1 3.원료판정 총중량' },
        { k: 'core_temp', label: '중심온도 기준', v: '10℃ 이하 (5회 측정 양호)', src: 'p1 1.입고 검수 기준' },
        { k: 'black', label: '흑변 공제', v: '26상자', src: 'p1 비고' }
      ] },

    // 2. 가공일지
    { id: '7-2', match: /^7-2\./i, doc_type: '가공일지', sensitive: false, source: '7-2.가공일지.pdf (2026-04-10 금)',
      fields: [
        { k: 'date', label: '날짜', v: '2026-04-10', src: 'p1 상단' },
        { k: 'raw_sources', label: '다리 작업 원료 약어(순서대로)', v: ['삼', '삼', '구', '대', '화', '삼', '대', '삼', '구', '대', '화', '대'], src: 'p1 금일 작업 · 다리' },
        { k: 'products_made', label: '만든 품목', v: ['LB', 'WF', 'L/M/S 다리', '혼합', '큐브', '집게'], src: 'p1 금일 작업 열 제목' },
        { k: 'headcount', label: '공정별 인원·시간', v: '채육 7.5 · 선별 73 · 계량 40 · 입상 43 · 포장 88.5 (시간×인)', src: 'p1 작업시간(H×인)' },
        { k: 'notes', label: '특이사항', v: '결근 3명 · 조퇴 메모 있음', src: 'p1 하단 특이사항' }
      ] },

    // 3. 포장일지
    { id: '7-3', match: /^7-3\./i, doc_type: '포장일지', sensitive: false, source: '7-3.포장 일지.pdf (2026-04-15 수)',
      fields: [
        { k: 'date', label: '날짜', v: '2026-04-15', src: 'p1 상단' },
        { k: 'rows', label: '포장 행 (U사 LB만)', v: [
          { buyer: 'U사', product: 'WF', ct: 174, mfg: '2026-04-10', expiry: '2028-04-01', lot_code: 'AJ' },
          { buyer: 'U사', product: 'LB', ct: 27, mfg: '2026-04-09', expiry: '2028-04-01', lot_code: 'I' },
          { buyer: 'U사', product: 'LB', ct: 31, mfg: '2026-04-10', expiry: '2028-04-01', lot_code: 'AJ' },
          { buyer: 'U사', product: 'LB', ct: 29, mfg: '2026-04-13', expiry: '2028-04-01', lot_code: 'AC' },
          { buyer: 'U사', product: 'LB', ct: 19, mfg: '2026-04-14', expiry: '2028-04-01', lot_code: 'AD' }
        ], src: 'p1 제품 포장 현황 표 (규격 12kg = 1kg×12p, 진공 포장)' },
        { k: 'lot_rule', label: '로트 규칙', v: '생산일 기준 글자 코드 (담당자 확인)', src: '추가질문 답변 1·2' }
      ] },

    // 4. 패킹리스트 (계좌·단가 가린 뒤 처리)
    { id: '5-2', match: /^5-2\./i, doc_type: '패킹리스트', sensitive: true, source: '5-2.패킹리스트.png (UE-2606, 2026-05-19)',
      fields: [
        { k: 'invoice_no', label: '선적번호', v: 'UE-2606', src: '우상단 INVOICE NO' },
        { k: 'date', label: '날짜', v: '2026-05-19', src: '우상단 DATE' },
        { k: 'departure', label: '출항', v: '2026-05-20', src: 'DEPARTURE DATE' },
        { k: 'vessel', label: '선박', v: 'HONOR BRIGHT 2619E', src: 'VESSEL/FLIGHT' },
        { k: 'route', label: '구간', v: '부산 → 사카이미나토', src: 'FROM / TO' },
        { k: 'buyer', label: '바이어', v: 'U사', src: 'CONSIGNEE' },
        { k: 'items', label: '품목', v: [
          { desc: 'LEG(L)', ct: 75, kg: 900 }, { desc: 'LEG(M)', ct: 68, kg: 816 }, { desc: 'BROKEN(LB)', ct: 220, kg: 2640 }, { desc: 'BROKEN(SBF)', ct: 50, kg: 600 },
          { desc: 'WHITE FLAKE', ct: 250, kg: 3000 }, { desc: 'BROKEN(FMB)', ct: 30, kg: 360 }, { desc: 'WHITE FLAKE塩', ct: 40, kg: 480 }, { desc: '샘플(무상)', ct: 1, kg: 7.2 }
        ], src: '본문 표 (규격 12kg = 1kg×12)' },
        { k: 'total_ct', label: '합계 C/T', v: 734, src: 'G-TOTAL' },
        { k: 'total_kg', label: '합계 kg', v: 8803.2, src: 'G-TOTAL' },
        { k: 'hs', label: 'HS', v: '1605.10', src: '좌하단' },
        { k: 'linked_lot_codes', label: '연결할 회사 LOT', v: ['I', 'AJ'], src: '가정 (포장일지 LB 생산분 중 선적 전 로트)' },
        { k: 'note', label: '비고', v: '어느 로트가 실렸는지는 포장일지만으로 단정 못 함. I·AJ 는 가정', src: '-' }
      ] },

    // 5. 위생증명서
    { id: '6', match: /^6\./i, doc_type: '위생증명서', sensitive: false, source: '6.위생증명서.pdf (2026-05-20)',
      fields: [
        { k: 'issuer', label: '발급', v: '국립수산물품질관리원 부산지원', src: '상단 기관명 · 하단 서명' },
        { k: 'date', label: '발행일', v: '2026-05-20', src: 'Date' },
        { k: 'applicant', label: '신청인', v: 'A사', src: 'Applicant' },
        { k: 'commodity', label: '품명', v: 'SNOW CRAB SALAD MEAT', src: 'Commodity' },
        { k: 'quantity_ct', label: '수량 C/T', v: 734, src: 'Quantity' },
        { k: 'quantity_kg', label: '수량 kg', v: 8803.2, src: 'Quantity' },
        { k: 'form', label: '양식', v: '바이어 요청, 비협약국 양식', src: '추가질문 답변 3' },
        { k: 'shipment_no', label: '해당 선적', v: 'UE-2606', src: '수량·날짜로 대응' }
      ] },

    // 6. HACCP 인증서
    { id: '8', match: /^8\./i, doc_type: 'HACCP인증서', sensitive: false, source: '8.HACCP인증서.pdf (발급 2026-01-19)',
      fields: [
        { k: 'cert_no', label: '인증번호', v: '제2009-4-8012호', src: 'p1' },
        { k: 'valid_from', label: '유효 시작', v: '2026-01-23', src: 'p1 유효기간' },
        { k: 'valid_to', label: '유효 종료', v: '2029-01-22', src: 'p1 유효기간' },
        { k: 'category', label: '식품종별', v: '기타수산물가공품', src: 'p1' },
        { k: 'ccp', label: 'CCP', v: '자숙공정 · 가열(농축)공정 · 금속검출공정', src: 'p1 중요관리점 · 별지' },
        { k: 'issuer', label: '근거', v: '식약처 (식품위생법 48조)', src: 'p1 조건' },
        { k: 'first', label: '최초 인증', v: '2009-08-07', src: 'p1 괄호 · p2 변경사항' }
      ] },

    // 7. 영양 성적서 (참고용, 다른 제품)
    { id: '1', match: /영양성분_LB|1\.영양/i, doc_type: '영양성적서', sensitive: false, source: '1.영양성분_LB.pdf (참고용 시험성적서 2022-09-27)',
      fields: [
        { k: 'product', label: '제품명', v: '홍게모둠살 (LB 조미 제품 아님)', src: 'p1 제품명' },
        { k: 'date', label: '검사완료', v: '2022-09-27', src: 'p1' },
        { k: 'kcal', label: '열량 kcal/100g', v: 68.3, src: 'p1 결과표' },
        { k: 'sodium_mg', label: '나트륨 mg', v: 97.3, src: 'p1 결과표' },
        { k: 'carb', label: '탄수화물 g', v: 0.4, src: 'p1 결과표' },
        { k: 'sugar', label: '당류 g', v: 0, src: 'p1 결과표' },
        { k: 'fat', label: '조지방 g', v: 0.7, src: 'p1 결과표' },
        { k: 'transfat', label: '트랜스지방 g', v: 0, src: 'p1 결과표' },
        { k: 'satfat', label: '포화지방 g', v: 0.3, src: 'p1 결과표' },
        { k: 'cholesterol_mg', label: '콜레스테롤 mg', v: 65.5, src: 'p1 결과표' },
        { k: 'protein', label: '조단백질 g', v: 15.1, src: 'p1 결과표' },
        { k: 'moisture', label: '수분 %', v: 82.9, src: 'p1 결과표' },
        { k: 'ash', label: '회분 %', v: 0.9, src: 'p1 결과표' },
        { k: 'note', label: '비고', v: '참고용. 식약처 시험·검사 법률에 따른 성적서 아님', src: 'p1 상단 문구' }
      ] },

    // 8. 바이어 규격서 양식
    { id: '4', match: /LB\s*규격서|4\.\s*U사/i, doc_type: '규격서양식', sensitive: false, source: '4.U사 LB규격서.xlsx (商品規格書, 2022-06-01 개정)',
      fields: [
        { k: 'buyer', label: '바이어', v: 'U사', src: 'B2 会社名' },
        { k: 'form_title', label: '양식명', v: '商品規格書', src: 'A1' },
        { k: 'fields', label: '양식 칸', v: ['会社名', '作成日', '韓国商品名', '商品番号', '日本商品名', '商品コード', '形態', '工場', '規格', '賞味期限', '単位', '重点管理', '配合', '調味液', '包装資材'], src: 'A열 라벨' },
        { k: 'recipe', label: '配合', v: [{ name: 'LEG BROKEN', g: 700, pct: 70 }, { name: '調味料(液)', g: 300, pct: 30 }], src: '配合 표' },
        { k: 'seasoning', label: '調味液', v: [{ name: '水', g: 40000, pct: 95.2 }, { name: '調味料UE-1 (食塩、トレハロース、調味料(アミノ酸等))', g: 2000, pct: 4.8 }], src: '調味液 표' },
        { k: 'qc', label: '重点管理', v: ['解凍重量 560g以上（歩留 80%）', '異物混入禁止（金属・木片・昆虫・プラスチック・ビニール・毛髪）', '危険夾雑物禁止（足先・爪先・えら・黒変肉）', '一般細菌 1.0×10⁴以下、大腸菌群 陰性'], src: '重点管理 칸' },
        { k: 'packaging', label: '包装資材 8종', v: ['アウターカートン 400×270×200 1枚', 'PPトレー 266×195×33 12枚', '印刷真空袋 360×250×0.08 12枚', 'PP緩衝材 8枚', 'ポリ袋(大) 1枚', '外箱シール 70×90 2枚', 'インナーシール 65×65 12枚', 'テープ 50×600 2枚'], src: '包装資材 표' },
        { k: 'spec', label: '규격·기한', v: '1kg×12 / 賞味期限 2年間 / 商品コード 37-9006', src: '規格·賞味期限·商品コード' }
      ] },

    // 9. 실물 라벨 사진
    { id: '사진', match: /제품사진/i, doc_type: '라벨', sensitive: false, source: '추가_제품사진1·2.jpg (U사 LB 1kg 실물 라벨)',
      fields: [
        { k: 'buyer', label: '바이어', v: 'U사', src: '輸入者' },
        { k: 'name', label: '名称', v: '紅ずわいがにむき身', src: '라벨 名称' },
        { k: 'brand', label: '商品名', v: '紅ずわいがに棒くずれ(LB)', src: '라벨 商品名' },
        { k: 'ingredients', label: '原材料名', v: '紅ずわいがに（韓国）、食塩、デキストリン／トレハロース、調味料（アミノ酸等）', src: '라벨 原材料名' },
        { k: 'net', label: '内容量', v: '1キログラム', src: '라벨' },
        { k: 'expiry', label: '賞味期限', v: '2028.10.01', src: '라벨' },
        { k: 'storage', label: '保存方法', v: '要冷凍（－18℃以下）', src: '라벨' },
        { k: 'origin', label: '原産国名', v: '韓国', src: '라벨' },
        { k: 'importer', label: '輸入者', v: 'U사 (鳥取県 境港市)', src: '라벨' },
        { k: 'allergen', label: '알레르겐', v: '(원재료명에 かに 포함)', src: '라벨' },
        { k: 'nutrition', label: '栄養成分 100g', v: 'エネルギー40kcal たんぱく質8.3g 脂質0.4g 炭水化物0.9g 食塩相当量0.6g（推定値）', src: '라벨 栄養成分表示' },
        { k: 'code', label: '商品コード', v: '379006', src: '라벨 바코드 아래' },
        { k: 'country', label: '도착국', v: 'JP', src: '輸入者' },
        { k: 'made', label: '라벨 기준 연도', v: '2026', src: '제품 사진 촬영 시점' },
        { k: 'source', label: '파일', v: '추가_제품사진 (U사 LB 실물)', src: '-' }
      ] },

    // ===== 시연용 가상 6월 선적 세트 (4월 자료 구조 복제. 실제 서류 아님) =====
    { id: '7-1b', match: /^7-1b/i, doc_type: '입고검사서', sensitive: false, source: '7-1b.원료입고검사서_6월.pdf (시연용 가상, 4월 자료 구조 복제) · 시연용 가상',
      fields: [
        { k: 'species', label: '원료명', v: '붉은대게 (Chionoecetes japonicus)', src: 'p1 원료명' },
        { k: 'fishing_period', label: '조업일자', v: '2026-06-02 ~ 06-06', src: 'p1 조업일자' },
        { k: 'received', label: '입고일', v: '2026-06-06', src: 'p1 입고일' },
        { k: 'vessel', label: '공급자(어선)', v: '구○호', src: 'p1 공급자' },
        { k: 'landing', label: '원산지', v: '국내산 (동해 연근해)', src: 'p1 원산지' },
        { k: 'boxes_in', label: '입고 상자', v: 520, src: 'p1 3.원료판정 입고량' },
        { k: 'boxes_ok', label: '판정 상자', v: 480, src: 'p1 3.원료판정 판정수량' },
        { k: 'deduct', label: '공제 상자', v: 40, src: 'p1 비고' },
        { k: 'total_kg', label: '총중량 kg', v: 14400, src: 'p1 3.원료판정 총중량 (30kg×480)' },
        { k: 'core_temp', label: '중심온도 기준', v: '10℃ 이하 (5회 측정 양호)', src: 'p1 1.입고 검수 기준' },
        { k: 'black', label: '흑변 공제', v: '18상자', src: 'p1 비고' }
      ] },
    { id: '7-2b', match: /^7-2b/i, doc_type: '가공일지', sensitive: false, source: '7-2b.가공일지_6월.pdf (시연용 가상, 4월 자료 구조 복제) · 시연용 가상',
      fields: [
        { k: 'date', label: '날짜', v: '2026-06-08', src: 'p1 상단' },
        { k: 'raw_sources', label: '다리 작업 원료 약어(순서대로)', v: ['구', '구', '대', '구', '화', '구'], src: 'p1 금일 작업 · 다리' },
        { k: 'products_made', label: '만든 품목', v: ['LB', 'WF'], src: 'p1 금일 작업 열 제목' },
        { k: 'headcount', label: '공정별 인원·시간', v: '채육 7 · 선별 60 · 계량 32 · 입상 36 · 포장 70 (시간×인)', src: 'p1 작업시간(H×인)' },
        { k: 'notes', label: '특이사항', v: '결근 1명', src: 'p1 하단 특이사항' }
      ] },
    { id: '7-3b', match: /^7-3b/i, doc_type: '포장일지', sensitive: false, source: '7-3b.포장 일지_6월.pdf (시연용 가상, 4월 자료 구조 복제) · 시연용 가상',
      fields: [
        { k: 'date', label: '날짜', v: '2026-06-12', src: 'p1 상단' },
        { k: 'rows', label: '포장 행 (U사)', v: [
          { buyer: 'U사', product: 'LB', ct: 160, mfg: '2026-06-08', expiry: '2028-06-01', lot_code: 'BK' },
          { buyer: 'U사', product: 'LB', ct: 40, mfg: '2026-06-09', expiry: '2028-06-01', lot_code: 'BL' },
          { buyer: 'U사', product: 'WF', ct: 90, mfg: '2026-06-08', expiry: '2028-06-01', lot_code: 'BK' }
        ], src: 'p1 제품 포장 현황 표 (규격 12kg = 1kg×12p, 진공 포장)' },
        { k: 'lot_rule', label: '로트 규칙', v: '생산일 기준 글자 코드 (담당자 확인)', src: '추가질문 답변 1·2' }
      ] },
    { id: '5-2b', match: /^5-2b|UE-2607/i, doc_type: '패킹리스트', sensitive: true, source: '5-2b.패킹리스트_UE-2607.png (시연용 가상, 4월 자료 구조 복제) · 시연용 가상',
      fields: [
        { k: 'invoice_no', label: '선적번호', v: 'UE-2607', src: '우상단 INVOICE NO' },
        { k: 'date', label: '날짜', v: '2026-07-02', src: '우상단 DATE' },
        { k: 'departure', label: '출항', v: '2026-07-03', src: 'DEPARTURE DATE' },
        { k: 'vessel', label: '선박', v: 'HONOR BRIGHT 2623E', src: 'VESSEL/FLIGHT' },
        { k: 'route', label: '구간', v: '부산 → 사카이미나토', src: 'FROM / TO' },
        { k: 'buyer', label: '바이어', v: 'U사', src: 'CONSIGNEE' },
        { k: 'items', label: '품목', v: [
          { desc: 'LEG(L)', ct: 60, kg: 720 }, { desc: 'BROKEN(LB)', ct: 200, kg: 2400 }, { desc: 'WHITE FLAKE', ct: 90, kg: 1080 }
        ], src: '본문 표 (규격 12kg = 1kg×12)' },
        { k: 'total_ct', label: '합계 C/T', v: 350, src: 'G-TOTAL' },
        { k: 'total_kg', label: '합계 kg', v: 4200, src: 'G-TOTAL' },
        { k: 'hs', label: 'HS', v: '1605.10', src: '좌하단' },
        { k: 'note', label: '비고', v: '연결 로트는 선적 구성 추정(검증부)을 보고 사람이 정함', src: '-' }
      ] },
    { id: '6b', match: /^6b/i, doc_type: '위생증명서', sensitive: false, source: '6b.위생증명서_7월.pdf (시연용 가상, 4월 자료 구조 복제) · 시연용 가상',
      fields: [
        { k: 'issuer', label: '발급', v: '국립수산물품질관리원 부산지원', src: '상단 기관명 · 하단 서명' },
        { k: 'date', label: '발행일', v: '2026-07-03', src: 'Date' },
        { k: 'applicant', label: '신청인', v: 'A사', src: 'Applicant' },
        { k: 'commodity', label: '품명', v: 'SNOW CRAB SALAD MEAT', src: 'Commodity' },
        { k: 'quantity_ct', label: '수량 C/T', v: 350, src: 'Quantity' },
        { k: 'quantity_kg', label: '수량 kg', v: 4200, src: 'Quantity' },
        { k: 'form', label: '양식', v: '바이어 요청, 비협약국 양식', src: '추가질문 답변 3' },
        { k: 'shipment_no', label: '해당 선적', v: 'UE-2607', src: '수량·날짜로 대응' }
      ] }
    ,
    // ===== 시연용 가상 세트: 일본 P사 · LB · 2026년 7월 선적 (입고 1건 → 가공 7/8 → 로트 CA → 선적 PE-2608 → 위생증명서). 실제 서류 아님 =====
    { id: 'P-1', match: /^P-1\./i, doc_type: '입고검사서', sensitive: false, source: 'P-1.원료입고검사서_7월.pdf · 시연용 가상(일본 P사 세트)',
      fields: [
        { k: 'species', label: '원료명', v: '붉은대게 (Chionoecetes japonicus)', src: 'p1 원료명' },
        { k: 'fishing_period', label: '조업일자', v: '2026-07-01 ~ 07-05', src: 'p1 조업일자' },
        { k: 'received', label: '입고일', v: '2026-07-06', src: 'p1 입고일' },
        { k: 'vessel', label: '공급자(어선)', v: '삼○호', src: 'p1 공급자' },
        { k: 'landing', label: '원산지', v: '국내산 (동해 연근해)', src: 'p1 원산지' },
        { k: 'boxes_in', label: '입고 상자', v: 520, src: 'p1 3.원료판정 입고량' },
        { k: 'boxes_ok', label: '판정 상자', v: 480, src: 'p1 3.원료판정 판정수량' },
        { k: 'deduct', label: '공제 상자', v: 40, src: 'p1 비고 (흑변 14 + 기본공제 5% 26)' },
        { k: 'total_kg', label: '총중량 kg', v: 14400, src: 'p1 3.원료판정 총중량 (30kg×480)' },
        { k: 'core_temp', label: '중심온도 기준', v: '10℃ 이하 (5회 측정 양호)', src: 'p1 1.입고 검수 기준' },
        { k: 'black', label: '흑변 공제', v: '14상자', src: 'p1 비고' }
      ] },
    { id: 'P-2', match: /^P-2\./i, doc_type: '가공일지', sensitive: false, source: 'P-2.가공일지_7월.pdf · 시연용 가상(일본 P사 세트)',
      fields: [
        { k: 'date', label: '날짜', v: '2026-07-08', src: 'p1 상단' },
        { k: 'raw_sources', label: '다리 작업 원료 약어(순서대로)', v: ['삼', '삼', '삼', '삼', '삼'], src: 'p1 금일 작업 · 다리' },
        { k: 'products_made', label: '만든 품목', v: ['LB', 'WF'], src: 'p1 금일 작업 열 제목' },
        { k: 'headcount', label: '공정별 인원·시간', v: '채육 7 · 선별 62 · 계량 34 · 입상 38 · 포장 74 (시간×인)', src: 'p1 작업시간(H×인)' },
        { k: 'notes', label: '특이사항', v: '특이사항 없음', src: 'p1 하단 특이사항' }
      ] },
    { id: 'P-3', match: /^P-3\./i, doc_type: '포장일지', sensitive: false, source: 'P-3.포장일지_7월.pdf · 시연용 가상(일본 P사 세트)',
      fields: [
        { k: 'date', label: '날짜', v: '2026-07-10', src: 'p1 상단' },
        { k: 'rows', label: '포장 행 (P사)', v: [
          { buyer: 'P사', product: 'LB', ct: 240, mfg: '2026-07-08', expiry: '2028-07-07', lot_code: 'CA' },
          { buyer: 'P사', product: 'WF', ct: 90, mfg: '2026-07-08', expiry: '2028-07-07', lot_code: 'CA' }
        ], src: 'p1 제품 포장 현황 표 (규격 12kg = 1kg×12p, 진공 포장)' },
        { k: 'lot_rule', label: '로트 규칙', v: '생산일 기준 글자 코드 (담당자 확인)', src: '추가질문 답변 1·2' }
      ] },
    { id: 'P-4', match: /^P-4\.|PE-2608/i, doc_type: '패킹리스트', sensitive: false, source: 'P-4.패킹리스트_PE-2608.pdf · 시연용 가상(일본 P사 세트, 계좌·단가 없음)',
      fields: [
        { k: 'invoice_no', label: '선적번호', v: 'PE-2608', src: '우상단 INVOICE NO' },
        { k: 'date', label: '날짜', v: '2026-07-15', src: '우상단 DATE' },
        { k: 'departure', label: '출항', v: '2026-07-16', src: 'DEPARTURE DATE' },
        { k: 'vessel', label: '선박', v: 'HONOR BRIGHT 2625E', src: 'VESSEL/FLIGHT' },
        { k: 'route', label: '구간', v: '부산 → 오사카', src: 'FROM / TO' },
        { k: 'buyer', label: '바이어', v: 'P사', src: 'CONSIGNEE' },
        { k: 'items', label: '품목', v: [{ desc: 'BROKEN(LB)', ct: 240, kg: 2880 }, { desc: 'WHITE FLAKE', ct: 90, kg: 1080 }], src: '본문 표 (규격 12kg = 1kg×12)' },
        { k: 'total_ct', label: '합계 C/T', v: 330, src: 'G-TOTAL' },
        { k: 'total_kg', label: '합계 kg', v: 3960, src: 'G-TOTAL' },
        { k: 'hs', label: 'HS', v: '1605.10', src: '좌하단' },
        { k: 'linked_lot_codes', label: '연결할 회사 LOT', v: ['CA'], src: '포장일지 7/10 LB 240 C/T = 선적 240 C/T' }
      ] },
    { id: 'P-5', match: /^P-5\./i, doc_type: '위생증명서', sensitive: false, source: 'P-5.위생증명서_7월.pdf · 시연용 가상(일본 P사 세트)',
      fields: [
        { k: 'issuer', label: '발급', v: '국립수산물품질관리원 부산지원', src: '상단 기관명 · 하단 서명' },
        { k: 'date', label: '발행일', v: '2026-07-16', src: 'Date' },
        { k: 'applicant', label: '신청인', v: 'A사', src: 'Applicant' },
        { k: 'commodity', label: '품명', v: 'FROZEN COOKED RED SNOW CRAB MEAT', src: 'Commodity' },
        { k: 'quantity_ct', label: '수량 C/T', v: 330, src: 'Quantity' },
        { k: 'quantity_kg', label: '수량 kg', v: 3960, src: 'Quantity' },
        { k: 'form', label: '양식', v: '바이어 요청, 비협약국 양식', src: '-' },
        { k: 'shipment_no', label: '해당 선적', v: 'PE-2608', src: '수량·날짜로 대응' }
      ] },
    { id: 'P-7', match: /^P-7\./i, doc_type: '영양성적서', sensitive: false, source: 'P-7.영양성분_성적서_LB_7월.pdf · 시연용 가상(일본 P사 세트)',
      fields: [
        { k: 'product', label: '제품명', v: '냉동 자숙 홍게 다리 파살 (LB) 1 kg', src: 'p1 제품명' },
        { k: 'date', label: '검사완료', v: '2026-06-20', src: 'p1' },
        { k: 'issuer', label: '시험기관', v: '시험검사기관 (시연용)', src: 'p1 기관명' },
        { k: 'kcal', label: '열량 kcal/100g', v: 38.2, src: 'p1 결과표' },
        { k: 'sodium_mg', label: '나트륨 mg', v: 220, src: 'p1 결과표' },
        { k: 'carb', label: '탄수화물 g', v: 1.2, src: 'p1 결과표' },
        { k: 'sugar', label: '당류 g', v: 0, src: 'p1 결과표' },
        { k: 'fat', label: '조지방 g', v: 0.2, src: 'p1 결과표' },
        { k: 'transfat', label: '트랜스지방 g', v: 0, src: 'p1 결과표' },
        { k: 'satfat', label: '포화지방 g', v: 0.18, src: 'p1 결과표' },
        { k: 'protein', label: '조단백질 g', v: 7.9, src: 'p1 결과표' },
        { k: 'note', label: '비고', v: '시연용 가상 성적서 (품목 LB 기준값과 같은 수치)', src: '-' }
      ] },
    { id: 'P-8', match: /^P-8\./i, doc_type: '규격서양식', sensitive: false, source: 'P-8.P사_LB_規格書.xlsx · 시연용 가상(일본 P사 양식)',
      fields: [
        { k: 'buyer', label: '바이어', v: 'P사', src: 'B2 会社名' },
        { k: 'form_title', label: '양식명', v: '商品規格書', src: 'A1' },
        { k: 'fields', label: '양식 칸', v: ['会社名', '作成日', '韓国商品名', '商品番号', '日本商品名', '商品コード', '形態', '工場', '規格', '賞味期限', '単位', '重点管理', '配合', '調味液', '包装資材'], src: 'A열 라벨' },
        { k: 'recipe', label: '配合', v: [{ name: 'LEG BROKEN', g: 700, pct: 70 }, { name: '調味料(液)', g: 300, pct: 30 }], src: '配合 표' },
        { k: 'seasoning', label: '調味液', v: [{ name: '水', g: 40000, pct: 95.2 }, { name: '調味料P-1 (食塩、トレハロース、調味料(アミノ酸等))', g: 2000, pct: 4.8 }], src: '調味液 표' },
        { k: 'qc', label: '重点管理', v: ['解凍重量 560g以上（歩留 80%）', '異物混入禁止（金属・木片・昆虫・プラスチック・ビニール・毛髪）', '危険夾雑物禁止（足先・爪先・えら・黒変肉）', '一般細菌 1.0×10⁴以下、大腸菌群 陰性'], src: '重点管理 칸' },
        { k: 'packaging', label: '包装資材', v: ['アウターカートン 400×270×200 1枚', 'PPトレー 266×195×33 12枚', '印刷真空袋 360×250×0.08 12枚', 'インナーシール 65×65 12枚'], src: '包装資材 표' },
        { k: 'spec', label: '규격·기한', v: '1kg×12 / 賞味期限 2年間 / 商品コード P-LB-01', src: '規格·賞味期限·商品コード' }
      ] },
    { id: 'P-9', match: /^P-9\./i, doc_type: '라벨', sensitive: false, source: 'P-9.라벨_P사_LB_7월.xlsx · 시연용 가상(일본 P사 라벨 문안)',
      fields: [
        { k: 'buyer', label: '바이어', v: 'P사', src: '輸入者' },
        { k: 'name', label: '名称', v: '紅ずわいがにむき身', src: '名称' },
        { k: 'brand', label: '商品名', v: '紅ずわいがに棒くずれ(LB)', src: '商品名' },
        { k: 'ingredients', label: '原材料名', v: '紅ずわいがに（韓国）、食塩／トレハロース、調味料（アミノ酸等）、（一部にかにを含む）', src: '原材料名' },
        { k: 'net', label: '内容量', v: '1キログラム', src: '内容量' },
        { k: 'expiry', label: '賞味期限', v: '2028.07.07', src: '賞味期限' },
        { k: 'storage', label: '保存方法', v: '要冷凍（－18℃以下）', src: '保存方法' },
        { k: 'origin', label: '原産国名', v: '韓国', src: '原産国名' },
        { k: 'importer', label: '輸入者', v: 'P사 (大阪府 大阪市)', src: '輸入者' },
        { k: 'allergen', label: '알레르겐', v: 'かに（原材料名に一括表示）', src: '原材料名' },
        { k: 'nutrition', label: '栄養成分 100g', v: 'エネルギー38kcal たんぱく質7.9g 脂質0.2g 炭水化物1.2g 食塩相当量0.56g（推定値）', src: '栄養成分表示' },
        { k: 'pack', label: '容器包装 識別表示', v: 'プラ トレー:PP／袋:PE,PA', src: '識別表示' },
        { k: 'code', label: '商品コード', v: 'P-LB-01', src: '商品コード' },
        { k: 'country', label: '도착국', v: 'JP', src: '輸入者' },
        { k: 'made', label: '라벨 기준 연도', v: '2026', src: '-' },
        { k: 'source', label: '파일', v: 'P-9.라벨_P사_LB_7월.xlsx', src: '-' }
      ] }
  ];

  // 대조·반영은 전부 apply.js 로 위임
  LC.extractFixtures.forEach(function (f) {
    f.reconcile = function (s) { return LC.reconcileDoc(this.doc_type, LC.fieldsToObj(this.fields), s); };
    f.apply = function (s) { return LC.applyDoc(this.doc_type, LC.fieldsToObj(this.fields), s); };
  });
})();
