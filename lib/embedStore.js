const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { normalizeWidgetConfig } = require('../controllers/widgetConfig');

const { documentStore } = require('./database');
const failure = (message, status = 400) => Object.assign(new Error(message), { status });

function createEmbedStore({ directory = process.env.GA4_EMBEDS_DIR || path.resolve(__dirname, '../.data/embeds'), now = () => new Date() } = {}) {
  const documents = documentStore('embeds', directory, path.resolve(__dirname, '../.data/embeds'));
  function read(propertyId) {
    const config = documents.read(propertyId, () => ({ embedEnabled: false, privateLinkKey: null, widgets: [] }));
    if (typeof config.embedEnabled !== 'boolean' || (config.public !== undefined && typeof config.public !== 'boolean') || (config.privateLinkKey !== null && !/^[a-f0-9]{12}$/.test(config.privateLinkKey))) {
      throw new Error('Invalid embed configuration.');
    }
    const widgets = config.widgets ?? [];
    if (!Array.isArray(widgets) || widgets.length > 100 || widgets.some(widget => !widget || !/^[a-f0-9]{12}$/.test(widget.id)
      || typeof widget.createdAt !== 'string' || typeof widget.updatedAt !== 'string') || new Set(widgets.map(widget => widget.id)).size !== widgets.length) throw new Error('Invalid saved widgets.');
    let normalized;
    try { normalized = widgets.map(widget => ({ ...widget, config: normalizeWidgetConfig(widget.config) })); }
    catch { throw new Error('Invalid saved widget configuration.'); }
    return { public: config.public ?? false, embedEnabled: config.embedEnabled, privateLinkKey: config.privateLinkKey, widgets: normalized };
  }
  async function transact(propertyId, task) {
    if (!/^\d+$/.test(String(propertyId))) throw failure('Choose a numeric property ID.');
    try { return documents.transaction(() => task(read(propertyId), config => documents.write(propertyId, config))); }
    catch (error) {
      if (error.status) throw error;
      throw failure('Saved embed settings could not be read or written. Existing settings were preserved.', 503);
    }
  }
  return {
    get: propertyId => transact(propertyId, ({ embedEnabled, privateLinkKey }) => ({ embedEnabled, privateLinkKey })),
    isPublic: propertyId => transact(propertyId, config => config.public),
    setPublic: (propertyId, enabled) => transact(propertyId, (config, commit) => {
      if (typeof enabled !== 'boolean') throw failure('public must be a boolean.');
      commit({ ...config, public: enabled });
      return { public: enabled };
    }),
    listWidgets: propertyId => transact(propertyId, config => config.widgets),
    getWidget: (propertyId, id) => transact(propertyId, config => config.widgets.find(widget => widget.id === id) || null),
    saveWidget: (propertyId, raw, id) => transact(propertyId, (config, commit) => {
      const definition = normalizeWidgetConfig(raw);
      if (id != null && (typeof id !== 'string' || !/^[a-f0-9]{12}$/.test(id))) throw failure('Choose a valid widget ID.');
      const existing = id == null ? null : config.widgets.find(widget => widget.id === id);
      if (id != null && !existing) throw failure('Widget not found.', 404);
      if (!existing && config.widgets.length >= 100) throw failure('A property can save up to 100 widgets.', 422);
      const timestamp = now().toISOString();
      const widget = { id: existing?.id || randomBytes(6).toString('hex'), config: definition, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
      const widgets = existing ? config.widgets.map(item => item.id === id ? widget : item) : [...config.widgets, widget];
      commit({ ...config, widgets });
      return widget;
    }),
    removeWidget: (propertyId, id) => transact(propertyId, (config, commit) => {
      if (!config.widgets.some(widget => widget.id === id)) throw failure('Widget not found.', 404);
      commit({ ...config, widgets: config.widgets.filter(widget => widget.id !== id) });
    }),
    setEnabled: (propertyId, enabled) => transact(propertyId, (config, commit) => {
      if (typeof enabled !== 'boolean') throw failure('embedEnabled must be a boolean.');
      const next = { ...config, embedEnabled: enabled };
      commit(next);
      return next;
    }),
    privateLink: (propertyId, action) => transact(propertyId, (config, commit) => {
      if (!['generate_private_link_key', 'revoke_private_link_key'].includes(action)) throw failure('Choose a valid private-link action.');
      const next = { ...config, privateLinkKey: action === 'generate_private_link_key' ? randomBytes(6).toString('hex') : null };
      commit(next);
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
