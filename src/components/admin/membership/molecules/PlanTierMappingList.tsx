// Molekuła: mapowanie planu sprzedażowego na warstwę członkostwa.
//
// Najkrótsza droga między tym, co klient kupuje, a tym, co dostaje:
// `access_plans.tier_key`. Plan bez warstwy sprzedaje się normalnie, ale nie
// otwiera żadnych bramek - dlatego wybór „bez warstwy" jest tu jawną pozycją
// listy, a nie pustym polem, i dlatego zapis idzie natychmiast po wybraniu
// (bez przycisku „zapisz", który można przeoczyć).
//
// Obok ceny w walucie planu pokazujemy PRZELICZENIE na EUR dla wersji
// angielskiej - orientacyjne, liczone tą samą funkcją co strona publiczna.
import { useTranslation } from "react-i18next";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { convertToDisplayCurrency } from "@/lib/billing/displayCurrency";
import type { AccessPlan } from "@/lib/billing/types";
import { planName } from "@/lib/billing/types";
import type { MembershipTierRow } from "@/lib/billing/tiers";

export function PlanTierMappingList({
  plans,
  tierOptions,
  lang,
  saving,
  onAssign,
}: {
  plans: AccessPlan[];
  tierOptions: MembershipTierRow[];
  lang: "pl" | "en";
  saving: boolean;
  onAssign: (planId: string, tierKey: string | null) => void;
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  return (
    <div className="space-y-2">
      {plans.map((plan) => (
        <div
          key={plan.id}
          className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
        >
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{planName(plan, lang)}</div>
            <div className="text-xs text-muted-foreground">
              {(plan.price_cents / 100).toFixed(2)} {plan.currency} / {plan.interval}
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
          <Select
            value={plan.tier_key ?? "none"}
            onValueChange={(v) => onAssign(plan.id, v === "none" ? null : v)}
            disabled={saving}
          >
            <SelectTrigger className="w-44 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{tm("mapping.noTier")}</SelectItem>
              {tierOptions.map((tier) => (
                <SelectItem key={tier.key} value={tier.key}>
                  {tier.key} ({lang === "pl" ? tier.name_pl : tier.name_en})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
