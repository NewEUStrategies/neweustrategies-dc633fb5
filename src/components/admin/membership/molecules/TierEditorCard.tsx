// Molekuła: edytor RDZENIA jednej warstwy członkostwa.
//
// Zawartość jest rozbita na TRZY zakładki, żeby edycja mieściła się na jednym
// ekranie i nie wymuszała przewijania całego panelu:
//   Podstawy    nazwy i opisy (do odczytu), ranga, status,
//   Benefity    lista punktów pokazywanych w cenniku (do odczytu),
//   Bramki      przełączniki uprawnień, limity liczbowe, surowy JSON.
//
// MARKETING TYLKO DO ODCZYTU (S1 def. 11). Nazwy, opisy i benefity to obietnica
// na stronie cennika - ich jedynym pisarzem jest `/admin/pricing?tab=tiers`
// (`TIER_MARKETING_COLUMNS`). Ten panel zapisywał je dawniej przy każdej zmianie
// rangi, więc benefit poprawiony w Cenniku wracał do starej wersji po zapisie
// bramek w drugiej karcie. Teraz karta pokazuje je z `LinkedSourceHeader`
// prowadzącym do Cennika, a zapis niesie wyłącznie rdzeń.
//
// Warstwy DOMYŚLNEJ nie da się usunąć: kosz jest wyłączony, a podpowiedź mówi
// dlaczego. Bez warstwy domyślnej nowy użytkownik nie dostałby żadnej.
//
// Karta nie ma własnego stanu treści - szkic i zapis wstrzykuje panel, więc
// „niezapisane zmiany" żyją w jednym miejscu dla wszystkich warstw.
import { useTranslation } from "react-i18next";
import { BadgeCheck, Gift, Save, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";
import { FieldGroupRule } from "@/components/admin/membership/atoms/FieldGroupRule";
import type { TierCoreDraft } from "@/components/admin/membership/tierCoreDraft";
import { TierCapabilitiesPanel } from "@/components/admin/membership/organisms/TierCapabilitiesPanel";
import { LinkedSourceHeader } from "@/components/admin/settings/LinkedSource";
import { parseTierBenefits, type MembershipTierRow } from "@/lib/billing/tiers";

/** Właściciel nazw, opisów i benefitów warstwy (S1 def. 11). */
const MARKETING_SOURCE_HREF = "/admin/pricing?tab=tiers";

const TAB_TRIGGER =
  "h-9 flex-1 gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm";

export function TierEditorCard({
  tier,
  draft,
  saving,
  deleting,
  canSave = true,
  onChange,
  onSave,
  onDelete,
}: {
  /** Wiersz bazowy - źródło pól tylko do odczytu (nazwy, opisy, benefity). */
  tier: MembershipTierRow;
  draft: TierCoreDraft;
  saving: boolean;
  deleting: boolean;
  /** Szkic różni się od bazy - inaczej zapis nie ma czego wysłać. */
  canSave?: boolean;
  onChange: (patch: Partial<TierCoreDraft>) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const set = onChange;
  const benefits = parseTierBenefits(tier.benefits);
  return (
    <article className="flex flex-col overflow-hidden rounded-b-[6px] bg-card">
      <header className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <BadgeCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="truncate font-sans text-sm font-semibold tracking-tight">
            {tier.key}
          </span>
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

      <div className="flex flex-1 flex-col gap-3 px-5 pb-5 pt-4">
        <Tabs defaultValue="basics" className="w-full">
          <TabsList className="flex w-full gap-1 rounded-[6px] border border-border/60 bg-muted/50 p-1">
            <TabsTrigger value="basics" className={TAB_TRIGGER}>
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tm("tierTabs.basics")}</span>
            </TabsTrigger>
            <TabsTrigger value="benefits" className={TAB_TRIGGER}>
              <Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tm("tierTabs.benefits")}</span>
            </TabsTrigger>
            <TabsTrigger value="capabilities" className={TAB_TRIGGER}>
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{tm("tierTabs.capabilities")}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="basics" className="mt-3 space-y-4">
            <FieldGroupRule label={tm("groups.naming")}>
              <LinkedSourceHeader
                sourceLabel={tm("marketingSource.label")}
                sourceHref={MARKETING_SOURCE_HREF}
                sourceValue={`${tier.name_pl} · ${tier.name_en}`}
                hint={tm("marketingSource.hint")}
              />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                <ReadOnlyField label={tm("fields.namePl")} value={tier.name_pl} />
                <ReadOnlyField label={tm("fields.nameEn")} value={tier.name_en} />
                <ReadOnlyField
                  label={tm("fields.descriptionPl")}
                  value={tier.description_pl || tm("readOnly.descriptionEmpty")}
                  wide
                />
                <ReadOnlyField
                  label={tm("fields.descriptionEn")}
                  value={tier.description_en || tm("readOnly.descriptionEmpty")}
                  wide
                />
              </dl>
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
                <label className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-[10px]">
                  <Switch checked={draft.active} onCheckedChange={(v) => set({ active: v })} />
                  {tm("fields.active")}
                </label>
                <label className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-[10px]">
                  <Switch
                    checked={draft.is_default}
                    onCheckedChange={(v) => set({ is_default: v })}
                  />
                  {tm("fields.default")}
                </label>
              </div>
            </FieldGroupRule>
          </TabsContent>

          <TabsContent value="benefits" className="mt-3">
            <FieldGroupRule label={tm("groups.benefits")}>
              <LinkedSourceHeader
                sourceLabel={tm("marketingSource.label")}
                sourceHref={MARKETING_SOURCE_HREF}
                sourceValue={tm("summary.benefits", { count: benefits.length })}
                hint={tm("marketingSource.hint")}
              />
              {benefits.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tm("readOnly.benefitsEmpty")}</p>
              ) : (
                <ol className="space-y-1.5 text-xs">
                  {benefits.map((benefit, index) => (
                    <li
                      key={`${index}-${benefit.pl}`}
                      className="rounded-md border border-border/60 px-2.5 py-1.5"
                    >
                      <span className="font-medium">{benefit.pl}</span>
                      <span className="block text-muted-foreground">{benefit.en}</span>
                    </li>
                  ))}
                </ol>
              )}
            </FieldGroupRule>
          </TabsContent>

          <TabsContent value="capabilities" className="mt-3">
            <FieldGroupRule label={tm("groups.capabilities")}>
              <TierCapabilitiesPanel
                value={draft.features}
                onChange={(features: string) => set({ features })}
              />
            </FieldGroupRule>
          </TabsContent>
        </Tabs>

        <div className="mt-auto flex items-center gap-2 border-t border-border/60 pt-3">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="flex-1 text-[11px] leading-snug text-muted-foreground">{tm("saveHint")}</p>
          <Button size="sm" disabled={saving || !canSave} onClick={onSave}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {tm("save")}
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Pole tylko do odczytu - para `dt`/`dd`, żeby czytnik słyszał etykietę z wartością. */
function ReadOnlyField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-foreground">{value}</dd>
    </div>
  );
}
