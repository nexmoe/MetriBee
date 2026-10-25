const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('../frontend/node_modules/react');
const { renderToStaticMarkup } = require('../frontend/node_modules/react-dom/server');

// Render the real page and stat band with controlled network states. This checks
// which requests are enabled and which figures remain visible during loading.
function load(file, mocks) {
  const filename = path.resolve(__dirname, '../frontend/rybbit/src', file);
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText, filename);
  return compiled.exports;
}
const pass = ({ children }) => React.createElement('div', null, children);
const steps = [{ type: 'event', value: 'page_view' }, { type: 'event', value: 'purchase' }];
const funnel = { id: 1, name: 'Checkout', steps };
const summary = { users_entered_any: 80, funnels: [{ funnel_id: 1, steps: [{ sessions: 80 }, { sessions: 20 }] }] };
function render({ current, previous, definitions = [funnel] }) {
  const requests = [], cells = [];
  const store = { site: 123, time: { mode: 'day', day: '2026-10-22' }, previousTime: { mode: 'day', day: '2026-10-21' } };
  const mocks = {
    'next-intl': { useExtracted: () => text => text },
    'next/navigation': { useSearchParams: () => new URLSearchParams() },
    '@/lib/store': { useStore: selector => selector(store), useTimezone: () => 'UTC', useComparisonEnabled: () => true },
    '@/lib/filterGroups': { FUNNEL_PAGE_FILTERS: [] },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '@/lib/delta': { percentDelta: () => null },
    '@/lib/events': { resolvePropertyFilters: () => [] },
    '@/hooks/useSetPageTitle': { useSetPageTitle() {} },
    '@/hooks/usePermissions': { useCanOnSite: () => false },
    '@/components/DateSelector/rangeFields': { describeComparisonWindow: () => 'Previous day' },
    '@/api/analytics/hooks/funnels/useGetFunnels': { useGetFunnels: () => ({ data: definitions, isLoading: false }) },
    '@/api/analytics/hooks/funnels/useGetFunnelSummaries': { useGetFunnelSummaries: options => {
      requests.push(options);
      return options.periodTime === 'previous' ? previous : current;
    } },
    '@/api/analytics/hooks/funnels/useGetFunnelGoals': { useGetFunnelGoals: () => ({}) },
    './components/CreateFunnel': { CreateFunnelDialog: pass },
    './components/FunnelSortControl': { FunnelSortControl: pass },
    './components/FunnelRow': { FUNNEL_ROW_GRID: '', FunnelRow: pass },
    '../components/SubHeader/SubHeader': { SubHeader: pass },
    './useStepTypeLabels': { useStepTypeLabels: () => ({ event: 'Event' }) },
    '@/components/site/StatBand': { StatBand: ({ cells: values, isLoading }) => {
      cells.push(...values.map(value => ({ ...value, loading: value.isLoading ?? isLoading })));
      return null;
    } },
  };
  for (const [component, directory] of Object.entries({ DisabledOverlay: '', ErrorState: '', ExternalLink: '', NothingFound: '', AnalysisBar: 'site/', Card: 'ui/card', Input: 'ui/input', Skeleton: 'ui/skeleton', Button: 'ui/button' })) {
    mocks[`@/components/${directory.includes('/') && directory.startsWith('ui/') ? directory : directory + component}`] = { [component]: pass };
  }
  const metrics = load('app/[site]/funnels/components/funnelMetrics.ts', mocks);
  mocks['./funnelMetrics'] = metrics;
  mocks['./components/funnelMetrics'] = metrics;
  mocks['./components/FunnelStatBand'] = load('app/[site]/funnels/components/FunnelStatBand.tsx', mocks);
  const Page = load('app/[site]/funnels/page.tsx', mocks).default;
  renderToStaticMarkup(React.createElement(Page));
  return { cells, requests };
}
const ready = { data: summary, isLoading: false, isPending: false };
const pending = { isLoading: true, isPending: true };

describe('funnel page loading', () => {
  it('shows current figures while only the comparison cell waits', () => {
    const { cells } = render({ current: ready, previous: pending });
    expect(cells.map(cell => cell.loading)).to.deep.equal([false, false, true, false]);
    expect(cells[1].value).to.equal('80');
    expect(cells[3].value).to.equal('75.0%');
  });

  it('prioritizes the current period before starting comparison work', () => {
    const { requests, cells } = render({ current: pending, previous: { ...pending, isLoading: false } });
    expect(requests.map(request => request.enabled)).to.deep.equal([true, false]);
    expect(cells.map(cell => cell.loading)).to.deep.equal([false, true, true, true]);
  });

  it('does not analyze empty lists', () => {
    const { requests } = render({ definitions: [], current: pending, previous: pending });
    expect(requests.every(request => request.enabled === false)).to.equal(true);
  });
});
