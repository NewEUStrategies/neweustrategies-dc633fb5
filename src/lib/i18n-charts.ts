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
      advice: {
        dotsBetter:
          "Przy tak małej próbce pudełko podsumowuje prawie każdą obserwację osobno. Beeswarm pokaże je wszystkie i nie ukryje niczego za kwartylem.",
        tiesDominant:
          "Powtórzona wartość zajmuje ponad połowę obserwacji, więc kwartyle zbiegają się w jednym punkcie i pudełko robi się kreską. Histogram albo tabela liczebności powie o tych danych więcej.",
        singleGroup:
          "Jedna grupa nie ma z czym się porównać, a boxplot jest formą PORÓWNAWCZĄ. Do pojedynczego rozkładu czytelniejszy jest histogram albo beeswarm.",
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
      advice: {
        tooFew:
          "Przy tak małej liczbie obserwacji beeswarm jest formą NAJUCZCIWSZĄ - nie zamieniaj go na boxplot, bo pudełko z kilku punktów podsumowuje prawie każdy z nich osobno.",
        tooMany:
          "Powyżej {{max}} obserwacji plamki nachodzą na siebie niezależnie od rozsunięcia, więc gęstość na rysunku przestaje odpowiadać gęstości w danych. Histogram albo boxplot pokaże ten rozkład wierniej.",
        noSpread:
          "Wszystkie obserwacje mają jedną wartość, więc rozkładu nie ma - rój zwinie się w jedną kolumnę punktów.",
        doesNotFit:
          "Rozsunięcie prostopadłe nie mieści się w wysokości pola rysunku, więc część punktów siedziałaby na sobie. Zwiększ wysokość wykresu albo pogrupuj obserwacje.",
        truncated:
          "Rysunek pokazuje {{shown}} z {{total}} obserwacji - reszta nie zmieściła się w roju. Pełny zbiór jest w tabeli danych.",
      },
      honesty: {
        pointCountOk:
          "Liczba plamek na rysunku ({{shown}}) nie zgadza się z liczbą obserwacji w danych ({{total}}).",
        spreadOk: "W danych nie ma rozproszenia, więc rój nie pokazuje rozkładu.",
        declaredSampleSizeOk:
          "W podpisie stoi n = {{declared}}, a w danych jest {{actual}} obserwacji.",
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
      advice: {
        tooFewPoints:
          "Poniżej {{min}} obserwacji linia trendu jest linią przez szum - jej nachylenie zmienia dowolny pojedynczy punkt.",
        noXVariance:
          "Zmienna X ma jedną wartość, więc zależności nie ma czego opisywać - wszystkie punkty stoją w jednej kolumnie.",
        syntheticX:
          "Na osi X stoi POZYCJA W SZEREGU, nie druga zmienna, bo autor nie podał drugiej serii. To nie jest wykres zależności, tylko szereg rozrzucony w czasie.",
        trendShowsNothing:
          "R² poniżej {{min}} znaczy, że linia niczego nie wyjaśnia. Zostaw punkty i napisz, czego nie widać, zamiast rysować linię, która wygląda na wniosek.",
        overplotted:
          "Ponad {{share}} punktów dzieli plamkę z innym, więc chmura wygląda na rzadszą, niż jest. Zmniejsz znacznik, dodaj przezroczystość albo zagreguj.",
        lineBetter:
          "Obserwacje mają naturalny porządek w czasie, więc wykres liniowy pokaże przebieg, którego chmura punktów nie pokazuje.",
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
      advice: {
        notMatrix:
          "Dane nie mają kształtu macierzy: mapa ciepła potrzebuje co najmniej {{rows}} wierszy i {{columns}} kolumn. Przy jednym wymiarze czytelniejsze są posortowane słupki poziome.",
        tooManyCells:
          "Powyżej {{max}} komórek żadnej pojedynczej nie da się już odczytać. Zagreguj parametry albo pokaż wycinek macierzy.",
        sparse:
          "Ponad {{share}} komórek jest puste, więc rysunek pokazuje głównie luki. Tabela z brzegami wierszy powie o tych danych więcej.",
        noSpread:
          "Wszystkie wartości są jednakowe, więc mapa ciepła będzie jednolitą płaszczyzną - to informacja na jedno zdanie, nie na rysunek.",
        divergingDowngraded:
          "Skala dywergentna nie ma uzasadnienia, bo dane nie przechodzą przez punkt neutralny. Zeszła na sekwencyjną, żeby jasność rosła monotonicznie z wartością.",
        unorderedAxis:
          "Siatka parametrów ma nierówne odstępy, więc szerokość komórki nie odpowiada fragmentowi zakresu, który reprezentuje. Podaj równe kroki albo nazwij osie jako porządkowe, nie liczbowe.",
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
      advice: {
        noBase:
          "Bez wyniku bazowego wykres tornado nie istnieje - paski nie mają od czego się odchylać. Podaj wartość bazową jako pierwszą kategorię albo osobną serię.",
        singleParameter:
          "Jeden parametr nie tworzy hierarchii wrażliwości, a po nią przychodzi się do tornada. Przy jednym parametrze wystarczy zdanie z dwiema liczbami.",
        flatRanking:
          "Rozpiętości są prawie równe, więc kolejność pasków nie niesie informacji - a to ona jest treścią tej formy. Sprawdź, czy zakresy parametrów są porównywalne.",
        tooManyRows:
          "Powyżej {{max}} parametrów paski robią się cieńsze od odstępu i ranking przestaje być czytelny. Pokaż {{max}} najmocniejszych, a resztę wypisz w tabeli.",
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
      advice: {
        dotsBetter:
          "With a sample this small the box summarises almost every observation separately. A beeswarm shows them all and hides nothing behind a quartile.",
        tiesDominant:
          "A repeated value covers more than half the observations, so the quartiles collapse to one point and the box becomes a line. A histogram or a frequency table says more about this data.",
        singleGroup:
          "A single group has nothing to be compared against, and a boxplot is a COMPARATIVE form. For one distribution a histogram or a beeswarm reads better.",
      },
      honesty: {
        outlierPartitionOk:
          "Splitting the observations into whisker range and outliers does not add up to the group size - part of the data is not on the chart.",
        declaredSampleSizeOk:
          "The caption says n = {{declared}}, the data holds {{actual}} observations.",
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
      advice: {
        tooFew:
          "With this few observations a beeswarm is the MOST HONEST form - do not swap it for a boxplot, whose box would summarise almost every point separately.",
        tooMany:
          "Above {{max}} observations the dots overlap whatever the offset, so density on the chart stops matching density in the data. A histogram or a boxplot shows this distribution more faithfully.",
        noSpread:
          "Every observation has the same value, so there is no distribution - the swarm collapses into one column of dots.",
        doesNotFit:
          "The perpendicular offset does not fit the height of the plot, so some dots would sit on top of each other. Increase the chart height or group the observations.",
        truncated:
          "The chart shows {{shown}} of {{total}} observations - the rest did not fit in the swarm. The full set is in the data table.",
      },
      honesty: {
        pointCountOk:
          "The number of dots on the chart ({{shown}}) does not match the number of observations in the data ({{total}}).",
        spreadOk: "There is no spread in the data, so the swarm shows no distribution.",
        declaredSampleSizeOk:
          "The caption says n = {{declared}}, the data holds {{actual}} observations.",
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
      advice: {
        tooFewPoints:
          "Below {{min}} observations a trend line is a line through noise - any single point changes its slope.",
        noXVariance:
          "Variable X has one value, so there is no relationship to describe - every point stands in one column.",
        syntheticX:
          "The X axis carries POSITION IN THE SERIES, not a second variable, because the author gave only one. This is not a relationship chart, it is a series scattered over time.",
        trendShowsNothing:
          "An R² below {{min}} means the line explains nothing. Keep the points and write down what cannot be seen, rather than drawing a line that looks like a conclusion.",
        overplotted:
          "More than {{share}} of the points share a marker with another, so the cloud looks sparser than it is. Shrink the marker, add transparency, or aggregate.",
        lineBetter:
          "The observations have a natural order in time, so a line chart shows a course that a point cloud does not.",
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
      advice: {
        notMatrix:
          "The data is not matrix shaped: a heatmap needs at least {{rows}} rows and {{columns}} columns. With one dimension, sorted horizontal bars read better.",
        tooManyCells:
          "Above {{max}} cells no single one can be read any more. Aggregate the parameters or show a slice of the matrix.",
        sparse:
          "More than {{share}} of the cells are empty, so the chart mostly shows gaps. A table with row margins says more about this data.",
        noSpread:
          "Every value is the same, so the heatmap will be a uniform field - that is a one-sentence fact, not a chart.",
        divergingDowngraded:
          "A diverging scale is not justified, because the data does not cross the neutral point. It fell back to sequential so that lightness rises monotonically with value.",
        unorderedAxis:
          "The parameter grid has uneven steps, so cell width does not match the slice of the range it stands for. Provide equal steps, or name the axes as ordinal rather than numeric.",
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
      advice: {
        noBase:
          "Without a base outcome a tornado chart does not exist - the bars have nothing to deviate from. Provide the base value as the first category or as a separate series.",
        singleParameter:
          "One parameter builds no hierarchy of sensitivity, and that hierarchy is what a tornado is for. With one parameter a sentence with two numbers is enough.",
        flatRanking:
          "The swings are nearly equal, so the order of the bars carries no information - and that order is the content of this form. Check whether the parameter ranges are comparable.",
        tooManyRows:
          "Above {{max}} parameters the bars get thinner than the gap and the ranking stops being readable. Show the {{max}} strongest and list the rest in the table.",
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
