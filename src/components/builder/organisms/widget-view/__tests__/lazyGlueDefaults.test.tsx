// Domyślne zachowanie „kleju" podziału kodu widgetów.
//
// Co udowadniamy i dlaczego:
//   * LazyFallback: shimmer zastępczy istnieje WYŁĄCZNIE w kanwie buildera. Na
//     stronie publicznej granicę Suspense wypełnia HTML z serwera - shimmer
//     w tym miejscu dawałby skok układu i rozjazd HTML serwera z hydratacją.
//   * warmCommonWidgetChunks bez wstrzykniętego `defer` czeka na `load` strony
//     z limitem 4 s (afterPageLoad) i do tego czasu nie importuje żadnego
//     chunku - rozgrzewanie nie może konkurować z zasobami pierwszego widoku.
//
// Granice: `afterPageLoad` -> szpieg (zegar i zdarzenie load są poza testem);
// BuilderModeProvider prawdziwy.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BuilderModeProvider } from "@/lib/content-model/editorCanvas";

const afterPageLoad = vi.hoisted(() => vi.fn());
vi.mock("@/lib/performance/afterPageLoad", () => ({ afterPageLoad }));

import { LazyFallback } from "../lazySuspense";
import { warmCommonWidgetChunks, resetWarmWidgetChunksForTests } from "../warmWidgetChunks";

afterEach(() => {
  cleanup();
  resetWarmWidgetChunksForTests();
  afterPageLoad.mockReset();
});

describe("LazyFallback", () => {
  it("na stronie publicznej nie renderuje niczego", () => {
    const { container } = render(<LazyFallback />);
    expect(container.innerHTML).toBe("");
  });

  it("w kanwie buildera pokazuje ukryty dla czytników shimmer", () => {
    const { container } = render(
      <BuilderModeProvider mode="light">
        <LazyFallback />
      </BuilderModeProvider>,
    );
    const shimmer = container.querySelector("[data-lazy-widget-fallback]");
    expect(shimmer).not.toBeNull();
    expect(shimmer?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("warmCommonWidgetChunks - domyślne odroczenie", () => {
  it("czeka na load strony z limitem 4 s i niczego nie importuje przed czasem", () => {
    warmCommonWidgetChunks();
    expect(afterPageLoad).toHaveBeenCalledOnce();
    expect(afterPageLoad).toHaveBeenCalledWith(expect.any(Function), 4000);
    // Drugie wywołanie w tej samej sesji jest bezkosztowe.
    warmCommonWidgetChunks();
    expect(afterPageLoad).toHaveBeenCalledOnce();
  });
});
