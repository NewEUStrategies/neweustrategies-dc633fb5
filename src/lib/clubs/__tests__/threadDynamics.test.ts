// Dynamika dyskusji - cztery sygnały zamiast jednej liczby „12 odpowiedzi".
//
// PO CO TEN PLIK ISTNIEJE. `computeThreadDynamics` jest jedynym miejscem,
// w którym wątek zamienia się w wykres: tempo, liczba głosów, czas do
// pierwszej reakcji i rozkład w czasie. Wszystko liczone z wierszy, które już
// są w pamięci - bez dodatkowego zapytania - więc jedynym sposobem, żeby się
// dowiedzieć, że liczba na ekranie kłamie, jest ten test.
//
// CO JEST PRZEDMIOTEM DOWODU:
//   1. TOŻSAMOŚĆ GŁOSU. Uczestnik jest identyfikowany kaskadą: konto, alias,
//      podpis, a na końcu „nikt" (osobno per wiersz). Scalenie dwóch wpisów
//      bez autorstwa w jeden zaniżałoby liczbę uczestników i robiło z debaty
//      monolog.
//   2. MEDIANA, NIE ŚREDNIA. Przerwa między odpowiedziami ma opisywać tempo
//      typowe, a nie jedną nocną przerwę.
//   3. ODPORNOŚĆ NA ZŁE DATY. `created_at` wątku i odpowiedzi bywa pusty
//      w danych sprzed migracji; wykres ma się wtedy oprzeć na tym, co jest,
//      a nie wyrzucić wyjątek w środku renderu wątku.
//
// GRANICA DOWODU. Zero atrap - moduł nie dotyka ani sieci, ani zegara poza
// jawnym parametrem `now`, więc każdy przypadek jest deterministyczny.
//
// GAŁĘZIE NIEOSIĄGALNE (sufit pokrycia gałęzi dla tego pliku: 84,91%, 45/53).
// Osiem gałęzi to zapasy `?? …` przy indeksowaniu tablic, wymuszone przez
// `noUncheckedIndexedAccess`, oraz `if (bucket)` po zaklamrowanym indeksie.
// Każdy z nich stoi na indeksie DOWIEDZIONYM w kodzie obok (`stamps.length > 0`,
// `i < stamps.length`, `Math.min(DYNAMICS_BUCKETS - 1, …)`), więc jego gałąź
// „puste" nie jest osiągalna bez złamania typów. Nie dobijamy jej rzutowaniem.
import { describe, expect, it } from "vitest";
import {
  DYNAMICS_BUCKETS,
  computeThreadDynamics,
  formatDurationShort,
} from "@/lib/clubs/threadDynamics";

const iso = (minutesFromBase: number) =>
  new Date(Date.parse("2026-08-01T10:00:00.000Z") + minutesFromBase * 60_000).toISOString();

describe("threadDynamics", () => {
  it("zwraca zera dla wątku bez odpowiedzi", () => {
    const d = computeThreadDynamics(iso(0), []);
    expect(d.total).toBe(0);
    expect(d.participants).toBe(0);
    expect(d.peak).toBe(0);
    expect(d.firstReplyMinutes).toBeNull();
    expect(d.lastActivityAt).toBeNull();
    expect(d.buckets).toHaveLength(DYNAMICS_BUCKETS);
  });

  it("liczy uczestników per autor, alias i wpis bez autorstwa", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(10), author_id: "a", author_name: "A" },
      { created_at: iso(20), author_id: "a", author_name: "A" },
      { created_at: iso(30), author_id: null, author_alias: "Sokół" },
      { created_at: iso(40), author_id: null },
      { created_at: iso(50), author_id: null },
    ]);
    expect(d.total).toBe(5);
    expect(d.participants).toBe(4);
  });

  it("liczy czas do pierwszej odpowiedzi i medianę przerw", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(30), author_id: "a" },
      { created_at: iso(60), author_id: "b" },
      { created_at: iso(120), author_id: "c" },
    ]);
    expect(d.firstReplyMinutes).toBe(30);
    expect(d.medianGapMinutes).toBe(45);
    expect(d.lastActivityAt).toBe(iso(120));
  });

  it("rozkłada odpowiedzi na słupki i zna szczyt", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(1), author_id: "a" },
      { created_at: iso(2), author_id: "b" },
      { created_at: iso(240), author_id: "c" },
    ]);
    expect(d.buckets).toHaveLength(DYNAMICS_BUCKETS);
    expect(d.buckets.reduce((s, b) => s + b.count, 0)).toBe(3);
    expect(d.peak).toBe(2);
    expect(d.buckets[DYNAMICS_BUCKETS - 1]?.count).toBe(1);
  });

  it("liczy aktywność z ostatnich 24 h względem `now`", () => {
    const now = Date.parse(iso(3000));
    const d = computeThreadDynamics(
      iso(0),
      [
        { created_at: iso(10), author_id: "a" },
        { created_at: iso(2000), author_id: "b" },
        { created_at: iso(2990), author_id: "c" },
      ],
      now,
    );
    expect(d.last24h).toBe(2);
  });

  it("wpis bez konta i bez aliasu liczy się po NAZWIE autora", () => {
    // Trzeci szczebel identyfikacji. Po usunięciu konta wiersz traci
    // `author_id`, ale zachowuje podpis - dwie wypowiedzi tej samej osoby
    // muszą nadal być JEDNYM głosem, a nie dwoma.
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(10), author_id: null, author_alias: null, author_name: "Zofia Wilk" },
      { created_at: iso(20), author_id: null, author_alias: null, author_name: "Zofia Wilk" },
      { created_at: iso(30), author_id: null, author_alias: null, author_name: "Karol Dąb" },
      { created_at: iso(40), author_id: null, author_alias: null, author_name: "" },
      { created_at: iso(50), author_id: "", author_alias: "", author_name: null },
    ]);
    // Dwa podpisy + dwa wpisy BEZ jakiegokolwiek autorstwa liczone osobno.
    expect(d.participants).toBe(4);
  });

  it("mediana przerw przy NIEPARZYSTEJ liczbie przerw bierze środkową, nie średnią", () => {
    // Cztery odpowiedzi to trzy przerwy: 10, 100, 20 minut. Środkowa po
    // posortowaniu to 20 - średnia (43,3) mówiłaby o tempie, którego w tej
    // dyskusji nigdy nie było.
    const d = computeThreadDynamics(iso(0), [
      { created_at: iso(5), author_id: "a" },
      { created_at: iso(15), author_id: "b" },
      { created_at: iso(115), author_id: "c" },
      { created_at: iso(135), author_id: "d" },
    ]);
    expect(d.medianGapMinutes).toBe(20);
  });

  it("niepoprawna data otwarcia wątku nie wywraca wykresu - oś zaczyna się od pierwszej odpowiedzi", () => {
    // `created_at` wątku bywa pusty w danych sprzed migracji. Wykres ma się
    // wtedy oprzeć na tym, co JEST (pierwsza odpowiedź), a czas do pierwszej
    // reakcji zniknąć - bo nie ma od czego go liczyć.
    const d = computeThreadDynamics("nie-data", [
      { created_at: iso(10), author_id: "a" },
      { created_at: iso(70), author_id: "b" },
    ]);
    expect(d.total).toBe(2);
    expect(d.firstReplyMinutes).toBeNull();
    expect(d.buckets[0]?.start).toBe(Date.parse(iso(10)));
    expect(d.lastActivityAt).toBe(iso(70));
  });

  it("niepoprawna data otwarcia BEZ odpowiedzi daje pusty przekrój, nie wyjątek", () => {
    const d = computeThreadDynamics("", [], Date.parse(iso(0)));
    expect(d.total).toBe(0);
    expect(d.participants).toBe(0);
    expect(d.peak).toBe(0);
    expect(d.last24h).toBe(0);
    expect(d.firstReplyMinutes).toBeNull();
    expect(d.lastActivityAt).toBeNull();
    expect(d.medianGapMinutes).toBeNull();
    expect(d.buckets).toHaveLength(DYNAMICS_BUCKETS);
  });

  it("odpowiedź z niepoprawną datą wypada z liczenia, reszta zostaje", () => {
    const d = computeThreadDynamics(iso(0), [
      { created_at: "", author_id: "a" },
      { created_at: iso(30), author_id: "b" },
    ]);
    // `total` liczy WPISY Z DATĄ - słupek bez czasu nie ma gdzie stanąć.
    expect(d.total).toBe(1);
    // Uczestnicy liczą się z wierszy, nie ze znaczników czasu: osoba bez
    // poprawnej daty nadal w tej dyskusji była.
    expect(d.participants).toBe(2);
  });

  it("formatuje czas trwania", () => {
    expect(formatDurationShort(null)).toBeNull();
    expect(formatDurationShort(42)).toBe("42 min");
    expect(formatDurationShort(180)).toBe("3 h");
    expect(formatDurationShort(60 * 24 * 5)).toBe("5 d");
  });
});
