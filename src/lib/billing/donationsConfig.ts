// Konfiguracja własnego systemu darowizn (klient-safe).
//
// Darowizny mogą być zbierane na dwa sposoby:
//   * `stripe`   - nasz własny checkout (Stripe Embedded Checkout), jednorazowo
//                  lub cyklicznie; wpłaty lądują w tabeli `donations`,
//   * `external` - zewnętrzna zbiórka (zrzutka.pl) - tryb historyczny, nadal
//                  dostępny jako awaryjny.
// Ustawienia trzyma `site_settings[key="donations"]`; publiczny formularz i
// panel administracyjny czytają dokładnie ten sam kształt.
import { z } from "zod";

export const DONATIONS_SETTINGS_KEY = "donations";

/** Minimum operatora płatności (50 gr / 0,50 EUR). */
export const DONATION_MIN_CENTS = 500;
/** Twardy sufit pojedynczej wpłaty - ochrona przed pomyłką i praniem pieniędzy. */
export const DONATION_MAX_CENTS = 5_000_000;

export const DonationsConfigSchema = z.object({
  /** Wyłącznik całego modułu darowizn (ukrywa CTA i blokuje checkout). */
  enabled: z.boolean().default(true),
  /** Silnik wpłat: nasz checkout Stripe albo zewnętrzna zbiórka. */
  provider: z.enum(["stripe", "external"]).default("stripe"),
  /** Adres zewnętrznej zbiórki - używany wyłącznie w trybie `external`. */
  externalUrl: z.string().trim().max(500).default("https://zrzutka.pl/sfrxme"),
  currency: z.enum(["PLN", "EUR"]).default("PLN"),
  /** Kwoty sugerowane (w groszach) - pierwsza jest domyślnie zaznaczona. */
  presetsCents: z.array(z.number().int().positive()).max(8).default([2500, 5000, 10000, 25000]),
  /** Czy ofiarodawca może wpisać własną kwotę. */
  allowCustom: z.boolean().default(true),
  minCents: z.number().int().min(DONATION_MIN_CENTS).default(DONATION_MIN_CENTS),
  maxCents: z.number().int().max(DONATION_MAX_CENTS).default(1_000_000),
  /** Wsparcie cykliczne (miesięczne) - osobna subskrypcja u operatora. */
  allowRecurring: z.boolean().default(true),
  /** Zbiórka celowa - `0` wyłącza pasek postępu. */
  goalCents: z.number().int().min(0).default(0),
  showRecent: z.boolean().default(true),
  /** Pole „wiadomość od darczyńcy" w formularzu. */
  allowMessage: z.boolean().default(true),
  headlinePl: z.string().trim().max(160).default("Wesprzyj niezależną analizę"),
  headlineEn: z.string().trim().max(160).default("Support independent analysis"),
  descriptionPl: z
    .string()
    .max(600)
    .default(
      "Mecenat obywatelski finansuje tracker legislacyjny UE, raporty i debaty. Każda wpłata pomaga.",
    ),
  descriptionEn: z
    .string()
    .max(600)
    .default(
      "Citizen patronage funds our EU legislative tracker, reports and debates. Every gift helps.",
    ),
});

export type DonationsConfig = z.infer<typeof DonationsConfigSchema>;

export const DONATIONS_DEFAULTS: DonationsConfig = DonationsConfigSchema.parse({});

/** Bezpieczne wczytanie wartości z bazy - uszkodzony wpis nie może wywrócić strony. */
export function parseDonationsConfig(raw: unknown): DonationsConfig {
  const result = DonationsConfigSchema.safeParse(raw ?? {});
  return result.success ? result.data : DONATIONS_DEFAULTS;
}

/** Czy nasz własny checkout darowizn jest aktywny? */
export function usesInternalDonations(config: DonationsConfig): boolean {
  return config.enabled && config.provider === "stripe";
}

/** Kwota w groszach po walidacji względem konfiguracji; `null` gdy poza zakresem. */
export function normalizeDonationAmount(
  config: DonationsConfig,
  amountCents: number,
): number | null {
  if (!Number.isFinite(amountCents)) return null;
  const value = Math.round(amountCents);
  const min = Math.max(DONATION_MIN_CENTS, config.minCents);
  const max = Math.min(DONATION_MAX_CENTS, config.maxCents);
  if (value < min || value > max) return null;
  return value;
}

export type DonationAmountCheck =
  | { ok: true; amountCents: number }
  | { ok: false; error: "amount_out_of_range" | "amount_not_allowed" };

/**
 * Pełna serwerowa bramka kwoty: zakres ORAZ tryb kwot z ustawień redakcji.
 *
 * `allowCustom: false` znaczy „wyłącznie kwoty sugerowane" - formularz chowa
 * wtedy pole własnej kwoty, ale endpoint jest publiczny, więc bez tej bramki
 * dowolna kwota z zakresu i tak trafiała do operatora (audyt SUB-10). Kwota
 * sugerowana też musi mieścić się w zakresie: preset poniżej twardego minimum
 * operatora nie otwiera wpłat na grosz tylnymi drzwiami.
 */
export function checkDonationAmount(
  config: DonationsConfig,
  amountCents: number,
): DonationAmountCheck {
  const value = normalizeDonationAmount(config, amountCents);
  if (value === null) return { ok: false, error: "amount_out_of_range" };
  if (!config.allowCustom && !config.presetsCents.includes(value)) {
    return { ok: false, error: "amount_not_allowed" };
  }
  return { ok: true, amountCents: value };
}

/** Formatowanie kwoty dla interfejsu (grosze -> waluta lokalna). */
export function formatDonationAmount(
  amountCents: number,
  currency: string,
  lang: "pl" | "en",
): string {
  return new Intl.NumberFormat(lang === "en" ? "en-GB" : "pl-PL", {
    style: "currency",
    currency,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}
