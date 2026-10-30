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
exports.WeeklyReportEmail = void 0;
const components_1 = require("@react-email/components");
const React = __importStar(require("react"));
const calculateGrowth = (current, previous) => {
    const curr = current ?? 0;
    const prev = previous ?? 0;
    if (prev === 0) {
        return curr > 0 ? "+100%" : "0%";
    }
    const growth = ((curr - prev) / prev) * 100;
    const sign = growth > 0 ? "+" : "";
    return `${sign}${growth.toFixed(1)}%`;
};
const formatDuration = (seconds) => {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
};
const formatNumber = (num) => {
    if (num == null || isNaN(num)) {
        return "0";
    }
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toFixed(0);
};
const safeToFixed = (num, decimals = 1) => {
    if (num == null || isNaN(num)) {
        return "0";
    }
    return num.toFixed(decimals);
};
const regionNamesInEnglish = new Intl.DisplayNames(["en"], { type: "region" });
const getCountryFlag = (countryCode) => {
    if (!countryCode || countryCode.length !== 2)
        return "";
    const codePoints = countryCode
        .toUpperCase()
        .split("")
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
};
const getCountryDisplay = (countryCode) => {
    try {
        const flag = getCountryFlag(countryCode);
        const name = regionNamesInEnglish.of(countryCode.toUpperCase()) || countryCode;
        return `${flag} ${name}`;
    }
    catch (error) {
        return countryCode;
    }
};
const MetricCard = ({ label, currentValue, growth, isPositive }) => (React.createElement("div", { style: {
        backgroundColor: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
    } },
    React.createElement(components_1.Text, { style: { color: "#6b7280", fontSize: "12px", marginBottom: "4px", marginTop: 0 } }, label),
    React.createElement("div", null,
        React.createElement("span", { style: { color: "#111827", fontSize: "24px", fontWeight: "bold", lineHeight: "1", marginRight: "8px" } }, currentValue),
        React.createElement("span", { style: {
                color: isPositive ? "#10b981" : "#ef4444",
                fontSize: "12px",
                fontWeight: 500,
                lineHeight: "1",
                verticalAlign: "baseline",
            } }, growth))));
const TopListItem = ({ value, percentage, count, barWidth, isLast, favicon, labelClassName }) => {
    const barStyle = {
        background: `linear-gradient(to right, rgba(16, 185, 129, 0.25) 0%, rgba(16, 185, 129, 0.25) ${barWidth}%, transparent ${barWidth}%, transparent 100%)`,
        borderRadius: "6px",
    };
    return (React.createElement("table", { style: {
            width: "100%",
            marginBottom: isLast ? "0" : "8px",
            borderCollapse: "separate",
            borderSpacing: "0",
            ...barStyle,
        } },
        React.createElement("tbody", null,
            React.createElement("tr", null,
                React.createElement("td", { style: { padding: "4px 8px", verticalAlign: "middle" } }, favicon ? (React.createElement("table", { style: { width: "100%", borderCollapse: "collapse" } },
                    React.createElement("tbody", null,
                        React.createElement("tr", null,
                            React.createElement("td", { style: { width: "16px", paddingRight: "4px", verticalAlign: "middle" } },
                                React.createElement("img", { src: favicon, alt: "", width: "16", height: "16", style: { display: "block" } })),
                            React.createElement("td", { style: { verticalAlign: "middle" } },
                                React.createElement(components_1.Text, { style: {
                                        color: "#111827",
                                        fontSize: "14px",
                                        margin: 0,
                                        lineHeight: "1.2",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    } }, value)))))) : (React.createElement(components_1.Text, { style: { color: "#111827", fontSize: "14px", margin: 0, lineHeight: "1.2" } }, value))),
                React.createElement("td", { style: { padding: "8px", textAlign: "right", verticalAlign: "middle", whiteSpace: "nowrap" } },
                    React.createElement(components_1.Text, { style: { color: "#6b7280", fontSize: "12px", margin: 0, marginRight: "12px", lineHeight: "1.2" } },
                        safeToFixed(percentage, 1),
                        "%")),
                React.createElement("td", { style: { padding: "8px", textAlign: "right", verticalAlign: "middle", whiteSpace: "nowrap", width: "40px" } },
                    React.createElement(components_1.Text, { style: { color: "#111827", fontSize: "14px", fontWeight: 500, margin: 0, lineHeight: "1.2" } }, formatNumber(count)))))));
};
const TopListSection = ({ title, items, renderLabel, showFavicon, labelClassName, className }) => {
    if (items.length === 0)
        return null;
    const ratio = items[0]?.percentage ? 100 / items[0].percentage : 1;
    return (React.createElement("div", { style: {
            backgroundColor: "#f9fafb",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "16px",
        } },
        React.createElement(components_1.Text, { style: { color: "#111827", fontSize: "14px", fontWeight: 600, marginBottom: "12px", marginTop: 0 } }, title),
        items.map((item, index) => {
            const barWidth = (item.percentage ?? 0) * ratio;
            const favicon = showFavicon ? `https://www.google.com/s2/favicons?domain=${item.value}&sz=16` : undefined;
            return (React.createElement(TopListItem, { key: index, value: typeof renderLabel(item) === "string" ? renderLabel(item) : item.value, percentage: item.percentage, count: item.count, barWidth: barWidth, isLast: index === items.length - 1, favicon: favicon, labelClassName: labelClassName }));
        })));
};
const WeeklyReportEmail = ({ userName, organizationName, site, baseURL }) => {
    const currentYear = new Date().getFullYear();
    return (React.createElement(components_1.Html, null,
        React.createElement(components_1.Head, null),
        React.createElement(components_1.Preview, null,
            "Weekly Analytics Report for ",
            organizationName),
        React.createElement(components_1.Tailwind, { config: {
                presets: [components_1.pixelBasedPreset],
                theme: {
                    extend: {
                        colors: {
                            brand: "#10b981",
                            cardBg: "#f9fafb",
                            darkText: "#111827",
                            mutedText: "#6b7280",
                            borderColor: "#e5e7eb",
                            positive: "#10b981",
                            negative: "#ef4444",
                        },
                    },
                },
            } },
            React.createElement(components_1.Body, { className: "bg-white font-sans" },
                React.createElement(components_1.Container, { className: "mx-auto py-8 px-6 max-w-[600px]" },
                    React.createElement(components_1.Img, { src: `${baseURL}/metribee/wordmark.svg`, alt: "MetriBee", width: "120", height: "28", className: "mb-8" }),
                    React.createElement(components_1.Text, { className: "text-darkText text-base leading-relaxed mb-4" },
                        "Hi ",
                        userName,
                        ","),
                    React.createElement(components_1.Text, { className: "text-darkText text-base leading-relaxed mb-8" },
                        "Here's your weekly analytics summary for",
                        " ",
                        React.createElement("span", { className: "font-semibold" }, site.siteDomain),
                        "."),
                    React.createElement(components_1.Section, { className: "mb-10" },
                        React.createElement("table", { style: { width: "100%", marginBottom: "24px" } },
                            React.createElement("tbody", null,
                                React.createElement("tr", null,
                                    React.createElement("td", { style: { width: "50%", paddingRight: "6px", paddingBottom: "12px" } },
                                        React.createElement(MetricCard, { label: "Sessions", currentValue: formatNumber(site.currentWeek.sessions), growth: calculateGrowth(site.currentWeek.sessions, site.previousWeek.sessions), isPositive: site.currentWeek.sessions >= site.previousWeek.sessions })),
                                    React.createElement("td", { style: { width: "50%", paddingLeft: "6px", paddingBottom: "12px" } },
                                        React.createElement(MetricCard, { label: "Pageviews", currentValue: formatNumber(site.currentWeek.pageviews), growth: calculateGrowth(site.currentWeek.pageviews, site.previousWeek.pageviews), isPositive: site.currentWeek.pageviews >= site.previousWeek.pageviews }))),
                                React.createElement("tr", null,
                                    React.createElement("td", { style: { width: "50%", paddingRight: "6px", paddingBottom: "12px" } },
                                        React.createElement(MetricCard, { label: "Unique Users", currentValue: formatNumber(site.currentWeek.users), growth: calculateGrowth(site.currentWeek.users, site.previousWeek.users), isPositive: site.currentWeek.users >= site.previousWeek.users })),
                                    React.createElement("td", { style: { width: "50%", paddingLeft: "6px", paddingBottom: "12px" } },
                                        React.createElement(MetricCard, { label: "Avg Duration", currentValue: formatDuration(site.currentWeek.session_duration), growth: calculateGrowth(site.currentWeek.session_duration, site.previousWeek.session_duration), isPositive: site.currentWeek.session_duration >= site.previousWeek.session_duration }))),
                                React.createElement("tr", null,
                                    React.createElement("td", { style: { width: "50%", paddingRight: "6px" } },
                                        React.createElement(MetricCard, { label: "Pages/Session", currentValue: safeToFixed(site.currentWeek.pages_per_session, 1), growth: calculateGrowth(site.currentWeek.pages_per_session, site.previousWeek.pages_per_session), isPositive: (site.currentWeek.pages_per_session ?? 0) >= (site.previousWeek.pages_per_session ?? 0) })),
                                    React.createElement("td", { style: { width: "50%", paddingLeft: "6px" } },
                                        React.createElement(MetricCard, { label: "Bounce Rate", currentValue: `${safeToFixed(site.currentWeek.bounce_rate, 1)}%`, growth: calculateGrowth(site.currentWeek.bounce_rate, site.previousWeek.bounce_rate), isPositive: (site.currentWeek.bounce_rate ?? 0) <= (site.previousWeek.bounce_rate ?? 0) }))))),
                        React.createElement("div", { className: "mb-6" },
                            React.createElement(TopListSection, { title: "Top Countries", items: site.topCountries, renderLabel: item => getCountryDisplay(item.value) }),
                            React.createElement(TopListSection, { title: "Top Pages", items: site.topPages, renderLabel: item => item.value, labelClassName: "text-darkText text-sm m-0 truncate max-w-[280px]" }),
                            React.createElement(TopListSection, { title: "Top Referrers", items: site.topReferrers, renderLabel: item => item.value, showFavicon: true, labelClassName: "text-darkText text-sm m-0 truncate" }),
                            React.createElement(TopListSection, { title: "Device Breakdown", items: site.deviceBreakdown, renderLabel: item => item.value, labelClassName: "text-darkText text-sm m-0 capitalize", className: "bg-cardBg border border-borderColor rounded-lg p-4" })),
                        React.createElement(components_1.Text, { className: "text-darkText text-base leading-relaxed mb-4" },
                            React.createElement(components_1.Link, { href: `${baseURL}/analytics?prop=${site.siteId}`, className: "text-brand underline" }, "View full dashboard"))),
                    React.createElement(components_1.Text, { className: "text-mutedText text-sm leading-relaxed" }, "This report covers the last 7 days of analytics data."),
                    React.createElement(components_1.Hr, { className: "border-borderColor my-8" }),
                    React.createElement(components_1.Text, { className: "text-mutedText text-xs mb-2" },
                        React.createElement(components_1.Link, { href: `${baseURL}/settings/account`, className: "text-mutedText underline" }, "Unsubscribe from weekly reports")),
                    React.createElement(components_1.Text, { className: "text-mutedText text-xs" },
                        "\u00A9 ",
                        currentYear,
                        " MetriBee \u00B7 UI by Rybbit"))))));
};
exports.WeeklyReportEmail = WeeklyReportEmail;
