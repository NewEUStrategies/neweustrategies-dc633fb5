// Eksport danych wykresu (`src/components/admin/analytics/exportChart.ts`) -
// pierwszy test tego pliku (stał na 0/26 linii, 0/7 funkcji).
//
// PO CO. To jest jedyne miejsce w panelu BI, w którym dane opuszczają aplikację
// jako PLIK, i cała jego poprawność jest niewidoczna z wnętrza aplikacji:
//
//  1. CSV JEST FORMATEM, NIE KONKATENACJĄ. `escapeCell` cytuje komórkę z
//     przecinkiem, cudzysłowem, LF albo CR i podwaja cudzysłowy wewnętrzne.
//     Zgubiona gałąź tego warunku nie psuje niczego na ekranie - psuje PLIK,
//     i to po cichu: jeden nieucytowany przecinek w tytule strony przesuwa
//     wszystkie kolumny tego wiersza o jedną w prawo, a arkusz otwiera się bez
//     ostrzeżenia. Defekt ujawnia się dopiero u odbiorcy raportu, tygodnie
//     później, jako „liczby się nie zgadzają".
//  2. BOM I CRLF TO KONTRAKT Z EXCELEM, nie ozdoba. Bez BOM-u Excel czyta plik
//     jako Windows-1252 i polskie znaki w nagłówkach rozsypują się na krzaki;
//     bez CRLF starsze wersje sklejają wiersze. Oba są jednoznakowymi
//     szczegółami, które przy refaktorze wypadają jako pierwsze - dlatego są tu
//     mierzone na BAJTACH bloba, nie na napisie.
//  3. POBRANIE MUSI SIĘ POSPRZĄTAĆ. `triggerDownload` wstawia kotwicę do DOM
//     (przeglądarki ignorują `click()` na elemencie odczepionym), klika i ją
//     usuwa. Kotwica, która zostaje, to widoczny artefakt w panelu i wyciek
//     `blob:` URL-a przy każdym eksporcie.
//
// DLACZEGO NIE MA TU IMPORTU `echarts`. `exportPng` dostaje instancję wykresu
// PARAMETREM - to jest cała treść nagłówka testowanego pliku, który zabrania
// wciągania ~1 MB ECharts do grafu SSR. Test, który by ten moduł zaimportował
// (choćby po typ), unieważniałby dowód. Typ parametru jest więc WYPROWADZONY z
// sygnatury `exportPng` (`Parameters<...>`), a atrapa - obiekt z jedną metodą -
// dostaje jedno rzutowanie przez `unknown`, bo pełny interfejs `ECharts` ma
// ponad sto metod, z których ta funkcja woła dokładnie jedną.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildCsv, exportCsv, exportPng } from "../exportChart";

/**
 * Typ instancji wykresu WYPROWADZONY z sygnatury, bez importu `echarts`.
 * `exportPng` przyjmuje `ECharts | null | undefined`, więc `NonNullable`
 * zdejmuje z niego dwa puste warianty.
 */
type InstancjaWykresu = NonNullable<Parameters<typeof exportPng>[1]>;

/** Jedyna metoda, której `exportPng` faktycznie używa. */
interface AtrapaWykresu {
  getDataURL: (opcje: { type: string; pixelRatio: number; backgroundColor: string }) => string;
}

/** Wywołania `getDataURL` z ostatniej atrapy - dowód na parametry eksportu. */
let wywolaniaDataUrl: { type: string; pixelRatio: number; backgroundColor: string }[] = [];

function atrapaWykresu(dataUrl: string): InstancjaWykresu {
  const atrapa: AtrapaWykresu = {
    getDataURL: (opcje) => {
      wywolaniaDataUrl.push(opcje);
      return dataUrl;
    },
  };
  // Jedno rzutowanie, świadome: `ECharts` to interfejs klasy z kilkudziesięcioma
  // metodami, a kontraktem tej funkcji jest wyłącznie `getDataURL`.
  return atrapa as unknown as InstancjaWykresu;
}

/** Pobranie zarejestrowane przez szpiega na `HTMLAnchorElement.prototype.click`. */
interface Pobranie {
  href: string;
  download: string;
  /** Czy kotwica była PODPIĘTA do dokumentu w chwili kliknięcia. */
  wDokumencie: boolean;
}

let pobrania: Pobranie[] = [];
let bloby: Blob[] = [];
let odwolaneUrle: string[] = [];
let licznikUrli = 0;

beforeEach(() => {
  wywolaniaDataUrl = [];
  pobrania = [];
  bloby = [];
  odwolaneUrle = [];
  licznikUrli = 0;
  vi.useFakeTimers();

  vi.spyOn(URL, "createObjectURL").mockImplementation((obiekt: Blob | MediaSource) => {
    bloby.push(obiekt as Blob);
    licznikUrli += 1;
    return `blob:nes-test-${licznikUrli}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url: string) => {
    odwolaneUrle.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    pobrania.push({
      // `getAttribute`, nie właściwość `href`: dla schematu `blob:` obie dają to
      // samo, ale atrybut nie przechodzi przez rozwiązywanie względem bazy
      // dokumentu, więc asercja nie zależy od adresu strony testowej.
      href: this.getAttribute("href") ?? "",
      download: this.getAttribute("download") ?? "",
      wDokumencie: document.body.contains(this),
    });
  });
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const kotwica of Array.from(document.querySelectorAll("a[download]"))) kotwica.remove();
});

/**
 * Znak BOM zapisany UCIECZKĄ, nie dosłownie.
 * Dosłowny U+FEFF w źródle testu jest niewidoczny w recenzji i łatwo go zgubić
 * przy kopiowaniu asercji - a to jest DOKŁADNIE ten bajt, którego ten plik
 * pilnuje.
 */
const BOM = "\uFEFF";

/** Bajty bloba - jedyny sposób, żeby zmierzyć BOM i CRLF, a nie napis w JS. */
async function bajty(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

// ---------------------------------------------------------------------------
describe("buildCsv - zgodność z RFC 4180", () => {
  it("prefiks BOM stoi na samym początku i jest zakodowany jako EF BB BF", async () => {
    // Mierzone na bajtach, bo w napisie JS BOM to jeden znak U+FEFF - dopiero
    // kodowanie do UTF-8 pokazuje, czy Excel dostanie sygnaturę, której szuka.
    const csv = buildCsv(["dzień"], [["2026-09-01"]]);

    expect(csv.startsWith(BOM)).toBe(true);
    const b = await bajty(new Blob([csv]));
    expect(b.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("końce wierszy to CRLF - także ten po nagłówku", () => {
    const csv = buildCsv(
      ["a", "b"],
      [
        ["1", "2"],
        ["3", "4"],
      ],
    );

    expect(csv).toBe(`${BOM}a,b\r\n1,2\r\n3,4`);
    // Żadnego samotnego LF: gdyby gdzieś zostało "\n", ten warunek to złapie.
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("komórka z PRZECINKIEM jest cytowana - inaczej rozjeżdża kolumny wiersza", () => {
    const csv = buildCsv(["tytuł", "kliknięcia"], [["Bruksela, Berlin i Warszawa", 12]]);

    expect(csv).toContain('"Bruksela, Berlin i Warszawa",12');
  });

  it("komórka z CUDZYSŁOWEM jest cytowana, a cudzysłów wewnętrzny PODWOJONY", () => {
    // Sam cudzysłów bez otaczających cudzysłowów byłby dla parsera początkiem
    // pola cytowanego i zjadłby resztę pliku jako jedną komórkę.
    const csv = buildCsv(["fraza"], [['polityka "otwartych drzwi"']]);

    expect(csv).toContain('"polityka ""otwartych drzwi"""');
  });

  it("komórka z LF, z CR i z CRLF jest cytowana", () => {
    const csv = buildCsv(["a", "b", "c"], [["wiersz\ndrugi", "stary\rmac", "okna\r\nwers"]]);

    expect(csv).toContain('"wiersz\ndrugi"');
    expect(csv).toContain('"stary\rmac"');
    expect(csv).toContain('"okna\r\nwers"');
  });

  it("null i undefined stają się PUSTĄ komórką, nie napisami 'null'/'undefined'", () => {
    // `String(null)` daje "null" - gdyby przejść przez `String` bez strażnika,
    // arkusz pokazałby cztery litery zamiast pustego pola, a suma kolumny
    // liczbowej zamieniłaby się w błąd typu.
    const csv = buildCsv(["a", "b", "c"], [[null, undefined, 0]]);

    expect(csv).toBe(`${BOM}a,b,c\r\n,,0`);
  });

  it("zero jako liczba i pusty napis PRZECHODZĄ - to nie są wartości puste", () => {
    // Odwrotność poprzedniego: strażnik `v === null || v === undefined` nie może
    // złapać `0` ani `""`. Warunek `!v` byłby tu klasycznym błędem.
    const csv = buildCsv(["a", "b", "c"], [[0, "", false]]);

    expect(csv).toBe(`${BOM}a,b,c\r\n0,,false`);
  });

  it("NAGŁÓWKI przechodzą przez to samo cytowanie co komórki", () => {
    // Nagłówki są tłumaczone (`t("adminAnalytics.gsc.csvHeaders.query")`), więc
    // przecinek w polskim tłumaczeniu jest realną możliwością, nie hipotezą.
    const csv = buildCsv(["pozycja, średnia", 'CTR "netto"'], [[1, 2]]);

    expect(csv).toBe(`${BOM}"pozycja, średnia","CTR ""netto"""\r\n1,2`);
  });

  it("pusty zbiór wierszy nadal oddaje LINIĘ NAGŁÓWKA", () => {
    // Raport bez danych ma być plikiem z nagłówkiem, nie plikiem pustym -
    // odbiorca musi widzieć, że eksport się wykonał i po prostu nic nie znalazł.
    const csv = buildCsv(["dzień", "błędy"], []);

    expect(csv).toBe(`${BOM}dzień,błędy\r\n`);
    expect(csv.split("\r\n")[0]).toBe(`${BOM}dzień,błędy`);
  });

  it("wartości nietekstowe idą przez String() - liczba, bool, data", () => {
    const data = new Date(Date.UTC(2026, 8, 1));
    const csv = buildCsv(["n", "b", "d"], [[3.14, true, data.toISOString()]]);

    expect(csv).toBe(`${BOM}n,b,d\r\n3.14,true,2026-09-01T00:00:00.000Z`);
  });

  it("komórka zaczynająca się od '=', '+' albo '@' jest NEUTRALIZOWANA - plik jest przeznaczony dla Excela", () => {
    // WSTRZYKNIĘCIE FORMUŁY DO ARKUSZA (CWE-1236) - zamknięte i pilnowane tutaj.
    //
    // Nagłówek `exportChart.ts` sam deklaruje Excela jako odbiorcę („The BOM
    // prefix makes Excel treat the file as UTF-8"), a cytowanie z RFC 4180
    // ładunku nie dotyka: komórka `=cmd|'/c calc'!A0` nie ma przecinka ani
    // cudzysłowa, więc dla formatu CSV jest zwykłym tekstem i wychodziła z
    // pliku nietknięta, a Excel wykonywał ją przy otwarciu. Dlatego
    // `escapeCell` neutralizuje ładunek PRZED cytowaniem formatu.
    //
    // DROGA WEJŚCIA JEST ZEWNĘTRZNA, nie tylko administracyjna:
    // `GscBiDashboard.tsx` buduje wiersze eksportu z `r.keys[0]`, czyli z
    // FRAZY WYSZUKIWANIA z Google Search Console. Frazę wstawia tam dowolna
    // osoba, która wyszuka spreparowany napis i wejdzie na stronę tenanta -
    // GSC raportuje zapytania już od jednej wyświetlonej pozycji. Ładunek
    // ląduje potem w pliku, który administrator tenanta otwiera lokalnie, więc
    // wykonanie następuje na JEGO komputerze, poza aplikacją.
    //
    // WYBRANĄ TECHNIKĄ jest prefiks apostrofu - znacznik „to jest tekst" w
    // Excelu, LibreOffice i Arkuszach Google - nałożony WYŁĄCZNIE na komórkę,
    // która zaczyna się od `= + - @ TAB CR` i nie jest liczbą. Prefiks dla
    // WSZYSTKICH komórek (rozwiązanie najprostsze) zamieniłby kolumnę liczbową
    // w tekst, dlatego niżej stoi druga asercja: `-12.5` zostaje liczbą
    // ujemną, a `2026-08-30` datą, bo reguła patrzy na PIERWSZY znak i omija
    // wartości liczbowe. Uzasadnienie wyboru w całości: docblok
    // `neutralizeFormula` w `exportChart.ts`.
    //
    // ZASIĘG. Ten sam brak mają `subscribersToCsv`, `suppressionsToCsv`,
    // `RegistrationsListPanel` i `EventsListManager` - poza tym plikiem, więc
    // poza tym testem; ten przypadek pilnuje POWIERZCHNI eksportu BI.
    const csv = buildCsv(["fraza"], [["=cmd|'/c calc'!A0"], ["+1+1"], ["@SUM(A1:A9)"]]);

    const komorki = csv.split("\r\n").slice(1);
    for (const komorka of komorki) {
      expect(komorka.replace(/^"/, "").startsWith("=")).toBe(false);
      expect(komorka.replace(/^"/, "").startsWith("+")).toBe(false);
      expect(komorka.replace(/^"/, "").startsWith("@")).toBe(false);
    }

    // CZYTELNOŚĆ: ładunek jest w pliku W CAŁOŚCI, tylko poprzedzony apostrofem.
    // Neutralizacja nie koduje, nie obcina i nie podmienia znaków - odbiorca
    // raportu widzi frazę, którą ktoś wyszukał, i może ją ocenić.
    expect(csv).toContain("'=cmd|'/c calc'!A0");

    // LICZBY I DATY BEZ USZKODZENIA: dokładnie ta granica, którą łamie prefiks
    // nałożony na wszystko. Asercja na CAŁYM pliku, nie na fragmencie, bo
    // dowodem jest brak JAKIEJKOLWIEK dodatkowej zmiany bajtów.
    expect(buildCsv(["zmiana", "dzień"], [["-12.5", "2026-08-30"]])).toBe(
      `${BOM}zmiana,dzień\r\n-12.5,2026-08-30`,
    );
  });
});

// ---------------------------------------------------------------------------
describe("exportCsv - pobranie pliku", () => {
  it("kliknięta kotwica niesie treść buildCsv jako blob text/csv;charset=utf-8", async () => {
    exportCsv("raport-gsc", ["fraza", "kliknięcia"], [["bruksela, ue", 42]]);

    expect(pobrania).toHaveLength(1);
    expect(bloby).toHaveLength(1);
    expect(bloby[0].type).toBe("text/csv;charset=utf-8");
    expect(await bloby[0].text()).toBe(buildCsv(["fraza", "kliknięcia"], [["bruksela, ue", 42]]));
    expect(pobrania[0].href).toBe("blob:nes-test-1");
  });

  it("sufiks .csv dokładany TYLKO gdy go brakuje", () => {
    exportCsv("bez-sufiksu", ["a"], [["1"]]);
    exportCsv("ma-sufiks.csv", ["a"], [["1"]]);

    expect(pobrania.map((p) => p.download)).toEqual(["bez-sufiksu.csv", "ma-sufiks.csv"]);
  });

  it("kotwica jest PODPIĘTA w chwili kliknięcia i USUNIĘTA zaraz po", () => {
    // Oba warunki naraz, bo naprawa jednego łatwo psuje drugi: kliknięcie na
    // elemencie odczepionym jest w części przeglądarek ignorowane (pobranie po
    // prostu nie startuje), a kotwica zostawiona w `body` to widoczny artefakt
    // rosnący z każdym eksportem.
    exportCsv("raport", ["a"], [["1"]]);

    expect(pobrania[0].wDokumencie).toBe(true);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("blob: URL jest zwalniany po pobraniu - inaczej przeciekają przy każdym eksporcie", () => {
    exportCsv("raport", ["a"], [["1"]]);
    expect(odwolaneUrle).toEqual([]);

    vi.advanceTimersByTime(1000);

    expect(odwolaneUrle).toEqual(["blob:nes-test-1"]);
  });

  it("zwolnienie jest ODROCZONE - natychmiastowe unieważniłoby trwające pobranie", () => {
    // Sedno opóźnienia: przeglądarka czyta bloba asynchronicznie po kliknięciu.
    // `revokeObjectURL` w tej samej turze bywa wyścigiem kończącym się pustym
    // plikiem, dlatego test pilnuje, że URL PRZEŻYWA turę synchroniczną.
    exportCsv("raport", ["a"], [["1"]]);

    vi.advanceTimersByTime(999);
    expect(odwolaneUrle).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(odwolaneUrle).toHaveLength(1);
  });

  it("na SSR (`window` niedostępne) eksport jest cichym no-opem, nie wyjątkiem", () => {
    // Moduł jest importowany przez `ChartCard`, który wchodzi do grafu renderu
    // serwerowego. Wyjątek tutaj przewróciłby całą stronę panelu.
    const realneOkno = window;
    vi.stubGlobal("window", undefined);

    expect(() => exportCsv("raport", ["a"], [["1"]])).not.toThrow();

    vi.stubGlobal("window", realneOkno);
    expect(pobrania).toHaveLength(0);
    expect(bloby).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
describe("exportPng - zrzut wykresu", () => {
  /** Sygnatura PNG - zawiera 0x0D 0x0A, więc dowodzi też braku mielenia końców linii. */
  const BAJTY_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff];
  const DATA_URL = `data:image/png;base64,${btoa(String.fromCharCode(...BAJTY_PNG))}`;

  it("brak instancji (null) to no-op - żadnego pustego pliku", () => {
    exportPng("wykres", null);

    expect(pobrania).toHaveLength(0);
    expect(bloby).toHaveLength(0);
  });

  it("brak instancji (undefined) też - wykres bywa niegotowy w chwili kliknięcia", () => {
    // `ChartCard` trzyma instancję w `useRef` wypełnianym z `onReady`, więc
    // kliknięcie przed pierwszym malowaniem oddaje tu `undefined`. Kontrakt:
    // nic się nie dzieje, zamiast pobrania zepsutego pliku o zerowej długości.
    exportPng("wykres", undefined);

    expect(pobrania).toHaveLength(0);
    expect(wywolaniaDataUrl).toHaveLength(0);
  });

  it("base64 z getDataURL jest ZDEKODOWANY do bajtów bloba image/png", async () => {
    exportPng("wykres", atrapaWykresu(DATA_URL));

    expect(bloby).toHaveLength(1);
    expect(bloby[0].type).toBe("image/png");
    expect(await bajty(bloby[0])).toEqual(BAJTY_PNG);
    // Bajty, nie napis: gdyby blob powstał z samego data URL-a, jego pierwszy
    // bajt byłby literą "d" (0x64), a nie sygnaturą PNG.
    expect((await bajty(bloby[0]))[0]).toBe(0x89);
  });

  it("zrzut jest w podwójnej gęstości i z NIEPRZEZROCZYSTYM tłem", () => {
    // `pixelRatio: 2` to jedyna obrona przed rozmytym wykresem w prezentacji;
    // `backgroundColor` jest jawny, bo `baseOption` ustawia canvasowi
    // `transparent` - PNG bez tła byłby na białym slajdzie nieczytelny.
    exportPng("wykres", atrapaWykresu(DATA_URL));

    expect(wywolaniaDataUrl).toEqual([{ type: "png", pixelRatio: 2, backgroundColor: "#fff" }]);
  });

  it("sufiks .png dokładany TYLKO gdy go brakuje", () => {
    exportPng("bez-sufiksu", atrapaWykresu(DATA_URL));
    exportPng("ma-sufiks.png", atrapaWykresu(DATA_URL));

    expect(pobrania.map((p) => p.download)).toEqual(["bez-sufiksu.png", "ma-sufiks.png"]);
  });

  it("kotwica PNG też jest sprzątana, a jej URL zwalniany", () => {
    exportPng("wykres", atrapaWykresu(DATA_URL));

    expect(pobrania[0].wDokumencie).toBe(true);
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    expect(odwolaneUrle).toEqual(["blob:nes-test-1"]);
  });

  it("data URL bez części base64 daje pusty blob, nie wyjątek", () => {
    // Gałąź `?? ""`. Nie jest to ścieżka szczęśliwa, ale jest jedyną obroną
    // przed wywróceniem panelu, gdyby `getDataURL` oddał napis w innym
    // kształcie (np. z przyszłego rendererem SVG).
    exportPng("wykres", atrapaWykresu("data:image/png;base64"));

    expect(bloby).toHaveLength(1);
    expect(bloby[0].size).toBe(0);
  });
});
