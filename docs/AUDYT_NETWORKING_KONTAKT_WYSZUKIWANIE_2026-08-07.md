# Audyt domeny „platforma kontaktu, wyszukiwania i networkingu użytkowników"

Data: 2026-08-07 · Zakres: przekrojowo przez moduły 6, 9, 10, 15, 16 (wyszukiwarka, czat, sieć,
profil, społeczność) potraktowane jako **jedna domena produktowa**: „człowiek znajduje człowieka,
nawiązuje relację i utrzymuje ją w czasie".

Poprzednie audyty oceniały te moduły **osobno**. Ten patrzy na nie jak na jeden lejek i pyta o coś
innego: czy z tych klocków składa się produkt klasy światowej — i czego w nich brakuje.

---

## 0. Metoda i granice pomiaru (czytać przed liczbami)

**Co zmierzyłem**: kod źródłowy, 643 migracje SQL, kontrakty RPC, testy pgTAP, powierzchnia tras
i komponentów. Wszystkie twierdzenia poniżej mają odniesienie `plik:linia` albo nazwę funkcji SQL.

**Czego NIE zmierzyłem — i dlaczego**: w tym środowisku nie udało się zainstalować zależności.
Proxy rejestru npm zwraca **403** na część paczek (`@radix-ui/react-arrow`, `is-promise`,
`call-bound`, `es-object-atoms`, `inherits`, `@lovable.dev/vite-tanstack-config` i in.). Skutkiem
jest niekompletne `node_modules`, więc:

- `tsc --noEmit` wysypuje się kaskadą `TS7031/TS7006` z brakującego modułu konfiguracji Vite,
- `vitest run src/components/network src/lib/network` daje **16 plików failed / 1 passed**, przy
  czym wszystkie błędy to `Failed to resolve import` — **nie defekty kodu**.

Te dwa wyniki są **artefaktem piaskownicy i nie wolno ich czytać jako regresu**. Sygnały CI
przytaczam więc za ostatnim pomiarem własnym repozytorium (`OCENA_FUNKCJI_TABELE_2026-08-06_R2.md`,
HEAD `22b711a`) i oznaczam jako **cytowane**, nie zmierzone tutaj. Audyt funkcjonalny — czyli to,
o co pytasz — nie zależy od tych bramek i opiera się w całości na lekturze kodu i schematu.

---

## 1. Mapa domeny — inwentarz (zmierzony)

| Warstwa             |            Liczba | Uwaga                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | ----------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabele domenowe     |            **29** | `user_connections`, `user_follows`, `user_blocks`, `user_reports`, `user_invitations`, `introduction_requests`, `profile_recommendations`, `profile_skills`, `profile_skill_endorsements`, `profile_experiences`, `profile_education`, `profile_awards`, `profile_hobbies`, `profile_cv_files`, `profile_badges`, `profile_view_events`, `meeting_slots`, `meeting_bookings`, `conversations`, `conversation_participants`, `conversation_nicknames`, `messages`, `message_reactions`, `message_stars`, `speaker_profiles`, `event_speakers`, `event_rsvps`, `member_organizations`, `organization_seats` |
| RPC domenowe        |           **128** | Z tego **108** to `SECURITY DEFINER` z zakresem tenanta; reszta to funkcje pomocnicze i triggerowe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Migracje SQL (repo) |           **643** | +22 od pomiaru z 06.08                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| pgTAP w domenie     |       **25 / 79** | ~32% całej suity kontraktowej DB dotyczy tej domeny                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Trasy               |            **28** | `/people`, `/network`, `/network/mutual/$userId`, `/messages`, `/search`, `/experts`, `/author/$slug`, 20× `/profile/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Komponenty          |    **114 plików** | `network` 27 · `chat` 32 · `profile` 22 · `search` 18 · `experts` 9 · `events` 6 (z testami)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Kod domeny          | **≈33 400 linii** | z czego `chat` 13 566, `profile` 8 276, `network` 7 387, `search` 4 143                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**To nie jest prototyp.** Skala i dyscyplina schematu są tu na poziomie dojrzałego produktu.

---

## 2. Ocena modułów domeny

### M-A. Tożsamość i profil zawodowy · **8,4/10**

| Funkcja                                                      | Ocena | ✅ Dobry                                                                                                                                                                                                                                            | ⚠️ Słaby                                                                                              | 🔧 Rekomendacja                              |
| ------------------------------------------------------------ | :---: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Dorobek (doświadczenie, edukacja, umiejętności, nagrody, CV) | **9** | Sześć osobnych tabel z `sort_order`, edycja optymistyczna z rollbackiem, CV w prywatnym buckecie (`ProfileExtraSections.tsx`)                                                                                                                       | —                                                                                                     | Utrzymać                                     |
| Profil publiczny `/author/$slug`                             | **8** | Warunkowa indeksowalność: zwykły członek bez zgody dostaje `noindex,nofollow` „ZAWSZE" (`author.$slug.tsx:292-304`); sekcje CV, rekomendacje i endorsementy renderowane                                                                             | —                                                                                                     | Utrzymać                                     |
| Weryfikacja tożsamości                                       | **8** | `verified_at/by` pod guardem `profiles_guard_verification()`, weryfikacja po domenie e-mail (`verification_domains`)                                                                                                                                | Krąg uprawnionych zawężony do samego `admin` — otwarta pozycja z audytu 06.08 (M16)                   | Rozstrzygnąć intencję, zregenerować snapshot |
| Odznaki zaufania                                             | **9** | Jeden katalog zgodny z CHECK w DB, `grant_source`, auto-grant z reputacji, batchowany odczyt (`useBadgesForUsers`)                                                                                                                                  | —                                                                                                     | Utrzymać                                     |
| Prywatność i kontrola kontaktu                               | **9** | **Siedem** niezależnych przełączników: `discoverable`, `hide_avatar`, `expert_requests_enabled`, `allow_messages_from`, `allow_connections_from` (`everyone`/`mutual`/`nobody`), `read_receipts`, `show_online` (`VisibilityAndContactSection.tsx`) | —                                                                                                     | Utrzymać (wzorzec)                           |
| **Miernik kompletności profilu**                             | **0** | —                                                                                                                                                                                                                                                   | **Nie istnieje.** `contentStatus.ts` liczy kompletność SEO dla wpisów; dla profilu członka nie ma nic | **Patrz luka #3**                            |
| **Sygnały intencji („otwarty na…")**                         | **0** | —                                                                                                                                                                                                                                                   | **Nie istnieje** żadne pole intencji                                                                  | **Patrz luka #2**                            |

### M-B. Odkrywanie: katalog osób · **8,0/10**

| Funkcja                        | Ocena | ✅ Dobry                                                                                                                                                                                                                      | ⚠️ Słaby                                                                                                                                         | 🔧 Rekomendacja                   |
| ------------------------------ | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `/people` — katalog            | **8** | Consent-first (wpis wymaga `discoverable`), `noindex` + odrzucenie anonima w RPC, cztery fasety z licznikami, batchowane odznaki **i** batchowane statusy relacji (jeden RPC na partię, nie N zapytań — `people.tsx:261-266`) | Paginacja „pokaż więcej" bez zapamiętania pozycji przy powrocie                                                                                  | Zachować offset w URL             |
| Baner zgody na widoczność      | **9** | Uczciwy: tłumaczy skutek zanim użytkownik wejdzie do katalogu (`DiscoverabilityBanner`)                                                                                                                                       | —                                                                                                                                                | Utrzymać                          |
| `/experts` — katalog publiczny | **8** | Indeksowalny, realny lejek pozyskania                                                                                                                                                                                         | Brak wpięcia w graf: z karty eksperta nie ma ścieżki „poznaj przez wspólny kontakt"                                                              | Dodać `RequestIntroductionButton` |
| Zapisane wyszukiwania osób     | **2** | Infrastruktura istnieje (`saved_searches`, `run_saved_search_alerts`, pg_cron)                                                                                                                                                | **Alerty biegną wyłącznie po `posts`** (`20260720170000_saved_search_alerts.sql:220`). Nie da się ustawić „powiadom mnie, gdy dołączy ktoś taki" | **Patrz luka #4**                 |

### M-C. Wyszukiwanie ludzi i organizacji · **7,4/10**

| Funkcja                           | Ocena | ✅ Dobry                                                                                                                                                  | ⚠️ Słaby                                                                                                                                                                                               | 🔧 Rekomendacja                                     |
| --------------------------------- | :---: | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| Wyszukiwanie leksykalne osób      | **8** | `search_people` + `search_chat_contacts` (indeksowany), trgm + unaccent (diakrytyki bez znaczenia), escapowanie LIKE, pgTAP `people_search_trgm_test.sql` | —                                                                                                                                                                                                      | Utrzymać                                            |
| Fasety i filtry                   | **8** | `people_filter_options` — specjalizacja / firma / stanowisko / lokalizacja + „tylko zweryfikowani"                                                        | Fasety płaskie, bez hierarchii (kraj → miasto)                                                                                                                                                         | Poddrzewo jak w `search_posts`                      |
| Zakładki wyszukiwarki             | **7** | Cztery: `posts`, `topics`, `people`, `experts` (`overlayTabs.ts:9`) — jedno równoległe zapytanie, prawdziwe liczniki                                      | Brak zakładki **organizacji**, mimo że `search_companies_public` istnieje                                                                                                                              | Dopiąć piątą zakładkę                               |
| **Wyszukiwanie semantyczne osób** | **0** | pgvector jest wdrożony i działa — 768 wymiarów, indeks HNSW, kolejka indeksera w aplikacji                                                                | **Wektory istnieją wyłącznie dla wpisów** (`post_embeddings`). Zero embeddingów profilu. Zapytanie „kto zna się na CBAM i siedzi w Brukseli" trafia w trgm, czyli w literalne dopasowanie ciągu znaków | **Patrz luka #1 — to jest luka nr 1 całego audytu** |

### M-D. Graf połączeń · **8,6/10**

| Funkcja                               | Ocena  | ✅ Dobry                                                                                                                                                                                              | ⚠️ Słaby                                                                                                                                                                                                     | 🔧 Rekomendacja                                |
| ------------------------------------- | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| Model relacji                         | **9**  | Jeden wiersz na parę (unikalny indeks na `LEAST/GREATEST`), `pending → accepted/declined`, **zero grantów** dla klienta — cała powierzchnia to RPC                                                    | —                                                                                                                                                                                                            | Utrzymać (wzorzec dla reszty platformy)        |
| Prywatność odmowy                     | **10** | Odmowa jest **niewidoczna dla zapraszającego** — jego zaproszenie wygląda na wciąż oczekujące, a baza nie zdradza statusu nawet przy bezpośrednim `SELECT`. To projekt, nie przypadek                 | —                                                                                                                                                                                                            | Utrzymać                                       |
| Krzyżujące się zaproszenia            | **9**  | Automatyczna akceptacja — obie strony wyraziły intencję; obsłużony też przypadek „A zaprosił, B odrzucił, B jednak zaprasza A"                                                                        | —                                                                                                                                                                                                            | Utrzymać                                       |
| Spójność z blokadą                    | **9**  | `tg_user_blocks_sever_connection` — nowa blokada **zrywa** istniejące połączenie; jeden stan między czatem a siecią                                                                                   | —                                                                                                                                                                                                            | Utrzymać                                       |
| Antyspam                              | **8**  | Limit **30 zaproszeń / 24 h** egzekwowany w DB (`20260717123000:412-417`), nie w kliencie                                                                                                             | Limit stały, nieczuły na reputację i staż konta                                                                                                                                                              | Próg zależny od poziomu reputacji              |
| Sugestie („osoby, które możesz znać") | **6**  | Uczciwy, czytelny heurystyk: 2. stopień ×3, wspólne dossier ×2 (sufit 5), wspólne wydarzenia ×2 (sufit 5), zgodność firmy/specjalizacji/lokalizacji; sufity chronią przed dominacją „power-followera" | **(a)** brak pętli zwrotnej — odrzucona sugestia **wraca w nieskończoność**; **(b)** zapytanie liczy trzy skorelowane agregaty nad **wszystkimi** `discoverable` profilami tenanta bez pre-filtra kandydatów | **Patrz luki #5 i #9**                         |
| **Stopień oddalenia (1./2./3.)**      | **0**  | 2. stopień jest **liczony** wewnątrz `connection_suggestions`                                                                                                                                         | …i nigdzie nie **pokazany**. Brak etykiety „2°", brak ścieżki „Ty → Anna → Marek"                                                                                                                            | **Patrz luka #6**                              |
| Pokrycie testowe klienta              | **8**  | Po wdrożeniu z 06.08: komponenty `network` 99% stmts / 100% funcs, 235 przypadków, własna bramka i18n                                                                                                 | `src/lib/network`: 3 pliki testów na 9 modułów i 1 856 linii hooków                                                                                                                                          | Unit testy `useConnections`/`useIntroductions` |

### M-E. Kontakt: czat, wprowadzenia, zapytania do eksperta · **8,2/10**

| Funkcja                      | Ocena | ✅ Dobry                                                                                                                          | ⚠️ Słaby                                                                                                      | 🔧 Rekomendacja                         |
| ---------------------------- | :---: | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| DM 1:1                       | **8** | Dedup konwersacji odporny na wyścig, okno edycji 5 min, RLS v2 z helperem `SECURITY DEFINER`                                      | Kursor paginacji bez tiebreakera `id` (pozycja otwarta)                                                       | Dodać `id` do kursora                   |
| Bramka „kto może pisać"      | **9** | `chat_allow_messages_from` + `chat_accepts_new_thread` — polityka odbiorcy egzekwowana w DB, nie w UI                             | —                                                                                                             | Utrzymać                                |
| Grupy                        | **7** | `create_group_conversation`, member picker, opis grupy, wyjście z grupy                                                           | Grupy są **ad hoc** — brak trwałych kręgów tematycznych                                                       | **Patrz luka #8**                       |
| Wydarzenie → grupa           | **8** | `create_event_group` idempotentne: host zamienia listę RSVP w trwały krąg (`EventGroupButton.tsx`)                                | Tylko host/staff; uczestnik nie może zaproponować kręgu                                                       | Rozważyć wniosek uczestnika             |
| Wprowadzenia (introductions) | **8** | Pełna trójstronna pętla `request_introduction` → `respond_introduction`, race-safe, pgTAP `introductions_flow_test.sql`           | **Brak powiadomienia** — patrz niżej                                                                          | **Patrz luka #7**                       |
| Zapytania do eksperta        | **8** | Skrzynka + zakładka w `/messages`, bramka dwustopniowa (tenant × per-user), od 06.08 własny rodzaj powiadomienia `expert_request` | —                                                                                                             | Utrzymać                                |
| Wyszukiwarka w wiadomościach | **6** | `search_vector` + RPC z powtórzonym RLS                                                                                           | Konfiguracja `simple` = **zero fleksji**, wbrew komentarzowi „polska fleksja". Szóste wydanie                 | Zmienić słownik albo poprawić komentarz |
| „Zgłoś" z okna czatu         | **5** | `report_user` + kolejka admina istnieją i działają z poziomu sieci                                                                | Wejścia **nadal nie ma w `MessageBubble`** — czyli tam, gdzie nadużycie faktycznie się dzieje. Szóste wydanie | Wejście „Zgłoś" z dymka wiadomości      |
| Demo-bot                     | **4** | Uczciwie opisany jako lokalny podgląd                                                                                             | 562 linie na echo bez backendu                                                                                | Wyciąć albo podłączyć                   |

### M-F. Kapitał zaufania i reputacja · **8,3/10**

| Funkcja                   | Ocena | ✅ Dobry                                                                                                                                                                       | ⚠️ Słaby                                                     | 🔧 Rekomendacja               |
| ------------------------- | :---: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------- |
| Rekomendacje pisane       | **8** | `write_recommendation` / `respond_recommendation` / `list_recommendations`, słownik relacji (`recommendation_relationships`), RPC rzuca na nieznany czasownik, pgTAP kontraktu | Brak powiadomienia o otrzymanej rekomendacji                 | Patrz luka #7                 |
| Endorsementy umiejętności | **8** | `endorse_skill` / `unendorse_skill` / `skill_endorsement_counts`                                                                                                               | j.w. + brak porządkowania umiejętności wg liczby potwierdzeń | Sortowanie po `count`         |
| Kto oglądał mój profil    | **8** | `record_profile_view` + `my_profile_viewers` + `profile_view_stats`, karta na `/profile`                                                                                       | Brak powiadomienia i brak trendu w czasie                    | Patrz luka #7                 |
| Zgłoszenia i moderacja    | **8** | `report_user`, `admin_list_user_reports`, `admin_resolve_user_report`, liczniki                                                                                                | Brak wejścia z czatu (M-E)                                   | j.w.                          |
| Reputacja i leaderboard   | **8** | `/contributors`, poziomy, `ReputationLevelChip` wpięty w karty osób                                                                                                            | Progi auto-grantu żyją w SQL, bez panelu                     | Wystawić progi w ustawieniach |

### M-G. Konwersja na spotkanie · **7,0/10**

| Funkcja             | Ocena | ✅ Dobry                                                                                                                                                          | ⚠️ Słaby                                                                                               | 🔧 Rekomendacja                                         |
| ------------------- | :---: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Sloty i rezerwacje  | **8** | Pełny zestaw: `create_my_meeting_slot`, `get_public_meeting_slots`, `book_meeting_slot`, `cancel_my_meeting_booking`; widget buildera `meeting-booking` z testami | **Brak powiadomienia o rezerwacji** — ktoś rezerwuje Twój czas, a Ty się nie dowiadujesz w aplikacji   | **Patrz luka #7 — to najostrzejszy przypadek tej luki** |
| Kalendarz           | **6** | `AddToCalendar` (ICS)                                                                                                                                             | Brak dwustronnej synchronizacji z Google/Outlook — sloty trzeba utrzymywać ręcznie, więc szybko kłamią | **Patrz luka #10**                                      |
| Wideo               | **0** | —                                                                                                                                                                 | Brak jakiegokolwiek połączenia audio/wideo (zero trafień na WebRTC/Jitsi/Daily/Whereby)                | **Patrz luka #10**                                      |
| Prelegenci wydarzeń | **8** | `speaker_profiles`, `event_speakers`, dialog profilu, widget „Prelegenci" ze źródłem `directory`                                                                  | Z karty prelegenta brak akcji „poproś o wprowadzenie"                                                  | Dodać akcję sieciową                                    |

---

## 3. Czego brakuje do klasy światowej

Uporządkowane wg **wpływu na produkt**, nie wg trudności. Każda pozycja to zweryfikowana
nieobecność w kodzie, nie życzenie.

### P0 — bez tego produkt nie jest światowy

**#1. Wyszukiwanie semantyczne osób (embeddingi profili).**
To najdroższa luka w całym audycie, bo **infrastruktura już stoi i jest opłacona**: pgvector,
768 wymiarów, indeks HNSW, kolejka indeksera w aplikacji (`embeddings.server.ts`), bramka
embeddingów. Wszystko to obsługuje **wyłącznie `post_embeddings`**. Profile nie mają wektorów.
Skutek: użytkownik pytający „kto u nas zna się na CBAM i pracował w Brukseli" dostaje odpowiedź
z dopasowania trójgramów — czyli znajdzie tylko tych, którzy **dosłownie** wpisali „CBAM".
Cała wiedza zamknięta w bio, doświadczeniu i umiejętnościach jest niewyszukiwalna.
_Nakład: mały — powielenie istniejącego wzorca na drugą tabelę. Zwrot: największy z całej listy._

**#2. Sygnały intencji („otwarty na…").**
Zero pól intencji w schemacie. Katalog mówi, **kim ktoś jest**, ale nie mówi, **czego teraz
szuka**. Dla platformy o profilu unijnym to nie kosmetyka — „szukam partnerów do konsorcjum
Horizon", „szukam współautora stanowiska", „przyjmę zlecenia doradcze", „mentoruję" to są
zdania, wokół których faktycznie zawiązuje się współpraca. Bez nich networking jest bierny:
katalog wizytówek zamiast rynku intencji. Pole jest tanie, a natychmiast staje się najmocniejszą
fasetą wyszukiwania i najmocniejszym sygnałem w sugestiach.

**#3. Miernik kompletności profilu.**
Nie istnieje. To najlepiej udokumentowany mechanizm wzrostu w sieciach zawodowych: profil
uzupełniony jest wyszukiwalny, a użytkownik uzupełnia go, gdy widzi pasek postępu i konkretne
„czego brakuje". Platforma ma już **całą logikę punktacji** dla SEO wpisów (`contentStatus.ts`)
— wzorzec do przeniesienia jest na miejscu. Bez tego katalog wypełnia się profilami-widmami,
co psuje jakość każdej wyszukiwarki zbudowanej nad nim, łącznie z semantyczną z #1.

**#4. Alerty o ludziach (nie tylko o treści).**
`saved_searches` + `run_saved_search_alerts` + pg_cron istnieją i działają — ale producent
alertów czyta **wyłącznie `posts`**. Nie da się zapisać zapytania o osoby ani dostać sygnału
„dołączył ktoś, kogo szukasz". To zamyka najbardziej naturalną pętlę powrotu do produktu.
_Nakład: drugi producent obok istniejącego. Wzorzec gotowy._

### P1 — to dzieli „dobre" od „światowego"

**#5. Pętla zwrotna sugestii.**
`connection_suggestions` to funkcja czysta, przeliczana od zera przy każdym wywołaniu. Nie ma
tabeli odrzuceń ani sygnału „nie pokazuj mi tej osoby". Odrzucona sugestia **wraca w
nieskończoność** — a to najszybszy znany sposób nauczenia użytkownika, żeby przestał patrzeć
na tę zakładkę. Minimum: tabela `connection_suggestion_dismissals` + `NOT EXISTS` w `cand`.
Docelowo: zliczanie akceptacji jako sygnału rankingu.

**#6. Stopień oddalenia i ścieżka do osoby.** 2. stopień jest **liczony** wewnątrz sugestii, ale nigdzie nie **pokazany**. Brakuje etykiety
„2°" na karcie osoby i — ważniejsze — ścieżki „Ty → Anna Kowalska → Marek Nowak" z akcją
„poproś Annę o wprowadzenie". Cała maszyneria wprowadzeń (M-E) już istnieje; brakuje wyłącznie
powierzchni, która podpowiada **przez kogo** iść. To zamienia bierny katalog w narzędzie
dotarcia i jest bezpośrednim mnożnikiem dla istniejącego `request_introduction`.

**#7. Pięć zdarzeń sieciowych nie wywołuje żadnego powiadomienia.**
Bieżący CHECK dopuszcza dwanaście rodzajów (`20260806184400:463-469`): `system`, `comment`,
`follow`, `subscription`, `content`, `security`, `message`, `tracker`, `connection`,
`saved_search`, `crm_task`, `expert_request`. **Brakuje**: `introduction`, `recommendation`,
`endorsement`, `profile_view`, `meeting_booking`. Weryfikacja: żadna migracja tych zdarzeń nie
wstawia wiersza do `notifications`.

Konsekwencja jest dotkliwa i asymetryczna — funkcje **istnieją i działają**, ale są ciche:

| Zdarzenie                          | Co się dzieje dziś                      |
| ---------------------------------- | --------------------------------------- |
| Ktoś rezerwuje Twój slot spotkania | nie dowiadujesz się w aplikacji         |
| Ktoś prosi Cię o wprowadzenie      | zobaczysz, jeśli sam wejdziesz na kartę |
| Ktoś napisał Ci rekomendację       | j.w.                                    |
| Ktoś potwierdził Twoją umiejętność | j.w.                                    |
| Ktoś oglądał Twój profil           | j.w.                                    |

Infrastruktura dostarczania jest kompletna — `enqueue_notification`, preferencje per rodzaj,
web-push (VAPID), digest e-mail. Brakuje wyłącznie **producentów**. To najtańsza pozycja
z całej listy w stosunku do odzyskanego zaangażowania.

**#8. Trwałe kręgi tematyczne.**
Grupy czatu są ad hoc; wydarzenie potrafi je zrodzić (`create_event_group`), ale nie ma
trwałych przestrzeni tematycznych z własną tożsamością, moderacją i archiwum. Dla platformy
policy to naturalna jednostka pracy: grupa robocza wokół dossier, konsorcjum wokół naboru.
Tracker (`eu_policy_follows`) już wie, **kto śledzi ten sam plik** — i ta wiedza jest dziś
używana wyłącznie jako sygnał rankingu w sugestiach, zamiast jako zaczyn grupy.

**#9. Skalowanie sugestii.**
`connection_suggestions` liczy trzy skorelowane agregaty (2. stopień, wspólne dossier, wspólne
wydarzenia) nad **wszystkimi** `discoverable` profilami tenanta, a `LIMIT` nakłada dopiero po
`ORDER BY` na wyliczonym wyniku. Przy setkach profili to obojętne. Przy dziesiątkach tysięcy —
to zapytanie na każde wejście na `/network`. Zawęzić kandydatów **przed** punktacją (materializacja 2. stopnia albo dzienny snapshot).

**#10. Konwersja na spotkanie: kalendarz i wideo.**
Sloty istnieją, ale bez dwustronnej synchronizacji z Google/Outlook szybko kłamią (rezerwacja
w kolidującym terminie), a bez połączenia wideo relacja i tak wychodzi z platformy — razem
z danymi o tym, że w ogóle doszło do spotkania. To ostatni metr lejka i dziś jest nieszczelny.

### P2 — dług strukturalny i wzrost

**#11. Brak importu kontaktów i zaproszeń zewnętrznych.**
`user_invitations` obsługuje wyłącznie seaty organizacji i admina. Nie ma importu CSV, Google
Contacts, ani „zaproś kogoś spoza platformy do połączenia". Sieć rośnie **wyłącznie** z ruchu,
który redakcja przyprowadzi sama — brak pętli wirusowej. To najdroższa pozycja wzrostowa,
świadomie zostawiona jako P2, bo import kontaktów niesie realny ciężar RODO i wymaga własnej
decyzji produktowej, nie tylko implementacji.

**#12. Brak PWA.**
W `public/` jest `push-sw.js`, ale **nie ma manifestu** — aplikacji nie da się zainstalować.
Networking to zachowanie mobilne (konferencja, korytarz, przerwa), a web-push już działa;
manifest jest małym krokiem do dużej zmiany kontekstu użycia.

**#13. Brak osobistego CRM relacji.**
Moduł CRM jest w całości sprzedażowo-administracyjny (`crm_leads`, `crm_tasks`). Członek nie
ma prywatnych notatek o kontakcie, tagów na własnej sieci ani przypomnień „odezwij się".
Aktywni networkerzy prowadzą to dziś w arkuszu obok platformy — czyli wartość wycieka.

**#14. Brak stron organizacji.**
`member_organizations`, `organization_seats`, `crm_companies` i `search_companies_public`
istnieją, ale nie ma publicznej strony firmy z listą osób i dorobkiem. W sieciach B2B to
druga — obok profilu osoby — jednostka nawigacji i naturalne wejście dla ruchu z wyszukiwarek.

**#15. Brak wizytówki QR / vCard.**
`AuthorBusinessCard` to karta bylinu przy wpisie, nie skanowalna tożsamość. Na wydarzeniu —
czyli tam, gdzie networking realnie się zaczyna — nie ma jak wymienić się kontaktem jednym
gestem, choć `meeting_slots` i `event_rsvps` już wiedzą, że obie osoby są w tym samym pokoju.

**#16. Brak analityki własnej sieci.**
Użytkownik widzi `ProfileViewsCard` i nic więcej. Brak „Twoja sieć urosła o N", zasięgu,
składu sieci wg branż, „z kim dawno nie rozmawiałeś". Admin ma `admin_network_stats`
(`/admin/community`), członek nie ma nic.

**#17. Brak kanału aktywności członków.**
Zero treści tworzonych przez użytkowników (brak statusów, postów członkowskich).
`get_followed_feed` obsługuje listę do przeczytania, nie ludzi. Bez tego sieć nie ma **powodu
do powrotu** między jednym a drugim zaproszeniem: relacja zawiązuje się raz i zamiera.
_To decyzja produktowa, nie luka techniczna_ — kanał aktywności niesie koszt moderacji
i może kolidować z redakcyjnym charakterem platformy. Wymieniam ją jako świadomy wybór
do podjęcia, nie jako zalecenie wprost.

---

## 4. Kolejność wdrożenia

Kolejność wynika z zależności, nie z wielkości.

**Fala 1 — odblokowuje resztę.**
#7 (producenci powiadomień, 5 rodzajów) → #3 (miernik kompletności) → #2 (sygnały intencji).
Bez #3 i #2 katalog jest pusty treściowo, więc każda kolejna wyszukiwarka nad nim będzie
mielić powietrze. #7 jest najtańsze i natychmiast ożywia pięć już zbudowanych funkcji.

**Fala 2 — inteligencja.**
#1 (embeddingi profili — po #2/#3, bo wektor z pustego profilu jest bezwartościowy) → #4
(alerty o ludziach) → #5 (pętla zwrotna sugestii) → #6 (stopień oddalenia i ścieżka).

**Fala 3 — domknięcie lejka.**
#10 (kalendarz + wideo) → #8 (kręgi tematyczne) → #9 (skalowanie sugestii — przed, nie po,
pierwszym dużym tenancie).

**Fala 4 — wzrost.**
#12 (PWA) → #14 (strony organizacji) → #11 (import kontaktów, po decyzji RODO) → #13, #15, #16.
#17 wymaga rozstrzygnięcia produktowego przed jakąkolwiek estymacją.

---

## 5. Ocena zbiorcza

| Wymiar                                  |    Ocena     | Komentarz                                                                                                                                          |
| --------------------------------------- | :----------: | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Model danych i bezpieczeństwo**       |   **9,2**    | Deny-all + RPC, izolacja tenanta w 128 funkcjach, 25 plików pgTAP w samej tej domenie. Cicha odmowa zaproszenia to projekt na poziomie najlepszych |
| **Prywatność i zgodność**               |   **9,0**    | Consent-first, siedem niezależnych kontrolek, `noindex` na powierzchniach prywatnych, eksport i usunięcie konta                                    |
| **Kompletność funkcjonalna**            |   **7,8**    | Wszystkie klocki relacji są; brakuje warstwy intencji i inteligencji                                                                               |
| **Inteligencja (dopasowanie, ranking)** |   **5,5**    | Uczciwy heurystyk bez pętli zwrotnej; zero semantyki na ludziach mimo gotowej infrastruktury                                                       |
| **Pętle zaangażowania**                 |   **5,0**    | Pięć funkcji milczy (#7), brak alertów o ludziach, brak powodu do powrotu                                                                          |
| **Konwersja na spotkanie**              |   **6,5**    | Sloty są, kalendarz i wideo nie                                                                                                                    |
| **Wzrost / dystrybucja**                |   **4,5**    | Brak importu, brak zaproszeń zewnętrznych, brak PWA, brak stron organizacji                                                                        |
| **RAZEM (domena)**                      | **7,4 / 10** | Fundament klasy światowej, warstwa produktowa na nim — jeszcze nie                                                                                 |

**Jednozdaniowa diagnoza.** Ta platforma ma **infrastrukturę** networkingu klasy światowej
i **produkt** networkingowy klasy dobrej — dystans między jednym a drugim to nie kolejny moduł,
tylko trzy brakujące warstwy nad tym, co już stoi: **intencja** (po co tu jestem), **inteligencja**
(kogo mi pokazać) i **pętla zwrotna** (dlaczego mam wrócić). Osiem z siedemnastu luk zamyka się
przez powielenie wzorca, który w tym repozytorium już działa gdzie indziej.

---

## 6. Pozycje otwarte przeniesione z audytu 06.08

Nie zamknięte w tej domenie, potwierdzone na bieżącym HEAD:

- słownik `simple` w wyszukiwarce wiadomości wbrew komentarzowi „polska fleksja" — **szóste wydanie**,
- brak wejścia „Zgłoś" z okna czatu — **szóste wydanie**,
- `super_admin` bez roli `admin` nie może nadać weryfikacji, choć ta steruje odznaką eksperta,
  a odznaka pociąga dożywotni VIP — intencja nierozstrzygnięta,
- `check:authz-snapshot` i `check:permissions-parity` nadal poza workflow CI,
- pokrycie testowe `src/lib/network` (3 pliki na 9 modułów).
