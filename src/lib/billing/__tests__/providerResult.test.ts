// Reguła kontraktu odpowiedzi operatora płatności.
//
// Cały sens tego modułu to jedno zdanie: dla `useMutation` odpowiedź
// `{ error: "..." }` jest ROZWIĄZANYM promisem, czyli sukcesem. Bez jawnego
// odpakowania karta rozliczeniowa ogłasza „anulowano" na subskrypcji, która
// dalej jest obciążana (patrz `subscriptionFalseSuccess.test.tsx`).
//
// Modul jest czysty, więc jego gałęzie są sprawdzane tutaj, a nie przez UI.
import { describe, expect, it } from "vitest";

import {
  ProviderCallError,
  providerErrorCode,
  unwrapProviderResult,
} from "@/lib/billing/providerResult";

describe("unwrapProviderResult", () => {
  it("przepuszcza sukces bez zmiany tożsamości obiektu", () => {
    const success = { ok: true as const, direction: "upgrade" as const };

    expect(unwrapProviderResult(success)).toBe(success);
    expect(unwrapProviderResult(success).direction).toBe("upgrade");
  });

  it("RZUCA na odmowie operatora, zamiast oddać ją jako sukces", () => {
    expect(() => unwrapProviderResult({ error: "subscription_update_failed" })).toThrow(
      ProviderCallError,
    );
    expect(() => unwrapProviderResult({ error: "no_customer" })).toThrow(/no_customer/);
  });

  it("zachowuje powód odmowy w kodzie błędu", () => {
    try {
      unwrapProviderResult({ error: "no_customer" });
      expect.unreachable("odmowa musiała rzucić");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderCallError);
      expect((error as ProviderCallError).code).toBe("no_customer");
    }
  });

  it("ładunek z polem `error` o wartości pustej NIE jest odmową", () => {
    // Server fn zwraca niepusty powód albo nie zwraca pola wcale; puste `error`
    // nie może wywracać szczęśliwej ścieżki.
    expect(() => unwrapProviderResult({ error: "" })).not.toThrow();
    expect(() => unwrapProviderResult({ error: null })).not.toThrow();
  });

  it("odpowiedź bez pola `error` przechodzi (sukces portalu ma same adresy)", () => {
    const session = { url: "https://portal.example.test/s", updatePaymentMethodUrl: null };

    expect(unwrapProviderResult(session)).toBe(session);
    expect(() => unwrapProviderResult(session)).not.toThrow();
  });

  it("kod odmowy zamienia się na napis także wtedy, gdy nie był napisem", () => {
    try {
      unwrapProviderResult({ error: 500 } as { error: unknown });
      expect.unreachable("odmowa musiała rzucić");
    } catch (error) {
      expect(providerErrorCode(error)).toBe("500");
      expect(typeof providerErrorCode(error)).toBe("string");
    }
  });
});

describe("providerErrorCode", () => {
  it("czyta kod z odmowy operatora", () => {
    expect(providerErrorCode(new ProviderCallError("portal_failed"))).toBe("portal_failed");
    expect(providerErrorCode(new ProviderCallError("no_customer"))).toBe("no_customer");
  });

  it("dla awarii NIE-operatorskiej zwraca null (UI daje komunikat ogólny)", () => {
    expect(providerErrorCode(new Error("fetch failed"))).toBeNull();
    expect(providerErrorCode(new TypeError("zły typ"))).toBeNull();
  });

  it("wartości niebędące błędem też dają null, bez rzucania", () => {
    expect(providerErrorCode(null)).toBeNull();
    expect(providerErrorCode({ code: "no_customer" })).toBeNull();
    expect(providerErrorCode("no_customer")).toBeNull();
  });
});

describe("ProviderCallError", () => {
  it("jest zwykłym Errorem, więc react-query traktuje go jako awarię mutacji", () => {
    const error = new ProviderCallError("no_customer");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ProviderCallError");
  });

  it("komunikat nosi powód, żeby log był czytelny bez rozpakowywania obiektu", () => {
    expect(new ProviderCallError("seat_update_failed").message).toBe(
      "provider_error:seat_update_failed",
    );
    expect(new ProviderCallError("x").message).toContain("provider_error:");
  });
});
