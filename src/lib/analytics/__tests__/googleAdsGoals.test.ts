import { afterEach, describe, expect, it } from "vitest";
import { MarketingConfigSchema } from "../config";
import {
  configureGoogleAds,
  extractGoogleAdsId,
  extractGoogleAdsLabel,
  googleAdsId,
  googleAdsLabel,
  resetGoogleAdsConfig,
} from "../googleAdsGoals";
import { adsSendTo } from "../conversions";
import { DEFAULT_PIXELS_TAB, parsePixelsTab } from "@/lib/admin/pixelsTabs";

afterEach(() => resetGoogleAdsConfig());

describe("Google Ads settings (Pixels -> Google Ads)", () => {
  it("keeps account 251-385-9854 tag and conversions when nothing is saved yet", () => {
    const cfg = MarketingConfigSchema.parse({ meta_pixel_id: "1" });
    expect(cfg.google_ads_id).toBe("AW-17612160320");
    expect(cfg.google_ads_conversions.contact_form).toBe("p9kvCLTkwbwdEMD6kM5B");
    expect(cfg.google_ads_conversions.purchase).toBe("n02PCIG0wLwdEMD6kM5B");
  });

  it("turns a conversion off when the admin clears its field", () => {
    const cfg = MarketingConfigSchema.parse({ google_ads_conversions: { newsletter: "" } });
    expect(cfg.google_ads_conversions.newsletter).toBe("");
    expect(cfg.google_ads_conversions.contact_form).toBe("p9kvCLTkwbwdEMD6kM5B");
  });

  it("reads the label from a pasted event snippet and rejects a bare tag ID", () => {
    const snippet = "gtag('event', 'conversion', {'send_to': 'AW-17612160320/Ab-Cd_123'});";
    expect(extractGoogleAdsLabel(snippet)).toBe("Ab-Cd_123");
    expect(extractGoogleAdsLabel("AW-17612160320")).toBe("");
  });

  it("accepts the tag ID as digits or AW- and rejects anything else", () => {
    expect(extractGoogleAdsId("17612160320")).toBe("AW-17612160320");
    expect(extractGoogleAdsId("aw-17612160320")).toBe("AW-17612160320");
    expect(extractGoogleAdsId("G-EN05JH34VP")).toBe("");
    expect(extractGoogleAdsId("AW-17612160320-typo")).toBe("");
    expect(extractGoogleAdsId("gtag('config', 'AW-17612160320');")).toBe("AW-17612160320");
  });

  it("sends conversions to the tag and label saved in the panel", () => {
    configureGoogleAds({ id: "AW-123456789", labels: { contact_form: "NewLabel1" } });
    expect(googleAdsId()).toBe("AW-123456789");
    expect(adsSendTo(googleAdsLabel("contact_form"))).toBe("AW-123456789/NewLabel1");
  });

  it("sends no Google Ads conversion when the tag ID is cleared", () => {
    configureGoogleAds({ id: "", labels: { contact_form: "NewLabel1" } });
    expect(adsSendTo(googleAdsLabel("contact_form"))).toBe("");
  });

  it("opens the Pixels page on the Google Ads tab", () => {
    expect(DEFAULT_PIXELS_TAB).toBe("google");
    expect(parsePixelsTab("google")).toBe("google");
  });
});
