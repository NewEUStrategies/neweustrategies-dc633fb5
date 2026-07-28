// Czysta logika widgetu event-countdown: rozklad odleglosci czasowej na
// dni/godziny/minuty/sekundy. Zero React/IO - unit-testowalne; komponent
// dostarcza "teraz" (props/interval), wiec logika jest deterministyczna.

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** true, gdy cel jest w przeszlosci (odliczanie zakonczone). */
  done: boolean;
}

/** Parsuje cel odliczania; null dla pustej/nieparsowalnej wartosci. */
export function parseCountdownTarget(targetIso: string): number | null {
  if (!targetIso || !targetIso.trim()) return null;
  const ms = Date.parse(targetIso);
  return Number.isNaN(ms) ? null : ms;
}

/** Rozklad czasu do celu wzgledem `nowMs`. Ujemna odleglosc => done + zera. */
export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const diff = targetMs - nowMs;
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, done: true };
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    done: false,
  };
}

/** "7" -> "07" (stale szerokosci cyfr w kafelkach odliczania). */
export function pad2(value: number): string {
  return String(Math.max(0, Math.trunc(value))).padStart(2, "0");
}

/** Pelne dni do celu (sufit); 0 = dzisiaj/w przeszlosci. Chip "za X dni". */
export function daysUntil(targetMs: number, nowMs: number): number {
  const diff = targetMs - nowMs;
  if (diff <= 0) return 0;
  return Math.ceil(diff / 86_400_000);
}

/** true, gdy start jest w przyszlosci, ale blizej niz `withinHours` godzin.
 *  Steruje badge "Juz wkrotce!" na karcie odliczania. */
export function isStartingSoon(targetMs: number, nowMs: number, withinHours = 24): boolean {
  const diff = targetMs - nowMs;
  return diff > 0 && diff < withinHours * 3_600_000;
}
