# Plan: naprawa SSR 500 na `/` (preview)

## Stan faktyczny

- Preview zwraca 500 na `/` — logi pokazują wyłącznie „h3 swallowed SSR error: {status:500, unhandled:true, message:'HTTPError'}"; oryginalny stack **nie dociera** do logów.
- Lokalny build (`http://localhost:8080/`) SSR-uje poprawnie (HTTP 200), więc kod się kompiluje i uruchamia w Node; awaria występuje tylko w runtime workerd (Cloudflare) preview.
- Ustalony wspólny punkt dla `/`, `/robots.txt` i `/api/public/*`: `securityHeadersMiddleware` modyfikował `response.headers` in-place. Odpowiedzi zwracane przez runtime Worker mogą mieć Web Platform header guard `immutable`; `.set()` rzuca wtedy już po poprawnej obsłudze trasy, a h3 zamienia wyjątek na ogólny HTTPError 500. Middleware przebudowuje teraz `Response` z własną kopią `Headers`, zachowując streaming body, status i istniejące nagłówki.
- Właściwa produkcyjna przyczyna modułowa: top-level `vite.build.rollupOptions.output.manualChunks` był współdzielony przez build przeglądarki i serwera. Rozcinał entry Workera na ręczne chunki vendorów, których wdrożony runtime nie mógł rozwiązać przy inicjalizacji. Usunięto globalny `manualChunks`; bezpieczny route splitting TanStack i domyślne dzielenie klienta pozostają aktywne.
- W projekcie jest już warstwa fallbacku (`src/server.ts` + `src/lib/error-capture.ts` + `errorMiddleware` w `src/start.ts`), ale w tym przypadku `consumeLastCapturedError()` nie zwraca nic — czyli błąd leci ścieżką, której obecne przechwyty nie widzą (najpewniej: rzucany podczas **streamowania** ciała odpowiedzi Reacta, już PO tym jak middleware zwróci `Response`, albo w wewnętrznym module h3/TanStack, gdzie throw nigdy nie trafia do `catch` w `errorMiddleware`).

Bez oryginalnego stack trace zgadywanie „co się psuje" to loteria. Krok 1 planu = zmusić serwer, żeby zawsze logował realny błąd.

## Zakres zmian

### 1. Twarde przechwytywanie błędów SSR

Cel: każdy 500 w preview MUSI zostawić stack w Server Logs.

- `src/lib/error-capture.ts` — obok `addEventListener` dopisać hook na `unhandledrejection` / `error` przez `globalThis.process?.on?.("unhandledRejection", ...)` (jeżeli dostępne) oraz zapewnić, że pojedynczy `recordCapturedError` zapisuje pełny `Error` (z `cause` i `stack`), nie tylko `.message`.
- `src/start.ts`:
  - w `securityHeadersMiddleware` i `redirectMiddleware` obłożyć `await next()` w `try/catch` który woła `recordCapturedError(err)` i **rzuca dalej** (żeby `errorMiddleware` mógł zwrócić fallback). Obecnie tylko `errorMiddleware` łapie, ale jeśli h3 opakuje throw wcześniej, kolejność middleware ma znaczenie — `errorMiddleware` idzie pierwszy w tablicy, więc wykonuje się jako najbardziej zewnętrzny; to poprawne, ale dodajemy defensywne logowanie w środku, żeby zobaczyć, który middleware jest źródłem.
- `src/server.ts` — w `normalizeCatastrophicSsrResponse`, gdy `consumeLastCapturedError()` zwraca `undefined`, wypisać jawnie: `console.error("[ssr-fallback] h3 swallowed error but no captured cause; response body:", body)` z pełnymi nagłówkami żądania (URL, path) — na dziś ta gałąź loguje wyłącznie generyczny string, co widzimy w logach.
- Zarejestrować w `src/server.ts` handler `error` na `globalThis` jeszcze przed pierwszym `import()` server-entry — moduł `error-capture` już to robi, upewnić się, że jest ładowany jako pierwszy (jest — `import "./lib/error-capture"` w linii 1) i nie jest zTree-shake'owany.

### 2. Runtime probe błędów renderowania Reacta

Cel: błąd rzucony w komponencie root/route na `/` musi zostać zalogowany.

- W `src/routes/__root.tsx` (`errorComponent`) na samym początku wywołać `console.error(error)` z pełnym `error.stack` **przed** `reportLovableError` (już powinno tam być — zweryfikować podczas implementacji; jeśli nie, dodać).
- W `router.tsx` sprawdzić / dodać `defaultErrorComponent` który loguje `error` do `console.error` — TanStack po rzucie w loaderze woła to zamiast strony (`tanstack-errors-notfound`).

### 3. Zdiagnozowanie realnej przyczyny

Po zmianach z pkt. 1–2:

- Zdeployować preview (automatyczny redeploy po commicie).
- Odpytać `/` przez `stack_modern--invoke-server-function`.
- Odczytać nowe logi (`server-function-logs deployment=preview`) — teraz powinny zawierać konkretny stack (np. „Cannot read properties of undefined" z pliku/linii, albo import ładujący coś Node-only na workerdzie).
- Na podstawie stack trace naprawić konkretny plik. Kandydaci wynikające z ostatnich commitów (tabs / icon picker):
  - `SectionTabsBar.tsx` (linia 137, `tabs.fontSize`) — używany także w publicznym `BuilderRenderer`; jeśli któraś sekcja ma `tabs: undefined` a kod jej używa, dostaniemy TypeError. Zabezpieczyć `tabs` guarded shape.
  - `LucideIconPicker.tsx` — `import * as LucideIcons from "lucide-react"` na poziomie modułu; przy nowej liście ikon lucide-react mogło wprowadzić eksport, którego workerd nie lubi. Jeśli okaże się to źródłem, przenieść skan ikon do lazy path (`useMemo` w komponencie po hydratacji lub `import()` on-demand). Plik jest admin-only, ale jeśli jest w wspólnym barrel'u, może być pull-in do bundle SSR — zweryfikować `rg` na importach.

### 4. Naprawa właściwa

Zależnie od tego, co pokaże stack z pkt. 3:

- Jeżeli winowajcą jest render publiczny (`SectionTabsBar` / `BuilderRenderer` / dane sekcji z DB), dodać defensywne guardy dla `tabs.fontSize` / `tabs.items` (nullish + typ) i test snapshotowy pod SSR.
- Jeżeli winowajcą jest moduł na ścieżce klienckiej, który podciąga coś Node-only na workerdzie — wykonać jeden z fixów z knowledge `tanstack-supabase-import-graph` / `server-runtime` (rename na `*.server.ts`, lazy `await import(...)` wewnątrz handlera, albo `createIsomorphicFn`).
- Zwalidować `/` w preview → HTTP 200 + brak wpisów `dwl.proxy.response.error` w logach.

## Weryfikacja

- `bunx tsgo --noEmit` = 0 błędów (jest OK już teraz).
- `curl -s -o /dev/null -w '%{http_code}' https://id-preview--59b9e533-….lovable.app/` → 200.
- `stack_modern--server-function-logs deployment=preview search=Error` → brak nowych „h3 swallowed" w ciągu 10 min.
- Ręcznie odwiedzić `/` i kilka podstron (`/blog`, `/experts`, `/post/<slug>`) — brak fallbacku „Reloading…".
- `errorComponent` w `__root.tsx` nadal działa (celowo rzucić błąd w loaderze dev-only, żeby zweryfikować, że log zawiera stack).

## Ryzyka

- Zmiany w `error-capture.ts` / `server.ts` dotyczą warstwy SSR — jeśli źle je zbudujemy, cały serwis zwróci 500. Mitigacja: `src/lib/error-page.ts` pozostaje dependency-free (fallback zawsze dostarczalny), a testy `src/server.test.ts` / `src/start.test.ts` muszą przejść przed publikacją.
- Naprawa realnej przyczyny (pkt. 4) jest ślepa aż do momentu, w którym pkt. 1–2 dostarczą stack; plan zakłada iterację (deploy → log → fix), a nie „napisz i licz na szczęście".
