# Spec: Fix Stale Vector Index Persistence After AGENTMEMORY_DROP_STALE_INDEX

## Objective

修复更换 embedding provider 后，`AGENTMEMORY_DROP_STALE_INDEX=true` 已设置但仍然每次重启都报警 stale vectors 的问题。

**问题**：当旧 provider（如 gemini，1024 维）切换到新 provider（如 openai，768 维）后，启动时 `validateDimensions()` 检测到维度不匹配，`AGENTMEMORY_DROP_STALE_INDEX=true` 开关虽然跳过了加载旧向量到内存，但 **没有删除 KV 中持久化的旧向量数据**。下次重启，`IndexPersistence.load()` 又从 KV 读取同样的旧向量，导致每次重启都报警。

**根因链条**：
1. 启动 → `load()` 从 `KV.bm25Index` scope key `"vectors"` 读取旧 1024 维向量
2. `validateDimensions(768)` → 全部不匹配
3. `isDropStaleIndexEnabled()=true` → 只打印警告，跳过 `restoreFrom()`，不删除 KV 中数据
4. 内存中 `vectorIndex.size === 0`
5. 后续 `save()` 检查 `this.vector.size > 0` → false，跳过写入 → KV 中旧数据原封不动
6. 下一次重启 → 回到步骤 1，无限循环

**用户影响**：已切换新 model 一段时间，日常使用中新 observation 的 768 维向量会随 `save()` 正常覆盖写入 KV。但如果进程在写入前 shutdown（`size=0`），旧数据仍然保留。关键是启动时的清理逻辑缺失。

## Tech Stack

- TypeScript ESM
- iii-sdk（StateKV 作为 KV 存储抽象）
- vitest 测试框架
- 无新增依赖

## Commands

```bash
# 构建
npm run build

# 测试（排除集成测试）
npm test

# 检查当前 git 状态
git status
git diff
```

## Project Structure

涉及文件：
```
src/index.ts                      # 启动逻辑，添加 kv.delete() 调用
src/state/index-persistence.ts    # save() 方法，添加空 vector 清理逻辑
src/state/schema.ts               # KV schema（仅引用，无需修改）
src/state/kv.ts                   # StateKV.delete() 接口（仅引用，无需修改）
test/index-persistence.test.ts    # 新增或扩展测试（如果存在）
test/vector-index.test.ts         # 已有 validateDimensions 测试（如果存在）
```

## Code Style

遵循项目现有模式：

```typescript
// 删除 KV 中的向量数据，不阻塞启动流程
await kv.delete(KV.bm25Index, "vectors").catch(() => {});

// IndexPersistence.save() 中清理残留
if (this.vector && this.vector.size > 0) {
  await this.kv.set(KV.bm25Index, "vectors", this.vector.serialize());
} else if (this.vector) {
  await this.kv.delete(KV.bm25Index, "vectors").catch(() => {});
}
```

- 不用代码注释解释 WHAT，命名已自说明
- `await ... .catch(() => {})` 模式：清理操作失败不应阻塞启动/shutdown
- 保持现有缩进、import 风格

## Testing Strategy

- 框架：vitest（`npm test`）
- Mock 模式：`vi.mock("iii-sdk")` + mock `sdk.trigger`、`kv.get/set/list`
- 新增测试用例：
  1. `IndexPersistence.save()` 当 vectorIndex 存在但为空时，是否调用 `kv.delete()`
  2. `IndexPersistence.save()` 当 vectorIndex 有数据时，行为不变（regression guard）
- 验证方式：`npm test` 全部通过

## Boundaries

### Always do
- 遵循项目 AGENTS.md 中的 Consistency Rules
- 修改后运行 `npm test` 确保测试通过
- 保持 API 向后兼容（不改变 load/save 的公共签名）

### Ask first
- 无（变更范围明确）

### Never do
- 不改变 VectorIndex/IndexPersistence 的公共 API 签名
- 不修改 KV schema
- 不在启动路径中引入阻塞等待

## Success Criteria

- [ ] `src/index.ts` 中 `AGENTMEMORY_DROP_STALE_INDEX=true` 分支在打印警告后，调用 `kv.delete(KV.bm25Index, "vectors")` 清理 KV
- [ ] `src/state/index-persistence.ts` 的 `save()` 方法在 `vector` 存在但 `size===0` 时，调用 `kv.delete()` 清理 KV 残留
- [ ] `npm test` 全部通过（950+ tests）
- [ ] 手动验证：切换 provider 后设置 `AGENTMEMORY_DROP_STALE_INDEX=true`，启动后不再重复报警

## Open Questions

无。问题根因和修复方案已通过对代码的完整分析确认。