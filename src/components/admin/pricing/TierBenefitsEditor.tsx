// Edytor benefitów warstwy - od hubu S1 WYŁĄCZNIE w panelu Cennik (właściciel
// kolumny `benefits`, `syncManifest.ts`; Członkostwo pokazuje je do odczytu):
// para PL/EN + opcjonalne rozwinięcie (detail_*), nagłówek grupy (group_*)
// w stylu NYT/FT i klucz uprawnienia (`capability_key`, P20). Zapis idzie
// przez serializeTierBenefits z lib/billing/tiers - żadne pole nie ginie.
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowDown, ArrowUp, ChevronDown, Eye, Plus, X } from "lucide-react";
import { FormSelect, type FormSelectOption } from "@/components/atoms/FormSelect";
import { Button } from "@/components/ui/button";
import { BenefitPreviewDialog } from "@/components/admin/membership/molecules/BenefitPreviewDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TIER_CAPABILITIES } from "@/lib/billing/capabilities";
import type { TierBenefit } from "@/lib/billing/tiers";
import { ensureI18n as ensureAdminMembershipI18n } from "@/lib/i18n-admin-membership";
import { ensureI18n as ensureAdminPricingI18n } from "@/lib/i18n-admin-pricing";
import { shiftExpandedAfterRemove, swapExpanded, type ExpandedRows } from "@/lib/ui/expandedRows";

/** „Bez powiązania” - Radix Select nie przyjmuje pustego napisu jako wartości. */
const NO_CAPABILITY = "__none__";

function hasExtras(benefit: TierBenefit): boolean {
  return Boolean(
    (benefit.detail_pl ?? "").trim() ||
    (benefit.detail_en ?? "").trim() ||
    (benefit.group_pl ?? "").trim() ||
    (benefit.group_en ?? "").trim() ||
    (benefit.capability_key ?? "").trim(),
  );
}

/**
 * Opcje klucza uprawnienia: rejestr `capabilities.ts` z etykietą panelu
 * Członkostwa i znacznikiem „egzekwowane / deklarowane” - redakcja od razu
 * widzi, że wiąże obietnicę z flagą bez realnej bramki. Klucz spoza rejestru
 * (zapis z innej wersji panelu) zostaje na liście pod surową nazwą, inaczej
 * pole pokazałoby pustkę, choć powiązanie w bazie istnieje.
 */
function capabilityOptions(t: TFunction, current: string | undefined): FormSelectOption[] {
  const options: FormSelectOption[] = [
    { value: NO_CAPABILITY, label: t("adminPricing.benefits.capabilityNone") },
    ...TIER_CAPABILITIES.map((meta) => ({
      value: meta.key,
      label: `${t(`adminMembership.capabilities.labels.${meta.key}`)} · ${t(
        meta.enforced
          ? "adminMembership.capabilities.enforcedBadge"
          : "adminMembership.capabilities.decorativeBadge",
      )}`,
    })),
  ];
  if (current && !TIER_CAPABILITIES.some((meta) => meta.key === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

/** Benefit z nowym kluczem uprawnienia; „bez powiązania” usuwa pole z obiektu. */
function withCapability(benefit: TierBenefit, value: string): TierBenefit {
  const { capability_key: _previous, ...rest } = benefit;
  return value === NO_CAPABILITY ? rest : { ...rest, capability_key: value };
}

export function TierBenefitsEditor({
  value,
  onChange,
}: {
  value: TierBenefit[];
  onChange: (next: TierBenefit[]) => void;
}) {
  ensureAdminPricingI18n();
  // Etykiety uprawnień są w słowniku Członkostwa (jedno źródło nazw flag).
  ensureAdminMembershipI18n();
  const { t } = useTranslation();
  const tb = (k: string) => t(`adminPricing.benefits.${k}`);
  // Kilka edytorów na jednej stronie (karta per warstwa) - identyfikatory pól
  // muszą być unikalne, żeby etykieta wskazywała własne pole.
  const fieldId = useId();
  // Ręcznie rozwinięte wiersze; wiersze z wypełnionymi polami dodatkowymi
  // są otwarte zawsze (nic edytowalnego nie znika z oczu).
  const [expanded, setExpanded] = useState<ExpandedRows>({});
  // Podgląd „jak to wygląda w cenniku" - indeks benefitu albo null.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const update = (i: number, patch: Partial<TierBenefit>) => {
    onChange(value.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  };
  const remove = (i: number) => {
    // Stan rozwinięcia jest kluczowany POZYCJĄ, więc przy usuwaniu wiersza
    // trzeba go przesunąć razem z listą - inaczej rozwinięcie „zostaje" przy
    // numerze i odsłania cudzy wiersz.
    setExpanded((state) => shiftExpandedAfterRemove(state, i));
    onChange(value.filter((_, idx) => idx !== i));
  };
  // Wołane wyłącznie z przycisków wyłączanych na krawędziach listy (pierwszy
  // wiersz w górę, ostatni w dół) - `j` zawsze leży w zakresie.
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    // Rozwinięcie idzie za wierszem, nie za pozycją.
    setExpanded((state) => swapExpanded(state, i, j));
    onChange(next);
  };
  const add = () => onChange([...value, { pl: "", en: "" }]);

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Label className="text-[10px] font-medium">{tb("heading")}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[10px]"
          onClick={add}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {tb("add")}
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/60 px-3 py-4 text-center text-[10px] text-muted-foreground">
          {tb("empty")}
        </p>
      ) : (
        <ol className="space-y-2">
          {value.map((benefit, i) => {
            const open = expanded[i] ?? hasExtras(benefit);
            return (
              <li key={i} className="rounded-md border border-border/60 bg-muted/30 p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium text-muted-foreground">#{i + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setPreviewIndex(i)}
                      aria-label={`${tb("preview")} #${i + 1}`}
                      title={tb("preview")}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => move(i, -1)}
                      disabled={i === 0}
                      aria-label={`${tb("moveUp")} #${i + 1}`}
                      title={tb("moveUp")}
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => move(i, 1)}
                      disabled={i === value.length - 1}
                      aria-label={`${tb("moveDown")} #${i + 1}`}
                      title={tb("moveDown")}
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(i)}
                      aria-label={`${tb("remove")} #${i + 1}`}
                      title={tb("remove")}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-1.5">
                  {/* Etykiety dostępne, nie same podpowiedzi w polu: `placeholder`
                      znika po pierwszym znaku, więc czytnik ekranu (i osoba
                      wracająca do wypełnionego formularza) nie wie, które pole
                      jest którym językiem. Numer wiersza w etykiecie odróżnia
                      pola między benefitami. */}
                  <Input
                    aria-label={`${tb("labelPl")} #${i + 1}`}
                    placeholder="PL"
                    value={benefit.pl}
                    onChange={(e) => update(i, { pl: e.target.value })}
                    className="h-8 text-sm"
                  />
                  <Input
                    aria-label={`${tb("labelEn")} #${i + 1}`}
                    placeholder="EN"
                    value={benefit.en}
                    onChange={(e) => update(i, { en: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <button
                  type="button"
                  className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setExpanded((s) => ({ ...s, [i]: !open }))}
                  aria-expanded={open}
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                    aria-hidden="true"
                  />
                  {tb("more")}
                </button>
                {open && (
                  <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    <Input
                      aria-label={`${tb("detailPl")} #${i + 1}`}
                      placeholder={tb("detailPl")}
                      value={benefit.detail_pl ?? ""}
                      onChange={(e) => update(i, { detail_pl: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      aria-label={`${tb("detailEn")} #${i + 1}`}
                      placeholder={tb("detailEn")}
                      value={benefit.detail_en ?? ""}
                      onChange={(e) => update(i, { detail_en: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      aria-label={`${tb("groupPl")} #${i + 1}`}
                      placeholder={tb("groupPl")}
                      value={benefit.group_pl ?? ""}
                      onChange={(e) => update(i, { group_pl: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <Input
                      aria-label={`${tb("groupEn")} #${i + 1}`}
                      placeholder={tb("groupEn")}
                      value={benefit.group_en ?? ""}
                      onChange={(e) => update(i, { group_en: e.target.value })}
                      className="h-8 text-sm"
                    />
                    <p className="text-[10px] leading-snug text-muted-foreground sm:col-span-2">
                      {tb("groupHint")}
                    </p>
                    <div className="sm:col-span-2">
                      <Label
                        htmlFor={`${fieldId}-capability-${i}`}
                        className="text-[10px] font-medium text-muted-foreground"
                      >
                        {tb("capability")}
                      </Label>
                      <FormSelect
                        id={`${fieldId}-capability-${i}`}
                        aria-label={`${tb("capability")} #${i + 1}`}
                        value={benefit.capability_key || NO_CAPABILITY}
                        onValueChange={(next) =>
                          onChange(value.map((b, idx) => (idx === i ? withCapability(b, next) : b)))
                        }
                        options={capabilityOptions(t, benefit.capability_key)}
                        className="mt-1 h-8 text-sm"
                      />
                      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                        {tb("capabilityHint")}
                      </p>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <BenefitPreviewDialog
        benefit={previewIndex === null ? null : (value[previewIndex] ?? null)}
        open={previewIndex !== null}
        onOpenChange={(next) => {
          if (!next) setPreviewIndex(null);
        }}
      />
    </div>
  );
}
