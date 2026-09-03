# Event Builder — przegląd funkcjonalny i wyniki testów

Data: 2026-08-28 · Gałąź: `claude/event-builder-review-q8kjc9` · HEAD: `9997ac0`
Zakres: front publiczny, panel administracyjny, warstwa bazy, styki z pozostałymi modułami, testy.
Dokumenty odniesienia: `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` (etapy E1–E7, ryzyka, dług),
`docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md` (mapowanie ekran po ekranie).

---

## 0. Wniosek

Moduł jest w dobrym stanie inżynierskim. **Wszystkie kryteria odbioru etapów E4–E7, które da się
sprawdzić w kodzie, są spełnione po stronie serwera** — kolizja czasowa sesji odrzucana pod blokadą
doradczą, „typ biletu nadaje grupę”, trzy ograniczenia `EXCLUDE` przeciw podwójnej rezerwacji,
deduplikacja powtórnego skanu, izolacja leadów partnera po `sponsor_id` i zgodzie.

Fundamenty są więc w porządku. Problemy leżą **na stykach i na ostatnim metrze** — i tam jest ich
sporo. Przegląd piętnastu podsystemów, każdy z osobną adwersaryjną weryfikacją, zostawił po odsianiu
**165 ustaleń, w tym siedem krytycznych** (pełna lista: załącznik
`docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28_USTALENIA.md`). Każde krytyczne sprawdziłem ręcznie
w kodzie; wszystkie się potwierdziły. Trzy z nich są takie, że wydarzenie z produkcji zachowa się źle
w pierwszym dniu użycia: **płatny bilet jest wydawany za darmo**, **pole zgody trwale blokuje zapis**,
a **anonim może pobrać adres nagrania sesji z wydarzenia dla członków**.

Wspólny mianownik większości z nich to nie zaniedbanie, tylko **tempo**: backend wyprzedził front
o kilka dni i część łańcuchów jest kompletna po stronie bazy, a urwana na powierzchni.

Przegląd otwiera pull request
[#301](https://github.com/NewEUStrategies/neweustrategies-dc633fb5/pull/301) — ten dokument i załącznik
z pełną listą ustaleń są jego jedyną treścią; żadnego kodu ta gałąź nie zmienia.

---

## 1. Wykonane testy

Wszystko uruchomione w tej sesji na czystej instalacji zależności. Rejestr prywatny
(`europe-west*-npm.pkg.dev`) jest odcięty przez politykę sieci środowiska, więc pakiety pobrano
z `registry.npmjs.org`; `bun.lock` przywrócono bez zmian.

| Test                                    | Polecenie                                | Wynik                                                                                 | Status     |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| Typy                                    | `tsc --noEmit`                           | 0 błędów                                                                              | zielony    |
| Testy jednostkowe — cały serwis         | `vitest run`                             | 1702/1706 plików · 43 985 zdanych · **2 czerwone** · 183 oczekiwanie czerwone · 678 s | 2 czerwone |
| Testy jednostkowe — moduł wydarzeń      | `vitest run src/lib/events …`            | 182/182 plików · 4164 testy                                                           | zielony    |
| Replay bazy na czystym Postgresie 16    | `bash scripts/events-harness/run.sh`     | **70 migracji · 884 asercje runtime**                                                 | zielony    |
| ESLint — powierzchnia modułu            | `eslint src/lib/events src/components/…` | 84 błędy · 22 ostrzeżenia (wszystkie `prettier/prettier`)                             | czerwony   |
| Bramki statyczne (22 skrypty `check:*`) | `bun run check:…`                        | 16 zielonych · 4 czerwone · 2 nieweryfikowalne bez poświadczeń                        | 4 czerwone |

### 1.1 Dwa czerwone testy

| Test                                                       | Diagnoza                                                                                                                                                                                                | Ocena  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `src/lib/authz/__tests__/authzSnapshotParity.test.ts`      | Snapshot powstał przy 904 migracjach, repo ma 906. Brakujące to `event_my_event_profile_set` i `event_meeting_directory` — **obie z tego modułu**. Naprawa: `bun run generate:authz-snapshot` i commit. | realny |
| `src/components/admin/menu/__tests__/MenuManager.test.tsx` | „w trakcie zapisu przycisk jest zablokowany”. Osobno przechodzi (65/65). Przewraca się wyłącznie pod obciążeniem pełnej suity. Poza modułem wydarzeń.                                                   | flaky  |

### 1.2 Bramki CI

| Bramka                                                                                                                       | Wynik            | Uwaga                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify:static`                                                                                                              | czerwona         | Przewraca się na **pierwszym** kroku (`format:check`): 59 plików, ok. 40 w module. **Pozostałych 24 bramek tego skryptu w ogóle nie uruchamia.** Ten sam krok przewróci CI. |
| `check:i18n-overlay-imports`                                                                                                 | czerwona         | 6 plików woła klucze `eventMe.*` bez importu `@/lib/i18n-cart`. Wszystkie w module — U-07.                                                                                  |
| `check:authz-snapshot`                                                                                                       | czerwona         | To samo źródło co czerwony test parytetu.                                                                                                                                   |
| `check:i18n-hardcoded`                                                                                                       | czerwona         | `AccountMenuWidget.tsx` (14→15), `tx-preview.server.ts` (32→37). **Poza** modułem wydarzeń.                                                                                 |
| `check:db-contract`, `check:migration-ledger`                                                                                | nieweryfikowalne | Wymagają `SUPABASE_URL` i klucza. Brak poświadczeń — to nie jest wynik negatywny.                                                                                           |
| 16 pozostałych (m.in. `check:sql-tenant-scope`, `check:rpc-contract`, `check:sql-migration-replay`, `check:types-freshness`) | zielone          | Parytet RPC ↔ klient TypeScript jest czysty — nie znalazłem ani jednego rozjazdu nazw argumentów.                                                                           |

---

## 2. Co dziś stanowi moduł

Liczby policzone z repozytorium, nie ze specyfikacji.

| Warstwa                       | Rozmiar | Treść                                                                                           |
| ----------------------------- | ------: | ----------------------------------------------------------------------------------------------- |
| Baza — tabele                 |      42 | `event_*`; wszystkie z włączonym RLS                                                            |
| Baza — funkcje                |     209 | funkcje `event_*` / `admin_event_*` obecne w wygenerowanych typach, czyli realnie w bazie       |
| Baza — ograniczenia `EXCLUDE` |       5 | kolizja sali, miejsce przy stole, uczestnik spotkania, okno dostępności, deduplikacja check-inu |
| Studio wydarzenia             |      31 | sekcji, każda z własnym adresem; parytet trasa ↔ nawigacja jest **pełny**                       |
| Panele administracyjne        |      84 | komponenty w `src/components/admin/events` (25 470 linii)                                       |
| Front publiczny               |      13 | tras `/events/*` + PWA skanera (15 157 linii komponentów)                                       |
| Warstwa logiki                |     115 | modułów w `src/lib/events` (34 694 linie)                                                       |
| Testy jednostkowe             |     182 | pliki dotyczące modułu, 4164 testy                                                              |
| Asercje runtime               |     884 | w 11 plikach `scripts/events-harness/runtime_test.d/`                                           |

---

## 3. Co potwierdzone w kodzie

Kryteria sprawdzone przez odczytanie **ostatniej** definicji funkcji w łańcuchu migracji — patrz §5
o kształcie historii migracji.

| Kryterium                                                            | Gdzie egzekwowane                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E4** — kolizja czasowa sesji odrzucana serwerowo                   | `event_session_signup`: `pg_advisory_xact_lock` na parze (wydarzenie, użytkownik), porównanie `time_range && time_range` z flagą `allow_overlap`. Kolizja sali osobno, przez `EXCLUDE USING gist`. **Zastrzeżenie:** awans z listy rezerwowej tej kontroli nie powtarza (patrz ustalenia wysokie).                                                         |
| **E5** — typ biletu nadaje grupę                                     | `event_register`: `v_group_id := v_ticket.group_id`, z powrotem do grupy domyślnej gdy bilet jej nie niesie.                                                                                                                                                                                                                                               |
| **E5** — walidacja formularza po stronie serwera                     | `event_register`: pola wymagane, zgody wymagane (`is_true`, nie „obecne”), regulaminy wymagane, limit 64 kB ładunku, wzorzec e-mail, okno sprzedaży biletu, ranga warstwy, kod dostępu po SHA-256, `rate_limit_hit` 12/10, blokada wiersza.                                                                                                                |
| **E6** — brak podwójnej rezerwacji                                   | Trzy `EXCLUDE USING gist`: miejsce przy stole, uczestnik, okno dostępności. Reguły czasu i pojemności w `tg_event_meetings_validate`.                                                                                                                                                                                                                      |
| **E7** — powtórny skan odrzucany                                     | `event_checkins`: `EXCLUDE USING gist` po (najemca, punkt, osoba, `dedupe_range`) z filtrem na `result = 'granted'` i kierunek.                                                                                                                                                                                                                            |
| **E7** — partner widzi wyłącznie własne leady                        | `event_lead_scans_list` uwierzytelnia po `token_hash`, filtruje po `sponsor_id` urządzenia i **dodatkowo** zeruje pola osobowe bez `consent_partner_sharing_at`. **Zastrzeżenie:** eksport po stronie organizatora (`admin_event_lead_scans_export`) bramkuje zgodą wyłącznie e-mail i telefon — imię, nazwisko, firma i stanowisko wychodzą bezwarunkowo. |
| **Ryzyko nr 3** — wyciek `join_url` / `recording_url` / `stream_url` | Granty na `public.events` są kolumnowe i wyliczają wyłącznie kolumny publiczne; kolumny dodane 26 sierpnia dopisano tym samym wzorcem. Żaden grant nie obejmuje kolumn linkowych.                                                                                                                                                                          |
| Higiena warstwy bazy                                                 | 42/42 tabel z RLS. Domyślna odmowa + dostęp wyłącznie przez `SECURITY DEFINER`. **Każda** funkcja `SECURITY DEFINER` modułu ma `search_path`. Żadna `admin_event_*` nie ma `GRANT EXECUTE` dla `anon`.                                                                                                                                                     |
| Poświadczenia                                                        | Token skanera i `manage_token`: 24 losowe bajty base64url (192 bity), w bazie wyłącznie SHA-256, odwołanie, wygaśnięcie, blokada po serii błędów, zakresy. Strona samoobsługi z `noindex, nofollow`.                                                                                                                                                       |

---

## 4. Ustalenia

Poniżej **zestaw priorytetowy**: siedem ustaleń krytycznych i te wysokie oraz średnie, które zmieniają
plan pracy. Pełna lista 165 ustaleń po weryfikacji — z podziałem na piętnaście podsystemów i z dziewięcioma
ustaleniami obalonymi — leży w `docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28_USTALENIA.md`.
Waga oddaje realną osiągalność scenariusza, nie to, jak groźnie brzmi nazwa.

### Krytyczne — psują przebieg w pierwszym dniu użycia

Siedem ustaleń o tej wadze. Każde sprawdziłem dodatkowo ręcznie w kodzie; każde się potwierdziło.

**K-1 · Płatny bilet jest wydawany za darmo: zapis z formularza nie ma bramki płatności**

`event_register` sprawdza przy wybranym bilecie **wszystko poza ceną**: `is_active`, okno sprzedaży
(`sales_from`/`sales_to`), `min_tier_rank`, kod dostępu po SHA-256 i pulę miejsc. Kolumna
`price_cents` nie pada w całym ciele funkcji ani razu
(`20260827220945_d4ece1f0-…sql:337-363`). Zgłoszenie powstaje ze statusem `approved`, z wydanym
kodem QR i z `payment_status = 'not_required'` — wartością domyślną kolumny
(`20260828053802_6e09cbdf-…sql:20`). Publiczny formularz pokazuje cenę w kafelku biletu, po czym
kończy ekranem potwierdzenia i mailem, bez kroku płatności i bez przekierowania do kasy
(`PublicRegistrationForm.tsx:109-187`).

Skutek: wydarzenie z `registration_mode = 'form'` i biletem za 1200 zł wydaje ten bilet każdemu, kto
wypełni formularz. Miejsce z puli zostaje zajęte, kod QR działa przy bramce, w rozliczeniach nie ma
śladu. Poprawna ścieżka kasowa **istnieje obok** i jest zrobiona dobrze (`event_ticket_checkout_quote`
→ koszyk → `payment_status`), tylko ten przebieg jej nie używa.

Naprawa: przy `price_cents > 0` wystawiać zgłoszenie ze statusem wstrzymanym i
`payment_status = 'unpaid'`, bez kodu QR, i zwracać klientowi wskazanie do kasy; kod QR wydawać
dopiero na potwierdzeniu płatności. Do czasu poprawki — nie konfigurować płatnych biletów
w przebiegu formularza.

**K-2 · Pole zgody trwale blokuje zapis: formularz go nie pokazuje, a serwer go wymaga**

`event_registration_form` w najnowszej definicji odsiewa pola zgody z listy pól
(`AND f.field_type <> 'consent'`, `20260828051054_a4d602e0-…sql:511`) i zwraca wyłącznie `fields`,
`tickets` oraz `terms` — **klucza z listą zgód nie ma w ogóle** (tamże:578-583). Jednocześnie
`event_register` wymaga, żeby każde aktywne i wymagane pole typu `consent` było zaznaczone, inaczej
rzuca `missing_required_consents` (`20260827220945_d4ece1f0-…sql:396-403`). Ten kod błędu nie ma
klucza tłumaczenia w żadnej nakładce, więc uczestnik dostaje generyczne „coś poszło nie tak”.

Skutek: redaktor dodaje wymaganą zgodę i od tej chwili **nikt nie jest w stanie się zapisać**.
Formularz nie pokazuje pola, więc nie ma czego zaznaczyć; walidacja klienta go nie widzi, bo pole nie
przyszło w `fields`; serwer odrzuca każdą próbę komunikatem, którego nie da się zrozumieć. Studio
pozwala takie pole utworzyć bez żadnego ostrzeżenia.

Naprawa: dołożyć klucz `consents` do zwrotu RPC i wyrenderować te pola w formularzu; do czasu
poprawki zablokować w studiu tworzenie wymaganego pola typu `consent`. Niezależnie od wyboru —
dopisać klucz tłumaczenia dla `missing_required_consents`.

**K-3 · Anonim pobiera adres nagrania i transmisji sesji z wydarzenia dla członków**

`event_session_access(uuid)` ma `GRANT EXECUTE … TO anon`
(`20260824084741_5e079502-…sql:823`). Jej zapytanie filtruje wyłącznie po
`s.status = 'published' AND e.status = 'published'` — **nie patrzy ani na `events.visibility`, ani na
`events.min_tier_rank`** (tamże:774-784). Jedyna bramka to `IF v_session.min_tier_rank > 0`, a ta
kolumna ma `DEFAULT 0` (`20260823140000_event_sessions.sql:454`). `recording_url` wychodzi
**bezwarunkowo**, a `stream_url` gdy `v_signed` — które przy `requires_signup = false` jest prawdą
także dla `auth.uid() IS NULL`. Identyfikatory sesji są jawne: `event_agenda(text)` też jest nadana
`anon` i zwraca `s.id`.

Skutek: dwa wywołania z konsoli przeglądarki, bez logowania — `event_agenda('<slug>')` po
identyfikatory, potem `event_session_access(<id>)` po adresy. Wydarzenie z `visibility = 'members'`
i `min_tier_rank = 3` oddaje nagrania wszystkich sesji i transmisje sesji plenarnych. To dokładnie ta
klasa błędu, którą dla tabeli `events` zamknęła migracja `20260721150000` — powtórzona na
`event_sessions`.

Naprawa: dołożyć do zapytania warunki z **wiersza wydarzenia** (`visibility`, `min_tier_rank`, tryb
gościa) i uzależnić `recording_url` od tej samej bramki co `stream_url`. Wzorzec jest
w `get_event_access`.

**Nie chodzi o odcięcie anonima jako takiego** — nadanie `GRANT … TO anon` jest tu celowe. Dla
wydarzenia publicznego z sesją otwartą (`requires_signup = false`) niezalogowany widz jest
uprawniony i transmisja ma do niego dojść; zabranie mu obu adresów naprawiłoby wyciek przez zepsucie
otwartych webcastów. Reguła ma brzmieć: adresy wychodzą, dopóki wołający spełnia widoczność i rangę
**wydarzenia** oraz regułę zapisu **sesji**; dziś nie sprawdza się pierwszego z tych trzech
warunków i to jest cała usterka.

**K-4 · Sześć zdarzeń rejestracji jest odrzucanych przy zapisie i po cichu ginie — a bramka CI tego nie widzi**

To samo błędne założenie — „nazwa zdarzenia ma dwa człony” — siedzi w **trzech niezależnych
miejscach**:

1. `domain_events.event_type` ma `CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$')`
   (`20260711200000_domain_event_bus.sql:34`), więc `event.registration.created.v1` narusza
   ograniczenie przy `INSERT`. `emit_domain_event` kończy się `EXCEPTION WHEN OTHERS THEN RETURN
NULL`, więc **zdarzenie nigdy nie trafia na szynę i nikt się o tym nie dowiaduje**. Komentarz
   w tej samej migracji nazywa ten mechanizm wprost: „własny EXCEPTION emiterów zamienia to w ciszę”.
2. `DOMAIN_EVENT_TYPES` nie zna żadnej z tych sześciu nazw, więc `invalidationKeysFor()` zwraca `[]`
   (`eventInvalidationMap.ts:332-337`).
3. Bramka `domainEventCatalog.test.ts:12` ma to samo dwuczłonowe wyrażenie, więc jest **zielona**.

To jedyne sześć trzyczłonowych nazw w repozytorium na 63 rodzaje zdarzeń — dlatego nie ujawniło się
nigdzie indziej. Skutek: cały cykl życia zgłoszenia jest niewidoczny dla szyny — brak śladu
audytowego, brak odświeżania na żywo, brak możliwości podpięcia czegokolwiek pod „zgłoszenie
rozstrzygnięte”.

Naprawa: najpierw poprawić wyrażenie bramki na `/'([a-z_]+(?:\.[a-z_]+)+\.v\d+)'/` — zczerwienieje
i pokaże komplet. Potem rozstrzygnąć: rozluźnić `CHECK` na szynie do wielu członów albo przemianować
sześć zdarzeń na dwuczłonowe (`event_registration.created.v1`). Na końcu dopisać wpisy do katalogu
i reguły inwalidacji.

**K-5 · Dialog „Umów spotkanie” nie znajdzie nigdy żadnego uczestnika**

`const ARRANGEABLE_STATUS = "confirmed"` (`meetingParticipants.ts:26`) trafia jako `p_status` do
`admin_event_registrations_list`, które filtruje dosłownie:
`AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)`
(`20260824090214_f14a8b5f-…sql:767`). Ograniczenie kolumny dopuszcza wyłącznie
`draft, pending, approved, rejected, waitlist, cancelled, attended, no_show`
(`20260823150000_event_people_registration.sql:692`). Wartości `confirmed` w tym zbiorze **nie ma
i nigdy nie było**.

Skutek: wyszukiwarka w dialogu zawsze zwraca pustą listę, przycisk zapisu zostaje nieaktywny.
`admin_event_meeting_arrange` — jedyna droga realizacji obietnicy z pakietu sponsorskiego typu
„dziesięć umówionych spotkań” — jest z panelu nieosiągalna.

Naprawa: zmienić stałą na `"approved"`. Docelowo wyprowadzić dopuszczalne statusy z jednego miejsca:
kolumna jest typu `text`, więc typy generowane literówki nie złapią.

**K-6 · Edycja sponsora bezgłośnie kasuje notatkę wewnętrzną**

Łańcuch trzech poprawnych z osobna decyzji daje utratę danych. Dialog edycji dostaje wiersz
z `admin_event_sponsors_list`, który **celowo** nie zwraca `internal_note` — notatka jest tylko
w `admin_event_sponsor_detail`, co komentarz w migracji potwierdza
(`20260823160000_event_sponsors_companies.sql:1262-1296`). `sponsorDraftFromRow` czyta
`row.internal_note` (`sponsorDraft.ts:266`), dostaje `undefined` i zapisuje pusty napis.
`sponsorDraftToInput` zawsze zwraca `internalNote: trimOrNull(...)`, czyli `null` — nie `undefined`
(tamże:311). Pomocnik `payload()` odsiewa wyłącznie `undefined` (`sponsorsApi.ts:64-70`), więc klucz
**ląduje w ładunku z wartością null**. A SQL brzmi
`internal_note = CASE WHEN p_payload ? 'internal_note' THEN NULLIF(btrim(COALESCE(…,'')),'') ELSE internal_note END`
— klucz jest obecny, więc gałąź zachowawcza się nie uruchamia.

Skutek: notatka „umowa NES/2026/114, faktura po wydarzeniu” znika przy pierwszej edycji dowolnego
innego pola. Bez ostrzeżenia, bez śladu, bez możliwości odtworzenia.

Naprawa: zasilać dialog z `admin_event_sponsor_detail`, nie z wiersza listy; dodatkowo pomijać
`internalNote` w ładunku, gdy pole nie było w formularzu obecne.

**K-7 · Trzy z czterech odbiorców pakietu miejsc są nie do zapisania**

Klient deklaruje `PACKAGE_AUDIENCES = ["company", "university", "delegation", "partner"]`
z komentarzem „odwzorowanie CHECK-a `audience` jeden do jednego” (`packagesApi.ts:25`). Ograniczenie
w bazie brzmi `CHECK (audience IN ('public', 'member', 'academic', 'ngo', 'company'))`
(`20260824080000_…sql:268`, `20260825191948_ab7f57aa-…sql:180`). Wspólny element jest **jeden**:
`company` — i akurat on jest wartością domyślną szkicu, dlatego przebieg szczęśliwy działa.

Skutek: wybór „Uczelnia”, „Delegacja” albo „Partner” kończy się naruszeniem ograniczenia —
komunikatem z bazy, nie zdaniem po polsku. Kompilator tego nie łapie, bo kolumna jest typu `text`.
Ta sama klasa rozjazdu jest w formatach papieru identyfikatora (`onsiteApi.ts:64` oferuje `cr80`,
którego baza nie przyjmuje, i ukrywa cztery formaty, które przyjmuje).

Naprawa: zsynchronizować obie listy i dołożyć test porównujący stałe z klienta z wartościami `CHECK`
w migracjach — dokładnie tak, jak repozytorium robi to już dla kodów błędów i kluczy i18n.

### Waga wysoka

**U-14 → zastąpione przez K-4.** Przy weryfikacji okazało się, że problem sięga głębiej niż
katalog frontu: zdarzenia są odrzucane już przy zapisie do szyny. Pełny opis w K-1…K-7 powyżej.

**U-01 · Odnośnik zaproszenia na miejsce w pakiecie prowadzi donikąd**

`packageInviteUrl()` (`src/lib/events/packagesApi.ts:222–224`) składa adres
`/events/invite/<token>`, a panel pokazuje go administratorowi do wysłania delegatowi
(`EventPackageSeatsDialog.tsx:97`). W `src/routes/` **nie ma trasy** obsługującej ten adres — segment
„invite” trafia w `events.$slug` jako slug wydarzenia. Funkcja `event_package_invite_accept` istnieje
w bazie i nie ma ani jednego wywołania z aplikacji.

Skutek: organizator kupuje pakiet miejsc, zaprasza delegatów, wysyła odnośnik — delegat trafia na
„nie znaleziono wydarzenia”. Cały łańcuch delegowania miejsc urywa się na ostatnim kroku i nie da
się go domknąć z żadnej powierzchni.

Naprawa: trasa `events_.invite.$token.tsx` (podkreślnik, żeby nie dziedziczyła powłoki zakładek)
wołająca `event_package_invite_accept`, ze stanami: token nieznany, wygasły, wykorzystany, cofnięty.

---

**U-02 · Jedyna bramka wykonująca SQL modułu nie jest podpięta do CI**

`scripts/events-harness/` stawia własny klaster Postgresa, odtwarza 70 migracji modułu i uruchamia
884 asercje runtime. Trzy siostrzane harnessy mają wpisy w `package.json:66–68` i kroki
w `.github/workflows/ci.yml:653–671`. Harness wydarzeń **nie ma ani jednego wystąpienia**
w `package.json`, `.github/` ani `docs/`.

Meta-bramka `check:gate-coverage` tego nie złapie: sprawdza, czy każdy skrypt `check:*` **istniejący
w package.json** jest wpięty w workflow. Harness bez wpisu jest dla niej niewidzialny.

Skutek: klasa błędów, dla której harness powstał — kolizja sygnatur między migracjami, funkcja
czytająca nieistniejącą kolumnę, trigger, który nigdy nie odpala, `EXCLUDE`, które nic nie wyklucza —
przechodzi przez CI niezauważona. Bramki `check:sql-*` czytają migracje jako tekst; żadna ich nie
wykonuje.

Naprawa: `"check:events-harness": "bash scripts/events-harness/run.sh"` w `package.json` i krok
w zadaniu `pg-harness`. Harness ma własny port 5436, więc stoi równolegle do pozostałych trzech.

---

**U-03 · Onsite i spotkania nie mają ani jednej asercji runtime**

Pliki asercji harnessu numerowane są `00`, `10`, `20`, `30`, `40`, `70`, `80`, `90`, `95`–`97`.
Brakuje przedziałów `50` i `60`, czyli dokładnie onsite i spotkań. Migracje obu podsystemów **są**
odtwarzane (w logu jako `OK`), ale żadne zachowanie nie jest sprawdzane. Dla porównania: sesje mają
185 asercji, rejestracja 290, sponsorzy 223.

Skutek: bez testu zostają dwa najwrażliwsze mechanizmy modułu — izolacja leadów partnera (dane
osobowe), uwierzytelnianie i odwoływanie tokenu urządzenia, deduplikacja powtórnego skanu, oraz trzy
ograniczenia `EXCLUDE` chroniące przed podwójną rezerwacją. Dziś potwierdza je wyłącznie odczyt kodu.

Naprawa: `50_onsite.sql` — skan tokenem odwołanym / wygasłym / bez zakresu, powtórny skan w oknie
deduplikacji, lead widziany przez obcego sponsora, lead bez zgody. `60_meetings.sql` — dwa spotkania
na jednym miejscu przy stole w tym samym oknie, jedna osoba na dwóch spotkaniach, slot poza siatką.

### Waga średnia

**U-04 · Dziesięć funkcji RPC żyje w bazie bez wywołania z aplikacji**

Z 209 funkcji `event_*` w wygenerowanych typach, po odjęciu 38 pomocników wewnętrznych (`_event_*`)
zostaje dziesięć publicznych bez ani jednego wystąpienia w kodzie aplikacji:
`admin_event_audience_grant_save`, `admin_event_audience_grant_revoke`, `event_audience_qualifies`,
`event_admission_quote`, `event_package_purchase`, `event_package_invite_accept`,
`event_package_seat_invite`, `admin_event_package_seat_assign`, `admin_event_ticket_package_save`,
`event_ad_placements`.

Trzy braki widać najmocniej. **Uprawnienia odbiorcy** — stawka akademicka lub NGO wymagająca
potwierdzenia nie ma jak zostać nadana, bo nie ma ekranu wołającego `admin_event_audience_grant_save`.
**Wycena zakupu** — `event_admission_quote`, opisana w komentarzu jako „jedna odpowiedź na cztery
pytania ekranu zakupu”, jest martwa, a koszyk liczy przez `event_ticket_checkout_quote`; istnieją dwie
wyceny i jedna jest nieużywana. **Zakup pakietu** — `event_package_purchase` nie ma powierzchni.

Naprawa: rozstrzygnąć każdą z dziesięciu — ekran albo migracja usuwająca. Martwa funkcja
`SECURITY DEFINER` to powierzchnia, której nikt nie ogląda przy przeglądzie.

---

**U-05 · Reklama celowana na stronę wydarzenia — backend gotowy, frontu nie ma**

Kryterium odbioru E6: „reklama wydarzenia celowana w grupę, z odsłonami i klikami z `ad_events`”.
Funkcja `event_ad_placements` istnieje, jej komentarz opisuje emisję po slugu i pozycji
z uwzględnieniem `page_type = 'event'` i przypięcia `ad_placements.page_id`. W `src/components/events/`
i w trasach `/events/*` nie ma ani jednego `AdSlot` ani wywołania tej funkcji.

Skutek: kampanie z zakresem „to wydarzenie” nigdzie się nie wyświetlą, odsłony i kliki nie powstaną,
sprzedaż ekspozycji sponsorowi na stronie wydarzenia nie jest wykonalna.

---

**U-06 · Snapshot bramek autoryzacji rozjechany przez dwie migracje tego modułu**

`src/lib/authz/authzSnapshot.generated.ts:81` nosi `{"migrations":904,"functions":1074}`, repo ma 906
i 1077. Nowe to `event_my_event_profile_set` (28.08, 12:40) i `event_meeting_directory` (28.08, 13:16)
— obie z tego modułu — plus jedna CRM-owa. Diagnostyka bramki nazywa to poprawnie „prowieniencją”:
ten sam krąg uprawnionych, starszy skan. To nie jest regresja uprawnień.

Naprawa: `bun run generate:authz-snapshot` i commit. Jedno polecenie zdejmuje jeden czerwony test
i jedną czerwoną bramkę.

---

**U-07 · Sześć komponentów wydarzeń woła klucze nakładki, której nie importuje**

`check:i18n-overlay-imports` wskazuje: `PreviewMePanel.tsx` oraz
`src/components/events/participant/molecules/{EventPersonActions,MyAgendaList,MyEventProfileForm,MyEventPublicPreview,OrganizationPicker}.tsx`.
Wszystkie używają kluczy `eventMe.*` bez `import "@/lib/i18n-cart"`. Nakładka rejestruje klucze
**efektem ubocznym importu**, a dziś wciąga ją rodzic (`EventMePanel`, `EventTabsNav`,
`EventPreviewCanvas`).

Skutek: dopóki rodzic i dziecko siedzą w jednym chunku, ekran działa. Pierwsza zmiana podziału na
chunki albo pierwszy nowy rodzic bez tego importu daje uczestnikowi surowy klucz
`eventMe.fields.company` zamiast etykiety — i żadna inna bramka tego nie zobaczy.

Osobno: nakładka nazwana `i18n-cart` trzyma słownik panelu uczestnika. Celowo (nagłówek pliku to
uzasadnia), ale nazwa tego nie mówi.

---

**U-08 · 85% paneli administracyjnych nie ma żadnego testu komponentu**

72 z 84 komponentów w `src/components/admin/events` nie występują w żadnym pliku testowym. Rozkład
pokrycia jest bardzo nierówny: `src/lib/events` — 19% modułów bez testu, `src/components/events` —
46%, panel administracyjny — **85%**. Bez testu zostają wszystkie panele agendy, onsite, spotkań
i sponsorów, a także `EventGeneralPanel` i `EventBrandingPanel`.

Skutek: 4164 zielone testy modułu mierzą przede wszystkim czystą logikę i front publiczny. Regresja
w panelu — pole, które przestaje się zapisywać, dialog niezamykający się po błędzie, tabela gubiąca
stan pusty — nie zostanie zauważona.

Naprawa: nie 72 testy naraz. Zacząć od paneli zapisujących dane o największej liczbie pól:
`EventGeneralPanel`, `EventBrandingPanel`, `EventTicketsPanel`, `RegistrationFieldsPanel`,
`AgendaSessionsPanel`. Test ma sprawdzać zachowanie, nie sam render.

---

**U-09 · Widgety agendy i sponsorów nadal czytają wyłącznie treść własną**

Specyfikacja §0.2 nazywa to kluczową rekomendacją architektoniczną: widget `event-schedule` ma dostać
`source: "event"` obok `manual` i renderować z `event_sessions` — tak jak `speakers` ma już
`manual | directory | event`. W `src/lib/builder/registry.tsx:1346` `event-schedule` ma nadal wyłącznie
`days[].sessions[]` w treści widgetu; `event-sponsors` (`:1443`) tak samo trzyma `tiers[].sponsors[]`.

Skutek: portal wydarzenia (`/events/$slug/agenda`) czyta agendę z bazy przez `event_agenda` i jest
w porządku. Ale redaktor składający landing wydarzenia w builderze musi **przepisać agendę ręcznie** —
powstaje drugi zapis tych samych sesji, rozjeżdżający się przy pierwszej zmianie godziny.

### Waga niska

**U-10 · `format:check` przewraca `verify:static` na pierwszym kroku**

59 plików nie przechodzi Prettiera, ok. 40 w module. `verify:static` jest ułożony „po koszcie”
i zatrzymuje się na pierwszym czerwonym — **pozostałych 24 bramek w ogóle nie uruchamia**. Dopóki ten
krok stoi na czerwono, realny błąd, który któraś z tamtych bramek by złapała, jest niewidoczny.
Naprawa: `bun run format`, potem `bun run verify:static` w całości.

**U-11 · 23 z 213 kodów błędu bazy nie mają klucza tłumaczenia**

Mapowanie jest dynamiczne: głowa komunikatu plpgsql (`seat_taken:`) idzie na `camelCase` i szuka
klucza w nakładce, a nieznany wraca na `…unknown`. Z 213 kodów rzucanych przez funkcje modułu 23 nie
mają klucza w żadnej nakładce — m.in. `missing_required_consents`, `seats_exhausted`, `no_free_seat`,
`invalid_ticket_type`, `event_type_inactive`, `tier_over_capacity`.

Dla większości kodów waga jest niska, bo odpowiadające im ścieżki są zablokowane walidacją
klienta — to luka w obronie w głąb. **Z jednym wyjątkiem, który zmienia obraz:**
`missing_required_consents` jest w zwykłym przebiegu osiągalne, bo formularz w ogóle nie dostaje pól
zgody z serwera (patrz K-2) — i to właśnie brak tego klucza sprawia, że uczestnik widzi „coś poszło
nie tak” zamiast wskazówki. Brak tłumaczenia nie jest tam przyczyną awarii, ale zamienia ją w awarię
niediagnozowalną. Docelowo: test porównujący zbiór `RAISE EXCEPTION` funkcji modułu ze zbiorem kluczy
nakładek — dziś nic tego nie pilnuje.

**U-12 · `event_capabilities()` nadal nie istnieje**

Specyfikacja stawia tę funkcję jako mitygację ryzyka nr 2 i wpisuje ją w kryterium odbioru E5.
W repozytorium nie ma ani jednego wystąpienia. Autoryzacja stoi na `assert_event_admin_tenant` /
`assert_event_staff_tenant` (102 wywołania). Skutek jest mniejszy, niż brzmi: te asercje pokrywają
**obsadę** i robią to konsekwentnie; nie pokrywają **uprawnień grupy uczestników** — reguła „co widzi
członek grupy X” jest rozproszona po poszczególnych RPC. Dokument sam nazywa ten dług w punkcie 6.
Do rozstrzygnięcia produktowego, nie do dopisania w biegu.

**U-13 · Test `MenuManager` przewraca się tylko pod obciążeniem**

Wyścig na asercji stanu przejściowego. Poza modułem wydarzeń, ale liczy się do tego samego czerwonego
CI i uczy zespół ignorować czerwień. Naprawa: wstrzymać rozstrzygnięcie mutacji i sprawdzić `disabled`
przy zatrzymanym zapisie, zamiast sprawdzać stan przejściowy po czasie.

> **Aneks z 2026-09-02.** Powyższa recepta była już wtedy wdrożona i **okazała się no-opem**: test od
> początku wstrzymywał rozstrzygnięcie mutacji (`mockImplementationOnce` z ręcznym `release`) i i tak
> się przewracał. Diagnoza „wyścig na asercji" wskazywała złe miejsce — wyścig siedział w helperze
> `clickSave`, nie w asercji.
>
> Prawdziwy mechanizm: `Mutation.execute` rozgłasza `pending` synchronicznie
> (`query-core/mutation.js:94`), ale react-query doręcza to rozgłoszenie do drzewa **makrozadaniem** —
> `notifyManager` planuje je przez `systemSetTimeoutZero`, czyli `setTimeout(cb, 0)`
> (`query-core/timeoutManager.js:62-64`). `await act(async () => …)` czeka na własną obietnicę, a nie
> na cudzy zegar: przy bezczynnej pętli zdarzeń zgarniał ten timer przypadkiem, pod obciążeniem pełnej
> suity callback wypadał za drenaż act i natychmiastowa asercja czytała drzewo sprzed przełączenia
> `isPending`. Zmierzone sondą: tuż po `fireEvent.click` przycisk ma `disabled === false`.
>
> Co zmieniono (`src/components/admin/menu/__tests__/MenuManager.test.tsx`):
>
> 1. `clickSave` domyka jedną turę makrozadań jawnie, wewnątrz tego samego `act`, zaraz po
>    `fireEvent.click`. Kolejka zegarów jest FIFO, a timer react-query rejestruje się w trakcie
>    synchronicznego kliku — czyli przed naszym. Uporządkowanie jest więc strukturalne, nie czasowe.
>    Sonda potwierdza: na znaczniku zarejestrowanym po kliku `disabled === true`.
> 2. Asercja `expect(button).toBeDisabled()` **została natychmiastowa** — bez `waitFor`, bez `try/catch`.
>    Naprawiono harmonogram, nie osłabiono pomiaru.
> 3. Dołożono asercję **skutku**: drugi klik w trakcie trwającego zapisu nie wysyła drugiego zapisu.
>    Ma własny flush, bo bez niego byłaby zawsze zielona (react-query dochodzi do `mutationFn` dopiero
>    po `await onMutate`, `query-core/mutation.js:102`) — czyli martwa bramka dokładnie nad klasą awarii,
>    w której destrukcyjny zapis menu (delete-all + insert-all) rusza dwa razy równolegle.
>
> Kontrpróbki (zmierzone): po usunięciu `disabled={saveMutation.isPending}` z `MenuManager.tsx` czerwienią
> się obie asercje — blokada („Received element is not disabled") i skutek („expected 1 times, but got
> 2 times"). Po zdjęciu flusha z asercji skutku ta sama kontrpróbka przechodzi na zielono, co potwierdza,
> że flush jest tam nośny, a nie kosmetyczny. Stabilność: 5 przebiegów pod rząd, 66/66 w każdym.

---

## 5. Dokumentacja wyprzedzona przez kod

Dziennik wdrożenia w dokumencie nadrzędnym kończy się na 26 sierpnia, a moduł pracował dalej. Trzy
pozycje z listy „dług nazwany wprost” są już zamknięte — przy następnym porównaniu ze zrzutami będą
wyglądać na zaległość, którą nie są.

| Zapis w dokumencie                                                                                          | Stan faktyczny                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1 — „zostało: przekierowanie ze starej trasy… trasa **żyje dalej** jako druga powierzchnia”                | **Zamknięte.** `admin.community.events.tsx` ma 30 linii i wyłącznie `throw redirect({ to: "/admin/events/list" })` w `beforeLoad`. Sześć starych tras org-wide też przekierowuje.                                                          |
| Dług 1 — „`event_pages` nadal nie istnieje”                                                                 | **Zamknięte.** Tabela istnieje, `eventPagesApi.ts` czyta ją przez `admin_event_pages_list`, jest kolumna `module` z CHECK-iem `event_pages_module_values`.                                                                                 |
| Dług 2 — „front publiczny nie czyta nowych kolumn… `schema.org/Event` bez adresu strukturalnego”            | **Zamknięte.** `events.$slug.index.tsx:413` i `:443` podają `street_address`, `postal_code`, `city`, `region`, `country` do sekcji praktycznych i do JSON-LD.                                                                              |
| Dług 2 c.d. — „dopóki nie ma widgetu `event-menu`, `pages_display_mode` widać tylko w podglądzie”           | **Rozwiązane inaczej.** Widgetu nie ma i nie jest potrzebny: `EventMenuNav`, `EventMenuTiles` i `EventTabsNav` honorują `pages_display_mode` natywnie w portalu.                                                                           |
| Dług 3 — „Komunikacja / Integracje / Analityka odsyłają do modułów globalnych, ekranu przełączników nie ma” | **Częściowo.** Analityka ma własną powierzchnię, przełączniki modułów istnieją (`EventFeaturesPanel`, `admin_event_features_save`). Komunikacja i Integracje pozostają drogowskazami, zgodnie z zapisem, że czekają na decyzję produktową. |

### 5.1 Kształt historii migracji utrudnia każdy kolejny przegląd

**Prawie każda tabela i funkcja modułu ma dwie definicje** — jedną w migracji nazwanej opisowo, drugą
w migracji Lovable z UUID-em w nazwie — i **ta druga jest najczęściej ostatnia**, czyli obowiązująca.
`rsvp_event` ma 15 definicji, `admin_event_create` dziewięć. Przegląd czytający wyłącznie pliki
`*_event_*.sql` opisze stan sprzed poprawek: `event_lead_scans_list` w wersji opisowej różni się od
obowiązującej (ta druga hashuje token i bramkuje pola osobowe zgodą).

Harness rozwiązuje to poprawnie — dobiera migracje **po treści** (`public.admin_event_`,
`events_tenant_id_key`, znacznik `events-harness: include`), nie po globie nazwy. Warto, żeby ten sam
odruch mieli ludzie: przy każdym pytaniu „jak działa funkcja X” szukać **ostatniej** jej definicji,
nie tej w pliku o ładnej nazwie.

---

## 6. Proponowana kolejność

Najpierw to, co dziś zachowa się źle wobec uczestnika lub pieniędzy. Potem odzyskanie sygnału z CI,
potem domknięcie funkcji, na końcu pokrycie.

1. **Zatrzymać dwie rzeczy, które psują wydarzenie na produkcji — dziś.** Do czasu poprawki: nie
   konfigurować płatnych biletów w przebiegu formularza (K-1) i nie oznaczać pól zgody jako
   wymaganych (K-2). Obie konfiguracje da się dziś ustawić w studiu bez żadnego ostrzeżenia, a obie
   kończą się cicho złym skutkiem.
2. **Zamknąć wyciek adresów sesji.** `event_session_access` oddaje anonimowi nagrania wydarzenia dla
   członków; wzorzec naprawy jest w `get_event_access`. _(K-3)_
3. **Trzy poprawki jednolinijkowe o dużym zasięgu.** Status w dialogu spotkań (K-5), zasilanie
   dialogu sponsora z RPC szczegółu (K-6), zsynchronizowanie list `audience` i formatów
   identyfikatora (K-7). Każda jest tania i każda odblokowuje funkcję, która dziś nie działa wcale.
4. **Rozstrzygnąć nazewnictwo zdarzeń rejestracji.** Najpierw poprawka wyrażenia w bramce
   (zczerwienieje i pokaże komplet), potem decyzja: rozluźnić `CHECK` szyny czy przemianować sześć
   zdarzeń. _(K-4)_
5. **Odblokować bramki.** `bun run format` i `bun run generate:authz-snapshot`, potem
   `bun run verify:static` w całości — dopiero wtedy widać, co mówią 24 bramki dziś nieuruchamiane.
   _(U-06, U-10)_
6. **Podpiąć harness wydarzeń do CI.** Jedna linia w `package.json`, jeden krok w `ci.yml`. 884
   asercje istnieją i przechodzą — dziś nikt ich nie uruchamia poza ręcznym wywołaniem. _(U-02)_
7. **Domknąć trasę zaproszenia.** Bez niej pakiety miejsc są funkcją, której nie da się użyć do
   końca, mimo że backend jest kompletny. _(U-01)_
8. **Rozstrzygnąć dziesięć osieroconych funkcji RPC.** Każda dostaje ekran albo migrację usuwającą.
   Przy okazji zapada decyzja, która z dwóch wycen zakupu zostaje. _(U-04, U-05)_
9. **Dopisać `50_onsite.sql` i `60_meetings.sql`.** Po kroku 6 mają gdzie się uruchamiać, a chronią
   to, co w tym module najdroższe do naprawienia po fakcie. _(U-03)_
10. **Przejść pozostałe ustalenia wysokie z załącznika** — w szczególności bramkę roli redaktora
    w studiu, zasiew stron publicznych dla wydarzenia w statusie `draft`, prelegenta bez konta
    znikającego z agendy i przypomnienia omijające zgłoszenia z formularza.
11. **Sześć importów nakładki i 23 klucze błędów.** Tanie, a zdejmuje klasę usterek, których żadna
    bramka nie widzi. _(U-07, U-11)_
12. **Testy paneli, od tych, które zapisują.** Pięć paneli o największej liczbie pól. _(U-08)_
13. **Decyzje produktowe, nie kod:** `source: "event"` dla widgetów agendy i sponsorów oraz czy
    `event_capabilities()` powstaje, czy dług zostaje świadomie zamknięty. _(U-09, U-12)_

---

## 7. Jak powstał ten przegląd

Piętnaście podsystemów przejrzanych niezależnie od siebie, każdy przez osobnego recenzenta czytającego
kod (nie specyfikację). Każdy zestaw ustaleń przeszedł następnie **adwersaryjną weryfikację** — osobne
przejście, którego zadaniem było ustalenia OBALIĆ, z domyślnym założeniem, że są błędne, dopóki kod
nie pokaże inaczej. Dziewięć ustaleń weryfikacji nie przetrwało i jest opisanych na końcu załącznika.
Wszystkie ustalenia krytyczne zostały dodatkowo sprawdzone ręcznie przy składaniu raportu.

Osobno uruchomiono komplet dostępnych testów (§1) — w tym `events-harness`, który stawia własny
klaster PostgreSQL 16, odtwarza 70 migracji modułu i wykonuje 884 asercje runtime. To jedyna bramka
w repozytorium, która moduł **wykonuje**, a nie czyta jako tekst; nie jest podpięta do CI (U-02).

---

## 8. Stan wobec `main` — sprawdzone 2026-08-28, wieczorem

Przegląd powstał na commicie `9997ac0`. Zanim został wniesiony, `main` poszedł **38 commitów do
przodu** i część ustaleń jest już zamknięta. Ta sekcja mówi, co sprawdzić można było, a czego nie —
żeby nikt nie naprawiał drugi raz tego samego ani nie uznał za zamknięte czegoś, co stoi otworem.
Wszystko poniżej odczytane z `origin/main`, nie z opisów commitów.

### Zamknięte na `main`

| Ustalenie                               | Dowód na `main`                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U-01** trasa `/events/invite/<token>` | trasa jest w `src/routeTree.gen.ts`                                                                                                                                         |
| **U-02** harness wydarzeń poza CI       | `check:events-harness` jest w `package.json`                                                                                                                                |
| **U-03** brak asercji onsite i spotkań  | `scripts/events-harness/runtime_test.d/` ma już `50_onsite.sql` i `60_meetings.sql`                                                                                         |
| **U-04** część osieroconych funkcji RPC | `20260828152704` usuwa `admin_event_ticket_package_save` i `event_ad_placements` jako martwe duplikaty; `20260828162131` dobudowuje panel i audyt nadań uprawnień do stawek |

### Nadal otwarte na `main`

| Ustalenie                                 | Stan na `main`                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------- |
| **K-1** płatny bilet za darmo             | najnowsza definicja `event_register` to wciąż `20260827220945` — bez `price_cents` |
| **K-2** pole zgody blokuje zapis          | `event_registration_form` nadal nie zwraca listy zgód                              |
| **K-3** wyciek adresów sesji do anonima   | `event_session_access` bez zmian od `20260824084741`                               |
| **K-5** martwy dialog „Umów spotkanie”    | `ARRANGEABLE_STATUS = "confirmed"` — bez zmian                                     |
| **K-6** kasowanie notatki sponsora        | dialog nadal zasilany wierszem listy (`sponsorDraftFromRow(sponsor)`)              |
| **K-7** odbiorcy pakietu nie do zapisania | `PACKAGE_AUDIENCES` bez zmian                                                      |
| **U-06** snapshot bramek autoryzacji      | rozjazd **powiększył się**: snapshot nadal `migrations: 904`, repozytorium ma 909  |

### K-4 — naprawione to, co widać, nie to, co psuje

To jest jedyna pozycja, która wymaga osobnego zdania, bo wygląda na zamkniętą, a nie jest.

Na `main` zrobiono dwie z trzech rzeczy: wyrażenie w bramce poprawiono dokładnie tak, jak
proponowałem (`/'([a-z_]+(?:\.[a-z_]+)+\.v\d+)'/`), a katalog frontu dostał komplet sześciu nazw
i osiem reguł inwalidacji. **Trzeciej — nie:** `domain_events.event_type` ma nadal
`CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$')`, czyli dwa człony. Żadna migracja tego
ograniczenia nie rusza.

Skutek jest gorszy niż stan wyjściowy. Bramka sprawdza, czy każde emitowane zdarzenie jest
zadeklarowane w katalogu — po obu poprawkach jest, więc **bramka świeci na zielono**. Tymczasem
`INSERT` do `domain_events` nadal narusza ograniczenie, a `emit_domain_event` kończy się
`EXCEPTION WHEN OTHERS THEN RETURN NULL`, więc sześć zdarzeń rejestracji **nadal nigdy nie trafia na
szynę**. Przedtem defekt był niewidoczny; teraz jest niewidoczny i dodatkowo potwierdzony zielonym
testem.

Do domknięcia zostaje jedna decyzja: rozluźnić `CHECK` do wielu członów albo przemianować sześć
zdarzeń na dwuczłonowe. Warto przy tym dołożyć asercję, która sprawdza, że zdarzenie faktycznie
**wylądowało** w `domain_events` — bramka porównująca nazwy tego nie zobaczy z definicji.
