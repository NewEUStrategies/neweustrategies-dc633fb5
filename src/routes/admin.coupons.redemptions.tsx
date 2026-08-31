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
import { couponPaidCents, sumCouponTotals, type CouponTotals } from "@/lib/billing/couponMoney";
import { Stat } from "@/components/admin/coupons/atoms/Stat";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";

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
  // Słownik modułu kuponów w chunku trasy - patrz komentarz przy ensureI18n
  // w lib/i18n-admin-coupons.ts. Komunikat awarii jest WSPÓLNY z zakładką
  // Analityki, więc musi stać w słowniku, nie w bliźniaku językowym.
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
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

  /**
   * KAFLE LICZĄ PER WALUTA. `sumCouponTotals` dodaje grosze wiersz po wierszu,
   * bez patrzenia na kolumnę `currency` - a kupony B2B są wystawiane także
   * partnerom rozliczanym w euro. Kafel z gołą liczbą pokazywał więc 80,00 PLN
   * + 40,00 EUR jako „120.00" i czytał się jak podsumowanie tabeli obok, która
   * walutę podaje PRZY KAŻDYM wierszu.
   *
   * WYBRANE ROZWIĄZANIE: rozbicie po walucie w samym kaflu (zamiast wymuszania
   * waluty w filtrze albo przeliczania po kursie - to drugie wymaga źródła
   * kursu z dnia realizacji, czyli nowego kontraktu danych). Grupujemy wiersze
   * i wołamy ten sam, przetestowany `sumCouponTotals` na każdej grupie, żeby
   * niezmiennik „applied_cents to RABAT" został w jednym miejscu.
   *
   * EKSPORT CSV zostaje bez zmian: ma kolumnę `currency` przy każdym wierszu,
   * więc nigdy nie mieszał walut w jednej liczbie - kafel był jedynym miejscem,
   * które to robiło.
   */
  const perCurrency = useMemo<{ currency: string; totals: CouponTotals }[]>(() => {
    const groups = new Map<string, RedRow[]>();
    for (const row of rows) {
      const currency = row.currency.toUpperCase();
      const group = groups.get(currency);
      if (group) group.push(row);
      else groups.set(currency, [row]);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, group]) => ({ currency, totals: sumCouponTotals(group) }));
  }, [rows]);

  /**
   * Kwota kafla: jedna pozycja na walutę obecną w zakresie. Zakres bez wierszy
   * daje samo „0.00" - zera nie ma czym podpisać i nie ma czego przekłamać.
   */
  const moneyPerCurrency = (pick: (group: CouponTotals) => number): string =>
    perCurrency.length === 0
      ? (0).toFixed(2)
      : perCurrency
          .map((group) => `${(pick(group.totals) / 100).toFixed(2)} ${group.currency}`)
          .join(" + ");

  /**
   * AWARIA ODCZYTU NIE MOŻE WYGLĄDAĆ JAK PUSTY ZAKRES. Bez tej gałęzi odmowa
   * RLS i padnięty PostgREST dawały ten sam ekran co poprawny odczyt pustego
   * okna („Brak realizacji w zakresie." + kafle zer), czyli fałszywy fakt
   * księgowy - a eksport CSV utrwalał go w arkuszu. Kafle pokazują wtedy
   * kreski (zero jest twierdzeniem o pieniądzach, kreska nie), lista mówi
   * o niedostępności zamiast o braku realizacji, a eksport jest zablokowany.
   */
  const failed = q.isError;
  const stat = (value: string) => (failed ? "-" : value);

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
        <Button
          variant="outline"
          className="h-10 rounded-[6px]"
          onClick={exportCsv}
          disabled={failed}
        >
          <Download className="h-4 w-4 mr-2" />
          {L("Eksport CSV", "Export CSV")}
        </Button>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label={L("Realizacje", "Redemptions")} value={stat(String(totals.count))} />
        <Stat
          label={L("Przychód netto", "Net revenue")}
          value={stat(moneyPerCurrency((group) => group.revenueCents))}
        />
        <Stat
          label={L("Rabat udzielony", "Discount granted")}
          value={stat(moneyPerCurrency((group) => group.discountCents))}
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
          ) : failed ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.loadError.placeholder")}
            </p>
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
