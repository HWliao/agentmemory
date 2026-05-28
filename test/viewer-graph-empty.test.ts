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
});
