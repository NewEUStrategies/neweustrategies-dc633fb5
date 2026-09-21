import { describe, it, expect } from "vitest";
import {
  applyPreferences,
  crmCustomFromPreferences,
  crmTagsFromPreferences,
  mergeLists,
  readPreferences,
  splitList,
} from "@/lib/newsletter/preferences";

describe("newsletter preferences", () => {
  it("splits and dedupes comma lists", () => {
    expect(splitList(" a, b ,a, ")).toEqual(["a", "b"]);
    expect(splitList(null)).toEqual([]);
  });

  it("reads legacy shapes (mailing_list, interests_topics)", () => {
    const prefs = readPreferences({
      mailing_list: "Tygodnik",
      interests_areas: "Bezpieczeństwo",
      interests_topics: "NATO",
    });
    expect(prefs.mailingLists).toEqual(["Tygodnik"]);
    expect(prefs.topics).toEqual(["Bezpieczeństwo", "NATO"]);
  });

  it("merges new picks into existing meta without losing other fields", () => {
    const meta = applyPreferences(
      { company: "NES", interests: "NATO", mailing_list: "Tygodnik" },
      { phone: "+48123123123" },
      { topics: ["Energia", "NATO"], mailingLists: ["Miesięcznik"] },
    );
    expect(meta.company).toBe("NES");
    expect(meta.phone).toBe("+48123123123");
    expect(meta.interests).toBe("NATO, Energia");
    expect(meta.mailing_lists).toBe("Tygodnik,Miesięcznik");
    expect(meta.mailing_list).toBeUndefined();
  });

  it("maps preferences to CRM custom fields and tags", () => {
    const prefs = { topics: ["NATO"], mailingLists: ["Tygodnik"] };
    expect(crmCustomFromPreferences(prefs)).toEqual({
      interests: "NATO",
      mailing_lists: "Tygodnik",
    });
    expect(crmTagsFromPreferences(prefs)).toEqual(["temat:NATO", "lista:Tygodnik"]);
    expect(mergeLists(["a"], ["a", "b"])).toEqual(["a", "b"]);
  });
});
