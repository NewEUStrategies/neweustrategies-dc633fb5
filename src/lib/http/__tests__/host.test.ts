import { describe, expect, it } from "vitest";
import {
  CANONICAL_SITE_ORIGIN,
  crawlerPublishOrigin,
  isPreviewHost,
  normalizeHost,
  wwwToggledHost,
} from "@/lib/http/host";

describe("normalizeHost", () => {
  it("lowercases and trims", () => {
    expect(normalizeHost("  Example.COM ")).toBe("example.com");
  });

  it("strips the port", () => {
    expect(normalizeHost("example.com:8443")).toBe("example.com");
    expect(normalizeHost("localhost:5173")).toBe("localhost");
  });

  it("unwraps IPv6 brackets and keeps the literal", () => {
    expect(normalizeHost("[::1]:8080")).toBe("::1");
    expect(normalizeHost("[2001:db8::1]")).toBe("2001:db8::1");
  });

  it("returns null for empty-ish input", () => {
    expect(normalizeHost(null)).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost("   ")).toBeNull();
    expect(normalizeHost(":443")).toBeNull();
  });
});

describe("wwwToggledHost", () => {
  it("maps apex to www and back", () => {
    expect(wwwToggledHost("example.com")).toBe("www.example.com");
    expect(wwwToggledHost("www.example.com")).toBe("example.com");
  });
});

describe("isPreviewHost", () => {
  it("accepts local dev hosts (with ports)", () => {
    expect(isPreviewHost("localhost:5173")).toBe(true);
    expect(isPreviewHost("127.0.0.1")).toBe(true);
    expect(isPreviewHost("[::1]:8080")).toBe(true);
    expect(isPreviewHost("app.localhost")).toBe(true);
  });

  it("accepts the hosting layer's preview domains", () => {
    expect(isPreviewHost("my-site.pages.dev")).toBe(true);
    expect(isPreviewHost("my-site.workers.dev")).toBe(true);
  });

  it("rejects customer-looking domains and lookalikes", () => {
    expect(isPreviewHost("example.com")).toBe(false);
    expect(isPreviewHost("news.tenant-b.eu")).toBe(false);
    // Suffix match must include the dot - "evilpages.dev" is NOT *.pages.dev.
    expect(isPreviewHost("evilpages.dev")).toBe(false);
    expect(isPreviewHost("notlocalhost.com")).toBe(false);
    expect(isPreviewHost(null)).toBe(false);
  });

  it("does NOT hardcode a vendor's preview domain", () => {
    // Domena podglądu konkretnego dostawcy jest wpisem ALLOWLISTY istotnym dla
    // bezpieczeństwa (poszerza fail-open planu crawlera i rozluźnia CSP), więc
    // należy do konfiguracji wdrożenia (`PREVIEW_HOST_SUFFIXES`), nie do kodu.
    expect(isPreviewHost("preview.lovable.app")).toBe(false);
    expect(isPreviewHost("abc123.lovableproject.com")).toBe(false);
  });

  it("nieznana domena produkcyjna nigdy nie jest podglądem", () => {
    expect(isPreviewHost("neweuropeanstrategies.com")).toBe(false);
    expect(isPreviewHost("www.neweuropeanstrategies.com")).toBe(false);
  });
});

describe("crawlerPublishOrigin", () => {
  // JEDNA reguła originu dla mapy strony i dla robots.txt: mapa i jej ogłoszenie
  // muszą wskazywać ten sam origin, inaczej Search Console odrzuca mapę jako
  // pochodzącą spoza właściwości.
  it("zbiera hosty marki na originie kanonicznym", () => {
    expect(crawlerPublishOrigin("neweuropeanstrategies.com")).toBe(CANONICAL_SITE_ORIGIN);
    expect(crawlerPublishOrigin("www.neweuropeanstrategies.com")).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("aliasy hostingu publikują adresy kanoniczne (dostają 301, nie wolno ich indeksować)", () => {
    expect(crawlerPublishOrigin("nes.pages.dev")).toBe(CANONICAL_SITE_ORIGIN);
    expect(crawlerPublishOrigin("nes.workers.dev")).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("własna domena tenanta publikuje na SWOIM originie", () => {
    expect(crawlerPublishOrigin("b.example")).toBe("https://b.example");
    expect(crawlerPublishOrigin("www.b.example")).toBe("https://www.b.example");
  });

  it("honoruje protokół żądania i normalizuje hosta", () => {
    expect(crawlerPublishOrigin("127.0.0.1:4173", "http")).toBe("http://127.0.0.1");
    expect(crawlerPublishOrigin("B.EXAMPLE")).toBe("https://b.example");
  });

  it("bez hosta nie zmyśla originu", () => {
    expect(crawlerPublishOrigin(null)).toBe("");
    expect(crawlerPublishOrigin("")).toBe("");
  });
});
