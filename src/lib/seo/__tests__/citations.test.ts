// CO DOWODZI TEN PLIK: `citationMetaTags` produkuje dokładnie ten zestaw tagów
// Highwire Press (citation_*), którego Google Scholar wymaga do zaindeksowania
// analizy jako pozycji bibliograficznej. Stawka jest asymetryczna:
//   1. Tag z PUSTYM `content` (np. autor bez żadnego z trzech pól) to dla
//      Scholara rekord z pustym polem autora - wpis wypada z indeksu cicho,
//      bez żadnego sygnału w panelu.
//   2. Data w złym formacie albo z LOKALNYCH pól zamiast UTC przesuwa
//      `citation_publication_date` o dzień na runnerze w innej strefie - i to
//      ta data trafia do cytowań w pracach naukowych.
//   3. Zniknięcie gałęzi `if (input.url)` daje tag `citation_public_url` z
//      pustym adresem, czyli martwy odsyłacz w menedżerach bibliografii.
// Dlatego każde ramię (autorzy / data / url / język) jest tu sprawdzane
// osobno, a nie tylko na jednym "pełnym" wejściu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: nie renderuje <head> ani nie sprawdza, czy
// trasa `$.tsx` faktycznie te tagi emituje. Obecność meta na żywym SSR pilnuje
// e2e - test `head contract on ${path}` w `e2e/seo.spec.ts` (pętla po "/",
// "/en", "/blog", "/qa"). Nie dubluje też formatowania cytowań dla czytelnika
// (`src/lib/citations/format.ts` - Chicago/APA/BibTeX ma własne testy), bo ten
// moduł buduje WYŁĄCZNIE meta do <head>.
import { describe, expect, it } from "vitest";

import type { CitationAuthor } from "@/lib/citations/format";
import { citationMetaTags, type CitationMetaInput } from "@/lib/seo/citations";

/** Autor z pełną kontrolą nad trzema polami - typ nie ma pól opcjonalnych. */
function author(partial: Partial<CitationAuthor>): CitationAuthor {
  return {
    firstName: partial.firstName ?? null,
    lastName: partial.lastName ?? null,
    displayName: partial.displayName ?? null,
  };
}

const BASE: CitationMetaInput = {
  title: "Rozszerzenie UE 2030",
  authors: [],
  publishedAt: "2026-02-03T10:15:00Z",
  siteName: "New European Strategies",
  language: "pl",
  url: "https://neweuropeanstrategies.com/blog/rozszerzenie-ue-2030",
};

function tags(overrides: Partial<CitationMetaInput> = {}) {
  return citationMetaTags({ ...BASE, ...overrides });
}

/** Wartości jednego rodzaju tagu w kolejności emisji. */
function contents(meta: Array<Record<string, string>>, name: string): string[] {
  return meta.filter((m) => m.name === name).map((m) => m.content);
}

describe("citationMetaTags - źródło pełne", () => {
  it("emituje pełny zestaw tagów w kolejności produkowanej przez kod", () => {
    const meta = tags({
      authors: [
        author({ firstName: "Anna", lastName: "Kowalska" }),
        author({ firstName: "Jan", lastName: "Nowak" }),
      ],
    });
    // Kolejność jest częścią kontraktu: tytuł, autorzy, obie daty, wydawnictwo,
    // język, oba adresy. Scholar czyta tagi po kolei i pierwszy citation_title
    // wiąże z następującymi po nim autorami.
    expect(meta).toEqual([
      { name: "citation_title", content: "Rozszerzenie UE 2030" },
      { name: "citation_author", content: "Kowalska, Anna" },
      { name: "citation_author", content: "Nowak, Jan" },
      { name: "citation_publication_date", content: "2026/02/03" },
      { name: "citation_online_date", content: "2026/02/03" },
      { name: "citation_journal_title", content: "New European Strategies" },
      { name: "citation_language", content: "pl" },
      {
        name: "citation_fulltext_html_url",
        content: "https://neweuropeanstrategies.com/blog/rozszerzenie-ue-2030",
      },
      {
        name: "citation_public_url",
        content: "https://neweuropeanstrategies.com/blog/rozszerzenie-ue-2030",
      },
    ]);
  });
});

describe("citationMetaTags - autorzy", () => {
  it("pusta lista autorów nie daje ANI JEDNEGO tagu citation_author", () => {
    const meta = tags({ authors: [] });
    expect(contents(meta, "citation_author")).toEqual([]);
    // Reszta zestawu musi zostać - wpis bez autora to nadal pozycja do cytowania.
    expect(contents(meta, "citation_title")).toEqual(["Rozszerzenie UE 2030"]);
    expect(contents(meta, "citation_publication_date")).toEqual(["2026/02/03"]);
    expect(contents(meta, "citation_journal_title")).toEqual(["New European Strategies"]);
    expect(contents(meta, "citation_language")).toEqual(["pl"]);
    expect(contents(meta, "citation_public_url")).toHaveLength(1);
  });

  it("autor tylko z displayName spada na displayName (konto organizacji)", () => {
    const meta = tags({ authors: [author({ displayName: "Zespół NES" })] });
    expect(contents(meta, "citation_author")).toEqual(["Zespół NES"]);
  });

  it("autor z nazwiskiem bez imienia daje samo nazwisko, bez wiszącego przecinka", () => {
    const meta = tags({ authors: [author({ lastName: "Kowalska" })] });
    expect(contents(meta, "citation_author")).toEqual(["Kowalska"]);
  });

  it("autor z imieniem i nazwiskiem daje inwersję 'Nazwisko, Imię'", () => {
    const meta = tags({ authors: [author({ firstName: "Anna", lastName: "Kowalska" })] });
    expect(contents(meta, "citation_author")).toEqual(["Kowalska, Anna"]);
  });

  it("nazwisko ma priorytet nad displayName, gdy oba są ustawione", () => {
    const meta = tags({
      authors: [author({ firstName: "Anna", lastName: "Kowalska", displayName: "redakcja NES" })],
    });
    expect(contents(meta, "citation_author")).toEqual(["Kowalska, Anna"]);
  });

  it("autor całkowicie pusty jest POMIJANY - nie powstaje tag z pustym content", () => {
    const meta = tags({
      authors: [
        author({ firstName: "  ", lastName: "", displayName: "   " }),
        author({}),
        author({ lastName: "Nowak" }),
      ],
    });
    // Zostaje wyłącznie autor realny; dwa puste rekordy nie zostawiają śladu.
    expect(contents(meta, "citation_author")).toEqual(["Nowak"]);
    // Twarda asercja na braku pustego content w CAŁYM zestawie - pusty tag
    // autora wyrzuca wpis z indeksu Scholara bez komunikatu.
    expect(meta.every((m) => m.content.trim().length > 0)).toBe(true);
  });

  // DEFEKT (rozjazd z `src/lib/citations/format.ts`). Tam `nameParts` ma jawny
  // fallback z komentarzem "samo imię bez nazwiska - traktujemy je jak family,
  // aby autor nie zniknął z cytatu"; tutaj `authorName` sprawdza tylko
  // `lastName`, a potem `displayName` - autor z wypełnionym WYŁĄCZNIE
  // `first_name` (mononim albo niedokończony profil) wypada bez śladu.
  it("PRZYPIĘCIE STANU FAKTYCZNEGO: autor z samym imieniem nie daje tagu", () => {
    const meta = tags({ authors: [author({ firstName: "Platon" })] });
    expect(contents(meta, "citation_author")).toEqual([]);
  });

  // KONSEKWENCJA: ten sam wpis ma autora w boksie "Cytuj tę analizę" (Chicago
  // /APA/BibTeX z format.ts) i NIE ma go w tagach Highwire, więc Google Scholar
  // widzi pozycję bez autora - taka trafia do indeksu jako anonimowa albo
  // wypada z niego cicho, a redakcja nie ma gdzie tego zobaczyć.
  // Produkcji na tym etapie nie ruszamy.
  it.fails("autor z samym imieniem POWINIEN trafić do citation_author", () => {
    const meta = tags({ authors: [author({ firstName: "Platon" })] });
    expect(contents(meta, "citation_author")).toEqual(["Platon"]);
  });

  it("białe znaki wokół imienia i nazwiska są obcinane", () => {
    const meta = tags({ authors: [author({ firstName: "  Anna  ", lastName: "  Kowalska " })] });
    expect(contents(meta, "citation_author")).toEqual(["Kowalska, Anna"]);
  });
});

describe("citationMetaTags - data", () => {
  it("publishedAt = null zdejmuje OBA tagi daty", () => {
    const meta = tags({ publishedAt: null });
    expect(contents(meta, "citation_publication_date")).toEqual([]);
    expect(contents(meta, "citation_online_date")).toEqual([]);
    // Pozostałe tagi są nietknięte - brak daty nie kasuje pozycji.
    expect(contents(meta, "citation_title")).toHaveLength(1);
    expect(contents(meta, "citation_journal_title")).toHaveLength(1);
  });

  // Pusty łańcuch wpada w gałąź `input.publishedAt ? ... : null` (jest falsy),
  // pozostałe wejścia dochodzą do `scholarDate` i wracają z null. Skutek dla
  // <head> jest w obu przypadkach ten sam i to on jest tu kontraktem.
  it.each([
    ["napis nie-data", "nie-data"],
    ["pusty łańcuch", ""],
    ["miesiąc i dzień poza zakresem", "2026-13-45"],
    ["sam ogon czasu bez daty", "T10:15:00Z"],
    ["śmieciowy timestamp", "0000-00-00T00:00:00Z"],
  ])("data nieparsowalna (%s) nie daje żadnego tagu daty", (_opis, value) => {
    const meta = tags({ publishedAt: value });
    expect(contents(meta, "citation_publication_date")).toEqual([]);
    expect(contents(meta, "citation_online_date")).toEqual([]);
  });

  it.each([
    ["styczeń, jednocyfrowy dzień", "2026-01-05T08:00:00Z", "2026/01/05"],
    ["wrzesień, jednocyfrowy dzień", "2026-09-09T23:59:59Z", "2026/09/09"],
    ["grudzień, dwucyfrowy dzień", "2025-12-31T00:00:00Z", "2025/12/31"],
  ])("data poprawna (%s) ma format YYYY/MM/DD z zerami wiodącymi", (_opis, iso, expected) => {
    const meta = tags({ publishedAt: iso });
    expect(contents(meta, "citation_publication_date")).toEqual([expected]);
    expect(contents(meta, "citation_online_date")).toEqual([expected]);
  });

  it("dzień liczony jest z pól UTC, nie lokalnych", () => {
    // Oba znaczniki leżą w tej samej dobie UTC, ale po przeciwnych jej brzegach:
    // przy użyciu getFullYear/getMonth/getDate zamiast wariantów UTC jeden z
    // nich przeskoczyłby na sąsiedni dzień na runnerze w strefie != UTC (CI
    // Europe/Warsaw przesuwa 23:30Z na następny dzień). Ta asercja pilnuje, że
    // data cytowania jest tą samą wartością niezależnie od strefy procesu.
    const wieczor = tags({ publishedAt: "2026-01-01T23:30:00Z" });
    const rano = tags({ publishedAt: "2026-01-01T00:30:00Z" });
    expect(contents(wieczor, "citation_publication_date")).toEqual(["2026/01/01"]);
    expect(contents(rano, "citation_publication_date")).toEqual(["2026/01/01"]);
    expect(contents(wieczor, "citation_online_date")).toEqual(
      contents(rano, "citation_online_date"),
    );
  });

  it("ISO z offsetem strefy jest normalizowany do doby UTC", () => {
    // 2026-09-01T01:30+03:00 to jeszcze 31 sierpnia w UTC.
    const meta = tags({ publishedAt: "2026-09-01T01:30:00+03:00" });
    expect(contents(meta, "citation_publication_date")).toEqual(["2026/08/31"]);
  });
});

describe("citationMetaTags - adres i język", () => {
  it("pusty url zdejmuje oba tagi adresowe", () => {
    const meta = tags({ url: "" });
    expect(contents(meta, "citation_fulltext_html_url")).toEqual([]);
    expect(contents(meta, "citation_public_url")).toEqual([]);
    // ...ale wydawnictwo i język zostają - to gałąź `if (input.url)`, nie reset.
    expect(contents(meta, "citation_journal_title")).toEqual(["New European Strategies"]);
    expect(contents(meta, "citation_language")).toEqual(["pl"]);
  });

  it("url niepusty daje ten sam adres w obu tagach", () => {
    const meta = tags({ url: "https://neweuropeanstrategies.com/en/blog/eu-enlargement" });
    expect(contents(meta, "citation_fulltext_html_url")).toEqual([
      "https://neweuropeanstrategies.com/en/blog/eu-enlargement",
    ]);
    expect(contents(meta, "citation_public_url")).toEqual([
      "https://neweuropeanstrategies.com/en/blog/eu-enlargement",
    ]);
  });

  it.each([
    ["pl", "pl"],
    ["en", "en"],
  ] as const)("citation_language przenosi kod języka %s bez mapowania", (lang, expected) => {
    // Asercja na KLUCZU języka (Lang = "pl" | "en"), nie na nazwie własnej -
    // Scholar oczekuje dokładnie kodu ISO 639-1.
    expect(contents(tags({ language: lang }), "citation_language")).toEqual([expected]);
  });
});

describe("citationMetaTags - treść przekazywana dosłownie", () => {
  it("tytuł z ampersandem i cudzysłowem NIE jest escapowany w tym module", () => {
    // ŚWIADOMY KONTRAKT, NIE BŁĄD: escapowanie atrybutów należy do warstwy
    // head() / renderera <meta>, która robi je raz dla wszystkich tagów.
    // Podwójne escapowanie dałoby w <head> "&amp;amp;" i taki właśnie tytuł
    // wylądowałby w bibliografii. Kto "naprawi" ten modul dodając escapeHtml,
    // złamie ten test - i to jest zamierzone.
    const title = 'Sankcje & "reset" energetyczny <UE>';
    const meta = tags({ title, authors: [author({ displayName: 'O\'Brien & "spółka"' })] });
    expect(contents(meta, "citation_title")).toEqual([title]);
    expect(contents(meta, "citation_author")).toEqual(['O\'Brien & "spółka"']);
  });

  it("nazwa wydawnictwa idzie do citation_journal_title bez zmian", () => {
    const meta = tags({ siteName: "New European Strategies & Partners" });
    expect(contents(meta, "citation_journal_title")).toEqual([
      "New European Strategies & Partners",
    ]);
  });
});
