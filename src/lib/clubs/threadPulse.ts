// Dynamika pojedynczego wątku, liczona z wiersza listy.
//
// `club_threads_list` zwraca `hotness`, ale to liczba do SORTOWANIA, nie do
// pokazania - użytkownikowi nic nie mówi "hotness 3.71". Lista pokazywała
// więc trzy surowe liczniki (odpowiedzi, uczestnicy, data) obok siebie, przez
// co wątek z dwunastoma wpisami sprzed roku wyglądał identycznie jak wątek
// z dwunastoma wpisami z dzisiaj.
//
// Tu z tych samych kolumn liczymy dwie rzeczy, które faktycznie zmieniają
// decyzję o kliknięciu: TEMPO (ile odpowiedzi na dobę) i ŚWIEŻOŚĆ (jak dawno
// ktoś się odezwał), i sprowadzamy je do jednego poziomu 0-4.
//
// Zero React - to ma być testowalne bez renderu.
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const THREAD_HEAT_LEVELS = [0, 1, 2, 3, 4] as const;
export type ThreadHeatLevel = (typeof THREAD_HEAT_LEVELS)[number];

/** Stan aktywności wątku - klucz i18n leży w `club.heat.<state>`. */
export type ThreadHeatState = "dormant" | "slow" | "steady" | "active" | "hot";

export interface ThreadPulseInput {
  readonly created_at: string;
  readonly last_reply_at: string | null;
  readonly reply_count: number;
  readonly participant_count: number;
}

export interface ThreadPulse {
  /** Poziom 0-4 do słupków. */
  readonly level: ThreadHeatLevel;
  readonly state: ThreadHeatState;
  /** Odpowiedzi na dobę od założenia wątku (zaokrąglone do 0,1). */
  readonly repliesPerDay: number;
  /** Godziny od ostatniej aktywności; `null`, gdy daty nie da się odczytać. */
  readonly hoursSinceActivity: number | null;
  /** Średnia liczba wpisów na uczestnika - wysoka znaczy monolog. */
  readonly repliesPerParticipant: number;
  /** Rozmowa wielogłosowa (≥3 uczestników i nie monolog). */
  readonly isConversation: boolean;
}

const STATES: readonly ThreadHeatState[] = ["dormant", "slow", "steady", "active", "hot"];

function ageDays(created: number, until: number): number {
  return Math.max(1, (until - created) / DAY);
}

export function computeThreadPulse(
  thread: ThreadPulseInput,
  now: number = Date.now(),
): ThreadPulse {
  const created = Date.parse(thread.created_at);
  const lastRaw = thread.last_reply_at === null ? NaN : Date.parse(thread.last_reply_at);
  const last = Number.isFinite(lastRaw) ? lastRaw : created;

  const replies = Math.max(0, thread.reply_count);
  const participants = Math.max(0, thread.participant_count);

  const perDay = Number.isFinite(created)
    ? Math.round((replies / ageDays(created, Math.max(now, last))) * 10) / 10
    : 0;

  const hoursSinceActivity = Number.isFinite(last)
    ? Math.max(0, Math.round((now - last) / HOUR))
    : null;

  // Tempo daje punkty, cisza je zabiera. Wątek bez ani jednej odpowiedzi nie
  // ma prawa wyjść ponad "uśpiony", nawet jeśli powstał minutę temu - inaczej
  // każdy świeżo założony temat udawałby gorącą dyskusję.
  let score = 0;
  if (perDay >= 0.5) score += 1;
  if (perDay >= 2) score += 1;
  if (perDay >= 6) score += 1;
  if (participants >= 3) score += 1;
  if (hoursSinceActivity !== null) {
    if (hoursSinceActivity <= 24) score += 1;
    else if (hoursSinceActivity > 14 * 24) score -= 1;
    if (hoursSinceActivity > 60 * 24) score -= 1;
  }
  if (replies === 0) score = Math.min(score, 0);

  const level = Math.max(0, Math.min(4, score)) as ThreadHeatLevel;

  return {
    level,
    state: STATES[level] ?? "dormant",
    repliesPerDay: perDay,
    hoursSinceActivity,
    repliesPerParticipant: participants === 0 ? 0 : Math.round((replies / participants) * 10) / 10,
    isConversation: participants >= 3 && replies / Math.max(1, participants) < 6,
  };
}
