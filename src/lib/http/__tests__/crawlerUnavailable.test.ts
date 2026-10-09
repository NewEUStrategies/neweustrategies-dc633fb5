// Strona główna bez treści dla crawlera indeksującego -> 503 (zgłoszenie
// 2026-10-09). Odpowiedź ma zachować strumieniowane body i nagłówki
// dokumentu, a dołożyć sygnał chwilowej niedostępności i wykluczenie z cache.
import { describe, expect, it } from "vitest";
import {
  CRAWLER_RETRY_AFTER_SECONDS,
  crawlerUnavailableResponse,
} from "@/lib/http/crawlerUnavailable";
import { documentStorePolicy } from "@/lib/http/documentCache";

describe("crawlerUnavailableResponse", () => {
  it("zamienia status na 503 z Retry-After, zachowując body i nagłówki dokumentu", async () => {
    const source = new Response("<!doctype html><h1>New European Strategies</h1>", {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-robots-tag": "all",
      },
    });
    const res = crawlerUnavailableResponse(source);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(String(CRAWLER_RETRY_AFTER_SECONDS));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("x-robots-tag")).toBe("all");
    expect(await res.text()).toContain("New European Strategies");
  });

  it("503 nigdy nie trafia do NES Edge Cache", () => {
    const res = crawlerUnavailableResponse(
      new Response("x", { headers: { "content-type": "text/html" } }),
    );
    expect(
      documentStorePolicy(res.status, res.headers.get("content-type"), "public, s-maxage=900")
        .store,
    ).toBe(false);
  });
});
