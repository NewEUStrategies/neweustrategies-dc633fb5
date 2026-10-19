// `TimeRangeFilter` - daty LOKALNE zakresu własnego (D13).
//
// PO CO OSOBNY PLIK. `timeRangeFilter.test.tsx` przypina instanty
// (`sinceIso`/`untilIso` = lokalne 00:00 i 23:59:59.999) i liczy je tą samą
// arytmetyką lokalną, więc przechodzi w każdej strefie - także wtedy, gdy
// konsument tnie te instanty do dni UTC i gubi dzień. Ten plik stoi w strefie,
// w której lokalna północ NIE jest północą UTC (Europe/Warsaw, w sierpniu
// UTC+2), i pilnuje kontraktu, który tę klasę błędów zamyka: filtr oddaje
// wybrane DNI jako napisy `YYYY-MM-DD`, a okno z tych napisów
// (`resolveCalendarWindow`) pyta GA4 i Postgresa o te same dni, które admin
// kliknął.
//
// Nazwa pliku różni się od istniejącego testu czymś więcej niż wielkością
// liter (`TimeRangeFilter.localDates` vs `timeRangeFilter`) - na systemach
// plików bez rozróżniania wielkości liter dwa pliki o tej samej nazwie
// nadpisałyby się nawzajem.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import "@/test/i18nReal";
import { realT } from "@/test/i18nReal";
import i18n from "@/lib/i18n";
import { resolveCalendarWindow, resolveCustomWindow } from "@/lib/analytics/semantic/window";
import { TimeRangeFilter, buildPresetRange, type TimeRangeValue } from "../TimeRangeFilter";

const ORIGINAL_TZ = process.env.TZ;

/** Środa, 12 sierpnia 2026, 10:30 UTC - jak w teście bazowym filtra. */
const TERAZ = new Date("2026-08-12T10:30:00.000Z");

beforeAll(() => {
  // Strefa PROCESU: `Date` czyta ją przy każdej operacji, więc kalendarz,
  // `date-fns` i konstruktor lokalny liczą w Warszawie.
  process.env.TZ = "Europe/Warsaw";
});

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TERAZ);
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

function klikDzien(numer: number) {
  const komorka = screen.getAllByRole("gridcell", { name: String(numer) })[0];
  fireEvent.click(komorka.querySelector("button") ?? komorka);
}

async function wybierz(od: number, doDnia: number): Promise<TimeRangeValue> {
  const t = realT("pl");
  const onChange = vi.fn();
  render(<TimeRangeFilter value={buildPresetRange("7d")} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.range") }));
  await screen.findByText(t("adminAnalytics.timeRange.pickHint"));
  klikDzien(od);
  klikDzien(doDnia);
  fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }));
  expect(onChange).toHaveBeenCalledTimes(1);
  return onChange.mock.calls[0][0] as TimeRangeValue;
}

describe("TimeRangeFilter - daty lokalne zakresu własnego (TZ=Europe/Warsaw)", () => {
  it("proces naprawdę stoi w strefie, w której północ lokalna nie jest północą UTC", () => {
    // Bez tego warunku reszta pliku przechodziłaby w UTC i niczego nie dowodziła.
    expect(new Date(2026, 7, 3).getTimezoneOffset()).toBe(-120);
  });

  it("wybór 3-9 VIII oddaje daty 2026-08-03 i 2026-08-09, a okno z nich zaczyna GA4 od 3 VIII", async () => {
    const oddane = await wybierz(3, 9);

    expect(oddane.presetId).toBe("custom");
    expect(oddane.fromDate).toBe("2026-08-03");
    expect(oddane.toDate).toBe("2026-08-09");
    // Instant lokalnej północy to 2 VIII w UTC - dlatego daty jadą osobno.
    expect(oddane.sinceIso).toBe("2026-08-02T22:00:00.000Z");

    const okno = resolveCalendarWindow(oddane.fromDate ?? "", oddane.toDate ?? "", TERAZ.getTime());
    expect(okno.ga4.startDate).toBe("2026-08-03");
    expect(okno.ga4.endDate).toBe("2026-08-09");
    expect(okno.days).toBe(7);

    // Kontrola przeciwna: te same instanty tnięte do dni UTC zaczynają dzień wcześniej.
    const przezInstant = resolveCustomWindow(oddane.sinceIso, oddane.untilIso, TERAZ.getTime());
    expect(przezInstant.ga4.startDate).toBe("2026-08-02");
  });

  it("odwrócona kolejność kliknięć daje daty PO uporządkowaniu granic", async () => {
    const oddane = await wybierz(20, 4);
    expect(oddane.fromDate).toBe("2026-08-04");
    expect(oddane.toDate).toBe("2026-08-20");
    expect(oddane.days).toBe(17);
  });

  it("jeden dzień to ta sama data po obu stronach", async () => {
    const t = realT("pl");
    const onChange = vi.fn();
    render(<TimeRangeFilter value={buildPresetRange("7d")} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.range") }));
    await screen.findByText(t("adminAnalytics.timeRange.pickHint"));
    klikDzien(5);
    fireEvent.click(screen.getByRole("button", { name: t("adminAnalytics.timeRange.apply") }));

    const oddane = onChange.mock.calls[0][0] as TimeRangeValue;
    expect(oddane.fromDate).toBe("2026-08-05");
    expect(oddane.toDate).toBe("2026-08-05");
  });

  it("presety kroczące NIE niosą dat kalendarza - nie są wyborem dni", () => {
    const preset = buildPresetRange("7d");
    expect(preset.fromDate).toBeUndefined();
    expect(preset.toDate).toBeUndefined();
  });
});
