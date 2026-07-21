// Czysta agregacja telemetrii błędów przeglądarki (client_errors) dla
// dashboardu w /admin/performance. Bez zależności od Supabase/Reacta -
// testowalna jednostkowo, wołana przez server function po stronie serwera.
//
// Grupowanie: fingerprint z komunikatu po normalizacji zmiennych fragmentów
// (uuid-y, liczby, hashe, adresy) - "Loading chunk 123 failed" i "Loading
// chunk 987 failed" to jeden problem, nie dwa.

export interface ClientErrorSample {
  message: string;
  stack: string | null;
  source: string | null;
  path: string | null;
  created_at: string;
}

export interface ClientErrorGroup {
  /** Znormalizowany komunikat - klucz grupy. */
  fingerprint: string;
  /** Reprezentatywny surowy komunikat (najświeższe wystąpienie). */
  message: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** Źródła zgłoszeń w grupie (onerror / unhandledrejection / boundary). */
  sources: string[];
  /** Najczęstsze ścieżki (max 3) z liczbą wystąpień. */
  topPaths: { path: string; count: number }[];
  /** Stack z najświeższej próbki (jeśli był raportowany). */
  sampleStack: string | null;
}

export interface ClientErrorsDaily {
  /** Dzień w formacie YYYY-MM-DD (UTC). */
  day: string;
  count: number;
}

export interface ClientErrorsReport {
  windowDays: number;
  /** Liczba próbek użytych do agregacji (po ewentualnym cap-ie). */
  total: number;
  /** Prawdziwa liczba wierszy w oknie (COUNT niezależny od cap-u). */
  windowTotal: number;
  capped: boolean;
  uniqueGroups: number;
  affectedPaths: number;
  last24h: number;
  daily: ClientErrorsDaily[];
  groups: ClientErrorGroup[];
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const HEX_RE = /\b[0-9a-f]{8,}\b/gi;
// Każda samodzielna liczba (także 1-cyfrowa): chunk id, licznik, numer linii -
// "Loading chunk 5 failed" i "Loading chunk 42 failed" to ten sam defekt.
const NUMBER_RE = /\b\d+\b/g;
const URL_RE = /https?:\/\/[^\s'")]+/gi;

/**
 * Fingerprint komunikatu: usuwa zmienne fragmenty, żeby wystąpienia tego
 * samego defektu skleiły się w jedną grupę. Kolejność zamian ma znaczenie
 * (uuid przed hex/liczbami, url przed resztą).
 */
export function normalizeErrorMessage(message: string): string {
  return message
    .replace(URL_RE, "<url>")
    .replace(UUID_RE, "<uuid>")
    .replace(HEX_RE, "<hex>")
    .replace(NUMBER_RE, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Klucz dnia (UTC) dla trendu dziennego. */
function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export interface AggregateClientErrorsOptions {
  windowDays: number;
  windowTotal: number;
  capped: boolean;
  /** Punkt odniesienia dla "ostatnie 24 h" (domyślnie teraz). */
  nowMs?: number;
  /** Maksymalna liczba grup w raporcie (reszta i tak jest w total). */
  maxGroups?: number;
}

export function aggregateClientErrors(
  samples: readonly ClientErrorSample[],
  options: AggregateClientErrorsOptions,
): ClientErrorsReport {
  const nowMs = options.nowMs ?? Date.now();
  const dayMs = 86_400_000;
  const maxGroups = options.maxGroups ?? 100;

  interface GroupAccumulator {
    fingerprint: string;
    message: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    sources: Set<string>;
    paths: Map<string, number>;
    sampleStack: string | null;
  }

  const groups = new Map<string, GroupAccumulator>();
  const daily = new Map<string, number>();
  const allPaths = new Set<string>();
  let last24h = 0;

  for (const sample of samples) {
    const fingerprint = normalizeErrorMessage(sample.message);
    const createdMs = new Date(sample.created_at).getTime();
    if (nowMs - createdMs <= dayMs) last24h += 1;

    const day = dayKey(sample.created_at);
    daily.set(day, (daily.get(day) ?? 0) + 1);
    if (sample.path) allPaths.add(sample.path);

    const existing = groups.get(fingerprint);
    if (!existing) {
      groups.set(fingerprint, {
        fingerprint,
        message: sample.message,
        count: 1,
        firstSeen: sample.created_at,
        lastSeen: sample.created_at,
        sources: new Set(sample.source ? [sample.source] : []),
        paths: new Map(sample.path ? [[sample.path, 1]] : []),
        sampleStack: sample.stack,
      });
      continue;
    }
    existing.count += 1;
    if (sample.created_at < existing.firstSeen) existing.firstSeen = sample.created_at;
    if (sample.created_at > existing.lastSeen) {
      existing.lastSeen = sample.created_at;
      existing.message = sample.message;
      if (sample.stack) existing.sampleStack = sample.stack;
    }
    if (sample.source) existing.sources.add(sample.source);
    if (sample.path) existing.paths.set(sample.path, (existing.paths.get(sample.path) ?? 0) + 1);
  }

  const sortedGroups: ClientErrorGroup[] = [...groups.values()]
    .sort((a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1))
    .slice(0, maxGroups)
    .map((g) => ({
      fingerprint: g.fingerprint,
      message: g.message,
      count: g.count,
      firstSeen: g.firstSeen,
      lastSeen: g.lastSeen,
      sources: [...g.sources].sort(),
      topPaths: [...g.paths.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([path, count]) => ({ path, count })),
      sampleStack: g.sampleStack,
    }));

  // Trend dzienny z zerami dla dni bez błędów - wykres bez dziur czyta się
  // uczciwie ("nic się nie działo" vs "brak danych").
  const dailySeries: ClientErrorsDaily[] = [];
  for (let i = options.windowDays - 1; i >= 0; i -= 1) {
    const day = new Date(nowMs - i * dayMs).toISOString().slice(0, 10);
    dailySeries.push({ day, count: daily.get(day) ?? 0 });
  }

  return {
    windowDays: options.windowDays,
    total: samples.length,
    windowTotal: options.windowTotal,
    capped: options.capped,
    uniqueGroups: groups.size,
    affectedPaths: allPaths.size,
    last24h,
    daily: dailySeries,
    groups: sortedGroups,
  };
}
