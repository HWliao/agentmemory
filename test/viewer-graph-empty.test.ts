import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function viewerSource(): string {
  return readFileSync("src/viewer/index.html", "utf-8");
}

function extractLoadGraph(source: string): string {
  const match = source.match(/async function loadGraph\(\) \{([\s\S]*?)\r?\n    \}\r?\n\r?\n    var NODE_SHAPES/);
  if (!match) throw new Error("loadGraph body not found");
  return match[1];
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`${name} function not found`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, i);
    }
  }
  throw new Error(`${name} body not found`);
}

describe("viewer graph empty state", () => {
  it("does not automatically build graph data while loading the Graph tab", () => {
    const loadGraph = extractLoadGraph(viewerSource());

    expect(loadGraph).not.toContain("apiPost('graph/build'");
  });

  it("renders a user-initiated empty graph build action and disabled graph messaging", () => {
    const source = viewerSource();

    expect(source).toContain('data-action="build-graph"');
    expect(source).toContain("Graph extraction is disabled");
    expect(source).toContain("graph_extraction_disabled");
  });

  it("opens a rebuild modal before graph/build can run", () => {
    const source = viewerSource();
    const rebuildGraph = extractFunction(source, "rebuildGraph");

    expect(rebuildGraph).not.toContain("apiPost('graph/build'");
    expect(source).toContain('data-action="confirm-rebuild-graph"');
    expect(source).toContain('name="graph-rebuild-mode" value="incremental" checked');
    expect(source).toContain('name="graph-rebuild-mode" value="full"');
    expect(source).toContain("can be expensive and slow");
  });
});
