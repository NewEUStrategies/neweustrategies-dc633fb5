// Własność subskrypcji jest pierwszą bramką obu server fn retencyjnych.
// Testujemy sam odczyt PostgREST: autoryzację transportową zapewnia middleware,
// a semantykę RLS - pgTAP. Tutaj istotne jest, że identyfikator użytkownika
// ZAWSZE trafia do zapytania i że okres dostępu po anulowaniu go nie wycina.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok, pgError, supabaseFromStub } from "@/test/chat/fixtures";

const h = vi.hoisted(() => ({
  db: null as ReturnType<typeof supabaseFromStub> | null,
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { __mw: "requireSupabaseAuth" },
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => h.db!.from(table),
  },
}));

const { loadOwnedSubscription } = await import("@/lib/retention/functions");

beforeEach(() => {
  h.db = supabaseFromStub();
});

describe("loadOwnedSubscription", () => {
  it("zwraca `null`, gdy subskrypcja nie istnieje", async () => {
    h.db!.setResponse("user_subscriptions", ok(null));

    const result = await loadOwnedSubscription("user-a", "sub-missing");

    expect(result).toBeNull();
    expect(h.db!.lastChain("user_subscriptions")?.has("maybeSingle")).toBe(true);
  });

  it("nie zwraca subskrypcji należącej do innego użytkownika", async () => {
    h.db!.setResponse("user_subscriptions", (recorded) => {
      const ownerFilter = recorded.calls.find(
        (call) => call.method === "eq" && call.args[0] === "user_id",
      );
      return ownerFilter?.args[1] === "user-owner"
        ? ok({ id: "sub-1", tenant_id: "tenant-1" })
        : ok(null);
    });

    const result = await loadOwnedSubscription("user-other", "sub-1");

    expect(result).toBeNull();
    expect(h.db!.lastChain("user_subscriptions")?.calls).toContainEqual({
      method: "eq",
      args: ["user_id", "user-other"],
    });
  });

  it("akceptuje własną subskrypcję w okresie dostępu po anulowaniu", async () => {
    h.db!.setResponse(
      "user_subscriptions",
      ok({
        id: "sub-grace",
        tenant_id: "tenant-1",
        status: "canceled",
        current_period_end: "2026-09-30T23:59:59.000Z",
      }),
    );

    const result = await loadOwnedSubscription("user-a", "sub-grace");

    expect(result).toEqual(expect.objectContaining({ id: "sub-grace", tenant_id: "tenant-1" }));
    expect(
      h
        .db!.lastChain("user_subscriptions")
        ?.calls.some((call) => call.method === "eq" && call.args[0] === "status"),
    ).toBe(false);
  });

  it("przekazuje błąd PostgREST zamiast udawać brak subskrypcji", async () => {
    h.db!.setResponse("user_subscriptions", { data: null, error: pgError("database offline") });

    await expect(loadOwnedSubscription("user-a", "sub-1")).rejects.toThrow("database offline");
    expect(h.db!.chainsFor("user_subscriptions")).toHaveLength(1);
  });
});
