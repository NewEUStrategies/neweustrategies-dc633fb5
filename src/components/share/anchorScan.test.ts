// Skanowanie nagłówków pływającego spisu treści. Testowane bez montowania
// railu, bo `scanHeadings` jest czystą funkcją nad DOM-em.
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
});
