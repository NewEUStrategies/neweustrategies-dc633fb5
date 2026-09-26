// Nakładka i18n `eventTicketActions.*` - ZASIEW Foundation, WŁAŚCICIEL: tor B.
//
// Nakładka toru B: oferta z listy rezerwowej, przekazanie biletu i samodzielny
// zwrot po stronie uczestnika.
//
// KONTRAKT ZASIEWU (spec B.14): Foundation tworzy plik z nazwanymi eksportami
// `eventTicketActionsPl` / `eventTicketActionsEn` o identycznych drzewach i bramkuje prefiks od
// pierwszego dnia (`GATED_PREFIXES`, `REFERENCE_PREFIXES`). Właściciel dopisuje
// klucze swobodnie, ale NIE zmienia prefiksu, trzyma parytet PL/EN i ZOSTAWIA
// zdanie `title` (PL) - to znacznik `HEAVY_DICTIONARIES`
// w `scripts/check-entry-purity.ts`, po którym bramka rozpoznaje tę nakładkę
// w paczce startowej.
import i18n from "@/lib/i18n";

export const eventTicketActionsPl = {
  eventTicketActions: {
    title: "Działania na bilecie",
  },
} as const;

export const eventTicketActionsEn = {
  eventTicketActions: {
    title: "Ticket actions",
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", eventTicketActionsPl, true, true);
  i18n.addResourceBundle("en", "translation", eventTicketActionsEn, true, true);
}

ensureI18n();
