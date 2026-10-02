// `deterministicMessageId` - tożsamość wiadomości liczona z klucza idempotencji.
//
// Wartość jest ZAMROŻONA wektorem, a nie tylko „stabilna w obrębie testu":
// zmiana arytmetyki (inna funkcja skrótu, inne bity wersji) zmieniłaby
// `message_id` wiadomości, które już są w kolejce albo w dzienniku. Ponowienie
// po wdrożeniu dostałoby wtedy nowy identyfikator, a dren i trasa HTTP
// uznałyby je za NOWĄ wiadomość - dokładnie ten podwójny mail, przed którym ta
// funkcja chroni.
import { describe, expect, it } from "vitest";
import { deterministicMessageId } from "@/lib/email/messageId";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministicMessageId", () => {
  it("ten sam klucz daje ten sam identyfikator (wektor zamrożony)", async () => {
    await expect(deterministicMessageId("event-ticket:r-1:paid:0")).resolves.toBe(
      "1ce390f4-1b86-4c4b-b709-30a470a542f4",
    );
    await expect(deterministicMessageId("event-ticket:r-1:paid:0")).resolves.toBe(
      await deterministicMessageId("event-ticket:r-1:paid:0"),
    );
  });

  it("różne klucze dają różne identyfikatory", async () => {
    const a = await deterministicMessageId("order-1");
    const b = await deterministicMessageId("order-2");

    expect(a).not.toBe(b);
  });

  it("wynik ma kształt UUID v4 (wersja i wariant ustawione)", async () => {
    for (const key of ["", "a", "x".repeat(255), "zażółć gęślą jaźń"]) {
      expect(await deterministicMessageId(key)).toMatch(UUID_V4);
    }
  });
});
