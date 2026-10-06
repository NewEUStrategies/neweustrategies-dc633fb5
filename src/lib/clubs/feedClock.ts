// Wspólny zegar czasu względnego w strumieniu huba.
//
// PO CO. „Przed chwilą" pod świeżym wpisem ma po kwadransie powiedzieć
// „15 minut temu", a nie zostać „przed chwilą" do przeładowania strony.
// Własny `setInterval` w każdej karcie znaczyłby kilkadziesiąt zegarów na
// jednym ekranie - tu jest JEDEN, uruchamiany przy pierwszej subskrypcji
// i zatrzymywany, gdy znika ostatnia karta.
//
// HYDRACJA. Migawka serwera to `0` - karta renderuje wtedy datę, identyczną
// po obu stronach. Klient przechodzi na czas względny dopiero po hydracji
// (tak działa `useSyncExternalStore` z `getServerSnapshot`).

/** Co ile odświeżamy - czas względny ma rozdzielczość minuty. */
export const CLUB_FEED_CLOCK_TICK_MS = 30_000;

let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

export function subscribeFeedClock(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, CLUB_FEED_CLOCK_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
      now = 0;
    }
  };
}

/** Migawka klienta - stała między tyknięciami, więc React nie renderuje w kółko. */
export function feedClockSnapshot(): number {
  if (now === 0) now = Date.now();
  return now;
}

/** Migawka serwera: brak czasu, karta pokazuje datę. */
export function feedClockServerSnapshot(): number {
  return 0;
}
