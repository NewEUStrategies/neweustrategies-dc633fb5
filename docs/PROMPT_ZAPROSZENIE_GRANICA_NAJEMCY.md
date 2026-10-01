# ZLECENIE: Zaproszenie nie może przenieść konta z innego najemcy

> **HEAD pomiaru: `b8b53ae5` (2026-10-01).** Każda linia i każdy cytat w tym dokumencie pochodzi z tego commita.
> Commit, który wnosi ten plik, nie zmienia ani jednego pliku w `src/`, `supabase/` ani `drizzle/` - sprawdzisz to
> poleceniem `git diff --name-only b8b53ae5..HEAD -- src/ supabase/ drizzle/`, które ma nie wypisać nic. Jeżeli
> pracujesz na nowszym `main`, **przemierz przed startem** i każdą rozbieżność opisz w PR-ze, zamiast dopasowywać
> się do nieaktualnego zlecenia.
>
> **Źródło:** `docs/AUDYT_POKRYCIA_TESTAMI_MODULY_FUNKCJE_2026-08-18.md` - rozdział 16.8 (jedyny defekt krytyczny
> wydania 12; tor modułu 19, potwierdzony przez niezależnego weryfikatora i przeczytany w kodzie przez audytora),
> 16.7 (znalezisko Z2 - to jest obejście naprawy „Zaloguj jako" inną bramą) i 16.15, pozycja 1 planu naprawczego.
> W tej samej funkcji audyt ma średni defekt „wyniki zapisów `upsert` nie są sprawdzane". To zlecenie zamyka oba,
> bo naprawa pierwszego bez drugiego nie działa (A3).

---

## 0. Co się dzieje

### 0.1. Mechanizm - pięć kroków, każdy z linią

Wszystkie linie bez ścieżki dotyczą `src/lib/admin/invitations.functions.ts`.

1. **Administrator najemcy A tworzy zaproszenie na adres konta, które należy do najemcy B.** `createInvitations`
   (`:218-246`) przyjmuje dowolny poprawny adres i stempluje wiersz najemcą wołającego. Nie sprawdza, czy adres ma
   już konto ani gdzie.
2. **Wysyłka.** `sendInvitation` (`:607-613`) sprawdza tylko, czy wołający jest administratorem we własnym najemcy
   (`assertAdmin`, `:68-88`), i woła `performSend` (`:612`). Tę samą funkcję wołają `sendInvitationsBulk`
   (`:679-692`), `resendInvitationsForEmails` (`:699-738`) i `sendActivationEmailForUser` (`:620-677`). Z UI
   prowadzą do niej cztery drogi: `InviteUserDialog` (`src/components/admin/users/InviteUserDialog.tsx:173-198`),
   import zespołu z wysyłką (`TeamImportDialog.tsx:122-123`), lista zaproszeń (`src/routes/admin.users.invitations.tsx:57-58`)
   i widok konta (`src/routes/admin.users.$id.tsx:954`).
3. **Szukanie adresata po całym katalogu kont, bez najemcy.** `findAuthUserIdByEmail` (`:318-341`) przechodzi
   stronami `supabaseAdmin.auth.admin.listUsers` (`:320-324`; do 100 stron po 200, czyli 20 000 kont) i porównuje
   wyłącznie adres (`:331`). Znajduje konto z najemcy B.
4. **Zapis kluczem serwisowym, bez porównania najemców.** Między znalezieniem konta (`:345`) a zapisem (`:401`) nie
   ma ani jednego warunku na najemcę. Dalej:
   - `profiles.upsert` z `tenant_id: inv.tenant_id` i `{ onConflict: "id", ignoreDuplicates: false }` (`:401-425`)
     **przenosi profil do najemcy A** i nadpisuje trzynaście pól danymi z zaproszenia: `email`, `display_name`,
     `avatar_url`, `bio_pl`, `bio_en`, `phone`, `job_title`, `current_company`, `current_company_id`,
     `linkedin_url`, `facebook_url`, `instagram_url`, `website_url`. Pole, którego `metadata` zaproszenia nie
     niesie, dostaje `null` - z `InviteUserDialog` przychodzą tylko zdjęcie, LinkedIn, firma, stanowisko, język
     i `auto_accept` (`InviteUserDialog.tsx:181-189`), więc biografia, telefon i pozostałe linki ofiary są
     **zerowane**. Zostaje tylko `slug` (`:391-396`);
   - `author_profiles.upsert` z `tenant_id: inv.tenant_id` i wymuszonym `is_public: true` (`:435-452`);
   - `user_roles.upsert` z rolą z zaproszenia w najemcy A (`:454-459`) - formularz pozwala zaprosić także jako
     `admin` (`:212`).
5. **Mail i status.** Dla trybu `magic_link` `generateLink({ type: "invite" })` się nie udaje (konto istnieje), więc
   kod bierze `type: "magiclink"` (`:475-490`) i wysyła ofierze link logowania (`:541-553`). Zaproszenie dostaje
   status `sent` (`:564-573`), a przy pierwszym logowaniu ofiary `useAuth` sam domyka je jako `accepted`
   (`src/hooks/useAuth.tsx:329-342`, RPC `accept_my_user_invitation`). **Kroku zgody adresata nie ma nigdzie.**

### 0.2. Skutek

Konto przechodzi do najemcy A **w chwili wysyłki** - ofiara nie musi niczego klikać. Zmiana `profiles.tenant_id`
odpala wyzwalacz `profiles_repin_account_tenant`
(`supabase/migrations/20260914120000_tenant_follows_profile.sql:143-148`, funkcja w ostatniej wersji
`20260914200000_profile_graph_tenant_follows_profile.sql:39-108`), który w tej samej transakcji przepina do najemcy A
dane osoby: `push_subscriptions`, `notification_preferences`, `author_profiles`, `profile_skills`,
`profile_education`, `profile_experiences`, `profile_awards`, `profile_hobbies`, `profile_cv_files`,
`media_mentions`, `profile_skill_endorsements`, `profile_recommendations`, `profile_embeddings`. Biografia zawodowa,
CV, rekomendacje i wzmianki ofiary znikają z najemcy B i pojawiają się w A. Do tego:

- `current_tenant_id()` to `profiles.tenant_id`, a `has_role()` liczy tylko role w tym najemcy - ofiara traci dostęp
  do danych B, a jej role w B zostają uśpione (ożyją, gdy ktoś przeniesie konto z powrotem);
- wyzwalacz CRM na `profiles` wrzuca dane ofiary do CRM najemcy A, a przyjęcie zaproszenia woła
  `crm_upsert_lead_from_profile` (`20260906221501_139eb868-6762-446e-97ae-1ba4713d7d4d.sql:48`);
- **przejęcie otwiera dalsze bramy**: po przeniesieniu kontrola „ten sam najemca" przepuszcza ofiarę, więc
  super-admin najemcy A dostaje przez `startImpersonation` token logowania do jej konta
  (`src/lib/admin/impersonation.functions.ts:110`, `:122-125`, `:150`), a administrator A może konto **usunąć**
  (`src/lib/admin/accountAdmin.functions.ts:71`, `:252`);
- najemca B nie dostaje ani zgody, ani śladu: jedyny wpis audytu ma najemcę A (`:575-588`) - i, jak pokazuje 0.6,
  w praktyce nie powstaje w ogóle.

### 0.3. Druga brama do tego samego zapisu: `auth_user_id` z wiersza zaproszenia

`performSend` zaczyna od `let authUserId: string | null = inv.auth_user_id;` (`:293`) i szuka po adresie tylko wtedy,
gdy kolumna jest pusta (`:344-346`). Administrator najemcy może tę kolumnę zapisać bezpośrednio przez PostgREST:
`GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated`
(`supabase/migrations/20260715083228_b105c041-5433-4a3b-a2aa-2e7927e79891.sql:34`), polityka `invitations_admin_all`
sprawdza wyłącznie najemcę wiersza (`:40-49`), a wyzwalacz `user_invitations_pin_admin_columns` przepuszcza bez
zmian rolę serwisową i każdego z rolą `admin` albo `super_admin`
(`20260922080100_user_invitations_pin_all_non_acceptance_columns.sql:27-31`). Administrator, który zna
identyfikator konta z innego najemcy (UUID-y profili są widoczne m.in. w linkach `/people/<uuid>` - defekt 10 z 16.8),
przenosi je bez znajomości adresu. Kod panelu sam zapisuje tę kolumnę klientem użytkownika
(`sendActivationEmailForUser`, `:667`), więc kolumna wygląda na zaufaną, choć nie jest.

### 0.4. Historia

To nie jest nowy defekt, tylko rozszerzenie starego. Na HEAD wydania 11 (`7a780b1d0`) funkcja czytała jedną stronę
katalogu (`listUsers({ page: 1, perPage: 200 })`) i robiła ten sam `upsert` z `ignoreDuplicates: false` - przy
komentarzu, który obiecywał „uzupełniamy braki bez nadpisywania edycji". Przejęcie działało dla pierwszych 200 kont
katalogu; okno wydania 12 podniosło zasięg do 20 000.

### 0.5. Co w bazie na to pozwala

Wyzwalacze przypinające najemcę profilu - `profiles_pin_tenant_id` (`_bi`/`_bu`) i starszy `profiles_pin_tenant`
(`profiles_pin_tenant_tg`) - w ostatniej wersji (`20260812102500_profiles_pin_tenant_gate_visibility.sql:49-105`)
zwracają `NEW` bez warunku dla `is_service_role_caller()` albo `super_admin` (`:56-63`, `:96-101`). Trzy migracje
nazywają drogę zaproszenia wprost „legalną": `20260914090000_push_subscriptions_tenant_binding.sql:234-244`,
`20260914120000_tenant_follows_profile.sql:18-22` i `20260914160000_profile_cv_tenant_follows_profile.sql:19-23`.
Pierwsza z nich mówi też, dlaczego ochrona ma stać w bazie: „przeniesienie idzie rolą serwerową i może paść także
ręcznie z konsoli Supabase" (`:241-244`). To zlecenie bierze ten argument poważnie (A4).

### 0.6. Trzy rzeczy, które wywrócą naiwną naprawę - przeczytaj przed pierwszą zmianą

1. **Nowe konto rodzi się w najemcy DOMYŚLNYM.** `handle_new_user`
   (`20260805083149_40333a0c-3fc0-4f07-9f37-0fd0851230be.sql:40-67`, `:113-123`) nie czyta najemcy z metadanych -
   każde konto poza rejestracją `staff` powstaje w najemcy domyślnym z rolą `user`. Zaproszenie NOWEJ osoby do
   najemcy innego niż domyślny działa dziś wyłącznie dlatego, że `upsert` z `performSend` robi `UPDATE` z najemcy
   domyślnego do A. **Prosty zakaz zmiany `tenant_id` dla roli serwisowej zepsuje każde zwykłe zaproszenie**, import
   zespołu (`:923-941`) i pięć testów pgTAP (A4).
2. **Błędy zapisów są połykane - i jeden z zapisów zawsze się nie udaje.** Żaden z trzech `upsert`-ów nie czyta
   `error`. Jeśli dodasz blokadę w bazie, a nie dodasz sprawdzania błędów, baza odmówi, kod tego nie zauważy,
   zaproszenie dostanie `sent`, a ofiara link logowania. Jeśli dodasz sprawdzanie błędów, a nie poprawisz
   `user_roles`, **wywrócisz wszystkie zaproszenia**: `upsert` ma `onConflict: "user_id,role"` (`:458`, `:974`), a pas
   kanoniczny usunął `UNIQUE (user_id, role)` i zostawił tylko `user_roles_unique_per_tenant (tenant_id, user_id, role)`
   (`20260531181120_d76ba039-9c35-4128-a979-7dd406a536e1.sql:49-50`; pas drizzle tego nie zmienia). PostgreSQL odrzuca
   wtedy `ON CONFLICT (user_id, role)` błędem `42P10`. W bazie stawianej z `supabase/migrations` zaproszona osoba
   najpewniej nie dostaje dziś roli w ogóle (A3).
3. **Wpis audytu nigdy nie powstaje.** `void supabase.from("audit_log").insert({...})` (`:576`) nie wysyła żądania:
   `@supabase/postgrest-js` 2.116 wykonuje zapytanie dopiero w `then()`
   (`node_modules/@supabase/postgrest-js/dist/index.mjs:391`). Test przechodzi, bo atrapa `supabaseChain` zapisuje
   wywołanie już przy `insert` (`src/test/supabaseChain.ts:171-174`). Wpis odmowy zrobiony tym samym wzorcem też
   nigdy nie powstanie (B2).

---

## 1. Zasada naprawy - jedno zdanie

**Wysłanie zaproszenia nie może zmienić niczego w koncie, które należy do innego najemcy, a przeniesienie konta
między najemcami nie jest skutkiem ubocznym żadnej operacji panelu.**

Każda pozycja niżej wynika z tego zdania. Jeśli trafisz na sytuację, której zlecenie nie przewiduje, rozstrzygaj ją
tym zdaniem, w razie wątpliwości **odmawiaj** (fail closed), a decyzję opisz w PR-ze.

**Świadoma konsekwencja produktowa - napisz ją w PR-ze wprost:** po naprawie zaproszenie konta, które istnieje
w innym najemcy, jest odrzucane - **także konta czytelnika zarejestrowanego w najemcy domyślnym**. Jeśli organizacje
dziś „wciągają" w ten sposób czytelników NES, ta droga przestaje działać. Przeniesienie za zgodą właściciela konta
to osobny przepływ i osobne zlecenie (rozdz. 6), nie część tej naprawy.

---

## 2. Pozycje BLOKUJĄCE - bez nich PR nie zamyka defektu

### A1. Decyzja o adresacie zapada przed pierwszym zapisem

**Gdzie:** `performSend` (`:259-605`).

Wydziel rozstrzygnięcie do **czystej funkcji** (bez I/O), która dostaje to, co kod zbiera, i zwraca jeden z trzech
wyników:

```ts
export type InviteTarget =
  | { kind: "create" } // konta o tym adresie nie ma - zakładamy nowe (ścieżka bez zmian)
  | { kind: "attach"; userId: string } // konto należy do najemcy zaproszenia - odświeżamy (ścieżka bez zmian)
  | { kind: "refuse"; reason: InviteRefusalReason }; // każdy inny przypadek - nic nie zapisujemy
```

Reguły, w tej kolejności:

| Sytuacja                                                                                                                   | Wynik                          |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Błąd katalogu albo wyczerpany sufit stron (`:329`, `:340`)                                                                 | błąd jak dziś - nigdy `create` |
| Brak konta o adresie zaproszenia (po pełnym, udanym przejściu katalogu)                                                    | `create`                       |
| `inv.auth_user_id` ustawione, a konto o tym identyfikatorze nie istnieje albo ma inny adres niż `inv.email`                | `refuse`                       |
| Konto istnieje, profil istnieje, `profiles.tenant_id` = `inv.tenant_id`                                                    | `attach`                       |
| Konto istnieje, profil istnieje, `profiles.tenant_id` ≠ `inv.tenant_id`                                                    | `refuse`                       |
| Konto istnieje, profilu nie ma, `app_metadata.tenant_id` konta = `inv.tenant_id` (konto z przerwanej wysyłki tego najemcy) | `attach`                       |
| Konto istnieje, profilu nie ma, a najemcy nie da się ustalić albo jest inny                                                | `refuse`                       |

Wymagania:

- **Ani jeden zapis do konta przed decyzją.** Przy `refuse` funkcja nie dotyka `profiles`, `author_profiles`,
  `user_roles` ani `auth.users`, nie woła `createUser` ani `generateLink`, nie czyta `subscriptions` ofiary
  (`:508-515`) i **nie wysyła żadnego maila** - link logowania do cudzego konta nie może wyjść nawet do jego
  właściciela.
- **Profil czytasz kluczem serwisowym**, celowo - przez RLS cudzy wiersz jest niewidoczny i „inny najemca"
  wyglądałby jak „brak profilu". Tak samo robi naprawa Z2 (`impersonation.functions.ts:100-112`).
- **Najemcę konta bez profilu bierzesz z `app_metadata`, nigdy z `user_metadata`.** `user_metadata` ustawia sam
  rejestrujący się klient (`signUp({ options: { data } })`), więc wpisany tam najemca niczego nie poświadcza;
  `app_metadata` zapisuje wyłącznie rola serwisowa. Dziś kod wpisuje najemcę tylko do `user_metadata` (`:354`,
  `:366`) - A4 to zmienia.
- **Odmowa ma jeden kod i jeden komunikat, niezależnie od przyczyny.** Wszystkie wiersze `refuse` z tabeli dają
  w odpowiedzi do panelu ten sam kod (propozycja: `INVITATION/TARGET_UNAVAILABLE`), wzorem
  `ADMIN_ACCOUNT_ERROR` (`accountAdmin.functions.ts:22-28`, ten sam kod dla „brak" i „obcy" na `:68-73`). Przyczynę
  (`InviteRefusalReason`) zostawiasz wyłącznie w typach i testach - nie w odpowiedzi, nie w `last_error`, nie
  w audycie. Kody trzymaj w module bez importów serwerowych (propozycja: `src/lib/admin/invitationErrors.ts` -
  kody plus mapa kod → klucz i18n, wzorem `src/lib/admin/accountAdminErrors.ts:7-29`), żeby UI mogło je
  importować.
- **Odmowa nie idzie przez ogólny `catch`.** `catch` (`:597-604`) zapisuje surowy komunikat do `last_error` i oddaje
  go do UI. Odmowa ustawia `status: "failed"` i `last_error` równe kodowi wprost, a do `catch` trafiają tylko
  prawdziwe awarie. Żaden komunikat - także błąd bazy z A4 - nie może nieść identyfikatora konta ani najemcy B.
- **Miejsce decyzji: po `admin_claim_invitation_send` (`:279-291`), przed pierwszym zapisem.** Claim nie dotyka
  konta, a testy `src/lib/admin/__tests__/invitationsFunctions.test.ts:2423-2436` przypinają, że przy porażce claimu
  nie ma żadnego wywołania auth. Odmowa zużyje jedną z pięciu wysyłek tego zaproszenia - to jest akceptowalne.
  Jeśli wolisz decyzję przed claimem, opisz w PR-ze dlaczego.
- **Ścieżki `create` i `attach` mają działać dokładnie jak dziś** - ten sam mail, to samo zachowanie `sluga`
  (`:377-396`), ten sam limit wysyłek. Ponowna wysyłka do własnego użytkownika to codzienna operacja panelu;
  regresja w niej jest gorsza niż brak naprawy.
- Wolno (nie trzeba) zastąpić przechodzenie katalogu jednym wyszukaniem po adresie funkcją SQL wołaną wyłącznie
  przez rolę serwisową. Jeśli to zrobisz, zachowaj semantykę „błąd to nie brak konta" (`:325-340`) i **świadomie
  przepisz** - nie usuwaj - trzy testy, które przypinają mechanizm stron (`invitationsFunctions.test.ts:2462-2508`).

### A2. `auth_user_id` w wierszu zaproszenia nie jest dowodem tożsamości

**W kodzie:** zanim `performSend` użyje `inv.auth_user_id` (`:293`), pobiera konto po identyfikatorze
(`supabaseAdmin.auth.admin.getUserById` - wzorce: `impersonation.functions.ts:114`, `accountAdmin.functions.ts:131`)
i sprawdza, że jego adres to `inv.email` (po `trim().toLowerCase()`). Dalej decyduje reguła z A1 - identyfikator
z wiersza tylko skraca szukanie, niczego nie rozstrzyga.

**W bazie:** administrator najemcy nie może zapisać do `user_invitations.auth_user_id` identyfikatora konta, którego
profil nie należy do najemcy zaproszenia. Nowa migracja (nie edycja `20260922080100`) dokłada wyzwalacz `BEFORE INSERT
OR UPDATE` na `user_invitations`: jeśli `NEW.auth_user_id IS NOT NULL` i to jest `INSERT` albo wartość się zmienia,
musi istnieć profil `id = NEW.auth_user_id` z `tenant_id = NEW.tenant_id` - w przeciwnym razie `RAISE EXCEPTION`
ze stałym komunikatem i `ERRCODE = '42501'`. Zwolnienie dostaje **wyłącznie rola serwisowa** - nie `admin` i nie
`super_admin` (`is_super_admin()` sprawdza rolę w najemcy wołającego, więc super-admin organizacji nie jest rolą
platformową - rozdz. 16.16, pozycja 3 audytu). Sprawdź, że trzy legalne miejsca zapisu tej kolumny dalej działają:
aktualizacja statusu po wysyłce (`:564-573` - profil jest już w najemcy zaproszenia), `sendActivationEmailForUser`
(`:655-670` - profil sprawdzony w najemcy wołającego na `:625-630`) i ślad importu zespołu (`:985-998`).

### A3. Każdy zapis ma sprawdzony wynik, a `user_roles` pisze do właściwego klucza

**Gdzie:** `:401-425`, `:435-452`, `:454-459` oraz bliźniacze zapisy `provisionTeamMembers` (`:923-975`).

- Każdy z trzech zapisów destrukturyzuje `error`; błąd przerywa wysyłkę **przed** `generateLink` i `sendTxEmail`,
  zostawia zaproszenie w `failed` ze stałym kodem (propozycja: `INVITATION/WRITE_FAILED`) i wraca do UI jako
  `ok: false`. Szczegół błędu idzie do logu serwera, nie do `last_error`.
- `user_roles.upsert` dostaje `{ onConflict: "tenant_id,user_id,role", ignoreDuplicates: true }` - zgodnie
  z jedynym unikalnym indeksem (0.6, punkt 2). Zrób to **w tym samym commicie** co sprawdzanie błędów, inaczej
  każde zaproszenie zacznie padać.
- **To zmienia zachowanie produkcji i musi być w PR-ze nazwane:** rola z zaproszenia zacznie realnie powstawać,
  a wstawienie roli `author`, `admin` albo `super_admin` odpala `trg_on_expert_role_added`
  (`20260723133949_e4483549-ae52-4628-9db0-835d1706a80a.sql:59-99`), który zakłada zaakceptowane połączenia
  z autorami i administratorami najemcy. Stanu indeksu na produkcji nie znasz (pas drizzle zaczyna się od wydania
  z 2026-09 i nie niesie tej definicji) - napisz to w PR-ze jako pytanie do właściciela, nie zgaduj.
- Nie ma tu transakcji. Nie wymyślaj kompensacji, której nie potrafisz przetestować; wystarczy, że stan częściowy
  nie udaje sukcesu, a w PR-ze opiszesz, jaki stan zostaje po porażce każdego z trzech zapisów.

### A4. Baza odmawia przeniesienia profilu poza dwiema jawnymi drogami

**Cel:** zwykły `UPDATE` albo `upsert` kluczem serwisowym nie może zmienić `profiles.tenant_id` istniejącego konta.
Zostają dokładnie dwie drogi:

1. **Narodziny konta z zaproszenia.** Zmiana jest dozwolona, gdy `OLD.tenant_id` to najemca domyślny
   **wyznaczony dokładnie tak jak w `handle_new_user`** (`tenants.is_default`, potem slug `nes`; nie przez
   `email_default_tenant_id()`, która ma inny fallback), a `NEW.tenant_id` równa się `app_metadata.tenant_id` konta
   (`auth.users.raw_app_meta_data->>'tenant_id'`). Wszystkie trzy wywołania `createUser` w repozytorium (`:351`,
   `:360`, `:902` - innych w `src/` nie ma) dostają `app_metadata: { tenant_id: <najemca zaproszenia> }`; dotychczasowe
   `user_metadata` zostaw, bo może je czytać UI. Ponieważ `app_metadata` ustawia tylko rola serwisowa, konto
   czytelnika zarejestrowanego samodzielnie nie spełni tego warunku nigdy. **Znane ograniczenie:** warunek nie wie,
   czy konto było już kiedyś przenoszone - konto założone zaproszeniem z A, które operator przeniósł potem do
   najemcy domyślnego, baza wpuściłaby z powrotem do A zwykłym zapisem. Pierwszą linią obrony jest tu reguła z A1
   (profil w innym najemcy = odmowa). Jeśli chcesz domknąć to także w bazie, warunek może dodatkowo wymagać braku
   wcześniejszego wpisu `profile.tenant_moved` dla tego konta - wybór opisz w PR-ze.
2. **Jawna operacja platformowa.** Nowa funkcja `public.platform_move_profile_tenant(p_user_id uuid, p_target_tenant
uuid, p_reason text)` - `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC, anon,
authenticated`, `GRANT EXECUTE ... TO service_role` i dodatkowo `is_service_role_caller()` w środku
   (samo `is_service_role_caller()` nie wystarcza, bo ma `GRANT` także dla `authenticated`). Funkcja wymaga
   niepustego powodu, ustawia flagę lokalną dla transakcji (`set_config('app.profile_tenant_move', p_user_id::text,
true)` - wartością jest identyfikator przenoszonego konta, żeby flagi nie dało się użyć dla innego wiersza), robi
   `UPDATE`, zapisuje po jednym wpisie `audit_log` w najemcy źródłowym i docelowym (akcja np.
   `profile.tenant_moved`, `metadata` tylko z powodem) i czyści flagę. To jest droga dla operatora z konsoli (po
   `SET LOCAL ROLE service_role`) i dla testów pgTAP.

Wymagania:

- **Obie warstwy pinu dostają identyczny warunek** - `profiles_pin_tenant_id` (rzuca) i `profiles_pin_tenant`
  (cicho cofa). Rozjazd daje albo cicho cofnięty zapis bez błędu, albo lukę. Odmowa: `RAISE EXCEPTION` ze stałym
  komunikatem (np. `profile_tenant_move_forbidden`) i `ERRCODE = '42501'`, **bez identyfikatorów w treści**.
- Reguła obejmuje także `super_admin` - dzisiejsze zwolnienie (`20260812102500:56-63`) zostaje dla `INSERT`, ale nie
  dla zmiany najemcy istniejącego wiersza. **Literał `'super_admin'` musi zostać w ciele `profiles_pin_tenant_id`**,
  bo z niego generator migawki odtwarza uprawnienie (`20260812102500:57-59`).
- **Migracja w obu pasach.** Produkcję zasila migrator drizzle, który wykonuje wyłącznie wpisy
  `drizzle/migrations/meta/_journal.json` (`scripts/deploy-order-proof.sh:7-9`), a CI i pgTAP stawiają bazę wyłącznie
  z `supabase/migrations` (rozdz. 16.11 audytu). Uwaga na starsze zlecenie: `docs/PROMPT_MODUL_19_USTAWIENIA_RODO.md`
  (zasada 8) każe pisać migracje do `supabase/migrations/`, nie do `drizzle/migrations/`, bo bramki SQL widzą tylko
  pierwszy katalog. Ten powód nadal obowiązuje - dlatego migracja **musi** być w `supabase/migrations/`. Wydanie 12
  ustaliło jednak, że produkcja wykonuje wyłącznie dziennik drizzle, więc migracja musi być **także** w pasie drizzle,
  jako bliźniak z identycznym SQL i z wpisem w dzienniku. Zasada 8 zmienia się więc z „tylko supabase" na „supabase
  zawsze, drizzle zawsze obok". Potrzebujesz kompletu:
  - `supabase/migrations/<znacznik>_profile_tenant_move_guard.sql` ze znacznikiem późniejszym niż
    `20260929113000` (ostatnia migracja na HEAD pomiaru) - inaczej przyrostowy `db push` ją pominie;
  - `drizzle/migrations/0116_profile_tenant_move_guard.sql` z **identycznym SQL wykonywalnym** (bliźniak zaczyna się od
    pierwszej instrukcji, nagłówek komentarza zostaje w pasie supabase - wzorzec:
    `20260912180000_impersonation_tenant_scope.sql` i `0006_impersonation_tenant_scope.sql`);
  - wpis w `_journal.json` (`idx` 116) - **bez niego plik drizzle przejdzie bramkę parytetu, ale nie wykona się na
    produkcji**;
  - wpis `{ tag: "0116_profile_tenant_move_guard", twin: "<plik supabase>" }` na końcu `MIGRATION_LANES`
    (`src/lib/ci/migrationLaneParity.ts`, po `:686-689`);
  - rozmiar poniżej 45 KiB (`src/lib/ci/migrationSize.ts:14`). Jeśli wolisz dwie migracje (wyzwalacz zaproszeń z A2
    osobno), każda ma komplet.
- **Nagłówek nowej migracji prostuje stare komentarze.** Migracje są forward-only, więc nie edytujesz
  `20260914090000`, `20260914120000` ani `20260914160000`; nowy nagłówek mówi wprost, że droga zaproszenia przestała
  być legalnym przeniesieniem i jakie dwie drogi zostały.
- **Pięć testów pgTAP przenosi dziś profil rolą serwisową** i po tej zmianie pęknie: `push_and_digest_test.sql:245-248`,
  `profile_cv_tenant_follows_profile_test.sql:141-144`, `media_mentions_tenant_follows_profile_test.sql:65-68`,
  `author_profiles_owner_tenant_scope_test.sql:222-225`, `expert_request_single_generation_test.sql:282-284`
  i `:306-308`. Przepnij je na `platform_move_profile_tenant`, z zachowaniem ich asercji - **nie na
  `DISABLE TRIGGER`**, bo to wyłączyłoby też kaskadę, którą te testy sprawdzają. Popraw przy tym ich komentarze
  o „legalnej" drodze zaproszenia (`push_and_digest_test.sql:239-243`, `author_profiles_owner_tenant_scope_test.sql:213-215`).
- **Migawka autoryzacji.** Po redefinicji `check:authz-snapshot` (`.github/workflows/ci.yml:673`) będzie czerwony.
  Zasada serii brzmi „nie regenerujesz migawki autoryzacji, żeby zgasić czerwień" - i dalej obowiązuje: tutaj
  czerwień jest zamierzonym skutkiem zmiany bramki, a nie objawem, który chcesz ukryć. Dlatego regenerujesz ją
  (`bun run generate:authz-snapshot`) **dopiero po zamierzonej zmianie** i w PR-ze pokazujesz diff migawki wpis po
  wpisie. Oczekiwane zmiany: pole `file` wpisów `fn:profiles_pin_tenant_id/0` (dziś
  `src/lib/authz/authzSnapshot.generated.ts:51`) i ewentualnie `fn:profiles_pin_tenant/0` oraz nowe wpisy funkcji.
  Każda inna zmiana w migawce to sygnał błędu - wtedy szukasz przyczyny, a nie regenerujesz drugi raz.
- **Kolejność wdrożenia.** Droga 1 działa tylko dla kont założonych już z `app_metadata.tenant_id`. Jeśli migracja
  wejdzie przed kodem, zaproszenie nowej osoby do najemcy niedomyślnego zostanie odrzucone przez bazę (i dzięki A3
  zgłoszone jako `failed`, zamiast zgubione). Ustal z `scripts/deploy-order-proof.sh`, w jakiej kolejności idą
  migracje i kod, i opisz to w PR-ze.
- Uruchom `check:types-freshness`, `check:rpc-contract`, `check:sql-migration-replay` i `check:ownership` - nowa
  migracja ma dostać atrybucję z obiektów, których dotyka; nie dopisuj jej do `migracjeBezAtrybucjiDozwolone`
  w `governance/ownership.json`.

---

## 3. Pozycje towarzyszące

### B1. Odmowa jest zrozumiała w panelu - PL i EN

Dziś panel pokazuje surowe komunikaty: `toast.error(s.error ?? "failed")` (`InviteUserDialog.tsx:204`,
`admin.users.invitations.tsx:57-65`), surowe `last_error` pod odznaką (`admin.users.invitations.tsx:224-231`), surowe
`result.error` (`admin.users.$id.tsx:954-959`); tłumaczony jest tylko `activation_send_limit_reached`
(`admin.users.index.tsx:946-953`).

- **Jedna mapa kod → klucz** (z modułu z A1), użyta we wszystkich czterech miejscach plus w wyniku importu zespołu.
  Nieznany kod daje bezpieczny klucz ogólny, nigdy surowy tekst. Do mapy wchodzą też dwa istniejące kody:
  `activation_send_limit_reached` i `auth_directory_scan_exhausted`.
- **`InviteUserDialog` nie zamyka się po porażce.** Dziś `onDone?.(); onOpenChange(false); reset();` stoją za
  `if/else` (`:206-208`), więc administrator traci wpisane dane razem z komunikatem. Po odmowie dialog zostaje
  otwarty, a komunikat stoi pod polem adresu - wzorzec `linkedinError` (`:367-371`). Zaproszenie i tak zostaje na
  liście jako `failed`, bo `createInvitations` już je zapisało.
- **Import zespołu nie zaznacza domyślnie adresów, których nie da się zaprosić**, a po wysyłce pokazuje listę
  odrzuconych adresów zamiast samych liczników (`TeamImportDialog.tsx:64-70`, `:124-126`). Uwaga: podgląd nie wie, że
  adres należy do innego najemcy (`admin_list_users` widzi tylko własny najemca), więc nie dokładaj tam nowego
  odczytu - wystarczy wynik wysyłki.
- **Klucze i18n w `adminUsers` (`src/lib/i18n-admin-users.ts`)**, obok `accountErrOutsideTenant` (`:154-155` PL,
  `:307-308` EN). Każdy plik, który ich używa, importuje nakładkę (`check:i18n-overlay-imports`; `InviteUserDialog`
  importuje dziś tylko `@/lib/i18n-admin-team-media`, `:11`). **Prefiks `adminUsers` nie jest objęty twardą bramką
  parytetu** (`src/__tests__/i18nParity.gate.test.ts:23-24`), więc dopisz test „każdy klucz istnieje w PL i EN"
  wzorem `src/lib/admin/__tests__/accountAdminErrors.test.ts:34-46`.
- Propozycja treści (popraw, jeśli masz lepszą - ale bez nazwy organizacji, bez identyfikatora i bez
  rozróżniania przyczyn):
  - `invitationErrTargetUnavailable` - PL: „Tego adresu nie można zaprosić do Twojej organizacji. Jeśli ta osoba ma
    już konto na platformie, przeniesienie go wymaga jej zgody i udziału administratora platformy." EN: „This address
    can't be invited to your organisation. If the person already has an account on the platform, moving it requires
    their consent and a platform administrator."
  - `invitationErrWriteFailed` - PL: „Nie udało się zapisać danych konta, więc zaproszenie nie zostało wysłane.
    Spróbuj ponownie za chwilę." EN: „The account data couldn't be saved, so the invitation wasn't sent. Try again in
    a moment."
  - `invitationErrGeneric` - PL: „Nie udało się wysłać zaproszenia. Spróbuj ponownie albo skontaktuj się
    z administratorem platformy." EN: „The invitation couldn't be sent. Try again or contact a platform
    administrator."
- **Atomic design:** `src/components/admin/users/` nie ma warstw - jeśli potrzebujesz nowego komponentu (np. listy
  odrzuconych adresów), kładziesz go do `src/components/admin/molecules/` albo `atoms/` (tam stoi m.in.
  `StatusBadge.tsx`) i dokładasz mu test w tej samej zmianie.
- **Wyrocznia - świadomie i w granicach.** Każda odmowa mówi administratorowi, że adres ma konto gdzieś na
  platformie. Ta informacja jest już dziś dostępna (publiczna rejestracja: `src/lib/auth/publicAuthError.ts:10`
  → „Ten adres jest już zarejestrowany"; import zespołu: surowe „already been registered" z `createUser`), więc
  odmowa nie tworzy nowej klasy wycieku. Nie wolno jej jednak poszerzać: żadnej nazwy najemcy, żadnego
  identyfikatora, żadnego rozróżnienia między przyczynami odmowy.

### B2. Ślad audytowy, który naprawdę powstaje

- Wpis wysyłki (`:575-588`) wykonuje się z `await` (wzorzec: `src/lib/admin/membersDirectory.functions.ts:475-482`
  albo `recordAudit` z `src/lib/server/audit.server.ts:60`, do którego unii `AuditAction` (`:12-45`) dopisujesz
  nowe akcje). Błąd zapisu audytu logujesz i nie przerywasz nim wysyłki - ale zapis musi się wykonać.
- Odmowa dostaje własny wpis w najemcy **wołającego**: `entity_type: "user_invitation"`, `entity_id` = id
  zaproszenia, `metadata: { reason: <ten sam kod co w odpowiedzi> }`. **Bez identyfikatora konta ofiary, bez jej
  najemcy, bez adresu** - audyt czytają wszyscy administratorzy najemcy
  (`20260531183823_9391ad77-be2f-46a3-bd5c-3ef95da43eb7.sql:148-153`), a adres i tak stoi w wierszu zaproszenia.
- Test musi dowodzić **wykonania**, nie wywołania: rozszerz atrapę tak, żeby odnotowywała `then`, i asertuj, że
  łańcuch `audit_log` został wykonany. Sama asercja na `insert` przechodzi także dla martwego `void`.

### B3. Import zespołu: ta sama granica

- `provisionTeamMembers` czyta profile kluczem serwisowym po adresach **bez filtra najemcy** (`:1014-1020`) i wpisuje
  do `builder_data` strony najemcy A identyfikator i slug konta z najemcy B (`:1036-1039`). Dołóż
  `.eq("tenant_id", tenantId)`.
- Konto z innego najemcy kończy się tu dziś surowym błędem `createUser` w toaście (`:1002-1006`,
  `TeamImportDialog.tsx:276-283`). Zamień go na ten sam neutralny kod co w A1.
- Trzy wywołania `createUser` dostają `app_metadata.tenant_id` (A4).

### B4. Dopasowanie zaproszenia po adresie bez wzorca `ILIKE`

`sendActivationEmailForUser` szuka zaproszenia przez `.ilike("email", email)` (`:639`), a `getUserAccountStatus`
przez `.ilike("email", u.email)` (`accountAdmin.functions.ts:165`). Znaki `_` i `%` w adresie działają jak wzorzec,
więc może zostać wybrane zaproszenie innej osoby z tego samego najemcy. Zamień na `.eq` po adresie znormalizowanym
`trim().toLowerCase()` - wszystkie trzy miejsca zapisu adresu już go normalizują (`:207-210`, `:634`, `:128`).
**Nie używaj `escapeLike` z `src/lib/admin/listFilters.ts:7`** - ten helper nie escapuje znaków, tylko je usuwa, więc
`a_b@example.com` zamieniłby się w `ab@example.com`. Test: `a_b@example.com` nie dopasowuje zaproszenia
`axb@example.com`.

### B5. Komentarze, które przestaną być prawdziwe

Komentarz, który przestał być prawdziwy, jest w tej serii defektem. Popraw: nagłówek pliku (`:11-15` - „resendInvitation
... jeśli konto istnieje pomija" nie jest prawdą już dziś), komentarz przy zapisach (`:398-400`) i przy szukaniu konta
(`:296-299`), komentarz przy progu w `vitest.config.ts` (`:4979-4981`), jeśli podnosisz próg, oraz komentarze testów
pgTAP z A4.

### B6. Diagnostyka przejęć z przeszłości - tylko do odczytu

Konta przeniesione przez ten defekt nie wrócą same, a ponowne przeniesienie (`platform_move_profile_tenant`)
przepnie kaskadą dane osoby, ale nie odtworzy nadpisanych pól profilu ani nie usunie roli dodanej w A. To jest
decyzja właściciela, nie twoja. Twoje zadanie: **zapytanie dla operatora w opisie PR-a**, sprawdzone na danych
testowych. Punkt wyjścia (popraw, jeśli znajdziesz lepsze źródło):

```sql
-- Kandydaci: konto starsze niż zaproszenie, które dziś należy do najemcy zaproszenia,
-- z rolami w innych najemcach (ślad wcześniejszej przynależności).
SELECT ui.id                                                        AS invitation_id,
       ui.tenant_id                                                 AS invitation_tenant,
       ui.created_at                                                AS invited_at,
       au.id                                                        AS user_id,
       au.created_at                                                AS account_created_at,
       array_agg(DISTINCT ur.tenant_id) FILTER (WHERE ur.tenant_id <> p.tenant_id) AS other_role_tenants
FROM public.user_invitations ui
JOIN public.profiles p ON p.id = ui.auth_user_id AND p.tenant_id = ui.tenant_id
JOIN auth.users au     ON au.id = p.id
LEFT JOIN public.user_roles ur ON ur.user_id = p.id
WHERE ui.status IN ('sent', 'accepted')
  AND au.created_at < ui.created_at
  AND COALESCE(ui.source, '') NOT LIKE 'provision:%'
GROUP BY ui.id, ui.tenant_id, ui.created_at, au.id, au.created_at
ORDER BY ui.created_at;
```

Opisz znane fałszywe trafienia (np. ponowne zaproszenie konta, które zawsze było w najemcy A) i to, czego zapytanie
nie zobaczy (konta, którym ktoś później zmienił najemcę ręcznie). **Nie uruchamiaj go na produkcji i nie
przenoś nikogo z powrotem** - ani migracją, ani skryptem.

---

## 4. Testy - najpierw czerwone

Kolejność jest częścią zlecenia: najpierw test, który na HEAD pomiaru jest czerwony, potem naprawa. Jeśli test
wchodzi osobnym commitem przed naprawą, przypinasz go jako `it.fails("DEFEKT: ...")` i zdejmujesz przypięcie
w commicie z naprawą (`docs/PROMPT_REJESTR_IT_FAILS.md`, §0.6). Stan końcowy to zwykłe `it` z komentarzem
`DEFEKT NAPRAWIONY: ...`, wzorem `invitationsFunctions.test.ts:2192` i `:2452`.

### 4.1. Funkcje serwerowe - `src/lib/admin/__tests__/invitationsFunctions.test.ts`

**Atrapa wymaga rozszerzenia, inaczej testy nic nie udowodnią:**

- `supabaseAdmin.from("profiles").select().maybeSingle()` zwraca dziś `{ slug }` bez `tenant_id` (`:191-198`) - dodaj
  do stanu `h` np. `existingProfileTenant` (domyślnie `IDS.tenant`) i zwracaj `{ slug, tenant_id }`. Bez tego test
  `:2248` („KONTO, KTÓRE JUŻ MA SLUG, zachowuje go") zobaczy `undefined !== IDS.tenant` i zrobi się czerwony.
- Atrapa `select()` nie zapisuje argumentów `.eq` (`:179-190`) - zapisuj je, żeby test dowodził, że odczyt najemcy idzie
  po `id = authUserId`.
- `upsert` zawsze zwraca sukces (`:174-178`) - dodaj wstrzykiwanie błędu per tabela.
- Dodaj `getUserById` do atrapy `auth.admin` i odnotowywanie `then` dla łańcuchów (B2).
- `IDS.otherTenant` już istnieje (`:224`). Zeruj każde nowe pole w `beforeEach` (`:318-341`).

**Przypadki (nowy `describe`, np. „granica najemcy przy wysyłce zaproszenia"):**

1. Konto z innego najemcy znalezione po adresie → `ok: false` z kodem odmowy, **zero** wpisów w `h.adminWrites`,
   zero `generateLink`, zero `sendTxEmail`, zaproszenie `failed` z kodem w `last_error`, wpis audytu odmowy bez
   identyfikatora konta i najemcy B.
2. **Ta sama odpowiedź, co do znaku**, dla: profilu z innym najemcą; konta bez profilu bez `app_metadata`; konta bez
   profilu z `app_metadata` innego najemcy; `auth_user_id` z wiersza wskazującego konto o innym adresie;
   `auth_user_id` nieistniejącego konta. Wzorzec testu „identycznie": `accountAdminFunctions.test.ts:297`.
3. Regresja: konto z własnego najemcy - trzy zapisy w ustalonej kolejności (wzorzec asercji `:1133-1143`), slug
   zachowany, mail wychodzi. Konto bez profilu z `app_metadata` tego najemcy - `attach`.
4. Brak konta → `createUser` z `app_metadata.tenant_id` = najemca zaproszenia, w obu trybach.
5. Błąd zapisu `profiles`, `author_profiles` albo `user_roles` → `ok: false` z `INVITATION/WRITE_FAILED`, bez
   `generateLink` i bez maila, zaproszenie `failed`.
6. `user_roles.upsert` dostaje `{ onConflict: "tenant_id,user_id,role", ignoreDuplicates: true }` w `performSend`
   i w `provisionTeamMembers`.
7. Wpis audytu wysyłki i odmowy jest wykonany (B2).
8. `sendInvitationsBulk` z jednym adresem odrzuconym i jednym poprawnym - drugi wychodzi, wyniki w kolejności.
9. `provisionTeamMembers`: adres z innego najemcy daje neutralny kod; odczyt profili przy `autoLink` ma
   `.eq("tenant_id", ...)`.
10. `sendActivationEmailForUser`: `a_b@example.com` nie dopasowuje zaproszenia `axb@example.com` (B4).

**Ograniczenia tego pliku:**

- `check:clock-freeze`: plik ma w linii bazowej **2** literały dat (`scripts/lib/clockFreezeBaseline.ts:135`), więc
  każdy nowy literał daty zapali CI. Używaj `BASE_ISO`/`OLDER_ISO` (`:231-232`) albo `freezeClock()` z `@/test/time`.
- `check:unknown-casts`: plik nie ma wpisu w linii bazowej - zero nowych `as unknown as`.
- Adresy wyłącznie w `example.com` / `example.org` (plik sam to wymusza, `:2158-2167`).
- Nie osłabiaj istniejących testów. Test `:1246` („upsert profilu NADPISUJE, a upsert roli NIE") przypina
  dzisiejsze zachowanie dla własnego najemcy - zostaje.

### 4.2. Interfejs

`src/components/admin/users/__tests__/userDialogs.test.tsx` i testy tras (`adminUsersRoutes.test.tsx`): dialog
zostaje otwarty z komunikatem pod polem adresu (treść PL i EN przez `realT`), import zespołu pokazuje odrzucone
adresy, lista zaproszeń tłumaczy kod z `last_error`, nieznany kod daje tekst ogólny. **Zapas gałęzi w agregacie
`src/components/admin/users/**` to około jednego ramienia** (114/119 przy progu 95, `vitest.config.ts:4973-4978`) -
każde nowe `if` w UI testujesz w obie strony.

### 4.3. Baza - nowy plik pgTAP (np. `supabase/tests/profile_tenant_move_guard_test.sql`)

`plan(N)` równy liczbie asercji (`bun run scripts/check-pgtap-plan.ts`). Przypadki:

1. Rola serwisowa: `UPDATE profiles SET tenant_id` istniejącego konta do innego najemcy → `42501`.
2. To samo przez `INSERT ... ON CONFLICT (id) DO UPDATE SET tenant_id = ...` (tak wygląda `upsert`) → `42501`.
3. Narodziny konta: wstawienie do `auth.users` z `raw_app_meta_data` niosącym najemcę X (profil powstaje
   w domyślnym przez `handle_new_user`), potem `UPDATE` do X → przechodzi; do Y ≠ X → `42501`; konto bez
   `app_metadata.tenant_id` → `42501`.
4. `platform_move_profile_tenant` jako rola serwisowa → przechodzi, kaskada działa (wystarczy jedna tabela, np.
   `push_subscriptions`), powstają dwa wpisy `audit_log`; jako `authenticated` → odmowa (brak `EXECUTE`); pusty powód
   → odmowa.
5. `user_invitations`: administrator najemcy A wstawia albo zmienia `auth_user_id` na konto z najemcy B → odmowa;
   konto z A → przechodzi; rola serwisowa → przechodzi.
6. `user_roles`: `INSERT ... ON CONFLICT (tenant_id, user_id, role) DO NOTHING` przechodzi, a `ON CONFLICT (user_id,
role)` daje `42P10` - to przypina kontrakt, na którym stoi A3.

Do tego pięć istniejących testów przepiętych na funkcję platformową (A4), z niezmienionymi asercjami.

---

## 5. Czego NIE robić

- **Nie zawężaj samego szukania konta do najemcy A jako jedynej poprawki.** Adres z najemcy B trafiłby wtedy do
  `createUser`, który zwróci „already been registered", zaproszenie wylądowałoby w `failed` z surowym komunikatem,
  a brama `auth_user_id` (0.3) zostałaby otwarta. Wróciłby też problem kont bez profilu, który dzisiejsza pętla
  rozwiązuje (`:296-307`).
- **Nie bierz najemcy z `user_metadata`** - w kodzie ani w bazie.
- **Nie dodawaj zwolnienia dla `admin` ani `super_admin`** w nowych regułach zmiany najemcy i `auth_user_id`.
- **Nie wyłączaj wyzwalaczy** (`DISABLE TRIGGER`) w nowych testach ani nie przepinaj na to istniejących.
- **Nie przenoś kont z powrotem** - ani migracją, ani skryptem; diagnostyka jest tylko do odczytu (B6).
- **Nie wysyłaj maila ani linku przy odmowie** i nie dokładaj nowego maila do ofiary ani do najemcy B - to decyzja
  produktowa (rozdz. 6).
- **Nie ujawniaj w najemcy A niczego o koncie z najemcy B**: ani identyfikatora, ani najemcy, ani przyczyny odmowy -
  w odpowiedzi, w `last_error`, w toaście, w audycie i w komunikacie błędu bazy.
- **Nie zmieniaj zachowania dla kont z własnego najemcy** poza A3 (sprawdzenie błędów i klucz `user_roles`).
- **Nie edytuj istniejących migracji**, nie dopisuj migracji tylko do jednego pasa i nie zostawiaj pliku drizzle
  poza dziennikiem.
- **Nie regeneruj migawki autoryzacji ani typów na ślepo** - tylko po zamierzonej zmianie i z wyjaśnionym diffem.
- **Nie przepinaj `assertAdmin` na `requireAdmin`** w tym PR - zmieniłbyś przy okazji wymóg MFA (`aal2`) dla
  administratorów.
- **Nie ruszaj `scripts/audit/verify-edition-12.mjs`.** Jego asercja Z2 (`:171-188`) sprawdza, że dziura nadal stoi -
  po naprawie zrobi się czerwona z komunikatem „przepisać 16.7". To jest sygnał dla następnego wydania audytu, nie
  awaria; wspomnij o tym w PR-ze.

---

## 6. Do rozstrzygnięcia, nie do wykonania

- **Czy jedno konto może należeć do kilku najemców i jak wygląda przeniesienie za zgodą.** Model z jednym
  `profiles.tenant_id` na to nie pozwala; przepływ zgody właściciela konta (i ewentualnie najemcy źródłowego) to
  osobne zlecenie. Ta naprawa tylko zamyka drogę bez zgody.
- **Powiadomienie ofiary albo wpis w najemcy B przy odmowie.** Profil nie ma kolumny języka, a wpis w audycie B
  ujawniłby adminom B aktywność A. Decyzja właściciela.
- **Nadpisywanie pól profilu `null`-ami przy ponownej wysyłce do własnego użytkownika** (`:401-425`, przypięte testem
  `:1246`). Osobna decyzja o semantyce „hydratacji".
- **`provisionTeamMembers` liczy slug od nowa także dla istniejących kont** (`:929`) - ta sama klasa błędu, którą
  `performSend` już naprawił (`:377-390`). Jeśli dotkniesz tej linii, przypnij to jako `it.fails("DEFEKT: ...")`,
  nie naprawiaj po cichu.
- **Stan produkcji:** czy jest tam jeszcze `UNIQUE (user_id, role)` na `user_roles`, czy są wpisy
  `user_invitation_sent` w `audit_log`, ile kont przeniesiono. Pytania do właściciela w PR-ze.
- **Brak wymogu MFA w `assertAdmin`** (`:68-88`, w przeciwieństwie do `roleMiddleware` w
  `src/integrations/supabase/require-staff.ts`).

---

## 7. Zasady, których nie wolno złamać

1. **Nie zmieniasz zachowania produkcyjnego po to, żeby test przeszedł.** Defekt spoza tego zlecenia zapisujesz jako
   `it.fails("DEFEKT: ...")` z opisem mechanizmu. Wyjątkiem są zmiany, których to zlecenie wprost wymaga (A1-A4,
   B1-B5) - te są celem pracy.
2. **Progi wolno wyłącznie podnosić.** Nigdy nie obniżasz wartości w `vitest.config.ts` i nie wykluczasz pliku
   z pomiaru. `invitations.functions.ts` stoi na `statements 99, functions 100, lines 99, branches 96`
   (`vitest.config.ts:4982-4987`) - `functions: 100` znaczy, że każda nowa funkcja i każdy callback muszą się
   wykonać w teście. Nowy moduł kodów błędów dostaje własny próg.
3. **Nie zmieniasz `package.json` i nie commitujesz `package-lock.json`.**
4. **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.**
5. **RODO w testach:** żadnych prawdziwych danych osobowych, adresy wyłącznie w `example.com` / `example.org`,
   żadnych prawdziwych nazwisk. Ten defekt dotyczy danych osobowych wprost - fixture'y mają to odzwierciedlać.
6. **Nie usuwasz cudzych wpisów `it.fails`** bez naprawy produkcji w tym samym commicie.
7. **Nie zmieniasz istniejącej migracji**; poprawka wchodzi jako nowy plik, w obu pasach, z wpisem w dzienniku.
8. **Nie kasujesz danych**, żeby uprościć migrację albo test.

---

## 8. Standard kodu

- **i18n (PL i EN)** dla każdego napisu widocznego dla użytkownika - w nakładce, nie w kodzie;
  `check:i18n-hardcoded`, `check:i18n-default-value` i `check:i18n-overlay-imports` tego pilnują, a parytet nowych
  kluczy - twój test z B1.
- **Atomic design:** nowy komponent do właściwej warstwy (`src/components/admin/atoms` / `molecules`), z testem.
- **`tenant_id` w każdym zapytaniu kluczem serwisowym.** Bramka `serviceRoleTenantScope` nie skanuje `src/lib/admin/`
  (`src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts:76-79`), więc zielone CI nie jest tu dowodem -
  dowodem są twoje testy.
- **Zero `any`** - ani `: any`, ani `as any`; `as unknown as` podlega zapadce `check:unknown-casts`. Rzutowania
  `meta.photo as string` (`:408-422`) nie dokładaj nowych - jeśli dotykasz tych linii, czytaj wartości przez
  sprawdzenie typu.
- **Dywiz `-`, nigdy długa kreska (U+2014).** Przeszukanie twojego diffu za U+2014 ma zwracać zero trafień.
- Komentarz tłumaczy **dlaczego**, nie **co** - i jest prawdziwy (B5).

---

## 9. Kryterium odbioru

| Wymóg                                                                 | Dziś                    | Po                                                                                   |
| --------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| Zapis do konta z innego najemcy przy wysyłce zaproszenia              | tak (do 20 000 kont)    | **nie - odmowa bez zapisu**                                                          |
| Zapis po samym `auth_user_id` z wiersza zaproszenia                   | tak                     | **nie**                                                                              |
| `auth_user_id` konta z innego najemcy zapisany przez administratora   | baza przyjmuje          | **baza odmawia**                                                                     |
| Zmiana `profiles.tenant_id` zwykłym `UPDATE`/`upsert` roli serwisowej | dozwolona               | **`42501`**                                                                          |
| Legalne drogi przeniesienia                                           | każdy zapis serwisowy   | **narodziny konta z `app_metadata` + funkcja platformowa ze śladem w obu najemcach** |
| Błąd zapisu profilu, autora albo roli                                 | połykany, status `sent` | **przerywa wysyłkę, status `failed`**                                                |
| Klucz konfliktu `user_roles` zgodny z indeksem                        | nie (`42P10`)           | **tak**                                                                              |
| Wpis audytu wysyłki faktycznie zapisany                               | nie (`void`)            | **tak**                                                                              |
| Odmowa w panelu                                                       | brak (sukces)           | **jeden neutralny komunikat PL i EN**                                                |
| Testy pgTAP granicy przeniesienia                                     | 0                       | **≥ 1 plik, `plan` zgodny**                                                          |
| Progi `invitations.functions.ts`                                      | 99 / 96 / 100 / 99      | **≥ dziś**                                                                           |

Polecenia, które mają być zielone (bez `--no-verify`, bez wyłączania kroków):

```bash
bunx vitest run src/lib/admin/__tests__/invitationsFunctions.test.ts src/lib/admin/__tests__/accountAdminFunctions.test.ts \
  src/components/admin/users/__tests__/userDialogs.test.tsx src/routes/__tests__/adminUsersRoutes.test.tsx
bun run typecheck && bun run lint && bun run format:check
bun run check:ci-gates            # zawiera parytet pasów migracji i self-test planów pgTAP
bun run check:clock-freeze && bun run check:unknown-casts
bun run check:i18n-hardcoded && bun run check:i18n-default-value && bun run check:i18n-overlay-imports && bun run check:i18n-parity
bun run scripts/check-pgtap-plan.ts
bun run check:sql-owner-tenant-scope && bun run check:sql-tenant-scope && bun run check:sql-policy-tenant-regression
bun run check:sql-migration-replay && bun run check:rpc-contract && bun run check:authz-snapshot
bun run check:ownership && bun run check:types-freshness
bash scripts/pgtap-local/run.sh test profile_tenant_move_guard   # i pięć przepiętych plików
bun run test:coverage             # pełna bramka progów
```

---

## 10. Opis PR-a - ma być równy diffowi

1. **Lista plików produkcyjnych i powód każdej zmiany** - w opisie, nie w dziewiątym commicie gałęzi.
2. **Konsekwencje dla produktu:** zaproszenia kont z innych najemców (także czytelników najemcy domyślnego) są
   odrzucane; rola z zaproszenia zaczyna realnie powstawać razem z połączeniami z `trg_on_expert_role_added`; jaki
   stan zostaje po porażce każdego z zapisów (A3).
3. **Kolejność wdrożenia** migracji i kodu (A4) i jak ją sprawdziłeś.
4. **Diff migawki autoryzacji** wpis po wpisie i dlaczego każdy jest zamierzony.
5. **Zapytanie diagnostyczne z B6** z opisem fałszywych trafień i pytaniem do właściciela o decyzję.
6. **Pytania z rozdz. 6**, na które nie umiesz odpowiedzieć z repozytorium.
7. Informacja, że asercja Z2 w `scripts/audit/verify-edition-12.mjs` zrobi się czerwona i dlaczego to jest
   oczekiwane.
8. **Sekcja „czego świadomie nie zrobiłem"** - każda pominięta pozycja tego zlecenia z powodem. Trzecia możliwość
   (pominięta bez słowa) nie istnieje.
