import { useEffect } from "react";
import type { MutableRefObject } from "react";
import type { GraphLike } from "../types";
import type { HistoryManager } from "../history";
import { patchRelationshipLinkPoints } from "../builder";

interface Options {
  graphRef: MutableRefObject<GraphLike | null>;
  historyRef: MutableRefObject<HistoryManager>;
}

const isEditableTarget = (el: EventTarget | null): boolean => {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return !!(el.closest && el.closest(".cm-editor"));

};

// 全局快捷键：Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Y 或 Ctrl/Cmd+Shift+Z 重做。
export function useUndoRedoShortcuts({ graphRef, historyRef }: Options) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;
      if (isEditableTarget(e.target)) return;

      const graph = graphRef.current;
      if (!graph || graph.destroyed) return;

      const isRedo = key === "y" || (key === "z" && e.shiftKey);

      e.preventDefault();
      const onFinish = () => {
        try {
          patchRelationshipLinkPoints(graph);
        } catch (_) {}
      };
      const action = isRedo ? "redo" : "undo";
      historyRef.current[action](graph, { onFinish });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [graphRef, historyRef]);
}
