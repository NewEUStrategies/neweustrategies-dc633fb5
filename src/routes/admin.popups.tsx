// Popup manager: list of builder popups with status control; the editor lives
// under /admin/popups/$id (child route rendered through the Outlet).
//
// Dialogi (nowy popup / potwierdzenie usuniecia) uzywaja naszych komponentow
// z design systemu - nie natywnych window.prompt/window.confirm.
import { useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Pencil, Plus, Trash2 } from "@/lib/lucide-shim";
import { usePopupsAdmin, type BuilderPopup, type PopupSettings } from "@/lib/builder/popups";

export const Route = createFileRoute("/admin/popups")({
  component: PopupsLayout,
});

function PopupsLayout() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (path !== "/admin/popups") return <Outlet />;
  return <PopupsList />;
}

function triggerSummary(s: PopupSettings, t: TFunction): string {
  switch (s.trigger) {
    case "immediate":
      return t("admin.popups.list.triggerImmediate", { defaultValue: "od razu" });
    case "delay":
      return t("admin.popups.list.triggerDelay", {
        defaultValue: "po {{count}} s",
        count: s.delaySeconds,
      });
    case "scroll":
      return t("admin.popups.list.triggerScroll", {
        defaultValue: "po {{percent}}% przewinięcia",
        percent: s.scrollPercent,
      });
    case "exit-intent":
      return t("admin.popups.list.triggerExit", { defaultValue: "exit intent" });
  }
}

function PopupsList() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const popups = usePopupsAdmin();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BuilderPopup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await popups.create(name);
      if (!id) {
        toast.error(
          t("admin.popups.createError", { defaultValue: "Nie udało się utworzyć popupu" }),
        );
        return;
      }
      setCreateOpen(false);
      setNewName("");
      void navigate({ to: "/admin/popups/$id", params: { id } });
    } finally {
      setCreating(false);
    }
  };

  const duplicatePopup = async (p: BuilderPopup) => {
    const id = await popups.duplicate(p);
    if (id) toast.success(t("admin.popups.duplicated", { defaultValue: "Zduplikowano popup" }));
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await popups.remove(pendingDelete.id);
      toast.success(t("admin.popups.deleted", { defaultValue: "Usunięto popup" }));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const dateLocale = (i18n.language ?? "pl").startsWith("pl") ? "pl-PL" : "en-GB";

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">
            {t("admin.popups.title", { defaultValue: "Popupy" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("admin.popups.subtitle", {
              defaultValue:
                "Popupy budowane visual builderem - z wyzwalaczami, targetowaniem stron i limitem częstotliwości.",
            })}
          </p>
        </div>
        <Button
          onClick={() => {
            setNewName("");
            setCreateOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" /> {t("admin.popups.new", { defaultValue: "Nowy popup" })}
        </Button>
      </header>

      {popups.loading ? (
        <p className="text-sm text-muted-foreground">
          {t("admin.popups.loading", { defaultValue: "Ładowanie…" })}
        </p>
      ) : popups.items.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("admin.popups.empty", {
              defaultValue:
                "Nie masz jeszcze żadnych popupów. Utwórz pierwszy i zbuduj go tak samo jak stronę.",
            })}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.name", { defaultValue: "Nazwa" })}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.trigger", { defaultValue: "Wyzwalacz" })}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.updated", { defaultValue: "Aktualizacja" })}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.active", { defaultValue: "Aktywny" })}
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {popups.items.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-2.5">
                    <Link
                      to="/admin/popups/$id"
                      params={{ id: p.id }}
                      className="font-medium hover:text-brand"
                    >
                      {p.name}
                    </Link>
                    {p.status === "archived" && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {t("admin.popups.statusArchived", { defaultValue: "Zarchiwizowany" })}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {triggerSummary(p.settings, t)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString(dateLocale)}
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch
                      checked={p.status === "active"}
                      onCheckedChange={(on) => void popups.setStatus(p.id, on ? "active" : "draft")}
                      aria-label={t("admin.popups.list.toggleActive", {
                        defaultValue: "Przełącz aktywność",
                      })}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to="/admin/popups/$id"
                        params={{ id: p.id }}
                        className="p-1.5 text-muted-foreground hover:text-brand"
                        title={t("admin.popups.list.edit", { defaultValue: "Edytuj" })}
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void duplicatePopup(p)}
                        className="p-1.5 text-muted-foreground hover:text-brand"
                        title={t("admin.popups.list.duplicate", { defaultValue: "Duplikuj" })}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(p)}
                        className="p-1.5 text-muted-foreground hover:text-destructive"
                        title={t("admin.popups.list.delete", { defaultValue: "Usuń" })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("admin.popups.newDialog.title", { defaultValue: "Nowy popup" })}
            </DialogTitle>
            <DialogDescription>
              {t("admin.popups.newDialog.desc", {
                defaultValue:
                  "Podaj nazwe roboczą - bedzie widoczna wylacznie w panelu admina.",
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="popup-new-name">
                {t("admin.popups.newDialog.name", { defaultValue: "Nazwa" })}
              </Label>
              <Input
                id="popup-new-name"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("admin.popups.newDialog.placeholder", {
                  defaultValue: "np. Wiosenna promocja",
                })}
                maxLength={120}
                disabled={creating}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
                disabled={creating}
              >
                {t("common.cancel", { defaultValue: "Anuluj" })}
              </Button>
              <Button type="submit" disabled={!newName.trim() || creating}>
                {creating
                  ? t("common.creating", { defaultValue: "Tworze…" })
                  : t("admin.popups.newDialog.submit", { defaultValue: "Utwórz i edytuj" })}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !deleting && !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("admin.popups.deleteDialog.title", { defaultValue: "Usunąć popup?" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.popups.deleteDialog.desc", {
                defaultValue:
                  'Popup "{{name}}" zostanie trwale usunięty. Tej operacji nie da się cofnąć.',
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("common.cancel", { defaultValue: "Anuluj" })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting
                ? t("common.deleting", { defaultValue: "Usuwam…" })
                : t("common.delete", { defaultValue: "Usuń" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
