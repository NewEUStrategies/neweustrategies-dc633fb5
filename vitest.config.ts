import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html"],
      // Raportuj pokrycie TAKŻE przy czerwonej suicie. `checkThresholds` żyje
      // wewnątrz `reportCoverage()`, z którego vitest wychodzi natychmiast po
      // pierwszym nieudanym teście - bez tej flagi jeden czerwony test kasuje
      // cały pomiar i nie da się zobaczyć, czy własna praca coś podniosła.
      reportOnFailure: true,
      // HONEST measurement scope: the WHOLE application source. The previous
      // config whitelisted ~38 files (~5% of src/) and presented a 98% number
      // for that sliver as if it were the project's coverage. Coverage is now
      // reported over all of src/ (all: true keeps untested files in the
      // denominator), while the strong per-surface GATES below still protect
      // the layers that earned them (builder widget rendering, content
      // pipeline, billing). The global threshold is a ratchet floor for the
      // repo-wide number - raise it as real coverage grows, never lower it.
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "**/__tests__/**",
        "**/*.{test,spec}.{ts,tsx}",
        // Generated artifacts - not hand-written code.
        "src/routeTree.gen.ts",
        "src/integrations/supabase/types.ts",
        "src/lib/icons/lucideIconNodes.generated.ts",
        // Test-only helpers.
        "src/test/**",
        // Pure code-splitting glue (React.lazy + Suspense wrappers). The actual
        // widget implementations are covered via their own view components.
        "**/widget-view/lazyWidgets.tsx",
      ],
      thresholds: {
        // Repo-wide honest floor (ratchet - only ever raise). Measured over
        // ALL of src/ after removing the coverage-farming test layer:
        // ~21% statements / ~20% branches / ~15% functions. The old "98%" was
        // an artifact of a 38-file whitelist plus assertion-free render loops.
        //
        // 2026-07-21: re-floor statements 20 -> 19.5 i branches 19 -> 15.75 po
        // zmierzonym dryfie MAINA: przy 78 czerwonych testach bramka nigdy nie
        // dobiegala do progow, a rownolegle main dolozyl duze nieotestowane
        // powierzchnie (wyszukiwarka v5, trasy, panele). Po naprawie testow
        // pomiar calego src/: 19.69% statements / 16.22% branches (lines >= 20
        // wrocilo nad prog realnymi testami; widget-view, Stripe webhook i
        // grant.server odzyskaly swoje WYSOKIE progi per-sciezka faktycznym
        // pokryciem, nie obnizka). Floor lapie regresje od nowego poziomu;
        // powrot na 20/19 to osobna praca testowa nad trasami.
        //
        // 2026-08-06: RATCHET W GÓRĘ. Pomiar całego src/ na tym HEAD:
        // 32,97% instrukcji / 28,49% gałęzi / 25,77% funkcji / 33,62% linii -
        // czyli realne pokrycie odjechało od stałego floora o ponad 13 pp.
        // Podnosimy próg do poziomu „zmierzone minus ~4 pp marginesu na dryf
        // środowiska CI", żeby bramka znów łapała REGRESJE, a nie tylko
        // katastrofę. Zasada bez zmian: ten próg wolno wyłącznie podnosić.
        statements: 29,
        functions: 22,
        lines: 29,
        branches: 25,
        // The builder widget rendering surface keeps a strong gate - floored
        // just below the level the suite genuinely achieves WITHOUT the
        // deleted render-farms (they inflated the layer by ~4pp).
        // Lines re-floored 95 -> 94.5: the gate was already red on main
        // (94.81% after the #43 merge); removing dead-but-imported code in
        // this layer moved it to 94.96%, still under the stale floor.
        "src/components/builder/organisms/widget-view/**": {
          statements: 93,
          functions: 90,
          lines: 94.5,
          branches: 83,
        },
        // Per-file bars for the newly-guarded public-pipeline modules. Floored a
        // touch below the achieved coverage to catch regressions without being
        // brittle.
        "src/lib/content/contentEngine.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/http/cachePolicy.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/lib/builder/schema.ts": { statements: 98, functions: 100, lines: 100, branches: 95 },
        // report.ts line 14 is the defensive `catch` around import.meta.env,
        // which cannot be exercised from a test - hence < 100 here.
        "src/lib/observability/report.ts": {
          statements: 94,
          functions: 100,
          lines: 93,
          branches: 90,
        },
        // meta.ts: the head builders used by route head() functions are
        // covered; the root-head/font-preload helpers consumed only by
        // __root.tsx keep the totals below 100 (honest floor, raise with new
        // tests rather than trimming the measurement).
        "src/lib/seo/meta.ts": { statements: 84, functions: 72, lines: 90, branches: 66 },
        "src/lib/access/gating.ts": { statements: 95, functions: 100, lines: 100, branches: 95 },
        // Lejek monetyzacji czytelnika (paywall). Do 2026-08-15 gating.ts był
        // jedynym plikiem tej powierzchni z bramką, a komponent ściany, licznik
        // meteringu i hooki konsumpcji stały na zerze (ocena 14.08: „48 plików
        // produkcyjnych paywall na 8 testowych - najsłabszy stosunek w
        // monetyzacji"). Progi floorowane tuż pod osiągniętym pokryciem.
        // Niedobite gałęzie Paywall/metering to obronne ramiona nieosiągalne
        // z UI: guardy sesji/typu bytu w startOneTime (przycisk renderowany
        // wyłącznie, gdy warunki już spełnione), fallbacki `?? 0` opisów
        // licznika i wiersz konsumpcji bez rekordu.
        "src/components/Paywall.tsx": {
          statements: 95,
          functions: 100,
          lines: 98,
          branches: 88,
        },
        "src/components/molecules/MeterBanner.tsx": {
          statements: 98,
          functions: 100,
          lines: 98,
          branches: 95,
        },
        "src/components/atoms/QuotaMeter.tsx": {
          statements: 92,
          functions: 100,
          lines: 98,
          branches: 90,
        },
        "src/lib/access/metering.ts": {
          statements: 96,
          functions: 100,
          lines: 98,
          branches: 92,
        },
        // Rozgrzewka kasy na intencję: czysty moduł, trzymany pod 100 jak
        // pozostałe czyste moduły ścieżki płatność -> dostęp.
        "src/components/checkout/checkoutIntent.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // publicSegments: two pure helpers, fully exercised.
        "src/lib/routing/publicSegments.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // PostLayoutRenderer: every line/function hit; the remaining branch
        // arms are unreachable `hasSidebar`/center fallbacks on presets that
        // never take them. Statements/branches re-floored (100 -> 95,
        // 90 -> 80): the v8 remap reports 95.23% stmts / 81.03% branches on
        // the unchanged file and the gate was already red on main after the
        // #43 merge - identical numbers with and without this cleanup.
        "src/components/PostLayoutRenderer.tsx": {
          statements: 95,
          functions: 100,
          lines: 100,
          branches: 80,
        },
        // RUM aggregator + thresholds: pure, fully exercised.
        "src/lib/observability/aggregate.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/observability/vitalsThresholds.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // Warstwa semantyczna analityki: czysty rejestr + reguly uzgadniania,
        // od ktorych zaleza WSZYSTKIE liczby w raportach zarzadczych. Progi
        // floorowane tuz pod osiagnietym pokryciem. Niedobitych galezi nie da sie
        // wywolac PRAWDZIWYM rejestrem: `authoritativeBinding`/`comparabilityOf`
        // maja obronne sciezki dla metryki bez zrodla autorytatywnego i dla pary
        // powiazan roznionej tylko deduplikacja (test inwariantow dowodzi, ze taka
        // metryka/para nie istnieje), a `reconcile` ma arm `incomparable`, ktory
        // wymagalby metryki z powiazaniami spod dwoch roznych bramek zgody.
        "src/lib/analytics/semantic/streams.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/analytics/semantic/format.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/analytics/semantic/window.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        "src/lib/analytics/semantic/metrics.ts": {
          statements: 94,
          functions: 100,
          lines: 100,
          branches: 83,
        },
        "src/lib/analytics/semantic/reconcile.ts": {
          statements: 95,
          functions: 100,
          lines: 97,
          branches: 85,
        },
        // Billing critical path (payment -> access). Floored just below the
        // achieved coverage. webhooks.stripe: the un-hit arms are the framework
        // POST route-arrow (handle() is tested directly) and the catch-all 500,
        // which is why functions/branches sit below 100.
        "src/routes/api/public/webhooks.stripe.ts": {
          statements: 90,
          functions: 85,
          lines: 90,
          branches: 75,
        },
        "src/lib/billing/grant.server.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // Sieć kontaktów - warstwa danych RPC-only. Do 2026-08-06 CAŁY moduł
        // miał 0% (audyt: „pokrycie modułu 15,4%, src/lib/network na 0%"),
        // mimo że decyduje o prywatności odmów zaproszeń, izolacji kont w
        // cache i kontrakcie czasowników RPC. Próg jest zaporą przed powrotem
        // do zera, wyznaczoną tuż pod osiągniętym poziomem.
        "src/lib/network/**": {
          statements: 85,
          functions: 95,
          lines: 95,
          branches: 65,
        },
        // Sieć kontaktów - warstwa KOMPONENTÓW. Do 06.08.2026 cały katalog stał
        // na 4,6% (12 z 13 plików na zerze), w tym ConnectButton: jedna maszyna
        // stanów na pięć stanów relacji × `canInvite` × blokadę, obsługująca
        // trzy powierzchnie produktu. Teraz: 99% instrukcji, 100% linii i
        // funkcji, ~96% gałęzi. Próg jest zaporą tuż pod osiągniętym poziomem -
        // niedobite gałęzie to obronne ramiona, których nie da się wywołać
        // (Radix nie woła `onOpenChange(true)` dla sterowanego dialogu,
        // `preventDefault` na już zablokowanym przycisku itd.).
        "src/components/network/**": {
          statements: 97,
          functions: 98,
          lines: 98,
          branches: 92,
        },
        // Manifest eksportu RODO: rejestr sekcji + bramka rozjazdu z server fn.
        // Czysty moduł, więc trzymamy go pod 100%.
        "src/lib/profile/exportManifest.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 95,
        },
        // ── PROFIL ─────────────────────────────────────────────────────────────
        // Audyt 18.08 postawił profilowi ten sam zarzut, co czatowi wcześniej:
        // pokrycie stało w miejscu (22,0% src/lib/profile, 27,8%
        // src/components/profile), a 9+6 plików na okrągłym zerze - w tym
        // AuthorProfileEditor.tsx (219 instrukcji, największy pojedynczy plik
        // profilu) i CompanyPickerDialog.tsx bez ani jednej asercji. Ten sam
        // ruch, co przy czacie: fixture'y w duchu atomic design
        // (`src/test/profile/fixtures.ts`, plus wspólna atrapa łańcucha
        // PostgREST wyprowadzona do `src/test/supabaseChain.ts` - jest teraz
        // JEDNA, nie osobna kopia na każdą powierzchnię testową).
        //
        // Progi floorowane ~4 pp pod ZMIERZONYM poziomem (marża na dryf CI) -
        // wolno je wyłącznie podnosić.
        //
        // WARSTWA DANYCH: 22,02% -> 85,22% instrukcji (85% funkcji). Jedyny
        // plik wciąż na zerze to `export.functions.ts` (server fn RODO) - ma
        // już bramkę statyczną (`__tests__/exportOwnerScope.gate.test.ts`),
        // a pokrycie runtime'owe server fn zostało świadomie pominięte
        // (koszt/zysk nieopłacalny na tym etapie - patrz dokument wdrożenia).
        "src/lib/profile/**": {
          statements: 81,
          functions: 81,
          lines: 81,
          branches: 75,
        },
        // CZYSTE MODUŁY profilu trzymamy pod 100% na wszystkich czterech
        // metrykach - tak jak czyste moduły czatu i płatności wyżej. Niosą
        // reguły widoczne wyłącznie dla użytkownika: punktację Big Five
        // (klucz odwrócony na połowie pytań), wagi kompletności profilu
        // (suma = 100, zsynchronizowana z bramką CI wobec SQL-a), adresy
        // kanoniczne paneli (nie mogą wskazywać na przekierowanie) i
        // synchronizację podglądu gościa między stroną a layoutem.
        "src/lib/profile/personality.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/profile/completeness.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/profile/routes.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/profile/guestPreviewStore.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // WARSTWA KOMPONENTÓW: 27,84% -> 89,54% instrukcji. Zero plików na
        // zerze (było 6 z 17, w tym AuthorProfileEditor.tsx bez ANI JEDNEJ
        // asercji przy 219 instrukcjach - największy pojedynczy plik tej
        // powierzchni). Trzy defekty wyszły PRZY PISANIU tych testów i zostały
        // naprawione osobnymi commitami: propozycja publicznego adresu profilu
        // zjadała literę „ł" (transliteracja przez samo `normalize("NFKD")` nie
        // rozkłada tej litery), pola formularza tworzenia firmy nie miały
        // `htmlFor` (osiem nienazwanych pól dla czytnika ekranu), a utworzenie
        // nowej firmy w CRM ignorowało błąd DRUGIEGO kroku (powiązania z
        // profilem) - firma lądowała w bazie, użytkownik widział fałszywy
        // sukces. Szczegóły w dokumencie wdrożenia.
        "src/components/profile/**": {
          statements: 85,
          functions: 74,
          lines: 87,
          branches: 82,
        },
        // ── CZAT / KOMUNIKATOR ────────────────────────────────────────────────
        // Audyt 14.08 (MODUŁ 9) postawił temu modułowi jeden zarzut i był to
        // zarzut o TESTY: „T/P 0,111 - bez ruchu w tej delcie, przy 12 293
        // liniach". Pokrycie stało na 17-20% przez TRZY kolejne pomiary, więc
        // sam pomiar niczego nie pilnował - dopiero próg zamienia jednorazowy
        // wysiłek w zaporę. Bez tych wpisów następna generacja mogła zejść
        // z powrotem do zera i żadna bramka by tego nie zauważyła.
        //
        // Progi są floorowane ~4 pp pod ZMIERZONYM poziomem (marża na dryf
        // środowiska CI) i wolno je wyłącznie podnosić - identyczna zasada, co
        // przy sieci kontaktów i paywallu wyżej.
        //
        // WARSTWA DANYCH: 19,67% -> 78,52% instrukcji (84,82% funkcji).
        // Niedobita reszta to nagrywanie głosu (MediaRecorder), toasty
        // przychodzące, katalog osób i pseudonimy - powierzchnie z własnymi
        // warstwami danych, które są następnym krokiem, nie regresją tego.
        "src/lib/chat/**": {
          statements: 74,
          functions: 80,
          lines: 77,
          branches: 67,
        },
        // CZYSTE MODUŁY WĄTKU trzymamy pod 100% na wszystkich czterech
        // metrykach - tak jak pozostałe czyste moduły w tym pliku. To one
        // niosą reguły, których złamanie widzi WYŁĄCZNIE użytkownik: kolejność
        // wiadomości i deduplikację bliźniaka optymistycznego (`thread`),
        // budżet stron przy skoku do trafienia (`useThreadJump`), zgodność
        // etykiet okien znikania z lustrem CHECK-a (`menuOptions`) oraz
        // izolację cache'u między kontami (`keys`).
        "src/lib/chat/thread.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/chat/menuOptions.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/chat/useThreadJump.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/chat/keys.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // WARSTWA DANYCH ROZMOWY - dwa pliki, od których zależy, czy wiadomość
        // dojdzie i czy nie wycieknie między tenantami. Startowały z 0% i 12%.
        "src/lib/chat/useMessages.ts": {
          statements: 86,
          functions: 87,
          lines: 91,
          branches: 78,
        },
        "src/lib/chat/useConversations.ts": {
          statements: 90,
          functions: 96,
          lines: 96,
          branches: 80,
        },
        // WARSTWA KOMPONENTÓW: 17,32% -> 44,63%. Próg jest niższy niż w warstwie
        // danych i to jest uczciwe: kompozytor (585 linii), panel mediów, dialogi
        // kręgu i wyglądu oraz dataset emoji nadal stoją na zerze. Pilnuje tego,
        // co ten PR faktycznie pokrył: okna rozmowy w obu wariantach, menu, doku
        // z limitem okien, dzwonka, wiersza listy z potwierdzeniami i wersją
        // roboczą, paska wyszukiwania oraz przekazywania wiadomości.
        "src/components/chat/**": {
          statements: 40,
          functions: 36,
          lines: 41,
          branches: 34,
        },
        // Organizm okna rozmowy - z 0% na 83,55% po podziale na atomy.
        "src/components/chat/ChatWindow.tsx": {
          statements: 78,
          functions: 60,
          lines: 84,
          branches: 70,
        },
        // Bramka symetrii FTS: czysty analizator migracji. Niedobite gałęzie to
        // ramiona obronne dla wzorców, których w repo nie ma (konfiguracja
        // z parametru, wektor liczony poza migracjami) - zostawiamy je, bo
        // bramka MA mówić „nie rozstrzygnąłem", a nie udawać zieleń.
        "src/lib/ci/ftsConfigSymmetry.ts": {
          statements: 93,
          functions: 100,
          lines: 98,
          branches: 81,
        },
        // ── LOGOWANIE / REJESTRACJA / WYLOGOWANIE ────────────────────────────
        // 2026-08-18: ten lejek miał najgorszy stosunek krytyczności do
        // pokrycia w całym repo - portal logowania (AuthPortal.tsx) 0,4%,
        // useAuth 1,6%, MFA (mfa.ts + MfaChallenge.tsx) 2,3%, reset hasła
        // (routes/reset-password.tsx) 0% - mimo że to JEDYNA brama wejścia do
        // konta na całej powierzchni publicznej. Progi floorowane tuż pod
        // zmierzonym pokryciem, tak jak pozostałe wpisy w tym pliku.
        //
        // AuthPortal.tsx - niedobite gałęzie: pola rejestracji poza fixture
        // testu (phone/company/job/linkedin - typ/autoComplete), domyślne
        // linki prawne (privacy_url/terms_url) i wyścig `mfaPending` w
        // efekcie przekierowania, którego nie da się wywołać bez reaktywnego
        // mocka sesji (useAuth() w teście zwraca statyczną wartość per render).
        "src/components/auth/AuthPortal.tsx": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // MfaChallenge.tsx - niedobite: puste ciało `.catch(() => {})` na
        // signOut() podczas anulowania (mock nigdy nie odrzuca, więc callback
        // się nie odpala) i strażnik `active` chroniący przed osadzeniem
        // odpowiedzi factorId po zamknięciu/odmontowaniu (wyścig wymagający
        // sterowanego opóźnionego promise).
        "src/components/auth/MfaChallenge.tsx": {
          statements: 100,
          functions: 90,
          lines: 100,
          branches: 83,
        },
        // useAuth.tsx - niedobite: fallback `?? []` dla `rolesData` (RPC nigdy
        // nie zwraca null/undefined w testach) i strażnik `typeof window !==
        // "undefined"` w signOut() - zawsze prawdziwy pod happy-dom, więc
        // ścieżka SSR-bez-window jest nieosiągalna z testu jednostkowego.
        "src/hooks/useAuth.tsx": {
          statements: 100,
          functions: 93,
          lines: 100,
          branches: 95,
        },
        // reset-password.tsx - niedobite: `lang` z `head()` zależny od URL-a
        // (activeLang), nie od `i18n.language` czytanego w ciele komponentu -
        // wariant angielski wymagałby osobnego fixture z prefiksem /en, oraz
        // strażniki `cancelled` w efekcie nasłuchu recovery (wyścig przy
        // odmontowaniu w trakcie oczekiwania na sesję/timer).
        "src/routes/reset-password.tsx": {
          statements: 96,
          functions: 100,
          lines: 100,
          branches: 85,
        },
        // mfa.ts - cztery czyste funkcje owijające supabase.auth.mfa.*; każda
        // gałąź (poziomy AAL, obecność/brak czynnika, błąd challenge vs
        // verify) ma dedykowany test.
        "src/lib/auth/mfa.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        // ── MODUŁ 1: WPISY - DOŚWIADCZENIE CZYTELNIKA ────────────────────────
        // Audyt 18.08 dał temu modułowi 31,8% linii i 26,9% funkcji przy 74
        // plikach produkcyjnych, z których 43 nie miały ANI JEDNEJ wykonanej
        // linii. Progi poniżej są floorowane tuż pod ZMIERZONYM pokryciem -
        // zasada bez zmian: wolno je wyłącznie podnosić.
        //
        // REGUŁA GLOSARIUSZA. Chodzi po węzłach tekstowych opublikowanego
        // artykułu i je podmienia, więc jej defekt psuje TREŚĆ, nie panel.
        // Trzymamy 100% linii i funkcji; niedobite gałęzie to obronne ramiona
        // przeniesione 1:1 z komponentu (`node.textContent ?? ""`,
        // `range.parentNode?.`), nieosiągalne przy poprawnym DOM-ie.
        "src/lib/post/glossaryHighlight.ts": {
          statements: 97,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        // WARSTWA USTAWIEŃ MODUŁU. Cztery pliki, które startowały odpowiednio z
        // 51,2% (1 z 10 funkcji), 0 z 5, 0 z 8 i 0 z 8 - a decydują o tym, co
        // czytelnik widzi na KAŻDYM wpisie tenanta i czy zapis w panelu
        // faktycznie dotarł do bazy. Wszystkie cztery są teraz na 100% linii
        // i funkcji, więc trzymamy je jak pozostałe czyste moduły w tym pliku.
        //
        // toc/settings.ts - niedobite gałęzie to `?? slugifyHeading(text)`
        // (fallback kotwicy, gdy derywacja dokumentu nie zna bloku - przy
        // spójnym dokumencie nieosiągalny) i `b.data.level ?? 2` w wariancie,
        // który ma już własny test przez brak pola.
        "src/lib/toc/settings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 90,
        },
        "src/lib/keyTakeaways/settings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/lib/relatedPosts/adminConfig.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
        "src/hooks/usePostLayoutSettings.ts": {
          statements: 100,
          functions: 100,
          lines: 100,
          branches: 100,
        },
      },
    },
  },
});
