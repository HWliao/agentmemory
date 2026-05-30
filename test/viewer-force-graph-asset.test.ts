import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("viewer force-graph asset pipeline", () => {
  it("declares force-graph as a runtime dependency", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      dependencies?: Record<string, string>;
    };

    expect(pkg.dependencies).toHaveProperty("force-graph");
  });

  it("copies the local force-graph browser bundle into viewer assets", () => {
    const copyScript = readFileSync("scripts/copy-build-assets.mjs", "utf-8");

    expect(copyScript).toContain("node_modules");
    expect(copyScript).toContain("force-graph");
    expect(copyScript).toContain("force-graph.min.js");
    expect(copyScript).toContain('join("viewer", "force-graph.min.js")');
  });

  it("serves the copied dist viewer force-graph asset path", () => {
    const server = readFileSync("src/viewer/server.ts", "utf-8");

    expect(server).toContain('join(base, "viewer", "force-graph.min.js")');
  });

  it("does not reference a remote force-graph CDN in the viewer", () => {
    const viewer = readFileSync("src/viewer/index.html", "utf-8");

    expect(viewer).not.toMatch(/cdn\.jsdelivr|unpkg|https:\/\/.*force-graph/i);
  });
});
