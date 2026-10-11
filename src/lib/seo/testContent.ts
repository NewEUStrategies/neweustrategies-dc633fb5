// Treść TESTOWA serwisu: strony e2e i próbne nigdy nie są indeksowalne.
//
// PO CO (2026-10 audyt SEO). Na produkcji wisiały OPUBLIKOWANE strony
// `/test-e2e-zakup` i `/test-e2e-zakup-2` (oraz poddrzewo `/test/...`) - trafiały
// do `sitemaps/pages.xml`, do llms.txt i do podpowiedzi wyszukiwarki. Źródłem
// są wydarzenia zakładane przez testy e2e: `_event_seed_default_pages` tworzy
// stronę-korzeń ze slugu wydarzenia OD RAZU jako `published`.
//
// REGUŁA. Strona jest testowa, gdy jej slug ALBO slug któregokolwiek przodka
// zaczyna się od `test` lub `e2e` jako CAŁEGO pierwszego członu: `test`,
// `test-*`, `test_*`, `e2e`, `e2e-*`. Celowo nie łapiemy słów, które tylko
// zaczynają się tymi literami - `testament`, `testy-nato`, `testowanie-...`
// to prawdziwe treści. Wpis ma osobną regułę (`isTestContentTrail`): artykuł
// o „test-rakietowy-..." jest treścią, testowa może być wyłącznie jego sekcja.
//
// JEDNA DEFINICJA DLA KODU I BAZY. Ten sam wzorzec stoi w migracjach
// 20261011090100 (zasiew stron wydarzenia) i 20261011090200 (odpublikowanie
// zastanych stron) jako `~* '^(test|e2e)($|[-_])'`; test jednostkowy pilnuje,
// żeby się nie rozjechały.

/** Wzorzec slugu treści testowej - w bazie jako `slug ~* '<wzorzec>'`. */
export const TEST_CONTENT_SLUG_PATTERN = "^(test|e2e)($|[-_])";

const TEST_CONTENT_SLUG_RE = new RegExp(TEST_CONTENT_SLUG_PATTERN, "i");

/** Czy pojedynczy slug oznacza treść testową. */
export function isTestContentSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && TEST_CONTENT_SLUG_RE.test(slug.trim());
}

/**
 * Czy którykolwiek segment ścieżki (`/test/podstrona`, `sekcja/e2e-x`) jest
 * slugiem testowym. Ścieżka strony to łańcuch slugów jej przodków, więc to
 * jest reguła „strona albo jej przodek". Query i hash są pomijane, prefiks
 * języka (`en`) niczego nie zmienia - sam nie pasuje do wzorca.
 */
export function isTestContentPath(path: string | null | undefined): boolean {
  if (typeof path !== "string" || !path) return false;
  const bare = path.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  return bare.split("/").some((segment) => isTestContentSlug(segment));
}

/**
 * Czy dokument publiczny należy do treści testowej.
 *
 * `trail` to slugi łańcucha stron nad dokumentem (okruszki: dla STRONY łącznie
 * z nią samą, dla WPISU - strony-rodzica i jej przodków). Dla strony liczy się
 * też jej własny slug (okruszki mogą nie dojechać), dla wpisu - wyłącznie
 * sekcja, w której stoi: slug artykułu o teście rakietowym nie robi z niego
 * strony testowej.
 */
export function isTestContentTrail(
  kind: "page" | "post",
  ownSlug: string | null | undefined,
  trail: ReadonlyArray<{ slug?: string | null }>,
): boolean {
  if (kind === "page" && isTestContentSlug(ownSlug)) return true;
  return trail.some((crumb) => isTestContentSlug(crumb.slug));
}

/**
 * Czy zapis strony musi wymusić `seo_noindex = true`.
 *
 * Strona testowa może być opublikowana (zasiew wydarzenia e2e jej potrzebuje,
 * redakcja może celowo trzymać stronę próbną), ale NIGDY jako indeksowalna.
 * Szkic nie jest publiczny, więc go nie dotykamy; `scheduled` tak - cron
 * `publish_due_pages` opublikuje go bez udziału aplikacji.
 *
 * `parentPath` to pełna ścieżka NOWEGO rodzica (`page_full_path`) albo `null`,
 * gdy strona jest na najwyższym poziomie lub ścieżki nie dało się ustalić.
 */
export function testPageNeedsNoindex(input: {
  status: string;
  seoNoindex: boolean | null | undefined;
  slug: string | null | undefined;
  parentPath: string | null | undefined;
}): boolean {
  if (input.status !== "published" && input.status !== "scheduled") return false;
  if (input.seoNoindex) return false;
  return isTestContentSlug(input.slug) || isTestContentPath(input.parentPath);
}
