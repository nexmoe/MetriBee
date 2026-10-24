const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { normalizeWidgetConfig } = require('../controllers/widgetConfig');

const pending = new Map();
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

function createEmbedStore({ directory = process.env.GA4_EMBEDS_DIR || path.resolve(__dirname, '../.data/embeds'), now = () => new Date() } = {}) {
  function fileFor(propertyId) {
    if (!/^\d+$/.test(String(propertyId))) throw failure('Choose a numeric property ID.');
    return path.join(directory, `${propertyId}.json`);
  }
  async function read(file) {
    let raw;
    try { raw = await fs.readFile(file, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { embedEnabled: false, privateLinkKey: null, widgets: [] };
      throw error;
    }
    const config = JSON.parse(raw);
    if (typeof config.embedEnabled !== 'boolean' || (config.privateLinkKey !== null && !/^[a-f0-9]{12}$/.test(config.privateLinkKey))) {
      throw new Error('Invalid embed configuration.');
    }
    const widgets = config.widgets ?? [];
    if (!Array.isArray(widgets) || widgets.length > 100 || widgets.some(widget => !widget || !/^[a-f0-9]{12}$/.test(widget.id)
      || typeof widget.createdAt !== 'string' || typeof widget.updatedAt !== 'string') || new Set(widgets.map(widget => widget.id)).size !== widgets.length) throw new Error('Invalid saved widgets.');
    let normalized;
    try { normalized = widgets.map(widget => ({ ...widget, config: normalizeWidgetConfig(widget.config) })); }
    catch { throw new Error('Invalid saved widget configuration.'); }
    return { embedEnabled: config.embedEnabled, privateLinkKey: config.privateLinkKey, widgets: normalized };
  }
  function transact(propertyId, task) {
    const file = fileFor(propertyId);
    const work = (pending.get(file) || Promise.resolve()).catch(() => {}).then(async () => {
      try {
        return await task(await read(file), async config => {
          await fs.mkdir(directory, { recursive: true });
          const temp = `${file}.${randomUUID()}.tmp`;
          try {
            await fs.writeFile(temp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
            await fs.rename(temp, file);
          } finally { await fs.rm(temp, { force: true }); }
        });
      } catch (error) {
        if (error.status) throw error;
        throw failure('Saved embed settings could not be read or written. Existing settings were preserved.', 503);
      }
    });
    pending.set(file, work);
    work.finally(() => { if (pending.get(file) === work) pending.delete(file); }).catch(() => {});
    return work;
  }
  return {
    get: propertyId => transact(propertyId, ({ embedEnabled, privateLinkKey }) => ({ embedEnabled, privateLinkKey })),
    listWidgets: propertyId => transact(propertyId, config => config.widgets),
    getWidget: (propertyId, id) => transact(propertyId, config => config.widgets.find(widget => widget.id === id) || null),
    saveWidget: (propertyId, raw, id) => transact(propertyId, async (config, commit) => {
      const definition = normalizeWidgetConfig(raw);
      if (id != null && (typeof id !== 'string' || !/^[a-f0-9]{12}$/.test(id))) throw failure('Choose a valid widget ID.');
      const existing = id == null ? null : config.widgets.find(widget => widget.id === id);
      if (id != null && !existing) throw failure('Widget not found.', 404);
      if (!existing && config.widgets.length >= 100) throw failure('A property can save up to 100 widgets.', 422);
      const timestamp = now().toISOString();
      const widget = { id: existing?.id || randomBytes(6).toString('hex'), config: definition, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
      const widgets = existing ? config.widgets.map(item => item.id === id ? widget : item) : [...config.widgets, widget];
      await commit({ ...config, widgets });
      return widget;
    }),
    removeWidget: (propertyId, id) => transact(propertyId, async (config, commit) => {
      if (!config.widgets.some(widget => widget.id === id)) throw failure('Widget not found.', 404);
      await commit({ ...config, widgets: config.widgets.filter(widget => widget.id !== id) });
    }),
    setEnabled: (propertyId, enabled) => transact(propertyId, async (config, commit) => {
      if (typeof enabled !== 'boolean') throw failure('embedEnabled must be a boolean.');
      const next = { ...config, embedEnabled: enabled };
      await commit(next);
      return next;
    }),
    privateLink: (propertyId, action) => transact(propertyId, async (config, commit) => {
      if (!['generate_private_link_key', 'revoke_private_link_key'].includes(action)) throw failure('Choose a valid private-link action.');
      const next = { ...config, privateLinkKey: action === 'generate_private_link_key' ? randomBytes(6).toString('hex') : null };
      await commit(next);
      return { privateLinkKey: next.privateLinkKey };
    }),
    validate: async (propertyId, key) => {
      if (typeof key !== 'string' || !/^[a-f0-9]{12}$/.test(key)) return false;
      const config = await transact(propertyId, value => value);
      return !!config.privateLinkKey && timingSafeEqual(Buffer.from(config.privateLinkKey), Buffer.from(key));
    },
  };
}

module.exports = { createEmbedStore };
