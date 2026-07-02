import { useEffect, useRef } from "react";
import type { BuilderDocument, Device, WidgetType } from "@/lib/builder/types";
import { WIDGET_MAP } from "@/lib/builder/registry";
import { parseGlobalWidgetData, type GlobalWidgetData } from "@/lib/builder/globalWidgets";
import { BuilderRenderer } from "../../../BuilderRenderer";
import { SectionDropZone } from "./SectionDropZone";
import type { Selection } from "./types";
import { safeParseBuilderDoc } from "@/lib/builder/schema";

/** Drag payload for a global-widget instance dragged from the palette. */
export interface GlobalDragPayload { id: string; data: GlobalWidgetData }

export const GLOBAL_WIDGET_MIME = "application/x-global-widget";

/** Parse + validate the palette's global-widget drag payload. */
export function readGlobalDragPayload(raw: string): GlobalDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; data?: unknown };
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    const data = parseGlobalWidgetData(parsed.data);
    return data ? { id: parsed.id, data } : null;
  } catch {
    return null;
  }
}

// Auto-scroll while dragging: px from the viewport edge where scrolling kicks
// in, and the max scroll speed (px/frame) reached right at the edge.
const AUTO_SCROLL_EDGE_PX = 90;
const AUTO_SCROLL_MAX_SPEED = 22;

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
  onDropNewWidgetToColumn: (colId: string, type: WidgetType, global?: GlobalDragPayload) => void;
  onDropNewWidgetNear: (targetWidgetId: string, pos: "before" | "after", type: WidgetType, global?: GlobalDragPayload) => void;
  onDropNewWidgetToSection: (sectionId: string, type: WidgetType, global?: GlobalDragPayload) => void;
  firstLabel: string; lastLabel: string;
}) {
  const safeDoc = safeParseBuilderDoc(doc);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ kind: "widget" | "section"; id: string } | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const dragGhostRef = useRef<HTMLElement | null>(null);

  // Selection runs in React's capture phase so it fires BEFORE the native
  // capture listener below stops the event. That listener kills navigation
  // (native <a href>, TanStack Link, programmatic navigate() in onClick) so
  // clicking a widget in the builder edits it instead of jumping to the
  // target page.
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const w = el.closest("[data-widget-id]") as HTMLElement | null;
    if (w?.dataset.widgetId) { setSelection({ kind: "widget", id: w.dataset.widgetId }); return; }
    const c = el.closest("[data-col-id]") as HTMLElement | null;
    if (c?.dataset.colId) { setSelection({ kind: "column", id: c.dataset.colId }); return; }
    const s = el.closest("[data-sec-id]") as HTMLElement | null;
    if (s?.dataset.secId) { setSelection({ kind: "section", id: s.dataset.secId }); return; }
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
      root.querySelectorAll<HTMLElement>(".is-drop-before,.is-drop-after,.is-drop-left,.is-drop-right,.is-drop-into")
        .forEach((el) => el.classList.remove("is-drop-before", "is-drop-after", "is-drop-left", "is-drop-right", "is-drop-into"));
    };

    const isLibraryDrag = (e: DragEvent) => {
      const types = Array.from(e.dataTransfer?.types || []);
      return types.includes("application/x-widget-type") || types.includes(GLOBAL_WIDGET_MIME);
    };

    const setDragging = (on: boolean) => {
      if (on) root.setAttribute("data-canvas-dragging", "1");
      else root.removeAttribute("data-canvas-dragging");
    };

    // ---- auto-scroll: keep scrolling the page while the pointer hovers near
    // the viewport edge, so long documents are reachable mid-drag.
    const stopAutoScroll = () => {
      autoScrollSpeedRef.current = 0;
      if (autoScrollRafRef.current !== null) {
        cancelAnimationFrame(autoScrollRafRef.current);
        autoScrollRafRef.current = null;
      }
    };
    const autoScrollStep = () => {
      if (autoScrollSpeedRef.current === 0) { autoScrollRafRef.current = null; return; }
      window.scrollBy(0, autoScrollSpeedRef.current);
      autoScrollRafRef.current = requestAnimationFrame(autoScrollStep);
    };
    const updateAutoScroll = (clientY: number) => {
      const vh = window.innerHeight;
      let speed = 0;
      if (clientY < AUTO_SCROLL_EDGE_PX) {
        speed = -Math.ceil(((AUTO_SCROLL_EDGE_PX - clientY) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED);
      } else if (clientY > vh - AUTO_SCROLL_EDGE_PX) {
        speed = Math.ceil(((clientY - (vh - AUTO_SCROLL_EDGE_PX)) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_SPEED);
      }
      autoScrollSpeedRef.current = speed;
      if (speed !== 0 && autoScrollRafRef.current === null) {
        autoScrollRafRef.current = requestAnimationFrame(autoScrollStep);
      }
    };

    // ---- custom drag image: a compact labeled pill instead of the browser's
    // full-size element screenshot (which obscures drop targets).
    const removeDragGhost = () => {
      dragGhostRef.current?.remove();
      dragGhostRef.current = null;
    };
    const setDragGhost = (e: DragEvent, label: string) => {
      if (!e.dataTransfer) return;
      const ghost = document.createElement("div");
      ghost.textContent = label;
      ghost.style.cssText = [
        "position:fixed", "top:-1000px", "left:-1000px", "z-index:9999",
        "padding:4px 10px", "border-radius:999px",
        "background:var(--brand, #2563eb)", "color:var(--brand-foreground, #fff)",
        "font-size:11px", "font-weight:700", "letter-spacing:.02em",
        "box-shadow:0 8px 24px rgba(0,0,0,.25)", "pointer-events:none",
        "max-width:220px", "overflow:hidden", "text-overflow:ellipsis", "white-space:nowrap",
      ].join(";");
      document.body.appendChild(ghost);
      dragGhostRef.current = ghost;
      try { e.dataTransfer.setDragImage(ghost, 12, 12); } catch { removeDragGhost(); }
    };

    const onDragStart = (e: DragEvent) => {
      const t = e.target as HTMLElement;
      const w = t.closest?.("[data-widget-id]") as HTMLElement | null;
      if (w && w.dataset.widgetId) {
        e.stopPropagation();
        dragRef.current = { kind: "widget", id: w.dataset.widgetId };
        e.dataTransfer?.setData("text/plain", w.dataset.widgetId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        const type = w.dataset.debugType as WidgetType | undefined;
        setDragGhost(e, (type && WIDGET_MAP[type]?.label) || "Widget");
        setDragging(true);
        return;
      }
      const s = t.closest?.("[data-sec-id]") as HTMLElement | null;
      if (s && s.dataset.secId) {
        dragRef.current = { kind: "section", id: s.dataset.secId };
        e.dataTransfer?.setData("text/plain", s.dataset.secId);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        setDragGhost(e, "Sekcja");
        setDragging(true);
      }
    };

    const onDragEnd = () => { setDragging(false); clearDropMarkers(); stopAutoScroll(); removeDragGhost(); };

    /**
     * before/after for a hovered widget: inline widgets flow horizontally, so
     * their split axis is X (left/right markers); block widgets split on Y.
     */
    const dropPosition = (e: DragEvent, widget: HTMLElement): { pos: "before" | "after"; inline: boolean } => {
      const inline = widget.dataset.widgetLayout === "inline";
      const r = widget.getBoundingClientRect();
      const pos = inline
        ? (e.clientX < r.left + r.width / 2 ? "before" : "after")
        : (e.clientY < r.top + r.height / 2 ? "before" : "after");
      return { pos, inline };
    };

    const onDragOver = (e: DragEvent) => {
      const lib = isLibraryDrag(e);
      if (!dragRef.current && !lib) return;
      if (lib) setDragging(true);
      updateAutoScroll(e.clientY);

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
        const { pos, inline } = dropPosition(e, widget);
        widget.classList.add(
          inline ? (pos === "before" ? "is-drop-left" : "is-drop-right")
                 : (pos === "before" ? "is-drop-before" : "is-drop-after"),
        );
        return;
      }
      if (col) { col.classList.add("is-drop-into"); return; }
      if (sec) sec.classList.add("is-drop-into");
    };

    const onDragLeave = (e: DragEvent) => {
      if (!root.contains(e.relatedTarget as Node)) { clearDropMarkers(); setDragging(false); stopAutoScroll(); }
    };

    const onDrop = (e: DragEvent) => {
      clearDropMarkers();
      setDragging(false);
      stopAutoScroll();
      removeDragGhost();
      const drag = dragRef.current;
      dragRef.current = null;
      const t = e.target as HTMLElement;

      const globalPayload = readGlobalDragPayload(e.dataTransfer?.getData(GLOBAL_WIDGET_MIME) ?? "");
      const newType = globalPayload?.data.type
        ?? (e.dataTransfer?.getData("application/x-widget-type") as WidgetType);
      if (newType) {
        e.preventDefault(); e.stopPropagation();
        const widget = t.closest?.("[data-widget-id]") as HTMLElement | null;
        if (widget && widget.dataset.widgetId) {
          const { pos } = dropPosition(e, widget);
          onDropNewWidgetNear(widget.dataset.widgetId, pos, newType, globalPayload ?? undefined);
          return;
        }
        const col = t.closest?.("[data-col-id]") as HTMLElement | null;
        if (col && col.dataset.colId) { onDropNewWidgetToColumn(col.dataset.colId, newType, globalPayload ?? undefined); return; }
        const sec = t.closest?.("[data-sec-id]") as HTMLElement | null;
        if (sec && sec.dataset.secId) onDropNewWidgetToSection(sec.dataset.secId, newType, globalPayload ?? undefined);
        return;
      }

      if (!drag) return;
      if (drag.kind === "widget") {
        e.preventDefault(); e.stopPropagation();
        const targetWidget = t.closest?.("[data-widget-id]") as HTMLElement | null;
        if (targetWidget?.dataset.widgetId && targetWidget.dataset.widgetId !== drag.id) {
          const { pos } = dropPosition(e, targetWidget);
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
    root.addEventListener("dragend", onDragEnd);
    window.addEventListener("dragend", onDragEnd);
    return () => {
      root.removeEventListener("dragstart", onDragStart);
      root.removeEventListener("dragover", onDragOver);
      root.removeEventListener("dragleave", onDragLeave);
      root.removeEventListener("drop", onDrop);
      root.removeEventListener("dragend", onDragEnd);
      window.removeEventListener("dragend", onDragEnd);
      stopAutoScroll();
      removeDragGhost();
    };
  }, [safeDoc, selection, onMoveWidget, onMoveWidgetToColumn, onMoveWidgetToSection, onMoveSection, onDropNewWidgetToColumn, onDropNewWidgetNear, onDropNewWidgetToSection]);

  const ringCss = `
    [data-visual-canvas] [data-widget-id]{position:relative;cursor:grab;outline:1px dashed transparent;outline-offset:2px;border-radius:4px;transition:outline-color .15s}
    [data-visual-canvas] [data-widget-id]:hover{outline-color:color-mix(in oklab, var(--brand) 50%, transparent)}
    [data-visual-canvas] [data-widget-id].is-selected{outline:2px solid var(--brand)}
    [data-visual-canvas] [data-widget-id].is-selected [data-w-id][data-typography-gap-active="1"]{
      position:relative;
      overflow:visible !important;
    }
    [data-visual-canvas] [data-widget-id].is-selected [data-w-id][data-typography-gap-active="1"]::after{
      content:"odstęp: " var(--cms-title-description-gap, "0px");
      position:absolute;
      top:4px;
      right:4px;
      z-index:40;
      padding:2px 6px;
      border-radius:999px;
      background:color-mix(in oklab, var(--brand) 92%, black 8%);
      color:var(--brand-foreground);
      font-size:9px;
      line-height:1.2;
      font-weight:800;
      letter-spacing:.02em;
      box-shadow:0 6px 16px rgba(0,0,0,.18);
      pointer-events:none;
    }
    [data-visual-canvas] [data-widget-id].is-selected [data-w-id][data-typography-gap-active="1"] :is([data-typography-gap-target],.cms-post-excerpt,[data-description-root]){
      position:relative;
      overflow:visible !important;
    }
    [data-visual-canvas] [data-widget-id].is-selected [data-w-id][data-typography-gap-active="1"] :is([data-typography-gap-target],.cms-post-excerpt,[data-description-root])::before{
      content:"";
      position:absolute;
      left:8%;right:8%;
      top:calc(-1 * var(--cms-title-description-gap, 0px));
      height:var(--cms-title-description-gap, 0px);
      min-height:0;
      pointer-events:none;
      z-index:25;
      border-left:1px dashed var(--brand);
      border-right:1px dashed var(--brand);
      background:linear-gradient(to bottom, transparent calc(50% - 1px), color-mix(in oklab, var(--brand) 72%, transparent) calc(50% - 1px), color-mix(in oklab, var(--brand) 72%, transparent) calc(50% + 1px), transparent calc(50% + 1px));
      opacity:.95;
    }
    [data-visual-canvas] [data-widget-id].is-selected [data-w-id][data-typography-gap-active="1"] :is([data-typography-gap-target],.cms-post-excerpt,[data-description-root])::after{
      content:"odstęp";
      position:absolute;
      top:calc(-1 * var(--cms-title-description-gap, 0px) - 7px);
      left:50%;
      transform:translateX(-50%);
      z-index:26;
      padding:1px 5px;
      border-radius:999px;
      background:var(--brand);
      color:var(--brand-foreground);
      font-size:9px;
      line-height:1.25;
      font-weight:700;
      letter-spacing:.02em;
      pointer-events:none;
    }
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
    /* Inline widgets flow horizontally - their insertion markers are vertical bars. */
    [data-visual-canvas] .is-drop-left::before,
    [data-visual-canvas] .is-drop-right::after{
      content:"";position:absolute;top:0;bottom:0;width:3px;background:var(--brand);
      box-shadow:0 0 0 2px color-mix(in oklab, var(--brand) 40%, transparent);
      border-radius:2px;z-index:50;pointer-events:none;
    }
    [data-visual-canvas] .is-drop-left::before{left:-2px}
    [data-visual-canvas] .is-drop-right::after{right:-2px}
    [data-visual-canvas] .is-drop-into{outline:2px dashed var(--brand) !important;outline-offset:-2px;background:color-mix(in oklab, var(--brand) 6%, transparent)}
    /* Global-widget instances: amber accents + a corner badge so editors know
       edits synchronize across every page referencing the global. */
    [data-visual-canvas] [data-widget-id][data-widget-global="1"]{
      outline:1px dashed color-mix(in oklab, #f59e0b 55%, transparent);
      outline-offset:2px;
    }
    [data-visual-canvas] [data-widget-id][data-widget-global="1"]::after{
      content:"Globalny";
      position:absolute;top:-8px;right:6px;z-index:40;
      padding:1px 6px;border-radius:999px;
      background:#f59e0b;color:#1c1917;
      font-size:9px;line-height:1.3;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
      pointer-events:none;
    }
    [data-visual-canvas] [data-widget-id][data-widget-global="1"].is-selected{outline:2px solid #f59e0b}
    /* A/B experiment variants: violet frame + variant ribbon on the canvas. */
    [data-visual-canvas] [data-sec-id][data-ab-variant]{
      outline:1px dashed color-mix(in oklab, #8b5cf6 60%, transparent);
      outline-offset:-2px;position:relative;
    }
    [data-visual-canvas] [data-sec-id][data-ab-variant]::before{
      position:absolute;top:0;left:0;z-index:40;
      padding:2px 8px;border-radius:0 0 6px 0;
      background:#8b5cf6;color:#fff;
      font-size:9px;line-height:1.4;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
      pointer-events:none;
    }
    [data-visual-canvas] [data-sec-id][data-ab-variant="a"]::before{content:"Test A/B - wariant A"}
    [data-visual-canvas] [data-sec-id][data-ab-variant="b"]::before{content:"Test A/B - wariant B"}
    /* Section separator becomes prominent during any drag operation */
    [data-visual-canvas][data-canvas-dragging="1"] [data-section-inserter]{
      margin-top:10px;margin-bottom:10px;
    }
    [data-visual-canvas][data-canvas-dragging="1"] [data-section-inserter] > button{
      height:44px !important;
      border:2px dashed var(--brand) !important;
      background:color-mix(in oklab, var(--brand) 10%, transparent) !important;
      color:var(--brand) !important;
      font-weight:600;
      box-shadow:0 0 0 4px color-mix(in oklab, var(--brand) 14%, transparent);
      animation:cms-dz-pulse 1.2s ease-in-out infinite;
    }
    [data-visual-canvas][data-canvas-dragging="1"] [data-section-inserter] > button svg{
      opacity:1 !important;width:14px;height:14px;
    }
    @keyframes cms-dz-pulse{
      0%,100%{box-shadow:0 0 0 4px color-mix(in oklab, var(--brand) 14%, transparent)}
      50%{box-shadow:0 0 0 6px color-mix(in oklab, var(--brand) 28%, transparent)}
    }
    [data-visual-canvas] a{pointer-events:none}
    [data-visual-canvas] button{pointer-events:none}
    [data-visual-canvas] [data-section-inserter] button,
    [data-visual-canvas] [data-section-inserter] a{pointer-events:auto}
    [data-visual-canvas] img{max-width:100% !important;}
    [data-visual-canvas] img:not([class*="object-cover"]):not([class*="object-fill"]):not([class*="h-"]):not([data-fill-image]){height:auto;object-fit:contain;}
    [data-visual-canvas] img[data-fill-image]{width:100%;height:100%;}
    [data-visual-canvas] video,
    [data-visual-canvas] iframe,
    [data-visual-canvas] svg{max-width:100% !important;height:auto;}
    [data-visual-canvas] *{max-width:100%;min-width:0;}
    /* Mobile: cap every widget to the column width but DON'T force 100% so inline widgets (logo, lang, buttons) keep intrinsic sizes */
    [data-visual-canvas][data-device="mobile"] [data-widget-id]{max-width:100% !important;}
    [data-visual-canvas][data-device="mobile"] [data-widget-id][data-widget-layout="block"]{width:100% !important;}
    [data-visual-canvas][data-device="mobile"] img:not([class*="object-cover"]):not([class*="object-fill"]):not([class*="h-"]):not([data-fill-image]),
    [data-visual-canvas][data-device="mobile"] svg:not([class*="h-"]){max-width:100% !important;height:auto !important;object-fit:contain !important;}
    [data-visual-canvas][data-device="mobile"] img[class*="object-cover"],
    [data-visual-canvas][data-device="mobile"] img[class*="object-fill"]{max-width:100% !important;}
    [data-visual-canvas][data-device="mobile"] img[data-fill-image]{max-width:100% !important;width:100% !important;height:100% !important;}
    [data-visual-canvas][data-device="tablet"] [data-widget-id]{max-width:100% !important;}
    /* Divider/spacer have ~2px intrinsic height which makes them un-clickable
       and "invisible" on the canvas. Give them a real hit target + a persistent
       outline in the builder so they don't appear to vanish after blur. */
    [data-visual-canvas] [data-widget-id][data-debug-type="divider"],
    [data-visual-canvas] [data-widget-id][data-debug-type="spacer"]{
      min-height:28px;
      padding:8px 4px;
      outline:1px dashed color-mix(in oklab, var(--brand) 35%, transparent) !important;
      outline-offset:-2px;
      background:color-mix(in oklab, var(--brand) 3%, transparent);
    }
    [data-visual-canvas] [data-widget-id][data-debug-type="divider"]:hover,
    [data-visual-canvas] [data-widget-id][data-debug-type="spacer"]:hover{
      outline-color:color-mix(in oklab, var(--brand) 65%, transparent) !important;
      background:color-mix(in oklab, var(--brand) 7%, transparent);
    }
    [data-visual-canvas] [data-widget-id][data-debug-type="divider"].is-selected,
    [data-visual-canvas] [data-widget-id][data-debug-type="spacer"].is-selected{
      outline:2px solid var(--brand) !important;
    }
  `;


  const deviceWidth =
    device === "mobile" ? 390
    : device === "tablet" ? 820
    : undefined;

  const frameStyle: React.CSSProperties = deviceWidth
    ? {
        width: `${deviceWidth}px`,
        maxWidth: "100%",
        margin: "0 auto",
        overflowX: "clip",
        boxSizing: "border-box",
      }
    : { width: "100%", maxWidth: "100%", overflowX: "clip", boxSizing: "border-box" };

  return (
    <div data-visual-canvas data-device={device} onClickCapture={onClickCapture} ref={rootRef} style={{ width: "100%", overflowX: "clip" }}>
      <style dangerouslySetInnerHTML={{ __html: ringCss }} />
      <div style={frameStyle}>
        <SectionDropZone onInsert={(cols) => onInsertSection(0, cols)} index={0} prominent label={firstLabel} />
        {safeDoc.sections.map((s, idx) => (
          <div key={s.id} style={{ minWidth: 0, maxWidth: "100%", overflowX: "clip" }}>
            <BuilderRenderer doc={{ ...safeDoc, sections: [s] }} lang={lang} device={device} editorPreview />
            {idx === safeDoc.sections.length - 1 && (
              <SectionDropZone
                onInsert={(cols) => onInsertSection(idx + 1, cols)}
                index={idx + 1}
                prominent
                label={lastLabel}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

