---
name: MetriBee
description: A self-hosted GA4 command center; a quiet instrument panel, not a themed world.
colors:
  bg: "light-dark(#f3f3f6, #0b0b0e)"
  surface: "light-dark(#ffffff, #131317)"
  surface-2: "light-dark(#f7f7f9, #1a1a1f)"
  surface-3: "light-dark(#ebebf0, #23232a)"
  border: "light-dark(#ececf1, #1f1f25)"
  border-2: "light-dark(#dcdce3, #2f2f37)"
  text: "light-dark(#18181b, #f4f4f5)"
  text-2: "light-dark(#52525b, #a1a1aa)"
  text-3: "light-dark(#6b6b76, #8e8e99)"
  accent: "#4f46e5"
  accent-2: "light-dark(#4338ca, #4f46e5)"
  accent-fg: "light-dark(#4338ca, #a5b4fc)"
  accent-soft: "light-dark(#eef2ff, rgba(129,140,248,.14))"
  good: "light-dark(#15803d, #4ade80)"
  warn: "light-dark(#b45309, #fbbf24)"
  bad: "light-dark(#b91c1c, #f87171)"
  chart-1: "light-dark(#4f46e5, #818cf8)"
  chart-2: "light-dark(#0891b2, #22d3ee)"
  chart-3: "light-dark(#d97706, #fbbf24)"
  chart-4: "light-dark(#7c3aed, #c4b5fd)"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.011em"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-.011em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: ".8125rem"
    fontWeight: 500
  mono:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: ".92em"
rounded:
  sm: "2px"
  base: "2px"
  lg: "3px"
  pill: "2px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s10: "40px"
  s12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.base}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-2}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.base}"
    padding: "0 12px"
    height: "32px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.base}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.pill}"
    height: "26px"
  badge-good:
    backgroundColor: "{colors.good-soft}"
    textColor: "{colors.good}"
    rounded: "{rounded.pill}"
    height: "20px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.base}"
    height: "32px"
    padding: "0 10px"
---

# Design System: MetriBee

## Overview

**Creative North Star: "The Instrument Panel"**

This is a cockpit, not a magazine. It reads like the tools it sits beside: Linear, the Vercel dashboard, Plausible, Stripe's dashboard. The owner explicitly ruled out themed or quirky visual worlds on 2026-09-21 (a prior "Zed" engineering-notebook theme was rejected and never shipped) and asked for something familiar and polished that most self-hosters would like at first glance without thinking about it. Nothing here is decorative; every mark either carries a number, a state, or a way to act on data.

Density is high but calm: sharp geometry, a tight neutral scale, one indigo accent held in reserve, and a monochrome-first surface hierarchy where color is spent only on signal (good/warn/bad, the accent, chart series). Cards are borderless and separate from the page only by a soft background step, so the eye reads structure without being told where the lines are. Motion is a confirmation, not a performance: transform and opacity only, 120-200ms, off entirely under `prefers-reduced-motion`.

**Key Characteristics:**
- One accent (indigo `#4f46e5`), used sparingly: primary actions, active nav state, focus rings, the primary chart series.
- Sharp, near-flat geometry: 2-3px radii everywhere, no soft/rounded forms.
- Cards carry no border; elevation is a background-color step, never a shadow, at rest.
- Full light/dark parity via `light-dark()`. Light is the default; dark is an explicit choice in the settings menu, stored in `localStorage` (`pb_theme`) and applied as `data-theme` by an inline script in `<head>` so there is no flash on load.
- Self-hosted Inter Variable with tabular numerals on every numeric readout.

## Colors

Palette strategy is a tight neutral scale (six steps of surface/border/text per theme) plus one reserved accent and three semantic signal colors, all defined once as `light-dark()` pairs so light and dark are the same system, not two skins.

### Primary
- **Indigo Accent** (`#4f46e5`, hover `light-dark(#4338ca, #4f46e5)`, on-surface `light-dark(#4338ca, #a5b4fc)`, soft fill `light-dark(#eef2ff, rgba(129,140,248,.14))`): primary buttons, the active nav item, focus rings, and the default chart series. It is the one color allowed to command attention.

### Neutral
- **Page** (`light-dark(#f3f3f6, #0b0b0e)`): the body background, one step darker/deeper than any card.
- **Surface** (`light-dark(#ffffff, #131317)`): cards, inputs, the command bar, popovers.
- **Surface Raised** (`light-dark(#f7f7f9, #1a1a1f)`): hover state for surface-level rows and buttons.
- **Surface Sunken** (`light-dark(#ebebf0, #23232a)`): segmented-control track, skeleton loaders, badge backgrounds.
- **Border** (`light-dark(#ececf1, #1f1f25)`): hairlines only (table rows, command bar bottom edge).
- **Border Strong** (`light-dark(#dcdce3, #2f2f37)`): input and button strokes, floating-panel edges.
- **Text Primary** (`light-dark(#18181b, #f4f4f5)`), **Text Muted** (`light-dark(#52525b, #a1a1aa)`), **Text Faint** (`light-dark(#6b6b76, #8e8e99)`): three-step text hierarchy for label/body/caption.

### Semantic
- **Good** (`light-dark(#15803d, #4ade80)`), **Warn** (`light-dark(#b45309, #fbbf24)`), **Bad** (`light-dark(#b91c1c, #f87171)`), each with a `-soft` tint background for badge/pill fills. Used for freshness pills, quota state, spike badges, and delta indicators.

### Chart Series
- **Chart 1-4** (`#4f46e5`/`#818cf8`, `#0891b2`/`#22d3ee`, `#d97706`/`#fbbf24`, `#7c3aed`/`#c4b5fd`): distinguishable in both themes and by lightness alone for color-blind readers. Series 1 is always the accent; use 2-4 in order for additional series, never reassign per-chart.

### Named Rules
**The One Accent Rule.** Indigo is the only color that carries decorative or brand weight. Everywhere else, color is semantic (good/warn/bad) or structural (the neutral scale). If a new element wants a color and it isn't a primary action, active state, or a data signal, it gets a neutral, not the accent.

## Typography

**Body/Display Font:** Inter Variable (self-hosted, `public/fonts/InterVariable.woff2`, variable weight 100-900), fallback `system-ui, sans-serif`.
**Mono/Label Font:** `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace`, used for `.mono` (technical strings) and `.kbd` (keyboard hints).

**Character:** One typeface for everything. There is no separate display face; hierarchy comes from weight, size, and letter-spacing tightening at larger sizes, not from font-switching. All numeric readouts use tabular figures (`.num`) so columns of numbers align.

### Hierarchy
- **Headline** (600, `1.5rem`/24px, line-height 1.25, `-.011em` tracking): `h1`, page titles.
- **Title** (600, `1rem`/16px, line-height 1.25, `-.011em` tracking): `h2`, card headers.
- **Subtitle** (600, `.875rem`/14px, line-height 1.25): `h3`, sub-section headers.
- **Body** (400, `.875rem`/14px, line-height 1.5): default running text and table cells.
- **Small** (400/500, `.8125rem`/13px): secondary labels, tab labels, segmented control text.
- **Caption** (400/500, `.75rem`/12px): table headers, badges, timestamps, nav labels on the phone tab bar.
- **Hero Number** (600, 52px, `-.02em` tracking): the single live-active-users readout on Home; the one place type is allowed to be large.

### Named Rules
**The Tabular Numerals Rule.** Every number that appears more than once in a column, delta, or live readout carries `.num` (`font-variant-numeric: tabular-nums`). Numbers must not visually reflow as they update.

## Layout

Content sits in a centered column, `max-width: 1320px`, with `24px` horizontal padding and `96px` bottom padding for scroll comfort. The spacing scale is `4/8/12/16/20/24/32/40/48px` (`--s1` through `--s12`); component internals use the low end (`--s2`/`--s3`), page rhythm uses the high end (`--s4`/`--s5`/`--s6`).

The shell is one sticky top command bar (`--nav-h: 52px`): brand mark and page title on the left, a jump box in the middle, page icon links and the settings gear on the right. There is no sidebar and no live count in the bar; live numbers belong to the pages. Content starts directly under the bar. On phones the jump box collapses to its search icon and the bar keeps one row; nothing moves to a hamburger.

**Shared analytics sidebar.** Main, Pages, Events, Journeys and Retention all render `views/partials/analyticsSidebar.hbs`. Menu entries, order, property controls and responsive styles are shared. `public/js/analyticsSidebar.js` owns link state and keeps the selected property and supported date presets when navigating. Individual pages update their URL and call `AnalyticsSidebar.sync()`; they do not define separate sidebars or navigation links.

**Analytics workspace.** All five analytics pages share a 208px property and page sidebar below the command bar (184px below 1000px), with Main, Pages, Events, Journeys and Retention entries. It is not a table of contents. Its content uses the remaining width, capped at 1368px including 24px padding. At 760px and below, the sidebar becomes a sticky property selector and page navigation row. The Main overview combines four period metrics, a compact live readout and a full-width trend. Related reports share seven tabbed cards in two columns, with a single column below 1000px. Card headers contain only report tabs and the export action. Tabs support arrow keys, Home and End; report hash links select the matching tab. Events uses five summary metrics, a trend with a clickable legend, event name search and ranking, and a lazy-loaded hourly aggregate activity table. It labels GA4 report freshness separately from event time and never presents aggregate rows as individual users or raw logs. All other pages keep the standard shell. This analytics-specific sidebar follows the owner's October 2026 layout request.

**Pages workspace.** `/analytics/pages` reuses the analytics shell with five compact period metrics and a full-width page table. Directory groups expand inline. GA4 engagement per view and engaged-session bounce keep their own definitions. The top 25 directory rows load separate GA4 reports for distinct users, sessions, bounce and trends. While loading or searching, overlapping page users and sessions remain blank. Exit pages remain unavailable without an event export. Every report shows its fetch time.

**Retention workspace.** `/retention` shares the analytics property sidebar. It uses five summary metrics, a weighted retention curve with an inspectable legend, daily/weekly cohort selection, and a heatmap with percent/user modes. Return periods still in progress use a data hatch; unobserved cells have no numeric value. Chart 1 is the weighted average; Chart 2 highlights the selected cohort. Cell details open in a native dialog. The table scrolls horizontally on narrow screens while the page stays within the viewport. Data freshness and the property's time zone stay visible.

## Elevation & Depth

The system is flat by default: elevation is expressed through background-color steps in the neutral scale (page → surface → surface-2 → surface-3), never through shadow. `.card` has no border and no shadow at rest; it reads as a shape purely because it sits one step lighter (light theme) or lighter-relative (dark theme) than the page behind it.

The one shadow token, `--pop-shadow` (`0 8px 24px -6px rgba(0,0,0,.18), 0 2px 6px -2px rgba(0,0,0,.10)`), exists only for content that leaves the document flow: popovers, tooltips, the state-preview control. Nothing that sits in normal document flow gets a shadow.

### Shadow Vocabulary
- **Floating** (`--pop-shadow`): popovers (`.pop.open`), tooltips (`.tip`), any absolutely-positioned overlay layer.

### Named Rules
**The Background-Step Rule.** Depth is a background-color difference, not a shadow or a border. Reach for the next step in the neutral scale (`--surface` → `--surface-2` → `--surface-3`) before reaching for `box-shadow`.

## Shapes

Radii are sharp and small across the whole system: `2px` for controls and inputs (`--r`, `--r-sm`), `3px` for cards and floating panels (`--r-lg`), `2px` for pills/chips/badges (`--r-pill`, kept sharp rather than fully rounded so "pill" here means shape-of-role, not literal roundness). Borders are reserved for a specific short list: inputs, buttons, floating layers (popovers, tooltips), and table/list hairlines. Cards, page sections, and the command bar never take a border for its own sake; the bar's one border (`border-bottom`) is a hairline separating it from content, consistent with the hairline rule.

### Named Rules
**The Sharp Corners Rule.** Nothing in this system rounds past 3px. A control that looks softly rounded is off-system regardless of context.

## Components

### Buttons
- **Shape:** 2px radius, 32px height (44px on coarse/touch pointers), inline-flex with 6px icon gap.
- **Primary:** solid accent background, white text, `border-color: accent` (`.btn-primary`). Hover darkens to `--accent-2`.
- **Secondary (default `.btn`):** surface background, `border-2` stroke, text-primary color. Hover moves to `--surface-2`.
- **Ghost:** transparent background and border, `text-2` color; used for icon-only dismiss/utility actions (`.btn-ghost.btn-icon`).
- **State:** `:active` scales to 0.97 (transform only); disabled drops to 0.5 opacity and disables pointer events. No focus ring color change beyond the shared `:focus-visible` outline.

### Chips
- **Style:** surface background, `border-2` stroke, 26px height, 2px (pill-token) radius, a muted key segment (`.chip .k`) before the value.
- **State:** dismissible chips carry a circular remove button that fills `--surface-3` on hover; used for active pivot filters.

### Badges
- **Style:** 20px height, `--surface-3` background/`text-2` by default; semantic variants (`good`/`warn`/`bad`/`accent`) swap to the matching `-soft` background and solid text color. No border.

### Cards / Containers
- **Corner Style:** 3px radius (`--r-lg`).
- **Background:** `--surface`, one step off `--bg`.
- **Shadow Strategy:** none at rest; see Elevation & Depth.
- **Border:** none.
- **Internal Padding:** header `12px 16px` (min-height 48px, `.card-h`), body `16px` (`.card-b`).

### Inputs / Fields
- **Style:** 32px height (44px coarse pointer), `border-2` stroke, `--r` (2px) radius, `--surface` background.
- **Focus:** `:focus-visible` gets a 2px solid `--accent-fg` outline, 2px offset, shared globally (not input-specific).
- **Placeholder:** `--text-3`.

### Navigation (Command bar)
- **Bar:** 52px, sticky, `--surface` background, one `border-bottom` hairline. Left: brand mark and the page title (Title weight, 14px). No live count, no theme button in the bar.
- **Jump box:** centered input-styled button (`border-2`, `--surface-2` fill, 32px, max 420px) with a `.kbd` "Ctrl K" hint. Ctrl K (Cmd K on Mac) opens the palette: a floating list (`--pop-shadow`) grouped as Pages, Sites, Reports, filtered as you type, arrow keys plus Enter, Esc closes.
- **Page links:** 32px icon buttons, `text-2` at rest, hover `--surface-2`. The active page gets `--accent-soft` background and `--accent-fg` icon, no border, no underline. Each has a hover tooltip and an `aria-label`.
- **Settings gear:** opens a small popover menu. It holds Theme (Light / Dark, checked item marked) and a muted GA4 quota line (from `/api/quota`, hidden when empty), and is the home for future settings; add new preferences here, not as more bar buttons.
- **Phone (640px and below):** the jump box shrinks to its icon, the bar stays one row, icon links stay visible.

### Segmented Control
- **Style:** `--surface-3` track, 2px outer padding, transparent buttons at 28px height (40px touch) with `--r-sm` inner radius. Selected segment gets `--surface` background and `text` color; transitions on background/color only.

### Chart Fill (signature)
The line charts (live traffic, trend sparklines) render an SVG line (`.ln`) over an area that is, by default, an **ordered dither**: horizontal mask-repeated bands (`.dz i`, CSS `mask-repeat`) clipped under the area polygon, rather than a gradient or flat fill (`html[data-fx="dither"]`). A flat semi-transparent fill (`.ar`, 14% opacity) is the fallback when dither is toggled off. This is a deliberate, user-approved ("dither looks really cool") signature texture, not a decorative default; it stays confined to chart area fills and must not spread to card backgrounds or other surfaces.

**Map tokens (map-only exception, like the dither fill).** `/globe` defines `--sea --land --landline --grat --space --halo --indline` as plain values in `views/globe.hbs` (the canvas engine reads them with `getComputedStyle`). Minimal is calm neutral; Outdoors is vivid (sea `#4a9fd8`/`#0b3a5e`, land `#9cd08a`/`#24502f`), and the MapLibre globe or Outdoors sits on a `#05070d` space backdrop. Avatar markers are a uniform 48px with a 2px white ring; nearby cities merge into one stack marker, and a click on a city or a stack opens the same detail card (variant A) next to the marker. Country flags come from `/api/flag/:cc` (Iconify 4x3 SVG, cached in `.data/flags/`); an unknown country shows a neutral tile and `--`. These values stay inside the map stage and never reach panels or other pages.

## Do's and Don'ts

### Do:
- **Do** keep radii at 2-3px everywhere; nothing softly rounded.
- **Do** express elevation as a background-color step (surface → surface-2 → surface-3), reserving `--pop-shadow` for content that leaves document flow (popovers, tooltips).
- **Do** use `.num` tabular numerals on every number that appears in a column, delta, or live-updating readout.
- **Do** limit the accent color to primary actions, active nav state, focus rings, and the primary chart series; everything else stays neutral or semantic (good/warn/bad).
- **Do** animate only `transform` and `opacity`, 120-200ms, with the shared `--ease-out` curve, and respect `prefers-reduced-motion` (already wired globally).
- **Do** show data freshness on every screen that reads cached or stored data, per PRODUCT.md's product principle.
- **Do** keep the dither chart-fill technique scoped to chart areas; it's a signature texture for data visualization, not a general surface pattern.
- **Do** honor the India map boundary rule (PoK, Gilgit-Baltistan, Aksai Chin, Ladakh, Jammu & Kashmir, Arunachal Pradesh, Kalapani-Lipulekh-Limpiyadhura as India, Natural Earth 10m India POV) on every map surface, including any future one; never ship default Natural Earth, world-atlas, or globe.gl country data.

### Don't:
- **Don't** add a border to a card, page section, or other in-flow surface. Borders are for inputs, buttons, floating layers, and hairlines only.
- **Don't** introduce a second accent color or a decorative gradient; one indigo, held in reserve, is the whole strategy.
- **Don't** animate width, height, or layout-affecting properties for the command bar, popovers or any panel; menus and the palette fade and shift with opacity/transform only.
- **Don't** switch typefaces for hierarchy. Inter Variable's weight axis does that job; there is no separate display or mono-for-headings face.
- **Don't** round corners past 3px, or use a fully circular "pill" shape for chips/badges; this system's pill token is 2px, deliberately sharp.


### Journeys workspace

`/journeys` shares the analytics sidebar and shell. Four compact metrics sit above a two-column page-transition Sankey and filterable paths table. Same-site referrer pairs count page views; the interface must not imply session starts, exits or inferred multi-step paths. Flow widths and bars use `--c1` at reduced opacity, with opacity alone for hover and selection. Filters use shared 32px controls (44px on touch). On mobile the chart scrolls horizontally, controls wrap and metrics use two columns. Data coverage and full-path requirements are explained in data details; reporting limits get a visible status.

Audience reports use GA4 dimensions directly. Geography and technology have separate tabbed cards; each ranks by sessions. Language flags describe the reported browser locale, not a visitor location. The country map uses the existing bundled India-POV boundaries and GA4 country counts. Do not derive visitor time zones from the property time zone or city names.
