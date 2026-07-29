import { describe, expect, it } from "vitest";
import {
  buildPremiumNewsletterRow,
  canAutoSubscribe,
  normalizeNewsletterLanguage,
  PREMIUM_NEWSLETTER_CONSENT,
} from "@/lib/billing/premiumNewsletter";

describe("premiumNewsletter", () => {
  it("normalizuje język do pl/en", () => {
    expect(normalizeNewsletterLanguage("en-GB")).toBe("en");
    expect(normalizeNewsletterLanguage("PL")).toBe("pl");
    expect(normalizeNewsletterLanguage(null)).toBe("pl");
  });

  it("buduje potwierdzony wiersz ze zgodą", () => {
    const row = buildPremiumNewsletterRow({
      tenantId: "t1",
      userId: "u1",
      email: "  Office@NES.com ",
      firstName: "Anna",
      lastName: "Nowak",
      language: "en",
      tierKey: "pro",
      subscriptionId: "sub_1",
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(row.email).toBe("office@nes.com");
    expect(row.language).toBe("en");
    expect(row.status).toBe("subscribed");
    expect(row.confirmed_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row.consents[0]).toMatchObject({ key: PREMIUM_NEWSLETTER_CONSENT, granted: true });
    expect(row.meta).toEqual({ tier: "pro", subscription_id: "sub_1" });
  });

  it("nie reaktywuje osoby, która się wypisała", () => {
    expect(canAutoSubscribe(null)).toBe(true);
    expect(canAutoSubscribe({ status: "subscribed" })).toBe(true);
    expect(canAutoSubscribe({ status: "unsubscribed" })).toBe(false);
    expect(canAutoSubscribe({ status: "subscribed", unsubscribed_at: "2026-01-01" })).toBe(false);
  });
});
