import { useSyncExternalStore } from 'react';
import { sitesHomeUrl } from '../../lib/homeViews';
import { locales, getLocale as pathLocale, stripLocale, localeHref } from '../../lib/uiLocale';

const routes: Record<string, string> = { main: '/analytics', pages: '/analytics/pages', events: '/events', journeys: '/journeys', retention: '/retention', funnels: '/funnels', widgets: '/widgets', globe: '/globe', reports: '/analytics/reports' };
export { locales };
export function getLocale(path = location.pathname) { return pathLocale(path); }
const unlocalized = stripLocale;
export function getSharedRoute(path = location.pathname) {
  const match = unlocalized(path).match(/^\/(\d+)\/([a-f0-9]{12})\/(main|pages|events|journeys|retention|funnels)\/?$/);
  return match ? { siteId: match[1], privateKey: match[2], route: match[3] } : null;
}
export function getAppPath(path = location.pathname) {
  const shared = getSharedRoute(path);
  return shared ? routes[shared.route] : unlocalized(path).replace(/\/+$/, '') || '/';
}
export function switchLocale(locale: string) { if (locales.includes(locale)) location.assign(localeHref(location.href, locale)); }
export function useLocation() {
  return useSyncExternalStore(callback => {
    window.addEventListener('popstate', callback);
    window.addEventListener('ga4:navigate', callback);
    return () => { window.removeEventListener('popstate', callback); window.removeEventListener('ga4:navigate', callback); };
  }, () => window.location.href);
}
export function actualHref(href: string) {
  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return href;
  const locale = getLocale(url.pathname) === 'en' ? getLocale() : getLocale(url.pathname);
  const prefix = locale === 'en' ? '' : '/' + locale;
  if (getSharedRoute(url.pathname)) return prefix + unlocalized(url.pathname) + url.search + url.hash;
  const pathname = getAppPath(url.pathname);
  const match = pathname.match(/^\/(\d+)(?:\/([^/]+))?\/?$/);
  if (match && routes[match[2] || 'main']) {
    url.pathname = prefix + routes[match[2] || 'main'];
    url.searchParams.set('prop', match[1]);
    return url.pathname + url.search + url.hash;
  }
  if (url.pathname === '/settings/account' || url.pathname === '/settings/organization') return '/setup';
  if (Object.values(routes).includes(pathname) || pathname === '/' || ['/realtime','/sites','/quota','/setup'].includes(pathname)) url.pathname = prefix + pathname;
  return pathname === '/sites' ? sitesHomeUrl(url.href) : url.pathname + url.search + url.hash;
}
export function navigate(href: string, replace = false) {
  const next = actualHref(href);
  if (/^https?:/.test(next) && new URL(next).origin !== location.origin) { location.assign(next); return; }
  const url = new URL(next, location.origin);
  if ((!Object.values(routes).includes(getAppPath(url.pathname)) && !['/', '/realtime', '/sites', '/quota', '/setup'].includes(getAppPath(url.pathname))) || getLocale(url.pathname) !== getLocale()) { location.assign(next); return; }
  if (next === location.pathname + location.search + location.hash) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', next);
  window.dispatchEvent(new Event('ga4:navigate'));
}
const router = { push: (href: string) => navigate(href), replace: (href: string) => navigate(href, true), back: () => history.back(), forward: () => history.forward(), refresh: () => location.reload(), prefetch: () => Promise.resolve() };
export const useRouter = () => router;
export function usePathname() {
  useLocation();
  if (getSharedRoute()) return unlocalized(location.pathname);
  const nativeRoute = Object.entries(routes).find(([, path]) => path === getAppPath())?.[0];
  const site = new URLSearchParams(location.search).get('prop') || String((window as any).__GA4_CONTEXT__?.properties?.[0]?.id || '');
  return nativeRoute ? `/${site}/${nativeRoute}` : getAppPath();
}
export function useSearchParams() { useLocation(); return new URLSearchParams(location.search); }
export function useParams<T = { site: string }>() { const parts = usePathname().split('/'); return { site: parts[1] } as T; }
export const redirect = (href: string) => navigate(href, true);
export const notFound = () => { throw new Error('Page not found'); };
