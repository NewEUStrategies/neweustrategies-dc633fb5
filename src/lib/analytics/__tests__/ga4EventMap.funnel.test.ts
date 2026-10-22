// Nazwy GA4 kroków lejka czytelnika (S3, P18): rekomendowane tam, gdzie GA4
// ma odpowiednik (rejestracja, logowanie, lista ofert, rozpoczęcie kasy),
// własne - po sanityzacji - dla kroków paywalla.
import { describe, expect, it } from "vitest";
import { ga4EventName } from "@/lib/analytics/ga4EventMap";

describe("ga4EventMap - lejek czytelnika", () => {
  it.each([
    ["signup_completed", "sign_up"],
    ["login_completed", "login"],
    ["newsletter_signup", "join_group"],
    ["pricing_view", "view_item_list"],
    ["checkout_submit", "begin_checkout"],
    ["paywall_view", "paywall_view"],
    ["paywall_cta_click", "paywall_cta_click"],
    ["checkout_view", "checkout_view"],
    ["pricing_audience_change", "pricing_audience_change"],
  ])("%s -> %s", (internal, ga4) => {
    expect(ga4EventName(internal)).toBe(ga4);
  });
});
