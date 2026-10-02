// FUNKCJE SERWEROWE PULPITU (`dashboard.functions.ts`) - do tego pliku na ZERZE.
//
// Plik nie liczy niczego (rachunek siedzi w SQL-u), więc przedmiotem dowodu są
// trzy rzeczy, na których stoi zaufanie do pulpitu:
//   1. OKNO z klienta przechodzi walidację i trafia do RPC pod właściwymi
//      nazwami parametrów - pomyłka nazwy to cichy `null` w SQL-u i raport
//      liczony od początku świata;
//   2. „ŹRÓDŁA NIE MA" (migracja jeszcze nie doszła) jest odróżnione od „zero":
//      cztery kody braku funkcji/relacji/kolumny degradują do pustego raportu
//      z `available: false`;
//   3. KAŻDY INNY BŁĄD - w tym odmowa roli 42501 - leci dalej. Cicha pustka
//      w miejscu odmowy uprawnień byłaby kłamstwem o stanie systemu.
//
// Middleware (`requireSupabaseAuth`) nie jest tu wykonywane (patrz nagłówek
// `@/test/serverFnHarness`); autoryzacja pulpitu mieszka w bazie
// (`admin_dashboard_tenant()`), a jej obecność w SQL-u pilnuje snapshot bramek.
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import {
  callServerFn,
  serverFnMiddlewareNames,
  validateServerFnInput,
  type ServerFnContext,
} from "@/test/serverFnHarness";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

import {
  getDashboardAudience,
  getDashboardContent,
  getDashboardCrm,
  getDashboardMarketing,
  getDashboardRealtime,
  getDashboardTraffic,
} from "@/lib/admin/dashboard/dashboard.functions";

interface RpcResult {
  data: unknown;
  error: { code: string; message: string } | null;
}

function rpcContext(result: RpcResult): {
  context: ServerFnContext;
  calls: { name: string; args: unknown }[];
} {
  const calls: { name: string; args: unknown }[] = [];
  return {
    calls,
    context: {
      supabase: {
        rpc: async (name: string, args: unknown) => {
          calls.push({ name, args });
          return result;
        },
      },
      userId: "11111111-1111-4111-8111-111111111111",
    },
  };
}

const WINDOW = {
  sinceIso: "2026-06-01T00:00:00.000Z",
  untilIso: "2026-06-08T00:00:00.000Z",
  prevSinceIso: "2026-05-25T00:00:00.000Z",
  prevUntilIso: "2026-06-01T00:00:00.000Z",
};

const RPC_WINDOW = {
  p_since: WINDOW.sinceIso,
  p_until: WINDOW.untilIso,
  p_prev_since: WINDOW.prevSinceIso,
  p_prev_until: WINDOW.prevUntilIso,
};

const WINDOWED = [
  ["getDashboardTraffic", getDashboardTraffic, "admin_dashboard_traffic"],
  ["getDashboardCrm", getDashboardCrm, "admin_dashboard_crm"],
  ["getDashboardMarketing", getDashboardMarketing, "admin_dashboard_marketing"],
  ["getDashboardAudience", getDashboardAudience, "admin_dashboard_audience"],
] as const;

const ALL = [
  ...WINDOWED,
  ["getDashboardContent", getDashboardContent, "admin_dashboard_content"],
  ["getDashboardRealtime", getDashboardRealtime, "admin_dashboard_realtime"],
] as const;

describe("pulpit - obudowa", () => {
  it.each(ALL)("%s: POST za `requireSupabaseAuth`", (_name, fn) => {
    expect(serverFnMiddlewareNames(fn)).toEqual(["requireSupabaseAuth"]);
    expect(Reflect.get(fn as object, "method")).toBe("POST");
  });
});

describe("pulpit - walidacja okna", () => {
  it("domyślny kubełek to dzień, domyślne przesunięcie strefy - zero", () => {
    expect(validateServerFnInput(getDashboardTraffic, WINDOW)).toEqual({
      ...WINDOW,
      bucket: "day",
      offsetMinutes: 0,
    });
  });

  it("odrzuca brak okna, datę spoza ISO, nieznany kubełek i strefę spoza ±14 h", () => {
    expect(() => validateServerFnInput(getDashboardCrm, undefined)).toThrow(ZodError);
    expect(() =>
      validateServerFnInput(getDashboardCrm, { ...WINDOW, sinceIso: "2026-06-01" }),
    ).toThrow(ZodError);
    expect(() => validateServerFnInput(getDashboardCrm, { ...WINDOW, bucket: "year" })).toThrow(
      ZodError,
    );
    expect(() => validateServerFnInput(getDashboardCrm, { ...WINDOW, offsetMinutes: 841 })).toThrow(
      ZodError,
    );
    expect(() =>
      validateServerFnInput(getDashboardCrm, { ...WINDOW, offsetMinutes: -841 }),
    ).toThrow(ZodError);
    expect(
      validateServerFnInput(getDashboardCrm, { ...WINDOW, offsetMinutes: -840 }),
    ).toMatchObject({ offsetMinutes: -840 });
  });

  it("treść: język domyślnie `pl`, kod 2-8 znaków", () => {
    expect(validateServerFnInput(getDashboardContent, WINDOW)).toMatchObject({ lang: "pl" });
    expect(() => validateServerFnInput(getDashboardContent, { ...WINDOW, lang: "x" })).toThrow(
      ZodError,
    );
  });

  it("na żywo: domyślnie 5 min aktywności w oknie 30 min; granice 1-60 i 5-360", () => {
    expect(validateServerFnInput(getDashboardRealtime, undefined)).toEqual({
      activeMinutes: 5,
      windowMinutes: 30,
    });
    expect(() => validateServerFnInput(getDashboardRealtime, { activeMinutes: 0 })).toThrow(
      ZodError,
    );
    expect(() => validateServerFnInput(getDashboardRealtime, { windowMinutes: 361 })).toThrow(
      ZodError,
    );
  });
});

describe("pulpit - parametry RPC", () => {
  it.each(WINDOWED)("%s woła `%s` z oknem, kubełkiem i strefą", async (_name, fn, rpc) => {
    const { context, calls } = rpcContext({ data: {}, error: null });
    await callServerFn(fn, {
      data: { ...WINDOW, bucket: "hour", offsetMinutes: 120 },
      context,
    });
    const expected: Record<string, unknown> = {
      ...RPC_WINDOW,
      p_bucket: "hour",
      p_offset_minutes: 120,
    };
    // Ruch jako jedyny dostaje limit list (ścieżki, kraje, źródła).
    if (rpc === "admin_dashboard_traffic") expected.p_limit = 12;
    expect(calls).toEqual([{ name: rpc, args: expected }]);
  });

  it("treść woła RPC z oknem i językiem - bez kubełka i strefy, których funkcja nie zna", async () => {
    const { context, calls } = rpcContext({ data: {}, error: null });
    await callServerFn(getDashboardContent, { data: { ...WINDOW, lang: "en" }, context });
    expect(calls).toEqual([
      { name: "admin_dashboard_content", args: { ...RPC_WINDOW, p_lang: "en" } },
    ]);
  });

  it("na żywo NIE podaje okna z zegara klienta - tylko długości okien", async () => {
    const { context, calls } = rpcContext({ data: {}, error: null });
    await callServerFn(getDashboardRealtime, {
      data: { activeMinutes: 10, windowMinutes: 60 },
      context,
    });
    expect(calls).toEqual([
      { name: "admin_dashboard_realtime", args: { p_active_minutes: 10, p_window_minutes: 60 } },
    ]);
  });
});

describe("pulpit - wynik: dostępny, brak źródła, błąd", () => {
  it("udany odczyt jest `available: true` i przechodzi przez parser", async () => {
    const { context } = rpcContext({
      data: { current: { sessions: "42" } },
      error: null,
    });
    const result = await callServerFn<{
      available: boolean;
      report: { current: { sessions: number } };
    }>(getDashboardTraffic, { data: WINDOW, context });
    expect(result.available).toBe(true);
    // `"42"` (bigint z Postgresa jako napis) czyta się jako liczba.
    expect(result.report.current.sessions).toBe(42);
  });

  it.each(["42883", "42P01", "42703", "PGRST202"])(
    "kod `%s` (źródła jeszcze nie ma) degraduje do pustego raportu z `available: false`",
    async (code) => {
      for (const [, fn] of ALL) {
        const { context } = rpcContext({ data: null, error: { code, message: "missing" } });
        const input = fn === getDashboardRealtime ? {} : WINDOW;
        const result = await callServerFn<{ available: boolean; report: unknown }>(fn, {
          data: input,
          context,
        });
        expect(result.available).toBe(false);
        expect(result.report).toBeTypeOf("object");
      }
    },
  );

  it.each([
    ["42501", "permission denied for function admin_dashboard_crm"],
    ["57014", "canceling statement due to statement timeout"],
  ])(
    "kod `%s` NIE jest „brakiem źródła” - błąd leci dalej z komunikatem bazy",
    async (code, message) => {
      for (const [, fn] of ALL) {
        const { context } = rpcContext({ data: null, error: { code, message } });
        const input = fn === getDashboardRealtime ? {} : WINDOW;
        await expect(callServerFn(fn, { data: input, context })).rejects.toThrow(message);
      }
    },
  );
});
