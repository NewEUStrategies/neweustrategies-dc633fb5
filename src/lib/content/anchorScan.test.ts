// Skanowanie nagłówków treści (pływający spis treści + widget spisu treści
// buildera). Testowane bez montowania komponentów, bo `scanHeadings` jest
// czystą funkcją nad DOM-em.
import { beforeEach, describe, expect, it } from "vitest";
import { getArticleRoot, scanHeadings } from "./anchorScan";

function mount(html: string): HTMLElement {
  document.body.innerHTML = `<article class="article-body">${html}</article>`;
  const root = getArticleRoot();
  if (!root) throw new Error("brak korzenia treści");
  return root;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("getArticleRoot", () => {
  it("prefers .article-body, then [data-cms-prose], then <article>", () => {
    document.body.innerHTML = `<article id="a"><div data-cms-prose id="b"></div></article>`;
    expect(getArticleRoot()?.id).toBe("b");
    document.body.innerHTML = `<article id="a"><div class="article-body" id="c"></div></article>`;
    expect(getArticleRoot()?.id).toBe("c");
    document.body.innerHTML = `<article id="a"></article>`;
    expect(getArticleRoot()?.id).toBe("a");
  });

  it("returns null when there is no content root", () => {
    document.body.innerHTML = `<div>nic</div>`;
    expect(getArticleRoot()).toBeNull();
  });
});

describe("scanHeadings", () => {
  it("collects h1-h5 with level and text, skipping h6 and blank headings", () => {
    const root = mount(`
      <h1>Tytuł</h1><h2>Rozdział</h2><h3>Podrozdział</h3>
      <h4>Cztery</h4><h5>Pięć</h5><h6>Sześć</h6><h2>   </h2>
    `);
    const items = scanHeadings(root);
    expect(items.map((i) => i.level)).toEqual([1, 2, 3, 4, 5]);
    expect(items.map((i) => i.text)).toEqual([
      "Tytuł",
      "Rozdział",
      "Podrozdział",
      "Cztery",
      "Pięć",
    ]);
  });

  it("keeps a server-rendered id untouched so published links keep working", () => {
    const root = mount(`<h2 id="z-serwera">Wyzwania małych firm</h2>`);
    expect(scanHeadings(root)[0].id).toBe("z-serwera");
    expect(root.querySelector("h2")?.id).toBe("z-serwera");
  });

  it("assigns the canonical anchor when the heading has no id", () => {
    const root = mount(`<h2>Wyzwania małych firm</h2>`);
    const items = scanHeadings(root);
    // The old share-bar pipeline produced "wyzwania-ma-ych-firm" here.
    expect(items[0].id).toBe("wyzwania-malych-firm");
    expect(root.querySelector("h2")?.id).toBe("wyzwania-malych-firm");
  });

  it("adds a hidden alias for the historical anchor of a newly-assigned id", () => {
    const root = mount(`<h2>Wyzwania małych firm</h2>`);
    scanHeadings(root);
    const alias = document.getElementById("wyzwania-ma-ych-firm");
    expect(alias).not.toBeNull();
    expect(alias?.dataset.anchorAlias).toBe("wyzwania-malych-firm");
    expect(alias?.getAttribute("aria-hidden")).toBe("true");
    // The alias must not change the heading's readable text.
    expect(root.querySelector("h2")?.textContent).toBe("Wyzwania małych firm");
  });

  it("does not add aliases when the anchor never differed", () => {
    const root = mount(`<h2>Hello World</h2>`);
    scanHeadings(root);
    expect(document.querySelectorAll("[data-anchor-alias]").length).toBe(0);
  });

  it("is idempotent - re-scanning does not duplicate aliases", () => {
    const root = mount(`<h2>Wyzwania małych firm</h2>`);
    scanHeadings(root);
    scanHeadings(root);
    scanHeadings(root);
    expect(document.querySelectorAll("#wyzwania-ma-ych-firm").length).toBe(1);
  });

  it("deduplicates from the base, not from the previous id", () => {
    const root = mount(`<h2>Wnioski</h2><h2>Wnioski</h2><h2>Wnioski</h2>`);
    // The old loop compounded suffixes: wnioski, wnioski-2, wnioski-2-2.
    expect(scanHeadings(root).map((i) => i.id)).toEqual(["wnioski", "wnioski-2", "wnioski-3"]);
  });

  it("never steals an id that a later heading already owns", () => {
    const root = mount(`<h2>Wnioski</h2><h2 id="wnioski">Inny nagłówek</h2>`);
    const items = scanHeadings(root);
    expect(items[1].id).toBe("wnioski");
    expect(items[0].id).toBe("wnioski-2");
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it("produces unique ids for headings that collapse to the fallback", () => {
    const root = mount(`<h2>!!!</h2><h2>???</h2>`);
    expect(scanHeadings(root).map((i) => i.id)).toEqual(["section", "section-2"]);
  });

  it("returns an empty list for a root without headings", () => {
    expect(scanHeadings(mount(`<p>tekst</p>`))).toEqual([]);
  });

  it("never assigns an id that already exists elsewhere in the document", () => {
    document.body.innerHTML = `
      <div id="wnioski">chrome strony</div>
      <article class="article-body"><h2>Wnioski</h2></article>
    `;
    const root = getArticleRoot();
    if (!root) throw new Error("brak korzenia treści");
    expect(scanHeadings(root).map((i) => i.id)).toEqual(["wnioski-2"]);
    // Kotwica strony pozostaje nietknięta - link "#wnioski" dalej wskazuje chrome.
    expect(document.getElementById("wnioski")?.textContent).toBe("chrome strony");
  });
});

describe("scanHeadings - opcje konsumentów (widget spisu treści)", () => {
  it("narrows the scan to the requested heading levels", () => {
    const root = mount(`<h1>Jeden</h1><h2>Dwa</h2><h3>Trzy</h3><h4>Cztery</h4>`);
    const items = scanHeadings(root, { selector: "h2, h3" });
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [2, "Dwa"],
      [3, "Trzy"],
    ]);
    // Nagłówki spoza selektora nie dostają id.
    expect(root.querySelector("h1")?.id).toBe("");
    expect(root.querySelector("h4")?.id).toBe("");
  });

  it("skips headings inside an excluded ancestor without assigning ids", () => {
    const root = mount(`
      <div data-widget-toc><h2>Spis wewnątrz widgetu</h2></div>
      <h2>Poza widgetem</h2>
    `);
    const items = scanHeadings(root, { excludeAncestor: "[data-widget-toc]" });
    expect(items.map((i) => i.text)).toEqual(["Poza widgetem"]);
    expect(root.querySelector<HTMLElement>("[data-widget-toc] h2")?.id).toBe("");
  });

  it("skips the heading mirroring the widget title, case-insensitively", () => {
    const root = mount(`<h2>  SPIS TREŚCI  </h2><h2>Właściwy rozdział</h2>`);
    const items = scanHeadings(root, { skipText: "Spis treści" });
    expect(items.map((i) => i.text)).toEqual(["Właściwy rozdział"]);
    expect(root.querySelector("h2")?.id).toBe("");
  });

  it("still reserves ids of excluded headings so they cannot be stolen", () => {
    const root = mount(`
      <div data-widget-toc><h2 id="rozdzial">Nagłówek widgetu</h2></div>
      <h2>Rozdział</h2>
    `);
    const items = scanHeadings(root, { excludeAncestor: "[data-widget-toc]" });
    expect(items.map((i) => i.id)).toEqual(["rozdzial-2"]);
  });
});

// ---------------------------------------------------------------------------
// GAŁĘZIE ODMOWY SKANERA - część C (gałęziowa).
//
// Selektor jest parametrem PUBLICZNYM (widget spisu treści buildera pozwala
// redakcji wskazać poziomy nagłówków), więc może trafić w element, który
// nagłówkiem h1-h5 nie jest. Skaner ma go POMINĄĆ bez nadawania `id` - inaczej
// spis treści zacząłby linkować do akapitów, a `id` pojawiałyby się w treści
// bez powodu.
// ---------------------------------------------------------------------------
describe("scanHeadings - element pasujący do selektora, który nie jest nagłówkiem", () => {
  it("h6 złapane własnym selektorem jest pomijane i NIE dostaje id", () => {
    const root = mount(`<h2>Dwa</h2><h6>Sześć</h6>`);
    const items = scanHeadings(root, { selector: "h2, h6" });

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("Dwa");
    expect(items[0]?.level).toBe(2);
    expect(root.querySelector("h6")?.id).toBe("");
  });

  it("akapit złapany selektorem też jest pomijany, a nagłówki obok działają dalej", () => {
    const root = mount(`<h2>Pierwszy</h2><p>Akapit</p><h3>Drugi</h3>`);
    const items = scanHeadings(root, { selector: "h2, p, h3" });

    expect(items.map((i) => i.text)).toEqual(["Pierwszy", "Drugi"]);
    expect(root.querySelector("p")?.id).toBe("");
    expect(root.querySelector("h2")?.id).toBe("pierwszy");
    expect(root.querySelector("h3")?.id).toBe("drugi");
  });

  it("selektor trafiający WYŁĄCZNIE w nie-nagłówki daje pustą listę bez zmian w DOM", () => {
    const root = mount(`<h6>Sześć</h6><p>Akapit</p>`);
    const before = root.innerHTML;

    expect(scanHeadings(root, { selector: "h6, p" })).toEqual([]);
    expect(root.innerHTML).toBe(before);
  });

  it("historyczna kotwica JUŻ obecna w dokumencie nie jest dublowana aliasem", () => {
    // Gałąź `doc.getElementById(legacyId)` w `ensureLegacyAliases`. Serwerowy
    // silnik bloków emituje te same aliasy; gdyby skaner kliencki dołożył
    // drugi element o tym samym `id`, dokument miałby zduplikowany identyfikator
    // i `#kotwica` skakałaby zawsze do pierwszego trafienia.
    const root = mount(`<h2>Wyzwania małych firm</h2>`);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<span id="wyzwania-ma-ych-firm" data-legacy-z-serwera="1"></span>`,
    );

    const items = scanHeadings(root);

    expect(items[0]?.id).toBe("wyzwania-malych-firm");
    // Wewnątrz nagłówka NIE powstał alias - ten identyfikator już istnieje.
    expect(root.querySelectorAll("[data-anchor-alias]")).toHaveLength(0);
    expect(document.querySelectorAll("#wyzwania-ma-ych-firm")).toHaveLength(1);
  });
});
