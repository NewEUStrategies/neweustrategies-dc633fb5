// WĘZEŁ WIDGETU (`BuilderWidgetNode`) - LINK CAŁEGO WIDGETU, PRZEKAZANIE EDYCJI
// I GRANICA `memo`.
//
// ── CO TU MA DOWÓD ─────────────────────────────────────────────────────────
// Ramkę (klasy kontra inline, parytet SSR) pilnuje
// `builderWidgetNodeFrame.test.tsx`. Tu dowodzimy trzech pozostałych
// obowiązków węzła:
// * LINK CAŁEGO WIDGETU (`advanced.link`): adres przez `safeUrl` (adres
//   `javascript:` z bazy nie może stać się klikalnym skryptem), `target`
//   z domyślnym `_self`, `rel` składany z `_blank` (noopener noreferrer),
//   `nofollow` i własnej wartości - bez pustego atrybutu, oraz nazwa dostępna
//   (link nakładki nie ma własnej treści, więc bez niej czytnik ekranu ogłasza
//   pusty link),
// * EDYCJA W MIEJSCU: dyspozytor dostaje `editable` i wywołanie zwrotne, które
//   dokleja identyfikator widgetu - renderer kolumny trzyma jedno wywołanie
//   `(widgetId, key, value)` dla wszystkich widgetów,
// * GRANICA `memo`: jedyny powód istnienia tego modułu (nagłówek pliku) to to,
//   że edycja jednego widgetu NIE renderuje ponownie pozostałych. Nowy obiekt
//   węzła o tej samej płaskiej treści nie renderuje treści od nowa; zmiana
//   wartości, klucza, `globalId`, języka, urządzenia albo wywołania zwrotnego -
//   renderuje.
//
// ── GRANICE ────────────────────────────────────────────────────────────────
// Dyspozytor treści (`ChromeWidgetView`) jest podmieniony atrapą, która
// zapisuje propsy każdego renderu: to DOKŁADNIE granica, którą węzeł ma
// chronić. `getWidgetFrameStyle` z tego samego modułu zostaje prawdziwy - ramka
// liczy się tak jak w produkcji.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { WidgetNode } from "@/lib/builder/types";
import { BuilderWidgetNode } from "../BuilderWidgetNode";
import { widget } from "./builderRendererFixtures";

interface ZapisRenderu {
  id: string;
  lang: string;
  device: string;
  editable: boolean | undefined;
  onContentChange: ((key: string, value: string | number) => void) | undefined;
}

const h = vi.hoisted(() => ({ rendery: [] as ZapisRenderu[] }));

vi.mock("@/components/builder/organisms/ChromeWidgetView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/builder/organisms/ChromeWidgetView")>()),
  ChromeWidgetView: (p: {
    node: WidgetNode;
    lang: string;
    device: string;
    editable?: boolean;
    onContentChange?: (key: string, value: string | number) => void;
  }) => {
    h.rendery.push({
      id: p.node.id,
      lang: p.lang,
      device: p.device,
      editable: p.editable,
      onContentChange: p.onContentChange,
    });
    return <span data-testid={`tresc-${p.node.id}`} />;
  },
}));

afterEach(() => {
  cleanup();
  h.rendery = [];
});

type Props = ComponentProps<typeof BuilderWidgetNode>;

function wezel(props: Partial<Props> & { widget: WidgetNode }) {
  return (
    <BuilderWidgetNode lang="pl" device="desktop" inRow={false} onlyOneBlock={false} {...props} />
  );
}

const zLinkiem = (link: NonNullable<WidgetNode["advanced"]>["link"]) =>
  widget("w", "heading", { advanced: { link } });

describe("BuilderWidgetNode - link całego widgetu", () => {
  it("nowa karta: rel łączy noopener noreferrer, nofollow i własną wartość; nazwa z aria-label", () => {
    render(
      wezel({
        widget: zLinkiem({
          url: "https://example.org/raport",
          target: "_blank",
          nofollow: true,
          rel: "sponsored",
          ariaLabel: "Pobierz raport",
        }),
      }),
    );
    const link = screen.getByRole("link", { name: "Pobierz raport" });
    expect(link.getAttribute("href")).toBe("https://example.org/raport");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow sponsored");
  });

  it("bez targetu: _self i BEZ pustego atrybutu rel; nazwa z etykiety odnośnika", () => {
    render(wezel({ widget: zLinkiem({ url: "/o-nas", refLabel: "O nas" }) }));
    const link = screen.getByRole("link", { name: "O nas" });
    expect(link.getAttribute("target")).toBe("_self");
    expect(link.hasAttribute("rel")).toBe(false);
    expect(link.hasAttribute("aria-label")).toBe(false);
  });

  it("bez żadnej etykiety nazwą linku jest sam adres - nigdy pusty link", () => {
    render(wezel({ widget: zLinkiem({ url: "/kontakt" }) }));
    expect(screen.getByRole("link", { name: "/kontakt" })).toBeInTheDocument();
  });

  it("adres javascript: z bazy nie staje się klikalnym skryptem", () => {
    render(wezel({ widget: zLinkiem({ url: "javascript:alert(1)", ariaLabel: "Link" }) }));
    expect(screen.getByRole("link", { name: "Link" }).getAttribute("href")).toBe("#");
  });

  it("widget bez linku nie dostaje nakładki", () => {
    render(wezel({ widget: widget("w") }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("tresc-w")).toBeInTheDocument();
  });
});

describe("BuilderWidgetNode - edycja w miejscu", () => {
  it("dyspozytor dostaje editable i wywołanie, które dokleja identyfikator widgetu", () => {
    const onContentChange = vi.fn();
    render(wezel({ widget: widget("w7"), onContentChange }));
    const [zapis] = h.rendery;
    expect(zapis.editable).toBe(true);
    zapis.onContentChange?.("title_pl", "Nowy tytuł");
    expect(onContentChange).toHaveBeenCalledExactlyOnceWith("w7", "title_pl", "Nowy tytuł");
  });

  it("strona publiczna: bez edycji i bez wywołania zwrotnego", () => {
    render(wezel({ widget: widget("w7") }));
    expect(h.rendery[0]).toMatchObject({ editable: false, onContentChange: undefined });
  });
});

describe("BuilderWidgetNode - jawna wysokość responsywna", () => {
  it("wartość urządzenia wygrywa, a tablet bez własnej bierze desktopową", () => {
    const w = widget("w", "heading", {
      advanced: { height: { desktop: 320, mobile: 180 } } as WidgetNode["advanced"],
    });
    const { container, rerender } = render(wezel({ widget: w, device: "mobile" }));
    const ramka = () => container.querySelector<HTMLElement>("[data-widget-id]")!;
    expect(ramka().getAttribute("data-widget-explicit-height")).toBe("true");
    expect(ramka().style.height).toBe("180px");
    rerender(wezel({ widget: w, device: "tablet" }));
    expect(ramka().style.height).toBe("320px");
  });

  it("wysokość „auto” nie jest jawna - ramka rośnie z treścią", () => {
    const w = widget("w", "heading", {
      advanced: { height: { desktop: "auto" } } as WidgetNode["advanced"],
    });
    const { container } = render(wezel({ widget: w }));
    const ramka = container.querySelector<HTMLElement>("[data-widget-id]")!;
    expect(ramka.hasAttribute("data-widget-explicit-height")).toBe(false);
    expect(ramka.style.height).not.toMatch(/px$/);
  });
});

describe("BuilderWidgetNode - granica memo", () => {
  const bazowy = () =>
    widget("w", "heading", {
      content: { text_pl: "Tytuł", level: "h2" },
      style: { textColor: "#111" },
      advanced: {},
    });

  function liczRendery(kolejne: Array<Partial<Props> & { widget: WidgetNode }>) {
    const { rerender } = render(wezel(kolejne[0]));
    for (const props of kolejne.slice(1)) rerender(wezel(props));
    return h.rendery.length;
  }

  it("nowy obiekt węzła o tej samej płaskiej treści NIE renderuje treści ponownie", () => {
    expect(liczRendery([{ widget: bazowy() }, { widget: bazowy() }, { widget: bazowy() }])).toBe(1);
  });

  it.each<[string, (w: WidgetNode) => WidgetNode]>([
    ["zmiana wartości treści", (w) => ({ ...w, content: { ...w.content, text_pl: "Inny" } })],
    ["dodatkowy klucz treści", (w) => ({ ...w, content: { ...w.content, text_en: "Title" } })],
    ["zmiana stylu", (w) => ({ ...w, style: { textColor: "#222" } })],
    ["zmiana ustawień zaawansowanych", (w) => ({ ...w, advanced: { cssClass: "x" } })],
    ["podpięcie jako widget globalny", (w) => ({ ...w, globalId: "g1" })],
    ["inny typ pod tym samym id", (w) => ({ ...w, type: "text" }) as WidgetNode],
    [
      "nowa referencja zagnieżdżonej listy (wzorzec niemutowalnej edycji)",
      (w) => ({ ...w, content: { ...w.content, items: [] } }),
    ],
  ])("%s renderuje treść ponownie", (_opis, zmien) => {
    const w: WidgetNode = { ...bazowy(), content: { ...bazowy().content, items: [] } };
    expect(liczRendery([{ widget: w }, { widget: zmien(w) }])).toBe(2);
  });

  it("zmiana języka, urządzenia albo wywołania zwrotnego renderuje treść ponownie", () => {
    const w = bazowy();
    expect(
      liczRendery([
        { widget: w },
        { widget: w, lang: "en" },
        { widget: w, lang: "en", device: "mobile" },
        { widget: w, lang: "en", device: "mobile", onContentChange: vi.fn() },
      ]),
    ).toBe(4);
    expect(h.rendery.map((r) => [r.lang, r.device])).toEqual([
      ["pl", "desktop"],
      ["en", "desktop"],
      ["en", "mobile"],
      ["en", "mobile"],
    ]);
  });
});
