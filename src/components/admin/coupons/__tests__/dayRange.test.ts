// Granice zakresu dat zakładek Realizacje i Analityka - LOKALNA doba.
//
// PO CO. Kalendarz oddaje lokalną północ wybranego dnia, a zapytanie
// wysyłało ją wprost jako górną granicę - cała ostatnia doba wypadała z sum.
// Strefa jest ustawiana JAWNIE: w UTC konwersja jest tożsamością i test
// niczego by nie dowodził.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { localDayEndIso, localDayStartIso, localDaysAgo } from "../dayRange";

let tz: string | undefined;

beforeEach(() => {
  tz = process.env.TZ;
  process.env.TZ = "Europe/Warsaw";
});

afterEach(() => {
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
});

describe("localDayStartIso / localDayEndIso", () => {
  it("dzień wybrany w kalendarzu obejmuje CAŁĄ lokalną dobę", () => {
    const dzien = new Date(2026, 9, 19); // 19 października, lokalna północ
    expect(localDayStartIso(dzien)).toBe("2026-10-18T22:00:00.000Z");
    expect(localDayEndIso(dzien)).toBe("2026-10-19T21:59:59.999Z");
  });

  it("godzina w dacie nie przesuwa doby - liczy się dzień kalendarza", () => {
    const poludnie = new Date(2026, 9, 19, 12, 34, 56);
    expect(localDayStartIso(poludnie)).toBe("2026-10-18T22:00:00.000Z");
    expect(localDayEndIso(poludnie)).toBe("2026-10-19T21:59:59.999Z");
  });

  it("doba zmiany czasu (25 h) jest pełna - koniec nie ucieka o godzinę", () => {
    const zmiana = new Date(2026, 9, 25); // 25.10.2026 - powrót do czasu zimowego
    expect(localDayStartIso(zmiana)).toBe("2026-10-24T22:00:00.000Z");
    expect(localDayEndIso(zmiana)).toBe("2026-10-25T22:59:59.999Z");
  });

  it("brak daty albo data nieczytelna = brak granicy", () => {
    expect(localDayStartIso(undefined)).toBeNull();
    expect(localDayEndIso(undefined)).toBeNull();
    expect(localDayStartIso(new Date("x"))).toBeNull();
    expect(localDayEndIso(new Date("x"))).toBeNull();
  });

  it("nie zmienia obiektu daty z formularza", () => {
    const dzien = new Date(2026, 9, 19, 15, 0);
    localDayStartIso(dzien);
    localDayEndIso(dzien);
    expect(dzien.getHours()).toBe(15);
  });
});

describe("localDaysAgo", () => {
  it("cofa się o dni KALENDARZOWE do lokalnej północy", () => {
    const teraz = new Date(2026, 10, 2, 9, 30); // 2 listopada, po zmianie czasu
    const start = localDaysAgo(30, teraz);
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 9, 3]);
    expect([start.getHours(), start.getMinutes()]).toEqual([0, 0]);
  });

  it("zero dni = dzisiejsza północ", () => {
    const teraz = new Date(2026, 9, 19, 23, 59);
    expect(localDaysAgo(0, teraz).getTime()).toBe(new Date(2026, 9, 19).getTime());
  });
});
