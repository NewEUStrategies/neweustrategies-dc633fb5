// Molekuła: ustawienia kontroferty retencyjnej.
//
// Trzy liczby decydujące o tym, ile pieniędzy oddajemy odchodzącemu klientowi:
// procent rabatu, liczba okresów rozliczeniowych z rabatem i ważność kodu.
// Pola są tekstowe, więc przycięcie do zakresu robi reguła (`clampInt`) przy
// zapisie - panel nie ma prawa wysłać do generatora kuponów ani -30%, ani 900%.
//
// Przełącznik „włączona" wyłącza CAŁĄ kontrofertę: przy `false` rezygnacja idzie
// prostą drogą, bez ekranu z rabatem.
import { useTranslation } from "react-i18next";
import { HeartHandshake, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import type { RetentionSettingsDraft } from "@/lib/admin/pricingDrafts";

export function RetentionSettingsCard({
  draft,
  saving,
  onChange,
  onSave,
}: {
  draft: RetentionSettingsDraft;
  saving: boolean;
  onChange: (patch: Partial<RetentionSettingsDraft>) => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="h-4 w-4 text-primary" aria-hidden="true" />
          {ta("retention.settingsHeading")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{ta("retention.settingsHint")}</p>
        <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
          <div className="flex items-center gap-2 pb-2">
            <Switch checked={draft.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
            <span className="text-xs">{ta("retention.enabled")}</span>
          </div>
          <LabeledField label={ta("retention.discountPct")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={90}
                value={draft.discount_pct}
                onChange={(e) => onChange({ discount_pct: e.target.value })}
              />
            )}
          </LabeledField>
          <LabeledField label={ta("retention.discountPeriods")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={24}
                value={draft.discount_periods}
                onChange={(e) => onChange({ discount_periods: e.target.value })}
              />
            )}
          </LabeledField>
          <LabeledField label={ta("retention.validDays")}>
            {(field) => (
              <Input
                {...field}
                type="number"
                min={1}
                max={90}
                value={draft.coupon_valid_days}
                onChange={(e) => onChange({ coupon_valid_days: e.target.value })}
              />
            )}
          </LabeledField>
          <Button size="sm" disabled={saving} onClick={onSave}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {ta("retention.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
