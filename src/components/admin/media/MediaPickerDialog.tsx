/**
 * MediaPickerDialog - browse images stored in the tenant's Media Library
 * and pick one. Lightweight modal used by newsletter/page/post builders to
 * insert existing assets without leaving the current editor.
 * Supports uploading new files directly from the user's local disk.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-team-media";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useRequiredTenant } from "@/hooks/useAuth";
import {
  bulkDeleteMedia,
  bulkMoveMedia,
  createMediaFolder,
  registerMediaUpload,
  updateMediaMeta,
} from "@/lib/media.functions";
import { brandedMediaUrl, mediaRenderUrl } from "@/lib/media/publicUrl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search,
  Check,
  X,
  Folder,
  Upload,
  Loader2,
  Trash2,
  ChevronDown,
  FolderPlus,
} from "@/lib/lucide-shim";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { toastError } from "@/lib/toastError";
import {
  AUDIO_ACCEPT_ATTR,
  AUDIO_MIME,
  IMAGE_ACCEPT_ATTR,
  IMAGE_MIME,
  UPLOADABLE_MIME,
  UPLOAD_ACCEPT_ATTR,
  checkUploadable,
  uploadAndRegisterMedia,
} from "@/lib/media/upload";
import { useMediaSelection } from "@/components/admin/media/hooks/useMediaSelection";
import { normalizePath } from "@/components/admin/media/lib/mediaPaths";

const MEDIA_IDS_MIME = "application/x-media-ids";

interface PickerRow {
  id: string;
  public_url: string;
  filename: string;
  mime_type: string | null;
  folder_path: string;
  created_at: string;
  alt_text: string | null;
}

export function MediaPickerDialog({
  open,
  onOpenChange,
  onPick,
  accept = "image",
  title,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (url: string) => void;
  accept?: "image" | "audio" | "all";
  title?: string;
}) {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  const registerUpload = useServerFn(registerMediaUpload);
  const updateMeta = useServerFn(updateMediaMeta);
  const bulkDelete = useServerFn(bulkDeleteMedia);
  const bulkMove = useServerFn(bulkMoveMedia);
  const createFolder = useServerFn(createMediaFolder);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderQuery, setFolderQuery] = useState("");
  const [pickedUrl, setPickedUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [altDraft, setAltDraft] = useState("");
  const [filenameDraft, setFilenameDraft] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [moving, setMoving] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dragTargetFolder, setDragTargetFolder] = useState<string | null>(null);

  // Allowlista zamiast `image/*` / `audio/*`: wildcard obejmował także
  // `image/svg+xml`, więc UI zapraszał do wgrania typu, który serwer odrzuca -
  // a odrzucony plik zostawał w publicznym buckecie (patrz lib/media/upload.ts).
  const allowedMime = useMemo(
    () => (accept === "image" ? IMAGE_MIME : accept === "audio" ? AUDIO_MIME : UPLOADABLE_MIME),
    [accept],
  );
  const acceptAttr =
    accept === "image"
      ? IMAGE_ACCEPT_ATTR
      : accept === "audio"
        ? AUDIO_ACCEPT_ATTR
        : UPLOAD_ACCEPT_ATTR;

  const handleFiles = useCallback(
    async (files: FileList | File[], targetFolder = folder === "all" ? "/" : folder) => {
      const list = Array.from(files);
      if (!list.length) return;
      if (!user) {
        toast.error(t("adminTeamMedia.mediaPicker.errNotLoggedIn"));
        return;
      }
      setUploading(true);
      let lastUrl: string | null = null;
      try {
        for (const file of list) {
          if (checkUploadable(file, allowedMime)) {
            toast.error(
              accept === "audio"
                ? t("adminTeamMedia.mediaPicker.errSkippedAudio", { name: file.name })
                : t("adminTeamMedia.mediaPicker.errSkippedImage", { name: file.name }),
            );
            continue;
          }
          const uploaded = await uploadAndRegisterMedia({
            file,
            tenantId,
            userId: user.id,
            registerMedia: registerUpload,
            allowedMime,
          });
          const normalizedTarget = normalizePath(targetFolder);
          if (normalizedTarget !== "/") {
            await updateMeta({
              data: { mediaId: uploaded.mediaId, folderPath: normalizedTarget },
            });
          }
          lastUrl = uploaded.publicUrl;
        }
        toast.success(
          list.length > 1
            ? t("adminTeamMedia.mediaPicker.uploadedMany", { count: list.length })
            : t("adminTeamMedia.mediaPicker.uploadedOne"),
        );
        await qc.invalidateQueries({ queryKey: ["media-picker", tenantId, accept] });
        if (lastUrl) setPickedUrl(lastUrl);
      } catch (err) {
        toastError(err, "upload");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [accept, allowedMime, folder, qc, registerUpload, tenantId, updateMeta, user, t],
  );

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void handleFiles(e.target.files);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void handleFiles(e.dataTransfer.files);
  };

  const { data } = useQuery({
    queryKey: ["media-picker", tenantId, accept],
    enabled: open,
    queryFn: async (): Promise<PickerRow[]> => {
      let query = supabase
        .from("media")
        .select("id, public_url, filename, mime_type, folder_path, created_at, alt_text")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (accept === "image") query = query.like("mime_type", "image/%");
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        public_url: mediaRenderUrl(row.public_url),
      }));
    },
  });

  const { data: folderRows } = useQuery({
    queryKey: ["media-picker-folders", tenantId],
    enabled: open,
    queryFn: async (): Promise<Array<{ path: string }>> => {
      const { data, error } = await supabase
        .from("media_folders")
        .select("path")
        .eq("tenant_id", tenantId)
        .order("path");
      if (error) throw error;
      return data ?? [];
    },
  });

  const folders = useMemo(() => {
    const s = new Set<string>();
    s.add("/");
    for (const r of folderRows ?? []) s.add(r.path || "/");
    for (const r of data ?? []) s.add(r.folder_path || "/");
    return Array.from(s).sort();
  }, [data, folderRows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? []).filter((m) => {
      if (folder !== "all" && (m.folder_path || "/") !== folder) return false;
      if (needle && !m.filename.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [data, q, folder]);

  const filteredFolders = useMemo(() => {
    const needle = folderQuery.trim().toLocaleLowerCase();
    if (!needle) return folders;
    return folders.filter((path) => path.toLocaleLowerCase().includes(needle));
  }, [folderQuery, folders]);

  const { selectedIds, clearSelection, toggleSelect, selectAll, selectOnly } =
    useMediaSelection(filtered);

  const selectFolder = (nextFolder: string) => {
    setFolder(nextFolder);
    setFolderPickerOpen(false);
    setFolderQuery("");
  };

  const picked = useMemo(
    () => (data ?? []).find((m) => m.public_url === pickedUrl) ?? null,
    [data, pickedUrl],
  );
  const pickedIsImage = !!picked?.mime_type?.startsWith("image/");
  const altDirty = picked ? (picked.alt_text ?? "") !== altDraft : false;
  const filenameDirty = picked ? picked.filename !== filenameDraft.trim() : false;

  const handlePickRow = (row: PickerRow) => {
    setPickedUrl(row.public_url);
    setAltDraft(row.alt_text ?? "");
    setFilenameDraft(row.filename);
  };

  const selectMedia = (row: PickerRow, event?: ReactMouseEvent) => {
    toggleSelect(row.id, event);
    if (!event?.metaKey && !event?.ctrlKey && !event?.shiftKey) {
      handlePickRow(row);
      return;
    }
    setPickedUrl(null);
    setFilenameDraft("");
    setAltDraft("");
  };

  const clearMediaSelection = useCallback(() => {
    clearSelection();
    setPickedUrl(null);
    setFilenameDraft("");
    setAltDraft("");
  }, [clearSelection]);

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!window.confirm(t("adminTeamMedia.mediaPicker.deleteManyConfirm", { count: ids.length }))) {
      return;
    }
    setDeleting(true);
    try {
      await bulkDelete({ data: { mediaIds: ids } });
      clearMediaSelection();
      await qc.invalidateQueries({ queryKey: ["media-picker"] });
      toast.success(t("adminTeamMedia.mediaPicker.deletedMany", { count: ids.length }));
    } catch (err) {
      toastError(err, "delete");
    } finally {
      setDeleting(false);
    }
  }, [bulkDelete, clearMediaSelection, qc, selectedIds, t]);

  const moveSelectedToFolder = useCallback(
    async (targetFolder: string, ids = Array.from(selectedIds)) => {
      if (!ids.length) return;
      setMoving(true);
      try {
        await bulkMove({ data: { mediaIds: ids, folderPath: normalizePath(targetFolder) } });
        clearMediaSelection();
        await qc.invalidateQueries({ queryKey: ["media-picker"] });
        toast.success(t("adminTeamMedia.mediaPicker.movedMany", { count: ids.length }));
      } catch (err) {
        toastError(err, "save");
      } finally {
        setMoving(false);
        setDragTargetFolder(null);
      }
    },
    [bulkMove, clearMediaSelection, qc, selectedIds, t],
  );

  const onMediaDragStart = (id: string) => (event: DragEvent<HTMLButtonElement>) => {
    const ids = selectedIds.has(id) ? Array.from(selectedIds) : [id];
    if (!selectedIds.has(id)) selectOnly(id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(MEDIA_IDS_MIME, JSON.stringify(ids));
  };

  const onFolderDrop = (targetFolder: string) => (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragTargetFolder(null);
    const files = Array.from(event.dataTransfer.files);
    if (files.length) {
      void handleFiles(files, targetFolder);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(event.dataTransfer.getData(MEDIA_IDS_MIME));
      const ids = Array.isArray(parsed)
        ? parsed.filter((value): value is string => typeof value === "string")
        : [];
      void moveSelectedToFolder(targetFolder, ids);
    } catch {
      return;
    }
  };

  const createNewFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const base = folder === "all" ? "/" : folder;
    setCreatingFolder(true);
    try {
      await createFolder({ data: { path: normalizePath(`${base}${name}/`) } });
      setNewFolderName("");
      setNewFolderOpen(false);
      await qc.invalidateQueries({ queryKey: ["media-picker-folders"] });
      toast.success(t("adminTeamMedia.mediaPicker.folderCreated"));
    } catch (err) {
      toastError(err, "save");
    } finally {
      setCreatingFolder(false);
    }
  };

  useEffect(() => {
    if (!open || newFolderOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const element = event.target;
      if (
        element instanceof Element &&
        element.matches("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAll();
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.size) {
        event.preventDefault();
        void deleteSelected();
      } else if (event.key === "F2" && selectedIds.size === 1) {
        event.preventDefault();
        const selectedId = Array.from(selectedIds)[0];
        const row = filtered.find((item) => item.id === selectedId);
        if (row) handlePickRow(row);
        requestAnimationFrame(() => document.getElementById("picker-filename")?.focus());
      } else if (event.key === "Escape" && selectedIds.size) {
        event.preventDefault();
        clearMediaSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearMediaSelection, deleteSelected, filtered, newFolderOpen, open, selectAll, selectedIds]);

  const saveMeta = async () => {
    if (!picked) return;
    const filename = filenameDraft.trim();
    if (!filename) return;
    setSavingMeta(true);
    try {
      await updateMeta({
        data: {
          mediaId: picked.id,
          filename,
          ...(pickedIsImage ? { altText: altDraft.trim() } : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: ["media-picker"] });
      toast.success(t("adminTeamMedia.mediaPicker.savedMeta"));
    } catch (err) {
      toastError(err, "save");
    } finally {
      setSavingMeta(false);
    }
  };

  const removePicked = async () => {
    if (!picked) return;
    if (!window.confirm(t("adminTeamMedia.mediaPicker.deleteConfirm", { name: picked.filename }))) {
      return;
    }
    setDeleting(true);
    try {
      await bulkDelete({ data: { mediaIds: [picked.id] } });
      clearMediaSelection();
      await qc.invalidateQueries({ queryKey: ["media-picker"] });
      toast.success(t("adminTeamMedia.mediaPicker.deleted"));
    } catch (err) {
      toastError(err, "delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-24px)] max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-24px)] w-[calc(100vw-16px)] max-w-4xl flex-col gap-3 overflow-hidden p-4 sm:h-[calc(100dvh-48px)] sm:max-h-[calc(100dvh-48px)] sm:w-[calc(100vw-32px)] sm:p-5">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{title ?? t("adminTeamMedia.mediaPicker.title")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("adminTeamMedia.mediaPicker.title")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px] focus-within:[&_.mp-icon]:text-primary focus-within:[&_.mp-divider]:bg-primary/40">
            <Search
              className="mp-icon pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70 transition-colors"
              aria-hidden
            />
            <span
              aria-hidden
              className="mp-divider pointer-events-none absolute left-[26px] top-1/2 -translate-y-1/2 h-3.5 w-px bg-border transition-colors"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("adminTeamMedia.mediaPicker.searchPlaceholder")}
              className="pl-8 h-8 text-xs placeholder:text-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          <Popover
            open={folderPickerOpen}
            onOpenChange={(nextOpen) => {
              setFolderPickerOpen(nextOpen);
              if (!nextOpen) setFolderQuery("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={folderPickerOpen}
                aria-label={t("adminTeamMedia.mediaPicker.folderFilter")}
                className="h-8 min-w-[190px] max-w-[260px] justify-between gap-2 rounded-[6px] border-border/70 bg-background/80 px-2.5 text-xs font-medium shadow-sm backdrop-blur-md hover:border-primary/40 hover:bg-muted/60 focus-visible:ring-primary/30"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Folder className="size-3.5 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">
                    {folder === "all" ? t("adminTeamMedia.mediaPicker.allFolders") : folder}
                  </span>
                </span>
                <ChevronDown
                  className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${folderPickerOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={6}
              className="w-[min(320px,calc(100vw-32px))] overflow-hidden rounded-[6px] border-border/70 bg-popover/95 p-0 shadow-xl backdrop-blur-xl"
            >
              <div className="border-b border-border/70 bg-muted/30 p-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    type="search"
                    inputMode="search"
                    name="media-folder-filter"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    data-1p-ignore="true"
                    data-lpignore="true"
                    value={folderQuery}
                    onChange={(event) => setFolderQuery(event.target.value)}
                    placeholder={t("adminTeamMedia.mediaPicker.folderSearchPlaceholder")}
                    className="h-8 rounded-[6px] border-border/70 bg-background/70 pl-8 pr-2 text-xs placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-primary/30"
                  />
                </div>
              </div>
              <div
                role="listbox"
                aria-label={t("adminTeamMedia.mediaPicker.folderFilter")}
                className="max-h-72 space-y-0.5 overflow-y-auto p-1.5"
              >
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setNewFolderOpen(true)}
                  className="h-8 w-full justify-start gap-2 rounded-[6px] px-2.5 text-xs text-primary"
                >
                  <FolderPlus className="size-3.5" aria-hidden />
                  {t("adminTeamMedia.mediaPicker.createFolder")}
                </Button>
                {!folderQuery.trim() && (
                  <Button
                    type="button"
                    variant="ghost"
                    role="option"
                    aria-selected={folder === "all"}
                    onClick={() => selectFolder("all")}
                    className={`h-8 w-full justify-start gap-2 rounded-[6px] px-2.5 text-xs ${
                      folder === "all"
                        ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Folder className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{t("adminTeamMedia.mediaPicker.allFolders")}</span>
                    {folder === "all" && (
                      <Check className="ml-auto size-3.5 shrink-0" aria-hidden />
                    )}
                  </Button>
                )}
                {filteredFolders.map((path) => {
                  const selected = folder === path;
                  return (
                    <Button
                      key={path}
                      type="button"
                      variant="ghost"
                      role="option"
                      aria-selected={selected}
                      title={path}
                      onClick={() => selectFolder(path)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setDragTargetFolder(path);
                      }}
                      onDragLeave={() => setDragTargetFolder(null)}
                      onDrop={onFolderDrop(path)}
                      className={`h-8 w-full justify-start gap-2 rounded-[6px] px-2.5 text-xs ${
                        dragTargetFolder === path
                          ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                          : selected
                            ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                    >
                      <Folder className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{path}</span>
                      {selected && <Check className="ml-auto size-3.5 shrink-0" aria-hidden />}
                    </Button>
                  );
                })}
                {folderQuery.trim() && filteredFolders.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {t("adminTeamMedia.mediaPicker.noFolders")}
                  </p>
                )}
              </div>
              <div className="border-t border-border/70 bg-muted/20 px-3 py-2 text-[10px] font-semibold uppercase text-muted-foreground">
                {t("adminTeamMedia.mediaPicker.folderCount", { count: folders.length })}
              </div>
            </PopoverContent>
          </Popover>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptAttr}
            className="hidden"
            onChange={onInputChange}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />{" "}
                {t("adminTeamMedia.mediaPicker.uploading")}
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5 mr-1" />{" "}
                {t("adminTeamMedia.mediaPicker.uploadFromDisk")}
              </>
            )}
          </Button>
        </div>

        {newFolderOpen && (
          <div className="flex items-center gap-2 rounded-[6px] border border-border bg-muted/30 p-2">
            <FolderPlus className="size-4 shrink-0 text-primary" aria-hidden />
            <Input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createNewFolder();
                if (event.key === "Escape") setNewFolderOpen(false);
              }}
              placeholder={t("adminTeamMedia.mediaPicker.folderNamePlaceholder")}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              disabled={!newFolderName.trim() || creatingFolder}
              onClick={() => void createNewFolder()}
            >
              {creatingFolder ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              {t("adminTeamMedia.mediaPicker.create")}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("adminTeamMedia.mediaPicker.cancel")}
              onClick={() => setNewFolderOpen(false)}
              className="size-8"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-primary/25 bg-primary/5 px-3 py-2">
            <span className="mr-auto text-xs font-semibold text-foreground">
              {t("adminTeamMedia.mediaPicker.selectedCount", { count: selectedIds.size })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deleting || moving}
              onClick={() => void deleteSelected()}
            >
              {deleting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {t("adminTeamMedia.mediaPicker.deleteSelected")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearMediaSelection}>
              <X className="size-3.5" />
              {t("adminTeamMedia.mediaPicker.clearSelection")}
            </Button>
          </div>
        )}

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!e.dataTransfer || e.dataTransfer.types.includes("Files")) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative min-h-0 max-h-full overflow-y-auto overscroll-contain -mx-2 px-2 pb-[max(8px,env(safe-area-inset-bottom))] rounded-md transition-colors ${
            dragOver ? "outline outline-2 outline-dashed outline-primary/60 bg-primary/5" : ""
          }`}
        >
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-sm font-medium text-primary bg-background/70 backdrop-blur-sm rounded-md">
              <Upload className="w-4 h-4 mr-2" /> {t("adminTeamMedia.mediaPicker.dropToUpload")}
            </div>
          )}
          {!filtered.length ? (
            <div className="text-center text-muted-foreground text-sm py-10">
              {uploading
                ? t("adminTeamMedia.mediaPicker.uploadingInProgress")
                : t("adminTeamMedia.mediaPicker.noMatch")}
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {filtered.map((m) => {
                const selected = selectedIds.has(m.id);
                const isImg = m.mime_type?.startsWith("image/");
                return (
                  <Button
                    key={m.id}
                    type="button"
                    variant="ghost"
                    draggable
                    aria-pressed={selected}
                    aria-label={m.filename}
                    onDragStart={onMediaDragStart(m.id)}
                    onClick={(event) => selectMedia(m, event)}
                    onDoubleClick={() => {
                      onPick(brandedMediaUrl(m.public_url));
                      onOpenChange(false);
                    }}
                    className={`relative h-auto aspect-square rounded-[6px] border overflow-hidden p-0 text-left transition-colors ${
                      selected
                        ? "border-brand ring-2 ring-brand/40"
                        : "border-border hover:border-brand/50"
                    }`}
                    title={`${m.filename}\n${m.folder_path}`}
                  >
                    {isImg ? (
                      <img
                        src={mediaRenderUrl(m.public_url)}
                        alt={m.filename}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted flex items-center justify-center text-2xl">
                        📄
                      </div>
                    )}
                    {selected && (
                      <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-brand text-primary-foreground flex items-center justify-center shadow">
                        <Check className="w-3 h-3" />
                      </span>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 text-[10px] text-white flex items-center gap-1">
                      {m.folder_path && m.folder_path !== "/" && (
                        <Folder className="w-2.5 h-2.5 shrink-0" />
                      )}
                      <span className="truncate">{m.filename}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          )}
        </div>

        {picked && (
          <div className="max-h-[30dvh] overflow-y-auto border-t border-border pt-3 space-y-2">
            <label
              htmlFor="picker-filename"
              className="block text-xs text-muted-foreground font-medium"
            >
              {t("adminTeamMedia.mediaPicker.filenameLabel")}
            </label>
            <Input
              id="picker-filename"
              value={filenameDraft}
              onChange={(e) => setFilenameDraft(e.target.value.slice(0, 255))}
              maxLength={255}
              className="h-8 text-xs"
            />
            {pickedIsImage && (
              <>
                <label
                  htmlFor="picker-alt"
                  className="block text-xs text-muted-foreground font-medium"
                >
                  {t("adminTeamMedia.mediaPicker.altLabel")}
                </label>
                <div className="flex items-start gap-2">
                  <textarea
                    id="picker-alt"
                    value={altDraft}
                    onChange={(e) => setAltDraft(e.target.value.slice(0, 500))}
                    rows={2}
                    placeholder={t("adminTeamMedia.mediaPicker.altPlaceholder")}
                    className="flex-1 rounded border border-border bg-background px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-brand"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">{altDraft.length}/500</div>
              </>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={deleting || savingMeta}
                onClick={() => void removePicked()}
              >
                {deleting ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                )}
                {deleting
                  ? t("adminTeamMedia.mediaPicker.deleting")
                  : t("adminTeamMedia.mediaPicker.deleteBtn")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={
                  (!filenameDirty && !altDirty) || !filenameDraft.trim() || savingMeta || deleting
                }
                onClick={() => void saveMeta()}
              >
                {savingMeta
                  ? t("adminTeamMedia.mediaPicker.savingMeta")
                  : t("adminTeamMedia.mediaPicker.saveMetaBtn")}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="shrink-0 pb-[env(safe-area-inset-bottom)]">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="w-3.5 h-3.5 mr-1" /> {t("common.cancel")}
          </Button>
          <Button
            disabled={!pickedUrl}
            onClick={() => {
              if (pickedUrl) {
                onPick(brandedMediaUrl(pickedUrl));
                onOpenChange(false);
              }
            }}
          >
            <Check className="w-3.5 h-3.5 mr-1" /> {t("adminTeamMedia.mediaPicker.insertBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
