// MetriBee marks. The plain mark follows the theme like the Rybbit frog did;
// the wordmark keeps "Bee" and the bee in bee yellow, so it ships one file per theme.
const WORDMARK_RATIO = 597.48 / 100.27;
// Chart headers ask for width 80, sized for Rybbit's shorter word; MetriBee needs more room to read.
const CHART_HEADER_SCALE = 1.5;

export function RybbitLogo({ width = 32, height = 32 }: { width?: number; height?: number }) {
  return <img src="/metribee/mark.svg" alt="MetriBee" width={width} height={height} className="dark:invert" />;
}

export function RybbitTextLogo({ width: requested = 150, height }: { width?: number; height?: number }) {
  const width = requested < 120 ? Math.round(requested * CHART_HEADER_SCALE) : requested;
  const resolved = height && height > 0 ? height : Math.round(width / WORDMARK_RATIO);
  return (
    <>
      <img src="/metribee/wordmark.svg" alt="MetriBee" width={width} height={resolved} className="dark:hidden" />
      <img src="/metribee/wordmark_light.svg" alt="MetriBee" width={width} height={resolved} className="hidden dark:block" />
    </>
  );
}
