// Selektory tekstu powiadomienia - reguła języka i JAWNOŚĆ locale.
//
// PO CO TEN PLIK. `pickTitle`/`pickBody` żyły w dwóch kopiach wewnątrz
// komponentów, obie na zerze pokrycia. Reguła „EN spada na PL" nie miała ani
// jednej asercji, więc odwrócenie preferencji w JEDNEJ kopii nie zapaliłoby
// niczego. `fmtDate`/`relTime` testujemy pod kątem JAWNEGO locale: to nie
// kosmetyka, tylko warunek zgodności SSR z klientem - `toLocaleString()` bez
// locale czyta ustawienia przeglądarki, a wtedy serwer i przeglądarka drukują
// inny tekst i React 19 porzuca całe poddrzewo SSR.
//
// Progi `relTime` asertujemy PRZEZ REFERENCYJNY `Intl.RelativeTimeFormat`,
// a nie przez zaszyty napis: dokładna treść („60 minutes ago") zależy od
// wersji ICU w Node, a testowanym kontraktem jest WYBÓR JEDNOSTKI I WARTOŚCI,
// nie brzmienie ICU.
import { describe, expect, it } from "vitest";
import { formatDateShort } from "@/lib/i18n/format";
import type { AppLang } from "@/lib/i18n/localePath";
import {
  fmtDate,
  pickBody,
  pickTitle,
  relTime,
  type LocalizedNotificationText,
} from "../notificationText";

/** Chwila odniesienia dla `relTime` - JAWNA, więc zegar zostaje nietknięty. */
const NOW_MS = Date.parse("2026-03-14T12:00:00.000Z");

/** ISO odległe o `seconds` od chwili odniesienia (ujemne = przeszłość). */
function isoAt(seconds: number): string {
  return new Date(NOW_MS + seconds * 1000).toISOString();
}

/** Wzorzec wyniku dla danej jednostki - ta sama biblioteka, co w produkcji. */
function expectedRel(value: number, unit: Intl.RelativeTimeFormatUnit, lang: AppLang): string {
  return new Intl.RelativeTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {
    numeric: "auto",
  }).format(value, unit);
}

/** Minimalny wiersz tekstu - selektory nie potrzebują tenanta ani znaczników. */
function textRow(over: Partial<LocalizedNotificationText> = {}): LocalizedNotificationText {
  return { title_pl: "Nowa wiadomość", ...over };
}

describe("pickTitle", () => {
  it("EN bierze `title_en`, gdy jest", () => {
    expect(pickTitle(textRow({ title_en: "New message" }), "en")).toBe("New message");
  });

  it("EN spada na `title_pl`, gdy `title_en` jest null", () => {
    // Kolumna `title_en` jest NULLABLE, a `title_pl` NOT NULL - producent
    // powiadomienia bez tłumaczenia to normalna ścieżka, nie skrajność.
    expect(pickTitle(textRow({ title_en: null }), "en")).toBe("Nowa wiadomość");
  });

  it("EN spada na `title_pl` także dla PUSTEGO `title_en`", () => {
    // Pusty napis to brak treści, nie treść. Gdyby warunek sprawdzał tylko
    // `!== null`, anglojęzyczny czytelnik dostałby wiersz BEZ tytułu.
    expect(pickTitle(textRow({ title_en: "" }), "en")).toBe("Nowa wiadomość");
  });

  it("EN spada na `title_pl`, gdy pola `title_en` w ogóle nie ma", () => {
    expect(pickTitle(textRow(), "en")).toBe("Nowa wiadomość");
  });

  it("PL bierze `title_pl` NAWET wtedy, gdy istnieje `title_en`", () => {
    // Kierunek jest jednostronny: EN spada na PL, PL nigdy nie spada na EN.
    expect(pickTitle(textRow({ title_en: "New message" }), "pl")).toBe("Nowa wiadomość");
  });
});

describe("pickBody", () => {
  it("EN preferuje `body_en`", () => {
    expect(pickBody(textRow({ body_en: "Body EN", body_pl: "Treść PL" }), "en")).toBe("Body EN");
  });

  it("EN spada na `body_pl`, gdy `body_en` jest null", () => {
    expect(pickBody(textRow({ body_en: null, body_pl: "Treść PL" }), "en")).toBe("Treść PL");
  });

  it("PL preferuje `body_pl`", () => {
    expect(pickBody(textRow({ body_en: "Body EN", body_pl: "Treść PL" }), "pl")).toBe("Treść PL");
  });

  it("PL spada na `body_en`, gdy `body_pl` jest null", () => {
    // Symetria odwrotna: to gałąź dla powiadomień produkowanych wyłącznie po
    // angielsku (integracje), które i tak trzeba pokazać polskiemu odbiorcy.
    expect(pickBody(textRow({ body_en: "Body EN", body_pl: null }), "pl")).toBe("Body EN");
  });

  it("zwraca null (nie pusty napis, nie undefined), gdy nie ma ŻADNEJ treści", () => {
    // Wywołujący renderuje akapit tylko dla wartości nie-null; `undefined`
    // zamiast `null` psułoby `body !== null` po stronie komponentu.
    const empty = pickBody(textRow({ body_en: null, body_pl: null }), "en");
    expect(empty).toBeNull();
    expect(pickBody(textRow(), "pl")).toBeNull();
    expect(pickBody(textRow(), "en")).toBeNull();
  });

  it("PUSTY `body_en` NIE spada na PL - `??` przepuszcza pusty napis", () => {
    // Zachowanie FAKTYCZNE, przypięte świadomie: `pickBody` używa `??`
    // (tylko null/undefined), a bliźniaczy `pickTitle` używa truthiness, więc
    // pusty napis rozstrzyga się w tych dwóch funkcjach INACZEJ. Ten test
    // istnieje po to, żeby ewentualne ujednolicenie było decyzją widoczną
    // w diffie, a nie cichą zmianą zachowania.
    expect(pickBody(textRow({ body_en: "", body_pl: "Treść PL" }), "en")).toBe("");
  });
});

describe("fmtDate", () => {
  const ISO = "2026-03-14T09:05:00.000Z";

  it("daje RÓŻNY wynik dla `pl` i `en` - dowód, że locale jest JAWNE", () => {
    // Gdyby funkcja wołała `toLocaleString()` bez locale, oba wywołania
    // przeczytałyby ustawienia maszyny i zwróciły IDENTYCZNY napis. Różnica
    // jest jedynym dowodem, że parametr języka w ogóle dociera do ICU.
    expect(fmtDate(ISO, "pl")).not.toBe(fmtDate(ISO, "en"));
  });

  it("zawiera rok i godzinę w obu językach", () => {
    // Nie asertujemy dokładnego napisu ICU (zależy od wersji Node), tylko
    // KOMPLET składników wynikający z `dateStyle: medium` + `timeStyle: short`.
    for (const lang of ["pl", "en"] as const) {
      const out = fmtDate(ISO, lang);
      expect(out).toContain("2026");
      expect(out).toMatch(/\d{1,2}:\d{2}/);
    }
  });

  it("nieznany język traktuje jak polski (jedyne dwa locale interfejsu)", () => {
    expect(fmtDate(ISO, "pl")).toBe(
      new Date(ISO).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" }),
    );
  });
});

describe("relTime - progi jednostek", () => {
  it("59 sekund w przeszłości to jeszcze SEKUNDY", () => {
    expect(relTime(isoAt(-59), "en", NOW_MS)).toBe(expectedRel(-59, "second", "en"));
  });

  it("60 sekund w przeszłości przeskakuje na MINUTY", () => {
    // Granica jest ostra (`abs < 60`), więc dokładnie 60 s musi już być
    // minutą - inaczej dzwonek pokazywałby „60 sekund temu".
    expect(relTime(isoAt(-60), "en", NOW_MS)).toBe(expectedRel(-1, "minute", "en"));
  });

  it("3599 sekund to wciąż MINUTY (zaokrąglone do 60)", () => {
    expect(relTime(isoAt(-3599), "en", NOW_MS)).toBe(expectedRel(-60, "minute", "en"));
  });

  it("3600 sekund przeskakuje na GODZINY", () => {
    expect(relTime(isoAt(-3600), "en", NOW_MS)).toBe(expectedRel(-1, "hour", "en"));
  });

  it("86399 sekund to wciąż GODZINY (zaokrąglone do 24)", () => {
    expect(relTime(isoAt(-86399), "en", NOW_MS)).toBe(expectedRel(-24, "hour", "en"));
  });

  it("86400 sekund przeskakuje na DNI", () => {
    expect(relTime(isoAt(-86400), "en", NOW_MS)).toBe(expectedRel(-1, "day", "en"));
  });

  it("604799 sekund to wciąż DNI (zaokrąglone do 7)", () => {
    expect(relTime(isoAt(-604799), "en", NOW_MS)).toBe(expectedRel(-7, "day", "en"));
  });

  it("604800 sekund (tydzień) schodzi na DATĘ KRÓTKĄ, nie na czas względny", () => {
    // Powyżej tygodnia względność przestaje nieść informację. Asercja idzie
    // przez `formatDateShort`, czyli tę samą funkcję, którą kontrakt wskazuje.
    const iso = isoAt(-604800);
    expect(relTime(iso, "en", NOW_MS)).toBe(formatDateShort(iso, "en"));
    expect(relTime(iso, "pl", NOW_MS)).toBe(formatDateShort(iso, "pl"));
  });
});

describe("relTime - przyszłość i język", () => {
  it("obsługuje PRZYSZŁOŚĆ w sekundach", () => {
    // Znacznik z przyszłości nie jest teoretyczny: zegar serwera i klienta
    // rozjeżdżają się o sekundy, więc świeży wiersz bywa „przed teraz".
    expect(relTime(isoAt(30), "en", NOW_MS)).toBe(expectedRel(30, "second", "en"));
  });

  it("obsługuje PRZYSZŁOŚĆ w minutach z zaokrągleniem w górę", () => {
    expect(relTime(isoAt(90), "en", NOW_MS)).toBe(expectedRel(2, "minute", "en"));
  });

  it("obsługuje PRZYSZŁOŚĆ w godzinach i dniach", () => {
    expect(relTime(isoAt(7200), "en", NOW_MS)).toBe(expectedRel(2, "hour", "en"));
    expect(relTime(isoAt(86400), "en", NOW_MS)).toBe(expectedRel(1, "day", "en"));
  });

  it("chwila TERAZ to zero sekund, nie pusty wynik", () => {
    expect(relTime(isoAt(0), "pl", NOW_MS)).toBe(expectedRel(0, "second", "pl"));
  });

  it("daje RÓŻNY wynik dla `pl` i `en` - locale jest JAWNE także tutaj", () => {
    const iso = isoAt(-120);
    expect(relTime(iso, "pl", NOW_MS)).not.toBe(relTime(iso, "en", NOW_MS));
  });

  it("domyślne `nowMs` bierze bieżący czas (brak trzeciego argumentu)", () => {
    // Domyślny parametr jest gałęzią samą w sobie - bez tego wywołania
    // produkcyjne użycie z dwoma argumentami nigdy nie byłoby wykonane.
    expect(relTime(new Date().toISOString(), "en")).toBe(expectedRel(0, "second", "en"));
  });
});
