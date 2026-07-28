import { describe, expect, it } from "vitest";

import { authCopy } from "../copy";

describe("authCopy - odmiana przez rodzaj (PL)", () => {
  it("używa formy męskiej dla rodzaju męskiego", () => {
    expect(authCopy("recovery", "pl", "male").security).toContain("nie prosiłeś o zmianę hasła");
    expect(authCopy("invite", "pl", "male").intro).toContain("Zostałeś zaproszony");
  });

  it("używa formy żeńskiej dla rodzaju żeńskiego", () => {
    expect(authCopy("recovery", "pl", "female").security).toContain("nie prosiłaś o zmianę hasła");
    expect(authCopy("invite", "pl", "female").intro).toContain("Zostałaś zaproszona");
    expect(authCopy("reauthentication", "pl", "female").security).toContain("nie prosiłaś");
  });

  it("dla nieznanego rodzaju używa formy bezosobowej", () => {
    const security = authCopy("recovery", "pl", "unknown").security;
    expect(security).toContain("nie pochodziła od Ciebie");
    expect(security).not.toMatch(/prosiłeś|prosiłaś/);
    expect(authCopy("signup", "pl").security).not.toMatch(/zakładałeś|zakładałaś/);
  });

  it("EN pozostaje bez odmiany", () => {
    expect(authCopy("recovery", "en", "female").security).toBe(
      authCopy("recovery", "en", "male").security,
    );
  });
});
