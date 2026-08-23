// Molekuła: ograniczenie kuponu do wybranych planów dostępu.
//
// PUSTA LISTA MA DWA ZNACZENIA, KTÓRYCH PANEL NIE ROZRÓŻNIA: „nie ma planów”
// i „nie udało się ich odczytać” pokazują ten sam napis. Molekuła dostaje
// gotową listę, więc rozstrzygnięcie należy do organizmu - i dziś go nie ma.
//
// PRZENIESIONE ZNAK W ZNAK: zaznaczenie doklejane jest bez sprawdzania, czy
// identyfikator już jest na liście (`[...prev, id]`), więc dwukrotne zgłoszenie
// zaznaczenia potrafi zdublować id w ładunku. Zgłasza to test.
import { useTranslation } from "react-i18next";
// SŁOWNIK: klucze `adminCoupons.*` mieszkają w nakładce, którą trzeba jawnie
// dociągnąć - bez tego i18next zwraca sam klucz i na ekranie staje napis
// „adminCoupons.code”. Ani parytet, ani typy tego nie widzą (inwariant
// `check:i18n-overlay-imports`), dlatego wołanie stoi w tym pliku.
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import type { LocaleCode } from "@/lib/i18n/pickLocalized";

export interface CouponPlanOption {
  id: string;
  name_pl: string | null;
  name_en: string | null;
  active: boolean;
}

interface CouponPlanRestrictionListProps {
  plans: CouponPlanOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
  lang: LocaleCode;
}

export function CouponPlanRestrictionList({
  plans,
  selected,
  onToggle,
  lang,
}: CouponPlanRestrictionListProps) {
  ensureAdminCouponsI18n();
  const { t } = useTranslation();
  return (
    <div>
      <Label>{t("adminCoupons.restrictPlansOptional")}</Label>
      <div className="rounded-[6px] border border-border/60 p-2 max-h-40 overflow-y-auto space-y-1">
        {plans.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("adminCoupons.plansAvailable")}</p>
        )}
        {plans.map((p) => {
          const on = selected.includes(p.id);
          return (
            <label
              key={p.id}
              className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-1.5 py-1"
            >
              <Checkbox checked={on} onCheckedChange={(v) => onToggle(p.id, Boolean(v))} />
              <span className={p.active ? "" : "text-muted-foreground line-through"}>
                {pickLocalized(p, "name", lang)}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
