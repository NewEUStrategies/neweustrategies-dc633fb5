import { describe, expect, it } from "vitest";
import { cleanExcerpt } from "@/lib/text/cleanExcerpt";
import { excerptToLead } from "@/lib/text/excerptToLead";

// Zajawki automatyczne WordPressa z produkcji (excerpt_pl / excerpt_en, zrzut
// docs/performance/2026-10-03-pagespeed-85-95/faza1/html-weight/barrier.json):
// pierwsze ~55 słów treści urwane znacznikiem `[&hellip;]`. Początek treści -
// z wpisu /blog/droga-obalenia-hegemonii-funta-i-ustanowienie-imperium-dolara
// (pomiar 24.10.2026).
const WP_AUTO_EXCERPT =
  "Pierwsza wojna światowa zakończyła niepodzielnie panowanie brytyjskiego funta (GBP), a wraz " +
  "z nią zachwiane zostały struktury parytetu złota. Stany Zjednoczone na potrzeby prowadzenia " +
  "działań wojennych pożyczyły Wielkiej Brytanii 5 mld USD (całkowite wojenne zadłużenie – 43 mld " +
  "USD, w przeliczeniu na aktualne wartości) oraz Francji 4 mld USD (30 mld USD). Niemcy natomiast " +
  "były zadłużone [&hellip;]";

const WP_AUTO_EXCERPT_EN =
  "World War I ended the undivided reign of the British pound (GBP), and with it, the structures " +
  "of the gold standard were shaken. The United States lent Great Britain $5 billion (total war " +
  "debt – $43 billion in current values) and France $4 billion ($30 billion) to finance its war " +
  "efforts. Germany, on the other hand, was indebted [&hellip;]";

const BODY_START =
  "Pierwsza wojna światowa zakończyła niepodzielnie panowanie brytyjskiego funta (GBP), a wraz " +
  "z nią zachwiane zostały struktury parytetu złota. Stany Zjednoczone na potrzeby prowadzenia " +
  "działań wojennych pożyczyły Wielkiej Brytanii 5 mld USD (całkowite wojenne zadłużenie – 43 mld " +
  "USD, w przeliczeniu na aktualne wartości) oraz Francji 4 mld USD (30 mld USD). Niemcy natomiast " +
  "były zadłużone na 47 mld USD. Kraje europejskie łącznie posiadały zadłużenie sięgające 200 mld USD.";

describe("excerptToLead - zajawka urwana znacznikiem WordPressa", () => {
  it("kończy lead na ostatnim pełnym zdaniu („(30 mld USD).”)", () => {
    const lead = excerptToLead(WP_AUTO_EXCERPT);
    expect(lead.truncated).toBe(true);
    expect(lead.text?.endsWith("oraz Francji 4 mld USD (30 mld USD).")).toBe(true);
    expect(lead.text).not.toContain("Niemcy natomiast");
    expect(excerptToLead(WP_AUTO_EXCERPT_EN).text?.endsWith("to finance its war efforts.")).toBe(
      true,
    );
    // Dotychczasowy `cleanExcerpt` zostawiał urwane zdanie - to jest regresja,
    // którą naprawia pomocnik.
    expect(cleanExcerpt(WP_AUTO_EXCERPT)?.endsWith("były zadłużone")).toBe(true);
  });

  it.each([
    ["[…]", "Pierwsze zdanie jest pełne. Drugie zdanie jest pełne. Trzecie urwane […]"],
    ["[...]", "Pierwsze zdanie jest pełne. Drugie zdanie jest pełne. Trzecie urwane [...]"],
    ["&#8230;", "Pierwsze zdanie jest pełne. Drugie zdanie jest pełne. Trzecie urwane &#8230;"],
    ["…", "Pierwsze zdanie jest pełne. Drugie zdanie jest pełne. Trzecie urwane…"],
  ])("rozpoznaje znacznik %s", (_marker, raw) => {
    const lead = excerptToLead(raw);
    expect(lead.truncated).toBe(true);
    expect(lead.text).toBe("Pierwsze zdanie jest pełne. Drugie zdanie jest pełne.");
  });

  it("uznaje koniec zdania przed zamykającym cudzysłowem i nawiasem", () => {
    expect(
      excerptToLead("Minister powiedział: „To koniec epoki funta.” Następnie dodał, że [&hellip;]")
        .text,
    ).toBe("Minister powiedział: „To koniec epoki funta.”");
    expect(
      excerptToLead(
        "Tekst wstępu z dłuższym opisem kontekstu (z przypisem.) Dalej urwane [&hellip;]",
      ).text,
    ).toBe("Tekst wstępu z dłuższym opisem kontekstu (z przypisem.)");
  });

  it("nie tnie po skrótach i inicjałach („np.”, „r.”, „J.”)", () => {
    const raw =
      "W 1925 r. Wielka Brytania wróciła do złota, np. za sprawą Churchilla, a J. M. Keynes " +
      "ostrzegał przed skutkami. Decyzja okazała się kosztowna dla eksportu i [&hellip;]";
    expect(excerptToLead(raw).text).toBe(
      "W 1925 r. Wielka Brytania wróciła do złota, np. za sprawą Churchilla, a J. M. Keynes " +
        "ostrzegał przed skutkami.",
    );
  });

  it("pozostałe zajawki z produkcji kończą się pełnym zdaniem", () => {
    const books =
      "Książka Bartłomieja Radziejewskiego, założyciela think-zine Nowa Konfederacja, wzbudziła we " +
      "mnie wielki entuzjazm. Autor prawidłowo wskazuje obszary do krytycznej analizy stanu Polski " +
      "w systemie międzynarodowym, jak i samej kondycji ładu gospodarczego, społecznego, " +
      "instytucjonalno-politycznego w Polsce. Struktura książki jest złożona z artykułów " +
      "analitycznych w sposób chronologiczny, co pokazuje, że autor od dawna zastanawiał się nad " +
      "przyszłością Polski [&hellip;]";
    expect(excerptToLead(books).text?.endsWith("instytucjonalno-politycznego w Polsce.")).toBe(
      true,
    );
    const ussr =
      "Związek Radziecki będąc w pozycji defensywnej postanowił po raz pierwszy kontratakować na " +
      "terytorium „neutralnym”. Było to spowodowane przede wszystkim posiadaniem przez Związek " +
      "Radziecki broni jądrowej oraz rozpoczętym prosperity w bloku Układu Warszawskiego. Gospodarka " +
      "sowiecka nie była na tyle silna aby oddziaływać w sposób subtelny (ekonomicznie) i pozostał " +
      "Związkowi Radzieckiemu jedyne skuteczne narzędzie, które jest postrzegane [&hellip;]";
    expect(excerptToLead(ussr).text?.endsWith("w bloku Układu Warszawskiego.")).toBe(true);
  });

  it("brak końca zdania w 120 znakach daje „…” na granicy słowa", () => {
    const raw =
      "Bez kropki ciągnie się długi wstęp o walutach rezerwowych, o roli złota i o długach " +
      "wojennych aliantów, [&hellip;]";
    const lead = excerptToLead(raw);
    expect(lead.truncated).toBe(true);
    expect(lead.text).toBe(
      "Bez kropki ciągnie się długi wstęp o walutach rezerwowych, o roli złota i o długach " +
        "wojennych aliantów…",
    );
  });

  it("za krótkie pełne zdanie (< 60% i < 120 znaków) nie wygrywa z granicą słowa", () => {
    const raw =
      "Krótko. Potem bardzo długi fragment bez kropki o dolarze, funcie, złocie i rezerwach [&hellip;]";
    expect(excerptToLead(raw).text).toBe(
      "Krótko. Potem bardzo długi fragment bez kropki o dolarze, funcie, złocie i rezerwach…",
    );
  });

  it("zajawka będąca samym znacznikiem daje pusty lead", () => {
    expect(excerptToLead("[&hellip;]")).toEqual({
      text: undefined,
      truncated: false,
      duplicatesBody: false,
    });
    expect(excerptToLead(null).text).toBeUndefined();
  });
});

describe("excerptToLead - ręczna zajawka", () => {
  it("wychodzi bez zmian (jak z `cleanExcerpt`)", () => {
    const manual = "Jak Stany Zjednoczone przejęły rolę finansowego hegemona po Wielkiej Brytanii.";
    const lead = excerptToLead(manual, BODY_START);
    expect(lead).toEqual({ text: manual, truncated: false, duplicatesBody: false });
    expect(excerptToLead("Kowalski &amp; Sp. - &bdquo;analiza&rdquo;").text).toBe(
      cleanExcerpt("Kowalski &amp; Sp. - &bdquo;analiza&rdquo;"),
    );
  });
});

describe("excerptToLead - duplikat początku treści", () => {
  it("prawda dla zajawki automatycznej, która jest początkiem treści", () => {
    expect(excerptToLead(WP_AUTO_EXCERPT, BODY_START).duplicatesBody).toBe(true);
  });

  it("normalizuje encje, cudzysłowy i odstępy", () => {
    const raw =
      "Rząd ogłosił &bdquo;nowy porządek&rdquo; w&nbsp;finansach. Bank centralny poparł ten krok [&hellip;]";
    const body =
      'Rząd ogłosił "nowy porządek" w finansach.Bank centralny poparł ten krok, a rynki zareagowały spadkami.';
    expect(excerptToLead(raw, body).duplicatesBody).toBe(true);
  });

  it("fałsz dla zajawki ręcznej i dla treści zaczynającej się inaczej", () => {
    expect(
      excerptToLead("Analiza drogi dolara do pozycji waluty światowej.", BODY_START).duplicatesBody,
    ).toBe(false);
    expect(excerptToLead(WP_AUTO_EXCERPT, "Zupełnie inny początek treści.").duplicatesBody).toBe(
      false,
    );
    expect(excerptToLead(WP_AUTO_EXCERPT).duplicatesBody).toBe(false);
  });

  it("zbyt krótki lead nie jest uznawany za kopię treści", () => {
    expect(
      excerptToLead("Wstęp", "Wstęp do analizy finansowej i dalszy tekst.").duplicatesBody,
    ).toBe(false);
  });
});
