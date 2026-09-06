// Cache-busting + bezpieczne odświeżanie zasobów po deployu.

//
// Problem: po aktualizacji preview/published przeglądarka trzyma poprzednie
// index.html/chunk-e w pamięci. Dynamiczne `import()` do usuniętego pliku
// rzuca ChunkLoadError / "Failed to fetch dynamically imported module" i
// użytkownik widzi pustą stronę lub error boundary.
//
// Strategia:
//   1) Globalny listener na `error` + `unhandledrejection`. Jeśli komunikat
//      wygląda na chunk-load error, wymuszamy JEDNORAZOWY hard reload z
//      parametrem `?_v=<ts>` (sessionStorage-guard chroni przed pętlą,
//      gdyby błąd nie zniknął po reloadzie).
//   2) Polling `/api/public/version` co 5 min (i przy powrocie do
//      widoczności taba). Jeśli wersja się zmieniła, ustawiamy flagę i
//      przy najbliższej nawigacji SPA wykonujemy pełny reload - to jest
//      moment "bezpieczny", bo użytkownik świadomie zmienia widok.
//
// Wszystko jest opt-in i uruchamiane po hydratacji: żadnego wpływu na SSR
// ani na FCP.

/**
 * Ten moduł potrzebuje z routera DOKŁADNIE jednej rzeczy: miękkiego
 * odświeżenia. Parametr zawężony do tej jednej metody (a nie `AnyRouter`) -
 * `AnyRouter` spełnia ten kształt, więc wywołania się nie zmieniają, a moduł
 * daje się przetestować bez stawiania całego routera i bez rzutowań.
 */
export interface SoftRefreshable {
  invalidate: () => unknown;
}

const RELOAD_GUARD_KEY = "__lov_cb_reload";
const RELOAD_GUARD_TTL_MS = 15_000;
const POLL_INTERVAL_MS = 5 * 60_000;

function looksLikeChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    (typeof (err as { message?: unknown }).message === "string" &&
      (err as { message: string }).message) ||
    (typeof err === "string" ? err : "") ||
    (typeof (err as { reason?: { message?: string } }).reason?.message === "string"
      ? (err as { reason: { message: string } }).reason.message
      : "");
  if (!msg) return false;
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg)
  );
}

function safeReloadOnce(reason: string): void {
  try {
    const raw = sessionStorage.getItem(RELOAD_GUARD_KEY);
    const last = raw ? Number(raw) : 0;
    if (Number.isFinite(last) && Date.now() - last < RELOAD_GUARD_TTL_MS) {
      // Już przeładowaliśmy niedawno - błąd jest rzeczywisty, nie stary bundle.
      // Zostawiamy Error Boundary do obsługi.
      return;
    }
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // sessionStorage może być zablokowane (privacy) - jedziemy dalej.
  }
  const url = new URL(window.location.href);
  url.searchParams.set("_v", Date.now().toString(36));
  if (process.env.NODE_ENV !== "production") {
    // Diagnostyka DX - w produkcji cicho.
    console.warn(`[cache-busting] hard reload: ${reason}`);
  }
  window.location.replace(url.toString());
}

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch("/api/public/version", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { v?: unknown };
    return typeof data?.v === "string" ? data.v : null;
  } catch {
    return null;
  }
}

/**
 * Uruchamia obserwatorów cache-busting. Zwraca funkcję czyszczącą.
 * Bezpieczne do wielokrotnego wywołania - kolejne wywołania są no-opem.
 */
let started = false;
export function startCacheBusting(router: SoftRefreshable): () => void {
  if (typeof window === "undefined" || started) return () => {};
  started = true;

  // (1) Chunk-load errors -> hard reload (jednorazowo).
  const onError = (event: ErrorEvent) => {
    if (looksLikeChunkLoadError(event.error ?? event.message)) {
      safeReloadOnce("chunk-load-error");
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (looksLikeChunkLoadError(event.reason)) {
      safeReloadOnce("chunk-load-rejection");
    }
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  // (2) Polling wersji -> MIĘKKIE odświeżenie w tle (router.invalidate).
  // Wcześniej ustawialiśmy flagę i przy najbliższej nawigacji robiliśmy
  // window.location.replace(...) - efekt: header/UI "twardo" mrugały po
  // każdej zmianie tras, bo w preview BUILD_ID zmienia się per-isolate
  // (patrz api/public/version.ts fallback `rt-<Date.now()>`). Teraz nowy
  // build sprząta wyłącznie cache React Query i re-runuje loadery w tle;
  // hard reload zostaje wyłącznie awaryjnie dla chunk-load errors.
  let baseline: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const check = async () => {
    const v = await fetchVersion();
    if (!v) return;
    if (baseline === null) {
      baseline = v;
      return;
    }
    if (v !== baseline) {
      baseline = v;
      if (process.env.NODE_ENV !== "production") {
        console.info(`[cache-busting] new build detected - soft refresh`);
      }
      void router.invalidate();
    }
  };

  // Pierwszy strzał odłożony, żeby nie konkurować z krytycznymi zasobami
  // pierwszej strony.
  const kickoff = window.setTimeout(() => {
    void check();
    timer = setInterval(() => void check(), POLL_INTERVAL_MS);
  }, 8_000);

  const onVisibility = () => {
    if (document.visibilityState === "visible") void check();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("visibilitychange", onVisibility);
    window.clearTimeout(kickoff);
    if (timer) clearInterval(timer);
    started = false;
  };
}
