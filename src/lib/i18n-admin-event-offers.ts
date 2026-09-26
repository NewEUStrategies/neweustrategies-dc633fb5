// Nakładka i18n `adminEventOffers.*` - ZASIEW Foundation, WŁAŚCICIEL: tor B.
//
// Nakładka toru B po stronie organizatora: oferty z listy rezerwowej, stan
// płatności, zwroty i przekazania na liście zgłoszeń.
//
// KONTRAKT ZASIEWU (spec B.14): Foundation tworzy plik z nazwanymi eksportami
// `adminEventOffersPl` / `adminEventOffersEn` o identycznych drzewach i bramkuje prefiks od
// pierwszego dnia (`GATED_PREFIXES`, `REFERENCE_PREFIXES`). Właściciel dopisuje
// klucze swobodnie, ale NIE zmienia prefiksu, trzyma parytet PL/EN i ZOSTAWIA
// zdanie `title` (PL) - to znacznik `HEAVY_DICTIONARIES`
// w `scripts/check-entry-purity.ts`, po którym bramka rozpoznaje tę nakładkę
// w paczce startowej.
import i18n from "@/lib/i18n";

export const adminEventOffersPl = {
  adminEventOffers: {
    title: "Oferty i przekazania biletów",
  },
} as const;

export const adminEventOffersEn = {
  adminEventOffers: {
    title: "Ticket offers and transfers",
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", adminEventOffersPl, true, true);
  i18n.addResourceBundle("en", "translation", adminEventOffersEn, true, true);
}

ensureI18n();
