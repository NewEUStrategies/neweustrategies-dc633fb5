// Reguły wykresu aktywności wątku: co wchodzi do słupka, wobec czego liczy się
// jego wysokość i jak brzmi zakres czasu serii.
//
// CO TEN PLIK DOWODZI. Trzy reguły, które do refaktoru A28 siedziały
// w środku JSX-a `ClubThreadInsightsPanel` i nie miały jak dostać tabeli
// przypadków:
//
//   1. KOLEJNOŚĆ SERII jest jedna dla legendy, słupka i tabeli. Trzy różne
//      porządki dla tych samych danych zmuszałyby do czytania wykresu za
//      każdym razem od nowa, więc kolejność jest tu STAŁA i asertowana wprost.
//   2. SERIA O ZEROWEJ WARTOŚCI NIE WCHODZI DO SŁUPKA. Segment o zerowej
//      wysokości to węzeł, który nic nie znaczy, a psuje odstępy między
//      pozostałymi.
//   3. WYSOKOŚĆ LICZY SIĘ WOBEC SZCZYTU, nie wobec sumy - słupki mają
//      porównywać się między sobą. Próg trzech procent pilnuje, żeby jedna
//      pozycja na sto nie zniknęła z wykresu, a szczyt zerowy nie dzieli przez
//      zero.
//   4. PUSTA SERIA NIE MA ZAKRESU. Data początku bez danych jest informacją
//      fałszywą, więc napis zakresu jest wtedy pusty - i to jest stan, którego
//      z komponentu nie da się dosięgnąć (pusta seria kończy się pustką), więc
//      dowód musi stać tutaj.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `toInsightSeries` (składanie serii z wierszy RPC, sumy, szczyt): ma zakres
//   w testach `threadWorkspaceTypes`.
// - RENDERU: że panel te funkcje woła i rysuje ich wynik, dowodzi
//   `src/components/clubs/__tests__/clubThreadDataPanels.test.tsx`.
// - FORMATU DATY: `formatDateShort` ma własny zakres; tutaj asercja porównuje
//   się z jego WYNIKIEM, nie z wpisanym napisem.
import { describe, expect, it } from "vitest";
import {
  INSIGHT_SERIES_KEYS,
  insightBarPercent,
  insightRangeLabel,
  insightSegments,
} from "@/lib/clubs/insightChart";
import type { InsightBar } from "@/lib/clubs/workspaceTypes";
import { formatDateShort } from "@/lib/i18n/format";
import { WS_BASE_ISO, wsIsoOffset } from "@/test/clubs/threadWorkspaceFixtures";

function bar(overrides: Partial<InsightBar> = {}): InsightBar {
  return {
    index: 0,
    start: WS_BASE_ISO,
    end: wsIsoOffset(60 * 24 * 7),
    replies: 0,
    questions: 0,
    documents: 0,
    milestones: 0,
    total: 0,
    ...overrides,
  };
}

describe("INSIGHT_SERIES_KEYS", () => {
  it("trzyma JEDNĄ kolejność serii dla legendy, słupka i tabeli", () => {
    expect(INSIGHT_SERIES_KEYS).toEqual(["replies", "questions", "documents", "milestones"]);
  });
});

describe("insightSegments", () => {
  it("pomija serie o zerowej wartości - segment bez wysokości nic nie znaczy", () => {
    expect(insightSegments(bar({ replies: 4, documents: 2 }))).toEqual([
      { key: "replies", value: 4 },
      { key: "documents", value: 2 },
    ]);
  });

  it("kubełek bez aktywności nie ma segmentów wcale", () => {
    expect(insightSegments(bar())).toEqual([]);
  });

  it("segmenty idą w kolejności serii, nie w kolejności wartości", () => {
    expect(
      insightSegments(bar({ replies: 1, questions: 9, documents: 5, milestones: 3 })).map(
        (segment) => segment.key,
      ),
    ).toEqual(["replies", "questions", "documents", "milestones"]);
  });

  it("wartość ujemna z bazy nie wchodzi do słupka", () => {
    // `toInsightSeries` nie obcina znaku, a ujemna wysokość wywróciłaby układ.
    expect(insightSegments(bar({ replies: -3, questions: 2 }))).toEqual([
      { key: "questions", value: 2 },
    ]);
  });
});

describe("insightBarPercent", () => {
  it.each([
    ["pełna wysokość przy wartości równej szczytowi", 6, 6, 100],
    ["udział liczony wobec szczytu, nie wobec sumy", 2, 6, 33],
    ["połowa szczytu to połowa wysokości", 3, 6, 50],
    ["jedna pozycja na sto zostaje widoczna dzięki progowi", 1, 100, 3],
    ["szczyt zerowy nie dzieli przez zero", 0, 0, 3],
  ] as const)("%s", (_opis, value, peak, oczekiwane) => {
    expect(insightBarPercent(value, peak)).toBe(oczekiwane);
  });
});

describe("insightRangeLabel", () => {
  it("skleja początek PIERWSZEGO kubełka z końcem OSTATNIEGO", () => {
    const bars = [
      bar({ index: 0 }),
      bar({ index: 1, start: wsIsoOffset(60 * 24 * 7), end: wsIsoOffset(60 * 24 * 14) }),
    ];

    expect(insightRangeLabel(bars, "pl")).toBe(
      `${formatDateShort(WS_BASE_ISO, "pl")} - ${formatDateShort(wsIsoOffset(60 * 24 * 14), "pl")}`,
    );
  });

  it("jeden kubełek daje zakres od jego początku do jego końca", () => {
    expect(insightRangeLabel([bar()], "en")).toBe(
      `${formatDateShort(WS_BASE_ISO, "en")} - ${formatDateShort(wsIsoOffset(60 * 24 * 7), "en")}`,
    );
  });

  it("PUSTA seria nie ma zakresu - data bez danych byłaby informacją fałszywą", () => {
    expect(insightRangeLabel([], "pl")).toBe("");
  });
});
