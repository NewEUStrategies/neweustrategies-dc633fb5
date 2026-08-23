// Organizm: formularz pozycji reklamowej (dodawanie i edycja).
//
// Lista slotów przychodzi propsem - formularz nie zna Supabase. Zakres czasowy
// ma JEDNĄ regułę wartą dowodu: data końca dostaje `minDate` z daty startu,
// więc panel nie pozwala zbudować pozycji, która kończy się przed początkiem.
// Oba puste piki mówią, co znaczy pustka ("od razu" / "bezterminowo") - i oba
// mówią to twardym polskim napisem.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { FloatingInput } from "@/components/ui/floating-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus } from "@/lib/lucide-shim";
import {
  AD_PAGE_TYPE_LABEL_KEYS,
  AD_POSITION_LABEL_KEYS,
  type AdPageType,
  type AdPlacement,
  type AdPosition,
  type AdSlot,
} from "@/lib/ads/types";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdPlacementConfigFields } from "../molecules/AdPlacementConfigFields";

export function AdPlacementForm({
  draft,
  slots,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: Partial<AdPlacement>;
  slots: AdSlot[];
  onChange: (next: Partial<AdPlacement>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  ensureAdsAdminI18n();
  const { t } = useTranslation();

  const cfg = (draft.config ?? {}) as Record<string, unknown>;
  const setCfg = (key: string, val: unknown) =>
    onChange({ ...draft, config: { ...cfg, [key]: val } });

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <h2 className="font-semibold mb-4">
        {draft.id ? t("adsAdmin.placements.editTitle") : t("adsAdmin.placements.addTitle")}
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label>Slot</Label>
          <Select
            value={draft.slot_id ?? ""}
            onValueChange={(v) => onChange({ ...draft, slot_id: v })}
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
          <Label>Pozycja na stronie</Label>
          <Select
            value={draft.position ?? "top_of_post"}
            onValueChange={(v) => onChange({ ...draft, position: v as AdPosition })}
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
          <Label>Typ strony</Label>
          <Select
            value={draft.page_type ?? "all"}
            onValueChange={(v) => onChange({ ...draft, page_type: v as AdPageType })}
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
          label="Sortowanie"
          type="number"
          value={draft.sort_order ?? 0}
          onChange={(e) => onChange({ ...draft, sort_order: Number(e.target.value) })}
        />

        <AdPlacementConfigFields
          position={draft.position ?? "top_of_post"}
          config={cfg}
          onSet={setCfg}
        />

        <div>
          <Label>Aktywne od</Label>
          <DateTimePicker
            value={draft.starts_at ?? null}
            onChange={(iso) => onChange({ ...draft, starts_at: iso })}
            placeholder="Od razu (bez ograniczenia)"
          />
        </div>
        <div>
          <Label>Aktywne do</Label>
          <DateTimePicker
            value={draft.ends_at ?? null}
            onChange={(iso) => onChange({ ...draft, ends_at: iso })}
            placeholder="Bezterminowo"
            minDate={draft.starts_at ? new Date(draft.starts_at) : undefined}
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            checked={!!draft.active}
            onCheckedChange={(v) => onChange({ ...draft, active: v })}
          />
          <Label className="m-0">Aktywne</Label>
        </div>
      </div>

      <div className="flex gap-2 mt-5">
        <Button onClick={onSubmit} disabled={busy}>
          <Plus className="w-4 h-4 mr-2" />
          {draft.id ? t("adsAdmin.save") : t("adsAdmin.placements.addAction")}
        </Button>
        {draft.id && (
          <Button variant="outline" onClick={onCancel}>
            Anuluj
          </Button>
        )}
      </div>
    </section>
  );
}
