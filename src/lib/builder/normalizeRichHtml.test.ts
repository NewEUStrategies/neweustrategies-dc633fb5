import { describe, expect, it } from "vitest";
import { normalizeBuilderRichHtml } from "./normalizeRichHtml";

describe("normalizeBuilderRichHtml", () => {
  it("removes repeated empty list shells from imported Elementor HTML", () => {
    const html = "<ul><li><ul><li><ul><li>Treść</li><li>Drugi punkt</li></ul></li></ul></li></ul>";
    expect(normalizeBuilderRichHtml(html)).toBe("<ul><li>Treść</li><li>Drugi punkt</li></ul>");
  });

  it("preserves a genuine nested list", () => {
    const html = "<ul><li>Parent<ul><li>Child</li></ul></li><li>Sibling</li></ul>";
    expect(normalizeBuilderRichHtml(html)).toBe(html);
  });

  it("normalizes PL and EN markup without changing text", () => {
    const pl = "<ul><li><ul><li>Punkt PL</li></ul></li></ul>";
    const en = "<ul><li><ul><li>English item</li></ul></li></ul>";
    expect(normalizeBuilderRichHtml(pl)).toBe("<ul><li>Punkt PL</li></ul>");
    expect(normalizeBuilderRichHtml(en)).toBe("<ul><li>English item</li></ul>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Poniżej: gałęzie ODMOWY i przypadki brzegowe.
//
// Ten moduł stoi PRZED sanityzacją (RichHtmlView.tsx:39 - najpierw
// `normalizeBuilderRichHtml`, potem `sanitizeHtml`), więc na wejściu dostaje
// HTML NIEZAUFANY: import z WordPressa/Elementora, wklejka ze schowka, ręcznie
// wpisany kod. Dwie rzeczy muszą tu być dowiedzione:
//  1) nic się nie wywraca i nic sensownego nie ginie (usuwamy TYLKO puste
//     skorupy, nigdy treści ani adresu linku),
//  2) normalizacja nie ODKRĘCA escapowania - inaczej ładunek zapisany jako
//     tekst wychodziłby z niej jako znaczniki.
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeBuilderRichHtml - wejście bez listy", () => {
  it("HTML bez ul/ol wraca BAJTOWO nietknięty (bez przejścia przez parser)", () => {
    // Skrót po `test(/<(?:ul|ol)\b/)` jest tu istotny nie tylko dla wydajności:
    // pominięcie parsera gwarantuje, że akapit z niestandardowym formatowaniem
    // nie zostanie przepisany przez serializator.
    const html =
      '<p class="x">Akapit <b>pogrubiony</b> i <a href="https://example.com/a">link</a></p>';
    expect(normalizeBuilderRichHtml(html)).toBe(html);
  });

  it("pusty łańcuch wraca pusty", () => {
    expect(normalizeBuilderRichHtml("")).toBe("");
  });

  it("słowo „ul” w treści nie uruchamia normalizacji", () => {
    // Granica słowa w regexie: „ultra” i „ulica” to nie znaczniki listy.
    expect(normalizeBuilderRichHtml("<p>ultra, ulica, ul. Marszałkowska</p>")).toBe(
      "<p>ultra, ulica, ul. Marszałkowska</p>",
    );
  });
});

describe("normalizeBuilderRichHtml - puste elementy listy", () => {
  it("usuwa punkt z samym &nbsp;, zostawiając punkty z treścią", () => {
    expect(normalizeBuilderRichHtml("<ul><li>&nbsp;</li><li>Treść</li></ul>")).toBe(
      "<ul><li>Treść</li></ul>",
    );
  });

  it("usuwa punkt z samym <br> (przypadkowy Enter w edytorze)", () => {
    expect(normalizeBuilderRichHtml("<ul><li><br></li><li>Treść</li></ul>")).toBe(
      "<ul><li>Treść</li></ul>",
    );
  });

  it("usuwa punkt z samymi białymi znakami", () => {
    expect(normalizeBuilderRichHtml("<ul><li>   </li><li>Treść</li></ul>")).toBe(
      "<ul><li>Treść</li></ul>",
    );
  });

  it("usuwa WIELE pustych punktów w jednym przebiegu", () => {
    const html = `<ul>${"<li>&nbsp;</li>".repeat(12)}<li>Ostatni</li></ul>`;
    expect(normalizeBuilderRichHtml(html)).toBe("<ul><li>Ostatni</li></ul>");
  });

  it("lista, która straciła WSZYSTKIE punkty, znika razem z nimi", () => {
    // Sama skorupa <ul> bez punktów rysuje pusty margines - to widoczny
    // artefakt importu, nie treść.
    expect(normalizeBuilderRichHtml("<ul><li>&nbsp;</li></ul><p>Po liście</p>")).toBe(
      "<p>Po liście</p>",
    );
  });

  it("lista bez ŻADNEGO punktu na wejściu też znika", () => {
    expect(normalizeBuilderRichHtml("<ul></ul>")).toBe("");
    expect(normalizeBuilderRichHtml("<ul><li><ul></ul></li></ul>")).toBe("");
  });

  it("komentarz HTML nie jest treścią - punkt z samym komentarzem to punkt pusty", () => {
    expect(normalizeBuilderRichHtml("<ul><li><!-- pusto --></li><li>Treść</li></ul>")).toBe(
      "<ul><li>Treść</li></ul>",
    );
  });
});

describe("normalizeBuilderRichHtml - punkty bez tekstu, które MUSZĄ zostać", () => {
  it("punkt z linkiem zostaje - adres jest wartością, nie ozdobą", () => {
    const html = '<ul><li><a href="https://example.com/profil"></a></li></ul>';
    expect(normalizeBuilderRichHtml(html)).toContain('href="https://example.com/profil"');
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
      expect(normalizeBuilderRichHtml(html), `zgubiony nośnik: ${keeper}`).toContain(keeper);
    }
  });

  it("punkt z zagnieżdżoną listą zostaje, nawet gdy sam nie ma tekstu", () => {
    // Bez tego wyjątku krok 1 zjadałby rodzica ZANIM krok 3 zdąży spłaszczyć
    // skorupę - i cała zagnieżdżona lista poleciałaby razem z nim.
    expect(normalizeBuilderRichHtml("<ul><li><ul><li>Realny punkt</li></ul></li></ul>")).toBe(
      "<ul><li>Realny punkt</li></ul>",
    );
  });
});

describe("normalizeBuilderRichHtml - spłaszczanie skorup", () => {
  it("skorupa o dowolnej głębokości spłaszcza się do JEDNEJ listy", () => {
    const build = (depth: number) => {
      let html = "<ul><li>Treść</li></ul>";
      for (let i = 0; i < depth; i += 1) html = `<ul><li>${html}</li></ul>`;
      return html;
    };
    for (const depth of [1, 3, 8, 25]) {
      expect(normalizeBuilderRichHtml(build(depth)), `głębokość ${depth}`).toBe(
        "<ul><li>Treść</li></ul>",
      );
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
      const once = normalizeBuilderRichHtml(input);
      expect(normalizeBuilderRichHtml(once), `niestabilne dla ${input}`).toBe(once);
    }
  });

  it("skorupa <ol> spłaszcza się tak samo jak <ul>", () => {
    expect(normalizeBuilderRichHtml("<ol><li><ol><li>Jeden</li></ol></li></ol>")).toBe(
      "<ol><li>Jeden</li></ol>",
    );
  });

  it("znaczniki WIELKIMI literami są rozpoznawane", () => {
    // Importy z WordPressa i starsze wklejki z Worda niosą <UL><LI>.
    expect(normalizeBuilderRichHtml("<UL><LI><UL><LI>Wielkie</LI></UL></LI></UL>")).toBe(
      "<UL><LI>Wielkie</LI></UL>",
    );
  });

  it("lista zagnieżdżona w innym elemencie niż <li> NIE jest spłaszczana", () => {
    // Jedyne dziecko <ul> nie jest punktem listy, więc to nie jest skorupa,
    // której szukamy - dotknięcie tego kształtu gubiłoby <div>.
    const html = "<ul><div><li>Punkt</li></div></ul>";
    expect(normalizeBuilderRichHtml(html)).toBe(html);
  });

  it("punkt z JEDNYM dzieckiem, które nie jest listą, NIE jest spłaszczany", () => {
    const html = "<ul><li><span>Punkt w spanie</span></li></ul>";
    expect(normalizeBuilderRichHtml(html)).toBe(html);
  });

  it("dwie niezależne skorupy obok siebie spłaszczają się każda osobno", () => {
    expect(
      normalizeBuilderRichHtml(
        "<ul><li><ul><li>A</li></ul></li></ul><ul><li><ul><li>B</li></ul></li></ul>",
      ),
    ).toBe("<ul><li>A</li></ul><ul><li>B</li></ul>");
  });

  it("skorupa zagnieżdżona w kontenerze zostawia kontener na miejscu", () => {
    expect(
      normalizeBuilderRichHtml('<div class="wrap"><ul><li><ul><li>Treść</li></ul></li></ul></div>'),
    ).toBe('<div class="wrap"><ul><li>Treść</li></ul></div>');
  });
});

describe("normalizeBuilderRichHtml - rząd ikon social", () => {
  it("lista z samymi linkami bez tekstu dostaje klasę cms-social-list", () => {
    expect(
      normalizeBuilderRichHtml(
        '<ul><li><a href="https://example.com/fb"></a></li><li><a href="https://example.com/x"></a></li></ul>',
      ),
    ).toBe(
      '<ul class="cms-social-list"><li><a href="https://example.com/fb"></a></li><li><a href="https://example.com/x"></a></li></ul>',
    );
  });

  it("istniejące klasy są ZACHOWANE, nasza jest dopisana", () => {
    expect(
      normalizeBuilderRichHtml(
        '<ul class="wp-block-list"><li><a href="https://example.com/fb"></a></li></ul>',
      ),
    ).toBe(
      '<ul class="wp-block-list cms-social-list"><li><a href="https://example.com/fb"></a></li></ul>',
    );
  });

  it("klasa nie jest dopisywana DRUGI raz", () => {
    const html = '<ul class="cms-social-list"><li><a href="https://example.com/fb"></a></li></ul>';
    expect(normalizeBuilderRichHtml(html)).toBe(html);
  });

  it("lista, w której CHOĆ JEDEN punkt ma tekst, NIE jest rzędem ikon", () => {
    const html = '<ul><li><a href="https://example.com/fb"></a></li><li>Tekst</li></ul>';
    expect(normalizeBuilderRichHtml(html)).toBe(html);
    expect(normalizeBuilderRichHtml(html)).not.toContain("cms-social-list");
  });

  it("lista z punktami bez tekstu, ale bez LINKÓW, NIE jest rzędem ikon", () => {
    // Sam obraz to galeria, nie rząd ikon - bullet zostaje, bo layout jest inny.
    const html = '<ul><li><img src="https://example.com/i.png"></li></ul>';
    expect(normalizeBuilderRichHtml(html)).toBe(html);
    expect(normalizeBuilderRichHtml(html)).not.toContain("cms-social-list");
  });

  it("kotwica bez href nie czyni z listy rzędu ikon", () => {
    // `a[href]` jest tu warunkiem koniecznym: kotwica-zakładka nie prowadzi
    // nigdzie, więc nie jest ikoną social.
    expect(
      normalizeBuilderRichHtml('<ul><li><a href="https://example.com/a"></a></li></ul>'),
    ).toContain("cms-social-list");
  });

  it("linki NIE są usuwane ani przepisywane - adres jest wartością", () => {
    const html = '<ul><li><a href="https://example.com/a?utm=1&amp;x=2" rel="me"></a></li></ul>';
    const out = normalizeBuilderRichHtml(html);
    expect(out).toContain('href="https://example.com/a?utm=1&amp;x=2"');
    expect(out).toContain('rel="me"');
  });
});

describe("normalizeBuilderRichHtml - wejście złośliwe", () => {
  it("escapowany kod POZOSTAJE escapowany po spłaszczeniu skorupy", () => {
    // Najgroźniejsza możliwa regresja tego modułu: serializator, który
    // odkręca encje, zamieniłby PRZYKŁAD KODU w żywy znacznik jeszcze przed
    // sanityzacją - i sanitizeHtml zobaczyłby zupełnie inny dokument.
    expect(
      normalizeBuilderRichHtml(
        "<ul><li><ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul></li></ul>",
      ),
    ).toBe("<ul><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul>");
  });

  it("NIE jest sanityzatorem - atrybuty zdarzeń i adresy javascript: przechodzą dalej", () => {
    // Świadomy podział odpowiedzialności: normalizacja tylko porządkuje
    // strukturę listy, a odsiewaniem zajmuje się sanitizeHtml WOŁANY PO NIEJ
    // (RichHtmlView.tsx:39-40). Ten test pilnuje, żeby nikt nie uznał tej
    // funkcji za barierę bezpieczeństwa i nie wyciął sanityzacji za nią.
    const out = normalizeBuilderRichHtml(
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
      expect(() => normalizeBuilderRichHtml(html), html).not.toThrow();
      expect(typeof normalizeBuilderRichHtml(html)).toBe("string");
    }
  });

  it("nie wywraca się na treści bez znaczników i na samych encjach", () => {
    expect(normalizeBuilderRichHtml("<ul><li>&amp;&lt;&gt;&quot;</li></ul>")).toBe(
      "<ul><li>&amp;&lt;&gt;&quot;</li></ul>",
    );
  });
});

describe("normalizeBuilderRichHtml - defekty", () => {
  // DEFEKT: PUNKT Z IKONĄ INLINE SVG JEST KASOWANY RAZEM Z CAŁĄ LISTĄ.
  //
  // WEJSCIE: rząd ikon zapisany jako inline SVG - czyli dokładnie to, co
  //   generują eksporty z Elementora („icon list”), wtyczki social i nasza
  //   własna biblioteka ikon: `<ul><li><svg …/></li></ul>`. Punkt nie ma
  //   tekstu, bo cała jego treść to grafika.
  // CO PSUJE: krok 1 (src/lib/builder/normalizeRichHtml.ts:40-46) uznaje
  //   punkt za pusty po `item.text`, a lista nośników w strażniku `hasKeeper`
  //   (:43) wymienia tylko „a[href], ul, ol, img, iframe, video, audio,
  //   button”. `svg` (a także `object`, `embed`, `canvas`, `input`) NIE jest
  //   na tej liście, więc `hasKeeper` jest fałszywe i punkt leci przez
  //   `item.remove()`. Krok 2 (:50-55) widzi listę bez punktów i usuwa
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
    const out = normalizeBuilderRichHtml(html);
    expect(out).not.toBe("");
    expect(out).toContain("<svg");
    expect(out.match(/<li>/g)).toHaveLength(2);
  });
});
