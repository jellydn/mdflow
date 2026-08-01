# Design System — "NOTED!" Premium AI Note-Taking Landing Page

Variation direction: **Pop Art lead**, blended with botanical-journal scholarship,
Sunday-comics warmth, and minimalist-magazine restraint. One cohesive
"collectible publication" system, not a collage.

## Source references

| Ref | Name | Category | Local file | Source URL | Visual role |
|---|---|---|---|---|---|
| 1 | Pop Art Publication | Editorial | `./refs/ref-01-editorial-style-062.webp` | https://inspiration-board.pages.dev/editorial/images/optimized/style-062-1600.webp | LEAD: palette, dots, bubbles, serialized grids |
| 2 | Garden and Botanical Journal | Editorial | `./refs/ref-02-editorial-style-049.webp` | https://inspiration-board.pages.dev/editorial/images/optimized/style-049-1600.webp | Scholarly layer: serif, italic labels, annotated plates, tables |
| 3 | Newspaper Sunday Comics | Editorial | `./refs/ref-03-editorial-style-100.webp` | https://inspiration-board.pages.dev/editorial/images/optimized/style-100-1600.webp | Warmth layer: newsprint cream, strip panels, hand-lettered titles |
| 4 | Minimalist Lifestyle Magazine | Editorial | `./refs/ref-04-editorial-style-002.webp` | https://inspiration-board.pages.dev/editorial/images/optimized/style-002-1600.webp | Pacing layer: negative space, narrow columns, muted calm sections |

All four downloaded to `./refs/` and visually inspected (opened as images, not
inferred from descriptions).

## Inspection summary

**Ref 1 — Pop Art Publication (inspected):** Flat saturated primaries — red
(#E3242B-ish), cadmium yellow, cobalt blue, plus magenta/pink and green accents
in the serialized grid. Heavy black outlines around everything (portraits,
panels, swatches). Ben-Day dot fields at visible scale (red dots on yellow,
blue dots on white) used as backgrounds and skin shading. White speech bubbles
with solid black strokes and pointed tails carry cover lines. Masthead "POP!"
is ultra-heavy grotesque, white-on-red block. Bottom-right panel: the same
female portrait repeated 3×3, each cell re-colored in a different 2–3 color
scheme — mass-production serialization. Starburst/burst shapes ("WHAM! BAM!")
with jagged edges. Layout is panelized: hard-edged rectangles butted together.

**Ref 2 — Botanical Journal (inspected):** Cream/ecru paper (#F3EDDD-ish)
framed on moss green (#5A6B3B-ish). Precise watercolor botanical plates with
thin leader lines to italic labels (*Petalum*, *Stigma*, *Folium*) — anatomy
annotation as a design language. Elegant transitional serif masthead ("The
Botanic Garden Journal"), italic season/volume line ("Spring 2024 · Volume
VIII"). Structured data tables with thin rules and a green header row.
Explicit palette swatches: Moss Green, Earth Brown, Petal Pink, Sky Blue.
Two-column scholarly text grid with generous margins; small caps / italic
conventions.

**Ref 3 — Sunday Comics (inspected):** Warm aged-newsprint cream background.
Cover masthead "SUNDAY FUNNIES" in chunky rounded red display letters with
yellow panel behind and black outline; a dateline ("NOVEMBER 12, 1961") at
top. Strips are grids of equal panels with thin black borders on cream;
speech balloons in hand-lettered caps; a "KABOOM!" starburst. Each strip title
is its own hand-lettered logotype in a different style/color (Prince Valiant
blackletter-ish red, PEANUTS yellow slab, DENNIS THE MENACE two-tone).
Limited CMYK fills — soft red, sky blue, banana yellow, mint green — slightly
off-register, halftone visible. Democratic "many strips share one page" rows.

**Ref 4 — Minimalist Magazine (inspected):** Warm greige/off-white field.
Light-weight, wide-tracked geometric sans masthead ("LIFE & STILL") in muted
sage-grey. Cover lines in a single neat small-caps column. Huge negative
space; one quiet photo per page; narrow centered essay columns. Humanist serif
body ("The essence of a considered home."). Palette chips: cream, sage, dusty
rose, taupe. Asymmetric small captioned images on off-white. Two type sizes,
minimal hierarchy.

## Style DNA

### Palette and color strategy
Newsprint paper base + pop primaries as ink, muted botanicals for quiet zones.

- `--paper: oklch(0.96 0.02 90)` fallback `#F6F0E1` — aged newsprint cream (Ref 3/2)
- `--ink: oklch(0.2 0.01 80)` fallback `#181511` — soft black ink, never pure #000 on paper
- `--pop-red: oklch(0.58 0.23 29)` fallback `#E23A2E` (Ref 1/3 masthead red)
- `--pop-yellow: oklch(0.88 0.17 95)` fallback `#F6C915` (Ref 1 cadmium)
- `--pop-blue: oklch(0.51 0.19 262)` fallback `#2757C4` (Ref 1 cobalt)
- `--pop-pink: oklch(0.66 0.21 356)` fallback `#E4569B` (Ref 1 grid magenta)
- `--moss: oklch(0.5 0.09 127)` fallback `#5C6B3C` (Ref 2 frame green)
- `--sage: oklch(0.82 0.03 130)` fallback `#C9CDBA` (Ref 4 chip)
- `--rose: oklch(0.83 0.05 20)` fallback `#E3C2BC` (Ref 4 dusty rose)
- `--taupe: oklch(0.55 0.03 70)` fallback `#847668` (Ref 4 chip)

Strategy: loud sections = primaries + black outlines on paper; quiet sections
= sage/rose/taupe on paper with no outlines. Never mix loud fills into quiet
zones.

### Typography direction
- **Masthead/headlines:** ultra-heavy grotesque, tight, often white-in-red
  block or outlined (Ref 1 "POP!", Ref 3 "SUNDAY FUNNIES") → `Archivo Black`.
- **Comic accents / strip titles / bursts:** hand-lettered caps energy →
  `Bangers` (used sparingly: kickers, bursts, strip titles).
- **Scholarly serif:** transitional serif for editorial body + italic
  annotation labels (Ref 2) → `Source Serif 4`, italics for Latin-style
  feature labels (*Memoria automatica*).
- **Quiet sans:** light, wide-tracked geometric sans for the minimalist
  sections, small caps cover lines (Ref 4) → `Archivo` 300/500 with
  letter-spacing.
- Hand-lettered balloon text: caps, small, bold (Ref 3) → Archivo 700 caps or
  Bangers at small size.

### Layout and composition
- Page framed like a publication: thin outer border / dateline bar on top
  ("VOL. 1 — THE MEMORY ISSUE", date, price tag) (Ref 3 dateline + Ref 2
  volume line).
- Panelized sections with hard black rules between loud zones (Ref 1/3);
  quiet zones drop rules and open up whitespace (Ref 4).
- Feature storytelling as a comic strip: equal panels in a row with balloons
  (Ref 3 interior).
- Serialized 6-up grid: same app-screen motif re-colored six ways (Ref 1
  bottom-right).
- Annotated product plate: centered app mock with thin leader lines to italic
  labels, like a botanical dissection (Ref 2 bottom-right).
- Narrow centered essay column (~34ch) for the manifesto (Ref 4 interior).
- Structured pricing table with thin rules and a green header (Ref 2 table).

### Shape language
Hard-edged rectangles with 2–3px ink borders and offset solid shadows (print
mis-registration); speech bubbles (rounded, black stroke, tail); jagged
starbursts for "NEW!"/"WHAM"-class callouts; zero border-radius on panels,
999px on bubbles/pills. Quiet sections: borderless, generous padding.

### Texture, surface, and rendering
- Ben-Day/halftone dot fields via CSS `radial-gradient` repeating patterns —
  large visible dots in hero (Ref 1), fine dots as section tints (Ref 3).
- Slight off-register effect: colored offset box-shadows and 1–2px translated
  duplicate text shadow on big display type (Ref 3 print misregistration).
- Paper grain: very subtle noise/tint, warm — never sterile white (Refs 2/3/4).
- Illustration style: flat fills + black outlines only; no gradients on art,
  no photorealism, no glassmorphism.

### Motion and interaction
Print-born motion: things "stamp" in (scale 1.03→1 with dot-burst), hover
lifts panels against their offset shadow (translate −2px, shadow grows),
marquee ticker for the dateline strip. Quiet sections fade/translate subtly.
Respect `prefers-reduced-motion`.

### Imagery and asset rules
No photography in loud zones — flat comic illustration only. The product UI
is drawn as flat outlined panels (comic-style app windows with dot shading).
Quiet zones may use muted flat still-life illustration (Ref 4 translated to
flat art, not photos). No real brands, no lifted characters.

## Reference-to-decision map

| Decision | Reference(s) | Evidence from image | Implementation rule |
|---|---|---|---|
| Masthead "NOTED!" white-on-red heavy block with exclamation | Ref 1 | "POP!" masthead: ultra-bold white grotesque on red block, black outline | Archivo Black, white on `--pop-red` block, 3px ink border |
| Dateline bar atop page | Ref 3, Ref 2 | "NOVEMBER 12, 1961" top strip; "Spring 2024 · Volume VIII" italic line | Full-width thin bar: "VOL. 1 · THE MEMORY ISSUE · SUNDAY EDITION" small caps + italic serif date |
| Hero halftone dot field + outlined portrait-scale art | Ref 1 | Cover portrait over red Ben-Day dots on yellow | CSS radial-gradient dot field (red on yellow) behind hero art panel |
| Speech-bubble value props & CTA copy | Ref 1, Ref 3 | Cover lines inside white bubbles w/ black stroke + tails | `.bubble` component: white, 3px ink border, 999px radius, CSS tail |
| Starburst "NEW!" badge | Ref 1, Ref 3 | "WHAM! BAM!" jagged bursts; "KABOOM!" | CSS clip-path star polygon, yellow fill, Bangers type |
| "How it works" as 4-panel Sunday strip with hand-lettered title | Ref 3 | Family Circus 3×3 panel grid, balloons, per-strip logotypes | Equal bordered panels on cream, balloon captions, Bangers strip title in two-tone |
| Serialized 6-up feature grid, same motif re-colored | Ref 1 | Bottom-right 3×3 same portrait in 6+ color schemes | Same note-card SVG motif repeated 6×, each in a different 2-color scheme from palette |
| Annotated app "plate" with leader lines + italic labels | Ref 2 | Botanical plate w/ thin lines to *Petalum/Stigma* italic labels | Centered flat app mock; absolutely-positioned thin lines to serif-italic labels (*Memoria automatica*, etc.) |
| Pricing as scholarly table w/ green header + italic species names | Ref 2 | Plant list table: green header row, thin rules, italic botanical names | Pricing table: `--moss` header, hairline rules, plan names italic serif |
| Quiet manifesto: narrow centered column, light wide sans small-caps kicker | Ref 4 | Right-page essay in narrow centered column; "LIFE & STILL" light tracked masthead | ~34ch centered column, Archivo 300 tracked small-caps kicker, Source Serif body, sage/rose accents only |
| Off-register print shadows on display type & panels | Ref 3 | Visibly offset CMYK printing on cover | Duplicate text-shadow (2px red/blue offsets); solid offset box-shadows on panels |
| Cream paper base everywhere (not white) | Ref 2, 3, 4 | All three sit on cream/greige paper | `--paper` body background, soft-black ink text |
| Palette-chip footer / colophon | Ref 2, Ref 4 | Both show labeled color swatch rows | Footer colophon lists the ink colors as labeled chips |

## Do not do
- No pure white background or pure black text — paper + ink only.
- No gradients, glassmorphism, neumorphism, or photo-realistic screenshots —
  flat fills + outlines are the rendering law (Refs 1/3).
- No rounded corners on panels (bubbles/pills only).
- No loud primaries bleeding into the quiet minimalist sections (Ref 4 zones
  stay sage/rose/taupe).
- No named brands, real comic characters, or lifted mastheads.
- Don't reproduce the 2×2 gallery-demo grid or panel labels from the refs.
- Don't let Bangers carry body copy — accents only; readability first.

## Generated assets

Image-generation tooling (`$imagegen`) is not available in this session; the
chosen direction was requested directly by the user ("pop art lead, integrate
the others"), so mock directions were skipped in favor of the final build. All
artwork in the deliverable is hand-built CSS/SVG in the reference style,
recorded here:

| Asset | Reference(s) | Traits borrowed | Intentionally changed |
|---|---|---|---|
| `site landing page (published via here.now)` hero art panel | 1, 3 | Ben-Day dots, outlined flat app-window art, bubbles | App UI subject instead of portrait |
| 4-panel strip SVG/CSS art | 3 | Panel grid, balloons, flat CMYK fills | Story is the product workflow, original characters omitted |
| 6-up serialized note-card grid | 1 | Repeated motif, per-cell 2-color schemes | Motif is an original note card, not a portrait |
| Annotated plate diagram | 2 | Leader lines, italic labels, centered specimen | Specimen is the app window, labels are feature names in faux-Latin italic |
