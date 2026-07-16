# Ocena platformy NES — architektura, moduły i logika treści

**Data:** 2026-07-16 · **Commit:** `fa716bc` · **Gałąź:** `claude/module-architecture-review-w84azt`
**Skala:** 0–10 (0 = brak / krytycznie zepsute, 5 = działa z istotnymi długami, 8 = dojrzałe produkcyjnie, 10 = wzorcowe)

## Metodologia

Ocena powstała z bezpośredniej lektury kodu i migracji na bieżącym HEAD (nie z dokumentacji —
twierdzenia z `docs/` traktowano jako aspiracyjne i weryfikowano z implementacją). Platformę
podzielono na **7 klastrów** analizowanych równolegle; każde ustalenie krytyczne potwierdzano
cytatem `plik:linia` lub nazwą migracji. Dwa najważniejsze ustalenia (martwy menedżer przekierowań,
brak izolacji tenanta w `archive_layout_settings`) zweryfikowano dodatkowo ręcznie.

Kontekst: to bardzo dojrzała, wielomodułowa platforma multi-tenant (React 19 + TanStack Start SSR +
TypeScript + Tailwind + Supabase/Postgres) dla think-tanku EU-policy. Skala: **~1 300 plików źródłowych,
~150 tabel, 281 migracji, 193 trasy, ~90 typów bloków, ~90 typów widgetów buildera**. Od poprzednich
audytów (`AUDYT_PLATFORMY_2026-07-13` = 7,3; `OCENA_ARCHITEKTURA_BEZPIECZENSTWO` = 8,2) doszło ~40
commitów — stąd ta świeża, per-modułowa rewaluacja.

---

## Werdykt ogólny: **~7,8 / 10**

Silnik i fundamenty (dane, multi-tenant, bezpieczeństwo, SSR, intermodularność, jakość inżynierska)
są na poziomie **8,5–9**. Werdykt 7,8 odzwierciedla **ogon zlokalizowanych, w większości mechanicznych
defektów warstwy aplikacyjnej** — w tym trzy poważne, zweryfikowane: pozorny code-splitting, martwy
menedżer przekierowań i świeży brak izolacji tenanta w jednej tabeli. Po ich domknięciu realny pułap
platformy to **~8,5/10**.

### Tabela A — Ocena zbiorcza klastrów

| # | Klaster | Ocena | Jednozdaniowe uzasadnienie |
|---|---------|:-----:|-----------------------------|
| 1 | Treść / wpisy (bloki, workflow, rewizje) | **7,5** | Backend mutacji klasy produkcyjnej i wzorcowa sanityzacja; ciążą sprzężenia typów bloków, wydajność renderu i wyciek ukrytych bloków zagnieżdżonych |
| 2 | Builder / strony / digital features | **7,0** | Odporny render i poprawny multi-tenant; obniża pozorny code-splitting, redundantne parsowanie i luki współbieżności stron |
| 3 | Architektura danych / tenant / bezpieczeństwo | **8,7** | Dwupłaszczyznowy model tenanta, paywall na przywilejach kolumn, step-up MFA, Vault, SSRF-guard — najsilniejszy klaster |
| 4 | Spójność / społeczność / monetyzacja | **8,0** | Szyna zdarzeń z korelacją, entitlement tylko z podpisanego webhooka; ciążą kolidujące triggery komentarzy i footgun mock-mode |
| 5 | SEO / i18n / obserwowalność / domena / admin-UX | **7,5** | SEO/GEO/AEO i i18n to benchmark; admin-UX nierówny z 1 luką krytyczną (izolacja tenanta) |
| 6 | Jakość inżynierska / testy / CI | **8,0** | Blokujący pipeline, wybitne pgTAP, dyscyplina typów; niskie pokrycie UI/tras, niewpięty knip |
| 7 | Routing / SSR / stan / personalizacja | **8,0** | Ekspercki SSR/hydration i odporność „prezentacja nie kładzie serwisu"; martwy menedżer przekierowań (SEO) |

### Tabela B — Architektura strony (wymiary przekrojowe)

| Wymiar | Ocena | Uzasadnienie |
|--------|:-----:|--------------|
| Organizacja kodu / warstwy | **8** | Foldery feature'owe, czysta separacja logika↔UI; ~14 „god-files" >1200 linii (schemas 2287, MediaManager 2110, ThemeDesignPane 2066) |
| Model danych (schemat, ~150 tabel) | **8,5** | Bogaty, iteracyjnie hartowany; dyscyplina otenantowania ręczna (brak generycznego lintera RLS) |
| Multi-tenant / izolacja | **8,5** | Dwupłaszczyznowy (host-owy anon vs profilowy staff), scope „by construction"; residualnie: header client-controlled, płaszczyzna realtime, świeży leak `archive_layout_settings` |
| Bezpieczeństwo (RLS/auth/sekrety/SSRF/XSS) | **8,5** | Step-up MFA, Vault, egress-guard, paywall na przywilejach kolumn, scentralizowana dwusilnikowa sanityzacja |
| SSR / routing / hydration | **9** | Request-scoped język (brak wyścigu), streaming, fail-open/closed, domknięty race hydratacji |
| Intermodularność (szyna zdarzeń) | **8,5** | `domain_events` SECURITY DEFINER + korelacja klik→zdarzenie + cross-references; rozjazd warstwy liczników |
| Stan / data-fetching (React Query) | **8** | Scentralizowane `queryOptions`, spójna inwalidacja; kilka mikro-waterfalli (autor, gated body public) |
| Type-safety | **9** | `strict`, `no-explicit-any` egzekwowany (1 ręczny `as any` w całym repo), 0 `@ts-ignore` |
| Wydajność / bundling | **6,5** | Budżety bundla dobre, ALE pozorny code-splitting → ciężkie widgety w bundlu każdej strony; re-parse w gorących ścieżkach |
| Testy / CI | **8** | Blokujący pipeline + pgTAP security-first; globalne pokrycie ~20%, brak E2E panelu admina |
| Obserwowalność | **8,5** | RUM prywatność-first, redakcja PII serwerowo, agregacja p75 |
| i18n | **8,5** | Per-request `cloneInstance`, test parytetu PL/EN, `pickLocalized`; inline dryf w części modułów domenowych |
| Dostępność (a11y) | **6,5** | Focus-trap, bogate ARIA i tabele-alternatywy w wielu miejscach; ale command palette bez nazwy, fokusowalne SVG bez etykiet, brak `aria-current`, twarde kolory łamią dark mode |
| Rozszerzalność | **7,5** | Deklaratywne schematy pól, rejestry widgetów; multi-source-of-truth typów bloków (99 pozycji w 4–6 listach) |

---

## 1. Treść / wpisy — **7,5 / 10**

Rdzeń publikacji: silnik bloków (Gutenberg-style), edytor, workflow edytorski, rewizje, layouty wpisu,
render publiczny. Higiena wyjątkowa: 126 plików, **zero `any`, zero `@ts-ignore`, zero `console.log`**.

| Pod-moduł | Ocena | Mocne strony | Słabości / ryzyka |
|-----------|:-----:|--------------|-------------------|
| Fasada dispatchu (`contentEngine.ts` + `ContentRenderer`) | **9** | Czysta funkcja decyzji, `enhanceImages` PO sanitizerze, testy + a11y | Pusty wpis blokowy pada do ścieżki HTML (no-op) |
| Serwerowe mutacje (`content.functions.ts`) | **9** | Zod + `requireStaff` + RLS + audit + rate-limit; guard cichego odrzucenia RLS; auto-301; reguła pierwszej publikacji | `blocks_data` niewalidowane schematem na serwerze; brak limitu rozmiaru; `deletePost` bez rate-limit |
| Workflow + publikacja zaplanowana (`workflow.ts`) | **8** | Pure-module mirrorowany triggerem `enforce_post_workflow` | Auto-publikacja zależna od pg_cron; fallback „opportunistic tick" tylko przy wejściu staffu do `/admin/posts` |
| Rewizje (`revisions.ts`) | **9** | Snapshoty postów i stron, throttle 5 min, restore nie zmienia statusu | Prune best-effort (rośnie u autora bez DELETE) |
| Silnik bloków — typy/schemat/rejestr | **6** | `safeParseBlocks` degraduje blok-po-bloku; limity; kompilator wymusza `BLOCK_SPECS` | **99 typów w 4–6 źródłach prawdy** bez sygnału kompilatora; `data` nietypowane per-typ |
| Edytor bloków (`PostBlockEditor`/`BlockCanvas`) | **6** | Naprawiony „dead undo", reorder z klawiatury | **Brak memoizacji** (re-render całej listy na keystroke); kontenery `group/columns/grid` to stuby; inline tworzenie kategorii/tagów omija server-fn |
| Publiczny `BlocksRenderer` | **7** | Jednolity sink sanityzacji, `RenderErrorBoundary` per-blok, allowlista embedów | **P0: `style.hidden` sprawdzany tylko na top-level → ukryty blok zagnieżdżony wycieka**; brak memo; brak code-splittingu |
| Widoki bloków (~40) | **6** | Bogate ARIA, lekki silnik wykresów SVG | **Dwa `ContactFormView` o asymetrycznym bezpieczeństwie** (blok robi `supabase.insert` z klienta, bez honeypota); hydration mismatch `Countdown`/`LiveBlog`; twarde stringi PL w EN |
| Migracja treści (`blocks/migrate`, `gutenberg`) | **8** | Regex SSR-safe, lossless nieznanych, round-trip testowany | Regex na HTML z natury kruchy |
| Publiczny resolver (`$.tsx`, `post.$slug`) | **7** | Dojrzałe SEO/JSON-LD; paywall spójny nawet w infinite-scroll | `ResolvedPage` monolit ~560 l. bez testów; erozja typów; `AutoLoadNextPost` nie aktualizuje canonical/meta |
| Route edytora (`admin.posts.$slug`, 1390 l.) | **7** | Przemyślany autosave, `discardToSaved`, `refetchOnReconnect:false` | `EditPost` monolit ~1230 l.; rzuty `as unknown as` |
| Layouty wpisu (`PostLayoutRenderer`) | **6** | Overlay meta-card, view-transition cover | **Rozjazd model↔render**: pola `header`/`cover:"side"` nie honorowane; model presetów częściowo martwy |
| Komponenty publiczne (related v2, TOC) | **8** | Scoring related v2 (IDF+dwell+personalizacja) czysty i testowany; TOC anchor-parity | **Presence bez lockingu** → równoległa edycja może się nadpisywać |
| Sanityzacja (`sanitize.ts`) | **9** | Dwa silniki, jedna polityka; `hardenStyleCss`, `scopeCustomCss`, `safeUrl` | Teoretyczny mismatch przy różnicy silników |
| Legacy `PostEditor` (TipTap/MD) | **7** | `immediatelyRender:false` SSR-safe | `Btn` w ciele komponentu (remount) |

**Rekomendacje:** **[P0]** naprawić wyciek ukrytych bloków zagnieżdżonych + ujednolicić `ContactFormView`
do wariantu server-fn; **[P1]** walidować `blocks_data` schematem + limit rozmiaru, przenieść inline
kategorie/tagi na server-fn; **[P1]** memoizacja edytora i renderera + lazy-load ciężkich bloków;
**[P2]** jeden rejestr typów bloków zamiast 4–6 list, dokończyć kontenery; **[P2]** uspójnić model
layoutów z rendererem, utwardzić harmonogram publikacji (niezależny od pg_cron), rozważyć edit-locking.

---

## 2. Builder / strony / digital features — **7,0 / 10**

Elementorowy page-builder (sekcja→kolumna→widget), strony z hierarchią, moduł „Digital Features"
(interaktywne widgety danych EU-policy), wykresy SVG, patterns.

| Pod-moduł | Ocena | Mocne strony | Słabości / ryzyka |
|-----------|:-----:|--------------|-------------------|
| Model danych + walidacja (`types.ts`/`schema.ts`) | **8** | `safeParseBuilderDoc` „drop-only-irrecoverable" + drift-test + deterministyczny fallback ID (SSR) | Koercja przepuszcza nieznane klucze (spread bez czyszczenia); brak limitu głębokości |
| Operacje na drzewie (`operations.ts`) | **8** | Czyste, testowane; defensywne guardy | O(n) skany na operację |
| Historia undo/redo (`useHistory.ts`) | **6,5** | Etykiety, koalescencja | `safeParseBuilderDoc` na każdą edycję; `JSON.stringify` O(n); 200 snapshotów w RAM |
| Rejestr widgetów (`registry.tsx`, 1404 l.) | **7** | Jedno źródło palety/defaultów; poza publicznym bundlem | Monolit; treści-zaślepki jako defaulty produkcyjne |
| Publiczny `BuilderRenderer` (902 l.) | **8** | Streaming below-fold, `RenderErrorBoundary`, A/B deterministyczne SSR | `safeParseBuilderDoc` bez `useMemo`; O(widgetów) węzłów `<style>` |
| Dispatcher `WidgetView` (1220 l.) | **6,5** | Konsekwentna sanityzacja stringów autora; memoizacja | Monolit-switch; `!important` (wojny specyficzności); override CSS niezmemoizowany |
| **Code-splitting (`lazyWidgets.tsx`)** | **3** | — | **Deklaruje `React.lazy`, faktycznie STATYCZNE importy owinięte w `<Suspense>`; brak `import()`**. Slider, silnik wykresów, 9 feature-komponentów, rich-text+DOMPurify i wszystkie formularze w bundlu KAŻDEJ strony (przez Header/Footer). Test wprowadza w błąd |
| Orchestrator (`Builder.tsx`/`useBuilderOperations`) | **7** | Dobra dekompozycja hooków, bulk w 1 undo | **~3 przebiegi koercji + round-trip JSON na jedno naciśnięcie klawisza** |
| Kanwa + DnD (`VisualCanvas`, 1109 l.) | **6,5** | Walidacja payloadów, parytet z produkcją | Monolit; dwa systemy DnD w repo (natywny vs @dnd-kit) |
| Global widgety (`globalWidgets.ts`) | **8** | **Poprawny multi-tenant** (`DEFAULT current_tenant_id()` + RLS `WITH CHECK`) | Per-id query bez batcha |
| Schematy właściwości (`schemas.ts`) | **8** | Deklaratywne pola i18n, redukcja boilerplate'u | Widgety listowe mają osobne edytory (dwa światy) |
| Features — typy/parsery (`geoProject`) | **8,5** | Wzorcowa separacja od buildera; parsery bez wyjątków; geo deterministyczne SSR-safe | Ciche odrzucanie wierszy bez sygnału dla redaktora |
| Features — komponenty (9 SVG/HTML) | **7,5** | SSR/hydratacja wzorcowa, dwujęzyczność, tabele a11y | `CorridorMap`: martwy `projectToScreen`, **zero testów**; fokusowalne SVG bez nazwy |
| Charts — silnik/parsery | **7,5** | Własny SVG (bez recharts/d3), `niceScale`, geo z cache | Duplikacja `parseNumber`/ISO2; dwie ścieżki `ChartConfig` |
| Charts — komponenty/a11y | **7** | Semantyka tabel-alternatyw, empty-state | Publiczna ścieżka NIE lazy (`BlocksRenderer:97` statyczny); jank Cartesian; CLS mapy |
| Patterns (`library.ts`, `PatternPicker`) | **5,5** | Dobry UX (podgląd, diff, sanityzacja) | **Kolizje ID** (zamrożone przy imporcie, brak re-ID); treść zagnieżdżona nieedytowalna; dryf ze schematem |
| Strony (`admin.pages`, render publiczny) | **7** | Server-fn + RLS + rewizje; `resolve_path` bez N+1; SEO/gating | **Brak optimistic locking**; brak serwerowej ochrony przed cyklem `parent_id`; brak limitu rozmiaru `builder_data` |

**Rekomendacje:** **[Krytyczne — bundle]** przywrócić realny code-splitting (`lazyWidgets` +
`BlocksRenderer:97`), usunąć mylące komentarze/test; **[Wysokie — wydajność]** zredukować wielokrotny
re-parse (memoizacja `safeParseBuilderDoc`); **[Wysokie — integralność]** optimistic locking +
ochrona cyklu + limit rozmiaru dla stron; **[Średnie]** patterns: re-ID i rekurencja i18n; **[Średnie]**
dokończyć features/charts (testy CorridorMap, CLS, memoizacja, a11y SVG).

---

## 3. Architektura danych / tenant / bezpieczeństwo — **8,7 / 10**

Najsilniejszy klaster: dojrzały, świadomie hartowany system multi-tenant z rzadko spotykaną dyscypliną
defence-in-depth. Widać iteracyjny audyt — kolejne migracje zamykają nazwane luki.

| Obszar | Ocena | Mocne strony | Słabości / ryzyka |
|--------|:-----:|--------------|-------------------|
| Model tenanta (`public_tenant_id`/`current_tenant_id`) | **8,5** | Rozdział „kto co widzi"; jedna definicja hosta SQL+TS; twarde constrainty (`single_default`, unikalna `lower(domain)`) | Header `x-tenant-host` client-controlled (published czytelne cross-domain); płaszczyzna realtime resolwuje do default tenanta |
| Izolacja RLS + gating treści | **9** | **Paywall na przywilejach kolumn** (body odebrane anon/auth, dostęp tylko przez `get_entity_content`); fail-closed przy nowych kolumnach | Dyscyplina otenantowania ręczna (brak lintera) |
| Autoryzacja ról | **9** | Trójwarstwowa (RLS + `requireStaff` + trigger); **step-up MFA**; `profiles_pin_tenant` cofa zmianę tenanta | Statyczny „god account" w migracji (hardcoded e-mail) |
| Klienci Supabase / fetch | **8,5** | Rozdział anon(RLS)/service-role; nagłówki tenant/correlation „by construction" | Regeneracja `client.ts` może zgubić wpięcie — chroni tylko komentarz, nie test |
| Host→tenant SSR (`tenant.server.ts`) | **9** | **Fail-open (treść) vs fail-closed (crawler)** — trafna asymetria kosztu błędu | Długa awaria katalogu → 404 na crawlerach (degraduje cicho) |
| SSR/edge cache (`ssrCache.ts`) | **8,5** | Anty-poisoning: scope host `by construction`; podwójne scope w SEO-readerach | Ryzyko cache-thrash przy spoofie `Host` (wydajność, nie wyciek) |
| Sekrety / Vault | **9** | Plaintext-secrets → `supabase_vault`, dostęp przez SECURITY DEFINER RPC; prywatny bucket CV | Dryf `.env.example` (brak `RESEND_API_KEY`) |
| Job runner / cron / SSRF / idempotencja | **8,5** | Timing-safe secret + rate-limit; kompletny SSRF egress-guard; atomic claim SKIP LOCKED | `invoke_jobs_tick` fail-open **cichy**; `base_url` ticku omija egress-guard |
| Pokrycie pgTAP | **8,5** | 30 plików: izolacja tenantów, granty PII, host-resolution (12 asercji), race-conditions | Per-obszar, nie systematyczne (nowa tabela bez RLS przejdzie CI) |

**Rekomendacje:** **[SEC średni]** generyczny linter/test RLS w CI (każda `public.*` z `tenant_id` musi
mieć politykę scope'ującą) — obecna dyscyplina ręczna jest źródłem ryzyka (patrz leak `archive_layout_settings`
w §5); **[SEC średni/niski]** domknąć płaszczyznę realtime multi-tenant; **[SEC niski]** ograniczyć
spoofowalną atrybucję anon-INSERT; **[OP średni]** test CI chroniący wpięcie fetch-wrappera + uzupełnić
`.env.example`; **[OP niski]** obserwowalność fail-open ticku.

> **Fakt strukturalny do świadomej akceptacji:** publiczne powierzchnie SSR/crawler jadą na service-role
> (bypass RLS) i polegają na ręcznych `.eq("tenant_id", …)`. We wszystkich sprawdzonych ścieżkach filtry
> są obecne i podwójnie scope'owane, ale to warstwa „by convention" — rekomendacja o linterze RLS jest
> tu najważniejszym zabezpieczeniem systemowym.

---

## 4. Spójność / społeczność / monetyzacja — **8,0 / 10**

Szyna zdarzeń domenowych, realtime, powiadomienia/web-push, czat, komentarze, moduły społeczności,
CRM, newsletter, billing/Stripe, darowizny, reklamy.

> **Sprostowanie do wcześniejszych audytów:** teza o „zepsutych end-to-end" modułach społeczności **nie
> potwierdza się w kodzie** — trasy `/polls`, `/qa`, `/events`, `/messages` są zamontowane, mają realną,
> utwardzoną logikę (RPC `vote_poll`/`rsvp_event`/`ask_qa_question`) i pełne zaplecze admina. Problem jest
> **produktowo-konfiguracyjny** (brak wpięcia w nawigację + ubogi seed), nie inżynierski.

| Pod-moduł | Ocena | Mocne strony | Słabości / ryzyka |
|-----------|:-----:|--------------|-------------------|
| Szyna zdarzeń (`domain_event_bus`) | **9** | `emit_domain_event` SECURITY DEFINER (klient nie sfałszuje), nigdy nie rzuca; test kontraktowy skanuje migracje | RLS zawęża do aktora/staffu → fanout do odbiorców osobnymi subskrypcjami |
| Hub kanałów Realtime (`tableChannelHub`) | **9** | Refcount: 1 websocket per spec; testowany | Kilka miejsc omija hub (`polls.tsx`, `useMessages.ts`) |
| Korelacja + `useEventConfirmedMutation` | **8** | Klik→zdarzenie, rollback po 3 s, fallback RPC; testowane | `correlationStack` globalny (udokumentowane, samonaprawialne) |
| Mapa inwalidacji | **7** | Pokrywa 19 typów, pilnowana testem | Część reguł liczników trafia w martwe klucze |
| Graf cross-references | **8** | Auto-populacja triggerami; 1 RPC `get_linked_items` | Wąskie wpięcie UI; nieklikalne część powiązań |
| Zmaterializowane liczniki | **5** | Model DB poprawny (RLS, triggery, recompute) | **Rozjazd kluczy cache → inwalidacja realtime jest no-opem**; `usePendingCounters`/`chat_unread`/`tenant_pending_counters` martwe |
| Powiadomienia + web push | **8** | **Web push od zera** (VAPID/aes128gcm), digesty, grupowanie; testy | Własna krypto push (koszt utrzymania); redundancja liczników |
| Czat | **8** | Wielowarstwowa izolacja tenanta (RLS+RPC+storage+realtime auth); naprawiona luka cross-tenant | Roster grup niekompletny (wymóg wzajemności read-receipts); dup kanał |
| Komentarze | **6** | Moderacja tenant-scoped, drzewo testowane | **P0: dwa kolidujące triggery BEFORE UPDATE → soft-delete zepsuty, okno edycji 5 zamiast 15 min** |
| Community — trasy publiczne | **8** | Pełny łańcuch DB→RPC→trasa; anonimowość, anti-anchoring, tier-gating, rate-limity | **Zerowa odkrywalność** (brak linków w nav); ubogi seed |
| Community — admin + cron | **8** | Realne UI moderacji; idempotentny endpoint cron | Cron wymaga zewnętrznego schedulera |
| CRM — rdzeń | **8** | Per-tenant idempotencja notatek; anti-injection `.or()`/CSV | `idempotency_key` opcjonalny; `updateCrmLead`/`deleteCrmNote` bez audytu |
| CRM — integracje wychodzące | **7** | Sekrety w Vault; SSRF-guard; outbox z backoff/dead-letter | **Brak auto-drenażu outboxu** (tylko przy wejściu do CRM); martwe typy zdarzeń w UI |
| Silnik workflow | **6** | Deklaratywny, szyna-driven, ochrona pętli | Połyka błędy bez logu; **brak admin UI** (headless); `create_crm_lead` gubi telefon/firmę |
| Newsletter — kampanie | **7** | Dzierżawa/wznawianie, idempotencja per-odbiorca, RFC 8058 | **Brak paginacji audytorium → ciche wysłanie tylko do ~1000** |
| Newsletter — subskrybenci/DOI | **9** | Tokeny CSPRNG serwerowo, double rate-limit fail-closed, unsubscribe GET/POST | Confirm mutuje na GET |
| Newsletter — builder dokumentu | **6** | Zod discriminated union, renderer sanityzuje | **`NlDocSchema` nieużyty przy zapisie** (deklarowana walidacja fikcyjna) |
| Newsletter — tracking | **8** | Open-redirect guard, tenant-safe atrybucja | Inflacja metryk (zdarzenie mimo braku subskrybenta) |
| Billing — webhook Stripe | **9** | **Entitlement tylko z podpisanego webhooka**, idempotentny grant-first, refund per-subskrypcja | Własna krypto podpisu; brak dedupu po `event.id` |
| Billing — checkout | **8** | Cena serwerowo z `access_plans`; poprawny cykl życia | **Footgun mock-mode**: bez `STRIPE_SECRET_KEY` płatna treść za darmo |
| Billing — entitlement/grant | **9** | Jeden idempotentny punkt nadawania | Zbędny round-trip w gałęzi lifetime |
| Billing — egzekucja paywalla | **9** | Na przywilejach kolumnowych PG (nie kosmetyka); password lockout | Stara 3-arg `has_content_access` tenant-blind wciąż z GRANT (do DROP) |
| Billing — membership/tiers | **8** | Ranga serwerowo z 3 źródeł | Pułapka: plan z `tier_key=NULL` odblokowuje, ale nie nadaje rangi |
| Donations | **8** | Jednorazowe, idempotencja, PII izolowane, refund cofa rangę | PLN hardcoded; ten sam mock footgun |
| Ads | **7** | CMP-lite consent-gating przed third-party, zero CLS, lazy (CWV) | Spoofowalna analityka; `dangerouslySetInnerHTML`+exec skryptu; dryf schematu |

**Rekomendacje:** **[P0]** naprawić kolidujące triggery komentarzy; **[P0]** fail-hard przy braku
`STRIPE_SECRET_KEY` w produkcji; **[P1]** uspójnić warstwę liczników (wpiąć konsumentów albo usunąć
martwą warstwę); **[P1]** scheduler drenażu outboxu + paginacja audytorium kampanii; **[P2]**
odkrywalność społeczności (nav/hub + seed), uszczelnić spoofowalne metryki, egzekwować `NlDocSchema`.

---

## 5. SEO / i18n / obserwowalność / domena / admin-UX — **7,5 / 10**

Ostry kontrast dwóch poziomów: rdzeń platformowy (SEO/i18n/obserwowalność) klasy produkcyjnej,
admin-UX nierówny z jedną luką krytyczną.

| Pod-moduł | Ocena | Mocne strony | Słabości / ryzyka |
|-----------|:-----:|--------------|-------------------|
| Meta/head builders (`seo/meta`, `head`) | **9,5** | Pełny łańcuch, kanoniczny override tłumi hreflang, robots zero-click | `SITE_CANONICAL_ORIGIN` hardcoded; jeden `google-site-verification` |
| JSON-LD + integracja `$.tsx` | **9,5** | `safeJsonLd` escapuje do `\uXXXX` (XSS-safe); paywall/speakable/breadcrumb SSR | Brak fallbacku obrazu w JSON-LD |
| Powierzchnie crawlerów (sitemap/news/robots/llms) | **9** | FAIL-CLOSED multi-tenant wszędzie; polityka AI search vs training | N+1 `page_full_path`; brak sitemap-index / limitu 50k |
| Feedy RSS/podcast | **9** | Standardy, tenant-safe, iTunes enclosure | Martwy `xmlns:content` |
| **Przekierowania 301 / monitor 404** | **4** | Rdzeń (`matchRedirect`) czysty, testowany, open-redirect guard | **Martwy w runtime**: brak warstwy egzekucji; `record_seo_404`/`record_redirect_hit` bez wołającego → strata link-equity po migracji z WP; monitor 404 zawsze pusty |
| Narzędzia SEO admina (SERP/validation) | **9** | Pikselowa miara SERP; „preview == crawler" | Tabela szerokości znaków to aproksymacja |
| OG cards + AMP builder | **8,5** | `safeCssColor` chroni `<style amp-custom>`; upsert z cache-busterem | AMP wyłącznie `lang="pl"` (brak EN) |
| i18n — rdzeń ścieżek/runtime | **9** | **`getRenderI18n` per-request `cloneInstance` — eliminuje wyścig języka SSR** | Niespójne nazwy kluczy cookie/localStorage |
| i18n — pickery/format/parytet | **9,5** | `pickLocalized` (zastąpił ~380 ternary); test wymusza parytet PL/EN | Z 21 nakładek testowane 3 |
| Przełącznik języka | **8** | `setClientLang` przed `navigate`; redirect tylko na „/" | Flagi jako wskaźnik języka (antywzorzec) |
| Web Vitals | **8,5** | Natywny PerformanceObserver, progi klient↔serwer, flush bfcache | Klient beaconuje pathname bez redakcji (serwer redaguje) |
| Ingest + agregacja + redakcja PII | **9,5** | Redakcja PII serwerowo na obu ingestach, rate-limit, tenant-scope | `client_errors` bez `tenant_id` |
| Analityka + zgoda | **9** | Consent-gated, GA `anonymize_ip`, RODO | `custom_head/body_html` wykonuje skrypty admina (świadomy model zaufania) |
| Tracker legislacyjny UE | **8** | Wzorowa separacja, brak N+1, dobra a11y mapy | `stageProgress` martwy; CSS-fallback martwy; etykiety UTC; brak testów tras |
| Podcast | **7** | Zod + defensywne parsery jsonb, brak N+1, `sanitizeHtml` | URL-e źródeł/gości **bez `safeUrl`** (wektor `javascript:`); schemat ustawień nieużyty; i18n inline |
| Web-stories | **6,5** | `safeParsePages`, focus-trap, FAIL-CLOSED AMP (teza o przecieku tenanta OBALONA) | **Bug pauzy** (reset paska); `cta_href` bez `safeUrl`; AMP tylko `pl`; brak testów |
| Eksperci | **6** | Batchowanie, czysta `normalize/filter`, SEO Person | **Podwójny render sekcji**; **iniekcja CSS** (`ExpertLayoutStyleScope` bez `hardenStyleCss`); monolit ~1060 l.; cicha obsługa błędów |
| Programy badawcze | **8,5** | **Najdojrzalszy**: pełne testy, `.error` na wszystkich zapytaniach, brak martwego kodu | Łagodny N+1 `hydrateHref`; `catch→notFound` maskuje błędy |
| Admin Shell | **7** | Testowany `SidebarRowButton`, compact, `noindex`+`ssr:false` | Monolit nav ~290 l. co render; mieszany i18n; brak `aria-current`/skip-link; martwy kod |
| Theme | **7** | `hardenStyleCss` konsekwentnie; anty-flash SSR; Zod clamp | Monolity 2066/1858/1433 l. nietestowane; **brak walidacji formatu kolorów** (CSS-injection); jeden `<style>` bez `hardenStyleCss` |
| **Appearance** | **5** | `ArchiveLivePreview` reużywa produkcyjny rejestr; `FooterChrome` w pełni Zod | **KRYTYCZNE: `archive_layout_settings` bez `tenant_id`** (`archive_type` globalnie UNIQUE, RLS `USING(true)`, 1 wspólny wiersz) → admin dowolnego tenanta nadpisuje wszystkich; zdublowany edytor Global Colors |
| Menus | **6** | Zod+limity, `parseMegaConfig` fail-safe, `safeUrl` | Zapis NIE-transakcyjny (delete-all+insert-all); nadużycie ARIA; L3 tylko hover; dwa systemy mega-menu |
| Media | **5,5** | `registerMediaUpload` wzorowy (tenant prefix, MIME allowlist, rate-limit, audit) | **3 uploadery omijają go** → pliki osierocone bez walidacji; brak wirtualizacji; MIME kliencki; `svg+xml` na allowliście |
| Search | **7,5** | Najczystszy; `reqId` guard; highlight bez `dangerouslySetInnerHTML` | Martwy scoring fuzzy; listbox z `div` (axe); trzy ścieżki wyszukiwania |
| UI (shadcn) + a11y | **7** | `useFocusTrap` solidny+testowany; targety dotykowe WCAG 2.5.5 | `CommandDialog` bez `DialogTitle`; niespójne focus-states; twarde kolory łamią dark mode |

**Rekomendacje:** **[KRYTYCZNE]** izolacja tenanta `archive_layout_settings` (`tenant_id` +
`UNIQUE(tenant_id,archive_type)` + RLS z tenantem); **[Wysokie]** hub eksperta (podwójny render +
`hardenStyleCss`) i walidacja formatu kolorów w theme; **[Wysokie]** ujednolicić upload mediów +
magic-bytes + wirtualizacja; **[Średnie]** i18n konsekwencja + `safeUrl` na `cta_href`/URL źródeł +
bug pauzy StoryViewer; **[Średnie]** a11y admina + zapis menu transakcyjny + rozbić monolity theme.

---

## 6. Jakość inżynierska / testy / CI — **8,0 / 10**

| Obszar | Ocena | Stan / mocne strony | Słabości / ryzyka |
|--------|:-----:|---------------------|-------------------|
| Konfiguracja | **9** | Samodokumentująca; `no-restricted-imports` chroni przed realnymi 500-kami edge; `bunfig` hardening supply-chain | `scripts/`+`e2e/` nietypecheckowane; brak type-aware lint |
| CI/CD | **9** | Blokujący: typecheck→test+coverage→build→bundle→lint + pgTAP + E2E (smoke+seeded) + Lighthouse (2 tryby) | Knip niewpięty; brak cache bun / `bun audit` |
| Testy jednostkowe (Vitest) | **7** | 199 plików; ścieżki krytyczne 90–100% (contentEngine 100%, billing 100%, webhook Stripe 90%) | **Globalne pokrycie ~20%** (routes ~2%, components ~9%) |
| Testy E2E (Playwright) | **7** | Uczciwy podział smoke/seeded; testują realny SSR/SEO (JSON-LD, 301, sitemap) | Cienkie; brak panelu admina; tylko chromium; jadą na `vite dev` |
| Testy DB / pgTAP | **9** | 30 plików: RLS, granty PII, izolacja tenantów, race-conditions — warstwa nietknięta przez JS | Per-obszar; brak generycznego lintera RLS |
| Bundling / build | **8** | 3 budżety (CHUNK/PUBLIC/OVERALL) blokujące, deterministyczne | **Heurystyka public/admin nieaktualna** (`ADMIN_ONLY` odwołuje się do `manualChunks`, których vite.config zakazuje) |
| Jakość kodu / typy | **8** | `strict`; `no-explicit-any` egzekwowany (1 ręczny `as any`); 0 `@ts-ignore`; ErrorBoundary wielowarstwowy | ~14 god-files >1200 l. |
| Martwy kod / tooling | **6** | Skrypty migracyjne z zabezpieczeniami; konwencje importów spójne | **Knip skonfigurowany, ale niewpięty** (nie devDep, brak skryptu i CI); orphan `test-picker.mjs` |

**Rekomendacje:** **[Wysoki]** naprawić/usunąć heurystykę public/admin w `check-bundle-size.ts`;
**[Wysoki]** wpiąć knip do CI + usunąć orphan; **[Średni]** podnieść pokrycie routes/komponentów;
**[Średni]** typecheck+lint na `scripts/`+`e2e/`, type-aware ESLint (`no-floating-promises`);
**[Niski]** rozbić god-files, cache bun + `bun audit`.

---

## 7. Routing / SSR / stan / personalizacja — **8,0 / 10**

Jeden z najbardziej dojrzałych, świadomych front-endów SSR w produkcie tej skali; kod nosi ślady
realnych incydentów i systematycznie je zamyka.

| Obszar | Ocena | Mocne strony | Słabości / ryzyka |
|--------|:-----:|--------------|-------------------|
| Root layout (`__root.tsx`) | **9** | Loader `Promise.allSettled` (nie kładzie serwisu); request-scoped język; skrypt config w `<head>` (naprawa incydentu) | `ErrorBoundary` nie otacza popupów/consent; 4 zduplikowane ekrany błędu |
| Router↔Query + SSR bootstrap | **8** | Przemyślane defaulty Query; rewrite EN/PL; domknięty race hydratacji; CSP defense-in-depth | `script-src 'unsafe-inline'`; monkey-patch na wewnętrznym API routera |
| Uniwersalny resolver (`$.tsx`) | **8** | Streaming (TTFB tylko na hero); LCP-preload 1:1 z renderem | `ResolvedPage` monolit ~560 l.; niejednolity prefetch |
| Warstwa zapytań (`queries/public`) | **8** | Body tylko przez gated RPC; usunięto N+1 `page_full_path` | **Waterfall autora**; `fetchGatedBody` woła RPC też dla treści public |
| Trasy taxonomii/autora | **8** | Stan w URL; strony >1 `noindex,follow`; JSON-LD | `tag` importuje `TaxonomyPage` z trasy `category`; zduplikowany `parseSearch` |
| **Legacy redirects + monitor 404** | **4** | Rdzeń dopasowania czysty i testowany | **Martwy w runtime** (patrz §5 — brak warstwy egzekucji) |
| SSR cache/tenant/crawler | **9** | `edgeTtlCache` scope „by construction"; content fail-open vs crawler fail-closed; `resilient()` | Efektywność cache niedeterministyczna (wiele izolatów) |
| Serwer MCP | **8** | Fail-closed auth (nie kładzie serwisu); sanityzacja LIKE/PostgREST | Duplikacja bootstrapu ×3; niepewność gatingu paywalla w `get_post` |
| Paywall/gating (`access/gating`) | **8** | Entitlement dowodzony obecnością body; re-gating na login/logout | „entitlement==body niepuste" łamie się dla pustego gated wpisu; martwy `useContentAccess` |
| Zliczanie odsłon / analytics | **8** | Fire-and-forget, anti-spam SECURITY DEFINER, autor nie zawyża; dedup ticker | `crypto.randomUUID` z fallbackiem `Math.random` (tylko anti-spam) |
| Personalizacja (interests/greetings/onboarding) | **8** | 3 bugi merge usunięte; rekomendacje 1 RPC; greeting bez waterfalla | **Dwa źródła tożsamości**; losowe kanały Realtime per mount; zdublowany literał |
| Hooki cross-cutting / Realtime | **8** | `onAuthStateChange` w try/catch; open-redirect guard; **LiveSync staff-only** (kwoty websocketów); liczniki materializowane | `loadContext` waterfall ról; błysk „brak uprawnień" |
| Endpointy API | **9** | Webhook Stripe modelowy; ingesty rate-limit+PII+204; TTS allowlista+budżet | Własna krypto podpisu; `as never` dla tabel spoza typów |
| Obsługa błędów / consent / a11y | **8** | Dwuwarstwowa; consent focus-trap+i18n+vendorzy; robots fail-closed | Popupy poza `ErrorBoundary`; `/search` bez `noindex` |

**Rekomendacje:** **[Krytyczne — SEO]** podłączyć warstwę egzekucji przekierowań + monitor 404;
**[Wysokie — wydajność]** domknąć waterfalle w `resolvedContentQueryOptions`; **[Średnie]** rozbić
monolit `ResolvedPage`; **[Średnie]** ujednolicić źródło tożsamości + literały personalizacji;
**[Niskie]** wspólny `RouteErrorFallback`, `noindex` `/search`, typy zamiast `as never`.

---

## 8. Logika wpisów, stron i innych elementów treści

Model treści jest **hybrydowy**, z jednym punktem decyzji (`resolveContentEngine`). Kolumna
`editor` na wierszu jest dyskryminatorem — autorytatywna jest tylko kolumna zgodna z `editor`:

| `editor` | Kolumna | Renderer | Zastosowanie |
|----------|---------|----------|--------------|
| `blocks` | `blocks_data` (jsonb) | `BlocksRenderer` | **Domyślny dla wpisów** — długie artykuły, opakowane w layout z `/admin/post-layouts` |
| `builder` | `builder_data` (jsonb) | `BuilderRenderer` | **Jedyny dla stron** — landing/microsite; opcjonalny dla wpisów |
| `richtext`/`markdown` | `content_pl`/`content_en` | sanityzowany HTML | Treść legacy/importowana |

**Typy encji i ich logika:**

| Element | Logika | Ocena wdrożenia |
|---------|--------|:---------------:|
| **Wpis (post)** | Pełny cykl edytorski: `draft → pending_review → published`, plus `scheduled` (auto-publish) i `archived`; role autora/edytora/admina; rewizje; presence; auto-301 przy zmianie permalinku; paywall na przywilejach kolumn | **7,5** |
| **Strona (page)** | Prosty cykl draft/published/archived; hierarchia parent/child; wyłącznie builder; render przez `resolve_path` bez N+1 | **7** (brak optimistic locking / ochrony cyklu) |
| **Taksonomie (kategorie/tagi)** | Archiwa z 6 layoutami, sort/paginacja w URL, `noindex,follow` dla stron >1, JSON-LD CollectionPage | **8** (leak `archive_layout_settings`) |
| **Digital Features** | Strona buildera złożona z widgetów `feature-*` (timeline/sankey/compare/risk-matrix/…); dane w formacie `;`/`PL\|EN` | **7,5** |
| **Podcast** | Sieć programów → sezony → odcinki; RSS globalny i per-program; agregacja na profilu eksperta | **7** |
| **Tracker EU** | Dossier legislacyjne z osią czasu, obserwowaniem, mapą stanowisk 27 państw | **8** |
| **Eksperci / programy** | Huby agregujące relację (posty/podcasty/eventy), SEO Person/CollectionPage | **6 / 8,5** |
| **Web-stories** | Viewer pełnoekranowy + równoległy dokument AMP | **6,5** |

Wspólna infrastruktura przekrojowa (sanityzacja, footnotes, izolacja błędów renderu, SEO/JSON-LD,
paywall) żyje **raz** i jest współdzielona przez wszystkie silniki — to jedna z najmocniejszych
decyzji architektonicznych platformy.

---

## 9. Defekty priorytetowe (skonsolidowane)

| Prio | Defekt | Lokalizacja | Skutek |
|:----:|--------|-------------|--------|
| **P0** | Brak izolacji tenanta w `archive_layout_settings` | migracja `20260716135520` | Admin dowolnego tenanta nadpisuje layout archiwów WSZYSTKICH tenantów |
| **P0** | Wyciek ukrytych bloków zagnieżdżonych | `BlocksRenderer.tsx:633-654,983-992,1064-1073` | `style.hidden` nie sprawdzany w rekurencji → ukryta treść na opublikowanej stronie |
| **P0** | Kolidujące triggery komentarzy | `20260713098000` vs `20260713140000` | Soft-delete autora zepsuty; okno edycji 5 zamiast 15 min |
| **P0** | Footgun mock-mode billing | `checkout.functions.ts:168`, `donations.functions.ts:125` | Bez `STRIPE_SECRET_KEY` w produkcji płatna treść/darowizny za darmo |
| **P1** | Pozorny code-splitting | `lazyWidgets.tsx` (+ `BlocksRenderer.tsx:97`) | Ciężkie widgety (slider, wykresy, features, DOMPurify) w bundlu KAŻDEJ strony |
| **P1** | Martwy menedżer przekierowań / monitor 404 | `seo/redirects.ts`, `record_seo_404` bez wołającego | Stare URL-e po migracji z WP → 404; strata link-equity; monitor pusty |
| **P1** | Asymetryczne `ContactFormView` | `MarketingViews.tsx:435` | Blok kontaktowy robi `supabase.insert` z klienta bez honeypota/server-fn |
| **P1** | Uploadery omijające walidację mediów | `CoverImagePicker:68`, `ImageSlot:41`, `AudioPicker:156` | Pliki bez walidacji/rate-limitu/audytu, osierocone poza tabelą `media` |
| **P1** | Brak paginacji audytorium newslettera | `newsletter-campaigns.functions.ts:563-587` | Ciche wysłanie tylko do ~1000 odbiorców na dużych listach |
| **P1** | Iniekcja CSS w hubie eksperta + brak walidacji kolorów theme | `ExpertLayoutRenderer.tsx:1053-1058`, `themeDesign.ts:19` | Możliwy breakout `<style>` / CSS-injection z ustawień tenanta |

---

## 10. Najmocniejsze strony platformy

1. **Bezpieczeństwo danych klasy powyżej typowego CMS** — dwupłaszczyznowy multi-tenant, paywall
   egzekwowany na przywilejach kolumn PostgreSQL (nie kosmetyka UI), step-up MFA, sekrety w Vault,
   kompletny SSRF egress-guard, entitlement wyłącznie z podpisanego webhooka Stripe.
2. **Intermodularność przez szynę zdarzeń** — `domain_events` (SECURITY DEFINER, kontrakt pilnowany
   testem) + korelacja klik→zdarzenie + optymistyczne mutacje z rollbackiem + graf cross-references.
3. **SSR/hydration i SEO/GEO/AEO na poziomie eksperckim** — request-scoped język (brak wyścigu),
   streaming, LCP-preload 1:1 z renderem, `safeJsonLd`, FAIL-CLOSED na powierzchniach crawlerów.
4. **Dyscyplina inżynierska** — `strict` + `no-explicit-any` (1 ręczny `as any` w ~1300 plikach),
   blokujący pipeline CI z wybitną warstwą pgTAP, uczciwe pomiary (porzucono fałszywe 98% coverage).
5. **Odporność „prezentacja nie kładzie serwisu"** — `Promise.allSettled` w loaderach, fail-closed
   auth MCP, degradacja zamiast 500 na powierzchniach crawlerów, izolacja błędów renderu per-widget/blok.

---

## 11. Priorytetyzowana mapa rekomendacji

**Natychmiast (P0 — bezpieczeństwo / poprawność):**
1. Izolacja tenanta `archive_layout_settings` (dodać `tenant_id`, `UNIQUE(tenant_id,archive_type)`, RLS z tenantem).
2. `style.hidden` + `RenderErrorBoundary` w rekurencji `BlocksRenderer`.
3. DROP/scalić kolidujące triggery komentarzy.
4. Fail-hard billing/donations przy braku `STRIPE_SECRET_KEY` w produkcji.

**Krótkoterminowo (P1 — wydajność / SEO / niezawodność):**
5. Przywrócić realny code-splitting (`lazyWidgets` + `BlocksRenderer:97`).
6. Podłączyć egzekucję przekierowań + monitor 404 (middleware request-path).
7. Ujednolicić `ContactFormView` (server-fn+honeypot) i upload mediów (`registerMediaUpload`).
8. Paginacja audytorium newslettera; scheduler drenażu outboxu integracji.
9. Generyczny linter RLS w CI (systemowe zabezpieczenie przed powtórką leaku z pkt. 1).

**Średnioterminowo (P2 — utrzymywalność / jakość):**
10. Redukcja re-parse w builderze (memoizacja); rozbić monolity (`ResolvedPage`, panele theme, `EditPost`).
11. Jeden rejestr typów bloków; dokończyć kontenery `group/columns`.
12. Uspójnić warstwę liczników; wpiąć knip; podnieść pokrycie routes/komponentów.
13. a11y: `aria-current`/skip-link/`DialogTitle`, spójne focus-states, tokeny zamiast twardych kolorów.
14. i18n: usunąć inline `lang==="en"?…` w podcast/web-stories; `safeUrl` na `cta_href`/URL źródeł.

---

## 12. Podsumowanie zbiorcze ocen

| Klaster / wymiar | Ocena |
|------------------|:-----:|
| Architektura danych / tenant / bezpieczeństwo | **8,7** |
| Routing / SSR / stan / personalizacja | **8,0** |
| Spójność / społeczność / monetyzacja | **8,0** |
| Jakość inżynierska / testy / CI | **8,0** |
| Treść / wpisy | **7,5** |
| SEO / i18n / obserwowalność / domena / admin-UX | **7,5** |
| Builder / strony / digital features | **7,0** |
| **PLATFORMA OGÓŁEM** | **~7,8 / 10** |

> **Kontekst oceny:** silnik i fundamenty są na poziomie 8,5–9. Werdykt 7,8 odzwierciedla ogon
> zlokalizowanych, w większości mechanicznych defektów warstwy aplikacyjnej (4 klasy P0, kilka P1).
> Wszystkie są jednoznacznie zlokalizowane i mechaniczne do naprawy — po ich domknięciu realny
> pułap platformy to **~8,5/10**. Trajektoria (7,3 → 8,2 → 7,8 przy szerszym zakresie) jest zdrowa:
> platforma rośnie funkcjonalnie szybciej, niż narasta dług, a każdy kolejny audyt zamyka nazwane luki.
