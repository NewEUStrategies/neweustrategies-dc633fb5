# Discussion Club V2 — hierarchia, autoryzacja, zaproszenia, panel administracyjny

Data: 2026-08-07 · Status: **specyfikacja do zatwierdzenia**
Rozszerza: `PROJEKT_MODUL_DISCUSSION_CLUB_2026-08-07.md` (dalej: V1)
Zmiana modelu własności: zarządzanie przenosi się **w całości do panelu admina**
(`admin` + `super_admin`).

---

## 0. Co ta zmiana robi z produktem — przeczytaj przed resztą

V1 zakładał, że wątki zakłada **członek**. V2 przenosi zarządzanie do panelu admina.
To nie jest przesunięcie przycisku — to zmiana gatunku modułu, i warto ją nazwać wprost,
zanim zostanie zaimplementowana.

Gdyby **wszystko** tworzył wyłącznie admin, moduł przestałby być klubem dyskusyjnym,
a stałby się redakcyjną tablicą z komentarzami — czyli czymś, co platforma **już ma**
(komentarze pod wpisem, Q&A). Zniknąłby jedyny powód jego istnienia zdiagnozowany
w V1 §0: brak powierzchni, gdzie członek rozmawia z członkiem jak z równym sobie.

Dlatego V2 rozdziela dwie rzeczy, które łatwo pomylić:

| Warstwa | Kto włada | Co obejmuje |
| ------- | --------- | ----------- |
| **Struktura** | **wyłącznie `admin` / `super_admin`** w panelu | kluby, grupy, uprawnienia, członkostwa, zaproszenia, harmonogram, moderacja, kto w ogóle może założyć temat |
| **Treść** | członkowie w zakresie, który admin im nadał | tematy (jeśli admin na to pozwolił), odpowiedzi, reakcje, stanowiska |

Administrator dostaje **pełną kontrolę nad tym, kto co może** — łącznie z opcją
„tematy zakłada wyłącznie redakcja", jeśli tego chcesz. Ale to jest **ustawienie
w droplistcie**, a nie zabetonowana architektura. Dzięki temu jedna decyzja
konfiguracyjna, a nie przepisanie modułu, przesuwa produkt między „tablica redakcyjna"
a „klub dyskusyjny" — i można to zmienić po pierwszych tygodniach na żywych danych.

**To jest rekomendacja, nie sprzeciw.** Cała reszta dokumentu realizuje Twoje wymaganie:
kompletny system zarządzania w panelu admina.

---

## 1. Rozszerzona hierarchia: klub → grupa → temat

V1 miał dwa poziomy (klub → wątek). V2 wprowadza trzy, zgodnie z Twoim „wątków (grup)
i tematów":

```
KLUB                    przestrzeń z członkostwem, zasadami i progiem wejścia
 └── GRUPA              dział tematyczny wewnątrz klubu (np. „Energia", „Trilogi")
      └── TEMAT         konkretna dyskusja
           └── ODPOWIEDZI   drzewo przycięte do 2 poziomów (V1 §4.4)
```

Środkowy poziom nie jest ozdobą. Klub o polityce UE bez grup po trzech miesiącach
ma sto tematów na jednej liście i staje się nieużywalny. Grupa daje trzy rzeczy,
których płaska lista nie da: **osobną subskrypcję** (chcę „Energię", nie cały klub),
**osobne uprawnienia** (grupa `Zarząd` zamknięta wewnątrz otwartego klubu) i **osobny
rytm** (grupa może być zamrożona bez zamykania klubu).

Grupa dziedziczy ustawienia klubu, ale **każde może nadpisać** — wzorzec „dziedzicz
albo nadpisz" jest w panelu pokazany jawnie (pole z etykietą „dziedziczone z klubu"
i przełącznikiem „nadpisz"), żeby admin widział, co skąd wynika.

### Nowa tabela

```sql
club_groups (
  id uuid PK, tenant_id uuid NOT NULL,
  club_id uuid NOT NULL → clubs ON DELETE CASCADE,
  slug text NOT NULL,                             -- UNIQUE (club_id, slug)
  name_pl/name_en text NOT NULL,
  description_pl/description_en text,
  icon text, accent_color text,
  sort_order integer NOT NULL DEFAULT 0,          -- drag & drop w panelu (@dnd-kit)

  -- Dziedziczenie: NULL = weź z klubu, wartość = nadpisz
  visibility text NULL CHECK (visibility IN ('inherit','members','private','secret')),
  who_can_post text NULL CHECK (who_can_post IN ('members','moderators','staff_only')),
  moderation_mode text NULL CHECK (moderation_mode IN ('post','pre','trusted')),
  min_tier_rank integer NULL,
  attribution_mode text NULL,

  -- Harmonogram (patrz §5)
  opens_at timestamptz, closes_at timestamptz,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','scheduled','active','frozen','archived')),

  anchor_type text, anchor_id text,               -- grupa też może kotwiczyć w dossier
  thread_count integer DEFAULT 0, last_activity_at timestamptz,
  created_by, created_at, updated_at
)
```

`club_threads` z V1 zyskuje `group_id uuid NOT NULL → club_groups`. Klub zawsze ma
co najmniej jedną grupę — przy tworzeniu klubu panel zakłada domyślną **„Ogólna"**,
więc trzypoziomowość nigdy nie jest widoczna dla użytkownika, który jej nie potrzebuje.

---

## 2. System autoryzacji

### 2.1 Trzy warstwy uprawnień

```
1. ROLA PLATFORMY   super_admin · admin · editor · author · user     (public.app_role)
2. ROLA W KLUBIE    lead · moderator · member · observer             (club_members.role)
3. ZDOLNOŚĆ         wyliczana z (1) × (2) × ustawienia klubu/grupy
```

### 2.2 Jedno źródło prawdy: `club_capabilities()`

Największe ryzyko tego modułu to **rozjazd kopii reguły widoczności** rozsypanej po
trzydziestu RPC. Dlatego zdolności wylicza **jedna** funkcja, a każdy inny RPC ją woła:

```sql
CREATE OR REPLACE FUNCTION public.club_capabilities(
  _club_id uuid, _group_id uuid DEFAULT NULL, _user_id uuid DEFAULT auth.uid()
) RETURNS TABLE (
  can_read boolean, can_post_thread boolean, can_reply boolean, can_react boolean,
  can_moderate boolean, can_manage boolean, can_invite boolean,
  can_see_members boolean, can_reveal_author boolean,
  effective_role text, reason text          -- 'reason' zasila UI: DLACZEGO nie wolno
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
```

Pole `reason` jest celowe. Bez niego interfejs mówi „nie możesz", a użytkownik nie wie,
czy ma poprosić o dostęp, wykupić plan, czy poczekać na otwarcie grupy. Zwracamy kod
(`not_member`, `tier_too_low`, `group_frozen`, `banned`, `pre_moderation`, `not_open_yet`),
a UI mapuje go na zdanie **i właściwą akcję**.

### 2.3 Inwariant, którego nie wolno złamać

**`super_admin` musi przechodzić każdą bramkę, którą przechodzi `admin`.**

Klient już tak działa — `useAuth.tsx:173`: `isAdmin = isSuperAdmin || roles.includes("admin")`.
Baza **musi** trzymać to samo. Audyt z 06.08 złapał dokładnie ten rozjazd w innym miejscu:
`profiles_guard_verification` zawężono do samego `admin`, przez co `super_admin` bez osobnej
roli `admin` stracił uprawnienie — a że sterowało ono odznaką eksperta, a odznaka pociąga
dożywotni VIP, skutek był poważny. Zmiana położyła snapshot autoryzacji i całą suitę na `main`.

Wszystkie bramki tego modułu piszemy więc jednym helperem, nigdy inline:

```sql
CREATE OR REPLACE FUNCTION public.is_club_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'super_admin');
$$;
```

Po każdej migracji modułu: `bun run generate:authz-snapshot`. Test parytetu
(`src/lib/authz/__tests__`) porównuje `authzSnapshot.generated.ts` z odtworzeniem ze SQL-a —
rozjazd obleje CI. **Uwaga operacyjna:** `check:authz-snapshot` jest dziś *poza* workflow CI
(otwarta pozycja z audytu), więc dopóki tam nie wejdzie, trzeba go odpalać ręcznie.

### 2.4 Macierz zdolności

`S` = staff (`admin`/`super_admin`) zawsze · `✅` = tak · `⚙️` = zależy od ustawienia
klubu/grupy · `—` = nie

| Zdolność | super_admin | admin | editor | lead | moderator | member | observer | nie-członek |
| -------- | :---------: | :---: | :----: | :--: | :-------: | :----: | :------: | :---------: |
| Tworzy klub / grupę | ✅ | ✅ | — | — | — | — | — | — |
| Edytuje ustawienia klubu | ✅ | ✅ | — | ⚙️ | — | — | — | — |
| Zakłada temat | ✅ | ✅ | ⚙️ | ✅ | ✅ | ⚙️ | — | — |
| Odpowiada | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Reaguje / stanowisko | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| Moderuje treść | ✅ | ✅ | — | ✅ | ✅ | — | — | — |
| Zaprasza | ✅ | ✅ | — | ✅ | ⚙️ | ⚙️ | — | — |
| Zarządza członkami / rolami | ✅ | ✅ | — | ⚙️ | — | — | — | — |
| Ujawnia autora (Chatham) | ✅ | ✅ | — | — | ⚙️ | — | — | — |
| Czyta klub `secret` | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — |

Dwie decyzje warte uzasadnienia:

- **`editor` nie zarządza klubami.** Może zakładać tematy (bo to praca redakcyjna),
  ale struktura należy do `admin` — zgodnie z Twoim wymaganiem.
- **`lead` może dostać zarządzanie członkami** (`⚙️`), ale nigdy strukturą. Prowadzący
  klub potrzebuje przyjmować ludzi; nie potrzebuje zmieniać widoczności klubu.
- **Ujawnienie autora jest zablokowane dla `lead`.** Prowadzący jest stroną dyskusji,
  więc dostęp do tożsamości anonimowych wypowiedzi byłby konfliktem interesu.
  Zostaje przy `admin` i — na `⚙️` — przy moderatorze niezaangażowanym w spór.

Macierz nie jest komentarzem: renderuje się z niej strona `/admin/permissions`,
a `permissionRows.ts` dostaje nowy blok `club`.

---

## 3. System zaproszeń

### 3.1 Cztery ścieżki, jeden panel

| Ścieżka | Adresat | Mechanizm | Kiedy |
| ------- | ------- | --------- | ----- |
| **A. Bezpośrednia** | istniejący członek platformy | `club_invitations` + powiadomienie | codzienna |
| **B. E-mailowa** | ktoś spoza platformy | **istniejące `user_invitations`** + e-mail | pozyskanie |
| **C. Link** | grupa nieznanych z góry | `club_invite_links` (token, limit, wygasanie) | konferencja, newsletter |
| **D. Segmentowa** | zbiór wyliczony z danych | kolejka B/A wg reguły | kampania |

### 3.2 Ścieżka B reużywa istniejący system

`user_invitations` ma już wszystko: `email`, `role`, `mode` (`magic_link`/`temp_password`),
`status` (`pending`/`sent`/`accepted`/`revoked`/`failed`), `expires_at`, `invited_by`,
`last_error`, `source` oraz **`metadata jsonb`**. Nie budujemy drugiego systemu — wpinamy się:

```jsonc
// user_invitations.source = 'club'
// user_invitations.metadata =
{ "club_id": "…", "group_id": "…", "club_role": "member", "invited_by_name": "…" }
```

Po akceptacji trigger `tg_user_invitations_enroll_club` czyta `metadata` i zakłada wiersz
w `club_members` ze statusem `active`. Użytkownik ląduje **od razu w klubie**, a nie
na pustym pulpicie — to różnica między zaproszeniem, które działa, a takim, które
technicznie zadziałało.

**Uwaga na pułapkę typu:** `user_invitations.role` jest typu `public.app_role`
(`admin`/`editor`/`author`/`super_admin`/`user`) i oznacza rolę **platformy**. Rola w klubie
to osobna oś i **musi** jechać w `metadata.club_role`. Wpisanie roli klubowej do `role`
nadałoby komuś uprawnienia redakcyjne całej platformy — to jest najgroźniejszy możliwy
błąd w tym module i pgTAP ma go pilnować wprost.

### 3.3 Linki zapraszające

```sql
club_invite_links (
  id uuid PK, tenant_id, club_id, group_id NULL,
  token text NOT NULL UNIQUE,          -- 32 B losowe, base64url; NIGDY sekwencyjne
  label text,                          -- „Konferencja Bruksela 09.2026" - do statystyk
  club_role text NOT NULL DEFAULT 'member',
  max_uses integer, used_count integer NOT NULL DEFAULT 0,
  requires_approval boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by, created_at
)
club_invite_link_uses (link_id, user_id, used_at, PRIMARY KEY (link_id, user_id))
```

Wykorzystanie przez `club_redeem_invite_link(token)` — atomowo: sprawdź ważność, limit,
wygaśnięcie, blokady, próg planu → wstaw `club_members` → zapisz użycie → zwróć slug klubu.
Limit i licznik w **jednej** transakcji, inaczej równoległe wejścia przekroczą `max_uses`.

`requires_approval` daje wariant „link wpuszcza do poczekalni, nie do klubu" — potrzebny
przy linku w newsletterze, gdzie nie wiadomo, kto kliknie.

### 3.4 Zaproszenia segmentowe

Admin wybiera regułę z droplisty zamiast eksportować CSV:

- posiadacze odznaki *(droplista z `profile_badges`)*
- poziom reputacji ≥ *(droplista z `REPUTATION_LEVELS`)*
- obserwujący dossier *(autocomplete z `eu_policy_items`)*
- uczestnicy wydarzenia *(droplista z `events` + status RSVP)*
- członkowie innego klubu / grupy
- plan członkowski ≥ *(droplista z `membership_tiers`)*
- specjalizacja / lokalizacja *(fasety z `people_filter_options` — te same, co na `/people`)*

Panel pokazuje **podgląd liczebności przed wysyłką** („reguła obejmuje 47 osób;
12 jest już w klubie; 3 mają wyłączone zaproszenia — wyśle się 32"). Wysyłka wchodzi
do kolejki i respektuje `notification_preferences` oraz `user_blocks`.

### 3.5 Antyspam i higiena

Limity w DB, nie w kliencie: 200 zaproszeń / dzień na admina · 20 na `lead` ·
1 aktywne zaproszenie na parę (osoba, klub) · wygasanie domyślnie 30 dni ·
odrzucone zaproszenie blokuje ponowne przez 90 dni (chyba że wysyła `admin`) ·
zaproszenie **nigdy** nie omija `user_blocks`.

---

## 4. Panel administracyjny

### 4.1 Nawigacja

W `CommunitySubNav.tsx` dochodzi zakładka między „Chat" a „Wydarzenia":

```ts
{ to: "/admin/community/clubs", key: "clubs", icon: MessagesSquare,
  labelPl: "Kluby dyskusyjne", labelEn: "Discussion clubs", exact: false }
```

Trasy:

```
/admin/community/clubs              lista klubów + „Nowy klub"
/admin/community/clubs/$id          edytor klubu (9 zakładek, poniżej)
/admin/community/clubs/$id/groups/$groupId   edytor grupy
/admin/community/moderation         wspólna kolejka moderacji (kluby + komentarze)
```

Bramka: `admin.tsx` wpuszcza `isStaff`, więc **trasa klubów dokłada własny warunek
`isAdmin`** (który zawiera `super_admin`) i pokazuje `editor`/`author` stan „brak
uprawnień" zamiast pustej strony. Bramka po stronie serwera i tak jest w RPC — UI tylko
nie kłamie o dostępności.

### 4.2 Lista klubów

Tabela (`ui/table.tsx`) z kolumnami: nazwa + ikona · widoczność *(Badge)* · grupy ·
członkowie · tematy · ostatnia aktywność · status · akcje.

Nad tabelą pasek filtrów z **droplist** (Radix `Select`, wzorzec z `admin.community.events.tsx:110`):
status · widoczność · obszar polityki · prowadzący (`MemberPicker`). Obok pole wyszukiwania
z debounce 250 ms — ta sama wartość, co w `/people` i `/network`.

Zaznaczenie wierszy → `BulkActionsBar` (istniejący komponent): archiwizuj · zmień
widoczność · przypisz prowadzącego · eksportuj członków.

### 4.3 Edytor klubu — dziewięć zakładek

Radix `Tabs`, stan w URL (`?tab=`), tak jak `/network`.

**1 · Ogólne** — nazwa PL/EN *(FloatingInput)*, slug z auto-generowaniem i ostrzeżeniem
przy zmianie, tagline, opis *(FloatingTextarea)*, ikona *(picker nad `icon_library` — wzorzec z `admin/menu/MenuManager.tsx`)*,
kolor akcentu *(`admin/theme-design/molecules/ColorControl.tsx`)*, okładka *(`CoverImagePicker`)*,
obszar polityki *(droplista — te same 10 wartości, co `eu_policy_items.policy_area`)*.

**2 · Dostęp** — cztery droplisty + `SaveBar`:
widoczność · polityka wstępu · minimalny plan *(z `membership_tiers` posortowanych po `rank`)*
· tryb atrybucji *(V1 §1.2)*. Pod spodem **żywy podgląd zdania**:
„Klub widoczny dla zalogowanych. Wejście na zaproszenie. Wymaga planu Pro.
Wypowiedzi podpisane." — jedno zdanie zamiast czterech pól do samodzielnego złożenia.

**3 · Grupy** — lista z drag & drop (`@dnd-kit`, już w zależnościach; ten sam wzorzec,
co kolejność bloków w builderze). Wiersz: nazwa · widoczność *(z etykietą „dziedziczone"
gdy `NULL`)* · kto może zakładać temat · tematy · status. Dialog tworzenia z polem
„dziedzicz z klubu / nadpisz" przy każdym ustawieniu.

**4 · Tematy** — lista wszystkich tematów klubu z filtrami *(grupa, rodzaj, status, autor)*.
Akcje: przypnij · zablokuj · przenieś do innej grupy *(droplista)* · scal · usuń.
Przycisk **„Nowy temat"** — admin zakłada temat **w imieniu klubu** albo wskazanego autora
(`MemberPicker`), z opcją publikacji zaplanowanej *(§5)*.

**5 · Członkowie** — tabela: osoba *(awatar + odznaki + poziom reputacji)* · rola
*(droplista inline: lead/moderator/member/observer)* · status · dołączył · ostatnia
aktywność · liczba postów. Filtry po roli i statusie. Bulk: zmień rolę · usuń · zbanuj ·
wyślij wiadomość. Dodanie osoby przez `MemberPicker` — komponent **już istnieje**
w `admin/community/`, więc zero nowego kodu wyszukiwania osób.

**6 · Zaproszenia** — trzy panele w jednym ekranie:
- *Wyślij* — przełącznik ścieżki (osoba / e-mail / segment), pod spodem właściwa kontrolka
  (`MemberPicker` / pole e-mail z walidacją i wklejeniem listy / builder reguły z §3.4),
- *Linki* — tabela linków z `label`, wykorzystaniem `used_count/max_uses`, datą wygaśnięcia
  *(`DateTimePicker`)*, przyciskiem kopiowania i „unieważnij",
- *Historia* — tabela jak `admin.users.invitations.tsx`: osoba · kanał · status *(Badge)* ·
  wysłano · wygasa · akcje (ponów / unieważnij).

**7 · Uprawnienia** — czytelna macierz z §2.4, ale **dla tego klubu**: wiersze = zdolności,
kolumny = role, komórki `⚙️` klikalne. Pod spodem „Podgląd jako…" (`MemberPicker`) —
pokazuje wynik `club_capabilities()` dla wskazanej osoby wraz z `reason`. To jest
najtańszy sposób na uniknięcie klasy błędów „myślałem, że ma dostęp".

**8 · Moderacja** — kolejka oczekujących *(gdy `moderation_mode` ≠ `post`)*, zgłoszenia
z `report_user`, log `club_moderation_log`. Akcje wsadowe: zatwierdź · ukryj · usuń ·
zbanuj autora. Ujawnienie autora (Chatham) za osobnym potwierdzeniem *(`ConfirmDialog`)*
z polem „powód" — trafia do `audit_log`.

**9 · Statystyki** — `StatCard`-y jak na `/admin/community` (wzorzec `admin.community.index.tsx:115`):
członkowie · aktywni 30 dni · tematy · odpowiedzi · mediana czasu do pierwszej odpowiedzi ·
**odsetek tematów bez odpowiedzi**. Ostatnia metryka jest najważniejsza i dlatego jest
na karcie, a nie w rozwijanym raporcie: temat bez odpowiedzi to porażka klubu.

### 4.4 Mapowanie na istniejące komponenty

Zero nowych prymitywów — wszystko z tego, co platforma ma:

| Potrzeba | Komponent | Wzorzec w kodzie |
| -------- | --------- | ---------------- |
| Droplista | `ui/select.tsx` (Radix) | `admin.community.events.tsx:110` |
| Data i godzina | `ui/datetime-picker.tsx` + `ui/calendar.tsx` | `DateTimePicker` |
| Wybór osoby | `admin/community/MemberPicker.tsx` | istnieje |
| Tabela | `ui/table.tsx` | `admin.users.invitations.tsx` |
| Dialog | `ui/dialog.tsx` | `CreateEventDialog` |
| Potwierdzenie | `admin/ConfirmDialog.tsx` | istnieje |
| Zapis ustawień | `admin/settings/fields.tsx` → `SaveBar` | `admin.settings.discussion.tsx` |
| Akcje wsadowe | `admin/BulkActionsBar.tsx` | istnieje |
| Kolejność | `@dnd-kit` | builder bloków |
| Zakładki | `ui/tabs.tsx` | `/network` |
| Statusy | `ui/badge.tsx` | wszędzie |
| Statystyki | `StatCard` | `admin.community.index.tsx` |
| Okładka | `admin/CoverImagePicker.tsx` | istnieje |
| Kolor akcentu | `admin/theme-design/molecules/ColorControl.tsx` | istnieje |
| Ikona | wzorzec z `admin/menu/MenuManager.tsx` nad `icon_library` | istnieje |
| Podnawigacja | `admin/community/CommunitySubNav.tsx` | +1 zakładka |

---

## 5. Harmonogram — gdzie kalendarze robią realną robotę

Pięć miejsc, w których data jest mechanizmem, a nie ozdobą. Wszystkie przez
`DateTimePicker`, wszystkie egzekwowane w bazie przez `jobs-tick` (wzorzec
`publish_due_posts`, pg_cron co minutę).

1. **Publikacja zaplanowana** — klub/grupa/temat ze statusem `scheduled` i `opens_at`
   wchodzi na żywo automatycznie. Pozwala przygotować cały klub przed konferencją
   i otworzyć go co do minuty.
2. **Okno dyskusji** — `closes_at` na grupie lub temacie zamyka wątek do odczytu.
   Konsultacja publiczna ma termin; po nim dyskusja zostaje jako dokument.
3. **Cykl klubu** — powiązanie z `events`: klub może mieć harmonogram spotkań,
   a każde spotkanie automatycznie zakłada temat („Podsumowanie sesji z 12.09")
   i wpina nagranie po fakcie.
4. **Kadencja roli** — `club_members.role_expires_at`. Moderator na kwartał wraca
   do roli `member` bez ręcznej pracy admina. Wygaśnięcie idzie z powiadomieniem
   na 7 dni przed.
5. **Wygasanie zaproszeń i linków** — `expires_at` (§3).

Wszystkie pięć czyta **jeden** job `club_scheduler_tick`, dopisany do istniejącego
`scripts/scheduler-tick.mjs`. Nie zakładamy nowego crona — runbook społeczności
opisuje już jeden kanoniczny potok doręczeń i drugi by go rozspoił.

---

## 6. Rozszerzenia architektury względem V1

### 6.1 Nowe tabele

`club_groups` *(§1)* · `club_invite_links` + `club_invite_link_uses` *(§3.3)* ·
`club_role_grants` *(audyt nadań ról — kto, komu, kiedy, do kiedy)* ·
`club_segment_rules` *(zapisane reguły segmentów z §3.4, żeby kampanię dało się powtórzyć)*

`club_threads` zyskuje `group_id`; `club_members` zyskuje `role_expires_at`,
`invited_by`, `invite_source` (`direct`/`email`/`link`/`segment`/`auto`) — ostatnie pole
pozwala zmierzyć, **która ścieżka zaproszeń faktycznie dowozi aktywnych członków**.

### 6.2 Nowe zdarzenia domenowe

Do `DOMAIN_EVENT_TYPES` dochodzi ponad zestaw z V1:

```
club_group.created.v1 · club_group.status_changed.v1
club_invitation.sent.v1 · club_invitation.accepted.v1 · club_invitation.revoked.v1
club_invite_link.redeemed.v1
club_member.role_granted.v1 · club_member.role_expired.v1
club_moderation.action.v1
```

Każde z wpisem w `eventInvalidationMap.ts` — reguła z `ARCHITECTURE.md` §5.1 nie ma wyjątków.

`club_invitation.accepted.v1` warto od razu wpiąć w `workflow_definitions`: przyjęcie
zaproszenia może uruchomić powitanie, nadanie odznaki albo wpis do CRM — bez nowego kodu,
samym przepisem w `workflow_templates`.

### 6.3 Flaga modułu

`CommunityModulesSettings` dostaje `clubs_enabled: boolean` (domyślnie `false` — moduł
włącza się świadomie, a nie pojawia się wszystkim po deployu). Wyłączenie chowa moduł
z nawigacji użytkownika bez rebuildu, jak każdy inny.

### 6.4 Liczniki

`tenant_pending_counters` dostaje `club_moderation_pending` i `club_join_requests` —
badge przy zakładce „Kluby" w panelu. Triggery, nie `COUNT(*)`.

---

## 7. Bramki CI — co dochodzi względem V1

| Bramka | Nowy wymóg |
| ------ | ---------- |
| **pgTAP** | macierz z §2.4 w komplecie · `super_admin` przechodzi wszędzie tam, gdzie `admin` *(inwariant §2.3)* · rola klubowa **nigdy** nie trafia do `user_invitations.role` · `max_uses` odporny na równoległe wejścia · dziedziczenie `NULL` → wartość klubu · `role_expires_at` realnie odbiera uprawnienia |
| `check:authz-snapshot` | regeneracja po każdej migracji modułu; **wpiąć do CI** (dziś poza workflow) |
| `check:permissions-parity` | nowy blok `club` w `permissionRows.ts` |
| `check:i18n-parity` + key-usage | prefiksy `club` i `adminClubs`, zero `defaultValue` |
| `check:bundle` | panel admina za `lazy()`; budżety są dziś czerwone (+30,6 / +87,9 / +124,0 KB) |
| vitest | `club_capabilities` jako czysta funkcja mapująca · builder reguł segmentu · dziedziczenie ustawień grupy |

---

## 8. Etapy — zaktualizowane

V1 miał pięć etapów przy modelu członkowskim. Model administracyjny **odwraca kolejność**:
struktura i uprawnienia muszą stać, zanim ktokolwiek napisze pierwsze zdanie.

**A1 — Struktura i panel.** `clubs`, `club_groups`, `club_members`, `club_capabilities`,
`is_club_admin`, trasy `/admin/community/clubs` + edytor (zakładki 1–3, 5), snapshot
autoryzacji, pgTAP macierzy. *Efekt: admin tworzy kluby i grupy, dodaje ludzi. Bez treści.*

**A2 — Zaproszenia.** Cztery ścieżki *(§3)*, zakładka 6, wpięcie w `user_invitations`,
limity, wygasanie. *Efekt: klub da się zapełnić.*

**A3 — Treść.** `club_threads` + `club_replies` + zakładka 4 + publiczne trasy `/club/*`.
*Efekt: moduł działa końcowo.*

**A4 — Interakcja.** Reakcje, wzmianki, subskrypcje, powiadomienia z **kompletem**
producentów *(V1 §6.4)*, liczniki.

**A5 — Zarządzanie w skali.** Moderacja *(zakładka 8)*, harmonogram *(§5)*, kadencje ról,
statystyki *(zakładka 9)*, segmenty.

**A6 — Odkrywalność.** FTS `polish`, embeddingi, zakładka w wyszukiwarce, widgety buildera,
digest.

A1 i A2 są w całości administracyjne — to znaczy, że po dwóch etapach masz **działający
system zarządzania** i możesz zdecydować o reszcie na podstawie tego, jak się nim pracuje.

---

## 9. Decyzje do podjęcia

Trzy z V1 zostają otwarte *(Chatham House, anonimizacja przy usunięciu konta, płatność)*.
Dochodzą trzy nowe:

1. **Czy członek może założyć temat?** *(§0)* Rekomendacja: droplista `who_can_post`
   z domyślną wartością `moderators` na start i przejściem na `members` w wybranych
   grupach po pierwszym miesiącu. Ustawienie, nie architektura — ale trzeba wybrać domyślną.
2. **Czy `lead` może zarządzać członkami?** Rekomendacja: **tak** (`⚙️` włączone),
   inaczej każde dołączenie przechodzi przez admina i klub stoi.
3. **Czy zaproszenia e-mailowe mogą zakładać konta?** `user_invitations` to potrafi
   (`magic_link`). Rekomendacja: tak, ale **wyłącznie** z `metadata.club_role` i rolą
   platformy `user` — nigdy z rolą redakcyjną *(§3.2)*.
