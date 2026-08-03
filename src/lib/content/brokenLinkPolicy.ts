// Polityka działania monitora linków wychodzących (B7).
//
// PRZYCZYNA: monitor RAPORTOWAŁ zepsute linki, ale nie mówił redakcji, co z nimi
// zrobić, i nie odzywał się sam. Skutek: tabela z narastającą listą 404, którą
// ktoś musi pamiętać, żeby otworzyć. Wiarygodność przypisów w analizach zależy
// od tego, czy ktoś zajrzy do panelu.
//
// Ten moduł dodaje dwie brakujące warstwy - obie CZYSTE, więc testowalne:
//   1. SUGESTIA ZAMIANY: adres w Internet Archive (web.archive.org). Zepsuty
//      przypis prawie nigdy nie wymaga usunięcia - wymaga podmiany na
//      migawkę. Bez tego redaktor i tak ręcznie wkleja URL do Wayback Machine.
//   2. ALERT PROGOWY: decyzja "czy odezwać się do redakcji", z histerezą, żeby
//      nie zamienić alertu w szum (jeden alert na dobę albo gdy problem
//      wyraźnie narósł).

/** Od tylu zepsutych linków w tenancie monitor sam odzywa się do redakcji. */
export const BROKEN_LINK_ALERT_THRESHOLD = 10;

/** Minimalny odstęp między alertami o tym samym stanie (24 h). */
export const BROKEN_LINK_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Adres "znajdź najbliższą migawkę" w Wayback Machine. Działa BEZ odpytywania
 * API (`/web/2/` = przekierowanie na migawkę najbliższą podanej dacie, a bez
 * daty - na najnowszą), więc redakcja ma sensowny link nawet wtedy, gdy
 * odpytanie API się nie udało albo skan jest starszy niż ta funkcja.
 */
export function waybackSearchUrl(url: string): string {
  return `https://web.archive.org/web/2/${url}`;
}

/** Endpoint sprawdzający, czy migawka w ogóle istnieje. */
export function waybackAvailabilityUrl(url: string): string {
  return `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
}

export interface WaybackSnapshot {
  /** Absolutny adres migawki. */
  url: string;
  /** Znacznik czasu Wayback (YYYYMMDDhhmmss). */
  timestamp: string;
}

/**
 * Odpowiedź `archive.org/wayback/available`. Kształt:
 * `{ archived_snapshots: { closest: { available, url, timestamp, status } } }`.
 * Brak migawki to PUSTY obiekt `archived_snapshots`, nie błąd - zwracamy null.
 */
export function parseWaybackAvailability(payload: unknown): WaybackSnapshot | null {
  if (typeof payload !== "object" || payload === null) return null;
  const snapshots = (payload as { archived_snapshots?: unknown }).archived_snapshots;
  if (typeof snapshots !== "object" || snapshots === null) return null;
  const closest = (snapshots as { closest?: unknown }).closest;
  if (typeof closest !== "object" || closest === null) return null;
  const { available, url, timestamp } = closest as {
    available?: unknown;
    url?: unknown;
    timestamp?: unknown;
  };
  if (available === false) return null;
  if (typeof url !== "string" || !url.trim()) return null;
  // Wayback zwraca http:// nawet dla dostępnych migawek https - normalizujemy,
  // żeby panel nie linkował przez przekierowanie z mixed-content ostrzeżeniem.
  const normalized = url.startsWith("http://web.archive.org/")
    ? url.replace("http://", "https://")
    : url;
  return {
    url: normalized,
    timestamp: typeof timestamp === "string" ? timestamp : "",
  };
}

/** Data migawki w formacie czytelnym dla człowieka (z YYYYMMDDhhmmss). */
export function waybackTimestampToIso(timestamp: string | null | undefined): string | null {
  if (!timestamp || !/^\d{14}$/.test(timestamp)) return null;
  const [y, mo, d, h, mi, s] = [
    timestamp.slice(0, 4),
    timestamp.slice(4, 6),
    timestamp.slice(6, 8),
    timestamp.slice(8, 10),
    timestamp.slice(10, 12),
    timestamp.slice(12, 14),
  ];
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export interface BrokenLinkAlertState {
  /** Ile zepsutych linków było przy ostatnim alercie (null = nigdy nie było). */
  lastNotifiedCount: number | null;
  /** Kiedy poszedł ostatni alert (ISO); null = nigdy. */
  lastNotifiedAt: string | null;
}

export interface BrokenLinkAlertInput extends BrokenLinkAlertState {
  /** Aktualna liczba zepsutych linków w tenancie. */
  brokenTotal: number;
  threshold?: number;
  cooldownMs?: number;
  now?: number;
}

/**
 * Czy wysłać alert. Histereza celowo trójwarunkowa:
 *   - poniżej progu nigdy (pojedynczy zgniły link to nie incydent),
 *   - pierwsze przekroczenie progu zawsze,
 *   - potem albo po cooldownie, albo gdy liczba narosła o kolejny pełny próg
 *     (nagła fala - np. padła cała domena źródłowa - nie może czekać dobę).
 * Spadek liczby zepsutych linków NIE generuje alertu; stan i tak zapisujemy,
 * żeby kolejny wzrost liczył się od świeżej bazy.
 */
export function shouldAlertBrokenLinks(input: BrokenLinkAlertInput): boolean {
  const threshold = input.threshold ?? BROKEN_LINK_ALERT_THRESHOLD;
  const cooldownMs = input.cooldownMs ?? BROKEN_LINK_ALERT_COOLDOWN_MS;
  if (input.brokenTotal < threshold) return false;
  if (input.lastNotifiedAt === null || input.lastNotifiedCount === null) return true;

  const last = new Date(input.lastNotifiedAt).getTime();
  if (Number.isNaN(last)) return true;
  const now = input.now ?? Date.now();
  if (now - last >= cooldownMs) return true;
  return input.brokenTotal >= input.lastNotifiedCount + threshold;
}
