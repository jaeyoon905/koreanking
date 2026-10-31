// node server/fixture_dump.js <파일명> → fixtures.js 에서 match 되는 항목의 데이터만 JSON (함수 제외). 없으면 null
const fs = require('fs'), path = require('path');
global.window = { addEventListener() {} }; global.document = {};
const root = path.join(__dirname, '..');
eval(fs.readFileSync(path.join(root, 'data.js'), 'utf8'));
eval(fs.readFileSync(path.join(root, 'fixtures.js'), 'utf8'));
const name = process.argv[2] || '';
const f = (LC.extractFixtures || []).find(x => x.match instanceof RegExp ? x.match.test(name) : String(name).indexOf(x.match) >= 0);
process.stdout.write(JSON.stringify(f ? { id: f.id, doc_type: f.doc_type, source: f.source, sensitive: !!f.sensitive, fields: f.fields } : null));
