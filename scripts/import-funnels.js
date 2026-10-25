const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createFunnelStore, funnelDefinitionKey } = require('../lib/funnelStore');
const { normalizeSteps } = require('../controllers/funnels');

const root = path.resolve(__dirname, '..');
const defaultCatalog = path.join(root, '.data/imports/funnels.json');

async function importFunnels({
  catalogPath = defaultCatalog,
  directory = process.env.GA4_FUNNELS_DIR || path.join(root, '.data/funnels'),
  properties,
  dryRun = false,
  backupRoot = path.join(root, '.data/funnel-imports'),
} = {}) {
  const source = path.resolve(catalogPath);
  let catalog;
  try { catalog = JSON.parse(await fs.readFile(source, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('Funnel catalog not found. Pass a JSON file path or save it to .data/imports/funnels.json.');
    throw error;
  }
  if (catalog?.version !== 1 || !Array.isArray(catalog.funnels)
    || (catalog.excluded !== undefined && !Array.isArray(catalog.excluded))) {
    throw new Error('Invalid funnel catalog: expected version 1 and a funnels array.');
  }
  properties ||= JSON.parse(await fs.readFile(path.join(root, '.cache/properties.json'), 'utf8')).properties;
  const byProperty = new Map(properties.map(property => [String(property.id), property]));
  const groups = new Map();

  // Validate the entire catalog and property mapping before changing any data.
  for (const item of catalog.funnels) {
    if (!item || typeof item.propertyId !== 'string' || !/^\d+$/.test(item.propertyId)
      || typeof item.domain !== 'string' || !item.domain.trim()
      || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120
      || (item.description !== undefined && typeof item.description !== 'string')
      || (item.sources !== undefined && (!Array.isArray(item.sources) || item.sources.some(value => typeof value !== 'string')))) {
      throw new Error('Invalid funnel definition: choose a numeric property ID, domain, name and valid metadata.');
    }
    const property = byProperty.get(item.propertyId);
    if (!property || property.domain?.toLowerCase() !== item.domain.toLowerCase()) {
      throw new Error(`Connected property/domain mismatch for ${item.product}: ${item.propertyId}`);
    }
    const steps = normalizeSteps(item.steps).map(({ filterExpression, ...step }) => step);
    const group = groups.get(item.propertyId) || { product: item.product, propertyId: item.propertyId, definitions: [] };
    group.definitions.push({ name: item.name, steps, description: item.description, sources: item.sources });
    groups.set(item.propertyId, group);
  }

  const originals = new Map();
  const plans = [];
  for (const group of groups.values()) {
    let original = null;
    try { original = await fs.readFile(path.join(directory, `${group.propertyId}.json`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    originals.set(group.propertyId, original);
    const existing = original ? JSON.parse(original).funnels : [];
    if (!Array.isArray(existing)) throw new Error(`Invalid funnel file for property ${group.propertyId}`);
    const rules = new Set(existing.map(funnel => funnelDefinitionKey(funnel.steps)));
    const results = group.definitions.map(definition => {
      const key = funnelDefinitionKey(definition.steps);
      const status = rules.has(key) ? 'existing' : 'added';
      rules.add(key);
      return { name: definition.name, status };
    });
    if (rules.size > 100) throw new Error(`Import would exceed 100 funnels for property ${group.propertyId}`);
    plans.push({ product: group.product, propertyId: group.propertyId, funnels: results });
  }

  if (dryRun) return {
    dryRun: true,
    total: catalog.funnels.length,
    added: plans.flatMap(plan => plan.funnels).filter(item => item.status === 'added').length,
    properties: plans,
    excluded: catalog.excluded || [],
  };

  const backupDirectory = path.join(backupRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  for (const [propertyId, contents] of originals) {
    if (contents) await fs.writeFile(path.join(backupDirectory, `${propertyId}.json`), contents, { mode: 0o600, flag: 'wx' });
  }

  const store = createFunnelStore({ directory });
  const imported = [];
  for (const group of groups.values()) {
    const funnels = await store.importDefinitions(group.propertyId, group.definitions);
    imported.push({ product: group.product, propertyId: group.propertyId, funnels });
  }
  const report = {
    importedAt: new Date().toISOString(),
    source,
    directory: path.resolve(directory),
    total: catalog.funnels.length,
    added: imported.flatMap(group => group.funnels).filter(item => item.status === 'added').length,
    existing: imported.flatMap(group => group.funnels).filter(item => item.status === 'existing').length,
    properties: imported,
    excluded: catalog.excluded || [],
    backupDirectory,
  };
  const reportPath = path.join(backupDirectory, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { ...report, reportPath };
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const args = process.argv.slice(2);
  const files = args.filter(arg => arg !== '--dry-run');
  if (files.length > 1 || files.some(arg => arg.startsWith('-'))) {
    console.error('Usage: node scripts/import-funnels.js [catalog.json] [--dry-run]');
    process.exitCode = 1;
  } else {
    importFunnels({ catalogPath: files[0], dryRun: args.includes('--dry-run') })
      .then(report => console.log(JSON.stringify(report, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}

module.exports = { importFunnels };
