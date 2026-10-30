const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the actual page entry with capability responses, without mounting
// chart engines or depending on a running Google connection.
describe('Journey page report selection', () => {
  const filename = path.resolve(__dirname, '../frontend/adapter/pages/Journeys.tsx');
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const NativeJourneysPage = () => null;
  const PageTransitions = () => null;
  const Placeholder = () => null;
  let query, location, destination;
  const module = { exports: {} };
  const mockRequire = name => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name.endsWith('/useAnalyticsQuery')) return { useAnalyticsQuery: () => query };
    if (name.endsWith('/journeys/page')) return { __esModule: true, default: NativeJourneysPage };
    if (name.endsWith('/PageTransitions')) return { PageTransitions };
    if (name.endsWith('/store')) return { useStore: select => select({ site: '123' }) };
    if (name.endsWith('/extracted')) return { useExtracted: () => text => text };
    if (name.endsWith('/navigation')) return { useLocation: () => location, navigate: next => { destination = next; } };
    return { Info: Placeholder, Route: Placeholder, Button: Placeholder, Skeleton: Placeholder, ErrorState: Placeholder };
  };
  vm.runInNewContext(output, { exports: module.exports, module, require: mockRequire, URL }, { filename });
  const render = () => module.exports.default();
  beforeEach(() => {
    query = { data: { available: false, source: null }, isLoading: false, error: null };
    location = 'http://localhost/journeys?prop=123&range=7d';
    destination = null;
  });

  it('opens the working GA4 report directly when ordered session events are unavailable', () => {
    const page = render();
    assert.equal(page.type, PageTransitions);
    assert.equal(page.props.onBack, undefined, 'must not offer a return to an unavailable report');
  });
  it('opens native multi-step journeys when an ordered session source is available', () => {
    query.data = { available: true, source: 'ordered-sessions' };
    assert.equal(render().type, NativeJourneysPage);
    query.data.source = 'demo-sessions';
    assert.equal(render().type, NativeJourneysPage);
    query.data.source = 'bigquery';
    assert.equal(render().type, NativeJourneysPage);
  });
  it('keeps explicit transition links and only offers return navigation to an available session report', () => {
    location += '&journeyView=transitions';
    assert.equal(render().props.onBack, undefined);
    query.data = { available: true, source: 'demo-sessions' };
    const page = render();
    assert.equal(page.type, PageTransitions);
    page.props.onBack();
    assert.equal(destination, '/journeys?prop=123&range=7d');
  });
  it('does not block GA4 reports when session capability discovery fails', () => {
    query = { data: undefined, isLoading: false, error: new Error('Capability unavailable') };
    assert.equal(render().type, PageTransitions);
  });
});
