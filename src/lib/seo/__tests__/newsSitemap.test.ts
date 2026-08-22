import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNewsSitemapXml,
  freshNewsEntries,
  NEWS_SITEMAP_WINDOW_MS,
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
  it("produces a valid empty urlset on a quiet news day", () => {
    const xml = buildNewsSitemapXml({ publicationName: "NES", entries: [entry(100)], now: NOW });
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<url>");
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
    // Google News odrzuca kanał z datą publikacji w przyszłości - lepiej pusty
    // urlset niż wpis, który psuje walidację całego pliku.
    expect(xml).not.toContain("<url>");
  });
});
