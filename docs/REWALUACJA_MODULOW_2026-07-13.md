# Rewaluacja platformy — moduły, funkcje międzymodułowe, oceny i rekomendacje

**Data:** 2026-07-13 (po naprawach) · **Branch:** `claude/platform-audit-assessment-ul0p6h` (PR #18), HEAD `5a26c92` ·
**Bazuje na:** `docs/AUDYT_PLATFORMY_2026-07-13.md` (audyt bazowy) + `docs/OCENA_*` · **Skala:** 0–10, surowo.

## Co się zmieniło od audytu bazowego

Wdrożono i zweryfikowano (tsc: 0 nowych błędów, eslint czysty, 651 testów zielonych) **cztery defekty**
z listy krytycznej — to główny motor zmian ocen w tej rewaluacji:

| Defekt (był) | Status | Wpływ na oceny |
| --- | --- | --- |
| 🔴 Stored XSS w rendererze buildera | **NAPRAWIONY** — 6 sinków `<style>` przez `hardenStyleCss` + `cleanCssValue` usuwa `< >` + `safeImageUrl` na tle | Sanityzacja/XSS 5 → 7; Bezpieczeństwo ↑ |
| 🔴 SSRF w integracji CRM | **NAPRAWIONY** — `egressGuard.server.ts` (blokada IP prywatnych/metadata, https, DNS fail-closed, `redirect:manual`), koniec echa body | SSRF 6 → 8,5; Sekrety/CV, Outbox, Webhooki ↑ |
| 🔴 Obejście paywalla przez TTS | **NAPRAWIONY** — `has_content_access` na tokenie w `post-tts.ts` + player przekazuje token | Paywall 6 → 8; Podcasty/TTS 6 → 8; RODO ↑ |
| 🟠 Cross-tenant w moderacji czatu | **NAPRAWIONY** — migracja `20260713200000` zawęża 6 obiektów do `current_tenant_id()` | Moderacja czatu 4 → 7; Izolacja ↑ |

**Nadal otwarte** (były P1/P2, poza zakresem tej rundy napraw): XSS w AMP web-story (`color`), inbox-bomb/limiter
fail-open, CSP `unsafe-inline`, niewymuszone MFA, `integration_endpoints.secret` plaintext, dryf szyny zdarzeń,
zepsute end-to-end moduły społeczności (Wydarzenia/Ankiety/Q&A), `site_settings` PK (prezentacja nie-multi-tenant),
martwe panele ustawień. Te punkty ciągną oceny modułowe w dół mimo domknięcia defektów krytycznych.

## Zbiorcze oceny wymiarów: audyt bazowy → rewaluacja

| Obszar | Bazowy | Rewaluacja | Uzasadnienie zmiany |
| --- | --- | --- | --- |
| Architektura kodu | 7,5 | **7,5** | Bez zmian strukturalnych; `egressGuard` to czysty współdzielony moduł (drobny plus). |
| Intermodularność | 8,5 | **8,5** | Bez zmian; dryf szyny (`event.*`/`policy.*` osierocone) wciąż otwarty. |
| Moduły / funkcjonalność | 7,0 | **7,2** | Paywall + moderacja czatu + TTS w górę; Wydarzenia/Ankiety/Q&A wciąż zepsute. |
| Bezpieczeństwo | 6,5 | **7,5** | 2 krytyczne + 2 wysokie domknięte; otwarte: AMP-XSS, CSP, inbox-bomb, MFA, sekret integracji. |
| Zabezpieczenia danych / RODO | 7,0 | **7,5** | Treść premium nieeksfiltrowalna przez TTS, czat izolowany; wciąż brak eksportu danych i zgody na analitykę. |
| UX | 7,0 | **7,0** | Bez zmian (poza zakresem napraw). |
| UI | 7,0 | **7,0** | Bez zmian. |
| Dostępność (a11y) | 6,5 | **6,5** | Bez zmian. |
| Jakość kodu | 8,0 | **8,0** | Bez zmian (+1 przetestowany moduł guardu). |
| Testy | 7,5 | **7,5** | +`egressGuard.test.ts`; brak zmiany progu. |
| **PLATFORMA OGÓŁEM** | **~7,3** | **~7,6** | Domknięcie 4 defektów podniosło bezpieczeństwo i dane; ogon funkcjonalny bez zmian. |

---

## 1. Rewaluacja modułów (pełna) — ocena · dojrzałość · co dobre · braki · rekomendacja

Dojrzałość: **P** = produkcyjny, **B** = beta, **S** = atrapa/zepsuty end-to-end.
Strzałka `(4→7)` oznacza zmianę względem audytu bazowego po naprawach.

### 1.1 Treść i autoring

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Edytor bloków (Gutenberg) | **9** | P | 99/99 typów end-to-end, TipTap, degradacja per-blok (Zod), import Gutenberg/Foxiz, silnik wykresów | blok `code` deklaruje podświetlanie, którego nie ma; martwe komentarze „MVP" | wpiąć Shiki/Prism do `code` lub zmienić opis; odświeżyć komentarze |
| Builder wizualny | **9** | P | 60/60 widgetów, sekcja→kolumna→widget, realne A/B (z-test), global widgets/colors, popupy, undo/redo, schowek cross-tab | brak dostępności DnD z klawiatury (a11y); brak testu integracyjnego `Builder.tsx` | dostępny DnD; jeden test mount+drag+undo |
| Potok renderujący treść | **9** | P | fasada `ContentRenderer` → czysty `resolveContentEngine`, strona główna to realny dokument buildera, izolacja per węzeł | rozgałęzienie po `editor` w `routes/index.tsx:139`/`$.tsx:850` (DRY) | `isBuilderLayout()` w jednym miejscu |
| Autozapis / parsowanie | **9** | P | koalescencja, `flush()` odrzuca przy błędzie (blizna po utracie danych), parse koercyjny vs ścisły, narzędzia migracji+weryfikacji | — | wzorzec komentowania („bug → guard") jako standard repo |
| Workflow redakcyjny + rewizje | **9** | P | 5 statusów, potrójne egzekwowanie (UI+fn+trigger), pg_cron, rewizje postów **i** stron, presence | — | — |
| Wzorce / sidebar builder | **7** | P | content-area realne, sidebar builder = realny mini-builder (6 widgetów, RLS) | biblioteka wzorców = tylko 5 pozycji | rozbudować katalog wzorców (kontakt/team/FAQ/porównanie) |
| Komentarze | **6** | B | warstwa Postgresa, rate-limit, paginacja wątków, realtime, `@mentions` | **dwa sprzeczne triggery edycji** (5 vs 15 min) → ciche odrzucenia; `moderate_new_comments`/`require_login_to_comment` = no-op | usunąć zdublowany trigger; podpiąć lub usunąć przełączniki |
| Live blog | **7** | P | realtime, RLS, SSR-prefetch, publiczny indeks `/live` | brak edycji wpisów po publikacji | edycja wpisów |

### 1.2 Dystrybucja treści (SEO / szukajka / języki / AI)

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| SEO / GEO | **8,5** | P | sitemapy hreflang, news-sitemap 48h, robots fail-closed z polityką AI, llms.txt, 4 rodziny JSON-LD, redirecty (wildcard/410/CSV), karty OG, 18 testów; **syndykacja best-in-class** | twardo zakodowane stałe marki (single-tenant); | sparametryzować stałe marki per tenant |
| Wyszukiwarka (FTS) | **8** | P | tsvector ważony (A/B/C), unaccent, GIN, tenant-scoped RPC, „premium" (did-you-mean trgm, snippety, telemetria), snippety XSS-safe | brak prawdziwej paginacji (okno 60→300); MCP używa `ILIKE` (rozjazd) | keyset pagination; MCP → te same RPC |
| Web Stories | **7** | P | CRUD, viewer, AMP pod `/…/amp`, indeks, sitemap | 🟠 **XSS przez `color` w `<style amp-custom>` — WCIĄŻ OTWARTE** (ten sam wzorzec co defekt #1, inny plik) | walidować/escapować `p.color` w `ampStory.ts` (P1) |
| i18n (PL/EN) | **7,5** | P | per-request klon i18next (ochrona edge-cache), liczby mnogie PL (CLDR), hreflang/x-default, kanoniczny `pickLocalized` | test `lang-parity` = no-op w CI; ~380 inline ternary w ~100 plikach; admin ~42% hardkodu; format `en-US` dla EU | parity-test wszystkich 14 bundli; migracja ternary→`pickLocalized`; `en-GB` |
| Serwer MCP | **6** | B | OAuth na JWT, klucz anon, fail-closed bez issuera, paywall-aware (`get_entity_content`), sanityzacja injection | 3 płytkie narzędzia (tylko `posts`), `search_posts` na `ILIKE`, `outputSchema:null`, wymóg logowania kontra llms.txt | głębsze narzędzia (tracker/pages), FTS, tier bez auth |
| EU Policy Tracker | **7** | B | 3 tabele + RLS, trigger stage-reassign + notify + emit, logika stage'ów unit-tested (najlepsze pokrycie), CRUD + trasy realne | zdarzenie `policy.updated.v1` osierocone (dryf szyny); brak seedów/linku w nawigacji; gate roli szerszy niż RLS | dopiąć do szyny; seed + link; wyrównać gate roli |

### 1.3 Monetyzacja i wzrost

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Uprawnienia / paywall | **8** (6→8) | P | egzekwowanie na **grantach kolumn Postgresa** (REVOKE + `get_entity_content`), hasła bcrypt + limit; **obejście przez TTS domknięte** | brak meteringu („N darmowych"); `invoice_url` martwe | opcjonalny metering; podłączyć/usunąć `invoice_url` |
| Płatności / Stripe checkout | **7** | B | ceny serwerowe, `mode` poprawny, mock hard-off na produkcji | brak `Idempotency-Key` na sesji; brak persystencji Customer/Price; brak kuponów | `Idempotency-Key`; persystować Price/Customer |
| Stripe webhooks | **9** | P | surowy body + HMAC + `timingSafeEqual` + okno 5 min, grant idempotentny, refund zawężony, 10 testów | brak dedup `event.id` (replay w oknie); brak `charge.dispute` | persystować `event.id`; obsłużyć chargeback |
| Plany / progi członkostwa | **9** | P | DB-driven, `membership_tiers` + `current_tier_rank()`, admin CRUD | — | — |
| Uprawnienia (entitlements) | **9** | P | `grantEntitlement` idempotentny (`external_ref`), `has_content_access` tenant-poprawny | — | — |
| Zamówienia / subskrypcja | **8** | P | Stripe-first cancel/resume, trigger `payment_orders_secure_insert` | `invoice_url` nigdy nie zapisywane (martwe UI) | zasilić z `hosted_invoice_url` lub usunąć |
| Newsletter (double opt-in) | **9** | P | tokeny serwerowe, RFC 8058, GET nie mutuje, 13 testów | — | — |
| Newsletter (kampanie/wysyłka) | **7** | B | wysyłka porcjami z `lease_until`, harmonogram w UI, tracking open/click z ochroną open-redirect | 0 testów wysyłki/claim/tick; brak webhooka bounce; „segmenty" nieistniejące (`meta.mailing_lists` martwe) | testy claim-race; bounce webhook; wpiąć segmenty |
| Kreator newslettera | **8** | P | model dokumentu (17 widgetów), DnD, i18n | to kreator **formularzy zapisu**, nie treści maila (kampania = surowa textarea) | rozważyć wizualny kompozytor maila lub przemianować |
| Reklamy | **6,5** | B | 7 pozycji, targeting, zgody (CMP), ochrona CLS, pomiar CTR | sloty `html`/`script` = stored-XSS (staff-gated, świadome); **5/7 typów stron martwych** | ograniczyć zapis slotów do najwyższej roli; przyciąć/podpiąć typy stron |
| Popupy | **7** | P | 4 triggery, capping, koordynator nakładek, a11y, pomiar konwersji | brak harmonogramu start/end; capping tylko LS | harmonogram; capping serwerowy |

### 1.4 Społeczność

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Czat 1:1 + realtime | **9** | P | prawdziwy realtime (publication membership + RLS `realtime.messages`, 0 pollingu), receipts, edycja 5 min (trigger), blokowanie, reakcje, notatki głosowe, znikające wiadomości | kill-switch `chat_enabled` nie zatrzymuje `/messages` ani `ChatBell` | dodać guard `chat_enabled` do trasy i dzwonka |
| Załączniki czatu | **8** | P | bucket prywatny 30 MB, signed-URL, cykl życia purge, quota 20/min | brak skanu treści (tylko allowlist MIME) | opcjonalny skan malware |
| Moderacja czatu (admin) | **7** (4→7) | B | lista/soft-delete/purge realne; **izolacja cross-tenant domknięta** (migracja `20260713200000`) | brak kolejki zgłoszeń, brak audytu moderacji, brak filtrów treści | kolejka zgłoszeń + audyt moderacji |
| Czat grupowy | **1** | S | RPC (create/add/leave/rename, SECURITY DEFINER, tenant-checked) kompletne w bazie | **0% frontendu**; UI zakłada `peers[0]` | zbudować front lub jawnie oznaczyć jako niedostępny |
| Powiadomienia (in-app) | **6** | B | bell/center realny (realtime + licznik); **jedna** ścieżka push+digest działa (`community-cron`) | **druga, równoległa ścieżka push MARTWA** (schema-drift `disabled_at`), a to ją woła auto-cron `jobs-tick`; 100+ linii martwego UI | usunąć martwą ścieżkę i przełączyć `jobs-tick` na działającą |
| Wydarzenia (events) | **2** | S | backend wzorcowy (RSVP z pojemnością, tier-gating, `get_event_access`, przypomnienia) | 🔴 **ODCZYT ZEPSUTY**: `fetchPublicEvents` żąda kolumn odciętych grantem → `/events` nie renderuje; RSVP omija RPC | przepiąć na RPC + przyciąć `select` (P1 funkcjonalne) |
| Ankiety (polls) | **2** | S | backend wzorcowy (`vote_poll`/`get_poll_results`, anty-anchoring) | 🔴 UI głosuje raw insert (brak grantu) → każdy głos pada; wyniki bez staff-read | przepiąć na `vote_poll`/`get_poll_results` |
| Q&A sesje | **3** | S/B | CRUD sesji, upvote działa, trigger answer+notify | 🔴 „zadaj pytanie" + kolejka moderacji obie padają (grant/kolumna) | `ask_qa_question` RPC + kolumnowy `select` |
| Odznaki (badges) | **6** | B | schemat/RLS/auto-notify, auto-nadanie `contributor` | picker oferuje 3 wartości łamiące CHECK DB; `badges_enabled` no-op | zsynchronizować katalog z CHECK; wpiąć flagę |
| Program kontrybutorów | **8** | P | end-to-end poprawny (grant-matched, rate-limit, review, auto-badge) — **wzorzec referencyjny** | — | — |
| Obserwowanie (follows) | **8** | P | pełna pętla, anty-spam notyfikacji (dedup 7 dni), czysta inwalidacja cache | — | — |
| Katalog osób (`/people`) | **8** | P | `search_people`/facety, weryfikacja zawodowa end-to-end, odznaki, opt-in discoverable | — | — |
| Zaangażowanie (engagement) | **5** | B | dashboard z żywymi licznikami | używa słabszej implementacji zamiast `get_engagement_overview()` (osierocona); dziedziczy lukę RLS `poll_votes` | przełączyć na `get_engagement_overview()` |

### 1.5 CRM, integracje, workflow

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| CRM (leady/notatki/oś czasu) | **8** | P | dedup `crm_upsert_from_form`, pipeline, oś czasu, notatki idempotentne, obrony CSV/`.or()` | fn używają `requireSupabaseAuth` zamiast `requireStaff`; `addCrmNote` pomija `tenant_id` | dodać `requireStaff`; jawny `tenant_id` |
| Formularz kontaktowy → lead | **8** | P | jeden utwardzony `submitContactMessage` (Zod, limit, anty-spoofing, brak open-relay) | e-maile auto-reply bez outboxa/retry | przez retryable outbox |
| Sekrety Vault + CV | **6,5** (6→6,5) | B | Merydian w Vault, plaintext DROP, RPC-gated; bucket CV prywatny owner-scoped; **SSRF domknięty** | **`integration_endpoints.secret` nadal plaintext** (klucze HMAC, czytelne dla każdego staffu) | Vault również dla `integration_endpoints.secret` (P1) |
| Webhooki wychodzące HMAC | **7,5** (7→7,5) | P | HMAC-SHA256; **SSRF guarded, `redirect:manual`, brak echa body** | funkcja zdublowana w 2 plikach; brak ochrony replay (podpis bez timestampu) | wspólny util + timestamp w podpisie |
| Outbox integracji | **4,5** (4→4,5) | B | fanout + backoff + DLQ + `SKIP LOCKED`; **SSRF guarded** | brak UI endpointów; brak adapterów per-usługa; nie drenowany cronem (tylko przy /admin/crm) | UI + drenaż cronem + adaptery (lub „webhook-only") |
| Silnik workflow | **6** | B | realny silnik reguł, loop-safe, 4 flagowe przepisy auto-instalowane (load-bearing) | zero admin UI | minimalne UI read-only (definitions/runs) |
| Idempotencja komend | **7** | P | claim-first, replay wyniku, TTL 48h, przetestowane | tylko 1 produkcyjne wywołanie (`crm.add_note`) | rozszerzyć na `pushLeadToMerydian` |
| Liczniki / graf / wzmianki | **8** | P | 4 liczniki triggerowe, graf `cross_references`, `@slug` parsowane w bazie z privacy-awareness | wzmianki tylko 3 źródła (bez treści postów) | opcjonalnie wzmianki w treści postów |

### 1.6 Personalizacja i konto

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Personalizacja | **9** | P | ważony rekomender SQL (autor 4/kat 3/tag 2/historia 1/świeżość), followed feed, Big Five, merge gościa, powitania (wołacz PL) — najlepiej dopracowany moduł | brak pętli pomiaru jakości (CTR na `reasons`) | logować impresje/kliknięcia rekomendacji |
| Konto / auth / MFA / impersonacja | **8** | P | realne TOTP, reset hasła, usunięcie konta (RODO erasure), impersonacja super-admin-gated + audyt | **MFA niewymuszone serwerowo** (brak `aal2` w `requireStaff`) | egzekwować `aal2`; polityka „wymagaj MFA" (P1) |
| Profil (zakładki) | **9** | P | pełny CRUD z RLS, zunifikowane kanoniczne bio, upload z paskiem postępu, walidacja sluga | — | — |

### 1.7 Analityka i obserwowalność

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Analityka / RUM | **7** | P | Web Vitals (redakcja PII → p75 dashboard tenant-scoped), ad/popup events z CTR, lejek/retencja członków | **`client_errors` = sink write-only** (brak podglądu); `get_engagement_overview()` osierocona; **init bez zgody** (RODO) | podgląd `client_errors`; gatować telemetrię na zgodę (P1) |
| Eksperymenty A/B | **8** | P | bucketing FNV-1a, SSR-safe, z-test dwóch proporcji, RLS + `is_experiment_running()` | brak progu min. ekspozycji przed werdyktem | próg min. próby |
| Analityka członków (`/admin/audience`) | **8** | P | lejek/retencja kohortowa/aktywność przez dedykowane RPC (admin-gated) | — | — |

### 1.8 Media, audio, TTS

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Media | **7** | P | re-walidacja serwerowa (tenant-prefix/MIME/rozmiar), dedup sha256, skan użycia, custom fonts, crop-sizes | `ImageSlot` buildera omija `registerMediaUpload`; `admin.settings.media` martwe; `MediaManager` 1997 linii, 0 testów | ujednolicić upload; testy walidatorów |
| Podcasty | **8** | P | CRUD, RSS z `<enclosure>` (realny length/type), player (speed, ±15s, Media Session) | `autoplay_next` = martwa kolumna | — |
| TTS (ElevenLabs) | **8** (6→8) | P | realny API, cache MP3 w prywatnym buckecie, limity fail-closed, **paywall domknięty** (entitlement gate) | widget „tts" buildera staff-gated na publicznych stronach → 403 dla czytelnika | wpiąć widget na `/api/public/post-tts` lub ukryć z palety |
| Odtwarzacz audio (global) | **8** | P | przeżywa nawigację, seek z ARIA, etapy syntezy `aria-live`, Media Session, arbitraż playbacku | — | — |

### 1.9 Infrastruktura, admin, taksonomia, ustawienia

| Moduł | Ocena | Doj. | Co dobre / działa | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- | --- |
| Multi-tenancy (dane) | **8** | P | 3 płaszczyzny (anon fail-open / crawler fail-closed / cache SSR po hoście), `profiles.tenant_id` niezmienialny, brak wycieku READ, pgTAP | dryf aliasów (SQL vs TS); `client_errors` bez `tenant_id` | naprawić dryf aliasów; `tenant_id` na `client_errors` |
| Multi-tenancy (prezentacja) | **4** | B | dedykowane tabele per-tenant OK (`site_design_tokens`, `mobile_drawer_configs`, `builder_popups`) | 🟠 **`site_settings` PK = `key`** → header/footer/motyw/menu **singletony na całą platformę** | PK złożony `(tenant_id, key)` (P1) |
| Panel administracyjny | **8** | P | 83 trasy, importer WP (re-host+301), role z audytem, RUM, impersonacja; bramka na RLS + `requireStaff` | bramka `/admin` tylko client-side (brak serwerowego 403); god-file'e tras | opcjonalnie serwerowy `beforeLoad`; dekompozycja |
| Taksonomia + wzbogacanie | **8** | P | kategorie/tagi/autorzy/custom-meta/related/key-takeaways/TOC/przypisy/reading-time/ikony/greetings — realne, tenant-RLS, wiele unit-tested | `tags` bez `name_pl/name_en`; `CustomMetaList` 3 ikony do złych glifów; współdzielony błąd PK `site_settings` | `name_pl/en` dla tagów; `DynamicIcon`; PK `site_settings` |
| Ustawienia (panele) | **5** | B | Discussion/Privacy/SEO/Design realne i egzekwowane (Discussion przez trigger DB) | „zapisuje, nikt nie czyta": Permalinks/Media/`menu_primary`/Carousel/`posts_per_page`; mismatch `site_name`↔`name` | podłączyć lub usunąć martwe panele |

---

## 2. Rewaluacja intermodularności (funkcje między modułami) — **8,5/10**

| Aspekt | Ocena | Co dobre | Braki / ryzyka | Rekomendacja |
| --- | --- | --- | --- | --- |
| Szyna zdarzeń `domain_events` | **9** | jedyny producent `emit_domain_event` (SECURITY DEFINER, REVOKE anon/auth) — klient nie sfałszuje; emitery AFTER połykają błędy (nie psują zapisu źródła); RLS per tenant/aktor; 17 asercji pgTAP | **dryf**: `event.published.v1`/`event.cancelled.v1`/`policy.updated.v1` emitowane w bazie, brak w katalogu frontendu → inwalidacja cicho nie działa; test kompletności nie łapie emiterów DB | bramka pgTAP emitter↔katalog; dopiąć `event.*`/`policy.*` |
| Korelacja + optymistyczne mutacje | **8** | `useEventConfirmedMutation` (łata+rollback po 3 s), fallback do RPC gdy realtime zgubi ramkę (prawda z bazy wygrywa) | brak ludzkiego widoku „co się stało po kliknięciu" | cienki admin „event trace" po `correlation_id` |
| Wspólne realtime | **9** | `tableChannelHub` ref-counted (1 socket per spec), anonimowi = 0 websocketów, wstrzymanie przy ukrytej karcie | — | — |
| Workflow / outbox / idempotencja / graf | **8** | silnik reguł loop-safe, 4 przepisy load-bearing, outbox z backoff+DLQ, `command_idempotency`, graf `cross_references`, wzmianki `@slug` w bazie | silnik+outbox bez UI; idempotencja 1 call-site; logika w triggerach PL/pgSQL nietestowalna w TS | UI read-only; rozszerzyć idempotencję; fixtury testowe workflow |
| Liczniki pending | **8** | `user/tenant_pending_counters` triggerowe, `useUnreadCount` czyta licznik nie `COUNT(*)`, drift-recompute | — | — |

**Werdykt intermodularności:** najmocniejszy element systemu (realne decoupling, nie scaffolding). Jedyny realny dług
to **dryf kontraktu szyny** (najnowsze moduły Events/Tracker emitują zdarzenia, których front nie mapuje) oraz brak
powierzchni admina dla workflow/outbox. Po domknięciu bramki emitter↔katalog → ~9,0.

---

## 3. Rewaluacja bezpieczeństwa (po naprawach) — **7,5/10**

| Wymiar | Bazowy → Rewaluacja | Stan |
| --- | --- | --- |
| RLS / izolacja tenantów | 9 → **9** | RLS na 115/115 tabel; **luka moderacji czatu domknięta** (migracja `20260713200000`) |
| `x-tenant-host` | 9 → **9** | header nie dołączany do staff/service; staff pinowany profilem |
| Higiena sekretów | 9 → **9** | 0 `VITE_`-sekretów; service-role w 1 pliku; CRM w Vault |
| Uwierzytelnianie / MFA | 7 → **7** | 2 warstwy (JWT + `requireStaff`); **MFA wciąż niewymuszone** (`aal2`) |
| Webhook Stripe | 7 → **7** | HMAC+timing+okno; brak dedup `event.id` |
| Sanityzacja / XSS | 5 → **7** | **builder domknięty** (6 sinków `hardenStyleCss`); **AMP web-story `color` wciąż otwarte**; CSP `unsafe-inline` (systemowy wzmacniacz) |
| Rate limiting / cron | 5 → **5** | cron wzorcowy; **inbox-bomb (email fail-open na spoofowalnym XFF) wciąż otwarte** |
| SSRF | 6 → **8,5** | **egress guard** (IP prywatne/metadata blokowane, https, DNS fail-closed, `redirect:manual`), koniec echa body; reszta: rebinding zmitygowany |
| PII (granty kolumnowe) | 8 → **8** | email/prefs odcięte ACL kolumn, pgTAP |
| Vault / bucket CV | 8 → **8** | Merydian w Vault, CV prywatny; `integration_endpoints.secret` plaintext (dług) |
| Zgoda / RODO | 6 → **6,5** | usunięcie konta (erasure) obecne; **telemetria wciąż bez zgody; brak eksportu danych** |
| Nagłówki / CSP | 7 → **7** | komplet nagłówków; `script-src 'unsafe-inline'` bez nonce |
| Impersonacja | 7 → **7** | super-admin-gated + audyt; brak markera `impersonated_by` |

**Domknięte w tej rundzie:** builder stored-XSS (2 sinki krytyczne + 4 dodatkowe), CRM SSRF (+ outbox), obejście
paywalla przez TTS, cross-tenant w moderacji czatu (4 polityki + 2 RPC).

**Otwarte, priorytetowo:** AMP web-story XSS (P1 — ten sam wzorzec), CSP nonce (P1 — systemowo domyka klasę XSS),
inbox-bomb (P1), `aal2` dla staffu (P1), `integration_endpoints.secret` → Vault (P1), dedup `event.id` w Stripe (P2).

---

## 4. Co jest dobre (mocne strony — uczciwie)

- **Warstwa danych klasy wiodącej** — RLS na 115/115 tabel, eskalacja zamknięta na grantach + dowody pgTAP; po naprawie także izolacja moderacji czatu.
- **Paywall na grantach kolumn Postgresa** — nieobchodzalny z klienta; ostatnia furtka (TTS) domknięta.
- **Szyna zdarzeń domenowych** — realne, testowane DB decoupling (nie scaffolding); korelacja + optymistyczne potwierdzenia z fallbackiem do prawdy z bazy.
- **Silnik treści** — bloki 99/99 + builder 60/60 + realne A/B (z-test) + autozapis z ochroną przed utratą danych na każdej warstwie.
- **SEO/GEO klasy agencyjnej** — poziom rzadki w komercyjnych CMS-ach (hreflang, news-sitemap 48h, llms.txt, 4 rodziny JSON-LD, redirecty CSV/wildcard/410).
- **Personalizacja** — realny ważony rekomender SQL + Big Five + merge gościa + powitania z wołaczem PL.
- **Higiena inżynierska** — 0 realnych `any`, 0 `@ts-ignore`, 0 `console.log`, 1 „TODO" w 219 tys. linii; blokująca kolejka CI + 3-budżetowy bundle; uczciwa konfiguracja coverage; dokumentacja zgodna z kodem.
- **Wielojęzyczność treści** — kolumny `_pl/_en`, FTS obu języków, per-request klon i18next chroniący edge-cache.
- **Program kontrybutorów, follows, katalog osób, analityka członków, Stripe webhooks** — wzorcowo grant-matched i przetestowane; wzorzec do naśladowania dla zepsutych modułów RPC.
- **Nowość: egress guard** — jeden choke-point SSRF, przetestowany jednostkowo, gotowy do reużycia przez każdy serwerowy `fetch` URL-a użytkownika.

---

## 5. Priorytetowa mapa rekomendacji (po naprawach)

### P0 — Krytyczne: **wyczyszczone** ✅
Cztery defekty krytyczne/wysokie z audytu bazowego są domknięte (builder XSS, CRM SSRF, obejście paywalla TTS,
cross-tenant moderacji czatu). Brak otwartych P0.

### P1 — Wysokie (następna runda)
1. **[FUNKCJONALNE] Naprawić Wydarzenia/Ankiety/Q&A** — przepiąć UI na RPC (`rsvp_event`/`vote_poll`/`ask_qa_question`) + przyciąć `select` do przyznanych kolumn. Wydarzenia: dziś zablokowany sam odczyt.
2. **AMP web-story XSS** — walidować/escapować `p.color` w `ampStory.ts` (ten sam wzorzec co defekt #1).
3. **CSP oparte na nonce** — usunąć `script-src 'unsafe-inline'`; systemowo domyka całą klasę XSS.
4. **`site_settings` → PK złożony `(tenant_id, key)`** — odblokować multi-tenant warstwy prezentacji.
5. **Inbox-bomb** — klient-IP z zaufanego proxy, email endpoints fail-closed + budżet per-odbiorca.
6. **Egzekwować `aal2`** dla mutacji staffu + polityka „wymagaj MFA".
7. **Vault dla `integration_endpoints.secret`** (dziś plaintext — klucze HMAC).
8. **Dryf szyny zdarzeń** — bramka emitter↔katalog + dopiąć `event.*`/`policy.*`.

### P2 — Średnie / jakość
9. **Martwa ścieżka push** — usunąć i przełączyć `jobs-tick` na działającą (dziś auto-cron woła zepsutą).
10. **Martwe ustawienia** — Permalinks/Media/`menu_primary`/Carousel/`posts_per_page` + mismatch `site_name`↔`name` + `tags.name_pl/en`.
11. **Odznaki** — katalog pickera ↔ CHECK DB; **Komentarze** — usunąć zdublowany trigger edycji.
12. **Outbox/workflow** — UI + drenaż cronem; **`get_engagement_overview()`** — podłączyć zamiast słabszej implementacji.
13. **Stripe** — dedup `event.id` + guard anulowanej subskrypcji; `charge.dispute`.
14. **Czat grupowy** — front lub jawne oznaczenie jako niedostępny; **kill-switch `chat_enabled`** na `/messages`+`ChatBell`.
15. **Dostępny DnD buildera**; **konsolidacja IA ustawień designu** (4→1); **skala typografii** (koniec < 10px).
16. **`has_column_privilege`** na wszystkie kolumny PII; **dekompozycja god-komponentów**; **CI**: `--max-warnings 0`, knip, Dependabot/CodeQL, `noUncheckedIndexedAccess`.

---

## 6. Podsumowanie zbiorcze (rewaluacja)

| Obszar | Ocena |
| --- | --- |
| Architektura kodu | **7,5** |
| Intermodularność | **8,5** |
| Moduły / funkcjonalność | **7,2** |
| Bezpieczeństwo | **7,5** |
| Zabezpieczenia danych / RODO | **7,5** |
| UX | **7,0** |
| UI | **7,0** |
| Dostępność (a11y) | **6,5** |
| Jakość kodu | **8,0** |
| Testy | **7,5** |
| **PLATFORMA OGÓŁEM** | **~7,6 / 10** |

> **Trajektoria:** audyt bazowy **7,3** → rewaluacja **7,6** po domknięciu 4 defektów. Kolejny skok (do ~8,2–8,5)
> jest w zasięgu jednej rundy P1: naprawa zepsutych modułów społeczności (Wydarzenia/Ankiety/Q&A — czysto
> integracyjna, backendy gotowe), AMP-XSS + CSP nonce (domknięcie klasy XSS), `site_settings` PK (multi-tenant
> prezentacji) i egzekwowanie MFA. Silnik i fundamenty już na ten pułap pozwalają — brakuje wykończenia i domknięcia
> ogona funkcjonalnego, nie przebudowy.
