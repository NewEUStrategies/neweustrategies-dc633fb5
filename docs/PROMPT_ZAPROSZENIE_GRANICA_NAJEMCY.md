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
> bo naprawa pierwszego bez drugiego nie działa (A3). Zlecenie przeszło przegląd trzech niezależnych recenzentów
> (wykonawca, red team, zgodność z audytem); ich poprawki są w tekście.

---

## 0. Co się dzieje

### 0.1. Mechanizm - pięć kroków, każdy z linią

Wszystkie linie bez ścieżki dotyczą `src/lib/admin/invitations.functions.ts`.

1. **Administrator najemcy A tworzy zaproszenie na adres konta, które należy do najemcy B.** `createInvitations`
   (`:218-246`) przyjmuje dowolny poprawny adres i stempluje wiersz najemcą wołającego. Nie sprawdza, czy adres ma
   już konto ani gdzie.
2. **Wysyłka.** `sendInvitation` (`:607-613`) sprawdza tylko, czy wołający jest administratorem we własnym najemcy
   (`assertAdmin`, `:68-88`), i woła `performSend` (`:612`). Tę samą funkcję wołają `sendInvitationsBulk`
   (`:679-692`), `resendInvitationsForEmails` (`:699-738`) i `sendActivationEmailForUser` (`:620-677`). Z UI prowadzi
   do niej sześć dróg: `InviteUserDialog` (`src/components/admin/users/InviteUserDialog.tsx:173-198`), import zespołu
   z wysyłką (`TeamImportDialog.tsx:122-123`), lista zaproszeń (`src/routes/admin.users.invitations.tsx:57-58`), widok
   konta (`src/routes/admin.users.$id.tsx:954`), akcja zbiorcza „ponów" (`src/routes/admin.users.index.tsx:492`)
   i aktywacja z listy kont (`admin.users.index.tsx:946-953`).
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
     i `auto_accept` (`InviteUserDialog.tsx:183-191`), więc biografia, telefon i pozostałe linki ofiary są
     **zerowane**. Zostaje tylko pole `slug` (`:391-396`);
   - `author_profiles.upsert` z `tenant_id: inv.tenant_id` i wymuszonym `is_public: true` (`:435-452`);
   - `user_roles.upsert` z rolą z zaproszenia w najemcy A (`:454-459`) - formularz pozwala zaprosić także jako
     `admin` (`:212`). Czy ten zapis dziś się udaje, zależy od indeksu na produkcji - patrz 0.6, punkt 2.
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
(`20260922080100_user_invitations_pin_all_non_acceptance_columns.sql:27-31`). Kolumna nie ma klucza obcego
(`20260715083228:20`). Administrator, który zna identyfikator konta z innego najemcy (UUID-y profili są widoczne
m.in. w linkach `/people/<uuid>` z karty wprowadzeń - defekt wysoki modułu 10 w 16.8,
`src/components/network/IntroductionsCard.tsx:93-94`), przenosi je bez znajomości adresu. Kod panelu sam zapisuje tę
kolumnę klientem użytkownika (`sendActivationEmailForUser`, `:667`), więc wygląda na zaufaną, choć nie jest. Tą samą
drogą administrator może też wpisać do zaproszenia dowolną rolę - patrz A3.

### 0.4. Historia

To nie jest nowy defekt, tylko rozszerzenie starego. Na HEAD wydania 11 (`7a780b1d0`) funkcja czytała jedną stronę
katalogu (`listUsers({ page: 1, perPage: 200 })`) i robiła ten sam `upsert` z `ignoreDuplicates: false` - przy
komentarzu, który obiecywał „uzupełniamy braki bez nadpisywania edycji". Przejęcie działało dla pierwszych 200 kont
katalogu. Zasięg do 20 000 podniosła naprawa A2 ze zlecenia modułu 19 (stronicowanie katalogu,
`invitationsFunctions.test.ts:2452`, „DEFEKT A2 NAPRAWIONY"), która zamknęła jeden defekt i jednocześnie poszerzyła
ten.

### 0.5. Co w bazie na to pozwala

Wyzwalacze przypinające najemcę profilu - `profiles_pin_tenant_id` (`_bi`/`_bu`, `SECURITY DEFINER`) i starszy
`profiles_pin_tenant` (`profiles_pin_tenant_tg`, `SECURITY INVOKER`) - w ostatniej wersji
(`20260812102500_profiles_pin_tenant_gate_visibility.sql:49-105`) zwracają `NEW` bez warunku dla
`is_service_role_caller()` albo `super_admin` (`:56-63`, `:96-101`). Trzy migracje nazywają drogę zaproszenia wprost
„legalną": `20260914090000_push_subscriptions_tenant_binding.sql:234-244`,
`20260914120000_tenant_follows_profile.sql:18-22` i `20260914160000_profile_cv_tenant_follows_profile.sql:19-23`.
Pierwsza z nich mówi też, że przeniesienie może paść ręcznie z konsoli Supabase (`:241-244`) - dlatego ochrona musi
stać w bazie, a nie tylko w kodzie (A4).

### 0.6. Cztery rzeczy, które wywrócą naiwną naprawę - przeczytaj przed pierwszą zmianą

1. **Nowe konto rodzi się w najemcy DOMYŚLNYM.** `handle_new_user`
   (`20260805083149_40333a0c-3fc0-4f07-9f37-0fd0851230be.sql:40-67`, `:113-123`) nie czyta najemcy z metadanych -
   każde konto poza rejestracją `staff` powstaje w najemcy domyślnym z rolą `user`, w tej samej transakcji co
   `createUser`. Zaproszenie NOWEJ osoby do najemcy innego niż domyślny działa dziś wyłącznie dlatego, że `upsert`
   z `performSend` robi `UPDATE` z najemcy domyślnego do A. **Prosty zakaz zmiany `tenant_id` dla roli serwisowej
   zepsuje każde zwykłe zaproszenie**, import zespołu (`:923-941`) i pięć testów pgTAP. A konto, którego pierwsza
   wysyłka się przerwała, ma profil w najemcy domyślnym, a nie „brak profilu" (A1).
2. **Błędy zapisów są połykane - i jeden z zapisów najpewniej zawsze się nie udaje.** Żaden z trzech `upsert`-ów nie
   czyta `error`. Jeśli dodasz blokadę w bazie, a nie dodasz sprawdzania błędów, baza odmówi, kod tego nie zauważy,
   zaproszenie dostanie `sent`, a ofiara link logowania. Jeśli dodasz sprawdzanie błędów, a nie poprawisz
   `user_roles`, **wywrócisz wszystkie zaproszenia**: `upsert` ma `onConflict: "user_id,role"` (`:458`, `:974`), a pas
   kanoniczny usunął `UNIQUE (user_id, role)` i zostawił tylko `user_roles_unique_per_tenant (tenant_id, user_id, role)`
   (`20260531181120_d76ba039-9c35-4128-a979-7dd406a536e1.sql:49-50`; pas drizzle tego nie zmienia). PostgreSQL odrzuca
   wtedy `ON CONFLICT (user_id, role)` błędem `42P10`.
   **To prostuje rozdział 16.8 audytu**, który pisze, że zaproszenie „dokłada rolę w najemcy zapraszającego"
   (`:455-457`). Na bazie postawionej z `supabase/migrations` roli w A NIE ma; na produkcji zależy to od indeksu,
   którego stanu repozytorium nie zna (rozdz. 6). Skutek z 0.1 punkt 4 i zapytanie z B6 traktuj więc jako warunkowe.
3. **Wpis audytu nigdy nie powstaje.** `void supabase.from("audit_log").insert({...})` (`:576`) nie wysyła żądania:
   `@supabase/postgrest-js` 2.116 wykonuje zapytanie dopiero w `then()`
   (`node_modules/@supabase/postgrest-js/dist/index.mjs:391`). Test przechodzi, bo atrapa `supabaseChain` zapisuje
   wywołanie już przy `insert` (`src/test/supabaseChain.ts:171-174`). Wpis odmowy zrobiony tym samym wzorcem też
   nigdy nie powstanie (B2).
4. **Poprawka klucza `user_roles` uruchomi eskalację uprawnień, jeśli nie sprawdzisz roli.** Kolumna
   `user_invitations.role` jest typu `app_role` bez ograniczenia (`20260715083228:15`), administrator może ją zapisać
   przez PostgREST (0.3), a `performSend` wpisuje ją kluczem serwisowym do `user_roles` (`:454-459`). Gdy zapis roli
   zacznie działać (A3), administrator wpisze sobie albo innemu kontu z najemcy `super_admin` - z pominięciem
   reguły „tylko super_admin nadaje super_admin"
   (`supabase/migrations/20260703090100_profiles_column_grants_and_role_audit.sql:207-209`) - i dostanie
   `startImpersonation` do każdego konta najemcy. Sprawdzenie roli jest więc częścią A3, nie dodatkiem.

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

**Dwa PR-y, w tej kolejności.** Pierwszy: kod (A1-A3, B1-B5) i jego testy - działa na dzisiejszej bazie i sam zamyka
przejęcie. Drugi: migracje (wyzwalacz zaproszeń z A2, odrzucanie roli `super_admin` z A3, blokada z A4), pgTAP i pięć
przepiętych testów. **Drugi scalasz dopiero po wdrożeniu pierwszego** - uzasadnienie w A4, „Kolejność wdrożenia".

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

Reguły, w tej kolejności. Wiersze `attach` są lustrem dwóch dróg, na które pozwoli baza w A4 - kod i baza mają mówić
to samo:

| Sytuacja                                                                                                                                                                                                                                                | Wynik                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| Błąd katalogu albo wyczerpany sufit stron (`:329`, `:340`), błąd odczytu profilu albo `getUserById`                                                                                                                                                     | błąd - nigdy `create` ani „brak" |
| Brak konta o adresie zaproszenia (po pełnym, udanym przejściu katalogu)                                                                                                                                                                                 | `create`                         |
| `inv.auth_user_id` ustawione, a konto o tym identyfikatorze nie istnieje albo ma inny adres niż `inv.email`                                                                                                                                             | `refuse`                         |
| Profil w najemcy zaproszenia (`profiles.tenant_id` = `inv.tenant_id`)                                                                                                                                                                                   | `attach`                         |
| Profil w najemcy domyślnym (wyznaczonym jak w `handle_new_user`: `tenants.is_default`, potem slug `nes`), a `app_metadata.tenant_id` konta = `inv.tenant_id` - konto założone zaproszeniem tego najemcy, którego pierwsza wysyłka nie dokończyła zapisu | `attach`                         |
| Profil w każdym innym najemcy                                                                                                                                                                                                                           | `refuse`                         |
| Profilu nie ma (rzadkie - np. profil usunięty ręcznie), a `app_metadata.tenant_id` konta = `inv.tenant_id`                                                                                                                                              | `attach`                         |
| Profilu nie ma w każdym innym przypadku                                                                                                                                                                                                                 | `refuse`                         |

Wymagania:

- **Ani jeden zapis do konta przed decyzją.** Przy `refuse` funkcja nie dotyka `profiles`, `author_profiles`,
  `user_roles` ani `auth.users`, nie woła `createUser` ani `generateLink`, nie czyta `subscriptions` ofiary
  (`:508-515`) i **nie wysyła żadnego maila** - link logowania do cudzego konta nie może wyjść nawet do jego
  właściciela.
- **Profil czytasz kluczem serwisowym**, celowo - przez RLS cudzy wiersz jest niewidoczny i „inny najemca"
  wyglądałby jak „brak profilu". Tak samo robi naprawa Z2 (`impersonation.functions.ts:100-112`). **Błąd tego
  odczytu jest błędem** (wzorzec: `:101-108` tamże) - chwilowa awaria bazy nie może przejść do gałęzi „profilu nie
  ma". Dzisiejszy odczyt sluga (`:391-395`) błąd pomija; nie kopiuj tego wzorca.
- **Najemcę konta bierzesz z `app_metadata`, nigdy z `user_metadata`.** `user_metadata` ustawia sam rejestrujący
  się klient (`signUp({ options: { data } })`), więc wpisany tam najemca niczego nie poświadcza; `app_metadata`
  zapisuje wyłącznie rola serwisowa. Dziś kod wpisuje najemcę tylko do `user_metadata` (`:354`, `:366`) - A4 to
  zmienia. Konsekwencja: konto założone **starym** kodem, którego wysyłka się przerwała (profil w najemcy domyślnym,
  bez `app_metadata`), dostanie `refuse`. Takie konta wypisze operatorowi zapytanie z B6; dokończyć je może funkcja
  platformowa z A4.
- Jeśli w A4 domkniesz znane ograniczenie drogi 1 warunkiem „brak wpisu `profile.tenant_moved`", ten sam warunek
  obowiązuje w piątym wierszu tabeli.
- **Odmowa ma jeden kod i jeden komunikat, niezależnie od przyczyny.** Wszystkie wiersze `refuse` dają w odpowiedzi do
  panelu ten sam kod (propozycja: `INVITATION/TARGET_UNAVAILABLE`), wzorem `ADMIN_ACCOUNT_ERROR`
  (`accountAdmin.functions.ts:22-28`, ten sam kod dla „brak" i „obcy" na `:68-73`). Przyczynę (`InviteRefusalReason`)
  zostawiasz wyłącznie w typach i testach - nie w odpowiedzi, nie w `last_error`, nie w audycie.
- **Moduł kodów:** propozycja `src/lib/admin/invitationErrors.ts` - stałe kodów plus mapa kod → klucz i18n z kluczem
  domyślnym, wzorem mapy z `src/lib/admin/accountAdminErrors.ts:7-29`, **ale odwrotnie co do zależności**: stałe
  definiujesz w `invitationErrors.ts`, a `invitations.functions.ts` importuje je stamtąd - nigdy odwrotnie.
  `accountAdminErrors.ts:5` importuje kody z modułu funkcji serwerowych, a `userDialogs.test.tsx:131` atrapuje cały
  `invitations.functions`, więc mapa zbudowana na tamtym wzorcu straciłaby w testach UI swoje kody.
- **Odmowa nie idzie przez ogólny `catch`.** `catch` (`:597-604`) zapisuje surowy komunikat do `last_error` i oddaje
  go do UI. Odmowa zapisuje **wyłącznie** `{ status: "failed", last_error: <kod> }` - nigdy `auth_user_id` (a jeśli
  `inv.auth_user_id` nie przeszło weryfikacji z A2, ustawia je na `null`). Wynik tej aktualizacji destrukturyzujesz
  i logujesz błąd - tak samo jak aktualizacji po sukcesie (`:564-573`) i w `catch` (`:599-602`), których dziś nikt nie
  sprawdza. Żaden komunikat - także błąd bazy z A4 - nie może nieść identyfikatora konta ani najemcy B.
- **Miejsce decyzji: po `admin_claim_invitation_send` (`:279-291`), przed pierwszym zapisem.** Claim nie dotyka
  konta, a testy `src/lib/admin/__tests__/invitationsFunctions.test.ts:2423-2436` przypinają, że przy porażce claimu
  nie ma żadnego wywołania auth. Odmowa zużyje jedną z pięciu wysyłek tego zaproszenia - to jest akceptowalne.
  Jeśli wolisz decyzję przed claimem, opisz w PR-ze dlaczego.
- **Ścieżki `create` i `attach` mają działać dokładnie jak dziś** - ten sam mail, to samo zachowanie pola `slug`
  (`:377-396`), ten sam limit wysyłek - z wyjątkami, których wymagają A2, A3 i B4. Ponowna wysyłka do własnego
  użytkownika to codzienna operacja panelu; regresja w niej jest gorsza niż brak naprawy.
- Wolno (nie trzeba) zastąpić przechodzenie katalogu jednym wyszukaniem po adresie funkcją SQL wołaną wyłącznie
  przez rolę serwisową. Jeśli to zrobisz, zachowaj semantykę „błąd to nie brak konta" (`:325-340`) i **świadomie
  przepisz** - nie usuwaj - testy, które przypinają mechanizm stron (`invitationsFunctions.test.ts:2462-2508`).

### A2. `auth_user_id` w wierszu zaproszenia nie jest dowodem tożsamości

**W kodzie:** zanim `performSend` użyje `inv.auth_user_id` (`:293`), pobiera konto po identyfikatorze
(`supabaseAdmin.auth.admin.getUserById` - wzorce: `impersonation.functions.ts:114`, `accountAdmin.functions.ts:131`)
i sprawdza, że jego adres to `inv.email` (po `trim().toLowerCase()`). Dalej decyduje reguła z A1 - identyfikator
z wiersza tylko skraca szukanie, niczego nie rozstrzyga.

**Świadoma zmiana dla własnego najemcy:** w `sendActivationEmailForUser` adresem zaproszenia jest `profiles.email`
(`:634`), kolumna, którą właściciel profilu edytuje sam i której nic nie synchronizuje z `auth.users.email`. Konto
z rozjechanym adresem dostanie po naprawie `refuse` - i słusznie, bo link logowania nie może pójść na adres, którego
konto nie poświadcza. Opisz to w PR-ze i przypnij testem.

**W bazie (drugi PR):** administrator najemcy nie może zapisać do `user_invitations.auth_user_id` identyfikatora
konta, którego profil nie należy do najemcy zaproszenia. Nowa migracja (nie edycja `20260922080100`) dokłada
wyzwalacz `BEFORE INSERT OR UPDATE` na `user_invitations`: jeśli `NEW.auth_user_id IS NOT NULL` i to jest `INSERT`
albo wartość się zmienia, musi istnieć profil `id = NEW.auth_user_id` z `tenant_id = NEW.tenant_id` - w przeciwnym
razie `RAISE EXCEPTION` ze stałym komunikatem i `ERRCODE = '42501'`. Ten sam błąd dla UUID nieistniejącego
i obcego - bez wyroczni. Zwolnienie dostaje **wyłącznie** rola serwisowa - nie `admin` i nie `super_admin`
(`is_super_admin()` sprawdza rolę w najemcy wołającego, więc super-admin organizacji nie jest rolą platformową -
rozdz. 16.16, pozycja 3 audytu; por. `accountAdmin.functions.ts:36-45`). **To uchyla zdanie z
`docs/PROMPT_MODUL_19_USTAWIENIA_RODO.md`, rozdz. 6, o „jawnym zwolnieniu `super_admina`" jako dopuszczalnym
odstępstwie** - po 16.16 pkt 3 takiego zwolnienia przy granicy najemcy nie ma. Sprawdź, że trzy legalne miejsca
zapisu tej kolumny dalej działają: aktualizacja statusu po wysyłce (`:564-573` - profil jest już w najemcy
zaproszenia), `sendActivationEmailForUser` (`:655-670` - profil sprawdzony w najemcy wołającego na `:625-630`)
i ślad importu zespołu (`:985-998`).

### A3. Każdy zapis ma sprawdzony wynik, `user_roles` pisze do właściwego klucza i tylko dozwoloną rolę

**Gdzie:** `:401-425`, `:435-452`, `:454-459` oraz bliźniacze zapisy `provisionTeamMembers` (`:923-975`).

- **Rola przed zapisem.** `performSend` sprawdza, że `inv.role` należy do zbioru ról zapraszalnych - dziś to
  `admin`, `editor`, `author`, `user` z `InviteItemSchema` (`:212`). Wynieś ten zbiór do jednej stałej, z której
  korzysta i schemat `zod`, i sprawdzenie. Każda inna wartość, w szczególności `super_admin`, kończy wysyłkę stałym
  kodem (propozycja: `INVITATION/ROLE_NOT_ALLOWED`) bez żadnego zapisu i bez maila (0.6, punkt 4). To samo
  sprawdzenie w `provisionTeamMembers` (rola przychodzi tam z walidatora, `:864`, ale korzysta z tej samej stałej).
  W bazie (drugi PR, ta sama migracja co wyzwalacz z A2) wyzwalacz na `user_invitations` odrzuca `role =
'super_admin'` dla każdego poza rolą serwisową.
- Każdy z trzech zapisów destrukturyzuje `error`; błąd przerywa wysyłkę **przed** `generateLink` i `sendTxEmail`,
  zostawia zaproszenie w `failed` ze stałym kodem (propozycja: `INVITATION/WRITE_FAILED`) i wraca do UI jako
  `ok: false`. Szczegół błędu idzie do logu serwera, nie do `last_error`.
- `user_roles.upsert` dostaje `{ onConflict: "tenant_id,user_id,role", ignoreDuplicates: true }` - zgodnie
  z jedynym unikalnym indeksem (0.6, punkt 2). Zrób to **w tym samym commicie** co sprawdzanie błędów, inaczej
  każde zaproszenie zacznie padać. W tym samym commicie zmieniasz drugą asercję testu `:1246`
  (`invitationsFunctions.test.ts:1255-1258`, która przypina dzisiejsze `onConflict: "user_id,role"`) na nowy
  klucz. **To zamierzona zmiana kontraktu, nie osłabienie testu** - jego pierwsza reguła („profil nadpisuje, rola
  nie") zostaje.
- **To zmienia zachowanie produkcji i musi być w PR-ze nazwane:** rola z zaproszenia zacznie realnie powstawać,
  a wstawienie roli `author`, `admin` albo `super_admin` odpala `trg_on_expert_role_added`
  (`20260723133949_e4483549-ae52-4628-9db0-835d1706a80a.sql:59-99`), który zakłada zaakceptowane połączenia
  z autorami i administratorami najemcy. Stanu indeksu na produkcji nie znasz - napisz to w PR-ze jako pytanie do
  właściciela, nie zgaduj.
- Nie ma tu transakcji. Nie wymyślaj kompensacji, której nie potrafisz przetestować; wystarczy, że stan częściowy nie
  udaje sukcesu, a w PR-ze opiszesz, jaki stan zostaje po porażce każdego z trzech zapisów. Najważniejszy z nich -
  konto założone, profil w najemcy domyślnym - obsługuje piąty wiersz tabeli z A1, więc „Spróbuj ponownie" naprawdę
  działa.

### A4. Baza odmawia przeniesienia profilu poza dwiema jawnymi drogami (drugi PR)

**Cel:** zwykły `UPDATE` albo `upsert` kluczem serwisowym nie może zmienić `profiles.tenant_id` istniejącego konta.
Zostają dokładnie dwie drogi, obie wyłącznie dla roli serwisowej:

1. **Narodziny konta z zaproszenia.** Zmiana jest dozwolona, gdy `OLD.tenant_id` to najemca domyślny
   **wyznaczony dokładnie tak jak w `handle_new_user`** (`tenants.is_default`, potem slug `nes`; nie przez
   `email_default_tenant_id()`, która ma inny fallback), a `NEW.tenant_id` równa się `app_metadata.tenant_id` konta
   (`auth.users.raw_app_meta_data->>'tenant_id'`). Wszystkie trzy wywołania `createUser` w repozytorium (`:351`,
   `:360`, `:902` - innych w `src/` nie ma) dostają **w pierwszym PR-ze** `app_metadata: { tenant_id: <najemca
zaproszenia> }`; dotychczasowe `user_metadata` zostaw, bo może je czytać UI. Ponieważ `app_metadata` ustawia
   tylko rola serwisowa, a w `src/` nic nie zmienia `app_metadata` istniejącego konta, konto czytelnika
   zarejestrowanego samodzielnie nie spełni tego warunku nigdy. **Znane ograniczenie:** warunek nie wie, czy konto było
   już kiedyś przenoszone - konto założone zaproszeniem z A, które operator przeniósł potem do najemcy domyślnego,
   baza wpuściłaby z powrotem do A zwykłym zapisem. Pierwszą linią obrony jest tu reguła z A1 (profil w innym
   najemcy = odmowa). Jeśli chcesz domknąć to także w bazie, warunek może dodatkowo wymagać braku wcześniejszego wpisu
   `profile.tenant_moved` dla tego konta - wybór opisz w PR-ze.
2. **Jawna operacja platformowa.** Nowa funkcja
   `public.platform_move_profile_tenant(p_user_id uuid, p_target_tenant uuid, p_reason text)` - `SECURITY DEFINER`,
   `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`,
   `GRANT EXECUTE ... TO service_role` i dodatkowo sprawdzenie `is_service_role_caller()` w ciele (obrona w głąb na
   wypadek, gdyby ktoś kiedyś nadał `EXECUTE` szerzej). Funkcja wymaga niepustego powodu, ustawia flagę lokalną dla
   transakcji (`set_config('app.profile_tenant_move', p_user_id::text, true)` - wartością jest identyfikator
   przenoszonego konta, żeby flagi nie dało się użyć dla innego wiersza), robi `UPDATE`, zapisuje po jednym wpisie
   `audit_log` w najemcy źródłowym i docelowym (akcja np. `profile.tenant_moved`, `metadata` tylko z powodem)
   i czyści flagę. To jest droga dla operatora z konsoli (po `SET LOCAL ROLE service_role`) i dla testów pgTAP.

Wymagania:

- **Warunek obu dróg w jednej funkcji pomocniczej `SECURITY DEFINER`** - np.
  `public.profile_tenant_move_allowed(p_profile_id uuid, p_old_tenant uuid, p_new_tenant uuid) RETURNS boolean`,
  `SET search_path = public, pg_temp`, `REVOKE ALL ... FROM PUBLIC, anon`, `GRANT EXECUTE ... TO authenticated,
service_role`. Zwraca `true` tylko wtedy, gdy `is_service_role_caller()` **i** spełniona jest droga 1 albo droga 2
  (flaga równa `p_profile_id::text`) - sama flaga niczego nie otwiera, bo `app.*` może ustawić każda sesja. Dzięki
  temu wołający `authenticated` zawsze dostaje `false`, więc funkcja nie jest też wyrocznią cudzego `app_metadata`.
- **Obie warstwy pinu wołają ją wyłącznie wewnątrz `IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id`**, nigdy
  w `DECLARE` - inaczej każda edycja profilu przez użytkownika płaciłaby za odczyt `auth.users`.
  `profiles_pin_tenant` jest `SECURITY INVOKER` (`20260812102500:44-46`, `:87-91`) i **nie może czytać `auth.users`
  bezpośrednio**: lokalny runner pgTAP nadaje `SELECT ON auth.users` rolom `authenticated` i `service_role`
  (`scripts/pgtap-local/stub.sql:155`), a w migracjach repo takiego grantu nie ma - lokalnie przejdzie, na
  produkcji może paść każde zaproszenie. Odmowa w obu warstwach: `RAISE EXCEPTION` ze stałym komunikatem (np.
  `profile_tenant_move_forbidden`) i `ERRCODE = '42501'`, **bez identyfikatorów w treści** (dziś
  `profiles_pin_tenant` cicho cofa - po zmianie też rzuca, żeby obie warstwy mówiły to samo).
- Reguła obejmuje także `super_admin` - dzisiejsze zwolnienie (`20260812102500:56-63`) zostaje dla `INSERT`, ale nie
  dla zmiany najemcy istniejącego wiersza. **W ciele `profiles_pin_tenant_id` zostaje wyrażenie
  `public.has_role(auth.uid(), 'super_admin'::public.app_role)`** (gałąź `INSERT`) - generator migawki odtwarza
  uprawnienie z tego wyrażenia (`20260812102500:57-59`, `src/lib/ci/authzGates.ts:82`); sam literał w komentarzu nie
  wystarczy.
- **Migracja w obu pasach.** Produkcję zasila migrator drizzle, który wykonuje wyłącznie wpisy
  `drizzle/migrations/meta/_journal.json` (`scripts/deploy-order-proof.sh:7-9`), a CI i pgTAP stawiają bazę wyłącznie
  z `supabase/migrations` (rozdz. 16.11 audytu). Uwaga na starsze zlecenie: `docs/PROMPT_MODUL_19_USTAWIENIA_RODO.md`
  (zasada 8) każe pisać migracje do `supabase/migrations/`, nie do `drizzle/migrations/`, bo bramki SQL widzą tylko
  pierwszy katalog. Ten powód nadal obowiązuje - dlatego migracja **musi** być w `supabase/migrations/`. Wydanie 12
  ustaliło jednak, że produkcja wykonuje wyłącznie dziennik drizzle, więc migracja musi być **także** w pasie
  drizzle. Zasada 8 zmienia się więc z „tylko supabase" na „supabase zawsze, drizzle zawsze obok". Komplet:
  - `supabase/migrations/<znacznik>_profile_tenant_move_guard.sql` ze znacznikiem późniejszym niż `20260929113000`
    (ostatnia migracja na HEAD pomiaru) - inaczej przyrostowy `db push` ją pominie;
  - `drizzle/migrations/0116_profile_tenant_move_guard.sql` z **identycznym SQL wykonywalnym** (bliźniak zaczyna się
    od pierwszej instrukcji, nagłówek komentarza zostaje w pasie supabase - wzorzec pary:
    `20260912180000_impersonation_tenant_scope.sql` i `0006_impersonation_tenant_scope.sql`);
  - wpis w `_journal.json`: `{ "idx": 116, "version": "7", "when": <ms>, "tag": "0116_profile_tenant_move_guard",
"breakpoints": true }`. **`when` musi być ściśle większe od MAKSIMUM `when` w całym dzienniku**, a nie od
    ostatniego wpisu - dziennik nie jest monotoniczny: największe `when` ma dziś idx 113 (`1790681400000`), a idx 114
    i 115 mają mniejsze. Migrator wykonuje wpis tylko wtedy, gdy jego `when` przekracza `created_at` ostatnio
    wykonanej migracji (`node_modules/drizzle-orm/pg-core/dialect.js:62`; to samo mówi
    `src/lib/ci/migrationSplitPlan.ts:19-21`). Za małe `when` = plik po cichu pominięty na produkcji przy zielonym CI.
    Komentarz w `scripts/deploy-order-proof.sh:7-9` opisuje migrator prościej („każdy wpis, którego baza jeszcze nie
    zapisała"); warunek `when` > maksimum jest bezpieczny przy obu odczytaniach, więc go nie negocjuj.
    Przy dwóch migracjach drugi wpis ma `when` jeszcze większe. Plik `meta/0116_snapshot.json` nie jest wymagany;
  - wpis `{ tag: "0116_profile_tenant_move_guard", twin: "<plik supabase>" }` na końcu `MIGRATION_LANES`
    (`src/lib/ci/migrationLaneParity.ts`, po `:686-689`);
  - rozmiar poniżej limitu `MIGRATION_MAX_BYTES` (`src/lib/ci/migrationSize.ts:40`, uzasadnienie 45 KiB na `:14`).
    Jeśli wolisz dwie migracje (wyzwalacze zaproszeń osobno), każda ma komplet.
- **SQL bezpieczny do ponownego wykonania.** Panel Lovable zapisuje ręcznie dodane migracje drugi raz, jako nowe
  wpisy dziennika z identyczną treścią (`0112` → `0114`, `0113` → `0115`; `src/lib/ci/migrationSplitPlan.ts:512`), więc
  ten sam SQL może się na produkcji wykonać dwa razy. `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` przed
  `CREATE TRIGGER`, `REVOKE`/`GRANT` bez założeń o stanie, zero wstawień danych bez warunku. Sprawdź to, wykonując
  plik dwa razy na lokalnej bazie, i napisz w PR-ze, że to zrobiłeś.
- **Nagłówek nowej migracji prostuje stare komentarze.** Migracje są forward-only, więc nie edytujesz
  `20260914090000`, `20260914120000` ani `20260914160000`; nowy nagłówek mówi wprost, że droga zaproszenia przestała
  być legalnym przeniesieniem i jakie dwie drogi zostały.
- **Pięć testów pgTAP przenosi dziś profil rolą serwisową** i po tej zmianie pęknie: `push_and_digest_test.sql:245-248`,
  `profile_cv_tenant_follows_profile_test.sql:141-144`, `media_mentions_tenant_follows_profile_test.sql:65-68`,
  `author_profiles_owner_tenant_scope_test.sql:222-225`, `expert_request_single_generation_test.sql:282-284`
  i `:306-308`. To jest komplet - pozostałe testy zmieniające najemcę idą przez `DISABLE TRIGGER USER` na
  `public.profiles` i nowa blokada ich nie dotknie. Przepnij te pięć na `platform_move_profile_tenant`, z zachowaniem
  ich asercji - **nie na `DISABLE TRIGGER`**, bo to wyłączyłoby też kaskadę, którą te testy sprawdzają. Popraw przy tym
  ich komentarze o „legalnej" drodze zaproszenia (`push_and_digest_test.sql:239-243`,
  `author_profiles_owner_tenant_scope_test.sql:213-215`).
- **Migawka autoryzacji.** Po redefinicji `check:authz-snapshot` (`.github/workflows/ci.yml:673`) będzie czerwony.
  Zasada serii brzmi „nie regenerujesz migawki autoryzacji, żeby zgasić czerwień" - i dalej obowiązuje: tutaj
  czerwień jest zamierzonym skutkiem zmiany bramki, a nie objawem, który chcesz ukryć. Dlatego regenerujesz ją
  (`bun run generate:authz-snapshot`) **dopiero po zamierzonej zmianie** i w PR-ze pokazujesz diff wpis po wpisie.
  Oczekiwane zmiany: `stats` (`migrations` +1 albo +2, `functions` o liczbę nowych i redefiniowanych funkcji,
  `policies` bez zmian) oraz pole `file` wpisu `fn:profiles_pin_tenant_id/0`
  (`src/lib/authz/authzSnapshot.generated.ts:51`), który ma zachować `anyRoles: ["super_admin"]` i `tenantRef:
"row"`. Ani `fn:profiles_pin_tenant/0`, ani nowe funkcje do migawki **nie wejdą**, bo `roleGates` są filtrowane do
  bramek opisanych w `src/lib/authz/permissionRows.ts` (`:48` opisuje tylko `fn:profiles_pin_tenant_id/0`) - nie
  dopisuj ich tam. Każda inna zmiana w `roleGates` albo `featureGates` to sygnał błędu. W PR-ze nazwij wprost, że
  `anyRoles: ["super_admin"]` znaczy po zmianie już tylko zwolnienie przy `INSERT`, a macierz `/admin/permissions`
  nadal pokaże super-admina przy bramce `tenant_pin` - to ograniczenie opisu, nie kodu.
- **Kolejność wdrożenia: KOD PRZED MIGRACJĄ.** Kod z pierwszego PR-a działa na dzisiejszej bazie. Migracja wdrożona
  przed nim trafia na stary kod, który połyka błędy: baza odrzuci przeniesienie nowej osoby, stary kod tego nie
  zauważy, zaproszenie dostanie `sent`, konto zostanie w najemcy domyślnym bez `app_metadata` - i po wdrożeniu nowego
  kodu nie da się go już przyłączyć zaproszeniem. `scripts/deploy-order-proof.sh` dowodzi wyłącznie kolejności
  migracji modułu Wydarzeń (`:37-40`) i tej kolejności nie rozstrzyga. Dlatego migracje idą drugim PR-em, scalanym
  po wdrożeniu pierwszego; w opisie PR-a zadaj właścicielowi pytanie, jak wdrożenie Lovable rozdziela kod i dziennik
  drizzle.
- Uruchom `check:rpc-contract`, `check:sql-migration-replay`, `check:ownership` i `check:types-freshness`. Nowa
  migracja ma dostać atrybucję z obiektów, których dotyka - nie dopisuj jej do `migracjeBezAtrybucjiDozwolone`
  w `governance/ownership.json`. `check:types-freshness` sprawdza kolumny; nowe funkcje nie wymagają regeneracji
  typów, dopóki nie wołasz ich z TypeScriptu (i nie wołasz - to droga dla operatora i testów).

---

## 3. Pozycje towarzyszące

### B1. Odmowa jest zrozumiała w panelu - PL i EN

Dziś panel pokazuje surowe komunikaty, a tłumaczy tylko `activation_send_limit_reached`.

- **Jedna mapa kod → klucz** (moduł z A1) w KAŻDYM miejscu, które wyświetla wynik wysyłki:
  `InviteUserDialog.tsx:204`, `admin.users.invitations.tsx:57-65` (toast) i `:224-231` (`last_error` pod odznaką),
  `admin.users.$id.tsx:954-959`, `admin.users.index.tsx:946-953` (aktywacja) i `:491-498` (akcja zbiorcza) oraz wynik
  importu zespołu. Nieznany kod daje bezpieczny klucz ogólny, nigdy surowy tekst. Do mapy wchodzą też dwa istniejące
  kody: `activation_send_limit_reached` i `auth_directory_scan_exhausted`.
- **`InviteUserDialog` nie zamyka się po porażce.** Dziś `onDone?.(); onOpenChange(false); reset();` stoją za
  `if/else` (`:206-208`), więc administrator traci wpisane dane razem z komunikatem. Po odmowie dialog zostaje otwarty,
  a komunikat stoi pod polem adresu - wzorzec `linkedinError` (`:367-371`). Zaproszenie i tak zostaje na liście jako
  `failed`, bo `createInvitations` już je zapisało. **Ponowna próba z otwartego dialogu nie może tworzyć drugiego
  wiersza zaproszenia** (każde wysłanie woła dziś `createInvitations`, `:174`): albo zablokuj przycisk do zmiany adresu,
  albo wyślij ponownie istniejące `id` - wybór opisz w PR-ze.
- **Import zespołu:** po wysyłce lista odrzuconych adresów zastępuje sam licznik `fail`
  (`TeamImportDialog.tsx:124-126`). **Domyślnego zaznaczenia w podglądzie nie zmieniaj** (`:64-70`) - podgląd nie wie,
  że adres należy do innego najemcy (`admin_list_users` widzi tylko własny najemca) i nie dokładasz tam nowego
  odczytu. Adres odrzucony raz ma już zaproszenie `failed`, więc przy następnym otwarciu nie będzie zaznaczony.
- **Klucze i18n w `adminUsers` (`src/lib/i18n-admin-users.ts`)**, obok `accountErrOutsideTenant` (`:154-155` PL,
  `:307-308` EN). Klucze z mapy idą do `t()` dynamicznie, a bramka `check:i18n-overlay-imports` widzi wyłącznie
  literały `t("klucz")` (`src/lib/ci/i18nOverlayImports.ts:204`), więc brak importu nakładki przejdzie CI i pokaże
  w UI surowy klucz. **Dodaj `import "@/lib/i18n-admin-users"` ręcznie** w `admin.users.invitations.tsx`,
  `InviteUserDialog.tsx` i `TeamImportDialog.tsx` (dziś importują ją tylko `admin.users.index.tsx`
  i `admin.users.$id.tsx`). **Prefiks `adminUsers` nie jest objęty twardą bramką parytetu**
  (`src/__tests__/i18nParity.gate.test.ts:23-24`) - dopisz test „każdy klucz istnieje w PL i EN" wzorem
  `src/lib/admin/__tests__/accountAdminErrors.test.ts:34-46`.
- Propozycja treści (popraw, jeśli masz lepszą - ale bez nazwy organizacji, bez identyfikatora i bez rozróżniania
  przyczyn odmowy):
  - `invitationErrTargetUnavailable` - PL: „Tego adresu nie można zaprosić do Twojej organizacji. Jeśli ta osoba ma
    już konto na platformie, przeniesienie go wymaga jej zgody i udziału administratora platformy." EN: „This address
    can't be invited to your organisation. If the person already has an account on the platform, moving it requires
    their consent and a platform administrator."
  - `invitationErrRoleNotAllowed` - PL: „Tej roli nie można nadać zaproszeniem. Wybierz rolę z listy." EN: „This
    role can't be granted with an invitation. Choose a role from the list."
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
  albo `recordAudit` z `src/lib/server/audit.server.ts:60`, do którego unii `AuditAction` (`:12-45`) dopisujesz nowe
  akcje). Błąd zapisu audytu logujesz i nie przerywasz nim wysyłki - ale zapis musi się wykonać.
- Odmowa dostaje własny wpis w najemcy **wołającego**: `entity_type: "user_invitation"`, `entity_id` = id zaproszenia,
  `metadata: { reason: <ten sam kod co w odpowiedzi> }`. **Bez identyfikatora konta ofiary, bez jej najemcy, bez
  adresu** - audyt czytają wszyscy administratorzy najemcy
  (`20260531183823_9391ad77-be2f-46a3-bd5c-3ef95da43eb7.sql:148-153`), a adres i tak stoi w wierszu zaproszenia.
- Test musi dowodzić **wykonania**, nie wywołania: rozszerz atrapę tak, żeby odnotowywała `then`, i asertuj, że
  łańcuch `audit_log` został wykonany. Sama asercja na `insert` przechodzi także dla martwego `void`.

### B3. Import zespołu: ta sama granica

- `provisionTeamMembers` czyta profile kluczem serwisowym po adresach **bez filtra najemcy** (`:1014-1020`) i wpisuje
  do `builder_data` strony najemcy A identyfikator i slug konta z najemcy B (`:1036-1039`). Dołóż
  `.eq("tenant_id", tenantId)`.
- Konto, którego `admin_list_users` nie widzi (z innego najemcy albo z przerwanego importu, z profilem w najemcy
  domyślnym), kończy się dziś surowym błędem `createUser` w toaście (`:1002-1006`, `TeamImportDialog.tsx:276-283`).
  Gdy `createUser` zwróci błąd „adres zajęty" - rozpoznawany po `code`/`message` pasującym do
  `/user_already_exists|email_exists|already been registered|user already registered/i`, czyli tym samym zbiorze co
  `publicAuthError.ts:10` - import odszukuje konto tak jak `performSend` i stosuje **tę samą funkcję decyzji z A1**:
  `attach` dokończy przerwany import, `refuse` daje neutralny kod. Każdy inny błąd `createUser` daje kod ogólny,
  a szczegół idzie do logu serwera.
- Trzy wywołania `createUser` dostają `app_metadata.tenant_id` (A4).

### B4. Dopasowanie zaproszenia po adresie bez wzorca `ILIKE`

`sendActivationEmailForUser` szuka zaproszenia przez `.ilike("email", email)` (`:639`), a `getUserAccountStatus`
przez `.ilike("email", u.email)` (`accountAdmin.functions.ts:165`). Znaki `_` i `%` w adresie działają jak wzorzec,
więc może zostać wybrane zaproszenie innej osoby z tego samego najemcy. Zamień na `.eq` po adresie znormalizowanym
`trim().toLowerCase()` - obecny kod normalizuje adres w każdym miejscu zapisu (`:207-210`, `:634`, `:128`).

- **Nie używaj `escapeLike` z `src/lib/admin/listFilters.ts:7`.** Ten helper nie escapuje znaków, tylko je usuwa, więc
  `a_b@example.com` zamieniłby się w `ab@example.com`. To prostuje opis z `docs/PROMPT_MODUL_19_USTAWIENIA_RODO.md`
  (A7): do wyszukiwania frazy helper może zostać, do dopasowania adresu się nie nadaje.
- Starsze wiersze z wielkimi literami przestaną być znajdowane - a indeks `user_invitations_email_idx` stoi na
  `lower(email)` (`20260715083228:31`), co sugeruje, że takie wiersze brano pod uwagę. Do pytań w PR-ze dołącz
  zapytanie tylko do odczytu `SELECT count(*) FROM public.user_invitations WHERE email <> lower(btrim(email));`.
  Jeśli wynik jest większy od zera, zmiana wymaga decyzji właściciela (normalizacja danych to osobna migracja, nie ten
  PR).
- Testy: `a_b@example.com` nie dopasowuje zaproszenia `axb@example.com` - w `invitationsFunctions.test.ts` i w
  `accountAdminFunctions.test.ts`.

### B5. Komentarze, które przestaną być prawdziwe

Komentarz, który przestał być prawdziwy, jest w tej serii defektem. Popraw: nagłówek pliku (`:11-15` -
„resendInvitation ... jeśli konto istnieje pomija" nie jest prawdą już dziś), komentarz przy zapisach (`:398-400`)
i przy szukaniu konta (`:296-299`), komentarz przy progu w `vitest.config.ts` (`:4979-4981`), jeśli podnosisz próg,
komentarz testu `:1076` („pomija warstwę auth" przestaje być prawdą po A2) oraz komentarze testów pgTAP z A4.

### B6. Diagnostyka przejęć z przeszłości - tylko do odczytu

Konta przeniesione przez ten defekt nie wrócą same, a ponowne przeniesienie (`platform_move_profile_tenant`)
przepnie kaskadą dane osoby, ale nie odtworzy nadpisanych pól profilu ani nie usunie roli dodanej w A. To jest
decyzja właściciela, nie twoja. Twoje zadanie: **dwa zapytania dla operatora w opisie PR-a**, sprawdzone na danych
testowych. Punkty wyjścia (popraw, jeśli znajdziesz lepsze źródło):

```sql
-- (1) Kandydaci na przejęcie: konto starsze niż zaproszenie, które dziś należy do najemcy zaproszenia,
--     z rolami w innych najemcach (ślad wcześniejszej przynależności). Role w A zależą od indeksu (0.6, punkt 2).
SELECT ui.id AS invitation_id, ui.tenant_id AS invitation_tenant, ui.created_at AS invited_at,
       au.id AS user_id, au.created_at AS account_created_at,
       array_agg(DISTINCT ur.tenant_id) FILTER (WHERE ur.tenant_id <> p.tenant_id) AS other_role_tenants
FROM public.user_invitations ui
JOIN public.profiles p ON p.id = ui.auth_user_id AND p.tenant_id = ui.tenant_id
JOIN auth.users au ON au.id = p.id
LEFT JOIN public.user_roles ur ON ur.user_id = p.id
WHERE ui.status IN ('sent', 'accepted')
  AND au.created_at < ui.created_at
  AND COALESCE(ui.source, '') NOT LIKE 'provision:%'
GROUP BY ui.id, ui.tenant_id, ui.created_at, au.id, au.created_at
ORDER BY ui.created_at;

-- (2) Konta założone zaproszeniem STARYM kodem, których profil został w najemcy domyślnym
--     (bez app_metadata.tenant_id, więc A1 je odrzuci) - do dokończenia funkcją platformową po decyzji.
SELECT ui.id AS invitation_id, ui.tenant_id AS invitation_tenant, ui.status, au.id AS user_id
FROM public.user_invitations ui
JOIN auth.users au ON lower(au.email) = lower(btrim(ui.email))
JOIN public.profiles p ON p.id = au.id
WHERE p.tenant_id = COALESCE((SELECT id FROM public.tenants WHERE is_default LIMIT 1),
                             (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1))
  AND ui.tenant_id <> p.tenant_id
  AND au.created_at >= ui.created_at
  AND au.raw_app_meta_data ->> 'tenant_id' IS NULL;
```

Opisz znane fałszywe trafienia (np. ponowne zaproszenie konta, które zawsze było w najemcy A) i to, czego zapytania
nie zobaczą (konta, którym ktoś później zmienił najemcę ręcznie). **Nie uruchamiaj ich na produkcji i nie przenoś
nikogo z powrotem** - ani migracją, ani skryptem.

---

## 4. Testy - najpierw czerwone

Kolejność jest częścią zlecenia: najpierw test, który na HEAD pomiaru jest czerwony, potem naprawa. Jeśli test wchodzi
osobnym commitem przed naprawą, przypinasz go jako `it.fails("DEFEKT: ...")` i zdejmujesz przypięcie w commicie
z naprawą (`docs/PROMPT_REJESTR_IT_FAILS.md`, §0.6). Stan końcowy to zwykłe `it` z komentarzem
`DEFEKT NAPRAWIONY: ...`, wzorem `invitationsFunctions.test.ts:2192` i `:2452`.

### 4.1. Funkcje serwerowe - `src/lib/admin/__tests__/invitationsFunctions.test.ts`

**Atrapa wymaga rozszerzenia, inaczej testy nic nie udowodnią - albo pękną nie te:**

- `supabaseAdmin.from("profiles").select().maybeSingle()` zwraca dziś `{ slug }` **wyłącznie wtedy**, gdy ustawiono
  `h.existingProfileSlug`, a w każdym innym teście `null`, czyli „brak profilu" (`:193-200`; pole w stanie `h`,
  `:114`). Po A1 „brak profilu" bez `app_metadata` daje `refuse`. Zmień atrapę tak, żeby **domyślnie** zwracała profil
  `{ slug: h.existingProfileSlug, tenant_id: h.existingProfileTenant }` z `existingProfileTenant = IDS.tenant`,
  a brak profilu modelowała jawną flagą (np. `h.existingProfileMissing`). Bez tego czerwone będą testy kont
  istniejących oczekujące sukcesu - m.in. `:1076`, `:1282`, `:2410`, `:2437`, `:2462` - i nie wolno ich osłabiać;
  popraw atrapę.
- `listUsers` (`:127`) i nowa atrapa `getUserById` oddają `app_metadata`. Test `:1076` przypina, że ponowna wysyłka
  „pomija warstwę auth" (`:1081`: każde wywołanie auth inne niż `link:*` to czerwień). Po A2 wysyłka woła
  `getUserById` - albo atrapa nie zapisuje go do `h.authCalls`, albo świadomie przepisujesz `:1076` i jego komentarz
  (B5). Wybór opisz.
- Atrapa `select()` nie zapisuje argumentów `.eq` (`:179-192`) - zapisuj je, żeby test dowodził, że odczyt najemcy idzie
  po `id = authUserId`.
- `upsert` zawsze zwraca sukces (`:175-178`) - dodaj wstrzykiwanie błędu per tabela.
- Odnotowuj `then` łańcuchów (B2). `IDS.otherTenant` już istnieje (`:237`). Każde nowe pole zeruj w `beforeEach`
  (`:341-363`).

**Przypadki (nowy `describe`, np. „granica najemcy przy wysyłce zaproszenia"):**

1. Konto z innego najemcy znalezione po adresie → `ok: false` z kodem odmowy, **zero** wpisów w `h.adminWrites`,
   zero `generateLink`, zero `sendTxEmail`, zaproszenie `failed` z kodem w `last_error` i **bez** `auth_user_id`
   ofiary w aktualizacji, wpis audytu odmowy bez identyfikatora konta i najemcy B.
2. **Ta sama odpowiedź, co do znaku**, dla: profilu w innym najemcy; profilu w najemcy domyślnym bez `app_metadata`;
   profilu w najemcy domyślnym z `app_metadata` innego najemcy; konta bez profilu bez `app_metadata`;
   `auth_user_id` z wiersza wskazującego konto o innym adresie; `auth_user_id` nieistniejącego konta. Wzorzec testu
   „identycznie": `accountAdminFunctions.test.ts:297`.
3. Regresja: konto z własnego najemcy - trzy zapisy w ustalonej kolejności (wzorzec asercji `:1133-1143`), slug
   zachowany, mail wychodzi.
4. **Ponowienie po przerwanej wysyłce:** `createUser` przeszedł, `upsert` profilu zwrócił błąd → `INVITATION/WRITE_FAILED`;
   następna wysyłka tego samego zaproszenia (profil w najemcy domyślnym, `app_metadata` tego najemcy) → `attach`,
   przeniesienie do A i mail.
5. Brak konta → `createUser` z `app_metadata.tenant_id` = najemca zaproszenia, w obu trybach.
6. Błąd zapisu `profiles`, `author_profiles` albo `user_roles` → `ok: false` z `INVITATION/WRITE_FAILED`, bez
   `generateLink` i bez maila, zaproszenie `failed`.
7. Błąd odczytu profilu albo `getUserById` → błąd, zero zapisów, zero `generateLink` (fail closed).
8. `user_roles.upsert` dostaje `{ onConflict: "tenant_id,user_id,role", ignoreDuplicates: true }` w `performSend`
   i w `provisionTeamMembers` (w tym przepisana asercja `:1255-1258`).
9. Wiersz zaproszenia z `role: "super_admin"` (albo inną spoza zbioru) → `INVITATION/ROLE_NOT_ALLOWED`, zero zapisów,
   zero maili.
10. Wpis audytu wysyłki i odmowy jest wykonany (B2).
11. `sendInvitationsBulk` z jednym adresem odrzuconym i jednym poprawnym - drugi wychodzi, wyniki w kolejności.
12. `provisionTeamMembers`: adres z innego najemcy daje neutralny kod; przerwany import (konto z profilem w najemcy
    domyślnym i `app_metadata` tego najemcy) dokańcza się; odczyt profili przy `autoLink` ma `.eq("tenant_id", ...)`.
13. `sendActivationEmailForUser`: `a_b@example.com` nie dopasowuje zaproszenia `axb@example.com` (B4); rozjazd
    `profiles.email` z adresem w `auth.users` → `refuse` (A2).
14. **Łańcuch Z2 - test z 16.15 pkt 1 audytu:** po odrzuconym zaproszeniu konta z najemcy B jego profil ma dalej
    najemcę B, a `startImpersonation` super-admina A na to konto kończy się
    `Forbidden: target user is outside your tenant` (`impersonation.functions.ts:111`). Część z impersonacją możesz
    postawić w `src/lib/admin/__tests__/impersonationFunctions.test.ts`.

**Ograniczenia tego pliku:**

- `check:clock-freeze`: plik ma w linii bazowej **2** literały dat (`scripts/lib/clockFreezeBaseline.ts:135`), więc
  każdy nowy literał daty zapali CI. Używaj `BASE_ISO`/`OLDER_ISO` (`:244-245`) albo `freezeClock()` z `@/test/time`.
- `check:unknown-casts`: plik nie ma wpisu w linii bazowej - zero nowych `as unknown as`.
- Adresy wyłącznie w `example.com` / `example.org` - plik sam to sprawdza (`describe` od `:2158`).
- Nie osłabiaj istniejących testów. Test `:1246` zostaje jako przypięcie reguły „profil nadpisuje, rola nie" -
  zmieniasz wyłącznie jego asercję klucza konfliktu (A3).

### 4.2. Interfejs

`src/components/admin/users/__tests__/userDialogs.test.tsx` i testy tras (`adminUsersRoutes.test.tsx`): dialog
zostaje otwarty z komunikatem pod polem adresu, ponowna próba nie tworzy drugiego zaproszenia, import zespołu
pokazuje odrzucone adresy, lista zaproszeń i obie akcje z `admin.users.index.tsx` tłumaczą kod, nieznany kod daje
tekst ogólny. `userDialogs.test.tsx` atrapuje `react-i18next` stubem (`:102`), więc test, że na ekranie stoi treść,
a nie klucz, piszesz z `@/test/i18nReal` w osobnym `describe` albo pliku bez stubu. **Zapas gałęzi w agregacie
`src/components/admin/users/**` to około jednego ramienia** (114/119 przy progu 95, `vitest.config.ts:4973-4978`) -
każde nowe `if` w UI testujesz w obie strony.

### 4.3. Baza - nowy plik pgTAP (np. `supabase/tests/profile_tenant_move_guard_test.sql`), drugi PR

`plan(N)` równy liczbie asercji (`bun run scripts/check-pgtap-plan.ts`). Adresy w fixture'ach wyłącznie
`example.com` / `example.org`.

**Fixture'y:** stan wyzwalaczy wycieka w tym zestawie między plikami - `on_auth_user_created` bywa wyłączony
(`supabase/tests/job_scheduler_heartbeat_test.sql:247-254`). Dlatego: konta zakładasz przez
`INSERT INTO auth.users (id, email, raw_app_meta_data)` (wzorzec `signup_provisioning_test.sql:102`), profil w najemcy
domyślnym zabezpieczasz `INSERT ... ON CONFLICT (id) DO NOTHING` (wzorzec `job_scheduler_heartbeat_test.sql:255-260`),
a na początku pliku asertujesz, że wyzwalacze `public.profiles` z A4 są włączone (`pg_trigger.tgenabled`) - inaczej
każde `throws_ok` przejdzie na pusto. Zakaz `DISABLE TRIGGER` z rozdz. 5 dotyczy wyzwalaczy `public.profiles` (pin
i kaskada).

**Przypadki:**

1. Rola serwisowa: `UPDATE profiles SET tenant_id` istniejącego konta do innego najemcy → `42501`.
2. To samo przez `INSERT ... ON CONFLICT (id) DO UPDATE SET tenant_id = ...` (tak wygląda `upsert`) → `42501`.
3. Narodziny konta: konto z `raw_app_meta_data` niosącym najemcę X i profilem w najemcy domyślnym (asercja, że profil
   tam jest, przed `UPDATE`); `UPDATE` do X jako rola serwisowa → przechodzi; do Y ≠ X → `42501`; konto bez
   `app_metadata.tenant_id` → `42501`. Ten sam `UPDATE` jako `authenticated` (właściciel wiersza) → `42501`.
4. Flaga bez roli: `SET LOCAL app.profile_tenant_move = '<id>'` jako `authenticated`, potem `UPDATE` → `42501`.
5. `platform_move_profile_tenant` jako rola serwisowa → przechodzi, kaskada działa (wystarczy jedna tabela, np.
   `push_subscriptions`), powstają dwa wpisy `audit_log`; jako `authenticated` → odmowa (brak `EXECUTE`); pusty powód
   → odmowa.
6. Zwykła edycja własnego profilu (`UPDATE ... SET display_name`) jako `authenticated` po migracji → przechodzi;
   funkcja pomocnicza ma `prosecdef = true`.
7. `user_invitations`: administrator najemcy A wstawia albo zmienia `auth_user_id` na konto z najemcy B → odmowa;
   konto z A → przechodzi; rola serwisowa → przechodzi. Administrator wstawia albo zmienia `role` na `super_admin` →
   odmowa.
8. `user_roles`: `INSERT ... ON CONFLICT (tenant_id, user_id, role) DO NOTHING` przechodzi, a
   `ON CONFLICT (user_id, role) DO NOTHING` daje `42P10` - to przypina kontrakt, na którym stoi A3.

Do tego pięć istniejących testów przepiętych na funkcję platformową (A4), z niezmienionymi asercjami.

---

## 5. Czego NIE robić

- **Nie zawężaj samego szukania konta do najemcy A jako jedynej poprawki.** Adres z najemcy B trafiłby wtedy do
  `createUser`, który zwróci „already been registered", zaproszenie wylądowałoby w `failed` z surowym komunikatem,
  a brama `auth_user_id` (0.3) zostałaby otwarta. Wróciłby też problem kont, które dzisiejsza pętla znajduje
  (`:296-307`).
- **Nie bierz najemcy z `user_metadata`** - w kodzie ani w bazie.
- **Nie dodawaj zwolnienia dla `admin` ani `super_admin`** w nowych regułach zmiany najemcy, `auth_user_id` i roli.
- **Nie wyłączaj wyzwalaczy `public.profiles`** (`DISABLE TRIGGER`) w nowych testach ani nie przepinaj na to
  istniejących.
- **Nie przenoś kont z powrotem** - ani migracją, ani skryptem; diagnostyka jest tylko do odczytu (B6).
- **Nie wysyłaj maila ani linku przy odmowie** i nie dokładaj nowego maila do ofiary ani do najemcy B - to decyzja
  produktowa (rozdz. 6).
- **Nie ujawniaj w najemcy A niczego o koncie z najemcy B**: ani identyfikatora, ani najemcy, ani przyczyny odmowy -
  w odpowiedzi, w `last_error`, w toaście, w audycie i w komunikacie błędu bazy.
- **Nie zmieniaj zachowania dla kont z własnego najemcy** poza tym, czego wymagają A2, A3 i B4.
- **Nie scalaj migracji przed wdrożeniem kodu** (A4, „Kolejność wdrożenia").
- **Nie edytuj istniejących migracji**, nie dopisuj migracji tylko do jednego pasa i nie zostawiaj pliku drizzle poza
  dziennikiem albo z za małym `when`.
- **Nie regeneruj migawki autoryzacji ani typów na ślepo** - tylko po zamierzonej zmianie i z wyjaśnionym diffem.
- **Nie przepinaj `assertAdmin` na `requireAdmin`** w tym PR - zmieniłbyś przy okazji wymóg MFA (`aal2`) dla
  administratorów.
- **Nie ruszaj `scripts/audit/verify-edition-12.mjs`.** Jego asercja Z2 (`:203-220`) szuka wzorca tekstowego przed
  `profiles.upsert`, nie zachowania - zależnie od tego, gdzie postawisz decyzję, zrobi się czerwona albo zostanie
  zielona. Uruchom go i podaj wynik w PR-ze; w obu przypadkach to materiał dla następnego wydania audytu.

---

## 6. Do rozstrzygnięcia, nie do wykonania

- **Czy jedno konto może należeć do kilku najemców i jak wygląda przeniesienie za zgodą.** Model z jednym
  `profiles.tenant_id` na to nie pozwala; przepływ zgody właściciela konta (i ewentualnie najemcy źródłowego) to
  osobne zlecenie. Ta naprawa tylko zamyka drogę bez zgody.
- **Powiadomienie ofiary albo wpis w najemcy B przy odmowie.** Profil nie ma kolumny języka, a wpis w audycie B
  ujawniłby administratorom B aktywność A. Decyzja właściciela.
- **Nadpisywanie pól profilu `null`-ami przy ponownej wysyłce do własnego użytkownika** (`:401-425`, przypięte testem
  `:1246`). Osobna decyzja o semantyce „hydratacji".
- **`metadata.company_id` z innego najemcy trafia do profilu** (`:418`): `metadata` to dowolny rekord
  (`z.record(z.unknown())`, `:215`), wyzwalacz pilnujący firmy z najemcy wiersza przepuszcza zapis klucza serwisowego,
  a `_trg_profile_to_crm` przenosi wartość do CRM najemcy A. Jeśli tego nie naprawiasz (warunek:
  `crm_companies.id = company_id AND tenant_id = inv.tenant_id`, inaczej `null`), przypnij
  `it.fails("DEFEKT: company_id z innego najemcy trafia do profilu")`.
- **Import zespołu opiera tożsamość na `profiles.email`**, który właściciel profilu edytuje sam (`:886-898`,
  `:1014-1023`) - członek najemcy, który wpisze sobie cudzy adres z widgetu, dostanie przy imporcie jego dane i rolę.
  To nie jest granica najemcy, ale leży w kodzie z B3; jeśli tego nie naprawiasz (dopasowanie po adresie
  z `auth.users`), przypnij `it.fails` z opisem mechanizmu.
- **`provisionTeamMembers` liczy slug od nowa także dla istniejących kont** (`:929`) - ta sama klasa błędu, którą
  `performSend` już naprawił (`:377-390`). Jeśli dotkniesz tej linii, przypnij to jako `it.fails("DEFEKT: ...")`.
- **Stan produkcji:** czy jest tam jeszcze `UNIQUE (user_id, role)` na `user_roles`, czy są wpisy
  `user_invitation_sent` w `audit_log`, ile kont przeniesiono, ile jest wierszy zaproszeń z wielkimi literami. Pytania
  do właściciela w PR-ze.
- **Brak wymogu MFA w `assertAdmin`** (`:68-88`, w przeciwieństwie do `roleMiddleware` w
  `src/integrations/supabase/require-staff.ts`).

---

## 7. Zasady, których nie wolno złamać

1. **Nie zmieniasz zachowania produkcyjnego po to, żeby test przeszedł.** Defekt spoza tego zlecenia zapisujesz jako
   `it.fails("DEFEKT: ...")` z opisem mechanizmu. Wyjątkiem są zmiany, których to zlecenie wprost wymaga (A1-A4,
   B1-B5) - te są celem pracy.
2. **Progi wolno wyłącznie podnosić.** Nigdy nie obniżasz wartości w `vitest.config.ts` i nie wykluczasz pliku
   z pomiaru. `invitations.functions.ts` stoi na `statements: 99`, `functions: 100`, `lines: 99`, `branches: 96`
   (`vitest.config.ts:4982-4987`) - `functions: 100` znaczy, że każda nowa funkcja i każdy callback muszą się wykonać
   w teście. Nowy moduł kodów błędów dostaje własny próg.
3. **Nie zmieniasz `package.json` i nie commitujesz `package-lock.json`.**
4. **Żaden test nie wychodzi do sieci i nie zawiera prawdziwego sekretu.**
5. **RODO w testach:** żadnych prawdziwych danych osobowych, adresy wyłącznie w `example.com` / `example.org`, żadnych
   prawdziwych nazwisk. Ten defekt dotyczy danych osobowych wprost - fixture'y mają to odzwierciedlać.
6. **Nie usuwasz cudzych wpisów `it.fails`** bez naprawy produkcji w tym samym commicie.
7. **Nie zmieniasz istniejącej migracji**; poprawka wchodzi jako nowy plik, w obu pasach, z wpisem w dzienniku.
8. **Nie kasujesz danych**, żeby uprościć migrację albo test.

---

## 8. Standard kodu

- **i18n (PL i EN)** dla każdego napisu widocznego dla użytkownika - w nakładce, nie w kodzie;
  `check:i18n-hardcoded` i `check:i18n-default-value` tego pilnują, import nakładki dla kluczy dynamicznych dodajesz
  ręcznie (B1), a parytet nowych kluczy dowodzi twój test z B1.
- **Atomic design:** nowy komponent do właściwej warstwy (`src/components/admin/atoms` / `molecules`), z testem.
- **`tenant_id` w każdym zapytaniu kluczem serwisowym.** Bramka `serviceRoleTenantScope` nie skanuje `src/lib/admin/`
  (`src/lib/server/__tests__/serviceRoleTenantScope.gate.test.ts:78-82`), więc zielone CI nie jest tu dowodem -
  dowodem są twoje testy.
- **Zero `any`** - ani `: any`, ani `as any`; `as unknown as` podlega zapadce `check:unknown-casts`. Rzutowań
  `meta.photo as string` (`:408-422`) nie dokładaj - jeśli dotykasz tych linii, czytaj wartości przez sprawdzenie
  typu.
- **Dywiz `-`, nigdy półpauza ani pauza (U+2013, U+2014).** Przeszukanie twojego diffu za oboma znakami ma zwracać
  zero trafień.
- Komentarz tłumaczy **dlaczego**, nie **co** - i jest prawdziwy (B5).

---

## 9. Kryterium odbioru

| Wymóg                                                                        | Dziś                            | Po                                                                                   |
| ---------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| Zapis do konta z innego najemcy przy wysyłce zaproszenia                     | tak (do 20 000 kont)            | **nie - odmowa bez zapisu**                                                          |
| Zapis po samym `auth_user_id` z wiersza zaproszenia                          | tak                             | **nie**                                                                              |
| Impersonacja konta z innego najemcy po próbie zaproszenia                    | możliwa po przejęciu            | **odmowa (test 4.1/14)**                                                             |
| Rola spoza zbioru zapraszalnego (np. `super_admin`) z wiersza zaproszenia    | zapisywana kluczem serwisowym   | **odmowa w kodzie i w bazie**                                                        |
| `auth_user_id` konta z innego najemcy zapisany przez administratora          | baza przyjmuje                  | **baza odmawia**                                                                     |
| Zmiana `profiles.tenant_id` zwykłym `UPDATE`/`upsert` roli serwisowej        | dozwolona                       | **`42501`**                                                                          |
| Legalne drogi przeniesienia                                                  | każdy zapis serwisowy           | **narodziny konta z `app_metadata` + funkcja platformowa ze śladem w obu najemcach** |
| Ponowienie po przerwanej wysyłce                                             | -                               | **`attach`, konto trafia do najemcy zaproszenia**                                    |
| Błąd zapisu profilu, autora albo roli                                        | połykany, status `sent`         | **przerywa wysyłkę, status `failed`**                                                |
| Klucz konfliktu `user_roles` zgodny z indeksem                               | nie (`42P10`)                   | **tak**                                                                              |
| Wpis audytu wysyłki i odmowy faktycznie zapisany                             | nie (`void`)                    | **tak, odmowa bez danych najemcy B**                                                 |
| Odmowa w panelu (6 miejsc)                                                   | brak (sukces) albo surowy tekst | **jeden neutralny komunikat PL i EN, dialog zostaje otwarty**                        |
| Odczyt profili przy `autoLink` importu zawężony do najemcy                   | nie                             | **tak**                                                                              |
| Dopasowanie zaproszenia po adresie (dwa miejsca)                             | `ilike`                         | **`eq` na adresie znormalizowanym**                                                  |
| Migracja w dzienniku drizzle                                                 | -                               | **wpis z `when` > maksimum dziennika**                                               |
| Testy pgTAP granicy przeniesienia                                            | 0                               | **≥ 1 plik, `plan` zgodny**                                                          |
| Progi `invitations.functions.ts` (statements / functions / lines / branches) | 99 / 100 / 99 / 96              | **≥ dziś**                                                                           |

Polecenia, które mają być zielone (bez `--no-verify`, bez wyłączania kroków):

```bash
bunx vitest run src/lib/admin/__tests__/invitationsFunctions.test.ts src/lib/admin/__tests__/accountAdminFunctions.test.ts \
  src/lib/admin/__tests__/impersonationFunctions.test.ts src/components/admin/users/__tests__/userDialogs.test.tsx \
  src/routes/__tests__/adminUsersRoutes.test.tsx
bun run typecheck && bun run lint && bun run format:check
bun run check:ci-gates            # zawiera parytet pasów migracji i self-test planów pgTAP
bun run check:clock-freeze && bun run check:unknown-casts
bun run check:i18n-hardcoded && bun run check:i18n-default-value && bun run check:i18n-overlay-imports && bun run check:i18n-parity
bun run test:coverage             # pełna bramka progów
# drugi PR, dodatkowo:
bun run scripts/check-pgtap-plan.ts
bun run check:sql-owner-tenant-scope && bun run check:sql-tenant-scope && bun run check:sql-policy-tenant-regression
bun run check:sql-migration-replay && bun run check:rpc-contract && bun run check:authz-snapshot
bun run check:ownership && bun run check:types-freshness
python3 -c "import json; e=json.load(open('drizzle/migrations/meta/_journal.json'))['entries']; m=max(x['when'] for x in e[:-1]); print('OK' if e[-1]['when'] > m else 'ZA MALE when', e[-1]['tag'], e[-1]['when'], m)"
bash scripts/pgtap-local/run.sh all 'profile_tenant_move_guard\|push_and_digest\|profile_cv_tenant_follows\|media_mentions_tenant_follows\|author_profiles_owner_tenant_scope\|expert_request_single_generation'
```

Tryb `test` runnera pgTAP działa tylko na klastrze przygotowanym wcześniej trybem `all` albo `migrate`
(`scripts/pgtap-local/run.sh:160-163`), a sam runner wymaga rozszerzenia pgTAP (`stub.sql:26`). Jeśli lokalnie nie da
się go postawić, napisz to w PR-ze - rozstrzyga job `pgtap` w CI.

---

## 10. Opis PR-a - ma być równy diffowi

1. **Lista plików produkcyjnych i powód każdej zmiany** - w opisie, nie w dziewiątym commicie gałęzi.
2. **Konsekwencje dla produktu:** zaproszenia kont z innych najemców (także czytelników najemcy domyślnego) są
   odrzucane; rola z zaproszenia zaczyna realnie powstawać razem z połączeniami z `trg_on_expert_role_added`; rola
   spoza zbioru jest odrzucana; jaki stan zostaje po porażce każdego z zapisów (A3); rozjazd `profiles.email`
   z adresem konta daje odmowę aktywacji (A2).
3. **Kolejność wdrożenia** (kod, potem migracje) i pytanie do właściciela o mechanizm wdrożenia Lovable (A4).
4. **Diff migawki autoryzacji** wpis po wpisie i dlaczego każdy jest zamierzony, z uwagą o macierzy uprawnień.
5. **Dziennik drizzle:** `max(when)` przed zmianą i wartość nowego wpisu; potwierdzenie podwójnego wykonania SQL.
6. **Zapytania diagnostyczne z B6 i zapytanie o wielkie litery z B4**, z opisem fałszywych trafień i pytaniem do
   właściciela o decyzję.
7. **Pytania z rozdz. 6**, na które nie umiesz odpowiedzieć z repozytorium.
8. **Decyzje, które zlecenie każe opisać:** miejsce decyzji wobec claimu (A1), wybór co do `profile.tenant_moved`
   (A4), zachowanie dialogu przy ponownej próbie i obsługa `getUserById` w atrapie (B1, 4.1), granica wyroczni (B1),
   każdy przypadek rozstrzygnięty zdaniem z rozdz. 1.
9. Wynik `bun scripts/audit/verify-edition-12.mjs` dla asercji Z2 i informacja, że skryptu nie zmieniałeś.
10. **Sekcja „czego świadomie nie zrobiłem"** - każda pominięta pozycja tego zlecenia z powodem. Trzecia możliwość
    (pominięta bez słowa) nie istnieje.
