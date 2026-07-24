# Wdrożenie rekomendacji z audytu - status (2026-07-23)

> Dokument śledzi wdrożenie rekomendacji z `OCENA_PLATFORMY_I_MODULOW_2026-07-23.md`.
> Wszystkie pozycje „WDROŻONE" przeszły `tsc --noEmit`, `eslint` i - gdzie dotyczy -
> testy jednostkowe (zielono lokalnie). Migracje SQL są forward-only i idempotentne;
> pgTAP zweryfikuje je w CI.

## Zasady wdrożenia (spełnione wymagania)

- **Bez `any`/`as any`** - nowy kod nie wprowadza `any` ani `as any` (użyto `as never`
  wyłącznie tam, gdzie robił to już istniejący kod dla tabel spoza wygenerowanych typów).
- **i18n PL/EN** - nowe teksty dodane w obu językach (`qa.voted`); pozostałe użyły
  istniejących kluczy.
- **tenant_id / izolacja** - poprawki wzmacniają izolację (grant profiles, crm_upsert_lead,
  monetization_dashboard, ad-event), a nie ją osłabiają.
- **„-" zamiast „—"** - nowe komentarze i teksty używają dywizu.
- **Testy** - dodane dla nowych czystych funkcji (poster AMP, `safeStoryHref`) + pgTAP
  dla `crm_upsert_lead`.

## WDROŻONE - Fala 1: krytyczne bezpieczeństwo/poprawność (SQL/RLS)

| Rek. | Wdrożenie |
|------|-----------|
| P0 kolizja migracji `20260723180000` | `20260724090000_fix_seed_pricing_defaults_merge.sql` - scalony `seed_pricing_defaults` (flagi czatu + katalog v5) + idempotentny backfill |
| P1 PII profiles dla `authenticated` | `20260724090100_...` - `REVOKE SELECT ... FROM authenticated`; przywrócenie zaufanej projekcji `profiles_public` (`security_invoker=off`) + polityka redakcyjna dla `anon` |
| P1 `crm_upsert_lead` cross-tenant | `20260724090200_...` - `REVOKE EXECUTE ... FROM authenticated` + test pgTAP `crm_upsert_lead_authz_test.sql` |
| P1 wyciek przychodu | `20260724090300_...` - `tenant_id = v_tenant` w CTE `orders` `monetization_dashboard` |
| P1 obejście moderacji komentarzy | `20260724090400_...` - reset do `pending` przy edycji po zatwierdzeniu (tenant z moderacją) |
| P1 kwota expert-request | `20260724090500_...` - advisory lock per nadawca + liczenie puli niezależnie od anulowań |
| P1 domyślne Gift Articles | `20260724090600_...` - bezpieczne domyślne (limit/TTL) + `max_redemptions_per_link` egzekwowany w `redeem_gift_link` + lock per nadawca |

## WDROŻONE - Fala 2-3: frontend, RODO, integralność, UX

| Rek. | Plik(i) |
|------|---------|
| P1 XSS href widgetu buildera | `BuilderRenderer.tsx` - `safeUrl()` |
| P0/P1 LIKE-injection w folderach mediów | `media.functions.ts` - `likePrefix()` escapuje `\ % _` |
| P1 SVG w publicznym buckecie | `media.functions.ts` - usunięto `image/svg+xml` z allowlisty |
| P1 XSS `cta_href` web-stories | `web-stories/types.ts` (`safeStoryHref` + transform) + `StoryViewer.tsx` |
| P0 AMP poster=wideo | `ampStory.ts` - `resolvePosterPortrait` zawsze zwraca obraz (+ testy) |
| P1 spoofowalne metryki `ad-event` | `ad-event.ts` - weryfikacja przynależności slotu/placementu do tenanta hosta |
| P0/P1 mismatch hydratacji buildera | `BuilderRenderer.tsx` - `device ?? "desktop"` (desktop-first) |
| P1 RSS programów - zła tabela | `publishedContent.server.ts` - `research_programs` + `category_id` |
| P1 RODO web-vitals bez teardown | `webVitals.ts` + `observability/index.ts` - teardown przy cofnięciu zgody |
| P1 RODO beacony ad/popup bez zgody | `analytics/events.ts` - bramka `hasCategoryConsent("marketing")` |
| P1 popup nie-do-zamknięcia | `PopupHost.tsx` - przycisk X wymuszany gdy tło nie zamyka |
| P1 bug podwójnej edycji komentarza | `CommentsSection.tsx` - `submitting` + zamknięcie po sukcesie (`mutateAsync`) |
| P1 `/messages` bez gate `chat_enabled` | `messages.tsx` - bramka modułu czatu (powiadomienia/zgody zostają) |
| P1 parytet głosowania Q&A | `20260724090700_qa_list_my_vote.sql` + `qa.$slug.tsx` (`aria-pressed`, stan) + i18n |
| P1 newsletter HTML bez unsubscribe | `newsletter-campaigns.functions.ts` - guard `origin` dla obu trybów |
| P1 osierocone dostawy integracji | `20260724090800_...` - dzierżawa + re-claim `delivering` |
| P1 dead-dep `recharts` | `package.json` |
| P1 `RouteProgress` mylący | `RouteProgress.tsx` - tylko nawigacja routera |
| P2 filtr tenanta top-postów | `audience.functions.ts` - `.eq("tenant_id", ...)` |

## WDROŻONE - Fala 5: niezawodność + zielony zestaw testów

| Rek. | Wdrożenie |
|------|-----------|
| P1 budżet czasu `jobs-tick` | `jobsTick.server.ts` - globalny deadline 25 s (`runJobStep`): kosztowne joby sieciowe pomijane przy wyczerpaniu budżetu (idempotentne, wracają w kolejnym ticku), zamiast zabicia ticku w połowie |
| Naprawa wszystkich failujących testów | 2463 pass / 0 fail: `SearchAutosuggest`, `SearchButtonWidget`, `PeopleOrgResults` (pre-existing z maina - zmiana `suggestionHref`/react-query) + `observability/index.test` (nowy kontrakt teardown `initWebVitals`) |

## WDROŻONE - Fala 6: optimistic-lock + autosave stron

| Rek. | Wdrożenie |
|------|-----------|
| P1 optimistic-lock `updatePost`/`updatePage` | `content.functions.ts` - zapis niesie `baseUpdatedAt`; serwer odrzuca zapis, gdy wiersz zmienił się w międzyczasie (wczesny check + atomowy guard `.eq("updated_at")` + rozróżnienie konflikt/RLS na 0 wierszy). Kontrakt `src/lib/content/saveConflict.ts` (+ test). Klient (`usePostEditorForm`, `admin.pages.$slug`) przekazuje bazę, przesuwa ją po zapisie i pokazuje i18n toast konfliktu (`admin.editConflict` PL/EN) |
| P1 autosave stron | `admin.pages.$slug.tsx` - autosave włączony (`enabled: !!form`), bezpieczny dzięki optimistic-lockowi; koniec z utratą pracy przy awarii/zamknięciu karty |

## WDROŻONE - Fala 7: przyczyna źródłowa izolacji tenantów w SECURITY DEFINER

> Migracja `20260724091000_harden_security_definer_tenant_scope.sql` + bramka
> pgTAP `security_definer_tenant_scope_test.sql` + lint inwariantu
> `scripts/check-sql-tenant-scope.ts` (krok CI „SQL tenant-scope invariant").

**Przyczyna źródłowa (powtarzalna).** Funkcja `SECURITY DEFINER` omija RLS. Jeśli
**skaluje dane** po `public_tenant_id()` (tenant z nagłówka `x-tenant-host`,
ustawianego przez klienta w `tenant-host-fetch.ts` - do podrobienia przez `curl`
/ `supabase.rpc()`, brak walidacji trusted-proxy), a **autoryzuje** przez
`has_role()`/`is_staff()` (rola w tenancie DOMOWYM = `current_tenant_id()`), to
admin/edytor tenanta A może podrobić nagłówek na domenę tenanta B, przejść bramkę
roli (rola w A) i odczytać/zapisać dane tenanta B. Tak wyciekał przychód w
`monetization_dashboard` (P1-7) - to była jedna instancja szerszej klasy błędu.

**Zasada naprawy.** Dla operacji uprzywilejowanych zakres danych musi pochodzić z
`current_tenant_id()` (tenant domowy z sesji), nie z nagłówka. Podrobienie
`x-tenant-host` przestaje mieć jakikolwiek efekt (dane zawsze w tenancie domowym),
a legalne użycie (admin pracuje we własnym tenancie) działa bez zmian - a przy
okazji panele admina przestają zależeć od hosta, na którym są otwarte.

| Klasa | Funkcje | Poprawka |
|-------|---------|----------|
| (A) pełny swap `public_tenant_id()` → `current_tenant_id()` | `monetization_dashboard`, `b2b_coupons_analytics`, `metering_impact_preview`, `get_user_monthly_metering_count`, `bulk_generate_coupons_for_campaign`, `publish_qa_session_summary` | zakres danych = tenant domowy; nagłówek bez efektu |
| (B) kandydaci bez `public_tenant_id()` | `org_add_seat`, `org_touch_seat_invite` | pobierały wiersz (organizację/miejsce) po id bez filtra tenanta; gałąź `has_role(admin)` związana z tenantem wiersza (`= current_tenant_id()`), gałąź właściciela org bez zmian. Rodzeństwo `org_touch_seat_invite` wykryto skanem klasy (rola-gated, pobranie po id, brak funkcji tenanta w ciele) - pozostałe trafienia (`admin_set_profile_verification`, `create_event_group`, `assert_admin_tenant`) już wiążą cel z tenantem domowym wywołującego |
| (C) ścieżka publiczna/członkowska (`GRANT ... TO anon` / plan) | `authorize_resource_download`, `get_event_access`, `get_poll_results` | `public_tenant_id()` zostaje dla płaszczyzny treści (ranga warstwy liczona per host w `current_membership_tier`), ale **obejście stafowe** (`v_staff`) związane z tenantem wiersza (`= current_tenant_id()`): staff tenanta A na cudzej domenie jest zwykłym gościem, nie omija publikacji/rangi tenanta B |

**Bramka pgTAP.** `security_definer_tenant_scope_test.sql` odgrywa dokładnie
scenariusz z zadania: admin A woła RPC z podrobionym `x-tenant-host` = domena B i
oczekuje danych A albo `forbidden`/`not allowed`/`wrong_tenant` - dla wszystkich
sześciu funkcji klasy (A), `org_add_seat` (B) oraz `get_poll_results` (C, wraz z
kontrolą pozytywną: podgląd stafowy nadal działa na własnej domenie).

**Lint inwariantu (zapobiega regresji).** `scripts/check-sql-tenant-scope.ts`
analizuje najnowszą definicję każdej funkcji i failuje CI, gdy ciało `SECURITY
DEFINER` łączy `public_tenant_id()`/`request_public_host()` z
`has_role()`/`is_staff()` - poza jawnie uzasadnioną `PUBLIC_PATH_ALLOWLIST` (3
funkcje klasy C), której każdy wpis musi nadal wiązać obejście z
`current_tenant_id()` (regresja wiązania też failuje gate). To domyka
powtarzalną przyczynę źródłową na poziomie bramki, nie pojedynczej łatki.

## Weryfikacje-korekty audytu (bez zmian w kodzie)

- **`eu_policy_positions` (P1 „do weryfikacji") - FAŁSZYWY ALARM.** Polityka RLS
  „policy positions public read" sprawdza `EXISTS(... i.status = 'published')` na dossier
  rodzicu (`20260713092556:71-77`), więc stanowiska szkiców NIE wyciekają. Odczyt
  frontendu bez filtra statusu jest bezpieczny (RLS egzekwuje). Brak zmian.
- **`@`-wzmianki - backend istnieje.** `process_mentions` (`20260711201000`) parsuje
  `@slug`, tworzy krawędź `mention`, `enqueue_notification`, emituje `mention.created.v1`.
  Brakuje wyłącznie warstwy UI (autouzupełniania) - pozostaje jako P2 (patrz niżej).

## POZOSTAŁE do wdrożenia (kolejne fale)

Pozycje odroczone świadomie - większy nakład lub zmiana ścieżek krytycznych, którą
należy wykonać ostrożnie (z pełnym pokryciem testami), by nie ryzykować regresji:

### P1
- **Newsletter: rozdzielenie tokenu trackingu od tokenu wypisu** (HMAC per kampania) -
  zmiana w confirm/unsubscribe/tracking + generacji linków.
- **Newsletter: paginacja audytorium/loga** w `runCampaignSend` (kursor po id/email).
- **`jobs-tick`: zrównoleglenie `Promise.allSettled` + per-job timeout** oraz
  wewnętrzny sub-budżet dla `runIntegrationDispatch` (globalny deadline już wdrożony
  - fala 5; pozostaje granularne zrównoleglenie i twardy limit pojedynczego joba).
- **Spójność waluty audytu kuponu EUR** (`checkout.functions.ts` / `redeem_b2b_coupon`).
- **Moderacja: akcje masowe** (komentarze/czat) + **akcje na sprawcy** ze zgłoszenia.
- **Unifikacja „zapisanych"** (`/reading-list` gubi zapisane strony) - dodać strony.
- **Perf**: spłaszczenie waterfalla autora (`resolve_path`/RPC), prefetch `customMetaDefs`,
  uporządkowanie prerender vs SPA, lazy-load ciężkich widoków bloków (`organisms.tsx`).
- **UI `@`-wzmianek**: autouzupełnianie `@user` w composerach + render powiadomienia.

### P2 (wybór)
- Reconcile liczników (nocny `pg_cron`); konsolidacja podwójnego cache unread.
- SEO: strip znaków sterujących XML; warunkowe hreflang w sitemap; tagi iTunes w
  podcast RSS; walidacja targetu redirectu przy match; cache 301.
- i18n: `satisfies typeof pl` w core `en.ts`; parytet bloków/buildera.
- Search: indeks trigramowy pod fuzzy; synchronizacja limitu 200/300.
- a11y: Radix `Tabs` w `network.tsx`; `AlertDialog`/undo dla akcji nieodwracalnych;
  user-picker w badges; ujednolicenie strategii i18n w UI.
- Cookie: równorzędność przycisków accept/reject; profil `billing_documents` do `admin`.
- MCP/GA4: per-tenant konfiguracja GA4; zawężenie CORS `related-click`.

### Świadomie NIE wdrożone (uzasadnienie)

- **`enhanceContentImages` width/height (CLS)** - intrinsic wymiary obrazów NIE są
  znane z URL/HTML w tym przebiegu; wstrzyknięcie zgadniętych `width/height`
  zniekształciłoby obrazy. Bezpieczne rozwiązanie wymaga źródła wymiarów (np. metadanych
  mediów) i zostało pozostawione do osobnego zadania z tym źródłem danych.
