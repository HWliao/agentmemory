# Spec: 日志文件输出

## Objective

为 agentmemory 增加日志文件输出能力。当前所有日志仅写入 stderr，在 Windows 本地 iii 启动场景下用户看不到任何输出。本需求将日志同时写入文件，支持按天轮转、大小限制、自动清理，并通过 `.env` 配置。

**目标用户**: 本地开发 / 调试 agentmemory 的开发者，尤其是 Windows 用户。

**成功标准**:
- 日志同时写入 stderr 和文件
- 文件按天轮转，单文件最大 10MB，保留 30 天
- 通过 `~/.agentmemory/.env` 配置日志目录、级别
- 默认即可用（无需配置），`--verbose` 仍可开启启动日志

## Tech Stack

- TypeScript, ESM
- Node.js 内置 `fs`（`appendFileSync`）
- 无第三方日志库依赖（保持轻量，与现有 `logger.ts` 的 "thin shim" 设计一致）
- vitest 测试

## Commands

```
Build:  npm run build
Test:   npm test
Lint:   npm run lint
```

## Project Structure

```
src/
  logger.ts           ← 修改：增加 fileLog() 输出 + 轮转逻辑
  config.ts           ← 修改：增加 loadLogConfig() 读取 env
  types.ts            ← 修改：增加 LogConfig 接口
  index.ts            ← 修改：启动时调用 initFileLogging()
  functions/
    replay.ts         ← 修改：2 处空 catch {} 补 logger.error
    observe.ts        ← 修改：1 处 catch 补 logger.error
    sentinels.ts      ← 修改：console.error → logger.error
test/
  logger.test.ts      ← 新增：日志文件轮转、级别过滤、清理测试
.env.example          ← 修改：增加日志相关配置项
```

## Code Style

遵循现有 logger.ts 风格——无第三方依赖，纯函数，try/catch 静默容错：

```typescript
type LogLevel = "debug" | "info" | "warn" | "error";

interface LogConfig {
  enabled: boolean;
  dir: string;
  level: LogLevel;
  maxSizeBytes: number;
  maxAgeDays: number;
}

function fileLog(level: string, msg: string, fields: Fields): void {
  try {
    // 每日轮转、大小检查
    // appendFileSync 写入
  } catch {
    // 静默丢弃
  }
}
```

## Testing Strategy

- 框架: vitest
- 测试文件: `test/logger.test.ts`
- 覆盖:
  - 日志级别过滤（debug 在 info 级别不写入）
  - 每日轮转（跨日期产生新文件）
  - 10MB 上限截断
  - 30 天过期清理
  - 目录不存在时自动创建
  - 配置缺失时使用默认值
  - stderr 输出不受日志级别影响（现有行为不变）

## Boundaries

### Always do
- 日志写入失败时静默丢弃（不抛异常，不阻塞主流程）
- 使用 `fs.appendFileSync` 保持简单
- 遵循现有 `src/logger.ts` 的所有设计模式
- 测试覆盖所有轮转、限制、清理边界

### Ask first
- 引入第三方日志库
- 修改 stderr 输出行为
- 增加 `logger.debug()` 方法（已确认不新增）

### Never do
- 日志文件包含密钥
- 日志写入阻塞 Worker 主循环
- 移除现有 stderr 输出

## 已确认的决策

- bootLog、bootWarn、logger.* 全部统一写入日志文件
- 不新增 `logger.debug()` 方法，日志级别仅用于过滤现有三个级别的日志
- 现有 silent catch 块（kv.set 被 try 包裹但 catch 无日志）补上 `logger.error`

## 补充：现有 silent catch 修复

当前 `src/functions/` 中多处 kv.set 被 try/catch 包裹但 catch 块无日志输出，导致状态写入失败时无法排查。列出需修复的位置：

| 文件 | 行号 | 问题 | 修复 |
|------|------|------|------|
| `replay.ts` | 120-158 | 保存 lesson 时 `catch {}` 完全静默 | 加 `logger.error("replay: failed to save lesson", { lessonId, ... })` |
| `replay.ts` | 173-187 | 保存 crystal 时 `catch {}` 完全静默 | 加 `logger.error("replay: failed to save crystal", { crystalId, ... })` |
| `observe.ts` | 169-182 | kv.set 失败后 catch 里做清理再 re-throw，无日志 | re-throw 前加 `logger.error("observe: failed to save observation", ...)` |
| `sentinels.ts` | 153 | `console.error` 替代 `logger.error` | 改为 `logger.error("sentinels: timer callback failed", ...)` |

**不修复的**：
- `access-tracker.ts:72` — 已有 `logger.warn`
- `mesh.ts:246-316` — 错误通过 result.errors 数组传播，kv.set 在 try 外
- LLM 调用相关的 try/catch（compress、consolidate、graph、reflect 等）— 错误已通过返回值或 re-throw 传播

## Success Criteria

1. `AGENTMEMORY_LOG_FILE=true`（默认）时，日志写入 `~/.agentmemory/logs/agentmemory-YYYY-MM-DD.log`
2. 日志级别: `debug` < `info` < `warn` < `error`，默认 `info` 过滤掉 `debug`
3. 文件超过 10MB 时，当天文件追加 `.1` 后缀，新日志写入原文件名
4. 保留 30 天：启动时清理超过 30 天的 `.log` 文件
5. stderr 输出不受影响
6. 未配置 `.env` 时，使用全部默认值，日志目录自动创建
7. `agentmemory --verbose` 时文件中也记录完整启动日志

## 环境变量

```
# ~/.agentmemory/.env
AGENTMEMORY_LOG_FILE=true               # 默认 true，设为 false 关闭文件日志
AGENTMEMORY_LOG_DIR=~/.agentmemory/logs # 默认 ~/.agentmemory/logs
AGENTMEMORY_LOG_LEVEL=info              # debug | info | warn | error
AGENTMEMORY_LOG_MAX_SIZE=10485760       # 默认 10MB
AGENTMEMORY_LOG_MAX_AGE=30              # 默认 30 天
```

## 实现要点

1. **`src/config.ts`** — 新增 `loadLogConfig()`，从 `getMergedEnv()` 读取变量，返回 `LogConfig`
2. **`src/logger.ts`** — 新增 `initFileLogging(config: LogConfig)` 函数：
   - 在 `emit()` 中调用 `fileLog()` 追加写入
   - 启动时检查并清理过期文件
   - 每次写入前检查当日文件大小，超过上限时轮转
3. **`src/index.ts`** — 在 `registerWorker` 之后、任何 `bootLog()` 之前调用 `initFileLogging()`
4. **`src/types.ts`** — 新增 `LogConfig` 和 `LogLevel` 类型
5. **`.env.example`** — 在 "CLI / runtime knobs" 区域增加日志配置项