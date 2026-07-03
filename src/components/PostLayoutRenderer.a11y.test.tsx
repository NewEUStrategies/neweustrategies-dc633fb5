import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// ReadingHeader (rendered by every layout) contains TanStack <Link>, which
// throws without a RouterProvider - swap it for the shared plain-anchor stub.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { PostLayoutRenderer } from "./PostLayoutRenderer";
import { STANDARD_LAYOUTS, defaultPostLayoutSettings } from "@/lib/postLayouts";
import { axeViolations, summarize } from "@/test/axe";

const COVER = "https://proj.supabase.co/storage/v1/object/public/media/cover.jpg";

function renderLayout(layoutId: string) {
  // Wrap in <main> so landmark-structure is realistic for the (kept) ARIA rules.
  return render(
    <main>
      <PostLayoutRenderer
        format="standard"
        layoutId={layoutId}
        settings={defaultPostLayoutSettings()}
        title="Tytuł wpisu"
        excerpt="Krótki wstęp."
        coverImageUrl={COVER}
        meta={<span>5 min</span>}
        content={
          <article>
            <h2>Sekcja</h2>
            <p>
              Treść artykułu z <a href="https://example.com">odnośnikiem</a>.
            </p>
          </article>
        }
      />
    </main>,
  );
}

describe("PostLayoutRenderer accessibility (axe)", () => {
  it.each(STANDARD_LAYOUTS.map((l) => l.id))("layout %s has no axe violations", async (id) => {
    const { container } = renderLayout(id);
    const v = await axeViolations(container);
    expect(v, summarize(v)).toEqual([]);
  });
});
