import type { ISdk } from "iii-sdk";
import type {
  GraphNode,
  GraphEdge,
  GraphQueryResult,
  CompressedObservation,
  MemoryProvider,
  Session,
} from "../types.js";
import { KV, generateId } from "../state/schema.js";
import type { StateKV } from "../state/kv.js";
import { getGraphBatchSize } from "../config.js";
import {
  GRAPH_EXTRACTION_SYSTEM,
  buildGraphExtractionPrompt,
} from "../prompts/graph-extraction.js";
import { recordAudit } from "./audit.js";
import { logger } from "../logger.js";

// Parse all key="value" pairs from a tag's attribute string, in any
// order. The previous parser hard-coded attribute order
// (type before name on <entity>, type/source/target/weight on
// <relationship>) and silently dropped nodes/edges when the upstream
// LLM emitted attributes in a different order — Codex in particular
// likes to lead with `name=` (#635).
function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([A-Za-z_][\w:-]*)="([^"]*)"/g;
  let m;
  while ((m = attrRegex.exec(raw)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function parseGraphXml(
  xml: string,
  observationIds: string[],
): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const now = new Date().toISOString();

  // Two passes because <entity> can be self-closing or have a body
  // (<property> children). The self-closing form needs `[^>]*[^/]` on
  // the attr group so the trailing `/` isn't swallowed into the match
  // (root cause of #494). The explicit-close form picks up the
  // property block.
  const entitySelfClose = /<entity\b([^>]*?)\/>/g;
  const entityWithBody = /<entity\b([^>]*[^/])>([\s\S]*?)<\/entity>/g;

  const addEntity = (rawAttrs: string, propsBlock = ""): void => {
    const attrs = parseAttrs(rawAttrs);
    const type = attrs["type"] as GraphNode["type"] | undefined;
    const name = attrs["name"];
    if (!type || !name) return;
    const properties: Record<string, string> = {};
    const propRegex = /<property\s+key="([^"]+)">([^<]*)<\/property>/g;
    let propMatch;
    while ((propMatch = propRegex.exec(propsBlock)) !== null) {
      properties[propMatch[1]] = propMatch[2];
    }
    nodes.push({
      id: generateId("gn"),
      type,
      name,
      properties,
      sourceObservationIds: observationIds,
      createdAt: now,
    });
  };

  let match;
  while ((match = entitySelfClose.exec(xml)) !== null) {
    addEntity(match[1]);
  }
  while ((match = entityWithBody.exec(xml)) !== null) {
    addEntity(match[1], match[2]);
  }

  const relRegex = /<relationship\b([^>]*?)\/>/g;
  while ((match = relRegex.exec(xml)) !== null) {
    const attrs = parseAttrs(match[1]);
    const type = attrs["type"] as GraphEdge["type"] | undefined;
    const sourceName = attrs["source"];
    const targetName = attrs["target"];
    if (!type || !sourceName || !targetName) continue;
    const parsedWeight = parseFloat(attrs["weight"] ?? "");
    const weight = Number.isFinite(parsedWeight) ? parsedWeight : 0.5;

    const sourceNode = nodes.find((n) => n.name === sourceName);
    const targetNode = nodes.find((n) => n.name === targetName);
    if (!sourceNode || !targetNode) continue;
    edges.push({
      id: generateId("ge"),
      type,
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      weight: Math.max(0, Math.min(1, weight)),
      sourceObservationIds: observationIds,
      createdAt: now,
    });
  }

  return { nodes, edges };
}

function isCompressedObservation(value: unknown): value is CompressedObservation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { sessionId?: unknown }).sessionId === "string" &&
    typeof (value as { title?: unknown }).title === "string" &&
    typeof (value as { narrative?: unknown }).narrative === "string" &&
    Array.isArray((value as { concepts?: unknown }).concepts) &&
    Array.isArray((value as { files?: unknown }).files)
  );
}

function chunkObservations(
  observations: CompressedObservation[],
  batchSize: number,
): CompressedObservation[][] {
  const chunks: CompressedObservation[][] = [];
  for (let i = 0; i < observations.length; i += batchSize) {
    chunks.push(observations.slice(i, i + batchSize));
  }
  return chunks;
}

function pageGraphResult(
  nodes: GraphNode[],
  edges: GraphEdge[],
  depth: number,
  offset?: number,
  limit?: number,
): GraphQueryResult {
  if (offset === undefined && limit === undefined) {
    return { nodes, edges, depth };
  }

  const safeOffset =
    typeof offset === "number" && Number.isInteger(offset) && offset >= 0
      ? offset
      : 0;
  const remaining = Math.max(0, nodes.length - safeOffset);
  const safeLimit =
    typeof limit === "number" && Number.isInteger(limit) && limit > 0
      ? limit
      : remaining;
  const pagedNodes = nodes.slice(safeOffset, safeOffset + safeLimit);
  const pagedNodeIds = new Set(pagedNodes.map((node) => node.id));
  const pagedEdges = edges.filter(
    (edge) =>
      pagedNodeIds.has(edge.sourceNodeId) ||
      pagedNodeIds.has(edge.targetNodeId),
  );
  const nextOffset = safeOffset + pagedNodes.length;
  const hasMore = nextOffset < nodes.length;
  const result: GraphQueryResult = {
    nodes: pagedNodes,
    edges: pagedEdges,
    depth,
    offset: safeOffset,
    limit: safeLimit,
    totalNodes: nodes.length,
    hasMore,
  };
  if (hasMore) result.nextOffset = nextOffset;
  return result;
}

export function registerGraphFunction(
  sdk: ISdk,
  kv: StateKV,
  provider: MemoryProvider,
): void {
  sdk.registerFunction("mem::graph-extract", 
    async (data: { observations: CompressedObservation[] }) => {
      if (!data.observations || data.observations.length === 0) {
        return { success: false, error: "No observations provided" };
      }

      const prompt = buildGraphExtractionPrompt(
        data.observations.map((o) => ({
          title: o.title,
          narrative: o.narrative,
          concepts: o.concepts,
          files: o.files,
          type: o.type,
        })),
      );

      try {
        const response = await provider.compress(
          GRAPH_EXTRACTION_SYSTEM,
          prompt,
        );

        const obsIds = data.observations.map((o) => o.id);
        const { nodes, edges } = parseGraphXml(response, obsIds);

        const existingNodes = await kv.list<GraphNode>(KV.graphNodes);
        const existingEdges = await kv.list<GraphEdge>(KV.graphEdges);

        for (const node of nodes) {
          const existing = existingNodes.find(
            (n) => n.name === node.name && n.type === node.type,
          );
          if (existing) {
            const merged = {
              ...existing,
              sourceObservationIds: [
                ...new Set([...existing.sourceObservationIds, ...obsIds]),
              ],
              properties: { ...existing.properties, ...node.properties },
            };
            await kv.set(KV.graphNodes, existing.id, merged);
            const idx = existingNodes.findIndex((n) => n.id === existing.id);
            if (idx !== -1) existingNodes[idx] = merged;
          } else {
            await kv.set(KV.graphNodes, node.id, node);
            existingNodes.push(node);
          }
        }

        for (const edge of edges) {
          const edgeKey = `${edge.sourceNodeId}|${edge.targetNodeId}|${edge.type}`;
          const existingEdge = existingEdges.find(
            (e) => `${e.sourceNodeId}|${e.targetNodeId}|${e.type}` === edgeKey,
          );
          if (existingEdge) {
            existingEdge.sourceObservationIds = [
              ...new Set([...existingEdge.sourceObservationIds, ...obsIds]),
            ];
            await kv.set(KV.graphEdges, existingEdge.id, existingEdge);
          } else {
            await kv.set(KV.graphEdges, edge.id, edge);
            existingEdges.push(edge);
          }
        }

        await recordAudit(kv, "observe", "mem::graph-extract", obsIds, {
          nodesExtracted: nodes.length,
          edgesExtracted: edges.length,
        });

        logger.info("Graph extraction complete", {
          nodes: nodes.length,
          edges: edges.length,
        });
        return {
          success: true,
          nodesAdded: nodes.length,
          edgesAdded: edges.length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("Graph extraction failed", { error: msg });
        return { success: false, error: msg };
      }
    },
  );

  sdk.registerFunction("mem::graph-build",
    async (data: { batchSize?: number; reset?: boolean } = {}) => {
      if (data.reset === true) {
        const [nodes, edges] = await Promise.all([
          kv.list<GraphNode>(KV.graphNodes),
          kv.list<GraphEdge>(KV.graphEdges),
        ]);
        await Promise.all([
          ...nodes.map((node) => kv.delete(KV.graphNodes, node.id)),
          ...edges.map((edge) => kv.delete(KV.graphEdges, edge.id)),
        ]);
      }

      const sessions = await kv.list<Session>(KV.sessions);
      const observationsBySession = await Promise.all(
        sessions.map((session) => kv.list<unknown>(KV.observations(session.id))),
      );
      const observations = observationsBySession.flat().filter(isCompressedObservation);

      const alreadyIndexed = new Set<string>();
      if (data.reset !== true) {
        const [nodes, edges] = await Promise.all([
          kv.list<GraphNode>(KV.graphNodes),
          kv.list<GraphEdge>(KV.graphEdges),
        ]);
        for (const node of nodes) {
          for (const obsId of node.sourceObservationIds) alreadyIndexed.add(obsId);
        }
        for (const edge of edges) {
          for (const obsId of edge.sourceObservationIds) alreadyIndexed.add(obsId);
        }
      }

      const pending = observations.filter((obs) => !alreadyIndexed.has(obs.id));
      if (pending.length === 0) {
        return {
          success: true,
          observationsProcessed: 0,
          nodesAdded: 0,
          edgesAdded: 0,
        };
      }

      const requestedBatchSize = data.batchSize;
      const batchSize =
        typeof requestedBatchSize === "number" &&
        Number.isInteger(requestedBatchSize) &&
        requestedBatchSize > 0
          ? requestedBatchSize
          : Math.max(1, getGraphBatchSize());
      let nodesAdded = 0;
      let edgesAdded = 0;
      let observationsProcessed = 0;

      for (const batch of chunkObservations(pending, batchSize)) {
        const result = (await sdk.trigger({
          function_id: "mem::graph-extract",
          payload: { observations: batch },
        })) as { success?: boolean; nodesAdded?: number; edgesAdded?: number; error?: string };
        if (result.success === false) {
          return {
            success: false,
            error: result.error ?? "graph extraction failed",
            observationsProcessed,
            nodesAdded,
            edgesAdded,
          };
        }
        observationsProcessed += batch.length;
        nodesAdded += result.nodesAdded ?? 0;
        edgesAdded += result.edgesAdded ?? 0;
      }

      return {
        success: true,
        observationsProcessed,
        nodesAdded,
        edgesAdded,
      };
    },
  );

  sdk.registerFunction("mem::graph-query", 
    async (data: {
      startNodeId?: string;
      nodeType?: string;
      maxDepth?: number;
      query?: string;
      offset?: number;
      limit?: number;
    }): Promise<GraphQueryResult> => {
      const allNodes = (await kv.list<GraphNode>(KV.graphNodes)).filter((n) => !n.stale);
      const allEdges = (await kv.list<GraphEdge>(KV.graphEdges)).filter((e) => !e.stale);
      const maxDepth = Math.min(data.maxDepth || 3, 5);

      if (data.query) {
        const lower = data.query.toLowerCase();
        const matchingNodes = allNodes.filter(
          (n) =>
            n.name.toLowerCase().includes(lower) ||
            Object.values(n.properties).some(
              (v) => typeof v === "string" && v.toLowerCase().includes(lower),
            ),
        );
        const nodeIds = new Set(matchingNodes.map((n) => n.id));
        const relatedEdges = allEdges.filter(
          (e) => nodeIds.has(e.sourceNodeId) || nodeIds.has(e.targetNodeId),
        );
        return pageGraphResult(
          matchingNodes,
          relatedEdges,
          0,
          data.offset,
          data.limit,
        );
      }

      if (data.startNodeId) {
        const visited = new Set<string>();
        const visitedEdges = new Set<string>();
        const resultNodes: GraphNode[] = [];
        const resultEdges: GraphEdge[] = [];
        const queue: Array<{ nodeId: string; depth: number }> = [
          { nodeId: data.startNodeId, depth: 0 },
        ];

        while (queue.length > 0) {
          const { nodeId, depth } = queue.shift()!;
          if (visited.has(nodeId) || depth > maxDepth) continue;
          visited.add(nodeId);

          const node = allNodes.find((n) => n.id === nodeId);
          if (node) {
            if (!data.nodeType || node.type === data.nodeType) {
              resultNodes.push(node);
            }
          }

          const neighborEdges = allEdges.filter(
            (e) => e.sourceNodeId === nodeId || e.targetNodeId === nodeId,
          );
          for (const edge of neighborEdges) {
            if (!visitedEdges.has(edge.id)) {
              visitedEdges.add(edge.id);
              resultEdges.push(edge);
            }
            const nextId =
              edge.sourceNodeId === nodeId
                ? edge.targetNodeId
                : edge.sourceNodeId;
            if (!visited.has(nextId)) {
              queue.push({ nodeId: nextId, depth: depth + 1 });
            }
          }
        }

        return pageGraphResult(
          resultNodes,
          resultEdges,
          maxDepth,
          data.offset,
          data.limit,
        );
      }

      let filtered = allNodes;
      if (data.nodeType) {
        filtered = allNodes.filter((n) => n.type === data.nodeType);
      }
      return pageGraphResult(filtered, allEdges, 0, data.offset, data.limit);
    },
  );

  sdk.registerFunction("mem::graph-stats",  async () => {
    const nodes = await kv.list<GraphNode>(KV.graphNodes);
    const edges = await kv.list<GraphEdge>(KV.graphEdges);

    const nodesByType: Record<string, number> = {};
    for (const n of nodes) {
      nodesByType[n.type] = (nodesByType[n.type] || 0) + 1;
    }

    const edgesByType: Record<string, number> = {};
    for (const e of edges) {
      edgesByType[e.type] = (edgesByType[e.type] || 0) + 1;
    }

    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodesByType,
      edgesByType,
    };
  });
}
