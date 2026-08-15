// Prymitywy JSON i tożsamości węzła - wspólny fundament OBU silników treści
// (bloki i builder) oraz warstw, które ich dokumenty zapisują (jsonb w Supabase).
//
// DLACZEGO TO TU MIESZKA
// `Json` był zdefiniowany dwa razy - w `lib/blocks/types.ts` i w
// `lib/builder/types.ts` - identycznym kształtem strukturalnym. TypeScript
// godził je po strukturze, więc rozjazd nigdy nie zapalał błędu, ale każdy
// plik przenoszący dane między silnikami musiał wybrać, który `Json` importuje.
// Ten wybór był realnym źródłem cyklu `bloki <-> builder`: moduł bloków
// sięgał po `toJson` do buildera wyłącznie dlatego, że tam stała escape-hatch,
// a nie dlatego, że potrzebował czegokolwiek z buildera.
//
// Tu jest jedna definicja pod oba silniki. Warstwa jest czysta: zero importów
// runtime, zero Reacta, zero Supabase - używalna z SSR, kanwy edytora,
// skryptów CI i testów jednostkowych bez montowania czegokolwiek.

/** Wartość serializowalna do `jsonb`. Jedna definicja dla obu silników treści. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Zawęża wartość typowaną do `Json` przed zapisem do mapy treści widgetu,
 * pola `data` bloku albo kolumny `jsonb`. Centralizuje podwójne rzutowanie
 * `value as unknown as Json`, żeby escape-hatch żył w JEDNYM audytowalnym
 * miejscu zamiast rozsypywać się po rendererach. Wołający zapewnia, że
 * wartość jest serializowalna do JSON-a.
 */
export const toJson = <T>(value: T): Json => value as unknown as Json;

/**
 * Wariant tablicowy {@link toJson} - dla pól typowanych `Json[]` (`items`,
 * `plans`, `columns`, `rows` w blokach). Istnieje, bo `toJson()` zwraca UNIĘ
 * `Json`, a przypisanie jej do pola `Json[]` wymaga jeszcze jednego zawężenia -
 * więc każde takie miejsce odtwarzało `next as unknown as Json[]` ręcznie,
 * wynosząc escape-hatch z powrotem POZA to jedno audytowalne miejsce, dla
 * którego ten moduł powstał. Kontrakt jak w `toJson`: wołający zapewnia, że
 * elementy są serializowalne do JSON-a.
 */
export const toJsonArray = <T>(values: readonly T[]): Json[] => values as unknown as Json[];

/**
 * Identyfikator węzła dokumentu buildera (sekcja / kolumna / widget).
 *
 * `crypto.randomUUID()` tam, gdzie jest (przeglądarka z bezpiecznym
 * kontekstem, Node 19+, workery). Fallback nie udaje UUID-a - ma być tylko
 * unikalny w obrębie dokumentu, a nie globalnie porównywalny.
 */
export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Identyfikator bloku. Krótszy i z prefiksem `b_`, bo trafia do atrybutów DOM
 * edytora bloków i do kotwic przypisów - czytelność w devtoolsach ma tu
 * wartość, a przestrzeń kolizji w obrębie jednego wpisu jest znikoma.
 */
export function newBlockId(): string {
  return "b_" + Math.random().toString(36).slice(2, 10);
}
