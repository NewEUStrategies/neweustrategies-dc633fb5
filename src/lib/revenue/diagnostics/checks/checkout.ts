// Reguły obszaru „Kasa" (SPEC §5.7; P09, Z-S3-03, DZ §18.4).
import { REVENUE_LIMITS } from "@/lib/revenue/limits";
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

export const CHECKOUT_CHECKS = [
  {
    // Domyślne okno porzucenia (24 h) opóźnia zdarzenie „porzucona kasa" -
    // ścieżka porzuconej kasy rusza dobę po wyjściu klienta. Bez aktywnej
    // ścieżki to tylko wolniejsza statystyka; z nią - spóźniony kontakt.
    id: "checkout.abandon_window_default",
    area: "checkout",
    severity: "info",
    evaluate(facts) {
      const checkout = areaFacts(facts, "checkout");
      if (checkout?.settingsRow === undefined || checkout.abandonedJourneyActive === undefined) {
        return UNKNOWN;
      }
      const minutes = checkout.settingsRow
        ? checkout.abandonAfterMinutes
        : REVENUE_LIMITS.checkoutAbandonMinutesDefault;
      if (minutes === undefined || minutes === null) return UNKNOWN;
      if (minutes !== REVENUE_LIMITS.checkoutAbandonMinutesDefault) return OK;
      return finding(checkout.abandonedJourneyActive ? "error" : "warn", {
        evidence: ev(
          checkout.abandonedJourneyActive ? "abandonDefaultWithJourney" : "abandonDefault",
          { minutes },
        ),
      });
    },
    fix: { kind: "dialog", dialog: "checkout_abandon_window" },
    owner: { to: "/admin/paywall", search: { tab: "checkout" } },
    snoozable: true,
  },
  {
    // P09: cennik EN pokazuje EUR, a plan obciąża w PLN. S3 dopisał napis
    // „Charged in PLN" pod ofertą EN (`paywall.offer.chargedIn`) - rozjazd
    // jest więc jawny (warn). Ten sam rozjazd w PL nie ma napisu (error).
    id: "checkout.display_currency_mismatch",
    area: "checkout",
    severity: "warning",
    evaluate(facts) {
      const presentation = areaFacts(facts, "checkout")?.presentation;
      if (!presentation) return UNKNOWN;
      const mismatched = presentation.filter((p) =>
        p.chargeCurrencies.some((c) => c !== p.displayCurrency),
      );
      if (mismatched.length === 0) return OK;
      const pl = mismatched.find((p) => p.lang === "pl");
      const shown = pl ?? mismatched[0];
      return finding(pl ? "error" : "warn", {
        count: mismatched.length,
        refs: mismatched.map((p) => p.lang),
        evidence: ev(pl ? "currencyMismatchNoNotice" : "currencyMismatchNotice", {
          lang: shown.lang.toUpperCase(),
          display: shown.displayCurrency,
          charged: shown.chargeCurrencies.filter((c) => c !== shown.displayCurrency).join(", "),
        }),
      });
    },
    fix: { kind: "code", issueRef: "checkout.display_currency_mismatch" },
    owner: { to: "/admin/pricing" },
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
