// Rozkład aktywności klubu na czternaście dni - tabela przypadków bez renderu.
//
// CO TEN PLIK DOWODZI. Reguła ma trzy granice, których nie widać w DOM-ie
// paska, a każda z nich kiedyś produkowała złą liczbę:
//   1. OKNO jest domknięte z DWÓCH stron - wątek starszy niż czternaście dni
//      i wątek ze znacznikiem czasu Z PRZYSZŁOŚCI (rozjazd zegara serwera) nie
//      dostają słupka, ale nadal liczą się do stanu „żywy/uśpiony”.
//   2. BRAK ODPOWIEDZI kotwiczy słupek na dacie założenia (`created_at`), bo
//      wątek otwarty dzisiaj JEST ruchem w klubie.
//   3. ZNACZNIK NIE DO ODCZYTANIA wypada z rozkładu i nie wywraca rachunku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Progów poziomów pulsu - `computeThreadPulse`
// ma własny plik (`threadPulse.test.ts`). Tutaj sprawdzamy wyłącznie, że
// podział na „żywe” (poziom >= 2) i „uśpione” (poziom 0) jest liczony po
// WSZYSTKICH wątkach, a nie po tych z okna.
import { describe, expect, it } from "vitest";
import {
  clubActivityBarHeight,
  computeClubActivity,
  CLUB_ACTIVITY_SPAN_DAYS,
  CLUB_ACTIVITY_WEEK_DAYS,
} from "@/lib/clubs/activityStrip";
import type { ThreadPulseInput } from "@/lib/clubs/threadPulse";

const NOW = Date.parse("2026-08-18T10:00:00.000Z");
const DAY = 86_400_000;
/** Znacznik przesunięty o N dni (dodatnio = w przyszłość). */
const iso = (days: number) => new Date(NOW + days * DAY).toISOString();

function watek(overrides: Partial<ThreadPulseInput> = {}): ThreadPulseInput {
  return {
    created_at: iso(-1),
    last_reply_at: iso(0),
    reply_count: 12,
    participant_count: 5,
    ...overrides,
  };
}

describe("computeClubActivity", () => {
  it("pusta lista daje okno pełne zer, bez szczytu i bez stanów", () => {
    const model = computeClubActivity([], NOW);
    expect(model.days).toHaveLength(CLUB_ACTIVITY_SPAN_DAYS);
    expect(model.days.every((value) => value === 0)).toBe(true);
    expect(model).toMatchObject({ peak: 0, week: 0, live: 0, dormant: 0 });
  });

  it("ostatni słupek to dzisiaj, a pierwszy - najstarszy dzień okna", () => {
    const model = computeClubActivity(
      [watek({ last_reply_at: iso(0) }), watek({ last_reply_at: iso(-13) })],
      NOW,
    );
    expect(model.days[CLUB_ACTIVITY_SPAN_DAYS - 1]).toBe(1);
    expect(model.days[0]).toBe(1);
    expect(model.peak).toBe(1);
  });

  it.each([
    ["dzień przed oknem", -CLUB_ACTIVITY_SPAN_DAYS],
    ["rok przed oknem", -365],
    ["znacznik z przyszłości", 1],
  ])("%s nie dostaje słupka", (_nazwa, dni: number) => {
    const model = computeClubActivity([watek({ last_reply_at: iso(dni) })], NOW);
    expect(model.days.every((value) => value === 0)).toBe(true);
    expect(model.peak).toBe(0);
  });

  it("tydzień liczy dokładnie siedem ostatnich dni okna, nie osiem", () => {
    const model = computeClubActivity(
      [
        watek({ last_reply_at: iso(-(CLUB_ACTIVITY_WEEK_DAYS - 1)) }),
        watek({ last_reply_at: iso(-CLUB_ACTIVITY_WEEK_DAYS) }),
      ],
      NOW,
    );
    // Oba wątki są w oknie czternastu dni, ale tylko jeden w oknie tygodnia.
    expect(model.days.reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(model.week).toBe(1);
  });

  it("wątek bez odpowiedzi kotwiczy słupek na dacie założenia", () => {
    const model = computeClubActivity(
      [watek({ created_at: iso(-2), last_reply_at: null, reply_count: 0 })],
      NOW,
    );
    expect(model.days[CLUB_ACTIVITY_SPAN_DAYS - 3]).toBe(1);
    expect(model.week).toBe(1);
  });

  it("znacznik nie do odczytania wypada z rozkładu, ale wątek nadal ma stan", () => {
    const model = computeClubActivity(
      [
        watek({
          created_at: "termin nieznany",
          last_reply_at: null,
          reply_count: 0,
          participant_count: 0,
        }),
      ],
      NOW,
    );
    expect(model.days.every((value) => value === 0)).toBe(true);
    expect(model.dormant).toBe(1);
    expect(model.live).toBe(0);
  });

  it("stan „żywy/uśpiony” liczy WSZYSTKIE wątki, także sprzed okna", () => {
    const model = computeClubActivity(
      [
        // żywy: dwanaście odpowiedzi na dobę, pięć głosów, świeża aktywność
        watek(),
        // uśpiony i daleko poza oknem
        watek({
          created_at: iso(-400),
          last_reply_at: null,
          reply_count: 0,
          participant_count: 1,
        }),
        // ani żywy, ani uśpiony - poziom pierwszy
        watek({
          created_at: iso(-10),
          last_reply_at: iso(-3),
          reply_count: 6,
          participant_count: 2,
        }),
      ],
      NOW,
    );
    expect(model.live).toBe(1);
    expect(model.dormant).toBe(1);
    // Trzeci wątek nie jest ani jednym, ani drugim - suma stanów NIE musi być
    // równa liczbie wątków i to jest zamierzone.
    expect(model.live + model.dormant).toBe(2);
  });

  it("ten sam dzień dwa razy podnosi szczyt", () => {
    const model = computeClubActivity(
      [watek({ last_reply_at: iso(0) }), watek({ last_reply_at: iso(0) })],
      NOW,
    );
    expect(model.peak).toBe(2);
    expect(model.days[CLUB_ACTIVITY_SPAN_DAYS - 1]).toBe(2);
  });
});

describe("clubActivityBarHeight", () => {
  it.each([
    ["cisza w oknie - minimum, nie zero", 0, 0, 12],
    ["dzień bez ruchu przy niezerowym szczycie też ma minimum", 0, 4, 12],
    ["szczyt stoi na sto procent", 4, 4, 100],
    ["połowa szczytu", 2, 4, 50],
    ["ułamek pod minimum podciąga się do minimum", 1, 20, 12],
  ])("%s", (_nazwa, count: number, peak: number, oczekiwane: number) => {
    expect(clubActivityBarHeight(count, peak)).toBe(oczekiwane);
  });
});
