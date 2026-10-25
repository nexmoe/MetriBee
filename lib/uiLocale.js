// Shared by Express and the Vite adapter. The URL is the only locale preference.
const locales = [
  "en",
  "de",
  "fr",
  "zh",
  "es",
  "pl",
  "it",
  "ko",
  "pt",
  "ja",
  "cs",
  "uk",
];

function getLocale(pathname) {
  const first = pathname.split("/")[1];
  return locales.includes(first) ? first : "en";
}

function stripLocale(pathname) {
  return locales.includes(pathname.split("/")[1])
    ? pathname.replace(/^\/[^/]+/, "") || "/"
    : pathname;
}

function localeHref(href, locale) {
  if (!locales.includes(locale)) throw new RangeError("Unsupported locale");
  const url = new URL(href, "http://localhost");
  const pathname = stripLocale(url.pathname).replace(/^\/+/u, "/");
  return (
    (locale === "en"
      ? pathname
      : `/${locale}${pathname === "/" ? "" : pathname}`) +
    url.search +
    url.hash
  );
}

module.exports = { locales, getLocale, stripLocale, localeHref };
