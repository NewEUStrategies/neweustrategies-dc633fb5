// Zakładka Realizacje - historia użyć kuponów + CRM/subskrypcja context.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import { couponPaidCents, sumCouponTotals } from "@/lib/billing/couponMoney";
import { Stat } from "@/components/admin/coupons/atoms/Stat";

export const Route = createFileRoute("/admin/coupons/redemptions")({
  component: RedemptionsPage,
});

interface RedRow {
  id: string;
  coupon_id: string;
  user_id: string | null;
  order_id: string | null;
  /**
   * RABAT zastosowany przy realizacji - NIE kwota zapłacona (pisarzem jest
   * `redeem_b2b_coupon(_applied_cents := couponDiscountCents)`).
   * Niezmiennik i obliczenia: `@/lib/billing/couponMoney`.
   */
  applied_cents: number;
  original_cents: number;
  currency: string;
  created_at: string;
  /**
   * Znacznik zastosowania efektów kuponu (warstwa + CRM) - ustawiany przez
   * `apply_b2b_coupon_effects` PO potwierdzonej płatności. NULL przy kuponie
   * nadającym plan oznacza, że zamówienie nie zostało (jeszcze) opłacone.
   */
  effects_applied_at: string | null;
  b2b_coupons: { code: string; name: string | null; grants_tier_key: string | null } | null;
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
      if (from) qy = qy.gte("created_at", from.toISOString());
      if (to) qy = qy.lte("created_at", to.toISOString());
      const { data, error } = await qy;
      if (error) throw error;
      return (data ?? []) as unknown as RedRow[];
    },
  });

  const rows = useMemo<RedRow[]>(() => q.data ?? [], [q.data]);
  const totals = useMemo(() => sumCouponTotals(rows), [rows]);

  const exportCsv = () => {
    // Nagłówek nazywa kolumny po znaczeniu: `discount` to applied_cents,
    // `paid` to original - applied. Poprzedni „applied" sugerował kwotę
    // zapłaconą i utrwalał inwersję w każdym wyeksportowanym arkuszu.
    const header = "date;code;user_id;order_id;original;discount;paid;currency";
    const body = rows
      .map(
        (r) =>
          `${r.created_at};${r.b2b_coupons?.code ?? ""};${r.user_id ?? ""};${r.order_id ?? ""};${
            r.original_cents / 100
          };${r.applied_cents / 100};${couponPaidCents(r) / 100};${r.currency}`,
      )
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `coupon-redemptions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="grid grid-cols-2 gap-3 w-full max-w-md">
          <DatePickerField value={from} onChange={setFrom} label={L("Od", "From")} />
          <DatePickerField value={to} onChange={setTo} label={L("Do", "To")} />
        </div>
        <Button variant="outline" className="h-10 rounded-[6px]" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-2" />
          {L("Eksport CSV", "Export CSV")}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label={L("Realizacje", "Redemptions")} value={String(totals.count)} />
        <Stat
          label={L("Przychód netto", "Net revenue")}
          value={`${(totals.revenueCents / 100).toFixed(2)}`}
        />
        <Stat
          label={L("Rabat udzielony", "Discount granted")}
          value={`${(totals.discountCents / 100).toFixed(2)}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L("Historia realizacji", "Redemption log")}</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {L("Wczytywanie…", "Loading…")}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              {L("Brak realizacji w zakresie.", "No redemptions in range.")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{L("Data", "Date")}</th>
                    <th className="text-left py-2 pr-3">{L("Kod", "Code")}</th>
                    <th className="text-left py-2 pr-3">{L("Użytkownik", "User")}</th>
                    <th className="text-left py-2 pr-3">{L("Przed rabatem", "Before discount")}</th>
                    <th className="text-left py-2 pr-3">{L("Rabat", "Discount")}</th>
                    <th className="text-left py-2 pr-3">{L("Zapłacono", "Paid")}</th>
                    <th className="text-left py-2 pr-3">{L("Plan", "Plan")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="py-3 pr-3 text-xs">
                        {new Date(r.created_at).toLocaleString(lang)}
                      </td>
                      <td className="py-3 pr-3">
                        <code className="font-mono font-semibold text-sm">
                          {r.b2b_coupons?.code ?? "-"}
                        </code>
                        {r.b2b_coupons?.name && (
                          <div className="text-xs text-muted-foreground">{r.b2b_coupons.name}</div>
                        )}
                      </td>
                      <td className="py-3 pr-3 text-xs font-mono">
                        {r.user_id ? r.user_id.slice(0, 8) : "-"}
                      </td>
                      <td className="py-3 pr-3 text-muted-foreground">
                        {(r.original_cents / 100).toFixed(2)} {r.currency}
                      </td>
                      <td className="py-3 pr-3 text-emerald-600">
                        -{(r.applied_cents / 100).toFixed(2)} {r.currency}
                      </td>
                      <td className="py-3 pr-3 font-medium">
                        {(couponPaidCents(r) / 100).toFixed(2)} {r.currency}
                      </td>
                      <td className="py-3 pr-3">
                        {r.b2b_coupons?.grants_tier_key ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline">{r.b2b_coupons.grants_tier_key}</Badge>
                            {r.effects_applied_at ? (
                              <Badge
                                variant="secondary"
                                title={new Date(r.effects_applied_at).toLocaleString(lang)}
                              >
                                {L("nadano", "granted")}
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="text-amber-600 border-amber-500/50"
                              >
                                {L("czeka na płatność", "awaiting payment")}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
