import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import {
	createPrompt,
	isEnterKey,
	useKeypress,
	type KeypressEvent,
} from "@inquirer/core";
import { CLEAR_SCREEN, useTerminalSize } from "./use-terminal-size";

/** Minimal prompt that renders nothing but the size it observes. */
const sizePrompt = createPrompt<string, { terminal: PassThrough }>(
	(config, done) => {
		const size = useTerminalSize(
			config.terminal as unknown as NodeJS.WriteStream,
		);
		useKeypress((key: KeypressEvent) => {
			if (isEnterKey(key)) done("done");
		});
		return `size ${size.columns ?? "?"}x${size.rows ?? "?"}`;
	},
);

function harness(columns = 100, rows = 30) {
	const input = Object.assign(new PassThrough(), {
		isTTY: true,
		setRawMode: () => input,
	});
	const output = Object.assign(new PassThrough(), {
		isTTY: true,
		columns,
		rows,
	});
	let transcript = "";
	let checkpoint = 0;
	output.on("data", (chunk) => {
		transcript += chunk.toString();
	});
	const pending = sizePrompt({ terminal: output }, { input, output });
	return {
		input,
		output,
		pending,
		takeOutput() {
			const next = transcript.slice(checkpoint);
			checkpoint = transcript.length;
			return next;
		},
		async finish() {
			input.emit("keypress", "", { name: "enter", ctrl: false });
			return pending;
		},
	};
}

describe("useTerminalSize", () => {
	test("re-renders with fresh dimensions when the terminal resizes", async () => {
		const prompt = harness(100, 30);
		await Bun.sleep(0);
		expect(prompt.takeOutput()).toContain("size 100x30");

		prompt.output.columns = 72;
		prompt.output.rows = 20;
		prompt.output.emit("resize");
		await Bun.sleep(0);
		const frame = prompt.takeOutput();
		expect(frame).toContain("size 72x20");
		expect(await prompt.finish()).toBe("done");
	});

	test("clears the screen before redrawing so shrink leaves no stale wrapped lines", async () => {
		const prompt = harness(100, 30);
		await Bun.sleep(0);
		prompt.takeOutput();

		prompt.output.columns = 60;
		prompt.output.emit("resize");
		await Bun.sleep(0);
		const frame = prompt.takeOutput();
		// The clear must land before the redraw of the new frame.
		expect(frame.indexOf(CLEAR_SCREEN)).toBeGreaterThanOrEqual(0);
		expect(frame.indexOf(CLEAR_SCREEN)).toBeLessThan(frame.indexOf("size 60x30"));
		await prompt.finish();
	});

	test("removes the resize listener when the prompt finishes", async () => {
		const prompt = harness();
		await Bun.sleep(0);
		expect(prompt.output.listenerCount("resize")).toBe(1);
		await prompt.finish();
		expect(prompt.output.listenerCount("resize")).toBe(0);
	});
});
