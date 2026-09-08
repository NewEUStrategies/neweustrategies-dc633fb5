// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MODULES, classifyPath } from "../../../../scripts/taxonomy/moduleMap.mjs";
import frozen from "../../../../governance/platform-coverage-scope.json";
import { platformCoverageFiles } from "../../../../scripts/lib/platformCoverageScope";

describe("module taxonomy preserves real route families", () => {
  it.each([
    ["src/routes/post.$slug.tsx", 1],
    ["src/routes/preview.$postId.tsx", 1],
    ["src/routes/admin.toc.tsx", 1],
    ["src/routes/admin.posts.index.tsx", 2],
    ["src/routes/admin.versions.tsx", 2],
    ["src/lib/content.functions.ts", 3],
    ["src/routes/admin.appearance.tsx", 4],
    ["src/routes/admin.crop-sizes.tsx", 4],
    ["src/routes/category.$slug.tsx", 5],
  ] as const)("%s belongs to module %i", (file, module) => {
    expect(classifyPath(file).module).toBe(module);
  });
  it("rejects double-escaped regex literals", () => {
    expect(
      MODULES.flatMap((mod) =>
        mod.patterns.filter((pattern) => pattern.source.includes(String.raw`\\.`)),
      ),
    ).toEqual([]);
  });
  it("retains every audited file and includes new platform helpers", () => {
    const files = new Set(platformCoverageFiles());
    for (const file of frozen.files) expect(files.has(file), file).toBe(true);
    expect(files.has("src/lib/http/frameworkPreloads.server.ts")).toBe(true);
    expect(files.has("src/lib/ssr/chromeWarmup.tsx")).toBe(true);
    expect(files.has("src/lib/ci/platformCoverage.ts")).toBe(true);
    expect([...files].some((file) => file.includes("__tests__") || /\.test\./.test(file))).toBe(
      false,
    );
  });
});
