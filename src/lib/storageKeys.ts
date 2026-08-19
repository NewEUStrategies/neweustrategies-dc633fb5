// Kanoniczne klucze magazynu przeglądarki (localStorage / sessionStorage).
//
// PO CO JEDNO MIEJSCE. Klucz `nes:saved-articles` był wpisany dosłownie w
// TRZECH plikach (hook zapisywania, scalanie stanu gościa po zalogowaniu,
// widok listy do przeczytania). Trzy literały to trzy okazje na literówkę,
// która nie wywala niczego - po prostu cicho gubi zapisane artykuły czytelnika.
//
// PREFIKS. Klucze noszą przedrostek `nes` (neweuropeanstrategies.com). Poprzedni
// przedrostek pochodził od dostawcy platformy i wyciekał do interfejsu: nazwa
// cookie językowego jest pokazywana w tabeli plików cookie w banerze zgód, więc
// była to nazwa WIDOCZNA dla użytkownika.
//
// MIGRACJA. Zmiana nazwy klucza to utrata stanu, jeśli zrobić ją naiwnie -
// czytelnik straciłby listę zapisanych artykułów, a admin swoją paletę. Dlatego
// każdy klucz zna swoje poprzednie nazwy, a `readStoredValue()` czyta je jako
// zapas i PRZEPISUJE wartość pod nową nazwę przy pierwszym odczycie. Zapis
// zawsze idzie pod nazwę kanoniczną, więc stare klucze wygasają same.

/** Klucz z historią nazw: `key` do zapisu, `legacy` tylko do odczytu. */
export interface StorageKey {
  readonly key: string;
  readonly legacy: readonly string[];
}

function storageKey(key: string, ...legacy: string[]): StorageKey {
  return { key, legacy };
}

/** Zapisane artykuły gościa (przed zalogowaniem) - localStorage. */
export const GUEST_SAVED_ARTICLES_KEY = storageKey("nes:saved-articles", "lovable:saved-articles");

/** Zapasowa kopia preferencji języka (źródłem prawdy jest cookie). */
export const LANG_STORAGE_KEY = storageKey("nes.lang", "lovable.lang");

/** Trwająca sesja podszycia się pod użytkownika (admin) - sessionStorage. */
export const IMPERSONATION_STORAGE_KEY = storageKey("nes:impersonation", "lovable:impersonation");

/** Paleta marki w edytorze kolorów globalnych (admin). */
export const BRAND_PALETTE_STORAGE_KEY = storageKey(
  "nes.globalColors.brandPalette.v1",
  "lovable.globalColors.brandPalette.v1",
);

/** Ostatnio użyte kolory w edytorze kolorów globalnych (admin). */
export const RECENT_COLORS_STORAGE_KEY = storageKey(
  "nes.globalColors.recentColors.v1",
  "lovable.globalColors.recentColors.v1",
);

/**
 * Odczyt z migracją: nazwa kanoniczna, a w jej braku kolejne nazwy historyczne.
 * Wartość znaleziona pod starą nazwą jest przepisywana pod nową (i stara
 * usuwana), więc migracja dzieje się raz, przy pierwszym dotknięciu, bez
 * osobnego kroku wdrożeniowego. Nigdy nie rzuca - `localStorage` bywa
 * zablokowany (tryb prywatny, polityka przeglądarki).
 */
export function readStoredValue(
  storage: Storage | undefined,
  { key, legacy }: StorageKey,
): string | null {
  if (!storage) return null;
  try {
    const current = storage.getItem(key);
    if (current !== null) return current;
    for (const name of legacy) {
      const value = storage.getItem(name);
      if (value === null) continue;
      try {
        storage.setItem(key, value);
        storage.removeItem(name);
      } catch {
        /* migracja jest best-effort - odczyt musi się udać nawet bez zapisu */
      }
      return value;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Zapis pod nazwę kanoniczną. Nigdy nie rzuca - ale ZWRACA, czy się udał.
 *
 * Brak wartości zwracanej był przyczyną defektu w „Zapisz na później": hook
 * owijał to wywołanie we WŁASNE `try/catch`, licząc na wyjątek, który nigdy tu
 * nie wychodzi. `catch` był więc martwy, a wykonanie leciało dalej do
 * „zapisano" - w trybie prywatnym Safari i przy wyczerpanym limicie użytkownik
 * widział potwierdzenie zapisu, którego w magazynie nie było.
 *
 * Wywołujący, którym wynik jest obojętny (np. odświeżenie klucza sesji), mogą
 * go dalej ignorować - dla nich kontrakt się nie zmienia.
 */
export function writeStoredValue(
  storage: Storage | undefined,
  { key }: StorageKey,
  value: string,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    /* brak miejsca / zablokowany magazyn - stan pozostaje w pamięci */
    return false;
  }
}

/** Usunięcie nazwy kanonicznej i wszystkich historycznych. Nigdy nie rzuca. */
export function removeStoredValue(storage: Storage | undefined, { key, legacy }: StorageKey): void {
  if (!storage) return;
  for (const name of [key, ...legacy]) {
    try {
      storage.removeItem(name);
    } catch {
      /* jw. */
    }
  }
}

/** Magazyn przeglądarki albo undefined poza przeglądarką / gdy zablokowany. */
export function browserStorage(kind: "local" | "session"): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return undefined;
  }
}
