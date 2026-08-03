import { describe, expect, it } from "vitest";
import { composerStatusMessageKey, validateComposerValue } from "@/lib/composer/validation";

describe("validateComposerValue", () => {
  it("blokuje pustą treść i same białe znaki", () => {
    for (const value of ["", "   ", "\n\t"]) {
      const v = validateComposerValue({ value, maxLength: 100 });
      expect(v.status).toBe("empty");
      expect(v.submitDisabled).toBe(true);
      expect(v.invalid).toBe(false);
    }
  });

  it("blokuje treść ponad limit i oznacza pole jako błędne", () => {
    const v = validateComposerValue({ value: "a".repeat(11), maxLength: 10 });
    expect(v.status).toBe("tooLong");
    expect(v.isTooLong).toBe(true);
    expect(v.invalid).toBe(true);
    expect(v.canSubmit).toBe(false);
  });

  it("blokuje treść krótszą niż minimum", () => {
    const v = validateComposerValue({ value: "ab", maxLength: 100, minLength: 5 });
    expect(v.status).toBe("tooShort");
    expect(v.invalid).toBe(true);
  });

  it("blokuje w trakcie wysyłki i przy braku zmian w trybie edycji", () => {
    expect(validateComposerValue({ value: "ok", maxLength: 100, submitting: true }).status).toBe(
      "submitting",
    );
    expect(
      validateComposerValue({ value: " tekst ", maxLength: 100, initialValue: "tekst" }).status,
    ).toBe("unchanged");
  });

  it("przepuszcza poprawną treść", () => {
    const v = validateComposerValue({ value: "  cześć  ", maxLength: 100 });
    expect(v.canSubmit).toBe(true);
    expect(v.trimmedLength).toBe(5);
    expect(v.length).toBe(9);
    expect(composerStatusMessageKey(v.status)).toBeNull();
  });

  it("mapuje statusy błędów na klucze i18n", () => {
    expect(composerStatusMessageKey("tooLong")).toBe("composer.status.tooLong");
    expect(composerStatusMessageKey("tooShort")).toBe("composer.status.tooShort");
  });
});
