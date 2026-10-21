// Organizm: kasa w jednym zdaniu (SPEC §2.2 `offer`: „kasa w jednym zdaniu").
//
// Z FAKTÓW S7-A (`revenueFactsQueryOptions` - ten sam wpis co Diagnostyka):
// waluty obciążenia, okno porzucenia (`checkout_settings`) i to, czy porzucony
// koszyk obsługuje aktywna ścieżka. Brak wiersza ustawień = domyślna doba
// (reguła `checkout.abandon_window_default`), brak faktu = „nie udało się
// odczytać", nigdy zgadnięta wartość.
//
// Okno w minutach pokazujemy przez `Intl` (godziny, gdy dzielą się bez reszty)
// - odmianę „24 godziny / 1 hour" robi przeglądarka, nie kod.
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { CheckoutFacts } from "@/lib/revenue/diagnostics/facts";
import { revenueFactsQueryOptions } from "@/lib/revenue/diagnostics/queries";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

function formatWindow(minutes: number, lang: ChartLang): string {
  const hours = minutes % 60 === 0;
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "unit",
    unit: hours ? "hour" : "minute",
    unitDisplay: "long",
  }).format(hours ? minutes / 60 : minutes);
}

export interface CheckoutSentenceCardProps {
  tenantId: string | null;
  roles: readonly string[];
}

export function CheckoutSentenceCard({ tenantId, roles }: CheckoutSentenceCardProps) {
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const roleOk = roles.includes("admin") || roles.includes("editor");
  const facts = useQuery(revenueFactsQueryOptions(tenantId, { roleOk }));
  const checkout: CheckoutFacts | null =
    facts.data?.state === "ready" ? (facts.data.facts.areas.checkout ?? null) : null;

  let sentence: string;
  if (checkout === null || checkout.chargeCurrencies === undefined) {
    sentence = t("adminRevenue.offer.checkout.unknown");
  } else {
    const parts = [
      checkout.chargeCurrencies.length > 0
        ? t("adminRevenue.offer.checkout.currencies", {
            currencies: checkout.chargeCurrencies.join(", "),
          })
        : t("adminRevenue.offer.checkout.currenciesNone"),
      checkout.settingsRow && typeof checkout.abandonAfterMinutes === "number"
        ? t("adminRevenue.offer.checkout.abandon", {
            duration: formatWindow(checkout.abandonAfterMinutes, lang),
          })
        : t("adminRevenue.offer.checkout.abandonDefault"),
      checkout.abandonedJourneyActive
        ? t("adminRevenue.offer.checkout.journeyOn")
        : t("adminRevenue.offer.checkout.journeyOff"),
    ];
    sentence = parts.join(" ");
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="offer-checkout"
      className="min-w-0 space-y-2 rounded-[6px] border border-border p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold">
          {t("adminRevenue.offer.checkout.title")}
        </h3>
        <Button asChild size="sm" variant="outline" className="h-7">
          <Link to="/admin/paywall" search={{ tab: "checkout" }}>
            {t("adminRevenue.offer.checkout.open")}
          </Link>
        </Button>
      </div>
      <p className="m-0 text-sm" data-testid="checkout-sentence">
        {sentence}
      </p>
    </section>
  );
}
