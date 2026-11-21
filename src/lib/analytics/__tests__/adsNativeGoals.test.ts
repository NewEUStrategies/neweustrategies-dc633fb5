import { beforeEach, describe, expect, it, vi } from "vitest";

const consent = vi.hoisted(() => ({ marketing: true }));
const sent = vi.hoisted(() => ({ labels: [] as string[] }));
vi.mock("@/lib/ads/consent", () => ({
  hasCategoryConsent: (cat: string) => (cat === "marketing" ? consent.marketing : true),
}));
const mirror = vi.hoisted(() => ({ kinds: [] as string[] }));
vi.mock("../adPixelTelemetry", () => ({
  recordAdPixelConversion: (kind: string) => {
    mirror.kinds.push(kind);
  },
}));
const linkedin = vi.hoisted(() => ({ goals: [] as string[] }));
vi.mock("../linkedinInsightEvents", () => ({
  trackLinkedInGoal: (goal: string) => {
    linkedin.goals.push(goal);
    return true;
  },
}));
vi.mock("../conversions", () => ({
  adsConversion: (label: string) => {
    sent.labels.push(label);
  },
}));

import { ADS_GOAL_LABELS, trackAdsGoal } from "../adsNativeGoals";

describe("trackAdsGoal", () => {
  beforeEach(() => {
    consent.marketing = true;
    sent.labels = [];
    mirror.kinds = [];
    linkedin.goals = [];
  });

  it("sends the same confirmed outcome to LinkedIn Ads and the admin panel mirror once", () => {
    trackAdsGoal("club_application");
    trackAdsGoal("contact_form");
    expect(linkedin.goals).toEqual(["club_application", "contact_form"]);
    expect(mirror.kinds).toEqual(["club_application", "form_submit"]);
  });

  it("maps each outcome to its Google Ads action label", () => {
    expect(ADS_GOAL_LABELS).toEqual({
      contact_form: "p9kvCLTkwbwdEMD6kM5B",
      club_application: "7VqPCLfkwbwdEMD6kM5B",
      account_signup: "I7B9CLrkwbwdEMD6kM5B",
      newsletter: "YsEPCL3kwbwdEMD6kM5B",
      event_registration: "zi3kCMDkwbwdEMD6kM5B",
    });
  });

  it("reports a confirmed newsletter sign-up once", () => {
    expect(trackAdsGoal("newsletter")).toBe(true);
    expect(sent.labels).toEqual(["YsEPCL3kwbwdEMD6kM5B"]);
  });

  it("sends nothing without marketing consent", () => {
    consent.marketing = false;
    expect(trackAdsGoal("contact_form")).toBe(false);
    expect(sent.labels).toHaveLength(0);
    expect(linkedin.goals).toHaveLength(0);
    expect(mirror.kinds).toHaveLength(0);
  });
});
