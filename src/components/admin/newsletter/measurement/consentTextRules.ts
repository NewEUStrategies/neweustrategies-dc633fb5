// Reguły panelu treści zgody na newsletter i pomiaru (I9d-Y2, I9d-Y2b) -
// moduł czysty, bez Reacta.
//
// Osobny liść, bo czytają go trzy leniwe chunki: karta treści zgody (stan
// pola, szkic, ostrzeżenie), karta „Poproś o zgodę na pomiar" (kotwica
// edytora treści maila) i sam edytor treści maila (kotwica) - import
// z modułu komponentu wciągałby całą kartę do chunku edytora i odwrotnie.
// Czyta go też zakładka „Pola" popupu rejestracji (etykieta zgody na
// newsletter).
//
// WARIANT (b) OD 2026-10-23 (decyzja właściciela D1): KAŻDA ZGODA MA OSOBNE
// POLE. Treść zgody na newsletter nie dotyczy pomiaru otwarć i kliknięć -
// pomiar ma osobne, domyślnie niezaznaczone pole z własną, wersjonowaną
// treścią (`measurementConsentText.ts`), a zgodę na pomiar zapisuje
// wyłącznie potwierdzenie właściciela skrzynki (D2). Oznaczenia admina „mój
// tekst obejmuje pomiar" z wariantu (a) nie ma - żaden tekst zgody na
// newsletter nie daje pomiaru, więc panel nie ma czego oznaczać.
//
// STAN POLA = JEDNO ŹRÓDŁO TS. „Domyślna" = puste pole, bieżąca albo dawna
// treść domyślna (`isNewsletterConsentDefault`; formularz pokazuje wtedy
// bieżącą treść (b) z wersją), reszta to tekst własny admina - bez wersji,
// z zapisanym skrótem treści.
//
// OSTRZEŻENIE (R1.24, lustro kontroli K5b runbooka). Własny tekst zgody na
// newsletter, który wspomina pomiar (`mierz|pomiar|measur`), zostałby
// odebrany jako zgoda na pomiar, a nią nie jest - opis pomiaru należy do
// osobnego pola. Panel ostrzega (nie blokuje zapisu: słowo może paść
// w innym znaczeniu, decyzja należy do redakcji). To samo wyrażenie
// regularne co K5b (`~* 'mierz|pomiar|measur'`), więc panel i kontrola SQL
// wskazują te same teksty.
import type { NewsletterSettings } from "@/hooks/useNewsletterSettings";
import { isNewsletterConsentDefault, type ConsentLang } from "@/lib/newsletter/consentText";

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
export function consentDraftFrom(
  settings: Pick<NewsletterSettings, "policy_html_pl" | "policy_html_en">,
): ConsentDraft {
  return { pl: settings.policy_html_pl ?? "", en: settings.policy_html_en ?? "" };
}

/**
 * Wartość kolumny z pola edytora. Puste (po obcięciu brzegów) = `null`:
 * formularz pokazuje wtedy bieżącą treść domyślną z wersją, więc „Przywróć
 * domyślną" nie zapisuje kopii tekstu (kopia zestarzałaby się przy
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
 * Stan treści zgody pola:
 *   * `default` - puste pole, bieżąca albo dawna treść domyślna (także
 *     pakietowa (a) z 2026-10-21): formularz pokazuje bieżącą treść (b)
 *     z wersją;
 *   * `custom` - tekst własny admina (bez wersji; dowodem jest zapisana
 *     treść i jej skrót).
 */
export type ConsentFieldStatus = "default" | "custom";

export function consentFieldStatus(text: string | null | undefined): ConsentFieldStatus {
  return isNewsletterConsentDefault(text) ? "default" : "custom";
}

/**
 * Słowa, po których rozpoznajemy opis pomiaru w treści zgody na newsletter
 * (PL „mierz…", „pomiar…", EN „measur…"). Lustro kontroli K5b runbooka
 * (`~* 'mierz|pomiar|measur'`) - zmiana tu wymaga zmiany tam.
 */
export const CONSENT_MEASUREMENT_MENTION = /mierz|pomiar|measur/i;

/**
 * Ostrzeżenie R1.24: WŁASNY tekst zgody na newsletter (pole ustawień,
 * etykieta pola „newsletter" popupu, treść zgody widżetu „Dołącz do nas",
 * etykieta zapisu w formularzu kontaktu) wspomina pomiar. Treść domyślna
 * (także dawna, z pomiarem) nie ostrzega - formularz i tak pokazuje bieżącą
 * treść (b) bez pomiaru.
 */
export function newsletterConsentMentionsMeasurement(text: string | null | undefined): boolean {
  if (isNewsletterConsentDefault(text)) return false;
  return CONSENT_MEASUREMENT_MENTION.test(text ?? "");
}
