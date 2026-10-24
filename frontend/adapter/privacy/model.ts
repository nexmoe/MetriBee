const fields = new Set(["site", "siteName", "propertyName", "domain", "url", "accountName", "accountId", "propertyId", "siteId", "clientEmail", "gcpProject", "gcpProjectNumber"]);
const generic = new Set(["ga4", "google analytics", "google analytics 4", "unknown", "(not set)"]);

export function privacyTerms(sources: { value: unknown; metadata?: boolean }[]) {
  const terms = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const text = String(value).trim();
    if (text.length < 2 || generic.has(text.toLowerCase()) || (/^\d+$/.test(text) && text.length < 5)) return;
    terms.add(text);
    const clean = text.replace(/\s*[-–—]?\s+GA4$/i, "").trim();
    if (clean.length > 1 && !generic.has(clean.toLowerCase())) terms.add(clean);
    try {
      const host = new URL(text.includes("://") ? text : `https://${text}`).hostname;
      if (host.includes(".") && !host.includes(" ")) {
        terms.add(host);
        terms.add(host.replace(/^www\./, ""));
      }
    } catch { /* Names need no URL representation. */ }
  };
  const walk = (value: unknown, metadata: boolean, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 7) return;
    if (Array.isArray(value)) { value.forEach(item => walk(item, metadata, depth + 1)); return; }
    for (const [key, item] of Object.entries(value)) {
      if (fields.has(key) || (metadata && (key === "name" || key === "id"))) add(item);
      if (item && typeof item === "object") walk(item, metadata, depth + 1);
    }
  };
  sources.forEach(source => walk(source.value, !!source.metadata));
  return [...terms].sort();
}

export function privacyMatcher(terms: string[]) {
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const names = escaped.length ? new RegExp(`(?<![a-z0-9_])(?:${escaped.join("|")})(?![a-z0-9_])`, "iu") : null;
  const unicodeNames = terms.filter(term => /[^\x00-\x7f]/.test(term));
  return (value: string) => {
    const text = value.trim();
    return !!text && (
      !!names?.test(text) || unicodeNames.some(name => text.includes(name)) ||
      /\bhttps?:\/\/\S+/i.test(text) ||
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
      /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\b|\/)/i.test(text) ||
      /^\/(?:\S*)$/.test(text)
    );
  };
}

export function privacyShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "isComposing" | "defaultPrevented">, editing: boolean) {
  return event.key.toLowerCase() === "p" && !editing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat && !event.isComposing && !event.defaultPrevented;
}
