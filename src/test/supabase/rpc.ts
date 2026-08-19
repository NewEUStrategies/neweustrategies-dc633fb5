// Atrapa `supabase.rpc(...)` - rejestrator wywolan funkcji SECURITY DEFINER.
//
// DLACZEGO OSOBNO OD `./chain`. To nie jest wariant tej samej rzeczy. Repo ma
// dwie rozlaczne rodziny powierzchni danych i kazda psuje sie inaczej:
//
//   * powierzchnie TABELARYCZNE (czat, profil, komentarze) rozmawiaja z baza
//     lancuchem `.from().select().eq()...`, wiec testowalnym kontraktem jest
//     KOLEJNOSC I KOMPLET OGNIW - stad `./chain`;
//   * powierzchnie RPC-ONLY (kluby, siec kontaktow) wolaja pojedyncze
//     `rpc(nazwa, argumenty)`, bo ich tabele nie maja grantow dla klienta
//     (`supabase.from("clubs")` oddalby pusty zbior nawet adminowi). Tu
//     testowalnym kontraktem jest NAZWA FUNKCJI i NAZWY ARGUMENTOW.
//
// Rozroznienie nie jest kosmetyczne. Skoro serwer zakresuje po tym, co
// dostanie, to zgubiony albo przemianowany argument jest rownowazny utracie
// zawezenia - a taki blad przechodzi przez `tsc` (obiekt argumentow jest
// luzny), przez przeglad (jedna literowka wsrod dwudziestu podobnych wierszy)
// i przez interfejs (lista i tak cos pokazuje). Dlatego atrapa zapisuje
// argumenty w calosci i pozwala asertowac je PO NAZWIE.
//
// DLACZEGO TO STOI WE WSPOLNYM MIEJSCU. W chwili powstania tego pliku 29
// plikow testowych repo mialo wlasna, recznie pisana kopie tej atrapy (m.in.
// `clubs/__tests__/postsApi.test.ts`, `clubs/__tests__/applyApi.test.ts`,
// caly czat, caly profil, siec kontaktow). Kazda kopia to osobny kontrakt do
// rozjechania przy nastepnej zmianie klienta Supabase.
//
// Swiadomie BEZ JSX i bez importu komponentow - modul bywa wciagany z wnetrza
// fabryk `vi.mock` (dynamiczny import), wiec musi byc tani i bez side-effectow.
import { fail, type PostgrestErrorLike, type SupabaseResult } from "./chain";

/** Jedno zapisane wywolanie RPC: nazwa funkcji + obiekt argumentow. */
export interface RecordedRpc {
  readonly name: string;
  readonly args: Record<string, unknown> | undefined;
  /** Wartosc argumentu po nazwie (undefined takze wtedy, gdy klucza nie bylo). */
  arg(key: string): unknown;
  /** Czy klucz W OGOLE zostal przekazany - `undefined` to inna odpowiedz niz brak. */
  has(key: string): boolean;
  /** Nazwy przekazanych argumentow, w kolejnosci wystapienia w obiekcie. */
  keys(): string[];
}

/**
 * Odpowiedz atrapy dla danej funkcji. Funkcja dostaje zapisane wywolanie, wiec
 * test moze odpowiedziec ROZNIE zaleznie od argumentow (inna strona dla innego
 * offsetu, kolizja slugu tylko dla konkretnej wartosci) bez budowania wlasnej
 * atrapy.
 */
export type RpcResponder = (call: RecordedRpc) => SupabaseResult;

export interface SupabaseRpcStub {
  /** Podmienialna funkcja `rpc` do wstrzykniecia w atrape klienta. */
  rpc: (name: string, args?: Record<string, unknown>) => Promise<SupabaseResult>;
  /** Ustaw odpowiedz dla funkcji (ostatnie ustawienie wygrywa). */
  setResponse(name: string, responder: RpcResponder | SupabaseResult): void;
  /** Skrot: zaplanuj udana odpowiedz z danymi. */
  setData(name: string, data: unknown): void;
  /** Skrot: zaplanuj odmowe bazy (kod SQLSTATE opcjonalny). */
  setError(name: string, message: string, code?: string): void;
  /** Wszystkie zapisane wywolania, w kolejnosci. */
  calls: RecordedRpc[];
  /** Wywolania jednej funkcji. */
  callsFor(name: string): RecordedRpc[];
  /** Ostatnie wywolanie funkcji - najczestsza asercja. */
  lastCall(name: string): RecordedRpc | undefined;
  /** Nazwy wywolanych funkcji w kolejnosci (asercja kolejnosci i kompletu). */
  names(): string[];
  reset(): void;
}

function recordCall(name: string, args: Record<string, unknown> | undefined): RecordedRpc {
  return {
    name,
    args,
    arg: (key) => args?.[key],
    // `in` zamiast porownania z `undefined`: RPC z DEFAULT NULL rozroznia
    // "nie podano klucza" (serwerowy DEFAULT) od "podano undefined", a warstwa
    // danych klubow opiera na tym rozroznieniu realne zachowanie filtrow.
    has: (key) => args !== undefined && Object.prototype.hasOwnProperty.call(args, key),
    keys: () => (args === undefined ? [] : Object.keys(args)),
  };
}

/**
 * Atrapa `supabase.rpc(...)`.
 *
 * Brak zaplanowanej odpowiedzi to BLAD TESTU, nie ciche `null`: milczaca pusta
 * zwrotka udawalaby poprawny odczyt funkcji, ktorej test nie zaplanowal - i to
 * jest dokladnie ten rodzaj atrapy, ktory sprawia, ze test przestaje czegokolwiek
 * dowodzic. Ta sama zasada, co w `./chain`.
 */
export function supabaseRpcStub(): SupabaseRpcStub {
  const responders = new Map<string, RpcResponder>();
  const calls: RecordedRpc[] = [];

  const stub: SupabaseRpcStub = {
    async rpc(name, args) {
      const call = recordCall(name, args);
      calls.push(call);
      const responder = responders.get(name);
      if (!responder) {
        return fail(`test: brak zaplanowanej odpowiedzi dla RPC "${name}"`);
      }
      return responder(call);
    },
    setResponse(name, responder) {
      responders.set(name, typeof responder === "function" ? responder : () => responder);
    },
    setData(name, data) {
      responders.set(name, () => ({ data, error: null }));
    },
    setError(name, message, code) {
      responders.set(name, () => fail(message, code));
    },
    calls,
    callsFor: (name) => calls.filter((c) => c.name === name),
    lastCall: (name) => calls.filter((c) => c.name === name).at(-1),
    names: () => calls.map((c) => c.name),
    reset() {
      responders.clear();
      calls.length = 0;
    },
  };
  return stub;
}

/**
 * Atrapa `supabase.auth` w zakresie, ktorego dotyka warstwa danych: tozsamosc
 * zalogowanego i sesja. `null` znaczy GOSC - i to jest osobna, testowalna
 * sciezka (np. `createComment` ma wtedy rzucic `auth_required`, a nie wyslac
 * insert bez `user_id`).
 */
export interface SupabaseAuthStub {
  getUser(): Promise<{ data: { user: { id: string } | null }; error: null }>;
  getSession(): Promise<{
    data: { session: { user: { id: string } } | null };
    error: null;
  }>;
}

export function supabaseAuthStub(userId: string | null): SupabaseAuthStub {
  return {
    async getUser() {
      return { data: { user: userId === null ? null : { id: userId } }, error: null };
    },
    async getSession() {
      return { data: { session: userId === null ? null : { user: { id: userId } } }, error: null };
    },
  };
}

/** Blad PostgREST widziany jako zwykly `Error` - skrot do asercji `rejects`. */
export type { PostgrestErrorLike };
