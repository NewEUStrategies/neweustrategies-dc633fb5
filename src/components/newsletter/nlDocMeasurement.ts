// OSOBNE POLE ZGODY NA POMIAR W DOKUMENCIE BUILDERA NEWSLETTERA (NlDoc) -
// CZYSTE REGUŁY (I9d-Y2b, rozstrzygnięcia R1.17 i R1.21). Komponent wiersza:
// `./NlDocMeasurementConsent.tsx`; czytają je render publiczny
// (`NewsletterDocRenderer`) i płótno buildera (`NewsletterBuilder`).
//
// MODUŁ CZYSTY: bez Reacta i I/O.
import type { NlLang, NlSection } from "@/lib/newsletter-builder/types";
import { CONSENT_ENTRIES_MAX } from "@/lib/newsletter/consentLimits";

/**
 * Indeks sekcji, na której końcu stoi pole pomiaru: pierwsza sekcja
 * z widżetem `submit`, a bez niego - ostatnia; `-1` dla dokumentu bez sekcji.
 */
export function nlDocMeasurementSectionIndex(sections: readonly NlSection[]): number {
  const withSubmit = sections.findIndex((section) =>
    section.widgets.some((widget) => widget.type === "submit"),
  );
  return withSubmit >= 0 ? withSubmit : sections.length - 1;
}

/**
 * Liczba pozycji `consents`, którą formularz dokumentu wyśle: pola zgody
 * zaznaczone przez osobę + zgoda na newsletter (zawsze) + deklaracja pomiaru
 * (tylko po zaznaczeniu pola).
 */
export function nlDocConsentEntryCount(checkedConsentFields: number, measurement: boolean): number {
  return checkedConsentFields + 1 + (measurement ? 1 : 0);
}

/** Czy ładunek mieści się w limicie serwera (`CONSENT_ENTRIES_MAX`). */
export function nlDocConsentsWithinLimit(
  checkedConsentFields: number,
  measurement: boolean,
): boolean {
  return nlDocConsentEntryCount(checkedConsentFields, measurement) <= CONSENT_ENTRIES_MAX;
}

/** Komunikat przy ładunku ponad limit (formularz dokumentu ma napisy w kodzie). */
export const NL_DOC_TOO_MANY_CONSENTS: Record<NlLang, string> = {
  pl: `Zaznaczono za dużo zgód naraz (najwyżej ${CONSENT_ENTRIES_MAX} razem ze zgodą na newsletter). Odznacz zgody, których nie potrzebujesz, i spróbuj ponownie.`,
  en: `Too many consents are ticked at once (at most ${CONSENT_ENTRIES_MAX} including the newsletter consent). Untick the ones you do not need and try again.`,
};
