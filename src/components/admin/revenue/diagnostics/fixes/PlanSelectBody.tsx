// Treść naprawy `access_rule_plan` w trybie „przypisz": plan, który da się
// dziś kupić (aktywny i w sprzedaży). Tryb „usuń wycofane" nie potrzebuje
// wyboru - treść wtedy nic nie rysuje.
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { FormSelect } from "@/components/atoms/FormSelect";
import { Label } from "@/components/ui/label";
import type { AccessRulePayload, QuickFixBodyProps } from "@/lib/admin/revenue/quickFixes";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";

export default function PlanSelectBody({
  facts,
  value,
  onChange,
  disabled,
}: QuickFixBodyProps<AccessRulePayload>) {
  ensureI18n();
  const { t } = useTranslation();
  const id = useId();
  if (value.mode !== "assign") return null;
  const plans = (facts.areas.catalog?.plans ?? []).filter((p) => p.active && p.forSale);
  if (plans.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">{t("adminRevenue.fix.body.noPlans")}</p>;
  }
  const options = plans.map((plan) => ({
    value: plan.id,
    label: [plan.tierKey ?? "-", plan.interval, plan.currency].join(" · "),
  }));

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("adminRevenue.fix.body.plan")}</Label>
      <FormSelect
        id={id}
        value={value.planId ?? ""}
        onValueChange={(next) => onChange({ ...value, planId: next === "" ? null : next })}
        options={options}
        placeholder={t("adminRevenue.fix.body.planPlaceholder")}
        disabled={disabled}
      />
    </div>
  );
}
