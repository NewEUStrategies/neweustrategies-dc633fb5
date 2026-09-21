// PUBLICZNY RENDERER: KOLUMNA - WYRÓWNANIA, GRUPOWANIE WIDGETÓW, EDYCJA INLINE.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// `RenderColumn` to najbardziej rozgałęziona funkcja tego pliku: dwa niezależne
// zestawy klas (osi poprzecznej i pionowej) po CZTERY warianty każdy, a wybór
// zestawu zależy od tego, czy kolumna jest „paskiem narzędzi" - czyli czy ma
// więcej niż jeden widget i czy KAŻDY z nich jest widgetem kompaktowym albo
// samo-wymiarującym. Każda z tych kombinacji ma tu przypadek, bo to ona decyduje
// o wyglądzie chrome (nagłówek strony, stopka) na każdej stronie serwisu.
//
// Dalej:
// * grupowanie `advanced.layout: "inline"` - sąsiadujące widgety inline lądują
//   w JEDNYM wierszu, blokowe przerywają grupę,
// * `onlyOneBlock` - jedyny blok w kolumnie rozpycha się na wysokość (`flex-1`),
//   a dwa bloki już nie,
// * styl kolumny z dokumentu (minHeight, kolory, promień) i oczyszczanie
//   `cssClass`,
// * edycja inline: kontekst `InlineEditProvider` (podawany WYŁĄCZNIE przez kanwę
//   buildera) przełącza widgety w tryb `contenteditable` i przekazuje zmianę
//   z powrotem do dokumentu; strona publiczna nie ma tego kontekstu, więc
//   czytelnik nigdy nie dostaje edytowalnej treści.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent } from "@testing-library/react";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { InlineEditProvider } from "@/components/builder/inlineEditContext";
import { COLUMN_SAFE_AREA_PX } from "@/lib/builder/sectionStyles";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import { BuilderRenderer } from "../BuilderRenderer";
import { column, doc, section, stubObservers, widget } from "./builderRendererFixtures";

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

/** Wewnętrzny węzeł kolumny (ten z klasami wyrównań), nie slot siatki. */
const kolumna = (container: HTMLElement, id = "k") =>
  container.querySelector<HTMLElement>(`[data-col-id="${id}"]:not([data-column-slot])`);

function render(kol: ReturnType<typeof column>) {
  return renderWithQueryClient(
    <BuilderRenderer doc={doc([section("s", [kol])])} lang="pl" device="desktop" />,
  );
}

/** Ta sama kolumna, ale jako dokument POWŁOKI (nagłówek/stopka) - prop `chrome`. */
function renderPowloka(kol: ReturnType<typeof column>) {
  return renderWithQueryClient(
    <BuilderRenderer doc={doc([section("s", [kol])])} lang="pl" device="desktop" chrome />,
  );
}

/** Ta sama kolumna w kanwie buildera (`VisualCanvas` podaje `editorPreview`). */
function renderKanwa(kol: ReturnType<typeof column>) {
  return renderWithQueryClient(
    <BuilderRenderer doc={doc([section("s", [kol])])} lang="pl" device="desktop" editorPreview />,
  );
}

/** Wiersz grupy inline - pierwsze dziecko wewnętrznego węzła kolumny. */
const wierszInline = (container: HTMLElement) =>
  kolumna(container)?.firstElementChild as HTMLElement;

describe("kolumna zwykła (nie pasek narzędzi)", () => {
  const trescBlokowa = [widget("w1", "heading"), widget("w2", "heading")];

  it.each([
    [undefined, "items-stretch"],
    ["center", "items-center"],
    ["end", "items-end"],
    ["start", "items-start"],
  ] as const)("contentAlign=%s daje klasę %s", (contentAlign, klasa) => {
    const { container } = render(column("k", trescBlokowa, { contentAlign }));
    expect(kolumna(container)?.className).toContain(klasa);
  });

  it.each([
    [undefined, "justify-start"],
    ["center", "justify-center"],
    ["end", "justify-end"],
    ["stretch", "justify-stretch"],
  ] as const)("verticalAlign=%s daje klasę %s", (verticalAlign, klasa) => {
    const { container } = render(column("k", trescBlokowa, { verticalAlign }));
    expect(kolumna(container)?.className).toContain(klasa);
  });

  it("jeden widget kompaktowy to JESZCZE nie pasek narzędzi (potrzeba dwóch)", () => {
    const { container } = render(column("k", [widget("w1", "button", { content: {} })]));
    // Zestaw klas „zwykły", nie „paskowy": osi poprzecznej items-*, nie justify-*.
    expect(kolumna(container)?.className).toContain("items-stretch");
    expect(kolumna(container)?.className).toContain("justify-start");
  });
});

describe("kolumna jako PASEK NARZĘDZI", () => {
  // Dwa widgety, oba samo-wymiarujące (`AUTO_SIZE_WIDGETS`) - dokładnie tak
  // wygląda para przycisków w nagłówku strony.
  const paskowa = [
    widget("b1", "button", { content: {} }),
    widget("b2", "button", { content: {} }),
  ];

  it.each([
    [undefined, "justify-between"],
    ["center", "justify-center"],
    ["end", "justify-end"],
    ["start", "justify-start"],
  ] as const)("contentAlign=%s rozkłada pasek klasą %s", (contentAlign, klasa) => {
    const { container } = render(column("k", paskowa, { contentAlign }));
    expect(kolumna(container)?.className).toContain(klasa);
  });

  it.each([
    [undefined, "content-start items-center"],
    ["center", "content-center items-center"],
    ["end", "content-end items-end"],
    ["stretch", "content-stretch items-stretch"],
  ] as const)("verticalAlign=%s daje klasy %s", (verticalAlign, klasy) => {
    const { container } = render(column("k", paskowa, { verticalAlign }));
    for (const k of klasy.split(" ")) expect(kolumna(container)?.className).toContain(k);
  });

  it("widgety paska jadą w JEDNYM wierszu, mimo braku layout: inline", () => {
    const { container } = render(column("k", paskowa));
    const wiersz = kolumna(container)?.firstElementChild as HTMLElement;
    expect(wiersz.className).toContain("flex-row");
    expect(wiersz.querySelectorAll("[data-widget-id]").length).toBe(2);
    expect(
      [...wiersz.querySelectorAll("[data-widget-id]")].map((el) =>
        el.getAttribute("data-widget-layout"),
      ),
    ).toEqual(["inline", "inline"]);
  });

  it("REGRESJA CLS: kolumna POWŁOKI trzyma min-height nawet bez zawartości", () => {
    // Publiczny fallback granicy Suspense leniwego widgetu to `null`
    // (`lazySuspense.tsx`). Pilna aktualizacja przed dojściem chunku potrafi
    // porzucić strumieniowany HTML - wtedy `search-button`/`account-link`
    // znikały, kolumna zapadała się do paddingu, a `<main>` podskakiwało
    // o ~89 px (CLS 0,13 przy progu 0,1). Rezerwa idzie z tego samego
    // szacunku, którym `HeaderSkeleton` trzyma miejsce.
    const pusta = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([section("s", [column("k", [])])])}
        lang="pl"
        device="desktop"
        chrome
      />,
    );
    expect(kolumna(pusta.container)?.style.minHeight).toBe(`${2 * COLUMN_SAFE_AREA_PX}px`);
    cleanup();

    const paskowaKol = renderWithQueryClient(
      <BuilderRenderer
        doc={doc([section("s", [column("k", paskowa)])])}
        lang="pl"
        device="desktop"
        chrome
      />,
    );
    expect(Number.parseFloat(kolumna(paskowaKol.container)!.style.minHeight)).toBeGreaterThan(
      2 * COLUMN_SAFE_AREA_PX,
    );
  });

  it("treść strony NIE dostaje rezerwy - tam szacunek jest zgrubny", () => {
    const { container } = render(column("k", paskowa));
    expect(kolumna(container)?.style.minHeight).toBe("");
  });

  it("REGRESJA CLS: pasek POWŁOKI nie zawija się do drugiej linii", () => {
    // `estimateChromeColumnHeight` (rezerwa `HeaderSkeleton`) liczy pasek jako
    // JEDEN rząd - wysokość = najwyższy widget, nie suma. Przy `flex-wrap` ta
    // obietnica zależała od szerokości TEKSTU: ten sam nagłówek mieścił się
    // w jednej linii lokalnie, a na runnerze CI (inny fallback fontu, szerszy
    // krój) przeskakiwał do dwóch. Wiersz rósł z 30 na 66 px, nagłówek za nim,
    // a `<main>` zjeżdżało w dół - CLS 0,1348 przy progu 0,1.
    const { container } = renderPowloka(column("k", paskowa));
    expect(wierszInline(container).className).toContain("flex-nowrap");
    expect(wierszInline(container).className).not.toContain("flex-wrap ");
  });

  it("TREŚĆ STRONY zawija pasek - tam nadmiar byłby PRZYCIĘTY, nie zarezerwowany", () => {
    // Zakaz zawijania płaci się przycięciem nadmiaru przez `data-column-slot`
    // / kontener sekcji. W treści redakcyjnej nie ma za co: kolumna nie dostaje
    // rezerwy wysokości (patrz test wyżej), więc ma prawo urosnąć, a przycięcie
    // schowałoby etykiety i kontrolki - wąska strona CMS z kolumną kilku
    // przycisków traciła je za krawędzią (recenzja PR #383).
    const { container } = render(column("k", paskowa));
    expect(wierszInline(container).className).toContain("flex-wrap");
    expect(wierszInline(container).className).not.toContain("flex-nowrap");
  });

  it("KANWA BUILDERA zawija pasek - podgląd nie ma rezerwy powłoki", () => {
    // `VisualCanvas` renderuje sekcje z `editorPreview` i BEZ `chrome`, także
    // dla dokumentu nagłówka. Redaktor musi widzieć wszystkie widgety kolumny
    // w wąskiej ramce podglądu, żeby móc je kliknąć.
    const { container } = renderKanwa(column("k", paskowa));
    expect(wierszInline(container).className).toContain("flex-wrap");
    expect(wierszInline(container).className).not.toContain("flex-nowrap");
  });

  it("JEDEN widget nie-kompaktowy w zestawie zdejmuje tryb paska", () => {
    const { container } = render(
      column("k", [widget("b1", "button", { content: {} }), widget("t1", "heading")]),
    );
    expect(kolumna(container)?.className).toContain("items-stretch");
    // Widgety wracają do układu blokowego, każdy w swoim wierszu.
    expect(
      [...container.querySelectorAll("[data-widget-id]")].map((el) =>
        el.getAttribute("data-widget-layout"),
      ),
    ).toEqual(["block", "block"]);
  });

  it("widget kompaktowy (menu, przełącznik języka) też tworzy pasek", () => {
    const { container } = render(
      column("k", [
        widget("m1", "lang-switcher", { content: {} }),
        widget("m2", "theme-toggle", { content: {} }),
      ]),
    );
    expect(kolumna(container)?.className).toContain("justify-between");
  });
});

describe("grupowanie widgetów inline", () => {
  it("grupa inline ZADEKLAROWANA przez autora nadal zawija się do kolejnych linii", () => {
    // Tam wiersz jest TREŚCIĄ, nie paskiem chrome: przycięcie nadmiaru
    // ukryłoby redakcyjne bloki, a zawinięcie jest zamierzone.
    const { container } = render(
      column("k", [
        widget("i1", "heading", { advanced: { layout: "inline" } }),
        widget("i2", "heading", { advanced: { layout: "inline" } }),
      ]),
    );
    const wiersz = kolumna(container)?.firstElementChild as HTMLElement;
    expect(wiersz.className).toContain("flex-wrap");
    expect(wiersz.className).not.toContain("flex-nowrap");
  });

  it("grupa inline autora zawija się TAKŻE w powłoce - to nie jest pasek narzędzi", () => {
    // `isToolbar` wymaga, by KAŻDY widget kolumny był kompaktowy; tu są to
    // nagłówki, więc nawet dokument powłoki nie dostaje `flex-nowrap`.
    const { container } = renderPowloka(
      column("k", [
        widget("i1", "heading", { advanced: { layout: "inline" } }),
        widget("i2", "heading", { advanced: { layout: "inline" } }),
      ]),
    );
    expect(wierszInline(container).className).toContain("flex-wrap");
    expect(wierszInline(container).className).not.toContain("flex-nowrap");
  });

  it("sąsiadujące widgety inline trafiają do jednego wiersza, blokowy przerywa grupę", () => {
    const { container } = render(
      column("k", [
        widget("i1", "heading", { advanced: { layout: "inline" } }),
        widget("i2", "heading", { advanced: { layout: "inline" } }),
        widget("b1", "heading"),
        widget("i3", "heading", { advanced: { layout: "inline" } }),
      ]),
    );
    const uklady = [...container.querySelectorAll("[data-widget-id]")].map((el) => [
      el.getAttribute("data-widget-id"),
      el.getAttribute("data-widget-layout"),
    ]);
    expect(uklady).toEqual([
      ["i1", "inline"],
      ["i2", "inline"],
      ["b1", "block"],
      ["i3", "inline"],
    ]);
    // Dwie grupy inline: pierwsza dwuelementowa, druga jednoelementowa.
    const wiersze = [...container.querySelectorAll(".flex-row")];
    expect(wiersze).toHaveLength(2);
    expect(wiersze[0].querySelectorAll("[data-widget-id]").length).toBe(2);
    expect(wiersze[1].querySelectorAll("[data-widget-id]").length).toBe(1);
  });

  it("kolumna bez widgetów renderuje sam kontener, bez grup", () => {
    const { container } = render(column("k", []));
    expect(kolumna(container)).not.toBeNull();
    expect(kolumna(container)?.childElementCount).toBe(0);
  });
});

describe("onlyOneBlock - jedyny blok rozpycha kolumnę", () => {
  it("jeden blokowy widget dostaje flex-1", () => {
    const { container } = render(column("k", [widget("w1", "heading")]));
    expect(container.querySelector('[data-widget-id="w1"]')?.className).toContain("flex-1");
  });

  it("dwa bloki NIE dostają flex-1 (inaczej dzieliłyby wysokość na pół)", () => {
    const { container } = render(column("k", [widget("w1", "heading"), widget("w2", "heading")]));
    expect(container.querySelector('[data-widget-id="w1"]')?.className).not.toContain("flex-1");
  });

  it("jedyny widget INLINE nie jest jedynym blokiem", () => {
    const { container } = render(
      column("k", [widget("w1", "heading", { advanced: { layout: "inline" } })]),
    );
    expect(container.querySelector('[data-widget-id="w1"]')?.className).not.toContain("flex-1");
  });
});

describe("styl kolumny z dokumentu", () => {
  it("przenosi minHeight, tło, kolor tekstu i promień, dokładając bezpieczny margines", () => {
    const { container } = render(
      column("k", [widget("w1")], {
        style: {
          minHeight: "240px",
          bgColor: "rgb(9, 9, 9)",
          textColor: "rgb(8, 8, 8)",
          borderRadius: "12px",
        },
      }),
    );
    const el = kolumna(container);
    expect(el?.style.minHeight).toBe("240px");
    expect(el?.style.background).toBe("rgb(9, 9, 9)");
    expect(el?.style.color).toBe("rgb(8, 8, 8)");
    expect(el?.style.borderRadius).toBe("12px");
    expect(el?.style.padding).toBe(`${COLUMN_SAFE_AREA_PX}px`);
    expect(el?.style.boxSizing).toBe("border-box");
  });

  it("poprawna cssClass dochodzi do klas, wstrzyknięcie jest odrzucane", () => {
    const czysta = render(column("k", [widget("w1")], { advanced: { cssClass: "kolumna-hero" } }));
    expect(kolumna(czysta.container)?.className).toContain("kolumna-hero");
    cleanup();
    const brudna = render(
      column("k", [widget("w1")], { advanced: { cssClass: 'x" onmouseover="alert(1)' } }),
    );
    expect(brudna.container.innerHTML).not.toContain("onmouseover");
  });
});

describe("edycja inline (kontekst kanwy buildera)", () => {
  const dokument = doc([
    section("s", [column("k", [widget("w1", "heading", { content: { text_pl: "Stary napis" } })])]),
  ]);

  it("BEZ kontekstu (strona publiczna) treść nie jest edytowalna", () => {
    const { container } = renderWithQueryClient(<BuilderRenderer doc={dokument} lang="pl" />);
    expect(container.querySelector("[contenteditable]")).toBeNull();
  });

  it("Z kontekstem treść staje się edytowalna, a zmiana wraca z identyfikatorem widgetu", () => {
    const onContentChange = vi.fn();
    const { container } = renderWithQueryClient(
      <InlineEditProvider onContentChange={onContentChange}>
        <BuilderRenderer doc={dokument} lang="pl" />
      </InlineEditProvider>,
    );
    const pole = container.querySelector<HTMLElement>("[contenteditable]");
    expect(pole).not.toBeNull();

    pole!.textContent = "Nowy napis";
    fireEvent.blur(pole!);

    expect(onContentChange).toHaveBeenCalledTimes(1);
    const [widgetId, klucz, wartosc] = onContentChange.mock.calls[0];
    expect(widgetId).toBe("w1");
    expect(klucz).toBe("text_pl");
    expect(wartosc).toBe("Nowy napis");
  });

  it("zmiana na tę samą wartość nie budzi zapisu", () => {
    const onContentChange = vi.fn();
    const { container } = renderWithQueryClient(
      <InlineEditProvider onContentChange={onContentChange}>
        <BuilderRenderer doc={dokument} lang="pl" />
      </InlineEditProvider>,
    );
    const pole = container.querySelector<HTMLElement>("[contenteditable]");
    fireEvent.blur(pole!);
    expect(onContentChange).not.toHaveBeenCalled();
  });
});
