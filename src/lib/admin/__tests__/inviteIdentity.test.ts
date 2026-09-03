// Kontrakt tożsamości zaproszenia: inicjały (fallback awataru) i adres
// LinkedIn zapisywany do publicznego profilu. Adres jest treścią wklejaną
// przez administratora, więc normalizacja jest jednocześnie bramką
// bezpieczeństwa - do profilu nie może trafić inny host ani `javascript:`.
import { describe, expect, it } from "vitest";
import {
  initialsFromName,
  isLinkedInInputValid,
  normalizeLinkedInUrl,
} from "@/lib/admin/inviteIdentity";

describe("initialsFromName", () => {
  it("bierze pierwsze litery dwóch pierwszych członów", () => {
    expect(initialsFromName("Jan Kowalski")).toBe("JK");
    expect(initialsFromName("  anna   maria   nowak ")).toBe("AM");
  });

  it("radzi sobie z jednym członem, dywizem i znakami diakrytycznymi", () => {
    expect(initialsFromName("łucja")).toBe("Ł");
    expect(initialsFromName("Ostrowska-Nowak")).toBe("ON");
    expect(initialsFromName("Śliwa Żak")).toBe("ŚŻ");
  });

  it("pusta nazwa nie daje inicjałów", () => {
    expect(initialsFromName("")).toBe("");
    expect(initialsFromName("   ")).toBe("");
  });
});

describe("normalizeLinkedInUrl", () => {
  it("uzupełnia sam uchwyt do pełnego adresu profilu", () => {
    expect(normalizeLinkedInUrl("jan-kowalski")).toBe("https://www.linkedin.com/in/jan-kowalski");
  });

  it("dokłada protokół i wymusza https", () => {
    expect(normalizeLinkedInUrl("linkedin.com/in/jan")).toBe("https://linkedin.com/in/jan");
    expect(normalizeLinkedInUrl("http://www.linkedin.com/in/jan")).toBe(
      "https://www.linkedin.com/in/jan",
    );
    expect(normalizeLinkedInUrl("https://pl.linkedin.com/in/jan/")).toBe(
      "https://pl.linkedin.com/in/jan",
    );
  });

  it("odrzuca obcy host i niebezpieczny schemat", () => {
    expect(normalizeLinkedInUrl("https://example.org/jan")).toBeNull();
    expect(normalizeLinkedInUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkedInUrl("https://linkedin.com.evil.tld/in/jan")).toBeNull();
    expect(normalizeLinkedInUrl("::::")).toBeNull();
  });

  it("puste wejście to brak adresu, nie błąd", () => {
    expect(normalizeLinkedInUrl("   ")).toBeNull();
  });
});

describe("isLinkedInInputValid", () => {
  it("pole opcjonalne: puste jest poprawne, śmieci nie", () => {
    expect(isLinkedInInputValid("")).toBe(true);
    expect(isLinkedInInputValid("https://example.org")).toBe(false);
    expect(isLinkedInInputValid("linkedin.com/in/jan")).toBe(true);
  });
});
