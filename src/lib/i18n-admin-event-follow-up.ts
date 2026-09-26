// Nakładka i18n `adminEventFollowUp.*` - ZASIEW Foundation, WŁAŚCICIEL: tor C.
//
// Nakładka toru C po stronie organizatora: grupa studia „Po wydarzeniu”
// (certyfikat, ankieta, wyniki).
//
// KONTRAKT ZASIEWU (spec B.14): Foundation tworzy plik z nazwanymi eksportami
// `adminEventFollowUpPl` / `adminEventFollowUpEn` o identycznych drzewach i bramkuje prefiks od
// pierwszego dnia (`GATED_PREFIXES`, `REFERENCE_PREFIXES`). Właściciel dopisuje
// klucze swobodnie, ale NIE zmienia prefiksu, trzyma parytet PL/EN i ZOSTAWIA
// zdanie `title` (PL) - to znacznik `HEAVY_DICTIONARIES`
// w `scripts/check-entry-purity.ts`, po którym bramka rozpoznaje tę nakładkę
// w paczce startowej.
import i18n from "@/lib/i18n";

export const adminEventFollowUpPl = {
  adminEventFollowUp: {
    title: "Certyfikaty i ankieta uczestników",
  },
} as const;

export const adminEventFollowUpEn = {
  adminEventFollowUp: {
    title: "Attendee certificates and survey",
  },
} as const;

let registered = false;

/** Idempotentna rejestracja; wołana też na końcu modułu (import = rejestracja). */
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", adminEventFollowUpPl, true, true);
  i18n.addResourceBundle("en", "translation", adminEventFollowUpEn, true, true);
}

ensureI18n();
