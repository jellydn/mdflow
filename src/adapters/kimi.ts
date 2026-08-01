/**
 * Moonshot Kimi Code CLI adapter (`kimi` — "The Starting Point for Next-Gen
 * Agents", kimi 0.26.0)
 *
 * Print mode: `-p/--prompt <prompt>` runs one prompt non-interactively and
 * prints the response. The body maps to `--prompt` via `$1` (value adjacent).
 * Verified empirically: `kimi --prompt "..."` exits 0 with the response on
 * stdout (kimi also prints a `To resume this session:` trailer line).
 *
 * Interactive mode: the bare positional prompt (`kimi "<body>"`) opens the
 * interactive TUI.
 *
 * Isolation: kimi exposes no clean ambient-context kill switch. `--skills-dir`
 * REDIRECTS skill discovery to a given directory (so a path could suppress
 * auto-discovered skills) but needs a real directory, and there is no flag to
 * disable MCP/providers/config. Rather than ship a partial/hacky isolation,
 * kimi runs ambient like droid/cursor-agent/agy — `getIsolationDefaults` is
 * omitted, so an explicit `_isolated: true` produces the standard
 * "no isolation controls" warning and the run proceeds unchanged.
 *
 * System prompt: kimi --help exposes no system-prompt flag, so there is no
 * `applySystemPrompt` — a flow that declares `_system-prompt` fails loudly
 * (a silently dropped system prompt would be a different flow), same as
 * copilot/opencode/droid.
 */

import type { ToolAdapter, CommandDefaults, AgentFrontmatter } from "../types";

export const kimiAdapter: ToolAdapter = {
  name: "kimi",

  getDefaults(): CommandDefaults {
    return {
      $1: "prompt", // Body → --prompt <body> (non-interactive)
    };
  },

  applyInteractiveMode(frontmatter: AgentFrontmatter): AgentFrontmatter {
    const result = { ...frontmatter };
    // Interactive is the bare positional prompt — drop the --prompt mapping.
    delete result.$1;
    return result;
  },
};

export default kimiAdapter;
