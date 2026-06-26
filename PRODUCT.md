# Product

## Register

product

## Users

A single technical operator (the developer running Leo locally) who orchestrates
Claude Code runs across their own repositories. They are a power user at their
desk: launching tasks from ClickUp/Sentry, watching runs execute live, steering
or correcting agents mid-flight, and iterating on finished runs. They want
control and visibility, fast — not hand-holding.

## Product Purpose

Leo is a local-only orchestrator that runs the Claude Code CLI per repo. It
plans/refines work, launches headless agent runs, lets the human steer them
mid-run, and iterates on results (resume / compact / new PR). Success: the
operator can see a run's state at a glance, understand what happened, correct it,
and continue — without digging.

The **Tablero** (Kanban board) is the single end-to-end surface: one card per
unit of work moving through six lanes — Fuentes (source inbox, editable + synced
back to the source) → Planeación (technical refinement) → Cola (work queue) →
Ejecución (live run) → Revisión (close or iterate) → Cerrada. Cards drag to
advance one legal step at a time; heavy steps (run, cancel) confirm first.

## Brand Personality

Precise, calm, operator-grade. A control room, not a toy. Confident and quiet:
the interface gets out of the way of the task. Three words: precise, calm,
capable.

## Anti-references

- Generic SaaS dashboards: uniform card grids, purple gradients, glassmorphism.
- The "hero metric" template (a row of equal big-number stat boxes).
- Emoji used as iconography and as section headers.
- Anything that reads as AI-generated boilerplate.
- The good direction: GitHub Actions run view, Linear, Vercel deployment pages —
  dense, legible, intentional, status-first.

## Design Principles

- **Status first.** The run's state and the single best next action are obvious
  on arrival.
- **Read vs. act.** Reviewing (transcript, context, outcome) is visually separate
  from acting (steer, iterate, stop).
- **Density with hierarchy.** Show a lot, but rank it — never a flat field of
  equal cards. One primary element per zone.
- **Earned familiarity.** Behave like the best CI/dev tools; don't reinvent
  standard affordances for flavor.
- **Honest state.** Live runs look live (motion); finished runs are calm;
  failures are legible, not hidden.

## Accessibility & Inclusion

Light editorial theme (with a dark left rail and a dark transcript pane). Body
text ≥ 4.5:1 contrast. State is never color-only — always paired
with a label and/or dot/icon. All motion (status pulse, reveals) has a
`prefers-reduced-motion` fallback. Targets ≥ 32px; visible focus rings.
