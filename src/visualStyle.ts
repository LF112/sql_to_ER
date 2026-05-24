import type {
  DiagramVisualSettings,
  EREdgeModel,
  ERNodeModel,
  GraphEdgeLike,
  GraphLike,
  GraphNodeLike,
} from "./types";

export const DEFAULT_DIAGRAM_VISUAL_SETTINGS: DiagramVisualSettings = {
  fontSize: 16,
  lineWidth: 2,
};

export const clampDiagramFontSize = (value: number): number => Math.min(28, Math.max(10, value));
export const clampDiagramLineWidth = (value: number): number => Math.min(6, Math.max(1, value));

export const normalizeDiagramVisualSettings = (
  settings?: Partial<DiagramVisualSettings> | null,
): DiagramVisualSettings => ({
  fontSize: clampDiagramFontSize(settings?.fontSize ?? DEFAULT_DIAGRAM_VISUAL_SETTINGS.fontSize),
  lineWidth: clampDiagramLineWidth(
    settings?.lineWidth ?? DEFAULT_DIAGRAM_VISUAL_SETTINGS.lineWidth,
  ),
});

export const applyDiagramVisualSettingsToData = (
  nodes: ERNodeModel[],
  edges: EREdgeModel[],
  settings?: Partial<DiagramVisualSettings> | null,
): void => {
  const visual = normalizeDiagramVisualSettings(settings);
  nodes.forEach((node) => {
    node.style = { ...(node.style || {}), lineWidth: visual.lineWidth };
    node.labelCfg = {
      ...(node.labelCfg || {}),
      style: { ...(node.labelCfg?.style || {}), fontSize: visual.fontSize },
    };
  });
  edges.forEach((edge) => {
    edge.style = { ...(edge.style || {}), lineWidth: visual.lineWidth };
    edge.labelCfg = {
      ...(edge.labelCfg || {}),
      style: { ...(edge.labelCfg?.style || {}), fontSize: visual.fontSize },
    };
  });
};

export const applyDiagramVisualSettingsToGraph = (
  graph: GraphLike | null | undefined,
  settings?: Partial<DiagramVisualSettings> | null,
): void => {
  if (!graph || graph.destroyed) return;
  const visual = normalizeDiagramVisualSettings(settings);
  graph.setAutoPaint(false);
  graph.getNodes().forEach((node: GraphNodeLike) => {
    const model = node.getModel();
    graph.updateItem(node, {
      style: { ...(model.style || {}), lineWidth: visual.lineWidth },
      labelCfg: {
        ...(model.labelCfg || {}),
        style: { ...(model.labelCfg?.style || {}), fontSize: visual.fontSize },
      },
    });
  });
  graph.getEdges().forEach((edge: GraphEdgeLike) => {
    const model = edge.getModel();
    graph.updateItem(edge, {
      style: { ...(model.style || {}), lineWidth: visual.lineWidth },
      labelCfg: {
        ...(model.labelCfg || {}),
        style: { ...(model.labelCfg?.style || {}), fontSize: visual.fontSize },
      },
    });
  });
  graph.paint();
  graph.setAutoPaint(true);
};

export const applyPkEmphasisToGraph = (
  graph: GraphLike | null | undefined,
  disabled: boolean,
): void => {
  if (!graph || graph.destroyed) return;
  graph.setAutoPaint(false);
  graph.getNodes().forEach((node: GraphNodeLike) => {
    const model = node.getModel();
    const nextFontWeight = disabled
      ? "normal"
      : model.nodeType === "entity" || model.keyType === "pk"
        ? "bold"
        : "normal";
    graph.updateItem(node, {
      pkUnderlineHidden: disabled && model.nodeType === "attribute" && model.keyType === "pk",
      labelCfg: {
        ...(model.labelCfg || {}),
        style: {
          ...(model.labelCfg?.style || {}),
          fontWeight: nextFontWeight,
        },
      },
    });
  });
  graph.paint();
  graph.setAutoPaint(true);
};

export const selectedLineWidth = (settings?: Partial<DiagramVisualSettings> | null): number =>
  normalizeDiagramVisualSettings(settings).lineWidth + 1;

export type { DiagramVisualSettings };
