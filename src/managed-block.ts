/**
 * Marker-delimited managed blocks inside user-owned markdown files.
 *
 * mdflow owns exactly the bytes between one start/end marker pair and never
 * touches the user-authored text around it. The scanner is deliberately
 * strict about what counts as a LIVE marker so documentation ABOUT the
 * markers can never be mistaken for the managed block itself:
 *
 * - A live marker occupies the entire line at column zero (trailing
 *   whitespace only). Indented occurrences (including 4-space indented code
 *   blocks) are user content.
 * - Fenced code is tracked with CommonMark length rules: a fence closes only
 *   on the same character with at least the opening run length and nothing
 *   but the fence on the line. A ```-example inside a ````-fence therefore
 *   stays content.
 * - Leading YAML frontmatter and raw <pre> containers are user content.
 * - Ambiguous structure fails CLOSED: an unclosed fence or unterminated
 *   frontmatter makes the file report an error instead of risking a write
 *   through a misparse.
 */

export interface ManagedMarkers {
	start: string;
	end: string;
}

export type ManagedBlockRange =
	| { start: number; end: number }
	| { error: string }
	| null;

interface ScanLine {
	/** Line content without its EOL. */
	text: string;
	/** Byte offset of the line start in the source. */
	offset: number;
}

function scanLines(source: string): ScanLine[] {
	const lines: ScanLine[] = [];
	let offset = 0;
	for (const lineWithEol of source.match(/.*(?:\r?\n|$)/g) ?? []) {
		if (!lineWithEol) continue;
		lines.push({ text: lineWithEol.replace(/\r?\n$/, ""), offset });
		offset += lineWithEol.length;
	}
	return lines;
}

/** A live marker is the whole line at column zero; trailing spaces only. */
function isLiveMarker(text: string, marker: string): boolean {
	return text.replace(/[ \t]+$/, "") === marker;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Locate the single managed block in `source`. Returns null when no marker is
 * present, an error when markers are duplicated, unbalanced, out of order, or
 * when the surrounding Markdown structure is too ambiguous to trust.
 */
export function findManagedBlock(
	source: string,
	markers: ManagedMarkers,
): ManagedBlockRange {
	const lines = scanLines(source);
	const starts: number[] = [];
	const ends: number[] = [];

	let index = 0;

	// Leading YAML frontmatter is user content, not markdown structure.
	if (lines[0] && lines[0].text.replace(/[ \t]+$/, "") === "---") {
		let closed = false;
		for (index = 1; index < lines.length; index++) {
			const text = lines[index]!.text.replace(/[ \t]+$/, "");
			if (text === "---" || text === "...") {
				closed = true;
				index++;
				break;
			}
		}
		if (!closed)
			return {
				error:
					"managed markers cannot be verified: leading '---' never closes (unterminated frontmatter)",
			};
	}

	let fence: { char: string; length: number } | null = null;
	let preDepth = 0;

	for (; index < lines.length; index++) {
		const line = lines[index]!;
		const { text } = line;

		if (fence) {
			const close = text.match(FENCE_CLOSE);
			if (
				close?.[1] &&
				close[1][0] === fence.char &&
				close[1].length >= fence.length
			) {
				fence = null;
			}
			continue;
		}

		const open = text.match(FENCE_OPEN);
		if (open?.[1]) {
			fence = { char: open[1][0]!, length: open[1].length };
			continue;
		}

		// Raw HTML code containers hold user content even at column zero.
		const preOpens = (text.match(/<pre\b/gi) ?? []).length;
		const preCloses = (text.match(/<\/pre\s*>/gi) ?? []).length;
		if (preDepth > 0) {
			preDepth = Math.max(0, preDepth + preOpens - preCloses);
			continue;
		}
		if (preOpens > preCloses) {
			preDepth = preOpens - preCloses;
			continue;
		}

		if (isLiveMarker(text, markers.start)) starts.push(line.offset);
		else if (isLiveMarker(text, markers.end)) ends.push(line.offset);
	}

	if (fence)
		return {
			error:
				"managed markers cannot be verified: the file contains an unclosed code fence",
		};
	if (preDepth > 0)
		return {
			error:
				"managed markers cannot be verified: the file contains an unclosed <pre> block",
		};

	if (starts.length === 0 && ends.length === 0) return null;
	if (starts.length !== 1 || ends.length !== 1)
		return {
			error: "managed markers must appear exactly once outside code fences",
		};
	const start = starts[0];
	const endMarker = ends[0];
	if (start === undefined || endMarker === undefined)
		return { error: "managed marker offsets are unavailable" };
	const end = endMarker + markers.end.length;
	if (end <= start) return { error: "managed markers are out of order" };
	return { start, end };
}

export interface UpsertManagedBlockResult {
	source?: string;
	error?: string;
}

/**
 * Compute the desired file content: replace an existing managed block, append
 * one to a marker-free file, or create the file from `create(block)` when
 * `source` is null. Any scanner ambiguity is an error, never an append.
 */
export function upsertManagedBlock(
	source: string | null,
	block: string,
	markers: ManagedMarkers,
	create: (block: string) => string,
): UpsertManagedBlockResult {
	if (source === null) return { source: create(block) };
	const range = findManagedBlock(source, markers);
	if (range && "error" in range) return { error: range.error };
	if (range)
		return {
			source: `${source.slice(0, range.start)}${block}${source.slice(range.end)}`,
		};
	const separator = source.endsWith("\n") ? "\n" : "\n\n";
	return { source: `${source}${separator}${block}\n` };
}
