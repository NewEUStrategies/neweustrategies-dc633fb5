// Kolizje etykiet osi kategorii: DRABINA, nie jedna sztuczka.
//
// Reguła nadrzędna: NIGDY NIE OBCINAJ WIELOKROPKIEM BEZ PEŁNEJ TREŚCI OBOK.
// Wielokropek jest wygodny dla rysującego i bezużyteczny dla czytelnika -
// "Wielkopolsk…" i "Wielkopolska Wschodnia" wyglądają identycznie, a to dwie
// różne kategorie. Silnik schodzi więc po szczeblach i dopiero ostatni z nich
// coś czytelnikowi zabiera:
//
//   1. PRZERZEDŹ co n-tą etykietę, zawsze zostawiając PIERWSZĄ I OSTATNIĄ.
//      Pierwsza i ostatnia niosą zakres osi - bez nich czytelnik nie wie,
//      gdzie szereg się zaczyna i kończy, a to jest ważniejsze niż każda
//      etykieta pośrednia.
//   2. SKRÓĆ SEMANTYCZNIE (2024-Q1 -> Q1'24). Skrót semantyczny zachowuje
//      całą informację w krótszym zapisie, więc nic nie ginie - inaczej niż
//      przy ucięciu.
//   3. OBRÓĆ o -45 stopni z `text-anchor: end`. Obrót kupuje miejsce w pionie
//      zamiast w poziomie: obok siebie etykiety potrzebują już tylko
//      rozdzielenia wysokością wiersza, nie własnej szerokości.
//   4. Dopiero gdy i to nie wystarcza, przerzedzamy obrócone etykiety - i to
//      jest jedyny szczebel, na którym część napisów naprawdę znika z osi
//      (ich treść zostaje w tooltipie i w tabeli danych).
//
// ZAWINIĘCIE W DWIE LINIE (`<tspan>` z odstępem 1,2 em) wchodzi PRZED
// przerzedzeniem, a nie po obrocie, jak każe specyfikacja - i jest to
// odstąpienie z dowodem, nie z gustu. Na pozycji ze specyfikacji ten mechanizm
// jest nieosiągalny: wchodzi się tam po kroku przerzedzania większym od 3,
// czyli gdy napis jest szerszy niż TRZY pasma, a zawinięcie na dwie linie
// wymaga, żeby każda linia zmieściła się w JEDNYM paśmie - te dwa warunki
// wykluczają się wzajemnie. Pełny wywód stoi przy implementacji. Zawinięcie
// nie zabiera ani jednej etykiety, więc na pozycji "zamiast przerzedzenia"
// działa w duchu reguły nadrzędnej.
//
// Ostatni szczebel ze specyfikacji - zamiana na słupki poziome - jest decyzją
// AUTORA, nie silnika: zmienia typ wykresu, a tego kod nie robi za człowieka.
// Edytor podpowiada go w ostrzeżeniu.

/** Minimalny prześwit między dwiema sąsiednimi etykietami w pikselach. */
export const LABEL_GAP = 6;

/**
 * Powyżej tego kroku przerzedzania szukamy innego szczebla. Krok 4 znaczy
 * "trzy z czterech etykiet znikają" - wtedy taniej kosztuje skrócenie zapisu
 * albo obrót niż dalsze wycinanie.
 */
export const MAX_THIN_STEP = 3;

export type CategoryLabelMode = "full" | "thinned" | "shortened" | "rotated" | "wrapped";

export interface CategoryLabelPlan {
  mode: CategoryLabelMode;
  /** Etykiety do narysowania - po skrócie semantycznym, jeśli był. */
  labels: string[];
  /** Pełna treść etykiety pod indeksem (do tooltipa `<title>`). */
  full: string[];
  /** Co ile rysujemy etykietę. 1 = wszystkie. */
  step: number;
  /** Indeksy, które naprawdę są rysowane. */
  visible: number[];
  /** Obrót w stopniach: 0 albo -45. */
  rotation: number;
  /** Ile pikseli etykiety potrzebują POD obszarem kreślenia. */
  bottomSpace: number;
  /**
   * Linie zawinięcia per indeks - WYŁĄCZNIE w trybie `wrapped`.
   *
   * Obecne tylko tam, gdzie mają znaczenie, a nie zawsze jako tablice
   * jednoelementowe: gdyby były zawsze, każdy `<text>` w silniku musiałby
   * przejść na `<tspan>`, czyli zmienilibyśmy DOM wszystkich wykresów po to,
   * żeby obsłużyć jeden szczebel drabiny. Renderer rozgałęzia się raz, po
   * `mode`.
   */
  lines?: string[][];
}

export interface PlanOptions {
  /** Pikseli na jedną kategorię (szerokość pasma albo odstęp punktów). */
  slotWidth: number;
  fontSize: number;
  /** Pomiar szerokości napisu; heurystyka, gdy kanwa niedostępna. */
  measure: (text: string) => number;
  /**
   * Ile pikseli wolno zająć POD obszarem kreślenia. Bez limitu, gdy pominięte.
   *
   * Istnieje dla szczebla obrotu, bo tylko on kupuje miejsce w poziomie za
   * miejsce w PIONIE - a wysokość wykresu jest skończona i zaczyna się od
   * 160 px. Obrócona etykieta "Województwo mazowieckie" potrzebuje pod osią
   * ~128 px, czyli więcej, niż taki wykres ma w całości do rozdania: rysunek
   * spadał wtedy do swojej podłogi, a nadwyżka marginesu przepadała i napisy
   * schodziły z płótna na podpis pod wykresem. Z limitem drabina wie, że
   * obrót jest nie do opłacenia, i wybiera szczebel, który się mieści.
   */
  maxBottomSpace?: number;
}

/**
 * Skrót semantyczny zapisów czasu. Obsługujemy WYŁĄCZNIE wzorce, w których
 * skrót nie traci informacji - reszta zapisów wraca bez zmian, bo lepszy
 * długi napis obrócony niż krótki i niejednoznaczny.
 */
export function shortenLabel(label: string): string {
  const text = label.trim();

  // 2024-Q1 / 2024 Q1 / 2024/Q1 -> Q1'24
  const yearFirstQuarter = /^(\d{4})[\s\-/]*[QKqk](\d)$/.exec(text);
  if (yearFirstQuarter) return `Q${yearFirstQuarter[2]}'${yearFirstQuarter[1].slice(2)}`;

  // Q1 2024 / K1 2024 -> Q1'24
  const quarterFirst = /^[QKqk](\d)[\s\-/]*(\d{4})$/.exec(text);
  if (quarterFirst) return `Q${quarterFirst[1]}'${quarterFirst[2].slice(2)}`;

  // 2024-01-15 -> 15.01
  const fullDate = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (fullDate) return `${fullDate[3]}.${fullDate[2]}`;

  // 2024-01 -> 01'24
  const yearMonth = /^(\d{4})-(\d{2})$/.exec(text);
  if (yearMonth) return `${yearMonth[2]}'${yearMonth[1].slice(2)}`;

  // 2024 -> '24. Skracamy TYLKO czyste lata: "1999" i "'99" znaczą to samo,
  // ale "2024" w napisie "Budżet 2024" już nie.
  const year = /^(\d{4})$/.exec(text);
  if (year) return `'${year[1].slice(2)}`;

  return text;
}

function maxWidth(labels: readonly string[], measure: (t: string) => number): number {
  let max = 0;
  for (const label of labels) max = Math.max(max, measure(label));
  return max;
}

/**
 * Indeksy do narysowania przy danym kroku. Pierwsza i ostatnia zostają
 * ZAWSZE; jeśli ostatnia wypadłaby zbyt blisko poprzedniej rysowanej,
 * poprzednia ustępuje - lepiej stracić etykietę pośrednią niż koniec osi.
 *
 * USTĘPUJE WYŁĄCZNIE ETYKIETA POŚREDNIA. Bez tego warunku ustępowała także
 * PIERWSZA: przy dwóch kategoriach i kroku 3 lista regularna to samo [0],
 * odległość do końca osi (1) jest mniejsza od pół kroku (1,5), więc zero
 * wypadało i oś zostawała z jedną etykietą - tą ostatnią. Czytelnik tracił
 * początek szeregu, czyli dokładnie to, czego ta funkcja ma pilnować.
 * Gwarancja "pierwsza i ostatnia zawsze" nie ma wyjątku dla małych zbiorów.
 */
export function visibleIndices(count: number, step: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const out: number[] = [];
  for (let i = 0; i < count; i += Math.max(1, step)) out.push(i);
  const last = count - 1;
  if (out[out.length - 1] !== last) {
    // Ostatnia rysowana i koniec osi muszą być od siebie oddalone o co
    // najmniej pół kroku, inaczej napisy się zderzą. Poświęcamy tylko
    // etykietę pośrednią - przy jednym elemencie na liście tym elementem
    // jest zero, a zera nie oddajemy.
    if (out.length > 1 && last - out[out.length - 1] < Math.max(1, step) / 2) out.pop();
    out.push(last);
  }
  return out;
}

/**
 * Odstęp między liniami zawiniętej etykiety, w jednostkach `em`.
 *
 * 1,2 em, nie 1,0: przy pełnej wysokości wiersza wydłużenia dolne pierwszej
 * linii ("g", "j", "ą") dotykają wydłużeń górnych drugiej i dwie linie czytają
 * się jako jedna plama. 1,2 em to ta sama proporcja, którą reszta silnika
 * używa na wysokość wiersza etykiet.
 */
export const WRAP_LINE_EM = 1.2;

/** Najwięcej linii, na jakie wolno złamać etykietę osi. */
export const WRAP_MAX_LINES = 2;

/**
 * Zawinięcie etykiety na co najwyżej `maxLines` linii mieszczących się
 * w `available` pikselach.
 *
 * ŁAMIEMY WYŁĄCZNIE NA GRANICY SŁOWA. Łamanie wewnątrz wyrazu jest tym samym
 * defektem co ucięcie wielokropkiem - "Wielkopol / skie" i "Wielkopolska /
 * Wschodnia" czytają się w pierwszej linii identycznie, a to dwie różne
 * kategorie. Napis, którego nie da się złamać na słowach albo który po
 * złamaniu wciąż nie mieści się w dostępnej szerokości, wraca jako `null` -
 * i wtedy drabina schodzi szczebel niżej, zamiast rysować coś, czego nie da
 * się przeczytać.
 *
 * ZACHŁANNIE, nie optymalnie (bez algorytmu Knutha-Plassa): przy dwóch liniach
 * i etykiecie osi optymalizacja podziału zmienia wynik w pojedynczych
 * przypadkach, a kod robi się nieporównanie trudniejszy w utrzymaniu.
 */
export function wrapLabel(
  label: string,
  available: number,
  measure: (text: string) => number,
  maxLines = WRAP_MAX_LINES,
): string[] | null {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (current !== "" && measure(candidate) > available) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) return null;
    } else {
      current = candidate;
    }
  }
  if (current !== "") lines.push(current);
  // Jedno słowo dłuższe od dostępnej szerokości nie ma gdzie się złamać -
  // zawinięcie nic tu nie kupuje i drabina musi wziąć inny szczebel.
  if (lines.some((line) => measure(line) > available)) return null;
  return lines.length <= maxLines ? lines : null;
}

/** Ile miejsca w poziomie potrzebuje etykieta obrócona o -45 stopni. */
function rotatedHorizontalNeed(fontSize: number): number {
  // Obrócone etykiety rozdziela wysokość wiersza rzutowana na oś X:
  // lineHeight / sin(45) = lineHeight * sqrt(2).
  return fontSize * 1.25 * Math.SQRT2;
}

export function planCategoryLabels(
  labels: readonly string[],
  { slotWidth, fontSize, measure, maxBottomSpace }: PlanOptions,
): CategoryLabelPlan {
  const full = [...labels];
  const lineHeight = Math.ceil(fontSize * 1.25);
  const straightBottom = lineHeight + LABEL_GAP;

  if (labels.length === 0) {
    return {
      mode: "full",
      labels: [],
      full,
      step: 1,
      visible: [],
      rotation: 0,
      bottomSpace: straightBottom,
    };
  }

  const available = Math.max(1, slotWidth);
  const stepFor = (set: readonly string[]): number =>
    Math.max(1, Math.ceil((maxWidth(set, measure) + LABEL_GAP) / available));

  // Szczebel 1: wszystko się mieści.
  const fullStep = stepFor(labels);
  if (fullStep === 1) {
    return {
      mode: "full",
      labels: full,
      full,
      step: 1,
      visible: visibleIndices(labels.length, 1),
      rotation: 0,
      bottomSpace: straightBottom,
    };
  }

  // Szczebel 1b: przerzedzenie w rozsądnym kroku. Ma sens tylko wtedy, gdy
  // JEST CO PRZERZEDZIĆ: przy dwóch kategoriach każdy indeks jest pierwszym
  // albo ostatnim, a tych nie usuwamy - przerzedzenie nie zwolniłoby ani
  // jednego piksela i ladder zatrzymywałby się na szczeblu, który niczego
  // nie naprawia. Wtedy właściwą odpowiedzią jest skrót albo obrót.
  if (fullStep <= MAX_THIN_STEP && labels.length > 2) {
    // ZAWINIĘCIE MA PIERWSZEŃSTWO PRZED PRZERZEDZENIEM, i to jest świadome
    // odstąpienie od kolejności zapisanej w specyfikacji, gdzie zawinięcie
    // jest szczeblem CZWARTYM (po obrocie). Powód jest arytmetyczny, nie
    // gustowy: na czwartym szczeblu ten mechanizm jest NIEOSIĄGALNY.
    //
    // Dowód. Na czwarty szczebel wchodzi się dopiero wtedy, gdy krok
    // przerzedzania przekroczył 3, czyli gdy najdłuższa etykieta jest szersza
    // niż TRZY pasma. Zawinięcie na dwie linie wymaga, żeby KAŻDA linia
    // zmieściła się w JEDNYM paśmie, czyli żeby cały napis (dwie linie plus
    // spacja) był węższy niż dwa pasma z ogonkiem. Te dwa warunki wykluczają
    // się wzajemnie - implementacja na czwartym szczeblu byłaby kodem
    // martwym, a martwy kod obiecujący szczebel drabiny jest gorszy od jego
    // braku.
    //
    // Miejsce, w którym zawinięcie realnie coś daje, jest dokładnie jedno:
    // TAM, GDZIE ALTERNATYWĄ JEST PRZERZEDZENIE. Przerzedzenie przy kroku 2
    // zabiera z osi połowę etykiet; zawinięcie nie zabiera żadnej i kosztuje
    // jedną wysokość wiersza, którą drabina umie sprawdzić wobec realnego
    // budżetu pod osią. Reguła nadrzędna tej drabiny brzmi "nie zabieraj
    // czytelnikowi niczego bez potrzeby", więc przy wyborze między "połowa
    // etykiet znika" i "etykiety mają dwie linie" wygrywa to drugie.
    const wrapBottom =
      lineHeight + Math.ceil(fontSize * WRAP_LINE_EM) * (WRAP_MAX_LINES - 1) + LABEL_GAP;
    if (maxBottomSpace === undefined || wrapBottom <= maxBottomSpace) {
      const wrapped = labels.map((label) => wrapLabel(label, available - LABEL_GAP, measure));
      // WSZYSTKIE etykiety albo żadna. Oś, na której część napisów jest
      // zawinięta, a część nie, ma dwa różne rytmy w jednym rzędzie i czyta
      // się jako błąd renderu, nie jako decyzja.
      //
      // Warunek `some(len > 1)` odsiewa przypadek pusty: gdyby wszystkie
      // etykiety mieściły się w jednej linii, "zawinięcie" byłoby zwykłym
      // trybem pełnym pod inną nazwą - a tu jesteśmy właśnie dlatego, że się
      // nie mieszczą.
      if (
        wrapped.every((lines): lines is string[] => lines !== null) &&
        wrapped.some((lines) => lines.length > 1)
      ) {
        return {
          mode: "wrapped",
          labels: full,
          full,
          step: 1,
          visible: visibleIndices(labels.length, 1),
          rotation: 0,
          bottomSpace: wrapBottom,
          lines: wrapped,
        };
      }
    }
    return {
      mode: "thinned",
      labels: full,
      full,
      step: fullStep,
      visible: visibleIndices(labels.length, fullStep),
      rotation: 0,
      bottomSpace: straightBottom,
    };
  }

  // Szczebel 2: skrót semantyczny. Bierzemy go tylko wtedy, gdy naprawdę
  // poprawia krok - skrót, po którym i tak trzeba obracać, tylko zaciemnia
  // zapis bez zysku.
  const shortened = labels.map(shortenLabel);
  const changed = shortened.some((s, i) => s !== labels[i]);
  if (changed) {
    const shortStep = stepFor(shortened);
    if (shortStep <= MAX_THIN_STEP) {
      return {
        mode: "shortened",
        labels: shortened,
        full,
        step: shortStep,
        visible: visibleIndices(labels.length, shortStep),
        rotation: 0,
        bottomSpace: straightBottom,
      };
    }
  }

  // Szczebel 3: obrót. Miejsce w poziomie przestaje zależeć od DŁUGOŚCI
  // napisu, więc krok zwykle wraca do jedynki; potrzebna wysokość rośnie
  // o rzut najdłuższej etykiety na oś Y.
  const rotatedSet = changed ? shortened : full;
  const rotatedStep = Math.max(1, Math.ceil(rotatedHorizontalNeed(fontSize) / available));
  const projected = maxWidth(rotatedSet, measure) * Math.SQRT1_2;
  const rotatedBottom = Math.ceil(projected + lineHeight * 0.75 + LABEL_GAP);

  // Szczebel 3b: obrót SIĘ NIE MIEŚCI w wysokości, jaką wykres ma pod osią.
  if (maxBottomSpace !== undefined && rotatedBottom > maxBottomSpace) {
    // Etykiety poziome przerzedzone tak mocno, jak trzeba - krok
    // wychodzi ponad `MAX_THIN_STEP`, i to jest w porządku: ta stała mówi,
    // kiedy WOLIMY inny szczebel od przerzedzania, a tutaj innego szczebla już
    // nie ma. Pełna treść każdej etykiety zostaje w `<title>` i w tabeli
    // danych, a pierwsza i ostatnia są widoczne zawsze, więc zakres osi się
    // nie gubi. Zamiana na słupki poziome (ostatni szczebel specyfikacji)
    // należy do autora - silnik nie zmienia typu wykresu za człowieka, tylko
    // podpowiada w edytorze.
    const straightStep = stepFor(rotatedSet);
    return {
      mode: changed ? "shortened" : "thinned",
      labels: rotatedSet,
      full,
      step: straightStep,
      visible: visibleIndices(labels.length, straightStep),
      rotation: 0,
      bottomSpace: straightBottom,
    };
  }

  return {
    mode: "rotated",
    labels: rotatedSet,
    full,
    step: rotatedStep,
    visible: visibleIndices(labels.length, rotatedStep),
    rotation: -45,
    bottomSpace: rotatedBottom,
  };
}
