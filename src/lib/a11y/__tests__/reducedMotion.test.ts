import { afterEach, describe, expect, it, vi } from "vitest";
import { preferredScrollBehavior, prefersReducedMotion } from "@/lib/a11y/reducedMotion";

function stubMatchMedia(impl: ((query: string) => { matches: boolean }) | undefined) {
  vi.stubGlobal("matchMedia", impl);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("prefersReducedMotion", () => {
  it("zwraca true, gdy system prosi o ograniczenie ruchu", () => {
    const seen: string[] = [];
    stubMatchMedia((query) => {
      seen.push(query);
      return { matches: true };
    });
    expect(prefersReducedMotion()).toBe(true);
    expect(seen).toEqual(["(prefers-reduced-motion: reduce)"]);
  });

  it("zwraca false bez preferencji", () => {
    stubMatchMedia(() => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });

  it("bez matchMedia (stare WebView, SSR) zostawia ruch", () => {
    stubMatchMedia(undefined);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("wyjątek z matchMedia nie wywraca wołającego", () => {
    stubMatchMedia(() => {
      throw new Error("SecurityError");
    });
    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("preferredScrollBehavior", () => {
  it("skacze natychmiast przy ograniczonym ruchu", () => {
    stubMatchMedia(() => ({ matches: true }));
    expect(preferredScrollBehavior()).toBe("auto");
  });

  it("przewija płynnie bez preferencji", () => {
    stubMatchMedia(() => ({ matches: false }));
    expect(preferredScrollBehavior()).toBe("smooth");
  });
});
