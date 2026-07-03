import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";

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
  type PostLayoutSettings,
} from "@/lib/postLayouts";

// A real Supabase storage URL so OptimizedImage emits a responsive srcSet
// (buildImageSrcSet returns "" for non-transformable URLs).
const COVER = "https://proj.supabase.co/storage/v1/object/public/media/cover.jpg";

function renderLayout(layoutId: string, overrides: Partial<PostLayoutSettings> = {}) {
  const settings = { ...defaultPostLayoutSettings(), ...overrides };
  return render(
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
    />,
  );
}

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
      const { container } = render(
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

    it("centers the header when center_header is enabled", () => {
      const { getByRole } = renderLayout("layout-1", { center_header: true });
      const header = getByRole("heading", { level: 1 }).closest("header");
      expect(header?.className).toContain("text-center");
    });

    it("does not center the header when center_header is disabled", () => {
      const { getByRole } = renderLayout("layout-1", { center_header: false });
      const header = getByRole("heading", { level: 1 }).closest("header");
      expect(header?.className).not.toContain("text-center");
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

  it("falls back to the first preset for an unknown layout id", () => {
    // findLayout returns set[0] (layout-1) for unknown ids; renderer must not crash.
    const { getByRole, getByTestId } = renderLayout("does-not-exist");
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Tytuł wpisu");
    expect(getByTestId("content").textContent).toBe("Treść artykułu");
  });
});
