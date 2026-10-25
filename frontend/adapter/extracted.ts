import {
  createTranslator,
  useLocale,
  useMessages,
  useTimeZone,
} from "next-intl";
import { useMemo } from "react";
import english from "../rybbit/messages/en.json";
import { searchMessages } from "./searchMessages";
import { journeyMessages } from "./journeyMessages";
import { appMessages } from "./messages";

// Next's extraction compiler normally rewrites literals to catalog IDs.
// Vite uses the same imported catalogs and ICU formatter through this bridge.
const ids = new Map(
  Object.entries(english).map(([id, message]) => [message, id])
);

export function createExtractedTranslator(
  locale: string,
  messages: Record<string, any>,
  timeZone = "UTC"
) {
  const resolved = (message: string) =>
    appMessages[locale]?.[message] ||
    journeyMessages[locale]?.[message] ||
    searchMessages[locale]?.[message] ||
    messages[ids.get(message) || ""] ||
    message;
  const cache = new Map<string, ReturnType<typeof createTranslator>>();
  const translator = (message: string) => {
    let value = cache.get(message);
    if (!value) {
      value = createTranslator({
        locale,
        timeZone,
        messages: { message: resolved(message) },
      });
      cache.set(message, value);
    }
    return value;
  };
  const t = (message: string, values?: any) =>
    translator(message)("message", values);
  t.rich = (message: string, values?: any) =>
    translator(message).rich("message", values);
  t.raw = resolved;
  return t;
}

export function useExtracted() {
  const locale = useLocale(),
    messages = useMessages(),
    timeZone = useTimeZone();
  return useMemo(
    () => createExtractedTranslator(locale, messages, timeZone),
    [locale, messages, timeZone]
  );
}
