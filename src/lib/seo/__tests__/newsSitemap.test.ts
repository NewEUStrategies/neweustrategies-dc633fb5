import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNewsSitemapXml,
  freshNewsEntries,
  NEWS_SITEMAP_WINDOW_MS,
  planNewsSitemap,
  type NewsSitemapEntry,
} from "@/lib/seo/newsSitemap";

const NOW = Date.parse("2026-07-02T12:00:00Z");

const entry = (hoursAgo: number, over: Partial<NewsSitemapEntry> = {}): NewsSitemapEntry => ({
  url: `https://nes.example/blog/wpis-${hoursAgo}`,
  title: `Wpis ${hoursAgo}h`,
  publishedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(),
  language: "pl",
  ...over,
});

describe("freshNewsEntries", () => {
  it("keeps only the 48h window, newest first", () => {
    const fresh = freshNewsEntries([entry(50), entry(1), entry(47), entry(0)], NOW);
    expect(fresh.map((e) => e.title)).toEqual(["Wpis 0h", "Wpis 1h", "Wpis 47h"]);
    expect(NEWS_SITEMAP_WINDOW_MS).toBe(48 * 3_600_000);
  });
  it("drops future and invalid dates", () => {
    const future = entry(0, { publishedAt: new Date(NOW + 3_600_000).toISOString() });
    const invalid = entry(0, { publishedAt: "nope" });
    expect(freshNewsEntries([future, invalid], NOW)).toEqual([]);
  });
});

describe("buildNewsSitemapXml", () => {
  it("emits news:news nodes with publication, language and title", () => {
    const xml = buildNewsSitemapXml({
      publicationName: "New European Strategies",
      entries: [
        entry(2),
        entry(3, { language: "en", url: "https://nes.example/en/blog/x", title: "EN & co" }),
      ],
      now: NOW,
    });
    expect(xml).toContain(`xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"`);
    expect(xml).toContain("<news:name>New European Strategies</news:name>");
    expect(xml).toContain("<news:language>en</news:language>");
    expect(xml).toContain("EN &amp; co");
    expect(xml).toContain("<loc>https://nes.example/en/blog/x</loc>");
  });
  // NAPRAWA 2026-10-10. Stał tu test „produces a valid empty urlset on a quiet
  // news day" - przypinał DEFEKT jako zamierzone zachowanie. Pusty <urlset>
  // nie jest poprawny względem sitemap.xsd i Search Console raportował go jako
  // „Brak tagu XML: url (wiersz 3)". Dzień bez publikacji niesie teraz
  // najnowszy artykuł jako kotwicę.
  it("on a quiet news day keeps the newest article as an anchor - never an empty urlset", () => {
    const xml = buildNewsSitemapXml({
      publicationName: "NES",
      entries: [entry(100), entry(72, { language: "en", url: "https://nes.example/en/x" })],
      now: NOW,
    });
    expect(xml).toContain("<url>");
    expect(xml).toContain("<loc>https://nes.example/en/x</loc>");
    expect(xml).not.toContain("wpis-100");
  });

  it("returns null when there is no published article at all", () => {
    expect(buildNewsSitemapXml({ publicationName: "NES", entries: [], now: NOW })).toBeNull();
  });

  it("normalises the publication date to W3C Datetime in UTC", () => {
    const xml = buildNewsSitemapXml({
      publicationName: "NES",
      entries: [entry(1, { publishedAt: "2026-07-02T13:00:00+02:00" })],
      now: NOW,
    });
    expect(xml).toContain("<news:publication_date>2026-07-02T11:00:00Z</news:publication_date>");
  });
});

describe("planNewsSitemap", () => {
  it("fresh: the 48h window, lastmod = newest publication", () => {
    const plan = planNewsSitemap([entry(30), entry(2), entry(60)], NOW);
    expect(plan.mode).toBe("fresh");
    expect(plan.entries.map((e) => e.title)).toEqual(["Wpis 2h", "Wpis 30h"]);
    expect(plan.lastmod).toBe("2026-07-02T10:00:00Z");
  });

  it("anchor: every language version of the newest past article, nothing older", () => {
    const pl = entry(72);
    const en = entry(72, { language: "en", url: "https://nes.example/en/blog/wpis-72" });
    const plan = planNewsSitemap([entry(200), en, pl, entry(96)], NOW);
    expect(plan.mode).toBe("anchor");
    expect(plan.entries).toEqual([en, pl]);
    expect(plan.lastmod).toBe("2026-06-29T12:00:00Z");
  });

  it("anchor never reveals a scheduled (future) article", () => {
    const scheduled = entry(0, { publishedAt: new Date(NOW + 3_600_000).toISOString() });
    const plan = planNewsSitemap([scheduled, entry(80)], NOW);
    expect(plan.entries.map((e) => e.title)).toEqual(["Wpis 80h"]);
  });

  it("empty: no published article in the past", () => {
    const scheduled = entry(0, { publishedAt: new Date(NOW + 3_600_000).toISOString() });
    expect(planNewsSitemap([scheduled, entry(0, { publishedAt: "nope" })], NOW)).toEqual({
      mode: "empty",
      entries: [],
      lastmod: null,
    });
  });
});

// Gałąź `input.now ?? Date.now()` (newsSitemap.ts:44). Bez podanego `now`
// builder czyta zegar SYSTEMOWY - to jest ścieżka produkcyjna trasy
// /news-sitemap.xml. Zamrażamy tylko `Date`; pełne `vi.useFakeTimers()`
// zabiera `setTimeout`, na którym stoi `waitFor`, i wiesza plik bez komunikatu.
describe("buildNewsSitemapXml - zegar systemowy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("bez pola `now` liczy okno 48h od bieżącego czasu", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-03T10:15:00Z") });
    const xml = buildNewsSitemapXml({
      publicationName: "NES",
      entries: [
        {
          url: "https://nes.example/a",
          title: "Wewnątrz okna",
          publishedAt: "2026-02-02T10:15:00Z",
          language: "pl",
        },
        {
          url: "https://nes.example/b",
          title: "Poza oknem",
          publishedAt: "2026-01-30T10:15:00Z",
          language: "pl",
        },
      ],
    });
    expect(xml).toContain("<news:title>Wewnątrz okna</news:title>");
    expect(xml).not.toContain("Poza oknem");
  });

  it("bez pola `now` odrzuca wpis z przyszłości względem zegara systemowego", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-02-03T10:15:00Z") });
    const xml = buildNewsSitemapXml({
      publicationName: "NES",
      entries: [
        {
          url: "https://nes.example/c",
          title: "Zaplanowany",
          publishedAt: "2026-02-03T11:00:00Z",
          language: "pl",
        },
      ],
    });
    // Google News odrzuca kanał z datą publikacji w przyszłości, a zaplanowany
    // wpis nie może wyjść przed czasem. Bez żadnej publikacji z przeszłości
    // dokumentu nie ma (null -> trasa 404), bo pusty urlset to błąd schematu.
    expect(xml).toBeNull();
  });
});
