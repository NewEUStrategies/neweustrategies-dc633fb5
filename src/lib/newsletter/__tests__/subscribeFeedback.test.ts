import { describe, expect, it } from "vitest";
import {
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

  it("localizes the error title", () => {
    expect(subscribeErrorTitle("en")).toBe("Sign-up failed");
    expect(subscribeErrorTitle("pl")).toMatch(/Nie udało/);
  });
});
