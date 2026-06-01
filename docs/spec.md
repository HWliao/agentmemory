# Spec: 优化 agentmemory 上下文注入点

## Objective

重构 agentmemory OpenCode plugin 的上下文注入策略，通过分层开关 + 注入点迁移消除 LLM prompt caching 破坏，保持文件感知的被动记忆召回，用户消息召回交由 agent 通过 MCP tools 主动完成。

**核心用户**: 使用 agentmemory + OpenCode + MCP 的 AI coding agent 用户。

**前置约束**:
- 后续功能变更不得破坏当前 spec 中设立的架构约束
- 技术决策需基于源码事实，禁止凭空推测
- 以**极高标准**开发，保证正确性、极低 Bug 率

**验收标准**:
- [ ] 三层开关模型正确运行（总开关 → context/enrich 独立控制）
- [ ] context 仅首 turn 注入 system prompt，后续 turn/step 不再改变
- [ ] enrich 每 step 注入到 chat.messages.transform 消息流（非 system prompt）
- [ ] enrich 仅基于 stash 文件名召回，不传 user prompt terms
- [ ] 同一 session 内 system prompt 首轮后保持稳定（字节级不变）
- [ ] session compaction 后自动重新注入 context（等同于新 session 首 turn）
- [ ] 关闭开关后 agent 可自主通过 MCP 工具召回记忆
- [ ] 现有 950+ 测试全量通过
- [ ] 新增 plugin 注入行为单元测试覆盖所有开关组合

---

## Tech Stack

| 层 | 技术 |
|---|---|
| 语言 | TypeScript (strict), ESM only |
| 构建 | tsdown → `dist/` |
| 测试 | vitest |
| 引擎 | iii-sdk (WebSocket → iii-engine port 49134) |
| Plugin 目标 | OpenCode (`@opencode-ai/plugin`) |
| 运行环境 | Node.js 20+ |

## Commands

```
Build:    npm run build
Test:     npm test
Dev:      npm run dev
```

## Project Structure（受影响文件）

```
plugin/opencode/agentmemory-capture.ts   # 主变更
src/config.ts                             # 新增子开关配置函数
src/triggers/api.ts                       # 新增 injection 字段到 /config/flags
src/index.ts                              # 更新日志消息
test/config-injection.test.ts             # 新增配置开关测试
test/api-injection-config.test.ts         # 新增 API/plugin 注入结构测试
docs/summary.md                           # 更新注入点清单
docs/issue.md                             # 标记已修复
docs/spec.md                              # 本文件
```

---

## Design Decisions

### D1: 三层开关模型

```
AGENTMEMORY_INJECT_CONTEXT (master, default: false)
  ├── AGENTMEMORY_INJECT_CONTEXT_CONTEXT (default: implicitly true when master on)
  │     控制: first-turn instructions + /context 注入到 system prompt
  └── AGENTMEMORY_INJECT_CONTEXT_ENRICH (default: implicitly true when master on)
        控制: chat.messages.transform 中 /enrich 注入到消息流（每 step）
```

- Master OFF → 两个子开关均 OFF，所有注入跳过，仅 telemetry
- Master ON + CONTEXT=ON → 首 turn system prompt 注入
- Master ON + ENRICH=ON → 每 step 消息流注入（chat.messages.transform）
- Master ON + CONTEXT=OFF → 跳过 system prompt 注入（仍可单独开启 enrich）
- Master ON + ENRICH=OFF → 跳过消息流注入（仍可单独开启 context）

**开关来源**：plugin 启动时通过 `GET /agentmemory/config/flags` 获取后台计算好的三层开关值（`response.injection` 字段），不读 `process.env`。所有配置集中在 agentmemory 后台 `.env` 管理。

**判断逻辑**（后台 `src/config.ts` 中计算）：
```typescript
const INJECT_ENABLED = process.env.AGENTMEMORY_INJECT_CONTEXT === "true";
const INJECT_CONTEXT = INJECT_ENABLED && process.env.AGENTMEMORY_INJECT_CONTEXT_CONTEXT !== "false";
const INJECT_ENRICH = INJECT_ENABLED && process.env.AGENTMEMORY_INJECT_CONTEXT_ENRICH !== "false";
```

### D2: context 注入策略（仅首 turn system prompt + compaction 后重新注入）

- **Hook**: `chat.system.transform`，仅首 turn（`contextInjectedSessions` guard）
- **内容**: `AGENTMEMORY_INSTRUCTIONS` + `/context` 结果（project profile + lessons + session summaries）
- **稳定性**: 首 turn 注入后不再变化，后续所有 turn/step system prompt 字节级不变
- **缓存影响**: 仅首 turn 首次请求 cache miss，后续全命中
- **Compaction 恢复注入**: `session.compacted` 事件中 `contextInjectedSessions.delete(sid)` 已清除标记，compaction 后的新 session（`session.created`）会在首 turn 重新注入 context。无需额外代码，现有清理逻辑已覆盖此场景。

### D3: enrich 注入策略（chat.messages.transform 每 step 消息流，仅文件名召回）

- **Hook**: `experimental.chat.messages.transform`，**每次 LLM 请求前触发**（含 tool-call 循环内每个 step）
- **触发时机**:
  ```
  Turn N, Step 1: → chat.messages.transform → enrich(stashed_files) → 注入 → stash.delete(files)
  Turn N, Step 2: → chat.messages.transform → enrich(新stash_files) → 注入 → stash.delete(files)
  Turn N, Step 3: → chat.messages.transform → enrich(...) → 注入 → stash.delete(files)
  ```
- **召回依据**: 仅 stash 文件名（用户附件 + 本轮所有 tool 操作触及的文件）
- **不传入 terms**: 用户消息不由 enrich 处理，agent 通过 system prompt 中的 instructions 自主判定是否调用 MCP 工具（memory_recall/memory_smart_search）
- **注入目标**: `output.messages` 数组头部 prepend 一条合成消息
- **去重**: 缓存上一步的 enrich 结果，字符串结果对比，内容不变时跳过注入
- **缓存影响**: 无（注入到消息流，不碰 system prompt）
- **Stash 清理**: `/enrich` 返回后删除已消费的 stash 文件，包括空结果和去重命中，与原有逻辑一致并避免重复调用。

**设计哲学**:
- enrich = 被动文件关联（"你正在操作这些文件，历史上有这些相关记录"）
- 用户消息召回 = agent 主动（通过 MCP tools memory_smart_search / memory_recall）
- `/context` 指令块明确告诉 agent 何时使用 MCP tools，agent 自主决策

**为何选 `chat.messages.transform`**：
- 每 step 触发 → 本 step 工具触及的文件即时反映
- 注入到消息流而非 system prompt → 不破坏 LLM prompt caching
- `input: {}` 无 sessionID → 通过 plugin 闭包中的 `activeSessionId` 解决

### D4: 关闭开关后的行为

当 `AGENTMEMORY_INJECT_CONTEXT` 为 false 或未设置时：
- 所有注入跳过（无 instructions, /context, /enrich）
- Telemetry 继续采集（agentmemory_action_create 等 MCP 工具仍然可用）
- Agent 自主判定何时调用 memory_recall / memory_smart_search / memory_file_history 等工具
- 等同于 mem0 OpenCode 的 pull 模式

### D5: enrich 注入性能评估

**当前（chat.system.transform per-step）**:
- 每次 LLM 请求都触发 enrich（含 tool-call 循环内）
- 典型 turn 3-8 steps → 3-8 次 `/enrich` POST
- 每次 POST 内并行 3 个子查询
- 注入到 system prompt → 缓存全量失效

**改进后（chat.messages.transform per-step）**:
- 每次 LLM 请求仍触发 enrich（保持即时性）
- 但注入到消息流而非 system prompt → **缓存不受影响**
- 字符串结果去重：连续 step 返回相同 enrich 结果时跳过注入
- 注入后清理已消费的 stash 文件，避免跨 step 累积

| 维度 | 当前 | 改进后 | 改善 |
|---|---|---|---|
| enrich 调用频率 | 每 step | 每 step（但字符串结果去重跳过不变者） | 略减 |
| 召回依据 | 文件名 | 文件名（不变） | — |
| system prompt 稳定性 | ❌ 每 step 变 | ✅ 首 turn 后不变 | ∞ |
| 缓存命中率 | ~0% | ~100%（首 turn 后） | ∞ |
| 注入目标 | system prompt | 消息流（prepend message） | — |
| 文件即时性 | ✅ 即刻 | ✅ 即刻 | — |
| 用户消息召回 | ❌ 完全依赖 push | agent 自主通过 MCP tools | 更灵活 |

---

## OpenCode Turn / Step 模型

| 术语 | 含义 | 触发次数 |
|---|---|---|
| **User Message** | 用户发送一条消息 | 用户每次回车 |
| **Turn** | 一次 user message 引发的完整周期 | 1 turn / user message |
| **Step** | Turn 内单次 LLM API 请求 | N steps / turn（取决于 tool-call 循环） |

### 生命周期时序（改进后）

```
User sends message
  │
  ├─→ chat.message hook 触发（1 次）
  │     ├─ stash file paths from user message
  │     ├─ observe("prompt_submit")
  │     └─ (不注入 enrich — 留给 chat.messages.transform)
  │
  ├─→ prompt() 创建 UserMessage
  ├─→ loop() 进入 turn 循环
  │     │
  │     ├─ Step 1: LLM request
  │     │   ├─ chat.messages.transform → enrich(stashed_files) → prepend → stash.delete(files)
  │     │   ├─ chat.system.transform (first turn only):
  │     │   │     IF injectContext → system.push(instructions + /context)
  │     │   └─ LLM request → sees enrich + (optionally) context instructions
  │     │
  │     ├─ tool.execute.before (Read foo.ts) → stash.add("foo.ts")
  │     ├─ tool.execute.after → observe
  │     │
  │     ├─ Step 2: LLM request (with tool results)
  │     │   ├─ chat.messages.transform → enrich(["foo.ts"]) → prepend → stash.delete(files)
  │     │   ├─ chat.system.transform → 无注入（已过首 turn 或未启用 context）
  │     │   └─ LLM request
  │     │
  │     ├─ tool.execute.before (Edit bar.ts) → stash.add("bar.ts")
  │     │
  │     ├─ Step 3: LLM request
  │     │   ├─ chat.messages.transform → enrich(["bar.ts"]) → prepend → stash.delete(files)
  │     │   └─ LLM request
  │     │
  │     └─ Step N: LLM returns "stop"
  └─→ Turn 结束
```

---

## Implementation Plan

### Step 0: 后台配置（`src/config.ts` + `src/triggers/api.ts`）

#### 0a. `src/config.ts` — 新增子开关函数 + 聚合导出

```typescript
// 子开关: 仅当 master ON 且未显式设为 false 时返回 true
export function isContextContextEnabled(): boolean {
  return getMergedEnv()["AGENTMEMORY_INJECT_CONTEXT"] === "true"
    && getMergedEnv()["AGENTMEMORY_INJECT_CONTEXT_CONTEXT"] !== "false";
}

export function isContextEnrichEnabled(): boolean {
  return getMergedEnv()["AGENTMEMORY_INJECT_CONTEXT"] === "true"
    && getMergedEnv()["AGENTMEMORY_INJECT_CONTEXT_ENRICH"] !== "false";
}

export function getInjectionConfig() {
  return {
    enabled: isContextInjectionEnabled(),
    context: isContextContextEnabled(),
    enrich: isContextEnrichEnabled(),
  };
}
```

#### 0b. `src/triggers/api.ts` — `func::config::flags` 追加 `injection` 字段

```typescript
// 在 response body 中追加（不修改 flags 数组）
body: {
  version: VERSION,
  provider: providerKind,
  embeddingProvider,
  flags,
  injection: getInjectionConfig(),  // 新增
},
```

### Step 1: 修改 `plugin/opencode/agentmemory-capture.ts`

#### 1a. 新增 `getJson` helper（GET + auth headers, 5s timeout, null on fail）

```typescript
async function getJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${API}/agentmemory${path}`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.json() : null;
  } catch (e) {
    if (DEBUG) console.error(`[agentmemory] GET ${path} failed:`, (e as Error).message);
    return null;
  }
}
```

#### 1b. Plugin 启动时从后台获取开关配置（替代 `process.env`）

```typescript
let injectContext = false;
let injectEnrich = false;

export const AgentmemoryCapturePlugin: Plugin = async (ctx) => {
  projectPath = ctx.worktree || ctx.project?.id || process.cwd();

  const flagsResult = await getJson("/config/flags");
  const inj = (flagsResult as any)?.injection;
  if (inj) {
    injectContext = inj.context;
    injectEnrich = inj.enrich;
  }

  return { ... };
};
```

#### 1c. 修改 `chat.message` hook — 仅 stash + observe（无 enrich）

```typescript
"chat.message": async (input, output) => {
  const sid = input.sessionID || activeSessionId;
  if (!sid) return;
  const parts = output.parts || [];

  // ── stash files from user message parts ──
  const files = parts
    .filter((p: any) => p.type === "file")
    .map((p: any) => p.filename || p.url)
    .filter(Boolean);
  for (const f of files) {
    const stash = stashFor(sid);
    stash.add(f);
    if (stash.size > MAX_STASHED_FILES) {
      const keep = [...stash].slice(-MAX_STASHED_FILES);
      stash.clear();
      for (const k of keep) stash.add(k);
    }
  }

  const textParts = parts.filter((p: any) => p.type === "text" && !p.synthetic && !p.ignored);
  const userText = textParts.map((p: any) => p.text || "").join("\n");

  await observe(sid, "prompt_submit", {
    agent: input.agent ?? null,
    model: input.model ?? null,
    variant: input.variant ?? null,
    prompt: userText.slice(0, 8000),
    files: files.slice(0, 20),
    parts_summary: parts.map((p: any) => p.type).filter(Boolean),
  });
},
```

#### 1d. 新增 `experimental.chat.messages.transform` hook — 每 step enrich（仅文件名）

```typescript
// 去重缓存: key=sid, value=上次 enrich 内容字符串
const lastEnrichCache = new Map<string, string>();

"experimental.chat.messages.transform": async (input, output) => {
  const sid = activeSessionId;
  if (!sid) return;
  if (!injectEnrich) return;

  const stash = stashFor(sid);
  if (stash.size === 0) return;

  const stashedFiles = [...stash].slice(0, 10);

  const enrichResult = await postJson("/enrich", {
    sessionId: sid,
    files: stashedFiles,
    toolName: "enrich_inject",
  });

  const enrichCtx = (enrichResult as any)?.context;
  if (typeof enrichCtx !== "string" || enrichCtx.length === 0) return;

  // ── dedup: skip if same content as last injection ──
  const cached = lastEnrichCache.get(sid);
  if (cached === enrichCtx) return; // same content, skip
  lastEnrichCache.set(sid, enrichCtx);

  // ── prepend synthetic user message with enrich context ──
  if (Array.isArray(output.messages)) {
    output.messages.unshift({
      info: { role: "user" },
      parts: [{
        type: "text",
        text: `<agentmemory-enrich>\n${enrichCtx}\n</agentmemory-enrich>`,
        synthetic: true,
      }],
    });
  }
  for (const f of stashedFiles) stash.delete(f);
},
```

#### 1e. 修改 `chat.system.transform` hook — 仅首 turn context

```typescript
"experimental.chat.system.transform": async (input, output) => {
  const sid = input.sessionID || activeSessionId;
  if (!sid) return;

  // ── First-turn static injection (gated by injectContext, once per session) ──
  if (injectContext && !contextInjectedSessions.has(sid)) {
    if (!Array.isArray(output.system)) return;
    output.system.push(AGENTMEMORY_INSTRUCTIONS);
    let ctx = startContextCache.get(sid);
    if (typeof ctx !== "string" || ctx.length === 0) {
      const result = await postJson("/context", {
        sessionId: sid,
        project: projectPath,
      });
      ctx = (result as any)?.context;
    } else {
      startContextCache.delete(sid);
    }
    if (typeof ctx === "string" && ctx.length > 0) {
      output.system.push(ctx);
    }
    contextInjectedSessions.add(sid);
  }

  // ── Per-turn enrich REMOVED — relocated to chat.messages.transform ──
},
```

### Step 2: 更新 `src/index.ts` 日志消息

```typescript
`WARNING: AGENTMEMORY_INJECT_CONTEXT=true — context injection enabled via plugin hooks.
  - AGENTMEMORY_INJECT_CONTEXT_CONTEXT controls first-turn system prompt injection (instructions + project profile).
  - AGENTMEMORY_INJECT_CONTEXT_ENRICH controls per-step enrich injection (file-based recall, via chat.messages.transform).
  Set AGENTMEMORY_INJECT_CONTEXT=false to disable all injection (agent uses MCP tools for manual recall).`,
```

### Step 3: 测试

新增测试用例：

- [ ] Master=off → 所有注入跳过（system.transform 不注入 context，messages.transform 不注入 enrich）
- [ ] Master=on + CONTEXT=on → system.transform 首 turn 注入，后续 turn 不注入
- [ ] Master=on + CONTEXT=off → system.transform 始终不注入
- [ ] Master=on + ENRICH=on → messages.transform 每 step 基于 stash files 调用 enrich 并 prepend 消息
- [ ] Master=on + ENRICH=off → messages.transform 不调用 enrich
- [ ] `test/config-injection.test.ts`: 覆盖 master/context/enrich 开关组合
- [ ] `test/api-injection-config.test.ts`: 覆盖 `/config/flags` response shape 和 plugin 注入结构
- [ ] messages.transform 字符串结果去重：相同 enrich 内容不重复注入
- [ ] messages.transform 调用 enrich 时不携带 terms 参数
- [ ] chat.system.transform 仅首 turn 注入，同 session 后续 turn 不注入

### Step 4: 更新文档

- [ ] `docs/summary.md`: 更新注入点表格
- [ ] `docs/issue.md`: 标记已修复
- [ ] `docs/spec.md`: 本文件保留

### Step 5: 全量回归

```bash
npm test          # 950+ tests
npm run build
```

---

## agentmemory OpenCode 数据采集逻辑（当前）

| Hook | 采集内容 | endpoint |
|---|---|---|
| `event: session.created` | **前一个 session end** + 新 session 注册 + 缓存 /context | POST /session/end(prev), POST /session/start |
| `event: session.status (idle)` | 触发 summarize | POST /summarize |
| `event: session.compacted` | summarize + session end + cleanup | POST /summarize, POST /session/end |
| `event: session.deleted` | session end + crystals + consolidate | POST /session/end, /crystals/auto, /consolidate-pipeline |
| `event: session.error` | 错误记录 | POST /observe (post_tool_failure) |
| `event: session.updated` | session 更新信息 | POST /observe (session_updated) |
| `event: session.diff` | git diff 统计 | POST /observe (session_diff) |
| `event: message.updated (assistant)` | 完整 token 统计（含 cache_read/write） | POST /observe (assistant_message) |
| `event: message.part.updated (subtask)` | subagent 启动 | POST /observe (subagent_start) |
| `event: message.part.updated (tool)` | 工具调用（completed / error） | POST /observe (post_tool_use / post_tool_failure) |
| `event: message.part.updated (step-finish)` | step 结束统计 | POST /observe (step_finish) |
| `event: message.part.updated (reasoning)` | 推理内容 | POST /observe (reasoning) |
| `event: message.part.updated (patch)` | patch 应用 | POST /observe (patch_applied) |
| `event: message.part.updated (compaction)` | compaction 事件 | POST /observe (compaction_event) |
| `event: message.part.updated (agent)` | agent 选择 | POST /observe (agent_selected) |
| `event: message.part.updated (retry)` | 重试 | POST /observe (retry_attempt) |
| `event: message.part.updated (file)` | **stash 文件路径** | 仅内存 |
| `event: file.edited` | **stash 文件路径** | 仅内存 |
| `event: permission.updated` | 权限弹窗 | POST /observe (notification) |
| `event: permission.replied` | 权限回复 | POST /observe (permission_replied) |
| `event: todo.updated` | todo 列表 | POST /observe (task_completed) |
| `event: command.executed` | 斜杠命令 | POST /observe (command_executed) |
| `chat.message` | prompt 文本 + 文件列表 + **stash files** | POST /observe (prompt_submit) |
| `chat.params` | LLM 参数（模型、温度、token 限制） | POST /observe (llm_params) |
| `tool.execute.before` | **stash file paths** (Read/Write/Edit/Glob/Grep) | 仅内存 |
| `chat.system.transform` | **注入 instructions + /context（仅首 turn）** | POST /context |
| `chat.messages.transform` | **每 step 注入 enrich** | POST /enrich |
| `session.compacting` | **注入 /context 到 output.context** | POST /context |
| `config` | 主题、模型、agent 列表、MCP server、provider | POST /observe (config_loaded) |

**Stash 流程**（文件名的采集和传递）：
1. `message.part.updated (file type)` → stash.add(filename)
2. `file.edited` → stash.add(filename)
3. `chat.message` → stash.add(file parts from user message)
4. `tool.execute.before` (Read/Write/Edit/Glob/Grep) → stash.add(extracted file paths)
5. `chat.messages.transform` → enrich based on stash（每 step，hash 去重，注入后清理已消费文件）

---

## Boundaries

### Always
- 遵循 AGENTS.md 中的 Consistency Rules
- 所有测试通过后才提交
- 输入验证在系统边界处进行
- 用 `codegraph_*` 进行代码探索
- 使用 `context-mode` 工具进行批量分析

### Ask First
- 修改数据库 schema（KV scopes）
- 添加 npm 依赖
- 修改 API 端点签名
- 删除现有测试用例
- 提交代码
- 发布新版本

### Never
- 绕过 iii-engine 直接操作 SQLite
- 修改 `src/functions/enrich.ts` 的核心召回逻辑
- 修改 hook 行为（session-start / pre-tool-use / pre-compact）
- 硬编码 secret / token

---

## 附录：context 注入对 MCP 工具使用率的评估

`AGENTMEMORY_INSTRUCTIONS` 是 agent 主动使用 MCP memory 工具的关键触发源：

| 场景 | Instructions 存在 | Instructions 不存在 |
|---|---|---|
| Agent 看到"使用这些工具 proactively" | ✅ 高概率主动调用 recall/save | ⚠️ 仅在有明确需求时调用 |
| Agent 看到各工具的 Use when 描述 | ✅ 知道何时用哪个工具 | ❌ 需自己从工具描述推断 |
| Agent 看到 project profile + conventions | ✅ 上下文自然鼓励保存新记忆 | ❌ 缺少记忆系统的存在感 |
| 仅剩 MCP 工具列表中的 53 个工具 | — | ⚠️ agent 需自主发现并决定使用 |

**结论**: Instructions + /context 注入对 MCP 工具使用率有显著正向影响。总开关关闭后 agent 使用记忆工具的主动性会下降，但工具仍然可用（pull 模式）。

## 附录：enrich 每 step 注入的性能评估（改进后）

| 维度 | 当前（chat.system.transform per-step） | 改进后（chat.messages.transform per-step） | 改善 |
|---|---|---|---|
| enrich 调用频率 | 每 step | 每 step（但 hash 去重跳过不变者） | 略减 |
| system prompt 稳定性 | ❌ 每 step 变 | ✅ 首 turn 后不变 | ∞ |
| 缓存命中率（首 turn 后） | ~0% | ~100% | ∞ |
| 注入目标 | system prompt | 消息流（prepend user message） | — |
| 注入 token 量 | ~4K chars/step（全入 system prompt） | ~4K chars/step（入消息流，但不破缓存） | 缓存收益 |
| 文件即时性 | ✅ 即刻 | ✅ 即刻 | — |
