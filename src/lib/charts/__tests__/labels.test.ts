// Drabina etykiet osi kategorii. Test pilnuje KOLEJNOŚCI szczebli, bo to ona
// decyduje, ile czytelnik traci: przerzedzenie zabiera etykiety, skrót nie
// zabiera nic, obrót nie zabiera nic ale kosztuje wysokość. Drabina wzięta od
// końca (najpierw obracaj) wyglądałaby równie dobrze i była gorsza.
import { describe, expect, it } from "vitest";
import {
  LABEL_GAP,
  MAX_THIN_STEP,
  planCategoryLabels,
  shortenLabel,
  visibleIndices,
} from "@/lib/charts/labels";

/** Heurystyka o tej samej stałej co silnik - test nie ma kanwy. */
const measure = (text: string): number => text.length * 11 * 0.62;

const plan = (labels: readonly string[], slotWidth: number) =>
  planCategoryLabels(labels, { slotWidth, fontSize: 11, measure });

const seq = (count: number, make: (i: number) => string): string[] =>
  Array.from({ length: count }, (_, i) => make(i));

describe("labels - skrót semantyczny", () => {
  it("skraca zapisy czasu bez utraty informacji", () => {
    expect(shortenLabel("2024-Q1")).toBe("Q1'24");
    expect(shortenLabel("2024 Q1")).toBe("Q1'24");
    expect(shortenLabel("2024/K3")).toBe("Q3'24");
    expect(shortenLabel("Q2 2024")).toBe("Q2'24");
    expect(shortenLabel("2024-01-15")).toBe("15.01");
    expect(shortenLabel("2024-01")).toBe("01'24");
    expect(shortenLabel("2024")).toBe("'24");
  });

  it("NIE rusza napisów, w których skrót byłby niejednoznaczny", () => {
    // "Budżet 2024" skrócony do "Budżet '24" byłby w porządku, ale "2024"
    // w środku dowolnego napisu już nie - dlatego skracamy tylko czyste
    // wzorce, a resztą zajmuje się obrót.
    expect(shortenLabel("Budżet 2024")).toBe("Budżet 2024");
    expect(shortenLabel("Wielkopolskie")).toBe("Wielkopolskie");
    expect(shortenLabel("Q1")).toBe("Q1");
    expect(shortenLabel("124")).toBe("124");
    expect(shortenLabel("")).toBe("");
  });
});

describe("labels - przerzedzanie", () => {
  it("PIERWSZA I OSTATNIA zostają zawsze - one niosą zakres osi", () => {
    expect(visibleIndices(10, 3)).toContain(0);
    expect(visibleIndices(10, 3)).toContain(9);
    expect(visibleIndices(40, 4).at(-1)).toBe(39);
  });

  it("ostatnia wypycha poprzednią, gdy stanęłyby na sobie", () => {
    // Krok 5 na dwudziestu jeden kategoriach daje ostatnią rysowaną na 20,
    // czyli dokładnie na końcu - nic nie trzeba wypychać.
    expect(visibleIndices(21, 5)).toEqual([0, 5, 10, 15, 20]);
    // Krok 5 na dwudziestu dwóch: ostatnia rysowana to 20, koniec osi to 21,
    // odstęp 1 < 2,5, więc 20 ustępuje - lepiej stracić etykietę pośrednią
    // niż koniec osi.
    expect(visibleIndices(22, 5)).toEqual([0, 5, 10, 15, 21]);
  });

  it("zestaw pusty i jednoelementowy nie rodzą śmieci", () => {
    expect(visibleIndices(0, 3)).toEqual([]);
    expect(visibleIndices(1, 3)).toEqual([0]);
  });

  it("krok 0 albo ujemny jest traktowany jak 1 - pętla nie może się zawiesić", () => {
    expect(visibleIndices(3, 0)).toEqual([0, 1, 2]);
    expect(visibleIndices(3, -5)).toEqual([0, 1, 2]);
  });
});

describe("labels - kolejność szczebli", () => {
  it("gdy wszystko się mieści, nie rusza niczego", () => {
    const result = plan(["a", "b", "c"], 200);
    expect(result.mode).toBe("full");
    expect(result.step).toBe(1);
    expect(result.rotation).toBe(0);
    expect(result.labels).toEqual(["a", "b", "c"]);
  });

  it("SZCZEBEL 1: przerzedza, dopóki krok mieści się w progu", () => {
    const result = plan(
      seq(30, (i) => `k${i}`),
      16,
    );
    expect(result.mode).toBe("thinned");
    expect(result.step).toBeGreaterThan(1);
    expect(result.step).toBeLessThanOrEqual(MAX_THIN_STEP);
    expect(result.rotation).toBe(0);
    // Przerzedzenie NIE zmienia napisów - to nadal pełne etykiety.
    expect(result.labels).toEqual(result.full);
  });

  it("SZCZEBEL 2: skrót semantyczny wchodzi przed obrotem", () => {
    const quarters = seq(40, (i) => `${2020 + Math.floor(i / 4)}-Q${(i % 4) + 1}`);
    const result = plan(quarters, 16.9);
    expect(result.mode).toBe("shortened");
    expect(result.rotation).toBe(0);
    expect(result.labels[0]).toBe("Q1'20");
    // Pełna treść zostaje dostępna dla tooltipa.
    expect(result.full[0]).toBe("2020-Q1");
  });

  it("SZCZEBEL 3: obrót, gdy skrót nie ma czego skrócić", () => {
    const result = plan(
      seq(20, (i) => `Województwo numer ${i + 1}`),
      33.8,
    );
    expect(result.mode).toBe("rotated");
    expect(result.rotation).toBe(-45);
    // Obrót kupuje miejsce w poziomie, więc krok wraca do jedynki.
    expect(result.step).toBe(1);
    // ...i kosztuje wysokość: rzut najdłuższej etykiety na oś Y.
    expect(result.bottomSpace).toBeGreaterThan(measure("Województwo numer 20") * 0.7);
  });

  it("obrót używa etykiet SKRÓCONYCH, gdy skrót był możliwy", () => {
    // Skrót nie wystarczył, ale i tak jest lepszy od pełnego zapisu -
    // porzucenie go razem z odrzuceniem szczebla byłoby stratą bez powodu.
    const quarters = seq(60, (i) => `${2020 + Math.floor(i / 4)}-Q${(i % 4) + 1}`);
    const result = plan(quarters, 11.3);
    expect(result.mode).toBe("rotated");
    expect(result.labels[0]).toBe("Q1'20");
    expect(result.full[0]).toBe("2020-Q1");
  });

  it("prześwit między etykietami jest doliczany do potrzebnej szerokości", () => {
    // Etykieta o szerokości dokładnie równej pasmu NIE mieści się, bo dwie
    // sąsiednie stykałyby się bez prześwitu.
    const width = measure("kat");
    expect(plan(["kat", "kat", "kat"], width).step).toBeGreaterThan(1);
    expect(plan(["kat", "kat", "kat"], width + LABEL_GAP).step).toBe(1);
  });

  it("zestaw pusty zwraca plan, a nie wyjątek", () => {
    const result = plan([], 100);
    expect(result.visible).toEqual([]);
    expect(result.mode).toBe("full");
    expect(result.bottomSpace).toBeGreaterThan(0);
  });

  it("pasmo zerowe albo ujemne nie dzieli przez zero", () => {
    for (const slot of [0, -50]) {
      const result = plan(["dluga nazwa", "druga"], slot);
      expect(Number.isFinite(result.step)).toBe(true);
      expect(result.step).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("drabina - gwarancja pierwszej etykiety i budżet wysokości", () => {
  it("PIERWSZA etykieta nie ustępuje NIGDY, nawet przy dwóch kategoriach", () => {
    // REGRESJA. Reguła "ostatnia rysowana i koniec osi muszą być oddalone
    // o co najmniej pół kroku" była stosowana bez sprawdzenia, CO ustępuje.
    // Przy dwóch kategoriach lista regularna to samo [0], odległość do końca
    // osi (1) jest mniejsza od pół kroku (1,5), więc zero wypadało i oś
    // zostawała z jedną etykietą - tą ostatnią. Czytelnik tracił początek
    // szeregu, czyli dokładnie to, czego ta funkcja ma pilnować.
    for (let count = 2; count <= 40; count++) {
      for (let step = 1; step <= 12; step++) {
        const out = visibleIndices(count, step);
        expect(out[0], `count=${count} step=${step}`).toBe(0);
        expect(out.at(-1), `count=${count} step=${step}`).toBe(count - 1);
      }
    }
  });

  it("DWIE kategorie nie są przerzedzane - nie ma czego przerzedzić", () => {
    // Każdy indeks jest tu pierwszym albo ostatnim, a tych nie usuwamy, więc
    // przerzedzenie nie zwolniłoby ani jednego piksela. Drabina musi zejść
    // niżej: do skrótu albo do obrotu.
    const wynik = plan(["Styczeń 2024", "Luty 2024"], 28);
    expect(wynik.visible).toEqual([0, 1]);
    expect(wynik.mode).not.toBe("thinned");
    expect(["shortened", "rotated"]).toContain(wynik.mode);
  });

  it("OBRÓT SIĘ NIE MIEŚCI: drabina wraca do etykiet poziomych, nie rysuje poza kartą", () => {
    // Obrócona etykieta kupuje miejsce w poziomie za miejsce w PIONIE, a
    // wysokość wykresu zaczyna się od 160 px. Bez limitu obszar kreślenia
    // siadał na swojej podłodze, nadwyżka marginesu przepadała i napisy
    // schodziły z płótna na podpis pod wykresem.
    const dlugie = seq(20, (i) => `Województwo mazowieckie ${i}`);
    const bezLimitu = planCategoryLabels(dlugie, { slotWidth: 20, fontSize: 11, measure });
    expect(bezLimitu.mode).toBe("rotated");
    expect(bezLimitu.bottomSpace).toBeGreaterThan(100);

    const zLimitem = planCategoryLabels(dlugie, {
      slotWidth: 20,
      fontSize: 11,
      measure,
      maxBottomSpace: 24,
    });
    expect(zLimitem.rotation).toBe(0);
    expect(zLimitem.bottomSpace).toBeLessThanOrEqual(24);
    // Nic nie ginie bez śladu: pierwsza i ostatnia zostają, pełna treść
    // każdej etykiety jedzie w `full` (stąd `<title>` i tabela danych).
    expect(zLimitem.visible[0]).toBe(0);
    expect(zLimitem.visible.at(-1)).toBe(dlugie.length - 1);
    expect(zLimitem.full).toEqual(dlugie);
  });

  it("limit hojny NIE psuje obrotu - reguła włącza się tylko wtedy, gdy trzeba", () => {
    const dlugie = seq(20, (i) => `Województwo mazowieckie ${i}`);
    const wynik = planCategoryLabels(dlugie, {
      slotWidth: 20,
      fontSize: 11,
      measure,
      maxBottomSpace: 400,
    });
    expect(wynik.mode).toBe("rotated");
    expect(wynik.rotation).toBe(-45);
  });
});
