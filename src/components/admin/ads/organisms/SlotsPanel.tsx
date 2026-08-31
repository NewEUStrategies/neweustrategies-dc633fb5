// Organizm: zakladka SLOTY panelu reklam - lista slotow plus formularz
// dodawania/edycji.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { confirmDialog } from "@/lib/appDialogs";
import { adminToast } from "@/lib/adminToasts";
import {
  AD_SLOT_KIND_LABEL_KEYS,
  adTargetingToJson,
  parseAdTargeting,
  type AdSlot,
  type AdSlotKind,
} from "@/lib/ads/types";
import { emptySlot } from "../model";
import { TargetingEditor } from "../molecules/TargetingEditor";
import { TargetingHeader } from "../molecules/TargetingHeader";
import { TargetingSummary } from "../molecules/TargetingSummary";

export function SlotsPanel() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [draft, setDraft] = useState<Partial<AdSlot>>(emptySlot());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("ad_slots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setSlots((data as AdSlot[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  // Bialka lista kolumn EDYTOWALNYCH. „Edytuj" wklada do szkicu caly wiersz
  // z bazy, wiec `{ ...draft }` odsylalby takze `id`, `tenant_id`, `created_at`
  // i `updated_at` sprzed edycji - a wtedy znacznik zmiany cofalby sie w czasie
  // i kazda warstwa sortujaca albo cache'ujaca po `updated_at` widzialaby
  // kreacje jako niezmieniona. `tenant_id` w ladunku to dodatkowo zapis kolumny
  // rozdzielajacej najemcow. Tych kolumn pilnuje baza, nie formularz.
  const payloadOf = (d: Partial<AdSlot>) => ({
    name: d.name ?? "",
    kind: d.kind ?? "html",
    status: d.status ?? "active",
    html: d.html ?? null,
    script: d.script ?? null,
    image_url: d.image_url ?? null,
    image_link: d.image_link ?? null,
    image_alt: d.image_alt ?? null,
    width: d.width ?? null,
    height: d.height ?? null,
    requires_consent: d.requires_consent ?? true,
    targeting: d.targeting ?? {},
    notes: d.notes ?? null,
  });

  const save = async () => {
    if (!draft.name?.trim()) {
      toast.error(t("adsAdmin.slots.nameRequired"));
      return;
    }
    setBusy(true);
    const payload = payloadOf(draft) as never;
    const { error } = draft.id
      ? await supabase.from("ad_slots").update(payload).eq("id", draft.id)
      : await supabase.from("ad_slots").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.saved());
      setDraft(emptySlot());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("adsAdmin.slots.deleteTitle"),
        description: t("adsAdmin.slots.deleteBody"),
        destructive: true,
        confirmLabel: t("adsAdmin.deleteConfirm"),
      }))
    )
      return;
    const { error } = await supabase.from("ad_slots").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.deleted());
      load();
    }
  };

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">{t("adsAdmin.slots.columnName")}</th>
              <th className="text-left p-3">{t("adsAdmin.slots.columnKind")}</th>
              <th className="text-left p-3">{t("adsAdmin.slots.columnStatus")}</th>
              <th className="text-left p-3">{t("adsAdmin.slots.columnConsent")}</th>
              <th className="text-left p-3">
                <TargetingHeader />
              </th>
              <th className="p-3">
                <span className="sr-only">{t("adsAdmin.columnActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} className="border-b border-border hover:bg-muted/40">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{t(AD_SLOT_KIND_LABEL_KEYS[s.kind])}</td>
                <td className="p-3">
                  {s.status === "active"
                    ? t("adsAdmin.slots.statusActive")
                    : t("adsAdmin.slots.statusPaused")}
                </td>
                <td className="p-3">
                  {s.requires_consent
                    ? t("adsAdmin.slots.consentRequired")
                    : t("adsAdmin.slots.consentNotRequired")}
                </td>
                <td className="p-3">
                  <TargetingSummary slot={s} />
                </td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(s)}>
                    {t("adsAdmin.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adsAdmin.slots.deleteAction")}
                    onClick={() => remove(s.id)}
                  >
                    <Trash className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {slots.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                  {t("adsAdmin.slots.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-4">
          {draft.id ? t("adsAdmin.slots.editTitle") : t("adsAdmin.slots.addTitle")}
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <FloatingInput
            label={t("adsAdmin.slots.fieldName")}
            value={draft.name ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div>
            <Label>{t("adsAdmin.slots.fieldKind")}</Label>
            <Select
              value={draft.kind ?? "html"}
              onValueChange={(v) => setDraft({ ...draft, kind: v as AdSlotKind })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_SLOT_KIND_LABEL_KEYS).map(([value, labelKey]) => (
                  <SelectItem key={value} value={value}>
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.kind === "html" && (
            <div className="sm:col-span-2 space-y-1.5">
              <FloatingTextarea
                label={t("adsAdmin.slots.fieldHtml")}
                rows={4}
                value={draft.html ?? ""}
                onChange={(e) => setDraft({ ...draft, html: e.target.value })}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("adsAdmin.slots.sandboxHtmlHint")}</p>
            </div>
          )}
          {draft.kind === "script" && (
            <div className="sm:col-span-2 space-y-1.5">
              <FloatingTextarea
                label={t("adsAdmin.slots.fieldScript")}
                rows={5}
                value={draft.script ?? ""}
                onChange={(e) => setDraft({ ...draft, script: e.target.value })}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {t("adsAdmin.slots.sandboxScriptHint")}
              </p>
            </div>
          )}
          {draft.kind === "image" && (
            <>
              <FloatingInput
                containerClassName="sm:col-span-2"
                label={t("adsAdmin.slots.fieldImageUrl")}
                value={draft.image_url ?? ""}
                onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
              />
              <FloatingInput
                label={t("adsAdmin.slots.fieldClickUrl")}
                value={draft.image_link ?? ""}
                onChange={(e) => setDraft({ ...draft, image_link: e.target.value })}
              />
              <FloatingInput
                label={t("adsAdmin.slots.fieldAlt")}
                value={draft.image_alt ?? ""}
                onChange={(e) => setDraft({ ...draft, image_alt: e.target.value })}
              />
            </>
          )}

          <FloatingInput
            label={t("adsAdmin.slots.fieldWidth")}
            type="number"
            value={draft.width ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, width: e.target.value ? Number(e.target.value) : null })
            }
          />
          <FloatingInput
            label={t("adsAdmin.slots.fieldHeight")}
            type="number"
            value={draft.height ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, height: e.target.value ? Number(e.target.value) : null })
            }
          />

          <div className="flex items-center gap-2">
            <Switch
              checked={draft.status === "active"}
              onCheckedChange={(v) => setDraft({ ...draft, status: v ? "active" : "paused" })}
            />
            <Label className="m-0">{t("adsAdmin.slots.fieldActive")}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={!!draft.requires_consent}
              onCheckedChange={(v) => setDraft({ ...draft, requires_consent: v })}
            />
            <Label className="m-0">{t("adsAdmin.slots.fieldRequiresConsent")}</Label>
          </div>

          <TargetingEditor
            value={parseAdTargeting(draft.targeting)}
            onChange={(next) => setDraft({ ...draft, targeting: adTargetingToJson(next) })}
          />

          <FloatingTextarea
            containerClassName="sm:col-span-2"
            label={t("adsAdmin.slots.fieldNotes")}
            rows={2}
            value={draft.notes ?? ""}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={busy}>
            <Plus className="w-4 h-4 mr-2" />
            {draft.id ? t("adsAdmin.save") : t("adsAdmin.slots.addAction")}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptySlot())}>
              {t("adsAdmin.cancel")}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
