import { describe, expect, it } from "vitest";
import { isPreviewHost, normalizeHost, wwwToggledHost } from "@/lib/http/host";

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

  it("accepts platform preview domains", () => {
    expect(isPreviewHost("my-site.pages.dev")).toBe(true);
    expect(isPreviewHost("my-site.workers.dev")).toBe(true);
    expect(isPreviewHost("preview.lovable.app")).toBe(true);
    expect(isPreviewHost("abc123.lovableproject.com")).toBe(true);
  });

  it("rejects customer-looking domains and lookalikes", () => {
    expect(isPreviewHost("example.com")).toBe(false);
    expect(isPreviewHost("news.tenant-b.eu")).toBe(false);
    // Suffix match must include the dot - "evilpages.dev" is NOT *.pages.dev.
    expect(isPreviewHost("evilpages.dev")).toBe(false);
    expect(isPreviewHost("notlocalhost.com")).toBe(false);
    expect(isPreviewHost(null)).toBe(false);
  });
});
