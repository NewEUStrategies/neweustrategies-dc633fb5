# Ocena platformy i modułów NES — audyt krytyczny (2026-07-23)

> Kompleksowa, krytyczna ocena każdej funkcjonalności platformy i każdego modułu:
> mocne strony, wykryte błędy (z odniesieniami `plik:linia`) oraz rekomendacje z
> priorytetami. Dokument obejmuje również — zgodnie z rozszerzonym zakresem —
> mechanikę wpisów i stron, ładowanie i przejścia między stronami, ekosystem i
> zarządzanie społecznością oraz interakcje między użytkownikami i z treścią.

## Metodyka

Audyt przeprowadzono przez 10 równoległych, głębokich przeglądów kodu (czytanie
rzeczywistych plików `src/` i migracji `supabase/migrations/`, a nie dokumentacji),
uzupełnionych własną weryfikacją najpoważniejszych ustaleń bezpośrednio w kodzie i
w łańcuchu migracji. Ustalenia oznaczone jako **POTWIERDZONE** zostały niezależnie
zweryfikowane w tym audycie; pozostałe to uzasadnione ryzyka do potwierdzenia
testem.

**Legenda severity:** `BUG` = potwierdzony defekt; `RYZYKO` = warunkowy/edge-case;
`DŁUG` = dług techniczny/spójności; `BRAK` = brakująca funkcja.
**Priorytety:** `P0` = krytyczny (naprawić natychmiast); `P1` = ważny; `P2` = do
uporządkowania.

---

## 1. Streszczenie wykonawcze

New European Strategies to **dojrzała, wielotenantowa platforma treści i członkostwa**
(TanStack Start SSR + React 19 + Supabase Postgres z RLS): 412 migracji, ~90 tras
admina, ~80 tras publicznych, 118 modułów `lib/`. Silnik treści jest hybrydowy
(bloki dla artykułów, builder dla stron), z warstwą spójności międzymodułowej
(szyna zdarzeń domenowych), monetyzacją (Stripe, prezenty artykułów, organizacje),
CRM z lead-scoringiem, newsletterem z własnym kreatorem e-maili, rozbudowaną
społecznością (połączenia, czat, Q&A, ankiety, wydarzenia, reputacja) oraz pełnym
zapleczem SEO/crawler/feedy.

**Werdykt ogólny:** platforma jest napisana **nieprzeciętnie starannie jak na tę
skalę**. Powtarzają się wzorce klasy produkcyjnej: fail-closed w warstwie crawlera,
sanityzacja dwusilnikowa treści (DOMPurify + allowlist-walker SSR), sekrety w
Supabase Vault, HMAC per-endpoint integracji, atomowe claimy z dzierżawą w
wysyłce, idempotencja per odbiorca na poziomie DB, poprawny half-life w scoringu,
weryfikacja podpisu Stripe, izolacja błędów renderu per widget. Zespół świadomie
dokumentuje decyzje i „footguny".

**Jednak** audyt wykrył konkretny zestaw regresji i luk, w tym **dwie potwierdzone
luki bezpieczeństwa P1** i **jeden defekt P0 wdrożeniowy**, które podważają część
tych gwarancji:

| # | Ustalenie | Sev | Prio | Status |
|---|-----------|-----|------|--------|
| 1 | Kolizja timestampów migracji `20260723180000` (chat_plus vs expert_request_quota) — dla NOWYCH tenantów cicho cofa naprawę czatu i katalog cennika v5 | BUG | **P0** | POTWIERDZONE |
| 2 | `authenticated` ma table-wide `SELECT` na `public.profiles` → każdy staff (nawet `author`) czyta e-maile/prefs/telefony wszystkich profili tenanta; łatka „Fixed security issues" domknęła tylko `anon` | BUG | **P1** | POTWIERDZONE |
| 3 | `crm_upsert_lead(_tenant,…)` `SECURITY DEFINER` bez autoryzacji, `GRANT … TO authenticated` → cross-tenant zapis leadów + fałszowanie `marketing_consent` | BUG | **P1** | POTWIERDZONE |
| 4 | LIKE-injection w ścieżkach folderów mediów (`%`/`_`) → `deleteMediaFolder(recursive)` może skasować cudze media w tenancie | BUG | **P0/P1** | POTWIERDZONE (regex) |
| 5 | `href` widgetu buildera renderowany bez `safeUrl()` → `javascript:`/`data:` na stronie publicznej (stored XSS) | RYZYKO | **P1** | POTWIERDZONE |
| 6 | Wyścig + obejście kwoty „Zapytanie do eksperta" (TOCTOU + send→cancel→send) | BUG | **P1** | POTWIERDZONE |
| 7 | Wyciek przychodu między tenantami w `monetization_dashboard` (CTE `orders` bez `tenant_id`) | BUG | **P1** | POTWIERDZONE |
| 8 | `/programs/$slug/rss.xml` odpytuje złą tabelę (`programs` zamiast `research_programs`) → 404 lub treść innego programu | BUG | **P1** | POTWIERDZONE |
| 9 | Obejście moderacji komentarzy przez edycję po zatwierdzeniu (status nie resetowany) | RYZYKO | **P1** | POTWIERDZONE |
| 10 | `/messages` bez bramki `chat_enabled` — „wyłączony" moduł czatu działa przez URL | RYZYKO | **P1** | POTWIERDZONE |
| 11 | Mismatch hydratacji buildera na mobile (`device ?? detectViewportDevice()`) → CLS | RYZYKO | **P0/P1** | POTWIERDZONE |

Poza tym ~15 ustaleń P1 i ~50 P2 opisanych w sekcjach 4 i 5.

---

## 2. Sygnały jakości przekrojowej (pomiary własne)

- **Bramki CI:** kolejność typecheck → testy+pokrycie → build → budżet bundla →
  lint (wszystkie blokujące); osobny job pgTAP (RLS/role/FTS) i E2E (smoke +
  seeded). **Lighthouse domyślnie NIEwiążący** (MODE B, `continue-on-error`) — o
  ile `LHCI_URL` nie jest ustawione, jedynym realnym progiem wydajności jest
  budżet bundla. **Rekomendacja P2:** ustawić `LHCI_URL` na wdrożony podgląd, by
  wydajność stała się bramką.
- **Pokrycie testami:** 337 plików testowych, ale **uczciwie zmierzone pokrycie repo
  to ~19,7% instrukcji / ~16,2% gałęzi / ~13% funkcji** (progi „ratchet" w
  `vitest.config.ts`). Konfiguracja wprost przyznaje, że wcześniejsze „98%" było
  artefaktem whitelisty 38 plików — plus za transparentność, ale realne pokrycie
  jest niskie. Krytyczne ścieżki (widget-view, `contentEngine`, Stripe webhook,
  `grant.server`) mają wysokie progi per-plik — dobra strategia, ale środek masy
  kodu jest nieprzetestowany.
- **Dług typów/bezpieczeństwa:** `strict: true`, ale `noUnusedLocals/Parameters:
  false`, `skipLibCheck: true`; **223× `as any`**; **68 miejsc
  `dangerouslySetInnerHTML`** — próbki zweryfikowane: **sanityzacja jest
  konsekwentna** (JSON-LD przez `safeJsonLd`, treść przez centralny `sanitizeHtml`,
  CSS przez `hardenStyleCss`, `SearchSnippet` celowo bez wstrzykiwania HTML). To
  mocna strona, nie dług — z dwoma wyjątkami (poz. 5 powyżej i fallback w
  `atoms.tsx`).
- **CSP:** kompletny zestaw nagłówków (HSTS 2 lata, `nosniff`, `frame-ancestors
  'self'`, `object-src 'none'`, `script-src-attr 'none'`), ale `script-src`
  zawiera `'unsafe-inline'` (uzasadnione brakiem wsparcia nonce w tej wersji
  TanStack Start) — CSP nie blokuje więc wykonania wstrzykniętego skryptu inline.

---

## 3. Najpoważniejsze ustalenia — szczegóły P0/P1 (potwierdzone)

### P0-1. Kolizja timestampów migracji `20260723180000`
Dwie migracje mają identyczny prefiks: `20260723180000_chat_plus_tier_gating_and_benefit.sql`
oraz `20260723180000_expert_request_quota.sql`. Obie robią
`CREATE OR REPLACE FUNCTION public.seed_pricing_defaults`. Sortowanie leksykalne
uruchamia je w kolejności `chat_plus` → `expert_request_quota`, więc **wersja z
`expert_request_quota` wygrywa** — a jej ciało wywołuje tylko
`apply_pricing_catalog_v4` i **nie** wywołuje `seed_chat_tier_flags` ani
`apply_pricing_catalog_v5`. Skutek dla KAŻDEGO nowo zakładanego tenanta: czat
wyłączony na wszystkich progach (regresja naprawy z `chat_plus`) i brak treści
cennika v5 na `/pricing`. Defekt niewidoczny w review, bo oba pliki wyglądają na
kompletne.
**Rekomendacja P0:** przenumerować `expert_request_quota` na późniejszy timestamp i
scalić ciało `seed_pricing_defaults`, by zawierało jednocześnie kwotę
expert-request, `seed_chat_tier_flags` i `apply_pricing_catalog_v5`. Dodać test
weryfikujący flagi tieru + katalog dla świeżego tenanta.

### P1-2. `authenticated` czyta PII wszystkich profili tenanta (regresja)
Łańcuch grantów na `public.profiles` (zweryfikowany chronologicznie): stan
poprawny (kolumnowy) był utrzymany po `20260708170000`, ale **migracja
`20260721202956_b111ae89:1` przywróciła `GRANT SELECT, INSERT, UPDATE ON
public.profiles TO authenticated`** (grant table-wide). Zgodnie z wielokrotnie
dokumentowanym w repo „footgunem" (`20260703090100:9-21`) grant na poziomie tabeli
unieważnia wszystkie kolumnowe `REVOKE` (`email`, `prefs`, `contact_email`,
`phone`, `gender`, `location`). Najnowszy commit „Fixed security issues"
(`20260723151902:15`) cofnął `SELECT` **tylko dla `anon`** — po grancie z
`20260721202956` **nie ma żadnego kolumnowego ani tabelarycznego REVOKE dla
`authenticated`**. W połączeniu z polityką `"Profiles authenticated read"`
(`USING id = auth.uid() OR (tenant_id = current_tenant_id() AND is_staff())`) **każdy
członek staffu, w tym nisko-zaufany `author`, może odczytać PII (e-maile, zgody
`prefs`, telefony) wszystkich profili w tenancie.** To łamie istniejący test
`supabase/tests/profiles_pii_grant_test.sql:18-52`.
**Rekomendacja P1:** `REVOKE SELECT ON public.profiles FROM authenticated` +
przywrócić jawny grant kolumnowy z listy `20260703090100:36-63` (bez kolumn PII);
uruchamiać `profiles_pii_grant_test.sql` jako bramkę CI; dodać lint blokujący
table-wide `GRANT SELECT ON public.profiles` (regresja powtarza się ~5. raz).
**Powiązane P2:** ta sama łatka ustawiła `profiles_public` na `security_invoker=on`
bez grantu bazowego dla `anon` → publiczny odczyt profili może zwracać „permission
denied" (fail-closed, ale regresja funkcjonalna — może zepsuć publiczne strony
autorów).

### P1-3. `crm_upsert_lead` — cross-tenant zapis bez autoryzacji
Funkcja `crm_upsert_lead(_tenant, …)` (`20260630060254:29-82`) jest `SECURITY
DEFINER`, bierze `_tenant` z parametru klienta i **nie ma żadnej kontroli
autoryzacji** (brak `has_role`/`is_staff`/porównania z `current_tenant_id()`).
Jest `GRANT EXECUTE … TO authenticated` (`20260630053423:5`), bez późniejszego
REVOKE. Każdy zalogowany użytkownik może wywołać ją bezpośrednio przez PostgREST i
wstrzyknąć/nadpisać leady w **dowolnym** tenancie oraz — przez
`marketing_consent = marketing_consent OR _marketing` — **wymusić fałszywą zgodę
marketingową** (integralność danych / RODO). Aplikacja nie woła tego RPC z klienta
(wywołania są tylko z innych funkcji serwerowych), więc grant to zbędna powierzchnia
ataku.
**Rekomendacja P1:** `REVOKE EXECUTE … FROM authenticated` (zostawić `service_role`)
lub dodać guard `IF _tenant <> current_tenant_id() OR NOT is_staff() THEN RAISE`.

### P0/P1-4. LIKE-injection w folderach mediów
`FOLDER_PATH_RE` (`media.functions.ts:395`) dopuszcza znaki `%` i `_`, a
`renameMediaFolder`/`deleteMediaFolder` używają ścieżki wprost w
`.like("path", "${path}%")` (`:661,676,710,719,738`). Folder o nazwie zawierającej
`%`/`_` dopasowuje szerszy zbiór — przy `deleteMediaFolder(recursive)` grozi to
**skasowaniem lub przeniesieniem cudzych mediów w obrębie tenanta** (utrata danych).
**Rekomendacja P0/P1:** escapować `%`/`_` przed `.like` (lub usunąć je z regexu).

### P1-5. `href` widgetu buildera bez sanityzacji URL
`BuilderRenderer.tsx:841` renderuje `href={w.advanced.link.url}` **bez `safeUrl()`**
— jedyny href w całym builderze pominięty (pozostałe w `WidgetView.tsx` przechodzą
przez `safeUrl`). Autor (w tym role `author`/`editor`) może ustawić w „linku"
widgetu `javascript:…`/`data:text/html,…`; wartość ląduje na stronie publicznej i
React ją wyrenderuje. **Rekomendacja P1:** owinąć w `safeUrl(...)`.

### P1-6. Kwota „Zapytanie do eksperta" — wyścig i obejście
`send_expert_request` (`20260723180000_expert_request_quota`) liczy `used`, sprawdza
limit i `INSERT` bez `LOCK`/unikalnego ograniczenia → **TOCTOU**: równoległe
wywołania przy quota=1 wstawią dwa rekordy. Dodatkowo `my_expert_request_quota`
liczy `status <> 'cancelled'`, a nadawca może anulować własne zapytanie — pętla
send→cancel→send **zeruje licznik**, umożliwiając nieograniczony spam eksperta.
**Rekomendacja P1:** advisory lock na `sender_id` + liczyć wysłane niezależnie od
statusu (albo „w tym miesiącu" bez odliczania anulowanych).

### P1-7. Wyciek przychodu między tenantami w `monetization_dashboard`
CTE `orders` (`20260721070203:206-212`) odpytuje `payment_orders` **bez `tenant_id =
v_tenant`**, gdy wszystkie pozostałe CTE filtrują po tenancie; funkcja jest
`SECURITY DEFINER` (RLS pominięte). Admin/edytor każdego tenanta widzi globalną
liczbę zamówień i sumę `revenue_cents` wszystkich tenantów.
**Rekomendacja P1:** dodać `AND tenant_id = v_tenant` + test pgTAP izolacji.

### P1-8. RSS programów odpytuje niewłaściwą tabelę
`/programs/$slug/rss.xml` → `taxonomyFeedResponse("program")` używa tabeli
`programs` + join `post_programs` (`publishedContent.server.ts:348-351`), podczas
gdy landing `/programs/$slug` i sitemap używają `research_programs`
(`category_id`→`post_categories`). To rozłączne byty i przestrzenie slugów — feed
zwraca **404 dla poprawnego slugu** albo (przy kolizji) serwuje wpisy innego
programu. **Rekomendacja P1:** przełączyć `program` w `TAXONOMY_TABLES` na
`research_programs` albo odpiąć trasę.

### P1-9. Obejście moderacji komentarzy przez edycję
`comments_guard_update` (`20260713140000:143-153`) pozwala autorowi edytować `body`
przez 15 min od utworzenia i **nie resetuje statusu**. Scenariusz: treść neutralna →
moderator zatwierdza (`approved`) → autor w oknie 15 min podmienia na złośliwą;
komentarz pozostaje `approved`. **Rekomendacja P1:** przy włączonej moderacji i
`OLD.status='approved'` edycja `body` przez nie-staff powinna resetować
`status := 'pending'`.

### P1-10. `/messages` bez bramki `chat_enabled`
`messages.tsx` nie używa `useCommunityModules`/`CommunityDisabled` — w
przeciwieństwie do `network/events/qa/polls`. Wyłączenie „Chat" w panelu admina
ukrywa jedynie przyciski (`DirectMessageButton.tsx:60`), a trasa `/messages` i
`ChatWindow` działają dalej przez bezpośredni URL/`ProfileNav`. Łamie deklarację
panelu (`admin.community.index.tsx:156`). **Rekomendacja P1:** dodać gate
`chat_enabled` w `messages.tsx`.

### P0/P1-11. Mismatch hydratacji buildera na mobile
Inicjalizator stanu `device ?? detectViewportDevice()` (`BuilderRenderer.tsx:185-186`)
przy `device=undefined` (ścieżka publiczna) na kliencie czyta `window.innerWidth`,
więc pierwszy render na telefonie liczy `"mobile"`, gdy SSR/cache wyemitował
`"desktop"` (inne `gridTemplateColumns`). To rozjazd SSR↔klient na najczęstszej
klasie urządzeń → rekonsyliacja poddrzewa + CLS. Komentarz deklaruje „desktop-first",
kod tego nie realizuje. **Rekomendacja P0/P1:** zmienić na `device ?? "desktop"`,
pozostawiając korektę w istniejącym layout-effekcie; zweryfikować RUM CLS mobile.

---

## 4. Ocena po obszarach

### 4.1. Silniki treści i edytory (bloki, builder, dyspozytor)
**Cel:** hybrydowy render treści — bloki (artykuły) i builder (strony), z jednym
punktem decyzji `resolveContentEngine`.
**Mocne strony:** logika renderu naprawdę scentralizowana (`contentEngine.ts`), fasada
`ContentRenderer` bez rozgałęzień; `safeParseBlocks`/`safeParseBuilderDoc` degradują
per-element (jeden zły blok nie kasuje artykułu); drift-guard typów wymusza
kompletność rejestru bloków/widgetów; ID buildera z pozycji (bez rozjazdu SSR);
`useAutosave` wzorcowy (serializacja zapisów, `flush()` odrzuca przy błędzie —
koniec z fałszywym „Zapisano"); rewizje throttlowane + limit 50 + guard na ciche
odrzucenie RLS; sanityzacja dwusilnikowa i cytaty deterministyczne (UTC, bez `Intl`,
brak mismatchu).
**Słabości/błędy:**
- **[RYZYKO P1]** `href` widgetu bez `safeUrl` (`BuilderRenderer.tsx:841`) — patrz P1-5.
- **[RYZYKO P1]** Brak optimistic-concurrency: `updatePost`/`updatePage`
  (`content.functions.ts:542-546`) `UPDATE` bez guardu `updated_at` → przy dwóch
  edytorach **last-write-wins, ciche nadpisanie**; presence to tylko świadomość.
- **[RYZYKO P1]** Strony (builder) **bez autosave** (`admin.pages.$slug.tsx:258`,
  `enabled:false`) → crash/zamknięcie karty = utrata pracy od ostatniego ręcznego
  zapisu. Asymetria wobec postów (autosave 1,5 s).
- **[DŁUG P2]** Fallback `str(...)` niesanityzowany do `dangerouslySetInnerHTML`
  (`atoms.tsx:14,84`) — dziś nieosiągalny (zależny od kompletności
  `precomputeFootnotes`), ale krucha zależność; owinąć w `sanitize()`.
- **[RYZYKO P2]** Dynamiczne klasy Tailwind `grid-cols-${n}` (`organisms.tsx:96`,
  `PresentationViews.tsx:380`) działają tylko przez przypadkowe dosłowne wystąpienia
  w innych plikach — usunięcie któregoś po cichu psuje siatkę bloków.
- **[RYZYKO P2]** Rozjazd polityki `style` SSR (odrzuca `url()`) vs DOMPurify
  (przepuszcza) → potencjalny mismatch; SSR nie wymusza `rel="noopener"` przy
  `target="_blank"`.
- **[DŁUG P2]** Brak testu parytetu i18n dla bundli `i18n-admin-blocks`/`i18n-builder`
  (`i18nParity.test.ts:26` pokrywa tylko `adminPostPanes`); import HTML→builder
  zawsze zeruje EN (`convert.ts:70`).
- **[DŁUG]** Dryf dokumentacji: `ARCHITECTURE.md:190` nazywa presence „soft lock",
  a kod nie lockuje; komentarz `useAutosave.ts:10-13` twierdzi, że strony nie mają
  rewizji — mają.

### 4.2. Mechanika ładowania, nawigacji i przejść (SSR/routing) — *zakres rozszerzony*
**Cel:** szybkie ładowanie wpisów/stron, płynne przejścia SPA, stany ładowania i
izolacja błędów.
**Mocne strony:** i18n per-request `cloneInstance` (brak wycieku języka między
renderami) — wzorcowe; root loader `allSettled` z fallbackami (awaria backendu nie
wywala witryny); jeden punkt decyzji silnika + preload cover LCP odwzorowujący
`srcSet`; kontrakt cache „by construction" (klucz zawsze prefiksowany hostem tenanta,
BYPASS przy `Authorization`/cookie `sb-*`, single-flight SWR z fallbackiem na stale);
`RenderErrorBoundary` per sekcja/widget (zepsuty widget nie 500-uje strony); komplet
`pending/error/notFound` na trasach; `OptimizedImage` z rezerwacją `aspectRatio`;
ciężkie nakładki i `echarts` poza bundlem czytnika.
**Słabości/błędy:**
- **[RYZYKO P0/P1]** Mismatch hydratacji buildera na mobile — patrz P1-11.
- **[RYZYKO P1]** Waterfall danych na zimnym renderze wpisu (`public.ts:379→401→434→488`):
  `resolve_path` → `Promise.all(7)` → profil autora → współautorzy = 3-4 sekwencyjne
  warstwy round-tripów na krytycznej ścieżce TTFB. Złączyć profil autora do RPC.
- **[DŁUG P1]** `customMetaDefs` nie prefetchowane w loaderze (`$.tsx:604-608`) →
  pop-in nadpisów meta po hydratacji.
- **[RYZYKO P1]** `RouteProgress` reaguje na `useIsFetching/useIsMutating`
  (`RouteProgress.tsx:20-22`), nie tylko na nawigację → pasek pełznie do 90% przy
  tłowych fetchach, choć artykuł jest już czytelny (mylący sygnał wydajności).
- **[RYZYKO P1]** Trójwarstwowy, częściowo marnowany prefetch: Speculation Rules
  `prerender` pełnego dokumentu + `AppLink.handleClick` `preventDefault`+`navigate`
  (`AppLink.tsx:77`) → przeglądarka nigdy nie aktywuje prerenderu (brak nawigacji
  dokumentowej), wyrenderowana strona porzucona; dodatkowo `defaultPreload:"intent"`
  + ręczny `preloadRoute` (redundancja). Ograniczyć do `prefetch`.
- **[DŁUG P1]** Blocks renderer importuje **eagerly wszystkie** widoki bloków
  (`organisms.tsx:18-43`: LiveBlog, Poll, Calendar, QueryLoop…) → czytelnik zwykłego
  artykułu ściąga kod wszystkich typów. Zlazy-load'ować ciężkie/rzadkie.
- **[RYZYKO P1]** CLS treści importowanej: `enhanceContentImages` nie dodaje
  `width/height` (`enhanceImages.ts:41-51`) → skok layoutu na obrazach WordPress.
- **[RYZYKO P1]** Krucha integracja: `setTimeout(0)` przed hydratacją
  (`router.tsx:88-92`) — obejście na osadzenie chunków streamu; może przestać
  działać po aktualizacji `ssr-query`.
- **[DŁUG P2]** `edgeTtlCache` bez single-flight → „thundering herd" na
  `home-page`/`home-mode` przy wygaśnięciu 60 s; rozjazd świeżości `s-maxage=900`
  (CDN) vs cap 180 s edge cache; `ContentSkeleton` niezgodny geometrią z realnym
  layoutem (skok przy nawigacji); TOC `<a href="#">` bez handlera mimo obiecanego
  „rail scroller" (`router.tsx:48-50`).

### 4.3. Interakcje czytelnika z treścią — *zakres rozszerzony*
**Cel:** zapisywanie, udostępnianie, prezent artykułu, obserwowanie, komentarze,
feedback, TTS, pasek postępu.
**Mocne strony:** `GiftArticleButton` wzorcowy (maszyna faz + retry + `role="alert"`
+ licznik); `FloatingShareBar` dopracowany (pierścień postępu, scrollspy ToC z
IntersectionObserver, focus trap, mobilny bottom sheet, `rafThrottle`);
`useSaveArticle` trójpoziomowy (DB/localStorage/nudge) z TTL gościa i mergem po
zalogowaniu; `profile.bookmarks` uczciwie pokazuje pozycje „niedostępne" zamiast
cichego znikania; `FollowButton` z `aria-pressed` i pełnym pokryciem typów
(autor/kategoria/tag/program).
**Słabości/błędy:**
- **[BUG P1]** Podwójne wysłanie edycji komentarza: `CommentComposer submitting={false}`
  na sztywno (`CommentsSection.tsx:616-626`), `edit.isPending` nieprzekazane →
  „Zapisz zmiany" nie blokuje się.
- **[DŁUG P1]** Duplikacja „zapisanych": `/reading-list` filtruje `entity_type ===
  "post"` (`reading-list.tsx:216`) i **pomija zapisane strony**, a `/profile/bookmarks`
  pokazuje oba — ta sama tabela, dwa UI. Zunifikować.
- **[DŁUG P2]** Brak optymistycznego update i stanu `pending` dla bookmark/follow/vote
  (`useBookmarks.ts:30-61`, `FollowButton.tsx:42-46`) → przyciski wyglądają na
  martwe przy wolnej sieci; kruche wykrywanie duplikatu po `message.includes("duplicate")`
  (`useBookmarks.ts:48`) vs poprawny `ignoreDuplicates` w `useFollows`.
- **[DŁUG P2]** Trzy różne strategie i18n w sąsiednich akcjach (hardcoded `COPY` w
  `FloatingShareBar:87-122`, `react-i18next` w gift, inline `t(pl,en)` w follow);
  niespójna obsługa błędu kopiowania (share cichy, gift `toast.error`).
- **[RYZYKO P2]** Brak potwierdzenia/undo przy usuwaniu zakładki
  (`profile.bookmarks.tsx:190`) i komentarza (`CommentsSection.tsx:660-668`), mimo że
  reszta apki konsekwentnie potwierdza akcje nieodwracalne.
- **[BRAK P2]** Brak `navigator.share` (Web Share API) na mobile; brak lekkiego
  systemu reakcji/oklasków (tylko binarne kciuki `PostFeedback`).

### 4.4. Ekosystem i zarządzanie społecznością + interakcje user↔user — *zakres rozszerzony*
**Cel:** połączenia, wiadomości/czat, Q&A, ankiety, wydarzenia, reputacja, profile,
panele moderacji/konfiguracji.
**Mocne strony:** `ConnectButton` to wzorzec (maszyna stanów + `AlertDialog` dla
KAŻDEJ nieodwracalnej akcji + komunikaty błędów DB + `aria-label`); RSVP wydarzeń
serwer-autorytatywny (capacity pod `FOR UPDATE`, waitlist FIFO, tier-gating,
„Dodaj do kalendarza"); `PollCard` z anti-anchoringiem i `my_vote`; `messages.tsx`
bogaty (FTS, filtry `role=radiogroup`, `role=tablist` poprawnie, `ssr:false`);
`author.$slug` spina Follow+Connect+DM+RequestIntroduction+Report;
`/contributors` — leaderboard reputacji opt-in.
**Słabości/błędy:**
- **[RYZYKO P1]** `/messages` bez gate `chat_enabled` — patrz P1-10.
- **[BUG/DŁUG P1]** Niespójne głosowanie Q&A vs ankiety: `PublicQaQuestion` bez flagi
  `my_vote` (`publicQueries.ts:298`), przycisk `qa.$slug.tsx:249-259` bez
  `aria-pressed`/stanu „zagłosowano"; ponowny klik cicho ignorowany → użytkownik nie
  wie, czy głos się zaliczył. Dodać `my_vote`/`aria-pressed` dla parytetu z ankietami.
- **[BRAK/DŁUG P1]** Moderacja bez akcji masowych (`admin.comments.tsx` i chat —
  rekord po rekordzie) i bez akcji na sprawcy ze zgłoszenia (`NetworkPanel` tylko
  „Rozstrzygnij/Oddal", `admin.community.index.tsx:393-408` — brak block/suspend/warn).
- **[DŁUG P2]** Badges: przyznanie wymaga wklejenia surowego UUID (`badges.tsx:80`) —
  brak user-pickera; odbieranie używa `window.confirm()` (`:140`) zamiast
  `AlertDialog`. Contributors: werdykt nieodwracalny (`contributors.tsx:142-176`).
- **[RYZYKO a11y P2]** `network.tsx:611-640` używa Radix `Tabs` bez `TabsContent` →
  `aria-controls` wskazuje nieistniejący `tabpanel` (SR zgłasza brak panelu).
- **[DŁUG P2]** Surowy enum `r.reason` w panelu zgłoszeń (`admin.community.index.tsx:385`)
  vs lokalizowany w `ReportUserDialog`; reputacja read-only w adminie (progi zaszyte
  w kodzie, brak edycji z UI); powiadomienia bez własnej trasy
  (`/messages?view=notifications`, `ProfileNav.tsx:65`).
- **[DŁUG P2]** `@`-wzmianki: **backend istnieje** (`process_mentions`, migracja
  `20260711201000` — parsuje `@slug` w komentarzach/wiadomościach, tworzy krawędź
  `mention`, `enqueue_notification`, emituje `mention.created.v1` obecne w
  `domainEvents.ts:30`), ale **brak warstwy UI** (autouzupełniania `@` w
  `ChatComposer`/`CommentsSection`) → funkcja jest nieodkrywalna. Dodać typeahead
  `@user` + render powiadomienia „mention".
- **[DŁUG P2]** Trasy-sieroty `/live` i `/publications` — brak w domyślnym menu
  (`chromeDefaults.ts`), osiągalne tylko przez sitemap/URL; brak kreatora onboardingu
  nowego członka.

### 4.5. Realtime i warstwa spójności (szyna zdarzeń domenowych)
**Cel:** jedna szyna `domain_events` + współdzielone kanały zamiast nasłuchu tabel
per moduł; liczniki, presence, idempotencja, workflowy.
**Mocne strony:** parytet katalogu `DOMAIN_EVENT_TYPES` z emiterami się trzyma (brak
sieroty/emitera bez reguły inwalidacji); `tableChannelHub` z poprawnym refcountem i
cleanupem we wszystkich hookach (**brak leaków websocketów** — celowana weryfikacja);
liczniki atomowe (`ON CONFLICT DO UPDATE SET value = GREATEST(0, value+delta)`);
`pg_trigger_depth() > 8` chroni workflowy przed rekurencją.
**Słabości/błędy:**
- **[RYZYKO P2]** Wszystkie triggery bumpów liczników łykają błędy (`EXCEPTION WHEN
  OTHERS`) → przejściowy błąd trwale rozjeżdża licznik; **brak okresowego
  reconcile** (pg_cron). Dodać nocny reconcile (jest wzorzec `reconcile_engagement`).
- **[DŁUG P2]** Podwójny cache „unread" (`useUnreadCount` vs
  `useUserCounter`) odświeżany różnymi ścieżkami → ryzyko chwilowego rozjazdu badge;
  martwy realtime `tenant_pending_counters` (`usePendingCounters.ts:81-86`, brak
  `{tenant:true}`); podwójne przetwarzanie zdarzeń na `/admin/crm` (globalny +
  `useModuleRealtime`).
- **[DŁUG P2]** Kanał DB czatu nie `private:true` (`useMessages.ts:516`) — polega na
  RLS `postgres_changes` (niespójne z resztą utwardzenia); polls/QA/badges bez
  zdarzeń domenowych → głosy innych nie aktualizują się na żywo; listy community bez
  paginacji (hard `.limit(200/100/300)`).

### 4.6. Monetyzacja (billing, checkout, paywall, prezenty, kupony, organizacje)
**Cel:** katalog cennika, checkout Stripe, paywall+metering, prezenty artykułów,
kupony B2B, miejsca w organizacjach, zmiana planu z proracją.
**Mocne strony:** **weryfikacja podpisu Stripe poprawna** (HMAC-SHA256,
`timingSafeEqual`, multi-`v1`, tolerancja 5 min, surowy body — `webhooks.stripe.ts:41-54`,
test pokrywa); idempotencja per-handler solidna (grant na `external_ref`, `paid_at`
z `.neq`); grant NAJPIERW, potem status (naprawiony „charged, no access"); refund
zawężony do jednej subskrypcji; `org_add_seat` wzorcowa serializacja `FOR UPDATE`;
`redeem_b2b_coupon` atomowy; konwersja walut serwerowa z parytetem wymuszanym typami;
metering/gift body wyłącznie `SECURITY DEFINER`.
**Słabości/błędy:**
- **[BUG P1]** Wyciek przychodu między tenantami w `monetization_dashboard` — P1-7.
- **[BUG/RYZYKO P1]** Niespójna waluta audytu kuponu przy EUR:
  `redeem_b2b_coupon` zapisuje kwoty w PLN z etykietą `_currency='EUR'`
  (`checkout.functions.ts:202-209`) → dashboard sumuje `applied_cents` mieszając
  rzędy wielkości PLN/EUR.
- **[RYZYKO P1]** Domyślne ustawienia Gift Articles = obejście paywalla:
  `monthly_limit=0` (bez limitu), `link_ttl_days=0` (bezterminowo),
  `redeem_gift_link` bez capu odsłon (`20260722112736:9-12,320-375`) → jeden
  subskrybent może opublikować kody na cały katalog premium. Ustawić bezpieczne
  domyślne + `max_redemptions_per_link`.
- **[RYZYKO P2]** `redeem_b2b_coupon_with_effects` nadaje warstwę członkostwa **bez
  weryfikacji realnej płatności** (`20260721082414:131-190`) — kupon typu
  `grants_tier` staje się darmowym tokenem premium, bramkowanym tylko tajnością kodu.
- **[RYZYKO P2]** TOCTOU w meteringu (`consume_metered_view`, `20260721120000:338-373`)
  i w limicie prezentów (advisory lock kluczowany `user:post`, nie serializuje
  różnych wpisów) → przekraczalne limity przy współbieżności.
- **[DŁUG P2]** Kupony B2B: brak `per_user_limit`, `organization_id` nieegzekwowane;
  faktury Stripe (`billing_documents.hosted_url`) z PII widoczne dla całego staffu
  (rozważyć zawężenie do `admin`); brak tabeli dedupu `event.id` webhooka;
  mylący `GRANT … INSERT ON user_purchases` (INSERT martwy przez brak polityki).

### 4.7. Newsletter, CRM, workflowy, integracje, joby
**Cel:** kampanie (EmailDoc), potwierdzenie/wypis (RFC-8058), CRM z lead-scoringiem,
integracje wychodzące (webhook/Slack/HubSpot), cron.
**Mocne strony:** atomowy `claimCampaign` z dzierżawą; idempotencja per odbiorca
`UNIQUE(campaign_id,email)`; CI-unique `(tenant, lower(email))`; tokeny confirm
crypto 256-bit; **unsubscribe mutuje tylko POST** (ochrona przed skanerami) i
`List-Unsubscribe-Post: One-Click` zrobione wzorcowo; **sekrety integracji w
Supabase Vault** (nie plaintext); HMAC-SHA256 per-endpoint + SSRF guard
(`assertPublicHttpUrl` + `redirect:"manual"` + timeout) + backoff + dead po 8;
CRM decay z poprawnym half-life i parytetem wag kod↔SQL; import CRM odporny na IDOR
(tenant z `current_tenant_id`, nie z inputu); workflowy tenant-scoped z anty-rekursją.
Nie stwierdzono defektu P0 (brak eksploatowalnego cross-tenant, masowej podwójnej
wysyłki ani statycznego HMAC).
**Słabości/błędy:**
- **[RYZYKO P1]** HTML-mode kampanii może wysłać maile **bez unsubscribe/List-Unsubscribe**
  przy braku `origin` — guard `missing_site_origin` istnieje tylko dla `editor==="doc"`
  (`newsletter-campaigns.functions.ts:667`); dla `html` przy braku `PUBLIC_SITE_URL`
  kampania wychodzi bez stopki (ryzyko prawne + blacklista domeny).
- **[RYZYKO/BUG P1]** Osierocone dostawy integracji: `claim_integration_deliveries`
  wybiera tylko `queued/failed` (`20260711203000:247-250`) — dispatcher ginący po
  claimie zostawia wiersz `delivering` **na zawsze** (brak watchdoga). Powiązane z
  brakiem budżetu czasu w `jobs-tick` (joby sekwencyjne, `runIntegrationDispatch(20)`
  po ~10 s każda → łatwo przekracza timeout workera).
- **[RYZYKO P1]** Token trackingu = token wypisu (`unsubscribe_token` w każdym pixelu
  open/link click) → wyciek w logach proxy/`Referer` umożliwia POST `/unsubscribe`
  (griefing). Rozdzielić (HMAC per kampania).
- **[DŁUG/RYZYKO P1]** Brak paginacji audytorium i loga w wysyłce (pełny re-fetch przy
  każdej porcji, O(n²)) — przy ustawieniu `db-max-rows` cichoby obcięło listę.
- **[DŁUG P2]** Confirm mutuje na GET przy `Accept != html` (skaner auto-potwierdza —
  osłabia dowód zgody DOI); open/click bez deduplikacji (Apple MPP zawyża); test
  parytetu wag CRM sprawdza tylko klucze, nie wartości; webhook `sign=true` bez
  sekretu wysyła niepodpisany payload po cichu.

### 4.8. SEO, crawler, feedy, i18n, wyszukiwanie
**Cel:** meta/JSON-LD/OG, sitemap/RSS/news-sitemap/llms.txt/robots (service role,
fail-closed), i18n PL/EN, full-text search.
**Mocne strony:** `safeJsonLd` (escape `</script>` + U+2028/9); **crawler fail-closed
wszędzie** (nieznany host → 404/`Disallow: /`); paywall JSON-LD poprawny; i18n
per-request `cloneInstance`; **parytet kluczy PL/EN 1576:0** (zweryfikowany); search
z sanityzacją `tsquery` serwerowo (fallback `plainto`), tenant tylko serwerowo,
limity klampowane, fasety po pełnym zbiorze, rekurencja kategorii `depth<10`.
**Słabości/błędy:**
- **[BUG P1]** `/programs/$slug/rss.xml` — zła tabela — patrz P1-8.
- **[RYZYKO P2]** `xmlEscape` nie usuwa znaków sterujących XML 1.0 (0x00–0x1F) →
  import WP z control char = niepoprawny feed; sitemap emituje hreflang pl+en
  **bezwarunkowo** także dla wpisów tylko-PL (`sitemap:345-349`) — niespójne z
  news-sitemap; podcast RSS bez wymaganych tagów iTunes (`itunes:category/explicit/
  author/owner`) → Apple odrzuca feed.
- **[RYZYKO P2]** Redirect matcher ufa `target_path` z bazy przy dopasowaniu
  (walidacja tylko przy zapisie) → potencjalny open-redirect przy zapisie z
  pominięciem panelu; `Cache-Control: no-store` na 301 (trwałe redirecty niecache'owane);
  legacy `/post/<slug>` gubi prefiks języka.
- **[DŁUG P2]** i18n core `en.ts`/`pl.ts` bez `: typeof pl` → parytet tylko w teście
  runtime, nie w `tsc`; fuzzy search `word_similarity` bez indeksu trgm (seq-scan);
  rozjazd limitu search klient 300 vs serwer 200; `buildArticleJsonLd` bez fallbacku
  `image`; `SITE_CANONICAL_ORIGIN` zaszyty na `neweustrategies.lovable.app`.

### 4.9. Media, podcast, audio, web-stories, eksperci, tracker, reklamy, import WP
**Cel:** biblioteka mediów, TTS, katalog podcastów, huby ekspertów, tracker
legislacyjny UE, reklamy, import WordPress.
**Mocne strony:** **oba endpointy TTS wzorcowo zabezpieczone** (auth+is_staff,
allowlisty, rate-limit fail-closed, cache po hashu, paywall przed syntezą); a11y
`GlobalAudioBar` świetna; parsery podcastu w pełni defensywne (zod safeParse per
element); tracker nie wycieka szkiców (defense-in-depth `!inner` + filtr statusu w
JS); `safeCssColor` w AMP blokuje breakout z `<style amp-custom>`.
**Słabości/błędy:**
- **[BUG P0/P1]** LIKE-injection w folderach mediów — patrz P0/P1-4.
- **[BUG P0]** AMP poster=wideo (`ampStory.ts:53-60`) — `resolvePosterPortrait`
  przy braku `cover_url` bierze `media_url` pierwszej strony, także wideo →
  dokument AMP nie zwaliduje.
- **[BUG P1]** Kwota expert-request: wyścig + obejście przez anulowanie — patrz P1-6.
- **[RYZYKO P1]** SVG w publicznym buckecie (`media.functions.ts:17`) →
  stored-XSS przez osadzony `<script>` (usunąć z allowlisty lub sanityzować +
  `Content-Disposition: attachment`).
- **[RYZYKO P1]** `cta_href` web-stories bez walidacji URL (`StoryViewer.tsx:198-206`)
  → `javascript:` w `<a href>` (stored XSS); `ad-event` spoofowalne metryki
  (`ad-event.ts:26-63` — brak weryfikacji przynależności slotu do tenanta);
  niekompletny/względny JSON-LD podcastu (brak `partOfSeries`, względny `webFeed`).
- **[RYZYKO P1 — do weryfikacji]** RLS `eu_policy_positions` (`tracker/queries.ts:230-238`
  czyta bez filtra statusu) — potwierdzić, że polityka sprawdza status dossier
  rodzica, inaczej stanowiska państw dla szkiców wyciekną.
- **[DŁUG P2]** `regenerateThumbnails` O(media×sizes) sekwencyjnie (timeout);
  `getMediaUsage` przez pełny `JSON.stringify().includes()`; MIME z pola klienta
  bez weryfikacji bajtów; cache TTS bez prefiksu tenanta; import WP Elementor
  fallback bez escapowania (`wxr.ts:216,223,226`); hub eksperta ~20+ round-tripów.

### 4.10. Bezpieczeństwo, multi-tenant, RLS, PII
**Cel:** uwierzytelnianie, role, izolacja tenantów, ochrona PII.
**Mocne strony:** token przez `getClaims` (weryfikacja podpisu); `requireStaff` jako
druga warstwa niezależna od RLS; step-up MFA (blokada `aal1`); self-provisioning
admina zamknięty (`signup_type='staff'` tylko z `raw_app_meta_data`);
`change_user_role` atomowy + audyt; multi-tenant spójny (`x-tenant-host` steruje
tylko anon content plane, staff pinowany `current_tenant_id`); `request_public_host`
parsuje JSON (brak SQLi); crawler fail-closed; sekrety w Vault; komplet nagłówków
bezpieczeństwa; `.env.example` tylko placeholdery.
**Słabości/błędy:**
- **[BUG P1]** Table-wide `SELECT` na `profiles` dla `authenticated` — patrz P1-2.
- **[BUG P1]** `crm_upsert_lead` bez autoryzacji — patrz P1-3.
- **[BUG P2]** `profiles_public` zepsuty dla `anon` po łatce (security_invoker=on bez
  grantu bazowego) — regresja funkcjonalna publicznych profili.
- **[RYZYKO P2]** Twardo zakodowana auto-eskalacja `super_admin` po e-mailu
  `marketing@neweuropeanstrategies.com` (`20260628212746:15-45`) — backdoor na jeden
  adres (jawny w `.env.example`). Zastąpić jednorazowym bootstrapem/allowlistą.
- **[DŁUG P2]** Brute-force guard kooperacyjny (przed `signInWithPassword`) — nie
  chroni realnego endpointu GoTrue; sól hashująca z fallbackiem do klucza
  publicznego; CSP `'unsafe-inline'` w `script-src`; `related-click`
  `Access-Control-Allow-Origin: *`; `require-staff` loguje pełne szczegóły PostgREST.

### 4.11. Admin, analityka, personalizacja, motyw, wydajność, MCP, RODO/cookies
**Cel:** panele admina, ingest analityki, personalizacja, motyw runtime, obserwowalność,
serwer MCP, zgody cookie.
**Mocne strony:** ingest z twardą walidacją + rate-limit + redakcja PII
(`redact.ts`); consent **opt-in domyślnie**, `ConsentScriptInjector` ładuje 3rd-party
dopiero po zgodzie i sprząta przy cofnięciu; dashboardy tenant-scoped; MCP
fail-closed (issuer `.invalid`), OAuth `authenticated` audience, RLS obowiązuje,
ochrona przed injekcją PostgREST; `hardenStyleCss` na każdym data-derived `<style>`;
wydajność — `echarts`/`tiptap` tylko admin (code-split), lucide tree-shake,
FontAwesome lazy, trzy budżety bundla jako gate; `anonMerge` personalizacji dojrzały.
**Słabości/błędy:**
- **[RYZYKO P1 — RODO]** Web-vitals **bez teardown przy cofnięciu zgody**
  (`webVitals.ts:120-166` nie zwraca cleanup; `initObservability` usuwa tylko
  listenery błędów) → vitals beaconują dalej po cofnięciu zgody aż do przeładowania;
  `__vitalsInit` blokuje re-grant.
- **[RYZYKO P1 — RODO]** Beacony `ad_event`/`popup_event` (`events.ts:7-23`) bez
  sprawdzenia zgody, mimo że banner deklaruje `ad_event` jako Marketing wymagający
  zgody — niespójność deklaracja↔implementacja.
- **[RYZYKO P1]** Popup może być **nie-do-zamknięcia** na dotyku: `PopupHost` nie
  pilnuje kombinacji `showCloseButton=false` + `closeOnOverlay=false` (tylko Escape).
- **[DŁUG P1]** Martwa zależność `recharts` (`package.json:87`, zero importów) —
  usunąć.
- **[DŁUG P2]** Cookie banner: „Akceptuj wszystkie" wizualnie prominentniejszy niż
  „Tylko niezbędne" (EDPB zaleca równorzędność); `related-click` rate-limit tylko w
  DB (amplifikacja); `audience.functions.ts:152` bez `.eq(tenant_id)` (defensywnie);
  cache tokenów GA4 globalny per-worker; budżet PUBLIC ~1475 KB gzip duży
  (zapowiedziany split locale/tanstack niezrobiony).

---

## 5. Mapa rekomendacji (roadmap)

### P0 — natychmiast
1. Rozwiązać kolizję timestampów migracji `20260723180000` i scalić
   `seed_pricing_defaults` (czat + katalog v5 dla nowych tenantów).
2. Escapować `%`/`_` w ścieżkach folderów mediów przed `.like` (ryzyko utraty danych).
3. `BuilderRenderer.tsx:185` → `device ?? "desktop"` (mismatch hydratacji/CLS mobile).

### P1 — pilne (bezpieczeństwo i integralność)
4. `REVOKE SELECT ON public.profiles FROM authenticated` + grant kolumnowy; bramka
   CI z `profiles_pii_grant_test.sql`; lint przeciw table-wide grantom.
5. `REVOKE EXECUTE ON crm_upsert_lead FROM authenticated` (lub guard w ciele).
6. `safeUrl()` na `href` widgetu buildera (`BuilderRenderer.tsx:841`).
7. Kwota expert-request: advisory lock + liczenie niezależne od anulowań.
8. `tenant_id = v_tenant` w CTE `orders` w `monetization_dashboard`.
9. Bezpieczne domyślne Gift Articles (`monthly_limit>0`, `link_ttl_days>0`,
   `max_redemptions_per_link`).
10. Reset statusu komentarza do `pending` przy edycji w trybie moderacji.
11. Gate `chat_enabled` w `/messages`.
12. HTML-mode newslettera: guard braku `origin` (nie wysyłać bez unsubscribe).
13. Watchdog dla dostaw integracji utkniętych w `delivering` + budżet czasu w `jobs-tick`.
14. Rozdzielić token trackingu od tokenu wypisu newslettera.
15. `/programs/$slug/rss.xml` → tabela `research_programs` (lub odpiąć trasę).
16. Naprawa poster AMP (obraz, nie wideo) + walidacja `cta_href` w web-stories.
17. RODO: teardown web-vitals przy cofnięciu zgody + bramkowanie beaconów ad/popup zgodą.

### P1 — funkcjonalne/UX
18. Optimistic-lock (`updated_at`) w `updatePost`/`updatePage`; autosave stron.
19. Spłaszczyć waterfall autora/współautorów; prefetch `customMetaDefs`; ograniczyć
    `RouteProgress` do nawigacji; uporządkować marnowany prerender; lazy-load ciężkich
    bloków + `width/height` w `enhanceImages`.
20. Bug edycji komentarza (`submitting`); unifikacja „zapisanych"; parytet głosowania
    Q&A; akcje masowe + akcje na sprawcy w moderacji.

### P2 — porządkowe (wybór)
Reconcile liczników (pg_cron); usunięcie `recharts`; strip znaków sterujących w XML +
warunkowe hreflang w sitemap + tagi iTunes; walidacja targetu redirectu przy match;
parytet typów i18n core; indeks trigramowy pod fuzzy search; ujednolicenie strategii
i18n w UI; `AlertDialog`/undo dla akcji nieodwracalnych; user-picker w badges; a11y
Radix Tabs w `network.tsx`; UI dla `@`-wzmianek; odkrywalność `/live`/`/publications`;
zawężenie widoczności faktur/dashboardu; równorzędność przycisków cookie; redukcja
budżetu PUBLIC; ustawienie `LHCI_URL`.

---

## 6. Co jest zrobione wzorcowo (wzorce do naśladowania)

- **Bezpieczeństwo płatności:** weryfikacja podpisu Stripe, idempotencja per-handler,
  grant przed statusem.
- **Sanityzacja treści:** dwusilnikowa (DOMPurify + allowlist-walker SSR), `safeJsonLd`,
  `hardenStyleCss`, `safeCssColor` — z udokumentowanym uzasadnieniem.
- **Integracje:** sekrety w Vault, HMAC per-endpoint, SSRF guard, backoff+dead-letter.
- **Realtime:** refcountowany `tableChannelHub` bez leaków; parytet katalogu zdarzeń.
- **Multi-tenant (crawler):** konsekwentny fail-closed.
- **i18n:** per-request `cloneInstance`, parytet kluczy 1576:0.
- **Komponenty interakcji:** `ConnectButton`, `GiftArticleButton`, RSVP wydarzeń,
  `PollCard` — maszyny stanów, potwierdzenia nieodwracalnych akcji, a11y.
- **Odporność renderu:** `RenderErrorBoundary` per widget; `useAutosave`; degradacja
  parserów treści.

---

## 7. Zastrzeżenia metodyczne

Audyt oparto na statycznej analizie kodu i migracji, nie na uruchomieniu z żywą bazą.
Ustalenia „POTWIERDZONE" zweryfikowano w kodzie/łańcuchu migracji w tym audycie.
Kilka ustaleń wymaga potwierdzenia testem na środowisku (oznaczone „do weryfikacji"),
zwłaszcza RLS `eu_policy_positions`. Zalecane następne kroki: dopisać brakujące testy
pgTAP/E2E dla ustalonych P1 (izolacja `monetization_dashboard`, grant `profiles`,
autoryzacja `crm_upsert_lead`, gating `/messages`) i włączyć je jako bramki CI —
w kilku przypadkach test już istnieje i to właśnie regresja go łamie.
