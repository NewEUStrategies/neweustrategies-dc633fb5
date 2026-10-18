// Atomy renderera bloków (nagłówek, lista, cytat, HTML, przycisk, odstęp,
// znaczniki stron, cytat wyróżniony, tekst wstępnie sformatowany, poezja) -
// to, co CZYTELNIK opublikowanego artykułu dostaje z danych bloku.
//
// Dowodzimy kontraktów, których nie widać w edytorze, a które psują publikację:
//   * HTML z CMS-a (nagłówek, pozycja listy, blok html) przechodzi przez
//     sanitizer - formatowanie inline zostaje, skrypt i handler znikają;
//   * kotwica nagłówka jest tą samą, którą czyta spis treści, a stare warianty
//     (`legacyIds`) zostają jako puste aliasy - linki `#` sprzed migracji żyją;
//   * wartości spoza zakresu (poziom nagłówka, wysokość odstępu, poziom
//     zagnieżdżenia listy) są przycinane, a nie przepuszczane do DOM;
//   * lista wielopoziomowa z „dziurą" w poziomach (import Worda) NIE gubi pozycji.
//
// Granice: renderujemy przez publiczny `BlocksRenderer` (walidacja dokumentu +
// pre-pass przypisów + dyspozytor), z prawdziwym i18n - żadnych atrap, bo atomy
// nie mają zależności zewnętrznych. Asercje czytają tekst, role, atrybuty
// `id` / `href` / `data-*` i style inline, nie klasy Tailwinda.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { BlocksRenderer } from "../../BlocksRenderer";
import { BlockView } from "../registry";

const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });
const draw = (blocks: Block[]) => render(<BlocksRenderer doc={doc(blocks)} lang="pl" />);

describe("nagłówek: poziom, kotwica, HTML inline i kolor", () => {
  it("przycina poziom do H2-H5 i nadaje kotwicę z treści, unikalną w dokumencie", () => {
    const { container } = draw([
      { id: "a", type: "heading", data: { level: 1, text: "Wstęp" } },
      { id: "b", type: "heading", data: { level: 9, text: "Wstęp" } },
      { id: "c", type: "heading", data: { level: "3", text: "Trzeci" } },
    ]);
    const heads = Array.from(container.querySelectorAll("h2, h3, h4, h5"));
    expect(heads.map((h) => [h.tagName, h.id, h.textContent])).toEqual([
      ["H2", "wstep", "Wstęp"],
      ["H5", "wstep-2", "Wstęp"],
      ["H3", "trzeci", "Trzeci"],
    ]);
  });

  it("poziom ułamkowy z importu daje prawdziwy nagłówek, a nie znacznik „h3.6”", () => {
    // NAPRAWIONE 2026-10-18: klamra 2-5 bez zaokrąglenia przepuszczała 3.6
    // wprost do nazwy znacznika - strona dostawała <h3.6>, którego ani czytnik
    // ekranu, ani wyszukiwarka nie uznają za nagłówek (znika ze spisu treści
    // i z konspektu dokumentu).
    const { container } = draw([
      { id: "a", type: "heading", data: { level: 3.6, text: "Ułamek" } },
      { id: "b", type: "heading", data: { level: 2.2, text: "Prawie dwa" } },
    ]);
    const heads = Array.from(container.querySelectorAll("h2, h3, h4, h5"));
    expect(heads.map((h) => [h.tagName, h.textContent])).toEqual([
      ["H4", "Ułamek"],
      ["H2", "Prawie dwa"],
    ]);
  });

  it("zachowuje stare kotwice jako puste aliasy wskazujące na kanoniczny id", () => {
    const { container } = draw([{ id: "h", type: "heading", data: { text: "Łódź i Śląsk" } }]);
    const heading = container.querySelector("h2");
    expect(heading?.id).toBe("lodz-i-slask");
    const aliases = Array.from(heading?.querySelectorAll("[data-anchor-alias]") ?? []);
    expect(aliases.length).toBeGreaterThan(0);
    for (const alias of aliases) {
      expect(alias.getAttribute("data-anchor-alias")).toBe("lodz-i-slask");
      expect(alias.getAttribute("aria-hidden")).toBe("true");
      expect(alias.id).not.toBe("lodz-i-slask");
      expect(alias.textContent).toBe("");
    }
    // Aliasy nie dokładają tekstu - czytelnik widzi sam tytuł.
    expect(heading?.textContent).toBe("Łódź i Śląsk");
  });

  it("renderuje formatowanie inline z buildera, ale wycina skrypt i handler zdarzeń", () => {
    const { container } = draw([
      {
        id: "h",
        type: "heading",
        data: {
          text: 'Raport <strong>2026</strong><img src=x onerror="alert(1)"><script>x()</script>',
        },
      },
    ]);
    const heading = container.querySelector("h2");
    expect(heading?.querySelector("strong")?.textContent).toBe("2026");
    expect(heading?.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("onerror");
    // Brak dosłownych znaczników w tekście nagłówka.
    expect(heading?.textContent).not.toContain("<strong>");
  });

  it("zamienia znaczniki statusu na ikony także w nagłówku bez HTML", () => {
    const { container } = draw([{ id: "h", type: "heading", data: { text: "Gotowe ✅" } }]);
    const icon = container.querySelector("h2 [aria-hidden='true']");
    expect(icon).not.toBeNull();
    expect(container.querySelector("h2")?.textContent).toContain("Gotowe");
  });

  it("stosuje kolor tylko z bezpiecznej palety (hex / token), a resztę pomija", () => {
    const { container } = draw([
      { id: "ok", type: "heading", data: { text: "Hex", color: "#123456" } },
      { id: "bad", type: "heading", data: { text: "Zły", color: "red;background:url(x)" } },
    ]);
    const [ok, bad] = Array.from(container.querySelectorAll("h2"));
    expect(ok.style.color).toBe("#123456");
    expect(bad.getAttribute("style")).toBeNull();
  });

  it("nagłówek bez treści nie dostaje pustego atrybutu `id`", () => {
    const { container } = draw([{ id: "h", type: "heading", data: { text: "" } }]);
    const heading = container.querySelector("h2");
    expect(heading).not.toBeNull();
    expect(heading?.hasAttribute("id")).toBe(false);
  });

  it("nagłówek z przypisem bierze HTML z pre-passu (odsyłacz [fn] w treści)", () => {
    const { container } = draw([
      { id: "h", type: "heading", data: { text: "Teza[fn]źródło[/fn]" } },
    ]);
    const heading = container.querySelector("h2");
    expect(heading?.querySelector("sup.fn-ref a")?.getAttribute("href")).toBe("#fn-1");
    expect(heading?.textContent).not.toContain("[fn]");
  });
});

describe("lista: zagnieżdżenia, numeracja i treść pozycji", () => {
  const itemsText = (root: Element | null) =>
    Array.from(root?.querySelectorAll(".cms-list-content") ?? []).map((n) => n.textContent);

  it("buduje drzewo z poziomów i typów per pozycja oraz zaczyna numerację od `start`", () => {
    const { container } = draw([
      {
        id: "l",
        type: "list",
        data: {
          items: ["Jeden", "Pod a", "Pod b", "Dwa"],
          ordered: true,
          start: 3,
          levels: [1, 2, 2, 1],
          itemsOrdered: [true, false, false, true],
        },
      },
    ]);
    const top = container.querySelector("article > ol");
    expect(top?.getAttribute("start")).toBe("3");
    const topItems = Array.from(top?.children ?? []);
    expect(topItems.map((li) => li.getAttribute("data-list-level"))).toEqual(["1", "1"]);
    expect(topItems.map((li) => li.querySelector(".cms-list-number")?.textContent)).toEqual([
      "3",
      "4",
    ]);
    // Zagnieżdżona lista ma typ pozycji dziecka (punktowana), nie rodzica.
    const nested = topItems[0].querySelector("ul");
    expect(nested).not.toBeNull();
    expect(itemsText(nested)).toEqual(["Pod a", "Pod b"]);
  });

  it("nie emituje atrybutu `start` dla numeracji od 1 i pomija puste pozycje", () => {
    const { container } = draw([
      { id: "l", type: "list", data: { items: ["A", "", "B", 7], ordered: true } },
    ]);
    const list = container.querySelector("article > ol");
    expect(list?.hasAttribute("start")).toBe(false);
    expect(itemsText(list)).toEqual(["A", "B"]);
  });

  it("NAPRAWIONE 2026-10-18: pozycja z przeskokiem poziomu (1 -> 3) nie znika z publikacji", () => {
    // WEJŚCIE: import Worda, poziomy [1, 3, 1]. Stan przed poprawką: pozycja
    // 3. poziomu trafiała do pustej listy 2. poziomu i nie renderowała się wcale.
    const { container } = draw([
      { id: "l", type: "list", data: { items: ["Rodzic", "Wnuk", "Sąsiad"], levels: [1, 3, 1] } },
    ]);
    const top = container.querySelector("article > ul");
    expect(itemsText(top)).toEqual(["Rodzic", "Wnuk", "Sąsiad"]);
    // Wnuk ląduje na najgłębszym osiągalnym poziomie - pod rodzicem.
    expect(top?.children[0].querySelector("li")?.getAttribute("data-list-level")).toBe("2");
  });

  it("NAPRAWIONE 2026-10-18: lista zaczynająca się od 2. poziomu i poziom ułamkowy zachowują treść", () => {
    const { container } = draw([
      { id: "a", type: "list", data: { items: ["Pierwsza", "Druga"], levels: [2, 1] } },
      { id: "b", type: "list", data: { items: ["X", "Y"], levels: [1, 1.5] } },
    ]);
    const [first, second] = Array.from(container.querySelectorAll("article > ul"));
    expect(itemsText(first)).toEqual(["Pierwsza", "Druga"]);
    expect(itemsText(second)).toEqual(["X", "Y"]);
  });

  it("renderuje formatowanie pozycji jako HTML po sanityzacji, a zwykły tekst dosłownie", () => {
    const { container } = draw([
      {
        id: "l",
        type: "list",
        data: { items: ["<em>ważne</em><script>x()</script>", "a < b"] },
      },
    ]);
    const list = container.querySelector("article > ul");
    expect(list?.querySelector("em")?.textContent).toBe("ważne");
    expect(list?.querySelector("script")).toBeNull();
    expect(itemsText(list)).toEqual(["ważne", "a < b"]);
  });

  it("pusta lista daje pustą listę, a pozycja z przypisem dostaje odsyłacz", () => {
    const { container } = draw([
      { id: "e", type: "list", data: { items: [] } },
      { id: "f", type: "list", data: { items: ["Fakt[fn]dowód[/fn]"] } },
    ]);
    const [empty, withFn] = Array.from(container.querySelectorAll("article > ul"));
    expect(empty.children).toHaveLength(0);
    expect(withFn.querySelector("sup.fn-ref a")?.getAttribute("href")).toBe("#fn-1");
  });
});

describe("cytat: warianty, paleta i podpis", () => {
  it("rozpoznaje warianty, a nieznany wariant traktuje jak domyślny", () => {
    const { container } = draw([
      { id: "p", type: "quote", data: { text: "A", variant: "plain" } },
      { id: "c", type: "quote", data: { text: "B", variant: "card" } },
      { id: "m", type: "quote", data: { text: "C", variant: "minimal" } },
      { id: "d", type: "quote", data: { text: "D", variant: "neon" } },
    ]);
    const quotes = Array.from(container.querySelectorAll("blockquote"));
    expect(quotes.map((q) => [q.getAttribute("data-quote-variant"), q.textContent])).toEqual([
      ["plain", "A"],
      ["card", "B"],
      ["minimal", "C"],
      ["default", "D"],
    ]);
  });

  it("mapuje paletę na token motywu, a nieznaną paletę na neutralną", () => {
    const { container } = draw([
      { id: "a", type: "quote", data: { text: "A", colorPalette: "danger" } },
      { id: "b", type: "quote", data: { text: "B", colorPalette: "fiolet" } },
      { id: "c", type: "quote", data: { text: "C", variant: "plain", colorPalette: "primary" } },
    ]);
    const [a, b, c] = Array.from(container.querySelectorAll("blockquote"));
    expect(a.getAttribute("style")).toContain("var(--destructive)");
    expect(b.getAttribute("style")).toContain("var(--foreground)");
    expect(c.getAttribute("style")).toContain("var(--primary)");
  });

  it("dokleja podpis z prefiksem „- ” tylko, gdy autor jest podany, także z przypisem", () => {
    const { container } = draw([
      { id: "a", type: "quote", data: { text: "Bez autora" } },
      { id: "b", type: "quote", data: { text: "Słowa[fn]wywiad[/fn]", cite: "Anna" } },
      { id: "c", type: "quote", data: { text: "T", cite: "Jan[fn]biogram[/fn]", variant: "card" } },
    ]);
    const [a, b, c] = Array.from(container.querySelectorAll("blockquote"));
    expect(a.querySelector("cite")).toBeNull();
    expect(b.querySelector("cite")?.textContent).toBe("- Anna");
    expect(b.querySelector("p sup.fn-ref")).not.toBeNull();
    expect(c.querySelector("cite")?.textContent?.startsWith("- Jan")).toBe(true);
    expect(c.querySelector("cite sup.fn-ref")).not.toBeNull();
  });
});

describe("HTML, separator, callout, przycisk, odstęp i znaczniki", () => {
  it("blok html przechodzi przez sanitizer (bez iframe/form/handlerów)", () => {
    // Po jednym niebezpiecznym elemencie na blok: DOMPurify pod happy-dom
    // pomija węzeł następujący po usuniętym (artefakt iteratora środowiska
    // testowego, nie przeglądarki), więc wspólny blok mierzyłby środowisko.
    const { container } = draw([
      { id: "a", type: "html", data: { html: "<p>Treść</p>" } },
      { id: "b", type: "html", data: { html: '<iframe title="obca"></iframe>' } },
      { id: "c", type: "html", data: { html: '<form action="/x"><input name="q"></form>' } },
      { id: "d", type: "html", data: { html: '<b onclick="x()">B</b>' } },
    ]);
    expect(container.textContent).toContain("Treść");
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("[onclick]")).toBeNull();
  });

  it("blok html poza pre-passem (bez wpisu w mapie przypisów) też jest sanityzowany", () => {
    // Ścieżka zapasowa: blok wyrenderowany przez dyspozytora bez pre-passu
    // (np. kontener nieobjęty rekurencją `precomputeFootnotes`).
    const block: Block = {
      id: "raw",
      type: "html",
      data: { html: "<p>Surowy</p><script>alert(1)</script>" },
    };
    const { container } = render(<BlockView block={block} fnHtml={new Map()} />);
    expect(container.textContent).toBe("Surowy");
    expect(container.querySelector("script")).toBeNull();
  });

  it("separator rysuje kropki jako tekst, a linie jako <hr>", () => {
    const { container } = draw([
      { id: "a", type: "separator", data: { variant: "dots" } },
      { id: "b", type: "separator", data: { variant: "wide" } },
      { id: "c", type: "separator", data: {} },
    ]);
    expect(container.textContent).toContain("···");
    expect(container.querySelectorAll("hr")).toHaveLength(2);
  });

  it("callout pokazuje tekst także dla nieznanego wariantu", () => {
    const { getByText } = draw([
      { id: "c", type: "callout", data: { variant: "kosmiczny", text: "Uwaga\nlinia 2" } },
    ]);
    expect(getByText(/Uwaga/).textContent).toBe("Uwaga\nlinia 2");
  });

  it("przycisk bez etykiety znika, a niebezpieczny link zamienia się na „#”", () => {
    const { container, getByRole } = draw([
      { id: "a", type: "button", data: { href: "/nic" } },
      {
        id: "b",
        type: "button",
        data: { label: "Kliknij", href: "javascript:alert(1)", variant: "outline" },
      },
      { id: "c", type: "button", data: { label: "Duch", variant: "ghost" } },
    ]);
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(getByRole("link", { name: "Kliknij" }).getAttribute("href")).toBe("#");
    expect(getByRole("link", { name: "Duch" }).getAttribute("href")).toBe("#");
  });

  it("odstęp przycina wysokość do 4-400 px i jest ukryty przed czytnikami", () => {
    const { container } = draw([
      { id: "a", type: "spacer", data: { height: 9000 } },
      { id: "b", type: "spacer", data: { height: -5 } },
      { id: "c", type: "spacer", data: { height: "abc" } },
    ]);
    const spacers = Array.from(
      container.querySelectorAll<HTMLElement>("article > div[aria-hidden]"),
    );
    expect(spacers.map((s) => s.style.height)).toEqual(["400px", "4px", "40px"]);
  });

  it("podział strony i granica zajawki zostawiają semantyczne znaczniki data-*", () => {
    const { container } = draw([
      { id: "a", type: "page-break", data: {} },
      { id: "b", type: "read-more", data: {} },
    ]);
    expect(container.querySelector("[data-page-break]")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("[data-read-more]")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("cytat wyróżniony bez tekstu znika, a z tekstem pokazuje opcjonalny podpis", () => {
    const { container } = draw([
      { id: "a", type: "pullquote", data: { cite: "Nikt" } },
      { id: "b", type: "pullquote", data: { text: "Myśl" } },
    ]);
    const quotes = container.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0].textContent).toBe("Myśl");
    expect(container.textContent).not.toContain("Nikt");
  });

  it("tekst wstępnie sformatowany i poezja zachowują spacje i łamanie linii", () => {
    const { container } = draw([
      { id: "a", type: "preformatted", data: { text: "a  b\n  c" } },
      { id: "b", type: "verse", data: { text: "Wers 1\nWers 2" } },
    ]);
    expect(Array.from(container.querySelectorAll("pre")).map((p) => p.textContent)).toEqual([
      "a  b\n  c",
      "Wers 1\nWers 2",
    ]);
  });
});
