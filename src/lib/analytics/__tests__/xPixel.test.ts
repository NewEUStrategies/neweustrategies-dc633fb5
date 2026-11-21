import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));

import { configureXPixel, resetXPixel, trackXPageView, X_PIXEL_MARKER } from "../xPixelEvents";
import { extractXPixelId } from "../xPixelId";
import { MarketingConfigSchema } from "../config";

const SNIPPET = `<!-- X conversion tracking base code -->
<script>
!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);
},s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config','rjppz');
</script>`;

let calls: unknown[][] = [];

describe("X pixel ID", () => {
  it("accepts the bare pixel ID rjppz", () => {
    expect(extractXPixelId("rjppz")).toBe("rjppz");
    expect(extractXPixelId("  RJPPZ ")).toBe("rjppz");
  });
  it("reads the pixel ID from the full X base code", () => {
    expect(extractXPixelId(SNIPPET)).toBe("rjppz");
  });
  it("rejects garbage instead of loading a broken pixel", () => {
    expect(extractXPixelId("rj ppz")).toBe("");
    expect(extractXPixelId("<script>alert(1)</script>")).toBe("");
  });
  it("settings keep only the ID and default to no X pixel", () => {
    expect(MarketingConfigSchema.parse({}).x_pixel_id).toBe("");
    expect(MarketingConfigSchema.parse({ x_pixel_id: SNIPPET }).x_pixel_id).toBe("rjppz");
    expect(MarketingConfigSchema.parse({ x_pixel_id: 42 }).x_pixel_id).toBe("");
  });
});

describe("X pixel SPA page views", () => {
  beforeEach(() => {
    consent.marketing = true;
    calls = [];
    resetXPixel();
    window.history.replaceState({}, "", "/");
    (window as Window & { twq?: unknown }).twq = (...args: unknown[]) => {
      calls.push(args);
    };
  });
  afterEach(() => {
    delete (window as Window & { twq?: unknown }).twq;
  });

  it("does not resend the landing page counted by the base code", () => {
    configureXPixel("rjppz");
    expect(trackXPageView("/")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("counts each router move once with twq('config', id)", () => {
    configureXPixel("rjppz");
    expect(trackXPageView("/analizy")).toBe(true);
    expect(trackXPageView("/analizy/")).toBe(false);
    expect(trackXPageView("/wydarzenia")).toBe(true);
    expect(calls).toEqual([
      ["config", "rjppz"],
      ["config", "rjppz"],
    ]);
  });

  it("sends nothing without marketing consent", () => {
    configureXPixel("rjppz");
    consent.marketing = false;
    expect(trackXPageView("/analizy")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("sends nothing after consent is withdrawn and clears the marker", () => {
    configureXPixel("rjppz");
    (window as Window & { [X_PIXEL_MARKER]?: unknown })[X_PIXEL_MARKER] = "rjppz";
    resetXPixel();
    expect(trackXPageView("/analizy")).toBe(false);
    expect((window as Window & { [X_PIXEL_MARKER]?: unknown })[X_PIXEL_MARKER]).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
