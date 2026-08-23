// MAILA NIE DA SIĘ WYCOFAĆ.
//
// `renderEmailHtml` to ostatni krok, po którym dokument przestaje być danymi
// i staje się treścią w cudzej skrzynce. Gałąź, w którą nikt nie wszedł
// testem, to gałąź, której skutek zobaczy dopiero odbiorca - i już go nie
// cofnie.
//
// `renderEmailHtml.test.ts` obok pokrywa szczęśliwy przebieg nagłówka,
// przycisku, obrazu i listy wpisów. Ten plik dobija DOKŁADNIE te gałęzie,
// w które tamten nie wchodzi, i tylko takie, których skutek dla odbiorcy jest
// widoczny:
//   * bloki nigdy nierenderowane w teście (akapit, separator, odstęp, cytat,
//     nota stopki) - w tym ich warianty PUSTE, które nie mogą zostawiać
//     w mailu pustej ramki ani samotnej kreski,
//   * obraz jako LINK (klikalny baner - najczęstszy układ newslettera),
//   * karty z okładką i karty bez okładki (spadek do układu listy),
//   * wersja angielska podpisu "Read more" - odbiorca EN nie może dostać
//     polskiego "Czytaj więcej",
//   * adres URL z samych spacji - nie wolno wyprodukować `<img src=" ">`.
//
// Żadnej pętli po typach bloków dla procentu: każdy przypadek nazywa skutek
// dla odbiorcy, bo tylko taki test coś chroni.
import { describe, expect, it } from "vitest";
import { renderEmailHtml, type EmailPostRef, type RenderEmailCtx } from "../renderEmailHtml";
import {
  DEFAULT_EMAIL_DOC_STYLE,
  type EmailDoc,
  type EmailFooterNoteBlock,
  type EmailImageBlock,
  type EmailParagraphBlock,
  type EmailPostListBlock,
  type EmailQuoteBlock,
  type EmailSpacerBlock,
} from "../emailDoc";

const emptyCtx: RenderEmailCtx = { postsByBlock: {} };

function docWith(blocks: EmailDoc["blocks"]): EmailDoc {
  return { version: 1, blocks, style: { ...DEFAULT_EMAIL_DOC_STYLE } };
}

function paragraph(over: Partial<EmailParagraphBlock> = {}): EmailParagraphBlock {
  return { id: "p", type: "paragraph", html: { pl: "", en: "" }, align: "left", ...over };
}

function quote(over: Partial<EmailQuoteBlock> = {}): EmailQuoteBlock {
  return {
    id: "q",
    type: "quote",
    text: { pl: "", en: "" },
    attribution: { pl: "", en: "" },
    ...over,
  };
}

function footerNote(over: Partial<EmailFooterNoteBlock> = {}): EmailFooterNoteBlock {
  return { id: "fn", type: "footer-note", html: { pl: "", en: "" }, ...over };
}

function postList(over: Partial<EmailPostListBlock> = {}): EmailPostListBlock {
  return {
    id: "pl",
    type: "post-list",
    heading: { pl: "", en: "" },
    mode: "latest",
    count: 3,
    categorySlug: null,
    postIds: [],
    layout: "list",
    showExcerpt: true,
    ...over,
  };
}

function postRef(over: Partial<EmailPostRef> = {}): EmailPostRef {
  return {
    id: "post-1",
    title: "Reforma rynku energii",
    excerpt: "Krótkie streszczenie.",
    href: "https://example.org/post/reforma",
    coverUrl: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
describe("akapit - najczęstszy blok newslettera", () => {
  it("akapit bez treści w języku odbiorcy nie zostawia pustej ramki w mailu", () => {
    const doc = docWith([paragraph({ html: { pl: "<b>Treść</b>", en: "" } })]);
    expect(renderEmailHtml(doc, "en", emptyCtx)).toBe("");
    expect(renderEmailHtml(doc, "pl", emptyCtx)).toContain("<b>Treść</b>");
  });

  it("akapit przechodzi przez sanityzację - skrypt z edytora nie dojedzie do skrzynki", () => {
    const doc = docWith([
      paragraph({ html: { pl: "<b>Ważne</b><script>alert(1)</script>", en: "" } }),
    ]);
    const html = renderEmailHtml(doc, "pl", emptyCtx);
    expect(html).toContain("<b>Ważne</b>");
    expect(html).not.toContain("<script>");
  });

  it("wyśrodkowanie akapitu jedzie w stylu inline, bo klienty pocztowe nie mają arkusza", () => {
    const doc = docWith([paragraph({ html: { pl: "Wstęp", en: "" }, align: "center" })]);
    expect(renderEmailHtml(doc, "pl", emptyCtx)).toContain("text-align:center");
    expect(renderEmailHtml(doc, "pl", emptyCtx)).toContain("Wstęp");
  });
});

// ---------------------------------------------------------------------------
describe("separator i odstęp - bloki bez treści, które muszą się renderować zawsze", () => {
  it("separator daje kreskę nawet w dokumencie bez ani jednego napisu", () => {
    const html = renderEmailHtml(docWith([{ id: "d", type: "divider" }]), "pl", emptyCtx);
    expect(html).toContain("<hr");
    expect(html).toContain("border-top:1px solid #e5e7eb");
  });

  it("odstęp zajmuje dokładnie tyle pikseli, ile ustawił redaktor", () => {
    const spacer: EmailSpacerBlock = { id: "s", type: "spacer", size: 48 };
    const html = renderEmailHtml(docWith([spacer]), "pl", emptyCtx);
    expect(html).toContain("height:48px");
    expect(html).toContain("line-height:48px");
  });
});

// ---------------------------------------------------------------------------
describe("cytat", () => {
  it("cytat bez treści w języku odbiorcy znika zamiast wysłać samą kreskę boczną", () => {
    const doc = docWith([quote({ text: { pl: "Cytat", en: "" } })]);
    expect(renderEmailHtml(doc, "en", emptyCtx)).toBe("");
    expect(renderEmailHtml(doc, "pl", emptyCtx)).toContain("Cytat");
  });

  it("cytat bez podpisu nie dokleja pustego wiersza z myślnikiem", () => {
    const doc = docWith([quote({ text: { pl: "Zdanie", en: "" } })]);
    const html = renderEmailHtml(doc, "pl", emptyCtx);
    expect(html).toContain("Zdanie");
    expect(html).not.toContain("—");
  });

  it("podpis pod cytatem dojeżdża z myślnikiem i w kolorze wyciszonym", () => {
    const doc = docWith([
      quote({ text: { pl: "Zdanie", en: "" }, attribution: { pl: "Jan Kowalski", en: "" } }),
    ]);
    const html = renderEmailHtml(doc, "pl", emptyCtx);
    expect(html).toContain("— Jan Kowalski");
    expect(html).toContain(DEFAULT_EMAIL_DOC_STYLE.muted);
  });

  it("znaki specjalne w cytacie są uciekane - nie da się wstrzyknąć znacznika", () => {
    const doc = docWith([
      quote({
        text: { pl: '<img src=x onerror="alert(1)">', en: "" },
        attribution: { pl: "A & B", en: "" },
      }),
    ]);
    const html = renderEmailHtml(doc, "pl", emptyCtx);
    // Znacznik przestaje być znacznikiem: klient pocztowy pokaże tekst,
    // nie wykona atrybutu zdarzenia.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("A &amp; B");
  });
});

// ---------------------------------------------------------------------------
describe("nota stopki", () => {
  it("pusta nota nie dokleja do maila pustego bloku wyśrodkowanego tekstu", () => {
    const doc = docWith([footerNote({ html: { pl: "Nota", en: "" } })]);
    expect(renderEmailHtml(doc, "en", emptyCtx)).toBe("");
    expect(renderEmailHtml(doc, "pl", emptyCtx)).toContain("Nota");
  });

  it("nota jest sanityzowana i wyśrodkowana", () => {
    const doc = docWith([
      footerNote({ html: { pl: '<a href="https://x.pl">Regulamin</a>', en: "" } }),
    ]);
    const html = renderEmailHtml(doc, "pl", emptyCtx);
    expect(html).toContain("text-align:center");
    expect(html).toContain("Regulamin");
  });
});

// ---------------------------------------------------------------------------
describe("obraz", () => {
  it("adres z samych spacji nie produkuje obrazka z pustym src", () => {
    const image: EmailImageBlock = { id: "i", type: "image", url: "   ", alt: "Baner", href: null };
    expect(renderEmailHtml(docWith([image]), "pl", emptyCtx)).toBe("");
    expect(renderEmailHtml(docWith([image]), "pl", emptyCtx)).not.toContain("Baner");
  });

  it("obraz z poprawnym linkiem staje się klikalnym banerem", () => {
    const image: EmailImageBlock = {
      id: "i",
      type: "image",
      url: "https://cdn.example.org/baner.png",
      alt: "Baner wydania",
      href: "https://example.org/wydanie",
    };
    const html = renderEmailHtml(docWith([image]), "pl", emptyCtx);
    expect(html).toContain('<a href="https://example.org/wydanie">');
    expect(html).toContain('alt="Baner wydania"');
  });

  it("link obrazu w protokole javascript jest odrzucany, a sam obraz zostaje", () => {
    const image: EmailImageBlock = {
      id: "i",
      type: "image",
      url: "https://cdn.example.org/baner.png",
      alt: "",
      href: "javascript:alert(1)",
    };
    const html = renderEmailHtml(docWith([image]), "pl", emptyCtx);
    expect(html).toContain("cdn.example.org/baner.png");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a href=");
  });
});

// ---------------------------------------------------------------------------
describe("lista wpisów - warianty, w których odbiorca widzi coś innego", () => {
  it("lista bez nagłówka nie wstawia pustego h3 nad wpisami", () => {
    const block = postList();
    const ctx: RenderEmailCtx = { postsByBlock: { pl: [postRef()] } };
    const html = renderEmailHtml(docWith([block]), "pl", ctx);
    expect(html).not.toContain("<h3");
    expect(html).toContain("Reforma rynku energii");
  });

  it("wyłączone streszczenie nie przemyca zajawki do maila", () => {
    const block = postList({ showExcerpt: false });
    const ctx: RenderEmailCtx = { postsByBlock: { pl: [postRef()] } };
    expect(renderEmailHtml(docWith([block]), "pl", ctx)).not.toContain("Krótkie streszczenie.");
    expect(renderEmailHtml(docWith([block]), "pl", ctx)).toContain(postRef().title);
  });

  it("wpis bez zajawki nie zostawia pustego akapitu pod tytułem", () => {
    const block = postList();
    const ctx: RenderEmailCtx = { postsByBlock: { pl: [postRef({ excerpt: "" })] } };
    const html = renderEmailHtml(docWith([block]), "pl", ctx);
    expect(html).not.toContain("font-size:13px;line-height:1.5");
    expect(html).toContain(postRef().title);
  });

  it("odbiorca angielski dostaje 'Read more', a nie polskie 'Czytaj więcej'", () => {
    const block = postList({ heading: { pl: "Najnowsze", en: "Latest" } });
    const ctx: RenderEmailCtx = { postsByBlock: { pl: [postRef()] } };
    const html = renderEmailHtml(docWith([block]), "en", ctx);
    expect(html).toContain("Read more");
    expect(html).not.toContain("Czytaj więcej");
    expect(html).toContain("Latest");
  });

  it("układ kart z okładką pokazuje obraz nad tytułem", () => {
    const block = postList({ layout: "cards" });
    const ctx: RenderEmailCtx = {
      postsByBlock: { pl: [postRef({ coverUrl: "https://cdn.example.org/okladka.jpg" })] },
    };
    const html = renderEmailHtml(docWith([block]), "pl", ctx);
    expect(html).toContain("cdn.example.org/okladka.jpg");
    expect(html).toContain("padding-top:8px");
  });

  it("karta bez okładki spada do układu listy zamiast wysłać dziurę po obrazku", () => {
    const block = postList({ layout: "cards" });
    const ctx: RenderEmailCtx = { postsByBlock: { pl: [postRef({ coverUrl: null })] } };
    const html = renderEmailHtml(docWith([block]), "pl", ctx);
    expect(html).not.toContain("<img");
    expect(html).toContain("border-left:3px solid");
  });
});
