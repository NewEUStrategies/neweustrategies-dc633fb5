// KLUCZ SKLEJONY JEST KLUCZEM NIEWIDOCZNYM.
//
// CO SIĘ STAŁO. Tabela danych tornada składała klucz słownika napisem:
// `t(\`tornado.note.${n}\`)`. Unia `TornadoRowNote` ma SIEDEM wartości,
// słownik miał TRZY - i przez to na stronie publicznej, w widocznej tabeli
// danych rodzaju już opublikowanego, przy wierszu stał napis
// „tornado.note.oneLegged". Cztery przypisy z siedmiu.
//
// DLACZEGO NIE ZŁAPAŁA TEGO ŻADNA Z ISTNIEJĄCYCH BRAMEK. Bramka parytetu
// PL/EN pilnuje, żeby klucz OBECNY miał obie wersje - a tych kluczy nie było
// w żadnej. Bramka rozjazdu kod-słownik szuka w kodzie PEŁNYCH ścieżek
// (`"tornado.note.empty"`), a w kodzie stał tylko prefiks i wyrażenie.
// Bramka podziału porad (`chartAdviceAudience`) czyta klucze w cudzysłowach.
// Wszystkie trzy były zielone przez cały czas trwania defektu.
//
// CO PILNUJE TA BRAMKA - dwie strony tej samej umowy:
//   1. KAŻDA wartość unii, z której render skleja klucz, ma treść w OBU
//      językach. Unia musi mieć postać TABLICY RUNTIME (`as const`), bo typu
//      nie da się przejść pętlą - i to jest cena wstępu: prefiks bez tablicy
//      nie ma jak być sprawdzony, więc jest tu zakazany.
//   2. KAŻDY prefiks sklejany w renderach stoi w tabeli `SKLEJANE` niżej.
//      Bez tego sprawdzenia bramka pilnowałaby wyłącznie tego, o czym już
//      wie, a nowy sklejony klucz wchodziłby niezauważony - czyli dokładnie
//      tak, jak wszedł ten, przez który ten plik powstał.
//
// KONWENCJA DLA NOWEGO KODU: klucz słownika wypisuj JAWNIE, najlepiej mapą
// `Record<Unia, string>` (tak robi teraz `TORNADO_NOTE_KEYS` w `Chart.tsx`
// i `READING_KEYS` w każdym renderze). Sklejanie zostaje wyłącznie tam, gdzie
// wartości unii są jednocześnie KOLUMNAMI tabeli i klucz sklejony oszczędza
// mapę o tej samej treści co lista kolumn.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { bezKomentarzy } from "@/lib/ci/sourceScan";
import { BEESWARM_SUMMARY_COLUMNS } from "@/lib/charts/kinds/beeswarm";
import { BOXPLOT_COLUMNS } from "@/lib/charts/kinds/boxplot";
import { HISTOGRAM_RULES } from "@/lib/charts/kinds/histogram";
import { HEATMAP_DOMINANT_AXES, HEATMAP_MARGIN_STATS } from "@/lib/charts/kinds/heatmap";
import { TORNADO_COLUMNS, TORNADO_ROW_NOTES } from "@/lib/charts/kinds/tornado";

const KATALOG = "src/components/charts";
const slownik = readFileSync("src/lib/i18n-charts.ts", "utf8");

/**
 * Prefiksy, z których kod skleja klucz, wraz z pełną listą wartości. Lista
 * jest ZAMKNIĘTA: nowy prefiks musi tu trafić, inaczej drugi test tego pliku
 * jest czerwony.
 */
const SKLEJANE: ReadonlyArray<{ prefiks: string; wartosci: readonly string[] }> = [
  { prefiks: "beeswarm.summary", wartosci: BEESWARM_SUMMARY_COLUMNS },
  { prefiks: "boxplot.table", wartosci: BOXPLOT_COLUMNS },
  { prefiks: "heatmap.dominant", wartosci: HEATMAP_DOMINANT_AXES },
  { prefiks: "heatmap.table", wartosci: HEATMAP_MARGIN_STATS },
  { prefiks: "histogram.rule", wartosci: HISTOGRAM_RULES },
  { prefiks: "tornado.table", wartosci: TORNADO_COLUMNS },
  // Tornado.note NIE JEST już sklejane (mapa `TORNADO_NOTE_KEYS`), ale zostaje
  // tu, bo to ta sama umowa: siedem wartości unii, siedem treści w słowniku.
  { prefiks: "tornado.note", wartosci: TORNADO_ROW_NOTES },
];

/** Blok PL i blok EN nakładki. */
function polowy(): [string, string] {
  const granica = slownik.search(/^const en\b/m);
  expect(granica).toBeGreaterThan(0);
  return [slownik.slice(0, granica), slownik.slice(granica)];
}

const POLOWY = polowy();
const JEZYKI = ["pl", "en"] as const;

/** Czy w danej połowie słownika stoi `prefiks.wartosc`. */
function maKlucz(polowa: string, prefiks: string, wartosc: string): boolean {
  const [rodzaj, blok] = prefiks.split(".");
  const start = polowa.indexOf(`\n    ${rodzaj}: {`);
  if (start < 0) return false;
  const wBloku = polowa.indexOf(`${blok}: {`, start);
  if (wBloku < 0) return false;
  // Koniec podbloku: pierwsze domknięcie na tym samym wcięciu. Wystarczy,
  // bo prettier trzyma wcięcia, a klucze podbloku są o dwa głębiej.
  const koniec = polowa.indexOf("\n      },", wBloku);
  const cialo = polowa.slice(wBloku, koniec < 0 ? undefined : koniec);
  // Klucz z myślnikiem prettier zapisuje w cudzysłowie ("freedman-diaconis").
  return (
    new RegExp(`\\n\\s+${wartosc.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}:`).test(cialo) ||
    cialo.includes(`"${wartosc}":`)
  );
}

/**
 * Prefiksy kluczy SKLEJANYCH w źródle renderu - `t(`prefiks.${...}`)`, gdzie
 * prefiks to wszystko przed pierwszą wstawką.
 *
 * Wydzielone z testu po to, żeby test syntetyczny niżej sprawdzał TĘ SAMĄ
 * funkcję, a nie własną kopię wzorca. Kopia rozjechałaby się przy pierwszej
 * zmianie wzorca i bramka sprawdzałaby wtedy coś innego, niż dowodzi test.
 */
function sklejanePrefiksy(zrodlo: string): string[] {
  // ŹRÓDŁO BEZ KOMENTARZY, i to nie jest ostrożność na zapas: skan idzie
  // wyrażeniem regularnym po tekście, więc komentarz CYTUJĄCY wzorzec
  // sklejanego klucza wywracał tę bramkę na jej własnej dokumentacji.
  const czyste = bezKomentarzy(zrodlo);
  return [...czyste.matchAll(/\bt\(\s*`([a-zA-Z][\w.]*)\.\$\{/g)].map((m) => m[1]);
}

describe("klucze słownika składane z unii", () => {
  it("każda wartość unii ma treść w obu językach", () => {
    const braki: string[] = [];
    for (const { prefiks, wartosci } of SKLEJANE) {
      for (const [i, jezyk] of JEZYKI.entries()) {
        for (const w of wartosci) {
          if (!maKlucz(POLOWY[i], prefiks, w)) braki.push(`${prefiks}.${w} (${jezyk})`);
        }
      }
    }
    expect(
      braki,
      "brakujący klucz sklejany nie zapala się na czerwono nigdzie poza EKRANEM: " +
        "render wypisuje wtedy surową ścieżkę zamiast zdania",
    ).toEqual([]);
  });

  it("żaden render nie skleja prefiksu spoza tabeli", () => {
    const znane = new Set(SKLEJANE.map((s) => s.prefiks));
    const nieznane: string[] = [];
    for (const plik of readdirSync(KATALOG)) {
      if (!plik.endsWith(".tsx")) continue;
      // ŹRÓDŁO BEZ KOMENTARZY, i to nie jest ostrożność na zapas. Skan idzie
      // wyrażeniem regularnym po tekście, więc komentarz CYTUJĄCY wzorzec
      // sklejanego klucza wywracał tę bramkę na jej własnej dokumentacji -
      // trafiłem w to, pisząc komentarz przy mapie przypisów wachlarza.
      // Objaw jest podstępny, bo „naprawa" polega wtedy na przeredagowaniu
      // komentarza, czyli na usunięciu zdania, które wyjaśniało, czego ta
      // bramka pilnuje. Siostrzana `chartAdviceAudience` maskowała komentarze
      // od początku; teraz obie robią to TYM SAMYM pomocnikiem.
      for (const prefiks of sklejanePrefiksy(readFileSync(`${KATALOG}/${plik}`, "utf8"))) {
        if (!znane.has(prefiks)) nieznane.push(`${plik}: ${prefiks}`);
      }
    }
    expect(
      nieznane,
      "prefiks sklejany bez wpisu w SKLEJANE nie jest przez nic sprawdzony - " +
        "dopisz go z tablicą runtime unii albo wypisz klucze jawnie mapą",
    ).toEqual([]);
  });

  it("nie oblewa się na WŁASNEJ DOKUMENTACJI, ale nadal widzi prawdziwe sklejenie", () => {
    // Ta bramka raz już padła nie na defekcie, lecz na komentarzu, który
    // CYTOWAŁ zakazany wzorzec, żeby go wyjaśnić. „Naprawa" polegała wtedy na
    // przeredagowaniu komentarza, czyli na usunięciu zdania tłumaczącego,
    // czego bramka pilnuje - a sam defekt nadal by przeszedł.
    //
    // Test pyta o OBA kierunki naraz, bo osobno każdy da się spełnić źle:
    // maskowanie wszystkiego uciszyłoby bramkę na głucho (najgroźniejszy tryb
    // awarii, bo cicho zielona bramka wygląda jak spełniony inwariant),
    // a maskowanie niczego wraca do stanu wyjściowego.
    const zakaz = "// zakaz: nigdy t(`fan.note.${n}`) - unia ma dziewięć wartości";
    expect(sklejanePrefiksy(zakaz)).toEqual([]);

    const naprawde = "const x = t(`fan.note.${n}`);";
    expect(sklejanePrefiksy(naprawde)).toEqual(["fan.note"]);

    // I jedno obok drugiego, czyli realny plik: komentarz milczy, kod mówi.
    expect(sklejanePrefiksy(`${zakaz}\n${naprawde}\n`)).toEqual(["fan.note"]);
  });
});
