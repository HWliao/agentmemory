# Tasks: Fix Stale Vector Index Persistence

- [ ] **Task 1**: `src/index.ts` — 启动时删除 KV 中的 stale vectors
  - Acceptance: `AGENTMEMORY_DROP_STALE_INDEX=true` 警告日志后紧跟 `await kv.delete(KV.bm25Index, "vectors").catch(() => {})`
  - Verify: `npm run build` 编译通过
  - Files: `src/index.ts`（在第 424 行的 `);` 之后插入一行）

- [ ] **Task 2**: `src/state/index-persistence.ts` — save() 时若 vector 为空则清理 KV
  - Acceptance: `save()` 中当 `this.vector` 非 null 但 `size===0` 时，调用 `kv.delete(KV.bm25Index, "vectors").catch(() => {})`
  - Verify: `npm run build` 编译通过
  - Files: `src/state/index-persistence.ts`（在第 40 行 `}` 之后插入 else if 分支）

- [ ] **Task 3**: `test/index-persistence.test.ts` — 新增测试
  - Acceptance:
    1. save() 在 vector 为空时调用 kv.delete 清理残留向量
    2. save() 在 vector 有数据时行为不变（regression guard）
  - Verify: `npm test -- test/index-persistence.test.ts` 通过
  - Files: `test/index-persistence.test.ts`

- [ ] **Task 4**: 全量测试验证
  - Acceptance: `npm test` 全部通过，无回归
  - Verify: `npm test`
  - Files: 无新增，仅验证