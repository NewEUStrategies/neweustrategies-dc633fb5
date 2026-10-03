// Odwzorowanie ceny operatora na plan - ZAKRES NAJEMCY i KOLEJNOŚĆ
// (audyt wyd. 11, 16.9: „odwzorowanie ceny operatora na plan nie jest zawężone
// do najemcy ani deterministyczne"; wyd. 12 - „plik bez zmian").
//
// CO BYŁO ZŁE. `resolvePlanForPrice(priceId)` szukało aktywnego planu po
// `tier_key` + `interval` w CAŁYM wdrożeniu, z `.limit(1)` i bez `ORDER BY`.
// Katalog cen jest jeden na konto operatora, a plany są per najemca - więc przy
// dwóch organizacjach z planem „Plus" uprawnienie, mail i dzwonek dostawały
// `plan_id` i `tenant_id` dowolnej z nich, i to potencjalnie innej przy każdym
// kolejnym zdarzeniu tej samej subskrypcji.
//
// CO TEN PLIK PRZYBIJA. Najemca pochodzi z wiersza wołającego (`tenantId`)
// albo z profilu właściciela (`userId`); bez niego planu NIE MA. Kolejność
// wyboru jest jawna. Atrapa stoi wyłącznie na kliencie roli serwisowej.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";

let db: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");

const PLAN_ROW = { id: "plan-a", tenant_id: "ten_a", price_cents: 4900, currency: "PLN" };

function planLookup() {
  return db.lastChain("access_plans");
}

beforeEach(() => {
  db = supabaseFromStub();
  db.setResponse("access_plans", ok(PLAN_ROW));
  db.setResponse("profiles", ok({ tenant_id: "ten_profil" }));
});

describe("resolvePlanForPrice - zakres najemcy", () => {
  it("najemca z wiersza wołającego zawęża zapytanie i nie czyta profilu", async () => {
    await expect(
      resolvePlanForPrice("plus_monthly", { tenantId: "ten_a", userId: "user-1" }),
    ).resolves.toEqual({
      planId: "plan-a",
      tenantId: "ten_a",
      priceCents: 4900,
      currency: "PLN",
      // Próg i cykl z wpisu katalogu - wołający nie pyta katalogu drugi raz.
      tierKey: "member",
      interval: "month",
    });

    expect(db.chainsFor("profiles")).toHaveLength(0);
    const eqs = planLookup()!
      .calls.filter((c) => c.method === "eq")
      .map((c) => c.args);
    expect(eqs).toEqual([
      ["tenant_id", "ten_a"],
      ["tier_key", "member"],
      ["interval", "month"],
      ["active", true],
    ]);
  });

  it("bez najemcy wołającego bierze najemcę z PROFILU właściciela", async () => {
    await resolvePlanForPrice("plus_monthly", { tenantId: null, userId: "user-1" });

    expect(db.lastChain("profiles")?.argsOf("eq")).toEqual(["id", "user-1"]);
    expect(planLookup()?.argsOf("eq")).toEqual(["tenant_id", "ten_profil"]);
  });

  it("wybór jest powtarzalny: `sort_order`, `created_at`, `id` i jeden wiersz", async () => {
    await resolvePlanForPrice("plus_monthly", { tenantId: "ten_a" });

    const orders = planLookup()!
      .calls.filter((c) => c.method === "order")
      .map((c) => c.args);
    expect(orders).toEqual([
      ["sort_order", { ascending: true }],
      ["created_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
    expect(planLookup()?.argsOf("limit")).toEqual([1]);
  });

  it("NIEZNANY najemca = brak planu (zamiast planu obcej organizacji)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(resolvePlanForPrice("plus_monthly", {})).resolves.toBeNull();
    db.setResponse("profiles", ok({ tenant_id: null }));
    await expect(
      resolvePlanForPrice("plus_monthly", { userId: "user-bez-najemcy" }),
    ).resolves.toBeNull();
    db.setResponse("profiles", ok(null));
    await expect(
      resolvePlanForPrice("plus_monthly", { userId: "user-usuniety" }),
    ).resolves.toBeNull();

    expect(db.chainsFor("access_plans")).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it("cena spoza katalogu nie pyta bazy wcale", async () => {
    await expect(resolvePlanForPrice("cena_spoza", { tenantId: "ten_a" })).resolves.toBeNull();
    expect(db.chains).toHaveLength(0);
  });

  it("brak planu w najemcy to `null`, a nie plan z innego najemcy", async () => {
    db.setResponse("access_plans", ok(null));

    await expect(resolvePlanForPrice("plus_monthly", { tenantId: "ten_b" })).resolves.toBeNull();
  });

  it("BŁĄD odczytu profilu jest zgłaszany - webhook ma ponowić, a nie zgadywać", async () => {
    db.setResponse("profiles", fail("statement timeout", "57014"));

    await expect(resolvePlanForPrice("plus_monthly", { userId: "user-1" })).rejects.toThrow(
      "plan scope lookup failed: statement timeout",
    );
    expect(db.chainsFor("access_plans")).toHaveLength(0);
  });

  it("BŁĄD odczytu planu jest zgłaszany", async () => {
    db.setResponse("access_plans", fail("permission denied", "42501"));

    await expect(resolvePlanForPrice("plus_monthly", { tenantId: "ten_a" })).rejects.toThrow(
      "plan lookup failed: permission denied",
    );
  });
});
