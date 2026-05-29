import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// OpenCode plugin needs zero-config memory injection. Plugin
// already wires experimental.chat.system.transform; this PR threads
// the /session/start context through a cache so injection happens
// without a second /context fetch and is documented as the
// SessionStart-equivalent behaviour.
describe("OpenCode plugin auto-context injection (#431)", () => {
  const plugin = readFileSync(
    "plugin/opencode/agentmemory-capture.ts",
    "utf-8",
  );

  function sessionCreatedBlock(): string {
    const start = plugin.indexOf('if (type === "session.created")');
    const end = plugin.indexOf("// ── session.idle", start);
    if (start === -1 || end === -1) throw new Error("session.created block not found");
    return plugin.slice(start, end);
  }

  function sessionCompactedBlock(): string {
    const start = plugin.indexOf('if (type === "session.compacted")');
    const end = plugin.indexOf("// ── session.updated", start);
    if (start === -1 || end === -1) throw new Error("session.compacted block not found");
    return plugin.slice(start, end);
  }

  it("captures context returned by POST /session/start", () => {
    expect(plugin).toMatch(/startContextCache\s*=\s*new Map<string,\s*string>/);
    expect(plugin).toMatch(
      /postJson\(["']\/session\/start["']/,
    );
    // Snapshot `activeSessionId` into a local before the await so the cached
    // context binds to the session that opened it, not a later one.
    expect(plugin).toMatch(
      /const\s+sessionId\s*=\s*activeSessionId[\s\S]*?startContextCache\.set\(sessionId/,
    );
  });

  it("ends a previous active session before starting a different new session", () => {
    const block = sessionCreatedBlock();
    const sessionEndIndex = block.indexOf('post("/session/end"');
    const sessionStartIndex = block.indexOf('postJson("/session/start"');

    expect(block).toMatch(/const\s+previousSessionId\s*=\s*activeSessionId/);
    expect(block).toMatch(/previousSessionId\s*&&\s*previousSessionId\s*!==\s*sessionId/);
    expect(block).toContain('post("/session/end", { sessionId: previousSessionId })');
    expect(sessionEndIndex).toBeGreaterThanOrEqual(0);
    expect(sessionStartIndex).toBeGreaterThanOrEqual(0);
    expect(sessionEndIndex).toBeLessThan(sessionStartIndex);
  });

  it("ends the current session after compaction without bypassing backend graph extraction", () => {
    const block = sessionCompactedBlock();

    expect(block).toContain('post("/summarize", { sessionId: sid })');
    expect(block).toContain('observe(sid, "session_compacted", {})');
    expect(block).toContain('post("/session/end", { sessionId: sid })');
    expect(plugin).not.toMatch(/post(?:Json)?\(["']\/graph\//);
  });

  it("chat.system.transform reads cached context first, falls back to /context", () => {
    expect(plugin).toMatch(/startContextCache\.get\(sid\)/);
    expect(plugin).toMatch(/postJson\(["']\/context["']/);
    expect(plugin).toMatch(/startContextCache\.delete\(sid\)/);
  });

  it("session.deleted clears the cache to avoid stale entries", () => {
    const deletedBlock = plugin.slice(plugin.indexOf("session.deleted"));
    expect(deletedBlock).toMatch(/startContextCache\.delete\(sid\)/);
  });
});
