import { useEffect } from 'react';
export function useExport(callback: () => void) { useEffect(() => { window.addEventListener('ga4:export', callback); return () => window.removeEventListener('ga4:export', callback); }, [callback]); }
