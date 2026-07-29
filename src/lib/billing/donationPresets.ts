// Warianty kwot darowizny konfigurowane w panelu edycji widgetu.
//
// Redaktor wpisuje kwoty w jednostkach głównych ("20, 50, 100, 250"), a nie w
// groszach - to jedyne miejsce, które tłumaczy ten zapis na centy i pilnuje
// limitów z donations.schema. Bez czyszczenia po stronie edytora błędna kwota
// dolatywałaby dopiero do walidacji serwerowej i psuła checkout darczyńcy.
import {
  DONATION_MAX_CENTS,
  DONATION_MIN_CENTS,
  DONATION_PRESETS_CENTS,
  DONATION_PRESETS_CENTS_EUR,
  type DonationCurrency,
} from "@/lib/billing/donations.schema";

/** Maksymalna liczba przycisków kwot - powyżej rząd się łamie i traci czytelność. */
export const DONATION_PRESET_LIMIT = 6;

export function defaultDonationPresets(currency: DonationCurrency): number[] {
  return currency === "EUR" ? [...DONATION_PRESETS_CENTS_EUR] : [...DONATION_PRESETS_CENTS];
}

/**
 * "20, 50, 100" -> [2000, 5000, 10000]. Przecinek i średnik są separatorami
 * listy (część dziesiętna zapisywana kropką). Wartości spoza zakresu i duplikaty
 * odpadają; pusty/niepoprawny zapis wraca do domyślnych kwot dla waluty.
 */
export function parseDonationPresets(csv: string | undefined, currency: DonationCurrency): number[] {
  const parsed = (csv ?? "")
    .split(/[,;\s]+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => Math.round(Number(raw) * 100))
    .filter(
      (cents) =>
        Number.isFinite(cents) && cents >= DONATION_MIN_CENTS && cents <= DONATION_MAX_CENTS,
    );

  const unique = Array.from(new Set(parsed)).slice(0, DONATION_PRESET_LIMIT);
  return unique.length > 0 ? unique : defaultDonationPresets(currency);
}

/** Kwota z pola "inna kwota" - null gdy pusta lub poza dozwolonym zakresem. */
export function parseCustomAmountCents(raw: string): number | null {
  const value = Math.round(Number(raw.replace(",", ".").trim()) * 100);
  if (!Number.isFinite(value)) return null;
  if (value < DONATION_MIN_CENTS || value > DONATION_MAX_CENTS) return null;
  return value;
}
