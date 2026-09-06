import { describe, expect, it } from "vitest";
import {
  BROKEN_LINK_ALERT_COOLDOWN_MS,
  BROKEN_LINK_ALERT_THRESHOLD,
  parseWaybackAvailability,
  shouldAlertBrokenLinks,
  waybackAvailabilityUrl,
  waybackSearchUrl,
  waybackTimestampToIso,
} from "@/lib/content/brokenLinkPolicy";

const DEAD = "https://example.org/raport-2019.pdf";

describe("wayback suggestion", () => {
  it("builds a nearest-snapshot URL without calling the API", () => {
    expect(waybackSearchUrl(DEAD)).toBe(`https://web.archive.org/web/2/${DEAD}`);
  });

  it("URL-encodes the target in the availability query", () => {
    expect(waybackAvailabilityUrl("https://a.example/x?y=1&z=2")).toBe(
      "https://archive.org/wayback/available?url=https%3A%2F%2Fa.example%2Fx%3Fy%3D1%26z%3D2",
    );
  });

  it("parses a present snapshot and upgrades http to https", () => {
    expect(
      parseWaybackAvailability({
        archived_snapshots: {
          closest: {
            available: true,
            url: "http://web.archive.org/web/20190101120000/https://example.org/",
            timestamp: "20190101120000",
            status: "200",
          },
        },
      }),
    ).toEqual({
      url: "https://web.archive.org/web/20190101120000/https://example.org/",
      timestamp: "20190101120000",
    });
  });

  it("returns null for every shape that means no snapshot", () => {
    // Brak migawki to PUSTY obiekt, nie błąd HTTP - najczęstszy realny przypadek.
    expect(parseWaybackAvailability({ archived_snapshots: {} })).toBeNull();
    expect(parseWaybackAvailability({})).toBeNull();
    expect(parseWaybackAvailability(null)).toBeNull();
    expect(parseWaybackAvailability("nope")).toBeNull();
    expect(
      parseWaybackAvailability({ archived_snapshots: { closest: { available: false } } }),
    ).toBeNull();
    expect(
      parseWaybackAvailability({ archived_snapshots: { closest: { available: true } } }),
    ).toBeNull();
  });

  it("formats a wayback timestamp as ISO and rejects junk", () => {
    expect(waybackTimestampToIso("20190101120000")).toBe("2019-01-01T12:00:00Z");
    expect(waybackTimestampToIso("2019")).toBeNull();
    expect(waybackTimestampToIso(null)).toBeNull();
    expect(waybackTimestampToIso("")).toBeNull();
  });
});

describe("broken link threshold alert", () => {
  const NOW = Date.parse("2026-08-03T12:00:00Z");

  it("stays silent below the threshold", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD - 1,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("fires on the first crossing of the threshold", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does not repeat the same alert inside the cooldown", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD + 2,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - 3_600_000).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("fires again once the cooldown expires", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - BROKEN_LINK_ALERT_COOLDOWN_MS - 1).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("breaks the cooldown when the problem grows by another full threshold", () => {
    // Padła cała domena źródłowa - fala nowych 404 nie może czekać doby.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD * 2,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - 60_000).toISOString(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("treats an unparsable stored timestamp as never notified", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: "not-a-date",
        now: NOW,
      }),
    ).toBe(true);
  });

  it("honours an explicit threshold override", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: 3,
        threshold: 3,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GAŁĘZIE BRZEGOWE ODPOWIEDZI ARCHIWUM (`parseWaybackAvailability`) - część C.
//
// Powyższe testy przechodzą wyłącznie ścieżką "migawka jest, url na http".
// Poniżej domykamy trzy odmowy/warianty, na których stoi kontrakt panelu:
// pusty adres, adres JUŻ w https (pominięta normalizacja) i migawka bez
// użytecznego znacznika czasu. Wszystkie adresy są z domeny example.org.
// ---------------------------------------------------------------------------
describe("parseWaybackAvailability - przypadki brzegowe odpowiedzi archiwum", () => {
  it("adres złożony z samych spacji to BRAK migawki, nie migawka o pustym adresie", () => {
    // Gałąź `!url.trim()`. Bez niej panel wyrenderowałby odnośnik "zamień na
    // migawkę" prowadzący donikąd, a redaktor uznałby przypis za naprawiony.
    expect(
      parseWaybackAvailability({
        archived_snapshots: { closest: { available: true, url: "   ", status: "200" } },
      }),
    ).toBeNull();
    expect(
      parseWaybackAvailability({
        archived_snapshots: { closest: { available: true, url: "" } },
      }),
    ).toBeNull();
  });

  it("adres, który JUŻ jest https, przechodzi bez zmiany", () => {
    // Gałąź `: url` - normalizacja http->https jest pomijana. Test pilnuje, by
    // "poprawka" nie zaczęła podmieniać fragmentu `http://` w ADRESIE CELU
    // schowanym za prefiksem `/web/<ts>/`.
    const snapshot = parseWaybackAvailability({
      archived_snapshots: {
        closest: {
          available: true,
          url: "https://web.archive.org/web/20190101120000/http://example.org/raport.pdf",
          timestamp: "20190101120000",
        },
      },
    });
    expect(snapshot).toEqual({
      url: "https://web.archive.org/web/20190101120000/http://example.org/raport.pdf",
      timestamp: "20190101120000",
    });
  });

  it("adres spoza archive.org też nie jest przepisywany na https", () => {
    // Ten sam człon `: url`, ale od strony hosta: warunek sprawdza CAŁY
    // przedrostek `http://web.archive.org/`, a nie sam schemat.
    expect(
      parseWaybackAvailability({
        archived_snapshots: {
          closest: { available: true, url: "http://example.org/kopia.pdf", timestamp: "x" },
        },
      })?.url,
    ).toBe("http://example.org/kopia.pdf");
  });

  it("migawka bez znacznika czasu (lub ze znacznikiem nie-napisem) daje pusty znacznik", () => {
    // Gałąź `: ""`. Adres migawki jest użyteczny sam w sobie (`/web/2/`), więc
    // brak daty NIE może unieważnić całej odpowiedzi - ma tylko wyłączyć
    // wyświetlenie daty w panelu.
    expect(
      parseWaybackAvailability({
        archived_snapshots: {
          closest: { available: true, url: "https://web.archive.org/web/2/https://example.org/" },
        },
      }),
    ).toEqual({ url: "https://web.archive.org/web/2/https://example.org/", timestamp: "" });

    expect(
      parseWaybackAvailability({
        archived_snapshots: {
          closest: {
            available: true,
            url: "https://web.archive.org/web/2/https://example.org/",
            timestamp: 20190101120000,
          },
        },
      })?.timestamp,
    ).toBe("");
  });

  it("brak pola `available` NIE jest traktowany jak odmowa", () => {
    // Odrzucamy wyłącznie jawne `available: false` - starsze odpowiedzi
    // archiwum tego pola nie miały wcale.
    expect(
      parseWaybackAvailability({
        archived_snapshots: {
          closest: { url: "https://web.archive.org/web/2/https://example.org/" },
        },
      })?.url,
    ).toBe("https://web.archive.org/web/2/https://example.org/");
  });
});

describe("waybackTimestampToIso - znacznik 14-cyfrowy, który nie jest datą", () => {
  it("odrzuca znacznik o właściwej DŁUGOŚCI, ale niemożliwej dacie", () => {
    // Gałąź `Number.isNaN(...) ? null`: regex `\d{14}` przepuszcza dowolne
    // czternaście cyfr, więc jedyną barierą przed datą-widmem jest parser Date.
    expect(waybackTimestampToIso("20261345120000")).toBeNull(); // miesiąc 13, dzień 45
    expect(waybackTimestampToIso("00000000000000")).toBeNull(); // same zera
    expect(waybackTimestampToIso("20190101250000")).toBeNull(); // godzina 25
  });

  it("odrzuca wszystko, co nie ma dokładnie czternastu cyfr", () => {
    expect(waybackTimestampToIso("2019010112000")).toBeNull(); // trzynaście
    expect(waybackTimestampToIso("201901011200000")).toBeNull(); // piętnaście
    expect(waybackTimestampToIso("2019-01-01T12:00")).toBeNull();
    expect(waybackTimestampToIso(undefined)).toBeNull();
  });

  it("przyjmuje datę graniczną roku przestępnego", () => {
    expect(waybackTimestampToIso("20200229235959")).toBe("2020-02-29T23:59:59Z");
  });

  // DEFEKT: DATA NIEISTNIEJĄCA W MIESIĄCU WYCHODZI JAKO POPRAWNY ISO.
  //
  // WEJSCIE: `waybackTimestampToIso("20190230120000")` - 30 lutego 2019.
  //   Wayback zwraca takie znaczniki przy uszkodzonych wpisach indeksu CDX.
  // CO PSUJE: funkcja skleja napis `2019-02-30T12:00:00Z` i sprawdza go przez
  //   `new Date(iso)`. Silnik NIE odrzuca tego napisu - normalizuje przepełnienie
  //   dnia i daje 2 marca 2019 (zmierzone: `new Date("2019-02-30T12:00:00Z")`
  //   === 1551528000000). `Number.isNaN` jest więc fałszywe, a funkcja zwraca
  //   `iso` - czyli TEN SAM, nieistniejący napis, którego nie zwalidowała.
  // KONSEKWENCJA: panel monitora linków pokazuje redakcji datę migawki
  //   "30.02.2019", a każdy konsument, który ten napis ponownie sparsuje
  //   (sortowanie migawek, `<time datetime>`, eksport), dostanie cicho 2 marca.
  //   Kontrakt funkcji brzmi "null, gdy to nie jest data" - a to nie jest data.
  // WYMAGANA POPRAWKA: porównać składowe sparsowanej daty z wejściem
  //   (`d.getUTCMonth() + 1 === Number(mo) && d.getUTCDate() === Number(d)`)
  //   i zwrócić `null`, gdy silnik musiał cokolwiek znormalizować.
  it.fails("DEFEKT: 30 lutego NIE może przejść jako poprawny znacznik migawki", () => {
    expect(waybackTimestampToIso("20190230120000")).toBeNull();
    expect(waybackTimestampToIso("20190431120000")).toBeNull(); // 31 kwietnia
  });
});

describe("shouldAlertBrokenLinks - wartości domyślne i stan niespójny", () => {
  const NOW = Date.parse("2026-08-03T12:00:00Z");

  it("honoruje WŁASNY cooldown, krótszy niż domyślne 24 h", () => {
    // Gałąź `input.cooldownMs ?? BROKEN_LINK_ALERT_COOLDOWN_MS`. Bez niej
    // parametr istnieje w typie, ale nie ma dowodu, że cokolwiek robi.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - 1_000).toISOString(),
        cooldownMs: 500,
        now: NOW,
      }),
    ).toBe(true);
    // ...i ten sam stan przy cooldownie dłuższym niż odstęp nadal milczy.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(NOW - 1_000).toISOString(),
        cooldownMs: 5_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("stan NIESPÓJNY (data alertu jest, licznika nie) liczy się jak pierwszy alert", () => {
    // Drugi człon alternatywy `lastNotifiedCount === null`. Taki wiersz powstaje
    // po ręcznej korekcie w bazie albo po migracji dokładającej kolumnę licznika.
    // Alternatywa "cicho nie alarmuj" oznaczałaby monitor, który po migracji
    // milczy na zawsze.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: null,
        lastNotifiedAt: "2026-08-03T11:00:00Z",
        now: NOW,
      }),
    ).toBe(true);
  });

  it("bez podanego `now` liczy czas zegarem systemowym", () => {
    // Gałąź `input.now ?? Date.now()`. Wszystkie pozostałe testy podają `now`
    // jawnie, więc realna ścieżka produkcyjna (brak pola) nie była wykonana.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: null,
        lastNotifiedAt: null,
      }),
    ).toBe(true);
    // Alert sprzed sekundy wciąż jest w domyślnym cooldownie - liczonym od
    // zegara, nie od wartości podanej w wejściu.
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD,
        lastNotifiedAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe(false);
  });

  it("spadek liczby zepsutych linków poniżej progu wycisza alert mimo starego stanu", () => {
    expect(
      shouldAlertBrokenLinks({
        brokenTotal: BROKEN_LINK_ALERT_THRESHOLD - 1,
        lastNotifiedCount: BROKEN_LINK_ALERT_THRESHOLD * 3,
        lastNotifiedAt: new Date(NOW - BROKEN_LINK_ALERT_COOLDOWN_MS * 2).toISOString(),
        now: NOW,
      }),
    ).toBe(false);
  });
});
