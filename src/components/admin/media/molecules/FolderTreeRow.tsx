import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Folder, FolderOpen, Pencil, Trash2 } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";

interface FolderTreeRowProps {
  path: string;
  label: string;
  depth: number;
  active: boolean;
  /** Root has no rename/delete affordances. */
  showActions: boolean;
  onSelect: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onDrop: (path: string) => (e: DragEvent) => void;
}

/** Molecule: one row of the sidebar folder tree, indented by depth. */
export function FolderTreeRow({
  path,
  label,
  depth,
  active,
  showActions,
  onSelect,
  onRename,
  onDelete,
  onDrop,
}: FolderTreeRowProps) {
  const { t } = useTranslation();
  return (
    <div
      data-folder-item={path}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer hover:bg-muted group",
        active && "bg-muted font-semibold",
      )}
      style={{ paddingLeft: 8 + depth * 12 }}
      onClick={() => onSelect(path)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop(path)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {active ? (
        <FolderOpen className="w-3.5 h-3.5 text-brand" />
      ) : (
        <Folder className="w-3.5 h-3.5 text-muted-foreground" />
      )}
      <span className="truncate flex-1">{label}</span>
      {showActions && (
        <span className="hidden group-hover:flex items-center gap-0.5">
          <button
            type="button"
            className="p-0.5 hover:text-brand"
            onClick={(e) => {
              e.stopPropagation();
              onRename(path);
            }}
            aria-label={t("admin.media.rename", { defaultValue: "Zmień nazwę" })}
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            type="button"
            className="p-0.5 hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(path);
            }}
            aria-label={t("admin.delete", { defaultValue: "Usuń" })}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </span>
      )}
    </div>
  );
}
