import { describe, expect, it } from "bun:test";
import {
	AGENT_CONTRACT_VERSION,
	MANAGEMENT_COMMANDS,
	OPERATIONS,
	SAFETY_RULES,
	agentContractFacts,
	renderAgentContractMarkdown,
} from "./agent-contract";

describe("agent operations contract", () => {
	it("has unique command names and operation ids", () => {
		expect(
			new Set(MANAGEMENT_COMMANDS.map((command) => command.name)).size,
		).toBe(MANAGEMENT_COMMANDS.length);
		expect(new Set(OPERATIONS.map((operation) => operation.id)).size).toBe(
			OPERATIONS.length,
		);
	});

	it("fully describes every management command", () => {
		for (const command of MANAGEMENT_COMMANDS) {
			expect(command.name.length).toBeGreaterThan(0);
			expect(command.usage.length).toBeGreaterThan(0);
			expect(command.summary.length).toBeGreaterThan(0);
			expect(typeof command.json).toBe("boolean");
		}
	});

	it("makes consent and mutation effects explicit", () => {
		for (const operation of OPERATIONS) {
			if (operation.effect === "ENGINE") {
				expect(operation.consent).not.toBe("none");
			}
			if ("sourceMayChange" in operation && operation.sourceMayChange) {
				expect(
					operation.effect === "LOCAL_WRITE" ||
						operation.id === "project.init-guided",
				).toBe(true);
				expect(operation.consent).not.toBe("none");
			}
		}
	});

	it("matches runtime grammar and JSON capabilities", () => {
		const command = (name: string) =>
			MANAGEMENT_COMMANDS.find((item) => item.name === name);
		expect(command("render")).toMatchObject({ json: true });
		expect(command("render")?.usage).toContain("--out <path>");
		expect(command("feedback")?.json).toBe(true);
		expect(command("complain")?.json).toBe(true);
		expect(OPERATIONS.find((item) => item.id === "flow.run")?.consent).toBe(
			"caller-invoked",
		);
		expect(
			OPERATIONS.find((item) => item.id === "project.init-guided")?.consent,
		).toBe("interactive-only");
	});

	it("discloses import resolution and render side effects", () => {
		expect(OPERATIONS.find((item) => item.id === "flow.explain")).toMatchObject(
			{ network: true, executesLocalCode: true },
		);
		expect(OPERATIONS.find((item) => item.id === "render.write")).toMatchObject(
			{ effect: "LOCAL_WRITE", network: true },
		);
		expect(OPERATIONS.find((item) => item.id === "render.open")).toMatchObject({
			localProcess: true,
		});
	});

	it("keeps inspection and planning free", () => {
		const ids = [
			"project.inspect",
			"flow.explain",
			"eval.plan",
			"evolve.plan",
			"roster.inspect",
			"roster.check",
		];
		for (const id of ids) {
			expect(OPERATIONS.find((operation) => operation.id === id)?.effect).toBe(
				"FREE",
			);
		}
	});

	it("renders deterministic facts and security invariants", () => {
		expect(agentContractFacts().contractVersion).toBe(AGENT_CONTRACT_VERSION);
		expect(agentContractFacts()).toEqual(agentContractFacts());
		const markdown = renderAgentContractMarkdown();
		for (const rule of SAFETY_RULES) expect(markdown).toContain(rule.code);
		expect(markdown).toContain("md doctor --json");
	});
});
