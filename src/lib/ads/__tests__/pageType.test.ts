// Mapowanie lokalizacji -> typ strony reklamowej (baner nagłówka w SiteChrome).
import { describe, expect, it } from "vitest";
import { adPageTypeForLocation } from "../pageType";

describe("adPageTypeForLocation", () => {
  it("maps the homepage in both languages", () => {
    expect(adPageTypeForLocation("/", null)).toBe("home");
    expect(adPageTypeForLocation("/en", null)).toBe("home");
    expect(adPageTypeForLocation("/en/", null)).toBe("home");
  });

  it("maps blog and publications to the archive type", () => {
    expect(adPageTypeForLocation("/blog", null)).toBe("archive");
    expect(adPageTypeForLocation("/en/blog", null)).toBe("archive");
    expect(adPageTypeForLocation("/publications", null)).toBe("archive");
  });

  it("maps taxonomy archives and search", () => {
    expect(adPageTypeForLocation("/category/bezpieczenstwo", null)).toBe("category");
    expect(adPageTypeForLocation("/en/tag/energy", null)).toBe("tag");
    expect(adPageTypeForLocation("/search", null)).toBe("search");
  });

  it("uses the catch-all loader kind for posts and pages", () => {
    expect(adPageTypeForLocation("/analiza-baltyku", "post")).toBe("post");
    expect(adPageTypeForLocation("/o-nas", "page")).toBe("page");
  });

  it("falls back to all for unknown locations without content kind", () => {
    expect(adPageTypeForLocation("/podcasty", null)).toBe("all");
    expect(adPageTypeForLocation("/author/anna", null)).toBe("all");
  });

  // Front wydarzenia jest PODDRZEWEM STRON, więc bez własnego warunku każde
  // wydarzenie zgłaszałoby się jako "page" (loader catch-all zwraca kind "page")
  // i placement zawężony do wydarzeń nie wyrenderowałby się nigdy. Dlatego
  // ścieżka wydarzenia wygrywa nad rozstrzygnięciem po rodzaju treści -
  // zadanie EB-937, migracja 20260823170000.
  it("maps the event front to its own page type, also under the language prefix", () => {
    expect(adPageTypeForLocation("/events", null)).toBe("event");
    expect(adPageTypeForLocation("/events/nes-forum-2026", null)).toBe("event");
    expect(adPageTypeForLocation("/en/events/nes-forum-2026", null)).toBe("event");
    expect(adPageTypeForLocation("/events/nes-forum-2026", "page")).toBe("event");
  });

  it("does not confuse lookalike prefixes with language or section paths", () => {
    // /ente... nie jest ścieżką /en/..., a /blogosfera nie jest /blog.
    expect(adPageTypeForLocation("/ente", null)).toBe("all");
    expect(adPageTypeForLocation("/blogosfera", "page")).toBe("page");
    // /eventsy nie jest /events/ - prefiks musi kończyć się granicą segmentu.
    expect(adPageTypeForLocation("/eventsy", "page")).toBe("page");
  });
});
