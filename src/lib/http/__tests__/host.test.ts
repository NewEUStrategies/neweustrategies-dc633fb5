import { describe, expect, it } from "vitest";
import {
  CANONICAL_SITE_ORIGIN,
  classifyCrawlHost,
  crawlHostIsIndexable,
  crawlHostOrigin,
  isNonCanonicalPublicHost,
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

// Klasyfikacja hosta jest JEDNYM wejściem do decyzji "indeksować / na jakim
// originie" dla robots.txt i sitemapy. Rozjazd między nimi = duplikat treści w
// indeksie albo zaproszenie aliasu hostingu do indeksowania (audyt 2026-08-06).
describe("classifyCrawlHost", () => {
  it("recognises the brand hosts (apex + www, port and case irrelevant)", () => {
    expect(classifyCrawlHost({ host: "neweuropeanstrategies.com" })).toBe("brand");
    expect(classifyCrawlHost({ host: "WWW.NewEuropeanStrategies.com:443" })).toBe("brand");
  });

  it("recognises hosting aliases and preview hosts as never-indexable", () => {
    expect(classifyCrawlHost({ host: "nes.pages.dev" })).toBe("alias");
    expect(classifyCrawlHost({ host: "nes.workers.dev" })).toBe("alias");
    expect(classifyCrawlHost({ host: "localhost:4173" })).toBe("editor");
    expect(classifyCrawlHost({ host: "id-preview--abc.example" })).toBe("editor");
  });

  it("promotes a registered tenant domain to a canonical host of its own", () => {
    // REGRESJA: przed poprawką domena tenanta trafiała do "unknown", więc
    // robots.txt zakazywał indeksowania CAŁEGO serwisu tenanta, choć sitemapa
    // równolegle publikowała jego adresy.
    expect(classifyCrawlHost({ host: "tenant-b.eu", tenantDomain: true })).toBe("tenant");
    expect(classifyCrawlHost({ host: "tenant-b.eu" })).toBe("unknown");
  });

  it("keeps a hosting alias unindexable even if someone registers it as a domain", () => {
    expect(classifyCrawlHost({ host: "nes.pages.dev", tenantDomain: true })).toBe("alias");
    expect(classifyCrawlHost({ host: "localhost", tenantDomain: true })).toBe("editor");
  });

  it("fails closed without a host", () => {
    expect(classifyCrawlHost({ host: "" })).toBe("unknown");
    expect(classifyCrawlHost({ host: null })).toBe("unknown");
  });

  it("never opens indexing for a host the canonical redirect would 301", () => {
    // Inwariant międzymodułowy: `enforceCanonicalHost` przekierowuje każdy host
    // spełniający `isNonCanonicalPublicHost`. Host jednocześnie kanonizowany
    // 301 i ogłoszony jako indeksowalny to duplikat treści w indeksie.
    for (const host of ["nes.pages.dev", "nes.workers.dev"]) {
      expect(isNonCanonicalPublicHost(host), host).toBe(true);
      expect(crawlHostIsIndexable(classifyCrawlHost({ host, tenantDomain: true })), host).toBe(
        false,
      );
    }
  });

  it("opens indexing for canonical classes only", () => {
    expect(["brand", "tenant"].map((c) => crawlHostIsIndexable(c as "brand"))).toEqual([
      true,
      true,
    ]);
    expect(crawlHostIsIndexable("alias")).toBe(false);
    expect(crawlHostIsIndexable("editor")).toBe(false);
    expect(crawlHostIsIndexable("unknown")).toBe(false);
  });
});

describe("crawlHostOrigin", () => {
  it("converges the brand and its aliases on the canonical origin", () => {
    expect(crawlHostOrigin("brand", "www.neweuropeanstrategies.com")).toBe(CANONICAL_SITE_ORIGIN);
    expect(crawlHostOrigin("alias", "nes.pages.dev")).toBe(CANONICAL_SITE_ORIGIN);
  });

  it("publishes a tenant domain on its own origin", () => {
    expect(crawlHostOrigin("tenant", "tenant-b.eu")).toBe("https://tenant-b.eu");
    expect(crawlHostOrigin("editor", "localhost", "http")).toBe("http://localhost");
  });

  it("has no origin to publish without a host", () => {
    expect(crawlHostOrigin("unknown", "")).toBe("");
  });
});
