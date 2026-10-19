// Adaptery molekuł renderera -> props widoków (interaktywne, prezentacja,
// marketing, konwersja, dane, formularze, recenzja, afiliacja, newsletter).
//
// Molekuła nie rysuje tych bloków sama - czyta `block.data` (dowolny JSON
// z bazy) i przekazuje widokowi OTYPOWANE propsy. Tu dowodzimy właśnie tej
// granicy: wartości wyliczeniowe spoza zbioru opcji wracają do domyślnej
// (widok nie dostaje „xl" zamiast „sm|md|lg|screen"), flagi „domyślnie
// włączone" / „tylko jawne true" mają właściwy kierunek, liczby z napisów są
// parsowane, a numery przypisów źródeł wykresu pochodzą WYŁĄCZNIE z kluczy
// tego bloku w mapie pre-passu.
//
// Granice: widoki (osobne pakiety, każdy z własnymi testami) i leniwe chunki
// `lazyBlockViews` są zastąpione rejestratorami propsów - to jedyny sposób,
// żeby zobaczyć, co adapter oddaje, bez sprzęgania testu ze znacznikami
// widoku. Dyspozytor `BlockView` i i18n są prawdziwe.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import type { Block, Json } from "@/lib/blocks/types";

const seen = vi.hoisted(() => {
  const calls = new Map<string, Record<string, unknown>>();
  const stub = (name: string) => (props: Record<string, unknown>) => {
    calls.set(name, props);
    return null;
  };
  const stubs = (...names: string[]) => Object.fromEntries(names.map((n) => [n, stub(n)]));
  return { calls, stubs };
});

vi.mock("../../InteractiveViews", () =>
  seen.stubs("AccordionView", "TabsView", "CountdownView", "ProgressView"),
);
vi.mock("../../PresentationViews", () =>
  seen.stubs(
    "IconBoxView",
    "StatsCounterView",
    "TestimonialsView",
    "PricingTableView",
    "TimelineView",
  ),
);
vi.mock("../../MarketingViews", () =>
  seen.stubs("HeroView", "CtaSectionView", "ImageCarouselView", "MapView"),
);
vi.mock("../../DataSocialViews", () =>
  seen.stubs(
    "TeamGridView",
    "LogoGridView",
    "FeatureGridView",
    "AlertBannerView",
    "DividerTextView",
  ),
);
vi.mock("../../ConversionViews", () =>
  seen.stubs("StepListView", "ComparisonTableView", "BannerImageView", "VideoHeroView"),
);
vi.mock("../../ReviewBlockView", () => seen.stubs("ReviewBlockView"));
vi.mock("../../AffiliateBlockView", () => seen.stubs("AffiliateBlockView"));
vi.mock("../lazyBlockViews", () =>
  seen.stubs(
    "LiveBlogBlock",
    "PollBlockView",
    "CalendarView",
    "ChartBlockView",
    "DataMapBlockView",
    "NewsletterForm",
    "ContactFormView",
    "LoginFormView",
    "RegisterFormView",
    "LostPasswordFormView",
    "ResetPasswordFormView",
  ),
);

import { BlockView } from "../registry";

function propsOf(
  type: string,
  data: Record<string, Json>,
  view: string,
  fnHtml: ReadonlyMap<string, string> = new Map(),
) {
  const block = { id: "b1", type, data } as Block;
  render(<BlockView block={block} fnHtml={fnHtml} lang="en" allBlocks={[block]} />);
  const props = seen.calls.get(view);
  if (!props) throw new Error(`widok ${view} nie został wyrenderowany dla bloku ${type}`);
  return props;
}

beforeEach(() => {
  seen.calls.clear();
});

describe("wartości wyliczeniowe spoza zbioru opcji wracają do domyślnej", () => {
  it.each([
    ["tabs", { orientation: "diagonal" }, "TabsView", { orientation: "horizontal" }],
    ["tabs", { orientation: "vertical" }, "TabsView", { orientation: "vertical" }],
    ["progress", { color: "tęcza" }, "ProgressView", { color: "primary" }],
    ["progress", { color: "danger" }, "ProgressView", { color: "danger" }],
    ["progress", { color: "warning" }, "ProgressView", { color: "warning" }],
    ["progress", { color: "success" }, "ProgressView", { color: "success" }],
    ["icon-box", { align: "right" }, "IconBoxView", { align: "center", icon: "star" }],
    ["icon-box", { align: "left", icon: "globe" }, "IconBoxView", { align: "left", icon: "globe" }],
    ["testimonials", { layout: "masonry" }, "TestimonialsView", { layout: "grid" }],
    ["testimonials", { layout: "slider" }, "TestimonialsView", { layout: "slider" }],
    ["hero", { height: "xl", align: "right" }, "HeroView", { height: "md", align: "center" }],
    ["hero", { height: "screen", align: "left" }, "HeroView", { height: "screen", align: "left" }],
    ["cta-section", { variant: "neon" }, "CtaSectionView", { variant: "primary" }],
    ["cta-section", { variant: "gradient" }, "CtaSectionView", { variant: "gradient" }],
    ["team-grid", { shape: "hexagon" }, "TeamGridView", { shape: "circle", columns: 3 }],
    [
      "team-grid",
      { shape: "square", columns: "4" },
      "TeamGridView",
      { shape: "square", columns: 4 },
    ],
    ["feature-grid", { style: "glass" }, "FeatureGridView", { style: "card", columns: 3 }],
    ["feature-grid", { style: "bordered" }, "FeatureGridView", { style: "bordered" }],
    ["alert-banner", { variant: "critical" }, "AlertBannerView", { variant: "info" }],
    ["alert-banner", { variant: "neutral" }, "AlertBannerView", { variant: "neutral" }],
    [
      "divider-text",
      { align: "top", lineStyle: "wavy" },
      "DividerTextView",
      { align: "center", lineStyle: "solid" },
    ],
    [
      "divider-text",
      { align: "right", lineStyle: "dotted" },
      "DividerTextView",
      { align: "right", lineStyle: "dotted" },
    ],
    [
      "step-list",
      { orientation: "spiral", numberStyle: "roman" },
      "StepListView",
      { orientation: "vertical", numberStyle: "circle" },
    ],
    [
      "step-list",
      { orientation: "horizontal", numberStyle: "plain" },
      "StepListView",
      { orientation: "horizontal", numberStyle: "plain" },
    ],
    [
      "banner-image",
      { position: "top", theme: "sepia" },
      "BannerImageView",
      { position: "left", theme: "dark", aspect: "21:9", overlay: 35 },
    ],
    [
      "banner-image",
      { position: "right", theme: "light" },
      "BannerImageView",
      { position: "right", theme: "light" },
    ],
    [
      "video-hero",
      { height: "sm", align: "right" },
      "VideoHeroView",
      { height: "lg", align: "center", overlay: 45 },
    ],
    [
      "video-hero",
      { height: "screen", align: "left" },
      "VideoHeroView",
      { height: "screen", align: "left" },
    ],
  ] as const)("%s %j -> %s %j", (type, data, view, expected) => {
    expect(propsOf(type, data as Record<string, Json>, view)).toMatchObject(expected);
  });
});

describe("flagi: „domyślnie włączone” kontra „tylko jawne true”", () => {
  it("napis „true” nie włącza flag wymagających jawnego true", () => {
    expect(propsOf("accordion", { allowMultiple: "true" }, "AccordionView")).toMatchObject({
      allowMultiple: false,
      items: [],
    });
    expect(propsOf("image-carousel", { autoplay: "true" }, "ImageCarouselView")).toMatchObject({
      autoplay: false,
      interval: 5000,
      aspect: "16:9",
    });
    expect(propsOf("logo-grid", { bordered: 1 }, "LogoGridView")).toMatchObject({
      bordered: false,
      grayscale: true,
      columns: 5,
    });
    expect(propsOf("alert-banner", { dismissible: "yes" }, "AlertBannerView")).toMatchObject({
      dismissible: false,
      showIcon: true,
    });
  });

  it("flagi domyślnie włączone wyłącza tylko jawne false", () => {
    expect(propsOf("contact-form", { showPhone: true }, "ContactFormView")).toMatchObject({
      showPhone: true,
      showSubject: true,
      requireConsent: true,
      lang: "en",
    });
    expect(
      propsOf("contact-form", { showSubject: false, requireConsent: false }, "ContactFormView"),
    ).toMatchObject({ showPhone: false, showSubject: false, requireConsent: false });
    expect(propsOf("video-hero", { autoplay: false }, "VideoHeroView")).toMatchObject({
      autoplay: false,
      loop: true,
    });
    expect(propsOf("progress", { value: "75", showValue: false }, "ProgressView")).toMatchObject({
      value: 75,
      showValue: false,
    });
    expect(propsOf("affiliate", { rating: "4.5" }, "AffiliateBlockView")).toMatchObject({
      rating: 4.5,
      sponsored: true,
      lang: "en",
    });
  });
});

describe("liczby, listy i przekazanie danych", () => {
  it("mapa: współrzędne z napisów, a nieliczbowe wracają do domyślnych (Warszawa)", () => {
    expect(propsOf("map", { lat: "50.06", lng: "abc", zoom: 99 }, "MapView")).toMatchObject({
      lat: 50.06,
      lng: 21.0122,
      zoom: 99,
      height: 360,
    });
  });

  it("listy JSON trafiają do widoków jako tablice (nie-tablica -> pusta)", () => {
    const items = [{ title: "A" }, { title: "B" }];
    expect(propsOf("timeline", { items }, "TimelineView").items).toEqual(items);
    expect(propsOf("pricing-table", { plans: "brak" }, "PricingTableView").plans).toEqual([]);
    expect(propsOf("stats-counter", { items }, "StatsCounterView")).toMatchObject({
      items,
      duration: 1500,
      lang: "en",
    });
    expect(
      propsOf("comparison-table", { columns: ["A"], rows: [["x"]] }, "ComparisonTableView"),
    ).toMatchObject({ columns: ["A"], rows: [["x"]], featuredIndex: -1 });
    expect(
      propsOf("countdown", { targetAt: "2027-01-01T00:00:00Z" }, "CountdownView"),
    ).toMatchObject({ targetAt: "2027-01-01T00:00:00Z", label: "", expiredText: "", lang: "en" });
  });

  it("recenzja mapuje kryteria (pomija nie-obiekty, ocena liczbowa z domyślnym 0)", () => {
    const props = propsOf(
      "review",
      { title: "Laptop", criteria: [{ label: "Bateria", score: "8" }, "zły", { label: "Ekran" }] },
      "ReviewBlockView",
    );
    expect(props).toMatchObject({ title: "Laptop", scale: 10, lang: "en" });
    expect(props.criteria).toEqual([
      { label: "Bateria", score: 8 },
      { label: "Ekran", score: 0 },
    ]);
  });

  it("newsletter: wariant inline/card, tytuł i opis widoczne nad formularzem", () => {
    const block = {
      id: "n",
      type: "newsletter",
      data: { title: "Bądź na bieżąco", description: "Raz w tygodniu", variant: "inline" },
    } as Block;
    const { getByRole, getByText } = render(
      <BlockView block={block} fnHtml={new Map()} lang="pl" allBlocks={[block]} />,
    );
    expect(getByRole("heading", { name: "Bądź na bieżąco" })).toBeTruthy();
    expect(getByText("Raz w tygodniu")).toBeTruthy();
    expect(seen.calls.get("NewsletterForm")).toMatchObject({
      lang: "pl",
      source: "inline-block",
      variant: "inline",
    });
    expect(propsOf("newsletter", { variant: "popup" }, "NewsletterForm").variant).toBe("card");
  });

  it.each([
    ["login-form", "LoginFormView"],
    ["register-form", "RegisterFormView"],
    ["lost-password-form", "LostPasswordFormView"],
    ["reset-password-form", "ResetPasswordFormView"],
  ])("formularz %s dostaje surowe dane bloku i język", (type, view) => {
    const data = { title: "Konto", redirectTo: "/panel" };
    expect(propsOf(type, data, view)).toMatchObject({ data, lang: "en" });
  });
});

describe("numery przypisów źródeł wykresu i mapy danych", () => {
  it("bierze tylko całkowite numery z kluczy `${id}:source:*` TEGO bloku", () => {
    const fnHtml = new Map([
      ["b1:source:eurostat", "3"],
      ["b1:source:gus", "4"],
      ["b1:source:zly", "x"],
      ["b1:source:ulamek", "1.5"],
      ["b2:source:obcy", "9"],
      ["b1:text", "7"],
    ]);
    const chart = propsOf("chart", { kind: "bar" }, "ChartBlockView", fnHtml);
    expect(chart.data).toEqual({ kind: "bar" });
    expect([...(chart.footnotes as Map<string, number>)]).toEqual([
      ["eurostat", 3],
      ["gus", 4],
    ]);
    const map = propsOf("data-map", {}, "DataMapBlockView", fnHtml);
    expect([...(map.footnotes as Map<string, number>)]).toEqual([
      ["eurostat", 3],
      ["gus", 4],
    ]);
  });

  it("bez pre-passu (pusta mapa) wykres dostaje pustą mapę i numeruje źródła sam", () => {
    const chart = propsOf("chart", {}, "ChartBlockView");
    expect((chart.footnotes as Map<string, number>).size).toBe(0);
  });
});
