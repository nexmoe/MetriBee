export const PRIVACY_KEY = "pb_privacy";
let enabled: boolean | undefined;
const listeners = new Set<() => void>();

export function privacySnapshot() {
  if (enabled === undefined) {
    try { enabled = localStorage.getItem(PRIVACY_KEY) === "1"; }
    catch { enabled = false; }
  }
  return enabled;
}

function publish(value: boolean) {
  if (value === privacySnapshot()) return;
  enabled = value;
  listeners.forEach(listener => listener());
}

export function setPrivacy(value: boolean | ((current: boolean) => boolean)) {
  const next = typeof value === "function" ? value(privacySnapshot()) : value;
  publish(next);
  try { localStorage.setItem(PRIVACY_KEY, next ? "1" : "0"); }
  catch { /* Still works for this session when storage is blocked. */ }
}

function storageChanged(event: StorageEvent) {
  if (event.key === PRIVACY_KEY) publish(event.newValue === "1");
}

export function subscribePrivacy(listener: () => void) {
  if (!listeners.size) window.addEventListener("storage", storageChanged);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storageChanged);
  };
}
