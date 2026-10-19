// Mail „od najbliższego odnowienia płacisz mniej" (cennik v6.2,
// `notifyPriceLoweredEmail`) - co dokładnie widzi członek.
//
// CZEGO PILNUJE:
//   1. KWOTY PRZED I PO - obie w wierszach szczegółów i w treści, z datą
//      pierwszej faktury po nowej cenie; liczba miejsc tylko dla Zespołu.
//   2. JĘZYK ODBIORCY - nazwa planu v6.2 i etykiety w jego języku.
//   3. NAJEMCA - link w mailu na host najemcy subskrypcji, `tenantId` przekazany
//      do wysyłki (lista wykluczeń i redakcja są tenant-scoped).
//   4. IDEMPOTENCJA - jeden mail na (subskrypcja, cena docelowa).
//   5. FAIL-SOFT - nic nie rzuca; wynik `queued` / `skipped` / `failed` trafia
//      do dziennika przeniesień.
//
// GRANICE ATRAPOWANE: klient service_role, wysyłka poczty i adres najemcy.
// Formatowanie kwot i dat zostaje prawdziwe. Adresy w domenie example.com.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { txCopy } from "@/lib/email-templates/tx-copy";
import type { TxSendInput, TxSendResult } from "@/lib/email/transactional.server";
import { moneyPattern, ok, supabaseFromStub } from "@/test/billing/fixtures";

const db = vi.hoisted(() => {
  let active: { from: (table: string) => unknown } | null = null;
  return {
    use(next: { from: (table: string) => unknown }): void {
      active = next;
    },
    from(table: string): unknown {
      if (!active) throw new Error(`test: brak atrapy Supabase dla "${table}"`);
      return active.from(table);
    },
  };
});

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (table: string) => db.from(table) },
}));

const mail = vi.hoisted(() => ({
  sent: [] as TxSendInput[],
  result: { ok: true } as TxSendResult,
}));

vi.mock("@/lib/email/transactional.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transactional.server")>();
  return {
    ...actual,
    sendTxEmail: vi.fn(async (input: TxSendInput) => {
      mail.sent.push(input);
      return mail.result;
    }),
  };
});

vi.mock("@/lib/events/tenantPublicOrigin.server", () => ({
  tenantPublicUrl: vi.fn(
    async (tenantId: string, path: string, lang: string) =>
      `https://${tenantId}.example.com/${lang}${path}`,
  ),
}));

import { notifyPriceLoweredEmail } from "@/lib/billing/notifications.server";

function givenDb(lang: "pl" | "en" = "pl", email = "czlonek@example.com") {
  const stub = supabaseFromStub();
  stub.setResponse(
    "profiles",
    ok({ email, first_name: "Ola", display_name: "Ola", prefs: { language: lang } }),
  );
  stub.setResponse("newsletter_subscribers", ok(null));
  stub.setResponse(
    "access_plans",
    ok({
      name_pl: "Członek - miesięcznie",
      name_en: "Member - monthly",
      price_cents: 3900,
      currency: "PLN",
      interval: "month",
    }),
  );
  db.use(stub);
  return stub;
}

const BASE = {
  userId: "user-1",
  tenantId: "tenant-a",
  planId: "plan-member-month",
  previousAmountCents: 5900,
  newAmountCents: 3900,
  currency: "PLN",
  interval: "month",
  quantity: 1,
  effectiveAt: "2026-11-05T10:00:00.000Z",
  idempotencySeed: "sub_1:price_plusNew",
};

beforeEach(() => {
  mail.sent.length = 0;
  mail.result = { ok: true };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("notifyPriceLoweredEmail", () => {
  it("PL: kwoty przed i po, data, link na host najemcy, klucz idempotencji", async () => {
    givenDb("pl");
    const result = await notifyPriceLoweredEmail(BASE);

    expect(result).toBe("queued");
    expect(mail.sent).toHaveLength(1);
    const sent = mail.sent[0];
    const L = txCopy("subscription_price_lowered", "pl").labels;
    expect(sent).toMatchObject({
      type: "subscription_price_lowered",
      to: "czlonek@example.com",
      lang: "pl",
      subjectName: "Członek - miesięcznie",
      tenantId: "tenant-a",
      ctaUrl: "https://tenant-a.example.com/pl/profile/plan",
      idempotencyKey: "subscription_price_lowered:sub_1:price_plusNew",
    });
    const labels = (sent.details ?? []).map((d) => d.label);
    expect(labels).toEqual([L.plan, L.previousPrice, L.newPrice, L.effectiveFrom]);
    const value = (label: string) => sent.details?.find((d) => d.label === label)?.value ?? "";
    expect(value(L.previousPrice)).toMatch(moneyPattern(5900));
    expect(value(L.newPrice)).toMatch(moneyPattern(3900));
    expect(sent.bodyVars?.previousAmount).toMatch(moneyPattern(5900));
    expect(sent.bodyVars?.amount).toMatch(moneyPattern(3900));
    expect(sent.bodyVars?.interval).toBe("miesięcznie");
    expect(sent.bodyVars?.renewsAt).toBeTruthy();
  });

  it("EN: nazwa planu i etykiety po angielsku; Zespół pokazuje liczbę miejsc", async () => {
    givenDb("en");
    await notifyPriceLoweredEmail({
      ...BASE,
      quantity: 8,
      previousAmountCents: 79200,
      newAmountCents: 71200,
    });

    const sent = mail.sent[0];
    const L = txCopy("subscription_price_lowered", "en").labels;
    expect(sent.lang).toBe("en");
    expect(sent.subjectName).toBe("Member - monthly");
    expect(sent.details?.find((d) => d.label === L.seats)?.value).toBe("8");
    expect(sent.bodyVars?.interval).toBe("monthly");
  });

  it("bez daty i bez planu: wiersze tylko z kwotami", async () => {
    givenDb("pl");
    await notifyPriceLoweredEmail({ ...BASE, planId: null, effectiveAt: null });
    const L = txCopy("subscription_price_lowered", "pl").labels;
    expect((mail.sent[0].details ?? []).map((d) => d.label)).toEqual([L.previousPrice, L.newPrice]);
  });

  it("brak adresu odbiorcy -> skipped, bez wysyłki", async () => {
    givenDb("pl", "");
    expect(await notifyPriceLoweredEmail(BASE)).toBe("skipped");
    expect(mail.sent).toHaveLength(0);
  });

  it("adres na liście wykluczeń -> skipped; awaria kolejki -> failed", async () => {
    givenDb("pl");
    mail.result = { ok: false, skipped: "suppressed", reason: "suppressed:complaint" };
    expect(await notifyPriceLoweredEmail(BASE)).toBe("skipped");
    mail.result = { ok: false, error: "queue down" };
    expect(await notifyPriceLoweredEmail(BASE)).toBe("failed");
  });

  it("wyjątek w środku (odczyt profilu) -> failed, nigdy rzut", async () => {
    db.use({
      from: () => {
        throw new Error("db down");
      },
    });
    expect(await notifyPriceLoweredEmail(BASE)).toBe("failed");
  });
});
