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
//      parametrem `?_v=<ts36>`. Strażnik (niżej) chroni przed pętlą, gdyby
//      błąd nie zniknął po reloadzie.
//   2) Polling `/api/public/version` co 5 min (i przy powrocie do
//      widoczności taba). Jeśli wersja się zmieniła, robimy MIĘKKIE
//      odświeżenie w tle (`router.invalidate`), bez przeładowania strony.
//
// STRAŻNIK PRZEŁADOWANIA jest warstwowy. Reload wstrzymujemy, gdy KTÓRYKOLWIEK
// znacznik jest świeży, czyli wydany 0 <= teraz - ts < 15 s. Znacznik z
// przyszłości, nieczytelny albo starszy nie wstrzymuje niczego, więc
// udostępniony, zakładkowy czy przestawiony zegarem `_v` nigdy nie blokuje
// odzysku na stałe.
//   a) Zatrzask w pamięci modułu: drugi błąd w tym samym dokumencie (para
//      `error` + `unhandledrejection`, bufor wczesnych błędów korzenia) nie
//      wydaje drugiego `location.replace`.
//   b) `?_v=<ts36>`, parametr dokładany przez sam reload, czytany z bieżącego
//      adresu ORAZ z adresu, pod którym przeglądarka załadowała dokument
//      (wpis nawigacji w Performance API). Drugi odczyt jest odporny na
//      `history.replaceState` bez `_v` w nowym dokumencie (AutoLoadNextPost,
//      ClubHub, /scanner?t). Router nie jest `search.strict`, a przekierowania
//      serwera zachowują query, więc `_v` przeżywa przeładowanie bez magazynu.
//   c) `sessionStorage["__lov_cb_reload"]`: dotychczasowy strażnik, ten sam
//      klucz, format i TTL. Odczyt i zapis są best-effort. Wyjątek (zablokowane
//      cookies, WebView bez DOM storage, pełna quota, prywatne Safari <= 10,
//      gdzie odczyt działa, a zapis rzuca) oznacza tylko brak tej warstwy, a NIE
//      zgodę na reload. Wcześniej każdy wyjątek magazynu kończył się
//      bezwarunkowym reloadem, więc trwale niedostępny chunk (adblock, CSP,
//      proxy) przeładowywał stronę bez końca.
// Gdy żaden znacznik nie jest świeży, przeładowujemy i zapisujemy wszystkie
// warstwy naraz, więc pierwszy odzysk po deployu działa także bez magazynu.
//
// Czego strażnik NIE chroni:
//   - błędu trwałego, który w nowym dokumencie pojawia się później niż 15 s po
//     reloadzie: przy bardzo wolnym boocie to powolna pętla z okresem > TTL,
//     jak dotąd przy działającym magazynie, a chunk dociągany dopiero po
//     interakcji daje najwyżej jeden reload na interakcję;
//   - przekierowania 3xx, które zdejmuje `_v` (np. reguła brzegowa), przy
//     zablokowanym magazynie. `window.name` tego nie ratuje: odpowiedź 3xx
//     bez nagłówka COOP przełącza w Chromium grupę kontekstów przeglądania
//     i zeruje nazwę okna (sprawdzone w Playwright; nasz własny 302 `/` ->
//     `/en` też nie ma COOP), dlatego tej warstwy nie ma;
//   - niedostępnego chunku samego tego modułu: wtedy nie ma ani pętli, ani
//     odzysku.
// Świeży link z `_v` otwarty w nowej karcie w ciągu 15 s kosztuje jeden
// pominięty odzysk (Error Boundary zamiast reloadu).
//
// Wszystko jest opt-in i uruchamiane po hydratacji: żadnego wpływu na SSR
// ani na FCP. Od P1.3 (TP-4) korzeń importuje ten moduł w punkcie ciszy P0.3
// (`onQuiescent`, klasa `overlays`), a błąd sprzed tego punktu ściąga moduł od
// razu i trafia do `handleChunkLoadFailure` - siatka przeładowania po
// chunk-load error działa więc tak wcześnie jak dotąd. Moduł nie dotyka
// `window` ani magazynu przy imporcie (render serwera, czysty chunk).

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

/**
 * Czy błąd wygląda na chunk-load error. Eksport wyłącznie dla testu parytetu:
 * korzeń (`__root.tsx`, `armCacheBusting`) trzyma kopię tych wzorców, bo filtruje
 * wczesne błędy, ZANIM ten moduł się załaduje (P1.3, TP-4).
 */
export function looksLikeChunkLoadError(err: unknown): boolean {
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

/** Czas ze znacznika `_v` (`<ts36>`, format z `safeReloadOnce`); inaczej NaN. */
function markTime(href: string): number {
  const raw = new URL(href).searchParams.get("_v");
  return raw && /^[0-9a-z]{1,11}$/.test(raw) ? parseInt(raw, 36) : NaN;
}

/** Świeży = wydany 0..TTL ms temu. NaN i znacznik z przyszłości nie są świeże. */
function isFresh(t: number, now: number): boolean {
  return now - t >= 0 && now - t < RELOAD_GUARD_TTL_MS;
}

/** Reload wydany przez ten dokument (warstwa a). */
let lastReload = NaN;

/** `_v` z adresu, pod którym załadowano dokument (warstwa b, poza historią). */
function loadedMark(): number {
  try {
    const entry = performance.getEntriesByType("navigation")[0];
    return entry ? markTime(entry.name) : NaN;
  } catch {
    return NaN;
  }
}

function safeReloadOnce(reason: string): void {
  const now = Date.now();
  const href = window.location.href;
  // Już przeładowaliśmy niedawno - błąd jest rzeczywisty, nie stary bundle.
  // Zostawiamy Error Boundary do obsługi.
  if (isFresh(lastReload, now) || isFresh(markTime(href), now) || isFresh(loadedMark(), now)) {
    return;
  }
  try {
    if (isFresh(Number(sessionStorage.getItem(RELOAD_GUARD_KEY)), now)) return;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
  } catch {
    // Magazyn zablokowany albo pełny: decyzję niesie `_v` w adresie.
  }
  lastReload = now;
  const url = new URL(href);
  url.searchParams.set("_v", now.toString(36));
  if (process.env.NODE_ENV !== "production") {
    // Diagnostyka DX - w produkcji cicho.
    console.warn(`[cache-busting] hard reload: ${reason}`);
  }
  window.location.replace(url.toString());
}

/**
 * Błąd złapany PRZED startem modułu (korzeń buforuje `error`/`unhandledrejection`
 * do importu w punkcie ciszy, patrz `__root.tsx`). Ta sama reguła co nasłuch
 * z `startCacheBusting`: chunk-load error -> jednorazowy twardy reload, każdy
 * inny błąd - nic.
 */
export function handleChunkLoadFailure(reason: unknown): void {
  if (typeof window === "undefined") return;
  if (looksLikeChunkLoadError(reason)) safeReloadOnce("chunk-load-early");
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
