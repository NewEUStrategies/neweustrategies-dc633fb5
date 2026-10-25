# Naprawa `profiles.discoverable` po wpisie dziennika 0001 (2026-10-25)

Dokument dla właściciela i inspektora ochrony danych (IOD). Opisuje fakty, zmianę w bazie
i kroki weryfikacji. **Nie jest poradą prawną** - ocena prawna i decyzje o zgłoszeniach należą
do właściciela i IOD.

## W skrócie

- 2026-09-11 o 18:12 UTC wpis dziennika drizzle `0001_profiles_discoverable_default_true`
  ustawił `DEFAULT true` i przestawił **każdy** profil z `discoverable = false` na `true`.
- 2026-09-13 około 19:12 UTC wpis 0013 przywrócił `DEFAULT false`. Danych nikt nie cofnął.
- Ta zmiana robi dwie rzeczy:
  1. od teraz zapisuje **decyzję właściciela profilu** (`profiles.discoverable_decided_at`);
  2. cofa do `false` profile, o których **baza dowodzi**, że nikt nie zdecydował, i zapisuje
     każdy z nich w rejestrze `profiles_discoverable_corrections`.
- Profili, których historii nie da się rozstrzygnąć z danych (kubeł C), korekta nie zmienia -
  wymagają ponownego pytania w aplikacji.
- Migracja **sama mierzy** bazę, nie zawiera żadnych wartości z produkcji, a przy każdym
  niespełnionym bezpieczniku niczego nie zmienia i zostawia wiersz diagnostyczny. Nigdy nie
  przerywa wsadu migratora Lovable.

## 1. Co się stało

| Kiedy (UTC)              | Zdarzenie                                                                                                                   | Źródło                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 2026-09-11 18:12:10      | `0001_profiles_discoverable_default_true`: `DEFAULT true` i `UPDATE ... SET discoverable = true WHERE discoverable = false` | `drizzle/migrations/0001_...sql`, `when` 1789150330170 w dzienniku, commit bota 9e1279018 (18:12:21) |
| 2026-09-11 do 2026-09-13 | każda rejestracja dostaje `true` z `DEFAULT`-u                                                                              | `handle_new_user()` nie wymienia kolumny                                                             |
| 2026-09-13 19:12:36      | wpis 0013 (oraz 0011) przywraca `DEFAULT false`; w pasie supabase `20260913150000`                                          | `when` 1789326756549 w dzienniku                                                                     |
| 2026-10-25               | znacznik decyzji i korekta danych                                                                                           | `20261025090020`, `20261025090030`                                                                   |

`discoverable` otwiera (pomiar na bazie zbudowanej z migracji przed tą zmianą: 37 funkcji i 1 widok):

- **anonimowy** publiczny profil (`profile_is_public`) oraz wyszukiwanie dostępne dla anonima
  (`search_people_orgs`, `search_autosuggest`, `search_mention_targets`);
- katalog osób dla członków (`profiles_public`, `search_people`), listy uczestników wydarzeń
  (`event_attendees`), propozycje kontaktów, wprowadzenia, wiadomości prywatne
  (`get_or_create_direct_conversation`), alerty zapisanych wyszukiwań;
- przetwarzanie treści profilu na embeddingi (`profiles_needing_embeddings`).

Kogo to dotknęło:

- osoby, które **nigdy nie zdecydowały** (`false` z `DEFAULT`-u) - stały się widoczne;
- osoby, które **świadomie wyłączyły** widoczność przed 0001 - stały się widoczne wbrew decyzji;
- osoby zarejestrowane między 2026-09-11 a 2026-09-13 - widoczne od założenia konta.

Pierwszych dwóch grup baza nie odróżnia (do tej zmiany nie było zapisu decyzji), ale dla obu
poprawną wartością jest `false`, więc korekta traktuje je tak samo.

## 2. Punkty do oceny prawnej (dla właściciela i IOD)

- **RODO art. 25 ust. 2** (domyślna ochrona danych): domyślnie dane osobowe nie mogą być
  udostępniane nieokreślonej liczbie osób bez działania osoby, której dotyczą. `DEFAULT true`
  i hurtowe przestawienie są z tym sprzeczne.
- **Art. 7 ust. 1**: administrator musi umieć wykazać zgodę. Znacznik
  `discoverable_decided_at` daje ten dowód od chwili wdrożenia; dla okresu wcześniejszego dowodu
  nie ma.
- **TSUE C-673/17 (Planet49)**: wstępnie zaznaczona zgoda nie jest ważną zgodą - `DEFAULT true`
  działa analogicznie.
- **Art. 33 i 34**: czy ekspozycja od 2026-09-11 jest naruszeniem ochrony danych podlegającym
  zgłoszeniu do Prezesa UODO (72 godziny od stwierdzenia) lub zawiadomieniu osób - to decyzja
  właściciela i IOD. Nagłówek migracji `20260913150000` dokumentuje wiedzę o regresji
  z 2026-09-13; od kiedy liczyć termin, jest pytaniem prawnym.
- **Art. 33 ust. 5 i art. 5 ust. 2**: niezależnie od zgłoszenia naruszenie dokumentuje się
  wewnętrznie. Rejestr `profiles_discoverable_corrections` i ten dokument mogą być częścią tej
  dokumentacji (kto, kiedy, z jakiego powodu został ukryty).

## 3. Co robi ta zmiana

### 3.1 Znacznik decyzji - `20261025090020_profiles_discoverable_decision_stamp.sql`

- Kolumna `profiles.discoverable_decided_at timestamptz` (NULL = brak decyzji właściciela).
- Wyzwalacz `profiles_discoverable_decision_stamp_trg` (BEFORE INSERT OR UPDATE OF
  `discoverable`):
  - INSERT zawsze zeruje znacznik (rejestracja bierze `DEFAULT`, to nie jest decyzja);
  - UPDATE z `discoverable` w poleceniu pod sesją właściciela (`auth.uid() = id`) stempluje
    `now()` - także ponowne potwierdzenie bez zmiany wartości;
  - UPDATE administratora, `service_role` i migracji znacznika nie rusza.
- Klient nie ma grantu na kolumnę (odczyt i zapis kończą się 42501); kolumna nie trafia do
  `profiles_public` ani do publicznych stałych kolumn w TS.
- Przełącznik w aplikacji (`useSetDiscoverable`) już wysyła wartość pod sesją właściciela, więc
  stempluje bez zmian w kodzie klienta.

### 3.2 Korekta - `20261025090030_profiles_discoverable_0001_correction.sql`

Funkcja `public._profiles_discoverable_0001_correction(p_apply boolean)` mierzy bazę, w której
działa:

| Pomiar    | Definicja                                                                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T0001     | największy klaster identycznych `updated_at` w oknie `when(0001) ± 1 h`. Wyzwalacz `profiles_set_updated` nadał każdemu przestawionemu wierszowi ten sam czas startu transakcji migratora. |
| T_RESTORE | najwcześniejsze `created_at` po T0001 konta niezmienianego od założenia z `false` (dowód, że `DEFAULT false` wrócił), przycięte do `when(0013) + 1 h`                                      |

| Kubeł | Wartość w rejestrze          | Warunek                                                                           | Co się dzieje                   |
| ----- | ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------- |
| A     | `flipped_by_0001_untouched`  | `true` i `updated_at = T0001` (przestawiony przez 0001, od tamtej pory bez zmian) | `false` + rejestr               |
| B     | `default_true_window_signup` | `true`, `updated_at = created_at`, `created_at` w [T0001, T_RESTORE)              | `false` + rejestr               |
| C     | (tylko liczony)              | `true`, bez znacznika decyzji, konto sprzed końca okna, zmieniane po T0001        | bez zmian - pytanie w aplikacji |

Prawdziwe decyzje nie wpadają do A ani B: opt-in sprzed 0001 nie był przez 0001 dotknięty
(`updated_at < T0001`), a każdy późniejszy przełącznik przesunął `updated_at`.

Bezpieczniki - każdy niespełniony oznacza **zero zmian** i status w wierszu diagnostycznym:

| Status                       | Znaczenie                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `already_applied`            | rejestr jest niepusty; drugi przebieg niczego nie mierzy ani nie zmienia                 |
| `no_cluster`                 | brak klastra w oknie 0001 (np. baza CI zbudowana z migracji)                             |
| `cluster_too_small`          | największy klaster ma mniej niż 10 wierszy                                               |
| `cluster_not_dominant`       | klaster nie jest co najmniej 5 razy większy od następnego w oknie                        |
| `cluster_signature_mismatch` | w klastrze jest wiersz z `false` albo założony nie wcześniej niż T0001                   |
| `error`                      | błąd wykonania (np. 55P03 po `lock_timeout` 5 s); rejestr i przestawienia wycofane razem |

Przy `p_apply = true` funkcja blokuje zmierzone wiersze i sprawdza, że od pomiaru nikt ich nie
zmienił (decyzja zapisana w tej samej chwili wypada), zapisuje każdy w rejestrze **przed**
przestawieniem i przestawia dokładnie zapisane wiersze. Potem wywołuje
`prune_profile_embeddings()`, więc embeddingi ukrytych profili znikają od razu, a nie przy
następnym zadaniu. Przy `p_apply = false` wykonuje same odczyty (działa także w transakcji tylko
do odczytu).

Rejestr `profiles_discoverable_corrections`: `profile_id`, `tenant_id`, `bucket`, `t0001`,
`t_restore`, `corrected_at`, `notified_at`. RLS bez polityk, klient bez grantów, `service_role`
czyta, dopisuje i zmienia wyłącznie `notified_at` (wiersz jest dowodem korekty). Wiersz znika
razem z profilem (`ON DELETE CASCADE`).

Migracja tworzy rejestr i funkcję, wywołuje ją raz z `p_apply = true` i wypisuje wynik jako
`NOTICE`. Funkcja nigdy nie rzuca wyjątku: migrator Lovable wykonuje wszystkie oczekujące wpisy
w jednej transakcji, więc wyjątek wycofałby też cudze wpisy.

Czego zmiana **nie** robi: nie zmienia `DEFAULT`-u (`false` od 0011/0013), nie dotyka kubła C ani
nikogo z `true` sprzed 0001, nie kopiuje i nie powtarza wpisu 0001.

### 3.3 Dowody (bez dostępu do produkcji)

- Baza zbudowana z migracji (PostgreSQL 16): migracja to no-op (`no_cluster`), drugi przebieg nie
  zmienia profili.
- Historia odtworzona **prawdziwym plikiem 0001** (jego `now()` przesunięte na czas z dziennika):
  kubeł A 14, B 2, C 8; nietknięci opt-in sprzed 0001, późniejsze przełączniki, edycje,
  rejestracje po oknie i wiersz wstawiony z `true` za sufitem okna.
- Każdy bezpiecznik osobno (za mały klaster, dwa podobne klastry, `false` w klastrze, wiersz
  założony w chwili T0001, klaster poza oknem): zero zmian. Brak T_RESTORE: kubeł A przechodzi,
  B pominięty.
- Wyścig: decyzja właściciela zatwierdzona w trakcie korekty wypada z korekty. Blokada dłuższa niż
  5 s: status `error`, zero zmian.
- Pełny wsad A+B+C+D w jednej transakcji na modelu produkcji (pliki supabase sprzed pasa + 399
  wpisów dziennika): stosuje się czysto.
- pgTAP: `profiles_discoverable_decision_stamp_test.sql` (18 asercji) i
  `profiles_discoverable_0001_correction_test.sql` (24) - czerwone bez migracji, zielone z nimi;
  pozostałe pliki suity bez zmian wyniku; `plpgsql_check` bez uwag.

### 3.4 Wdrożenie

- Nośnik w dzienniku drizzle generuje `bun run migrations:mirror` (kolejne wpisy po plikach
  adopcji; numery ustala generator). Migrator Lovable wykona je w najbliższym wsadzie.
- `ADD COLUMN` na `profiles` zmienia tylko katalog, ale trzyma blokadę ACCESS EXCLUSIVE do końca
  wsadu; `lock_timeout` 5 s zamienia długie czekanie na szybkie 55P03, po którym runbook pozwala
  ponowić.

## 4. Weryfikacja po wdrożeniu (tylko odczyt, SQL Editor)

```sql
-- 1. Wynik korekty z rejestru
SELECT bucket, count(*) AS profiles, min(t0001) AS t0001, min(t_restore) AS t_restore,
       min(corrected_at) AS corrected_at
  FROM public.profiles_discoverable_corrections
 GROUP BY bucket
 ORDER BY bucket;

-- 2. Wiersz diagnostyczny (p_apply = false: same odczyty, nic nie zmienia)
SELECT * FROM public._profiles_discoverable_0001_correction(false);

-- 3. DEFAULT kolumny - oczekiwane: false
SELECT column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'discoverable';

-- 4. Wyzwalacz znacznika decyzji - oczekiwany jeden wiersz
SELECT tgname
  FROM pg_trigger
 WHERE tgrelid = 'public.profiles'::regclass
   AND tgname = 'profiles_discoverable_decision_stamp_trg';
```

Jak czytać zapytanie 2:

- `already_applied` - korekta wykonana; `bucket_a_rows` i `bucket_b_rows` pochodzą z rejestru,
  `bucket_c_rows` liczy na bieżąco profile do ponownego pytania (maleje, gdy ludzie potwierdzają).
- dowolny inny status - korekta **niczego nie zmieniła** (rejestr pusty), a `detail` mówi
  dlaczego. Wtedy pomiar okna 0001 (poniżej) pokazuje rzeczywisty kształt danych; kolejny krok to
  nowa migracja przez generator lustra, nie ręczny SQL na produkcji.

```sql
-- Pomiar okna 0001 (tylko odczyt): klastry identycznych updated_at w when(0001) ± 1 h
SELECT updated_at, count(*) AS rows_total, count(*) FILTER (WHERE discoverable) AS rows_true,
       min(created_at) AS oldest_created, max(created_at) AS newest_created
  FROM public.profiles
 WHERE updated_at >= timestamptz '2026-09-11 17:12:10.17+00'
   AND updated_at <  timestamptz '2026-09-11 19:12:10.17+00'
 GROUP BY updated_at
HAVING count(*) > 1
 ORDER BY rows_total DESC
 LIMIT 5;
```

`NOTICE` migracji może nie być widoczny w panelu Lovable - źródłem prawdy są rejestr i wiersz
diagnostyczny.

## 5. Dalsze kroki (poza tą zmianą)

1. **Ponowne pytanie w aplikacji (kubeł C).** Ten sam predykat co `bucket_c_rows`: `true`, bez
   `discoverable_decided_at`, konto sprzed końca okna `DEFAULT true`, zmieniane po T0001.
   Odpowiedź przez istniejący przełącznik (`useSetDiscoverable`) stempluje decyzję. Do decyzji
   właściciela: co z osobami, które nie odpowiedzą w wyznaczonym terminie (np. ukrycie także ich -
   kosztem cofnięcia części prawdziwych decyzji podjętych po 0001).
2. **Powiadomienie osób z kubłów A i B.** Lista: rejestr bez `notified_at`; po wysłaniu
   `service_role` ustawia `notified_at` (jedyna kolumna, którą może zmienić). Treść (co było
   widoczne, od kiedy, że profil jest ukryty, jak go włączyć) - do uzgodnienia z IOD.
3. **Ocena art. 33/34 i wpis do wewnętrznego rejestru naruszeń** - decyzja właściciela i IOD.
4. **Długoterminowo:** decyzję można też zapisywać jako klucz zgody (np. `people_directory`)
   przez istniejące `set_user_consent(...)`, z wersją treści, adresem IP i przeglądarką.
5. Wpis 0001 zostaje w rejestrze pasów jako `drizzleOnly` i **nigdy** nie jest kopiowany ani
   powtarzany (ponowne wykonanie przestawiłoby znów każdego, kto się wypisał).

## 6. Ograniczenia

- Kubła C nie da się rozstrzygnąć z danych: część to prawdziwe decyzje po 0001, część osoby
  nietknięte, którym ślad 0001 zatarł późniejszy hurtowy UPDATE systemu (0021 - adresy awatarów
  i okładek, 2026-09-14; 0121/0123 - puste slugi, 2026-10-02).
- Sesja „Zaloguj jako" jest prawdziwą sesją konta docelowego, więc przełącznik użyty w niej
  stempluje jak decyzja właściciela; takie stemple da się odróżnić po `impersonation_sessions`.
- Jeżeli produkcyjne 0001 wykonało się poza oknem `± 1 h` albo inaczej, niż pokazuje dziennik,
  bezpiecznik zatrzyma korektę bez zmian - potrzebna będzie decyzja po pomiarze z sekcji 4.
- Korekta przesuwa `updated_at` poprawionych profili - to prawdziwa zmiana wiersza; moment
  korekty jest też w `corrected_at`.
