# Design

## Visual Theme

Vintage Americana hot-rod garage signage, on Pit Stop's existing dark GTA-hazard base. Benny's Original Motor Works leads the brand now; Pit Stop is the legacy mark riding alongside it ("Benny's, by Pit Stop"). Two real brand-asset logos (cut from in-game screenshots, backgrounds removed) drive the system rather than redrawn placeholders:

- `src/assets/bennys-logo.png` — outline-font "BENNY'S" lettering (red/white, hollow letterforms by design), script "Original," solid-red "MOTOR WORKS." The dominant mark.
- `src/assets/pitstop-logo-wide.png` — yellow hex badge (gear + wrench + checkered flag) with "PIT STOP." wordmark. The secondary/legacy mark, always smaller, always paired with an italic "by" label.
- `src/assets/brand-reveal.mp4` — a short looping clip of the Pit Stop mark transforming into the Benny's mark, used in the homepage launch-announcement panel.

## Color Palette

Hex, not OKLCH — this evolves an already-committed palette rather than starting fresh.

| Token | Value | Role |
|---|---|---|
| `--pit-black` | `#0B0B0F` | Page background |
| `--carbon` / `--carbon-2` | `#15171C` / `#1C1F26` | Panel surfaces |
| `--navy` | `#1B2A45` | Structural chrome — borders on every panel/form/card/nav, echoing Benny's logo outline color |
| `--brand` / `--brand-2` | `#E63946` / `#FF5566` | **Primary** — buttons, focus rings, active nav, hero accent. Benny's red leads. |
| `--torch` / `--torch-2` | `#E63946` / `#FF5566` | Same red, used specifically for danger/destructive/error states (kept as a separate alias so a future repaint of `--brand` doesn't accidentally repaint error states) |
| `--legacy` / `--legacy-2` | `#F5C518` / `#FFD84D` | **Secondary/heritage** — star ratings (universal yellow convention), the "new" status pill, the old Pit Stop wordmark. Deliberately narrow use. |
| `--chrome` / `--steel` / `--t1`-`--t3` | unchanged | Text ramp |

Body background glow was rebalanced to match: a large red glow now leads top-right, a small yellow glow recedes to a bottom-left corner.

## Typography

- Display: **Anton** (was Russo One) — bold, condensed, varsity/signage energy, pairs with Benny's own block lettering. Russo One kept as a fallback in the stack, no extra font family spent.
- Body: **Inter**, unchanged.
- Mono: unchanged, used narrowly for labels/kickers/codes.
- Capped at display + body + mono, per the no-more-than-3 rule. No script web-font added — "Original"-style script is baked into the logo asset itself, not live text.

## Components & Patterns

- **`.card`** — shared primitive (giveaway pools, etc). Side-stripe hover accent removed (an explicit anti-pattern); hover now shifts border to `--navy` + soft red glow.
- **`.service-board` / `.service-row`** — replaced the old identical-card grid for Services (icon + name + description + price cards, repeated 6x — a named anti-pattern) with a vintage price-list/menu-board layout: one continuous bordered list, navy outline, row dividers, price tag on the right.
- **`.bennys-announce-*`** — the homepage launch panel: double navy/red outline (echoes the logo's own outline construction), now features the brand-reveal video instead of a static logo.
- **Marquee** — switched from flat mono ticker text to bold Anton caps on a diagonal red-hairline-striped metal-strip background with navy top/bottom rails; separator dot now glows red.
- **Nav / Footer brand lockup** — `[Benny's logo, big]` + italic "by" + `[Pit Stop logo, small]`, identical pattern in both places. This renders on every page, including staff/admin/giveaway tools.
- **Hero** — added a halftone-dot grain overlay (`.hero-grain`) for a printed-poster texture; floating gear/wrench/orb decorations rebalanced from yellow-leaning to red-leaning (2 red : 1 yellow) to match the new brand-lead.

## Data integrity

Homepage's crew teaser and the full `/team` page now both read from a single `useRoster()` hook (live Firestore `pitstop_roster`, falling back to a static seed only when offline/unconfigured). They used to diverge — the homepage rendered a hardcoded seed while `/team` rendered live admin-managed data. The homepage now shows the first 4 live entries plus a "Full crew →" link, instead of duplicating the full list.

## Open / explicitly deferred

- Exact service pricing is unset ("TBA — announcing soon") pending a real decision; don't reintroduce a specific number without being told one.
- The public `/team` roster's role titles (Owner/Co-Owner/Manager/...) have not been synced to Masoom's CEO/COO/Business-Partner org chart from the Benny's launch planning — only do this if asked.
- No video compression tooling was available in this environment; `brand-reveal.mp4` is bundled at its source size (~2.9MB). Worth compressing before launch if load time on mobile matters.
