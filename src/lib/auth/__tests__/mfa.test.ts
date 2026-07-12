import { describe, it, expect } from "vitest";
import { toQrDataUri } from "@/lib/auth/mfa";

// Pure QR-normalisation guard. The other mfa.ts helpers are thin wrappers over
// supabase.auth.mfa.* (network) and are exercised by the manual checklist.
describe("toQrDataUri", () => {
  it("wraps raw SVG markup as an svg data URI", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(toQrDataUri(svg)).toBe(`data:image/svg+xml;utf-8,${encodeURIComponent(svg)}`);
  });

  it("passes through values that are already data URIs", () => {
    const uri = "data:image/svg+xml;utf-8,%3Csvg%3E%3C/svg%3E";
    expect(toQrDataUri(uri)).toBe(uri);
  });
});
