// This app keeps its existing English interface. Rybbit's extracted strings stay in the source.
const translate = (message: string, values?: Record<string, string | number>) => message.replace(/\{(\w+)\}/g, (match, key: string) => values?.[key] == null ? match : String(values[key]));
export const useExtracted = () => translate;
