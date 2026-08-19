// Server fns ŚCIEŻKI REZYGNACJI - 0% linii i 0 z 5 funkcji do 19.08.2026.
//
// Ten plik rozdaje PIENIĄDZE: `acceptRetentionOffer` zakłada w bazie kupon
// rabatowy na koncie odchodzącego klienta. Cztery reguły decydują o tym, czy
// nie da się z niego zrobić pompki rabatowej, i żadna nie była dotknięta
// testem:
//   1. własność subskrypcji - kupon leci na subskrypcję WOŁAJĄCEGO, nie na
//      dowolne id podane z klienta,
//   2. wyłącznik redakcyjny - `enabled: false` znaczy „nie proponujemy",
//   3. okno 180 dni - jedna zaakceptowana oferta na użytkownika,
//   4. kolizja kodu - unikalność per tenant pilnuje constraint, kod ma się
//      ponowić, a nie wywalić przepływ.
//
// Middleware NIE jest tu wykonywane (patrz src/test/serverFn.ts): zestawu
// `requireSupabaseAuth` pilnuje bramka `check:authz-snapshot`. Ten plik
// odpowiada na pytanie „czy logika jest poprawna", nie „czy ktoś obcy wejdzie".
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  ok,
  pgError,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase/chain";
import { callServerFn } from "@/test/serverFn";
import { BASE_NOW } from "@/test/billing/fixtures";

// Identyfikatory MUSZĄ być UUID - walidator zod odrzuca cokolwiek innego,
// więc `BILLING_IDS.subscription` ("sub-1") nie przeszedłby przez wejście.
const SUB_ID = "11111111-1111-4111-8111-111111111111";
const REASON_ID = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const ME = "44444444-4444-4444-8444-444444444444";

let chain: SupabaseFromStub;

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => chain.from(table) },
}));

const { submitRetentionFeedback, acceptRetentionOffer } = await import("@/lib/retention/functions");

/** Subskrypcja należąca do wołającego - domyślny, szczęśliwy stan bazy. */
function ownedSubscription() {
  return ok({ id: SUB_ID, tenant_id: TENANT });
}

/**
 * `retention_feedback` obsługuje w tym module DWIE operacje: odczyt historii
 * (okno 180 dni) i zapis ankiety. Jeden responder rozróżnia je po tym, czy
 * łańcuch zawiera `insert`.
 */
function feedbackResponder(prior: unknown[] = []) {
  return (c: RecordedChain) => (c.has("insert") ? ok(null) : ok(prior));
}

function call<TResult = unknown>(fn: unknown, data: unknown): Promise<TResult> {
  return callServerFn<TResult>(fn, data, { supabase: null, userId: ME });
}

const FEEDBACK = {
  subscriptionId: SUB_ID,
  reasonId: REASON_ID,
  reasonLabel: "Za drogo",
  offerShown: true,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE_NOW);
  chain = supabaseFromStub();
  chain.setResponse("user_subscriptions", ownedSubscription());
  chain.setResponse("retention_feedback", feedbackResponder());
  chain.setResponse(
    "retention_settings",
    ok({ enabled: true, discount_pct: 30, discount_periods: 3, coupon_valid_days: 14 }),
  );
  chain.setResponse("b2b_coupons", ok(null));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitRetentionFeedback - ankieta odejścia", () => {
  it("zapisuje ankietę na tenancie SUBSKRYPCJI, nie na podanym z klienta", async () => {
    await call(submitRetentionFeedback, FEEDBACK);

    const insert = chain
      .chainsFor("retention_feedback")
      .find((c) => c.has("insert"))!
      .argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.tenant_id).toBe(TENANT);
    expect(insert.user_id).toBe(ME);
    expect(insert.offer_accepted).toBe(false);
  });

  it("CUDZA subskrypcja jest odrzucana - odczyt zawęża po user_id", async () => {
    chain.setResponse("user_subscriptions", ok(null));

    await expect(call(submitRetentionFeedback, FEEDBACK)).rejects.toThrow("subscription_not_found");
    // Dowód zawężenia: drugie `eq` wiąże wiersz z wołającym.
    const reads = chain.lastChain("user_subscriptions")!.calls.filter((c) => c.method === "eq");
    expect(reads.map((c) => c.args)).toContainEqual(["user_id", ME]);
  });

  it("odrzucona ankieta NIE zostawia wiersza w bazie", async () => {
    chain.setResponse("user_subscriptions", ok(null));

    await expect(call(submitRetentionFeedback, FEEDBACK)).rejects.toThrow("subscription_not_found");
    expect(chain.chainsFor("retention_feedback").some((c) => c.has("insert"))).toBe(false);
  });

  it("PUSTY komentarz zapisuje się jako `null`, nie jako pusty napis", async () => {
    // Pusty napis w kolumnie tekstowej udaje odpowiedź, której klient nie dał -
    // statystyki powodów liczyłyby go jako wypełniony.
    await call(submitRetentionFeedback, { ...FEEDBACK, comment: "   " });

    const insert = chain
      .chainsFor("retention_feedback")
      .find((c) => c.has("insert"))!
      .argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.comment).toBeNull();
    expect(insert.reason_label).toBe("Za drogo");
  });

  it("komentarz jest przycinany z białych znaków", async () => {
    await call(submitRetentionFeedback, { ...FEEDBACK, comment: "  za drogo jak na mnie  " });

    const insert = chain
      .chainsFor("retention_feedback")
      .find((c) => c.has("insert"))!
      .argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.comment).toBe("za drogo jak na mnie");
    expect(insert.reason_id).toBe(REASON_ID);
  });

  it("BŁĄD odczytu subskrypcji jest zgłaszany, nie mylony z brakiem własności", async () => {
    // „Nie znaleziono" przy awarii bazy skasowałoby ankietę odchodzącego
    // klienta i wyglądało jak próba nadużycia.
    chain.setResponse("user_subscriptions", { data: null, error: pgError("timeout") });

    await expect(call(submitRetentionFeedback, FEEDBACK)).rejects.toThrow("timeout");
    expect(chain.chainsFor("retention_feedback").some((c) => c.has("insert"))).toBe(false);
  });

  it("BŁĄD zapisu ankiety jest zgłaszany", async () => {
    chain.setResponse("retention_feedback", (c: RecordedChain) =>
      c.has("insert") ? { data: null, error: pgError("row level security") } : ok([]),
    );

    await expect(call(submitRetentionFeedback, FEEDBACK)).rejects.toThrow("row level security");
  });

  it("walidator odrzuca id, które nie jest UUID - bez dotykania bazy", async () => {
    await expect(
      call(submitRetentionFeedback, { ...FEEDBACK, subscriptionId: "sub-1" }),
    ).rejects.toThrow();
    expect(chain.chainsFor("user_subscriptions")).toHaveLength(0);
  });
});

describe("acceptRetentionOffer - kontrofertka z kuponem", () => {
  it("zakłada kupon i zwraca jego parametry", async () => {
    const res = await call<{
      ok: boolean;
      code: string;
      discountPct: number;
      discountPeriods: number;
      validUntil: string;
    }>(acceptRetentionOffer, FEEDBACK);

    expect(res.ok).toBe(true);
    expect(res.code).toMatch(/^SAVE30-[A-Z2-9]{6}$/);
    expect(res.discountPct).toBe(30);
    expect(res.discountPeriods).toBe(3);
    // 14 dni ważności liczone od „teraz" (zegar zamrożony na BASE_NOW).
    expect(res.validUntil).toBe(new Date(BASE_NOW + 14 * 86_400_000).toISOString());
  });

  it("kupon jest spięty z tenantem i użytkownikiem subskrypcji", async () => {
    await call(acceptRetentionOffer, FEEDBACK);

    const coupon = chain.lastChain("b2b_coupons")!.argsOf("insert")![0] as Record<string, unknown>;
    expect(coupon.tenant_id).toBe(TENANT);
    expect(coupon.discount_percent).toBe(30);
    expect(coupon.max_redemptions).toBe(3);
    expect((coupon.metadata as Record<string, unknown>).user_id).toBe(ME);
  });

  it("ankieta akceptacji niesie KOD kuponu i znacznik przyjęcia", async () => {
    const res = await call<{ code: string }>(acceptRetentionOffer, FEEDBACK);

    const insert = chain
      .chainsFor("retention_feedback")
      .find((c) => c.has("insert"))!
      .argsOf("insert")![0] as Record<string, unknown>;
    expect(insert.offer_accepted).toBe(true);
    expect(insert.coupon_code).toBe(res.code);
  });

  it("WYŁĄCZONA kontroferta nie zakłada kuponu", async () => {
    chain.setResponse(
      "retention_settings",
      ok({
        enabled: false,
        discount_pct: 30,
        discount_periods: 3,
        coupon_valid_days: 14,
      }),
    );

    const res = await call<{ ok: boolean; reason: string }>(acceptRetentionOffer, FEEDBACK);

    expect(res).toEqual({ ok: false, reason: "offer_disabled" });
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("BRAK wiersza ustawień jest traktowany jak oferta wyłączona", async () => {
    // Instalacja, która nigdy nie zapisała ustawień, nie może rozdawać 30%.
    chain.setResponse("retention_settings", ok(null));

    const res = await call<{ ok: boolean; reason: string }>(acceptRetentionOffer, FEEDBACK);

    expect(res).toEqual({ ok: false, reason: "offer_disabled" });
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("DRUGA oferta w oknie 180 dni jest odrzucana", async () => {
    chain.setResponse("retention_feedback", feedbackResponder([{ id: "prior-1" }]));

    const res = await call<{ ok: boolean; reason: string }>(acceptRetentionOffer, FEEDBACK);

    expect(res).toEqual({ ok: false, reason: "already_redeemed" });
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("okno wykorzystania liczy się od 180 dni wstecz i patrzy na PRZYJĘTE oferty", async () => {
    await call(acceptRetentionOffer, FEEDBACK);

    const read = chain.chainsFor("retention_feedback").find((c) => !c.has("insert"))!;
    expect(read.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "offer_accepted",
      true,
    ]);
    expect(read.argsOf("gte")).toEqual([
      "created_at",
      new Date(BASE_NOW - 180 * 86_400_000).toISOString(),
    ]);
  });

  it("KOLIZJA kodu (23505) jest ponawiana, nie zgłaszana", async () => {
    // Unikalność kodu per tenant pilnuje constraint; trafienie w zajęty kod to
    // zdarzenie normalne, a nie awaria przepływu anulowania.
    let attempts = 0;
    chain.setResponse("b2b_coupons", () => {
      attempts += 1;
      return attempts === 1 ? { data: null, error: pgError("duplicate key", "23505") } : ok(null);
    });

    const res = await call<{ ok: boolean; code: string }>(acceptRetentionOffer, FEEDBACK);

    expect(res.ok).toBe(true);
    expect(attempts).toBe(2);
    // Ponowienie MUSI wylosować nowy kod. Gdyby pętla wstawiała ten sam,
    // constraint odrzucałby go przy każdej próbie i akceptacja oferty byłaby
    // trwale zepsuta - a sam licznik prób tego nie wykryje.
    const codes = chain
      .chainsFor("b2b_coupons")
      .map((c) => (c.argsOf("insert")![0] as Record<string, unknown>).code as string);
    expect(codes).toHaveLength(2);
    expect(codes[0]).not.toBe(codes[1]);
    expect(res.code).toBe(codes[1]);
  });

  it("PIĘĆ kolizji z rzędu kończy się jawnym błędem, nie cichym brakiem kuponu", async () => {
    chain.setResponse("b2b_coupons", () => ({
      data: null,
      error: pgError("duplicate key", "23505"),
    }));

    await expect(call(acceptRetentionOffer, FEEDBACK)).rejects.toThrow("coupon_code_collision");
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(5);
  });

  it("błąd zapisu kuponu INNY niż kolizja jest zgłaszany od razu", async () => {
    chain.setResponse("b2b_coupons", () => ({
      data: null,
      error: pgError("permission denied", "42501"),
    }));

    await expect(call(acceptRetentionOffer, FEEDBACK)).rejects.toThrow("permission denied");
    // Bez ponawiania - jedna próba, bo to nie jest kolizja.
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(1);
  });

  it("CUDZA subskrypcja nie dostaje kuponu", async () => {
    chain.setResponse("user_subscriptions", ok(null));

    await expect(call(acceptRetentionOffer, FEEDBACK)).rejects.toThrow("subscription_not_found");
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("BŁĄD odczytu ustawień jest zgłaszany", async () => {
    chain.setResponse("retention_settings", { data: null, error: pgError("timeout") });

    await expect(call(acceptRetentionOffer, FEEDBACK)).rejects.toThrow("timeout");
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("BŁĄD odczytu historii ofert jest zgłaszany", async () => {
    chain.setResponse("retention_feedback", (c: RecordedChain) =>
      c.has("insert") ? ok(null) : { data: null, error: pgError("timeout") },
    );

    await expect(call(acceptRetentionOffer, FEEDBACK)).rejects.toThrow("timeout");
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(0);
  });

  it("BŁĄD zapisu ankiety po założeniu kuponu jest zgłaszany", async () => {
    chain.setResponse("retention_feedback", (c: RecordedChain) =>
      c.has("insert") ? { data: null, error: pgError("row level security") } : ok([]),
    );

    await expect(call(acceptRetentionOffer, FEEDBACK)).rejects.toThrow("row level security");
    expect(chain.chainsFor("b2b_coupons")).toHaveLength(1);
  });
});
