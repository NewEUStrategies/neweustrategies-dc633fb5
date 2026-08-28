// ARKUSZ IDENTYFIKATORÓW - czysta logika wydruku (bez React, bez sieci).
//
// FORMAT PAPIERU JEST LICZBĄ, NIE NAZWĄ. Drukarka nie rozumie „a6" - potrzebuje
// milimetrów. Tablica formatów żyje tutaj, żeby ten sam wymiar dostał podgląd
// na ekranie, arkusz do druku i walidacja szablonu; rozjazd między nimi daje
// identyfikator obcięty dopiero na papierze, czyli w momencie bez odwrotu.
//
// BRAK KODU QR TO STAN, NIE BŁĄD. Osoba bez zapisu (walk-in dodany ręcznie)
// dostaje identyfikator bez kodu - baza nie ma czego zahaszować. Karta musi
// wyjść z drukarki mimo to, tylko oznaczona, bo bramka wpuści ją ręcznie.
import type { Json } from "@/integrations/supabase/types";
import type { BadgeOrientation, BadgePaperFormat } from "@/lib/events/onsiteApi";

export interface BadgeCard {
  personId: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  company: string | null;
  registrationId: string | null;
  registrationStatus: string | null;
  ticketNamePl: string | null;
  ticketNameEn: string | null;
  groupNamePl: string | null;
  groupNameEn: string | null;
  groupColor: string | null;
  /** Jawny kod QR - wraca RAZ, przy wydaniu; `null` = osoba bez zapisu. */
  qrCode: string | null;
}

export interface BadgeBatch {
  eventId: string;
  templateId: string | null;
  issuedAt: string;
  badges: BadgeCard[];
}

export interface BadgeSizeMm {
  widthMm: number;
  heightMm: number;
}

/** Wymiary bazowe formatów (pion) - `custom` bierze wymiary z szablonu. */
const PAPER_MM: Record<Exclude<BadgePaperFormat, "custom">, BadgeSizeMm> = {
  a6: { widthMm: 105, heightMm: 148 },
  a7: { widthMm: 74, heightMm: 105 },
  cr80: { widthMm: 54, heightMm: 86 },
};

export const BADGE_FALLBACK_MM: BadgeSizeMm = { widthMm: 105, heightMm: 148 };

function isPaperFormat(value: string): value is BadgePaperFormat {
  return value === "a6" || value === "a7" || value === "cr80" || value === "custom";
}

/**
 * Rozmiar karty w milimetrach dla szablonu.
 *
 * Orientacja pozioma obraca bok dłuższy - nie skaluje, bo identyfikator
 * poziomy to ten sam papier obrócony, a nie inny papier.
 */
export function badgeSizeMm(input: {
  paperFormat: string;
  orientation: string;
  widthMm?: number | null;
  heightMm?: number | null;
}): BadgeSizeMm {
  const format: BadgePaperFormat = isPaperFormat(input.paperFormat) ? input.paperFormat : "a6";
  const base: BadgeSizeMm =
    format === "custom"
      ? {
          widthMm:
            typeof input.widthMm === "number" && input.widthMm > 0
              ? input.widthMm
              : BADGE_FALLBACK_MM.widthMm,
          heightMm:
            typeof input.heightMm === "number" && input.heightMm > 0
              ? input.heightMm
              : BADGE_FALLBACK_MM.heightMm,
        }
      : PAPER_MM[format];

  const orientation: BadgeOrientation = input.orientation === "landscape" ? "landscape" : "portrait";
  return orientation === "landscape"
    ? { widthMm: base.heightMm, heightMm: base.widthMm }
    : base;
}

/* ------------------------------------------------------------- parsowanie --- */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === "string" ? value : "";
}

function nullableText(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** Zamienia ładunek `admin_event_badge_batch` w typowane karty. */
export function parseBadgeBatch(value: Json | unknown): BadgeBatch {
  const root = asRecord(value);
  const list = Array.isArray(root.badges) ? root.badges : [];
  return {
    eventId: text(root, "event_id"),
    templateId: nullableText(root, "template_id"),
    issuedAt: text(root, "issued_at"),
    badges: list.map((item) => {
      const row = asRecord(item);
      return {
        personId: text(row, "person_id"),
        firstName: text(row, "first_name"),
        lastName: text(row, "last_name"),
        jobTitle: nullableText(row, "job_title"),
        company: nullableText(row, "company"),
        registrationId: nullableText(row, "registration_id"),
        registrationStatus: nullableText(row, "registration_status"),
        ticketNamePl: nullableText(row, "ticket_name_pl"),
        ticketNameEn: nullableText(row, "ticket_name_en"),
        groupNamePl: nullableText(row, "group_name_pl"),
        groupNameEn: nullableText(row, "group_name_en"),
        groupColor: nullableText(row, "group_color"),
        qrCode: nullableText(row, "qr_code"),
      };
    }),
  };
}

/** Imię i nazwisko w jednej linii, bez podwójnych spacji przy braku pola. */
export function badgeFullName(card: BadgeCard): string {
  return `${card.firstName} ${card.lastName}`.replace(/\s+/g, " ").trim();
}

/** Nazwa biletu/grupy w języku interfejsu, z sensownym fallbackiem. */
export function badgeLocalized(pl: string | null, en: string | null, lang: string): string | null {
  const primary = lang === "en" ? en : pl;
  const secondary = lang === "en" ? pl : en;
  return primary !== null && primary !== "" ? primary : secondary;
}
