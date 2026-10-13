// ZEGAR SCIENNY W NAZWANEJ STREFIE <-> CHWILA (`wallClockInZone`,
// `instantFromWallClock`) - wspolne funkcje dla pol `datetime-local`, ktore
// maja byc czytane w strefie WYDARZENIA, a nie przegladarki (OPS-15).
//
// CO TEN PLIK DOWODZI:
//
//   1. WYNIK NIE ZALEZY OD STREFY MASZYNY. Kazdy przypadek liczony jest przy
//      `process.env.TZ` ustawionym na strefe INNA niz strefa konwersji - inaczej
//      test zgadzalby sie przypadkiem, tak jak dawny `new Date(napis)` zgadzal
//      sie na maszynie stojacej w Warszawie.
//   2. LUKA I ZAKLADKA ZMIANY CZASU SA ROZSTRZYGANE JAK W POSTGRESIE. Wartosci
//      oczekiwane w tabeli nizej to wynik `'<napis>'::timestamp AT TIME ZONE
//      '<strefa>'` na PostgreSQL 16 (SET TimeZone = 'UTC'), czyli tej samej
//      operacji, ktora `_event_meeting_slot_valid` buduje siatke slotow. Inna
//      regula po stronie klienta dawalaby w noc zmiany czasu okno przesuniete
//      o godzine wzgledem slotow.
//   3. NAPIS NIEPELNY ALBO NIEISTNIEJACY DAJE `null`, a nie chwile przesunieta
//      przez `Date` na nastepny dzien.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EVENT_DEFAULT_TZ, instantFromWallClock, wallClockInZone } from "@/lib/events/timezone";

const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  // Uczestnik siedzi w Londynie - strefa maszyny rozna od strefy wydarzenia.
  process.env.TZ = "Europe/London";
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("instantFromWallClock - zwykla godzina", () => {
  it("kanarek: maszyna naprawde stoi w Londynie, wiec `new Date(napis)` przesuwa godzine", () => {
    // Dokladnie ten blad naprawia OPS-15: 9:30 wpisane z mysla o Warszawie
    // `Date` czyta w strefie przegladarki i zapisuje 08:30 UTC zamiast 07:30.
    expect(new Date("2026-09-14T09:30").toISOString()).toBe("2026-09-14T08:30:00.000Z");
  });

  it("9:30 w Warszawie we wrzesniu to 07:30 UTC, niezaleznie od strefy maszyny", () => {
    expect(instantFromWallClock("2026-09-14T09:30", "Europe/Warsaw")).toEqual({
      iso: "2026-09-14T07:30:00.000Z",
      resolution: "exact",
    });
  });

  it("ta sama godzina w strefie maszyny daje chwile o godzine pozniejsza", () => {
    expect(instantFromWallClock("2026-09-14T09:30", "Europe/London")?.iso).toBe(
      "2026-09-14T08:30:00.000Z",
    );
  });

  it("strefy poza Europa i z przesunieciem niecalkowitym", () => {
    expect(instantFromWallClock("2026-09-14T09:30", "America/New_York")?.iso).toBe(
      "2026-09-14T13:30:00.000Z",
    );
    expect(instantFromWallClock("2026-09-14T09:30", "Asia/Kolkata")?.iso).toBe(
      "2026-09-14T04:00:00.000Z",
    );
  });

  it("przyjmuje sekundy i ulamki, ktore pole oddaje przy `step` ponizej minuty", () => {
    expect(instantFromWallClock("2026-09-14T09:30:15", "Europe/Warsaw")?.iso).toBe(
      "2026-09-14T07:30:15.000Z",
    );
    expect(instantFromWallClock("2026-09-14T09:30:15.5", "Europe/Warsaw")?.iso).toBe(
      "2026-09-14T07:30:15.500Z",
    );
  });

  it("strefa nieznana `Intl` degraduje do strefy domyslnej, nie do strefy maszyny", () => {
    expect(EVENT_DEFAULT_TZ).toBe("Europe/Warsaw");
    expect(instantFromWallClock("2026-09-14T09:30", "Mars/Olympus")?.iso).toBe(
      "2026-09-14T07:30:00.000Z",
    );
    expect(instantFromWallClock("2026-09-14T09:30", null)?.iso).toBe("2026-09-14T07:30:00.000Z");
  });

  it.each([
    ["pusty napis", ""],
    ["sama data", "2026-09-14"],
    ["sama godzina", "09:30"],
    ["30 lutego", "2026-02-30T10:00"],
    ["godzina 24", "2026-09-14T24:00"],
    ["minuta 60", "2026-09-14T09:60"],
    ["miesiac 13", "2026-13-01T09:30"],
    ["strefa doklejona do napisu", "2026-09-14T09:30Z"],
  ])("%s daje null, a nie chwile przesunieta przez `Date`", (_opis, value) => {
    expect(instantFromWallClock(value, "Europe/Warsaw")).toBeNull();
  });
});

describe("instantFromWallClock - noc zmiany czasu, regula Postgresa", () => {
  // Ostatnia niedziela marca i pazdziernika 2026 (29.03 i 25.10). UE zmienia
  // czas jednoczesnie o 01:00 UTC, wiec Londyn i Warszawa przestawiaja zegary
  // w tej samej chwili - kazda w swojej godzinie lokalnej.
  it.each([
    // [opis, napis, strefa, oczekiwane ISO z PostgreSQL 16, rozstrzygniecie]
    [
      "Warszawa, luka 02:30",
      "2026-03-29T02:30",
      "Europe/Warsaw",
      "2026-03-29T01:30:00.000Z",
      "gap",
    ],
    [
      "Warszawa, luka 02:00",
      "2026-03-29T02:00",
      "Europe/Warsaw",
      "2026-03-29T01:00:00.000Z",
      "gap",
    ],
    [
      "Warszawa, 01:59 przed luka",
      "2026-03-29T01:59",
      "Europe/Warsaw",
      "2026-03-29T00:59:00.000Z",
      "exact",
    ],
    [
      "Warszawa, 03:00 po luce",
      "2026-03-29T03:00",
      "Europe/Warsaw",
      "2026-03-29T01:00:00.000Z",
      "exact",
    ],
    [
      "Warszawa, zakladka 02:30",
      "2026-10-25T02:30",
      "Europe/Warsaw",
      "2026-10-25T01:30:00.000Z",
      "overlap",
    ],
    [
      "Warszawa, zakladka 02:00",
      "2026-10-25T02:00",
      "Europe/Warsaw",
      "2026-10-25T01:00:00.000Z",
      "overlap",
    ],
    [
      "Warszawa, zakladka 02:59",
      "2026-10-25T02:59",
      "Europe/Warsaw",
      "2026-10-25T01:59:00.000Z",
      "overlap",
    ],
    [
      "Warszawa, 03:00 po zakladce",
      "2026-10-25T03:00",
      "Europe/Warsaw",
      "2026-10-25T02:00:00.000Z",
      "exact",
    ],
    [
      "Warszawa, 01:59 przed zakladka",
      "2026-10-25T01:59",
      "Europe/Warsaw",
      "2026-10-24T23:59:00.000Z",
      "exact",
    ],
    ["Londyn, luka 01:30", "2026-03-29T01:30", "Europe/London", "2026-03-29T01:30:00.000Z", "gap"],
    [
      "Londyn, zakladka 01:30",
      "2026-10-25T01:30",
      "Europe/London",
      "2026-10-25T01:30:00.000Z",
      "overlap",
    ],
    [
      "Nowy Jork, luka 02:30",
      "2026-03-08T02:30",
      "America/New_York",
      "2026-03-08T07:30:00.000Z",
      "gap",
    ],
    [
      "Nowy Jork, zakladka 01:30",
      "2026-11-01T01:30",
      "America/New_York",
      "2026-11-01T06:30:00.000Z",
      "overlap",
    ],
    // Lord Howe przestawia zegar o 30 minut - regula nie zaklada pelnej godziny.
    [
      "Lord Howe, zakladka 01:45",
      "2026-04-05T01:45",
      "Australia/Lord_Howe",
      "2026-04-04T15:15:00.000Z",
      "overlap",
    ],
  ])("%s", (_opis, value, zone, iso, resolution) => {
    expect(instantFromWallClock(value, zone)).toEqual({ iso, resolution });
  });

  it("godzina z luki wypada o dlugosc luki pozniej - 02:30 zapisuje sie jako 03:30 CEST", () => {
    const resolved = instantFromWallClock("2026-03-29T02:30", "Europe/Warsaw");
    expect(wallClockInZone(resolved?.iso, "Europe/Warsaw")).toBe("2026-03-29T03:30");
  });

  it("godzina z zakladki to DRUGIE wystapienie - czas zimowy, o godzine po pierwszym", () => {
    const pierwsze = "2026-10-25T00:30:00.000Z"; // 02:30 CEST
    const drugie = instantFromWallClock("2026-10-25T02:30", "Europe/Warsaw")?.iso;
    expect(wallClockInZone(pierwsze, "Europe/Warsaw")).toBe("2026-10-25T02:30");
    expect(drugie).toBe("2026-10-25T01:30:00.000Z");
    expect(Date.parse(drugie ?? "") - Date.parse(pierwsze)).toBe(60 * 60_000);
  });
});

describe("wallClockInZone", () => {
  it("chwila -> napis pola w strefie wydarzenia, nie maszyny", () => {
    expect(wallClockInZone("2026-09-14T07:30:00.000Z", "Europe/Warsaw")).toBe("2026-09-14T09:30");
    expect(wallClockInZone("2026-09-14T07:30:00.000Z", "Europe/London")).toBe("2026-09-14T08:30");
  });

  it("przyjmuje postac ISO z przesunieciem, jaka oddaje PostgREST", () => {
    expect(wallClockInZone("2026-09-14T07:30:00+00:00", "Europe/Warsaw")).toBe("2026-09-14T09:30");
  });

  it("polnoc jest godzina 00, a nie 24", () => {
    expect(wallClockInZone("2026-09-13T22:00:00.000Z", "Europe/Warsaw")).toBe("2026-09-14T00:00");
  });

  it("sekundy odpadaja - pole ich nie pokazuje", () => {
    expect(wallClockInZone("2026-09-14T07:30:59.999Z", "Europe/Warsaw")).toBe("2026-09-14T09:30");
  });

  it("pusta albo nieczytelna chwila daje pusty napis, nie „Invalid Date”", () => {
    expect(wallClockInZone(null, "Europe/Warsaw")).toBe("");
    expect(wallClockInZone(undefined, "Europe/Warsaw")).toBe("");
    expect(wallClockInZone("", "Europe/Warsaw")).toBe("");
    expect(wallClockInZone("nie-data", "Europe/Warsaw")).toBe("");
  });

  it("napis -> chwila -> napis wraca do siebie w kazdej minucie doby zmiany czasu (poza luka)", () => {
    for (const day of ["2026-03-29", "2026-10-25"]) {
      for (let minute = 0; minute < 24 * 60; minute += 15) {
        const hh = String(Math.floor(minute / 60)).padStart(2, "0");
        const mm = String(minute % 60).padStart(2, "0");
        const napis = `${day}T${hh}:${mm}`;
        const resolved = instantFromWallClock(napis, "Europe/Warsaw");
        expect(resolved, napis).not.toBeNull();
        if (resolved?.resolution === "gap") continue;
        expect(wallClockInZone(resolved?.iso, "Europe/Warsaw"), napis).toBe(napis);
      }
    }
  });
});
