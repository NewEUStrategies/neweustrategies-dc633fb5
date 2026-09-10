// Zasoby i18n silnika wykresów (src/components/charts) - rama karty, legenda,
// tabela danych, podpis uczciwościowy, prognoza, wodospad i tooltip
// objaśniający wskaźnik.
//
// DLACZEGO NAKŁADKA, A NIE LOKALNA MAPA `{ pl, en }`. Silnik wykresów trzymał
// napisy w plikowych stałych `const L = { pl: {...}, en: {...} }`. Skaner
// dwujęzycznego tekstu tego wzorca nie łapie (celuje w ternary i pomocniki
// bliźniacze), więc dług był niewidoczny - ale to nadal był dług: tekst
// istniał wyłącznie w kodzie, bramka parytetu PL/EN nie miała czego
// porównywać, a trzeci język wymagałby dotknięcia sześciu plików silnika
// zamiast jednego słownika.
//
// JĘZYK JEDZIE PROPSEM, NIE Z SINGLETONA. Wszystkie klucze czyta się przez
// `t(klucz, { lng: lang })`, gdzie `lang` przychodzi propsem ze ścieżki URL.
// Strony publiczne są cache'owane na brzegu sieci, więc odczyt z globalnego
// `i18n.language` mógłby zserwować polski tekst pod angielskim adresem.
import i18n from "@/lib/i18n";

const pl = {
  charts: {
    frame: {
      showData: "Pokaż dane",
      hideData: "Ukryj dane",
      dataTable: "Dane wykresu",
      category: "Kategoria",
      value: "Wartość",
      share: "Udział",
      total: "Suma",
      empty: "Brak danych wykresu.",
      other: "Pozostałe",
      missing: "brak danych",
    },
    pie: {
      // Tabela obok pierścienia zastępuje legendę z próbkami: nazwa, udział
      // i wartość bezwzględna w jednym wierszu, w tej samej kolejności co łuki.
      keyTable: "Klucz i wartości",
      // Suma kontrolna udziałów - ta sama reguła co w mostku. Liczona na
      // liczbach ZAOKRĄGLONYCH, czyli na tych, które czytelnik widzi.
      shareSumFailed:
        "Udziały podane w danych sumują się do {{sum}}, a nie do 100%. Tarcza przeskalowuje je do pełnej całości, więc liczba na łuku jest inna niż liczba w tabeli - sprawdź, czy nie brakuje kategorii albo czy dwie się nie nakładają.",
    },
    caption: {
      // Podpis uczciwościowy. Jednostka, n, źródło i data danych są osobnymi
      // polami, bo wykres bez nich wygląda tak samo, a znaczy co innego.
      unit: "Jednostka: {{unit}}",
      sampleSize: "n = {{count}}",
      sourceDate: "Dane na dzień: {{date}}",
      zeroBaselineWarning: "Oś wartości nie zaczyna się od zera",
      zeroBaselineWarningHint:
        "Skala jest ucięta, więc różnice wyglądają na większe niż są. Pełne liczby są w tabeli danych.",
    },
    notes: {
      // Trzy zdania, których kolejność się nie zmienia, żeby czytelnik uczył
      // się, gdzie czego szukać.
      shows: "Co pokazuje",
      surprising: "Co jest zaskakujące",
      hidden: "Czego nie pokazuje",
    },
    forecast: {
      label: "Prognoza",
      historyLabel: "Historia",
      band: "Pasmo niepewności ±{{pct}}%",
      // Alternatywa tekstowa dla strefy prognozy - to ona przenosi znaczenie
      // dla czytelnika, który nie widzi kreskowania linii.
      fromCategory: "Prognoza od: {{category}}",
      tableFlag: "prognoza",
    },
    histogram: {
      // ROZKŁAD WARTOŚCI. Wiersz z tabeli doboru formy: "Rozkład wartości ->
      // histogram, boxplot, beeswarm", a w kolumnie "Czego unikać" stoi
      // "średnia bez rozproszenia". Dlatego tabela pod wykresem niesie komplet
      // pozycyjny, a nie jedną liczbę.
      axis: {
        // Co niesie WYSOKOŚĆ słupka, i to nie jest kosmetyka podpisu: przy
        // przedziałach nierównych wysokość musi kodować GĘSTOŚĆ, bo liczebność
        // porównywana między przedziałami różnej szerokości kłamie - szeroki
        // przedział zbiera więcej obserwacji tylko dlatego, że jest szeroki.
        count: "Liczebność",
        density: "Liczebność na jednostkę",
        value: "Wartość",
      },
      // Liczba przedziałów jest WYBOREM, a każdy wybór na wykresie ma być
      // nazwany - inaczej czytelnik nie wie, czy szczyt jest w danych, czy
      // w doborze krawędzi.
      rule: {
        label: "Przedziały: {{rule}}, {{count}}",
        "freedman-diaconis": "reguła Freedmana-Diaconisa",
        sturges: "reguła Sturgesa",
        "explicit-edges": "krawędzie podane przez autora",
        "explicit-count": "liczba przedziałów podana przez autora",
        degenerate: "brak rozproszenia",
        none: "brak obserwacji",
      },
      advice: {
        tooFew:
          "Poniżej dwudziestu obserwacji kształt histogramu jest funkcją położenia krawędzi, nie rozkładu. Beeswarm albo wykres punktowy pokaże każdą obserwację i nie wymyśli szczytu.",
        noSpread:
          "Wszystkie obserwacje mają jedną wartość, więc rozkładu nie ma. Jedno zdanie w tekście mówi to samo bez rysunku.",
        tooCoarse:
          "Cały zakres zmieścił się w jednym przedziale, więc rysunek pokazuje słupek \u201Ewszystko\u201D. Podaj krawędzie albo liczbę przedziałów.",
        clamped:
          "Sufit przyciął liczbę przedziałów, więc rozdzielczość rozkładu jest ograniczona rysunkiem, a nie danymi. Przy tak długim ogonie czytelniejszy jest boxplot albo odcięcie wyrzutków NAZWANE w podpisie.",
      },
      table: {
        bin: "Przedział",
        count: "Liczebność",
        share: "Udział",
        density: "Liczebność na jednostkę",
        members: "Obserwacje",
        total: "Razem",
        // Nagłówek bloku statystyk pozycyjnych pod tabelą przedziałów.
        summary: "Statystyki pozycyjne",
      },
      summary: {
        n: "Obserwacje",
        min: "Minimum",
        q1: "Kwartyl 1",
        median: "Mediana",
        q3: "Kwartyl 3",
        max: "Maksimum",
        mean: "Średnia",
        iqr: "Rozstęp międzykwartylowy",
        missing: "Pominięte luki",
      },
      honesty: {
        // Każdy z tych komunikatów opisuje defekt DANYCH, nie formy - dlatego
        // stoi obok rysunku, a nie w poradach dla autora.
        outOfRange:
          "{{count}} obserwacji nie mieści się między pierwszą i ostatnią podaną krawędzią, więc nie ma ich na rysunku. Histogram zawyża wtedy udział wszystkiego, co pokazał.",
        checksumFailed:
          "Suma liczebności przedziałów ({{sum}}) nie zgadza się z liczbą obserwacji ({{count}}) - część danych nie trafiła na rysunek.",
        binWidthFailed:
          "Wśród podanych krawędzi są dwie równe albo nieuporządkowane, więc jeden z przedziałów ma zerową szerokość i nie da się go narysować.",
        declaredSampleFailed:
          "W podpisie stoi n = {{declared}}, a w danych jest {{actual}} obserwacji.",
        ignoredSeries:
          "Histogram czyta JEDNĄ serię; pozostałe {{count}} zostały pominięte. Rozkłady dwóch serii porównuje się dwoma panelami o wspólnej skali, nie jednym rysunkiem.",
      },
    },
    waterfall: {
      start: "Stan początkowy",
      end: "Stan końcowy",
      total: "Suma zmian",
      increase: "Wzrost",
      decrease: "Spadek",
      // TRZECI KIERUNEK, nie ozdoba. Model mostka zwraca `direction: "flat"`
      // dla składnika o wkładzie DOKŁADNIE zerowym, a render nazywał go
      // wzrostem (bo sprawdzał tylko `=== "down"`). Składnik, który nic nie
      // zmienił, nie jest wzrostem o zero - jest brakiem zmiany, i w mostku
      // dekompozycji zmiany marży to jest osobna informacja: pozycja, która
      // się nie ruszyła, tłumaczy, czego NIE trzeba szukać.
      flat: "Bez zmiany",
      // Mostek, którego składniki nie sumują się do różnicy, jest BŁĘDEM -
      // dlatego suma kontrolna jest liczona programowo i wypisywana wprost.
      checksumOk: "Suma kontrolna zgodna",
      checksumFailed:
        "Suma składników ({{sum}}) nie zgadza się z różnicą stanów ({{delta}}) - mostek jest niekompletny.",
    },
    series: {
      // Kreskowanie serii poza zestawem bezpiecznym dla daltonizmu.
      patternHint: "seria oznaczona kreskowaniem",
    },
    metric: {
      open: "Wyjaśnij wskaźnik {{name}}",
      close: "Zamknij wyjaśnienie",
      formula: "Wzór",
      measures: "Mierzy",
      reading: "Czytanie",
      levers: "Dźwignie",
      caution: "Uwaga",
    },
    a11y: {
      chart: "Wykres: {{title}}",
      chartUntitled: "Wykres",
      slice: "{{label}}: {{value}} ({{share}})",
      keyboardHint: "Strzałkami przesuwasz aktywną kategorię, Escape czyści zaznaczenie.",
    },
    editor: {
      // Ostrzeżenia dyscypliny - nie blokują zapisu, mówią, co się psuje.
      tooManySeries:
        "Powyżej {{max}} kolorów kategorialnych paleta przestaje być rozdzielna dla daltonizmu. Pogrupuj serie albo podziel wykres na small multiples.",
      tooManySlices:
        "Tarcza powyżej {{max}} kategorii koduje kątem i powierzchnią, czyli najsłabszymi kanałami. Nadmiar zwija się w jeden wycinek zbiorczy - rozważ słupki poziome.",
      // TRZY GRANICE PIERŚCIENIA. Wszystkie policzalne, więc nie ma sensu
      // liczyć na czujność autora - ale żadna nie blokuje zapisu, bo każda ma
      // wyjątki (np. dwa segmenty jako celowo minimalna ilustracja udziału).
      pieTooFewSlices:
        "Pierścień z dwoma albo trzema segmentami to koło z dziurą - miernik albo pojedynczy słupek 100% mówi to samo bez pytania czytelnika o kąt.",
      pieClosePercentages:
        "Udziały różnią się o mniej niż {{pp}} punkty procentowe, więc pierścień pokaże je jako identyczne. Do porównania weź słupki poziome - długość jest najwyżej w hierarchii percepcyjnej.",
      signClashesWithTerracotta:
        "Wykres koduje znak czerwienią, więc terakota (slot 6) nie może być na nim kategorią.",
      forecastWithoutBand:
        "Prognoza bez pasma niepewności sugeruje pewność, której nie ma. Podaj szerokość pasma.",
      smoothingWithoutPoints:
        "Wygładzona linia bez widocznych punktów obserwacji nie mówi, gdzie kończą się dane, a gdzie zaczyna interpolacja.",
      missingNotes:
        "Podpis bez zdania „czego nie pokazuje” zmienia wykres analityczny w ilustrację.",
    },
  },
};

const en = {
  charts: {
    frame: {
      showData: "Show data",
      hideData: "Hide data",
      dataTable: "Chart data",
      category: "Category",
      value: "Value",
      share: "Share",
      total: "Total",
      empty: "No chart data.",
      other: "Other",
      missing: "no data",
    },
    pie: {
      keyTable: "Key and values",
      shareSumFailed:
        "The shares given in the data add up to {{sum}}, not 100%. The ring rescales them to a full whole, so the number on the arc differs from the number in the table - check for a missing category or two that overlap.",
    },
    caption: {
      unit: "Unit: {{unit}}",
      sampleSize: "n = {{count}}",
      sourceDate: "Data as of: {{date}}",
      zeroBaselineWarning: "The value axis does not start at zero",
      zeroBaselineWarningHint:
        "The scale is truncated, so differences look larger than they are. Full figures are in the data table.",
    },
    notes: {
      shows: "What it shows",
      surprising: "What is surprising",
      hidden: "What it does not show",
    },
    forecast: {
      label: "Forecast",
      historyLabel: "History",
      band: "Uncertainty band ±{{pct}}%",
      fromCategory: "Forecast from: {{category}}",
      tableFlag: "forecast",
    },
    histogram: {
      axis: {
        count: "Count",
        density: "Count per unit",
        value: "Value",
      },
      rule: {
        label: "Bins: {{rule}}, {{count}}",
        "freedman-diaconis": "Freedman-Diaconis rule",
        sturges: "Sturges rule",
        "explicit-edges": "edges given by the author",
        "explicit-count": "bin count given by the author",
        degenerate: "no spread",
        none: "no observations",
      },
      advice: {
        tooFew:
          "Below twenty observations the shape of a histogram is a function of where the edges fall, not of the distribution. A beeswarm or a scatter plot shows every observation and invents no peak.",
        noSpread:
          "Every observation has the same value, so there is no distribution. One sentence in the text says as much without a chart.",
        tooCoarse:
          "The whole range fits in a single bin, so the chart shows an \u201Ceverything\u201D bar. Provide edges or a bin count.",
        clamped:
          "The ceiling clamped the bin count, so the resolution of the distribution is limited by the chart rather than by the data. With a tail this long a boxplot reads better, or trim the outliers and SAY SO in the caption.",
      },
      table: {
        bin: "Bin",
        count: "Count",
        share: "Share",
        density: "Count per unit",
        members: "Observations",
        total: "Total",
        summary: "Positional statistics",
      },
      summary: {
        n: "Observations",
        min: "Minimum",
        q1: "1st quartile",
        median: "Median",
        q3: "3rd quartile",
        max: "Maximum",
        mean: "Mean",
        iqr: "Interquartile range",
        missing: "Skipped gaps",
      },
      honesty: {
        outOfRange:
          "{{count}} observations fall outside the first and last edge given, so they are not on the chart. The histogram then overstates the share of everything it does show.",
        checksumFailed:
          "Bin counts add up to {{sum}}, not to the {{count}} observations in the data - some of it never reached the chart.",
        binWidthFailed:
          "Two of the edges given are equal or out of order, so one bin has zero width and cannot be drawn.",
        declaredSampleFailed:
          "The caption says n = {{declared}}, the data holds {{actual}} observations.",
        ignoredSeries:
          "A histogram reads ONE series; the remaining {{count}} were skipped. Two distributions are compared with two panels on a shared scale, not with one chart.",
      },
    },
    waterfall: {
      start: "Opening value",
      end: "Closing value",
      total: "Net change",
      increase: "Increase",
      decrease: "Decrease",
      flat: "No change",
      checksumOk: "Checksum matches",
      checksumFailed:
        "The components ({{sum}}) do not add up to the change between states ({{delta}}) - the bridge is incomplete.",
    },
    series: {
      patternHint: "series marked with a dashed stroke",
    },
    metric: {
      open: "Explain the {{name}} metric",
      close: "Close the explanation",
      formula: "Formula",
      measures: "Measures",
      reading: "Reading",
      levers: "Levers",
      caution: "Caution",
    },
    a11y: {
      chart: "Chart: {{title}}",
      chartUntitled: "Chart",
      slice: "{{label}}: {{value}} ({{share}})",
      keyboardHint: "Arrow keys move the active category, Escape clears the selection.",
    },
    editor: {
      tooManySeries:
        "Above {{max}} categorical colours the palette stops being separable for colour-blind readers. Group the series or split the chart into small multiples.",
      tooManySlices:
        "A pie above {{max}} categories encodes with angle and area, the weakest channels. The overflow folds into one aggregate slice - consider sorted horizontal bars.",
      pieTooFewSlices:
        "A ring with two or three segments is a circle with a hole - a meter or a single 100% bar says the same without asking the reader to judge an angle.",
      pieClosePercentages:
        "The shares differ by less than {{pp}} percentage points, so the ring will render them as identical. Use horizontal bars for the comparison - length is highest in the perceptual hierarchy.",
      signClashesWithTerracotta:
        "This chart encodes sign with red, so terracotta (slot 6) cannot also be a category on it.",
      forecastWithoutBand:
        "A forecast without an uncertainty band implies a certainty that is not there. Set the band width.",
      smoothingWithoutPoints:
        "A smoothed line without visible observation points does not say where the data ends and interpolation begins.",
      missingNotes:
        "A caption without the “what it does not show” sentence turns an analytical chart into an illustration.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** A live binding lets the route splitter keep registration with its view. */
export function ensureI18n(): void {}
