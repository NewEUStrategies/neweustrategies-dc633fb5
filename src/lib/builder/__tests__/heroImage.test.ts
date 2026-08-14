// Testy budowniczego preloadu LCP dokumentów buildera. Klucz: PARYTET
// deskryptora z tym, co realnie maluje widget (sizes ze wspólnych modułów,
// srcSet z buildImageSrcSet) oraz ostrożność - lepiej zero preloadu niż zły.
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { builderHeroPreload } from "@/lib/builder/heroImage";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { SLIDER_FULL_BLEED_SIZES, sliderMultiCardSizes } from "@/lib/builder/sliderSizes";
import {
  POST_LIST_GRID_COVER_SIZES,
  WIDGET_MEDIA_SPLIT_SIZES,
} from "@/lib/builder/widgetImageSizes";
import type { BuilderDocument, SectionNode, WidgetContent, WidgetNode } from "@/lib/builder/types";

const COVER = "https://p.supabase.co/storage/v1/object/public/covers/hero.jpg";

/** Pełne wiersze zapytań - setQueryData jest typowane kluczem (DataTag). */
function sliderRow(cover: string) {
  return {
    id: "post-1",
    slug: "post-1",
    title_pl: "Tytuł",
    title_en: "Title",
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: cover,
    published_at: null,
    author_id: null,
  };
}

function postListRow(cover: string) {
  return {
    id: "post-1",
    slug: "post-1",
    title_pl: "Tytuł",
    title_en: "Title",
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: cover,
    published_at: null,
    post_format: null,
    author_id: null,
  };
}

let nodeId = 0;
function widget(type: string, content: WidgetContent = {}): WidgetNode {
  return {
    id: `w-${(nodeId += 1)}`,
    kind: "widget",
    type: type as WidgetNode["type"],
    content,
  };
}

function sectionWith(widgets: WidgetNode[], extra: Partial<SectionNode> = {}): SectionNode {
  return {
    id: `s-${(nodeId += 1)}`,
    kind: "section",
    children: [
      {
        id: `c-${(nodeId += 1)}`,
        kind: "column",
        span: { desktop: 12 },
        children: widgets,
      },
    ],
    ...extra,
  };
}

function docWith(sections: SectionNode[]): BuilderDocument {
  return { version: 1, sections };
}

describe("builderHeroPreload", () => {
  it("slider (tryb posts): okładka pierwszego wpisu z cache + sizes wariantu", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts" };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [sliderRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(COVER);
    expect(preload?.imageSizes).toBe(SLIDER_FULL_BLEED_SIZES);
    expect(preload?.imageSrcSet).toContain("/storage/v1/render/image/public/");
  });

  it("slider multi-card: sizes zależne od liczby kolumn", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts", variant: "multi-card", columns: 3 };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [sliderRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.imageSizes).toBe(sliderMultiCardSizes(3));
  });

  it("slider (tryb posts) bez rozgrzanego cache: null - nie zgadujemy", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("slider", { source: "posts" })])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("slider (tryb posts) z ZEROM wpisów: null - pusty stan nie maluje obrazu", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts" };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, []);
    const doc = docWith([sectionWith([widget("slider", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("karuzela: każdy wariant maluje karty siatki - preload liczy sizes siatki", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { variant: "classic" };
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("carousel", content)])]),
      qc,
      "pl",
    );
    expect(preload?.imageSizes).toBe(POST_LIST_GRID_COVER_SIZES);
  });

  it("slider z wyłączonym coverem: null (obraz jest schowany CSS-em)", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts", showCover: false };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [sliderRow(COVER)]);
    const doc = docWith([sectionWith([widget("slider", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("slider manualny: jawny obraz pierwszego slajdu", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { items: [{ image: COVER, title_pl: "x" }] };
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(COVER);
  });

  it("widget image: preload jednoźródłowego obrazu; para light/dark i logo - null", () => {
    const qc = new QueryClient();
    const single = builderHeroPreload(
      docWith([sectionWith([widget("image", { src: COVER, alt_pl: "Okładka" })])]),
      qc,
      "pl",
    );
    expect(single?.href).toBe(COVER);
    expect(single?.imageSizes).toBe(WIDGET_MEDIA_SPLIT_SIZES);

    const dark = builderHeroPreload(
      docWith([
        sectionWith([
          widget("image", { src: COVER, srcDark: `${COVER}?dark=1`, alt_pl: "Okładka" }),
        ]),
      ]),
      qc,
      "pl",
    );
    expect(dark).toBeNull();

    const logo = builderHeroPreload(
      docWith([sectionWith([widget("image", { src: COVER, alt_pl: "Logo" })])]),
      qc,
      "pl",
    );
    expect(logo).toBeNull();
  });

  it("post-lista: okładka pierwszego wiersza z cache, sizes wariantu siatki", () => {
    const qc = new QueryClient();
    const content: WidgetContent = {};
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("post-list", content)])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(COVER);
    expect(preload?.imageSizes).toBe(POST_LIST_GRID_COVER_SIZES);
  });

  it("post-lista w wariancie miniaturowym (list): null - miniatury nie są LCP", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { variant: "list" };
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const doc = docWith([sectionWith([widget("post-list", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("pierwszy obrazowy widget wygrywa; widget schowany na desktopie jest pomijany", () => {
    const qc = new QueryClient();
    const hidden: WidgetNode = {
      ...widget("image", { src: `${COVER}?hidden=1`, alt_pl: "Ukryty" }),
      advanced: { hideOn: { desktop: true } },
    };
    const preload = builderHeroPreload(
      docWith([
        sectionWith([widget("heading", {}), hidden, widget("image", { src: COVER, alt_pl: "X" })]),
      ]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(COVER);
  });

  it("sekcja z eksperymentem A/B jest pomijana (wariant losuje się na kliencie)", () => {
    const qc = new QueryClient();
    const abSection = sectionWith([widget("image", { src: `${COVER}?ab=1`, alt_pl: "AB" })], {
      advanced: { abTest: { experimentId: "e1", variant: "a" } },
    });
    const plain = sectionWith([widget("image", { src: COVER, alt_pl: "X" })]);
    const preload = builderHeroPreload(docWith([abSection, plain]), qc, "pl");
    expect(preload?.href).toBe(COVER);
  });

  it("obrazy poza sekcjami nad zgięciem nie są preloadowane", () => {
    const qc = new QueryClient();
    const textSection = sectionWith([widget("heading", {})]);
    const imageSection = sectionWith([widget("image", { src: COVER, alt_pl: "X" })]);
    const doc = docWith([textSection, textSection, textSection, imageSection]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("nigdy nie rzuca na zepsutym dokumencie", () => {
    const qc = new QueryClient();
    const broken = { version: 1, sections: [null] } as unknown as BuilderDocument;
    expect(builderHeroPreload(broken, qc, "pl")).toBeNull();
  });
});
