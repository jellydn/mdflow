/**
 * Last-resort interactive prompting for runs whose stdin is piped or already
 * consumed but which still have a controlling terminal (`md flow.md | tee`,
 * wrapper scripts that drained stdin, terminal multiplexers running the CLI
 * through a shell). Landing in a hard "missing variables" error while a human
 * is sitting at the terminal is the worst outcome, so these prompts go
 * directly to /dev/tty.
 *
 * Bun cannot register /dev/tty with its event loop (kqueue rejects the
 * character device on macOS — verified: `new tty.ReadStream(fd)` throws
 * EINVAL), so the channel deliberately uses BLOCKING reads: write the
 * question, readSync one line in the terminal's canonical mode. No raw mode,
 * no event loop, nothing to keep the process alive afterwards.
 */

import { closeSync, openSync, readSync, writeSync } from "node:fs";

export interface TtyPromptChannel {
	/** Print an informational line (no input read). */
	note(message: string): void;
	/** Ask one question, blocking until the user submits a line. */
	prompt(message: string, defaultValue?: string): string;
	close(): void;
}

/**
 * Open the controlling terminal for prompting, or return null when there is
 * none (true headless: cron, CI, detached agents) — callers fall back to a
 * fail-fast error. Windows has no /dev/tty; conhost prompting is not worth
 * the complexity for a fallback path.
 */
export function openTtyPromptChannel(): TtyPromptChannel | null {
	if (process.platform === "win32") return null;
	let fd: number;
	try {
		fd = openSync("/dev/tty", "r+");
	} catch {
		return null;
	}

	const write = (text: string) => {
		try {
			writeSync(fd, text);
		} catch {
			// Terminal went away mid-prompt; reads will return EOF next.
		}
	};

	return {
		note(message) {
			write(`${message}\n`);
		},
		prompt(message, defaultValue) {
			const hint = defaultValue ? ` \x1b[2m(${defaultValue})\x1b[0m` : "";
			write(`\x1b[36m?\x1b[0m ${message}${hint} `);
			const buf = Buffer.alloc(4096);
			let line = "";
			reading: while (true) {
				let bytes = 0;
				try {
					bytes = readSync(fd, buf, 0, buf.length, null);
				} catch {
					break;
				}
				if (bytes === 0) break; // EOF: terminal closed
				const chunk = buf.toString("utf8", 0, bytes);
				for (const ch of chunk) {
					if (ch === "\n" || ch === "\r") break reading;
					line += ch;
				}
			}
			const answer = line.trim();
			return answer || defaultValue?.trim() || "";
		},
		close() {
			try {
				closeSync(fd);
			} catch {}
		},
	};
}
