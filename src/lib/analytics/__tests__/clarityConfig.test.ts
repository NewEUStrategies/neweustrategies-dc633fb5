import { describe, expect, it } from "vitest";
import { AnalyticsConfigSchema } from "../config";

describe("AnalyticsConfigSchema.clarity_project_id", () => {
  it("keeps a valid Clarity project ID, lower-cased", () => {
    expect(AnalyticsConfigSchema.parse({ clarity_project_id: " R42361I7E2 " }).clarity_project_id).toBe(
      "r42361i7e2",
    );
  });

  it("drops a malformed ID without breaking the rest of the analytics settings", () => {
    const parsed = AnalyticsConfigSchema.parse({
      gtm_container_id: "GTM-MF34R99",
      clarity_project_id: "<script>",
    });
    expect(parsed.clarity_project_id).toBe("");
    expect(parsed.gtm_container_id).toBe("GTM-MF34R99");
  });
});
