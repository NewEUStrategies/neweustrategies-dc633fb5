import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { MediaRow } from "../types";
import { extOf, formatBytes } from "../lib/mediaFormat";

interface MediaListRowProps {
  file: MediaRow;
  selected: boolean;
  onSelect: (id: string, ev?: ReactMouseEvent) => void;
  onContext: (e: ReactMouseEvent, id: string) => void;
  onDragStart: (id: string) => (e: DragEvent) => void;
  onPreview: (file: MediaRow) => void;
}

/** Molecule: a single file row in the list view. */
export function MediaListRow({
  file,
  selected,
  onSelect,
  onContext,
  onDragStart,
  onPreview,
}: MediaListRowProps) {
  const isImage = file.mime_type?.startsWith("image/");
  return (
    <tr
      data-media-item={file.id}
      draggable
      onDragStart={onDragStart(file.id)}
      onClick={(e) => onSelect(file.id, e)}
      onDoubleClick={() => onPreview(file)}
      onContextMenu={(e) => onContext(e, file.id)}
      className={cn(
        "border-t border-border cursor-pointer",
        selected ? "bg-brand/10" : "hover:bg-muted/40",
      )}
    >
      <td className="px-3 py-1.5 flex items-center gap-2 truncate">
        {isImage ? (
          <img
            src={file.public_url}
            alt=""
            className="w-6 h-6 rounded object-cover"
            draggable={false}
          />
        ) : (
          <span className="w-6 h-6 rounded bg-muted flex items-center justify-center text-[9px]">
            {extOf(file.filename) || "?"}
          </span>
        )}
        <span className="truncate">{file.filename}</span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        <span className="text-[10px] uppercase tracking-wide">
          {file.mime_type ?? extOf(file.filename)}
        </span>
      </td>
      <td className="px-3 py-1.5 text-right text-muted-foreground">
        <span className="text-[10px]">{formatBytes(file.size_bytes)}</span>
      </td>
      <td className="px-3 py-1.5 text-muted-foreground">
        {new Date(file.created_at).toLocaleDateString()}
      </td>
    </tr>
  );
}
