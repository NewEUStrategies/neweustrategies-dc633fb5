// Zakładka Analityka - agregaty per kupon + wykres słupkowy TOP10.
// Wykres przez wspólny wrapper EChart (standard analityki w tym repo):
// SSR-safe stub + lazy EChartClient, bez wciągania silnika wykresów do grafu
// SSR i bez dodatkowej zależności (recharts nie jest w package.json).
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import type { EChartsCoreOption } from "echarts/core";
import { EChart } from "@/components/admin/analytics/EChart";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import { Stat } from "@/components/admin/coupons/atoms/Stat";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";

export const Route = createFileRoute("/admin/coupons/analytics")({
  component: AnalyticsPage,
});

/**
 * Kontrakt `b2b_coupons_analytics` (migracja 20260725090200):
 *  - revenue_cents        = przychód NETTO (original_cents - applied_cents),
 *  - discount_cents_total = udzielony RABAT (applied_cents).
 * Wcześniej funkcja zwracała te wyrażenia odwrotnie, więc kafel „Przychód"
 * pokazywał sumę rabatów, a „Rabat łącznie" - przychód.
 */
interface AnalyticsRow {
  coupon_id: string;
  code: string;
  name: string | null;
  redemptions: number;
  revenue_cents: number;
  discount_cents_total: number;
}

function AnalyticsPage() {
  // Słownik modułu kuponów w chunku trasy - patrz komentarz przy ensureI18n
  // w lib/i18n-admin-coupons.ts. Komunikat awarii jest WSPÓLNY z zakładką
  // Realizacji: ten sam kształt, te same klucze, jedna decyzja modułu.
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
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
    queryFn: async (): Promise<AnalyticsRow[]> => {
      const { data, error } = await supabase.rpc("b2b_coupons_analytics", {
        _from: (from ?? new Date(0)).toISOString(),
        _to: (to ?? new Date()).toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as AnalyticsRow[];
    },
  });

  /**
   * AWARIA FUNKCJI AGREGUJĄCEJ NIE MOŻE WYGLĄDAĆ JAK ZAKRES BEZ SPRZEDAŻY.
   * Bez tej gałęzi odmowa uprawnień do `b2b_coupons_analytics`, błąd SQL
   * w funkcji i zerwana sieć dawały ten sam ekran co poprawny odczyt pustego
   * okna: „Brak danych." i cztery kafle zer (w tym „Przychód netto: 0.00").
   * Zera odczytane z awarii to wniosek, że kampania nie przyniosła przychodu -
   * czyli decyzja o wygaszeniu programu podjęta na podstawie błędu odczytu.
   *
   * Kształt komunikatu jest WSPÓLNY z zakładką Realizacji (te same klucze
   * `adminCoupons.loadError.*`), a kafle pokazują wtedy kreski zamiast zer:
   * zero jest twierdzeniem o pieniądzach, kreska mówi „nie wiadomo".
   */
  const failed = q.isError;
  const rows = q.data ?? [];
  const stat = (value: string) => (failed ? "-" : value);
  const totalRedemptions = rows.reduce((s, r) => s + Number(r.redemptions), 0);
  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue_cents), 0);
  const totalDiscount = rows.reduce((s, r) => s + Number(r.discount_cents_total), 0);
  const conversion =
    rows.length > 0
      ? ((rows.filter((r) => Number(r.redemptions) > 0).length / rows.length) * 100).toFixed(1)
      : "0";
  const top10 = rows.slice(0, 10).map((r) => ({
    code: r.code,
    redemptions: Number(r.redemptions),
  }));

  const top10Option = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 8, top: 16, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: top10.map((r) => r.code),
        axisLabel: { rotate: 30, fontSize: 11, overflow: "truncate", width: 110 },
      },
      yAxis: { type: "value", axisLabel: { fontSize: 11 } },
      series: [
        {
          name: L("Realizacje", "Redemptions"),
          type: "bar",
          data: top10.map((r) => r.redemptions),
          barMaxWidth: 36,
          itemStyle: { borderRadius: [6, 6, 0, 0], color: "#2a78d6" },
          label: { show: true, position: "top", fontSize: 10 },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, lang],
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <DatePickerField value={from} onChange={setFrom} label={L("Od", "From")} />
        <DatePickerField value={to} onChange={setTo} label={L("Do", "To")} />
      </div>

      {failed && (
        <div
          role="alert"
          className="rounded-[6px] border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p className="font-medium text-destructive">{t("adminCoupons.loadError.title")}</p>
          <p className="mt-1 text-muted-foreground">{t("adminCoupons.loadError.hint")}</p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={L("Kupony", "Coupons")} value={stat(String(rows.length))} />
        <Stat label={L("Realizacje", "Redemptions")} value={stat(String(totalRedemptions))} />
        <Stat
          label={L("Przychód netto", "Net revenue")}
          value={stat(`${(totalRevenue / 100).toFixed(2)}`)}
        />
        <Stat label={L("Konwersja", "Conversion")} value={stat(`${conversion}%`)} />
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
          ) : failed ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.loadError.placeholder")}
            </p>
          ) : top10.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{L("Brak danych.", "No data.")}</p>
          ) : (
            <EChart option={top10Option} height={320} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {L("Szczegóły per kupon", "Per-coupon detail")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {failed ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.loadError.placeholder")}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">{L("Brak danych.", "No data.")}</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{L("Kod", "Code")}</th>
                    <th className="text-left py-2 pr-3">{L("Realizacje", "Redemptions")}</th>
                    <th className="text-left py-2 pr-3">{L("Przychód netto", "Net revenue")}</th>
                    <th className="text-left py-2 pr-3">{L("Rabat łącznie", "Total discount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.coupon_id} className="border-b border-border/40">
                      <td className="py-3 pr-3">
                        <code className="font-mono font-semibold text-sm">{r.code}</code>
                        {r.name && <div className="text-xs text-muted-foreground">{r.name}</div>}
                      </td>
                      <td className="py-3 pr-3">{r.redemptions}</td>
                      <td className="py-3 pr-3">{(Number(r.revenue_cents) / 100).toFixed(2)}</td>
                      <td className="py-3 pr-3 text-emerald-600">
                        -{(Number(r.discount_cents_total) / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-xs text-muted-foreground mt-3">
                {L("Łączny rabat udzielony", "Total discount granted")}:{" "}
                <span className="font-semibold text-foreground">
                  {(totalDiscount / 100).toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
