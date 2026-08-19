// Atrapa `createServerFn` z `@tanstack/react-start` - wspólna dla wszystkich
// powierzchni testowych.
//
// DLACZEGO W OGÓLE ISTNIEJE. Server function zbudowana łańcuchem
// `createServerFn({...}).validator(v).handler(h)` nie da się wywołać w teście
// jednostkowym: prawdziwa implementacja oczekuje kontekstu żądania frameworka.
// Atrapa zastępuje łańcuch takim, który po prostu ODDAJE walidator i handler,
// więc test może je wywołać wprost - bez dotykania kodu produkcyjnego. Wzorzec
// powstał w `src/lib/__tests__/categoryColorSave.test.ts` (bramka defektu K10);
// mieszkał tam jako kopia lokalna, a trzy server fn wyszukiwarki potrzebowały
// go dokładnie tak samo. Zostały dwa wyjścia: skopiować łańcuch do czwartego
// pliku albo wyprowadzić go tutaj - ta sama decyzja, co przy `supabaseChain.ts`.
//
// CZEGO ATRAPA NIE UDAJE. Nie ma tu middleware'ów, kontekstu żądania ani
// serializacji - handler dostaje `data` dokładnie takie, jakie poda test.
// Test server fn mierzy więc WALIDACJĘ WEJŚCIA i CIAŁO handlera, a nie transport.
// To świadoma granica: transportu dowodzą testy tras i e2e.

export type ServerFnValidator<I = unknown> = (input: unknown) => I;
export type ServerFnHandler<I = unknown, O = unknown> = (ctx: {
  data: I;
  context?: unknown;
}) => Promise<O> | O;

export interface ServerFnSpec<I = unknown, O = unknown> {
  validator?: ServerFnValidator<I>;
  inputValidator?: ServerFnValidator<I>;
  handler?: ServerFnHandler<I, O>;
}

interface ServerFnChain<I, O> {
  middleware: (middleware: unknown) => ServerFnChain<I, O>;
  validator: (validator: ServerFnValidator<I>) => ServerFnChain<I, O>;
  inputValidator: (validator: ServerFnValidator<I>) => ServerFnChain<I, O>;
  handler: (handler: ServerFnHandler<I, O>) => ServerFnSpec<I, O>;
}

/**
 * Podmiana modułu `@tanstack/react-start` dla testów server functions.
 *
 * Używać WEWNĄTRZ fabryki `vi.mock` (jest hoistowana, więc nie widzi importów
 * z góry pliku):
 *
 *   vi.mock("@tanstack/react-start", async () =>
 *     (await import("@/test/serverFnChain")).reactStartMock());
 *
 * Ten helper CELOWO nie importuje `@tanstack/react-start`: import mockowanego
 * modułu z wnętrza jego własnej fabryki zapętla rozwiązywanie i test wisi bez
 * komunikatu (ta sama pułapka, co przy `@/test/i18nReal`).
 */
export function reactStartMock() {
  const createServerFn = <I, O>(): ServerFnChain<I, O> => {
    const spec: ServerFnSpec<I, O> = {};
    const chain: ServerFnChain<I, O> = {
      middleware: () => chain,
      validator: (validator) => {
        spec.validator = validator;
        return chain;
      },
      inputValidator: (validator) => {
        spec.inputValidator = validator;
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
  return { createServerFn, createMiddleware: () => ({}) };
}

export interface CallableServerFn<I, O> {
  /** Uruchamia sam walidator - do testów odrzucania złego wejścia. */
  validate(input: unknown): I;
  /** Waliduje wejście i uruchamia handler - pełna ścieżka wywołania. */
  call(input: unknown): Promise<O>;
  /** Uruchamia handler z GOTOWYMI danymi, z pominięciem walidacji. */
  run(data: I): Promise<O>;
}

/**
 * Rzutuje wyeksportowaną server fn (pod atrapą jest nią `ServerFnSpec`) na
 * obiekt wywoływalny. Brak walidatora lub handlera to błąd testu, nie ciche
 * `undefined`: znaczy, że atrapa nie objęła modułu (np. zapomniany `vi.mock`).
 */
export function asServerFn<I = unknown, O = unknown>(exported: unknown): CallableServerFn<I, O> {
  const spec = exported as ServerFnSpec<I, O>;
  const validator = spec?.validator;
  const handler = spec?.handler;
  if (typeof validator !== "function" || typeof handler !== "function") {
    throw new Error(
      'test: eksport nie wygląda na server fn pod atrapą - czy plik ma vi.mock("@tanstack/react-start")?',
    );
  }
  return {
    validate: (input) => validator(input),
    call: async (input) => handler({ data: validator(input) }),
    run: async (data) => handler({ data }),
  };
}
