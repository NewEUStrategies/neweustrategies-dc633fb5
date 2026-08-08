# Audyt wdrożenia modułu Discussion Club (PR 196-204)

Data: 2026-08-08 · Zakres: PR #196-#204 · Stan: **wdrożone poprawki A18-A21**
Punkt odniesienia: `f43c114` (stan po scaleniu #204)

---

## 0. Metoda i punkt wyjścia

Audyt objął cały moduł w stanie po dziewięciu pull requestach: 17 migracji SQL
(~10,6 tys. linii), warstwę danych (`src/lib/clubs`), komponenty produktowe
i panelu, siedem tras publicznych, trzy słowniki i18n oraz szwy do sześciu
modułów platformy. Badano dziesięć wymiarów niezależnie (bezpieczeństwo SQL,
kontrakt RPC ↔ klient, warstwa React Query, trasy i SSR, i18n, komponenty
i dostępność, integracja międzymodułowa, luki wobec specyfikacji, panel
i autoryzacja, jakość typów), a każde znalezisko weryfikowano adwersaryjnie
przeciw źródłu.

**Stan wyjściowy nie był zły.** SQL modułu jest napisany dobrze: dyscyplina
`DROP` + `CREATE` przy zmianach sygnatur, konsekwentne `SET search_path`,
`REVOKE ... FROM PUBLIC`, tenant w każdym predykacie, świadoma denormalizacja
liczników, przemyślany kursor z tiebreakerem. Bramki `check:sql-tenant-scope`,
`check:sql-anon-insert`, `check:rpc-contract` i `check:sql-emit-actor`
przechodziły. Komentarze w kodzie są nieprzeciętnie dobre i to one - a nie kod -
najczęściej wskazywały problem.

**I to jest główny wniosek z tego audytu:** dominującą klasą defektu nie był
błąd w napisanym kodzie, tylko **rozjazd między tym, co kod deklaruje, a tym,
co robi**. Komentarz opisywał zachowanie, którego nie było. Słownik typów
obiecywał wartości, których RPC nie znało. Model danych miał kolumnę bez
producenta i bez konsumenta. Uprawnienie liczyło się w bazie i nie miało ani
jednego czytelnika.

---

## 1. Znaleziska krytyczne i wysokie

### 1.1 `club_view` pokazywał anonimowi każdy klub tenantu (KRYTYCZNE)

Filtr brzmiał `WHERE cap.reason IS DISTINCT FROM 'not_found'` - wykluczał JEDEN
kod odmowy zamiast wpuszczać to, co wolno. Gałąź anonimowa w
`club_capabilities` (A9) nie zwraca jednak `'not_found'` nigdy: dla wołającego
bez sesji `reason` to albo `NULL` (klub `public` + `active`), albo
`'auth_required'`. Warunek był więc dla anonima **zawsze prawdziwy**.

Skutek: `POST /rest/v1/rpc/club_view {"p_slug":"..."}` bez tokenu zwracał pełny
wiersz dowolnego klubu tenantu publicznego - nazwę, opis, **zasady**, okładkę,
politykę wstępu i liczniki - w tym klubu `secret`, którego cała definicja brzmi
„tylko członkowie wiedzą, że istnieje", oraz klubu `draft`, czyli pracy
redakcyjnej przed publikacją.

`club_list` miał to zrobione poprawnie od A13 (jawna lista widoczności +
`c.status = 'active'`), więc luka była dostępna wyłącznie przez odgadnięcie
sluga - co dla klubu nazwanego po projekcie jest granicznie łatwe.

**Poprawka (A19):** predykat odwrócony na pozytywny, z trzema rozłącznymi
powodami, dla których karta ma prawo wyjść (czytelność treści / zalogowany
i klub nie jest sekretem / jestem członkiem w jakimkolwiek stanie).

### 1.2 Akceptacja starego zaproszenia kasowała ban (WYSOKIE)

`ON CONFLICT (club_id, user_id) DO UPDATE SET status = 'active'` nadpisywało
`'banned'` bezwarunkowo. Sekwencja: prowadzący zaprasza X (zaproszenie ważne
30 dni) → moderator banuje X → X akceptuje zaproszenie i wraca do klubu, od razu
z rolą z zaproszenia. Nie jest to teoretyczne: ban przychodzi zwykle PO
zaproszeniu, bo powodem bana jest to, co ktoś zrobił już w klubie.

**Poprawka (A19):** jawna odmowa przed zapisem + warunkowe `ON CONFLICT`, które
nie zdejmie bana powstałego między sprawdzeniem a zapisem.

### 1.3 `club_resolve_thread` omijało premoderację (WYSOKIE)

Funkcja sprawdzała rodzaj wątku i uprawnienie, ale nie jego **status**. Autor
pytania czekającego w kolejce premoderacji mógł wywołać
`club_resolve_thread(id, NULL)`, a `UPDATE` ustawiał wtedy `status = 'open'` -
czyli **publikował wpis, którego moderator nie widział**. Ta sama ścieżka
odwracała `'hidden'` po decyzji moderatora.

### 1.4 `club_replies_list` nie patrzyło na status wątku (WYSOKIE)

`club_moderate('thread', ..., 'hide')` zmienia wyłącznie `club_threads.status`
i nie dotyka odpowiedzi. `club_thread_view` odsiewa wątek po statusie,
`club_replies_list` - nie. Ukrycie wątku zabierało więc nagłówek, a treść
zostawiała czytelną dla każdego członka. Dokładnie odwrotnie, niż brzmi ta akcja.

### 1.5 `admin_club_replies` ujawniało autora z pominięciem audytu (WYSOKIE)

Specyfikacja (V1 §1.2) mówi jednoznacznie: moderator widzi tożsamość zawsze,
ale przez osobne, **audytowane** RPC (`club_moderator_reveal_author`). Podgląd
wątku w panelu zwracał `author_id` i `author_name` bezwarunkowo - także dla
wpisów anonimowych i klubu w trybie `chatham`. Cała konstrukcja audytu ujawnień
była więc ozdobna: tożsamość dało się odczytać wchodząc w zwykły podgląd.

### 1.6 Wygenerowane typy Supabase były nieaktualne (WYSOKIE)

Trzy RPC klubowe miały w `src/integrations/supabase/types.ts` sygnatury sprzed
migracji A10: brak `p_reason` w `club_edit_thread` i `club_edit_reply`, brak
nullowalności `p_reply_id` w `club_resolve_thread`. Ostatnie z nich wymusiło
w kodzie rzutowanie `params.replyId as string` - czyli kłamstwo o typie, które
maskowało błąd w kontrakcie zamiast go pokazać.

### 1.7 Pozostałe potwierdzone (średnie)

| Defekt                                                                                  | Skutek                                                                                 |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `club_reactions_for` liczyło widoczność dla pary (klub, **NULL**) zamiast (klub, grupa) | jedyny sygnał w module wyciekający z grup `draft` i zza progu planu                    |
| `club_react` / `club_set_stance` bez sprawdzenia stanu celu                             | reakcja na wątek ukryty podbijała jego `hotness`                                       |
| ban i wyjście z klubu zostawiały żywe subskrypcje                                       | zbanowany dostawał dalej powiadomienia **z tytułem wątku**                             |
| `admin_club_group_delete` nie przeliczało licznika grupy docelowej                      | trwale zaniżony `thread_count` (trigger reaguje na `UPDATE OF status`, nie `group_id`) |
| `fetchClubMembers` zamieniało jawny `null` na `"active"`                                | filtr „Wszystkie" - stan domyślny zakładki - ukrywał zaproszonych i oczekujących       |
| widok wątku wpadał w wieczny szkielet dla nieistniejącego sluga                         | wyłączone `useQuery` zostaje w `isPending` na zawsze                                   |
| brak stanów błędu na całej powierzchni publicznej                                       | padnięte RPC renderowało się jako „nie należysz do żadnego klubu"                      |

---

## 2. Deklaracje bez pokrycia

To jest osobna kategoria, bo nie są to błędy w kodzie - są to **obietnice
złożone w kodzie i niedotrzymane**. Każda z nich przeszła review z zielonym CI.

| Deklaracja                                                                                | Gdzie                                           | Rzeczywistość                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „Nowe odpowiedzi NIE wskakują same. Pojawia się pasek »N nowych«"                         | nagłówek trasy wątku                            | paska nie było, a globalna inwalidacja z szyny zdarzeń wstawiała cudze odpowiedzi pod kursor czytelnika - **dokładnie to, przed czym komentarz ostrzega** |
| „Indeksowalność jest WARUNKOWA i liczona z widoczności klubu"                             | nagłówek trasy klubu                            | bezwarunkowy `noindex,nofollow` na wszystkim; klub `public` - jedyna powierzchnia pomyślana jako lejek pozyskania - nie mógł trafić do wyszukiwarki       |
| `CLUB_THREAD_SORTS` = 5 porządków, z komentarzem „`unanswered` jest celowo wyeksponowany" | `types.ts`                                      | RPC znało dwa; warstwa API po cichu mapowała resztę na `hot` - trzy pozycje droplisty były nieodróżnialne od domyślnej                                    |
| „reuzywa istniejące `polls` / `poll_votes`" (rodzaj `poll`)                               | specyfikacja §1.3                               | zero krawędzi między wątkiem a ankietą; rodzaj `poll` zmieniał chip nad tytułem i nic więcej                                                              |
| kotwiczenie wątku w treści platformy                                                      | model A1 + szew A12 + karta na `/tracker/$slug` | **brak producenta**: żadna ścieżka nie pozwalała kotwicy ustawić, więc karta „dyskutowane w klubach" z definicji świeciła pustką                          |
| `user_pending_counters.club_unread` utrzymywany triggerem                                 | specyfikacja §6.3                               | nie powstał; `club_members.last_read_at` było kolumną, której nikt nie zapisuje                                                                           |
| wejście „Zgłoś" przy każdym wpisie „od pierwszego dnia"                                   | specyfikacja §7                                 | nie istniało - a `report_user` przyjmuje identyfikator autora, którego pod regułą Chatham House klient nie ma i mieć nie może                             |
| trasa `/club/$slug/members`                                                               | specyfikacja §5.1                               | nie istniała; `can_see_members` liczyło się w bazie od A1 i nie miało ani jednego konsumenta                                                              |
| „żaden `t()` w module nie polega na `defaultValue`"                                       | nagłówek `i18n-club.ts`                         | trzy wywołania z `defaultValue`, w tym jedno wypisujące surowy angielski status z bazy w polskim interfejsie                                              |

---

## 3. Rozjazd i18n, którego parytet PL/EN nie widzi

Cztery gałęzie kluczy używanych w kodzie nie istniały w **żadnym** słowniku,
więc bramka parytetu (porównująca PL z EN) świeciła na zielono:

- `club.memberRole.*` - słownik ma `club.role.*` → droplista roli w masowej
  akcji panelu członków renderowała gołe klucze,
- `adminClubs.invites.*` - słownik ma `adminClubs.invitations.*` → katalog
  elementów pokazywał dwadzieścia gołych kluczy,
- `adminClubs.invites.statusName.*` z `defaultValue: row.status` → tabela
  zaproszeń wypisywała surowy status z bazy,
- braki wartości w gałęziach sortów.

**Poprawka systemowa:** nowa bramka `src/components/clubs/__tests__/clubI18nKeys.gate.test.ts`
patrzy od strony KODU (wzorzec z `network`), traktuje `defaultValue` jako
obciążenie i jest wpięta w `check:i18n-parity`. Prefiks `clubElements` dopisany
do `GATED_PREFIXES` - `isGated()` dopasowuje po prefiksie z kropką, więc
`"club"` nie obejmowało `clubElements.*` i 95 kluczy stało poza bramką.

---

## 4. Co zostało wdrożone

### Migracje

| Migracja | Zawartość                                                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A18**  | sześć realnych sortów listy tematów, porządek `stance` z projekcją stanowiska autora, licznik nieprzeczytanych (kolumna na członkostwie + suma w `user_pending_counters` + `club_mark_read` + rozszerzony `recompute_user_pending_counters`), `club_report_content`, `club_anchor_suggest`, `unread_count` w `club_my_memberships` |
| **A19**  | osiem poprawek bezpieczeństwa i poprawności z §1                                                                                                                                                                                                                                                                                   |
| **A20**  | `club_threads.poll_id` + CHECK + projekcja + `admin_club_poll_create`; klub referencyjny                                                                                                                                                                                                                                           |
| **A21**  | gałęzie klubowe w `linked_item_label` (A12 zostawiła tam blok `DO`, który czyta definicję do zmiennej i nigdy jej nie używa)                                                                                                                                                                                                       |
| **A22**  | audytorium wzmianek (`club_mention_visible_to` + bramka w `process_mentions` - wzmianka w klubie prywatnym doręczała powiadomienie z tytułem wątku osobie spoza klubu), idempotentne `club_create_thread` (podwójne kliknięcie „Opublikuj" zakładało dwa wątki)                                                                    |
| **A23**  | `club_export_my_data` - eksport RODO nie zawierał CAŁEGO modułu; `grep -i club` po `exportManifest.ts` i `export.functions.ts` nie zwracał ani jednego trafienia                                                                                                                                                                   |
| **A24**  | `clubs_enabled` dostaje stan początkowy tam, gdzie klub realnie istnieje (skutek po stronie klienta: trasa układu `routes/club.tsx`)                                                                                                                                                                                               |
| **A25**  | semantyka rodzaju `announcement`: przypięcie jest własnością rodzaju, nie ręcznym krokiem; `p_lock_replies` zakłada wątek od razu zamknięty                                                                                                                                                                                        |
| **A26**  | trzy brakujące sygnały wiersza wątku ze spec §5.2 (kotwica z etykietą przez `club_anchor_label`, `insightful` zamiast sumy reakcji, znacznik nieprzeczytanego) + filtry: status, zakotwiczenie, tylko nieprzeczytane                                                                                                               |
| **A27**  | ścieżka D (kampanie segmentowe) domknięta: `club_segment_candidate_ids` + `club_segment_recipients` jako JEDNO źródło dla podglądu i wysyłki, `admin_club_invite_segment`; poprawka w samym podglądzie (liczył „odsiane" bez blokad i okna 90 dni, więc `will_send` było zawyżone)                                                 |

### Klient

Pasek „N nowych odpowiedzi" (`useDeferredReplies` - zamraża **projekcję**, nie
zapytanie, więc licznik jest prawdziwy, a redakcja i moderacja cudzych wpisów
działają natychmiast) · warstwa SEO tras (`clubHead.ts`, indeksowalność liczona
z widoczności, `noindex` jako bezpieczny domysł przy awarii loadera) ·
`MentionTextarea` w obu kompozytorach · `ClubAnchorPicker` · `ClubReportButton`
przy wątku i każdej odpowiedzi · `ClubErrorNotice` na całej powierzchni
publicznej · trasa `/club/$clubSlug/members` · sondaż przez współdzielony
`PollCard` (z anti-anchoringiem) · przemodelowany hub z miękką bramką dla
anonima · formatowanie dat przez `lib/i18n/format` zamiast dwudziestu wywołań
`toLocale*` (dwa bez locale = rozjazd SSR/klient) · poprawki dostępności
(`aria-label` z licznikiem na reakcjach, `sr-only` zamiast `aria-label` na
`<span>`, roving tabindex w `radiogroup`, cele dotykowe 44 px) i responsywności
(`ClubStatStrip`, `OptimizedImage` w okładkach).

---

## 5. Stan bramek

Wszystkie bramki CI przechodzą **poza jedną, która była czerwona przed tą pracą**:

```
check:sql-tenant-scope      OK      check:authz-snapshot        OK
check:sql-app-role          OK      check:public-assets         OK
check:sql-anon-insert       OK      check:legacy-payment-refs   OK
check:sql-migration-replay  OK      check:stale-never-casts     OK
check:rpc-contract          OK      check:workflow-env-contract OK
check:sql-emit-actor        OK      check:i18n-parity           OK
check:sql-owner-tenant-scope OK     check:permissions-parity    OK
check:entry-purity          OK      check:chunks                OK
vitest (675 plików, 7526 testów)    OK
```

**`check:bundle` - czerwona przed i po.** Zmierzone na `f43c114`:
440,3 / 1964,4 / 3247,4 KB gzip wobec progów 439 / 1915 / 3175. Po całej pracy:
447,5 / 1983,3 / 3268,2 KB, czyli **+7,2 / +18,9 / +20,8 KB gzip** wobec stanu
wyjściowego - przy czym stan wyjściowy przekraczał wszystkie trzy progi.
Największa część tego przyrostu ląduje w chunku wejściowym: przy około
dwudziestu pięciu chunkach trasowych importujących `src/lib/clubs/types.ts`
Rollup przestaje trzymać go w osobnym pliku i wciąga do entry.

Reguły `manualChunks` na kod aplikacji **nie dodano świadomie**: funkcja ma
jawną bramkę `if (!id.includes("/node_modules/")) return undefined`, a notka
o `vendor-tanstack` w tym samym pliku opisuje, czym kończy się barwienie grafu
aplikacji (entry spadł do 0,2 KB, a chunk vendorowy spuchł do 1,59 MB).
Zmniejszono za to statyczne krawędzie tam, gdzie było to bezpieczne: sondaż
i dialog zgłoszenia ładują się leniwie (osobne moduły - `lazy()` dzieli chunk
wyłącznie po granicy modułu).

**To wymaga osobnej decyzji** - o progach albo o podziale kontraktu domenowego
na część współdzieloną publicznie i część adminową.

---

## 6. Znane pozycje odłożone

Rozdział zamknięty. Wszystkie pięć pozycji z pierwszego przebiegu audytu
zostało wdrożonych w drugiej fali (A22-A27 + warstwa klienta):

1. **`club_semantic_search`** - wpięty obok `club_search`. Warstwa istniała
   w komplecie od PR 197 (tabela, batch w `jobs-tick`, indeks IVFFlat, RPC)
   i nie miała ani jednego wołającego: platforma płaciła bramce AI za embedding
   każdego wątku i nikt ich nie czytał. Wzorzec z katalogu osób - server fn
   zamienia frazę na wektor, zapytanie leci z sesji użytkownika. Warstwy jadą
   równolegle i scalają się: dosłowne trafienie bije podobieństwo.
2. **`admin_club_segment_preview`** - czwarta ścieżka zaproszeń ma panel,
   a przede wszystkim ma czym wysłać (A27 dokłada brakujące
   `admin_club_invite_segment`). Podgląd bez wykonania był licznikiem
   mówiącym „wyślę 137 zaproszeń" bez przycisku.
3. **`club_set_role`** - zarządzanie rolami wchodzi na `/club/$slug/members`,
   czyli tam, gdzie prowadzący klubu już jest. Panel administracyjny stoi za
   bramką `isAdmin`, więc prowadzący bez roli platformowej nie miał ŻADNEJ
   drogi wyznaczenia moderatora we własnym klubie.
4. **Paginacja katalogu klubów na hubie** - „Pokaż więcej" z licznikiem
   `{{shown}} z {{total}}`. Sto pierwszy klub istniał w bazie i nie istniał na
   hubie: bez komunikatu, bez licznika, bez sposobu, żeby to zauważyć.
5. **`errorComponent` / `pendingComponent`** - wpisane RAZ, na trasie układu
   `routes/club.tsx`. Granica rodzica łapie każde dziecko, a siedem kopii tej
   samej deklaracji rozjechałoby się przy pierwszej zmianie.

Dołożone przy okazji, poza pierwotną listą: eksport RODO (A23), przełącznik
modułu z realnym skutkiem (A24), semantyka `announcement` (A25), komplet
sygnałów i filtrów wiersza wątku (A26), widgety buildera `club-card` /
`club-threads` ze spec §5.5, plakietka `club_unread` w pasku mobilnym
(licznik utrzymywany triggerem od A18 nie miał po stronie klienta ani jednego
czytelnika), autozapis szkicu w kompozytorze oraz dwa wiersze klubowe
w macierzy uprawnień.

---

## 7. Wniosek

Moduł był zbudowany solidnie i **spisany lepiej, niż wdrożony**. Wszystkie
defekty krytyczne i wysokie mieszczą się w jednym wzorcu: warstwa deklarowała
zachowanie, którego druga warstwa nie realizowała, a żadna bramka nie
porównywała tych dwóch stron. Trzy poprawki systemowe wprowadzone przy okazji
tego audytu - bramka użycia kluczy i18n, aktualizacja wygenerowanych typów
Supabase i pozytywny predykat w `club_view` zamiast wykluczania kodów odmowy -
adresują właśnie tę klasę, a nie pojedyncze objawy.

Rekomendacja na przyszłość: **kontrakt sprawdzany maszynowo w obie strony**.
Tam, gdzie klient deklaruje słownik wartości (sorty, rodzaje, statusy), test
powinien porównywać go z `CHECK`-iem w migracji - dokładnie tak, jak
`check:rpc-contract` porównuje nazwy funkcji. Trzy z dziewięciu pozycji
z rozdziału 2 wychwyciłby taki test w minutę.
