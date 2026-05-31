# Token input cache rate dropped ~10pp due to per-turn system prompt mutation

**Severity**: Medium (performance degradation, not functional breakage)
**Affected versions**: v0.9.20+ (opencode plugin)
**Environment**: OpenCode + agentmemory MCP + opencode plugin

## Problem

Token input cache rate (prompt caching hit ratio) has dropped by approximately 10 percentage points when using agentmemory via the opencode plugin. The degradation is visible in daily aggregate statistics and accumulates over an entire day of usage.

## Root Cause

The opencode plugin's `experimental.chat.system.transform` hook injects the result of `/agentmemory/enrich` into the **system prompt** on every model request where files have been read or edited (`plugin/opencode/agentmemory-capture.ts:639-656`).

```typescript
// Current behavior — changes system prompt EVERY turn
"experimental.chat.system.transform": async (input, output) => {
  // ...
  const stash = stashFor(sid);
  if (stash.size === 0) return;
  const files = [...stash].slice(0, 10);
  const enrichResult = await postJson("/enrich", { sessionId: sid, files });
  output.system.push(enrichCtx);  // ❌ Mutates system prompt
}
```

### Why this breaks caching

LLM prompt caching (Anthropic-style ephemeral caching) works by matching **prefix blocks** byte-for-byte. The system prompt is the first block sent to the model. When it changes between requests, the entire prefix cache is invalidated:

```
Request 1: system = [base + instructions + context]                  → cached
Request 2: system = [base + instructions + context + enrich(file1)]  → DIFFERENT → cache miss
Request 3: system = [base + instructions + context + enrich(file2)]  → DIFFERENT → cache miss
Request 4: system = [base + instructions + context]                  → matches Request 1 → cache hit
Request 5: system = [base + instructions + context + enrich(file3)]  → DIFFERENT → cache miss
```

The `/agentmemory/enrich` endpoint (`src/functions/enrich.ts`) returns variable content based on the current file stash — it runs `mem::search` (semantic search with file names as queries), `mem::file-context` (cross-session file history), and bug memory matching. Since the agent touches different files each turn, the enrich output differs on every model request where tool calls occur. In practice, nearly every turn produces a tool call, so the cache miss rate is very high.

### Aggravating factors

1. **Default tool visibility**: `AGENTMEMORY_TOOLS` defaults to `"all"` (53 tools) rather than `"core"` (8 tools), making the system prompt prefix larger, which amplifies the token cost per cache miss.

2. **Growing memory data**: As sessions accumulate, the `/agentmemory/context` and `/agentmemory/enrich` responses grow, making the variable portion larger relative to the fixed portion.

3. **Contrast with Claude Code hooks**: On Claude Code, agentmemory injects via `additionalContext` (returned from hook stdout), which appears in the **message stream** as a system reminder — the system prompt remains stable and caching is unaffected. This problem is specific to the opencode plugin's use of `chat.system.transform`.

## Proposed Solution

**Migrate the per-turn `enrich` injection from `experimental.chat.system.transform` to `chat.message`.**

OpenCode's `chat.message` hook allows pushing text parts into the user message before it reaches the LLM, without touching the system prompt:

```typescript
// Proposed change
"chat.message": async (input, output) => {
  const stash = stashFor(sid);
  if (stash.size === 0) return;
  const files = [...stash].slice(0, 10);
  const enrichResult = await postJson("/enrich", { sessionId: sid, files });
  if (enrichCtx) {
    output.parts.push({
      type: "text",
      text: enrichCtx,  // ✅ Injected into message stream, not system prompt
    });
    for (const f of files) stash.delete(f);
  }
}
```

### Why this works

| Mechanism | System prompt | Cache behavior |
|---|---|---|
| `chat.system.transform` (current) | Changes every turn | ❌ Cache miss on every tool turn |
| `chat.message` (proposed) | Never changes within a session | ✅ Cache hits preserved |

The `chat.message` hook fires once per user message (not per model request in the tool-call loop). Content injected via `output.parts.push()` becomes part of the user's message text. The system prompt — the cached prefix — remains byte-identical throughout the session.

### Implementation plan

1. **Move enrich logic** from `experimental.chat.system.transform` (lines 639–656) into `chat.message` (lines 545–574) in `plugin/opencode/agentmemory-capture.ts`.

2. **Keep static injections** in `chat.system.transform`: the `AGENTMEMORY_INSTRUCTIONS` block and the `/agentmemory/context` result (first-turn-only, guarded by `contextInjectedSessions`) — these are stable within a session and do not harm caching.

3. **Remove the per-turn enrich block** from `chat.system.transform` entirely (lines 639–656).

4. **Update version**: bump plugin version (plugin.json, package.json, src/version.ts, etc.) following the project's versioning conventions.

### Alternative considered

Use `experimental.chat.messages.transform` instead of `chat.message`. This hook operates on the full message array, allowing insertion as a standalone system-reminder message between conversation turns, which is closer to Claude Code's `additionalContext` semantics. However, `chat.message` is simpler, already implemented in the plugin, and avoids the need to introduce a new hook handler.

### Side benefits

- **No functional regression**: enrich still runs and injects the same information — only the injection target changes.
- **Reduced token costs**: cache hits mean fewer input tokens billed.
- **Lower latency**: cached requests process faster on the LLM provider side.
- **Feature toggle**: the existing `AGENTMEMORY_INJECT_CONTEXT` env var can be extended to also gate the enrich injection if needed.

## References

- `plugin/opencode/agentmemory-capture.ts:613-656` — `chat.system.transform` hook (current enrich injection)
- `plugin/opencode/agentmemory-capture.ts:545-574` — `chat.message` hook (target for migration)
- `src/functions/enrich.ts` — `mem::enrich` function definition
- `src/mcp/tools-registry.ts:952-960` — `AGENTMEMORY_TOOLS` default setting
- OpenCode plugin API: `chat.message` injects via `output.parts.push()` into message stream; `chat.system.transform` injects via `output.system.push()` into system prompt
