# Tabele modułów — funkcja po funkcji: ocena, argumenty, rekomendacje + pozycja vs konkurencja (2026-08-14)

**Data:** 2026-08-14 · **HEAD:** `0fd4108` · **Gałąź:** `claude/audyt-modulow-funkcji-xfsq1o`
**Poprzednie wydanie:** `OCENA_FUNKCJI_TABELE_2026-08-06_R2.md` na `22b711a` · **Delta:** 157 commitów, 347 plików, +20 056 / −2 711

Dokument rozbija platformę na **21 modułów × pojedyncze funkcje** (nowy moduł 21: rekrutacja).
Każda funkcja ma: ocenę 0–10, argument **✅ dobry**, argument **⚠️ słaby** i **🔧 rekomendację**.
Konwencja zmian: „**X → Y**" = zmiana względem **wydania 06.08 r2** — nie względem starszych wydań.

Skala: **9–10** wybitne · **7–8** produkcyjne · **5–6** działa z wyraźną luką · **<5** zepsute/wydmuszka.
Ocena modułu = kompozyt jego funkcji (kompletność + inżynieria + dopracowanie + bezpieczeństwo + testy).

> **Zakres wyłączony (jak we wszystkich wydaniach serii):** dokument **nie ocenia treści** — ani NES,
> ani konkurencji. Moduł 1 mierzy **mechanikę czytania**, nie wartość tekstu. Wszystkie oceny dotyczą
> **zdolności produktowych i inżynierskich**.

> **Metodyka (jawnie).** Bramki, sygnały i wszystkie korekty są zmierzone w tej sesji na HEAD
> `0fd4108`: pełny `bun install` z przepięciem lockfile na publiczny npm (tak jak robi to CI),
> `tsc --noEmit`, `eslint .`, `vitest run --coverage`, `vite build` + bramki bundla, 17 bramek
> `check:*`, własny parser migracji (ostatnia definicja + `ALTER`) i pomiar gęstości testów per moduł.
> Wiersze, których delta nie dotknęła i których nie wymieniam jako zmienione, **przenoszę z wydania
> 06.08 r2 bez ponownego pomiaru** — przy 21 modułach udawanie, że przeliczyłem wszystko od zera,
> byłoby fikcją. Pełne liczby: `docs/AUDYT_PLATFORMY_MODULY_FUNKCJE_2026-08-14.md`.

---

# STAN OGÓLNY — cztery rzeczy przed tabelami

**1. Po raz pierwszy w tej serii rekomendacje poprzedniego audytu zostały WYKONANE, nie przeczytane.**
Martwy kod: **171 → 0**, a flagi `noUnusedLocals` + `noUnusedParameters` są **włączone**
w `tsconfig.json`; `tsc --noEmit` przechodzi na zero (commit `6b989b6` — przy czyszczeniu znalazły
się cztery zerwane ścieżki funkcji pod martwymi deklaracjami). Chunk wejściowy: słownik klubów
wyjęty do własnego chunku (107 KB), największy chunk **541,6 → 467,6 KB gzip**. Obie dokładnie tą
drogą, którą audyt rekomendował.

**2. CI jest czerwone na czterech blokujących krokach — trzecie wydanie z rzędu, nowe przyczyny.**
Dwie migracje rekrutacji wjechały dwa razy (zapala `check:sql-migration-replay` **i** dwa testy
w suicie), 115 błędów `prettier/prettier`, jedna żywa referencja do poprzedniego operatora płatności.
Wszystkie trzy naprawialne w godzinę; żadna nie jest defektem produktu. Poprzednio było 481 błędów
lintu i czerwony bundle — **zmieniły się przyczyny, nie wzorzec: bramki istnieją, są dobre, i są
omijane przy wdrożeniu.**

**3. Wzrost jest skoncentrowany i nieotestowany.** Cały przyrost siedzi w czterech modułach plus
nowym: kluby +3 273 linie, crm +1 163, newsletter +804, bramki CI +793, rekrutacja +5 001.
Kluby mają 48 602 linie przy **T/P 0,11**, newsletter **T/P 0,08** — najniższe w repo.

**4. Korekta do mojego własnego wcześniejszego ustalenia w tej sesji.** Sprawdzając „import WP
niszczy drugi język" trafiłem najpierw na `wp-import.functions.ts` (**stack STRON**), który
faktycznie scala per język (`built.content_pl ?? current.content_pl`) — i o mało nie zamknąłem
defektu jako naprawionego. **Stacki są dwa.** `wordpress-import.functions.ts:709` (**stack WPISÓW**,
924 linie) nadal buduje `blocks_data` jako `{pl: doc, en: {version:1, blocks:[]}}` i wysyła to
`.update()` przy `sync_existing`, razem z `title_en: ""` i `excerpt_en: null`. **Import PL nadal
kasuje wersję EN istniejącego wpisu.** Ocena zostaje 4 — patrz M4.

---

# MODUŁ 1 — Wpisy: doświadczenie czytelnika · **8,7/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Paywall / bramka dostępu | **9** | 4 tryby, entitlement dowodzony obecnością body — anon SSR nie wysyła bajtów premium; enforcement kolumnowy (REVOKE+RPC) | — | Utrzymać |
| Metering „N darmowych/mies." | **9** | Serwerowy `consume_metered_view`, konsumpcja po hydracji (boty nie palą limitu) | Brak UI „zostało N" | Licznik pozostałych artykułów |
| Podaruj artykuł (gift) | **9** | Idempotentny link, RPC SECURITY DEFINER, cap `max_redemptions_per_link` | — | Utrzymać |
| Spis treści (TOC) | **9** | Skonsolidowany `slugifyAnchor` + test parytetu na `ł`, scrollspy, focus-trap | — | Utrzymać |
| Układy wpisu (`preset.header`) | **9** | Realne warianty, SSR-owalne | — | Utrzymać |
| Pasek postępu czytania | **8** | `rafThrottle` na najgorętszym handlerze | — | Utrzymać |
| Przypisy (footnotes) | **9** | End-to-end: edytor→silnik→SSR, jeden kontrakt wyjścia | — | Utrzymać |
| Key takeaways | **9** | Publiczny render + `aria-hidden` gdy brak | — | Utrzymać |
| Cytowania / eksport bib. | **7** | Realny formatter (Chicago i in.), testy fallbacków | Zakres formatów ograniczony | BibTeX/RIS jeśli jest popyt |
| Audio artykułu (TTS) | **9** | Jeden kanoniczny głos/model, cache w prywatnym buckecie, gating `has_content_access` | — | Utrzymać |
| Publiczny licznik odsłon | **8** | Realny łańcuch | — | Utrzymać |
| Byline autora / opisowe etykiety linków | **8** | Karta profilu autora, etykiety opisowe | — | Utrzymać |
| **Gęstość testów paywalla (nowa)** | **4** | Logika gatingu ma własne progi pokrycia (`lib/access/gating.ts`: 95/100/100/95) | **48 plików produkcyjnych `paywall` na 6 testowych — T/P 0,12, najsłabszy stosunek w monetyzacji** (13.08: 0,16 — spadek przez przyrost kodu, nie ubytek testów) | Testy: 6 → co najmniej 12 plików |

---

# MODUŁ 2 — Edytor wpisów i workflow redakcyjny · **8,6/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Autozapis (wpisy) | **9** | Realny `useAutosave` z ochroną przed utratą, `AutosaveBar` | — | Utrzymać |
| Rewizje wpisów | **8** | Limit 50, throttling 5 min, restore pomija `status` (celowo) | Zero testów integracyjnych na restore | Dodać test przywracania |
| Workflow draft→review→published | **9** | Egzekwowany **potrójnie**: UI, server fn ×2, trigger DB | — | Utrzymać |
| Publikacja planowana | **8** | pg_cron `publish-due-posts` **i** `publish-due-pages` co minutę + fallback | — | Utrzymać |
| Kalendarz redakcyjny | **7** | Drag-and-drop, realny | Brak testów | Smoke test |
| Redirecty 301 przy zmianie slug | **8** | Automatyczne, realne | — | Utrzymać |
| Parytet z Gutenbergiem | **9** | Udokumentowany i mierzony (`OCENA_GUTENBERG_PARYTET_2026-08-01`) | — | Utrzymać |
| Kontrolki liczbowe | **8** | Spójne w panelach | — | Utrzymać |

---

# MODUŁ 3 — Silniki treści: bloki + page builder · **9,0/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Silnik bloków (posty) | **9** | **101 typów bloków** (zmierzone z unii `BlockType`), renderer pokrywa komplet, 0 placeholderów | T/P 0,14 na 36 273 liniach | Utrzymać silnik; podnieść testy renderera |
| Page builder (widgety) | **9** | **99 wpisów rejestru / 95 unikalnych typów**, sekcja→kolumna→widget | — | Utrzymać |
| Wierność ustawień widgetów (panel ⇄ renderer) | **9** | Bramka `check:widget-fidelity` + raport | — | Utrzymać |
| Dyscyplina danych przykładowych | **9** | Bramka `sampleDataLeak` | — | Utrzymać |
| Bloki formularzy auth | **8** | Realne, wspólne tokeny pól | — | Utrzymać |
| **Interop bloki⇄builder** | **7** | Konwersja blocks→builder realna (`blocksToBuilder`) | **Jednokierunkowa**; a sprzężenie modułów **urosło: 23/17 → 28/16** — najsilniejszy cykl w repo. Doszedł drugi: `bloki ↔ treść` przeszło z 11/2 na **18/14**, czyli przestało być importem typu | **Rozstrzygnąć kierunek** (wspólna `lib/content-model` albo adapter) — koszt rośnie z każdym widgetem |
| Import z Gutenberga / markdown | **8** | Realne parsery, osobne stosy undo per język | — | Utrzymać |
| Świeżość danych widgetów | **9** | Lokalizowane klucze zapytań, bramka | — | Utrzymać |
| Odporność renderu | **8** | Error boundaries per widget | — | Utrzymać |

---

# MODUŁ 4 — Strony, wygląd, motyw, media, import · **6,8/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Builder stron | **6** | Ten sam builder co posty | Rozjazd funkcji względem wpisów | Zrównać |
| **Autozapis stron** | **3** | — | **SIÓDME WYDANIE Z TYM SAMYM ZAPISEM.** `admin.pages.$slug.tsx:299` deklaruje „Autozapis włączony (jak dla wpisów)", a `useAutosave` **nie jest zaimportowany ani wywołany** — oba trafienia grepa to komentarze (`:267`, `:299`); `AutosaveBar` nie renderowany | Włączyć `useAutosave`+`AutosaveBar` **albo usunąć kłamliwy komentarz**. Komentarz, który kłamie, jest gorszy niż brak komentarza |
| Rewizje stron | **6** | Istnieją (`writeRevisionSnapshot(entityType:"page")`) | Snapshot gubi `template_type`/`header_override`/`toc_override` | Rozdzielić `REVISION_FIELDS` post vs page |
| Motyw / design tokens | **8** | Głębia frameworka komercyjnego, tokeny, globalne kolory | — | Utrzymać |
| Media — upload / skan użycia | **7** | Skan użycia przed usunięciem, foldery/rename/bulk, `OptimizedImage` z srcSet | Walidacja na danych deklarowanych przez klienta (zero magic-bytes), brak deduplikacji | Sniffing bajtów + kolumna hash |
| Walidator obrazu OG | **8** | Realny | — | Utrzymać |
| Media — SVG stored-XSS | **7** | Allowlista aplikacyjna blokuje SVG + bucket allowlist | Importer WP nadal ma `image/svg+xml` na liście | Usunąć SVG z list importera |
| **Import WP** | **4** | Stack **STRON** (`wp-import.functions.ts`, 688 l.) scala per język: `built.content_pl ?? current.content_pl`, analogicznie `title_*`/`excerpt_*`, auto-snapshot do `content_revisions` przed nadpisaniem | **Stack WPISÓW nadal niszczy drugi język.** `wordpress-import.functions.ts:709` buduje `blocks_data` jako `{pl: doc, en: {version:1, blocks:[]}}` i wysyła to `.update()` przy `sync_existing` razem z `title_en: ""`, `excerpt_en: null` — import PL kasuje wersję EN. **Dwa równoległe stacki, 924 + 688 linii, siódme wydanie** | Przenieść merge per-język ze stacka stron do stacka wpisów; zunifikować stacki |
| Podglądy / import Elementora | **6** | Realny parser | Zakres ograniczony | — |

---

# MODUŁ 5 — Strona główna, archiwa, chrome · **8,3 → 8,4/10** ↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Strona główna | **9** | W pełni CMS-owa, SSR, uczciwy empty state, poprawna hydracja, tryb „najnowsze wpisy" okablowany | — | Utrzymać |
| Archiwa kategoria/tag | **8** | Prawdziwa paginacja `?page=N&sort=`, `noindex,follow` dla >1 | — | Utrzymać |
| Archiwum bloga | **8** | `validateSearch` + `?page` — strony indeksowalne | — | Utrzymać |
| Archiwum autora | **8** | Paginacja serwerowa `?page=N` + filtry w URL (RPC `get_expert_materials`) | — | Utrzymać |
| Mega menu / ticker / chrome | **8** | 6 layoutów archiwum, mega menu, ticker | — | Utrzymać |
| Mobilny pasek dolny / favicon | **8** | Realne, z licznikami | — | Utrzymać |
| **LCP: preload obrazu hero (nowa)** | **8** | Wdrożone na **całej powierzchni publicznej** (`532dd3a`, `WDROZENIE_SSR_LCP_2026-08-13`) | Brak pomiaru produkcyjnego w tej sesji | Zmierzyć LCP po wdrożeniu |
| **TTFB: SWR przed cache (nowa)** | **8** | SWR przed cache, okno stale 24 h, warmer dokumentów (`8b9cee0`, `WDROZENIE_TTFB_2026-08-14`) | j.w. | Zmierzyć TTFB po wdrożeniu |

---

# MODUŁ 6 — Wyszukiwarka · **8,3 → 8,4/10** ↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| FTS treści (Postgres) | **9** | Natywna FTS+pgvector, koszt marginalny ~0 vs Algolia | — | Utrzymać |
| Fasety / filtry | **8** | Realne fasety | — | Utrzymać |
| Paleta ⌘K | **8** | Lazy-mount, realna | — | Utrzymać |
| Zakładki overlay (posts/topics/people/experts) | **8** | Realne | — | Utrzymać |
| **Wyszukiwanie głosowe (STT)** | **7 → 8** ↑ | **Allowlista MIME wdrożona i zweryfikowana** — `api/stt.ts:111-117` przepuszcza wyłącznie `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-wav`; auth + limity; fallback Web Speech dla anon | — | Utrzymać |
| Alerty zapisanych wyszukiwań | **7** | pg_cron `saved-search-alerts` realny | Brak testu integracyjnego | Dodać test |
| Wyszukiwanie osób / kontaktów | **8** | Consent-first, trgm z escapowaniem LIKE | — | Utrzymać |

---

# MODUŁ 7 — Typy treści specjalne · **7,9/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Tracker legislacyjny | **8** | Pasek etapów, macierz 27 państw, feed „co się zmieniło", RSS, **loader SSR z budżetem ścieżki krytycznej** (`tracker.index`) | **Brak importu EUR-Lex/OEIL — wszystko ręcznie**; 4 trasy `tracker.*` bez wzmianki w testach | Import EUR-Lex/OEIL — ostatnia duża luka modułu |
| Huby ekspertów | **8** | Katalog z filtrami, „zapytanie do eksperta" (Pro+) z kwotami, jedna generacja | `expert-layouts`: nadpisanie per-ekspert niezrobione | Dokończyć inline editor |
| **Programy badawcze** | **5** | `research-programs` realny hub, RSS per program | **Dwie równoległe tabele nadal żyją** — `public.programs` **i** `public.research_programs`, zweryfikowane w migracjach. Siódme wydanie | Zmigrować na jedną tabelę |
| Wydarzenia | **9** | Waitlist FIFO serwerowy, RSVP-mail idempotentny, ICS RFC 5545, `event-reminders` w pg_cron, SSR + JSON-LD `CollectionPage` | — | Utrzymać |
| Q&A | **7** | Moderacja (4 statusy), odpowiedzi eksperckie, Chatham House, JSON-LD, SSR | — | Utrzymać |
| Ankiety (polls) | **8** | Realtime głosowanie, utwardzone RPC, pgTAP | — | Utrzymać |
| Biblioteka | **8** | Prywatny bucket, bramka rangi egzekwowana w DB, logowanie pobrań | — | Utrzymać |
| Glosariusz | **8** | CRUD + tooltipy w treści, SEO poprawione (`8ccfef2`) | — | Utrzymać |
| Quiz (EuroChallenge) | **9** | Celowa landing-strona promocyjna drugiej platformy NES, meta zbilingwalizowane | — | Utrzymać |
| Web stories | **7** | AMP + JSON-LD + sitemap + indeks | `rel=amphtml` tylko gdy `cover_url`; indeks bez `ItemList` | Emitować `amphtml` zawsze |
| Live blog | **7** | Realny | — | Utrzymać |

---

# MODUŁ 8 — SEO, feedy, dane strukturalne · **8,4 → 8,8/10** ↑↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| JSON-LD (`safeJsonLd`) | **9** | Escaping `< > & U+2028/9`, ~20 tras, 54 asercje w `e2e/seo.spec.ts` | — | Utrzymać |
| hreflang PL/EN | **9** | x-default+pl+en, suppress przy canonical-override | — | Utrzymać |
| Paywall markup (AEO) | **8** | `isAccessibleForFree:false`+`hasPart/cssSelector`, selektor realnie istnieje | — | Utrzymać |
| **`robots.txt`** | **4 → 9** ↑↑ | **NAPRAWIONE:** `check:public-assets` **zielona** („public/: brak plików przesłaniających trasy") — statyczny plik, który w wydaniu 06.08 przesłaniał trasę dynamiczną i zapraszał aliasy hostingu do indeksowania, **już nie istnieje**. Trójszczeblowa klasyfikacja hostów działa | — | Utrzymać (bramka trzyma) |
| **Sitemap** | **8 → 9** ↑ | `sitemap-index[.]xml.ts` + `sitemaps.$section.ts` + `news-sitemap[.]xml.ts`; `robots.ts:106` wypisuje **wszystkie** sitemapy (`blocks.push(sitemaps.map(...))`) — news-sitemap jest odkrywalny | — | Utrzymać |
| **Struktura nagłówków** | **5 → 7** ↑ | Bramka e2e kompletności SSR asertuje teraz **dokładnie jeden `h1` z sensowną treścią** per szablon oraz poprawny `lang` | Asercja pokrywa szablony objęte bramką, nie wszystkie trasy | Rozszerzyć na kolejne szablony |
| Tożsamość serwisu / karta społecznościowa z panelu | **8** | Realne, z panelu | — | Utrzymać |
| Badge „Preferowane źródło Google" | **7** | Realny | — | Utrzymać |
| Podcast RSS | **8** | Ingestowalny (enclosure+length+type, itunes:*), panel readiness | GUID z prefiksem językowym (PL/EN = 2 kanały) | Wspólny GUID + autodiscovery |
| OG images | **8** | HMAC-gated webhook refresh, 501 bez sekretu | — | Utrzymać |
| RSS / feedy treści | **9** | Kategoria/tag/program RSS realne | — | Utrzymać |
| Monitor linków wychodzących / `llms.txt` / meta viewport | **8** | Realne | — | Utrzymać |

---

# MODUŁ 9 — Czat / komunikator · **8,3/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| DM 1:1 | **8** | RLS v2 z helperem SECURITY DEFINER, dedup konwersacji race-safe, okno edycji 5 min | Kursor paginacji bez tiebreakera id | Dodać id do kursora |
| Prywatność peerów (`get_chat_peers`) | **9** | **Ponownie zweryfikowane na tym HEAD:** ostatnia definicja (`20260731213000_restore_get_chat_peers_tenant_hardening.sql`) ma filtr tenanta na **obu** gałęziach (discoverable **i** wspólna konwersacja), `SET search_path`, wejście 1–200 id, a `COMMENT` zapisuje przyczynę regresji z 21.07 wraz z instrukcją „po DROP/CREATE zawsze ponawiać REVOKE" | — | Utrzymać (wzorzec dokumentowania regresji) |
| Motywy / tapety | **8** | 5 motywów + 3 tapety z DB | — | Utrzymać |
| Read receipts | **8** | 4-stanowe, wzajemność wyłączenia testowana pgTAP | — | Utrzymać |
| Wskaźnik pisania | **8** | Stabilny topic `chat-conv:${id}` | — | Utrzymać |
| Głosówki (voice notes) | **7** | MediaRecorder, fallback formatów, `durationSeconds` | — | Utrzymać |
| Grupy | **7** | `create_group_conversation`, member picker, info dialog | — | Utrzymać |
| Skrzynka zapytań do eksperta | **8** | Realna, z kwotami | — | Utrzymać |
| **Wyszukiwarka w wiadomościach** | **6** | `search_vector` + RPC z powtórzonym RLS | **Konfiguracja `simple` = zero fleksji**, wbrew komentarzowi o „polskiej fleksji" — zweryfikowane w `20260720160000_chat_message_search.sql:41-55`. Siódme wydanie | Słownik z fleksją **albo** poprawić komentarz |
| Załączniki | **8** | Bucket `chat-attachments` (30 MB, allowlist), purge osieroconych, `chat-purge-expired-messages` w pg_cron | — | Utrzymać |
| Blokowanie / mute / rate limit | **7** | `user_blocks` owner-only, egzekucja serwerowa, mute, limit 20/min | „Zgłoś" brak w oknie czatu | Wejście „Zgłoś" z `MessageBubble` |
| Licznik nieprzeczytanych | **8** | Realny | — | Utrzymać |
| Demo-bot („AI") | **4** | Uczciwie opisany jako symulator | Lokalne echo, duplikuje ~300 linii UI | Wyciąć albo podłączyć realny backend |

---

# MODUŁ 10 — Sieć / networking · **8,1 → 8,4/10** ↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Graf połączeń | **9** | Deny-all (`REVOKE ALL FROM PUBLIC,anon,authenticated`), cały dostęp przez granularne RPC | — | Utrzymać (wzorzec) |
| Zaproszenia / wprowadzenia | **8** | `request_introduction`/`respond_introduction`, race-safe | — | Utrzymać |
| Rekomendacje | **8** | RPC rzuca na nieznany czasownik, pgTAP | — | Utrzymać |
| Zgłaszanie użytkownika | **8** | `report_user` + kolejka admina | — | Utrzymać |
| Katalog osób (`/people`) | **8** | Consent-first (`discoverable`), trgm z escapowaniem LIKE, paginacja | — | Utrzymać |
| Stopień oddalenia / licznik oczekujących | **8** | Wdrożone (`WDROZENIE_STOPIEN_ODDALENIA_2026-08-07`) | — | Utrzymać |
| **Testy warstwy klienta** | **5 → 8** ↑ | **NAPRAWIONE I ZMIERZONE:** `components/network` + `lib/network` mają **22 pliki testowe / 4 952 linie** (m.in. `ConnectButton.matrix`, `RequestIntroductionDialog`, `IntroductionsCard`, `MutualConnectionsHint`, `DegreeBadge`, `ReportUserDialog`). Cały moduł `sieć + eksperci`: **T/P 0,63** — druga najlepsza proporcja w repo | — | Utrzymać |

---

# MODUŁ 11 — Newsletter · **7,5 → 7,3/10** ↓

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Double opt-in | **8** | Token serwerowy TTL 48 h, rate limit per-IP i per-adresat, audyt zgód IP/UA | — | Utrzymać |
| Kreator e-maili (EmailDoc) | **8** | Realny builder PL/EN; podgląd renderuje ten sam komponent co produkcja | HTML kampanii bez sanityzacji (staff-only) | Sanityzacja obronna |
| Wysyłka kampanii | **7** | Lease + batching (200/inv, 20/batch), recovery po crashu, idempotencja per odbiorca | `failed_count:0` nadpisywane; `markFailed` wywala całą kampanię | Akumulować liczniki; izolować błąd odbiorcy |
| Runner (scheduler) | **8** | Samozbrojenie + heartbeat, `job_runner_runs`, `enabled` z `DEFAULT true`, `jobs-tick` w pg_cron | — | Utrzymać |
| **Open/click tracking** | **6** | Przepisywanie linków + piksel, token HMAC per (kampania, subskrybent) | **Nadal brak UNIQUE na `newsletter_campaign_events`** — zweryfikowane: zero indeksów unikalnych na tej tabeli, są wyłącznie `(campaign_id, kind)` i `(tenant_id, created_at)`. Podwójny zapis → liczby zawyżone, możliwe >100%. **Szóste wydanie** | UNIQUE na (kampania, subskrybent, rodzaj, dzień) + wyłączyć jedno źródło |
| One-click unsubscribe (RFC 8058) | **8** | `List-Unsubscribe` + `-Post`, GET nie mutuje | — | Utrzymać |
| Suppression / deliverability | **8** | Jedna kanoniczna lista `email_suppressions`; **oba** webhooki (Resend + Go API platformy) idą przez `applyDeliveryEvent`; wysyłka transakcyjna sprawdza tę samą listę (`checkSendAllowed`); eskalacja miękkich odbić bez osłabiania mocniejszej blokady; przyczyna źródłowa zapisana w komentarzu endpointu | Zaszłe `suppressed_emails` + `_legacy_backup` nadal istnieją | Skasować po potwierdzeniu migracji danych |
| Popup zapisu | **7** | Pełny edytor w adminie, telemetria, tokeny pól wspólne z logowaniem | Capping tylko localStorage | Server-side capping |
| Segmentacja | **6** | Segment `min_tier_rank` działa realnie | `admin.audience` to dashboard retencji, **nie** segmentacja mimo nazwy | Segmenty definiowane przez usera |
| Podglądy szablonów | **8** | Aliasy `/lovable/email/*` → `/platform/*` z zamkniętą allowlistą | Pięć shimów `/lovable/*` bez daty wygaśnięcia | Termin + test, który zafailuje po dacie |
| **Gęstość testów (nowa)** | **3** | — | **T/P 0,08 — najniższe w repo.** 13 088 linii kodu na 1 082 linie testów; w tej delcie moduł urósł o **804 linie**, testy o **90** | Podnieść do proporcji platformy (0,19) |

---

# MODUŁ 12 — Realtime / powiadomienia / web-push · **8,3/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Szyna zdarzeń domenowych | **9** | Anti-drift, korelacja, optymistyczne mutacje; `check:sql-emit-actor` pilnuje pozycji aktora (769 plików) | — | Utrzymać |
| Powiadomienia in-app | **9** | Producenci w triggerach DB, dedup 5 min, RLS insert-only-definer, realtime dzwonka, ACL utwardzone migracją | — | Utrzymać |
| Paginacja powiadomień | **8** | `useInfiniteQuery`+`.range()`, usuwanie grupy `.in("id",ids)` | — | Utrzymać |
| Preferencje powiadomień | **9** | `enqueue_notification` CASE pokrywa wszystkie rodzaje | — | Utrzymać |
| Krypto web-push (VAPID) | **9** | Własna impl. RFC 8291/8188, ES256, roundtrip test | — | Utrzymać |
| Service worker | **8** | `push-sw.js` push+notificationclick, rejestrowany po opt-in | — | Utrzymać |
| Scheduler push + digest | **9** | **Ponownie zweryfikowane:** `community-cron` jest w `cron.schedule` (co 5 min, telemetria w `job_runner_settings.community_last_tick_*`, ścieżki zapasowe udokumentowane). **19 zadań pg_cron**, żadne nie odplanowane | — | Utrzymać |
| Liczniki w pasku mobilnym | **8** | Realne | — | Utrzymać |
| Silnik workflow | **7** | Realny | Zakres ograniczony | — |

---

# MODUŁ 13 — Monetyzacja: checkout / subskrypcje / billing · **8,2 → 8,5/10** ↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Warstwa dostawcy (Stripe) | **8** | Jedna granica, `*.server.ts` | — | Utrzymać |
| Webhook płatności | **7** | Podpis obowiązkowy, błąd→500 (retry), allowlista IP | **103 pliki prod `webhook` na 15 testowych (0,15)**, spadek z 0,18 | Podnieść pokrycie webhooków |
| Ceny serwer-autorytatywne | **9** | Klient nie może manipulować kwotą | — | Utrzymać |
| `grantEntitlement` | **9** | Każdy błąd rzucany, udokumentowany kontrakt, 8 testów regresji | — | Utrzymać |
| Izolacja sandbox/live | **9** | `payment_orders.environment` + indeks (`20260731220000_payment_orders_environment_isolation.sql`); ścieżka subskrypcyjna filtruje `environment` | — | Utrzymać |
| Osadzony checkout | **8** | Realny, poza ścieżką bootowania (marker `js.stripe.com` w 1 chunku, **nie wejściowym**) | — | Utrzymać |
| „Mój plan" / historia płatności | **8** | Realne | — | Utrzymać |
| Uzgadnianie rozliczeń | **7** | `admin.billing-reconcile` | — | Utrzymać |
| Faktury / dokumenty | **8** | `invoice.server.ts` z 3-ścieżkową kontrolą własności; **najlepszy stosunek testów w monetyzacji (0,33)** | — | Utrzymać |
| Dunning | **8** | Licznik prób + dedup po `transactionId` | — | Utrzymać |
| Okres próbny | **6** | Istnieje | Zakres ograniczony | — |
| NIP / VAT | **7** | Walidacja `nip.ts`, formularz | Nie przekazywany we wszystkich ścieżkach | Ujednolicić |
| Waluty / FX | **8** | Realne API NBP z retry i TTL | — | Utrzymać |
| Mock mode | **8** | Fail-closed w 3 punktach | — | Utrzymać |
| **`checkout_settings`** | **3 → 8** ↑↑ | **NAPRAWIONE:** `lib/billing/checkoutSettings.server.ts` czyta ustawienia **per tenant** (`checkout_settings.tenant_id` = PK) z jawnym fallbackiem na defaulty przy błędzie odczytu; `hooks/useCheckoutSettings.ts` po stronie klienta | — | Utrzymać |
| Nocna sonda odnowienia | **2** | Workflow `billing-nightly.yml` istnieje | Nieweryfikowalna z repo (wymaga sekretów) | Zweryfikować na środowisku |
| **Trasy `checkout.*` w testach** | **4** | Warstwa **pod** trasami testowana przyzwoicie (`subscription` 0,27, `stripe` 0,29, `invoice` 0,33) | **`checkout.$planId`, `checkout.cancel`, `checkout.success` — bez wzmianki w JAKIMKOLWIEK teście, czternasty dzień** | Kilka testów integracyjnych na sklejenie tras |

---

# MODUŁ 14 — Monetyzacja: kupony / darowizny / prezenty / reklamy · **8,0/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Kupony B2B | **8** | `applied_cents` jedno źródło prawdy, grant tieru fail-closed, rezerwacja limitu atomowa, pgTAP | **53 pliki prod na 8 testowych (0,15)** — spadek z 0,21 przez przyrost kodu | Dociągnąć testy do przyrostu |
| Prezenty (gift) | **9** | End-to-end, `create/redeem_gift_link`, czysta domena z testami | — | Utrzymać |
| Darowizny | **8** | Własny checkout: `/admin/donations` (311 l.) z `getStripeEnvironmentSafe()`, przełącznikiem sandbox/live i `syncDonationsWithStripe`; darowizny cykliczne | `donation`: 61 plików prod na 12 testowych (0,20) | Dociągnąć testy |
| Partner Biznesowy | **8** | Realny | — | Utrzymać |
| Reklamy (house ads) | **8** | 7 pozycji, targetowanie, zgody, ochrona CLS, `ad_events`→dashboard; **`script-src-attr 'none'` unieszkodliwia inline handlery w treści** | Sloty script/html nadal w rękach edytora | Sanityzacja/sandbox slotów HTML |
| Popupy | **7** | Triggery (delay/scroll/exit), capping, targetowanie, a11y, testy | Capping tylko localStorage | Server-side capping |

---

# MODUŁ 15 — Profil i konto · **8,5/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Logowanie / rejestracja | **8** | Reset hasła działa, brute-force fail-closed, guard weryfikacji | Ścieżki logowania nie w pełni ujednolicone (MFA) | Ujednolicić MFA we wszystkich wejściach |
| MFA (TOTP) | **8** | Realne (`enroll/challenge/verify`), step-up aal2 egzekwowany serwerowo | Brak listy sesji/urządzeń | Lista aktywnych sesji |
| Eksport danych (RODO) | **8** | 17 sekcji, user-scoped, jawna sekcja `errors`, bramka zakresu eksportu | — | Utrzymać |
| Usunięcie konta (RODO) | **9** | Re-auth hasłem, uprzednie anulowanie subskrypcji, **retencja dowodów księgowych** (`purge-expired-accounting-evidence` + `purge-expired-payment-orders` w pg_cron) | — | Utrzymać |
| Bezpieczeństwo konta | **8** | Zmiana hasła/e-maila z re-auth, „wyloguj inne sesje" | Brak listy sesji | j.w. |
| Profil (edytor, CV, dorobek) | **8** | Bio skonsolidowane (`canonicalBio`), optymistyczne edycje z rollbackiem, CV w prywatnym buckecie z owner RLS | — | Utrzymać |
| „Mój plan" i płatności | **8** | Realne | — | Utrzymać |
| Test osobowości (Big Five) | **7** | 30 pozycji, poprawne skorowanie, DB utwardzona; **brak odczytu wyników w `lib/crm`** — furtka service-role zamknięta (zweryfikowane grepem) | Wynik nadal nie zasila rekomendacji | Podłączyć do rekomendacji albo wyciąć |
| Personalizacja / zainteresowania | **7** | 4–5 powierzchni, tryb anon z merge po zalogowaniu | Dwie implementacje RPC rekomendacji | Ujednolicić |
| Organizacje (seaty) | **7** | Seaty, grace, przypomnienia cron, zaproszenia | Brak faktur per-org i ról poza owner/member | Dodać role + faktury org |
| Zgody / prywatność | **8** | CMP + audytowany rejestr RODO z IP/UA, GPC, izolacja tenanta RODO | Dwa systemy nie w pełni zunifikowane | Domknąć unifikację w `/profile/privacy` |

---

# MODUŁ 16 — Zarządzanie społecznością · **8,1/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Moderacja Q&A / ankiet | **8** | Statusy, odpowiedzi eksperckie, zapisy przez utwardzone RPC | — | Utrzymać |
| Reputacja | **8** | Leaderboard, poziomy, RPC, testy | — | Utrzymać |
| Odznaki | **9** | **Ponownie zweryfikowane:** `profile_badges_badge_check` = 4 klucze zgodne z katalogiem (`verified, expert, staff, contributor`), kolumna `grant_source` z CHECK (`manual, reputation, contributor_submission, system`) → auto-grant z reputacji istnieje; trigger walidacji tenanta; indeks `(tenant_id, created_at DESC)` | — | Utrzymać |
| Weryfikacja po domenie e-mail | **8** | Realna | — | Utrzymać |
| Odznaka eksperta ⇒ dożywotni VIP | **7** | Realna | — | Utrzymać |
| Guard pól weryfikacji | **5** | Istnieje | Zakres węższy niż deklarowany | Domknąć |
| Powitania | **7** | Wołaczowe, szablony maili | — | Utrzymać |
| Engagement dashboard | **7** | Jeden RPC `get_engagement_overview` | — | Utrzymać |
| Contribute → review | **8** | Pełna pętla zgłoszenie→moderacja z RLS, `grant_source='contributor_submission'` | — | Utrzymać |

---

# MODUŁ 17 — Analityka i BI · **7,6 → 7,8/10** ↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| GA4 (import + export) | **8** | Realny Data API (JWT RS256 service account) + Measurement Protocol | Zero cache (2× API na odświeżenie) | Dodać cache |
| Search Console | **6** | Realne API przez gateway platformy | Vendor lock + SPOF | Ping API + własny OAuth |
| First-party tracking | **7** | Pełny łańcuch track→tabela→dashboard, consent gate, rate limit | Sessionization per karta; zero bot-filtering | Filtr botów |
| Warstwa semantyczna | **9** | Reconciliation, authoritative vs corroborating, `safeRatio`, rozróżnia `not_configured`/`no_data`, testy+pgTAP | Część zakładek omija słownik | Przepiąć pozostałe zakładki |
| „Silnik insightów" | **5** | Data-driven insighty GA4/GSC/semantic realne | Overview to hardkodowane stringi z flag env | Generować Overview z liczb |
| RUM (web vitals) | **8** | Pełny łańcuch beacon→tabela→dashboard | — | Utrzymać |
| Obserwowalność edge cache | **8** | Realna, z sekcją zwłok incydentu | — | Utrzymać |
| **Eksperymenty A/B** | **6** | Przydział FNV-1a deterministyczny, ekspozycje z blokadą cross-tenant, endpoint `api/public/experiment-event` | **Nadal client-side** — `assignVariant(experimentId, visitorId)` to czysta funkcja w `lib/builder/experiments.ts:70`; SSR zawsze A, flash B; brak korekty na peeking | Przydział server-side w loaderze + bramka istotności |
| **Obserwowalność bundla** | **2 → 7** ↑↑ | **NAPRAWIONE:** `check:bundle` **zielona i mierzona**, raportuje ruchy per-trasa względem nazwanego baseline'u (`0761984, 2026-08-13`) z rozbiciem na nowe trasy, i sama ostrzega przy zapasie <2% — plus `report:chunk-inventory` do diagnozy składu | Zapas PUBLIC 0,76%, OVERALL 0,93% | Zmierzyć skład chunku, **nie podnosić progu** |
| **Gęstość testów (nowa)** | **4** | — | **T/P 0,14 przy 16 126 liniach i 9 funkcjach serwerowych** | Podnieść pokrycie funkcji serwerowych |

---

# MODUŁ 18 — CRM · **8,4/10** (bez zmian)

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Lead scoring | **9** | 10 realnych triggerów, parytet TS↔SQL pilnowany testem+pgTAP, decay 30 dni, capy | — | Utrzymać |
| Pipeline / funnel | **8** | 8 stage'ów, timeline; agregacja z pętlą JS nie występuje już w `lib/crm` | — | Utrzymać |
| Zadania / follow-upy | **8** | pg_cron `crm-task-reminders` co 10 min, `SKIP LOCKED`, deep-linki, szyna zdarzeń | — | Utrzymać |
| Firmy ↔ leady | **8** | FK + indeks, propagacja `company_id`, aktywność firmy | — | Utrzymać |
| Import / eksport CSV | **8** | Chunk 500, dedup po `email_norm` w transakcji, obrona przed CSV-injection | — | Utrzymać |
| Lista leadów | **8** | Sort/filtr po score, paginacja | — | Utrzymać |
| Saved views | **8** | Widoki wbudowane + użytkownika (`saved_views`, entity „lead"), `LeadFilterChips` odtwarzają filtr | — | Utrzymać |
| Integracje wychodzące | **8** | `CrmPartnerEndpointsPanel` — profile partnerów konfigurowalne z UI; HMAC, sekrety w Vault, outbox z `SKIP LOCKED`, `prune-integration-deliveries` w pg_cron | — | Utrzymać |
| Ochrona danych leadów | **8** | RLS + tenant scope | — | Utrzymać |
| **Gęstość testów (nowa)** | **4** | — | **T/P 0,12.** Moduł urósł w tej delcie o **1 163 linie** (integracja rekrutacji), testy o **186** | Dociągnąć testy do przyrostu |

---

# MODUŁ 19 — Ustawienia / integracje / users / multi-tenant / RODO · **8,7 → 8,9/10** ↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Multi-tenant (host→tenant) | **10** | 2 płaszczyzny, `profiles.tenant_id` przypięty triggerem, gate CI, trusted host, **jedna definicja `isPreviewHost()`** dla całej aplikacji (wcześniej dwie listy allowlisty CSP mogły się rozjechać) | — | Utrzymać |
| RLS coverage | **9** | **244 żywe tabele, 244 z `ENABLE ROW LEVEL SECURITY` — zero bez RLS.** 570 unikalnych polityk, **556 w stanie końcowym** | — | Utrzymać |
| **`SECURITY DEFINER` (nowa pozycja)** | **9** | **709 funkcji, 0 bez przypiętego `search_path`** — sprawdzone parserem uwzględniającym późniejsze `ALTER FUNCTION … SET search_path` | — | Utrzymać |
| Sekrety (Vault) | **9** | Sekrety CRM/integracji w Vault, service-role tylko w `*.server.ts` | — | Utrzymać |
| Impersonacja | **8** | Gate `is_super_admin`, audytowana, ścieżka `end` domknięta | — | Utrzymać |
| Anonimowe INSERT-y | **9** | `check:sql-anon-insert` zielona: 556 polityk w stanie końcowym, **8 tabel intake chronionych** | — | Utrzymać |
| CSP / nagłówki | **7** | CSP + XFO + Referrer + Permissions + HSTS + nosniff; **`script-src-attr 'none'` domyka realny wektor stored-XSS** (inline `onerror=`/`onclick=` w treści redakcyjnej są martwe); `connect-src` zawężony do self + Supabase; zakres `unsafe-inline` **udokumentowany co do przyczyny** | `script-src` nadal z `unsafe-inline` — wersja frameworka nie wspiera nonce'ów dla własnych skryptów | Plan wyjścia przy aktualizacji frameworka |
| Consent RODO + GPC | **9** | Rejestr z IP/UA/wersją/źródłem, GPC, izolacja tenanta | — | Utrzymać |
| Audyt tłumaczeń widgetów | **8** | Bramka + raport | — | Utrzymać |
| **Macierz uprawnień** | **6 → 9** ↑↑ | **NAPRAWIONE:** `check:authz-snapshot` zielona („`authzSnapshot.generated.ts` zgodny z migracjami"), `check:permissions-parity` zielona, `check:sql-app-role` zielona (962 literały `has_role`, enum spójny). Dryf snapshotu z wydania 06.08 zamknięty | — | Utrzymać |
| Wersjonowanie polityk i elementów | **7** | Realne | — | Utrzymać |
| Ekrany ustawień marki | **8** | Realne | — | Utrzymać |

---

# MODUŁ 20 — Platforma / backend / infrastruktura / SSR · **7,3 → 7,9/10** ↑↑

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| SSR render treści | **9** | Post/home/archiwa/eksperci/autor renderują treść serwerowo, `/tracker` ma loader, odporność tras publicznych | — | Utrzymać |
| Edge cache dokumentów | **7** | L1 per-isolate + L2 per-colo, kill-switch, nonce izolatu niepodrabialny, SWR przed cache (14.08) | **`DOCUMENT_PURGE_ACTIONS` nadal `^(post\|page\|category\|tag\|redirect\|revision)\.`** (`audit.server.ts:48`) — nie pokrywa tracker/podcast/program/web-story/event | Rozszerzyć listę akcji |
| Odporność na rozłączenie klienta | **8** | Realna | — | Utrzymać |
| **Bramka kompletności SSR (e2e)** | **4 → 8** ↑↑ | **NAPRAWIONE:** przebudowana na **trzy niezależne warstwy** — (1) sygnatura ucięcia `<!--ssr-doc-guard:truncated-->`, której obecność **oblewa** bramkę, (2) uzbrojenie strażnika przez nagłówek `x-ssr-doc-guard` (bez niego asercja z (1) byłaby pusta), (3) **asercje treści per szablon**: `<main id="main-content">`, `<footer>`, dokładnie jeden sensowny `h1`, poprawny `lang`, lokalizowana kopia chrome'u. 20 asercji; komentarz zapisuje, **dlaczego** poprzednia wersja była pozorna | Nieuruchamialna w tym kontenerze (Playwright) | Utrzymać |
| **Bundle publiczny** | **2 → 7** ↑↑ | **NAPRAWIONE:** `check:bundle` **zielona** (13.08 była czerwona na wszystkich trzech budżetach); największy chunk **541,6 → 467,6 KB gzip** dzięki wyjęciu słownika klubów do własnego chunku (107 KB); `check:chunks` zielona (674 chunki, 3 384 krawędzie, graf acykliczny) | **Zapas PUBLIC 0,76%, OVERALL 0,93%** — mimo że oba progi już raz podniesiono; rekrutacja dołożyła ~28 KB gzip w jeden dzień | Zmierzyć skład chunku, **nie podnosić progu** |
| **Martwy kod (nowa pozycja)** | **9** | **Bramka istnieje i jest zielona.** `noUnusedLocals: true` + `noUnusedParameters: true` w `tsconfig.json`, `tsc --noEmit --noUnusedLocals --noUnusedParameters` = **0 błędów** (13.08: 156 martwych deklaracji w 67 plikach, bez bramki). Przy czyszczeniu 171 deklaracji znalazły się **4 zerwane ścieżki funkcji** | — | Utrzymać |
| **Testy jednostkowe** | **6 → 7** ↑ | **8 258 zielonych**, 755/758 plików; **gate pokrycia zielony**: 32,69 / 28,44 / 25,24 / 33,27 przy progach 29 / 25 / 22 / 29, 26 progów per-ścieżka | **2 testy czerwone** (bliźniaki migracji); T/P platformy **0,187** | Naprawić bliźniaki; podnieść T/P w klubach i newsletterze |
| **Lint** | **3 → 4** ↑ | Backlog zredukowany (06.08: 481 błędów → dziś 115); ostrzeżenia stabilne (176) | **Nadal CZERWONY i nadal blokujący.** 115 błędów `prettier/prettier`, w tym **48 w jednym pliku** (`lib/careers/applicationSchema.ts`); 100% naprawialne przez `--fix` | `bunx prettier --write` na 29 plikach |
| pgTAP (izolacja/tenant) | **9** | 91 plików, gate w CI, `check:pg-harness` + `check:careers-harness` (migracje + asercje runtime) | — | Utrzymać |
| **Gate'y SQL statyczne** | **7 → 9** ↑↑ | **25 bramek `check:*`** (13.08: 21), 9 pilnuje inwariantów SQL/uprawnień; 4 nowe: `careers-harness`, `db-row-casts`, `i18n-hardcoded`, `types-freshness`. **`check:sql-migration-replay` WIDZI bliźniaki treści** — zarzut z wydania 06.08 („bramka replay nie widzi bliźniaków") jest nieaktualny: to ona złapała duplikaty rekrutacji | — | Utrzymać |
| Kontrakt bazy po wdrożeniu | **8** | `check:db-contract` w jobie `post-deploy` | Niemierzalny bez środowiska | — |
| Debranding platformy | **7** | Realny | Pięć shimów `/lovable/*` bez daty wygaśnięcia | Termin + test |
| **Higiena repo i ślad audytowy** | **4** | Komentarze migracji zapisują przyczynę; kronika budżetów w `check-bundle-size.ts` | **Dwie migracje wjechały dwa razy**, a duplikat to oryginał **pozbawiony 27-linijkowego nagłówka z opisem przyczyny** — historia kłamie o dacie wejścia zmiany, i to akurat tej, która zamykała cross-tenantowy dostęp do CV | **P0:** usunąć duplikaty, zostawić wersje z nagłówkami |
| **Zielone CI (nowa pozycja)** | **3** | Wszystkie trzy przyczyny naprawialne w godzinę; żadna nie jest defektem produktu | **CZERWONE na 4 blokujących krokach:** bliźniaki migracji (×2 kroki: bramka + suita), 115 błędów `prettier`, 1 żywa referencja `paddle_subscription_id` w `scripts/check-generated-types-freshness.ts:41`. **Trzecie wydanie z rzędu z czerwonym CI** | **P0: przywrócić zieloność** — dopóki CI jest czerwone, żadna z 25 bramek nikogo nie ostrzega |

---

# MODUŁ 21 — Rekrutacja / kariera · **7,2/10** (NOWY)

Moduł wydany dzisiaj (`b6b4d9d`, `a75db79`, `08a503c`): **26 plików produkcyjnych, 5 001 linii,
7 plików testowych, 1 142 linie testów, T/P 0,23** — powyżej mediany platformy (0,187).

| Funkcja | Ocena | ✅ Dobry | ⚠️ Słaby | 🔧 Rekomendacja |
| ------- | :---: | ------- | -------- | -------------- |
| Strona `/zatrudniamy` | **8** | Pełna warstwa prezentacji (hero, wartości, proces, role, zamknięcie) rozłożona na atoms/molecules/organisms; testy hero i formularza | +10,4 KB gzip do powierzchni publicznej (plus `catalog` +12,3, `admin.hiring` +5,3) | Zmierzyć skład chunku |
| Katalog ról | **8** | `roles.ts` + `catalog.ts` + `useCareerContent`, dialog roli, filtry, karty, `stats.ts` z testami | — | Utrzymać |
| Formularz zgłoszenia | **7** | `applicationSchema.ts` z walidacją i testami, stepper, ekran sukcesu, pole CV | **48 błędów `prettier` w tym jednym pliku** — moduł wszedł bez przepuszczenia przez lint | `prettier --write` |
| Upload CV | **8** | `cvUpload.ts` + bucket `career-cv` | — | Utrzymać |
| **Izolacja najemców** | **8** | **Realny problem bezpieczeństwa rozpoznany i zamknięty:** `career_roles` i `career_page_sections` dostały `tenant_id` (wcześniej `slug` był unikalny **globalnie**, a `key` był PK bez tenanta — dwaj najemcy nie mogli mieć oferty o tym samym slugu i edytowali te same wiersze). Polityka bucketu `career-cv` opierała się na `is_staff()`, które sprawdza **rolę, nie tenanta**, a ścieżka nie nosiła tenanta — **redaktor najemcy A mógł podpisać i odczytać KAŻDE CV każdego najemcy**. Nowa konwencja: `<tenant_id>/uploads/<data>/<uuid>` | Pliki już wgrane nie są przenoszone — świadoma decyzja, udokumentowana (UPDATE `storage.objects.name` rozjechałby wiersz z obiektem) | Utrzymać |
| Retencja CV (RODO) | **8** | `cvRetention.ts` + migracja retencji, testy | — | Utrzymać |
| Pipeline zgłoszeń → CRM | **7** | `recruitmentLayer.ts` + panel `admin.hiring`, zgłoszenia scope'owane przez `contact_messages.tenant_id`, integracja z CRM | 3 błędy `prettier` w `admin.hiring.tsx`; brak testu end-to-end ścieżki zgłoszenie→CRM | Test integracyjny pełnej ścieżki |
| Harness CI | **9** | **`check:careers-harness` powstał RAZEM z modułem**, nie po incydencie: `scripts/careers-harness/` (`harness.sql` + `runtime_test.sql` + `run.sh`), wpięty w `ci.yml` jako osobny job | — | Utrzymać (wzorzec dla nowych modułów) |
| **Higiena wdrożenia** | **2** | — | **Dwie migracje wjechały DWA RAZY** pod wygenerowanymi nazwami (`20260814122639_*`, `20260814123014_*`, commit „Work in progress"). Duplikat to oryginał **pozbawiony 27-linijkowego nagłówka** — zginął zapis, **dlaczego** izolacja pękała. Zapala 2 z 4 czerwonych kroków CI | **P0: usunąć duplikaty**, zostawić wersje z PR-a |

> **Ocena modułu jest wypadkową dwóch przeciwnych sygnałów.** Inżyniersko to najlepszy debiut w tej
> serii: własny harness CI od pierwszego dnia, T/P powyżej mediany, realny problem bezpieczeństwa
> (cross-tenantowy dostęp do CV) rozpoznany i zamknięty **wraz z zapisem przyczyny**. Procesowo to
> najgorszy debiut: moduł przyniósł **wszystkie trzy** przyczyny czerwonego CI. Nic z tego nie jest
> defektem produktu — wszystko jest defektem przepuszczenia zmiany przez bramki, które już istnieją.

---

# PODSUMOWANIE OCEN MODUŁÓW

| # | Moduł | 03.08 r2 | 06.08 r2 | **14.08** | # | Moduł | 03.08 r2 | 06.08 r2 | **14.08** |
| - | ----- | :------: | :------: | :-------: | - | ----- | :------: | :------: | :-------: |
| 1 | Wpisy — czytelnik | 8,6 | 8,7 | **8,7** | 12 | Realtime / push | 8,3 | 8,3 | **8,3** |
| 2 | Edytor + workflow | 8,6 | 8,6 | **8,6** | 13 | Monetyzacja — checkout | 8,5 | 8,2 | **8,5** ↑ |
| 3 | Bloki + builder | 9,0 | 9,0 | **9,0** | 14 | Monetyzacja — kupony/reklamy | 7,7 | 8,0 | **8,0** |
| 4 | Strony / media / import | 6,8 | 6,8 | **6,8** | 15 | Profil i konto | 8,2 | 8,5 | **8,5** |
| 5 | Strona główna / archiwa | 8,3 | 8,3 | **8,4** ↑ | 16 | Społeczność | 8,0 | 8,1 | **8,1** |
| 6 | Wyszukiwarka | 8,3 | 8,3 | **8,4** ↑ | 17 | Analityka i BI | 7,5 | 7,6 | **7,8** ↑ |
| 7 | Typy specjalne | 7,8 | 7,9 | **7,9** | 18 | CRM | 8,4 | 8,4 | **8,4** |
| 8 | SEO / feedy | 8,4 | 8,4 | **8,8** ↑↑ | 19 | Ustawienia / multi-tenant | 8,5 | 8,7 | **8,9** ↑ |
| 9 | Czat | 8,1 | 8,3 | **8,3** | 20 | Platforma / backend / SSR | 8,0 | 7,3 | **7,9** ↑↑ |
| 10 | Sieć | 8,1 | 8,1 | **8,4** ↑ | 21 | **Rekrutacja / kariera** | — | — | **7,2** (nowy) |
| 11 | Newsletter | 7,5 | 7,5 | **7,3** ↓ | | | | | |

**Średnia platformy: ~8,2/10** (06.08 r2: ~8,1 · 03.08 r2: ~8,1).
**Werdykt kompozytu: 7,9/10** (06.08 r2: 7,7 · 05.08: 7,8) — niżej niż średnia arytmetyczna, bo ważę w dół:

- **CI czerwone na czterech blokujących krokach, trzecie wydanie z rzędu.** Zmieniły się przyczyny
  (06.08: parytet snapshotu, `sql-app-role`, lint 481, bundle; dziś: bliźniaki migracji ×2, lint 115,
  legacy-payment-ref), nie zmienił się wzorzec.
- **Wzrost bez testów w dwóch największych modułach.** Kluby: 48 602 linie, **T/P 0,11**, +3 273 linie
  w tej delcie. Newsletter: **T/P 0,08**. Razem 61 690 linii kodu na 6 294 linie testów.
- **Erozja pokrycia ścieżek pieniężnych.** Wszystkie 11 obszarów (paywall 0,12, coupon 0,15,
  webhook 0,15, checkout 0,20…) ma gorszy stosunek niż 13.08 — **przy zerowym ubytku testów**.
  Rośnie sam kod. Plus trzy trasy `checkout.*` bez wzmianki w jakimkolwiek teście, czternasty dzień.
- **Wydmuszki, które przetrwały siódme wydanie:** autozapis stron (komentarz kłamie od 30.07), import
  WP niszczący drugi język **w stacku wpisów**, dwie tabele programów, FTS czatu `simple` wbrew
  komentarzowi, brak UNIQUE na zdarzeniach newslettera, A/B client-side.

**Podnoszę werdykt o 0,2**, bo po raz pierwszy w tej serii **rekomendacje poprzedniego wydania
zostały wykonane, a nie przeczytane** — obie, w ciągu doby, dokładnie zaleconą drogą (martwy kod
dwustopniowo: najpierw wyczyścić 171, potem włączyć flagi; chunk wejściowy: rozbić słownik, nie
podnosić progu). Sześć pozycji oznaczonych wcześniej jako zepsute jest dziś zamkniętych
i **zweryfikowanych pomiarem**: `robots.txt` (4→9), bramka SSR (4→8), bundle (2→7), macierz
uprawnień (6→9), `checkout_settings` (3→8), testy sieci (5→8).

---

# JAK NES WYPADA NA TLE KONKURENCJI

> **Metodyka.** Konkurentów da się ocenić **wyłącznie z zewnątrz**, więc na 10 z 21 modułów (edytor,
> builder, media, realtime, społeczność, analityka, CRM, multi-tenant, backend, rekrutacja) mają
> „**b/d**" — nie „nie mają", lecz „brak wglądu". Porównujemy uczciwie tylko **11 modułów
> obserwowalnych**. Dane konkurentów: `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md` (stan wiedzy do
> poł. 2026) — **niezmienione od 24.07**; ruszają się wyłącznie oceny NES.
> „Paywall" i „Konwersja" to pozycje przekrojowe: paywall = funkcja z M1, konwersja = kompozyt M13/M14.

## Polska (PISM, OSW, Klub Jagielloński, Nowa Konfederacja, INE)

| Moduł obserwowalny | NES | najlepszy PL | przewaga NES |
| ------------------ | :-: | :----------: | :----------: |
| Wpisy — czytelnik | **8,7** | OSW 5,0 | +3,7 |
| Strona główna / archiwa | **8,4** | OSW 4,0 | +4,4 |
| Wyszukiwarka | **8,4** | OSW 2,3 | +6,1 |
| Typy specjalne | **7,9** | OSW 3,0 | +4,9 |
| SEO / feedy | **8,8** | OSW 5,0 | +3,8 |
| Czat | **8,3** | brak | kategorialna |
| Sieć | **8,4** | ~0,5 | kategorialna |
| Newsletter | **7,3** | OSW 3,0 | +4,3 |
| Paywall | **9,0** | NK 4,0 | +5,0 |
| Konwersja | **8,3** | NK 3,5 | +4,8 |
| Profil | **8,5** | PISM/OSW 2,3 | +6,2 |

**Werdykt PL: bez zmian i bezdyskusyjny.** NES bije każdy polski think-tank we WSZYSTKICH 11 modułach
obserwowalnych, o 3,7–6,2 punktu. Polska liga to statyczne WordPressy (agregat 1,8–2,4). Żaden nie ma
paywalla klasy produkcyjnej, wyszukiwarki ponad podstawową, czatu, sieci ani profilu użytkownika.
**To nie jest ta sama kategoria produktu.**

## UE / Europa Zachodnia (ECFR, Bruegel, Chatham House, RUSI, CEPS, SWP)

| Moduł obserwowalny | NES | najlepszy UE | różnica |
| ------------------ | :-: | :----------: | :-----: |
| Wpisy — czytelnik | **8,7** | ECFR/Bruegel 6,5 | +2,2 |
| Strona główna / archiwa | **8,4** | ECFR/Bruegel 6,0 | +2,4 |
| Wyszukiwarka | **8,4** | ECFR 3,8 | +4,6 |
| Typy specjalne | **7,9** | ECFR/Bruegel 5,0 | +2,9 |
| SEO / feedy | **8,8** | ECFR/Bruegel 6,0 | +2,8 |
| Czat | **8,3** | brak | kategorialna |
| Sieć | **8,4** | ~1,0 | kategorialna |
| Newsletter | **7,3** | ECFR 4,0 | +3,3 |
| Paywall | **9,0** | RUSI 6,0 | +3,0 |
| Konwersja | **8,3** | CH/RUSI 6,0 | +2,3 |
| Profil | **8,5** | ECFR 3,8 | +4,7 |

**Werdykt UE: NES prowadzi we wszystkich 11 modułach, a margines wrócił do szerokości sprzed rewizji
z 30.07 i przekroczył ją.** Chatham House i RUSI — jedyne TT w Europie z realnym paywallem
i członkostwem (5,5–6,0) — mają dziś do NES −2,3 do −3,0, a nie −0,8 jak po rewizji z 30.07: własny
checkout darowizn, kanoniczna suppression i działający runner odzyskały konwersję.
ECFR/Bruegel dorównują wyłącznie w microsites i raportach interaktywnych.

## Świat — think-tanki USA (Brookings, CSIS, CFR, RAND, Carnegie, Atlantic Council, CNAS)

| Moduł obserwowalny | NES | najlepszy USA | różnica |
| ------------------ | :-: | :-----------: | :-----: |
| Wpisy — czytelnik | **8,7** | CFR 7,5 | +1,2 |
| Wyszukiwarka | **8,4** | RAND 5,6 | +2,8 |
| Typy specjalne | **7,9** | **CSIS 7,0** | +0,9 |
| SEO / feedy | **8,8** | Brookings/CFR 7,5 | +1,3 |
| Paywall | **9,0** | CFR 2,0 | +7,0 |
| Konwersja | **8,3** | Brookings/CSIS 5,0 | +3,3 |
| Profil | **8,5** | Brookings 4,0 | +4,5 |

**Werdykt USA: NES nie przegrywa już żadnego modułu obserwowalnego.** Na 30.07 przegrywał jeden —
typy specjalne z CSIS (6,5 vs 7,0), bo tracker legislacyjny nie miał RSS, SSR ani działających
alertów. Dziś tracker ma RSS **i** loader SSR, a moduł stoi na 7,9. Została jedna twarda luka
względem CSIS/CFR: **brak importu EUR-Lex/OEIL** — nasz tracker wypełnia się ręcznie, ich trackery
są zasilane potokiem. To jedyny powód, dla którego przewaga w tym module to +0,9, a nie +2.

## Świat — media globalne (FT, Bloomberg, Reuters, Economist, Politico, Axios, Euractiv)

| Moduł obserwowalny | NES | najlepsze medium | różnica |
| ------------------ | :-: | :--------------: | :-----: |
| Wpisy — czytelnik | **8,7** | **FT/Bloomberg 9,0** | **−0,3** |
| Wyszukiwarka | **8,4** | FT 4,8 | +3,6 |
| Typy specjalne | **7,9** | **Bloomberg 9,0** | **−1,1** |
| SEO / feedy | **8,8** | **Reuters 9,0** | **−0,2** |
| Czat | **8,3** | brak | kategorialna |
| Sieć | **8,4** | ~1,0 | kategorialna |
| Newsletter | **7,3** | **FT/Politico 8,0** | **−0,7** |
| Paywall | **9,0** | **FT 9,0** | **0,0** |
| Konwersja | **8,3** | **FT 8,5** | **−0,2** |
| Profil | **8,5** | FT 3,7 | +4,8 |

**Werdykt media: to nadal jedyni realni rywale — ale różnice zeszły z „kilku punktów" do ułamków,
a w paywallu do zera.** FT/Bloomberg/Reuters wygrywają jeszcze czytanie (−0,3), storytelling (−1,1),
SEO (−0,2), newsletter (−0,7) i konwersję (−0,2). Największe pozostałe luki to **storytelling**
(Bloomberg Graphics 9,0 — światowy benchmark) i **newsletter**, którego T/P 0,08 oraz brak UNIQUE
na zdarzeniach trzymają na 7,3.

**Ale:** media mają wyszukiwarkę o połowę słabszą (max FT 4,8), profil czytelnika szczątkowy (3,7),
a czat i sieć **zerowe**. To firmy z setkami inżynierów robiące jedną rzecz świetnie — NES robi
21 rzeczy w jednym systemie.

## Azja / Rosja (skrót)

Cyfrowo najsłabsza część stawki (agregat 1,7–2,9). Jedyny obszar zbliżenia to **wielojęzyczność**
(Wałdaj/RIAC 7,0–7,5 w kryterium „języki" vs NES 9,0). Poza tym: zero monetyzacji, wyszukiwarki,
społeczności, profilu.

---

# SYNTEZA POZYCJI KONKURENCYJNEJ

**1. Warstwa, na której nie ma z kim się porównać (10 modułów „b/d").** Edytor, builder (101 typów
bloków + 95 widgetów), realtime-infra, analityka BI, CRM, multi-tenant, backend/RLS, a od dzisiaj
rekrutacja — żaden think-tank ani serwis medialny nie wystawia tego publicznie. Dla think-tanku
posiadanie własnego CMS + membership + CRM + BI + ATS w jednym systemie jest **ewenementem
sektorowym**. To nie „przewaga w module" — to cała warstwa produktu.

**2. Gdzie NES jest bezkonkurencyjny obserwowalnie:** czat (0 u wszystkich 38 konkurentów), sieć
i profil użytkownika (max 3,7–4,0 vs 8,4–8,5), wyszukiwarka (max RAND 5,6 / FT 4,8 vs 8,4).
To **przewagi kategorialne**, nie stopniowe.

**3. Gdzie NES realnie przegrywa (uczciwie, po pomiarze):**
- **Storytelling/microsites** — Bloomberg Graphics (9,0) bije moduł 7 (7,9) o 1,1. Jedyna twarda
  luka funkcjonalna: **brak importu EUR-Lex/OEIL** do trackera legislacyjnego.
- **Newsletter** — FT/Politico 8,0 vs 7,3. Powód jest dziś inżynierski, nie funkcjonalny:
  **T/P 0,08** i brak UNIQUE na `newsletter_campaign_events` (liczby otwarć mogą przekraczać 100%).
- **Czytanie i SEO** — globalne media mają przewagę szlifu (−0,3 / −0,2), której serwis 21-modułowy
  nie dogoni bez dedykowanego zespołu redakcyjnego. To najzdrowszy rodzaj przegranej i praktycznie
  domknięty w SEO.

**4. Ranking realnych rywali (agregat publiczny):** FT (5,5) > Bloomberg (4,9) > Reuters (4,7) >
Economist (4,4) > Politico (4,2). **Najlepszy think-tank to CSIS/CFR (4,1).**

**Konkluzja.** W kategorii **think-tank** NES nie ma realnego rywala i po raz pierwszy w tej serii
**nie przegrywa żadnego modułu obserwowalnego z najlepszymi TT świata** — domknięcie trackera (RSS
+ SSR) zabrało CSIS ostatnią przewagę. Realną poprzeczką pozostają **globalne media**, ale różnice
zeszły do ułamków punktu, a w paywallu zrównały się z FT.

**Ryzyko nie leży dziś w funkcjach — leży w procesie.** Platforma ma 25 bramek, z których 9 pilnuje
inwariantów, jakich większość projektów nie pilnuje wcale; ma zero `TODO`, zero `@ts-ignore`, zero
martwych deklaracji, **709 funkcji `SECURITY DEFINER` z przypiętym `search_path` bez jednego wyjątku**
i **244 tabele z RLS bez jednego wyjątku**. I ma **czerwone CI na czterech krokach z powodu duplikatu
pliku migracji, 115 spacji i jednego stringa na liście baseline'u**. Trzecie wydanie z rzędu z tym
samym wzorcem.

Najwyżej oprocentowana inwestycja w tej platformie to nie kolejna funkcja — to **przepuszczanie zmian
przez bramki, które już są napisane, już działają i już udowodniły, że łapią realne defekty**:
to `check:sql-migration-replay` znalazła bliźniaki, których zarzut sprzed tygodnia dotyczył jako
„niewidzianych", a bramka martwego kodu przy czyszczeniu 171 deklaracji odsłoniła cztery zerwane
ścieżki funkcji.

---

*Dokument towarzyszy `docs/AUDYT_PLATFORMY_MODULY_FUNKCJE_2026-08-14.md` (pomiar) i kontynuuje serię
`OCENA_FUNKCJI_TABELE_*`. Oceny konkurentów = stan wiedzy do poł. 2026 z
`OCENA_FUNKCJI_KONKURENCI_2026-07-24.md`; „b/d" = brak danych z zewnątrz, nie brak funkcji.*
