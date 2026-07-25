/**
 * Process-level isolation regressions. A fake Codex binary captures the
 * environment mdflow actually spawns, so these tests cover the full pipeline
 * rather than only adapter return values.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_ISOLATION_UNSET_ENV } from "./adapters/codex";

const CLI = join(import.meta.dir, "index.ts");
const CREDENTIAL_ENV_KEYS = CODEX_ISOLATION_UNSET_ENV;

let root: string;
let home: string;
let ambientCodexHome: string;
let binDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mdflow-isolation-int-"));
  home = join(root, "home");
  ambientCodexHome = join(root, "ambient-codex");
  binDir = join(root, "bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(ambientCodexHome, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(join(ambientCodexHome, "auth.json"), '{"token":"test"}');
  writeFileSync(
    join(ambientCodexHome, "config.toml"),
    `[projects.${JSON.stringify(root)}]\ntrust_level = "trusted"\n`
  );
  writeFileSync(
    join(ambientCodexHome, "hooks.json"),
    '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"ambient-hook"}]}]}}'
  );
  for (const name of [
    "hooks",
    "plugins",
    "memories",
    "rules",
    "skills",
    "sessions",
    "profiles",
    "future-surface-unknown",
  ]) {
    mkdirSync(join(ambientCodexHome, name));
    writeFileSync(join(ambientCodexHome, name, "sentinel"), name);
  }

  const codexStub = join(binDir, "codex");
  writeFileSync(
    codexStub,
    `#!/usr/bin/env bun
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
const codexHome = process.env.CODEX_HOME ?? "";
const marker = process.env.MDFLOW_TEST_MARKER ?? "";
if (marker) await Bun.write(join(codexHome, "marker-" + marker), marker);
await Bun.write(process.env.MDFLOW_TEST_RECEIPT!, JSON.stringify({
  codexHome,
  hooksPresent: existsSync(join(codexHome, "hooks.json")),
  initialEntries: readdirSync(codexHome).sort(),
  authIsSymlink: existsSync(join(codexHome, "auth.json"))
    ? lstatSync(join(codexHome, "auth.json")).isSymbolicLink()
    : false,
  args: process.argv.slice(2),
  allowedEnv: process.env.MDFLOW_ALLOWED_ENV,
  credentialEnvKeysPresent: ${JSON.stringify(CREDENTIAL_ENV_KEYS)}.filter(
    (key) => process.env[key] !== undefined
  ),
}));
const barrierDir = process.env.MDFLOW_TEST_BARRIER_DIR;
if (barrierDir && marker) {
  await Bun.write(join(barrierDir, "ready-" + marker), "ready");
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(barrierDir, "release")) && Date.now() < deadline) {
    await Bun.sleep(10);
  }
}
await Bun.write(join(codexHome, "child-state.db"), "discard me");
`
  );
  chmodSync(codexStub, 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeFlow(name: string, extraFrontmatter = ""): string {
  const flow = join(root, name);
  writeFileSync(
    flow,
    `---\ndescription: isolation regression${extraFrontmatter ? `\n${extraFrontmatter}` : ""}\n---\nSay ok.\n`
  );
  return flow;
}

async function runFlow(
  flow: string,
  receipt: string,
  extraEnv: Record<string, string> = {},
) {
  const proc = Bun.spawn(["bun", "run", CLI, flow], {
    cwd: root,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: ambientCodexHome,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      MDFLOW_EVAL_RUN: "1",
      MDFLOW_TEST_RECEIPT: receipt,
      // Interactive fixtures run headless against the fake engine; the
      // TTY preflight would otherwise reject them before spawn.
      MDFLOW_ASSUME_TTY: "1",
      NO_COLOR: "1",
      ...extraEnv,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function readReceipt(path: string): {
  codexHome: string;
  hooksPresent: boolean;
  initialEntries: string[];
  authIsSymlink: boolean;
  args: string[];
  allowedEnv?: string;
  credentialEnvKeysPresent: string[];
} {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("Codex isolation environment", () => {
  it("excludes ambient hooks from hookless exec and interactive flows", async () => {
    const seen = new Set<string>();

    for (const name of ["hookless.codex.md", "hookless.i.codex.md"]) {
      const receipt = join(root, `${name}.receipt.json`);
      const result = await runFlow(writeFlow(name), receipt);
      expect(result.exitCode).toBe(0);

      const spawned = readReceipt(receipt);
      expect(spawned.codexHome).toStartWith(
        join(home, ".mdflow", "runtime", "codex", "run-"),
      );
      expect(seen.has(spawned.codexHome)).toBe(false);
      seen.add(spawned.codexHome);
      expect(spawned.hooksPresent).toBe(false);
      expect(spawned.authIsSymlink).toBe(true);
      expect(spawned.initialEntries).toEqual(
        name.includes(".i.") ? ["auth.json", "config.toml"] : ["auth.json"],
      );
      expect(existsSync(spawned.codexHome)).toBe(false);
    }
  });

  it("keeps isolation with _hooks false and restores ambient hooks only with _isolated false", async () => {
    const disabledHooksReceipt = join(root, "hooks-disabled.receipt.json");
    const disabledHooks = await runFlow(
      writeFlow("hooks-disabled.i.codex.md", "_hooks: false"),
      disabledHooksReceipt
    );
    expect(disabledHooks.exitCode).toBe(0);
    const isolatedReceipt = readReceipt(disabledHooksReceipt);
    expect(isolatedReceipt.codexHome).toStartWith(
      join(home, ".mdflow", "runtime", "codex", "run-"),
    );
    expect(isolatedReceipt.hooksPresent).toBe(false);
    expect(existsSync(isolatedReceipt.codexHome)).toBe(false);

    const ambientReceipt = join(root, "ambient.receipt.json");
    const ambient = await runFlow(
      writeFlow("ambient.codex.md", "_isolated: false"),
      ambientReceipt
    );
    expect(ambient.exitCode).toBe(0);
    expect(readReceipt(ambientReceipt)).toMatchObject({
      codexHome: ambientCodexHome,
      hooksPresent: true,
    });
  });

  it("overrides hostile CODEX_HOME and creates unique homes concurrently", async () => {
    const hostileSelectorFrontmatter = CREDENTIAL_ENV_KEYS.map(
      (key) => `  ${key}: MDFLOW_AUTH_VALUE_MUST_NOT_APPEAR`,
    ).join("\n");
    const hostileInheritedEnv = Object.fromEntries(
      CREDENTIAL_ENV_KEYS.map((key) => [
        key,
        "MDFLOW_AUTH_VALUE_MUST_NOT_APPEAR",
      ]),
    );
    const flows = ["one.codex.md", "two.codex.md"].map((name) => {
      const receipt = join(root, `${name}.receipt.json`);
      return {
        receipt,
        result: runFlow(
          writeFlow(
            name,
            `_env:\n  HOME: /attacker/home\n  CODEX_HOME: /attacker/codex\n${hostileSelectorFrontmatter}\n  MDFLOW_ALLOWED_ENV: yes`,
          ),
          receipt,
          hostileInheritedEnv,
        ),
      };
    });
    const results = await Promise.all(flows.map((flow) => flow.result));
    expect(results.every((result) => result.exitCode === 0)).toBe(true);
    const receipts = flows.map((flow) => readReceipt(flow.receipt));
    expect(receipts[0]!.codexHome).not.toBe(receipts[1]!.codexHome);
    for (const receipt of receipts) {
      expect(receipt.codexHome).not.toBe("/attacker/home");
      expect(receipt.initialEntries).toEqual(["auth.json"]);
      expect(receipt.allowedEnv).toBe("yes");
      expect(receipt.credentialEnvKeysPresent).toEqual([]);
      expect(existsSync(receipt.codexHome)).toBe(false);
    }
  });

  it("keeps two isolated children live simultaneously without shared state", async () => {
    const barrier = join(root, "barrier");
    mkdirSync(barrier);
    const flows = ["alpha", "beta"].map((marker) => {
      const receipt = join(root, `${marker}.receipt.json`);
      return {
        marker,
        receipt,
        result: runFlow(
          writeFlow(`${marker}.codex.md`),
          receipt,
          {
            MDFLOW_TEST_BARRIER_DIR: barrier,
            MDFLOW_TEST_MARKER: marker,
          },
        ),
      };
    });

    const deadline = Date.now() + 5_000;
    while (
      !flows.every((flow) =>
        existsSync(join(barrier, `ready-${flow.marker}`)),
      ) &&
      Date.now() < deadline
    ) {
      await Bun.sleep(10);
    }
    expect(
      flows.every((flow) =>
        existsSync(join(barrier, `ready-${flow.marker}`)),
      ),
    ).toBe(true);

    const receipts = flows.map((flow) => readReceipt(flow.receipt));
    expect(receipts[0]!.codexHome).not.toBe(receipts[1]!.codexHome);
    for (let i = 0; i < receipts.length; i++) {
      const own = flows[i]!.marker;
      const other = flows[1 - i]!.marker;
      expect(existsSync(receipts[i]!.codexHome)).toBe(true);
      expect(existsSync(join(receipts[i]!.codexHome, `marker-${own}`))).toBe(
        true,
      );
      expect(existsSync(join(receipts[i]!.codexHome, `marker-${other}`))).toBe(
        false,
      );
    }

    writeFileSync(join(barrier, "release"), "release");
    const results = await Promise.all(flows.map((flow) => flow.result));
    expect(results.every((result) => result.exitCode === 0)).toBe(true);
    expect(receipts.every((receipt) => !existsSync(receipt.codexHome))).toBe(
      true,
    );
  });

  it("makes exec isolation flags and project-doc suppression authoritative", async () => {
    const receipt = join(root, "hostile-args.receipt.json");
    const result = await runFlow(
      writeFlow(
        "hostile-args.codex.md",
        "ignore-user-config: false\nephemeral: false\nskip-git-repo-check: false\nconfig:\n  - project_doc_max_bytes=999",
      ),
      receipt,
    );
    expect(result.exitCode).toBe(0);
    const args = readReceipt(receipt).args;
    expect(args.filter((arg) => arg === "--ignore-user-config")).toHaveLength(1);
    expect(args.filter((arg) => arg === "--ephemeral")).toHaveLength(1);
    expect(args.filter((arg) => arg === "--skip-git-repo-check")).toHaveLength(1);
    expect(args).not.toContain("project_doc_max_bytes=999");
    expect(args.filter((arg) => arg === "project_doc_max_bytes=0")).toHaveLength(1);
  });

  it("removes every lower-layer hook-root config spelling before spawn", async () => {
    const receipt = join(root, "hostile-hooks.receipt.json");
    const result = await runFlow(
      writeFlow(
        "hostile-hooks.codex.md",
        [
          "config:",
          "  - 'hooks={Stop=[]}'",
          "  - ' hooks={Stop=[]}'",
          "  - 'hooks.SessionStart=[]'",
          "  - 'hooks.Stop=[]'",
          "  - 'hooks.state={}'",
          "  - '\"hooks\".SessionStart=[]'",
          "  - \"'hooks'.Stop=[]\"",
          "dangerously-bypass-hook-trust: true",
        ].join("\n"),
      ),
      receipt,
    );
    expect(result.exitCode).toBe(0);
    const args = readReceipt(receipt).args;
    expect(args.join("\n")).not.toMatch(/(^|\n)\s*hooks(?:\.|=)/);
    expect(args.join("\n")).not.toContain('"hooks".');
    expect(args.join("\n")).not.toContain("'hooks'.");
    expect(args).not.toContain("--dangerously-bypass-hook-trust");
  });

  it("runs a resident flow silently even when the project carries skills", async () => {
    // The flow lives in this project, so the project's skills are part of its
    // own contract and travel with every checkout — nothing to disclose.
    mkdirSync(join(root, ".codex", "skills", "probe"), { recursive: true });
    const receipt = join(root, "resident-skills.receipt.json");

    const result = await runFlow(
      writeFlow("resident-skills.i.codex.md"),
      receipt,
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(receipt)).toBe(true);
    expect(result.stderr).not.toContain("ISOLATION_REDUCED");
  });

  it("runs a visiting flow and discloses the project skills it inherited", async () => {
    // Regression: this used to abort the run. A global/PATH flow must stay
    // usable inside any repo that happens to carry a .codex, with the
    // reduction disclosed rather than silently accepted.
    mkdirSync(join(root, ".codex", "skills", "probe"), { recursive: true });
    const visitorHome = mkdtempSync(join(tmpdir(), "mdflow-visitor-"));
    const visitor = join(visitorHome, "visiting.i.codex.md");
    writeFileSync(
      visitor,
      "---\ndescription: isolation regression\n---\nSay ok.\n",
    );
    const receipt = join(root, "visiting-skills.receipt.json");

    const result = await runFlow(visitor, receipt);

    expect(result.exitCode).toBe(0);
    expect(existsSync(receipt)).toBe(true);
    expect(result.stderr).toContain("ISOLATION_REDUCED");
    expect(result.stderr).toContain(join(root, ".codex", "skills"));
    rmSync(visitorHome, { recursive: true, force: true });
  });

  it("does not warn about a project .codex that carries no skills", async () => {
    // A fresh CODEX_HOME suppresses project config.toml on codex 0.145.0, so
    // a config-only .codex is not a leak and must not produce noise.
    mkdirSync(join(root, ".codex"), { recursive: true });
    writeFileSync(join(root, ".codex", "config.toml"), 'model = "ignored"\n');
    const receipt = join(root, "config-only.receipt.json");

    const result = await runFlow(
      writeFlow("config-only.i.codex.md"),
      receipt,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("ISOLATION_REDUCED");
  });
});
