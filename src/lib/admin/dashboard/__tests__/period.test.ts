// Testy modelu okresów pulpitu.
//
// DATY BUDUJEMY KONSTRUKTOREM LOKALNYM (`new Date(2026, 8, 12)`), a nie
// literałem ISO. Model kotwiczy okresy w strefie oglądającego, więc literał
// z "Z" na końcu przesuwałby oczekiwania o przesunięcie strefy, w której akurat
// biegnie CI - i test byłby zielony w Warszawie, a czerwony w UTC. Konstruktor
// lokalny mówi "południe TUTAJ" po obu stronach asercji.
//
// Zegara nie zamrażamy, bo nie ma czego: `resolveDashboardRange` dostaje "teraz"
// argumentem i nigdy nie czyta `Date.now()`.
import { describe, it, expect } from "vitest";
import {
  DASHBOARD_PERIODS,
  isDashboardPeriod,
  resolveDashboardRange,
  windowDays,
  REALTIME_WINDOW_MINUTES,
  type DashboardPeriodId,
} from "../period";

/** Czwartek, 12 marca 2026, 10:30 czasu lokalnego. */
const NOW = new Date(2026, 2, 12, 10, 30, 0, 0);
const NOW_MS = NOW.getTime();

const since = (p: DashboardPeriodId) => new Date(resolveDashboardRange(p, NOW_MS).current.sinceIso);
const until = (p: DashboardPeriodId) => new Date(resolveDashboardRange(p, NOW_MS).current.untilIso);
const prevSince = (p: DashboardPeriodId) =>
  new Date(resolveDashboardRange(p, NOW_MS).previous.sinceIso);
const prevUntil = (p: DashboardPeriodId) =>
  new Date(resolveDashboardRange(p, NOW_MS).previous.untilIso);

describe("resolveDashboardRange - kotwice kalendarzowe", () => {
  it("dzisiaj zaczyna się o lokalnej północy i kończy teraz", () => {
    expect(since("today")).toEqual(new Date(2026, 2, 12, 0, 0, 0, 0));
    expect(until("today").getTime()).toBe(NOW_MS);
  });

  it("tydzień zaczyna się w PONIEDZIAŁEK, nie w niedzielę", () => {
    // 12 marca 2026 to czwartek; poniedziałek tego tygodnia to 9 marca.
    expect(since("week")).toEqual(new Date(2026, 2, 9, 0, 0, 0, 0));
  });

  it("tydzień liczony w niedzielę nadal cofa się do poniedziałku", () => {
    const niedziela = new Date(2026, 2, 15, 18, 0, 0, 0).getTime();
    const r = resolveDashboardRange("week", niedziela);
    expect(new Date(r.current.sinceIso)).toEqual(new Date(2026, 2, 9, 0, 0, 0, 0));
  });

  it("miesiąc zaczyna się pierwszego", () => {
    expect(since("month")).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
  });

  it("kwartał zaczyna się pierwszego dnia kwartału", () => {
    expect(since("quarter")).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    const lipiec = new Date(2026, 7, 20, 9, 0, 0, 0).getTime();
    expect(new Date(resolveDashboardRange("quarter", lipiec).current.sinceIso)).toEqual(
      new Date(2026, 6, 1, 0, 0, 0, 0),
    );
  });

  it("półrocze zaczyna się 1 stycznia albo 1 lipca", () => {
    expect(since("half-year")).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    const wrzesien = new Date(2026, 8, 12, 9, 0, 0, 0).getTime();
    expect(new Date(resolveDashboardRange("half-year", wrzesien).current.sinceIso)).toEqual(
      new Date(2026, 6, 1, 0, 0, 0, 0),
    );
  });

  it("rok zaczyna się 1 stycznia", () => {
    expect(since("year")).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
  });

  it("podgląd na żywo to ostatnie pół godziny", () => {
    const r = resolveDashboardRange("realtime", NOW_MS);
    expect(Date.parse(r.current.untilIso)).toBe(NOW_MS);
    expect(Date.parse(r.current.sinceIso)).toBe(NOW_MS - REALTIME_WINDOW_MINUTES * 60_000);
  });
});

describe("resolveDashboardRange - okres odniesienia", () => {
  it("okno poprzednie jest RÓWNIE NIEPEŁNE co bieżące", () => {
    // O 10:30 dwunastego dnia miesiąca bieżący okres ma za sobą 11 dni i 10,5 h.
    // Odniesienie musi dostać dokładnie tyle samo, a nie cały luty.
    const r = resolveDashboardRange("month", NOW_MS);
    const curMs = Date.parse(r.current.untilIso) - Date.parse(r.current.sinceIso);
    const prevMs = Date.parse(r.previous.untilIso) - Date.parse(r.previous.sinceIso);
    expect(prevMs).toBe(curMs);
  });

  it("okno poprzednie nigdy nie zachodzi na bieżące", () => {
    for (const p of DASHBOARD_PERIODS) {
      const r = resolveDashboardRange(p, NOW_MS);
      expect(Date.parse(r.previous.untilIso)).toBeLessThanOrEqual(Date.parse(r.current.sinceIso));
    }
  });

  it("przycina odniesienie, gdy poprzedni miesiąc jest krótszy od upływu", () => {
    // 31 marca: bieżący okres ma 30 dni i 12 h, luty 2026 ma 28. Bez przycięcia
    // okno odniesienia sięgnęłoby w marzec i policzyłoby ten sam ruch dwa razy.
    const koniecMarca = new Date(2026, 2, 31, 12, 0, 0, 0).getTime();
    const r = resolveDashboardRange("month", koniecMarca);
    expect(Date.parse(r.previous.untilIso)).toBe(Date.parse(r.current.sinceIso));
    expect(new Date(r.previous.sinceIso)).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
  });

  it("dzisiaj porównuje się do wczoraj O TEJ SAMEJ PORZE", () => {
    expect(prevSince("today")).toEqual(new Date(2026, 2, 11, 0, 0, 0, 0));
    expect(prevUntil("today")).toEqual(new Date(2026, 2, 11, 10, 30, 0, 0));
  });

  it("poprzedni miesiąc jest domknięty po obu stronach", () => {
    const r = resolveDashboardRange("prev-month", NOW_MS);
    expect(r.complete).toBe(true);
    expect(new Date(r.current.sinceIso)).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
    expect(new Date(r.current.untilIso)).toEqual(new Date(2026, 2, 1, 0, 0, 0, 0));
    expect(new Date(r.previous.sinceIso)).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(new Date(r.previous.untilIso)).toEqual(new Date(2026, 1, 1, 0, 0, 0, 0));
  });

  it("rok porównuje się do tego samego wycinka roku poprzedniego", () => {
    expect(prevSince("year")).toEqual(new Date(2025, 0, 1, 0, 0, 0, 0));
  });
});

describe("resolveDashboardRange - ziarno i metadane", () => {
  it("każdy okres ma ziarno dobrane do długości", () => {
    const oczekiwane: Record<DashboardPeriodId, string> = {
      realtime: "minute",
      today: "hour",
      week: "day",
      month: "day",
      "prev-month": "day",
      quarter: "day",
      "half-year": "week",
      year: "month",
    };
    for (const p of DASHBOARD_PERIODS) {
      expect(resolveDashboardRange(p, NOW_MS).bucket).toBe(oczekiwane[p]);
    }
  });

  it("tylko poprzedni miesiąc jest okresem domkniętym", () => {
    const domkniete = DASHBOARD_PERIODS.filter((p) => resolveDashboardRange(p, NOW_MS).complete);
    expect(domkniete).toEqual(["prev-month"]);
  });

  it("przesunięcie strefy jest tym samym, co zwraca zegar oglądającego", () => {
    expect(resolveDashboardRange("today", NOW_MS).offsetMinutes).toBe(-NOW.getTimezoneOffset());
  });

  it("windowDays liczy co najmniej jeden dzień", () => {
    expect(windowDays(resolveDashboardRange("realtime", NOW_MS).current)).toBe(1);
    expect(windowDays(resolveDashboardRange("prev-month", NOW_MS).current)).toBe(28);
  });
});

describe("isDashboardPeriod", () => {
  it("przepuszcza znane okresy i odrzuca resztę", () => {
    expect(isDashboardPeriod("month")).toBe(true);
    expect(isDashboardPeriod("decade")).toBe(false);
    expect(isDashboardPeriod(null)).toBe(false);
  });
});
