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

Refinement is **iterative, not one-shot**: once a plan is refined, the operator
can leave free-text comments ("Refinar con comentarios") and Claude revises the
*existing* spec + steps to address them instead of starting from the seed.
Comments are kept as a thread so the conversation that shaped a plan stays
visible. "Rehacer desde cero" remains available (with a confirm) for a clean
restart.

The **Tablero** (Kanban board) is the single end-to-end surface: one card per
unit of work moving through seven lanes — Fuentes (source inbox, editable +
synced back to the source) → Planeación (technical refinement) → Por desarrollar
(refined/dispatched work in the listened "to-do / ready for develop" states —
pending dev/manual tasks and plans handed to the ClickUp dev flow; mirrors the
Dashboard's "Cola de tareas") → Cola (work queue) → Ejecución (live run) →
Revisión (close or iterate) → Cerrada. Cards drag to advance one legal step at a
time; heavy steps (run, cancel) confirm first. **Iterations show in the flow**:
re-running a finished card moves it back to Ejecución with a ↻ badge carrying the
iteration's run id, then returns it to Revisión when it finishes. A **failed** run
or card can be **retried** (↻ Reintentar on the run page and on the Revisión card
drawer) — it re-runs the task from scratch.

**Parallel runs & worktrees.** By default one run executes per repo at a time
(the next is queued). Launching a run while its repo is already busy prompts to
isolate it in a **git worktree** — a parallel checkout on its own `leo/run-<id>`
branch, so it can't clobber the run in flight. With more than one concurrent run
configured (`max_concurrent_runs > 1`) the worktree is the default choice.
Worktrees need a **git repo**: if the project's `repo_path` isn't one, the
worktree option isn't offered (it just runs in place). Worktrees are kept for
inspection/resume and garbage-collected 15 days after the run finishes.

## Cuentas (workspaces)

Leo operates inside one **active account** at a time, chosen from the switcher at
the top of the sidebar. An account is a fully isolated workspace that **groups
several projects (repos)** and owns its own integrations (ClickUp/Sentry tokens)
and engine/auth config (concurrency, auto-run, binary, auth method, API key,
default model). Switching accounts re-scopes every view (Tablero, Planeación,
Ejecuciones, Dashboard) but **never stops work in another account** — the
scheduler runs every account in the background regardless of which one is on
screen. Within an account the views keep a per-project filter.

The unified **Cuenta** page collects the account's Proyectos, Integraciones and
Motor & Auth, plus account identity (name/color, delete). A project can **inherit
its config from a base project** (template): execution fields left empty (model,
tools, hooks, specs, MCPs, auth) fall through to the base; repo identity (path,
branches, sources) never inherits. Honest constraint: the Claude **subscription
login is machine-wide** (one per machine), so per-account auth isolation is full
for API key / model / token but the subscription session is shared.

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
