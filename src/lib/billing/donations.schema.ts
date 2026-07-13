// Czysty schemat wejścia darowizny (bez zależności serwerowych) - dzielony
// przez server fn i formularz /support, testowalny jednostkowo.
import { z } from "zod";

/** 5 zł - poniżej prowizja Stripe zjada sens darowizny. */
export const DONATION_MIN_CENTS = 500;
/** 50 000 zł - twardy sufit anty-pomyłkowy (przelew tradycyjny powyżej). */
export const DONATION_MAX_CENTS = 5_000_000;

/** Kwoty podpowiadane na /support (grosze): 20 / 50 / 100 / 250 zł. */
export const DONATION_PRESETS_CENTS = [2000, 5000, 10000, 25000] as const;

export const donationInputSchema = z.object({
  amount_cents: z.number().int().min(DONATION_MIN_CENTS).max(DONATION_MAX_CENTS),
  message: z.string().trim().max(500).optional(),
  lang: z.enum(["pl", "en"]),
});

export type DonationInput = z.infer<typeof donationInputSchema>;
