# Wdrożenie: macierz uprawnień generowana z bramek SQL (2026-08-03)

**Data:** 2026-08-03 · **Baza:** `e55e38b` · **Gałąź:** `claude/permissions-matrix-audit-u77n3d`

Mandat z `OCENA_FUNKCJI_TABELE_2026-08-03.md` (wiersz „Macierz uprawnień", ocena 6):

> **Strona referencyjna (read-only)** - nie jest generowana z kodu/DB, więc może się rozjechać z
> rzeczywistością bez żadnego sygnału. 🔧 Generować z katalogu capability
> (`lib/billing/capabilities.ts`) + test parytetu.

---

## 1. Punkt wyjścia: skala rozjazdu była większa, niż mówił audyt

Audyt zarzucał ryzyko rozjazdu. Weryfikacja na kodzie pokazała, że rozjazd **już nastąpił**:

| Zapis starej strony                                                 | Stan faktyczny w bazie                                                                                                                                                                                                            | Wniosek           |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 4 poziomy subskrybenta: `free` / `basic` / `premium` / `enterprise` | katalog warstw ma 14 kluczy (`reader`, `supporter`, `member`, `student`, `educator`, `pro`, `ngo`, `vip`, `team`, `business`, `corporate`, `partner`, `partner_general`, `presidents_circle`) - **żadna z 4 kolumn nie istniała** | wymyślone kolumny |
| „Odczyt treści premium": editor i author = pełny dostęp             | `has_content_access` liczy rangę warstwy, plany i zakupy; **nie ma obejścia stafowego**                                                                                                                                           | nieprawda         |
| „Zarządzanie użytkownikami": admin pełny, super_admin pełny         | `admin_list_users` bramkuje `has_role('admin') OR is_super_admin()` - zgadza się, ale przypadkiem                                                                                                                                 | niesprawdzalne    |
| „Rozliczenia": `sub_enterprise` = częściowy                         | żadna bramka nie wiąże warstwy `corporate` z rozliczeniami                                                                                                                                                                        | wymyślone         |
| 26 wierszy uprawnień                                                | zero referencji do funkcji/polityk, po których dałoby się to sprawdzić                                                                                                                                                            | nieweryfikowalne  |

Strona nie była „ryzykiem dryfu" - była dokumentem, którego **nie dało się skonfrontować ze źródłem**,
bo nie wskazywała żadnego źródła.

## 2. Architektura: prawda idzie ze SQL-a, nie z tabelki w JSX

```
supabase/migrations/*.sql                       (589 plików, źródło prawdy)
        │  scripts/lib/authzSource.ts           (I/O: stan końcowy funkcji + SQL bez komentarzy)
        ▼
src/lib/ci/authzGates.ts                        (CZYSTY parser - zero I/O, testowany jednostkowo)
        │  scripts/generate-authz-snapshot.ts
        ▼
src/lib/authz/authzSnapshot.generated.ts        (artefakt: 40 bramek rolowych + 17 bramek flag)
        │  src/lib/authz/permissionMatrix.ts    (kompozycja: bramki × warstwy tenanta)
        ▼
/admin/permissions                              (atoms → molecules → organisms)
```

| Warstwa            | Plik                                                           | Odpowiedzialność                                                                                                                   |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Kontrakt artefaktu | `src/lib/authz/authzSnapshotTypes.ts`                          | same typy, zero runtime - parser i strona patrzą na jeden kształt                                                                  |
| Parser             | `src/lib/ci/authzGates.ts`                                     | literały ról, aliasy rolowe, odczyty flag, żywotność polityk, render i diff snapshotu                                              |
| Wejście I/O        | `scripts/lib/authzSource.ts`                                   | jedno czytanie migracji dla generatora **i** dla bramki parytetu (jeden parser = dryf nie może być artefaktem dwóch implementacji) |
| Generator          | `scripts/generate-authz-snapshot.ts`                           | zapis artefaktu + tryb `--check` dla CI                                                                                            |
| Deklaracja wierszy | `src/lib/authz/permissionRows.ts`                              | **tylko** `id` + sekcja + `gateRef` (+ jawne zawężenia). Żadnych poziomów dostępu                                                  |
| Kompozycja         | `src/lib/authz/permissionMatrix.ts`                            | poziomy per komórka, metryki, filtrowanie, etykiety - czyste funkcje bez Reacta                                                    |
| Dane tenanta       | `src/lib/authz/permissionMatrixQuery.ts`                       | `membership_tiers` z **jawnym** `tenant_id` i tenantem w kluczu cache                                                              |
| UI                 | `src/components/admin/permissions/{atoms,molecules,organisms}` | prezentacja; zero logiki uprawnień                                                                                                 |
| Etykiety           | `src/lib/i18n-admin-permissions.ts`                            | PL/EN pod twardą bramką parytetu i18n                                                                                              |

### Skąd parser bierze role (i dlaczego to jest prawda, a nie heurystyka)

`has_role(uuid, app_role)` nie ma hierarchii - `super_admin` **nie dziedziczy** uprawnień `admin`. Zbiór
ról bramki to więc dokładnie zbiór literałów, które bramka wymienia:

| Wzorzec w SQL                                             | Interpretacja                                                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `has_role(auth.uid(), 'admin')`                           | alternatywa (gałąź OR)                                                                                                                                                    |
| `role = 'super_admin'::app_role`                          | alternatywa; **wymagane jawne rzutowanie**, bo kolumna `role` istnieje też w `member_organizations`/`conversation_participants` i goły literał dawałby fałszywe trafienia |
| `is_staff()`, `is_super_admin()`, `can_publish_content()` | alias rolowy → rozwijany o **własny** zbiór ról tej funkcji (liczony z jej ciała, nie wpisany w TS)                                                                       |
| `assert_admin_tenant()`                                   | warunek **twardy** (`RAISE` przy braku roli) → `allRoles`, nie `anyRoles`                                                                                                 |

Literał poza enumem jest odsiewany (osobna bramka `check:sql-app-role` pilnuje, żeby takich nie było).
Bramka wymieniająca i twardy warunek, i alternatywy dostaje tryb `mixed` widoczny w UI.

### Skąd parser bierze flagi warstw

Odczyt (bramka): `has_tier_feature('k')`, `user_has_tier_feature(uid, 'k')`, `features ->> 'k'`.
Zapis (seed) **nie** jest bramką: `jsonb_build_object('k', true)`, `features ? 'k'`, `features - 'k'`.
Ten podział jest testowany osobno - bez niego cała mapa „egzekwowana / dekoracyjna" byłaby zgadywanką.

## 3. Co macierz mówi teraz (i czego nie mówiła wcześniej)

- **Kolumny ról** = 5 wartości enuma `app_role`; komórka „pełny" tylko gdy bramka wymienia tę rolę.
- **Kolumny warstw** = warstwy aktywne **tego** obszaru roboczego; brak warstw → same role, zero
  wymyślonych kolumn.
- **„Nie dotyczy" ≠ „brak".** Bramka rolowa nie patrzy na warstwę, a bramka warstwy nie patrzy na rolę
  (poza jawnym obejściem, np. `get_event_access` przepuszcza `admin`/`editor` do nagrań). Stara strona
  mieszała te dwie informacje w jedno „Brak", co czytało się jak zakaz.
- **Referencja bramki w każdym wierszu** (`admin_list_users`, `policy:eu_policy_follows/...`) - audytor
  otwiera źródło i sprawdza twierdzenie w 10 sekund.
- **Wiązanie z tenantem per bramka**: `current_tenant_id()` (tenant wołającego) / porównanie kolumn
  `tenant_id` (tenant wiersza) / brak odwołania. KPI liczy bramki bez wiązania z wołającym - to lista
  pozycji do przeglądu, nie ozdoba.
- **Limity liczbowe** (`expert_request_quota`) jako wartość puli per warstwa, nie jako „tak/nie".

## 4. Test parytetu: co dokładnie obleje CI

| Zdarzenie                                                   | Sygnał                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| bramka zyskuje/traci rolę                                   | `authzSnapshotParity` - diff wskazuje bramkę i różnicę zbiorów                                       |
| bramka znika, a wiersz macierzy nadal na nią wskazuje       | referencja wisząca (`danglingRefs`)                                                                  |
| nowa wartość enuma `app_role` bez kolumny                   | porównanie `APP_ROLES` z enumem z migracji                                                           |
| flaga czytana przez bramkę, nieopisana w rejestrze          | „flaga egzekwowana, a macierz o niej milczy"                                                         |
| `enforced: true` bez bramki / bramka przy `enforced: false` | dwa osobne przypadki testowe                                                                         |
| wiersz albo kolumna bez tłumaczenia PL/EN                   | bramka i18n (`adminPermissions` w `GATED_PREFIXES`) + test kompletności etykiet                      |
| snapshot nieodświeżony po migracji                          | `check:authz-snapshot` (tryb `--check`, bez zapisu) - krok CI **„Authorization snapshot freshness"** |

Parser ma **własne** 26 testów na syntetycznym SQL-u. Bez nich ślepy parser dawałby dwa równie puste
zbiory i bramka przechodziłaby na zielono, nie pilnując niczego.

**Podział pracy między tymi dwoma sygnałami jest istotny** (nauczka z regresu
`profiles_guard_verification`, 2026-08-06 - patrz `docs/WDROZENIE_GUARD_WERYFIKACJI_2026-08-06.md`):
`authzSnapshotParity` porównuje snapshot **semantycznie** (bramka → role), więc pozostaje zielony,
gdy artefakt dryfuje w provenance (`file`) albo w statystykach skanu. `check:authz-snapshot`
regeneruje plik i porównuje **bajt w bajt** - i dopiero on wyłapuje przeniesienie definicji do
nowszej migracji oraz nieodświeżone `stats`. Do 2026-08-06 był tylko w `package.json`, poza CI,
dlatego snapshot na `main` był 10 migracji z tyłu.

## 5. Co bramka znalazła od razu

`chat_inmail_quota_2` i `chat_inmail_quota_5` są **egzekwowane** (`my_inmail_quota`,
`send_expert_inmail` czytają je jako `features ->> ...`), ale rejestr capabilities ich nie znał - nie
było ich ani w macierzy, ani w edytorze flag warstwy w panelu. Dopisane jako `enforced: true` z opisem
punktu egzekwowania. `expert_request_quota` jest flagą **liczbową**, więc trafiła na jawną listę
`NUMERIC_FEATURE_KEYS` (ma w panelu własne pole numeryczne) - dzięki temu każda przyszła flaga z bramką
musi dostać świadomą decyzję: rejestr boolowski albo lista limitów.

## 6. Izolacja obszarów roboczych

- zapytanie o warstwy filtruje **jawnie** po `tenant_id` (druga bramka obok RLS, w duchu `lib/tenant.ts`),
- `tenant_id` jest częścią klucza React Query, więc przelogowanie do innego obszaru nie może pokazać
  kolumn z poprzedniego z cache,
- `buildPermissionMatrix` przyjmuje warstwy **przez parametr** - nie ma ścieżki, którą dane jednego
  tenanta wpadłyby do macierzy zbudowanej dla drugiego (test pokrywa oba kierunki),
- snapshot bramek jest globalny i **bezdanowy** (nazwy funkcji, zbiory ról) - nie przenosi treści tenanta.

## 7. Polecenia

```bash
bun run generate:authz-snapshot     # odśwież snapshot po zmianie bramek w migracjach
bun run check:authz-snapshot        # CI: czy snapshot jest aktualny (bez zapisu)
bun run check:permissions-parity    # CI: parser + parytet + kompozycja + render
```

## 8. Co zostało otwarte

| Pozycja                                          | Dlaczego nie teraz                                                                                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oś rolowa opisuje 40 z 338 znalezionych bramek   | selekcja jest świadoma (`permissionRows.ts`) - macierz ma być czytelna, nie kompletna jak `pg_policies`. Rozszerzanie jest dopisaniem wiersza plus etykiety PL/EN |
| Poziom „własne" jest deklarowany, nie odtwarzany | wymaga analizy predykatów własności (`author_id = auth.uid()`) w politykach; test pilnuje dziś tylko, że zawężona rola **nadal przechodzi** bramkę                |
| Bramki `tenantRef: "none"`                       | macierz je **pokazuje** i liczy w KPI; ocena, które są realnym problemem, to zadanie osobnego audytu bezpieczeństwa, nie tej strony                               |
