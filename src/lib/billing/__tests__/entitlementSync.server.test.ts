import { describe, expect, it } from "vitest";
import { mapProviderStatus } from "@/lib/billing/entitlementSync.server";

const now = new Date("2026-07-29T12:00:00Z");
const future = "2026-08-29T12:00:00Z";
const past = "2026-06-29T12:00:00Z";

describe("mapProviderStatus", () => {
  it("keeps access for active, trialing and past_due", () => {
    expect(mapProviderStatus("active", future, now)).toBe("active");
    expect(mapProviderStatus("trialing", future, now)).toBe("active");
    expect(mapProviderStatus("past_due", future, now)).toBe("active");
  });

  it("keeps canceled subscription until the paid period ends", () => {
    expect(mapProviderStatus("canceled", future, now)).toBe("active");
    expect(mapProviderStatus("canceled", past, now)).toBe("canceled");
    expect(mapProviderStatus("canceled", null, now)).toBe("canceled");
  });

  it("revokes access when paused or unknown", () => {
    expect(mapProviderStatus("paused", future, now)).toBe("canceled");
    expect(mapProviderStatus("whatever", future, now)).toBe("canceled");
  });
});
