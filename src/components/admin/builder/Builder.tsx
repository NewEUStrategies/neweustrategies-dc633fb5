// Elementor-style 2-pane builder:
//   LEFT  = contextual panel (widget library when nothing is selected, otherwise
//           Section / Inner / Column / Widget properties) + Navigator drawer.
//   RIGHT = canvas with sections, columns, widgets, floating handles and
//           insertion drop-zones.
// Persistence happens via onChange (called by the parent route on every doc
// mutation; the parent debounces autosave). useHistory wraps onChange so we
// get undo/redo without breaking it.
import { useCallback, useEffect, useMemo, useState } from "react";
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
  Settings as SettingsIcon, X, Eye, Copy, Undo, Redo, ChevronLeft, Save,
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
import { WidgetView } from "./WidgetView";
import { SectionProperties } from "./SectionProperties";
import { WidgetProperties } from "./WidgetProperties";
import { ColumnProperties } from "./ColumnProperties";
import { WidgetLibrary } from "./WidgetLibrary";
import { Navigator } from "./Navigator";
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
}

const newColumn = (span = 12): ColumnNode => ({
  id: newId(), kind: "column", span: { desktop: span }, children: [],
});
const newSection = (cols = 1): SectionNode => ({
  id: newId(), kind: "section",
  children: Array.from({ length: cols }, () => newColumn(12 / cols)),
});
const newInnerSection = (): InnerSectionNode => ({
  id: newId(), kind: "inner-section",
  columns: [newColumn(6), newColumn(6)],
});

export function Builder({ value, onChange, lang, onLangChange }: Props) {
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
  const addSection = (cols: number) => update((d) => { d.sections.push(newSection(cols)); });
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
  const insertSectionAt = (index: number, cols: number) =>
    update((d) => { d.sections.splice(index, 0, newSection(cols)); });
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
    if (!focusedColumn) {
      update((d) => {
        const s = newSection(1);
        (s.children[0] as ColumnNode).children.push(makeWidget(type));
        d.sections.push(s);
      });
      return;
    }
    addWidgetToColumn(focusedColumn.id, type);
  };

  const addWidgetToColumn = (colId: string, type: WidgetType) => update((d) => {
    const c = findColumn(d, colId);
    if (c) c.children.push(makeWidget(type));
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
    <div className="grid grid-cols-[360px_1fr] gap-3 h-[calc(100vh-220px)] min-h-[600px]">
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

        <div className="flex-1 overflow-y-auto p-4" onClick={() => setSelection({ kind: null, id: null })}>
          <div className={`mx-auto transition-all ${device==="desktop"?"max-w-full":device==="tablet"?"max-w-[768px]":"max-w-[400px]"}`}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              {doc.sections.length === 0 && <EmptyState onAdd={addSection} />}

              <SectionDropZone onInsert={(cols) => insertSectionAt(0, cols)} index={0} />

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
                  <SectionDropZone onInsert={(cols) => insertSectionAt(idx + 1, cols)} index={idx + 1} />
                </div>
              ))}
            </DndContext>
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

function EmptyState({ onAdd }: { onAdd: (cols: number) => void }) {
  const STRUCTURES = [{ cols: 1, label: "1" }, { cols: 2, label: "1/2 + 1/2" }, { cols: 3, label: "1/3 x3" }, { cols: 4, label: "1/4 x4" }];
  return (
    <div className="bg-card/50 border-2 border-dashed border-border rounded-lg p-8 text-center">
      <p className="text-sm text-muted-foreground mb-4">Wybierz strukturę pierwszej sekcji</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {STRUCTURES.map((s) => (
          <button key={s.cols} onClick={() => onAdd(s.cols)}
            className="px-3 py-2 bg-muted hover:bg-brand hover:text-brand-foreground rounded text-xs transition">
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Tiny zone between sections to insert a new section.
function SectionDropZone({ onInsert, index }: { onInsert: (cols: number) => void; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1 group" onClick={(e) => e.stopPropagation()}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full h-6 rounded border border-dashed border-transparent group-hover:border-brand/40 text-[10px] text-muted-foreground hover:text-brand inline-flex items-center justify-center gap-1"
          title={`Wstaw sekcję w pozycji ${index + 1}`}
        >
          <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100" />
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-1 p-1 border border-border rounded bg-card">
          {[1, 2, 3, 4].map((c) => (
            <button key={c} onClick={() => { onInsert(c); setOpen(false); }}
              className="px-2 py-1 text-[10px] bg-muted hover:bg-brand hover:text-brand-foreground rounded">
              {c === 1 ? "1" : `1/${c} x${c}`}
            </button>
          ))}
          <button onClick={() => setOpen(false)} className="px-1 text-[10px] text-muted-foreground ml-auto">×</button>
        </div>
      )}
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
