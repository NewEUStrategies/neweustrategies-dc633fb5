// CZAS W KALENDARZU DOKU: dzień „dziś" i miesiąc startowy NIE ZALEŻĄ od
// strefy maszyny czytelnika.
//
// ── CO TU JEST DOWODZONE I DLACZEGO PRZEZ DWIE STREFY ────────────────────
// Panel czytał `new Date()` i formatował miesiąc gołym
// `new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", {...})`, czyli
// bez `timeZone`. Skutek nie jest teoretyczny: dla czytelnika spoza CET/CEST
// obwódka „dziś" siadała na dniu, który w KAŻDEJ innej dacie na tej samej
// stronie był już dniem następnym (serwis drukuje chronologię w strefie
// redakcji, `SITE_TIME_ZONE`). W oknie 22:00-24:00 UTC to po prostu dwie
// różne daty na jednym ekranie.
//
// Test wywołuje więc funkcje DWA RAZY, pod dwiema strefami procesu, i wymaga
// TEGO SAMEGO wyniku. Do tego stoi tu KONTROLA - `dayKey(new Date(ms))`,
// czyli wariant zależny od strefy - która pod tymi samymi strefami wynik
// ZMIENIA. Bez tej kontroli test przechodziłby też wtedy, gdyby podmiana
// strefy w ogóle nie działała, i nie dowodziłby niczego. Ten sam sposób
// dowodzenia stosuje `ssrRenderSafety.test.tsx` dla `formatDate`.
import { afterEach, describe, expect, it } from "vitest";
import { dayKey, monthGrid, shiftMonth, siteDayKey, siteMonth } from "../calendarGrid";
import { freezeClock } from "@/test/time";

// ZAMROŻENIE ZEGARA. Każda asercja w tym pliku podaje chwilę jawnie
// (`MS_END_OF_SEPTEMBER`), więc „teraz" nie wchodzi do wyniku - ale
// `siteDayKey()` i `siteMonth()` mają domyślny argument `Date.now()`, czyli
// wywołanie bez argumentu zależałoby od dnia przebiegu. Zamrożenie jest
// niezależne od podmiany STREFY (`underTimeZone` rusza `process.env.TZ`,
// a nie chwilę), więc kontrola wrażliwości na strefę - `dayKey(new Date(ms))`
// dające RÓŻNE wyniki pod Tokio i Los Angeles - nadal działa; gdyby przestała,
// ten plik oblałby się natychmiast, bo tego właśnie wymaga.
freezeClock();

const ORIGINAL_TZ = process.env.TZ;

/** Uruchamia `fn` pod wskazaną strefą PROCESU. */
function underTimeZone<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

// 30 września 2026, 23:30 UTC. W Warszawie jest już 1 PAŹDZIERNIKA (CEST,
// UTC+2), a w Los Angeles nadal 30 września. Chwila wybrana tak, żeby granica
// dnia I granica miesiąca wypadały w środku tego okna - jeden literał testuje
// oba przejścia naraz.
const MS_END_OF_SEPTEMBER = Date.UTC(2026, 8, 30, 23, 30, 0);

describe("siteDayKey - dzień bieżący w strefie serwisu", () => {
  it("daje TĘ SAMĄ datę pod Tokio i pod Los Angeles", () => {
    const tokyo = underTimeZone("Asia/Tokyo", () => siteDayKey(MS_END_OF_SEPTEMBER));
    const la = underTimeZone("America/Los_Angeles", () => siteDayKey(MS_END_OF_SEPTEMBER));
    expect(tokyo).toBe(la);
  });

  it("tą datą jest dzień WARSZAWSKI, a nie UTC", () => {
    // 23:30 UTC to już 1 października w Warszawie - i to jest data, którą
    // reszta serwisu wydrukuje dla tej samej chwili.
    expect(siteDayKey(MS_END_OF_SEPTEMBER)).toBe("2026-10-01");
  });

  it("KONTROLA: wariant zależny od strefy pod tymi samymi strefami WYNIK ZMIENIA", () => {
    // Bez tej asercji test wyżej przechodziłby także wtedy, gdyby podmiana
    // `process.env.TZ` nie miała żadnego skutku - czyli nie dowodziłby niczego.
    const tokyo = underTimeZone("Asia/Tokyo", () => dayKey(new Date(MS_END_OF_SEPTEMBER)));
    const la = underTimeZone("America/Los_Angeles", () => dayKey(new Date(MS_END_OF_SEPTEMBER)));
    expect(tokyo).not.toBe(la);
  });

  it("format jest dokładnie taki, jaki produkuje `dayKey` - inaczej porównanie kluczy milczy", () => {
    // `siteDayKey` porównuje się WPROST z `day.key` z siatki. Gdyby formaty
    // się rozjechały (np. „1.10.2026"), obwódka „dziś" po prostu nigdy by nie
    // trafiła - bez błędu i bez ostrzeżenia.
    expect(siteDayKey(MS_END_OF_SEPTEMBER)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("siteMonth - kursor startowy kalendarza", () => {
  it("daje TEN SAM miesiąc pod dwiema strefami", () => {
    const tokyo = underTimeZone("Asia/Tokyo", () => siteMonth(MS_END_OF_SEPTEMBER));
    const la = underTimeZone("America/Los_Angeles", () => siteMonth(MS_END_OF_SEPTEMBER));
    expect(tokyo).toEqual(la);
  });

  it("miesiąc jest zerowy (0-11), zgodnie z `monthGrid` i `shiftMonth`", () => {
    // Październik = 9. Pomyłka o jeden dałaby kalendarz otwarty na złym
    // miesiącu przy poprawnie wyglądającym kodzie.
    expect(siteMonth(MS_END_OF_SEPTEMBER)).toEqual([2026, 9]);
  });

  it("składa się z `siteDayKey`, więc obie funkcje nie mogą się rozjechać", () => {
    const key = siteDayKey(MS_END_OF_SEPTEMBER);
    const [year, month] = siteMonth(MS_END_OF_SEPTEMBER);
    expect(year).toBe(Number.parseInt(key.slice(0, 4), 10));
    expect(month).toBe(Number.parseInt(key.slice(5, 7), 10) - 1);
  });

  it("wynik jest przyjmowany przez `shiftMonth` bez korekty", () => {
    const [year, month] = siteMonth(MS_END_OF_SEPTEMBER);
    expect(shiftMonth(year, month, 1)).toEqual([2026, 10]);
    expect(shiftMonth(year, month, -1)).toEqual([2026, 8]);
    // Przejście przez granicę roku - typowe miejsce na błąd o jeden.
    expect(shiftMonth(2026, 11, 1)).toEqual([2027, 0]);
    expect(shiftMonth(2026, 0, -1)).toEqual([2025, 11]);
  });
});

describe("monthGrid jest sparametryzowany kształtem wpisu", () => {
  it("przyjmuje wpis BEZ gotowego `title` - to zdjęło język z klucza cache", () => {
    // Siatka patrzy tylko na `startsAt`, więc wymaganie `title` zmuszało
    // warstwę danych do wyboru języka JUŻ W ZAPYTANIU, a to wciągało `lang`
    // do klucza React Query i kazało pobierać te same wiersze od nowa przy
    // każdym przełączeniu PL/EN.
    const entries = [
      { id: "e1", startsAt: "2026-10-05T09:00:00Z", titlePl: "Wpis", titleEn: "Entry" },
      { id: "e2", startsAt: "2026-10-05T07:00:00Z", titlePl: "Drugi", titleEn: "Second" },
    ];
    const grid = monthGrid(2026, 9, entries);
    const day = grid.find((cell) => cell.key === "2026-10-05");
    expect(day?.entries).toHaveLength(2);
    // Sortowanie w obrębie dnia zostaje - wcześniejsza godzina pierwsza.
    expect(day?.entries.map((entry) => entry.id)).toEqual(["e2", "e1"]);
    // Dodatkowe pola PRZECHODZĄ, a nie są obcinane do interfejsu siatki.
    expect(day?.entries[0]?.titleEn).toBe("Second");
  });

  it("nadal zwraca pełne 42 komórki i oznacza dni spoza miesiąca", () => {
    const grid = monthGrid(2026, 9, []);
    expect(grid).toHaveLength(42);
    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31);
    // Pierwsza komórka to poniedziałek - kalendarz PL i EN-GB.
    expect(grid[0]?.date.getDay()).toBe(1);
  });

  it("wpis z nieparsowalną datą jest POMIJANY, a nie wywala siatki", () => {
    const grid = monthGrid(2026, 9, [
      { id: "bad", startsAt: "nie data" },
      { id: "good", startsAt: "2026-10-07T10:00:00Z" },
    ]);
    const all = grid.flatMap((cell) => cell.entries.map((entry) => entry.id));
    expect(all).toEqual(["good"]);
  });
});
