# Rozdzielenie profili: People (każdy użytkownik) vs Author (nadane przez admina)

## Zasada
- Każda zarejestrowana osoba ma profil pod `/people/<slug>` (np. `/people/jan-kowalski-2`).
- `/author/<slug>` pokazuje wyłącznie osoby z rolą `author` (lub wyższą redakcyjną: editor/admin/super_admin), nadaną przez admina lub superadmina.
- Wejście na `/author/<slug>` osoby bez roli autora - trwałe przekierowanie (301) na `/people/<slug>` zamiast 404.
- Wejście na `/people/<slug>` autora - pokazuje profil członka z wyraźnym odnośnikiem „Zobacz profil autora”.

## Co zobaczy użytkownik
- Klik w osobę w klubie, reakcjach, wzmiankach, czacie, wynikach wyszukiwania i u osób organizacji otwiera `/people/...`.
- Byliny wpisów, strony autorów i listy redakcji dalej prowadzą do `/author/...`.
- Profil osoby (People): zdjęcie, imię i nazwisko, stanowisko, firma (z odnośnikiem do organizacji), lokalizacja, bio, specjalizacje, znaczek weryfikacji, przyciski „Wiadomość / Połącz”, stopień powiązania. Pola kontaktowe tylko zgodnie z ustawieniami prywatności.
- Widoczność: tylko profile z opcją „widoczny w katalogu” lub dla zalogowanych w tym samym tenancie; strona `noindex` (jak katalog `/people`).

## Technical details
- Baza: RPC `get_member_profile(p_slug)` - SECURITY DEFINER, `tenant_id` z `_caller_tenant()`, bezpieczna projekcja kolumn (bez email/telefonu poza zgodą), respektuje `discoverable` i Chatham House; zwraca też `is_author` (has_role author/editor/admin/super_admin). GRANT tylko `authenticated`, test pgTAP izolacji tenantów.
- Nowa trasa `src/routes/people.$slug.tsx` (loader przez `ensureQueryData`, `errorComponent`, `notFoundComponent`, `head()` z noindex, PL/EN). Istniejąca `people.tsx` staje się layoutem z `<Outlet />`, katalog przenosi się do `people.index.tsx` (URL `/people` bez zmian).
- `/author/$slug`: gdy hub zwraca `null`, a `get_member_profile` znajduje osobę - `redirect` 301 na `/people/$slug`.
- Helper `profileHref({ slug, isAuthor })` w `src/lib/profile/profileHref.ts` + atom `ProfileLink`; podmiana linków w klubach (ClubAuthorIdentity, ClubReactionAvatars, ClubPersonCard, ClubRosterFaces, Spotlight), wzmiankach (MentionTag), PeopleOrgResults, OrganizationPeople, czacie. Byliny wpisów (AuthorByline) zostają na `/author`.
- Organizmy/molekuły profilu członka w `src/components/people/` (atomic design), i18n PL/EN bez defaultValue, bez `any`, „-” zamiast „—”.
- Testy: vitest dla helpera, trasy (404/redirect/render) i podmienionych linków; aktualizacja istniejących testów klubów i wyszukiwarki.
