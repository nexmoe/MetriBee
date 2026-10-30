const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { importFunnels } = require('../scripts/import-funnels');
const { createFunnelStore } = require('../lib/funnelStore');

describe('External funnel catalog imports', () => {
  let temporary, catalogPath, directory, backupRoot, options;
  const steps = value => [{ type: 'event', value: 'page_view' }, { type: 'event', value }];
  const catalog = () => ({ version: 1, funnels: [
    { propertyId: '123', domain: 'example.com', name: 'Checkout', steps: steps('purchase') },
    { propertyId: '123', domain: 'example.com', name: 'Signup', steps: steps('sign_up'), sources: ['example/analytics-events.json'] },
    { propertyId: '456', domain: 'other.example', name: 'Download', steps: steps('download') },
  ] });
  const writeCatalog = value => fs.writeFile(catalogPath, JSON.stringify(value));
  const missing = async file => assert.rejects(fs.access(file), { code: 'ENOENT' });

  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'metribee-funnel-import-'));
    catalogPath = path.join(temporary, 'catalog.json');
    directory = path.join(temporary, 'funnels');
    backupRoot = path.join(temporary, 'backups');
    options = { catalogPath, directory, backupRoot, properties: [
      { id: '123', domain: 'example.com' }, { id: '456', domain: 'other.example' },
    ] };
    await writeCatalog(catalog());
  });
  afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

  it('plans an external catalog without creating definitions or backups', async () => {
    const result = await importFunnels({ ...options, dryRun: true });
    assert.equal(result.total, 3);
    assert.equal(result.added, 3);
    assert.equal(result.properties.length, 2);
    await missing(directory);
    await missing(backupRoot);
  });

  it('backs up existing definitions and preserves edits, IDs and property isolation on repeated imports', async () => {
    const store = createFunnelStore({ directory });
    const existing = await store.save('123', { name: 'My checkout', steps: steps('purchase') });
    const before = require('../lib/database').readDocumentSnapshot('funnels', '123', directory, path.resolve('.data/funnels'));
    const result = await importFunnels(options);
    assert.equal(result.added, 2);
    assert.equal(result.existing, 1);
    assert.equal(await fs.readFile(path.join(result.backupDirectory, '123.json'), 'utf8'), before);
    assert.equal((await fs.stat(result.reportPath)).mode & 0o777, 0o600);
    const saved = await store.list('123');
    assert.equal(saved[0].id, existing.id);
    assert.equal(saved[0].name, 'My checkout');
    assert.deepEqual(saved[1].importedFrom, ['example/analytics-events.json']);
    assert.equal((await store.list('456'))[0].name, 'Download');
    const bytes = require('../lib/database').readDocumentSnapshot('funnels', '123', directory, path.resolve('.data/funnels'));
    assert.equal((await importFunnels(options)).added, 0);
    assert.equal(require('../lib/database').readDocumentSnapshot('funnels', '123', directory, path.resolve('.data/funnels')), bytes);
  });

  it('validates every property and domain before writing any definitions or backups', async () => {
    const invalid = catalog();
    invalid.funnels[2].domain = 'wrong.example';
    await writeCatalog(invalid);
    await assert.rejects(importFunnels(options), /property\/domain mismatch/);
    await missing(directory);
    await missing(backupRoot);
  });

  it('rejects missing files and invalid catalogs without accessing the personal default catalog', async () => {
    await assert.rejects(importFunnels({ ...options, catalogPath: path.join(temporary, 'missing.json') }), /Funnel catalog not found/);
    for (const invalid of [null, { version: 2, funnels: [] }, { version: 1, funnels: [null] },
      { version: 1, funnels: [{ ...catalog().funnels[0], sources: 'not-an-array' }] }]) {
      await writeCatalog(invalid);
      await assert.rejects(importFunnels(options), /Invalid funnel/);
    }
    await missing(directory);
    await missing(backupRoot);
  });
});
