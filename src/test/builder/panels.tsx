// Wspólne narzędzia testów PANELI WŁAŚCIWOŚCI buildera (sekcja, kolumna,
// widget). Trzy rzeczy powtarzają się w każdym z tych testów i tylko dlatego
// stoją tutaj, a nie w plikach testowych:
//
//  1. Kontrolki wyboru w panelach to Radixowy `<Select>` BEZ etykiety - nazwę
//     dla czytnika ekranu daje im dopiero `Row`/`PropField` obok. Po podmianie
//     Radiksa na natywny `<select>` (patrz `radixSelectStub` w
//     `src/test/reactStubs.ts`) taką listę można rozpoznać wyłącznie po
//     ZBIORZE OPCJI - stąd `selectWithOption`.
//  2. Panele nie przyjmują nowej wartości, a MUTACJĘ obiektu stylu
//     (`onChange: (mut) => void`). Test, który tylko podgląda wywołania, nie
//     zobaczy więc wyniku - a wynik jest tu całą treścią zachowania (np. czy
//     zapis jednej strony odstępu zachował pozostałe). `MutableHost` trzyma
//     stan tak, jak robi to kanwa: świeży, płaski klon i mutacja na nim.
//  3. Panele dopisują wartości per breakpoint - `deviceValue` skraca odczyt.
import { useState, type ReactElement } from "react";

/**
 * Lista wyboru rozpoznana po tym, że MA opcję o danej wartości. Panele mają na
 * jednym ekranie po kilka list (typ ramki, tryb mieszania, wyrównanie), więc
 * indeks byłby kruchy - zbiór opcji jest stabilny i czytelny w asercji.
 */
export function selectWithOption(value: string): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll<HTMLSelectElement>("select")).find((select) =>
    select.querySelector(`option[value="${value}"]`),
  );
  if (!found) throw new Error(`test: brak listy z opcją "${value}"`);
  return found;
}

/** Wszystkie wartości opcji listy - do asercji na PEŁNEJ ofercie wyboru. */
export function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.querySelectorAll("option")).map((o) => o.value);
}

interface MutableHostProps<T extends object> {
  initial: T;
  /** Dostaje aktualną wartość i funkcję zapisu w kształcie panelu. */
  children: (value: T, apply: (mut: (draft: T) => void) => void) => ReactElement;
  /** Wywoływane po każdej mutacji - do asercji na CIĄGU zapisów. */
  onApplied?: (next: T) => void;
}

/**
 * Gospodarz stanu w kształcie, w jakim panel dostaje go z kanwy: płaski klon
 * poprzedniej wartości i mutacja wykonana NA KLONIE. Dzięki temu test widzi
 * dokładnie to, co zapisze dokument - w tym przypadki, w których panel czyta
 * wartość, którą sam dopiero co ustawił.
 */
export function MutableHost<T extends object>({
  initial,
  children,
  onApplied,
}: MutableHostProps<T>) {
  const [value, setValue] = useState<T>(initial);
  const apply = (mut: (draft: T) => void): void => {
    setValue((prev) => {
      const next = { ...prev };
      mut(next);
      onApplied?.(next);
      return next;
    });
  };
  return children(value, apply);
}
