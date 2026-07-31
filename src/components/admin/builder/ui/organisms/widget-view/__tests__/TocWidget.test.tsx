// Przepięcie widgetu spisu treści na kanoniczne kotwice (lib/content):
// `href="#…"` widgetu musi wskazywać dokładnie te `id`, które nadają silniki
// treści - również dla liter atomowych (`ł`), które dawna, piąta kopia
// slugify (NFKD-only) gubiła w środku wyrazu.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { TocWidget } from "../TocWidget";
import type { WidgetContent } from "@/lib/builder/types";
import type { Lang } from "../frame";

/** Kontener treści strony, który widget skanuje w trybie auto. */
function mountContent(html: string): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("data-cms-content", "");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function renderWidget(content: WidgetContent = {}, lang: Lang = "pl") {
  return render(<TocWidget content={content} lang={lang} />);
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("TocWidget - autoscan z kanonicznymi kotwicami", () => {
  it("links atomic-letter headings via slugifyAnchor (the 'ł' regression)", async () => {
    const host = mountContent(`<h2>Wyzwania małych firm</h2><h3>Łódź i region</h3>`);
    renderWidget();

    const link = await screen.findByRole("link", { name: /Wyzwania małych firm/ });
    // Dawna kopia NFKD-only linkowała tu do "#wyzwania-ma-ych-firm".
    expect(link).toHaveAttribute("href", "#wyzwania-malych-firm");
    expect(host.querySelector("h2")?.id).toBe("wyzwania-malych-firm");
    expect(screen.getByRole("link", { name: /Łódź i region/ })).toHaveAttribute(
      "href",
      "#lodz-i-region",
    );

    // Historyczna kotwica dostaje niewidoczny alias - stare linki "#…" działają.
    const alias = document.getElementById("wyzwania-ma-ych-firm");
    expect(alias?.dataset.anchorAlias).toBe("wyzwania-malych-firm");
  });

  it("deduplicates repeated headings from the base", async () => {
    mountContent(`<h2>Wnioski</h2><h2>Wnioski</h2>`);
    renderWidget();

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(2));
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["#wnioski", "#wnioski-2"]);
  });

  it("keeps server-rendered ids untouched", async () => {
    mountContent(`<h2 id="z-serwera">Rozdział</h2>`);
    renderWidget();

    const link = await screen.findByRole("link", { name: /Rozdział/ });
    expect(link).toHaveAttribute("href", "#z-serwera");
  });

  it("skips the heading that mirrors the widget title", async () => {
    mountContent(`<h2>Spis treści</h2><h2>Temat właściwy</h2>`);
    renderWidget();

    await waitFor(() => expect(screen.getAllByRole("link")).toHaveLength(1));
    expect(screen.getByRole("link", { name: /Temat właściwy/ })).toBeInTheDocument();
  });

  it("scrolls to the target and rewrites the hash on click", async () => {
    mountContent(`<h2>Wyzwania małych firm</h2>`);
    renderWidget();

    const link = await screen.findByRole("link", { name: /Wyzwania małych firm/ });
    fireEvent.click(link);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("#wyzwania-malych-firm");
  });

  it("renders the localized empty state when the page has no headings", () => {
    renderWidget({}, "en");
    expect(screen.getByText("No headings detected on this page.")).toBeInTheDocument();
    cleanup();
    renderWidget({}, "pl");
    expect(screen.getByText("Brak nagłówków na tej stronie.")).toBeInTheDocument();
  });
});

describe("TocWidget - pozycje ręczne", () => {
  it("renders manual items with canonical anchors, honoring explicit ids", () => {
    renderWidget({
      items_pl: ["Wprowadzenie", "-- Gęślą jaźń", "#custom | Z jawną kotwicą"],
    });

    expect(screen.getByRole("link", { name: /Wprowadzenie/ })).toHaveAttribute(
      "href",
      "#wprowadzenie",
    );
    expect(screen.getByRole("link", { name: /Gęślą jaźń/ })).toHaveAttribute("href", "#gesla-jazn");
    expect(screen.getByRole("link", { name: /Z jawną kotwicą/ })).toHaveAttribute(
      "href",
      "#custom",
    );
  });

  it("falls back to Polish items when the English list is empty", () => {
    renderWidget({ items_pl: ["Sekcja PL"] }, "en");
    expect(screen.getByRole("link", { name: /Sekcja PL/ })).toHaveAttribute("href", "#sekcja-pl");
  });
});

describe("TocWidget - warianty układu", () => {
  const manual: WidgetContent = { items_pl: ["Alfa", "-- Beta", "Gamma"] };

  it("renders the list variant by default and falls back on unknown values", () => {
    const { container } = renderWidget({ ...manual, variant: "nieznany" });
    expect(container.querySelector("[data-widget-toc]")?.getAttribute("data-variant")).toBe("list");
  });

  it("renders grid and sidebar variants with all items", () => {
    for (const variant of ["grid", "sidebar"] as const) {
      const { container, unmount } = renderWidget({ ...manual, variant });
      expect(container.querySelector("[data-widget-toc]")?.getAttribute("data-variant")).toBe(
        variant,
      );
      expect(screen.getAllByRole("link")).toHaveLength(3);
      unmount();
    }
  });

  it("shows the reading-progress bar only when enabled", () => {
    renderWidget({ ...manual, showProgress: "1", sticky: "1" });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    cleanup();
    renderWidget(manual);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("toggles the mobile collapsible via the header button", () => {
    renderWidget(manual);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("uses the language-specific title with a Polish fallback", () => {
    renderWidget({ ...manual, title_pl: "Nawigacja artykułu" }, "en");
    // Brak title_en -> tytuł PL zamiast wbudowanego angielskiego.
    expect(screen.getAllByText("Nawigacja artykułu").length).toBeGreaterThan(0);
  });
});

describe("TocWidget - scrollspy i postęp czytania", () => {
  it("marks the active item with aria-current in every variant", async () => {
    // Scrollspy: IntersectionObserver zgłaszający przecięcie od razu przy
    // observe(). Ostatni obserwowany nagłówek (H2 "Alfa") zostaje aktywny,
    // więc jedna para pozycji pokrywa obie gałęzie stylowania isActive.
    const RealIO = globalThis.IntersectionObserver;
    class ImmediateIO {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(target: Element): void {
        this.cb(
          [
            {
              isIntersecting: true,
              target,
              boundingClientRect: target.getBoundingClientRect(),
            } as IntersectionObserverEntry,
          ],
          this as unknown as IntersectionObserver,
        );
      }
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    globalThis.IntersectionObserver = ImmediateIO as unknown as typeof IntersectionObserver;
    try {
      for (const variant of ["list", "grid", "sidebar"] as const) {
        document.body.innerHTML = "";
        mountContent(`<h3>Beta pod</h3><h2>Alfa</h2>`);
        const view = renderWidget({ variant });
        await waitFor(() => {
          const activeLink = document.querySelector<HTMLAnchorElement>(
            'a[aria-current="location"]',
          );
          expect(activeLink?.getAttribute("href")).toBe("#alfa");
        });
        // Nieaktywna pozycja nie dostaje aria-current.
        expect(screen.getByRole("link", { name: /Beta pod/ })).not.toHaveAttribute("aria-current");
        view.unmount();
      }
    } finally {
      globalThis.IntersectionObserver = RealIO;
    }
  });

  it("derives reading progress from real document metrics", () => {
    const de = document.documentElement;
    Object.defineProperty(de, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(de, "clientHeight", { value: 1000, configurable: true });
    Object.defineProperty(de, "scrollTop", { value: 500, configurable: true });
    try {
      renderWidget({ items_pl: ["Alfa"], showProgress: "1" });
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    } finally {
      Reflect.deleteProperty(de, "scrollHeight");
      Reflect.deleteProperty(de, "clientHeight");
      Reflect.deleteProperty(de, "scrollTop");
    }
  });

  it("falls back to main article as the scan root when no CMS container exists", async () => {
    const main = document.createElement("main");
    main.innerHTML = `<article><h2>Wyzwania małych firm</h2></article>`;
    document.body.appendChild(main);
    renderWidget();
    const link = await screen.findByRole("link", { name: /Wyzwania małych firm/ });
    expect(link).toHaveAttribute("href", "#wyzwania-malych-firm");
  });
});
