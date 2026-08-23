// Organizm: tabela „Szczegóły per kupon” z sumą rabatów pod spodem.
//
// CO BYŁO W TRASIE. `admin.coupons.analytics.tsx` (dawne 136-181).
//
// CO TU JEST RYZYKIEM. Stopka („Łączny rabat udzielony”) jest liczona OSOBNO
// od kolumny rabatu - w trasie były to dwa niezależne wyrażenia. Rozjazd między
// nimi to raport, który sam sobie przeczy, i nie widać go w recenzji. Dlatego
// suma przychodzi jednym propem z `summarizeCouponAnalytics`, a test sprawdza,
// że stopka zgadza się z kolumną.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * kolumna „Realizacje” renderuje `r.redemptions` BEZ `Number()`, więc
//     wartość tekstowa (a `count(*)` w PostgREST bywa stringiem bigint)
//     pokazuje się tak samo - to jedyna niespójność formatowania w tym pliku,
//     ale ta sama wartość w wykresie i w sumie idzie już przez `Number()`;
//   * brak kolumny w odpowiedzi RPC daje w komórce „NaN”, a `null` daje „0.00” -
//     awarii danych nie da się odróżnić od zera.
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CouponAnalyticsRow } from "@/lib/billing/couponAnalyticsView";

export interface CouponAnalyticsTableLabels {
  readonly title: string;
  readonly empty: string;
  readonly code: string;
  readonly redemptions: string;
  readonly netRevenue: string;
  readonly totalDiscount: string;
  readonly totalDiscountGranted: string;
}

export function CouponAnalyticsTable({
  rows,
  totalDiscountCents,
  labels,
}: {
  rows: readonly CouponAnalyticsRow[];
  totalDiscountCents: number;
  labels: CouponAnalyticsTableLabels;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{labels.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">{labels.empty}</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b border-border/60">
                  <th className="text-left py-2 pr-3">{labels.code}</th>
                  <th className="text-left py-2 pr-3">{labels.redemptions}</th>
                  <th className="text-left py-2 pr-3">{labels.netRevenue}</th>
                  <th className="text-left py-2 pr-3">{labels.totalDiscount}</th>
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
              {labels.totalDiscountGranted}:{" "}
              <span className="font-semibold text-foreground">
                {(totalDiscountCents / 100).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
