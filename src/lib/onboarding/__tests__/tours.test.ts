import { describe, it, expect } from "vitest";
import { BUILDER_TOUR_STEPS, BLOCK_TOUR_STEPS } from "@/lib/onboarding/tours";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";

// Walk a dotted key path ("admin.onboarding.builder.widgets.title") through a
// nested dictionary object, returning the string leaf or undefined.
function resolve(dict: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, dict);
}

const ALL_STEPS = [...BUILDER_TOUR_STEPS, ...BLOCK_TOUR_STEPS];

describe("onboarding tours", () => {
  it("every step references a title/body key that resolves to a non-empty string in PL and EN", () => {
    for (const step of ALL_STEPS) {
      for (const key of [step.titleKey, step.bodyKey]) {
        const plVal = resolve(pl, key);
        const enVal = resolve(en, key);
        expect(typeof plVal, `PL missing: ${key}`).toBe("string");
        expect((plVal as string).length, `PL empty: ${key}`).toBeGreaterThan(0);
        expect(typeof enVal, `EN missing: ${key}`).toBe("string");
        expect((enVal as string).length, `EN empty: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("resolves the shared common keys in both languages", () => {
    for (const key of [
      "admin.onboarding.common.next",
      "admin.onboarding.common.back",
      "admin.onboarding.common.skip",
      "admin.onboarding.common.done",
      "admin.onboarding.common.stepOf",
      "admin.onboarding.common.close",
    ]) {
      expect(typeof resolve(pl, key), `PL missing: ${key}`).toBe("string");
      expect(typeof resolve(en, key), `EN missing: ${key}`).toBe("string");
    }
  });

  it("uses namespaced anchors so the two tours never spotlight each other", () => {
    expect(BUILDER_TOUR_STEPS.every((s) => s.anchor?.startsWith("builder-"))).toBe(true);
    expect(BLOCK_TOUR_STEPS.every((s) => s.anchor?.startsWith("blocks-"))).toBe(true);
  });
});
