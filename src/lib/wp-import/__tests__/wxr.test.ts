// @vitest-environment jsdom
// PARSER EKSPORTU WXR (`src/lib/wp-import/wxr.ts`) - jedyna droga wejścia dla
// stron importowanych z pliku XML (self-hosted WordPress bez Jetpacka).
//
// ŚRODOWISKO. Plik JAWNIE żąda jsdom, bo `parseWxr` startuje od sprawdzenia
// `typeof DOMParser === "undefined"` i bez niego rzuca. happy-dom (domyślne
// środowisko repo) nie daje wiarygodnego parsera XML z przestrzeniami nazw,
// a właśnie na `getElementsByTagNameNS` stoi cały odczyt pól `wp:*`.
//
// CO MA TU DOWÓD:
//   1. TRZY warunki rzucenia wyjątkiem: brak DOMParser, `<parsererror>` w
//      wyniku parsowania („Nieprawidłowy XML"), brak `<channel>` (plik nie jest
//      eksportem WordPressa),
//   2. CZTERY warunki odrzucenia wpisu: brak `wp:post_id`, `post_type` inny niż
//      `page` (po wcześniejszym przechwyceniu `attachment` do tablicy okładek),
//      status `trash`, brak treści ORAZ brak `_elementor_data` (jedyny przypadek
//      z ostrzeżeniem - reszta ginie bez śladu, i tak to jest zaprojektowane),
//   3. rozwiązywanie okładki: `_thumbnail_id` -> URL attachmenta, w tym brak
//      trafienia (id bez attachmenta) i attachment bez URL-a,
//   4. odczyt pól z RÓŻNYMI prefiksami przestrzeni nazw i wartości domyślne
//      (slug = wp_id, modified z `post_date_gmt`, status nieznany -> draft),
//   5. `fallbackHtmlFromElementorJson`: DOKŁADNIE cztery rozpoznawane widgety
//      (heading z domyślnym h2, text-editor, image, button z domyślnym "#"),
//      schodzenie po `elements` i przełknięcie KAŻDEGO błędu JSON -> "".
//
// CZEGO NIE DA SIĘ TU DOSIĘGNĄĆ. Osłony `if (!node) continue` w pętlach po
// `NodeList` oraz `textContent ?? ""` - żywa lista DOM nie zwraca dziury pod
// indeksem mniejszym od `length`, a `textContent` elementu nigdy nie jest null.
// Te gałęzie zostają w kodzie (typ DOM dopuszcza null), ale testu na nie nie ma,
// bo wymagałby podrobienia DOM-u, czyli dowodzenia własnej atrapy.
//
// CZEGO TU NIE MA. Nie testujemy konwersji HTML na widgety (`convert.test.ts`,
// `elementor.test.ts`) ani parowania PL/EN w interfejsie (`WxrUploadPanel`).
//
// RODO: żadnych realnych danych osobowych; wszystkie URL-e i adresy e-mail
// wyłącznie w domenach example.com / example.org.
import { afterEach, describe, expect, it } from "vitest";
import { fallbackHtmlFromElementorJson, parseWxr } from "@/lib/wp-import/wxr";

const HEAD = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wp="http://wordpress.org/export/1.2/"
  xmlns:inne="http://example.org/inne/">
  <channel>
    <title>Witryna testowa</title>
    <link>https://example.com</link>`;
const TAIL = `  </channel>
</rss>`;

function wxr(items: string): string {
  return `${HEAD}\n${items}\n${TAIL}`;
}

interface ItemOpts {
  id?: number | string;
  type?: string;
  slug?: string | null;
  title?: string;
  status?: string;
  content?: string;
  excerpt?: string;
  meta?: Array<[string, string]>;
  parent?: number;
  menuOrder?: number;
  modifiedGmt?: string | null;
  dateGmt?: string;
  link?: string;
  attachmentUrl?: string | null;
}

function item(o: ItemOpts): string {
  const meta = (o.meta ?? [])
    .map(
      ([k, v]) =>
        `<wp:postmeta><wp:meta_key>${k}</wp:meta_key><wp:meta_value>${v}</wp:meta_value></wp:postmeta>`,
    )
    .join("");
  return `<item>
  <title>${o.title ?? "Strona"}</title>
  <link>${o.link ?? "https://example.com/strona"}</link>
  ${o.id === undefined ? "" : `<wp:post_id>${o.id}</wp:post_id>`}
  <wp:post_type>${o.type ?? "page"}</wp:post_type>
  ${o.slug === null ? "" : `<wp:post_name>${o.slug ?? "strona"}</wp:post_name>`}
  <wp:status>${o.status ?? "publish"}</wp:status>
  <content:encoded><![CDATA[${o.content ?? "<p>Treść strony.</p>"}]]></content:encoded>
  <excerpt:encoded><![CDATA[${o.excerpt ?? "Zapowiedź"}]]></excerpt:encoded>
  ${o.modifiedGmt === null ? "" : `<wp:post_modified_gmt>${o.modifiedGmt ?? "2026-01-02 10:00:00"}</wp:post_modified_gmt>`}
  <wp:post_date_gmt>${o.dateGmt ?? "2026-01-01 09:00:00"}</wp:post_date_gmt>
  <wp:post_parent>${o.parent ?? 0}</wp:post_parent>
  <wp:menu_order>${o.menuOrder ?? 0}</wp:menu_order>
  ${o.attachmentUrl === null || o.attachmentUrl === undefined ? "" : `<wp:attachment_url>${o.attachmentUrl}</wp:attachment_url>`}
  ${meta}
</item>`;
}

const originalDomParser = globalThis.DOMParser;
afterEach(() => {
  if (globalThis.DOMParser !== originalDomParser) {
    Object.defineProperty(globalThis, "DOMParser", {
      value: originalDomParser,
      configurable: true,
      writable: true,
    });
  }
});

describe("parseWxr - trzy warunki rzucenia wyjątkiem", () => {
  it("bez DOMParser w środowisku mówi wprost, czego wymaga", () => {
    Reflect.deleteProperty(globalThis, "DOMParser");
    expect(() => parseWxr(wxr(item({ id: 1 })))).toThrow(/wymaga środowiska z DOMParser/);
  });

  it("niepoprawny XML kończy się komunikatem o nieprawidłowym XML-u", () => {
    expect(() => parseWxr("<rss><channel><item></channel></rss>")).toThrow(/Nieprawidłowy XML/);
  });

  it("poprawny XML bez <channel> to nie eksport WordPressa", () => {
    expect(() => parseWxr('<?xml version="1.0"?><rss><cos/></rss>')).toThrow(
      /nie zawiera <channel>/,
    );
  });
});

describe("parseWxr - co wchodzi, a co wypada", () => {
  it("czyta stronę z wszystkimi polami i adresem witryny", () => {
    const res = parseWxr(
      wxr(
        item({
          id: 12,
          slug: "o-nas",
          title: "O nas",
          status: "draft",
          content: "<p>Kim jesteśmy.</p>",
          excerpt: "Krótko",
          parent: 3,
          menuOrder: 5,
          link: "https://example.com/o-nas",
        }),
      ),
    );
    expect(res.siteUrl).toBe("https://example.com");
    expect(res.warnings).toEqual([]);
    expect(res.pages).toHaveLength(1);
    const p = res.pages[0];
    expect(p.wpId).toBe(12);
    expect(p.slug).toBe("o-nas");
    expect(p.title).toBe("O nas");
    expect(p.status).toBe("draft");
    expect(p.contentHtml).toBe("<p>Kim jesteśmy.</p>");
    expect(p.excerptHtml).toBe("Krótko");
    expect(p.parentWpId).toBe(3);
    expect(p.menuOrder).toBe(5);
    expect(p.modified).toBe("2026-01-02 10:00:00");
    expect(p.originalUrl).toBe("https://example.com/o-nas");
    expect(p.elementorData).toBeNull();
    expect(p.language).toBeNull();
    expect(p.translationOfWpId).toBeNull();
    expect(p.featuredImageUrl).toBeNull();
  });

  it("bez ŻADNEGO <link> siteUrl to null, a nie pusty łańcuch", () => {
    const noLink = wxr(item({ id: 13 }))
      .replace("<link>https://example.com</link>", "")
      .replace("<link>https://example.com/strona</link>", "");
    const res = parseWxr(noLink);
    expect(res.siteUrl).toBeNull();
    expect(res.pages).toHaveLength(1);
  });

  it("adres witryny czytany <channel>-em sięga W GŁĄB - bez <link> w kanale bierze link wpisu", () => {
    // `textOf` używa `getElementsByTagName`, które przechodzi całe poddrzewo.
    // Skutek jest do zapamiętania przy każdej zmianie tej funkcji: gdy eksport
    // nie ma <link> na poziomie kanału, jako adres witryny wchodzi adres
    // PIERWSZEJ strony, a nie null.
    const noChannelLink = wxr(item({ id: 14, link: "https://example.com/pierwsza" })).replace(
      "<link>https://example.com</link>",
      "",
    );
    expect(parseWxr(noChannelLink).siteUrl).toBe("https://example.com/pierwsza");
  });

  it("wpis bez wp:post_id wypada bez ostrzeżenia", () => {
    const res = parseWxr(wxr(item({ id: undefined }) + item({ id: 7 })));
    expect(res.pages.map((p) => p.wpId)).toEqual([7]);
    expect(res.warnings).toEqual([]);
  });

  it("wpis z post_id = 0 wypada tak samo jak wpis bez identyfikatora", () => {
    const res = parseWxr(wxr(item({ id: 0 })));
    expect(res.pages).toHaveLength(0);
  });

  it("attachment nie jest stroną, ale trafia do tablicy okładek", () => {
    const res = parseWxr(
      wxr(
        item({
          id: 90,
          type: "attachment",
          attachmentUrl: "https://example.com/wp-content/okladka.jpg",
        }) +
          item({ id: 91, type: "attachment", attachmentUrl: null }) +
          item({ id: 5 }),
      ),
    );
    expect(res.pages.map((p) => p.wpId)).toEqual([5]);
    expect(res.attachmentsById.get(90)).toBe("https://example.com/wp-content/okladka.jpg");
    expect(res.attachmentsById.has(91)).toBe(false);
  });

  it("post_type inny niż page ani attachment jest pomijany", () => {
    const res = parseWxr(
      wxr(item({ id: 21, type: "post" }) + item({ id: 22, type: "nav_menu_item" })),
    );
    expect(res.pages).toHaveLength(0);
    expect(res.warnings).toEqual([]);
  });

  it("kosz wypada CICHO, a brak treści z OSTRZEŻENIEM", () => {
    const res = parseWxr(
      wxr(
        item({ id: 31, status: "trash", slug: "usunieta" }) +
          item({ id: 32, slug: "pusta", content: "" }) +
          item({ id: 33, slug: "zywa" }),
      ),
    );
    expect(res.pages.map((p) => p.slug)).toEqual(["zywa"]);
    expect(res.warnings).toEqual(["Strona #32 (pusta) nie ma treści - pomijam."]);
  });

  it("pusta treść, ale obecny _elementor_data - strona ZOSTAJE", () => {
    const res = parseWxr(
      wxr(
        item({
          id: 41,
          content: "",
          meta: [["_elementor_data", '[{"elType":"section"}]']],
        }),
      ),
    );
    expect(res.pages).toHaveLength(1);
    expect(res.pages[0].elementorData).toBe('[{"elType":"section"}]');
    expect(res.warnings).toEqual([]);
  });

  it("nieznany status spada do draft, a znane statusy przechodzą wprost", () => {
    const res = parseWxr(
      wxr(
        item({ id: 51, slug: "a", status: "cos-dziwnego" }) +
          item({ id: 52, slug: "b", status: "PRIVATE" }) +
          item({ id: 53, slug: "c", status: "pending" }) +
          item({ id: 54, slug: "d", status: "future" }),
      ),
    );
    expect(res.pages.map((p) => p.status)).toEqual(["draft", "private", "pending", "future"]);
  });

  it("brak slug-a zastępuje wp_id, a brak post_modified_gmt - datą publikacji", () => {
    const res = parseWxr(wxr(item({ id: 61, slug: null, modifiedGmt: null })));
    expect(res.pages[0].slug).toBe("61");
    expect(res.pages[0].modified).toBe("2026-01-01 09:00:00");
  });

  it("pole z INNYM prefiksem przestrzeni nazw nie jest brane za pole wp:", () => {
    // `tagText` filtruje po prefiksie, a potem próbuje dosłownej nazwy
    // `wp:post_name`. Element `inne:post_name` nie może podmienić sluga.
    const withOtherPrefix = item({ id: 62, slug: null }).replace(
      "<wp:status>",
      "<inne:post_name>podszywka</inne:post_name><wp:status>",
    );
    const res = parseWxr(wxr(withOtherPrefix));
    expect(res.pages[0].slug).toBe("62");
  });
});

describe("parseWxr - okładka i metadane tłumaczeń", () => {
  it("rozwiązuje _thumbnail_id na URL attachmenta", () => {
    const res = parseWxr(
      wxr(
        item({
          id: 70,
          type: "attachment",
          attachmentUrl: "https://example.com/wp-content/hero.png",
        }) + item({ id: 71, meta: [["_thumbnail_id", "70"]] }),
      ),
    );
    expect(res.pages[0].featuredImageUrl).toBe("https://example.com/wp-content/hero.png");
  });

  it("_thumbnail_id bez pasującego attachmenta zostawia okładkę pustą", () => {
    const res = parseWxr(wxr(item({ id: 72, meta: [["_thumbnail_id", "999"]] })));
    expect(res.pages[0].featuredImageUrl).toBeNull();
  });

  it("_thumbnail_id nieliczbowy jest ignorowany", () => {
    const res = parseWxr(wxr(item({ id: 73, meta: [["_thumbnail_id", "brak"]] })));
    expect(res.pages[0].featuredImageUrl).toBeNull();
  });

  it("czyta język z Polylanga i WPML oraz identyfikator tłumaczenia", () => {
    const res = parseWxr(
      wxr(
        item({
          id: 81,
          slug: "pl",
          meta: [
            ["_polylang_language", "pl"],
            ["_polylang_translations_ref", "82"],
          ],
        }) +
          item({ id: 82, slug: "en", meta: [["wpml_language", "en"]] }) +
          item({ id: 83, slug: "x", meta: [["_wpml_media_original", "81"]] }),
      ),
    );
    expect(res.pages.map((p) => p.language)).toEqual(["pl", "en", null]);
    expect(res.pages.map((p) => p.translationOfWpId)).toEqual([82, null, 81]);
  });

  it("postmeta bez klucza nie trafia do mapy metadanych", () => {
    const broken = item({ id: 84 }).replace(
      "</item>",
      "<wp:postmeta><wp:meta_value>bez klucza</wp:meta_value></wp:postmeta></item>",
    );
    const res = parseWxr(wxr(broken));
    expect(res.pages[0].elementorData).toBeNull();
    expect(res.pages[0].language).toBeNull();
  });
});

describe("fallbackHtmlFromElementorJson", () => {
  it("rozpoznaje nagłówek z header_size oraz domyślne h2", () => {
    const json = JSON.stringify([
      { elType: "widget", widgetType: "heading", settings: { title: "Duży", header_size: "H1" } },
      { elType: "widget", widgetType: "heading", settings: { title: "Domyślny" } },
    ]);
    expect(fallbackHtmlFromElementorJson(json)).toBe("<h1>Duży</h1>\n<h2>Domyślny</h2>");
  });

  it("nagłówek bez tekstu nie produkuje pustego znacznika", () => {
    const json = JSON.stringify([{ widgetType: "heading", settings: { title: 12 } }]);
    expect(fallbackHtmlFromElementorJson(json)).toBe("");
  });

  it("text-editor wstawia HTML wprost, także gdy typ siedzi w elType", () => {
    const json = JSON.stringify([
      { widgetType: "text-editor", settings: { editor: "<p>Akapit z Elementora.</p>" } },
      { elType: "text-editor", settings: { editor: "<p>Drugi.</p>" } },
      { widgetType: "text-editor", settings: {} },
    ]);
    expect(fallbackHtmlFromElementorJson(json)).toBe("<p>Akapit z Elementora.</p>\n<p>Drugi.</p>");
  });

  it("image bierze settings.image.url, a bez URL-a nic nie dodaje", () => {
    const json = JSON.stringify([
      { widgetType: "image", settings: { image: { url: "https://example.com/foto.jpg" } } },
      { widgetType: "image", settings: { image: {} } },
      { widgetType: "image", settings: {} },
    ]);
    expect(fallbackHtmlFromElementorJson(json)).toBe(
      '<p><img src="https://example.com/foto.jpg" alt="" /></p>',
    );
  });

  it("button: link z settings.link.url, a bez niego '#'; bez tekstu nic", () => {
    const json = JSON.stringify([
      {
        widgetType: "button",
        settings: { text: "Kontakt", link: { url: "https://example.org/kontakt" } },
      },
      { widgetType: "button", settings: { text: "Bez linku" } },
      { widgetType: "button", settings: { link: { url: "https://example.org/x" } } },
    ]);
    expect(fallbackHtmlFromElementorJson(json)).toBe(
      '<p><a href="https://example.org/kontakt">Kontakt</a></p>\n<p><a href="#">Bez linku</a></p>',
    );
  });

  it("schodzi po elements w głąb i pomija węzły nie-obiektowe", () => {
    const json = JSON.stringify([
      null,
      "tekst",
      {
        elType: "section",
        elements: [
          {
            elType: "column",
            elements: [{ widgetType: "heading", settings: { title: "Głębiej" } }],
          },
          42,
        ],
      },
    ]);
    expect(fallbackHtmlFromElementorJson(json)).toBe("<h2>Głębiej</h2>");
  });

  it("nieznany widget nie wnosi nic, ale nie wysadza fallbacku", () => {
    const json = JSON.stringify([{ widgetType: "accordion", settings: { title: "x" } }]);
    expect(fallbackHtmlFromElementorJson(json)).toBe("");
  });

  it("węzeł BEZ widgetType i BEZ elType jest pomijany, ale dzieci są czytane", () => {
    const json = JSON.stringify([
      {
        settings: { title: "Bez typu" },
        elements: [{ widgetType: "heading", settings: { title: "Dziecko" } }],
      },
    ]);
    expect(fallbackHtmlFromElementorJson(json)).toBe("<h2>Dziecko</h2>");
  });

  it("JSON, który nie jest tablicą, daje pusty łańcuch", () => {
    expect(fallbackHtmlFromElementorJson('{"elType":"section"}')).toBe("");
    expect(fallbackHtmlFromElementorJson("null")).toBe("");
    expect(fallbackHtmlFromElementorJson('"tekst"')).toBe("");
  });

  it("połamany JSON jest przełknięty - zwracamy pusty łańcuch, nie wyjątek", () => {
    expect(fallbackHtmlFromElementorJson("[{elType:")).toBe("");
    expect(fallbackHtmlFromElementorJson("")).toBe("");
  });
});
