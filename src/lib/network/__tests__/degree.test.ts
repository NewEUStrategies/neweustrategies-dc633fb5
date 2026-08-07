// Stopień oddalenia - czysta logika odczytu kontraktu z bazą.
//
// Ten moduł jest jedynym tłumaczem między kolumnami RPC (`degree`,
// `bridge_*`) a pojęciem domenowym używanym w UI, więc jego testy pilnują
// dwóch rzeczy, na których wszystko inne stoi:
//   1. wartość spoza zakresu NIGDY nie wchodzi do UI (degradacja do 0),
//   2. most jest albo kompletny, albo go nie ma (żadnych połówek tożsamości).
import { describe, expect, it } from "vitest";
import {
  DEGREE_I18N_SUFFIX,
  isDegreeVisible,
  normalizeDegree,
  readDegree,
  toBridge,
} from "../degree";

describe("normalizeDegree", () => {
  it("przepuszcza wyłącznie 0-3", () => {
    expect(normalizeDegree(0)).toBe(0);
    expect(normalizeDegree(1)).toBe(1);
    expect(normalizeDegree(2)).toBe(2);
    expect(normalizeDegree(3)).toBe(3);
  });

  it("degraduje do 0 wszystko, czego nie rozumie", () => {
    // Starsza wersja funkcji w bazie (brak kolumny), LEFT JOIN bez trafienia,
    // przyszłe rozszerzenie zakresu - żaden z tych przypadków nie ma prawa
    // wyprodukować „NaN°" ani „9°" na karcie.
    for (const value of [null, undefined, 4, 9, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeDegree(value)).toBe(0);
    }
  });

  it("obcina część ułamkową (numeric z Postgresa)", () => {
    expect(normalizeDegree(2.7)).toBe(2);
  });
});

describe("toBridge", () => {
  it("składa most z kompletnych kolumn", () => {
    expect(
      toBridge({
        bridge_id: "u-1",
        bridge_name: "Anna Nowak",
        bridge_avatar: "https://cdn.test/a.jpg",
        bridge_slug: "anna-nowak",
      }),
    ).toEqual({
      id: "u-1",
      name: "Anna Nowak",
      avatarUrl: "https://cdn.test/a.jpg",
      slug: "anna-nowak",
    });
  });

  it("bez id albo bez nazwy nie ma mostu (baza nie miała prawa go nazwać)", () => {
    expect(toBridge({ bridge_id: "u-1", bridge_name: null })).toBeNull();
    expect(toBridge({ bridge_id: null, bridge_name: "Anna Nowak" })).toBeNull();
    expect(toBridge({ bridge_id: "  ", bridge_name: "  " })).toBeNull();
    expect(toBridge({})).toBeNull();
  });

  it("puste awatar/slug schodzą do null, nie do pustego stringa", () => {
    // Pusty string w `src` awatara renderuje zepsuty obrazek, a pusty slug
    // zrobiłby link do /author/ - oba są gorsze niż brak.
    expect(
      toBridge({ bridge_id: "u-1", bridge_name: "A", bridge_avatar: "", bridge_slug: "" })
        ?.avatarUrl,
    ).toBeNull();
    expect(
      toBridge({ bridge_id: "u-1", bridge_name: "A", bridge_avatar: "", bridge_slug: "" })?.slug,
    ).toBeNull();
  });
});

describe("readDegree", () => {
  it("przy 2. i 3. stopniu zwraca most", () => {
    expect(readDegree({ degree: 2, bridge_id: "u-1", bridge_name: "Anna" })).toEqual({
      degree: 2,
      bridge: { id: "u-1", name: "Anna", avatarUrl: null, slug: null },
    });
    expect(readDegree({ degree: 3, bridge_id: "u-1", bridge_name: "Anna" }).bridge).not.toBeNull();
  });

  it("przy 1. stopniu most nie ma sensu i jest zerowany", () => {
    // Jesteśmy połączeni - nie ma czego mostkować. Klient nie polega na tym,
    // że baza przyśle tu NULL.
    expect(readDegree({ degree: 1, bridge_id: "u-1", bridge_name: "Anna" }).bridge).toBeNull();
  });

  it("poza zasięgiem (0) nie ma ani stopnia, ani mostu", () => {
    expect(readDegree({ degree: 0, bridge_id: "u-1", bridge_name: "Anna" })).toEqual({
      degree: 0,
      bridge: null,
    });
  });
});

describe("isDegreeVisible / DEGREE_I18N_SUFFIX", () => {
  it("0 nie jest twierdzeniem o dystansie", () => {
    expect(isDegreeVisible(0)).toBe(false);
    expect(isDegreeVisible(1)).toBe(true);
    expect(isDegreeVisible(2)).toBe(true);
    expect(isDegreeVisible(3)).toBe(true);
  });

  it("każdy widoczny stopień ma sufiks klucza i18n", () => {
    expect(DEGREE_I18N_SUFFIX).toEqual({ 1: "first", 2: "second", 3: "third" });
  });
});
