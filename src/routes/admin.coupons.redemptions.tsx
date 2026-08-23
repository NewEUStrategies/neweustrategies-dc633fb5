// Zakładka Realizacje - historia użyć kuponów + CRM/subskrypcja context.
//
// Trasa jest KOMPOZYCJĄ: zakres dat liczy `@/lib/billing/couponRedemptionsRange`,
// arkusz składa `couponCsv`, kwoty rozlicza `couponMoney`, widok stoi w
// `@/components/admin/coupons/**`. Tutaj zostaje jedno zapytanie i pobranie pliku.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { CouponStatTile } from "@/components/admin/coupons/atoms/CouponStatTile";
import { RedemptionsFilterBar } from "@/components/admin/coupons/molecules/RedemptionsFilterBar";
import {
  RedemptionsTable,
  type RedemptionTableRow,
} from "@/components/admin/coupons/organisms/RedemptionsTable";
import { sumCouponTotals } from "@/lib/billing/couponMoney";
import { redemptionsCsv, redemptionsCsvFileName } from "@/lib/billing/couponCsv";
import { redemptionsRange } from "@/lib/billing/couponRedemptionsRange";

export const Route = createFileRoute("/admin/coupons/redemptions")({
  component: RedemptionsPage,
});

interface RedRow extends RedemptionTableRow {
  coupon_id: string;
  order_id: string | null;
}

function RedemptionsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const [from, setFrom] = useState<Date | undefined>(
    () => new Date(Date.now() - 30 * 24 * 3600 * 1000),
  );
  const [to, setTo] = useState<Date | undefined>(() => new Date());

  const q = useQuery({
    queryKey: [
      "admin",
      "b2b-coupon-redemptions",
      from?.toISOString() ?? null,
      to?.toISOString() ?? null,
    ],
    queryFn: async (): Promise<RedRow[]> => {
      let qy = supabase
        .from("b2b_coupon_redemptions")
        .select(
          "id, coupon_id, user_id, order_id, applied_cents, original_cents, currency, created_at, effects_applied_at, b2b_coupons(code, name, grants_tier_key)",
        )
        .order("created_at", { ascending: false })
        .limit(500);
      const range = redemptionsRange(from, to);
      if (range.gte) qy = qy.gte("created_at", range.gte);
      if (range.lte) qy = qy.lte("created_at", range.lte);
      const { data, error } = await qy;
      if (error) throw error;
      return (data ?? []) as unknown as RedRow[];
    },
  });

  const rows = useMemo<RedRow[]>(() => q.data ?? [], [q.data]);
  const totals = useMemo(() => sumCouponTotals(rows), [rows]);

  const exportCsv = () => {
    const blob = new Blob([redemptionsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = redemptionsCsvFileName(new Date());
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <RedemptionsFilterBar
        from={from}
        to={to}
        onFrom={setFrom}
        onTo={setTo}
        onExport={exportCsv}
        fromLabel={L("Od", "From")}
        toLabel={L("Do", "To")}
        exportLabel={L("Eksport CSV", "Export CSV")}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <CouponStatTile label={L("Realizacje", "Redemptions")} value={String(totals.count)} />
        <CouponStatTile
          label={L("Przychód netto", "Net revenue")}
          value={`${(totals.revenueCents / 100).toFixed(2)}`}
        />
        <CouponStatTile
          label={L("Rabat udzielony", "Discount granted")}
          value={`${(totals.discountCents / 100).toFixed(2)}`}
        />
      </div>

      <RedemptionsTable
        rows={rows}
        loading={q.isLoading}
        lang={lang}
        labels={{
          title: L("Historia realizacji", "Redemption log"),
          loading: L("Wczytywanie…", "Loading…"),
          empty: L("Brak realizacji w zakresie.", "No redemptions in range."),
          date: L("Data", "Date"),
          code: L("Kod", "Code"),
          user: L("Użytkownik", "User"),
          beforeDiscount: L("Przed rabatem", "Before discount"),
          discount: L("Rabat", "Discount"),
          paid: L("Zapłacono", "Paid"),
          plan: L("Plan", "Plan"),
          granted: L("nadano", "granted"),
          awaiting: L("czeka na płatność", "awaiting payment"),
        }}
      />
    </div>
  );
}
