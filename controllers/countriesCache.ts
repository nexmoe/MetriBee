/**
 * countriesCache.ts
 * Country metadata from the bundled fallbackCountries.json.
 * Provides helpers for country coordinates, names, and capitals.
 * Loaded once into memory on first use.
 */

import fs from "fs";
import path from "path";


// ── Types ──────────────────────────────────────────────────────────────────

export interface CountryInfo {
  /** ISO 3166-1 alpha-2 code (e.g. "US") */
  cca2: string;
  /** Common name (e.g. "United States") */
  name: string;
  /** Geographic centroid [lat, lng] */
  latlng: [number, number] | null;
  /** Capital city name (first capital listed) */
  capital: string | null;
  /** Capital city lat/lng */
  capitalLatlng: [number, number] | null;
  /** Top-level domain(s) */
  tld: string[];
  /** FIFA country code */
  fifa: string | null;
}

// ── Config ────────────────────────────────────────────────────────────────

// ponytail: bundled list only. restcountries.com v3.1 was deprecated (every call now returns an
// error object), and country names, capitals and centroids rarely change. Refresh the JSON by hand.
const FALLBACK_PATH = path.join(__dirname, "fallbackCountries.json");

// ── In-memory store ────────────────────────────────────────────────────────

let countryMap: Map<string, CountryInfo> | null = null; // keyed by uppercase cca2

function readFallback(): CountryInfo[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(FALLBACK_PATH, "utf-8"));
    if (Array.isArray(parsed)) return parsed as CountryInfo[];
    if (Array.isArray(parsed?.countries)) return parsed.countries as CountryInfo[];
  } catch (err) {
    console.warn("[countriesCache] Failed to read bundled countries file:", String(err));
  }
  return [];
}

async function loadCountries(): Promise<Map<string, CountryInfo>> {
  if (!countryMap) countryMap = new Map(readFallback().map((c) => [c.cca2.toUpperCase(), c]));
  return countryMap;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get full country info by ISO2 code.
 * @example await getCountry("IN") // → { name: "India", latlng: [20, 77], ... }
 */
export async function getCountry(cca2: string): Promise<CountryInfo | undefined> {
  const map = await loadCountries();
  return map.get(cca2.toUpperCase());
}

/**
 * Get [lat, lng] for a country's geographic centroid.
 * Falls back to capital coordinates if centroid is missing.
 */
export async function getCountryLatLng(cca2: string): Promise<[number, number] | null> {
  const c = await getCountry(cca2);
  if (!c) return null;
  return c.latlng ?? c.capitalLatlng ?? null;
}

/**
 * Get capital city [lat, lng] by country ISO2 code.
 * Useful as a fallback coordinate when city-level lookup fails.
 */
export async function getCapitalLatLng(cca2: string): Promise<[number, number] | null> {
  const c = await getCountry(cca2);
  return c?.capitalLatlng ?? c?.latlng ?? null;
}

/**
 * Get common country name by ISO2 code.
 * @example await getCountryName("DE") // → "Germany"
 */
export async function getCountryName(cca2: string): Promise<string> {
  const c = await getCountry(cca2);
  return c?.name ?? cca2;
}

/**
 * Warm the cache on startup without blocking.
 * Call this once at app startup so initial API requests don't need to wait.
 */
export function warmCountriesCache(): void {
  loadCountries().catch((err) =>
    console.warn("[countriesCache] Warm failed:", String(err))
  );
}

/**
 * Returns all loaded countries sorted by name.
 */
export async function getAllCountries(): Promise<CountryInfo[]> {
  const map = await loadCountries();
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
