// Wskaźniki podsumowania newslettera.
//
// PO CO OSOBNY TEST. Te cztery liczby są jedynym miejscem, w którym operator
// widzi, czy lista rośnie - i nie ma ich z czym porównać. Błąd nie wywala
// panelu, tylko podaje inną liczbę: „wzrost 0%" przy rosnącej liście albo
// „opt-in 0%" przy pustej bazie czyta się jako awaria zapisu.
import { describe, it, expect } from "vitest";
import {
  DAY_MS,
  SUBSCRIBER_KPI_LIMIT,
  computeKpis,
  pctDelta,
  within30Days,
  withinPrevious30Days,
  type SubscriberKpiRow,
} from "@/components/admin/newsletter/overviewKpis";

const NOW = Date.parse("2026-08-19T12:00:00.000Z");

/** Znacznik czasu sprzed `days` dni. */
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function row(overrides: Partial<SubscriberKpiRow> = {}): SubscriberKpiRow {
  return {
    status: "subscribed",
    created_at: daysAgo(200),
    confirmed_at: daysAgo(200),
    unsubscribed_at: null,
    ...overrides,
  };
}

describe("zmiana procentowa", () => {
  it("wzrost ze ZERA na cokolwiek to 100%, nie nieskończoność", () => {
    expect(pctDelta(5, 0)).toBe(100);
    expect(Number.isFinite(pctDelta(5, 0))).toBe(true);
  });

  it("ze zera na zero to 0%, nie 100%", () => {
    // „100% wzrostu" przy braku zapisów w obu okresach byłoby kłamstwem.
    expect(pctDelta(0, 0)).toBe(0);
  });

  it("podwojenie to +100%, połowa to -50%", () => {
    expect(pctDelta(20, 10)).toBe(100);
    expect(pctDelta(5, 10)).toBe(-50);
  });

  it("wynik jest zaokrąglany do liczby całkowitej", () => {
    expect(pctDelta(10, 3)).toBe(233);
    expect(Number.isInteger(pctDelta(10, 3))).toBe(true);
  });

  it("brak zmiany to 0%", () => {
    expect(pctDelta(7, 7)).toBe(0);
  });
});

describe("okna czasowe", () => {
  it("wczoraj wpada w ostatnie 30 dni", () => {
    expect(within30Days(daysAgo(1), NOW)).toBe(true);
    expect(within30Days(daysAgo(29), NOW)).toBe(true);
  });

  it("45 dni temu NIE wpada w ostatnie 30 dni", () => {
    expect(within30Days(daysAgo(45), NOW)).toBe(false);
  });

  it("45 dni temu wpada w POPRZEDNIE 30 dni", () => {
    expect(withinPrevious30Days(daysAgo(45), NOW)).toBe(true);
  });

  it("okna NIE ZACHODZĄ na siebie - inaczej wzrost liczy się sam ze siebie", () => {
    for (const days of [1, 15, 29, 31, 45, 59]) {
      const iso = daysAgo(days);
      expect(
        within30Days(iso, NOW) && withinPrevious30Days(iso, NOW),
        `${days} dni temu wpada w oba okna`,
      ).toBe(false);
    }
  });

  it("starsze niż 60 dni nie wpada w żadne okno", () => {
    expect(within30Days(daysAgo(90), NOW)).toBe(false);
    expect(withinPrevious30Days(daysAgo(90), NOW)).toBe(false);
  });

  it("BRAK znacznika czasu nie wpada w żadne okno", () => {
    // `null` w `unsubscribed_at` znaczy „nie wypisał się" - nie „wypisał się dziś".
    expect(within30Days(null, NOW)).toBe(false);
    expect(withinPrevious30Days(null, NOW)).toBe(false);
  });
});

describe("wskaźniki z listy subskrybentów", () => {
  it("subskrybentem jest TYLKO potwierdzony adres", () => {
    // Wliczenie „pending" zawyżałoby listę o adresy bez potwierdzonej zgody.
    const kpis = computeKpis(
      [row(), row(), row({ status: "pending" }), row({ status: "unsubscribed" })],
      NOW,
    );

    expect(kpis.total).toBe(2);
    expect(kpis.pending).toBe(1);
  });

  it("nowe zapisy liczą się z ostatnich 30 dni", () => {
    const kpis = computeKpis(
      [
        row({ created_at: daysAgo(5) }),
        row({ created_at: daysAgo(20) }),
        row({ created_at: daysAgo(50) }),
      ],
      NOW,
    );

    expect(kpis.new30).toBe(2);
  });

  it("wzrost porównuje ostatnie 30 dni z POPRZEDNIMI 30", () => {
    const kpis = computeKpis(
      [
        row({ created_at: daysAgo(5) }),
        row({ created_at: daysAgo(10) }),
        row({ created_at: daysAgo(40) }),
      ],
      NOW,
    );

    expect(kpis.new30).toBe(2);
    expect(kpis.growthPct).toBe(100);
  });

  it("wypisania liczą się po dacie wypisania, nie po statusie", () => {
    // Adres wypisany 40 dni temu nie może psuć wskaźnika bieżącego miesiąca.
    const kpis = computeKpis(
      [
        row({ status: "unsubscribed", unsubscribed_at: daysAgo(3) }),
        row({ status: "unsubscribed", unsubscribed_at: daysAgo(40) }),
      ],
      NOW,
    );

    expect(kpis.unsub30).toBe(1);
    expect(kpis.unsubDeltaPct).toBe(0);
  });

  it("spadek wypisań jest ujemny", () => {
    const kpis = computeKpis(
      [
        row({ status: "unsubscribed", unsubscribed_at: daysAgo(3) }),
        row({ status: "unsubscribed", unsubscribed_at: daysAgo(40) }),
        row({ status: "unsubscribed", unsubscribed_at: daysAgo(45) }),
      ],
      NOW,
    );

    expect(kpis.unsub30).toBe(1);
    expect(kpis.unsubDeltaPct).toBe(-50);
  });

  it("wskaźnik potwierdzeń to udział potwierdzonych w podjętych próbach", () => {
    const kpis = computeKpis([row(), row(), row(), row({ status: "pending" })], NOW);

    expect(kpis.optInRate).toBe(75);
  });

  it("PUSTA lista daje 100%, nie NaN i nie 0%", () => {
    // „NaN%" to widoczna awaria, ale „0%" sugerowałoby, że NIKT nie potwierdza
    // adresu - a nie ma jeszcze nikogo, kto by mógł.
    const kpis = computeKpis([], NOW);

    expect(kpis.optInRate).toBe(100);
    expect(Number.isNaN(kpis.optInRate)).toBe(false);
  });

  it("lista z samych oczekujących daje 0% potwierdzeń", () => {
    const kpis = computeKpis([row({ status: "pending" }), row({ status: "pending" })], NOW);

    expect(kpis.optInRate).toBe(0);
    expect(kpis.total).toBe(0);
  });

  it("wypisani nie liczą się do wskaźnika potwierdzeń", () => {
    // Wypisanie to nie odmowa potwierdzenia - adres był potwierdzony wcześniej.
    const kpis = computeKpis([row(), row({ status: "unsubscribed" })], NOW);

    expect(kpis.optInRate).toBe(100);
    expect(kpis.total).toBe(1);
  });

  it("wszystkie wskaźniki są LICZBAMI, także dla pustej listy", () => {
    const kpis = computeKpis([], NOW);

    for (const [key, value] of Object.entries(kpis)) {
      expect(Number.isFinite(value), `${key} nie jest liczbą`).toBe(true);
    }
  });

  it("limit pobrania jest częścią kontraktu wskaźników", () => {
    // Agregacja idzie po stronie przeglądarki: powyżej limitu wskaźniki byłyby
    // liczone z URWANEJ próbki i cicho zaniżone.
    expect(SUBSCRIBER_KPI_LIMIT).toBe(50_000);
  });
});
