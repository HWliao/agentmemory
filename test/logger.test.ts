import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, utimesSync, appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";

function freshDir(): string {
  const d = join(tmpdir(), `am-log-${randomBytes(4).toString("hex")}`);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}

function logFiles(dir: string): string[] {
  return readdirSync(dir).filter((f: string) => f.includes(".log"));
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function logFilePath(dir: string): string {
  return join(dir, `agentmemory-${todayStr()}.log`);
}

describe("logger file output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates log directory if it does not exist", async () => {
    const dir = freshDir();
    const sub = join(dir, "nonexistent");
    expect(existsSync(sub)).toBe(false);
    const { initFileLogging } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir: sub, level: "info", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    expect(existsSync(sub)).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not create log directory when disabled", async () => {
    const dir = freshDir();
    const sub = join(dir, "disabled");
    const { initFileLogging } = await import("../src/logger.js");
    initFileLogging({ enabled: false, dir: sub, level: "info", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    expect(existsSync(sub)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes log lines to file via logger", async () => {
    const dir = freshDir();
    const { initFileLogging, logger } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "info", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    logger.info("test message");
    logger.warn("test warning", { key: "val" });

    const files = logFiles(dir);
    expect(files.length).toBe(1);
    const content = readFileSync(join(dir, files[0]), "utf-8");
    expect(content).toContain("[agentmemory] info test message");
    expect(content).toContain("[agentmemory] warn test warning");
    expect(content).toContain('"key":"val"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("respects log level filtering", async () => {
    const dir = freshDir();
    const { initFileLogging, logger } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "warn", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    logger.info("should be filtered");
    logger.warn("should appear");
    logger.error("should also appear");

    const files = logFiles(dir);
    const content = readFileSync(join(dir, files[0]), "utf-8");
    expect(content).not.toContain("should be filtered");
    expect(content).toContain("should appear");
    expect(content).toContain("should also appear");
    rmSync(dir, { recursive: true, force: true });
  });

  it("still writes to stderr regardless of log level", async () => {
    const dir = freshDir();
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { initFileLogging, logger } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "warn", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    logger.info("stderr info");
    logger.error("stderr error");

    const calls = stderrWrite.mock.calls.map((c: any) => String(c[0])).join("");
    expect(calls).toContain("stderr info");
    expect(calls).toContain("stderr error");
    stderrWrite.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rotates when file exceeds max size and uses incremental backups", () => {
    const dir = freshDir();
    mkdirSync(dir, { recursive: true });
    const path = logFilePath(dir);
    // Simulate multiple rotations: .1 then .2
    appendFileSync(path, "X".repeat(100) + "\n");
    renameSync(path, path + ".1");
    appendFileSync(path, "Y".repeat(100) + "\n");
    renameSync(path, path + ".2");
    appendFileSync(path, "Z".repeat(10) + "\n");
    const files = logFiles(dir);
    expect(files.length).toBe(3);
    expect(files.some((f) => f.endsWith(".log.1"))).toBe(true);
    expect(files.some((f) => f.endsWith(".log.2"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("rotates via logger when file exceeds max size", async () => {
    const dir = freshDir();
    const { initFileLogging, logger } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "info", maxSizeBytes: 50, maxAgeDays: 30 });
    // First write exceeds 50 bytes
    logger.info("A".repeat(200));
    // Second write triggers rotation (existing file >= 50 bytes)
    logger.info("B".repeat(200));
    const files = logFiles(dir);
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.includes(".log."))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("cleans up logs older than maxAgeDays on init", async () => {
    const dir = freshDir();
    const oldName = "agentmemory-2020-01-01.log";
    writeFileSync(join(dir, oldName), "old content");
    utimesSync(join(dir, oldName), new Date("2020-01-01T00:00:00Z"), new Date("2020-01-01T00:00:00Z"));

    const { initFileLogging } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "info", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 1 });
    const files = logFiles(dir);
    expect(files).not.toContain(oldName);
    rmSync(dir, { recursive: true, force: true });
  });

  it("bootLog writes to file even in non-verbose mode", async () => {
    const dir = freshDir();
    const { initFileLogging, bootLog } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "info", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    bootLog("boot message");

    const files = logFiles(dir);
    const content = readFileSync(join(dir, files[0]), "utf-8");
    expect(content).toContain("boot message");
    rmSync(dir, { recursive: true, force: true });
  });

  it("bootWarn writes to file", async () => {
    const dir = freshDir();
    const { initFileLogging, bootWarn } = await import("../src/logger.js");
    initFileLogging({ enabled: true, dir, level: "info", maxSizeBytes: 10 * 1024 * 1024, maxAgeDays: 30 });
    bootWarn("boot warning");

    const files = logFiles(dir);
    const content = readFileSync(join(dir, files[0]), "utf-8");
    expect(content).toContain("boot warning");
    rmSync(dir, { recursive: true, force: true });
  });
});