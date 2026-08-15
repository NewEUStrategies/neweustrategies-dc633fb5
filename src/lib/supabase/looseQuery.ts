// Strukturalny opis buildera zapytań Supabase dla tabel i widoków, których
// NIE MA w wygenerowanych typach (`integrations/supabase/types.ts`).
//
// DLACZEGO TO W OGÓLE ISTNIEJE. Część powierzchni CRM stoi na widokach i
// tabelach dokładanych migracją później niż ostatnia regeneracja typów. Klient
// Supabase typuje wtedy `.from("crm_leads_all")` jako `never`, więc każde
// wywołanie trzeba opisać ręcznie. Cztery moduły CRM zrobiły to niezależnie -
// cztery kopie tego samego `type AnyQuery`, każda z innym podzbiorem metod
// (`neq` w jednym, `overlaps` w drugim, `insert` w trzecim).
//
// CO BYŁO ZEPSUTE W KOPIACH - i to jest sedno tego pliku. Wszystkie deklarowały
// `then` tak:
//
//     then: <R>(fn: (r: QueryResult) => R) => Promise<R>;
//
// To NIE JEST `PromiseLike`. Sygnatura `PromiseLike.then` przyjmuje DWA
// opcjonalne handlery (spełnienie i odrzucenie) i zwraca `PromiseLike`, a nie
// `Promise`. Kompilator nie mógł więc uznać buildera za obiekt „awaitowalny" -
// i każde `await q` wymagało obejścia:
//
//     await (q as unknown as Promise<{ data: unknown[]; error: ... }>)
//
// Rzutowanie nie było tu więc niczym „na granicy bazy": było łatką na literówkę
// w typie. Trzydzieści łatek na jedną literówkę. Poprawna deklaracja `then`
// (niżej) sprawia, że `await q` po prostu się typuje, a rzutowania znikają
// razem z powodem.
//
// CZEGO TEN TYP NIE UDAJE. Nie zna kolumn i nie waliduje `select("...")` -
// wynik jest `unknown` i trzeba go zawęzić (parserem albo strażnikiem) tak samo
// jak wcześniej. Wygenerowane typy pozostają jedyną drogą do sprawdzania
// kształtu wiersza; ten moduł tylko przestaje kłamać o tym, że wynik da się
// zaczekać. Tabela, która JEST w wygenerowanych typach, nie ma tu czego szukać -
// pilnuje tego `check:db-row-casts`.

/**
 * Błąd PostgREST. `code` jest tu, bo kod aplikacji na nim POLEGA - `23505`
 * (naruszenie unikalności) odróżnia „rekord już istnieje" od realnej awarii,
 * a bez tego pola każde takie rozgałęzienie wymagało własnego rzutowania.
 */
export interface LooseError {
  readonly message: string;
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;
}

/** Wynik zapytania Supabase w postaci, jaką widzi kod bez wygenerowanych typów. */
export interface LooseResult<Row = unknown> {
  readonly data: Row;
  readonly error: LooseError | null;
  readonly count?: number | null;
}

/**
 * Builder zapytań. Generyk opisuje POJEDYNCZY WIERSZ - dokładnie jak w kliencie
 * Supabase - więc zapytanie listowe rozwiązuje się do `Row[] | null`, a
 * `maybeSingle()` do `Row | null`. Domyślnie `unknown`: bez wygenerowanych typów
 * nikt kształtu wiersza nie zna, dopóki go nie zadeklaruje albo nie sprawdzi.
 *
 * `PromiseLike` jest tu ROZSZERZANY, nie naśladowany: dzięki temu `await q`
 * daje wynik bez jednego rzutowania.
 */
export interface LooseQuery<Row = unknown> extends PromiseLike<LooseResult<Row[] | null>> {
  select(columns: string, options?: { count?: "exact"; head?: boolean }): LooseQuery<Row>;
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }): LooseQuery<Row>;
  limit(count: number): LooseQuery<Row>;
  range(from: number, to: number): LooseQuery<Row>;
  eq(column: string, value: unknown): LooseQuery<Row>;
  neq(column: string, value: unknown): LooseQuery<Row>;
  is(column: string, value: unknown): LooseQuery<Row>;
  not(column: string, operator: string, value: unknown): LooseQuery<Row>;
  in(column: string, values: readonly unknown[]): LooseQuery<Row>;
  or(filter: string): LooseQuery<Row>;
  ilike(column: string, value: string): LooseQuery<Row>;
  gte(column: string, value: unknown): LooseQuery<Row>;
  lte(column: string, value: unknown): LooseQuery<Row>;
  overlaps(column: string, values: readonly unknown[]): LooseQuery<Row>;
  contains(column: string, value: unknown): LooseQuery<Row>;
  /**
   * Deklaruje kształt wiersza dla tego zapytania.
   *
   * To ISTNIEJĄCA metoda buildera PostgREST (`PostgrestTransformBuilder.returns`),
   * w runtime zwracająca `this` - zmienia wyłącznie typ. Stoi tu, bo alternatywą
   * jest `as unknown as Promise<{ data: Row[] }>` doklejone do łańcucha: ta sama
   * asercja, tylko bez nazwy, bez miejsca na komentarz i nie do wyszukania.
   *
   * Deklaracja jest ASERCJĄ, nie dowodem - PostgREST nie zna typów TS. Kiedy
   * wiersz pochodzi z zewnątrz i jego kształt trzeba SPRAWDZIĆ, właściwym
   * narzędziem jest strażnik albo parser, nie ta metoda.
   */
  returns<NewRow>(): LooseQuery<NewRow>;
  /** Zwraca POJEDYNCZY wiersz albo `null` - nie tablicę, stąd osobny kształt. */
  maybeSingle(): PromiseLike<LooseResult<Row | null>>;
  single(): PromiseLike<LooseResult<Row>>;
  insert(values: unknown): LooseQuery<Row>;
  upsert(values: unknown, options?: { onConflict?: string }): LooseQuery<Row>;
  update(values: unknown): LooseQuery<Row>;
  delete(): LooseQuery<Row>;
}

/** Klient zawężony do tego, czego potrzebują moduły spoza wygenerowanych typów. */
export interface LooseClient {
  from(table: string): LooseQuery;
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<LooseResult>;
}

/**
 * Kontekst serwerowej funkcji niesie klienta jako `unknown` (middleware nie zna
 * jego typu). Jedno miejsce, w którym to zawężamy - zamiast rzutowania
 * `ctx.supabase as { from: ... }` powtarzanego w każdym module.
 */
export function looseClient(source: { readonly supabase: unknown }): LooseClient {
  return source.supabase as LooseClient;
}

/** Skrót na `looseClient(ctx).from(table)` - najczęstsze wywołanie w modułach CRM. */
export function looseTable(source: { readonly supabase: unknown }, table: string): LooseQuery {
  return looseClient(source).from(table);
}

/**
 * Wiersze z wyniku jako tablica, bez rzutowania w miejscu wywołania.
 * `data` bywa `null` (pusty wynik) i nie-tablicą (`maybeSingle`), więc oba
 * przypadki domykamy tutaj raz.
 */
export function rowsOf<Row>(result: LooseResult<Row[] | null>): Row[] {
  return Array.isArray(result.data) ? result.data : [];
}

/** Wiersze zapytania - `await` + `rowsOf` w jednym, najczęstsza para w handlerach. */
export async function fetchRows<Row>(query: LooseQuery<Row>): Promise<Row[]> {
  return rowsOf(await query);
}

/** Rzuca błędem Supabase jako `Error` - powtarzalne trzy linie w każdym handlerze. */
export function unwrap<Row>(result: LooseResult<Row>): Row {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
