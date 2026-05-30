import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerApiTriggers } from "../src/triggers/api.js";
import { KV } from "../src/state/schema.js";
import type { Session } from "../src/types.js";

const configState = vi.hoisted(() => ({ graphExtractionEnabled: false }));

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    isGraphExtractionEnabled: () => configState.graphExtractionEnabled,
  };
});

vi.mock("../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

type Handler = (payload: unknown) => unknown | Promise<unknown>;

function mockKV() {
  const store = new Map<string, Map<string, unknown>>();
  return {
    get: async <T>(scope: string, key: string): Promise<T | null> =>
      (store.get(scope)?.get(key) as T) ?? null,
    set: async <T>(scope: string, key: string, data: T): Promise<T> => {
      if (!store.has(scope)) store.set(scope, new Map());
      store.get(scope)!.set(key, data);
      return data;
    },
    update: async (scope: string, key: string, updates: Array<{ type: "set"; path: string; value: unknown }>): Promise<void> => {
      const current = ((store.get(scope)?.get(key) as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      for (const update of updates) current[update.path] = update.value;
      if (!store.has(scope)) store.set(scope, new Map());
      store.get(scope)!.set(key, current);
    },
    list: async <T>(scope: string): Promise<T[]> => {
      const entries = store.get(scope);
      return entries ? (Array.from(entries.values()) as T[]) : [];
    },
  };
}

function mockSdk() {
  const handlers = new Map<string, Handler>();
  const triggers: Array<{ function_id: string; payload: unknown }> = [];
  const httpTriggers: Array<{ function_id: string; config: { api_path: string; http_method: string } }> = [];
  return {
    handlers,
    triggers,
    httpTriggers,
    sdk: {
      registerFunction: (functionId: string, handler: Handler) => {
        handlers.set(functionId, handler);
      },
      registerTrigger: (trigger: { type: string; function_id: string; config: { api_path?: string; http_method?: string } }) => {
        if (trigger.type === "http" && trigger.config.api_path && trigger.config.http_method) {
          httpTriggers.push({
            function_id: trigger.function_id,
            config: {
              api_path: trigger.config.api_path,
              http_method: trigger.config.http_method,
            },
          });
        }
      },
      trigger: async (input: { function_id: string; payload: unknown }) => {
        triggers.push(input);
        if (input.function_id === "event::session::stopped") return { success: true };
        if (input.function_id === "mem::graph-query") return { nodes: [{ id: "node_1" }], edges: [], depth: 0 };
        if (input.function_id === "mem::graph-stats") return { totalNodes: 1, totalEdges: 0, nodesByType: { file: 1 }, edgesByType: {} };
        if (input.function_id === "mem::graph-extract") return { success: true, nodesAdded: 1, edgesAdded: 0 };
        if (input.function_id === "mem::graph-build") return { success: true, observationsProcessed: 1 };
        return {};
      },
    },
  };
}

function makeSession(sessionId: string): Session {
  return {
    id: sessionId,
    project: "agentmemory",
    cwd: "/repo/agentmemory",
    startedAt: "2026-02-01T10:00:00Z",
    status: "active",
    observationCount: 1,
  };
}

describe("API session and graph integration", () => {
  beforeEach(() => {
    configState.graphExtractionEnabled = false;
  });

  it("returns fixed empty graph responses without invoking graph functions when disabled", async () => {
    const kv = mockKV();
    const { sdk, handlers, triggers } = mockSdk();
    registerApiTriggers(sdk as never, kv as never);

    await expect(
      handlers.get("api::graph-query")!({ body: { query: "index" }, headers: {} }),
    ).resolves.toEqual({
      status_code: 200,
      body: {
        nodes: [],
        edges: [],
        depth: 0,
        skipped: true,
        reason: "graph_extraction_disabled",
      },
    });

    await expect(
      handlers.get("api::graph-stats")!({ body: {}, headers: {} }),
    ).resolves.toEqual({
      status_code: 200,
      body: {
        totalNodes: 0,
        totalEdges: 0,
        nodesByType: {},
        edgesByType: {},
        skipped: true,
        reason: "graph_extraction_disabled",
      },
    });

    await expect(
      handlers.get("api::graph-extract")!({ body: {}, headers: {} }),
    ).resolves.toEqual({
      status_code: 200,
      body: {
        success: false,
        skipped: true,
        reason: "graph_extraction_disabled",
        nodesAdded: 0,
        edgesAdded: 0,
      },
    });

    await expect(
      handlers.get("api::graph-build")!({ body: { batchSize: 7, reset: true }, headers: {} }),
    ).resolves.toEqual({
      status_code: 200,
      body: {
        success: false,
        skipped: true,
        reason: "graph_extraction_disabled",
        observationsProcessed: 0,
        nodesAdded: 0,
        edgesAdded: 0,
      },
    });

    expect(triggers).toEqual([]);
  });

  it("registers graph/build and forwards a whitelisted payload", async () => {
    configState.graphExtractionEnabled = true;
    const kv = mockKV();
    const { sdk, handlers, httpTriggers, triggers } = mockSdk();
    registerApiTriggers(sdk as never, kv as never);

    expect(httpTriggers).toContainEqual({
      function_id: "api::graph-build",
      config: {
        api_path: "/agentmemory/graph/build",
        http_method: "POST",
      },
    });

    const response = (await handlers.get("api::graph-build")!({
      body: { batchSize: 7, reset: true, ignored: "field" },
      headers: {},
    })) as { status_code: number; body: unknown };

    expect(response.status_code).toBe(200);
    expect(response.body).toEqual({ success: true, observationsProcessed: 1 });
    expect(triggers).toContainEqual({
      function_id: "mem::graph-build",
      payload: { batchSize: 7, reset: true },
    });
  });

  it("graph/query forwards only whitelisted query and paging fields", async () => {
    configState.graphExtractionEnabled = true;
    const kv = mockKV();
    const { sdk, handlers, triggers } = mockSdk();
    registerApiTriggers(sdk as never, kv as never);

    const response = (await handlers.get("api::graph-query")!({
      body: {
        query: "index",
        startNodeId: "gn_1",
        nodeType: "file",
        maxDepth: 2,
        offset: 100,
        limit: 50,
        ignored: "field",
      },
      headers: {},
    })) as { status_code: number; body: unknown };

    expect(response.status_code).toBe(200);
    expect(triggers).toContainEqual({
      function_id: "mem::graph-query",
      payload: {
        query: "index",
        startNodeId: "gn_1",
        nodeType: "file",
        maxDepth: 2,
        offset: 100,
        limit: 50,
      },
    });
  });

  it("graph/query rejects invalid paging fields", async () => {
    configState.graphExtractionEnabled = true;
    const kv = mockKV();
    const { sdk, handlers } = mockSdk();
    registerApiTriggers(sdk as never, kv as never);

    await expect(
      handlers.get("api::graph-query")!({ body: { offset: -1 }, headers: {} }),
    ).resolves.toEqual({
      status_code: 400,
      body: { error: "offset must be a non-negative integer" },
    });

    await expect(
      handlers.get("api::graph-query")!({ body: { limit: 0 }, headers: {} }),
    ).resolves.toEqual({
      status_code: 400,
      body: { error: "limit must be a positive integer" },
    });
  });

  it("session/end triggers stopped-session recovery work", async () => {
    const sessionId = "ses_1";
    const kv = mockKV();
    await kv.set(KV.sessions, sessionId, makeSession(sessionId));
    const { sdk, handlers, triggers } = mockSdk();
    registerApiTriggers(sdk as never, kv as never);

    const response = (await handlers.get("api::session::end")!({
      body: { sessionId },
      headers: {},
    })) as { status_code: number; body: unknown };

    expect(response.status_code).toBe(200);
    expect(triggers).toContainEqual({
      function_id: "event::session::stopped",
      payload: { sessionId },
    });
    await expect(kv.get<Session>(KV.sessions, sessionId)).resolves.toMatchObject({
      status: "completed",
    });
  });
});
