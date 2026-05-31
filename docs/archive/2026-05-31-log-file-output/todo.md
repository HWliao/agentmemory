# Tasks: 日志文件输出

## Task 1: Types — 新增 LogConfig 和 LogLevel

**Description:** 在 `src/types.ts` 末尾新增 `LogLevel` 类型和 `LogConfig` 接口。

**Acceptance criteria:**
- [ ] `LogLevel` 为 `"debug" | "info" | "warn" | "error"` 联合类型
- [ ] `LogConfig` 包含 `enabled`, `dir`, `level`, `maxSizeBytes`, `maxAgeDays` 五个字段

**Verification:**
- [ ] `npm run build` 通过

**Dependencies:** None

**Files touched:**
- `src/types.ts`

**Estimated scope:** XS (1 file)

---

## Task 2: Config — 新增 loadLogConfig()

**Description:** 在 `src/config.ts` 新增 `loadLogConfig()` 函数，从 `getMergedEnv()` 读取 5 个环境变量并返回 `LogConfig`。遵循现有 `loadSnapshotConfig()` 模式。

**Acceptance criteria:**
- [ ] 读取 `AGENTMEMORY_LOG_FILE`（默认 `true`，`"false"` 时关闭）
- [ ] 读取 `AGENTMEMORY_LOG_DIR`（默认 `~/.agentmemory/logs`）
- [ ] 读取 `AGENTMEMORY_LOG_LEVEL`（默认 `"info"`，非法值回退到 `"info"`）
- [ ] 读取 `AGENTMEMORY_LOG_MAX_SIZE`（默认 `10485760`）
- [ ] 读取 `AGENTMEMORY_LOG_MAX_AGE`（默认 `30`）
- [ ] `config.ts` import 中增加 `LogConfig` 类型

**Verification:**
- [ ] `npm run build` 通过

**Dependencies:** Task 1

**Files touched:**
- `src/config.ts`

**Estimated scope:** S (1 file)

---

## Task 3: Logger 核心 — fileLog、initFileLogging、轮转、清理

**Description:** 在 `src/logger.ts` 增加文件日志输出能力。核心改动：`emit()` 中调用 `fileLog()` 同步追加写入文件；`initFileLogging()` 在启动时扫描并清理过期文件；每次写入前检查当日文件大小决定是否轮转。

**Acceptance criteria:**
- [ ] `initFileLogging(config)` 函数：创建日志目录（`mkdirSync({ recursive: true })`），扫描目录清理 > `maxAgeDays` 天的 `.log` 文件
- [ ] `currentLogPath()` 返回当日文件路径：`agentmemory-YYYY-MM-DD.log`
- [ ] `fileLog(level, msg, fields)` 函数：
  - [ ] 级别过滤：`LEVELS[config.level] > LEVELS[level]` 时跳过写入
  - [ ] 文件大小超过 `maxSizeBytes` 时，重命名为 `.1` 后缀
  - [ ] `appendFileSync` 追加写入 `fmt(level, msg, fields) + "\n"`
  - [ ] 写入失败时静默丢弃（try/catch）
- [ ] `emit()` 函数中调用 `fileLog()`（在现有 `process.stderr.write` 之前/之后均可）
- [ ] `bootLog()` 和 `bootWarn()` 中增加 `fileLog()` 调用（统一写入文件）
- [ ] 模块级别保存 `logConfig` 引用，`fileLog()` 检查 `config.enabled`

**Verification:**
- [ ] `npm run build` 通过
- [ ] 手动验证：启动 agentmemory 后 `~/.agentmemory/logs/` 出现日志文件

**Dependencies:** Task 1

**Files touched:**
- `src/logger.ts`

**Estimated scope:** M (1 file, 逻辑集中在单文件)

---

## Task 4: 集成 — index.ts 启动初始化 + .env.example

**Description:** 在 `src/index.ts` 的 `main()` 函数中，`loadConfig()` 之后、第一个 `bootLog()` 之前调用 `initFileLogging(loadLogConfig())`。更新 `.env.example` 增加日志配置项。

**Acceptance criteria:**
- [ ] `src/index.ts`：import `loadLogConfig` 和 `initFileLogging`，在 `main()` 中 loadConfig 三行之后立即调用
- [ ] `.env.example`：在 "CLI / runtime knobs" 区域增加 5 个日志环境变量及注释

**Verification:**
- [ ] `npm run build` 通过
- [ ] 启动日志同时出现在 stderr 和文件中

**Dependencies:** Task 2, Task 3

**Files touched:**
- `src/index.ts`
- `.env.example`

**Estimated scope:** S (2 files)

---

## Task 5: Silent Catch 修复 — replay.ts

**Description:** `src/functions/replay.ts` 中有两处 `catch {}` 完全静默地吞掉 kv.set 错误。补上 `logger.error`。

**Acceptance criteria:**
- [ ] 第 158 行 `catch {}` → `catch (err) { logger.error("replay: failed to save lesson", { lessonId, error: err instanceof Error ? err.message : String(err) }); }`
- [ ] 第 187 行 `catch {}` → `catch (err) { logger.error("replay: failed to save crystal", { crystalId, error: err instanceof Error ? err.message : String(err) }); }`
- [ ] 不改变现有错误处理逻辑（lessonIds 仍跳过失败的 lesson）

**Verification:**
- [ ] `npm run build` 通过
- [ ] `npm test` 中 replay 相关测试通过

**Dependencies:** None（独立修复）

**Files touched:**
- `src/functions/replay.ts`

**Estimated scope:** XS (1 file)

---

## Task 6: Silent Catch 修复 — observe.ts + sentinels.ts

**Description:** `observe.ts` 的 catch 块在清理资源后 re-throw 但不记录日志；`sentinels.ts` 使用 `console.error` 而非 `logger.error`。

**Acceptance criteria:**
- [ ] `observe.ts:173`：`throw error` 之前加 `logger.error("observe: failed to save observation", { obsId, sessionId: payload.sessionId, error: error instanceof Error ? error.message : String(error) })`
- [ ] `sentinels.ts:154`：`console.error(...)` → `logger.error("sentinels: timer callback failed", { sentinelId: sentinel.id, error: err instanceof Error ? err.message : String(err) })`

**Verification:**
- [ ] `npm run build` 通过
- [ ] `npm test` 中 observe 和 sentinels 相关测试通过

**Dependencies:** None（独立修复）

**Files touched:**
- `src/functions/observe.ts`
- `src/functions/sentinels.ts`

**Estimated scope:** XS (2 files)

---

## Task 7: 新增 logger.test.ts

**Description:** 编写 vitest 测试覆盖日志文件输出、轮转、清理、级别过滤逻辑。

**Acceptance criteria:**
- [ ] 级别过滤：`info` 级别不写入 `debug` 日志
- [ ] 每日轮转：跨日期产生新文件名
- [ ] 大小上限：文件超过 10MB 时轮转（mock 大文件）
- [ ] 过期清理：启动时清理 > 30 天的文件
- [ ] 目录自动创建：目录不存在时 `initFileLogging` 自动创建
- [ ] 配置缺失：未配置时使用默认值
- [ ] stderr 输出不受影响：文件写入失败不影响 stderr

**Verification:**
- [ ] `npm test` 全部通过
- [ ] `npm run build` 通过

**Dependencies:** Task 3

**Files touched:**
- `test/logger.test.ts`（新增）

**Estimated scope:** M (1 文件，约 150-200 行测试代码)