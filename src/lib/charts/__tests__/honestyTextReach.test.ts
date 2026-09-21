// TEKST ORZECZENIA, KTÓREGO NIKT NIE WOŁA.
//
// CO ZNALAZŁ AUDYT. Osiem napisów `<rodzaj>.honesty.*` stoi w słowniku w obu
// językach, modele liczą odpowiadające im pola - i żaden render ich nie
// wypisuje:
//
//   scatter.honesty.xVarianceOk, trendMeaningfulOk, xIsSecondVariableOk, overplotOk
//   heatmap.honesty.matrixShapeOk, spreadOk, divergingJustifiedOk, orderOk
//
// I to NIE JEST defekt: treść dociera do czytelnika drugą drogą. Każde z tych
// pól jest jednocześnie źródłem porady formy (`scatterFormAdvice`,
// `heatmapFormAdvice`), a render wypisuje obserwację `reading.*`. Wypisanie
// obu dałoby pod rysunkiem DWA ZDANIA O TEJ SAMEJ TREŚCI - dokładnie to, czego
// silnik unika przy `fan.honesty.constantWidth` (patrz test „stała szerokość
// pasma jest nazwana RAZ").
//
// PO CO WIĘC TA BRAMKA. Bo z zewnątrz jedno i drugie wygląda identycznie:
// napis bez wołającego to albo świadomy duplikat, albo ubytek, przez który
// czytelnik czegoś się nie dowie. Bez zapisu tej pary następny audyt albo
// usunie poprawny tekst, albo dopisze wywołanie i zrobi z listy uwag echo.
//
// UMOWA: każdy napis `<rodzaj>.honesty.*` jest ALBO wołany wprost z renderu,
// ALBO stoi w `PRZEZ_PORADE` razem ze ścieżką `reading.*`, która niesie jego
// treść - a ta ścieżka musi być wołana naprawdę.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import i18n from "@/lib/i18n";
import "@/lib/i18n-charts";
import { bazaLiczebnika } from "@/lib/ci/i18nForms";

/**
 * Orzeczenia, których treść dociera do czytelnika jako OBSERWACJA O FORMIE.
 *
 * Klucz: ścieżka napisu uczciwościowego bez wołającego. Wartość: ścieżka
 * `reading.*`, która mówi to samo czytelnikowi opublikowanego wpisu.
 */
const PRZEZ_PORADE: Record<string, string> = {
  "scatter.honesty.xVarianceOk": "scatter.reading.noXVariance",
  "scatter.honesty.xIsSecondVariableOk": "scatter.reading.syntheticX",
  "scatter.honesty.trendMeaningfulOk": "scatter.reading.trendShowsNothing",
  "scatter.honesty.overplotOk": "scatter.reading.overplotted",
  "heatmap.honesty.matrixShapeOk": "heatmap.reading.notMatrix",
  "heatmap.honesty.spreadOk": "heatmap.reading.noSpread",
  "heatmap.honesty.divergingJustifiedOk": "heatmap.reading.divergingDowngraded",
  "heatmap.honesty.orderOk": "heatmap.reading.unorderedAxis",
};

/** Wszystkie ścieżki liści poddrzewa `charts` jednego języka. */
function sciezki(lng: string): string[] {
  const bundle = i18n.getResourceBundle(lng, "translation") as Record<string, unknown>;
  const korzen = bundle?.charts as Record<string, unknown> | undefined;
  const out: string[] = [];
  const idz = (wezel: Record<string, unknown>, prefiks: string): void => {
    for (const [k, v] of Object.entries(wezel)) {
      const p = prefiks ? `${prefiks}.${k}` : k;
      if (typeof v === "string") out.push(p);
      else if (v && typeof v === "object") idz(v as Record<string, unknown>, p);
    }
  };
  if (korzen) idz(korzen, "");
  return out;
}

/** Źródła nietestowe renderów i modeli - tam, gdzie wołane są klucze. */
function zrodla(katalog: string, acc: string[] = []): string[] {
  for (const e of readdirSync(katalog, { withFileTypes: true })) {
    if (e.name === "__tests__") continue;
    const p = `${katalog}/${e.name}`;
    if (e.isDirectory()) zrodla(p, acc);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const KOD = [...zrodla("src/components/charts"), ...zrodla("src/lib/charts")]
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

/** Czy ścieżka stoi w kodzie jako klucz w cudzysłowie (dowolnym z trzech). */
const wolana = (sciezka: string): boolean =>
  KOD.includes(`"${sciezka}"`) || KOD.includes(`'${sciezka}'`) || KOD.includes(`\`${sciezka}\``);

/** Nazwa bazowa ścieżki - bez sufiksu formy liczebnika. */
function baza(sciezka: string): string {
  const s = sciezka.split(".");
  return [...s.slice(0, -1), bazaLiczebnika(s[s.length - 1])].join(".");
}

const ORZECZENIA = [...new Set(sciezki("pl").map(baza))].filter((s) => /\.honesty\./.test(s));

describe("napisy orzeczeń uczciwości mają odbiorcę", () => {
  it("skan widzi realne orzeczenia, a nie pustą listę", () => {
    // Osłona przed cicho zieloną bramką: gdyby słownik przestał się
    // rejestrować albo ścieżki zmieniły kształt, sprawdzenia niżej
    // przeszłyby na zerowej liście.
    expect(ORZECZENIA.length, "skan nie znalazł ani jednego napisu honesty.*").toBeGreaterThan(50);
  });

  it("każdy napis jest wołany z renderu albo ma zapisaną parę `reading.*`", () => {
    const osierocone = ORZECZENIA.filter((s) => !wolana(s) && !(s in PRZEZ_PORADE));
    expect(
      osierocone.sort(),
      "napis uczciwościowy bez wołającego: albo wypisz go w renderze, albo - " +
        "gdy tę samą treść niesie obserwacja o formie - dopisz parę do PRZEZ_PORADE",
    ).toEqual([]);
  });

  it("każda zapisana para wskazuje obserwację, która NAPRAWDĘ jest wołana", () => {
    // Bez tego wpis w tabeli byłby obietnicą bez pokrycia: „treść dociera
    // poradą" przestaje być prawdą w chwili, w której render przestaje tę
    // poradę wypisywać, a tabela nadal twierdzi, że dociera.
    const martwe = Object.entries(PRZEZ_PORADE)
      .filter(([, porada]) => !wolana(porada))
      .map(([orzeczenie, porada]) => `${orzeczenie} -> ${porada} (nikt nie woła)`);
    expect(martwe, "para wskazuje obserwację, której żaden render nie wypisuje").toEqual([]);
  });

  it("każda zapisana para dotyczy napisu, który ISTNIEJE i MILCZY", () => {
    // Dwa ratchety w jednym: wpis o nieistniejącym kluczu jest śladem po
    // usuniętym napisie, a wpis o kluczu JUŻ WOŁANYM kłamie o stanie kodu -
    // i chroni przed wykryciem prawdziwego duplikatu, gdyby ktoś dopisał
    // wywołanie.
    const znane = new Set(ORZECZENIA);
    const bledne = Object.keys(PRZEZ_PORADE).filter((k) => !znane.has(k) || wolana(k));
    expect(
      bledne.sort(),
      "wpis PRZEZ_PORADE wskazuje napis, którego nie ma w słowniku albo który " +
        "render już wypisuje - w drugim przypadku pod rysunkiem stoją dwa zdania o tej samej treści",
    ).toEqual([]);
  });

  it("obie strony pary mają treść w OBU językach", () => {
    // Para, której angielska połowa nie istnieje, przenosi defekt zamiast go
    // rozwiązywać: czytelnik angielski zobaczyłby surową ścieżkę klucza.
    const en = new Set(sciezki("en").map(baza));
    const braki: string[] = [];
    for (const [orzeczenie, porada] of Object.entries(PRZEZ_PORADE)) {
      if (!en.has(orzeczenie)) braki.push(`${orzeczenie} (en)`);
      if (!en.has(porada)) braki.push(`${porada} (en)`);
    }
    expect(braki.sort()).toEqual([]);
  });
});
