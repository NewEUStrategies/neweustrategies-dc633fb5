// Model mostka. Najważniejsza asercja w tym pliku to SUMA KONTROLNA: mostek,
// którego składniki nie sumują się do różnicy stanów, jest błędem
// arytmetycznym, a nie kwestią gustu - i jest jedynym defektem w silniku
// wykresów, który da się wykryć obliczeniem, więc się go wykrywa.
import { describe, expect, it } from "vitest";
import { CHECKSUM_TOLERANCE_RATIO, waterfallExtent, waterfallModel } from "@/lib/charts/waterfall";

const LABELS = ["EBITDA 2024", "Cena", "Wolumen", "Koszty", "EBITDA 2025"];

describe("waterfall - kształt mostka", () => {
  it("filary stoją na zerze, składniki WISZĄ na poprzednim", () => {
    const model = waterfallModel(LABELS, [100, 20, -5, -15, 100]);
    const [start, cena, wolumen, koszty, end] = model.steps;

    // Filar: od zera do wartości. Koduje POZIOM.
    expect(start.kind).toBe("start");
    expect([start.from, start.to]).toEqual([0, 100]);
    expect(end.kind).toBe("end");
    expect([end.from, end.to]).toEqual([0, 100]);

    // Składnik: od poziomu bieżącego do poziomu po kroku. Koduje WKŁAD.
    expect([cena.from, cena.to]).toEqual([100, 120]);
    expect([wolumen.from, wolumen.to]).toEqual([115, 120]);
    expect([koszty.from, koszty.to]).toEqual([100, 115]);
  });

  it("znak jest kodowany KIERUNKIEM, nie tylko kolorem", () => {
    const model = waterfallModel(LABELS, [100, 20, -5, -15, 100]);
    expect(model.steps.map((s) => s.direction)).toEqual(["up", "up", "down", "down", "up"]);
  });

  it("krok o wartości zero ma kierunek 'flat' - nie udaje wzrostu", () => {
    const model = waterfallModel(["A", "Zero", "B"], [10, 0, 10]);
    expect(model.steps[1].direction).toBe("flat");
    expect(model.steps[1].from).toBe(model.steps[1].to);
  });

  it("luka w danych jest liczona jako zero, a nie wywraca kursora", () => {
    const model = waterfallModel(LABELS, [100, null, -5, -15, 80]);
    expect(model.steps[1].value).toBe(0);
    expect(model.componentSum).toBe(-20);
    expect(Number.isFinite(model.steps[3].to)).toBe(true);
  });

  it("bez jawnego stanu końcowego ostatnia kategoria jest zwykłym składnikiem", () => {
    const model = waterfallModel(["Start", "A", "B"], [10, 5, 3], { explicitEnd: false });
    expect(model.steps.map((s) => s.kind)).toEqual(["start", "step", "step"]);
    // Nie ma czego sprawdzać - mostek domyka się z definicji, więc model
    // MILCZY, a nie twierdzi, że jest dobrze.
    expect(model.checksumOk).toBeNull();
  });

  it("zestaw pusty i jednoelementowy nie rodzą wyjątku", () => {
    expect(waterfallModel([], []).steps).toEqual([]);
    const one = waterfallModel(["Sam"], [42]);
    expect(one.steps).toHaveLength(1);
    expect(one.steps[0].kind).toBe("start");
    expect(one.checksumOk).toBeNull();
  });
});

describe("waterfall - suma kontrolna", () => {
  it("mostek domknięty przechodzi", () => {
    const model = waterfallModel(LABELS, [100, 20, -5, -15, 100]);
    expect(model.componentSum).toBe(0);
    expect(model.stateDelta).toBe(0);
    expect(model.checksumOk).toBe(true);
    expect(model.checksumGap).toBe(0);
  });

  it("BRAKUJĄCY SKŁADNIK jest wykrywany, a nie przemilczany", () => {
    // Stan rośnie z 100 na 130, ale składniki dają tylko +20 - w mostku
    // brakuje dziesięciu. Bez tej asercji wykres narysowałby filar końcowy
    // w miejscu, do którego składniki nie dowożą, i nikt by nie zauważył.
    const model = waterfallModel(["Start", "Cena", "Koniec"], [100, 20, 130]);
    expect(model.componentSum).toBe(20);
    expect(model.stateDelta).toBe(30);
    expect(model.checksumOk).toBe(false);
    expect(model.checksumGap).toBe(10);
  });

  it("tolerancja jest WZGLĘDNA - mostek w milionach i w punktach mają jeden progrm", () => {
    // Ta sama rozbieżność procentowo: 0,1% skali. W obu wielkościach
    // przechodzi, bo to błąd zaokrąglenia w arkuszu autora, nie brak
    // składnika. Próg bezwzględny musiałby wybrać jedną z tych dwóch skal.
    const male = waterfallModel(["S", "A", "K"], [1, 0.499, 1.5]);
    const duze = waterfallModel(["S", "A", "K"], [1e6, 499_000, 1.5e6]);
    expect(male.checksumOk).toBe(true);
    expect(duze.checksumOk).toBe(true);
  });

  it("rozbieżność powyżej tolerancji NIE przechodzi w żadnej skali", () => {
    const gap = CHECKSUM_TOLERANCE_RATIO * 3;
    const model = waterfallModel(["S", "A", "K"], [100, 20, 120 + 120 * gap]);
    expect(model.checksumOk).toBe(false);
  });

  it("mostek o zerowej różnicy stanów i zerowych składnikach przechodzi", () => {
    // Skala jest tu zerowa, więc tolerancja względna sama byłaby zerem -
    // dlatego istnieje podłoga 1e-9. Bez niej ten mostek oblewałby się na
    // szumie zmiennoprzecinkowym.
    const model = waterfallModel(["S", "A", "K"], [0, 0, 0]);
    expect(model.checksumOk).toBe(true);
  });
});

describe("waterfall - domena osi", () => {
  it("domena obejmuje ZERO, bo filary z niego rosną", () => {
    const model = waterfallModel(LABELS, [100, 20, -5, -15, 100]);
    const extent = waterfallExtent(model);
    expect(extent.min).toBeLessThanOrEqual(0);
    expect(extent.max).toBeGreaterThanOrEqual(120);
  });

  it("domena obejmuje najniższy punkt pasa, nie tylko wartości filarów", () => {
    // Składnik może zejść poniżej obu filarów - i wtedy oś musi go pomieścić,
    // inaczej słupek wystaje za obszar kreślenia.
    const model = waterfallModel(["S", "Zjazd", "Powrót", "K"], [100, -80, 80, 100]);
    expect(waterfallExtent(model).min).toBeLessThanOrEqual(20);
  });
});

describe("waterfall - suma kontrolna MILCZY, gdy nie ma czego sprawdzać", () => {
  it("seria bez ani jednej liczby NIE dostaje zaświadczenia, że mostek się domyka", () => {
    // REGRESJA. Brak wartości był sprowadzany do zera jeszcze przed sumą
    // kontrolną, więc zero minus zero domykało zero i model zwracał
    // `checksumOk: true` dla danych, których nie ma. Twierdził, że sprawdził
    // dekompozycję - a jego własna umowa mówi, że przy braku czego sprawdzać
    // MILCZY, zamiast zaświadczać.
    const puste = waterfallModel(LABELS, []);
    expect(puste.checksumOk).toBeNull();
    expect(waterfallModel(LABELS, [null, null, null, null, null]).checksumOk).toBeNull();
  });

  it("brak liczby na KTÓRYMKOLWIEK filarze zdejmuje sumę kontrolną", () => {
    // Filar to stan, a nie składnik: bez stanu początkowego albo końcowego
    // nie ma różnicy stanów, którą składniki miałyby domykać.
    expect(waterfallModel(LABELS, [null, 20, -5, -15, 100]).checksumOk).toBeNull();
    expect(waterfallModel(LABELS, [100, 20, -5, -15, null]).checksumOk).toBeNull();
    expect(waterfallModel(LABELS, [100, 20, -5, -15, Number.NaN]).checksumOk).toBeNull();
  });

  it("brak liczby na SKŁADNIKU sumę kontrolną zostawia - i ona słusznie nie domyka", () => {
    // Tu odpowiedź "nie zgadza się" jest prawdziwa i pożyteczna: autor widzi,
    // że w dekompozycji brakuje pozycji.
    const model = waterfallModel(LABELS, [100, 20, null, -15, 100]);
    expect(model.checksumOk).toBe(false);
    expect(model.checksumGap).toBeCloseTo(5, 6);
  });
});

describe("waterfall - tolerancja sumy kontrolnej mierzy ZMIANĘ, nie poziom", () => {
  it("nierozliczona CAŁA zmiana przy dużych, bliskich stanach jest wykryta", () => {
    // REGRESJA. Skala tolerancji obejmowała `Math.abs(end)`, więc mostek od
    // 1 000 000 do 1 001 000 ze składnikami sumującymi się do ZERA dostawał
    // tolerancję 5005 przy luce 1000 i wychodził jako DOMKNIĘTY - wykres tłumił
    // ostrzeżenie o dekompozycji, która nie wyjaśnia ani jednej jednostki
    // zmiany. Procent z poziomu nie mówi nic o dekompozycji zmiany; mówi tylko,
    // jak duże są liczby po obu stronach. Suma kontrolna jest jedynym
    // defektem w tym silniku sprawdzalnym arytmetycznie, więc oślepianie jej
    // tam, gdzie jest najbardziej potrzebna, kosztuje najwięcej.
    const model = waterfallModel(["Start", "Nic", "Koniec"], [1_000_000, 0, 1_001_000]);
    expect(model.stateDelta).toBe(1000);
    expect(model.componentSum).toBe(0);
    expect(model.checksumGap).toBe(1000);
    expect(model.checksumOk).toBe(false);
  });

  it("ta sama skala liczb DOMYKA się, gdy składnik naprawdę wyjaśnia zmianę", () => {
    const model = waterfallModel(["Start", "Wzrost", "Koniec"], [1_000_000, 1_000, 1_001_000]);
    expect(model.checksumGap).toBe(0);
    expect(model.checksumOk).toBe(true);
  });

  it("zaokrąglenie w arkuszu autora nadal przechodzi - próg jest WZGLĘDNY", () => {
    // 0,5% zmiany (1000) to 5 jednostek; rozbieżność 2 to zaokrąglenie,
    // nie brakujący składnik.
    const model = waterfallModel(["Start", "Wzrost", "Koniec"], [1_000_000, 998, 1_001_000]);
    expect(model.checksumGap).toBe(2);
    expect(model.checksumOk).toBe(true);
  });
});

describe('waterfall - `from`/`to` są KRAWĘDZIAMI prostokąta, nie „przed/po"', () => {
  it("dla kroku W DÓŁ poziomem wejściowym jest `to`, a nie `from`", () => {
    // Ta asercja istnieje, żeby nikt nie „naprawił" prowadnicy mostka w błąd.
    // Model normalizuje krawędzie przez min/max, więc dla składnika UJEMNEGO
    // `from` to poziom PO kroku (niższy), a `to` to poziom PRZED nim. Rysunek
    // zaczepia prowadnicę na poziomie wejściowym - czyli na `to` dla kroku
    // w dół i na `from` dla kroku w górę - i to jest jedyny wybór, przy którym
    // prowadnica dotyka końca POPRZEDNIEGO słupka. Ujednolicenie obu gałęzi
    // na `from` odklejałoby ją od poprzednika i przyklejało do dna bieżącego.
    const model = waterfallModel(["S", "W górę", "W dół", "K"], [100, 20, -5, 115]);
    const wGore = model.steps.find((s) => s.label === "W górę");
    const wDol = model.steps.find((s) => s.label === "W dół");

    expect(wGore?.direction).toBe("up");
    expect(wGore?.from).toBe(100); // poziom przed = wejściowy
    expect(wGore?.to).toBe(120); // poziom po

    expect(wDol?.direction).toBe("down");
    expect(wDol?.to).toBe(120); // poziom PRZED = wejściowy, i jest to `to`
    expect(wDol?.from).toBe(115); // poziom po

    // Niezmiennik wprost: dolna krawędź nigdy nie jest wyższa od górnej.
    for (const step of model.steps) expect(step.from).toBeLessThanOrEqual(step.to);
  });
});
