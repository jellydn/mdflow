import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

const activeGenerationSurfaces = [
	"assets/init/guide.md",
	"skills/mdflow/SKILL.md",
] as const;

function generatedAgentPrompts(): {
	setup: string;
	evals: string;
	migrate: string;
} {
	try {
		const facts = JSON.parse(
			readFileSync(join(root, "site/src/facts.json"), "utf8"),
		) as { agentPrompts?: unknown };
		if (!facts.agentPrompts || typeof facts.agentPrompts !== "object")
			throw new Error("agentPrompts missing");
		return facts.agentPrompts as {
			setup: string;
			evals: string;
			migrate: string;
		};
	} catch (error) {
		throw new Error(
			`Invalid generated agent prompts: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

describe("active flow-generation prompts", () => {
	for (const relativePath of activeGenerationSurfaces) {
		test(`${relativePath} enforces the interactive wait contract`, () => {
			const source = readFileSync(join(root, relativePath), "utf8");
			expect(source).toContain("_system-prompt");
			expect(source).toContain("_append-system-prompt");
			expect(source).toContain('_task: ""');
			expect(source).toContain("{{ _task }}");
			expect(source).toContain("User task:");
			expect(source).toMatch(
				/no positional prompt|no empty or placeholder positional prompt/,
			);
		});
	}

	test("both generated website prompts carry the interactive wait contract", () => {
		const prompts = generatedAgentPrompts();
		const source = `${prompts.setup}\n${prompts.migrate}`;
		expect(source.match(/_system-prompt/g)?.length).toBeGreaterThanOrEqual(2);
		expect(
			source.match(/_append-system-prompt/g)?.length,
		).toBeGreaterThanOrEqual(2);
		expect(source.match(/_task: ""/g)?.length).toBeGreaterThanOrEqual(2);
		expect(source.match(/\{\{ _task \}\}/g)?.length).toBeGreaterThanOrEqual(2);
	});

	test("active guidance teaches the agent operations contract", () => {
		const prompts = generatedAgentPrompts();
		const generated = `${prompts.setup}\n${prompts.evals}\n${prompts.migrate}`;
		expect(generated).toContain("md doctor --json");
		expect(generated).toContain("separately approve");
		expect(generated).toContain("executable local code");
		expect(generated).toContain("not a host sandbox");
		expect(generated).toContain("not trusted sidecars");
		expect(generated).toContain("Do not mass-rename Gemini flows");
	});
});
