/**
 * Per-process CODEX_HOME leases for isolated Codex runs.
 *
 * A lease is an allowlist, not a sanitized copy. It contains only:
 *   - auth.json: a symlink to the original Codex credential file
 *   - config.toml: one generated project trust block (interactive runs only)
 *
 * Every other Codex surface is created by that child and removed with it.
 * In particular, no user config, hooks, plugins, memories, rules, skills,
 * sessions, databases, caches, profiles, or unknown future files are copied.
 */

import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { isRegistryPath, resolveProjectRoot } from "../project-root";

const ORIGINAL_CODEX_HOME = process.env.CODEX_HOME;
const ORIGINAL_HOME = homedir();
const DEAD_LEASE_GRACE_MS = 5 * 60_000;
const ORPHAN_GRACE_MS = 24 * 60 * 60_000;
const AUTH_LOCK_TIMEOUT_MS = 5_000;
const AUTH_LOCK_STALE_MS = 30_000;
const AUTH_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

interface AuthSnapshot {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

interface LeaseRecord {
  schema: 1;
  parentPid: number;
  childPid?: number;
  createdAt: number;
}

export interface CodexRunHomeLease {
  home: string;
  /**
   * HOME rides along with CODEX_HOME: `$HOME/.agents/skills` and
   * `$HOME/.agents/plugins` are ambient context that CODEX_HOME does not
   * govern. See HOME_ALLOWLIST for what is linked back in.
   */
  env: { CODEX_HOME: string; HOME: string };
  /** Disclosed isolation reductions (never silent, never blocking). */
  warnings: string[];
  onSpawn(pid: number): void;
  cleanup(): void;
}

export function sourceCodexHome(
  codexHomeEnv: string | undefined = ORIGINAL_CODEX_HOME,
): string {
  return codexHomeEnv && codexHomeEnv.trim() !== ""
    ? resolve(codexHomeEnv)
    : join(ORIGINAL_HOME, ".codex");
}

export function codexRunHomesRoot(homeDir: string = ORIGINAL_HOME): string {
  return join(homeDir, ".mdflow", "runtime", "codex");
}

export function previewCodexRunHome(homeDir: string = ORIGINAL_HOME): string {
  return join(codexRunHomesRoot(homeDir), "run-<fresh-per-process>");
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Project-local SKILL directories Codex discovers no matter what CODEX_HOME
 * says. Verified on codex-cli 0.145.0 (docs/codex-skills-probe-2026-07.md):
 *
 *  - A fresh CODEX_HOME DOES suppress project `.codex/config.toml` (an
 *    isolated run reports `model: <default>` even when the project pins one),
 *    so a `.codex` holding only config is no longer a leak.
 *  - `-c project_doc_max_bytes=0` suppresses AGENTS.md.
 *  - Project skill dirs still reach the model-visible prompt, and discovery
 *    walks UP from cwd (`<repo>/sub/deeper` inherits `<repo>/.codex/skills`).
 *  - No kill-switch exists: `skills=[]` parses but is inert, and
 *    `--disable skill_search` changes nothing.
 *
 * These surfaces can therefore be DISCLOSED but never neutralized, which is
 * why detection returns paths instead of throwing. Policy lives in
 * `applyProjectSurfacePolicy` below.
 */
const PROJECT_SKILL_SURFACES = [
  join(".codex", "skills"),
  join(".agents", "skills"),
] as const;

/**
 * Where a flow lives relative to the directory it is running in:
 *  - `resident`  — the flow belongs to this project; the project's own skills
 *                  are part of its contract and travel with every checkout.
 *  - `visiting`  — a user/global/PATH flow standing in an unrelated project;
 *                  the project's skills are an accident of cwd, so disclose.
 *  - `registry`  — an installed remote flow; it must never absorb local
 *                  project context, so this is the one case that still fails.
 */
export type FlowProvenance = "resident" | "visiting" | "registry";

/**
 * A flow inherits the config of the project it LIVES in, not the config of a
 * project it happens to be standing in. Falls back to `visiting` whenever the
 * flow path is unknown, so an unplumbed caller discloses rather than hides.
 */
export function classifyFlowProvenance(
  flowPath: string | undefined,
  cwd: string,
): FlowProvenance {
  if (!flowPath) return "visiting";
  if (isRegistryPath(flowPath)) return "registry";
  // Both sides must be canonical before comparison: a spawn cwd arrives
  // already resolved by the OS (macOS reports /private/var for /var), while
  // the flow path is whatever the caller typed. Comparing raw strings
  // misclassified every resident flow under a symlinked root as visiting.
  const rootOf = (path: string): string =>
    canonicalExistingPath(resolveProjectRoot(canonicalExistingPath(path)).projectRoot);
  return rootOf(flowPath) === rootOf(cwd) ? "resident" : "visiting";
}

/**
 * Scan the project scope Codex classifies as local: cwd→Git root, or cwd
 * itself when there is no Git root. Never continues into an ordinary home
 * directory, where `~/.codex` is user state the fresh CODEX_HOME replaces.
 * Read-only: safe to call from passive surfaces (explain, dry-run).
 */
export function detectProjectSkillSurfaces(cwd: string): string[] {
  const canonicalCwd = canonicalExistingPath(cwd);
  let current = canonicalCwd;
  const filesystemRoot = parse(current).root;
  let projectRoot = canonicalCwd;
  while (true) {
    if (existsSync(join(current, ".git"))) {
      projectRoot = current;
      break;
    }
    if (current === filesystemRoot) break;
    current = dirname(current);
  }

  const found: string[] = [];
  const record = (path: string): void => {
    if (existsSync(path) && !found.includes(path)) found.push(path);
  };

  current = canonicalCwd;
  while (true) {
    for (const surface of PROJECT_SKILL_SURFACES) record(join(current, surface));

    if (current === projectRoot) {
      // A linked worktree's `.git` is a file pointing into the root
      // checkout's worktrees dir; that checkout's skills are in scope too.
      const gitMarker = join(current, ".git");
      try {
        if (existsSync(gitMarker) && lstatSync(gitMarker).isFile()) {
          const match = readFileSync(gitMarker, "utf8").match(/^gitdir:\s*(.+)\s*$/m);
          if (match?.[1]) {
            const gitDir = resolve(current, match[1]);
            const worktreesIndex = gitDir.lastIndexOf(`${join(".git", "worktrees")}`);
            if (worktreesIndex !== -1) {
              const checkoutRoot = gitDir.slice(0, worktreesIndex);
              for (const surface of PROJECT_SKILL_SURFACES) {
                record(join(checkoutRoot, surface));
              }
            }
          }
        }
      } catch {
        // An unreadable .git marker cannot be classified; the surfaces found
        // by the ordinary walk still stand.
      }
      return found;
    }
    current = dirname(current);
  }
}

/**
 * Decide what project-local skill surfaces mean for THIS flow. Returns the
 * warnings to disclose; throws only for registry flows, the one case where a
 * leak is a trust problem rather than a reproducibility one.
 *
 * `visiting` deliberately warns instead of refusing: refusing makes every
 * global flow unusable in any repo carrying a `.codex`, and the run is not
 * meaningfully safer for it — ambient `$HOME` skills used to outnumber
 * project ones by roughly 38:1 before the leased HOME below closed them.
 */
export function applyProjectSurfacePolicy(
  cwd: string,
  provenance: FlowProvenance,
): string[] {
  const surfaces = detectProjectSkillSurfaces(cwd);
  if (surfaces.length === 0) return [];
  const list = surfaces.join(", ");

  if (provenance === "registry") {
    throw new Error(
      `Isolated Codex refuses to run an INSTALLED REGISTRY flow inside a project that ` +
        `exposes local skills (${list}). Codex 0.145.0 has no switch to disable project ` +
        `skill discovery, so a remote flow would silently absorb local project context. ` +
        `Run it from outside that project (--_cwd <dir>), or opt out with _isolated: false.`,
    );
  }
  if (provenance === "resident") return [];

  return [
    `ISOLATION_REDUCED: this flow does not belong to the project you are in, but that ` +
      `project's skills are visible to the run (${list}). Codex 0.145.0 has no switch to ` +
      `disable project skill discovery. Run from outside the project (--_cwd <dir>) to avoid it.`,
  ];
}

/**
 * Ambient skills ALSO load from `$HOME/.agents/skills`, and plugins from
 * `$HOME/.agents/plugins/marketplace.json` — neither honors CODEX_HOME, and
 * the 2026-07 probe found no config key or env var that disables them. HOME is
 * the only lever, so the lease becomes the run's HOME.
 *
 * These entries are symlinked back so credentialed work still succeeds:
 * git identity, SSH keys, gh's config, and the macOS login keychain (gh keeps
 * its token in the keyring, which lives under `$HOME/Library/Keychains`).
 * Verified: with these links `git config user.name`, `ls ~/.ssh`, and
 * `gh auth status` all succeed under the leased HOME while ambient skills drop
 * from 38 to 0.
 *
 * SAFETY: rmSync(recursive) unlinks symlinks WITHOUT descending (verified
 * against decoy targets), so lease cleanup can never reach through these into
 * real user state.
 */
const HOME_ALLOWLIST = [
  ".gitconfig",
  ".gitignore_global",
  ".ssh",
  join(".config", "git"),
  join(".config", "gh"),
  join("Library", "Keychains"),
] as const;

function linkHomeAllowlist(home: string, sourceUserHome: string): void {
  for (const entry of HOME_ALLOWLIST) {
    const source = join(sourceUserHome, entry);
    if (!existsSync(source)) continue;
    const dest = join(home, entry);
    try {
      mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
      symlinkSync(source, dest);
    } catch {
      // A missing convenience link degrades that tool inside the run; it must
      // never fail the run itself.
    }
  }
}

export function resolveCodexTrustScope(cwd: string): string {
  let current = canonicalExistingPath(cwd);
  const root = parse(current).root;
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    if (current === root) return canonicalExistingPath(cwd);
    current = dirname(current);
  }
}

function tomlEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

export function renderCodexTrustConfig(scope: string): string {
  return `[projects."${tomlEscape(scope)}"]\ntrust_level = "trusted"\n`;
}

function authSnapshot(path: string): AuthSnapshot | undefined {
  try {
    const stat = statSync(path);
    return {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return undefined;
  }
}

function snapshotsMatch(
  left: AuthSnapshot | undefined,
  right: AuthSnapshot | undefined,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs
  );
}

function writeLease(path: string, record: LeaseRecord): void {
  const tmp = `${path}.tmp.${process.pid}.${leaseWriteCounter++}`;
  writeFileSync(tmp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function withSourceAuthLock<T>(sourceAuth: string, action: () => T): T {
  const sourceDir = dirname(sourceAuth);
  const lockDir = join(sourceDir, ".auth.json.mdflow.lock");
  const ownerPath = join(lockDir, "owner.json");
  const deadline = Date.now() + AUTH_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      writeFileSync(
        ownerPath,
        `${JSON.stringify({ schema: 1, pid: process.pid, createdAt: Date.now() })}\n`,
        { mode: 0o600 },
      );
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      let removeStale = false;
      try {
        const owner = JSON.parse(readFileSync(ownerPath, "utf8")) as {
          pid?: number;
          createdAt?: number;
        };
        removeStale =
          typeof owner.createdAt === "number" &&
          Date.now() - owner.createdAt >= AUTH_LOCK_STALE_MS &&
          (typeof owner.pid !== "number" || !pidAlive(owner.pid));
      } catch {
        try {
          removeStale =
            Date.now() - statSync(lockDir).mtimeMs >= AUTH_LOCK_STALE_MS;
        } catch {
          // A racing owner may have released the lock. Retry normally.
        }
      }
      if (removeStale) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "Timed out waiting to reconcile an isolated Codex auth rotation.",
        );
      }
      Atomics.wait(AUTH_LOCK_WAIT, 0, 0, 10);
    }
  }

  try {
    return action();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export function pruneStaleCodexRunHomes(opts: {
  runRoot: string;
  now?: number;
  isPidAlive?: (pid: number) => boolean;
}): void {
  const now = opts.now ?? Date.now();
  const isAlive = opts.isPidAlive ?? pidAlive;
  const leasesDir = join(opts.runRoot, ".leases");
  if (!existsSync(opts.runRoot)) return;

  for (const entry of readdirSync(opts.runRoot, { withFileTypes: true })) {
    if (!entry.name.startsWith("run-") || !entry.isDirectory()) continue;
    const home = join(opts.runRoot, entry.name);
    try {
      if (lstatSync(home).isSymbolicLink()) continue;
    } catch {
      continue;
    }

    const leasePath = join(leasesDir, `${entry.name}.json`);
    let record: LeaseRecord | undefined;
    try {
      const parsed = JSON.parse(readFileSync(leasePath, "utf8")) as LeaseRecord;
      if (
        parsed.schema === 1 &&
        Number.isInteger(parsed.parentPid) &&
        Number.isFinite(parsed.createdAt)
      ) {
        record = parsed;
      }
    } catch {
      // Missing/corrupt sidecars use the conservative orphan TTL below.
    }

    if (
      record &&
      (isAlive(record.parentPid) ||
        (record.childPid !== undefined && isAlive(record.childPid)))
    ) {
      continue;
    }

    const createdAt = record?.createdAt ?? statSync(home).mtimeMs;
    const grace = record ? DEAD_LEASE_GRACE_MS : ORPHAN_GRACE_MS;
    if (now - createdAt < grace) continue;

    rmSync(home, { recursive: true, force: true });
    rmSync(leasePath, { force: true });
  }
}

export function createCodexRunHome(opts: {
  sourceHome?: string;
  runRoot?: string;
  cwd: string;
  interactive: boolean;
  now?: number;
  parentPid?: number;
  /**
   * Defaults to `visiting`: the conservative choice, because it discloses.
   * Only a positively identified resident flow earns silence, and only a
   * positively identified registry flow is refused.
   */
  provenance?: FlowProvenance;
  /** Injectable for tests; defaults to the real user home. */
  sourceUserHome?: string;
}): CodexRunHomeLease {
  const warnings = applyProjectSurfacePolicy(
    opts.cwd,
    opts.provenance ?? "visiting",
  );
  const sourceHome = opts.sourceHome ?? sourceCodexHome();
  const sourceUserHome = opts.sourceUserHome ?? ORIGINAL_HOME;
  const runRoot = opts.runRoot ?? codexRunHomesRoot();
  const now = opts.now ?? Date.now();
  const parentPid = opts.parentPid ?? process.pid;
  const leasesDir = join(runRoot, ".leases");

  const sourceAuthInput = join(sourceHome, "auth.json");
  let sourceAuth: string;
  try {
    sourceAuth = realpathSync(sourceAuthInput);
  } catch {
    throw new Error(
      `Isolated Codex requires an existing auth.json in the original Codex home (${sourceAuthInput}).`,
    );
  }
  const originalAuthSnapshot = authSnapshot(sourceAuth);
  if (!originalAuthSnapshot) {
    throw new Error(
      `Isolated Codex could not validate the original auth.json (${sourceAuthInput}).`,
    );
  }

  mkdirSync(leasesDir, { recursive: true, mode: 0o700 });
  chmodSync(runRoot, 0o700);
  chmodSync(leasesDir, 0o700);
  pruneStaleCodexRunHomes({ runRoot, now });

  const home = mkdtempSync(join(runRoot, `run-${parentPid}-${now}-`));
  chmodSync(home, 0o700);
  const leasePath = join(leasesDir, `${basename(home)}.json`);
  const record: LeaseRecord = { schema: 1, parentPid, createdAt: now };
  writeLease(leasePath, record);

  symlinkSync(sourceAuth, join(home, "auth.json"));
  linkHomeAllowlist(home, sourceUserHome);

  if (opts.interactive) {
    const configPath = join(home, "config.toml");
    writeFileSync(
      configPath,
      renderCodexTrustConfig(resolveCodexTrustScope(opts.cwd)),
      { mode: 0o600 },
    );
    chmodSync(configPath, 0o600);
  }

  let cleaned = false;
  return {
    home,
    env: { CODEX_HOME: home, HOME: home },
    warnings,
    onSpawn(childPid: number): void {
      record.childPid = childPid;
      writeLease(leasePath, record);
    },
    cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      try {
        const runAuth = join(home, "auth.json");
        if (existsSync(runAuth)) {
          const runAuthStat = lstatSync(runAuth);
          if (runAuthStat.isFile()) {
            withSourceAuthLock(sourceAuth, () => {
              if (!snapshotsMatch(originalAuthSnapshot, authSnapshot(sourceAuth))) {
                return;
              }
              const tmp = join(
                dirname(sourceAuth),
                `.auth.json.mdflow.${process.pid}.${leaseWriteCounter++}`,
              );
              copyFileSync(runAuth, tmp);
              chmodSync(tmp, 0o600);
              renameSync(tmp, sourceAuth);
            });
          }
        }
      } finally {
        rmSync(home, { recursive: true, force: true });
        rmSync(leasePath, { force: true });
      }
    },
  };
}

let leaseWriteCounter = 0;
