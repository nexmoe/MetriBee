// Adapted from Rybbit. AGPL-3.0-only; see frontend/third-party/NOTICE.md.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDateRange = exports.getCountryName = exports.getCountryFlagUrl = exports.truncateString = exports.safeToFixed = exports.formatNumber = exports.formatDuration = exports.calculateGrowth = void 0;
const luxon_1 = require("luxon");
const calculateGrowth = (current, previous) => {
    const curr = current ?? 0;
    const prev = previous ?? 0;
    if (prev === 0) {
        return { value: curr > 0 ? "+100%" : "0%", isPositive: curr >= 0 };
    }
    const growth = ((curr - prev) / prev) * 100;
    const sign = growth > 0 ? "+" : "";
    return { value: `${sign}${growth.toFixed(1)}%`, isPositive: growth >= 0 };
};
exports.calculateGrowth = calculateGrowth;
const formatDuration = (seconds) => {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
};
exports.formatDuration = formatDuration;
exports.formatNumber = Intl.NumberFormat("en-US", {
    notation: "compact",
}).format;
const safeToFixed = (num, decimals = 1) => {
    if (num == null || isNaN(num)) {
        return "0";
    }
    return num.toFixed(decimals);
};
exports.safeToFixed = safeToFixed;
const truncateString = (str, maxLength = 35) => {
    if (str.length <= maxLength)
        return str;
    return str.slice(0, maxLength - 1) + "…";
};
exports.truncateString = truncateString;
const regionNamesInEnglish = new Intl.DisplayNames(["en"], { type: "region" });
const getCountryFlagUrl = (countryCode) => {
    if (!countryCode || countryCode.length !== 2)
        return "";
    return `https://flagcdn.com/w20/${countryCode.toLowerCase()}.png`;
};
exports.getCountryFlagUrl = getCountryFlagUrl;
const getCountryName = (countryCode) => {
    try {
        return regionNamesInEnglish.of(countryCode.toUpperCase()) || countryCode;
    }
    catch {
        return countryCode;
    }
};
exports.getCountryName = getCountryName;
const formatDateRange = (startDate, endDate, timeZone) => {
    const start = luxon_1.DateTime.fromISO(startDate, { zone: timeZone });
    const end = luxon_1.DateTime.fromISO(endDate, { zone: timeZone });
    const format = "MMMM d, yyyy";
    return `${start.toFormat(format)} - ${end.toFormat(format)}`;
};
exports.formatDateRange = formatDateRange;
