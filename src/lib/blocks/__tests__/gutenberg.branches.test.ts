import { describe, it, expect } from "vitest";
import {
  parseGutenberg,
  blocksToGutenberg,
  isGutenbergHtml,
  stripFoxizShortcodes,
} from "@/lib/blocks/gutenberg";
import { isBlocksDoc } from "@/lib/blocks/schema";
import type { Block, BlocksDoc } from "@/lib/blocks/types";

// Warstwa zgodności z Gutenbergiem/Foxizem to WEJŚCIE dla treści zewnętrznej:
// każde `??`, `||` i `?.` w niej ma ramię „atrybut jest" i ramię „atrybutu nie
// ma", a to drugie decyduje, czy import zachowa obraz i link, czy wstawi pusty
// string. Poniższe tabele chodzą po OBU ramionach - najpierw skróty Foxiza
// (17 reguł, każda z własnym fallbackiem), potem tokenizer, mapowanie typów
// i serializator wsteczny.

const block = (type: Block["type"], data: Record<string, unknown> = {}): Block => ({
  id: `b_${type}`,
  type,
  data: data as Block["data"],
});
const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });

describe("isGutenbergHtml", () => {
  it.each([
    ["null", null, false],
    ["undefined", undefined, false],
    ["pusty string", "", false],
    ["same spacje", "   ", false],
    ["zwykły HTML", "<p>x</p>", false],
    ["komentarz nie-wp", "<!-- inny -->", false],
    // `wp:` musi być zaraz przed literą - `wp:1foo` nie jest nazwą bloku.
    ["wp: z cyfrą", "<!-- wp:1foo -->", false],
    ["wp: z literą", "<!-- wp:paragraph -->", true],
    ["WP: wielkimi literami", "<!-- WP:Paragraph -->", true],
    ["bez spacji po komentarzu", "<!--wp:paragraph -->", true],
  ])("%s -> %s", (_label, input, expected) => {
    expect(isGutenbergHtml(input)).toBe(expected);
  });
});

describe("stripFoxizShortcodes - tabela reguł", () => {
  it("su_quote BEZ cite nie wstawia pustego <cite>", () => {
    const out = stripFoxizShortcodes("[su_quote]Treść[/su_quote]");
    expect(out).toContain("<blockquote><p>Treść</p></blockquote>");
    expect(out).not.toContain("<cite>");
  });

  it("su_quote z cite escapuje znaki specjalne w autorze", () => {
    const out = stripFoxizShortcodes('[su_quote cite="A & <b>B</b>"]T[/su_quote]');
    expect(out).toContain("<cite>A &amp; &lt;b&gt;B&lt;/b&gt;</cite>");
  });

  it.each(["su_note", "su_box"])("%s zamienia się w div.callout", (name) => {
    const out = stripFoxizShortcodes(`[${name} color="#fff"]treść[/${name}]`);
    expect(out).toBe('<div class="callout">treść</div>');
  });

  it("su_spoiler BEZ title dostaje domyślną etykietę", () => {
    const out = stripFoxizShortcodes("[su_spoiler]ukryte[/su_spoiler]");
    expect(out).toContain("<summary>Details</summary>");
  });

  it("su_spoiler z PUSTYM title też dostaje domyślną etykietę (fałszywe, ale prawidłowe)", () => {
    const out = stripFoxizShortcodes('[su_spoiler title=""]ukryte[/su_spoiler]');
    expect(out).toContain("<summary>Details</summary>");
  });

  it("su_spoiler z title używa tytułu", () => {
    expect(stripFoxizShortcodes('[su_spoiler title="Więcej"]x[/su_spoiler]')).toContain(
      "<summary>Więcej</summary>",
    );
  });

  it("su_heading zdejmuje znaczniki z treści", () => {
    expect(stripFoxizShortcodes("[su_heading]<b>Tytuł</b>[/su_heading]")).toBe("<h2>Tytuł</h2>");
  });

  it("su_divider daje <hr>", () => {
    expect(stripFoxizShortcodes("[su_divider style=dotted]")).toBe("<hr>");
  });

  it("su_button czyta url", () => {
    expect(stripFoxizShortcodes('[su_button url="/a"]Go[/su_button]')).toContain('href="/a"');
  });

  it("su_button czyta href, gdy nie ma url", () => {
    expect(stripFoxizShortcodes('[su_button href="/b"]Go[/su_button]')).toContain('href="/b"');
  });

  it("su_button BEZ url i href dostaje href='#', nie puste", () => {
    expect(stripFoxizShortcodes('[su_button style="flat"]Go[/su_button]')).toContain('href="#"');
  });

  it.each(["su_youtube", "su_vimeo", "su_video", "su_audio"])("%s z url daje iframe", (name) => {
    expect(stripFoxizShortcodes(`[${name} url="https://x.test/v"]`)).toBe(
      '<iframe src="https://x.test/v"></iframe>',
    );
  });

  it("su_youtube czyta src, gdy nie ma url", () => {
    expect(stripFoxizShortcodes('[su_youtube src="https://x.test/s"]')).toContain(
      'src="https://x.test/s"',
    );
  });

  it("su_youtube BEZ url i src jest USUWANY (nie zostawia pustego iframe)", () => {
    expect(stripFoxizShortcodes('[su_youtube width="100"]')).toBe("");
  });

  it("su_youtube z parą zamykającą zjada oba znaczniki", () => {
    expect(stripFoxizShortcodes('[su_video url="/v.mp4"][/su_video]')).toBe(
      '<iframe src="/v.mp4"></iframe>',
    );
  });

  it("su_list rozwija zawartość bez opakowania", () => {
    expect(stripFoxizShortcodes("[su_list icon=check]<ul><li>a</li></ul>[/su_list]")).toBe(
      "<ul><li>a</li></ul>",
    );
  });

  it("su_highlight daje <mark>", () => {
    expect(stripFoxizShortcodes("[su_highlight]x[/su_highlight]")).toBe("<mark>x</mark>");
  });

  it("su_table zachowuje tabelę w opakowaniu WP", () => {
    expect(stripFoxizShortcodes("[su_table]<table></table>[/su_table]")).toBe(
      '<div class="wp-block-table"><table></table></div>',
    );
  });

  it("caption BEZ podpisu (sam obraz) nie wstawia pustego figcaption", () => {
    const out = stripFoxizShortcodes('[caption]<img src="/a.jpg"/>[/caption]');
    expect(out).toBe('<figure><img src="/a.jpg"/></figure>');
  });

  it("caption BEZ obrazu daje figure z samym podpisem", () => {
    const out = stripFoxizShortcodes("[caption]tylko podpis[/caption]");
    expect(out).toBe("<figure><figcaption>tylko podpis</figcaption></figure>");
  });

  it("caption escapuje podpis", () => {
    const out = stripFoxizShortcodes('[caption]<img src="/a.jpg"/>A & B[/caption]');
    expect(out).toContain("<figcaption>A &amp; B</figcaption>");
  });

  it("embed zamienia URL na iframe", () => {
    expect(stripFoxizShortcodes("[embed]https://x.test/v[/embed]")).toBe(
      '<iframe src="https://x.test/v"></iframe>',
    );
  });

  it.each(["video", "audio"])("core %s z src daje iframe", (name) => {
    expect(stripFoxizShortcodes(`[${name} src="/m.mp4"]`)).toBe('<iframe src="/m.mp4"></iframe>');
  });

  it("core video czyta url, gdy nie ma src", () => {
    expect(stripFoxizShortcodes('[video url="/m.mp4"]')).toContain('src="/m.mp4"');
  });

  it("core video BEZ src i url jest usuwany", () => {
    expect(stripFoxizShortcodes("[video width=640]")).toBe("");
  });

  it("ruby_button czyta url i etykietę z treści", () => {
    const out = stripFoxizShortcodes('[ruby_button url="/r"]Etykieta[/ruby_button]');
    expect(out).toContain('href="/r"');
    expect(out).toContain(">Etykieta<");
  });

  it("ruby_button czyta href, gdy nie ma url", () => {
    expect(stripFoxizShortcodes('[ruby_button href="/h"]L[/ruby_button]')).toContain('href="/h"');
  });

  it("ruby_button BEZ treści bierze etykietę z atrybutu label", () => {
    const out = stripFoxizShortcodes('[ruby_button url="/r" label="Z atrybutu"]');
    expect(out).toContain(">Z atrybutu<");
  });

  it("ruby_button BEZ url, href i label daje href='#' i pustą etykietę", () => {
    const out = stripFoxizShortcodes("[ruby_button size=big]");
    expect(out).toBe('<p><a class="wp-block-button__link" href="#"></a></p>');
  });

  it.each(["ruby_alert", "ruby_review", "ruby_box", "ruby_cta"])(
    "%s zamienia się w div.callout",
    (name) => {
      expect(stripFoxizShortcodes(`[${name}]t[/${name}]`)).toBe('<div class="callout">t</div>');
    },
  );

  it("foxiz_* jest usuwany razem z treścią pary", () => {
    expect(stripFoxizShortcodes("[foxiz_box]środek[/foxiz_box]")).toBe("");
  });

  it("foxiz_* samodzielny też jest usuwany", () => {
    expect(stripFoxizShortcodes('[foxiz_ads slot="a"]')).toBe("");
  });

  it.each(["[toc]", "[ruby_toc]", "[su_table_of_contents]", '[toc depth="2"]'])(
    "%s staje się znacznikiem komentarza",
    (code) => {
      expect(stripFoxizShortcodes(code)).toBe("<!-- toc -->");
    },
  );

  it("gallery jest usuwana (referencje do obrazów nierozwiązywalne przy imporcie)", () => {
    expect(stripFoxizShortcodes('[gallery ids="1,2,3"]')).toBe("");
  });

  it("nieznany skrót zostaje DOSŁOWNIE (bezstratność)", () => {
    expect(stripFoxizShortcodes("[jakis_wtyczkowy x=1]t[/jakis_wtyczkowy]")).toBe(
      "[jakis_wtyczkowy x=1]t[/jakis_wtyczkowy]",
    );
  });

  it("HTML bez skrótów przechodzi bez zmian", () => {
    expect(stripFoxizShortcodes("<p>zwykły</p>")).toBe("<p>zwykły</p>");
  });

  it("pusty string przechodzi bez zmian", () => {
    expect(stripFoxizShortcodes("")).toBe("");
  });
});

describe("parseGutenberg - atrybuty i tokenizer", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty", ""],
    ["same spacje", "  \n "],
  ])("zwraca pusty dokument dla %s", (_l, input) => {
    const d = parseGutenberg(input);
    expect(d.blocks).toEqual([]);
    expect(d.meta).toBeUndefined();
  });

  it("dokument złożony TYLKO ze skrótu usuwanego zostaje pusty", () => {
    expect(parseGutenberg('[foxiz_ads slot="x"]').blocks).toEqual([]);
  });

  it("atrybuty z niepoprawnym JSON-em są ignorowane, blok zostaje", () => {
    const d = parseGutenberg("<!-- wp:heading {nie-json} --><h2>T</h2><!-- /wp:heading -->");
    expect(d.blocks[0].type).toBe("heading");
    // Brak atrybutów => domyślny poziom 2.
    expect(d.blocks[0].data.level).toBe(2);
  });

  it("atrybuty będące TABLICĄ JSON nie pasują do wzorca - dokument spada na parser HTML", () => {
    // `OPEN_RE` wymaga atrybutów w klamrach `{…}`, więc `[1,2]` nie jest ani
    // atrybutem, ani poprawnym otwarciem bloku: tokenizer nic nie znajduje
    // i całość idzie przez `htmlToBlocks` (bezstratnie, ze znacznikami wp:
    // zachowanymi jako treść akapitu).
    const d = parseGutenberg("<!-- wp:heading [1,2] --><h2>T</h2><!-- /wp:heading -->");
    expect(d.meta).toEqual({ migratedFrom: "html" });
    expect(d.blocks.map((b) => b.type)).toEqual(["paragraph", "heading", "paragraph"]);
    expect(d.blocks[1].data.level).toBe(2);
  });

  it("atrybuty z niepoprawnym JSON-em w klamrach są ignorowane, blok zostaje blokiem wp:", () => {
    const d = parseGutenberg('<!-- wp:heading {"level":} --><h2>T</h2><!-- /wp:heading -->');
    expect(d.meta).toEqual({ migratedFrom: "gutenberg" });
    expect(d.blocks[0].data.level).toBe(2);
  });

  it("blok bez prefiksu przestrzeni nazw dostaje core/", () => {
    const d = parseGutenberg("<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->");
    expect(d.blocks[0].type).toBe("paragraph");
  });

  it("znacznik samodomykający daje token o pustym wnętrzu", () => {
    const d = parseGutenberg('<!-- wp:spacer {"height":40} /-->');
    expect(d.blocks.map((b) => b.type)).toEqual(["separator"]);
  });

  it("blok samodomykający z pustym wnętrzem nie daje bloku - dokument spada na parser HTML", () => {
    // core/html z pustym `inner` zwraca pustą tablicę, więc `parseGutenberg`
    // sięga po `htmlToBlocks(src)`: dokument NIE zostaje pusty, a znacznik
    // przeżywa jako treść akapitu (kontrakt bezstratności).
    const d = parseGutenberg("<!-- wp:html /-->");
    expect(d.meta).toEqual({ migratedFrom: "html" });
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].type).toBe("paragraph");
    expect(d.blocks[0].data.html).toBe("<!-- wp:html /-->");
  });

  it("blok BEZ znacznika zamykającego nie zjada resztek dokumentu", () => {
    const d = parseGutenberg(
      "<!-- wp:paragraph --><p>a</p><!-- /wp:paragraph --><!-- wp:quote --><blockquote>bez zamknięcia",
    );
    expect(d.blocks.map((b) => b.type)).toEqual(["paragraph", "quote"]);
    // Cytat bez zamknięcia dostaje puste wnętrze, nie resztę dokumentu.
    expect(d.blocks[1].data.text).toBe("");
  });

  it("zagnieżdżone bloki o TEJ SAMEJ nazwie domykają się poprawnie", () => {
    const html = [
      "<!-- wp:group --><div>",
      "<!-- wp:group --><div>",
      "<!-- wp:paragraph --><p>środek</p><!-- /wp:paragraph -->",
      "</div><!-- /wp:group -->",
      "</div><!-- /wp:group -->",
    ].join("");
    const d = parseGutenberg(html);
    expect(d.blocks.map((b) => b.type)).toEqual(["paragraph"]);
    expect(d.blocks[0].data.html).toBe("środek");
  });

  it("oznacza dokument źródłem gutenberg", () => {
    expect(parseGutenberg("<!-- wp:paragraph --><p>x</p><!-- /wp:paragraph -->").meta).toEqual({
      migratedFrom: "gutenberg",
    });
  });

  it("core/image BEZ src i bez atrybutu url nie daje bloku - fallback na parser HTML", () => {
    const d = parseGutenberg("<!-- wp:image --><figure></figure><!-- /wp:image -->");
    expect(d.meta).toEqual({ migratedFrom: "html" });
    // Bezstratnie: sama <figure> przeżywa jako blok html.
    expect(d.blocks.map((b) => b.type)).toContain("html");
  });
});

describe("parseGutenberg - mapowanie typów", () => {
  it.each([
    ["core/group", "<!-- wp:group --><div></div><!-- /wp:group -->"],
    ["core/column", "<!-- wp:column --><div></div><!-- /wp:column -->"],
    ["core/details", "<!-- wp:details --><details></details><!-- /wp:details -->"],
    ["core/list-item", "<!-- wp:list-item --><li></li><!-- /wp:list-item -->"],
  ])("kontener %s bez dzieci wp: rozkłada wnętrze parserem HTML, nie gubi go", (_name, html) => {
    const d = parseGutenberg(html);
    // Ścieżka „brak dzieci wp: -> htmlToBlocks(inner)" - wynik zostaje
    // dokumentem Gutenberga, bo bloki POWSTAŁY z tokenu.
    expect(d.meta).toEqual({ migratedFrom: "gutenberg" });
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].type).toBe("paragraph");
  });

  it("kontener z CAŁKOWICIE pustym wnętrzem nie daje bloków", () => {
    const d = parseGutenberg("<!-- wp:group -->   <!-- /wp:group -->");
    // `inner` po `trim()` jest puste, więc kontener zwraca [] i całość
    // spada na parser HTML dokumentu źródłowego.
    expect(d.meta).toEqual({ migratedFrom: "html" });
  });

  it.each(["core/cover", "core/media-text"])(
    "kontener %s bez dzieci wp: rozkłada wnętrze parserem HTML",
    (name) => {
      const short = name.replace("core/", "");
      const d = parseGutenberg(
        `<!-- wp:${short} --><div><h2>Tytuł</h2><p>tekst</p></div><!-- /wp:${short} -->`,
      );
      expect(d.blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    },
  );

  it("core/gallery bez obrazów spada na domyślne mapowanie (nie gubi treści)", () => {
    const d = parseGutenberg("<!-- wp:gallery --><figure>brak img</figure><!-- /wp:gallery -->");
    expect(d.blocks[0].type).toBe("html");
  });

  it("core/gallery pomija img BEZ src, zachowuje pozostałe", () => {
    const d = parseGutenberg(
      '<!-- wp:gallery --><img alt="brak"/><img src="/b.jpg"/><!-- /wp:gallery -->',
    );
    expect(d.blocks).toHaveLength(1);
    expect(d.blocks[0].data.url).toBe("/b.jpg");
  });

  it("core/gallery: img BEZ alt dostaje pusty alt", () => {
    const d = parseGutenberg('<!-- wp:gallery --><img src="/a.jpg"/><!-- /wp:gallery -->');
    expect(d.blocks[0].data.alt).toBe("");
  });

  it("core/paragraph zdejmuje zewnętrzne <p>, zachowuje inline", () => {
    const d = parseGutenberg(
      '<!-- wp:paragraph --><p class="x">a <b>b</b></p><!-- /wp:paragraph -->',
    );
    expect(d.blocks[0].data.html).toBe("a <b>b</b>");
  });

  it.each([
    [1, 2],
    [2, 2],
    [3, 3],
    [4, 4],
    [5, 4],
    [6, 4],
  ])("core/heading level %i klampuje się na %i", (level, expected) => {
    const d = parseGutenberg(
      `<!-- wp:heading {"level":${level}} --><h${level}>T</h${level}><!-- /wp:heading -->`,
    );
    expect(d.blocks[0].data.level).toBe(expected);
  });

  it("core/heading BEZ level dostaje 2", () => {
    const d = parseGutenberg("<!-- wp:heading --><h2>T</h2><!-- /wp:heading -->");
    expect(d.blocks[0].data.level).toBe(2);
  });

  it("core/heading z anchor nie-stringiem dostaje pustą kotwicę", () => {
    const d = parseGutenberg('<!-- wp:heading {"anchor":7} --><h2>T</h2><!-- /wp:heading -->');
    expect(d.blocks[0].data.anchor).toBe("");
  });

  it("core/list BEZ atrybutu ordered jest nieuporządkowana", () => {
    const d = parseGutenberg("<!-- wp:list --><ul><li>a</li></ul><!-- /wp:list -->");
    expect(d.blocks[0].data.ordered).toBe(false);
  });

  it("core/list bez <li> daje listę z pustą tablicą pozycji", () => {
    const d = parseGutenberg("<!-- wp:list --><ul></ul><!-- /wp:list -->");
    expect(d.blocks[0].data.items).toEqual([]);
  });

  it.each(["quote", "pullquote", "verse"])("core/%s BEZ cite daje pusty cite", (name) => {
    const d = parseGutenberg(
      `<!-- wp:${name} --><blockquote><p>T</p></blockquote><!-- /wp:${name} -->`,
    );
    expect(d.blocks[0].type).toBe("quote");
    expect(d.blocks[0].data.cite).toBe("");
    expect(d.blocks[0].data.text).toBe("T");
  });

  it("core/quote usuwa cite z treści cytatu", () => {
    const d = parseGutenberg(
      "<!-- wp:quote --><blockquote><p>T</p><cite> A </cite></blockquote><!-- /wp:quote -->",
    );
    expect(d.blocks[0].data.text).toBe("T");
    expect(d.blocks[0].data.cite).toBe("A");
  });

  it("core/image czyta src ze znacznika img", () => {
    const d = parseGutenberg(
      '<!-- wp:image --><figure><img src="/z.jpg" alt="A"/></figure><!-- /wp:image -->',
    );
    expect(d.blocks[0].data).toEqual({ url: "/z.jpg", alt: "A", caption: "", href: "" });
  });

  it("core/image bez img czyta url z atrybutów", () => {
    const d = parseGutenberg(
      '<!-- wp:image {"url":"/attr.jpg"} --><figure></figure><!-- /wp:image -->',
    );
    expect(d.blocks[0].data.url).toBe("/attr.jpg");
  });

  it("core/image z linkDestination przepisuje href z atrybutów", () => {
    const d = parseGutenberg(
      '<!-- wp:image {"url":"/a.jpg","linkDestination":"custom","href":"/cel"} --><figure></figure><!-- /wp:image -->',
    );
    expect(d.blocks[0].data.href).toBe("/cel");
  });

  it("core/image z linkDestination ale BEZ href dostaje pusty href", () => {
    const d = parseGutenberg(
      '<!-- wp:image {"url":"/a.jpg","linkDestination":"media"} --><figure></figure><!-- /wp:image -->',
    );
    expect(d.blocks[0].data.href).toBe("");
  });

  it("core/image czyta figcaption", () => {
    const d = parseGutenberg(
      '<!-- wp:image --><figure><img src="/a.jpg"/><figcaption><b>Cap</b></figcaption></figure><!-- /wp:image -->',
    );
    expect(d.blocks[0].data.caption).toBe("Cap");
  });

  it.each(["code", "preformatted", "syntaxhighlighter-code"])(
    "core/%s BEZ atrybutu language dostaje pusty język w OBU kluczach",
    (name) => {
      const d = parseGutenberg(`<!-- wp:${name} --><pre><code>x</code></pre><!-- /wp:${name} -->`);
      expect(d.blocks[0].type).toBe("code");
      expect(d.blocks[0].data.lang).toBe("");
      expect(d.blocks[0].data.language).toBe("");
    },
  );

  it("core/code z atrybutem language nie-stringiem dostaje pusty język", () => {
    const d = parseGutenberg(
      '<!-- wp:code {"language":5} --><pre><code>x</code></pre><!-- /wp:code -->',
    );
    expect(d.blocks[0].data.lang).toBe("");
  });

  it("core/code z językiem trzyma OBA klucze w zgodzie", () => {
    const d = parseGutenberg(
      '<!-- wp:code {"language":"ts"} --><pre><code>x</code></pre><!-- /wp:code -->',
    );
    expect(d.blocks[0].data.lang).toBe("ts");
    expect(d.blocks[0].data.language).toBe("ts");
  });

  it.each(["separator", "spacer"])("core/%s daje separator", (name) => {
    const d = parseGutenberg(`<!-- wp:${name} --><hr/><!-- /wp:${name} -->`);
    expect(d.blocks[0].type).toBe("separator");
  });

  it.each(["html", "shortcode", "freeform"])("core/%s z treścią daje blok html", (name) => {
    const d = parseGutenberg(`<!-- wp:${name} --><div>x</div><!-- /wp:${name} -->`);
    expect(d.blocks[0].type).toBe("html");
  });

  it.each([
    "core/embed",
    "core-embed/youtube",
    "core-embed/vimeo",
    "core-embed/twitter",
    "core-embed/instagram",
    "core-embed/facebook",
    "core-embed/tiktok",
    "core-embed/spotify",
    "core-embed/soundcloud",
  ])("%s z atrybutem url daje osadzenie", (name) => {
    const short = name.replace(/^core\//, "");
    const d = parseGutenberg(
      `<!-- wp:${short} {"url":"https://x.test/v"} --><figure></figure><!-- /wp:${short} -->`,
    );
    expect(d.blocks[0].type).toBe("embed");
    expect(d.blocks[0].data.url).toBe("https://x.test/v");
  });

  it("osadzenie bierze provider z providerNameSlug, gdy jest", () => {
    const d = parseGutenberg(
      '<!-- wp:embed {"url":"https://x.test","providerNameSlug":"vimeo"} --><figure></figure><!-- /wp:embed -->',
    );
    expect(d.blocks[0].data.provider).toBe("vimeo");
  });

  it("osadzenie BEZ providerNameSlug bierze provider z nazwy bloku", () => {
    const d = parseGutenberg(
      '<!-- wp:core-embed/youtube --><figure>src="https://y.test/v"</figure><!-- /wp:core-embed/youtube -->',
    );
    expect(d.blocks[0].data.provider).toBe("youtube");
  });

  it("osadzenie bez atrybutu url czyta src z wnętrza", () => {
    const d = parseGutenberg('<!-- wp:video --><video src="/v.mp4"></video><!-- /wp:video -->');
    expect(d.blocks[0].data.url).toBe("/v.mp4");
  });

  it("osadzenie bez src czyta href z wnętrza", () => {
    const d = parseGutenberg('<!-- wp:file --><a href="/x.pdf">X</a><!-- /wp:file -->');
    expect(d.blocks[0].data.url).toBe("/x.pdf");
  });

  it("osadzenie bez src i href czyta goły URL z treści", () => {
    const d = parseGutenberg("<!-- wp:embed -->https://goly.test/x<!-- /wp:embed -->");
    expect(d.blocks[0].data.url).toBe("https://goly.test/x");
  });

  it("osadzenie BEZ żadnego URL-a nie daje bloku - fallback zachowuje markup", () => {
    const d = parseGutenberg("<!-- wp:video --><video></video><!-- /wp:video -->");
    expect(d.meta).toEqual({ migratedFrom: "html" });
    expect(d.blocks).toHaveLength(1);
    expect(String(d.blocks[0].data.html)).toContain("<video>");
  });

  it("core/table z treścią daje blok html", () => {
    const d = parseGutenberg(
      "<!-- wp:table --><table><tr><td>a</td></tr></table><!-- /wp:table -->",
    );
    expect(d.blocks[0].type).toBe("html");
  });

  it.each(["buttons", "button"])("core/%s czyta href i etykietę", (name) => {
    const d = parseGutenberg(
      `<!-- wp:${name} --><div><a href="/c">Klik</a></div><!-- /wp:${name} -->`,
    );
    expect(d.blocks[0].type).toBe("button");
    expect(d.blocks[0].data).toEqual({ href: "/c", text: "Klik", variant: "primary" });
  });

  it("core/button BEZ href dostaje pusty href", () => {
    const d = parseGutenberg("<!-- wp:button --><div>Klik</div><!-- /wp:button -->");
    expect(d.blocks[0].data.href).toBe("");
  });

  it("wynik zawsze przechodzi walidację schematu", () => {
    const d = parseGutenberg(
      [
        '<!-- wp:heading {"level":3} --><h3>T</h3><!-- /wp:heading -->',
        "<!-- wp:paragraph --><p>p</p><!-- /wp:paragraph -->",
        '<!-- wp:image --><figure><img src="/a.jpg"/></figure><!-- /wp:image -->',
      ].join(""),
    );
    expect(isBlocksDoc(d)).toBe(true);
  });
});

describe("blocksToGutenberg - serializator", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["dokument bez bloków", { version: 1 as const, blocks: [] }],
  ])("zwraca pusty string dla %s", (_l, input) => {
    expect(blocksToGutenberg(input)).toBe("");
  });

  it("akapit BEZ html daje pusty <p>", () => {
    expect(blocksToGutenberg(doc([block("paragraph")]))).toContain("<p></p>");
  });

  it("nagłówek BEZ level serializuje h2 i nie dokłada atrybutu anchor", () => {
    const out = blocksToGutenberg(doc([block("heading", { text: "T" })]));
    expect(out).toContain('<!-- wp:heading {"level":2} -->');
    expect(out).toContain("<h2>T</h2>");
    expect(out).not.toContain("anchor");
  });

  it("nagłówek z anchor dokłada atrybut i id", () => {
    const out = blocksToGutenberg(doc([block("heading", { level: 3, anchor: "a-b", text: "T" })]));
    expect(out).toContain('"anchor":"a-b"');
    expect(out).toContain('<h3 id="a-b">T</h3>');
  });

  it("nagłówek z PUSTYM anchor nie dokłada atrybutu (fałszywe, ale prawidłowe)", () => {
    const out = blocksToGutenberg(doc([block("heading", { anchor: "", text: "T" })]));
    expect(out).not.toContain("anchor");
    expect(out).toContain("<h2>T</h2>");
  });

  it("nagłówek escapuje tekst", () => {
    expect(blocksToGutenberg(doc([block("heading", { text: "A & <b>" })]))).toContain(
      "A &amp; &lt;b&gt;",
    );
  });

  it("lista nieuporządkowana nie dokłada atrybutu ordered", () => {
    const out = blocksToGutenberg(doc([block("list", { items: ["a"] })]));
    expect(out).toContain("<!-- wp:list -->");
    expect(out).toContain("<ul><li>a</li></ul>");
  });

  it("lista uporządkowana dokłada atrybut i znacznik ol", () => {
    const out = blocksToGutenberg(doc([block("list", { ordered: true, items: ["a"] })]));
    expect(out).toContain('{"ordered":true}');
    expect(out).toContain("<ol><li>a</li></ol>");
  });

  it("lista z items NIE-tablicą serializuje się jako pusta, nie wywala", () => {
    const out = blocksToGutenberg(doc([block("list", { items: "a,b" })]));
    expect(out).toContain("<ul></ul>");
  });

  it("cytat BEZ cite nie wstawia pustego <cite>", () => {
    const out = blocksToGutenberg(doc([block("quote", { text: "T" })]));
    expect(out).not.toContain("<cite>");
  });

  it("cytat z cite wstawia <cite>", () => {
    expect(blocksToGutenberg(doc([block("quote", { text: "T", cite: "A" })]))).toContain(
      "<cite>A</cite>",
    );
  });

  it("kod BEZ języka nie dokłada atrybutu", () => {
    const out = blocksToGutenberg(doc([block("code", { code: "x" })]));
    expect(out).toBe(
      "<!-- wp:code -->\n" +
        '<pre class="wp-block-code"><code>x</code></pre>\n' +
        "<!-- /wp:code -->",
    );
  });

  it("kod z językiem dokłada atrybut language", () => {
    expect(blocksToGutenberg(doc([block("code", { code: "x", language: "ts" })]))).toContain(
      '{"language":"ts"}',
    );
  });

  it("obraz BEZ url nie dokłada atrybutu url", () => {
    const out = blocksToGutenberg(doc([block("image", {})]));
    expect(out).toContain("<!-- wp:image -->");
    expect(out).toContain('src="" alt=""');
  });

  it("obraz z url dokłada atrybut", () => {
    expect(blocksToGutenberg(doc([block("image", { url: "/a.jpg" })]))).toContain(
      '{"url":"/a.jpg"}',
    );
  });

  it("obraz BEZ caption nie wstawia pustego figcaption", () => {
    expect(blocksToGutenberg(doc([block("image", { url: "/a.jpg" })]))).not.toContain("figcaption");
  });

  it("obraz z caption wstawia figcaption", () => {
    expect(blocksToGutenberg(doc([block("image", { url: "/a.jpg", caption: "C" })]))).toContain(
      "<figcaption>C</figcaption>",
    );
  });

  it("separator serializuje się bez atrybutów", () => {
    expect(blocksToGutenberg(doc([block("separator")]))).toContain("<!-- wp:separator -->");
  });

  it("osadzenie BEZ url serializuje pusty URL", () => {
    expect(blocksToGutenberg(doc([block("embed")]))).toContain('{"url":""}');
  });

  it("przycisk BEZ href dostaje '#'", () => {
    expect(blocksToGutenberg(doc([block("button", { text: "K" })]))).toContain('href="#"');
  });

  it("przycisk z href i tekstem serializuje oba", () => {
    const out = blocksToGutenberg(doc([block("button", { href: "/x", text: "K" })]));
    expect(out).toContain('href="/x"');
    expect(out).toContain(">K<");
  });

  it("blok html serializuje surową treść", () => {
    expect(blocksToGutenberg(doc([block("html", { html: "<i>x</i>" })]))).toContain("<i>x</i>");
  });

  it("blok html BEZ treści serializuje pusty wp:html", () => {
    expect(blocksToGutenberg(doc([block("html")]))).toBe("<!-- wp:html -->\n\n<!-- /wp:html -->");
  });

  it("typ NIEOBSŁUGIWANY spada na wp:html (bezstratność serializacji)", () => {
    const out = blocksToGutenberg(doc([block("countdown", { html: "<x/>" })]));
    expect(out).toContain("<!-- wp:html -->");
  });

  it("wiele bloków rozdziela pustą linią", () => {
    const out = blocksToGutenberg(doc([block("separator"), block("separator")]));
    expect(out.split("\n\n").length).toBeGreaterThan(1);
  });
});
