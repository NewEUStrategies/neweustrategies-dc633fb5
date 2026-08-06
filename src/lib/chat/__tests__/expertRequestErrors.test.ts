// Mapowanie odmów serwerowych „Zapytania do eksperta" na klucze i18n.
//
// Kontrakt jest dwustronny: komunikaty pochodzą z bramek SQL (SECURITY DEFINER),
// a klucze muszą istnieć w pakiecie i18n dla PL i EN. Test pilnuje obu stron -
// samo dopasowanie podłańcucha i realną obecność tłumaczenia.
import { describe, expect, it } from "vitest";
import {
  expertRequestErrorI18nKey,
  expertRequestErrorKey,
  expertRequestErrorMessage,
} from "@/lib/chat/expertRequestErrors";
import { expertRequestEn, expertRequestPl } from "@/lib/i18n-expert-request";

describe("expertRequestErrorKey", () => {
  it.each([
    ["expert_request: monthly quota exceeded", "monthlyQuota"],
    ["inmail: monthly quota exceeded", "monthlyQuota"],
    ["expert_request: rate limit", "rateLimit"],
    ["expert_request: recipient not accepting requests", "recipientDisabled"],
    ["expert_request: feature disabled", "featureDisabled"],
    ["expert_request: recipient is not gated", "notExpert"],
    ["inmail: recipient is not an expert", "notExpert"],
    ["expert_request: recipient not available", "notAvailable"],
    ["expert_request: invalid recipient", "notAvailable"],
    ["expert_request: tier disabled", "tierDisabled"],
    ["expert_request: invalid status transition", "invalidTransition"],
    ["expert_request: not found", "notFound"],
    ["expert_request: forbidden", "forbidden"],
    ["cokolwiek innego", "generic"],
    ["", "generic"],
  ])("komunikat %s mapuje się na %s", (message, expected) => {
    expect(expertRequestErrorKey(new Error(message))).toBe(expected);
  });

  it("czyta komunikat z Error, PostgrestError i gołego stringa", () => {
    expect(expertRequestErrorMessage(new Error("boom"))).toBe("boom");
    expect(expertRequestErrorMessage({ message: "expert_request: forbidden" })).toBe(
      "expert_request: forbidden",
    );
    expect(expertRequestErrorMessage("expert_request: rate limit")).toBe(
      "expert_request: rate limit",
    );
    expect(expertRequestErrorMessage(undefined)).toBe("");
  });

  it("kolejność dopasowań: opt-out odbiorcy nie wpada w „forbidden”", () => {
    expect(
      expertRequestErrorKey({ message: "expert_request: recipient not accepting requests" }),
    ).toBe("recipientDisabled");
  });

  it("nie gubi klasy błędu przy innej wielkości liter", () => {
    expect(expertRequestErrorKey(new Error("EXPERT_REQUEST: RATE LIMIT"))).toBe("rateLimit");
  });
});

describe("expertRequestErrorI18nKey", () => {
  const KEYS = [
    "monthlyQuota",
    "rateLimit",
    "notExpert",
    "tierDisabled",
    "recipientDisabled",
    "featureDisabled",
    "notAvailable",
    "invalidTransition",
    "notFound",
    "forbidden",
    "generic",
  ] as const;

  it("zwraca pełną ścieżkę do pakietu tłumaczeń", () => {
    expect(expertRequestErrorI18nKey(new Error("expert_request: not found"))).toBe(
      "expertRequest.error.notFound",
    );
  });

  it("każda klasa odmowy ma tłumaczenie PL i EN", () => {
    for (const key of KEYS) {
      expect(expertRequestPl.expertRequest.error).toHaveProperty(key);
      expect(expertRequestEn.expertRequest.error).toHaveProperty(key);
      const pl = (expertRequestPl.expertRequest.error as Record<string, string>)[key];
      const en = (expertRequestEn.expertRequest.error as Record<string, string>)[key];
      expect(pl.trim().length).toBeGreaterThan(0);
      expect(en.trim().length).toBeGreaterThan(0);
    }
  });

  it("pakiet nie zawiera martwych kluczy błędów (rejestr = tłumaczenia)", () => {
    expect(Object.keys(expertRequestPl.expertRequest.error).sort()).toEqual([...KEYS].sort());
    expect(Object.keys(expertRequestEn.expertRequest.error).sort()).toEqual([...KEYS].sort());
  });
});
