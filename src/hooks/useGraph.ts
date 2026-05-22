import { useEffect, useRef, useState } from "react";
import { I18N, type Language } from "../i18n";
import { detectLang } from "../language";
import { parseSQLTables } from "../parser/sql";
import { parseDBML } from "../parser/dbml";
import { generateChenModelData, patchRelationshipLinkPoints } from "../builder";
import {
  applyInitialComponentPositions,
  arrangeLayout,
  forceAlignLayout,
  smoothFitView,
  spreadDisconnectedComponents,
} from "../layout";
import { setupNodeDoubleClickEdit } from "../editor";
import { createManager as createHistoryManager } from "../history";
import * as Snapshots from "../snapshots";
import * as AttributeLayout from "../attributeLayout";
import { hideRelationships, showRelationships } from "../graph/relationshipToggle";
import { createERGraph, buildDefaultLayoutCfg } from "../graph/createERGraph";
import type { LayoutBoundary } from "../graph/createERGraph";
import { updateBoundaryRect, clampNodesToBoundary, boundaryToBox } from "../graph/boundaryRect";
import type { BoundaryBox } from "../graph/boundaryRect";
import { attachEntityDragSync } from "../graph/attachEntityDragSync";
import { attachNodeSelection } from "../graph/attachEntitySelection";

const PX_PER_CM = 96 / 2.54;

export type BoundaryUnit = "px" | "cm";

export interface BoundaryPreset {
  label: string;
  widthCm: number;
  heightCm: number;
}

export const BOUNDARY_PRESETS: Record<string, BoundaryPreset> = {
  a4: { label: "A4", widthCm: 21, heightCm: 29.7 },
  "a4-landscape": { label: "A4 ⟳", widthCm: 29.7, heightCm: 21 },
};

export const cmToPx = (cm: number) => Math.round(cm * PX_PER_CM);
export const pxToCm = (px: number) => Math.round((px / PX_PER_CM) * 10) / 10;
import type { SelectionController } from "../graph/attachEntitySelection";
import { attachForceLoop } from "../graph/forceLoop";
import type { ForceLoopController } from "../graph/forceLoop";
import { updateGraphStyles } from "../graph/updateGraphStyles";
import { useSnapshotPersistence } from "./useSnapshotPersistence";
import type {
  ERNodeModel,
  GraphLike,
  GraphNodeLike,
  ParsedRelationship,
  ParsedTable,
  SnapshotRecord,
} from "../types";
import type { HistoryManager } from "../history";

type Translation = (typeof I18N)[keyof typeof I18N];

export interface GenerateOptions {
  inputText?: string;
  isColored?: boolean;
  showComment?: boolean;
  hideFields?: boolean;
  boundaryWidth?: number;
  boundaryHeight?: number;
  showBoundary?: boolean;
  positionMap?: Map<string, { x?: number; y?: number; label?: string }> | null;
}

export interface UseGraphOptions {
  t: Translation;
  initialLang?: Language;
}

export interface UseGraphResult {
  // refs
  containerRef: ReturnType<typeof useRef<HTMLDivElement | null>>;
  graphRef: ReturnType<typeof useRef<GraphLike | null>>;
  historyRef: ReturnType<typeof useRef<HistoryManager>>;
  lastInputRef: ReturnType<typeof useRef<string>>;
  // state
  inputText: string;
  isColored: boolean;
  showComment: boolean;
  hideFields: boolean;
  hideRelations: boolean;
  forceOn: boolean;
  readOnly: boolean;
  boundaryWidth: number;
  boundaryHeight: number;
  showBoundary: boolean;
  boundaryUnit: BoundaryUnit;
  boundaryConstrain: boolean;
  boundaryRatioLock: boolean;
  hasGraph: boolean;
  error: string | null;
  loading: boolean;
  // mutators (combine setState + side effect when applicable)
  setInputText: (next: string) => void;
  setIsColored: (next: boolean) => void;
  setShowComment: (next: boolean) => void;
  setHideFields: (next: boolean) => void;
  setHideRelations: (next: boolean) => void;
  setForceOn: (next: boolean) => void;
  setReadOnly: (next: boolean) => void;
  setBoundaryWidth: (next: number) => void;
  setBoundaryHeight: (next: number) => void;
  setShowBoundary: (next: boolean) => void;
  setBoundaryUnit: (next: BoundaryUnit) => void;
  setBoundaryConstrain: (next: boolean) => void;
  setBoundaryRatioLock: (next: boolean) => void;
  applyBoundaryPreset: (key: string) => void;
  setError: (next: string | null) => void;
  // commands
  handleGenerate: (opts?: GenerateOptions) => void;
  handleForceAlign: () => void;
  handleArrangeLayout: () => void;
  deleteSelectedNode: () => void;
  restoreFromSnapshot: (snap: SnapshotRecord) => void;
  persistSnapshot: (meta: {
    id: string;
    inputText: string;
    isColored: boolean;
    showComment: boolean;
    hideFields: boolean;
  }) => Promise<void>;
}

/**
 * useGraph 拥有图相关的所有可变状态（输入文本 + 三个视觉开关 + 图实例）
 * 并对外暴露 mutator 而非裸 setState。
 *
 * 设计要点：
 *  - 状态变化通过 mutator 同步触发对应图操作；不再用 useEffect 监听 props
 *    然后用 ref 压制重入（旧的 applied*Ref 模式删除）。
 *  - StrictMode dev 下挂载会跑 setup→cleanup→setup 一次，schedulePersist 投递的
 *    延迟保存被 cancelPendingPersist 吞掉，第二次 setup 重建图。生产模式正常一次。
 *  - pendingSaveTimer 卸载时统一被 useSnapshotPersistence 取消。
 */
export function useGraph({ t, initialLang }: UseGraphOptions): UseGraphResult {
  const lang = initialLang ?? (detectLang() as Language);

  const [inputText, setInputTextState] = useState<string>(I18N[lang].sample);
  const [isColored, setIsColoredState] = useState(true);
  const [showComment, setShowCommentState] = useState(false);
  const [hideFields, setHideFieldsState] = useState(false);
  const [forceOn, setForceOnState] = useState(false);
  const [readOnly, setReadOnlyState] = useState(false);
  const [boundaryWidth, setBoundaryWidthState] = useState(0);
  const [boundaryHeight, setBoundaryHeightState] = useState(0);
  const [showBoundary, setShowBoundaryState] = useState(false);
  const [boundaryUnit, setBoundaryUnitState] = useState<BoundaryUnit>("px");
  const [boundaryConstrain, setBoundaryConstrainState] = useState(true);
  const [boundaryRatioLock, setBoundaryRatioLockState] = useState(false);
  const boundaryRatioRef = useRef(1);
  const [hideRelations, setHideRelationsState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasGraph, setHasGraph] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<GraphLike | null>(null);
  const lastInputRef = useRef("");
  const tablesDataRef = useRef<ParsedTable[] | null>(null);
  const relationshipsRef = useRef<ParsedRelationship[] | null>(null);
  const historyRef = useRef<HistoryManager>(createHistoryManager());
  const forceCtrlRef = useRef<ForceLoopController | null>(null);
  const forceOnRef = useRef(false);
  const readOnlyRef = useRef(false);
  const boundaryConstrainRef = useRef(true);
  const boundaryRef = useRef<{
    width: number;
    height: number;
    visible: boolean;
  }>({ width: 0, height: 0, visible: false });
  const selectionRef = useRef<SelectionController | null>(null);

  // 持有最新的 t/state 供 handleGenerate 在 stale closure 之外读到。
  // mutator 同步走 next 显式参数；这个 ref 主要给"用户直接点 Generate 按钮"
  // 这种没有显式 opts 的路径用。
  const stateRef = useRef({
    inputText,
    isColored,
    showComment,
    hideFields,
    hideRelations,
    readOnly,
    boundaryWidth,
    boundaryHeight,
    showBoundary,
    t,
  });
  stateRef.current = {
    inputText,
    isColored,
    showComment,
    hideFields,
    hideRelations,
    readOnly,
    boundaryWidth,
    boundaryHeight,
    showBoundary,
    t,
  };

  const persistence = useSnapshotPersistence({ graphRef, containerRef });
  const { persistSnapshot, schedulePersist, cancelPendingPersist } = persistence;

  // 公共关闭：智能布局 / 强制对齐 / 切换历史 / 显隐属性 / 重新生成
  // 都会让"持续力导向"复位为关闭。状态、ref、控制器三处同步。
  const disableForceIfOn = () => {
    if (!forceOnRef.current) return;
    forceOnRef.current = false;
    setForceOnState(false);
    forceCtrlRef.current?.setEnabled(false);
  };

  const getBoundaryBox = (): BoundaryBox | null => {
    if (!boundaryConstrainRef.current) return null;
    const b = boundaryRef.current;
    if (b.width <= 0 || b.height <= 0) return null;
    const container = containerRef.current;
    if (!container) return null;
    return boundaryToBox({
      width: b.width,
      height: b.height,
      centerX: container.offsetWidth / 2,
      centerY: 300,
    });
  };

  const handleGenerate = (genOpts: GenerateOptions = {}) => {
    const cur = stateRef.current;
    const useInputText = genOpts.inputText ?? cur.inputText;
    const useIsColored = genOpts.isColored ?? cur.isColored;
    const useShowComment = genOpts.showComment ?? cur.showComment;
    const useHideFields = genOpts.hideFields ?? cur.hideFields;
    const useBoundaryWidth = genOpts.boundaryWidth ?? cur.boundaryWidth;
    const useBoundaryHeight = genOpts.boundaryHeight ?? cur.boundaryHeight;
    const useShowBoundary = genOpts.showBoundary ?? cur.showBoundary;
    const positionMap = genOpts.positionMap ?? null;

    // 同步 boundaryRef 供 force loop / drag sync 等闭包读取最新值
    boundaryRef.current = {
      width: useBoundaryWidth,
      height: useBoundaryHeight,
      visible: useShowBoundary,
    };

    try {
      setError(null);
      setLoading(true);
      // 重新生成 / 历史恢复都会重建图，先把持续力导向开关复位关闭，避免
      // 旧 controller 的状态意外延续到新图。
      disableForceIfOn();

      const trimmed = String(useInputText || "").trim();
      if (!trimmed) {
        setError(cur.t.errEmpty);
        setLoading(false);
        return;
      }

      // 解析放在保存旧图之前：解析失败时不应触发任何 IndexedDB 写入
      // （既不为新输入排程保存，也不为旧图落档），否则会把"用户随手清空 +
      // 粘错语法"的中间状态固化进历史。
      let parsedData = parseSQLTables(trimmed);
      if (parsedData.tables.length === 0) {
        parsedData = parseDBML(trimmed);
      }
      const { tables, relationships } = parsedData;

      if (tables.length === 0) {
        // 无有效表：取消任何挂起的保存、清空画布并以遮罩形式呈现错误。
        // 不写 IndexedDB；不更新 lastInputRef，否则后续的"旧图保存"会以损坏
        // 的输入作 key 把上一次的有效图覆盖掉。
        cancelPendingPersist();
        if (graphRef.current) {
          graphRef.current.clear?.();
          graphRef.current.destroy?.();
          graphRef.current = null;
        }
        selectionRef.current = null;
        historyRef.current.reset();
        tablesDataRef.current = null;
        relationshipsRef.current = null;
        lastInputRef.current = "";
        setHasGraph(false);
        setError(cur.t.errNoTable);
        setLoading(false);
        return;
      }

      // === 解析成功后，再把当前图作为旧 input 的快照存起来 ===
      // 这样用户在"上一份输入"上拖动后的位置不会因为重新生成而丢失。
      // 仅当存在旧图且旧 input 已落档（lastInputRef 非空）时才保存。
      if (graphRef.current && lastInputRef.current) {
        cancelPendingPersist();
        persistSnapshot({
          id: Snapshots.hashInput(lastInputRef.current),
          inputText: lastInputRef.current,
          // 保存"旧图当时使用的设置"，因此用 cur 而非新 opts
          isColored: cur.isColored,
          showComment: cur.showComment,
          hideFields: cur.hideFields,
        });
      }

      lastInputRef.current = trimmed;

      tablesDataRef.current = tables;
      relationshipsRef.current = relationships;

      const { nodes, edges } = generateChenModelData(
        tables,
        relationships,
        useIsColored,
        useShowComment ? "comment" : "name",
        useHideFields,
      );

      if (positionMap) {
        // 恢复历史快照路径：直接按快照位置/标签覆盖
        nodes.forEach((n: ERNodeModel) => {
          const p = positionMap.get(n.id);
          if (p) {
            if (typeof p.x === "number") n.x = p.x;
            if (typeof p.y === "number") n.y = p.y;
            if (p.label !== undefined && p.label !== null) n.label = p.label;
          }
        });
      } else {
        applyInitialComponentPositions(nodes, edges, containerRef.current, 0);
      }

      // Clear previous graph completely
      if (forceCtrlRef.current) {
        forceCtrlRef.current.destroy();
        forceCtrlRef.current = null;
      }
      if (graphRef.current) {
        graphRef.current.clear?.();
        graphRef.current.destroy?.();
        graphRef.current = null;
      }
      historyRef.current.reset();

      const container = containerRef.current as HTMLElement;

      // 恢复路径下不跑力布局；其余使用默认 force2 配置
      let layoutCfg: Record<string, unknown> | undefined;
      let boundary: LayoutBoundary | undefined;
      if (useBoundaryWidth > 0 && useBoundaryHeight > 0) {
        boundary = {
          width: useBoundaryWidth,
          height: useBoundaryHeight,
          centerX: container.offsetWidth / 2,
          centerY: 300,
        };
      }
      if (!positionMap) {
        layoutCfg = buildDefaultLayoutCfg(
          container.offsetWidth,
          {
            tick: () => graph.refreshPositions(),
            onLayoutEnd: () => {
              // 先让互不相连的组件环绕分布，避免十字交叉
              setTimeout(() => {
                if (graphRef.current && !graphRef.current.destroyed) {
                  spreadDisconnectedComponents(graphRef.current, () => {
                    const box = getBoundaryBox();
                    if (box && graphRef.current) {
                      clampNodesToBoundary(graphRef.current, box);
                    }
                    smoothFitView(graphRef.current, 800, "easeOutCubic");
                  });
                }
              }, 30);
            },
          },
          boundary,
        );
      }

      const graph = createERGraph({
        container,
        data: { nodes, edges },
        layoutCfg,
      }) as GraphLike & {
        data: (d: { nodes: unknown; edges: unknown }) => void;
        render: () => void;
      };

      graphRef.current = graph;
      setHasGraph(true);

      graph.data({ nodes, edges });
      graph.render();

      updateGraphStyles(graph, useIsColored);
      patchRelationshipLinkPoints(graph);

      // 初始渲染后使用平滑动画调整视图
      setTimeout(() => smoothFitView(graph, 600, "easeOutQuart"), 200);

      // 等画面安顿好后再为本次输入存一份"初始/恢复后"快照。
      // 力布局 + smoothFitView 总共 ~1s；2.5s 比较稳妥。
      const saveDelay = positionMap ? 600 : 2500;
      schedulePersist(
        {
          id: Snapshots.hashInput(trimmed),
          inputText: trimmed,
          isColored: useIsColored,
          showComment: useShowComment,
          hideFields: useHideFields,
        },
        saveDelay,
      );

      // 双击编辑 + hover/drag 同步
      setupNodeDoubleClickEdit(graph as any, container, {
        onBeforeChange: () => historyRef.current.record(graph),
        canEdit: () => !readOnlyRef.current,
      });
      attachEntityDragSync(graph as any, historyRef.current, {
        isForceActive: () => forceOnRef.current,
        getBoundary: getBoundaryBox,
      });

      // 节点选中（所有类型：实体 / 属性 / 关系）
      selectionRef.current = attachNodeSelection(graph as any);

      // 如果当前在只读模式下，切换到 readonly 模式
      if (readOnlyRef.current) {
        graph.setMode?.("readonly");
      }

      // 绘制布局边界矩形（如果已启用）
      if (graph.get) {
        updateBoundaryRect(graph as any, {
          width: useBoundaryWidth || 800,
          height: useBoundaryHeight || 600,
          centerX: container.offsetWidth / 2,
          centerY: 300,
          visible: !!useShowBoundary,
        });
      }

      // 持续力导向控制器：拖动期间根据斥力 + 连边引力重排其它节点
      const forceCtrl = attachForceLoop(graph as any, {
        getBoundary: getBoundaryBox,
      });
      forceCtrlRef.current = forceCtrl;
      if (forceOnRef.current) forceCtrl.setEnabled(true);
    } catch (e) {
      console.error("SQL Parsing error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      setError(`${cur.t.errParse}: ${msg}${cur.t.errParseHint}`);
    } finally {
      setLoading(false);
    }
  };

  // ─── 属性节点显隐封装（薄包装） ──────────────────────────
  const hideAttributesInGraph = () => {
    historyRef.current.reset();
    AttributeLayout.hideAttributes(
      graphRef.current as unknown as Parameters<typeof AttributeLayout.hideAttributes>[0],
    );
  };
  const showAttributesInGraph = (showComment: boolean, isColored: boolean) => {
    historyRef.current.reset();
    AttributeLayout.showAttributes({
      graph: graphRef.current as unknown as AttributeLayout.ShowAttributesOptions["graph"],
      tables: tablesDataRef.current,
      labelMode: showComment ? "comment" : "name",
      isColored,
      updateStyles: updateGraphStyles,
    });
  };

  // ─── Mutators：setState 与对应图操作绑定到一处 ───────────
  // 不再用 useEffect 监听 props 后用 ref 抑制重入。

  const setInputText = (next: string) => setInputTextState(next);

  const setIsColored = (next: boolean) => {
    setIsColoredState(next);
    if (hasGraph && graphRef.current) {
      updateGraphStyles(graphRef.current, next);
    }
  };

  const setShowComment = (next: boolean) => {
    setShowCommentState(next);
    const graph = graphRef.current;
    if (!hasGraph || !graph || graph.destroyed) return;
    // 不再走 handleGenerate 重建图；直接用每个节点上预先存的 nameLabel /
    // commentLabel 切换 label 字段。布局保持原样，连线在 builder 的 update
    // 里会随节点尺寸变化自动重画（连带的边刷新仍然显式做一次以兜底）。
    graph.setAutoPaint(false);
    graph.getNodes().forEach((node) => {
      const m = node.getModel() as ERNodeModel & {
        nameLabel?: string;
        commentLabel?: string;
      };
      const nameLabel = m.nameLabel;
      const commentLabel = m.commentLabel;
      if (nameLabel === undefined && commentLabel === undefined) return;
      const target = next ? commentLabel || nameLabel || m.label : nameLabel || m.label;
      if (target !== undefined && target !== m.label) {
        graph.updateItem(node, { label: target });
      }
    });
    // 节点尺寸可能因 label 变化而改变，强制让所有边按新 bbox 重算端点。
    graph.getEdges().forEach((edge) => graph.updateItem(edge, {}));
    if (graph.refresh) graph.refresh();
    graph.paint();
    graph.setAutoPaint(true);
  };

  const setHideFields = (next: boolean) => {
    setHideFieldsState(next);
    if (!hasGraph || !graphRef.current || graphRef.current.destroyed) return;
    // 显隐属性会改变节点集合，持续力导向控制器的速度图会失效，先关掉。
    disableForceIfOn();
    if (next) {
      hideAttributesInGraph();
    } else {
      showAttributesInGraph(stateRef.current.showComment, stateRef.current.isColored);
    }
  };

  const setForceOn = (next: boolean) => {
    forceOnRef.current = next;
    setForceOnState(next);
    if (forceCtrlRef.current) forceCtrlRef.current.setEnabled(next);
  };

  const setHideRelations = (next: boolean) => {
    setHideRelationsState(next);
    if (!hasGraph || !graphRef.current || graphRef.current.destroyed) return;
    disableForceIfOn();
    historyRef.current.reset();
    if (next) {
      hideRelationships(
        graphRef.current as unknown as Parameters<typeof hideRelationships>[0],
        tablesDataRef.current,
        relationshipsRef.current,
      );
    } else {
      showRelationships({
        graph: graphRef.current as unknown as Parameters<typeof showRelationships>[0]["graph"],
        tables: tablesDataRef.current,
        relationships: relationshipsRef.current,
        labelMode: stateRef.current.showComment ? "comment" : "name",
        isColored: stateRef.current.isColored,
      });
    }
  };

  const setReadOnly = (next: boolean) => {
    readOnlyRef.current = next;
    setReadOnlyState(next);
    if (graphRef.current && !graphRef.current.destroyed) {
      graphRef.current.setMode?.(next ? "readonly" : "default");
    }
  };

  const applyBoundaryRectToGraph = (w?: number, h?: number, v?: boolean) => {
    const graph = graphRef.current;
    if (!graph || graph.destroyed || !graph.get) return;
    const container = containerRef.current;
    if (!container) return;
    updateBoundaryRect(graph as any, {
      width: (w ?? boundaryWidth) || 800,
      height: (h ?? boundaryHeight) || 600,
      centerX: container.offsetWidth / 2,
      centerY: 300,
      visible: (v ?? showBoundary) && (w ?? boundaryWidth) > 0 && (h ?? boundaryHeight) > 0,
    });
  };

  const setBoundaryWidth = (next: number) => {
    setBoundaryWidthState(next);
    boundaryRef.current = { ...boundaryRef.current, width: next };
    if (boundaryRatioLock && next > 0 && boundaryHeight > 0) {
      const ratio = boundaryRatioRef.current || 1;
      const newH = Math.round(next / ratio);
      setBoundaryHeightState(newH);
      boundaryRef.current = { ...boundaryRef.current, height: newH };
      applyBoundaryRectToGraph(next, newH, undefined);
    } else {
      if (boundaryRatioLock && next > 0) {
        boundaryRatioRef.current = next / (boundaryHeight || 1);
      }
      applyBoundaryRectToGraph(next, undefined, undefined);
    }
  };

  const setBoundaryHeight = (next: number) => {
    setBoundaryHeightState(next);
    boundaryRef.current = { ...boundaryRef.current, height: next };
    if (boundaryRatioLock && next > 0 && boundaryWidth > 0) {
      const ratio = boundaryRatioRef.current || 1;
      const newW = Math.round(next * ratio);
      setBoundaryWidthState(newW);
      boundaryRef.current = { ...boundaryRef.current, width: newW };
      applyBoundaryRectToGraph(newW, next, undefined);
    } else {
      if (boundaryRatioLock && next > 0) {
        boundaryRatioRef.current = (boundaryWidth || 1) / next;
      }
      applyBoundaryRectToGraph(undefined, next, undefined);
    }
  };

  const setShowBoundary = (next: boolean) => {
    setShowBoundaryState(next);
    boundaryRef.current = { ...boundaryRef.current, visible: next };
    applyBoundaryRectToGraph(undefined, undefined, next);
  };

  const setBoundaryConstrain = (next: boolean) => {
    boundaryConstrainRef.current = next;
    setBoundaryConstrainState(next);
  };

  const setBoundaryRatioLock = (next: boolean) => {
    setBoundaryRatioLockState(next);
    if (next && boundaryWidth > 0 && boundaryHeight > 0) {
      boundaryRatioRef.current = boundaryWidth / boundaryHeight;
    }
  };

  const setBoundaryUnit = (next: BoundaryUnit) => {
    setBoundaryUnitState(next);
  };

  const applyBoundaryPreset = (key: string) => {
    const preset = BOUNDARY_PRESETS[key];
    if (!preset) return;
    const w = cmToPx(preset.widthCm);
    const h = cmToPx(preset.heightCm);
    setBoundaryWidthState(w);
    setBoundaryHeightState(h);
    setShowBoundaryState(true);
    setBoundaryUnitState("cm");
    boundaryRef.current = { width: w, height: h, visible: true };
    applyBoundaryRectToGraph(w, h, true);
  };

  const restoreFromSnapshot = (snap: SnapshotRecord) => {
    if (!snap || !snap.nodes) return;
    // 直接刷 React 状态 + 用 opts 覆盖触发一次 handleGenerate
    setInputTextState(snap.inputText);
    setIsColoredState(!!snap.isColored);
    setShowCommentState(!!snap.showComment);
    setHideFieldsState(!!snap.hideFields);

    const positionMap = new Map<string, { x?: number; y?: number; label?: string }>();
    snap.nodes.forEach((n) => {
      positionMap.set(n.id, { x: n.x, y: n.y, label: n.label });
    });

    handleGenerate({
      inputText: snap.inputText,
      isColored: !!snap.isColored,
      showComment: !!snap.showComment,
      hideFields: !!snap.hideFields,
      positionMap,
    });
  };

  // ─── 生命周期 ────────────────────────────────────────────

  // 初次挂载生成示例图。StrictMode dev 会 mount→cleanup→mount，导致
  // 创建-销毁-再创建一次，这是 React 18 的契约：副作用必须 self-healing。
  // 我们 setup 在 effect 里做、teardown 在 cleanup 里做，期间 schedulePersist
  // 投递的延迟保存被 cancelPendingPersist 取消，不会在新图之上误触发旧 meta。
  // 不要试图用 didInitRef 跳过第二次 mount：refs 跨 StrictMode 持久存在，
  // 那样会让第一次 cleanup 销毁图后第二次 mount 跳过重建，最终右侧示例图
  // 永远不出现。
  useEffect(() => {
    handleGenerate();
    return () => {
      cancelPendingPersist();
      forceCtrlRef.current?.destroy();
      forceCtrlRef.current = null;
      selectionRef.current = null;
      graphRef.current?.destroy?.();
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 窗口尺寸变化时同步图表大小
  useEffect(() => {
    const handleResize = () => {
      if (graphRef.current && containerRef.current) {
        graphRef.current.changeSize?.(
          containerRef.current.offsetWidth,
          containerRef.current.offsetHeight,
        );
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Delete 键删除选中节点
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (readOnlyRef.current) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;
      deleteSelectedNode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ─── 命令 ────────────────────────────────────────────────

  const handleForceAlign = () => {
    if (!graphRef.current || graphRef.current.destroyed) return;
    disableForceIfOn();
    historyRef.current.record(graphRef.current);
    const containerWidth = containerRef.current?.offsetWidth || 1200;
    forceAlignLayout(graphRef.current, containerWidth);
    const box = getBoundaryBox();
    if (box) clampNodesToBoundary(graphRef.current, box);
  };

  const handleArrangeLayout = () => {
    if (!graphRef.current || graphRef.current.destroyed) return;
    disableForceIfOn();
    historyRef.current.record(graphRef.current);
    arrangeLayout(graphRef.current);
    const box = getBoundaryBox();
    if (box) clampNodesToBoundary(graphRef.current, box);
  };

  const deleteSelectedNode = () => {
    const graph = graphRef.current;
    const sel = selectionRef.current;
    if (!graph || graph.destroyed || !sel) return;

    // 优先处理选中边
    const selectedEdgeId = sel.getSelectedEdgeId();
    if (selectedEdgeId) {
      const edge = graph.findById(selectedEdgeId);
      if (edge) {
        historyRef.current.reset();
        graph.removeItem(edge);
        sel.clearSelection();
      }
      return;
    }

    const selectedId = sel.getSelectedNodeId();
    if (!selectedId) return;

    const node = graph.findById(selectedId) as GraphNodeLike | null;
    if (!node) return;

    const model = node.getModel() as ERNodeModel;
    const nodeType = model.nodeType;

    // 删除操作后图结构已变，历史栈中的位置快照不再有效
    historyRef.current.reset();

    graph.setAutoPaint(false);

    if (nodeType === "entity") {
      // 1. 收集该实体的所有属性 ID
      const attrIds = graph
        .getNodes()
        .filter((n) => {
          const m = n.getModel() as ERNodeModel;
          return m.nodeType === "attribute" && m.parentEntity === selectedId;
        })
        .map((n) => n.getModel().id);

      // 2. 收集与该实体相连的关系节点 ID
      const relNodeIds = new Set<string>();
      graph.getEdges().forEach((e) => {
        const m = e.getModel();
        if (
          (m.edgeType === "entity-relationship" || m.edgeType === "relationship-entity") &&
          (m.source === selectedId || m.target === selectedId)
        ) {
          relNodeIds.add(m.source === selectedId ? m.target : m.source);
        }
      });

      // 3. 先删属性
      attrIds.forEach((id) => {
        const item = graph.findById(id);
        if (item) graph.removeItem(item);
      });

      // 4. 再删关系节点（G6 自动级联删除其连边）
      relNodeIds.forEach((id) => {
        const item = graph.findById(id);
        if (item) graph.removeItem(item);
      });

      // 5. 最后删实体本身
      graph.removeItem(node);
    } else {
      graph.removeItem(node);
    }

    sel.clearSelection();
    graph.paint();
    graph.setAutoPaint(true);
  };

  return {
    containerRef,
    graphRef,
    historyRef,
    lastInputRef,
    inputText,
    isColored,
    showComment,
    hideFields,
    hideRelations,
    forceOn,
    readOnly,
    boundaryWidth,
    boundaryHeight,
    showBoundary,
    boundaryUnit,
    boundaryConstrain,
    boundaryRatioLock,
    hasGraph,
    error,
    loading,
    setInputText,
    setIsColored,
    setShowComment,
    setHideFields,
    setHideRelations,
    setForceOn,
    setReadOnly,
    setBoundaryWidth,
    setBoundaryHeight,
    setShowBoundary,
    setBoundaryUnit,
    setBoundaryConstrain,
    setBoundaryRatioLock,
    applyBoundaryPreset,
    setError,
    handleGenerate,
    handleForceAlign,
    handleArrangeLayout,
    deleteSelectedNode,
    restoreFromSnapshot,
    persistSnapshot,
  };
}
