import { describe, expect, it } from "vitest";
import { sanitizeSearchTerm } from "../GrantSubjectCombobox";

describe("sanitizeSearchTerm", () => {
  it("usuwa znaki zmieniające filtr wyszukiwania", () => {
    expect(sanitizeSearchTerm("Jan, (Kowalski)%*")).toBe("Jan   Kowalski");
  });
  it("zostawia zwykłe imię i nazwisko", () => {
    expect(sanitizeSearchTerm("  Anna Nowak ")).toBe("Anna Nowak");
  });
});
