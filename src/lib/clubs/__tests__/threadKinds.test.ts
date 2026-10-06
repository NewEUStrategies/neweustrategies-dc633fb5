import { describe, expect, it } from "vitest";
import { CLUB_THREAD_KINDS, parseClubThreadKind } from "../threadKinds";

describe("club content navigation", () => {
  it.each(["announcement", "discussion", "question", "poll", "position", "resource"])(
    "accepts the %s content tile filter",
    (kind) => expect(parseClubThreadKind(kind)).toBe(kind),
  );

  it("rejects unknown or malformed filters", () => {
    for (const value of ["insights", "unknown", "", null, undefined, ["poll"], 1]) {
      expect(parseClubThreadKind(value)).toBeNull();
    }
    expect(CLUB_THREAD_KINDS).toHaveLength(6);
  });
});
