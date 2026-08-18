# Inwentarz funkcjonalności platformy NES — pełny rejestr (2026-07-24)

Kompletny, opisowy rejestr **wszystkich modułów, kategorii, udogodnień, funkcji i funkcjonalności** — co
potrafią i jak działają. Dokument referencyjny (nie ocenia — opisuje); ocenę zawiera `OCENA_FUNKCJI_2026-07-24.md`.

Układ: **Część I** — fundamenty i mechanika platformy (jak to działa „pod maską"); **Część II** — 20 modułów
funkcjonalnych (co potrafią, z rozbiciem na funkcje); **Część III** — załączniki z wyliczeniem **każdego
elementu** (102 bloki, 75 widgetów, wszystkie trasy, endpointy, domeny logiki, tabele, hooki, klucze ustawień).

Stack: React 19 + TanStack Start (SSR) + Supabase (Postgres + RLS) + Stripe + ElevenLabs; Tiptap, dnd-kit,
ECharts, TailwindCSS 4. Skala: 444 migracje, ~180 tabel, ~90 tras admina, ~80 publicznych, 118 domen `lib/`.

---

# CZĘŚĆ I — Fundamenty i mechanika platformy

## 1. Model renderowania i routing (SSR)

- **TanStack Start SSR + file-based routing.** Każdy plik w `src/routes/` to trasa; `__root.tsx` to powłoka
  aplikacji owijająca każdą stronę. `routeTree.gen.ts` generowany automatycznie.
- **Defensywny loader.** Krytyczne strony (`index`, archiwa) ładują dane przez `Promise.allSettled` —
  pojedynczy nieudany fetch nie wywraca strony (renderuje pustą powłokę samonaprawiającą się po hydracji).
  Render zdegradowany dostaje nagłówek `no-store` (nigdy nie trafia do wspólnego cache CDN).
- **Prawdziwy widok artykułu** żyje w trasie catch-all `$.tsx` (`ResolvedPage`); `post.$slug.tsx` to shim 301
  do URL kanonicznego. Odblokowania treści następują **po hydracji** (bajty premium nigdy nie w SSR anonimowym).
- **Speculation Rules** (prefetch `moderate`), **View Transitions** (morph okładki), samo-hostowane fonty
  z subset-preloadem, lazy-mount ciężkich nakładek (paleta ⌘K, popupy, odtwarzacz audio).

## 2. Wielotenantowość (multi-tenant)

- **Host-based:** jedno wdrożenie obsługuje wiele tenantów rozróżnianych po domenie/hoście żądania.
- **Dwa źródła tenanta (kluczowe):** `current_tenant_id()` = tenant domowy z sesji/JWT (zaufany);
  `public_tenant_id()`/`x-tenant-host` = tenant z nagłówka ustawianego przez klienta (spoofowalny).
- **Dwie płaszczyzny rozwiązywania hosta:** treść (fallback do tenanta domyślnego — podglądy działają) vs
  **crawler (fail-closed:** nieznany host → 404 / `Disallow: /` — cudza domena nigdy nie indeksuje treści
  innego tenanta). Katalog tenantów cache'owany per-isolate (TTL 60 s + de-dup in-flight).
- `profiles.tenant_id` **przypięty triggerem** — użytkownik nie zmieni własnego tenanta.
- **Lint CI `check-sql-tenant-scope.ts`:** statyczny analizator failujący build, gdy funkcja `SECURITY
DEFINER` łączy tenant z nagłówka z autoryzacją po roli (domyka powtarzalną klasę błędu cross-tenant).

## 3. Bezpieczeństwo i model dostępu

- **RLS jako druga warstwa:** 915 polityk RLS w 142 migracjach, 31 widoków `security_invoker`, **granty
  kolumnowe na PII** (anon/authenticated nie czytają e-maili/telefonów/tax_id — bramka pgTAP).
  [Korekta 02.08: "915" liczyło instrukcje `CREATE POLICY` w churnie migracji; obowiązująca metryka to
  **stan końcowy polityk** liczony parserem gate'u CI (CREATE/DROP odtwarzane po kolei) - na 01.08 = **517
  realnych polityk**, 0 tabel bez RLS.]
- **Enforcement serwerowy:** logika dostępu (paywall, metering, gift, hasło, TTS, kupony) w RPC `SECURITY
DEFINER`; klient to warstwa UX. 927 z 939 funkcji DB to `SECURITY DEFINER` z przypiętym `search_path`.
- **Sanityzacja XSS dwusilnikowa:** `safeJsonLd` (neutralizuje `</script>`+U+2028/9), centralny
  `sanitizeHtml` (DOMPurify + allowlist-walker SSR), `hardenStyleCss`, sandbox iframe reklam.
- **Sekrety w Supabase Vault** (integracje) i env (Stripe/ElevenLabs/VAPID) — nigdy w DB/przeglądarce.
- **SSRF egress guard:** pojedynczy choke-point dla fetchy konfigurowanych przez użytkownika — odrzuca
  zakresy prywatne/reserved (IPv4+IPv6), `localhost`/`.internal`, fail-closed, `redirect:"manual"`.
- **Rate-limiting dwojaki:** in-memory token-bucket (beacony) + DB-backed atomowy `rate_limit_hit`
  (fail-open dla anty-abuse, fail-closed dla kosztu/bezpieczeństwa: TTS, brute-force).
- **CSP** pełny (HSTS 2 lata, `nosniff`, `frame-ancestors 'self'`, `object-src 'none'`); weryfikacja
  podpisu Stripe (`timingSafeEqual` + okno 5 min); MFA z eskalacją AAL1→AAL2 dla operacji uprzywilejowanych.

## 4. Szyna zdarzeń domenowych i realtime

- **Event bus:** triggery DB wywołują `emit_domain_event` → wiersz w `domain_events` (`<agregat>.<czasownik>.v<n>`,
  np. `post.published.v1`), z `correlation_id` z nagłówka `x-correlation-id`.
- **Mapowanie na cache:** klient subskrybuje `domain_events`; `eventInvalidationMap` tłumaczy typ zdarzenia
  na klucze React Query do unieważnienia (unknown → `[]`, forward-compat). **Dwa testy anty-drift** pilnują,
  że każdy typ emitowany w SQL ma regułę.
- **Współdzielony hub kanałów:** dokładnie jeden websocket `postgres_changes` per `(schema,table,event,filter)`,
  refcounted; SSR-safe; losowy sufiks nazwy defeatuje StrictMode. Debounce 250 ms, visibility-aware.
- **Correlation IDs:** UUID per akcja → nagłówek → `domain_events`; `awaitDomainEvent` (potwierdzenie
  optymistycznej mutacji), `get_correlated_events` (pełny ślad click→zdarzenia).

## 5. Internacjonalizacja (i18n)

- **PL/EN wpisane w schemat:** 153 pary kolumn `_pl`/`_en` (treść), UI przez i18next.
- **SSR-safe:** serwer używa `cloneInstance` per-żądanie (współdzieli store przez referencję) — języki
  współbieżnych żądań nie „przeciekają" do dokumentów w edge-cache. Klient mutuje singleton.
- **Język z URL** (hydration-safe), cookie źródłem prawdy, localStorage backupem, auto-detekcja przeglądarki.
- **Perf-split:** rdzeń PL/EN (~65 KB) jako osobne chunki Vite (ładowany tylko aktywny język, drugi prefetch
  na idle) + ~40 overlay-bundli per-funkcja (tylko dodają brakujące klucze).

## 6. Zadania w tle, cron, integracje

- **pg_cron + pg_net → HTTP:** SQL nie wysyła maili/pushy, więc cron woła endpointy (`jobs-tick`,
  `community-cron`) ~co minutę; **budżet 25 s** (tanie joby DB pierwsze, sieciowe ostatnie — pomijane
  z `skipped_time_budget` przy wyczerpaniu, idempotentne wracają w kolejnym ticku).
- **Atomowe claimy `SKIP LOCKED`** (`claim_push_jobs`, `claim_due_digests`, `claim_command`) — równoległe
  ticki bezpieczne. Idempotencja komend przez `command_idempotency`.
- **Outbox integracji:** fan-out zdarzeń do webhooków/Google Calendar/HubSpot, payload **podpisany
  HMAC-SHA256** (`x-nes-signature`), dzierżawa + re-claim `delivering`.

## 7. Silniki treści (dwa, interoperujące)

- **Block editor** (Gutenberg-style): dokument bloków dla artykułów. **Page builder** (Elementor-style):
  Sekcje→Kolumny→Widgety dla stron/nagłówka/stopki/menu/popupów.
- **Interop:** widget `rich-text` osadza cały silnik bloków w layoucie buildera; migracja `blocksToBuilder`
  jest lossless i odwracalna. Renderery izolują błędy per-widget (`RenderErrorBoundary`).

---

# CZĘŚĆ II — Moduły funkcjonalne

Format: **Funkcja** — co potrafi; _jak działa_.

## Moduł 1 — Wpisy: doświadczenie czytelnika

**Dostęp i monetyzacja treści**

- **Paywall (4 tryby)** — bramkuje artykuł jako `public`/`members`/`paid`/`password`; _body dowodzi
  uprawnienia — anonimowy SSR go nie wysyła, uprawniony klient dociąga przez RPC `get_entity_content`._
- **Metering „N darmowych/mies."** — pozwala przeczytać N płatnych artykułów zanim padnie bramka; _serwerowy
  `consume_metered_view`, konsumpcja po hydracji (boty nie palą limitu), gość = UUID w localStorage, polityka
  per-treść inherit/metered/exempt + `min_tier_rank`; warianty „register-wall"/„exhausted"._
- **Podaruj artykuł (gift)** — subskrybent generuje link `?gift=<kod>` odblokowujący pełny artykuł każdemu
  (też anon); _RPC `create_gift_link`/`redeem_gift_link` SECURITY DEFINER, idempotentny per (post, darczyńca),
  limit miesięczny + TTL + cap odkupień, wyklucza wpisy hasłowe, redempcja po hydracji, 7 kanałów share._
- **Odblokowanie hasłem** — treść za hasłem; _bcrypt weryfikowany serwerowo (`verify_content_password`),
  rate-limit 10/min + 20/5 min fail-closed, hint bez hasha, zapamiętanie w `sessionStorage`._

**Nawigacja w artykule**

- **Spis treści (TOC)** — 4 warianty: inline w treści, „rail" ze scrollspy, blok `toc`, marker `<!--TOC-->`;
  _konfiguracja Zod (layout/kolumny/poziomy nagłówków/tytuły PL-EN), IntersectionObserver + MutationObserver,
  gwarancja „dokładnie jeden TOC" (`suppressToc`), mobilny bottom-sheet z focus-trap._
- **Pasek postępu czytania** — górny pasek + pierścień % przewinięcia; _`rafThrottle`, liczony wg granic
  `.article-body`, rail desktop / FAB mobile._
- **Czas czytania** — „N min czytania"; _jedno źródło (`readingTime.ts`), WPM per język (PL 220/EN 238),
  krzywa dla obrazów, wolniej dla `code`, override ręczny, konfig admina Zod+deepMerge._
- **Serie / dossier** — baner „część N z M" + prev/next + strona `/series/$slug`; _lekka taksonomia serii._
- **Auto-load next post** — nieskończone doładowywanie kolejnego wpisu z przepisaniem URL/tytułu; _sentinel
  IntersectionObserver 400 px, `maxChain 5`, `history.replaceState`._

**Wzbogacenia treści**

- **Przypisy (footnotes)** — `[fn]…[/fn]` → numerowane odnośniki + lista źródeł + tooltipy; _3 procesory
  (HTML/builder/baked), engine-aware (bez duplikatów id), sanityzacja, backlink `↩`._
- **Słowniczek — auto-tooltipy** — podkreśla pierwsze wystąpienie terminu + definicja w dymku; _TreeWalker
  na wszystkich silnikach, granice `\p{L}\p{N}`, longest-first, pomija linki/code/nagłówki, link do `/glossary`._
- **Key takeaways** — „czego się dowiesz" nad treścią (3 warianty: card/heading/ghost); _per-język, ikona
  Lucide, motyw CSS-vars, hook `speakable` do JSON-LD, CMS `admin.key-takeaways`._
- **Cytuj tę analizę** — Chicago/APA/BibTeX + kopiuj; *format czysty, data dostępu tylko klient (edge-safe),
  - meta `citation_*` (Highwire/Google Scholar).*
- **Druk / PDF (policy brief)** — `window.print()` z markową ramką print-only (masthead/stopka/numeracja);
  _warstwa CSS-only, `.no-print` na reklamach/komentarzach/related._

**Audio**

- **TTS / słuchaj artykułu** — globalny odtwarzacz (przeżywa nawigację) grający MP3 lub syntezę ElevenLabs;
  _transport ±15 s / prędkość / seek natywny (a11y), download, share, staged progress, cache MP3 w prywatnym
  buckecie po hashu treści+głos+model._

**Udostępnianie i społeczność wokół artykułu**

- **Pasek share** — X/FB/LinkedIn/mail/WhatsApp/Telegram/Reddit + kopiuj; _konfig per platforma, `rel=noopener`._
- **Quote-share** — zaznaczenie tekstu → toolbar „udostępnij cytat"; _budżet 280 znaków X, viewport-clamp,
  `role=toolbar`, SSR-safe._
- **Zakładki / zapisz** — dodaj do listy czytania; _DB dla zalogowanych, localStorage z TTL dla gości, cap 200._
- **Śledzenie autora / tematu** — follow author/kategorii/tagu/programu; _upsert race-safe, inwaliduje 5 cache,
  zasila feed „Obserwowane" + alerty._
- **Powiązane wpisy** — sekcja related w 6 layoutach (grid/list/slider/cards/magazine/timeline), na końcu lub
  po N-akapicie (React Portal); _scoring RPC, beacon CTR, `preload=viewport`._
- **Komentarze** — wątki, gość+honeypot, edycja 15 min, soft-delete, realtime, `@mentions`, moderacja; _głębokość
  wymuszana triggerem DB, load-more, domyślnie wyłączone._
- **Feedback „czy przydatne?"** — kciuk +/–; _dedup serwerowy IP+UA + rate-limit, zasila scoring rekomendacji._
- **Changelog wpisu** — publiczny log aktualizacji; _`<time datetime>` UTC-safe, tylko gdy są wpisy._

**Chrome i prezentacja**

- **Sticky reading header** — kondensowany pasek po scrollu (logo/szukajka/tytuł/motyw/konto/język); _`inert`
  gdy ukryty (a11y), `rafThrottle`, reuse `SearchButtonWidget`._
- **Quick-view info bar** — pasek: kategoria/czas/data/gift.
- **PostLayoutRenderer** — presety layoutu (cover full/ratio/none, overlay, sidebar); _preload LCP = `<img>`
  1:1, View Transitions morph, test funkcjonalny + `axe`._
- **Lightbox** — powiększanie obrazów; _`yet-another-react-lightbox`, CSS bundlowane, SSR-safe lazy._
- **Podgląd draftu tokenem** — `/preview/$token` bez konta (embargo/prasa); _service-role + walidacja
  token/expiry, `noindex,nofollow,noarchive`, baner embargo._
- **Web stories (+AMP)** — slideshow + `/amp` `<amp-story>`; _`CreativeWork` JSON-LD, AMP fail-closed._
- **Rejestracja odsłon** — best-effort zapis odsłony + historia czytania; _1,5 s opóźnienia (filtruje back/fwd),
  wyklucza self-view autora, zasila rekomendacje._
- **Custom meta / badge kategorii** — chipy meta edytora + pigułki kategorii z kontrastem WCAG.

## Moduł 2 — Edytor wpisów i workflow redakcyjny

- **Shell 4-trybowy** — jeden edytor przełączalny: bloki / builder / rich-text (Tiptap) / markdown; _wizard
  Details→Content, inline tworzenie taksonomii, `EditPresenceBanner` (realtime współedycja), dane przez
  tenant-scoped RPC `get_post_for_edit`._
- **Autosave** — automatyczny zapis w tle; _debounce 1500 ms, zserializowane zapisy konwergujące na najświeższą
  wartość, `flush()` odrzuca na błąd (UI nigdy fałszywie „zapisano"), snapshoty rewizji, guard zamknięcia karty._
- **Undo/redo formularza** — cofanie zmian pól; _per-field `coalesceKey`, optimistic-lock `baseUpdatedAt` →
  toast `EDIT_CONFLICT`._
- **Workflow redakcyjny** — statusy (draft/review/scheduled/published), role-gated publish vs submit-for-review;
  _statusy jako pojedyncze snapshoty rewizji._
- **Checklista przed publikacją** — miękka bramka „Publikuj" (okładka/kategoria/zajawka/takeaways/SEO/wersja EN);
  _required/optional, confirm-on-gaps._
- **Walidacja SEO w edytorze** — blokuje zapis na twardych limitach, ostrzega o przycięciu pikselowym.
- **Kalendarz redakcyjny** — `admin.posts.calendar`: siatka miesiąca z przeciąganiem wpisów na inną datę;
  _dnd-kit (Monday-first), backlog draftów → 09:00, opublikowane read-only._
- **Rewizje / restore** — snapshoty treści z przywracaniem.
- **PostSettingsMetabox** — ToC, ochrona treści/członkostwo, dwujęzyczne Takeaways z live preview.

## Moduł 3 — Silniki treści: block editor + page builder

**Block editor (Gutenberg-style)** — 102 typy bloków w 8 kategoriach (pełna lista: Załącznik A).

- **Kanwa drag-and-drop** — reorder/insert-between/duplicate/replace/remove; _dnd-kit (Pointer+Keyboard),
  renderer wszystkich typów + fallback `[type]`._
- **WordStyleToolbar** — pływający pasek Tiptap: bold/italic/color/highlight/link/przypisy/H1-3/align/listy;
  _skróty markdown + slash-command._
- **Undo/redo bloków** — _debounce 400 ms, cap 100, izolowane stosy PL/EN, Alt+Arrow reorder._
- **Inspektor + document outline** — kontrolki per-typ + wspólna sekcja Layout (align/margin/hide) + drzewo.
- **Bloki wyróżniające:** `chart`/`data-map` (grid danych + live preview przez silnik `charts` + choropleta),
  `review` (Foxiz, ważone kryteria), `poll` (bind do tabeli `polls`), `liveblog`, `faq`, `toc`, `compare`,
  `proscons`, `affiliate`, `countdown`, `spoiler`, `xquote`, `stats-counter`.
- **Import/convert** — gutenberg/elementor/markdown/embed, lossless (unknown → `html`), round-trip.

**Page builder (Elementor-style)** — 75 typów widgetów w 7 kategoriach (pełna lista: Załącznik B).

- **Kanwa + hierarchia** — Sekcje→Inner→Kolumny→Widgety; _HTML5 DnD, multi-select (shift/ctrl/marquee),
  context menu per węzeł, przełącznik urządzeń desktop/tablet/mobile + preview jasny/ciemny, resize/hide
  per-device, inline editing, coachmark tour, `safeParseBuilderDoc`._
- **Scope'y buildera** — page / header / footer / menu / popup.
- **NES Digital Features (9 widgetów)** — think-tankowe data-viz: `feature-timeline`, `feature-sankey`,
  `feature-compare`, `feature-risk-matrix`, `feature-indicator`, `feature-network`, `feature-corridor-map`,
  `feature-sources`, `feature-methodology`; _silnik `src/components/features/*`, dane w textarea (separator `;`,
  tłumaczenie w komórce `PL|EN`), mapa korytarzy reużywa projekcji `public/geo/*`, dostępność (tabela danych)._
- **Widget `rich-text`** — osadza cały silnik bloków (seam interop bloki⇄builder).
- **Silnik danych** (`lib/builder`, 51 plików) — czyste tree-ops, historia z labelami + `coalesceKey`,
  **global widgets** (współdzielone per-tenant, cross-page sync), **templates** (zapisane sekcje),
  **A/B experiments** (FNV-1a 50/50, exposure/conversion), **popupy** (triggery immediate/delay/scroll/exit).
- **System właściwości** — 3 taby (Content/Style/Advanced) per-device, 15 molekuł stylu (Background/Border/
  Typography/Motion/Overlay/Shape/Spacing/Visibility/Link/Icon/Color/AccessControl/Hover).

## Moduł 4 — Wygląd, motyw, media, import WP

**Wygląd (7 tabów `admin.appearance.*`)**

- **Header/Footer builder** — nagłówek/stopka przez shared Builder (`scope=header/footer`), zapis w `site_settings`.
- **Menu builder** — `MenuManager`: drzewo 3-poziomowe, mega-panel, icon picker; _prawdziwe HTML5 DnD, MAX_DEPTH 3._
- **Post-sidebar designer** — 3-kolumnowy layout sidebara wpisu z paletą 6 widgetów.
- **Category/Tag archive designer** — 6 wariantów layoutu archiwum z miniaturami SVG + `ArchiveLivePreview`.
- **Post layouts** — 4 formaty × warianty sidebara, suwaki responsywnej typografii.
- **Expert layouts** — 8 presetów strony eksperta, widoczność/kolejność sekcji, 8 kolorów hero.
- **Related posts config** — 3 taby (config/wagi silnika/analityka).

**Motyw, kolory, czcionki**

- **Global colors / design tokens** — dwa systemy: brand tokens (`--brand-*`) + semantyczne Global Colors
  (5 kategorii / 20 grup / **65 slotów**, każdy light/dark/hover + typografia); _`GlobalColorsEditor` z undo/redo
  i live injection do `:root`/`.dark`._
- **Custom fonts** — upload woff2/woff/ttf/otf → `@font-face`; _bucket `media`, live preview, detekcja duplikatów._
- **Theme Design pane** — 12 edytorów sekcji (`--td-*`), live preview wpisu (lang+mode+sync).
- **Theme Options pane** — master customizer w stylu WP (~18 sekcji, 6 zakładek logo).

**Media**

- **Biblioteka mediów** — menedżer w stylu iOS-Files: wirtualne foldery, multi-select, skróty klawiszowe,
  DnD plik-z-OS + item→folder, undo/redo move/rename; _triple-layer izolacja tenanta._
- **Upload** — `registerMediaUpload`: allowlista MIME (bez SVG = anty-XSS), guard `..`, capy rozmiaru
  (10 MB img/PDF, 300 MB audio, 200 MB wideo), 60/min, audit.
- **Cropowanie** — react-easy-crop: zoom/pan/rotate, 2-canvas rotate+downscale JPEG q0.92.
- **Crop-sizes** — nazwane presety per-tenant → buildery URL transformacji Supabase + `srcSet` + pre-warm HEAD.
- **Cover / Audio picker** — 3 tryby (upload/biblioteka/URL) z podglądem; audio z próbą korupcji/długości.

**Import WordPress**

- **Import z WP.com REST** — asynchroniczny job z postępem (`wp_import_jobs`), cancel, rate-limit 10/min.
- **Upload WXR** — kliencki `DOMParser` (postmeta, featured, Elementor JSON + WPML/Polylang).
- **Konwersja** — Gutenberg→bloki (nesting-aware, lossless) i Elementor→builder (mapowanie widgetów).
- **Import mediów** — `mirrorWpMedia`: SSRF guard, dedup sha256, rollback, przepisuje HTML + drzewo builder.
- **SEO redirects** — oryginalny permalink → 301 w `redirects`.

## Moduł 5 — Strona główna, archiwa, nawigacja (chrome)

- **Strona główna** — builder-doc albo grid „najnowsze" (wg `homepage_mode`); *loader `allSettled`, `Organization`
  - `WebSite`/`SearchAction` JSON-LD tylko na home, `sr-only` H1.*
- **Blog index / archiwa** — listy wpisów z „load more"; _`useTransition`, `posts_per_page`._
- **Archiwa kategorii/tagów** — `?page=&sort=` walidowane; _`CollectionPage` + `BreadcrumbList` JSON-LD, strony
  paginowane `noindex,follow`, RSS autodiscovery._
- **System layoutów archiwum (6 wariantów)** — Minimal/Classic/Magazine/Hero/Dark/Bento; _konfig per taksonomia
  (kolumny/hero/sidebar/kolejność widgetów), miniatury SVG._
- **Paginacja + toolbar** — numeryczna paginacja z `aria-current`, sort z `aria-live`, skeleton pending.
- **SiteChrome** — warunkowy header/footer/skip-link/route-progress/impersonation/chat-dock; _opt-out `ownChrome`,
  persystencja (header/menu nie remount-uje przy nawigacji)._
- **Header** — builder mega menu, mobilny drawer z focus-trap; _sticky tylko na home, SSR-prefetch._
- **Mega menu** — kolumny linków + AJAX recent-posts + featured z focal-point; _dostępny wzorzec disclosure (ESC/focus)._
- **Trending ticker** — pasek trendów: 5 źródeł × 5 animacji; _palety light/dark, `prefers-reduced-motion`, SSR-warmed._
- **Alert bar** — konfigurable ogłoszenie, dismissible; _no-CLS inline script chowa przed paintem, `</script>`-safe._
- **Breadcrumbs** — okruszki z `aria-current` + JSON-LD SSR.
- **Footer** — builder-authored, `content-visibility:auto`, back-to-top.
- **Root shell** — samo-hostowane fonty, RSS autodiscovery, theme-init bez FOUC, consent-gated RUM, lazy overlays.

## Moduł 6 — Wyszukiwarka

- **Strona `/search`** — 5 zakładek (wszystko/tytuły/typy/tematy/osoby), tryby (match all/any/phrase),
  składnia `"fraza"`/`-wyklucz`/AND/OR/NOT, fasety, chipy aktywnych filtrów; _w pełni URL-driven (shareable),
  ARIA combobox `aria-activedescendant`._
- **Backend wyszukiwania** — Postgres FTS (unaccent + polskie stemowanie, indeksuje treść builder + bloków)
  **zblendowany z embeddingami** (0,75·FTS + 0,25·cosine); _fasety RPC równolegle, trigram fuzzy fallback,
  hierarchiczne term-grupy, limit 300, degradacja pre-migracja._
- **Wyszukiwanie semantyczne** — embeddingi zapytania (LRU cache 300), tenant-scoped RLS, `{hits:[]}` na błąd.
- **Model faset/filtrów URL** — czysty URL⇄filters, hierarchia region→kraj, chipy usuwalne.
- **Autosugestie** — mega-box (Tytuły/Typy/Tematy/Osoby) reużywany w headerze i `/search`, avatary, operatory.
- **Zapisane wyszukiwania + alerty** — zapis stanu URL + bell alertu; _producent DB skan ~20 min → `enqueue_notification`._
- **Recent searches** — localStorage (max 6, dedup, SSR-safe).
- **Search overlay** — header quick-search (dropdown/fullscreen), focus-trap, operatory, recent; _testowany `axe`._
- **Command palette (⌘K)** — globalna paleta komend + debounced server search; _cmdk lazy, fuzzy static commands._
- **Voice search** — Web Speech API (progressive enhancement), PL/EN.

## Moduł 7 — Typy treści specjalne

- **Policy Tracker** — tracker legislacji UE: siatka dossier z paskiem procedury, detal z follow/alertami +
  mapą stanowisk państw + osią czasu + historią zmian, globalny feed „co się zmieniło", macierz kraj×dossier +
  statystyki; _`Legislation` JSON-LD + jurysdykcja, mapa focusable per-country + fallback tabelaryczny,
  moduły `stages`/`euCountries` z inwariantem „każdy kod kraju w GeoJSON"._
- **Hub autora/eksperta** — strona eksperta: rola, obszary, programy, kontakt, „w mediach", eksplorer materiałów,
  akcje sieciowe (connect/DM/follow/intro); _`Person` JSON-LD, conditional indexation (eksperci index /
  goli członkowie noindex), PII przez `author_profiles_public`._
- **Ankiety (polls)** — `/polls` + blok w treści; _prawdziwy realtime (`postgres_changes` na `poll_votes`),
  anti-anchoring (wyniki ukryte do głosu przez `vote_poll`)._
- **Q&A / AMA** — sesje pytań z upvote i odpowiedziami ekspertów; _`ask_qa_question` RPC (rate-limit 5/h,
  sanitize, notify), `list_qa_questions` (Pro-priority > głosy > wiek), podsumowanie sesji → post._
- **Wydarzenia + RSVP** — lista + detal z tri-state RSVP; _waitlist FIFO, capacity, tier gating, early-RSVP,
  recording gate, flaga Chatham House, add-to-calendar (Google/Outlook/.ics), event→chat._
- **Podcasty** — sieć programów: index, odcinek (chapter seek, cytaty, transcript), show/seria (sezony),
  odtwarzacz (Media Session API — lockscreen/klawisze media, arbitracja, zapamiętanie pozycji).
- **Katalog ekspertów / katalog ludzi** — `/experts` (filtry area/program) + `/people` (member search: trigram,
  fasety, infinite scroll, presence/badges, connect/DM; noindex + auth-gated).
- **Leaderboard kontrybutorów** — reputacja 30/90/365 dni + karta osobista.
- **Programy / research programs** — index + landing think-tank (thesis, pytania, zespół, projekty, raporty,
  auto-latest, partnerzy, newsletter programu).
- **Biblioteka publikacji (`/publications`)** — reużywa silnika `/search` w trybie browse (fasety/chipy/URL shareable).
- **Glossary (`/glossary`)** — dwujęzyczny `<dl>` per-litera + `DefinedTermSet`/`DefinedTerm` JSON-LD.
- **Library (zasoby członków)** — tier-gated biblioteka plików; _ścieżka pliku nigdy do klienta, signed-URL server fn._
- **Live blog** — blok w-poście (prawdziwy realtime `postgres_changes` per post_id) + indeks `/live` (SSR snapshot).
- **Web stories** — `/web-stories` + AMP `<amp-story>`; _StoryViewer focus-trap/rAF, XSS guards._
- **HTML sitemap (`/sitemap`)** — drzewo stron + community + kategorie + latest dla ludzi/AI.

## Moduł 8 — SEO, feedy, dane strukturalne

- **Dane strukturalne / JSON-LD** — `NewsMediaOrganization`, `WebSite`+`SearchAction`, `BreadcrumbList`,
  `NewsArticle` z **Google paywall markup** (`isAccessibleForFree`+`hasPart`) + AEO (`articleSection`/`keywords`/
  `abstract`/`Speakable`); _`safeJsonLd` neutralizuje `</script>`+U+2028/9._
- **Meta / head management** — `buildContentHead`: absolutny canonical bez query, pełne OG+Twitter, `og:locale`
  +alternate, canonical-override tłumi hreflang, pixel-width SERP grader, `activeLang` anty-race SSR.
- **RSS** — główny `/rss.xml` + `/feed` (301), RSS per kategoria/tag/program (jedna DRY-fabryka); _RSS 2.0
  poprawny (`atom:link`/`language`/`ttl`/`guid`), `xmlEscape` wszędzie, excerpt-only (paywall-safe)._
- **Podcast RSS (iTunes)** — feed sieci + per-show; _`enclosure` byte-length + MIME sniff, `itunes:duration/season/episode`._
- **XML sitemap** — 11 typów encji + alternatywy hreflang; _noindex-aware, degradacja do wpisów statycznych._
- **News sitemap** — okno 48 h + cap 1000 (namespace Google News).
- **robots.txt** — fail-closed-ale-200, blokuje admin/auth/api/member, konfigurowalna polityka AI-crawlerów (GEO).
- **llms.txt** — przewodnik llmstxt.org (GEO) dwujęzyczny + blok citation-policy.
- **OG image generation** — generator kart 1200×630 (word-wrap/font-step/4-line clamp, brand palette, `?v=` cache-bust).
- **Inne helpery** — citations (Highwire), contentStatus (scoring SEO), headingValidation (H1/struktura),
  speculationRules, fontPreload, pageTree, redirects (chain/loop detection, allowlista open-redirect, monitor 404).

## Moduł 9 — Czat / komunikator (klasa WhatsApp/Messenger)

- **DM 1:1 realtime** — prywatne wątki; _`get_or_create_direct_conversation`, kursor `(created_at,id)`, optimistic
  send + reconcile, edycja 5 min, unsend (tombstone), 5 strategii kanałów realtime refcounted._
- **Grupy („kręgi")** — multi-member (create/rename/invite/leave, owner + hand-off, cap 49, receipts agregowane).
- **Motywy/wygląd czatu** — 7 gradientów + 4 tapety + quick-emoji + nicknames; _rejestr z 3-way parity testem._
- **Receipts** — ✓/✓✓/read; _`computeReceipt` czysty, cap „sent" gdy peer RLS-hidden (receipts-off)._
- **Załączniki/media** — obrazy + dokumenty 30 MB, signed URL + XHR progress, lightbox zoom/rotate/pan, PDF iframe,
  panel Photos/Files/Starred; _upload rate-limit RPC przed zapisem, SVG wykluczony._
- **Głosówki** — nagrywanie w aplikacji (cap 600 s); _MediaRecorder, detekcja kodeka (webm/opus → mp4 Safari)._
- **Emoji + reakcje** — picker lazy (~19 KB), reakcje Messenger-semantyka; _optimistic structural-sharing._
- **Presence / online** — zielona kropka; _1 prywatny kanał per tenant, `useSyncExternalStore`, gate `show_online_status`._
- **Typing indicators** — „pisze…" (set typerów); _stabilny prywatny broadcast, throttle 2,5 s._
- **Szkice** — per-konwersacja localStorage, user-scoped, debounce + flush `pagehide`; live „Szkic:" na liście.
- **Gwiazdki (starred)** — prywatne per-user (nadawca nie wie).
- **Nicknames** — per-konwersacja (nick > profil > fallback).
- **Blokowanie** — block/unblock, composer zastąpiony notką odblokowania.
- **Wyszukiwanie wiadomości (FTS)** — `search_messages` RPC (PL stemming, RLS-mirror), jump-with-paging; _`SearchSnippet` bez `innerHTML`._
- **Forward wiadomości** — przekazanie tekstu z tagiem „Forwarded".
- **Demo bot chat** — klient-only preview renderujący prawdziwy `MessageList`.
- **Expert-request przez czat (inmail)** — gated ekspert → formalny request (subject/reason/questions), quota
  miesięczna, admin routing.
- **Chat bell / toasty** — badge unread + toasty incoming; _suppress gdy focus/mute, unread jako derived select._
- **Chat dock** — 1–3 okna wg viewportu, minimized rail; _`ChatWindow` lazy, gate `chat_enabled` w SiteChrome._
- **Admin moderacja czatu** — lista rozmów, soft-delete msg, cascade delete, purge expired.

## Moduł 10 — Sieć / networking (LinkedIn-lite)

- **Połączenia / zaproszenia** — pełny cykl (invite → accept/decline/withdraw/remove); _`user_connections` zero
  grantów + deny-all RLS, całość SECURITY DEFINER RPC; silent decline, cross-invite auto-accept (race handling),
  rate-limit 30/24 h, block-sever, privacy `allow_connections_from`; realtime pośredni (notifications+counters)._
- **Śledzenie tematów** — follow author/kategorii/tagu/programu (`user_follows` owner-RLS).
- **Followed-feed** — infinite feed obserwowanych z tablicą `reasons` (`get_followed_feed` RPC).
- **Wspólne kontakty + strona mutual** — `mutual_connections` RPC (intersect accepted, discoverable).
- **Wprowadzenia (introductions)** — bridge: requester → wspólny kontakt → target; _obie krawędzie accepted, rate-limit 5/24 h._
- **Śledzenie odsłon profilu** — „kto oglądał" 7/30/90 dni; _`profile_view_events` read-false RLS, dedup 1/h/para,
  privacy public/anon/private._
- **DM entrypoint** — przycisk „napisz" (double-gate `chat_enabled` + soft tier).
- **Zgłoś użytkownika** — moderacja: `user_reports` RPC-only deny-all, rate-limit 5/24 h, open-report dedup, staff queue.
- **Followerzy dossier** — kto śledzi dany plik polityki (`policy_item_followers`, discoverable opt-in).
- **Hub sieci (`/network`)** — connections + received/sent invitations + „people you may know" (social proof).
- **Rekomendacje** — pisz/moderuj rekomendacje na profilu (obecnie z długiem kontraktu klient↔DB — patrz ocena).

## Moduł 11 — Newsletter

- **Inline signup form** — email + imię/nazwisko/firma + custom fields; _server DOI fn, `consents` array z HTML
  polityki (audit), sanityzacja._
- **Popup** — modal z triggerami (delay/scroll/exit-intent); _freq gate localStorage, overlay coordinator (nie
  stackuje nad cookie banner), focus-trap._
- **Buildery inline/popup** — 2 buildery drag&drop (`NewsletterBuilder`, 17 widgetów + Zod, undo/redo, device preview).
- **Double opt-in** — potwierdzenie linkiem; _token 256-bit server-only, 48 h TTL, weryfikacja pending→subscribed,
  idempotent, 303 redirect (default OFF)._
- **Unsubscribe** — jednoklik + self-service; _GET waliduje / POST mutuje (skanery nie wypisują), RFC 8058
  one-click `List-Unsubscribe-Post`, token 192-bit DB-gen, nie echo email._
- **Open/click tracking** — pixel 43 B + redirect; _token HMAC-SHA256 odsprzężony od tokenu wypisu, open-redirect
  guard, bez IP/UA w DB._
- **Zarządzanie kampaniami** — CRUD + wysyłka batched+lease (20/1100 ms, 200/invocation, lease 3 min); _atomic
  `claimCampaign` (anty-double-send), resume-idempotency, scheduling pg_cron, compliance guard (bez origin = bez
  stopki → odmowa), personalizacja `{{firstName}}`, audience filter `min_tier_rank`._
- **Campaign builder (EmailDoc)** — 9 typów bloków → HTML table-based; _preview == send, `post-list` resolved
  at-send, escape + http(s)-only + sanityzacja._
- **Subskrybenci** — search/filter, CSV export + import (idempotent 1–5000 Zod), soft unsub/resub + hard delete (RODO).
- **Overview / analityka** — KPI (subskrybenci/growth/opt-in/unsub) + engagement per-kampania.

## Moduł 12 — Realtime, powiadomienia, web-push

- **Szyna zdarzeń domenowych** — patrz Część I §4 (event bus + `eventInvalidationMap` + anty-drift testy).
- **Współdzielony hub kanałów** — 1 websocket per spec, refcounted, SSR/StrictMode-safe.
- **Powiadomienia in-app** — bell (header) + center (inbox w `/messages`); _infinite `.range(25)`, bell+center
  współdzielą cache, unread z materialized counter + fallback, realtime per-user, optimistic mark/delete._
- **Grupowanie powiadomień** — collapse `message` per konwersacja (UUID regex).
- **Preferencje powiadomień** — per-kind toggle (`security` always-on) + kanały push/email; _fail-open unknown._
- **Katalog zgód (RODO)** — 7 zgód / 4 kategorie z wersją (bump → re-confirm); _`set_user_consent` loguje IP/UA/lang._
- **Digest email** — zbiorczy digest nieprzeczytanych; _`esc()` XSS, absolutne linki, PL plural, tracker pinned._
- **Server dispatch** — dyspozytor push + digest + reminders; _`claim_push_jobs` (`SKIP LOCKED`), 404/410 → dead,
  backoff + dead-letter po 8, per-user locale._
- **Web-push / VAPID** — powiadomienia przeglądarki; _hand-rolled `node:crypto` RFC 8291/8188/ES256 bez zależności
  zewnętrznej, SW `public/push-sw.js`, SSRF-guarded endpoint._
- **Entity presence** — „kto teraz edytuje/ogląda" (post/page/lead/media); _kanał `private: true`._
- **Optimistic-confirm mutation** — patch optymistyczny potwierdzany zdarzeniem po `correlation_id` (rollback po timeout).
- **Admin powiadomienia** — statystyki push/digest + cleanup martwych subskrypcji.

## Moduł 13 — Monetyzacja: cennik, checkout, subskrypcje, billing

- **Strona `/pricing` (Cennik 2.0)** — segmentowana wg audiencji (Individual/Business/Education-NGO/Teams);
  _100% config z Supabase (zero hardcode cen), loader prefetch z per-source degradacją._
- **Przełącznik audiencji** — taby segmentów z deep-linkiem `?audience=`; _tablist + roving tabindex + klawiatura._
- **Toggle interwału (mies./rok)** — z badge „oszczędzasz N%"; _savingsPct z realnych cen (nigdy wymyślony)._
- **Karty tier** — cena + benefity + CTA kontekstowe (checkout/contact/signup/support/disabled); _`PriceBlock`
  obsługuje free/invitation-only/on-request/per-seat/yearly, `trackCta` na każdym CTA._
- **Macierz porównania** — feature × tier; _komórki 3 sposoby: feature (DB-truth) / derive / values (edytorskie i18n)._
- **Contact-sales dialog** — dla tierów nie-self-serve; _reużywa `submitContactMessage`, consent RODO._
- **Pricing FAQ** — DB + `FAQPage` JSON-LD + fallback static.
- **Checkout `/$planId`** — auth-gated, billing inline, kupon, konwersja waluty, tworzenie Stripe Checkout
  Session; _`createCheckoutOrder` server fn: kwota/waluta z `access_plans` (klient nie manipuluje), kupon
  walidacja RPC + atomowa rezerwacja pod lockiem, `payment_orders` pending→processing, fail-closed w prod._
- **Checkout success/cancel** — finalizacja (mock) + inwalidacja 5 cache entitlement; _open-redirect guard,
  idempotent ownership-scoped; w trybie Stripe webhook autorytatywny._
- **Silnik entitlement/grant** — mapowanie order→uprawnienie; _`entitlementForOrder` (+ lifetime dla one_time),
  `grantEntitlement` idempotent upsert `external_ref`, service-role (tabele insert-locked)._
- **Webhook Stripe** — sub/one-time/faktury/refund; _HMAC `timingSafeEqual` + 5 min, grant PRZED flipem `paid`,
  faktury/receipty idempotent per renewal, refund revoke tylko matching `external_ref`, out-of-order guard._
- **Zarządzanie subskrypcją** — cancel/resume/change-plan; _Stripe-first DB-second, proracja `always_invoice` +
  `error_if_incomplete`, konwersja PLN↔EUR, RetentionDialog 3-krok (survey → rabat kupon → kod)._
- **Rozstrzyganie tier + capabilities** — `current_membership_tier` RPC + rejestr `capabilities.ts` z flagą
  `enforced` (które bramki są realne vs dekoracyjne — badge Enforced/Decorative w adminie).
- **Utilsy** — konwersja waluty (parytet 1 EUR=2 PLN), NIP mod-11 checksum, `checkoutSettings` (zależności Stripe:
  tax/promo/invoice), `mockMode` fail-closed.

## Moduł 14 — Monetyzacja: kupony, darowizny, prezenty, reklamy

- **Prezenty artykułów (admin)** — 3 taby (Settings/Links/Audit): limit miesięczny, TTL, revoke, log zdarzeń;
  _server fn `requireStaff` + RPC SECURITY DEFINER reweryfikujące tenant+rolę._
- **Silnik gift link** — patrz Moduł 1 (RPC create/redeem, cap, TTL, wyklucza hasłowe).
- **Darowizny (`/support`)** — presety + kwota własna + wiadomość → Stripe; _`createDonationCheckout`
  `mode=payment` (jednorazowo), rate-limit fail-closed 5/10 min, waluta z języka (EN=EUR/PL=PLN), mock fail-closed;
  trigger `donations→Supporter` grant 12 mies. + `donations→CRM` scoring._
- **Admin darowizny** — read-only księga (500 wierszy) + 2 KPI.
- **Kupony B2B** — CRUD kodów + kampanie (bulk-generate) + redempcje + analityka; _`validate_b2b_coupon`
  (empty/invalid/window/limit/plan/currency), `redeem_b2b_coupon` race-safe (single UPDATE WHERE count<max),
  discount baked w `unit_amount` Stripe; `CouponInput` live-waliduje (klient wysyła tylko kod)._
- **Reklamy (admin)** — sloty HTML/script/image + targetowanie (kategorie/tagi/język) + rozmieszczenie
  (pozycja/typ strony/harmonogram `starts_at`/`ends_at`) + statystyki CTR.
- **Render reklamy** — `AdSlotView`/`AdZone`/`AdSlotById`; _html/script **nigdy** w host DOM → `SandboxedAdFrame`
  (iframe sandbox bez `allow-same-origin`) = zamyka stored-XSS; CWV: rezerwacja wymiarów (zero CLS),
  `useDeferredAd` (idle + viewport), zgoda `useMarketingConsent`._
- **API `ad-event`** — ingest beaconów impression/click; _token-bucket 60/1 s per IP, UUID regex, weryfikacja
  przynależności slot/placement do tenanta (anty-poisoning), zawsze 204._
- **Admin membership** — katalog tierów (features=bramki), mapping `access_plans.tier_key`, granty out-of-band.
- **Admin paywall** — Plans (ceny `access_plans`) / Metering (+ live impact preview RPC) / Overrides per-treść / Checkout.
- **Admin monetization dashboard** — KPI (metered/denials/register-wall/kupony/przychód) + filtry data/plan/org.
- **Admin pricing 2.0** — prezentacja `/pricing`: Audiences / Tiers-marketing / FAQ / Retention (rabat/kupon).

## Moduł 15 — Profil i konto użytkownika (18 tras `profile.*`)

- **Profil (`index`)** — LinkedIn-style: cover/avatar upload, inline-edit, taby, view-as-guest; sekcje
  experience/education/skills/awards/CV; _`useProfileEditor` (`saveField`/`upload`/`progress`)._
- **Edycja tożsamości (`edit`)** — 3 taby (basic/expert/social), expert gated rolą; `account`/`author`/`social` = redirecty 301.
- **Subskrypcja** — aktywna subskrypcja + cancel/resume/change (realny Stripe, RetentionDialog).
- **Zamówienia** — historia `payment_orders` + `BillingDocumentsCard` (faktury/receipty z webhooka: hosted_url/pdf_url).
- **Billing profile** — dane do faktury (firma/os., NIP/VAT checksum PL); _upsert `billing_profiles`, reuse w checkout._
- **Membership hub** — „wiązka praw": tier + źródło (sub/grant/org), supporter (donations), miejsca org,
  historia (events + downloads); _wszystko RPC/table, `PricingComparisonMatrix` per-audience._
- **Organizacja (B2B)** — owner invite/resend/remove miejsc przez email; _`org_add_seat` + RLS `is_org_owner`._
- **Zakładki** — posts + pages (published), wiersze „niedostępne" z cleanupem.
- **Obserwowane (follows)** — 4 taby (authors/cats/tags/programs), unfollow, wzorzec „unresolved row".
- **Zainteresowania** — `InterestsCustomizer` (personalizacja rekomendacji).
- **Osobowość (personality)** — Big Five OCEAN quiz + dashboard; _history append-trigger, localStorage draft autosave._
- **Expert-requests** — inbox received/sent (approve/decline/answered/cancel).
- **Bezpieczeństwo** — hasło (re-auth + signOut others), email, sesje, **MFA/TOTP** (enroll QR + verify + unenroll),
  **GDPR export** (JSON), delete account.
- **Prywatność** — toggle zgód (necessary/functional/analytics/marketing) → `profiles.prefs.consent`.

## Moduł 16 — Zarządzanie społecznością (admin)

- **Dashboard społeczności** — 6 metryk live (`admin_community_stats` RPC) + maintenance (purge/reminders).
- **Module flags (9 przełączników)** — global on/off: chat/network/events/Q&A/polls/contributor/badges/push/
  expert-requests + domyślny TTL wiadomości; _read-merge-upsert, runtime `useCommunityModules` → `CommunityDisabled`._
- **Engagement dashboard** — members/growth/active + funnel subskrypcji z paskami per-tier + „module pulse".
- **Community events (admin)** — CRUD + lifecycle (draft→published→cancelled), tier-gated early access (`early_rsvp_rank`).
- **Contributors** — moderacja pitchy autorskich (approve/reject + status remap UI↔DB).
- **Odznaki (admin)** — katalog `BADGE_CATALOG` + grant/revoke z notą (przez MemberPicker); _`profile_badges`._
- **Admin ankiety** — CRUD bilingual (2–8 opcji, draft/open), open/close, results.
- **Admin Q&A** — CRUD sesji, lifecycle (draft→scheduled→open→answering→closed+reopen), moderacja pytań, summary→post.
- **Comments — konsola moderacji** — filtr status + search, single + bulk approve/spam/delete; _selekcja czysta + testowana._
- **Discussion settings** — 3 flagi (`allow_comments`/`require_login`/`moderate_new`); _enforcement DB-side._
- **Greetings (powitania)** — 7 time-buckets × PL/EN z **polską fleksją wołaczową** (`name_dictionary` +
  heurystyka) + stabilny wariant per 30-min; _silnik czysty + testowany, `useGreeting` no-waterfall._
- **User-report moderation queue** — kolejka zgłoszeń Resolve/Dismiss.

## Moduł 17 — Analityka i BI

- **GA4 BI dashboard** — KPI + traffic + source/country/device + engagement + top pages; _prawdziwa Google Data
  API (service-account JWT RS256, OAuth2 refresh) + Measurement Protocol, 4 tryby połączenia + Looker embed._
- **Search Console BI** — 7 wykresów + prosty widok tabeli top queries/pages; _prawdziwa GSC API via connector
  gateway, 2-day lag handling, weighted position._
- **Web Vitals RUM** — real-user Core Web Vitals (p75, per-path, trendy); _ingest `sendBeacon` → `web_vitals`,
  RPC `web_vitals_daily_p75` + fallback._
- **Client error tracking** — telemetria błędów przeglądarki (onerror/rejection/boundary); _PII scrubbing przed persist._
- **Audience segments** — zalogowani vs anon (views/uniques/series/top posts).
- **Related posts analytics** — CTR rekomendacji + graf sygnałów.
- **Silnik insightów** — rule-based severity + fixes (GSC: expected-CTR-by-position benchmark, branded/zero-click).
- **Track ingestion** — first-party analytics (`analytics_events`, whitelist type/entity, redaction, batch 40).
- **Edge cache stats** — statystyki + purge cache (tenant-scoped).
- **URL inspection** — real GSC URL Inspection API (coverage state).

## Moduł 18 — CRM

- **Lead management / pipeline** — lista leadów z filtrami (stage/band/owner/tags/score/country/newsletter/date);
  _injection-hardened search, saved views, backbone `requireStaff` + step-up MFA + HMAC idempotency._
- **Lead detail** — membership/tasks/follow-ups/score breakdown/profile sync.
- **Lead scoring engine** — ważone scoring behawioralno-fitowe z half-life i pasmami hot/warm/cool/cold; _DB
  źródłem prawdy (`compute_crm_lead_score` + `crm_scoring_default_weights`), 15 sygnałów points+caps, parity test._
- **Sales funnel** — funnel subskrybentów newslettera z segmentacją + convert-to-contacts (idempotent).
- **Follow-ups & tasks** — zadania/przypomnienia per-lead; _reminders przez pg_cron scanner._
- **CSV lead import** — column mapping + preview + chunked RPC `crm_import_leads` + dedup DB.
- **Companies** — dyrektorium firm (saved views/chips/columns) + detal (contacts/notes/activity) + bulk.
- **Profile sync** — sync CRM lead ↔ profil członka (skills/exp/edu/cv/awards/personality).
- **Metering usage** — zużycie metered views vs limit członkowski.

## Moduł 19 — Ustawienia, integracje, użytkownicy, multi-tenant, RODO

- **Persistence core (useSettings)** — `site_settings` key/jsonb tenant-scoped; _deep-merge read+write (anty
  partial-write loss), revision history._
- **Ustawienia** — General / Reading / Discussion / SEO / Privacy / Marketing (pixele meta/LinkedIn/TikTok
  consent-gated) / Analytics (sekrety env-only) / Cookie-banner / Design.
- **Integrations hub** — webhook / Google Calendar / HubSpot; _outbox fan-out, HMAC-SHA256 signed, sekrety w Vault._
- **Auth context** — role hierarchy (super_admin>admin>editor/author>user), tenant z `profiles`; _open-redirect-safe
  logout, full cache clear (shared-device), graceful degrade signed-out._
- **User management** — directory profiles+roles+subs, changeRole, invitations (→ profiles/author/roles), team import.
- **Multi-tenant organizations** — `member_organizations` + `organization_seats`; _seat ops SECURITY DEFINER RPC
  (limit/role/format), invite emails._
- **User impersonation** — super-admin „zaloguj jako"; _`is_super_admin` gate, no self, magic-link hashed_token,
  audyt każdej sesji (`impersonation_sessions`)._
- **Login settings + MFA** — polityka auth + real Supabase MFA (TOTP aal2 step-up) + brute-force.
- **Role permissions matrix** — macierz uprawnień (rola/tier × zdolność) — read-only dokumentacja.
- **Cookie consent (RODO)** — banner 4 kategorie z per-cookie declarations; _localStorage + cookie + sync do
  `profiles.prefs.consent`; consent-gated script injection (cleanup on revocation); audit `user_consent_events` (IP/UA)._
- **Redirects manager** — CRUD 301 + CSV import + monitor 404 (open-redirect protection).
- **Broken-link monitor** — skan martwych linków wychodzących; _realne GET probes + SSRF guard, pg_cron._
- **SEO overview / content audit** — per-content status (missing meta PL/EN, OG, noindex, overrides).
- **Workflows** — „when X → do Y" (triggers/actions/steps) + correlation-trace diagnostyka.

## Moduł 20 — Platforma / narzędzia admina / backend

_(Mechanika w Części I; tu funkcje admina i zdolności platformowe.)_

- **Self-hosted MCP server** — `/mcp`: 3 read-only tools (`search_posts`/`get_post`/`list_recent_posts`) dla
  klientów LLM; _OAuth-protected (Supabase JWT), fail-closed auth (unreachable issuer gdy unconfigured),
  anon + `x-tenant-host`, tylko treść opublikowana._
- **TTS backend** — `/api/tts` (edytorski, auth+is_staff, rate-limit DB fail-closed) + `/api/public/post-tts`
  (publiczny, bez client-text — ładuje serwerowo, tenant-scoped, cache MP3 private bucket po hashu).
- **Admin dashboard** — kafle statystyk (posty/kategorie/tagi/media) + linki.
- **Panele domenowe admina** — Podcasts (shows/episodes/people/settings), Research programs (projects/members/
  partners/items), EU Policy Tracker (items/positions/updates/links), Web Stories, Programs, Categories/Tags/
  Category-colors, Key Takeaways/TOC/Reading Time, Icons, Greetings, Custom-meta, Personalized, Glossary, Authors.
- **Experiments (A/B)** — client-side A/B sekcji buildera z dashboardem (deterministic FNV-1a bucketing 50/50).
- **Obserwowalność** — RUM/error bootstrap idempotentny SSR-safe, GDPR consent-aware teardown, PII redaction.
- **HTTP layer** — SSRF egress guard, rate-limit (in-memory + DB), command idempotency, doc/SSR caching.
- **Zaplecze danych** — ~180 tabel (grupy: CMS, multi-tenant, authz, community, monetyzacja, CRM, newsletter,
  analityka, infra, EU-domain), 915 RLS policies [korekta 02.08: metryka stanu końcowego = 517 polityk],
  7 rozszerzeń (pg_cron, pg_net, pg_trgm, unaccent, vector, supabase_vault, pgtap).
- **Jakość/CI** — bramki blokujące: typecheck → test+coverage → build → bundle-budget → chunk-graph acyclicity →
  lint → SQL tenant-scope → pgTAP; Playwright e2e (smoke + seeded).

---

# CZĘŚĆ III — Załączniki: wyliczenie każdego elementu

## Załącznik A — Wszystkie typy bloków edytora (100+, 8 kategorii)

- **text (9):** `paragraph`, `heading`, `list`, `quote`, `callout`, `pullquote`, `preformatted`, `verse`, `details`
- **media (13):** `image`, `embed`, `video`, `gallery`, `audio`, `cover`, `file`, `media-text`, `image-carousel`,
  `map`, `logo-grid`, `banner-image`, `video-hero`
- **layout (23):** `separator`, `button`, `columns`, `group`, `spacer`, `page-break`, `read-more`, `row`, `stack`,
  `grid`, `buttons`, `social-icons`, `search`, `navigation`, `accordion`, `tabs`, `icon-box`, `hero`, `cta-section`,
  `team-grid`, `feature-grid`, `divider-text`, `step-list`
- **dynamic (26):** `latest-posts`, `tag-cloud`, `categories-list`, `archives`, `calendar`, `post-title`,
  `post-date`, `post-author`, `post-excerpt`, `post-featured-image`, `post-terms`, `site-title`, `site-tagline`,
  `site-logo`, `post-navigation-link`, `query-loop`, `breadcrumbs`, `reading-time`, `share-buttons`, `post-views`,
  `author-bio`, `related-posts`, `post-stats`, `post-rating`, `loginout`, `more-posts`
- **widgets (13):** `code`, `table`, `html`, `liveblog`, `spoiler`, `faq`, `toc`, `xquote`, `compare`, `countdown`,
  `progress`, `poll`, `stats-counter`
- **forms (6):** `newsletter`, `login-form`, `register-form`, `lost-password-form`, `reset-password-form`, `contact-form`
- **marketing (8):** `review`, `proscons`, `affiliate`, `testimonials`, `pricing-table`, `timeline`, `alert-banner`,
  `comparison-table`
- **data (2):** `chart`, `data-map`

## Załącznik B — Wszystkie typy widgetów buildera (75, 7 kategorii)

- **basic (8):** `heading`, `animated-heading`, `text`, `image`, `button`, `divider`, `spacer`, `section-label`
- **media (6):** `video`, `gallery`, `icon`, `map`, `tts`, `slider`
- **dynamic (18):** `chart`, `data-map`, `post-list`, `carousel`, `categories`, `tags`, `news-ticker`,
  `podcast-latest`, `web-stories-carousel`, `post-title`, `post-meta`, `post-tags-dyn`, `post-categories-dyn`,
  `post-author-card`, `post-breadcrumbs`, `post-cover`, `post-excerpt`, `archive-title`
- **features / NES Digital Features (9):** `feature-timeline`, `feature-sankey`, `feature-compare`,
  `feature-risk-matrix`, `feature-indicator`, `feature-network`, `feature-corridor-map`, `feature-sources`,
  `feature-methodology`
- **form (12):** `newsletter`, `contact`, `cta`, `join-us`, `customize-interests`, `donations`, `login-form`,
  `register-form`, `lost-password-form`, `reset-password-form`, `search-form`, `contact-form`
- **navigation (9):** `nav-link`, `mega-menu`, `menu`, `social-icons`, `lang-switcher`, `theme-toggle`,
  `account-link`, `search-button`, `copyright`
- **blocks (13):** `accordion`, `tabs`, `timeline`, `logo-cloud`, `testimonial`, `team-member`, `rich-text`,
  `pricing`, `interactive-circle`, `hot-topic-bar`, `rated-list`, `dark-featured-card`, `ad-slot`

## Załącznik C — Trasy publiczne (frontend)

**Treść i czytanie:** `/` (home), `/blog`, `/post/$slug`, `/preview/$token` (draft embargo), `/series/$slug`,
`/category/$slug`, `/tag/$slug`, `/author/$slug`.
**Odkrywanie:** `/search`, `/sitemap` (HTML), `/publications`, `/reading-list`.
**Typy specjalne:** `/podcasts`, `/podcast/$slug`, `/podcasts/$show`, `/events`, `/events/$slug`, `/experts`,
`/people`, `/contributors`, `/programs`, `/programs/$slug`, `/qa`, `/qa/$slug`, `/polls`, `/glossary`, `/library`,
`/live`, `/web-stories`, `/web-stories/$slug`, `/tracker`, `/tracker/$slug`, `/tracker/changes`, `/tracker/explorer`.
**Społeczność/sieć:** `/network`, `/network/mutual/$userId`, `/messages`.
**Monetyzacja/konto:** `/pricing`, `/checkout/$planId`, `/checkout/success`, `/checkout/cancel`, `/support`,
`/contribute`, oraz `/profile/*` (18 podtras — Załącznik D2).
**Auth/newsletter/prawne:** `/login`, `/reset-password`, `/newsletter/confirm`, `/newsletter/unsubscribe`, `/cookies`.

## Załącznik D — Trasy admina (~90)

**D1. Panele główne:** `admin` (shell), `admin.index` (dashboard), `admin.posts`(+`.$slug`/`.new`/`.calendar`),
`admin.pages`(+`.$slug`/`.new`), `admin.media`, `admin.library`, `admin.categories`, `admin.tags`, `admin.authors`,
`admin.comments`, `admin.glossary`, `admin.key-takeaways`, `admin.toc`, `admin.reading-time`, `admin.custom-meta`,
`admin.icons`, `admin.names`, `admin.greetings`, `admin.redirects`, `admin.link-monitor`, `admin.web-stories`,
`admin.podcasts`, `admin.live-blog`, `admin.tracker`(+`.tracker-guide`), `admin.programs`, `admin.research-programs`,
`admin.expert-requests`, `admin.expert-layouts`, `admin.post-layouts`, `admin.related-posts`, `admin.reading-time`.
**D2. Wygląd/motyw:** `admin.appearance`(+`.header`/`.footer`/`.menu`/`.post-sidebar`/`.category-archive`/
`.tag-archive`), `admin.theme-design`, `admin.theme-options`, `admin.global-colors` (via appearance), `admin.content-area`,
`admin.category-colors`, `admin.crop-sizes`.
**D3. Monetyzacja:** `admin.monetization`, `admin.pricing`, `admin.membership`, `admin.paywall`, `admin.coupons`
(+`.campaigns`/`.redemptions`/`.analytics`), `admin.donations`, `admin.gifting`, `admin.ads`.
**D4. Społeczność:** `admin.community`(+`.index`/`.badges`/`.chat`/`.contributors`/`.engagement`/`.events`/
`.notifications`/`.polls`/`.qa`).
**D5. Newsletter:** `admin.newsletter`(+`.overview`/`.index`/`.inline`/`.popup`/`.subscribers`/`.campaigns`(+`.$id`)).
**D6. CRM:** `admin.crm`(+`.index`/`.$id`/`.funnel.index`), `admin.companies`(+`.index`/`.$id`), `admin.audience`.
**D7. Analityka/SEO/wydajność:** `admin.analytics`, `admin.performance`, `admin.seo`(+`.search-console`),
`admin.experiments`, `admin.personalized`.
**D8. Użytkownicy/ustawienia:** `admin.users`(+`.index`/`.$id`/`.invitations`), `admin.permissions`,
`admin.organizations`(+`.$id`/`.new`), `admin.login-settings`, `admin.integrations`, `admin.workflows`,
`admin.contact`, `admin.settings`(+`.general`/`.reading`/`.discussion`/`.seo`/`.privacy`/`.marketing`/`.analytics`/
`.cookie-banner`/`.design`/`.index`), `admin.super.mobile-drawer`, `admin.import-wordpress`.
**D2b. Podtrasy profilu (`/profile/*`):** `index`, `edit`, `account`, `author`, `social`, `subscription`, `orders`,
`billing`, `membership`, `organization`, `bookmarks`, `follows`, `interests`, `personality`, `expert-requests`,
`security`, `privacy`.

## Załącznik E — Endpointy API / edge (14)

`/api/tts` (TTS edytorski, auth+staff) · `/api/public/post-tts` (TTS publiczny, cache MP3) ·
`/api/public/track` (analytics) · `/api/public/vitals` (Web Vitals) · `/api/public/client-errors` (błędy JS) ·
`/api/public/ad-event` (impresje/kliki reklam) · `/api/public/popup-event` (zdarzenia popupów) ·
`/api/public/related-click` (kliki related) · `/api/public/nl-open` + `/api/public/nl-click` (tracking newslettera) ·
`/api/public/webhooks.stripe` (webhook Stripe) · `/api/public/jobs-tick` (cron jobów) ·
`/api/public/community-cron` (cron społeczności: push/digest/reminders) · `/api/public/hooks.refresh-og-image` (odświeżenie OG).

## Załącznik F — Feedy, sitemapy, crawler, MCP

`/rss.xml` + `/feed` (301) · `/category/$slug/rss.xml` · `/tag/$slug/rss.xml` · `/programs/$slug/rss.xml` ·
`/podcast/rss.xml` (sieć) · `/podcasts/$show/rss.xml` · `/sitemap.xml` · `/news-sitemap.xml` · `/robots.txt` ·
`/llms.txt` · `/web-stories/$slug/amp` (AMP) · `/mcp` + `/.mcp/list-tools` + `/.mcp/invoke-tool/$tool` +
`/.well-known/oauth-protected-resource` (MCP server).

## Załącznik G — Domeny logiki (`src/lib/`, ~70)

`access` (gating/metering) · `ads` · `analytics` (ga4/gsc/audience) · `audio` · `auth` (mfa/bruteforce) ·
`billing` (checkout/entitlement/grant/stripe/tiers/nip) · `blocks` (registry/gutenberg/elementor/convert) ·
`builder` (operations/history/experiments/popups/globalWidgets/templates/migrate) · `charts` · `chat` (27 plików) ·
`citations` · `code` · `comments` · `community` · `content` · `cookieBanner` · `counters` · `crm` (scoring) · `csv` ·
`experts` · `features` (parse/geoProject) · `gifting` · `greetings` · `http` (egressGuard/rateLimit/idempotency/cache) ·
`i18n` · `icons` · `integrations` · `keyTakeaways` · `links` · `locale` · `mcp` · `media` · `mentions` · `menus` ·
`network` · `newsletter` + `newsletter-builder` · `notifications` (webpush/digest/grouping/preferences/consent) ·
`observability` · `onboarding` · `organizations` · `patterns` · `personalization` · `podcast` · `pricing` ·
`profile` · `programs` · `queries` · `realtime` (tableChannelHub/eventInvalidationMap/correlation) · `retention` ·
`routing` · `search` (facetModel/semantic) · `seo` (27 plików) · `server` · `sidebarBuilder` · `theme` · `toc` ·
`tracker` · `views` · `watchdog` · `web-stories` · `wp-import`.

## Załącznik H — Hooki React (35)

`use-in-view`, `useAuth`, `useAuthSettings`, `useAutosave`, `useBookmarks`, `useCheckoutSettings`,
`useContainerWidth`, `useContentAccess`, `useDebouncedValue`, `useEditPresence`, `useExpertLayoutSettings`,
`useFaceAwarePosition`, `useFollowedFeed`, `useFollows`, `useGlobalColors`, `useHasMounted`, `useInterests`,
`useNewsletterSettings`, `usePasswordUnlock`, `usePersonalizedSettings`, `usePostLayoutSettings`,
`usePrefersReducedMotion`, `useReadingTimeSettings`, `useRecommendedPosts`, `useRecordPostView`, `useRevealOnScroll`,
`useSaveArticle`, `useSavedSearches`, `useUndoRedo`, `useUnlockedContent`, `useUnsavedChangesGuard`, `useValidateCoupon`.

## Załącznik I — Grupy tabel DB (~180 tabel) i rozszerzenia

- **CMS/treść:** `posts`, `pages`, `post_authors`, `post_categories`, `post_tags`, `post_series`, `content_revisions`,
  `post_embeddings`, `builder_templates`, `builder_popups`, `builder_global_widgets`, `web_stories`, `media`,
  `media_folders`, `custom_crop_sizes`, `glossary_terms`, `redirects`, `outbound_link_checks`.
- **Multi-tenant/ustawienia:** `tenants`, `site_settings`(+revisions), `site_design_tokens`, `menus`/`menu_items`.
- **AuthZ:** `user_roles`, `role_audit_log`, `impersonation_sessions`, `profiles`, `user_invitations`.
- **Społeczność:** `events`/`event_rsvps`/`event_groups`, `qa_sessions`/`qa_questions`/`qa_question_votes`,
  `polls`/`poll_votes`, `conversations`/`messages`/`message_reactions`/`conversation_nicknames`,
  `user_connections`/`user_follows`/`user_blocks`, `introduction_requests`, `profile_recommendations`,
  `profile_view_events`, `profile_badges`, `profile_skill_endorsements`, `user_reports`, `member_resources`,
  `contributor_submissions`, `expert_*`.
- **Monetyzacja:** `payment_orders`, `user_subscriptions`, `user_purchases`, `membership_tiers`/`membership_grants`,
  `access_plans`, `content_access`, `metered_views`/`metering_settings`, `b2b_coupons`(+campaigns/redemptions),
  `donations`, `billing_documents`/`billing_profiles`, `checkout_settings`, `pricing_audiences`/`pricing_faq_items`,
  `retention_settings`/`retention_reasons`/`retention_feedback`, `gift_article_settings`/`post_gift_links`,
  `ad_slots`/`ad_placements`/`ad_events`, `organization_seats`/`member_organizations`.
- **CRM:** `crm_leads`/`crm_companies`/`crm_tasks`/`crm_lead_notes`/`crm_scoring_settings`/`crm_integrations`.
- **Newsletter:** `newsletter_campaigns`(+recipients/events), `newsletter_subscribers`, `newsletter_settings`.
- **Analityka/obserwowalność:** `analytics_events`, `web_vitals`, `client_errors`, `post_views`, `popup_events`,
  `related_post_clicks`, `search_query_log`, `seo_404_hits`, `audit_log`, `domain_events`.
- **Infra/plumbing:** `command_idempotency`, `rate_limits`, `job_runner_settings`, `workflow_definitions`/
  `workflow_runs`/`workflow_templates`, `integration_endpoints`/`integration_deliveries`, `push_subscriptions`/
  `notification_push_queue`, `notifications`, `user_consents`/`user_consent_events`, `*_pending_counters`.
- **EU-domain:** `eu_policy_items`/`eu_policy_updates`/`eu_policy_follows`/`eu_policy_positions`, `research_programs`
  (+members/partners/projects/items), `programs`, `regions`, `name_dictionary`, `personality_questions`/`personality_results`.
- **Rozszerzenia Postgres (7):** `pg_cron` + `pg_net` (cron→HTTP), `pg_trgm` + `unaccent` (FTS/fuzzy),
  `vector` (embeddingi semantyczne), `supabase_vault` (sekrety), `pgtap` (testy DB).

## Załącznik J — Klucze ustawień, taksonomie, typy treści

- **Klucze `site_settings` (przykłady):** `auth_branding`, `cookie_banner_config`, `key_takeaways`,
  `reading_time`, `seo`, `toc_defaults`, `header`, `footer`, `community_modules`, `discussion`, `analytics`,
  `marketing`, `greetings`, `personalized`, `checkout_settings`, `metering_settings`.
- **Taksonomie treści:** kategorie, tagi, programy (`post_programs`), regiony (`post_regions`), serie (`post_series`).
- **Typy treści:** wpisy (posty/analizy), strony (builder), podcasty (shows/odcinki), wydarzenia, sesje Q&A,
  ankiety, web stories, dossier trackera legislacyjnego, programy badawcze, zasoby biblioteki członków, glossary.
- **Role:** `super_admin` > `admin` > `editor` / `author` > `user` (+ role organizacji: owner/member).
- **Tryby dostępu treści:** `public` / `members` / `paid` / `password` (+ nakładka meteringu).
- **Kanały dystrybucji:** RSS (główny/kategoria/tag/program/podcast), news-sitemap, sitemap, llms.txt, web-push,
  digest email, newsletter, MCP (dla LLM).

---

_Dokument towarzyszący: `OCENA_FUNKCJI_2026-07-24.md` (oceny 0–10) i `OCENA_FUNKCJI_KONKURENCI_2026-07-24.md`
(porównanie z konkurencją). Stan: 2026-07-24._
