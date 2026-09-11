// PARYTET STATYSTYKI POZYCYJNEJ: cztery drogi, jedna liczba.
//
// PO CO OSOBNY PLIK. Kwantyl typu 7 miał w tym silniku CZTERY implementacje
// w dwóch różnych wzorach - skrzynka i rój interpolowały różnicą `a+(b-a)*t`,
// histogram tak samo i bez żadnej osłony, indeks mieszaniem `a*(1-t)+b*t` -
// a przy jednej z nich stał komentarz zapewniający, że to "ta sama
// definicja, którą trzyma boxplot.ts". Nie była. Cztery kopie wzoru to nie
// powielony kod, tylko CZTERY DEFINICJE, i rozjazd między nimi widać dopiero
// na danych, których nikt nie wpisuje ręcznie do testu jednego modelu.
//
// Testy poszczególnych modeli tego nie złapią z zasady: każdy z nich pyta
// "czy skrzynka liczy dobrze", a pytanie, które tu zadajemy, brzmi "czy
// skrzynka, histogram, rój i indeks liczą TO SAMO". Na to pytanie nie ma
// gdzie odpowiedzieć w pliku jednego rodzaju wykresu, a odpowiedź jest
// widoczna dla czytelnika: ta sama kolumna arkusza wrzucona na dwa różne
// wykresy nie może dawać dwóch różnych kwartyli, bo oba podpisy obiecują
// tę samą metodę.
//
// CO JEST WZORCEM. `stats.ts` - i to nie jest wybór estetyczny. Mieszanie
// `a*(1-t)+b*t` nie liczy różnicy, więc nie ma czym przepełnić (kombinacja
// wypukła nie wychodzi poza `[a, b]`, a oba końce są z założenia
// zapisywalne). Postać różnicowa przepełnia się i cofa pod osłoną do `a`,
// czyli podaje pierwszy kwartyl RÓWNY NAJMNIEJSZEJ OBSERWACJI.
//
// PRÓBY SKRAJNE NIE SĄ TU OZDOBĄ. Na danych zwykłych wszystkie cztery drogi
// zgadzały się również PRZED naprawą - defekt był niewidoczny dokładnie do
// granicy zakresu podwójnej precyzji, a kolumna z błędem jednostki albo
// uszkodzony import wystarczą, żeby ją przekroczyć.
import { describe, expect, it } from "vitest";
import { iqr, quantile, tukeyFence } from "@/lib/charts/stats";
import { boxplotModel, quantileR7 } from "@/lib/charts/kinds/boxplot";
import { histogramModel } from "@/lib/charts/kinds/histogram";
import { beeswarmModel } from "@/lib/charts/kinds/beeswarm";
import { INDEX_BASE_FENCE_IQR_FACTOR, indexBaseModel } from "@/lib/charts/kinds/indexBase";
import type { ChartSeries } from "@/lib/charts/types";

/**
 * Próby, na których pytamy o parytet. Co najmniej pięć obserwacji w każdej,
 * bo skrzynka poniżej `BOXPLOT_MIN_SAMPLE` milczy z innego powodu (próba za
 * mała na kwartyle), a indeks poniżej `INDEX_BASE_FENCE_MIN_POINTS` nie
 * stawia ogrodzenia - i żadne z tych milczeń nie jest przedmiotem tego pliku.
 */
const PROBY: ReadonlyArray<{ nazwa: string; dane: number[] }> = [
  { nazwa: "szereg 1..9", dane: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { nazwa: "powtórzenia i przeskok", dane: [2, 2, 2, 5, 9, 9, 10, 11] },
  { nazwa: "wartości ujemne", dane: [-10, -3, 0, 2.5, 7, 13, 100] },
  { nazwa: "ułamki", dane: [0.1, 0.2, 0.3, 0.4, 0.5] },
  { nazwa: "prawie płaski", dane: [1, 1, 1, 1, 2] },
  { nazwa: "pięć obserwacji", dane: [5, 1, 4, 2, 3] },
  { nazwa: "sześć obserwacji", dane: [1, 2, 3, 4, 5, 6] },
  { nazwa: "rząd 1e307", dane: [1e307, 2e307, 3e307, 4e307, 5e307] },
  { nazwa: "rząd 1e-308", dane: [1e-308, 2e-308, 3e-308, 4e-308, 5e-308] },
  // Kwartyle ±5e+307: rozstęp jest SKOŃCZONY (1e+308), a obie granice
  // ogrodzenia już nie - szczelina, przez którą przechodziło `{0, 0}`.
  { nazwa: "pełny zakres double", dane: [-1e308, -5e307, 0, 5e307, 1e308] },
  // Kwartyle na obu krańcach: nie da się zapisać samej RÓŻNICY `q3 - q1`.
  { nazwa: "kwartyle na obu krańcach", dane: [-1e308, -1e308, 0, 1e308, 1e308] },
  // PRÓBY, KTÓRE W OGÓLE ROZRÓŻNIAJĄ OBA WZORY - i bez nich ten plik byłby
  // ozdobą. Interpolacja odzywa się wyłącznie wtedy, gdy pozycja kwantyla
  // NIE wypada na obserwacji: dla n = 5 i n = 9 wszystkie trzy pozycje
  // `(n-1)*p` są całkowite, więc oba wzory zwracają tę samą obserwację
  // i żaden rozjazd nie ma prawa się pokazać. Rozjazd wymaga UŁAMKOWEJ
  // pozycji ORAZ pary sąsiadów, których różnica wychodzi poza podwójną
  // precyzję - czyli n spoza {5, 9} i skoku przez całą szerokość zakresu.
  // Sprawdzone mutacją: po przywróceniu w histogramie lokalnej kopii wzoru
  // różnicowego czerwienią się dokładnie te trzy próby.
  {
    nazwa: "n=6, q1 ułamkowe przez cały zakres",
    dane: [-1e308, -1e308, 1e308, 1e308, 1e308, 1e308],
  },
  // n = 7 daje wyłącznie pozycje z połówką, więc para symetryczna
  // (-1e308, 1e308) ma środek w zerze - i wtedy wzór różnicowy, którego
  // przepełnienie osłona ŚCIĄGA DO ZERA, trafia w poprawną odpowiedź
  // przypadkiem. Para jest więc niesymetryczna: różnica 1,9e308 nadal
  // przepełnia, a prawdziwy kwartyl wynosi -5e+306. Przy okazji ta próba
  // trzyma szczelinę z defektu ogrodzenia: rozstęp jest SKOŃCZONY,
  // a górna granica już nie.
  {
    nazwa: "n=7, pozycja ułamkowa na parze niesymetrycznej",
    dane: [-1e308, -1e308, 9e307, 9e307, 9e307, 9e307, 9e307],
  },
  {
    nazwa: "n=8, trzy pozycje ułamkowe",
    dane: [-1e308, -1e308, 1e308, 1e308, 1e308, 1e308, 1e308, 1e308],
  },
  { nazwa: "końce zakresu", dane: [-Number.MAX_VALUE, -1, 0, 1, Number.MAX_VALUE] },
  { nazwa: "mieszane rzędy wielkości", dane: [-1e-300, 0, 1, 1e300, 1e308] },
];

/** Jedna seria z podanych liczb - wspólne wejście wszystkich czterech modeli. */
function seria(dane: readonly number[]): ChartSeries {
  return { name: "A", values: [...dane], colorSlot: 1 };
}

/** Komplet pozycyjny skrzynki dla jednej serii. */
function skrzynka(dane: readonly number[]) {
  return boxplotModel({ categories: ["k"], series: [seria(dane)] }, { groupBy: "series" }).boxes[0];
}

/** Komplet pozycyjny roju dla jednej serii. */
function roj(dane: readonly number[]) {
  return beeswarmModel({ categories: ["k"], series: [seria(dane)] }, { groupBy: "series" })
    .swarms[0].summary;
}

/** Seria indeksu: każda obserwacja jest osobnym okresem. */
function indeks(dane: readonly number[]) {
  return indexBaseModel({
    categories: dane.map((_, i) => `o${i}`),
    series: [seria(dane)],
  }).series[0];
}

describe("parytet kwantyla: skrzynka, histogram, rój i indeks liczą TO SAMO", () => {
  it.each(PROBY)("$nazwa - trzy kwartyle czterema drogami", ({ dane }) => {
    const posortowane = [...dane].sort((a, b) => a - b);
    const oczekiwane = {
      q1: quantile(posortowane, 0.25),
      median: quantile(posortowane, 0.5),
      q3: quantile(posortowane, 0.75),
    };
    // Wzorzec sam w sobie musi być liczbą: gdyby `stats.ts` zamilkło na tych
    // próbach, test porównywałby `null` z `null` i przechodził na pusto.
    expect(oczekiwane.q1).not.toBeNull();
    expect(oczekiwane.median).not.toBeNull();
    expect(oczekiwane.q3).not.toBeNull();

    // Droga 1: publiczne `quantileR7` skrzynki - dziś przekierowanie na
    // wspólną funkcję, i to jest cała jego treść.
    expect(quantileR7(posortowane, 0.25)).toBe(oczekiwane.q1);
    expect(quantileR7(posortowane, 0.5)).toBe(oczekiwane.median);
    expect(quantileR7(posortowane, 0.75)).toBe(oczekiwane.q3);

    // Droga 2: model skrzynki - liczba, którą czytelnik widzi na krawędzi
    // pudła i w kolumnie tabeli.
    const box = skrzynka(dane);
    expect(box.q1).toBe(oczekiwane.q1);
    expect(box.median).toBe(oczekiwane.median);
    expect(box.q3).toBe(oczekiwane.q3);

    // Droga 3: statystyki pozycyjne histogramu.
    const hist = histogramModel([...dane]).summary;
    expect(hist.q1).toBe(oczekiwane.q1);
    expect(hist.median).toBe(oczekiwane.median);
    expect(hist.q3).toBe(oczekiwane.q3);

    // Droga 4: komplet pozycyjny roju - jedyna droga czytelnika ekranu do
    // liczb, bo chmury punktów nie odczyta ani on, ani wydruk w skali szarości.
    const swarm = roj(dane);
    expect(swarm?.q1).toBe(oczekiwane.q1);
    expect(swarm?.median).toBe(oczekiwane.median);
    expect(swarm?.q3).toBe(oczekiwane.q3);

    // Mediana indeksu - ta sama definicja, na której stoi porównanie bazy
    // z typowym poziomem szeregu.
    expect(indeks(dane)?.median).toBe(oczekiwane.median);
  });

  it.each(PROBY)("$nazwa - rozstęp międzykwartylowy jedną liczbą", ({ dane }) => {
    // ROZSTĘP MILCZY ALBO NIE, ALE WSZĘDZIE TAK SAMO. Ta sama próba dawała
    // przed naprawą trzy różne rozstępy: skrzynka nasycała się do
    // największej liczby skończonej (1,7976931348623157e+308), histogram i rój
    // podstawiały ZERO, a `stats.ts` milczał. Zero było najgorsze z tej
    // trójki, bo czyta się jako rozkład ZDEGENEROWANY - dokładna odwrotność
    // prawdy o danych najbardziej rozproszonych, jakie da się zapisać.
    const posortowane = [...dane].sort((a, b) => a - b);
    const oczekiwany = iqr(posortowane);

    expect(skrzynka(dane).iqr).toBe(oczekiwany);
    expect(histogramModel([...dane]).summary.iqr).toBe(oczekiwany);
    expect(roj(dane)?.iqr).toBe(oczekiwany);
  });

  it.each(PROBY)("$nazwa - ogrodzenie Tukeya indeksu zgadza się ze `stats.ts`", ({ dane }) => {
    // Ogrodzenie jest GRANICĄ ORZECZENIA: wobec niego baza serii zostaje
    // ogłoszona odstającą albo nie. `{ lower: 0, upper: 0 }` z osłony
    // wyświetlania nie jest awarią, którą ktoś zauważy - zero jest legalną
    // granicą, a względem niej odstaje każda baza różna od zera.
    const posortowane = [...dane].sort((a, b) => a - b);
    expect(indeks(dane)?.fence ?? null).toEqual(
      tukeyFence(posortowane, INDEX_BASE_FENCE_IQR_FACTOR),
    );
  });
});

describe("parytet ma ZĘBY: wzorzec różnicowy nie przeszedłby tych prób", () => {
  it("postać `a + (b-a)*t` rozjeżdża się ze wspólną definicją na krańcach zakresu", () => {
    // Gdyby ten test przechodził, cały plik obok byłby dekoracją: znaczyłoby
    // to, że oba wzory dają zawsze to samo, więc parytet niczego nie pilnuje.
    // Odtwarzamy tu DOKŁADNIE starą implementację skrzynki (interpolacja
    // różnicą plus osłona `fin(..., a)`) i pokazujemy liczbę, którą podawała.
    const fin = (v: number, zastepcza: number): number => (Number.isFinite(v) ? v : zastepcza);
    const roznicowy = (posortowane: readonly number[], p: number): number => {
      const n = posortowane.length;
      const h = (n - 1) * p;
      const dol = Math.floor(h);
      const gora = dol + 1 >= n ? n - 1 : dol + 1;
      const a = posortowane[dol];
      return fin(a + (posortowane[gora] - a) * (h - dol), a);
    };

    const proba = [-1e308, 1e308, 1e308, 1e308];
    expect(roznicowy(proba, 0.25)).toBe(-1e308);
    expect(quantile(proba, 0.25)).toBe(5e307);
    // Pierwszy kwartyl RÓWNY MINIMUM próby, w której trzy czwarte obserwacji
    // leży po przeciwnej stronie zera - to jest ta zła liczba na ekranie.
    expect(roznicowy(proba, 0.25)).toBe(Math.min(...proba));
  });

  it("na danych zwykłych oba wzory są zgodne co do definicji, więc próby skrajne są konieczne", () => {
    // Parytet na samych danych zwykłych niczego by nie dowiódł: tam stary
    // i nowy wzór liczą tę samą wartość typu 7 (różnią się najwyżej ostatnimi
    // bitami zaokrąglenia, rzędu 1e-15 względnie). Cały rozjazd, o który
    // chodzi, mieszka przy granicy zakresu podwójnej precyzji - i dlatego
    // `PROBY` muszą tam sięgać.
    const proba = [3, 1, 4, 1, 5, 9, 2, 6];
    const posortowane = [...proba].sort((a, b) => a - b);
    for (const p of [0.25, 0.5, 0.75]) {
      const n = posortowane.length;
      const h = (n - 1) * p;
      const dol = Math.floor(h);
      const gora = dol + 1 >= n ? n - 1 : dol + 1;
      const a = posortowane[dol];
      const roznicowy = a + (posortowane[gora] - a) * (h - dol);
      const wspolny = quantile(posortowane, p) ?? Number.NaN;
      expect(Math.abs(wspolny - roznicowy)).toBeLessThanOrEqual(Math.abs(wspolny) * 1e-12);
    }
  });

  it("każda z czterech dróg naprawdę dojeżdża do liczby, a nie do milczenia", () => {
    // Osłona przed testem pustym: `it.each` porównujące `undefined` z
    // `undefined` przechodzi. Tu sprawdzamy, że na próbie zwykłej wszystkie
    // cztery modele faktycznie coś orzekają.
    const dane = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(skrzynka(dane).hasQuartiles).toBe(true);
    expect(skrzynka(dane).q1).toBe(3);
    expect(histogramModel(dane).summary.q1).toBe(3);
    expect(roj(dane)).not.toBeNull();
    expect(roj(dane)?.q1).toBe(3);
    expect(indeks(dane)?.median).toBe(5);
    expect(indeks(dane)?.fence).not.toBeNull();
  });
});
