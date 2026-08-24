// Czas wydarzenia - JEDNA REGUŁA, cztery miejsca użycia.
//
// CO TEN PLIK DOWODZI.
//   1. GODZINA JEST W STREFIE WYDARZENIA, nie w strefie przeglądarki. To jest
//      cała przyczyna istnienia tego modułu: przed nim tylko jedno z czterech
//      miejsc w repo znało `events.timezone`, a `events.$slug.tsx` doklejało
//      surowy identyfikator IANA obok godziny liczonej lokalnie.
//   2. WARTOŚĆ SPOZA KATALOGU IANA NIE WYWRACA RENDERU. Kolumna jest w bazie
//      `text` bez CHECK-a na listę stref, więc literówka jest osiągalna;
//      `Intl` rzuca wtedy `RangeError`, a biała strona jest gorsza niż godzina
//      w strefie domyślnej.
//   3. NIEPARSOWALNA DATA ZWRACA PUSTY NAPIS, nie „Invalid Date" - wywołujący
//      pokazuje wtedy „bez terminu".
//   4. OSTRZEŻENIE O OBCEJ STREFIE ma warunek, a nie świeci zawsze: uczestnik
//      z tej samej strefy nie ma czego przeliczać.
import { describe, expect, it } from "vitest";
import {
  EVENT_DEFAULT_TZ,
  eventDateBlock,
  eventTimeZone,
  eventTimeZoneLabel,
  formatEventDate,
  formatEventDateTime,
  formatEventTime,
  isForeignTimeZone,
} from "@/lib/events/timezone";

/** 1 lipca 2026, 12:00 UTC - lato, więc Warszawa jest na UTC+2. */
const LATO = "2026-07-01T12:00:00.000Z";
/** 15 stycznia 2026, 12:00 UTC - zima, więc Warszawa jest na UTC+1. */
const ZIMA = "2026-01-15T12:00:00.000Z";

describe("strefa wydarzenia z fallbackiem", () => {
  it("oddaje strefę zapisaną na wydarzeniu", () => {
    expect(eventTimeZone({ timezone: "America/New_York" })).toBe("America/New_York");
  });

  it("pustka, spacje, NULL i brak pola znaczą strefę domyślną", () => {
    expect(eventTimeZone({ timezone: "" })).toBe(EVENT_DEFAULT_TZ);
    expect(eventTimeZone({ timezone: "   " })).toBe(EVENT_DEFAULT_TZ);
    expect(eventTimeZone({ timezone: null })).toBe(EVENT_DEFAULT_TZ);
    expect(eventTimeZone({})).toBe(EVENT_DEFAULT_TZ);
  });
});

describe("godzina liczy się w strefie WYDARZENIA", () => {
  it("ta sama chwila daje różne godziny w różnych strefach", () => {
    const warszawa = formatEventTime(LATO, "Europe/Warsaw", "pl");
    const nowyJork = formatEventTime(LATO, "America/New_York", "pl");
    // 12:00 UTC to 14:00 w Warszawie i 08:00 w Nowym Jorku - gdyby formater
    // ignorował strefę, obie wartości byłyby identyczne.
    expect(warszawa).not.toBe(nowyJork);
    expect(warszawa).toContain("14");
    expect(nowyJork).toContain("08");
  });

  it("respektuje zmianę czasu - lato i zima mają inne przesunięcie", () => {
    expect(formatEventTime(LATO, "Europe/Warsaw", "pl")).toContain("14");
    expect(formatEventTime(ZIMA, "Europe/Warsaw", "pl")).toContain("13");
  });

  it("brak strefy liczy się w strefie domyślnej, a nie w strefie maszyny", () => {
    expect(formatEventTime(LATO, null, "pl")).toBe(formatEventTime(LATO, EVENT_DEFAULT_TZ, "pl"));
  });
});

describe("degradacja zamiast wyjątku", () => {
  it("strefa spoza katalogu IANA nie wywraca formatowania", () => {
    // `Intl` rzuca tu `RangeError`; funkcja musi oddać godzinę, a nie wysypać
    // render całej listy wydarzeń.
    const out = formatEventDateTime(LATO, "Europe/Warszawa-literowka", "pl");
    expect(out).not.toBe("");
    expect(out).toContain("2026");
  });

  it("blok daty degraduje do strefy domyślnej, a nie do strefy maszyny", () => {
    const block = eventDateBlock(LATO, "Nie/Istnieje", "pl");
    expect(block).not.toBeNull();
    expect(block).toEqual(eventDateBlock(LATO, EVENT_DEFAULT_TZ, "pl"));
  });

  // Ten test odwrócił się po recenzji PR 285 i to jest jego SENS. Wcześniej
  // etykieta oddawała nieistniejący identyfikator z bazy, a godzina obok niej
  // liczyła się w strefie maszyny - użytkownik dostawał godzinę serwera opisaną
  // nazwą strefy, której nie ma. Reguła jest teraz jedna: nieznana strefa to
  // strefa domyślna, i tak samo mówi o tym etykieta.
  it("etykieta strefy dla wartości nieznanej mówi o strefie domyślnej", () => {
    expect(eventTimeZoneLabel(LATO, "Nie/Istnieje", "pl")).toBe(
      eventTimeZoneLabel(LATO, EVENT_DEFAULT_TZ, "pl"),
    );
    expect(eventTimeZoneLabel(LATO, "Nie/Istnieje", "pl")).not.toContain("Nie/Istnieje");
  });
});

describe("data nieparsowalna", () => {
  it.each([null, undefined, "", "wczoraj", "2026-13-45T99:99:99Z"])(
    "zwraca pusty napis dla %s",
    (value) => {
      expect(formatEventDateTime(value, "Europe/Warsaw", "pl")).toBe("");
      expect(formatEventDate(value, "Europe/Warsaw", "pl")).toBe("");
      expect(formatEventTime(value, "Europe/Warsaw", "pl")).toBe("");
      expect(eventTimeZoneLabel(value, "Europe/Warsaw", "pl")).toBe("");
    },
  );

  it("blok daty dla nieparsowalnej wartości zwraca NULL, nie pustą parę", () => {
    // `null` znaczy „nie rysuj kafla daty"; para pustych napisów narysowałaby
    // pusty prostokąt.
    expect(eventDateBlock("wczoraj", "Europe/Warsaw", "pl")).toBeNull();
    expect(eventDateBlock(null, "Europe/Warsaw", "pl")).toBeNull();
  });
});

describe("blok daty w strefie wydarzenia", () => {
  it("dzień jest liczony po stronie wydarzenia, nie po stronie UTC", () => {
    // 2026-07-01T23:30Z to jeszcze 1 lipca w Londynie, ale już 2 lipca
    // w Warszawie - i to Warszawa jest strefą tego wydarzenia.
    const block = eventDateBlock("2026-07-01T23:30:00.000Z", "Europe/Warsaw", "pl");
    expect(block?.day).toBe("2");
  });
});

describe("etykieta strefy obok godziny", () => {
  it("oddaje nazwę krótką, a nie identyfikator IANA", () => {
    // „CEST" jest czytelne; „Europe/Warsaw" obok godziny wygląda jak awaria.
    const label = eventTimeZoneLabel(LATO, "Europe/Warsaw", "en");
    expect(label).not.toBe("Europe/Warsaw");
    expect(label.length).toBeLessThanOrEqual(10);
  });
});

describe("ostrzeżenie o obcej strefie", () => {
  it("nie ostrzega uczestnika z tej samej strefy", () => {
    expect(isForeignTimeZone("Europe/Warsaw", "Europe/Warsaw")).toBe(false);
  });

  it("ostrzega uczestnika z innej strefy", () => {
    expect(isForeignTimeZone("Europe/Warsaw", "America/New_York")).toBe(true);
  });

  it("nie ostrzega, gdy strefa widza nie jest znana - szum bez podstawy", () => {
    expect(isForeignTimeZone("Europe/Warsaw", null)).toBe(false);
    expect(isForeignTimeZone("Europe/Warsaw", "")).toBe(false);
  });

  it("brak strefy wydarzenia znaczy strefę domyślną, także w tym porównaniu", () => {
    expect(isForeignTimeZone(null, EVENT_DEFAULT_TZ)).toBe(false);
    expect(isForeignTimeZone(null, "America/New_York")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// STREFA NIEZNANA `Intl`-owi (recenzja PR 285, P2)
//
// `events.timezone` to kolumna `text` bez CHECK-a na listę IANA, więc identyfikator
// spoza katalogu jest osiągalny. Wcześniej gałąź ratunkowa formatowała godzinę
// w strefie MASZYNY, a etykieta zwracała ten nieistniejący identyfikator - wynik
// wyglądał poprawnie i był nieprawdą. Reguła: nieznana strefa degraduje do strefy
// domyślnej serwisu, a etykieta mówi o TEJ strefie.
// ---------------------------------------------------------------------------
describe("timezone - identyfikator spoza katalogu IANA", () => {
  const INVALID = "Europe/Warszawa";
  const MOMENT = "2026-07-15T10:00:00.000Z";

  it("resolves an unknown zone to the service default", () => {
    expect(eventTimeZone({ timezone: INVALID })).toBe(EVENT_DEFAULT_TZ);
    expect(eventTimeZone({ timezone: "  " })).toBe(EVENT_DEFAULT_TZ);
    expect(eventTimeZone({ timezone: "nonsense" })).toBe(EVENT_DEFAULT_TZ);
  });

  it("keeps a valid zone untouched and trims it", () => {
    expect(eventTimeZone({ timezone: "Europe/Brussels" })).toBe("Europe/Brussels");
    expect(eventTimeZone({ timezone: " Europe/Brussels " })).toBe("Europe/Brussels");
  });

  it("formats an unknown zone exactly like the default zone", () => {
    expect(formatEventDateTime(MOMENT, INVALID, "pl")).toBe(
      formatEventDateTime(MOMENT, EVENT_DEFAULT_TZ, "pl"),
    );
  });

  it("labels an unknown zone with the default zone, never with the bad identifier", () => {
    const label = eventTimeZoneLabel(MOMENT, INVALID, "pl");
    expect(label).not.toContain("Warszawa");
    expect(label).toBe(eventTimeZoneLabel(MOMENT, EVENT_DEFAULT_TZ, "pl"));
  });

  it("does not call an unknown zone foreign for a viewer sitting in the default zone", () => {
    expect(isForeignTimeZone(INVALID, EVENT_DEFAULT_TZ)).toBe(false);
    expect(isForeignTimeZone(INVALID, "Europe/Brussels")).toBe(true);
  });
});
