/**
 * Action layer for the media manager: every server mutation, plus the
 * clipboard and the undo/redo history, behind one cohesive controller hook.
 *
 * All writes go through the `*.functions.ts` server functions, which resolve
 * the tenant from the authenticated profile and enforce RLS - the client never
 * asserts a tenant on a write. `tenantId`/`userId` here are only used to shape
 * storage object keys (`<tenant>/<user>/...`), matching the storage RLS prefix.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toastError";
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
import type { ClipboardState, HistoryOp, MediaRow } from "../types";
import { normalizePath, parentOf } from "../lib/mediaPaths";

export interface UseMediaMutationsArgs {
  media: readonly MediaRow[];
  tenantId: string;
  userId: string | undefined;
  currentPath: string;
  setCurrentPath: (path: string) => void;
  invalidate: () => void;
  clearSelection: () => void;
}

export interface UseMediaMutationsResult {
  busy: boolean;
  clipboard: ClipboardState | null;
  copy: (ids: string[]) => void;
  cut: (ids: string[]) => void;
  clearClipboard: () => void;
  canPaste: boolean;
  canUndo: boolean;
  canRedo: boolean;
  uploadFiles: (files: File[], targetFolder: string) => Promise<void>;
  doMove: (ids: string[], target: string, recordHistory?: boolean) => Promise<void>;
  doRename: (id: string, newName: string, recordHistory?: boolean) => Promise<void>;
  doDelete: (ids: string[]) => Promise<void>;
  doPaste: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  doCreateFolder: (name: string) => Promise<boolean>;
  doRenameFolder: (oldPath: string, name: string) => Promise<boolean>;
  doDeleteFolder: (path: string, recursive: boolean) => Promise<void>;
  updateAlt: (id: string, altText: string) => Promise<void>;
}

export function useMediaMutations(args: UseMediaMutationsArgs): UseMediaMutationsResult {
  const { media, tenantId, userId, currentPath, setCurrentPath, invalidate, clearSelection } = args;
  const { t } = useTranslation();

  const registerUpload = useServerFn(registerMediaUpload);
  const bulkDelete = useServerFn(bulkDeleteMedia);
  const bulkMove = useServerFn(bulkMoveMedia);
  const duplicateFn = useServerFn(duplicateMedia);
  const updateMeta = useServerFn(updateMediaMeta);
  const createFolder = useServerFn(createMediaFolder);
  const renameFolder = useServerFn(renameMediaFolder);
  const deleteFolder = useServerFn(deleteMediaFolder);

  const [busy, setBusy] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  // Undo/redo stacks live in refs (no re-render on push); a version counter
  // bumps a render so `canUndo`/`canRedo` stay in sync with the buttons.
  const undoStackRef = useRef<HistoryOp[]>([]);
  const redoStackRef = useRef<HistoryOp[]>([]);
  const [, forceHistory] = useState(0);
  const bumpHistory = useCallback(() => forceHistory((n) => n + 1), []);
  const pushUndo = useCallback(
    (op: HistoryOp) => {
      undoStackRef.current.push(op);
      redoStackRef.current = [];
      bumpHistory();
    },
    [bumpHistory],
  );

  // ---------- Clipboard ----------
  const copy = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      setClipboard({ op: "copy", ids });
      toast.success(t("admin.media.copied", { defaultValue: "Skopiowano" }));
    },
    [t],
  );
  const cut = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      setClipboard({ op: "cut", ids });
      toast.success(t("admin.media.cut", { defaultValue: "Wycięto" }));
    },
    [t],
  );
  const clearClipboard = useCallback(() => setClipboard(null), []);

  // ---------- Upload ----------
  const uploadFiles = useCallback(
    async (files: File[], targetFolder: string) => {
      if (!userId || !files.length) return;
      setBusy(true);
      const folder = normalizePath(targetFolder);
      try {
        for (const file of files) {
          const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
          const path = `${tenantId}/${userId}/${Date.now()}-${Math.random()
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
        invalidate();
      } catch (err) {
        toastError(err, "upload");
      } finally {
        setBusy(false);
      }
    },
    [userId, tenantId, registerUpload, updateMeta, invalidate, t],
  );

  // ---------- File operations (with undo) ----------
  const doMove = useCallback(
    async (ids: string[], target: string, recordHistory = true) => {
      if (!ids.length) return;
      const before = new Map<string, string>();
      for (const m of media) if (ids.includes(m.id)) before.set(m.id, m.folder_path);
      try {
        await bulkMove({ data: { mediaIds: ids, folderPath: target } });
        if (recordHistory) {
          pushUndo({ kind: "move", ids, from: before, to: normalizePath(target) });
        }
        invalidate();
      } catch (err) {
        toastError(err, "save");
      }
    },
    [media, bulkMove, pushUndo, invalidate],
  );

  const doRename = useCallback(
    async (id: string, newName: string, recordHistory = true) => {
      const row = media.find((m) => m.id === id);
      if (!row) return;
      const from = row.filename;
      if (from === newName) return;
      try {
        await updateMeta({ data: { mediaId: id, filename: newName } });
        if (recordHistory) pushUndo({ kind: "rename", id, from, to: newName });
        invalidate();
      } catch (err) {
        toastError(err, "save");
      }
    },
    [media, updateMeta, pushUndo, invalidate],
  );

  const doDelete = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      try {
        await bulkDelete({ data: { mediaIds: ids } });
        toast.success(t("admin.deleted", { defaultValue: "Usunięto" }));
        clearSelection();
        invalidate();
      } catch (err) {
        toastError(err, "delete");
      }
    },
    [bulkDelete, clearSelection, invalidate, t],
  );

  const doPaste = useCallback(async () => {
    if (!clipboard || !clipboard.ids.length) return;
    if (clipboard.op === "copy") {
      try {
        await duplicateFn({ data: { mediaIds: clipboard.ids, folderPath: currentPath } });
        toast.success(t("admin.media.pasted", { defaultValue: "Wklejono" }));
        invalidate();
      } catch (err) {
        toastError(err, "save");
      }
    } else {
      await doMove(clipboard.ids, currentPath);
      setClipboard(null);
    }
  }, [clipboard, currentPath, duplicateFn, doMove, invalidate, t]);

  const undo = useCallback(async () => {
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
    invalidate();
  }, [bulkMove, updateMeta, bumpHistory, invalidate]);

  const redo = useCallback(async () => {
    const op = redoStackRef.current.pop();
    if (!op) return;
    if (op.kind === "move") {
      await bulkMove({ data: { mediaIds: op.ids, folderPath: op.to } });
    } else {
      await updateMeta({ data: { mediaId: op.id, filename: op.to } });
    }
    undoStackRef.current.push(op);
    bumpHistory();
    invalidate();
  }, [bulkMove, updateMeta, bumpHistory, invalidate]);

  // ---------- Folder operations ----------
  const doCreateFolder = useCallback(
    async (name: string): Promise<boolean> => {
      const raw = name.trim();
      if (!raw) return false;
      const path = normalizePath(currentPath + raw + "/");
      try {
        await createFolder({ data: { path } });
        toast.success(t("admin.media.folderCreated", { defaultValue: "Utworzono folder" }));
        invalidate();
        return true;
      } catch (err) {
        toastError(err, "save");
        return false;
      }
    },
    [currentPath, createFolder, invalidate, t],
  );

  const doRenameFolder = useCallback(
    async (oldPath: string, name: string): Promise<boolean> => {
      const raw = name.trim();
      if (!raw) return false;
      const newPath = normalizePath(parentOf(oldPath) + raw + "/");
      try {
        await renameFolder({ data: { oldPath, newPath } });
        toast.success(t("admin.media.folderRenamed", { defaultValue: "Zmieniono nazwę" }));
        if (currentPath.startsWith(oldPath)) {
          setCurrentPath(newPath + currentPath.slice(oldPath.length));
        }
        invalidate();
        return true;
      } catch (err) {
        toastError(err, "save");
        return false;
      }
    },
    [currentPath, setCurrentPath, renameFolder, invalidate, t],
  );

  const doDeleteFolder = useCallback(
    async (path: string, recursive: boolean) => {
      try {
        await deleteFolder({ data: { path, recursive } });
        if (currentPath.startsWith(path)) setCurrentPath(parentOf(path));
        invalidate();
      } catch (err) {
        toastError(err, "delete");
      }
    },
    [currentPath, setCurrentPath, deleteFolder, invalidate],
  );

  const updateAlt = useCallback(
    async (id: string, altText: string) => {
      try {
        await updateMeta({ data: { mediaId: id, altText } });
        invalidate();
      } catch (err) {
        toastError(err, "save");
      }
    },
    [updateMeta, invalidate],
  );

  return {
    busy,
    clipboard,
    copy,
    cut,
    clearClipboard,
    canPaste: !!clipboard,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    uploadFiles,
    doMove,
    doRename,
    doDelete,
    doPaste,
    undo,
    redo,
    doCreateFolder,
    doRenameFolder,
    doDeleteFolder,
    updateAlt,
  };
}
