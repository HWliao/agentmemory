import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerGraphFunction } from "../src/functions/graph.js";
import { KV } from "../src/state/schema.js";
import type {
  CompressedObservation,
  GraphNode,
  GraphEdge,
  GraphQueryResult,
  Session,
} from "../src/types.js";

function mockKV() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    get: async <T>(scope: string, key: string): Promise<T | null> => {
      return (store.get(scope)?.get(key) as T) ?? null;
    },
    set: async <T>(scope: string, key: string, data: T): Promise<T> => {
      if (!store.has(scope)) store.set(scope, new Map());
      store.get(scope)!.set(key, data);
      return data;
    },
    delete: async (scope: string, key: string): Promise<void> => {
      store.get(scope)?.delete(key);
    },
    list: async <T>(scope: string): Promise<T[]> => {
      const entries = store.get(scope);
      return entries ? (Array.from(entries.values()) as T[]) : [];
    },
  };
}

function mockSdk() {
  const functions = new Map<string, Function>();
  return {
    registerFunction: (idOrOpts: string | { id: string }, handler: Function) => {
      const id = typeof idOrOpts === "string" ? idOrOpts : idOrOpts.id;
      functions.set(id, handler);
    },
    registerTrigger: () => {},
    trigger: async (idOrInput: string | { function_id: string; payload: unknown }, data?: unknown) => {
      const id = typeof idOrInput === "string" ? idOrInput : idOrInput.function_id;
      const payload = typeof idOrInput === "string" ? data : idOrInput.payload;
      const fn = functions.get(id);
      if (!fn) throw new Error(`No function: ${id}`);
      return fn(payload);
    },
  };
}

const mockProvider = {
  name: "test",
  compress: vi.fn().mockResolvedValue(`<entities>
<entity type="file" name="src/index.ts"><property key="path">src/index.ts</property></entity>
<entity type="function" name="main"><property key="lang">typescript</property></entity>
</entities>
<relationships>
<relationship type="uses" source="src/index.ts" target="main" weight="0.9"/>
</relationships>`),
  summarize: vi.fn(),
};

const testObs: CompressedObservation = {
  id: "obs_1",
  sessionId: "ses_1",
  timestamp: "2026-02-01T10:00:00Z",
  type: "file_edit",
  title: "Edit index file",
  facts: ["Modified main function"],
  narrative: "Updated index.ts with main function",
  concepts: ["typescript", "entry-point"],
  files: ["src/index.ts"],
  importance: 7,
};

describe("Graph Functions", () => {
  let sdk: ReturnType<typeof mockSdk>;
  let kv: ReturnType<typeof mockKV>;

  beforeEach(() => {
    sdk = mockSdk();
    kv = mockKV();
    vi.clearAllMocks();
    registerGraphFunction(sdk as never, kv as never, mockProvider as never);
  });

  it("graph-extract creates nodes and edges from XML response", async () => {
    const result = (await sdk.trigger("mem::graph-extract", {
      observations: [testObs],
    })) as { success: boolean; nodesAdded: number; edgesAdded: number };

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);

    const nodes = await kv.list<GraphNode>("mem:graph:nodes");
    expect(nodes.length).toBe(2);
    expect(nodes.find((n) => n.name === "src/index.ts")).toBeDefined();
    expect(nodes.find((n) => n.name === "main")).toBeDefined();

    const edges = await kv.list<GraphEdge>("mem:graph:edges");
    expect(edges.length).toBe(1);
    expect(edges[0].type).toBe("uses");
  });

  it("graph-extract accepts self-closing entity tags", async () => {
    mockProvider.compress.mockResolvedValueOnce(`<entities>
<entity type="file" name="src/index.ts"/>
<entity type="function" name="main"><property key="lang">typescript</property></entity>
</entities>
<relationships>
<relationship type="uses" source="src/index.ts" target="main" weight="0.9"/>
</relationships>`);

    const result = (await sdk.trigger("mem::graph-extract", {
      observations: [testObs],
    })) as { success: boolean; nodesAdded: number; edgesAdded: number };

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);

    const nodes = await kv.list<GraphNode>("mem:graph:nodes");
    expect(nodes.some((n) => n.name === "src/index.ts")).toBe(true);
    expect(nodes.some((n) => n.name === "main")).toBe(true);

    const edges = await kv.list<GraphEdge>("mem:graph:edges");
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe("uses");
  });

  it("graph-extract tolerates reordered attributes (#635)", async () => {
    // Codex CLI's LLM tends to emit attribute order name→type and
    // source→target→type rather than the hard-coded type-first /
    // type/source/target/weight sequence the old parser required.
    mockProvider.compress.mockResolvedValueOnce(`<entities>
<entity name="src/index.ts" type="file"/>
<entity name="main" type="function"><property key="lang">typescript</property></entity>
</entities>
<relationships>
<relationship source="src/index.ts" target="main" type="uses" weight="0.9"/>
</relationships>`);

    const result = (await sdk.trigger("mem::graph-extract", {
      observations: [testObs],
    })) as { success: boolean; nodesAdded: number; edgesAdded: number };

    expect(result.success).toBe(true);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);

    const nodes = await kv.list<GraphNode>("mem:graph:nodes");
    expect(nodes.find((n) => n.name === "src/index.ts")?.type).toBe("file");
    expect(nodes.find((n) => n.name === "main")?.type).toBe("function");

    const edges = await kv.list<GraphEdge>("mem:graph:edges");
    expect(edges).toHaveLength(1);
    expect(edges[0].type).toBe("uses");
    expect(edges[0].weight).toBeCloseTo(0.9, 5);
  });

  it("graph-query with search returns matching nodes", async () => {
    await sdk.trigger("mem::graph-extract", { observations: [testObs] });

    const result = (await sdk.trigger("mem::graph-query", {
      query: "index",
    })) as GraphQueryResult;

    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.nodes.some((n) => n.name.includes("index"))).toBe(true);
  });

  it("graph-query with startNodeId does BFS traversal", async () => {
    await sdk.trigger("mem::graph-extract", { observations: [testObs] });

    const nodes = await kv.list<GraphNode>("mem:graph:nodes");
    const fileNode = nodes.find((n) => n.name === "src/index.ts")!;

    const result = (await sdk.trigger("mem::graph-query", {
      startNodeId: fileNode.id,
      maxDepth: 2,
    })) as GraphQueryResult;

    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
    expect(result.edges.length).toBeGreaterThanOrEqual(1);
    expect(result.depth).toBe(2);
  });

  it("graph-query pages nodes in existing order and returns continuation metadata", async () => {
    const nodes: GraphNode[] = Array.from({ length: 5 }, (_, i) => ({
      id: `gn_${i}`,
      type: "concept",
      name: `node-${i}`,
      properties: {},
      sourceObservationIds: [`obs_${i}`],
      createdAt: `2026-02-01T10:00:0${i}Z`,
    }));
    for (const node of nodes) await kv.set(KV.graphNodes, node.id, node);
    const edges: GraphEdge[] = [
      {
        id: "ge_0_1",
        type: "related_to",
        sourceNodeId: "gn_0",
        targetNodeId: "gn_1",
        weight: 0.5,
        sourceObservationIds: ["obs_0"],
        createdAt: "2026-02-01T10:00:00Z",
      },
      {
        id: "ge_1_2",
        type: "related_to",
        sourceNodeId: "gn_1",
        targetNodeId: "gn_2",
        weight: 0.5,
        sourceObservationIds: ["obs_1"],
        createdAt: "2026-02-01T10:00:01Z",
      },
      {
        id: "ge_3_4",
        type: "related_to",
        sourceNodeId: "gn_3",
        targetNodeId: "gn_4",
        weight: 0.5,
        sourceObservationIds: ["obs_3"],
        createdAt: "2026-02-01T10:00:03Z",
      },
    ];
    for (const edge of edges) await kv.set(KV.graphEdges, edge.id, edge);

    const result = (await sdk.trigger("mem::graph-query", {
      offset: 1,
      limit: 2,
    })) as GraphQueryResult;

    expect(result.nodes.map((node) => node.id)).toEqual(["gn_1", "gn_2"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["ge_0_1", "ge_1_2"]);
    expect(result.offset).toBe(1);
    expect(result.limit).toBe(2);
    expect(result.totalNodes).toBe(5);
    expect(result.nextOffset).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it("graph-query preserves existing unpaged response shape", async () => {
    await sdk.trigger("mem::graph-extract", { observations: [testObs] });

    const result = (await sdk.trigger("mem::graph-query", {})) as GraphQueryResult;

    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result).not.toHaveProperty("nextOffset");
    expect(result).not.toHaveProperty("hasMore");
  });

  it("graph-stats returns counts by type", async () => {
    await sdk.trigger("mem::graph-extract", { observations: [testObs] });

    const result = (await sdk.trigger("mem::graph-stats", {})) as {
      totalNodes: number;
      totalEdges: number;
      nodesByType: Record<string, number>;
      edgesByType: Record<string, number>;
    };

    expect(result.totalNodes).toBe(2);
    expect(result.totalEdges).toBe(1);
    expect(result.nodesByType.file).toBe(1);
    expect(result.nodesByType.function).toBe(1);
    expect(result.edgesByType.uses).toBe(1);
  });

  it("graph-build extracts graph data from stored observations", async () => {
    const session: Session = {
      id: "ses_1",
      project: "agentmemory",
      cwd: "/repo/agentmemory",
      startedAt: "2026-02-01T10:00:00Z",
      status: "completed",
      observationCount: 1,
    };
    await kv.set(KV.sessions, session.id, session);
    await kv.set(KV.observations(session.id), testObs.id, testObs);

    const result = (await sdk.trigger("mem::graph-build", {})) as {
      success: boolean;
      observationsProcessed: number;
      nodesAdded: number;
      edgesAdded: number;
    };

    expect(result.success).toBe(true);
    expect(result.observationsProcessed).toBe(1);
    expect(result.nodesAdded).toBe(2);
    expect(result.edgesAdded).toBe(1);

    const nodes = await kv.list<GraphNode>(KV.graphNodes);
    expect(nodes.length).toBe(2);
  });

  it("graph-build returns success with zero counts for an empty corpus", async () => {
    const result = (await sdk.trigger("mem::graph-build", {})) as {
      success: boolean;
      observationsProcessed: number;
      nodesAdded: number;
      edgesAdded: number;
    };

    expect(result).toEqual({
      success: true,
      observationsProcessed: 0,
      nodesAdded: 0,
      edgesAdded: 0,
    });
  });

  it("graph-build skips already indexed observations in incremental mode", async () => {
    const session: Session = {
      id: "ses_1",
      project: "agentmemory",
      cwd: "/repo/agentmemory",
      startedAt: "2026-02-01T10:00:00Z",
      status: "completed",
      observationCount: 1,
    };
    await kv.set(KV.sessions, session.id, session);
    await kv.set(KV.observations(session.id), testObs.id, testObs);
    await kv.set(KV.graphNodes, "gn_existing", {
      id: "gn_existing",
      type: "file",
      name: "src/index.ts",
      properties: {},
      sourceObservationIds: [testObs.id],
      createdAt: "2026-02-01T10:00:00Z",
    } satisfies GraphNode);

    const result = (await sdk.trigger("mem::graph-build", {})) as {
      success: boolean;
      observationsProcessed: number;
      nodesAdded: number;
      edgesAdded: number;
    };

    expect(result).toEqual({
      success: true,
      observationsProcessed: 0,
      nodesAdded: 0,
      edgesAdded: 0,
    });
    expect(mockProvider.compress).not.toHaveBeenCalled();
  });

  it("graph-build reset mode rebuilds already indexed observations", async () => {
    const session: Session = {
      id: "ses_1",
      project: "agentmemory",
      cwd: "/repo/agentmemory",
      startedAt: "2026-02-01T10:00:00Z",
      status: "completed",
      observationCount: 1,
    };
    await kv.set(KV.sessions, session.id, session);
    await kv.set(KV.observations(session.id), testObs.id, testObs);
    await kv.set(KV.graphNodes, "gn_existing", {
      id: "gn_existing",
      type: "file",
      name: "old-index.ts",
      properties: {},
      sourceObservationIds: [testObs.id],
      createdAt: "2026-02-01T10:00:00Z",
    } satisfies GraphNode);

    const result = (await sdk.trigger("mem::graph-build", { reset: true })) as {
      success: boolean;
      observationsProcessed: number;
      nodesAdded: number;
      edgesAdded: number;
    };

    expect(result.success).toBe(true);
    expect(result.observationsProcessed).toBe(1);
    expect(mockProvider.compress).toHaveBeenCalledTimes(1);
    const nodes = await kv.list<GraphNode>(KV.graphNodes);
    expect(nodes.some((node) => node.id === "gn_existing")).toBe(false);
    expect(nodes.some((node) => node.name === "src/index.ts")).toBe(true);
  });

  it("graph-extract returns error for empty observations", async () => {
    const result = (await sdk.trigger("mem::graph-extract", {
      observations: [],
    })) as { success: boolean; error: string };

    expect(result.success).toBe(false);
    expect(result.error).toContain("No observations");
  });
});
