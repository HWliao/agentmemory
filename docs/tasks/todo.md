# Task List: 优化 agentmemory 上下文注入点

## Phase 1: Backend Foundation

### Task 1: Config functions + API injection field
**Status:** completed | **Size:** S | **Depends:** None

**Files:** `src/config.ts`, `src/triggers/api.ts`, `src/index.ts`

## Phase 2: Plugin Refactor

### Task 2: Plugin refactor — fetch config, remove enrich from system.transform, add messages.transform
**Status:** completed | **Size:** M | **Depends:** Task 1

### Task 3: Tests for config, API, and plugin injection behavior
**Status:** completed | **Size:** M | **Depends:** Task 2

### Task 4: Docs + full regression
**Status:** completed | **Size:** S | **Depends:** Task 3

**Files:** `docs/summary.md`, `docs/issue.md`
