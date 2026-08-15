import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Check, Trash2 } from "@/lib/lucide-shim";
import type { ConfirmDeleteState } from "../types";

interface MediaDialogsProps {
  // New folder
  newFolderOpen: boolean;
  newFolderName: string;
  onNewFolderNameChange: (v: string) => void;
  onNewFolderClose: () => void;
  onCreateFolder: () => void;

  // Rename folder
  renamingFolder: string | null;
  renamingFolderDraft: string;
  onRenamingFolderDraftChange: (v: string) => void;
  onRenamingFolderClose: () => void;
  onRenameFolder: () => void;

  // Confirm delete
  confirmDelete: ConfirmDeleteState | null;
  onConfirmDeleteClose: () => void;
  onConfirmDelete: () => void;
}

/**
 * Molecule: the three modal dialogs (create folder, rename folder, confirm
 * delete). Bundled so the orchestrator stays declarative and free of dialog
 * markup.
 */
export function MediaDialogs({
  newFolderOpen,
  newFolderName,
  onNewFolderNameChange,
  onNewFolderClose,
  onCreateFolder,
  renamingFolder,
  renamingFolderDraft,
  onRenamingFolderDraftChange,
  onRenamingFolderClose,
  onRenameFolder,
  confirmDelete,
  onConfirmDeleteClose,
  onConfirmDelete,
}: MediaDialogsProps) {
  const { t } = useTranslation();
  const deleteCount = confirmDelete?.kind === "files" ? confirmDelete.ids.length : 0;

  return (
    <>
      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={(o) => !o && onNewFolderClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.media.newFolder")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => onNewFolderNameChange(e.target.value)}
            placeholder={t("admin.media.folderName")}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreateFolder();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={onNewFolderClose}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={onCreateFolder}>
              <Check className="w-4 h-4 mr-1" />
              {t("admin.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog open={!!renamingFolder} onOpenChange={(o) => !o && onRenamingFolderClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.media.renameFolder")}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renamingFolderDraft}
            onChange={(e) => onRenamingFolderDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameFolder();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={onRenamingFolderClose}>
              {t("admin.cancel")}
            </Button>
            <Button onClick={onRenameFolder}>{t("admin.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && onConfirmDeleteClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.confirmDelete")}</DialogTitle>
          </DialogHeader>
          {confirmDelete?.kind === "files" && (
            <p className="text-sm text-muted-foreground">
              {t("admin.media.confirmDeleteFiles", {
                count: deleteCount,
              })}
            </p>
          )}
          {confirmDelete?.kind === "folder" && (
            <p className="text-sm text-muted-foreground">{t("admin.media.confirmDeleteFolder")}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onConfirmDeleteClose}>
              {t("admin.cancel")}
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              {t("admin.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
