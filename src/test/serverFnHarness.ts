// Harness do testowania SERWEROWYCH FUNKCJI (`createServerFn`) bez frameworka.
//
// PO CO. `createServerFn({...}).middleware([...]).validator(...).handler(...)`
// zwraca obiekt wywoływalny wyłącznie przez runtime TanStack Start (potrzebuje
// żądania, kontekstu middleware, serializacji). W teście jednostkowym nie ma
// tego runtime'u, więc bez podmiany fabryki jedyną testowalną częścią warstwy
// serwerowej byłyby funkcje pomocnicze - a cała logika handlerów (rozwiązanie
// tenanta, kształt zwracanych danych, ścieżka błędu, wywołanie audytu) zostaje
// poza zasięgiem. Dokładnie tak wyglądał moduł CRM: 0 z 50 funkcji
// `crm.functions.ts` miało jakiekolwiek pokrycie.
//
// Wzorzec podmiany fabryki jest w repo starszy niż ten plik
// (`src/lib/__tests__/categoryColorSave.test.ts`) - tutaj jest wyciągnięty do
// jednego miejsca, żeby każdy kolejny moduł serwerowy nie kopiował atrapy.
//
// CZEGO TEN HARNESS NIE UDAJE: middleware. `requireCrmStaff` (rola + step-up
// MFA) i RLS to warstwa autoryzacji sprawdzana pgTAP-em i testem strukturalnym
// bramek - atrapa nie może „przepuścić" nikogo, bo w ogóle nie uruchamia
// middleware. Test handlera mówi o tym, co robi handler, nie o tym, kto ma
// prawo go wywołać.

/** Kontekst, jaki middleware wstrzykuje handlerowi w produkcji. */
export interface ServerFnContext {
  supabase: unknown;
  userId?: string;
  claims?: Record<string, unknown>;
}

export interface ServerFnSpec<TData = unknown, TResult = unknown> {
  validator?: (input: unknown) => TData;
  handler?: (ctx: { data: TData; context: ServerFnContext }) => Promise<TResult> | TResult;
  /** Metoda zadeklarowana w `createServerFn({ method })`. */
  method?: string;
  /** Middleware zadeklarowane przez funkcję - do testów strukturalnych bramek. */
  middleware: unknown[];
}

interface ServerFnChain {
  middleware: (list: unknown[]) => ServerFnChain;
  validator: (fn: (input: unknown) => unknown) => ServerFnChain;
  inputValidator: (fn: (input: unknown) => unknown) => ServerFnChain;
  handler: (fn: ServerFnSpec["handler"]) => ServerFnSpec;
}

/**
 * Moduł-atrapa `@tanstack/react-start`. Używać w fabryce `vi.mock`:
 *
 *   vi.mock("@tanstack/react-start", async () => {
 *     const { serverFnStubModule } = await import("@/test/serverFnHarness");
 *     return serverFnStubModule();
 *   });
 */
export function serverFnStubModule(): Record<string, unknown> {
  const createServerFn = (options?: { method?: string }): ServerFnChain => {
    const spec: ServerFnSpec = { method: options?.method, middleware: [] };
    const chain: ServerFnChain = {
      middleware: (list) => {
        spec.middleware = [...spec.middleware, ...list];
        return chain;
      },
      validator: (fn) => {
        spec.validator = fn;
        return chain;
      },
      inputValidator: (fn) => {
        spec.validator = fn;
        return chain;
      },
      handler: (fn) => {
        spec.handler = fn;
        return spec;
      },
    };
    return chain;
  };
  const createMiddleware = () => {
    const mw = {
      middleware: () => mw,
      server: () => mw,
      client: () => mw,
    };
    return mw;
  };
  return { createServerFn, createMiddleware, useServerFn: (fn: unknown) => fn };
}

/** Zawęża eksport modułu serwerowego do specyfikacji, którą oddaje atrapa. */
export function asServerFn<TData = unknown, TResult = unknown>(
  value: unknown,
): ServerFnSpec<TData, TResult> {
  const spec = value as ServerFnSpec<TData, TResult>;
  if (typeof spec?.handler !== "function") {
    throw new Error("test: podany eksport nie jest serwerową funkcją z handlerem");
  }
  return spec;
}

/**
 * Wywołuje serwerową funkcję tak, jak zrobiłby to framework: najpierw
 * walidator (czyli schemat Zod - błędne wejście MA rzucać), potem handler
 * z podanym kontekstem.
 */
export async function callServerFn<TResult = unknown>(
  value: unknown,
  input: { data?: unknown; context: ServerFnContext },
): Promise<TResult> {
  const spec = asServerFn(value);
  const data = spec.validator ? spec.validator(input.data) : input.data;
  const result = await spec.handler?.({ data, context: input.context });
  return result as TResult;
}

/** Sam walidator - do testów wejścia bez uruchamiania zapytań. */
export function validateServerFnInput<TData = unknown>(value: unknown, input: unknown): TData {
  const spec = asServerFn<TData>(value);
  if (!spec.validator) throw new Error("test: ta funkcja serwerowa nie ma walidatora");
  return spec.validator(input);
}

/**
 * Nazwy middleware zadeklarowanych przez serwerową funkcję.
 *
 * `createServerFn()` zwraca WYWOŁYWALNY `OptionalFetcher` z doklejonymi polami
 * konfiguracji, więc rzutowanie go na `{ middleware: … }` TypeScript odrzuca
 * jako brak pokrycia typów (a `as unknown as` jest w tym repo pod ratchetem).
 * `Reflect.get` czyta pole bez udawania, że znamy pełny kształt tego typu.
 */
export function serverFnMiddlewareNames(value: unknown): string[] {
  const middleware = Reflect.get(value as object, "middleware") as
    Array<{ name?: string } | undefined> | undefined;
  return (middleware ?? []).map((m) => m?.name ?? "");
}
