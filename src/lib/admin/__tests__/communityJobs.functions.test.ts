// Ręczne uruchomienie zadań crona z panelu społeczności
// (`communityJobs.functions.ts`).
//
// Zadania crona mają EXECUTE wyłącznie dla service_role - przycisk w panelu
// wołający je klientem przeglądarki dostawał 42501 przy każdym kliknięciu,
// a test atrapy tego nie widział. Tu przypinamy trzy rzeczy, które o tym
// decydują: bramka roli PRZED wywołaniem, rola serwisowa jako klient, i to,
// że błąd bazy nie zamienia się w „0 wysłanych".
import { beforeEach, describe, expect, it, vi } from "vitest";

import { callServerFn, serverFnMiddlewareNames } from "@/test/serverFnHarness";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireAdmin: { name: "requireAdmin" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: (...args: unknown[]) => h.rpc(...args) },
}));

const { purgeExpiredMessagesNow, runEventRemindersNow } =
  await import("@/lib/admin/communityJobs.functions");

beforeEach(() => {
  h.rpc.mockReset();
});

describe.each([
  ["runEventRemindersNow", runEventRemindersNow, "run_event_reminders"],
  ["purgeExpiredMessagesNow", purgeExpiredMessagesNow, "chat_purge_expired_messages"],
] as const)("%s", (_label, fn, rpcName) => {
  it("stoi za requireAdmin (admin/super_admin najemcy) i jest POST", () => {
    expect(serverFnMiddlewareNames(fn)).toEqual(["requireAdmin"]);
    expect(Reflect.get(fn as object, "method")).toBe("POST");
  });

  it("woła zadanie crona ROLĄ SERWISOWĄ i oddaje liczbę", async () => {
    h.rpc.mockResolvedValue({ data: 7, error: null });
    await expect(callServerFn(fn, { data: undefined, context: { supabase: null } })).resolves.toBe(
      7,
    );
    expect(h.rpc).toHaveBeenCalledWith(rpcName);
  });

  it("zwrotka nie-liczbowa to 0, nie NaN", async () => {
    h.rpc.mockResolvedValue({ data: null, error: null });
    await expect(callServerFn(fn, { data: undefined, context: { supabase: null } })).resolves.toBe(
      0,
    );
  });

  it("błąd bazy to wyjątek, nie „0 przetworzonych”", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "statement timeout" } });
    await expect(
      callServerFn(fn, { data: undefined, context: { supabase: null } }),
    ).rejects.toThrow("statement timeout");
  });
});
