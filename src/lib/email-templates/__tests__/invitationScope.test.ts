import { describe, expect, it } from "vitest";

import {
  invitationIntro,
  invitationScope,
  tierRankByKey,
  tierRankByPriceId,
} from "../invitationScope";

describe("invitationScope", () => {
  it("daje pełny zakres redakcji (rola inna niż user)", () => {
    for (const role of ["author", "editor", "admin", "super_admin"]) {
      expect(invitationScope({ role })).toBe("full");
    }
  });

  it("zwykły użytkownik bez planu dostaje zakres podstawowy", () => {
    expect(invitationScope({ role: "user" })).toBe("basic");
    expect(invitationScope({ role: null })).toBe("basic");
    expect(invitationScope({ role: "user", tierRank: 30 })).toBe("basic");
  });

  it("zwykły użytkownik od planu PRO w górę dostaje pełny zakres", () => {
    expect(invitationScope({ role: "user", tierRank: tierRankByKey("pro") })).toBe("full");
    expect(invitationScope({ role: "user", tierRank: tierRankByPriceId("pro_annual") })).toBe(
      "full",
    );
    expect(invitationScope({ role: "user", tierRank: tierRankByKey("member") })).toBe("basic");
    expect(tierRankByKey(null)).toBe(0);
    expect(tierRankByPriceId("nieznana_cena")).toBe(0);
  });

  it("treść wstępu odpowiada zakresowi i językowi", () => {
    expect(invitationIntro("full", "pl")).toContain("klubów dyskusyjnych");
    expect(invitationIntro("basic", "pl")).toContain("raportów, quizów i wydarzeń");
    expect(invitationIntro("basic", "pl")).not.toContain("klub");
    expect(invitationIntro("full", "en")).toContain("discussion clubs");
    expect(invitationIntro("basic", "en")).toContain("reports, quizzes and events");
  });
});
