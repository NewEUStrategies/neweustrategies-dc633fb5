/**
 * Drag & drop wiring for the media canvas and folder targets.
 *
 * Two independent gestures share one payload channel:
 *   - OS files dragged onto the canvas or a folder  -> upload to that folder
 *   - selected items dragged onto a folder           -> move (serialised as the
 *     `application/x-media-ids` data-transfer type)
 */
import { useCallback, useState, type DragEvent } from "react";

const MEDIA_IDS_MIME = "application/x-media-ids";

export interface UseMediaDragDropArgs {
  currentPath: string;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  uploadFiles: (files: File[], targetFolder: string) => void;
  doMove: (ids: string[], target: string) => void;
}

export interface UseMediaDragDropResult {
  dragOver: boolean;
  onCanvasDragOver: (e: DragEvent) => void;
  onCanvasDragLeave: () => void;
  onCanvasDrop: (e: DragEvent) => void;
  onFolderDrop: (path: string) => (e: DragEvent) => void;
  onItemDragStart: (id: string) => (e: DragEvent) => void;
}

export function useMediaDragDrop(args: UseMediaDragDropArgs): UseMediaDragDropResult {
  const { currentPath, selectedIds, setSelectedIds, uploadFiles, doMove } = args;
  const [dragOver, setDragOver] = useState(false);

  const onCanvasDragOver = useCallback((e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  }, []);

  const onCanvasDragLeave = useCallback(() => setDragOver(false), []);

  const onCanvasDrop = useCallback(
    (e: DragEvent) => {
      if (Array.from(e.dataTransfer.types).includes("Files")) {
        e.preventDefault();
        setDragOver(false);
        uploadFiles(Array.from(e.dataTransfer.files), currentPath);
      }
    },
    [currentPath, uploadFiles],
  );

  const onFolderDrop = useCallback(
    (path: string) => (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      if (files.length) {
        uploadFiles(files, path);
        return;
      }
      const idsRaw = e.dataTransfer.getData(MEDIA_IDS_MIME);
      if (idsRaw) {
        try {
          const parsed: unknown = JSON.parse(idsRaw);
          const ids = Array.isArray(parsed)
            ? parsed.filter((v): v is string => typeof v === "string")
            : [];
          if (ids.length) doMove(ids, path);
        } catch {
          /* malformed payload - ignore */
        }
      }
    },
    [uploadFiles, doMove],
  );

  const onItemDragStart = useCallback(
    (id: string) => (e: DragEvent) => {
      const ids = selectedIds.has(id) ? Array.from(selectedIds) : [id];
      if (!selectedIds.has(id)) setSelectedIds(new Set([id]));
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(MEDIA_IDS_MIME, JSON.stringify(ids));
    },
    [selectedIds, setSelectedIds],
  );

  return {
    dragOver,
    onCanvasDragOver,
    onCanvasDragLeave,
    onCanvasDrop,
    onFolderDrop,
    onItemDragStart,
  };
}
