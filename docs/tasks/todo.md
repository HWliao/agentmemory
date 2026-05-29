# Task List: Graph Extraction and Viewer Rebuild Reliability

## Phase 1: Backend Graph API Contract

### Task 1: Return Fixed Empty Responses When Graph Extraction Is Disabled

- [x] Implement fixed disabled responses for `graph/query`, `graph/stats`, `graph/extract`, and `graph/build`.
- [x] Register `POST /agentmemory/graph/build`.
- [x] Ensure disabled graph paths do not call `mem::graph-*` provider-backed work.
- [x] Whitelist `graph/build` request fields only.

**Acceptance criteria:**

- [x] `graph/query` disabled response is `{ nodes: [], edges: [], depth: 0, skipped: true, reason: "graph_extraction_disabled" }`.
- [x] `graph/stats` disabled response has zero counts plus `skipped: true` and `reason`.
- [x] `graph/extract` disabled response has `success: false`, zero counts, `skipped: true`, and `reason`.
- [x] `graph/build` disabled response has `success: false`, `observationsProcessed: 0`, zero counts, `skipped: true`, and `reason`.
- [x] `/agentmemory/graph/build` no longer returns 404.

**Verify:**

- [x] `npm test -- --run test/api-session-graph.test.ts`
- [x] `npm test -- --run test/consistency.test.ts`

**Dependencies:** None.

**Files:**

- `src/triggers/api.ts`
- `test/api-session-graph.test.ts`
- `src/index.ts`
- `README.md`
- `AGENTS.md`

### Task 2: Implement Graph Build Backfill From Existing Observations

- [x] Add `mem::graph-build`.
- [x] Collect compressed observations from stored sessions.
- [x] Process observations in batches.
- [x] Support incremental default behavior.
- [x] Support explicit full rebuild with `reset: true`.

**Acceptance criteria:**

- [x] Add a red `graph-build extracts graph data from stored observations` test, then make it pass.
- [x] Build response includes `success`, `observationsProcessed`, `nodesAdded`, and `edgesAdded`.
- [x] Empty observation corpus returns success with zero processed/added counts.
- [x] Existing graph extraction merge behavior remains unchanged.

**Verify:**

- [x] `npm test -- --run test/graph.test.ts`

**Dependencies:** Task 1.

**Files:**

- `src/functions/graph.ts`
- `test/graph.test.ts`

## Checkpoint 1: Backend Graph Contract

- [x] `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- [x] `npm test -- --run test/consistency.test.ts`
- [x] Review disabled graph response bodies before continuing.

## Phase 2: Session Lifecycle Extraction

### Task 3: Route Session End Through Session Stopped Recovery

- [x] Update `/agentmemory/session/end` to trigger `event::session::stopped`.
- [x] Preserve session status update to `completed` with `endedAt`.
- [x] Keep `/summarize` endpoint behavior unchanged.

**Acceptance criteria:**

- [x] `/session/end` validates `sessionId` as before.
- [x] `/session/end` triggers `event::session::stopped` with `{ sessionId }`.
- [x] Regression test proves stopped-session recovery work is invoked.

**Verify:**

- [x] `npm test -- --run test/api-session-graph.test.ts`

**Dependencies:** Task 1.

**Files:**

- `src/triggers/api.ts`
- `test/api-session-graph.test.ts`

## Phase 3: Viewer Graph UX

### Task 4: Replace Automatic Empty Graph Build With Confirmed Build Prompt

- [x] Remove automatic `apiPost('graph/build', {})` from `loadGraph()`.
- [x] Render an empty state when graph has no nodes.
- [x] Show disabled/skipped messaging when graph APIs return disabled response bodies.
- [x] Provide a user-initiated build action in empty state.

**Acceptance criteria:**

- [x] Opening Graph tab never starts graph build without confirmation.
- [x] Empty state explains graph extraction is optional and may be expensive.
- [x] Disabled graph state does not suggest that data is actively building.

**Verify:**

- [x] Source check: `loadGraph()` does not directly call `apiPost('graph/build', {})`.
- [ ] Manual smoke: open Graph tab with no graph data.

**Dependencies:** Tasks 1 and 2.

**Files:**

- `src/viewer/index.html`

### Task 5: Add Rebuild Modal With Incremental and Full Options

- [x] Add modal flow for `Rebuild Graph`.
- [x] Add `Incremental` option as the default.
- [x] Add explicit `Full` option.
- [x] Add warning text that extraction can be expensive and slow because it may call the configured LLM provider.
- [x] Send `reset: false` or omit reset for incremental.
- [x] Send `reset: true` for full.

**Acceptance criteria:**

- [x] Clicking `Rebuild Graph` opens modal before any API call.
- [x] Cancel and overlay close make no API call.
- [x] Incremental is selected by default.
- [x] Full is not selected unless the user explicitly selects it.

**Verify:**

- [x] Source check for `confirm-rebuild-graph` or equivalent action.
- [ ] Manual smoke: cancel, incremental confirm, full confirm.

**Dependencies:** Task 4.

**Files:**

- `src/viewer/index.html`

## Checkpoint 2: Backend and Viewer Flow

- [ ] `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- [ ] Manual smoke Graph tab empty state.
- [ ] Manual smoke Rebuild modal.

## Phase 4: OpenCode Lifecycle Parity

### Task 6: End Previous OpenCode Session On New Session Creation

- [x] Detect previous `activeSessionId` before assigning the new session ID.
- [x] If previous ID exists and differs from the new ID, post `/session/end` for the previous ID.
- [x] Continue to start and cache context for the new session.

**Acceptance criteria:**

- [x] New `session.created` for a different ID ends old session first.
- [x] Same ID does not trigger self-end.
- [x] Existing start context cache behavior remains intact.

**Verify:**

- [x] `npm test -- --run test/opencode-auto-context.test.ts`
- [ ] Or run a new focused OpenCode lifecycle test if added.

**Dependencies:** Task 3.

**Files:**

- `plugin/opencode/agentmemory-capture.ts`
- `test/opencode-auto-context.test.ts` or new focused test

### Task 7: End OpenCode Session On Compaction

- [x] Update `session.compacted` handler to post `/session/end` for current session.
- [x] Preserve existing summarize and observe behavior unless implementation proves summarize becomes redundant.
- [x] Do not call graph endpoints directly from OpenCode.

**Acceptance criteria:**

- [x] `session.compacted` posts `/session/end`.
- [x] `session_compacted` observation is still recorded.
- [x] Backend remains the only graph extraction trigger.

**Verify:**

- [x] `npm test -- --run test/opencode-auto-context.test.ts`
- [ ] Or run a new focused OpenCode lifecycle test if added.

**Dependencies:** Task 3.

**Files:**

- `plugin/opencode/agentmemory-capture.ts`
- `test/opencode-auto-context.test.ts` or new focused test

## Phase 5: Retrieval Verification

### Task 8: Prove Hybrid Search Uses Graph Results

- [x] Add graph nodes and edges to test KV.
- [x] Store matching compressed observation.
- [x] Search for an entity that matches graph data.
- [x] Assert returned result has `graphScore > 0` or graph context.

**Acceptance criteria:**

- [x] Test is deterministic and does not require LLM/network.
- [x] Graph result participates in `HybridSearch` result scoring.
- [x] Existing BM25-only tests continue passing.

**Verify:**

- [x] `npm test -- --run test/hybrid-search.test.ts`

**Dependencies:** None.

**Files:**

- `test/hybrid-search.test.ts`

## Phase 6: Final Consistency and Verification

### Task 9: Update Endpoint Counts and Key Endpoint Docs

- [x] Update `src/index.ts` REST endpoint count.
- [x] Update `README.md` endpoint count.
- [x] Update `AGENTS.md` REST endpoint count.
- [x] Add `/agentmemory/graph/build` to key endpoint docs if appropriate.

**Acceptance criteria:**

- [x] `test/consistency.test.ts` passes.
- [x] README and AGENTS counts match `src/triggers/api.ts`.

**Verify:**

- [x] `npm test -- --run test/consistency.test.ts`

**Dependencies:** Task 1.

**Files:**

- `src/index.ts`
- `README.md`
- `AGENTS.md`

### Task 10: Final Verification

- [ ] Run targeted graph/API tests.
- [ ] Run retrieval and OpenCode tests.
- [ ] Run consistency tests.
- [ ] Run full non-integration test suite.
- [ ] Run build.

**Acceptance criteria:**

- [ ] All targeted tests pass.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.

**Verify:**

- [ ] `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- [ ] `npm test -- --run test/hybrid-search.test.ts test/opencode-auto-context.test.ts test/consistency.test.ts`
- [ ] `npm test`
- [ ] `npm run build`

**Dependencies:** Tasks 1-9.

**Files:** None unless verification reveals issues.

## Human Review Checkpoint

- [ ] Confirm task order.
- [ ] Confirm `Full` rebuild semantics are acceptable when explicitly selected.
- [ ] Confirm OpenCode compaction should preserve current summarize call plus session end.
- [ ] Confirm implementation may proceed.
