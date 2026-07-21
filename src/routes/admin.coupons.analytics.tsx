// Zakładka Analityka - agregaty per kupon + wykres słupkowy TOP10.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";

export const Route = createFileRoute("/admin/coupons/analytics")({
  component: AnalyticsPage,
});

interface AnalyticsRow {
  coupon_id: string;
  code: string;
  name: string | null;
  redemptions: number;
  revenue_cents: number;
  discount_cents_total: number;
}

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
    queryFn: async (): Promise<AnalyticsRow[]> => {
      const { data, error } = await supabase.rpc("b2b_coupons_analytics", {
        _from: (from ?? new Date(0)).toISOString(),
        _to: (to ?? new Date()).toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as AnalyticsRow[];
    },
  });

  const rows = q.data ?? [];
  const totalRedemptions = rows.reduce((s, r) => s + Number(r.redemptions), 0);
  const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue_cents), 0);
  const totalDiscount = rows.reduce((s, r) => s + Number(r.discount_cents_total), 0);
  const conversion =
    rows.length > 0 ? ((rows.filter((r) => Number(r.redemptions) > 0).length / rows.length) * 100).toFixed(1) : "0";
  const top10 = rows.slice(0, 10).map((r) => ({
    code: r.code,
    redemptions: Number(r.redemptions),
    revenue: Number(r.revenue_cents) / 100,
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <DatePickerField value={from} onChange={setFrom} label={L("Od", "From")} />
        <DatePickerField value={to} onChange={setTo} label={L("Do", "To")} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label={L("Kupony", "Coupons")} value={String(rows.length)} />
        <Stat label={L("Realizacje", "Redemptions")} value={String(totalRedemptions)} />
        <Stat
          label={L("Przychód", "Revenue")}
          value={`${(totalRevenue / 100).toFixed(2)}`}
        />
        <Stat label={L("Konwersja", "Conversion")} value={`${conversion}%`} />
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
            <p className="text-sm text-muted-foreground py-6">
              {L("Brak danych.", "No data.")}
            </p>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="code"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    angle={-30}
                    textAnchor="end"
                    height={70}
                  />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                    }}
                  />
                  <Bar dataKey="redemptions" fill="hsl(var(--brand))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
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
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              {L("Brak danych.", "No data.")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{L("Kod", "Code")}</th>
                    <th className="text-left py-2 pr-3">{L("Realizacje", "Redemptions")}</th>
                    <th className="text-left py-2 pr-3">{L("Przychód", "Revenue")}</th>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1">{value}</div>
      </CardContent>
    </Card>
  );
}
