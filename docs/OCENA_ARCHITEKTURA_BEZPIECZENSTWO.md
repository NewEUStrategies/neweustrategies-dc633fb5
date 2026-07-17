# Ocena platformy — architektura kodu, bezpieczeństwo danych i funkcjonalności

Data audytu: **2026-07-12** · Stan: HEAD `56cbb9d` (branch `main` po rundach napraw 1–5
z `docs/OCENA_PLATFORMY.md` + „Reading time v2", migracja `search_premium`,
„Poprawiono wycieki danych"). Skala ocen **0–10**, przyznawana surowo: punktem odniesienia
jest dojrzała, produkcyjna, komercyjna platforma wydawnicza — nie prototyp.

## Metodologia

Audyt przeprowadzono jako **pięć niezależnych, równoległych przeglądów** (bezpieczeństwo
danych/RLS, warstwa serwerowa/API/płatności, architektura frontendu, inwentaryzacja
funkcji, testy/jakość/obserwowalność), skorelowanych z bezpośrednią weryfikacją kodu przez
prowadzącego. Każde ustalenie oparto na **realnym kodzie (file:line)**, a nie na changelogu —
wszędzie, gdzie prześledzono łańcuchy `CREATE OR REPLACE` / `DROP POLICY`, oceniano **stan
końcowy** obiektu, nie jego pierwszą wersję.

Skala systemu (zweryfikowana):

| Metryka                                                           | Wartość                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Linie kodu TS/TSX                                                 | **~201 300**                                                               |
| Pliki źródłowe TS/TSX                                             | **1 019** (847 nie-generowanych/nie-testowych; mediana 101 linii, p90 507) |
| Migracje SQL                                                      | **200** (~18 700 linii)                                                    |
| Polityki RLS (`CREATE POLICY`)                                    | **417**                                                                    |
| Funkcje `SECURITY DEFINER`                                        | **~285** w 88 plikach                                                      |
| Włączenia RLS (`ENABLE ROW LEVEL SECURITY`)                       | **116**                                                                    |
| Pliki testów jednostkowych (Vitest)                               | **158** (~1 190 przypadków, 0 pominiętych)                                 |
| Zestawy pgTAP                                                     | **12** (~98 asercji)                                                       |
| Specyfikacje e2e (Playwright)                                     | **4**                                                                      |
| Handlery serwerowe (`*.server.ts`) / server-fn (`*.functions.ts`) | **10 / 19**                                                                |

Stos: **React 19.2 + TanStack Start (SSR) / Router / Query**, **Supabase 2.106** (Postgres +
RLS + Auth + Realtime + Storage), TipTap 3, dnd-kit, Zod, DOMPurify (isomorphic), i18next,
Tailwind v4. Integracje (Stripe, ElevenLabs, Resend, WordPress.com) są **ręcznie
implementowane na `fetch`** (np. własna weryfikacja HMAC webhooka Stripe), bez ciężkich SDK.

---

## Werdykt ogólny: **~8,2 / 10**

To jest **dojrzała, produkcyjna platforma**, nie fasada. Niemal każda funkcja jest realnie
podłączona do bazy z RLS, triggerami, funkcjami `SECURITY DEFINER`, audytem i rate-limitami.
Wyróżnia się rzadko spotykaną **dyscypliną inżynierską**: dokumentacja pokrywa się z kodem,
konfiguracja pokrycia testami jawnie odrzuca „teatr coverage", a kontrakt bezpieczeństwa jest
zakodowany w testach pgTAP. Fundamenty — bezpieczeństwo danych, SEO/GEO, paywall, edytor
treści, multi-tenancy, płatności — są na poziomie klasy komercyjnej.

Ocenę w dół ciągną: **rozbudowana, ale słabo przetestowana warstwa społecznościowa**
(zero testów w czacie, komentarzach, powiadomieniach, personalizacji, profilu), **niedomknięta
warstwa analityki wzrostu** (brak metryk otwarć/kliknięć newslettera, wyświetleń reklam,
konwersji popupów), kilka **martwych paneli ustawień**, **importer WordPress niezgodny z nazwą**
(REST z WP.com, nie parser plików WXR), **brak MFA** oraz **kilka zachowań „fail-open"** i
**sekrety integracji w plaintext**.

| Obszar zbiorczy                                 | Ocena         |
| ----------------------------------------------- | ------------- |
| **Architektura kodu**                           | **8,5 / 10**  |
| **Bezpieczeństwo danych (w tym szyfrowanie)**   | **8,3 / 10**  |
| **Funkcjonalności**                             | **7,8 / 10**  |
| **Testy / jakość inżynierska / obserwowalność** | **8,5 / 10**  |
| **PLATFORMA OGÓŁEM**                            | **~8,2 / 10** |

---

## 1. Architektura kodu — **8,5 / 10**

| Wymiar                                        | Ocena | Uzasadnienie (dowody)                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organizacja modułów / separacja warstw        | **8** | Spójny podział `components/` `lib/` `hooks/` `routes/` `integrations/`; konwencja folderów-funkcji z `docs/ARCHITECTURE.md` §1 potwierdzona (brak barreli `index.ts`, brak `organisms/`). Czysta granica serwera (19 `*.functions.ts` + 10 `*.server.ts`). Minus: god-file `EditPost` (`admin.posts.$slug.tsx:190-1630`, ~1440 linii, 27 hooków) i wspólne `RenderErrorBoundary` schowane pod ścieżką admin/builder. |
| Silniki treści (bloki/builder, dispatch)      | **9** | `resolveContentEngine()` (`src/lib/content/contentEngine.ts:34`) to jeden 6-liniowy, czysty punkt decyzyjny, **pokrycie 100% w bramce**; `ContentRenderer` jako fasada. Walidacja Zod na granicach zaufania (`safeParseBlocks`). Drobny wyciek: `routes/$.tsx:839` i `routes/index.tsx:63,139` rozgałęziają po `editor` zamiast wołać dispatch.                                                                      |
| Zarządzanie stanem / data-fetching / realtime | **8** | QueryClient dobrze dostrojony (staleTime 5m, gcTime 30m), oficjalna integracja SSR-Query, ref-counted `tableChannelHub` (bell/center/messages → 1 socket), anonimowi = 0 websocketów. `eventInvalidationMap` typowo-wyczerpujący z testem kompletności. Minusy: brak centralnej fabryki kluczy zapytań (ryzyko dryfu), ~260 linii `useEventConfirmedMutation`/korelacji **bez konsumenta produkcyjnego**.            |
| Type-safety (TS strict)                       | **9** | `strict:true` + `noFallthroughCasesInSwitch`; `@typescript-eslint/no-explicit-any: error` **realnie trzyma** (0 jawnych `any`, 0 `@ts-ignore` w kodzie nie-testowym). Typy `Database` Supabase wpięte end-to-end. Escape hatch skupiony na granicy jsonb (`as unknown as X`, ~109 miejsc, backstopowany Zodem).                                                                                                      |
| Renderowanie / SSR                            | **9** | SSR odporny (fallback na h3-swallowed-throw w `server.ts:23`, anty-FOUC skrypt motywu, per-request klon i18next), streaming Suspense sekcji below-the-fold, izolacja błędów renderu per blok/sekcja/widget.                                                                                                                                                                                                          |
| i18n (architektura)                           | **7** | Infrastruktura routingu/SSR klasy world-class (PL bez prefiksu, EN `/en`, jedna czysta `localePath.ts`, klon i18next chroniący edge-cache). ALE brak kanonicznego pickera kolumn: **3 rozbieżne `pickLang` + ~379 inline ternary `lang==="en"?_en:_pl` w 103 plikach**; niespójny fallback → ryzyko pustej treści (`llms.txt:58`). Konstrukcyjnie 2-językowy (trzeci język = nowe kolumny + edycja typów).           |
| Wydajność / bundling                          | **9** | `check:bundle` z **3 budżetami** (PUBLIC ≤1000KB ~930, OVERALL ≤1300KB ~1200, CHUNK ≤250KB ~181) egzekwowanymi w CI; celowe `manualChunks`, 31 `React.lazy` + 97 dynamic import, `OptimizedImage` (srcSet/fetchPriority/LCP), edge-cache skopowany po tenancie. Cienki zapas OVERALL napędzany panelami 2000-liniowymi.                                                                                              |
| Jakość i spójność kodu                        | **8** | Bramki CI w udokumentowanej kolejności; **tylko 1 TODO/FIXME w 201K linii**, brak sekretów w kodzie, spójne nazewnictwo, uczciwa i trafna `ARCHITECTURE.md`. Minus: niski globalny próg pokrycia; zatłoczony płaski `src/lib`.                                                                                                                                                                                       |

**Silnik spójności międzymodułowej** (`domain_events` + `src/lib/realtime/`, migracje
`20260711200000`–`204000`, ~1938 linii) to realna szyna zdarzeń (15 typów zdarzeń, emitery
`SECURITY DEFINER`, silnik workflow, outbox integracji, idempotencja `command_idempotency`) —
nie scaffolding. Ambitna, ale częściowo zbudowana „na wyrost" (korelacja bez konsumenta).

---

## 2. Bezpieczeństwo danych i szyfrowanie — **8,3 / 10**

| Wymiar                                      | Ocena | Uzasadnienie (dowody)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row-Level Security (RLS)                    | **9** | RLS włączony na każdej badanej tabeli, w tym wszystkich wrażliwych (`profiles`, `user_roles`, `crm_*`, `newsletter_subscribers`, `messages`, `billing_profiles`, `payment_orders`, `audit_log`). `rate_limits` — RLS bez polityk (tylko service-role). Groźne `profiles USING(true)` usunięte; tabele metadanych rescopowane do `tenant_id = public_tenant_id()`. Reszta `USING(true)` tylko na config low-sensitivity.                                                                                                                                                                                                                                                                                                                                                                      |
| Izolacja tenantów                           | **9** | `profiles.tenant_id` niezmienialny (trigger `profiles_pin_tenant`) — self-hijack kontekstu cofany. **Dowiedzione w pgTAP**: tenant A nie czyta postów tenanta B (draft i published). Anon-writes przypięte do przeglądanego tenanta. Ciąg historycznych dziur cross-tenant znaleziony i **naprawiony** (`20260708120000_platform_bugfixes_rls.sql`).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Kontrola dostępu / role / anty-eskalacja    | **9** | Bezpośrednie zapisy do `user_roles` zamknięte (REVOKE); zmiana roli tylko przez `change_user_role()` (`SECURITY DEFINER`: actor=admin, **nie własna rola**, super_admin tylko przez super_admina, ten sam tenant, pełny audyt). **Dowiedzione w pgTAP**. `handle_new_user()` daje staff-role tylko z `raw_app_meta_data` (service-role).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Funkcje `SECURITY DEFINER`                  | **9** | Skan ~285 funkcji: **zero** bez `SET search_path`. EXECUTE konsekwentnie REVOKE od PUBLIC/anon, grant wąsko. Jedyny historyczny brak (nieREVOKEowany `crm_upsert_from_form`) już naprawiony.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Uwierzytelnianie / autoryzacja (middleware) | **9** | Dwuwarstwowe: `requireSupabaseAuth` (weryfikuje JWT) + `requireStaff` (drugi, **niezależny od RLS** check roli). Zapisy przez service-role zawsze przypięte do `user_id`/`tenant_id` (obrona przed IDOR potwierdzona). Minus: auth server-fn jest opt-in (brak globalnego default-deny).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Szyfrowanie i zarządzanie sekretami**     | **7** | **W transporcie:** TLS wszędzie. **Hasła:** bcrypt (`crypt(..., gen_salt('bf',10))`) — zarówno Auth Supabase, jak i hasła treści paywalla, z serwerowym limitem prób 10/min. **Podpisy:** HMAC-SHA256 + `timingSafeEqual` (webhook Stripe, integracje wychodzące). **Higiena sekretów: wzorcowa (10/10)** — żaden sekret nie ma prefiksu `VITE_`, service-role tylko w `*.server.ts`, nic nie wyciekane do klienta. **Minusy ciągnące ocenę:** brak szyfrowania PII na poziomie kolumn (poleganie na szyfrowaniu dysku Supabase at-rest), **klucze integracji Merydian (`merydian_api_key`, `merydian_webhook_secret`) w kolumnach plaintext** (brak pgcrypto/Vault), brak MFA/TOTP.                                                                                                         |
| Ochrona PII / RODO                          | **8** | `profiles.email`/`prefs` **nigdy** czytelne dla klienta (dowiedzione `has_column_privilege` w pgTAP); własny wiersz przez `get_own_profile()`. `newsletter_subscribers` staff-only, double-opt-in serwerowy. `profile_is_public()` wymaga roli redakcyjnej (koniec anon-enumeracji CV/psychometrii). Jedyny widok (`crm_leads_all`) ma `security_invoker=true`. **Reszta ryzyka:** rola `author` (najniższa redakcyjna) widzi `phone/contact_email/gender/location` wszystkich profili w współdzielonym tenancie; **pliki CV trafiają do publicznego bucketa `media`** (`ProfileExtraSections.tsx:759`, `getPublicUrl`; RLS chroni tylko wiersz metadanych `profile_cv_files`, ale bajty pliku są pobieralne po URL) — konkretna ekspozycja PII; brak dedykowanego prywatnego bucketa na CV. |
| Sanityzacja / XSS                           | **9** | `src/lib/sanitize.ts` wyrafinowany: 2 profile DOMPurify, `hardenStyleCss` (obrona przed breakout `</style>`), rekurencyjne skopowanie CSS at-rules, allowlisty schematów URL. **Wszystkie publiczne sinki sanityzowane.** Jedyne surowe sinki (`AdSlot` html/script) są intencjonalne i staff-gated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Płatności (Stripe)                          | **9** | Ceny rozwiązywane serwerowo (klient nie manipuluje kwotą), weryfikacja podpisu na **surowym body** + tolerancja 5 min + `timingSafeEqual`, idempotentne nadawanie uprawnień (klucz `external_ref`), refund zawężony do właściwej subskrypcji. Najlepiej przetestowany przepływ (16 przypadków z realnym HMAC).                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Rate limiting / anty-nadużycia              | **7** | Pokrycie kosztownych endpointów (TTS auth+staff+dwa okna, newsletter/kontakt 5/10min per IP, ingest telemetrii). **Minus: „fail-open"** przy błędzie DB (awaria Supabase wyłącza ochronę budżetu ElevenLabs) oraz limiter in-memory per-isolate (słaby na multi-instance).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Audyt / logowanie                           | **8** | `audit_log` (30+ akcji, tenant+actor RLS, admin-read), `role_audit_log` (każda zmiana roli), `impersonation_sessions` (super-admin-gated, nie self-impersonation). Best-effort (połyka błędy — celowo). Brak audytu odczytów PII; każdy user może insertować własne wiersze audit_log (log-spam).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

### Szyfrowanie — podsumowanie osobne (na wyraźne pytanie)

| Warstwa                               | Stan                                                                      | Ocena cząstkowa |
| ------------------------------------- | ------------------------------------------------------------------------- | --------------- |
| Transport (in-transit)                | HTTPS/TLS na całej ścieżce (Supabase, proxy, Stripe/Resend/ElevenLabs)    | ✅ mocne        |
| Hasła użytkowników i treści           | **bcrypt** (`gen_salt('bf',10)`), weryfikacja serwerowa + limit prób      | ✅ mocne        |
| Podpisy / integralność                | **HMAC-SHA256** + `timingSafeEqual` (webhook Stripe, outbox integracji)   | ✅ mocne        |
| Tokeny (double-opt-in, recovery)      | mintowane serwerowo, nieodgadywalne (32 B losowe)                         | ✅ mocne        |
| Higiena sekretów                      | brak `VITE_`-owych sekretów, service-role tylko serwerowo, nic do klienta | ✅ wzorcowe     |
| **PII at-rest (kolumny)**             | **brak szyfrowania pola** — poleganie na szyfrowaniu dysku platformy      | ⚠️ luka         |
| **Sekrety stron trzecich (Merydian)** | **plaintext w kolumnach**, brak Vault/pgcrypto                            | ⚠️ ryzyko       |
| MFA / TOTP                            | **brak**                                                                  | ⚠️ luka         |

### 3 najważniejsze ryzyka bezpieczeństwa

1. **Sekrety stron trzecich w plaintext** — `crm_integrations.merydian_api_key` /
   `merydian_webhook_secret` w niezaszyfrowanych kolumnach (mitygacja: RLS admin-only).
   Rekomendacja: Supabase Vault / pgcrypto (envelope encryption), deszyfracja tylko w
   ścieżce dispatchu service-role.
2. **Kruchość modelu grantów kolumnowych** — `profiles SELECT` regresował **dwukrotnie**,
   za każdym razem chwilowo odsłaniając `email`/`prefs` dla całego staffu, zanim naprawiono.
   Rekomendacja: rozszerzyć asercje `has_column_privilege` w pgTAP na wszystkie kolumny PII,
   by regresja **łamała build**.
3. **Zachowania „fail-open"** — limiter rate (`rate-limit.server.ts:38,52`) i auth MCP
   (`mcp/index.ts:21`, gdy brak `SUPABASE_URL`) degradują się **otwarcie**. Rekomendacja:
   fail-closed dla scope'ów kosztowych i endpointu MCP.

> **Uwaga dla właściciela:** wcześniejszy trigger auto-nadający `super_admin` na twardo
> zakodowany e-mail `marketing@neweuropeanstrategies.com` (adres logowania właściciela) został
> **usunięty** migracją `20260703090000_remove_super_admin_backdoor.sql`. To pozytywne
> domknięcie — provisioning ról jest teraz wyłącznie operacyjny (service-role).

---

## 3. Funkcjonalności — **7,8 / 10**

### 3a. Oceny wymiarowe

| Wymiar                                | Ocena   | Uzasadnienie                                                                                                                                                                                                                   |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Szerokość funkcji                     | **9**   | ~71 tras `/admin.*` obejmujących CMS, CRM, newsletter, paywall, personalizację, web-stories, podcasty, live-blog, A/B, RUM, import WP, MCP, TTS, szynę zdarzeń — przewyższa powierzchnię większości komercyjnych CMS-ów.       |
| Głębia / kompletność                  | **7,5** | Niemal każda funkcja DB-backed z RLS/triggerami, ale realny ogon jest płytki (metryki reklam/newslettera, narzędzia MCP, martwe pola ustawień, całe obszary bez testów).                                                       |
| Autoring treści (UX)                  | **9**   | 99 typów bloków + builder 60-widżetowy, autozapis z ochroną przed utratą danych, undo/redo per język, rewizje (posty **i** strony), workflow potrójnie egzekwowany, presence. Najlepiej przetestowany podsystem.               |
| SEO / GEO                             | **9**   | Klasa agencyjna: sitemapy hreflang, news-sitemap 48 h, robots fail-closed z polityką AI-crawlerów, llms.txt, 4 rodziny JSON-LD, menedżer przekierowań (wildcard/410/CSV), 15 plików testów.                                    |
| Monetyzacja / paywall / Stripe        | **8**   | Paywall egzekwowany na **grantach kolumn Postgresa** (nieobchodzalny z klienta) + realny Stripe. Minusy: brak Customer Portal, brak meteringu, dane podatkowe zbierane, ale nie wysyłane do Stripe, `invoice_url` martwe w UI. |
| Personalizacja                        | **6,5** | Realny ważony rekomender SQL + obserwacje/zainteresowania/Big Five/powitania z merge gościa. Minusy: wąska powierzchnia konsumpcji, wynik testu osobowości nie zasila rekomendacji, **zero testów**.                           |
| Innowacyjność (MCP/AI, realtime, TTS) | **8**   | Realna szyna zdarzeń domenowych (korelacja, optymistyczne potwierdzenia, silnik workflow, idempotencja), MCP na OAuth, cache TTS. Ograniczone przez płytki MCP (ILIKE zamiast własnego FTS) i jednego dostawcę TTS.            |

### 3b. Dojrzałość modułów (przegląd)

| Moduł                  | Ocena     | Dowód / uwaga                                                                                                                |
| ---------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Bloki (Gutenberg)      | **9**     | dokładnie 99 typów, `BlocksRenderer` z 99 gałęziami, degradacja `safeParseBlocks`, undo/redo per język                       |
| Builder (Elementor)    | **9**     | 60 widżetów (1 ukryty), model sekcja→kolumna→widget, natywny HTML5 DnD, izolacja błędów per węzeł                            |
| Rich text / markdown   | **8**     | TipTap v3; `window.prompt` **zastąpiony** dialogami design-systemu (poprawka potwierdzona)                                   |
| Rewizje treści         | **9**     | posty **i** strony, throttle 5 min, limit 50, restore nie zmienia statusu (bez przypadkowej publikacji)                      |
| Workflow redakcyjny    | **9**     | 5 statusów, potrójne egzekwowanie (UI + server-fn + trigger `posts_workflow_guard`), pg_cron `publish_due_posts`             |
| Multi-tenancy          | **9**     | 2 płaszczyzny RLS (anon fail-open / crawler fail-closed), cache SSR skopowany po hoście, self-signup tenanta zamknięty       |
| Wyszukiwarka (FTS)     | **9**     | tsvector ważony (A/B/C), unaccent, GIN, tenant-scoped RPC, tier „premium" (telemetria, did-you-mean trgm, snippety), pgTAP   |
| Role / użytkownicy     | **9**     | model 1-rola, audytowany `change_user_role`, blokada eskalacji, impersonacja super-admina                                    |
| Motyw / wygląd         | **9 / 8** | 68 zmiennych `--td-*` + 70+ slotów kolorów, 5 sanityzowanych injektorów `<style>`; post-sidebar: 5/6 widżetów bez inspektora |
| Podcasty / audio / TTS | **8**     | realny upload (auto-czas), RSS z `<enclosure>`, Media Session, cache TTS przed limiterem                                     |
| Czat (DM)              | **8**     | RLS v2, blokowanie użytkowników, rate-limit 30/min, kursory złożone, typing na stałym kanale — **ale zero testów**           |
| Powiadomienia          | **8**     | producenci w triggerach, dedup 5 min, wszystkie 7 przełączników honorowanych — **zero testów**                               |
| CRM                    | **8**     | lead-inbox, pipeline 7 etapów, oś czasu, integracja HMAC z dead-letter, obrony przed CSV/`.or()`-injection                   |
| Reklamy                | **6,5**   | 7 pozycji, targeting, zgody, ochrona CLS — **zero pomiaru wyświetleń/kliknięć**                                              |
| Popupy                 | **7**     | 4 triggery, capping (localStorage), a11y — **zero pomiaru konwersji**                                                        |
| Newsletter             | **7**     | double-opt-in, RFC 8058, sync send — **harmonogram nieosiągalny z UI**, brak open/click                                      |
| Ustawienia             | **5**     | dobra infra `useSiteSetting`, ale **~22/41 pól martwych**; strony media/permalinks/privacy to **stuby**                      |
| Import WordPress       | **4**     | **nie WXR/XML — to importer REST z WP.com**; nietransakcyjny, nierestartowalny, tylko posty                                  |
| MCP (AI tooling)       | **7**     | realny serwer OAuth na JWT Supabase, sanityzacja injection; płytki (mało narzędzi, `search_posts` na ILIKE)                  |
| Obserwowalność / RUM   | **8**     | 5 vitali → beacon → p75 dashboard tenant-scoped; `client_errors` to **sink write-only** (brak dashboardu błędów)             |

**Ogólny wynik funkcjonalny 7,8/10** jest spójny z — i lekko poniżej — własnego oszacowania
repo po rundzie 5 (~8,2), po odjęciu za nieprzetestowaną warstwę społecznościową, ślepe plamy
analityczne, brak MFA i płytki ogon MCP/monetyzacji.

---

## 4. Testy / jakość inżynierska / obserwowalność — **8,5 / 10**

| Wymiar                     | Ocena | Uzasadnienie                                                                                                                                                                                                                               |
| -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Testy jednostkowe (Vitest) | **7** | 158 plików / ~1190 przypadków / 0 pominiętych; **uczciwa** bramka pokrycia (globalny próg ~20% stmts jawnie nie-teatralny) z **progami 100% na krytycznych ścieżkach** (contentEngine, billing/stripe, gating). Niska szerokość absolutna. |
| Testy DB (pgTAP)           | **9** | 12 plików / ~98 asercji testujących to, czego Vitest nie dosięgnie: izolacja tenantów, anty-eskalacja ról, **ACL kolumn PII** (`has_column_privilege`), FTS — z impersonacją anon/authenticated i asercjami SQLSTATE w `ROLLBACK`.         |
| E2E (Playwright)           | **7** | 4 specy; warstwa agnostyczna (smoke, 0 `pageerror`) + seeded (`E2E_SEEDED=1`, realny lokalny Supabase, sprawdzenie surowego SSR crawlera). Minus: tylko Chromium, brak authed-write ścieżki admina.                                        |
| CI / bramki jakości        | **9** | Blokująca kolejność `tsc --noEmit → test:coverage → build → check:bundle → lint` + osobny job pgTAP na realnym Postgresie; deterministyczny budżet bundla; Lighthouse (blokujący w trybie deployed). Minus: knip nie wpięty, brak SCA.     |
| Type-safety / lint         | **8** | `strict:true`, `no-explicit-any: error` realnie trzyma; `tsc --noEmit` wymagany. Minus: `noUnusedLocals/Parameters:false`, knip nieegzekwowany.                                                                                            |
| Obserwowalność             | **8** | Self-hosted RUM (p75 dashboard tenant-scoped), correlation-id → `domain_events`, ingest błędów klienta z limitami. **Główna luka: brak maskowania PII** — `client-errors`/`vitals` zapisują message/stack/URL (query-stringi) verbatim.    |
| Odporność / obsługa błędów | **9** | Outbox integracji z **backoffem wykładniczym + DLQ** (dead po 8 próbach), idempotencja end-to-end (`command_idempotency`), izolacja renderu SSR-safe per widget.                                                                           |
| Zdrowie zależności         | **9** | Nowoczesny, lekki stos (React 19.2, Vite 7, Vitest 4, TanStack aktualne), lockfile w repo. Minus: jeden pin pre-release (`nitro …-beta`), młody ekosystem Start, brak Dependabota.                                                         |

---

## 5. Najważniejsze mocne strony

- **Paywall na poziomie grantów kolumn Postgresa** (REVOKE + RPC `SECURITY DEFINER`) — realnie
  nieobchodzalny z klienta; hasła treści bcrypt z serwerowym limitem prób.
- **Autoryzacja jako defense-in-depth**, nie tylko RLS — `requireStaff` sprawdza rolę niezależnie;
  zapisy service-role zawsze przypięte do tenanta/użytkownika.
- **Webhook Stripe podręcznikowy** — surowy body + HMAC + `timingSafeEqual` + okno replay +
  idempotencja na poziomie uprawnień, z testami.
- **Multi-tenant RLS dowiedziony w pgTAP** — izolacja tenantów, anty-eskalacja ról, ACL PII.
- **Sanityzacja wyrafinowana** — DOMPurify + skopowany CSS + obrona przed breakout `</style>`.
- **SEO/GEO klasy agencyjnej** — poziom, jakiego nie ma większość komercyjnych CMS-ów.
- **Uczciwość inżynierska** — dokumentacja zgodna z kodem, konfiguracja coverage odrzuca „teatr",
  changelog przyznaje się do wycofanych eksperymentów.

## 6. Najważniejsze rekomendacje (priorytetowo)

1. **Zaszyfrować sekrety integracji** (Merydian) — Vault/pgcrypto zamiast plaintext; przy okazji **przenieść pliki CV do prywatnego bucketa** (dziś publiczny `media`).
2. **Utwardzić model grantów PII w CI** — asercje `has_column_privilege` na wszystkie kolumny PII,
   by regresja łamała build (bo `profiles SELECT` regresował już dwukrotnie).
3. **Zmienić „fail-open" na „fail-closed"** dla limitera kosztowego i auth MCP.
4. **Dodać maskowanie PII w telemetrii** (message/stack/URL) przed zapisem.
5. **Pokryć testami warstwę społecznościową** (czat, komentarze, powiadomienia, personalizacja) —
   dziś funkcjonalnie najbogatsza, a najmniej zweryfikowana.
6. **Rozbić god-file `EditPost`** i wprowadzić jeden `pickLocalized(row, field, lang)` z jednolitą
   polityką fallbacku (zamiast ~379 inline ternary).
7. **Dodać MFA/TOTP** oraz analitykę wzrostu (open/click newslettera, wyświetlenia reklam,
   konwersje popupów).
8. **Doprowadzić martwe panele ustawień do stanu użytecznego** (media/permalinks/privacy) lub je
   ukryć; nazwać importer WordPress zgodnie z tym, czym jest (REST z WP.com).

---

## 7. Podsumowanie zbiorcze ocen

| Obszar                                    | Ocena         |
| ----------------------------------------- | ------------- |
| Architektura kodu                         | **8,5 / 10**  |
| — organizacja / separacja warstw          | 8             |
| — silniki treści (dispatch)               | 9             |
| — stan / data-fetching / realtime         | 8             |
| — type-safety                             | 9             |
| — renderowanie / SSR                      | 9             |
| — i18n (architektura)                     | 7             |
| — wydajność / bundling                    | 9             |
| — jakość / spójność                       | 8             |
| Bezpieczeństwo danych (w tym szyfrowanie) | **8,3 / 10**  |
| — RLS                                     | 9             |
| — izolacja tenantów                       | 9             |
| — role / anty-eskalacja                   | 9             |
| — SECURITY DEFINER                        | 9             |
| — uwierzytelnianie / autoryzacja          | 9             |
| — **szyfrowanie / sekrety**               | 7             |
| — ochrona PII / RODO                      | 8             |
| — sanityzacja / XSS                       | 9             |
| — płatności (Stripe)                      | 9             |
| — rate limiting                           | 7             |
| — audyt                                   | 8             |
| Funkcjonalności                           | **7,8 / 10**  |
| — szerokość                               | 9             |
| — głębia / kompletność                    | 7,5           |
| — autoring treści                         | 9             |
| — SEO / GEO                               | 9             |
| — monetyzacja / paywall                   | 8             |
| — personalizacja                          | 6,5           |
| — innowacyjność (MCP/realtime/TTS)        | 8             |
| Testy / jakość / obserwowalność           | **8,5 / 10**  |
| — testy jednostkowe                       | 7             |
| — testy DB (pgTAP)                        | 9             |
| — e2e                                     | 7             |
| — CI / bramki                             | 9             |
| — type-safety / lint                      | 8             |
| — obserwowalność                          | 8             |
| — odporność                               | 9             |
| — zdrowie zależności                      | 9             |
| **PLATFORMA OGÓŁEM**                      | **~8,2 / 10** |

---

# Wdrożenie rekomendacji (2026-07-12)

Wszystkie 8 rekomendacji z sekcji 6 zostało zaimplementowanych. Zmiany zaprojektowano
adwersaryjnie (równoległy panel projektowy), a następnie zaaplikowano i zweryfikowano
lokalnie (`tsc --noEmit` = 0 błędów, `bun run test` = 1525 przechodzą / 5 pominiętych,
`bun run lint` = 0 błędów). Nowe tabele DB używają wzorca `.from("tbl" as never)` (bez
edycji generowanego `types.ts`); migracje są idempotentne.

| #   | Rekomendacja                                         | Wdrożenie                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Szyfrowanie sekretów integracji + prywatny bucket CV | Sekrety Merydian przeniesione do **Supabase Vault** (kolumny `*_id` + RPC `SECURITY DEFINER` `crm_set/get_merydian_secret`, plaintext DROP, backfill); pliki CV do prywatnego bucketa `cv` z RLS per-właściciel i signed-URL. Migracja `20260712140000`; UI sekretów „write-only".                                                                          |
| 2   | Bramka CI grantów PII                                | `supabase/tests/pii_column_grants_test.sql` — `has_column_privilege` na `profiles/newsletter_subscribers/billing_profiles/crm_leads/contact_messages`; regresja grantu = błąd pgTAP w CI.                                                                                                                                                                   |
| 3   | Fail-closed dla scope'ów kosztowych i MCP            | `rateLimit({ failClosed })` — TTS (minute/hour/post) egzekwują odmowę przy awarii licznika; `mcp/index.ts` rzuca błąd przy braku issuera zamiast serwować bez auth.                                                                                                                                                                                         |
| 4   | Maskowanie PII w telemetrii                          | `src/lib/observability/redact.ts` (e-maile, JWT, Bearer, wrażliwe parametry query, długie tokeny) wpięte w `client-errors` i `vitals` przed zapisem; testy.                                                                                                                                                                                                 |
| 5   | Testy warstwy społecznościowej                       | Czysta logika wydzielona (chat cache/edit-window, drzewo komentarzy, gating powiadomień, slug personalizacji) + **41 nowych testów** (6 zestawów) bez regresji zachowania.                                                                                                                                                                                  |
| 6   | Dekompozycja `EditPost` + `pickLocalized`            | `EditPost` rozbity na 5 komponentów prezentacyjnych + helper (`src/components/admin/post-editor/`); kanoniczny `src/lib/i18n/pickLocalized.ts` (jedna polityka fallbacku) — skonsolidowane 3 rozbieżne `pickLang` + sweep megaMenu.                                                                                                                         |
| 7   | MFA/TOTP + analityka wzrostu                         | **MFA TOTP** przez Supabase Auth (enroll/verify/unenroll na `/profile/security` + step-up AAL2 w `/login` i popupie). **Analityka**: open/click newslettera (piksel + redirect z ochroną przed open-redirect), impresje/kliknięcia reklam, wyświetlenia/konwersje popupów — tabele zdarzeń, ingesty fail-safe, widoki w adminie. Migracja `20260712150000`. |
| 8   | Panele ustawień + nazwa importu WP                   | Panel prywatności realnie steruje banerem cookie (`cookie_banner` + link `privacy_page_slug` w `ConsentBanner`); nota o zakresie rozmiarów mediów; import WP jawnie opisany jako REST z WordPress.com (nie plik WXR/XML).                                                                                                                                   |

> Uwaga operacyjna: MFA TOTP wymaga włączenia w ustawieniach Supabase Auth. Klucz Vault
> jest zarządzany przez Supabase (brak nowego sekretu w env). Istniejące pliki CV z
> publicznego bucketa `media` wymagają jednorazowego backfillu do `cv` (poza zakresem tej
> rundy — nowe uploady są już prywatne).
