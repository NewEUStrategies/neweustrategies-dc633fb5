#!/usr/bin/env node
/**
 * Warmer NES Edge Cache - utrzymuje kluczowe dokumenty publiczne w oknie
 * świeżości, żeby realny czytelnik praktycznie nigdy nie płacił pełnego
 * renderu SSR (MISS = sekundy TTFB na zimnej kolonii; HIT/STALE = milisekundy).
 *
 * Mechanika: zwykły anonimowy GET dokumentu.
 *   - HIT: odświeża pozycję LRU wpisu (nic nie kosztuje),
 *   - STALE: serwuje od ręki i uruchamia rewalidację W TLE - wpis wraca do
 *     okna świeżości bez blokowania kogokolwiek,
 *   - MISS (zimna kolonia / po deployu): to WARMER płaci render, nie czytelnik.
 * Tick co ~60 s < okno świeżości (180 s), więc między tickami wpis nie zdąży
 * wypaść ze świeżości; purge przy publikacji działa bez zmian (bump wersji L2).
 *
 * Best-effort z definicji: bez konfiguracji lub przy błędach HTTP kończy się
 * kodem 0 z ostrzeżeniem - warmer nigdy nie może zapalić crona doręczeń.
 *
 * Env:
 *   WARM_BASE_URL      wymagane (np. https://neweuropeanstrategies.com);
 *                      w workflow spada na APP_BASE_URL schedulera
 *   WARM_PATHS         CSV ścieżek (domyślnie kluczowe trasy PL/EN)
 *   WARM_TICKS         liczba ticków w przebiegu (domyślnie 4)
 *   WARM_INTERVAL_MS   odstęp między tickami (domyślnie 60000)
 *   WARM_TIMEOUT_MS    timeout jednego żądania (domyślnie 20000)
 *
 * Bez zależności (czysty Node >= 18) - krok w workflow to jedno `node`.
 */

const env = process.env;

const BASE_URL = (env.WARM_BASE_URL ?? env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
// Kluczowe powierzchnie obu języków: strona główna i archiwum wpisów. Celowo
// krótka lista - każda ścieżka to render przy MISS, a warmer ma być tani.
const PATHS = (env.WARM_PATHS ?? "/,/en,/blog,/en/blog")
  .split(",")
  .map((p) => p.trim())
  .filter((p) => p.startsWith("/"));
const TICKS = clampInt(env.WARM_TICKS, 4, 1, 10);
const INTERVAL_MS = clampInt(env.WARM_INTERVAL_MS, 60_000, 5_000, 600_000);
const TIMEOUT_MS = clampInt(env.WARM_TIMEOUT_MS, 20_000, 5_000, 120_000);

function clampInt(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function warmOne(path) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      // Redirecty nie są dokumentami do grzania (301 na host kanoniczny itp.).
      redirect: "manual",
      headers: {
        accept: "text/html",
        "accept-language": path.startsWith("/en") ? "en" : "pl",
        "user-agent": "NES-EdgeWarmer/1 (+github-actions)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Body trzeba skonsumować: dopiero pełny odczyt domyka strumień renderu
    // po stronie workera (tee odroczonego zapisu czyta drugą gałąź).
    await response.arrayBuffer();
    const edge = response.headers.get("x-nes-cache") ?? "-";
    console.log(`[warm] ${path} -> ${response.status} nes=${edge} ${Date.now() - startedAt}ms`);
  } catch (error) {
    console.warn(`[warm] ${path} nieudane: ${error?.message ?? error}`);
  }
}

async function main() {
  if (!BASE_URL) {
    console.warn("[warm] brak WARM_BASE_URL/APP_BASE_URL - pomijam grzanie cache.");
    return;
  }
  if (PATHS.length === 0) {
    console.warn("[warm] pusta lista ścieżek - nic do grzania.");
    return;
  }
  for (let tick = 1; tick <= TICKS; tick += 1) {
    await Promise.all(PATHS.map((path) => warmOne(path)));
    if (tick < TICKS) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.warn(`[warm] przebieg przerwany: ${error?.message ?? error}`);
    process.exit(0);
  },
);
