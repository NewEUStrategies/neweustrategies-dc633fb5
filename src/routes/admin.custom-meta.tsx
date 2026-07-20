// Admin route: manage global "Custom Meta" definitions per tenant.
// Each definition becomes a per-post field on the post editor.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ensureI18n as ensureAdminMiscRoutesI18n } from "@/lib/i18n-admin-misc-routes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FloatingInput } from "@/components/ui/floating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequiredTenant } from "@/hooks/useAuth";
import {
  listCustomMetaDefs,
  upsertCustomMetaDef,
  deleteCustomMetaDef,
  type CustomMetaDef,
} from "@/lib/customMeta";
import { CUSTOM_META_ICON_NAMES } from "@/components/post/CustomMetaList";

import { confirmDialog } from "@/lib/appDialogs";
import { adminToast } from "@/lib/adminToasts";
export const Route = createFileRoute("/admin/custom-meta")({
  component: CustomMetaAdmin,
  head: () => ({ meta: [{ title: "Custom meta - Admin" }] }),
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">404</div>,
});

type Draft = Omit<CustomMetaDef, "id" | "tenant_id"> & { id?: string };

function CustomMetaAdmin() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMiscRoutesI18n();
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const { data: defs = [], isLoading } = useQuery({
    queryKey: ["customMetaDefs", tenantId] as const,
    queryFn: () => listCustomMetaDefs(tenantId),
  });

  const [draft, setDraft] = useState<Draft>({
    key: "",
    label_pl: "",
    label_en: "",
    icon: "Clock",
    position: (defs.length + 1) * 10,
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["customMetaDefs"] });

  const save = async (): Promise<void> => {
    if (!draft.key.trim()) {
      toast.error(adminToast.keyRequired());
      return;
    }
    if (!draft.label_pl.trim() && !draft.label_en.trim()) {
      toast.error(adminToast.labelRequired());
      return;
    }
    try {
      await upsertCustomMetaDef({
        ...draft,
        id: editingId ?? undefined,
        tenant_id: tenantId,
        key: draft.key
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]+/g, "_"),
      });
      toast.success(adminToast.saved());
      setDraft({
        key: "",
        label_pl: "",
        label_en: "",
        icon: "Clock",
        position: (defs.length + 1) * 10,
      });
      setEditingId(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("adminMiscRoutes.customMeta.saveError"));
    }
  };

  const edit = (d: CustomMetaDef): void => {
    setEditingId(d.id);
    setDraft({
      key: d.key,
      label_pl: d.label_pl,
      label_en: d.label_en,
      icon: d.icon,
      position: d.position,
    });
  };

  const remove = async (id: string): Promise<void> => {
    if (
      !(await confirmDialog({
        title: t("adminMiscRoutes.customMeta.confirmTitle"),
        destructive: true,
        confirmLabel: t("adminMiscRoutes.customMeta.confirmLabel"),
      }))
    )
      return;
    try {
      await deleteCustomMetaDef(id);
      refresh();
      toast.success(adminToast.deleted());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("adminMiscRoutes.customMeta.genericError"));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">{t("adminMiscRoutes.customMeta.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("adminMiscRoutes.customMeta.intro")}</p>
        </div>
        <Link to="/admin" className="text-sm text-brand underline">
          ← Admin
        </Link>
      </header>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">
          {editingId
            ? t("adminMiscRoutes.customMeta.sectionEdit")
            : t("adminMiscRoutes.customMeta.sectionAdd")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <FloatingInput
              label={t("adminMiscRoutes.customMeta.keyLabel")}
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              disabled={!!editingId}
            />
          </div>
          <div>
            <Label>{t("adminMiscRoutes.customMeta.icon")}</Label>
            <Select value={draft.icon} onValueChange={(v) => setDraft({ ...draft, icon: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_META_ICON_NAMES.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FloatingInput
            label={t("adminMiscRoutes.customMeta.labelPl")}
            value={draft.label_pl}
            onChange={(e) => setDraft({ ...draft, label_pl: e.target.value })}
          />
          <FloatingInput
            label={t("adminMiscRoutes.customMeta.labelEn")}
            value={draft.label_en}
            onChange={(e) => setDraft({ ...draft, label_en: e.target.value })}
          />
          <FloatingInput
            label={t("adminMiscRoutes.customMeta.position")}
            type="number"
            value={draft.position}
            onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="flex gap-2 justify-end">
          {editingId && (
            <Button
              variant="outline"
              onClick={() => {
                setEditingId(null);
                setDraft({
                  key: "",
                  label_pl: "",
                  label_en: "",
                  icon: "Clock",
                  position: (defs.length + 1) * 10,
                });
              }}
            >
              {t("common.cancel")}
            </Button>
          )}
          <Button onClick={save}>
            {editingId
              ? t("adminMiscRoutes.customMeta.saveChanges")
              : t("adminMiscRoutes.customMeta.add")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-border">
          {t("adminMiscRoutes.customMeta.definedFields")}
        </h2>
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">...</div>
        ) : defs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {t("adminMiscRoutes.customMeta.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {defs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground w-10">
                  {d.position}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {d.label_pl || d.label_en || d.key}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t("adminMiscRoutes.customMeta.iconMeta", { key: d.key, icon: d.icon })}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => edit(d)}>
                  {t("adminMiscRoutes.customMeta.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(d.id)}
                  className="text-destructive"
                >
                  {t("adminMiscRoutes.customMeta.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
