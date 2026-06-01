# agentmemory 缓存性能问题讨论总结

## 核心问题

使用 agentmemory（opencode + MCP + plugin）后，token input cached 缓存率下降约 10 个百分点，在全天统计中可见。

## 根因

`plugin/opencode/agentmemory-capture.ts` 中 `experimental.chat.system.transform` 钩子在**每轮模型请求时**调用 `/agentmemory/enrich`，将基于当前文件名的可变上下文注入到 **system prompt** 中。

LLM prompt caching（Anthropic 风格）按前缀逐字节匹配。system prompt 是第一个缓存块，每轮不同 → 缓存前缀全量失效。

```
Request 1: system = [base + instructions + context]                  → cached
Request 2: system = [base + instructions + context + enrich(file1)]  → DIFFERENT → cache miss
Request 3: system = [base + instructions + context + enrich(file2)]  → DIFFERENT → cache miss
Request 4: system = [base + instructions + context]                  → matches Request 1 → cache hit
```

## 解决方案（已修复 — 2026-06-01）

### 变更摘要

enrich 从 `chat.system.transform` 迁移到 `chat.messages.transform`，改为注入消息流而非 system prompt。引入三层开关模型。

### 注入点（改进后）

| # | 注入点 | 内容 | 注入目标 | 开关 | 是否影响缓存 |
|---|---|---|---|---|---|
| 1 | `chat.system.transform` 首 turn | instructions + `/context` | system prompt | `AGENTMEMORY_INJECT_CONTEXT_CONTEXT` | 否（仅首 turn） |
| 2 | `chat.messages.transform` 每 step | `/enrich`（基于 stash 文件名） | 消息流（prepend synthetic message） | `AGENTMEMORY_INJECT_CONTEXT_ENRICH` | **否** |
| 3 | `session-start.ts` 钩子 | `/session/start` context | stdout | 保留 | 否 |
| 4 | `pre-tool-use.ts` 钩子 | `/enrich`（文件名 + pattern 作为 terms） | stdout | 保留 | 否 |
| 5 | `pre-compact.ts` 钩子 | `/context` | stdout | 保留 | 否 |

### 开关模型

```
AGENTMEMORY_INJECT_CONTEXT (master, default: false)
  ├── AGENTMEMORY_INJECT_CONTEXT_CONTEXT  → 控制首 turn system prompt 注入
  └── AGENTMEMORY_INJECT_CONTEXT_ENRICH   → 控制每 step 消息流注入
```

插件启动时通过 `GET /agentmemory/config/flags` 获取开关值，不读 `process.env`。详见 `docs/spec.md`。

### 结果

- system prompt 首 turn 注入后字节级不变 → cache hit rate ~100%（首 turn 后）
- enrich 每 step 仍触发，但注入到消息流 → 不影响缓存
- hash 去重减少重复注入
- 注入后清理 stash 文件，与原有逻辑一致
- session compaction 后自动重新注入 context
