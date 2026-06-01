import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("config/flags API returns injection field", () => {
  const api = readFileSync("src/triggers/api.ts", "utf-8");
  const config = readFileSync("src/config.ts", "utf-8");

  it("exports getInjectionConfig from config.ts", () => {
    expect(config).toMatch(/export function getInjectionConfig/);
  });

  it("exports isContextContextEnabled from config.ts", () => {
    expect(config).toMatch(/export function isContextContextEnabled/);
  });

  it("exports isContextEnrichEnabled from config.ts", () => {
    expect(config).toMatch(/export function isContextEnrichEnabled/);
  });

  it("imports getInjectionConfig in api.ts", () => {
    expect(api).toMatch(/getInjectionConfig/);
  });

  it("includes injection field in /config/flags response body", () => {
    expect(api).toMatch(/injection:\s*getInjectionConfig\(\)/);
  });
});

describe("plugin injection patterns", () => {
  const plugin = readFileSync("plugin/opencode/agentmemory-capture.ts", "utf-8");

  it("fetches injection config from backend at startup", () => {
    expect(plugin).toMatch(/getJson\(["']\/config\/flags["']/);
  });

  it("reads injection.context and injection.enrich from response", () => {
    expect(plugin).toMatch(/injectContext\s*=\s*inj\.context/);
    expect(plugin).toMatch(/injectEnrich\s*=\s*inj\.enrich/);
  });

  it("gates chat.system.transform first-turn context by injectContext", () => {
    expect(plugin).toMatch(/injectContext\s*&&\s*!contextInjectedSessions/);
  });

  it("does NOT inject enrich in chat.system.transform", () => {
    const transformHook = plugin.slice(
      plugin.indexOf('"experimental.chat.system.transform"'),
      plugin.indexOf('"experimental.chat.messages.transform"'),
    );
    expect(transformHook).not.toMatch(/\/enrich/);
  });

  it("has chat.messages.transform hook", () => {
    expect(plugin).toMatch(/"experimental\.chat\.messages\.transform"/);
  });

  it("gates chat.messages.transform by injectEnrich", () => {
    const messagesHook = plugin.slice(
      plugin.indexOf('"experimental.chat.messages.transform"'),
      plugin.indexOf('"experimental.session.compacting'),
    );
    expect(messagesHook).toMatch(/!injectEnrich/);
  });

  it("calls /enrich in chat.messages.transform with files only", () => {
    const messagesHook = plugin.slice(
      plugin.indexOf('"experimental.chat.messages.transform"'),
      plugin.indexOf('"experimental.session.compacting'),
    );
    expect(messagesHook).toMatch(/postJson\(["']\/enrich["']/);
    expect(messagesHook).toMatch(/sessionId:\s*sid/);
    expect(messagesHook).toMatch(/files,/);
    expect(messagesHook).not.toMatch(/terms/);
  });

  it("deduplicates enrich content in chat.messages.transform", () => {
    const messagesHook = plugin.slice(
      plugin.indexOf('"experimental.chat.messages.transform"'),
      plugin.indexOf('"experimental.session.compacting'),
    );
    expect(messagesHook).toMatch(/lastEnrichCache\.get\(sid\)/);
    expect(messagesHook).toMatch(/cached\s*===\s*enrichmentText/);
    expect(messagesHook).toMatch(/lastEnrichCache\.set\(sid,\s*enrichmentText\)/);
  });

  it("injects enrich into output.messages as synthetic user message", () => {
    const messagesHook = plugin.slice(
      plugin.indexOf('"experimental.chat.messages.transform"'),
      plugin.indexOf('"experimental.session.compacting'),
    );
    expect(messagesHook).toMatch(/output\.messages\.unshift/);
    expect(messagesHook).toMatch(/<agentmemory-enrich>/);
    expect(messagesHook).toMatch(/synthetic:\s*true/);
  });

  it("clears lastEnrichCache on session cleanup", () => {
    expect(plugin).toMatch(/pruneSessionMaps\(/);
    expect(plugin).toMatch(/lastEnrichCache\.delete\(sid\)/);
    expect(plugin).toMatch(/lastEnrichCache\.delete\(sessionId\)/);
  });
});
