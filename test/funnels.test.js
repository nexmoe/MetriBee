const { expect } = require('chai');
const { createFunnels, normalizeSteps, stepsFromTable, pagePattern, MAX_SUMMARY_FUNNELS } = require('../controllers/funnels');

const table = steps => ({
  dimensionHeaders: [{ name: 'funnelStepName' }],
  metricHeaders: [
    { name: 'activeUsers' }, { name: 'funnelStepCompletionRate' },
    { name: 'funnelStepAbandonments' }, { name: 'funnelStepAbandonmentRate' },
  ],
  rows: steps.map(step => ({
    dimensionValues: [{ value: step.label }],
    metricValues: [step.users, step.completion, step.abandoned, step.abandonment].map(value => ({ value: String(value) })),
  })),
  metadata: { samplingMetadatas: [] },
});

describe('GA4 summaries for the native Rybbit funnels page', () => {
  const definition = (id, first = 'page_view') => ({
    id, name: `Funnel ${id}`, steps: [{ type: 'event', value: first }, { type: 'event', value: 'purchase' }],
  });
  const response = (request, users = [80, 20]) => ({ funnelTable: table(request.funnel.steps.map((step, i) => ({
    label: `${i + 1}. ${step.name}`, users: users[i], completion: i ? 0 : users[1] / users[0],
    abandoned: i ? 0 : users[0] - users[1], abandonment: i ? 0 : 1 - users[1] / users[0],
  }))) });

  it('returns native step metrics and counts overlapping funnel entrants with a GA4 union', async () => {
    const requests = [];
    const handle = handler({
      store: { list: async () => [definition(1), definition(2, 'session_start')] },
      client: () => ({ runFunnelReport: async request => {
        requests.push(request);
        return [response(request, request.funnel.steps[0].filterExpression.orGroup ? [100, 30] : [80, 20])];
      } }),
    });
    const result = await invoke(handle, { method: 'GET', action: 'summary', query: {
      ...dates, filters: JSON.stringify([{ parameter: 'device_type', type: 'equals', value: ['mobile'] }]),
    } });
    expect(result.status).to.equal(200);
    expect(result.body.data.users_entered_any).to.equal(100);
    expect(result.body.data).to.include({ metric: 'activeUsers', truncated: false, sampled: false });
    expect(result.body.data.funnels.map(funnel => funnel.funnel_id)).to.deep.equal([1, 2]);
    expect(result.body.data.funnels[0].steps).to.deep.equal([
      { sessions: 80, median_seconds_to_next: null }, { sessions: 20, median_seconds_to_next: null },
    ]);
    expect(result.body.data.funnels[0].median_seconds_to_convert).to.equal(null);
    expect(requests).to.have.length(3);
    expect(requests.every(request => request.dimensionFilter.filter.fieldName === 'deviceCategory')).to.equal(true);
    expect(requests.every(request => request.dateRanges[0].startDate === dates.start_date)).to.equal(true);
    expect(requests[2].funnel.steps[0].filterExpression.orGroup.expressions).to.have.length(2);
    expect(result.body.reportStatus.cacheStatus).to.equal('fresh');
  });

  it('deduplicates concurrent summaries and shared funnel rules without a redundant union call', async () => {
    let calls = 0, active = 0, maximum = 0;
    const handle = handler({
      store: { list: async () => [definition(1), definition(2)] },
      client: () => ({ runFunnelReport: async request => {
        calls++; maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--; return [response(request)];
      } }),
    });
    const input = { method: 'GET', action: 'summary', query: dates };
    const results = await Promise.all([invoke(handle, input), invoke(handle, input)]);
    expect(results.map(result => result.body.data.users_entered_any)).to.deep.equal([80, 80]);
    expect(calls).to.equal(1);
    expect(maximum).to.equal(1);
    await invoke(handle, input);
    expect(calls).to.equal(1); // Completed reports are shared across page visits.
  });

  it('preserves successful funnels and union entrants when one funnel fails', async () => {
    let calls = 0;
    const handle = handler({
      store: { list: async () => [definition(1), definition(2, 'broken'), definition(3, 'session_start')] },
      client: () => ({ runFunnelReport: async request => {
        calls++;
        if (request.funnel.steps[0].filterExpression.funnelEventFilter?.eventName === 'broken') throw new Error('TLS socket disconnected');
        return [response(request)];
      } }),
    });
    const input = { method: 'GET', action: 'summary', query: dates };
    const result = await invoke(handle, input);
    expect(result.status).to.equal(200);
    expect(result.body.data.funnels.map(funnel => funnel.funnel_id)).to.deep.equal([1, 3]);
    expect(result.body.data.users_entered_any).to.equal(80);
    expect(result.body.data.errors.map(item => item.funnel_id)).to.deep.equal([2]);
    await invoke(handle, input);
    expect(calls).to.equal(5); // Only the failed analysis is retried.
  });

  it('keeps row metrics when the distinct entrant union fails, without inventing a total', async () => {
    const handle = handler({
      store: { list: async () => [definition(1), definition(2, 'session_start')] },
      client: () => ({ runFunnelReport: async request => {
        if (request.funnel.steps[0].filterExpression.orGroup) throw new Error('TLS socket disconnected');
        return [response(request)];
      } }),
    });
    const result = await invoke(handle, { method: 'GET', action: 'summary', query: dates });
    expect(result.status).to.equal(200);
    expect(result.body.data.funnels).to.have.length(2);
    expect(result.body.data.users_entered_any).to.equal(undefined);
    expect(result.body.data.errors).to.have.length(1);
  });

  it('serves stale figures immediately, deduplicates refreshes and preserves fetch time on failures', async () => {
    let entry, complete, calls = 0;
    let clock = new Date('2026-10-22T00:00:00Z');
    const handle = handler({
      now: () => clock,
      store: { list: async () => [definition(1)] },
      readEntry: async () => entry,
      write: async (_namespace, _key, data) => { entry = { data, cachedAt: data.fetchedAt }; },
      client: () => ({ runFunnelReport: async request => {
        calls++;
        if (calls > 1) await new Promise((resolve, reject) => { complete = { resolve, reject }; });
        return [response(request, [80 + calls, 20])];
      } }),
    });
    const input = { method: 'GET', action: 'summary', query: dates };
    const first = await invoke(handle, input);
    entry.stale = true;
    clock = new Date('2026-10-22T00:06:00Z');
    const stale = await invoke(handle, input);
    expect(stale.body.data.users_entered_any).to.equal(81);
    expect(stale.body.reportStatus).to.include({ cacheStatus: 'cached', revalidating: true, fetchedAt: first.body.reportStatus.fetchedAt });
    await invoke(handle, input);
    expect(calls).to.equal(2);
    complete.reject(new Error('TLS socket disconnected'));
    await new Promise(resolve => setImmediate(resolve));
    const failed = await invoke(handle, input);
    expect(calls).to.equal(2); // Failed background refresh is in cooldown.
    expect(failed.body.data.users_entered_any).to.equal(81);
    expect(failed.body.reportStatus.revalidating).to.equal(undefined);
    clock = new Date('2026-10-22T00:08:00Z');
    await invoke(handle, input);
    expect(calls).to.equal(3);
    complete.resolve();
    await new Promise(resolve => setImmediate(resolve));
    const refreshed = await invoke(handle, input);
    expect(refreshed.body.data.users_entered_any).to.equal(83);
    expect(refreshed.body.reportStatus.fetchedAt).to.equal(clock.toISOString());
    expect(refreshed.body.reportStatus.revalidating).to.equal(undefined);
  });

  it('shares cached analysis with summaries but isolates dates, filters, properties and edited steps', async () => {
    let calls = 0;
    const records = [definition(1)];
    const handle = handler({
      properties: async () => ({ properties: [{ id: '123' }, { id: '456' }] }),
      store: { list: async () => records },
      client: () => ({ runFunnelReport: async request => { calls++; return [response(request)]; } }),
    });
    const input = { method: 'GET', action: 'summary', query: dates };
    await invoke(handle, input);
    const analyzed = await invoke(handle, { query: dates, body: { steps: records[0].steps } });
    expect(analyzed.body.cached).to.equal(true);
    expect(calls).to.equal(1);
    await invoke(handle, { ...input, propertyId: '456' });
    await invoke(handle, { ...input, query: { ...dates, start_date: '2026-10-02' } });
    await invoke(handle, { ...input, query: { ...dates, filters: JSON.stringify([{ parameter: 'device_type', type: 'equals', value: ['mobile'] }]) } });
    records[0].steps[1].value = 'refund';
    await invoke(handle, input);
    expect(calls).to.equal(5);
  });

  it('caps summary work, bounds concurrency, and reports sampling without inventing step times', async () => {
    let calls = 0, active = 0, maximum = 0;
    const handle = handler({
      store: { list: async () => Array.from({ length: MAX_SUMMARY_FUNNELS + 1 }, (_, i) => definition(i + 1, `event_${i}`)) },
      client: () => ({ runFunnelReport: async request => {
        calls++; maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 1));
        active--;
        const result = response(request);
        result.funnelTable.metadata.samplingMetadatas = [{ samplesReadCount: '10', samplingSpaceSize: '100' }];
        return [result];
      } }),
    });
    const results = await Promise.all([
      invoke(handle, { method: 'GET', action: 'summary', query: dates }),
      invoke(handle, { method: 'GET', action: 'summary', query: { start_date: '2026-09-01', end_date: '2026-09-22' } }),
    ]);
    for (const result of results) {
      expect(result.body.data.funnels).to.have.length(MAX_SUMMARY_FUNNELS);
      expect(result.body.data).to.include({ truncated: true, sampled: true });
    }
    expect(calls).to.equal(2 * (MAX_SUMMARY_FUNNELS + 1));
    expect(maximum).to.equal(3);
  });

  it('does not request GA4 for empty lists, validates filters, and retries failed summaries', async () => {
    let calls = 0;
    let records = [];
    const handle = handler({
      store: { list: async () => records },
      client: () => ({ runFunnelReport: async request => {
        if (++calls === 1) throw new Error('TLS socket disconnected');
        return [response(request)];
      } }),
    });
    const input = { method: 'GET', action: 'summary', query: dates };
    expect((await invoke(handle, input)).body.data).to.include({ users_entered_any: 0, truncated: false });
    expect(calls).to.equal(0);
    expect((await invoke(handle, { ...input, query: { ...dates, filters: 'invalid' } })).status).to.equal(400);
    records = [definition(1)];
    expect((await invoke(handle, input)).status).to.equal(502);
    expect((await invoke(handle, input)).body.data.users_entered_any).to.equal(80);
    expect((await invoke(handle, { ...input, method: 'POST' })).status).to.equal(405);
  });
});

function handler(overrides = {}) {
  const cached = new Map();
  return createFunnels({
    properties: async () => ({ properties: [{ id: '123', site: 'Example', timeZone: 'UTC' }] }),
    readEntry: async (_namespace, key) => cached.get(key) || null,
    write: async (_namespace, key, data) => { cached.set(key, { data, cachedAt: data.fetchedAt }); },
    now: () => new Date('2026-10-22T00:00:00Z'),
    client: () => ({ runFunnelReport: async () => [{ funnelTable: table([]) }] }),
    events: async () => [{ eventName: 'session_start', users: 10 }],
    ...overrides,
  });
}
async function invoke(handle, { method = 'POST', propertyId = '123', action = 'analyze', query = {}, body = {} } = {}) {
  const result = { status: 200 };
  await handle({ method, params: { propertyId, action }, query, body }, {
    headers(values) { for (const [key, value] of Object.entries(values)) this.header(key, value); return this; },
    header(key, value) { result.headers ||= {}; result.headers[key] = value; return this; },
    status(code) { result.status = code; return this; }, send(payload) { result.body = payload; return this; },
  });
  return result;
}
const dates = { start_date: '2026-10-01', end_date: '2026-10-22' };

describe('GA4 ordered funnels', () => {
  it('reads ordered active users and keeps GA4 abandonment counts', () => {
    const rows = stepsFromTable(table([
      { label: '1. Session start', users: 100, completion: 0.4, abandoned: 60, abandonment: 0.6 },
      { label: '2. Purchase', users: 40, completion: 0, abandoned: 0, abandonment: 0 },
    ]), [{ name: 'Session start' }, { name: 'Purchase' }]);
    expect(rows.map(row => row.users)).to.deep.equal([100, 40]);
    expect(rows[1]).to.include({ sessions: 40, conversion_rate: 40, dropoff_rate: 60, ga4_step_abandonments: 0, ga4_step_abandonment_rate: 0 });
    expect(rows[0]).to.include({ dropoff_rate: 0, ga4_step_abandonments: 60, ga4_step_abandonment_rate: 0.6 });
  });

  it('does not treat a breakdown row as the step total', () => {
    const broken = table([{ label: '1. Start', users: 5, completion: 1, abandoned: 0, abandonment: 0 }]);
    broken.dimensionHeaders.push({ name: 'deviceCategory' });
    broken.rows[0].dimensionValues.push({ value: 'mobile' });
    expect(() => stepsFromTable(broken, [{ name: 'Start' }, { name: 'Next' }])).to.throw(/omitted ordered users/);
  });

  it('sends a closed runFunnelReport and returns its ordered users', async () => {
    const requests = [];
    const handle = handler({ client: () => ({ runFunnelReport: async request => {
      requests.push(request);
      return [{ funnelTable: table([
        { label: '1. Session start', users: 80, completion: 0.25, abandoned: 60, abandonment: 0.75 },
        { label: '2. Purchase', users: 20, completion: 0, abandoned: 0, abandonment: 0 },
      ]) }];
    } }) });
    const result = await invoke(handle, { query: dates, body: { steps: [
      { type: 'event', value: 'session_start', name: 'Session start' },
      { type: 'event', value: 'purchase', name: 'Purchase' },
    ] } });
    expect(result.status).to.equal(200);
    expect(result.body.reportStatus).to.deep.equal({ fetchedAt: result.body.fetchedAt, cacheStatus: 'fresh' });
    expect(Number.isFinite(Date.parse(result.body.reportStatus.fetchedAt))).to.equal(true);
    expect(requests[0].funnel.isOpenFunnel).to.equal(false);
    expect(requests[0].funnel.steps[1].filterExpression.funnelEventFilter.eventName).to.equal('purchase');
    expect(requests[0].property).to.equal('properties/123');
    expect(result.body.data.map(row => row.users)).to.deep.equal([80, 20]);
    expect(result.body).to.include({ source: 'ga4-runFunnelReport', metric: 'activeUsers', ordered: true });
  });

  it('rejects incomplete steps, invalid parameters, unsupported filters and unknown properties before GA4', async () => {
    let calls = 0;
    const handle = handler({ client: () => ({ runFunnelReport: async () => { calls += 1; return [{ funnelTable: table([]) }]; } }) });
    expect((await invoke(handle, { body: { steps: [{ type: 'event', value: 'purchase' }] } })).status).to.equal(400);
    expect((await invoke(handle, { query: dates, body: { steps: [
      { type: 'event', value: 'purchase', propertyFilters: [{ key: 'invalid key', value: '9' }] },
      { type: 'event', value: 'refund' },
    ] } })).status).to.equal(422);
    expect((await invoke(handle, { query: { ...dates, filters: JSON.stringify([{ parameter: 'user_id', type: 'equals', value: ['1'] }]) }, body: { steps: [
      { type: 'event', value: 'session_start' }, { type: 'event', value: 'purchase' },
    ] } })).status).to.equal(422);
    expect((await invoke(handle, { propertyId: '999', query: dates, body: { steps: [
      { type: 'event', value: 'session_start' }, { type: 'event', value: 'purchase' },
    ] } })).status).to.equal(404);
    expect(calls).to.equal(0);
  });

  it('translates one page wildcard and refuses multiple wildcards', () => {
    expect(pagePattern('/blog/*').stringFilter.value).to.equal('^/blog/[^/]+$');
    expect(normalizeSteps([{ type: 'page', value: '/pricing' }, { type: 'event', value: 'purchase' }])[0].filterExpression.funnelFieldFilter.fieldName).to.equal('pagePath');
    expect(() => normalizeSteps([{ type: 'page', value: '/docs/**/intro' }, { type: 'event', value: 'purchase' }])).to.throw(/\*\*/);
  });

  it('lists real event names without describing them as funnel users', async () => {
    const result = await invoke(handler(), { method: 'GET', action: 'events', query: dates });
    expect(result.body).to.deep.equal({ data: [{ eventName: 'session_start', users: 10 }], source: 'ga4-event-users', ordered: false });
  });

  it('applies the selected dates and audience, deduplicating identical analyses', async () => {
    let calls = 0, request;
    const handle = handler({ client: () => ({ runFunnelReport: async value => {
      calls++; request = value;
      await new Promise(resolve => setTimeout(resolve, 5));
      return [{ funnelTable: table([
        { label: '1. session_start', users: 30, completion: 0.2, abandoned: 24, abandonment: 0.8 },
        { label: '2. purchase', users: 6, completion: 0, abandoned: 0, abandonment: 0 },
      ]) }];
    } }) });
    const input = { query: { ...dates, filters: JSON.stringify([{ parameter: 'channel', type: 'equals', value: ['AI Assistant'] }]) },
      body: { steps: [{ type: 'event', value: 'session_start' }, { type: 'event', value: 'purchase' }] } };
    const results = await Promise.all([invoke(handle, input), invoke(handle, input)]);
    expect(results.map(result => result.status)).to.deep.equal([200, 200]);
    expect(calls).to.equal(1);
    expect(request.dateRanges).to.deep.equal([{ startDate: '2026-10-01', endDate: '2026-10-22' }]);
    expect(request.dimensionFilter.filter).to.deep.include({ fieldName: 'sessionDefaultChannelGroup' });
    expect(request.dimensionFilter.filter.stringFilter.value).to.equal('AI Assistant');
    await invoke(handle, input);
    expect(calls).to.equal(1);
    expect(results[0].headers['Cache-Control']).to.equal('no-store');
  });

  it('does not cache a connection failure or expose SDK request URLs', async () => {
    let writes = 0;
    const handle = handler({ write: async () => { writes++; }, client: () => ({ runFunnelReport: async () => {
      throw new Error('request to https://analyticsdata.googleapis.com/private-request failed: TLS socket disconnected');
    } }) });
    const result = await invoke(handle, { query: dates, body: { steps: [
      { type: 'event', value: 'session_start' }, { type: 'event', value: 'purchase' },
    ] } });
    expect(result.status).to.equal(502); expect(writes).to.equal(0);
    expect(result.body.error).to.equal('Could not connect to Google Analytics. Please try again.');
  });

  it('applies event hostname conditions and preserves exact event parameter conditions', () => {
    const event = normalizeSteps([{ type: 'event', value: 'session_start', hostname: 'example.com' }, { type: 'event', value: 'purchase' }])[0];
    expect(event.filterExpression.andGroup.expressions[1].funnelFieldFilter.fieldName).to.equal('hostName');
    const filtered = normalizeSteps([{ type: 'event', value: 'page_view', eventPropertyKey: 'page_type', eventPropertyValue: 'tool' }, { type: 'event', value: 'purchase' }])[0];
    expect(filtered.propertyFilters).to.deep.equal([{ key: 'page_type', value: 'tool' }]);
    expect(filtered.filterExpression.funnelEventFilter).to.deep.equal({
      eventName: 'page_view', funnelParameterFilterExpression: { andGroup: { expressions: [{ funnelParameterFilter: {
        eventParameterName: 'page_type', stringFilter: { matchType: 'EXACT', value: 'tool', caseSensitive: true },
      } }] } },
    });
    expect(() => normalizeSteps([{ type: 'page', value: '/', propertyFilters: [{ key: 'utm_source', value: 'google' }] }, { type: 'event', value: 'purchase' }])).to.throw(/URL parameter/);
  });

  it('preserves imported production-host allowlists on event and page steps', () => {
    const steps = normalizeSteps([
      { type: 'event', value: 'session_start', hostname: 'example.com, www.example.com' },
      { type: 'page', value: '/download', hostname: 'example.com, www.example.com' },
    ]);
    for (const step of steps) {
      expect(step.filterExpression.andGroup.expressions[1].funnelFieldFilter).to.deep.equal({
        fieldName: 'hostName', inListFilter: { values: ['example.com', 'www.example.com'], caseSensitive: false },
      });
    }
    expect(() => normalizeSteps([{ type: 'event', value: 'page_view', hostname: ', ,' }, { type: 'event', value: 'purchase' }])).to.throw(/hostnames/);
  });

  it('saves, loads and deletes rules without fetching or saving GA4 counts', async () => {
    const definitions = [];
    const handle = handler({
      client: () => { throw new Error('Saving rules must not request GA4'); },
      store: {
        list: async () => definitions,
        save: async (_id, value) => { definitions.push({ id: 1, ...value }); return definitions[0]; },
        remove: async (_id, id) => { definitions.splice(definitions.findIndex(item => item.id === id), 1); },
      },
    });
    const steps = [{ type: 'event', value: 'page_view', propertyFilters: [{ key: 'page_type', value: 'tool' }] }, { type: 'event', value: 'tool_file_added' }];
    expect((await invoke(handle, { action: 'definitions', body: { name: 'Tools', steps, users: [99, 50] } })).body.funnelId).to.equal(1);
    const listed = await invoke(handle, { method: 'GET', action: 'definitions' });
    expect(listed.body.data[0].steps[0].propertyFilters).to.deep.equal(steps[0].propertyFilters);
    expect(listed.body.data[0]).not.to.have.property('users');
    expect(listed.body.data[0].steps[0]).not.to.have.property('filterExpression');
    expect((await invoke(handle, { method: 'GET', action: '1' })).status).to.equal(200);
    expect((await invoke(handle, { method: 'GET', propertyId: '999', action: 'definitions' })).status).to.equal(404);
    expect((await invoke(handle, { action: 'definitions', body: { name: '', steps } })).status).to.equal(400);
    expect((await invoke(handle, { action: 'definitions', body: { name: 'Tools', steps, reportId: '../2' } })).status).to.equal(400);
    expect((await invoke(handle, { method: 'DELETE', action: '1' })).status).to.equal(200);
    expect((await invoke(handle, { method: 'GET', action: 'definitions' })).body.data).to.deep.equal([]);
  });
});
