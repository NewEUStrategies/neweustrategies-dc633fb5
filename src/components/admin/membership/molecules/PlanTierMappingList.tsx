// Molekuła: mapowanie planu sprzedażowego na warstwę członkostwa.
//
// Najkrótsza droga między tym, co klient kupuje, a tym, co dostaje:
// `access_plans.tier_key`. Plan bez warstwy sprzedaje się normalnie, ale nie
// otwiera żadnych bramek - dlatego wybór „bez warstwy" jest tu jawną pozycją
// listy, a nie pustym polem, i dlatego zapis idzie natychmiast po wybraniu
// (bez przycisku „zapisz", który można przeoczyć).
//
// WSZYSTKIE PLANY, NIE TYLKO AKTYWNE (S1). Lista czytała dawniej wyłącznie
// plany aktywne, a plan wycofany ze sprzedaży albo nieaktywny wciąż ma
// subskrybentów, którym warstwa nadaje dostęp - jego przypięcia nie dało się
// ani zobaczyć, ani poprawić. Stan planu stoi teraz przy nazwie.
//
// Obok ceny w walucie planu pokazujemy PRZELICZENIE na EUR dla wersji
// angielskiej - orientacyjne, liczone tą samą funkcją co strona publiczna.
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { FormSelect } from "@/components/atoms/FormSelect";
import { convertToDisplayCurrency } from "@/lib/billing/displayCurrency";
import type { AccessPlanRow } from "@/lib/billing/planQueries";
import { planName } from "@/lib/billing/types";
import type { MembershipTierRow } from "@/lib/billing/tiers";
import { ensureI18n as ensurePaywallSyncI18n } from "@/lib/i18n-admin-paywall-sync";

/**
 * Pola planu, które lista pokazuje - podzbiór wiersza z `adminPlansAllQueryOptions`
 * (`AccessPlanRow`) zgodny też z `AccessPlan` z warstwy rozliczeń (szerszy enum
 * cyklu, `for_sale` z domyślnym `true` w bazie).
 */
export interface MappingPlan {
  id: AccessPlanRow["id"];
  name_pl: string;
  name_en: string;
  price_cents: number;
  currency: string;
  interval: string;
  tier_key: string | null;
  active: boolean;
  for_sale?: boolean;
}

/** Wartość listy dla „bez warstwy" - `tier_key` nie przyjmuje pustego napisu. */
const NO_TIER = "none";

export function PlanTierMappingList({
  plans,
  tierOptions,
  lang,
  saving,
  onAssign,
}: {
  plans: MappingPlan[];
  tierOptions: MembershipTierRow[];
  lang: "pl" | "en";
  saving: boolean;
  onAssign: (planId: string, tierKey: string | null) => void;
}) {
  // Cykl i stan planu mówią słowami paywalla - jeden słownik dla obu ekranów.
  ensurePaywallSyncI18n();
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const options = [
    { value: NO_TIER, label: tm("mapping.noTier") },
    ...tierOptions.map((tier) => ({
      value: tier.key,
      label: `${tier.key} (${lang === "pl" ? tier.name_pl : tier.name_en})`,
    })),
  ];
  return (
    <div className="space-y-2">
      {plans.map((plan) => {
        const name = planName(plan, lang);
        return (
          <div
            key={plan.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium">{name}</span>
                {!plan.active ? (
                  <Badge variant="outline" className="rounded-[6px] text-[10px]">
                    {t("adminPaywall.plans.inactive")}
                  </Badge>
                ) : plan.for_sale === false ? (
                  <Badge variant="outline" className="rounded-[6px] text-[10px]">
                    {t("adminPaywall.plans.withdrawn")}
                  </Badge>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {(plan.price_cents / 100).toFixed(2)} {plan.currency} /{" "}
                {t(`adminPaywall.interval.${plan.interval}`, { defaultValue: plan.interval })}
                {plan.currency.toUpperCase() === "PLN" && (
                  <span className="ml-2 text-[11px] text-muted-foreground/80">
                    · EN:{" "}
                    {(
                      convertToDisplayCurrency(plan.price_cents, plan.currency, "EUR").cents / 100
                    ).toFixed(2)}{" "}
                    EUR
                  </span>
                )}
              </div>
            </div>
            <FormSelect
              aria-label={tm("mapping.planLabel", { name })}
              className="w-44 shrink-0"
              value={plan.tier_key ?? NO_TIER}
              onValueChange={(v) => onAssign(plan.id, v === NO_TIER ? null : v)}
              disabled={saving}
              options={options}
            />
          </div>
        );
      })}
    </div>
  );
}
