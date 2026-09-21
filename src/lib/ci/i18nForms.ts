// FORMY LICZEBNIKA W BRAMKACH SŁOWNIKA - jedno miejsce dla testów, które
// porównują klucze wołane w kodzie z kluczami stojącymi w słowniku.
//
// DLACZEGO TO POWSTAŁO. Klucz z formami liczebnika NIE ISTNIEJE pod własną
// nazwą: w słowniku stoją `droppedValues_one`, `_few`, `_many`, `_other`,
// a render woła `droppedValues` i dopiero i18next wybiera formę po `count`.
// Bramka porównująca nazwy znak w znak widzi wtedy dwie rzeczy naraz, obie
// fałszywe: że wołany klucz nie ma treści, i że treść w słowniku jest
// martwa, bo nikt jej nie woła. Pierwsza z tych pomyłek jest głośna
// (czerwona bramka), druga cicha - kusi, żeby „naprawić" ją usunięciem
// poprawnej formy.
//
// To ta sama zasada, którą zapisały wcześniej bramki parytetu PL/EN
// (`i18n-key-parity`, `i18nCohesion`): polski ma trzy formy istotne dla
// liczebnika (1 / 2-4 / 5+), angielski dwie, więc klucze porównuje się PO
// BAZIE, z odciętym sufiksem.

/** Kategorie liczebnika i18next. Kolejność bez znaczenia, zbiór - tak. */
export const SUFIKSY_LICZEBNIKA = ["zero", "one", "two", "few", "many", "other"] as const;

const SUFIKS = /_(?:zero|one|two|few|many|other)$/;

/** Nazwa klucza bez sufiksu formy: `droppedValues_many` -> `droppedValues`. */
export function bazaLiczebnika(nazwa: string): string {
  return nazwa.replace(SUFIKS, "");
}

/**
 * Czy ścieżka ma treść: wprost albo w formach liczebnika.
 *
 * Sam `_one` NIE WYSTARCZY i to jest tu najważniejsze sprawdzenie: dla dwóch
 * i więcej i18next nie znajdzie formy i wypisze na stronie surowy klucz.
 * Dlatego klucz liczebnikowy musi mieć formę pojedynczą ORAZ co najmniej
 * jedną mnogą - inaczej bramka przepuszczałaby połowę wdrożenia.
 */
export function maTresc(istnieje: (klucz: string) => boolean, sciezka: string): boolean {
  if (istnieje(sciezka)) return true;
  if (!istnieje(`${sciezka}_one`)) return false;
  return SUFIKSY_LICZEBNIKA.some((s) => s !== "one" && istnieje(`${sciezka}_${s}`));
}

/**
 * Konkretne klucze, pod którymi stoi treść tej ścieżki.
 *
 * Dla klucza zwykłego to ona sama, dla liczebnikowego - wszystkie formy, jakie
 * są w słowniku. Bramka czytająca TREŚĆ (na przykład po to, żeby sprawdzić
 * wstawki `{{...}}`) musi przejść po wszystkich: wstawka zgubiona w jednej
 * formie wychodzi surowymi klamrami dokładnie przy tej liczbie, która ją
 * wybiera, i przy żadnej innej.
 */
export function kluczeFormy(istnieje: (klucz: string) => boolean, sciezka: string): string[] {
  if (istnieje(sciezka)) return [sciezka];
  return SUFIKSY_LICZEBNIKA.map((s) => `${sciezka}_${s}`).filter(istnieje);
}
