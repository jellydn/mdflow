# mdflow Vision

This document is the project's north star: why mdflow exists, the first
principles that decide hard calls, and what we will not build. When an
implementation choice hits an obstacle, consult these principles before
changing direction. The README describes the contract as it is today;
`docs/V3-FLOWS.md` records how it got here; this file says where it points.

**The creed: "If a guardrail isn't covered by an eval, it's a wish."**

## The problem

Agent work in a repo today is oral tradition. The prompts that review code,
draft release notes, and triage issues live in shell history, chat scrollback,
and one teammate's dotfiles. They aren't diffed, aren't reviewed, aren't
tested, and silently change meaning when the engine underneath them changes.
Every engine CLI ships its own flags, its own ambient context (skills, MCP,
memory files), and its own defaults — so the "same" prompt does different
things on different machines, and nobody can say what a run will cost or touch
before spending it.

## The vision

**A repo's agent workforce should be versioned, inspectable, and testable —
one markdown file per job, runnable on any engine, with behavior guarded by
evals and changed only with proof.**

mdflow is the Git-native control plane for that workforce. Not an engine, not
a framework — a thin, honest layer that turns the engines you already use
into repeatable, reviewable infrastructure.

## First principles

These decide disputes. They are ordered by precedence: when two collide, the
earlier one wins.

### 1. The flow file is the entire behavior

Everything a flow does is declared in the flow file: engine, capabilities,
system prompt, hooks, variables. Isolation is the default — ambient
skills/MCP/context are stripped where the engine allows it — because a flow
that depends on one machine's ambient state is not a flow, it's an incident
report waiting to be written. What a flow needs, it names explicitly.

*Test: could a teammate read the file and predict the run? Could the same
file behave differently on two machines? If yes, something is leaking.*

### 2. Honest or loud — never pretending

Every engine translation (isolation flags, system prompt, hooks) is verified
against the engine's own help, docs, or an empirical probe before it ships.
Engines with no mechanism **fail the run** rather than silently dropping a
declared behavior — a flow with a dropped system prompt is a different flow.
Engines with no isolation controls run ambient and say so. We never guess a
flag, and we never let a limitation look like success.

*Test: does any path let a declared behavior be silently ignored? That's a
bug in the category of lying.*

### 3. Free to look, explicit to spend

Inspection never costs and never executes: `md explain`, `md doctor`,
`md eval --plan`, `md hooks list`, the Workbench — all static, all free.
Paid engine turns are always explicit, always cost-announced before running.
Passive surfaces never execute user code (hooks discovery is a text parse;
eval plans never import suite code). Consent boundaries fail closed.

*Test: can a user or agent understand a flow completely without spending a
token or running untrusted code? They must be able to.*

### 4. Change requires proof

A flow's declared behavior is guarded by its eval suite; verdicts bind to
exact bytes. Prompt evolution is proposal-first: evidence in, private
snapshot evaluated off-path, source untouched until a separate explicit
apply. "Verified improvement" means a feedback-linked case fails on current
and passes on the proposal — anything less is merely regression-safe, and we
say which one it is. Nothing mutates unattended.

*Test: if this change regressed a guarded behavior, would something red
appear before it lands? If not, the guardrail is a wish.*

### 5. Engines are environment, not ceremony

`review.md` is the job; where it runs is resolved from a ladder (flag > env >
filename > frontmatter > config > default) and every implicit choice prints
its reasoning. Flows should survive engine churn: when the engine ecosystem
shifts — and it shifts constantly — the roster keeps working and only the
environment changes.

*Test: does adopting a new engine require editing flows, or just an adapter?*

### 6. Instant is a feature

The CLI must feel like a shell built-in: help in tens of milliseconds, the
Workbench's first paint imperceptible, cold paths (like the TypeScript
compiler) loaded lazily and only when spent-money paths need them. A control
plane that lags gets bypassed, and a bypassed control plane guards nothing.

*Test: did this change add module-scope weight to a path `md help` touches?*

## Who it serves

Humans and coding agents are co-equal users. Every capability has a
human-ergonomic surface (TUI, dim stderr explanations, guided init) and an
agent-native one (`--json`, `md doctor`, the machine-readable operator card,
free static planning). A team adopts mdflow so that its people *and* its
agents share one roster, one source of truth, one change-with-proof protocol.

## What success looks like

- **Trust:** a reviewer approves a flow PR by reading the diff; a red eval is
  believed; "verified improvement" is never inflated. Zero paths where
  declared behavior is silently dropped.
- **Portability:** the same roster runs on every supported engine that has
  the needed mechanisms; engine swaps are config changes, verified by evals.
- **Coverage:** every shipped example flow carries a real eval suite; new
  engines gain isolation/system-prompt/hooks support only via recorded
  empirical probes (see `docs/*-probe-*.md`).
- **Speed:** `md help` stays ~25ms; Workbench first paint ≤100ms.
- **Adoption shape:** `./flows` rosters appear in repos the way `.github/`
  workflows did — reviewed, ratcheted in CI, owned by the team.

## Non-goals

- **Not an engine.** mdflow never calls a model API itself; it orchestrates
  engine CLIs. When engines and mdflow could both do a job, the engine does it.
- **Not a security sandbox.** Engine context isolation strips ambient engine
  state; it does not confine the host filesystem, network, processes, or
  credentials, and we will not imply otherwise.
- **Not a prompt DSL.** Flows are markdown with YAML frontmatter and Liquid
  templating — readable by anyone, editable without learning a language.
  Complexity budget goes to guarantees, not syntax.
- **Not a package manager for trusted code.** Registry installs fetch one
  markdown flow, never executable sidecars; local eval/hook files are local
  code with local trust.
- **Not a bigger surface.** Subcommands earn their place by serving the
  principles above; convenience features that blur the free/paid or
  inspect/execute boundaries are declined.
