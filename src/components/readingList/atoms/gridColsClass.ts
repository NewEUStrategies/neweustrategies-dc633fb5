// Klasy siatki listy czytelniczej dla liczby kolumn z ustawień personalizacji.
//
// ATOM: czysta prezentacja, zero I/O, zero stanu serwera. Wartość przychodzi
// z panelu administratora (`sections.*.columns`), więc funkcja MUSI mieć
// sensowne wyjście dla liczby, której nie zna - 3 kolumny to ten sam domyślny
// układ, jaki miała trasa przed wyprowadzeniem.
//
// Klasy są wypisane w PEŁNEJ postaci (nie składane ze fragmentów), bo skaner
// Tailwinda czyta literały - `lg:grid-cols-${cols}` nie wygenerowałoby CSS-u.
export function gridColsClass(cols: number): string {
  return cols === 2
    ? "grid-cols-1 md:grid-cols-2"
    : cols === 4
      ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";
}
