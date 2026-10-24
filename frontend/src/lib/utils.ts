import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
export const formatter = Intl.NumberFormat('en-US', { notation: 'compact' }).format;
export const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 0 });
export const percent = (fraction: number | null | undefined) => fraction == null ? '—' : (fraction * 100).toFixed(1) + '%';
export const duration = (seconds: number | null | undefined) => seconds == null ? '—' : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s` : `${Math.round(seconds)}s`;
export const dateLabel = (day: string) => new Date(day.includes('-') ? `${day.slice(0, 10)}T12:00:00Z` : `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
export function exportCsv(name: string, rows: unknown[][]) {
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name + '.csv'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
