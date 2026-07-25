// Kurs walut EUR/PLN pobierany z API Narodowego Banku Polskiego (tabela A,
// publikowana raz dziennie w dni robocze). Zastępuje wcześniejszy sztywny
// parytet 1 EUR = 2 PLN. Konsumowane sync przez `convertToDisplayCurrency`,
// bo cała powierzchnia billingu (pricing, checkout, coupon audit) jest
// synchroniczna. Trzymamy więc w pamięci modułu ostatnio znaną wartość
// (fallback: ostatnia znana kotwica), a `ensureFxRateLoaded()` odświeża ją
// w tle na kliencie oraz on-demand w server functions billingu, zanim
// jakakolwiek kwota trafi do Stripe.
//
// Źródło: https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json
// (ta sama tabela A NBP, która zasila oficjalne kanały RSS banku).

/** Ostatnia znana kotwica NBP - użyta, dopóki nie zdąży się pierwszy fetch. */
const FALLBACK_EUR_PLN = 4.3257;

/** 6 h - NBP publikuje raz dziennie, ale odświeżamy częściej dla świeżości. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface FxState {
  eurPln: number;
  effectiveDate: string | null;
  fetchedAt: number;
  source: "nbp" | "fallback" | "override";
}

const state: FxState = {
  eurPln: FALLBACK_EUR_PLN,
  effectiveDate: null,
  fetchedAt: 0,
  source: "fallback",
};

let inflight: Promise<number> | null = null;

/** Synchroniczne odczytanie aktualnego kursu (fallback jeśli jeszcze nie pobrany). */
export function getEurPlnRate(): number {
  return state.eurPln;
}

export function getFxState(): Readonly<FxState> {
  return state;
}

/** Awaryjny setter (testy). */
export function setEurPlnRateForTests(rate: number): void {
  state.eurPln = rate;
  state.effectiveDate = null;
  state.fetchedAt = Date.now();
  state.source = "override";
}

interface NbpRateResponse {
  rates?: { mid?: number; effectiveDate?: string }[];
}

/** Pobiera kurs z NBP (chyba że świeży w cache). Idempotentne przez inflight. */
export async function ensureFxRateLoaded(force = false): Promise<number> {
  const fresh = Date.now() - state.fetchedAt < CACHE_TTL_MS;
  if (!force && fresh && state.source !== "fallback") return state.eurPln;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(
        "https://api.nbp.pl/api/exchangerates/rates/A/EUR/?format=json",
        { headers: { Accept: "application/json" } },
      );
      if (!res.ok) throw new Error(`NBP HTTP ${res.status}`);
      const json = (await res.json()) as NbpRateResponse;
      const row = json.rates?.[0];
      const mid = typeof row?.mid === "number" ? row.mid : NaN;
      if (!Number.isFinite(mid) || mid <= 0) throw new Error("NBP: invalid mid");
      state.eurPln = mid;
      state.effectiveDate = row?.effectiveDate ?? null;
      state.fetchedAt = Date.now();
      state.source = "nbp";
      return mid;
    } catch (err) {
      // Nie pogarszamy sytuacji - zostawiamy poprzednią (lub fallback) wartość.
      console.warn("[fxRate] NBP fetch failed, using cached/fallback", err);
      state.fetchedAt = Date.now(); // odłóż kolejną próbę o TTL
      return state.eurPln;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

// Na kliencie warmujemy cache przy pierwszym imporcie modułu (fire and forget).
// Na serwerze polegamy na jawnym `await ensureFxRateLoaded()` w server functions
// billingu - dzięki temu SSR nie blokuje odpowiedzi zewnętrznym fetch'em.
if (typeof window !== "undefined") {
  void ensureFxRateLoaded();
}
