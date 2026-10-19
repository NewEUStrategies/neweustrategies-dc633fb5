// Treść maila „niższa cena członkostwa od odnowienia" (cennik v6.2).
//
// Sedno wiadomości to porównanie: dotychczas X, od odnowienia Y - i to, że
// członek nie musi nic robić. Zdanie bez poprzedniej kwoty albo z kwotą
// w złym miejscu byłoby komunikatem o zmianie ceny, którego nie da się
// zweryfikować. Słowa „subskrypcja" celowo nie ma (język katalogu v6.2).
import { describe, expect, it } from "vitest";

import { txBody } from "@/lib/email-templates/tx-body";
import { txCopy } from "@/lib/email-templates/tx-copy";

const VARS = {
  planName: "Członek - miesięcznie",
  amount: "39,00 zł",
  previousAmount: "59,00 zł",
  interval: "miesięcznie",
  renewsAt: "5 listopada 2026",
};

describe("subscription_price_lowered - treść", () => {
  it("PL: plan, nowa kwota z cyklem, poprzednia kwota i data odnowienia", () => {
    const body = txBody("subscription_price_lowered", "pl", "female", VARS);
    expect(body.intro).toBe(
      "Wprowadziliśmy nowy cennik członkostwa. Od najbliższego odnowienia (5 listopada 2026) za plan Członek - miesięcznie zapłacisz 39,00 zł miesięcznie zamiast 59,00 zł. Zmiana działa automatycznie, a zakres Twojego członkostwa pozostaje bez zmian.",
    );
    expect(body.note).toContain("nowa kwota pojawi się dopiero na kolejnej fakturze");
  });

  it("EN: ten sam układ po angielsku", () => {
    const body = txBody("subscription_price_lowered", "en", "unknown", {
      ...VARS,
      planName: "Member - monthly",
      amount: "PLN 39.00",
      previousAmount: "PLN 59.00",
      interval: "monthly",
      renewsAt: "5 November 2026",
    });
    expect(body.intro).toBe(
      "We have introduced a new membership price list. From your next renewal (5 November 2026) you will pay PLN 39.00 monthly for your Member - monthly plan instead of PLN 59.00. Nothing to do on your side; your membership scope stays the same.",
    );
  });

  it("bez kwot i daty zdanie zostaje poprawne, bez pustych nawiasów", () => {
    const pl = txBody("subscription_price_lowered", "pl", "unknown", {});
    expect(pl.intro).toContain("Od najbliższego odnowienia za członkostwo zapłacisz mniej.");
    expect(pl.intro).not.toContain("()");
    const en = txBody("subscription_price_lowered", "en", "unknown", {});
    expect(en.intro).toContain("From your next renewal you will pay less for your membership.");
  });

  it("szkielet PL/EN: temat z marką, bez słowa „subskrypcja”", () => {
    const pl = txCopy("subscription_price_lowered", "pl");
    const en = txCopy("subscription_price_lowered", "en");
    expect(pl.subject({ subject: "Członek" })).toBe(
      "💶 Niższa cena członkostwa - Członek | New European Strategies",
    );
    expect(en.subject({ subject: null })).toBe(
      "💶 A lower membership price | New European Strategies",
    );
    for (const copy of [pl, en]) {
      const text = [copy.preview, copy.heading, copy.intro, copy.note].join(" ").toLowerCase();
      expect(text).not.toMatch(/subskrypc|subscription/);
    }
  });
});
