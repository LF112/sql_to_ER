import type {
  AttributeLabelMode,
  EREdgeModel,
  ERNodeModel,
  GraphLike,
  ParsedRelationship,
  ParsedTable,
} from "../types";
import { generateChenModelData } from "../builder";

interface MutableGraph extends GraphLike {
  removeItem(item: unknown): void;
  addItem(type: "node" | "edge", model: Record<string, unknown>): void;
}

interface RelPair {
  source: string;
  target: string;
  label: string;
}

const SIMPLIFIED_EDGE_TYPE = "simplified-relationship";

/** 从图中收集当前所有关系对应的实体对（在删除菱形之前调用）。 */
const collectRelPairs = (graph: MutableGraph): RelPair[] => {
  const pairs: RelPair[] = [];
  const relNodes = graph
    .getNodes()
    .filter((n) => (n.getModel() as ERNodeModel).nodeType === "relationship");
  const relIds = new Set(relNodes.map((n) => (n.getModel() as ERNodeModel).id));

  // 为每个关系节点找到它的两端实体和标签
  relNodes.forEach((relNode) => {
    const relModel = relNode.getModel() as ERNodeModel;
    const relId = relModel.id;
    let sourceEntity = "";
    let targetEntity = "";
    let fromLabel = "N";
    let toLabel = "1";

    graph.getEdges().forEach((e) => {
      const m = e.getModel();
      if (m.edgeType === "entity-relationship" && m.target === relId) {
        sourceEntity = m.source;
        fromLabel = m.label || "N";
      }
      if (m.edgeType === "relationship-entity" && m.source === relId) {
        targetEntity = m.target;
        toLabel = m.label || "1";
      }
    });

    if (sourceEntity && targetEntity) {
      // N:1 → 只显示 N；1:1 → 只显示 1
      const label = fromLabel !== "1" ? fromLabel : toLabel !== "1" ? toLabel : "1";
      pairs.push({ source: sourceEntity, target: targetEntity, label });
    }
  });

  return pairs;
};

/** 隐藏关系菱形，替换为实体间的简化连线。 */
export const hideRelationships = (
  graph: MutableGraph | null | undefined,
  tables?: ParsedTable[] | null,
  relationships?: ParsedRelationship[] | null,
) => {
  if (!graph || graph.destroyed) return;

  // 1. 收集实体对
  const pairs = collectRelPairs(graph);

  // 2. 移除关系菱形及其连边
  graph.setAutoPaint(false);
  const relNodes = graph
    .getNodes()
    .filter((n) => (n.getModel() as ERNodeModel).nodeType === "relationship")
    .slice();
  const relIds = new Set(relNodes.map((n) => (n.getModel() as ERNodeModel).id));
  const edgesToRemove = graph
    .getEdges()
    .filter((e) => {
      const m = e.getModel();
      return relIds.has(m.source) || relIds.has(m.target);
    })
    .slice();
  edgesToRemove.forEach((e) => graph.removeItem(e));
  relNodes.forEach((n) => graph.removeItem(n));

  // 3. 添加简化连线
  pairs.forEach((pair, i) => {
    const edgeId = `simprel-${pair.source}-${pair.target}-${i}`;
    if (graph.findById(edgeId)) return;
    graph.addItem("edge", {
      id: edgeId,
      source: pair.source,
      target: pair.target,
      label: pair.label,
      type: "line",
      edgeType: SIMPLIFIED_EDGE_TYPE,
      style: {
        stroke: "#64748b",
        lineWidth: 1.5,
      },
      labelCfg: {
        style: {
          fill: "#64748b",
          fontSize: 12,
          fontWeight: "bold",
          background: { fill: "#fff", padding: [2, 4, 2, 4], radius: 2 },
        },
      },
    });
  });

  graph.paint();
  graph.setAutoPaint(true);
};

export interface ShowRelationshipsOptions {
  graph: MutableGraph | null | undefined;
  tables: ParsedTable[] | null | undefined;
  relationships: ParsedRelationship[] | null | undefined;
  labelMode: AttributeLabelMode | string;
  isColored: boolean;
}

/** 移除简化连线，恢复关系菱形和原始连边。 */
export const showRelationships = ({
  graph,
  tables,
  relationships,
  labelMode,
  isColored,
}: ShowRelationshipsOptions) => {
  if (!graph || graph.destroyed || !tables || !relationships) return;

  // 1. 移除所有简化连线
  graph.setAutoPaint(false);
  const simplifiedEdges = graph
    .getEdges()
    .filter((e) => {
      const m = e.getModel();
      return m.edgeType === SIMPLIFIED_EDGE_TYPE;
    })
    .slice();
  simplifiedEdges.forEach((e) => graph.removeItem(e));

  if (relationships.length === 0) {
    graph.paint();
    graph.setAutoPaint(true);
    return;
  }

  // 2. 重新生成关系数据
  const { nodes: allNodes, edges: allEdges } = generateChenModelData(
    tables,
    relationships,
    isColored,
    labelMode,
    true,
  );

  const relNodes = allNodes.filter((n) => n.nodeType === "relationship");
  const relEdges = allEdges.filter(
    (e: EREdgeModel) =>
      e.edgeType === "entity-relationship" || e.edgeType === "relationship-entity",
  );
  const placeholderEntities = allNodes.filter(
    (n) => n.nodeType === "entity" && n.isPlaceholder && !graph.findById(n.id),
  );

  // 3. 导入新节点/边（跳过已存在的）
  placeholderEntities.forEach((n) =>
    graph.addItem("node", n as unknown as Record<string, unknown>),
  );
  relNodes.forEach((n) => {
    if (!graph.findById(n.id)) {
      graph.addItem("node", n as unknown as Record<string, unknown>);
    }
  });
  relEdges.forEach((e) => {
    if (e.id && !graph.findById(e.id)) {
      graph.addItem("edge", e as unknown as Record<string, unknown>);
    }
  });

  graph.paint();
  graph.setAutoPaint(true);
};
