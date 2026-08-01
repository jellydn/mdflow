import { describe, it, expect } from "bun:test";
import { findManagedBlock, upsertManagedBlock } from "./managed-block";

const MARKERS = {
	start: "<!-- mdflow:test:start contract=1 -->",
	end: "<!-- mdflow:test:end -->",
};
const BLOCK = `${MARKERS.start}\nmanaged\n${MARKERS.end}`;

function ok(range: ReturnType<typeof findManagedBlock>): {
	start: number;
	end: number;
} {
	if (!range || "error" in range) throw new Error(`expected range: ${JSON.stringify(range)}`);
	return range;
}

describe("findManagedBlock strict scanner", () => {
	it("finds a live block and replaces exactly its bytes", () => {
		const source = `before\n\n${BLOCK}\n\nafter\n`;
		const range = ok(findManagedBlock(source, MARKERS));
		expect(source.slice(range.start, range.end)).toBe(BLOCK);
		const result = upsertManagedBlock(source, `${MARKERS.start}\nnew\n${MARKERS.end}`, MARKERS, (b) => b);
		expect(result.source).toBe(`before\n\n${MARKERS.start}\nnew\n${MARKERS.end}\n\nafter\n`);
	});

	it("treats markers inside a longer fence as content (```` wrapping ```)", () => {
		const source = [
			"````markdown",
			"```md",
			MARKERS.start,
			"user-authored example",
			MARKERS.end,
			"```",
			"````",
			"",
		].join("\n");
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("does not close a backtick fence with a tilde fence or vice versa", () => {
		const source = ["~~~", "```", MARKERS.start, MARKERS.end, "```", "~~~", ""].join("\n");
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("requires closing fences to be at least the opening length", () => {
		const source = ["`````", "```", MARKERS.start, MARKERS.end, "```", "`````", ""].join("\n");
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("ignores markers inside leading YAML frontmatter block scalars", () => {
		const source = [
			"---",
			"notes: |",
			`  documentation`,
			"---",
			"",
			"body",
			"",
		].join("\n").replace("  documentation", `  ${MARKERS.start}\n  docs\n  ${MARKERS.end}`);
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("frontmatter markers at column zero inside a block scalar are still frontmatter", () => {
		const source = ["---", "notes: |", MARKERS.start, MARKERS.end, "---", "real body", ""].join("\n");
		// Everything before the closing --- is frontmatter; no live markers.
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("fails closed on unterminated frontmatter", () => {
		const source = ["---", "never closes", MARKERS.start, MARKERS.end, ""].join("\n");
		const range = findManagedBlock(source, MARKERS);
		expect(range && "error" in range ? range.error : "").toContain("frontmatter");
	});

	it("ignores indented markers (indented code / nested content)", () => {
		const source = `    ${MARKERS.start}\n    ${MARKERS.end}\n`;
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("ignores markers inside <pre> containers", () => {
		const source = ["<pre>", MARKERS.start, MARKERS.end, "</pre>", ""].join("\n");
		expect(findManagedBlock(source, MARKERS)).toBeNull();
	});

	it("fails closed on an unclosed fence instead of appending inside it", () => {
		const source = "some text\n\n```\nunterminated fence\n";
		const range = findManagedBlock(source, MARKERS);
		expect(range && "error" in range ? range.error : "").toContain("unclosed code fence");
		const upsert = upsertManagedBlock(source, BLOCK, MARKERS, (b) => b);
		expect(upsert.source).toBeUndefined();
		expect(upsert.error).toContain("unclosed code fence");
	});

	it("fails closed on an unclosed <pre>", () => {
		const source = "<pre>\nexample\n";
		const range = findManagedBlock(source, MARKERS);
		expect(range && "error" in range ? range.error : "").toContain("<pre>");
	});

	it("handles CRLF sources", () => {
		const source = `intro\r\n${MARKERS.start}\r\nmanaged\r\n${MARKERS.end}\r\ntrailer\r\n`;
		const range = ok(findManagedBlock(source, MARKERS));
		expect(source.slice(range.start, range.start + MARKERS.start.length)).toBe(MARKERS.start);
		expect(source.slice(range.end - MARKERS.end.length, range.end)).toBe(MARKERS.end);
	});

	it("finds the live block even when a fenced example precedes it", () => {
		const source = [
			"```markdown",
			MARKERS.start,
			"example",
			MARKERS.end,
			"```",
			"",
			BLOCK,
			"",
		].join("\n");
		const range = ok(findManagedBlock(source, MARKERS));
		expect(source.slice(range.start, range.end)).toBe(BLOCK);
	});

	it("rejects duplicated live markers", () => {
		const source = `${BLOCK}\n\n${BLOCK}\n`;
		const range = findManagedBlock(source, MARKERS);
		expect(range && "error" in range ? range.error : "").toContain("exactly once");
	});

	it("rejects out-of-order markers", () => {
		const source = `${MARKERS.end}\n${MARKERS.start}\n`;
		const range = findManagedBlock(source, MARKERS);
		expect(range && "error" in range).toBe(true);
	});

	it("tolerates trailing whitespace on marker lines but not indentation", () => {
		const trailing = `${MARKERS.start}  \nmanaged\n${MARKERS.end}\t\n`;
		expect(findManagedBlock(trailing, MARKERS)).not.toBeNull();
		const indented = `  ${MARKERS.start}\nmanaged\n  ${MARKERS.end}\n`;
		expect(findManagedBlock(indented, MARKERS)).toBeNull();
	});
});
