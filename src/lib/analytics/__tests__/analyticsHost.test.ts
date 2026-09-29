import { afterEach, describe, expect, it } from "vitest";
import { ANALYTICS_ANY_HOST_FLAG, analyticsAllowedHere, isAnalyticsHost } from "../tagIds";
import { ga4SsrSnippet } from "../ga4Client";

describe("bramka hosta tagu Google", () => {
  afterEach(() => {
    Reflect.set(window, ANALYTICS_ANY_HOST_FLAG, true);
  });

  it("przepuszcza wyłącznie domenę produkcyjną", () => {
    expect(isAnalyticsHost("neweuropeanstrategies.com")).toBe(true);
    expect(isAnalyticsHost("www.neweuropeanstrategies.com")).toBe(true);
    expect(isAnalyticsHost("59b9e533-d5b0.lovableproject.com")).toBe(false);
    expect(isAnalyticsHost("id-preview--x.lovable.app")).toBe(false);
    expect(isAnalyticsHost("neweustrategies.lovable.app")).toBe(false);
    expect(isAnalyticsHost("neweuropeanstrategies.com.evil.io")).toBe(false);
    expect(isAnalyticsHost("localhost")).toBe(false);
  });

  it("bez flagi testowej localhost nie przekazuje danych", () => {
    Reflect.set(window, ANALYTICS_ANY_HOST_FLAG, false);
    expect(analyticsAllowedHere()).toBe(false);
  });

  it("snippet SSR na podglądzie nie tworzy gtag ani warstwy danych", () => {
    Reflect.set(window, ANALYTICS_ANY_HOST_FLAG, false);
    Reflect.deleteProperty(window, "dataLayer");
    Reflect.deleteProperty(window, "gtag");
    new Function(ga4SsrSnippet("G-TEST123", "AW-1"))();
    expect(Reflect.get(window, "dataLayer")).toBeUndefined();
    expect(Reflect.get(window, "gtag")).toBeUndefined();
  });
});
