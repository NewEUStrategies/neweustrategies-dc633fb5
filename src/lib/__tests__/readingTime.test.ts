import { describe, it, expect } from "vitest";
import {
  computeBilingualReadingStats,
  computeReadingMinutes,
  computeReadingStats,
  countWords,
  DEFAULT_READING_TIME_SETTINGS,
  estimateReadingMinutes,
  readingTimeSettingsSchema,
  resolveReadMinutes,
  type ReadingTimeSettings,
} from "@/lib/readingTime";

const words = (n: number): string => Array.from({ length: n }, (_, i) => `słowo${i}`).join(" ");

const s = (over: Partial<ReadingTimeSettings> = {}): ReadingTimeSettings => ({
  ...DEFAULT_READING_TIME_SETTINGS,
  ...over,
});

describe("readingTime", () => {
  it("countWords ignores whitespace", () => {
    expect(countWords("  hello   world  ")).toBe(2);
    expect(countWords("")).toBe(0);
  });

  it("estimates from HTML stripping tags", () => {
    const html = `<p>${"word ".repeat(440)}</p>`;
    expect(estimateReadingMinutes({ html })).toBe(2);
  });

  it("returns 0 for empty sources", () => {
    expect(estimateReadingMinutes({})).toBe(0);
  });

  it("aggregates docs recursively", () => {
    const doc = { blocks: [{ text: "word ".repeat(220) }, { children: ["word ".repeat(220)] }] };
    expect(estimateReadingMinutes({ docs: [doc] })).toBe(2);
  });

  it("clamps minimum to 1 when there are words", () => {
    expect(estimateReadingMinutes({ extraText: "hello world" })).toBe(1);
  });
});

describe("computeReadingStats (parametry z ustawień)", () => {
  it("PL i EN liczą się niezależnie wg własnych wpm", () => {
    const both = computeBilingualReadingStats(
      { pl: { extraText: words(476) }, en: { extraText: words(476) } },
      s({ wpm_pl: 100, wpm_en: 476 }),
    );
    expect(both.pl.minutes).toBe(5); // 476/100 = 4.76 -> 5
    expect(both.en.minutes).toBe(1); // 476/476 = 1
  });

  it("honoruje tryby zaokrąglania", () => {
    const src = { extraText: words(330) }; // 330/220 = 1.5
    expect(computeReadingMinutes(src, "pl", s({ rounding: "ceil" }))).toBe(2);
    expect(computeReadingMinutes(src, "pl", s({ rounding: "floor" }))).toBe(1);
    expect(computeReadingMinutes(src, "pl", s({ rounding: "round" }))).toBe(2);
  });

  it("wymusza min_minutes tylko dla niepustej treści", () => {
    expect(computeReadingMinutes({ extraText: words(10) }, "pl", s({ min_minutes: 3 }))).toBe(3);
    expect(computeReadingMinutes({ extraText: "" }, "pl", s({ min_minutes: 3 }))).toBe(0);
  });

  it("dolicza obrazy wg krzywej head/tail i raportuje ich liczbę", () => {
    // 12 obrazów: 10*12s + 2*3s = 126 s = 2.1 min -> 2
    const r = computeReadingStats({ extraText: "", images: 12 }, "pl", s({ min_minutes: 0 }));
    expect(r.minutes).toBe(2);
    expect(r.images).toBe(12);
  });

  it("zlicza obrazy z HTML i z doca", () => {
    const r = computeReadingStats(
      {
        html: '<p>tekst</p><img src="a.jpg"><img src="b.jpg">',
        docs: [{ type: "image-block", url: "c.jpg" }],
      },
      "pl",
      s(),
    );
    expect(r.images).toBe(3);
  });

  it("kod liczy się wolniej wg code_wpm_factor", () => {
    const html = `<pre>${words(220)}</pre>`;
    expect(computeReadingMinutes({ html }, "pl", s({ code_wpm_factor: 1 }))).toBe(1);
    expect(computeReadingMinutes({ html }, "pl", s({ code_wpm_factor: 0.5 }))).toBe(2);
  });
});

describe("resolveReadMinutes (powierzchnia publiczna)", () => {
  const sources = { extraText: words(440) };

  it("automat, gdy brak ręcznego override", () => {
    expect(resolveReadMinutes({ manual: null, sources, lang: "pl", settings: s() })).toBe(2);
  });

  it("ręczny override redakcji wygrywa nad automatem", () => {
    expect(resolveReadMinutes({ manual: 7, sources, lang: "pl", settings: s() })).toBe(7);
  });

  it("enabled=false ukrywa czas (null) nawet przy ręcznym override", () => {
    expect(
      resolveReadMinutes({ manual: 7, sources, lang: "pl", settings: s({ enabled: false }) }),
    ).toBeNull();
  });

  it("brak treści -> null (nie pokazujemy '0 min')", () => {
    expect(
      resolveReadMinutes({
        manual: null,
        sources: { extraText: "" },
        lang: "pl",
        settings: s({ min_minutes: 0 }),
      }),
    ).toBeNull();
  });
});

describe("schema ustawień", () => {
  it("akceptuje domyślne i odrzuca wartości spoza zakresu", () => {
    expect(readingTimeSettingsSchema.safeParse(DEFAULT_READING_TIME_SETTINGS).success).toBe(true);
    expect(
      readingTimeSettingsSchema.safeParse({ ...DEFAULT_READING_TIME_SETTINGS, wpm_pl: 10 }).success,
    ).toBe(false);
    expect(
      readingTimeSettingsSchema.safeParse({ ...DEFAULT_READING_TIME_SETTINGS, rounding: "up" })
        .success,
    ).toBe(false);
  });
});
