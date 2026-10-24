const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Definitions are durable application data, never report-cache entries.
// Serialize each file's read/modify/write across store instances in this process.
const pending = new Map();
const failure = (message, status) => Object.assign(new Error(message), { status });

// Labels may be edited without changing the measurement rule. Keep imported
// rules idempotent across those edits and across property-filter ordering.
function funnelDefinitionKey(steps) {
  return JSON.stringify(steps.map(step => ({
    type: step.type,
    value: String(step.value || '').trim(),
    hostname: [...new Set(String(step.hostname || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean))].sort(),
    filters: [
      ...(step.propertyFilters || []),
      ...(step.eventPropertyKey ? [{ key: step.eventPropertyKey, value: step.eventPropertyValue }] : []),
    ].map(filter => [filter.key, filter.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })));
}

function initialFunnels(_propertyId) {
  return [];
}

function createFunnelStore({ directory = process.env.GA4_FUNNELS_DIR || path.resolve(__dirname, '../.data/funnels'),
  now = () => new Date() } = {}) {
  function fileFor(propertyId) {
    if (!/^\d+$/.test(String(propertyId))) throw failure('Choose a numeric property ID.', 400);
    return path.resolve(directory, `${propertyId}.json`);
  }
  async function write(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }); }
  }
  async function read(file, propertyId) {
    let raw;
    try { raw = await fs.readFile(file, 'utf8'); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const timestamp = now().toISOString();
      const funnels = initialFunnels(String(propertyId)).map((item, i) => ({ ...item, id: i + 1, createdAt: timestamp, updatedAt: timestamp }));
      const data = { version: 1, nextId: funnels.length + 1, funnels };
      await write(file, data);
      return data;
    }
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.funnels) || !Number.isSafeInteger(data.nextId)
      || data.nextId < 1 || data.funnels.some(item => !Number.isSafeInteger(item.id) || item.id < 1
        || item.id >= data.nextId || typeof item.name !== 'string' || !Array.isArray(item.steps))
      || new Set(data.funnels.map(item => item.id)).size !== data.funnels.length) {
      throw new Error('Invalid funnel definitions');
    }
    return data;
  }
  function transact(propertyId, task) {
    const file = fileFor(propertyId);
    const work = (pending.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      try { return await task(await read(file, propertyId), data => write(file, data)); }
      catch (error) {
        if (error.status) throw error;
        throw failure('Saved funnel definitions could not be read or written. Existing definitions were preserved.', 503);
      }
    });
    pending.set(file, work);
    work.finally(() => { if (pending.get(file) === work) pending.delete(file); }).catch(() => {});
    return work;
  }
  return {
    list: propertyId => transact(propertyId, data => data.funnels),
    importDefinitions: (propertyId, definitions) => transact(propertyId, async (data, commit) => {
      const byRule = new Map(data.funnels.map(funnel => [funnelDefinitionKey(funnel.steps), funnel]));
      const names = new Set(data.funnels.map(funnel => funnel.name));
      const results = [];
      for (const definition of definitions) {
        const key = funnelDefinitionKey(definition.steps);
        const existing = byRule.get(key);
        if (existing) {
          results.push({ id: existing.id, name: existing.name, status: 'existing' });
          continue;
        }
        if (data.funnels.length >= 100) throw failure('A property can save up to 100 funnels.', 422);
        let name = definition.name;
        for (let suffix = 1; names.has(name); suffix++) {
          name = `${definition.name.slice(0, 95)} (seomachine${suffix === 1 ? '' : ` ${suffix}`})`;
        }
        const timestamp = now().toISOString();
        const funnel = {
          id: data.nextId++, name, steps: definition.steps,
          ...(definition.description ? { description: definition.description } : {}),
          ...(definition.sources ? { importedFrom: definition.sources } : {}),
          createdAt: timestamp, updatedAt: timestamp,
        };
        data.funnels.push(funnel);
        byRule.set(key, funnel);
        names.add(name);
        results.push({ id: funnel.id, name, status: 'added' });
      }
      if (results.some(result => result.status === 'added')) await commit(data);
      return results;
    }),
    save: (propertyId, { name, steps, reportId }) => transact(propertyId, async (data, commit) => {
      const existing = reportId == null ? null : data.funnels.find(item => item.id === reportId);
      if (reportId != null && !existing) throw failure('Funnel not found.', 404);
      if (!existing && data.funnels.length >= 100) throw failure('A property can save up to 100 funnels.', 422);
      const timestamp = now().toISOString();
      const funnel = existing ? { ...existing, name, steps, updatedAt: timestamp }
        : { id: data.nextId++, name, steps, createdAt: timestamp, updatedAt: timestamp };
      if (existing) data.funnels[data.funnels.indexOf(existing)] = funnel;
      else data.funnels.push(funnel);
      await commit(data);
      return funnel;
    }),
    remove: (propertyId, id) => transact(propertyId, async (data, commit) => {
      if (!data.funnels.some(item => item.id === id)) throw failure('Funnel not found.', 404);
      data.funnels = data.funnels.filter(item => item.id !== id);
      await commit(data);
    }),
  };
}

module.exports = { createFunnelStore, initialFunnels, funnelDefinitionKey };
