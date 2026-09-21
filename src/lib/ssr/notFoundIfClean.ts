// 404 WYŁĄCZNIE Z CZYSTEGO ODCZYTU - jedno miejsce zamiast warunku
// przepisywanego ręcznie w każdym loaderze tożsamościowym.
//
// PROBLEM. `loadResilient` nigdy nie rzuca i zawsze oddaje wartość - także
// wtedy, gdy backend nie odpowiedział w budżecie. Dla zapytania
// TOŻSAMOŚCIOWEGO („czy ta strona istnieje?") fallbackiem jest `null`, więc
// naiwne `if (!result.data) throw notFound()` zamienia KAŻDY blip w twarde
// HTTP 404 na żywej, zaindeksowanej stronie. 404 nie jest błędem przejściowym:
// wyszukiwarka wyrzuca po nim URL z indeksu, a powrót zajmuje dni. Dokładnie
// ten defekt niosły `programs.$slug.tsx` (`.catch(() => null)` -> `notFound()`)
// oraz `category.$slug.tsx` / `tag.$slug.tsx`.
//
// KONTRAKT, wprost:
//   * odczyt CZYSTY + `null`      -> `notFound()`; 404 jest PRAWDĄ,
//   * odczyt CZYSTY + wiersz      -> wiersz,
//   * odczyt ZDEGRADOWANY         -> `null` BEZ rzutu; „nie wiemy" ma wyjść
//     jako HTTP 200 `private, no-store` z uczciwym komunikatem i ponowieniem,
//     a nie jako wyrok na URL-a.
//
// Wzór wyjściowy: `events.$slug.tsx:143` (`if (!degraded && header.data ===
// null) throw notFound()`) i `series.$slug.tsx:47`. Ta funkcja jest ich
// wspólnym mianownikiem, nie nowym wariantem.
import { notFound } from "@tanstack/react-router";

/**
 * Wynik odpornego ładowania w kształcie, którego ta reguła potrzebuje.
 * Celowo STRUKTURALNY (a nie `ResilientLoad<T | null>`): wywołujący bywa
 * składany ręcznie z danych pochodnych - np. plan wyszukany na liście planów,
 * gdzie `degraded` niesie odczyt listy, a `data` jest już wynikiem `find`.
 */
export interface CleanReadResult<TData> {
  readonly data: TData | null;
  readonly degraded: boolean;
}

/**
 * Rzuca `notFound()` WYŁĄCZNIE dla czystego odczytu, który oddał `null`.
 * Przy degradacji zwraca `null` - wołający renderuje wtedy stan zdegradowany
 * (HTTP 200 `no-store`), zamiast wypisywać stronę z indeksu.
 */
export function notFoundIfClean<TData>(result: CleanReadResult<TData>): TData | null {
  if (result.degraded) return null;
  if (result.data === null) throw notFound();
  return result.data;
}
