import type { GraphLike } from "../types";
import type { HistoryManager } from "../history";
import type { BoundaryBox } from "./boundaryRect";

interface DraggableGraph extends GraphLike {
  on(event: string, handler: (e: any) => void): void;
  setItemState(item: unknown, state: string, value: boolean): void;
}

export interface DragSyncOptions {
  isForceActive?: () => boolean;
  getBoundary?: () => BoundaryBox | null;
}

const nodeRadius = (m: any): number => {
  const sizes: Record<string, number> = {
    entity: 80,
    relationship: 50,
    attribute: 50,
  };
  return sizes[m?.nodeType] || 50;
};

/**
 * 给 G6 graph 装上交互：
 *   1. node hover 高亮
 *   2. 拖任意节点之前压一次撤销快照
 *   3. 拖实体节点时同步带动它的属性节点（共同位移）
 *   4. 若配置了边界，拖拽结束后夹回边界内
 *
 * 由 useGraph 在创建图后调用一次；不需要解绑（图本身 destroy 时事件随之消失）。
 *
 * 当 isForceActive 返回 true 时，跳过 (3) —— 让持续力导向控制器接管属性节点
 * 的位移；否则两者会同时改 attribute 坐标，互相覆盖。
 */
export function attachEntityDragSync(
  graph: DraggableGraph,
  history: HistoryManager,
  opts?: DragSyncOptions,
): void {
  const isForceActive = opts?.isForceActive;
  const getBoundary = opts?.getBoundary;
  graph.on("node:mouseenter", (e: any) => {
    graph.setItemState(e.item, "hover", true);
  });
  graph.on("node:mouseleave", (e: any) => {
    graph.setItemState(e.item, "hover", false);
  });

  let draggedEntity: any = null;
  let relatedAttributes: any[] = [];
  const dragStartPositions = new Map<string, { x: number; y: number }>();

  graph.on("node:dragstart", (e: any) => {
    const node = e.item;
    const nodeModel = node.getModel();

    // 在任何节点开始被拖动前记录一次快照（用于撤销）
    history.record(graph);

    if (nodeModel.type === "entity") {
      draggedEntity = node;
      relatedAttributes = [];
      dragStartPositions.clear();

      dragStartPositions.set(nodeModel.id, {
        x: nodeModel.x,
        y: nodeModel.y,
      });

      graph.getNodes().forEach((n: any) => {
        const model = n.getModel();
        if (model.type === "attribute" && model.parentEntity === nodeModel.id) {
          relatedAttributes.push(n);
          dragStartPositions.set(model.id, { x: model.x, y: model.y });
        }
      });
    }
  });

  graph.on("node:drag", (e: any) => {
    const node = e.item;
    const nodeModel = node.getModel();

    if (nodeModel.type === "entity" && draggedEntity === node) {
      if (isForceActive && isForceActive()) return;
      const startPos = dragStartPositions.get(nodeModel.id);
      if (startPos) {
        const deltaX = nodeModel.x - startPos.x;
        const deltaY = nodeModel.y - startPos.y;

        relatedAttributes.forEach((attrNode) => {
          const attrModel = attrNode.getModel();
          const attrStartPos = dragStartPositions.get(attrModel.id);
          if (attrStartPos) {
            graph.updateItem(attrNode, {
              x: attrStartPos.x + deltaX,
              y: attrStartPos.y + deltaY,
            });
          }
        });
      }
    }
  });

  graph.on("node:dragend", (e: any) => {
    const node = e.item;
    const nodeModel = node.getModel();

    // 夹回边界内
    const box = getBoundary?.();
    if (box && nodeModel.x != null && nodeModel.y != null) {
      const r = nodeRadius(nodeModel);
      const margin = r + 4;
      const cx = Math.max(box.minX + margin, Math.min(box.maxX - margin, nodeModel.x));
      const cy = Math.max(box.minY + margin, Math.min(box.maxY - margin, nodeModel.y));
      if (cx !== nodeModel.x || cy !== nodeModel.y) {
        graph.updateItem(node, { x: cx, y: cy });
      }
    }

    if (nodeModel.type === "entity" && draggedEntity === node) {
      draggedEntity = null;
      relatedAttributes = [];
      dragStartPositions.clear();
    }
  });
}
