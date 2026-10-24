const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const file = path.resolve(__dirname, '../frontend/adapter/realtime/model.ts');
const compiled = new Module(file, module);
compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file);
const { clampRule, scoreProperty, sortProperties, groupProperties, ratioText, meterPercent, combinedSeries, feedHealth, PRESETS } = compiled.exports;
const { scoreSpike, parseSpikeOpts, selectSpikeProperties } = require('../controllers/spikeDetector');

describe('Realtime spike presentation model', () => {
  it('distinguishes failed traffic, valid zeros, partial totals and an unsuccessful refresh', () => {
    const failed = { propertyId: 'failed', error: true, activeUsers: 0, pageViews: 0 };
    const quiet = { propertyId: 'quiet', activeUsers: 0, pageViews: 0 };
    expect(feedHealth([failed])).to.include({ status: 'unavailable', activeUsers: null, pageViews: null, withTraffic: null });
    expect(feedHealth([quiet])).to.include({ status: 'ready', activeUsers: 0, pageViews: 0, withTraffic: 0 });
    expect(feedHealth([failed, { propertyId: 'live', activeUsers: 5, pageViews: 8 }])).to.include({ status: 'partial', activeUsers: 5, pageViews: 8, available: 1, failed: 1 });
    expect(feedHealth([quiet], true)).to.include({ status: 'unavailable', activeUsers: null, pageViews: null });
  });
  it('limits spike context to connected, selected properties and preserves full-scan callers', () => {
    const properties = [{id:'1'}, {id:'2'}, {id:'3'}];
    expect(selectSpikeProperties(properties, '2,2')).to.deep.equal([{id:'2'}]);
    expect(selectSpikeProperties(properties)).to.equal(properties);
    expect(() => selectSpikeProperties(properties, '999')).to.throw(/connected/);
    expect(() => selectSpikeProperties(properties, ['1', '2'])).to.throw(/property IDs/);
    expect(() => selectSpikeProperties(properties, '')).to.throw(/property IDs/);
    expect(() => selectSpikeProperties(Array.from({length:21}, (_,i)=>({id:String(i)})), Array.from({length:21}, (_,i)=>i).join(','))).to.throw(/up to 20/);
  });
  it('rescales the same live feed exactly like server scoring for every preset and noisy baseline', () => {
    for (const rule of Object.values(PRESETS)) for (const [active, baseline, sd] of [[6, 1, null], [40, 20, 15], [260, 247, 3], [378, 172, 20], [0, 8, 2]]) {
      expect(scoreProperty({ propertyId: '1', activeUsers: active, baseline, baselineSd: sd }, rule).score).to.deep.equal(scoreSpike(active, baseline, sd, rule));
    }
    expect(clampRule({ z: 100, lift: -5 })).to.deep.equal(parseSpikeOpts({ z: 100, lift: -5 }));
    expect(clampRule(null)).to.deep.equal({ z: 3, lift: 1.5 });
  });

  it('ranks unusual traffic before volume and keeps quiet and failed properties accessible', () => {
    const rows = [
      { propertyId: 'large', activeUsers: 260, baseline: 247 },
      { propertyId: 'surge', activeUsers: 39, baseline: 1 },
      { propertyId: 'quiet', activeUsers: 0 },
      { propertyId: 'failed', error: true, errorMessage: 'Permission denied', activeUsers: 1000 },
    ].map(row => scoreProperty(row, PRESETS.normal));
    expect(sortProperties(rows.filter(row => !row.error), 'unusual').map(row => row.propertyId)).to.deep.equal(['surge', 'large', 'quiet']);
    expect(rows[3]).to.include({ score: null, error: 'Permission denied' });
    expect(rows[2].score).to.equal(null);
    expect(groupProperties(rows, false)[0].rows).to.have.length(4);
  });

  it('does not merge different accounts with identical display names', () => {
    const rows = ['account-1', 'account-2'].map(accountId => scoreProperty({ propertyId: accountId, accountId, accountName: 'Same name' }, PRESETS.normal));
    expect(groupProperties(rows, true)).to.have.length(2);
    expect(groupProperties(rows, false)).to.have.length(1);
  });

  it('does not round a subthreshold lift up, and keeps the lift marker at 75 percent', () => {
    expect(ratioText(1.499)).to.equal('1.4');
    expect(meterPercent(1.5, PRESETS.normal)).to.equal(75);
    expect(meterPercent(39, PRESETS.normal)).to.equal(100);
  });

  it('combines actual minute series while omitting unavailable and failed responses', () => {
    const row = (propertyId, values, error) => scoreProperty({ propertyId, series: values, error }, PRESETS.normal);
    const rows = [row('a', Array(30).fill(2)), row('b', Array(30).fill(1)), row('missing', null), row('failed', Array(30).fill(99), 'Failed')];
    expect(combinedSeries(rows)).to.deep.equal(Array(30).fill(3));
    expect(combinedSeries([row('missing', null)])).to.equal(null);
  });
});
