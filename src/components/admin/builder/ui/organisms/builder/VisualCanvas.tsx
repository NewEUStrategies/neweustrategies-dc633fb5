import { useEffect, useRef } from "react";
import type { BuilderDocument, Device, WidgetType } from "@/lib/builder/types";
import { BuilderRenderer } from "../../../BuilderRenderer";
import { SectionDropZone } from "./SectionDropZone";
import type { Selection } from "./types";

export function VisualCanvas({
  doc, lang, device, selection, setSelection, onInsertSection, onRemoveSection,
  onMoveWidget, onMoveWidgetToColumn, onMoveWidgetToSection, onMoveSection,
  onDropNewWidgetToColumn, onDropNewWidgetNear, onDropNewWidgetToSection,
  firstLabel, lastLabel,
}: {
  doc: BuilderDocument; lang: "pl" | "en"; device: Device;
  selection: Selection; setSelection: (s: Selection) => void;
  onInsertSection: (index: number, colsOrSpans: number | number[]) => void;
  onRemoveSection?: (id: string) => void;
  onMoveWidget: (srcId: string, targetId: string, pos: "before" | "after") => void;
  onMoveWidgetToColumn: (srcId: string, targetColId: string) => void;
  onMoveWidgetToSection: (srcId: string, targetSectionId: string) => void;
  onMoveSection: (srcId: string, targetId: string, pos: "before" | "after") => void;
  onDropNewWidgetToColumn: (colId: string, type: WidgetType) => void;
  onDropNewWidgetNear: (targetWidgetId: string, pos: "before" | "after", type: WidgetType) => void;
  onDropNewWidgetToSection: (sectionId: string, type: WidgetType) => void;
  firstLabel: string; lastLabel: string;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ kind: "widget" | "section"; id: string } | null>(null);

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const w = el.closest("[data-widget-id]") as HTMLElement | null;
    if (w) { e.stopPropagation(); setSelection({ kind: "widget", id: w.dataset.widgetId! }); return; }
    const c = el.closest("[data-col-id]") as HTMLElement | null;
    if (c) { e.stopPropagation(); setSelection({ kind: "column", id: c.dataset.colId! }); return; }
    const s = el.closest("[data-sec-id]") as HTMLElement | null;
    if (s) { e.stopPropagation(); setSelection({ kind: "section", id: s.dataset.secId! }); return; }
    setSelection({ kind: null, id: null });
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const widgets: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>("[data-widget-id]"));
    const sections: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>("[data-sec-id]"));
    const cols: HTMLElement[] = Array.from(root.querySelectorAll<HTMLElement>("[data-col-id]"));

    widgets.forEach((w: HTMLElement) => {
      w.classList.toggle("is-selected", w.dataset.widgetId === selection.id && selection.kind === "widget");
      w.setAttribute("draggable", "true");
    });
    cols.forEach((c: HTMLElement) => {
      c.classList.toggle("is-selected", c.dataset.colId === selection.id && selection.kind === "column");
    });
    sections.forEach((s: HTMLElement) => {
      s.classList.toggle("is-selected", s.dataset.secId === selection.id && selection.kind === "section");
      s.setAttribute("draggable", "true");
    });

    const clearDropMarkers = () => {
      root.querySelectorAll<HTMLElement>(".is-drop-before,.is-drop-after,.is-drop-into")
        .forEach((el) => el.classList.remove("is-drop-before", "is-drop-after", "is-drop-into"));
    };

    const isLibraryDrag = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("application/x-widget-type");

    const onDragStart = (e: DragEvent) => {
      const t = e.target as HTMLElement;
      const w = t.closest?.("[data-widget-id]") as HTMLElement | null;
      if (w && w.dataset.widgetId) {
        e.stopPropagation();
        dragRef.current = { kind: "widget", id: w.dataset.widgetId };
        e.dataTransfer?.setData("text/plain", w.dataset.widgetId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        return;
      }
      const s = t.closest?.("[data-sec-id]") as HTMLElement | null;
      if (s && s.dataset.secId) {
        dragRef.current = { kind: "section", id: s.dataset.secId };
        e.dataTransfer?.setData("text/plain", s.dataset.secId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      }
    };

    const onDragOver = (e: DragEvent) => {
      const lib = isLibraryDrag(e);
      if (!dragRef.current && !lib) return;

      clearDropMarkers();
      const t = e.target as HTMLElement;
      const widget = t.closest?.("[data-widget-id]") as HTMLElement | null;
      const col = t.closest?.("[data-col-id]") as HTMLElement | null;
      const sec = t.closest?.("[data-sec-id]") as HTMLElement | null;
      const hasSectionTarget = !!(widget || col || sec);
      if (lib && !hasSectionTarget) {
        if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
        return;
      }
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = lib ? "copy" : "move";

      if (widget) {
        const r = widget.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        widget.classList.add(before ? "is-drop-before" : "is-drop-after");
        return;
      }
      if (col) { col.classList.add("is-drop-into"); return; }
      if (sec) sec.classList.add("is-drop-into");
    };

    const onDragLeave = (e: DragEvent) => {
      if (!root.contains(e.relatedTarget as Node)) clearDropMarkers();
    };

    const onDrop = (e: DragEvent) => {
      clearDropMarkers();
      const drag = dragRef.current;
      dragRef.current = null;
      const t = e.target as HTMLElement;

      const newType = e.dataTransfer?.getData("application/x-widget-type") as WidgetType;
      if (newType) {
        e.preventDefault(); e.stopPropagation();
        const widget = t.closest?.("[data-widget-id]") as HTMLElement | null;
        if (widget && widget.dataset.widgetId) {
          const r = widget.getBoundingClientRect();
          const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
          onDropNewWidgetNear(widget.dataset.widgetId, pos, newType);
          return;
        }
        const col = t.closest?.("[data-col-id]") as HTMLElement | null;
        if (col && col.dataset.colId) { onDropNewWidgetToColumn(col.dataset.colId, newType); return; }
        const sec = t.closest?.("[data-sec-id]") as HTMLElement | null;
        if (sec && sec.dataset.secId) onDropNewWidgetToSection(sec.dataset.secId, newType);
        return;
      }

      if (!drag) return;
      if (drag.kind === "widget") {
        e.preventDefault(); e.stopPropagation();
        const targetWidget = t.closest?.("[data-widget-id]") as HTMLElement | null;
        if (targetWidget?.dataset.widgetId && targetWidget.dataset.widgetId !== drag.id) {
          const r = targetWidget.getBoundingClientRect();
          const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
          onMoveWidget(drag.id, targetWidget.dataset.widgetId, pos);
          return;
        }

        const targetCol = t.closest?.("[data-col-id]") as HTMLElement | null;
        if (targetCol?.dataset.colId) {
          onMoveWidgetToColumn(drag.id, targetCol.dataset.colId);
          return;
        }

        const targetSection = t.closest?.("[data-sec-id]") as HTMLElement | null;
        if (targetSection?.dataset.secId) {
          onMoveWidgetToSection(drag.id, targetSection.dataset.secId);
        }
      } else {
        const target = t.closest?.("[data-sec-id]") as HTMLElement | null;
        if (!target || !target.dataset.secId || target.dataset.secId === drag.id) return;
        e.preventDefault();
        const r = target.getBoundingClientRect();
        const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
        onMoveSection(drag.id, target.dataset.secId, pos);
      }
    };

    root.addEventListener("dragstart", onDragStart);
    root.addEventListener("dragover", onDragOver);
    root.addEventListener("dragleave", onDragLeave);
    root.addEventListener("drop", onDrop);
    return () => {
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("dragleave", onDragLeave);
      root.removeEventListener("drop", onDrop);
    };
  }, [doc, selection, onMoveWidget, onMoveWidgetToColumn, onMoveWidgetToSection, onMoveSection, onDropNewWidgetToColumn, onDropNewWidgetNear, onDropNewWidgetToSection]);

  const ringCss = `
    [data-visual-canvas] [data-widget-id]{position:relative;cursor:grab;outline:1px dashed transparent;outline-offset:2px;border-radius:4px;transition:outline-color .15s}
    [data-visual-canvas] [data-widget-id]:hover{outline-color:color-mix(in oklab, var(--brand) 50%, transparent)}
    [data-visual-canvas] [data-widget-id].is-selected{outline:2px solid var(--brand)}
    [data-visual-canvas] [data-widget-id]:active{cursor:grabbing}
    [data-visual-canvas] [data-sec-id]{outline:1px dashed transparent;outline-offset:-2px;transition:outline-color .15s}
    [data-visual-canvas] [data-sec-id]:hover{outline-color:color-mix(in oklab, var(--brand) 35%, transparent)}
    [data-visual-canvas] [data-sec-id].is-selected{outline:2px solid var(--brand)}
    [data-visual-canvas] [data-col-id]{
      position:relative;
      min-height:48px;
      outline:1px dashed color-mix(in oklab, var(--brand) 30%, transparent);
      outline-offset:-2px;
      border-radius:4px;
      transition:outline-color .15s, background-color .15s;
    }
    [data-visual-canvas] [data-col-id]:hover{outline-color:color-mix(in oklab, var(--brand) 55%, transparent)}
    [data-visual-canvas] [data-col-id]:empty::before{
      content:"Pusta kolumna";
      position:absolute;inset:0;
      display:flex;align-items:center;justify-content:center;
      font-size:10px;letter-spacing:.06em;text-transform:uppercase;
      color:color-mix(in oklab, var(--brand) 70%, transparent);
      background:color-mix(in oklab, var(--brand) 4%, transparent);
      border-radius:4px;pointer-events:none;
    }
    [data-visual-canvas] .is-drop-before::before,
    [data-visual-canvas] .is-drop-after::after{
      content:"";position:absolute;left:0;right:0;height:3px;background:var(--brand);
      box-shadow:0 0 0 2px color-mix(in oklab, var(--brand) 40%, transparent);
      border-radius:2px;z-index:50;pointer-events:none;
    }
    [data-visual-canvas] .is-drop-before::before{top:-2px}
    [data-visual-canvas] .is-drop-after::after{bottom:-2px}
    [data-visual-canvas] .is-drop-into{outline:2px dashed var(--brand) !important;outline-offset:-2px;background:color-mix(in oklab, var(--brand) 6%, transparent)}
    [data-visual-canvas] a{pointer-events:none}
    [data-visual-canvas] button{pointer-events:none}
    [data-visual-canvas] [data-section-inserter] button,
    [data-visual-canvas] [data-section-inserter] a{pointer-events:auto}
  `;

  return (
    <div data-visual-canvas onClick={onClick} ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: ringCss }} />
      <SectionDropZone onInsert={(cols) => onInsertSection(0, cols)} index={0} prominent label={firstLabel} />
      {doc.sections.map((s, idx) => (
        <div key={s.id}>
          <BuilderRenderer doc={{ ...doc, sections: [s] }} lang={lang} device={device} />
          <SectionDropZone
            onInsert={(cols) => onInsertSection(idx + 1, cols)}
            index={idx + 1}
            prominent={idx === doc.sections.length - 1}
            label={idx === doc.sections.length - 1 ? lastLabel : undefined}
            onRemoveAdjacent={onRemoveSection ? () => onRemoveSection(s.id) : undefined}
            removeLabel="Usuń sekcję powyżej"
          />
        </div>
      ))}
    </div>
  );
}
