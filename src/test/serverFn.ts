// Atrapa `createServerFn` - jedyna droga do CIAŁA handlera server fn w vitest.
//
// DLACZEGO w ogóle: prawdziwa funkcja zbudowana przez `createServerFn` nie
// daje się wywołać poza runtime'em TanStack Start. Sprawdzone, nie założone -
// wywołanie kończy się `Error: No Start context found in AsyncLocalStorage`,
// a obiekt nie wystawia ani `options`, ani handlera (jedyna własna właściwość
// to `__executeServer`). Dlatego CAŁA warstwa serwerowa newslettera stała na
// zerze: doręczalność 0/19 funkcji, zapis 0/11, panel admina 0/10 - nie było
// jak jej dotknąć testem.
//
// CO ATRAPA ZASTĘPUJE, A CZEGO NIE: odtwarza łańcuch budujący
// (`middleware -> validator -> handler`) i wywołuje handler z wstrzykniętym
// kontekstem, więc test przechodzi przez PRAWDZIWY kod handlera - mapowanie
// wiersza, gałęzie błędu, kształt odpowiedzi. NIE wykonuje middleware, czyli
// nie dowodzi autoryzacji. To jest świadomy podział, nie luka:
//   * zestaw middleware KAŻDEJ server fn pilnuje bramka statyczna
//     `check:authz-snapshot` (src/lib/authz/authzSnapshot.generated.ts),
//   * a `serverFnMeta()` niżej pozwala dodatkowo dowieść w teście, że dana
//     funkcja deklaruje `requireAdminEditor`, a nie samo uwierzytelnienie.
// Test handlera odpowiada więc na pytanie „czy logika jest poprawna", a nie
// „czy ktoś obcy się dostanie" - i tylko tak wolno czytać jego zieleń.
import { vi } from "vitest";

/** Kontekst, jaki middleware wstrzyknęłoby handlerowi w produkcji. */
export interface ServerFnContext {
  supabase: unknown;
  userId?: string;
  claims?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Metadane zapisane przez atrapę - do asercji o obudowie funkcji. */
export interface ServerFnMeta {
  method: string;
  middleware: unknown[];
  hasValidator: boolean;
}

const META = new WeakMap<object, ServerFnMeta>();

let currentContext: ServerFnContext | null = null;

/**
 * Ustaw kontekst dla kolejnych wywołań server fn. Wołane w `beforeEach`.
 * Brak kontekstu to BŁĄD testu, nie „pusty kontekst" - handler czytający
 * `context.supabase` z `undefined` wywaliłby się komunikatem o niczym.
 */
export function setServerFnContext(context: ServerFnContext): void {
  currentContext = context;
}

export function resetServerFnContext(): void {
  currentContext = null;
}

/** Metadane server fn (method, middleware, obecność walidatora). */
export function serverFnMeta(fn: unknown): ServerFnMeta | undefined {
  return typeof fn === "object" || typeof fn === "function" ? META.get(fn as object) : undefined;
}

interface Builder {
  middleware(list: unknown[]): Builder;
  validator(fn: (data: unknown) => unknown): Builder;
  handler(fn: (args: { data: unknown; context: ServerFnContext }) => unknown): unknown;
}

/**
 * Podmiennik `createServerFn`. Zwrócona funkcja przyjmuje `{ data }` dokładnie
 * jak prawdziwa server fn wołana z klienta, więc test wygląda jak użycie
 * produkcyjne - i tak samo przechodzi przez walidator (zod rzuca na złym
 * wejściu, co jest osobnym przypadkiem testowym, nie przypadkiem brzegowym).
 */
export function createServerFnMock(options?: { method?: string }): Builder {
  const meta: ServerFnMeta = {
    method: options?.method ?? "GET",
    middleware: [],
    hasValidator: false,
  };
  let validate: ((data: unknown) => unknown) | null = null;

  const builder: Builder = {
    middleware(list) {
      meta.middleware.push(...list);
      return builder;
    },
    validator(fn) {
      validate = fn;
      meta.hasValidator = true;
      return builder;
    },
    handler(fn) {
      const callable = async (input?: { data?: unknown }) => {
        if (!currentContext) {
          throw new Error(
            "test: brak kontekstu server fn - wywołaj setServerFnContext() w beforeEach",
          );
        }
        const data = validate ? validate(input?.data) : input?.data;
        return fn({ data, context: currentContext });
      };
      META.set(callable, meta);
      return callable;
    },
  };
  return builder;
}

/**
 * Gotowa fabryka modułu. Zachowuje resztę pakietu (hooki routera,
 * `useServerFn`), podmienia wyłącznie `createServerFn` - test panelu i test
 * server fn mogą więc współistnieć.
 *
 * UŻYCIE (dokładnie tak - `vi.mock` jest hoistowane NAD importy, więc fabryki
 * nie wolno podać jako zaimportowanej referencji; to kończy się
 * `Cannot access '__vi_import_1__' before initialization`):
 *
 * ```ts
 * vi.mock("@tanstack/react-start", async () =>
 *   (await import("@/test/serverFn")).serverFnModuleMock(),
 * );
 * ```
 */
export async function serverFnModuleMock(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<Record<string, unknown>>("@tanstack/react-start");
  return { ...actual, createServerFn: createServerFnMock };
}

// ---------------------------------------------------------------------------
// Zgodność wsteczna z drugą, SPECYFIKACYJNĄ atrapą (`@/test/serverFnHarness`).
//
// Dwie generacje testów wołają warstwę serwerową dwoma stylami: starszy
// (ten plik) buduje z handlera funkcję wywoływalną i czyta kontekst z modułu,
// nowszy (harness) oddaje SPECYFIKACJĘ `{ validator, handler, middleware }`
// i podaje kontekst przy wywołaniu. Poniższe trzy re-eksporty pozwalają
// używać stylu specyfikacyjnego, importując z `@/test/serverFn` - bez
// przepisywania testów i bez duplikowania atrapy.
// ---------------------------------------------------------------------------
export {
  asServerFn as asSpec,
  serverFnStubModule as reactStartStub,
  type ServerFnSpec,
} from "./serverFnHarness";

/**
 * Wywołanie w stylu specyfikacyjnym: `(fn, data, context)`. Przechodzi przez
 * walidator (błędne wejście MA rzucać), potem przez handler.
 */
export async function callServerFn<TResult = unknown>(
  fn: unknown,
  data: unknown,
  context: ServerFnContext,
): Promise<TResult> {
  const { asServerFn } = await import("./serverFnHarness");
  const spec = asServerFn(fn);
  const parsed = spec.validator ? spec.validator(data) : data;
  return (await spec.handler?.({ data: parsed, context })) as TResult;
}
