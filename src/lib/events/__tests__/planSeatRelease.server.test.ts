// Przegląd biletów z puli planu wołany z crona aplikacji.
//
// DLACZEGO TEN TEST ISTNIEJE. Bez pg_cron migracja 20260926150000 nie planuje
// przeglądu - bilety porzuconych kas zostawałyby zajęte na zawsze. Test
// pilnuje, że krok crona woła funkcję bazy z limitem, oddaje liczbę
// zwróconych biletów, na bazie bez migracji milczy, a inny błąd zgłasza.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  result: { data: null as unknown, error: null as { message: string; code: string } | null },
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: unknown) => {
      h.calls.push({ name, args });
      return Promise.resolve(h.result);
    },
  },
}));

const { runPlanSeatRelease } = await import("@/lib/events/planSeatRelease.server");

beforeEach(() => {
  h.result = { data: null, error: null };
  h.calls.length = 0;
});

describe("runPlanSeatRelease", () => {
  it("woła przegląd z domyślnym limitem 500 i oddaje liczbę zwróconych biletów", async () => {
    h.result = { data: 3, error: null };

    await expect(runPlanSeatRelease()).resolves.toEqual({ released: 3 });
    expect(h.calls).toEqual([{ name: "_event_plan_seat_release_lapsed", args: { p_limit: 500 } }]);
  });

  it("przekazuje własny limit partii", async () => {
    h.result = { data: 0, error: null };

    await expect(runPlanSeatRelease(50)).resolves.toEqual({ released: 0 });
    expect(h.calls[0]?.args).toEqual({ p_limit: 50 });
  });

  it("odpowiedź bez liczby to zero zwróconych, nie wyjątek", async () => {
    h.result = { data: null, error: null };

    await expect(runPlanSeatRelease()).resolves.toEqual({ released: 0 });
  });

  it.each(["PGRST202", "42883"])(
    "baza bez migracji (%s) to „nic do zrobienia”, nie czerwony krok",
    async (code) => {
      h.result = { data: null, error: { message: "function does not exist", code } };

      await expect(runPlanSeatRelease()).resolves.toEqual({
        released: 0,
        skipped: "migration_pending",
      });
    },
  );

  it("każdy inny błąd bazy rzuca - krok crona ma to zgłosić", async () => {
    h.result = { data: null, error: { message: "permission denied", code: "42501" } };

    await expect(runPlanSeatRelease()).rejects.toThrow("permission denied");
  });
});
