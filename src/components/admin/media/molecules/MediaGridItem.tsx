import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { MediaRow } from "../types";
import { extOf, formatBytes } from "../lib/mediaFormat";
import { MediaThumbnail } from "../atoms/MediaThumbnail";
import { SelectionBadge } from "../atoms/SelectionBadge";

interface MediaGridItemProps {
  file: MediaRow;
  selected: boolean;
  renaming: boolean;
  renameDraft: string;
  onRenameDraft: (v: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
  onSelect: (id: string, ev?: ReactMouseEvent) => void;
  onContext: (e: ReactMouseEvent, id: string) => void;
  onDragStart: (id: string) => (e: DragEvent) => void;
  onPreview: (file: MediaRow) => void;
}

/** Molecule: a single file tile in the grid view. */
export function MediaGridItem({
  file,
  selected,
  renaming,
  renameDraft,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel,
  onSelect,
  onContext,
  onDragStart,
  onPreview,
}: MediaGridItemProps) {
  return (
    <div
      data-media-item={file.id}
      draggable
      onDragStart={onDragStart(file.id)}
      onClick={(e) => onSelect(file.id, e)}
      onContextMenu={(e) => onContext(e, file.id)}
      onDoubleClick={() => onPreview(file)}
      className={cn(
        "group relative rounded-md border overflow-hidden cursor-pointer transition-colors",
        selected
          ? "border-brand ring-2 ring-brand/40 bg-brand/5"
          : "border-border hover:border-brand/50",
      )}
    >
      <MediaThumbnail file={file} overlay={selected ? <SelectionBadge /> : null} />
      <div className="p-1.5 text-[10px]">
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={(e) => onRenameDraft(e.target.value)}
            onBlur={() => onRenameCommit(file.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameCommit(file.id);
              if (e.key === "Escape") onRenameCancel();
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-background border border-border rounded px-1 py-0.5 text-[10px]"
          />
        ) : (
          <div className="truncate font-medium" title={file.filename}>
            {file.filename}
          </div>
        )}
        <div className="text-muted-foreground flex justify-between gap-1 uppercase tracking-wide">
          <span className="text-[9px] leading-[11px]">{formatBytes(file.size_bytes)}</span>
          <span className="text-[9px] leading-[11px]">{extOf(file.filename)}</span>
        </div>
      </div>
    </div>
  );
}
