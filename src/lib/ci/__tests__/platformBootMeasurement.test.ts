import { describe, expect, it } from "vitest";
import { staticBootAssets } from "../../../../scripts/lib/staticBootAssets";

describe("production boot measurement follows emitted module ownership", () => {
  const chunks = [
    { file: "assets/entry.js", imports: ["assets/vendor.js"], dynamicImports: ["assets/lazy.js"] },
    { file: "assets/vendor.js", imports: [] },
    { file: "assets/lazy.js", imports: [] },
  ];
  it("includes entry and static dependencies without labeling lazy imports static", () => {
    expect(staticBootAssets(chunks, ["http://localhost:4181/assets/entry.js"])).toEqual([
      "/assets/entry.js",
      "/assets/vendor.js",
    ]);
  });
  it("deduplicates shared imports and terminates even if the graph contains a cycle", () => {
    expect(
      staticBootAssets(
        [
          { file: "/assets/a.js", imports: ["/assets/b.js"] },
          { file: "assets/b.js", imports: ["assets/a.js"] },
        ],
        ["/assets/a.js", "/assets/b.js"],
      ),
    ).toEqual(["/assets/a.js", "/assets/b.js"]);
  });
  it("fails if the build inventory does not describe the document being measured", () => {
    expect(() => staticBootAssets(chunks, [])).toThrow("no module entry");
    expect(() => staticBootAssets(chunks, ["/assets/stale.js"])).toThrow(
      "missing from build inventory",
    );
    expect(() =>
      staticBootAssets(
        [{ file: "assets/entry.js", imports: ["assets/missing.js"] }],
        ["/assets/entry.js"],
      ),
    ).toThrow("missing.js");
  });
});
