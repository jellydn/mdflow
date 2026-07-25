/**
 * xAI Grok CLI adapter (`grok` — "Grok Build TUI", grok 0.2.103)
 *
 * Print mode: `-p/--single <PROMPT>` runs one headless turn, prints the
 * response to stdout, and exits. The body is mapped to `--single` via the
 * `$1` positional mapping (value adjacent to the flag — clap requires it;
 * verified empirically that `grok --single "hi"` works but a flag between
 * `--single` and its value errors "a value is required for '--single'").
 *
 * Interactive mode: the bare positional prompt (`grok "<body>"`) opens the
 * interactive TUI seeded with that first turn.
 *
 * Isolation (`_isolated: true`): `--no-memory` disables cross-session memory
 * for the run — the one ambient-context source with a verified CLI kill
 * switch. Limitations (no CLI flag): MCP servers and plugins are configured
 * via `~/.grok/config.toml` / `grok mcp` / `grok plugin` and still load.
 *
 * System prompt (verified against grok --help and a live ZORP test):
 *   replace → --system-prompt-override <PROMPT> (compat alias --system-prompt)
 *   append  → --rules <RULES> (extra rules appended to the system prompt)
 */

import type {
  ToolAdapter,
  CommandDefaults,
  AgentFrontmatter,
  SystemPromptSpec,
  SystemPromptTranslation,
} from "../types";

export const grokAdapter: ToolAdapter = {
  name: "grok",

  getDefaults(): CommandDefaults {
    return {
      $1: "single", // Body → --single <body> (headless single-turn)
    };
  },

  applyInteractiveMode(frontmatter: AgentFrontmatter): AgentFrontmatter {
    const result = { ...frontmatter };
    // Interactive is the bare positional prompt — drop the --single mapping.
    delete result.$1;
    return result;
  },

  getIsolationDefaults(): CommandDefaults {
    return {
      "no-memory": true,
    };
  },

  applySystemPrompt(spec: SystemPromptSpec): SystemPromptTranslation {
    const frontmatter: Record<string, string> = {};
    if (spec.replace !== undefined) {
      frontmatter["system-prompt-override"] = spec.replace;
    }
    if (spec.append && spec.append.length > 0) {
      // grok takes a single --rules value; join appended segments.
      frontmatter.rules = spec.append.join("\n\n");
    }
    return { frontmatter };
  },
};

export default grokAdapter;
