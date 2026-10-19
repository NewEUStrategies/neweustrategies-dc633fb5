// P12: nadawcy maili, których dotąd nie było - „subskrypcja odnowiona"
// i „dziękujemy za darowiznę". Szablony istniały (rejestr, podgląd w panelu),
// ale nikt ich nie wysyłał.
//
// Granice atrapowane: klient service_role, wybór planu po cenie i wysyłka
// poczty. Formatowanie kwot zostaje prawdziwe.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/billing/fixtures";

let stub: SupabaseFromStub;

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => stub.from(table) },
}));

const h = vi.hoisted(() => ({
  sent: [] as TxSendInput[],
  resolvePlan: vi.fn(),
}));

vi.mock("@/lib/email/transactional.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transactional.server")>();
  return {
    ...actual,
    sendTxEmail: async (input: TxSendInput): Promise<TxSendResult> => {
      h.sent.push(input);
      return { ok: true };
    },
  };
});

vi.mock("@/lib/billing/purchaseEffects.server", () => ({
  resolvePlanForPrice: (...args: unknown[]) => h.resolvePlan(...args),
}));

import { notifyDonationEmail, notifySubscriptionRenewed } from "@/lib/billing/notifications.server";

beforeEach(() => {
  h.sent.length = 0;
  stub = supabaseFromStub();
  stub.setResponse(
    "subscriptions",
    ok({
      user_id: "user-me",
      tenant_id: "tenant-1",
      price_id: "plus_monthly",
      current_period_end: "2026-11-18T10:00:00.000Z",
    }),
  );
  stub.setResponse(
    "profiles",
    ok({
      email: "odbiorca@example.com",
      first_name: "Imie",
      display_name: null,
      prefs: { language: "pl" },
    }),
  );
  stub.setResponse("newsletter_subscribers", ok(null));
  stub.setResponse(
    "access_plans",
    ok({
      name_pl: "Członek",
      name_en: "Member",
      price_cents: 3900,
      currency: "PLN",
      interval: "month",
    }),
  );
  h.resolvePlan.mockReset().mockResolvedValue({ planId: "plan-member", tenantId: "tenant-1" });
});

describe("notifySubscriptionRenewed", () => {
  it("wysyła `subscription_renewed` z kwotą FAKTURY (nie ceną katalogu) i ziarnem faktury", async () => {
    await expect(
      notifySubscriptionRenewed({
        providerSubscriptionId: "sub_1",
        environment: "live",
        invoiceId: "in_1",
        amountCents: 5900,
        currency: "PLN",
      }),
    ).resolves.toBe(true);

    expect(h.sent).toHaveLength(1);
    const mail = h.sent[0]!;
    expect(mail.type).toBe("subscription_renewed");
    expect(mail.to).toBe("odbiorca@example.com");
    expect(mail.idempotencyKey).toBe("subscription_renewed:in_1");
    expect(mail.bodyVars?.amount).toMatch(/59/);
    expect(mail.ctaPath).toBe("/profile/plan");
    // Plan z najemcy WIERSZA subskrypcji, nie z ładunku.
    expect(h.resolvePlan).toHaveBeenCalledWith("plus_monthly", { tenantId: "tenant-1" });
    const lookup = stub.lastChain("subscriptions")!;
    expect(lookup.calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([
      ["provider_subscription_id", "sub_1"],
      ["environment", "live"],
    ]);
  });

  it("brak lustra subskrypcji: nic nie wysyła i nie rzuca", async () => {
    stub.setResponse("subscriptions", ok(null));
    await expect(
      notifySubscriptionRenewed({
        providerSubscriptionId: "sub_x",
        environment: "live",
        invoiceId: "in_2",
        amountCents: 100,
        currency: "PLN",
      }),
    ).resolves.toBe(false);
    expect(h.sent).toHaveLength(0);
  });
});

describe("notifyDonationEmail", () => {
  it("dziękuje z kwotą i wiadomością darczyńcy; jeden mail na wpłatę", async () => {
    await expect(
      notifyDonationEmail({
        email: "darczynca@example.com",
        lang: "en",
        amountCents: 10_000,
        currency: "EUR",
        donorMessage: "  Keep going  ",
        idempotencySeed: "don-1",
      }),
    ).resolves.toBe(true);
    const mail = h.sent[0]!;
    expect(mail.type).toBe("donation_received");
    expect(mail.lang).toBe("en");
    expect(mail.bodyVars).toMatchObject({ donorMessage: "Keep going" });
    expect(mail.bodyVars?.amount).toMatch(/100/);
    expect(mail.idempotencyKey).toBe("donation_received:don-1");
  });
});
