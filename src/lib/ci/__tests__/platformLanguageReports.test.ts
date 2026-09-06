import { describe, expect, it } from "vitest";
import * as hardcoded from "../hardcodedLanguage";
import * as mono from "../monolingualUserText";

describe.each([
  ["bilingual literals", hardcoded.renderRatchetReport],
  ["monolingual UI", mono.renderRatchetReport],
] as const)("language gate diagnostics: %s", (_name, render) => {
  it("prints exact new and increased debt with file attribution", () => {
    const fresh = { fresh: [{ file: "new.tsx", count: 2 }], grown: [], improved: [], total: 2 };
    expect(render(fresh, 0)).toContain("new.tsx  (2)");
    const grown = {
      fresh: [],
      grown: [{ file: "old.tsx", was: 2, now: 3 }],
      improved: [],
      total: 3,
    };
    expect(render(grown, 1)).toContain("old.tsx: 2 -> 3");
    expect(render(grown, 1)).not.toContain("OK");
  });
  it("reports improvements separately while preserving a passing result", () => {
    expect(render({ fresh: [], grown: [], improved: [], total: 0 }, 0)).toContain("OK");
    const report = render(
      { fresh: [], grown: [], improved: [{ file: "cleaned.tsx", was: 2, now: 0 }], total: 0 },
      1,
    );
    expect(report).toContain("OK");
    expect(report).toContain("cleaned.tsx: 2 -> 0");
  });
});
