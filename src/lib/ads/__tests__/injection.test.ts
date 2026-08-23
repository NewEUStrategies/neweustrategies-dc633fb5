// Logika WYBORU wstawek reklamowych - warstwa, która decyduje ILE reklam
// zobaczy czytelnik i GDZIE. Błąd w jedną stronę to utracony przychód,
// w drugą - artykuł zamieniony w tor przeszkód.
//
// CO TEN PLIK DOWODZI.
//   1. SUFIT `MAX_MID_POST_ADS` JEST TWARDY I CICHY. Redakcja konfiguruje
//      cztery wstawki (paragraf 2, 3, 5, 9), a czytelnik dostaje dwie - bez
//      ostrzeżenia w konsoli, bez sygnału w panelu, bez śladu w wyniku. Test
//      pilnuje jednocześnie liczby (2) i tożsamości zwycięzców (paragraf 2
//      i 3), bo sam licznik przepuściłby regres "wchodzą dwie najPÓŹNIEJSZE".
//   2. `NaN` Z KONFIGURACJI NIE JEST ODRZUCANY, A ZAJMUJE MIEJSCE W LIMICIE.
//      Redakcyjne "co drugi" w polu numerycznym daje `Number(...) = NaN`.
//      Komparator zwraca wtedy `NaN`, co silnik traktuje jak "równe", więc
//      taki placement zostaje tam, gdzie stał w wyniku zapytania - i jeśli
//      stał w pierwszej dwójce, WYPYCHA poprawnie skonfigurowaną wstawkę,
//      a sam nic nie renderuje (`paragraphs[NaN]` to `undefined`). Trzy
//      skonfigurowane kampanie, jedna widoczna reklama. To przechodzi przez
//      `tsc` (typ pola to `number`, a jsonb i tak oddaje `unknown`) i przez
//      recenzję, bo w kodzie nie ma ani jednej gałęzi do zakwestionowania.
//   3. PRZYCIĘCIE `Math.min` PRZESUWA REKLAMĘ NA KONIEC WPISU. `paragraph: 40`
//      przy trzech paragrafach nie znaczy "nie wstawiaj", tylko "wstaw po
//      ostatnim" - wstawka "w połowie tekstu" ląduje pod wpisem.
//   4. `Math.max(1, ...)` ZAMIENIA ZERO W "PRZY KAŻDEJ KARCIE". `every: 0`
//      w liście wpisów to nie "wyłączone", to reklama po każdej karcie.
//      Ta sama funkcja przy `every` nieliczbowym daje ciszę absolutną -
//      `x % NaN` nigdy nie jest zerem, więc kampania nie pokazuje się nigdy,
//      a brak reklamy wygląda jak brak kampanii.
//   5. WARTOŚĆ UŁAMKOWA GUBI WSTAWKĘ MID-POST. `paragraph: 2.5` daje indeks
//      ułamkowy, a `paragraphs[1.5]` to `undefined` - pominięcie w ciszy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zapytania (`useAdPlacements`, okno emisji,
// targeting) mają własny plik `queries.test.tsx`; praca na DOM i portalach -
// `components/ads/__tests__/MidPostAds.test.tsx`. Tutaj nie ma ani jednego
// renderu: przedmiotem dowodu jest wyłącznie decyzja.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_MID_POST_ADS,
  placementsAfterCard,
  sortAndCapMidPost,
  targetParagraphIndex,
} from "@/lib/ads/injection";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

// --- Fixtures -----------------------------------------------------------

function slot(id: string): AdSlot {
  return {
    id,
    tenant_id: "t1",
    name: `Slot ${id}`,
    kind: "html",
    status: "active",
    html: "<b>reklama</b>",
    script: null,
    image_url: null,
    image_link: null,
    image_alt: null,
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

/** Placement o dowolnym `config` - jsonb oddaje `unknown`, więc test też. */
function placement(id: string, config: Record<string, unknown> = {}): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "t1",
    slot_id: `s-${id}`,
    position: "mid_post",
    page_type: "post",
    page_id: null,
    config,
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    slot: slot(`s-${id}`),
  };
}

const ids = (list: readonly AdPlacementWithSlot[]) => list.map((p) => p.id);

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Sufit i kolejność mid-post -----------------------------------------

describe("sortAndCapMidPost - ile reklam wchodzi w treść wpisu", () => {
  it("redakcja konfiguruje cztery wstawki, czytelnik dostaje DWIE: paragraf 2 i 3, a 5 i 9 wypadają", () => {
    const result = sortAndCapMidPost([
      placement("p9", { paragraph: 9 }),
      placement("p2", { paragraph: 2 }),
      placement("p5", { paragraph: 5 }),
      placement("p3", { paragraph: 3 }),
    ]);

    expect(ids(result)).toEqual(["p2", "p3"]);
    expect(result).toHaveLength(MAX_MID_POST_ADS);
  });

  it("odrzucenie nadmiarowych wstawek NIE zostawia śladu w konsoli - panel nigdy nie dowie się o capie", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    sortAndCapMidPost([
      placement("a", { paragraph: 1 }),
      placement("b", { paragraph: 2 }),
      placement("c", { paragraph: 3 }),
      placement("d", { paragraph: 4 }),
      placement("e", { paragraph: 5 }),
    ]);

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it("sufit obowiązuje także przy dziesięciu placementach - zawsze dokładnie dwa", () => {
    const many = Array.from({ length: 10 }, (_, i) => placement(`p${i}`, { paragraph: i + 1 }));
    expect(ids(sortAndCapMidPost(many))).toEqual(["p0", "p1"]);
  });

  it("brak config.paragraph liczy się jako 4, więc wygrywa z paragrafem 9 i przegrywa z 2", () => {
    const result = sortAndCapMidPost([
      placement("bez-konfiguracji"),
      placement("p9", { paragraph: 9 }),
      placement("p2", { paragraph: 2 }),
    ]);
    expect(ids(result)).toEqual(["p2", "bez-konfiguracji"]);
  });

  it("domyślna czwórka obowiązuje niezależnie od pozycji placementu w wyniku zapytania", () => {
    // Ten sam zestaw w dwóch kolejnościach: fallback `?? 4` musi zadziałać
    // po OBU stronach komparatora, nie tylko wtedy, gdy silnik akurat
    // podstawi wiersz bez konfiguracji jako drugi argument.
    expect(ids(sortAndCapMidPost([placement("p9", { paragraph: 9 }), placement("bez")]))).toEqual([
      "bez",
      "p9",
    ]);
    expect(ids(sortAndCapMidPost([placement("bez"), placement("p9", { paragraph: 9 })]))).toEqual([
      "bez",
      "p9",
    ]);
  });

  it("dwie wstawki na TEN SAM paragraf zachowują kolejność z zapytania (sort jest stabilny)", () => {
    const wPrzod = sortAndCapMidPost([
      placement("pierwszy", { paragraph: 2 }),
      placement("drugi", { paragraph: 2 }),
    ]);
    const wTyl = sortAndCapMidPost([
      placement("drugi", { paragraph: 2 }),
      placement("pierwszy", { paragraph: 2 }),
    ]);
    expect(ids(wPrzod)).toEqual(["pierwszy", "drugi"]);
    expect(ids(wTyl)).toEqual(["drugi", "pierwszy"]);
  });

  it("liczba w cudzysłowie (jsonb ze stringiem) jest porównywana jak liczba, nie jak tekst", () => {
    // Uwaga: porównanie tekstowe dałoby "10" < "3". Number() ratuje kolejność.
    const result = sortAndCapMidPost([
      placement("dziesiec", { paragraph: "10" }),
      placement("trzy", { paragraph: "3" }),
      placement("dwa", { paragraph: "2" }),
    ]);
    expect(ids(result)).toEqual(["dwa", "trzy"]);
  });

  it("wartość nieliczbowa ZAJMUJE miejsce w limicie: trzy kampanie, dwie w wyniku, jedna widoczna reklama", () => {
    // `NaN` w komparatorze znaczy "równe", więc placement zostaje na pozycji
    // z zapytania - tu na pierwszej. Do limitu wchodzi razem z paragrafem 2,
    // a paragraf 3 wypada. Sam nic nie wyrenderuje (paragraphs[NaN]).
    const result = sortAndCapMidPost([
      placement("co-drugi", { paragraph: "co drugi" }),
      placement("p2", { paragraph: 2 }),
      placement("p3", { paragraph: 3 }),
    ]);

    expect(ids(result)).toEqual(["co-drugi", "p2"]);
    expect(Number.isNaN(targetParagraphIndex(result[0].config, 8))).toBe(true);
  });

  it("wartość nieliczbowa POŚRODKU listy wyrzuca z limitu wstawkę na paragraf 1", () => {
    // Kolejność wejściowa: paragraf 9, śmieć, paragraf 1. Wynik nie jest
    // posortowany rosnąco - `NaN` rozspójnia komparator, więc najmniejszy
    // paragraf w ogóle nie dociera do wyniku.
    const result = sortAndCapMidPost([
      placement("p9", { paragraph: 9 }),
      placement("smiec", { paragraph: "co drugi" }),
      placement("p1", { paragraph: 1 }),
    ]);

    expect(ids(result)).toEqual(["p9", "smiec"]);
    expect(ids(result)).not.toContain("p1");
  });

  it("wartość nieliczbowa NA KOŃCU listy nie szkodzi - wtedy wygrywają dwa poprawne paragrafy", () => {
    const result = sortAndCapMidPost([
      placement("p9", { paragraph: 9 }),
      placement("p8", { paragraph: 8 }),
      placement("smiec", { paragraph: "x" }),
    ]);
    expect(ids(result)).toEqual(["p8", "p9"]);
  });

  it("zapytanie w toku (undefined) i puste (null) dają pustą listę, nie wyjątek", () => {
    expect(sortAndCapMidPost(undefined)).toEqual([]);
    expect(sortAndCapMidPost(null)).toEqual([]);
    expect(sortAndCapMidPost([])).toEqual([]);
  });

  it("nie mutuje tablicy z cache react-query (kopia przed sortowaniem)", () => {
    const wejscie = [placement("p9", { paragraph: 9 }), placement("p2", { paragraph: 2 })];
    const result = sortAndCapMidPost(wejscie);
    expect(ids(wejscie)).toEqual(["p9", "p2"]);
    expect(result).not.toBe(wejscie);
  });
});

// --- Miejsce wstawki mid-post -------------------------------------------

describe("targetParagraphIndex - po którym paragrafie leży reklama", () => {
  it("paragraph 1 celuje w pierwszy paragraf (konfiguracja liczy od 1, indeks od 0)", () => {
    expect(targetParagraphIndex({ paragraph: 1 }, 5)).toBe(0);
    expect(targetParagraphIndex({ paragraph: 3 }, 5)).toBe(2);
  });

  it("brak konfiguracji daje czwarty paragraf (indeks 3) - domyślna wartość jest w KODZIE, nie w bazie", () => {
    expect(targetParagraphIndex({}, 10)).toBe(3);
  });

  it("paragraph 40 przy trzech paragrafach ląduje na OSTATNIM - reklama 'w połowie' leży na końcu wpisu", () => {
    expect(targetParagraphIndex({ paragraph: 40 }, 3)).toBe(2);
  });

  it("paragraph 0 i wartość ujemna znaczą 'po pierwszym paragrafie', a nie 'nigdzie'", () => {
    expect(targetParagraphIndex({ paragraph: 0 }, 5)).toBe(0);
    expect(targetParagraphIndex({ paragraph: -12 }, 5)).toBe(0);
  });

  it("wartość nieliczbowa daje NaN, a paragraphs[NaN] to undefined - wstawka przepada w ciszy", () => {
    const indeks = targetParagraphIndex({ paragraph: "co drugi" }, 6);
    expect(Number.isNaN(indeks)).toBe(true);
    expect(["a", "b", "c"][indeks]).toBeUndefined();
  });

  it("wartość ułamkowa daje indeks ułamkowy - tablica paragrafów nie ma takiego elementu", () => {
    expect(targetParagraphIndex({ paragraph: 2.5 }, 6)).toBe(1.5);
    expect(["a", "b", "c"][targetParagraphIndex({ paragraph: 2.5 }, 6)]).toBeUndefined();
  });

  it("treść bez paragrafów daje indeks -1 - wstawka jest pomijana zamiast trafiać na początek", () => {
    // -1 to NIE ostatni element (to nie Python) - `paragraphs[-1]` jest undefined.
    expect(targetParagraphIndex({ paragraph: 4 }, 0)).toBe(-1);
    expect(["a", "b"][targetParagraphIndex({ paragraph: 4 }, 0)]).toBeUndefined();
  });

  it("jeden paragraf w treści: każda konfiguracja celuje w ten jeden paragraf", () => {
    expect(targetParagraphIndex({ paragraph: 1 }, 1)).toBe(0);
    expect(targetParagraphIndex({ paragraph: 99 }, 1)).toBe(0);
    expect(targetParagraphIndex({}, 1)).toBe(0);
  });
});

// --- Częstotliwość wstawek in-feed --------------------------------------

describe("placementsAfterCard - przy której karcie listy pojawia się reklama", () => {
  const co5 = placement("co5", { every: 5 });
  const bezKonfiguracji = placement("domyslny");

  it("domyślne 'co 5 kart' trafia karty o indeksie 4, 9 i 14, a nie 0-3", () => {
    for (const index of [0, 1, 2, 3, 5, 6, 7, 8]) {
      expect(ids(placementsAfterCard([bezKonfiguracji], index))).toEqual([]);
    }
    for (const index of [4, 9, 14]) {
      expect(ids(placementsAfterCard([bezKonfiguracji], index))).toEqual(["domyslny"]);
    }
  });

  it("jawne every: 5 zachowuje się identycznie jak brak konfiguracji", () => {
    expect(ids(placementsAfterCard([co5], 4))).toEqual(["co5"]);
    expect(ids(placementsAfterCard([co5], 3))).toEqual([]);
  });

  it("every: 1 trafia KAŻDĄ kartę", () => {
    const co1 = placement("co1", { every: 1 });
    for (const index of [0, 1, 2, 3, 4, 5, 17]) {
      expect(ids(placementsAfterCard([co1], index))).toEqual(["co1"]);
    }
  });

  it("every: 0 znaczy 'przy KAŻDEJ karcie', a nie 'nigdy' - zero w panelu nie wyłącza kampanii", () => {
    const zero = placement("zero", { every: 0 });
    for (const index of [0, 1, 2, 3, 4]) {
      expect(ids(placementsAfterCard([zero], index))).toEqual(["zero"]);
    }
  });

  it("every ujemne też znaczy 'przy każdej karcie' (Math.max(1, -3))", () => {
    const ujemne = placement("ujemne", { every: -3 });
    expect(ids(placementsAfterCard([ujemne], 0))).toEqual(["ujemne"]);
    expect(ids(placementsAfterCard([ujemne], 1))).toEqual(["ujemne"]);
  });

  it("every nieliczbowe NIGDY nie pokazuje reklamy - brak emisji wygląda jak brak kampanii", () => {
    const smiec = placement("smiec", { every: "co druga" });
    for (let index = 0; index < 60; index += 1) {
      expect(placementsAfterCard([smiec], index)).toEqual([]);
    }
  });

  it("every jako string liczbowy działa jak liczba (jsonb bez rzutowania)", () => {
    const tekstowe = placement("tekstowe", { every: "3" });
    expect(ids(placementsAfterCard([tekstowe], 2))).toEqual(["tekstowe"]);
    expect(ids(placementsAfterCard([tekstowe], 3))).toEqual([]);
  });

  it("every ułamkowe daje nierówny rytm: trafia co 5 kart, choć w panelu wpisano 2.5", () => {
    const ulamek = placement("ulamek", { every: 2.5 });
    expect(ids(placementsAfterCard([ulamek], 4))).toEqual(["ulamek"]);
    expect(ids(placementsAfterCard([ulamek], 9))).toEqual(["ulamek"]);
    expect(ids(placementsAfterCard([ulamek], 1))).toEqual([]);
    expect(ids(placementsAfterCard([ulamek], 2))).toEqual([]);
  });

  it("dwa placementy o różnym every trafiające tę samą kartę renderują się OBA (kumulacja, nie wybór)", () => {
    const co2 = placement("co2", { every: 2 });
    const co3 = placement("co3", { every: 3 });
    expect(ids(placementsAfterCard([co2, co3], 5))).toEqual(["co2", "co3"]);
    expect(ids(placementsAfterCard([co2, co3], 1))).toEqual(["co2"]);
    expect(ids(placementsAfterCard([co2, co3], 2))).toEqual(["co3"]);
  });

  it("brak placementów daje pustą listę dla każdego indeksu karty", () => {
    expect(placementsAfterCard([], 0)).toEqual([]);
    expect(placementsAfterCard([], 4)).toEqual([]);
  });

  it("nie ma sufitu liczby wstawek in-feed - pięć kampanii co 1 kartę daje pięć reklam pod jedną kartą", () => {
    const piec = Array.from({ length: 5 }, (_, i) => placement(`k${i}`, { every: 1 }));
    expect(ids(placementsAfterCard(piec, 0))).toEqual(["k0", "k1", "k2", "k3", "k4"]);
  });
});
