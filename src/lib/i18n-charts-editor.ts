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
          "Etykiety liczbowe osi nie idą po kolei, więc sąsiedztwo komórek nie odpowiada sąsiedztwu wartości. Uporządkuj etykiety rosnąco albo malejąco - mapa ciepła czyta się wzdłuż osi, nie po adresach.",
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
    // WACHLARZ. Wszystkie wstawki tych zaleceń są STAŁYMI MODELU, nie liczbami
    // z arkusza - `KindFormAdvice.values` dostaje tylko nazwę porady i język,
    // więc worek liczb nie ma skąd wziąć niczego, co zależy od danych. Liczba
    // z arkusza (ile serii wypadło, ile kroków ma prognoza) jedzie wyłącznie do
    // odpowiednika `reading.*`, który pisze render - ten model ma.
    fan: {
      advice: {
        noForecast:
          "Bez granicy prognozy wachlarz jest zwykłym wykresem liniowym - forma nie ma treści, po którą się po nią sięga. Podaj krok, od którego zaczyna się prognoza, albo weź wykres liniowy.",
        noBand:
          "Prognoza bez pasma niepewności twierdzi, że znasz przyszłą wartość, a znasz najwyżej rozkład. Podaj pary krawędzi nazwane pewnością („80% dolna”, „80% górna”), jawne poziomy pewności albo choć jedną szerokość pasma.",
        noCentral:
          "Pasma bez ścieżki centralnej nie mają wokół czego leżeć, a czytelnik nie ma od czego liczyć odchyleń. Dodaj serię o nazwie centrum („centralna”, „mediana”, „P50”) albo wskaż ją wprost.",
        singleForecastStep:
          "Jeden krok prognozy to przedział przy ostatniej obserwacji, a nie wachlarz - pasmo nie ma jak się rozejść. Wachlarz zaczyna mieć treść od {{min}} kroków.",
        singleLevel:
          "Jeden poziom pewności pokazuje szerokość niepewności, ale nie jej kształt. Trzy zagnieżdżone pasma (50/80/95) mówią to, po co się do tej formy przychodzi.",
        tooManyLevels:
          "Powyżej {{max}} zagnieżdżonych pasm kolejne stopnie krycia schodzą poniżej progu rozróżnialności powierzchni i czytelnik przestaje widzieć granicę między poziomami. Zostaw trzy poziomy, a resztę wypisz w tabeli.",
        constantBand:
          "Pasmo o stałej szerokości nie mówi nic o horyzoncie, a niepewność prognozy zwykle rośnie z każdym krokiem. Sprawdź, czy szerokość nie została wklejona jako jedna liczba na wszystkie kroki.",
      },
    },
    indexBase: {
      advice: {
        baseUnusable:
          "Żadna seria nie ma w okresie bazowym wartości dodatniej, więc wykresu nie ma - indeks nie ma czym dzielić. Wskaż inny okres bazowy: najwcześniejszy, w którym każda seria ma wartość dodatnią.",
        seriesDropped:
          "Część serii wypadła z rysunku, bo w okresie bazowym nie ma w nich wartości dodatniej. Przesuń okres bazowy albo usuń te serie z bloku - seria nieobecna wśród obecnych czyta się jako „nie było takiego szeregu”.",
        singleSeries:
          "Indeks jednej serii nie wnosi nic: przekształcenie jest liniowe, więc kształt linii jest ten sam co przy poziomach, a czytelnik traci jednostkę i poziom. Weź zwykły wykres liniowy w jednostkach autora.",
        shortSeries:
          "Poniżej {{min}} okresów rysunek pokazuje definicję indeksu, a nie dane - w okresie bazowym każda seria ma sto. Podaj dłuższy szereg.",
        extremeBase:
          "Okres bazowy odstaje od własnego szeregu dalej niż o {{factor}} rozstępu międzykwartylowego, więc jeden nietypowy okres wyolbrzymia cały indeks. Wybierz na bazę okres typowy dla tych danych.",
        mixedSign:
          "Szereg przechodzi przez zero, więc odczyt „procent bazy” przestaje być czytelny: indeks -40 nie znaczy spadku o czterdzieści procent. Przy takich danych uczciwsze są poziomy w jednostkach autora albo panele.",
        noSpread:
          "Wszystkie indeksy siedzą w setce, więc rysunek pokazuje same linie odniesienia. To informacja na jedno zdanie, nie na wykres.",
        scaleComparable:
          "Szeregi różnią się rzędem wielkości mniej niż {{ratio}}-krotnie, więc przesłanki z tabeli doboru form tu nie ma - wspólna oś poziomów jest czytelna i zostawia jednostkę. Indeks zostaw wtedy, gdy porównujesz TEMPO, a nie poziom.",
        tooManySeries:
          "Powyżej {{max}} kolorów kategorialnych paleta przestaje być rozdzielna dla daltonizmu. Przy tylu szeregach właściwa jest druga forma z tego samego wiersza tabeli doboru: small multiples.",
      },
    },
    percentStacked: {
      advice: {
        negativeValues:
          "Udział ujemny nie ma długości, więc stos 100% z takim składnikiem nie istnieje - słupki z wartością ujemną są odrzucane w całości, a nie sumowane po modułach. Rozłóż te dane na dwa wykresy: strukturę dodatnią i osobno pozycje ujemne.",
        tooManySegments:
          "Powyżej {{max}} serii kolor przestaje nieść kategorię dla każdego rodzaju widzenia barw, a w stosie tożsamości segmentu nie niesie nic poza kolorem i etykietą. Zgrupuj ogon w jedną pozycję zbiorczą albo idź w small multiples.",
        singleSegment:
          "Jedna seria daje w każdym słupku jeden segment o udziale sto procent, czyli rysunek pełnych słupków jednakowej długości. Wartości bezwzględne pokazuje wtedy zwykły słupek, nie stos.",
        singleBar:
          "Jeden słupek nie ma z czym być porównany, a stos 100% bierze się właśnie po porównanie struktur. Dla jednej całości tabela doboru formy dopuszcza pierścień do pięciu kategorii.",
        noStructure:
          "Żaden słupek nie ma mianownika: kategorie są puste, sumują się do zera albo zostały odrzucone. Sprawdź, czy liczby nie stoją w kolumnie, której blok nie czyta.",
      },
    },
    smallMultiples: {
      advice: {
        singlePanel:
          "Jeden panel to nie small multiples, tylko wykres, któremu siatka odebrała miejsce na osie i etykiety. Poniżej {{min}} paneli weź zwykły wykres liniowy albo słupkowy.",
        tooManyPanels:
          "Powyżej {{max}} paneli schodzą one do rozmiaru sparkline: kształt jeszcze widać, ale osi wartości już się nie odczyta. Wtedy tę samą treść niesie tabela ze sparklines, w której liczba stoi w kolumnie obok kształtu.",
        indexBaseBetter:
          "Wspólna oś jest uczciwa, ale przy tej różnicy poziomów bezużyteczna - wszystkie panele poza jednym są płaskimi kreskami. Odpowiedzią jest indeks bazowy (baza = 100), czyli wspólna oś TEMPA, a NIE osobne skale: te odbierają porównaniu sens.",
        undeclaredFreeScale:
          "Panele mają osobne osie i nikt tego nie napisał, więc rysunek wygląda na porównywalny, nie będąc. Wróć do wspólnej osi albo podaj zdanie opisujące osobne skale - render ma obowiązek je wypisać pod wykresem.",
        mixedUnits:
          "Panele mierzą różne rzeczy, więc wspólna oś zestawia nieporównywalne dokładnie tak, jak robią to dwie osie Y. Przy wskaźnikach o różnych jednostkach uczciwe są indeks bazowy albo osobne skale Z OPISEM.",
        noSpread:
          "Żaden panel nie ma rozpiętości, więc wszystkie linie są płaskie. To informacja na jedno zdanie, nie na siatkę paneli.",
        sheetOrder:
          "Kolejność paneli jest kolejnością arkusza, a czytelnik czyta panele rzędami i pierwsze wrażenie bierze z pierwszego rzędu - przy następnym wklejeniu danych ten sam zestaw opowie inną historię. Posortuj panele kluczem z danych: średnią, maksimum, rozpiętością albo wartością ostatnią.",
        oneCategory:
          "Oś kategorii ma jeden punkt, więc panel nie pokazuje ani przebiegu, ani rozkładu. Przy jednej kategorii porównanie podmiotów robi się posortowanymi słupkami poziomymi, w których wartość koduje długość.",
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
          "The numeric axis labels do not run in order, so neighbouring cells do not stand for neighbouring values. Sort the labels ascending or descending - a heatmap is read along its axes, not by address.",
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
    fan: {
      advice: {
        noForecast:
          "Without a forecast boundary a fan is an ordinary line chart - the form has none of the content it is reached for. Give the step the forecast starts at, or use a line chart.",
        noBand:
          "A forecast without an uncertainty band claims you know the future value, when you know a distribution at best. Give pairs of edges named by confidence (“80% lower”, “80% upper”), explicit confidence levels, or at least one band width.",
        noCentral:
          "Band edges with no central path have nothing to lie around, and the reader has nothing to measure deviations from. Add a series named as the centre (“central”, “median”, “P50”) or point to it directly.",
        singleForecastStep:
          "One forecast step is an interval at the last observation, not a fan - the band has no room to fan out. A fan starts carrying content from {{min}} steps on.",
        singleLevel:
          "One confidence level shows the width of the uncertainty but not its shape. Three nested bands (50/80/95) say what this form is reached for.",
        tooManyLevels:
          "Above {{max}} nested bands the successive steps of opacity fall below the threshold at which surfaces stay separable, and the reader stops seeing the boundary between levels. Keep three levels and list the rest in the table.",
        constantBand:
          "A band of constant width says nothing about the horizon, and forecast uncertainty usually grows with every step. Check whether the width was pasted in as one number for all steps.",
      },
    },
    indexBase: {
      advice: {
        baseUnusable:
          "No series has a positive value in the base period, so there is no chart - the index has nothing to divide by. Point to another base period: the earliest one in which every series has a positive value.",
        seriesDropped:
          "Some series fell off the chart, because they have no positive value in the base period. Move the base period or drop those series from the block - a series absent among present ones reads as “there was no such series”.",
        singleSeries:
          "Indexing one series adds nothing: the transform is linear, so the shape of the line is the same as at levels, while the reader loses the unit and the level. Use an ordinary line chart in the author's units.",
        shortSeries:
          "Below {{min}} periods the chart shows the definition of an index rather than the data - in the base period every series is at one hundred. Give a longer series.",
        extremeBase:
          "The base period lies further from its own series than {{factor}} interquartile ranges, so one atypical period inflates the whole index. Choose a base period typical for this data.",
        mixedSign:
          "The series crosses zero, so reading the index as “percent of base” stops working: an index of -40 does not mean a fall of forty percent. For data like this, levels in the author's units or panels are more honest.",
        noSpread:
          "Every index sits at one hundred, so the chart shows nothing but reference lines. That is a one-sentence fact, not a chart.",
        scaleComparable:
          "The series differ in magnitude by less than a factor of {{ratio}}, so the premise from the form selection table is not there - a shared axis of levels is readable and keeps the unit. Keep the index when you are comparing PACE rather than level.",
        tooManySeries:
          "Above {{max}} categorical colours the palette stops being separable for colour-blind readers. With this many series the right form is the other one from the same row of the selection table: small multiples.",
      },
    },
    percentStacked: {
      advice: {
        negativeValues:
          "A negative share has no length, so a 100% stack with such a component does not exist - bars holding a negative value are rejected whole rather than summed by modulus. Split this data into two charts: the positive structure, and the negative items separately.",
        tooManySegments:
          "Above {{max}} series colour stops carrying category for every kind of colour vision, and in a stack nothing but colour and the direct label carries segment identity. Group the tail into one aggregate item or move to small multiples.",
        singleSegment:
          "One series gives every bar a single segment at one hundred percent, that is a chart of full bars of equal length. Absolute values are shown by an ordinary bar, not by a stack.",
        singleBar:
          "One bar has nothing to be compared against, and a 100% stack is reached for exactly that comparison. For a single whole the form selection table allows a ring of up to five categories.",
        noStructure:
          "No bar has a denominator: the categories are empty, add up to zero, or were rejected. Check whether the numbers sit in a column the block does not read.",
      },
    },
    smallMultiples: {
      advice: {
        singlePanel:
          "One panel is not small multiples, it is a chart the grid took the room for axes and labels away from. Below {{min}} panels use an ordinary line or bar chart.",
        tooManyPanels:
          "Above {{max}} panels they drop to the size of a sparkline: the shape is still visible, but the value axis can no longer be read. A table with sparklines then carries the same content, with the number in a column next to the shape.",
        indexBaseBetter:
          "The shared axis is honest but useless at this difference of levels - every panel but one is a flat line. The answer is an index base (base = 100), a shared axis of PACE, and NOT separate scales: those take the sense out of the comparison.",
        undeclaredFreeScale:
          "The panels have separate axes and nobody wrote that down, so the chart looks comparable without being comparable. Go back to a shared axis, or give the sentence describing the separate scales - the renderer is obliged to print it under the chart.",
        mixedUnits:
          "The panels measure different things, so a shared axis sets the incomparable side by side exactly as two Y axes do. For indicators in different units, an index base or separate scales WITH A DESCRIPTION are honest.",
        noSpread:
          "No panel has any span, so every line is flat. That is a one-sentence fact, not a grid of panels.",
        sheetOrder:
          "The order of the panels is the order of the sheet, while the reader reads panels by rows and takes the first impression from the first row - paste the data in another order and the same set tells a different story. Sort the panels by a key from the data: mean, maximum, span, or last value.",
        oneCategory:
          "The category axis has one point, so a panel shows neither a course nor a distribution. With one category the comparison of subjects is made with sorted horizontal bars, where length encodes the value.",
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** Żywe wiązanie utrzymuje rejestrację razem z widokiem edytora. */
export function ensureChartsEditorI18n(): void {}
