// Czysty schemat wejścia darowizny (bez zależności serwerowych) - dzielony
// przez server fn i formularz /support, testowalny jednostkowo.
import { z } from "zod";

/** 5 zł / 5 EUR - poniżej prowizja Stripe zjada sens darowizny. */
export const DONATION_MIN_CENTS = 500;
/** 50 000 zł / 50 000 EUR - twardy sufit anty-pomyłkowy. */
export const DONATION_MAX_CENTS = 5_000_000;

/** Kwoty podpowiadane na /support (grosze): 20 / 50 / 100 / 250 zł. */
export const DONATION_PRESETS_CENTS = [2000, 5000, 10000, 25000] as const;
/** EUR ma o połowę niższe stawki niż PLN: 10 / 25 / 50 / 125 EUR (w centach). */
export const DONATION_PRESETS_CENTS_EUR = [1000, 2500, 5000, 12500] as const;

export const DONATION_CURRENCIES = ["PLN", "EUR"] as const;
export type DonationCurrency = (typeof DONATION_CURRENCIES)[number];

export const donationInputSchema = z.object({
  amount_cents: z.number().int().min(DONATION_MIN_CENTS).max(DONATION_MAX_CENTS),
  currency: z.enum(DONATION_CURRENCIES).default("PLN"),
  message: z.string().trim().max(500).optional(),
  lang: z.enum(["pl", "en"]),
});

export type DonationInput = z.infer<typeof donationInputSchema>;
