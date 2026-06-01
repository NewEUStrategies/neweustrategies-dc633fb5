// Elementor-style 2-pane builder:
//   LEFT  = contextual panel (widget library when nothing is selected, otherwise
//           Section / Inner / Column / Widget properties) + Navigator drawer.
//   RIGHT = canvas with sections, columns, widgets, floating handles and
//           insertion drop-zones.
// Persistence happens via onChange (called by the parent route on every doc
// mutation; the parent debounces autosave). useHistory wraps onChange so we
// get undo/redo without breaking it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Monitor, Tablet, Smartphone, Columns2,
  Settings as SettingsIcon, X, Eye, Copy, Undo, Redo, ChevronLeft, Save, Pencil,
} from "@/lib/lucide-shim";
import { WIDGETS, makeWidget } from "@/lib/builder/registry";
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode,
  Device, WidgetType,
} from "@/lib/builder/types";
import { emptyDocument, newId } from "@/lib/builder/types";
import {
  cloneSection, cloneColumn, cloneInner, cloneWidget,
  findWidget, findSection, findColumn, findInner,
} from "@/lib/builder/operations";
import { copyToClipboard, readClipboard, type ClipEnvelope } from "@/lib/builder/clipboard";
import { useHistory } from "@/lib/builder/useHistory";
import { useSectionTemplates, type SectionTemplate } from "@/lib/builder/templates";
import { buildHomepageDocument } from "@/lib/builder/homepageTemplate";
import { WidgetView } from "./WidgetView";
import { SectionProperties } from "./SectionProperties";
import { WidgetProperties } from "./WidgetProperties";
import { ColumnProperties } from "./ColumnProperties";
import { WidgetLibrary } from "./WidgetLibrary";
import { StructurePicker } from "./StructurePicker";
import { Navigator } from "./Navigator";
import { BuilderRenderer } from "./BuilderRenderer";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import {
  sectionWrapperStyle, sectionContainerStyle, columnsRowStyle,
  backgroundLayerStyle, overlayLayerStyle, borderStyle,
  ShapeDivider, typographyCss, typographyAlign,
} from "@/lib/builder/sectionStyles";
import { safeImageUrl } from "@/lib/sanitize";

type SelectionKind = "section" | "column" | "widget" | "inner-section" | null;
interface Selection { kind: SelectionKind; id: string | null; }

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
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null });
  const [showNavigator, setShowNavigator] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const update = useCallback((mut: (d: BuilderDocument) => void) => {
    const next: BuilderDocument = JSON.parse(JSON.stringify(doc));
    mut(next);
    history.setDoc(next);
  }, [doc, history]);

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

  // ---------- DnD reorder widgets within a column ----------
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    update((d) => {
      for (const s of d.sections) for (const c of s.children) {
        const cols = c.kind === "column" ? [c] : c.columns;
        for (const col of cols) {
          const ids = col.children.map((w) => w.id);
          if (ids.includes(active.id as string) && ids.includes(over.id as string)) {
            const oldIdx = ids.indexOf(active.id as string);
            const newIdx = ids.indexOf(over.id as string);
            col.children = arrayMove(col.children, oldIdx, newIdx);
          }
        }
      }
    });
  };

  // ---------- clipboard ----------
  const copySelection = useCallback(() => {
    if (!selection.id || !selection.kind) return;
    const map = {
      section: () => findSection(doc, selection.id!),
      "inner-section": () => findInner(doc, selection.id!),
      column: () => findColumn(doc, selection.id!),
      widget: () => findWidget(doc, selection.id!)?.widget ?? null,
    } as const;
    const node = map[selection.kind]?.();
    if (node) copyToClipboard({ kind: selection.kind, node } as ClipEnvelope);
  }, [selection, doc]);

  const pasteFromClipboard = useCallback(() => {
    const env = readClipboard();
    if (!env) return;
    update((d) => {
      if (env.kind === "section") {
        const cloned = cloneSection(env.node as SectionNode);
        const i = selection.kind === "section" && selection.id
          ? d.sections.findIndex((s) => s.id === selection.id) : -1;
        if (i >= 0) d.sections.splice(i + 1, 0, cloned); else d.sections.push(cloned);
      } else if (env.kind === "widget") {
        const cloned = cloneWidget(env.node as WidgetNode);
        const colId = focusedColumn?.id;
        if (!colId) return;
        const col = findColumn(d, colId);
        if (col) col.children.push(cloned);
      } else if (env.kind === "column") {
        const cloned = cloneColumn(env.node as ColumnNode);
        if (selection.kind === "section" && selection.id) {
          const s = d.sections.find((x) => x.id === selection.id);
          if (s) s.children.push(cloned);
        } else { d.sections.push({ id: newId(), kind: "section", children: [cloned] }); }
      } else if (env.kind === "inner-section") {
        const cloned = cloneInner(env.node as InnerSectionNode);
        if (selection.kind === "section" && selection.id) {
          const s = d.sections.find((x) => x.id === selection.id);
          if (s) s.children.push(cloned);
        }
      }
    });
  }, [selection, focusedColumn, update]);

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
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); history.undo(); }
      else if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); history.redo(); }
      else if (mod && e.key.toLowerCase() === "c") { copySelection(); }
      else if (mod && e.key.toLowerCase() === "v") { e.preventDefault(); pasteFromClipboard(); }
      else if (mod && e.key.toLowerCase() === "d" && selection.id) {
        e.preventDefault();
        if (selection.kind === "section") duplicateSection(selection.id);
        else if (selection.kind === "column") duplicateColumn(selection.id);
        else if (selection.kind === "widget") duplicateWidget(selection.id);
      }
      else if (e.key === "Delete" && selection.id) {
        if (selection.kind === "section") removeSection(selection.id);
        else if (selection.kind === "column") removeColumn(selection.id);
        else if (selection.kind === "widget") removeWidget(selection.id);
      } else if (e.key === "Escape") setSelection({ kind: null, id: null });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.undo, history.redo, copySelection, pasteFromClipboard, selection]);

  // ---------- left panel content ----------
  const selectedWidget = selection.kind === "widget" && selection.id ? findWidget(doc, selection.id)?.widget ?? null : null;
  const selectedSection = selection.kind === "section" && selection.id ? findSection(doc, selection.id) : null;
  const selectedColumn = selection.kind === "column" && selection.id ? findColumn(doc, selection.id) : null;
  const selectedInner = selection.kind === "inner-section" && selection.id ? findInner(doc, selection.id) : null;
  const hasSelection = !!(selectedWidget || selectedSection || selectedColumn || selectedInner);

  return (
    <div className="grid grid-cols-[300px_1fr] gap-3 items-start">

      {/* LEFT PANEL */}
      <aside className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
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
              <button onClick={() => setSelection({ kind: null, id: null })}><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {selectedWidget && (
                <WidgetProperties widget={selectedWidget} lang={lang} device={device}
                  onChange={(mut) => updateWidget(selectedWidget.id, mut)} />
              )}
              {selectedSection && (
                <SectionProperties section={selectedSection} device={device}
                  onChange={(mut) => updateSection(selectedSection.id, mut)} />
              )}
              {selectedColumn && (
                <ColumnProperties column={selectedColumn} device={device}
                  onChange={(mut) => updateColumn(selectedColumn.id, mut)} />
              )}
              {selectedInner && (
                <div className="text-xs text-muted-foreground">Sekcja wewnętrzna — wybierz kolumnę aby ją edytować.</div>
              )}
            </div>
          </div>
        ) : (
          <WidgetLibrary onPickWidget={addWidgetToFocused} onPickStructure={addSection} onPickTemplate={insertTemplateSection} />
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
      </aside>

      {/* CANVAS */}
      <div className="bg-muted/20 border border-border rounded-lg flex flex-col overflow-hidden">
        <Toolbar
          lang={lang} onLangChange={onLangChange}
          device={device} setDevice={setDevice}
          canUndo={history.canUndo} canRedo={history.canRedo}
          onUndo={history.undo} onRedo={history.redo}
        />

        <div className="flex-1 overflow-y-auto bg-muted/30 p-4" onClick={() => setSelection({ kind: null, id: null })}>
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
                  if (selection.kind === "section") removeSection(selection.id);
                  else if (selection.kind === "column") removeColumn(selection.id);
                  else if (selection.kind === "widget") removeWidget(selection.id);
                  setSelection({ kind: null, id: null });
                }}
              />

              {scope !== "page" ? (
                <VisualCanvas
                  doc={doc} lang={lang} device={device}
                  selection={selection} setSelection={setSelection}
                  onInsertSection={insertSectionAt}
                  onMoveWidget={moveWidgetTo}
                  onMoveSection={moveSectionTo}
                  onDropNewWidgetToColumn={addWidgetToColumn}
                  onDropNewWidgetNear={insertWidgetNear}
                  onDropNewWidgetToSection={appendWidgetToSection}
                  firstLabel={copy.first} lastLabel={copy.last}
                />
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  {doc.sections.length === 0 && (
                    <EmptyState
                      onAdd={addSection}
                      title={copy.title}
                      hint={copy.hint}
                      onLoadHomepage={scope === "page" ? loadHomepage : undefined}
                    />
                  )}


                  <SectionDropZone onInsert={(s) => insertSectionAt(0, s)} index={0} prominent label={copy.first} />

                  {doc.sections.map((s, idx) => (
                    <div key={s.id}>
                      <SectionView
                        section={s} device={device} lang={lang}
                        selection={selection} setSelection={setSelection}
                        isFirst={idx === 0} isLast={idx === doc.sections.length - 1}
                        onMove={(dir) => moveSection(s.id, dir)}
                        onRemove={() => removeSection(s.id)}
                        onDuplicate={() => duplicateSection(s.id)}
                        onSaveTemplate={() => saveSectionAsTemplate(s.id)}
                        onAddInnerSection={() => addInnerSection(s.id)}
                        onAddColumn={() => addColumn(s.id)}
                        onRemoveColumn={removeColumn}
                        onDuplicateColumn={duplicateColumn}
                        onRemoveWidget={removeWidget}
                        onDuplicateWidget={duplicateWidget}
                        onDropWidget={addWidgetToColumn}
                        onUpdateWidgetContent={(id, k, v) =>
                          updateWidget(id, (w) => { w.content = { ...w.content, [k]: v }; })
                        }
                      />
                      <SectionDropZone
                        onInsert={(s) => insertSectionAt(idx + 1, s)}
                        index={idx + 1}
                        prominent={idx === doc.sections.length - 1}
                        label={idx === doc.sections.length - 1 ? copy.last : undefined}
                      />
                    </div>
                  ))}
                </DndContext>
              )}
            </div>


            {!hideChrome && scope === "page" && (
              <ChromeFrame label="Stopka strony" editTo="/admin/settings/general">
                <Footer />
              </ChromeFrame>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// -------------------- Toolbar --------------------
function Toolbar({
  lang, onLangChange, device, setDevice, canUndo, canRedo, onUndo, onRedo,
}: {
  lang: "pl" | "en"; onLangChange: (l: "pl"|"en") => void;
  device: Device; setDevice: (d: Device) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
}) {
  return (
    <div className="border-b border-border p-2 flex items-center justify-between gap-2 bg-card">
      <div className="flex items-center gap-1">
        {(["pl","en"] as const).map((l) => (
          <button key={l} onClick={() => onLangChange(l)}
            className={`px-2.5 py-1 text-xs rounded ${lang===l?"bg-brand text-brand-foreground":"bg-muted"}`}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {([["desktop", Monitor],["tablet", Tablet],["mobile", Smartphone]] as const).map(([d, Icon]) => (
          <button key={d} onClick={() => setDevice(d)}
            className={`p-1.5 rounded ${device===d?"bg-brand text-brand-foreground":"bg-muted hover:bg-muted/70"}`} title={d}>
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded bg-muted hover:bg-muted/70 disabled:opacity-30" title="Cofnij (Ctrl/Cmd+Z)">
          <Undo className="w-4 h-4" />
        </button>
        <button onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded bg-muted hover:bg-muted/70 disabled:opacity-30" title="Ponów (Ctrl/Cmd+Shift+Z)">
          <Redo className="w-4 h-4" />
        </button>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-2">
          <Eye className="w-3.5 h-3.5" /> Podgląd
        </span>
      </div>
    </div>
  );
}

function CanvasActionBar({
  canUndo, canRedo, onUndo, onRedo, selection, onDelete,
}: {
  canUndo: boolean; canRedo: boolean;
  onUndo: () => void; onRedo: () => void;
  selection: Selection;
  onDelete: () => void;
}) {
  const hasSel = !!selection.id && selection.kind !== null && selection.kind !== "inner-section";
  const kindLabel =
    selection.kind === "section" ? "sekcję" :
    selection.kind === "column" ? "kolumnę" :
    selection.kind === "widget" ? "widget" : "";
  return (
    <div className="sticky top-0 z-30 mb-2 flex items-center gap-1 px-2 py-1.5 bg-card/95 backdrop-blur border border-border rounded-md shadow-sm">
      <button
        type="button" onClick={onUndo} disabled={!canUndo}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-muted disabled:opacity-30"
        title="Cofnij (Ctrl/Cmd+Z)"
      >
        <Undo className="w-3.5 h-3.5" /> Cofnij
      </button>
      <button
        type="button" onClick={onRedo} disabled={!canRedo}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded hover:bg-muted disabled:opacity-30"
        title="Ponów (Ctrl/Cmd+Shift+Z)"
      >
        <Redo className="w-3.5 h-3.5" /> Ponów
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button" onClick={onDelete} disabled={!hasSel}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:text-muted-foreground"
        title="Usuń zaznaczony element (Delete)"
      >
        <Trash2 className="w-3.5 h-3.5" />
        {hasSel ? `Usuń ${kindLabel}` : "Nic nie wybrano"}
      </button>
    </div>
  );
}


function EmptyState({ onAdd, title, hint, onLoadHomepage }: { onAdd: (spans: number[]) => void; title?: string; hint?: string; onLoadHomepage?: () => void }) {
  return (
    <div data-section-inserter className="bg-card/60 border-2 border-dashed border-brand/40 rounded-lg p-8 my-4">
      <div className="text-center mb-5">
        <div className="mx-auto w-10 h-10 rounded-full bg-brand/10 text-brand inline-flex items-center justify-center mb-3">
          <Plus className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-semibold mb-1">{title ?? "Zacznij budować stronę"}</h3>
        <p className="text-xs text-muted-foreground">
          {hint ?? "Wybierz strukturę pierwszej sekcji."}
        </p>
        {onLoadHomepage && (
          <button
            type="button"
            onClick={onLoadHomepage}
            className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand text-brand-foreground text-xs font-semibold hover:opacity-90 transition"
          >
            <Plus className="w-3.5 h-3.5" />
            Wczytaj layout strony głównej
          </button>
        )}
      </div>
      <div className="max-w-3xl mx-auto">
        <StructurePicker onPick={onAdd} cols={4} />
      </div>
    </div>
  );
}

// Zone between sections / next to chrome to insert a new section.
// `prominent` shows a permanent dashed bar (used near header/footer where
// the boundary should always be obvious).
function SectionDropZone({
  onInsert, index, prominent, label,
}: {
  onInsert: (spans: number[]) => void; index: number;
  prominent?: boolean; label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div data-section-inserter className="my-2 p-2 border border-brand/60 rounded bg-card shadow-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Wybierz strukturę</span>
          <button type="button" onClick={() => setOpen(false)} className="px-1 text-[11px] text-muted-foreground hover:text-foreground">×</button>
        </div>
        <StructurePicker onPick={(s) => { onInsert(s); setOpen(false); }} cols={7} compact />
      </div>
    );
  }
  return (
    <div data-section-inserter className="my-1 group" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label ?? `Wstaw sekcję w pozycji ${index + 1}`}
        className={`w-full rounded inline-flex items-center justify-center gap-1.5 text-[10px] transition ${
          prominent
            ? "h-[42px] border border-dashed border-brand/40 text-brand/80 hover:border-brand hover:bg-brand/5"
            : "h-5 border border-dashed border-transparent text-muted-foreground group-hover:border-brand/40 group-hover:text-brand"
        }`}
      >
        <Plus className={`w-3 h-3 ${prominent ? "" : "opacity-0 group-hover:opacity-100"}`} />
        {label && <span>{label}</span>}
      </button>
    </div>

  );
}

// Non-interactive Header/Footer preview with a hover overlay that opens
// the settings page where their content (logo, brand, links) is edited.
function ChromeFrame({
  label, editTo, children,
}: { label: string; editTo: string; children: React.ReactNode }) {
  return (
    <div
      className="group relative"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>
      <div className="pointer-events-none absolute inset-0 ring-2 ring-transparent group-hover:ring-brand/50 transition" />
      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition">
        <Link
          to={editTo as never}
          className="inline-flex items-center gap-1.5 bg-background/95 border border-border shadow-sm rounded px-2.5 py-1 text-[11px] font-medium hover:bg-brand hover:text-brand-foreground hover:border-brand"
        >
          <Pencil className="w-3 h-3" /> Edytuj {label.toLowerCase()}
        </Link>
      </div>
      <div className="absolute top-2 left-2 z-10 opacity-0 group-hover:opacity-100 transition">
        <span className="inline-flex items-center bg-background/90 border border-border rounded px-2 py-0.5 text-[10px] text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

// -------------------- Section / Column / Widget canvas views --------------------
interface SectionViewProps {
  section: SectionNode; device: Device; lang: "pl"|"en";
  selection: Selection; setSelection: (s: Selection) => void;
  isFirst: boolean; isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSaveTemplate: () => void;
  onAddInnerSection: () => void;
  onAddColumn: () => void;
  onRemoveColumn: (id: string) => void;
  onDuplicateColumn: (id: string) => void;
  onRemoveWidget: (id: string) => void;
  onDuplicateWidget: (id: string) => void;
  onDropWidget: (colId: string, type: WidgetType) => void;
  onUpdateWidgetContent: (id: string, key: string, value: string) => void;
}

function SectionView(p: SectionViewProps) {
  const selected = p.selection.kind === "section" && p.selection.id === p.section.id;
  const colsSum = p.section.children.reduce((a, c) => a + (c.kind === "column" ? (c.span.desktop ?? 12) : 12), 0) || 12;
  const hidden = !!p.section.advanced?.hideOn?.[p.device];
  const skin: React.CSSProperties = {
    ...sectionWrapperStyle(p.section),
    ...backgroundLayerStyle(p.section.background),
    ...borderStyle(p.section.border),
    ...typographyAlign(p.section.typography, p.device),
    opacity: hidden ? 0.35 : undefined,
  };
  const typoCss = typographyCss(p.section.id, p.section.typography);
  const videoUrl = p.section.background?.type === "video"
    ? safeImageUrl(p.section.background.videoUrl) || p.section.background.videoUrl : "";

  return (
    <div
      data-sec-id={p.section.id}
      className={`group relative my-3 border-2 rounded-lg transition ${selected ? "border-brand" : "border-transparent hover:border-brand/40"}`}
      style={skin}
      onClick={(e) => { e.stopPropagation(); p.setSelection({ kind: "section", id: p.section.id }); }}
    >
      {p.section.background?.type === "video" && videoUrl && (
        <video src={videoUrl} autoPlay muted loop playsInline
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }} />
      )}
      <div style={overlayLayerStyle(p.section.overlay)} aria-hidden />
      <ShapeDivider s={p.section.shapeDividerTop} position="top" />
      <ShapeDivider s={p.section.shapeDividerBottom} position="bottom" />

      <div className={`absolute -top-3 left-3 z-10 flex items-center gap-0.5 bg-background border border-border rounded px-1 py-0.5 text-[10px] transition ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
        <span className="font-medium text-muted-foreground px-1">SEKCJA</span>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onMove(-1); }} disabled={p.isFirst} title="W górę"><ChevronUp className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onMove(1); }} disabled={p.isLast} title="W dół"><ChevronDown className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onAddColumn(); }} title="Dodaj kolumnę"><Columns2 className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onAddInnerSection(); }} title="Sekcja wewn."><Plus className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onDuplicate(); }} title="Duplikuj"><Copy className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onSaveTemplate(); }} title="Zapisz jako szablon"><Save className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); p.onRemove(); }} title="Usuń" danger><Trash2 className="w-3 h-3" /></IconBtn>
      </div>

      <div style={sectionContainerStyle(p.section)}>
        <div style={{ ...columnsRowStyle(p.section, colsSum), padding: "12px" }}>
          {p.section.children.map((child) => {
            const span = child.kind === "column" ? (child.span.desktop ?? 12) : 12;
            if (child.kind === "inner-section") {
              return (
                <div key={child.id} style={{ gridColumn: `span ${span}` }}>
                  <InnerSectionView
                    inner={child} device={p.device} lang={p.lang}
                    selection={p.selection} setSelection={p.setSelection}
                    onRemoveColumn={p.onRemoveColumn} onDuplicateColumn={p.onDuplicateColumn}
                    onRemoveWidget={p.onRemoveWidget} onDuplicateWidget={p.onDuplicateWidget}
                    onDropWidget={p.onDropWidget}
                    onUpdateWidgetContent={p.onUpdateWidgetContent}
                  />
                </div>
              );
            }
            return (
              <div key={child.id} style={{ gridColumn: `span ${span}` }}>
                <ColumnView column={child} device={p.device} lang={p.lang}
                  selection={p.selection} setSelection={p.setSelection}
                  onRemove={() => p.onRemoveColumn(child.id)}
                  onDuplicate={() => p.onDuplicateColumn(child.id)}
                  onRemoveWidget={p.onRemoveWidget} onDuplicateWidget={p.onDuplicateWidget}
                  onDropWidget={p.onDropWidget}
                  onUpdateWidgetContent={p.onUpdateWidgetContent} />
              </div>
            );
          })}
        </div>
      </div>
      {typoCss && <style dangerouslySetInnerHTML={{ __html: typoCss }} />}
    </div>
  );
}

function InnerSectionView({
  inner, device, lang, selection, setSelection, onRemoveColumn, onDuplicateColumn,
  onRemoveWidget, onDuplicateWidget, onDropWidget, onUpdateWidgetContent,
}: {
  inner: InnerSectionNode; device: Device; lang: "pl"|"en"; selection: Selection;
  setSelection: (s: Selection) => void;
  onRemoveColumn: (id: string) => void; onDuplicateColumn: (id: string) => void;
  onRemoveWidget: (id: string) => void; onDuplicateWidget: (id: string) => void;
  onDropWidget: (colId: string, type: WidgetType) => void;
  onUpdateWidgetContent: (id: string, key: string, value: string) => void;
}) {
  const selected = selection.kind === "inner-section" && selection.id === inner.id;
  const colsSum = inner.columns.reduce((a, c) => a + (c.span.desktop ?? 6), 0) || 12;
  const skin: React.CSSProperties = {
    ...sectionWrapperStyle(inner),
    ...backgroundLayerStyle(inner.background),
    ...borderStyle(inner.border),
  };
  return (
    <div
      className={`border rounded p-2 ${selected ? "border-brand" : "border-dashed border-border"}`}
      style={skin}
      onClick={(e) => { e.stopPropagation(); setSelection({ kind: "inner-section", id: inner.id }); }}
    >
      <div className="text-[10px] text-muted-foreground mb-1 relative z-10">SEKCJA WEWNĘTRZNA</div>
      <div className="grid gap-2 relative z-10" style={columnsRowStyle(inner, colsSum)}>
        {inner.columns.map((c) => (
          <div key={c.id} style={{ gridColumn: `span ${c.span.desktop ?? 6}` }}>
            <ColumnView column={c} device={device} lang={lang} selection={selection}
              setSelection={setSelection}
              onRemove={() => onRemoveColumn(c.id)} onDuplicate={() => onDuplicateColumn(c.id)}
              onRemoveWidget={onRemoveWidget} onDuplicateWidget={onDuplicateWidget}
              onDropWidget={onDropWidget}
              onUpdateWidgetContent={onUpdateWidgetContent} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnView({
  column, device, lang, selection, setSelection, onRemove, onDuplicate,
  onRemoveWidget, onDuplicateWidget, onDropWidget, onUpdateWidgetContent,
}: {
  column: ColumnNode; device: Device; lang: "pl"|"en"; selection: Selection;
  setSelection: (s: Selection) => void;
  onRemove: () => void; onDuplicate: () => void;
  onRemoveWidget: (id: string) => void; onDuplicateWidget: (id: string) => void;
  onDropWidget: (colId: string, type: WidgetType) => void;
  onUpdateWidgetContent: (id: string, key: string, value: string) => void;
}) {
  const selected = selection.kind === "column" && selection.id === column.id;
  const [dragOver, setDragOver] = useState(false);
  return (
    <div
      className={`group/col relative min-h-[80px] rounded border-2 ${selected ? "border-brand bg-brand/5" : dragOver ? "border-brand/70 bg-brand/5" : "border-dashed border-border/60"} p-2 transition`}
      onClick={(e) => { e.stopPropagation(); setSelection({ kind: "column", id: column.id }); }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-widget-type")) {
          e.preventDefault(); setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        const t = e.dataTransfer.getData("application/x-widget-type") as WidgetType;
        setDragOver(false);
        if (t) { e.preventDefault(); onDropWidget(column.id, t); }
      }}
    >
      {(selected || dragOver) && (
        <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 bg-background border border-border rounded px-1 py-0.5 text-[10px]">
          <span className="text-muted-foreground px-1">KOLUMNA</span>
          <IconBtn onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplikuj"><Copy className="w-3 h-3" /></IconBtn>
          <IconBtn onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Usuń" danger><Trash2 className="w-3 h-3" /></IconBtn>
        </div>
      )}
      {column.children.length === 0 && (
        <div className="text-[10px] text-muted-foreground text-center py-6">
          {dragOver ? "Upuść widget tutaj" : "Przeciągnij lub kliknij widget z lewej kolumny"}
        </div>
      )}
      <SortableContext items={column.children.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        {column.children.map((w) => (
          <SortableWidget key={w.id} widget={w} lang={lang} device={device}
            selected={selection.kind === "widget" && selection.id === w.id}
            onSelect={() => setSelection({ kind: "widget", id: w.id })}
            onDuplicate={() => onDuplicateWidget(w.id)}
            onRemove={() => onRemoveWidget(w.id)}
            onUpdateContent={(k, v) => onUpdateWidgetContent(w.id, k, v)} />
        ))}
      </SortableContext>
    </div>
  );
}

function SortableWidget({
  widget, lang, device, selected, onSelect, onDuplicate, onRemove, onUpdateContent,
}: {
  widget: WidgetNode; lang: "pl"|"en"; device: Device; selected: boolean;
  onSelect: () => void; onDuplicate: () => void; onRemove: () => void;
  onUpdateContent: (key: string, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const hidden = !!widget.advanced?.hideOn?.[device];
  return (
    <div ref={setNodeRef} style={style} {...attributes}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`group/w relative my-1 rounded border-2 ${selected ? "border-brand" : "border-transparent hover:border-brand/40"} p-1 ${hidden ? "opacity-40" : ""}`}
    >
      <div className={`absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 bg-background border border-border rounded px-1 py-0.5 text-[10px] transition ${selected ? "opacity-100" : "opacity-0 group-hover/w:opacity-100"}`}>
        <span {...listeners} className="cursor-grab text-muted-foreground px-1" title="Przeciągnij">⋮⋮</span>
        <IconBtn onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplikuj"><Copy className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Usuń" danger><Trash2 className="w-3 h-3" /></IconBtn>
      </div>
      {/* Allow pointer events when selected so inline-editable text fields are usable. */}
      <div className={selected ? "" : "pointer-events-none"}>
        <WidgetView
          node={widget}
          lang={lang}
          device={device}
          editable={selected}
          onContentChange={onUpdateContent}
        />
      </div>
    </div>
  );
}

function IconBtn({
  onClick, children, disabled, title, danger,
}: {
  onClick: (e: React.MouseEvent) => void;
  children: React.ReactNode; disabled?: boolean; title?: string; danger?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`p-0.5 rounded ${danger ? "hover:text-destructive" : "hover:text-brand"} disabled:opacity-30`}>
      {children}
    </button>
  );
}

// -------------------- Visual canvas (header/footer/menu) --------------------
// Renders the real public-style output (BuilderRenderer) and lets the user
// click any widget/section/column to edit it in the left panel. Section
// drop-zones around each section let users insert new sections in the chrome.
function VisualCanvas({
  doc, lang, device, selection, setSelection, onInsertSection,
  onMoveWidget, onMoveSection,
  onDropNewWidgetToColumn, onDropNewWidgetNear, onDropNewWidgetToSection,
  firstLabel, lastLabel,
}: {
  doc: BuilderDocument; lang: "pl" | "en"; device: Device;
  selection: Selection; setSelection: (s: Selection) => void;
  onInsertSection: (index: number, colsOrSpans: number | number[]) => void;
  onMoveWidget: (srcId: string, targetId: string, pos: "before" | "after") => void;
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

  // After render: tag selected nodes, mark draggable, attach drag handlers.
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

    // Returns true if currently dragging a new library widget.
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
      // For new library widgets, only allow drops inside a section/column/widget-inside-section.
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
      // Only clear when leaving the canvas entirely.
      if (!root.contains(e.relatedTarget as Node)) clearDropMarkers();
    };

    const onDrop = (e: DragEvent) => {
      clearDropMarkers();
      const drag = dragRef.current;
      dragRef.current = null;
      const t = e.target as HTMLElement;

      // Library widget drop (new widget).
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
        const target = t.closest?.("[data-widget-id]") as HTMLElement | null;
        if (!target || !target.dataset.widgetId || target.dataset.widgetId === drag.id) return;
        e.preventDefault(); e.stopPropagation();
        const r = target.getBoundingClientRect();
        const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
        onMoveWidget(drag.id, target.dataset.widgetId, pos);
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
  }, [doc, selection, onMoveWidget, onMoveSection, onDropNewWidgetToColumn, onDropNewWidgetNear, onDropNewWidgetToSection]);

  const ringCss = `
    [data-visual-canvas] [data-widget-id]{position:relative;cursor:grab;outline:1px dashed transparent;outline-offset:2px;border-radius:4px;transition:outline-color .15s}
    [data-visual-canvas] [data-widget-id]:hover{outline-color:color-mix(in oklab, var(--brand) 50%, transparent)}
    [data-visual-canvas] [data-widget-id].is-selected{outline:2px solid var(--brand)}
    [data-visual-canvas] [data-widget-id]:active{cursor:grabbing}
    [data-visual-canvas] [data-sec-id]{outline:1px dashed transparent;outline-offset:-2px;transition:outline-color .15s}
    [data-visual-canvas] [data-sec-id]:hover{outline-color:color-mix(in oklab, var(--brand) 35%, transparent)}
    [data-visual-canvas] [data-sec-id].is-selected{outline:2px solid var(--brand)}
    [data-visual-canvas] [data-col-id]{position:relative}
    /* Drop indicators */
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
          />
        </div>
      ))}
    </div>
  );
}
