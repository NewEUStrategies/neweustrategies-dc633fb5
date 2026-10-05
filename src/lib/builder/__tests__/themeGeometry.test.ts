import { describe, expect, it } from "vitest";
import { pickShared } from "@/lib/builder/themed";

describe("pickShared", () => {
  it("preferuje light i używa dark tylko jako wartości zastępczej", () => {
    expect(pickShared({ light: "wspólna", dark: "stara" })).toBe("wspólna");
    expect(pickShared({ dark: "zastępcza" })).toBe("zastępcza");
    expect(pickShared("płaska")).toBe("płaska");
  });
});