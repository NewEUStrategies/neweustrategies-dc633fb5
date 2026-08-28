import { describe, expect, it } from "vitest";

import {
  AUDIENCE_GRANT_ACTIONS,
  audienceGrantAction,
  historyValueText,
} from "@/lib/events/audienceGrantsApi";

describe("audienceGrantAction", () => {
  it("maps namespaced audit actions to the four known verbs", () => {
    expect(audienceGrantAction("event_audience_grant.granted")).toBe("granted");
    expect(audienceGrantAction("event_audience_grant.revoked")).toBe("revoked");
    expect(audienceGrantAction("event_audience_grant.restored")).toBe("restored");
  });

  it("degrades unknown verbs to 'updated' instead of throwing", () => {
    expect(audienceGrantAction("event_audience_grant.reindexed")).toBe("updated");
    expect(audienceGrantAction("")).toBe("updated");
  });

  it("keeps the catalogue in sync with the badge mapping", () => {
    expect([...AUDIENCE_GRANT_ACTIONS]).toEqual([
      "granted",
      "updated",
      "revoked",
      "restored",
    ]);
  });
});

describe("historyValueText", () => {
  it("renders empty text for missing values so the diff stays readable", () => {
    expect(historyValueText(undefined)).toBe("");
    expect(historyValueText(null)).toBe("");
  });

  it("renders scalars verbatim and objects as JSON", () => {
    expect(historyValueText("academic")).toBe("academic");
    expect(historyValueText(12)).toBe("12");
    expect(historyValueText(true)).toBe("true");
    expect(historyValueText({ a: 1 })).toBe('{"a":1}');
  });
});
