/**
 * Tests for `md catalog --json` (Flow UX Protocol v1).
 *
 * Uses spawned CLI processes with HOME redirected into a temp directory so
 * project, global, and PATH sources are all fully controlled. PATH is pinned
 * to bun's own directory plus one fully controlled bin dir — never the real
 * system PATH — so scanning PATH-origin flows never picks up unrelated
 * flows installed on the host running these tests. A spy engine on that
 * bin dir records any invocation into a marker file so the FREE (no engine
 * call) contract is proven, not assumed.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { chmod, mkdir, writeFile } from "fs/promises";
import { existsSync, realpathSync } from "fs";
import { dirname, join } from "path";
import { spawnMd, createTempDir } from "./test-utils";

describe("md catalog --json", () => {
	let tempDir: string;
	let cleanup: () => Promise<void>;
	let projectDir: string;
	let homeDir: string;
	let binDir: string;
	let spyLog: string;
	let bunDir: string;

	const env = () => ({
		HOME: homeDir,
		MDFLOW_ENGINE: "",
		// Deliberately NOT the real process PATH: only bun's own directory (so
		// the spawned "bun run" can find its own executable) plus our fully
		// controlled bin dir. Using the real system PATH here would let this
		// test scan whatever global/PATH flows happen to exist on the machine
		// actually running the suite.
		PATH: `${bunDir}:${binDir}`,
		SPY_LOG: spyLog,
	});

	const parseCatalogJson = (stdout: string) => {
		try {
			return JSON.parse(stdout);
		} catch (error) {
			throw new Error(
				`Expected catalog JSON output: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	};

	const runCatalog = async (cwd = projectDir) => {
		const result = await spawnMd(["catalog", "--json"], { cwd, env: env() });
		expect(result.exitCode).toBe(0);
		return parseCatalogJson(result.stdout);
	};

	beforeAll(async () => {
		({ tempDir, cleanup } = await createTempDir("catalog-test-"));
		tempDir = realpathSync(tempDir);
		projectDir = join(tempDir, "project");
		homeDir = join(tempDir, "home");
		binDir = join(tempDir, "bin");
		spyLog = join(tempDir, "engine-was-called.log");

		const bunPath = Bun.which("bun");
		bunDir = dirname(bunPath ?? process.execPath);

		await mkdir(join(projectDir, "flows"), { recursive: true });
		await mkdir(join(homeDir, ".mdflow"), { recursive: true });
		await mkdir(binDir, { recursive: true });

		// Spy engine: any invocation leaves a marker file.
		const spyEnginePath = join(binDir, "spyeng");
		await writeFile(
			spyEnginePath,
			`#!/bin/sh\necho invoked >> "$SPY_LOG"\necho done\n`,
		);
		await chmod(spyEnginePath, 0o755);

		// Project flow: engine via frontmatter.
		await writeFile(
			join(projectDir, "flows", "review.md"),
			`---
description: Review changes
engine: echo
---
Review this.`,
		);

		// Project flow: engine via filename marker, resolved against the spy
		// engine on PATH. Used for the id-parity and FREE-contract assertions.
		await writeFile(join(projectDir, "flows", "task.spyeng.md"), "Say hi.");

		// Exclusions: eval/hooks sidecars, README, and a frontmatter-less doc.
		await writeFile(
			join(projectDir, "flows", "review.eval.md"),
			`---\nengine: echo\n---\nEval suite body`,
		);
		await writeFile(
			join(projectDir, "flows", "review.hooks.md"),
			`---\nengine: echo\n---\nHooks sidecar body`,
		);
		await writeFile(join(projectDir, "flows", "README.md"), "# Not a flow\n");
		await writeFile(
			join(projectDir, "flows", "notes.md"),
			"Just a document, no frontmatter.",
		);

		// Global flow (canonical ~/.mdflow/flows roster).
		await mkdir(join(homeDir, ".mdflow", "flows"), { recursive: true });
		await writeFile(
			join(homeDir, ".mdflow", "flows", "personal.md"),
			`---
description: Personal helper
engine: echo
---
hi`,
		);
	});

	afterAll(async () => {
		await cleanup();
	});

	it("exits 0 with empty flows and protocolVersion 1 when nothing exists", async () => {
		const emptyProject = join(tempDir, "empty-project");
		const emptyHome = join(tempDir, "empty-home");
		await mkdir(emptyProject, { recursive: true });
		await mkdir(emptyHome, { recursive: true });

		const result = await spawnMd(["catalog", "--json"], {
			cwd: emptyProject,
			env: { HOME: emptyHome, MDFLOW_ENGINE: "", PATH: `${bunDir}:${binDir}` },
		});

		expect(result.exitCode).toBe(0);
		const catalog = parseCatalogJson(result.stdout);
		expect(catalog.type).toBe("mdflow.catalog");
		expect(catalog.protocolVersion).toBe(1);
		expect(catalog.flows).toEqual([]);
		expect(catalog.counts).toEqual({
			project: 0,
			global: 0,
			path: 0,
			unavailable: 0,
		});
		expect(Array.isArray(catalog.warnings)).toBe(true);
	});

	it("emits the protocol shape with project and global flows, description, and engine", async () => {
		const catalog = await runCatalog();

		expect(catalog.type).toBe("mdflow.catalog");
		expect(catalog.protocolVersion).toBe(1);
		expect(typeof catalog.cwd).toBe("string");
		expect(typeof catalog.projectRoot).toBe("string");
		expect(Array.isArray(catalog.warnings)).toBe(true);

		const byName = Object.fromEntries(
			catalog.flows.map((flow: { name: string }) => [flow.name, flow]),
		);

		expect(byName["review.md"]).toMatchObject({
			description: "Review changes",
			engine: "echo",
			engineSource: "frontmatter",
			scope: "project",
			origin: "project-flows",
			provenance: "PROJECT",
			available: true,
			unavailableReason: null,
			registry: null,
		});
		expect(typeof byName["review.md"].frecency).toBe("number");
		expect(typeof byName["review.md"].path).toBe("string");

		expect(byName["personal.md"]).toMatchObject({
			description: "Personal helper",
			engine: "echo",
			engineSource: "frontmatter",
			scope: "global",
			origin: "global-flows",
			provenance: "GLOBAL",
			available: true,
			unavailableReason: null,
		});

		expect(byName["task.spyeng.md"]).toMatchObject({
			description: null,
			engine: "spyeng",
			engineSource: "filename",
		});
	});

	it("excludes *.eval.md, *.hooks.md, README.md, and frontmatter-less documents", async () => {
		const catalog = await runCatalog();
		const names = catalog.flows.map((flow: { name: string }) => flow.name);

		expect(names).not.toContain("review.eval.md");
		expect(names).not.toContain("review.hooks.md");
		expect(names).not.toContain("README.md");
		expect(names).not.toContain("notes.md");

		// Sanity: the surviving flows are exactly the runnable ones.
		expect(names.sort()).toEqual(
			["personal.md", "review.md", "task.spyeng.md"].sort(),
		);
	});

	it("computes ids that match `md explain <path> --json`.flowId byte-for-byte", async () => {
		const catalog = await runCatalog();
		const flowPath = catalog.flows.find(
			(flow: { name: string }) => flow.name === "task.spyeng.md",
		).path;

		const explainResult = await spawnMd(["explain", flowPath, "--json"], {
			cwd: projectDir,
			env: env(),
		});
		expect(explainResult.exitCode).toBe(0);
		const explainJson = parseCatalogJson(explainResult.stdout);

		const catalogFlow = catalog.flows.find(
			(flow: { name: string }) => flow.name === "task.spyeng.md",
		);
		expect(catalogFlow.id).toBe(explainJson.flowId);
		expect(catalogFlow.id).toBe("project:task.spyeng");
	});

	it("never invokes an engine (FREE contract)", async () => {
		await runCatalog();
		await runCatalog();
		expect(existsSync(spyLog)).toBe(false);
	});
});
