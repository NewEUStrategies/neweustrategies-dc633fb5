// Ankieta rezygnacji z portalu operatora -> `retention_feedback` (S2, P01).
//
// Klient anulujący w portalu Stripe omijał nasz dialog i jego powód ginął.
// Teraz `cancellation_details` trafia do tej samej tabeli co ankieta dialogu
// - raz na rezygnację (ponowienie zdarzenia ani wpis z dialogu nie dublują),
// a awaria zapisu nie przerywa obsługi zdarzenia.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ok,
  pgError,
  supabaseFromStub,
  type RecordedChain,
  type SupabaseFromStub,
} from "@/test/supabase/chain";

let chain: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => chain.from(table) },
}));

const { recordProviderCancellationFeedback } = await import("@/lib/billing/webhookDispatch.server");

const SUB = { id: "row-1", tenant_id: "tenant-1", user_id: "user-1" };

function data(feedback: { feedback: string | null; comment: string | null } | null | undefined) {
  return {
    id: "sub_stripe_1",
    customerId: "cus_1",
    status: "active",
    items: [],
    cancellationFeedback: feedback,
  };
}

const insertOf = () =>
  chain
    .chainsFor("retention_feedback")
    .find((c) => c.has("insert"))
    ?.argsOf("insert")?.[0] as Record<string, unknown> | undefined;

beforeEach(() => {
  chain = supabaseFromStub();
  chain.setResponse("subscriptions", ok(SUB));
  chain.setResponse("retention_feedback", (c: RecordedChain) =>
    c.has("insert") ? ok(null) : ok([]),
  );
});

describe("recordProviderCancellationFeedback", () => {
  it("zapisuje powód operatora i pełny komentarz jako `canceled` subskrypcji z lustra", async () => {
    const long = "x".repeat(3000);
    await recordProviderCancellationFeedback(
      data({ feedback: "too_expensive", comment: long }),
      "live",
    );
    expect(insertOf()).toMatchObject({
      tenant_id: "tenant-1",
      user_id: "user-1",
      subscription_id: "row-1",
      outcome: "canceled",
      reason_label: "stripe:too_expensive",
      reason_id: null,
      comment: long,
      offer_shown: false,
    });
    const lookup = chain.lastChain("subscriptions")!;
    expect(lookup.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["provider_subscription_id", "sub_stripe_1"],
      ["environment", "live"],
    ]);
  });

  it("sam komentarz bez kodu: `stripe:other`", async () => {
    await recordProviderCancellationFeedback(
      data({ feedback: null, comment: "bez sensu" }),
      "live",
    );
    expect(insertOf()).toMatchObject({ reason_label: "stripe:other", comment: "bez sensu" });
  });

  it("bez ankiety operatora nic nie zapisuje (nawet nie czyta)", async () => {
    await recordProviderCancellationFeedback(data(undefined), "live");
    expect(chain.chains).toHaveLength(0);
  });

  it("istniejący wpis `canceled` z 30 dni (dialog albo ponowienie) wyklucza drugi", async () => {
    chain.setResponse("retention_feedback", (c: RecordedChain) =>
      c.has("insert") ? ok(null) : ok([{ id: "earlier" }]),
    );
    await recordProviderCancellationFeedback(data({ feedback: "unused", comment: null }), "live");
    expect(insertOf()).toBeUndefined();
  });

  it("awaria zapisu NIE rzuca - obsługa zdarzenia idzie dalej", async () => {
    chain.setResponse("retention_feedback", (c: RecordedChain) =>
      c.has("insert") ? { data: null, error: pgError("check violation") } : ok([]),
    );
    await expect(
      recordProviderCancellationFeedback(data({ feedback: "unused", comment: null }), "live"),
    ).resolves.toBeUndefined();
  });
});
