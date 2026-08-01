import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderAgentContractMarkdown } from "../src/agent-contract";

const CHECK = process.argv.includes("--check");
const ROOT = join(import.meta.dir, "..");
const SKILL_PATH = join(ROOT, "skills", "mdflow", "SKILL.md");
const START = "<!-- mdflow:agent-contract:start -->";
const END = "<!-- mdflow:agent-contract:end -->";

function generatedBlock(): string {
	return `${START}\n<!-- Generated from src/agent-contract.ts; do not edit this block by hand. -->\n\n${renderAgentContractMarkdown()}\n${END}`;
}

function updateManagedBlock(source: string): string {
	const start = source.indexOf(START);
	const end = source.indexOf(END);
	if (start === -1 || end === -1 || end < start) {
		throw new Error(
			`Missing or invalid agent-contract markers in ${SKILL_PATH}`,
		);
	}
	if (
		source.indexOf(START, start + START.length) !== -1 ||
		source.indexOf(END, end + END.length) !== -1
	) {
		throw new Error(`Duplicate agent-contract markers in ${SKILL_PATH}`);
	}
	return `${source.slice(0, start)}${generatedBlock()}${source.slice(end + END.length)}`;
}

const current = readFileSync(SKILL_PATH, "utf8");
const expected = updateManagedBlock(current);
if (current === expected) {
	console.log("Agent guidance is current.");
	process.exit(0);
}
if (CHECK) {
	console.error("Agent guidance is stale. Run `bun run guidance`.");
	process.exit(1);
}
writeFileSync(SKILL_PATH, expected);
console.log(`Updated ${SKILL_PATH}`);
