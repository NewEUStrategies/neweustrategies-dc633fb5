# Audyt modułu profili (użytkownik / ekspert / rodzaje subskrypcji) oraz czatu i sieci kontaktów — 2026-08-06

**Data:** 2026-08-06 · **HEAD:** `c6f94cf` (`main` po merge'u PR #187–#191) · **Gałąź:** `claude/user-profile-chat-audit-i4na3t`
**Zakres:** profil użytkownika, profil eksperta, warstwy/rodzaje subskrypcji, czat (DM, grupy,
załączniki, „Zapytanie do eksperta”), sieć kontaktów (połączenia, rekomendacje, poparcia,
przedstawienia, odsłony profilu, blokady, zgłoszenia).

Audyt szuka **defektów** — rzeczy, które nie działają, działają cicho źle, obiecują więcej niż
egzekwują albo nie mają jak zostać wyłapane. Nie jest oceną punktową (tę rolę pełni seria
`OCENA_FUNKCJI_TABELE_*`). Każde ustalenie ma dowód: ścieżkę `plik:linia`, wynik uruchomionego
narzędzia albo odtworzone zachowanie.

> **Nota o pomiarze — trzy przebiegi, nie jeden.** Dokument powstawał w trakcie aktywnych prac na
> `main`, więc każde ustalenie ma jawnie przypisany HEAD:
>
> | Przebieg | HEAD | Co się zmieniło |
> | -------- | ---- | --------------- |
> | 1. Audyt | `633d02e` | 16 ustaleń, suita czerwona (4 testy) |
> | 2. Re-pomiar | `d42e5eb` | `main` zamknął §1 i §2; suita zielona; §3–§16 potwierdzone jako otwarte |
> | 3. **Weryfikacja wdrożenia** | **`c6f94cf`** | PR #187–#190 zamknęły **9 z 14** otwartych ustaleń — patrz sekcja „Weryfikacja” |
>
> Ustalenia zamknięte zostawiam w treści z zachowanym opisem mechanizmu (konwencja
> z `AUDYT_FUNKCJONALNY_MODULOW_2026-07-25.md`): opis dokumentuje **defekt**, nie stan bieżący,
> a kilka z tych klas jest w tym repozytorium cyklicznych. Każdy zamknięty paragraf ma na
> początku banner ze statusem i dowodem pomiaru.

> **Najkrótsze streszczenie (stan na `c6f94cf`).** Moduł był inżynieryjnie mocny już na wejściu
> (RPC-only sieć, RLS na wszystkim, rejestr capabilities z maszynowym parytetem, jeden kanał
> realtime per user). W trakcie audytu **zamknięto 11 z 16 ustaleń**, w tym **wszystkie
> o wadze krytycznej i wysokiej** — łącznie z obejściem płatnego limitu, ekspozycją profili dla
> anonimów, izolacją tenanta w bramce eksperta i niekompletnym eksportem RODO. Suita urosła
> z 6707 do **6991 testów i jest zielona**, a pokrycie audytowanych katalogów podniosło się
> z 15,4 % do **25,1 %** (`src/lib/network`: **0 % → 89,7 %**).
>
> **Otwarte pozostaje 5 pozycji**, wszystkie o wadze średniej i niskiej: wyszukiwarka kontaktów
> bez escapowania i indeksu (§8), dryf słownika `allow_messages_from` wraz z brakującą środkową
> opcją prywatności (§9), rozproszona informacja o prywatności (§10), zdublowana nawigacja
> finansów (§11) oraz przedawnione rzuty `as never` (§13). Do tego §12 jest zamknięte **częściowo**:
> `src/components/network` nadal ma 4,6 % pokrycia i 12 z 13 plików na zerze, w tym
> `ConnectButton.tsx` (423 linie, pięć stanów relacji).

---

## 1. Metodyka — co realnie uruchomiono na tym HEAD

Zależności zainstalowano tak, jak robi to CI (`bun.lock` przepięty z prywatnego GAR na publiczny
npm — `.github/workflows/ci.yml:37`), 848 pakietów, instalacja czysta.

| Sprawdzenie | Pokrycie | **Wynik na `d42e5eb`** | Było na `633d02e` |
| ----------- | -------- | ---------------------- | ----------------- |
| `tsc --noEmit` | całość repo | **✓ czysto** | ✓ czysto |
| `vitest run` (pełna suita) | 618 plików | **✓ ZIELONO — 616 pass / 2 skip · 6707 testów: 6657 pass / 50 skip** | ✗ 4 FAIL |
| `vitest run` (tylko moduły audytu) | chat, network, experts, profile, billing, pricing, access | **✓ 62 pliki / 670 testów** | ✓ |
| `check:sql-migration-replay` | 627 plików migracji | **✓ (exit 0)** — zero kolizji wersji | ✗ dubel `20260806150000` (§1) |
| `check:authz-snapshot` | snapshot bramek vs migracje | **✓ zgodny z migracjami** | ✗ dryf `fn:profiles_guard_verification/0` (§2) |
| `check:permissions-parity` | 4 pliki / 99 testów | **✓** (w ramach zielonej suity) | ✗ 1 FAIL |
| `check:i18n-parity` | 16 plików / 229 testów | **✓** | ✗ 2 FAIL (collateral z §1) |
| `check:db-contract` | schemat żywej bazy vs kod | **nie dało się uruchomić** — brak `SUPABASE_URL`/klucza; w CI jest krokiem po wdrożeniu (`ci.yml:385`), więc rozjazd nazwy tabeli z §6 nie jest łapany przed mergem |
| Kontrakt nazw RPC klient↔SQL↔typy | 56 unikalnych RPC modułu | **✓ czysto** — każde istnieje w migracjach i w `types.ts` |
| Kontrakt nazw **tabel** w ciałach RPC vs stan po replayu | ścieżka „Zapytanie do eksperta” | **✗ rozjazd** — 5 RPC celuje w tabelę, która po replayu nie istnieje (§6) |
| Pokrycie testami modułu (v8) | 7 katalogów (lib+components) | **15,44 % stmt / 14,2 % br / 13,19 % fn** (861 z 5573 instrukcji) (§12) |
| `knip` | całość | 6 martwych plików, 205 martwych eksportów — **w tym module wszystkie sprawdzone trafienia okazały się pozorne** i NIE są raportowane jako ustalenia: `lib/profile/badges.ts` to barrel re-eksportujący `badgeCatalog.ts` (oba używane), `ChatUnreadBadge`/`NetworkPendingBadge` są ładowane leniwie przez `LiveTabBadge` (`BottomBarTab.tsx:17`), `ReportUserDialog` jest wpięty w `AuthorMoreMenu.tsx:55` i `ConnectButton.tsx:370` (martwy jest tylko dodatkowy eksport `ReportUserButton`) |

Na `633d02e` czerwone były cztery testy — **wszystkie w obszarze weryfikacji profilu**, wszystkie
zielone po naprawie na `main`. Zostawiam listę, bo pokazuje, jak wąsko ta klasa defektu uderza:

| Plik testu | Test | `633d02e` | `d42e5eb` |
| ---------- | ---- | --------- | --------- |
| `src/lib/ci/__tests__/migrationReplay.test.ts` | „ŻADNA wersja się nie powtarza” | ✗ | ✓ |
| `src/lib/ci/__tests__/migrationReplay.test.ts` | „nazwy są parsowalne i porządek nazw = porządek wersji” | ✗ | ✓ |
| `src/lib/authz/__tests__/authzSnapshotParity.test.ts` | „zacommitowany snapshot zgadza się z odtworzeniem z migracji” | ✗ | ✓ |
| `src/__tests__/profilesVerificationGuard.invariant.test.ts` | „przepuszcza rolę super_admin (regresja z 20260806094104)” | ✗ | ✓ |

**Czego NIE dało się uruchomić: pgTAP** (`supabase test db`, 74 pliki, w tym
`chat_privacy_isolation_test.sql`, `connections_v2_test.sql`, `introductions_flow_test.sql`,
`profiles_verification_guard_test.sql`, `expert_request_visibility_test.sql`). Na `633d02e`
blokowała to kolizja wersji (§1); na `d42e5eb` kolizji już nie ma, ale w tym środowisku brakuje
lokalnego stacku Supabase (`supabase db start` wymaga Dockera). **Ta luka jest istotna dla wagi
§6b:** jedyna warstwa testów, która sprawdza schemat po pełnym replayu migracji, nie została
w tym audycie uruchomiona ani razu — a to właśnie replay ujawnia rozjazd nazwy tabeli. Wnioski
o stanie po replayu wyprowadzam z analizy statycznej łańcucha migracji, nie z uruchomionej bazy;
zaznaczam to wprost, żeby nikt nie czytał §6b jako obserwacji z działającego środowiska.

## 2. Inwentarz modułu (co realnie istnieje)

**Trasy (28 członkowskich/publicznych + 11 panelu):** 20 plików `src/routes/profile*.tsx`
(shell + 19 podstron, z czego 3 to przekierowania po konsolidacji tożsamości) oraz `network.tsx`,
`network.mutual.$userId.tsx`, `people.tsx`, `messages.tsx`, `experts.tsx`, `author.$slug.tsx`,
`pricing.tsx`, `membership-registration.tsx`; panel: `admin.community.{chat,badges,contributors}`,
`admin.expert-requests`, `admin.expert-layouts`, `admin.membership`, `admin.pricing`,
`admin.users{,.$id,.index,.invitations}`.

**Tabele (42 w zasięgu):** `profiles`, `author_profiles`, `speaker_profiles`, `profile_badges`,
`profile_{awards,cv_files,education,experiences,hobbies,skills,recommendations,skill_endorsements}`,
`profile_view_events`, `expert_{expertise_areas,inmails,layout_settings}`, `expertise_areas`,
`conversations`, `conversation_participants`, `conversation_nicknames`, `messages`,
`message_reactions`, `message_stars`, `user_connections`, `user_blocks`, `user_reports`,
`user_follows`, `introduction_requests`, `membership_tiers`, `membership_grants`, `access_plans`,
`subscriptions`, `user_subscriptions`, `billing_profiles`, `member_organizations`,
`organization_seats`, `program_members`, `push_subscriptions`, `notification_preferences`.

**RPC (56 unikalnych):** czat 26, sieć 24, profil 7, eksperci 1 (`get_expert_hub`).
Kontrakt nazw i obecność w `types.ts` — **czysto** (sprawdzone maszynowo, patrz §1 metodyki).

**Cztery równoległe pojęcia „rodzaju subskrypcji”** — warto to nazwać wprost, bo dokumentacja
używa tych słów wymiennie:

| Byt | Tabela | Rola | Kto to czyta |
| --- | ------ | ---- | ------------ |
| **Warstwa członkostwa** (tier) | `membership_tiers` (`key`, `rank`, `features` jsonb) | katalog oferty + flagi zdolności | `current_membership_tier()`, `my_effective_tier_features()`, `/pricing` |
| **Plan dostępu** | `access_plans` (`tier_key`) | to, co kupuje checkout; mostek do tiera | `user_subscriptions.plan_id`, paywall |
| **Subskrypcja użytkownika** | `user_subscriptions` (`status`, `plan_id`) | uprawnienie wynikające z zakupu | `my_effective_tier_features()`, `is_vip_user()` |
| **Lustro operatora** | `subscriptions` (`provider_subscription_id`, `environment`) | stan u Stripe’a, dunning, portal | wyłącznie warstwa serwerowa `lib/billing/*.server.ts` |
| **Nadanie** | `membership_grants` (`tier_key`, `source`, `expires_at`) | warstwa poza planem (VIP eksperta, darowizna) | `my_effective_tier_features()`, `is_vip_user()` |

Rozdział jest **celowy i spójny** — `subscriptions` nigdy nie wchodzi do decyzji o dostępie
(sprawdzone: 33 referencje, wszystkie w `*.server.ts` + panel admina), a `user_subscriptions` nigdy
nie jest źródłem dla dunningu. To dobra granica i nie jest defektem; wymaga jednak nazwania
w dokumentacji, bo „subskrypcja” w kodzie znaczy dwie różne rzeczy zależnie od pliku.

## 3. Weryfikacja wdrożenia (HEAD `c6f94cf`, PR #187–#190)

Poniższe **nie jest streszczeniem opisów z PR-ów** — każdą pozycję sprawdziłem na ostatniej
definicji funkcji/widoku w łańcuchu migracji albo na kodzie, i uruchomiłem bramki od nowa.

| # | Ustalenie | Status | Dowód pomiaru |
| - | --------- | ------ | ------------- |
| 1 | Kolizja wersji migracji | ✅ **zamknięte** | `check:sql-migration-replay` exit 0; zero duplikatów w 638 plikach |
| 2 | Autorytet weryfikacji profilu | ✅ **zamknięte** | trigger woła `can_manage_profile_verification` + `OLD.tenant_id = current_tenant_id()`; `check:authz-snapshot` zgodny |
| 3 | `profiles_public` dla anonimów | ✅ **zamknięte, mocniej niż rekomendacja** | widok (`20260806183256`) filtruje: własny wiersz **lub** `discoverable` **lub** staff **lub** `caller_is_connected_to()`; dla anonimów wyłącznie `profile_has_public_presence()` (rola redakcyjna / odznaka `expert` / profil autora / materiały). Copy PL+EN przepisane — zamiast obietnicy „nikt spoza platformy” pokazuje **faktyczny stan ekspozycji** (`i18n-chat.ts:444`, `:905`) |
| 4 | Bramki eksperta/VIP bez tenanta | ✅ **zamknięte** | `is_expert_user`, `is_vip_user`, `is_gated_recipient` przedefiniowane w `20260806184400` — odpowiednio 12 / 7 / 23 odwołania do `tenant_id` |
| 5 | Niekompletny eksport RODO | ✅ **zamknięte, z nawiązką** | 17 → **50 sekcji**: `chat_messages_sent`, `chat_conversations`, `chat_participation`, `chat_blocks`, `chat_nicknames_set`, `expert_requests_sent/received`, `profile_{experiences,education,skills,awards,hobbies,cv_files}`, `recommendations_written/received`, `skill_endorsements_given/received`, `network_introductions`, `profile_viewers`, `profile_view_stats`, `user_reports_filed`, `media_mentions`, `notifications` + `manifest` |
| 6a | Obejście puli pętlą anulowań | ✅ **zamknięte** | `my_expert_request_quota` (`20260806185055`): `used` liczy wszystko z bieżącego miesiąca, **bez** filtra statusu, i jest skalowane `ei.tenant_id = v_tenant` |
| 6b | Rozjazd nazwy tabeli | ✅ **zamknięte** | kanoniczne `expert_inmails` (rename powrotny + indeksy, `20260806185055:28–31`); `send_expert_inmail` i `my_inmail_quota` to dziś **cienkie delegaty** do `send_expert_request` / `my_expert_request_quota` — jedna implementacja, dwie nazwy dla zgodności kontraktu klienta |
| 6c | TOCTOU przy wysyłce | ✅ **zamknięte** | `pg_advisory_xact_lock(hashtext('expert_request:' || v_uid))` w jedynej implementacji |
| 6d | Brak klucza `direct` | ✅ **zamknięte** | delegat zwraca `direct` we wszystkich gałęziach → `ExpertRequestButton.tsx:77` wreszcie działa |
| 7 | Brak powiadomień o zapytaniach | ✅ **zamknięte** | rodzaj `expert_request` w `NotificationKind` (`preferences.ts:33`), przełącznik `enabled_expert_request` (`:64`, `:113`), producent `tg_expert_request_notify` (`20260806161000_expert_request_notifications.sql`) |
| 16 | Pula bez skalowania tenantem | ✅ **zamknięte** | `ei.tenant_id = v_tenant` w liczniku |
| 12 | Pokrycie testami modułu | 🟡 **częściowo** | całość **15,44 % → 25,05 %**; `src/lib/network` **0 % → 89,7 %** (0 plików na zerze), `src/components/profile` **0 % → 26,1 %**. **Ale `src/components/network` bez zmian: 4,6 %, 12 z 13 plików na zerze** — w tym `ConnectButton.tsx` |
| 8 | `search_chat_contacts` | ❌ **otwarte** | ostatnia definicja nadal: surowe `p_query` w 7 × `ILIKE '%…%'`, bez `esc`/`unaccent`, bez `discovery_search` |
| 9 | Fantomowe `'contacts'` | ❌ **otwarte** | `NOT IN ('everyone','contacts')` w najnowszej definicji bramki (`20260806184400:53`); CHECK nadal `everyone/existing/nobody` |
| 10 | IA prywatności | ❌ **otwarte** | `/profile/privacy` wciąż ma 0 odwołań do `discoverable` / `profile_view_mode` |
| 11 | IA finansów | ❌ **otwarte** | `FINANCE` nadal 6 pozycji; `/profile/subscription` wciąż podzbiór `/profile/membership` |
| 13 | Przedawnione `as never` | ❌ **otwarte** | 3 + 1 + 3 wystąpienia w `useConversations.ts` / `attachments.ts` / `useDiscoverable.ts` |
| 14, 15 | Decyzje projektowe | ⚪ bez zmian | świadomie — wymagają zapisania wyboru, nie kodu |

**Bramki i suita na `c6f94cf`:** `tsc --noEmit` ✓ · `check:sql-migration-replay` ✓ ·
`check:authz-snapshot` ✓ · pełna suita **✓ ZIELONA: 633 pliki pass / 2 skip, 6991 testów pass /
50 skip** (wzrost o 284 testy względem `d42e5eb`). Migracji: 627 → **638**.

**Trzy rzeczy zrobione lepiej, niż rekomendował audyt.** (1) `profiles_public` — zamiast mojego
`user_is_editorial(id) OR discoverable` powstał pełny predykat obecności publicznej plus
**wycofanie fałszywej obietnicy z copy**, czego nie proponowałem, a co było sednem problemu
zgodnościowego. (2) „Zapytanie do eksperta” — zamiast łatać żywą generację i usuwać drugą,
zrobiono **delegaty**, więc kontrakt klienta (i `types.ts`) został nietknięty, a implementacja
jest jedna. (3) Do puli dołożono **antyspam 5/24 h per odbiorca**, którego audyt nie wskazywał.

**Czego ta weryfikacja NIE obejmuje:** pgTAP nadal nie został uruchomiony (brak lokalnego stacku
Supabase — patrz metodyka). Wnioski o stanie schematu po replayu, w tym o zamknięciu §6b, pochodzą
z analizy statycznej łańcucha 638 migracji, nie z postawionej bazy. Przy najbliższej okazji warto
potwierdzić §6b na realnym `supabase db start` — to jedyne ustalenie z tej serii, którego natura
(rozjazd produkcja↔replay) sprawia, że analiza statyczna jest słabszym dowodem niż zwykle.

## 4. Tabela zbiorcza ustaleń (stan pierwotny, z pierwszego przebiegu)

| # | Obszar | Ustalenie | Waga |
| --- | ------ | --------- | ---- |
| 1 | Profil — weryfikacja / migracje | Dwie migracje o wersji `20260806150000`: `supabase db start` pada, pgTAP nie startuje, 2 bramki CI czerwone | ~~Krytyczna~~ **✅ zamknięte na `d42e5eb`** |
| 2 | Profil — autorytet weryfikacji | Inwariant „jeden predykat” złamany: trigger nie czyta `can_manage_profile_verification`, efektywny krąg jest międzytenantowy, dokumentacja opisuje inny stan | ~~Krytyczna~~ **✅ zamknięte na `d42e5eb`** |
| 3 | Profil — prywatność | `profiles_public` (definer, grant dla `anon`) serwuje 22 kolumny **każdego** profilu; `discoverable` nie jest honorowane; copy UI obiecuje odwrotnie | **Wysoka** |
| 4 | Czat — bramka tierów | `is_expert_user` / `is_vip_user` / `is_gated_recipient` nie są skalowane tenantem, w przeciwieństwie do `my_effective_tier_features()` | **Wysoka** |
| 5 | Profil — RODO | Eksport danych (art. 15/20) pomija czat, zapytania do ekspertów, artefakty sieci i CAŁE „rozszerzenia profilu”, deklarując komplet | **Wysoka** |
| **6a** | Czat — zapytania do ekspertów | **Pula miesięczna do obejścia pętlą „wyślij → anuluj → wyślij”** — poprawka istnieje w nieużywanej generacji RPC | **Wysoka** |
| **6b** | Czat — zapytania do ekspertów | Świeża baza: rename tabeli sprawia, że 5 wołanych przez klienta RPC celuje w nieistniejącą relację (`42P01`) | **Wysoka** |
| 6c | Czat — zapytania do ekspertów | TOCTOU w `send_expert_inmail`: brak serializacji równoległych wysyłek (advisory lock jest tylko w generacji nieużywanej) | **Średnia** |
| 6d | Czat — zapytania do ekspertów | `my_inmail_quota()` nie zwraca `direct` → CTA nie chowa się progom bezpośrednim; jedna gałąź copy martwa | **Średnia** |
| 7 | Czat — zapytania do ekspertów | Zero powiadomień: ani ekspert o nowym zapytaniu, ani nadawca o decyzji | **Średnia** |
| 8 | Czat — wyszukiwarka kontaktów | `search_chat_contacts` wstrzykuje surowe `p_query` w 7 `ILIKE`, bez escapowania `% _` i bez indeksu — regres wobec `search_people` | **Średnia** |
| 9 | Czat — prywatność wiadomości | Dryf słownika `allow_messages_from`: bramka testuje `'contacts'`, którego CHECK nie dopuszcza (5 generacji migracji) | **Średnia** |
| 10 | Profil — IA prywatności | Ustawienia prywatności rozrzucone na 3 powierzchnie; strona nazwana „Prywatność” nie zawiera widoczności profilu | **Średnia** |
| 11 | Profil — IA finansów | 6 pozycji nawigacji na jeden temat; `/profile/subscription` jest ścisłym podzbiorem `/profile/membership` | **Średnia** |
| 12 | Przekrojowo | Pokrycie testami modułu 15,4 %: `src/lib/network` **0 %**, `src/components/profile` **0 %** | **Średnia** |
| 13 | Czat/profil — typy | Przedawnione `as never` na RPC, które SĄ już w `types.ts` — wyłącza kontrolę argumentów bramkowanego RPC | **Niska** |
| 14 | Czat — RODO/integralność | `messages.sender_id ON DELETE CASCADE`: usunięcie konta przepisuje historię rozmówcy bez śladu | **Niska** |
| 15 | Czat — spójność prywatności | `show_online_status` działa jednostronnie, `read_receipts_enabled` wzajemnie | **Niska** |
| 16 | Czat — kwoty | Miesięczna pula inMail liczona bez skalowania tenantem | **Niska** |

---

# §1. ✅ ZAMKNIĘTE (było: KRYTYCZNA) — dwie migracje o tej samej wersji `20260806150000`

> **Status na `d42e5eb`: naprawione, potwierdzone pomiarem.** Commit `1e17363` przemianował
> kolidujący plik na `20260806150001_…` (rename R100, treść bit w bit), a `62ac3be` usunął go
> całkowicie — na `main` została wyłącznie migracja *authority*. Zmierzone ponownie:
> `check:sql-migration-replay` **✓ (exit 0)**, zero zduplikowanych wersji wśród 627 plików,
> oba testy `migrationReplay` zielone. Opis mechanizmu zostawiam, bo **to była druga
> manifestacja tej klasy** w repozytorium (pierwsza — patrz §6b — do dziś rzutuje na schemat)
> i jest to jedyny znany mi zapis obu przypadków w jednym miejscu.

**Pliki (stan `633d02e`, przed naprawą):**
`supabase/migrations/20260806150000_profile_verification_authority.sql` (266 linii)
`supabase/migrations/20260806150000_profiles_verification_guard_super_admin.sql` (134 linie)

Supabase CLI wyprowadza `schema_migrations.version` z prefiksu nazwy pliku, a `version` jest
**kluczem głównym**. Dwa pliki o tym samym znaczniku = `duplicate key value violates unique
constraint "schema_migrations_pkey"` przy pierwszym `supabase db start`.

Zmierzone (nie zadeklarowane):

```
$ bun run check:sql-migration-replay
✗ Zduplikowane wersje migracji (schema_migrations.version to KLUCZ GŁÓWNY):
  wersja 20260806150000 dzielona przez 2 plików:
    - 20260806150000_profile_verification_authority.sql
    - 20260806150000_profiles_verification_guard_super_admin.sql
```

`check:sql-migration-replay` jest **blokującym krokiem CI** (`.github/workflows/ci.yml:251`),
a job `pgtap` (`ci.yml:280`) wykonuje `supabase db start` (`ci.yml:296`) i jest wymaganiem
`needs: [verify, pgtap]` dla kroku końcowego (`ci.yml:360`). Skutki na tym HEAD:

1. **`main`/gałąź nie przechodzi CI** — dwa blokujące kroki czerwone.
2. **Cała warstwa pgTAP modułu jest niedostępna** — 74 pliki testów bazodanowych, w tym jedyne
   testy izolacji prywatności czatu i przepływu przedstawień, nie dobiegają do pierwszej asercji.
3. **Nie da się postawić świeżego środowiska** — nowy tenant/preview/lokalny dev pada na migracjach.
4. `check:i18n-parity` też jest czerwony, choć z i18n nie ma nic wspólnego: jego glob obejmuje
   `src/lib/ci/__tests__` (`package.json`, skrypt `check:i18n-parity`), więc dziedziczy oba
   czerwone testy `migrationReplay`. Zmierzone: 2 FAIL / 227 pass — **oba to `migrationReplay`**.

Obie kolidujące migracje dotyczą **tej samej funkcji** (`profiles_guard_verification`) i przyszły
z dwóch osobnych commitów tego samego dnia: `28a2279` („Autorytet weryfikacji profilu…”) oraz
`f69d3ef` („…przywrócenie super_admina w guardzie weryfikacji”). To znaczy, że dwie równoległe
próby naprawy tego samego defektu wylądowały na tym samym znaczniku czasu.

**Uwaga metodyczna:** to **druga** manifestacja tej klasy w repozytorium. Pierwsza jest opisana
w nagłówku `20260724130000_expert_request_visibility.sql:200–210` i została naprawiona przez
scalenie plików. Bramka `check:sql-migration-replay` powstała właśnie po tamtym incydencie —
i tym razem **działa poprawnie**: wykrywa kolizję i podaje gotową instrukcję naprawy. Defektem
jest to, że zmiana została zmergowana pomimo czerwonej bramki.

🔧 **Naprawa — wykonana na `main`, opis dla porządku.** Rekomendacja brzmiała: przenumerować
wszystkie poza pierwszym alfabetycznie (`…_profile_verification_authority.sql` zapisał się
w ledgerze jako pierwszy) na kolejne sekundy, z zachowaniem względnej kolejności — konwencja repo
`…0000 / …0001` (precedens: `20260731210000` / `20260731210001`); i **najpierw** rozstrzygnąć §2,
żeby przenumerowanie nie utrwaliło semantyki sprzecznej z dokumentacją.

Faktycznie wykonano dokładnie to, i o krok dalej: `1e17363` przemianował plik na
`20260806150001_…` (rename R100), a `62ac3be` **usunął go w całości** — czyli zamiast utrwalać
wariant `is_super_admin`, porzucono go na rzecz migracji *authority*. To rozwiązuje §1 i §2
jednym ruchem i jest lepsze niż sama rekomendacja: nie zostawia w łańcuchu drugiej definicji
tej samej bramki. Zweryfikowane pomiarem na `d42e5eb` — patrz banner na początku tego paragrafu.

# §2. ✅ ZAMKNIĘTE (było: KRYTYCZNA) — autorytet weryfikacji profilu: „jeden predykat” już nie obowiązuje

> **Status na `d42e5eb`: naprawione, i to dokładnie tak, jak rekomendowała pierwsza wersja tego
> paragrafu.** Po usunięciu kolidującej migracji (§1) ostatnią definicją `profiles_guard_verification()`
> jest wariant *authority*: woła `can_manage_profile_verification(v_uid)` zamiast wyliczać role
> inline, a dodatkowo egzekwuje `OLD.tenant_id = current_tenant_id()` (świadomie `OLD`, bo
> `tenant_id` przypina późniejszy alfabetycznie trigger). Inwariant behawioralny został przy tym
> **wzmocniony, nie poluzowany**: `profilesVerificationGuard.invariant.test.ts:68–74` doszywa
> teraz do badanego ciała treść predykatu (`effectiveGuardBody()`), więc test akceptuje wywołanie
> `can_manage_profile_verification`, ale nadal wymaga, żeby oba zbiory ról dało się w nim
> odnaleźć — czyli nie da się go „naprawić” samym schowaniem ról za funkcję. Zmierzone:
> `check:authz-snapshot` **✓ zgodny z migracjami**, cała suita zielona.
> Dokumentacja `docs/WERYFIKACJA_PROFILI.md` znów opisuje stan faktyczny — bez zmian w niej samej.
>
> Diagnozę poniżej zostawiam z jednego powodu: `profiles_guard_verification()` ma w łańcuchu
> migracji **10 definicji, z czego 7 z jednego dnia (2026-08-06)** — `094104`, `130000`, `135804`,
> `140000`, `145814`, `145900`, `150000`. Siedem prób naprawy tej samej bramki w ciągu doby, z których
> każda kolejna korygowała poprzednią, to sygnał procesowy, nie techniczny — i jedyny trwały wniosek
> z tej historii. Poniższy opis mechanizmu (dwie bramki na tych samych kolumnach, o wyniku decyduje
> alfabetyczna kolejność triggerów) tłumaczy, dlaczego tyle prób było potrzebnych.

**Pliki:** `supabase/migrations/20260806150000_profile_verification_authority.sql:39–59`, `:88`, `:199`, `:236`, `:252`
· `supabase/migrations/20260806150000_profiles_verification_guard_super_admin.sql:66–72`
· `docs/WERYFIKACJA_PROFILI.md` (sekcja „Kto może nadawać weryfikację (autorytet)”)

Weryfikacja profilu nie jest ozdobą: steruje odznaką, a odznaka `expert` nadaje **dożywotni VIP**
(`sync_expert_vip_grant`, migracja `20260805201517`). Migracja *authority* wprowadziła jedno
źródło prawdy:

```sql
-- 20260806150000_profile_verification_authority.sql:39
CREATE OR REPLACE FUNCTION public.can_manage_profile_verification(_user_id uuid DEFAULT auth.uid())
… SELECT _user_id IS NOT NULL AND (
       public.has_role(_user_id, 'admin'::public.app_role)
    OR public.has_role(_user_id, 'super_admin'::public.app_role))
```

i podpięła pod nią **cztery** ścieżki: trigger (`:88`), RPC panelu (`:199`), RPC domen (`:236`),
politykę RLS `verification_domains` (`:252`). Druga migracja o tej samej wersji sortuje się
**później** (`profile_` < `profiles_`, bo `_` = 0x5F < `s` = 0x73), więc nadpisuje trigger
i RPC panelu **inlinowanym** warunkiem:

```sql
-- 20260806150000_profiles_verification_guard_super_admin.sql:66
IF NOT ( public.has_role(v_uid, 'admin'::app_role) OR public.is_super_admin(v_uid) ) THEN
```

To **nie jest ta sama bramka**. Różnica jest w skalowaniu tenantem:

| Predykat | Definicja | Zasięg |
| -------- | --------- | ------ |
| `has_role(u,'super_admin')` | `20260625160054:16` — `ur.tenant_id = current_tenant_id()` | **tenant domowy** wołającego |
| `is_super_admin(u)` | `20260628212746` — brak filtra tenanta | **ponad tenantami** |

Stan efektywny (potwierdzony przez własną bramkę repo — snapshot vs migracje):

```
$ bun run check:authz-snapshot
✗ bramka 'fn:profiles_guard_verification/0' zmieniła warunki dostępu:
    tenantRef: caller -> none,
    file: 20260806150000_profile_verification_authority.sql
       -> 20260806150000_profiles_verification_guard_super_admin.sql
```

Trzy konsekwencje, wszystkie realne:

1. **`can_manage_profile_verification()` przestał być „jedynym źródłem prawdy”.** Czytają go już
   tylko `admin_assert_verification_admin` i polityka RLS `verification_domains`; trigger — warstwa,
   która produkuje `42501` — go nie woła. Dokładnie ten rozjazd („te same kolumny pilnowały DWIE
   bramki o różnych zbiorach ról”) migracja *authority* miała zamknąć na stałe; wrócił w ciągu
   jednego dnia.
2. **Dokumentacja opisuje stan, którego nie ma.** `docs/WERYFIKACJA_PROFILI.md` twierdzi:
   „od migracji `20260806150000` decyzję »kto może« podejmuje **jeden predykat**… **zawsze w tenancie
   domowym wołającego** (`has_role` porównuje `tenant_id` z `current_tenant_id()`)”. Efektywny
   trigger używa `is_super_admin`, czyli **nie** jest skalowany tenantem. Runbook weryfikacji
   wprowadza więc w błąd co do kręgu uprawnionych do nadania dożywotniego VIP-a.
3. **Inwariant behawioralny jest czerwony i nie da się go „naprawić regeneracją”** — co było jego
   jawnym celem projektowym (`src/__tests__/profilesVerificationGuard.invariant.test.ts:18–21`).
   Test wymaga literalnego `has_role(…, 'super_admin')` w ostatniej definicji funkcji
   (`:39–41`, `:48–56`); ostatnia definicja realizuje ten sam krąg **inną pisownią**
   (`is_super_admin`), więc asercja nie widzi równoważnego predykatu i pada.

**Werdykt rozdzielony, bo nie jest jednorodny:** samo *uprawnienie* `super_admin` do weryfikacji
w praktyce **działa** (przez `is_super_admin`) — test jest tu wrażliwy na pisownię, nie na
zachowanie. Krytyczne jest natomiast (a) rozstrzygnięcie zasięgu tenantowego, które dziś zależy od
kolejności alfabetycznej nazw plików, oraz (b) fakt, że po tej zmianie żadna bramka nie pilnuje już
inwariantu „jedna kolumna = jedna bramka = jeden predykat”.

🔧 **Naprawa (jedna decyzja, potem trzy edycje):**
1. Rozstrzygnąć produktowo: czy super-admin platformy stempluje weryfikację w **obcym** tenancie?
   Reszta modułu (`admin_set_profile_verification` w obu wariantach) trzyma równość tenantów, więc
   spójna odpowiedź brzmi „nie”.
2. Wciągnąć decyzję **do predykatu** — jeśli super-admin ma pracować ponad tenantami, niech
   `can_manage_profile_verification()` zawiera `OR public.is_super_admin(_user_id)`; jeśli nie,
   zostawić dwa `has_role`. Trigger i RPC panelu wołają **wyłącznie** predykat, nigdy inline.
3. Poluzować inwariant tak, by uznawał `is_super_admin` za równoważną pisownię (albo — lepiej —
   asertować, że ciało triggera woła `can_manage_profile_verification`, co jest mocniejszym
   i stabilniejszym warunkiem niż wyliczanie ról regexpem).
4. `bun run generate:authz-snapshot` i commit wyniku.

# §3. WYSOKA — `profiles_public` udostępnia anonimowi każdy profil, wbrew obietnicy w UI

**Pliki:** `supabase/migrations/20260724130000_expert_request_visibility.sql:29–57` (ciało widoku),
`:221–222` (`security_invoker = off` + grant) · `src/lib/i18n-chat.ts:444` i `:888` (copy PL/EN)
· `src/lib/experts/publicVisibility.ts:1–14` (świadomość problemu w kodzie)

Interfejs obiecuje wprost, w obu językach, w panelu prywatności profilu:

> „Niezależnie od tego ustawienia Twój profil **nigdy** nie jest widoczny ani indeksowany **poza
> platformą** — osoby **niezalogowane** i roboty wyszukiwarek **nie mają do niego dostępu**.”
> („Regardless of this setting, your profile is **never** visible… anonymous visitors… have **no
> access** to it.”)

Stan faktyczny. Migracja `20260803095618:1–3` odebrała anonimowi odczyt tabeli bazowej
(„Remove anon row-level read on profiles (full-row PII exposure)” + `REVOKE ALL ON public.profiles
FROM anon`) — słusznie. Ale jedyna pozostała ścieżka anonimowa to widok definera:

```sql
CREATE OR REPLACE VIEW public.profiles_public WITH (security_invoker = off) AS
SELECT id, tenant_id, slug, display_name, first_name, last_name, avatar_url, cover_url,
       bio_pl, bio_en, job_title, twitter_url, linkedin_url, facebook_url, instagram_url,
       spotify_url, website_url, current_company, specialization, verified_at, updated_at,
       expert_requests_enabled
FROM public.profiles
WHERE tenant_id = public_tenant_id();          -- ← JEDYNY filtr
GRANT SELECT ON public.profiles_public TO anon, authenticated;
```

Brakuje **trzech** filtrów, które w tym module istnieją wszędzie indziej: `discoverable`
(opt-in do katalogu), `user_is_editorial(id)` (warunek skasowanej polityki anonimowej) oraz
`slug IS NOT NULL`. `security_invoker = off` oznacza, że RLS tabeli bazowej **nie jest
stosowane wobec wołającego** — więc komentarz migracji („Wiersze i tak filtruje RLS, więc grant
nie poszerza widoczności między userami”, `20260724130000:21–22`) jest nieprawdziwy dla tej
konfiguracji. Widok jest w schemacie `public`, czytany wprost z przeglądarki
(`supabase.from("profiles_public")` — `ProfilePicker.tsx:39`, `SearchButtonWidget.tsx:212`), czyli
osiągalny anonimowym kluczem przez PostgREST bez żadnego kroku poza `GET`.

Efekt: **imię, nazwisko, avatar, okładka, bio PL/EN, stanowisko, firma, specjalizacja i pięć linków
social każdego zarejestrowanego członka** publicznego tenanta są dostępne osobie niezalogowanej —
także tych, którzy jawnie **wyłączyli** przełącznik „Widoczność w wewnętrznej wyszukiwarce osób”
(`AccountIdentityPanel.tsx:147–157`).

Kod **wie o tej luce** i wprost ją nazywa — ale mityguje tylko indeksację, nie dostęp:

> „PROBLEM: `profiles_public` zawęża tylko po `tenant_id` (bez bramki `discoverable`), więc każdy
> profil — także zwykłego członka, który nie wyraził zgody na widoczność w katalogu — był osiągalny
> pod `/author/<slug|uuid>`… ROZWIĄZANIE (minimalne, bez zmiany powierzchni danych): **indeksujemy**
> wyłącznie profile z realną PUBLICZNĄ obecnością” — `src/lib/experts/publicVisibility.ts:3–14`

`isIndexableProfile()` daje `noindex, nofollow` gołemu profilowi członka
(`author.$slug.tsx:246–260`) — to zamyka ścieżkę „Google”, ale **nie** ścieżkę „ktokolwiek z URL-em
lub z anon key”. Obietnica w copy dotyczy *dostępu*, nie indeksowania, więc pozostaje niespełniona.
To materiał na roszczenie z art. 5 ust. 1 lit. a RODO (rzetelność/przejrzystość), nie tylko dług
techniczny — zgoda została zebrana pod opisem szerszym niż faktyczna ochrona.

🔧 **Naprawa** (nie wymaga zmiany żadnego konsumenta widoku, bo byliny i avatary autorów przechodzą
pierwszym warunkiem):

```sql
CREATE OR REPLACE VIEW public.profiles_public WITH (security_invoker = off) AS
SELECT … FROM public.profiles
WHERE tenant_id = public_tenant_id()
  AND slug IS NOT NULL
  AND (public.user_is_editorial(id) OR discoverable);
```

`user_is_editorial(uuid)` jest już nadane `anon` (`20260801162518:29`), więc widok definera nie
potrzebuje nowych grantów. Do tego pgTAP: „anon NIE widzi profilu nie-redakcyjnego z
`discoverable = false`” — asercja odwrotna do tej, którą dziś ma
`author_profile_public_access_test.sql:66–79` (ta sprawdza wyłącznie, że widok **coś** zwraca).
Jeśli decyzja pójdzie w drugą stronę (widok zostaje otwarty), trzeba **poprawić copy** w obu
językach — dziś obiecuje ochronę, której nie ma.

# §4. WYSOKA — bramki „ekspert / VIP” czatu nie są skalowane tenantem

**Plik:** `supabase/migrations/20260723090707_…:2–12` (`is_expert_user`)
· `20260723092200_…:2–22` (`is_vip_user`), `:25–28` (`is_gated_recipient`)
Każda z tych funkcji jest zdefiniowana **dokładnie raz** w 627 migracjach — nigdy nie poprawiana.

```sql
CREATE OR REPLACE FUNCTION public.is_expert_user(_uid uuid) … AS $$
  SELECT _uid IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.author_profiles ap WHERE ap.user_id = _uid)      -- brak tenant_id
    OR EXISTS (SELECT 1 FROM public.event_speakers es WHERE es.user_id = _uid)       -- brak tenant_id
    OR EXISTS (SELECT 1 FROM public.podcast_episode_people pep WHERE pep.profile_id = _uid)
    OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = _uid
                 AND ur.role IN ('admin','editor','author')));                       -- brak tenant_id
```

Ta sama migracja definiuje obok `my_effective_tier_features()`, która **jest** poprawnie skalowana
(`g.tenant_id = me.tenant_id`, `us.tenant_id = me.tenant_id` — `20260723090707:23`, `:32`). Trzy
funkcje obok niej tego filtra nie mają, mimo że `author_profiles` ma kolumnę `tenant_id`
(potwierdzone w `types.ts`; istnieje nawet dedykowana migracja
`20260803140000_author_profiles_owner_tenant_scope.sql`).

Znaczenie: w `get_or_create_direct_conversation` (`20260723180000:625–636`) `is_expert_user(v_uid)`
oraz `is_vip_user(v_uid)` **omijają** bramkę tiera (`chat: tier disabled`) **i** bramkę
`chat_direct_gated`. Konto będące autorem/prelegentem/gościem podcastu w tenancie **B** dostaje
więc w tenancie **A** przywileje eksperta — czat na progu Essential (gdzie flagi `chat_*` są
defensywnie usuwane, `20260723180000:57–63`) i bezpośredni DM do ekspertów bez zapytania —
bez żadnego uprawnienia w tenancie A. To samo dotyczy `is_gated_recipient` po stronie odbiorcy
oraz `send_expert_inmail` (`20260724130000` — warunek `is_gated_recipient(p_recipient_id)`).

Zasięg praktyczny zależy od liczby kont współdzielonych między tenantami, więc dziś może być
niewielki — ale to bramka autoryzacyjna, a nie heurystyka, i różni się od reszty modułu.

🔧 **Naprawa:** dodać `AND <tabela>.tenant_id = public.current_tenant_id()` w każdym `EXISTS`
w `is_expert_user` i `is_vip_user` (dla `user_roles` — użyć `has_role`, które już to robi),
zregenerować snapshot autoryzacji i dopisać pgTAP „autor tenanta B nie jest ekspertem w tenancie A”
do `supabase/tests/chat_conversation_tenant_isolation_test.sql`.

# §5. WYSOKA — eksport danych RODO pomija czat, zapytania do ekspertów, sieć i całe „rozszerzenia profilu”

**Plik:** `src/lib/profile/export.functions.ts:1–10` (deklaracja), `:44–157` (zakres sekcji)

Funkcja deklaruje w nagłówku: „Server fn zwraca **komplet danych**, które platforma przechowuje
o WYWOŁUJĄCYM” (art. 15 — dostęp, art. 20 — przenoszalność). Eksportuje 17 sekcji: `profile`,
`user_roles`, `user_follows`, `eu_policy_follows`, `user_bookmarks`, `user_read_history`,
`comments`, `payment_orders`, `user_subscriptions`, `user_purchases`, `user_consents`,
`user_consent_events`, `notification_preferences`, `push_subscriptions`, `personality_results`,
`badges`, `network_connections` + zaproszenia in/out.

**Czego nie ma** — a jest przechowywane i jest danymi osobowymi wywołującego:

| Pominięte | Tabela | Dlaczego to nie kosmetyka |
| --------- | ------ | ------------------------- |
| Treść rozmów | `messages`, `conversations`, `conversation_participants` | rdzeń modułu czatu; treść pisana przez podmiot danych |
| Personalizacja rozmów | `conversation_nicknames`, `message_stars`, `message_reactions` | nadane przez użytkownika etykiety osób trzecich |
| Zapytania do ekspertów | `expert_inmails` | temat, uzasadnienie, pytania, linki — dane wprost od użytkownika |
| Doświadczenie zawodowe | `profile_experiences`, `profile_education`, `profile_skills`, `profile_awards`, `profile_hobbies`, `profile_cv_files` | **CV wpisane ręcznie w profil** — najbardziej „własne” dane w całym systemie |
| Rekomendacje i poparcia | `profile_recommendations`, `profile_skill_endorsements` | wystawione i otrzymane |
| Przedstawienia | `introduction_requests` | z treścią prośby |
| Odsłony profilu | `profile_view_events` | „kto oglądał” + „kogo oglądałem” |
| Moderacja | `user_reports`, `user_blocks` | zgłoszenia złożone przez użytkownika |
| Obecność medialna | `media_mentions`, `expert_expertise_areas` | kurowane, ale wpisywane przez właściciela profilu |

Konstrukcja funkcji jest przy tym dobra: `Promise.allSettled` + jawna sekcja `errors`, kolumny
wypisane bez `*`, sieć czytana przez te same RPC co UI (bo `user_connections` nie ma grantów).
Defektem jest **zakres**, nie mechanika — i to, że nagłówek obiecuje komplet, którego nie ma,
więc żadna sekcja `errors` tego nie ujawni (brakujących tabel nikt nie pyta, więc nie zgłaszają błędu).

Uwaga: ekspozycja `messages` w eksporcie wymaga rozstrzygnięcia, czy eksportować **cały wątek**
(zawiera wypowiedzi rozmówcy — dane osoby trzeciej), czy tylko wiadomości nadane przez wołającego.
Standardowa wykładnia art. 15 ust. 4 mówi: **własne wiadomości + metadane wątku** (identyfikator,
data, uczestnicy), bez treści rozmówców.

🔧 **Naprawa:** dodać sekcje w kolejności wagi — (1) `profile_experiences|education|skills|awards|hobbies|cv_files`
(najprostsze: RLS own-row, zero nowych RPC), (2) `expert_inmails` filtrowane `sender_id = uid`,
(3) `messages` z `sender_id = uid` + metadane wątków, (4) `profile_recommendations`
(`author_id = uid OR recipient_id = uid`), `introduction_requests`, `profile_view_events`,
`user_reports`, `user_blocks`. Dopisać do `src/__tests__/` test kontraktu: „każda tabela
z `user_id`/`sender_id`/`author_id` w schemacie jest albo w eksporcie, albo na jawnej liście
wyłączeń z uzasadnieniem” — inaczej luka wróci przy następnej nowej tabeli.

# §6. WYSOKA — „Zapytanie do eksperta” istnieje w dwóch generacjach; żywa nie dostała dwóch poprawek

To najbardziej rozgałęzione ustalenie audytu, dlatego najpierw mapa. Funkcja ma w repozytorium
**dwie kompletne, równoległe implementacje**, różniące się nazwą tabeli i nazwami RPC:

| | **Generacja A — „inmail”** | **Generacja B — „expert_request”** |
| --- | --- | --- |
| Tabela | `expert_inmails` (`20260723090707:131`) | `expert_requests` — **rename** tej samej tabeli (`20260723180000:299`) |
| Pula | `my_inmail_quota()` (`20260723092200`) | `my_expert_request_quota()` (ostatnia def. `20260724090500:16`) |
| Wysyłka | `send_expert_inmail()` (ostatnia def. `20260724130000:95`) | `send_expert_request()` (ostatnia def. `20260724090500:78`) |
| Rozstrzygnięcie | *— brak —* | komentarz SQL: „**kanoniczny** podgląd puli” (`20260723180000:353`) |
| **Kto tego woła w `src/`** | **KLIENT — wszystko** (`useExpertRequests.ts:50, 74, 93, 122, 148`) | **nikt** (0 trafień w `src/`) |
| Obecność w `types.ts` | `expert_inmails`, `my_inmail_quota`, `send_expert_inmail` | `my_expert_request_quota:14014`, `send_expert_request:14768` — **ale tabeli `expert_requests` w typach nie ma** |

Rozjazd nie jest przypadkiem — repozytorium sam go opisało, gdy się o niego potknęło:

> „Naprawa łańcucha migracji: tabela zapytań do eksperta ma w łańcuchu DWIE nazwy. `20260723180000`
> robi `ALTER TABLE expert_inmails RENAME TO expert_requests`, ale ta migracja napisana jest jeszcze
> pod starą nazwą. **Na produkcji pasowało, bo tamten blok siedział w pliku o zdublowanej wersji
> i nigdy się nie wykonał** (zrzut typów wciąż zna tylko `expert_inmails`); **na świeżej bazie
> zmiana nazwy JEST stosowana** i cztery polecenia niżej wywracały się z `42P01`. **Nie
> rozstrzygamy tu, która nazwa jest kanoniczna** — to decyzja o zmianie nazwy tabeli na żywej
> produkcji, poza zakresem tej migracji.”
> — `supabase/migrations/20260728212941_…:9–20`

Czyli: generacja B nie weszła na produkcję **wyłącznie dlatego**, że jej migracja miała wtedy
zdublowaną wersję — ten sam defekt co §1, tylko wcześniejszy. Ta kolizja została w międzyczasie
usunięta przez **scalenie** obu plików w jeden (marker `SCALONE Z: 20260723180000_expert_request_quota.sql`
— `20260723180000_chat_plus_tier_gating_and_benefit.sql:260`), więc rename **jest dziś częścią
każdego replayu od zera**. Zweryfikowane na `d42e5eb`: wersja `20260723180000` jest unikalna,
`ALTER TABLE … RENAME TO expert_requests` siedzi w `:299`, a w całych 627 migracjach **nie ma
żadnego `RENAME TO expert_inmails` ani `CREATE TABLE … expert_inmails` po tym punkcie**.
Z tego wynikają cztery ustalenia.

## §6a. WYSOKA — pulę „Zapytań do eksperta” obchodzi pętla „wyślij → anuluj → wyślij”

Żywa ścieżka liczy zużycie z pominięciem anulowanych:

```sql
-- send_expert_inmail, 20260724130000:175–178  (identycznie my_inmail_quota, 20260723092200:188, :230)
SELECT count(*) INTO v_used FROM public.expert_inmails ei
 WHERE ei.sender_id = v_uid
   AND ei.created_at >= date_trunc('month', now())
   AND ei.status <> 'cancelled';        -- ← anulowane NIE liczą się do puli
```

Anulowanie jest w pełni dostępne nadawcy: `resolve_expert_inmail` z `p_action = 'cancel'` wymaga
tylko `v_uid = v_row.sender_id` (`20260723090707`), nie ma limitu liczby anulowań i jest wystawione
w UI (`ExpertRequestAction` zawiera `"cancel"` — `useExpertRequests.ts:10`). Zatem członek planu
Plus (pula 2/miesiąc) wysyła zapytanie, anuluje je, i `used` wraca do zera — **pula jest
w praktyce nieograniczona**. Zapytanie zostaje przy tym doręczone (wiersz istnieje, ekspert widzi
go w skrzynce, a `cancelled` nie usuwa treści), więc obejście nie odbiera nawet skutku wysyłki.

To jest **dokładnie ten defekt, który generacja B naprawiła** — i której naprawa nigdy nie dotarła
do generacji żywej:

> „(2) Obejscie przez anulowanie: `my_expert_request_quota` liczylo `status <> 'cancelled'`, wiec
> petla send→cancel→send zerowala `used`. **Naprawa: pula miesieczna liczy WSZYSTKIE wyslane
> w biezacym miesiacu kalendarzowym, niezaleznie od pozniejszego statusu.**”
> — `20260724090500_fix_expert_request_quota_race_and_cancel.sql:9–12`, implementacja `:64`

Waga: wysoka — to bezpośredni obejście monetyzowanego limitu, dostępne z UI, bez żadnych narzędzi.

## §6b. WYSOKA — na świeżej bazie cała funkcja przestaje działać (`42P01`)

Ostatnie definicje RPC wołanych przez klienta celują w `public.expert_inmails`
(`20260724130000:175`, `:184` dla `send_expert_inmail`; analogicznie `my_inmail_quota`,
`list_my_inmails`, `admin_list_inmails`, `resolve_expert_inmail`). Rename na `expert_requests`
zachodzi **wcześniej** w łańcuchu (`20260723180000:299`), a **nic go nie odwraca** — w 627
migracjach nie ma ani `RENAME TO expert_inmails`, ani `CREATE TABLE … expert_inmails` po tym
punkcie (jedyne `CREATE TABLE` to `20260723090707:131`, sprzed rename’u).

Skutek na każdym środowisku postawionym od zera (lokalny dev, preview, nowy tenant, disaster
recovery): pierwsze wywołanie „Zapytania do eksperta” kończy się `42P01 relation
"public.expert_inmails" does not exist`. Produkcja działa **wyłącznie** dzięki temu, że rename się
tam historycznie nie wykonał — czyli schemat produkcyjny i schemat z replayu **nie są tym samym
schematem**, a `types.ts` opisuje tylko pierwszy.

Bramka, która mogłaby to wykryć (`check:db-contract`), jest w CI krokiem **po wdrożeniu**
(`ci.yml:385`) i wymaga sekretów, więc nie chroni merge’a. `check:sql-migration-replay` sprawdza
kolizje wersji i porządek nazw, ale — jak zauważały poprzednie wydania serii — **nie odtwarza
treści**, więc rozjazdu nazwy relacji nie widzi.

## §6c. ŚREDNIA — TOCTOU: równoległe wysyłki nie są serializowane

Żywa `send_expert_inmail` (`20260724130000:150–195`) wykonuje `count(*)` → `IF v_used >= v_quota`
→ `INSERT` **bez żadnej blokady** (zmierzone: zero wystąpień `advisory` w ciele funkcji). Dwa
równoległe wywołania przy `quota = 1` wstawią dwa wiersze. Naprawa istnieje — znów tylko
w generacji B: `PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text))`
(`20260724090500:95`).

## §6d. ŚREDNIA — brak klucza `direct`, więc CTA nigdy się nie chowa progom bezpośrednim

Żywa `my_inmail_quota()` zwraca cztery klucze:

```sql
RETURN jsonb_build_object('quota', v_quota, 'used', v_used,
                          'remaining', GREATEST(v_quota - v_used, 0),
                          'unlimited', v_quota >= 100000);
```

Klient oczekuje pięciu — z `direct` na czele kontraktu (`useExpertRequests.ts:27`), mapowanym przez
`direct: rec.direct === true` (`:61`). **Generacja B zwraca `direct` w każdej z trzech gałęzi
wyjścia** (`20260724090500:27`, `:68`, `:73`), łącznie z `is_super_admin` i `is_expert_user`.
Klient został więc napisany pod
kontrakt generacji B, a woła generację A — dlatego `quota.direct` jest **zawsze `false`**:

* `ExpertRequestButton.tsx:77` — `if (quota?.direct) return null;` **nigdy się nie wykonuje**,
  choć nagłówek pliku deklaruje: „Progi »bezpośrednie« (VIP i wyżej, eksperci, admin) piszą wprost
  przez zwykłą wiadomość — **nie pokazujemy im tego CTA**” (`:4–5`). Pokazujemy: VIP widzi obok
  siebie „Wyślij wiadomość” i „Zapytanie do eksperta”.
* Ten sam nagłówek (`:6`) powołuje się na `my_expert_request_quota` i `send_expert_request` — czyli
  **komentarz opisuje generację B**, a import obok woła A. To nie jest przeoczenie w komentarzu,
  to ślad, że klient nigdy nie został przepięty.
* `ExpertRequestDialog.tsx:78` — gałąź `t("expertRequest.quota.direct")` jest **martwa**.
* `ExpertRequestDialog.tsx:87` — `outOfQuota = !!quota && !quota.direct && quota.remaining <= 0`
  działa poprawnie tylko przypadkiem.

Obejście częściowe istnieje i działa: `UNLIMITED_THRESHOLD = 1000` + `isUnlimited`
(`ExpertRequestButton.tsx:80–82`) — ale ukrywa jedynie licznik „x/y”, nie sam przycisk. Test
macierzowy utrwalił niepewność w nazwie przypadku (`ExpertRequestButton.matrix.test.tsx:100`:
„chowa sie? nie — brak allowance ale wciaz widoczny”).

## 🔧 Naprawa §6 — jedna decyzja, potem prosta robota

**Decyzja do podjęcia: która nazwa tabeli jest kanoniczna.** Repozytorium świadomie tego nie
rozstrzygnęło (`20260728212941:18–20`) i to jest dziś źródło wszystkich czterech podpunktów.
Rekomendacja: **zostać przy `expert_inmails`** (to nazwa na produkcji i w `types.ts`; rename żywej
tabeli to migracja z ryzykiem, a nazwa jest wewnętrzna — UI mówi „Zapytanie do eksperta”
niezależnie od niej). Wtedy:

1. **Odwrócić rename w nowej migracji:** `ALTER TABLE IF EXISTS public.expert_requests RENAME TO
   expert_inmails;` (+ indeksy) — idempotentnie, żeby produkcja była no-opem, a świeża baza wróciła
   do stanu z typów. To zamyka §6b.
2. **Przenieść obie poprawki z generacji B do generacji A** — to dwie edycje w ciele
   `send_expert_inmail` i `my_inmail_quota`: usunąć `AND status <> 'cancelled'` z obu liczników
   (§6a) i dodać `PERFORM pg_advisory_xact_lock(hashtext('expert_request:' || v_uid::text))` przed
   `count(*)` (§6c).
3. **Dodać `direct` do `my_inmail_quota()`** — semantyka gotowa w generacji B
   (`chat_direct_gated` OR `is_super_admin` OR `is_expert_user`). To zamyka §6d bez zmian w kliencie.
4. **Usunąć generację B** (`my_expert_request_quota`, `send_expert_request`) albo zostawić jako
   cienkie aliasy delegujące do A — dziś to 2 nieużywane RPC w `types.ts`, które udają kanoniczne
   i przy następnej edycji znów zmylą autora.
5. **pgTAP na §6a:** „wyślij → anuluj → wyślij przy `quota = 1` musi odbić się o `monthly quota
   exceeded`”. Bez tego obejście wróci, bo dziś nic go nie pilnuje —
   `expert_request_visibility_test.sql` sprawdza widoczność, nie zużycie puli.

# §7. ŚREDNIA — „Zapytanie do eksperta” nie generuje żadnego powiadomienia

**Sprawdzone:** brak `INSERT INTO public.notifications` w jakiejkolwiek migracji dotykającej
`expert_inmails`; brak triggera powiadamiającego (jedyne triggery na tej tabeli to
`expert_inmails_set_updated_at` — `20260723090707:178` — i `expert_inmails_guard_update` —
`20260728212941:153`); brak `expert_request`/`inmail` w katalogu rodzajów powiadomień
(`src/lib/notifications/preferences.ts:21–32`: `system, comment, follow, subscription, content,
security, message, tracker, connection, saved_search, crm_task`); brak ścieżki mailowej
(`grep -ri "inmail\|expert_request" src/lib/email src/lib/notifications src/routes/api` → 0 trafień).

Zapytanie do eksperta jest **płatnym, limitowanym** świadczeniem (pula 1–5/miesiąc zależnie od
planu, `20260723180000:756–766`). Nadawca zużywa jednostkę puli, a odbiorca dowiaduje się o tym
wyłącznie wchodząc na `/profile/expert-requests` albo do panelu `admin.expert-requests`. Analogicznie
`resolve_expert_inmail` (`20260723090707`) zmienia status na `approved`/`declined`/`answered` i tworzy
konwersację, ale **nie zawiadamia nadawcy** — użytkownik, który wydał jednostkę puli, nie wie, że
odpowiedź istnieje, dopóki sam nie sprawdzi.

Dla kontrastu: zaproszenia do sieci mają pełną obsługę — rodzaj `connection`, producent
`tg_user_connections_notify`, preferencja `enabled_connection`, licznik `connections_pending`
i realtime (`src/lib/network/useConnections.ts:319–350`). Czyli wzorzec w repo istnieje i jest
sprawdzony; zapytania do ekspertów po prostu z niego nie korzystają.

🔧 **Naprawa:** rodzaj `expert_request` w `notifications_kind_check` + `NotificationKind` +
`TOGGLEABLE_NOTIFICATION_KINDS` + kolumna `enabled_expert_request` w `notification_preferences`
(wzór: `enabled_connection`); `PERFORM public.enqueue_notification(...)` na końcu
`send_expert_inmail` (dla odbiorcy) i w `resolve_expert_inmail` (dla nadawcy, poza gałęzią
`cancel`). `enqueue_notification` sam bramkuje preferencją (pgTAP:
`notification_preferences_gating_test.sql`), więc nowa ścieżka nie wymaga własnej logiki zgód.

# §8. ŚREDNIA — `search_chat_contacts`: brak escapowania i brak indeksu (regres wobec `search_people`)

**Pliki:** `supabase/migrations/20260801124000_search_chat_contacts.sql:57–66`
· `supabase/migrations/20260801162647_…` (`search_people`, wariant kanoniczny)

Nowsze RPC wyszukiwarki odbiorców czatu wstrzykuje `p_query` do siedmiu predykatów `ILIKE` wprost:

```sql
AND ( coalesce(p_query,'') = ''
   OR p.display_name    ILIKE '%' || p_query || '%'
   OR p.first_name      ILIKE '%' || p_query || '%'
   … 5 kolejnych kolumn … )
```

`search_people`, powstałe w tym samym oknie czasowym, robi to poprawnie:

```sql
WITH q AS (SELECT unaccent(lower(btrim(…))) AS raw,
       replace(replace(replace(unaccent(lower(btrim(…))), '\','\\'), '%','\%'), '_','\_') AS esc)
… AND (q.raw = '' OR p.discovery_search LIKE '%' || q.esc || '%')
```

Trzy różnice, wszystkie na niekorzyść nowszej funkcji:

1. **Brak escapowania `%` `_` `\`.** Nie jest to SQL injection (zapytanie jest parametryzowane), ale
   `%` wpisane w pole wyszukiwania działa jak wildcard: fraza `%` zwraca wszystkich kontaktów,
   a `a_b` dopasowuje `axb`. Semantyka wyszukiwania różni się od `/people`, gdzie te znaki są dosłowne.
2. **Brak `unaccent`/`lower`.** `ILIKE` załatwia wielkość liter, ale nie diakrytyki — „Łukasz”
   nie znajdzie się po „Lukasz”, choć w katalogu `/people` (via `discovery_search`) znajdzie się.
3. **Brak indeksu.** `search_people` czyta jedną kolumnę `discovery_search` z indeksem trigramowym
   (`idx_profiles_discovery_search_trgm`, `20260717162432:6`); `search_chat_contacts` robi siedem
   `ILIKE '%…%'` bez indeksu, czyli sekwencyjny skan `profiles` przy każdym uderzeniu w klawisz
   (`usePeopleSearch` ma `staleTime: 30_000`, ale klucz zapytania zawiera frazę —
   `useConversations.ts:262`, więc każdy nowy prefiks to nowe zapytanie).

Kontekst historyczny jest w nagłówku migracji i jest uczciwy: funkcja powstała awaryjnie, żeby
odkleić czat od niejednoznacznego przeciążenia `search_people` (błąd `42725`). Regres jakości
zapytania nie został jednak przy tej okazji nadrobiony.

🔧 **Naprawa:** przenieść CTE `q` z `search_people` (escape + `unaccent` + `lower`) i przełączyć
warunek na tę samą kolumnę `p.discovery_search`, którą indeksuje trigram; filtr sieci
(`user_connections … status='accepted'`) pozostaje bez zmian. Zysk: identyczna semantyka
wyszukiwania w `/people` i w oknie „nowa rozmowa”, jeden indeks obsługuje oba.

# §9. ŚREDNIA — dryf słownika `allow_messages_from`: bramka testuje wartość, której CHECK nie dopuszcza

**Pliki:** `supabase/migrations/20260712190000_chat_privacy_tenant_hardening.sql:174` (CHECK)
· `20260725175514_…:55`, `20260723180000:653`, `20260723092200:103`, `20260723090707:114`,
`20260721204040:121` (bramka — pięć generacji)

CHECK dopuszcza trzy wartości:

```sql
CHECK (allow_messages_from IN ('everyone', 'existing', 'nobody'))
```

Bramka nowej rozmowy w `get_or_create_direct_conversation` testuje inny słownik:

```sql
IF public.chat_allow_messages_from(p_peer_id) NOT IN ('everyone','contacts') THEN
  RAISE EXCEPTION 'chat: peer not available';
```

`'contacts'` **nie istnieje** — nie ma go w CHECK-u, w typie `AllowMessagesFrom`
(`src/lib/notifications/preferences.ts:35`) ani w wartościach domyślnych. Literał przetrwał pięć
kolejnych `CREATE OR REPLACE` tej funkcji, w każdej martwy.

Skutek nie jest awarią (obecne zachowanie jest bezpieczne: przechodzi tylko `'everyone'`), ale
zdradza **brakującą opcję produktową**, pod którą bramka była pisana. Dziś środkowa opcja
„Tylko dotychczasowi rozmówcy” (`i18n-chat.ts`, `allowMessagesExisting`) blokuje nową rozmowę
**także zaakceptowanemu kontaktowi**, który jeszcze nigdy nie napisał — mimo że bramka sieci
i tak wymaga zaakceptowanego połączenia (`is_connected_pair`, `20260723180000:622`). Użytkownik
wybierający „tylko dotychczasowi rozmówcy” dostaje faktycznie „nikt nowy, nawet z mojej sieci”,
czyli zachowanie bliższe `'nobody'` niż etykiecie.

🔧 **Naprawa (do wyboru, ale trzeba wybrać):** albo dodać wartość `'contacts'` do CHECK-u, typu
i selektora („Tylko moje kontakty” — opcja, którą bramka już obsługuje i której dziś brakuje między
„wszyscy” a „nikt nowy”), albo usunąć martwy literał z bramki i **doprecyzować etykietę** na
„Nikt nowy — tylko istniejące wątki”. Pierwsza opcja jest lepsza: rozwiązuje realną lukę
w prywatności (chcę pisać/otrzymywać od swojej sieci, nie od całej organizacji), a kod bazowy
jest już gotowy.

# §10. ŚREDNIA — ustawienia prywatności profilu rozrzucone na trzy powierzchnie

Zmierzone rozmieszczenie kontrolek:

| Ustawienie | Gdzie żyje | Plik |
| ---------- | ---------- | ---- |
| `discoverable` (widoczność w katalogu) | `/profile/edit` → zakładka „Dane podstawowe” | `AccountIdentityPanel.tsx:126–161` |
| `expert_requests_enabled` | `/profile/edit` | `AccountIdentityPanel.tsx:166–185` |
| `allow_messages_from`, `allow_connections_from` | `/profile/edit` | `AccountIdentityPanel.tsx:113–116` |
| `read_receipts_enabled`, `typing_indicators_enabled`, `show_online_status` | `/profile/edit` | `AccountIdentityPanel.tsx:66–101` |
| `profile_view_mode` (public/anonymous/private) | **karta na `/profile`** | `ProfileViewsCard` (`profile.index.tsx:616`) |
| zgody cookie/marketing/analityka + rejestr RODO | **`/profile/privacy`** | `profile.privacy.tsx:61` |

Strona, którą nawigacja nazywa „Prywatność” (`ProfileNav.tsx:80`, `profile.nav.privacy`), zawiera
**wyłącznie** zgody CMP i katalogowe — czyli ani jednej kontrolki widoczności profilu. Jej nagłówek
deklaruje przy tym „Zunifikowane centrum prywatności (audyt M15: »Zunifikować zgody
w /profile/privacy«)” (`profile.privacy.tsx:1–3`) — unifikacja objęła zgody, ale nazwa strony
obiecuje szerzej niż jej zawartość. Użytkownik szukający „jak się ukryć” trafia w miejsce,
gdzie tego nie ma, a właściwe przełączniki są w formularzu **edycji danych**.

🔧 **Naprawa:** przenieść (albo zdublować przez wspólny komponent, tak jak
`SubscriptionManagerSection` obsługuje dwie trasy) sekcję „Prywatność i widoczność” +
`profile_view_mode` na `/profile/privacy`, zostawiając w `/profile/edit` link „Ustawienia
prywatności →”. Jedna powierzchnia = jedno miejsce, w którym audytuje się zgody i widoczność.

# §11. ŚREDNIA — sześć pozycji nawigacji na jeden temat; jedna trasa jest podzbiorem drugiej

**Plik:** `src/components/profile/ProfileNav.tsx:72–81`

Grupa „Finanse” ma sześć pozycji: `membership`, `plan`, `billing`, `subscription`, `orders`,
`payments` (+ warunkowo `organization`). Nakładki są mierzalne:

* `/profile/subscription` renderuje **wyłącznie** `<SubscriptionManagerSection />`
  (`profile.subscription.tsx:12`), a `/profile/membership` renderuje ten sam komponent
  (`profile.membership.tsx:135`) plus resztę huba. Czyli `/profile/subscription` jest **ścisłym
  podzbiorem** `/profile/membership` — dwie pozycje nawigacji, jedna zawartość. Komentarz trasy
  („ten sam komponent renderuje hub członkostwa… więc obie ścieżki nigdy się nie rozjadą”,
  `profile.subscription.tsx:1–3`) rozwiązuje problem dryfu treści, ale nie tłumaczy, po co obie
  są w menu.
* Historia płatności występuje na **trzech** stronach: skrót na `/profile/plan`
  (`PaymentHistoryCard limit={10} showAllLink`, `profile.plan.tsx:165`), pełna z eksportem na
  `/profile/payments` (`profile.payments.tsx:25`) i dokumenty na `/profile/orders`
  (`BillingDocumentsCard`, `profile.orders.tsx:114`).

Dla porównania: grupa „Tożsamość” przeszła świadomą konsolidację — trzy dawne trasy
(`account`/`author`/`social`) to dziś jedna strona z zakładkami, a stare adresy zostały jako
przekierowania (`profile.account.tsx`, `profile.author.tsx`, `profile.social.tsx` — po 10 linii
każda). Ten sam ruch nie został wykonany w finansach.

🔧 **Naprawa:** ten sam wzorzec co w tożsamości — `/profile/subscription` → przekierowanie na
`/profile/membership` (zero utraty linków), a `plan`/`billing`/`orders`/`payments` scalić w jedną
trasę z zakładkami („Plan · Dane do faktur · Zamówienia · Historia”). Nawigacja spada z 6 na 2.

# §12. ŚREDNIA — pokrycie testami modułu: 15,4 %, dwa katalogi na zerze

Zmierzone (v8, tylko pliki tych katalogów, testy modułu zielone — 62 pliki / 670 testów):

| Katalog | Instrukcje | Pokrycie | Plików | Plików z 0 % |
| ------- | ---------- | -------- | ------ | ------------ |
| `src/lib/network` | 0 / 251 | **0,0 %** | 6 | **6** |
| `src/components/profile` | 0 / 1040 | **0,0 %** | 13 | **13** |
| `src/components/network` | 19 / 409 | 4,6 % | 13 | 12 |
| `src/lib/profile` | 16 / 198 | 8,1 % | 8 | 6 |
| `src/components/chat` | 309 / 1820 | 17,0 % | 27 | 19 |
| `src/lib/chat` | 266 / 1396 | 19,1 % | 27 | 12 |
| `src/lib/experts` | 251 / 459 | **54,7 %** | 14 | 4 |
| **Razem** | **861 / 5573** | **15,44 %** | 108 | 72 |

`src/lib/network` nie ma nawet katalogu `__tests__` — sześć modułów danych sieci kontaktów
(`useConnections.ts` 350 linii, `useRecommendations.ts` 173, `useIntroductions.ts` 134,
`useProfileViews.ts` 138, `useEndorsements.ts` 86) bez ani jednego testu jednostkowego.
`src/components/network` ma jeden test (`RequestIntroductionButton.matrix.test.tsx`) na trzynaście
komponentów; `ConnectButton.tsx` (423 linie, obsługuje pięć stanów relacji × blokady × polityki)
jest nietestowany. W czacie nietestowane są `ChatWindow.tsx` (1234 linie), `useMessages.ts` (714)
i `useConversations.ts` (565) — czyli cała mechanika okna rozmowy.

`src/lib/experts` (54,7 %) pokazuje, że w tym repo da się inaczej: siedem plików testów na
czternaście modułów i pokrycie trzykrotnie wyższe niż średnia modułu.

To nie jest apel o „więcej testów”. To wskazanie, gdzie **regresja przejdzie niezauważona**:
kontrakty słownikowe sieci (statusy relacji, czasowniki `respond_recommendation`) już raz
rozjechały się cicho — historia jest opisana w `useRecommendations.ts:6–14` („klient używał
`visible`… baza ignorowała `approve`/`delete`, a mutacja kończyła się sukcesem — stąd toast
»Opublikowano« przy zerowej zmianie stanu”). Ta klasa defektu wróci, bo nic jej dziś nie pilnuje
poza pgTAP-em, który — patrz §1 — nie uruchamia się wcale.

🔧 **Naprawa (minimum, w kolejności zwrotu):** (1) test kontraktu słowników sieci — statusy,
czasowniki, `RECOMMENDATION_RELATIONSHIPS` — porównany z CHECK-ami w migracjach (wzór:
`tierCatalogParity.test.ts`, który pilnuje `TIER_RANKS` vs seed); (2) `ConnectButton` matrix test
(pięć stanów × `canInvite` × blokada), wzór gotowy w `RequestIntroductionButton.matrix.test.tsx`;
(3) czyste funkcje `useConversations` (`applyReopenToViews`, `applyArchiveFlipToViews`,
`mutedUntilMs`, `isMuted`, `peerIdsFromDirectKey`) — są już wydzielone właśnie pod testy
(`useConversations.ts:129–133`: „Pure, żeby test regresyjny nie potrzebował QueryClienta”),
ale testu nie dostały.

# §13. NISKA — przedawnione `as never` na RPC, które są już w `types.ts`

| Miejsce | Uzasadnienie w komentarzu | Stan faktyczny |
| ------- | ------------------------- | -------------- |
| `src/lib/chat/useConversations.ts:266–271` | „`as never` **do czasu regeneracji types.ts**” | `search_chat_contacts` jest w `types.ts:14565` z pełną sygnaturą `{ p_limit?: number; p_query?: string }` |
| `src/lib/chat/attachments.ts:115` | (precedens, bez uzasadnienia) | `chat_check_upload_quota` jest w `types.ts:12686` |
| `src/lib/chat/useDiscoverable.ts:54,67,87` | „Kolumna z migracji 20260724130000 — `as never` do czasu regeneracji” | `expert_requests_enabled` jest w `types.ts:8867` (Row), `:8904` (Insert), `:8941` (Update) |

Rzut na `never` **wyłącza kontrolę nazwy RPC i typów argumentów**. Dla `search_chat_contacts` to
kontrola na bramkowanym RPC (zwraca tylko kontakty z zaakceptowanym połączeniem) — zmiana
sygnatury w bazie nie obleje `tsc`, tylko wybuchnie w runtime, dokładnie jak przy poprzedniej
awarii tej wyszukiwarki (`42725`). Precedens propaguje się dalej: `src/lib/email/suppression.server.ts:13`
powołuje się na `chat_check_upload_quota` jako wzór.

🔧 **Naprawa:** usunąć trzy `as never` i skasować przedawnione komentarze; `tsc --noEmit` jest dziś
czysty, więc regresji nie ma jak wprowadzić po cichu. Jeśli któryś rzut nadal jest potrzebny —
komentarz musi mówić, **czego brakuje w `types.ts`**, a nie „do czasu regeneracji”.

# §14–16. NISKIE — obserwacje projektowe (nie defekty, ale warto rozstrzygnąć świadomie)

**§14. `messages.sender_id … ON DELETE CASCADE`** (`20260723090707:134`). Usunięcie konta
(`deleteMyAccount`, `src/lib/account.functions.ts:31–82`) kasuje wszystkie wiadomości użytkownika
**z wątków rozmówców** — druga strona traci połowę rozmowy bez żadnego śladu, że coś zniknęło.
Ścieżka usuwania jest zresztą wzorowo zaprojektowana (kolejność: reauth → anulowanie subskrypcji →
anonimizacja dowodów księgowych → `deleteUser`, z inwariantem pilnowanym testem
`src/__tests__/accountDeletionRetention.invariant.test.ts:399–404`), więc to nie przeoczenie, tylko
niezapisana decyzja. Wariant do rozważenia: `SET NULL` + wiersz-nagrobek „wiadomość usuniętego
użytkownika”, jak robią to komunikatory — zachowuje ciągłość wątku bez trzymania danych osobowych.
Analogicznie `user_reports.reported_id ON DELETE CASCADE` (`20260717170000:530`) oznacza, że
zgłoszenia moderacyjne **przeciwko** użytkownikowi znikają, gdy ten usunie konto.

**§15. Asymetria `show_online_status`.** `read_receipts_enabled` jest wzajemne i egzekwowane w RLS
(„wyłączenie ukrywa Twój stan odczytu przed rozmówcami ORAZ ich stan przed Tobą” —
`preferences.ts:61–68`, polityka `conversation_participants_member_select`,
`20260712192421:154–166`). `show_online_status` działa jednostronnie: „users who turned
show_online_status off **observe others** but are not announced themselves”
(`src/lib/chat/presence.ts:126–131`). Sama implementacja jest poprawna — klient nie trackuje,
a polityka INSERT na `realtime.messages` dodatkowo wymaga `chat_show_online_status(auth.uid())`
(`20260712190000:638`), więc wyścig „prefsy jeszcze się nie wczytały” jest domknięty serwerowo.
Chodzi wyłącznie o spójność obietnicy: dwie pokrewne kontrolki prywatności mają różne modele
wzajemności i nic tego nie tłumaczy w copy.

**§16. Pula inMail nie jest skalowana tenantem.** `send_expert_inmail` i `my_inmail_quota` liczą
`count(*) … WHERE ei.sender_id = v_uid AND created_at >= date_trunc('month', now())` bez warunku
`ei.tenant_id`. Kierunek jest bezpieczny (pula wspólna = ostrzejsza), ale niespójny z resztą
modułu i z `expert_inmails.tenant_id`, które istnieje właśnie po to. Uwaga: **generacja B tego
nie naprawia** — skaluje tenantem wyłącznie rozstrzygnięcie progu (`20260724090500:30`, `:35`,
`:43`, `:53`), a sam licznik zużycia (`:60–63`) jest równie nieskalowany. Poprawiać **razem
z §6a/§6c**: to ta sama para funkcji i ten sam `count(*)`, więc jedna edycja zamyka trzy pozycje.

---

## 5. Co w tym module jest zrobione dobrze (zmierzone, nie uprzejmość)

Audyt szuka defektów, ale przemilczenie tego byłoby zafałszowaniem obrazu — kilka rozwiązań jest
wyraźnie powyżej średniej i **nie należy ich ruszać przy naprawach**:

* **Sieć kontaktów jest RPC-only.** `user_connections` nie ma ŻADNYCH grantów dla klientów; każdy
  odczyt i zapis idzie przez SECURITY DEFINER (`useConnections.ts:1–8`). Dzięki temu odmowa
  zaproszenia jest niewidoczna dla zapraszającego (prywatność jak na LinkedIn) — i nie da się tego
  obejść, bo nie ma czego czytać.
* **Realtime sieci nasłuchuje sygnałów pośrednich.** `user_connections` świadomie NIE jest
  w publikacji Realtime (bo zdarzenie ujawniłoby odmowę); zamiast tego nasłuchiwane są
  `notifications kind='connection'` i licznik `connections_pending`
  (`useConnections.ts:319–350`). To rzadko spotykana dbałość o to, żeby kanał czasu rzeczywistego
  nie wyciekał informacji, której RPC pilnuje.
* **Jeden kanał realtime na użytkownika, badge liczony z cache.** `useChatUnreadTotal` to `select`
  nad **tym samym** zapytaniem co lista rozmów — zero dodatkowych round-tripów i zero drugiego
  cyklu unieważnień (`useConversations.ts:201–214`); kanał współdzielony refcountem w
  `tableChannelHub`, więc dzwonek + dock + `/messages` to jedno WebSocket.
* **Tożsamość rozmowy nie zależy od wiersza, który RLS może ukryć.** `peerIdsFromDirectKey`
  wyprowadza parę z `direct_key`, więc wyłączenie potwierdzeń odczytu przez rozmówcę nie psuje
  nagłówka wątku — zamiast tego powstaje `hiddenPeerRow` renderujący się jako „dostarczono”,
  nigdy „przeczytano” (`useConversations.ts:37–71`).
* **Rejestr capabilities z maszynowym parytetem.** `TIER_CAPABILITIES`
  (`src/lib/billing/capabilities.ts`) mówi wprost, że **11 z 20** flag warstw to dekoracja
  marketingowa bez bramki, a panel renderuje z tego badge „Egzekwowana / Dekoracyjna”. Do tego
  test parytetu vs snapshot bramek generowany ze SQL-a. Uczciwość wobec redakcji sprzedającej plany
  jest tu wpisana w typ — to najlepszy element całego modułu subskrypcji.
* **Rozdział czterech pojęć subskrypcji jest szczelny** (patrz §2 inwentarza): `subscriptions`
  (lustro Stripe’a) nigdy nie wchodzi do decyzji o dostępie — sprawdzone na wszystkich 33
  referencjach.
* **Kontrakt RPC klient↔SQL↔typy jest czysty** dla wszystkich 56 RPC modułu.
* **Załączniki czatu:** prywatny bucket, allowlista MIME bez SVG (świadomie —
  `attachments.ts:12–13`), podpisane URL-e skrócone do 15 min z odświeżaniem 5 min przed
  wygaśnięciem, batch-podpisywanie całego wątku jednym wywołaniem, kwota uploadu egzekwowana RPC
  **przed** podpisaniem (bo wiersz wiadomości jeszcze nie istnieje, więc trigger rate-limitu nie
  ma czego bramkować — `attachments.ts:112–116`), oraz trigger czyszczący obiekt w storage przy
  usunięciu wiadomości (`20260801162518:45–70`).
* **`search_people` robi wyszukiwanie porządnie**: `unaccent` + `lower` + escapowanie `\ % _`,
  jedna kolumna `discovery_search` z indeksem trigramowym, twarde `p.discoverable` i równość
  tenanta. To wzorzec, do którego należy dociągnąć §8.

## 6. Kolejność naprawy

Kolejność dotyczy **stanu na `c6f94cf`**, czyli po wdrożeniu PR #187–#190. Wszystkie pozycje
krytyczne i wysokie są zamknięte, więc to, co zostało, jest planowe — żadna z tych rzeczy nie
wymaga pośpiechu.

| Priorytet | Pozycje | Uzasadnienie kolejności |
| --------- | ------- | ----------------------- |
| **P2 — planowo** | §8, §9 | §8 to przeniesienie gotowego CTE `q` z `search_people` (escape `\ % _` + `unaccent` + trigramowy `discovery_search`) — zysk: identyczna semantyka wyszukiwania w `/people` i w oknie „nowa rozmowa”, jeden indeks na obie ścieżki. §9 wymaga **decyzji produktowej**, nie tylko kodu: albo dodać realną wartość `'contacts'` (bramka jest już pod nią napisana i brakuje tej opcji między „wszyscy” a „nikt nowy”), albo usunąć martwy literał i doprecyzować etykietę. |
| **P3 — dług** | §10, §11, §12*, §13 | IA prywatności i finansów (§10, §11) — wzorzec konsolidacji istnieje już w grupie „Tożsamość” (trzy trasy → jedna z zakładkami + przekierowania). §13 to usunięcie trzech przedawnionych rzutów. **§12 tylko w części `src/components/network`** — reszta zamknięta. |
| **Do rozstrzygnięcia** | §14, §15 | Decyzje projektowe, nie błędy — wymagają zapisania wyboru, niekoniecznie zmiany kodu. |
| ✅ **Zamknięte** | §1, §2, §3, §4, §5, §6a–d, §7, §16 | Potwierdzone pomiarem na `c6f94cf` — patrz sekcja 3. |

**Jedna rekomendacja domykająca §12.** `src/components/network` to jedyny katalog audytu, którego
fala poprawek nie ruszyła: 4,6 % pokrycia, 12 z 13 plików na zerze. Priorytetem nie jest procent,
lecz `ConnectButton.tsx` (423 linie) — obsługuje pięć stanów relacji × `canInvite` × blokadę,
czyli dokładnie tę logikę, w której cichy rozjazd słownika już raz wystąpił
(historia w `useRecommendations.ts:6–14`). Wzór testu macierzowego jest gotowy obok:
`RequestIntroductionButton.matrix.test.tsx`.

**Wniosek procesowy, który przeżył naprawę §1.** §1 i §6b to ta sama klasa defektu w dwóch
odsłonach: **zdublowana wersja migracji, która „przypadkiem” chroni produkcję przed niedokończoną
zmianą**. Za pierwszym razem (2026-07) uchroniła produkcję przed rename’em tabeli zapytań do
eksperta — i dlatego §6b nadal istnieje jako rozjazd produkcja↔replay. Za drugim (2026-08)
zamroziła rozstrzygnięcie autorytetu weryfikacji (§2). Bramka `check:sql-migration-replay` powstała
po pierwszym incydencie, **wykryła drugi i doprowadziła do jego naprawy w ciągu jednego dnia** —
to zadziałało dokładnie tak, jak miało.

Konsekwencja, o którą tu chodzi, jest jednak ogólniejsza: **usunięcie kolizji odmraża zmianę,
którą kolizja wcześniej wstrzymywała.** Dla jasności — to *nie* naprawa §1 odblokowała rename
tabeli z §6b. Tamta kolizja (`20260723180000`) została zdjęta wcześniej, przez scalenie obu
plików w jeden (marker `SCALONE Z:` w `20260723180000_chat_plus_tier_gating_and_benefit.sql:260`),
i już wtedy rename stał się częścią każdego replayu. §6b jest więc żywy niezależnie od §1 —
sprawdzone na `d42e5eb`: wersja `20260723180000` jest unikalna, `ALTER TABLE … RENAME TO
expert_requests` (`:299`) nie ma nic, co by je powstrzymywało, i nie istnieje migracja odwracająca.
Wniosek na przyszłość: przy każdym zdejmowaniu kolizji wersji trzeba osobno sprawdzić, **co ta
kolizja dotąd wstrzymywała** — bo produkcja i świeża baza mogły się przez ten czas rozjechać.

Żadna z napraw §3–§16 nie wymaga zmiany architektury: wszystkie mieszczą się w istniejących
wzorcach tego repozytorium (definer view z filtrem, `has_role`/`current_tenant_id`, sekcja
w eksporcie, klucz w `jsonb_build_object`, `enqueue_notification`, CTE `q` z `search_people`,
przekierowanie trasy jak w `/profile/account`).
