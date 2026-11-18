// Próg czytelności tekstu zgód w formularzach (RODO art. 7 ust. 2: zgoda
// w „zrozumiałej i łatwo dostępnej formie"). Rozmiar z CMS (`consentSize`)
// nie może zejść poniżej domyślnego rozmiaru zgody „Dołącz do nas" (11 px);
// ten sam próg ma minimum edytora rozmiarów w builderze
// (`EDIT_TARGET_META.consentSize.min`). Zmienia się WYŁĄCZNIE prezentacja -
// treść, wersja i ładunek zgody zostają bez zmian (reguła AGENTS o dowodzie
// zgody).

/** Minimalny (i domyślny) rozmiar tekstu zgody w px. */
export const CONSENT_MIN_FONT_PX = 11;

/**
 * Rozmiar zgody z CMS podniesiony do progu czytelności.
 * Brak, zero, wartość ujemna albo nieskończona = `undefined`: formularz
 * zostaje przy swoim rozmiarze domyślnym i nie emituje reguły rozmiaru.
 */
export function legibleConsentFontPx(size: number | null | undefined): number | undefined {
  if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) return undefined;
  return Math.max(CONSENT_MIN_FONT_PX, size);
}
