// Molekuła: edytor JEDNEJ warstwy członkostwa.
//
// Cztery grupy pól: nazwy i opisy (para PL/EN), status z rangą, benefity dla
// klienta i możliwości maszynowe (przełączniki, limit zapytań do ekspertów oraz
// surowy JSON dla adminów). Ranga ustala hierarchię warstw wszędzie - i w
// panelu, i na stronie cennika.
//
// Warstwy DOMYŚLNEJ nie da się usunąć: kosz jest wyłączony, a podpowiedź mówi
// dlaczego. Bez warstwy domyślnej nowy użytkownik nie dostałby żadnej.
//
// Karta nie ma własnego stanu - szkic i zapis wstrzykuje zakładka, więc
// „niezapisane zmiany" żyją w jednym miejscu dla wszystkich warstw.
import { useTranslation } from "react-i18next";
import { BadgeCheck, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { FieldGroupRule } from "@/components/admin/membership/atoms/FieldGroupRule";
import { TierCapabilitiesPanel } from "@/components/admin/membership/organisms/TierCapabilitiesPanel";
import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";
import type { TierDraft } from "@/lib/admin/membershipDrafts";
import type { MembershipTierRow, TierBenefit } from "@/lib/billing/tiers";

export function TierEditorCard({
  tier,
  draft,
  saving,
  deleting,
  onChange,
  onSave,
  onDelete,
}: {
  tier: MembershipTierRow;
  draft: TierDraft;
  saving: boolean;
  deleting: boolean;
  onChange: (patch: Partial<TierDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const set = onChange;
  const setBenefits = (list: TierBenefit[]) => set({ benefits: list });
  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-mono text-sm font-semibold">{tier.key}</span>
          <Badge variant="secondary" className="rounded-[6px] text-[10px]">
            {tm("rankBadge")} {tier.rank}
          </Badge>
          {tier.is_default && (
            <Badge className="rounded-[6px] bg-primary/10 text-[10px] text-primary hover:bg-primary/10">
              {tm("defaultBadge")}
            </Badge>
          )}
          {!tier.active && (
            <Badge variant="outline" className="rounded-[6px] text-[10px]">
              {tm("inactiveBadge")}
            </Badge>
          )}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => {
            if (confirm(tm("deleteConfirm", { key: tier.key }))) {
              onDelete();
            }
          }}
          disabled={deleting || tier.is_default}
          title={tier.is_default ? tm("deleteDefaultDisabled") : tm("deleteTitle")}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="flex flex-1 flex-col gap-5 p-4">
        <FieldGroupRule label={tm("groups.naming")}>
          <div className="grid grid-cols-2 gap-2">
            <LabeledField label={tm("fields.namePl")} className="space-y-1">
              {(field) => (
                <Input
                  {...field}
                  value={draft.name_pl}
                  onChange={(e) => set({ name_pl: e.target.value })}
                />
              )}
            </LabeledField>
            <LabeledField label={tm("fields.nameEn")} className="space-y-1">
              {(field) => (
                <Input
                  {...field}
                  value={draft.name_en}
                  onChange={(e) => set({ name_en: e.target.value })}
                />
              )}
            </LabeledField>
            <LabeledField label={tm("fields.descriptionPl")} className="space-y-1">
              {(field) => (
                <Textarea
                  {...field}
                  rows={2}
                  value={draft.description_pl}
                  onChange={(e) => set({ description_pl: e.target.value })}
                />
              )}
            </LabeledField>
            <LabeledField label={tm("fields.descriptionEn")} className="space-y-1">
              {(field) => (
                <Textarea
                  {...field}
                  rows={2}
                  value={draft.description_en}
                  onChange={(e) => set({ description_en: e.target.value })}
                />
              )}
            </LabeledField>
          </div>
        </FieldGroupRule>

        <FieldGroupRule label={tm("groups.status")}>
          <div className="grid grid-cols-3 items-end gap-3">
            <LabeledField label={tm("fields.rank")} className="space-y-1">
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  min={0}
                  value={draft.rank}
                  onChange={(e) => set({ rank: Number(e.target.value) || 0 })}
                />
              )}
            </LabeledField>
            <label className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-xs">
              <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
              {tm("fields.active")}
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-xs">
              <Switch checked={draft.is_default} onCheckedChange={(v) => set({ is_default: v })} />
              {tm("fields.default")}
            </label>
          </div>
        </FieldGroupRule>

        <FieldGroupRule label={tm("groups.benefits")}>
          <TierBenefitsEditor value={draft.benefits} onChange={setBenefits} />
        </FieldGroupRule>

        <FieldGroupRule label={tm("groups.capabilities")}>
          <TierCapabilitiesPanel
            value={draft.features}
            onChange={(features) => set({ features })}
          />
        </FieldGroupRule>

        <div className="mt-auto pt-1">
          <Button size="sm" className="w-full" disabled={saving} onClick={onSave}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {tm("save")}
          </Button>
        </div>
      </div>
    </article>
  );
}
