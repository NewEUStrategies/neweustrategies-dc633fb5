import { describe, expect, it } from "vitest";
import { welcomeCopy } from "../MembershipWelcome";

describe("welcomeCopy", () => {
  it("gratuluje po aktywacji konta (PL)", () => {
    const copy = welcomeCopy("pl", "activated", "Pro");
    expect(copy.title).toBe("Gratulacje, jesteś członkiem New European Strategies");
    expect(copy.benefitsTitle).toContain("Pro");
  });

  it("congratulates after activation (EN)", () => {
    const copy = welcomeCopy("en", "activated", "Pro");
    expect(copy.title).toContain("member of New European Strategies");
    expect(copy.subtitle).toContain("Pro");
  });

  it("uses upgrade wording for plan changes", () => {
    expect(welcomeCopy("pl", "upgraded", "Plus").title).toBe("Twój plan jest aktywny");
    expect(welcomeCopy("en", "upgraded", "Plus").title).toBe("Your plan is active");
  });
});
