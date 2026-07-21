import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { Folder } from "@/lib/lucide-shim";
import type { MediaRow } from "../types";
import { folderName } from "../lib/mediaPaths";
import { MediaGridItem } from "../molecules/MediaGridItem";

interface MediaGridViewProps {
  folders: string[];
  files: MediaRow[];
  selectedIds: Set<string>;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraft: (v: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
  onOpenFolder: (path: string) => void;
  onSelect: (id: string, ev?: ReactMouseEvent) => void;
  onContextFile: (e: ReactMouseEvent, id: string) => void;
  onContextFolder: (e: ReactMouseEvent, path: string) => void;
  onDragStart: (id: string) => (e: DragEvent) => void;
  onDropFolder: (path: string) => (e: DragEvent) => void;
  onPreviewFile: (file: MediaRow) => void;
}

/**
 * Organism: the responsive icon grid (2 -> 5 columns). Folders render first as
 * square tiles, files after as {@link MediaGridItem} cards.
 */
export function MediaGridView({
  folders,
  files,
  selectedIds,
  renamingId,
  renameDraft,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel,
  onOpenFolder,
  onSelect,
  onContextFile,
  onContextFolder,
  onDragStart,
  onDropFolder,
  onPreviewFile,
}: MediaGridViewProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {folders.map((p) => (
        <button
          key={p}
          type="button"
          data-folder-item={p}
          onDoubleClick={() => onOpenFolder(p)}
          onClick={() => onOpenFolder(p)}
          onContextMenu={(e) => onContextFolder(e, p)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropFolder(p)}
          className="flex flex-col items-center justify-center gap-2 aspect-square p-2 rounded-md border border-transparent bg-muted/30 hover:bg-muted/50 hover:border-border transition-colors"
        >
          <Folder className="w-14 h-14 text-brand" />
          <span className="text-[11px] truncate w-full text-center" title={folderName(p)}>
            {folderName(p)}
          </span>
        </button>
      ))}
      {files.map((file) => (
        <MediaGridItem
          key={file.id}
          file={file}
          selected={selectedIds.has(file.id)}
          renaming={renamingId === file.id}
          renameDraft={renameDraft}
          onRenameDraft={onRenameDraft}
          onRenameCommit={onRenameCommit}
          onRenameCancel={onRenameCancel}
          onSelect={onSelect}
          onContext={onContextFile}
          onDragStart={onDragStart}
          onPreview={onPreviewFile}
        />
      ))}
    </div>
  );
}
