// Bloki strukturalne renderera: tabela, grupa przycisków, ikony społecznościowe,
// wyszukiwarka, plusy/minusy, spoiler i szczegóły.
//
// Co dowodzimy i dlaczego:
//   * tabela z importu Worda / Excela zachowuje scalenia (`spans`) i wyrównania
//     (`aligns`), a komórka spoza typów tekstowych NIE pokazuje „[object Object]";
//   * listy pozycji (przyciski, ikony) pomijają wpisy bez etykiety / adresu,
//     a adresy przechodzą przez filtr schematu;
//   * wyszukiwarka zawsze ma docelowy adres (pusty `action` wysyłał zapytanie
//     pod adres artykułu) i pole `q` z dostępną nazwą;
//   * bloki rozwijane mają semantykę `<details>` (stan domyślny, etykieta
//     zastępcza z i18n), a HTML spoilera przechodzi przez sanitizer.
//
// Granice: publiczny `BlocksRenderer` z prawdziwym i18n (polski rdzeń), bez
// atrap - te bloki nie czytają danych spoza `block.data`.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import { BlocksRenderer } from "../../BlocksRenderer";

const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });
const draw = (blocks: Block[]) => render(<BlocksRenderer doc={doc(blocks)} lang="pl" />);

describe("tabela", () => {
  it("zachowuje scalenia i wyrównania komórek z importu, a nagłówek trafia do <thead>", () => {
    const { container } = draw([
      {
        id: "t",
        type: "table",
        data: {
          header: true,
          rows: [
            ["Kraj", "PKB"],
            ["Polska", "3,1%"],
          ],
          spans: [[[2, 1]], [null, [1, 3]]],
          aligns: [["center"], [null, "right"]],
        },
      },
    ]);
    const th = container.querySelector("thead th");
    expect(th?.getAttribute("colspan")).toBe("2");
    expect(th?.hasAttribute("rowspan")).toBe(false);
    const cells = Array.from(container.querySelectorAll("tbody td"));
    expect(cells.map((c) => c.textContent)).toEqual(["Polska", "3,1%"]);
    expect(cells[1].getAttribute("rowspan")).toBe("3");
    expect(cells[0].hasAttribute("colspan")).toBe(false);
  });

  it("NAPRAWIONE 2026-10-18: obiekt w komórce daje pustą komórkę, liczba i logiczna - tekst", () => {
    // WEJŚCIE: wiersz [42, true, {x:1}, null, ["a"]]. Przed poprawką obiekt i
    // tablica szły przez `String(c)` i czytelnik widział „[object Object]" / „a".
    const { container } = draw([
      { id: "t", type: "table", data: { rows: [[42, true, { x: 1 }, null, ["a"]]] } },
    ]);
    const cells = Array.from(container.querySelectorAll("td")).map((c) => c.textContent);
    expect(cells).toEqual(["42", "true", "", "", ""]);
    expect(container.textContent).not.toContain("[object Object]");
  });

  it("bez wierszy nie renderuje tabeli; wiersz nie-tablica jest pusty; przypis w komórce działa", () => {
    const { container } = draw([
      { id: "e", type: "table", data: { rows: [] } },
      { id: "t", type: "table", data: { rows: ["zly", ["Dane[fn]GUS 2025[/fn]"]] } },
    ]);
    expect(container.querySelectorAll("table")).toHaveLength(1);
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows.map((r) => r.children.length)).toEqual([0, 1]);
    expect(rows[1].querySelector("sup.fn-ref a")?.getAttribute("href")).toBe("#fn-1");
  });
});

describe("przyciski i ikony społecznościowe", () => {
  it("grupa przycisków pomija pozycje bez etykiety i neutralizuje niebezpieczne linki", () => {
    const { container, getByRole } = draw([
      { id: "e", type: "buttons", data: { items: [] } },
      {
        id: "b",
        type: "buttons",
        data: {
          align: "center",
          items: [
            { label: "Zapisz się", href: "/newsletter", variant: "outline" },
            { href: "/bez-etykiety" },
            { label: "Zło", href: "javascript:alert(1)", variant: "ghost" },
            { label: "Domyślny" },
          ],
        },
      },
    ]);
    expect(container.querySelectorAll("a")).toHaveLength(3);
    expect(getByRole("link", { name: "Zapisz się" }).getAttribute("href")).toBe("/newsletter");
    expect(getByRole("link", { name: "Zło" }).getAttribute("href")).toBe("#");
    expect(getByRole("link", { name: "Domyślny" }).getAttribute("href")).toBe("#");
  });

  it("ikony: nazwa platformy jako etykieta, pominięte wpisy bez bezpiecznego adresu", () => {
    const { container, getByRole } = draw([
      { id: "e", type: "social-icons", data: { items: [] } },
      {
        id: "s",
        type: "social-icons",
        data: {
          size: "lg",
          align: "right",
          items: [
            { platform: "LinkedIn", url: "https://linkedin.com/company/nes" },
            { platform: "x", url: "javascript:alert(1)" },
            { platform: "mastodon", url: "https://mastodon.social/@nes" },
            { platform: "", url: "mailto:biuro@example.com" },
            { platform: "Spotify", url: "https://open.spotify.com/show/nes" },
            { platform: "github" },
          ],
        },
      },
    ]);
    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map((a) => [a.getAttribute("aria-label"), a.getAttribute("href")])).toEqual([
      ["LinkedIn", "https://linkedin.com/company/nes"],
      ["mastodon", "https://mastodon.social/@nes"],
      ["social", "mailto:biuro@example.com"],
      ["Spotify", "https://open.spotify.com/show/nes"],
    ]);
    // Nieznana platforma nadal dostaje ikonę (zastępczą), a nie pusty link.
    expect(getByRole("link", { name: "mastodon" }).querySelector("svg")).not.toBeNull();
    // Platforma rozpoznawana bez względu na wielkość liter (własna ikona Spotify).
    expect(getByRole("link", { name: "Spotify" }).querySelector("svg")).not.toBeNull();
    expect(links.every((a) => a.getAttribute("rel") === "noopener noreferrer")).toBe(true);
  });
});

describe("wyszukiwarka", () => {
  it("wysyła GET z polem `q` pod domyślny adres i ma dostępne nazwy z i18n", () => {
    const { getByRole } = draw([{ id: "s", type: "search", data: {} }]);
    const form = getByRole("search");
    expect(form.getAttribute("action")).toBe("/search");
    expect(form.getAttribute("method")).toBe("get");
    const input = getByRole("searchbox", { name: "Szukaj…" });
    expect(input.getAttribute("name")).toBe("q");
    expect(getByRole("button", { name: "Szukaj" }).getAttribute("type")).toBe("submit");
  });

  it("NAPRAWIONE 2026-10-18: pusty lub niebezpieczny `action` wraca do /search, własny zostaje", () => {
    // Przed poprawką `action=""` wysyłał formularz pod adres bieżącego artykułu.
    const { getAllByRole } = draw([
      { id: "a", type: "search", data: { action: "" } },
      { id: "b", type: "search", data: { action: "javascript:alert(1)" } },
      {
        id: "c",
        type: "search",
        data: { action: "/szukaj", placeholder: "Fraza", buttonLabel: "Idź" },
      },
    ]);
    const forms = getAllByRole("search");
    expect(forms.map((f) => f.getAttribute("action"))).toEqual(["/search", "/search", "/szukaj"]);
    expect(forms[2].querySelector("input")?.getAttribute("aria-label")).toBe("Fraza");
    expect(forms[2].querySelector("button")?.textContent).toBe("Idź");
  });
});

describe("plusy/minusy, spoiler i szczegóły", () => {
  it("plusy/minusy: brak obu list ukrywa blok; puste pozycje są pomijane", () => {
    const { container, getByRole } = draw([
      { id: "e", type: "proscons", data: { title: "Nic", pros: [""], cons: [] } },
      {
        id: "p",
        type: "proscons",
        data: { title: "Ocena", pros: ["Szybki", ""], cons: ["Drogi"] },
      },
    ]);
    expect(container.querySelectorAll("section")).toHaveLength(1);
    expect(getByRole("heading", { name: "Ocena" })).toBeTruthy();
    const lists = Array.from(container.querySelectorAll("section ul")).map((ul) =>
      Array.from(ul.children).map((li) => li.textContent),
    );
    expect(lists).toEqual([["Szybki"], ["Drogi"]]);
    expect(container.textContent).toContain("Plusy");
    expect(container.textContent).toContain("Minusy");
  });

  it("spoiler: bez treści znika; stan otwarcia i etykieta zastępcza; HTML po sanityzacji", () => {
    const { container } = draw([
      { id: "e", type: "spoiler", data: { summary: "Pusto", html: "" } },
      {
        id: "a",
        type: "spoiler",
        data: { html: "<p>Ukryte</p><script>x()</script>", defaultOpen: true },
      },
      { id: "b", type: "spoiler", data: { summary: "Zakończenie", html: "<em>Twist</em>" } },
    ]);
    const details = Array.from(container.querySelectorAll("details"));
    expect(details).toHaveLength(2);
    expect(details.map((d) => [d.open, d.querySelector("summary")?.textContent])).toEqual([
      [true, "Pokaż więcej"],
      [false, "Zakończenie"],
    ]);
    expect(details[0].querySelector("script")).toBeNull();
    expect(details[1].querySelector("em")?.textContent).toBe("Twist");
  });

  it("szczegóły: bez nagłówka i treści znikają; treść jest tekstem, nie HTML-em", () => {
    const { container } = draw([
      { id: "e", type: "details", data: {} },
      { id: "a", type: "details", data: { body: "<b>dosłownie</b>" } },
      { id: "b", type: "details", data: { summary: "Metodologia", body: "Próba N=1000" } },
    ]);
    const details = Array.from(container.querySelectorAll("details"));
    expect(details.map((d) => d.querySelector("summary")?.textContent)).toEqual([
      "Szczegóły",
      "Metodologia",
    ]);
    expect(details[0].querySelector("b")).toBeNull();
    expect(details[0].textContent).toContain("<b>dosłownie</b>");
  });
});
