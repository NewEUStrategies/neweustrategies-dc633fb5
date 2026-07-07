/**
 * iOS Files-style media manager for /admin/media.
 *
 * Feature set:
 * - Folders & subfolders (virtual, tenant-scoped, `media_folders` table).
 * - Multi-select: click / Cmd|Ctrl+click (toggle) / Shift+click (range) / marquee drag.
 * - Right-click context menu on files, folders and empty canvas.
 * - Keyboard: Del, F2, Ctrl+A, Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+Z, Ctrl+Shift+Z.
 * - Drag & drop:
 *     - files from the OS on to the canvas or a folder -> upload
 *     - selected items on to a folder (sidebar / breadcrumb / grid) -> move
 * - Rename (inline via F2 or context menu; folder rename via dialog).
 * - Info panel (file & image metadata: dimensions, size, mime, dates).
 * - Undo/Redo stack for move & rename operations.
 * - Grid and list layouts.
 * - Copy/Paste (Ctrl+C then Ctrl+V) duplicates files server-side (storage copy).
 * - Cut/Paste (Ctrl+X then Ctrl+V) moves selection to the current folder.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Upload,
  Trash2,
  Copy,
  Scissors,
  ClipboardPaste,
  Pencil,
  Info,
  LayoutGrid,
  List,
  Undo,
  Redo,
  Search,
  X,
  ChevronRight,
  Home,
  MoreVertical,
  Download,
  Check,
} from "@/lib/lucide-shim";
import { toast } from "sonner";
import {
  registerMediaUpload,
  bulkDeleteMedia,
  bulkMoveMedia,
  duplicateMedia,
  updateMediaMeta,
  createMediaFolder,
  renameMediaFolder,
  deleteMediaFolder,
} from "@/lib/media.functions";

// ---------- Types ----------
export interface MediaRow {
  id: string;
  storage_path: string;
  public_url: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploader_id: string | null;
  created_at: string;
  folder_path: string;
  alt_text: string | null;
}

interface FolderRow {
  id: string;
  path: string;
  created_at: string;
}

type ViewMode = "grid" | "list";

interface ContextMenuState {
  x: number;
  y: number;
  target: "file" | "folder" | "empty";
  targetId?: string;
}

interface ClipboardState {
  op: "copy" | "cut";
  ids: string[];
}

type HistoryOp =
  | { kind: "move"; ids: string[]; from: Map<string, string>; to: string }
  | { kind: "rename"; id: string; from: string; to: string };

// ---------- Utilities ----------
function normalizePath(p: string): string {
  let s = p.trim();
  if (!s.startsWith("/")) s = "/" + s;
  if (!s.endsWith("/")) s = s + "/";
  return s.replace(/\/+/g, "/");
}

function parentOf(p: string): string {
  const n = normalizePath(p);
  if (n === "/") return "/";
  const parts = n.slice(1, -1).split("/");
  parts.pop();
  return parts.length ? "/" + parts.join("/") + "/" : "/";
}

function folderName(p: string): string {
  const n = normalizePath(p);
  if (n === "/") return "/";
  const parts = n.slice(1, -1).split("/");
  return parts[parts.length - 1] ?? "/";
}

function formatBytes(n: number | null | undefined): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v = v / 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toUpperCase() : "";
}

// ---------- Component ----------
export function MediaManager() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const tenantId = useRequiredTenant();

  const registerUpload = useServerFn(registerMediaUpload);
  const bulkDelete = useServerFn(bulkDeleteMedia);
  const bulkMove = useServerFn(bulkMoveMedia);
  const duplicateFn = useServerFn(duplicateMedia);
  const updateMeta = useServerFn(updateMediaMeta);
  const createFolder = useServerFn(createMediaFolder);
  const renameFolder = useServerFn(renameMediaFolder);
  const deleteFolder = useServerFn(deleteMediaFolder);

  // ---------- State ----------
  const [currentPath, setCurrentPath] = useState<string>("/");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastAnchorId, setLastAnchorId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: "files" | "folder";
    ids?: string[];
    folder?: string;
  } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renamingFolderDraft, setRenamingFolderDraft] = useState("");
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const undoStackRef = useRef<HistoryOp[]>([]);
  const redoStackRef = useRef<HistoryOp[]>([]);
  const [, forceHistory] = useState(0);
  const bumpHistory = () => forceHistory((n) => n + 1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);

  // ---------- Queries ----------
  const foldersQ = useQuery({
    queryKey: ["media-folders", tenantId],
    queryFn: async (): Promise<FolderRow[]> => {
      const { data, error } = await supabase
        .from("media_folders")
        .select("id, path, created_at")
        .eq("tenant_id", tenantId)
        .order("path");
      if (error) throw error;
      return data ?? [];
    },
  });

  const mediaQ = useQuery({
    queryKey: ["media", tenantId],
    queryFn: async (): Promise<MediaRow[]> => {
      const { data, error } = await supabase
        .from("media")
        .select(
          "id, storage_path, public_url, filename, mime_type, size_bytes, uploader_id, created_at, folder_path, alt_text",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["media"] });
    qc.invalidateQueries({ queryKey: ["media-folders"] });
  };

  // ---------- Derived data ----------
  const currentFolderChildren = useMemo(() => {
    const set = new Set<string>();
    for (const f of foldersQ.data ?? []) {
      if (f.path.startsWith(currentPath) && f.path !== currentPath) {
        const rest = f.path.slice(currentPath.length);
        const seg = rest.split("/")[0];
        if (seg) set.add(currentPath + seg + "/");
      }
    }
    // Also include folders derived from media items (safety net).
    for (const m of mediaQ.data ?? []) {
      if (m.folder_path.startsWith(currentPath) && m.folder_path !== currentPath) {
        const rest = m.folder_path.slice(currentPath.length);
        const seg = rest.split("/")[0];
        if (seg) set.add(currentPath + seg + "/");
      }
    }
    return Array.from(set).sort();
  }, [foldersQ.data, mediaQ.data, currentPath]);

  const filesInCurrent = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (mediaQ.data ?? [])
      .filter((m) => m.folder_path === currentPath)
      .filter((m) => (q ? m.filename.toLowerCase().includes(q) : true));
  }, [mediaQ.data, currentPath, search]);

  const selectedRows = useMemo(
    () => (mediaQ.data ?? []).filter((m) => selectedIds.has(m.id)),
    [mediaQ.data, selectedIds],
  );

  // ---------- Selection ----------
  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastAnchorId(null);
  };
  const toggleSelect = (id: string, ev?: ReactMouseEvent) => {
    const meta = ev?.metaKey || ev?.ctrlKey;
    const shift = ev?.shiftKey;
    if (shift && lastAnchorId) {
      const ids = filesInCurrent.map((f) => f.id);
      const a = ids.indexOf(lastAnchorId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = new Set(selectedIds);
        for (let i = lo; i <= hi; i++) range.add(ids[i]!);
        setSelectedIds(range);
        return;
      }
    }
    if (meta) {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
      setLastAnchorId(id);
      return;
    }
    setSelectedIds(new Set([id]));
    setLastAnchorId(id);
  };

  // ---------- Upload ----------
  const uploadFiles = useCallback(
    async (files: File[], targetFolder: string) => {
      if (!user || !files.length) return;
      setBusy(true);
      const folder = normalizePath(targetFolder);
      try {
        for (const file of files) {
          const ext = (file.name.split(".").pop() ?? "bin")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          const path = `${tenantId}/${user.id}/${Date.now()}-${Math.random()
            .toString(36)
            .slice(2)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("media")
            .upload(path, file, { contentType: file.type });
          if (upErr) throw upErr;
          const { data: urlData } = supabase.storage.from("media").getPublicUrl(path);
          const res = await registerUpload({
            data: {
              storagePath: path,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              publicUrl: urlData.publicUrl,
            },
          });
          if (folder !== "/") {
            await updateMeta({ data: { mediaId: res.id, folderPath: folder } });
          }
        }
        toast.success(t("admin.media.uploaded", { defaultValue: "Wgrano pliki" }));
        invalidateAll();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, tenantId, registerUpload, updateMeta, t],
  );

  const onFilesPicked = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    void uploadFiles(Array.from(e.target.files), currentPath);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // ---------- Operations (with undo) ----------
  const pushUndo = (op: HistoryOp) => {
    undoStackRef.current.push(op);
    redoStackRef.current = [];
    bumpHistory();
  };

  const doMove = async (ids: string[], target: string, recordHistory = true) => {
    if (!ids.length) return;
    const before = new Map<string, string>();
    for (const m of mediaQ.data ?? []) if (ids.includes(m.id)) before.set(m.id, m.folder_path);
    try {
      await bulkMove({ data: { mediaIds: ids, folderPath: target } });
      if (recordHistory) pushUndo({ kind: "move", ids, from: before, to: normalizePath(target) });
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doRename = async (id: string, newName: string, recordHistory = true) => {
    const row = (mediaQ.data ?? []).find((m) => m.id === id);
    if (!row) return;
    const from = row.filename;
    if (from === newName) return;
    try {
      await updateMeta({ data: { mediaId: id, filename: newName } });
      if (recordHistory) pushUndo({ kind: "rename", id, from, to: newName });
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doDelete = async (ids: string[]) => {
    if (!ids.length) return;
    try {
      await bulkDelete({ data: { mediaIds: ids } });
      toast.success(t("admin.deleted", { defaultValue: "Usunięto" }));
      clearSelection();
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doPaste = async () => {
    if (!clipboard || !clipboard.ids.length) return;
    if (clipboard.op === "copy") {
      try {
        await duplicateFn({ data: { mediaIds: clipboard.ids, folderPath: currentPath } });
        toast.success(t("admin.media.pasted", { defaultValue: "Wklejono" }));
        invalidateAll();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    } else {
      await doMove(clipboard.ids, currentPath);
      setClipboard(null);
    }
  };

  const undo = async () => {
    const op = undoStackRef.current.pop();
    if (!op) return;
    if (op.kind === "move") {
      // Undo grouped by original folder.
      const groups = new Map<string, string[]>();
      for (const id of op.ids) {
        const from = op.from.get(id) ?? "/";
        groups.set(from, [...(groups.get(from) ?? []), id]);
      }
      for (const [folder, ids] of groups) {
        await bulkMove({ data: { mediaIds: ids, folderPath: folder } });
      }
    } else {
      await updateMeta({ data: { mediaId: op.id, filename: op.from } });
    }
    redoStackRef.current.push(op);
    bumpHistory();
    invalidateAll();
  };

  const redo = async () => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    if (op.kind === "move") {
      await bulkMove({ data: { mediaIds: op.ids, folderPath: op.to } });
    } else {
      await updateMeta({ data: { mediaId: op.id, filename: op.to } });
    }
    undoStackRef.current.push(op);
    bumpHistory();
    invalidateAll();
  };

  // ---------- Folder ops ----------
  const doCreateFolder = async () => {
    const raw = newFolderName.trim();
    if (!raw) return;
    const path = normalizePath(currentPath + raw + "/");
    try {
      await createFolder({ data: { path } });
      toast.success(t("admin.media.folderCreated", { defaultValue: "Utworzono folder" }));
      setNewFolderOpen(false);
      setNewFolderName("");
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doRenameFolder = async () => {
    if (!renamingFolder) return;
    const raw = renamingFolderDraft.trim();
    if (!raw) return;
    const newPath = normalizePath(parentOf(renamingFolder) + raw + "/");
    try {
      await renameFolder({ data: { oldPath: renamingFolder, newPath } });
      toast.success(t("admin.media.folderRenamed", { defaultValue: "Zmieniono nazwę" }));
      if (currentPath.startsWith(renamingFolder)) {
        setCurrentPath(newPath + currentPath.slice(renamingFolder.length));
      }
      setRenamingFolder(null);
      setRenamingFolderDraft("");
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const doDeleteFolder = async (path: string, recursive: boolean) => {
    try {
      await deleteFolder({ data: { path, recursive } });
      if (currentPath.startsWith(path)) setCurrentPath(parentOf(path));
      invalidateAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedIds(new Set(filesInCurrent.map((f) => f.id)));
        return;
      }
      if (meta && e.key.toLowerCase() === "c" && selectedIds.size) {
        e.preventDefault();
        setClipboard({ op: "copy", ids: Array.from(selectedIds) });
        toast.success(t("admin.media.copied", { defaultValue: "Skopiowano" }));
        return;
      }
      if (meta && e.key.toLowerCase() === "x" && selectedIds.size) {
        e.preventDefault();
        setClipboard({ op: "cut", ids: Array.from(selectedIds) });
        toast.success(t("admin.media.cut", { defaultValue: "Wycięto" }));
        return;
      }
      if (meta && e.key.toLowerCase() === "v" && clipboard) {
        e.preventDefault();
        void doPaste();
        return;
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void redo();
        return;
      }
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        void redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size) {
        e.preventDefault();
        setConfirmDelete({ kind: "files", ids: Array.from(selectedIds) });
        return;
      }
      if (e.key === "F2" && selectedIds.size === 1) {
        e.preventDefault();
        const id = Array.from(selectedIds)[0]!;
        const row = (mediaQ.data ?? []).find((m) => m.id === id);
        if (row) {
          setRenamingId(id);
          setRenameDraft(row.filename);
        }
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesInCurrent, selectedIds, clipboard, currentPath, mediaQ.data]);

  // Close context menu on outside click.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // ---------- Marquee (rectangle drag selection) ----------
  const onCanvasPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-media-item]")) return;
    if ((e.target as HTMLElement).closest("[data-nomarquee]")) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    marqueeStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setMarquee({ x: marqueeStartRef.current.x, y: marqueeStartRef.current.y, w: 0, h: 0 });
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) clearSelection();
  };
  const onCanvasPointerMove = (e: ReactPointerEvent) => {
    if (!marqueeStartRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const x = Math.min(cx, marqueeStartRef.current.x);
    const y = Math.min(cy, marqueeStartRef.current.y);
    const w = Math.abs(cx - marqueeStartRef.current.x);
    const h = Math.abs(cy - marqueeStartRef.current.y);
    setMarquee({ x, y, w, h });
    // Intersect with items.
    const items = canvasRef.current.querySelectorAll<HTMLElement>("[data-media-item]");
    const next = new Set<string>();
    for (const el of Array.from(items)) {
      const r = el.getBoundingClientRect();
      const ix = r.left - rect.left;
      const iy = r.top - rect.top;
      if (ix < x + w && ix + r.width > x && iy < y + h && iy + r.height > y) {
        const id = el.getAttribute("data-media-item");
        if (id) next.add(id);
      }
    }
    setSelectedIds(next);
  };
  const onCanvasPointerUp = () => {
    marqueeStartRef.current = null;
    setMarquee(null);
  };

  // ---------- Drag & drop ----------
  const onCanvasDragOver = (e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setDragOver(true);
    }
  };
  const onCanvasDrop = (e: DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      void uploadFiles(files, currentPath);
    }
  };
  const onFolderDrop = (path: string) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (files.length) {
      void uploadFiles(files, path);
      return;
    }
    const idsRaw = e.dataTransfer.getData("application/x-media-ids");
    if (idsRaw) {
      try {
        const ids = JSON.parse(idsRaw) as string[];
        if (ids.length) void doMove(ids, path);
      } catch {
        /* noop */
      }
    }
  };
  const onItemDragStart = (id: string) => (e: DragEvent) => {
    const ids = selectedIds.has(id) ? Array.from(selectedIds) : [id];
    if (!selectedIds.has(id)) setSelectedIds(new Set([id]));
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-media-ids", JSON.stringify(ids));
  };

  // ---------- Context menu ----------
  const openContext = (
    e: ReactMouseEvent,
    target: ContextMenuState["target"],
    id?: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (target === "file" && id && !selectedIds.has(id)) {
      setSelectedIds(new Set([id]));
      setLastAnchorId(id);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, target, targetId: id });
  };

  // ---------- Breadcrumbs ----------
  const crumbs = useMemo(() => {
    const parts = currentPath.slice(1, -1).split("/").filter(Boolean);
    const out: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
    let acc = "/";
    for (const p of parts) {
      acc = acc + p + "/";
      out.push({ label: p, path: acc });
    }
    return out;
  }, [currentPath]);

  // ---------- Info panel data ----------
  const infoTarget = selectedRows.length === 1 ? selectedRows[0] : null;
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setImgSize(null);
    if (infoTarget?.mime_type?.startsWith("image/") && infoTarget.public_url) {
      const img = new window.Image();
      img.onload = () => setImgSize({ w: img.naturalWidth, h: img.naturalHeight });
      img.src = infoTarget.public_url;
    }
  }, [infoTarget?.id, infoTarget?.mime_type, infoTarget?.public_url]);

  // ---------- Render ----------
  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] min-h-[500px]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap" data-nomarquee>
        <h1 className="font-display text-xl font-bold mr-2">
          {t("admin.nav.media", { defaultValue: "Media" })}
        </h1>
        <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={busy}>
          <Upload className="w-4 h-4 mr-1.5" />
          {busy ? "…" : t("admin.media.upload", { defaultValue: "Wgraj" })}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={onFilesPicked}
        />
        <Button size="sm" variant="outline" onClick={() => setNewFolderOpen(true)}>
          <FolderPlus className="w-4 h-4 mr-1.5" />
          {t("admin.media.newFolder", { defaultValue: "Nowy folder" })}
        </Button>
        <div className="h-6 w-px bg-border mx-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void undo()}
          disabled={!undoStackRef.current.length}
          title="Ctrl+Z"
        >
          <Undo className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void redo()}
          disabled={!redoStackRef.current.length}
          title="Ctrl+Shift+Z"
        >
          <Redo className="w-4 h-4" />
        </Button>
        <div className="h-6 w-px bg-border mx-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!selectedIds.size) return;
            setClipboard({ op: "copy", ids: Array.from(selectedIds) });
            toast.success(t("admin.media.copied", { defaultValue: "Skopiowano" }));
          }}
          disabled={!selectedIds.size}
          title="Ctrl+C"
        >
          <Copy className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!selectedIds.size) return;
            setClipboard({ op: "cut", ids: Array.from(selectedIds) });
            toast.success(t("admin.media.cut", { defaultValue: "Wycięto" }));
          }}
          disabled={!selectedIds.size}
          title="Ctrl+X"
        >
          <Scissors className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void doPaste()}
          disabled={!clipboard}
          title="Ctrl+V"
        >
          <ClipboardPaste className="w-4 h-4" />
        </Button>
        <div className="h-6 w-px bg-border mx-1" />
        <Button
          size="sm"
          variant={viewMode === "grid" ? "default" : "ghost"}
          onClick={() => setViewMode("grid")}
        >
          <LayoutGrid className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant={viewMode === "list" ? "default" : "ghost"}
          onClick={() => setViewMode("list")}
        >
          <List className="w-4 h-4" />
        </Button>
        <Button
          size="sm"
          variant={infoOpen ? "default" : "ghost"}
          onClick={() => setInfoOpen((o) => !o)}
        >
          <Info className="w-4 h-4" />
        </Button>
        <div className="relative ml-auto min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("admin.list.searchMedia", { defaultValue: "Szukaj plików…" })}
            className="pl-7 h-8 text-xs w-[240px]"
          />
        </div>
      </div>

      {/* Body: sidebar + main + info */}
      <div className="flex-1 flex gap-3 min-h-0">
        {/* Sidebar folder tree */}
        <aside
          className="w-56 shrink-0 border border-border rounded-lg bg-card overflow-y-auto"
          data-nomarquee
        >
          <FolderTree
            folders={foldersQ.data ?? []}
            currentPath={currentPath}
            onSelect={(p) => setCurrentPath(p)}
            onRename={(p) => {
              setRenamingFolder(p);
              setRenamingFolderDraft(folderName(p));
            }}
            onDelete={(p) => setConfirmDelete({ kind: "folder", folder: p })}
            onDropFolder={onFolderDrop}
          />
        </aside>

        {/* Main */}
        <section
          className="flex-1 min-w-0 flex flex-col border border-border rounded-lg bg-card overflow-hidden"
          onDragOver={onCanvasDragOver}
          onDragLeave={() => setDragOver(false)}
          onDrop={onCanvasDrop}
        >
          {/* Breadcrumbs */}
          <div
            className="flex items-center gap-1 px-3 py-2 border-b border-border text-xs flex-wrap"
            data-nomarquee
          >
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1">
                {i === 0 ? <Home className="w-3.5 h-3.5" /> : null}
                <button
                  type="button"
                  onClick={() => setCurrentPath(c.path)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onFolderDrop(c.path)}
                  className={`px-1 rounded hover:bg-muted ${
                    c.path === currentPath ? "font-semibold" : ""
                  }`}
                >
                  {c.label}
                </button>
                {i < crumbs.length - 1 && (
                  <ChevronRight className="w-3 h-3 text-muted-foreground" />
                )}
              </span>
            ))}
            <span className="ml-auto text-muted-foreground">
              {selectedIds.size
                ? t("admin.media.selectedCount", {
                    count: selectedIds.size,
                    defaultValue: `Zaznaczono: ${selectedIds.size}`,
                  })
                : `${filesInCurrent.length + currentFolderChildren.length} ${t("admin.media.items", {
                    defaultValue: "elementów",
                  })}`}
            </span>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className={`relative flex-1 overflow-auto p-3 ${
              dragOver ? "bg-brand/5 outline-2 outline-dashed outline-brand" : ""
            }`}
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest("[data-media-item]")) return;
              if ((e.target as HTMLElement).closest("[data-folder-item]")) return;
              openContext(e, "empty");
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
          >
            {viewMode === "grid" ? (
              <GridView
                folders={currentFolderChildren}
                files={filesInCurrent}
                selectedIds={selectedIds}
                renamingId={renamingId}
                renameDraft={renameDraft}
                onRenameDraft={setRenameDraft}
                onRenameCommit={(id) => {
                  void doRename(id, renameDraft.trim() || renameDraft);
                  setRenamingId(null);
                }}
                onRenameCancel={() => setRenamingId(null)}
                onOpenFolder={(p) => {
                  setCurrentPath(p);
                  clearSelection();
                }}
                onSelect={toggleSelect}
                onContextFile={(e, id) => openContext(e, "file", id)}
                onContextFolder={(e, id) => openContext(e, "folder", id)}
                onDragStart={onItemDragStart}
                onDropFolder={onFolderDrop}
              />
            ) : (
              <ListView
                folders={currentFolderChildren}
                files={filesInCurrent}
                selectedIds={selectedIds}
                onOpenFolder={(p) => {
                  setCurrentPath(p);
                  clearSelection();
                }}
                onSelect={toggleSelect}
                onContextFile={(e, id) => openContext(e, "file", id)}
                onContextFolder={(e, id) => openContext(e, "folder", id)}
                onDragStart={onItemDragStart}
                onDropFolder={onFolderDrop}
              />
            )}

            {!filesInCurrent.length && !currentFolderChildren.length && (
              <div className="flex flex-col items-center justify-center text-muted-foreground text-sm py-16">
                <Upload className="w-6 h-6 mb-2" />
                {t("admin.media.dropHere", {
                  defaultValue: "Przeciągnij pliki tutaj lub kliknij „Wgraj”",
                })}
              </div>
            )}

            {marquee && (
              <div
                className="absolute pointer-events-none bg-brand/10 border border-brand/60 rounded-sm"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
          </div>
        </section>

        {/* Info panel */}
        {infoOpen && (
          <aside
            className="w-72 shrink-0 border border-border rounded-lg bg-card overflow-y-auto p-4 text-xs"
            data-nomarquee
          >
            <InfoPanel target={infoTarget} imgSize={imgSize} />
          </aside>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={(o) => !o && setNewFolderOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.media.newFolder", { defaultValue: "Nowy folder" })}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder={t("admin.media.folderName", { defaultValue: "Nazwa folderu" })}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doCreateFolder();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>
              {t("admin.cancel", { defaultValue: "Anuluj" })}
            </Button>
            <Button onClick={() => void doCreateFolder()}>
              <Check className="w-4 h-4 mr-1" />
              {t("admin.create", { defaultValue: "Utwórz" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog open={!!renamingFolder} onOpenChange={(o) => !o && setRenamingFolder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.media.renameFolder", { defaultValue: "Zmień nazwę folderu" })}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renamingFolderDraft}
            onChange={(e) => setRenamingFolderDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doRenameFolder();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenamingFolder(null)}>
              {t("admin.cancel", { defaultValue: "Anuluj" })}
            </Button>
            <Button onClick={() => void doRenameFolder()}>
              {t("admin.save", { defaultValue: "Zapisz" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.confirmDelete", { defaultValue: "Potwierdź usunięcie" })}
            </DialogTitle>
          </DialogHeader>
          {confirmDelete?.kind === "files" && (
            <p className="text-sm text-muted-foreground">
              {t("admin.media.confirmDeleteFiles", {
                count: confirmDelete.ids?.length ?? 0,
                defaultValue: `Usunąć ${confirmDelete.ids?.length ?? 0} plik(ów)? Operacji nie można cofnąć.`,
              })}
            </p>
          )}
          {confirmDelete?.kind === "folder" && (
            <p className="text-sm text-muted-foreground">
              {t("admin.media.confirmDeleteFolder", {
                defaultValue:
                  "Usunąć folder wraz z jego zawartością (pliki i podfoldery)? Tej operacji nie można cofnąć.",
              })}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              {t("admin.cancel", { defaultValue: "Anuluj" })}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDelete?.kind === "files" && confirmDelete.ids) {
                  void doDelete(confirmDelete.ids);
                } else if (confirmDelete?.kind === "folder" && confirmDelete.folder) {
                  void doDeleteFolder(confirmDelete.folder, true);
                }
                setConfirmDelete(null);
              }}
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {t("admin.delete", { defaultValue: "Usuń" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  // ---------- Context menu builder ----------
  function contextMenuItems(cm: ContextMenuState): ContextItem[] {
    if (cm.target === "file") {
      const id = cm.targetId!;
      const row = (mediaQ.data ?? []).find((m) => m.id === id);
      const many = selectedIds.size > 1 && selectedIds.has(id);
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
          onSelect: () => {
            if (!row) return;
            setRenamingId(id);
            setRenameDraft(row.filename);
          },
        },
        {
          label: t("admin.media.getInfo", { defaultValue: "Informacje" }),
          icon: <Info className="w-3.5 h-3.5" />,
          onSelect: () => {
            setSelectedIds(new Set([id]));
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
          onSelect: () => {
            const ids = many ? Array.from(selectedIds) : [id];
            setClipboard({ op: "copy", ids });
          },
        },
        {
          label: t("admin.media.cut", { defaultValue: "Wytnij" }),
          icon: <Scissors className="w-3.5 h-3.5" />,
          shortcut: "⌘X",
          onSelect: () => {
            const ids = many ? Array.from(selectedIds) : [id];
            setClipboard({ op: "cut", ids });
          },
        },
        { separator: true },
        {
          label: t("admin.delete", { defaultValue: "Usuń" }),
          icon: <Trash2 className="w-3.5 h-3.5" />,
          danger: true,
          onSelect: () => {
            const ids = many ? Array.from(selectedIds) : [id];
            setConfirmDelete({ kind: "files", ids });
          },
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
    // Empty
    return [
      {
        label: t("admin.media.newFolder", { defaultValue: "Nowy folder" }),
        icon: <FolderPlus className="w-3.5 h-3.5" />,
        onSelect: () => setNewFolderOpen(true),
      },
      {
        label: t("admin.media.upload", { defaultValue: "Wgraj pliki" }),
        icon: <Upload className="w-3.5 h-3.5" />,
        onSelect: () => fileInputRef.current?.click(),
      },
      { separator: true },
      {
        label: t("admin.media.paste", { defaultValue: "Wklej" }),
        icon: <ClipboardPaste className="w-3.5 h-3.5" />,
        shortcut: "⌘V",
        disabled: !clipboard,
        onSelect: () => void doPaste(),
      },
      {
        label: t("admin.media.selectAll", { defaultValue: "Zaznacz wszystko" }),
        shortcut: "⌘A",
        onSelect: () => setSelectedIds(new Set(filesInCurrent.map((f) => f.id))),
      },
    ];
  }
}

// ---------- Subcomponents ----------

interface ContextItem {
  label?: string;
  icon?: React.ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextItem[];
  onClose: () => void;
}) {
  // Clamp to viewport
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - items.length * 32 - 8),
  };
  return (
    <div
      className="fixed z-[100] min-w-[200px] bg-popover text-popover-foreground border border-border rounded-md shadow-lg py-1 text-xs"
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it, i) => {
        if (it.separator) return <div key={i} className="h-px bg-border my-1" />;
        return (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              it.onSelect?.();
              onClose();
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed ${
              it.danger ? "text-destructive" : ""
            }`}
          >
            {it.icon ?? <span className="w-3.5 h-3.5" />}
            <span className="flex-1">{it.label}</span>
            {it.shortcut && (
              <span className="text-muted-foreground text-[10px]">{it.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FolderTree({
  folders,
  currentPath,
  onSelect,
  onRename,
  onDelete,
  onDropFolder,
}: {
  folders: FolderRow[];
  currentPath: string;
  onSelect: (p: string) => void;
  onRename: (p: string) => void;
  onDelete: (p: string) => void;
  onDropFolder: (p: string) => (e: DragEvent) => void;
}) {
  const paths = useMemo(() => {
    const all = new Set<string>(["/"]);
    for (const f of folders) all.add(f.path);
    return Array.from(all).sort();
  }, [folders]);

  return (
    <div className="p-2 text-xs">
      {paths.map((p) => {
        const depth = p === "/" ? 0 : p.slice(1, -1).split("/").length;
        const active = p === currentPath;
        const label = p === "/" ? "Root" : folderName(p);
        return (
          <div
            key={p}
            className={`flex items-center gap-1 rounded px-1.5 py-1 cursor-pointer hover:bg-muted group ${
              active ? "bg-muted font-semibold" : ""
            }`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => onSelect(p)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDropFolder(p)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (p !== "/") {
                // No native menu here; delegated actions:
              }
            }}
          >
            {active ? (
              <FolderOpen className="w-3.5 h-3.5 text-brand" />
            ) : (
              <Folder className="w-3.5 h-3.5 text-muted-foreground" />
            )}
            <span className="truncate flex-1">{label}</span>
            {p !== "/" && (
              <span className="hidden group-hover:flex items-center gap-0.5">
                <button
                  type="button"
                  className="p-0.5 hover:text-brand"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(p);
                  }}
                  aria-label="Rename"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  className="p-0.5 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p);
                  }}
                  aria-label="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GridView({
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
}: {
  folders: string[];
  files: MediaRow[];
  selectedIds: Set<string>;
  renamingId: string | null;
  renameDraft: string;
  onRenameDraft: (v: string) => void;
  onRenameCommit: (id: string) => void;
  onRenameCancel: () => void;
  onOpenFolder: (p: string) => void;
  onSelect: (id: string, ev?: ReactMouseEvent) => void;
  onContextFile: (e: ReactMouseEvent, id: string) => void;
  onContextFolder: (e: ReactMouseEvent, id: string) => void;
  onDragStart: (id: string) => (e: DragEvent) => void;
  onDropFolder: (p: string) => (e: DragEvent) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
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
          className="flex flex-col items-center gap-1 p-2 rounded-md border border-transparent hover:bg-muted/50 hover:border-border"
        >
          <Folder className="w-12 h-12 text-brand" />
          <span className="text-[11px] truncate w-full text-center" title={folderName(p)}>
            {folderName(p)}
          </span>
        </button>
      ))}
      {files.map((m) => {
        const selected = selectedIds.has(m.id);
        const isImage = m.mime_type?.startsWith("image/");
        return (
          <div
            key={m.id}
            data-media-item={m.id}
            draggable
            onDragStart={onDragStart(m.id)}
            onClick={(e) => onSelect(m.id, e)}
            onContextMenu={(e) => onContextFile(e, m.id)}
            onDoubleClick={() => {
              if (m.public_url) window.open(m.public_url, "_blank");
            }}
            className={`group relative rounded-md border overflow-hidden cursor-pointer transition-colors ${
              selected
                ? "border-brand ring-2 ring-brand/40 bg-brand/5"
                : "border-border hover:border-brand/50"
            }`}
          >
            <div className="aspect-square bg-muted/30 flex items-center justify-center">
              {isImage ? (
                <img
                  src={m.public_url}
                  alt={m.alt_text || m.filename}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  draggable={false}
                />
              ) : (
                <div className="flex flex-col items-center text-muted-foreground gap-1">
                  <span className="text-2xl">📄</span>
                  <span className="text-[10px]">{extOf(m.filename)}</span>
                </div>
              )}
              {selected && (
                <span className="absolute top-1 left-1 w-4 h-4 rounded-full bg-brand text-primary-foreground flex items-center justify-center">
                  <Check className="w-3 h-3" />
                </span>
              )}
            </div>
            <div className="p-1.5 text-[10px]">
              {renamingId === m.id ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => onRenameDraft(e.target.value)}
                  onBlur={() => onRenameCommit(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onRenameCommit(m.id);
                    if (e.key === "Escape") onRenameCancel();
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full bg-background border border-border rounded px-1 py-0.5 text-[10px]"
                />
              ) : (
                <div className="truncate font-medium" title={m.filename}>
                  {m.filename}
                </div>
              )}
              <div className="text-muted-foreground flex justify-between">
                <span>{formatBytes(m.size_bytes)}</span>
                <span>{extOf(m.filename)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  folders,
  files,
  selectedIds,
  onOpenFolder,
  onSelect,
  onContextFile,
  onContextFolder,
  onDragStart,
  onDropFolder,
}: {
  folders: string[];
  files: MediaRow[];
  selectedIds: Set<string>;
  onOpenFolder: (p: string) => void;
  onSelect: (id: string, ev?: ReactMouseEvent) => void;
  onContextFile: (e: ReactMouseEvent, id: string) => void;
  onContextFolder: (e: ReactMouseEvent, id: string) => void;
  onDragStart: (id: string) => (e: DragEvent) => void;
  onDropFolder: (p: string) => (e: DragEvent) => void;
}) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2 font-medium">Nazwa</th>
            <th className="text-left px-3 py-2 font-medium">Typ</th>
            <th className="text-right px-3 py-2 font-medium">Rozmiar</th>
            <th className="text-left px-3 py-2 font-medium">Data</th>
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
              <td className="px-3 py-1.5 text-muted-foreground">Folder</td>
              <td className="px-3 py-1.5 text-right text-muted-foreground">—</td>
              <td className="px-3 py-1.5 text-muted-foreground">—</td>
            </tr>
          ))}
          {files.map((m) => {
            const selected = selectedIds.has(m.id);
            return (
              <tr
                key={m.id}
                data-media-item={m.id}
                draggable
                onDragStart={onDragStart(m.id)}
                onClick={(e) => onSelect(m.id, e)}
                onContextMenu={(e) => onContextFile(e, m.id)}
                className={`border-t border-border cursor-pointer ${
                  selected ? "bg-brand/10" : "hover:bg-muted/40"
                }`}
              >
                <td className="px-3 py-1.5 flex items-center gap-2 truncate">
                  {m.mime_type?.startsWith("image/") ? (
                    <img
                      src={m.public_url}
                      alt=""
                      className="w-6 h-6 rounded object-cover"
                      draggable={false}
                    />
                  ) : (
                    <span className="w-6 h-6 rounded bg-muted flex items-center justify-center text-[9px]">
                      {extOf(m.filename) || "?"}
                    </span>
                  )}
                  <span className="truncate">{m.filename}</span>
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {m.mime_type ?? extOf(m.filename)}
                </td>
                <td className="px-3 py-1.5 text-right text-muted-foreground">
                  {formatBytes(m.size_bytes)}
                </td>
                <td className="px-3 py-1.5 text-muted-foreground">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InfoPanel({
  target,
  imgSize,
}: {
  target: MediaRow | null;
  imgSize: { w: number; h: number } | null;
}) {
  if (!target) {
    return (
      <p className="text-muted-foreground">
        Zaznacz jeden plik, aby zobaczyć szczegóły.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {target.mime_type?.startsWith("image/") ? (
        <img
          src={target.public_url}
          alt={target.alt_text || target.filename}
          className="w-full rounded border border-border object-contain max-h-56 bg-muted/20"
        />
      ) : (
        <div className="w-full aspect-video rounded bg-muted flex items-center justify-center text-3xl">
          📄
        </div>
      )}
      <div className="space-y-1">
        <div className="font-semibold truncate" title={target.filename}>
          {target.filename}
        </div>
        <Row label="Typ" value={target.mime_type ?? "-"} />
        <Row label="Rozmiar" value={formatBytes(target.size_bytes)} />
        {imgSize && <Row label="Wymiary" value={`${imgSize.w} × ${imgSize.h} px`} />}
        <Row label="Folder" value={target.folder_path} />
        <Row
          label="Utworzono"
          value={new Date(target.created_at).toLocaleString()}
        />
        <Row label="ID" value={target.id} mono />
      </div>
      <div className="pt-2 border-t border-border space-y-1">
        <a
          href={target.public_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-brand hover:underline"
        >
          Otwórz w nowej karcie <MoreVertical className="w-3 h-3 rotate-90" />
        </a>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`text-right truncate max-w-[65%] ${mono ? "font-mono text-[10px]" : ""}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

// avoid unused warnings for the imported keyboard type
export type _KeyboardEvent = ReactKeyboardEvent;
