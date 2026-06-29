# Pełny profil (LinkedIn-style) — plan

## Cel
Przebudować `/profile` (właściciel, live-edit) oraz dodać publiczną stronę `/u/$slug` z układem 2-kolumnowym i tabami, zgodnie z załączonymi screenami.

## Layout

```text
┌──────────────────────────────────────────────────────────┐
│  COVER  (h-44)              [Avatar + social chips]      │
├──────────────────────────────────────────────────────────┤
│  Imię Nazwisko          [Edytuj profil] [View as guest]  │
│  Tytuł zawodowy                                          │
│  [Tenant] [Specjalizacja]                                │
│  ✉ email                                                 │
├───────────────────────────────────┬──────────────────────┤
│ [O mnie][Doświadczenie][Odznaki]  │  SIDEBAR (sticky)    │
│ [Aktywność][Ustawienia]           │  • Dane osobowe      │
│                                   │  • Osobowość (test)  │
│  ── treść aktywnej zakładki ──    │  • Zainteresowania   │
│                                   │  • Hobby             │
└───────────────────────────────────┴──────────────────────┘
```

## Zakładki

1. **O mnie** — Bio, Projekty (tenanta), Kontakt (email/lokalizacja/social), CV/Plik (upload + historia wersji).
2. **Doświadczenie** — Stanowiska, Wykształcenie, Umiejętności (tagi z poziomem).
3. **Odznaki** — Odznaki i nagrody (system), Nagrody Recognition (otrzymane od innych), Otrzymane wyróżnienia (handpick admina).
4. **Aktywność** — Zapisane, Autorzy, Kategorie, Tagi, ostatnio czytane.
5. **Ustawienia** — Dane rozliczeniowe, Subskrypcja, Bezpieczeństwo, Media społecznościowe, Powiadomienia.

## Sidebar

- **Dane osobowe**: data ur., płeć, lokalizacja, label (rola), data dołączenia.
- **Osobowość**: 5 osi Big Five (Otwartość, Sumienność, Ekstrawertyczność, Ugodowość, Stabilność emocjonalna) z gradientowymi paskami + przycisk „Powtórz test".
- **Zainteresowania**: pigułki + „Dodaj".
- **Hobby**: pigułki + „Dodaj".

## Nowe tabele (migracja)

- `profile_experiences` (tenant_id, user_id, role_title, company, start_date, end_date, current, description, logo_url)
- `profile_education` (tenant_id, user_id, school, degree, field, start_date, end_date, description)
- `profile_skills` (tenant_id, user_id, label, level 1-5, category)
- `profile_awards` (tenant_id, user_id, title, issuer, awarded_at, description, icon)
- `profile_hobbies` (tenant_id, user_id, label, icon)
- `profile_cv_files` (tenant_id, user_id, file_url, file_name, size_bytes, version, is_current, uploaded_at)
- `personality_questions` (id, locale, axis, text, reverse) — seed Big Five 30 pytań PL/EN
- `personality_results` (tenant_id, user_id, openness, conscientiousness, extraversion, agreeableness, neuroticism, taken_at, answers jsonb)

Każda tabela: tenant_id NOT NULL, GRANT-y, RLS:
- właściciel: ALL na własnych wierszach,
- czytelnicy publicznego profilu: SELECT przez `has_profile_public_access(_user_id)` (security definer), które sprawdza `profiles.is_public`.

## Routing

- `/profile` (owner, _authenticated) — live-edit, taby przez `?tab=`.
- `/u/$slug` (public) — read-only, „View as guest" z `/profile` linkuje tutaj.
- `/profile/personality` — kwestionariusz (formularz, scoring, zapis).

## Server functions

`src/lib/profile.functions.ts` — wszystkie pod `requireSupabaseAuth`:
- `listExperiences/Education/Skills/Awards/Hobbies/CVs` (read własne)
- `upsert*` / `delete*` (write własne)
- `uploadCV(formData)` → media bucket, wpis do `profile_cv_files`, oznaczenie poprzednich `is_current=false`
- `submitPersonality({ answers })` → scoring po stronie serwera, zapis do `personality_results`
- `getPublicProfile({ slug })` — przez publishable client + RLS public

## Komponenty (atomic)

`src/components/profile/`
- `layout/ProfileShell.tsx` — header + tabs + sidebar grid
- `layout/ProfileTabs.tsx` — TanStack search-params synced
- `tabs/AboutTab.tsx`, `ExperienceTab.tsx`, `BadgesTab.tsx`, `ActivityTab.tsx`, `SettingsTab.tsx`
- `sections/BioCard.tsx`, `ProjectsCard.tsx`, `ContactCard.tsx`, `CvCard.tsx`, `ExperienceList.tsx`, `EducationList.tsx`, `SkillsCloud.tsx`, `AwardsList.tsx`
- `sidebar/PersonalDataCard.tsx`, `PersonalityCard.tsx`, `InterestsCard.tsx`, `HobbiesCard.tsx`
- `personality/PersonalityTest.tsx`, `PersonalityBars.tsx`
- Wszystkie sekcje korzystają z istniejących `Inline*` (live-edit dla owner) lub `ReadOnly*` (guest).

## i18n

`src/lib/i18n-profile.ts` — rozszerzenie o klucze: tabs.*, sections.*, personality.axes.*, awards.*, cv.*, hobby.*. Pełne PL/EN.

## Atomic design + tenant_id

- Atomy/molekuły w `components/profile/` jak wyżej.
- Każdy insert/select scoped przez `tenant_id = current_tenant_id()`.
- RLS używa `has_role` z tenant scope (już istnieje).

## Testy

- `src/lib/__tests__/personality.test.ts` — scoring (reverse keying, klamry 0-100).
- `src/components/profile/__tests__/ProfileShell.test.tsx` — render zakładek, sticky sidebar, guest-mode chowa edytory.
- `src/lib/__tests__/profileSlug.test.ts` — walidacja / kolizje.

## Etapy wdrożenia

1. **Migracja** (tabele + RLS + seed 30 pytań Big Five PL/EN).
2. **Server fns** + i18n.
3. **ProfileShell + Sidebar + Tabs** szkielet, zachować obecne sekcje jako fallback.
4. **AboutTab** (Bio, Projekty, Kontakt, CV) — przeniesienie istniejących + CV upload.
5. **ExperienceTab** (Experience, Education, Skills CRUD).
6. **BadgesTab** + **ActivityTab** (refactor obecnych `/profile/bookmarks` itd. jako wbudowane sekcje).
7. **SettingsTab** (linki + inline).
8. **PersonalityCard + /profile/personality** kwestionariusz + scoring.
9. **/u/$slug** publiczna read-only.
10. **Testy + cleanup starych route'ów** (`/profile/billing` itd. nadal działają jako bezpośrednie linki, ale UI domyślnie pokazuje wszystko inline).

## Założenia, które potwierdzę kodem (nie pytaniem)

- Big Five: 30 pytań (6 na oś), skala 1-5, reverse keying, wynik 0-100.
- CV: do 5 wersji per user (najnowsza = AKTUALNE), max 10 MB, mime: pdf/doc/docx.
- Slug profilu już istnieje w `profiles.slug` — wykorzystam.
- Dane już istniejące (bookmarks, follows, interests) nie wymagają migracji.

Po zatwierdzeniu zaczynam od migracji.
