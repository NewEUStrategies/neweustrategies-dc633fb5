// Kontrakt czystej logiki event-sponsors: parsowanie poziomow sponsorskich.
import { describe, it, expect } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import { parseSponsorTiers } from "@/lib/events/sponsors";

describe("parseSponsorTiers", () => {
  it("parses tiers with sponsors and whitelists sizes", () => {
    const tiers = parseSponsorTiers({
      tiers: [
        {
          id: "t1",
          name_pl: "Główny",
          name_en: "Main",
          size: "lg",
          sponsors: [{ id: "s1", name: "Acme", logo: "", url: "" }],
        },
        { id: "t2", name_pl: "Medialni", name_en: "Media", size: "weird", sponsors: [] },
      ],
    } as unknown as WidgetContent);
    expect(tiers).toHaveLength(2);
    expect(tiers[0].size).toBe("lg");
    expect(tiers[0].sponsors[0].name).toBe("Acme");
    // Nieznany rozmiar degraduje do "md".
    expect(tiers[1].size).toBe("md");
  });

  it("tolerates garbage and drops sponsors without a name and logo", () => {
    expect(parseSponsorTiers({})).toEqual([]);
    expect(parseSponsorTiers({ tiers: "nope" } as unknown as WidgetContent)).toEqual([]);
    const tiers = parseSponsorTiers({
      tiers: [null, 7, { sponsors: [null, {}, { name: "", logo: "" }, { logo: "https://x/l.png" }] }],
    } as unknown as WidgetContent);
    expect(tiers).toHaveLength(1);
    expect(tiers[0].sponsors).toHaveLength(1);
    expect(tiers[0].sponsors[0].logo).toBe("https://x/l.png");
  });
});
