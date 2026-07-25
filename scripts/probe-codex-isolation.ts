#!/usr/bin/env bun

/**
 * Real interactive Codex isolation probe.
 *
 * Starts this checkout through a PTY, submits one fixed probe prompt so the
 * flow-owned SessionStart hook fires, then interrupts only that process group.
 * It never reads auth.json and reports only allowlisted, non-secret facts.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_ISOLATION_UNSET_ENV } from "../src/adapters/codex";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: bun run scripts/probe-codex-isolation.ts

Launch the installed Codex TUI through mdflow with a fake hostile user home.
The probe submits one fixed prompt solely to fire the flow-owned SessionStart
hook, captures a redacted runtime receipt, and interrupts only its own process
group. Set MDFLOW_REAL_CODEX=1 to acknowledge the real interactive launch.`);
  process.exit(0);
}

if (process.env.MDFLOW_REAL_CODEX !== "1") {
  console.error(
    "Set MDFLOW_REAL_CODEX=1 to acknowledge that this starts the real Codex TUI.",
  );
  process.exit(2);
}

const realCodex = Bun.which("codex");
if (!realCodex) {
  console.error("codex is not installed or not on PATH");
  process.exit(2);
}

const sourceCodexHome =
  process.env.CODEX_HOME && process.env.CODEX_HOME.trim() !== ""
    ? process.env.CODEX_HOME
    : join(process.env.HOME ?? "", ".codex");
const sourceAuth = join(sourceCodexHome, "auth.json");
if (!existsSync(sourceAuth)) {
  console.error("No source Codex auth.json exists; runtime probe cannot authenticate.");
  process.exit(2);
}

const root = mkdtempSync(join(tmpdir(), "mdflow-real-codex-probe-"));
const fakeHome = join(root, "home");
const ambientHome = join(root, "ambient-codex");
const project = join(root, "project");
const binDir = join(root, "bin");
const wrapperReceipt = join(root, "wrapper-receipt.json");
const transcriptRaw = join(root, "transcript.raw");
const transcriptText = join(root, "transcript.txt");
const ambientCanary = join(root, "ambient-hook-ran");
const userHomeCanary = join(root, "user-home-hook-ran");
const flowCanary = join(root, "flow-hook-ran");
const projectCanary = join(root, "project-hook-ran");
const unownedConfigCanary = join(root, "unowned-config-hook-ran");
const blockedWrapperReceipt = join(root, "blocked-wrapper-receipt.json");
const attackerHome = join(root, "attacker-home");
const flow = join(project, "probe.i.codex.md");
const hooks = join(project, "probe.i.codex.hooks.ts");
const hooklessFlow = join(project, "hookless.i.codex.md");
const hooklessWrapperReceipt = join(root, "hookless-wrapper-receipt.json");
const hooklessTranscriptRaw = join(root, "hookless-transcript.raw");
const hooklessTranscriptText = join(root, "hookless-transcript.txt");
const syntheticCredential = "MDFLOW_AUTH_VALUE_MUST_NOT_APPEAR";
const credentialEnvKeys = [...CODEX_ISOLATION_UNSET_ENV];
let preserve = true;

try {
  mkdirSync(fakeHome, { recursive: true });
  mkdirSync(ambientHome, { recursive: true });
  mkdirSync(join(fakeHome, ".codex"), { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(attackerHome, { recursive: true });
  mkdirSync(join(attackerHome, ".codex"), { recursive: true });
  await Bun.$`git -C ${project} init -q`;

  symlinkSync(realpathSync(sourceAuth), join(ambientHome, "auth.json"));
  writeFileSync(
    join(ambientHome, "config.toml"),
    [
      'model = "ambient-model-must-not-load"',
      "[mcp_servers.ambient_must_not_load]",
      'command = "/usr/bin/false"',
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(ambientHome, "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/touch ${ambientCanary}`,
              },
            ],
          },
        ],
      },
    }),
  );
  writeFileSync(
    join(fakeHome, ".codex", "config.toml"),
    'model = "user-home-model-must-not-load"\n',
  );
  writeFileSync(
    join(fakeHome, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/touch ${userHomeCanary}`,
              },
            ],
          },
        ],
      },
    }),
  );
  writeFileSync(
    join(attackerHome, ".codex", "config.toml"),
    'model = "actual-user-home-model-must-not-load"\n',
  );
  writeFileSync(
    join(attackerHome, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/touch ${userHomeCanary}`,
              },
            ],
          },
        ],
      },
    }),
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
    mkdirSync(join(ambientHome, name));
    writeFileSync(join(ambientHome, name, "sentinel"), name);
  }

  writeFileSync(
    flow,
    [
      "---",
      "description: real Codex isolation runtime probe",
      "engine: codex",
      "_interactive: true",
      "sandbox: workspace-write",
      "dangerously-bypass-hook-trust: true",
      "config:",
      "  - 'hooks={}'",
      `  - 'hooks.Stop=[{hooks=[{type="command",command="/usr/bin/touch ${unownedConfigCanary}"}]}]'`,
      "_env:",
      `  HOME: ${attackerHome}`,
      "---",
      "Reply with exactly MDFLOW_PROBE_OK and nothing else.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    hooklessFlow,
    [
      "---",
      "description: real Codex hookless dotted-hook exclusion probe",
      "engine: codex",
      "_interactive: true",
      "sandbox: workspace-write",
      "config:",
      `  - ' hooks.SessionStart=[{hooks=[{type="command",command="/usr/bin/touch ${unownedConfigCanary}"}]}]'`,
      "_env:",
      `  HOME: ${attackerHome}`,
      "---",
      "Reply with exactly MDFLOW_PROBE_OK and nothing else.",
      "",
    ].join("\n"),
  );
  writeFileSync(
    hooks,
    `#!/usr/bin/env bun
if (process.argv.includes("--mdflow-list-events")) {
  process.stdout.write(JSON.stringify(["sessionStart"]));
  process.exit(0);
}
try {
  const payload = JSON.parse(await Bun.stdin.text());
  if (payload?.hook_event_name === "SessionStart") {
    await Bun.write(${JSON.stringify(flowCanary)}, "flow-owned");
  }
} catch {}
`,
    { mode: 0o755 },
  );
  chmodSync(hooks, 0o755);

  const wrapper = join(binDir, "codex");
  writeFileSync(
    wrapper,
    `#!/usr/bin/env bun
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const home = process.env.CODEX_HOME ?? "";
const configPath = join(home, "config.toml");
const receiptPath = process.env.MDFLOW_PROBE_WRAPPER_RECEIPT!;
await Bun.write(receiptPath, JSON.stringify({
  realCodex: ${JSON.stringify(realCodex)},
  codexHome: home,
  cwd: process.cwd(),
  args: process.argv.slice(2),
  initialEntries: readdirSync(home).sort(),
  authIsSymlink: lstatSync(join(home, "auth.json")).isSymbolicLink(),
  configText: readFileSync(configPath, "utf8"),
  homeEnv: process.env.HOME,
  credentialEnvKeysPresent: ${JSON.stringify(credentialEnvKeys)}.filter(
    (key) => process.env[key] !== undefined
  ),
}));
const child = Bun.spawn([${JSON.stringify(realCodex)}, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
`,
    { mode: 0o755 },
  );
  chmodSync(wrapper, 0o755);

  const ptyHelper = join(root, "run_pty.py");
  writeFileSync(
    ptyHelper,
    `import fcntl, os, pty, re, select, signal, struct, subprocess, sys, termios, time
cwd, transcript, flow_canary, *cmd = sys.argv[1:]
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 120, 0, 0))
os.set_blocking(master, False)
p = subprocess.Popen(cmd, cwd=cwd, stdin=slave, stdout=slave, stderr=slave,
                     env=os.environ.copy(), start_new_session=True, close_fds=True)
os.close(slave)
data = bytearray(); scan = bytearray(); ready = False; deadline = time.time() + 25
responses = [
 (b"\\x1b[6n", b"\\x1b[1;1R"),
 (b"\\x1b]10;?\\x1b\\\\", b"\\x1b]10;rgb:ffff/ffff/ffff\\x1b\\\\"),
 (b"\\x1b]11;?\\x1b\\\\", b"\\x1b]11;rgb:0000/0000/0000\\x1b\\\\"),
 (b"\\x1b[?u", b"\\x1b[?0u"),
 (b"\\x1b[c", b"\\x1b[?1;2c"),
]
def pump(timeout):
  global ready
  r,_,_ = select.select([master], [], [], timeout)
  if not r: return True
  try: chunk = os.read(master, 65536)
  except (OSError, BlockingIOError): return False
  if not chunk: return False
  data.extend(chunk); scan.extend(chunk)
  for pattern, reply in responses:
    if pattern in scan:
      try: os.write(master, reply)
      except OSError: pass
  if b"OpenAI Codex" in data and os.path.exists(flow_canary): ready = True
  if len(scan) > 4096: del scan[:-4096]
  return True
while time.time() < deadline and p.poll() is None and not ready:
  if not pump(.1): break
if ready: time.sleep(.4)
try: os.write(master, b"\\x03\\x03")
except OSError: pass
end = time.time() + 5
while time.time() < end and p.poll() is None: pump(.1)
if p.poll() is None: os.killpg(p.pid, signal.SIGTERM)
try: p.wait(timeout=4)
except subprocess.TimeoutExpired:
  os.killpg(p.pid, signal.SIGKILL); p.wait(timeout=4)
end = time.time() + .5
while time.time() < end and pump(0): pass
os.close(master)
open(transcript, "wb").write(data)
print("ready=" + ("true" if ready else "false") + " exit=" + str(p.returncode))
`,
  );

  const env = {
    ...process.env,
    ...Object.fromEntries(
      credentialEnvKeys.map((key) => [key, syntheticCredential]),
    ),
    HOME: fakeHome,
    CODEX_HOME: ambientHome,
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
    MDFLOW_EVAL_RUN: "1",
    MDFLOW_ASSUME_TTY: "1",
    MDFLOW_PROBE_WRAPPER_RECEIPT: wrapperReceipt,
    NO_COLOR: "1",
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  const pty = Bun.spawn(
    [
      "python3",
      ptyHelper,
      project,
      transcriptRaw,
      flowCanary,
      "bun",
      "run",
      join(import.meta.dir, "..", "src", "index.ts"),
      flow,
      "--_no-menu",
    ],
    { cwd: project, env, stdout: "pipe", stderr: "pipe" },
  );
  const [ptyStdout, ptyStderr, ptyExit] = await Promise.all([
    new Response(pty.stdout).text(),
    new Response(pty.stderr).text(),
    pty.exited,
  ]);

  const normalizeTranscript = (path: string): string => readFileSync(path)
    .toString("utf8")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP.*?\x1b\\/gs, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "");
  const normalized = normalizeTranscript(transcriptRaw);
  writeFileSync(transcriptText, normalized);
  const wrapperData = existsSync(wrapperReceipt)
    ? JSON.parse(readFileSync(wrapperReceipt, "utf8"))
    : undefined;

  const hooklessPty = Bun.spawn(
    [
      "python3",
      ptyHelper,
      project,
      hooklessTranscriptRaw,
      hooklessWrapperReceipt,
      "bun",
      "run",
      join(import.meta.dir, "..", "src", "index.ts"),
      hooklessFlow,
      "--_no-menu",
    ],
    {
      cwd: project,
      env: {
        ...env,
        MDFLOW_PROBE_WRAPPER_RECEIPT: hooklessWrapperReceipt,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [hooklessPtyStdout, hooklessPtyStderr, hooklessPtyExit] =
    await Promise.all([
      new Response(hooklessPty.stdout).text(),
      new Response(hooklessPty.stderr).text(),
      hooklessPty.exited,
    ]);
  const hooklessNormalized = normalizeTranscript(hooklessTranscriptRaw);
  writeFileSync(hooklessTranscriptText, hooklessNormalized);
  const hooklessWrapperData = existsSync(hooklessWrapperReceipt)
    ? JSON.parse(readFileSync(hooklessWrapperReceipt, "utf8"))
    : undefined;

  // Codex prints a non-interactive disclosure when mdflow supplies the
  // invocation-wide bypass. It states that validated hooks run *without*
  // review; it is not a review/accept prompt and must not satisfy the prompt
  // detector below.
  const stripBypassDisclosure = (text: string): string => text.replace(
    /⚠\s*`--dangerously-bypass-hook-trust`[^\n]*invocation\./gi,
    "",
  );
  const promptScanText = [
    stripBypassDisclosure(normalized),
    stripBypassDisclosure(hooklessNormalized),
  ].join("\n");
  const forbidden = [
    /hooks need review/i,
    /review hooks/i,
    /trust this directory/i,
    /trust all and continue/i,
    /continue without trusting/i,
    /(review|accept|approve|trust|untrusted)[^\n]{0,100}hook/i,
    /hook[^\n]{0,100}(review|accept|approve|trust|untrusted)/i,
    /ambient-model-must-not-load/i,
    /ambient_must_not_load/i,
    /user-home-model-must-not-load/i,
    /actual-user-home-model-must-not-load/i,
  ].filter((pattern) => pattern.test(promptScanText)).map(String);
  const homeRemoved =
    typeof wrapperData?.codexHome === "string" &&
    !existsSync(wrapperData.codexHome);
  const hooklessHomeRemoved =
    typeof hooklessWrapperData?.codexHome === "string" &&
    !existsSync(hooklessWrapperData.codexHome);
  const canonicalProject = realpathSync(project);
  const escapedProject = canonicalProject
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  const expectedTrustConfig =
    `[projects."${escapedProject}"]\ntrust_level = "trusted"\n`;
  const configValues = (args: unknown): string[] => {
    if (!Array.isArray(args)) return [];
    const values: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-c" || arg === "--config") {
        if (typeof args[i + 1] === "string") values.push(args[++i]);
      } else if (
        typeof arg === "string" &&
        (arg.startsWith("-c=") || arg.startsWith("--config="))
      ) {
        values.push(arg.slice(arg.indexOf("=") + 1));
      }
    }
    return values;
  };
  const isHookRootConfig = (value: string): boolean => {
    const separator = value.indexOf("=");
    if (separator < 0) return false;
    return value.slice(0, separator).trim().split(".", 1)[0]?.trim() === "hooks";
  };
  const hookConfigs = configValues(wrapperData?.args).filter(isHookRootConfig);
  const hooklessHookConfigs = configValues(
    hooklessWrapperData?.args,
  ).filter(isHookRootConfig);
  const bypassCount = Array.isArray(wrapperData?.args)
    ? wrapperData.args.filter(
        (arg: unknown) => arg === "--dangerously-bypass-hook-trust",
      ).length
    : 0;
  const hooklessBypassCount = Array.isArray(hooklessWrapperData?.args)
    ? hooklessWrapperData.args.filter(
        (arg: unknown) => arg === "--dangerously-bypass-hook-trust",
      ).length
    : 0;
  const inspectedRuntimeSurfaces = JSON.stringify({
    args: wrapperData?.args,
    configText: wrapperData?.configText,
    hooklessArgs: hooklessWrapperData?.args,
    hooklessConfigText: hooklessWrapperData?.configText,
  });
  const ambientPathsAbsent =
    !inspectedRuntimeSurfaces.includes(ambientHome) &&
    !inspectedRuntimeSurfaces.includes(join(fakeHome, ".codex")) &&
    !inspectedRuntimeSurfaces.includes(join(attackerHome, ".codex"));

  // A repository-local .codex surface must fail before the wrapper can exec
  // the real binary or any project hook can run.
  mkdirSync(join(project, ".codex"));
  writeFileSync(
    join(project, ".codex", "hooks.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: `/usr/bin/touch ${projectCanary}`,
              },
            ],
          },
        ],
      },
    }),
  );
  const blocked = Bun.spawn(
    [
      "bun",
      "run",
      join(import.meta.dir, "..", "src", "index.ts"),
      flow,
      "--_no-menu",
    ],
    {
      cwd: project,
      env: {
        ...env,
        MDFLOW_PROBE_WRAPPER_RECEIPT: blockedWrapperReceipt,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [blockedStdout, blockedStderr, blockedExit] = await Promise.all([
    new Response(blocked.stdout).text(),
    new Response(blocked.stderr).text(),
    blocked.exited,
  ]);
  const projectConfigFailClosed =
    blockedExit !== 0 &&
    !existsSync(blockedWrapperReceipt) &&
    !existsSync(projectCanary) &&
    blockedStderr.includes(
      "Codex isolation preparation failed; no engine process was started.",
    );

  const scanFiles = (path: string): string[] => {
    if (!existsSync(path)) return [];
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [];
    if (stat.isFile()) return [path];
    if (!stat.isDirectory()) return [];
    return readdirSync(path).flatMap((name) => scanFiles(join(path, name)));
  };
  const authValueObserved = scanFiles(root).some((path) => {
    try {
      return readFileSync(path).includes(Buffer.from(syntheticCredential));
    } catch {
      return false;
    }
  });
  const freshHome =
    wrapperData?.codexHome?.includes(
      join(".mdflow", "runtime", "codex", "run-"),
    ) ?? false;
  const hooklessFreshHome =
    hooklessWrapperData?.codexHome?.includes(
      join(".mdflow", "runtime", "codex", "run-"),
    ) ?? false;
  const blockedOutputRedacted =
    !blockedStdout.includes(syntheticCredential) &&
    !blockedStderr.includes(syntheticCredential);
  const ptyOutputRedacted =
    !ptyStdout.includes(syntheticCredential) &&
    !ptyStderr.includes(syntheticCredential) &&
    !normalized.includes(syntheticCredential);
  const hooklessOutputRedacted =
    !hooklessPtyStdout.includes(syntheticCredential) &&
    !hooklessPtyStderr.includes(syntheticCredential) &&
    !hooklessNormalized.includes(syntheticCredential);

  const receipt = {
    verdict:
      ptyExit === 0 &&
      ptyStdout.includes("ready=true") &&
      freshHome &&
      wrapperData?.realCodex === realCodex &&
      wrapperData?.authIsSymlink === true &&
      Array.isArray(wrapperData?.initialEntries) &&
      wrapperData.initialEntries.join(",") === "auth.json,config.toml" &&
      wrapperData?.configText === expectedTrustConfig &&
      wrapperData?.homeEnv === attackerHome &&
      Array.isArray(wrapperData?.credentialEnvKeysPresent) &&
      wrapperData.credentialEnvKeysPresent.length === 0 &&
      hookConfigs.length === 1 &&
      typeof hookConfigs[0] === "string" &&
      hookConfigs[0].includes(hooks) &&
      bypassCount === 1 &&
      ambientPathsAbsent &&
      existsSync(flowCanary) &&
      !existsSync(ambientCanary) &&
      !existsSync(userHomeCanary) &&
      !existsSync(unownedConfigCanary) &&
      !existsSync(projectCanary) &&
      hooklessPtyExit === 0 &&
      hooklessPtyStdout.includes("ready=true") &&
      hooklessFreshHome &&
      hooklessWrapperData?.realCodex === realCodex &&
      hooklessWrapperData?.authIsSymlink === true &&
      Array.isArray(hooklessWrapperData?.initialEntries) &&
      hooklessWrapperData.initialEntries.join(",") === "auth.json,config.toml" &&
      hooklessWrapperData?.configText === expectedTrustConfig &&
      hooklessWrapperData?.homeEnv === attackerHome &&
      Array.isArray(hooklessWrapperData?.credentialEnvKeysPresent) &&
      hooklessWrapperData.credentialEnvKeysPresent.length === 0 &&
      hooklessHookConfigs.length === 0 &&
      hooklessBypassCount === 0 &&
      forbidden.length === 0 &&
      projectConfigFailClosed &&
      blockedOutputRedacted &&
      ptyOutputRedacted &&
      hooklessOutputRedacted &&
      !authValueObserved &&
      homeRemoved &&
      hooklessHomeRemoved
        ? "PASS"
        : "FAIL",
    codexVersion: (await Bun.$`${realCodex} --version`.text()).trim(),
    wrapperExecVerified: wrapperData?.realCodex === realCodex,
    freshHome,
    initialEntries: wrapperData?.initialEntries ?? [],
    generatedTrustBlock:
      wrapperData?.configText === expectedTrustConfig,
    flowHookRan: existsSync(flowCanary),
    ambientHookRan: existsSync(ambientCanary),
    userHomeHookRan: existsSync(userHomeCanary),
    projectHookRan: existsSync(projectCanary),
    unownedConfigHookRan: existsSync(unownedConfigCanary),
    hookConfigsOwned: hookConfigs.length === 1 && bypassCount === 1,
    hooklessDottedHookExcluded:
      hooklessHookConfigs.length === 0 &&
      hooklessBypassCount === 0 &&
      !existsSync(unownedConfigCanary),
    ambientPathsAbsent,
    credentialEnvKeysPresent: wrapperData?.credentialEnvKeysPresent ?? [],
    projectConfigFailClosed,
    blockedExit,
    blockedOutputRedacted,
    ptyOutputRedacted,
    hooklessOutputRedacted,
    authValueObserved,
    hookReviewPromptMatches: forbidden,
    tuiReady: ptyStdout.includes("ready=true"),
    homeRemoved,
    hooklessFreshHome,
    hooklessHomeRemoved,
    ptyExit,
    ptyStderrEmpty: ptyStderr.trim() === "",
    hooklessPtyExit,
    hooklessPtyStderrEmpty: hooklessPtyStderr.trim() === "",
  };
  console.log(JSON.stringify(receipt, null, 2));
  preserve = receipt.verdict !== "PASS";
  if (receipt.verdict !== "PASS") {
    console.error(`Probe evidence preserved at ${root}`);
    process.exitCode = 1;
  }
} finally {
  if (!preserve) rmSync(root, { recursive: true, force: true });
}
