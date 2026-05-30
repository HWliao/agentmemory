# Spec: Graph Viewer Performance and Incremental Loading

## Objective

Optimize the Viewer Graph tab for users with large knowledge graphs. The current graph viewer can become sluggish during initial load and ordinary interactions such as dragging, panning, zooming, hovering, searching, and node expansion.

Target users:

- Viewer users opening the Graph tab to inspect large graph stores.
- Local agentmemory users who need the graph to remain usable as stored graph nodes and edges grow.

Primary objective:

- Make the Graph tab progressively load graph data instead of blocking on one full payload/render pass.
- Make dragging, panning, and zooming responsive by avoiding whole-graph simulation and repeated full scans during pointer movement.
- Replace the current hand-written Canvas graph renderer with a local `force-graph` integration.

Core acceptance criteria:

- Initial Graph tab progressively loads graph data in configurable batches instead of rendering all nodes at once.
- The right sidebar exposes loading configuration; default loading cadence is 100 nodes every 100ms.
- Graph data ordering stays consistent with the current backend order; this work should not introduce a new ranking/sorting policy.
- Node expansion and search remain responsive while graph data is still progressively loading.
- Drag, pan, and zoom do not restart full `O(N^2)` physics work by default.
- Graph rendering uses cached indexes for node lookup, adjacency, neighbor checks, degree counts, and normalized labels.
- `force-graph` is loaded locally or bundled; the Viewer must not load graph scripts from a CDN.
- Overall Viewer layout and color styling stays unchanged. Only graph node type colors may be adjusted.
- Graph node type colors should move to macaron-style web-safe pastel colors that stay close to the existing type color families.
- Disabled graph behavior and manual graph build behavior remain unchanged.

## Tech Stack

- Runtime: Node.js, TypeScript, ESM.
- Backend integration: iii-sdk Worker/Function/Trigger only.
- State: iii-engine StateModule through `StateKV`; no direct SQLite access.
- Viewer: static HTML/CSS/JavaScript in `src/viewer/index.html`.
- Renderer: `force-graph`, integrated locally or bundled into Viewer assets, not loaded from CDN.
- Tests: Vitest.

Reference material:

- Existing Viewer Graph implementation: `src/viewer/index.html`.
- Existing graph backend: `src/functions/graph.ts` and `src/triggers/api.ts`.
- Local `force-graph` sample: `C:\Users\Administrator\Downloads\preview (1).html`.

The local sample is a reference only. Useful ideas include `ForceGraph()(container).graphData(data)`, `cooldownTicks`, `d3AlphaDecay`, `d3VelocityDecay`, `d3Force("charge")`, `d3Force("link")`, `zoomToFit`, pause/resume, hover/click callbacks, and custom node drawing. Do not copy demo-only auto node growth or CDN loading.

## Commands

- Run graph backend tests: `npm test -- --run test/graph.test.ts`
- Run graph API tests: `npm test -- --run test/api-session-graph.test.ts`
- Run Viewer graph tests: `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- Run consistency tests if endpoint counts or API registrations change: `npm test -- --run test/consistency.test.ts`
- Run focused graph validation: `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- Run full non-integration suite before final completion: `npm test`
- Build package: `npm run build`

## Project Structure

- `src/functions/graph.ts` -> existing graph query, graph stats, and graph build functions. Touch only if progressive loading requires backend query compatibility changes.
- `src/triggers/api.ts` -> REST endpoint registration and request validation/whitelisting. Touch only if graph query request fields change.
- `src/viewer/index.html` -> Graph tab UI, loading configuration controls, renderer setup, graph data loading, graph interaction handling, graph node type colors, and Viewer-side caches.
- `src/auth.ts` -> Viewer CSP. Update only if local renderer asset loading requires it.
- `test/graph.test.ts` -> backend graph query behavior and compatibility tests if graph query payload shape changes.
- `test/api-session-graph.test.ts` -> graph REST boundary behavior, whitelisting, disabled graph behavior.
- `test/viewer-graph-empty.test.ts` -> Graph tab loading, empty/disabled state, and no automatic build source-level assertions.
- `test/viewer-graph-cooldown.test.ts` or a new focused Viewer test -> source-level assertions for progressive loading, force-graph integration, interaction hot paths, and animation lifecycle.
- `docs/SPEC.md` -> active spec for this Viewer graph optimization.
- `docs/archive/` -> completed historical specs and task lists.

## Code Style

Use minimal TypeScript and static Viewer changes. Keep validation at system boundaries and keep graph data access through existing iii-sdk/StateKV paths.

StateKV currently exposes `list(scope)` as a full-array read. Do not make the Viewer request many `graph/query` offset/limit pages unless storage-level pagination is added; load one graph snapshot and apply progressive rendering on the client.

REST handlers must whitelist fields before calling `sdk.trigger()` if graph query inputs change:

```ts
sdk.registerFunction("api::graph-query", async (req: ApiRequest): Promise<Response> => {
  const authErr = checkAuth(req, secret);
  if (authErr) return authErr;
  if (!isGraphExtractionEnabled()) return graphDisabledResponse("query");

  const body = (req.body ?? {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  if (typeof body.startNodeId === "string") payload.startNodeId = body.startNodeId;
  if (typeof body.query === "string") payload.query = body.query;
  const maxDepth = parseOptionalPositiveInt(body.maxDepth);
  if (maxDepth === null) {
    return { status_code: 400, body: { error: "maxDepth must be a positive integer" } };
  }
  if (maxDepth !== undefined) payload.maxDepth = maxDepth;

  const result = await sdk.trigger({
    function_id: "mem::graph-query",
    payload,
  });
  return { status_code: 200, body: result };
});
```

Viewer loading controls should use explicit numeric defaults and clamp user input:

```js
var DEFAULT_GRAPH_LOAD_BATCH_SIZE = 100;
var DEFAULT_GRAPH_LOAD_INTERVAL_MS = 100;

function getGraphLoadConfig() {
  return {
    batchSize: clampPositiveInt(state.graph.loadBatchSize, DEFAULT_GRAPH_LOAD_BATCH_SIZE),
    intervalMs: clampPositiveInt(state.graph.loadIntervalMs, DEFAULT_GRAPH_LOAD_INTERVAL_MS)
  };
}
```

Viewer hot paths should use cached indexes instead of repeated scans:

```js
function rebuildGraphIndexes() {
  state.graph.nodeById = new Map();
  state.graph.edgesByNode = new Map();
  state.graph.neighborsByNode = new Map();
  state.graph.degreeByNode = new Map();

  state.graph.nodes.forEach(function(node) {
    state.graph.nodeById.set(node.id, node);
  });

  state.graph.edges.forEach(function(edge) {
    addEdgeIndex(edge.sourceNodeId, edge);
    addEdgeIndex(edge.targetNodeId, edge);
    addNeighborIndex(edge.sourceNodeId, edge.targetNodeId);
    addNeighborIndex(edge.targetNodeId, edge.sourceNodeId);
  });
}
```

Conventions:

- Prefer progressive rendering/loading over one blocking full render pass.
- Keep response shapes backward-compatible unless explicitly approved.
- Do not introduce broad abstractions unless multiple call sites need them.
- Keep Viewer code readable despite being static JavaScript; use small helper functions for cache rebuild, merge, and lifecycle cleanup.
- Do not change the Viewer page layout, sidebar structure, typography, or global color system as part of this work.
- Limit visual styling changes to graph node colors. Use macaron-style web-safe pastel colors that preserve the existing node type color families.
- Avoid comments that restate code; comments should explain non-obvious performance or CSP decisions.

## Testing Strategy

Test levels:

- Backend unit tests for graph query compatibility if graph loading requires API contract changes.
- API handler tests for request whitelisting, disabled graph behavior, and response compatibility if REST inputs change.
- Viewer source-level tests for progressive loading defaults, right-sidebar loading configuration controls, direct local `force-graph` integration, no automatic graph build, no CDN renderer script, and known hot-path regressions.
- Viewer source-level or snapshot-style checks should guard against accidental global layout/style rewrites where practical.
- Manual browser smoke for real interaction behavior: initial load, drag, pan, zoom, hover, search, expand, pause/resume, switch tabs, rebuild/reload.
- Build verification after dependency or Viewer asset changes.

Regression targets:

- `loadGraph()` must not block first interaction on rendering every graph node in a single pass.
- The default progressive loading cadence is 100 nodes every 100ms.
- The right sidebar exposes loading configuration for node batch size and interval.
- The progressive loading sequence preserves current graph data ordering.
- Loading configuration resets to defaults on each Viewer page load.
- Progressive loading continues while the user is dragging or panning.
- Opening Graph tab must not call `graph/build` automatically.
- Pointer movement and dragging must not wake global full-graph simulation by default.
- Tooltip connection counts and focus fading must use cached adjacency data rather than full edge scans on every frame or mouse move.
- Viewer must not load `force-graph` or any graph renderer from a CDN.

Verification order:

1. Add Viewer source tests for progressive loading defaults, loading controls, local `force-graph`, and no CDN script.
2. Add backend/API tests only if the graph query contract changes.
3. Replace the current Canvas graph renderer with local `force-graph`.
4. Add progressive graph data loading using current ordering and default 100 nodes per 100ms.
5. Add Viewer cache/merge behavior and interaction hot-path tests.
6. Run targeted tests after each slice.
7. Run `npm run build` and `npm test` before final completion.

## Boundaries

Always:

- Keep graph state access through iii-sdk functions/triggers and `StateKV`; never read SQLite directly.
- Preserve `GRAPH_EXTRACTION_ENABLED=false` disabled behavior for graph endpoints.
- Preserve the rule that opening Graph tab never automatically triggers `graph/build`.
- Keep Viewer graph rendering/loading progressive by default.
- Preserve the current graph data order; do not introduce a new default ranking policy.
- Expose right-sidebar loading configuration with a default of 100 nodes every 100ms.
- Reset loading configuration to defaults on each Viewer page load; do not persist it across Viewer sessions.
- Continue progressive loading while the user is actively dragging or panning.
- Preserve the current overall Viewer layout, sidebar structure, typography, and global color styling.
- Keep graph node color changes limited to node type colors, using nearby macaron-style web-safe pastel colors.
- Validate and whitelist REST request fields before `sdk.trigger()`.
- Keep `force-graph` local or bundled if used; no CDN graph scripts.
- Keep existing graph reliability tests passing.

Ask first:

- Changing persisted `GraphNode` or `GraphEdge` schema.
- Adding any dependency other than `force-graph` for the renderer.
- Changing Viewer CSP beyond what is needed for local/self-hosted renderer assets.
- Changing public graph response shapes in a non-backward-compatible way.
- Changing the default graph data ordering/ranking policy.
- Changing the overall Viewer layout or global color system.

Never:

- Reintroduce automatic graph build on Graph tab open.
- Use CDN scripts in the Viewer for graph rendering.
- Require all graph nodes to be rendered in one blocking pass before interaction.
- Persist loading configuration across Viewer sessions without explicit approval.
- Bypass iii-engine state with standalone SQLite access.
- Remove or weaken disabled graph behavior.
- Remove failing tests to make the suite pass.

## Success Criteria

- Graph tab progressively loads graph nodes with default cadence 100 nodes per 100ms and remains usable on large graph stores.
- Right sidebar lets users adjust loading configuration.
- Loading configuration resets on every Viewer page load.
- Progressive loading continues during drag/pan interactions.
- Dragging, panning, and zooming are responsive because pointer movement avoids full graph simulation and full graph scans.
- Node expansion and search remain responsive while progressive loading is active.
- `force-graph` replaces the current Canvas renderer and is integrated locally.
- Overall Viewer layout and global styling remain unchanged; only graph node type colors are updated to nearby macaron-style web-safe pastel colors.
- Viewer CSP remains strict and does not permit third-party CDN graph scripts.
- Targeted graph/API/Viewer tests pass.
- `npm run build` passes.

## Decisions

- Keep graph data ordering consistent with the current behavior; do not add a new default sort or ranking policy in this optimization.
- Do not use an initial node cap. Instead, progressively load/render graph nodes.
- Add loading configuration in the right sidebar.
- Default progressive loading cadence is 100 nodes every 100ms.
- Loading configuration resets to defaults on each Viewer page load and is not persisted across Viewer sessions.
- Progressive loading continues while users drag or pan the graph.
- Replace the existing Canvas renderer directly with local `force-graph`.
- Do not change the overall Viewer layout or global color styling. Adjust only graph node type colors to nearby macaron-style web-safe pastel colors because the current node colors are visually poor.

## Open Questions

- None.
