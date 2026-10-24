const { expect } = require('chai');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFunnelStore } = require('../lib/funnelStore');

describe('Durable funnel definitions', () => {
  let directory;
  beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ga4-funnel-definitions-')); });
  afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
  const definition = name => ({ name, steps: [{ type: 'event', value: 'page_view' }, { type: 'event', value: 'purchase' }] });

  it('survives reopening, edits without changing ID, and isolates properties', async () => {
    const first = createFunnelStore({ directory });
    const saved = await first.save('123', definition('Checkout'));
    const reopened = createFunnelStore({ directory });
    expect((await reopened.list('123'))[0].name).to.equal('Checkout');
    const edited = await reopened.save('123', { ...definition('Checkout v2'), reportId: saved.id });
    expect(edited.id).to.equal(saved.id);
    expect((await first.list('123')).map(item => item.name)).to.deep.equal(['Checkout v2']);
    expect(await first.list('456')).to.deep.equal([]);
    let error;
    try { await first.remove('456', saved.id); } catch (caught) { error = caught; }
    expect(error.status).to.equal(404);
    expect(await first.list('123')).to.have.length(1);
  });

  it('preserves concurrent saves from independent handlers without duplicate IDs or lost rules', async () => {
    const a = createFunnelStore({ directory }), b = createFunnelStore({ directory });
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).save('123', definition(`Funnel ${i}`))));
    const saved = await a.list('123');
    expect(saved).to.have.length(12);
    expect(new Set(saved.map(item => item.id)).size).to.equal(12);
    expect((await fs.readdir(directory)).filter(file => file.endsWith('.tmp'))).to.deep.equal([]);
  });

  it('preserves an unreadable file instead of replacing it with presets', async () => {
    const file = path.join(directory, '987654321.json');
    await fs.writeFile(file, '{broken');
    let error;
    try { await createFunnelStore({ directory }).save('987654321', definition('New')); } catch (caught) { error = caught; }
    expect(error.status).to.equal(503);
    expect(await fs.readFile(file, 'utf8')).to.equal('{broken');
  });

  it('imports rules once while preserving edited labels, metadata, and existing IDs', async () => {
    const store = createFunnelStore({ directory });
    const existing = await store.save('123', definition('My renamed checkout'));
    const rules = [
      { ...definition('Imported checkout'), description: 'Do not overwrite the existing rule.' },
      { ...definition('New imported rule'), steps: [{ type: 'event', value: 'session_start' }, { type: 'event', value: 'download_started' }], description: 'Production only', sources: ['example/analytics-events.json'] },
    ];
    const imported = await store.importDefinitions('123', rules);
    expect(imported.map(item => item.status)).to.deep.equal(['existing', 'added']);
    expect(imported[0]).to.include({ id: existing.id, name: 'My renamed checkout' });
    expect((await store.list('123'))[1]).to.include({ description: 'Production only' });
    expect((await store.list('123'))[1].importedFrom).to.deep.equal(['example/analytics-events.json']);
    expect((await store.importDefinitions('123', rules)).every(item => item.status === 'existing')).to.equal(true);
    expect(await store.list('123')).to.have.length(2);
  });

  it('keeps differently filtered rules and resolves name conflicts without overwriting user data', async () => {
    const store = createFunnelStore({ directory });
    await store.save('123', definition('Checkout'));
    const filtered = { ...definition('Checkout'), steps: definition('').steps.map(step => ({ ...step, hostname: 'example.com, www.example.com' })) };
    const imported = await store.importDefinitions('123', [filtered]);
    expect(imported[0]).to.include({ name: 'Checkout (seomachine)', status: 'added' });
    expect(await store.list('123')).to.have.length(2);
    filtered.steps = filtered.steps.map(step => ({ ...step, hostname: 'www.example.com,example.com' }));
    expect((await store.importDefinitions('123', [filtered]))[0].status).to.equal('existing');
  });
});
