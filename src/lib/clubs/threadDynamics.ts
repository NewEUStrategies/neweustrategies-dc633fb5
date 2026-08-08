// Dynamika dyskusji - czyste liczenie, zero React.
//
// Wątek pokazywał do tej pory jedną liczbę ("12 odpowiedzi"). To mówi, ile
// tekstu powstało, ale nie mówi NIC o tym, czy dyskusja żyje, ile osób w niej
// jest i kiedy była gorąca. Te cztery sygnały (tempo, uczestnicy, czas do
// pierwszej reakcji, rozkład w czasie) są liczone tu, żeby dały się przetestować
// bez renderu i żeby widok był tylko ich prezentacją.
//
// Wszystko liczymy z wierszy, które JUŻ mamy w pamięci - żadnego dodatkowego
// zapytania do bazy pod wykres.

export interface ThreadDynamicsReply {
  created_at: string;
  author_id: string | null;
  author_alias?: string | null;
  author_name?: string | null;
}

export interface ThreadDynamicsBucket {
  /** Początek przedziału (ms epoch). */
  start: number;
  /** Liczba odpowiedzi w przedziale. */
  count: number;
}

export interface ThreadDynamics {
  total: number;
  /** Liczba odrębnych głosów; anonimowi liczą się per alias, nie zbiorczo. */
  participants: number;
  buckets: ThreadDynamicsBucket[];
  peak: number;
  /** Minuty od otwarcia wątku do pierwszej odpowiedzi; null gdy brak odpowiedzi. */
  firstReplyMinutes: number | null;
  lastActivityAt: string | null;
  /** Odpowiedzi z ostatnich 24 h - miara "czy to nadal się dzieje". */
  last24h: number;
  /** Mediana przerwy między kolejnymi odpowiedziami (minuty). */
  medianGapMinutes: number | null;
}

/** Liczba słupków wykresu. Stała, żeby wysokość widżetu nie skakała. */
export const DYNAMICS_BUCKETS = 24;

const MINUTE = 60_000;

function authorKey(reply: ThreadDynamicsReply, index: number): string {
  if (reply.author_id !== null && reply.author_id !== "") return `id:${reply.author_id}`;
  if (reply.author_alias !== null && reply.author_alias !== undefined && reply.author_alias !== "")
    return `alias:${reply.author_alias}`;
  if (reply.author_name !== null && reply.author_name !== undefined && reply.author_name !== "")
    return `name:${reply.author_name}`;
  // Wpis bez jakiegokolwiek autorstwa (konto usunięte) liczy się jako osobny
  // głos - scalanie ich w jeden zaniżałoby liczbę uczestników.
  return `anon:${index}`;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : Math.round((((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2) * 10) / 10;
}

export function computeThreadDynamics(
  createdAt: string,
  replies: readonly ThreadDynamicsReply[],
  now: number = Date.now(),
): ThreadDynamics {
  const start = Date.parse(createdAt);
  const stamps = replies
    .map((reply) => Date.parse(reply.created_at))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  const participants = new Set(replies.map((reply, i) => authorKey(reply, i))).size;
  const last = stamps.length > 0 ? (stamps[stamps.length - 1] ?? start) : start;
  const from = Number.isFinite(start) ? start : (stamps[0] ?? now);
  // Okno kończy się na OSTATNIEJ aktywności, nie na "teraz": wątek sprzed roku
  // rysowałby inaczej jeden słupek przy lewej krawędzi i 23 puste.
  const span = Math.max(last - from, MINUTE);
  const step = span / DYNAMICS_BUCKETS;

  const buckets: ThreadDynamicsBucket[] = Array.from({ length: DYNAMICS_BUCKETS }, (_, i) => ({
    start: from + i * step,
    count: 0,
  }));
  for (const stamp of stamps) {
    const index = Math.min(DYNAMICS_BUCKETS - 1, Math.max(0, Math.floor((stamp - from) / step)));
    const bucket = buckets[index];
    if (bucket) bucket.count += 1;
  }

  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) {
    gaps.push(((stamps[i] ?? 0) - (stamps[i - 1] ?? 0)) / MINUTE);
  }

  return {
    total: stamps.length,
    participants,
    buckets,
    peak: buckets.reduce((max, b) => Math.max(max, b.count), 0),
    firstReplyMinutes:
      stamps.length > 0 && Number.isFinite(start)
        ? Math.max(0, Math.round(((stamps[0] ?? start) - start) / MINUTE))
        : null,
    lastActivityAt: stamps.length > 0 ? new Date(last).toISOString() : null,
    last24h: stamps.filter((stamp) => now - stamp <= 24 * 60 * MINUTE).length,
    medianGapMinutes: median(gaps),
  };
}

/** Skrót czasu trwania na potrzeby etykiet: "42 min", "3 h", "5 d". */
export function formatDurationShort(minutes: number | null): string | null {
  if (minutes === null) return null;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / (60 * 24))} d`;
}
