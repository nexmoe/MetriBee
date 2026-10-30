// GA4 journey labels supplement the imported Rybbit message catalogs.
export const journeyMessages: Record<string, Record<string, string>> = {
  zh: {
    "GA4 exported events. Paths use the selected period; recent exports may still be processing.":
      "GA4 导出事件：路径按所选周期计算，近期导出数据可能仍在处理中。",
    "Page transitions": "页面流向",
    "View page transitions": "查看页面流向",
    "Demo session events. Paths, exits and session lists use synthetic data for this property.":
      "演示会话数据：路径、退出统计和会话列表使用当前站点的模拟数据。",
    "Session event data required": "需要会话事件数据",
    "Multi-step journeys, session lists and exits need ordered session events. This GA4 connection currently provides referrer-to-page views.":
      "多步路径、会话列表和退出统计需要按时间排序的会话事件。当前 GA4 连接仅提供来源页到当前页的汇总浏览量。",
    "Internal page views": "站内流转浏览量",
    "Views per session": "每次会话浏览量",
    "Page views": "浏览量",
    "{count} page views": "{count} 次浏览",
    "{percent} of {total} page views": "占全部 {total} 次浏览的 {percent}",
    "View share": "浏览占比",
    "Explore": "探索",
    "Across all sessions in the selected period": "所选周期内全部会话的平均值",
    "Top referring page": "主要来源页",
    "Top destination": "主要目标页",
    "{percent} of internal page views leave here": "{percent} 的站内流转浏览量来自此页",
    "{percent} of internal page views arrive here": "{percent} 的站内流转浏览量到达此页",
    "Referring page": "来源页",
    "Current page": "当前页",
    "2 pages": "两页流向",
    "Why only two pages?": "为什么只显示两页？",
    "Each link counts page views from a referring page to the current page. These aggregates cannot identify a visitor's complete session path.":
      "每条连线统计从来源页到当前页的浏览量。这些汇总数据无法还原访客的完整会话路径。",
    "Rybbit's multi-step journeys, session lists and exits require ordered event-level data, such as a GA4 BigQuery export. The current GA4 connection provides two-page aggregates.":
      "Rybbit 的多步路径、会话列表和退出统计需要有顺序的逐事件数据，例如 GA4 的 BigQuery 导出。当前 GA4 连接仅提供两页汇总数据。",
    "Clear page filters": "清除页面筛选",
    "Two-page transitions reported by GA4 referrers": "基于 GA4 来源信息的两页流向统计",
    "Top {count} paths cover <b>{covered}</b> of {total} internal page views ({percent})":
      "前 {count} 条流向覆盖 <b>{covered}</b> / {total} 次站内流转浏览量（{percent}）",
    "Bar height is page views on the transitions shown. Click a path to pin it; a page name opens it in <link>Pages</link>.":
      "柱高表示图中流向的浏览量。点击流向可固定详情；点击页面名称可打开<link>页面报告</link>。",
    "Page views on the transition": "页面流转浏览量",
    "No transitions match these pages": "没有匹配这些页面的流向",
    "No internal page transitions": "暂无站内页面流向",
    "Try another referring page, current page or date range. Referrers may be missing for some page views.":
      "请尝试其他来源页、当前页或日期范围。部分浏览记录可能缺少来源信息。",
    "No same-site referrer pairs were reported. Try a wider date range; page views without a same-site referrer are excluded.":
      "未报告站内来源页与当前页的数据。请尝试扩大日期范围；没有站内来源信息的浏览记录不计入此报告。",
    "Share of outgoing page views from the referring page, among the transitions shown.":
      "占图中所示来源页流出浏览量的比例。",
    "Share of all retrieved internal page views": "占已获取的全部站内流转浏览量的比例",
    "Change in page views against the comparison period": "相较对比周期的浏览量变化",
    "Sankey diagram of the top {count} referring-page to current-page transitions":
      "前 {count} 条从来源页到当前页的流向桑基图",
    "{count} page views · {percent} of internal page views":
      "{count} 次浏览 · 占站内流转浏览量的 {percent}",
    "{count} page views · {percent} of shown traffic from {page}":
      "{count} 次浏览 · 占图中 {page} 流出浏览量的 {percent}",
    "GA4 referrer transitions, {steps} pages": "GA4 来源页流向 · {steps} 页",
    "page views": "次浏览",
    "of internal page views": "占站内流转浏览量",
  },
};
