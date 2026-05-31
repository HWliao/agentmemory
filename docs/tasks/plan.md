# Plan: Fix Stale Vector Index Persistence

## Dependency Graph

```
Task 1 (src/index.ts) ──→ Task 2 (index-persistence.ts) ──→ Task 3 (tests) ──→ Task 4 (verify)
         独立                      独立（两个修复正交）              依赖 1+2           依赖全部
```

Task 1 和 Task 2 相互独立，可并行实施。Task 3 依赖两者都完成。Task 4 是最终验证。

## Implementation Order

### Phase 1: Core Fix
两个修复点正交，顺序无关紧要。先做 index.ts（启动路径），再做 index-persistence.ts（安全网）。

### Phase 2: Tests
验证 save() 的新行为——vector 为空时清理 KV。

### Phase 3: Verification
运行全量测试，确保无回归。

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| kv.delete 在 iii-engine 中超时 | Low | 启动 warning + 下次重启仍报警 | `.catch(() => {})` 不阻塞 |
| save() 中 delete 与 set 竞态 | None | N/A | save() 同步执行，无并发 |
| 测试中 mock kv 缺少 delete 方法 | Medium | 测试失败 | mockKV 已含 delete 实现 |

## Verification Checkpoints

**Checkpoint 1 (after Task 1+2):** TypeScript 编译通过，`npm run build` 成功
**Checkpoint 2 (after Task 3):** 新增测试通过
**Checkpoint 3 (after Task 4):** 全部 950+ 测试通过