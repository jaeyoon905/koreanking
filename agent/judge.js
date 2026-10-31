// 규칙 엔진을 Python에서 쓰기 위한 얇은 래퍼. node agent/judge.js JP '{"name":...}'
// data.js 의 LC.rules 를 그대로 돌린다. 규칙은 여기 말고 data.js 에서만 고친다.
const fs = require('fs'), path = require('path');
global.window = { addEventListener() {} }; global.document = {};
eval(fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'));
const [, , country, json] = process.argv;
const f = JSON.parse(json || '{}');
const out = LC.rules[country].checks.map(c => Object.assign({ id: c.id, item: c.item }, c.run(f)));
process.stdout.write(JSON.stringify(out));
