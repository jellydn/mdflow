/**
 * `md catalog --json` — machine-facing enumeration of the unified Flow
 * Workbench catalog (Flow UX Protocol v1).
 *
 * Unlike `md roster --json` (project + global + registry flows/*.md only),
 * `catalog` mirrors exactly what the interactive Workbench shows: project
 * flows, every globally installed flow, and runnable Markdown flows found
 * directly on PATH, each carrying its live availability state. It is built
 * on `discoverFlowCatalog` (src/flow-discovery.ts) so the two surfaces never
 * drift. Ids are computed with `flowIdForPath` (src/roster.ts) so a catalog
 * entry's `id` matches `md explain <path> --json`'s `flowId` byte-for-byte.
 *
 * FREE and read-only: discovery only reads frontmatter and lockfiles, never
 * invokes an engine. The enumeration always exits 0 — unreadable directories
 * or invalid lockfiles become `warnings`, never a failure.
 */

import type { FlowOrigin, FlowRegistryMetadata, FlowScope } from "./cli";
import { discoverFlowCatalog } from "./flow-discovery";
import { FLOW_UX_PROTOCOL_VERSION, flowIdForPath } from "./roster";

export interface CatalogFlow {
    id: string;
    name: string;
    path: string;
    description: string | null;
    engine: string;
    engineSource: string;
    scope: FlowScope;
    origin: FlowOrigin;
    provenance: string;
    frecency: number;
    available: boolean;
    unavailableReason: string | null;
    registry: FlowRegistryMetadata | null;
}

export interface CatalogJson {
    type: "mdflow.catalog";
    protocolVersion: number;
    cwd: string;
    projectRoot: string;
    flows: CatalogFlow[];
    counts: {
        project: number;
        global: number;
        path: number;
        unavailable: number;
    };
    warnings: string[];
}

/**
 * Build the `md catalog --json` payload. FREE — no engine call.
 *
 * Preserves `discoverFlowCatalog`'s ordering unchanged (ready flows by
 * frecency then scope/name, unavailable flows last).
 */
export async function buildCatalogJson(cwd: string): Promise<CatalogJson> {
    const catalog = await discoverFlowCatalog({ cwd });

    const flows: CatalogFlow[] = catalog.flows.map((flow) => ({
        id: flowIdForPath(flow.path, { cwd }),
        name: flow.name,
        path: flow.path,
        description: flow.description ?? null,
        engine: flow.engine ?? "",
        engineSource: flow.engineSource ?? "",
        scope: flow.scope ?? "project",
        origin: flow.origin ?? "project-flows",
        provenance: flow.provenanceLabel ?? "",
        frecency: flow.frecency ?? 0,
        available: flow.availability?.state === "ready",
        unavailableReason:
            flow.availability?.state === "unavailable"
                ? flow.availability.reason
                : null,
        registry: flow.registry ?? null,
    }));

    const warnings = catalog.diagnostics.map(
        (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
    );

    return {
        type: "mdflow.catalog",
        protocolVersion: FLOW_UX_PROTOCOL_VERSION,
        cwd: catalog.cwd,
        projectRoot: catalog.projectRoot,
        flows,
        counts: catalog.counts,
        warnings,
    };
}

/**
 * Run the catalog subcommand. Output is always JSON (like `md roster`);
 * `--json` is accepted for symmetry but does not change behavior. Always
 * exits 0 — an empty `flows` array is a normal result, not a failure.
 */
export async function runCatalog(
    args: string[],
    cwd: string,
): Promise<number> {
    void args;
    const payload = await buildCatalogJson(cwd);
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return 0;
}
