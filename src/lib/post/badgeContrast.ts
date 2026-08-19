// Kontrast etykiety na tle koloru kategorii. Reguła WCAG, nie kosmetyka:
// redakcja ustawia kolor kategorii w /admin/category-colors dowolnie, a pigułka
// nad tytułem musi zostać czytelna na każdym z nich.
//
// DLACZEGO OSOBNY MODUŁ: `pickTextColor` była prywatna w `CategoryBadges.tsx`,
// więc dowód czytelności wymagał wyrenderowania linku z routerem i sprawdzania
// atrybutu `style`. Jako czysta funkcja jest sprawdzalna na całym spektrum
// kolorów, a nie na dwóch przykładach.

/** Próg luminancji, powyżej którego tło uznajemy za JASNE (ciemny napis). */
export const LIGHT_BACKGROUND_LUMINANCE = 0.6;

/** Napis na jasnym tle. */
export const DARK_TEXT = "#0b0b0d";
/** Napis na ciemnym tle. */
export const LIGHT_TEXT = "#ffffff";
/** Brak koloru kategorii - pigułka bierze kolory motywu, NIGDY żółtego. */
export const THEME_TEXT = "var(--background)";

/**
 * Kolor napisu dla tła podanego szesnastkowo.
 *
 *   pickTextColor("#ffffff") → ciemny napis
 *   pickTextColor("#0f172a") → jasny napis
 *   pickTextColor(null)      → kolor z motywu
 *
 * Wejście nie-6-znakowe (skrót `#fff`, `rgb(...)`, śmieć z bazy) degraduje do
 * koloru motywu - lepiej neutralna pigułka niż napis w kolorze tła.
 */
export function pickTextColor(hex: string | null | undefined): string {
  if (!hex) return THEME_TEXT;
  const m = hex.replace("#", "");
  if (m.length !== 6) return THEME_TEXT;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  // Luminancja względna (przybliżenie WCAG, wagi sRGB).
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > LIGHT_BACKGROUND_LUMINANCE ? DARK_TEXT : LIGHT_TEXT;
}

/** Etykieta kategorii w danym języku, z degradacją do drugiego. */
export function categoryLabel(
  category: { name_pl: string; name_en: string },
  lang: "pl" | "en",
): string {
  return lang === "en"
    ? category.name_en || category.name_pl
    : category.name_pl || category.name_en;
}

/** Adres archiwum kategorii - prefiks `/en/` wyłącznie dla wariantu angielskiego. */
export function categoryHref(slug: string, lang: "pl" | "en"): string {
  return `/${lang === "en" ? "en/" : ""}category/${slug}`;
}
