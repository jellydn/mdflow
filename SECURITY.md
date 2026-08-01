# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through this repository's
[GitHub Security Advisories](https://github.com/johnlindquist/mdflow/security/advisories/new).
Do not open a public issue with exploit details. Include the affected version,
reproduction steps, impact, and any suggested mitigation. You should receive an
acknowledgement within seven days.

Security fixes target the current major release. Older majors may receive a
fix when the change is practical, but they are not guaranteed support.

## Execution model

mdflow intentionally launches local agent CLIs and can evaluate inline shell
commands, executable code fences, executable `.hooks.ts` and `.eval.ts`
sidecars, file imports, URL imports, and context providers declared by a
flow. Treat a flow like code:

- Review untrusted flow files before running them.
- Eval and hook sidecars are executable local TypeScript; review them before
  running the flow. Registry install downloads one flow, never its sidecars,
  and registry provenance is re-verified at run time.
- Remote flows require trust-on-first-use approval before imports are expanded.
- `--_dry-run` does not launch the engine, inline `!command` imports, or
  executable code fences. It still resolves file, URL, and context-provider
  imports, so it is an inspection aid rather than a security sandbox.
- Engine context isolation strips supported ambient agent configuration. It
  does not isolate the host filesystem, network, environment, credentials, or
  child processes.
- Use `--_trust` only in automation where the remote source is already
  authenticated and pinned by your own controls.
- Consent boundaries are separate and non-transferable: a flow run, an eval
  run, an evolution proposal, and a source-mutating apply each require their
  own consent. Evolution never rewrites a flow without an explicit
  `md evolve apply <run-id>`; `evolve: auto` queues proposal-only work.
- mdflow refuses non-regular config files and contains managed writes and
  symlinks within the project; managed guidance blocks fail closed.

When running third-party flows in CI, prefer a disposable runner with
least-privilege credentials and restricted network access.
