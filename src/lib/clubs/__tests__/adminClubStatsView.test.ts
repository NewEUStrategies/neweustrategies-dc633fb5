// Odczyt metryk klubu: deskryptory kafli z wiersza `admin_club_stats`.
//
// CO TEN PLIK DOWODZI. Reguły, które wcześniej mieszkały w atrybutach JSX-a
// i dlatego nie miały jak zostać sprawdzone:
//   1. „BRAK DANYCH" NIE JEST ZEREM. Klub bez odpowiedzi nie ma mediany
//      pierwszej odpowiedzi, a klub bez tematów nie ma odsetka tematów bez
//      odpowiedzi (mianownik to zero, więc RPC oddaje NULL). Kafel pokazujący
//      w tym miejscu „0%" mówi, że klub jest zdrowy, kiedy jest tylko pusty.
//   2. ZERO JEST DANYMI. Odwrotny błąd jest równie kosztowny: „0 tematów"
//      musi być widoczne jako zero, a nie jako brak pomiaru.
//   3. PROGI KOLORU są jawne i dotyczą WYŁĄCZNIE dwóch metryk zdrowia; obsada
//      klubu nie ma „złej" liczby, więc nie ma koloru.
//   4. WARTOŚĆ NIELICZBOWA (`NaN`) degraduje się do braku danych - kafel nigdy
//      nie pokazuje `NaN%`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tego, jak kafel wygląda i skąd bierze ikonę
// (molekuła `ClubFormStatCard`, sprawdzana renderem w `ClubStatsTab.test.tsx`),
// ani trzech stanów zapytania (`ClubStatsTab.test.tsx`). Nie sprawdza też
// samego RPC - `admin_club_stats` ma pgTAP i test kontraktu w `api.test.ts`.
import { describe, expect, it } from "vitest";
import {
  CLUB_STATS_THRESHOLDS,
  clubStatTone,
  clubStatsHealthCards,
  clubStatsRosterCards,
  type ClubStatCard,
  type ClubStatsSource,
} from "../adminClubStatsView";

/** Wiersz statystyk o rozpoznawalnych, różnych wartościach. */
function statsRow(overrides: Partial<ClubStatsSource> = {}): ClubStatsSource {
  return {
    member_count: 42,
    active_members_30d: 17,
    pending_members: 3,
    group_count: 5,
    thread_count: 120,
    reply_count: 640,
    threads_30d: 9,
    replies_30d: 51,
    unanswered_count: 7,
    unanswered_pct: 12.4,
    median_first_reply_hours: 6.25,
    leads_count: 2,
    moderators_count: 4,
    banned_count: 1,
    ...overrides,
  };
}

/** Wiersz „klub bez żadnego ruchu" - wszystkie agregaty puste. */
const EMPTY_ROW: ClubStatsSource = {
  member_count: null,
  active_members_30d: null,
  pending_members: null,
  group_count: null,
  thread_count: null,
  reply_count: null,
  threads_30d: null,
  replies_30d: null,
  unanswered_count: null,
  unanswered_pct: null,
  median_first_reply_hours: null,
  leads_count: null,
  moderators_count: null,
  banned_count: null,
};

function card(cards: ClubStatCard[], id: string): ClubStatCard {
  const found = cards.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`test: brak kafla ${id}`);
  return found;
}

describe("clubStatTone - próg koloru", () => {
  it("brak danych jest NEUTRALNY, nie zielony", () => {
    expect(clubStatTone(null, 20, 40)).toBe("neutral");
    expect(clubStatTone(undefined, 20, 40)).toBe("neutral");
  });

  it("wartość nieliczbowa i nieskończoność też są neutralne, a nie czerwone", () => {
    // Ani jedna, ani druga nie jest pomiarem, więc kolor byłby tu kłamstwem
    // w drugą stronę: kafel wołający o interwencję bez żadnych danych.
    expect(clubStatTone(Number.NaN, 20, 40)).toBe("neutral");
    expect(clubStatTone(Number.POSITIVE_INFINITY, 20, 40)).toBe("neutral");
  });

  it.each([
    [0, "ok"],
    [19.9, "ok"],
    [20, "warn"],
    [39.9, "warn"],
    [40, "bad"],
    [100, "bad"],
  ])("wartość %s daje ton %s (progi domknięte od dołu)", (value, expected) => {
    expect(clubStatTone(value, 20, 40)).toBe(expected);
  });
});

describe("clubStatsHealthCards - dane pełne", () => {
  it("odsetek bez odpowiedzi jest ZAOKRĄGLONY i niesie znak procentu", () => {
    expect(
      card(clubStatsHealthCards(statsRow({ unanswered_pct: 38.6 })), "unanswered").value,
    ).toEqual({ kind: "plain", text: "39%" });
  });

  it("mediana idzie jako zdanie i18n z jednym miejscem po przecinku", () => {
    expect(card(clubStatsHealthCards(statsRow()), "firstReply").value).toEqual({
      kind: "i18n",
      key: "adminClubs.stats.hours",
      params: { value: "6.3" },
    });
  });

  it("podpowiedzi „30 dni” niosą wartość CAŁKOWITĄ, nie tę z okna", () => {
    const cards = clubStatsHealthCards(statsRow());
    expect(card(cards, "threads30d").value).toEqual({ kind: "plain", text: "9" });
    expect(card(cards, "threads30d").hint).toEqual({
      key: "adminClubs.stats.threads30dHint",
      params: { count: 120 },
    });
    expect(card(cards, "replies30d").hint).toEqual({
      key: "adminClubs.stats.replies30dHint",
      params: { count: 640 },
    });
    expect(card(cards, "unanswered").hint).toEqual({
      key: "adminClubs.stats.unansweredHint",
      params: { count: 7 },
    });
  });

  it("kolejność kafli jest tezą: najpierw brak odpowiedzi, potem czas, potem rytm", () => {
    expect(clubStatsHealthCards(statsRow()).map((entry) => entry.id)).toEqual([
      "unanswered",
      "firstReply",
      "threads30d",
      "replies30d",
    ]);
  });

  it("rytm klubu NIE ma progu koloru - „mało tematów” nie jest awarią", () => {
    const cards = clubStatsHealthCards(statsRow({ threads_30d: 0, replies_30d: 0 }));
    expect(card(cards, "threads30d").tone).toBe("neutral");
    expect(card(cards, "replies30d").tone).toBe("neutral");
  });

  it.each([
    [5, "ok"],
    [25, "warn"],
    [55, "bad"],
  ])("odsetek %i bez odpowiedzi daje ton %s", (pct, tone) => {
    expect(card(clubStatsHealthCards(statsRow({ unanswered_pct: pct })), "unanswered").tone).toBe(
      tone,
    );
  });

  it.each([
    [2, "ok"],
    [30, "warn"],
    [100, "bad"],
  ])("mediana %i godzin daje ton %s", (hours, tone) => {
    expect(
      card(clubStatsHealthCards(statsRow({ median_first_reply_hours: hours })), "firstReply").tone,
    ).toBe(tone);
  });

  it("progi są tam, gdzie mówi nagłówek modułu", () => {
    expect(CLUB_STATS_THRESHOLDS).toEqual({
      unansweredWarnPct: 20,
      unansweredBadPct: 40,
      firstReplyWarnHours: 24,
      firstReplyBadHours: 72,
    });
  });
});

describe("clubStatsHealthCards - dane puste i częściowe", () => {
  it.each([
    ["brak wiersza", null],
    ["wiersz nieodczytany", undefined],
  ])("%s daje kafle bez wartości i podpowiedzi z zerem", (_label, row) => {
    const cards = clubStatsHealthCards(row);
    expect(cards).toHaveLength(4);
    for (const entry of cards) expect(entry.value).toEqual({ kind: "missing" });
    expect(card(cards, "unanswered").tone).toBe("neutral");
    expect(card(cards, "unanswered").hint).toEqual({
      key: "adminClubs.stats.unansweredHint",
      params: { count: 0 },
    });
  });

  it("klub bez ruchu: agregaty NULL nie zamieniają się w zera na kaflach", () => {
    const cards = clubStatsHealthCards(EMPTY_ROW);
    expect(card(cards, "unanswered").value).toEqual({ kind: "missing" });
    expect(card(cards, "firstReply").value).toEqual({ kind: "missing" });
    expect(card(cards, "firstReply").tone).toBe("neutral");
  });

  it("brak MEDIANY przy istniejącym odsetku - pole opcjonalne gaśnie osobno", () => {
    const cards = clubStatsHealthCards(statsRow({ median_first_reply_hours: null }));
    expect(card(cards, "unanswered").value).toEqual({ kind: "plain", text: "12%" });
    expect(card(cards, "firstReply").value).toEqual({ kind: "missing" });
  });

  it("ZERO to dane: 0% i 0.0 godziny są pokazywane i są zielone", () => {
    const cards = clubStatsHealthCards(
      statsRow({ unanswered_pct: 0, median_first_reply_hours: 0, threads_30d: 0 }),
    );
    expect(card(cards, "unanswered").value).toEqual({ kind: "plain", text: "0%" });
    expect(card(cards, "unanswered").tone).toBe("ok");
    expect(card(cards, "firstReply").value).toEqual({
      kind: "i18n",
      key: "adminClubs.stats.hours",
      params: { value: "0.0" },
    });
    expect(card(cards, "threads30d").value).toEqual({ kind: "plain", text: "0" });
  });

  it("`NaN` z dzielenia przez zero degraduje się do braku danych, nie do napisu NaN z procentem", () => {
    const cards = clubStatsHealthCards(
      statsRow({ unanswered_pct: Number.NaN, median_first_reply_hours: Number.NaN }),
    );
    expect(card(cards, "unanswered").value).toEqual({ kind: "missing" });
    expect(card(cards, "firstReply").value).toEqual({ kind: "missing" });
    expect(card(cards, "firstReply").tone).toBe("neutral");
  });
});

describe("clubStatsRosterCards - obsada klubu", () => {
  it("osiem liczników w stałej kolejności, bez podpowiedzi i bez koloru", () => {
    const cards = clubStatsRosterCards(statsRow());
    expect(cards.map((entry) => entry.id)).toEqual([
      "members",
      "active30d",
      "pending",
      "groups",
      "threads",
      "leads",
      "moderators",
      "banned",
    ]);
    for (const entry of cards) {
      expect(entry.hint).toBeNull();
      expect(entry.tone).toBe("neutral");
    }
  });

  it("każdy licznik czyta SWOJĄ kolumnę - przestawienie dwóch byłoby niewidoczne", () => {
    const cards = clubStatsRosterCards(statsRow());
    expect(cards.map((entry) => entry.value)).toEqual([
      { kind: "plain", text: "42" },
      { kind: "plain", text: "17" },
      { kind: "plain", text: "3" },
      { kind: "plain", text: "5" },
      { kind: "plain", text: "120" },
      { kind: "plain", text: "2" },
      { kind: "plain", text: "4" },
      { kind: "plain", text: "1" },
    ]);
  });

  it("etykieta każdego licznika to klucz z rodziny statystyk", () => {
    for (const entry of clubStatsRosterCards(statsRow())) {
      expect(entry.labelKey).toBe(`adminClubs.stats.${entry.id}`);
    }
  });

  it("brak wiersza daje osiem kresek, a nie osiem zer", () => {
    for (const entry of clubStatsRosterCards(null)) {
      expect(entry.value).toEqual({ kind: "missing" });
    }
  });

  it("zerowa obsada pokazuje zera - klub bez członków to informacja", () => {
    const cards = clubStatsRosterCards({ ...EMPTY_ROW, member_count: 0, banned_count: 0 });
    expect(card(cards, "members").value).toEqual({ kind: "plain", text: "0" });
    expect(card(cards, "banned").value).toEqual({ kind: "plain", text: "0" });
    expect(card(cards, "groups").value).toEqual({ kind: "missing" });
  });

  it("identyfikatory obu sekcji się nie powtarzają - `key` w Reakcie musi być unikalny", () => {
    const ids = [
      ...clubStatsHealthCards(statsRow()).map((entry) => entry.id),
      ...clubStatsRosterCards(statsRow()).map((entry) => entry.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
