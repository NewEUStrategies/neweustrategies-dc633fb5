// Zakładka Analityka - agregaty per kupon + ranking TOP10.
//
// RYSUJE NASZ SILNIK (`@/components/charts`), ten sam co wpis i pozostałe
// pulpity. Wcześniej stał tu ECharts z własną paletą - i z kolorem słupka
// WPISANYM NA SZTYWNO (`#2a78d6`), czyli wartością, której nie widziała żadna
// bramka kontrastu ani motywu: w trybie ciemnym słupek zostawał tym samym
// błękitem na ciemnej płycie.
//
// SŁUPKI POZIOME, NIE PIONOWE. Kod kuponu bywa długi, a pionowa oś kategorii
// obracała etykiety o 30 stopni i ucinała je do 110 pikseli - czyli rysunek
// przestawał identyfikować kupon, o którym mówi. Poziome słupki dają etykiecie
// całą szerokość wiersza, a posortowane malejąco są rankingiem, którym ta
// karta i tak jest.
//
// P10 (S1, D-S1-08). Kafle sumowały przychód PLN i EUR w jedną liczbę,
// a „konwersja" liczyła kupony z jakimkolwiek wykorzystaniem - także
// REZERWACJĄ, za którą nikt nie zapłacił. Teraz podsumowanie liczy
// `couponAnalyticsSummaryQueryOptions`: konwersja = kohorta wydanych z ≥ 1
// OPŁACONYM wykorzystaniem (definicja przy kaflu), przychód netto i rabat
// osobno dla każdej waluty, rezerwacje osobno, a obcięta próbka jest
// podpisana. Kwoty czyta wyłącznie administrator (RLS zamówień) - redaktor
// dostałby zera albo własne zamówienia udające wynik, więc widzi adnotację.
// Granice zakresu = pełne doby lokalne (`dayRange.ts`).
import { Fragment, useId, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { Chart } from "@/components/charts/Chart";
import { defaultChartConfig } from "@/lib/charts/parse";
import { chartLangFrom } from "@/lib/charts/format";
import type { ChartConfig } from "@/lib/charts/types";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePickerField } from "@/components/admin/coupons/DatePickerField";
import { Stat } from "@/components/admin/coupons/atoms/Stat";
import {
  localDayEndIso,
  localDayStartIso,
  localDaysAgo,
} from "@/components/admin/coupons/dayRange";
import { HintTooltip } from "@/components/admin/pricing/atoms/HintTooltip";
import { useAuth } from "@/hooks/useAuth";
import { adminPageHead } from "@/lib/adminPageHead";
import { COUPON_READ_LIMIT, couponAnalyticsSummaryQueryOptions } from "@/lib/admin/couponQueries";
import { formatMoney } from "@/lib/billing/types";
import { ensureI18n as ensureAdminCouponsI18n } from "@/lib/i18n-admin-coupons";
import { slotForSeries } from "@/lib/charts/palette";
import { analyticsCouponsKey } from "@/lib/analytics/queryKeys";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import { useCurrentTenantId } from "@/lib/tenant";

export const Route = createFileRoute("/admin/coupons/analytics")({
  head: () =>
    adminPageHead(
      "Analityka kuponów",
      "Wydane kupony, konwersja opłacona, przychód netto i rabat osobno dla każdej waluty, rezerwacje i ranking kodów.",
    ),
  component: AnalyticsPage,
});

/**
 * Kontrakt `b2b_coupons_analytics` (migracja 20260725090200):
 *  - revenue_cents        = przychód NETTO (original_cents - applied_cents),
 *  - discount_cents_total = udzielony RABAT (applied_cents).
 * Funkcja liczy WSZYSTKIE wykorzystania (także rezerwacje) i nie zna waluty -
 * dlatego ekran bierze z niej wyłącznie liczbę wykorzystań per kupon
 * (ranking), a kwoty z podsumowania per waluta.
 */
interface AnalyticsRow {
  coupon_id: string;
  code: string;
  name: string | null;
  redemptions: number;
  revenue_cents: number;
  discount_cents_total: number;
}

/** Waluty obecne w przychodzie lub rabacie - w stałej kolejności. */
function currenciesOf(...groups: MoneyByCurrency[][]): string[] {
  return [...new Set(groups.flat().map((m) => m.currency))].sort();
}

function amountIn(money: MoneyByCurrency[], currency: string): number {
  return money.find((m) => m.currency === currency)?.amountMinor ?? 0;
}

function AnalyticsPage() {
  // Słownik modułu kuponów w chunku trasy - patrz komentarz przy ensureI18n
  // w lib/i18n-admin-coupons.ts. Komunikat awarii jest WSPÓLNY z zakładką
  // Realizacji: ten sam kształt, te same klucze, jedna decyzja modułu.
  ensureAdminCouponsI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const conversionHintId = useId();
  // Zamówienia (`payment_orders`) czyta wyłącznie administrator najemcy -
  // `isAdmin` obejmuje też `super_admin`, którego RLS nie wpuszcza.
  const { roles } = useAuth();
  const canSeeMoney = roles.includes("admin");

  const [from, setFrom] = useState<Date | undefined>(() => localDaysAgo(90));
  const [to, setTo] = useState<Date | undefined>(() => localDaysAgo(0));
  const fromIso = localDayStartIso(from);
  const toIso = localDayEndIso(to);

  // Funkcja filtruje po `current_tenant_id()` wołającego, więc dane są zawsze
  // właściwe - ale bez najemcy w kluczu cache po przełączeniu obszaru
  // roboczego pokazałby ranking kuponów poprzedniego (`analyticsCouponsKey`).
  const tenantId = useCurrentTenantId();
  const q = useQuery({
    queryKey: analyticsCouponsKey(tenantId ?? "", fromIso, toIso),
    enabled: Boolean(tenantId),
    queryFn: async (): Promise<AnalyticsRow[]> => {
      const { data, error } = await supabase.rpc("b2b_coupons_analytics", {
        _from: fromIso ?? new Date(0).toISOString(),
        _to: toIso ?? new Date().toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as AnalyticsRow[];
    },
  });
  const summaryOptions = couponAnalyticsSummaryQueryOptions(tenantId, fromIso, toIso);
  const summaryQ = useQuery({
    ...summaryOptions,
    enabled: Boolean(summaryOptions.enabled) && canSeeMoney,
  });

  /**
   * AWARIA ODCZYTU NIE MOŻE WYGLĄDAĆ JAK ZAKRES BEZ SPRZEDAŻY.
   * Bez tej gałęzi odmowa uprawnień, błąd SQL i zerwana sieć dawały ten sam
   * ekran co poprawny odczyt pustego okna: „Brak danych." i kafle zer (w tym
   * „Przychód netto: 0.00"). Zera odczytane z awarii to wniosek, że kampania
   * nie przyniosła przychodu - czyli decyzja o wygaszeniu programu podjęta
   * na podstawie błędu odczytu.
   *
   * Kształt komunikatu jest WSPÓLNY z zakładką Realizacji (te same klucze
   * `adminCoupons.loadError.*`), a kafle pokazują wtedy kreski zamiast zer:
   * zero jest twierdzeniem o pieniądzach, kreska mówi „nie wiadomo".
   */
  const failed = q.isError || summaryQ.isError;
  const rows = q.data ?? [];
  const summary = summaryQ.data;
  // Kreska także wtedy, gdy podsumowania jeszcze nie ma albo nie wolno go
  // czytać - kafel bez wyniku nie może pokazywać zera.
  const stat = (value: string | null) => (failed || value === null ? "-" : value);
  const money = (amountMinor: number, currency: string) => formatMoney(amountMinor, currency, lang);
  const currencies = summary ? currenciesOf(summary.revenueNet, summary.discount) : [];
  const top10 = rows.slice(0, 10).map((r) => ({
    code: r.code,
    redemptions: Number(r.redemptions),
  }));

  const top10Config = useMemo<ChartConfig>(
    () => ({
      // Na `defaultChartConfig()`, nie na literale: konfiguracja ma kilkanaście
      // pól i nowe dochodzą, więc literał albo przestałby się kompilować przy
      // każdym dopisaniu pola, albo ktoś rozluźniłby typ i trasa rysowałaby
      // wykres z niezdefiniowanymi ustawieniami uczciwości.
      ...defaultChartConfig(),
      kind: "bar-horizontal",
      // Tytuł i opis PUSTE: nagłówek rysuje karta, a rama silnika pomija swój
      // własny dokładnie wtedy, gdy oba są puste.
      title: "",
      description: "",
      categories: top10.map((r) => r.code),
      series: [
        {
          name: t("adminCoupons.analytics.redemptions"),
          values: top10.map((r) => r.redemptions),
          colorSlot: slotForSeries(0),
        },
      ],
      // Liczba NA SŁUPKU: karta jest rankingiem dziesięciu pozycji, a różnica
      // między czwartą a piątą bywa mniejsza niż grubość kreski.
      showValues: true,
      sampleSize: top10.reduce((acc, r) => acc + r.redemptions, 0),
      height: 320,
      animate: false,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, lang],
  );

  // JEDEN NAPIS NA NAGŁÓWEK KARTY I NA NAZWĘ RYSUNKU. Czytnik ekranu ogłasza
  // rysunek tą nazwą, a osoba widząca czyta ten sam napis nad nim - dwa
  // literały rozjechałyby się przy pierwszej korekcie tytułu i nikt by tego nie
  // zauważył, bo jeden z nich jest widoczny tylko w drzewie dostępności.
  const tytulRankingu = t("adminCoupons.analytics.rankingTitle");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <DatePickerField value={from} onChange={setFrom} label={t("adminCoupons.analytics.from")} />
        <DatePickerField value={to} onChange={setTo} label={t("adminCoupons.analytics.to")} />
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

      {!canSeeMoney && (
        <p className="text-sm text-muted-foreground" role="note">
          {t("adminCoupons.analytics.adminOnly")}
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label={t("adminCoupons.analytics.issued")}
          value={stat(summary ? String(summary.issued) : null)}
        />
        <Stat
          label={t("adminCoupons.analytics.conversion")}
          value={stat(
            summary
              ? summary.conversion === null
                ? "-"
                : `${(summary.conversion * 100).toFixed(1)}%`
              : null,
          )}
          help={
            <HintTooltip
              id={conversionHintId}
              text={t("adminCoupons.analytics.conversionDefinition")}
              label={t("adminCoupons.analytics.conversionHelp")}
            />
          }
        />
        <Stat
          label={t("adminCoupons.analytics.paid")}
          value={stat(summary ? String(summary.paidRedemptions) : null)}
        />
        <Stat
          label={t("adminCoupons.analytics.reserved")}
          value={stat(summary ? String(summary.reservedRedemptions) : null)}
        />
      </div>

      {/* Kwoty PER WALUTA - nigdy jedna suma z groszy różnych walut. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="kafle-walut">
        {currencies.length === 0 ? (
          <>
            <Stat
              label={t("adminCoupons.analytics.revenueNone")}
              value={stat(summary ? "0" : null)}
            />
            <Stat
              label={t("adminCoupons.analytics.discountNone")}
              value={stat(summary ? "0" : null)}
            />
          </>
        ) : (
          currencies.map((currency) => (
            <Fragment key={currency}>
              <Stat
                label={t("adminCoupons.analytics.revenueNet", { currency })}
                value={stat(money(amountIn(summary!.revenueNet, currency), currency))}
              />
              <Stat
                label={t("adminCoupons.analytics.discount", { currency })}
                value={stat(money(amountIn(summary!.discount, currency), currency))}
              />
            </Fragment>
          ))
        )}
      </div>
      {summary?.truncated && !failed && (
        <p className="text-xs text-muted-foreground" role="note">
          {t("adminCoupons.analytics.truncated", { limit: COUPON_READ_LIMIT })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tytulRankingu}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Wyłączone zapytanie (najemca nieustalony) ma `isLoading === false` -
              bez `!tenantId` karta mówiłaby „Brak danych." przed odczytem. */}
          {!tenantId || q.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("adminCoupons.loading")}
            </div>
          ) : q.isError ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.loadError.placeholder")}
            </p>
          ) : top10.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.analytics.noData")}
            </p>
          ) : (
            <Chart config={top10Config} lang={chartLangFrom(lang)} ariaLabel={tytulRankingu} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("adminCoupons.analytics.detailTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isError ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.loadError.placeholder")}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6">
              {t("adminCoupons.analytics.noData")}
            </p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground uppercase">
                  <tr className="border-b border-border/60">
                    <th className="text-left py-2 pr-3">{t("adminCoupons.analytics.code")}</th>
                    <th className="text-left py-2 pr-3">
                      {t("adminCoupons.analytics.detailRedemptions")}
                    </th>
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
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                {t("adminCoupons.analytics.detailNote")}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
