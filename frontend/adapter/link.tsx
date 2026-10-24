import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { actualHref, navigate } from './navigation';
type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string | { pathname?: string; query?: Record<string, string> }; prefetch?: boolean; replace?: boolean; scroll?: boolean };
export default forwardRef<HTMLAnchorElement, Props>(function Link({ href, prefetch, replace, scroll, onClick, ...props }, ref) {
  const target = typeof href === 'string' ? href : `${href.pathname || ''}?${new URLSearchParams(href.query)}`;
  return <a {...props} href={actualHref(target)} ref={ref} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target === '_blank' || props.download) return;
    const url = new URL(actualHref(target), location.origin);
    if (url.origin !== location.origin) return;
    event.preventDefault(); navigate(target, replace);
  }}/>;
});
