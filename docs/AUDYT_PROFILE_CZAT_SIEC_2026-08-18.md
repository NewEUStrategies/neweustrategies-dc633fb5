# Audyt modułu profili, czatu i sieci kontaktów — RUNDA 2 (2026-08-18) + REWIZJA

**Data:** 2026-08-18 · **HEAD (rewizja):** `e83570cf` · **HEAD (pomiar bazowy):** `16c6e213`
· **Gałąź:** `claude/user-profile-chat-audit-i4na3t`
**Poprzednie wydanie:** `AUDYT_PROFILE_CZAT_SIEC_2026-08-06.md` (16 ustaleń, HEAD `633d02e` → `c6f94cf`)
**Zakres:** bez zmian — profil użytkownika, profil eksperta, warstwy/rodzaje subskrypcji, czat,
sieć kontaktów.

Runda 2 odpowiada na dwa pytania: **(a)** czy ustalenia rundy 1 są realnie zamknięte na bieżącym
`main`, **(b)** jakie NOWE defekty przyniosło 1666 commitów i 60+ PR-ów, które od tamtego pomiaru
weszły do repozytorium. Metoda bez zmian: każde ustalenie ma dowód w postaci `plik:linia`, wyniku
uruchomionego narzędzia albo odtworzonego zachowania.

> **Werdykt.** **Wszystkie 16 ustaleń rundy 1 są zamknięte** — sprawdzone pojedynczo na ostatnich
> definicjach funkcji/widoków, nie na opisach PR-ów; kilka poprawek wyszło poza rekomendacje
> audytu. Runda 2 wnosi **3 nowe ustalenia w zakresie** (dwie luki blokady, jedna regresja klasy
> „kompletność eksportu RODO”) i **2 czerwone bramki blokujące CI poza zakresem**. Po rewizji
> (patrz sekcja 0) jedna z tych bramek jest zielona, druga nadal czerwona, a §N1–§N3 pozostają
> otwarte.

---

## 0. REWIZJA — pomiar na `e83570cf` (2 PR-y, 10 commitów po `16c6e213`)

Delta jest mała i skupiona: **PR #249** (bliźniak migracji kariery) i **PR #250** (refaktor czatu,
testy, trzy zapory). Ta sekcja podaje wyłącznie to, co się zmieniło; reszta dokumentu opisuje
pomiar bazowy na `16c6e213` i pozostaje w mocy.

### 0.1 Status ustaleń rundy 2 po rewizji

| #   | Ustalenie                                  | Status na `e83570cf`  | Dowód                                                                                                                                                              |
| --- | ------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| N5  | Bliźniacza migracja treści (careers)       | ✅ **zamknięte**      | `check:sql-migration-replay` **exit 0**; bliźniak zarejestrowany w `KNOWN_CONTENT_TWINS` z decyzją operatora, a rejestr długu **waliduje sam siebie** (`e8d82748`) |
| N4  | `check:authz-snapshot`                     | ❌ **nadal czerwone** | ten sam dryf: nowa bramka flagi `pro_briefings` na polityce `policy:events/events member read` + proweniencja. **Nadal blokuje `verify`**                          |
| N1  | Blokada nie zamyka „Zapytania do eksperta” | ❌ **bez zmian**      | `send_expert_request` (ostatnia def. `20260812102000`): **0** odwołań do `is_blocked_pair`                                                                         |
| N2  | Kompletność eksportu RODO                  | ❌ **bez zmian**      | wszystkie 9 tabel nadal poza eksportem (0 trafień per tabela w `export.functions.ts`)                                                                              |
| N3  | `degree` / `mutual_count` a blokada        | ❌ **bez zmian**      | `connection_statuses`: 2 odwołania do `is_blocked_pair`, oba w `can_invite`                                                                                        |

Delta nie celowała w §N1–§N3 — celowała w **lukę jakościową, którą wskazałem w ocenie modułów**
(pokrycie czatu) oraz w §N5. To spójny wybór, nie przeoczenie; zapisuję dla porządku, że trzy
ustalenia rundy 2 nadal czekają.

### 0.2 Czat: zamknięcie luki, którą wskazała ocena modułów

Ocena z tej samej doby brzmiała: „**czat 6,5/10** — architektonicznie dobry, testowo najsłabszy…
17–20 % pokrycia, które nie drgnęło przez trzy pomiary”. Rewizja tę pozycję domyka.

| Metryka                            | Runda 2 (`16c6e213`)     | **Rewizja (`e83570cf`)**       |
| ---------------------------------- | ------------------------ | ------------------------------ |
| `src/lib/chat` (instrukcje)        | 19,7 %                   | **78,5 %** (1305 / 1662)       |
| `src/lib/chat` — pliki na zerze    | 12 z 29                  | **2 z 34**                     |
| `src/components/chat`              | 17,3 %                   | **44,6 %** (765 / 1714)        |
| Pliki testów czatu                 | 13                       | **31**                         |
| `ChatWindow.tsx`                   | 1165 linii, 0 % pokrycia | **643 linie** (−45 %), 83,55 % |
| **Pokrycie całego zakresu audytu** | 32,93 %                  | **56,43 %** (3447 / 6108)      |

**Zweryfikowałem ich własne liczby, nie przepisałem.** `WDROZENIE_CZAT_TESTY_REFAKTOR_2026-08-18.md`
deklaruje 78,52 % dla `src/lib/chat` i 44,63 % dla `src/components/chat` — mój niezależny przebieg
v8 daje **78,5 %** i **44,6 %**, czyli zgodność do zaokrąglenia. Liczba plików też się zgadza
(33 w ich liczeniu, 33 w moim po dołożeniu atomu `UnreadBadge` i katalogu `mobile`). Rozbieżność
w liczbie przypadków — deklarowane 607, zmierzone 602 — mieści się w innym doborze plików i **nie
jest ustaleniem**; obie metryki, które cokolwiek znaczą (pokrycie, liczba plików), zgadzają się.

**Dwie rzeczy zrobione lepiej, niż wynikałoby z samego podniesienia pokrycia:**

1. **Progi per katalog jako ratchet w `vitest.config.ts`** (`src/lib/chat/**`: 74 / 80 / 77 / 67)
   plus **100 % przypięte na czterech nowych czystych modułach** (`thread.ts`, `menuOptions.ts`,
   `useThreadJump.ts`, `keys.ts`). Pokrycie przestaje być metryką raportową, staje się warunkiem.
2. **Pokrycie wjechało do blokującego joba `verify`** (`ci.yml:384`, krok „Test + coverage gate”).
   Komentarz nad krokiem nazywa dokładnie tę pułapkę, którą bym zgłosił: _„previously CI ran plain
   `vitest run`, so the gate was local-only and could silently rot”_. Ratchet bez CI byłby ozdobą —
   nie jest.

### 0.3 Nowy kod czatu: brak nowych ustaleń

`ChatWindow` rozbity na 6 komponentów + 5 modułów warstwy danych. Przejrzałem je pod kątem
regresji prywatności — **żadnej nie znalazłem**, a dwa rozstrzygnięcia są wprost dobre:

- **`BlockedComposerNotice.tsx:1–8`** trzyma asymetrię blokady poprawnie: pokazuje **wyłącznie
  własną** blokadę (RLS `user_blocks` wystawia tylko swoje), a kierunek odwrotny („to on nas
  zablokował”) jest świadomie niewidoczny i egzekwowany serwerowo błędem `chat: blocked`. To ta
  sama zasada, której brak w kanale zapytań do eksperta — **§N1 jest po rewizji ostrzejsze, nie
  łagodniejsze**: repozytorium właśnie zapisało wprost, że blokada nie może być ujawniona i że DM
  ją egzekwuje, a drugi kanał kontaktu nadal jej nie zna i od naprawy §7 **dostarcza
  powiadomienie**.
- **Zgłoszenie do moderacji z okna rozmowy** (`ChatWindowDialogs.tsx:50–51`, `:118`) reużywa
  `ReportUserDialog` i RPC `report_user`, zamiast dublować dialog — powody, limit dzienny
  i deduplikacja zostają w jednym miejscu.
- `useAutoMarkRead.ts:67–77` i `useTypingRegistry.ts:34–40` respektują preferencje
  (`auto_mark_on_open`, `typing_indicators_enabled`) i dokumentują naprawiony po drodze błąd
  kolejności efektów.

Osobno: bramka symetrii FTS została przepisana (`ftsConfigSymmetry.ts` 91 → 496 linii,
`d4faeb97` — „zieleń tylko po sprawdzeniu i zakres z zależności”), czyli zespół sam znalazł
i domknął **fałszywie zieloną bramkę** — klasę, którą w rundzie 1 zgłaszałem jako defekt
(`check:no-paddle`, `check:sql-app-role`).

### 0.4 Nowy najsłabszy punkt: profil

Pałeczka przeszła z czatu na profil. Po rewizji najniższe pokrycie w zakresie mają
**`src/lib/profile` 22,0 %** (9 z 16 plików na zerze) i **`src/components/profile` 27,8 %**
(6 z 17). Nie podnoszę tego do rangi ustalenia — to ten sam wymiar co §12 rundy 1, a §12 jest
zamknięte w części, którą wskazało jako priorytet. Zapisuję jako **następny naturalny krok**, gdyby
ratchet czatu miał dostać rodzeństwo.

---

## 1. Delta i sygnały — pomiar bazowy na `16c6e213`

> Liczby w tej sekcji opisują HEAD `16c6e213`. Pozycje, które rewizja `e83570cf` zmieniła
> (pokrycie czatu, `check:sql-migration-replay`), są zaktualizowane w sekcji 0 — tam jest stan bieżący.

Instalacja jak w CI (`bun.lock` przepięty na publiczny npm, `.github/workflows/ci.yml`).

| Wymiar                            | Runda 1 (`c6f94cf`)             | **Runda 2 (`16c6e213`)**                                                                   |
| --------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Commity na `main`                 | —                               | **+1666**                                                                                  |
| Migracje SQL                      | 638                             | **788**                                                                                    |
| Bramki `check:*`                  | 14                              | **36**                                                                                     |
| Pliki zmienione w zakresie audytu | —                               | **110 plików, +8501 / −1345 linii**                                                        |
| Bramki statyczne                  | —                               | **20 z 22 zielonych, 2 czerwone** (§N4, §N5)                                               |
| `vitest` w zakresie audytu        | 62 plików / 670 testów          | **138 plików / 1850 testów**                                                               |
| — z tego czerwone                 | 0                               | **3, wszystkie z §N4/§N5**; moduły audytu (136 plików / 1847 testów) **w całości zielone** |
| Pokrycie zakresu (v8, stmt)       | 15,44 % → 25,05 %               | **32,93 %** (1979 / 6008)                                                                  |
| `src/components/network`          | 4,6 % (12 z 13 plików na zerze) | **98,5 %** (0 z 19 na zerze)                                                               |
| `src/lib/network`                 | 0,0 %                           | **91,2 %**                                                                                 |

### 1.1 Bramki uruchomione pojedynczo (22 statyczne)

**Zielone (20):** `sql-tenant-scope`, `sql-app-role`, `sql-anon-insert`, `sql-emit-actor`,
`sql-owner-tenant-scope`, `sql-policy-tenant-regression`, `rpc-contract`, `stale-never-casts`,
`unknown-casts`, `db-row-casts`, `types-freshness`, `content-layering`, `editor-autosave`,
`gate-coverage`, `public-assets`, `legacy-payment-refs`, `i18n-hardcoded`, `i18n-default-value`,
`i18n-overlay-imports`, `workflow-env-contract`.

**Czerwone (2):** `authz-snapshot` (§N4), `sql-migration-replay` (§N5). Oba są **blokującymi
krokami CI**.

`check:db-contract`, `check:bundle`, `check:chunks`, `check:chunk-parity`, `check:entry-purity`,
`check:widget-fidelity` oraz harnessy pg/careers/programs pominięto — wymagają sekretów, buildu
albo lokalnego Postgresa (patrz 1.3).

### 1.2 Pokrycie testami per katalog (v8, statements)

| Katalog                   | Runda 1 (start) | Runda 1 (po poprawkach) | **Runda 2** | Plików na zerze |
| ------------------------- | --------------- | ----------------------- | ----------- | --------------- |
| `src/components/network`  | 4,6 %           | 4,6 %                   | **98,5 %**  | **0 / 19**      |
| `src/lib/network`         | 0,0 %           | 89,7 %                  | **91,2 %**  | **0 / 8**       |
| `src/lib/experts`         | 54,7 %          | 54,7 %                  | 54,8 %      | 4 / 14          |
| `src/components/profile`  | 0,0 %           | 26,1 %                  | 27,8 %      | 6 / 17          |
| `src/lib/profile`         | 8,1 %           | 17,1 %                  | 22,0 %      | 9 / 16          |
| **`src/lib/chat`**        | 19,1 %          | 20,3 %                  | **19,7 %**  | 12 / 29         |
| **`src/components/chat`** | 17,0 %          | 17,3 %                  | **17,3 %**  | 19 / 28         |
| **Razem**                 | **15,44 %**     | 25,05 %                 | **32,93 %** | 50 / 131        |

Luka wskazana w rundzie 1 (`src/components/network`) jest domknięta w sposób, jakiego nie
zakładałem — z 4,6 % do 98,5 %, zero plików na zerze. **Nowy najsłabszy punkt to czat**: dwa
katalogi stoją na 17–20 % i praktycznie nie drgnęły przez trzy pomiary, a mieszkają w nich
najdłuższe pliki modułu (`ChatWindow.tsx` 1234 linie, `useMessages.ts` 714, `useConversations.ts`
565 — wszystkie bez testu). Nie podnoszę tego do rangi ustalenia, bo runda 1 zgłosiła to jako §12
i §12 jest zamknięte w części, którą wskazała jako priorytet; zapisuję jako **jedyny naturalny
następny krok** w tym wymiarze.

### 1.3 Czego nie dało się uruchomić

**pgTAP** (`supabase test db`) — brak lokalnego stacku Supabase (wymaga Dockera), tak jak
w rundzie 1. To nadal najważniejsze ograniczenie: wnioski o stanie schematu po pełnym replayu 788
migracji pochodzą z analizy statycznej łańcucha, nie z postawionej bazy. Repozytorium ma dziś
własne harnessy (`check:pg-harness`, `check:careers-harness`, `check:programs-harness`) — one też
potrzebują bazy.

**Pełna suita `vitest run` (całe `src/`) — nie dobiegła w tym środowisku.** Po 22 minutach procesy
robocze stały na **~0,1–0,9 % CPU** (bezczynne, nie wolne), więc przebieg przerwałem i zmierzyłem
suitę **zawężoną do modułów audytu** (wynik wyżej). Uczciwe zastrzeżenie: **nie twierdzę, że pełna
suita na `main` jest czerwona ani że wisi w CI** — nie ustaliłem przyczyny zatrzymania i może być
środowiskowa (brak sieci/Dockera dla któregoś testu). Podaję to jako ograniczenie pomiaru, nie jako
ustalenie o repozytorium. Trzy czerwone testy, które widzę w zakresie zawężonym, mają jasne
przypisanie do §N4 i §N5.

## 2. Weryfikacja rundy 1: 16 z 16 zamkniętych

Sprawdzone **pojedynczo**, na ostatniej definicji w łańcuchu migracji albo na kodzie.

| #      | Ustalenie rundy 1               | Dowód zamknięcia na `16c6e213`                                                                                                                                                                                                                                                        |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | Kolizja wersji migracji         | zero duplikatów wersji w 788 plikach                                                                                                                                                                                                                                                  |
| 2      | Autorytet weryfikacji profilu   | trigger woła `can_manage_profile_verification` + `OLD.tenant_id`                                                                                                                                                                                                                      |
| 3      | `profiles_public` dla anonimów  | dwuwarstwowy widok: zalogowany w tenancie (self / `discoverable` / staff / `caller_is_connected_to`), anon **wyłącznie** `profile_has_public_presence()`. Doszedł `hide_avatar` (nowa kontrolka, nie z audytu)                                                                        |
| 4      | Bramki eksperta/VIP bez tenanta | `is_expert_user`/`is_vip_user`/`is_gated_recipient` przyjmują dziś tenanta jawnym argumentem (`is_gated_recipient(p_recipient_id, v_tenant)`)                                                                                                                                         |
| 5      | Niekompletny eksport RODO       | 17 → **41 źródeł** (`from`/`rpc`), w tym `club_export_my_data` dla nowego modułu. **Ale klasa wróciła — §N2**                                                                                                                                                                         |
| 6a–d   | Ścieżka „Zapytanie do eksperta” | jedna implementacja (`send_expert_request`) + delegaty nazw; `pg_advisory_xact_lock`; pula liczy anulowane; `direct` w każdej gałęzi                                                                                                                                                  |
| 7      | Brak powiadomień o zapytaniach  | rodzaj `expert_request`, `enabled_expert_request`, producent `tg_expert_request_notify`                                                                                                                                                                                               |
| 8      | `search_chat_contacts`          | **0 wystąpień `ILIKE`**; 12 odwołań do `esc`/`unaccent`/`discovery_search`. Osobno: cały FTS czatu przeszedł z `simple` na `public.nes_polish` (fleksja polska, `20260815090000`)                                                                                                     |
| 9      | Fantomowe `'contacts'`          | wartość **realna**: `CHECK (allow_messages_from IN ('everyone','contacts','existing','nobody'))`, typ `AllowMessagesFrom`, i18n PL/EN („Tylko moja sieć kontaktów” / „My network only”), bramka przepisana. **Dokładnie brakująca opcja, którą rekomendowała runda 1**                |
| 10     | IA prywatności                  | `/profile/privacy` ma dziś `VisibilityAndContactSection` + `DataRightsSection` (`profile.privacy.tsx:29–30`, `:57`, `:100`)                                                                                                                                                           |
| 11     | IA finansów                     | `FINANCE` 6 → **4** pozycje; `/profile/subscription` to przekierowanie; `security`/`privacy` wyprowadzone z grupy finansów                                                                                                                                                            |
| 12     | Pokrycie testami modułu         | `src/components/network` **4,6 % → 98,5 %** (1 → 17 plików testów) — to była jedyna luka, którą runda 1 wskazała jako niedomkniętą; `ConnectButton.tsx`, wskazany imiennie, ma dziś `ConnectButton.matrix.test.tsx`. Razem 25,05 % → **32,93 %**. Pozostaje czat (17–20 %, patrz 1.2) |
| 13     | Przedawnione `as never`         | **0 wystąpień**; powstała bramka CI `check:stale-never-casts` (zielona)                                                                                                                                                                                                               |
| 16     | Pula bez skalowania tenantem    | `ei.tenant_id = v_tenant` w liczniku                                                                                                                                                                                                                                                  |
| 14, 15 | Decyzje projektowe              | świadomie bez zmian                                                                                                                                                                                                                                                                   |

### 2.1 Co runda 1 uruchomiła poza własnymi rekomendacjami

Warto to zapisać, bo pokazuje, jak ten zespół pracuje z audytem — trzy z moich ustaleń zostały
**zinstytucjonalizowane jako bramki CI**, zamiast tylko naprawione:

| Ustalenie rundy 1                   | Bramka, która powstała                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| §13 (przedawnione rzuty)            | `check:stale-never-casts`, `check:unknown-casts`, `check:db-row-casts`      |
| kontrakt RPC (ręczny skrypt audytu) | `check:rpc-contract`                                                        |
| §4 (skalowanie tenantem)            | `check:sql-policy-tenant-regression`, `check:sql-owner-tenant-scope`        |
| §5 (eksport RODO)                   | `exportOwnerScope.gate.test.ts` + pgTAP `profile_export_rls_scope_test.sql` |
| — (meta)                            | `check:gate-coverage` — bramka pilnująca, że bramki są w CI                 |

Liczba bramek `check:*` wzrosła z 14 do 36. To jakościowo inny reżim niż w rundzie 1.

---

## 3. Nowe ustalenia rundy 2

| #   | Obszar                    | Ustalenie                                                                                                                                             | Waga                                               |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| N1  | Czat / sieć — blokady     | `send_expert_request` **nie sprawdza `is_blocked_pair`** — zablokowany dostarcza wpis do skrzynki i powiadomienie osobie, która go zablokowała        | **Średnia**                                        |
| N2  | Profil — RODO             | Klasa „kompletność eksportu” wróciła: 9 tabel z danymi osobowymi poza eksportem, a nowa bramka pilnuje **zawężenia do właściciela**, nie kompletności | **Średnia**                                        |
| N3  | Sieć — blokady            | `degree` i `mutual_count` ignorują blokadę, choć `can_invite` jej nie ignoruje; pgTAP stopnia ma **zero** asercji o blokadach                         | **Niska**                                          |
| N4  | Platforma (poza zakresem) | `check:authz-snapshot` **CZERWONA** — nowa bramka flagi `pro_briefings` na polityce zdarzeń + dryf proweniencji                                       | **Wysoka (blokuje CI)** — nadal otwarte po rewizji |
| N5  | Platforma (poza zakresem) | `check:sql-migration-replay` **CZERWONA** — bliźniacza migracja o identycznej treści (careers)                                                        | ~~Wysoka~~ **✅ zamknięte w rewizji** (sekcja 0.1) |

---

# §N1. ŚREDNIA — blokada nie zamyka kanału „Zapytanie do eksperta”

**Pliki:** `supabase/migrations/20260812102000_pgtap_cluster_e_fix.sql` (ostatnia definicja
`send_expert_request`) · `supabase/migrations/20260806184400_…` (`tg_expert_request_notify`)

Zmierzone: `is_blocked_pair` w ostatnich definicjach funkcji kontaktowych modułu.

| Funkcja                                      | Liczba odwołań do `is_blocked_pair` |
| -------------------------------------------- | ----------------------------------- |
| `get_or_create_direct_conversation`          | 2                                   |
| `connection_statuses`                        | 2                                   |
| `connection_request`                         | 1                                   |
| `connection_suggestions`                     | 1                                   |
| **`send_expert_request`**                    | **0**                               |
| `request_introduction`                       | 0                                   |
| `write_recommendation`                       | 0                                   |
| `endorse_skill`                              | 0                                   |
| `record_profile_view` / `my_profile_viewers` | 0                                   |

`send_expert_request` bramkuje: uwierzytelnienie, „nie do siebie”, równość tenanta,
`is_gated_recipient`, `expert_requests_enabled` odbiorcy, przełącznik modułu w tenancie, długości
treści, pulę miesięczną i antyspam 5/24 h per odbiorca. **Nie bramkuje blokady.** Dla porównania
DM ma `is_blocked_pair` jako pierwszy warunek po sprawdzeniu tożsamości i rzuca `'chat: blocked'`.

Co to znaczy w praktyce: **A blokuje B → B wysyła „Zapytanie do eksperta” → A dostaje wpis
w skrzynce ORAZ powiadomienie.** Trigger `tg_expert_request_notify` woła `enqueue_notification`
bezwarunkowo na `INSERT` (`:13–27`), więc nie ma tam drugiej szansy na odsiew.

**Dlaczego to nowe ustalenie, a nie przeoczenie rundy 1.** W rundzie 1 ten kanał nie generował
żadnego powiadomienia (to było ustalenie §7). Wpis lądował w skrzynce, którą ekspert musiał sam
odwiedzić, więc obejście blokady było ciche i niskoskutkowe. **Naprawa §7 nadała mu skutek** —
teraz to push do dzwonka (i, przy włączonym `push_enabled`, na urządzenie). Poprawka jednego
ustalenia podniosła wagę innego, dotąd nieistotnego.

🔧 **Naprawa:** dopisać na początku `send_expert_request`, symetrycznie do DM:

```sql
IF public.is_blocked_pair(v_uid, p_recipient_id) THEN
  RAISE EXCEPTION 'expert_request: blocked';
END IF;
```

Do rozstrzygnięcia przy okazji (jedna decyzja, cztery funkcje): czy blokada ma też zamykać
`request_introduction`, `write_recommendation` i `endorse_skill`. Argument za: wszystkie trzy
kończą się treścią przy profilu blokującego albo prośbą do jego kontaktu. Argument przeciw:
rekomendacja i poparcie przechodzą moderację odbiorcy, więc blokujący ma drugą linię obrony.
Sama decyzja jest ważniejsza niż jej kierunek — dziś nie jest zapisana nigdzie.

# §N2. ŚREDNIA — klasa „kompletność eksportu RODO” wróciła; nowa bramka pilnuje czegoś innego

**Pliki:** `src/lib/profile/export.functions.ts` · `src/lib/profile/__tests__/exportOwnerScope.gate.test.ts`

Runda 1 (§5) rekomendowała dwie rzeczy: dopisać brakujące sekcje **oraz** dodać bramkę
kompletności („każda tabela z kolumną właściciela jest albo w eksporcie, albo na jawnej liście
wyłączeń z uzasadnieniem”). Pierwsza część została zrobiona z nawiązką (17 → 41 źródeł). Druga
część powstała, ale **pilnuje innego ryzyka**: `exportOwnerScope.gate.test.ts` sprawdza, czy każde
zapytanie eksportu jest zawężone do właściciela wiersza (żeby paczka nie wypuściła cudzych danych).
To dobra bramka — i moja runda 1 tego ryzyka nie widziała. Ale **kompletności nikt nie pilnuje**,
więc klasa jest otwarta i już się zmaterializowała.

Zmierzone: 100 tabel w `types.ts` ma kolumnę właściciela. Po odsianiu fałszywych trafień (sekcje
czytane przez RPC, treść redakcyjna, telemetria, tabele procesowe staffu — np. `career_applications`
ma `owner_id` **rekrutera**, nie kandydata) zostaje **9 tabel z danymi osobowymi wywołującego
i bez ścieżki do eksportu**:

| Tabela                             | Co przechowuje                            | Uwaga                                         |
| ---------------------------------- | ----------------------------------------- | --------------------------------------------- |
| `message_reactions`                | reakcje emoji nadane przez użytkownika    | **wskazana wprost w §5 rundy 1**              |
| `message_stars`                    | wiadomości oznaczone gwiazdką             | **wskazana wprost w §5 rundy 1**              |
| `retention_feedback`               | powód rezygnacji + **komentarz swobodny** | najwrażliwsza pozycja listy                   |
| `qa_questions`                     | pytania autorskie (także `is_anonymous`)  | treść tworzona przez użytkownika              |
| `poll_votes`                       | jak użytkownik zagłosował                 |                                               |
| `event_rsvps`                      | udział w wydarzeniach                     | RPC `my_event_participation` **już istnieje** |
| `resource_downloads`               | historia pobrań z biblioteki              | RPC `my_resource_downloads` **już istnieje**  |
| `saved_searches`                   | nazwane wyszukiwania + parametry + alerty |                                               |
| `connection_suggestion_dismissals` | kogo użytkownik ukrył w sugestiach        |                                               |

Dwie pozycje (`event_rsvps`, `resource_downloads`) to **jedna linia każda** — RPC z gotowym
zawężeniem do właściciela są już używane przez `/profile/membership`. Dwie kolejne
(`message_reactions`, `message_stars`) były nazwane w rundzie 1 i nie zostały dopisane, mimo że
sekcje czatu obok nich powstały.

**Kontrprzykład z tego samego repozytorium — wzorzec istnieje i działa.** Moduł Discussion Club
(nowy, ~10 tabel) dostał własne `club_export_my_data()` (`20260811151210`) i jest w eksporcie.
Czyli zespół wie, że nowy modul dokłada sekcję; brakuje wyłącznie mechanizmu, który to wymusi,
gdy ktoś zapomni.

🔧 **Naprawa:** (1) dopisać 9 sekcji, zaczynając od dwóch jednolinijkowych; (2) **dodać bramkę
kompletności** obok istniejącej bramki zawężenia — ta sama technika (statyczny odczyt `types.ts`

- `export.functions.ts`), z jawną listą wyłączeń i uzasadnieniem per pozycja (telemetria, treść
  redakcyjna, tabele procesowe staffu). Bez (2) lista wróci przy następnym module.

# §N3. NISKA — blokada nie wpływa na stopień oddalenia ani na liczbę wspólnych kontaktów

**Pliki:** `supabase/migrations/20260812100500_pgtap_cluster_b_fix.sql` (`connection_statuses`)
· `supabase/tests/connection_degree_test.sql`

`connection_statuses` zwraca `degree`, `mutual_count`, `bridge_*` i `can_invite`. Bramki są
rozłożone nierówno:

- `can_invite` sprawdza `p.discoverable`, równość tenanta, `is_blocked_pair` **i**
  `connections_allowed_from`;
- `bridge_*` (nazwa mostu) sprawdza `discoverable` mostu — **celowo i pod testem**;
- `degree` oraz `mutual_count` **nie sprawdzają niczego**.

Niezależność `degree` od `discoverable` jest **decyzją świadomą, zapisaną i przetestowaną**
(`connection_degree_test.sql:15–18`: „Prywatnosc mostu: nazwiemy go WYLACZNIE, gdy ma opt-in
`discoverable` … Sam DYSTANS jest od tego niezalezny - inaczej »2°« znikaloby wybiorczo”).
Nie zgłaszam jej jako defektu — sprawdziłem i jest uzasadniona.

Czego ta decyzja **nie obejmuje**, to blokady: w całym pliku testu stopnia jest **zero** odwołań
do `is_blocked_pair` / `user_blocks`. Skutek: po zablokowaniu B przez A, B nadal odczytuje swój
`degree` do A i liczbę wspólnych kontaktów. Blokada jest w tym module silniejsza niż
`discoverable = false` (zamyka DM, zaproszenie i `can_invite`), więc pominięcie jej w stopniu
wygląda na przeoczenie, nie na tę samą świadomą decyzję.

Cross-tenant nie jest problemem: `connection_request` wymaga równości tenantów
(`20260717170000_connections_v2.sql:29`), więc krawędzie grafu są intra-tenantowe z konstrukcji
i obcy tenant wychodzi jako `degree = 0`, `mutual = 0`.

🔧 **Naprawa:** albo dodać `AND NOT public.is_blocked_pair(me.uid, i.id)` do gałęzi `degree`
i `mutual_count` (spójnie z `can_invite`), albo **dopisać do nagłówka pgTAP decyzję**, że stopień
jest odporny również na blokadę — z uzasadnieniem, jak przy `discoverable`. Druga opcja jest tania
i też domyka ustalenie: problemem jest brak rozstrzygnięcia, nie sam kierunek.

# §N4. WYSOKA (blokuje CI, poza zakresem) — `check:authz-snapshot` czerwona

```
✗ src/lib/authz/authzSnapshot.generated.ts jest nieaktualny wobec supabase/migrations.
  ZMIANA UPRAWNIEŃ - do rozstrzygnięcia w code review (1):
    • bramka flagi 'pro_briefings|policy:events/events member read' doszła w migracjach
  PROVENANCE (2):
    • 'pro_briefings|fn:rsvp_event/2' pochodzi z innej migracji:
      20260721150000_events_waitlist_recordings_gate.sql -> 20260818065327_….sql
    • snapshot pochodzi ze starszego skanu migracji: migrations: 784 -> 788
```

Dotyczy modułu wydarzeń, nie profili — ale **flaga `pro_briefings` należy do rejestru capabilities
warstw członkostwa** (`src/lib/billing/capabilities.ts`, `enforced: true`, gate `events`), czyli do
zakresu „rodzaje subskrypcji”. Nowa polityka RLS `events member read` czyta tę flagę, co jest
**spójne** z rejestrem (flaga była już oznaczona jako egzekwowana) — z tego, co widzę, nie ma tu
rozjazdu obietnicy i bramki. Do zrobienia jest więc rzecz proceduralna, nie projektowa:
zatwierdzić zmianę uprawnień w review i `bun run generate:authz-snapshot` + commit.

**Waga jest wysoka nie z powodu treści, a z powodu skutku:** to blokujący krok CI
(`ci.yml`), więc dopóki jest czerwony, żadna poprawka — w tym §N1 i §N2 — nie przejdzie.

# §N5. WYSOKA (blokuje CI, poza zakresem) — bliźniacza migracja o identycznej treści

```
✗ Ta sama migracja wjechała DWA RAZY pod różnymi nazwami (identyczna treść):
    - 20260817230000_career_sections_visibility_public_read.sql
    - 20260818061944_397f082a-34ba-4c68-8a6f-71b7248c0bd7.sql
```

Moduł careers, poza zakresem tego audytu. Warto jednak zauważyć **czym ta czerwień jest**: to nie
kolizja wersji (ta klasa z rundy 1 §1 pozostaje zamknięta — zero duplikatów wersji w 788 plikach),
lecz **duplikat treści** pod dwiema nazwami. Bramka umie dziś to wykryć, czego w rundzie 1 jeszcze
nie robiła (poprzednie wydania serii `OCENA_FUNKCJI_TABELE` wprost notowały, że „nie widzi
duplikatów treści”). Rozszerzenie bramki jest więc realnym postępem, a czerwień — jej pierwszym
prawdziwym trafieniem.

Komunikat bramki podaje naprawę: zostawić plik z PR-a, usunąć wygenerowany duplikat przed
wdrożeniem; jeśli oba są już zastosowane — dopisać parę do `KNOWN_CONTENT_TWINS` z decyzją
operatora (lista może tylko maleć).

---

## 4. Kolejność naprawy

| Priorytet              | Pozycje | Uzasadnienie                                                                                                                                                                                                                                                                       |
| ---------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 — odblokować CI** | §N4     | **Po rewizji został jeden czerwony krok** (§N5 zamknięte — patrz 0.1), ale wystarcza, by nic nie wjechało na `main`. Naprawa proceduralna: zatwierdzić zmianę uprawnień w review, potem `bun run generate:authz-snapshot` i commit. Poza zakresem audytu, ale przed nim w kolejce. |
| **P1**                 | §N1     | Obejście blokady dostarczające powiadomienie. Naprawa: trzy linie SQL, symetrycznie do DM. Przy okazji jedna decyzja o pozostałych trzech kanałach.                                                                                                                                |
| **P2**                 | §N2     | Zgodność RODO. Dwie sekcje to jedna linia każda (RPC gotowe); reszta to praca prosta. **Bramka kompletności jest ważniejsza niż same sekcje** — bez niej lista odrasta.                                                                                                            |
| **P3**                 | §N3     | Rozstrzygnięcie i zapis decyzji; naprawa albo dopisek w pgTAP.                                                                                                                                                                                                                     |

## 5. Ocena kierunku (bez punktów)

Runda 1 znalazła 16 ustaleń, w tym obejście płatnego limitu, ekspozycję profili dla anonimów
i niekompletny eksport RODO. Runda 2 znajduje **3 ustalenia w zakresie, żadne krytyczne ani
wysokie**, i to na powierzchni, która w tym czasie urosła o 8,5 tys. linii i 150 migracji. To nie
jest przypadek — dwie rzeczy zadziałały:

1. **Poprawki celowały w klasę, nie w objaw.** `profiles_public` nie dostał filtra
   `discoverable`, ale pełny model ekspozycji z powodami i uczciwą notą w UI. Zapytania do eksperta
   nie zostały połatane w dwóch generacjach — zostały do jednej sprowadzone, z delegatami nazw.
2. **Ustalenia zamieniono w bramki.** 14 → 36 bramek `check:*`; pięć z nich powstało wprost
   z ustaleń rundy 1. Dlatego runda 2 nie znalazła ani jednego nawrotu §8, §9 czy §13 — bramka nie
   pozwoliłaby im wrócić.

Trzy rzeczy warto pilnować dalej, bo obie rundy pokazały tę samą mechanikę:

- **Naprawa może podnieść wagę innego ustalenia** (§7 → §N1). Przy zamykaniu ustalenia warto
  spytać, czemu nadaje skutek.
- **Bramka pilnuje dokładnie tego, co pilnuje.** `exportOwnerScope` domknął zawężenie i zostawił
  kompletność (§N2) — dwie różne właściwości tej samej funkcji.
- **pgTAP nadal nie był uruchomiony w żadnej z dwóch rund.** Trzy ustalenia (§6b rundy 1, §N3
  i częściowo §N4) dotyczą właściwości, które najlepiej dowodzi realna baza. To jedyna
  systematyczna luka w dowodzie obu audytów.
