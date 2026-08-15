// TocWidget: interakcje, których nie domyka test podstawowy - kliknięcia
// pozycji w wariantach grid i sidebar (własne handlery onClick per wariant),
// scrollToId dla kotwicy bez elementu docelowego (wczesny return) oraz
// aktualizacja paska postępu czytania na zdarzeniu scroll (ścieżka RAF).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { TocWidget } from "../TocWidget";
import type { WidgetContent } from "@/lib/builder/types";

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function renderWidget(content: WidgetContent) {
  return render(<TocWidget content={content} lang="pl" />);
}

/** Nagłówek-cel w treści strony, do którego kotwica ma doscrollować. */
function mountTarget(id: string): void {
  const h = document.createElement("h2");
  h.id = id;
  h.textContent = id;
  document.body.appendChild(h);
}

describe("TocWidget - kliknięcia w wariantach grid i sidebar", () => {
  it("grid: scrolls to the target and rewrites the hash", () => {
    mountTarget("sekcja-grid");
    renderWidget({ variant: "grid", items_pl: ["#sekcja-grid | Sekcja Grid"] });

    fireEvent.click(screen.getByRole("link", { name: /Sekcja Grid/ }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#sekcja-grid");
  });

  it("sidebar: scrolls to the target and rewrites the hash", () => {
    mountTarget("sekcja-side");
    renderWidget({ variant: "sidebar", items_pl: ["#sekcja-side | Sekcja Side"] });

    fireEvent.click(screen.getByRole("link", { name: /Sekcja Side/ }));
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#sekcja-side");
  });

  it("does nothing when the anchor target is missing from the DOM", () => {
    renderWidget({ variant: "grid", items_pl: ["#nie-istnieje | Widmo"] });
    fireEvent.click(screen.getByRole("link", { name: /Widmo/ }));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe("TocWidget - pasek postępu na scrollu", () => {
  it("recomputes the progress bar from a scroll event via RAF", () => {
    // RAF wykonywany synchronicznie, żeby update() policzył się od razu.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const de = document.documentElement;
    Object.defineProperty(de, "scrollHeight", { value: 3000, configurable: true });
    Object.defineProperty(de, "clientHeight", { value: 1000, configurable: true });
    let top = 0;
    Object.defineProperty(de, "scrollTop", {
      configurable: true,
      get: () => top,
    });

    try {
      renderWidget({ items_pl: ["Alfa"], showProgress: "1" });
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

      // Przewinięcie połowy zakresu -> 50%.
      top = 1000;
      act(() => {
        fireEvent.scroll(window);
      });
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    } finally {
      Reflect.deleteProperty(de, "scrollHeight");
      Reflect.deleteProperty(de, "clientHeight");
      Reflect.deleteProperty(de, "scrollTop");
      vi.unstubAllGlobals();
    }
  });
});

describe("TocWidget - korzeń skanu bez main/article", () => {
  it("scans document.body when no CMS container or main exists", async () => {
    const h = document.createElement("h2");
    h.textContent = "Nagłówek z body";
    document.body.appendChild(h);
    renderWidget({});
    expect(await screen.findByRole("link", { name: /Nagłówek z body/ })).toBeInTheDocument();
  });

  it("scans a bare main without an article child", async () => {
    const main = document.createElement("main");
    main.innerHTML = "<h2>Sekcja w main</h2>";
    document.body.appendChild(main);
    renderWidget({});
    expect(await screen.findByRole("link", { name: /Sekcja w main/ })).toBeInTheDocument();
  });
});
