const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { Settings } = require('luxon');

const filename = path.resolve(__dirname, '../frontend/rybbit/src/lib/dateTimeUtils.ts');
const compiled = new Module(filename, module);
compiled.require = name => name === './store' ? {getTimezone:()=> 'Asia/Shanghai'} : require(name);
const previousLocale = Settings.defaultLocale;
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},
}).outputText, filename);
Settings.defaultLocale = previousLocale;
const { parseUtcTimestamp } = compiled.exports;

describe('Native account and admin timestamps', () => {
  it('formats SQLite ISO timestamps without crashing the native organizations table or growth chart', () => {
    const value = '2026-10-26T04:00:00.000Z';
    const parsed = parseUtcTimestamp(value);
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.toMillis(), Date.parse(value));
    assert.equal(parsed.toFormat('yyyy-MM-dd'), '2026-10-26');
    assert.doesNotThrow(()=>new Intl.DateTimeFormat('zh',{dateStyle:'medium'}).format(parsed.toJSDate()));
  });
  it('preserves UTC SQL strings, explicit ISO offsets and Better Auth Date objects', () => {
    for (const value of ['2026-10-26 04:00:00', '2026-10-26T12:00:00+08:00', new Date('2026-10-26T04:00:00Z')]) {
      const parsed = parseUtcTimestamp(value);
      assert.equal(parsed.toMillis(), Date.parse('2026-10-26T04:00:00Z'));
      assert.equal(parsed.zoneName, 'Asia/Shanghai');
    }
  });
});
