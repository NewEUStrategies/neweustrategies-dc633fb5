// PORADY DLA AUTORA BLOKU - NAKŁADKA WYŁĄCZNIE DLA PANELU ADMINA.
//
// PO CO OSOBNY PLIK, a nie sekcja w `i18n-charts.ts`. Te napisy mówią do
// AUTORA, nie do czytelnika: "powyżej sześciu barw paleta przestaje być
// rozdzielna", "podpis bez zdania o tym, czego wykres NIE pokazuje, zamienia
// wykres analityczny w ilustrację". Czytelnik opublikowanego wpisu nie może
// nic z tą informacją zrobić - nie wybiera formy wykresu ani nie pisze
// podpisu - a mimo to płacił za nią transferem, bo słownik wykresów jest
// importowany przez ramę karty na każdej publicznej stronie z wykresem.
//
// Nakładki i18n są w tym repozytorium ADDYTYWNE (`addResourceBundle` z `deep`
// i `overwrite`), więc podział niczego nie psuje: klucze `charts.editor.*`
// istnieją dokładnie tam, gdzie ktoś je woła, i tylko tam. Jedynym
// konsumentem jest `DataVizBlocks.tsx`, czyli edytor bloku w panelu, a kod
// panelu jedzie osobnymi chunkami - bramka budżetu bundla liczy je do
// OVERALL, nie do publicznego. Pilnuje tego bramka
// `check:i18n-overlay-imports`: kto woła klucz z nakładki, ten musi tę
// nakładkę zaimportować.
//
// PODZIAŁ PO ODBIORCY, NIE PO TEMACIE - to powód, dla którego bloki
// `<rodzaj>.advice.*` przeniosły się tutaj z nakładki publicznej.
//
// Pięć renderów (boxplot, rój, punktowy, mapa ciepła, tornado) drukowało
// PORADY FORMY pod rysunkiem na OPUBLIKOWANEJ stronie. Część tych zdań jest
// dla czytelnika użyteczna („kwartyle zbiegają się w jednym punkcie" zmienia
// sposób czytania obrazka), ale druga część mówi wprost do autora: „Beeswarm
// pokaże je wszystkie", „Zmniejsz znacznik", „Podaj równe kroki". Czytelnik
// opublikowanego wpisu nie przełączy formy wykresu ani nie poprawi danych -
// dla niego to instrukcja bez adresata, a przy tym podważa wykres, którego
// nie może naprawić.
//
// Dlatego każdy komunikat rozpadł się na dwa: OBSERWACJĘ o tym rysunku
// (`<rodzaj>.reading.*`, zostaje w nakładce publicznej i renderuje się pod
// wykresem) oraz ZALECENIE zmiany formy albo danych (`<rodzaj>.advice.*`,
// czyli to, co jest tutaj, i widzi je wyłącznie autor w edytorze bloku).
// Klucze bez połowy obserwacyjnej - `beeswarm.tooFew`, `scatter.lineBetter`,
// `tornado.noBase` - nie mają odpowiednika w `reading` wcale, bo nie ma w nich
// nic, co czytelnik mógłby z rysunku odczytać.
//
// PRZY OKAZJI USUNIĘTY MARTWY KLUCZ `smoothingWithoutPoints`. Ostrzegał przed
// wygładzoną linią bez widocznych punktów obserwacji, a `shouldShowDots`
// zwraca `smoothing > 0 || pointCount <= DOTS_MAX_POINTS` - czyli wygładzenie
// SAMO zapala punkty i ten stan jest w tym silniku nieosiągalny. Klucz był
// zdefiniowany w obu językach i nie wołał go nikt. Ostrzeżenie o defekcie,
// który nie może wystąpić, jest gorsze od jego braku: sugeruje czytającemu
// kod, że taki stan istnieje.
import i18n from "@/lib/i18n";

const pl = {
  charts: {
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
      missingNotes:
        "Podpis bez zdania „czego nie pokazuje” zmienia wykres analityczny w ilustrację.",
    },
    histogram: {
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
    },
    boxplot: {
      advice: {
        dotsBetter:
          "Przy tak małej próbce pudełko podsumowuje prawie każdą obserwację osobno. Beeswarm pokaże je wszystkie i nie ukryje niczego za kwartylem.",
        tiesDominant:
          "Powtórzona wartość zajmuje ponad połowę obserwacji, więc kwartyle zbiegają się w jednym punkcie i pudełko robi się kreską. Histogram albo tabela liczebności powie o tych danych więcej.",
        singleGroup:
          "Jedna grupa nie ma z czym się porównać, a boxplot jest formą PORÓWNAWCZĄ. Do pojedynczego rozkładu czytelniejszy jest histogram albo beeswarm.",
      },
    },
    beeswarm: {
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
    },
    scatter: {
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
    },
    heatmap: {
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
    },
    tornado: {
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
  },
};

const en: typeof pl = {
  charts: {
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
      missingNotes:
        "A caption without the “what it does not show” sentence turns an analytical chart into an illustration.",
    },
    histogram: {
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
    },
    boxplot: {
      advice: {
        dotsBetter:
          "With a sample this small the box summarises almost every observation separately. A beeswarm shows them all and hides nothing behind a quartile.",
        tiesDominant:
          "A repeated value covers more than half the observations, so the quartiles collapse to one point and the box becomes a line. A histogram or a frequency table says more about this data.",
        singleGroup:
          "A single group has nothing to be compared against, and a boxplot is a COMPARATIVE form. For one distribution a histogram or a beeswarm reads better.",
      },
    },
    beeswarm: {
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
    },
    scatter: {
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
    },
    heatmap: {
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
    },
    tornado: {
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
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** Żywe wiązanie utrzymuje rejestrację razem z widokiem edytora. */
export function ensureChartsEditorI18n(): void {}
