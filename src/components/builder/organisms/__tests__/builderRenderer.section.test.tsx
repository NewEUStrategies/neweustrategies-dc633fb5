// PUBLICZNY RENDERER: POWŁOKA SEKCJI (znacznik, identyfikatory, warstwy tła,
// przerywniki, typografia zakresowa, wideo tła, rodzaj „people").
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// * `layout.htmlTag` - sekcja renderuje wybrany znacznik semantyczny, a brak
//   wartości daje `<section>`,
// * OCZYSZCZANIE danych z kolumny jsonb: `sanitizeHtmlId` i `sanitizeCssClass`
//   przepuszczają poprawne wartości i MILCZĄCO odrzucają wstrzyknięcia,
// * warstwa nakładki, przerywniki kształtu (góra i dół) oraz wstrzykiwany
//   `<style>` typografii - z hartowaniem `hardenStyleCss`, czyli asercją, że
//   wartość z bazy nie potrafi zamknąć elementu `<style>`,
// * wideo tła: `IntersectionObserver` odtwarza je w kadrze i PAUZUJE poza nim
//   (to była realna oszczędność pasma i baterii na długich stronach), a brak
//   `IntersectionObserver` w przeglądarce nie wywraca renderu,
// * `data-section-kind="people"` - siatka osób rozpoznawana po zawartości
//   kolumn, także w sekcji zagnieżdżonej.
//
// ── LUKA ZAREJESTROWANA JAKO `it.fails` ────────────────────────────────────
// `videoUrl` przechodzi przez `safeImageUrl(...) || section.background.videoUrl`
// - druga część tej alternatywy PRZYWRACA odrzuconą wartość, więc sanityzacja
// tego pola nie zmienia niczego. Szczegóły przy samym przypadku.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { BuilderRenderer } from "../BuilderRenderer";
import {
  column,
  doc,
  innerSection,
  section,
  simpleSection,
  stubObservers,
  widget,
} from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  __resetBuilderDebugForTests();
});

describe("znacznik i atrybuty sekcji", () => {
  it("bez ustawienia renderuje <section>", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    expect(container.querySelector('[data-sec-id="a"]')?.tagName).toBe("SECTION");
  });

  it.each(["div", "article", "aside", "header", "footer", "main", "nav"] as const)(
    "layout.htmlTag=%s renderuje ten właśnie znacznik",
    (tag) => {
      const { container } = renderWithQueryClient(
        <BuilderRenderer doc={doc([simpleSection("a", { layout: { htmlTag: tag } })])} lang="pl" />,
      );
      expect(container.querySelector('[data-sec-id="a"]')?.tagName).toBe(tag.toUpperCase());
    },
  );

  it("poprawny htmlId i cssClass trafiają do HTML", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("a", { advanced: { htmlId: "sekcja-hero", cssClass: "tlo-ciemne" } }),
        ])}
        lang="pl"
      />,
    );
    const el = container.querySelector('[data-sec-id="a"]');
    expect(el?.getAttribute("id")).toBe("sekcja-hero");
    expect(el?.className).toContain("tlo-ciemne");
    // Klasy funkcjonalne renderera zostają na miejscu.
    expect(el?.className).toContain("overflow-hidden");
  });

  it.each([
    ["id ze spacją i cudzysłowem", '" onmouseover="alert(1)'],
    ["id z nawiasami", "hero(1)"],
  ])("wstrzyknięcie w htmlId (%s) jest odrzucane w całości", (_opis, brudne) => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("a", { advanced: { htmlId: brudne } })])}
        lang="pl"
      />,
    );
    const el = container.querySelector('[data-sec-id="a"]');
    expect(el?.hasAttribute("id")).toBe(false);
    expect(container.innerHTML).not.toContain("onmouseover");
  });

  it("wstrzyknięcie w cssClass jest odrzucane, a klasy renderera zostają", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("a", { advanced: { cssClass: 'x" onload="alert(1)' } })])}
        lang="pl"
      />,
    );
    const el = container.querySelector('[data-sec-id="a"]');
    expect(el?.className).toBe("min-w-0 max-w-full overflow-hidden");
    expect(container.innerHTML).not.toContain("onload");
  });
});

describe("warstwy dekoracyjne sekcji", () => {
  it("bez nakładki warstwa jest wyłączona (display:none), nie usunięta", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={doc([simpleSection("a")])} lang="pl" />,
    );
    const nakladka = container.querySelector<HTMLElement>('[data-sec-id="a"] > [aria-hidden]');
    expect(nakladka?.style.display).toBe("none");
  });

  it("nakładka kolorowa dostaje przezroczystość i tryb mieszania", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("a", {
            overlay: {
              type: "classic",
              color: "rgb(0, 0, 0)",
              opacity: 0.25,
              blendMode: "multiply",
            },
          }),
        ])}
        lang="pl"
      />,
    );
    const nakladka = container.querySelector<HTMLElement>('[data-sec-id="a"] > [aria-hidden]');
    expect(nakladka?.style.opacity).toBe("0.25");
    expect(nakladka?.style.mixBlendMode).toBe("multiply");
  });

  it("przerywniki kształtu renderują się u góry i u dołu", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("a", {
            shapeDividerTop: { type: "waves", height: 40 },
            shapeDividerBottom: { type: "tilt", height: 80, flipH: true },
          }),
        ])}
        lang="pl"
      />,
    );
    const svg = container.querySelectorAll('[data-sec-id="a"] svg');
    expect(svg.length).toBe(2);
    const kontenery = [
      ...container.querySelectorAll<HTMLElement>('[data-sec-id="a"] > div'),
    ].filter((el) => el.querySelector("svg"));
    expect(kontenery[0].style.top).toBe("0px");
    expect(kontenery[1].style.bottom).toBe("0px");
  });

  it('przerywnik typu "none" nie renderuje niczego', () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([simpleSection("a", { shapeDividerTop: { type: "none" } })])}
        lang="pl"
      />,
    );
    expect(container.querySelectorAll("svg").length).toBe(0);
  });
});

describe("typografia zakresowa", () => {
  it("kolory typografii jadą jako <style> ograniczony do tej sekcji", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("a", {
            typography: {
              headingColor: "rgb(1, 2, 3)",
              textColor: "rgb(4, 5, 6)",
              linkColor: "rgb(7, 8, 9)",
              linkHoverColor: "rgb(10, 11, 12)",
            },
          }),
        ])}
        lang="pl"
      />,
    );
    const css = [...container.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain('[data-sec-id="a"] :is(h1,h2,h3,h4,h5,h6){color:rgb(1, 2, 3);}');
    expect(css).toContain('[data-sec-id="a"] a:hover{color:rgb(10, 11, 12);}');
  });

  it("wartość z bazy NIE potrafi zamknąć elementu <style>", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          simpleSection("a", {
            typography: { textColor: "red}</style><script>alert(1)</script>" },
          }),
        ])}
        lang="pl"
      />,
    );
    const css = container.querySelector("style")?.textContent ?? "";
    // Hartowanie zdejmuje `<` z KOŃCOWEGO znacznika, a to jedyna droga wyjścia
    // z elementu `<style>`: jego treść jest w HTML tekstem surowym (stan
    // RAWTEXT tokenizera), więc bez `</style>` żaden dalszy znacznik nie
    // powstaje. Asercja celuje w NAPIS, nie w drzewo DOM, bo happy-dom parsuje
    // wnętrze `<style>` jak zwykły HTML - inaczej niż każda przeglądarka - i
    // asercja na drzewie mierzyłaby atrapę środowiska, nie produkcję.
    expect(css).not.toContain("</style>");
    expect(css).toContain("/style>");
    expect(css).toContain("red}");
  });

  it("wyrównanie typografii jest responsywne", () => {
    const dokument = doc([
      simpleSection("a", { typography: { align: { desktop: "left", mobile: "center" } } }),
    ]);
    const desktop = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" device="desktop" />,
    );
    expect(desktop.container.querySelector<HTMLElement>('[data-sec-id="a"]')?.style.textAlign).toBe(
      "left",
    );
    cleanup();
    const mobile = renderWithQueryClient(
      <BuilderRenderer doc={dokument} lang="pl" device="mobile" />,
    );
    expect(mobile.container.querySelector<HTMLElement>('[data-sec-id="a"]')?.style.textAlign).toBe(
      "center",
    );
  });
});

describe("wideo w tle sekcji", () => {
  const zWideo = (videoUrl: string) =>
    doc([simpleSection("a", { background: { type: "video", videoUrl } })]);

  it("renderuje odtwarzacz z autoplay, wyciszeniem i preload=metadata", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={zWideo("https://example.org/tlo.mp4")} lang="pl" />,
    );
    const video = container.querySelector("video");
    expect(video?.getAttribute("src")).toBe("https://example.org/tlo.mp4");
    expect(video?.getAttribute("preload")).toBe("metadata");
    expect(video?.hasAttribute("autoplay")).toBe(true);
    expect(video?.muted || video?.hasAttribute("muted")).toBeTruthy();
    expect(video?.hasAttribute("loop")).toBe(true);
  });

  it("tło typu video BEZ adresu nie renderuje odtwarzacza", () => {
    const { container } = renderWithQueryClient(<BuilderRenderer doc={zWideo("")} lang="pl" />);
    expect(container.querySelector("video")).toBeNull();
  });

  it("wideo poza kadrem jest PAUZOWANE, a w kadrze odtwarzane", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={zWideo("https://example.org/tlo.mp4")} lang="pl" />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    // happy-dom nie ma silnika mediów - podstawiamy same czasowniki.
    const play = vi.fn(() => Promise.resolve());
    const pause = vi.fn();
    Object.defineProperty(video, "play", { configurable: true, value: play });
    Object.defineProperty(video, "pause", { configurable: true, value: pause });

    act(() => {
      observers.triggerIntersection(true);
    });
    expect(play).toHaveBeenCalledTimes(1);

    act(() => {
      observers.triggerIntersection(false);
    });
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("odrzucona obietnica play() nie wywraca renderu", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={zWideo("https://example.org/tlo.mp4")} lang="pl" />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "play", {
      configurable: true,
      value: () => Promise.reject(new Error("autoplay zablokowany przez przeglądarkę")),
    });
    expect(() =>
      act(() => {
        observers.triggerIntersection(true);
      }),
    ).not.toThrow();
  });

  it("brak IntersectionObserver zostawia wideo w DOM i nie wywraca renderu", () => {
    observers.restore();
    Reflect.deleteProperty(globalThis, "IntersectionObserver");
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={zWideo("https://example.org/tlo.mp4")} lang="pl" />,
    );
    expect(container.querySelector("video")).not.toBeNull();
  });

  it.fails("adres wideo odrzucony przez sanityzator NIE powinien wracać do DOM", () => {
    // STAN FAKTYCZNY (L570-573): adres liczy się jako
    //   safeImageUrl(background.videoUrl) || background.videoUrl
    // Druga część alternatywy przywraca DOKŁADNIE tę wartość, którą pierwsza
    // odrzuciła (`safeImageUrl` zwraca dla niej pusty napis), więc sanityzacja
    // tego pola jest martwym kodem: do `<video src>` idzie wartość surowa.
    // `safeImageUrl` przepuszcza wyłącznie `http(s):`, `data:image/` i ścieżkę
    // bezwzględną, więc `data:text/html` jest tu adresem JAWNIE odrzuconym.
    //
    // To nie jest XSS: `<video src>` nie wykonuje skryptu, a schemat
    // `javascript:` blokuje dodatkowo sam React (podmienia atrybut). Defekt
    // polega na tym, że bramka NICZEGO nie odrzuca - a jest to pierwszy wzór,
    // który skopiuje kolejne pole adresowe. Poprawka to zdjęcie rezerwy po
    // `||`, czyli zmiana ZACHOWANIA produkcji - dlatego `it.fails`.
    const { container } = renderWithQueryClient(
      <BuilderRenderer doc={zWideo("data:text/html;base64,PHNjcmlwdD4=")} lang="pl" />,
    );
    // Oczekiwane: odrzucony adres = brak odtwarzacza (jak przy pustym `videoUrl`).
    expect(container.querySelector("video")).toBeNull();
  });
});

describe('rodzaj sekcji "people"', () => {
  it("kolumny z kartami osób oznaczają sekcję jako siatkę osób", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("zarzad", [
            column("k1", [widget("o1", "team-member", { content: {} })]),
            column("k2", [widget("o2", "author-profile-card", { content: {} })]),
          ]),
        ])}
        lang="pl"
      />,
    );
    expect(
      container.querySelector('[data-sec-id="zarzad"]')?.getAttribute("data-section-kind"),
    ).toBe("people");
  });

  it("jedna kolumna bez karty osoby zdejmuje ten rodzaj z całej sekcji", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("mieszana", [
            column("k1", [widget("o1", "team-member", { content: {} })]),
            column("k2", [widget("t1", "heading")]),
          ]),
        ])}
        lang="pl"
      />,
    );
    expect(
      container.querySelector('[data-sec-id="mieszana"]')?.hasAttribute("data-section-kind"),
    ).toBe(false);
  });

  it("sekcja ZAGNIEŻDŻONA z kartami osób też dostaje ten rodzaj", () => {
    const { container } = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([
          section("s", [
            innerSection("inner", [column("i1", [widget("o1", "team-member", { content: {} })])]),
          ]),
        ])}
        lang="pl"
      />,
    );
    const kinds = [...container.querySelectorAll("[data-section-kind]")].map((el) =>
      el.getAttribute("data-section-kind"),
    );
    expect(kinds).toEqual(["people", "people"]);
  });
});
