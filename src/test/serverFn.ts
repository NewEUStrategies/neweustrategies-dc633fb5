// Atrapa `createServerFn` z @tanstack/react-start - wspólna dla wszystkich
// powierzchni testowych.
//
// DLACZEGO W OGÓLE. Server fn nie da się wywołać bez kontekstu żądania
// frameworka, więc handler zadeklarowany przez `createServerFn().middleware(…)
// .validator(…).handler(…)` jest z punktu widzenia testu jednostkowego
// niedostępny. Ta atrapa ODDAJE walidator i handler zamiast budować wywoływalną
// funkcję - dzięki temu test może podać własny `context` (klienta Supabase,
// userId) i sprawdzić ORKIESTRACJĘ: kolejność zapytań, bramki, obsługę błędów.
//
// CZEGO TA ATRAPA NIE DOWODZI. Nie dowodzi RLS-u, polityk bucketu ani
// triggerów - te reguły egzekwuje baza i mają własne testy pgTAP w
// `supabase/tests`. Odtwarzanie ich atrapą dałoby zieleń bez pokrycia.
//
// Wzorzec pochodzi z `src/lib/__tests__/categoryColorSave.test.ts` (defekt K10);
// tu jest wyprowadzony do jednego miejsca, żeby kolejne powierzchnie nie
// kopiowały go po raz trzeci.

export type ServerFnValidator<TData = unknown> = (input: unknown) => TData;
export type ServerFnHandler<TData = unknown, TResult = unknown, TContext = unknown> = (ctx: {
  data: TData;
  context: TContext;
}) => Promise<TResult>;

export interface ServerFnSpec<TData = unknown, TResult = unknown, TContext = unknown> {
  validator?: ServerFnValidator<TData>;
  handler?: ServerFnHandler<TData, TResult, TContext>;
  /** Middleware zapisane w kolejności deklaracji - do asercji, że bramka wisi. */
  middlewares: unknown[];
}

interface ServerFnChain {
  middleware: (middleware: unknown[]) => ServerFnChain;
  validator: (validator: ServerFnValidator) => ServerFnChain;
  /** Nowsza nazwa tego samego ogniwa - część modułów już jej używa. */
  inputValidator: (validator: ServerFnValidator) => ServerFnChain;
  handler: (handler: ServerFnHandler) => ServerFnSpec;
}

/**
 * Moduł zastępczy dla `@tanstack/react-start`. Użycie:
 *
 *   vi.mock("@tanstack/react-start", async () =>
 *     (await import("@/test/serverFn")).reactStartStub());
 */
export function reactStartStub(): Record<string, unknown> {
  const createServerFn = (): ServerFnChain => {
    const spec: ServerFnSpec = { middlewares: [] };
    const chain: ServerFnChain = {
      middleware: (middleware) => {
        spec.middlewares.push(...(Array.isArray(middleware) ? middleware : [middleware]));
        return chain;
      },
      validator: (validator) => {
        spec.validator = validator;
        return chain;
      },
      inputValidator: (validator) => {
        spec.validator = validator;
        return chain;
      },
      handler: (handler) => {
        spec.handler = handler;
        return spec;
      },
    };
    return chain;
  };
  return {
    createServerFn,
    createMiddleware: () => ({}),
    useServerFn: <T>(fn: T) => fn,
  };
}

/** Rzutowanie eksportu server fn na oddany przez atrapę kształt. */
export function asSpec<TData = unknown, TResult = unknown, TContext = unknown>(
  exported: unknown,
): ServerFnSpec<TData, TResult, TContext> {
  return exported as ServerFnSpec<TData, TResult, TContext>;
}

/**
 * Przejście PEŁNEJ drogi server fn: walidacja wejścia, potem handler.
 *
 * Wywołanie samego handlera z gotowymi danymi omijałoby schemat Zoda, czyli
 * pierwszą bramkę - a to w niej siedzi połowa reguł (limity długości, typy
 * UUID, pułapy rozmiaru). Test ma iść tą samą drogą co żądanie.
 */
export async function callServerFn<TResult = unknown, TContext = unknown>(
  exported: unknown,
  input: unknown,
  context: TContext,
): Promise<TResult> {
  const spec = asSpec<unknown, TResult, TContext>(exported);
  if (!spec.handler) throw new Error("test: server fn nie ma handlera");
  const data = spec.validator ? spec.validator(input) : input;
  return spec.handler({ data, context });
}
