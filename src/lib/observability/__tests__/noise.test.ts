import { describe, expect, it } from "vitest";
import { isIgnorableClientError, isIgnorableClientErrorValue } from "../noise";

describe("isIgnorableClientError", () => {
  it("wycisza anulowane żądania", () => {
    expect(isIgnorableClientError("signal is aborted without reason")).toBe(true);
    expect(isIgnorableClientError("The operation was aborted")).toBe(true);
    expect(isIgnorableClientError("AbortError: cokolwiek")).toBe(true);
  });

  it("wycisza artefakty układu i puste komunikaty", () => {
    expect(isIgnorableClientError("ResizeObserver loop limit exceeded")).toBe(true);
    expect(isIgnorableClientError("Script error.")).toBe(true);
    expect(isIgnorableClientError("undefined")).toBe(true);
    expect(isIgnorableClientError("   ")).toBe(true);
  });

  it("przepuszcza realne awarie", () => {
    expect(isIgnorableClientError("TypeError: x is not a function")).toBe(false);
    expect(isIgnorableClientError("Failed to fetch dynamically imported module")).toBe(false);
    expect(isIgnorableClientError(42)).toBe(false);
  });

  it("rozpoznaje AbortError po nazwie błędu", () => {
    const err = new Error("cokolwiek");
    err.name = "AbortError";
    expect(isIgnorableClientErrorValue(err)).toBe(true);
    expect(isIgnorableClientErrorValue(new Error("realna awaria"))).toBe(false);
    expect(isIgnorableClientErrorValue({ message: "x" })).toBe(false);
  });
});
