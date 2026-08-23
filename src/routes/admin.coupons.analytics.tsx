// Zakładka Analityka - agregaty per kupon + wykres słupkowy TOP10.
// Wykres przez wspólny wrapper EChart (standard analityki w tym repo):
// SSR-safe stub + lazy EChartClient, bez wciągania silnika wykresów do grafu
// SSR i bez dodatkowej zależności (recharts nie jest w package.json).
//
// Trasa jest KOMPOZYCJĄ: wszystkie sumy, konwersja, TOP 10 i opcja wykresu
// mieszkają w `@/lib/billing/couponAnalyticsView` i mają tam tabelaryczny test;
// tutaj zostaje jedno wywołanie RPC i sklejenie z widokiem.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { EChart } from "@/components/admin/analytics/EChart";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CouponStatTile } from "@/components/admin/coupons/atoms/CouponStatTile";
import { CouponDateRangeFields } from "@/components/admin/coupons/molecules/CouponDateRangeFields";
import { CouponAnalyticsTable } from "@/components/admin/coupons/organisms/CouponAnalyticsTable";
import {
  summarizeCouponAnalytics,
  top10BarOption,
  top10ByRedemptions,
  type CouponAnalyticsRow,
} from "@/lib/billing/couponAnalyticsView";

export const Route = createFileRoute("/admin/coupons/analytics")({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);

  const [from, setFrom] = useState<Date | undefined>(
    () => new Date(Date.now() - 90 * 24 * 3600 * 1000),
  );
  const [to, setTo] = useState<Date | undefined>(() => new Date());

  const q = useQuery({
    queryKey: [
      "admin",
      "b2b-coupons-analytics",
      from?.toISOString() ?? null,
      to?.toISOString() ?? null,
    ],
    queryFn: async (): Promise<CouponAnalyticsRow[]> => {
      const { data, error } = await supabase.rpc("b2b_coupons_analytics", {
        _from: (from ?? new Date(0)).toISOString(),
        _to: (to ?? new Date()).toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as CouponAnalyticsRow[];
    },
  });

  const rows = q.data ?? [];
  const summary = summarizeCouponAnalytics(rows);
  const top10 = top10ByRedemptions(rows);

  const top10Option = useMemo(
    () => top10BarOption(top10ByRedemptions(rows), L("Realizacje", "Redemptions")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, lang],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <CouponDateRangeFields
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          fromLabel={L("Od", "From")}
          toLabel={L("Do", "To")}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <CouponStatTile label={L("Kupony", "Coupons")} value={String(summary.coupons)} />
        <CouponStatTile
          label={L("Realizacje", "Redemptions")}
          value={String(summary.totalRedemptions)}
        />
        <CouponStatTile
          label={L("Przychód netto", "Net revenue")}
          value={`${(summary.totalRevenueCents / 100).toFixed(2)}`}
        />
        <CouponStatTile label={L("Konwersja", "Conversion")} value={`${summary.conversion}%`} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L("TOP 10 kuponów", "TOP 10 coupons")}</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("Wczytywanie…", "Loading…")}
            </div>
          ) : top10.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{L("Brak danych.", "No data.")}</p>
          ) : (
            <EChart option={top10Option} height={320} />
          )}
        </CardContent>
      </Card>

      <CouponAnalyticsTable
        rows={rows}
        totalDiscountCents={summary.totalDiscountCents}
        labels={{
          title: L("Szczegóły per kupon", "Per-coupon detail"),
          empty: L("Brak danych.", "No data."),
          code: L("Kod", "Code"),
          redemptions: L("Realizacje", "Redemptions"),
          netRevenue: L("Przychód netto", "Net revenue"),
          totalDiscount: L("Rabat łącznie", "Total discount"),
          totalDiscountGranted: L("Łączny rabat udzielony", "Total discount granted"),
        }}
      />
    </div>
  );
}
