import { describe, expect, it } from "vitest";
import { DEFAULT_RETURN_PATH, safeReturnPath } from "@/lib/billing/returnPath";

describe("safeReturnPath", () => {
  it("przepuszcza zwykłe ścieżki względne", () => {
    expect(safeReturnPath("/profile/plan")).toBe("/profile/plan");
    expect(safeReturnPath("/profile/membership?tab=billing")).toBe(
      "/profile/membership?tab=billing",
    );
  });

  it("odrzuca adresy bezwzględne i protocol-relative", () => {
    for (const evil of [
      "https://evil.test/steal",
      "//evil.test",
      "/\\evil.test",
      "javascript:alert(1)",
      "/javascript:alert(1)",
    ]) {
      expect(safeReturnPath(evil)).toBe(DEFAULT_RETURN_PATH);
    }
  });

  it("odrzuca puste, zbyt długie i sterujące wartości", () => {
    expect(safeReturnPath("")).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(undefined)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath(`/a${"b".repeat(400)}`)).toBe(DEFAULT_RETURN_PATH);
    expect(safeReturnPath("/plan\nSet-Cookie: x")).toBe(DEFAULT_RETURN_PATH);
  });

  it("respektuje własny fallback", () => {
    expect(safeReturnPath("https://evil.test", "/profil")).toBe("/profil");
  });
});
