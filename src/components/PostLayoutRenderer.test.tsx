import { describe, it, expect, vi } from "vitest";
import { within } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

// ReadingHeader (rendered by every layout) contains TanStack <Link>, which
// throws without a RouterProvider - swap it for the shared plain-anchor stub.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { PostLayoutRenderer } from "./PostLayoutRenderer";
import {
  STANDARD_LAYOUTS,
  defaultPostLayoutSettings,
  findLayout,
  BOXED_COVER_MAX_WIDTH,
  type PostLayoutSettings,
} from "@/lib/postLayouts";

// A real Supabase storage URL so OptimizedImage emits a responsive srcSet
// (buildImageSrcSet returns "" for non-transformable URLs).
const COVER = "https://proj.supabase.co/storage/v1/object/public/media/cover.jpg";

function renderLayout(
  layoutId: string,
  overrides: Partial<PostLayoutSettings> = {},
  props: { sidebarOverride?: boolean | null } = {},
) {
  const settings = { ...defaultPostLayoutSettings(), ...overrides };
  return renderWithQueryClient(
    <PostLayoutRenderer
      format="standard"
      layoutId={layoutId}
      settings={settings}
      title="Tytuł wpisu"
      excerpt="Krótki wstęp do artykułu."
      coverImageUrl={COVER}
      meta={<span data-testid="meta">5 min</span>}
      content={<div data-testid="content">Treść artykułu</div>}
      sidebar={<div data-testid="sidebar">Sidebar</div>}
      footer={<div data-testid="footer">Stopka</div>}
      {...props}
    />,
  );
}

/** The article header (ReadingHeader renders a div, never a <header>). */
const articleHeader = (c: HTMLElement) => c.querySelector("header");
/** True when `a` appears before `b` in document order. */
const isBefore = (a: Element, b: Element) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("PostLayoutRenderer", () => {
  it("renders title, excerpt, meta, content and footer for the default layout", () => {
    const { getByRole, getByTestId } = renderLayout("layout-1");
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Tytuł wpisu");
    expect(getByTestId("meta").textContent).toBe("5 min");
    expect(getByTestId("content").textContent).toBe("Treść artykułu");
    expect(getByTestId("footer").textContent).toBe("Stopka");
  });

  // Every standard preset must render its core slots without crashing.
  it.each(STANDARD_LAYOUTS.map((l) => l.id))("renders layout %s end-to-end", (id) => {
    const { getByRole, getByTestId } = renderLayout(id);
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Tytuł wpisu");
    expect(getByTestId("content").textContent).toBe("Treść artykułu");
  });

  describe("cover image is LCP-optimized (OptimizedImage: priority + responsive)", () => {
    // layout-9 ("no-cover") is the only standard preset that renders no cover.
    const withCover = STANDARD_LAYOUTS.filter((l) => l.cover !== "none");

    it.each(withCover.map((l) => l.id))("layout %s renders an eager, responsive cover", (id) => {
      const { container } = renderLayout(id);
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      // priority => eager loading + high fetch priority (LCP candidate).
      expect(img!.getAttribute("loading")).toBe("eager");
      expect(img!.getAttribute("fetchpriority")).toBe("high");
      // responsive => a width-scaled srcSet of storage variants + sizes hint.
      expect(img!.getAttribute("srcset")).toContain("/storage/v1/render/image/public/");
      expect(img!.getAttribute("srcset")).toContain("w");
      expect(img!.getAttribute("sizes")).toBeTruthy();
      // The cover always carries the post title as alt text.
      expect(img!.getAttribute("alt")).toBe("Tytuł wpisu");
    });

    it("renders no cover image for the no-cover layout (layout-9)", () => {
      const preset = findLayout("standard", "layout-9");
      expect(preset.cover).toBe("none");
      const { container } = renderLayout("layout-9");
      expect(container.querySelector("img")).toBeNull();
    });

    it("omits the cover when no coverImageUrl is supplied", () => {
      const { container } = renderWithQueryClient(
        <PostLayoutRenderer
          format="standard"
          layoutId="layout-1"
          settings={defaultPostLayoutSettings()}
          title="Bez okładki"
          content={<div>Treść</div>}
        />,
      );
      expect(container.querySelector("img")).toBeNull();
    });
  });

  describe("sidebar", () => {
    it("renders the sidebar for presets with hasSidebar", () => {
      const sidebarLayout = STANDARD_LAYOUTS.find((l) => l.hasSidebar)!;
      const { getByTestId } = renderLayout(sidebarLayout.id);
      expect(getByTestId("sidebar").textContent).toBe("Sidebar");
    });

    it("does not render the sidebar for presets without one", () => {
      const noSidebar = STANDARD_LAYOUTS.find((l) => !l.hasSidebar)!;
      const { queryByTestId } = renderLayout(noSidebar.id);
      expect(queryByTestId("sidebar")).toBeNull();
    });
  });

  describe("header positioning", () => {
    it("overlays the header on the cover for the overlay preset (layout-4)", () => {
      const preset = findLayout("standard", "layout-4");
      expect(preset.header).toBe("overlay");
      const { container, getByRole } = renderLayout("layout-4");
      // Overlay heading sits inside the absolutely-positioned overlay panel.
      const overlay = container.querySelector(".absolute.inset-x-0.bottom-0");
      expect(overlay).not.toBeNull();
      expect(within(overlay as HTMLElement).getByRole("heading", { level: 1 }).textContent).toBe(
        "Tytuł wpisu",
      );
      // Title must not be duplicated outside the overlay.
      expect(getByRole("heading", { level: 1 })).toBeTruthy();
    });

    it("centers the classic header when center_header is enabled", () => {
      const { container } = renderLayout("layout-1", { center_header: true });
      expect(articleHeader(container)!.className).toContain("text-center");
    });

    it("does not center the classic header when center_header is disabled", () => {
      const { container } = renderLayout("layout-1", { center_header: false });
      expect(articleHeader(container)!.className).not.toContain("text-center");
    });

    it("centers the overlay meta-card when center_header is enabled (layout-4)", () => {
      const { container } = renderLayout("layout-4", { center_header: true });
      const card = container.querySelector(".overlay-meta-card");
      expect(card).not.toBeNull();
      expect(card!.className).toContain("text-center");
    });

    it("centers the classic header (no cover) when center_header is enabled", () => {
      const { getByRole } = renderWithQueryClient(
        <PostLayoutRenderer
          format="standard"
          layoutId="layout-1"
          settings={{ ...defaultPostLayoutSettings(), center_header: true }}
          title="Bez okładki"
          content={<div>Treść</div>}
        />,
      );
      const header = getByRole("heading", { level: 1 }).closest("header");
      expect(header).not.toBeNull();
      expect(header!.className).toContain("text-center");
    });

    it("respects center_header=false on the overlay preset (layout-4)", () => {
      const { container } = renderLayout("layout-4", { center_header: false });
      const overlay = container.querySelector(".absolute.inset-x-0.bottom-0");
      expect(overlay?.className).not.toContain("text-center");
    });

    it("respects center_header=false on the side-by-side preset (layout-7)", () => {
      const { getByRole } = renderLayout("layout-7", { center_header: false });
      // Side-by-side wraps title/excerpt/meta in a div that centers only when on.
      const wrap = getByRole("heading", { level: 1 }).parentElement;
      expect(wrap?.className).not.toContain("text-center");
    });
  });

  it("applies the configured aspect ratio for ratio-cover presets (layout-6)", () => {
    const preset = findLayout("standard", "layout-6");
    expect(preset.cover).toBe("ratio");
    const { container } = renderLayout("layout-6", { featured_ratio_l6: 150 });
    const ratioBox = container.querySelector('[style*="aspect-ratio"]');
    expect(ratioBox).not.toBeNull();
    expect((ratioBox as HTMLElement).style.aspectRatio).toContain("150");
  });

  // Regression guard for the bug where every covered post collapsed into the
  // overlay hero, so Layout 1/1a/2/3/8/9/10/11/12 all looked identical: the
  // renderer ignored `preset.header`. Each preset must paint its own shape.
  describe("every preset renders its declared structure", () => {
    it.each(STANDARD_LAYOUTS.map((l) => [l.id, l.header] as const))(
      "%s reports header mode %s",
      (id, header) => {
        const { container } = renderLayout(id);
        const root = container.querySelector("[data-post-layout]")!;
        expect(root.getAttribute("data-post-layout")).toBe(id);
        expect(root.getAttribute("data-layout-header")).toBe(header);
      },
    );

    // Only the three overlay presets may paint the title on the cover.
    it.each(STANDARD_LAYOUTS.map((l) => l.id))("%s overlays the title only when declared", (id) => {
      const preset = findLayout("standard", id);
      const { container } = renderLayout(id);
      const overlay = container.querySelector(".overlay-meta-card");
      if (preset.header === "overlay") {
        expect(overlay, `${id} must render the overlay hero`).not.toBeNull();
        expect(articleHeader(container), `${id} must not duplicate the classic header`).toBeNull();
      } else {
        expect(overlay, `${id} must NOT render an overlay hero`).toBeNull();
        expect(articleHeader(container), `${id} must render a classic header`).not.toBeNull();
      }
    });

    it("puts the header above the cover for above-cover presets (layout-1)", () => {
      const { container } = renderLayout("layout-1");
      const header = articleHeader(container)!;
      const img = container.querySelector("img")!;
      expect(isBefore(header, img)).toBe(true);
      // ...and the content follows the cover.
      expect(isBefore(img, container.querySelector('[data-testid="content"]')!)).toBe(true);
    });

    it("puts the cover above the header for the magazine preset (layout-8)", () => {
      const { container } = renderLayout("layout-8");
      const header = articleHeader(container)!;
      const img = container.querySelector("img")!;
      expect(isBefore(img, header)).toBe(true);
      expect(isBefore(header, container.querySelector('[data-testid="content"]')!)).toBe(true);
    });

    it("renders the split preset (layout-7) as cover + header side by side", () => {
      const { container } = renderLayout("layout-7");
      const grid = container.querySelector(".lg\\:grid-cols-2");
      expect(grid).not.toBeNull();
      const img = container.querySelector("img")!;
      const header = articleHeader(container)!;
      expect(grid!.contains(img)).toBe(true);
      expect(grid!.contains(header)).toBe(true);
      expect(isBefore(img, header)).toBe(true);
    });

    // Kontrakt utrwalony po usunięciu martwych strażników w komponencie:
    // preset z okładką BEZ zdjęcia nie renderuje pustej ramki ani siatki 2-kolumnowej,
    // tylko schodzi do klasycznego nagłówka (headerMode = "no-cover").
    it("falls back to the classic header when a cover preset has no image (layout-7)", () => {
      const { container, getByRole } = renderWithQueryClient(
        <PostLayoutRenderer
          format="standard"
          layoutId="layout-7"
          settings={defaultPostLayoutSettings()}
          title="Bez okładki"
          content={<div>Treść</div>}
        />,
      );
      expect(
        container.querySelector("[data-layout-header]")!.getAttribute("data-layout-header"),
      ).toBe("no-cover");
      expect(container.querySelector(".lg\\:grid-cols-2")).toBeNull();
      expect(container.querySelector("img")).toBeNull();
      expect(getByRole("heading", { level: 1 }).textContent).toBe("Bez okładki");
    });

    it("drops the excerpt for the no-excerpt preset (layout-1a)", () => {
      const preset = findLayout("standard", "layout-1a");
      expect(preset.showExcerpt).toBe(false);
      const { container, queryByText } = renderLayout("layout-1a");
      expect(queryByText("Krótki wstęp do artykułu.")).toBeNull();
      // The rest of the header is intact - it is Layout 1 minus the lead.
      expect(container.querySelector("h1")!.textContent).toBe("Tytuł wpisu");
      expect(container.querySelector("img")).not.toBeNull();
    });

    it("keeps the excerpt for the classic preset (layout-1)", () => {
      const { queryByText } = renderLayout("layout-1");
      expect(queryByText("Krótki wstęp do artykułu.")).not.toBeNull();
    });

    it("narrows header, cover and content for the narrow preset (layout-2)", () => {
      const preset = findLayout("standard", "layout-2");
      expect(preset.contentMaxWidth).toBe(BOXED_COVER_MAX_WIDTH);
      const { container } = renderLayout("layout-2");
      const boxed = `${BOXED_COVER_MAX_WIDTH}px`;
      // Header, boxed cover frame and content column share one narrow measure.
      expect(articleHeader(container)!.style.maxWidth).toBe(boxed);
      const coverFrame = container.querySelector("img")!.closest("div")!.parentElement!;
      expect(coverFrame.style.maxWidth).toBe(boxed);
      const content = container.querySelector('[data-testid="content"]')!
        .parentElement as HTMLElement;
      expect(content.style.maxWidth).toBe(boxed);
    });

    it("applies the low-hero ratio to layout-10 and layout-11", () => {
      for (const id of ["layout-10", "layout-11"]) {
        const { container } = renderLayout(id, {
          featured_ratio_l10: 45,
          featured_ratio_l11: 45,
        });
        const frame = container.querySelector('[style*="aspect-ratio"]') as HTMLElement;
        expect(frame.style.aspectRatio, `${id} low hero`).toBe("100 / 45");
        // A low hero sits under a classic header, never behind it.
        expect(container.querySelector(".overlay-meta-card")).toBeNull();
      }
    });

    it("uses the recommended image ratio for plain covers (layout-3 = 1200x675)", () => {
      const { container } = renderLayout("layout-3");
      const frame = container.querySelector('[style*="aspect-ratio"]') as HTMLElement;
      expect(frame.style.aspectRatio).toBe("1200 / 675");
    });

    it("renders no cover at all for layout-9, even with a cover image set", () => {
      const { container } = renderLayout("layout-9");
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("[data-post-layout]")!.getAttribute("data-layout-cover")).toBe(
        "none",
      );
      expect(articleHeader(container)).not.toBeNull();
    });

    it("degrades to a classic header when the post has no cover image", () => {
      // layout-8 (below-cover) and layout-4 (overlay) have nothing to paint on.
      for (const id of ["layout-4", "layout-8"]) {
        const { container } = renderWithQueryClient(
          <PostLayoutRenderer
            format="standard"
            layoutId={id}
            settings={defaultPostLayoutSettings()}
            title="Bez okładki"
            excerpt="Wstęp"
            content={<div>Treść</div>}
          />,
        );
        const root = container.querySelector("[data-post-layout]")!;
        expect(root.getAttribute("data-layout-header"), id).toBe("no-cover");
        expect(container.querySelector(".overlay-meta-card"), id).toBeNull();
        expect(articleHeader(container), id).not.toBeNull();
      }
    });
  });

  describe("sidebar resolution", () => {
    const sidebarRail = (c: HTMLElement) => c.querySelector("aside");

    it.each(STANDARD_LAYOUTS.map((l) => [l.id, l.hasSidebar] as const))(
      "%s renders the sidebar rail = %s",
      (id, expected) => {
        const { container } = renderLayout(id);
        expect(!!sidebarRail(container)).toBe(expected);
        expect(
          container.querySelector("[data-post-layout]")!.getAttribute("data-layout-sidebar"),
        ).toBe(String(expected));
      },
    );

    it("keeps header and cover inside the article column next to the rail", () => {
      const { container } = renderLayout("layout-3");
      const rail = sidebarRail(container)!;
      const column = rail.parentElement!.firstElementChild as HTMLElement;
      expect(column.contains(articleHeader(container)!)).toBe(true);
      expect(column.contains(container.querySelector("img")!)).toBe(true);
      expect(column.contains(container.querySelector('[data-testid="content"]')!)).toBe(true);
      expect(column.contains(rail)).toBe(false);
    });

    it("honours the global per-preset sidebar override", () => {
      const { container } = renderLayout("layout-1", {
        layout_sidebar_overrides: { "layout-1": true },
      });
      expect(sidebarRail(container)).not.toBeNull();
    });

    it("lets a per-post override win over the global one", () => {
      const { container } = renderLayout(
        "layout-3",
        { layout_sidebar_overrides: { "layout-3": true } },
        { sidebarOverride: false },
      );
      expect(sidebarRail(container)).toBeNull();
    });

    it("narrows the content column when the sidebar is on", () => {
      const settings = defaultPostLayoutSettings();
      const { container } = renderLayout("layout-3");
      const content = container.querySelector('[data-testid="content"]')!
        .parentElement as HTMLElement;
      expect(content.style.maxWidth).toBe(`${settings.has_sidebar_max_width}px`);
    });
  });

  it("falls back to the first preset for an unknown layout id", () => {
    // findLayout returns set[0] (layout-1) for unknown ids; renderer must not crash.
    const { getByRole, getByTestId } = renderLayout("does-not-exist");
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Tytuł wpisu");
    expect(getByTestId("content").textContent).toBe("Treść artykułu");
  });
});
