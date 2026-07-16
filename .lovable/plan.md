# Przebudowa SSR wrappera

## Cele

1. **Naprawić produkcję** - `neweustrategies.lovable.app` zwraca 500 bo publikacja jest sprzed merge'a PR #31. Fix już jest w `main`, wystarczy Publish.
2. **Uprościć architekturę** - jeden spójny model odpowiedzialności, bez nakładających się mechanizmów.
3. **Zamienić fallback HTML** - obecny "Reloading…" + sessionStorage auto-reload → statyczna strona zgodna z layoutem, i18n PL/EN, bez pętli reloadów.
4. **Zachować pokrycie regresyjne** - wszystkie inwarianty z `server.test.ts` / `start.test.ts` / `error-capture.test.ts` mają być spełnione w nowej architekturze.

## Nowy model - trzy warstwy, jedna odpowiedzialność na warstwę

```text
                        ┌───────────────────────────────────────┐
Request ───────────────►│  src/server.ts  (SSR fetch wrapper)   │
                        │  • lazy import server-entry           │
                        │  • warm route graph przed getEntries  │
                        │  • try/catch + retry transient        │
                        │  • normalize opaque h3 500 → HTML     │
                        └────────────────┬──────────────────────┘
                                         │ evaluates
                                         ▼
                        ┌───────────────────────────────────────┐
                        │  src/start.ts   (request middleware)  │
                        │  • errorMiddleware (strict classifier)│
                        │  • securityHeaders / redirects / lang │
                        └────────────────┬──────────────────────┘
                                         │ records
                                         ▼
                        ┌───────────────────────────────────────┐
                        │  src/lib/ssr-error-capture.ts         │
                        │  • jedno API: record + consume        │
                        │  • globalThis listeners               │
                        │  • BEZ console.error monkey-patch     │
                        └───────────────────────────────────────┘
```

### Co znika (dead code / redundancje)

- **`console.error` monkey-patch** w `error-capture.ts` - zastępuje explicit `recordCapturedError` w `errorMiddleware`; monkey-patch łapie React dev warnings i inne szumy, których nie chcemy jako "captured cause". `errorMiddleware` już wywołuje `recordCapturedError` explicit, więc patch jest redundancją.
- **`__lovableErrorCapturePatched` global guard** - niepotrzebny bez patcha.
- **`sessionStorage` auto-reload pętla** w `error-page.ts` - użytkownicy trafiają na "Reloading…" 3x zanim zobaczą UI, przy deterministycznych błędach to 3× dodatkowe requesty na 500.
- **`isServerEntryCached` test seam** - inwariant "clear cache on failure" testujemy przez efekt (drugi request po failure trafia w handler ponownie), nie przez peek do state'u.
- **Nadmiarowe komentarze bloczkowe** w `server.ts` (opis dlaczego warm-graph istnieje) - przenieś do jednego docblocka na plik + krótkie linijki inline.
- **Podwójny reset cache'a** w `normalizeCatastrophicSsrResponse` (opaque body) i w outer `catch` (throw) - konsolidacja do jednej funkcji `resetEntryState()`.

### Co zostaje (zabezpiecza realne bugi, nie rusz)

- Lazy `import()` server-entry + reset cache po odrzuceniu importu (test: "next request retries").
- Warm-graph loader z retry na transient module-runner errors (test: "surfaces REAL module-init error", "retries a transient module-runner reload").
- Normalizacja opaque h3 500 (test: "replaces the opaque h3 payload").
- Correlation captured error → response body (test: "correlates a globally-captured error").
- `isHttpError` strict classifier `name === "HTTPError" && typeof status === "number"` (test: "rejects postgrest / fetch clients").
- `applySecurityHeaders` rebuild-Response (test: "immutable response").
- `__setRouteGraphLoader` test seam (potrzebny by nie ewaluować pełnego route graph w vitestach).

## Nowy fallback HTML

`src/lib/ssr-error-page.ts` (rename z `error-page.ts`):

- Bilingual PL/EN inline (bez dependency na i18n runtime - fallback musi renderować bez app bundle).
- Zgodny z layoutem: Red Hat Display, brand colors z tokenów (inline w `<style>`, żeby CSS-file failure nie zabił fallbacku).
- **Brak `sessionStorage` auto-reload.** Zamiast tego:
  - Tytuł: "Strona chwilowo niedostępna / Page temporarily unavailable"
  - Krótki opis dwujęzyczny.
  - Przycisk "Odśwież / Refresh" (button z `location.reload()`).
  - Link "Wróć na stronę główną / Back to home" (`/`).
- Meta `robots: noindex, nofollow` żeby crawler nie zaindeksował fallbacku.
- `Cache-Control: no-store` zostaje (już jest w response, nie w HTML).
- Bez zewnętrznych fetchy, bez importów - dependency-free jak wymaga `tanstack-ssr-error-handling`.

## Struktura plików

```text
src/
├─ server.ts                     (przepisany, ~120 linii zamiast 199)
├─ start.ts                      (edytowany: mniej indirekcji w handleMiddlewareError)
├─ lib/
│  ├─ ssr-error-capture.ts       (nowa nazwa, bez monkey-patcha; ~40 linii zamiast 90)
│  ├─ ssr-error-page.ts          (nowa nazwa, i18n PL/EN, bez auto-reload)
│  └─ ...
├─ server.test.ts                (adaptacja - te same inwarianty, nowe importy)
├─ start.test.ts                 (adaptacja - te same inwarianty)
└─ lib/ssr-error-capture.test.ts (adaptacja - usuń test monkey-patcha)
```

Stare pliki `src/lib/error-capture.ts` i `src/lib/error-page.ts` zostają usunięte (`rm`). Referencje w kodzie (`import "./lib/error-capture"`, `import { renderErrorPage } from "./lib/error-page"`, `import { recordCapturedError }`) - update we wszystkich call-site'ach jednym batch'em.

## Kroki

1. Grep wszystkich usage `error-capture` / `error-page` / `renderErrorPage` / `recordCapturedError` / `consumeLastCapturedError` żeby nic nie przeoczyć.
2. Napisać nowe `src/lib/ssr-error-capture.ts` + `src/lib/ssr-error-page.ts`.
3. Przepisać `src/server.ts` (uproszczony, ta sama semantyka + testy przechodzą).
4. Update `src/start.ts` - `handleMiddlewareError` bez zmian API, ale bez odwołań do usuniętych plików.
5. Update testów (`server.test.ts`, `start.test.ts`, `error-capture.test.ts` → `ssr-error-capture.test.ts`).
6. `rm src/lib/error-capture.ts src/lib/error-page.ts src/lib/error-capture.test.ts`.
7. Verify: `bunx tsgo --noEmit`, `bunx vitest run src/server.test.ts src/start.test.ts src/lib/ssr-error-capture.test.ts`.
8. Publish produkcji (`preview_ui--publish`) - fix z PR #31 idzie live razem z refactorem.
9. Post-publish: `curl` na `neweustrategies.lovable.app/` → oczekujemy 200. Jeśli 500 dalej występuje po publikacji → zaciągam server-function-logs, analizuję captured stack i naprawiam konkretną klasę błędu (punkt 4 odpowiedzi).

## Ryzyka i mitygacja

- **"Reload nadal łapie 500"** (opcja 4 z pytania) - dopóki nie zobaczę realnego captured stacku z produkcji po publikacji, nie mogę zgadywać przyczyny. Nowa architektura JUŻ loguje captured cause przez explicit `recordCapturedError` w `errorMiddleware` (ta ścieżka zostaje), więc po publikacji będę mógł to zdiagnozować z `stack_modern--server-function-logs`.
- Usunięcie monkey-patcha `console.error` = tracimy safety-net dla logów h3/React. Kompensacja: `errorMiddleware.recordCapturedError` + `globalThis` listeners pokrywają wszystkie ścieżki, którymi realny błąd może dojść (test: "correlates a globally-captured error" nadal przechodzi).
- Zmiana ścieżek plików = potencjalne złamanie testów w CI. Mitygacja: grep + update wszystkich importów w jednej serii edycji.

## Techniczne szczegóły (do sekcji "advanced")

- `isHttpError` semantyka pozostaje: `name === "HTTPError" && typeof status === "number"`. Bez zmian.
- `applySecurityHeaders` nadal rebuild-Response (nie `.set()` in-place) - to jedyny bezpieczny sposób dla `Response.redirect(...)` z `immutable` header guard w workerd.
- Warm-graph loader domyślnie: `Promise.all([import("./router"), import("./start")])` - `./router` importuje `routeTree.gen` (wszystkie moduły route'ów), `./start` importuje middleware. Test seam `__setRouteGraphLoader` pozwala vitestom podać `() => Promise.resolve({})`.
- Retry transient module-runner detection: match po `error.message.includes` na `"transport was disconnected"`, `"module runner has been closed"`, `"cannot call \"fetchModule\""`. Chodzenie po `.cause` (do 5 poziomów, `Set` guard) - bez zmian.
