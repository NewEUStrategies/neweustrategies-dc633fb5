// Która strona CMS jest stroną główną serwisu - JEDNA definicja dla każdej
// powierzchni, która musi to wiedzieć bez renderowania `/`.
//
// PO CO. Strona wskazana w ustawieniach czytania (np. `main`) jest serwowana
// pod `/`, ale zostaje zwykłym wierszem `pages` - więc odpowiadała TAKŻE pod
// własnym slugiem (`/main`, `/en/main`) z własnym kanonicznym adresem. Mapa
// XML (`sitemaps/pages.xml`) i mapa HTML (`/sitemap`) ogłaszały ją jako drugą
// „Stronę główną", a Google dostawał dwie kopie tej samej treści. Mapa HTML
// miała slug `home` wpisany na sztywno - przy stronie głównej `main` filtr nie
// działał wcale.
//
// Kolejność rozstrzygania jest lustrem `homePageQueryOptions`
// (`src/lib/queries/public.ts`), które wybiera stronę renderowaną pod `/`:
//   0. tryb „najnowsze wpisy" - żadna strona nie jest stroną główną,
//   1. tryb „strona statyczna": `homepage_page_id`, potem `homepage_page_slug`
//      (strona najwyższego poziomu),
//   2. zawsze na końcu: strona najwyższego poziomu o slugu `home`.
// Moduł jest czysty (bez I/O) - wołający podaje listę OPUBLIKOWANYCH stron.

/** Ustawienia czytania (`site_settings["reading"]`) w zakresie, który tu się liczy. */
export interface HomepageReadingSettings {
  homepage_mode?: unknown;
  homepage_page_id?: unknown;
  homepage_page_slug?: unknown;
}

/** Minimalny kształt wiersza `pages` potrzebny do rozstrzygnięcia. */
export interface HomepageCandidatePage {
  id: string;
  slug: string;
  parent_id: string | null;
}

/** Slug strony głównej używany, gdy ustawienia niczego nie wskazują. */
export const LEGACY_HOMEPAGE_SLUG = "home";

// Bez `trim()`: zapytanie `/` przekazuje wartości do `.eq()` dosłownie, więc
// „ main " nie trafia tam w stronę `main`. Przycięcie tutaj dałoby 301 z `/main`
// przy `/` renderującym stronę `home` (przegląd 2026-10).
function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Id strony renderowanej pod `/` albo `null` (tryb wpisów albo brak strony).
 * `pages` to strony opublikowane i nieusunięte - tak jak w zapytaniu `/`.
 */
export function configuredHomepagePageId(
  reading: HomepageReadingSettings | null | undefined,
  pages: readonly HomepageCandidatePage[],
): string | null {
  const mode = reading?.homepage_mode;
  if (mode === "latest_posts") return null;
  if (mode === "static_page") {
    const id = nonEmptyString(reading?.homepage_page_id);
    if (id && pages.some((page) => page.id === id)) return id;
    const slug = nonEmptyString(reading?.homepage_page_slug);
    if (slug) {
      const bySlug = pages.find((page) => page.parent_id === null && page.slug === slug);
      if (bySlug) return bySlug.id;
    }
  }
  const legacy = pages.find(
    (page) => page.parent_id === null && page.slug === LEGACY_HOMEPAGE_SLUG,
  );
  return legacy?.id ?? null;
}
