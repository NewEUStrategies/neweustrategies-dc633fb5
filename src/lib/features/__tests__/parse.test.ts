import { describe, it, expect } from "vitest";
import {
  parseBiText,
  parseNumberCell,
  parseTimelineData,
  parseSankeyData,
  parseCompareData,
  parseRiskData,
  parseSparkData,
  parseNetworkEdges,
  parseNetworkGroups,
  parseCorridors,
  parseCorridorMarkers,
  parseCountryCodes,
  parseSourceEntries,
  MAX_FEATURE_ROWS,
} from "../parse";

describe("parseBiText", () => {
  it("splits PL|EN", () => {
    expect(parseBiText("Polska|Poland")).toEqual({ pl: "Polska", en: "Poland" });
  });
  it("mirrors when no pipe", () => {
    expect(parseBiText("Warszawa")).toEqual({ pl: "Warszawa", en: "Warszawa" });
  });
  it("falls back each side to the other when one is empty", () => {
    expect(parseBiText("Polska|")).toEqual({ pl: "Polska", en: "Polska" });
    expect(parseBiText("|Poland")).toEqual({ pl: "Poland", en: "Poland" });
  });
  it("trims surrounding whitespace", () => {
    expect(parseBiText("  a  |  b  ")).toEqual({ pl: "a", en: "b" });
  });
});

describe("parseNumberCell", () => {
  it("accepts comma decimals and strips spaces", () => {
    expect(parseNumberCell("12,5")).toBe(12.5);
    expect(parseNumberCell("1 200,4")).toBe(1200.4);
  });
  it("returns null for empty / invalid", () => {
    expect(parseNumberCell("")).toBeNull();
    expect(parseNumberCell("abc")).toBeNull();
  });
});

describe("parseTimelineData", () => {
  it("parses events with color slots and bilingual fields", () => {
    const ev = parseTimelineData("2024-03; Tytuł|Title; Opis|Desc; 3");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ date: "2024-03", colorSlot: 3 });
    expect(ev[0].title).toEqual({ pl: "Tytuł", en: "Title" });
  });
  it("skips rows without date or title, nulls out-of-range slots", () => {
    const ev = parseTimelineData("; brak daty\n2025; OnlyTitle;; 99");
    expect(ev).toHaveLength(1);
    expect(ev[0].colorSlot).toBeNull();
  });
});

describe("parseSankeyData", () => {
  it("keeps positive flows, drops <=0 and self-loops", () => {
    const f = parseSankeyData(
      ["A|A; B|B; 10", "A|A; B|B; 0", "A|A; B|B; -3", "X|X; X|X; 5"].join("\n"),
    );
    expect(f).toHaveLength(1);
    expect(f[0].value).toBe(10);
  });
});

describe("parseCompareData", () => {
  it("reads the header row and extracts per-row units from [..]", () => {
    const { columns, rows } = parseCompareData(
      ["; PL; DE", "Wydatki [% PKB]|Spending [% GDP]; 4,1; 2,1"].join("\n"),
    );
    expect(columns.map((c) => c.pl)).toEqual(["PL", "DE"]);
    expect(rows[0].unit).toBe("% PKB");
    expect(rows[0].indicator.en).toBe("Spending");
    expect(rows[0].values).toEqual([4.1, 2.1]);
  });
  it("returns empty when header has no columns", () => {
    expect(parseCompareData("").columns).toEqual([]);
  });
  it("pads missing cells with null", () => {
    const { rows } = parseCompareData(["; PL; DE; FR", "X; 1"].join("\n"));
    expect(rows[0].values).toEqual([1, null, null]);
  });
});

describe("parseRiskData", () => {
  it("clamps likelihood/impact to 1..5 and rounds", () => {
    const items = parseRiskData(["R|R; 9; 0; d|d", "S|S; 2,6; 3"].join("\n"));
    expect(items[0]).toMatchObject({ likelihood: 5, impact: 1 });
    expect(items[1]).toMatchObject({ likelihood: 3, impact: 3 });
  });
  it("skips rows missing numeric coordinates", () => {
    expect(parseRiskData("R|R; ; ")).toHaveLength(0);
  });
});

describe("parseSparkData", () => {
  it("reads numbers separated by ; or newlines", () => {
    expect(parseSparkData("1; 2,5\n3")).toEqual([1, 2.5, 3]);
  });
});

describe("parseNetworkEdges / parseNetworkGroups", () => {
  it("parses edges with strength default 2 and skips self-links", () => {
    const e = parseNetworkEdges(["A|A; B|B; 5; rel|rel", "A|A; B|B", "Z|Z; Z|Z; 3"].join("\n"));
    expect(e).toHaveLength(2);
    expect(e[0].strength).toBe(5);
    expect(e[1].strength).toBe(2);
  });
  it("parses group assignments", () => {
    const g = parseNetworkGroups("Komisja|Commission; UE|EU");
    expect(g[0]).toEqual({
      node: { pl: "Komisja", en: "Commission" },
      group: { pl: "UE", en: "EU" },
    });
  });
});

describe("parseCorridors / parseCorridorMarkers", () => {
  it("requires >=2 valid waypoints and assigns a color slot", () => {
    const c = parseCorridors("Trasa|Route; 2; 52.2,21.0 > 50.0,19.9 > 48.2,16.3");
    expect(c).toHaveLength(1);
    expect(c[0].points).toHaveLength(3);
    expect(c[0].colorSlot).toBe(2);
  });
  it("drops corridors with a single point", () => {
    expect(parseCorridors("Trasa|Route; 1; 52.2,21.0")).toHaveLength(0);
  });
  it("rejects out-of-range coordinates", () => {
    expect(parseCorridors("Bad|Bad; 1; 999,21 > 5,5")).toHaveLength(0);
  });
  it("parses markers", () => {
    const m = parseCorridorMarkers("54.35,18.65; Gdańsk");
    expect(m[0]).toMatchObject({ lat: 54.35, lon: 18.65 });
    expect(m[0].label.pl).toBe("Gdańsk");
  });
});

describe("parseCountryCodes", () => {
  it("uppercases, validates ISO-2 and dedups", () => {
    expect(parseCountryCodes("pl, de; PL; xyz; fr")).toEqual(["PL", "DE", "FR"]);
  });
});

describe("parseSourceEntries", () => {
  it("parses type/year/title/publisher/url", () => {
    const e = parseSourceEntries("Raport|Report; 2024; Tytuł|Title; Wydawca|Publisher; https://x");
    expect(e[0]).toMatchObject({ year: "2024", url: "https://x" });
    expect(e[0].kind.en).toBe("Report");
  });
  it("skips rows without a title", () => {
    expect(parseSourceEntries("Raport|Report; 2024")).toHaveLength(0);
  });
});

describe("row cap", () => {
  it("never parses more than MAX_FEATURE_ROWS rows", () => {
    const many = Array.from({ length: MAX_FEATURE_ROWS + 50 }, (_, i) => `2020; T${i}`).join("\n");
    expect(parseTimelineData(many).length).toBeLessThanOrEqual(MAX_FEATURE_ROWS);
  });
});
