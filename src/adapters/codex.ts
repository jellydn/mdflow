/**
 * OpenAI Codex CLI adapter
 *
 * Print mode: Use 'exec' subcommand for non-interactive execution
 * Interactive mode: Remove subcommand (interactive is the default)
 *
 * Isolation (`_isolated: true`): every spawn gets a fresh CODEX_HOME with
 * auth + workspace trust but no ambient config/hooks/plugins. In exec mode,
 * these additional keys were verified against codex exec --help and the
 * config schema (wrong-typed values fail config load):
 *   --ignore-user-config        don't load ~/.codex/config.toml (drops user
 *                               MCP servers/profiles; auth still works)
 *   --ephemeral                 no session persistence
 *   --config project_doc_max_bytes=0   disables AGENTS.md ingestion
 * --ignore-user-config and --ephemeral exist ONLY under `codex exec`, so
 * interactive mode strips them and keeps only the -c override.
 *
 * System prompt (verified config keys):
 *   replace → model_instructions_file=<temp file>
 *   append  → developer_instructions=<text>
 * Values pass through -c/--config; non-TOML strings are used as literals by
 * codex, so no extra quoting is needed.
 */

import type {
  ToolAdapter,
  CommandDefaults,
  AgentFrontmatter,
  SystemPromptSpec,
  SystemPromptTranslation,
  HooksSpec,
  HooksTranslation,
} from "../types";
import {
  buildCodexHooksConfig,
  buildCodexHooksOverride,
  type CanonicalHookEvent,
} from "../hooks";
import {
  applyProjectSurfacePolicy,
  classifyFlowProvenance,
  createCodexRunHome,
  previewCodexRunHome,
} from "./codex-hooks-home";
import { CommandError } from "../errors";

/** Flags that only exist on `codex exec`, not top-level codex. */
const EXEC_ONLY_ISOLATION_FLAGS = [
  "ignore-user-config",
  "ephemeral",
  "skip-git-repo-check",
] as const;

export const CODEX_ISOLATION_UNSET_ENV = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "CODEX_CONNECTORS_TOKEN",
  "CODEX_GITHUB_TOKEN",
  "CODEX_GITHUB_PERSONAL_ACCESS_TOKEN",
  "CODEX_REMOTE_AUTH_TOKEN",
  "OPENAI_BASE_URL",
  "CODEX_API_BASE_URL",
  "CODEX_URL",
  "CODEX_AUTHAPI_BASE_URL",
  "CODEX_CLOUD_TASKS_BASE_URL",
  "CODEX_EXEC_SERVER_URL",
  "CODEX_EXEC_SERVER_NOISE_AUTH_TOKEN",
  "CODEX_EXEC_SERVER_NOISE_REGISTRY_URL",
  "CODEX_OSS_BASE_URL",
  "CODEX_OSS_PORT",
  "CODEX_REFRESH_TOKEN_URL_OVERRIDE",
  "CODEX_REVOKE_TOKEN_URL_OVERRIDE",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
] as const;

function removeFlag(
  args: string[],
  name: string,
  consumeBooleanValue = false,
): string[] {
  const long = `--${name}`;
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === long) {
      if (
        consumeBooleanValue &&
        (args[i + 1] === "true" || args[i + 1] === "false")
      ) {
        i++;
      }
      continue;
    }
    if (arg.startsWith(`${long}=`)) continue;
    result.push(arg);
  }
  return result;
}

function removeConfigKeys(args: string[], keys: Set<string>): string[] {
  const isOwnedKey = (value: string): boolean => {
    const separator = value.indexOf("=");
    if (separator < 0) return false;
    const key = value.slice(0, separator).trim();
    const rawRoot = key.split(".", 1)[0]?.trim();
    const root =
      rawRoot &&
      ((rawRoot.startsWith('"') && rawRoot.endsWith('"')) ||
        (rawRoot.startsWith("'") && rawRoot.endsWith("'")))
        ? rawRoot.slice(1, -1).trim()
        : rawRoot;
    return root !== undefined && keys.has(root);
  };

  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-c" || arg === "--config") {
      const value = args[i + 1];
      if (value !== undefined && isOwnedKey(value)) {
        i++;
        continue;
      }
      result.push(arg);
      continue;
    }
    if (arg.startsWith("-c=") || arg.startsWith("--config=")) {
      const value = arg.slice(arg.indexOf("=") + 1);
      if (isOwnedKey(value)) continue;
    }
    result.push(arg);
  }
  return result;
}

export const codexAdapter: ToolAdapter = {
  name: "codex",

  getDefaults(): CommandDefaults {
    return {
      _subcommand: "exec", // Use 'exec' subcommand for non-interactive mode
    };
  },

  applyInteractiveMode(frontmatter: AgentFrontmatter): AgentFrontmatter {
    const result = { ...frontmatter };
    // Remove _subcommand (interactive is default without exec subcommand)
    delete result._subcommand;
    // These isolation flags are exec-only; top-level codex rejects them.
    for (const flag of EXEC_ONLY_ISOLATION_FLAGS) {
      delete result[flag];
    }
    return result;
  },

  getIsolationDefaults(): CommandDefaults {
    return {
      "ignore-user-config": true,
      ephemeral: true,
      // --ignore-user-config also drops the `[projects]` trust table, so
      // without this flag an isolated exec run REFUSES to start anywhere
      // outside a git repo ("Not inside a trusted directory and
      // --skip-git-repo-check was not specified"). The flag only skips the
      // repo gate — it does NOT mark the directory trusted, so sandbox and
      // approval defaults stay conservative. Verified on codex-cli 0.144.5;
      // exec-only (top-level codex rejects it).
      "skip-git-repo-check": true,
      config: ["project_doc_max_bytes=0"],
    };
  },

  prepareIsolationEnv(spec) {
    // Detection is read-only, so passive surfaces disclose the same reductions
    // a real run would — without preparing anything on disk.
    const provenance = classifyFlowProvenance(spec.flowPath, spec.cwd);
    if (spec.mode === "preview") {
      const preview = previewCodexRunHome();
      return {
        env: { CODEX_HOME: preview, HOME: preview },
        unsetEnv: [...CODEX_ISOLATION_UNSET_ENV],
        warnings: applyProjectSurfacePolicy(spec.cwd, provenance),
      };
    }
    const lease = createCodexRunHome({
      cwd: spec.cwd,
      interactive: spec.interactive,
      provenance,
    });
    return {
      env: lease.env,
      unsetEnv: [...CODEX_ISOLATION_UNSET_ENV],
      warnings: lease.warnings,
      onSpawn: lease.onSpawn,
      cleanup: lease.cleanup,
    };
  },

  finalizeIsolationArgs(args, spec): string[] {
    let result = [...args];
    for (const flag of EXEC_ONLY_ISOLATION_FLAGS) {
      result = removeFlag(result, flag);
    }
    result = removeConfigKeys(
      result,
      new Set(["hooks", "project_doc_max_bytes", "project_root_markers"]),
    );
    result = removeFlag(
      result,
      "dangerously-bypass-hook-trust",
      true,
    );
    if (!spec.interactive) {
      result.push(
        "--ignore-user-config",
        "--ephemeral",
        "--skip-git-repo-check",
      );
    }
    result.push(
      "--config",
      "project_doc_max_bytes=0",
      "--config",
      "project_root_markers=[]",
    );

    const owned = spec.ownedHookArgs ?? [];
    const ownedHookConfig =
      owned.length === 3 &&
      (owned[0] === "-c" || owned[0] === "--config") &&
      owned[1]?.startsWith("hooks=") &&
      owned[2] === "--dangerously-bypass-hook-trust"
        ? owned
        : [];
    result.push(...ownedHookConfig);
    return result;
  },

  /**
   * Hooks ride in as ONE inline `-c hooks={…}` override plus
   * `--dangerously-bypass-hook-trust` (top-level flag, valid in exec AND
   * interactive). Verified on codex-cli 0.144.1: no hooks.json is needed
   * and the override survives --ignore-user-config/--ephemeral.
   *
   * The bypass flag is invocation-wide and hook sources AGGREGATE — against
   * the user's real `$CODEX_HOME` it would also un-gate ambient
   * not-yet-reviewed hooks from hooks.json (probe Q6). Hooked runs
   * therefore execute against a fresh CODEX_HOME carrying auth + one
   * generated workspace-trust decision but NO ambient hooks. Installed Codex
   * builds that cannot disable repository-local `.codex` layers are rejected
   * before spawn, so the bypass cannot authorize a second hook source.
   * Hooks REQUIRE isolation: an `_isolated: false` flow keeps the real home
   * and must not run flow hooks.
   */
  applyHooks(spec: HooksSpec): HooksTranslation {
    if (!spec.isolated) {
      throw new CommandError(
        `Flow hooks on codex require isolation (the default). An ambient run ` +
          `(_isolated: false) would let the hook trust bypass authorize ` +
          `pending-review hooks from your real codex home. Remove ` +
          `\`_isolated: false\` or set \`_hooks: false\`.`,
        { errorCode: "HOOKS_REQUIRE_ISOLATION", context: { hooksFile: spec.hooksFile } }
      );
    }
    const config = buildCodexHooksConfig({
      hooksFile: spec.hooksFile,
      events: spec.events as CanonicalHookEvent[],
    });
    const hookOverride = buildCodexHooksOverride(config);
    return {
      frontmatter: {
        config: [hookOverride],
        "dangerously-bypass-hook-trust": true,
      },
      isolationOwnedArgs: [
        "--config",
        hookOverride,
        "--dangerously-bypass-hook-trust",
      ],
    };
  },

  applySystemPrompt(
    spec: SystemPromptSpec,
    writeTempFile: (content: string) => string
  ): SystemPromptTranslation {
    const configEntries: string[] = [];
    if (spec.replace !== undefined) {
      configEntries.push(`model_instructions_file=${writeTempFile(spec.replace)}`);
    }
    if (spec.append && spec.append.length > 0) {
      configEntries.push(`developer_instructions=${spec.append.join("\n\n")}`);
    }
    return { frontmatter: { config: configEntries } };
  },
};

export default codexAdapter;
