import { describe, it, expect, beforeEach } from "vitest";
import { isTourDismissed, dismissTour, resetTour } from "@/lib/onboarding/tourStorage";

describe("tourStorage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("a fresh tour id is not dismissed", () => {
    expect(isTourDismissed("builder")).toBe(false);
  });

  it("dismissTour persists and isTourDismissed reflects it", () => {
    dismissTour("builder");
    expect(isTourDismissed("builder")).toBe(true);
    // Stored under the versioned prefix.
    expect(window.localStorage.getItem("cms_onboarding:v1:builder")).toBe("1");
  });

  it("resetTour clears the dismissal", () => {
    dismissTour("blocks");
    expect(isTourDismissed("blocks")).toBe(true);
    resetTour("blocks");
    expect(isTourDismissed("blocks")).toBe(false);
  });

  it("distinct ids are independent", () => {
    dismissTour("builder");
    expect(isTourDismissed("builder")).toBe(true);
    expect(isTourDismissed("blocks")).toBe(false);
  });
});
