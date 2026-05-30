# Task List: Graph Viewer Performance and Incremental Loading

## Phase 1: Local force-graph Delivery

### Task 1: Add Local force-graph Asset Pipeline

- [x] Add `force-graph` as the approved renderer dependency.
- [x] Copy the local force-graph browser bundle into the Viewer build output.
- [x] Ensure packaged/dist runs can resolve the local browser bundle.
- [x] Confirm Viewer source contains no CDN URL for `force-graph`.

**Acceptance criteria:**

- [x] `force-graph` is declared in package dependencies.
- [x] Build asset copy includes the local force-graph browser bundle.
- [x] No Viewer HTML references `cdn.jsdelivr`, `unpkg`, or other remote graph script origins.

**Verify:**

- [x] `npm run build`

**Files:**

- `package.json`
- `package-lock.json`
- `scripts/copy-build-assets.mjs`

### Task 2: Serve Local Viewer Script Asset Under CSP

- [x] Serve the local force-graph browser script from the Viewer server.
- [x] Update CSP only enough to allow same-origin local script loading.
- [x] Keep CDN script origins and unsafe inline script execution blocked.
- [x] Add/update Viewer security tests for the script route and CSP.

**Acceptance criteria:**

- [x] Local force-graph asset route returns JavaScript content type.
- [x] CSP permits local script loading without allowing CDN origins.
- [x] Existing favicon route and host allowlist behavior still pass.

**Verify:**

- [x] `npm test -- --run test/viewer-security.test.ts`
- [x] `npm run build`

**Files:**

- `src/viewer/server.ts`
- `src/auth.ts`
- `test/viewer-security.test.ts`

## Checkpoint: Local Renderer Asset

- [x] `npm test -- --run test/viewer-security.test.ts`
- [x] `npm run build`
- [x] Confirm no CDN script URL appears in Viewer source.

## Phase 2: Renderer Replacement Shell

### Task 3: Add Viewer Source Tests for Renderer Contract

- [x] Assert the Viewer references local force-graph only.
- [x] Replace obsolete Canvas cooldown expectations with force-graph/progressive-loading expectations.
- [x] Preserve assertions for no automatic graph build.
- [x] Preserve assertions for disabled graph messaging and rebuild confirmation.
- [x] Assert loading control defaults are present.

**Acceptance criteria:**

- [x] Viewer tests describe the new renderer contract.
- [x] No coverage is lost for disabled/no-auto-build behavior.

**Verify:**

- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`

**Files:**

- `test/viewer-graph-empty.test.ts`
- `test/viewer-graph-cooldown.test.ts` or new Viewer graph performance test

### Task 4: Replace Canvas Graph Runtime With force-graph Runtime

- [x] Initialize a local `ForceGraph` instance in the Graph tab.
- [x] Preserve the existing graph container, controls area, sidebar, empty state, disabled state, and rebuild modal flow.
- [x] Wire zoom/recenter controls to force-graph APIs.
- [x] Remove or disable the old custom `O(N^2)` simulation for Graph tab interactions.
- [x] Keep opening the Graph tab from calling `graph/build` automatically.

**Acceptance criteria:**

- [x] Graph tab renders through force-graph.
- [x] Empty and disabled states still render correctly.
- [x] Existing build/rebuild confirmation behavior remains manual.
- [x] Old Canvas simulation is not used for drag/pan/zoom.

**Verify:**

- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [x] Manual smoke: open Graph tab with disabled graph and with graph data.

**Files:**

- `src/viewer/index.html`
- Viewer graph test file(s)

## Checkpoint: Renderer Replacement

- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [x] Manual smoke confirms Graph tab opens and disabled/empty states still work.
- [x] Source review confirms renderer replacement stayed within the intended Graph UI surface.

## Phase 3: Progressive Graph Loading

### Task 5: Add Ordered Graph Query Paging If Needed

- [x] Add optional graph query chunk fields only if the current full payload blocks first interaction.
- [x] Preserve existing graph query behavior when chunk fields are omitted.
- [x] Preserve current node order in paged responses.
- [x] Include metadata for continuing until all nodes are loaded.
- [x] Return edges so the Viewer can dedupe and show them as endpoints become available.
- [x] Whitelist any new REST fields.
- [x] Preserve disabled graph responses.
- [x] Confirm StateKV has no storage-level pagination; Viewer uses one graph snapshot and client-side progressive rendering to avoid repeated full scans.

**Acceptance criteria:**

- [x] There is no final initialization cap; chunks continue until all graph nodes can load.
- [x] Existing unpaged graph query callers remain compatible.
- [x] Disabled graph behavior is unchanged.

**Verify:**

- [x] `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`

**Files:**

- `src/functions/graph.ts`
- `src/triggers/api.ts`
- `test/graph.test.ts`
- `test/api-session-graph.test.ts`

### Task 6: Add Right-Sidebar Loading Configuration and Progressive Loader

- [x] Add sidebar controls for node batch size and interval.
- [x] Default to 100 nodes every 100ms on each Viewer page load.
- [x] Do not persist loading config across Viewer sessions.
- [x] Continue progressive loading while users drag or pan.
- [x] Show loading status without changing the overall layout.
- [x] Feed force-graph progressively while preserving graph data order.
- [x] Finish loading all nodes; do not stop at an initial cap.

**Acceptance criteria:**

- [x] Defaults reset on page reload.
- [x] User-adjusted controls affect subsequent progressive loading cadence in the current page session.
- [x] Loading continues during drag/pan.
- [x] Graph order is preserved.

**Verify:**

- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [x] Manual smoke: set batch/interval, reload page, confirm defaults reset, confirm loading continues during pan/drag.

**Files:**

- `src/viewer/index.html`
- Viewer graph test file(s)

## Checkpoint: Progressive Loading

- [x] `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts` if backend paging was added.
- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [x] Manual smoke confirms progressive loading defaults and sidebar controls.

## Phase 4: Interaction Parity and Hot-Path Cleanup

### Task 7: Restore Graph Selection, Search, Expand, and Filters on force-graph

- [x] Node click selects a node and updates the selected node panel.
- [x] Expand neighbors still calls `graph/query` with `startNodeId`.
- [x] Merge expanded nodes/edges without duplicates.
- [x] Search filters/focuses matching nodes while progressive loading is active.
- [x] Type filters update displayed graph without changing sidebar structure.
- [x] Tooltip and connection counts use cached degree/adjacency data.
- [x] Focus fading uses cached neighbor sets instead of scanning all edges per node.

**Acceptance criteria:**

- [x] Selection, expand, search, clear search, and type filters work on the force-graph renderer.
- [x] Hot paths use cached graph indexes.
- [x] Interactions remain responsive while progressive loading continues.

**Verify:**

- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [x] Manual smoke: select node, expand node, search, clear search, toggle type filter.

**Files:**

- `src/viewer/index.html`
- Viewer graph test file(s)

### Task 8: Apply Macaron Node Type Colors Without Layout/Global Style Changes

- [x] Update only graph node type color values.
- [x] Keep existing node type color families recognizable.
- [x] Apply updated colors to nodes, legend, and filter dots.
- [x] Avoid changing Viewer page layout, sidebar structure, typography, or global CSS variables.
- [x] Verify light and dark mode readability.

**Acceptance criteria:**

- [x] Node type colors use nearby macaron-style web-safe pastel colors.
- [x] Overall Viewer layout and global styling remain unchanged.
- [x] Legend and filter dots match node colors.

**Verify:**

- [x] Source review or source test for no global layout/style rewrite.
- [x] Manual visual smoke in light and dark mode.

**Files:**

- `src/viewer/index.html`
- Viewer graph test file(s), if adding color regression assertions

## Checkpoint: Interaction and Visual Polish

- [x] `npm test -- --run test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts`
- [x] Manual smoke covers selection, search, expand, filters, and node colors.
- [x] Confirm overall layout and global styling stayed unchanged.

## Phase 5: Final Verification

### Task 9: Final Build and Regression Verification

- [x] Run targeted graph/API/Viewer/security tests.
- [x] Run package build.
- [x] Run full non-integration test suite.
- [x] Document any unrelated full-suite failures.
- [x] Manual browser smoke no CDN script, progressive loading, responsive interactions, no automatic graph build.

**Acceptance criteria:**

- [x] Targeted tests pass.
- [x] Build passes.
- [x] Manual smoke confirms success criteria from `docs/SPEC.md`.

**Verify:**

- [x] `npm test -- --run test/viewer-force-graph-asset.test.ts test/viewer-security.test.ts test/viewer-session-id.test.ts test/viewer-graph-empty.test.ts test/viewer-graph-cooldown.test.ts test/graph.test.ts test/api-session-graph.test.ts` passed with 7 files and 60 tests after review fixes.
- [x] `npm run build` passed.
- [x] `npm test` was run; it still fails outside this Graph Viewer work with 12 failed files and 39 failed tests.

**Full-suite failure notes:**

- Existing user config leakage: `C:\Users\Administrator\.qwen\settings.json` and `C:\Users\Administrator\.continue\config.yaml`.
- Environment-sensitive embedding/provider expectations: `OPENAI_BASE_URL` and related OpenAI/Azure shape tests.
- Existing auto-compress/slots env gates and hook idempotency assertions.
- Windows path and symlink/compress-file expectation mismatches.

**Files:** None unless verification reveals a bug.
