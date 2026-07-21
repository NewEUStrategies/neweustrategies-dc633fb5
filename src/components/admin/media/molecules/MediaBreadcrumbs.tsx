import { useTranslation } from "react-i18next";
import type { DragEvent } from "react";
import { ChevronRight, Home } from "@/lib/lucide-shim";
import { cn } from "@/lib/utils";
import { buildBreadcrumbs } from "../lib/mediaPaths";

interface MediaBreadcrumbsProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onFolderDrop: (path: string) => (e: DragEvent) => void;
  selectedCount: number;
  itemCount: number;
}

/**
 * Molecule: the folder trail above the canvas. Each crumb is a drop target
 * (move into that folder) and a navigation button; the right side shows either
 * the selection count or the total number of items in the folder.
 */
export function MediaBreadcrumbs({
  currentPath,
  onNavigate,
  onFolderDrop,
  selectedCount,
  itemCount,
}: MediaBreadcrumbsProps) {
  const { t } = useTranslation();
  const crumbs = buildBreadcrumbs(currentPath);

  return (
    <div
      className="flex items-center gap-1 px-3 py-2 border-b border-border text-xs flex-wrap"
      data-nomarquee
    >
      {crumbs.map((c, i) => (
        <span key={c.path} className="flex items-center gap-1">
          {i === 0 ? <Home className="w-3.5 h-3.5" /> : null}
          <button
            type="button"
            onClick={() => onNavigate(c.path)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onFolderDrop(c.path)}
            className={cn("px-1 rounded hover:bg-muted", c.path === currentPath && "font-semibold")}
          >
            {c.label}
          </button>
          {i < crumbs.length - 1 && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        </span>
      ))}
      <span className="ml-auto text-muted-foreground">
        {selectedCount
          ? t("admin.media.selectedCount", {
              count: selectedCount,
              defaultValue: `Zaznaczono: ${selectedCount}`,
            })
          : `${itemCount} ${t("admin.media.items", { defaultValue: "elementów" })}`}
      </span>
    </div>
  );
}
