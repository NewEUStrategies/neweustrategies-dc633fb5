// Drag-and-drop builder - sections > (inner-sections|columns) > widgets.
// Uses @dnd-kit for sortable widgets within columns. New widgets are added
// to the focused column by clicking a widget tile in the sidebar.
import { useState, useMemo } from "react";
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
  Layers, Settings as SettingsIcon, X, Eye, Search,
} from "lucide-react";
import { WIDGETS, makeWidget } from "@/lib/builder/registry";
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode,
  Device, WidgetType, CommonStyle, ResponsiveValue,
} from "@/lib/builder/types";
import { emptyDocument, newId } from "@/lib/builder/types";
import { WidgetView } from "./WidgetView";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

type SelectionKind = "section" | "column" | "widget" | "inner-section" | null;
interface Selection {
  kind: SelectionKind;
  id: string | null;
}

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

const STRUCTURES: Array<{ cols: number; label: string }> = [
  { cols: 1, label: "1" }, { cols: 2, label: "1/2 + 1/2" },
  { cols: 3, label: "1/3 x3" }, { cols: 4, label: "1/4 x4" }, { cols: 6, label: "1/6 x6" },
];

export function Builder({ value, onChange, lang, onLangChange }: Props) {
  const doc = value ?? emptyDocument();
  const [device, setDevice] = useState<Device>("desktop");
  const [selection, setSelection] = useState<Selection>({ kind: null, id: null });
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState<string | null>(null); // section.id to render picker into

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const update = (mut: (d: BuilderDocument) => void) => {
    const next: BuilderDocument = JSON.parse(JSON.stringify(doc));
    mut(next);
    onChange(next);
  };

  // ---------- helpers to locate nodes by id ----------
  const findWidget = (d: BuilderDocument, id: string):
    { widget: WidgetNode; column: ColumnNode } | null => {
    for (const s of d.sections) {
      for (const child of s.children) {
        const cols = child.kind === "column" ? [child] : child.columns;
        for (const col of cols) {
          const w = col.children.find((x) => x.id === id);
          if (w) return { widget: w, column: col };
        }
      }
    }
    return null;
  };

  const focusedColumn = useMemo<ColumnNode | null>(() => {
    if (selection.kind === "column" && selection.id) {
      for (const s of doc.sections) for (const c of s.children) {
        if (c.kind === "column" && c.id === selection.id) return c;
        if (c.kind === "inner-section") {
          const f = c.columns.find((x) => x.id === selection.id);
          if (f) return f;
        }
      }
    }
    if (selection.kind === "widget" && selection.id) {
      return findWidget(doc, selection.id)?.column ?? null;
    }
    // fallback: first column
    for (const s of doc.sections) for (const c of s.children) {
      if (c.kind === "column") return c;
      if (c.kind === "inner-section" && c.columns[0]) return c.columns[0];
    }
    return null;
  }, [doc, selection]);

  const addWidgetToFocused = (type: WidgetType) => {
    if (!focusedColumn) {
      // create a section first
      update((d) => {
        const s = newSection(1);
        const w = makeWidget(type);
        s.children[0].kind === "column" && (s.children[0] as ColumnNode).children.push(w);
        d.sections.push(s);
      });
      return;
    }
    const colId = focusedColumn.id;
    update((d) => {
      for (const s of d.sections) for (const c of s.children) {
        if (c.kind === "column" && c.id === colId) c.children.push(makeWidget(type));
        else if (c.kind === "inner-section") {
          const f = c.columns.find((x) => x.id === colId);
          if (f) f.children.push(makeWidget(type));
        }
      }
    });
  };

  const addSection = (cols: number) => update((d) => { d.sections.push(newSection(cols)); });
  const removeSection = (id: string) => update((d) => { d.sections = d.sections.filter((s) => s.id !== id); });
  const moveSection = (id: string, dir: -1 | 1) => update((d) => {
    const i = d.sections.findIndex((s) => s.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= d.sections.length) return;
    [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]];
  });
  const addInnerSection = (sectionId: string) => update((d) => {
    const s = d.sections.find((x) => x.id === sectionId);
    if (s) s.children.push(newInnerSection());
  });
  const addColumn = (sectionId: string) => update((d) => {
    const s = d.sections.find((x) => x.id === sectionId);
    if (s) {
      const cols = s.children.filter((c) => c.kind === "column").length;
      s.children.push(newColumn(Math.floor(12 / (cols + 1))));
    }
  });
  const removeColumn = (colId: string) => update((d) => {
    for (const s of d.sections) {
      s.children = s.children.filter((c) => !(c.kind === "column" && c.id === colId));
      for (const c of s.children) if (c.kind === "inner-section")
        c.columns = c.columns.filter((x) => x.id !== colId);
    }
  });
  const removeWidget = (wid: string) => update((d) => {
    for (const s of d.sections) for (const c of s.children) {
      const cols = c.kind === "column" ? [c] : c.columns;
      for (const col of cols) col.children = col.children.filter((w) => w.id !== wid);
    }
  });

  const updateWidget = (wid: string, mut: (w: WidgetNode) => void) => update((d) => {
    const f = findWidget(d, wid);
    if (f) mut(f.widget);
  });

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

  const filteredWidgets = WIDGETS.filter((w) =>
    w.label.toLowerCase().includes(search.toLowerCase())
  );

  const selectedWidget = selection.kind === "widget" && selection.id
    ? findWidget(doc, selection.id)?.widget ?? null : null;

  return (
    <div className="grid grid-cols-[300px_1fr_320px] gap-3 h-[calc(100vh-220px)] min-h-[600px]">
      {/* SIDEBAR - WIDGETS */}
      <aside className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-2"><Layers className="w-4 h-4" /> Widgety</h3>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Szukaj..." className="pl-7 h-8 text-xs" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {(["basic", "media", "dynamic", "form"] as const).map((cat) => {
            const items = filteredWidgets.filter((w) => w.category === cat);
            if (!items.length) return null;
            const labels: Record<string, string> = { basic: "Podstawowe", media: "Media", dynamic: "Dynamiczne", form: "Formularze" };
            return (
              <div key={cat}>
                <div className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">{labels[cat]}</div>
                <div className="grid grid-cols-2 gap-2">
                  {items.map((w) => {
                    const Icon = w.icon;
                    return (
                      <button
                        key={w.type}
                        type="button"
                        onClick={() => addWidgetToFocused(w.type)}
                        className="aspect-square bg-muted/30 hover:bg-muted hover:border-brand border border-border rounded flex flex-col items-center justify-center gap-1 p-2 transition group"
                        title={`Dodaj: ${w.label}`}
                      >
                        <Icon className="w-5 h-5 text-muted-foreground group-hover:text-brand" />
                        <span className="text-[10px] text-center leading-tight">{w.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {/* CANVAS */}
      <div className="bg-muted/20 border border-border rounded-lg flex flex-col overflow-hidden">
        <div className="border-b border-border p-2 flex items-center justify-between gap-2 bg-card">
          <div className="flex gap-1">
            {(["pl","en"] as const).map((l) => (
              <button key={l} onClick={() => onLangChange(l)} className={`px-2.5 py-1 text-xs rounded ${lang===l?"bg-brand text-brand-foreground":"bg-muted"}`}>{l.toUpperCase()}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {([["desktop", Monitor],["tablet", Tablet],["mobile", Smartphone]] as const).map(([d, Icon]) => (
              <button key={d} onClick={() => setDevice(d)} className={`p-1.5 rounded ${device===d?"bg-brand text-brand-foreground":"bg-muted hover:bg-muted/70"}`} title={d}>
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Podgląd na żywo</div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className={`mx-auto transition-all ${device==="desktop"?"max-w-full":device==="tablet"?"max-w-[768px]":"max-w-[400px]"}`}>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              {doc.sections.length === 0 && (
                <EmptyState onAdd={addSection} />
              )}
              {doc.sections.map((s, idx) => (
                <SectionView
                  key={s.id}
                  section={s}
                  device={device}
                  lang={lang}
                  selection={selection}
                  setSelection={setSelection}
                  isFirst={idx===0}
                  isLast={idx===doc.sections.length-1}
                  onMove={(dir) => moveSection(s.id, dir)}
                  onRemove={() => removeSection(s.id)}
                  onAddInnerSection={() => addInnerSection(s.id)}
                  onAddColumn={() => addColumn(s.id)}
                  onRemoveColumn={removeColumn}
                  onRemoveWidget={removeWidget}
                />
              ))}
              <div className="mt-4">
                <StructurePicker onPick={addSection} open={showPicker === "root"} setOpen={(v) => setShowPicker(v ? "root" : null)} />
              </div>
            </DndContext>
          </div>
        </div>
      </div>

      {/* PROPERTIES */}
      <aside className="bg-card border border-border rounded-lg flex flex-col overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-medium inline-flex items-center gap-2"><SettingsIcon className="w-4 h-4" /> Właściwości</h3>
          {selection.kind && <button onClick={() => setSelection({ kind: null, id: null })}><X className="w-4 h-4" /></button>}
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {selectedWidget ? (
            <WidgetProperties
              widget={selectedWidget}
              lang={lang}
              device={device}
              onChange={(mut) => updateWidget(selectedWidget.id, mut)}
            />
          ) : (
            <div className="text-xs text-muted-foreground text-center py-8">
              Wybierz element na płótnie, aby edytować jego właściwości.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: (cols: number) => void }) {
  return (
    <div className="bg-card/50 border-2 border-dashed border-border rounded-lg p-8 text-center">
      <p className="text-sm text-muted-foreground mb-4">Wybierz strukturę pierwszej sekcji</p>
      <div className="flex flex-wrap gap-2 justify-center">
        {STRUCTURES.map((s) => (
          <button key={s.cols} onClick={() => onAdd(s.cols)} className="px-3 py-2 bg-muted hover:bg-brand hover:text-brand-foreground rounded text-xs transition">
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StructurePicker({ onPick, open, setOpen }: { onPick: (n: number) => void; open: boolean; setOpen: (v: boolean) => void }) {
  if (!open) return (
    <button onClick={() => setOpen(true)} className="w-full py-3 border-2 border-dashed border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-brand inline-flex items-center justify-center gap-2">
      <Plus className="w-4 h-4" /> Dodaj sekcję
    </button>
  );
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="text-xs text-muted-foreground mb-2">Wybierz strukturę</div>
      <div className="flex flex-wrap gap-2">
        {STRUCTURES.map((s) => (
          <button key={s.cols} onClick={() => { onPick(s.cols); setOpen(false); }} className="px-3 py-2 bg-muted hover:bg-brand hover:text-brand-foreground rounded text-xs">
            {s.label}
          </button>
        ))}
        <button onClick={() => setOpen(false)} className="px-2 py-2 text-xs text-muted-foreground">Anuluj</button>
      </div>
    </div>
  );
}

interface SectionViewProps {
  section: SectionNode;
  device: Device;
  lang: "pl" | "en";
  selection: Selection;
  setSelection: (s: Selection) => void;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onAddInnerSection: () => void;
  onAddColumn: () => void;
  onRemoveColumn: (id: string) => void;
  onRemoveWidget: (id: string) => void;
}

function SectionView(p: SectionViewProps) {
  const selected = p.selection.kind === "section" && p.selection.id === p.section.id;
  return (
    <div
      className={`relative my-3 border-2 rounded-lg transition ${selected ? "border-brand" : "border-transparent hover:border-brand/40"}`}
      onClick={(e) => { e.stopPropagation(); p.setSelection({ kind: "section", id: p.section.id }); }}
    >
      <div className="absolute -top-3 left-3 z-10 flex items-center gap-1 bg-background border border-border rounded px-1.5 py-0.5 text-[10px] opacity-0 group-hover:opacity-100 hover:opacity-100" style={{ opacity: selected ? 1 : undefined }}>
        <span className="font-medium text-muted-foreground">SEKCJA</span>
        <button onClick={(e) => { e.stopPropagation(); p.onMove(-1); }} disabled={p.isFirst} className="hover:text-brand disabled:opacity-30"><ChevronUp className="w-3 h-3" /></button>
        <button onClick={(e) => { e.stopPropagation(); p.onMove(1); }} disabled={p.isLast} className="hover:text-brand disabled:opacity-30"><ChevronDown className="w-3 h-3" /></button>
        <button onClick={(e) => { e.stopPropagation(); p.onAddColumn(); }} className="hover:text-brand" title="Dodaj kolumnę"><Columns2 className="w-3 h-3" /></button>
        <button onClick={(e) => { e.stopPropagation(); p.onAddInnerSection(); }} className="hover:text-brand" title="Dodaj sekcję wewnętrzną"><Plus className="w-3 h-3" /></button>
        <button onClick={(e) => { e.stopPropagation(); p.onRemove(); }} className="hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
      </div>
      <div className="grid gap-3 p-3" style={{ gridTemplateColumns: `repeat(${p.section.children.reduce((a, c) => a + (c.kind === "column" ? (c.span.desktop ?? 12) : 12), 0) || 12}, minmax(0, 1fr))` }}>
        {p.section.children.map((child) => {
          const span = child.kind === "column" ? (child.span.desktop ?? 12) : 12;
          if (child.kind === "inner-section") {
            return (
              <div key={child.id} style={{ gridColumn: `span ${span}` }}>
                <InnerSectionView
                  inner={child} device={p.device} lang={p.lang}
                  selection={p.selection} setSelection={p.setSelection}
                  onRemoveColumn={p.onRemoveColumn} onRemoveWidget={p.onRemoveWidget}
                />
              </div>
            );
          }
          return (
            <div key={child.id} style={{ gridColumn: `span ${span}` }}>
              <ColumnView column={child} device={p.device} lang={p.lang}
                selection={p.selection} setSelection={p.setSelection}
                onRemove={() => p.onRemoveColumn(child.id)}
                onRemoveWidget={p.onRemoveWidget} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InnerSectionView({ inner, device, lang, selection, setSelection, onRemoveColumn, onRemoveWidget }: {
  inner: InnerSectionNode; device: Device; lang: "pl"|"en"; selection: Selection;
  setSelection: (s: Selection) => void; onRemoveColumn: (id: string) => void; onRemoveWidget: (id: string) => void;
}) {
  const selected = selection.kind === "inner-section" && selection.id === inner.id;
  return (
    <div
      className={`border rounded p-2 ${selected ? "border-brand" : "border-dashed border-border"}`}
      onClick={(e) => { e.stopPropagation(); setSelection({ kind: "inner-section", id: inner.id }); }}
    >
      <div className="text-[10px] text-muted-foreground mb-1">SEKCJA WEWNĘTRZNA</div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${inner.columns.reduce((a, c) => a + (c.span.desktop ?? 6), 0) || 12}, minmax(0, 1fr))` }}>
        {inner.columns.map((c) => (
          <div key={c.id} style={{ gridColumn: `span ${c.span.desktop ?? 6}` }}>
            <ColumnView column={c} device={device} lang={lang} selection={selection}
              setSelection={setSelection} onRemove={() => onRemoveColumn(c.id)} onRemoveWidget={onRemoveWidget} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnView({ column, device, lang, selection, setSelection, onRemove, onRemoveWidget }: {
  column: ColumnNode; device: Device; lang: "pl"|"en"; selection: Selection;
  setSelection: (s: Selection) => void; onRemove: () => void; onRemoveWidget: (id: string) => void;
}) {
  const selected = selection.kind === "column" && selection.id === column.id;
  return (
    <div
      className={`min-h-[80px] rounded border-2 ${selected ? "border-brand bg-brand/5" : "border-dashed border-border/60"} p-2 transition`}
      onClick={(e) => { e.stopPropagation(); setSelection({ kind: "column", id: column.id }); }}
    >
      {column.children.length === 0 && (
        <div className="text-[10px] text-muted-foreground text-center py-4">Kliknij widget z lewej kolumny, aby tu dodać</div>
      )}
      <SortableContext items={column.children.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        {column.children.map((w) => (
          <SortableWidget key={w.id} widget={w} lang={lang} device={device}
            selected={selection.kind === "widget" && selection.id === w.id}
            onSelect={() => setSelection({ kind: "widget", id: w.id })}
            onRemove={() => onRemoveWidget(w.id)} />
        ))}
      </SortableContext>
      {selected && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="text-[10px] text-destructive mt-1 hover:underline">Usuń kolumnę</button>
      )}
    </div>
  );
}

function SortableWidget({ widget, lang, device, selected, onSelect, onRemove }: {
  widget: WidgetNode; lang: "pl"|"en"; device: Device; selected: boolean; onSelect: () => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`relative my-1 rounded border-2 ${selected ? "border-brand" : "border-transparent hover:border-brand/40"} p-1`}
    >
      {selected && (
        <div className="absolute -top-3 right-2 z-10 flex items-center gap-1 bg-background border border-border rounded px-1 py-0.5 text-[10px]">
          <span {...listeners} className="cursor-grab text-muted-foreground px-1">⋮⋮</span>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="hover:text-destructive"><Trash2 className="w-3 h-3" /></button>
        </div>
      )}
      <div className="pointer-events-none">
        <WidgetView node={widget} lang={lang} device={device} />
      </div>
    </div>
  );
}

// -------------------- Properties panel --------------------
function WidgetProperties({ widget, lang, device, onChange }: {
  widget: WidgetNode; lang: "pl"|"en"; device: Device;
  onChange: (mut: (w: WidgetNode) => void) => void;
}) {
  const setContent = (k: string, v: unknown) => onChange((w) => { w.content[k] = v; });
  const setStyle = (mut: (s: CommonStyle) => void) => onChange((w) => {
    w.style = w.style ?? {};
    mut(w.style);
  });
  const setAdvanced = (mut: (a: NonNullable<WidgetNode["advanced"]>) => void) => onChange((w) => {
    w.advanced = w.advanced ?? {};
    mut(w.advanced);
  });
  const setResp = <T,>(rv: ResponsiveValue<T> | undefined, val: T): ResponsiveValue<T> => ({
    ...(rv ?? {}), [device]: val,
  });

  return (
    <Tabs defaultValue="content">
      <TabsList className="grid grid-cols-3 w-full h-8">
        <TabsTrigger value="content" className="text-xs">Content</TabsTrigger>
        <TabsTrigger value="style" className="text-xs">Style</TabsTrigger>
        <TabsTrigger value="advanced" className="text-xs">Advanced</TabsTrigger>
      </TabsList>

      <TabsContent value="content" className="space-y-3 mt-3">
        <ContentFields widget={widget} lang={lang} setContent={setContent} />
      </TabsContent>

      <TabsContent value="style" className="space-y-3 mt-3">
        <div className="text-[10px] text-muted-foreground uppercase">Edytujesz: {device}</div>
        <div>
          <Label className="text-xs">Tło</Label>
          <Input type="text" value={widget.style?.bgColor ?? ""} onChange={(e) => setStyle((s) => { s.bgColor = e.target.value || undefined; })} placeholder="#fff lub var(--brand)" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Kolor tekstu</Label>
          <Input type="text" value={widget.style?.textColor ?? ""} onChange={(e) => setStyle((s) => { s.textColor = e.target.value || undefined; })} placeholder="#000" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Padding ({device})</Label>
          <Input value={widget.style?.padding?.[device] ?? ""} onChange={(e) => setStyle((s) => { s.padding = setResp(s.padding, e.target.value || undefined as unknown as string); })} placeholder="16px 24px" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Margin ({device})</Label>
          <Input value={widget.style?.margin?.[device] ?? ""} onChange={(e) => setStyle((s) => { s.margin = setResp(s.margin, e.target.value || undefined as unknown as string); })} placeholder="0 0 16px" className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Wyrównanie ({device})</Label>
          <Select value={widget.style?.align?.[device] ?? "left"} onValueChange={(v) => setStyle((s) => { s.align = setResp(s.align, v as "left"|"center"|"right"); })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="left">Lewo</SelectItem>
              <SelectItem value="center">Środek</SelectItem>
              <SelectItem value="right">Prawo</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Border radius</Label>
          <Input value={widget.style?.borderRadius ?? ""} onChange={(e) => setStyle((s) => { s.borderRadius = e.target.value || undefined; })} placeholder="8px" className="h-8 text-xs" />
        </div>
      </TabsContent>

      <TabsContent value="advanced" className="space-y-3 mt-3">
        <div>
          <Label className="text-xs">HTML ID</Label>
          <Input value={widget.advanced?.htmlId ?? ""} onChange={(e) => setAdvanced((a) => { a.htmlId = e.target.value || undefined; })} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">CSS class</Label>
          <Input value={widget.advanced?.cssClass ?? ""} onChange={(e) => setAdvanced((a) => { a.cssClass = e.target.value || undefined; })} className="h-8 text-xs" />
        </div>
        <div>
          <Label className="text-xs">Animacja</Label>
          <Select value={widget.advanced?.animation ?? "none"} onValueChange={(v) => setAdvanced((a) => { a.animation = v as "none"|"fade"|"slide-up"|"zoom"; })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Brak</SelectItem>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="slide-up">Slide up</SelectItem>
              <SelectItem value="zoom">Zoom</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ukryj na</Label>
          {(["desktop","tablet","mobile"] as const).map((d) => (
            <label key={d} className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={widget.advanced?.hideOn?.[d] ?? false}
                onChange={(e) => setAdvanced((a) => { a.hideOn = { ...(a.hideOn ?? {}), [d]: e.target.checked }; })} />
              {d}
            </label>
          ))}
        </div>
        <div>
          <Label className="text-xs">Custom CSS</Label>
          <Textarea rows={3} value={widget.advanced?.customCss ?? ""} onChange={(e) => setAdvanced((a) => { a.customCss = e.target.value || undefined; })} className="text-xs font-mono" placeholder=".my-class { color: red; }" />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function ContentFields({ widget, lang, setContent }: {
  widget: WidgetNode; lang: "pl"|"en"; setContent: (k: string, v: unknown) => void;
}) {
  const c = widget.content;
  const str = (k: string): string => typeof c[k] === "string" ? (c[k] as string) : "";
  const num = (k: string, d: number): number => typeof c[k] === "number" ? (c[k] as number) : d;
  const arr = (k: string): string[] => Array.isArray(c[k]) ? (c[k] as string[]) : [];

  switch (widget.type) {
    case "heading":
      return <>
        <div><Label className="text-xs">Tekst ({lang.toUpperCase()})</Label>
          <Input value={str(`text_${lang}`)} onChange={(e) => setContent(`text_${lang}`, e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Tag</Label>
          <Select value={str("tag") || "h2"} onValueChange={(v) => setContent("tag", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["h1","h2","h3","h4"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select></div>
      </>;
    case "text":
      return <div><Label className="text-xs">HTML ({lang.toUpperCase()})</Label>
        <Textarea rows={6} value={str(`html_${lang}`)} onChange={(e) => setContent(`html_${lang}`, e.target.value)} className="text-xs font-mono" /></div>;
    case "image":
      return <>
        <div><Label className="text-xs">URL obrazka</Label>
          <Input value={str("src")} onChange={(e) => setContent("src", e.target.value)} placeholder="https://..." className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Alt ({lang.toUpperCase()})</Label>
          <Input value={str(`alt_${lang}`)} onChange={(e) => setContent(`alt_${lang}`, e.target.value)} className="h-8 text-xs" /></div>
      </>;
    case "button":
      return <>
        <div><Label className="text-xs">Etykieta ({lang.toUpperCase()})</Label>
          <Input value={str(`label_${lang}`)} onChange={(e) => setContent(`label_${lang}`, e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Link</Label>
          <Input value={str("href")} onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Wariant</Label>
          <Select value={str("variant") || "primary"} onValueChange={(v) => setContent("variant", v)}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{["primary","outline","ghost"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select></div>
      </>;
    case "spacer":
      return <div><Label className="text-xs">Wysokość (px)</Label>
        <Input type="number" value={num("height", 32)} onChange={(e) => setContent("height", Number(e.target.value))} className="h-8 text-xs" /></div>;
    case "video":
      return <div><Label className="text-xs">URL (YouTube lub MP4)</Label>
        <Input value={str("url")} onChange={(e) => setContent("url", e.target.value)} className="h-8 text-xs" /></div>;
    case "gallery":
      return <>
        <div><Label className="text-xs">Obrazki (po jednym URL na linię)</Label>
          <Textarea rows={5} value={arr("images").join("\n")} onChange={(e) => setContent("images", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} className="text-xs font-mono" /></div>
        <div><Label className="text-xs">Kolumny</Label>
          <Input type="number" min={1} max={6} value={num("columns", 3)} onChange={(e) => setContent("columns", Number(e.target.value))} className="h-8 text-xs" /></div>
      </>;
    case "icon":
      return <>
        <div><Label className="text-xs">Nazwa ikony (Lucide)</Label>
          <Input value={str("name") || "Star"} onChange={(e) => setContent("name", e.target.value)} placeholder="Star, Heart, Mail..." className="h-8 text-xs" /></div>
        <div><Label className="text-xs">Rozmiar (px)</Label>
          <Input type="number" value={num("size", 32)} onChange={(e) => setContent("size", Number(e.target.value))} className="h-8 text-xs" /></div>
      </>;
    case "map":
      return <div><Label className="text-xs">Adres / zapytanie</Label>
        <Input value={str("query")} onChange={(e) => setContent("query", e.target.value)} className="h-8 text-xs" /></div>;
    case "post-list":
    case "carousel":
      return <>
        <div><Label className="text-xs">Limit</Label>
          <Input type="number" value={num("limit", 6)} onChange={(e) => setContent("limit", Number(e.target.value))} className="h-8 text-xs" /></div>
        {widget.type === "post-list" && (
          <div><Label className="text-xs">Kolumny</Label>
            <Input type="number" min={1} max={6} value={num("columns", 3)} onChange={(e) => setContent("columns", Number(e.target.value))} className="h-8 text-xs" /></div>
        )}
      </>;
    case "newsletter":
    case "cta":
      return <>
        <div><Label className="text-xs">Tytuł ({lang.toUpperCase()})</Label>
          <Input value={str(`title_${lang}`)} onChange={(e) => setContent(`title_${lang}`, e.target.value)} className="h-8 text-xs" /></div>
        {widget.type === "cta" && (
          <>
            <div><Label className="text-xs">CTA ({lang.toUpperCase()})</Label>
              <Input value={str(`cta_${lang}`)} onChange={(e) => setContent(`cta_${lang}`, e.target.value)} className="h-8 text-xs" /></div>
            <div><Label className="text-xs">Link</Label>
              <Input value={str("href")} onChange={(e) => setContent("href", e.target.value)} className="h-8 text-xs" /></div>
          </>
        )}
      </>;
    case "contact":
      return <div><Label className="text-xs">Email odbiorcy</Label>
        <Input value={str("to")} onChange={(e) => setContent("to", e.target.value)} className="h-8 text-xs" /></div>;
    default:
      return <div className="text-xs text-muted-foreground">Brak edytowalnych pól.</div>;
  }
}
