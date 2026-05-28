# Spec: Graph Extraction and Viewer Rebuild Reliability

## Objective

Fix the knowledge graph lifecycle so Viewer users and agent integration users get predictable graph behavior without hidden expensive work.

Target users:

- Viewer users opening the Graph tab to inspect graph nodes and edges.
- Agent integration users using Claude Code, OpenCode, Codex, Qwen, or other hook-based integrations that rely on session lifecycle events.

Core behavior:

- The Graph page must not call a missing endpoint or silently fail with a 404.
- When graph data is empty and graph extraction is enabled, the Viewer asks before building graph data.
- When graph extraction is not enabled, graph endpoints return empty/skipped results and never call the LLM provider.
- `POST /agentmemory/session/end` must drive the existing `event::session::stopped` path so session summary, slot reflection, and graph extraction remain centralized.
- OpenCode should close graph-relevant session boundaries by ending the previous active session when a new session starts and ending the current session when compaction completes.
- Memory retrieval must be verified to use graph information when graph nodes and edges exist.

Acceptance criteria:

- Opening the Graph tab with no graph data no longer automatically starts graph build unless the user confirms and graph extraction is enabled.
- Clicking `Rebuild Graph` opens a second confirmation dialog before any build/rebuild request is sent.
- The `Rebuild Graph` confirmation offers `Incremental` and `Full` options, defaults to `Incremental`, and warns that graph extraction can be expensive because it may invoke the configured LLM provider across many observations.
- `/agentmemory/graph/build` exists and returns a well-formed response instead of 404.
- If graph extraction is disabled, `/agentmemory/graph/query`, `/agentmemory/graph/stats`, `/agentmemory/graph/extract`, and `/agentmemory/graph/build` return empty/skipped graph responses without provider calls.
- `session/end -> event::session::stopped -> mem::graph-extract` is covered by a regression test.
- OpenCode `session.compacted` triggers `/session/end`; `session.created` ends the previous active session before starting the new one when the IDs differ.
- A unit test proves graph data contributes to retrieval scoring/results.

## Tech Stack

- Runtime: Node.js, TypeScript, ESM.
- Backend integration: iii-sdk Worker/Function/Trigger only.
- State: iii-engine StateModule through `StateKV`; no direct SQLite access.
- Viewer: static HTML/CSS/JavaScript in `src/viewer/index.html`.
- Tests: Vitest.

## Commands

- Run targeted tests: `npm test -- --run test/graph.test.ts test/api-session-graph.test.ts`
- Run retrieval tests after adding graph retrieval coverage: `npm test -- --run test/smart-search.test.ts test/graph.test.ts`
- Run consistency checks after endpoint changes: `npm test -- --run test/consistency.test.ts`
- Run full non-integration suite: `npm test`
- Build package: `npm run build`

## Project Structure

- `src/functions/graph.ts` -> graph extraction, query, stats, and build/backfill functions.
- `src/triggers/api.ts` -> REST endpoint registration and request validation.
- `src/triggers/events.ts` -> session stopped subscriber and graph extraction trigger.
- `src/viewer/index.html` -> Graph tab empty state, rebuild confirmation, and graph API calls.
- `plugin/opencode/agentmemory-capture.ts` -> OpenCode session lifecycle mapping.
- `test/graph.test.ts` -> graph function behavior and build/backfill tests.
- `test/api-session-graph.test.ts` -> API regression tests for session end and graph build route.
- `test/smart-search.test.ts` or focused equivalent -> graph participation in retrieval.
- `README.md`, `AGENTS.md`, `src/index.ts` -> endpoint count updates if a REST endpoint is added.

## Code Style

Use minimal TypeScript changes, explicit input whitelisting at REST boundaries, and keep graph lifecycle behavior centralized in existing graph/session functions.

Example style:

```ts
sdk.registerFunction("api::graph-build", async (req: ApiRequest): Promise<Response> => {
  const authErr = checkAuth(req, secret);
  if (authErr) return authErr;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const payload = {
    batchSize: parseOptionalPositiveInt(body.batchSize) ?? undefined,
    reset: body.reset === true,
  };

  const result = await sdk.trigger({
    function_id: "mem::graph-build",
    payload,
  });
  return { status_code: 200, body: result };
});
```

Conventions:

- Do not pass raw REST request bodies to `sdk.trigger()`.
- Capture timestamps once per operation and reuse them.
- Keep graph extraction gated by `GRAPH_EXTRACTION_ENABLED === "true"`.
- Prefer existing helpers such as `parseOptionalPositiveInt`, `checkAuth`, `graphDisabledResponse` or equivalent empty/skipped responses.
- Avoid new abstractions unless multiple call sites need them.

## Testing Strategy

Test levels:

- Unit tests for `mem::graph-build`, `mem::graph-query`, `mem::graph-stats`, and disabled extraction behavior.
- API handler tests for `/session/end` triggering `event::session::stopped` and `/graph/build` forwarding only whitelisted fields.
- Viewer behavior can be covered by static unit-style assertions only if an existing pattern exists; otherwise verify through focused source-level tests and manual browser smoke after implementation.
- OpenCode lifecycle tests should verify emitted REST calls for `session.compacted` and new-session handoff if a plugin test harness exists; otherwise add the smallest test seam needed.
- Retrieval tests must prove graph results are incorporated, preferably by asserting `graphScore > 0` or graph-influenced ranking in `HybridSearch`/`memory_smart_search` behavior.

Regression tests are added per implementation slice so each task starts from a focused red state.

Verification order:

1. Run targeted failing tests before implementation to confirm red state.
2. Implement minimal graph build and session lifecycle fixes.
3. Run targeted graph/API tests until green.
4. Add retrieval/OpenCode tests and run them until green.
5. Run consistency tests after endpoint count updates.
6. Run `npm test` and `npm run build` before declaring done.

## Boundaries

Always:

- Use iii-sdk functions/triggers and `StateKV`; never bypass iii-engine state.
- Validate `GRAPH_EXTRACTION_ENABLED` before any graph extract/build provider call.
- Return empty/skipped graph responses when graph extraction is disabled.
- Require user confirmation before Viewer rebuild starts, with `Incremental` selected by default and `Full` available as an explicit option.
- Warn in the Viewer confirmation that graph build/rebuild can be expensive and slow because it may call the configured LLM provider for many stored observations.
- Keep changes focused on graph/session/OpenCode/viewer behavior and tests.
- Update endpoint counts in `src/index.ts`, `README.md`, and `AGENTS.md` if adding `/agentmemory/graph/build`.

Ask first:

- Adding dependencies.
- Changing persisted data schema or adding new KV scopes.
- Making graph extraction run automatically on OpenCode idle/status events beyond `session.compacted` and new-session handoff.
- Changing the public shape of existing `graph/query`, `graph/stats`, or `graph/extract` responses.
- Making `Full` graph rebuild destructive beyond the confirmed user-selected operation.

Never:

- Call the LLM provider when graph extraction is disabled.
- Automatically start graph build just because the user opened the Graph tab.
- Default rebuild to full/destructive mode.
- Access SQLite files directly or parse `state_store.db` outside iii-engine.
- Remove or skip failing tests to make the suite pass.
- Revert unrelated user or agent changes in the worktree.

## Decisions

- Manual `Rebuild Graph` uses a confirmation dialog with two options: `Incremental` and `Full`. `Incremental` is the default. `Full` is explicit and must be user-selected in the dialog.
- The confirmation dialog must warn that graph extraction can be expensive and slow because it may call the configured LLM provider over many stored observations.
- Disabled graph behavior applies to all graph REST endpoints: `/agentmemory/graph/query`, `/agentmemory/graph/stats`, `/agentmemory/graph/extract`, and `/agentmemory/graph/build`.
- Disabled graph REST endpoints should return HTTP 200 with empty/skipped bodies and must not call the LLM provider.
- Disabled graph response bodies are fixed as:
  - `POST /agentmemory/graph/query`: `{ nodes: [], edges: [], depth: 0, skipped: true, reason: "graph_extraction_disabled" }`
  - `GET /agentmemory/graph/stats`: `{ totalNodes: 0, totalEdges: 0, nodesByType: {}, edgesByType: {}, skipped: true, reason: "graph_extraction_disabled" }`
  - `POST /agentmemory/graph/extract`: `{ success: false, skipped: true, reason: "graph_extraction_disabled", nodesAdded: 0, edgesAdded: 0 }`
  - `POST /agentmemory/graph/build`: `{ success: false, skipped: true, reason: "graph_extraction_disabled", observationsProcessed: 0, nodesAdded: 0, edgesAdded: 0 }`

## Open Questions

- None.
