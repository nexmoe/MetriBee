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
exports.SessionsChart = void 0;
const React = __importStar(require("react"));
const luxon_1 = require("luxon");
const utils_js_1 = require("./utils.js");
const formatChartDate = (time, useHours, timeZone) => {
    // ClickHouse returns format like "2024-01-15 14:00:00", need to use SQL format
    const dt = luxon_1.DateTime.fromSQL(time, { zone: timeZone });
    if (useHours) {
        return dt.toFormat("ha").toLowerCase();
    }
    return dt.toFormat("MMM d");
};
const isOneDayOrLess = (startDate, endDate, timeZone) => {
    const start = luxon_1.DateTime.fromISO(startDate, { zone: timeZone });
    const end = luxon_1.DateTime.fromISO(endDate, { zone: timeZone });
    const diffDays = end.diff(start, "days").days;
    return diffDays <= 1;
};
const SessionsChart = ({ data, startDate, endDate, timeZone }) => {
    if (data.length === 0)
        return null;
    const useHours = isOneDayOrLess(startDate, endDate, timeZone);
    const width = 680;
    const height = 220;
    const margin = { top: 10, right: 15, bottom: 30, left: 45 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;
    // Get sessions values and calculate bounds
    const sessions = data.map(d => Number(d.sessions) || 0);
    const maxValue = Math.max(...sessions, 1);
    const minValue = 0;
    // Scale functions
    const xScale = (index) => margin.left + (index / (data.length - 1 || 1)) * chartWidth;
    const yScale = (value) => margin.top + chartHeight - ((value - minValue) / (maxValue - minValue || 1)) * chartHeight;
    // Generate path for area
    const areaPath = data
        .map((d, i) => {
        const x = xScale(i);
        const y = yScale(Number(d.sessions) || 0);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
        .join(" ") +
        ` L ${xScale(data.length - 1)} ${margin.top + chartHeight} L ${margin.left} ${margin.top + chartHeight} Z`;
    // Generate path for line
    const linePath = data
        .map((d, i) => {
        const x = xScale(i);
        const y = yScale(Number(d.sessions) || 0);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    })
        .join(" ");
    // Generate Y-axis ticks
    const yTickCount = 5;
    const yTicks = Array.from({ length: yTickCount }, (_, i) => {
        const value = minValue + ((maxValue - minValue) * i) / (yTickCount - 1);
        return { value, y: yScale(value) };
    });
    // Generate X-axis ticks (limit to ~8 ticks)
    const xTickCount = Math.min(data.length, 8);
    const xTickInterval = Math.max(1, Math.floor(data.length / xTickCount));
    const xTicks = data
        .map((d, i) => ({ label: formatChartDate(d.time, useHours, timeZone), x: xScale(i), index: i }))
        .filter((_, i) => i % xTickInterval === 0 || i === data.length - 1);
    // Generate horizontal grid lines
    const gridLines = yTicks.map(tick => tick.y);
    return (React.createElement("div", { style: {
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "16px",
            marginBottom: "24px",
        } },
        React.createElement("div", { style: { color: "#111827", fontSize: "14px", fontWeight: "600", marginBottom: "12px" } }, "Sessions Over Time"),
        React.createElement("svg", { width: width, height: height, style: { display: "block" } },
            React.createElement("defs", null,
                React.createElement("linearGradient", { id: "sessionsGradient", x1: "0", y1: "0", x2: "0", y2: "1" },
                    React.createElement("stop", { offset: "5%", stopColor: "#99aaff", stopOpacity: 0.3 }),
                    React.createElement("stop", { offset: "95%", stopColor: "#99aaff", stopOpacity: 0 }))),
            gridLines.map((y, i) => (React.createElement("line", { key: i, x1: margin.left, y1: y, x2: width - margin.right, y2: y, stroke: "#e5e7eb", strokeDasharray: "3 3" }))),
            React.createElement("path", { d: areaPath, fill: "url(#sessionsGradient)" }),
            React.createElement("path", { d: linePath, fill: "none", stroke: "#99aaff", strokeWidth: 2 }),
            React.createElement("line", { x1: margin.left, y1: margin.top + chartHeight, x2: width - margin.right, y2: margin.top + chartHeight, stroke: "#e5e7eb" }),
            xTicks.map((tick, i) => (React.createElement("text", { key: i, x: tick.x, y: margin.top + chartHeight + 18, textAnchor: "middle", fontSize: 10, fill: "#6b7280" }, tick.label))),
            yTicks.map((tick, i) => (React.createElement("text", { key: i, x: margin.left - 8, y: tick.y + 4, textAnchor: "end", fontSize: 10, fill: "#6b7280" }, (0, utils_js_1.formatNumber)(tick.value)))))));
};
exports.SessionsChart = SessionsChart;
