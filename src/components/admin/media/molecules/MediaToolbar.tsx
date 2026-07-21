import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload,
  Loader2,
  FolderPlus,
  Undo,
  Redo,
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  LayoutGrid,
  List,
  Info,
  Search,
} from "@/lib/lucide-shim";
import type { ViewMode } from "../types";

interface MediaToolbarProps {
  busy: boolean;
  viewMode: ViewMode;
  infoOpen: boolean;
  search: string;
  hasSelection: boolean;
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  atRoot: boolean;
  onUpload: () => void;
  onNewFolder: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSetViewMode: (v: ViewMode) => void;
  onToggleInfo: () => void;
  onSearch: (v: string) => void;
}

/**
 * Molecule: the media manager toolbar - upload, new folder, undo/redo,
 * clipboard, delete, view switch, info toggle and search. Purely presentational;
 * every action is delegated to the orchestrator.
 */
export function MediaToolbar({
  busy,
  viewMode,
  infoOpen,
  search,
  hasSelection,
  canPaste,
  canUndo,
  canRedo,
  atRoot,
  onUpload,
  onNewFolder,
  onUndo,
  onRedo,
  onCopy,
  onCut,
  onPaste,
  onDelete,
  onSetViewMode,
  onToggleInfo,
  onSearch,
}: MediaToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap" data-nomarquee>
      <h1 className="font-display text-xl font-bold mr-2">
        {t("admin.nav.media", { defaultValue: "Media" })}
      </h1>
      <Button size="sm" onClick={onUpload} disabled={busy}>
        {busy ? (
          <>
            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            {t("admin.media.uploading", { defaultValue: "Wgrywanie…" })}
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-1.5" />
            {t("admin.media.upload", { defaultValue: "Wgraj" })}
          </>
        )}
      </Button>
      <Button size="sm" variant="outline" onClick={onNewFolder}>
        <FolderPlus className="w-4 h-4 mr-1.5" />
        {t("admin.media.newFolder", { defaultValue: "Nowy folder" })}
      </Button>
      <div className="h-6 w-px bg-border mx-1" />
      <Button size="sm" variant="ghost" onClick={onUndo} disabled={!canUndo} title="Ctrl+Z">
        <Undo className="w-4 h-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onRedo} disabled={!canRedo} title="Ctrl+Shift+Z">
        <Redo className="w-4 h-4" />
      </Button>
      <div className="h-6 w-px bg-border mx-1" />
      <Button size="sm" variant="ghost" onClick={onCopy} disabled={!hasSelection} title="Ctrl+C">
        <Copy className="w-4 h-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onCut} disabled={!hasSelection} title="Ctrl+X">
        <Scissors className="w-4 h-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onPaste} disabled={!canPaste} title="Ctrl+V">
        <ClipboardPaste className="w-4 h-4" />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDelete}
        disabled={!hasSelection && atRoot}
        title={
          hasSelection
            ? t("admin.media.deleteSelected", { defaultValue: "Usuń zaznaczone" })
            : t("admin.media.deleteCurrentFolder", { defaultValue: "Usuń bieżący folder" })
        }
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="w-4 h-4" />
      </Button>
      <div className="h-6 w-px bg-border mx-1" />
      <Button
        size="sm"
        variant={viewMode === "grid" ? "default" : "ghost"}
        onClick={() => onSetViewMode("grid")}
      >
        <LayoutGrid className="w-4 h-4" />
      </Button>
      <Button
        size="sm"
        variant={viewMode === "list" ? "default" : "ghost"}
        onClick={() => onSetViewMode("list")}
      >
        <List className="w-4 h-4" />
      </Button>
      <Button size="sm" variant={infoOpen ? "default" : "ghost"} onClick={onToggleInfo}>
        <Info className="w-4 h-4" />
      </Button>
      <div className="relative ml-auto min-w-[200px]">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("admin.list.searchMedia", { defaultValue: "Szukaj plików…" })}
          className="pl-8 h-8 text-xs w-[240px]"
        />
      </div>
    </div>
  );
}
