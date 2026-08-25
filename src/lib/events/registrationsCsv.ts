// Eksport CSV listy uczestników wydarzenia.
//
// TO SĄ DANE OSOBOWE, KTÓRE OPUSZCZAJĄ SYSTEM. Plik ląduje w arkuszu na
// laptopie organizatora, w skrzynce pocztowej i czasem u dostawcy cateringu -
// więc dobór kolumn jest tu decyzją, a nie wygodą. Wynosimy to, czego naprawdę
// potrzebuje obsługa wydarzenia (tożsamość, firma, bilet, grupa, status,
// obecność) i nie wynosimy niczego, co jest wyłącznie techniczne
// (identyfikatory osób, skróty tokenów, odpowiedzi formularza w surowym JSON).
//
// ZGODY JADĄ JAKO DATY, NIE JAKO „TAK/NIE". Data udzielenia zgody jest
// dowodem, którego „tak" nie zastąpi - a przy zgodzie na przekazanie danych
// partnerowi to jest różnica między dokumentem a deklaracją. Wycofanie zgody
// ma własną kolumnę, bo to ono unieważnia poprzednie.
//
// CYTOWANIE Z `lib/crm/csv`, NIE Z `lib/csv/formatCsv`. Oba są zgodne z RFC
// 4180, ale tylko pierwszy neutralizuje wiodące `=`, `+`, `-` i `@` -
// a tu wynosimy pola WPISANE PRZEZ UCZESTNIKA (nazwa firmy, stanowisko).
// Nazwa firmy „=HYPERLINK(...)" w arkuszu organizatora jest wykonywalną
// formułą, nie napisem.
import { csvDocument } from "@/lib/crm/csv";
import { csvFileNameFor } from "@/lib/csv/formatCsv";
import type { EventRegistrationRow } from "@/lib/events/registrationsApi";

/** Kolumny eksportu, w kolejności zapisu. Nagłówki techniczne (jak reszta repo). */
export const REGISTRATION_CSV_COLUMNS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "job_title",
  "company",
  "ticket",
  "group",
  "status",
  "registration_mode",
  "source",
  "waitlist_position",
  "created_at",
  "decided_at",
  "decision_source",
  "decision_note",
  "attended_at",
  "cancelled_at",
  "consent_data_processing_at",
  "consent_marketing_at",
  "consent_partner_sharing_at",
  "consent_withdrawn_at",
] as const;

/**
 * Pierwsza NIEPUSTA wartość.
 *
 * Wygenerowane typy Supabase deklarują kolumny RPC jako `string`, choć baza
 * oddaje w nich NULL - a PostgREST zamienia go w `null`, które po drodze bywa
 * pustym napisem. `??` przepuszcza pusty napis jako „wartość", więc firma
 * z kartoteki znikała, a w jej miejsce nie wchodziła ta wpisana ręcznie.
 */
function firstFilled(...values: readonly (string | null | undefined)[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

/** Nazwa biletu i grupy w JĘZYKU EKSPORTU - organizator czyta plik w swoim. */
function localized(pl: string | null, en: string | null, lang: "pl" | "en"): string {
  return lang === "en" ? firstFilled(en, pl) : firstFilled(pl, en);
}

export function registrationsToCsv(
  rows: readonly EventRegistrationRow[],
  lang: "pl" | "en",
): string {
  return csvDocument(
    REGISTRATION_CSV_COLUMNS,
    rows.map((row) => [
      row.first_name,
      row.last_name,
      row.email,
      row.phone,
      row.job_title,
      // Firma z kartoteki wygrywa nad wpisaną ręcznie: to ona jest tą, którą
      // redakcja potwierdziła.
      firstFilled(row.company_name, row.company_text),
      localized(row.ticket_name_pl, row.ticket_name_en, lang),
      localized(row.group_name_pl, row.group_name_en, lang),
      row.status,
      row.registration_mode,
      row.source,
      row.waitlist_position,
      row.created_at,
      row.decided_at,
      row.decision_source,
      row.decision_note,
      row.attended_at,
      row.cancelled_at,
      row.consent_data_processing_at,
      row.consent_marketing_at,
      row.consent_partner_sharing_at,
      row.consent_withdrawn_at,
    ]),
  );
}

/** `uczestnicy-<slug>-<dzien>.csv` - plik ma się sam opisywać w katalogu Pobrane. */
export function registrationsCsvFileName(eventSlug: string, nowIso: string): string {
  const slug = eventSlug.trim() === "" ? "event" : eventSlug.trim();
  return csvFileNameFor(`uczestnicy-${slug}`, nowIso);
}
