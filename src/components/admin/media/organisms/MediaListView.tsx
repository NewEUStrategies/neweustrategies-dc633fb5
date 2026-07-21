import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Folder } from "@/lib/lucide-shim";
import type { MediaRow } from "../types";
import { folderName } from "../lib/mediaPaths";
import { MediaListRow } from "../molecules/MediaListRow";

interface MediaListViewProps {
  folders: string[];
  files: MediaRow[];
  selectedIds: Set<string>;
  onOpenFolder: (path: string) => void;
  onSelect: (id: string, ev?: ReactMouseEvent) => void;
  onContextFile: (e: ReactMouseEvent, id: string) => void;
  onContextFolder: (e: ReactMouseEvent, path: string) => void;
  onDragStart: (id: string) => (e: DragEvent) => void;
  onDropFolder: (path: string) => (e: DragEvent) => void;
  onPreviewFile: (file: MediaRow) => void;
}

/** Organism: the dense table view. Folders render first, then files. */
export function MediaListView({
  folders,
  files,
  selectedIds,
  onOpenFolder,
  onSelect,
  onContextFile,
  onContextFolder,
  onDragStart,
  onDropFolder,
  onPreviewFile,
}: MediaListViewProps) {
  const { t } = useTranslation();
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">
              {t("admin.media.colName", { defaultValue: "Nazwa" })}
            </th>
            <th className="text-left px-3 py-2 font-medium">
              {t("admin.media.colType", { defaultValue: "Typ" })}
            </th>
            <th className="text-right px-3 py-2 font-medium">
              {t("admin.media.colSize", { defaultValue: "Rozmiar" })}
            </th>
            <th className="text-left px-3 py-2 font-medium">
              {t("admin.media.colDate", { defaultValue: "Data" })}
            </th>
          </tr>
        </thead>
        <tbody>
          {folders.map((p) => (
            <tr
              key={p}
              data-folder-item={p}
              onDoubleClick={() => onOpenFolder(p)}
              onClick={() => onOpenFolder(p)}
              onContextMenu={(e) => onContextFolder(e, p)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDropFolder(p)}
              className="border-t border-border cursor-pointer hover:bg-muted/40"
            >
              <td className="px-3 py-1.5 flex items-center gap-2">
                <Folder className="w-4 h-4 text-brand" />
                {folderName(p)}
              </td>
              <td className="px-3 py-1.5 text-muted-foreground">
                {t("admin.media.folder", { defaultValue: "Folder" })}
              </td>
              <td className="px-3 py-1.5 text-right text-muted-foreground">-</td>
              <td className="px-3 py-1.5 text-muted-foreground">-</td>
            </tr>
          ))}
          {files.map((file) => (
            <MediaListRow
              key={file.id}
              file={file}
              selected={selectedIds.has(file.id)}
              onSelect={onSelect}
              onContext={onContextFile}
              onDragStart={onDragStart}
              onPreview={onPreviewFile}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
