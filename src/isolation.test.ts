/**
 * Tests for isolation mode (`_isolated: true`).
 *
 * Every isolation flag asserted here was verified against the engine's own
 * --help or shipped source — see src/isolation.ts for the audit trail.
 */

import { describe, test, expect } from "bun:test";
import {
  applyIsolationDefaults,
  applyIsolationEnvironment,
  resolveIsolationMode,
  resolveIsolationDefaults,
} from "./isolation";
import { applyDefaults } from "./config";
import { buildArgs } from "./command";
import { claudeAdapter } from "./adapters/claude";
import {
  CODEX_ISOLATION_UNSET_ENV,
  codexAdapter,
} from "./adapters/codex";
import { geminiAdapter } from "./adapters/gemini";
import { copilotAdapter } from "./adapters/copilot";
import { opencodeAdapter } from "./adapters/opencode";
import { piAdapter } from "./adapters/pi";
import { droidAdapter } from "./adapters/droid";
import { cursorAgentAdapter } from "./adapters/cursor-agent";
import { agyAdapter } from "./adapters/agy";
import type { AgentFrontmatter } from "./types";

describe("resolveIsolationMode", () => {
  test("ISOLATION IS ON BY DEFAULT — the flow file is the entire behavior", () => {
    expect(resolveIsolationMode({ frontmatter: {} })).toEqual({
      isolated: true,
      explicit: false,
    });
  });

  test("frontmatter _isolated: false opts out (ambient context)", () => {
    expect(resolveIsolationMode({ frontmatter: { _isolated: false } })).toEqual({
      isolated: false,
      explicit: true,
    });
  });

  test("frontmatter _isolated: true is explicit (enables no-lever warning)", () => {
    expect(resolveIsolationMode({ frontmatter: { _isolated: true } })).toEqual({
      isolated: true,
      explicit: true,
    });
  });

  test("CLI value wins over frontmatter", () => {
    expect(
      resolveIsolationMode({ frontmatter: { _isolated: true }, cliValue: false })
    ).toEqual({ isolated: false, explicit: true });
  });

  test("config default _isolated: false opts out machine-wide", () => {
    expect(
      resolveIsolationMode({ frontmatter: {}, commandDefaults: { _isolated: false } })
    ).toEqual({ isolated: false, explicit: true });
  });

  test("frontmatter beats config opt-out", () => {
    expect(
      resolveIsolationMode({
        frontmatter: { _isolated: true },
        commandDefaults: { _isolated: false },
      })
    ).toEqual({ isolated: true, explicit: true });
  });
});

describe("per-engine isolation defaults (verified flags only)", () => {
  test("claude: --safe-mode + --no-session-persistence", () => {
    expect(resolveIsolationDefaults(claudeAdapter, "claude").defaults).toEqual({
      "safe-mode": true,
      "no-session-persistence": true,
    });
  });

  test("codex: --ignore-user-config --ephemeral --skip-git-repo-check -c project_doc_max_bytes=0", () => {
    expect(resolveIsolationDefaults(codexAdapter, "codex").defaults).toEqual({
      "ignore-user-config": true,
      ephemeral: true,
      // Without this, isolated exec runs refuse to start outside a git repo:
      // --ignore-user-config drops [projects] trust, and codex then requires
      // either a trusted directory or this flag.
      "skip-git-repo-check": true,
      config: ["project_doc_max_bytes=0"],
    });
  });

  test("codex: preview describes a fresh per-process home without creating it", () => {
    const prepared = codexAdapter.prepareIsolationEnv!({
      mode: "preview",
      cwd: process.cwd(),
      interactive: false,
    });
    expect(prepared?.env.CODEX_HOME).toContain(
      "/.mdflow/runtime/codex/run-<fresh-per-process>",
    );
    expect(prepared?.unsetEnv).toEqual([...CODEX_ISOLATION_UNSET_ENV]);
    expect(prepared?.unsetEnv).toContain("CODEX_OSS_PORT");
  });

  test("codex: the isolation environment overrides an ambient flow CODEX_HOME", () => {
    const isolated = applyIsolationEnvironment(
      { _env: { CODEX_HOME: "/ambient", KEEP: "yes" } },
      codexAdapter,
      { cwd: process.cwd(), interactive: false },
    );
    expect(isolated._env?.CODEX_HOME).toContain(
      "/.mdflow/runtime/codex/run-<fresh-per-process>",
    );
    expect(isolated._env?.KEEP).toBe("yes");
  });

  test("gemini: --extensions none", () => {
    expect(resolveIsolationDefaults(geminiAdapter, "gemini").defaults).toEqual({
      extensions: "none",
    });
  });

  test("copilot: --no-custom-instructions --disable-builtin-mcps", () => {
    expect(resolveIsolationDefaults(copilotAdapter, "copilot").defaults).toEqual({
      "no-custom-instructions": true,
      "disable-builtin-mcps": true,
    });
  });

  test("opencode: --pure", () => {
    expect(resolveIsolationDefaults(opencodeAdapter, "opencode").defaults).toEqual({
      pure: true,
    });
  });

  test("pi: hermetic set lives in the isolation layer; getDefaults is print-only", () => {
    const isolation = resolveIsolationDefaults(piAdapter, "pi").defaults;
    expect(isolation).toEqual({
      "no-extensions": true,
      "no-skills": true,
      "no-prompt-templates": true,
      "no-context-files": true,
      "no-session": true,
    });
    // With isolation default-on for every engine, pi's own defaults carry
    // only mode plumbing — `_isolated: false` restores ambient pi too.
    expect(piAdapter.getDefaults()).toEqual({ print: true });
  });

  test("droid/cursor-agent/agy have no isolation controls and warn", () => {
    for (const [adapter, name] of [
      [droidAdapter, "droid"],
      [cursorAgentAdapter, "cursor-agent"],
      [agyAdapter, "agy"],
    ] as const) {
      const result = resolveIsolationDefaults(adapter, name);
      expect(result.defaults).toEqual({});
      expect(result.unsupportedWarning).toContain(name);
      expect(result.unsupportedWarning).toContain("_isolated");
    }
  });
});

describe("isolation precedence: config defaults < isolation < frontmatter", () => {
  test("frontmatter can re-enable a single layer", () => {
    const isolation = resolveIsolationDefaults(claudeAdapter, "claude").defaults;
    const effectiveDefaults = { print: true, ...isolation };
    const frontmatter: AgentFrontmatter = { "safe-mode": false };
    const merged = applyDefaults(frontmatter, effectiveDefaults);
    expect(merged["safe-mode"]).toBe(false);
    expect(merged["no-session-persistence"]).toBe(true);
  });

  test("isolated claude flow builds --safe-mode into args", () => {
    const isolation = resolveIsolationDefaults(claudeAdapter, "claude").defaults;
    const merged = applyDefaults({}, { print: true, ...isolation });
    const args = buildArgs(merged, new Set(), "claude");
    expect(args).toContain("--safe-mode");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--print");
  });

  test("isolated codex flow builds -c/--config override into args", () => {
    const isolation = resolveIsolationDefaults(codexAdapter, "codex").defaults;
    const merged = applyDefaults({}, { _subcommand: "exec", ...isolation });
    const args = buildArgs(merged, new Set(), "codex");
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ephemeral");
    const cfgIdx = args.indexOf("--config");
    expect(cfgIdx).toBeGreaterThanOrEqual(0);
    expect(args[cfgIdx + 1]).toBe("project_doc_max_bytes=0");
  });

  test("codex repeatable config preserves project, isolation, and flow entries", () => {
    const isolation = resolveIsolationDefaults(codexAdapter, "codex").defaults;
    const merged = applyIsolationDefaults(
      { config: 'model_reasoning_effort="medium"' },
      { _subcommand: "exec", config: ["profile=project"] },
      isolation
    );

    expect(merged.config).toEqual([
      "profile=project",
      "project_doc_max_bytes=0",
      'model_reasoning_effort="medium"',
    ]);

    const args = buildArgs(merged, new Set(), "codex");
    const configValues = args.flatMap((arg, index) =>
      arg === "--config" ? [args[index + 1]] : []
    );
    expect(configValues).toEqual([
      "profile=project",
      "project_doc_max_bytes=0",
      'model_reasoning_effort="medium"',
    ]);
  });

  test("codex final isolation owns every hook config and bypass argument", () => {
    const ownedHook = 'hooks={SessionStart=[{hooks=[{type="command",command="/flow"}]}]}';
    const args = codexAdapter.finalizeIsolationArgs!(
      [
        "--config",
        'hooks={SessionStart=[{hooks=[{type="command",command="/ambient"}]}]}',
        "--config=hooks={Stop=[]}",
        "--config",
        " hooks={Stop=[]}",
        "--config",
        "hooks.SessionStart=[]",
        "-c=hooks.Stop=[]",
        "--config= hooks.state={}",
        "--config",
        '"hooks".SessionStart=[]',
        "-c='hooks'.Stop=[]",
        "--dangerously-bypass-hook-trust=true",
        "--dangerously-bypass-hook-trust",
        "false",
        "--model",
        "gpt-5.6-sol",
      ],
      {
        interactive: true,
        ownedHookArgs: [
          "--config",
          ownedHook,
          "--dangerously-bypass-hook-trust",
        ],
      },
    );

    expect(args.join("\n")).not.toContain("/ambient");
    expect(args).not.toContain("--config=hooks={Stop=[]}");
    expect(
      args.filter((arg) => /^\s*hooks(?:\.|=)/.test(arg)),
    ).toEqual([ownedHook]);
    expect(args.join("\n")).not.toContain('"hooks".');
    expect(args.join("\n")).not.toContain("'hooks'.");
    expect(
      args.filter((arg) => arg === "--dangerously-bypass-hook-trust"),
    ).toHaveLength(1);
    expect(args.filter((arg) => arg === ownedHook)).toHaveLength(1);
    expect(args).not.toContain("false");
    expect(args).toContain("gpt-5.6-sol");

    const hookless = codexAdapter.finalizeIsolationArgs!(
      [
        "--dangerously-bypass-hook-trust",
        "--config",
        "hooks={Stop=[]}",
        "--config",
        "hooks.SessionStart=[]",
        "-c=hooks.Stop=[]",
        "--config= hooks.state={}",
        "--config",
        '"hooks".SessionStart=[]',
        "-c='hooks'.Stop=[]",
      ],
      { interactive: true },
    );
    expect(hookless.join("\n")).not.toMatch(/(^|\n)\s*hooks(?:\.|=)/);
    expect(hookless.join("\n")).not.toContain('"hooks".');
    expect(hookless.join("\n")).not.toContain("'hooks'.");
    expect(hookless).not.toContain("--dangerously-bypass-hook-trust");
  });
});

describe("interactive mode strips print-only isolation flags", () => {
  test("claude: --no-session-persistence only works with --print", () => {
    const frontmatter: AgentFrontmatter = {
      print: true,
      "safe-mode": true,
      "no-session-persistence": true,
    };
    const result = claudeAdapter.applyInteractiveMode(frontmatter);
    expect(result.print).toBeUndefined();
    expect(result["no-session-persistence"]).toBeUndefined();
    // --safe-mode works in interactive mode too — kept.
    expect(result["safe-mode"]).toBe(true);
  });

  test("codex: --ignore-user-config/--ephemeral/--skip-git-repo-check are exec-only", () => {
    const frontmatter: AgentFrontmatter = {
      _subcommand: "exec",
      "ignore-user-config": true,
      ephemeral: true,
      "skip-git-repo-check": true,
      config: ["project_doc_max_bytes=0"],
    };
    const result = codexAdapter.applyInteractiveMode(frontmatter);
    expect(result._subcommand).toBeUndefined();
    expect(result["ignore-user-config"]).toBeUndefined();
    expect(result.ephemeral).toBeUndefined();
    expect(result["skip-git-repo-check"]).toBeUndefined();
    // -c is top-level; the AGENTS.md kill-switch survives interactive mode.
    expect(result.config).toEqual(["project_doc_max_bytes=0"]);
  });

  test("gemini/opencode isolation flags survive interactive mode", () => {
    const gemini = geminiAdapter.applyInteractiveMode({ extensions: "none" });
    expect(gemini.extensions).toBe("none");
    const opencode = opencodeAdapter.applyInteractiveMode({
      _subcommand: "run",
      pure: true,
    });
    expect(opencode.pure).toBe(true);
    expect(opencode._subcommand).toBeUndefined();
  });
});
