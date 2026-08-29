// Stan puli biletów wliczonych w plan - deklaracja server function.
//
// Moduł jest celowo pusty z logiki: odczyt siedzi w `ticketAllowance.server.ts`,
// reguły w `ticketAllowance.ts`, oba mają własne pliki testowe. Sama obwódka
// niesie jednak cztery decyzje, których żaden z tamtych testów nie zobaczy, bo
// żaden z nich nie wie, JAK ta funkcja jest wystawiona na świat:
//
//   1. BRAMKA SESJI. Pula jest PER UŻYTKOWNIK, a RPC ustala go przez
//      `auth.uid()`. Bez `requireSupabaseAuth` w łańcuchu `context.supabase`
//      nie istnieje - handler albo wywala się na `undefined`, albo (gdyby ktoś
//      podstawił klienta anonimowego) każdy członek z opłaconym planem
//      widziałby „brak biletów". Ubytek benefitu jest CICHY, więc nic poza tą
//      asercją by go nie złapało.
//   2. METODA POST. Odpowiedź opisuje pojedyncze konto. `GET` na tej trasie
//      jest cache'owalny po drodze (CDN, proxy, `bfcache`), a podmiana treści
//      między kontami to wyciek stanu członkostwa.
//   3. CO JEDZIE DALEJ. Handler ma podać klienta Z KONTEKSTU i NIC z ciała
//      żądania. Gdyby przekazywał cokolwiek od klienta, wołający sterowałby
//      tym, czyją pulę serwer odczyta.
//   4. BRAK CICHEGO TŁUMIENIA. `loadTicketAllowance` degraduje błędy RPC SAM
//      i nigdy nie rzuca z tego powodu. Wyjątek, który mimo to tu doleci, jest
//      awarią okablowania - `try/catch` dorzucony „dla bezpieczeństwa"
//      zamieniłby ją w wieczne „brak benefitów" bez jednego wpisu w logu.
//
// PUŁAPKA HARNESSU: atrapa `createServerFn` zapisuje opcje i middleware,
// a z `.handler(fn)` oddaje SAMĄ funkcję - test wywołuje PRAWDZIWY handler.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_TICKET_ALLOWANCE, type TicketAllowance } from "@/lib/events/ticketAllowance";

const { loadTicketAllowance, requireSupabaseAuth, spec } = vi.hoisted(() => ({
  loadTicketAllowance: vi.fn(),
  /** Znacznik tożsamości - test dowodzi, że w łańcuchu jest TA middleware. */
  requireSupabaseAuth: { marker: "requireSupabaseAuth" },
  spec: {} as { method?: string; middleware?: readonly unknown[]; validators: number },
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: (options?: { method?: string }) => {
    spec.method = options?.method;
    spec.validators = 0;
    const api = {
      middleware: (chain: readonly unknown[]) => {
        spec.middleware = chain;
        return api;
      },
      inputValidator: () => {
        spec.validators += 1;
        return api;
      },
      handler: (fn: unknown) => fn,
    };
    return api;
  },
}));

vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth }));

vi.mock("@/lib/events/ticketAllowance.server", () => ({ loadTicketAllowance }));

const { getMyTicketAllowance } = await import("@/lib/events/ticketAllowance.functions");

type Callable = (input: {
  context: { supabase: unknown; userId?: string };
  data?: unknown;
}) => Promise<TicketAllowance>;

const readAllowance = getMyTicketAllowance as unknown as Callable;

/** Klient sesji wołającego - obiekt-znacznik, żeby dało się dowieść tożsamość. */
const sessionClient = { marker: "supabase-z-kontekstu" };

const ALLOWANCE: TicketAllowance = {
  ...EMPTY_TICKET_ALLOWANCE,
  granted: 1,
  remaining: 1,
  scope: "personal",
};

beforeEach(() => {
  loadTicketAllowance.mockReset();
  loadTicketAllowance.mockResolvedValue(ALLOWANCE);
});

describe("wystawienie funkcji serwerowej", () => {
  it("działa WYŁĄCZNIE za bramką sesji `requireSupabaseAuth`", () => {
    // Bez tej middleware nie ma `context.supabase`, a RPC czytające
    // `auth.uid()` nie ma kogo rozpoznać. Usunięcie jej przy refaktorze nie
    // wywala żadnego typu - odpowiedź po prostu robi się pusta.
    expect(spec.middleware).toEqual([requireSupabaseAuth]);
  });

  it("jest wystawiona jako POST, a nie GET", () => {
    // Odpowiedź jest prywatna dla jednego konta; `GET` mógłby zostać
    // zapamiętany przez pośrednika i pokazany innemu zalogowanemu.
    expect(spec.method).toBe("POST");
  });

  it("nie deklaruje ŻADNEGO wejścia - wołający nie ma czym sterować odczytem", () => {
    // Brak `inputValidator` to nie zaniedbanie, tylko cały kontrakt tej trasy:
    // pulę wyznacza sesja (`auth.uid()` w RPC), więc nie istnieje pole, które
    // klient mógłby podać. Dopisanie tu walidatora - choćby po to, żeby
    // „przyjąć opcjonalny `orgId`" - otwiera pierwszą szczelinę, przez którą
    // da się zapytać o cudzą pulę, a żaden test kształtu odpowiedzi tego nie
    // zobaczy, bo odpowiedź nadal wygląda poprawnie.
    expect(spec.validators).toBe(0);
  });
});

describe("handler", () => {
  it("czyta pulę klientem Z KONTEKSTU i nie przekazuje NICZEGO z ciała żądania", async () => {
    // `data` jest tu celowo wypełnione wartościami, którymi napastnik chciałby
    // sterować odczytem. Handler ma je zignorować w całości: jedynym
    // argumentem odczytu jest klient sesji.
    await readAllowance({
      context: { supabase: sessionClient, userId: "u-1" },
      data: { userId: "cudzy-uzytkownik", orgId: "cudza-organizacja", scope: "organisation" },
    });

    expect(loadTicketAllowance.mock.calls).toEqual([[sessionClient]]);
  });

  it("oddaje wynik warstwy odczytu BEZ ZMIAN", async () => {
    // Ponowne zawężanie albo przepakowanie wyniku w obwódce dawałoby dwa
    // miejsca, w których kształt puli może się rozjechać. Tożsamość obiektu
    // dowodzi, że obwódka niczego po drodze nie przepisuje.
    const result = await readAllowance({ context: { supabase: sessionClient } });

    expect(result).toBe(ALLOWANCE);
  });

  it("nie tłumi awarii odczytu na cichą pustą pulę", async () => {
    // `loadTicketAllowance` degraduje błędy bazy SAM. Wyjątek, który stąd
    // wychodzi, oznacza zepsute okablowanie (brak modułu, brak klienta) -
    // ma dolecieć do wołającego, a nie zamienić się w „brak benefitów".
    loadTicketAllowance.mockRejectedValue(new Error("supabase client is undefined"));

    await expect(readAllowance({ context: { supabase: undefined } })).rejects.toThrow(
      "supabase client is undefined",
    );
  });
});
