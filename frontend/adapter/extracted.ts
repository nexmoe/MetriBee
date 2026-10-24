import { createTranslator, useLocale, useMessages, useTimeZone } from 'next-intl';
import { useMemo } from 'react';
import english from '../rybbit/messages/en.json';
import { searchMessages } from './searchMessages';

// Next's extraction compiler normally rewrites literal messages to these catalog IDs.
// Keep upstream components intact while using the same ICU formatter and catalogs in Vite.
const ids = new Map(Object.entries(english).map(([id, message]) => [message, id]));
export function useExtracted() {
  const locale = useLocale(), messages = useMessages(), timeZone = useTimeZone();
  return useMemo(() => {
    const translator = (message: string) => createTranslator({ locale, timeZone, messages: { message: searchMessages[locale]?.[message] || messages[ids.get(message) || ''] || message } });
    const t = (message: string, values?: any) => translator(message)('message', values);
    t.rich = (message: string, values?: any) => translator(message).rich('message', values);
    t.raw = (message: string) => message;
    return t;
  }, [locale, messages, timeZone]);
}
