// Dwie osłony liczbowe. Ten plik pinuje JEDNĄ rzecz i jest nią RÓŻNICA
// między nimi: `finite` podstawia liczbę, `orNull` milczy, i to nie jest
// kwestia gustu wywołującego. Wartość zastępcza jest uczciwa we współrzędnej
// rysunku (rysunek musi coś narysować) i jest kłamstwem w granicy orzeczenia
// (zero wygląda dokładnie tak samo wiarygodnie jak liczba policzona z danych).
//
// Drugi dowód, mniej oczywisty: ZERO NIE JEST BRAKIEM. `orNull(0)` musi
// zwrócić zero, bo zero jest pomiarem - gdyby przechodziło na `null`, seria
// z prawdziwym zerem gubiłaby obserwacje, a model orzekałby o mniejszej
// próbie niż ta, którą dostał.
import { describe, expect, it } from "vitest";
import { finite, orNull } from "@/lib/charts/num";

/** Wszystkie sposoby, na jakie liczba może nie być liczbą. */
const NIELICZBY = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as const;

describe("finite - liczby WYŚWIETLANE", () => {
  it("przepuszcza każdą liczbę skończoną bez zmiany", () => {
    for (const v of [0, -0, 1, -1, 3.14, -2.5e-7, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      expect(Object.is(finite(v), v), `wejście ${v}`).toBe(true);
    }
  });

  it("zamienia NaN i obie nieskończoności na zero domyślne", () => {
    for (const v of NIELICZBY) expect(finite(v)).toBe(0);
  });

  it("zamienia je na wartość zastępczą podaną przez wywołującego", () => {
    for (const v of NIELICZBY) expect(finite(v, 7)).toBe(7);
    expect(finite(Number.NaN, -1)).toBe(-1);
  });

  it("nie podstawia zastępczej, gdy wartość jest skończona - także dla zera", () => {
    expect(finite(0, 99)).toBe(0);
    expect(finite(-5, 99)).toBe(-5);
  });

  it("liczba najmniejsza zapisywalna (subnormalna) jest liczbą, nie brakiem", () => {
    expect(finite(Number.MIN_VALUE)).toBe(Number.MIN_VALUE);
  });
});

describe("orNull - liczby, o których model ORZEKA", () => {
  it("przepuszcza każdą liczbę skończoną bez zmiany", () => {
    for (const v of [1, -1, 3.14, Number.MAX_VALUE, Number.MIN_VALUE]) {
      expect(orNull(v)).toBe(v);
    }
  });

  it("ZERO JEST POMIAREM i przechodzi jako zero, nie jako brak", () => {
    expect(orNull(0)).toBe(0);
    expect(orNull(-0)).toBe(-0);
  });

  it("NaN i obie nieskończoności dają null", () => {
    for (const v of NIELICZBY) expect(orNull(v)).toBeNull();
  });

  it("null i undefined dają null - jedno wejście dla wszystkich braków", () => {
    expect(orNull(null)).toBeNull();
    expect(orNull(undefined)).toBeNull();
  });
});

describe("finite kontra orNull - dlaczego to są DWIE funkcje", () => {
  it("na liczbach skończonych są nierozróżnialne", () => {
    for (const v of [-1e300, -1, 0, 1, 1e300]) {
      expect(orNull(v)).toBe(finite(v, Number.NaN));
    }
  });

  it("rozjeżdżają się DOKŁADNIE na tym, czego nie da się zapisać", () => {
    for (const v of NIELICZBY) {
      // Rysunek dostaje liczbę (ma co narysować), orzeczenie dostaje null
      // (nie ma czego orzekać) - i o to w tym podziale chodzi.
      expect(Number.isFinite(finite(v))).toBe(true);
      expect(orNull(v)).toBeNull();
    }
  });

  it("przepełnienie podwójnej precyzji idzie tą samą ścieżką, co NaN", () => {
    const przepelnione = 1e308 * 10;
    expect(finite(przepelnione, -1)).toBe(-1);
    expect(orNull(przepelnione)).toBeNull();
  });
});
