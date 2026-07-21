/**
 * iOS Files-style media manager for /admin/media.
 *
 * This is the orchestrator: it owns navigation/UI state and composes the
 * atomic-design layers - pure lib helpers, logic hooks (data / selection /
 * mutations / marquee / keyboard / drag&drop) and the atoms/molecules/organisms
 * that render them. All data access is tenant-scoped (see hooks/useMediaData),
 * so one workspace can never read another workspace's assets.
 *
 * Feature set:
 * - Folders & subfolders (virtual, tenant-scoped, `media_folders` table).
 * - Multi-select: click / Cmd|Ctrl+click (toggle) / Shift+click (range) / marquee drag.
 * - Right-click context menu on files, folders and empty canvas.
 * - Keyboard: Del, F2, Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Z, Ctrl+Shift+Z.
 * - Drag & drop: OS files -> upload; selected items onto a folder -> move.
 * - Rename, info panel, undo/redo, grid & list layouts, copy/cut/paste.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-media";
import { toast } from "sonner";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  Pencil,
  Info,
  Copy,
  Scissors,
  Download,
  Trash2,
  FolderPlus,
  Upload,
  ClipboardPaste,
} from "@/lib/lucide-shim";
import type {
  ConfirmDeleteState,
  ContextMenuItem,
  ContextMenuState,
  MediaRow,
  ViewMode,
} from "./types";
import { directChildFolders, folderName } from "./lib/mediaPaths";
import { useMediaData } from "./hooks/useMediaData";
import { useMediaSelection } from "./hooks/useMediaSelection";
import { useMediaMutations } from "./hooks/useMediaMutations";
import { useMarqueeSelection } from "./hooks/useMarqueeSelection";
import { useMediaDragDrop } from "./hooks/useMediaDragDrop";
import { useMediaKeyboardShortcuts } from "./hooks/useMediaKeyboardShortcuts";
import { useImageNaturalSize } from "./hooks/useImageNaturalSize";
import { MediaToolbar } from "./molecules/MediaToolbar";
import { MediaBreadcrumbs } from "./molecules/MediaBreadcrumbs";
import { MediaContextMenu } from "./molecules/MediaContextMenu";
import { MediaDialogs } from "./molecules/MediaDialogs";
import { MediaEmptyState } from "./atoms/MediaEmptyState";
import { MarqueeBox } from "./atoms/MarqueeBox";
import { MediaFolderTree } from "./organisms/MediaFolderTree";
import { MediaGridView } from "./organisms/MediaGridView";
import { MediaListView } from "./organisms/MediaListView";
import { MediaInfoPanel } from "./organisms/MediaInfoPanel";
import { MediaPreviewDialog } from "./organisms/MediaPreviewDialog";

export type { MediaRow } from "./types";

export function MediaManager() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const tenantId = useRequiredTenant();

  // ---------- Navigation / UI state ----------
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<MediaRow | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingFolderDraft, setRenamingFolderDraft] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // ---------- Tenant-scoped data ----------
  const { foldersQuery, mediaQuery, invalidate } = useMediaData(tenantId);
  const media = useMemo(() => mediaQuery.data ?? [], [mediaQuery.data]);

  // ---------- Derived views ----------
  const currentFolderChildren = useMemo(
    () =>
      directChildFolders(
        currentPath,
        (foldersQuery.data ?? []).map((f) => f.path),
        media.map((m) => m.folder_path),
      ),
    [foldersQuery.data, media, currentPath],
  );

  const filesInCurrent = useMemo(() => {
    const q = search.trim().toLowerCase();
    return media
      .filter((m) => m.folder_path === currentPath)
      .filter((m) => (q ? m.filename.toLowerCase().includes(q) : true));
  }, [media, currentPath, search]);

  // ---------- Selection ----------
  const selection = useMediaSelection(filesInCurrent);
  const { selectedIds, setSelectedIds, clearSelection, toggleSelect, selectAll, selectOnly } =
    selection;

  const selectedRows = useMemo(
    () => media.filter((m) => selectedIds.has(m.id)),
    [media, selectedIds],
  );
  const infoTarget = selectedRows.length === 1 ? selectedRows[0] : null;
  const imgSize = useImageNaturalSize(infoTarget);

  // ---------- Mutations (server ops + clipboard + undo/redo) ----------
  const mutations = useMediaMutations({
    media,
    tenantId,
    userId: user?.id,
    currentPath,
    setCurrentPath,
    invalidate,
    clearSelection,
  });

  // ---------- Interaction hooks ----------
  const marquee = useMarqueeSelection({ canvasRef, selectedIds, setSelectedIds, clearSelection });
  const dnd = useMediaDragDrop({
    currentPath,
    selectedIds,
    setSelectedIds,
    uploadFiles: mutations.uploadFiles,
    doMove: mutations.doMove,
  });

  const beginRename = (id: string) => {
    const row = media.find((m) => m.id === id);
    if (row) {
      setRenamingId(id);
      setRenameDraft(row.filename);
    }
  };

  useMediaKeyboardShortcuts({
    hasSelection: selectedIds.size > 0,
    singleSelectionId: selectedIds.size === 1 ? (Array.from(selectedIds)[0] ?? null) : null,
    canPaste: mutations.canPaste,
    selectAll,
    copySelection: () => mutations.copy(Array.from(selectedIds)),
    cutSelection: () => mutations.cut(Array.from(selectedIds)),
    paste: () => void mutations.doPaste(),
    undo: () => void mutations.undo(),
    redo: () => void mutations.redo(),
    requestDeleteSelection: () => setConfirmDelete({ kind: "files", ids: Array.from(selectedIds) }),
    beginRename,
    closeContextMenu: () => setContextMenu(null),
    clearSelection,
  });

  // Close the context menu on any outside click.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // ---------- Handlers ----------
  const openContext = (e: ReactMouseEvent, target: ContextMenuState["target"], id?: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (target === "file" && id && !selectedIds.has(id)) selectOnly(id);
    setContextMenu({ x: e.clientX, y: e.clientY, target, targetId: id });
  };

  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    void mutations.uploadFiles(Array.from(e.target.files), currentPath);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const openFolder = (path: string) => {
    setCurrentPath(path);
    clearSelection();
  };

  const requestToolbarDelete = () => {
    if (selectedIds.size) {
      setConfirmDelete({ kind: "files", ids: Array.from(selectedIds) });
    } else if (currentPath !== "/") {
      setConfirmDelete({ kind: "folder", folder: currentPath });
    }
  };

  const commitConfirmDelete = () => {
    if (confirmDelete?.kind === "files") void mutations.doDelete(confirmDelete.ids);
    else if (confirmDelete?.kind === "folder")
      void mutations.doDeleteFolder(confirmDelete.folder, true);
    setConfirmDelete(null);
  };

  const commitCreateFolder = () => {
    void mutations.doCreateFolder(newFolderName).then((ok) => {
      if (ok) {
        setNewFolderOpen(false);
        setNewFolderName("");
      }
    });
  };

  const commitRenameFolder = () => {
    if (!renamingFolder) return;
    void mutations.doRenameFolder(renamingFolder, renamingFolderDraft).then((ok) => {
      if (ok) {
        setRenamingFolder(null);
        setRenamingFolderDraft("");
      }
    });
  };

  // ---------- Render ----------
  const isEmpty = !filesInCurrent.length && !currentFolderChildren.length;

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] min-h-[500px]">
      <MediaToolbar
        busy={mutations.busy}
        viewMode={viewMode}
        infoOpen={infoOpen}
        search={search}
        hasSelection={selectedIds.size > 0}
        canPaste={mutations.canPaste}
        canUndo={mutations.canUndo}
        canRedo={mutations.canRedo}
        atRoot={currentPath === "/"}
        onUpload={() => fileInputRef.current?.click()}
        onNewFolder={() => setNewFolderOpen(true)}
        onUndo={() => void mutations.undo()}
        onRedo={() => void mutations.redo()}
        onCopy={() => mutations.copy(Array.from(selectedIds))}
        onCut={() => mutations.cut(Array.from(selectedIds))}
        onPaste={() => void mutations.doPaste()}
        onDelete={requestToolbarDelete}
        onSetViewMode={setViewMode}
        onToggleInfo={() => setInfoOpen((o) => !o)}
        onSearch={setSearch}
      />
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFilesPicked} />

      {/* Body: sidebar + main + info */}
      <div className="flex-1 flex gap-3 min-h-0">
        <aside
          className="w-56 shrink-0 border border-border rounded-lg bg-card overflow-y-auto"
          data-nomarquee
        >
          <MediaFolderTree
            folders={foldersQuery.data ?? []}
            currentPath={currentPath}
            onSelect={setCurrentPath}
            onRename={(p) => {
              setRenamingFolder(p);
              setRenamingFolderDraft(folderName(p));
            }}
            onDelete={(p) => setConfirmDelete({ kind: "folder", folder: p })}
            onDropFolder={dnd.onFolderDrop}
          />
        </aside>

        <section
          className="flex-1 min-w-0 flex flex-col border border-border rounded-lg bg-card overflow-hidden"
          onDragOver={dnd.onCanvasDragOver}
          onDragLeave={dnd.onCanvasDragLeave}
          onDrop={dnd.onCanvasDrop}
        >
          <MediaBreadcrumbs
            currentPath={currentPath}
            onNavigate={setCurrentPath}
            onFolderDrop={dnd.onFolderDrop}
            selectedCount={selectedIds.size}
            itemCount={filesInCurrent.length + currentFolderChildren.length}
          />

          <div
            ref={canvasRef}
            className={cn(
              "relative flex-1 overflow-auto p-3",
              dnd.dragOver && "bg-brand/5 outline-2 outline-dashed outline-brand",
            )}
            onContextMenu={(e) => {
              const el = e.target as HTMLElement;
              if (el.closest("[data-media-item]")) return;
              if (el.closest("[data-folder-item]")) return;
              openContext(e, "empty");
            }}
            onPointerDown={marquee.onCanvasPointerDown}
            onPointerMove={marquee.onCanvasPointerMove}
            onPointerUp={marquee.onCanvasPointerUp}
          >
            {viewMode === "grid" ? (
              <MediaGridView
                folders={currentFolderChildren}
                files={filesInCurrent}
                selectedIds={selectedIds}
                renamingId={renamingId}
                renameDraft={renameDraft}
                onRenameDraft={setRenameDraft}
                onRenameCommit={(id) => {
                  void mutations.doRename(id, renameDraft.trim() || renameDraft);
                  setRenamingId(null);
                }}
                onRenameCancel={() => setRenamingId(null)}
                onOpenFolder={openFolder}
                onSelect={toggleSelect}
                onContextFile={(e, id) => openContext(e, "file", id)}
                onContextFolder={(e, id) => openContext(e, "folder", id)}
                onDragStart={dnd.onItemDragStart}
                onDropFolder={dnd.onFolderDrop}
                onPreviewFile={setPreviewFile}
              />
            ) : (
              <MediaListView
                folders={currentFolderChildren}
                files={filesInCurrent}
                selectedIds={selectedIds}
                onOpenFolder={openFolder}
                onSelect={toggleSelect}
                onContextFile={(e, id) => openContext(e, "file", id)}
                onContextFolder={(e, id) => openContext(e, "folder", id)}
                onDragStart={dnd.onItemDragStart}
                onDropFolder={dnd.onFolderDrop}
                onPreviewFile={setPreviewFile}
              />
            )}

            {isEmpty && <MediaEmptyState />}
            {marquee.marquee && <MarqueeBox rect={marquee.marquee} />}
          </div>
        </section>

        {infoOpen && (
          <aside
            className="w-72 shrink-0 border border-border rounded-lg bg-card overflow-y-auto p-4 text-xs"
            data-nomarquee
          >
            <MediaInfoPanel target={infoTarget} imgSize={imgSize} onSaveAlt={mutations.updateAlt} />
          </aside>
        )}
      </div>

      {contextMenu && (
        <MediaContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildContextMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}

      <MediaDialogs
        newFolderOpen={newFolderOpen}
        newFolderName={newFolderName}
        onNewFolderNameChange={setNewFolderName}
        onNewFolderClose={() => setNewFolderOpen(false)}
        onCreateFolder={commitCreateFolder}
        renamingFolder={renamingFolder}
        renamingFolderDraft={renamingFolderDraft}
        onRenamingFolderDraftChange={setRenamingFolderDraft}
        onRenamingFolderClose={() => setRenamingFolder(null)}
        onRenameFolder={commitRenameFolder}
        confirmDelete={confirmDelete}
        onConfirmDeleteClose={() => setConfirmDelete(null)}
        onConfirmDelete={commitConfirmDelete}
      />

      <MediaPreviewDialog file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );

  // ---------- Context menu builder ----------
  function buildContextMenuItems(cm: ContextMenuState): ContextMenuItem[] {
    if (cm.target === "file" && cm.targetId) {
      const id = cm.targetId;
      const row = media.find((m) => m.id === id);
      const many = selectedIds.size > 1 && selectedIds.has(id);
      const idsForBatch = many ? Array.from(selectedIds) : [id];
      return [
        {
          label: t("admin.media.open", { defaultValue: "Otwórz" }),
          onSelect: () => {
            if (row) window.open(row.public_url, "_blank");
          },
        },
        {
          label: t("admin.media.rename", { defaultValue: "Zmień nazwę" }),
          icon: <Pencil className="w-3.5 h-3.5" />,
          disabled: many,
          onSelect: () => beginRename(id),
        },
        {
          label: t("admin.media.getInfo", { defaultValue: "Informacje" }),
          icon: <Info className="w-3.5 h-3.5" />,
          onSelect: () => {
            selectOnly(id);
            setInfoOpen(true);
          },
        },
        { separator: true },
        {
          label: t("admin.media.copyUrl", { defaultValue: "Skopiuj URL" }),
          icon: <Copy className="w-3.5 h-3.5" />,
          onSelect: () => {
            if (row) {
              void navigator.clipboard.writeText(row.public_url);
              toast.success(t("admin.media.urlCopied", { defaultValue: "URL skopiowany" }));
            }
          },
        },
        {
          label: t("admin.media.download", { defaultValue: "Pobierz" }),
          icon: <Download className="w-3.5 h-3.5" />,
          onSelect: () => {
            if (row) {
              const a = document.createElement("a");
              a.href = row.public_url;
              a.download = row.filename;
              a.click();
            }
          },
        },
        { separator: true },
        {
          label: t("admin.media.copy", { defaultValue: "Kopiuj" }),
          shortcut: "⌘C",
          onSelect: () => mutations.copy(idsForBatch),
        },
        {
          label: t("admin.media.cutAction", { defaultValue: "Wytnij" }),
          icon: <Scissors className="w-3.5 h-3.5" />,
          shortcut: "⌘X",
          onSelect: () => mutations.cut(idsForBatch),
        },
        { separator: true },
        {
          label: t("admin.delete", { defaultValue: "Usuń" }),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          onSelect: () => setConfirmDelete({ kind: "files", ids: idsForBatch }),
        },
      ];
    }

    if (cm.target === "folder" && cm.targetId) {
      const path = cm.targetId;
      return [
        {
          label: t("admin.media.open", { defaultValue: "Otwórz" }),
          onSelect: () => setCurrentPath(path),
        },
        {
          label: t("admin.media.rename", { defaultValue: "Zmień nazwę" }),
          icon: <Pencil className="w-3.5 h-3.5" />,
          onSelect: () => {
            setRenamingFolder(path);
            setRenamingFolderDraft(folderName(path));
          },
        },
        { separator: true },
        {
          label: t("admin.delete", { defaultValue: "Usuń" }),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          onSelect: () => setConfirmDelete({ kind: "folder", folder: path }),
        },
      ];
    }

    // Empty canvas
    return [
      {
        label: t("admin.media.newFolder", { defaultValue: "Nowy folder" }),
        icon: <FolderPlus className="w-3.5 h-3.5" />,
        onSelect: () => setNewFolderOpen(true),
      },
      {
        label: t("admin.media.uploadFiles", { defaultValue: "Wgraj pliki" }),
        icon: <Upload className="w-3.5 h-3.5" />,
        onSelect: () => fileInputRef.current?.click(),
      },
      { separator: true },
      {
        label: t("admin.media.paste", { defaultValue: "Wklej" }),
        icon: <ClipboardPaste className="w-3.5 h-3.5" />,
        shortcut: "⌘V",
        disabled: !mutations.canPaste,
        onSelect: () => void mutations.doPaste(),
      },
      {
        label: t("admin.media.selectAll", { defaultValue: "Zaznacz wszystko" }),
        shortcut: "⌘A",
        onSelect: selectAll,
      },
    ];
  }
}
