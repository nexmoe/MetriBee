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
exports.MetricCard = void 0;
const React = __importStar(require("react"));
const MetricCard = ({ label, currentValue, growth, isPositive }) => (React.createElement("div", { style: {
        backgroundColor: "#f9fafb",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "16px",
        height: "100%",
    } },
    React.createElement("div", { style: { color: "#6b7280", fontSize: "12px", marginBottom: "4px" } }, label),
    React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: "8px" } },
        React.createElement("span", { style: { color: "#111827", fontSize: "24px", fontWeight: "bold" } }, currentValue),
        React.createElement("span", { style: {
                color: isPositive ? "#99aaff" : "#ef4444",
                fontSize: "12px",
                fontWeight: "500",
            } }, growth))));
exports.MetricCard = MetricCard;
