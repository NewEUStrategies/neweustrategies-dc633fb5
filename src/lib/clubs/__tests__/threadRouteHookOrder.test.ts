import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("club thread route hook order", () => {
  it("mounts composer hooks before the loading early return", () => {
    const source = readFileSync("src/routes/club.$clubSlug.t.$threadSlug.tsx", "utf8");
    const composerHook = source.indexOf("const composerRef = useRef<HTMLElement | null>(null)");
    const loadingReturn = source.indexOf(
      "if (clubQ.isPending || (club !== null && threadQ.isPending))",
    );

    expect(composerHook).toBeGreaterThan(-1);
    expect(loadingReturn).toBeGreaterThan(-1);
    expect(composerHook).toBeLessThan(loadingReturn);
  });
});
