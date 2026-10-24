import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react';
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener); window.addEventListener('ga4:navigate', listener);
  return () => { window.removeEventListener('popstate', listener); window.removeEventListener('ga4:navigate', listener); };
};
const snapshot = () => location.pathname + location.search + location.hash;
export function useLocation() { return useSyncExternalStore(subscribe, snapshot); }
export function navigate(href: string, replace = false) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) { location.assign(url.href); return; }
  history[replace ? 'replaceState' : 'pushState'](null, '', url); window.dispatchEvent(new Event('ga4:navigate'));
}
export const useRouter = () => ({ push: navigate });
export function updateParams(values: Record<string, string | null>, replace = true) {
  const url = new URL(location.href); Object.entries(values).forEach(([key, value]) => value == null || value === '' ? url.searchParams.delete(key) : url.searchParams.set(key, value)); navigate(url.href, replace);
}
export default function Link({ href = '', onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={href} {...props} onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && props.target !== '_blank' && !props.download) {
      const path = new URL(href, location.href).pathname;
      if (['/analytics', '/analytics/pages', '/events', '/journeys', '/retention'].includes(path)) { event.preventDefault(); navigate(href); window.scrollTo(0, 0); }
    }
  }} />;
}
