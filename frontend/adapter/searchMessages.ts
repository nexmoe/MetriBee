// Adapter-only messages extend the copied catalogs without changing upstream source.
export const searchMessages: Record<string, Record<string, string>> = {
  zh: {
    "Request activity observed in this process. Today uses Pacific time.":
      "当前进程的请求统计，按美国太平洋时间计算今日用量。",
    "Updating local usage does not query Google.":
      "更新本地用量不会向 Google 发起查询。",
    "Observed since {time}. Counts reset on restart or credential changes.":
      "统计始于 {time}，重启或更换凭证后重新计数。",
    "API limits": "API 限额",
    "Published defaults. Actual remaining quota is unavailable from this API.":
      "官方默认限额，接口不提供实际剩余额度。",
    "Open Google Cloud": "打开 Google Cloud",
    "Search Console API limits": "Search Console API 限额",
    "By site": "按站点查看",
    "Site usage appears after a Search Console report is loaded.":
      "加载 Search Console 报表后，这里会显示各站点的请求用量。",
    "How usage is counted": "统计口径",
    "Observation scope": "统计范围",
    "Request counting": "请求计数",
    "Request concurrency": "请求并发",
    "Query load": "查询负载",
    "GA4 token budgets and Google Search Console request usage.":
      "GA4 令牌配额与 Google Search Console 请求用量。",
    "Local request observations and published API limits.":
      "本地请求统计与官方 API 限额。",
    "Credentials configured": "凭证已配置",
    "Not configured": "未配置",
    "Demo mode": "演示模式",
    "Rate limited": "已限流",
    "Update local usage": "更新本地用量",
    "Search requests today": "今日搜索请求",
    "Report cache hits today": "今日报表缓存命中",
    "API errors today": "今日 API 错误",
    "Rate limits today": "今日限流次数",
    "This process only, including its dashboard and MCP requests. Counts reset on restart or credential changes; other processes and apps are excluded.":
      "仅统计当前进程发出的仪表盘和 MCP 请求。重启或更换凭证后重新计数，不包含其他进程和应用。",
    "Observed since {time}. Today uses Pacific time ({day}).":
      "开始统计：{time}。今日按美国太平洋时间计算（{day}）。",
    "Active / concurrency limit: {active} / {limit}. Queued: {queued}.":
      "当前并发 / 上限：{active} / {limit}，排队：{queued}。",
    "Requests paused until {time}. Cached reports remain available.":
      "请求已暂停至 {time}，缓存报表仍可使用。",
    "Live Search Console usage is hidden in demo mode.":
      "演示模式不展示真实 Search Console 用量。",
    "Configure Search Console credentials to observe local API usage.":
      "配置 Search Console 凭证后即可统计本地 API 用量。",
    "Quota scope": "配额范围",
    "Observed locally": "本地已观测",
    "Published limit": "官方默认上限",
    "Actual remaining": "实际剩余",
    "Search Analytics · per site / minute": "搜索分析 · 每站点 / 分钟",
    "Search Analytics · per user / minute": "搜索分析 · 每用户 / 分钟",
    "Search Analytics · per project / minute": "搜索分析 · 每项目 / 分钟",
    "Search Analytics · per project / day": "搜索分析 · 每项目 / 天",
    "Sites list · per user / minute": "站点列表 · 每用户 / 分钟",
    "Search Analytics by site": "各站点的搜索分析请求",
    "Search Console property": "Search Console 资源",
    "Last minute / limit": "最近一分钟 / 上限",
    "Last API attempt": "最近 API 请求",
    "Search Console does not return remaining quota or query load usage. Local attempts include failures; cache hits make no API request. Minute counts cover the last 60 seconds. Published limits are defaults, not live project settings.":
      "Search Console 不返回剩余配额或查询负载用量。本地请求包含失败尝试，缓存命中不会发送 API 请求；分钟统计为最近 60 秒。表中上限为官方默认值，并非项目实时配置。",
    "Query load also has separate 10-minute and daily limits; no numeric balance is available.":
      "查询负载另有 10 分钟及每日限制，接口不提供可读取的剩余数值。",
    "View actual usage in Google Cloud": "在 Google Cloud 查看实际用量",
    "Google quota documentation": "Google 配额文档",
    "Search trend: {metric}": "搜索趋势：{metric}",
    "Search chart interval": "搜索图表时间粒度",
    "Section search metrics include only the returned top pages.":
      "目录搜索指标仅汇总已返回的主要页面。",
    "Share of all search clicks in the selected period":
      "占所选周期全部搜索点击的比例",
    "Share of all search impressions in the selected period":
      "占所选周期全部搜索展示的比例",
    "Clicks and share of all search clicks in the selected period":
      "搜索点击数及其占所选周期全部搜索点击的比例",
    "Impressions and share of all search impressions in the selected period":
      "搜索展示数及其占所选周期全部搜索展示的比例",
    "Search clicks / search impressions": "搜索点击数 / 搜索展示数",
    "Impression-weighted average search position; lower is better":
      "按展示次数加权的平均搜索排名，越低越好",
    "Search percentages use the whole-period search totals, not this page of results. Missing matches are shown as —.":
      "搜索占比以整个所选周期的搜索总量为分母，不随翻页变化；未匹配到的数据显示为 —。",
    "Section totals use the top 500 search pages; ≥ marks partial counts.":
      "目录仅汇总前 500 个搜索页面，≥ 表示尚不完整的计数。",
    "Search clicks": "搜索点击",
    "Search impressions": "搜索展示",
    "Search CTR": "搜索点击率",
    "Search position": "搜索平均排名",
    "Search Console · Pacific time · delayed data":
      "Search Console · 太平洋时间 · 数据有延迟",
    "Search Console uses final Pacific calendar days. Recent data may be delayed. Search clicks differ from GA4 sessions. Missing matches are shown as —.":
      "Search Console 按美国太平洋时间提供最终数据，最近几天可能延迟。搜索点击与 GA4 会话口径不同，未匹配到的数据显示为 —。",
    "Open page": "打开页面",
    "Load more": "加载更多",
    "Google Search": "Google 搜索",
    "Google Search Console": "Google Search Console",
    "Average position": "平均排名",
    "Lower is better": "越低越好",
    "Clicks / impressions": "点击 / 展示",
    "Search comparison is unavailable.": "搜索数据的对比周期暂不可用。",
    "Dates are limited to Search Console’s available history.":
      "日期已限制在 Search Console 可提供的历史范围内。",
    "Top results; private queries are omitted. Row totals can differ from the summary.":
      "仅展示主要结果，不包含隐私查询；明细合计可能与汇总不同。",
    "Showing the top 500 results by clicks.": "按点击次数展示前 500 条结果。",
    "Google Search unavailable": "Google 搜索数据暂不可用",
    "Google Search: no accessible Search Console property matches this website.":
      "Google 搜索：没有与该网站匹配且可访问的 Search Console 资源。",
    "Final Google Search data · Pacific time · recent days may be delayed. Search clicks differ from GA4 sessions. Top rows exclude private queries.":
      "Google 搜索最终数据 · 美国太平洋时间 · 最近几天的数据可能延迟。搜索点击与 GA4 会话不同，明细不包含隐私查询。",
    "Scoped to this hostname; impressions count each result page.":
      "仅统计该网站主机名，展示次数按搜索结果页面计算。",
  },
};
