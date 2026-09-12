// Typy silnika wykresów (SVG, zero zależności runtime).
// Konfiguracja pochodzi z bloków CMS / widgetów buildera (Json) i jest
// defensywnie parsowana w parse.ts - komponenty widzą wyłącznie te typy.

/**
 * RODZAJE WYKRESU - JEDNO ŹRÓDŁO, NIE DWA.
 *
 * Wcześniej stała tu unia `ChartKind` ORAZ ręcznie zsynchronizowana z nią
 * tablica `CHART_KINDS`, i nic nie pilnowało ich zgodności: żaden `satisfies`,
 * żadna asercja wyczerpania. Dopisanie rodzaju do jednej i zapomnienie
 * o drugiej dawało kod, który się kompiluje, a w runtime odrzuca rodzaj jako
 * nieznany (albo odwrotnie: przepuszcza rodzaj, którego typ nie zna).
 *
 * Teraz tablica jest ŹRÓDŁEM, a typ jest z niej WYPROWADZONY. Dopisanie
 * rodzaju w jednym miejscu rozszerza jednocześnie typ i walidację, a rozjazd
 * przestaje być wyrażalny.
 *
 * POZOSTAŁE KOPIE TEJ LISTY - i jest ich cztery - żyją poza tym modułem, bo są
 * powierzchniami autorskimi i słownikami: toolbar wariantów
 * (`src/lib/blocks/variants.ts`), edytor bloku (`KIND_OPTIONS`
 * w `DataVizBlocks.tsx`), schemat widgetu buildera (`schemas.ts`) i słownik
 * PL/EN (`i18n-admin-blocks.ts`). Ich zgodności z tą listą pilnuje bramka
 * `src/lib/charts/__tests__/chartKinds.test.ts` - bo TypeScript ich nie widzi,
 * a rozjazd między nimi już raz zaszedł: `waterfall` był w typie i w edytorze,
 * ale nie w toolbarze wariantów ani w schemacie buildera.
 */
export const CHART_KINDS = [
  "line",
  "area",
  "bar",
  "bar-horizontal",
  "pie",
  "donut",
  "waterfall",
  // ROZKŁAD WARTOŚCI. Wchodzi jako pierwszy z rodzajów sekcji 1, bo jest
  // jedynym, który potrzebował OSI CIĄGŁEJ i niczego poza nią - dowodzi więc
  // fundamentu (`lib/charts/plot.ts`) bez ciągnięcia za sobą drugiego
  // wymiaru strefy trafienia. Rysuje go osobny komponent, nie
  // `CartesianChart`: przedział ma szerokość mierzoną w jednostkach danych,
  // a pasmo kategorii jej nie ma - patrz nagłówek `HistogramChart.tsx`.
  "histogram",
  // ROZKŁAD WARTOŚCI, dwie pozostałe formy z tego samego wiersza tabeli
  // doboru: boxplot podsumowuje go pięcioma liczbami pozycyjnymi, beeswarm
  // pokazuje KAŻDĄ obserwację. Oba rysują osobne komponenty, bo żaden nie
  // koduje wartości długością słupka od zera: boxplot koduje ją położeniem
  // pudełka i wąsów, beeswarm położeniem plamki plus przesunięciem
  // prostopadłym, którego wykres kategorialny nie ma czym wyrazić.
  "boxplot",
  "beeswarm",
  // ZALEŻNOŚĆ DWÓCH ZMIENNYCH - jedyny rodzaj w tym silniku, który NIE MA osi
  // kategorii: obie osie są liczbowe i niezależne. Kolumna "czego unikać"
  // stawia przy nim jedno hasło, linię łączącą punkty, i to jest zakaz
  // wyrażony w kodzie, nie w komentarzu - model zwraca `mayConnectPoints:
  // false` jako pole, a render je respektuje.
  "scatter",
  // WRAŻLIWOŚĆ NA DWA PARAMETRY. Jedyny rodzaj, w którym adresem jest PARA
  // (wiersz, kolumna) - jedna współrzędna wskaźnika wskazuje kolumnę, nie
  // komórkę, i to dla niego powstał `cellAddress` w `plot.ts`. Kolumna "czego
  // unikać" mówi: tabela liczb; mapa ciepła ma pokazać KSZTAŁT wrażliwości,
  // a nie kazać odczytywać stu komórek po kolei.
  "heatmap",
  // WRAŻLIWOŚĆ NA WIELE PARAMETRÓW. Zamiennik serii osobnych wykresów.
  // Sortowanie pasków po rozpiętości jest CZĘŚCIĄ FORMY, nie ozdobą:
  // czytelnik odczytuje hierarchię wrażliwości z góry na dół i stąd bierze
  // się kształt leja oraz nazwa rodzaju. Kategorie biegną w PIONIE, więc
  // klawiatura obsługuje go strzałkami góra-dół, jak słupki poziome.
  "tornado",
  // SCENARIUSZE W CZASIE. Wiersz tabeli doboru stawia w kolumnie „czego
  // unikać" jedno hasło: pojedyncza linia prognozy. Cała treść tego rodzaju
  // to KSZTAŁT niepewności, więc skala idzie z `fanExtent`, czyli obejmuje
  // krawędzie pasm, a nie samą linię - pasmo przycięte krawędzią rysunku jest
  // gorsze od braku pasma, bo twierdzi, że niepewność kończy się tam, gdzie
  // kończy się obszar kreślenia.
  "fan",
  // KILKA SZEREGÓW O RÓŻNEJ SKALI. Ten rodzaj istnieje po to, żeby nie było
  // drugiej osi Y - i to jest jego jedyne uzasadnienie. Oddaje TEMPO, a
  // odbiera poziom i jednostkę, więc oś musi powiedzieć wprost, że jest
  // bezjednostkowa, a szereg, którego nie dało się zaindeksować, nie może
  // zniknąć bez podania przyczyny.
  "index-base",
  // STRUKTURA CAŁOŚCI. Wada jest wbudowana w formę: równa wysokość słupków
  // UKRYWA różne wielkości całości, dlatego suma bezwzględna w tabeli jest
  // obowiązkowa. Kolejność segmentów zostaje ARKUSZOWA, bo w tej formie jest
  // decyzją analityczną autora, a nie porządkiem prezentacji.
  "percent-stacked",
  // WIELE PODMIOTÓW NA WIELU WSKAŹNIKACH, i zamiennik dla wykresu powyżej
  // `CATEGORICAL_SAFE_SERIES` serii. Panele porównuje się WZROKIEM, więc
  // wspólna skala jest domyślna, a skala wolna musi być zadeklarowana
  // i widoczna przy każdym panelu. Panel pusty zostaje w siatce - usunięcie
  // go przesuwa sąsiadów i zmienia czytany porządek.
  "small-multiples",
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

/**
 * Czy napis jest znanym rodzajem wykresu. Osobno od `parseChartKind`, bo
 * tamten ZAWSZE zwraca rodzaj (degraduje nieznany zapis do słupków), a tu
 * potrzebna jest odpowiedź "nie wiem, o czym mówisz" - patrz pierwszeństwo
 * `variant` nad `kind` w `parse.ts`.
 */
export function isChartKind(raw: unknown): raw is ChartKind {
  return typeof raw === "string" && (CHART_KINDS as readonly string[]).includes(raw);
}

/**
 * Maksymalna liczba serii na jednym wykresie.
 *
 * To NIE JEST już to samo, co liczba slotów palety, i rozdzielenie jest tu
 * sednem: paleta ma `MAX_COLOR_SLOT` kolorów, bo tyle ich zadano, ale wykres
 * o dwudziestu siedmiu seriach nie byłby do odczytania przy żadnej palecie.
 * Ile serii wolno pokazać, decyduje czytelność, a nie liczba dostępnych hexów.
 */
export const MAX_SERIES = 10;

/**
 * Najwyższy numer slotu, jaki wolno ZAPISAĆ w konfiguracji wykresu. Równy
 * liczbie slotów palety - każdy numer w tym zakresie ma komplet tokenów
 * w arkuszu, a numer spoza niego dałby czarne wypełnienie albo niewidoczną
 * kreskę. Bramka palety pilnuje tej równości.
 */
export const MAX_COLOR_SLOT = 27;

/**
 * Ile PIERWSZYCH POZYCJI SEKWENCJI przypisania jest rozdzielnych dla KAŻDEGO
 * rodzaju widzenia barw. Powyżej tej liczby kolor przestaje nieść kategorię:
 * silnik dokłada kreskowanie, a edytor ostrzega, żeby grupować albo iść
 * w small multiples. Liczba jest wyprowadzona z pomiaru, nie z gustu - musi
 * się zgadzać z `CATEGORICAL_SAFE_MAX` w `src/lib/charts/palette.ts`, gdzie
 * stoi jej wyliczenie i bramka.
 */
export const CATEGORICAL_SAFE_SERIES = 6;

/**
 * Powyżej tylu kategorii tarcza kołowa kłamie strukturalnie: koduje kątem
 * i powierzchnią, czyli kanałami z dolnej połowy hierarchii percepcyjnej,
 * a przy większej liczbie wycinków czytelnik nie porówna już żadnej pary.
 * Nadmiar zwija się w jeden wycinek zbiorczy (patrz `pieModel`), więc żadna
 * liczba nie ginie - pełne wartości niesie tabela danych.
 */
export const PIE_MAX_SLICES = 5;

export interface ChartSeries {
  name: string;
  /** null = luka w danych (linia się przerywa, słupek znika). */
  values: (number | null)[];
  /** Slot koloru 1..MAX_COLOR_SLOT; domyślnie z SLOT_SEQUENCE po pozycji serii. */
  colorSlot: number;
}

import type { BarStyle } from "./palette";

export interface ChartConfig {
  kind: ChartKind;
  title: string;
  description: string;
  /** Etykiety osi X (kategorie / okresy). */
  categories: string[];
  series: ChartSeries[];
  /** Słupki/pola skumulowane (stacked). */
  stacked: boolean;
  /** Jednostka doklejana do wartości (np. "%", " mld EUR"). */
  unit: string;
  /** Wysokość pola rysunku w px (bez ramki/legendy). */
  height: number;
  showLegend: boolean;
  showGrid: boolean;
  /** Bezpośrednie etykiety wartości na znacznikach (selektywne). */
  showValues: boolean;
  /** Animacja wejścia przy pierwszym pojawieniu się w viewport. */
  animate: boolean;
  /** Podpis źródła danych (np. "Źródło: Eurostat 2026"). */
  source: string;

  /**
   * Siła wygładzenia linii, 0..1. Monotoniczny Hermite, nie Catmull-Rom -
   * patrz `src/lib/charts/smooth.ts`. 0 wyłącza wygładzanie (prawdziwe skoki
   * w szeregu, dokument techniczny); poniżej czterech punktów silnik wyłącza
   * je sam, bo krzywa opowiadałaby o kształcie, którego dane nie potwierdzają.
   */
  smoothing: number;
  /**
   * Wariant wypełnienia słupka. Domyślnie blady (obwódka mocna, wnętrze
   * blade); silnik zejdzie do solidnego sam wszędzie, gdzie blade wnętrze
   * przestaje wystarczać - patrz `resolveBarStyle`.
   */
  barStyle: BarStyle;

  /**
   * Indeks PIERWSZEJ kategorii prognozowanej albo null, gdy cały szereg jest
   * historią. Prognoza musi być odróżniona wizualnie od pomiaru: linia
   * przerywana, pionowy separator z etykietą i pasmo niepewności. Bez tego
   * wykres podaje interpolację za dane.
   */
  forecastFrom: number | null;

  /**
   * Granica prognozy TAK, JAK JĄ ZADEKLAROWAŁ AUTOR - przed sprawdzeniem
   * zakresu; `null` = nie zadeklarował nic.
   *
   * Pole istnieje, bo `forecastFrom` zlewa dwa różne stany w jeden: „nie
   * podano granicy" i „podano granicę, której nie da się użyć" dają tam tak
   * samo `null`. Model wachlarza ma osobne orzeczenie na drugi z nich
   * (`honesty.boundaryDropped`), ale na drodze z bloku nie mógł się o nim
   * dowiedzieć - więc autor, który wpisał krok 40 na szeregu o dwunastu,
   * dostawał wykres bez prognozy i ANI SŁOWA o tym, że jego deklaracja
   * poszła do kosza.
   *
   * Zakres sprawdza się nadal TUTAJ, a nie w renderach: `forecastFrom` musi
   * zostać liczbą, którą wolno bez sprawdzania wstawić do geometrii.
   */
  forecastFromDeclared: number | null;

  /**
   * Połowa szerokości pasma niepewności prognozy, w procentach wartości
   * (0 = brak pasma). Sama linia prognozy bez pasma sugeruje pewność, której
   * nie ma - dlatego przy włączonej prognozie edytor podpowiada wartość.
   */
  forecastBandPct: number;

  /**
   * Ile liczb wypadło z serii, bo nie miały swojej kategorii.
   *
   * Parser przycina każdą serię do liczby kategorii i musi to robić: rendery
   * kartezjańskie chodzą po `values` bez ograniczenia, więc nadmiarowa liczba
   * narysowałaby punkt za osią. Ale przycięcie BEZ LICZNIKA czyni martwymi
   * cztery orzeczenia, które powstały dokładnie po to, żeby o tym powiedzieć
   * (`percentStacked.honesty.droppedValues`, `indexBase.honesty
   * .pointsInPeriodsOk`, `smallMultiples.honesty.inGridOk`, `fan.honesty
   * .droppedValues`) - modele liczą nadmiar same, tyle że na drodze z bloku
   * nadmiar do nich nie dociera.
   */
  valuesBeyondCategories: number;

  /**
   * Liczba obserwacji na szereg. Wykres na trzech i na trzystu obserwacjach
   * wygląda tak samo, a znaczy co innego - dlatego `n` jedzie w podpisie.
   * null = autor nie podał.
   */
  sampleSize: number | null;

  /** Data danych (nie data publikacji wpisu) - do podpisu. */
  sourceDate: string;

  /**
   * Trzy zdania pod wykresem: co pokazuje, co jest zaskakujące, czego NIE
   * pokazuje. Ostatnie odróżnia wykres analityczny od ilustracji, więc jest
   * osobnym polem, a nie akapitem w opisie - inaczej nikt go nie napisze.
   */
  notesShows: string;
  notesSurprising: string;
  notesHidden: string;

  /**
   * Wyjaśnienie wskaźnika do tooltipa objaśniającego. null = wykres nie
   * potrzebuje wyjaśnienia (np. bezwzględne kwoty). Patrz `ChartMetric`.
   */
  metric: ChartMetric | null;
}

/**
 * Tooltip OBJAŚNIAJĄCY - druga, całkowicie osobna funkcja od tooltipa danych.
 * Tooltip danych mówi ILE; ten mówi CO TO ZNACZY i wisi przy nazwie
 * wskaźnika, nie nad punktem.
 *
 * PIĘĆ PÓL O STAŁEJ KOLEJNOŚCI, i to jest cała wartość tej struktury:
 * czytelnik, który raz zobaczył jeden taki tooltip, wie, gdzie w następnym
 * szukać progu interpretacyjnego. Dowolna kolejność albo "opis" w jednym
 * akapicie tego nie daje.
 *
 * Treść jest AUTORSKA, nie słownikowa, i dlatego siedzi w konfiguracji bloku,
 * a nie w słowniku i18n: blok wpisu jest już pisany w języku wpisu (tytuły,
 * kategorie, nazwy serii), więc wyjaśnienie wskaźnika idzie tą samą drogą.
 * Ze słownika pochodzą wyłącznie NAZWY pól (wzór, mierzy, czytanie,
 * dźwignie, uwaga) - te są niezależne od wskaźnika.
 */
export interface ChartMetric {
  /** Skrót, przy którym staje ikona - np. "ROIC". */
  name: string;
  /** Rozwinięcie skrótu i tłumaczenie - pierwszy wiersz tooltipa. */
  expansion: string;
  formula: string;
  measures: string;
  /** Jak czytać: z czym porównywać, gdzie są progi. */
  reading: string;
  /** Co realnie tym wskaźnikiem rusza. */
  levers: string;
  /** Na co uważać przy porównaniach. */
  caution: string;
}

/**
 * REGIONY MAPY - JEDNO ŹRÓDŁO, DOKŁADNIE TYM SAMYM WZORCEM CO `CHART_KINDS`
 * WYŻEJ (i z tego samego powodu - patrz tamten komentarz).
 *
 * Wcześniej stała tu unia dwóch literałów, a lista regionów żyła jeszcze
 * w pięciu miejscach poza typem. Dopisanie regionu nie wywoływało w nich ani
 * jednego błędu kompilacji, a każda z tych powierzchni psuła się inaczej:
 * edytor bloku po prostu nie oferował regionu, parser degradował go do Europy
 * (autor widział Europę zamiast Azji, bez słowa ostrzeżenia), a słownik
 * pokazywał surowy klucz.
 *
 * Tablica jest ŹRÓDŁEM, typ jest z niej WYPROWADZONY. `GEO_ASSET_URL` niżej
 * i `REGION_ASPECT_FALLBACK` w `geoAspect.ts` są typowane `Record<MapRegion,
 * ...>`, więc region bez adresu zasobu albo bez aspektu startowego NIE
 * SKOMPILUJE SIĘ - tych dwóch kopii nie trzeba niczym pilnować.
 *
 * POZOSTAŁE KOPIE TEJ LISTY - cztery - są poza zasięgiem TypeScriptu, bo to
 * powierzchnie autorskie i słowniki: edytor bloku CMS (`DataMapBlock`
 * w `DataVizBlocks.tsx`), schemat widgetu buildera (`schemas.ts`) oraz słownik
 * PL i EN (`i18n-admin-blocks.ts`). Ich zgodności z tą listą pilnuje bramka
 * `src/lib/charts/__tests__/mapRegions.test.ts`.
 */
export const MAP_REGIONS = [
  "europe",
  "world",
  "africa",
  "asia",
  "north-america",
  "south-america",
  "oceania",
] as const;

export type MapRegion = (typeof MAP_REGIONS)[number];

/**
 * Czy napis jest znanym regionem mapy. Osobno od `parseMapRegion`, bo tamten
 * ZAWSZE zwraca region (degraduje nieznany zapis do Europy), a tu potrzebna
 * jest odpowiedź "nie wiem, o czym mówisz" - używa jej bramka regionów, która
 * sprawdza powierzchnie autorskie W DRUGĄ STRONĘ: czy nie oferują regionu,
 * którego typ nie zna.
 */
export function isMapRegion(raw: unknown): raw is MapRegion {
  return typeof raw === "string" && (MAP_REGIONS as readonly string[]).includes(raw);
}

/**
 * Klucz słownikowy regionu. Identyfikatory są w kebab-case (jadą do treści
 * bloku), a klucze i18n w camelCase - konwersja jest CZĘŚCIĄ KONTRAKTU, tak
 * samo jak przy rodzajach wykresu (`bar-horizontal` -> `barHorizontal`).
 * Stoi tu, a nie w edytorze, żeby bramka i edytor liczyły ten sam klucz
 * z tej samej funkcji, zamiast dwa razy zgadywać tę samą regułę.
 */
export function mapRegionLabelKey(region: MapRegion): string {
  return region.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export interface MapDatum {
  /** ISO 3166-1 alpha-2 (wielkie litery). */
  id: string;
  /**
   * Wartość albo `null`, gdy autor jej nie podał.
   *
   * `null` JEST POPRAWNYM WPISEM, a nie brakiem wpisu, i wyłącznie w trybie
   * `manual`. Mapa polityczna - „ten blok, tamta grupa, ten status" - z
   * definicji nie ma liczby, a wymuszanie jej znaczyłoby, że autor musi
   * wpisać zmyśloną wartość, żeby pomalować kraj. Kraj z `null` rysuje się
   * swoją barwą, nie wchodzi do domeny rampy i pokazuje w tabeli kreskę.
   *
   * W trybie `ramp` wpis bez wartości nie ma czego zakodować, więc parser go
   * odrzuca - patrz `parseMapValues`.
   */
  value: number | null;
  /**
   * Kolor własny kraju (hex `#rrggbb`). CZYTANY WYŁĄCZNIE w trybie `manual` -
   * w trybie `ramp` wypełnienie liczy się z wartości i nic tu nie zagląda.
   * Pole zostaje w treści po przełączeniu trybu, więc powrót do palety
   * ręcznej odzyskuje wybory autora zamiast kasować je przy każdym kliknięciu.
   */
  color?: string;
}

/**
 * Skąd mapa bierze kolor kraju. TRYBY SIĘ WYKLUCZAJĄ i to jest decyzja,
 * a nie uproszczenie implementacji.
 *
 * `ramp`   - jedna barwa bazowa, nasycenie niesie WIELKOŚĆ: im większa
 *            wartość, tym bliżej barwy pełnej, im mniejsza - tym bliżej
 *            powierzchni. Kolor koduje wtedy liczbę.
 * `manual` - autor przypisuje barwę każdemu krajowi z osobna. Kolor koduje
 *            wtedy PRZYNALEŻNOŚĆ (blok, grupa, status), a nie wielkość.
 *
 * Mieszanka tych dwóch rzeczy w jednym rysunku nie ma legendy, którą dałoby
 * się uczciwie napisać: ta sama plama raz znaczyłaby „dużo", raz „należy do
 * grupy zielonej". Dlatego przełącznik, a nie dwa niezależne ustawienia.
 */
export const MAP_COLOR_MODES = ["ramp", "manual"] as const;
export type MapColorMode = (typeof MAP_COLOR_MODES)[number];

export function isMapColorMode(raw: unknown): raw is MapColorMode {
  return typeof raw === "string" && (MAP_COLOR_MODES as readonly string[]).includes(raw);
}

/**
 * Od ilu RÓŻNYCH barw w trybie ręcznym ostrzegamy autora.
 *
 * Nie jest to limit - autor ma prawo pomalować dwadzieścia krajów dwudziestoma
 * barwami i czasem ma po temu powód (mapa polityczna nie jest wykresem).
 * Jest to próg, od którego przestaje być prawdą, że czytelnik ODRÓŻNI wszystkie
 * plamy: z palety serii jednocześnie rozróżnialnych przy najczęstszych
 * wadach widzenia barw jest osiem. Powyżej ósmej barwy identyczność
 * przestaje wynikać z koloru i musi ją nieść podpis albo tabela - i dokładnie
 * to mówi ostrzeżenie.
 */
export const MAP_MANUAL_COLOR_WARN_AT = 8;

export interface DataMapConfig {
  region: MapRegion;
  title: string;
  description: string;
  unit: string;
  values: MapDatum[];
  showLegend: boolean;
  animate: boolean;
  source: string;
  colorMode: MapColorMode;
  /**
   * Barwa bazowa rampy (hex `#rrggbb`) albo pusty napis.
   *
   * PUSTY ZNACZY „MOTYW", a nie „biały": mapa jedzie wtedy parą tokenów
   * `--chart-seq-min/max` dokładnie jak dotąd, więc treść sprzed tej zmiany
   * wygląda po niej tak samo. Czytane WYŁĄCZNIE w trybie `ramp`.
   */
  rampColor: string;
}

/** Kształt statycznego zasobu geometrii z public/geo/*.json. */
export interface GeoAssetCountry {
  id: string;
  pl: string;
  en: string;
  d: string;
}

/**
 * Metadane projekcji + dopasowania osadzone w zasobie przez generator
 * (scripts/generate-geo-maps.ts). Pozwalają rzutować dowolne lon/lat
 * (korytarze, markery miast) na TEN SAM canvas co geometria krajów:
 * px = (raw - min) * scale + padding, gdzie raw = projekcja z odwróconym y.
 */
export interface GeoProjectionMeta {
  type: "laea" | "naturalEarth1";
  /** Środek LAEA - tylko dla type "laea". */
  lat0?: number;
  lon0?: number;
  minX: number;
  minY: number;
  scale: number;
  padding: number;
}

export interface GeoAsset {
  v: 1;
  license: string;
  viewBox: string;
  /** Opcjonalne (starsze zcache'owane kopie zasobu mogą go nie mieć). */
  proj?: GeoProjectionMeta;
  countries: GeoAssetCountry[];
}

/**
 * Adres zasobu geometrii per region. Wersja siedzi W NAZWIE PLIKU, więc zasób
 * nigdy nie twardnieje w cache'u - patrz `staleTime: Infinity` w `geoQuery.ts`.
 * Świat jedzie na 110m (mniej szczegółu wystarczy przy tej skali i oszczędza
 * setki kilobajtów), kontynenty na 50m.
 *
 * DLACZEGO EUROPA I ŚWIAT SĄ NA `.v2.`, A RESZTA NA `.v1.`. Numer w nazwie
 * jest JEDYNYM mechanizmem unieważnienia i działa tylko wtedy, gdy zmiana
 * TREŚCI pociąga zmianę NAZWY. Te dwa zasoby przeszły na inny upraszczacz
 * geometrii (Douglas-Peucker) i odzyskały Watykan, czyli zmieniły się co do
 * bajtu; zostawienie ich pod `.v1.` znaczyłoby, że przeglądarka albo CDN
 * z zapamiętaną kopią dalej serwuje STARĄ Europę - bez Watykanu, którego ta
 * zmiana miała przywrócić. Pięć nowych kontynentów rusza od `.v1.`, bo pod
 * tymi nazwami nigdy nic nie leżało. Reguła na przyszłość: zmieniasz treść
 * zasobu - podbijasz numer w nazwie; dokładasz nowy - zaczynasz od `.v1.`.
 */
export const GEO_ASSET_URL: Record<MapRegion, string> = {
  europe: "/geo/europe-50m.v2.json",
  world: "/geo/world-110m.v2.json",
  africa: "/geo/africa-50m.v1.json",
  asia: "/geo/asia-50m.v1.json",
  "north-america": "/geo/north-america-50m.v1.json",
  "south-america": "/geo/south-america-50m.v1.json",
  oceania: "/geo/oceania-50m.v1.json",
};
