// Organizm: formularz slotu reklamowego (dodawanie i edycja).
//
// NIE dotyka Supabase - dostaje draft, domknięcia i flagę `busy`, więc dowód
// "co panel wysyła" stoi w panelu, a dowód "co panel pyta" tutaj. Jedyny punkt
// kontaktu z react-query w całej rodzinie `ads` to `useInterestCatalog`: język
// katalogu liczy się TU, bo to formularz zna język interfejsu.
//
// UWAGA na język katalogu: gałąź to `i18n.language === "en" ? "en" : "pl"`,
// czyli KAŻDY język inny niż dokładnie "en" (także "en-US") dostaje katalog
// polski. Reszta repo normalizuje przez `uiLang()`; tutaj nie - przeniesione
// znak w znak.
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
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
  AD_SLOT_KIND_LABEL_KEYS,
  adTargetingToJson,
  parseAdTargeting,
  type AdLanguage,
  type AdSlot,
  type AdSlotKind,
} from "@/lib/ads/types";
import { useInterestCatalog } from "@/hooks/useInterests";
import { ensureI18n as ensureAdsAdminI18n } from "@/lib/i18n-ads-admin";
import { AdSlotKindFields } from "../molecules/AdSlotKindFields";
import { AdTargetingEditor } from "../molecules/AdTargetingEditor";

export function AdSlotForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  busy,
}: {
  draft: Partial<AdSlot>;
  onChange: (next: Partial<AdSlot>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  ensureAdsAdminI18n();
  const { t, i18n } = useTranslation();
  const lang: AdLanguage = i18n.language === "en" ? "en" : "pl";
  const catalog = useInterestCatalog(lang);

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <h2 className="font-semibold mb-4">
        {draft.id ? t("adsAdmin.slots.editTitle") : t("adsAdmin.slots.addTitle")}
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <FloatingInput
          label={t("adsAdmin.slots.fieldName")}
          value={draft.name ?? ""}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
        <div>
          <Label>Typ</Label>
          <Select
            value={draft.kind ?? "html"}
            onValueChange={(v) => onChange({ ...draft, kind: v as AdSlotKind })}
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

        <AdSlotKindFields
          kind={draft.kind ?? "html"}
          values={{
            html: draft.html ?? "",
            script: draft.script ?? "",
            imageUrl: draft.image_url ?? "",
            imageLink: draft.image_link ?? "",
            imageAlt: draft.image_alt ?? "",
          }}
          onChange={(patch) => onChange({ ...draft, ...patch })}
        />

        <FloatingInput
          label={t("adsAdmin.slots.fieldWidth")}
          type="number"
          value={draft.width ?? ""}
          onChange={(e) =>
            onChange({ ...draft, width: e.target.value ? Number(e.target.value) : null })
          }
        />
        <FloatingInput
          label={t("adsAdmin.slots.fieldHeight")}
          type="number"
          value={draft.height ?? ""}
          onChange={(e) =>
            onChange({ ...draft, height: e.target.value ? Number(e.target.value) : null })
          }
        />

        <div className="flex items-center gap-2">
          <Switch
            checked={draft.status === "active"}
            onCheckedChange={(v) => onChange({ ...draft, status: v ? "active" : "paused" })}
          />
          <Label className="m-0">Aktywny</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={!!draft.requires_consent}
            onCheckedChange={(v) => onChange({ ...draft, requires_consent: v })}
          />
          <Label className="m-0">Wymaga zgody marketingowej (RODO)</Label>
        </div>

        <AdTargetingEditor
          value={parseAdTargeting(draft.targeting)}
          onChange={(next) => onChange({ ...draft, targeting: adTargetingToJson(next) })}
          categories={catalog.data?.categories ?? []}
          tags={catalog.data?.tags ?? []}
        />

        <FloatingTextarea
          containerClassName="sm:col-span-2"
          label={t("adsAdmin.slots.fieldNotes")}
          rows={2}
          value={draft.notes ?? ""}
          onChange={(e) => onChange({ ...draft, notes: e.target.value })}
        />
      </div>
      <div className="flex gap-2 mt-5">
        <Button onClick={onSubmit} disabled={busy}>
          <Plus className="w-4 h-4 mr-2" />
          {draft.id ? t("adsAdmin.save") : t("adsAdmin.slots.addAction")}
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
