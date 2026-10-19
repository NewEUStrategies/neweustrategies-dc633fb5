import { describe, expect, it } from "vitest";
import {
  missingFieldsMessage,
  subscribeErrorMessage,
  subscribeErrorTitle,
  subscribeSuccessCopy,
} from "@/lib/newsletter/subscribeFeedback";

describe("subscribeFeedback", () => {
  it("returns localized success copy per status", () => {
    expect(subscribeSuccessCopy("pending", "pl").title).toMatch(/potwierdź/i);
    expect(subscribeSuccessCopy("subscribed", "en").title).toMatch(/subscribed/i);
    expect(subscribeSuccessCopy("exists", "pl").hint).toBeTruthy();
  });

  it("prefers the tenant success message as the headline", () => {
    const copy = subscribeSuccessCopy("pending", "pl", "Dziękujemy!");
    expect(copy.title).toBe("Dziękujemy!");
    expect(copy.hint).toBeTruthy();
  });

  it("maps known error codes and hides raw technical errors", () => {
    expect(subscribeErrorMessage("rate_limited", "pl")).toMatch(/Zbyt wiele/);
    expect(subscribeErrorMessage("policy_violation:email,firstName", "en")).toMatch(/required/i);
    expect(subscribeErrorMessage("Failed to fetch", "pl")).toMatch(/połączenia/i);
    expect(subscribeErrorMessage('duplicate key value violates unique constraint "x"', "pl")).toBe(
      subscribeErrorMessage("", "pl"),
    );
  });

  it("names fields by their LABEL, not by key, when the form passes `labelOf`", () => {
    const labels: Record<string, string> = { firstName: "Imię", phone: "Numer telefonu" };
    const labelOf = (key: string) => labels[key] ?? key;
    expect(missingFieldsMessage(["firstName", "phone", "phone"], labelOf, "pl")).toBe(
      "Uzupełnij wymagane pola: Imię, Numer telefonu",
    );
    expect(
      subscribeErrorMessage("policy_violation:required:phone,pattern:firstName", "pl", labelOf),
    ).toBe("Uzupełnij wymagane pola: Numer telefonu; Nieprawidłowy format pola: Imię");
    expect(subscribeErrorMessage("policy_violation:max_length:phone", "en", labelOf)).toBe(
      "Value too long in: Numer telefonu",
    );
    // Kod bez rozpoznawalnego naruszenia albo bez `labelOf` - zdanie słownika.
    expect(subscribeErrorMessage("policy_violation:new_kind:x", "pl", labelOf)).toBe(
      subscribeErrorMessage("policy_violation", "pl"),
    );
    expect(subscribeErrorMessage("policy_violation:required:phone", "pl")).toBe(
      subscribeErrorMessage("policy_violation", "pl"),
    );
  });

  it("treats React Native style network errors as network errors", () => {
    expect(subscribeErrorMessage("Network request failed", "en")).toMatch(/connection/i);
  });

  it("localizes the error title", () => {
    expect(subscribeErrorTitle("en")).toBe("Sign-up failed");
    expect(subscribeErrorTitle("pl")).toMatch(/Nie udało/);
  });
});
