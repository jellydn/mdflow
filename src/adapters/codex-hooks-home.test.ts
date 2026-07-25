import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCodexRunHome,
  pruneStaleCodexRunHomes,
  renderCodexTrustConfig,
  resolveCodexTrustScope,
} from "./codex-hooks-home";

let root: string;
let source: string;
let runRoot: string;
let project: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mdflow-codex-lease-"));
  source = join(root, "source");
  runRoot = join(root, "runs");
  project = join(root, "project");
  // Hermetic stand-in for the real $HOME: the lease symlinks an allowlist
  // (git identity, ssh, gh, keychain) out of it, and tests must never reach
  // into the developer's actual home to do that.
  userHome = join(root, "user-home");
  mkdirSync(source, { recursive: true });
  mkdirSync(userHome, { recursive: true });
  mkdirSync(join(project, ".git"), { recursive: true });
  writeFileSync(join(source, "auth.json"), "synthetic-auth");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("Codex run-home lease", () => {
  it("creates a fresh allowlisted home for every child", () => {
    writeFileSync(join(source, "config.toml"), 'model = "ambient"\n');
    writeFileSync(join(source, "hooks.json"), "{}");
    mkdirSync(join(source, "plugins"));
    mkdirSync(join(source, "future-unknown"));

    const first = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });
    const second = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });

    expect(first.home).not.toBe(second.home);
    expect(readdirSync(first.home)).toEqual(["auth.json"]);
    expect(readdirSync(second.home)).toEqual(["auth.json"]);
    expect(lstatSync(join(first.home, "auth.json")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(first.home, "auth.json"))).toBe(
      realpathSync(join(source, "auth.json")),
    );
    expect(statSync(first.home).mode & 0o777).toBe(0o700);

    first.cleanup();
    second.cleanup();
    expect(existsSync(first.home)).toBe(false);
    expect(existsSync(second.home)).toBe(false);
  });

  it("generates exactly one interactive trust block without reading source config", () => {
    writeFileSync(join(source, "config.toml"), 'model = "must-not-load"\n');
    chmodSync(join(source, "config.toml"), 0o000);
    const nested = join(project, "src", "nested");
    mkdirSync(nested, { recursive: true });

    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: nested,
      interactive: true,
    });

    expect(readdirSync(lease.home).sort()).toEqual(["auth.json", "config.toml"]);
    expect(readFileSync(join(lease.home, "config.toml"), "utf8")).toBe(
      renderCodexTrustConfig(resolveCodexTrustScope(nested)),
    );
    expect(statSync(join(lease.home, "config.toml")).mode & 0o777).toBe(0o600);
    lease.cleanup();
  });

  it("removes every child-created surface and cleanup is idempotent", () => {
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: true,
    });
    mkdirSync(join(lease.home, "plugins"));
    mkdirSync(join(lease.home, "memories"));
    writeFileSync(join(lease.home, "state.db"), "state");
    lease.cleanup();
    lease.cleanup();
    expect(existsSync(lease.home)).toBe(false);
  });

  it("ignores a project .codex that carries no skills", () => {
    // Verified on codex-cli 0.145.0: a fresh CODEX_HOME DOES suppress project
    // config.toml, so a config-only .codex is no longer a leak and must not
    // warn. Warning on it would train users to ignore the warning.
    mkdirSync(join(project, ".codex"));
    writeFileSync(join(project, ".codex", "config.toml"), 'model = "ignored"\n');
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: true,
      provenance: "visiting",
    });
    expect(lease.warnings).toEqual([]);
    lease.cleanup();
  });

  it("discloses project skills to a visiting flow instead of refusing", () => {
    mkdirSync(join(project, ".codex", "skills", "probe"), { recursive: true });
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: true,
      provenance: "visiting",
    });
    expect(lease.warnings).toHaveLength(1);
    expect(lease.warnings[0]).toContain("ISOLATION_REDUCED");
    expect(lease.warnings[0]).toContain(join(project, ".codex", "skills"));
    expect(existsSync(lease.home)).toBe(true);
    lease.cleanup();
  });

  it("stays silent when the flow belongs to the project it runs in", () => {
    mkdirSync(join(project, ".codex", "skills", "probe"), { recursive: true });
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: true,
      provenance: "resident",
    });
    expect(lease.warnings).toEqual([]);
    lease.cleanup();
  });

  it("still fails closed for a registry flow, before creating the run root", () => {
    mkdirSync(join(project, ".codex", "skills", "probe"), { recursive: true });
    expect(() =>
      createCodexRunHome({
        sourceHome: source,
        runRoot,
        sourceUserHome: userHome,
        cwd: project,
        interactive: true,
        provenance: "registry",
      }),
    ).toThrow("INSTALLED REGISTRY flow");
    expect(existsSync(runRoot)).toBe(false);
  });

  it("detects the .agents/skills surface the old guard missed", () => {
    mkdirSync(join(project, ".agents", "skills", "probe"), { recursive: true });
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: true,
      provenance: "visiting",
    });
    expect(lease.warnings[0]).toContain(join(project, ".agents", "skills"));
    lease.cleanup();
  });

  it("leases HOME and links only the credential allowlist", () => {
    // $HOME/.agents/skills is ambient context CODEX_HOME does not govern and
    // codex 0.145.0 offers no switch for, so HOME itself must be leased.
    mkdirSync(join(userHome, ".agents", "skills", "ambient"), { recursive: true });
    mkdirSync(join(userHome, ".ssh"), { recursive: true });
    mkdirSync(join(userHome, ".config", "gh"), { recursive: true });
    writeFileSync(join(userHome, ".gitconfig"), "[user]\n\tname = Probe\n");
    writeFileSync(join(userHome, ".secret-do-not-link"), "nope");

    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });

    expect(lease.env.HOME).toBe(lease.home);
    expect(lease.env.CODEX_HOME).toBe(lease.home);
    expect(lstatSync(join(lease.home, ".gitconfig")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(lease.home, ".ssh")).isSymbolicLink()).toBe(true);
    expect(existsSync(join(lease.home, ".config", "gh"))).toBe(true);
    // Nothing else is linked — least of all the ambient skills we are here for.
    expect(existsSync(join(lease.home, ".agents"))).toBe(false);
    expect(existsSync(join(lease.home, ".secret-do-not-link"))).toBe(false);

    lease.cleanup();
    // Cleanup unlinks symlinks without descending into real user state.
    expect(existsSync(join(userHome, ".ssh"))).toBe(true);
    expect(readFileSync(join(userHome, ".gitconfig"), "utf8")).toContain("Probe");
  });

  it("does not mistake an ordinary parent user .codex for project config", () => {
    const fakeUser = join(root, "user");
    const nonGitProject = join(fakeUser, "work", "plain-project");
    mkdirSync(join(fakeUser, ".codex"), { recursive: true });
    mkdirSync(nonGitProject, { recursive: true });

    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: nonGitProject,
      interactive: true,
    });

    expect(existsSync(lease.home)).toBe(true);
    lease.cleanup();
  });

  it("fails before creating the runtime root when source auth is missing", () => {
    rmSync(join(source, "auth.json"));
    expect(() =>
      createCodexRunHome({
        sourceHome: source,
        runRoot,
        sourceUserHome: userHome,
        cwd: project,
        interactive: false,
      }),
    ).toThrow("requires an existing auth.json");
    expect(existsSync(runRoot)).toBe(false);
  });

  it("promotes a child auth rotation only while the source is unchanged", () => {
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });
    rmSync(join(lease.home, "auth.json"));
    writeFileSync(join(lease.home, "auth.json"), "rotated");
    lease.cleanup();
    expect(readFileSync(join(source, "auth.json"), "utf8")).toBe("rotated");

    const stale = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });
    rmSync(join(stale.home, "auth.json"));
    writeFileSync(join(stale.home, "auth.json"), "stale-child");
    writeFileSync(join(source, "auth.json"), "newer-source");
    stale.cleanup();
    expect(readFileSync(join(source, "auth.json"), "utf8")).toBe("newer-source");
  });

  it("lets only the first lease created from a shared auth snapshot publish", () => {
    const first = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });
    const stale = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
    });
    rmSync(join(first.home, "auth.json"));
    rmSync(join(stale.home, "auth.json"));
    writeFileSync(join(first.home, "auth.json"), "first-rotation");
    writeFileSync(join(stale.home, "auth.json"), "stale-rotation");

    first.cleanup();
    stale.cleanup();

    expect(readFileSync(join(source, "auth.json"), "utf8")).toBe(
      "first-rotation",
    );
    expect(existsSync(join(source, ".auth.json.mdflow.lock"))).toBe(false);
  });

  it("records the child pid without putting secrets in the sidecar", () => {
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
      parentPid: 321,
      now: 1234,
    });
    lease.onSpawn(654);
    const sidecar = readFileSync(
      join(runRoot, ".leases", `${lease.home.split("/").at(-1)}.json`),
      "utf8",
    );
    expect(JSON.parse(sidecar)).toEqual({
      schema: 1,
      parentPid: 321,
      childPid: 654,
      createdAt: 1234,
    });
    expect(sidecar).not.toContain("synthetic-auth");
    lease.cleanup();
  });
});

describe("stale lease pruning", () => {
  it("keeps live leases and removes dead stale leases", () => {
    const lease = createCodexRunHome({
      sourceHome: source,
      runRoot,
      sourceUserHome: userHome,
      cwd: project,
      interactive: false,
      parentPid: 111,
      now: 1_000,
    });
    lease.onSpawn(222);

    pruneStaleCodexRunHomes({
      runRoot,
      now: 1_000_000,
      isPidAlive: (pid) => pid === 111,
    });
    expect(existsSync(lease.home)).toBe(true);

    pruneStaleCodexRunHomes({
      runRoot,
      now: 1_000_000,
      isPidAlive: (pid) => pid === 222,
    });
    expect(existsSync(lease.home)).toBe(true);

    pruneStaleCodexRunHomes({
      runRoot,
      now: 1_000_000,
      isPidAlive: () => false,
    });
    expect(existsSync(lease.home)).toBe(false);
  });

  it("uses a conservative TTL for corrupt sidecars and never follows run symlinks", () => {
    mkdirSync(join(runRoot, ".leases"), { recursive: true });
    const corrupt = join(runRoot, "run-corrupt");
    mkdirSync(corrupt);
    writeFileSync(join(runRoot, ".leases", "run-corrupt.json"), "{");
    utimesSync(corrupt, new Date(1_000), new Date(1_000));

    const target = join(root, "outside-target");
    mkdirSync(target);
    writeFileSync(join(target, "sentinel"), "keep");
    symlinkSync(target, join(runRoot, "run-symlink"));

    pruneStaleCodexRunHomes({
      runRoot,
      now: 1_000 + 23 * 60 * 60_000,
      isPidAlive: () => false,
    });
    expect(existsSync(corrupt)).toBe(true);

    pruneStaleCodexRunHomes({
      runRoot,
      now: 1_000 + 25 * 60 * 60_000,
      isPidAlive: () => false,
    });
    expect(existsSync(corrupt)).toBe(false);
    expect(readFileSync(join(target, "sentinel"), "utf8")).toBe("keep");
  });
});
