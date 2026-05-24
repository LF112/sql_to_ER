import type { GraphLike } from "../types";

export interface BoundaryRectOptions {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  visible: boolean;
}

export interface BoundaryBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boundaryToBox(opts: {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}): BoundaryBox {
  return {
    minX: opts.centerX - opts.width / 2,
    minY: opts.centerY - opts.height / 2,
    maxX: opts.centerX + opts.width / 2,
    maxY: opts.centerY + opts.height / 2,
  };
}

/**
 * 在 G6 画布上绘制/更新/隐藏布局边界矩形。
 */
export function updateBoundaryRect(
  graph: GraphLike & { get(key: string): any },
  opts: BoundaryRectOptions,
): void {
  const group: any = graph.get("group");
  if (!group) return;

  let shape = group.find((e: any) => e.get?.("name") === "boundary-rect") as any;

  if (!opts.visible) {
    if (shape) shape.remove();
    return;
  }

  const attrs = {
    x: opts.centerX - opts.width / 2,
    y: opts.centerY - opts.height / 2,
    width: opts.width,
    height: opts.height,
    stroke: "#94a3b8",
    lineWidth: 2,
    lineDash: [8, 4],
    fill: "#fafafa",
    fillOpacity: 0.15,
  };

  if (shape) {
    shape.attr(attrs);
  } else {
    shape = group.addShape("rect", {
      attrs,
      name: "boundary-rect",
      capture: false,
    });
  }

  shape.toBack();
}

/** 将图中所有节点位置夹回到边界内，每条边留 nodeRadius 余量。 */
export function clampNodesToBoundary(graph: GraphLike, box: BoundaryBox, nodeRadius = 50): void {
  graph.setAutoPaint(false);
  graph.getNodes().forEach((n) => {
    const m = n.getModel();
    const x = (m.x as number) ?? 0;
    const y = (m.y as number) ?? 0;
    const margin = nodeRadius + 4;
    const cx = Math.max(box.minX + margin, Math.min(box.maxX - margin, x));
    const cy = Math.max(box.minY + margin, Math.min(box.maxY - margin, y));
    if (cx !== x || cy !== y) {
      graph.updateItem(n, { x: cx, y: cy }, false);
    }
  });
  graph.paint();
  graph.setAutoPaint(true);
}
