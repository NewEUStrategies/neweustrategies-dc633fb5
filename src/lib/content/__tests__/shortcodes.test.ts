import { describe, expect, it } from "vitest";
import {
  decorateStandaloneShortcodes,
  normalizeShortcodeQuotes,
  parseShortcodeAttrs,
  resolveStandaloneShortcode,
  shortcodeAttr,
  standaloneShortcode,
} from "@/lib/content/shortcodes";
import { parseEmbedUrl, isIframeEmbed } from "@/lib/blocks/embed";
import { parseGutenberg, stripFoxizShortcodes } from "@/lib/blocks/gutenberg";
import { htmlToBlocks } from "@/lib/blocks/migrate";

const ID = "70a51249-9c3c-4ce0-9929-83c21de9113a";
// Shortcode dokładnie tak, jak zapisał go WordPress we wpisie
// /blog/droga-obalenia-hegemonii-funta-i-ustanowienie-imperium-dolara.
const PROD_SHORTCODE = `[infogram id=”${ID}” prefix=”fKm” format=”interactive” title=””]`;
const INFOGRAM_EMBED = `https://e.infogram.com/${ID}?src=embed`;

describe("normalizeShortcodeQuotes - cudzysłowy WordPressa tylko w znaczniku", () => {
  it.each([
    ["proste", `[infogram id="${ID}" format="interactive"]`],
    ["”…”", `[infogram id=”${ID}” format=”interactive”]`],
    ["“…”", `[infogram id=“${ID}” format=“interactive”]`],
    ["&#8221;", `[infogram id=&#8221;${ID}&#8221; format=&#8221;interactive&#8221;]`],
    ["&#8220;/&#8221;", `[infogram id=&#8220;${ID}&#8221; format=&#8220;interactive&#8221;]`],
    ["″", `[infogram id=″${ID}″ format=″interactive″]`],
    ["&#8243;", `[infogram id=&#8243;${ID}&#8243; format=&#8243;interactive&#8243;]`],
    ["&quot;", `[infogram id=&quot;${ID}&quot; format=&quot;interactive&quot;]`],
  ])("%s dają ten sam wynik", (_label, raw) => {
    expect(normalizeShortcodeQuotes(raw)).toBe(`[infogram id="${ID}" format="interactive"]`);
    expect(standaloneShortcode(raw)?.attrs).toEqual({ id: ID, format: "interactive" });
  });

  it("polskie „cudzysłowy” poza znacznikiem zostają nietknięte", () => {
    const text = `Minister nazwał to „końcem epoki” i dodał: [infogram id=”${ID}”] oraz &#8222;tak&#8221;.`;
    expect(normalizeShortcodeQuotes(text)).toBe(
      `Minister nazwał to „końcem epoki” i dodał: [infogram id="${ID}"] oraz &#8222;tak&#8221;.`,
    );
  });

  it("nie rusza nawiasów bez atrybutów ani nawiasu obejmującego znaczniki HTML", () => {
    expect(normalizeShortcodeQuotes("[1] i [sic] „cytat”")).toBe("[1] i [sic] „cytat”");
    const html = '[zob <a title="&quot;X&quot;" href="#">x</a>]';
    expect(normalizeShortcodeQuotes(html)).toBe(html);
  });

  it("scAttr: atrybuty w cudzysłowach podwójnych, pojedynczych i bez cudzysłowów", () => {
    expect(parseShortcodeAttrs(` id=”${ID}” Title='Wykres' w=480`)).toEqual({
      id: ID,
      title: "Wykres",
      w: "480",
    });
    expect(shortcodeAttr(` url=&#8221;https://x.test&#8221;`, "url")).toBe("https://x.test");
    expect(shortcodeAttr(" a=1", "missing")).toBe("");
  });
});

describe("resolveStandaloneShortcode - render wpisów z bazy", () => {
  it("samodzielny [infogram] z produkcji daje embed e.infogram.com", () => {
    for (const html of [
      PROD_SHORTCODE,
      `<p>${PROD_SHORTCODE}</p>`,
      `<p>&nbsp;${PROD_SHORTCODE}<br></p>`,
    ]) {
      expect(resolveStandaloneShortcode(html)).toEqual({
        kind: "embed",
        name: "infogram",
        url: INFOGRAM_EMBED,
      });
    }
    const parsed = parseEmbedUrl(INFOGRAM_EMBED);
    expect(parsed?.provider).toBe("infogram");
    expect(parsed?.embedUrl).toBe(INFOGRAM_EMBED);
    expect(isIframeEmbed(parsed)).toBe(true);
  });

  it("nieznany samodzielny shortcode jest `unsupported` (czytelnik go nie widzi)", () => {
    expect(resolveStandaloneShortcode('<p>[su_divider top="no"]</p>')).toEqual({
      kind: "unsupported",
      name: "su_divider",
    });
    expect(resolveStandaloneShortcode("[gallery]")).toEqual({
      kind: "unsupported",
      name: "gallery",
    });
    expect(resolveStandaloneShortcode("[foo_bar][/foo_bar]")?.kind).toBe("unsupported");
  });

  it("shortcode w środku zdania i zwykły tekst w nawiasie zostają bez zmian", () => {
    expect(
      resolveStandaloneShortcode(`<p>Zobacz wykres ${PROD_SHORTCODE} poniżej.</p>`),
    ).toBeNull();
    expect(resolveStandaloneShortcode("<p>[aktualizacja]</p>")).toBeNull();
    expect(resolveStandaloneShortcode("<p>[1]</p>")).toBeNull();
    expect(resolveStandaloneShortcode("<p>[su_note]Ważna uwaga redakcji[/su_note]</p>")).toBeNull();
    expect(resolveStandaloneShortcode("<p><strong>[x a=1]</strong> tekst</p>")).toBeNull();
    expect(resolveStandaloneShortcode("")).toBeNull();
  });

  it("[embed]URL[/embed] i su_youtube idą przez listę dostawców", () => {
    expect(resolveStandaloneShortcode("[embed]https://youtu.be/dQw4w9WgXcQ[/embed]")).toEqual({
      kind: "embed",
      name: "embed",
      url: "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(
      resolveStandaloneShortcode("[su_youtube url=”https://www.youtube.com/watch?v=dQw4w9WgXcQ”]")
        ?.kind,
    ).toBe("embed");
    // Adres spoza listy dostawców iframe nie daje osadzenia.
    expect(resolveStandaloneShortcode("[embed]https://example.com/strona[/embed]")?.kind).toBe(
      "unsupported",
    );
  });

  it("wstrzyknięcie w atrybucie ani `javascript:` nie dają iframe'u ani atrybutu", () => {
    for (const raw of [
      '[infogram id="x\\" onload=alert(1) "]',
      '[infogram id="javascript:alert(1)"]',
      "[embed]javascript:alert(1)[/embed]",
      '[su_youtube url="javascript:alert(1)"]',
      '[infogram id="../../evil.example/x"]',
    ]) {
      const resolved = resolveStandaloneShortcode(raw);
      expect(resolved?.kind).toBe("unsupported");
      const html = decorateStandaloneShortcodes(`<p>${raw}</p>`);
      expect(html).toBe("");
      expect(html).not.toContain("iframe");
      expect(html).not.toContain("onload");
    }
    expect(parseEmbedUrl("https://e.infogram.com/x%22onload")?.provider).not.toBe("infogram");
    // Dodatkowy atrybut obok poprawnego `id` jest ignorowany - do HTML trafia
    // wyłącznie adres zbudowany z walidowanego identyfikatora.
    const extra = decorateStandaloneShortcodes(
      `<p>[infogram id="${ID}&quot; onload=&quot;alert(1)"]</p>`,
    );
    expect(extra).toContain(`<iframe src="${INFOGRAM_EMBED}"`);
    expect(extra).not.toContain("onload");
    expect(extra).not.toContain("alert");
  });
});

describe("decorateStandaloneShortcodes - legacy HTML i widget tekstu", () => {
  it("akapit z samym shortcode'em staje się ramką e.infogram.com, nieznany znika", () => {
    const html = `<p>Wstęp.</p><p>${PROD_SHORTCODE}</p><p>[su_divider]</p><p>Dalej.</p>`;
    const out = decorateStandaloneShortcodes(html);
    expect(out).not.toContain("[infogram");
    expect(out).not.toContain("su_divider");
    expect(out).toContain(`<iframe src="${INFOGRAM_EMBED}"`);
    expect(out).toContain('class="relative min-h-[480px] w-full"');
    expect(out.startsWith("<p>Wstęp.</p>")).toBe(true);
    expect(out.endsWith("<p>Dalej.</p>")).toBe(true);
  });

  it("goła linia między blokami (treść klasyczna) też jest obsłużona", () => {
    const out = decorateStandaloneShortcodes(`<p>A</p>\n${PROD_SHORTCODE}\n<p>B</p>`);
    expect(out).toContain(`<iframe src="${INFOGRAM_EMBED}"`);
    expect(out).not.toContain("[infogram");
  });

  it("shortcode w środku zdania i HTML bez `[` zostają bez zmian", () => {
    const inline = `<p>Zobacz ${PROD_SHORTCODE} niżej.</p>`;
    expect(decorateStandaloneShortcodes(inline)).toBe(inline);
    const plain = "<p>Bez nawiasów.</p>";
    expect(decorateStandaloneShortcodes(plain)).toBe(plain);
  });

  it("adres osadzenia z encjami jest escapowany w atrybucie", () => {
    const out = decorateStandaloneShortcodes(
      "<p>[embed]https://soundcloud.com/a/b?x=1&y=2[/embed]</p>",
    );
    expect(out).toContain("&amp;");
    expect(out).not.toMatch(/src="[^"]*&(?!amp;)[^"]*"/);
  });
});

describe("import WordPressa - [infogram] daje blok embed", () => {
  it("SHORTCODE_RULES zamieniają shortcode na osadzenie o walidowanym adresie", () => {
    expect(stripFoxizShortcodes(PROD_SHORTCODE)).toBe(`<iframe src="${INFOGRAM_EMBED}"></iframe>`);
    // Niepoprawny `id` zostaje bez zmian (render go ukrywa).
    expect(stripFoxizShortcodes('[infogram id="javascript:alert(1)"]')).toBe(
      '[infogram id="javascript:alert(1)"]',
    );
    // W środku zdania shortcode zostaje tekstem - `<iframe>` zostałby wycięty
    // przez sanitizer i zostawił dziurę w zdaniu.
    const inline = `<p>Zobacz ${PROD_SHORTCODE} poniżej.</p>`;
    expect(stripFoxizShortcodes(inline)).toBe(
      `<p>Zobacz [infogram id="${ID}" prefix="fKm" format="interactive" title=""] poniżej.</p>`,
    );
  });

  it("Gutenberg: akapit i blok shortcode z [infogram] -> blok embed, nie <iframe> w akapicie", () => {
    const doc = parseGutenberg(
      `<!-- wp:paragraph --><p>Wstęp.</p><!-- /wp:paragraph -->\n` +
        `<!-- wp:paragraph --><p>${PROD_SHORTCODE}</p><!-- /wp:paragraph -->\n` +
        `<!-- wp:shortcode -->${PROD_SHORTCODE}<!-- /wp:shortcode -->`,
    );
    expect(doc.blocks.map((b) => b.type)).toEqual(["paragraph", "embed", "embed"]);
    expect(doc.blocks[1].data.url).toBe(INFOGRAM_EMBED);
    expect(JSON.stringify(doc)).not.toContain("<iframe");
  });

  it("treść klasyczna: <p>[infogram]</p> i goły shortcode -> blok embed", () => {
    const classic = parseGutenberg(`<p>Wstęp.</p><p>${PROD_SHORTCODE}</p>`);
    expect(classic.blocks.map((b) => b.type)).toEqual(["paragraph", "embed"]);
    const bare = htmlToBlocks(stripFoxizShortcodes(`<p>Wstęp.</p>\n${PROD_SHORTCODE}`));
    expect(bare.blocks.map((b) => b.type)).toEqual(["paragraph", "embed"]);
  });

  it("polskie cudzysłowy w treści przechodzą import bez zmian", () => {
    const doc = parseGutenberg(
      "<!-- wp:paragraph --><p>To był „koniec epoki” funta.</p><!-- /wp:paragraph -->",
    );
    expect(doc.blocks[0].data.html).toBe("To był „koniec epoki” funta.");
  });
});
