// Ręczny „tick" zadań tła z panelu `/admin/tracker` - 0/3 linii, 0/1 funkcji.
//
// PO CO TESTOWAĆ TRZY LINIE. Bo każda z nich niesie osobną decyzję, a dwie z
// nich są DECYZJAMI BEZPIECZEŃSTWA:
//
//   1. KLIENT ADMINA, NIE KLIENT SESJI. Handler świadomie bierze
//      `supabaseAdmin` (service role), bo tick musi zadziałać ponad RLS -
//      drenuje kolejki pocztowe i push wszystkich najemców. Podmiana na
//      `context.supabase` uciszyłaby połowę jobów bez jednego błędu w logu:
//      RLS po prostu nie oddałby wierszy, a tick zaraportowałby zera.
//   2. ŹRÓDŁO 'admin' JEST ROZRÓŻNIALNOŚCIĄ, NIE ETYKIETĄ. Panel zdrowia
//      harmonogramu odróżnia „kolejka pusta" od „nikt nie woła dyspozytora"
//      wyłącznie po wpisach w `job_runner_runs` z podziałem na źródła.
//      Ręczne wypchnięcie zapisane jako `pg_cron` albo `external` fałszuje
//      dokładnie ten sygnał: martwy cron wygląda wtedy na żywy, bo ktoś
//      klika w panelu.
//   3. OPERATOR IDZIE DO ŚLADU AUDYTOWEGO. `actorId` z kontekstu, a nie z
//      wejścia - funkcja nie ma walidatora i nie przyjmuje ŻADNYCH danych od
//      klienta, więc nie da się podszyć pod innego operatora ani podać
//      parametrów ticku.
//
// GRANICE. `runJobsTick` jest atrapą - to on ma własny, pełny zestaw testów, a
// tutaj przedmiotem dowodu jest WYWOŁANIE: który klient i jakie metadane.
// Middleware nie biegnie (atrapa fabryki go nie uruchamia), więc test NIE
// dowodzi autoryzacji - zestaw middleware pilnuje bramka `check:authz-snapshot`,
// a poniżej sprawdzamy jedynie, że funkcja go DEKLARUJE.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as Array<{ admin: unknown; meta: Record<string, unknown> }>,
  result: {} as unknown,
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
// Wartownik zamiast prawdziwego middleware: atrapa fabryki go nie wykonuje, a
// test ma dowieść, że funkcja deklaruje DOKŁADNIE tę straż.
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireStaff: { name: "requireStaff" },
}));
vi.mock("@/lib/server/jobsTick.server", () => ({
  runJobsTick: async (admin: unknown, meta: Record<string, unknown>) => {
    h.calls.push({ admin, meta });
    return h.result;
  },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { marker: "service-role" },
  supabase: { marker: "anon" },
}));

import { callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";
import { runTrackerTickNow } from "@/lib/tracker-admin.functions";

const SESSION_CLIENT = { marker: "session" };

const call = (userId?: string) =>
  callServerFn(runTrackerTickNow, {
    context: { supabase: SESSION_CLIENT, userId },
  });

beforeEach(() => {
  h.calls = [];
  h.result = { newsletter: { fired: 0, continued: 0, sent: 0 } };
});

// ---------------------------------------------------------------------------
describe("obudowa funkcji", () => {
  it("jest metodą POST - tick zmienia stan, nie odczytuje go", () => {
    expect(Reflect.get(runTrackerTickNow as object, "method")).toBe("POST");
  });

  it("deklaruje straż roli sztabowej", () => {
    expect(serverFnMiddlewareNames(runTrackerTickNow)).toEqual(["requireStaff"]);
  });

  it("NIE ma walidatora - nie przyjmuje od klienta żadnych parametrów ticku", () => {
    // Brak wejścia to własność bezpieczeństwa: nie da się wskazać najemcy,
    // operatora ani zakresu jobów z zewnątrz.
    expect(Reflect.get(runTrackerTickNow as object, "validator")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("wywołanie dyspozytora", () => {
  it("używa klienta SERVICE ROLE, a nie klienta sesji", async () => {
    await call("operator-1");

    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].admin).toEqual({ marker: "service-role" });
    expect(h.calls[0].admin).not.toBe(SESSION_CLIENT);
  });

  it("zapisuje źródło 'admin' - inaczej martwy cron wygląda na żywy", async () => {
    await call("operator-1");

    expect(h.calls[0].meta.source).toBe("admin");
  });

  it("przekazuje operatora Z KONTEKSTU", async () => {
    await call("operator-42");

    expect(h.calls[0].meta.actorId).toBe("operator-42");
  });

  it("oddaje wynik dyspozytora BEZ ZMIAN - panel czyta pełny raport przebiegu", async () => {
    const report = {
      newsletter: { fired: 2, continued: 1, sent: 3 },
      push: { claimed: 4, sent: 4 },
    };
    h.result = report;

    await expect(call("operator-1")).resolves.toEqual(report);
  });

  it("jedno wywołanie to JEDEN tick - handler nie ponawia sam z siebie", async () => {
    await call("operator-1");
    expect(h.calls).toHaveLength(1);
  });

  it("brak identyfikatora operatora nie wywraca ticku", async () => {
    // Kontekst bez `userId` jest w praktyce nieosiągalny (middleware go
    // ustawia), ale handler nie ma prawa się na tym wysypać - tick drenuje
    // kolejki wszystkich najemców i jego przerwanie kosztuje więcej niż
    // niepełny ślad.
    await expect(call(undefined)).resolves.toBeDefined();
    expect(h.calls[0].meta.actorId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PRZYPIĘTY DEFEKT. Nie zmieniamy tu zachowania produkcyjnego - defekt zostaje
// opisany testem, który JEST czerwony.
describe("defekt przypięty (it.fails)", () => {
  // ŚLAD AUDYTOWY RĘCZNEGO TICKU GUBI NAJEMCĘ.
  //
  // Kontrakt jest zapisany w samym kodzie, więc nie jest moim wymyśleniem -
  // `JobsTickMeta` w `lib/server/jobsTick.server.ts`:
  //
  //     /** Tylko tick ręczny z panelu: ślad audytowy (tenant + operator). */
  //     tenantId?: string | null;
  //     actorId?: string | null;
  //
  // Ten handler podaje `actorId`, a `tenantId` pomija, więc `recordJobRun`
  // odkłada w `job_runner_runs` wiersz z `tenant_id: null`. BLIŹNIACZA funkcja
  // `/admin/scheduler` (`lib/admin/scheduler.functions.ts`) rozwiązuje najemcę
  // z profilu operatora i podaje oba pola - identyczne działanie z dwóch
  // paneli zapisuje się więc RÓŻNIE.
  //
  // DLACZEGO TO NIE JEST KOSMETYKA. Log przebiegów jest odczytywany globalnie
  // (RPC zdrowia harmonogramu nie filtruje po najemcy), bo tick jest globalny -
  // ale właśnie dlatego kolumna `tenant_id` jest jedynym miejscem, w którym
  // widać, CZYJ operator wypchnął alerty ponad RLS wszystkich najemców.
  // W instalacji z wieloma zespołami sztabowymi ręczny tick z `/admin/tracker`
  // jest przypisywalny do osoby, ale nie do obszaru roboczego - a rekonstrukcja
  // po `actorId` wymaga sięgnięcia do profilu, który w tym czasie mógł już
  // zmienić najemcę.
  //
  // NAPRAWA (nie wykonana, bo poza zakresem zlecenia N1-N8): odczyt
  // `profiles.tenant_id` dla `context.userId` i podanie go w `meta`, dokładnie
  // jak w `scheduler.functions.ts`.
  it.fails("ręczny tick zapisuje najemcę operatora w śladzie audytowym", async () => {
    await call("operator-1");

    expect(h.calls[0].meta).toHaveProperty("tenantId");
    expect(h.calls[0].meta.tenantId).not.toBeNull();
  });
});
