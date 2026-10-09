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
//  * `queryHash` znika WYŁĄCZNIE, gdy równa się `hashKey(queryKey)` - zapytanie
//    z własnym `queryKeyHashFn` zachowuje swój hash z konstrukcji;
//  * ze stanu znikają WYŁĄCZNIE pola równe (`Object.is`) stałej niżej - pole
//    dodane w nowym query-core albo wartość inna niż domyślna jedzie dalej;
//  * `data` zostaje TĄ SAMĄ referencją, więc seroval dalej emituje `$R[n]` dla
//    danych współdzielonych z ładunkiem loadera (np. `homePage`);
//  * funkcje są czyste i nie mutują wejścia: integracja serwerowa zapisuje
//    `queryHash` oryginałów w `sentQueries`, zanim my dostaniemy kopertę.
// Kompaktowanie jest idempotentne, a rozwinięcie przyjmuje też pełną kopertę
// (dokument sprzed zmiany hydratuje się bez różnicy).
import { hashKey, type DehydratedState, type QueryKey } from "@tanstack/react-query";

/** Stały ogon stanu zapytania rozstrzygniętego z sukcesem (query-core 5.101.2). */
export const DEFAULT_SUCCESS_STATE = Object.freeze({
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
} as const);

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

function hasQueries(value: unknown): value is { mutations?: unknown; queries: unknown[] } {
  return isRecord(value) && Array.isArray(value.queries);
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
  if (queryHash !== hashKey(query.queryKey)) out.queryHash = queryHash;
  return out;
}

function expandQuery(query: CompactDehydratedQuery): DehydratedQuery {
  return {
    ...query,
    queryHash: query.queryHash ?? hashKey(query.queryKey as QueryKey),
    state: { ...DEFAULT_SUCCESS_STATE, ...query.state } as DehydratedQuery["state"],
  };
}

/**
 * Serwer: koperta bez `queryHash` równego hashowi klucza i bez pól stanu równych
 * {@link DEFAULT_SUCCESS_STATE}. Wartość innego kształtu wraca bez zmian.
 */
export function compactDehydratedState(state: unknown): unknown {
  if (!hasQueries(state)) return state;
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
 * Klient: pełna koperta, której oczekuje `hydrate` z query-core (odwrotność
 * {@link compactDehydratedState}). Pełna koperta przechodzi bez zmian treści.
 */
export function expandDehydratedState(state: unknown): unknown {
  if (!hasQueries(state)) return state;
  return {
    ...state,
    mutations: Array.isArray(state.mutations) ? state.mutations : [],
    queries: (state.queries as CompactDehydratedQuery[]).map((query) =>
      isRecord(query) && Array.isArray(query.queryKey) ? expandQuery(query) : query,
    ),
  };
}

/** Strumień porcji (seroval odtwarza go na kliencie jako `ReadableStream`). */
function isReadableLike(value: unknown): value is ReadableStream<unknown> {
  return isRecord(value) && typeof value.getReader === "function";
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
  let reader: ReadableStreamDefaultReader<T> | undefined;
  return new ReadableStream<T>({
    start() {
      reader = source.getReader();
    },
    async pull(controller) {
      const result = await reader!.read();
      if (result.done) controller.close();
      else controller.enqueue(map(result.value));
    },
    cancel(reason) {
      return reader?.cancel(reason);
    },
  });
}

/**
 * Klient: ładunek routera z rozwiniętą kopertą bariery i strumieniem, który
 * rozwija każdą porcję - przekazywany do `hydrate` integracji router<->query.
 * Nowy obiekt; wejście bez tych pól wraca nietknięte.
 */
export function expandRouterDehydrated<T>(dehydrated: T): T {
  if (!isRecord(dehydrated)) return dehydrated;
  const { dehydratedQueryClient, queryStream } = dehydrated;
  if (dehydratedQueryClient === undefined && !isReadableLike(queryStream)) return dehydrated;
  return {
    ...dehydrated,
    ...(dehydratedQueryClient !== undefined && {
      dehydratedQueryClient: expandDehydratedState(dehydratedQueryClient),
    }),
    ...(isReadableLike(queryStream) && {
      queryStream: mapQueryStream(queryStream, expandDehydratedState),
    }),
  };
}
