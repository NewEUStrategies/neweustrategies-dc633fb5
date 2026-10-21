// Treść naprawy `plan_tier`: wybór warstwy, do której ma trafić plan bez
// warstwy. Nazwy warstw z tego samego wpisu cache co Członkostwo i Cennik
// (`adminMembershipTiersQueryOptions`) - fakty diagnostyki niosą wyłącznie
// klucze. Leniwy chunk (`QuickFixSpec.body`), ładowany po otwarciu dialogu.
import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { FormSelect } from "@/components/atoms/FormSelect";
import { adminMembershipTiersQueryOptions } from "@/components/admin/membership/membershipQueries";
import { Label } from "@/components/ui/label";
import type { PlanTierPayload, QuickFixBodyProps } from "@/lib/admin/revenue/quickFixes";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";

export default function TierSelectBody({
  facts,
  value,
  onChange,
  disabled,
}: QuickFixBodyProps<PlanTierPayload>) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const id = useId();
  const rows = useQuery(adminMembershipTiersQueryOptions());
  const english = i18n.language.startsWith("en");
  const options = (facts.areas.catalog?.tiers ?? [])
    .filter((tier) => tier.active)
    .map((tier) => {
      const row = rows.data?.find((r) => r.key === tier.key);
      const name = row ? (english ? row.name_en : row.name_pl) : "";
      return { value: tier.key, label: name ? `${name} (${tier.key})` : tier.key };
    });

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{t("adminRevenue.fix.body.tier")}</Label>
      <FormSelect
        id={id}
        value={value.tierKey ?? ""}
        onValueChange={(next) => onChange({ ...value, tierKey: next === "" ? null : next })}
        options={options}
        placeholder={t("adminRevenue.fix.body.tierPlaceholder")}
        disabled={disabled}
      />
    </div>
  );
}
