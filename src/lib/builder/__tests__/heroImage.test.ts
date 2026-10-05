import { imageSlotSizes } from "../imageSlot";
// Testy budowniczego preloadu LCP dokumentów buildera. Klucz: PARYTET
// deskryptora z tym, co realnie maluje widget (sizes ze wspólnych modułów,
// srcSet z buildImageSrcSet) oraz ostrożność - lepiej zero preloadu niż zły.
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  builderContentHeroPreloads,
  builderHeroPreloads,
  lcpPreloadLinkHeaderValue,
} from "@/lib/builder/heroImage";
import { lcpCandidateIds as lcpCandidateIdsFor } from "@/lib/builder/lcpCandidate";
import { GUEST_ACCESS_CONTEXT, evaluateAccess } from "@/lib/builder/accessControl";
import { imagePreloadLinkHeaderValue } from "@/lib/seo/meta";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import { sliderMultiCardSizes } from "@/lib/builder/sliderSizes";
import {
  POST_LIST_CLASSIC_COVER_SIZES,
  POST_LIST_FLEX_LEAD_SIZES,
  POST_LIST_GRID_COVER_SIZES,
  WIDGET_MEDIA_SPLIT_SIZES,
} from "@/lib/builder/widgetImageSizes";
import type {
  BuilderDocument,
  ColumnNode,
  InnerSectionNode,
  SectionChild,
  SectionNode,
  SectionTabsConfig,
  WidgetContent,
  WidgetNode,
} from "@/lib/builder/types";

const COVER = "https://p.supabase.co/storage/v1/object/public/covers/hero.jpg";

/**
 * Pierwszy deskryptor (kandydat desktopowy, a gdy jego obrazu nie da się
 * wyznaczyć - mobilny) albo null. Dawny eksport `builderHeroPreload` usunięty
 * w rundzie 9 jako martwy kod (trasy wołają `builderHeroPreloads`); testy
 * pojedynczego kandydata zostają na tym skrócie.
 */
const builderHeroPreload = (...args: Parameters<typeof builderHeroPreloads>) =>
  builderHeroPreloads(...args)[0] ?? null;

/** Kandydaci dla gościa - te same reguły dostępu, których używa loader trasy. */
const lcpCandidateIds = (doc: BuilderDocument) =>
  lcpCandidateIdsFor(doc, { isAccessible: (rule) => evaluateAccess(rule, GUEST_ACCESS_CONTEXT) });

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
    expect(preload?.imageSizes).toBe(
      imageSlotSizes({ desktop: { vw: 100, cap: 1140 }, tablet: { vw: 100, cap: 1140 } }),
    );
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
    expect(preload?.imageSizes).toBe(
      sliderMultiCardSizes(3, { desktop: { vw: 100, cap: 1140 }, tablet: { vw: 100, cap: 1140 } }),
    );
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
    expect(single?.imageSizes).toBe(
      imageSlotSizes({ desktop: { vw: 100, cap: 1140 }, tablet: { vw: 100, cap: 1140 } }),
    );

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

  it("A/B: wariant B (niemalowany w SSR) jest pomijany, wariant A bywa kandydatem", () => {
    // PRZEPISANE ŚWIADOMIE (P1.4, werdykt LP-1 blokujące 3). Dawniej KAŻDA
    // sekcja eksperymentu była pomijana („wariant losuje się na kliencie").
    // Ale SSR i pierwszy render klienta malują deterministycznie wariant A,
    // więc jego obraz JEST pierwszym malowaniem dla każdego - a przy jednym
    // źródle preloadu (preload == obraz eager) pominięcie A zostawiało hero
    // w eksperymencie leniwe. Wariant B nie istnieje w HTML-u SSR.
    const qc = new QueryClient();
    const variantB = sectionWith([widget("image", { src: `${COVER}?b=1`, alt_pl: "B" })], {
      advanced: { abTest: { experimentId: "e1", variant: "b" } },
    });
    const variantA = sectionWith([widget("image", { src: `${COVER}?a=1`, alt_pl: "A" })], {
      advanced: { abTest: { experimentId: "e1", variant: "a" } },
    });
    const plain = sectionWith([widget("image", { src: COVER, alt_pl: "X" })]);
    expect(builderHeroPreload(docWith([variantB, plain]), qc, "pl")?.href).toBe(COVER);
    expect(builderHeroPreload(docWith([variantB, variantA, plain]), qc, "pl")?.href).toBe(
      `${COVER}?a=1`,
    );
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
    expect(builderHeroPreloads(broken, qc, "pl")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JEDNO ŹRÓDŁO KANDYDATA (P1.4, werdykt LP-2). Preload wskazuje WYŁĄCZNIE obraz
// kandydata z `lcpCandidates` - tego samego, któremu renderer daje priorytet
// i `data-lcp-candidate`. Dawniej: pierwszy preloadowalny widget w kolejności
// DOM, czyli na `/` karta listy 25vw zamiast hero.
// ─────────────────────────────────────────────────────────────────────────────

function columnSpan(widgets: WidgetNode[], span: number, order?: number): ColumnNode {
  return {
    id: `c-${(nodeId += 1)}`,
    kind: "column",
    span: { desktop: span },
    ...(order !== undefined ? { order: { mobile: order } } : {}),
    children: widgets,
  };
}

describe("builderHeroPreloads - delegacja do kandydatów LCP", () => {
  it("strona główna: preload wskazuje hero (kandydat), a nie pierwszą w DOM kartę listy", () => {
    const qc = new QueryClient();
    const list: WidgetContent = { variant: "card" };
    qc.setQueryData(postListQueryOptions(list, "pl").queryKey, [postListRow(`${COVER}?karta=1`)]);
    const sliderContent: WidgetContent = { source: "posts" };
    qc.setQueryData(sliderPostsQueryOptions(sliderContent, "pl").queryKey, [sliderRow(COVER)]);
    const doc = docWith([
      sectionOf([
        columnSpan([widget("post-list", list)], 3, 2),
        columnSpan([widget("slider", sliderContent)], 6, 1),
        columnSpan([widget("heading", {})], 3, 3),
      ]),
    ]);
    const preloads = builderHeroPreloads(doc, qc, "pl");
    expect(preloads.map((p) => p.href)).toEqual([COVER]);
  });

  it("kandydat bez wyznaczalnego obrazu: brak preloadu, BEZ przejścia do kolejnego widgetu", () => {
    // Slider (kandydat - remis slotu wygrywa slider) z pustym cache. Obraz obok
    // jest po P1.4 leniwy, więc jego preload byłby priorytetem dla nie-LCP.
    const qc = new QueryClient();
    const doc = docWith([
      sectionOf([
        columnSpan([widget("slider", { source: "posts" })], 6),
        columnSpan([widget("image", { src: COVER, alt_pl: "Obok" })], 6),
      ]),
    ]);
    expect(lcpCandidateIds(doc)).toHaveLength(1);
    expect(builderHeroPreloads(doc, qc, "pl")).toEqual([]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("dwóch kandydatów (desktop i telefon) = dwa deskryptory, desktopowy pierwszy", () => {
    const qc = new QueryClient();
    const big = `${COVER}?duzy=1`;
    const small = `${COVER}?maly=1`;
    const doc = docWith([
      sectionOf([
        columnSpan([widget("image", { src: small, alt_pl: "Mały" })], 4, 1),
        columnSpan([widget("image", { src: big, alt_pl: "Duży" })], 8, 2),
      ]),
    ]);
    expect(builderHeroPreloads(doc, qc, "pl").map((p) => p.href)).toEqual([big, small]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(big);
    // Każdy kandydat jednego urządzenia niesie `media` (recenzja m2): telefon nie
    // pobiera z High obrazu desktopowego i odwrotnie. Granica = reguła order.mobile.
    expect(builderHeroPreloads(doc, qc, "pl").map((p) => p.media)).toEqual([
      "(min-width: 768px)",
      "(max-width: 767px)",
    ]);
  });

  it("jeden kandydat dla obu urządzeń: preload BEZ `media`", () => {
    const qc = new QueryClient();
    const [preload, ...rest] = builderHeroPreloads(
      docWith([sectionWith([widget("image", { src: COVER, alt_pl: "Hero" })])]),
      qc,
      "pl",
    );
    expect(rest).toEqual([]);
    expect(preload).not.toHaveProperty("media");
  });

  it("dwóch kandydatów z TYM SAMYM kluczem zasobu daje jeden deskryptor", () => {
    // Klucz to ten, którym React łączy preload z `<img>`: bez srcSet - `href`.
    // (Ten sam plik w slotach o różnych `sizes` to DWA klucze - React też
    // wyemitowałby wtedy dwa preloady, więc deskryptory zostają dwa.)
    const qc = new QueryClient();
    const external = "https://example.org/okladka.jpg";
    const doc = docWith([
      sectionOf([
        columnSpan([widget("image", { src: external, alt_pl: "A" })], 4, 1),
        columnSpan([widget("image", { src: external, alt_pl: "B" })], 8, 2),
      ]),
    ]);
    expect(lcpCandidateIds(doc)).toHaveLength(2);
    expect(builderHeroPreloads(doc, qc, "pl")).toEqual([
      { href: external, imageSrcSet: "", imageSizes: expect.any(String) },
    ]);
    const sameStorageFile = docWith([
      sectionOf([
        columnSpan([widget("image", { src: COVER, alt_pl: "A" })], 4, 1),
        columnSpan([widget("image", { src: COVER, alt_pl: "B" })], 8, 2),
      ]),
    ]);
    // Dwa klucze (różne `sizes`) - dwa preloady, każdy ze swoim `media`.
    expect(builderHeroPreloads(sameStorageFile, qc, "pl").map((p) => p.media)).toEqual([
      "(min-width: 768px)",
      "(max-width: 767px)",
    ]);
  });

  it("reguły dostępu GOŚCIA (recenzja B1): sekcja „tylko dla zalogowanych” nie dostaje preloadu", () => {
    // Ścieżka kliencka (nawigacja SPA): dokument w przeglądarce nie jest odarty
    // z węzłów zamkniętych, więc predykat gościa musi je pominąć sam.
    const qc = new QueryClient();
    const gated = `${COVER}?zalogowani=1`;
    const doc = docWith([
      sectionWith([widget("image", { src: gated, alt_pl: "Tylko dla członków" })], {
        advanced: { access: { auth: "user" } },
      }),
      sectionWith([widget("image", { src: COVER, alt_pl: "Dla wszystkich" })]),
    ]);
    expect(builderHeroPreloads(doc, qc, "pl").map((p) => p.href)).toEqual([COVER]);
  });

  it("widget schowany na telefonie nie jest preloadowany (hideOn.mobile)", () => {
    const qc = new QueryClient();
    const hidden: WidgetNode = {
      ...widget("image", { src: `${COVER}?desktop=1`, alt_pl: "Tylko desktop" }),
      advanced: { hideOn: { mobile: true } },
    };
    const doc = docWith([sectionWith([hidden, widget("image", { src: COVER, alt_pl: "Oba" })])]);
    expect(builderHeroPreloads(doc, qc, "pl").map((p) => p.href)).toEqual([COVER]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gałęzie ODMOWY i przypadki brzegowe wyboru kandydata LCP.
//
// Zasada modułu jest jednostronna: brak preloadu kosztuje tyle, co dotychczas,
// a ZŁY preload kosztuje podwójny transfer na najdroższym obrazie strony.
// Dlatego każdy kształt, w którym serwer NIE WIE, co zostanie namalowane,
// musi mieć tu jawny dowód na `null` - nie „coś zwróciło”.
// ─────────────────────────────────────────────────────────────────────────────

function column(widgets: WidgetNode[], tabId?: string): ColumnNode {
  return {
    id: `c-${(nodeId += 1)}`,
    kind: "column",
    span: { desktop: 12 },
    ...(tabId ? { tabId } : {}),
    children: widgets,
  };
}

function innerSection(columns: ColumnNode[], tabId?: string): InnerSectionNode {
  return {
    id: `is-${(nodeId += 1)}`,
    kind: "inner-section",
    ...(tabId ? { tabId } : {}),
    columns,
  };
}

function sectionOf(children: SectionChild[], extra: Partial<SectionNode> = {}): SectionNode {
  return { id: `s-${(nodeId += 1)}`, kind: "section", children, ...extra };
}

describe("builderHeroPreload - slider: obraz zapasowy i odmowy", () => {
  it("tryb posts z wpisem BEZ okładki sięga po obraz zapasowy renderera", () => {
    // Renderer w takiej sytuacji maluje najnowszą okładkę z zapasu, więc
    // preload musi wskazać DOKŁADNIE ten sam plik - inaczej to podwójny
    // transfer, a nie przyspieszenie.
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts" };
    const fallback = "https://p.supabase.co/storage/v1/object/public/covers/zapas.jpg";
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [
      { ...sliderRow(COVER), cover_image_url: null },
    ]);
    // limit domyślny slidera to 5, a zapas liczy się jako max(3, limit).
    qc.setQueryData(sliderFallbackImagesQueryOptions(5).queryKey, [fallback]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(fallback);
    expect(preload?.imageSizes).toBe(
      imageSlotSizes({ desktop: { vw: 100, cap: 1140 }, tablet: { vw: 100, cap: 1140 } }),
    );
  });

  it("wpis bez okładki i PUSTY zapas: null zamiast zgadywania", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts", limit: 8 };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [
      { ...sliderRow(COVER), cover_image_url: null },
    ]);
    qc.setQueryData(sliderFallbackImagesQueryOptions(8).queryKey, []);
    const doc = docWith([sectionWith([widget("slider", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("slajd wskazany po postId (bez jawnego obrazu) też idzie na zapas", () => {
    // `postId` czyni slajd „związanym”, więc slider NIE jest w trybie posts,
    // ale obrazu w treści slajdu nie ma - renderer maluje zapas dla 3 slajdów.
    const qc = new QueryClient();
    const fallback = "https://p.supabase.co/storage/v1/object/public/covers/zapas2.jpg";
    qc.setQueryData(sliderFallbackImagesQueryOptions(3).queryKey, [fallback]);
    const content: WidgetContent = { items: [{ postId: "post-1" }] };
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(fallback);
  });

  it("obraz slajdu o niebezpiecznym schemacie NIE trafia do preloadu", () => {
    // `safeImageUrl` odrzuca javascript:/data:text - preload nigdy nie może
    // wstawić do <head> adresu, którego renderer i tak nie namaluje.
    const qc = new QueryClient();
    const content: WidgetContent = { items: [{ image: "javascript:alert(1)" }] };
    const doc = docWith([sectionWith([widget("slider", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("liczba kolumn spoza zakresu 1-4 jest przycinana do wartości renderera", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts", variant: "multi-card", columns: 99 };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [sliderRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.imageSizes).toBe(
      sliderMultiCardSizes(4, { desktop: { vw: 100, cap: 1140 }, tablet: { vw: 100, cap: 1140 } }),
    );
  });

  it("nieznany wariant slidera spada na wariant domyślny, a nie na null", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts", variant: "wariant-ktorego-nie-ma" };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [sliderRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("slider", content)])]),
      qc,
      "pl",
    );
    expect(preload?.imageSizes).toBe(
      imageSlotSizes({ desktop: { vw: 100, cap: 1140 }, tablet: { vw: 100, cap: 1140 } }),
    );
  });
});

describe("builderHeroPreload - widget image: odmowy", () => {
  it("brak src daje null", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("image", { alt_pl: "Bez źródła" })])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("src o niebezpiecznym schemacie daje null", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("image", { src: "javascript:alert(1)" })])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("srcDark IDENTYCZNY z src nie blokuje preloadu - to nie jest para", () => {
    const qc = new QueryClient();
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("image", { src: COVER, srcDark: COVER })])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(COVER);
  });

  it("flaga useSiteLogo daje null - src podmieni się na asset z ustawień", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("image", { src: COVER, useSiteLogo: "1" })])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("słowo „logo” w alcie ANGIELSKIM też blokuje preload", () => {
    // Renderer czyta `alt_${lang}` z fallbackiem na alt_pl, więc heurystyka
    // musi patrzeć na OBA alty - inaczej strona EN preloadowałaby logo.
    const qc = new QueryClient();
    const doc = docWith([
      sectionWith([widget("image", { src: COVER, alt_pl: "Zdjęcie", alt_en: "Company LOGO" })]),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });
});

describe("builderHeroPreload - dark-featured-card", () => {
  it("obraz karty jedzie z sizes podziału medialnego", () => {
    const qc = new QueryClient();
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("dark-featured-card", { image: COVER })])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(COVER);
    expect(preload?.imageSizes).toBe(WIDGET_MEDIA_SPLIT_SIZES);
  });

  it("karta bez obrazu daje null", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("dark-featured-card", { title_pl: "Bez obrazu" })])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });
});

describe("builderHeroPreload - post-lista: warianty i odmowy", () => {
  it("wyłączony cover (showCover: „0”) daje null", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { showCover: "0" };
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const doc = docWith([sectionWith([widget("post-list", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("rozgrzany cache z ZEROM wierszy daje null - pusta lista nic nie maluje", () => {
    const qc = new QueryClient();
    const content: WidgetContent = {};
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, []);
    const doc = docWith([sectionWith([widget("post-list", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("pierwszy wiersz bez okładki daje null - nie sięgamy po kolejny", () => {
    // Renderer maluje w tym miejscu placeholder (inline SVG), a placeholder
    // nie jest siecią. Preload drugiego wiersza byłby preloadem obrazu,
    // który przy pierwszym malowaniu jest poza kadrem.
    const qc = new QueryClient();
    const content: WidgetContent = {};
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [
      { ...postListRow(COVER), cover_image_url: null },
      postListRow(`${COVER}?drugi=1`),
    ]);
    const doc = docWith([sectionWith([widget("post-list", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("nadpisana miniatura WYGRYWA z okładką wpisu", () => {
    const qc = new QueryClient();
    const override = "https://p.supabase.co/storage/v1/object/public/covers/nadpisana.jpg";
    const content: WidgetContent = { thumbnailOverrides: { "post-1": override } };
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("post-list", content)])]),
      qc,
      "pl",
    );
    expect(preload?.href).toBe(override);
  });

  it("wariant classic dostaje sizes klasyczne, flex-grid - sizes wiodące", () => {
    for (const [variant, sizes] of [
      ["classic", POST_LIST_CLASSIC_COVER_SIZES],
      ["flex-grid", POST_LIST_FLEX_LEAD_SIZES],
      ["boxed-grid", POST_LIST_GRID_COVER_SIZES],
      ["overlay", POST_LIST_GRID_COVER_SIZES],
      ["minimal", POST_LIST_GRID_COVER_SIZES],
    ] as const) {
      const qc = new QueryClient();
      const content: WidgetContent = { variant };
      qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
      const preload = builderHeroPreload(
        docWith([sectionWith([widget("post-list", content)])]),
        qc,
        "pl",
      );
      expect(preload?.imageSizes, `wariant ${variant}`).toBe(sizes);
    }
  });

  it("wariant spoza katalogu wariantów wiodących daje null", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { variant: "wariant-z-kosmosu" };
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const doc = docWith([sectionWith([widget("post-list", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("karuzela w wariancie miniaturowym NADAL maluje kartę siatki", () => {
    // Karuzela renderuje każdy wariant przez PostCard, więc „list” na
    // karuzeli to nadal siatka - i taki musi być preload.
    const qc = new QueryClient();
    const content: WidgetContent = { variant: "list" };
    qc.setQueryData(postListQueryOptions(content, "pl").queryKey, [postListRow(COVER)]);
    const preload = builderHeroPreload(
      docWith([sectionWith([widget("carousel", content)])]),
      qc,
      "pl",
    );
    expect(preload?.imageSizes).toBe(POST_LIST_GRID_COVER_SIZES);
  });
});

describe("builderHeroPreload - obchodzenie drzewa sekcji", () => {
  it("widgety w INNER-SEKCJI są widziane tak samo jak w kolumnie", () => {
    const qc = new QueryClient();
    const doc = docWith([
      sectionOf([innerSection([column([widget("image", { src: COVER, alt_pl: "W środku" })])])]),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(COVER);
  });

  it("kolumny sekcji są przeglądane w kolejności malowania", () => {
    const qc = new QueryClient();
    const first = `${COVER}?pierwsza=1`;
    const doc = docWith([
      sectionOf([
        column([widget("heading", {})]),
        column([widget("image", { src: first, alt_pl: "A" })]),
        column([widget("image", { src: COVER, alt_pl: "B" })]),
      ]),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(first);
  });

  it("przy zakładkach liczy się TYLKO zakładka domyślna", () => {
    // Zakładki nieaktywne nie są malowane przy pierwszym renderze, więc ich
    // obrazy nie są kandydatami na LCP.
    const qc = new QueryClient();
    const tabs: SectionTabsConfig = {
      enabled: true,
      items: [
        { id: "t1", label_pl: "Pierwsza" },
        { id: "t2", label_pl: "Druga" },
      ],
      defaultTabId: "t2",
    };
    const doc = docWith([
      sectionOf(
        [
          column([widget("image", { src: `${COVER}?ukryta=1`, alt_pl: "Ukryta" })], "t1"),
          column([widget("image", { src: COVER, alt_pl: "Aktywna" })], "t2"),
        ],
        { tabs },
      ),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(COVER);
  });

  it("nieistniejąca zakładka domyślna cofa się do PIERWSZEJ zakładki", () => {
    const qc = new QueryClient();
    const tabs: SectionTabsConfig = {
      enabled: true,
      items: [
        { id: "t1", label_pl: "Pierwsza" },
        { id: "t2", label_pl: "Druga" },
      ],
      defaultTabId: "zakladka-usunieta",
    };
    const doc = docWith([
      sectionOf(
        [
          column([widget("image", { src: COVER, alt_pl: "Pierwsza" })], "t1"),
          column([widget("image", { src: `${COVER}?druga=1`, alt_pl: "Druga" })], "t2"),
        ],
        { tabs },
      ),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(COVER);
  });

  it("kolumna BEZ przypisanej zakładki jest widoczna w każdej zakładce", () => {
    const qc = new QueryClient();
    const tabs: SectionTabsConfig = {
      enabled: true,
      items: [{ id: "t1", label_pl: "Jedyna" }],
      defaultTabId: "t1",
    };
    const doc = docWith([
      sectionOf([column([widget("image", { src: COVER, alt_pl: "Wspólna" })])], { tabs }),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(COVER);
  });

  it("zakładki WYŁĄCZONE albo z pustą listą nie filtrują niczego", () => {
    const qc = new QueryClient();
    for (const tabs of [
      { enabled: false, items: [{ id: "t1", label_pl: "X" }] },
      { enabled: true, items: [] },
    ] satisfies SectionTabsConfig[]) {
      const doc = docWith([
        sectionOf([column([widget("image", { src: COVER, alt_pl: "X" })], "t9")], { tabs }),
      ]);
      expect(builderHeroPreload(doc, qc, "pl")?.href, JSON.stringify(tabs)).toBe(COVER);
    }
  });

  it("inner-sekcja przypisana do nieaktywnej zakładki jest pomijana", () => {
    const qc = new QueryClient();
    const tabs: SectionTabsConfig = {
      enabled: true,
      items: [
        { id: "t1", label_pl: "Pierwsza" },
        { id: "t2", label_pl: "Druga" },
      ],
      defaultTabId: "t1",
    };
    const doc = docWith([
      sectionOf(
        [
          innerSection([column([widget("image", { src: `${COVER}?ukryta=1` })])], "t2"),
          innerSection([column([widget("image", { src: COVER })])], "t1"),
        ],
        { tabs },
      ),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(COVER);
  });
});

describe("builderHeroPreload - okno nad zgięciem i odporność", () => {
  it("okno zerowe wyłącza preload całkowicie", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("image", { src: COVER, alt_pl: "X" })])]);
    expect(builderHeroPreload(doc, qc, "pl", 0)).toBeNull();
  });

  it("ujemne okno jest traktowane jak zerowe, a nie jak „od końca”", () => {
    // `slice(0, -1)` odcięłoby OSTATNIĄ sekcję i preloadowało wszystkie
    // pozostałe - dokładnie odwrotnie niż „nic nad zgięciem”.
    const qc = new QueryClient();
    const doc = docWith([
      sectionWith([widget("image", { src: COVER, alt_pl: "X" })]),
      sectionWith([widget("image", { src: `${COVER}?druga=1`, alt_pl: "Y" })]),
    ]);
    expect(builderHeroPreload(doc, qc, "pl", -5)).toBeNull();
  });

  it("okno większe niż dokument nie wywraca obchodzenia", () => {
    const qc = new QueryClient();
    const doc = docWith([sectionWith([widget("image", { src: COVER, alt_pl: "X" })])]);
    expect(builderHeroPreload(doc, qc, "pl", 99)?.href).toBe(COVER);
  });

  it("widget typu bez obrazu nie jest kandydatem", () => {
    const qc = new QueryClient();
    const doc = docWith([
      sectionWith([widget("heading", {}), widget("spacer", {}), widget("divider", {})]),
    ]);
    expect(builderHeroPreload(doc, qc, "pl")).toBeNull();
  });

  it("dokument bez sekcji daje null", () => {
    const qc = new QueryClient();
    expect(builderHeroPreload(docWith([]), qc, "pl")).toBeNull();
  });

  it("dokument o niepoprawnej wersji jest traktowany jak pusty", () => {
    const qc = new QueryClient();
    const legacy = {
      version: 2,
      sections: [sectionWith([widget("image", { src: COVER })])],
    } as unknown as BuilderDocument;
    expect(builderHeroPreload(legacy, qc, "pl")).toBeNull();
  });

  it("dokument, którego ODCZYT rzuca, kończy się nullem - loader trasy żyje", () => {
    // Preload jest czystą optymalizacją: żaden kształt dokumentu (ani proxy,
    // ani getter z wyjątkiem) nie może wywrócić renderu trasy.
    const qc = new QueryClient();
    const hostile = {
      version: 1,
      get sections(): SectionNode[] {
        throw new Error("uszkodzony dokument");
      },
    } as unknown as BuilderDocument;
    expect(builderHeroPreload(hostile, qc, "pl")).toBeNull();
  });

  it("język zmienia klucz zapytania, więc cache PL nie zasila preloadu EN", () => {
    const qc = new QueryClient();
    const content: WidgetContent = { source: "posts" };
    qc.setQueryData(sliderPostsQueryOptions(content, "pl").queryKey, [sliderRow(COVER)]);
    const doc = docWith([sectionWith([widget("slider", content)])]);
    expect(builderHeroPreload(doc, qc, "pl")?.href).toBe(COVER);
    expect(builderHeroPreload(doc, qc, "en")).toBeNull();
  });
});

describe("builderContentHeroPreloads - silnik treści strony (recenzja m7)", () => {
  const heroDoc = () => docWith([sectionWith([widget("image", { src: COVER, alt_pl: "Hero" })])]);

  it("treść malowana silnikiem buildera: preload kandydata", () => {
    const qc = new QueryClient();
    const preloads = builderContentHeroPreloads(
      { editor: "builder", builderDoc: heroDoc() },
      qc,
      "pl",
    );
    expect(preloads.map((p) => p.href)).toEqual([COVER]);
  });

  it.each(["blocks", "richtext", "markdown", null])(
    "edytor %s z pozostałym builder_data: brak preloadu (ContentRenderer tego nie maluje)",
    (editor) => {
      const qc = new QueryClient();
      expect(builderContentHeroPreloads({ editor, builderDoc: heroDoc() }, qc, "pl")).toEqual([]);
    },
  );

  it("edytor builder z pustym dokumentem: brak preloadu", () => {
    const qc = new QueryClient();
    expect(builderContentHeroPreloads({ editor: "builder", builderDoc: null }, qc, "pl")).toEqual(
      [],
    );
  });
});

describe("lcpPreloadLinkHeaderValue - nagłówek Link kandydata", () => {
  const input = { href: COVER, imageSrcSet: `${COVER}?w=480 480w`, imageSizes: "50vw" };

  it("bez `media` = dotychczasowa wartość z warstwy SEO (imagesrcset + imagesizes)", () => {
    expect(lcpPreloadLinkHeaderValue(input)).toBe(imagePreloadLinkHeaderValue(input));
    expect(lcpPreloadLinkHeaderValue(input)).toContain('imagesizes="50vw"');
  });

  it("kandydat jednego urządzenia: parametr `media` jak w preloadzie dokumentu", () => {
    expect(lcpPreloadLinkHeaderValue({ ...input, media: "(max-width: 767px)" })).toBe(
      `${imagePreloadLinkHeaderValue(input)}; media="(max-width: 767px)"`,
    );
  });
});
