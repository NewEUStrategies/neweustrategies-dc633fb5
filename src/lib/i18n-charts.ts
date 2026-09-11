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
        outOfRange_one:
          "{{count}} obserwacja nie mieści się między pierwszą i ostatnią podaną krawędzią, więc nie ma jej na rysunku. Histogram zawyża wtedy udział wszystkiego, co pokazał.",
        outOfRange_few:
          "{{count}} obserwacje nie mieszczą się między pierwszą i ostatnią podaną krawędzią, więc nie ma ich na rysunku. Histogram zawyża wtedy udział wszystkiego, co pokazał.",
        outOfRange_many:
          "{{count}} obserwacji nie mieści się między pierwszą i ostatnią podaną krawędzią, więc nie ma ich na rysunku. Histogram zawyża wtedy udział wszystkiego, co pokazał.",
        outOfRange_other:
          "{{count}} obserwacji nie mieści się między pierwszą i ostatnią podaną krawędzią, więc nie ma ich na rysunku. Histogram zawyża wtedy udział wszystkiego, co pokazał.",
        checksumFailed:
          "Suma liczebności przedziałów ({{sum}}) nie zgadza się z liczbą obserwacji ({{count}}) - część danych nie trafiła na rysunek.",
        binWidthFailed:
          "Wśród podanych krawędzi są dwie równe albo nieuporządkowane, więc jeden z przedziałów ma zerową szerokość i nie da się go narysować.",
        declaredSampleFailed:
          "W podpisie stoi n = {{declared}}, a w danych jest {{actual}} obserwacji.",
        ignoredSeries_one:
          "Histogram czyta JEDNĄ serię; pozostałą pominięto. Rozkłady dwóch serii porównuje się dwoma panelami o wspólnej skali, nie jednym rysunkiem.",
        ignoredSeries_few:
          "Histogram czyta JEDNĄ serię; pozostałe {{count}} pominięto. Rozkłady dwóch serii porównuje się dwoma panelami o wspólnej skali, nie jednym rysunkiem.",
        ignoredSeries_many:
          "Histogram czyta JEDNĄ serię; pozostałych {{count}} pominięto. Rozkłady dwóch serii porównuje się dwoma panelami o wspólnej skali, nie jednym rysunkiem.",
        ignoredSeries_other:
          "Histogram czyta JEDNĄ serię; pozostałych {{count}} pominięto. Rozkłady dwóch serii porównuje się dwoma panelami o wspólnej skali, nie jednym rysunkiem.",
        // OSTATNI KOMUNIKAT, KTÓREGO MODEL NIE MIAŁ JAK POWIEDZIEĆ. Przy
        // krawędziach równych albo tak odległych, że szerokości przedziału nie
        // da się zapisać w podwójnej precyzji, model nie budował ANI JEDNEGO
        // przedziału - i milczał o tym dokładnie tak samo, jak milczy rysunek
        // bez defektu. Komunikat stoi PRZED obserwacją `reading.tooCoarse`, bo
        // tamta mówi „cały zakres zmieścił się w jednym przedziale", czyli
        // opisuje jeden słupek, a tu nie ma żadnego.
        binsBuiltFailed:
          "Z tych obserwacji nie dało się zbudować ani jednego przedziału, więc na rysunku nie ma żadnego słupka - krawędzie są albo równe, albo tak odległe, że szerokości przedziału nie da się zapisać.",
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
        // NAGŁÓWKI KOLUMN, nie zdania. Tabela odcinków trendu używała jako
        // nagłówków kluczy `trend.n` („n = {{count}}") i `trend.r2`
        // („R² = {{value}}"), czyli ZDAŃ Z WSTAWKĄ, której nagłówek nie ma
        // czym wypełnić - w nagłówku kolumny stała surowa klamra. Zdania
        // zostają tam, gdzie mają sens: przy odcinku na rysunku.
        n: "n",
        r2: "R²",
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
        pairsCompleteOk_one:
          "{{count}} para ma tylko jedną współrzędną, więc nie ma jej na rysunku. Jest wypisana w tabeli danych z powodem pominięcia.",
        pairsCompleteOk_few:
          "{{count}} pary mają tylko jedną współrzędną, więc nie ma ich na rysunku. Są wypisane w tabeli danych z powodem pominięcia.",
        pairsCompleteOk_many:
          "{{count}} par ma tylko jedną współrzędną, więc nie ma ich na rysunku. Są wypisane w tabeli danych z powodem pominięcia.",
        pairsCompleteOk_other:
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
        // TREŚĆ ZGODNA Z TYM, CO POLE SPRAWDZA. Wcześniej mówiła o NIERÓWNYCH
        // ODSTĘPACH, a model sprawdza MONOTONICZNOŚĆ etykiet liczbowych
        // (`rosnie || maleje`, od trzech etykiet). Oś 1, 2, 10, 100 ma odstępy
        // skrajnie nierówne i przechodziła orzeczenie, którego treść obiecywała
        // ją wykryć - czyli komunikat obiecywał sprawdzenie, którego nie ma.
        orderOk:
          "Etykiety liczbowe osi nie idą po kolei, więc sąsiedztwo komórek nie odpowiada sąsiedztwu wartości.",
        // Pole sprawdza MINIMUM 2x2 niepustych wierszy i kolumn, a nie
        // prostokątność - wiersze o różnej długości model i tak dopełnia.
        matrixShapeOk:
          "Dane nie mają kształtu macierzy: po jednej ze stron został mniej niż jeden pełny wymiar.",
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
          "Etykiety liczbowe osi nie idą po kolei, więc sąsiedztwo komórek nie odpowiada sąsiedztwu wartości.",
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
        // PIĘĆ PRZYPISÓW, KTÓRYCH TU NIE BYŁO, a `TornadoRowNote` je zwraca:
        // tabela danych wypisywała za nie SUROWY KLUCZ („tornado.note.empty”)
        // na stronie publicznej, bo klucz składał się napisem i żadna bramka
        // go nie widziała. Treść jest tą samą treścią, którą niosą komunikaty
        // uczciwości - przypis w wierszu mówi to samo krócej, bo stoi przy
        // nazwie parametru, a nie pod rysunkiem.
        oneLegged: "podana jedna noga: druga wartość skrajna nie ma liczby",
        empty: "brak obu wartości skrajnych: wiersz nie ma czym się odchylać",
        oneSided: "obie nogi po tej samej stronie bazy",
        tied: "rozpiętość taka sama jak w innym wierszu: kolejność jest umowna",
        duplicate: "nazwa parametru powtarza się w arkuszu",
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
    // WACHLARZ SCENARIUSZY. Sekcja 8 specyfikacji nazywa prognozę narysowaną
    // pojedynczą linią „najczęstszą formą kłamstwa na wykresie”, więc cały ten
    // blok mówi o jednej rzeczy: o SZEROKOŚCI przedziału i o tym, czy liczby,
    // które ją wyznaczają, pochodzą z jednego rozkładu.
    //
    // PASMA NAZYWAMY POZIOMEM PEWNOŚCI („pasmo 80%”), nigdy szerokością.
    // Pewność jest deklaracją autora, szerokość tylko jej pomiarem - i na tym
    // rozróżnieniu stoi cały defekt `confidenceMatchesWidth`: pasmo 95% węższe
    // od pasma 80% da się wykryć wyłącznie wtedy, gdy etykieta pochodzi
    // z deklaracji, a nie z posortowania po zmierzonej szerokości.
    //
    // FAZY KROKU (historia/prognoza) ten blok NIE NAZYWA: robi to wspólny blok
    // `charts.forecast` (`label`, `historyLabel`, `fromCategory`, `tableFlag`),
    // z którego czyta już render prognozy. Druga para napisów o tej samej
    // treści rozjechałaby się przy pierwszej korekcie jednego z nich.
    fan: {
      axis: { step: "Krok", value: "Wartość" },
      band: {
        // Etykieta pasma - legenda, nagłówek kolumny tabeli, tooltip. Liczba
        // idzie z DEKLARACJI (`FanLevel.confidence`), nie ze zmierzonej
        // szerokości.
        label: "Pasmo {{confidence}}%",
        // `confidence: null` znaczy, że autor podał SZEROKOŚĆ (±%), a nie
        // poziom pewności. Dopisanie tu „95%” byłoby liczbą, której nikt nie
        // podał.
        unknown: "Pasmo o nieznanej pewności",
      },
      table: {
        step: "Krok",
        phase: "Faza",
        central: "Ścieżka centralna",
        lower: "Dolna krawędź",
        upper: "Górna krawędź",
        width: "Szerokość pasma",
        observations: "Obserwacje",
      },
      // TRZY NOŚNIKI ODRÓŻNIENIA PROGNOZY (sekcja 8 specyfikacji). Nazwy są
      // potrzebne po to, żeby `honesty.forecastDistinguished` umiało wymienić
      // nośniki, które SĄ (`FanHonesty.carriers` trzyma obecne, nie brakujące)
      // - samo „prognoza nie jest odróżniona” nie mówi, czego na rysunku
      // szukać. Render tłumaczy je JAWNĄ mapą `Record<FanCarrier, string>`:
      // klucz sklejany z wartości unii nie jest przez nic sprawdzony, a ta
      // unia ma dokładnie trzy wartości i trzy zdania.
      carrier: {
        band: "pasmo niepewności",
        zone: "tło strefy prognozy",
        separator: "pionowy separator",
      },
      // SKĄD WZIĘŁY SIĘ PASMA. Każdy wybór na wykresie ma być nazwany, a ten
      // waży najwięcej: pasmo z `forecastBandPct` deklaruje SZEROKOŚĆ, a nie
      // pewność, więc podpisanie go procentem pewności byłoby liczbą, której
      // autor nie podał.
      bandSource: {
        series: "Krawędzie pasm pochodzą z par serii nazwanych dolną i górną.",
        levels: "Pasma pochodzą z poziomów pewności podanych przez autora.",
        bandPct:
          "Autor podał jedną szerokość pasma (±%), a nie poziom pewności, więc wachlarz ma jedno pasmo i nie ma przy nim procentu pewności.",
        none: "Autor nie podał ani jednego pasma, więc rysunek pokazuje samą ścieżkę.",
      },
      centralSource: {
        option: "Ścieżkę centralną wskazał autor.",
        name: "Ścieżkę centralną rozpoznano po nazwie serii.",
        fallback:
          "Żadna seria nie nazywa się ścieżką centralną, więc wzięto pierwszą - pasma są mierzone wokół niej.",
        none: "Żadna seria nie niesie ścieżki centralnej.",
      },
      honesty: {
        // Każde zdanie mówi, CO na rysunku jest nieprawdą - listy etykiet
        // z modelu wypełniają wstawki, a nie stoją jako osobne klucze.
        bandsContainCentral:
          "Pasmo nie obejmuje ścieżki centralnej w krokach: {{labels}}. Krawędzie i centrum pochodzą wtedy z dwóch różnych prognoz, więc przedział nie jest przedziałem wokół tej linii.",
        bandsNested:
          "Krawędzie dwóch poziomów pewności przecinają się w krokach: {{labels}}. Pasmo węższe wychodzi tam poza szersze, czyli co najmniej jedna z tych liczb nie pochodzi z rozkładu, o którym mówi jej etykieta.",
        confidenceMatchesWidth:
          "Pasmo o wyższej pewności jest węższe od pasma o niższej ({{confidences}}), więc deklaracja i zmierzone szerokości mówią co innego.",
        bandsHaveWidth:
          "Pasmo ma zerową szerokość w krokach: {{labels}}. W kroku prognozowanym zero znaczy „tę wartość znam dokładnie”, a to jest twierdzenie mocniejsze niż cała reszta rysunku.",
        bandPairsOrdered:
          "Dolna krawędź leży wyżej od górnej w krokach: {{labels}}. Geometria jest naprawiona, żeby pasmo dało się narysować, ale jedna z kolumn w arkuszu nie jest tym, co mówi jej nazwa.",
        forecastDistinguished:
          "Prognoza jest odróżniona od historii tylko przez: {{carriers}}. Jeden nośnik gubi się w druku i w skali szarości, więc przewidywanie i pomiar stoją wtedy na rysunku jako jeden szereg.",
        centralContinuousInForecast:
          "Ścieżka centralna ma luki w krokach: {{labels}}. Linia się tam przerywa, a pasmo wokół niej nie ma do czego się odnieść.",
        centralContinuousInHistory:
          "Ścieżka centralna ma luki nad pomiarem, w krokach: {{labels}}. Kroki obok mają wartość, więc linia przerywa się nad danymi, o których wykres twierdzi, że je zmierzono.",
        bandsContinuous:
          "Pasmo urywa się i zaczyna dalej w krokach: {{labels}}. Krok z jedną krawędzią wypada z rysunku w całości, bo pół pasma nie jest pasmem - a przerwa bez wyjaśnienia czyta się jak „tu niepewności nie ma”.",
        // Dwa pola informacyjne modelu, które orzekają o KSZTAŁCIE wachlarza.
        // Żadna liczba nie jest w nich fałszywa i dlatego nie są defektem -
        // ale rysunek mówi wtedy o niepewności coś, czego dane nie mówią.
        wideAtStart:
          "Pasmo ma już w pierwszym kroku prognozy {{share}} swojej największej szerokości, więc kształt rysunku nie mówi o niepewności rosnącej z horyzontem.",
        constantWidth:
          "Szerokość pasma jest w każdym kroku prognozy ta sama co do liczby, więc z kształtu rysunku nie wynika, jak daleko od ostatniej obserwacji leży dany krok - żadna z tych liczb nie jest przy tym fałszywa.",
        boundaryDropped:
          "Zadeklarowana granica prognozy leży poza zakresem kroków, więc została odrzucona i cały szereg jest na rysunku historią.",
        // CZTERY LISTY BEZ ORZECZENIA OBOK. `FanHonesty` nie ma dla nich pola
        // `boolean`, bo niepusta lista JEST tu orzeczeniem - i to takim, które
        // trzeba wypowiedzieć: seria pominięta bez podania przyczyny wygląda
        // dla autora jak seria, której nie wpisał.
        unpairedEdge:
          "Serie {{names}} podają jedną krawędź pasma bez drugiej. Jedna krawędź nie jest pasmem, więc tego poziomu na rysunku nie ma.",
        duplicateEdge:
          "Do tej samej krawędzi tego samego poziomu zgłosiła się więcej niż jedna seria ({{names}}); rysowana jest pierwsza, pozostałe nie zostawiają na wykresie żadnego śladu.",
        outOfRangeConfidence:
          "Pewność {{values}} nie mieści się między zerem a stoma procentami, więc ten poziom stracił etykietę pewności i nie wchodzi do sprawdzenia kolejności pasm.",
        extraSeries:
          "Wachlarz nie czyta serii {{names}}: żadna z nich nie jest ani ścieżką centralną, ani krawędzią pasma, więc ich liczb nie ma na rysunku.",
        droppedValues_one:
          "{{count}} liczba nie trafiła ani na rysunek, ani do tabeli: leżała poza zakresem kroków albo poza zakresem liczb, w którym arytmetyka pasm jest wykonalna.",
        droppedValues_few:
          "{{count}} liczby nie trafiły ani na rysunek, ani do tabeli: leżały poza zakresem kroków albo poza zakresem liczb, w którym arytmetyka pasm jest wykonalna.",
        droppedValues_many:
          "{{count}} liczb nie trafiło ani na rysunek, ani do tabeli: leżały poza zakresem kroków albo poza zakresem liczb, w którym arytmetyka pasm jest wykonalna.",
        droppedValues_other:
          "{{count}} liczb nie trafiło ani na rysunek, ani do tabeli: leżały poza zakresem kroków albo poza zakresem liczb, w którym arytmetyka pasm jest wykonalna.",
      },
      // KOMPLET `FanRowNote` - dziewięć wartości unii, dziewięć przypisów. Ta
      // sama treść co w `honesty`, tylko krótsza i przypięta do wiersza, przy
      // którym czytelnik jej szuka.
      note: {
        gap: "brak wartości centralnej w tym kroku",
        centralOutside: "pasmo nie obejmuje ścieżki centralnej",
        crossing: "krawędzie dwóch poziomów pewności przecinają się",
        zeroWidth:
          "pasmo o zerowej szerokości: rysunek twierdzi tu, że wartość jest znana dokładnie",
        inverted: "para krawędzi odwrócona: dolna była wyżej od górnej",
        bandOverHistory: "pasmo nad krokiem historycznym, w którym jest pomiar",
        bandGap: "przerwa w paśmie: krok leży między krokami pasma, a pasma w nim nie ma",
        narrowing: "pasmo węższe niż w kroku poprzednim",
        anchor:
          "kotwica na granicy: pasmo wychodzi z ostatniej obserwacji i ma tu zerową szerokość",
        boundary: "ostatnia obserwacja: dalej idzie prognoza",
      },
      reading: {
        noForecast:
          "Wykres nie ma odcinka prognozy: wszystkie kroki są obserwacjami, więc nie ma tu ani pasma niepewności, ani granicy między pomiarem a przewidywaniem.",
        noBand:
          "Prognoza jest narysowana jedną linią, bez pasma niepewności - z rysunku nie da się odczytać, jak szeroki jest przedział wartości, które ta prognoza dopuszcza.",
        noCentral:
          "Na rysunku są same krawędzie pasm, bez ścieżki centralnej, więc nie widać wartości, wokół której przedział jest zbudowany.",
        singleForecastStep:
          "Prognoza ma jeden krok, więc pasmo nie ma się od czego rozejść - to przedział przy jednym punkcie, a nie wachlarz.",
        singleLevel:
          "Wachlarz ma jeden poziom pewności, więc pokazuje jedną szerokość przedziału, a nie kształt niepewności.",
        tooManyLevels:
          "Poziomów pewności jest więcej niż {{max}}, a sąsiednie pasma różnią się kryciem poniżej progu rozróżnialności - z rysunku nie widać, gdzie kończy się jedno, a zaczyna drugie.",
        constantBand:
          "Pasmo ma w całej prognozie tę samą szerokość, więc rysunek nie pokazuje niepewności rosnącej z horyzontem.",
      },
    },
    // LINIOWY NA INDEKSIE, BAZA = 100. Rodzaj ODBIERA poziom i jednostkę,
    // a ODDAJE tempo - i cały ten blok jest zapisem tej wymiany. Oś mówi
    // wprost, że wartości są bezjednostkowe i liczone od bazy równej stu,
    // podpis NAZYWA okres bazowy, a tabela trzyma wartości źródłowe obok
    // indeksu, bo poziom, którego czytelnik nie zobaczy nigdzie, jest dla
    // niego tym samym co poziom, którego nie ma.
    indexBase: {
      axis: {
        period: "Okres",
        index: "Indeks (baza = 100)",
        // Zdanie obowiązkowe wszędzie, gdzie ta oś jest podpisana. Indeks jest
        // ILORAZEM dwóch wartości w tej samej jednostce, więc jednostki nie ma;
        // oś podpisana jednostką autora byłaby zdaniem fałszywym o każdej
        // liczbie na rysunku.
        unitless:
          "Wartości na osi są bezjednostkowe: to wartość okresu podzielona przez wartość okresu bazowego i pomnożona przez sto. Jednostka danych stoi przy kolumnie wartości źródłowych.",
      },
      base: {
        // Podpis bez NAZWY okresu bazowego zostawia czytelnika bez punktu, od
        // którego liczone jest wszystko, co widzi.
        label: "Baza: {{period}} = 100",
        reference: "Linia odniesienia: 100, czyli poziom okresu bazowego",
        source: {
          explicit: "Okres bazowy wskazał autor.",
          first: "Okresu bazowego nie wskazano, więc bazą jest pierwszy okres szeregu.",
          none: "Na wykresie nie ma osi okresów, więc nie ma okresu bazowego.",
        },
      },
      // Ucięcie osi jest tu DOPUSZCZONE (sekcja 8 nie wymaga zera dla linii),
      // ale ma być nazwane - stąd osobne zdanie zamiast wspólnego
      // `charts.caption.zeroBaselineWarningHint`, który mówi o zawyżonych
      // różnicach, a przy indeksie zakres zawsze obejmuje setkę.
      axisTruncated:
        "Oś nie zaczyna się od zera, bo indeksy mieszkają wokół stu; zakres zawsze obejmuje linię odniesienia sto, od której czyta się każdą wartość.",
      table: {
        period: "Okres",
        source: "Wartość źródłowa",
        index: "Indeks",
        // Wariant nagłówka z jednostką autora - `IndexBaseTable.sourceUnit`
        // bywa pustym napisem, więc nagłówek bez jednostki musi istnieć osobno.
        sourceUnit: "Wartość źródłowa ({{unit}})",
        series: "Seria",
        base: "Wartość bazowa",
        baseToMedian: "Baza do mediany",
        status: "Status serii",
        // PODPIS DRUGIEJ TABELI, osobno od nagłówka kolumny `status`. Oba
        // stały wcześniej na tym samym kluczu, więc czytelnik ekranu słyszał
        // „Status serii" najpierw jako NAZWĘ tabeli, a potem jako nazwę
        // jednej z jej kolumn - czyli nie dowiadywał się, czego ta tabela
        // dotyczy. Podpis ma powiedzieć, co w niej stoi: bazy i powód
        // pominięcia serii, której na rysunku nie ma.
        bases: "Bazy serii i powód pominięcia",
        baseRow: "wiersz bazowy: tu każda seria z rysunku ma dokładnie sto",
      },
      // DLACZEGO SERIA WYPADŁA Z RYSUNKU. Seria nieobecna wśród obecnych czyta
      // się jako „nie było takiego szeregu”, a nie jako „nie dało się go
      // zaindeksować” - dlatego przyczyna jest nazwana przy nazwie serii.
      rejection: {
        missingBase: "w okresie bazowym nie ma wartości, więc nie ma od czego liczyć indeksu",
        zeroBase: "wartość bazowa jest zerem, więc indeks byłby dzieleniem przez zero",
        negativeBase:
          "wartość bazowa jest ujemna, a dzielenie przez nią odwraca kierunek: spadek wyszedłby na rysunku jako wzrost",
      },
      // KOMPLET `IndexBaseSeriesNote` - pięć wartości unii, pięć przypisów.
      note: {
        noBase: "seria bez użytecznej bazy: nie ma jej na rysunku, jej liczby zostają w tabeli",
        extremeBase:
          "okres bazowy odstaje od własnego szeregu, więc cały indeks tej serii jest liczony od nietypowego punktu",
        mixedSign:
          "szereg przechodzi przez zero, więc odczyt „procent bazy” na tej serii nie działa",
        unrepresentable: "część punktów wypadła: iloraz nie mieści się w zakresie liczb",
        flat: "seria leży na linii odniesienia: jej odchylenie od stu jest mniejsze niż ostatnia wyświetlana cyfra",
      },
      honesty: {
        baseInRangeOk:
          "Żądany okres bazowy leży poza osią okresów, więc bazą jest {{period}} - podpis „= 100” mówi wtedy o innym okresie niż ten, który podał autor.",
        baseNamedOk:
          "Okres bazowy nie ma nazwy, więc podpis urywa się na „= 100” i nie mówi, wobec którego okresu liczona jest każda wartość na tym rysunku.",
        baseUsableOk:
          "Serie {{names}} nie mają w okresie bazowym wartości, od której da się liczyć indeks, więc nie ma ich na rysunku; ich wartości źródłowe zostają w tabeli danych.",
        baseTypicalOk:
          "W seriach {{names}} okres bazowy leży poza ogrodzeniem Tukeya własnego szeregu, więc odchylenia od stu są liczone od okresu nietypowego dla tych danych.",
        indexRepresentableOk:
          "W seriach {{names}} część punktów nie ma indeksu: iloraz wyszedł poza zakres liczb i tych punktów nie ma na rysunku.",
        signStableOk:
          "Serie {{names}} przechodzą przez zero, więc ich indeks jest raz dodatni, raz ujemny - indeks -40 nie znaczy wtedy spadku o czterdzieści procent.",
        spreadOk:
          "Każdy policzony indeks siedzi w setce, więc w danych nie ma różnicy temp, którą ten rysunek miałby pokazać.",
        pointsInPeriodsOk_one:
          "{{count}} liczba leży za ostatnim okresem osi, więc nie ma jej ani na rysunku, ani w tabeli.",
        pointsInPeriodsOk_few:
          "{{count}} liczby leżą za ostatnim okresem osi, więc nie ma ich ani na rysunku, ani w tabeli.",
        pointsInPeriodsOk_many:
          "{{count}} liczb leży za ostatnim okresem osi, więc nie ma ich ani na rysunku, ani w tabeli.",
        pointsInPeriodsOk_other:
          "{{count}} liczb leży za ostatnim okresem osi, więc nie ma ich ani na rysunku, ani w tabeli.",
        declaredSampleOk: "W podpisie stoi n = {{declared}}, a okresów z pomiarem jest {{actual}}.",
      },
      reading: {
        baseUnusable:
          "Żadnej serii nie da się zaindeksować od tego okresu, więc na rysunku nie ma ani jednej linii; wartości źródłowe są w tabeli danych.",
        seriesDropped_one:
          "{{count}} seria nie trafiła na rysunek, bo w okresie bazowym nie ma wartości, od której da się liczyć indeks; jej liczby zostają w tabeli danych.",
        seriesDropped_few:
          "{{count}} serie nie trafiły na rysunek, bo w okresie bazowym nie mają wartości, od której da się liczyć indeks; ich liczby zostają w tabeli danych.",
        seriesDropped_many:
          "{{count}} serii nie trafiło na rysunek, bo w okresie bazowym nie mają wartości, od której da się liczyć indeks; ich liczby zostają w tabeli danych.",
        seriesDropped_other:
          "{{count}} serii nie trafiło na rysunek, bo w okresie bazowym nie mają wartości, od której da się liczyć indeks; ich liczby zostają w tabeli danych.",
        singleSeries:
          "Na rysunku jest jedna linia, więc nie ma z czym porównać jej tempa - a indeks odebrał jej jednostkę i poziom, które są w tabeli danych.",
        shortSeries:
          "Okres jest jeden, więc każda seria ma indeks dokładnie sto: rysunek pokazuje definicję indeksu, a nie dane.",
        extremeBase:
          "Okres bazowy odstaje od reszty szeregu, więc odchylenia od stu są liczone od nietypowego punktu i wychodzą większe, niż wynika z samych danych.",
        mixedSign:
          "Szereg przechodzi przez zero, więc jego indeks jest raz dodatni, raz ujemny: indeks -40 nie znaczy spadku o czterdzieści procent.",
        noSpread:
          "Wszystkie linie leżą na linii odniesienia sto, więc z rysunku nie da się odczytać żadnej różnicy temp.",
        tooManySeries:
          "Linii jest więcej niż {{max}}, a powyżej tego zestawu barwy przestają być rozdzielne dla każdego rodzaju widzenia barw - legendy nie da się wtedy dopasować do linii samym kolorem.",
      },
    },
    // SŁUPEK SKUMULOWANY 100% - STRUKTURA CAŁOŚCI. Rodzaj jest ZAMIENNIKIEM
    // tarczy powyżej pięciu kategorii, a nie jej ozdobniejszą wersją: tarcza
    // koduje udział kątem i powierzchnią, stos koduje go długością.
    //
    // I stąd bierze się treść bloku tabeli. „Wspólna skala” jest tu prawdą
    // tylko w połowie: w zerze zaczyna się WYŁĄCZNIE segment przy krawędzi
    // odniesienia, a pozostałe leżą na skalach równoległych, ale przesuniętych,
    // i ich długość czyta się jako różnicę dwóch krawędzi. Dlatego rozpiętość
    // udziału i przesunięcie między pierwszym a ostatnim słupkiem stoją
    // w tabeli LICZBĄ - rysunek jest dokładnie w tym miejscu najsłabszy.
    percentStacked: {
      axis: { category: "Kategoria", share: "Udział w całości" },
      scaleNote:
        "Od zera zaczyna się tylko segment przy krawędzi odniesienia; pozostałe leżą na skalach przesuniętych, więc ich długość czyta się jako różnicę dwóch krawędzi. Rozpiętość udziału i przesunięcie między pierwszym a ostatnim słupkiem podaje tabela.",
      table: {
        category: "Kategoria",
        series: "Seria",
        value: "Wartość",
        share: "Udział",
        total: "Suma kategorii",
      },
      // BRZEG SERII - ta część tabeli, która NIE jest zapisem rysunku, tylko
      // jego dopełnieniem tam, gdzie rysunek nie odpowiada: segment środkowy
      // nie leży na wspólnej skali, więc „czy udział tej serii rośnie” odczytuje
      // się z wykresu przez porównanie dwóch różnic.
      summary: {
        series: "Seria",
        bars: "Słupki z udziałem",
        total: "Suma wartości",
        minShare: "Udział najmniejszy",
        maxShare: "Udział największy",
        span: "Rozpiętość udziału",
        first: "Udział w pierwszym słupku",
        last: "Udział w ostatnim słupku",
        shift: "Przesunięcie",
      },
      // KOMPLET `PercentStackedRowNote` - sześć wartości unii, sześć przypisów.
      note: {
        empty: "żadna seria nie podała w tej kategorii liczby",
        zeroTotal:
          "składniki sumują się do zera: struktury nie ma, więc słupek jest luką, a nie pełnym słupkiem pierwszej serii",
        rejected: "słupek odrzucony: jest w nim wartość ujemna albo poza zakresem liczb",
        incomplete:
          "brakuje składnika, który mają pozostałe słupki, więc udziały są liczone z innego mianownika",
        rescaled:
          "udziały podane w arkuszu zostały przeskalowane do pełnej całości: liczba na segmencie jest inna niż w arkuszu",
        duplicate: "nazwa kategorii powtarza się w arkuszu",
      },
      // KOMPLET `PercentStackedCellNote` - pięć wartości unii, pięć przypisów.
      // Zero i brak są tu OSOBNYMI stanami: zero jest pomiarem, brak jest
      // nieuzupełnionym polem, a jedno zdanie o „braku danych” zlepiłoby je
      // w jedno.
      cellNote: {
        zero: "zero podane w arkuszu: składnik jest znany i wynosi zero",
        missing: "liczby nie podano - to nie jest zero, tylko nieuzupełnione pole",
        negative: "wartość ujemna: udział ujemny nie ma długości",
        tooLarge: "wartość poza zakresem, w którym sumę da się jeszcze sprawdzić",
        noShare:
          "wartość jest dodatnia, ale słupek nie ma mianownika, więc udziału nie ma czym policzyć",
      },
      honesty: {
        valuesNonNegativeOk:
          "W kategoriach {{labels}} jest wartość ujemna. Udział ujemny nie ma długości, więc te słupki nie mają ani jednego segmentu - ich liczby są wyłącznie w tabeli danych.",
        totalsPositiveOk:
          "W kategoriach {{labels}} składniki sumują się do zera, więc struktury nie ma i w miejscu słupka jest luka.",
        structureComparableOk:
          "Słupkom {{labels}} brakuje składnika, który mają pozostałe, więc ich udziały są policzone z innego mianownika - a wyglądają dokładnie tak samo.",
        declaredTotalsOk:
          "Udziały podane w arkuszu nie domykają stu w kategoriach {{labels}}, więc zostały przeskalowane do pełnej całości: liczba na segmencie jest inna niż liczba w arkuszu.",
        emptyCategories:
          "Kategorie {{labels}} nie mają ani jednej liczby, więc stoją na osi bez słupka.",
        outOfRange:
          "W kategoriach {{labels}} jest wartość poza zakresem, w którym suma jest jeszcze sprawdzalna, więc te słupki nie są rysowane.",
        duplicateCategories:
          "Etykieta kategorii {{labels}} powtarza się, a pod słupkiem nie ma drugiego nośnika tożsamości, więc dwóch słupków o tej samej nazwie nie da się od siebie odróżnić.",
        duplicateSeries:
          "Nazwa serii {{names}} powtarza się. Tożsamość segmentu niesie tu wyłącznie legenda albo etykieta bezpośrednia, więc tych segmentów nie rozdziela żaden kanał.",
        // Pole informacyjne, nie defekt: zaokrąglenie etykiety jest konieczne,
        // a jego wielkość ograniczona jednostką wyświetlania. Czytelnik ma
        // jednak prawo wiedzieć, że etykieta jest zaokrągleniem, a długość
        // segmentu nie.
        roundingShift:
          "Udział wyświetlany różni się od dokładnego najwyżej o {{pp}} punktu procentowego: etykieta jest zaokrągleniem, a długość segmentu - nie.",
        droppedValues_one:
          "{{count}} liczba nie ma słupka, do którego mogłaby wejść: wartość dopisano, kategorii nie.",
        droppedValues_few:
          "{{count}} liczby nie mają słupka, do którego mogłyby wejść: wartość dopisano, kategorii nie.",
        droppedValues_many:
          "{{count}} liczb nie ma słupka, do którego mogłyby wejść: wartość dopisano, kategorii nie.",
        droppedValues_other:
          "{{count}} liczb nie ma słupka, do którego mogłyby wejść: wartość dopisano, kategorii nie.",
      },
      reading: {
        negativeValues:
          "W danych jest wartość ujemna, a udział ujemny nie ma długości - słupki, w których stoi, nie mają na rysunku ani jednego segmentu.",
        tooManySegments:
          "Segmentów jest więcej niż {{max}}, a powyżej tego zestawu barwy przestają być rozdzielne dla każdego rodzaju widzenia barw - legendy nie da się wtedy dopasować do stosu samym kolorem.",
        singleSegment:
          "Stos ma jedną serię, więc każdy słupek jest pełny w stu procentach: struktura jednoskładnikowa nie jest strukturą.",
        singleBar:
          "Na rysunku jest jeden słupek, więc jego struktury nie ma z czym porównać; udziały tej jednej całości są w tabeli danych.",
        noStructure:
          "Żaden słupek nie ma struktury do narysowania: same luki, sumy zerowe albo słupki odrzucone. Liczby są w tabeli danych.",
      },
    },
    // PANELE (SMALL MULTIPLES). Rodzaj odpowiada na dwa pytania naraz - „wiele
    // podmiotów na wielu wskaźnikach” (zamiast radaru) i „kilka szeregów
    // o różnej skali” (zamiast dwóch osi Y) - a oba zakazy mają tę samą
    // przyczynę: wynik wizualny zależałby tam od decyzji autora, a nie od
    // danych.
    //
    // DLATEGO NAJWAŻNIEJSZE ZDANIE TEGO BLOKU JEST ZDANIEM O SKALI. Panele
    // z osobnymi osiami wyglądają identycznie jak panele ze wspólną, a znaczą
    // co innego: dwie linie na tej samej wysokości mogą się wtedy różnić
    // o rzędy wielkości. Wspólna oś jest domyślna, a osobna jest DEFEKTEM,
    // dopóki nie została jawnie zadeklarowana i OPISANA.
    //
    // I drugie: PANEL BEZ DANYCH ZOSTAJE PUSTY, a nie znika. Panel usunięty
    // przestawia pozostałe, więc czytelnik, który zna zestaw podmiotów, nie
    // zauważy, że jednego nie ma - zauważy tylko, że siatka jest inna.
    smallMultiples: {
      axis: { category: "Kategoria", value: "Wartość", index: "Indeks (baza = 100)" },
      axisTruncated:
        "Oś wartości nie zaczyna się od zera: skala jest ucięta, więc zmiany na liniach wyglądają na większe, niż są. Pełne liczby są w tabeli danych.",
      scale: {
        shared: "Wszystkie panele dzielą jedną oś wartości.",
        free: "Każdy panel ma własną oś wartości, więc dwie linie na tej samej wysokości nie znaczą tej samej wartości.",
        // Opis osobnych skal pisze AUTOR, a render ma obowiązek go wypisać -
        // model sprawdza wyłącznie obecność opisu, bo jego treści nie da się
        // sprawdzić arytmetycznie.
        freeScaleNote: "Dlaczego panele mają osobne skale: {{note}}",
        sharedDomain: "Wspólna oś wartości: od {{min}} do {{max}}",
        levelRatio: "Panele różnią się poziomem {{ratio}}-krotnie.",
      },
      // KOLEJNOŚĆ PANELI JEST NOŚNIKIEM INFORMACJI, więc czym są uporządkowane,
      // musi być napisane - tak samo jak przy posortowanych słupkach poziomych.
      // Komplet `SmallMultiplesOrder`: sześć wartości unii, sześć zdań.
      order: {
        mean: "Panele uporządkowane średnią.",
        max: "Panele uporządkowane wartością największą.",
        span: "Panele uporządkowane rozpiętością.",
        last: "Panele uporządkowane wartością ostatnią.",
        label: "Panele uporządkowane nazwą.",
        input: "Panele stoją w kolejności arkusza.",
      },
      summary: {
        panel: "Panel",
        n: "Obserwacje",
        min: "Minimum",
        max: "Maksimum",
        mean: "Średnia",
        first: "Wartość pierwsza",
        last: "Wartość ostatnia",
        change: "Zmiana",
        changePct: "Zmiana w procentach",
        occupancy: "Udział we wspólnej osi",
      },
      note: {
        gap: "luka: wartości nie zmierzono, więc linia się w tym miejscu przerywa",
        clamped: "wartość przycięta do krawędzi panelu: punkt leży tam, gdzie danych nie ma",
        empty:
          "panel bez ani jednej wartości: pusty panel znaczy brak danych o tym podmiocie, a nie wartości zerowe",
        flattened: "panel spłaszczony wspólną osią: jego liczb nie da się odczytać z rysunku",
        noIndexBase: "brak wartości w kategorii bazowej, więc w indeksie ten panel nie ma linii",
      },
      honesty: {
        commonScaleOk:
          "Każdy panel ma własną oś wartości, więc dwie linie na tej samej wysokości mogą znaczyć wartości różniące się o rzędy wielkości. Oś, której panele nie dzielą, biegłaby od {{min}} do {{max}}.",
        freeScaleDeclaredOk:
          "Panele mają osobne osie wartości, a autor nie podał, co je rozdzieliło - z samego rysunku wychodzi obraz porównywalny, którym on nie jest.",
        sharedScaleReadableOk_one:
          "Wspólna oś spłaszcza {{count}} z {{total}} paneli: jego zmiany mieszczą się w grubości własnej linii, więc czyta się z niego „nic się nie działo”.",
        sharedScaleReadableOk_few:
          "Wspólna oś spłaszcza {{count}} z {{total}} paneli: ich zmiany mieszczą się w grubości własnej linii, więc czyta się z nich „nic się nie działo”.",
        sharedScaleReadableOk_many:
          "Wspólna oś spłaszcza {{count}} z {{total}} paneli: ich zmiany mieszczą się w grubości własnej linii, więc czyta się z nich „nic się nie działo”.",
        sharedScaleReadableOk_other:
          "Wspólna oś spłaszcza {{count}} z {{total}} paneli: ich zmiany mieszczą się w grubości własnej linii, więc czyta się z nich „nic się nie działo”.",
        sameUnitOk:
          "Panele mierzą w różnych jednostkach, więc wspólna oś zestawiałaby nieporównywalne; skale zostały rozdzielone i wysokości między panelami nie da się tu porównać.",
        emptyPanelsKeptOk:
          "W siatce stoją panele bez ani jednej wartości: pusty panel znaczy brak danych o tym podmiocie, a nie wartości zerowe. Zażądano ich pominięcia, ale panel usunięty z siatki zabrałby podmiot razem z informacją, że danych o nim nie ma.",
        orderFromDataOk:
          "Kolejność paneli nie wynika z danych, a pierwszy rząd siatki niesie pierwsze wrażenie - tutaj to wrażenie jest kolejnością arkusza.",
        inGridOk_one:
          "{{count}} liczba nie trafiła w żaden panel: leży za ostatnią kategorią, więc nie ma jej ani na rysunku, ani w tabeli.",
        inGridOk_few:
          "{{count}} liczby nie trafiły w żaden panel: leżą za ostatnią kategorią, więc nie ma ich ani na rysunku, ani w tabeli.",
        inGridOk_many:
          "{{count}} liczb nie trafiło w żaden panel: leżą za ostatnią kategorią, więc nie ma ich ani na rysunku, ani w tabeli.",
        inGridOk_other:
          "{{count}} liczb nie trafiło w żaden panel: leżą za ostatnią kategorią, więc nie ma ich ani na rysunku, ani w tabeli.",
        inDomainOk:
          "Część wartości została przycięta do krawędzi panelu, więc punkt leży tam, gdzie danych nie ma.",
        zeroBaselineOk:
          "Panele kodują wartość długością, a oś nie obejmuje zera - proporcja długości jest wtedy zniekształcona wprost.",
        indexBaseOk:
          "Panele {{labels}} nie mają wartości w kategorii bazowej, więc w indeksie nie mają linii; panel bez linii wśród paneli z liniami czyta się jako brak zmian, a nie jako brak bazy.",
        spreadOk:
          "W żadnym panelu wartość najmniejsza nie różni się od największej, więc w danych nie ma zmiany, którą ta siatka miałaby pokazać.",
        declaredSampleOk: "W podpisie stoi n = {{declared}}, a punktów z pomiarem jest {{actual}}.",
        paletteWrapOk:
          "Paneli jest więcej niż slotów palety, a mają różne sloty, więc dwa panele dostają ten sam kolor, nie będąc w żadnej relacji - kolor wygląda tu na klucz, nie będąc nim.",
      },
      reading: {
        singlePanel:
          "Panel z danymi jest jeden, więc nie ma z czym go porównać - a siatka paneli odebrała mu miejsce na osie i etykiety.",
        tooManyPanels:
          "Paneli jest {{count}}, czyli więcej niż {{max}} - przy tej gęstości panel jest tak niski, że podziałek jego osi wartości nie da się odczytać.",
        indexBaseBetter:
          "Wspólna oś spłaszcza wszystkie panele poza najwyżej jednym, więc z pozostałych nie da się odczytać zmian; ich liczby są w tabeli danych.",
        undeclaredFreeScale:
          "Panele mają osobne osie wartości, więc dwie linie na tej samej wysokości nie znaczą tej samej wartości; między panelami porównywalny zostaje kształt linii, a nie jej wysokość.",
        mixedUnits:
          "Panele mierzą w różnych jednostkach, więc ich wysokości nie da się porównać; jednostka każdego panelu stoi przy jego nazwie w tabeli danych.",
        noSpread: "Żaden panel nie ma rozpiętości, więc wszystkie linie są płaskie.",
        sheetOrder:
          "Panele stoją w kolejności arkusza, więc pierwszy rząd nie jest ani największy, ani najmocniej zmieniony - z ich kolejności nic nie wynika.",
        oneCategory:
          "Oś kategorii ma jeden punkt, więc panel nie pokazuje ani przebiegu, ani rozkładu - każdy jest pojedynczą wartością w ramce.",
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
      // OSOBNA WSKAZÓWKA DLA TARCZY, bo tarcza ma inną nawigację: każdy
      // wycinek jest osobnym elementem fokusowalnym z własną nazwą, więc
      // przechodzi się między nimi Tabem, a strzałki nic nie robią. Podanie
      // tam `keyboardHint` byłoby instrukcją, która nie działa - gorszą niż
      // brak instrukcji, bo czytelnik uzna, że wykres jest zepsuty.
      keyboardHintSlices: "Tabem przechodzisz między wycinkami, Escape czyści zaznaczenie.",
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
        outOfRange_one:
          "{{count}} observation falls outside the first and last edge given, so it is not on the chart. The histogram then overstates the share of everything it does show.",
        outOfRange_other:
          "{{count}} observations fall outside the first and last edge given, so they are not on the chart. The histogram then overstates the share of everything it does show.",
        checksumFailed:
          "Bin counts add up to {{sum}}, not to the {{count}} observations in the data - some of it never reached the chart.",
        binWidthFailed:
          "Two of the edges given are equal or out of order, so one bin has zero width and cannot be drawn.",
        declaredSampleFailed:
          "The caption says n = {{declared}}, the data holds {{actual}} observations.",
        ignoredSeries_one:
          "A histogram reads ONE series; the remaining one was skipped. Two distributions are compared with two panels on a shared scale, not with one chart.",
        ignoredSeries_other:
          "A histogram reads ONE series; the remaining {{count}} were skipped. Two distributions are compared with two panels on a shared scale, not with one chart.",
        binsBuiltFailed:
          "Not a single bin could be built from these observations, so the chart shows no bars - the edges are either equal or so far apart that the bin width cannot be represented.",
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
        n: "n",
        r2: "R²",
      },
      trend: {
        label: "Trend line",
        r2: "R² = {{value}}",
        n: "n = {{count}}",
        method: "Ordinary least squares",
        notCausal: "Covariation, not cause: the line does not say what acts on what.",
      },
      honesty: {
        pairsCompleteOk_one:
          "{{count}} pair has only one coordinate, so it is not on the chart. It is listed in the data table with the reason.",
        pairsCompleteOk_other:
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
          "The numeric axis labels do not run in order, so neighbouring cells do not stand for neighbouring values.",
        matrixShapeOk:
          "The data has no matrix shape: one of the two dimensions is left with less than a full row or column.",
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
          "The numeric axis labels do not run in order, so neighbouring cells do not stand for neighbouring values.",
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
        oneLegged: "one leg given: the other extreme has no number",
        empty: "both extremes missing: the row has nothing to deviate with",
        oneSided: "both legs fall on the same side of the base",
        tied: "the same swing as another row: the order is arbitrary",
        duplicate: "the parameter name repeats in the sheet",
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
    fan: {
      axis: { step: "Step", value: "Value" },
      band: {
        label: "{{confidence}}% band",
        unknown: "Band of unknown confidence",
      },
      table: {
        step: "Step",
        phase: "Phase",
        central: "Central path",
        lower: "Lower edge",
        upper: "Upper edge",
        width: "Band width",
        observations: "Observations",
      },
      carrier: {
        band: "the uncertainty band",
        zone: "the forecast zone tint",
        separator: "the vertical separator",
      },
      bandSource: {
        series: "The band edges come from pairs of series named lower and upper.",
        levels: "The bands come from confidence levels given by the author.",
        bandPct:
          "The author gave one band width (±%) rather than a confidence level, so the fan has a single band with no confidence figure next to it.",
        none: "The author gave no band at all, so the chart shows the path alone.",
      },
      centralSource: {
        option: "The central path was pointed out by the author.",
        name: "The central path was recognised from the series name.",
        fallback:
          "No series is named as the central path, so the first one was taken - the bands are measured around it.",
        none: "No series carries a central path.",
      },
      honesty: {
        bandsContainCentral:
          "A band does not contain the central path at: {{labels}}. The edges and the centre then come from two different forecasts, so the interval is not an interval around this line.",
        bandsNested:
          "The edges of two confidence levels cross at: {{labels}}. The narrower band leaves the wider one there, so at least one of these numbers does not come from the distribution its label names.",
        confidenceMatchesWidth:
          "A band of higher confidence is narrower than one of lower confidence ({{confidences}}), so the declaration and the measured widths say different things.",
        bandsHaveWidth:
          "The band has zero width at: {{labels}}. In a forecast step zero means “this value is known exactly”, and that is a stronger claim than anything else on the chart.",
        bandPairsOrdered:
          "The lower edge sits above the upper one at: {{labels}}. The geometry is repaired so the band can be drawn, but one of the columns in the sheet is not what its name says.",
        forecastDistinguished:
          "The forecast is set apart from history only by: {{carriers}}. A single carrier is lost in print and in greyscale, so prediction and measurement then stand on the chart as one series.",
        centralContinuousInForecast:
          "The central path has gaps at: {{labels}}. The line breaks there, and the band around it has nothing to refer to.",
        centralContinuousInHistory:
          "The central path has gaps over measured steps: {{labels}}. The steps around them have a value, so the line breaks over data the chart claims to have measured.",
        bandsContinuous:
          "The band breaks and resumes at: {{labels}}. A step with only one edge drops out entirely, because half a band is not a band - and an unexplained break reads as “there is no uncertainty here”.",
        wideAtStart:
          "The band already has {{share}} of its largest width in the first forecast step, so the shape of the chart does not say that uncertainty grows with the horizon.",
        constantWidth:
          "The band width is the same number in every forecast step, so the shape of the chart does not tell how far a step lies from the last observation - none of these numbers is false in itself.",
        boundaryDropped:
          "The declared forecast boundary falls outside the range of steps, so it was rejected and the whole series is drawn as history.",
        unpairedEdge:
          "The series {{names}} give one band edge without the other. One edge is not a band, so that level is not on the chart.",
        duplicateEdge:
          "More than one series claims the same edge of the same level ({{names}}); the first one is drawn and the rest leave no trace on the chart.",
        outOfRangeConfidence:
          "A confidence of {{values}} does not fall between zero and one hundred percent, so that level lost its confidence label and is left out of the band ordering check.",
        extraSeries:
          "The fan does not read the series {{names}}: none of them is a central path or a band edge, so their numbers are not on the chart.",
        droppedValues_one:
          "{{count}} number is neither on the chart nor in the table: it fell outside the range of steps, or outside the range of numbers in which band arithmetic holds.",
        droppedValues_other:
          "{{count}} numbers are neither on the chart nor in the table: they fell outside the range of steps, or outside the range of numbers in which band arithmetic holds.",
      },
      note: {
        gap: "no central value in this step",
        centralOutside: "the band does not contain the central path",
        crossing: "the edges of two confidence levels cross",
        zeroWidth: "zero band width: the chart claims this value is known exactly",
        inverted: "the edge pair was inverted: the lower one sat above the upper one",
        bandOverHistory: "a band over a history step, where there is a measurement",
        bandGap: "a break in the band: the step lies between band steps, and has no band",
        narrowing: "narrower than in the previous step",
        anchor: "boundary anchor: the band leaves the last observation and has zero width here",
        boundary: "last observation: the forecast starts after this step",
      },
      reading: {
        noForecast:
          "The chart has no forecast section: every step is an observation, so there is no uncertainty band and no boundary between measurement and prediction.",
        noBand:
          "The forecast is drawn as a single line, with no uncertainty band - the chart does not say how wide the interval of values it allows actually is.",
        noCentral:
          "The chart carries band edges alone, without a central path, so the value the interval is built around is not visible.",
        singleForecastStep:
          "The forecast is one step long, so the band has nothing to fan out over - this is an interval at one point, not a fan.",
        singleLevel:
          "The fan has one confidence level, so it shows one width of the interval, not the shape of the uncertainty.",
        tooManyLevels:
          "There are more than {{max}} confidence levels, and neighbouring bands differ in opacity below the threshold of separability - the chart does not show where one ends and the next begins.",
        constantBand:
          "The band keeps the same width across the whole forecast, so the chart does not show uncertainty growing with the horizon.",
      },
    },
    indexBase: {
      axis: {
        period: "Period",
        index: "Index (base = 100)",
        unitless:
          "The values on this axis carry no unit: they are the value of the period divided by the value of the base period, times one hundred. The unit of the data stands with the source value column.",
      },
      base: {
        label: "Base: {{period}} = 100",
        reference: "Reference line: 100, the level of the base period",
        source: {
          explicit: "The base period was chosen by the author.",
          first: "No base period was given, so the first period of the series is the base.",
          none: "The chart has no period axis, so it has no base period.",
        },
      },
      axisTruncated:
        "The axis does not start at zero, because indices live around one hundred; the range always contains the reference line at one hundred, the point every value is read from.",
      table: {
        period: "Period",
        source: "Source value",
        index: "Index",
        sourceUnit: "Source value ({{unit}})",
        series: "Series",
        base: "Base value",
        baseToMedian: "Base to median",
        status: "Series status",
        bases: "Series bases and reason for exclusion",
        baseRow: "base row: here every series on the chart is exactly one hundred",
      },
      rejection: {
        missingBase: "no value in the base period, so there is nothing to index from",
        zeroBase: "the base value is zero, so the index would be a division by zero",
        negativeBase:
          "the base value is negative, and dividing by it reverses direction: a fall would come out as a rise",
      },
      note: {
        noBase: "no usable base: the series is not on the chart, its numbers stay in the table",
        extremeBase:
          "the base period is an outlier in its own series, so the whole index is measured from an atypical point",
        mixedSign: "the series crosses zero, so reading the index as “percent of base” fails here",
        unrepresentable: "some points dropped out: the ratio falls outside the range of numbers",
        flat: "the series lies on the reference line: its departure from one hundred is smaller than the last displayed digit",
      },
      honesty: {
        baseInRangeOk:
          "The requested base period falls outside the period axis, so the base is {{period}} - the “= 100” caption then names a different period than the author gave.",
        baseNamedOk:
          "The base period has no label, so the caption breaks off at “= 100” and does not say which period every value on this chart is measured against.",
        baseUsableOk:
          "The series {{names}} have no value in the base period to index from, so they are not on the chart; their source values stay in the data table.",
        baseTypicalOk:
          "In the series {{names}} the base period falls outside the Tukey fence of its own series, so departures from one hundred are measured from a period atypical for this data.",
        indexRepresentableOk:
          "In the series {{names}} some points have no index: the ratio left the range of numbers and those points are not on the chart.",
        signStableOk:
          "The series {{names}} cross zero, so their index is positive in some periods and negative in others - an index of -40 does not mean a fall of forty percent.",
        spreadOk:
          "Every index computed sits at one hundred, so there is no difference in pace in this data for the chart to show.",
        pointsInPeriodsOk_one:
          "{{count}} number falls past the last period on the axis, so it is neither on the chart nor in the table.",
        pointsInPeriodsOk_other:
          "{{count}} numbers fall past the last period on the axis, so they are neither on the chart nor in the table.",
        declaredSampleOk:
          "The caption says n = {{declared}}, and {{actual}} periods carry a measurement.",
      },
      reading: {
        baseUnusable:
          "No series can be indexed from this period, so there is not a single line on the chart; the source values are in the data table.",
        seriesDropped_one:
          "{{count}} series is not on the chart, because it has no value in the base period to index from; its numbers stay in the data table.",
        seriesDropped_other:
          "{{count}} series are not on the chart, because they have no value in the base period to index from; their numbers stay in the data table.",
        singleSeries:
          "There is one line on the chart, so there is no other pace to compare it against - and the index took away its unit and its level, which are in the data table.",
        shortSeries:
          "There is one period, so every series has an index of exactly one hundred: the chart shows the definition of an index, not the data.",
        extremeBase:
          "The base period is an outlier in the series, so departures from one hundred are measured from an atypical point and come out larger than the data alone gives.",
        mixedSign:
          "The series crosses zero, so its index is positive in some periods and negative in others: an index of -40 does not mean a fall of forty percent.",
        noSpread:
          "Every line lies on the reference line at one hundred, so no difference in pace can be read from the chart.",
        tooManySeries:
          "There are more than {{max}} lines, and above that set the colours stop being separable for every kind of colour vision - the legend cannot then be matched to a line by colour alone.",
      },
    },
    percentStacked: {
      axis: { category: "Category", share: "Share of the whole" },
      scaleNote:
        "Only the segment at the reference edge starts at zero; the rest lie on shifted scales, so their length is read as the difference of two edges. The span of the share and the shift between the first and the last bar are given in the table.",
      table: {
        category: "Category",
        series: "Series",
        value: "Value",
        share: "Share",
        total: "Category total",
      },
      summary: {
        series: "Series",
        bars: "Bars with a share",
        total: "Total value",
        minShare: "Smallest share",
        maxShare: "Largest share",
        span: "Share span",
        first: "Share in the first bar",
        last: "Share in the last bar",
        shift: "Shift",
      },
      note: {
        empty: "no series gave a number in this category",
        zeroTotal:
          "the components add up to zero: there is no structure, so the bar is a gap, not a bar filled by the first series",
        rejected: "bar rejected: it holds a negative value or one outside the range of numbers",
        incomplete:
          "a component the other bars have is missing here, so these shares come from a different denominator",
        rescaled:
          "the shares given in the sheet were rescaled to a full whole: the number on the segment differs from the number in the sheet",
        duplicate: "the category label repeats in the sheet",
      },
      cellNote: {
        zero: "zero given in the sheet: the component is known and equals zero",
        missing: "no number was given - this is not a zero, it is an empty field",
        negative: "negative value: a negative share has no length",
        tooLarge: "value outside the range in which the total can still be checked",
        noShare:
          "the value is positive, but the bar has no denominator, so there is nothing to compute a share from",
      },
      honesty: {
        valuesNonNegativeOk:
          "The categories {{labels}} hold a negative value. A negative share has no length, so those bars carry not a single segment - their numbers are in the data table only.",
        totalsPositiveOk:
          "In the categories {{labels}} the components add up to zero, so there is no structure and a gap stands where the bar would be.",
        structureComparableOk:
          "The bars {{labels}} lack a component the others have, so their shares come from a different denominator - and they look exactly the same.",
        declaredTotalsOk:
          "The shares given in the sheet do not add up to one hundred in the categories {{labels}}, so they were rescaled to a full whole: the number on the segment differs from the number in the sheet.",
        emptyCategories:
          "The categories {{labels}} hold no number at all, so they stand on the axis without a bar.",
        outOfRange:
          "The categories {{labels}} hold a value outside the range in which the total can still be checked, so those bars are not drawn.",
        duplicateCategories:
          "The category label {{labels}} repeats, and there is no second carrier of category identity under a bar, so two bars of the same name cannot be told apart.",
        duplicateSeries:
          "The series name {{names}} repeats. Segment identity here is carried only by the legend or by a direct label, so no channel separates those segments.",
        roundingShift:
          "The displayed share differs from the exact one by at most {{pp}} percentage points: the label is a rounding, the length of the segment is not.",
        droppedValues_one:
          "{{count}} number has no bar to enter: the value was added, the category was not.",
        droppedValues_other:
          "{{count}} numbers have no bar to enter: the value was added, the category was not.",
      },
      reading: {
        negativeValues:
          "The data holds a negative value, and a negative share has no length - the bars it sits in carry not a single segment on the chart.",
        tooManySegments:
          "There are more than {{max}} segments, and above that set the colours stop being separable for every kind of colour vision - the legend cannot then be matched to the stack by colour alone.",
        singleSegment:
          "The stack has one series, so every bar is full at one hundred percent: a one-component structure is not a structure.",
        singleBar:
          "There is one bar on the chart, so its structure has nothing to be compared against; the shares of this single whole are in the data table.",
        noStructure:
          "No bar has a structure to draw: only gaps, zero totals or rejected bars. The numbers are in the data table.",
      },
    },
    smallMultiples: {
      axis: { category: "Category", value: "Value", index: "Index (base = 100)" },
      axisTruncated:
        "The value axis does not start at zero: the scale is cut, so the changes on the lines look larger than they are. The full numbers are in the data table.",
      scale: {
        shared: "All panels share one value axis.",
        free: "Each panel has its own value axis, so two lines at the same height do not stand for the same value.",
        freeScaleNote: "Why the panels have separate scales: {{note}}",
        sharedDomain: "Shared value axis: from {{min}} to {{max}}",
        levelRatio: "The panels differ in level by a factor of {{ratio}}.",
      },
      order: {
        mean: "Panels ordered by mean.",
        max: "Panels ordered by largest value.",
        span: "Panels ordered by span.",
        last: "Panels ordered by last value.",
        label: "Panels ordered by name.",
        input: "The panels stand in sheet order.",
      },
      summary: {
        panel: "Panel",
        n: "Observations",
        min: "Minimum",
        max: "Maximum",
        mean: "Mean",
        first: "First value",
        last: "Last value",
        change: "Change",
        changePct: "Change in percent",
        occupancy: "Share of the shared axis",
      },
      note: {
        gap: "gap: nothing was measured, so the line breaks here",
        clamped: "value clamped to the panel edge: the point sits where there is no data",
        empty:
          "a panel with no value at all: an empty panel means there is no data for this subject, not that its values are zero",
        flattened: "panel flattened by the shared axis: its numbers cannot be read from the chart",
        noIndexBase: "no value in the base category, so this panel has no line in index mode",
      },
      honesty: {
        commonScaleOk:
          "Each panel has its own value axis, so two lines at the same height can stand for values orders of magnitude apart. The axis the panels do not share would run from {{min}} to {{max}}.",
        freeScaleDeclaredOk:
          "The panels have separate value axes and the author gave no reason for separating them - the chart alone comes out looking comparable, which it is not.",
        sharedScaleReadableOk_one:
          "The shared axis flattens {{count}} of {{total}} panels: its changes fit inside the thickness of its own line, so it reads as “nothing happened”.",
        sharedScaleReadableOk_other:
          "The shared axis flattens {{count}} of {{total}} panels: their changes fit inside the thickness of their own line, so they read as “nothing happened”.",
        sameUnitOk:
          "The panels measure in different units, so a shared axis would set the incomparable side by side; the scales were separated and heights cannot be compared across panels here.",
        emptyPanelsKeptOk:
          "The grid holds panels with no value at all: an empty panel means there is no data for that subject, not that its values are zero. Dropping them was requested, but a panel removed from the grid would take the subject away along with the fact that there is no data for it.",
        orderFromDataOk:
          "The order of the panels does not come from the data, and the first row of the grid carries the first impression - here that impression is the order of the sheet.",
        inGridOk_one:
          "{{count}} number did not reach any panel: it falls past the last category, so it is neither on the chart nor in the table.",
        inGridOk_other:
          "{{count}} numbers did not reach any panel: they fall past the last category, so they are neither on the chart nor in the table.",
        inDomainOk:
          "Some values were clamped to the panel edge, so the point sits where there is no data.",
        zeroBaselineOk:
          "The panels encode value with length, and the axis does not contain zero - the proportion of the lengths is then distorted outright.",
        indexBaseOk:
          "The panels {{labels}} have no value in the base category, so they have no line in index mode; a panel without a line among panels with lines reads as no change, not as no base.",
        spreadOk:
          "In no panel does the smallest value differ from the largest, so there is no change in the data for this grid to show.",
        declaredSampleOk:
          "The caption says n = {{declared}}, and {{actual}} points carry a measurement.",
        paletteWrapOk:
          "There are more panels than palette slots and the panels carry different slots, so two panels get the same colour without standing in any relation - the colour looks like a key here without being one.",
      },
      reading: {
        singlePanel:
          "There is one panel with data, so there is nothing to compare it against - and the panel grid took away its room for axes and labels.",
        tooManyPanels:
          "There are {{count}} panels, more than {{max}} - at this density a panel is so short that the ticks of its value axis cannot be read.",
        indexBaseBetter:
          "The shared axis flattens every panel but at most one, so no change can be read from the rest; their numbers are in the data table.",
        undeclaredFreeScale:
          "The panels have separate value axes, so two lines at the same height do not stand for the same value; what stays comparable across panels is the shape of the line, not its height.",
        mixedUnits:
          "The panels measure in different units, so their heights cannot be compared; the unit of each panel stands with its name in the data table.",
        noSpread: "No panel has any span, so every line is flat.",
        sheetOrder:
          "The panels stand in sheet order, so the first row is neither the largest nor the most changed - nothing follows from their order.",
        oneCategory:
          "The category axis has one point, so a panel shows neither a course nor a distribution - each is a single value in a frame.",
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
      keyboardHintSlices: "Tab moves between slices, Escape clears the selection.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** A live binding lets the route splitter keep registration with its view. */
export function ensureI18n(): void {}
