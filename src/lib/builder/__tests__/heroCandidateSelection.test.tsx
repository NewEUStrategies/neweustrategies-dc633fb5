// WYBÓR KANDYDATA `srcset` HERO (P3.2a: LP-7 + HW-4 + P4.2).
//
// CO TU MA DOWÓD
//  1. Algorytm wyboru Chromium (Blink `html_srcset_parser.cc`, `SelectionLogic`:
//     kandydaci rosnąco gęstością; pierwszy o gęstości >= DPR wygrywa, gdy
//     `DPR >= sqrt(poprzedni x następny)` albo DPR <= 1 i poprzedni < DPR, inaczej
//     zostaje poprzedni) - implementacja referencyjna niżej, sprawdzona w
//     prawdziwej przeglądarce przez `e2e/hero-srcset.boot-home.spec.ts`.
//  2. Dla hero w kształcie produkcji telefon PSI (412 x 823 @ 1,75) dostaje
//     640w dopiero z marginesem kolumny w `sizes` (`calc(100vw - 64px)`), a nie
//     z samej drabiny: dawne `100vw` zostaje przy 768w (udokumentowana regresja).
//     Desktop PSI (1350 @ 1) bez zmian: 768w.
//  3. PARYTET: SSR renderera buildera daje `<img data-lcp-candidate>` z `srcset`
//     i `sizes` identycznymi z deskryptorem preloadu (`builderHeroPreloads`),
//     preload i `<img>` to jeden `<link>`, a nagłówek `Link` niesie adresy
//     względne. Próbka dla e2e (`heroSrcsetSample.ts`) = wyjście kodu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/test/i18nReal";
import { BuilderRenderer } from "@/components/builder/organisms/BuilderRenderer";
import {
  column,
  doc,
  section,
  stubObservers,
  widget,
} from "@/components/builder/organisms/__tests__/builderRendererFixtures";
import { usePreloadLcpImages, type LcpImagePreload } from "@/lib/builder/aboveFold";
import { builderHeroPreloads, lcpPreloadLinkHeaderValue } from "@/lib/builder/heroImage";
import { MOBILE_COLUMN_GUTTER_PX } from "@/lib/builder/imageSlot";
import type { BuilderDocument } from "@/lib/builder/types";
import { HERO_COVER_URL, HERO_SRCSET_SAMPLE } from "./heroSrcsetSample";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

// Gałąź serwerowa renderera (kandydat LCP liczony w SSR) - jak w
// `builderRenderer.streaming.test.tsx`.
const env = vi.hoisted(() => ({ server: false as boolean | undefined }));
vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return env.server;
  },
}));

// Slider czyta w tle okładki zapasowe i ustawienia karuzeli - pusta odpowiedź.
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

// Slajdy są ręczne (bez wiązania z wpisem); router nieobecny jak w SSR bez trasy.
vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => null,
}));

let observers: ReturnType<typeof stubObservers>;
beforeEach(() => {
  observers = stubObservers();
});
afterEach(() => {
  observers.restore();
});

// ── Implementacja referencyjna: `sizes` i wybór kandydata Blinka ──────────────

/** Podział po przecinkach najwyższego poziomu (poza nawiasami). */
function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "(") depth += 1;
    else if (value[i] === ")") depth -= 1;
    else if (value[i] === "," && depth === 0) {
      out.push(value.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(value.slice(start).trim());
  return out;
}

/** Długość CSS z `sizes`: `Npx`, `Nvw`, `calc(Nvw - Mpx)`, `min(a, b)`. */
function lengthPx(expr: string, viewportWidth: number): number {
  const e = expr.trim();
  const min = /^min\((.*)\)$/.exec(e);
  if (min) return Math.min(...splitTopLevel(min[1]).map((a) => lengthPx(a, viewportWidth)));
  const calc = /^calc\((\d+(?:\.\d+)?)vw - (\d+(?:\.\d+)?)px\)$/.exec(e);
  if (calc) return (Number(calc[1]) * viewportWidth) / 100 - Number(calc[2]);
  const vw = /^(\d+(?:\.\d+)?)vw$/.exec(e);
  if (vw) return (Number(vw[1]) * viewportWidth) / 100;
  const px = /^(\d+(?:\.\d+)?)px$/.exec(e);
  if (px) return Number(px[1]);
  throw new Error(`nieobsługiwana długość w sizes: ${e}`);
}

/** Szerokość slotu z `sizes` dla viewportu (pierwszy pasujący warunek `max-width`). */
function sizesPx(sizes: string, viewportWidth: number): number {
  for (const entry of splitTopLevel(sizes)) {
    const media = /^\(max-width: (\d+)px\)\s+(.+)$/.exec(entry);
    if (!media) return lengthPx(entry, viewportWidth);
    if (viewportWidth <= Number(media[1])) return lengthPx(media[2], viewportWidth);
  }
  throw new Error(`sizes bez wartości domyślnej: ${sizes}`);
}

/** Blink `SelectionLogic` - szerokość wybranego kandydata `w`. */
function pickedWidth(srcset: string, sizes: string, viewportWidth: number, dpr: number): number {
  const slot = sizesPx(sizes, viewportWidth);
  const candidates = splitTopLevel(srcset)
    .map((entry) => Number(/\s(\d+)w$/.exec(entry)?.[1]))
    .map((width) => ({ width, density: width / slot }))
    .sort((a, b) => a.density - b.density);
  let i = 0;
  for (; i < candidates.length - 1; i += 1) {
    const next = candidates[i + 1].density;
    if (next < dpr) continue;
    const current = candidates[i].density;
    if ((dpr <= 1 && dpr > current) || dpr >= Math.sqrt(current * next)) {
      return candidates[i + 1].width;
    }
    break;
  }
  return candidates[i].width;
}

// ── Dokument w kształcie hero produkcji ─────────────────────────────────────

/** Sekcja `full`, kolumny 3/6/3, hero (slider `editorial-hero`) pierwsze na telefonie. */
function productionHeroDoc(): BuilderDocument {
  return doc([
    section(
      "s-hero",
      [
        column("c-left", [widget("w-left")], { span: { desktop: 3 }, order: { mobile: 2 } }),
        column(
          "c-hero",
          [
            widget("w-hero", "slider", {
              content: {
                variant: "editorial-hero",
                items: [{ image: HERO_COVER_URL, title_pl: "Hero" }],
              },
            }),
          ],
          { span: { desktop: 6 }, order: { mobile: 1 } },
        ),
        column("c-right", [widget("w-right")], { span: { desktop: 3 }, order: { mobile: 3 } }),
      ],
      { layout: { contentWidth: "full" } } as never,
    ),
  ]);
}

const heroPreload = (): LcpImagePreload => {
  const [preload, ...rest] = builderHeroPreloads(productionHeroDoc(), new QueryClient(), "pl");
  expect(rest).toEqual([]);
  if (!preload) throw new Error("brak preloadu hero");
  return preload;
};

/** Render SERWEROWY strony z preloadem z trasy (jak `index.tsx`). */
function ssrPage(preloads: LcpImagePreload[], content: ReactElement): string {
  function Trasa() {
    usePreloadLcpImages(preloads);
    return content;
  }
  env.server = true;
  try {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToString(
      <QueryClientProvider client={client}>
        <Trasa />
      </QueryClientProvider>,
    );
  } finally {
    env.server = false;
  }
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]?.replaceAll("&amp;", "&");

describe("wybór kandydata hero (implementacja referencyjna Blinka)", () => {
  it("telefon PSI 412 x 823 @ 1,75: 640w z marginesem kolumny", () => {
    const { imageSrcSet, imageSizes } = heroPreload();
    expect(imageSizes).toBe(HERO_SRCSET_SAMPLE.sizes);
    expect(sizesPx(imageSizes ?? "", 412)).toBe(412 - 2 * MOBILE_COLUMN_GUTTER_PX);
    expect(pickedWidth(imageSrcSet ?? "", imageSizes ?? "", 412, 1.75)).toBe(640);
  });

  it("REGRESJA UDOKUMENTOWANA: dawne `100vw` na telefonie zostaje przy 768w", () => {
    // Sama drabina 640w nie daje - dopiero `sizes` z marginesem (LP-7).
    expect(pickedWidth(HERO_SRCSET_SAMPLE.srcset, HERO_SRCSET_SAMPLE.legacySizes, 412, 1.75)).toBe(
      768,
    );
  });

  it("desktop PSI 1350 x 940 @ 1: 768w (bez zmian)", () => {
    const { imageSrcSet, imageSizes } = heroPreload();
    expect(pickedWidth(imageSrcSet ?? "", imageSizes ?? "", 1350, 1)).toBe(768);
  });

  it.each([16, 24])("zapas: margines %i px po stronie nadal daje 640w", (gutter) => {
    const sizes = HERO_SRCSET_SAMPLE.sizes.replace("64px", `${2 * gutter}px`);
    expect(pickedWidth(HERO_SRCSET_SAMPLE.srcset, sizes, 412, 1.75)).toBe(640);
  });

  it("HW-4 (decyzja właściciela): DPR 3 dostaje 768w, retina full-bleed 1920w", () => {
    expect(pickedWidth(HERO_SRCSET_SAMPLE.srcset, HERO_SRCSET_SAMPLE.sizes, 390, 3)).toBe(768);
    expect(pickedWidth(HERO_SRCSET_SAMPLE.srcset, "100vw", 1440, 2)).toBe(1920);
  });
});

describe("parytet: `<img>` kandydata = preload = próbka e2e", () => {
  it("SSR renderera: `srcset`/`sizes` kandydata = deskryptor preloadu = próbka", () => {
    const preload = heroPreload();
    expect(preload.imageSrcSet).toBe(HERO_SRCSET_SAMPLE.srcset);
    expect(preload.imageSizes).toBe(HERO_SRCSET_SAMPLE.sizes);
    const html = ssrPage(
      [preload],
      <BuilderRenderer doc={productionHeroDoc()} lang="pl" lcpOwner />,
    );
    const imgs = html.match(/<img[^>]*data-lcp-candidate[^>]*>/g) ?? [];
    expect(imgs).toHaveLength(1);
    const img = imgs[0] ?? "";
    expect(attr(img, "srcSet")).toBe(preload.imageSrcSet);
    expect(attr(img, "sizes")).toBe(preload.imageSizes);
    expect(attr(img, "src")).toBe(HERO_SRCSET_SAMPLE.src);
    // Jeden zasób: preload z trasy i automatyczny preload `<img>` to jeden `<link>`.
    const links = html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? [];
    expect(links).toHaveLength(1);
    expect(attr(links[0] ?? "", "imageSrcSet")).toBe(HERO_SRCSET_SAMPLE.srcset);
  });

  it("nagłówek `Link`: adres i kandydaci względni, 5 szerokości", () => {
    const value = lcpPreloadLinkHeaderValue(heroPreload());
    expect(value.startsWith(`<${HERO_SRCSET_SAMPLE.src}>;`)).toBe(true);
    expect(value).toContain(`imagesrcset="${HERO_SRCSET_SAMPLE.srcset}"`);
    expect(value).not.toContain("https://");
    expect(value.match(/ \d+w/g)).toHaveLength(5);
  });
});
