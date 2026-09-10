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
      // OBSERWACJE O TYM RYSUNKU, nie zalecenia dla autora. Ten sam podział,
      // co w pozostałych rodzajach: „kształt zależy od położenia krawędzi"
      // czytelnik może z rysunku sprawdzić, a „weź beeswarma" jest
      // instrukcją, której nie wykona - i dlatego stoi w nakładce edytora.
      reading: {
        tooFew:
          "Obserwacji jest mniej niż {{min}}, więc kształt histogramu zależy od położenia krawędzi tak samo jak od rozkładu.",
        noSpread:
          "Wszystkie obserwacje mają jedną wartość, więc rozkładu nie ma - rysunek pokazuje jeden słupek.",
        tooCoarse:
          "Cały zakres zmieścił się w jednym przedziale, więc słupek mówi \u201Ewszystko\u201D i nie pokazuje kształtu.",
        clamped:
          "Liczbę przedziałów przyciął sufit rysunku ({{max}}), więc rozdzielczość rozkładu jest ograniczona rysunkiem, a nie danymi.",
      },
    },
    boxplot: {
      // ROZKŁAD WARTOŚCI, wariant podsumowujący. Ten sam wiersz tabeli doboru
      // formy co histogram i beeswarm; kolumna "czego unikać" mówi: średnia
      // bez rozproszenia. Boxplot jest odpowiedzią na to wprost - pokazuje
      // pięć liczb pozycyjnych zamiast jednej.
      axis: { value: "Wartość", group: "Grupa" },
      table: {
        label: "Grupa",
        n: "Obserwacje",
        min: "Minimum",
        whiskerLow: "Wąs dolny",
        q1: "Kwartyl 1",
        median: "Mediana",
        q3: "Kwartyl 3",
        whiskerHigh: "Wąs górny",
        max: "Maksimum",
        iqr: "Rozstęp międzykwartylowy",
        outliers: "Obserwacje odstające",
      },
      tooltip: {
        median: "Mediana",
        quartiles: "Kwartyle",
        whiskers: "Wąsy",
        outliers: "Odstające",
        n: "n",
      },
      honesty: {
        // Podział na wąsy i obserwacje odstające jest ROZŁĄCZNY i wyczerpujący
        // z definicji reguły 1,5 IQR. Gdy przestaje być, znaczy to, że któraś
        // obserwacja wypadła z rysunku albo została policzona dwa razy.
        outlierPartitionOk:
          "Podział obserwacji na zasięg wąsów i obserwacje odstające nie domyka się do liczby obserwacji w grupie - część danych nie jest na rysunku.",
        declaredSampleSizeOk:
          "W podpisie stoi n = {{declared}}, a w danych jest {{actual}} obserwacji.",
      },
      reading: {
        dotsBetter: "Próba jest tak mała, że pudełko podsumowuje prawie każdą obserwację osobno.",
        tiesDominant:
          "Powtórzona wartość zajmuje ponad połowę obserwacji, więc kwartyle zbiegają się w jednym punkcie i pudełko jest kreską.",
        singleGroup: "Na wykresie jest jedna grupa, więc nie ma tu porównania między grupami.",
      },
    },
    beeswarm: {
      // ROZKŁAD WARTOŚCI z każdą obserwacją widoczną. Beeswarm nie ukrywa
      // niczego za podsumowaniem, i to jest cała jego przewaga nad boxplotem.
      axis: { value: "Wartość", group: "Grupa" },
      table: { label: "Obserwacja", value: "Wartość", group: "Grupa" },
      summary: {
        n: "Obserwacje",
        min: "Minimum",
        q1: "Kwartyl 1",
        median: "Mediana",
        q3: "Kwartyl 3",
        max: "Maksimum",
        mean: "Średnia",
        iqr: "Rozstęp międzykwartylowy",
      },
      honesty: {
        pointCountOk:
          "Liczba plamek na rysunku ({{shown}}) nie zgadza się z liczbą obserwacji w danych ({{total}}).",
        spreadOk: "W danych nie ma rozproszenia, więc rój nie pokazuje rozkładu.",
        declaredSampleSizeOk:
          "W podpisie stoi n = {{declared}}, a w danych jest {{actual}} obserwacji.",
      },
      reading: {
        tooMany:
          "Obserwacji jest tyle, że plamki nachodzą na siebie niezależnie od rozsunięcia - gęstość na rysunku nie odpowiada gęstości w danych.",
        noSpread: "Wszystkie obserwacje mają jedną wartość, więc rój jest jedną kolumną punktów.",
        doesNotFit:
          "Rozsunięcie nie mieści się w wysokości pola, więc część plamek siedzi na sobie.",
        truncated:
          "Rysunek pokazuje {{shown}} z {{total}} obserwacji; pełny zbiór jest w tabeli danych.",
      },
    },
    scatter: {
      // ZALEŻNOŚĆ DWÓCH ZMIENNYCH. Kolumna "czego unikać" ma tu jedno hasło:
      // linia łącząca punkty. Odcinek trendu jest czymś innym i wolno go
      // rysować, ale wyłącznie w zakresie obserwacji.
      axis: { x: "Zmienna X", y: "Zmienna Y" },
      table: {
        label: "Obserwacja",
        series: "Seria",
        x: "X",
        y: "Y",
        dropped: "pominięta",
        overplotted: "plamka dzielona",
      },
      trend: {
        label: "Linia trendu",
        r2: "R² = {{value}}",
        n: "n = {{count}}",
        method: "Metoda najmniejszych kwadratów",
        // Zdanie obowiązkowe wszędzie, gdzie trend jest rysowany. Nachylenie
        // opisuje WSPÓŁZMIENNOŚĆ, a czytelnik domyślnie czyta z niego
        // przyczynę - i to nie jest jego wina, tylko właściwość formy.
        notCausal: "Współzmienność, nie przyczyna: linia nie mówi, co na co działa.",
      },
      honesty: {
        pairsCompleteOk:
          "{{count}} par ma tylko jedną współrzędną, więc nie ma ich na rysunku. Są wypisane w tabeli danych z powodem pominięcia.",
        enoughForTrendOk:
          "Linia trendu wymaga co najmniej {{min}} obserwacji - przy mniejszej liczbie nie jest rysowana.",
        xVarianceOk: "Zmienna X nie ma rozproszenia, więc regresja nie ma nachylenia.",
        trendMeaningfulOk: "R² = {{r2}}: linia jest, ale nie wyjaśnia zmienności Y.",
        trendWithinDataOk:
          "Odcinek trendu wychodzi poza zakres obserwacji, czyli twierdzi o obszarze bez ani jednego pomiaru.",
        pointsInDomainOk: "Część punktów wypada poza zakres osi, więc nie widać ich na rysunku.",
        xIsSecondVariableOk:
          "Na osi X stoi pozycja w szeregu, a nie druga zmienna - podaj drugą serię, żeby to był wykres zależności.",
        overplotOk: "Punkty dzielą plamki, więc gęstość chmury jest myląca.",
        declaredSampleSizeOk: "W podpisie stoi n = {{declared}}, a w danych jest {{actual}} par.",
      },
      reading: {
        tooFewPoints:
          "Obserwacji jest mniej niż {{min}}, więc nachylenie linii trendu zmienia dowolny pojedynczy punkt.",
        noXVariance: "Zmienna X ma jedną wartość, więc wszystkie punkty stoją w jednej kolumnie.",
        syntheticX:
          "Na osi X stoi pozycja w szeregu, nie druga zmienna - to nie jest wykres zależności.",
        trendShowsNothing: "R2 poniżej {{min}}: linia trendu nie wyjaśnia zmienności Y.",
        overplotted:
          "Ponad {{share}} punktów dzieli plamkę z innym, więc chmura wygląda na rzadszą, niż jest.",
      },
    },
    heatmap: {
      // WRAŻLIWOŚĆ NA DWA PARAMETRY. Zamiennik tabeli liczb: czytelnik ma
      // zobaczyć KSZTAŁT wrażliwości, a nie odczytywać sto komórek po kolei.
      axis: { rows: "Wiersze", columns: "Kolumny" },
      legend: {
        title: "Skala",
        from: "od {{value}}",
        to: "do {{value}}",
        empty: "brak danych",
      },
      table: {
        row: "Wiersz",
        column: "Kolumna",
        value: "Wartość",
        margin: "Brzeg wiersza",
        count: "Komórki",
        min: "Minimum",
        max: "Maksimum",
        mean: "Średnia",
        range: "Rozstęp",
      },
      // Który parametr rusza wynikiem mocniej - odpowiedź, po którą czytelnik
      // przychodzi do macierzy wrażliwości.
      dominant: {
        rows: "Wynikiem mocniej rusza parametr z wierszy.",
        columns: "Wynikiem mocniej rusza parametr z kolumn.",
        tie: "Oba parametry ruszają wynikiem podobnie mocno.",
      },
      honesty: {
        uniqueOk:
          "Etykiety wiersza albo kolumny powtarzają się, więc dwie komórki mają ten sam adres.",
        namedOk:
          "Część wierszy albo kolumn nie ma nazwy, więc nie da się odczytać, czego dotyczy komórka.",
        orderOk:
          "Siatka parametrów ma nierówne odstępy - szerokość komórki kłamie o fragmencie zakresu.",
        matrixShapeOk: "Wiersze mają różną liczbę komórek, więc macierz nie jest prostokątna.",
        divergingJustifiedOk:
          "Skala dywergentna została użyta na danych, które nie przechodzą przez punkt neutralny.",
        signEncodedOk:
          "Dane przechodzą przez zero, a skala nie stawia w tym miejscu punktu neutralnego - najważniejsza granica w macierzy jest niewidoczna.",
        inDomainOk: "Część wartości wypada poza zakres skali, więc kolor komórki jest przycięty.",
        spreadOk: "Wszystkie wartości są jednakowe, więc mapa nie pokazuje wrażliwości.",
        inGridOk: "Część wartości nie trafiła w żadną komórkę siatki.",
        declaredSampleOk:
          "W podpisie stoi n = {{declared}}, a w macierzy jest {{actual}} wartości.",
      },
      reading: {
        notMatrix:
          "Dane nie mają kształtu macierzy, więc rysunek nie pokazuje wrażliwości na dwa parametry.",
        tooManyCells: "Komórek jest ponad {{max}}, więc żadnej pojedynczej nie da się odczytać.",
        sparse: "Ponad {{share}} komórek jest puste, więc rysunek pokazuje głównie luki.",
        noSpread: "Wszystkie wartości są jednakowe, więc mapa jest jednolitą płaszczyzną.",
        divergingDowngraded:
          "Dane nie przechodzą przez punkt neutralny, więc skala jest sekwencyjna, nie dywergentna.",
        unorderedAxis:
          "Siatka parametrów ma nierówne odstępy, więc szerokość komórki nie odpowiada fragmentowi zakresu, który reprezentuje.",
      },
    },
    tornado: {
      // WRAŻLIWOŚĆ NA WIELE PARAMETRÓW. Zamiennik serii osobnych wykresów.
      // Sortowanie po rozpiętości jest CZĘŚCIĄ FORMY: czytelnik odczytuje
      // hierarchię wrażliwości z góry na dół, stąd kształt leja i stąd nazwa.
      axis: { value: "Wynik", parameter: "Parametr" },
      base: { label: "Wynik bazowy: {{value}}" },
      legend: { low: "Wartość niska parametru", high: "Wartość wysoka parametru" },
      table: {
        parameter: "Parametr",
        low: "Wynik przy niskiej",
        high: "Wynik przy wysokiej",
        lowDelta: "Odchylenie w dół",
        highDelta: "Odchylenie w górę",
        swing: "Rozpiętość",
        span: "Zasięg",
        spanShare: "Udział w największej rozpiętości",
      },
      note: {
        // Parametr odwrotny: wysoka wartość daje NIŻSZY wynik. Ciche
        // zamienienie końców pozbawiłoby czytelnika tej informacji, a jest
        // ona zwykle najciekawsza w całej analizie wrażliwości.
        inverted: "parametr odwrotny: wysoka wartość obniża wynik",
        zeroSpan: "rozpiętość zerowa: parametr nie rusza wynikiem",
        baseOutside: "wynik bazowy leży poza przedziałem niska-wysoka",
      },
      reading: {
        // BEZ BAZY RYSUNEK JEST PUSTY, i właśnie dlatego ta obserwacja jest
        // dla czytelnika. Pierwsza wersja podziału zostawiała `noBase` bez
        // wersji publicznej z uzasadnieniem „czytelnik nie widzi pasków, więc
        // nie ma o czym go informować" - a czytelnik widzi etykiety wierszy
        // nad pustym polem i nie wie, czy to awaria. Zalecenie („podaj
        // wartość bazową") zostaje w nakładce edytora.
        noBase:
          "Wykres nie ma wyniku bazowego, więc paski nie mają od czego się odchylać i rysunek ich nie pokazuje; liczby są w tabeli danych.",
        singleParameter: "Na wykresie jest jeden parametr, więc nie ma tu hierarchii wrażliwości.",
        flatRanking: "Rozpiętości są prawie równe, więc kolejność pasków nie niesie informacji.",
        tooManyRows:
          "Parametrów jest ponad {{max}}, więc paski są cieńsze od odstępu i ranking przestaje być czytelny.",
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
      reading: {
        tooFew:
          "There are fewer than {{min}} observations, so the shape of the histogram depends on where the edges fall as much as on the distribution.",
        noSpread:
          "All observations share one value, so there is no distribution - the chart shows a single bar.",
        tooCoarse:
          "The whole range fits in one bin, so the bar says \u201Ceverything\u201D and shows no shape.",
        clamped:
          "The bin count was clipped by the chart ceiling ({{max}}), so the resolution of the distribution is limited by the drawing, not by the data.",
      },
    },
    boxplot: {
      axis: { value: "Value", group: "Group" },
      table: {
        label: "Group",
        n: "Observations",
        min: "Minimum",
        whiskerLow: "Lower whisker",
        q1: "1st quartile",
        median: "Median",
        q3: "3rd quartile",
        whiskerHigh: "Upper whisker",
        max: "Maximum",
        iqr: "Interquartile range",
        outliers: "Outliers",
      },
      tooltip: {
        median: "Median",
        quartiles: "Quartiles",
        whiskers: "Whiskers",
        outliers: "Outliers",
        n: "n",
      },
      honesty: {
        outlierPartitionOk:
          "Splitting the observations into whisker range and outliers does not add up to the group size - part of the data is not on the chart.",
        declaredSampleSizeOk:
          "The caption says n = {{declared}}, the data holds {{actual}} observations.",
      },
      reading: {
        dotsBetter:
          "The sample is small enough that the box summarises almost every observation separately.",
        tiesDominant:
          "A repeated value covers more than half the observations, so the quartiles collapse to one point and the box is a line.",
        singleGroup:
          "There is one group on the chart, so there is no between-group comparison here.",
      },
    },
    beeswarm: {
      axis: { value: "Value", group: "Group" },
      table: { label: "Observation", value: "Value", group: "Group" },
      summary: {
        n: "Observations",
        min: "Minimum",
        q1: "1st quartile",
        median: "Median",
        q3: "3rd quartile",
        max: "Maximum",
        mean: "Mean",
        iqr: "Interquartile range",
      },
      honesty: {
        pointCountOk:
          "The number of dots on the chart ({{shown}}) does not match the number of observations in the data ({{total}}).",
        spreadOk: "There is no spread in the data, so the swarm shows no distribution.",
        declaredSampleSizeOk:
          "The caption says n = {{declared}}, the data holds {{actual}} observations.",
      },
      reading: {
        tooMany:
          "There are so many observations that the dots overlap whatever the offset - density on the chart does not match density in the data.",
        noSpread: "Every observation has the same value, so the swarm is one column of dots.",
        doesNotFit:
          "The offset does not fit the plot height, so some dots sit on top of each other.",
        truncated:
          "The chart shows {{shown}} of {{total}} observations; the full set is in the data table.",
      },
    },
    scatter: {
      axis: { x: "Variable X", y: "Variable Y" },
      table: {
        label: "Observation",
        series: "Series",
        x: "X",
        y: "Y",
        dropped: "dropped",
        overplotted: "shared marker",
      },
      trend: {
        label: "Trend line",
        r2: "R² = {{value}}",
        n: "n = {{count}}",
        method: "Ordinary least squares",
        notCausal: "Covariation, not cause: the line does not say what acts on what.",
      },
      honesty: {
        pairsCompleteOk:
          "{{count}} pairs have only one coordinate, so they are not on the chart. They are listed in the data table with the reason.",
        enoughForTrendOk:
          "A trend line needs at least {{min}} observations - below that it is not drawn.",
        xVarianceOk: "Variable X has no spread, so the regression has no slope.",
        trendMeaningfulOk:
          "R² = {{r2}}: the line is there, but it does not explain the variation in Y.",
        trendWithinDataOk:
          "The trend segment extends beyond the range of the observations, so it makes a claim about a region with no measurement at all.",
        pointsInDomainOk:
          "Some points fall outside the axis range, so they are not visible on the chart.",
        xIsSecondVariableOk:
          "The X axis carries position in the series, not a second variable - provide a second series to make this a relationship chart.",
        overplotOk: "Points share markers, so the density of the cloud is misleading.",
        declaredSampleSizeOk: "The caption says n = {{declared}}, the data holds {{actual}} pairs.",
      },
      reading: {
        tooFewPoints:
          "There are fewer than {{min}} observations, so any single point changes the slope of the trend line.",
        noXVariance: "Variable X has one value, so every point stands in one column.",
        syntheticX:
          "The X axis carries position in the series, not a second variable - this is not a relationship chart.",
        trendShowsNothing: "R2 below {{min}}: the trend line does not explain the variation in Y.",
        overplotted:
          "More than {{share}} of the points share a marker, so the cloud looks sparser than it is.",
      },
    },
    heatmap: {
      axis: { rows: "Rows", columns: "Columns" },
      legend: {
        title: "Scale",
        from: "from {{value}}",
        to: "to {{value}}",
        empty: "no data",
      },
      table: {
        row: "Row",
        column: "Column",
        value: "Value",
        margin: "Row margin",
        count: "Cells",
        min: "Minimum",
        max: "Maximum",
        mean: "Mean",
        range: "Range",
      },
      dominant: {
        rows: "The row parameter moves the outcome more.",
        columns: "The column parameter moves the outcome more.",
        tie: "Both parameters move the outcome about equally.",
      },
      honesty: {
        uniqueOk: "Row or column labels repeat, so two cells share one address.",
        namedOk: "Some rows or columns have no name, so it cannot be read what a cell refers to.",
        orderOk:
          "The parameter grid has uneven steps - cell width lies about the slice of the range.",
        matrixShapeOk: "Rows hold different numbers of cells, so the matrix is not rectangular.",
        divergingJustifiedOk:
          "A diverging scale was used on data that does not cross the neutral point.",
        signEncodedOk:
          "The data crosses zero and the scale puts no neutral point there - the most important boundary in the matrix is invisible.",
        inDomainOk: "Some values fall outside the scale range, so the cell colour is clipped.",
        spreadOk: "Every value is the same, so the map shows no sensitivity.",
        inGridOk: "Some values did not land in any cell of the grid.",
        declaredSampleOk: "The caption says n = {{declared}}, the matrix holds {{actual}} values.",
      },
      reading: {
        notMatrix:
          "The data is not matrix shaped, so the chart does not show sensitivity to two parameters.",
        tooManyCells: "There are more than {{max}} cells, so no single one can be read.",
        sparse: "More than {{share}} of the cells are empty, so the chart mostly shows gaps.",
        noSpread: "Every value is the same, so the map is a uniform field.",
        divergingDowngraded:
          "The data does not cross the neutral point, so the scale is sequential, not diverging.",
        unorderedAxis:
          "The parameter grid has uneven steps, so cell width does not match the slice of the range it stands for.",
      },
    },
    tornado: {
      axis: { value: "Outcome", parameter: "Parameter" },
      base: { label: "Base outcome: {{value}}" },
      legend: { low: "Parameter at its low value", high: "Parameter at its high value" },
      table: {
        parameter: "Parameter",
        low: "Outcome at low",
        high: "Outcome at high",
        lowDelta: "Deviation down",
        highDelta: "Deviation up",
        swing: "Swing",
        span: "Span",
        spanShare: "Share of the largest swing",
      },
      note: {
        inverted: "inverse parameter: the high value lowers the outcome",
        zeroSpan: "zero swing: the parameter does not move the outcome",
        baseOutside: "the base outcome lies outside the low-high interval",
      },
      reading: {
        noBase:
          "The chart has no baseline outcome, so the bars have nothing to deviate from and none are drawn; the numbers are in the data table.",
        singleParameter:
          "There is one parameter on the chart, so there is no hierarchy of sensitivity here.",
        flatRanking:
          "The swings are nearly equal, so the order of the bars carries no information.",
        tooManyRows:
          "There are more than {{max}} parameters, so the bars are thinner than the gap and the ranking stops being readable.",
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
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** A live binding lets the route splitter keep registration with its view. */
export function ensureI18n(): void {}
