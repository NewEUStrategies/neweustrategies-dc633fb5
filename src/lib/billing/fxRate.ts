// Kurs walut EUR/PLN pobierany z API Narodowego Banku Polskiego (tabela A,
// publikowana raz dziennie w dni robocze). Zastępuje wcześniejszy sztywny
// parytet 1 EUR = 2 PLN. Konsumowane sync przez `convertToDisplayCurrency`,
// bo cała powierzchnia billingu (pricing, checkout, coupon audit) jest
// synchroniczna. Trzymamy więc w pamięci modułu ostatnio znaną wartość
// (fallback: ostatnia znana kotwica), a `ensureFxRateLoaded()` odświeża ją
// w tle na kliencie oraz on-demand w server functions billingu, zanim
// jakakolwiek kwota trafi do Stripe.
//
// Retry: 3 próby z wykładniczym backoffem (250 ms / 750 ms / 2 s) - to jedyna
// zewnętrzna zależność runtime, więc krótki, ograniczony retry chroni przed
// pojedynczą klapą sieciową bez blokowania checkoutu na dłużej niż ~3 s.
//
// Źródło: https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json
// (ta sama tabela A NBP, która zasila oficjalne kanały RSS banku).

/** Ostatnia znana kotwica NBP - użyta, dopóki nie zdąży się pierwszy fetch. */
const FALLBACK_EUR_PLN = 4.3257;

/** 6 h - NBP publikuje raz dziennie, ale odświeżamy częściej dla świeżości. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Backoff progression: 250 ms, 750 ms, 2 s (worst-case ~3 s dla checkout). */
const RETRY_DELAYS_MS = [250, 750, 2000] as const;

const NBP_URL = "https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json";

export type FxSource = "nbp" | "fallback" | "override";

export interface FxState {
  eurPln: number;
  effectiveDate: string | null;
  /** Epoch ms ostatniej próby (udanej lub nie). 0 = jeszcze nic. */
  fetchedAt: number;
  /** Epoch ms ostatniego SUKCESU z NBP. 0 = jeszcze nic. */
  lastSuccessAt: number;
  source: FxSource;
  /** Komunikat ostatniego niepowodzenia (null jeśli ostatnia próba OK). */
  lastError: string | null;
  /** Liczba prób wykonanych w ostatniej sekwencji fetch (1..RETRY+1). */
  lastAttempts: number;
  /** true, gdy `eurPln` pochodzi ze świeżego (< TTL) sukcesu NBP. */
  stale: boolean;
}

const state: FxState = {
  eurPln: FALLBACK_EUR_PLN,
  effectiveDate: null,
  fetchedAt: 0,
  lastSuccessAt: 0,
  source: "fallback",
  lastError: null,
  lastAttempts: 0,
  stale: true,
};

let inflight: Promise<number> | null = null;

function isFresh(): boolean {
  return state.source === "nbp" && Date.now() - state.lastSuccessAt < CACHE_TTL_MS;
}

/** Synchroniczne odczytanie aktualnego kursu (fallback jeśli jeszcze nie pobrany). */
export function getEurPlnRate(): number {
  return state.eurPln;
}

/** Migawkowy stan (z aktualną flagą `stale`). Bezpieczny do serializacji do JSON. */
export function getFxState(): Readonly<FxState> {
  return { ...state, stale: !isFresh() };
}

/** Awaryjny setter (testy). */
export function setEurPlnRateForTests(rate: number): void {
  state.eurPln = rate;
  state.effectiveDate = null;
  state.fetchedAt = Date.now();
  state.lastSuccessAt = Date.now();
  state.source = "override";
  state.lastError = null;
  state.lastAttempts = 0;
}

interface NbpRateResponse {
  rates?: { mid?: number; effectiveDate?: string }[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(): Promise<{ mid: number; effectiveDate: string | null }> {
  // 4 s timeout per próba - NBP zwykle odpowiada <300 ms; dłużej == awaria.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(NBP_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
    const json = (await res.json()) as NbpRateResponse;
    const row = json.rates?.[0];
    const mid = typeof row?.mid === "number" ? row.mid : NaN;
    if (!Number.isFinite(mid) || mid <= 0) throw new Error("NBP: invalid mid value");
    return { mid, effectiveDate: row?.effectiveDate ?? null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pobiera kurs z NBP z retry+backoff. Bez `force` respektuje TTL cache i
 * unika duplikatów przez `inflight`. Zwraca AKTUALNIE obowiązujący kurs -
 * także po nieudanej próbie (wtedy ostatni znany / fallback), a diagnostykę
 * (przyczynę) trzyma w `state.lastError`.
 */
export async function ensureFxRateLoaded(force = false): Promise<number> {
  if (!force && isFresh()) return state.eurPln;
  if (inflight) return inflight;
  inflight = (async () => {
    let attempts = 0;
    let lastErr: unknown = null;
    for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) {
      attempts += 1;
      try {
        const { mid, effectiveDate } = await fetchOnce();
        state.eurPln = mid;
        state.effectiveDate = effectiveDate;
        state.fetchedAt = Date.now();
        state.lastSuccessAt = state.fetchedAt;
        state.source = "nbp";
        state.lastError = null;
        state.lastAttempts = attempts;
        return mid;
      } catch (err) {
        lastErr = err;
        if (i < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[i]);
      }
    }
    // Wszystkie próby padły - nie pogarszamy sytuacji, zostaje ostatni kurs.
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    console.warn(`[fxRate] NBP fetch failed after ${attempts} attempts: ${msg}`);
    state.fetchedAt = Date.now();
    state.lastError = msg;
    state.lastAttempts = attempts;
    return state.eurPln;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Ręczne wymuszenie pobrania (admin refresh) - omija TTL. */
export function forceRefreshFxRate(): Promise<number> {
  return ensureFxRateLoaded(true);
}

// Na kliencie warmujemy cache przy pierwszym imporcie modułu (fire and forget).
// Na serwerze polegamy na jawnym `await ensureFxRateLoaded()` w server functions
// billingu - dzięki temu SSR nie blokuje odpowiedzi zewnętrznym fetch'em.
if (typeof window !== "undefined") {
  void ensureFxRateLoaded();
}
