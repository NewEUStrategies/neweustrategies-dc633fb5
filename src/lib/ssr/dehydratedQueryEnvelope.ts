// KOMPAKTOWA KOPERTA ZAPYTAŃ W STANIE ODWODNIONYM (fala 3, P3.7b, T1).
//
// PO CO. Każdy dokument z chrome niesie w stanie routera (`$_TSR`: początkowe skrypty
// `data-tsr-stream-part` + strumień zapytań) kopertę KAŻDEGO zapytania: `queryHash`,
// czyli `queryKey` drugi raz jako JSON (klucz post-listy ma 17 parametrów), i ogon
// stanu, który dla zapytania rozstrzygniętego z sukcesem jest zawsze ten sam
// (`dataUpdateCount: 1`, `error: null`, ... `fetchStatus: "idle"`). Na fixture `/`
// to ok. 6 KB surowego HTML-u parsowanego i ewaluowanego w zadaniu stanu
// początkowego (diagnoza `faza3/diagnoza/waga-dokumentu.md` §2.1-2.2).
//
// KONTRAKT (sprawdzony w `node_modules`, `@tanstack/query-core` 5.104.3 i
// `@tanstack/router-ssr-query-core` 1.169.3):
//  * integracja serwerowa oddaje `{ ...ładunek, query: { initial?, stream } }`
//    (`router-ssr-query-core/dist/esm/index.js:96-101`): `initial` i KAŻDA porcja
//    `stream` to tablica `DehydratedQuery` z `dehydrateQuery` (:42-47, :57-63) - bez
//    mutacji i bez koperty `DehydratedState`; klient woła
//    `hydrate(qc, { queries: query.initial })` i `hydrate(qc, { queries: value })`
//    dla każdej porcji (:111, :122). Jednostką tego modułu jest więc tablica zapytań;
//  * `hydrate` szuka zapytania po `queryHash` (`queryCache.get(queryHash)`,
//    `query-core/build/modern/hydration.js:162`); `build` liczy hash z klucza, gdy
//    go brak, ale `get(undefined)` NIE znajdzie zapytania utworzonego wcześniej
//    przez obserwatora (porcja strumienia po zamontowaniu `useQuery`), a `build`
//    oddaje wtedy istniejące zapytanie BEZ danych;
//  * konstruktor `Query` przyjmuje `state` W CAŁOŚCI (`query.js:45`; brakujące pole
//    byłoby `undefined`, np. `errorUpdateCount + 1 = NaN`).
// Dlatego oba pola odtwarzamy na kliencie PRZED `hydrate` - dla `initial` i dla
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
//    `queryHash` oryginałów w `sentQueries` (:46, :61), zanim my dostaniemy kopertę.
// Kompaktowanie jest idempotentne, a rozwinięcie przyjmuje też pełną kopertę
// (dokument sprzed zmiany hydratuje się bez różnicy).
//
// KOSZT KLIENTA (runda poprawek 9). Do chunku wejściowego trafia WYŁĄCZNIE
// rozwijanie (`expandRouterDehydrated`, `expandDehydratedQueries`,
// `mapQueryStream`); kompaktowanie (`compactRouterDehydrated`) biegnie w gałęzi
// serwera `router.tsx` i jest wycinane z bundla klienta. Dlatego rozwijanie nie ma
// osłon, których przesyłka z naszego serwera nie potrzebuje: zapytanie rozwijamy
// bez sprawdzania kształtu (pełne zapytanie przechodzi bez zmiany treści). Liczenie
// `hashKey` na kliencie to cena za zdjęcie hashy z dokumentu: przenosi ok. 1,3-1,5 ms
// (bez dławienia CPU) z parsowania stanu routera do makrozadania hydratacji (sonda
// CPU w PROVE pozycji, §5.4).
import { hashKey, type DehydratedState } from "@tanstack/react-query";

/** Stały ogon stanu zapytania rozstrzygniętego z sukcesem (query-core 5.104.3). */
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

/** Odwodnione zapytanie query-core (typ nie jest eksportowany, stąd wyłuskanie). */
export type DehydratedQuery = DehydratedState["queries"][number];

type QueryStateOf = DehydratedQuery["state"];
/** Pola stanu, które kompaktowanie zdejmuje, gdy mają wartość z {@link DEFAULT_SUCCESS_STATE}. */
type DefaultStateKey = keyof typeof DEFAULT_SUCCESS_STATE;

/**
 * Zapytanie w kopercie kompaktowej: `queryHash` opcjonalny, a pola stanu z
 * {@link DEFAULT_SUCCESS_STATE} - tylko gdy różnią się od stałej (`data`
 * i `dataUpdatedAt` stała nie obejmuje, więc jadą zawsze).
 */
export type CompactDehydratedQuery = Omit<DehydratedQuery, "queryHash" | "state"> & {
  queryHash?: string;
  state: Omit<QueryStateOf, DefaultStateKey> & Partial<Pick<QueryStateOf, DefaultStateKey>>;
};

/**
 * Część zapytaniowa ładunku routera (`query` z integracji router<->query):
 * porcja początkowa (gdy było co wysłać) i strumień porcji renderu.
 */
export interface RouterQueryPayload<TQuery> {
  readonly initial?: readonly TQuery[];
  readonly stream: ReadableStream<readonly TQuery[]>;
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

function compactQuery(query: CompactDehydratedQuery): CompactDehydratedQuery {
  const { queryHash, state, ...rest } = query;
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, key) && Object.is(DEFAULTS[key], value)) {
      continue;
    }
    kept[key] = value;
  }
  // `data` i `dataUpdatedAt` są w `kept` zawsze (stała ich nie obejmuje); ponowne
  // przypisanie nie zmienia kolejności pól, a daje typ pól wymaganych.
  const out: CompactDehydratedQuery = {
    ...rest,
    state: { ...kept, data: state.data, dataUpdatedAt: state.dataUpdatedAt },
  };
  if (
    queryHash !== undefined &&
    (!isStructuralKey(query.queryKey) || queryHash !== hashKey(query.queryKey))
  ) {
    out.queryHash = queryHash;
  }
  return out;
}

/**
 * Serwer: zapytania bez `queryHash` równego hashowi klucza i bez pól stanu równych
 * {@link DEFAULT_SUCCESS_STATE}. Wpis innego kształtu wraca bez zmian, a zapytanie już
 * kompaktowe przechodzi bez zmiany treści (idempotencja). Nowa tablica.
 */
export function compactDehydratedQueries(
  queries: readonly CompactDehydratedQuery[],
): CompactDehydratedQuery[] {
  return queries.map((query) =>
    isRecord(query) && isRecord(query.state) && Array.isArray(query.queryKey)
      ? compactQuery(query)
      : query,
  );
}

/**
 * Klient: zapytania w kształcie, którego oczekuje `hydrate` z query-core (odwrotność
 * {@link compactDehydratedQueries}). Pełne zapytanie przechodzi bez zmiany treści.
 */
export function expandDehydratedQueries(
  queries: readonly CompactDehydratedQuery[],
): DehydratedQuery[] {
  return queries.map((query) => ({
    ...query,
    queryHash: query.queryHash ?? hashKey(query.queryKey),
    state: { ...DEFAULT_SUCCESS_STATE, ...query.state },
  }));
}

/**
 * Strumień przepisujący każdą porcję funkcją `map` (koniec i błąd źródła
 * przechodzą dalej, anulowanie wyniku anuluje źródło). Odczyt na żądanie
 * (`pull`), bez `TransformStream`: działa tak samo w Workers, w przeglądarce
 * i w Node, a porcje już dostarczone przechodzą w mikrozadaniach - przed
 * ustąpieniem makrozadania po hydratacji integracji (`router.tsx`).
 */
export function mapQueryStream<TIn, TOut>(
  source: ReadableStream<TIn>,
  map: (chunk: TIn) => TOut,
): ReadableStream<TOut> {
  const reader = source.getReader();
  return new ReadableStream<TOut>({
    pull: (controller) =>
      reader.read().then((result) => {
        if (result.done) controller.close();
        else controller.enqueue(map(result.value));
      }),
    cancel: (reason) => reader.cancel(reason),
  });
}

/**
 * Część `query` ładunku routera o kształcie z kontraktu integracji (nagłówek pliku).
 * Ładunek jest dla router-core nieprzezroczysty (`Record<string, any>`), więc kształt
 * sprawdzamy tutaj, a typ elementów porcji gwarantuje integracja (`dehydrateQuery`).
 */
function isRouterQueryPayload<TQuery>(value: unknown): value is RouterQueryPayload<TQuery> {
  return (
    isRecord(value) &&
    value.stream instanceof ReadableStream &&
    (value.initial === undefined || Array.isArray(value.initial))
  );
}

/**
 * Serwer: ładunek routera z kompaktową porcją początkową i strumieniem, który
 * kompaktuje każdą porcję - wynik haka `dehydrate` integracji router<->query. Nowy
 * obiekt (oryginały zostają nietknięte); ładunek bez `query` wraca bez zmian.
 */
export function compactRouterDehydrated<T>(dehydrated: T): T {
  const query = isRecord(dehydrated) ? dehydrated.query : undefined;
  if (!isRouterQueryPayload<DehydratedQuery>(query)) return dehydrated;
  return {
    ...dehydrated,
    query: {
      ...(query.initial && { initial: compactDehydratedQueries(query.initial) }),
      stream: mapQueryStream(query.stream, compactDehydratedQueries),
    },
  };
}

/**
 * Klient: ładunek routera z rozwiniętą porcją początkową i strumieniem, który
 * rozwija każdą porcję - przekazywany do `hydrate` integracji router<->query
 * (ta czyta `query.stream` zawsze, a `query.initial` tylko, gdy jest). Nowy obiekt;
 * ładunek bez `query` wraca bez zmian.
 */
export function expandRouterDehydrated<T>(dehydrated: T): T {
  const query = isRecord(dehydrated) ? dehydrated.query : undefined;
  if (!isRouterQueryPayload<CompactDehydratedQuery>(query)) return dehydrated;
  return {
    ...dehydrated,
    query: {
      ...(query.initial && { initial: expandDehydratedQueries(query.initial) }),
      stream: mapQueryStream(query.stream, expandDehydratedQueries),
    },
  };
}
