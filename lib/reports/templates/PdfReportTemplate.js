// Adapted from Rybbit. AGPL-3.0-only; see frontend/third-party/NOTICE.md.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdfReportTemplate = void 0;
const React = __importStar(require("react"));
const index_js_1 = require("./components/index.js");
const PdfReportTemplate = ({ reportData }) => {
    const { siteName, siteDomain, startDate, endDate, timeZone, generatedAt, overview, previousOverview, chartData, topCountries, topRegions, topCities, topPages, topReferrers, deviceBreakdown, topBrowsers, topOperatingSystems, } = reportData;
    const metrics = [
        {
            label: "Sessions",
            current: overview.sessions,
            previous: previousOverview?.sessions,
            format: index_js_1.formatNumber,
        },
        {
            label: "Pageviews",
            current: overview.pageviews,
            previous: previousOverview?.pageviews,
            format: index_js_1.formatNumber,
        },
        {
            label: "Unique Users",
            current: overview.users,
            previous: previousOverview?.users,
            format: index_js_1.formatNumber,
        },
        {
            label: "Avg Duration",
            current: overview.session_duration,
            previous: previousOverview?.session_duration,
            format: index_js_1.formatDuration,
        },
        {
            label: "Pages/Session",
            current: overview.pages_per_session,
            previous: previousOverview?.pages_per_session,
            format: (v) => (0, index_js_1.safeToFixed)(v, 1),
        },
        {
            label: "Bounce Rate",
            current: overview.bounce_rate,
            previous: previousOverview?.bounce_rate,
            format: (v) => `${(0, index_js_1.safeToFixed)(v, 1)}%`,
            invertGrowth: true,
        },
    ];
    return (React.createElement("html", null,
        React.createElement("head", null,
            React.createElement("meta", { charSet: "UTF-8" }),
            React.createElement("style", { dangerouslySetInnerHTML: {
                    __html: `
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #111827;
            background: #ffffff;
            line-height: 1.5;
          }
          @page {
            size: A4;
            margin: 0;
          }
          .page {
            padding: 40px;
            max-width: 800px;
            margin: 0 auto;
            page-break-after: always;
            page-break-inside: avoid;
          }
          .page-last {
            page-break-after: auto;
          }
        `,
                } })),
        React.createElement("body", null,
            React.createElement(index_js_1.Page, null,
                React.createElement("div", { style: { marginBottom: "32px", borderBottom: "2px solid #99aaff", paddingBottom: "24px" } },
                    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" } },
                        React.createElement("img", { src: reportData.logoDataUrl, alt: "", width: "28", height: "28", style: { borderRadius: "4px" } }),
                        React.createElement("h1", { style: { fontSize: "28px", fontWeight: "600", color: "#111827" } }, siteName)),
                    React.createElement("div", { style: { color: "#6b7280", fontSize: "14px" } },
                        React.createElement("div", { style: { marginBottom: "4px" } }, (0, index_js_1.formatDateRange)(startDate, endDate, timeZone)),
                        React.createElement("div", null,
                            "Generated on ",
                            generatedAt))),
                React.createElement("div", { style: { marginBottom: "32px" } },
                    React.createElement("h2", { style: { fontSize: "18px", fontWeight: "600", marginBottom: "16px", color: "#111827" } }, "Overview"),
                    React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px" } }, metrics.map((metric, index) => {
                        const growth = (0, index_js_1.calculateGrowth)(metric.current, metric.previous);
                        const isPositive = metric.invertGrowth ? !growth.isPositive : growth.isPositive;
                        return (React.createElement("div", { key: index, style: { width: "calc(33.333% - 8px)", minWidth: "180px" } },
                            React.createElement(index_js_1.MetricCard, { label: metric.label, currentValue: metric.format(metric.current), growth: growth.value, isPositive: isPositive })));
                    }))),
                React.createElement(index_js_1.SessionsChart, { data: chartData, startDate: startDate, endDate: endDate, timeZone: timeZone }),
                React.createElement("div", { style: {
                        marginTop: "auto",
                        paddingTop: "16px",
                        borderTop: "1px solid #e5e7eb",
                        textAlign: "center",
                        color: "#9ca3af",
                        fontSize: "12px",
                    } },
                    React.createElement("div", null, "Powered by MetriBee \u00B7 UI by Rybbit"),
                    React.createElement("div", { style: { marginTop: "4px" } }, "https://github.com/nexmoe/MetriBee"))),
            React.createElement(index_js_1.Page, null,
                React.createElement(index_js_1.TwoColumnRow, { left: React.createElement(index_js_1.TopListSection, { title: "Top Countries", items: topCountries, renderLabel: item => (0, index_js_1.getCountryName)(item.value), iconSize: { width: 20, height: 15 } }), right: React.createElement(index_js_1.TopListSection, { title: "Top Regions", items: topRegions, renderLabel: item => item.value }) }),
                React.createElement(index_js_1.TwoColumnRow, { left: React.createElement(index_js_1.TopListSection, { title: "Top Cities", items: topCities, renderLabel: item => item.value }), right: React.createElement(index_js_1.TopListSection, { title: "Top Pages", items: topPages, renderLabel: item => item.value }) })),
            React.createElement(index_js_1.Page, { isLastPage: true },
                React.createElement(index_js_1.TwoColumnRow, { left: React.createElement(index_js_1.TopListSection, { title: "Top Referrers", items: topReferrers, renderLabel: item => item.value, showFavicon: false }), right: React.createElement(index_js_1.TopListSection, { title: "Devices", items: deviceBreakdown, renderLabel: item => item.value.charAt(0).toUpperCase() + item.value.slice(1) }) }),
                React.createElement(index_js_1.TwoColumnRow, { left: React.createElement(index_js_1.TopListSection, { title: "Browsers", items: topBrowsers, renderLabel: item => item.value }), right: React.createElement(index_js_1.TopListSection, { title: "Operating Systems", items: topOperatingSystems, renderLabel: item => item.value }) })))));
};
exports.PdfReportTemplate = PdfReportTemplate;
