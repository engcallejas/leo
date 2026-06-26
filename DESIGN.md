# Design — Leo

The visual system for Leo. Register: **product** (a control room for an operator).
Direction: **editorial console** — a light, type-driven workspace with a dark
left rail and a dark terminal pane for live logs. Not a generic dark dashboard.

All tokens live as CSS variables in `src/app/globals.css`. Components consume the
tokens and a small set of utility classes; **re-theming is done by redefining the
tokens on a subtree** (the dark rail = `.sidebar`, the dark log = `.term-body`).

## Color (light is the global theme)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f1f3f6` | app background (cool paper, NOT cream) |
| `--panel` | `#ffffff` | cards / surfaces |
| `--panel-2` | `#f6f7f9` | insets, hovers, table stripes |
| `--border` | `#e5e8ed` | hairlines |
| `--border-strong` | `#d3d8e0` | stronger dividers, input borders |
| `--text` | `#14171c` | ink |
| `--muted` | `#5d6470` | secondary text (≥4.5:1 on white) |
| `--accent` | `#0c6b4a` | brand green — primary actions, links, active, focus |
| `--ok` `--running` `--warn` `--danger` | green / `#1a63c9` / `#8a5a00` / `#c0362f` | semantic status |

The **left rail** (`.sidebar`) and the **transcript** (`.term-body`) redefine these
tokens to a dark palette locally; everything inside re-themes automatically.

## Type

- **Serif display** — `var(--font-serif)` (Newsreader). Page/run titles, section
  titles. Use via `.ed-display`, `.sec-title`, `.fieldset-title`. Display only.
- **Sans UI** — `var(--font-sans)` (Hanken Grotesk). Body, labels, buttons.
- **Mono data** — `var(--font-mono)` (JetBrains Mono). IDs, metrics, code, logs.
- Fixed rem-ish sizes (product, not fluid). Title ~27–31px, section ~16px, body 13–14px.

## Components & utilities (in globals.css)

- `.card` — white surface, 1px border, radius 12, faint shadow. **Never nest cards.**
- `.btn` / `.btn-primary` (green) / `.btn-danger` / `.btn-sm`
- `.badge` + `.badge-ok|running|warn|danger` (+ `.badge-dot`), `.live-dot` (pulsing, reduced-motion safe)
- `.input` / `.textarea` / `.select` / `.label` / `.hint`
- `.tbl` — list tables
- `.tabbar` + `.tab` (+ `.active`) — underline tabs for switching read surfaces
- `.seg` + `.seg-btn[aria-pressed]` — segmented control (mutually-exclusive choice)
- `.meta-strip` + `.meta-item` / `.meta-k` / `.meta-v` — compact metadata row (replaces equal stat boxes)
- `.sec-ico` — tinted icon chip; `SectionHeader` component pairs it with a title + desc
- `.fieldset` (+ `.fieldset-title` / `.fieldset-desc`) + `.form-grid` (+ `.span-2`) — forms
- Icons: `src/components/icons.tsx` (stroke SVGs). **No emoji as icons.**

## Layout principles

1. **Read vs. act.** Reviewing is visually separate from acting.
2. **Tabs for alternative read-surfaces** you rarely view at once (e.g. run:
   Resumen / Transcripción / Tarea).
3. **No stacks of equal full-width cards.** Group into rule-separated `.fieldset`
   sections inside ONE card (or no card), with fields in a `.form-grid` (2-col,
   collapses to 1 on narrow). Long forms → split sections into tabs.
4. **Density with hierarchy** — one primary element per zone; serif titles anchor.
5. **Status-first**; live = visibly live (pulse), finished = calm, errors legible.

## Modals & confirmations

- **Modals are for confirmations and alerts only — never for forms.** Forms live
  inline on the page (a section/panel that appears in place), not in a dialog.
- Destructive actions (delete/discard) MUST go through a confirmation modal, not
  a browser `confirm()`. Use the `useConfirm()` hook + `ConfirmDialog`
  (`src/components/ui.tsx`):
  ```tsx
  const { confirm, dialog } = useConfirm();
  // ...
  if (!(await confirm({ title: "¿Eliminar X?", body: "…", confirmLabel: "Eliminar", danger: true }))) return;
  // render {dialog} once in the tree
  ```
- `Modal` (`src/components/ui.tsx`) is the base overlay; `ConfirmDialog` wraps it.

## Anti-patterns (do not ship)

- Nested cards; long single-column stacks of equal cards.
- Emoji as section headers/icons. The periwinkle-blue accent. Cream/beige bg.
- Side-stripe accent borders, gradient text, glassmorphism, hero-metric grids.

## Motion

150–250ms; conveys state, not decoration. Every animation has a
`prefers-reduced-motion` fallback. No orchestrated page-load sequences.
