// Atrapa klienta PostgREST - wspólna dla WSZYSTKICH powierzchni testowych.
//
// Mieszkała w `src/test/chat/fixtures.ts`, bo czat pierwszy jej potrzebował
// (PR #250). Nie ma w niej jednak niczego czatowego: to generyczna maszyneria
// `supabase.from(...)`, a profil potrzebuje jej dokładnie tak samo
// (`useProfileEditor`, `useProfileIntent`, `badges`, `useHeaderProfile` czytają
// przez łańcuch, nie przez `rpc()`). Zostały więc dwa wyjścia: skopiować 130
// linii do drugiego pliku fixture'ów albo zaimportować w profilu z katalogu
// `test/chat`. Pierwsze daje dwie atrapy rozjeżdżające się przy następnej
// zmianie kontraktu, drugie - zależność, która nic nie znaczy (usunięcie
// fixture'ów czatu psułoby testy profilu).
//
// 2026-08-18: plik przeprowadzil sie z `src/test/supabaseChain.ts` do
// `src/test/supabase/chain.ts`, bo obok stanela DRUGA atrapa tej samej rangi
// (`./rpc` - rejestrator wywolan RPC). Katalog `src/test/supabase/` trzyma je
// razem: `chain` dla powierzchni czytajacych tabele (czat, profil,
// KOMENTARZE), `rpc` dla powierzchni RPC-only (KLUBY, siec kontaktow).
// `test/chat/fixtures.ts` re-eksportuje calosc dalej - zaden z 17 plikow
// testowych czatu nie zmienia importu.

/**
 * Błąd PostgREST. `PostgrestError` w supabase-js DZIEDZICZY po `Error`, więc
 * atrapa też musi - inaczej test przechodzi obok gałęzi `err instanceof Error`
 * w warstwie danych i „dowodzi”, że mapowanie komunikatów nie działa, choć
 * w produkcji działa (albo odwrotnie: przepuszcza kod, który w produkcji
 * poleci na `[object Object]`). Wierność atrapy jest tu warunkiem sensu testu.
 */
export interface PostgrestErrorLike extends Error {
  code?: string;
  details?: string;
  hint?: string;
}

export function pgError(message: string, code?: string): PostgrestErrorLike {
  const error: PostgrestErrorLike = new Error(message);
  error.name = "PostgrestError";
  if (code !== undefined) error.code = code;
  return error;
}

/** Odpowiedź PostgREST/RPC w kształcie, w jakim ją czyta warstwa danych. */
export interface SupabaseResult<T = unknown> {
  data: T;
  error: PostgrestErrorLike | null;
  /**
   * Licznik z `select("id", { count: "exact", head: true })`. Zapytanie
   * liczące NIE zwraca wierszy - czyta się wyłącznie `count`, więc atrapa
   * musi go umieć podać. Bez tego pola każdy test kompletności profilu
   * widziałby zero umiejętności/doświadczeń niezależnie od zamiaru.
   */
  count?: number | null;
}

export function ok<T>(data: T): SupabaseResult<T> {
  return { data, error: null };
}

/** Odpowiedź zapytania LICZĄCEGO (`head: true`) - sam licznik, bez wierszy. */
export function okCount(count: number): SupabaseResult<null> {
  return { data: null, error: null, count };
}

export function fail(message: string, code?: string): SupabaseResult<null> {
  return { data: null, error: pgError(message, code) };
}

/** Jedno ogniwo łańcucha PostgREST zapisane przez atrapę. */
export interface RecordedCall {
  readonly method: string;
  readonly args: ReadonlyArray<unknown>;
}

/** Pełny przebieg jednego łańcucha: tabela + kolejność wywołanych ogniw. */
export interface RecordedChain {
  readonly table: string;
  readonly calls: RecordedCall[];
  /** Skrót: czy w łańcuchu wystąpiło dane ogniwo. */
  has(method: string): boolean;
  /** Argumenty pierwszego wystąpienia ogniwa (undefined, gdy go nie było). */
  argsOf(method: string): ReadonlyArray<unknown> | undefined;
}

/**
 * Wynik, jaki atrapa ma zwrócić dla danej tabeli. Funkcja dostaje zapisany
 * łańcuch, więc test może odpowiedzieć RÓŻNIE w zależności od filtrów
 * (np. inna strona historii dla innego kursora) bez budowania własnej atrapy.
 */
export type TableResponder = (chain: RecordedChain) => SupabaseResult;

/**
 * Atrapa `supabase.from(...)`: pełny, thenable łańcuch PostgREST.
 *
 * Kontrakt jest ważniejszy niż wygoda: łańcuch ROZWIĄZUJE SIĘ dopiero przy
 * `await` (albo `.single()`/`.maybeSingle()`), więc test widzi dokładnie te
 * ogniwa, które produkcyjny kod naprawdę wywołał - w tym `.order()` dwa razy
 * (created_at, potem id) i `.or()` z kursorem złożonym. Test, który sprawdza
 * TYLKO dane, przechodzi tak samo; test kontraktu paginacji ma z czego czytać.
 */
export interface SupabaseFromStub {
  /** Podmienialna funkcja `from` do wstrzyknięcia w atrapę klienta. */
  from: (table: string) => unknown;
  /** Ustaw odpowiedź dla tabeli (ostatnie ustawienie wygrywa). */
  setResponse(table: string, responder: TableResponder | SupabaseResult): void;
  /** Wszystkie zapisane łańcuchy, w kolejności wywołań. */
  chains: RecordedChain[];
  /** Łańcuchy dotyczące jednej tabeli. */
  chainsFor(table: string): RecordedChain[];
  /** Ostatni łańcuch dla tabeli - najczęstsza asercja. */
  lastChain(table: string): RecordedChain | undefined;
  reset(): void;
}

/** Ogniwa, które KOŃCZĄ łańcuch (zwracają wynik, nie builder). */
const TERMINAL_METHODS: ReadonlySet<string> = new Set(["single", "maybeSingle", "csv"]);

/**
 * Ogniwa filtrujące/kształtujące. Lista jest jawna (a nie „cokolwiek przez
 * Proxy"), bo literówka w nazwie ogniwa w kodzie produkcyjnym MA być błędem
 * testu, a nie cicho pochłoniętym wywołaniem.
 */
const CHAIN_METHODS: readonly string[] = [
  "select",
  "insert",
  "update",
  "upsert",
  "delete",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "is",
  "not",
  "or",
  "filter",
  "match",
  "contains",
  "overlaps",
  "order",
  "limit",
  "range",
  "returns",
  "abortSignal",
];

export function supabaseFromStub(): SupabaseFromStub {
  const responders = new Map<string, TableResponder>();
  const chains: RecordedChain[] = [];

  function makeChain(table: string): RecordedChain {
    const calls: RecordedCall[] = [];
    return {
      table,
      calls,
      has: (method) => calls.some((c) => c.method === method),
      argsOf: (method) => calls.find((c) => c.method === method)?.args,
    };
  }

  function resolve(chain: RecordedChain): SupabaseResult {
    const responder = responders.get(chain.table);
    // Brak odpowiedzi to nie „pusta lista”, a błąd testu: cichy `[]` udawałby
    // poprawny odczyt tabeli, której test nie zaplanował.
    if (!responder) {
      return fail(`test: brak zaplanowanej odpowiedzi dla tabeli "${chain.table}"`);
    }
    return responder(chain);
  }

  function builderFor(chain: RecordedChain): Record<string, unknown> {
    const builder: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      builder[method] = (...args: unknown[]) => {
        chain.calls.push({ method, args });
        return builder;
      };
    }
    for (const method of TERMINAL_METHODS) {
      builder[method] = (...args: unknown[]) => {
        chain.calls.push({ method, args });
        return Promise.resolve(resolve(chain));
      };
    }
    // Thenable: `await q` bez ogniwa terminalnego (tak czyta większość zapytań).
    builder.then = (
      onFulfilled?: (value: SupabaseResult) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(resolve(chain)).then(onFulfilled, onRejected);
    return builder;
  }

  return {
    from: (table: string) => {
      const chain = makeChain(table);
      chains.push(chain);
      return builderFor(chain);
    },
    setResponse(table, responder) {
      responders.set(table, typeof responder === "function" ? responder : () => responder);
    },
    chains,
    chainsFor: (table) => chains.filter((c) => c.table === table),
    lastChain: (table) => chains.filter((c) => c.table === table).at(-1),
    reset() {
      responders.clear();
      chains.length = 0;
    },
  };
}
