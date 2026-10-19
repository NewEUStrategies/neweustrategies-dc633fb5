// KANDYDAT LCP OBOK KOLUMNY SCHOWANEJ: `sizes` PRELOADU = `sizes` MALOWANEGO `<img>`.
//
// CO TEN PLIK DOWODZI. `lcpCandidates` liczy slot kandydata z rodzeństwa,
// które renderer MALUJE w HTML-u serwera (desktop): kolumna `hideOn.desktop`
// nie zabiera udziału w wierszu - ani w sekcji (`RenderSection`, `visibleCols`),
// ani w sekcji zagnieżdżonej (`RenderInner`, `columns`). Kolumna schowana tylko
// na telefonie jest w HTML-u serwera (chowa ją `@media`), więc dzieli wiersz.
// Rozjazd tych dwóch filtrów nie wywraca strony - po cichu daje preload
// z `sizes` o połowę węższym niż `<img>` (przeglądarka pobiera dwa pliki).
// Dlatego dowód porównuje WYJŚCIE renderera z deskryptorem preloadu trasy,
// a nie liczbę wpisaną w test.
//
// GRANICE I ATRAPY - jak w `heroCandidateSelection.test.tsx`: gałąź serwerowa
// renderera (`isServer`), pusta Supabase, brak routera i wiązań z wpisami.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import {
  column,
  doc,
  hideOn,
  innerSection,
  section,
  widget,
} from "@/components/builder/organisms/__tests__/builderRendererFixtures";
import { builderHeroPreloads } from "@/lib/builder/heroImage";
import type { BuilderDocument, ColumnNode } from "@/lib/builder/types";
import { HERO_COVER_URL } from "./heroSrcsetSample";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

const env = vi.hoisted(() => ({ server: false as boolean | undefined }));
vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return env.server;
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of ["select", "eq", "neq", "is", "in", "not", "order", "range", "limit", "or"]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => ({ data: null, error: null }));
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn(async () => ({ data: [], error: null })),
    },
  };
});

vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => null,
}));

type Device = "desktop" | "mobile";
type Shape = "sekcja" | "inner-sekcja";

/** Dwie kolumny 6/6: schowana na `device` (nagłówek) i widoczna z obrazem. */
function docWithHiddenNeighbour(shape: Shape, device: Device): BuilderDocument {
  const hidden = column("c-ukryta", [widget("w-tekst")], {
    span: { desktop: 6 },
    advanced: hideOn({ [device]: true }),
  });
  const open = column(
    "c-obraz",
    [widget("w-obraz", "image", { content: { src: HERO_COVER_URL, alt_pl: "Zdjęcie" } })],
    { span: { desktop: 6 } },
  );
  const columns: ColumnNode[] = [hidden, open];
  return doc([section("s-0", shape === "sekcja" ? columns : [innerSection("is-0", columns)])]);
}

/** Render SERWEROWY renderera-właściciela kandydatów (jak trasa `/`). */
function ssr(builderDoc: BuilderDocument): string {
  env.server = true;
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToString(
      <QueryClientProvider client={client}>
        <BuilderRenderer doc={builderDoc} lang="pl" lcpOwner />
      </QueryClientProvider>,
    );
  } finally {
    env.server = false;
  }
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replaceAll("&amp;", "&");

describe("kandydat LCP obok kolumny schowanej - preload ma `sizes` malowanego obrazu", () => {
  it.each([
    ["sekcja", "desktop", "min(100vw, 1140px)"],
    ["sekcja", "mobile", "min(50vw, 570px)"],
    ["inner-sekcja", "desktop", "min(100vw, 1140px)"],
    ["inner-sekcja", "mobile", "min(50vw, 570px)"],
  ] as const)(
    "%s z kolumną schowaną na %s: obraz obok zajmuje %s, a preload mówi to samo",
    (shape, device, desktopSize) => {
      const builderDoc = docWithHiddenNeighbour(shape as Shape, device as Device);
      const [preload, ...rest] = builderHeroPreloads(builderDoc, new QueryClient(), "pl");
      expect(rest).toEqual([]);
      expect(preload?.imageSizes).toBeTruthy();

      const imgs = ssr(builderDoc).match(/<img[^>]*data-lcp-candidate[^>]*>/g) ?? [];
      expect(imgs).toHaveLength(1);
      expect(attr(imgs[0] ?? "", "sizes")).toBe(preload?.imageSizes);
      expect(attr(imgs[0] ?? "", "srcSet")).toBe(preload?.imageSrcSet);
      // Kontrola, że porównanie mierzy szerokość wiersza, a nie stałą: desktopowa
      // część `sizes` (wartość domyślna na końcu) to cały wiersz albo jego połowa.
      expect(preload?.imageSizes?.endsWith(`, ${desktopSize}`)).toBe(true);
    },
  );
});
