// Nakładka i18n `eventFollowUp.*` - ZASIEW Foundation, WŁAŚCICIEL: tor C.
//
// Nakładka toru C: ankieta po wydarzeniu, certyfikat uczestnictwa i strona
// weryfikacji certyfikatu po stronie uczestnika.
//
// KONTRAKT ZASIEWU (spec B.14): Foundation tworzy plik z nazwanymi eksportami
// `eventFollowUpPl` / `eventFollowUpEn` o identycznych drzewach i bramkuje prefiks od
// pierwszego dnia (`GATED_PREFIXES`, `REFERENCE_PREFIXES`). Właściciel dopisuje
// klucze swobodnie, ale NIE zmienia prefiksu, trzyma parytet PL/EN i ZOSTAWIA
// zdanie `title` (PL) - to znacznik `HEAVY_DICTIONARIES`
// w `scripts/check-entry-purity.ts`, po którym bramka rozpoznaje tę nakładkę
// w paczce startowej.
import i18n from "@/lib/i18n";

export const eventFollowUpPl = {
  eventFollowUp: {
    title: "Certyfikat i ankieta po wydarzeniu",
  },
} as const;

export const eventFollowUpEn = {
  eventFollowUp: {
    title: "Certificate and survey after the event",
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", eventFollowUpPl, true, true);
  i18n.addResourceBundle("en", "translation", eventFollowUpEn, true, true);
}

ensureI18n();
