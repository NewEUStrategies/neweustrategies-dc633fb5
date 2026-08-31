// Organizm: zakladka POZYCJE panelu reklam - przypiecia slotow do miejsc na
// stronie plus formularz dodawania/edycji.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FloatingInput } from "@/components/ui/floating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { confirmDialog } from "@/lib/appDialogs";
import { adminToast } from "@/lib/adminToasts";
import {
  AD_PAGE_TYPE_LABEL_KEYS,
  AD_POSITION_LABEL_KEYS,
  type AdPageType,
  type AdPlacement,
  type AdPosition,
  type AdSlot,
} from "@/lib/ads/types";
import { emptyPlacement } from "../model";

export function PlacementsPanel() {
  const { t } = useTranslation();
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [draft, setDraft] = useState<Partial<AdPlacement>>(emptyPlacement());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [slotsRes, placementsRes] = await Promise.all([
      supabase.from("ad_slots").select("*").order("name"),
      supabase.from("ad_placements").select("*").order("sort_order"),
    ]);
    // Odmowa RLS i awaria sieci daly wczesniej DOKLADNIE ten sam widok, co
    // pusta tabela („Brak pozycji.") - administrator zakladal wtedy NOWA
    // pozycje tam, gdzie jedna juz stoi. Panel slotow obok czyta `error` od
    // zawsze; ten robi to teraz tak samo.
    const error = slotsRes.error ?? placementsRes.error;
    if (error) toast.error(error.message);
    setSlots((slotsRes.data as AdSlot[]) ?? []);
    setPlacements((placementsRes.data as AdPlacement[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const slotMap = useMemo(() => Object.fromEntries(slots.map((s) => [s.id, s])), [slots]);

  const save = async () => {
    if (!draft.slot_id) {
      toast.error(t("adsAdmin.placements.selectSlot"));
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_placements").update(payload).eq("id", draft.id)
      : await supabase.from("ad_placements").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.saved());
      setDraft(emptyPlacement());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("adsAdmin.placements.deleteTitle"),
        destructive: true,
        confirmLabel: t("adsAdmin.deleteConfirm"),
      }))
    )
      return;
    const { error } = await supabase.from("ad_placements").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.deleted());
      load();
    }
  };

  const cfg = (draft.config ?? {}) as Record<string, unknown>;
  const setCfg = (key: string, val: unknown) =>
    setDraft({ ...draft, config: { ...cfg, [key]: val } });

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">{t("adsAdmin.placements.columnSlot")}</th>
              <th className="text-left p-3">{t("adsAdmin.placements.columnPosition")}</th>
              <th className="text-left p-3">{t("adsAdmin.placements.columnPages")}</th>
              <th className="text-left p-3">{t("adsAdmin.placements.columnActive")}</th>
              <th className="p-3">
                <span className="sr-only">{t("adsAdmin.columnActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => (
              <tr key={p.id} className="border-b border-border hover:bg-muted/40">
                <td className="p-3 font-medium">{slotMap[p.slot_id]?.name ?? "-"}</td>
                <td className="p-3">{t(AD_POSITION_LABEL_KEYS[p.position])}</td>
                <td className="p-3">{t(AD_PAGE_TYPE_LABEL_KEYS[p.page_type])}</td>
                <td className="p-3">{p.active ? "✓" : "-"}</td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(p)}>
                    {t("adsAdmin.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("adsAdmin.placements.deleteAction")}
                    onClick={() => remove(p.id)}
                  >
                    <Trash className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {placements.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">
                  {t("adsAdmin.placements.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-4">
          {draft.id ? t("adsAdmin.placements.editTitle") : t("adsAdmin.placements.addTitle")}
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>{t("adsAdmin.placements.columnSlot")}</Label>
            <Select
              value={draft.slot_id ?? ""}
              onValueChange={(v) => setDraft({ ...draft, slot_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("adsAdmin.placements.selectSlotPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {slots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("adsAdmin.placements.fieldPosition")}</Label>
            <Select
              value={draft.position ?? "top_of_post"}
              onValueChange={(v) => setDraft({ ...draft, position: v as AdPosition })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_POSITION_LABEL_KEYS).map(([value, labelKey]) => (
                  <SelectItem key={value} value={value}>
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("adsAdmin.placements.fieldPageType")}</Label>
            <Select
              value={draft.page_type ?? "all"}
              onValueChange={(v) => setDraft({ ...draft, page_type: v as AdPageType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_PAGE_TYPE_LABEL_KEYS).map(([value, labelKey]) => (
                  <SelectItem key={value} value={value}>
                    {t(labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FloatingInput
            label={t("adsAdmin.placements.fieldSortOrder")}
            type="number"
            value={draft.sort_order ?? 0}
            onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
          />

          {draft.position === "mid_post" && (
            <FloatingInput
              label={t("adsAdmin.placements.fieldAfterParagraph")}
              type="number"
              min={1}
              value={(cfg.paragraph as number) ?? 4}
              onChange={(e) => setCfg("paragraph", Number(e.target.value))}
            />
          )}
          {draft.position === "in_feed" && (
            <FloatingInput
              label={t("adsAdmin.placements.fieldEveryNCards")}
              type="number"
              min={1}
              value={(cfg.every as number) ?? 5}
              onChange={(e) => setCfg("every", Number(e.target.value))}
            />
          )}
          {draft.position === "footer_slideup" && (
            <>
              <FloatingInput
                label={t("adsAdmin.placements.fieldDelayMs")}
                type="number"
                value={(cfg.delay_ms as number) ?? 3000}
                onChange={(e) => setCfg("delay_ms", Number(e.target.value))}
              />
              <div className="flex items-center gap-2 mt-6">
                <Switch
                  checked={(cfg.dismissible as boolean) ?? true}
                  onCheckedChange={(v) => setCfg("dismissible", v)}
                />
                <Label className="m-0">{t("adsAdmin.placements.fieldDismissible")}</Label>
              </div>
            </>
          )}

          <div>
            <Label>{t("adsAdmin.placements.fieldStartsAt")}</Label>
            <DateTimePicker
              value={draft.starts_at ?? null}
              onChange={(iso) => setDraft({ ...draft, starts_at: iso })}
              placeholder={t("adsAdmin.placements.startsAtPlaceholder")}
            />
          </div>
          <div>
            <Label>{t("adsAdmin.placements.fieldEndsAt")}</Label>
            <DateTimePicker
              value={draft.ends_at ?? null}
              onChange={(iso) => setDraft({ ...draft, ends_at: iso })}
              placeholder={t("adsAdmin.placements.endsAtPlaceholder")}
              minDate={draft.starts_at ? new Date(draft.starts_at) : undefined}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={!!draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v })}
            />
            <Label className="m-0">{t("adsAdmin.placements.fieldActive")}</Label>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={busy}>
            <Plus className="w-4 h-4 mr-2" />
            {draft.id ? t("adsAdmin.save") : t("adsAdmin.placements.addAction")}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptyPlacement())}>
              {t("adsAdmin.cancel")}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
