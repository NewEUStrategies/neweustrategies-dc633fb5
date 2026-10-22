// Reguły obszaru „Newsletter i lista" (SPEC §5.7).
import { areaFacts, ev, finding, OK, UNKNOWN } from "../facts";
import type { RevenueCheck } from "../registry";

/**
 * Najemca bez wiersza `newsletter_settings` działa na DEFAULT kolumn:
 * newsletter włączony, double opt-in WYŁĄCZONY, popup wyłączony. Bez tego
 * lustra brak wiersza wyglądałby jak „nie wiadomo", a to jest stan znany.
 */
export const NEWSLETTER_COLUMN_DEFAULTS = {
  enabled: true,
  doubleOptIn: false,
  popupEnabled: false,
} as const;

const OWNER = { to: "/admin/newsletter" } as const;

export const NEWSLETTER_CHECKS = [
  {
    id: "newsletter.doi_disabled",
    area: "newsletter",
    severity: "warning",
    evaluate(facts) {
      const newsletter = areaFacts(facts, "newsletter");
      if (newsletter?.settingsRow === undefined) return UNKNOWN;
      const row = newsletter.settingsRow;
      const doubleOptIn = row ? newsletter.doubleOptIn : NEWSLETTER_COLUMN_DEFAULTS.doubleOptIn;
      const popup = row ? newsletter.popupEnabled : NEWSLETTER_COLUMN_DEFAULTS.popupEnabled;
      if (
        doubleOptIn === undefined ||
        doubleOptIn === null ||
        popup === undefined ||
        popup === null
      ) {
        return UNKNOWN;
      }
      if (doubleOptIn) return OK;
      // Popup zbiera adresy właśnie teraz - każdy bez potwierdzenia zgody.
      return finding(popup ? "error" : "warn", {
        evidence: ev(popup ? "doiOffPopupOn" : "doiOff"),
      });
    },
    fix: { kind: "dialog", dialog: "newsletter_doi" },
    owner: OWNER,
    snoozable: true,
  },
  {
    // Nadawca platformy (`onboarding@resend.dev`) albo pusty - wysyłki
    // lądują w spamie albo nie wychodzą. Fakt to WYŁĄCZNIE flaga: adres
    // nadawcy nie opuszcza bazy.
    id: "newsletter.default_sender",
    area: "newsletter",
    severity: "critical",
    evaluate(facts) {
      const newsletter = areaFacts(facts, "newsletter");
      if (newsletter?.defaultSender === undefined || newsletter.campaignsSent30d === undefined) {
        return UNKNOWN;
      }
      if (!newsletter.defaultSender) return OK;
      return finding(newsletter.campaignsSent30d > 0 ? "error" : "warn", {
        count: newsletter.campaignsSent30d,
        evidence: ev("defaultSender", { count: newsletter.campaignsSent30d }),
      });
    },
    fix: { kind: "dialog", dialog: "newsletter_sender" },
    owner: OWNER,
    snoozable: true,
  },
] as const satisfies readonly RevenueCheck[];
