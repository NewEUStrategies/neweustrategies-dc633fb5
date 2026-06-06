// Elementor-style 2-pane builder:
//   LEFT  = contextual panel (widget library when nothing is selected, otherwise
//           Section / Inner / Column / Widget properties) + Navigator drawer.
//   RIGHT = canvas with sections, columns, widgets, floating handles and
//           insertion drop-zones.
// Persistence happens via onChange (called by the parent route on every doc
// mutation; the parent debounces autosave). useHistory wraps onChange so we
// get undo/redo without breaking it.
import { useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import {
  Settings as SettingsIcon, X, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
} from "@/lib/lucide-shim";
import { WIDGETS as _WIDGETS, makeWidget } from "@/lib/builder/registry";
void _WIDGETS;
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode,
  Device, WidgetType, Mode,
} from "@/lib/builder/types";
import { emptyDocument, newId } from "@/lib/builder/types";
import { BuilderModeProvider } from "@/lib/builder/modeContext";
import { useTheme } from "@/components/ThemeProvider";
import {
  cloneSection, cloneColumn, cloneWidget,
  findWidget, findSection, findColumn, findInner,
} from "@/lib/builder/operations";
import { useHistory } from "@/lib/builder/useHistory";
import { useSectionTemplates, type SectionTemplate } from "@/lib/builder/templates";
import { buildHomepageDocument } from "@/lib/builder/homepageTemplate";
import { SectionProperties } from "./SectionProperties";
import { WidgetProperties } from "./WidgetProperties";
import { ColumnProperties } from "./ColumnProperties";
import { WidgetLibrary } from "./WidgetLibrary";
import { Navigator } from "./Navigator";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  Toolbar, CanvasActionBar, EmptyState, SectionDropZone, ChromeFrame,
  SectionView, VisualCanvas,
  type Selection, type SelectionKind,
} from "./ui/organisms/builder";
import { useBuilderClipboard } from "./ui/hooks/useBuilderClipboard";
import { useBuilderShortcuts } from "./ui/hooks/useBuilderShortcuts";
import { ConfirmDeleteDialog } from "./ui/molecules/ConfirmDeleteDialog";
import { BuilderContextMenu, type CtxTarget } from "./ui/molecules/BuilderContextMenu";
import { readClipboard } from "@/lib/builder/clipboard";



interface Props {
  value: BuilderDocument | null;
  onChange: (v: BuilderDocument) => void;
  lang: "pl" | "en";
  onLangChange: (l: "pl" | "en") => void;
  /** Hide the surrounding site Header/Footer preview chrome. */
  hideChrome?: boolean;
  /** Editor scope — controls empty-state copy and drop-zone labels. */
  scope?: "page" | "header" | "footer" | "menu";
}

const SCOPE_COPY = {
  page:   { title: "Zacznij budować stronę", hint: "Wybierz strukturę pierwszej sekcji. Pojawi się między nagłówkiem a stopką.", first: "Wstaw sekcję pod nagłówkiem", last: "Wstaw sekcję nad stopką" },
  header: { title: "Zbuduj nagłówek",        hint: "Dodaj pierwszą sekcję nagłówka (logo, menu, wyszukiwarka).",                first: "Wstaw sekcję nagłówka",      last: "Dodaj sekcję na końcu nagłówka" },
  footer: { title: "Zbuduj stopkę",          hint: "Dodaj pierwszą sekcję stopki (kolumny linków, kontakt, copyright).",       first: "Wstaw sekcję stopki",        last: "Dodaj sekcję na końcu stopki" },
  menu:   { title: "Zbuduj menu",            hint: "Dodaj sekcję z linkami menu — użyj widgetu Link nawigacji.",               first: "Wstaw sekcję menu",          last: "Dodaj sekcję na końcu menu" },
} as const;




const newColumn = (span = 12): ColumnNode => ({
  id: newId(), kind: "column", span: { desktop: span }, children: [],
});
const newSection = (colsOrSpans: number | number[] = 1): SectionNode => {
  const spans = Array.isArray(colsOrSpans)
    ? colsOrSpans
    : Array.from({ length: colsOrSpans }, () => 12 / colsOrSpans);
  return {
    id: newId(), kind: "section",
    children: spans.map((sp) => newColumn(sp)),
  };
};
const newInnerSection = (): InnerSectionNode => ({
  id: newId(), kind: "inner-section",
  columns: [newColumn(6), newColumn(6)],
});

export function Builder({ value, onChange, lang, onLangChange, hideChrome = false, scope = "page" }: Props) {
  const copy = SCOPE_COPY[scope];

  const initial = value ?? emptyDocument();
  const history = useHistory(initial, onChange);
  const doc = history.doc;
  const [device, setDevice] = useState<Device>("desktop");
  // Default canvas preview mode follows the live site theme so the editor
  // shows the same colors/tokens visitors see — keeps admin and prod parity.
  const { theme } = useTheme();
  const [mode, setMode] = useState<Mode>(theme === "dark" ? "dark" : "light");
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null });
  const [showNavigator, setShowNavigator] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "section" | "column" | "widget"; id: string } | null>(null);
  const [ctx, setCtx] = useState<CtxTarget | null>(null);

  const askRemoveSection = useCallback((id: string) => setPendingDelete({ kind: "section", id }), []);
  const askRemoveColumn = useCallback((id: string) => setPendingDelete({ kind: "column", id }), []);
  const askRemoveWidget = useCallback((id: string) => setPendingDelete({ kind: "widget", id }), []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const docRef = useRef(doc);
  docRef.current = doc;
  const update = useCallback((mut: (d: BuilderDocument) => void) => {
    const next: BuilderDocument = JSON.parse(JSON.stringify(docRef.current));
    mut(next);
    docRef.current = next;
    history.setDoc(next);
  }, [history]);

  // ---------- structural ops ----------
  const templates = useSectionTemplates();
  const addSection = (colsOrSpans: number | number[]) => update((d) => { d.sections.push(newSection(colsOrSpans)); });
  const loadHomepage = useCallback(() => {
    const tpl = buildHomepageDocument();
    history.setDoc(tpl);
  }, [history]);
  const insertTemplateSection = (tpl: SectionTemplate) => update((d) => {
    d.sections.push(cloneSection(tpl.data));
  });
  const saveSectionAsTemplate = (sid: string) => {
    const s = findSection(doc, sid);
    if (!s) return;
    const name = window.prompt("Nazwa szablonu sekcji:");
    if (!name) return;
    void templates.save(name.trim(), s);
  };
  const removeSection = (id: string) => update((d) => { d.sections = d.sections.filter((s) => s.id !== id); });
  const moveSection = (id: string, dir: -1 | 1) => update((d) => {
    const i = d.sections.findIndex((s) => s.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= d.sections.length) return;
    [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
  });
  const duplicateSection = (id: string) => update((d) => {
    const i = d.sections.findIndex((s) => s.id === id);
    if (i < 0) return;
    d.sections.splice(i + 1, 0, cloneSection(d.sections[i]));
  });
  const insertSectionAt = (index: number, colsOrSpans: number | number[]) =>
    update((d) => { d.sections.splice(index, 0, newSection(colsOrSpans)); });
  const addInnerSection = (sectionId: string) => update((d) => {
    const s = d.sections.find((x) => x.id === sectionId);
    if (s) s.children.push(newInnerSection());
  });
  const addColumn = (sectionId: string) => update((d) => {
    const s = d.sections.find((x) => x.id === sectionId);
    if (s) {
      const cols = s.children.filter((c) => c.kind === "column").length;
      s.children.push(newColumn(Math.max(1, Math.floor(12 / (cols + 1)))));
    }
  });
  const removeColumn = (colId: string) => update((d) => {
    for (const s of d.sections) {
      s.children = s.children.filter((c) => !(c.kind === "column" && c.id === colId));
      for (const c of s.children) if (c.kind === "inner-section")
        c.columns = c.columns.filter((x) => x.id !== colId);
    }
  });
  const duplicateColumn = (colId: string) => update((d) => {
    for (const s of d.sections) {
      const i = s.children.findIndex((c) => c.kind === "column" && c.id === colId);
      if (i >= 0) { s.children.splice(i + 1, 0, cloneColumn(s.children[i] as ColumnNode)); return; }
      for (const c of s.children) if (c.kind === "inner-section") {
        const j = c.columns.findIndex((x) => x.id === colId);
        if (j >= 0) { c.columns.splice(j + 1, 0, cloneColumn(c.columns[j])); return; }
      }
    }
  });
  const removeWidget = (wid: string) => update((d) => {
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) col.children = col.children.filter((w) => w.id !== wid);
    }
  });
  const duplicateWidget = (wid: string) => update((d) => {
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) {
        const i = col.children.findIndex((w) => w.id === wid);
        if (i >= 0) { col.children.splice(i + 1, 0, cloneWidget(col.children[i])); return; }
      }
    }
  });
  const updateWidget = (wid: string, mut: (w: WidgetNode) => void) => update((d) => {
    const f = findWidget(d, wid);
    if (f) mut(f.widget);
  });
  const updateSection = (sid: string, mut: (s: SectionNode) => void) => update((d) => {
    const s = d.sections.find((x) => x.id === sid);
    if (s) mut(s);
  });
  const updateColumn = (cid: string, mut: (c: ColumnNode) => void) => update((d) => {
    const c = findColumn(d, cid);
    if (c) mut(c);
  });

  // ---------- focused column / add widget ----------
  const focusedColumn = useMemo<ColumnNode | null>(() => {
    if (selection.kind === "column" && selection.id) return findColumn(doc, selection.id);
    if (selection.kind === "widget" && selection.id) return findWidget(doc, selection.id)?.column ?? null;
    for (const s of doc.sections) for (const c of s.children) {
      if (c.kind === "column") return c;
      if (c.kind === "inner-section" && c.columns[0]) return c.columns[0];
    }
    return null;
  }, [doc, selection]);

  const addWidgetToFocused = (type: WidgetType) => {
    const w = makeWidget(type);
    if (!focusedColumn) {
      update((d) => {
        const s = newSection(1);
        (s.children[0] as ColumnNode).children.push(w);
        d.sections.push(s);
      });
    } else {
      update((d) => {
        const c = findColumn(d, focusedColumn.id);
        if (c) c.children.push(w);
      });
    }
    setSelection({ kind: "widget", id: w.id });
  };

  const addWidgetToColumn = (colId: string, type: WidgetType) => {
    const w = makeWidget(type);
    update((d) => {
      const c = findColumn(d, colId);
      if (c) c.children.push(w);
    });
    setSelection({ kind: "widget", id: w.id });
  };

  // Insert a new widget before/after an existing widget (across columns).
  const insertWidgetNear = (targetWidgetId: string, pos: "before" | "after", type: WidgetType) => {
    const w = makeWidget(type);
    update((d) => {
      for (const s of d.sections) for (const c of s.children) {
        const cols = c.kind === "column" ? [c] : c.columns;
        for (const col of cols) {
          const i = col.children.findIndex((x) => x.id === targetWidgetId);
          if (i >= 0) { col.children.splice(pos === "before" ? i : i + 1, 0, w); return; }
        }
      }
    });
    setSelection({ kind: "widget", id: w.id });
  };

  // Append a new widget to the first column of a section (used when dropping
  // on a section's empty area).
  const appendWidgetToSection = (sectionId: string, type: WidgetType) => {
    const w = makeWidget(type);
    update((d) => {
      const s = d.sections.find((x) => x.id === sectionId);
      if (!s) return;
      let col: ColumnNode | null = null;
      for (const ch of s.children) {
        if (ch.kind === "column") { col = ch; break; }
        if (ch.kind === "inner-section" && ch.columns[0]) { col = ch.columns[0]; break; }
      }
      if (!col) {
        const newCol = newColumn(12);
        s.children.push(newCol);
        col = newCol;
      }
      col.children.push(w);
    });
    setSelection({ kind: "widget", id: w.id });
  };

  // Move a widget before/after another widget (across columns supported).
  const moveWidgetTo = (srcId: string, targetId: string, pos: "before" | "after") => update((d) => {
    if (srcId === targetId) return;
    let src: WidgetNode | null = null;
    const removeFrom = (col: ColumnNode) => {
      const i = col.children.findIndex((w) => w.id === srcId);
      if (i >= 0) { src = col.children.splice(i, 1)[0]; return true; }
      return false;
    };
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) if (removeFrom(col)) break;
      if (src) break;
    }
    if (!src) return;
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) {
        const j = col.children.findIndex((w) => w.id === targetId);
        if (j >= 0) { col.children.splice(pos === "before" ? j : j + 1, 0, src!); return; }
      }
    }
  });

  const moveWidgetToColumn = (srcId: string, targetColId: string) => update((d) => {
    let src: WidgetNode | null = null;
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) {
        const i = col.children.findIndex((w) => w.id === srcId);
        if (i >= 0) {
          src = col.children.splice(i, 1)[0];
          break;
        }
      }
      if (src) break;
    }
    if (!src) return;
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) {
        if (col.id === targetColId) {
          col.children.push(src);
          return;
        }
      }
    }
  });

  const moveWidgetToSection = (srcId: string, targetSectionId: string) => update((d) => {
    let src: WidgetNode | null = null;
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) {
        const i = col.children.findIndex((w) => w.id === srcId);
        if (i >= 0) {
          src = col.children.splice(i, 1)[0];
          break;
        }
      }
      if (src) break;
    }
    if (!src) return;

    const targetSection = d.sections.find((section) => section.id === targetSectionId);
    if (!targetSection) return;

    let targetColumn: ColumnNode | null = null;
    for (const child of targetSection.children) {
      if (child.kind === "column") { targetColumn = child; break; }
      if (child.kind === "inner-section" && child.columns[0]) { targetColumn = child.columns[0]; break; }
    }

    if (!targetColumn) {
      const newCol = newColumn(12);
      targetSection.children.push(newCol);
      targetColumn = newCol;
    }

    targetColumn.children.push(src);
  });

  // Move a section before/after another section.
  const moveSectionTo = (srcId: string, targetId: string, pos: "before" | "after") => update((d) => {
    if (srcId === targetId) return;
    const i = d.sections.findIndex((s) => s.id === srcId);
    if (i < 0) return;
    const [node] = d.sections.splice(i, 1);
    const j = d.sections.findIndex((s) => s.id === targetId);
    if (j < 0) { d.sections.push(node); return; }
    d.sections.splice(pos === "before" ? j : j + 1, 0, node);
  });

  // ---------- DnD reorder widgets within / across columns ----------
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const srcId = String(active.id);
    const overId = String(over.id);
    // Drop on a column droppable -> append to end of that column
    if (overId.startsWith("col:")) {
      const targetColId = overId.slice(4);
      update((d) => {
        let src: WidgetNode | null = null;
        for (const s of d.sections) for (const c of s.children) {
          const cols = c.kind === "column" ? [c] : c.columns;
          for (const col of cols) {
            const i = col.children.findIndex((w) => w.id === srcId);
            if (i >= 0) { src = col.children.splice(i, 1)[0]; break; }
          }
          if (src) break;
        }
        if (!src) return;
        for (const s of d.sections) for (const c of s.children) {
          const cols = c.kind === "column" ? [c] : c.columns;
          for (const col of cols) if (col.id === targetColId) { col.children.push(src!); return; }
        }
      });
      return;
    }
    // Drop on another widget -> same-column reorder OR cross-column insert before
    update((d) => {
      // same-column reorder
      for (const s of d.sections) for (const c of s.children) {
        const cols = c.kind === "column" ? [c] : c.columns;
        for (const col of cols) {
          const ids = col.children.map((w) => w.id);
          if (ids.includes(srcId) && ids.includes(overId)) {
            const oldIdx = ids.indexOf(srcId);
            const newIdx = ids.indexOf(overId);
            col.children = arrayMove(col.children, oldIdx, newIdx);
            return;
          }
        }
      }
      // cross-column: remove src, insert before target
      let src: WidgetNode | null = null;
      for (const s of d.sections) for (const c of s.children) {
        const cols = c.kind === "column" ? [c] : c.columns;
        for (const col of cols) {
          const i = col.children.findIndex((w) => w.id === srcId);
          if (i >= 0) { src = col.children.splice(i, 1)[0]; break; }
        }
        if (src) break;
      }
      if (!src) return;
      for (const s of d.sections) for (const c of s.children) {
        const cols = c.kind === "column" ? [c] : c.columns;
        for (const col of cols) {
          const j = col.children.findIndex((w) => w.id === overId);
          if (j >= 0) { col.children.splice(j, 0, src!); return; }
        }
      }
    });
  };


  // ---------- clipboard ----------
  const { copySelection, pasteFromClipboard } = useBuilderClipboard({
    doc, selection, focusedColumn, update,
  });

  const toggleHidden = (id: string, kind: NonNullable<SelectionKind>) => update((d) => {
    const target =
      kind === "section" ? findSection(d, id) :
      kind === "inner-section" ? findInner(d, id) :
      kind === "column" ? findColumn(d, id) :
      findWidget(d, id)?.widget ?? null;
    if (!target) return;
    target.advanced = target.advanced ?? {};
    target.advanced.hideOn = { ...(target.advanced.hideOn ?? {}), [device]: !target.advanced.hideOn?.[device] };
  });

  // ---------- keyboard shortcuts ----------
  const cutSelection = useCallback(() => {
    if (!selection.id || !selection.kind) return;
    copySelection();
    if (selection.kind === "section") askRemoveSection(selection.id);
    else if (selection.kind === "column") askRemoveColumn(selection.id);
    else if (selection.kind === "widget") askRemoveWidget(selection.id);
  }, [selection, copySelection, askRemoveSection, askRemoveColumn, askRemoveWidget]);

  useBuilderShortcuts({
    selection, setSelection,
    undo: history.undo, redo: history.redo,
    copySelection, cutSelection, pasteFromClipboard,
    duplicateSection, duplicateColumn, duplicateWidget,
    askRemoveSection, askRemoveColumn, askRemoveWidget,
    moveSection,
    onToggleNavigator: () => setShowNavigator((v) => !v),
  });


  // ---------- left panel content ----------
  const selectedWidget = selection.kind === "widget" && selection.id ? findWidget(doc, selection.id)?.widget ?? null : null;
  const selectedSection = selection.kind === "section" && selection.id ? findSection(doc, selection.id) : null;
  const selectedColumn = selection.kind === "column" && selection.id ? findColumn(doc, selection.id) : null;
  const selectedInner = selection.kind === "inner-section" && selection.id ? findInner(doc, selection.id) : null;
  const hasSelection = !!(selectedWidget || selectedSection || selectedColumn || selectedInner);

  // ---------- right-click context menu ----------
  const onCanvasContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const widgetEl = t.closest<HTMLElement>("[data-widget-id]");
    const colEl = t.closest<HTMLElement>("[data-col-id]");
    const innerEl = t.closest<HTMLElement>("[data-inner-id]");
    const secEl = t.closest<HTMLElement>("[data-sec-id]");

    e.preventDefault();
    e.stopPropagation();

    if (widgetEl?.dataset.widgetId) {
      setSelection({ kind: "widget", id: widgetEl.dataset.widgetId });
      setCtx({ kind: "widget", id: widgetEl.dataset.widgetId, x: e.clientX, y: e.clientY });
    } else if (colEl?.dataset.colId) {
      setSelection({ kind: "column", id: colEl.dataset.colId });
      setCtx({ kind: "column", id: colEl.dataset.colId, x: e.clientX, y: e.clientY });
    } else if (innerEl?.dataset.innerId) {
      setSelection({ kind: "inner-section", id: innerEl.dataset.innerId });
      setCtx({ kind: "inner-section", id: innerEl.dataset.innerId, x: e.clientX, y: e.clientY });
    } else if (secEl?.dataset.secId) {
      setSelection({ kind: "section", id: secEl.dataset.secId });
      setCtx({ kind: "section", id: secEl.dataset.secId, x: e.clientX, y: e.clientY });
    } else {
      setSelection({ kind: null, id: null });
      setCtx({ kind: "empty", id: null, x: e.clientX, y: e.clientY });
    }
  }, []);

  const ctxActions = useMemo(() => {
    if (!ctx) return {};
    const hasClipboard = !!readClipboard();
    if (ctx.kind === "empty") {
      return {
        addSection: () => addSection(1),
        paste: () => pasteFromClipboard(),
        hasClipboard,
      };
    }
    if (ctx.kind === "section" && ctx.id) {
      const id = ctx.id;
      const idx = doc.sections.findIndex((s) => s.id === id);
      const target = doc.sections[idx];
      const hidden = !!target?.advanced?.hideOn?.[device];
      return {
        openProperties: () => setSelection({ kind: "section", id }),
        duplicate: () => duplicateSection(id),
        copy: () => copySelection(),
        cut: () => cutSelection(),
        paste: () => pasteFromClipboard(),
        hasClipboard,
        moveUp: () => moveSection(id, -1),
        moveDown: () => moveSection(id, 1),
        canMoveUp: idx > 0,
        canMoveDown: idx >= 0 && idx < doc.sections.length - 1,
        addColumn: () => addColumn(id),
        addInnerSection: () => addInnerSection(id),
        saveAsTemplate: () => saveSectionAsTemplate(id),
        toggleHidden: () => toggleHidden(id, "section"),
        hiddenOnDevice: hidden,
        remove: () => askRemoveSection(id),
      };
    }
    if (ctx.kind === "inner-section" && ctx.id) {
      const id = ctx.id;
      const found = findInner(doc, id);
      const hidden = !!found?.advanced?.hideOn?.[device];
      return {
        openProperties: () => setSelection({ kind: "inner-section", id }),
        copy: () => copySelection(),
        paste: () => pasteFromClipboard(),
        hasClipboard,
        toggleHidden: () => toggleHidden(id, "inner-section"),
        hiddenOnDevice: hidden,
      };
    }
    if (ctx.kind === "column" && ctx.id) {
      const id = ctx.id;
      const col = findColumn(doc, id);
      const hidden = !!col?.advanced?.hideOn?.[device];
      return {
        openProperties: () => setSelection({ kind: "column", id }),
        duplicate: () => duplicateColumn(id),
        copy: () => copySelection(),
        cut: () => cutSelection(),
        paste: () => pasteFromClipboard(),
        hasClipboard,
        toggleHidden: () => toggleHidden(id, "column"),
        hiddenOnDevice: hidden,
        remove: () => askRemoveColumn(id),
      };
    }
    if (ctx.kind === "widget" && ctx.id) {
      const id = ctx.id;
      const f = findWidget(doc, id);
      const hidden = !!f?.widget.advanced?.hideOn?.[device];
      return {
        openProperties: () => setSelection({ kind: "widget", id }),
        duplicate: () => duplicateWidget(id),
        copy: () => copySelection(),
        cut: () => cutSelection(),
        paste: () => pasteFromClipboard(),
        hasClipboard,
        toggleHidden: () => toggleHidden(id, "widget"),
        hiddenOnDevice: hidden,
        remove: () => askRemoveWidget(id),
      };
    }
    return {};
  }, [
    ctx, doc, device,
    addSection, duplicateSection, moveSection, addColumn, addInnerSection,
    saveSectionAsTemplate, askRemoveSection, askRemoveColumn, askRemoveWidget,
    duplicateColumn, duplicateWidget, copySelection, cutSelection, pasteFromClipboard,
    toggleHidden,
  ]);

  return (
    <div className={`cms-builder-compact grid ${sidebarCollapsed ? "grid-cols-[40px_1fr]" : "grid-cols-[260px_1fr]"} gap-3 items-start transition-[grid-template-columns] duration-200`}>


      {/* LEFT PANEL */}
      <aside className="bg-card border border-border rounded-lg flex flex-col overflow-hidden sticky top-3 max-h-[calc(100vh-1.5rem)] self-start">
        {sidebarCollapsed ? (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="flex-1 w-full flex flex-col items-center gap-2 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition"
            title="Rozwiń panel"
          >
            <ChevronRight className="w-4 h-4" />
            <span className="text-[10px] font-medium uppercase tracking-wider [writing-mode:vertical-rl] rotate-180">Widgety</span>
          </button>
        ) : (
          <>
            {hasSelection ? (
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-border flex items-center justify-between gap-2">
                  <button onClick={() => setSelection({ kind: null, id: null })}
                    className="text-xs inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <ChevronLeft className="w-3.5 h-3.5" /> Widgety
                  </button>
                  <h3 className="text-sm font-medium inline-flex items-center gap-2">
                    <SettingsIcon className="w-4 h-4" />
                    {selectedWidget ? "Widget"
                      : selectedColumn ? "Kolumna"
                      : selectedInner ? "Sekcja wewn."
                      : "Sekcja"}
                  </h3>
                  <div className="inline-flex items-center gap-1">
                    <button onClick={() => setSelection({ kind: null, id: null })} title="Zamknij"><X className="w-4 h-4" /></button>
                    <button onClick={() => setSidebarCollapsed(true)} title="Zwiń panel" className="text-muted-foreground hover:text-foreground"><ChevronLeft className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3">
                  {selectedWidget && (
                    <WidgetProperties widget={selectedWidget} lang={lang} device={device} mode={mode} onModeChange={setMode}
                      onChange={(mut) => updateWidget(selectedWidget.id, mut)} />
                  )}
                  {selectedSection && (
                    <SectionProperties section={selectedSection} device={device}
                      onChange={(mut) => updateSection(selectedSection.id, mut)} />
                  )}
                  {selectedColumn && (
                    <ColumnProperties column={selectedColumn} device={device} mode={mode} onModeChange={setMode}
                      onChange={(mut) => updateColumn(selectedColumn.id, mut)} />
                  )}
                  {selectedInner && (
                    <div className="text-xs text-muted-foreground">Sekcja wewnętrzna — wybierz kolumnę aby ją edytować.</div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 border-b border-border flex items-center justify-between bg-muted/20">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Widgety</span>
                  <button onClick={() => setSidebarCollapsed(true)} title="Zwiń panel" className="text-muted-foreground hover:text-foreground">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <WidgetLibrary onPickWidget={addWidgetToFocused} onPickStructure={addSection} onPickTemplate={insertTemplateSection} />
                </div>
              </>
            )}

            <div className="border-t border-border">
              <button
                onClick={() => setShowNavigator((v) => !v)}
                className="w-full text-left px-3 py-2 text-xs inline-flex items-center justify-between bg-muted/30 hover:bg-muted"
              >
                <span className="inline-flex items-center gap-2">Nawigator</span>
                {showNavigator ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
              </button>
              {showNavigator && (
                <Navigator doc={doc} selection={selection} device={device}
                  onSelect={setSelection} onToggleHidden={toggleHidden} />
              )}
            </div>
          </>
        )}
      </aside>

      {/* CANVAS */}
      <div className="bg-muted/20 border border-border rounded-lg flex flex-col min-w-0">
        <div className="sticky top-3 z-20">
          <Toolbar
            lang={lang} onLangChange={onLangChange}
            device={device} setDevice={setDevice}
            mode={mode} setMode={setMode}
            canUndo={history.canUndo} canRedo={history.canRedo}
            onUndo={history.undo} onRedo={history.redo}
          />
        </div>

        <div className={`bg-muted/30 p-4 ${mode === "dark" ? "dark" : ""}`} onClick={() => setSelection({ kind: null, id: null })} onContextMenu={onCanvasContextMenu}>
          <BuilderModeProvider mode={mode}>
          <div
            className={`mx-auto bg-background shadow-lg ring-1 ring-border transition-all ${
              device === "desktop" ? "max-w-[1440px]"
              : device === "tablet" ? "max-w-[820px]"
              : "max-w-[390px]"
            } ${scope !== "page" ? "rounded-md" : ""}`}
          >
            {/* Site chrome — Header preview with hover edit overlay (page editor only) */}
            {!hideChrome && scope === "page" && (
              <ChromeFrame label="Nagłówek strony" editTo="/admin/settings/general">
                <Header />
              </ChromeFrame>
            )}

            {scope !== "page" && (
              <div className="px-3 py-1.5 border-b border-border bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                Edytujesz: {scope === "header" ? "Nagłówek" : scope === "footer" ? "Stopkę" : "Menu"}
              </div>
            )}

            <div className={scope === "page" ? "px-2 py-2" : "p-0"}>
              <CanvasActionBar
                canUndo={history.canUndo}
                canRedo={history.canRedo}
                onUndo={history.undo}
                onRedo={history.redo}
                selection={selection}
                onDelete={() => {
                  if (!selection.id) return;
                  if (selection.kind === "section") askRemoveSection(selection.id);
                  else if (selection.kind === "column") askRemoveColumn(selection.id);
                  else if (selection.kind === "widget") askRemoveWidget(selection.id);
                }}
              />

              {doc.sections.length === 0 && scope === "page" && (
                <EmptyState
                  onAdd={addSection}
                  title={copy.title}
                  hint={copy.hint}
                  onLoadHomepage={loadHomepage}
                />
              )}
              <VisualCanvas
                doc={doc} lang={lang} device={device}
                selection={selection} setSelection={setSelection}
                onInsertSection={insertSectionAt}
                onRemoveSection={askRemoveSection}
                onMoveWidget={moveWidgetTo}
                onMoveWidgetToColumn={moveWidgetToColumn}
                onMoveWidgetToSection={moveWidgetToSection}
                onMoveSection={moveSectionTo}
                onDropNewWidgetToColumn={addWidgetToColumn}
                onDropNewWidgetNear={insertWidgetNear}
                onDropNewWidgetToSection={appendWidgetToSection}
                firstLabel={copy.first} lastLabel={copy.last}
              />
            </div>


            {!hideChrome && scope === "page" && (
              <ChromeFrame label="Stopka strony" editTo="/admin/settings/general">
                <Footer />
              </ChromeFrame>
            )}

          </div>
          </BuilderModeProvider>
        </div>
      </div>
      <ConfirmDeleteDialog
        pending={pendingDelete}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === "section") removeSection(pendingDelete.id);
          else if (pendingDelete.kind === "column") removeColumn(pendingDelete.id);
          else if (pendingDelete.kind === "widget") removeWidget(pendingDelete.id);
          setSelection({ kind: null, id: null });
          setPendingDelete(null);
        }}
      />
      <BuilderContextMenu target={ctx} actions={ctxActions} onClose={() => setCtx(null)} />
    </div>
  );
}
