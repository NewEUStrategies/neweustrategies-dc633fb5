// Statystyka pozycyjna. W tym pliku są dwa DOWODY REGRESJI i one są ważniejsze
// od reszty, bo oba defekty siedziały w kodzie opublikowanym i żaden nie
// wywracał wykresu - oba podawały liczbę wyglądającą wiarygodnie:
//
//   (1) KWANTYL SKRAJNYCH ZAKRESÓW. Interpolacja różnicą `a + (b-a)*t` liczy
//       `b - a`, które dla szeregu od -1e308 do 1e308 wychodzi poza podwójną
//       precyzję. Osłona cofała wynik do `a`, więc pierwszy kwartyl
//       wychodził RÓWNY NAJMNIEJSZEJ OBSERWACJI - zła liczba na ekranie,
//       nie awaria. Mieszanie `a*(1-t) + b*t` różnicy nie liczy.
//
//   (2) OGRODZENIE Z PRZEPEŁNIENIA. Rozstęp bywa skończony, gdy obie granice
//       już nie są, więc sprawdzenie samego rozstępu przepuszcza szereg
//       dalej, a osłona wyświetlania mapuje granice na `{ 0, 0 }`. Zero jest
//       legalną granicą, więc nikt tego nie zauważy - a każda obserwacja
//       różna od zera zostaje ogłoszona odstającą.
//
// Reszta pliku pinuje ZGODNOŚĆ Z DEFINICJĄ typu 7 na ręcznych przykładach
// (te same liczby daje domyślny `quantile()` R-a i arkusz kalkulacyjny),
// własności brzegowe i kontrakt "wejście JEST posortowane".
import { describe, expect, it } from "vitest";
import {
  INDEX_BASE,
  QUANTILE_METHOD,
  baseUsable,
  indexAgainst,
  iqr,
  median,
  quantile,
  tukeyFence,
} from "@/lib/charts/stats";

/**
 * Szereg, na którym postać z różnicą się przepełnia. Kwartyl mieszaniem to
 * 5e+307, kwartyl różnicą (po osłonie) to -1e+308 - czyli minimum szeregu.
 */
const SKRAJNY = [-1e308, 1e308, 1e308, 1e308] as const;

/**
 * Szereg z kwartylami -5e+307 i 5e+307: ROZSTĘP JEST SKOŃCZONY (1e+308),
 * a obie granice ogrodzenia już nie - to jest dokładnie ta szczelina, przez
 * którą przechodziło ogrodzenie `{ lower: 0, upper: 0 }`.
 */
const ROZCIAGNIETY = [-1e308, -5e307, 0, 5e307, 1e308] as const;

/** Współczynnik Tukeya z modeli tego silnika. */
const FACTOR = 1.5;

describe("QUANTILE_METHOD", () => {
  it("nazywa metodę, bo kwartyl typu 7 bywa liczbą, której w danych nie ma", () => {
    expect(QUANTILE_METHOD).toBe("type-7");
  });
});

describe("quantile - zgodność z definicją typu 7", () => {
  it("odtwarza kwartyle z ręcznego przykładu na czterech obserwacjach", () => {
    const dane = [1, 2, 3, 4];
    expect(quantile(dane, 0.25)).toBe(1.75);
    expect(quantile(dane, 0.5)).toBe(2.5);
    expect(quantile(dane, 0.75)).toBe(3.25);
  });

  it("odtwarza kwartyle na dziesięciu obserwacjach", () => {
    const dane = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(quantile(dane, 0.25)).toBe(3.25);
    expect(quantile(dane, 0.5)).toBe(5.5);
    expect(quantile(dane, 0.75)).toBe(7.75);
  });

  it("na próbie nieparzystej kwartyle wypadają NA OBSERWACJACH", () => {
    const dane = [15, 20, 35, 40, 50];
    expect(quantile(dane, 0.25)).toBe(20);
    expect(quantile(dane, 0.5)).toBe(35);
    expect(quantile(dane, 0.75)).toBe(40);
  });

  it("interpoluje także poza kwartylami", () => {
    expect(quantile([1, 2, 3, 4], 0.1)).toBeCloseTo(1.3, 12);
    expect(quantile([0, 100], 0.37)).toBeCloseTo(37, 12);
  });

  it("kwantyl NIGDY nie wychodzi poza [min, max] próby", () => {
    const dane = [-8, -1, 0, 0, 2.5, 3, 900];
    for (let i = 0; i <= 100; i++) {
      const v = quantile(dane, i / 100);
      expect(v).not.toBeNull();
      expect(v as number).toBeGreaterThanOrEqual(dane[0]);
      expect(v as number).toBeLessThanOrEqual(dane[dane.length - 1]);
    }
  });

  it("jest niemalejący względem p", () => {
    const dane = [-3, -3, 0, 1, 7, 7, 7, 12];
    let poprzedni = Number.NEGATIVE_INFINITY;
    for (let i = 0; i <= 100; i++) {
      const v = quantile(dane, i / 100) as number;
      expect(v, `p = ${i / 100}`).toBeGreaterThanOrEqual(poprzedni);
      poprzedni = v;
    }
  });
});

describe("quantile - REGRESJA: kwantyl skrajnych zakresów", () => {
  it("pierwszy kwartyl to 5e+307, a NIE minimum szeregu (-1e+308)", () => {
    const q1 = quantile([...SKRAJNY], 0.25);
    expect(q1).toBe(5e307);
    expect(q1).not.toBe(-1e308);
  });

  it("kwartyle szeregu rozciągniętego na całą podwójną precyzję są policzalne", () => {
    expect(quantile([...ROZCIAGNIETY], 0.25)).toBe(-5e307);
    expect(quantile([...ROZCIAGNIETY], 0.5)).toBe(0);
    expect(quantile([...ROZCIAGNIETY], 0.75)).toBe(5e307);
  });

  it("mieszanie nie przepełnia się na ŻADNEJ parze skrajnych obserwacji", () => {
    const skrajne = [-Number.MAX_VALUE, -1e300, 0, 1e300, Number.MAX_VALUE];
    for (let i = 0; i <= 40; i++) {
      const v = quantile(skrajne, i / 40);
      expect(v, `p = ${i / 40}`).not.toBeNull();
      expect(Number.isFinite(v as number)).toBe(true);
    }
  });
});

describe("quantile - własności brzegowe", () => {
  it("p = 0 daje minimum, p = 1 daje maksimum", () => {
    const dane = [-4, 0, 2, 11];
    expect(quantile(dane, 0)).toBe(-4);
    expect(quantile(dane, 1)).toBe(11);
  });

  it("jedna obserwacja jest każdym swoim kwantylem", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(quantile([42], p)).toBe(42);
    }
  });

  it("dwie obserwacje interpolują się liniowo", () => {
    expect(quantile([10, 20], 0)).toBe(10);
    expect(quantile([10, 20], 0.25)).toBe(12.5);
    expect(quantile([10, 20], 0.5)).toBe(15);
    expect(quantile([10, 20], 0.75)).toBe(17.5);
    expect(quantile([10, 20], 1)).toBe(20);
  });

  it("tablica samych powtórzeń daje tę samą liczbę na każdym p", () => {
    const dane = [5, 5, 5, 5];
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
      expect(quantile(dane, p), `p = ${p}`).toBe(5);
    }
  });

  it("powtórzenia w środku próby nie psują interpolacji", () => {
    const dane = [1, 2, 2, 2, 3];
    expect(quantile(dane, 0.25)).toBe(2);
    expect(quantile(dane, 0.5)).toBe(2);
    expect(quantile(dane, 0.75)).toBe(2);
  });

  it("pusta tablica MILCZY", () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([], 0)).toBeNull();
  });

  it("p poza [0, 1] MILCZY, zamiast zaciskać się do minimum albo maksimum", () => {
    const dane = [1, 2, 3, 4];
    for (const p of [-0.001, -1, 1.001, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(quantile(dane, p), `p = ${p}`).toBeNull();
    }
  });

  it("NaN i nieskończoność w danych dają null, zamiast liczby z niczego", () => {
    expect(quantile([Number.NaN, 1], 0.5)).toBeNull();
    expect(quantile([0, Number.POSITIVE_INFINITY], 0.5)).toBeNull();
    expect(quantile([Number.NaN], 0.5)).toBeNull();
  });

  it("minimum policzalne jest podane nawet wtedy, gdy sąsiad jest nieskończony", () => {
    // p = 0 nie interpoluje niczego, więc `Infinity * 0` (czyli NaN) nie ma
    // prawa zabrać obserwacji, która w tablicy jest i jest zapisywalna.
    expect(quantile([0, Number.POSITIVE_INFINITY], 0)).toBe(0);
  });
});

describe("quantile - kontrakt: wejście JEST posortowane", () => {
  it("nie sortuje po cichu - na tablicy nieposortowanej czyta pozycje", () => {
    // Dowód kontraktu, nie zachęta: koszt sortowania ponosi wywołujący, bo
    // z tej samej tablicy liczy trzy kwartyle. Gdyby funkcja sortowała kopię,
    // ten test dałby 2 (medianę) zamiast 1 (środkowej pozycji wejścia).
    expect(quantile([3, 1, 2], 0.5)).toBe(1);
  });
});

describe("median", () => {
  it("jest kwantylem 0,5 i niczym innym", () => {
    for (const dane of [[1, 2, 3, 4], [1, 2, 3], [7], [-5, 5]]) {
      expect(median(dane)).toBe(quantile(dane, 0.5));
    }
  });

  it("na próbie parzystej uśrednia dwie środkowe obserwacje", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("pusta próba MILCZY", () => {
    expect(median([])).toBeNull();
  });
});

describe("iqr", () => {
  it("liczy q3 - q1 z ręcznego przykładu", () => {
    expect(iqr([1, 2, 3, 4])).toBe(1.5);
    expect(iqr([15, 20, 35, 40, 50])).toBe(20);
  });

  it("próba bez rozrzutu ma rozstęp zerowy, a nie żaden", () => {
    expect(iqr([5, 5, 5, 5])).toBe(0);
  });

  it("MILCZY, gdy przepełnia się sama różnica q3 - q1", () => {
    const rozjechany = [-1.5e308, -1.5e308, 0, 1.5e308, 1.5e308];
    expect(quantile(rozjechany, 0.25)).toBe(-1.5e308);
    expect(quantile(rozjechany, 0.75)).toBe(1.5e308);
    // Oba kwartyle są zapisywalne, ich różnica już nie - i to jest cały defekt.
    expect(iqr(rozjechany)).toBeNull();
  });

  it("pusta próba MILCZY", () => {
    expect(iqr([])).toBeNull();
  });
});

describe("tukeyFence - REGRESJA: ogrodzenie z przepełnienia", () => {
  it("MILCZY, choć rozstęp jest skończony - granice już nie są", () => {
    // Warunek postawiony na samym rozstępie przepuszczał ten szereg dalej.
    expect(iqr([...ROZCIAGNIETY])).toBe(1e308);
    expect(tukeyFence([...ROZCIAGNIETY], FACTOR)).toBeNull();
  });

  it("nie produkuje ogrodzenia { lower: 0, upper: 0 }", () => {
    // Zero jest LEGALNĄ granicą, więc taka osłona nie milczy - ogłasza
    // odstającą każdą obserwację różną od zera. Test pilnuje, żeby wynikiem
    // był brak orzeczenia, a nie orzeczenie o wszystkich naraz.
    expect(tukeyFence([...ROZCIAGNIETY], FACTOR)).not.toEqual({ lower: 0, upper: 0 });
  });
});

describe("tukeyFence", () => {
  it("liczy granice z ręcznego przykładu", () => {
    // q1 = 20, q3 = 40, IQR = 20 -> [20 - 30, 40 + 30]
    expect(tukeyFence([15, 20, 35, 40, 50], FACTOR)).toEqual({ lower: -10, upper: 70 });
  });

  it("przy zerowym rozstępie ogrodzenie zaciska się do kwartyli", () => {
    expect(tukeyFence([5, 5, 5, 5], FACTOR)).toEqual({ lower: 5, upper: 5 });
  });

  it("współczynnik 0 daje ogrodzenie równe kwartylom", () => {
    expect(tukeyFence([1, 2, 3, 4], 0)).toEqual({ lower: 1.75, upper: 3.25 });
  });

  it("MILCZY, gdy rozstępu nie da się policzyć", () => {
    expect(tukeyFence([], FACTOR)).toBeNull();
    expect(tukeyFence([-1.5e308, -1.5e308, 0, 1.5e308, 1.5e308], FACTOR)).toBeNull();
    expect(tukeyFence([Number.NaN, 1, 2, 3], FACTOR)).toBeNull();
  });

  it("MILCZY przy współczynniku ujemnym albo niezapisywalnym", () => {
    // Ujemny mnożnik daje dolną granicę POWYŻEJ górnej, czyli ogrodzenie
    // orzekające, że odstają wszystkie obserwacje naraz.
    for (const f of [-0.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tukeyFence([15, 20, 35, 40, 50], f), `factor = ${f}`).toBeNull();
    }
  });

  it("dolna granica nigdy nie leży powyżej górnej", () => {
    for (const dane of [
      [1, 2, 3, 4],
      [15, 20, 35, 40, 50],
      [0, 0, 0, 1],
      [-100, -3, -3, 2, 900],
    ]) {
      const fence = tukeyFence(dane, FACTOR);
      expect(fence).not.toBeNull();
      expect((fence as { lower: number; upper: number }).lower).toBeLessThanOrEqual(
        (fence as { lower: number; upper: number }).upper,
      );
    }
  });
});

describe("baseUsable", () => {
  it("dodatnia baza jest użyteczna", () => {
    expect(baseUsable(1)).toBe("ok");
    expect(baseUsable(0.001)).toBe("ok");
    expect(baseUsable(1e300)).toBe("ok");
  });

  it("brak bazy nazywa się missing", () => {
    expect(baseUsable(null)).toBe("missing");
  });

  it("baza zerowa nazywa się zero - także zero ujemne", () => {
    expect(baseUsable(0)).toBe("zero");
    expect(baseUsable(-0)).toBe("zero");
  });

  it("baza ujemna nazywa się negative", () => {
    expect(baseUsable(-1)).toBe("negative");
    expect(baseUsable(-1e-300)).toBe("negative");
  });

  it("NaN i nieskończoność to brak pomiaru, nie osobny werdykt", () => {
    expect(baseUsable(Number.NaN)).toBe("missing");
    expect(baseUsable(Number.POSITIVE_INFINITY)).toBe("missing");
    expect(baseUsable(Number.NEGATIVE_INFINITY)).toBe("missing");
  });
});

describe("indexAgainst", () => {
  it("baza indeksuje się na INDEX_BASE", () => {
    expect(indexAgainst(200, 200)).toBe(INDEX_BASE);
    expect(INDEX_BASE).toBe(100);
  });

  it("liczy indeks z ręcznego przykładu", () => {
    expect(indexAgainst(50, 200)).toBe(25);
    expect(indexAgainst(250, 200)).toBe(125);
    expect(indexAgainst(-50, 200)).toBe(-25);
    expect(indexAgainst(0, 200)).toBe(0);
  });

  it("DZIELI PRZED MNOŻENIEM - wartości rzędu 1e307 nie giną", () => {
    // `(v * 100) / base` daje tu nieskończoność, choć sam iloraz to 10 000.
    expect((1e307 * INDEX_BASE) / 1e305).toBe(Number.POSITIVE_INFINITY);
    expect(indexAgainst(1e307, 1e305)).toBe(10000);
  });

  it("MILCZY przy bazie zerowej, zamiast dzielić przez zero", () => {
    expect(indexAgainst(10, 0)).toBeNull();
    expect(indexAgainst(10, -0)).toBeNull();
  });

  it("MILCZY przy bazie ujemnej, bo indeks odwróciłby kierunek", () => {
    expect(indexAgainst(10, -5)).toBeNull();
    expect(indexAgainst(-10, -5)).toBeNull();
  });

  it("MILCZY przy braku bazy i NIE PODSTAWIA JEDYNKI W MIANOWNIKU", () => {
    expect(indexAgainst(10, null)).toBeNull();
    expect(indexAgainst(10, Number.NaN)).toBeNull();
    // Jedynka w mianowniku dałaby tutaj 1000 - liczbę wyglądającą na
    // policzoną i niemającą nic wspólnego z danymi.
    expect(indexAgainst(10, null)).not.toBe(1000);
  });

  it("MILCZY, gdy nie ma wartości do zaindeksowania", () => {
    expect(indexAgainst(null, 200)).toBeNull();
    expect(indexAgainst(Number.NaN, 200)).toBeNull();
    expect(indexAgainst(Number.POSITIVE_INFINITY, 200)).toBeNull();
  });

  it("MILCZY, gdy sam indeks wychodzi poza podwójną precyzję", () => {
    expect(indexAgainst(1, Number.MIN_VALUE)).toBeNull();
    expect(indexAgainst(Number.MAX_VALUE, 1e-300)).toBeNull();
  });

  it("na wartościach skrajnych podaje liczbę, gdy tylko jest zapisywalna", () => {
    expect(indexAgainst(Number.MAX_VALUE, Number.MAX_VALUE)).toBe(INDEX_BASE);
    expect(indexAgainst(1e-300, 1e-300)).toBe(INDEX_BASE);
    expect(indexAgainst(1e300, 1e299)).toBe(1000);
  });
});
