// ImageWidget: rozmiar logo. Dwie regresje ze stopki produkcyjnej:
// 1) rozmiar zapisany jako długość CSS w treści (`maxWidth: "180px"` - tak sieją
//    domyślne chrome) był ignorowany, bo renderer czytał tylko `maxWidthPx`,
// 2) logo bez żadnego limitu dostawało `width: 100%`, więc rozlewało się na
//    całą kolumnę stopki (6/12 = ponad 500 px).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode, WidgetContent } from "@/lib/builder/types";

const db = vi.hoisted(() => ({
  settings: [
    {
      key: "theme_options",
      value: { logo: { main: "https://cdn.example.com/logo.png" } },
    },
  ] as unknown[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: db.settings[0] ?? null, error: null });
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: db.settings, error: null });
    return b;
  };
  return {
    supabase: { from: () => makeBuilder(), rpc: async () => ({ data: [], error: null }) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

let nextId = 0;
function renderImage(content: WidgetContent) {
  const node: WidgetNode = { id: `img-${nextId++}`, kind: "widget", type: "image", content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  nextId += 1;
});

async function logoImg(container: HTMLElement): Promise<HTMLImageElement> {
  await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
  return container.querySelector("img") as HTMLImageElement;
}

describe("ImageWidget - rozmiar logo", () => {
  it("respects a CSS-length maxWidth stored in widget content", async () => {
    const { container } = renderImage({
      src: "",
      alt_pl: "Logo",
      useSiteLogo: "main",
      maxWidth: "180px",
    });
    const img = await logoImg(container);
    expect(img.style.maxWidth).toBe("min(100%, 180px)");
  });

  it("caps an unsized logo instead of filling the whole column", async () => {
    const { container } = renderImage({ src: "", alt_pl: "Logo", useSiteLogo: "main" });
    const img = await logoImg(container);
    expect(img.style.maxWidth).toBe("min(100%, 200px)");
    expect(img.style.objectFit).toBe("contain");
  });

  it("keeps an explicit numeric width and an explicit objectFit", async () => {
    const { container } = renderImage({
      src: "",
      alt_pl: "Logo",
      useSiteLogo: "main",
      widthPx: 120,
      objectFit: "cover",
    });
    const img = await logoImg(container);
    expect(img.style.width).toBe("120px");
    expect(img.style.objectFit).toBe("cover");
  });

  it("leaves non-logo images unbounded when no size is set", async () => {
    const { container } = renderImage({
      src: "https://cdn.example.com/photo.jpg",
      alt_pl: "Zdjęcie",
    });
    const img = await logoImg(container);
    expect(img.style.maxWidth).toBe("100%");
  });
});
