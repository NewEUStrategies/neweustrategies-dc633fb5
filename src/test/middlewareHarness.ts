// Harness do testowania CIAŁA middleware TanStack Start (`createMiddleware`).
//
// PO CO. `createMiddleware({ type: "function" }).middleware([...]).server(fn)`
// zwraca obiekt, którego framework woła w runtime - `fn` nie jest nigdzie
// wystawione. Bez podmiany fabryki ciało middleware jest NIEWYWOŁYWALNE
// z testu jednostkowego, a to znaczy, że warstwa AUTORYZACJI (require-staff)
// i UWIERZYTELNIENIA (auth-middleware) nie ma dowodu zachowania - tylko dowód
// STRUKTURALNY („która bramka stoi przy której funkcji"), który nie widzi, CO
// ta bramka robi. Dokładnie tak wyglądał `require-staff.ts`: 0,00% gałęzi przy
// 39 plikach testowych, które ten moduł ATRAPUJĄ.
//
// `serverFnHarness.serverFnStubModule()` ma własną atrapę `createMiddleware`,
// ale jej `.server()` WYRZUCA callback (`server: () => mw`) - jest instrumentem
// do testów handlerów, nie middleware. Ten plik jest jej dopełnieniem.
//
// IDENTYFIKACJA PRZEZ TOŻSAMOŚĆ, NIE PRZEZ KOLEJNOŚĆ. Łańcuch zwracany przez
// atrapę JEST wartością eksportowaną przez moduł produkcyjny
// (`export const requireStaff = roleMiddleware(...)`), więc test czyta ciało
// wprost z eksportu: `capturedServer(requireStaff)`. Nie ma tu indeksowania
// rejestru „pierwszy zarejestrowany = requireSupabaseAuth", które psułoby się
// przy każdej zmianie kolejności importów.
//
// Wzorzec podmiany fabryki jest w repo starszy niż ten plik
// (`src/lib/consent/__tests__/gpcMiddleware.test.ts`) - tutaj jest wyciągnięty
// do jednego miejsca, żeby kolejne testy middleware go nie kopiowały.

/** Argumenty, jakie framework podaje ciału `.server()`. */
export interface MiddlewareServerArgs {
  next: (arg?: unknown) => unknown;
  context: Record<string, unknown>;
  request?: unknown;
  data?: unknown;
}

export type MiddlewareServerFn = (args: MiddlewareServerArgs) => unknown;

/** Argumenty ciała `.client()` - transport tokenu, bez kontekstu serwera. */
export interface MiddlewareClientArgs {
  next: (arg?: unknown) => unknown;
}

export type MiddlewareClientFn = (args: MiddlewareClientArgs) => unknown;

/**
 * Łańcuch zwracany przez atrapę. Pola `capturedServer` / `capturedClient` /
 * `declaredMiddleware` są celowo jawne (a nie ukryte pod symbolem): test ma je
 * czytać, a pomyłka „to nie jest przechwycone middleware" ma być błędem
 * TypeScriptu, nie cichym `undefined`.
 */
export interface CapturedMiddleware {
  readonly capturedKind: "middleware";
  /** Opcje przekazane do `createMiddleware({ ... })`. */
  readonly capturedOptions: unknown;
  /** Middleware zadeklarowane przez `.middleware([...])` - łańcuch W GÓRĘ. */
  declaredMiddleware: unknown[];
  capturedServer: MiddlewareServerFn | null;
  capturedClient: MiddlewareClientFn | null;
  middleware(list: unknown[]): CapturedMiddleware;
  server(fn: MiddlewareServerFn): CapturedMiddleware;
  client(fn: MiddlewareClientFn): CapturedMiddleware;
}

function isCaptured(value: unknown): value is CapturedMiddleware {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { capturedKind?: unknown }).capturedKind === "middleware"
  );
}

/** Fabryka `createMiddleware` przechwytująca ciała zamiast je gubić. */
export function createMiddlewareCapture(capturedOptions?: unknown): CapturedMiddleware {
  const chain: CapturedMiddleware = {
    capturedKind: "middleware",
    capturedOptions,
    declaredMiddleware: [],
    capturedServer: null,
    capturedClient: null,
    middleware(list) {
      chain.declaredMiddleware = [...chain.declaredMiddleware, ...list];
      return chain;
    },
    server(fn) {
      chain.capturedServer = fn;
      return chain;
    },
    client(fn) {
      chain.capturedClient = fn;
      return chain;
    },
  };
  return chain;
}

/**
 * Moduł-atrapa `@tanstack/react-start` dla testów middleware. Używać WEWNĄTRZ
 * fabryki `vi.mock` (jest hoistowana, więc nie widzi importów z góry pliku):
 *
 *   vi.mock("@tanstack/react-start", async () =>
 *     (await import("@/test/middlewareHarness")).middlewareCaptureMock());
 */
export function middlewareCaptureMock(): Record<string, unknown> {
  return { createMiddleware: (options?: unknown) => createMiddlewareCapture(options) };
}

/**
 * Ciało `.server()` przechwycone z eksportu modułu produkcyjnego.
 *
 * Brak przechwycenia to BŁĄD TESTU, nie `undefined`: znaczy, że atrapa nie
 * objęła modułu (zapomniany `vi.mock`) albo że middleware przestało
 * rejestrować ciało - i w obu przypadkach dalsze asercje dowodziłyby fikcji.
 */
export function capturedServer(value: unknown): MiddlewareServerFn {
  if (!isCaptured(value)) {
    throw new Error("test: podana wartość nie jest przechwyconym middleware (brak `vi.mock`?)");
  }
  if (!value.capturedServer) {
    throw new Error("test: to middleware nie zarejestrowało ciała `.server()`");
  }
  return value.capturedServer;
}

/** Ciało `.client()` - transport po stronie przeglądarki. */
export function capturedClient(value: unknown): MiddlewareClientFn {
  if (!isCaptured(value)) {
    throw new Error("test: podana wartość nie jest przechwyconym middleware (brak `vi.mock`?)");
  }
  if (!value.capturedClient) {
    throw new Error("test: to middleware nie zarejestrowało ciała `.client()`");
  }
  return value.capturedClient;
}

/**
 * Middleware zadeklarowane W GÓRĘ przez `.middleware([...])`. Dowód, że
 * autoryzacja stoi NA uwierzytelnieniu, a nie obok niego.
 */
export function declaredMiddleware(value: unknown): unknown[] {
  if (!isCaptured(value)) {
    throw new Error("test: podana wartość nie jest przechwyconym middleware (brak `vi.mock`?)");
  }
  return value.declaredMiddleware;
}

/** Zapis jednego wywołania `next()` - argument jest treścią, nie ozdobą. */
export interface NextCall {
  readonly arg: unknown;
}

export interface MiddlewareRun {
  /** Wywołania `next()` w kolejności - PUSTE, gdy middleware odrzuciło. */
  readonly nextCalls: NextCall[];
  /** Kontekst wstrzyknięty przez `next({ context })`, scalony po kolei. */
  readonly injectedContext: Record<string, unknown>;
  /** Wynik ciała middleware. */
  readonly result: unknown;
}

const NEXT_SENTINEL = Symbol("test: wynik next()");

/** Sentinel zwracany przez atrapę `next()` - do asercji „przepuszczono dalej". */
export const middlewarePassThrough: unknown = NEXT_SENTINEL;

/**
 * Wywołuje ciało middleware tak, jak zrobiłby to framework: z podanym
 * kontekstem i z atrapą `next()`, która ZAPISUJE swój argument.
 *
 * Rzuca dalej wszystko, co rzuciło middleware - odmowa autoryzacji jest
 * wyjątkiem, więc test odmowy musi ją zobaczyć jako wyjątek.
 */
export async function runMiddleware(
  value: unknown,
  input: MiddlewareInput = {},
): Promise<MiddlewareRun> {
  const outcome = await attemptMiddleware(value, input);
  if (outcome.error) throw outcome.error;
  return {
    nextCalls: outcome.nextCalls,
    injectedContext: outcome.injectedContext,
    result: outcome.result,
  };
}

export interface MiddlewareInput {
  context?: Record<string, unknown>;
  request?: unknown;
  data?: unknown;
}

/** Przebieg, który MOŻE się nie udać - `error` niesie odmowę, nie wyjątek testu. */
export interface MiddlewareOutcome extends MiddlewareRun {
  readonly error: unknown;
}

/**
 * Jak `runMiddleware`, ale ODMOWA NIE GUBI ZAPISU. Wyjątek z middleware jest
 * zwracany w `error`, a `nextCalls` zostaje dostępne - bez tego nie da się
 * udowodnić zdania „odmowa nastąpiła PRZED handlerem", bo rzut zabiera ze sobą
 * jedyny ślad tego, czy `next()` zdążyło się wykonać. To jest różnica między
 * „zwróciło 401" a „zwróciło 401 i nic nie zrobiło".
 */
export async function attemptMiddleware(
  value: unknown,
  input: MiddlewareInput = {},
): Promise<MiddlewareOutcome> {
  const nextCalls: NextCall[] = [];
  const injectedContext: Record<string, unknown> = {};
  const next = (arg?: unknown): unknown => {
    nextCalls.push({ arg });
    const ctx = (arg as { context?: Record<string, unknown> } | undefined)?.context;
    if (ctx) Object.assign(injectedContext, ctx);
    return NEXT_SENTINEL;
  };
  try {
    const result = await capturedServer(value)({
      next,
      context: input.context ?? {},
      request: input.request,
      data: input.data,
    });
    return { nextCalls, injectedContext, result, error: null };
  } catch (error) {
    return { nextCalls, injectedContext, result: undefined, error };
  }
}
