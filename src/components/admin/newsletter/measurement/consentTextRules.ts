// Reguły panelu treści zgody na newsletter i pomiaru (I9d-Y2) - moduł czysty,
// bez Reacta.
//
// Osobny liść, bo czytają go trzy leniwe chunki: karta treści zgody (stan
// pola, szkic), karta „Poproś o zgodę na pomiar" (kotwica edytora treści
// maila) i sam edytor treści maila (kotwica) - import z modułu komponentu
// wciągałby całą kartę do chunku edytora i odwrotnie.
//
// STAN POLA = BAZA + JEDNO ŹRÓDŁO TS. Baza (`admin_newsletter_consent_
// measurement_get`) mówi, czy ZAPISANY tekst jest bieżącą treścią domyślną
// albo ma ważne oznaczenie admina. Formularze publiczne traktują jednak
// także DAWNE treści domyślne (sprzed Y2, `LEGACY_NEWSLETTER_CONSENT_
// DEFAULTS`) jak domyślną i pokazują bieżącą treść z pomiarem - panel nie
// może ostrzegać o tekście, którego czytelnik nie zobaczy. Dlatego „domyślna"
// = baza ALBO `isNewsletterConsentDefault` zapisanego tekstu; reszta wynika
// z `covers` bazy (oznaczenie admina), nigdy z heurystyki słów.
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { isNewsletterConsentDefault, type ConsentLang } from "@/lib/newsletter/consentText";
import type { ConsentMeasurementFieldDto } from "@/lib/privacy/measurementParse";

/** Kotwica edytora treści maila „Poproś o zgodę na pomiar" (treści maili newslettera). */
export const NEWSLETTER_MEASUREMENT_COPY_ANCHOR = "newsletter-measurement-copy";

/** Języki treści zgody w kolejności pól. */
export const CONSENT_TEXT_LANGS: readonly ConsentLang[] = ["pl", "en"];

/** Kolumna `newsletter_settings` z treścią zgody (grupa `inline`). */
export const CONSENT_POLICY_FIELD = {
  pl: "policy_html_pl",
  en: "policy_html_en",
} as const satisfies Record<ConsentLang, keyof NewsletterSettings>;

export type ConsentDraft = Record<ConsentLang, string>;

/** Szkic z zapisanego wiersza - `null` w kolumnie to puste pole (treść domyślna z TS). */
export function consentDraftFrom(settings: Pick<NewsletterSettings, "policy_html_pl" | "policy_html_en">): ConsentDraft {
  return { pl: settings.policy_html_pl ?? "", en: settings.policy_html_en ?? "" };
}

/**
 * Wartość kolumny z pola edytora. Puste (po obcięciu brzegów) = `null`:
 * formularz pokazuje wtedy bieżącą treść domyślną z wersją z pomiarem, więc
 * „Przywróć domyślną" nie zapisuje kopii tekstu (kopia zestarzałaby się przy
 * następnej wersji treści). Tekst niepusty idzie BEZ zmian - nic nie jest
 * przycinane ani poprawiane po cichu.
 */
export function consentColumnValue(text: string): string | null {
  return text.trim() === "" ? null : text;
}

/** Czy pole szkicu różni się od zapisanego (puste ≡ `null`). */
export function consentFieldDirty(draft: string, saved: string | null | undefined): boolean {
  return consentColumnValue(draft) !== consentColumnValue(saved ?? "");
}

export function consentDraftDirty(
  draft: ConsentDraft,
  saved: Pick<NewsletterSettings, "policy_html_pl" | "policy_html_en">,
): boolean {
  return CONSENT_TEXT_LANGS.some((lang) =>
    consentFieldDirty(draft[lang], saved[CONSENT_POLICY_FIELD[lang]]),
  );
}

/**
 * Stan zapisanej treści zgody pola:
 *   * `default` - puste pole, bieżąca albo dawna treść domyślna (formularz
 *     pokazuje treść z pomiarem);
 *   * `marked` - własny tekst z ważnym oznaczeniem admina;
 *   * `uncovered` - własny tekst bez ważnego oznaczenia: zapis z formularza
 *     NIE daje zgody na pomiar (ostrzeżenie);
 *   * `unknown` - baza jeszcze nie odpowiedziała (albo funkcji nie ma).
 */
export type ConsentFieldStatus = "default" | "marked" | "uncovered" | "unknown";

export function consentFieldStatus(
  saved: string | null | undefined,
  field: ConsentMeasurementFieldDto | null | undefined,
): ConsentFieldStatus {
  if (isNewsletterConsentDefault(saved)) return "default";
  if (!field) return "unknown";
  if (!field.textPresent || field.isDefault) return "default";
  return field.covers === true ? "marked" : "uncovered";
}

/**
 * Ostrzeżenie PRZED zapisem: szkic zmienia tekst na własny (nie domyślny) -
 * po zapisie nie obejmie pomiaru, dopóki admin go nie oznaczy (oznaczenie
 * dotyczy skrótu zapisanego tekstu, więc każda zmiana je unieważnia).
 */
export function draftLosesMeasurement(draft: string, saved: string | null | undefined): boolean {
  return consentFieldDirty(draft, saved) && !isNewsletterConsentDefault(draft);
}
