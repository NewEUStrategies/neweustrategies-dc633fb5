// Czysta logika kalendarza doku: siatka miesiąca i przypisanie wpisów do dni.
// Bez DOM i bez sieci - dzięki temu przesuwanie miesięcy testujemy jednostkowo.
//
// ── DZIEŃ JEST WARSZAWSKI, NIE MASZYNOWY ─────────────────────────────────
// `dayKey` czyta `getFullYear/getMonth/getDate`, czyli strefę MASZYNY. Dla
// wpisów kalendarza to jest właściwe: siatka miesiąca ma odpowiadać temu, co
// czytelnik widzi jako „ten dzień" u siebie, a wpisy są w niej rozmieszczane
// względem tej samej skali. Czym to NIE JEST właściwe, to wskazanie DNIA
// BIEŻĄCEGO i miesiąca startowego - te muszą zgadzać się z resztą serwisu,
// która całą swoją chronologię drukuje w strefie redakcji
// (`SITE_TIME_ZONE`, patrz `lib/i18n/format.ts`). Bez tego czytelnik
// w Nowym Jorku między 18:00 a 24:00 swojego czasu widziałby obwódkę „dziś"
// na dniu, który w każdej dacie na tej samej stronie jest już dniem
// następnym. Dlatego chwila startowa idzie przez `siteDayKey`/`siteMonth`,
// a nie przez goły `new Date()`.
import { SITE_TIME_ZONE } from "@/lib/i18n/format";

export interface CalendarEntry {
  id: string;
  title: string;
  startsAt: string;
  href: string | null;
  kind: "event" | "todo";
}

/**
 * Minimum, którego potrzebuje siatka. Wpis może nieść dowolne dodatkowe pola
 * (np. dwa tytuły przed wyborem języka) - siatka patrzy tylko na chwilę
 * rozpoczęcia, więc jest po niej sparametryzowana. Wcześniej wymagała
 * gotowego `title`, co wymuszało wybór języka JUŻ W ZAPYTANIU i wciągało
 * język do klucza cache.
 */
export interface DatedEntry {
  id: string;
  startsAt: string;
}

export interface CalendarDay<TEntry extends DatedEntry = CalendarEntry> {
  /** Klucz dnia w formacie YYYY-MM-DD (czas lokalny czytelnika). */
  key: string;
  date: Date;
  inMonth: boolean;
  entries: TEntry[];
}

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Klucz dnia BIEŻĄCEGO w strefie serwisu. `en-CA` formatuje jako
 * YYYY-MM-DD, więc wynik jest wprost w formacie `dayKey` - ten sam chwyt,
 * którym `siteYear` liczy rok w stopce.
 *
 * Parametr `nowMs` istnieje po to, żeby test mógł zamrozić chwilę; kod
 * produkcyjny woła bez argumentu.
 */
export function siteDayKey(nowMs: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: SITE_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowMs));
  } catch {
    // GAŁĄŹ RATUNKOWA W UTC, nie w strefie maszyny: degradacja nie może sama
    // wprowadzać rozjazdu, którego ta funkcja ma nie dopuszczać.
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

/** Rok i miesiąc (0-11) chwili bieżącej w strefie serwisu - kursor startowy. */
export function siteMonth(nowMs: number = Date.now()): [number, number] {
  const key = siteDayKey(nowMs);
  const year = Number.parseInt(key.slice(0, 4), 10);
  const month = Number.parseInt(key.slice(5, 7), 10) - 1;
  return [year, month];
}

export function monthRange(year: number, month: number): { from: Date; to: Date } {
  return {
    from: new Date(year, month, 1, 0, 0, 0, 0),
    to: new Date(year, month + 1, 1, 0, 0, 0, 0),
  };
}

/** Siatka 6x7 zaczynająca się od poniedziałku (kalendarz PL i EN-GB). */
export function monthGrid<TEntry extends DatedEntry>(
  year: number,
  month: number,
  entries: readonly TEntry[],
): CalendarDay<TEntry>[] {
  const byDay = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const parsed = new Date(entry.startsAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = dayKey(parsed);
    const list = byDay.get(key);
    if (list) list.push(entry);
    else byDay.set(key, [entry]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }

  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // poniedziałek = 0
  const start = new Date(year, month, 1 - offset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKey(date);
    return {
      key,
      date,
      inMonth: date.getMonth() === month,
      entries: byDay.get(key) ?? [],
    };
  });
}

export function shiftMonth(year: number, month: number, delta: number): [number, number] {
  const date = new Date(year, month + delta, 1);
  return [date.getFullYear(), date.getMonth()];
}
