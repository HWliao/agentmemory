# Implementation Plan: Graph Viewer Performance and Incremental Loading

## Overview

This plan implements `docs/SPEC.md` for Graph Viewer performance. The work replaces the current hand-written Canvas force simulation with a local `force-graph` renderer, keeps graph ordering unchanged, progressively loads/render nodes at the default cadence of 100 nodes per 100ms, adds right-sidebar loading controls, preserves disabled/no-auto-build behavior, and limits visual changes to graph node type colors.

## Plan Mode Notes

- Planning source: `docs/SPEC.md`.
- Code read during planning:
  - `src/viewer/index.html` graph loading/rendering/interaction implementation.
  - `src/functions/graph.ts` `mem::graph-query` behavior.
  - `src/triggers/api.ts` graph REST handlers.
  - `src/auth.ts` Viewer CSP.
  - `src/viewer/server.ts` static Viewer serving pattern.
  - `scripts/copy-build-assets.mjs` build asset copy path.
  - Viewer/API/security tests under `test/`.
- This plan intentionally does not implement code.

## Dependency Graph

```text
force-graph dependency
  -> local viewer asset copied for source/dist runs
  -> viewer server route serves local asset
  -> CSP allows local script without CDN
  -> Viewer can load force-graph safely
  -> Canvas renderer can be replaced
  -> progressive loading scheduler can feed force-graph
  -> cached indexes support search/select/expand/tooltips
  -> macaron node colors apply through force-graph paint hooks

graph/query compatibility
  -> optional offset/limit chunk fields if frontend needs paged payloads
  -> REST whitelisting for any new fields
  -> StateKV currently exposes full-list reads only, so Viewer uses one graph snapshot and client-side progressive rendering

existing graph reliability behavior
  -> disabled graph responses preserved
  -> opening Graph tab still never calls graph/build automatically
  -> rebuild confirmation remains manual and unchanged
```

## Architecture Decisions

- Replace the current Canvas force simulation directly with local `force-graph`; do not maintain two active renderers beyond transitional code in a single slice.
- Do not use a CDN. `force-graph` must be installed and served/copied as a local Viewer asset or bundled into local Viewer assets.
- Progressive loading has no final initialization cap. It advances through all graph nodes in current backend order, defaulting to 100 nodes every 100ms.
- Right-sidebar loading configuration is session-local only. It resets to defaults on each Viewer page load.
- Progressive loading continues while users drag or pan.
- Preserve current overall Viewer layout, sidebar structure, typography, and global color styling.
- Only graph node type colors may change, and they should remain near the existing type color families using macaron-style web-safe pastel colors.
- StateKV currently exposes `list(scope)` as a full-array read with no storage-level offset/range scan. Keep optional graph query paging compatible for API callers, but the Viewer should avoid repeated paged requests and progressively render a single loaded graph snapshot on the client.

## Vertical Slices

1. Local renderer asset path works end-to-end: dependency, copied/served asset, CSP, tests.
2. Graph tab renders with `force-graph` while preserving existing empty/disabled/build/rebuild behavior.
3. Graph data progressively loads in configurable chunks using current order.
4. Graph interactions are restored on top of the new renderer with cached indexes.
5. Node color polish and final verification complete the feature.

## Phase 1: Local force-graph Delivery

### Task 1: Add Local force-graph Asset Pipeline

**Description:** Add `force-graph` as the approved renderer dependency and make its browser bundle available to the Viewer build output without using a CDN.

**Acceptance criteria:**

- `force-graph` is declared in package dependencies.
- Build asset copy includes the local force-graph browser bundle in the Viewer output.
- The asset path works for packaged/dist runs.
- No Viewer HTML references a CDN for `force-graph`.

**Verification:**

- `npm run build`
- Source check: no `cdn.jsdelivr`, `unpkg`, or remote `force-graph` script URL in `src/viewer/index.html`.

**Dependencies:** None.

**Files likely touched:**

- `package.json`
- `package-lock.json`
- `scripts/copy-build-assets.mjs`

**Estimated scope:** Small.

### Task 2: Serve Local Viewer Script Asset Under CSP

**Description:** Update the Viewer server and CSP so the local force-graph browser script can be loaded safely from the same origin in both source and dist contexts.

**Acceptance criteria:**

- Viewer server serves the local force-graph asset with a JavaScript content type and cache header.
- Viewer CSP permits the local script without allowing CDN script origins or unsafe inline script execution.
- Existing favicon and host allowlist behavior remains unchanged.
- Security tests cover the new local script allowance/route.

**Verification:**

- `npm test -- --run test/viewer-security.test.ts`
- `npm run build`

**Dependencies:** Task 1.

**Files likely touched:**

- `src/viewer/server.ts`
- `src/auth.ts`
- `test/viewer-security.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Local Renderer Asset

- [ ] `npm test -- --run test/viewer-security.test.ts`
- [ ] `npm run build`
- [ ] Confirm no CDN script URL appears in Viewer source.

## Phase 2: Renderer Replacement Shell

### Task 3: Add Viewer Source Tests for Renderer Contract

**Description:** Convert/add Viewer source tests so they assert the new force-graph contract instead of the old Canvas simulation cooldown contract.

**Acceptance criteria:**

- Tests assert Viewer references local force-graph only.
- Tests assert old full `runSimulation()`/`wakeGraphSim()` interaction expectations are no longer the contract.
- Tests keep existing guarantees: no automatic graph build and disabled graph messaging remains.
- Tests assert loading controls defaults exist in source or rendered sidebar code.

**Verification:**

- `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`

**Dependencies:** Tasks 1-2 for final green state; can be written before implementation.

**Files likely touched:**

- `test/viewer-graph-empty.test.ts`
- `test/viewer-graph-cooldown.test.ts` or a new focused Viewer graph performance test

**Estimated scope:** Small.

### Task 4: Replace Canvas Graph Runtime With force-graph Runtime

**Description:** Replace the current Graph tab canvas simulation/runtime with a `force-graph` instance while preserving the existing Graph tab container, controls area, sidebar, empty state, disabled state, and rebuild modal behavior.

**Acceptance criteria:**

- Graph tab initializes a local `ForceGraph` instance.
- Existing Graph tab layout and sidebar structure are preserved.
- Empty and disabled graph states render as before.
- Opening Graph tab still calls graph query/stats but never calls graph/build automatically.
- Zoom/recenter controls are wired to force-graph APIs.
- Old `O(N^2)` custom force simulation is removed or no longer used for Graph tab interactions.

**Verification:**

- `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- Manual smoke: open Graph tab with graph disabled and with graph data.

**Dependencies:** Tasks 1-3.

**Files likely touched:**

- `src/viewer/index.html`
- Viewer graph test file(s)

**Estimated scope:** Medium.

## Checkpoint: Renderer Replacement

- [ ] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [ ] Manual smoke confirms Graph tab still opens and disabled/empty states still work.
- [ ] Human review before progressive loading if renderer replacement changes more UI than intended.

## Phase 3: Progressive Graph Loading

### Task 5: Add Ordered Graph Query Paging If Needed

**Description:** If the current full graph payload blocks first interaction, extend `graph/query` with optional paging fields that preserve the existing node order. Because the current StateKV interface has no storage-level pagination, the Viewer must not request many paged slices that each rescan the whole store; it should load one graph snapshot and progressively render it client-side.

**Acceptance criteria:**

- Optional chunk fields preserve existing behavior when omitted.
- Paged responses preserve the same node order as current unpaged graph query.
- Response includes enough metadata for the Viewer to continue loading until all nodes are loaded.
- Edges are returned in a way that lets the Viewer deduplicate and show edges as endpoints become available.
- REST handler whitelists any new fields instead of passing raw request bodies.
- Disabled graph behavior remains unchanged.

**Verification:**

- `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`

**Dependencies:** Task 4.

**Files likely touched:**

- `src/functions/graph.ts`
- `src/triggers/api.ts`
- `test/graph.test.ts`
- `test/api-session-graph.test.ts`

**Estimated scope:** Medium.

### Task 6: Add Right-Sidebar Loading Configuration and Progressive Loader

**Description:** Add session-local loading controls in the existing right sidebar and feed graph nodes from the loaded graph snapshot into force-graph progressively using the configured batch size and interval.

**Acceptance criteria:**

- Right sidebar exposes node batch size and interval controls.
- Defaults are 100 nodes and 100ms on every Viewer page load.
- Loading config is not persisted across Viewer sessions.
- Progressive loading continues while users drag or pan.
- Loading status is visible without changing the overall layout.
- Progressive loading preserves graph data order.
- Loading can complete all graph nodes; there is no final initial cap.

**Verification:**

- `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- Manual smoke: set batch/interval, reload page, confirm defaults reset, confirm loading continues during pan/drag.

**Dependencies:** Task 4 and Task 5 if backend paging is implemented.

**Files likely touched:**

- `src/viewer/index.html`
- Viewer graph test file(s)

**Estimated scope:** Medium.

## Checkpoint: Progressive Loading

- [ ] `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts` if backend paging was added.
- [ ] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [ ] Manual smoke confirms progressive loading defaults and sidebar controls.

## Phase 4: Interaction Parity and Hot-Path Cleanup

### Task 7: Restore Graph Selection, Search, Expand, and Filters on force-graph

**Description:** Rebuild existing graph interactions on top of force-graph while using cached indexes for hot paths.

**Acceptance criteria:**

- Node click selects a node and updates the selected node panel.
- Expand neighbors still calls `graph/query` with `startNodeId` and merges new nodes/edges without duplicates.
- Search filters/focuses matching nodes without requiring a blocking full redraw or full edge scans per pointer frame.
- Type filters update the displayed graph without changing sidebar structure.
- Tooltip/connection counts use cached degree or adjacency data.
- Focus fading uses cached neighbor sets rather than scanning all edges for each node.

**Verification:**

- `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- Manual smoke: select node, expand node, search, clear search, toggle type filter.

**Dependencies:** Task 6.

**Files likely touched:**

- `src/viewer/index.html`
- Viewer graph test file(s)

**Estimated scope:** Medium.

### Task 8: Apply Macaron Node Type Colors Without Layout/Global Style Changes

**Description:** Update graph node type colors to nearby macaron-style web-safe pastel colors while preserving the overall Viewer layout and global color system.

**Acceptance criteria:**

- Only graph node type color values are changed.
- Existing node type color families remain recognizable.
- Legend/filter dots use the updated node colors.
- No changes are made to Viewer page layout, sidebar structure, typography, or global CSS variables.
- Dark/light mode remains readable.

**Verification:**

- Source review or source test confirms global layout/style selectors are not rewritten.
- Manual visual smoke in light and dark mode.

**Dependencies:** Task 7.

**Files likely touched:**

- `src/viewer/index.html`
- Viewer graph test file(s), if adding color regression assertions

**Estimated scope:** Small.

## Checkpoint: Interaction and Visual Polish

- [ ] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [ ] Manual smoke covers selection, search, expand, filters, and node colors.
- [ ] Confirm overall layout and global styling stayed unchanged.

## Phase 5: Final Verification

### Task 9: Final Build and Regression Verification

**Description:** Run targeted and broad verification after renderer replacement, progressive loading, interactions, and color polish are complete.

**Acceptance criteria:**

- Graph/API/Viewer targeted tests pass.
- Viewer security tests pass.
- Build succeeds.
- Full non-integration suite is run and any unrelated failures are documented.
- Manual browser smoke confirms no CDN script, progressive loading, interaction responsiveness, and no automatic graph build.

**Verification:**

- `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts test/viewer-security.test.ts`
- `npm run build`
- `npm test`

**Dependencies:** Tasks 1-8.

**Files likely touched:** None unless verification reveals a bug.

**Estimated scope:** Small.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| `force-graph` browser bundle cannot be served under current CSP | High | Add only same-origin script allowance and a dedicated local asset route; keep CDN blocked. |
| Progressive backend paging complicates edge delivery | Medium | Return edges touching each node batch and deduplicate/store pending edges in Viewer until endpoints exist. |
| Replacing renderer changes layout or visual language | Medium | Preserve existing container/sidebar HTML and limit style changes to node colors. |
| Existing cooldown tests become obsolete | Medium | Replace them with force-graph/progressive-loading source assertions rather than deleting coverage. |
| Loading continues during drag and causes frame drops | Medium | Keep batch size/interval configurable and feed force-graph in small chunks; avoid reheat on every chunk if possible. |
| Full `npm test` may include unrelated environment-sensitive failures | Low | Run targeted suites as acceptance gates and document unrelated full-suite failures if they persist. |

## Parallelization Opportunities

- Tasks 1 and 3 can be prepared in parallel after the plan is approved.
- Task 5 backend paging can be developed in parallel with Task 4 only if the graph query contract is agreed first.
- Task 8 color polish can be prepared after Task 4 establishes the new node paint path.

## Open Questions

- None. SPEC decisions are complete.
