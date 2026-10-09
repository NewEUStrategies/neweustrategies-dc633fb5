import { describe, expect, it } from "vitest";
import { isSearchCrawlerUserAgent } from "@/lib/http/searchCrawler";

describe("isSearchCrawlerUserAgent", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.71 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; Google-InspectionTool/1.0;)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
  ])("rozpoznaje crawler indeksujący: %s", (ua) => {
    expect(isSearchCrawlerUserAgent(ua)).toBe(true);
  });

  it.each([
    // Lighthouse / PSI: budżet wydajności musi mierzyć wariant czytelnika.
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "curl/8.5.0",
    "",
  ])("nie traktuje jako crawlera indeksującego: %s", (ua) => {
    expect(isSearchCrawlerUserAgent(ua)).toBe(false);
  });

  it("brak nagłówka to nie crawler indeksujący", () => {
    expect(isSearchCrawlerUserAgent(null)).toBe(false);
    expect(isSearchCrawlerUserAgent(undefined)).toBe(false);
  });
});
