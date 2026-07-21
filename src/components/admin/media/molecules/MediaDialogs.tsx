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
            <DialogTitle>{t("admin.media.newFolder", { defaultValue: "Nowy folder" })}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderName}
            onChange={(e) => onNewFolderNameChange(e.target.value)}
            placeholder={t("admin.media.folderName", { defaultValue: "Nazwa folderu" })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreateFolder();
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={onNewFolderClose}>
              {t("admin.cancel", { defaultValue: "Anuluj" })}
            </Button>
            <Button onClick={onCreateFolder}>
              <Check className="w-4 h-4 mr-1" />
              {t("admin.create", { defaultValue: "Utwórz" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog open={!!renamingFolder} onOpenChange={(o) => !o && onRenamingFolderClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.media.renameFolder", { defaultValue: "Zmień nazwę folderu" })}
            </DialogTitle>
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
              {t("admin.cancel", { defaultValue: "Anuluj" })}
            </Button>
            <Button onClick={onRenameFolder}>{t("admin.save", { defaultValue: "Zapisz" })}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && onConfirmDeleteClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.confirmDelete", { defaultValue: "Potwierdź usunięcie" })}
            </DialogTitle>
          </DialogHeader>
          {confirmDelete?.kind === "files" && (
            <p className="text-sm text-muted-foreground">
              {t("admin.media.confirmDeleteFiles", {
                count: deleteCount,
                defaultValue: `Usunąć ${deleteCount} plik(ów)? Operacji nie można cofnąć.`,
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
            <Button variant="outline" onClick={onConfirmDeleteClose}>
              {t("admin.cancel", { defaultValue: "Anuluj" })}
            </Button>
            <Button variant="destructive" onClick={onConfirmDelete}>
              <Trash2 className="w-4 h-4 mr-1" />
              {t("admin.delete", { defaultValue: "Usuń" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
