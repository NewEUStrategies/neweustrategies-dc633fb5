// Kolejność progów „ranga rosnąco" ze stabilnym drugim kluczem (I9b).
//
// Ranga nie jest unikalna (Członek/student/kadra 10, Rada/Zespół 25,
// Partner/NGO 40 od decyzji właściciela 2026-10-20). Samo `rank` zostawiało
// remis kolejności wierszy z bazy - „wymagany próg" ściany płatności dla
// treści rangi 40 mógł raz nazwać Partnera, raz stawkę NGO po weryfikacji.
import { describe, expect, it } from "vitest";

import { TIER_RANKS, compareTierRank } from "@/lib/billing/tierRanks";

const tier = (key: string, rank: number, sort_order?: number | null) => ({ key, rank, sort_order });

describe("TIER_RANKS - decyzja właściciela 2026-10-20", () => {
  it("NGO ma rangę Partnera Instytucjonalnego (40), nie Członka Pro (20)", () => {
    expect(TIER_RANKS.ngo).toBe(40);
    expect(TIER_RANKS.ngo).toBe(TIER_RANKS.partner);
    expect(TIER_RANKS.ngo).toBeGreaterThan(TIER_RANKS.corporate);
    expect(TIER_RANKS.ngo).toBeLessThan(TIER_RANKS.partner_general);
  });
});

describe("compareTierRank", () => {
  it("ranga rosnąco, remis rozstrzyga sort_order, potem klucz", () => {
    const sorted = [
      tier("ngo", 40, 85),
      tier("partner_general", 50, 90),
      tier("partner", 40, 80),
      tier("pro", 20, 20),
      tier("educator", 10, 40),
      tier("student", 10, 30),
    ].sort(compareTierRank);
    expect(sorted.map((t) => t.key)).toEqual([
      "student",
      "educator",
      "pro",
      "partner",
      "ngo",
      "partner_general",
    ]);
  });

  it("kolejność nie zależy od kolejności wejścia (remis bez sort_order - po kluczu)", () => {
    const a = [tier("team", 25), tier("vip", 25)].sort(compareTierRank);
    const b = [tier("vip", 25), tier("team", 25)].sort(compareTierRank);
    expect(a.map((t) => t.key)).toEqual(["team", "vip"]);
    expect(b.map((t) => t.key)).toEqual(a.map((t) => t.key));
  });

  it("brak sort_order (null) liczy się jak 0", () => {
    expect(compareTierRank(tier("a", 10, null), tier("b", 10, 5))).toBeLessThan(0);
  });
});
