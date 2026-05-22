/**
 * History Module - 撤销 / 重做（Undo / Redo）
 *
 * 通过对图中所有节点的 { id, x, y, label } 拍快照实现回退。
 * 能撤销的操作：节点拖拽、双击编辑节点标签、强制对齐、环绕排布、
 * 滚轮旋转、删除节点/边。
 * 不能撤销的操作（会重置历史）：重新生成图、隐藏/显示属性。
 *
 * 删除撤销：快照携带 deletedItems（被删节点/边的完整模型），
 * 撤销时自动通过 graph.addItem 恢复，重做时再次移除。
 */

import { animateNodesToTargets } from "./layout";
import type { GraphLike, NodeSnapshot } from "./types";

const MAX_HISTORY = 100;

export interface DeletedItems {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

interface HistoryEntry {
  positions: NodeSnapshot[];
  deletedItems?: DeletedItems;
}

export interface HistoryApplyOptions {
  animate?: boolean;
  onFinish?: () => void;
}

export interface HistoryManager {
  record(graph: GraphLike, deletedItems?: DeletedItems): void;
  undo(
    graph: GraphLike & { addItem?: (t: string, m: any) => void },
    options?: HistoryApplyOptions,
  ): boolean;
  redo(graph: GraphLike, options?: HistoryApplyOptions): boolean;
  reset(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

function snapshot(graph: GraphLike): NodeSnapshot[] | null {
  if (!graph || graph.destroyed) return null;
  return graph.getNodes().map((node) => {
    const m = node.getModel();
    return { id: m.id, x: m.x, y: m.y, label: m.label };
  });
}

function snapshotsEqual(a: NodeSnapshot[] | null, b: NodeSnapshot[] | null) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.x !== y.x || x.y !== y.y || x.label !== y.label) {
      return false;
    }
  }
  return true;
}

const ANIM_DURATION_MS = 280;

function applySnapshot(
  graph: GraphLike,
  snap: NodeSnapshot[] | undefined,
  options?: HistoryApplyOptions,
) {
  if (!graph || graph.destroyed || !snap) return;
  const opts = options || {};
  const animate = opts.animate !== false;
  const onFinish = typeof opts.onFinish === "function" ? opts.onFinish : null;
  const animator = animate ? animateNodesToTargets : null;

  const targets = new Map<string, { x?: number; y?: number }>();
  graph.setAutoPaint(false);
  snap.forEach((s) => {
    const item = graph.findById(s.id);
    if (!item) return;
    const cur = item.getModel();
    if (cur.label !== s.label) {
      graph.updateItem(item, { label: s.label });
    }
    if (cur.x !== s.x || cur.y !== s.y) {
      targets.set(s.id, { x: s.x, y: s.y });
    }
  });
  graph.paint();
  graph.setAutoPaint(true);

  if (targets.size === 0) {
    if (onFinish) onFinish();
    return;
  }

  if (animator) {
    animator(graph, targets, ANIM_DURATION_MS, onFinish);
  } else {
    graph.setAutoPaint(false);
    targets.forEach((t, id) => {
      const item = graph.findById(id);
      if (item) graph.updateItem(item, { x: t.x, y: t.y });
    });
    graph.refreshPositions();
    graph.paint();
    graph.setAutoPaint(true);
    if (onFinish) onFinish();
  }
}

function restoreDeletedItems(
  graph: GraphLike & { addItem?: (t: string, m: any) => void },
  items: DeletedItems,
) {
  if (!graph.addItem) return;
  graph.setAutoPaint(false);
  items.nodes.forEach((m) => {
    if (!graph.findById(m.id as string)) graph.addItem!("node", m);
  });
  items.edges.forEach((m) => {
    if (m.id && !graph.findById(m.id as string)) graph.addItem!("edge", m);
  });
  graph.paint();
  graph.setAutoPaint(true);
}

function removeDeletedItems(graph: GraphLike, items: DeletedItems) {
  graph.setAutoPaint(false);
  items.edges.forEach((m) => {
    if (m.id) {
      const e = graph.findById(m.id as string);
      if (e) graph.removeItem(e);
    }
  });
  items.nodes.forEach((m) => {
    const n = graph.findById(m.id as string);
    if (n) graph.removeItem(n);
  });
  graph.paint();
  graph.setAutoPaint(true);
}

export function createManager(): HistoryManager {
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];

  return {
    record(graph, deletedItems?) {
      const snap = snapshot(graph);
      if (!snap) return;
      if (
        past.length > 0 &&
        !deletedItems &&
        snapshotsEqual(past[past.length - 1].positions, snap)
      ) {
        return;
      }
      past.push({ positions: snap, deletedItems });
      if (past.length > MAX_HISTORY) past.shift();
      future.length = 0;
    },

    undo(graph, options) {
      if (past.length === 0) return false;
      const cur = snapshot(graph);
      const entry = past.pop()!;
      if (cur) future.push({ positions: cur });
      applySnapshot(graph, entry.positions, options);
      // 恢复该步删除的项
      if (entry.deletedItems) {
        restoreDeletedItems(graph, entry.deletedItems);
      }
      return true;
    },

    redo(graph, options) {
      if (future.length === 0) return false;
      const cur = snapshot(graph);
      const entry = future.pop()!;
      if (cur) past.push({ positions: cur });
      // 重做：重新移除该步恢复的项
      if (entry.deletedItems) {
        removeDeletedItems(graph, entry.deletedItems);
      }
      applySnapshot(graph, entry.positions, options);
      return true;
    },

    reset() {
      past.length = 0;
      future.length = 0;
    },

    canUndo() {
      return past.length > 0;
    },

    canRedo() {
      return future.length > 0;
    },
  };
}
