// REZERWACJA DOLNEJ KRAWĘDZI EKRANU - kontrakt między paskiem doku, CSS-em
// i skryptem sprzed pierwszego malowania.
//
// ── PROBLEM, KTÓRY TEN MODUŁ ROZSTRZYGA ───────────────────────────────────
// Pasek doku jest `position: fixed` przy dolnej krawędzi, więc bez rezerwacji
// zasłania stopkę i ostatni akapit treści. Rezerwację robi CSS
// (`html[data-mbb="on"]` w `styles.css`) na podstawie ZMIERZONEJ wysokości
// paska, publikowanej jako `--mbb-space`.
//
// Dotąd oba zapisy szły z efektu Reacta - a dok pojawia się PÓŹNO: sesja
// Supabase rozstrzyga się w efekcie (`useAuth`), potem trzeba dociągnąć
// leniwą paczkę powłoki, a dopiero na końcu biegnie pomiar. Na zimnym cache
// to sekundy po pierwszym malowaniu, po których dół strony podskakuje. CLS
// nalicza się przez całe życie strony, nie tylko w okienku wczytania, więc to
// jest realny koszt, a nie kosmetyka.
//
// ── ROZWIĄZANIE: ZAPAMIĘTANA WYSOKOŚĆ + SKRYPT SPRZED MALOWANIA ───────────
// Pasek zapisuje zmierzoną wysokość lokalnie. Przy KAŻDYM następnym wejściu
// skrypt w `<head>` (wykonywany przed pierwszym malowaniem, zanim React
// wstanie - ten sam wzorzec co `THEME_INIT_SCRIPT`) odczytuje tę liczbę
// i od razu włącza rezerwację. Efekt: pierwszy paint już ma poprawny dół
// strony, a przeskoku nie ma wcale.
//
// Dlaczego liczba, a nie stan sesji: skrypt NIE CZYTA tokenu ani danych
// uwierzytelnienia - wyłącznie liczbę pikseli własnego paska. Nie ma tu czego
// wyciec i nie ma zależności od formatu magazynu Supabase.
//
// ── DLACZEGO SKRYPT ZNA TRASĘ ─────────────────────────────────────────────
// Dok nie renderuje się w `/admin` ani `/login` (bramka w `SiteChrome`), więc
// rezerwacja byłaby tam pustym pasem. Skrypt sprawdza `location.pathname`
// tą samą regułą co powłoka - jedno źródło prawdy jest w `isDockSuppressedPath`,
// a treść skryptu składa się z tej funkcji, żeby obie strony nie mogły
// rozjechać się w przyszłości.
//
// ── DLACZEGO ZNACZNIK MUSI BYĆ CZYSZCZONY ────────────────────────────────
// Po wylogowaniu paska nie ma, a znacznik by został - i każda strona dostałaby
// pas rezerwacji pod niczym. Dlatego `signOut` w `useAuth` woła
// `clearReservedSpace()`. To jedyne miejsce, które wie o wylogowaniu.

/** Klucz zapamiętanej wysokości paska. Wersjonowany jak reszta kluczy doku. */
export const DOCK_RESERVE_KEY = "nes.dock.reserve.v1";

/** Atrybut na `<html>`, od którego CSS uzależnia rezerwację. */
export const DOCK_RESERVE_ATTR = "mbb";

/** Właściwość niestandardowa niosąca zmierzoną wysokość paska. */
export const DOCK_RESERVE_PROP = "--mbb-space";

/**
 * Górny limit zapisywanej wysokości. Pasek ma ~33 px (mobile) do ~38 px
 * (desktop); 200 px to zapas na duże ustawienia czcionki i jednocześnie
 * bezpiecznik: uszkodzona albo podmieniona wartość w magazynie nie zepchnie
 * treści na środek ekranu.
 */
export const DOCK_RESERVE_MAX_PX = 200;

/**
 * Ścieżki, na których dok się nie renderuje - te same, których pilnuje
 * `SiteChrome`. Skrypt sprzed malowania składa swój warunek z tej funkcji,
 * więc nie da się zmienić jednej strony bez drugiej.
 */
export function isDockSuppressedPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/login" ||
    pathname.startsWith("/login/")
  );
}

/**
 * Zawężenie zmierzonej wysokości do liczby, którą wolno opublikować.
 * Zwraca `null`, gdy wartość jest bezużyteczna (zero, ujemna, NaN, absurdalna)
 * - wtedy wywołujący NIE publikuje niczego i zostaje zapas z CSS.
 */
export function normalizeReservedSpace(value: unknown): number | null {
  const px = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(px)) return null;
  const rounded = Math.round(px);
  if (rounded <= 0 || rounded > DOCK_RESERVE_MAX_PX) return null;
  return rounded;
}

/** Odczyt zapamiętanej wysokości. Brak magazynu i śmieci dają `null`. */
export function readReservedSpace(storage: Pick<Storage, "getItem"> | null): number | null {
  if (!storage) return null;
  try {
    return normalizeReservedSpace(storage.getItem(DOCK_RESERVE_KEY));
  } catch {
    return null;
  }
}

/**
 * Zapis zapamiętanej wysokości. `null` USUWA klucz - tego wariantu używa
 * wylogowanie, żeby następna sesja nie dostała pasa pod nieistniejącym paskiem.
 */
export function writeReservedSpace(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  px: number | null,
): void {
  if (!storage) return;
  const value = px === null ? null : normalizeReservedSpace(px);
  try {
    if (value === null) storage.removeItem(DOCK_RESERVE_KEY);
    else storage.setItem(DOCK_RESERVE_KEY, String(value));
  } catch {
    /* tryb prywatny - rezerwacja zadziała po pomiarze, tylko bez wyprzedzenia */
  }
}

/**
 * Zdjęcie rezerwacji: znacznik, właściwość i zapamiętana wysokość.
 * Woła to `signOut` - patrz nagłówek modułu.
 */
export function clearReservedSpace(): void {
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    delete root.dataset[DOCK_RESERVE_ATTR];
    root.style.removeProperty(DOCK_RESERVE_PROP);
  }
  if (typeof window !== "undefined") writeReservedSpace(window.localStorage, null);
}

/**
 * Treść skryptu wstrzykiwanego do `<head>`. IIFE w jednej linii - każdy znak
 * to bajt na krytycznej ścieżce, dokładnie jak w `THEME_INIT_SCRIPT`.
 *
 * Składana z tego modułu (a nie wpisana literałem w `__root.tsx`), żeby dała
 * się PRZECZYTAĆ i WYKONAĆ w teście - literał w korzeniu był nietestowalny,
 * a to jest kod, którego literówka rusza układ każdej podstrony.
 */
export const DOCK_RESERVE_INIT_SCRIPT =
  `(function(){try{` +
  `var p=location.pathname;` +
  `if(p==='/admin'||p.indexOf('/admin/')===0||p==='/login'||p.indexOf('/login/')===0)return;` +
  `var h=parseInt(localStorage.getItem('${DOCK_RESERVE_KEY}'),10);` +
  `if(!(h>0)||h>${DOCK_RESERVE_MAX_PX})return;` +
  `var r=document.documentElement;` +
  `r.dataset.${DOCK_RESERVE_ATTR}='on';` +
  `r.style.setProperty('${DOCK_RESERVE_PROP}',h+'px');` +
  `}catch(e){}})();`;
