// Organizm: historia realizacji kuponów B2B.
//
// CO BYŁO W TRASIE. `admin.coupons.redemptions.tsx` (dawne 124-209).
//
// CO TU JEST RYZYKIEM. To jest RAPORT FINANSOWY: trzy kolumny pieniędzy
// („Przed rabatem", „Rabat", „Zapłacono") liczone z dwóch kolumn bazy, których
// nazwy sugerują coś innego, niż znaczą (`applied_cents` to RABAT, nie kwota
// zapłacona). Arytmetyka mieszka w `@/lib/billing/couponMoney` i ma własny
// test - tutaj dowodzimy, że organizm z niej KORZYSTA, a nie że dodawanie
// działa.
//
// PRZENIESIONE ZNAK W ZNAK, RAZEM Z WADAMI:
//   * kod kuponu i plan czyta się z osadzonego obiektu `b2b_coupons`; gdy
//     PostgREST odda dla tej samej relacji TABLICĘ (a potrafi, i rzutowanie
//     `as unknown as` to ukrywa), kolumna kodu pokazuje „-" bez żadnego błędu;
//   * identyfikator użytkownika jest skracany do ośmiu znaków NA EKRANIE, ale
//     do arkusza CSV leci w całości;
//   * data realizacji idzie przez `toLocaleString(lang)`, więc wiersz
//     z niepoprawną datą wypisuje „Invalid Date" zamiast znaku zastępczego.
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RedemptionEffectsBadge } from "@/components/admin/coupons/atoms/RedemptionEffectsBadge";
import { couponPaidCents, type CouponRedemptionAmounts } from "@/lib/billing/couponMoney";

/** Wiersz realizacji z osadzonym kuponem. */
export interface RedemptionTableRow extends CouponRedemptionAmounts {
  readonly id: string;
  readonly user_id: string | null;
  readonly currency: string;
  readonly created_at: string;
  readonly effects_applied_at: string | null;
  readonly b2b_coupons: {
    readonly code: string;
    readonly name: string | null;
    readonly grants_tier_key: string | null;
  } | null;
}

export interface RedemptionsTableLabels {
  readonly title: string;
  readonly loading: string;
  readonly empty: string;
  readonly date: string;
  readonly code: string;
  readonly user: string;
  readonly beforeDiscount: string;
  readonly discount: string;
  readonly paid: string;
  readonly plan: string;
  readonly granted: string;
  readonly awaiting: string;
}

export function RedemptionsTable({
  rows,
  loading,
  lang,
  labels,
}: {
  rows: readonly RedemptionTableRow[];
  loading: boolean;
  lang: string;
  labels: RedemptionsTableLabels;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{labels.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" />
            {labels.loading}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6">{labels.empty}</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b border-border/60">
                  <th className="text-left py-2 pr-3">{labels.date}</th>
                  <th className="text-left py-2 pr-3">{labels.code}</th>
                  <th className="text-left py-2 pr-3">{labels.user}</th>
                  <th className="text-left py-2 pr-3">{labels.beforeDiscount}</th>
                  <th className="text-left py-2 pr-3">{labels.discount}</th>
                  <th className="text-left py-2 pr-3">{labels.paid}</th>
                  <th className="text-left py-2 pr-3">{labels.plan}</th>
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
                      <RedemptionEffectsBadge
                        tierKey={r.b2b_coupons?.grants_tier_key ?? null}
                        effectsAppliedAt={r.effects_applied_at}
                        grantedLabel={labels.granted}
                        awaitingLabel={labels.awaiting}
                        lang={lang}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
