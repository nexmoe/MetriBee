export const VERSION_CHECK_DONE_KEY = "metribee.version-check-done";
export const LATEST_RELEASE_URL = "https://api.github.com/repos/nexmoe/MetriBee/releases/latest";
const RELEASES_URL = "https://github.com/nexmoe/MetriBee/releases/tag/";

export interface AppRelease {
  version: string;
  url: string;
}

let checked = false;

export function shouldCheckVersion(): boolean {
  if (typeof window === "undefined" || checked) return false;
  try {
    return !window.sessionStorage.getItem(VERSION_CHECK_DONE_KEY);
  } catch {
    // Storage may be blocked; the in-memory flag still limits this page to one attempt.
    return true;
  }
}

function parseVersion(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\da-z.-]+))?(?:\+[\da-z.-]+)?$/i.exec(version);
  if (!match) return null;
  const parts = match.slice(1, 4).map(Number);
  return parts.every(Number.isSafeInteger) ? { parts, prerelease: !!match[4] } : null;
}

export function isNewer(latest: string, current: string): boolean {
  const next = parseVersion(latest), installed = parseVersion(current);
  if (!next || !installed || next.prerelease) return false;
  for (let i = 0; i < 3; i++) {
    if (next.parts[i] > installed.parts[i]) return true;
    if (next.parts[i] < installed.parts[i]) return false;
  }
  return installed.prerelease;
}

export function parseRelease(data: unknown): AppRelease | null {
  if (!data || typeof data !== "object") return null;
  const release = data as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (release.draft || release.prerelease || typeof release.tag_name !== "string") return null;
  const parsed = parseVersion(release.tag_name);
  if (!parsed || parsed.prerelease) return null;
  return {
    version: release.tag_name.replace(/^v/i, ""),
    url: RELEASES_URL + encodeURIComponent(release.tag_name),
  };
}

export async function fetchLatestRelease(): Promise<AppRelease | null> {
  if (!shouldCheckVersion()) return null;
  checked = true;
  try {
    // Record attempts before fetching, including offline and rate-limited requests.
    window.sessionStorage.setItem(VERSION_CHECK_DONE_KEY, "1");
  } catch {
    // Checking remains optional when browser storage is unavailable.
  }
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000),
    });
    return response.ok ? parseRelease(await response.json()) : null;
  } catch {
    return null;
  }
}
