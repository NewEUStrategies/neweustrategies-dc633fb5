import { useMemo, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FolderRow } from "../types";
import { folderDepth, folderName } from "../lib/mediaPaths";
import { FolderTreeRow } from "../molecules/FolderTreeRow";

interface MediaFolderTreeProps {
  folders: FolderRow[];
  currentPath: string;
  onSelect: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onDropFolder: (path: string) => (e: DragEvent) => void;
}

/**
 * Organism: the sidebar folder tree. Always includes the synthetic root and
 * every known folder, indented by depth and sorted lexicographically.
 */
export function MediaFolderTree({
  folders,
  currentPath,
  onSelect,
  onRename,
  onDelete,
  onDropFolder,
}: MediaFolderTreeProps) {
  const { t } = useTranslation();
  const paths = useMemo(() => {
    const all = new Set<string>(["/"]);
    for (const f of folders) all.add(f.path);
    return Array.from(all).sort();
  }, [folders]);

  return (
    <div className="p-2 text-xs">
      {paths.map((p) => (
        <FolderTreeRow
          key={p}
          path={p}
          label={p === "/" ? t("admin.media.root", { defaultValue: "Root" }) : folderName(p)}
          depth={folderDepth(p)}
          active={p === currentPath}
          showActions={p !== "/"}
          onSelect={onSelect}
          onRename={onRename}
          onDelete={onDelete}
          onDrop={onDropFolder}
        />
      ))}
    </div>
  );
}
