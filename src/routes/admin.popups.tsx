// Popup manager: list of builder popups with status control; the editor lives
// under /admin/popups/$id (child route rendered through the Outlet).
//
// Dialogi (nowy popup / potwierdzenie usuniecia) uzywaja naszych komponentow
// z design systemu - nie natywnych window.prompt/window.confirm.
import { useEffect, useState } from "react";
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
import { SignupPopupContentSection } from "@/components/admin/popups/SignupPopupContentSection";
import { useNewsletterSettings, useSaveNewsletterSettings } from "@/hooks/useNewsletterSettings";

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
      return t("admin.popups.list.triggerImmediate");
    case "delay":
      return t("admin.popups.list.triggerDelay", {
        count: s.delaySeconds,
      });
    case "scroll":
      return t("admin.popups.list.triggerScroll", {
        percent: s.scrollPercent,
      });
    case "exit-intent":
      return t("admin.popups.list.triggerExit");
  }
}

// Wbudowany popup rejestracji (newsletter_settings) - nie jest wpisem w
// builder_popups, ale ma być wybieralny z tej samej listy co pozostałe.
function SignupPopupRow() {
  const { t, i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const { data } = useNewsletterSettings();
  const save = useSaveNewsletterSettings();

  const trigger = data?.popup_trigger ?? "delay";
  const summary =
    trigger === "scroll"
      ? t("admin.popups.list.triggerScroll", {
          percent: data?.popup_scroll_percent ?? 50,
        })
      : trigger === "exit-intent"
        ? t("admin.popups.list.triggerExit")
        : t("admin.popups.list.triggerDelay", {
            count: data?.popup_delay_seconds ?? 15,
          });

  const goToEditor = () => {
    document.getElementById("signup-popup-editor")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <tr className="border-t border-border bg-muted/10 hover:bg-muted/20">
      <td className="px-4 py-2.5">
        <button type="button" onClick={goToEditor} className="font-medium hover:text-brand">
          {isPl ? "Popup rejestracji" : "Registration popup"}
        </button>
        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          {isPl ? "wbudowany" : "built-in"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-muted-foreground">{summary}</td>
      <td className="px-4 py-2.5 text-muted-foreground">-</td>
      <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">-</td>
      <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">-</td>
      <td className="px-4 py-2.5">
        <Switch
          checked={Boolean(data?.popup_enabled)}
          disabled={!data}
          onCheckedChange={(on) => {
            if (!data) return;
            void save.mutateAsync({ ...data, popup_enabled: on });
          }}
          aria-label={t("admin.popups.list.toggleActive")}
        />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={goToEditor}
            className="p-1.5 text-muted-foreground hover:text-brand"
            title={t("admin.popups.list.edit")}
          >
            <Pencil className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
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
  const isPl = (i18n.language ?? "pl").startsWith("pl");

  // Per-popup view/conversion counts from popup_events (staff-read RLS,
  // tenant-scoped). Table not in generated types yet -> cast.
  const [stats, setStats] = useState<Record<string, { views: number; conversions: number }>>({});
  useEffect(() => {
    if (popups.items.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        popups.items.map(async (p) => {
          const [{ count: v }, { count: c }] = await Promise.all([
            supabase
              .from("popup_events")
              .select("*", { count: "exact", head: true })
              .eq("popup_id", p.id)
              .eq("kind", "view"),
            supabase
              .from("popup_events")
              .select("*", { count: "exact", head: true })
              .eq("popup_id", p.id)
              .eq("kind", "conversion"),
          ]);
          return [p.id, { views: v ?? 0, conversions: c ?? 0 }] as const;
        }),
      );
      if (!cancelled) setStats(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [popups.items]);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const id = await popups.create(name);
      if (!id) {
        toast.error(t("admin.popups.createError"));
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
    if (id) toast.success(t("admin.popups.duplicated"));
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await popups.remove(pendingDelete.id);
      toast.success(t("admin.popups.deleted"));
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const dateLocale = (i18n.language ?? "pl").startsWith("pl") ? "pl-PL" : "en-GB";

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("admin.popups.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("admin.popups.subtitle")}</p>
        </div>
        <Button
          onClick={() => {
            setNewName("");
            setCreateOpen(true);
          }}
        >
          <Plus className="w-4 h-4 mr-2" /> {t("admin.popups.new")}
        </Button>
      </header>

      {popups.loading ? (
        <p className="text-sm text-muted-foreground">{t("admin.popups.loading")}</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">{t("admin.popups.list.name")}</th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.trigger")}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.updated")}
                </th>
                <th className="text-right px-4 py-2.5 font-medium">
                  {isPl ? "Wyświetlenia" : "Views"}
                </th>
                <th className="text-right px-4 py-2.5 font-medium">
                  {isPl ? "Konwersje" : "Conversions"}
                </th>
                <th className="text-left px-4 py-2.5 font-medium">
                  {t("admin.popups.list.active")}
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <SignupPopupRow />

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
                        {t("admin.popups.statusArchived")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {triggerSummary(p.settings, t)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {new Date(p.updated_at).toLocaleDateString(dateLocale)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                    {stats[p.id]?.views ?? 0}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">
                    {stats[p.id]?.conversions ?? 0}
                    {(() => {
                      const st = stats[p.id];
                      return st && st.views > 0
                        ? ` (${Math.round((st.conversions / st.views) * 100)}%)`
                        : "";
                    })()}
                  </td>
                  <td className="px-4 py-2.5">
                    <Switch
                      checked={p.status === "active"}
                      onCheckedChange={(on) => void popups.setStatus(p.id, on ? "active" : "draft")}
                      aria-label={t("admin.popups.list.toggleActive")}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to="/admin/popups/$id"
                        params={{ id: p.id }}
                        className="p-1.5 text-muted-foreground hover:text-brand"
                        title={t("admin.popups.list.edit")}
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void duplicatePopup(p)}
                        className="p-1.5 text-muted-foreground hover:text-brand"
                        title={t("admin.popups.list.duplicate")}
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(p)}
                        className="p-1.5 text-muted-foreground hover:text-destructive"
                        title={t("admin.popups.list.delete")}
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

      <div id="signup-popup-editor" className="scroll-mt-24">
        <SignupPopupContentSection />
      </div>

      <Dialog open={createOpen} onOpenChange={(o) => !creating && setCreateOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("admin.popups.newDialog.title")}</DialogTitle>
            <DialogDescription>{t("admin.popups.newDialog.desc")}</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCreate();
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="popup-new-name">{t("admin.popups.newDialog.name")}</Label>
              <Input
                id="popup-new-name"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("admin.popups.newDialog.placeholder")}
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
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={!newName.trim() || creating}>
                {creating ? t("common.creating") : t("admin.popups.newDialog.submit")}
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
            <AlertDialogTitle>{t("admin.popups.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.popups.deleteDialog.desc", {
                name: pendingDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
