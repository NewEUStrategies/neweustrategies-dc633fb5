// Czysta logika kalendarza doku: siatka miesiąca i przypisanie wpisów do dni.
// Bez DOM i bez sieci - dzięki temu przesuwanie miesięcy testujemy jednostkowo.

export interface CalendarEntry {
  id: string;
  title: string;
  startsAt: string;
  href: string | null;
  kind: "event" | "todo";
}

export interface CalendarDay {
  /** Klucz dnia w formacie YYYY-MM-DD (czas lokalny). */
  key: string;
  date: Date;
  inMonth: boolean;
  entries: CalendarEntry[];
}

export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthRange(year: number, month: number): { from: Date; to: Date } {
  return { from: new Date(year, month, 1, 0, 0, 0, 0), to: new Date(year, month + 1, 1, 0, 0, 0, 0) };
}

/** Siatka 6x7 zaczynająca się od poniedziałku (kalendarz PL i EN-GB). */
export function monthGrid(
  year: number,
  month: number,
  entries: readonly CalendarEntry[],
): CalendarDay[] {
  const byDay = new Map<string, CalendarEntry[]>();
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
