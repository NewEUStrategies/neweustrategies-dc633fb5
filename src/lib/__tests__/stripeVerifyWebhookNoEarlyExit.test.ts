// @vitest-environment node
//
// PODPIS WEBHOOKA OPERATORA - BEZ WCZESNEGO WYJŚCIA Z PĘTLI KANDYDATÓW
// (PAY-14a, luka testowa przeglądu „criterionTestGaps").
//
// JAKIE RYZYKO PILNUJE TEN PLIK. `verifyWebhook` sprawdza KAŻDY wpis `v1`
// nagłówka `stripe-signature` do końca, żeby czas odpowiedzi zależał od LICZBY
// wpisów, a nie od tego, który pasuje. Test strukturalny w
// `stripeServerGateway.test.ts` liczy wywołania `crypto.subtle.verify`, ale
// z poprawnym podpisem na KOŃCU nagłówka - przywrócone `break`/`return` po
// pierwszym trafieniu przeszłoby przez niego niezauważone. Tu poprawny podpis
// stoi NA POCZĄTKU, a za nim są kolejne poprawnie zbudowane kandydaty: pętla
// bez wczesnego wyjścia woła `verify` dla każdego z nich.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FIXED_NOW_MS, SEKUNDA, freezeClock } from "@/test/time";

freezeClock();

const SECRET = "whsec_sandbox_no_early_exit";
const NOW_S = Math.floor(FIXED_NOW_MS / SEKUNDA);
const EVENT = { id: "evt_order_1", type: "invoice.paid", created: NOW_S, data: { object: {} } };
const BODY = JSON.stringify(EVENT);

const v1 = (secret: string) =>
  createHmac("sha256", secret).update(`${NOW_S}.${BODY}`).digest("hex");

function delivery(signature: string): Request {
  return new Request("https://example.com/api/public/payments/webhook?env=sandbox", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: BODY,
  });
}

beforeEach(() => {
  vi.stubEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET", SECRET);
});

describe("verifyWebhook - każdy kandydat v1 sprawdzony do końca", () => {
  it.each([
    ["pierwszy", 0],
    ["środkowy", 1],
    ["ostatni", 2],
  ])(
    "poprawny podpis jako %s z trzech: `verify` woła się trzy razy, wynik ten sam",
    async (_label, validAt) => {
      const { verifyWebhook } = await import("@/lib/stripe.server");
      const candidates = [v1("whsec_rotowany_1"), v1("whsec_rotowany_2")];
      candidates.splice(validAt, 0, v1(SECRET));
      const verify = vi.spyOn(crypto.subtle, "verify");

      try {
        await expect(
          verifyWebhook(
            delivery([`t=${NOW_S}`, ...candidates.map((c) => `v1=${c}`)].join(",")),
            "sandbox",
          ),
        ).resolves.toEqual(EVENT);

        // Liczba sprawdzeń nie zależy od pozycji trafienia.
        expect(verify).toHaveBeenCalledTimes(3);
      } finally {
        verify.mockRestore();
      }
    },
  );
});
