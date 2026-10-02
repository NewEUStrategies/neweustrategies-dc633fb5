// Analityka silnika rekomendacji: `getRelatedInsights` (zakładka Analiza na
// /admin/related-posts).
//
// PO CO. Funkcja stała na zerze, a jest jedynym źródłem liczb, na których
// redakcja stroi wagi silnika. Trzy rzeczy, których pilnuje ten plik:
//   1. AWARIA NIE UDAJE PUSTEGO OKNA. Do 2026-10 handler łapał każdy błąd RPC
//      i oddawał zera, więc panel rysował „Brak danych w oknie" tam, gdzie
//      padło `related_posts_signals` - karta „odczyt padł" w panelu była
//      nieosiągalna. Przypadki „błąd RPC" niżej na starym kodzie przechodziły
//      jako pusty raport.
//   2. NAJEMCA NIE JEDZIE W PARAMETRZE. RPC bierze go z `assert_admin_tenant()`
//      (migracja 20260812090500); dopisanie argumentu z tenantem otworzyłoby
//      z powrotem drogę „podmień uuid, czytaj cudzą analitykę".
//   3. Bramka roli stoi PRZED odczytem sygnałów - odmowa nie kosztuje RPC.
//
// CZEGO TEN PLIK NIE DOWODZI: uwierzytelnienia. Atrapa `createServerFn` nie
// uruchamia middleware, więc przybijamy jego DEKLARACJĘ, a nie działanie.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { callServerFn, serverFnMiddlewareNames, asServerFn } from "@/test/serverFnHarness";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const h = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args: Record<string, unknown>) => Promise<RpcResult>>(),
}));

vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFnHarness")).serverFnStubModule(),
);
vi.mock("@/integrations/supabase/auth-middleware", () => ({
  requireSupabaseAuth: { name: "requireSupabaseAuth" },
}));

import { getRelatedInsights, type RelatedInsightsResult } from "@/lib/relatedInsights.functions";

const ADMIN = "admin-1";

function context() {
  return { supabase: { rpc: h.rpc }, userId: ADMIN };
}

function call(data?: unknown): Promise<RelatedInsightsResult> {
  return callServerFn<RelatedInsightsResult>(getRelatedInsights, { data, context: context() });
}

/** Odpowiedzi RPC: rola admina i sygnały - każda podmienialna w teście. */
function respond(options: { isAdmin?: RpcResult; signals?: RpcResult } = {}) {
  h.rpc.mockImplementation(async (fn) => {
    if (fn === "has_role") return options.isAdmin ?? { data: true, error: null };
    if (fn === "related_posts_signals") return options.signals ?? { data: REPORT, error: null };
    throw new Error(`test: nieoczekiwane RPC "${fn}"`);
  });
}

function signalCalls(): Record<string, unknown>[] {
  return h.rpc.mock.calls.filter(([fn]) => fn === "related_posts_signals").map(([, args]) => args);
}

const REPORT: RelatedInsightsResult = {
  summary: {
    total_posts: 40,
    total_views: 1200,
    total_clicks: 36,
    total_reads: 300,
    window_days: 7,
  },
  top_categories: [{ category_id: "c1", name: "Energia", posts_count: 12 }],
  top_tags: [{ tag_id: "t1", name: "LNG", posts_count: 5 }],
  tag_cooccurrence: [{ a: "t1", b: "t2", c: 3 }],
  popularity: [{ post_id: "p1", title: "Analiza", views: 500, uniques: 320 }],
  click_pairs: [
    { source_post_id: "p1", target_post_id: "p2", source_title: "A", target_title: "B", clicks: 9 },
  ],
  hub_targets: [{ post_id: "p2", title: "B", clicks: 9, sources: 4 }],
};

beforeEach(() => {
  h.rpc.mockReset();
  respond();
});

describe("obudowa funkcji", () => {
  it("deklaruje uwierzytelnienie i metodę POST", () => {
    expect(serverFnMiddlewareNames(getRelatedInsights)).toEqual(["requireSupabaseAuth"]);
    expect(asServerFn(getRelatedInsights).method).toBe("POST");
  });

  it("okno domyślnie ma 28 dni - tyle obiecuje podpowiedź suwaka popularności", async () => {
    const result = await call();

    expect(signalCalls()).toEqual([{ _since_days: 28 }]);
    expect(result.top_categories).toEqual(REPORT.top_categories);
  });

  it.each([0, 366, 1.5, "28"])("odrzuca okno %s przed jakimkolwiek RPC", async (days) => {
    await expect(call({ days })).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("bramka roli", () => {
  it("pyta `has_role` o admina DLA WOŁAJĄCEGO", async () => {
    await call({ days: 7 });

    expect(h.rpc).toHaveBeenCalledWith("has_role", { _user_id: ADMIN, _role: "admin" });
  });

  it("nie-admin dostaje odmowę, a sygnały nie są czytane", async () => {
    respond({ isAdmin: { data: false, error: null } });

    await expect(call({ days: 7 })).rejects.toThrow("Forbidden: admin role required");
    expect(signalCalls()).toEqual([]);
  });

  it("awaria sprawdzenia roli kończy się błędem, nie domyślnym wpuszczeniem", async () => {
    respond({ isAdmin: { data: null, error: { message: "has_role: timeout" } } });

    await expect(call({ days: 7 })).rejects.toThrow("has_role: timeout");
    expect(signalCalls()).toEqual([]);
  });
});

describe("odczyt sygnałów", () => {
  it("najemca NIE jedzie w parametrze - RPC dostaje wyłącznie okno", async () => {
    await call({ days: 7 });

    expect(signalCalls()).toEqual([{ _since_days: 7 }]);
    // Rola sprawdzona PRZED odczytem sygnałów.
    expect(h.rpc.mock.calls.map(([fn]) => fn)).toEqual(["has_role", "related_posts_signals"]);
  });

  it("pełny raport z RPC przechodzi bez zmian", async () => {
    const result = await call({ days: 7 });

    expect(result).toEqual(REPORT);
    expect(result.click_pairs[0].clicks).toBe(9);
  });

  it("brakujące sekcje jsonb stają się pustymi listami, a podsumowanie niesie żądane okno", async () => {
    respond({ signals: { data: { top_tags: REPORT.top_tags }, error: null } });

    const result = await call({ days: 14 });

    expect(result.top_tags).toEqual(REPORT.top_tags);
    expect(result.top_categories).toEqual([]);
    expect(result.tag_cooccurrence).toEqual([]);
    expect(result.popularity).toEqual([]);
    expect(result.click_pairs).toEqual([]);
    expect(result.hub_targets).toEqual([]);
    expect(result.summary).toEqual({
      total_posts: 0,
      total_views: 0,
      total_clicks: 0,
      total_reads: 0,
      window_days: 14,
    });
  });

  it("brak danych z RPC to pusty raport z ŻĄDANYM oknem, nie z domyślnym", async () => {
    respond({ signals: { data: null, error: null } });

    const result = await call({ days: 90 });

    expect(result.summary.window_days).toBe(90);
    expect(result.summary.total_clicks).toBe(0);
    expect(result.hub_targets).toEqual([]);
  });

  it("BŁĄD RPC leci w górę z przyczyną - nie udaje zmierzonego zera", async () => {
    respond({ signals: { data: null, error: { message: "assert_admin_tenant: no tenant" } } });

    await expect(call({ days: 7 })).rejects.toThrow("assert_admin_tenant: no tenant");
  });

  it("zerwane połączenie z bazą też leci w górę, a nie w pusty raport", async () => {
    h.rpc.mockImplementation(async (fn) => {
      if (fn === "has_role") return { data: true, error: null };
      throw new Error("fetch failed");
    });

    await expect(call({ days: 7 })).rejects.toThrow("fetch failed");
    expect(signalCalls()).toEqual([{ _since_days: 7 }]);
  });
});
