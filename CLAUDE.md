# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

**mdflow** (`md`) is a CLI tool that executes AI agents defined as markdown files. It parses YAML frontmatter for configuration and passes keys directly as CLI flags to the specified command (claude, codex, gemini, copilot, or any other CLI tool).

## CLI Subcommands

```bash
md <file.md> [flags]     # Run a flow (bare `md` opens the Flow Workbench)
md doctor [--json]       # Inspect project readiness and safe next actions, no execution (free)
md init [--guided] [-e <eng>] [-y] [--agents] [--print-guide]
                         # Scaffold a starter roster (deterministic, zero engine
                         # turns; --guided runs the interactive setup session)
md create [name]         # Create a flow and a fail-closed draft eval suite
md capture               # Print the guide an in-session agent follows to capture
                         # the current conversation as a flow (free; see src/capture.ts)
md explain <flow.md> [--json]  # Show resolved config without executing (free)
md render <flow.md>      # Inspect, write, or open a rendered flow explanation
md hooks add|list|remove <flow.md> [event…]  # Manage the flow's lifecycle hooks file (free)
md eval <flow.md>        # Run the flow's eval suite (costs engine turns; --plan is free)
md eval add|list|remove|coverage  # Scaffold/manage suites, fail-closed verdicts, CI ratchet (free)
md feedback <flow.md> "msg"  # Record durable evolution evidence (free; `md complain` is an alias)
md evolve plan|propose|show|apply <flow.md|run-id>  # Proposal-first evolution (plan is free)
md install <url|gh:...>  # Install a flow into the registry (see src/registry.ts)
md remove <name>         # Remove an installed registry flow
md list                  # List installed registry flows
md roster [sync] [--agents] [--json]  # Inspect flows / sync the managed operator card
md catalog [--json]      # Machine-readable catalog of every discoverable flow
md setup                 # Configure shell (PATH, aliases)
md logs                  # Show flow log directory
md help                  # Show help
```

## Development Commands

```bash
# Run tests (bail on first failure)
bun test --bail=1

# Run single test file
bun test src/cli.test.ts

# Run a specific test by name
bun test --test-name-pattern "parses command"

# Execute the CLI directly
bun run src/index.ts task.claude.md

# Or using the alias
bun run md task.claude.md
```

## Website (`site/`)

The mdflow.dev landing page lives in `site/` (Vite + React, deployed via
Vercel with Root Directory = `site`). Rules:

- `site/src/facts.json` is **generated** by `scripts/generate-facts.ts` from
  the adapter registry, `DEFAULT_ENGINE`, `cli-runner.ts` subcommands, and
  package.json — never edit it by hand. `bun run facts` regenerates;
  `bun run facts:check` runs in CI and fails on drift. Adding a subcommand to
  `cli-runner.ts` requires a matching `COMMAND_DOCS` entry in the generator.
- Site-only commits use `chore(site):` / `docs(site):` scopes so
  semantic-release never cuts a CLI release for a visual change.
- `site/content/*.md` are article pages (e.g. the auto-evolve deep dive,
  formerly an external here.now URL). `scripts/build-content.mjs` renders
  each to `dist/<slug>/index.html` during `npm run build` so they're hosted
  on mdflow.dev — never link site copy to external here.now pages.
- Factual site copy should render from facts.json; artistic copy (headlines,
  shaders, easter eggs) is hand-written. See `docs/SITE-SYNC.md`.

## Architecture

### Core Flow (`src/index.ts`)
```
.md file → parseFrontmatter() → resolveEngine(ladder, see below)
        → loadFullConfig() → applyDefaults()
        → applyInteractiveMode() → expandImports()
        → substituteTemplateVars() → buildArgs() → runCommand()
```

### Key Modules

- **`command.ts`** - Engine resolution and execution
  - `parseCommandFromFilename()`: Infers engine from `task.claude.md` → `claude`
  - `hasInteractiveMarker()`: Detects `.i.` in filename (e.g., `task.i.claude.md`)
  - `resolveEngine()`: the v3 ladder (see Engine Resolution below); never
    throws for a missing engine — `DEFAULT_ENGINE` (pi) applies
  - `buildArgs()`: Converts frontmatter to CLI flags
  - `extractPositionalMappings()`: Extracts $1, $2, etc. mappings
  - `runCommand()`: Spawns the engine; calls the adapter's optional
    `prepareEnv()` hook (pi uses it for the bridged auth dir)
  - CAUTION: command.ts exports its own `getAdapter` (portable-key layer);
    the registry lookup is imported as `getEngineAdapter`

- **`evals.ts`** - `md eval <flow.md>`: behavioral eval suites
  (`<flow>.eval.ts`, export default EvalCase[]) run in hermetic temp dirs;
  trust ledger at `~/.mdflow/eval-results.json`; prints cost before running;
  eval runs redirect MDFLOW_RUNS_FILE so they never pollute telemetry.
  Scaffolded suites are fail-closed DRAFTS: a paid run is refused while any
  `MDFLOW_DRAFT_CASE` marker remains; every full run records a content-bound
  fingerprint (even flaky/inconclusive) so verdicts bind to exact bytes

- **`eval-convention.ts` / `evals-cli.ts`** - the eval convention layer
  (parallel to hooks): `md eval add|list|remove|coverage`. `add`/`remove` are
  LOCAL WRITES editing template marker blocks surgically
  (`// mdflow:case:start <recipe>` … `end`, one `// mdflow:case:insert`);
  recipes: output/stdin/prompt/fixture/stochastic/nonzero, inferred from the
  flow body when unspecified. `list`/`coverage`/`--plan`/explain are FREE and
  NEVER import suite code (static AST plan + text marker parse only — the
  eval parallel of the hooks consent boundary). One fail-closed classifier
  (`classifyEvalVerdict`: Verified | Stale | Flaky | Failing | Unverified) is
  shared by `md eval list`, `md explain`, and the Workbench; Stale beats any
  old outcome. `md eval coverage` is a shrink-only source-coverage ratchet
  (baseline `.mdflow-eval-baseline.json`) that never needs paid runs, for CI.
  Nine example suites ship against `examples/` and `assets/init/catalog/`
  flows (9 suites / 20 cases / 22 invocations, locked by
  `shipped-evals.test.ts`); `md create` scaffolds a draft suite by default
  (`--no-eval` opts out) and `md init` copies the real catalog suites.
  Post-critique hardening (2026-07-11, `eval-hardening.test.ts`): one
  `ResolvedEvalEnvironment` per run (child gets `MDFLOW_CONFIG_CWD`),
  sealed pre/post fingerprints (`EVAL_INPUTS_CHANGED`), materialized/frozen
  cases, filtered runs never clobber full receipts, fail-closed ledger
  reads, static `draft: true` case metadata, bounded fingerprint graphs,
  registry/remote sidecars distrusted.
  Second-audit hardening (2026-07-11, `eval-audit-hardening.test.ts`):
  ONE paid preparation boundary — `importPreparedEvalSuite()` (import +
  materialize + freeze + policy repetitions + draft refusal + static-plan
  equality) is the only way `md eval` AND `md evolve` turn a suite into
  runnable cases (evolve was a softer second runner: getters could
  overspend, drafts could verify proposals); the seal is re-checked at every
  paid boundary (before each child spawn, after each check) so
  mutate-run-restore cannot mint a receipt for bytes no trial ran;
  registry provenance is enforced at RUN time and realpath-based
  (`isRegistryPath` in project-root.ts) — a suite planted next to a registry
  flow AFTER install never executes, in eval or evolve; `configCwd` is the
  nearest project root (`resolveProjectRoot`), not `dirname(flow)`, so a
  non-git `flows/` roster loads its root config, and `MDFLOW_CONFIG_CWD` is
  an internal pointer that callers cannot override and the engine never
  inherits; the fingerprint graph uses the TS AST (bare side-effect imports,
  `export … from`, require, import-equals; .mts/.cts/.mjs/.cjs/.json),
  realpath containment, stat-before-read bounds, and ONE shared budget;
  configHash binds exact config-file BYTES; the ledger is schema-closed
  (malformed entries refuse the read AND the write) and alias-aware; suite
  `process.stdout.write` can't corrupt the JSONL protocol;
  `attemptedRuns` (was `actualInvocations`) is named for what it measures.
  COLD PATH: `typescript` (~1s to import) is required LAZILY in `evals.ts`
  (`ts()` accessor, never a module-scope import) — init/create/explain/the
  Workbench all reach evals.ts through the convention layer, so a static
  import taxed every CLI invocation (`md init` 2.4s → 0.68s). Keep it lazy.
  Design doc: `docs/EVAL-CONVENTION.md`; audits:
  `.artifacts/2026-07-11-eval-hardening-audit-oracle.md`

- **`init.ts`** - `md init`: project bootstrap. Default path scaffolds the
  `assets/init/catalog/` starter roster deterministically with ZERO engine
  invocations (never overwrites existing files; no-op when `flows/` already
  has a roster). `--guided` (or an explicit `--engine`) launches an installed
  engine CLI interactively, pre-loaded with `assets/init/guide.md` (passed
  verbatim — never through the import/template pipeline); post-flight
  verifies whatever the session wrote. `--print-guide` prints that prompt for
  pasting into any agent session. `bin/mdflow.mjs` is the plain-Node npx
  launcher that bridges to bun.

- **`evolve.ts`** - `md evolve` / `md feedback` (`md complain` is a
  compatibility alias): proposal-first evolution of the prompt BODY only.
  `evolve plan` (free) previews readiness, capabilities, writes, and bounded
  invocation cost; `evolve propose` (paid) drafts and evaluates a PRIVATE
  off-path candidate with verification receipts while the source stays
  byte-identical; `evolve show <run-id>` reviews it; only a separate explicit
  `evolve apply <run-id>` mutates the source (`reject`/`retry`/`rollback`/
  `history`/`prune` complete the lifecycle). "Verified improvement" is
  claimed only when a feedback-linked case fails on current and passes on
  the proposal; a green candidate without that is merely "regression-safe".
  Trigger rule refuses without a suite or fresh evidence; eval runs can
  never trigger it (corpus isolation). `evolve: auto` frontmatter is a
  compatibility alias for QUEUED PROPOSAL-ONLY work — unattended apply is
  intentionally unavailable. Feedback is consumed only by evolution; rough
  runs also by a clean eval. Verified in `evolve.test.ts`.

- **`adapters/pi-auth.ts`** - Codex-subscription auth bridge for the pi
  engine (`~/.mdflow/pi-agent`, pointed at via PI_CODING_AGENT_DIR); never
  writes the user's real credential files

- **`isolation.ts`** - `_isolated` resolution: adapter-declared
  context-stripping flags layered config defaults < isolation < frontmatter;
  unsupported engines produce a stderr warning (see Isolation table below)

- **`system-prompt.ts`** - `_system-prompt`/`_append-system-prompt`
  extraction and adapter translation (flags, codex `-c` overrides, gemini
  GEMINI_SYSTEM_MD temp file); unsupported engines fail the run

- **`compat.ts`** - Automatic frontmatter version/compatibility stamps:
  `_mdflow_version` written at creation (`md create`/`md init`), `_compat`
  stamped/upgraded after successful local runs (skipped for remote flows and
  `MDFLOW_EVAL_RUN=1`); surgical line-level frontmatter edits, semver-aware,
  major-mismatch prints a dim stderr notice, never blocks execution

- **`hooks.ts` / `hooks-cli.ts`** - Lifecycle hooks by convention:
  `review.codex.md` → sibling `review.codex.hooks.ts` (executable,
  self-contained Bun TS; zero imports) auto-discovered every run and
  translated by the adapter's `applyHooks()` into engine-native config
  (codex: one inline `-c hooks={…}` override + top-level
  `--dangerously-bypass-hook-trust`). `md hooks add/list/remove` scaffolds
  and edits the file surgically via template markers. See Lifecycle Hooks
  below.

- **`config.ts`** - Global configuration
  - Loads defaults from `~/.mdflow/config.yaml`
  - Built-in defaults: All commands default to print mode
  - `getCommandDefaults()`: Get defaults for a command
  - `applyDefaults()`: Merge defaults with frontmatter
  - `applyInteractiveMode()`: Converts print defaults to interactive mode per command

- **`types.ts`** - Core TypeScript interfaces
  - `AgentFrontmatter`: Simple interface with system keys + passthrough
  - System keys: `_varname` (template vars), `env`, `$1`/`$2`/etc.

- **`schema.ts`** - Minimal Zod validation (system keys only, rest passthrough)

- **`imports.ts`** - File imports with advanced features:
  - Basic: `@./path.md` - inline file contents
  - Globs: `@./src/**/*.ts` - multiple files (respects .gitignore)
  - Line ranges: `@./file.ts:10-50` - extract specific lines
  - Symbols: `@./file.ts#InterfaceName` - extract TypeScript symbols
  - Commands: `` !`cmd` `` - inline command output
  - URLs: `@https://example.com/file.md` - fetch remote content
  - **SHELL-INJECTION NOTE:** template variables are substituted into the
    `` !`cmd` `` string RAW (unescaped) and the result runs via `sh -c` /
    `cmd.exe`, exactly like a shell script. For any variable whose value can
    come from OUTSIDE the flow author (`_stdin`, `_1`/`_2`/`_args`, `--_var`
    flags), interpolate it through the `shell_escape` filter — aliased `q` —
    or a shell metacharacter in the value executes: `` !`grep {{ _1 | q }} file` ``.
    Frontmatter-author-controlled values may be left raw for glob/flag
    expansion. Verified 2026-07-17 (chaos round: raw `_stdin`/`_1`/`--_var`
    all achieved command execution; `| q` neutralized it).

- **`env.ts`** - Environment variable loading from .env files

- **`template.ts`** - LiquidJS-powered template engine for variable substitution

- **`logger.ts`** - Structured logging with pino (logs to `~/.mdflow/logs/<agent>/`)

- **`history.ts`** - Frecency tracking and variable persistence
  - `recordUsage()`: Track agent file usage for frecency sorting
  - `getFrecencyScore()`: Calculate frecency score for a path
  - `getVariableHistory()`: Get previous variable values for an agent
  - `saveVariableValues()`: Save prompted variable values for future runs
  - `getPreviousVariableValue()`: Get a specific variable's previous value

### Engine Resolution (v3)

Engines resolve via the ladder, most explicit first:
1. `--engine` CLI flag (deprecated aliases: `--_command`/`-_c`, `--tool`)
2. `MDFLOW_ENGINE` environment variable
3. Filename pattern: `task.claude.md` → `claude`
4. Frontmatter `engine:` (deprecated aliases `tool:`/`_tool:` warn)
5. Config `engine:` (project config beats `~/.mdflow/config.yaml`)
6. Built-in default: `pi`

Implicit resolution (env/config/default) prints a dim explanation line on
stderr. A file with no frontmatter and only an implicit engine is treated as
a document and printed, not executed.

### Frontmatter Keys

**System keys** (consumed by md, not passed to command):
- `_varname`: Template variables (e.g., `_name: "default"` → `{{ _name }}` in body → `--_name` CLI flag)
- `_stdin`: Auto-injected template variable containing piped input
- `_1`, `_2`, etc.: Auto-injected positional CLI args (e.g., `md task.md "foo"` → `{{ _1 }}` = "foo")
- `_args`: Auto-injected numbered list of all positional args
- `_inputs`: Named positional arguments to consume from CLI (e.g., `_inputs: [_message]`)
- `_env`: Sets process.env before execution
- `$1`, `$2`, etc.: Map positional args to flags
- `_interactive`: Enable interactive mode (overrides print-mode defaults)
- `_subcommand`: Prepend subcommand(s) to CLI args (e.g., `_subcommand: exec`)
- `_cwd`: Override working directory for inline commands (`` !`cmd` ``)
- `_isolated`: Isolation is ON BY DEFAULT — set `false` to opt back into ambient context (skills, MCP, memory/context files, plugins) — see Isolation below
- `_system-prompt` / `_append-system-prompt`: Replace/append the engine's system prompt, translated per engine — see System Prompt below
- `_hooks`: Lifecycle hooks file control — unset = convention discovery (`<flow>.hooks.ts`), `false` disables, a path (relative to the flow file) selects a shared hooks file; `--_hooks <path|false>` is the CLI override — see Lifecycle Hooks below
- `_mdflow_version` / `_compat`: Automatic compatibility stamps (see below) — never set these by hand

**Isolation (`src/isolation.ts` + adapter `getIsolationDefaults()`):**
ON BY DEFAULT for every engine — the flow file is the entire behavior;
skills/MCP/context a flow needs are referenced explicitly in frontmatter
(`mcp-config:`, `plugin-dir:`, `add-dir:`, extension paths), not inherited
from the machine. `_isolated: false` (frontmatter), `--_isolated false`
(CLI), or `commands.<engine>._isolated: false` (config) opts out. The
verified flags layer between config defaults and frontmatter, so an isolated
flow can still re-enable one layer (`safe-mode: false`). Per engine:

| Engine | Flags |
|--------|-------|
| claude | `--safe-mode --no-session-persistence` (the latter is print-only, stripped in interactive; `--bare` deliberately NOT used — it breaks OAuth auth) |
| codex | `--ignore-user-config --ephemeral --skip-git-repo-check -c project_doc_max_bytes=0` (all three flags are exec-only, stripped in interactive; skip-git-repo-check is required because --ignore-user-config drops `[projects]` trust, and exec otherwise refuses to start outside a git repo) |
| gemini | `--extensions none` (GEMINI.md + settings MCP have no CLI kill-switch) |
| copilot | `--no-custom-instructions --disable-builtin-mcps` (user MCP config still loads) |
| opencode | `--pure` (AGENTS.md still loads) |
| pi | `--no-extensions --no-skills --no-prompt-templates --no-context-files --no-session` |
| grok | `--no-memory` (disables cross-session memory; MCP/plugins have no CLI kill-switch) |
| droid / cursor-agent / agy / kimi | no controls exist — runs ambient; warns only on an explicit `_isolated: true` |

**Codex skill discovery + flow provenance (`src/adapters/codex-hooks-home.ts`,
verified empirically on codex-cli 0.145.0 — 2026-07-24):** an isolated codex
run leases BOTH `CODEX_HOME` and `HOME`. Skills load from four roots, and only
CODEX_HOME's is governed by the flags above:

| Source | Leaked before | Now |
|--------|---------------|-----|
| `$CODEX_HOME/skills` | built-ins only | leased ✓ |
| `$HOME/.agents/skills` | **38 on this machine** | leased HOME ✓ (0) |
| `<project>/.codex/skills` | run refused | disclosed per provenance |
| `<project>/.agents/skills` | leaked silently (guard missed it) | disclosed per provenance |

There is NO kill-switch for skill discovery: `skills=[]` passes
`--strict-config` but is inert, `--disable skill_search` changes nothing, and
no `CODEX_*` env var exists. HOME is the only lever, so the lease becomes the
run's HOME with an explicit credential allowlist symlinked back
(`.gitconfig`, `.gitignore_global`, `.ssh`, `.config/git`, `.config/gh`,
`Library/Keychains` — gh keeps its token in the macOS keyring, which is
HOME-relative). `rmSync(recursive)` unlinks symlinks without descending
(verified against decoy targets), so cleanup cannot reach real user state.
CONSEQUENCE: `~` inside an isolated codex session is the lease, not the user's
home.

Project skill surfaces are classified by where the flow LIVES, not where it is
invoked (`classifyFlowProvenance`, both sides canonicalized — macOS reports
`/private/var` for `/var`, which silently misclassified every resident flow
under a symlinked root):

- **resident** (flow's project root === cwd's project root) — silent; the
  project's skills are part of that flow's own contract and ship with every
  checkout.
- **visiting** (global/PATH/user flow standing in an unrelated repo) — RUNS,
  with a disclosed `ISOLATION_REDUCED` stderr warning naming the exact paths.
  It deliberately does not refuse: refusing made every global flow unusable in
  any repo carrying a `.codex`, while ambient `$HOME` skills outnumbered
  project ones ~38:1. `--_cwd <dir>` (which DOES set the engine spawn cwd, via
  `cli-runner.ts` `commandCwd`) avoids the project entirely.
- **registry** (installed remote flow) — still FAILS CLOSED; a remote flow
  absorbing local project context is a trust problem, not a reproducibility one.

Project `.codex/config.toml` no longer leaks (a fresh CODEX_HOME suppresses it;
an isolated run reports `model: <default>` even when the project pins one), so
a config-only `.codex` produces no warning. `-c project_doc_max_bytes=0` still
suppresses AGENTS.md. Discovery walks UP from cwd to the git root
(`<repo>/sub/deeper` inherits `<repo>/.codex/skills`), so there is no
run-from-a-subdirectory escape. Free re-probe (no tokens):
`codex debug prompt-input` prints the model-visible prompt, and
`codex exec --strict-config` validates config keys before any API call.

**System prompt (`src/system-prompt.ts` + adapter `applySystemPrompt()`):**
the flow body is always the *user* prompt; `_system-prompt` (replace) and
`_append-system-prompt` (string or list) control the *system* prompt.
Translations: claude/pi → `--system-prompt`/`--append-system-prompt`; codex →
`-c model_instructions_file=<temp file>` / `-c developer_instructions=…`;
gemini → `GEMINI_SYSTEM_MD=<temp file>` env (replace only — append errors).
Engines with no mechanism (copilot, droid, opencode, cursor-agent, agy) fail
the run — a silently dropped system prompt would be a different flow. Never
add a translation from an unverified flag; check the engine's `--help` first.

**Lifecycle hooks (`src/hooks.ts`, `src/hooks-cli.ts` + adapter `applyHooks()`):**
a flow's hooks live in a sibling file named after it — `review.codex.md` →
`review.codex.hooks.ts` — auto-discovered on every run (no frontmatter
needed). The file is an EXECUTABLE, SELF-CONTAINED Bun TypeScript program
(zero imports: flows run where mdflow isn't a dependency) that default-scaffolds
via `md hooks add <flow.md> [event…]`. It exports a `handlers` map keyed by
canonical camelCase events and implements two contracts:
`--mdflow-list-events` (prints its handled events as JSON; used only as a
REAL-RUN fallback when the static text parse fails — passive surfaces never
execute the file) and the stdin/stdout hook protocol
(payload JSON on stdin; a returned string → stdout context, object →
JSON.stringify'd decision, void → nothing, always exit 0).

Canonical events: `sessionStart userPromptSubmit preToolUse postToolUse
permissionRequest preCompact postCompact subagentStart subagentStop stop
sessionEnd`. Adapters map them to engine-native names via `applyHooks()`.

CONSENT BOUNDARIES (audit-hardened; regression-tested in
hooks-integration.test.ts "consent boundaries"):
- Passive surfaces NEVER execute hook code: explain, dry-run, the
  Workbench, and `md hooks list` discover events via
  `listHandledEventsStatic()` (text parse of the template's handlers map).
  Executing `--mdflow-list-events` is allowed ONLY as a real-run fallback —
  the flow is executing anyway, so it adds no privilege.
- Frontmatter `_hooks:` paths are CONTAINED to the flow's own directory
  subtree, and remote flows may not declare `_hooks` paths at all (hook
  programs run on the host OUTSIDE the engine sandbox). `--_hooks` from the
  CLI is unrestricted — the invoking user typed it.
- `md install` downloads only the flow markdown, never sibling hook files.

Codex translation (all facts verified empirically on codex-cli 0.144.1 —
see the probe evidence rules below before changing any of this):
- ONE inline override carries every event: `-c hooks={Event=[{hooks=[{type="command",command="'<bun>' '<file>'",timeout=60,…}]}]}`
  plus top-level `--dangerously-bypass-hook-trust` (without it codex
  SILENTLY skips unreviewed hooks). Event keys MUST be PascalCase —
  snake_case silently registers nothing. The event → group list → `hooks`
  list nesting is mandatory.
- The bypass flag is invocation-wide and hook sources AGGREGATE
  (`--ignore-user-config`/`--ephemeral` do NOT disable `$CODEX_HOME`
  hooks.json). Hooked runs therefore execute against a PREPARED CODEX_HOME
  (`~/.mdflow/codex-hooks-home`, built by adapters/codex-hooks-home.ts:
  auth.json symlink + `[projects]` trust copy + guaranteed-absent
  hooks.json) so the bypass can only authorize mdflow-injected hooks. As a
  consequence, hooks on codex REQUIRE isolation: `_isolated: false` + a
  hooks file is a hard error (HOOKS_REQUIRE_ISOLATION).
- `codex exec` fires SessionStart, UserPromptSubmit, PreToolUse,
  PostToolUse, Stop; SessionEnd never fires. Hook cwd = session cwd; stdin
  payload carries `hook_event_name` (PascalCase), `session_id`, `cwd`, etc.
- EXECUTION-time hook failures fail OPEN by default (codex continues), but
  the scaffolded dispatcher fails CLOSED for GUARD events — if a
  `userPromptSubmit`/`preToolUse`/`permissionRequest` handler THROWS, it
  emits the engine's block/deny response rather than letting the guarded
  action through (observational events like `stop` stay open — blocking
  Stop on error would loop). DISCOVERY failures always fail the run loudly
  (missing/rejected/uninspectable hooks file). UserPromptSubmit can block
  via exit 2 or `{"decision":"block"}`; Stop can force continuation.
- The prepared codex home is a SHARED dir; every write into it (auth
  symlink, config.toml) is atomic (temp + rename) so concurrent mdflow
  processes never see a torn file.

Claude translation (verified on Claude Code 2.1.207 —
docs/claude-hooks-probe-2026-07.md):
- Hooks ride in via `--settings <inline JSON>` (Claude's per-run settings
  channel): `{"hooks":{"Event":[{"matcher":"","hooks":[{"type":"command","command":"'<bun>' '<file>'","timeout":60}]}]}}`.
  Event keys PascalCase; `matcher:""` matches every occurrence.
- CENTRAL GATE: `--safe-mode` SUPPRESSES `--settings` hooks (and all ambient
  hooks), so a hooked run drops it. Ambient hooks are instead excluded with
  `--setting-sources ""` (keeps injected `--settings` hooks; drops
  user/project/local settings and THEIR hooks — the security parallel to
  codex's prepared home; no trust-bypass exists on claude). Dropping
  `--safe-mode` also stops disabling CLAUDE.md/skills/plugins/MCP — a real
  isolation reduction, so it is DISCLOSED on stderr
  (HOOKS_ISOLATION_REDUCED), never silent. Managed/admin policy hooks (if
  any) remain. Hooks REQUIRE isolation (parity with codex). A flow that also
  sets native `settings:` hard-fails (ownership conflict) rather than let
  argv order decide.
- Print-mode `claude -p` fires SessionStart, UserPromptSubmit, PreToolUse,
  PostToolUse, Stop, SessionEnd (SessionEnd DOES fire, unlike codex); the
  rest are registered but scenario-dependent. Same stdin/stdout contract as
  codex (compact JSON + newline; exit 2 or decision-JSON blocks; hook
  exit-1/timeout fail open). No hook-specific consent flag needed in `-p`.

Engines with no verified hook mechanism FAIL a run whose hooks file exists
(same policy as `_system-prompt`); `_hooks: false` opts out. Never add an
engine translation from guessed config — verify against the engine's own
help/docs first.

**Compatibility stamps (`src/compat.ts`):** every flow tracks which mdflow it
works with, with zero user involvement. `md create`/`md init` stamp
`_mdflow_version` (version created with); after any successful local run,
mdflow stamps/upgrades `_compat` (newest version verified to work) via a
surgical frontmatter edit that preserves the rest of the file byte for byte.
Upgrades only fire on major/minor skew — patch and prerelease bumps never
rewrite flows (no per-release git churn).
Remote flows and eval runs (`MDFLOW_EVAL_RUN=1`) are never stamped. A major
mismatch between the recorded version and the running mdflow prints a dim
stderr notice but never blocks. Frontmatter containing only these keys still
counts as "no frontmatter" for the document-vs-flow rule.

**Note:** `--_varname` CLI flags work without frontmatter declaration. If a `_` prefixed variable is used in the body but not provided, you'll be prompted for it.

**Variable History:** When prompting for missing variables, previous values are shown as defaults (stored in `~/.mdflow/variable-history.json`). Press Enter to accept the previous value or type to override. Use `--_no-history` to skip loading/saving variable history.

**All other keys** are passed directly as CLI flags:

```yaml
---
model: opus                  # → --model opus
dangerously-skip-permissions: true  # → --dangerously-skip-permissions
add-dir:                     # → --add-dir ./src --add-dir ./tests
  - ./src
  - ./tests
_env:                        # Sets process.env (underscore prefix = system key)
  API_KEY: secret
---
```

### Positional Mapping ($N)

Map the body or positional args to specific flags:

```yaml
---
$1: prompt    # Body passed as --prompt <body> instead of positional
---
```

### Print vs Interactive Mode

All commands default to **print mode** (non-interactive). Use `.i.` filename marker or `_interactive: true` for interactive mode.

```bash
task.claude.md      # Print mode: claude --print "..."
task.i.claude.md    # Interactive: claude "..."
task.copilot.md     # Print mode: copilot --silent --prompt "..."
task.i.copilot.md   # Interactive: copilot --silent --interactive "..."
task.codex.md       # Print mode: codex exec "..."
task.i.codex.md     # Interactive: codex "..."
task.gemini.md      # Print mode: gemini "..." (one-shot)
task.i.gemini.md    # Interactive: gemini --prompt-interactive "..."
task.droid.md       # Print mode: droid exec "..."
task.i.droid.md     # Interactive: droid "..."
task.opencode.md    # Print mode: opencode run "..."
task.i.opencode.md  # Interactive: opencode "..."
task.grok.md        # Print mode: grok --single "..." (headless single-turn)
task.i.grok.md      # Interactive: grok "..." (positional prompt → TUI)
task.kimi.md        # Print mode: kimi --prompt "..."
task.i.kimi.md      # Interactive: kimi "..."
chat.i.md           # Interactive with the DEFAULT engine — "i" is the
                    # interactive marker, never an engine name, and the
                    # marker alone makes a frontmatter-less file executable
```

### Supported Models by CLI (December 2025)

**IMPORTANT:** Use these exact model names. Do not guess or use deprecated model names.

> **Staleness note (2026-07):** this table is a December 2025 snapshot and
> newer models have shipped since (e.g. the mdflow.dev examples use
> `gpt-5.5-codex-max` and `gemini-3.1-pro`). When a model name matters,
> verify against the engine CLI's own `--help`/docs instead of this table.

#### Claude Code (`claude`)
| Type | Values |
|------|--------|
| **Aliases** | `sonnet`, `opus`, `haiku`, `opusplan` |
| **Full names** | `claude-sonnet-4-5-20250929`, `claude-opus-4-5-20251101`, `claude-haiku-4-5-20251001`, `claude-opus-4-1-20250805` |

Environment variables for alias control:
- `ANTHROPIC_DEFAULT_SONNET_MODEL` - Override sonnet alias
- `ANTHROPIC_DEFAULT_OPUS_MODEL` - Override opus alias
- `ANTHROPIC_DEFAULT_HAIKU_MODEL` - Override haiku alias

#### Codex CLI (`codex`)
| Type | Values |
|------|--------|
| **Default** | `codex-mini-latest` (o4-mini optimized for CLI) |
| **Reasoning models** | `o3`, `o4-mini` |
| **GPT models** | `gpt-4.1` |

Codex works with any OpenAI model. Example: `-m o3` or `-c model="o3"`

#### Gemini CLI (`gemini`)
| Type | Values |
|------|--------|
| **Default (free)** | `gemini-2.5-pro` |
| **Preview** | `gemini-3-pro` (requires subscription or paid API key) |

To enable Gemini 3 Pro: run `/settings`, toggle "Preview features" to true.

#### Copilot CLI (`copilot`)
Explicit `--model` choices (from `copilot --help`):
| Category | Models |
|----------|--------|
| **Claude** | `claude-sonnet-4.5`, `claude-haiku-4.5`, `claude-opus-4.5`, `claude-sonnet-4` |
| **GPT** | `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.2`, `gpt-5.1`, `gpt-5`, `gpt-5.1-codex-mini`, `gpt-5-mini`, `gpt-4.1` |
| **Gemini** | `gemini-3-pro-preview` |

### Global Config (`~/.mdflow/config.yaml`)

Set default frontmatter per command:

```yaml
commands:
  claude:
    model: sonnet # Default model for claude
```

### Template System (LiquidJS)

Uses [LiquidJS](https://liquidjs.com/) for full template support:

- Variables: `{{ _varname }}` (use `_` prefix for template vars)
- Stdin: `{{ _stdin }}` (auto-injected from piped input)
- Conditionals: `{% if _force %}--force{% endif %}`
- Filters: `{{ _name | upcase }}`, `{{ _value | default: "fallback" }}`
- Shell-escape filter: `{{ _var | shell_escape }}` (alias `{{ _var | q }}`)
  single-quotes a value for safe use inside `` !`cmd` `` — REQUIRED for any
  untrusted-origin variable in an inline command (see imports.ts note above)
- CLI override: `--_varname value` matches `_varname` in frontmatter

## Testing Patterns

Tests use Bun's test runner with `describe`/`it` blocks:

```typescript
import { describe, it, expect } from "bun:test";

describe("parseCliArgs", () => {
  it("parses command flag", () => {
    const result = parseCliArgs(["node", "script", "file.md"]);
    expect(result.filePath).toBe("file.md");
  });
});
```
