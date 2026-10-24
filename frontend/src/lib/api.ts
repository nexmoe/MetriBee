import { useQuery } from '@tanstack/react-query';
import { useLocation } from './router';
export interface Property { id: string; site: string; domain?: string; url?: string; currencyCode?: string; timeZone?: string; }
export interface CatalogItem { type: string; title: string; group: string; }
export interface Context { properties: Property[]; catalog: CatalogItem[]; demo: boolean; }
declare global { interface Window { __GA4_CONTEXT__: Context; } }
export const context = window.__GA4_CONTEXT__;
export function useWorkspace() {
  useLocation();
  const params = new URLSearchParams(location.search);
  const property = context.properties.find(p => String(p.id) === params.get('prop')) || context.properties[0];
  const range = params.get('range') || '30d';
  return { property, propertyId: String(property?.id || ''), range, params };
}
export async function api<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error || 'Could not load this report.');
  return body as T;
}
export function useReport<T>(url: string | null) {
  return useQuery<T, Error>({ queryKey: ['report', url], enabled: !!url, queryFn: ({ signal }) => api<T>(url!, signal), staleTime: 5 * 60 * 1000, retry: false });
}
export interface CardReport { ok: boolean; rows: { dims: string[]; metrics: number[]; prev?: number[] | null }[]; totals: number[]; prevTotals?: number[]; metricHeaders: string[]; dimensionHeaders: string[]; prevRows?: { dims: string[]; metrics: number[] }[]; groups?: { name: string; sessions: number; rows: { url: string; sessions: number; engagementRate: number; avgEngagement: number }[] }[]; fetchedAt: number; }
