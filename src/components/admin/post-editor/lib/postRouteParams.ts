// Czyste reguły WEJŚCIA do edytora wpisu - parametr `?lang=` trasy
// `/admin/posts/$slug` oraz bramka jednorazowego utworzenia szkicu na trasie
// `/admin/posts/new`.
//
// Obie siedziały w trasach: pierwsza w `validateSearch` (odpalanym wyłącznie
// przez router), druga w warunku `useEffect` (odpalanym wyłącznie przez
// Reacta). Obie rozstrzygają rzeczy, których użytkownik nie umie cofnąć:
// w jakiej wersji językowej otwiera się edytor i ile szkiców powstanie po
// jednym kliknięciu „Nowy wpis”.

/** Wersja językowa wpisu, w której otwiera się edytor. */
export type PostLang = "pl" | "en";

/**
 * Walidacja `?lang=` z adresu. Przechodzą WYŁĄCZNIE "pl" i "en"; cokolwiek
 * innego (literówka, `?lang=de`, wstrzyknięta wartość) znika z wyszukiwania,
 * zamiast trafić do edytora jako trzeci, nieistniejący język - a stamtąd
 * do zapisu pól `title_<lang>`, których w tabeli nie ma.
 */
export function parsePostEditorSearch(search: Record<string, unknown>): { lang?: PostLang } {
  const lang = search.lang;
  return lang === "pl" || lang === "en" ? { lang } : {};
}

/**
 * Język edytora: parametr z listy WYGRYWA z językiem interfejsu. Redaktor,
 * który zawęził listę do wersji angielskiej i kliknął wiersz, ma dostać
 * edytor po stronie EN, choćby panel miał UI po polsku - inaczej pisałby
 * poprawki do niewłaściwej wersji.
 */
export function resolveEditorLang(
  searchLang: PostLang | undefined,
  uiLang: string | null | undefined,
): PostLang {
  return searchLang ?? ((uiLang ?? "pl").startsWith("en") ? "en" : "pl");
}

/** Wejście bramki tworzenia szkicu na `/admin/posts/new`. */
export interface NewPostGate {
  /** Sesja jeszcze się rozwiązuje. */
  loading: boolean;
  /** Poprzedni render już ustawił stan „zajęte”. */
  busy: boolean;
  /** Zalogowany użytkownik (cokolwiek prawdziwego) albo brak. */
  user: unknown;
  tenantId: string | null | undefined;
  /** Synchroniczny znacznik z `useRef` - jedyny, który zdąży w StrictMode. */
  alreadyStarted: boolean;
}

/**
 * Czy wolno wystartować tworzenie szkicu.
 *
 * React w trybie StrictMode uruchamia setup efektu DWUKROTNIE, a `busy` ze
 * `useState` aktualizuje się dopiero w kolejnym renderze - drugie uruchomienie
 * widzi jeszcze `busy === false`. Dlatego blokadą jest `alreadyStarted`
 * (ref), a nie `busy`: bez niej jedno kliknięcie „Nowy wpis” zostawia
 * w bazie DWA puste szkice, z których jeden nigdy nie zostanie otwarty.
 *
 * Brak tenanta blokuje tak samo jak brak użytkownika: szkic bez `tenant_id`
 * nie należałby do żadnego obszaru i nie pokazałby się na liście.
 */
export function shouldStartPostCreation(gate: NewPostGate): boolean {
  if (gate.loading) return false;
  if (gate.busy) return false;
  if (!gate.user) return false;
  if (!gate.tenantId) return false;
  return !gate.alreadyStarted;
}
