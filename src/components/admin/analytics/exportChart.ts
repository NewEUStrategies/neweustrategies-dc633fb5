/**
 * Pomocniki eksportu danych wykresu.
 *
 * `exportPng` dostaje KONTENER rysunku, a nie instancję biblioteki - silnik
 * maluje SVG w drzewie strony, więc zrzut powstaje z węzła (`../../lib/charts/
 * exportImage`), a nie z płótna. Dzięki temu moduł nie ciągnie żadnej
 * biblioteki wykresów do pakietu SSR.
 *
 * CSV export follows RFC 4180 with CRLF line endings and quotes any cell that
 * contains a delimiter, quote, or newline. The BOM prefix makes Excel treat
 * the file as UTF-8 without prompting for encoding - and because the file
 * declares a spreadsheet as its reader, cells that a spreadsheet would take for
 * a formula are neutralised on the way out (see `neutralizeFormula`).
 *
 */
import { svgDoPng, type WpisKlucza } from "@/lib/charts/exportImage";

/**
 * Znaki, od których arkusz zaczyna czytać komórkę jako FORMUŁĘ, a nie jako
 * tekst. `=` i `@` otwierają formułę wprost, `+` i `-` przez skrót zapisu
 * (`+A1`, `-A1`), a TAB i CR są w tej liście, bo arkusze obcinają wiodące
 * białe znaki przed rozpoznaniem zawartości, więc `\t=1+1` wraca do `=1+1`.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * Liczba w zapisie, który arkusz i tak przeczyta jako LICZBĘ: opcjonalny znak,
 * część całkowita i ułamkowa (kropka albo przecinek - dane panelu jadą przez
 * `toLocaleString("pl-PL")`), notacja wykładnicza, opcjonalny procent.
 */
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?%?$/;

/**
 * Neutralizacja wstrzyknięcia formuły do arkusza (CWE-1236).
 *
 * DROGA WEJŚCIA JEST ZEWNĘTRZNA. `GscBiDashboard` buduje wiersze eksportu z
 * `r.keys[0]`, czyli z FRAZY WYSZUKIWANIA z Search Console - wstawia ją dowolna
 * osoba, która wyszuka spreparowany napis i wejdzie na stronę tenanta, bo GSC
 * raportuje zapytanie już od jednej wyświetlonej pozycji. Cytowanie z RFC 4180
 * jej nie dotyka: `=cmd|'/c calc'!A0` nie ma przecinka ani cudzysłowa, więc dla
 * formatu CSV jest zwykłym tekstem i wychodzi z pliku nietknięty - a plik sam
 * deklaruje arkusz jako odbiorcę (BOM „dla Excela" w nagłówku wyżej), więc
 * ładunek wykonuje się na komputerze redaktora otwierającego raport.
 *
 * WYBÓR TECHNIKI. Prefiks apostrofu, ale WYŁĄCZNIE dla komórek zaczynających
 * się od znaku ryzykownego i NIEBĘDĄCYCH liczbą. Apostrof jest w Excelu,
 * LibreOffice i Arkuszach Google znacznikiem „to jest tekst" - dokładnie tym,
 * co wpisuje człowiek, gdy chce zobaczyć `=1+1` zamiast `2` - więc wartość
 * zostaje CZYTELNA w całości (żadnego kodowania, obcinania ani podmiany znaków)
 * i nie wymaga dodatkowego cytowania.
 *
 * Trzy warunki, których nie wolno przy tym złamać, i sposób, w jaki są tu
 * spełnione:
 *  - LICZBY. Najprostsze rozwiązanie - apostrof przed KAŻDĄ komórką - psuje
 *    kolumnę liczbową: `-12.5` stałoby się tekstem, a suma i wykres w arkuszu
 *    przestałyby działać. Dlatego przed prefiksem stoi `PLAIN_NUMBER`: wartość,
 *    którą arkusz przeczyta jako liczbę, przechodzi BEZ ZMIAN, bo liczba nie
 *    jest formułą.
 *  - DATY. Reguła patrzy tylko na PIERWSZY znak, a `2026-08-30` zaczyna się od
 *    cyfry, więc data nie jest nawet kandydatem do neutralizacji. Odwrotny
 *    pomysł („komórka zawiera `-`, `+` albo `=`") zamieniłby każdą datę ISO w
 *    tekst - i o tę różnicę idzie tu gra.
 *  - ŁADUNEK. `=cmd|'/c calc'!A0` liczbą nie jest, więc wychodzi jako
 *    `'=cmd|'/c calc'!A0`: arkusz pokazuje napis, nie uruchamia DDE.
 */
function neutralizeFormula(s: string): string {
  if (!FORMULA_LEAD.test(s) || PLAIN_NUMBER.test(s)) return s;
  return `'${s}`;
}

function escapeCell(v: unknown): string {
  // Kolejność jest istotna: najpierw neutralizacja, potem cytowanie z RFC 4180.
  // Apostrof ląduje więc WEWNĄTRZ pola cytowanego, a nie przed cudzysłowem
  // otwierającym - inaczej parser CSV zobaczyłby pole niecytowane zaczynające
  // się od apostrofu i cudzysłów w środku.
  if (v === null || v === undefined) return "";
  const s = neutralizeFormula(String(v));
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCsv(headers: string[], rows: readonly (readonly unknown[])[]): string {
  const bom = "\uFEFF";
  const head = headers.map(escapeCell).join(",");
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  return `${bom}${head}\r\n${body}`;
}

function triggerDownload(filename: string, blob: Blob): void {
  if (typeof window === "undefined") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(
  filename: string,
  headers: string[],
  rows: readonly (readonly unknown[])[],
): void {
  const blob = new Blob([buildCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  triggerDownload(filename.endsWith(".csv") ? filename : `${filename}.csv`, blob);
}

/**
 * Zrzut wykresu do PNG.
 *
 * TŁO IDZIE Z MOTYWU, NIE JEST BIELĄ NA SZTYWNO, i to jest naprawa realnej
 * usterki. Kanwa dostaje kolory tekstu, osi i etykiet z motywu ROZWIĄZANEGO
 * w chwili renderu, a `baseOption` ustawia jej tło `transparent`. Przy
 * wymuszonej bieli eksport z sesji w trybie ciemnym zapisywał więc niemal
 * biały tekst i niemal białe etykiety osi na białym tle - plik otwierał się
 * jako pusty prostokąt z samymi słupkami. Awaria była niewidoczna dla
 * eksportującego, bo na ekranie wykres wyglądał poprawnie.
 *
 * CZEGO TO NIE ZAŁATWIA - świadomie. Specyfikacja chce, żeby eksport i druk
 * szły ZAWSZE na tokenach jasnych (wykres na ciemnym tle w prezentacji na
 * jasnym slajdzie zużywa toner i wygląda jak dziura). Tu tego nie robimy, bo
 * ECharts ma kolory już wpieczone w opcję: wymuszenie jasnych wymagałoby
 * przestawienia opcji instancji, zrzutu i przywrócenia poprzedniej - czyli
 * dwóch dodatkowych `setOption(notMerge)` na każdy eksport i ryzyka, że
 * między nimi wykres zamiga albo zgubi stan interakcji. Zrzut CZYTELNY
 * w motywie sesji jest tu poprawą, której koszt wynosi jedną linię;
 * wymuszenie jasnych jest osobną zmianą, w tym samym miejscu.
 * Druk STRONY jest już wymuszony na jasnych tokenach - patrz `@media print`
 * w `src/styles.css`.
 */
/**
 * Zrzut rysunku do PNG.
 *
 * BIERZE KONTENER, nie instancję biblioteki: silnik rysuje SVG w drzewie
 * strony, więc jedynym uchwytem, jaki karta ma, jest węzeł. Szukamy w nim
 * PIERWSZEGO `<svg>` - rama silnika stawia rysunek przed tabelą danych, a
 * tabela `<svg>` nie zawiera.
 *
 * TŁO JEST OBOWIĄZKOWE: PNG z przezroczystym tłem wklejony do dokumentu
 * o ciemnym tle pokazuje ciemny tusz na ciemnym, czyli nic. Bierzemy płytę
 * karty (`--card`), bo na niej rysunek stoi na ekranie.
 */
/**
 * KLUCZ RYSUNKU ODCZYTANY Z DOM-U, a nie odtworzony z konfiguracji.
 *
 * DLACZEGO TAK, A NIE Z `ChartConfig`. Klucz na ekranie powstaje w silniku:
 * to on rozstrzyga, które rodzaje mają legendę serii, który ma tabelę klucza
 * tarczy, a które nie mają żadnego (histogram, mapa cieplna, mostek ma za to
 * klucz ZNAKU, nie serii), i to on przydziela kolory slotom. Zbudowanie
 * drugiej takiej listy w panelu dałoby DRUGIE ŹRÓDŁO PRAWDY, które rozjedzie
 * się z pierwszym przy najbliższej zmianie reguł - a rozjazd byłby widoczny
 * dopiero w pobranym pliku, czyli poza zasięgiem jakiegokolwiek testu układu.
 * Czytamy więc dokładnie to, co czytelnik ma przed oczami.
 *
 * Oba klucze mają tę samą budowę - próbka `aria-hidden` plus napis obok - więc
 * jedna reguła obsługuje legendę i tabelę tarczy.
 */
function kluczZRysunku(container: HTMLElement): WpisKlucza[] {
  const ramka = container.querySelector("figure");
  if (ramka === null) return [];
  const styl = (el: Element, wlasciwosc: string): string =>
    getComputedStyle(el).getPropertyValue(wlasciwosc).trim();

  const wiersze = [...ramka.querySelectorAll(".neh-pie-key tbody tr")];
  if (wiersze.length > 0) {
    return wiersze.flatMap((tr) => {
      const probka = tr.querySelector("th span[aria-hidden]");
      // SĄSIAD PRÓBKI, a nie „pierwszy span bez aria-hidden": ten drugi łapie
      // opakowanie układu (`<span class="flex">`), które treść owija, ale
      // koloru napisu nie nosi - i klucz wychodził z pustym tuszem.
      const nazwa = probka?.nextElementSibling ?? null;
      if (probka === null || nazwa === null) return [];
      // Udział i wartość bezwzględną też bierzemy: tabela klucza niesie je
      // w wierszu, a zrzut bez nich byłby uboższy od tego, co widać.
      const liczby = [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim());
      const opis = liczby.filter(Boolean).join(" · ");
      return [
        {
          label: opis === "" ? (nazwa.textContent ?? "") : `${nazwa.textContent ?? ""} — ${opis}`,
          color: styl(probka, "background-color"),
          textColor: styl(nazwa, "color"),
        },
      ];
    });
  }

  return [...ramka.querySelectorAll(":scope > ul > li")].flatMap((li) => {
    const probka = li.querySelector("span[aria-hidden]");
    const nazwa = probka?.nextElementSibling ?? null;
    if (probka === null || nazwa === null) return [];
    return [
      {
        label: nazwa.textContent ?? "",
        // Seria poza zestawem bezpiecznym dla daltonizmu ma próbkę kreskowaną
        // (gradient), a `background-color` jest wtedy przezroczysty - bierzemy
        // wówczas kolor napisu, żeby kwadrat nie wyszedł niewidzialny.
        color: (() => {
          const tlo = styl(probka, "background-color");
          return tlo === "" || tlo === "rgba(0, 0, 0, 0)" ? styl(nazwa, "color") : tlo;
        })(),
        textColor: styl(nazwa, "color"),
      },
    ];
  });
}

export async function exportPng(filename: string, container: HTMLElement | null): Promise<void> {
  const svg = container?.querySelector("svg") ?? null;
  if (svg === null || container === null) return;
  const plyta = getComputedStyle(document.documentElement).getPropertyValue("--card").trim();
  const blob = await svgDoPng(svg as SVGSVGElement, {
    background: plyta === "" ? "#ffffff" : plyta,
    // PODWÓJNA GĘSTOŚĆ WPROST, choć taka jest też domyślna: eksport z panelu
    // ląduje w prezentacji i w raporcie dla zarządu, gdzie rozmyty wykres jest
    // jedynym, co widać. Domyślna wartość może się kiedyś zmienić dla innego
    // wywołującego; ta karta ma swój powód i mówi go tutaj.
    scale: 2,
    // KLUCZ DOKLEJONY DO PLIKU. Bez niego zrzut wykresu wieloseryjnego pokazuje
    // kilka kolorów bez ani jednej nazwy, a zrzut pierścienia - bezimienne
    // wycinki. Eksport z kanwy malował legendę razem z rysunkiem, więc brak
    // klucza byłby regresją wobec stanu sprzed przeniesienia na nasz silnik.
    klucz: kluczZRysunku(container),
  });
  triggerDownload(filename.endsWith(".png") ? filename : `${filename}.png`, blob);
}
