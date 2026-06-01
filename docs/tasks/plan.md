# Implementation Plan: 优化 agentmemory 上下文注入点

## Overview

重构 agentmemory OpenCode plugin 的上下文注入策略：将 enrich 注入从 `chat.system.transform`（per-step 破坏 LLM cache）迁移至 `chat.messages.transform`（per-step 消息流），context 注入保持在 `chat.system.transform` 仅首 turn。通过三层开关模型（master + context/enrich 子开关）控制所有注入行为。开关值由后台 `/config/flags` 下发，plugin 启动时获取。

## Architecture Decisions

- **开关集中在后台管理**: plugin 不读本地 `process.env`，通过 `GET /agentmemory/config/flags` 获取后台计算好的开关值。确保 `.env` 是唯一配置源。
- **子开关隐式 ON**: Master ON 时 CONTEXT/ENRICH 默认 ON，除非显式设为 `=false`。后台在 `getInjectionConfig()` 中计算，plugin 直接消费。
- **去重用字符串比较**: `fingerprintId` 无法在 plugin 侧导入，改用 Map 存储上次 enrich 内容直接 `===` 比较。
- **Compaction 无需额外处理**: 现有 `session.compacted` 中已调用 `contextInjectedSessions.delete(sid)`，新 session 首 turn 自动重新注入 context。

## Dependency Graph

```
src/config.ts                   ← 独立，无依赖
    │
    └── src/triggers/api.ts     ← 依赖 config.ts exports
            │
            └── plugin/opencode/agentmemory-capture.ts  ← 依赖 API 端点可用
                    │
                    ├── src/index.ts                    ← 依赖新 config exports
                    │
                    ├── test/config-injection.test.ts   ← 依赖 config.ts exports
                    └── test/opencode-auto-context.test.ts ← 依赖 plugin 代码
```

## Task List

### Phase 1: Backend Foundation

- [ ] **Task 1**: Config functions + API injection field
  - `src/config.ts`: add `isContextContextEnabled()`, `isContextEnrichEnabled()`, `getInjectionConfig()`
  - `src/triggers/api.ts`: add `injection` field to `/config/flags` response
  - `src/index.ts`: import new functions, update log message

### Checkpoint: Backend
- [ ] Config functions return correct values for all env var combinations
- [ ] `POST /config/flags` responds with `injection: { enabled, context, enrich }`
- [ ] Existing 950+ tests still pass

### Phase 2: Plugin Refactor

- [ ] **Task 2**: Plugin — fetch config, remove enrich from system.transform, add messages.transform
  - Fetch injection config from backend at plugin startup
  - Remove per-step enrich from `chat.system.transform` (L639-655)
  - Gate context injection by `injectContext` in `chat.system.transform`
  - Add `experimental.chat.messages.transform` hook with enrich logic
  - Gate enrich by `injectEnrich`, dedup by string comparison
  - Inject into `output.messages` (synthetic user message)

### Checkpoint: Plugin
- [ ] Plugin builds without type errors
- [ ] system.transform only injects context (gated by injectContext), no enrich code present
- [ ] messages.transform exists, injects enrich (gated by injectEnrich), only passes stash files
- [ ] Existing plugin behavior (telemetry, stash, observe) unchanged

### Phase 3: Testing

- [ ] **Task 3**: Tests for config, API, and plugin injection behavior
  - `test/config-injection.test.ts`: test `isContextContextEnabled`, `isContextEnrichEnabled`, `getInjectionConfig` for all env combinations
  - `test/api-config.test.ts`: test `/config/flags` returns `injection` field
  - `test/opencode-auto-context.test.ts`: update existing plugin assertions, add new tests for switch gates

### Checkpoint: Testing
- [ ] Config functions tested: master ON/OFF × context ON/OFF/implicit × enrich ON/OFF/implicit
- [ ] API endpoint returns injection field
- [ ] Existing plugin tests still pass

### Phase 4: Polish

- [ ] **Task 4**: Docs + full regression
  - Update `docs/summary.md` with new injection points
  - Update `docs/issue.md` mark as fixed
  - Run full regression: `npm test && npm run typecheck && npm run lint && npm run build`

### Checkpoint: Complete
- [ ] All acceptance criteria from spec met
- [ ] 950+ tests pass
- [ ] Build, typecheck, lint pass
- [ ] Ready for review

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `experimental.chat.messages.transform` not available in OpenCode SDK | High | Verify hook signature before Task 2; fallback: keep enrich in system.transform with `output.messages` injection instead of `output.system` |
| Plugin config fetch fails (backend not ready) | Low | Default to all OFF (fail-safe); retry on first hook call |
| `activeSessionId` null in messages.transform during compaction window | Low | `session.compacted` → `session.created` happens synchronously in OpenCode; no LLM requests in between |
| Existing tests break due to config function addition | Med | Isolated tests; mock `getMergedEnv` as needed |

## Open Questions

- None (all resolved during spec review)
