import { existsSync, mkdirSync, appendFileSync, renameSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { LogConfig, LogLevel } from "./types.js";

type Fields = Record<string, unknown> | undefined;

function fmt(level: string, msg: string, fields: Fields): string {
  if (!fields || Object.keys(fields).length === 0) {
    return `[agentmemory] ${level} ${msg}`;
  }
  try {
    return `[agentmemory] ${level} ${msg} ${JSON.stringify(fields)}`;
  } catch {
    return `[agentmemory] ${level} ${msg}`;
  }
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logConfig: LogConfig | null = null;

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function logFilePath(): string {
  return join(logConfig!.dir, `agentmemory-${todayStr()}.log`);
}

function cleanupOldLogs(dir: string, maxAgeDays: number): void {
  try {
    if (!existsSync(dir)) return;
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(dir);
    for (const f of files) {
      if (!f.endsWith(".log")) continue;
      try {
        const stats = statSync(join(dir, f));
        if (stats.mtimeMs < cutoff) {
          unlinkSync(join(dir, f));
        }
      } catch {
      }
    }
  } catch {
  }
}

export function initFileLogging(config: LogConfig): void {
  logConfig = config;
  if (!config.enabled) return;
  try {
    mkdirSync(config.dir, { recursive: true });
    cleanupOldLogs(config.dir, config.maxAgeDays);
  } catch {
  }
}

function fileLog(level: string, msg: string, fields: Fields): void {
  if (!logConfig || !logConfig.enabled) return;
  if (LEVELS[level as LogLevel] < LEVELS[logConfig.level]) return;
  try {
    const dir = logConfig.dir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const path = logFilePath();
    if (existsSync(path)) {
      const stats = statSync(path);
      if (stats.size >= logConfig.maxSizeBytes) {
        let seq = 1;
        let backup = `${path}.${seq}`;
        while (existsSync(backup)) {
          seq++;
          backup = `${path}.${seq}`;
        }
        try {
          renameSync(path, backup);
        } catch {
        }
      }
    }
    appendFileSync(path, fmt(level, msg, fields) + "\n");
  } catch {
  }
}

function emit(level: string, msg: string, fields: Fields): void {
  try {
    process.stderr.write(fmt(level, msg, fields) + "\n");
  } catch {
  }
  fileLog(level, msg, fields);
}

export const logger = {
  info(msg: string, fields?: Fields): void {
    emit("info", msg, fields);
  },
  warn(msg: string, fields?: Fields): void {
    emit("warn", msg, fields);
  },
  error(msg: string, fields?: Fields): void {
    emit("error", msg, fields);
  },
};

let bootVerbose =
  process.env["AGENTMEMORY_VERBOSE"] === "1" ||
  process.env["AGENTMEMORY_VERBOSE"] === "true";

const bootBuffer: string[] = [];

export function setBootVerbose(enabled: boolean): void {
  bootVerbose = enabled;
}

export function isBootVerbose(): boolean {
  return bootVerbose;
}

export function bootLog(msg: string): void {
  fileLog("info", msg, undefined);
  if (bootVerbose) {
    try {
      process.stderr.write(`[agentmemory] ${msg}\n`);
    } catch {
    }
    return;
  }
  if (bootBuffer.length < 500) bootBuffer.push(msg);
}

export function bootWarn(msg: string): void {
  fileLog("warn", msg, undefined);
  try {
    process.stderr.write(`[agentmemory] warn ${msg}\n`);
  } catch {}
}

export function getBootBuffer(): readonly string[] {
  return bootBuffer;
}