# Naprawa: silnik rekomendacji v2 - siódma waga (dwell) dostaje źródło danych (2026-10-02)

Zamyka pozycję A1 zlecenia `docs/PROMPT_MODUL_01_WPISY.md` (stan „częściowo" w wydaniu 12, rozdział 16.13 audytu `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md`). HEAD pomiaru: `main` `45404b0`.

Wybrana droga: **(a) domknięcie kontraktu**. Sześć z siedmiu wag, `use_idf` i `min_score` docierało już do `scoreRelatedDetailed`; brakowało wyłącznie źródła dla `weight_dwell`. Droga (b) - wycięcie suwaka - zostawiłaby w bazie kolumnę `related_posts_config.weight_dwell` bez znaczenia i zabrała redakcji jedyny sygnał jakości lektury (popularność mówi, ile osób weszło, nie czy czytały).

## 1. Mechanizm defektu (stan przed naprawą)

- `src/components/post/RelatedPosts.tsx:119` podawał `weight_dwell` z konfiguracji, a `src/lib/queries/relatedPosts.ts` przekazywał go do `scoreRelatedDetailed`.
- `signals.dwellByPost` nie był ustawiany nigdzie. `scoreRelatedDetailed` liczy `breakdown.dwell` tylko przy obecnej mapie, więc wkład był zawsze zerowy, przy każdej wadze.
- Panel `/admin/related-posts` pokazywał suwak jako wyłączony (`SIGNALS_WITHOUT_SOURCE` w `src/lib/relatedPosts/panelRules.ts`). Zlecenie zabrania dokładnie tego stanu: „nie zostawiaj stanu pośredniego, w którym część wag działa, a część nie".
- Pierwotny pomysł na źródło (agregat `user_read_history` wszystkich czytelników) był zablokowany słusznie: tabela jest pod RLS właściciela wierszy, migracja `20260831170000` klasyfikuje ją jako dane osobowe, a do tego wiersz znaczy „otworzył po 1,5 s", nie „czytał".

## 2. Co zmienia naprawa

### Baza (`supabase/migrations/20261002120000_post_views_dwell_signal.sql`, bliźniak `drizzle/migrations/0124_post_views_dwell_signal.sql`)

- `post_views.dwell_ms integer NULL` z CHECK 0..30 min. NULL znaczy „brak zgłoszenia", nie zero. Nowego identyfikatora nie ma: czas trafia do wiersza odsłony, który już istnieje pod zgodą analityczną.
- `record_post_dwell(_tenant_id, _post_id, _viewer_hash, _dwell_ms) RETURNS boolean` - SECURITY DEFINER, `search_path = public, pg_temp`, EXECUTE **wyłącznie** `service_role`. Trafia najnowszą odsłonę (wpis, `viewer_hash`) najemcy z ostatnich 2 h. Wartość tylko rośnie (GREATEST), więc powtórzony beacon i kolejne zgłoszenia są idempotentne. Zgłoszenie jest przycięte do 30 min i do czasu, jaki od odsłony realnie upłynął (+5 s), więc świeżo nabita odsłona nie dostanie od razu maksimum.
- `related_posts_dwell(_days DEFAULT 28, _limit DEFAULT 200) RETURNS TABLE(post_id, median_dwell_ms)` - SECURITY DEFINER dla anon/authenticated, wzorem `popular_post_ids`: mediana per opublikowany wpis najemcy publicznego (`public_tenant_id()`), wyłącznie wpisy z co najmniej 5 pomiarami, twardy sufit 500, zero kolumn `viewer_hash`/`user_id`, bez `has_role` w ciele.
- Indeks częściowy `post_views_dwell_window_idx (tenant_id, viewed_at DESC) INCLUDE (post_id, dwell_ms) WHERE dwell_ms IS NOT NULL`.
- Nowej polityki RLS nie ma. Wyzwalacz `trg_score_on_post_view` jest AFTER INSERT, więc UPDATE `dwell_ms` go nie odpala.

### Serwer (TS)

- `src/routes/api/public/post-dwell.ts` - beacon wzorem `sponsor-event.ts`: limiter po adresie (60, 1/s), zaufany host, filtr ruchu nieludzkiego z porównaniem `Origin` do zaufanego hosta, limit ciała 512 B, walidacja wspólną funkcją, najemca z zaufanego hosta, zawsze `204 no-store`.
- `src/lib/views/postDwellWire.ts` - kontrakt beaconu dla obu końców (adres, granice 1 s - 30 min, `parsePostDwellBeacon`), bez importów.

### Przeglądarka

- `src/lib/views/postDwell.ts` - pomiar czasu **aktywnego** czytania: karta widoczna, a przerwa między zdarzeniami (przewinięcie, klawisz, dotyk, wskaźnik) liczy się najwyżej do 30 s. Karta w tle nie nabija niczego. Zgłasza narastającą sumę przy schowaniu karty, `pagehide` i odmontowaniu; zgodę analityczną sprawdza jeszcze raz przy wysyłce. Bez `setInterval`, zegar `performance.now()`.
- `src/hooks/useRecordPostView.ts` - pomiar rusza wyłącznie za policzoną odsłoną (ta sama zgoda, to samo wykluczenie autora, ten sam `viewer_hash`) i jest domykany przy odmontowaniu. Moduł pomiaru jest ładowany leniwie (`import()`), bo hook siedzi w chunku wejściowym trasy wpisu, który stoi tuż pod progiem `check:bundle`.
- `src/lib/queries/relatedPosts.ts` - `relatedDwellQueryOptions` (klucz tenanta, nie artykułu; normalizacja względem najdłużej czytanego wpisu, jak popularność), podany do scoringu jako `dwellByPost`.

### Panel i teksty

- `panelRules.ts` i `RelatedPostsEngineSection.tsx`: mechanizm „sygnału bez źródła" usunięty razem z ostatnim takim sygnałem; siedem suwaków jest czynnych.
- `i18n-admin-related-posts.ts` (PL i EN): wstęp, etykieta i podpowiedź dwell opisują nowe źródło (28 dni, próg 5 pomiarów, zgoda analityczna, dłuższe teksty mają dłuższą medianę); `dwellInactive` usunięty.
- `src/routes/cookies.tsx`: przykład `post_views` w kategorii analitycznej mówi o czasie aktywnego czytania. Wersji zgody nie podbijam: opis kategorii już deklaruje „czas sesji" i optymalizację treści.
- `src/lib/analytics/semantic/streams.ts`: `content_views` zna producenta `postDwell.ts`, sufit agregatu i znaczenie `dwell_ms`; nieaktualne zdanie „strumień nie ma bramki zgody" zastąpione opisem stanu mieszanego (odsłona i historia pod zgodą, beacon kliknięć bez niej - dlatego `consentGate` zostaje `none`).

### Optymalizacja zapytania rekomendacji

| Fala | Przed                                             | Po                                                                                                |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1    | taksonomia i autor bieżącego wpisu                | bez zmian                                                                                         |
| 2    | pivoty kandydatów                                 | bez zmian; po nich ruszają sygnały popularność / dwell / profil (czekamy na nie przed scoringiem) |
| 3    | hydracja kandydatów                               | bez zmian                                                                                         |
| 4    | taksonomia kandydatów                             | taksonomia kandydatów **i** ścieżki rodziców jednym wsadem `page_full_paths(uuid[])`              |
| 5    | `page_full_path` osobno dla każdego rodzica (N+1) | -                                                                                                 |
| 6    | popularność i profil czytelnika                   | -                                                                                                 |

Gość płacił 6 fal (czytelnik ze zgodą na personalizację - 7), teraz 4. Wpis bez kandydatów nie pyta o żaden sygnał. Nowy sygnał dwell nie dokłada fali.

## 3. Kolejność wdrożenia

Obie kolejności są bezpieczne:

- **Kod przed migracją:** `related_posts_dwell` nie istnieje, więc sygnał degraduje do `null` z ostrzeżeniem w konsoli, a ranking jest taki jak dotąd. Beacon dostaje 204, a wywołanie `record_post_dwell` pada po cichu.
- **Migracja przed kodem:** kolumna i funkcje stoją nieużywane.

Po wdrożeniu obu ranking nie zmienia się od razu. Domyślne `weight_dwell` to 2 i tyle zapewne mają zapisane konfiguracje, ale wpis wchodzi do sygnału dopiero po 5 pomiarach w oknie 28 dni. Wpływ rośnie wraz z danymi.

## 4. Pomiary i granice weryfikacji

| Sprawdzenie                                                                                                 | Wynik                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/tests/post_views_dwell_signal_test.sql` (lokalny runner pgTAP na pełnym schemacie, 1064 migracje) | 24/24: zakres kolumny, ACL obu funkcji i `proconfig`, trafienie najnowszej odsłony, monotoniczność, przycięcie do upływu czasu, odmowy (obcy najemca, odsłona > 2 h, szum < 1 s, krótki hash, anon wprost), mediana, próg 5, szkic, izolacja najemcy |
| Sąsiednie pliki pgTAP (`related_posts_*`, `host_tenant_resolution`, `crm_lead_scoring`)                     | zielone                                                                                                                                                                                                                                              |
| Migracja zastosowana drugi raz na tej samej bazie                                                           | bez błędów                                                                                                                                                                                                                                           |
| `bun run verify:static`                                                                                     | 33 bramki OK (w tym `format:check`, który na `main` był czerwony przez `src/styles.css:325`; naprawione `prettier --write`)                                                                                                                          |
| vitest: warstwa zapytań, panel, hook, pomiar, trasa, bramki pasów migracji, warstwa semantyczna             | zielone                                                                                                                                                                                                                                              |
| Pokrycie: `queries/relatedPosts.ts` (próg 99/100/99/98)                                                     | 100 / 100 / 100 / 99,34                                                                                                                                                                                                                              |
| Pokrycie: `useRecordPostView.ts` (próg 96/71/100/86)                                                        | 97,05 / 77,77 / 100 / 88,23                                                                                                                                                                                                                          |
| Pokrycie nowych plików (nowe progi): `postDwell.ts`, `postDwellWire.ts`, `post-dwell.ts`                    | 100 / 100 / 100 / 100; 100 / 100 / 100 / 100; 95,83 / 100 / 100 / 92,85                                                                                                                                                                              |

Granice weryfikacji:

- Nie sprawdzałem zachowania na produkcji ani rozmiaru paczek (`check:bundle` wymaga buildu; rozstrzyga CI). Kod liczący jest w leniwym chunku `RelatedPosts` i w nowym leniwym chunku pomiaru; do chunku wejściowego trasy wpisu trafia sam `import()`.
- `scripts/audit/verify-edition-12.mjs` (poza CI) ma asercje-migawki, które każda nowa trasa i migracja przestawia (liczba tras, migracji, funkcji). Zgodnie z konwencją weryfikatora i dokumentu audytu ich nie ruszam.
- `xlsx` zastąpiłem lokalnie wersją 0.18.5 z npm, bo proxy blokuje `cdn.sheetjs.com`. Manifesty zostały bez zmian.

## 5. Czego świadomie nie zrobiłem (osobne pozycje)

- **Normalizacja czasu czytania długością tekstu.** Mediana surowego czasu faworyzuje długie analizy. `posts` nie ma kolumny z długością tekstu (czas czytania liczy wyłącznie przeglądarka), więc uczciwa normalizacja wymaga przesyłania oczekiwanego czasu z beaconem albo kolumny utrzymywanej wyzwalaczem. Podpowiedź panelu mówi o tym wprost.
- **Zacięcie kandydatów na 100 najniższych identyfikatorów.** Komentarz w `queries/relatedPosts.ts` opisuje to jako osobną zmianę (wybór po świeżości po stronie bazy przebudowuje dwa zapytania, pulę IDF i dziesiątki fikstur).
- **Odporność na nabijanie.** `record_post_view` nie ma limitera po adresie, a `viewer_hash` wybiera klient, więc fałszywe odsłony da się tworzyć tak samo jak dotąd (dotyczy też popularności). Dwell ogranicza to medianą, progiem 5 pomiarów, przycięciem do upływu czasu i limiterem beaconu.
- **Pozycja P zlecenia** (progi per plik dla `RelatedPosts.tsx` i `PostSidebarRenderer.tsx`) - tych plików ta zmiana nie dotyka.
