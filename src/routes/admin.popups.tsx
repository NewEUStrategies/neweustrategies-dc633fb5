// Popup manager: list of builder popups with status control; the editor lives
// under /admin/popups/$id (child route rendered through the Outlet).
import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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

  const createPopup = async () => {
    const name = window.prompt(
      t("admin.popups.newNamePrompt", { defaultValue: "Nazwa nowego popupu:" }),
    );
    if (!name?.trim()) return;
    const id = await popups.create(name.trim());
    if (!id) {
      toast.error(t("admin.popups.createError", { defaultValue: "Nie udało się utworzyć popupu" }));
      return;
    }
    void navigate({ to: "/admin/popups/$id", params: { id } });
  };

  const duplicatePopup = async (p: BuilderPopup) => {
    const id = await popups.duplicate(p);
    if (id) toast.success(t("admin.popups.duplicated", { defaultValue: "Zduplikowano popup" }));
  };

  const removePopup = async (p: BuilderPopup) => {
    if (
      !window.confirm(
        t("admin.popups.confirmDelete", { defaultValue: 'Usunąć popup "{{name}}"?', name: p.name }),
      )
    )
      return;
    await popups.remove(p.id);
    toast.success(t("admin.popups.deleted", { defaultValue: "Usunięto popup" }));
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
        <Button onClick={() => void createPopup()}>
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
                        onClick={() => void removePopup(p)}
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
    </div>
  );
}
