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
- The Graph canvas control overlay sits in the top-right corner so it is not obscured by the Viewer footer.
- The Graph control overlay includes a settings panel that exposes loading configuration; default loading cadence is 100 nodes every 100ms.
- The settings panel exposes node visual scale controls. Node importance remains relative rather than making all nodes the same size.
- The settings panel exposes layout spread presets plus a custom mode for node size and related d3/force-graph tuning values.
- The Graph control overlay includes separate Reset Focus and Refresh Graph controls. Reset Focus returns to the global graph view without a network reload; Refresh Graph reloads graph data and shows loading state on the refresh control.
- Graph data ordering stays consistent with the current backend order; this work should not introduce a new ranking/sorting policy.
- Node expansion and search remain responsive while graph data is still progressively loading.
- Drag, pan, and zoom do not restart full `O(N^2)` physics work by default.
- Graph rendering uses cached indexes for node lookup, adjacency, neighbor checks, degree counts, and normalized labels.
- `force-graph` is loaded locally or bundled; the Viewer must not load graph scripts from a CDN.
- Overall Viewer layout and color styling stays unchanged except for the Graph canvas control overlay/settings panel required by this spec. Only graph node type colors may otherwise be adjusted.
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
- `force-graph` API: `https://vasturiano.github.io/force-graph/`.
- D3 many-body force: `https://d3js.org/d3-force/many-body`.
- D3 link force: `https://d3js.org/d3-force/link`.

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
- `src/viewer/index.html` -> Graph tab UI, canvas control overlay/settings panel, loading configuration controls, node size controls, layout spread controls, renderer setup, graph data loading, graph interaction handling, graph node type colors, and Viewer-side caches.
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

Viewer loading and graph tuning controls should use explicit defaults and clamp user input. These settings reset on each Viewer page load and must not be persisted without explicit approval:

```js
var GRAPH_LOAD_BATCH_DEFAULT = 100;
var GRAPH_LOAD_INTERVAL_DEFAULT = 100;
var GRAPH_NODE_REL_SIZE_DEFAULT = 4;
var GRAPH_NODE_SIZE_SCALE_DEFAULT = 1;
var GRAPH_LAYOUT_SPREAD_DEFAULT = 'balanced';
var GRAPH_LAYOUT_SPREAD_PRESETS = {
  compact: {
    nodeSizeScale: 1.1,
    chargeStrength: -6,
    chargeDistanceMin: 30,
    chargeDistanceMax: 240,
    linkDistance: 35,
    alphaDecay: 0.0228,
    velocityDecay: 0.48
  },
  balanced: {
    nodeSizeScale: 1,
    chargeStrength: -10,
    chargeDistanceMin: 50,
    chargeDistanceMax: 480,
    linkDistance: 60,
    alphaDecay: 0.0228,
    velocityDecay: 0.4
  },
  spacious: {
    nodeSizeScale: 0.95,
    chargeStrength: -24,
    chargeDistanceMin: 80,
    chargeDistanceMax: 960,
    linkDistance: 100,
    alphaDecay: 0.0228,
    velocityDecay: 0.35
  }
};

function getGraphLoadConfig() {
  return {
    batchSize: clampPositiveInt(state.graph.loadBatchSize, GRAPH_LOAD_BATCH_DEFAULT),
    intervalMs: clampNonNegativeInt(state.graph.loadIntervalMs, GRAPH_LOAD_INTERVAL_DEFAULT)
  };
}

function getGraphVisualConfig() {
  return {
    nodeSizeScale: clampNumber(state.graph.nodeSizeScale, 0.75, 4, GRAPH_NODE_SIZE_SCALE_DEFAULT),
    layoutSpread: state.graph.layoutSpread || GRAPH_LAYOUT_SPREAD_DEFAULT,
    customLayoutSpread: normalizeGraphCustomLayoutSpread(state.graph.customLayoutSpread)
  };
}
```

Node size control should preserve importance-based sizing:

- `nodeVal(node)` expresses relative node importance. Use degree-based importance, preferably with a logarithmic curve so high-degree nodes grow without dominating the graph.
- `nodeRelSize()` applies the user-facing global visual scale. Because `force-graph` defines `nodeRelSize` as area per value unit, map the UI scale to area, for example `GRAPH_NODE_REL_SIZE_DEFAULT * scale * scale`.
- The `balanced` layout preset is the Viewer default and should use `nodeRelSize` equivalent to `4` via `nodeSizeScale: 1`.
- The default node size is `1.0x`.
- The node size control does not directly change edge width, edge weight, graph schema, or graph query results.
- Do not make every node the same size; important nodes should remain visually larger.

Layout spread control should tune the d3 force layout through `force-graph`'s `d3Force()` API:

- Presets: `compact`, `balanced`, `spacious`.
- `balanced` is the default Viewer tuning: node size `1.0x`, many-body `strength: -10`, many-body `distanceMin: 50`, many-body `distanceMax: 480`, link `distance: 60`, alpha decay approximately `0.0228`, and velocity decay `0.4`.
- `compact` and `spacious` are derived from `balanced`: compact uses shorter link/charge distances and lower repulsion, while spacious uses longer link/charge distances and stronger repulsion.
- Presets include node visual scale, so choosing a layout preset can update the node size slider.
- `custom` mode exposes editable `node size`, `charge strength`, `charge distance min`, `charge distance max`, `link distance`, `alpha decay`, and `velocity decay` values.
- `charge strength` is usually negative; more negative values increase repulsion and make the graph more dispersed.
- `charge distance min` keeps nearby repulsion bounded and should default to d3's `1`.
- `charge distance max` limits how far the charge force applies; finite values keep layout more localized and help disconnected subgraphs avoid excessive drift.
- `link distance` controls the desired distance between connected nodes.
- `alpha decay` controls how quickly the simulation cools after force changes.
- `velocity decay` controls resistance/damping; higher values settle movement faster, lower values keep movement looser.
- Changing layout spread should reheat/restart the force simulation enough for the new layout to settle.

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
- Do not change the Viewer page layout, typography, or global color system as part of this work. The approved exception is moving Graph canvas controls to the top-right corner and adding an overlay settings panel for graph-specific controls.
- Limit visual styling changes to graph node colors. Use macaron-style web-safe pastel colors that preserve the existing node type color families.
- Avoid comments that restate code; comments should explain non-obvious performance or CSP decisions.

## Testing Strategy

Test levels:

- Backend unit tests for graph query compatibility if graph loading requires API contract changes.
- API handler tests for request whitelisting, disabled graph behavior, and response compatibility if REST inputs change.
- Viewer source-level tests for progressive loading defaults, Graph control overlay settings, node size controls, layout spread presets/custom values, reset focus, refresh loading state, direct local `force-graph` integration, no automatic graph build, no CDN renderer script, and known hot-path regressions.
- Viewer source-level or snapshot-style checks should guard against accidental global layout/style rewrites where practical.
- Manual browser smoke for real interaction behavior: initial load, drag, pan, zoom, hover, search, expand, pause/resume, switch tabs, rebuild/reload.
- Build verification after dependency or Viewer asset changes.

Regression targets:

- `loadGraph()` must not block first interaction on rendering every graph node in a single pass.
- The default progressive loading cadence is 100 nodes every 100ms.
- The top-right Graph control settings panel exposes loading configuration for node batch size and interval.
- The settings panel exposes node visual scale controls that preserve degree-based relative node importance.
- The settings panel exposes layout spread presets and custom `node size`, `charge strength`, `charge distance min`, `charge distance max`, `link distance`, `alpha decay`, and `velocity decay` values.
- The `balanced` preset is the default Viewer tuning; `compact` and `spacious` are tuned relative to that baseline.
- Reset Focus returns from a selected-node/focused view to the global graph view without reloading graph data.
- Refresh Graph clears focused state, reloads graph data, restarts progressive rendering, and shows loading state on the refresh control while the reload is active.
- The progressive loading sequence preserves current graph data ordering.
- Loading configuration resets to defaults on each Viewer page load.
- Node size and layout spread configuration resets to defaults on each Viewer page load.
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
- Expose Graph control overlay settings for loading configuration with a default of 100 nodes every 100ms.
- Expose Graph control overlay settings for layout spread, including node visual scale and custom layout force values inside the layout spread section.
- Reset loading configuration to defaults on each Viewer page load; do not persist it across Viewer sessions.
- Reset node visual scale and layout spread configuration to defaults on each Viewer page load; do not persist it across Viewer sessions.
- Continue progressive loading while the user is actively dragging or panning.
- Preserve the current overall Viewer layout, typography, and global color styling except for the approved Graph canvas control overlay/settings panel.
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
- Changing the overall Viewer layout or global color system beyond the approved Graph canvas control overlay/settings panel.

Never:

- Reintroduce automatic graph build on Graph tab open.
- Use CDN scripts in the Viewer for graph rendering.
- Require all graph nodes to be rendered in one blocking pass before interaction.
- Persist loading, node size, or layout spread configuration across Viewer sessions without explicit approval.
- Bypass iii-engine state with standalone SQLite access.
- Remove or weaken disabled graph behavior.
- Remove failing tests to make the suite pass.

## Success Criteria

- Graph tab progressively loads graph nodes with default cadence 100 nodes per 100ms and remains usable on large graph stores.
- Top-right Graph controls avoid footer overlap and provide a settings panel for loading and layout spread. Node size belongs inside the layout spread section.
- Node size defaults make nodes more readable while preserving important nodes as larger than low-degree nodes.
- Layout spread defaults to `balanced`; custom values allow tuning node size, charge distance min/max, link distance, alpha decay, and velocity decay.
- Reset Focus returns to the global graph view without network reload.
- Refresh Graph reloads graph data, restarts progressive rendering, clears focused state, and shows loading state on the refresh control.
- Loading, node size, and layout spread configuration resets on every Viewer page load.
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
- Move loading configuration into a top-right Graph control settings panel.
- Default progressive loading cadence is 100 nodes every 100ms.
- Add node visual scale configuration inside the layout spread settings. It changes `nodeRelSize()`/visual area, not graph data, edge weight, or edge width. The default value is `1.0x`.
- Keep node size relative to degree-based importance rather than making all nodes equal size.
- Add layout spread presets plus `custom` mode for node size, `charge strength`, `charge distance min`, `charge distance max`, `link distance`, `alpha decay`, and `velocity decay`.
- Make `balanced` the default preset with node size `1.0x`, charge strength `-10`, charge distance min `50`, charge distance max `480`, and link distance `60`; tune `compact`/`spacious` relative to that baseline.
- Add separate Reset Focus and Refresh Graph controls. Reset Focus clears focused state locally; Refresh Graph reloads data and shows loading state.
- Loading, node size, and layout spread configuration resets to defaults on each Viewer page load and is not persisted across Viewer sessions.
- Progressive loading continues while users drag or pan the graph.
- Replace the existing Canvas renderer directly with local `force-graph`.
- Do not change the overall Viewer layout or global color styling. Adjust only graph node type colors to nearby macaron-style web-safe pastel colors because the current node colors are visually poor.

## Open Questions

- None.
