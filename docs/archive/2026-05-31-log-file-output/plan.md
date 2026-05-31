# Implementation Plan: 日志文件输出

## Overview

为 agentmemory 增加日志文件输出能力，同时修复现有 silent catch 块中缺失的 `logger.error`。核心改动在 `src/logger.ts`（扩展 emit 增加文件写入 + 轮转逻辑）、`src/config.ts`（新增 `loadLogConfig()`）、`src/types.ts`（新增类型），并对 `replay.ts`、`observe.ts`、`sentinels.ts` 做小范围修复。

## Architecture Decisions

- **不引入第三方库**：仅用 Node.js 内置 `fs.appendFileSync`，与现有 logger.ts "thin shim" 风格一致
- **同步写入**：`appendFileSync` 保证日志不丢失，在单线程 Node.js 中无并发问题；Worker 日志量很小（非高频写入场景），不会阻塞
- **轮转策略**：每次写入前检查当日文件大小 → 超过上限则重命名旧文件（`.1` 后缀）+ 继续写入原文件名。启动时扫描清理超过 30 天的 `.log` 文件
- **日志覆盖范围**：`emit()` 中统一调用 `fileLog()` 覆盖 `logger.info/warn/error` + `bootLog`（verbose 时）+ `bootWarn`
- **级别过滤**：仅影响文件写入，不影响 stderr 输出。`LEVELS` 映射表 O(1) 判断

## Dependency Graph

```
types.ts (LogConfig, LogLevel)
    │
    ├── config.ts (loadLogConfig)
    │       │
    │       └── index.ts (initFileLogging call)
    │
    └── logger.ts (fileLog, initFileLogging, rotation, cleanup)
            │
            └── functions/replay.ts   ──┐
                functions/observe.ts  ──┤ (silent catch fix — 独立任务)
                functions/sentinels.ts ──┘
```

## Task List

### Phase 1: Foundation

- [ ] Task 1: Types — 新增 LogConfig 和 LogLevel
- [ ] Task 2: Config — 新增 loadLogConfig()

### Checkpoint: Foundation
- [ ] `npm run build` 通过（仅类型和配置定义，不产生行为变化）

### Phase 2: Core — 日志文件输出

- [ ] Task 3: Logger 核心 — fileLog、initFileLogging、轮转、清理
- [ ] Task 4: 集成 — index.ts 启动初始化 + .env.example

### Checkpoint: Core
- [ ] `npm test` 通过
- [ ] 日志文件出现在 `~/.agentmemory/logs/agentmemory-YYYY-MM-DD.log`

### Phase 3: Silent Catch 修复

- [ ] Task 5: replay.ts — 2 处空 catch {} 补 logger.error
- [ ] Task 6: observe.ts + sentinels.ts — 补 logger.error

### Checkpoint: Complete
- [ ] 全部测试通过
- [ ] 所有 catch 块有日志输出

### Phase 4: 测试

- [ ] Task 7: 新增 logger.test.ts

### Final Checkpoint
- [ ] `npm test` 全部通过
- [ ] `npm run build` 无错误

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `appendFileSync` 阻塞主循环 | Low | Worker 日志量极小（~25 行启动 + 低频率运行时日志），远达不到阻塞量级 |
| 跨日期轮转在启动后首次写入才触发 | Low | 启动时立即调用一次 `emit` 做日期检查，确保当日文件存在 |
| Windows 路径兼容性 | Low | 使用 `path.join` 统一处理，`homedir()` 返回 Windows 风格路径（`C:\Users\...`）|

## Open Questions

无 — Spec 已确认所有决策。