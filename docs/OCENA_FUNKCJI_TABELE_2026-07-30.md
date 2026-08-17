# Tabele modułów — funkcja po funkcji: ocena, argumenty, rekomendacje + pozycja vs konkurencja (2026-07-30)

**Data:** 2026-07-30 · **HEAD:** `be34fc3` · **Gałąź:** `claude/platform-audit-assumptions-3lgp5s`

Dokument rozbija platformę na **20 modułów × pojedyncze funkcje**. Każda funkcja ma: ocenę 0–10,
argument **✅ dobry**, argument **⚠️ słaby** i **🔧 rekomendację**. Oceny funkcji są spójne z
`AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-07-30.md` (rewizja) — nie z deklaracjami starszych dokumentów.
Na końcu: **jak NES wypada na tle konkurencji think-tankowej w PL / UE / na świecie** (mapowanie na
38 konkurentów z `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md`).

Skala: **9–10** wybitne · **7–8** produkcyjne · **5–6** działa z wyraźną luką · **<5** zepsute/wydmuszka.
Ocena modułu = kompozyt jego funkcji (kompletność + inżynieria + dopracowanie + bezpieczeństwo + testy).

---

# MODUŁ 1 — Wpisy: doświadczenie czytelnika · **8,0/10**

| Funkcja                           | Ocena | ✅ Dobry                                                                                                                | ⚠️ Słaby                                                            | 🔧 Rekomendacja                                       |
| --------------------------------- | :---: | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| Paywall / bramka dostępu          | **9** | 4 tryby, entitlement dowodzony obecnością body — anon SSR nie wysyła bajtów premium; enforcement kolumnowy (REVOKE+RPC) | Lockout hasła tylko po stronie klienta                              | Przenieść lockout hasła do RPC (server-side)          |
| Metering „N darmowych/mies."      | **9** | Serwerowy `consume_metered_view`, konsumpcja po hydracji (boty nie palą limitu), gość=UUID w localStorage               | Brak UI pokazującego czytelnikowi „zostało N"                       | Dodać licznik pozostałych artykułów w warstwie treści |
| Podaruj artykuł (gift, NYT-style) | **9** | Idempotentny link, RPC SECURITY DEFINER, cap `max_redemptions_per_link`, testy domeny                                   | Cap niedostępny w UI admina                                         | Wystawić edycję capu w panelu                         |
| Spis treści (TOC)                 | **8** | Skonsolidowany `slugifyAnchor` (jedno źródło + test parytetu na `ł`), scrollspy, mobile sheet z focus-trap              | Piąta kopia slugify w `TocWidget.tsx:25` (NFKD-only, gubi `ł`)      | Przepiąć `TocWidget` na `slugifyAnchor`               |
| Pasek postępu czytania            | **8** | `rafThrottle` na najgorętszym handlerze, liczony wg realnych granic `.article-body`                                     | Sticky header bez własnego wskaźnika                                | Kosmetyka — opcjonalnie                               |
| Przypisy (footnotes)              | **9** | End-to-end: edytor→silnik→SSR, jeden kontrakt wyjścia, 8+ plików testów                                                 | —                                                                   | Utrzymać                                              |
| Key takeaways                     | **8** | Placeholder publiczny **usunięty** (`$.tsx:820`), `aria-hidden` gdy brak                                                | Dla stron gałąź renderu nigdy ich nie pokazuje (martwy przełącznik) | Wyciąć takeaways ze stron albo dorobić render         |
| Cytowania / eksport bib.          | **7** | Realny formatter (Chicago i in.), testy fallbacków                                                                      | Zakres formatów ograniczony                                         | Dodać BibTeX/RIS jeśli jest popyt                     |
| Audio artykułu (TTS w treści)     | **7** | Publiczny `post-tts` z cache w prywatnym buckecie, gating `has_content_access`                                          | 24-krotna amplifikacja kosztu (6 głosów×2 modele×2 języki na wpis)  | Jeden kanoniczny głos/model per artykuł               |

---

# MODUŁ 2 — Edytor wpisów i workflow redakcyjny · **8,4/10**

| Funkcja                         | Ocena | ✅ Dobry                                                     | ⚠️ Słaby                              | 🔧 Rekomendacja         |
| ------------------------------- | :---: | ------------------------------------------------------------ | ------------------------------------- | ----------------------- |
| Autozapis (wpisy)               | **9** | Realny `useAutosave` z ochroną przed utratą, `AutosaveBar`   | —                                     | Utrzymać                |
| Rewizje wpisów                  | **8** | Limit 50, throttling 5 min, restore pomija `status` (celowo) | Zero testów integracyjnych na restore | Dodać test przywracania |
| Workflow draft→review→published | **9** | Egzekwowany **potrójnie**: UI, server fn ×2, trigger DB      | —                                     | Utrzymać                |
| Publikacja planowana            | **8** | pg_cron `publish_due_posts` co minutę + fallback best-effort | —                                     | Utrzymać                |
| Kalendarz redakcyjny            | **7** | Drag-and-drop, realny                                        | Brak testów                           | Dodać smoke test        |
| Redirecty 301 przy zmianie slug | **8** | Automatyczne, realne                                         | —                                     | Utrzymać                |

---

# MODUŁ 3 — Silniki treści: bloki + page builder · **8,8/10**

| Funkcja                        | Ocena | ✅ Dobry                                                                                    | ⚠️ Słaby                                                              | 🔧 Rekomendacja                                             |
| ------------------------------ | :---: | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| Silnik bloków (posty)          | **9** | **100 typów bloków**, renderer pokrywa 100/100, 0 placeholderów, ~25 plików testów widgetów | Schemat persystencji celowo luźny (dowolny JSON)                      | Utrzymać (ryzyko cięte error boundaries)                    |
| Page builder (widgety)         | **9** | **87 widgetów** (nie ~75), pełne pokrycie rejestru, sekcja→kolumna→widget                   | —                                                                     | Utrzymać                                                    |
| Interop bloki⇄builder          | **7** | Konwersja blocks→builder realna (`blocksToBuilder`)                                         | **Jednokierunkowa** i tylko w imporcie WP; builder→bloki nie istnieje | Dorobić kierunek odwrotny albo udokumentować jako by-design |
| Import z Gutenberga / markdown | **8** | Realne parsery, osobne stosy undo per język                                                 | —                                                                     | Utrzymać                                                    |
| Undo/redo per język            | **8** | Osobne stosy, poprawne                                                                      | —                                                                     | Utrzymać                                                    |

---

# MODUŁ 4 — Strony, wygląd, motyw, media, import · **6,8/10**

| Funkcja                    | Ocena | ✅ Dobry                                                                     | ⚠️ Słaby                                                                                                                  | 🔧 Rekomendacja                                                      |
| -------------------------- | :---: | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Builder stron              | **7** | Ten sam potężny builder co posty, realny                                     | —                                                                                                                         | Utrzymać                                                             |
| **Autozapis stron**        | **3** | —                                                                            | **Nadal wyłączony** — `useAutosave` nieimportowany, wbrew komentarzowi „Autozapis włączony" (`admin.pages.$slug.tsx:293`) | Włączyć `useAutosave`+`AutosaveBar` albo poprawić kłamliwy komentarz |
| Rewizje stron              | **6** | Istnieją (`writeRevisionSnapshot(entityType:"page")`)                        | Snapshot gubi `template_type`/`header_override`/`toc_override` (lista pól jest postowa)                                   | Rozdzielić `REVISION_FIELDS` post vs page                            |
| Motyw / design tokens      | **8** | Głębia frameworka komercyjnego, tokeny, globalne kolory                      | —                                                                                                                         | Utrzymać                                                             |
| Media — upload/skan użycia | **7** | Skan użycia przed usunięciem, foldery/rename/bulk, `OptimizedImage` z srcSet | Walidacja na danych **deklarowanych przez klienta** (zero magic-bytes), brak deduplikacji                                 | Sniffing bajtów + kolumna hash                                       |
| Media — SVG stored-XSS     | **7** | Allowlista aplikacyjna blokuje SVG + bucket allowlist                        | Importer WP **nadal ma `image/svg+xml`** na liście                                                                        | Usunąć SVG z list importera WP                                       |
| **Import WP**              | **4** | Realny potok WP.com API + WXR                                                | **Nadal niszczy drugi język** — nadpisuje cały `blocks_data`, brak merge; dwa równoległe stacki (688+924 linie)           | Merge per-język zamiast nadpisania; zunifikować stacki               |

---

# MODUŁ 5 — Strona główna, archiwa, chrome · **7,8/10**

| Funkcja                     |   Ocena   | ✅ Dobry                                                                                                                                                        | ⚠️ Słaby                                                            | 🔧 Rekomendacja                                                        |
| --------------------------- | :-------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Strona główna               |   **8**   | W pełni CMS-owa, SSR, uczciwy empty state, poprawna hydracja                                                                                                    | Tryb „najnowsze wpisy" z ustawień — widmo (trasa nie honoruje)      | Wyciąć martwy tryb albo okablować                                      |
| Archiwa kategoria/tag       |   **8**   | Prawdziwa paginacja `?page=N&sort=`, `noindex,follow` dla >1                                                                                                    | —                                                                   | Utrzymać                                                               |
| Archiwum bloga              |   **6**   | SSR                                                                                                                                                             | „load more" bez `?page` → brak indeksowalnych stron                 | Dodać `validateSearch`+`?page` jak w taksonomii                        |
| Archiwum autora             | **6 → 8** | Role-gated; od 2026-07-31 paginacja serwerowa `?page=N` + filtry w URL (RPC `get_expert_materials`, SSR strony N, `noindex,follow` dla widoków >1/filtrowanych) | ~~Paginacja **po stronie klienta** na pobranym zbiorze~~ (wdrożone) | Wdrożone 2026-07-31 - patrz `WDROZENIE_PAGINACJA_AUTORA_2026-07-31.md` |
| Mega menu / ticker / chrome |   **8**   | 6 layoutów archiwum, mega menu, ticker                                                                                                                          | —                                                                   | Utrzymać                                                               |

---

# MODUŁ 6 — Wyszukiwarka · **8,3/10**

| Funkcja                      | Ocena | ✅ Dobry                                                | ⚠️ Słaby                                                     | 🔧 Rekomendacja       |
| ---------------------------- | :---: | ------------------------------------------------------- | ------------------------------------------------------------ | --------------------- |
| FTS treści (Postgres)        | **9** | Natywna FTS+pgvector, koszt marginalny ~0 vs Algolia    | —                                                            | Utrzymać              |
| Fasety / filtry              | **8** | Realne fasety, klasa zbliżona do RAND                   | —                                                            | Utrzymać              |
| Paleta ⌘K                    | **8** | Lazy-mount, realna                                      | —                                                            | Utrzymać              |
| Wyszukiwanie głosowe (STT)   | **7** | `api/stt` z auth+limitami, fallback Web Speech dla anon | Brak allowlisty MIME uploadu (dowolny 8 MB blob do gatewaya) | Dodać allowlistę MIME |
| Alerty zapisanych wyszukiwań | **7** | pg_cron `saved-search-alerts` realny                    | Brak testu integracyjnego                                    | Dodać test            |

---

# MODUŁ 7 — Typy treści specjalne · **6,5/10**

| Funkcja                  |   Ocena   | ✅ Dobry                                                                                                                                                                                                                                                                                                      | ⚠️ Słaby                                                                                                                                                                      | 🔧 Rekomendacja                                                                                                 |
| ------------------------ | :-------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Tracker legislacyjny     |   **6**   | Pasek etapów, macierz 27 państw, feed „co się zmieniło", obserwacje przez RPC, bramka warstw w DB                                                                                                                                                                                                             | **Brak importu** (wszystko ręcznie), **brak diffu wersji**, **brak RSS**, **obserwacje nikogo nie powiadamiają** (a alerty są w cenniku!)                                     | Job czytający `eu_policy_follows` + `tracker.rss.xml` + import EUR-Lex/OEIL                                     |
| Huby ekspertów           |   **7**   | Katalog z filtrami, capability „zapytanie do eksperta" (Pro+) z kwotami                                                                                                                                                                                                                                       | `expert-layouts`: nadpisanie per-ekspert „w kolejnym kroku" (niezrobione)                                                                                                     | Dokończyć inline editor layoutów                                                                                |
| Programy badawcze        |   **5**   | `research-programs` realny hub (members/projects/partners), RSS per program                                                                                                                                                                                                                                   | **Dwie równoległe tabele** (`programs` vs `research_programs`), admin edytuje dane bez publicznego odbiorcy                                                                   | Zmigrować na jedną tabelę, usunąć duplikat                                                                      |
| Wydarzenia               |   **8**   | Waitlist FIFO serwerowy, RSVP-mail idempotentny, ICS RFC 5545, przypomnienia cron. **Naprawione 2026-08-01:** SSR listy - loader (`ensureQueryData` + `useSuspenseQuery`, per-tenantowy `edgeTtlCache`) + JSON-LD `CollectionPage` z węzłami `Event` i breadcrumbs (`WDROZENIE_SSR_WYDARZENIA_2026-08-01.md`) | -                                                                                                                                                                             | Utrzymać                                                                                                        |
| Q&A                      |   **7**   | Moderacja (4 statusy) + odpowiedzi eksperckie, Chatham House, JSON-LD, SSR                                                                                                                                                                                                                                    | —                                                                                                                                                                             | Utrzymać                                                                                                        |
| Ankiety (polls)          |   **7**   | Realtime głosowanie, zapisy przez utwardzone RPC, pgTAP                                                                                                                                                                                                                                                       | Brak SSR                                                                                                                                                                      | Dodać loader                                                                                                    |
| Biblioteka               |   **7**   | Pliki w prywatnym buckecie, bramka rangi **egzekwowana w DB**, logowanie pobrań                                                                                                                                                                                                                               | Podmiana pliku niemożliwa w edycji; brak SSR                                                                                                                                  | Dodać replace + loader                                                                                          |
| Glosariusz               |   **8**   | CRUD + realny odbiorca (tooltipy w treści)                                                                                                                                                                                                                                                                    | —                                                                                                                                                                             | Utrzymać                                                                                                        |
| **Quiz (EuroChallenge)** | **3 → 7** | **Korekta 2026-07-31:** to CELOWA landing-strona promocyjna **drugiej platformy NES** (`nes-quiz.com`), nie wydmuszka — branded `head()` (tytuł/OG/Twitter), `LazyQuizIframe`, tło z preloadem, przyciski udostępniania (LinkedIn/FB/Messenger/Mail). Cross-promo zrobione świadomie.                         | `head()` ma opis i OG **zahardkodowane po polsku** (bez `activeLang`) → odwiedzający EN dostaje polski snippet w podglądzie linku — a to platforma stworzona do udostępniania | Zbilingwalizować meta (`activeLang` PL/EN) + `og:url`/canonical do `nes-quiz.com`; poza tym utrzymać jako embed |
| Web stories              |   **7**   | AMP + JSON-LD + sitemap + indeks (naprawione)                                                                                                                                                                                                                                                                 | `rel=amphtml` tylko gdy `cover_url`; indeks bez `ItemList`/paginacji                                                                                                          | Emitować `amphtml` zawsze + paginacja indeksu                                                                   |

---

# MODUŁ 8 — SEO, feedy, dane strukturalne · **7,5/10**

| Funkcja                | Ocena | ✅ Dobry                                                                     | ⚠️ Słaby                                                                                                           | 🔧 Rekomendacja                                     |
| ---------------------- | :---: | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| JSON-LD (`safeJsonLd`) | **9** | Escaping `< > & U+2028/9`, ~20 tras, test kontraktu w CI                     | —                                                                                                                  | Utrzymać                                            |
| hreflang PL/EN         | **8** | x-default+pl+en, suppress przy canonical-override                            | —                                                                                                                  | Utrzymać                                            |
| Paywall markup (AEO)   | **8** | `isAccessibleForFree:false`+`hasPart/cssSelector`, selektor realnie istnieje | —                                                                                                                  | Utrzymać                                            |
| Sitemap                | **6** | Zawiera web-stories/tracker/programy/ekspertów/Q&A/eventy                    | Jednoplikowa bez indeksu (ściana 50k URL); **news-sitemap nieodkrywalny** (nie ma go w robots.txt mimo komentarza) | Dopisać `Sitemap: news-sitemap.xml` + sitemap-index |
| Podcast RSS            | **8** | **Ingestowalny** (enclosure+length+type, itunes:*), panel readiness          | GUID z prefiksem językowym (PL/EN = 2 kanały); brak autodiscovery w `<head>`                                       | Wspólny GUID + `<link rel=alternate>`               |
| OG images              | **8** | HMAC-gated webhook refresh, 501 bez sekretu                                  | —                                                                                                                  | Utrzymać                                            |
| RSS/feedy treści       | **8** | Kategoria/tag/program RSS realne                                             | —                                                                                                                  | Utrzymać                                            |

---

# MODUŁ 9 — Czat / komunikator · **7,5/10**

| Funkcja                                  | Ocena | ✅ Dobry                                                                           | ⚠️ Słaby                                                                                                                                | 🔧 Rekomendacja                                                   |
| ---------------------------------------- | :---: | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| DM 1:1                                   | **8** | RLS v2 z helperem SECURITY DEFINER, dedup konwersacji race-safe, okno edycji 5 min | Kursor paginacji bez tiebreakera id                                                                                                     | Dodać id do kursora                                               |
| Motywy / tapety                          | **8** | 5 motywów + 3 tapety z DB, realne                                                  | —                                                                                                                                       | Utrzymać                                                          |
| Read receipts                            | **8** | 4-stanowe, wzajemność wyłączenia testowana pgTAP                                   | —                                                                                                                                       | Utrzymać                                                          |
| Wskaźnik pisania                         | **8** | **Naprawiony** — stabilny topic `chat-conv:${id}`, odbiorca realny                 | —                                                                                                                                       | Utrzymać                                                          |
| Głosówki (voice notes)                   | **7** | MediaRecorder, fallback formatów, `durationSeconds`                                | —                                                                                                                                       | Utrzymać                                                          |
| Grupy                                    | **7** | `create_group_conversation`, member picker, info dialog                            | —                                                                                                                                       | Utrzymać                                                          |
| Wyszukiwarka w wiadomościach             | **6** | `search_vector` + RPC z powtórzonym RLS                                            | Konfiguracja `simple` = **zero fleksji**, wbrew komentarzowi „polska fleksja"                                                           | Zmienić na słownik z fleksją albo poprawić komentarz              |
| Załączniki                               | **8** | Bucket `chat-attachments` istnieje (30 MB, allowlist), purge osieroconych          | —                                                                                                                                       | Utrzymać                                                          |
| Blokowanie / mute / rate limit           | **7** | `user_blocks` owner-only, egzekucja serwerowa, mute, limit 20/min                  | „Zgłoś" istnieje w sieci, **brak w oknie czatu**                                                                                        | Dodać wejście „Zgłoś" z `MessageBubble`                           |
| **Prywatność peerów (`get_chat_peers`)** | **3** | RPC ma `REVOKE FROM anon`                                                          | **REGRESJA cross-tenant** — filtr tenanta zdmuchnięty przez DROP/CREATE (21.07); B widzi profil discoverable A; **test pgTAP czerwony** | **P0:** przywrócić filtr tenanta + potwierdzić że CI odpala pgTAP |
| „AI" bot                                 | **3** | Uczciwie opisany jako symulator                                                    | Lokalne echo/3 odpowiedzi, duplikuje ~300 linii UI                                                                                      | Wyciąć albo podłączyć realny backend                              |

---

# MODUŁ 10 — Sieć / networking · **8,0/10**

| Funkcja                    | Ocena | ✅ Dobry                                                                                 | ⚠️ Słaby                                                          | 🔧 Rekomendacja         |
| -------------------------- | :---: | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| Graf połączeń              | **9** | Deny-all (`REVOKE ALL FROM PUBLIC,anon,authenticated`), cały dostęp przez granularne RPC | —                                                                 | Utrzymać (wzorzec)      |
| Zaproszenia / wprowadzenia | **8** | `request_introduction`/`respond_introduction`, race-safe                                 | —                                                                 | Utrzymać                |
| Rekomendacje               | **8** | **Naprawione kontraktowo** — RPC rzuca na nieznany czasownik, pgTAP                      | —                                                                 | Utrzymać                |
| Zgłaszanie użytkownika     | **8** | `report_user` + kolejka admina                                                           | —                                                                 | Utrzymać                |
| Katalog osób (/people)     | **8** | Consent-first (`discoverable`), trgm z escapowaniem LIKE, paginacja                      | —                                                                 | Utrzymać                |
| Testy warstwy klienta      | **4** | —                                                                                        | `network/__tests__` **nie istnieje** (~880 linii bez unit testów) | Dodać unit testy hooków |

---

# MODUŁ 11 — Newsletter · **6,5/10**

| Funkcja                          | Ocena | ✅ Dobry                                                                            | ⚠️ Słaby                                                                                                                | 🔧 Rekomendacja                                                      |
| -------------------------------- | :---: | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Double opt-in                    | **8** | Token serwerowy TTL 48h, rate limit per-IP i per-adresat, audyt zgód IP/UA          | —                                                                                                                       | Utrzymać                                                             |
| Kreator e-maili (EmailDoc)       | **8** | Realny builder, PL/EN                                                               | HTML kampanii bez sanityzacji (staff-only)                                                                              | Dodać sanityzację obronną                                            |
| Wysyłka kampanii                 | **7** | Lease + batching (200/inv, 20/batch), recovery po crashu, idempotencja per odbiorca | `failed_count:0` nadpisywane; `markFailed` wywala całą kampanię                                                         | Akumulować liczniki; izolować błąd odbiorcy                          |
| **Runner (scheduler)**           | **4** | pg_cron `jobs-tick` co minutę istnieje                                              | **Domyślnie martwy** — `enabled=false`, `base_url=''`; „zaplanuj" nie działa dopóki admin nie kliknie w ukrytą zakładkę | Health-check/alarm gdy runner wyłączony                              |
| Open/click tracking              | **6** | Przepisywanie linków + piksel, token HMAC per (kampania, subskrybent)               | Brak dedup na `campaign_events` + podwójny zapis z webhooka → **liczby zawyżone, możliwe >100%**                        | UNIQUE na zdarzeniach + wyłączyć podwójny zapis                      |
| One-click unsubscribe (RFC 8058) | **8** | `List-Unsubscribe`+`-Post`, GET nie mutuje                                          | —                                                                                                                       | Utrzymać                                                             |
| **Suppression / deliverability** | **4** | Webhook Resend z podpisem Svix, bramka reputacji przed wysyłką                      | **Dwie rozłączne tabele**; tx-suppression bramkuje **1 z 19 typów** maila; fail-open przy błędzie RPC                   | **P0:** jedna tabela; przepuścić wszystkie typy tx przez suppression |
| Segmentacja                      | **6** | Segment `min_tier_rank` działa realnie                                              | `admin.audience` to dashboard retencji, **nie** narzędzie segmentacji mimo nazwy                                        | Dobudować segmenty definiowane przez usera                           |

---

# MODUŁ 12 — Realtime / powiadomienia / web-push · **6,5/10**

| Funkcja                     | Ocena | ✅ Dobry                                                                           | ⚠️ Słaby                                                                                                        | 🔧 Rekomendacja                                                 |
| --------------------------- | :---: | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Szyna zdarzeń domenowych    | **9** | Anti-drift, korelacja, optymistyczne mutacje                                       | —                                                                                                               | Utrzymać                                                        |
| Powiadomienia in-app        | **8** | Producenci w triggerach DB, dedup 5 min, RLS insert-only-definer, realtime dzwonka | —                                                                                                               | Utrzymać                                                        |
| Paginacja powiadomień       | **8** | `useInfiniteQuery`+`.range()` (naprawione), usuwanie grupy `.in("id",ids)`         | —                                                                                                               | Utrzymać                                                        |
| Preferencje powiadomień     | **8** | **Respektowane** — `enqueue_notification` CASE pokrywa wszystkie rodzaje           | Test gating dla 4 z 10 rodzajów brakuje                                                                         | Dodać asercje pgTAP                                             |
| Krypto web-push (VAPID)     | **9** | Własna impl. RFC 8291/8188, ES256, roundtrip test                                  | —                                                                                                               | Utrzymać                                                        |
| Service worker              | **8** | `push-sw.js` push+notificationclick, rejestrowany po opt-in                        | —                                                                                                               | Utrzymać                                                        |
| **Scheduler push + digest** | **2** | Kolejka + konsument + gating gotowe                                                | **Nikt nie woła `community-cron`** — brak pg_cron/net.http_post/Actions; z repo push i digesty **nie wychodzą** | **P0:** zaplanować `community-cron` (wzorem `invoke_jobs_tick`) |

---

# MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · **8,0/10**

| Funkcja                              | Ocena | ✅ Dobry                                                                              | ⚠️ Słaby                                                                                                                | 🔧 Rekomendacja                                          |
| ------------------------------------ | :---: | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Ceny serwer-autorytatywne            | **9** | Klient nie może manipulować kwotą, ceny rozwiązywane serwerowo                        | Brak testu przypinającego „cena serwerowa"                                                                              | Dodać test                                               |
| Webhook Paddle                       | **8** | Podpis `unmarshal` obowiązkowy, błąd→500 (retry), allowlista IP                       | `claimWebhookEvent` fail-open (błąd logu→podwójne przetworzenie)                                                        | Fail-closed na claim albo idempotencja maili/CRM         |
| `grantEntitlement`                   | **9** | **Naprawiony mocno** — każdy błąd rzucany, udokumentowany kontrakt, 8 testów regresji | —                                                                                                                       | Utrzymać                                                 |
| **Izolacja sandbox/live (one-time)** | **3** | Ścieżka subskrypcyjna filtruje `environment`                                          | **`environment` sterowany przez klienta, ścieżka one-time go nie sprawdza** — zakup sandboxowy odblokowuje realną treść | **P0:** kolumna `environment` w `payment_orders` + filtr |
| Customer Portal                      | **8** | **Istnieje** (`portalLink.server.ts`) — overview/karta/anulowanie + mail              | —                                                                                                                       | Utrzymać                                                 |
| Faktury / dokumenty                  | **8** | `invoice.server.ts` z 3-ścieżkową kontrolą własności, zasilane z webhooka             | —                                                                                                                       | Utrzymać                                                 |
| Dunning                              | **8** | Licznik prób + dedup po `transactionId`                                               | —                                                                                                                       | Utrzymać                                                 |
| Zmiana planu                         | **8** | Provider-first, `prevent_change` przy odmowie                                         | —                                                                                                                       | Utrzymać                                                 |
| NIP / VAT                            | **7** | Walidacja `nip.ts`, formularz                                                         | Nie przekazywany do Paddle w części ścieżek                                                                             | Ujednolicić przekazywanie NIP                            |
| Waluty / FX                          | **8** | Realne API NBP z retry i TTL (nie sztywny parytet)                                    | —                                                                                                                       | Utrzymać                                                 |
| Mock mode                            | **8** | Fail-closed w 3 punktach (dostawca skonfigurowany→mock nigdy)                         | —                                                                                                                       | Utrzymać                                                 |

---

# MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · **6,8/10**

| Funkcja             | Ocena | ✅ Dobry                                                                                                                          | ⚠️ Słaby                                                                                                                  | 🔧 Rekomendacja                                 |
| ------------------- | :---: | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Kupony B2B          | **8** | **Naprawione** — `applied_cents` jedno źródło prawdy, grant tieru fail-closed, rezerwacja limitu atomowa, pgTAP+test niezmiennika | —                                                                                                                         | Utrzymać                                        |
| Prezenty (gift)     | **9** | End-to-end, `create/redeem_gift_link`, czysta domena z testami                                                                    | —                                                                                                                         | Utrzymać                                        |
| **Darowizny**       | **3** | Uczciwie przeniesione na zrzutka.pl (AUP Paddle)                                                                                  | `/admin/donations` (245 linii) **trwale pusty**, nadal deklaruje „Zapisuje webhook Stripe" — nic nie pisze do `donations` | Wyciąć panel albo oznaczyć jako link zewnętrzny |
| Reklamy (house ads) | **6** | 7 pozycji, targetowanie, zgody, ochrona CLS, `ad_events`→dashboard                                                                | Sloty script/html to stored-XSS w rękach edytora                                                                          | Sanityzacja/sandbox slotów HTML                 |
| Popupy              | **7** | Triggery (delay/scroll/exit), capping, targetowanie, a11y, testy                                                                  | Capping tylko localStorage                                                                                                | Server-side capping opcjonalnie                 |

---

# MODUŁ 15 — Profil i konto · **7,5/10**

| Funkcja                          | Ocena | ✅ Dobry                                                                               | ⚠️ Słaby                                                                                                     | 🔧 Rekomendacja                                        |
| -------------------------------- | :---: | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Logowanie / rejestracja          | **7** | Reset hasła **działa** (naprawiony), brute-force fail-closed, polityka 8 znaków spójna | **3 ścieżki logowania** — OAuth Google tylko w bloku buildera, tam **bez MFA** (user z TOTP wchodzi na aal1) | Ujednolicić: MFA we wszystkich, OAuth z przełącznikiem |
| MFA (TOTP)                       | **8** | Realne (`enroll/challenge/verify`), step-up aal2 egzekwowany serwerowo                 | Brak listy sesji/urządzeń                                                                                    | Dodać listę aktywnych sesji                            |
| Eksport danych (RODO)            | **8** | 17 sekcji, user-scoped, jawna sekcja `errors`                                          | Brak testów integracyjnych                                                                                   | Dodać test                                             |
| Usunięcie konta (RODO)           | **6** | Re-auth hasłem, uprzednie anulowanie subskrypcji u operatora                           | **Kaskadowe kasowanie `payment_orders`** — niszczy dowody księgowe (art. 74 uor)                             | `SET NULL`+anonimizacja zamiast `CASCADE`              |
| Bezpieczeństwo konta             | **8** | Zmiana hasła/e-maila z re-auth, „wyloguj inne sesje"                                   | Brak listy sesji                                                                                             | j.w.                                                   |
| Profil (edytor, CV, dorobek)     | **8** | Bio **skonsolidowane** (`canonicalBio`), optymistyczne edycje z rollbackiem            | CV w publicznym buckecie → **naprawione** (prywatny + owner RLS)                                             | Utrzymać                                               |
| Test osobowości (Big Five)       | **4** | 30 pozycji, poprawne skorowanie, DB utwardzona                                         | **Furtka: CRM czyta wyniki service-rolem** wbrew celowej migracji; wynik nie zasila rekomendacji             | **P1:** zamknąć odczyt w CRM albo bramkować zgodą      |
| Personalizacja / zainteresowania | **7** | 4–5 powierzchni (nie 1), tryb anon z merge po zalogowaniu                              | Żywa słabsza z 2 impl. RPC (pełny skan)                                                                      | Ujednolicić RPC rekomendacji                           |
| Organizacje (seaty)              | **7** | Realny moduł: seaty, grace, przypomnienia cron, zaproszenia                            | Brak faktur per-org i ról poza owner/member                                                                  | Dodać role + faktury org                               |
| Zgody / prywatność               | **6** | CMP (4 kategorie) + audytowany rejestr RODO z IP/UA                                    | **Dwa niekomunikujące się systemy**; `personalization` niczego nie bramkuje; brak GPC/„do not sell"          | Zunifikować zgody w `/profile/privacy`                 |

---

# MODUŁ 16 — Zarządzanie społecznością · **7,5/10**

| Funkcja                | Ocena | ✅ Dobry                                                    | ⚠️ Słaby                                                                                                                                 | 🔧 Rekomendacja                                   |
| ---------------------- | :---: | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Moderacja Q&A / ankiet | **8** | Statusy, odpowiedzi eksperckie, zapisy przez utwardzone RPC | —                                                                                                                                        | Utrzymać                                          |
| Reputacja              | **7** | Leaderboard, poziomy, RPC, testy                            | —                                                                                                                                        | Utrzymać                                          |
| **Odznaki**            | **4** | Emiter domain-eventu przy nadaniu                           | **Katalog UI (6) ≠ DB CHECK (4)** — 3 klucze zawsze łamią CHECK; `staff` nienadawalny; **zero auto-przyznawania** mimo silnika reputacji | Zunifikować katalog z DB + auto-grant z reputacji |
| Powitania              | **7** | Wołaczowe, szablony maili                                   | —                                                                                                                                        | Utrzymać                                          |
| Engagement dashboard   | **7** | Jeden RPC `get_engagement_overview`                         | —                                                                                                                                        | Utrzymać                                          |
| Contribute → review    | **8** | Pełna pętla zgłoszenie→moderacja z RLS                      | —                                                                                                                                        | Utrzymać                                          |

---

# MODUŁ 17 — Analityka i BI · **7,5/10**

| Funkcja               | Ocena | ✅ Dobry                                                                                                       | ⚠️ Słaby                                                                                          | 🔧 Rekomendacja                              |
| --------------------- | :---: | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| GA4 (import + export) | **8** | **Realny** Data API (JWT RS256 service account) + Measurement Protocol                                         | Klucze `GA4_*` nieudokumentowane w `.env.example`; zero cache (2× API na odświeżenie)             | Dodać cache + docs env                       |
| Search Console        | **6** | Realne API przez gateway platformy                                                                             | Vendor lock + SPOF; status „zbiera dane" to **tylko test obecności env, bez pingu**               | Ping API + własny OAuth jako alternatywa     |
| First-party tracking  | **7** | Pełny łańcuch track→tabela→dashboard, consent gate, rate limit                                                 | Sessionization per karta (przeszacowuje); **zero bot-filtering** (kod to przyznaje)               | Dodać filtr botów + sessionization cross-tab |
| Warstwa semantyczna   | **9** | Reconciliation, authoritative vs corroborating, `safeRatio`, rozróżnia `not_configured`/`no_data`, testy+pgTAP | **6 z 7 zakładek omija słownik** — jeszcze nie obowiązująca                                       | Przepiąć pozostałe zakładki na słownik       |
| „Silnik insightów"    | **5** | Data-driven insighty GA4/GSC/semantic realne                                                                   | Overview to **hardkodowane stringi z flag env**, nie z liczb; „silnik" semantic = 3 reguły        | Generować Overview z liczb                   |
| RUM (web vitals)      | **8** | Pełny łańcuch beacon→tabela→dashboard                                                                          | Typy Supabase niezregenerowane (`as never`)                                                       | Zregenerować typy                            |
| Eksperymenty A/B      | **6** | Przydział FNV-1a deterministyczny, ekspozycje z blokadą cross-tenant, z-test                                   | Client-side (flash B, SSR zawsze A); **brak korekty na peeking**, brak min. próby; `z=0→winner=A` | Przydział server-side + bramka istotności    |

---

# MODUŁ 18 — CRM · **8,0/10**

| Funkcja               | Ocena | ✅ Dobry                                                                             | ⚠️ Słaby                                                                         | 🔧 Rekomendacja                                       |
| --------------------- | :---: | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Lead scoring          | **9** | **10 realnych triggerów**, parytet TS↔SQL pilnowany testem+pgTAP, decay 30 dni, capy | —                                                                                | Utrzymać                                              |
| Pipeline / funnel     | **6** | 8 stage'ów, timeline                                                                 | `funnelStats` **ściąga całą tabelę i liczy pętlą w JS** (N+1 przy skali)         | Agregacja `COUNT(*) FILTER` w SQL                     |
| Zadania / follow-upy  | **8** | pg_cron co 10 min, `SKIP LOCKED`, deep-linki, szyna zdarzeń                          | —                                                                                | Utrzymać                                              |
| Firmy ↔ leady         | **8** | FK + indeks, propagacja `company_id`, aktywność firmy                                | —                                                                                | Utrzymać                                              |
| Import / eksport CSV  | **8** | Chunk 500, dedup po `email_norm` w transakcji, obrona przed CSV-injection            | —                                                                                | Utrzymać                                              |
| Lista leadów          | **6** | Sort/filtr po score                                                                  | Limit 500 **bez paginacji i bez totala** (admin widzi ucięty zbiór)              | Paginacja + `count:exact`                             |
| Saved views           | **5** | Pełny `LeadFilterSchema` gotowy                                                      | Podłączone **tylko dla firm**, nie dla leadów                                    | Podłączyć do `admin.crm.index`                        |
| Integracje wychodzące | **6** | HMAC-podpisane, sekrety w Vault, `forward_stages` konfigurowalne                     | **Jeden sztywny partner (Merydian)** w kolumnach — brak 2. odbiorcy bez migracji | Tabela `crm_webhook_endpoints` + `integration_outbox` |

---

# MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · **7,8/10**

| Funkcja                    | Ocena | ✅ Dobry                                                                                                | ⚠️ Słaby                                                                                                                | 🔧 Rekomendacja                                                    |
| -------------------------- | :---: | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Multi-tenant (host→tenant) | **8** | 2 płaszczyzny (treść fallback / crawler fail-closed), `profiles.tenant_id` przypięty triggerem, gate CI | **`x-tenant-host` wciąż spoofowalny** — eskalacja zamknięta, spoofowalność nie (brak trusted-proxy)                     | Walidacja hosta vs `tenants.domain` w krawędzi                     |
| RLS coverage               | **9** | **0 tabel bez RLS** (198/198), 408 unikalnych polityk                                                   | Metryka „915" w starych docs zawyża 2,4× (liczy churn)                                                                  | Poprawić metrykę w dokumentacji                                    |
| Sekrety (Vault)            | **9** | Sekrety CRM/integracji w Vault, service-role tylko w `*.server.ts`                                      | Klucze Merydian historycznie plaintext                                                                                  | Zweryfikować migrację do Vault                                     |
| Impersonacja               | **8** | Gate `is_super_admin`, audytowana, ścieżka `end` domknięta                                              | —                                                                                                                       | Utrzymać                                                           |
| **Anonimowe INSERT-y**     | **4** | Naprawione migracjami `lock_down` (30.07)                                                               | **4 kanały stały otwarte ~30 dni** (m.in. fabrykacja zgód RODO w `crm_consent_log`), znalezione ręcznie, nie przez gate | **P1:** gate CI „brak polityki INSERT dla anon na tabelach intake" |
| CSP / nagłówki             | **6** | CSP + XFO + Referrer + Permissions + HSTS + nosniff                                                     | `script-src 'unsafe-inline'` → **CSP nie chroni przed XSS** (uczciwie przyznane)                                        | Plan wyjścia z `unsafe-inline` (nonce)                             |
| Consent RODO               | **7** | Rejestr z IP/UA/wersją/źródłem                                                                          | Rozjazd z CMP (patrz M15)                                                                                               | Zunifikować                                                        |

---

# MODUŁ 20 — Platforma / backend / infrastruktura / SSR · **7,5/10**

| Funkcja                       | Ocena | ✅ Dobry                                                                                   | ⚠️ Słaby                                                                                                            | 🔧 Rekomendacja                                                   |
| ----------------------------- | :---: | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| SSR render treści             | **8** | Post/home/archiwa/eksperci/autor renderują treść serwerowo, defensywny loader `allSettled` | **`/tracker` to SSR-shell** (brak loadera → crawler widzi „Ładowanie")                                              | Dodać loader do `tracker.index`                                   |
| Edge cache dokumentów         | **7** | L1 per-isolate + L2 per-colo, kill-switch, sekcja zwłok incydentu 61 s                     | Invalidacja **nie pokrywa** tracker/podcast/program/web-story/event; `reader.cancel` nie ubija upstreamu            | Rozszerzyć `DOCUMENT_PURGE_ACTIONS`; naprawić kolejność tee/guard |
| Bramka kompletności SSR (e2e) | **3** | Test istnieje                                                                              | **Pozorny** — guard sam dopisuje `</body></html>`, więc asercja nie może zafailować; 4 ścieżki, zero asercji treści | Asercje treściowe + wyłączyć guard w teście                       |
| Bundle publiczny              | **5** | Gate `check:bundle`+`check:chunks` (Tarjan) blokujące w CI                                 | **1,47 MB gzip** dla czytelnika (5–6× ponad budżet); progi gonią regresję                                           | Code-split agresywnie; obniżyć budżet                             |
| Prerender                     | **3** | —                                                                                          | **Nie istnieje** (0 stron); `prerender.ts` to Speculation Rules, nie build                                          | Rozważyć prerender kluczowych stron                               |
| Testy jednostkowe             | **7** | **3423 pass / 0 fail**, gate coverage w CI                                                 | Progi **19,5%/15,75%** (niskie); lint i knip **poza CI**                                                            | Podnieść progi; wpiąć lint+knip                                   |
| pgTAP (izolacja/tenant)       | **6** | 62 pliki, gate `supabase test db` w CI                                                     | **Test `chat_privacy` czerwony od 21.07** — CI go nie łapie                                                         | Zweryfikować że pgTAP realnie failuje CI                          |
| Gate'y SQL statyczne          | **8** | `check-sql-tenant-scope`+`app-role` blokujące                                              | —                                                                                                                   | Dodać gate anon-insert                                            |

---

# PODSUMOWANIE OCEN MODUŁÓW

| #   | Moduł                   |  Ocena  | #   | Moduł                          |  Ocena  |
| --- | ----------------------- | :-----: | --- | ------------------------------ | :-----: |
| 1   | Wpisy — czytelnik       | **8,0** | 11  | Newsletter                     | **6,5** |
| 2   | Edytor + workflow       | **8,4** | 12  | Realtime / push                | **6,5** |
| 3   | Bloki + builder         | **8,8** | 13  | Monetyzacja — checkout         | **8,0** |
| 4   | Strony / media / import | **6,8** | 14  | Monetyzacja — kupony/darowizny | **6,8** |
| 5   | Strona główna / archiwa | **7,8** | 15  | Profil i konto                 | **7,5** |
| 6   | Wyszukiwarka            | **8,3** | 16  | Społeczność                    | **7,5** |
| 7   | Typy specjalne          | **6,5** | 17  | Analityka i BI                 | **7,5** |
| 8   | SEO / feedy             | **7,5** | 18  | CRM                            | **8,0** |
| 9   | Czat                    | **7,5** | 19  | Ustawienia / multi-tenant      | **7,8** |
| 10  | Sieć                    | **8,0** | 20  | Platforma / backend / SSR      | **7,5** |

**Średnia platformy: ~7,5/10** (werdykt kompozytu z rewizji: **7,0/10** — niżej niż średnia
arytmetyczna, bo ważę w dół obszary z defektami P0 typu „load-bearing martwa ścieżka").

---

# JAK NES WYPADA NA TLE KONKURENCJI

> Metodyka: konkurentów da się ocenić **wyłącznie z zewnątrz**, więc na 9 z 20 modułów (edytor, builder,
> media, realtime, społeczność, analityka, CRM, multi-tenant, backend) mają „**b/d**" — nie „nie mają",
> lecz „brak wglądu". Porównujemy więc uczciwie tylko **11 modułów obserwowalnych**. Dane konkurentów:
> `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md` (stan do poł. 2026). Oceny NES — po rewizji z 30.07.

## Polska (PISM, OSW, Klub Jagielloński, Nowa Konfederacja, INE)

| Moduł obserwowalny      |   NES   | najlepszy PL | przewaga NES |
| ----------------------- | :-----: | :----------: | :----------: |
| Wpisy — czytelnik       | **8,0** |   OSW 5,0    |     +3,0     |
| Strona główna / archiwa | **7,8** |   OSW 4,0    |     +3,8     |
| Wyszukiwarka            | **8,3** |   OSW 2,3    |     +6,0     |
| Typy specjalne          | **6,5** |   OSW 3,0    |     +3,5     |
| SEO / feedy             | **7,5** |   OSW 5,0    |     +2,5     |
| Czat                    | **7,5** |     brak     | kategorialna |
| Sieć                    | **8,0** |     ~0,5     | kategorialna |
| Newsletter              | **6,5** |   OSW 3,0    |     +3,5     |
| Paywall                 | **8,0** |    NK 4,0    |     +4,0     |
| Konwersja               | **6,8** |    NK 3,5    |     +3,3     |
| Profil                  | **7,5** | PISM/OSW 2,3 |     +5,2     |

**Werdykt PL: NES bije każdego polskiego think-tanku we WSZYSTKICH 11 modułach obserwowalnych, zwykle
o 3–6 punktów.** Polska liga to statyczne WordPressy (agregat 1,8–2,4). Żaden nie ma paywalla klasy
produkcyjnej, wyszukiwarki ponad podstawową, czatu, sieci ani profilu użytkownika. **To nie jest ta sama
kategoria produktu.** Nawet po obniżeniu ocen NES w rewizji (np. newsletter 6,5), przewaga jest bezdyskusyjna.

## UE / Europa Zachodnia (ECFR, Bruegel, Chatham House, RUSI, CEPS, SWP)

| Moduł obserwowalny      |   NES   |   najlepszy UE   |   różnica    |
| ----------------------- | :-----: | :--------------: | :----------: |
| Wpisy — czytelnik       | **8,0** | ECFR/Bruegel 6,5 |     +1,5     |
| Strona główna / archiwa | **7,8** | ECFR/Bruegel 6,0 |     +1,8     |
| Wyszukiwarka            | **8,3** |     ECFR 3,8     |     +4,5     |
| Typy specjalne          | **6,5** | ECFR/Bruegel 5,0 |     +1,5     |
| SEO / feedy             | **7,5** | ECFR/Bruegel 6,0 |     +1,5     |
| Czat                    | **7,5** |       brak       | kategorialna |
| Sieć                    | **8,0** |       ~1,0       | kategorialna |
| Newsletter              | **6,5** |     ECFR 4,0     |     +2,5     |
| Paywall                 | **8,0** |     RUSI 6,0     |     +2,0     |
| Konwersja               | **6,8** |   CH/RUSI 6,0    |     +0,8     |
| Profil                  | **7,5** |     ECFR 3,8     |     +3,7     |

**Werdykt UE: NES prowadzi we wszystkich 11 modułach, ale margines się zwęża.** Chatham House i RUSI to
jedyne TT w Europie z **realnym paywallem/członkostwem** (5,5–6,0) i konwersją (6,0) — tu NES ma tylko
+0,8–2,0, a po rewizji (konwersja 6,8 przez pustą wydmuszkę darowizn i martwy runner newslettera) przewaga
jest cieńsza niż deklarowały starsze audyty. ECFR/Bruegel dorównują w microsites/interaktywnych raportach
(moduł 7 = 5,0). **Ale wyszukiwarka, sieć, czat i profil czytelnika pozostają poza ich zasięgiem.**

## Świat — think-tanki USA (Brookings, CSIS, CFR, RAND, Carnegie, Atlantic Council, CNAS)

| Moduł obserwowalny |   NES   |   najlepszy USA    | różnica  |
| ------------------ | :-----: | :----------------: | :------: |
| Wpisy — czytelnik  | **8,0** |      CFR 7,5       |   +0,5   |
| Wyszukiwarka       | **8,3** |    **RAND 5,6**    |   +2,7   |
| Typy specjalne     | **6,5** |    **CSIS 7,0**    | **−0,5** |
| SEO / feedy        | **7,5** | Brookings/CFR 7,5  |   0,0    |
| Paywall            | **8,0** |      CFR 2,0       |   +6,0   |
| Konwersja          | **6,8** | Brookings/CSIS 5,0 |   +1,8   |
| Profil             | **7,5** |   Brookings 4,0    |   +3,5   |

**Werdykt USA: to najlepsze think-tanki świata w treści i storytellingu — i jedyne TT, które biją NES
w pojedynczym module.** CSIS (ChinaPower, Missile Threat) i CFR (trackery) robią **microsites/trackery
klasy 7,0**, wyżej niż NES po rewizji (6,5 — bo nasz tracker nie ma importu, RSS ani działających alertów).
RAND ma najlepszą wyszukiwarkę think-tankową świata (5,6), ale wciąż −2,7 do NES. **Kluczowe: oni budują to
studiami deweloperów, nie self-service** — a paywall (≤2,0), sieć (~1,0) i czat (0) mają śladowe. NES
przegrywa jeden moduł (typy specjalne), wygrywa resztę.

## Świat — media globalne (FT, Bloomberg, Reuters, Economist, Politico, Axios, Euractiv)

| Moduł obserwowalny |   NES   |   najlepsze medium   |   różnica    |
| ------------------ | :-----: | :------------------: | :----------: |
| Wpisy — czytelnik  | **8,0** | **FT/Bloomberg 9,0** |   **−1,0**   |
| Wyszukiwarka       | **8,3** |        FT 4,8        |     +3,5     |
| Typy specjalne     | **6,5** |  **Bloomberg 9,0**   |   **−2,5**   |
| SEO / feedy        | **7,5** |   **Reuters 9,0**    |   **−1,5**   |
| Czat               | **7,5** |         brak         | kategorialna |
| Sieć               | **8,0** |         ~1,0         | kategorialna |
| Newsletter         | **6,5** | **FT/Politico 8,0**  |   **−1,5**   |
| Paywall            | **8,0** |      **FT 9,0**      |   **−1,0**   |
| Konwersja          | **6,8** |      **FT 8,5**      |   **−1,7**   |
| Profil             | **7,5** |        FT 3,7        |     +3,8     |

**Werdykt media: to jedyni realni rywale NES — i jedyni, którzy biją go w kilku modułach naraz.** FT,
Bloomberg i Reuters wygrywają czytanie (9,0), storytelling (Bloomberg Graphics 9,0 — światowy benchmark),
SEO (Reuters 9,0), newsletter (8,0), paywall (FT 9,0) i konwersję (8,5). Po rewizji NES te różnice są
**większe niż sugerowały starsze audyty** — nasz newsletter spadł do 6,5 (rozjechana suppression, martwy
runner), a konwersja do 6,8. **Ale:** media mają wyszukiwarkę o połowę słabszą (max FT 4,8), profil
czytelnika szczątkowy (3,7), a czat i sieć **zerowe**. To firmy z setkami inżynierów robiące jedną rzecz
świetnie — NES robi 20 rzeczy w jednym systemie.

## Azja / Rosja (skrót)

Cyfrowo najsłabsza część stawki międzynarodowej (agregat 1,7–2,9). Jedyny obszar, gdzie zbliżają się do NES,
to **wielojęzyczność** (rosyjskie/japońskie TT prowadzą pełne lustra językowe — Wałdaj/RIAC 7,0–7,5 w
kryterium „języki" vs NES 9,0). Poza tym: zero monetyzacji, wyszukiwarki, społeczności, profilu. NES bije
ich we wszystkich modułach obserwowalnych.

---

# SYNTEZA POZYCJI KONKURENCYJNEJ

**1. Warstwa, na której nie ma z kim się porównać (9 modułów „b/d").** Edytor, builder (100 bloków +
87 widgetów), realtime-infra, analityka BI, CRM, multi-tenant, backend/RLS — żaden think-tank ani serwis
medialny nie wystawia tego publicznie. Dla think-tanku posiadanie własnego CMS + membership + CRM + BI w
jednym systemie jest **ewenementem sektorowym**. To nie „przewaga w module" — to cała warstwa produktu.

**2. Gdzie NES jest bezkonkurencyjny obserwowalnie:** czat (0 u wszystkich 38 konkurentów), sieć/profil
użytkownika (max 3,7 vs 7,5–8,0), wyszukiwarka (max RAND 5,6 / FT 4,8 vs 8,3). To **przewagi kategorialne**,
nie stopniowe.

**3. Gdzie NES realnie przegrywa (po rewizji, uczciwie):**

- **Storytelling/microsites** — Bloomberg Graphics (9,0) i CSIS/CFR trackery (7,0) biją nasz moduł 7 (6,5),
  bo nasz tracker legislacyjny nie ma importu, RSS ani **działających alertów** (choć są w cenniku).
- **Czytanie i SEO** — globalne media (9,0) mają przewagę szlifu, którego serwis 20-modułowy nie dogoni
  bez dedykowanego zespołu redakcyjnego.
- **Newsletter i konwersja** — po rewizji nasze 6,5/6,8 przegrywa z FT (8,0/8,5) i zrównuje się z CH/RUSI;
  to obszar, gdzie **martwe ścieżki (runner, suppression, community-cron) realnie kosztują pozycję**.

**4. Ranking realnych rywali (agregat publiczny):** FT (5,5) > Bloomberg (4,9) > Reuters (4,7) > Economist
(4,4) > Politico (4,2). **Najlepszy think-tank to CSIS/CFR (4,1) — o ~3–4 pkt za NES na modułach publicznych.**

**Konkluzja:** w kategorii **think-tank** NES nie ma realnego rywala — cyfrowo wyprzedza całą ligę PL o
kategorię, UE o wyraźny margines, a najlepsze TT USA o 3–4 punkty (przegrywając tylko storytelling z CSIS).
Realną poprzeczką są **globalne media** (FT/Bloomberg/Reuters), które biją NES w treści, SEO, newsletterze
i paywallu — ale nie mają nic z warstwy społecznościowo-sieciowo-wyszukiwarkowej. **Rewizja z 30.07 nie
zmienia tej mapy — zmienia jej uczciwość:** przewaga jest realna, ale węższa w newsletterze/konwersji/typach
specjalnych niż deklarowały starsze audyty, bo część funkcji jest zbudowana w 90% i niewpięta (P0 z audytu
brutalnego). Po zamknięciu listy P0 NES wraca w okolice 8,0 i odzyskuje deklarowany dystans.

---

_Dokument towarzyszy `AUDYT_BRUTALNY_REWIZJA_ZALOZEN_2026-07-30.md` (rewizja werdyktu 8,0→7,0) i mapuje
oceny funkcji na strukturę konkurencyjną z `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md`. Oceny konkurentów =
stan wiedzy do poł. 2026; „b/d" = brak danych z zewnątrz, nie brak funkcji._
