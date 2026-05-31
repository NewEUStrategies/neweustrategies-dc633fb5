// Layer tree (Navigator). Renders the document hierarchy and lets the user
// jump to / toggle visibility of a node by clicking it.
import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronDown, Eye, Layers } from "@/lib/lucide-shim";
import type {
  BuilderDocument, SectionNode, ColumnNode, InnerSectionNode, WidgetNode, Device,
} from "@/lib/builder/types";
import { WIDGET_MAP } from "@/lib/builder/registry";

interface Selection { kind: "section" | "column" | "widget" | "inner-section" | null; id: string | null; }

interface Props {
  doc: BuilderDocument;
  selection: Selection;
  device: Device;
  onSelect: (sel: Selection) => void;
  onToggleHidden: (id: string, kind: NonNullable<Selection["kind"]>) => void;
}

export function Navigator(p: Props) {
  return (
    <div className="text-xs">
      <div className="px-3 py-2 border-b border-border inline-flex items-center gap-2 w-full bg-card">
        <Layers className="w-3.5 h-3.5" />
        <span className="font-medium">Nawigator</span>
      </div>
      <div className="p-1 max-h-[260px] overflow-y-auto">
        {p.doc.sections.length === 0 && (
          <div className="text-muted-foreground p-2 text-[11px]">Brak sekcji.</div>
        )}
        {p.doc.sections.map((s, i) => (
          <SectionRow key={s.id} section={s} index={i + 1} {...p} />
        ))}
      </div>
    </div>
  );
}

function SectionRow({
  section, index, selection, device, onSelect, onToggleHidden,
}: Props & { section: SectionNode; index: number }) {
  const [open, setOpen] = useState(true);
  const selected = selection.kind === "section" && selection.id === section.id;
  const hidden = !!section.advanced?.hideOn?.[device];
  return (
    <div>
      <Row
        depth={0}
        open={open}
        onToggle={() => setOpen(!open)}
        selected={selected}
        hidden={hidden}
        label={`Sekcja ${index}`}
        onSelect={() => onSelect({ kind: "section", id: section.id })}
        onToggleHidden={() => onToggleHidden(section.id, "section")}
      />
      {open && section.children.map((c) =>
        c.kind === "inner-section"
          ? <InnerRow key={c.id} inner={c} selection={selection} device={device} onSelect={onSelect} onToggleHidden={onToggleHidden} doc={{ version: 1, sections: [] }} />
          : <ColumnRow key={c.id} column={c} depth={1} selection={selection} device={device} onSelect={onSelect} onToggleHidden={onToggleHidden} />,
      )}
    </div>
  );
}

function InnerRow({
  inner, selection, device, onSelect, onToggleHidden,
}: Omit<Props, "doc"> & { inner: InnerSectionNode } & { doc: BuilderDocument }) {
  const [open, setOpen] = useState(true);
  const selected = selection.kind === "inner-section" && selection.id === inner.id;
  return (
    <div>
      <Row depth={1} open={open} onToggle={() => setOpen(!open)} selected={selected} hidden={false}
        label="Sekcja wewn." onSelect={() => onSelect({ kind: "inner-section", id: inner.id })}
        onToggleHidden={() => {}} />
      {open && inner.columns.map((c) => (
        <ColumnRow key={c.id} column={c} depth={2} selection={selection} device={device} onSelect={onSelect} onToggleHidden={onToggleHidden} />
      ))}
    </div>
  );
}

function ColumnRow({
  column, depth, selection, device, onSelect, onToggleHidden,
}: { column: ColumnNode; depth: number; selection: Selection; device: Device;
     onSelect: (s: Selection) => void; onToggleHidden: (id: string, kind: NonNullable<Selection["kind"]>) => void; }) {
  const [open, setOpen] = useState(true);
  const selected = selection.kind === "column" && selection.id === column.id;
  const hidden = !!column.advanced?.hideOn?.[device];
  return (
    <div>
      <Row depth={depth} open={open} onToggle={() => setOpen(!open)} selected={selected} hidden={hidden}
        label={`Kolumna (${column.span?.[device] ?? column.span?.desktop ?? 12})`}
        onSelect={() => onSelect({ kind: "column", id: column.id })}
        onToggleHidden={() => onToggleHidden(column.id, "column")} />
      {open && column.children.map((w) => (
        <WidgetRow key={w.id} widget={w} depth={depth + 1} selection={selection} device={device} onSelect={onSelect} onToggleHidden={onToggleHidden} />
      ))}
    </div>
  );
}

function WidgetRow({
  widget, depth, selection, device, onSelect, onToggleHidden,
}: { widget: WidgetNode; depth: number; selection: Selection; device: Device;
     onSelect: (s: Selection) => void; onToggleHidden: (id: string, kind: NonNullable<Selection["kind"]>) => void; }) {
  const selected = selection.kind === "widget" && selection.id === widget.id;
  const def = WIDGET_MAP[widget.type];
  const hidden = !!widget.advanced?.hideOn?.[device];
  return (
    <Row depth={depth} leaf selected={selected} hidden={hidden}
      label={def?.label ?? widget.type}
      onSelect={() => onSelect({ kind: "widget", id: widget.id })}
      onToggleHidden={() => onToggleHidden(widget.id, "widget")} />
  );
}

function Row({
  depth, open, leaf, selected, hidden, label, onToggle, onSelect, onToggleHidden,
}: {
  depth: number; open?: boolean; leaf?: boolean; selected: boolean; hidden: boolean;
  label: string; onToggle?: () => void; onSelect: () => void; onToggleHidden: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);
  return (
    <div
      ref={ref}
      className={`flex items-center gap-1 py-1 pr-2 rounded cursor-pointer transition ${selected ? "bg-brand/20 text-brand ring-1 ring-brand/40" : "hover:bg-muted/50"}`}
      style={{ paddingLeft: `${4 + depth * 12}px` }}
      onClick={onSelect}
    >
      {leaf
        ? <span className="w-3.5" />
        : (
          <button onClick={(e) => { e.stopPropagation(); onToggle?.(); }} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}
      <span className={`flex-1 truncate ${hidden ? "opacity-50 line-through" : ""}`}>{label}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleHidden(); }}
        className="text-muted-foreground hover:text-foreground"
        title={hidden ? "Pokaż" : "Ukryj"}
      >
        <Eye className={`w-3 h-3 ${hidden ? "opacity-30" : ""}`} />
      </button>
    </div>
  );
}
