/**
 * Terminal-size hook for @inquirer/core prompts.
 *
 * Inquirer only re-renders on state changes, so a prompt that reads
 * `process.stdout.columns` directly stays frozen at its launch layout when
 * the terminal (or a pane holding it) is resized. This hook subscribes to
 * the stream's `resize` event and re-renders with fresh dimensions.
 *
 * On resize the previous frame has already been re-wrapped by the terminal,
 * so inquirer's ScreenManager erase count (recorded at the old width) no
 * longer matches what is on screen. The screen is cleared before the
 * re-render — the only way to avoid stale wrapped-line artifacts.
 */

import { useEffect, useState } from "@inquirer/core";

/** The slice of a TTY WriteStream the hook needs; injectable for tests. */
export interface TerminalSizeStream {
	columns?: number;
	rows?: number;
	on(event: "resize", listener: () => void): unknown;
	off(event: "resize", listener: () => void): unknown;
	write(chunk: string): unknown;
}

export interface TerminalSize {
	columns: number | undefined;
	rows: number | undefined;
}

/** Clear the visible screen and home the cursor (scrollback preserved). */
export const CLEAR_SCREEN = "\u001b[2J\u001b[H";

export function useTerminalSize(
	stream: TerminalSizeStream = process.stdout,
): TerminalSize {
	const [size, setSize] = useState<TerminalSize>({
		columns: stream.columns,
		rows: stream.rows,
	});
	useEffect(() => {
		const onResize = () => {
			stream.write(CLEAR_SCREEN);
			setSize({ columns: stream.columns, rows: stream.rows });
		};
		stream.on("resize", onResize);
		return () => {
			stream.off("resize", onResize);
		};
	}, [stream]);
	return size;
}
