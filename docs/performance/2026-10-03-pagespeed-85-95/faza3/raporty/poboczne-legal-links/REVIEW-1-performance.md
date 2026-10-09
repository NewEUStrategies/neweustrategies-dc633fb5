# Recenzja 1: wydajność i bezpieczeństwo SSR. Zadanie „Podłącz pasek linków prawnych (CopyrightBar)”

Werdykt: **approve**. Decyzja `not_performed` jest poprawna. Zmiana nie dotyka kodu, więc nie ma regresji wydajności, SSR ani CLS. Luka zgodności jest jednak prawdziwa. Poniżej wskazówki dla osobnego zadania, bo jedno ustalenie recenzji poprawności wymaga korekty.

## Stan worktree (sprawdzony)

- Worktree: `wt3/chat-toasts`, gałąź `feat/w3-chat-toasts`. HEAD `56da8d23` jest równy `claude/zen-ritchie-hzur21`. `git diff base...HEAD` jest pusty, a commitów nie ma.
- Niezacommitowane zmiany dotyczą toastów czatu: `src/lib/chat/useIncomingChatToasts.ts`, testy oraz `src/components/dock/WorkspaceDock.tsx` z testami. Należą do innego zadania (tego z prośby użytkownika) i nie są tu oceniane. Żadna z nich nie dotyka stopki.
- Prośba użytkownika brzmi „Napraw toasty nowych wiadomości czatu”. CopyrightBar wykracza poza jej zakres, więc pominięcie zadania jest zgodne z tym zakresem.

## Weryfikacja twierdzeń

- `CopyrightBar` nie jest zamontowany. Grep poza testami znajduje tylko definicję (`src/components/footer/CopyrightBar.tsx:11`) i komentarze (`footerNavigation.ts:75`, `siteSettingsLiveSync.tsx:2`, `__root.tsx:707`). `git log -G CopyrightBar` po `Footer.tsx`, `SiteChrome.tsx` i `__root.tsx` nie pokazuje commitu montażu ani demontażu.
- W produkcyjnym HTML `w3/prod/d2.html` (`grep -a`) jest tylko `href="/polityka-prywatnosci"` (1×) i `href="/privacy"` (1×). Brakuje `/regulamin`, `/zwroty-i-reklamacje`, `/cookies` i `/rodo`. Nie ma też etykiety „Informacje prawne”. **Luka potwierdzona.**

## Ustalenia

1. **major (do osobnego zadania): recenzja poprawności błędnie wskazuje punkt montażu.**
   Recenzja poprawności (pkt 2) twierdzi, że montaż wymaga `src/routes/__root.tsx`. Tak nie jest. Stopka montuje się w `src/components/Footer.tsx`, który renderuje `<footer data-site-footer>` (linie 141-156), a tego pliku nie ma na liście zakazanych.
   Prawdziwe ryzyko leży gdzie indziej: łańcuch importów jest statyczny, `__root.tsx:123` → `SiteChrome.tsx:5` → `Footer.tsx`. `Footer.tsx` siedzi więc w domknięciu bootu anonimowej strony głównej. Bezpośredni montaż `<CopyrightBar>` w `Footer.tsx` dokłada do tego domknięcia moduł z komponentem (`footerLinksByGroup`, `labelFor`, gałęzie klas). Dziś z `footerNavigation` jest używane tylko `FOOTER_LINKS`, więc tree-shaking usuwa resztę. Po minifikacji to rząd kilkuset bajtów, więcej niż zapas `bootClosureRawBytes` (~155 B).
   Zmiana w `chromeDefaults.ts` (domyślny dokument stopki) też trafia do domknięcia, bo `Footer.tsx` importuje `defaultDocFor`.
   Poprawka dla przyszłego zadania (kolejność preferencji):
   - (a) Dodać grupę linków prawnych do dokumentu buildera stopki w CMS. To zmiana danych, a nie kodu: renderuje się w SSR przez `BuilderRenderer` wewnątrz `HydrationIsland id="site-footer"`. Daje zero bajtów JS w domknięciu i zero nowych zapytań, bo ustawienia `footer` są już w stanie SSR.
   - (b) Montaż w kodzie wewnątrz wyspy stopki, z kodem komponentu w chunku widgetu ładowanym przez `islandChunksFor`, a nie w `Footer.tsx`. Bramki: `check:entry-purity`, `check-document-weight --json` (raw i gzip domknięcia bez wzrostu) oraz e2e `*.boot-home.spec.ts` sprawdzające obecność hrefów w SSR `/` i `/en` i brak błędu hydratacji.

2. **minor: brak raportu wykonawcy.**
   Pole raportu jest puste, więc decyzja `not_performed` nie ma uzasadnienia na piśmie.
   Poprawka: jedno zdanie: „poza zakresem prośby użytkownika (toasty czatu); luka potwierdzona: w SSR `/` brak `/regulamin`, `/zwroty-i-reklamacje`, `/cookies`, `/rodo`; montaż w `Footer.tsx` przekroczyłby zapas domknięcia bootu, więc zalecana jest zmiana treści stopki CMS”.

3. **minor (dla przyszłej implementacji): CLS, motywy i testy regresji.**
   - CLS: `<footer>` ma `cv-auto` i leży poniżej zgięcia. Pasek wewnątrz `<footer>`, renderowany w SSR, nie da przesunięcia. Pod warunkiem, że nie pojawi się dopiero po hydratacji: zakaz renderu warunkowego od stanu klienta.
   - Motywy: `CopyrightBar` różnicuje motyw tylko tokenami kolorów (`bg-card`/`bg-muted`/`bg-foreground`) przy wspólnej geometrii (`py-3 text-xs`), co jest zgodne z AGENTS.md. Pamiętać o deduplikacji `/polityka-prywatnosci`, który stopka CMS już renderuje.
   - Testy: test, który złapie regresję po odwróceniu zmiany, musi sprawdzać hrefy w surowym HTML serwera (`/` i `/en`), a nie w DOM po hydratacji. Istniejące testy (`Footer.test.tsx`, `footerChrome.test.tsx`) renderują `CopyrightBar` samodzielnie, więc nie wykryją, że nie jest zamontowany.

## Bramki

Nie uruchamiałem eslint, vitest ani builda: w zakresie tego zadania żaden plik się nie zmienił (`git diff base...HEAD` pusty). Weryfikacja: grep, `git log -G`, analiza grafu importów i grep produkcyjnego HTML.
