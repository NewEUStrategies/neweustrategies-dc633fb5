# Bramka anonimowego dostępu do `profiles_public` (2026-08-06)

## Finding

`public.profiles_public` był widokiem definerowym (`security_invoker = off`) z
`GRANT SELECT ... TO anon`, a jego jedynym predykatem było
`tenant_id = public_tenant_id()`. Skutek: **22-kolumnowa projekcja KAŻDEGO
profilu tenanta była czytelna dla osoby niezalogowanej** - imię, nazwisko,
`display_name`, avatar, okładka, `bio_pl`, `bio_en`, stanowisko, firma,
specjalizacja, sześć linków społecznościowych, `slug`, `verified_at`. Enumeracja
całej bazy członkowskiej sprowadzała się do jednego `GET /rest/v1/profiles_public`.

Interfejs obiecywał dokładnie odwrotnie, w obu językach
(`profilePrivacy.externalNote`, `src/lib/i18n-chat.ts`):

> „Niezależnie od tego ustawienia Twój profil nigdy nie jest widoczny ani
> indeksowany poza platformą - osoby niezalogowane i roboty wyszukiwarek nie
> mają do niego dostępu."

Kod **znał** tę lukę i mitygował ją wyłącznie `noindex` na `/author/$slug`
(`src/lib/experts/publicVisibility.ts`, wtedy linie 1-14). To była mitygacja nie
tego ryzyka: obietnica dotyczyła DOSTĘPU, a `noindex` jest prośbą do crawlera -
nie zabiera nikomu wiersza z Data API.

Przy okazji domknięta została druga, cichsza dziura tego samego widoku: tenant
brał się WYŁĄCZNIE z klienckiego nagłówka `x-tenant-host`, więc zalogowany
użytkownik tenanta A po podmianie nagłówka czytał katalog osobowy tenanta B.

## Rozwiązanie

Migracja `20260806160000_profiles_public_anon_gate.sql` zamienia goły filtr
tenanta na **dwie addytywne warstwy widoczności egzekwowane w bazie**.

### Warstwa PUBLICZNA (także `anon`)

```
tenant_id = public_tenant_id()  AND  profile_has_public_presence(id, tenant_id)
```

`public.profile_has_public_presence(uuid, uuid)` (STABLE, SECURITY DEFINER,
zwraca sam boolean) to jedno źródło prawdy o publicznej obecności osoby:

| Sygnał                                          | Źródło                                         |
| ----------------------------------------------- | ---------------------------------------------- |
| konto redakcyjne                                | `user_roles` (admin/editor/author/super_admin) |
| kurowana odznaka eksperta                       | `profile_badges.badge = 'expert'`              |
| publiczny profil autorski                       | `author_profiles.is_public = true`             |
| publiczny profil prelegenta                     | `speaker_profiles.is_public = true`            |
| autor / współautor opublikowanego wpisu         | `posts`, `post_authors`                        |
| autor opublikowanego podcastu                   | `podcasts`                                     |
| gospodarz / prelegent opublikowanego wydarzenia | `events`, `event_speakers`                     |

To jest dokładnie ten zbiór osób, które platforma i tak publikuje pod
`/author/$slug`, w bylinach wpisów i w katalogu ekspertów - **ani jedna osoba
więcej**. KAŻDA relacja jest przypięta do tenanta profilu (`p_tenant_id`), więc
wiersz-satelita zapisany w tenancie B nie otwiera profilu tenanta A.

`profiles.discoverable` **nie** należy do tej warstwy - to opt-in do
wyszukiwarki WEWNĘTRZNEJ i tak jest opisany w panelu prywatności.

### Warstwa CZŁONKOWSKA (tylko zalogowany)

```
auth.uid() IS NOT NULL
AND tenant_id = current_tenant_id()          -- tenant DOMOWY, z profilu
AND ( id = auth.uid()
   OR discoverable = true
   OR caller_is_tenant_staff()
   OR caller_is_connected_to(id) )
```

Semantyka 1:1 z `get_chat_peers()` i `search_people()` - jedna doktryna
widoczności wewnętrznej. `current_tenant_id()` czyta tenant z profilu, nie z
nagłówka, więc podmiana `x-tenant-host` daje najwyżej to, co przeglądany tenant
i tak publikuje publicznie.

Warstwy są **addytywne** (`OR`), więc zalogowany nigdy nie widzi mniej niż anon.

### Dlaczego dwa opakowania ACL

`caller_is_tenant_staff()` i `caller_is_connected_to(uuid)` istnieją, bo
przywileje `EXECUTE` w ciele widoku są sprawdzane względem **wołającego** -
widok definerowy przełącza rolę tylko dla RELACJI, nie dla funkcji. Gołe
`is_staff()` (bez `EXECUTE` dla `anon`) dałoby anonimowi `42501` zamiast pustego
zbioru na każdym odczycie widoku. `SECURITY DEFINER` przełącza rolę na
właściciela, a na zewnątrz wychodzi wyłącznie boolean.

Żaden z helperów nie łączy `public_tenant_id()` z `has_role()`/`is_staff()`, więc
inwariant `scripts/check-sql-tenant-scope.ts` zostaje nienaruszony: obejście
stafowe jest związane z `current_tenant_id()`.

### Kompatybilność

Projekcja kolumn jest **bez zmian** (te same 22 kolumny, ta sama kolejność), więc
`CREATE OR REPLACE VIEW` wystarcza - `get_expert_hub()` i `get_public_speakers()`
nie wymagają przebudowy, a wygenerowane typy klienta pozostają ważne. Migracja
jest w pełni odtwarzalna (drugie nałożenie: same `NOTICE ... skipping`).

Wydajność: predykat to zestaw `EXISTS`-ów, każdy kończący się sondowaniem
indeksu. Migracja dokłada brakujące indeksy (`idx_podcasts_author_published`,
`idx_events_host_published`, `idx_author_profiles_user_public`,
`idx_speaker_profiles_user_public`, `idx_user_roles_user_tenant_role`, dwa
kierunkowe indeksy częściowe na `user_connections`) i ustawia `COST` tak, by
planista najpierw brał tanie gałęzie.

## Wpływ na powierzchnie aplikacji

| Powierzchnia                                                                      | Warstwa     | Zmiana                                              |
| --------------------------------------------------------------------------------- | ----------- | --------------------------------------------------- |
| byline wpisu, `/author/$slug`, katalog `/experts`, mega menu, avatary autosuggest | publiczna   | bez zmian (autorzy mają publiczną obecność)         |
| `/author/<uuid>` gołego członka dla anon                                          | publiczna   | **404 zamiast profilu** - to jest naprawa           |
| picker profili w builderze, prelegenci w panelu wydarzeń                          | staff       | bez zmian (staff tenanta domowego)                  |
| `/network/mutual/$userId`                                                         | członkowska | bez zmian (zaakceptowany kontakt)                   |
| baza ekspertów, ścieżka „restricted" (bez uprawnień)                              | publiczna   | znikają NIEpubliczne profile autorskie - zamierzone |

## Uczciwe copy zamiast obietnicy

Skoro dla autora i eksperta hub `/author/$slug` jest publiczny Z ZAŁOŻENIA,
zdanie „nigdy nie jesteś widoczny poza platformą" byłoby fałszywe także po
naprawie - tyle że w drugą stronę. Panel prywatności pokazuje więc **stan
faktyczny wraz z powodem**:

- `public.get_my_public_exposure()` - SECURITY DEFINER, WYŁĄCZNIE wiersz
  `auth.uid()` (zero powierzchni enumeracji), zwraca `is_public`, `discoverable`
  i pięć flag powodów;
- `src/lib/profile/publicExposure.ts` - model i czysta logika (bez I/O, bez React);
- `src/lib/profile/usePublicExposure.ts` - warstwa danych; `null` znaczy „nie
  wiemy" (RPC jeszcze niewdrożone), nigdy fałszywe „jesteś prywatny";
- `src/components/molecules/PublicExposureNotice.tsx` - molekuła prezentacyjna
  (atomic design, tokeny semantyczne, oba motywy, i18n PL/EN);
- `profilePrivacy.externalNote` przepisany: to ustawienie dotyczy wyszukiwarki
  WEWNĘTRZNEJ, a ekspozycja zewnętrzna jest pokazana obok.

## Testy

- `supabase/tests/profiles_public_anon_gate_test.sql` (pgTAP, 24 asercje):
  ACL helperów, komplet zachowań warstwy publicznej (w tym „anon widzi dokładnie
  4 z 8 sylwetek"), warstwy członkowskiej i stafowej, izolacja przy podmianie
  `x-tenant-host`, powody z `get_my_public_exposure()`.
- `supabase/tests/author_profile_public_access_test.sql` - fixture dostał rolę
  `author` (osoba z własną stroną `/author/:slug` zawsze ją ma); kontrakt „hub
  eksperta działa dla anon i authenticated" bez zmian.
- `src/lib/profile/__tests__/publicExposure.test.ts` - normalizacja zachowawcza
  (`null`/brak wiersza => `false`), niezależność `discoverable` od `isPublic`,
  stabilna kolejność powodów, brak martwych sygnałów w modelu.
- `src/components/molecules/__tests__/PublicExposureNotice.test.tsx` - trzy stany
  noty (private / public z powodami / unknown), parytet PL-EN na prawdziwej
  instancji i18n oraz asercja, że dawna nieprawdziwa obietnica zniknęła z obu
  wersji językowych.
- `src/lib/authz/authzSnapshot.generated.ts` - snapshot przegenerowany
  (`bun run generate:authz-snapshot`) po dołożeniu funkcji.
