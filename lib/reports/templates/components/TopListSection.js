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
exports.TopListSection = void 0;
const React = __importStar(require("react"));
const utils_js_1 = require("./utils.js");
const TopListItem = ({ value, percentage, count, barWidth, iconUrl, iconSize }) => (React.createElement("div", { style: {
        display: "flex",
        alignItems: "center",
        padding: "5px 8px",
        marginBottom: "4px",
        borderRadius: "4px",
        position: "relative",
    } },
    React.createElement("div", { style: {
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${barWidth}%`,
            backgroundColor: "rgba(153, 170, 255, 0.15)",
            borderRadius: "6px",
            zIndex: 0,
        } }),
    React.createElement("div", { style: { display: "flex", alignItems: "center", flex: "1", minWidth: "0", position: "relative", zIndex: 1 } },
        iconUrl && (React.createElement("img", { src: iconUrl, alt: "", width: iconSize?.width ?? 16, height: iconSize?.height ?? 16, style: { marginRight: "8px", borderRadius: "2px" } })),
        React.createElement("span", { style: {
                color: "#111827",
                fontSize: "13px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
            }, title: value }, (0, utils_js_1.truncateString)(value, 27))),
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", marginLeft: "12px" } },
        React.createElement("span", { style: { color: "#6b7280", fontSize: "12px", width: "30px", textAlign: "right" } },
            (0, utils_js_1.safeToFixed)(percentage, 1),
            "%"),
        React.createElement("span", { style: { color: "#111827", fontSize: "13px", fontWeight: "500", width: "38px", textAlign: "right" } }, (0, utils_js_1.formatNumber)(count)))));
const TopListSection = ({ title, items, renderLabel, showFavicon, getIconUrl, iconSize, }) => {
    if (items.length === 0)
        return null;
    const ratio = items[0]?.percentage ? 100 / items[0].percentage : 1;
    return (React.createElement("div", { style: {
            backgroundColor: "#ffffff",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            padding: "16px",
            flex: "1",
        } },
        React.createElement("div", { style: { color: "#111827", fontSize: "14px", fontWeight: "600", marginBottom: "12px" } }, title),
        items.map((item, index) => {
            const barWidth = (item.percentage ?? 0) * ratio;
            let iconUrl;
            if (getIconUrl) {
                iconUrl = getIconUrl(item);
            }
            else if (showFavicon) {
                iconUrl = `https://www.google.com/s2/favicons?domain=${item.value}&sz=16`;
            }
            return (React.createElement(TopListItem, { key: index, value: renderLabel(item), percentage: item.percentage, count: item.count, barWidth: barWidth, iconUrl: iconUrl, iconSize: iconSize }));
        })));
};
exports.TopListSection = TopListSection;
