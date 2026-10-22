// Sukces zapisu na newsletter jako krok lejka (S3, P18): zdarzenie DOM
// ogłaszane PO odpowiedzi serwera (bąbelkuje do korzenia stopki) i kanoniczne
// `newsletter_signup` za bramką zgody `track()`.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("@/lib/analytics/track", () => ({ track: h.track }));
vi.mock("@/lib/ads/consent", () => ({ hasAnalyticsConsent: () => true }));

import {
  NEWSLETTER_SUBSCRIBED_EVENT,
  announceNewsletterSubscribed,
  trackNewsletterSignup,
  type NewsletterSubscribedDetail,
} from "@/lib/analytics/footerTracking";

beforeEach(() => h.track.mockReset());

describe("footerTracking - sukces zapisu (P18)", () => {
  it("ogłoszenie bąbelkuje z formularza do korzenia stopki ze źródłem", () => {
    const root = document.createElement("footer");
    const form = document.createElement("form");
    root.appendChild(form);
    document.body.appendChild(root);
    const heard: NewsletterSubscribedDetail[] = [];
    root.addEventListener(NEWSLETTER_SUBSCRIBED_EVENT, (event) => {
      heard.push((event as CustomEvent<NewsletterSubscribedDetail>).detail);
    });
    announceNewsletterSubscribed(form, "footer");
    expect(heard).toEqual([{ source: "footer" }]);
    root.remove();
  });

  it("newsletter_signup: typ = nazwa, źródło w meta i w identyfikatorze", () => {
    trackNewsletterSignup("footer", { form_id: "nl" });
    expect(h.track).toHaveBeenCalledWith({
      type: "newsletter_signup",
      name: "newsletter_signup",
      entityType: "cta",
      entityId: "newsletter_footer",
      meta: { source: "footer", form_id: "nl" },
    });
  });
});
