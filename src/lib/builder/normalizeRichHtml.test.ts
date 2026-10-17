import { describe, expect, it } from "vitest";
import { normalizeBuilderRichHtml } from "./normalizeRichHtml";
import { normalizeBuilderRichHtmlDom } from "./normalizeRichHtmlDom";

// DWA SILNIKI, JEDEN KONTRAKT. Serwer normalizuje node-html-parserem
// (`normalizeRichHtml.ts`), przeglądarka natywnym parserem
// (`normalizeRichHtmlDom.ts`), żeby parser HTML (~47 KB gzip) nie jechał do
// klienta. Każdy przypadek w tym pliku biegnie przez OBA silniki. Oczekiwania
// są zapisane w postaci serwera (bajt w bajt); silnik DOM porównujemy z tą
// samą treścią w zapisie przeglądarki (`browserForm`) - przeglądarka pisze
// `<ul>` zamiast `<UL>` i `"` zamiast `&quot;` w tekście, a to ten sam dokument.

/** Ten sam HTML w zapisie przeglądarki: małe litery znaczników, encje kanoniczne. */
function browserForm(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.innerHTML;
}

const ENGINES = [
  {
    name: "normalizeBuilderRichHtml [serwer]",
    normalize: normalizeBuilderRichHtml,
    form: (html: string) => html,
  },
  {
    name: "normalizeBuilderRichHtml [DOM]",
    normalize: normalizeBuilderRichHtmlDom,
    form: browserForm,
  },
];

describe.each(ENGINES)("$name", ({ normalize, form }) => {
  it("removes repeated empty list shells from imported Elementor HTML", () => {
    const html = "<ul><li><ul><li><ul><li>Treść</li><li>Drugi punkt</li></ul></li></ul></li></ul>";
    expect(normalize(html)).toBe(form("<ul><li>Treść</li><li>Drugi punkt</li></ul>"));
  });

  it("preserves a genuine nested list", () => {
    const html = "<ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>";
    expect(normalize(html)).toBe(form(html));
  });

  it("normalizes PL and EN markup without changing text", () => {
    const pl = "<ul><li><ul><li>Punkt PL</li></ul></li></ul>";
    const en = "<ul><li><ul><li>English item</li></ul></li></ul>";
    expect(normalize(pl)).toBe(form("<ul><li>Punkt PL</li></ul>"));
    expect(normalize(en)).toBe(form("<ul><li>English item</li></ul>"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poniżej: gałęzie ODMOWY i przypadki brzegowe.
//
// Ten moduł stoi PRZED sanityzacją (RichHtmlListView normalizuje, potem
// RichHtmlContent.tsx:39 woła `sanitizeHtml`), więc na wejściu dostaje
// HTML NIEZAUFANY: import z WordPressa/Elementora, wklejka ze schowka, ręcznie
// wpisany kod. Dwie rzeczy muszą tu być dowiedzione:
//  1) nic się nie wywraca i nic sensownego nie ginie (usuwamy TYLKO puste
//     skorupy, nigdy treści ani adresu linku),
//  2) normalizacja nie ODKRĘCA escapowania - inaczej ładunek zapisany jako
//     tekst wychodziłby z niej jako znaczniki.
// ─────────────────────────────────────────────────────────────────────────────

describe.each(ENGINES)("$name - wejście bez listy", ({ normalize }) => {
  it("HTML bez ul/ol wraca BAJTOWO nietknięty (bez przejścia przez parser)", () => {
    // Skrót po `test(/<(?:ul|ol)\b/)` jest tu istotny nie tylko dla wydajności:
    // pominięcie parsera gwarantuje, że akapit z niestandardowym formatowaniem
    // nie zostanie przepisany przez serializator.
    const html =
      '<p class="x">Akapit <b>pogrubiony</b> i <a href="https://example.com/a">link</a></p>';
    expect(normalize(html)).toBe(html);
  });

  it("pusty łańcuch wraca pusty", () => {
    expect(normalize("")).toBe("");
  });

  it("słowo „ul” w treści nie uruchamia normalizacji", () => {
    // Granica słowa w regexie: „ultra” i „ulica” to nie znaczniki listy.
    expect(normalize("<p>ultra, ulica, ul. Marszałkowska</p>")).toBe(
      "<p>ultra, ulica, ul. Marszałkowska</p>",
    );
  });
});

describe.each(ENGINES)("$name - puste elementy listy", ({ normalize, form }) => {
  it("usuwa punkt z samym &nbsp;, zostawiając punkty z treścią", () => {
    expect(normalize("<ul><li>&nbsp;</li><li>Treść</li></ul>")).toBe(
      form("<ul><li>Treść</li></ul>"),
    );
  });

  it("usuwa punkt z samym <br> (przypadkowy Enter w edytorze)", () => {
    expect(normalize("<ul><li><br></li><li>Treść</li></ul>")).toBe(form("<ul><li>Treść</li></ul>"));
  });

  it("usuwa punkt z samymi białymi znakami", () => {
    expect(normalize("<ul><li>   </li><li>Treść</li></ul>")).toBe(form("<ul><li>Treść</li></ul>"));
  });

  it("usuwa WIELE pustych punktów w jednym przebiegu", () => {
    const html = `<ul>${"<li>&nbsp;</li>".repeat(12)}<li>Ostatni</li></ul>`;
    expect(normalize(html)).toBe(form("<ul><li>Ostatni</li></ul>"));
  });

  it("lista, która straciła WSZYSTKIE punkty, znika razem z nimi", () => {
    // Sama skorupa <ul> bez punktów rysuje pusty margines - to widoczny
    // artefakt importu, nie treść.
    expect(normalize("<ul><li>&nbsp;</li></ul><p>Po liście</p>")).toBe(form("<p>Po liście</p>"));
  });

  it("lista bez ŻADNEGO punktu na wejściu też znika", () => {
    expect(normalize("<ul></ul>")).toBe("");
    expect(normalize("<ul><li><ul></ul></li></ul>")).toBe("");
  });

  it("komentarz HTML nie jest treścią - punkt z samym komentarzem to punkt pusty", () => {
    expect(normalize("<ul><li><!-- pusto --></li><li>Treść</li></ul>")).toBe(
      form("<ul><li>Treść</li></ul>"),
    );
  });
});

describe.each(ENGINES)("$name - punkty bez tekstu, które MUSZĄ zostać", ({ normalize, form }) => {
  it("punkt z linkiem zostaje - adres jest wartością, nie ozdobą", () => {
    const html = '<ul><li><a href="https://example.com/profil"></a></li></ul>';
    expect(normalize(html)).toContain('href="https://example.com/profil"');
  });

  it("punkt z obrazem, ramką, wideo, audio albo przyciskiem zostaje", () => {
    const keepers = [
      '<img src="https://example.com/i.png">',
      '<iframe src="https://example.com/e"></iframe>',
      '<video src="https://example.com/v.mp4"></video>',
      '<audio src="https://example.com/a.mp3"></audio>',
      "<button>Zapisz</button>",
    ];
    for (const keeper of keepers) {
      const html = `<ul><li>${keeper}</li></ul>`;
      expect(normalize(html), `zgubiony nośnik: ${keeper}`).toContain(keeper);
    }
  });

  it("punkt z zagnieżdżoną listą zostaje, nawet gdy sam nie ma tekstu", () => {
    // Bez tego wyjątku krok 1 zjadałby rodzica ZANIM krok 3 zdąży spłaszczyć
    // skorupę - i cała zagnieżdżona lista poleciałaby razem z nim.
    expect(normalize("<ul><li><ul><li>Realny punkt</li></ul></li></ul>")).toBe(
      form("<ul><li>Realny punkt</li></ul>"),
    );
  });
});

describe.each(ENGINES)("$name - spłaszczanie skorup", ({ normalize, form }) => {
  it("skorupa o dowolnej głębokości spłaszcza się do JEDNEJ listy", () => {
    const build = (depth: number) => {
      let html = "<ul><li>Treść</li></ul>";
      for (let i = 0; i < depth; i += 1) html = `<ul><li>${html}</li></ul>`;
      return html;
    };
    for (const depth of [1, 3, 8, 25]) {
      expect(normalize(build(depth)), `głębokość ${depth}`).toBe(form("<ul><li>Treść</li></ul>"));
    }
  });

  it("wynik jest STABILNY - druga normalizacja nic już nie zmienia", () => {
    // Ta sama treść przechodzi normalizację na kanwie buildera i ponownie przy
    // renderze publicznym. Brak idempotencji oznaczałby, że PL/EN dostają
    // inny HTML w zależności od liczby zapisów.
    const inputs = [
      "<ul><li><ul><li>Treść</li></ul></li></ul>",
      '<ul><li><a href="https://example.com/a"></a></li></ul>',
      "<ul><li>&nbsp;</li><li>Treść</li></ul>",
      "<ol><li><ol><li>Jeden</li><li>Dwa</li></ol></li></ol>",
    ];
    for (const input of inputs) {
      const once = normalize(input);
      expect(normalize(once), `niestabilne dla ${input}`).toBe(once);
    }
  });

  it("skorupa <ol> spłaszcza się tak samo jak <ul>", () => {
    expect(normalize("<ol><li><ol><li>Jeden</li></ol></li></ol>")).toBe(
      form("<ol><li>Jeden</li></ol>"),
    );
  });

  it("znaczniki WIELKIMI literami są rozpoznawane", () => {
    // Importy z WordPressa i starsze wklejki z Worda niosą <UL><LI>.
    expect(normalize("<UL><LI><UL><LI>Wielkie</LI></UL></LI></UL>")).toBe(
      form("<UL><LI>Wielkie</LI></UL>"),
    );
  });

  it("lista zagnieżdżona w innym elemencie niż <li> NIE jest spłaszczana", () => {
    // Jedyne dziecko <ul> nie jest punktem listy, więc to nie jest skorupa,
    // której szukamy - dotknięcie tego kształtu gubiłoby <div>.
    const html = "<ul><div><li>Punkt</li></div></ul>";
    expect(normalize(html)).toBe(form(html));
  });

  it("punkt z JEDNYM dzieckiem, które nie jest listą, NIE jest spłaszczany", () => {
    const html = "<ul><li><span>Punkt w spanie</span></li></ul>";
    expect(normalize(html)).toBe(form(html));
  });

  it("dwie niezależne skorupy obok siebie spłaszczają się każda osobno", () => {
    expect(
      normalize("<ul><li><ul><li>A</li></ul></li></ul><ul><li><ul><li>B</li></ul></li></ul>"),
    ).toBe(form("<ul><li>A</li></ul><ul><li>B</li></ul>"));
  });

  it("skorupa zagnieżdżona w kontenerze zostawia kontener na miejscu", () => {
    expect(normalize('<div class="wrap"><ul><li><ul><li>Treść</li></ul></li></ul></div>')).toBe(
      form('<div class="wrap"><ul><li>Treść</li></ul></div>'),
    );
  });
});

describe.each(ENGINES)("$name - rząd ikon social", ({ normalize, form }) => {
  it("lista z samymi linkami bez tekstu dostaje klasę cms-social-list", () => {
    expect(
      normalize(
        '<ul><li><a href="https://example.com/fb"></a></li><li><a href="https://example.com/x"></a></li></ul>',
      ),
    ).toBe(
      form(
        '<ul class="cms-social-list"><li><a href="https://example.com/fb"></a></li><li><a href="https://example.com/x"></a></li></ul>',
      ),
    );
  });

  it("istniejące klasy są ZACHOWANE, nasza jest dopisana", () => {
    expect(
      normalize('<ul class="wp-block-list"><li><a href="https://example.com/fb"></a></li></ul>'),
    ).toBe(
      form(
        '<ul class="wp-block-list cms-social-list"><li><a href="https://example.com/fb"></a></li></ul>',
      ),
    );
  });

  it("klasa nie jest dopisywana DRUGI raz", () => {
    const html = '<ul class="cms-social-list"><li><a href="https://example.com/fb"></a></li></ul>';
    expect(normalize(html)).toBe(form(html));
  });

  it("lista, w której CHOĆ JEDEN punkt ma tekst, NIE jest rzędem ikon", () => {
    const html = '<ul><li><a href="https://example.com/fb"></a></li><li>Tekst</li></ul>';
    expect(normalize(html)).toBe(form(html));
    expect(normalize(html)).not.toContain("cms-social-list");
  });

  it("lista z punktami bez tekstu, ale bez LINKÓW, NIE jest rzędem ikon", () => {
    // Sam obraz to galeria, nie rząd ikon - bullet zostaje, bo layout jest inny.
    const html = '<ul><li><img src="https://example.com/i.png"></li></ul>';
    expect(normalize(html)).toBe(form(html));
    expect(normalize(html)).not.toContain("cms-social-list");
  });

  it("kotwica bez href nie czyni z listy rzędu ikon", () => {
    // `a[href]` jest tu warunkiem koniecznym: kotwica-zakładka nie prowadzi
    // nigdzie, więc nie jest ikoną social.
    expect(normalize('<ul><li><a href="https://example.com/a"></a></li></ul>')).toContain(
      "cms-social-list",
    );
  });

  it("linki NIE są usuwane ani przepisywane - adres jest wartością", () => {
    const html = '<ul><li><a href="https://example.com/a?utm=1&amp;x=2" rel="me"></a></li></ul>';
    const out = normalize(html);
    expect(out).toContain('href="https://example.com/a?utm=1&amp;x=2"');
    expect(out).toContain('rel="me"');
  });
});

describe.each(ENGINES)("$name - wejście złośliwe", ({ normalize, form }) => {
  it("escapowany kod POZOSTAJE escapowany po spłaszczeniu skorupy", () => {
    // Najgroźniejsza możliwa regresja tego modułu: serializator, który
    // odkręca encje, zamieniłby PRZYKŁAD KODU w żywy znacznik jeszcze przed
    // sanityzacją - i sanitizeHtml zobaczyłby zupełnie inny dokument.
    expect(
      normalize("<ul><li><ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul></li></ul>"),
    ).toBe(form("<ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul>"));
  });

  it("NIE jest sanityzatorem - atrybuty zdarzeń i adresy javascript: przechodzą dalej", () => {
    // Świadomy podział odpowiedzialności: normalizacja tylko porządkuje
    // strukturę listy, a odsiewaniem zajmuje się sanitizeHtml WOŁANY PO NIEJ
    // (RichHtmlContent.tsx:39). Ten test pilnuje, żeby nikt nie uznał tej
    // funkcji za barierę bezpieczeństwa i nie wyciął sanityzacji za nią.
    const out = normalize(
      '<ul><li><ul><li onclick="alert(1)"><a href="javascript:alert(2)">x</a></li></ul></li></ul>',
    );
    expect(out).toContain('onclick="alert(1)"');
    expect(out).toContain('href="javascript:alert(2)"');
  });

  it("nie wywraca się na niedomkniętych i przestawionych znacznikach", () => {
    const broken = [
      "<ul><li>Bez domknięcia",
      "<li>Punkt bez listy</li>",
      "<ul><ul><li>Podwójna skorupa bez li</li></ul></ul>",
      "<ol><li><ul><li>Mieszane</li></ol></ul></li>",
      `<ul><li>${"<ul><li>".repeat(30)}Głęboko`,
    ];
    for (const html of broken) {
      expect(() => normalize(html), html).not.toThrow();
      expect(typeof normalize(html)).toBe("string");
    }
  });

  it("nie wywraca się na treści bez znaczników i na samych encjach", () => {
    expect(normalize("<ul><li>&amp;&lt;&gt;&quot;</li></ul>")).toBe(
      form("<ul><li>&amp;&lt;&gt;&quot;</li></ul>"),
    );
  });
});

describe.each(ENGINES)("$name - defekty", ({ normalize }) => {
  // DEFEKT: PUNKT Z IKONĄ INLINE SVG JEST KASOWANY RAZEM Z CAŁĄ LISTĄ.
  //
  // WEJSCIE: rząd ikon zapisany jako inline SVG - czyli dokładnie to, co
  //   generują eksporty z Elementora („icon list”), wtyczki social i nasza
  //   własna biblioteka ikon: `<ul><li><svg …/></li></ul>`. Punkt nie ma
  //   tekstu, bo cała jego treść to grafika.
  // CO PSUJE: krok 1 (src/lib/builder/normalizeRichHtml.ts:50-57, w bliźniaku
  //   DOM to samo) uznaje punkt za pusty po tekście, a wspólna lista nośników
  //   `LIST_ITEM_KEEPERS` (normalizeRichHtmlRules.ts) wymienia tylko „a[href],
  //   ul, ol, img, iframe, video, audio, button”. `svg` (a także `object`,
  //   `embed`, `canvas`, `input`) NIE jest
  //   na tej liście, więc `hasKeeper` jest fałszywe i punkt leci przez
  //   `item.remove()`. Krok 2 (:60-66) widzi listę bez punktów i usuwa
  //   również ją.
  // KONSEKWENCJA: cały rząd ikon znika z treści - i to BEZTERMINOWO, bo
  //   znormalizowany HTML jest tym, co zapisuje się do dokumentu i co jedzie
  //   do sanityzacji. Nie ma komunikatu, nie ma pustej ramki, nie ma czego
  //   cofnąć: redakcja widzi po prostu, że sekcja z ikonami zniknęła. To ta
  //   sama klasa co „odmowa odczytu udaje pustkę”, tylko źródłem pustki jest
  //   NASZ krok porządkujący, nie baza. Komentarz przy strażniku obiecuje
  //   wprost, że punkty „carry a link or media” są zachowywane - kod tej
  //   obietnicy nie dowozi.
  // WYMAGANA POPRAWKA: dopisać do selektora `hasKeeper` elementy graficzne
  //   i osadzone, których treść nie jest tekstem - co najmniej `svg`,
  //   `picture`, `object`, `embed`, `canvas`, `input` - albo odwrócić regułę:
  //   usuwać punkt tylko wtedy, gdy po odjęciu białych znaków, `<br>`
  //   i komentarzy nie zostaje W NIM ŻADEN element.
  it.fails("DEFEKT: rząd ikon inline SVG MUSI przetrwać normalizację", () => {
    const html =
      '<ul><li><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"></path></svg></li>' +
      '<li><svg viewBox="0 0 24 24"><path d="M2 2h20v20H2z"></path></svg></li></ul>';
    const out = normalize(html);
    expect(out).not.toBe("");
    expect(out).toContain("<svg");
    expect(out.match(/<li>/g)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARYTET SILNIKÓW. Wyżej każdy przypadek sprawdza oba silniki osobno; tu
// porównujemy je ze sobą na korpusie, którego nikt nie pisał ręcznie. Kanonem
// jest drzewo, które przeglądarka zbuduje z wyniku (`browserForm`), bo to ono
// trafia na stronę - bajty różnią się z powodów opisanych na górze pliku.
//
// Korpus jest ZGODNY z HTML5 (żadnej listy w `<p>`, żadnego `<a>` w `<a>`,
// wszystko domknięte) - tak wygląda HTML zapisany przez edytory buildera,
// który zawsze jest serializacją DOM-u. Na wejściu niepoprawnym parsery
// naprawiają drzewo różnie; te różnice są spisane w ostatnim teście.
// ─────────────────────────────────────────────────────────────────────────────

/** Losowy, ale powtarzalny dokument z listami: LCG ze stałym ziarnem. */
function conformingCorpus(count: number): string[] {
  let seed = 20261017;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const texts = [
    "",
    " ",
    "&nbsp;",
    "&#160;",
    "Treść",
    "a&amp;b",
    "&lt;b&gt;",
    "&quot;q&quot;",
    "\n",
  ];
  const leaves = [
    "<br>",
    "<!-- c -->",
    '<img src="https://example.com/i.png" alt="">',
    '<iframe src="https://example.com/e"></iframe>',
    "<button>B</button>",
    '<i class="fab fa-x"></i>',
  ];
  const attrs = ["", ' class="wp-block-list"', " class='x y'", ' data-x=""', ' title="t&quot;q"'];
  const flow = (depth: number, inAnchor: boolean): string => {
    const roll = next();
    if (depth > 5 || roll < 0.25) return pick(texts);
    if (roll < 0.35) return pick(leaves);
    if (roll < 0.6) return list(depth, inAnchor);
    const anchor = inAnchor ? "span" : pick(['a href="https://example.com/p?a=1&amp;b=2"', "a"]);
    const tag = pick(["strong", "em", "span", "div", "blockquote", anchor]);
    const name = tag.split(" ")[0];
    const children = Array.from({ length: 1 + Math.floor(next() * 3) }, () =>
      flow(depth + 1, inAnchor || name === "a"),
    );
    return `<${tag}>${children.join("")}</${name}>`;
  };
  const list = (depth: number, inAnchor: boolean): string => {
    const tag = pick(["ul", "ol", "UL"]);
    const items = Array.from({ length: Math.floor(next() * 4) }, () => {
      const li = pick(["li", "li", "LI"]);
      const body = Array.from({ length: Math.floor(next() * 3) }, () => flow(depth + 1, inAnchor));
      return `${next() < 0.1 ? pick([" ", "\n", "<!-- c -->"]) : ""}<${li}${next() < 0.15 ? pick(attrs) : ""}>${body.join("")}</${li}>`;
    });
    return `<${tag}${next() < 0.3 ? pick(attrs) : ""}>${items.join("")}</${tag}>`;
  };
  return Array.from({ length: count }, () => {
    const prose = next() < 0.3 ? `<p>${pick(texts)}<strong>Akapit</strong></p>` : "";
    return `${prose}${list(0, false)}${next() < 0.5 ? flow(1, false) : ""}`;
  });
}

describe("normalizeBuilderRichHtml - parytet serwera i przeglądarki", () => {
  const sameTree = (input: string) =>
    expect(browserForm(normalizeBuilderRichHtmlDom(input)), input).toBe(
      browserForm(normalizeBuilderRichHtml(input)),
    );

  it("importy z życia: Gutenberg, Elementor, wklejka z Worda, wcięty HTML", () => {
    [
      '<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>Pierwszy&nbsp;punkt z <strong>pogrubieniem</strong></li><!-- /wp:list-item --><!-- wp:list-item --><li></li><!-- /wp:list-item --></ul><!-- /wp:list -->',
      '<ul class="elementor-icon-list-items"><li class="elementor-icon-list-item"><a href="https://facebook.com/x"><span class="elementor-icon-list-icon"><i aria-hidden="true" class="fab fa-facebook-f"></i></span><span class="elementor-icon-list-text"></span></a></li><li class="elementor-icon-list-item"><a href="https://x.com/y"><i class="fab fa-x-twitter"></i></a></li></ul>',
      '<p class="MsoNormal">Wklejka<o:p></o:p></p><ul type="disc"><li class="MsoNormal" style="mso-list:l0 level1 lfo1">Word&nbsp;item<o:p></o:p></li><li class="MsoNormal"><o:p>&nbsp;</o:p></li></ul>',
      "<h2>Nagłówek</h2><ol><li><p>Punkt w akapicie</p></li><li><p><br></p></li></ol><p>Koniec</p>",
      '<div><ul><li><ul><li><a href="https://linkedin.com/in/z"><img src="https://example.com/li.svg" alt="LinkedIn"></a></li></ul></li></ul></div>',
      "<ul>\n  <li>Wcięty\n  </li>\n  <li>\n    <ul>\n      <li>Zagnieżdżony</li>\n    </ul>\n  </li>\n</ul>",
    ].forEach(sameTree);
  });

  it("500 losowych dokumentów zgodnych z HTML5 daje to samo drzewo", () => {
    conformingCorpus(500).forEach(sameTree);
  });

  it("różnice bajtowe są wyłącznie zapisem tego samego dokumentu", () => {
    const input = "<UL><LI><UL class='x'><LI>&#160;&quot;a&quot; &eacute;</LI></UL></LI></UL>";
    expect(normalizeBuilderRichHtml(input)).toBe(
      "<UL class='x'><LI>&#160;&quot;a&quot; &eacute;</LI></UL>",
    );
    expect(normalizeBuilderRichHtmlDom(input)).toBe('<ul class="x"><li>&nbsp;"a" é</li></ul>');
  });

  it("ZNANE RÓŻNICE na wejściu niepoprawnym: parsery naprawiają je inaczej", () => {
    // (1) Niedomknięta lista: node-html-parser rozpakowuje niedomknięte `<li>`
    //     (tekst zostaje luzem w `<ul>`), a krok 2 usuwa listę bez punktów
    //     razem z tym tekstem - serwer GUBI treść (defekt sprzed bliźniaka DOM).
    //     Przeglądarka domyka znaczniki wg HTML5 i punkt zostaje.
    expect(normalizeBuilderRichHtml("<ul><li>Bez domknięcia")).toBe("");
    expect(normalizeBuilderRichHtmlDom("<ul><li>Bez domknięcia")).toBe(
      "<ul><li>Bez domknięcia</li></ul>",
    );
    // (2) Lista w `<p>`: HTML5 zamyka akapit przed `<ul>`, node-html-parser
    //     nie. Gdy normalizacja usunie taką listę, tekst za nią zostaje na
    //     serwerze w akapicie, a w przeglądarce poza nim. Pierwsze wejście
    //     i tak pokazuje wersję serwera (React nie łata `innerHTML` przy
    //     hydratacji) - różnicę widać przy nawigacji po kliencie
    //     (szczegóły w `RichHtmlListView.tsx`, test w `richHtmlLoading.test.tsx`).
    const inParagraph = "<p><ul><li>&nbsp;</li></ul>Treść</p>";
    expect(browserForm(normalizeBuilderRichHtml(inParagraph))).toContain("<p>Treść</p>");
    expect(browserForm(normalizeBuilderRichHtmlDom(inParagraph))).not.toContain("<p>Treść</p>");
    // (3) Lista w `<pre>`: node-html-parser czyta zawartość `<pre>` jako surowy
    //     tekst (blockTextElements), więc jej nie normalizuje; DOM widzi listę.
    const inPre = "<pre><ul><li>&nbsp;</li><li>Kod</li></ul></pre>";
    expect(normalizeBuilderRichHtml(inPre)).toBe(inPre);
    expect(normalizeBuilderRichHtmlDom(inPre)).toBe("<pre><ul><li>Kod</li></ul></pre>");
  });
});
