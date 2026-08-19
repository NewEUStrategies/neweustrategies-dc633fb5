// Molekuła: karta marketingu JEDNEJ warstwy członkostwa.
//
// Cztery grupy pól, które decydują o tym, co klient widzi na `/pricing`:
// przypisanie do segmentu i badge, tryb przycisku zakupu z linkiem
// kontaktowym, nota cenowa i przełącznik „za miejsce", oraz lista benefitów.
// Rangi, ceny i bramki dostępu należą do `/admin/membership` - tutaj ich NIE MA
// świadomie, żeby dwa panele nie zapisywały tych samych kolumn.
//
// Karta nie ma własnego stanu: szkic i zapis wstrzykuje zakładka, więc
// „niezapisane zmiany" żyją w jednym miejscu dla wszystkich warstw.
import { useTranslation } from "react-i18next";
import {
  Award,
  Crown,
  Link2,
  ListChecks,
  MessageSquare,
  Save,
  Star,
  Tag,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { FieldGroup } from "@/components/admin/pricing/atoms/FieldGroup";
import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import type { PricingAudienceRow } from "@/lib/pricing/queries";
import { CTA_MODES, NO_AUDIENCE, type TierMarketingDraft } from "@/lib/admin/pricingDrafts";
import { rankTone as toneForRank } from "@/lib/admin/rankTone";

export function TierMarketingCard({
  tier,
  draft,
  audiences,
  saving,
  onChange,
  onSave,
}: {
  tier: MembershipTierRow;
  draft: TierMarketingDraft;
  audiences: PricingAudienceRow[];
  saving: boolean;
  onChange: (patch: Partial<TierMarketingDraft>) => void;
  onSave: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const ta = (k: string, opts?: Record<string, unknown>) => t(`adminPricing.${k}`, opts);
  const tierName = lang === "en" ? tier.name_en : tier.name_pl;
  const badgeText = lang === "en" ? draft.badge_en : draft.badge_pl;
  const rankTone = toneForRank(tier.rank);
  return (
    <Card
      className={`overflow-hidden rounded-md border transition-colors ${
        draft.highlight
          ? "border-primary/60 shadow-[0_10px_30px_-20px_hsl(var(--primary)/0.6)] ring-1 ring-primary/25"
          : "border-border/70"
      }`}
    >
      <CardHeader
        className={`space-y-2 border-b border-border/60 bg-gradient-to-br ${rankTone.header} pb-3`}
      >
        <CardTitle className="flex items-start justify-between gap-3 text-base">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${rankTone.iconBg}`}
              aria-hidden="true"
            >
              <Crown className={`h-[18px] w-[18px] ${rankTone.iconFg}`} />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-foreground">{tierName}</span>
                {draft.highlight ? (
                  <span className="inline-flex items-center gap-1 rounded-[6px] bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    <Star className="h-2.5 w-2.5" aria-hidden="true" />
                    {ta("tiers.highlight")}
                  </span>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{tier.key}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 font-medium ${rankTone.pill}`}
                >
                  <Award className="h-3 w-3" aria-hidden="true" />
                  {ta("tiers.rankBadge")} {tier.rank}
                </span>
                {badgeText ? (
                  <span className="inline-flex items-center rounded-[6px] bg-foreground/5 px-1.5 py-0.5 font-medium text-foreground/80">
                    {badgeText}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <FieldGroup icon={Users} title={ta("tiers.audience")} accent={rankTone.dot}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <LabeledField label={ta("tiers.audience")} className="sm:col-span-1">
              {(field) => (
                <Select
                  {...field}
                  value={draft.audience_key}
                  onValueChange={(v) => onChange({ audience_key: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_AUDIENCE}>{ta("tiers.none")}</SelectItem>
                    {audiences.map((audience) => (
                      <SelectItem key={audience.key} value={audience.key}>
                        {audience.key} ({lang === "en" ? audience.name_en : audience.name_pl})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </LabeledField>
            <LabeledField label={ta("tiers.badgePl")}>
              {(field) => (
                <Input
                  {...field}
                  value={draft.badge_pl}
                  onChange={(e) => onChange({ badge_pl: e.target.value })}
                  placeholder="Najpopularniejszy"
                />
              )}
            </LabeledField>
            <LabeledField label={ta("tiers.badgeEn")}>
              {(field) => (
                <Input
                  {...field}
                  value={draft.badge_en}
                  onChange={(e) => onChange({ badge_en: e.target.value })}
                  placeholder="Most popular"
                />
              )}
            </LabeledField>
          </div>
          <label className="mt-2 flex items-start gap-2 rounded-[6px] border border-border/60 bg-muted/30 px-2.5 py-2">
            <Switch checked={draft.highlight} onCheckedChange={(v) => onChange({ highlight: v })} />
            <span className="flex flex-col">
              <span className="text-xs font-medium">{ta("tiers.highlight")}</span>
              <span className="text-[11px] text-muted-foreground">{ta("tiers.highlightHint")}</span>
            </span>
          </label>
        </FieldGroup>

        <FieldGroup icon={MessageSquare} title={ta("tiers.ctaMode")} accent={rankTone.dot}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LabeledField label={ta("tiers.ctaMode")} hint={ta("tiers.ctaModeHint")}>
              {(field) => (
                <Select
                  {...field}
                  value={draft.cta_mode}
                  onValueChange={(v) => onChange({ cta_mode: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CTA_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {ta(`tiers.ctaModes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </LabeledField>
            <div>
              <Label className="flex items-center gap-1 text-xs">
                <Link2 className="h-3 w-3" aria-hidden="true" />
                {ta("tiers.contactUrl")}
              </Label>
              <Input
                value={draft.contact_url}
                onChange={(e) => onChange({ contact_url: e.target.value })}
                placeholder="/kontakt lub mailto:..."
              />
              <p className="mt-1 text-[11px] text-muted-foreground">{ta("tiers.contactUrlHint")}</p>
            </div>
          </div>
        </FieldGroup>

        <FieldGroup icon={Tag} title={ta("tiers.priceNotePl")} accent={rankTone.dot}>
          <label className="flex items-start gap-2 rounded-[6px] border border-border/60 bg-muted/30 px-2.5 py-2">
            <Switch checked={draft.per_seat} onCheckedChange={(v) => onChange({ per_seat: v })} />
            <span className="flex flex-col">
              <span className="text-xs font-medium">{ta("tiers.perSeat")}</span>
              <span className="text-[11px] text-muted-foreground">{ta("tiers.perSeatHint")}</span>
            </span>
          </label>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <LabeledField label={ta("tiers.priceNotePl")}>
              {(field) => (
                <Input
                  {...field}
                  value={draft.price_note_pl}
                  onChange={(e) => onChange({ price_note_pl: e.target.value })}
                  placeholder="2-20 miejsc"
                />
              )}
            </LabeledField>
            <LabeledField label={ta("tiers.priceNoteEn")}>
              {(field) => (
                <Input
                  {...field}
                  value={draft.price_note_en}
                  onChange={(e) => onChange({ price_note_en: e.target.value })}
                  placeholder="2-20 seats"
                />
              )}
            </LabeledField>
          </div>
        </FieldGroup>

        <FieldGroup icon={ListChecks} title="Benefity (PL/EN)" accent={rankTone.dot}>
          <TierBenefitsEditor
            value={draft.benefits}
            onChange={(benefits) => onChange({ benefits })}
          />
        </FieldGroup>

        <div className="pt-1">
          <Button size="sm" className="w-full" disabled={saving} onClick={onSave}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {ta("tiers.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
