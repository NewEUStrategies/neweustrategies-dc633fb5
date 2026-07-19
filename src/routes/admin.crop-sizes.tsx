// Admin route: globalne definicje custom crop sizes per tenant.
// Każdy preset (np. "card 4:3 - 800x600") jest dostępny w admin
// editorach oraz wpływa na URL-e generowane przez buildTransformedImageUrl.
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import "@/lib/i18n-admin-crop-sizes";
import { adminToast } from "@/lib/adminToasts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRequiredTenant } from "@/hooks/useAuth";
import { useServerFn } from "@tanstack/react-start";
import { regenerateThumbnails } from "@/lib/media.functions";
import {
  listCropSizes,
  upsertCropSize,
  deleteCropSize,
  type CropSize,
  type CropSizeDraft,
} from "@/lib/cropSizes";

import { confirmDialog } from "@/lib/appDialogs";
export const Route = createFileRoute("/admin/crop-sizes")({
  component: CropSizesAdmin,
  head: () => ({ meta: [{ title: "Crop sizes - Admin" }] }),
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">404</div>,
});

const DEFAULT_DRAFT: CropSizeDraft = {
  name: "",
  ratio_w: 16,
  ratio_h: 9,
  width: 1280,
  height: 720,
  position: 10,
};

function CropSizesAdmin() {
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const { data: sizes = [] } = useQuery({
    queryKey: ["cropSizes", tenantId] as const,
    queryFn: () => listCropSizes(tenantId),
  });

  const [draft, setDraft] = useState<CropSizeDraft & { id?: string }>(DEFAULT_DRAFT);
  const [regenStatus, setRegenStatus] = useState<string | null>(null);
  const regen$ = useServerFn(regenerateThumbnails);
  const refresh = () => qc.invalidateQueries({ queryKey: ["cropSizes"] });

  const regenerate = async () => {
    setRegenStatus("...");
    try {
      const r = await regen$({ data: { limit: 100 } });
      setRegenStatus(
        t("adminCropSizes.regenStatus", {
          media: r.media,
          sizes: r.sizes,
          ok: r.ok,
          failed: r.failed,
        }),
      );
      toast.success(adminToast.prewarmDone());
    } catch (e) {
      setRegenStatus(null);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error(adminToast.nameRequired());
      return;
    }
    try {
      await upsertCropSize(tenantId, draft);
      toast.success(adminToast.saved());
      setDraft(DEFAULT_DRAFT);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const edit = (s: CropSize) =>
    setDraft({
      id: s.id,
      name: s.name,
      ratio_w: s.ratio_w,
      ratio_h: s.ratio_h,
      width: s.width,
      height: s.height,
      position: s.position,
    });

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("adminCropSizes.removeConfirmTitle"),
        destructive: true,
        confirmLabel: t("adminCropSizes.removeConfirmLabel"),
      }))
    )
      return;
    await deleteCropSize(id);
    refresh();
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl">{t("adminCropSizes.pageTitle")}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t("adminCropSizes.intro")}</p>
      </header>

      <section className="rounded-md border p-4 space-y-3">
        <h2 className="font-medium">
          {draft.id ? t("adminCropSizes.sectionEdit") : t("adminCropSizes.sectionNew")}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <Label>{t("adminCropSizes.name")}</Label>
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={t("adminCropSizes.namePlaceholder")}
            />
          </div>
          <div>
            <Label>{t("adminCropSizes.ratioW")}</Label>
            <Input
              type="number"
              min={1}
              value={draft.ratio_w}
              onChange={(e) =>
                setDraft({ ...draft, ratio_w: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </div>
          <div>
            <Label>{t("adminCropSizes.ratioH")}</Label>
            <Input
              type="number"
              min={1}
              value={draft.ratio_h}
              onChange={(e) =>
                setDraft({ ...draft, ratio_h: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </div>
          <div>
            <Label>{t("adminCropSizes.width")}</Label>
            <Input
              type="number"
              min={16}
              max={4096}
              value={draft.width}
              onChange={(e) =>
                setDraft({ ...draft, width: Math.max(16, Number(e.target.value) || 16) })
              }
            />
          </div>
          <div>
            <Label>{t("adminCropSizes.height")}</Label>
            <Input
              type="number"
              min={16}
              max={4096}
              value={draft.height}
              onChange={(e) =>
                setDraft({ ...draft, height: Math.max(16, Number(e.target.value) || 16) })
              }
            />
          </div>
          <div>
            <Label>{t("adminCropSizes.order")}</Label>
            <Input
              type="number"
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) || 0 })}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={save}>{t("common.save")}</Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(DEFAULT_DRAFT)}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-medium">{t("adminCropSizes.presets", { count: sizes.length })}</h2>
          <div className="flex items-center gap-3">
            {regenStatus && <span className="text-xs text-muted-foreground">{regenStatus}</span>}
            <Button size="sm" variant="secondary" onClick={regenerate}>
              {t("adminCropSizes.regenerate")}
            </Button>
          </div>
        </div>
        <ul className="divide-y divide-border rounded-md border">
          {sizes.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <div>
                <strong>{s.name}</strong>{" "}
                <span className="text-muted-foreground">
                  {s.ratio_w}:{s.ratio_h} - {s.width}×{s.height}px
                </span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => edit(s)}>
                  {t("adminCropSizes.edit")}
                </Button>
                <Button size="sm" variant="destructive" onClick={() => remove(s.id)}>
                  {t("adminCropSizes.remove")}
                </Button>
              </div>
            </li>
          ))}
          {sizes.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted-foreground">{t("adminCropSizes.empty")}</li>
          )}
        </ul>
      </section>
    </div>
  );
}
