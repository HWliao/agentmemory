# Implementation Plan: Graph Extraction and Viewer Rebuild Reliability

## Overview

This plan implements the approved `docs/SPEC.md` for graph extraction reliability, Viewer rebuild behavior, session lifecycle extraction, OpenCode lifecycle parity, and graph-aware retrieval verification. Implementation must stay focused on graph/session/OpenCode/viewer behavior and tests.

## Plan Mode Notes

- Planning source: `docs/SPEC.md`.
- Current branch: `dev_local`.
- Red tests are added per task to keep each slice focused and independently verifiable.
- This plan intentionally does not implement code.

## Dependency Graph

```text
Config contract: GRAPH_EXTRACTION_ENABLED
  -> Disabled graph response shapes
  -> Graph REST endpoint behavior

Graph function contract
  -> mem::graph-extract
  -> mem::graph-build
  -> mem::graph-query / mem::graph-stats
  -> API /graph/* endpoints
  -> Viewer Graph tab and Rebuild flow

Session lifecycle contract
  -> POST /agentmemory/session/end
  -> event::session::stopped
  -> mem::summarize
  -> mem::graph-extract when GRAPH_EXTRACTION_ENABLED=true
  -> Claude/Codex/Qwen hook compatibility
  -> OpenCode session boundary behavior

OpenCode lifecycle mapping
  -> session.created ends previous active session when ID changes
  -> session.compacted ends current session
  -> backend session/end triggers stopped graph extraction

Retrieval validation
  -> Graph KV nodes/edges exist
  -> GraphRetrieval returns matching observations
  -> HybridSearch includes graphScore / graphContext
  -> memory_smart_search behavior remains graph-aware

Endpoint count documentation
  -> src/triggers/api.ts adds /graph/build
  -> src/index.ts endpoint count
  -> README.md endpoint count
  -> AGENTS.md endpoint count
  -> test/consistency.test.ts verifies counts
```

## Architecture Decisions

- Disabled graph behavior is handled at REST boundaries for all graph endpoints, because `mem::graph-*` functions are only registered when `GRAPH_EXTRACTION_ENABLED=true` in `src/index.ts`.
- `mem::graph-build` is a graph backfill function that processes existing compressed observations through existing `mem::graph-extract` semantics rather than duplicating extraction logic.
- Viewer graph build/rebuild is user-confirmed. Empty Graph tab does not silently build; Rebuild uses a modal with `Incremental` default and `Full` explicit selection.
- `POST /session/end` is the single backend entry point that invokes `event::session::stopped`. This preserves existing session stopped logic for summarize, slot reflect, and graph extraction.
- OpenCode should not trigger graph extraction on every idle event. It should end sessions on `session.compacted` and when a new session starts while another session is active.
- Retrieval work is verification-first. The intended code path already exists through `HybridSearch -> GraphRetrieval`; tests should prove it with graph KV data.

## Vertical Slices

Tasks are ordered so each slice leaves a usable path working end-to-end:

1. Disabled graph API contract plus `/graph/build` route skeleton.
2. Graph build from existing observations.
3. Session end lifecycle trigger.
4. Viewer Graph UX and confirmation.
5. OpenCode lifecycle parity.
6. Retrieval graph participation test.
7. Endpoint count/docs consistency and final verification.

## Phase 1: Backend Graph API Contract

### Task 1: Return Fixed Empty Responses When Graph Extraction Is Disabled

**Description:** Make all graph REST endpoints return the approved HTTP 200 empty/skipped bodies when graph extraction is disabled or graph functions are unavailable.

**Acceptance criteria:**

- `/agentmemory/graph/query` returns `{ nodes: [], edges: [], depth: 0, skipped: true, reason: "graph_extraction_disabled" }` when disabled.
- `/agentmemory/graph/stats` returns zero counts plus `skipped: true` and `reason` when disabled.
- `/agentmemory/graph/extract` returns `success: false`, zero counts, `skipped: true`, and `reason` when disabled.
- `/agentmemory/graph/build` is registered and returns the fixed disabled build body when disabled.
- No disabled graph path calls the LLM provider.

**Verification:**

- Run `npm test -- --run test/api-session-graph.test.ts` after tests are updated for disabled responses.
- Run `npm test -- --run test/consistency.test.ts` after endpoint count updates.

**Dependencies:** None.

**Files likely touched:**

- `src/triggers/api.ts`
- `test/api-session-graph.test.ts`
- `src/index.ts`
- `README.md`
- `AGENTS.md`

**Estimated scope:** Medium.

### Task 2: Implement Graph Build Backfill From Existing Observations

**Description:** Add `mem::graph-build` to process existing compressed observations in batches through existing graph extraction logic.

**Acceptance criteria:**

- `mem::graph-build` exists when graph extraction is enabled.
- Incremental mode processes stored observations and merges extracted graph nodes/edges.
- Full mode is supported via explicit `reset: true` from API/UI, with non-default behavior.
- Empty corpora return success with zero processed/added counts.
- Build response includes `success`, `observationsProcessed`, `nodesAdded`, and `edgesAdded`.

**Verification:**

- Run `npm test -- --run test/graph.test.ts`.
- Add a red test for `graph-build extracts graph data from stored observations`, then make it pass.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/functions/graph.ts`
- `test/graph.test.ts`

**Estimated scope:** Medium.

## Checkpoint: Backend Graph Contract

- `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- `npm test -- --run test/consistency.test.ts`
- Confirm disabled graph APIs are HTTP 200 and do not invoke provider.

## Phase 2: Session Lifecycle Extraction

### Task 3: Route Session End Through Session Stopped Recovery

**Description:** Make `POST /agentmemory/session/end` update session status and trigger `event::session::stopped` so summary, slot reflect, and graph extraction use the existing stopped-session pipeline.

**Acceptance criteria:**

- `/session/end` still validates `sessionId` and marks the session completed.
- `/session/end` triggers `event::session::stopped` with `{ sessionId }`.
- Existing direct summarize behavior remains available through `/summarize`.
- The regression test proves `event::session::stopped` is invoked.

**Verification:**

- Run `npm test -- --run test/api-session-graph.test.ts`.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/triggers/api.ts`
- `test/api-session-graph.test.ts`

**Estimated scope:** Small.

## Phase 3: Viewer Graph UX

### Task 4: Replace Automatic Empty Graph Build With Confirmed Build Prompt

**Description:** Update the Graph tab so empty graph data shows a prompt instead of automatically calling `graph/build`.

**Acceptance criteria:**

- Opening the Graph tab with no graph data does not call `graph/build` automatically.
- Empty state explains that graph extraction is optional and may be expensive.
- If graph responses are disabled/skipped, the Viewer shows an appropriate disabled/empty message.
- A build action is available from the empty state.

**Verification:**

- Static/source verification in `src/viewer/index.html` that `loadGraph()` no longer calls `apiPost('graph/build', {})` directly.
- Manual browser smoke after implementation if feasible.

**Dependencies:** Tasks 1 and 2.

**Files likely touched:**

- `src/viewer/index.html`

**Estimated scope:** Small.

### Task 5: Add Rebuild Modal With Incremental and Full Options

**Description:** Require a second confirmation for rebuild, default to incremental, and allow explicit full rebuild.

**Acceptance criteria:**

- Clicking `Rebuild Graph` opens a modal before any API call.
- Modal defaults to `Incremental`.
- Modal provides `Full` as an explicit user-selected option.
- Modal warns the operation can be expensive and slow because it may call the configured LLM provider for many observations.
- Confirming incremental calls `graph/build` with `reset: false` or omitted false semantics.
- Confirming full calls `graph/build` with `reset: true`.
- Cancel/overlay close makes no API call.

**Verification:**

- Static/source verification in `src/viewer/index.html` for `confirm-rebuild-graph` action and modal options.
- Manual browser smoke after implementation if feasible.

**Dependencies:** Task 4.

**Files likely touched:**

- `src/viewer/index.html`

**Estimated scope:** Small.

## Checkpoint: Backend and Viewer Flow

- `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- Manual check: open Graph tab, verify no automatic build, verify modal options, verify disabled message.

## Phase 4: OpenCode Lifecycle Parity

### Task 6: End Previous OpenCode Session On New Session Creation

**Description:** When OpenCode emits `session.created` for a new ID while a different session is active, send `/session/end` for the old session before starting the new one.

**Acceptance criteria:**

- New session with a different ID ends the previous active session.
- Same session ID does not self-end.
- Existing context cache and session state setup still run for the new session.
- Session cleanup maps are not cleared for the new session accidentally.

**Verification:**

- Add/update OpenCode plugin test using current static test style or a minimal harness.
- Run `npm test -- --run test/opencode-auto-context.test.ts` or the new focused OpenCode test file.

**Dependencies:** Task 3.

**Files likely touched:**

- `plugin/opencode/agentmemory-capture.ts`
- `test/opencode-auto-context.test.ts` or new focused test

**Estimated scope:** Small.

### Task 7: End OpenCode Session On Compaction

**Description:** Update OpenCode `session.compacted` handling so compaction ends the current session and lets backend stopped-session extraction run.

**Acceptance criteria:**

- `session.compacted` posts `/session/end` for the active session.
- Existing compaction observation capture remains intact.
- No graph extraction is triggered directly from OpenCode; backend remains responsible.

**Verification:**

- Add/update OpenCode plugin test.
- Run `npm test -- --run test/opencode-auto-context.test.ts` or the new focused OpenCode test file.

**Dependencies:** Task 3.

**Files likely touched:**

- `plugin/opencode/agentmemory-capture.ts`
- `test/opencode-auto-context.test.ts` or new focused test

**Estimated scope:** Small.

## Phase 5: Retrieval Verification

### Task 8: Prove Hybrid Search Uses Graph Results

**Description:** Add a focused unit test proving graph nodes/edges in KV influence retrieval through `GraphRetrieval` and `HybridSearch`.

**Acceptance criteria:**

- Test stores a compressed observation plus graph node/edge data pointing to it.
- Search query extracts a graph-matching entity.
- Result includes the observation with `graphScore > 0` or graph context.
- Test does not require an LLM provider or network.

**Verification:**

- Run `npm test -- --run test/hybrid-search.test.ts`.

**Dependencies:** None, but should be run after backend graph work to catch regressions.

**Files likely touched:**

- `test/hybrid-search.test.ts`

**Estimated scope:** Small.

## Phase 6: Final Consistency and Documentation

### Task 9: Update Endpoint Counts and Key Endpoint Docs

**Description:** Keep repository consistency checks passing after adding `/agentmemory/graph/build`.

**Acceptance criteria:**

- `src/index.ts` REST endpoint count matches registered API paths.
- `README.md` endpoint count matches registered API paths.
- `AGENTS.md` current stats endpoint count matches registered API paths.
- Key endpoints include `/agentmemory/graph/build` if appropriate.

**Verification:**

- Run `npm test -- --run test/consistency.test.ts`.

**Dependencies:** Task 1.

**Files likely touched:**

- `src/index.ts`
- `README.md`
- `AGENTS.md`

**Estimated scope:** Small.

### Task 10: Final Verification

**Description:** Run targeted and broad checks after all behavior is implemented.

**Acceptance criteria:**

- Targeted graph/API tests pass.
- Retrieval test passes.
- OpenCode lifecycle tests pass.
- Consistency tests pass.
- Full non-integration suite passes.
- Build succeeds.

**Verification:**

- `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- `npm test -- --run test/hybrid-search.test.ts test/opencode-auto-context.test.ts test/consistency.test.ts`
- `npm test`
- `npm run build`

**Dependencies:** Tasks 1-9.

**Files likely touched:** None unless verification reveals a bug.

**Estimated scope:** Small.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---:|---|
| Full graph rebuild could be destructive or expensive | High | Default to incremental, require explicit Full selection, warn in modal. |
| Disabled graph APIs accidentally call provider | High | Return fixed disabled bodies at REST boundary before extract/build. |
| `/session/end` double-summarizes because Stop hook also calls `/summarize` | Medium | Keep behavior centralized and verify idempotence expectations in tests; do not add another direct graph call. |
| OpenCode new-session handoff ends an already-ended session | Medium | Only end when previous active session ID exists and differs from new ID. |
| Graph build scans too many observations in one provider call | Medium | Batch observations using configured/default batch size. |
| Viewer static JS is hard to test | Medium | Keep UI change minimal and verify source behavior plus manual smoke. |

## Parallelization Opportunities

- Task 8 retrieval test can be implemented independently after reading existing `HybridSearch` tests.
- Task 9 docs/count updates should wait until Task 1 endpoint registration lands.
- Tasks 6 and 7 can be implemented together because they touch the same OpenCode lifecycle block.

## Open Questions

- None. SPEC decisions are complete.
