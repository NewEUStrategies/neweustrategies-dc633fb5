import { useState } from "react";
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Columns2, Copy, Save, Eye,
} from "@/lib/lucide-shim";
import type {
  SectionNode, ColumnNode, InnerSectionNode, WidgetNode,
  Device, WidgetType, ResponsiveValue,
} from "@/lib/builder/types";

function resolveSpan(span: ResponsiveValue<number>, device: Device, deskDefault: number): number {
  if (device === "mobile") return span.mobile ?? 12;
  if (device === "tablet") return span.tablet ?? span.desktop ?? deskDefault;
  return span.desktop ?? deskDefault;
}

import {
  sectionWrapperStyle, sectionContainerStyle, columnsRowStyle,
  backgroundLayerStyle, overlayLayerStyle, borderStyle,
  ShapeDivider, typographyCss, typographyAlign,
  INNER_SECTION_SAFE_AREA_PX, COLUMN_SAFE_AREA_PX,
} from "@/lib/builder/sectionStyles";
import { safeImageUrl } from "@/lib/sanitize";
import { WidgetView, getWidgetFrameStyle } from "../../../WidgetView";
import { IconBtn } from "../../atoms/IconBtn";
import type { Selection } from "./types";

export interface SectionViewProps {
  section: SectionNode; device: Device; lang: "pl" | "en";
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
  onUpdateWidgetContent: (id: string, key: string, value: string | number) => void;
}

export function SectionView(p: SectionViewProps) {
  const selected = p.selection.kind === "section" && p.selection.id === p.section.id;
  const colsSum = p.section.children.reduce((a, c) => a + (c.kind === "column" ? resolveSpan(c.span, p.device, 12) : 12), 0) || 12;
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
      className={`group relative my-3 min-w-0 max-w-full border-2 rounded-lg transition ${selected ? "border-brand" : "border-transparent hover:border-brand/40"}`}
      style={{ ...skin, overflow: "visible" }}
      onClick={(e) => { e.stopPropagation(); p.setSelection({ kind: "section", id: p.section.id }); }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none" aria-hidden>
        {p.section.background?.type === "video" && videoUrl && (
          <video src={videoUrl} autoPlay muted loop playsInline
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }} />
        )}
        <div style={overlayLayerStyle(p.section.overlay)} aria-hidden />
        <ShapeDivider s={p.section.shapeDividerTop} position="top" />
        <ShapeDivider s={p.section.shapeDividerBottom} position="bottom" />
      </div>

      <div className={`absolute -top-3 left-3 z-30 flex items-center gap-0.5 bg-background border border-border rounded px-1 py-0.5 text-[10px] shadow-sm transition ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
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
        <div className="min-w-0 max-w-full overflow-hidden" style={columnsRowStyle(p.section, colsSum)}>
          {p.section.children.map((child) => {
            const span = child.kind === "column" ? resolveSpan(child.span, p.device, 12) : 12;
            const gridColumn = p.device === "mobile" ? "1 / -1" : `span ${span}`;
            if (child.kind === "inner-section") {
              return (
                <div key={child.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn }}>
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
              <div key={child.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn }}>
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
  inner: InnerSectionNode; device: Device; lang: "pl" | "en"; selection: Selection;
  setSelection: (s: Selection) => void;
  onRemoveColumn: (id: string) => void; onDuplicateColumn: (id: string) => void;
  onRemoveWidget: (id: string) => void; onDuplicateWidget: (id: string) => void;
  onDropWidget: (colId: string, type: WidgetType) => void;
  onUpdateWidgetContent: (id: string, key: string, value: string | number) => void;
}) {
  const selected = selection.kind === "inner-section" && selection.id === inner.id;
  const colsSum = inner.columns.reduce((a, c) => a + resolveSpan(c.span, device, 6), 0) || 12;
  const skin: React.CSSProperties = {
    ...sectionWrapperStyle(inner),
    ...backgroundLayerStyle(inner.background),
    ...borderStyle(inner.border),
  };
  return (
    <div
      data-inner-id={inner.id}
      className={`relative min-w-0 max-w-full border rounded ${selected ? "border-brand" : "border-dashed border-border"}`}
      style={{ ...skin, overflow: "visible" }}
      onClick={(e) => { e.stopPropagation(); setSelection({ kind: "inner-section", id: inner.id }); }}
    >
      <div className="absolute -top-2.5 left-3 z-30 text-[9px] font-medium text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5 shadow-sm">SEKCJA WEWNĘTRZNA</div>
      <div className="grid gap-2 relative z-10 min-w-0 max-w-full" style={{ ...columnsRowStyle(inner, colsSum), padding: `${INNER_SECTION_SAFE_AREA_PX}px` }}>
        {inner.columns.map((c) => (
          <div key={c.id} className="min-w-0 max-w-full overflow-hidden" style={{ gridColumn: device === "mobile" ? "1 / -1" : `span ${resolveSpan(c.span, device, 6)}` }}>

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
  column: ColumnNode; device: Device; lang: "pl" | "en"; selection: Selection;
  setSelection: (s: Selection) => void;
  onRemove: () => void; onDuplicate: () => void;
  onRemoveWidget: (id: string) => void; onDuplicateWidget: (id: string) => void;
  onDropWidget: (colId: string, type: WidgetType) => void;
  onUpdateWidgetContent: (id: string, key: string, value: string | number) => void;
}) {
  const selected = selection.kind === "column" && selection.id === column.id;
  const singleWidget = column.children.length <= 1;
  const [dragOver, setDragOver] = useState(false);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: "col:" + column.id });
  return (
    <div
      ref={setDropRef}
      data-col-id={column.id}
      className={`group/col relative min-w-0 max-w-full rounded border-2 ${selected ? "border-brand bg-brand/5" : (dragOver || isOver) ? "border-brand/70 bg-brand/5" : "border-dashed border-border/60"} transition`}
      style={{ padding: `${COLUMN_SAFE_AREA_PX}px`, boxSizing: "border-box", minHeight: column.style?.minHeight ?? 80, background: column.style?.bgColor, color: column.style?.textColor, borderRadius: column.style?.borderRadius, overflow: "visible" }}
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
      <div className={`absolute -top-2.5 right-2 z-30 flex items-center gap-0.5 bg-background border border-border rounded px-1 py-0.5 text-[10px] shadow-sm transition ${selected || dragOver ? "opacity-100" : "opacity-0 group-hover/col:opacity-100"}`}>
        <span className="text-muted-foreground px-1">KOLUMNA</span>
        <IconBtn onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplikuj"><Copy className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Usuń" danger><Trash2 className="w-3 h-3" /></IconBtn>
      </div>
      {column.children.length === 0 && (
        <div className="text-[10px] text-muted-foreground text-center py-6">
          {dragOver ? "Upuść widget tutaj" : "Przeciągnij lub kliknij widget z lewej kolumny"}
        </div>
      )}
      <SortableContext items={column.children.map((w) => w.id)} strategy={verticalListSortingStrategy}>
        {(() => {
          const va = column.verticalAlign ?? "start";
          const hClass = singleWidget
            ? (column.contentAlign === "center" ? "items-center" : column.contentAlign === "end" ? "items-end" : va === "stretch" ? "items-stretch" : "items-start")
            : (column.contentAlign === "center" ? "justify-center" : column.contentAlign === "end" ? "justify-end" : "justify-start");
          const vClass = singleWidget
            ? (va === "center" ? "justify-center" : va === "end" ? "justify-end" : va === "stretch" ? "justify-stretch" : "justify-start")
            : (va === "center" ? "content-center items-center" : va === "end" ? "content-end items-end" : va === "stretch" ? "content-stretch items-stretch" : "content-start items-start");
          return (
            <div className={`flex ${singleWidget ? "flex-col" : "flex-row flex-wrap"} h-full gap-2 min-w-0 max-w-full overflow-hidden ${hClass} ${vClass}`}>
              {column.children.map((w) => (
                <SortableWidget key={w.id} widget={w} lang={lang} device={device}
                  selected={selection.kind === "widget" && selection.id === w.id}
                  onSelect={() => setSelection({ kind: "widget", id: w.id })}
                  onDuplicate={() => onDuplicateWidget(w.id)}
                  onRemove={() => onRemoveWidget(w.id)}
                  onUpdateContent={(k, v) => onUpdateWidgetContent(w.id, k, v)} />
              ))}
            </div>
          );
        })()}
      </SortableContext>

    </div>
  );
}

function SortableWidget({
  widget, lang, device, selected, onSelect, onDuplicate, onRemove, onUpdateContent,
}: {
  widget: WidgetNode; lang: "pl" | "en"; device: Device; selected: boolean;
  onSelect: () => void; onDuplicate: () => void; onRemove: () => void;
  onUpdateContent: (key: string, value: string | number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: widget.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const hidden = !!widget.advanced?.hideOn?.[device];
  const frameStyle = getWidgetFrameStyle(widget, device);
  return (
    <div ref={setNodeRef} data-widget-id={widget.id} style={{ ...style, ...frameStyle, boxSizing: "border-box", padding: 0 }} {...attributes}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
      className={`group/w relative flex flex-col items-stretch justify-start shrink min-w-0 max-w-full overflow-hidden rounded border-2 ${selected ? "border-brand" : "border-transparent hover:border-brand/40"} ${hidden ? "opacity-40" : ""}`}
    >
      <div className={`absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 bg-background border border-border rounded px-1 py-0.5 text-[10px] transition ${selected ? "opacity-100" : "opacity-0 group-hover/w:opacity-100"}`}>
        <span {...listeners} className="cursor-grab text-muted-foreground px-1" title="Przeciągnij">⋮⋮</span>
        <IconBtn onClick={(e) => { e.stopPropagation(); onDuplicate(); }} title="Duplikuj"><Copy className="w-3 h-3" /></IconBtn>
        <IconBtn onClick={(e) => { e.stopPropagation(); onRemove(); }} title="Usuń" danger><Trash2 className="w-3 h-3" /></IconBtn>
      </div>
      <div className={selected ? "h-full w-full" : "pointer-events-none h-full w-full"}>
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
