// KOMPAKTOWA KOPERTA ZAPYTAŃ W STANIE ODWODNIONYM (fala 3, P3.7b, T1).
//
// PO CO. Każdy dokument z chrome niesie w `$tsr` (bariera + strumień zapytań)
// kopertę KAŻDEGO zapytania: `queryHash`, czyli `queryKey` drugi raz jako JSON
// (klucz post-listy ma 17 parametrów), i ogon stanu, który dla zapytania
// rozstrzygniętego z sukcesem jest zawsze ten sam (`dataUpdateCount: 1`,
// `error: null`, ... `fetchStatus: "idle"`). Na fixture `/` to ok. 6 KB surowego
// HTML-u parsowanego i ewaluowanego w zadaniu bariery `$tsr` (diagnoza
// `faza3/diagnoza/waga-dokumentu.md` §2.1-2.2).
//
// KONTRAKT (sprawdzony w `node_modules`, `@tanstack/query-core` 5.101.2 i
// `@tanstack/router-ssr-query-core` 1.169.1):
//  * `hydrate` szuka zapytania po `queryHash` (`queryCache.get(queryHash)`);
//    `build` liczy hash z klucza, gdy go brak, ale `get(undefined)` NIE znajdzie
//    zapytania utworzonego wcześniej przez obserwatora (porcja strumienia po
//    zamontowaniu `useQuery`), a `build` oddaje wtedy istniejące zapytanie BEZ
//    danych;
//  * konstruktor `Query` przyjmuje `state` W CAŁOŚCI (brakujące pole byłoby
//    `undefined`, np. `errorUpdateCount + 1 = NaN`).
// Dlatego oba pola odtwarzamy na kliencie PRZED `hydrate` - dla bariery i dla
// każdej porcji strumienia (`expandRouterDehydrated`).
//
// ZASADY BEZPIECZEŃSTWA:
//  * `queryHash` znika WYŁĄCZNIE, gdy równa się `hashKey(queryKey)`, a klucz jest
//    STRUKTURALNY (prymitywy, tablice, obiekty proste) - zapytanie z własnym
//    `queryKeyHashFn` zachowuje swój hash z konstrukcji, a klucz z instancją
//    klasy też: klient liczy hash z klucza PO deserializacji seroval, gdzie
//    instancja wraca jako obiekt prosty z polami sortowanymi przez `hashKey`,
//    więc hash różniłby się od hasha `useQuery` (recenzja P3.7b, m4);
//  * ze stanu znikają WYŁĄCZNIE pola równe (`Object.is`) stałej niżej - pole
//    dodane w nowym query-core albo wartość inna niż domyślna jedzie dalej;
//  * `data` zostaje TĄ SAMĄ referencją, więc seroval dalej emituje `$R[n]` dla
//    danych współdzielonych z ładunkiem loadera (np. `homePage`);
//  * funkcje są czyste i nie mutują wejścia: integracja serwerowa zapisuje
//    `queryHash` oryginałów w `sentQueries`, zanim my dostaniemy kopertę.
// Kompaktowanie jest idempotentne, a rozwinięcie przyjmuje też pełną kopertę
// (dokument sprzed zmiany hydratuje się bez różnicy).
//
// KOSZT KLIENTA (runda poprawek 9). Do chunku wejściowego trafia WYŁĄCZNIE
// rozwijanie (`expandRouterDehydrated`, `expandDehydratedState`,
// `mapQueryStream`); kompaktowanie biegnie w gałęzi serwera `router.tsx`
// i jest wycinane z bundla klienta. Dlatego rozwijanie nie ma osłon, których
// przesyłka z naszego serwera nie potrzebuje: pustej listy mutacji nie
// odtwarzamy (`hydrate` query-core czyta `mutations || []`), a zapytanie
// rozwijamy bez sprawdzania kształtu (pełne zapytanie przechodzi bez zmiany
// treści). Liczenie `hashKey` na kliencie to cena za zdjęcie hashy
// z dokumentu: przenosi ok. 1,3-1,5 ms (bez dławienia CPU) z parsowania `$tsr`
// do makrozadania hydratacji (sonda CPU w PROVE pozycji, §5.4).
import { hashKey, type DehydratedState, type QueryKey } from "@tanstack/react-query";

/** Stały ogon stanu zapytania rozstrzygniętego z sukcesem (query-core 5.101.2). */
export const DEFAULT_SUCCESS_STATE = {
  dataUpdateCount: 1,
  error: null,
  errorUpdateCount: 0,
  errorUpdatedAt: 0,
  fetchFailureCount: 0,
  fetchFailureReason: null,
  fetchMeta: null,
  isInvalidated: false,
  status: "success",
  fetchStatus: "idle",
} as const;

type DehydratedQuery = DehydratedState["queries"][number];

/** Zapytanie w kopercie kompaktowej: `queryHash` opcjonalny, stan bez pól domyślnych. */
export type CompactDehydratedQuery = Omit<DehydratedQuery, "queryHash" | "state"> & {
  queryHash?: string;
  state: Partial<DehydratedQuery["state"]>;
};

/** Koperta kompaktowa: pusta lista mutacji też znika (`hydrate` czyta `mutations || []`). */
export interface CompactDehydratedState {
  mutations?: DehydratedState["mutations"];
  queries: CompactDehydratedQuery[];
}

const DEFAULTS: Readonly<Record<string, unknown>> = DEFAULT_SUCCESS_STATE;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Klucz, którego `hashKey` po deserializacji seroval jest taki sam jak na
 * serwerze: prymitywy, tablice i obiekty proste (prototyp `Object` albo `null`).
 */
function isStructuralKey(value: unknown): boolean {
  if (!isRecord(value)) return typeof value !== "function" && typeof value !== "symbol";
  if (Array.isArray(value)) return value.every(isStructuralKey);
  const proto: unknown = Object.getPrototypeOf(value);
  return (
    (proto === Object.prototype || proto === null) && Object.values(value).every(isStructuralKey)
  );
}

function compactQuery(query: DehydratedQuery): CompactDehydratedQuery {
  const { queryHash, state, ...rest } = query;
  const compactState: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) && Object.is(DEFAULTS[key], value)) {
      continue;
    }
    compactState[key] = value;
  }
  const out: CompactDehydratedQuery = { ...rest, state: compactState };
  if (!isStructuralKey(query.queryKey) || queryHash !== hashKey(query.queryKey)) {
    out.queryHash = queryHash;
  }
  return out;
}

/**
 * Serwer: koperta bez `queryHash` równego hashowi klucza i bez pól stanu równych
 * {@link DEFAULT_SUCCESS_STATE}. Wartość innego kształtu wraca bez zmian.
 */
export function compactDehydratedState(state: unknown): unknown {
  if (!isRecord(state) || !Array.isArray(state.queries)) return state;
  const { mutations, queries, ...rest } = state;
  const out: Record<string, unknown> = {
    ...rest,
    queries: (queries as DehydratedQuery[]).map((query) =>
      isRecord(query) && isRecord(query.state) && Array.isArray(query.queryKey)
        ? compactQuery(query)
        : query,
    ),
  };
  if (mutations !== undefined && !(Array.isArray(mutations) && mutations.length === 0)) {
    out.mutations = mutations;
  }
  return out;
}

/**
 * Klient: koperta, której oczekuje `hydrate` z query-core (odwrotność
 * {@link compactDehydratedState}; pustej listy mutacji nie odtwarza, bo `hydrate`
 * czyta `mutations || []`). Pełna koperta przechodzi bez zmian treści.
 */
export function expandDehydratedState(state: unknown): unknown {
  const queries = (state as { queries?: unknown } | null | undefined)?.queries;
  if (!Array.isArray(queries)) return state;
  return {
    ...(state as object),
    queries: (queries as CompactDehydratedQuery[]).map((query) => ({
      ...query,
      queryHash: query.queryHash ?? hashKey(query.queryKey as QueryKey),
      state: { ...DEFAULT_SUCCESS_STATE, ...query.state },
    })),
  };
}

/**
 * Strumień przepisujący każdą porcję funkcją `map` (koniec i błąd źródła
 * przechodzą dalej). Odczyt na żądanie (`pull`), bez `TransformStream`:
 * działa tak samo w Workers, w przeglądarce i w Node, a porcje już dostarczone
 * przechodzą w mikrozadaniach - przed ustąpieniem makrozadania po hydratacji
 * integracji (`router.tsx`).
 */
export function mapQueryStream<T>(
  source: ReadableStream<T>,
  map: (chunk: T) => T,
): ReadableStream<T> {
  const reader = source.getReader();
  return new ReadableStream<T>({
    pull: (controller) =>
      reader.read().then((result) => {
        if (result.done) controller.close();
        else controller.enqueue(map(result.value));
      }),
    cancel: (reason) => reader.cancel(reason),
  });
}

/**
 * Klient: ładunek routera z rozwiniętą kopertą bariery i strumieniem, który
 * rozwija każdą porcję - przekazywany do `hydrate` integracji router<->query
 * (ta czyta `queryStream` zawsze, a barierę tylko, gdy jest). Nowy obiekt.
 */
export function expandRouterDehydrated<T>(dehydrated: T): T {
  if (!dehydrated) return dehydrated;
  const { dehydratedQueryClient, queryStream } = dehydrated as {
    dehydratedQueryClient?: unknown;
    queryStream?: ReadableStream<unknown>;
  };
  return {
    ...dehydrated,
    dehydratedQueryClient: expandDehydratedState(dehydratedQueryClient),
    ...(queryStream && { queryStream: mapQueryStream(queryStream, expandDehydratedState) }),
  };
}
