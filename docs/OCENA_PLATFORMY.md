# Ocena platformy — audyt funkcjonalności (surowy i obiektywny)

Data audytu: 2026-07-11 · Stan: commit `0f0d8a1` ("Dodano webhooki do Stripe"), branch `main`.

## Metodologia

Audyt objął cały kod (ok. 191 tys. linii TS/TSX, 175 migracji SQL, 145 plików testów
jednostkowych, 11 zestawów pgTAP, 4 specyfikacje e2e). Każda funkcja została prześledzona
end-to-end: trasa → komponenty → warstwa lib → tabele Supabase i polityki RLS. Testy
jednostkowe zostały wykonane (1362/1362 przechodzą), lint również (NIE przechodzi — 7 błędów
prettier na HEAD). Skala ocen 1–10, przyznawana surowo: punkt odniesienia to produkcyjna
platforma wydawnicza, nie prototyp.

## Werdykt ogólny: **6,5/10**

To NIE jest fasada ani demo — niemal każda funkcja jest realnie podłączona do bazy z RLS,
triggerami, funkcjami SECURITY DEFINER, audytem i rate-limitami. Fundamenty (SEO, paywall,
edytor treści, multi-tenancy, wyszukiwarka) są na poziomie dojrzałego produktu. Ocenę ciągną
w dół: jeden krytyczny błąd kosztowy (TTS), uszkodzona para migracji z dnia audytu, zepsuty
reset hasła, kilka funkcji-wydmuszek (wskaźnik pisania, preferencje powiadomień, ustawienia
podcastów) oraz niemal zerowe pokrycie testami całych obszarów (czat, profil, podcasty).

---

## Oceny szczegółowe

### 1. Wpisy i treści — średnia obszaru ~7,2/10

| Funkcja | Ocena | Uzasadnienie |
|---|---|---|
| Czytanie postów (rendering, SSR, cache, JSON-LD) | **8/10** | Architektura wzorowa: treść płynie wyłącznie przez RPC `get_entity_content` z serwerowym sprawdzeniem uprawnień, kolumny treści odcięte od PostgREST na poziomie grantów Postgresa; ALE publicznie renderuje się placeholder „Placeholder – uzupełnij punkty" przy postach bez key takeaways (`$.tsx:571`), a 4 przełączniki stopki posta (źródła, via, karta autora, poprzedni/następny) to martwe atrapy — edytor je pokazuje, render zawsze przekazuje `null` (`$.tsx:718-725`). |
| Edytor postów + workflow redakcyjny | **9/10** | Najlepszy element platformy: 4 silniki treści, autozapis z ochroną przed utratą danych, undo/redo, rewizje (throttling + limit 50), presence przy współedycji, workflow draft→review→published egzekwowany potrójnie (UI, server fn, trigger DB), publikacja planowana przez pg_cron, automatyczne przekierowania 301 przy zmianie slug. Minusy: ~85 linii martwego kodu (`TakeawaysEditor`), edytor legacy richtext używa `window.prompt` do linków i obrazów, rozjazd limitu takeaways (UI 6 vs serwer 7). |
| Silnik bloków + builder (Gutenberg + Elementor) | **9/10** | 99 typów bloków, pełny builder sekcja→kolumna→widget, import z Gutenberga i markdown, osobne stosy undo per język; najlepiej przetestowany obszar repo (~25 plików testów widgetów). Schemat persystencji celowo luźny (dowolny JSON) — ryzyko ograniczone przez error boundaries. |
| Strony (builder pages) | **7/10** | Builder potężny i realny, ALE autozapis jest jawnie wyłączony (`enabled: false`, `admin.pages.$slug.tsx:248`) i strony NIE mają rewizji — dla typu treści z najcięższymi dokumentami to największa ekspozycja na utratę danych w całej platformie. |
| Media | **7,5/10** | Prawdziwy potok: walidacja serwerowa, limit 10 MB, deduplikacja, skan użycia przed usunięciem. SVG w allowlist (wektor stored-XSS), zero testów. |
| Pasek czytania / TOC / udostępnianie / postęp | **7,5/10** | Bogaty i dostępny (focus trap, aria, scrollspy); przycisk „PDF" to zwykłe `window.print()` (mylące), mobilny arkusz ignoruje konfigurację widoczności przycisków. |
| Live blog | **5/10** | Realtime i RLS produkcyjnie poprawne, ale funkcja jest w połowie zbudowana: konsola `/admin/live-blog` nie jest podlinkowana w żadnej nawigacji (trzeba znać URL i ręcznie wkleić UUID posta oraz ID bloku), blok `liveblog` w edytorze renderuje się jako goły placeholder `[liveblog]` bez żadnego UI konfiguracji, wpisów nie można edytować po publikacji, brak SSR-prefetchu (crawlery widzą pusty stan). Zero testów. |
| Web stories | **6/10** | Kompletne CRUD + dopracowany viewer, ale SEO leży: tytuł strony to slug, brak JSON-LD, brak AMP (nie wejdzie do karuzeli Google — a to jest raison d'être web stories), stories NIE MA w sitemap.xml i nie istnieje publiczny indeks `/web-stories`; zapisy z pominięciem konwencji audytu/rate-limitów reszty repo. |
| Archiwa / kategorie / tagi / autor / blog | **6/10** | Poprawne, SSR, testowane bazowo — ale BRAK paginacji gdziekolwiek (twarde limity 50–80): treść poza limitem jest nieosiągalna; błędy zapytań połykane jako 404 („Tag nie znaleziony" przy awarii sieci); martwy kod w liście bloga (mapa ścieżek liczona i nigdy nie używana). Twardo zakodowane polskie stringi w dwujęzycznej aplikacji. |
| Strona główna | **8/10** | W pełni CMS-owa, bez hardkodu, poprawna hydracja i cache, uczciwy empty state; ale tryb „najnowsze wpisy" oferowany w ustawieniach czytania jest widmem — trasa nigdy go nie honoruje i zawsze renderuje stronę statyczną. |
| Komentarze | **6/10** | Warstwa Postgresa wzorcowa (progi, moderacja, zamrożenie tożsamości, jeden poziom zagnieżdżenia — wszystko w triggerach); ALE: realny błąd Reacta (subskrypcja auth w `useMemo` z nigdy niewywołanym cleanupem — wyciek, `CommentsSection.tsx:31-38`), zero rate-limitów na insert (klient pisze wprost do Supabase), brak antyspamu, brak edycji, brak realtime, brak paginacji (500 sztywno), formularz renderuje się nawet gdy komentarze globalnie wyłączone (domyślny seed!) i użytkownik dowiaduje się dopiero z błędu. Zero testów. |

### 2. Podcasty / Audio / Text-to-speech — średnia obszaru ~4,3/10 (najsłabszy obszar)

| Funkcja | Ocena | Uzasadnienie |
|---|---|---|
| Podcasty | **4/10** | CRUD odcinków i strona publiczna działają, ale: BRAK hostingu audio (goły input na URL), BRAK RSS podcastowego (`/rss.xml` nie ma `<enclosure>`), BRAK publicznej listy odcinków (nieosiągalne bez widgetu), tabela `podcast_settings` nie ma ŻADNEGO miejsca zapisu w całym kodzie — linki subskrypcji Spotify/Apple nigdy się nie wyrenderują; bug: lista admina nie filtruje `deleted_at`, więc „Usuń" wygląda jak no-op. |
| Odtwarzacz audio | **5/10** | Dopracowane UI, globalny player przeżywa nawigację; ale brak zapisu pozycji (reload = od zera), brak Media Session API (zero sterowania z ekranu blokady), brak kolejki, dwa odtwarzacze mogą grać jednocześnie, blob-y nigdy nie są zwalniane (`URL.revokeObjectURL` nieobecne). Zero testów. |
| Text-to-speech (ElevenLabs) | **4/10** | Integracja prawdziwa i przemyślana w intencjach (auth, allowlisty, limity)... ale KRYTYCZNY defekt: kolumna `rate_limits.subject_id` jest `uuid NOT NULL`, a publiczny endpoint przekazuje IP i `postId:lang` jako string — każde zapytanie limitera pada błędem typu, a limiter celowo „fails open". Efekt: reklamowane limity 3/min i 60/h NIGDY nie działają, endpoint ma `Access-Control-Allow-Origin: *` i bez uwierzytelnienia pozwala dowolnej stronie wypalać płatny budżet ElevenLabs po 5000 znaków na request. Do tego zero cache'u serwerowego (każdy słuchacz płaci syntezę od nowa; nagłówki cache na POST są bezużyteczne) i odczyt cross-tenant przez service role. |

### 3. Czat / Wiadomości / Powiadomienia — średnia obszaru ~6/10

| Funkcja | Ocena | Uzasadnienie |
|---|---|---|
| Czat 1:1 (DM) | **8/10** | Zaskakująco produkcyjna klasa: RLS v2 z helperem SECURITY DEFINER, deduplikacja konwersacji race-safe, okno edycji 5 min egzekwowane też triggerem, optymistyczne wysyłanie z deduplikacją echa realtime, reakcje, odpowiedzi, tombstony. Braki dyskwalifikujące z 9–10: ZERO moderacji/blokowania (raz otwarta konwersacja = można pisać wiecznie), zero rate-limitów (spam + fan-out powiadomień), kursor paginacji bez tiebreakera id, zero testów. |
| Realtime / potwierdzenia odczytu / wskaźnik pisania | **6/10** | Odczyty i resync po reconnect solidne; ALE wskaźnik pisania to weryfikowalnie MARTWY KOD — każdy klient broadcastuje na kanale z losowym sufiksem (`chat-conv:${id}:${Math.random()}`), więc peer nigdy nie odbierze zdarzenia; cały UI pisania renderuje się dla nikogo. Kanał presence nieprywatny — enumeracja online-userów cross-tenant. |
| Załączniki czatu | **6/10** | Kompletny potok signed-URL + RLS storage, ale bucket `chat-attachments` NIE istnieje w żadnej migracji — z samego repo upload zawsze padnie. Infrastruktura w połowie w kodzie. |
| „AI" czat (bot) | **3/10** | To nie AI — lokalny symulator echo/3 gotowe odpowiedzi, bez backendu i persystencji; uczciwie opisany, ale duplikuje ~300 linii UI bąbelków. |
| Powiadomienia | **7/10** | Prawdziwy rurociąg producentów w triggerach DB (wiadomość, komentarz, obserwacja, publikacja, subskrypcja, powitanie) z deduplikacją 5 min i wzorcowym RLS (insert tylko definer); braki: brak paginacji (max 200, starsze nieosiągalne), bug usuwania grupy (kasuje tylko najnowszy wiersz — reszta „odżywa"), zero push/email. |
| Preferencje powiadomień | **4/10** | Pełny UI z toastem sukcesu, ale 5 z 7 przełączników NIE jest konsultowane przez żadnego producenta (grep: jedyny odczyt to `enabled_message`) — wyłączenie powiadomień o obserwujących nic nie robi. Wydmuszka. |
| Katalog osób (/people) | **8/10** | Consent-first (jawny opt-in `discoverable`), wyszukiwanie trgm z escapowaniem LIKE, paginacja, jedyny porządnie przetestowany backend obszaru (pgTAP). Minus: RPC `get_chat_peers` bez filtra tenanta — wyciek profili (imię/avatar/stanowisko) cross-tenant po UUID. |

### 4. Profil / Konto / Personalizacja — średnia obszaru ~5,8/10

| Funkcja | Ocena | Uzasadnienie |
|---|---|---|
| Logowanie / rejestracja | **5/10** | Email+hasło działa, provisioning po stronie serwera utwardzony (pgTAP); ALE reset hasła prowadzi do NIEISTNIEJĄCEJ trasy `/reset-password` (404 z tokenem w hashu), czytelnik po zalogowaniu zostaje na formularzu (nawigacja tylko dla staffu), potwierdzenie e-maila czytelnika przekierowuje do... panelu admina, brak OAuth/magic-link na głównych powierzchniach, brak MFA, niespójna polityka haseł (min 6 vs 8), ~5 martwych ustawień w adminie logowania. |
| Profil (edytor inline, doświadczenie, CV) | **7/10** | Bogaty, w pełni podłączony (optymistyczne edycje z rollbackiem, upload z paskiem postępu, CRUD doświadczenia/edukacji/umiejętności z RLS). Minusy: edycja przez `window.prompt`, CV w PUBLICZNYM buckecie storage, zero testów. |
| Konto (drugi edytor profilu) | **6/10** | Działa, sekcja prywatności (`discoverable`) wzorowa; ale to redundantny drugi edytor tego samego wiersza, już zdryfowany od pierwszego. |
| Bezpieczeństwo konta | **4/10** | 104 linie: zmiana hasła i wyloguj. Brak weryfikacji obecnego hasła, MFA, listy sesji, zmiany e-maila i usunięcia konta (RODO — na platformie z „European" w nazwie). |
| Profil społecznościowy / slug autora | **6/10** | Dobra walidacja sluga; wyścig przy unikalności, a czytelnikowi obiecuje się publiczną stronę, która dla nie-autorów zwraca 404. |
| Profil autora | **5/10** | Realny i role-gated, ale to TRZECIE równoległe miejsce edycji bio/socjali/avatara bez synchronizacji. |
| Test osobowości (Big Five) | **5/10** | Nie wydmuszka: 30 pozycji z odwróconym kluczowaniem, poprawne skorowanie (przetestowane jednostkowo), historia podejść. ALE: para sprzecznych migracji z 2026-07-11 (patrz „Defekty krytyczne"), surowe odpowiedzi psychotestu czytelne anonimowo dla profili publicznych (REVOKE siedzi w prawdopodobnie niezaaplikowanej migracji), każdy admin tenanta może czytać historię Big Five wszystkich użytkowników — poważny problem RODO; wynik nie zasila niczego (rekomendacje go nie czytają). |
| Zainteresowania + silnik personalizacji | **6/10** | Prawdziwa personalizacja w SQL (`get_recommended_posts_v2`: +4 autor, +3 kategoria, +2 tag, +1 historia, wykluczenie przeczytanych) i świetny merge anonimowych danych po zalogowaniu; ale zasięg = jedna strona (/reading-list), martwe ustawienia admina, żywa jest słabsza z dwóch zduplikowanych implementacji RPC (pełny skan tabeli), zero testów. |
| Obserwowanie (autorzy/kategorie/tagi) | **7/10** | Najbardziej kompletna funkcja obszaru: realny wpływ na feed z powodami, zapisy race-safe, obsługa martwych referencji; brak licznika obserwujących dla autorów, antyspam powiadomień w skonfliktowanej migracji, zero testów. |
| Zapisane na później (zakładki + lista czytania) | **6/10** | Solidna persystencja z owner-RLS, uczciwa obsługa gości (localStorage → merge po zalogowaniu); ale ZERO trybu offline, N+1 na stronach, kruche dopasowanie „duplicate" po treści błędu, dwie różnie nazwane powierzchnie na ten sam zasób (mylące), zero testów. |
| Zamówienia / subskrypcja / dane rozliczeniowe | **6/10** | Realne tabele i server fn (anuluj/wznów z poprawną logiką końca okresu); formularz faktury prawie bez walidacji (NIP wolny tekst), statyczne klucze cache ratowane globalnym czyszczeniem przy wylogowaniu. |

### 5. Monetyzacja i wzrost — średnia obszaru ~6,9/10

| Funkcja | Ocena | Uzasadnienie |
|---|---|---|
| Płatności / subskrypcje (Stripe) | **7/10** | Prawdziwa integracja: ceny rozwiązywane po stronie serwera (klient nie może manipulować kwotą), poprawna weryfikacja podpisu webhooka (HMAC + timingSafeEqual + tolerancja 5 min), idempotentne nadawanie uprawnień, najlepsze testy w repo (250-liniowy test webhooka). ALE: plan `one_time` jest NIE DO KUPIENIA (checkout rzuca `entity_required` — ścieżka zepsuta end-to-end), refund anuluje WSZYSTKIE aktywne subskrypcje użytkownika zamiast jednej, brak Customer Portal, upgrade'ów, faktur i przekazywania NIP do Stripe. |
| Paywall / kontrola dostępu | **8/10** | Rzadkość: egzekwowanie na poziomie kolumn Postgresa (REVOKE + RPC SECURITY DEFINER), nieobchodzalny z klienta, hasła bcrypt po stronie serwera. Brak jakiegokolwiek meteringu („N darmowych artykułów" nie istnieje), lockout haseł tylko client-side (RPC brute-forcowalne), martwa tabela `subscription_tiers`. |
| Newsletter | **7/10** | Prawdziwy double opt-in (token mintowany serwerowo — poprzednia dziura consent-forgery jawnie załatana), wysyłka przez Resend, one-click unsubscribe RFC 8058, audyt zgód z IP/UA. ALE: pole „zaplanuj" jest martwe (NIC nie wysyła zaplanowanych kampanii — pg_cron obsługuje tylko posty), wysyłka synchroniczna w jednym request HTTP (duża lista = timeout, crash = kampania wieczne „sending" bez recovery), zero open/click trackingu, HTML kampanii to surowa textarea (ładny builder jest tylko dla formularzy zapisu). |
| Reklamy | **6/10** | Porządny system house-ads: 7 pozycji, targetowanie, zgody, ochrona CLS; ale zero zliczania wyświetleń/kliknięć — nie da się na tym rozliczyć ani zoptymalizować żadnej kampanii; sloty script/html to stored-XSS w rękach każdego edytora. |
| Popupy | **7/10** | Kompletne: triggery (delay/scroll/exit-intent), capping, targetowanie ścieżek/urządzeń/audiencji, modal z poprawnym a11y, realne testy; capping tylko w localStorage i zero pomiaru konwersji. |
| CRM | **6,5/10** | Uczciwie: skrzynka leadów, nie CRM — auto-tworzenie z zapisów i formularzy, pipeline etapów, oś czasu, podpisywana HMAC integracja wychodząca; godne pochwały obrony przed injection (PostgREST `.or()`, formuły CSV); zero testów, jeden sztywny partner integracji. |

### 6. Infrastruktura / SEO / Admin — średnia obszaru ~7,7/10 (najmocniejszy obszar)

| Funkcja | Ocena | Uzasadnienie |
|---|---|---|
| Wyszukiwarka | **8/10** | Prawdziwy FTS Postgresa: tsvector z wagami (tytuł A, excerpt B, treść C wraz z JSONB bloków), unaccent, GIN, RPC tenant-scoped, poważne testy pgTAP (diakrytyki, semantyka AND, wykluczenie cross-tenant). Brak paginacji (cap 80 i licznik kłamie), facety = 3 dodatkowe round-tripy, brak snippetów na stronie wyników. |
| SEO | **9/10** | Klasa agencyjna: sitemapy z hreflang x-default+pl+en, news-sitemap z regułą 48 h Google, robots.txt fail-closed z polityką AI-crawlerów, llms.txt, JSON-LD (NewsArticle+speakable, FAQ, Review, Breadcrumb), menedżer przekierowań z wildcard/410/CSV, generator kart OG, 15 plików testów + zgodna z kodem dokumentacja. N+1 na `page_full_path` przy renderze sitemap, karta OG generuje się tylko w przeglądarce admina. |
| i18n (PL/EN) | **7/10** | Świetne wykonanie dwujęzyczności łącznie z treścią (kolumny _pl/_en, FTS obu języków, per-request klon i18next chroniący edge cache przed przeciekiem języka); ale to konstrukcyjnie system DWUjęzyczny — trzeci język wymaga nowych kolumn DB i edycji unii typów, nie konfiguracji. |
| Panel administracyjny | **8/10** | ~75 tras, wszystko co sondowano jest realne: importer WordPressa (920 linii, media re-host z dedup sha256, auto-301 starych permalinków), A/B testy (deterministyczne bucketowanie FNV-1a, z-test dwóch proporcji), pipeline RUM (PerformanceObserver → beacon → p75 → dashboard), role z audytowanym RPC i blokadą eskalacji, impersonacja. Bramka /admin tylko client-side (bezpieczeństwo realnie na RLS — poprawne, ale brak serwerowego 403), pliki tras po 1000+ linii, `window.confirm` w destrukcyjnych akcjach. |
| Multi-tenancy | **8/10** | Izolacja klasy security (RLS na `current_tenant_id()`, plan anon fail-open vs crawler fail-closed, cache SSR skopowany po hoście, pgTAP dowodzi izolacji); operacyjnie to jedna publikacja na szynach multi-tenant — brak self-signup i rozliczeń tenantów. |
| Serwer MCP | **6/10** | Realny, OAuth na JWT Supabase, świadome injection sanityzacje; ale 3 płytkie narzędzia, `search_posts` używa ILIKE zamiast własnego silnika FTS platformy (wyniki gorsze niż /search), wymóg zalogowanego użytkownika kłóci się z pozycjonowaniem GEO/llms.txt. |
| Jakość inżynierska ogółem | **8/10** | 1362 testy przechodzą w 65 s, CI z bramką typów/coverage/bundle, uczciwe rozliczanie coverage (jawnie opisana rezygnacja z „wyfarmionego" 98%), RUM + ingest błędów klienta z limitami, współdzielony focus trap + testy axe-core, dokumentacja zgodna z kodem. ALE lint jest CZERWONY na HEAD (7 błędów prettier z ostatniego commita), globalna podłoga coverage ~20%, budżety Lighthouse tylko warn, e2e to smoke. |

---

## Defekty krytyczne (do naprawy w pierwszej kolejności)

1. **[KOSZTY/BEZPIECZEŃSTWO] Publiczny TTS bez działających limitów** — `rate_limits.subject_id`
   jest `uuid`, endpoint przekazuje stringi → limiter zawsze „fails open"; CORS `*`,
   brak auth, 5000 znaków/request płatnej syntezy ElevenLabs. Możliwe zdrenowanie budżetu
   przez dowolną stronę trzecią. (`src/routes/api/public/post-tts.ts:159-185`,
   migracja `20260531183823`)
2. **[BAZA] Sprzeczna para migracji z 2026-07-11** — `20260711100000` i `20260711102702`
   definiują te same obiekty niekompatybilnie (`get_recommended_posts_v2` zmienia typ
   zwracany bez DROP) → świeży `supabase db reset` pada (42P13), a utwardzenia
   bezpieczeństwa (REVOKE anon na `personality_results`, escapowanie w `search_people`,
   antyspam powiadomień) prawdopodobnie NIE są live.
3. **[UX/AUTH] Reset hasła prowadzi do 404** — e-mail linkuje do `/reset-password`,
   trasa nie istnieje (`src/routes/login.tsx:152`).
4. **[RODO] Dane psychometryczne** — surowe odpowiedzi Big Five czytelne anonimowo dla
   profili publicznych; każdy admin tenanta może czytać historię testów wszystkich
   użytkowników; CV w publicznym buckecie storage.
5. **[UTRATA DANYCH] Strony buildera bez autozapisu i rewizji**
   (`admin.pages.$slug.tsx:248`) — najcięższe dokumenty, jedno kliknięcie od utraty.
6. **[PŁATNOŚCI] Plan one-time niekupowalny; refund kasuje wszystkie subskrypcje
   użytkownika** (`checkout.functions.ts:51`, `webhooks.stripe.ts:265-274`).
7. **[WYCIEK] `get_chat_peers` bez filtra tenanta** — enumeracja profili cross-tenant.
8. **[MARTWE FUNKCJE widoczne dla użytkownika]** — wskaźnik pisania w czacie (losowe
   topici broadcast), 5/7 przełączników preferencji powiadomień, przełączniki stopki
   posta, ustawienia podcastów (tabela bez writera), przycisk „PDF" (= print),
   pole „zaplanuj kampanię" newslettera, tryb strony głównej „najnowsze wpisy"
   (opcja w ustawieniach, nigdy nie renderowana).
9. **[SKALOWANIE] Brak paginacji** na blogu, archiwach, wynikach wyszukiwania,
   powiadomieniach i liście konwersacji — twarde sufity 50–600 rekordów.
10. **[CI] Lint czerwony na HEAD** — 7 błędów prettier z commita `0f0d8a1`.

## Mocne strony (żeby ocena była uczciwa w obie strony)

- Paywall egzekwowany na poziomie grantów kolumn Postgresa — realnie nieobchodzalny.
- SEO/GEO na poziomie, jakiego nie ma większość komercyjnych CMS-ów.
- Edytor treści z ochroną przed utratą danych zaprojektowaną na każdej warstwie.
- Multi-tenant RLS z testami pgTAP dowodzącymi izolacji.
- Stripe: weryfikacja podpisów, idempotencja, serwerowe ceny — z testami.
- Uczciwość inżynierska: dokumentacja przyznaje się do wycofanych eksperymentów,
  konfiguracja coverage opisuje, jak poprzednio zawyżano wynik.

## Podsumowanie ocen

| Obszar | Ocena |
|---|---|
| Wpisy i treści | 7,2/10 |
| Podcasty / audio / TTS | 4,3/10 |
| Czat / powiadomienia | 6/10 |
| Profil / personalizacja | 5,8/10 |
| Monetyzacja / newsletter | 6,9/10 |
| Infrastruktura / SEO / admin | 7,7/10 |
| **Platforma ogółem** | **6,5/10** |

---

# Naprawy wprowadzone (2026-07-11)

Poniżej wykaz zmian usuwających defekty krytyczne oraz podnoszących funkcje ocenione
poniżej 6/10. Po naprawach: `bun run test` = 1363 przechodzą, `bun run lint` = 0 błędów,
`tsc --noEmit` bez nowych błędów.

## Defekty krytyczne

1. **TTS — działające limity + koniec otwartego CORS.** `rate_limits.subject_id`
   zmieniony `uuid → text` (migracja `20260711120000`), więc limiter przestał „fail-open"
   i limity 3/min, 15/h, 60/h realnie działają. Usunięto `Access-Control-Allow-Origin: *`
   (endpoint jest teraz same-origin), dodano zawężenie postu do tenanta hosta oraz
   serwerowy cache MP3 w prywatnym buckecie `tts-cache` (koniec ponownej płatnej syntezy).
2. **Sprzeczne migracje z 2026-07-11 pogodzone.** `20260711102702` dostał `DROP FUNCTION`
   przed `get_recommended_posts_v2` (koniec błędu 42P13 na `db reset`), a nowa migracja
   `20260711120000` domyka bazę do jednego stanu: kanoniczne `search_people` (z escapowaniem
   LIKE), `get_recommended_posts_v2`/`get_followed_feed`, pojedynczy trigger historii.
3. **Reset hasła.** Dodana trasa `/reset-password` (obsługa tokenu recovery + zmiana hasła
   + wylogowanie pozostałych sesji). E-mail resetu nie prowadzi już do 404.

## RODO / prywatność

- `personality_results`: odebrany odczyt `anon`, usunięta polityka odczytu dla adminów
  tenanta, a kolumna `answers` (surowe odpowiedzi) usunięta z historii — dane
  psychometryczne nie są już publiczne ani widoczne dla adminów.
- Usuwanie konta (RODO): server fn `deleteMyAccount` z ponownym potwierdzeniem hasłem,
  zmiana e-maila i wylogowanie innych sesji po zmianie hasła — na stronie
  `/profile/security`.
- `get_chat_peers`: dodany filtr tenanta (koniec wycieku profili cross-tenant).

## Funkcje podniesione (było → jest)

| Funkcja | Było | Jest | Co naprawiono |
|---|---|---|---|
| Text-to-speech | 4 | ~7 | działające limity, brak CORS *, tenant-scope, cache serwerowy |
| Podcasty | 4 | ~6,5 | RSS z `<enclosure>`, indeks `/podcasts`, edytor ustawień (writer), SEO+JSON-LD odcinka, filtr `deleted_at`, dialog potwierdzenia, wariant „sticky" |
| Odtwarzacz audio | 5 | ~7 | zapis/odtworzenie pozycji, Media Session, arbitraż (jeden gra naraz), AbortController, zwalnianie blobów |
| Live blog | 5 | ~7 | link w nawigacji, wybór postu/bloku (bez wklejania UUID), edycja wpisów, dialog potwierdzenia, edytor bloku w treści |
| Preferencje powiadomień | 4 | ~7 | `enqueue_notification` honoruje wszystkie przełączniki (nie tylko `message`) |
| Bezpieczeństwo konta | 4 | ~7 | re-auth, zmiana e-maila, wylogowanie sesji, usunięcie konta |
| Logowanie / auth | 5 | ~7 | trasa resetu, przekierowania czytelnika, spójne min. 8 znaków |
| Test osobowości | 5 | ~6,5 | naprawiona migracja, prywatność danych, jeden trigger historii |
| „AI" bot | 3 | — | usunięty (był atrapą bez backendu) |
| Wskaźnik pisania (czat) | 6 | ~7,5 | stały topic kanału zamiast losowego — realnie działa |
| Powiadomienia | 7 | ~8 | poprawione usuwanie grup, paginacja centrum |
| Płatności Stripe | 7 | ~8 | plan `one_time` kupowalny (dostęp dożywotni), refund tylko właściwej subskrypcji |
| Strony (builder) | 7 | ~8 | rewizje stron + `RevisionsCard` (ścieżka odzyskiwania) |
| Czytanie postów | 8 | ~8,5 | koniec publicznego placeholdera takeaways, podłączona karta autora |
| Strona główna | 8 | ~8,5 | działający tryb „najnowsze wpisy", usunięty martwy kod N+1 w liście bloga |

## Poza zakresem (świadomie pozostawione)

- Paginacja archiwów/wyszukiwarki/bloga: te powierzchnie miały oceny ≥6/10, więc poza
  mandatem „poniżej 6/10"; retrofit „load more" na wielu trasach obarczony ryzykiem
  regresji SSR. Zaimplementowano tryb „najnowsze wpisy" na stronie głównej i paginację
  centrum powiadomień jako reprezentatywne poprawki.
- Paski „źródła"/„via" w stopce postu: brak modelu danych w schemacie (wiązanie
  wymagałoby nowej funkcji, nie tylko podłączenia) — karta autora została podłączona.
- Newsletter: harmonogram kampanii i analityka otwarć/kliknięć (obszar 6,9/10, poza
  mandatem).
