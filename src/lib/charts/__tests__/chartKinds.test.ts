// RODZAJE WYKRESU: JEDNA LISTA, PIĘĆ POWIERZCHNI, ZERO ROZJAZDU.
//
// PO CO TEN PLIK ISTNIEJE. Lista rodzajów wykresu żyje w pięciu miejscach,
// z czego TypeScript widzi tylko jedno:
//
//   1. `CHART_KINDS` w `src/lib/charts/types.ts` - ŹRÓDŁO, z niego wyprowadzony
//      jest typ `ChartKind`;
//   2. toolbar szybkiego przełączania wariantu - `src/lib/blocks/variants.ts`;
//   3. edytor bloku CMS - `KIND_OPTIONS` w `DataVizBlocks.tsx`;
//   4. schemat widgetu buildera - `WIDGET_SCHEMAS.chart` w `schemas.ts`;
//   5. słownik PL i EN - `kinds.*` w `i18n-admin-blocks.ts`.
//
// Punkty 2-5 to zwykłe tablice literałów i obiekty słownika. Dopisanie rodzaju
// do źródła NIE wywoła w nich ani jednego błędu kompilacji, więc rozjazd jest
// nie tylko możliwy, ale ZASZEDŁ: mostek (`waterfall`) był w typie i w edytorze
// bloku, ale NIE w toolbarze wariantów i NIE w schemacie buildera. Skutki były
// dwa, oba ciche: autor widgetu buildera nie mógł mostka wybrać wcale, a autor
// bloku CMS, który raz kliknął w toolbarze inny wariant, nie miał jak do mostka
// wrócić - bo `variant` ma pierwszeństwo nad `kind`.
//
// TA BRAMKA JEST JEDYNYM MIEJSCEM, W KTÓRYM TE PIĘĆ ŚWIATÓW SIĘ SPOTYKA.
// Enumeruje źródło w runtime i wymaga, żeby każdy rodzaj był obecny w każdej
// z pozostałych czterech powierzchni. Nie da się jej spełnić przypadkiem
// i nie da się dodać rodzaju "tylko na chwilę".
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHART_KINDS, isChartKind } from "@/lib/charts/types";
import { parseChartConfig } from "@/lib/charts/parse";
import { getBlockVariants } from "@/lib/blocks/variants";
import { WIDGET_SCHEMAS } from "@/lib/builder/schemas";
import { BUILDER_LABELS_EN } from "@/lib/builder/labelsEn";

const dataViz = readFileSync("src/components/admin/blocks/edit/DataVizBlocks.tsx", "utf8");
const slownik = readFileSync("src/lib/i18n-admin-blocks.ts", "utf8");

describe("rodzaje wykresu - jedno źródło", () => {
  it("typ jest WYPROWADZONY z tablicy, nie zsynchronizowany z nią ręcznie", () => {
    // Dowód pośredni, ale wystarczający: gdyby unia była pisana ręcznie obok
    // tablicy, dałoby się mieć w tablicy napis, którego typ nie zna. Tu każdy
    // element tablicy jest z definicji rodzajem, więc `isChartKind` musi
    // przepuścić wszystkie i nie może przepuścić niczego poza nimi.
    for (const kind of CHART_KINDS) expect(isChartKind(kind)).toBe(true);
    for (const obce of ["", "bar ", "BAR", "radar", "treemap", "minimal", "sparkline"]) {
      expect(isChartKind(obce), `"${obce}" nie jest rodzajem`).toBe(false);
    }
  });

  it("lista nie zawiera rodzaju zakazanego przez specyfikację", () => {
    // Trzy zakazy bezwzględne z sekcji 1: radar (powierzchnia zależy od
    // arbitralnej kolejności osi, więc kłamie strukturalnie), dwie osie Y
    // (relacja między szeregami zależy od dobranych zakresów) i kołowy powyżej
    // pięciu kategorii (ten ostatni jest pilnowany limitem wycinków, nie
    // listą rodzajów). Radar nie ma prawa tu wejść nigdy.
    for (const zakazany of ["radar", "spider", "dual-axis", "two-axis"]) {
      expect(CHART_KINDS as readonly string[]).not.toContain(zakazany);
    }
  });
});

describe("rodzaje wykresu - obecność w KAŻDEJ powierzchni autorskiej", () => {
  it("toolbar wariantów zna każdy rodzaj", () => {
    // Toolbar zapisuje `variant`, a `variant` ma pierwszeństwo nad `kind`.
    // Rodzaj, którego tu nie ma, jest z toolbara nieosiągalny, a po kliknięciu
    // w inny wariant nie da się do niego wrócić.
    const warianty = getBlockVariants("chart");
    expect(warianty, "blok wykresu musi mieć warianty").not.toBeNull();
    const klucze = (warianty ?? []).map((v) => v.key);
    for (const kind of CHART_KINDS) {
      expect(klucze, `toolbar wariantów nie zna rodzaju ${kind}`).toContain(kind);
    }
    // I w drugą stronę: toolbar nie może oferować wariantu, którego silnik nie
    // zna - taki klik degradowałby wykres do słupków bez ostrzeżenia.
    for (const klucz of klucze) {
      expect(isChartKind(klucz), `toolbar oferuje nieznany rodzaj ${klucz}`).toBe(true);
    }
  });

  it("edytor bloku CMS zna każdy rodzaj", () => {
    // `KIND_OPTIONS` to tablica literałów w pliku edytora; czytamy ją
    // z tekstu, bo import komponentu edytora ciągnąłby pół panelu admina.
    const blok = dataViz.slice(dataViz.indexOf("const KIND_OPTIONS"));
    const lista = blok.slice(0, blok.indexOf("];"));
    for (const kind of CHART_KINDS) {
      expect(lista, `KIND_OPTIONS nie zna rodzaju ${kind}`).toContain(`value: "${kind}"`);
    }
  });

  it("schemat widgetu buildera zna każdy rodzaj", () => {
    // `WIDGET_SCHEMAS` jest indeksowany napisem, więc TypeScript nie wie, że
    // klucz `chart` istnieje - a brak schematu wykresu jest sam w sobie
    // defektem, więc asertujemy go, zamiast zamiatać `?.`.
    const schemat = WIDGET_SCHEMAS.chart;
    expect(schemat, "brak schematu widgetu wykresu").toBeTruthy();
    const pole = (schemat ?? []).find((f) => f.key === "kind");
    expect(pole, "schemat wykresu musi mieć pole kind").toBeTruthy();
    const wartosci = (pole?.options ?? []).map((o) => o.value);
    for (const kind of CHART_KINDS) {
      expect(wartosci, `schemat buildera nie zna rodzaju ${kind}`).toContain(kind);
    }
    for (const w of wartosci) {
      expect(isChartKind(w), `schemat oferuje nieznany rodzaj ${w}`).toBe(true);
    }
  });

  it("angielskie etykiety schematu buildera znają każdy rodzaj", () => {
    // PIĄTA POWIERZCHNIA, której ten plik wcześniej nie znał - i brakowało
    // jej nieprzypadkowo. Schemat buildera trzyma etykietę PO POLSKU
    // (`histogram (rozkład)`), a `BUILDER_LABELS_EN` mapuje ją na angielską.
    // Bramka `labelsEn.test.ts` sprawdza tę mapę od strony schematu, ale nie
    // wie nic o `CHART_KINDS`, więc rodzaj dopisany do schematu bez wpisu
    // w mapie przewracał tamten test dopiero po fakcie, w innym pliku i pod
    // nazwą, która nie mówi nic o rodzajach wykresu. Tu jest to jedno
    // zdanie: każda opcja rodzaju musi mieć tłumaczenie.
    const schemat = WIDGET_SCHEMAS.chart;
    const pole = (schemat ?? []).find((f) => f.key === "kind");
    for (const opcja of pole?.options ?? []) {
      // `label` jest w typie schematu OPCJONALNA (pola w rodzaju `level`
      // podają same wartości `h1..h6` i etykieta byłaby powtórzeniem), więc
      // rodzaj bez etykiety to osobna usterka niż rodzaj bez tłumaczenia -
      // i pierwsze zdanie mówi, które z dwóch zaszło.
      const etykieta = opcja.label;
      expect(etykieta, `opcja rodzaju "${opcja.value}" nie ma etykiety`).toBeTruthy();
      expect(
        BUILDER_LABELS_EN[etykieta ?? ""],
        `brak angielskiej etykiety dla opcji "${etykieta}"`,
      ).toBeTruthy();
    }
  });

  it("słownik ma etykietę rodzaju w OBU językach", () => {
    // Klucze słownika są w camelCase, a rodzaje w kebab-case - konwersja jest
    // częścią kontraktu (`bar-horizontal` -> `barHorizontal`), więc bramka
    // musi ją odtworzyć, a nie zgadywać.
    const klucz = (kind: string): string => kind.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    // Blok PL kończy się tam, gdzie zaczyna się blok EN. Szukamy `const en`
    // bez domykania na `= {`, bo słownik deklaruje go z adnotacją typu
    // (`const en: typeof pl = {`) - dopasowanie do samego `= {` dawało -1
    // i test przechodziłby, porównując oba języki z tym samym napisem.
    const granica = slownik.search(/^const en\b/m);
    expect(granica).toBeGreaterThan(0);
    const pl = slownik.slice(0, granica);
    const en = slownik.slice(granica);
    for (const kind of CHART_KINDS) {
      expect(pl, `brak polskiej etykiety rodzaju ${kind}`).toContain(`${klucz(kind)}:`);
      expect(en, `brak angielskiej etykiety rodzaju ${kind}`).toContain(`${klucz(kind)}:`);
    }
  });
});

describe("pierwszeństwo variant nad kind", () => {
  it("NIEZNANY variant nie kasuje jawnie wybranego rodzaju", () => {
    // REGRESJA. `variant` nie jest kluczem bloku wykresu: to generyczne pole
    // wariantu STYLU, którego inne rodzaje bloków używają na wartości w rodzaju
    // "minimal". Wcześniej wygrywał każdy niepusty napis, więc blok
    // z `kind: "donut"` i odziedziczonym `variant: "minimal"` szedł przez
    // `parseChartKind("minimal")`, a to degraduje nieznany zapis do słupków.
    // Pierścień cicho zamieniał się w kolumny, choć autor wybrał go wprost.
    const cfg = parseChartConfig({ kind: "donut", variant: "minimal", categories: ["a"] });
    expect(cfg.kind).toBe("donut");
  });

  it("ZNANY variant nadal wygrywa - toolbar nie traci funkcji", () => {
    const cfg = parseChartConfig({ kind: "donut", variant: "line", categories: ["a"] });
    expect(cfg.kind).toBe("line");
  });

  it("pusty i brakujący variant oddaje decyzję polu kind", () => {
    expect(parseChartConfig({ kind: "waterfall", variant: "", categories: ["a"] }).kind).toBe(
      "waterfall",
    );
    expect(parseChartConfig({ kind: "waterfall", categories: ["a"] }).kind).toBe("waterfall");
  });

  it("brak obu kluczy daje słupki - degradacja jest ŚWIADOMA, nie rzutem", () => {
    // Treść bloku pochodzi z bazy i może być z przyszłej albo cofniętej wersji
    // edytora. Wykres, który nie wie, czym jest, ma się narysować jako
    // najbezpieczniejsza forma, a nie wywrócić strony.
    expect(parseChartConfig({ categories: ["a"] }).kind).toBe("bar");
    // PRZYKŁAD NIEZNANEGO RODZAJU TO `radar`, NIE `boxplot`, i ta zmiana jest
    // sama w sobie dowodem, że bramka pracuje: dopóki boxplot był tylko
    // pomysłem, stał tu jako "rodzaj z przyszłej wersji edytora", a w chwili,
    // gdy wszedł do silnika, ten przypadek zapalił się na czerwono, bo
    // przestał opisywać nieznany zapis. Radar nie ma tego problemu: sekcja 1
    // zakazuje go BEZ WYJĄTKÓW (powierzchnia zależy od arbitralnej kolejności
    // osi, więc ta sama firma wygląda dobrze albo źle w zależności od
    // ustawienia), więc nigdy nie stanie się rodzajem znanym - a bramka wyżej
    // pilnuje, żeby go do listy nie dopisano.
    expect(parseChartConfig({ kind: "radar", categories: ["a"] }).kind).toBe("bar");
  });
});
