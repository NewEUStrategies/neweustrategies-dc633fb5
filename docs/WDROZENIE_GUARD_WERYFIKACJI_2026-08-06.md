# Guard pól weryfikacji: rozstrzygnięcie intencji, bramka CI, pgTAP (2026-08-06)

Zamknięcie pozycji **„Guard pól weryfikacji"** z `docs/OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`
(korekta 3). Audyt postawił pytanie rozstrzygające: czy `super_admin` **ma** móc nadawać
weryfikację - jeśli tak, dopisać go z powrotem; jeśli nie, udokumentować zawężenie
i zregenerować snapshot. W obu wypadkach: zaktualizować pgTAP i wpiąć
`check:authz-snapshot` do CI.

## 1. Co się stało (stan wyjściowy)

Migracja `20260806094104` (weryfikacja po domenie e-mail) dopisała do
`profiles_guard_verification()` sankcjonowaną furtkę `app.verification_sync`, ale
odbudowała funkcję na **najstarszej** definicji (`20260713160000`), a nie na ostatniej
żywej (`20260805122338`). Trzy skutki uboczne, żaden nieopisany:

|                 | `20260805122338` (poprzednia żywa)           | `20260806094104` (weszła poza PR-em) |
| --------------- | -------------------------------------------- | ------------------------------------ |
| kto może        | `has_role(admin)` OR `has_role(super_admin)` | **tylko** `has_role(admin)`          |
| odmowa          | `RAISE ... USING ERRCODE = '42501'`          | `RAISE` bez ERRCODE (`P0001`)        |
| furtka automatu | brak                                         | `app.verification_sync`              |

Potwierdzone eksperymentalnie na Postgresie 16 z odwzorowanymi politykami i triggerami:
`super_admin` bez osobnej roli `admin` dostawał
`P0001 / profiles: verification can only be changed by an admin`.

Konsekwencje: (a) produktowa - `super_admin` przestał móc nadać i odebrać weryfikację,
choć weryfikacja steruje odznaką, a odznaka `expert` pociąga dożywotni VIP; (b) sygnałowa

- klient nie mógł odróżnić braku uprawnień (`42501`) od błędu logiki; (c) CI - snapshot
  autoryzacji rozjechał się z migracjami i kładł test parytetu macierzy uprawnień na `main`.

## 2. Rozstrzygnięcie: `super_admin` wraca

Nie było to zawężenie do udokumentowania, tylko regres do naprawy. Cały pozostały osprzęt
tej samej ścieżki - w tym fragmenty **tej samej migracji** - mówi `admin` OR `super_admin`:

| Bramka                                                     | Zbiór ról                        | Skąd                                |
| ---------------------------------------------------------- | -------------------------------- | ----------------------------------- |
| polityka RLS `"Admins can update tenant profiles"`         | `admin`, `super_admin`           | `20260731185816`                    |
| `admin_assert_verification_admin()`                        | `admin`, `super_admin`           | `20260806094104` (ta sama migracja) |
| polityka `"verification domains staff read"`               | `admin`, `super_admin`           | `20260806094104` (ta sama migracja) |
| `admin_grant_profile_badge()` - ta sama odznaka inną drogą | `admin`, `super_admin`           | `20260803113000`                    |
| bliźniaczy `profiles_guard_privileged_columns()`           | `admin`, `super_admin`, `editor` | `20260806094239` (commit obok)      |

Guard **przeczył polityce RLS, która go przepuszczała**: `super_admin` mógł dodać domenę
weryfikującą (i nadać odznakę automatem), ale nie mógł nadać jej ręcznie.

`editor` zostaje **poza** zbiorem - parytet z `admin_grant_profile_badge()`, bo ta sama
odznaka po stronie `expert` otwiera dożywotni VIP. To zawężenie jest zamierzone i od teraz
opisane w `docs/WERYFIKACJA_PROFILI.md`.

## 3. Co weszło

**Migracja `20260806130000_profiles_verification_guard_role_set.sql`**

- `profiles_guard_verification()`: `admin` OR `super_admin`, odmowa `42501`, zachowana
  furtka `app.verification_sync`, zachowane przejście dla ścieżek bez `auth.uid()`
  (`service_role`, cron, definer poza żądaniem), `COMMENT ON FUNCTION` z kontraktem.
- Trigger przechodzi na **`BEFORE INSERT OR UPDATE`**. Polityka `"Users insert own profile"`
  pozwala wstawić WŁASNY wiersz `profiles`, a oba guardy były `BEFORE UPDATE` - self-insert
  z `verified_at = now()` nie przechodził żadnej kontroli w oknie, w którym wiersz profilu
  nie istnieje (skasowany profil przy żywym koncie `auth.users`, nieudany provisioning).
  `upsert` klienta trafia w konflikt PK i idzie ścieżką UPDATE, więc luka była wąska, ale
  realna. Ścieżki systemowe są nietknięte: wstawiają profil bez sesji i bez pól weryfikacji.
- `admin_set_profile_verification()`: ten sam zbiór ról + `42501`. **Bez tego naprawa guardu
  byłaby martwa** - RPC jest jedyną ścieżką zapisu z panelu i odrzucałaby `super_admina` na
  własnej bramce. Komunikat zachowuje frazę `admin role required` (kontrakt asercji
  w `people_verification_test.sql`), doszło `REVOKE ... FROM PUBLIC, anon` + jawny
  `GRANT EXECUTE` dla `authenticated`/`service_role`.

**pgTAP `profiles_verification_guard_test.sql`: 3 → 20 asercji.** Stary plik sprawdzał
wyłącznie strukturę (istnienie funkcji, trigger, `SECURITY DEFINER`), dlatego zawężenie
przeszło na zielono. Nowy pilnuje zachowania: `super_admin` bez roli `admin` realnie
zapisuje (asercja wprost na regres), `editor` dostaje `42501` z komunikatem bramki, zwykły
użytkownik nie dostaje wyjątku ale i nie dostaje odznaki (kolejność triggerów), furtka
`app.verification_sync` przepuszcza automat, ścieżka bez sesji nie jest samonadaniem,
self-INSERT z `verified_at` jest odrzucany, RPC panelu trzyma parytet ról.

**CI: krok „Authorization snapshot freshness" (`check:authz-snapshot`).** Test parytetu
w Vitest porównuje snapshot **semantycznie** (bramka → role), więc pozostaje zielony, gdy
artefakt dryfuje w provenance (`file`) i statystykach skanu - dokładnie tak snapshot na
`main` został 10 migracji z tyłu (`stats.migrations` 612 vs 622). Nowy krok regeneruje
i porównuje bajt w bajt.

**Diagnostyka bramki parytetu (`diffAuthzSnapshots`).** Komunikat porównywał cały obiekt
bramki, a drukował cztery pola - dla dryfu samego `file` wypisywał dwa **identyczne**
obiekty i zaprzeczał własnej tezie („bramka rozjechała się: {…} vs {…}", oba takie same).
Teraz komunikat wymienia tylko pola, które faktycznie się różnią, a dryf wyłącznie
provenance jest nazwany po imieniu: `zmieniła provenance (bez zmiany uprawnień)`. Regres
ma test jednostkowy w `src/lib/ci/__tests__/authzGates.test.ts`.

**Panel: martwa kontrolka wpięta.** `admin.users.$id.tsx` deklarował `verificationQ`,
`verifyBusy` i `setVerified` (RPC weryfikacji) i **nigdy ich nie renderował** - jedyna
ścieżka nadania ręcznego była nieosiągalna z UI, więc naprawa uprawnienia i tak nie
byłaby wykonalna. Kod trafił do `VerificationAdminToggle` (ten sam wzorzec co
`ExpertRequestsAdminToggle`: `Card` w kolumnie `aside`, `Switch`, PL/EN przez `L()`,
`Loader`/`disabled` na czas zapisu) z klientowym odbiciem bramki DB: `/admin` jest otwarty
dla `is_staff` (także `editor`/`author`), więc bez `canEdit={isAdmin}` przełącznik
odpowiadałby edytorowi surowym `42501`.

## 4. Weryfikacja

| Co                                                                                      | Wynik                                                                                        |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `bunx tsc --noEmit`                                                                     | bez błędów                                                                                   |
| `bun run lint` (pliki zmienione)                                                        | bez błędów                                                                                   |
| `check:authz-snapshot`                                                                  | ✓ zgodny z migracjami                                                                        |
| test parytetu macierzy + `authzGates` (41 + 26 asercji)                                 | zielone (przed zmianą: parytet czerwony)                                                     |
| migracja + 13 scenariuszy bramki na Postgresie 16 z odwzorowanymi politykami/triggerami | wszystkie przechodzą; kontrola negatywna na definicji `20260806094104` pada na `super_admin` |

pgTAP w CI wymaga stacka Supabase (Docker), niedostępnego w tym środowisku - stąd
scenariusze bramki odtworzone na atrapie platformy (role `anon`/`authenticated`/`service_role`,
`auth.uid()`, kolumnowe granty, trzy polityki `profiles`, bliźniaczy guard) i uruchomione
na realnym Postgresie. To dowód na logikę i składnię, nie zamiennik przebiegu `supabase test db`.

### Czerwone kroki CI **poza** zakresem tej zmiany

Zmierzone na `main` (przez `git stash`) i po tej zmianie - identycznie, więc nie są jej skutkiem,
ale trzymają suitę na czerwono i wymagają osobnej decyzji:

| Krok CI              | Stan                                                           | Diagnoza                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check:sql-app-role` | czerwony przed i po (3 trafienia)                              | skaner **nie usuwa komentarzy TS** przed dopasowaniem `has_role(..., 'literal')`, więc łapie dwa własne komentarze dokumentacyjne parsera (`authzGates.ts:9` - `has_role(uid, 'X')`, `:72` - `has_role(<uid>, 'rola')`) oraz **celowy negatywny fixture** parsera (`authzGates.test.ts:94`: `'tenant_admin'`, którego test wymaga, by dowieść odsiewania literałów poza enumem). Fix wymaga dwóch decyzji: strip komentarzy dla `.ts/.tsx` + wyłączenie plików-fixture'ów parsera z tego skanu. |
| `Lint`               | czerwony przed i po (617 problemów, 480 naprawialnych `--fix`) | dryf formatowania Prettiera w plikach nietkniętych tą zmianą (m.in. `admin.users.index.tsx`, `start.ts`, `payments.functions.ts`). Pliki zmienione tutaj przechodzą `eslint` z kodem 0.                                                                                                                                                                                                                                                                                                         |

## 5. Dług świadomie nieruszony

- `verified_at` i odznaka `verified` w `profile_badges` to **dwie warstwy** i nadanie ręczne
  jednej nie zapala drugiej (odznaka nie ustawia `verified_at`, RPC nie tworzy odznaki).
  Sprzężenie ich to zmiana zachowania, której nie da się tu przetestować bez pgTAP -
  różnica jest opisana w `docs/WERYFIKACJA_PROFILI.md` (tabela dwóch kontrolek) i czeka
  na osobną decyzję produktową.
- `is_staff()` (= `admin`|`editor`|`author`, bez `super_admin`) rządzi polityką SELECT
  `"Profiles authenticated read"`, więc czysty `super_admin` nie czyta cudzych wierszy
  `profiles` wprost z tabeli - panel chodzi po RPC (`admin_get_user`), więc nic nie jest
  zepsute, ale asymetria zostaje do przeglądu.
