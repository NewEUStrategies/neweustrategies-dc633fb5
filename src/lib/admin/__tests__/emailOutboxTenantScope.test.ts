// Skrzynka wysyłek panelu admina - GRANICA NAJEMCY.
//
// PRZYCZYNA ŹRÓDŁOWA, którą ten plik pilnuje. `email_send_log` ma RLS
// dopuszczający wyłącznie `service_role`, a `getEmailOutbox` czyta go właśnie
// klientem serwisowym - czyli z pominięciem RLS. Jedyną zaporą przed handlerem
// była bramka ROLI (`requireAdminEditor`), a rola nie jest granicą danych:
// administrator serwisu A dostawał adresy odbiorców i treść błędów dostawcy
// serwisu B. Dziennik jest jedynym zapisem tego, co platforma wysłała, więc
// wyciek dotyczy kompletu korespondencji, nie jej próbki.
//
// CZEGO TEN HARNESS NIE UDAJE: middleware. `@/test/serverFnHarness` nie
// uruchamia bramek (patrz jego własny nagłówek), więc rola jest sprawdzana
// STRUKTURALNIE (lista middleware), a granica najemcy - BEHAWIORALNIE, na
// zapytaniu, które handler faktycznie złożył.
//
// WIERNOŚĆ ATRAPY JEST TU WARUNKIEM SENSU TESTU. Atrapa dziennika filtruje
// wiersze po ZAPISANYM `.eq()`, a nie oddaje stałej: stała odpowiedź czyniłaby
// z dowodu „wiersz obcego najemcy nie wraca do panelu" fikcję, bo przeszedłby
// tak samo dla kodu bez filtru.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub } from "@/test/supabaseChain";
import { callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";

/** Klient SERWISOWY (omija RLS) - stąd czyta się dziennik wysyłek. */
const admin = supabaseFromStub();
/** Klient UŻYTKOWNIKA z kontekstu middleware - stąd bierze się tenant wołającego. */
const user = supabaseFromStub();

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdminEditor: { name: "requireAdminEditor" },
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => admin.from(table) },
}));

import { getEmailOutbox, type OutboxResult } from "@/lib/admin/emailOutbox.functions";

const LOG = "email_send_log";
const PROFILES = "profiles";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

interface LogRow extends Record<string, unknown> {
  tenant_id: string;
}

function logRow(over: Partial<LogRow> = {}): LogRow {
  return {
    id: "log-1",
    message_id: "msg-1",
    template_name: "payment_failed",
    recipient_email: "anna@a.test",
    status: "sent",
    error_message: null,
    created_at: "2026-09-13T09:00:00.000Z",
    tenant_id: TENANT_A,
    ...over,
  };
}

/**
 * Dziennik odpowiada TAK, JAK ODPOWIEDZIAŁBY PostgREST: zwraca wyłącznie te
 * wiersze, które przeszły przez zapisany filtr `.eq("tenant_id", …)`. Bez
 * filtru w kodzie produkcyjnym wracają wszystkie - i to właśnie ma być widać.
 */
function seedLog(rows: readonly LogRow[]): void {
  admin.setResponse(LOG, (chain) => {
    const eq = chain.argsOf("eq");
    if (!eq) return ok([...rows]);
    const [column, value] = eq;
    return ok(rows.filter((row) => row[String(column)] === value));
  });
}

/** Profil wołającego - źródło jego tenanta. */
function seedCaller(tenantId: string | null): void {
  user.setResponse(PROFILES, ok(tenantId === null ? { tenant_id: null } : { tenant_id: tenantId }));
}

function context() {
  return { supabase: { from: (table: string) => user.from(table) }, userId: "admin-a" };
}

function call(data?: unknown): Promise<OutboxResult> {
  return callServerFn<OutboxResult>(getEmailOutbox, { data, context: context() });
}

beforeEach(() => {
  admin.reset();
  user.reset();
  seedCaller(TENANT_A);
  seedLog([logRow()]);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("granica najemcy skrzynki wysyłek", () => {
  it("odczyt dziennika jest zawężony do najemcy wywołującego", async () => {
    await call();

    expect(admin.chainsFor(LOG)).toHaveLength(1);
    expect(admin.chainsFor(LOG)[0]?.argsOf("eq")).toEqual(["tenant_id", TENANT_A]);
  });

  it("wiersz obcego najemcy nie wraca do panelu", async () => {
    seedLog([
      logRow({ id: "log-a", message_id: "msg-a", recipient_email: "anna@a.test" }),
      logRow({
        id: "log-b",
        message_id: "msg-b",
        recipient_email: "borys@b.test",
        tenant_id: TENANT_B,
      }),
    ]);

    const result = await call();

    expect(result.rows).toHaveLength(1);
    expect(result.rows.map((r) => r.recipientEmail)).toEqual(["anna@a.test"]);
  });

  it("statystyki i lista szablonów liczą się z okna JEDNEGO najemcy", async () => {
    // Liczby nad tabelą są tak samo wyciekiem jak sama tabela: „wysłano 412"
    // z cudzego ruchu mówi konkurencji o skali jego wysyłki.
    seedLog([
      logRow({ id: "a1", message_id: "a1", template_name: "payment_failed" }),
      logRow({ id: "b1", message_id: "b1", template_name: "invite", tenant_id: TENANT_B }),
      logRow({ id: "b2", message_id: "b2", template_name: "invite", tenant_id: TENANT_B }),
    ]);

    const result = await call();

    expect(result.stats.total).toBe(1);
    expect(result.stats.sent).toBe(1);
    expect(result.templates).toEqual(["payment_failed"]);
    expect(result.total).toBe(1);
  });

  it("brak tenanta w profilu to ODMOWA, nie pusty wynik", async () => {
    // Pusty wynik wygląda w panelu identycznie jak „nic nie wysłaliśmy", więc
    // fail-open udawałby tu sprawny, cichy system. Fail-closed mówi wprost.
    seedCaller(null);

    await expect(call()).rejects.toThrow(/Forbidden: missing tenant/);
  });

  it("tenant jest rozstrzygany PRZED sięgnięciem po klienta serwisowego", async () => {
    // Na ścieżce odmowy klucz service-role nie ma prawa nawet zostać użyty.
    seedCaller(null);

    await expect(call()).rejects.toThrow();

    expect(admin.chainsFor(LOG)).toHaveLength(0);
  });

  it("filtry operatora nie zastępują granicy najemcy - dokładają się do niej", async () => {
    seedLog([
      logRow({ id: "a1", message_id: "a1", status: "sent" }),
      logRow({ id: "b1", message_id: "b1", status: "sent", tenant_id: TENANT_B }),
    ]);

    const result = await call({ status: "sent", days: 30 });

    expect(admin.chainsFor(LOG)[0]?.argsOf("eq")).toEqual(["tenant_id", TENANT_A]);
    expect(result.rows).toHaveLength(1);
  });

  it("funkcja deklaruje bramkę requireAdminEditor", () => {
    // Dowód STRUKTURALNY: harness nie uruchamia middleware, więc odmowy dla
    // nie-administratora nie da się tu odegrać - ale usunięcie bramki z kodu
    // wywraca ten przypadek.
    expect(serverFnMiddlewareNames(getEmailOutbox)).toContain("requireAdminEditor");
  });
});
