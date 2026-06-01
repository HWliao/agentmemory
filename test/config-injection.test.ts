import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ORIGINAL_HOME = process.env["HOME"];
const ORIGINAL_USERPROFILE = process.env["USERPROFILE"];

let sandboxHome: string;

async function freshConfig() {
  vi.resetModules();
  return await import("../src/config.js");
}

function writeEnv(contents: string) {
  const dir = join(sandboxHome, ".agentmemory");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, ".env"), contents);
}

function cleanEnvKeys() {
  delete process.env["AGENTMEMORY_INJECT_CONTEXT"];
  delete process.env["AGENTMEMORY_INJECT_CONTEXT_CONTEXT"];
  delete process.env["AGENTMEMORY_INJECT_CONTEXT_ENRICH"];
}

describe("injection config", () => {
  beforeEach(() => {
    sandboxHome = mkdtempSync(join(tmpdir(), "agentmemory-inj-"));
    process.env["HOME"] = sandboxHome;
    process.env["USERPROFILE"] = sandboxHome;
    cleanEnvKeys();
  });

  afterEach(() => {
    if (ORIGINAL_HOME === undefined) delete process.env["HOME"];
    else process.env["HOME"] = ORIGINAL_HOME;
    if (ORIGINAL_USERPROFILE === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = ORIGINAL_USERPROFILE;
    rmSync(sandboxHome, { recursive: true, force: true });
  });

  describe("isContextContextEnabled", () => {
    it("returns false when master is not set", async () => {
      const cfg = await freshConfig();
      expect(cfg.isContextContextEnabled()).toBe(false);
    });

    it("returns false when master is off", async () => {
      writeEnv("AGENTMEMORY_INJECT_CONTEXT=false");
      const cfg = await freshConfig();
      expect(cfg.isContextContextEnabled()).toBe(false);
    });

    it("returns true when master is on and sub not set (implicit ON)", async () => {
      writeEnv("AGENTMEMORY_INJECT_CONTEXT=true");
      const cfg = await freshConfig();
      expect(cfg.isContextContextEnabled()).toBe(true);
    });

    it("returns false when master on but sub explicitly off", async () => {
      writeEnv(
        "AGENTMEMORY_INJECT_CONTEXT=true\nAGENTMEMORY_INJECT_CONTEXT_CONTEXT=false",
      );
      const cfg = await freshConfig();
      expect(cfg.isContextContextEnabled()).toBe(false);
    });

    it("returns false when sub is on but master is off", async () => {
      writeEnv(
        "AGENTMEMORY_INJECT_CONTEXT=false\nAGENTMEMORY_INJECT_CONTEXT_CONTEXT=true",
      );
      const cfg = await freshConfig();
      expect(cfg.isContextContextEnabled()).toBe(false);
    });
  });

  describe("isContextEnrichEnabled", () => {
    it("returns false when master is not set", async () => {
      const cfg = await freshConfig();
      expect(cfg.isContextEnrichEnabled()).toBe(false);
    });

    it("returns false when master is off", async () => {
      writeEnv("AGENTMEMORY_INJECT_CONTEXT=false");
      const cfg = await freshConfig();
      expect(cfg.isContextEnrichEnabled()).toBe(false);
    });

    it("returns true when master is on and sub not set (implicit ON)", async () => {
      writeEnv("AGENTMEMORY_INJECT_CONTEXT=true");
      const cfg = await freshConfig();
      expect(cfg.isContextEnrichEnabled()).toBe(true);
    });

    it("returns false when master on but sub explicitly off", async () => {
      writeEnv(
        "AGENTMEMORY_INJECT_CONTEXT=true\nAGENTMEMORY_INJECT_CONTEXT_ENRICH=false",
      );
      const cfg = await freshConfig();
      expect(cfg.isContextEnrichEnabled()).toBe(false);
    });

    it("returns false when sub is on but master is off", async () => {
      writeEnv(
        "AGENTMEMORY_INJECT_CONTEXT=false\nAGENTMEMORY_INJECT_CONTEXT_ENRICH=true",
      );
      const cfg = await freshConfig();
      expect(cfg.isContextEnrichEnabled()).toBe(false);
    });
  });

  describe("getInjectionConfig", () => {
    it("returns all false when nothing is set", async () => {
      const cfg = await freshConfig();
      expect(cfg.getInjectionConfig()).toEqual({
        enabled: false,
        context: false,
        enrich: false,
      });
    });

    it("returns all true when master on and subs implicit", async () => {
      writeEnv("AGENTMEMORY_INJECT_CONTEXT=true");
      const cfg = await freshConfig();
      expect(cfg.getInjectionConfig()).toEqual({
        enabled: true,
        context: true,
        enrich: true,
      });
    });

    it("returns context off when sub explicitly off", async () => {
      writeEnv(
        "AGENTMEMORY_INJECT_CONTEXT=true\nAGENTMEMORY_INJECT_CONTEXT_CONTEXT=false",
      );
      const cfg = await freshConfig();
      expect(cfg.getInjectionConfig()).toEqual({
        enabled: true,
        context: false,
        enrich: true,
      });
    });

    it("returns enrich off when sub explicitly off", async () => {
      writeEnv(
        "AGENTMEMORY_INJECT_CONTEXT=true\nAGENTMEMORY_INJECT_CONTEXT_ENRICH=false",
      );
      const cfg = await freshConfig();
      expect(cfg.getInjectionConfig()).toEqual({
        enabled: true,
        context: true,
        enrich: false,
      });
    });

    it("returns both subs on when master on and subs explicitly on", async () => {
      writeEnv(
        [
          "AGENTMEMORY_INJECT_CONTEXT=true",
          "AGENTMEMORY_INJECT_CONTEXT_CONTEXT=true",
          "AGENTMEMORY_INJECT_CONTEXT_ENRICH=true",
        ].join("\n"),
      );
      const cfg = await freshConfig();
      expect(cfg.getInjectionConfig()).toEqual({
        enabled: true,
        context: true,
        enrich: true,
      });
    });
  });
});
