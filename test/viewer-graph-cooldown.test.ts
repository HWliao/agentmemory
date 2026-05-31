import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

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

describe("viewer graph force-graph renderer", () => {
  const viewer = readFileSync("src/viewer/index.html", "utf-8");

  it("loads force-graph from the local viewer asset only", () => {
    expect(viewer).toContain('<script nonce="__AGENTMEMORY_VIEWER_NONCE__" src="/force-graph.min.js"></script>');
    expect(viewer).not.toMatch(/cdn\.jsdelivr|unpkg|https:\/\/.*force-graph/i);
  });

  it("initializes a ForceGraph instance with graph/query edge fields", () => {
    expect(viewer).toContain("ForceGraph()");
    expect(viewer).toContain("linkSource('sourceNodeId')");
    expect(viewer).toContain("linkTarget('targetNodeId')");
    expect(viewer).toContain("graphData({ nodes: graphRuntime.nodes, links: graphRuntime.edges })");
  });

  it("replaces the old custom simulation loop contract", () => {
    expect(viewer).not.toContain("function runSimulation");
    expect(viewer).not.toContain("function wakeGraphSim");
    expect(viewer).not.toContain("graphSim.tickCount");
    expect(viewer).not.toContain("requestAnimationFrame(runSimulation)");
  });

  it("exposes session-local progressive loading defaults", () => {
    expect(viewer).toContain("GRAPH_LOAD_BATCH_DEFAULT = 100");
    expect(viewer).toContain("GRAPH_LOAD_INTERVAL_DEFAULT = 100");
    expect(viewer).toContain('id="graph-load-batch"');
    expect(viewer).toContain('id="graph-load-interval"');
  });

  it("places graph controls in the top-right with settings, reset focus, and refresh actions", () => {
    expect(viewer).toContain(".graph-controls { position: absolute; top: 16px; right: 16px;");
    expect(viewer).toContain('data-action="toggle-graph-settings"');
    expect(viewer).toContain('data-action="reset-graph-focus"');
    expect(viewer).toContain('data-action="refresh-graph"');
    expect(viewer).toContain('id="graph-refresh-button"');
    expect(viewer).toContain('id="graph-settings-panel"');
    expect(viewer).toContain('aria-label="Zoom in"');
    expect(viewer).toContain('aria-label="Zoom out"');
    expect(viewer).toContain('aria-label="Recenter graph"');
    expect(viewer).toContain('aria-label="Reset graph focus"');
    expect(viewer).toContain('aria-label="Refresh graph"');
    expect(viewer).toContain('aria-label="Graph settings"');
  });

  it("exposes session-local node size and layout spread tuning controls", () => {
    expect(viewer).toContain("GRAPH_NODE_REL_SIZE_DEFAULT = 4");
    expect(viewer).toContain("GRAPH_NODE_SIZE_SCALE_DEFAULT = 1");
    expect(viewer).toContain("GRAPH_LAYOUT_SPREAD_DEFAULT = 'balanced'");
    expect(viewer).toContain("GRAPH_LAYOUT_SPREAD_PRESETS");
    expect(viewer).toContain("balanced: { nodeSizeScale: 1, chargeStrength: -10, chargeDistanceMin: 50, chargeDistanceMax: 480, linkDistance: 60, alphaDecay: 0.0228, velocityDecay: 0.4 }");
    expect(viewer).toContain("compact: { nodeSizeScale: 1.1, chargeStrength: -6, chargeDistanceMin: 30, chargeDistanceMax: 240, linkDistance: 35, alphaDecay: 0.0228, velocityDecay: 0.48 }");
    expect(viewer).toContain("spacious: { nodeSizeScale: 0.95, chargeStrength: -24, chargeDistanceMin: 80, chargeDistanceMax: 960, linkDistance: 100, alphaDecay: 0.0228, velocityDecay: 0.35 }");
    expect(viewer).toContain('id="graph-node-size-scale"');
    expect(viewer).toContain('id="graph-layout-spread"');
    expect(viewer).toContain("graph-layout-section");
    expect(viewer).toContain('id="graph-custom-charge-strength"');
    expect(viewer).toContain('id="graph-custom-charge-distance-min"');
    expect(viewer).toContain('id="graph-custom-charge-distance-max"');
    expect(viewer).toContain('id="graph-custom-link-distance"');
    expect(viewer).toContain('id="graph-custom-alpha-decay"');
    expect(viewer).toContain('id="graph-custom-velocity-decay"');
    expect(viewer).not.toContain("localStorage.setItem('graph-node");
    expect(viewer).not.toContain("localStorage.getItem('graph-node");
    expect(viewer).not.toContain("localStorage.setItem('graph-layout");
    expect(viewer).not.toContain("localStorage.getItem('graph-layout");
  });

  it("keeps node size importance-based while applying a global visual scale", () => {
    expect(viewer).toContain(".nodeRelSize(graphNodeRelSize())");
    expect(viewer).toContain("function graphNodeRelSize()");
    expect(viewer).toContain("Math.log1p(degree)");
    expect(viewer).toContain("state.graph.nodeSizeScale");
    expect(viewer).toContain("GRAPH_NODE_REL_SIZE_DEFAULT * scale * scale");
    expect(viewer).toContain("var switchedToCustom = false;");
    expect(viewer).toContain("if (switchedToCustom) renderGraphSettingsPanel();");
    expect(viewer).not.toContain(".nodeVal(state.graph.nodeSizeScale)");
  });

  it("applies layout spread presets and custom force values through d3Force", () => {
    expect(viewer).toContain("function applyGraphLayoutForces()");
    expect(viewer).toContain("d3Force('charge')");
    expect(viewer).toContain("d3Force('link')");
    expect(viewer).toContain("charge.strength(config.chargeStrength)");
    expect(viewer).toContain("charge.distanceMin(config.chargeDistanceMin)");
    expect(viewer).toContain("charge.distanceMax(config.chargeDistanceMax)");
    expect(viewer).toContain("link.distance(config.linkDistance)");
    expect(viewer).toContain("d3AlphaDecay(config.alphaDecay)");
    expect(viewer).toContain("d3VelocityDecay(config.velocityDecay)");
    expect(viewer).toContain("d3ReheatSimulation()");
    expect(viewer).toContain("var previousConfig = graphLayoutForceConfig();");
  });

  it("separates reset focus from refresh graph loading", () => {
    expect(viewer).toContain("function resetGraphFocus()");
    expect(viewer).toContain("async function refreshGraph()");
    expect(viewer).toContain("state.graph.refreshing");
    expect(viewer).toContain("renderGraphRefreshState()");
    expect(viewer).toContain("resetGraphFocus();");
    expect(viewer).toContain("button.disabled = !!state.graph.refreshing");
    expect(viewer).toContain("button.setAttribute('aria-label', state.graph.refreshing ? 'Loading graph data' : 'Refresh graph')");
  });

  it("requests graph data once and applies progressive loading on the client", () => {
    expect(viewer).toContain("apiPost('graph/query', {})");
    expect(viewer).toContain("loadGraphBatch()");
    expect(viewer).not.toContain("apiPost('graph/query', { offset:");
    expect(viewer).not.toContain("fetchNextGraphPage");
  });

  it("stops with an error state instead of retrying forever when graph data fails", () => {
    expect(viewer).toContain("state.graph.loadError = 'Graph data failed to load.'");
    expect(viewer).toContain("if (state.graph.loadError)");
  });

  it("escapes force-graph node labels before they reach HTML tooltips", () => {
    const initGraph = extractFunction(viewer, "initGraph");
    expect(initGraph).toContain("return esc(label).replace(/\\n/g, '<br>');");
    expect(initGraph).not.toContain("return (node.name || node.id || '')");
  });

  it("keeps loading cadence page-local instead of persisting it", () => {
    expect(viewer).not.toContain("localStorage.setItem('graph-load");
    expect(viewer).not.toContain('localStorage.setItem("graph-load');
    expect(viewer).not.toContain("localStorage.getItem('graph-load");
    expect(viewer).not.toContain('localStorage.getItem("graph-load');
  });

  it("keeps selection, expand, search, and filter controls wired to force-graph", () => {
    expect(viewer).toContain(".onNodeClick(function(node) { selectGraphNode(node); })");
    expect(viewer).toContain("apiPost('graph/query', { startNodeId: nodeId, maxDepth: 1 })");
    expect(viewer).toContain("bindImeSafeSearch(searchInput, 200, function(v){ graphSearchTerm = v.toLowerCase(); renderGraph(); })");
    expect(viewer).toContain("state.graph.filters[this.dataset.type] = this.checked");
    expect(viewer).toContain(".nodeVisibility(graphNodeVisible)");
    expect(viewer).toContain(".linkVisibility(graphLinkVisible)");
  });

  it("uses cached graph indexes for hot-path connection and focus checks", () => {
    expect(viewer).toContain("nodeById: {}");
    expect(viewer).toContain("adjacency: {}");
    expect(viewer).toContain("function rebuildGraphIndexes()");
    expect(viewer).toContain("function graphConnectionCount(nodeId)");
    expect(viewer).toContain("function graphIsConnectedToFocus(nodeId, focusNodeId)");

    const selectGraphNode = extractFunction(viewer, "selectGraphNode");
    expect(selectGraphNode).toContain("graphConnectionCount(simNode.id)");
    expect(selectGraphNode).not.toContain("edges.filter");

    const graphLinkVisible = extractFunction(viewer, "graphLinkVisible");
    expect(graphLinkVisible).toContain("graphRuntime.nodeById");
    expect(graphLinkVisible).not.toContain("nodes.find");
  });

  it("uses nearby macaron node type colors through one graph color map", () => {
    expect(viewer).toContain("file: '#8DD3A8'");
    expect(viewer).toContain("function: '#8AB6E8'");
    expect(viewer).toContain("concept: '#F4D06F'");
    expect(viewer).toContain("error: '#F28B82'");
    expect(viewer).toContain("decision: '#C7A4E8'");
    expect(viewer).toContain("pattern: '#9BB8FF'");
    expect(viewer).toContain("library: '#F4A261'");
    expect(viewer).toContain("person: '#BDBDBD'");
    expect(viewer).toContain("var color = NODE_COLORS[type] || '#666666';");
    expect(viewer).toContain("var color = NODE_COLORS[type];");
  });
});
