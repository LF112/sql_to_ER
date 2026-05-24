import type { ERNodeModel, GraphLike } from "../types";

interface SelectableGraph extends GraphLike {
  on(event: string, handler: (e: any) => void): void;
  setItemState(item: unknown, state: string, value: boolean): void;
  removeItem(item: unknown): void;
}

export interface SelectionController {
  getSelectedNodeId: () => string | null;
  getSelectedNode: () => any;
  getSelectedEdgeId: () => string | null;
  getSelectedEdge: () => any;
  clearSelection: () => void;
}

/**
 * Click any node or edge to select it. Click canvas to clear.
 * Delete must be handled externally via the returned controller.
 */
export function attachNodeSelection(graph: SelectableGraph): SelectionController {
  let selectedNode: any = null;
  let selectedId: string | null = null;
  let selectedEdge: any = null;
  let selectedEdgeId: string | null = null;

  const clearNodeSelection = () => {
    if (selectedNode && !selectedNode.destroyed) {
      graph.setItemState(selectedNode, "selected", false);
      graph.updateItem(selectedNode, {});
    }
    selectedNode = null;
    selectedId = null;
  };

  const clearEdgeSelection = () => {
    if (selectedEdge && !selectedEdge.destroyed) {
      graph.setItemState(selectedEdge, "selected", false);
      graph.updateItem(selectedEdge, {});
    }
    selectedEdge = null;
    selectedEdgeId = null;
  };

  const clearSelection = () => {
    clearNodeSelection();
    clearEdgeSelection();
  };

  const selectNode = (node: any) => {
    if (selectedNode === node) return;
    clearEdgeSelection();
    clearNodeSelection();
    selectedNode = node;
    const model = node.getModel() as ERNodeModel;
    selectedId = model?.id ?? null;
    graph.setItemState(node, "selected", true);
    graph.updateItem(node, {});
  };

  const selectEdge = (edge: any) => {
    if (selectedEdge === edge) return;
    clearNodeSelection();
    clearEdgeSelection();
    selectedEdge = edge;
    const model = edge.getModel();
    selectedEdgeId = model?.id ?? null;
    graph.setItemState(edge, "selected", true);
    graph.updateItem(edge, {});
  };

  graph.on("node:click", (e: any) => {
    const node = e.item;
    if (!node || typeof node.getModel !== "function") {
      clearSelection();
      return;
    }
    selectNode(node);
  });

  graph.on("edge:click", (e: any) => {
    const edge = e.item;
    if (!edge || typeof edge.getModel !== "function") {
      clearSelection();
      return;
    }
    selectEdge(edge);
  });

  graph.on("canvas:click", () => {
    clearSelection();
  });

  return {
    getSelectedNodeId: () => selectedId,
    getSelectedNode: () => selectedNode,
    getSelectedEdgeId: () => selectedEdgeId,
    getSelectedEdge: () => selectedEdge,
    clearSelection,
  };
}
