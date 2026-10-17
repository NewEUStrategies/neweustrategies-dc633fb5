// @vitest-environment happy-dom
//
// Podgląd Markdownu w edytorze wpisu: `marked` -> `sanitizeMarkdownHtml`.
//
// Dwie połowy kontraktu, obie load-bearing:
//
//   1. UŻYTECZNOŚĆ - zamiana react-markdown na marked nie może zmienić tego, co
//      redaktor widzi dla zwykłego CommonMarku: nagłówki, listy (też
//      zagnieżdżone), linki, kod blokowy i inline, cytaty, obrazki. Przy
//      `gfm: false` składnia GFM (tabele, `~~…~~`, gołe `www.`) zostaje tekstem,
//      dokładnie jak w dotychczasowym podglądzie bez remark-gfm.
//   2. SZCZELNOŚĆ - marked z definicji przepuszcza surowy HTML i nie filtruje
//      schematów URL. Test (a) PRZYPINA to zachowanie parsera, żeby nikt nie
//      uznał `markdownToUnsafeHtml` za bezpieczne, i (b) dowodzi, że złożenie
//      użyte w PostEditor (sanityzacja PO parserze) usuwa `<script>`, każdy
//      handler `on*` i URL-e `javascript:` - także zaszyte w składni Markdownu
//      (`[x](javascript:…)`, `![x](javascript:…)`), nie tylko w surowym HTML-u.
//
// Asercje idą przez sparsowany DOM, nie podciągi: `alert(1)` jako zwykły tekst
// akapitu jest bezpieczny, `<a href="javascript:…">` nie.
import { describe, expect, it } from "vitest";
import { sanitizeMarkdownHtml } from "@/lib/sanitize";
import { markdownToUnsafeHtml } from "../markdownPreview";

/** Dokładnie to złożenie, które PostEditor stawia przy sinku. */
const preview = (md: string): string => sanitizeMarkdownHtml(markdownToUnsafeHtml(md));

function dom(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  return tpl.content;
}

/** Wszystkie atrybuty `on*` w drzewie (nie tylko cztery z FORBID_ATTR). */
function eventHandlerAttrs(root: DocumentFragment): string[] {
  return [...root.querySelectorAll("*")].flatMap((el) =>
    [...el.attributes].map((a) => a.name).filter((n) => /^on/i.test(n)),
  );
}

/** Wartości atrybutów URL ze schematem skryptowym. */
function scriptUrls(root: DocumentFragment): string[] {
  return [...root.querySelectorAll("[href],[src],[action],[formaction],[xlink\\:href]")].flatMap(
    (el) =>
      ["href", "src", "action", "formaction", "xlink:href"]
        .map((n) => el.getAttribute(n) ?? "")
        .filter((v) => /^\s*(?:javascript|vbscript|data:text\/html)/i.test(v)),
  );
}

describe("markdownToUnsafeHtml - CommonMark jak w dotychczasowym podglądzie", () => {
  it("renderuje nagłówki wszystkich poziomów ATX i setext", () => {
    const root = dom(preview("# Jeden\n\n## Dwa\n\n### Trzy\n\nCztery\n------"));
    expect([...root.querySelectorAll("h1,h2,h3")].map((h) => [h.tagName, h.textContent])).toEqual([
      ["H1", "Jeden"],
      ["H2", "Dwa"],
      ["H3", "Trzy"],
      ["H2", "Cztery"],
    ]);
  });

  it("renderuje listy punktowane, numerowane i zagnieżdżone", () => {
    const root = dom(preview("- a\n- b\n  - b1\n\n1. x\n2. y"));
    const ul = root.querySelector("ul");
    expect([...ul!.children].map((li) => li.firstChild?.textContent?.trim())).toEqual(["a", "b"]);
    expect(ul!.querySelector("li ul li")?.textContent).toBe("b1");
    expect([...root.querySelectorAll("ol > li")].map((li) => li.textContent)).toEqual(["x", "y"]);
  });

  it("renderuje linki (z tytułem i referencyjne) z bezpiecznym href", () => {
    const root = dom(preview('[strona](https://example.com "Tytuł") i [ref][1]\n\n[1]: /wpis'));
    const links = [...root.querySelectorAll("a")];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["strona", "https://example.com"],
      ["ref", "/wpis"],
    ]);
    expect(links[0].getAttribute("title")).toBe("Tytuł");
  });

  it("renderuje blok kodu z językiem i kod inline, escapując ich treść", () => {
    const root = dom(preview("```ts\nconst a = 1 < 2 && <b>x</b>;\n```\n\nI `<i>inline</i>`."));
    const block = root.querySelector("pre > code");
    expect(block?.className).toBe("language-ts");
    // Znaczniki w kodzie są TEKSTEM, nie elementami.
    expect(block?.textContent).toBe("const a = 1 < 2 && <b>x</b>;\n");
    expect(block?.querySelector("b")).toBeNull();
    const inline = root.querySelector("p > code");
    expect(inline?.textContent).toBe("<i>inline</i>");
    expect(inline?.querySelector("i")).toBeNull();
  });

  it("renderuje akcenty, cytat i obrazek", () => {
    const root = dom(preview("**mocno** _lekko_\n\n> cytat\n\n![opis](https://e.com/a.png)"));
    expect(root.querySelector("strong")?.textContent).toBe("mocno");
    expect(root.querySelector("em")?.textContent).toBe("lekko");
    expect(root.querySelector("blockquote")?.textContent?.trim()).toBe("cytat");
    const img = root.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://e.com/a.png");
    expect(img?.getAttribute("alt")).toBe("opis");
  });

  it("NIE włącza GFM - tabele, skreślenia i gołe adresy zostają tekstem jak dotąd", () => {
    // Parytet z react-markdown bez remark-gfm. Gdyby ktoś przestawił `gfm`,
    // podgląd zacząłby pokazywać tabele, których dotychczas nie pokazywał.
    const root = dom(preview("| a | b |\n|---|---|\n| 1 | 2 |\n\n~~skreślone~~ www.example.com"));
    expect(root.querySelector("table")).toBeNull();
    expect(root.querySelector("del")).toBeNull();
    expect(root.querySelector("a")).toBeNull();
  });

  it("pojedynczy enter to miękkie złamanie (breaks: false)", () => {
    expect(dom(preview("linia1\nlinia2")).querySelector("br")).toBeNull();
  });
});

describe("markdownToUnsafeHtml - parser SAM NIE SANITYZUJE (przypięte)", () => {
  // Jeśli te asercje kiedyś padną (np. nowa wersja marked zacznie escape'ować
  // HTML), to dobra wiadomość - ale sanityzacja przy sinku ZOSTAJE: ten test
  // istnieje po to, żeby nikt nie zdjął jej, wierząc nazwie biblioteki.
  it("przepuszcza surowy <script> i handlery on*", () => {
    const raw = markdownToUnsafeHtml('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">');
    expect(raw).toContain("<script>");
    expect(raw).toContain("onerror=");
  });

  it("przepuszcza href javascript: z linku Markdownu", () => {
    expect(markdownToUnsafeHtml("[x](javascript:alert(1))")).toContain(
      'href="javascript:alert(1)"',
    );
  });
});

describe("podgląd PostEditora (sanityzacja PO parserze) - XSS", () => {
  // JEDEN WEKTOR NA PRZYPADEK, jak w kanarku (lib/sanitizeEngineGuard.ts):
  // parser happy-dom przestawia rodzeństwo po elemencie raw-text, więc
  // `<style>` POPRZEDZONY `<script>` w jednym wejściu przeżywa tu nawet
  // sprawny DOMPurify 3.4.7 (zmierzone; w przeglądarce nie). Zbiorczy ładunek
  // badałby parser środowiska testowego, a nie sanitizer.
  it.each([
    ["script", "<script>alert(1)</script>"],
    ["style", "<style>p{}</style>"],
    ["iframe", "<iframe></iframe>"],
    ["object", '<object data="x"></object>'],
    ["embed", '<embed src="x">'],
    ["form", "<form><button>x</button></form>"],
  ])("usuwa <%s> z surowego HTML-u w Markdownie", (tag, payload) => {
    const root = dom(preview(`ok\n\n${payload}`));
    expect(root.querySelector(tag)).toBeNull();
    // Reszta treści przeżywa jako markup - sanitizer nie wpadł w fail-closed.
    expect(root.querySelector("p")?.textContent).toBe("ok");
  });

  it("usuwa KAŻDY handler on*, także spoza listy FORBID_ATTR", () => {
    const root = dom(
      preview(
        [
          '<img src="https://e.com/a.png" onerror="alert(1)" onload="alert(2)">',
          '<a href="https://e.com" onfocus="alert(3)" onmouseenter="alert(4)">a</a>',
          '<details open ontoggle="alert(5)"><summary>s</summary></details>',
          '<p onpointerdown="alert(6)">p</p>',
        ].join("\n\n"),
      ),
    );
    expect(eventHandlerAttrs(root)).toEqual([]);
    // Bezpieczna część znaczników przeżywa - sanitizer nie wpadł w fail-closed.
    expect(root.querySelector("img")?.getAttribute("src")).toBe("https://e.com/a.png");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://e.com");
  });

  it("usuwa URL-e javascript: z linków i obrazków składni Markdownu", () => {
    const root = dom(
      preview(
        [
          "[a](javascript:alert(1))",
          "[b](JaVaScRiPt:alert(1))",
          "[c](%6Aavascript:alert(1))",
          "[d]: javascript:alert(1)\n\n[d]",
          "![e](javascript:alert(1))",
          "<javascript:alert(1)>",
        ].join("\n\n"),
      ),
    );
    expect(scriptUrls(root)).toEqual([]);
  });

  it("usuwa URL-e javascript: i data:text/html z surowego HTML-u", () => {
    const root = dom(
      preview(
        '<a href="javascript:alert(1)">a</a> <a href="&#106;avascript:alert(1)">b</a> ' +
          '<a href="data:text/html,<script>alert(1)</script>">c</a>',
      ),
    );
    expect(scriptUrls(root)).toEqual([]);
  });

  it("surowy bezpieczny HTML renderuje się jak po publikacji (ta sama polityka)", () => {
    // react-markdown pokazywał `<b>` jako zaescape'owany tekst; publiczny
    // renderer (sanitizeMarkdownHtml) pokazuje go jako pogrubienie.
    const root = dom(preview("Zwykły <b>pogrubiony</b> tekst"));
    expect(root.querySelector("b")?.textContent).toBe("pogrubiony");
  });
});

describe("markdownToUnsafeHtml - odporność: szkic autora nie zamraża ani nie wywraca edytora", () => {
  // Podgląd parsuje SYNCHRONICZNIE przy otwarciu wpisu i na każdy znak, a szkic
  // może zapisać inna osoba (rola `author`).
  //
  // Dowód działania strażnika akcentów jest DETERMINISTYCZNY: po wyczerpaniu
  // budżetu akcent w kolejnym akapicie zostaje dosłownym tekstem (bez
  // strażnika byłby `<em>`), a łańcuch zagnieżdżeń urywa się zamiast przepełnić
  // stos. Progi czasowe są tylko drugą linią, z zapasem >= 10x na obciążone CI
  // (zmierzone 10-300 ms; bez zabezpieczeń te wejścia to 5-30 s).
  const timed = (md: string) => {
    const t0 = performance.now();
    const html = markdownToUnsafeHtml(md);
    return { html, ms: performance.now() - t0 };
  };
  const TAIL = "\n\nKoniec *ostatni*";

  it("niedomknięte `![a](`/`[a](` parsują się liniowo (marked 15.0.12: 5 KB ~ 8 s)", () => {
    const img = timed("![a](".repeat(4000));
    expect(img.ms).toBeLessThan(2000);
    expect(dom(img.html).textContent?.trim()).toBe("![a](".repeat(4000));
    expect(timed("[a](".repeat(16000)).ms).toBeLessThan(2000);
  });

  it.each([
    ["`_a `", "_a ".repeat(8000)],
    ["`**a `", "**a ".repeat(6000)],
    ["`*(a `", "*(a ".repeat(8000)],
    ["`[*a](`", "[*a](".repeat(6000)],
    ["`*_ `", "*_ ".repeat(16000)],
  ])(
    "niedomknięte otwarcia akcentu %s wyczerpują budżet - tekst dosłownie, dalej bez akcentów",
    (_, src) => {
      const { html, ms } = timed(src + TAIL);
      const root = dom(sanitizeMarkdownHtml(html));
      expect(root.querySelector("em, strong")).toBeNull();
      expect(root.textContent).toContain(src.trim());
      // Deterministyczny dowód, że budżet zadziałał: bez niego tu byłby <em>.
      expect(root.textContent).toContain("Koniec *ostatni*");
      expect(ms).toBeLessThan(3000);
    },
  );

  it("zagnieżdżone DOMKNIĘTE akcenty: łańcuch urywa się na budżecie, bez RangeError i <pre>", () => {
    // Bez strażnika 3000 poziomów przepełnia stos (~2 s, potem <pre> ze
    // źródłem), a 10 akapitów po 1500 poziomów to ~5 s kwadratowego skanu.
    const chain = "*a ".repeat(3000) + "a* ".repeat(3000);
    const deep = timed(chain + TAIL);
    const root = dom(deep.html);
    expect(root.querySelector("pre")).toBeNull();
    const levels = root.querySelectorAll("em").length;
    expect(levels).toBeGreaterThan(0);
    expect(levels).toBeLessThan(3000);
    expect(root.textContent).toContain("Koniec *ostatni*");
    expect(deep.ms).toBeLessThan(3000);

    const paras = Array.from({ length: 10 }, () => "*a ".repeat(1500) + "a* ".repeat(1500));
    expect(timed(paras.join("\n\n")).ms).toBeLessThan(3000);
  });

  it("budżet akcentów jest per wywołanie - po patologicznym szkicu zwykły znowu ma akcenty", () => {
    markdownToUnsafeHtml("*a ".repeat(8000));
    const root = dom(preview("Zwykły *nacisk* i **mocno**."));
    expect(root.querySelector("em")?.textContent).toBe("nacisk");
    expect(root.querySelector("strong")?.textContent).toBe("mocno");
  });

  it("duży zwykły dokument nie wyczerpuje budżetu - akcent na samym końcu działa", () => {
    const para = (i: number) =>
      `Akapit ${i} z **pogrubieniem**, _kursywą_ i [linkiem](https://e.com/${i}).`;
    const md = Array.from({ length: 2000 }, (_, i) => para(i)).join("\n\n") + TAIL;
    const root = dom(markdownToUnsafeHtml(md));
    expect(root.querySelectorAll("strong")).toHaveLength(2000);
    expect([...root.querySelectorAll("em")].at(-1)?.textContent).toBe("ostatni");
  });

  it("`_` wewnątrz słowa i `*` przed spacją nic nie kosztują nawet w jednym długim akapicie", () => {
    // Warunki wstępne skanu są przepisane z Tokenizer.emStrong: gdyby każde
    // `snake_case` (tu 40 000, akapit ~320 KB) płaciło za resztę akapitu,
    // budżet padłby po kilku słowach i końcowy akcent zostałby tekstem.
    const md = "snake_case_name 5 * 3 ".repeat(20000) + "i *koniec*";
    const root = dom(markdownToUnsafeHtml(md));
    expect(root.querySelector("em")?.textContent).toBe("koniec");
  });

  it.each([
    ["cytaty", "> "],
    ["listy numerowane", "1. "],
    ["cytat w liście", "- > "],
  ])("głębokie zagnieżdżenie (%s) nie rzuca - podgląd pokazuje escapowane źródło", (_, unit) => {
    const src = `${unit.repeat(5000)}<b>x</b>`;
    let html = "";
    expect(() => (html = markdownToUnsafeHtml(src))).not.toThrow();
    const root = dom(sanitizeMarkdownHtml(html));
    expect(root.querySelector("pre")?.textContent).toBe(src);
    // Źródło jest TEKSTEM - znacznik z treści nie staje się elementem.
    expect(root.querySelector("b")).toBeNull();
  });
});
