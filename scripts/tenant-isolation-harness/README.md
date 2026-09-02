# tenant-isolation-harness

Wykonawcza (nie statyczna) bramka izolacji obszarow roboczych dla plaszczyzny
wlasciciela: `media_mentions`, `saved_searches`, `user_follows` oraz - od
2026-08-31 - `subscriptions`, `membership_grants`, `organization_seats`,
`user_purchases`, `user_subscriptions`, `post_gift_links`; od 2026-09-01 takze
dla PLASZCZYZNY CZATU: `conversations`, `conversation_participants`,
`conversation_nicknames`, `messages`, `message_reactions`, `message_stars`,
`user_blocks`, `expert_inmails`.

## Po co

Audyt 2026-08-29 pokazal, ze polityki wlascicielskie tych tabel bramkowaly
wylacznie `user_id = auth.uid()`, mimo ze kazda z nich ma NOT NULL `tenant_id`.
Skutek: wiersz zalozony w jednym obszarze roboczym byl czytelny i edytowalny
z innego (dryf profilu), a `WITH CHECK` pozwalal ZAPISAC wiersz do cudzego
obszaru. Naprawa: migracja `20260829091010`.

## Co robi

1. `harness.sql` - minimalna atrapa platformy (auth.users, tenants, profiles,
   `auth.uid()`, `current_tenant_id()`, `public_tenant_id()`, `has_role()`,
   `is_super_admin()`, funkcje czatu: `member_conversation_ids()`,
   `is_tenant_conversation_member()`, `chat_read_receipts_enabled()`,
   `is_conversation_member()`) plus tabele i - dla plaszczyzny wlasciciela -
   polityki w stanie SPRZED naprawy.
2. `run.sh` - aplikuje PRAWDZIWE migracje polityk z `supabase/migrations`
   (dobor po tresci, nie po nazwie pliku) w dwoch etapach: cale pliki dla
   plaszczyzny wlasciciela, same instrukcje polityk dla czatu.
3. `extract_chat_policies.awk` - wycina z migracji doslownie instrukcje
   `CREATE POLICY` / `DROP POLICY` dotyczace tabel czatu (etap 2).
4. `runtime_test.sql` - asercje na zywej bazie z wlaczonym RLS i rola
   `authenticated`: brak odczytu, zmiany i kasowania wierszy z obcego obszaru,
   odrzucenie zapisu do obcego obszaru, poprawny obszar domyslny; dla czatu
   takze granica ROZMOWY, TTL, czyszczenie historii per uczestnik i rozdzial
   zamka grantow od zamka polityk.

## Rozszerzenie 2026-08-31 (moduly monetyzacji)

Przeglad polityk modulow 13 (checkout/subskrypcje/billing) i 14 (kupony/
darowizny/prezenty/reklamy) wykazal SZESC dalszych wystapien tego samego
wzorca; domkniete migracja `20260831060000`. Wszystkie sa na kolumnie SELECT,
wiec przeciekal ODCZYT: historia zakupow, subskrypcji, przydzialow czlonkostwa,
miejsc w organizacji i linkow prezentowych byla widoczna dla wlasciciela takze
spoza obszaru, w ktorym powstala.

Dlaczego statyczna bramka `check:sql-owner-tenant-scope` ich nie widziala:
jest SAMOKALIBRUJACA - zapala sie, gdy na tej samej tabeli jedna klauzula
WLASCICIELSKA wiaze tenanta, a inna go gubi. Kazda z tych szesciu tabel ma
dokladnie JEDNA polityke wlascicielska, a tenanta pilnuje polityka
ADMINISTRACYJNA - nie ma wiec rodzenstwa deklarujacego intencje. Ta klasa luki
jest poza zasiegiem tamtej bramki z konstrukcji i wymaga dowodu wykonawczego.

`post_gift_links` dokladalo drugi powod niewidocznosci: wlascicielem jest tam
`created_by`, a nie `user_id`.

## Rozszerzenie 2026-09-01 (moduł 09 - czat)

Moduł 09 dostał bramkę STATYCZNĄ (`src/lib/ci/__tests__/chatPolicyContract.test.ts`),
która dowodzi KSZTAŁTU polityk czytanego z migracji. Brakowało dowodu
WYKONAWCZEGO. Audyt prosił o „przypnij pgTAP-em" - ta uprząż jest istniejącym
w repo odpowiednikiem, więc płaszczyzna czatu weszła tutaj.

W czacie granice są DWIE i wykonawczo trzeba je rozdzielić:

- OBSZAR ROBOCZY - `tenant_id = current_tenant_id()`,
- ROZMOWA - `conversation_id IN (SELECT member_conversation_ids())`.

Dlatego obsada to trzy osoby, a nie dwie: Jan i Zofia siedzą w tym samym
tenancie, ale nie w tych samych rozmowach; Barbara jest w obcym tenancie.
Bez trzeciej osoby nie da się odróżnić „obcy tenant" od „ten sam tenant, ale
obca rozmowa", a to są w tym module dwie różne polityki.

Co zostało udowodnione wykonawczo: odczyt wiadomości tylko dla członka rozmowy,
TTL (`expires_at`) i czyszczenie historii per uczestnik (`cleared_before`)
egzekwowane W POLITYCE, stemplowanie nadawcy przy zapisie, członkowski odczyt
reakcji kontra właścicielski odczyt gwiazdek, brak ścieżki zapisu dla
`authenticated` na `conversations`, `conversation_participants` i
`conversation_nicknames` oraz właścicielski zakres `user_blocks`.

### Dwa zamki, rozdzielone w asercjach

W tym module odmowa ma dwa niezależne źródła i uprząż ich nie miesza:

1. BRAK GRANTU (`permission denied`) - `authenticated` nie ma prawa zapisu.
2. BRAK ALBO NIESPEŁNIONA POLITYKA (`row-level security`).

Asercje „ZAMEK 2" chwilowo nadają brakujący GRANT, sprawdzają, że zapis nadal
odbija się o RLS, i grant zdejmują. Bez tego kroku „nie da się założyć rozmowy"
przechodziłoby wyłącznie dzięki grantowi i milczałoby o tym, czy brak polityki
INSERT jest realnym zamkiem.

### Skąd biorą się polityki czatu (etap 2 w `run.sh`)

Migracje polityk czatu są ZLEPKAMI: jeden plik niesie politykę czatu obok
`storage.buckets`, `notifications`, `content_access`, `author_profiles`, tabel
sieci kontaktów i kilkunastu funkcji obcych modułów. Zastosowanie takiego pliku
w całości wymagałoby kilkunastu atrap spoza modułu 09, a każda atrapa to
kolejne NIEZWERYFIKOWANE zdanie o kształcie cudzej tabeli.

Dlatego `extract_chat_policies.awk` wycina z migracji WYŁĄCZNIE instrukcje
`CREATE POLICY` / `DROP POLICY` dotyczące tabel czatu i kopiuje je bajt w bajt.
Pliki idą chronologicznie, instrukcje w kolejności wystąpienia, więc idiom repo
„DROP POLICY IF EXISTS x; CREATE POLICY x …" daje ten sam STAN KOŃCOWY, co
pełny przebieg. Po założeniu polityk `run.sh` porównuje stan bazy z listą
polityk przypiętą przez bramkę statyczną - rozjazd jest błędem twardym, nie
cichym SKIP-em.

### `expert_requests` kontra `expert_inmails` - duchy po przemianowaniu tabeli

Prośba ekspercka NIE przecina obszarów roboczych i żywe polityki tego pilnują -
uprząż wykonuje je na prawdziwej bazie i dostaje pustkę dla wiersza dryfującego
do obcego obszaru. Nazwa `expert_requests` bywa jednak myląca, bo zostaje w
mapie `extractLatestPolicies` jako duch po RENAME, którego statyczny parser nie
umie odtworzyć:

| migracja         | co robi                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| `20260723090707` | `CREATE TABLE public.expert_inmails` + polityki `inmails: …`            |
| `20260723180000` | RENAME na `expert_requests` + polityki `expert_requests: …` BEZ tenanta |
| `20260806160001` | RENAME z powrotem na `expert_inmails` („rename nigdy nie wjechał")      |
| `20260806185055` | DROP obu starych rodzin nazw + polityki `expert_inmails: …` Z tenantem  |

Polityki podróżują z tabelą, więc stan końcowy siedzi na `expert_inmails`.
`extractLatestPolicies` kluczuje po nazwie tabeli wyczytanej Z TEKSTU, więc
DROP-y adresowane do `public.expert_inmails` nie trafiają w klucze założone
jako `public.expert_requests` - i stara rodzina zostaje w jej mapie jako duch.
`src/lib/ci/__tests__/chatPolicyContract.test.ts` czyta więc `expert_inmails` i
asertuje niezmiennik wprost (każda polityka inna niż INSERT wiąże
`tenant_id = current_tenant_id()`, INSERT ma `WITH CHECK (false)`), a osobnym
testem przypina same duchy, żeby ograniczenie parsera było opisane, a nie
mylone ze stanem bazy. Sekcja
`== prosby eksperckie: pulapka na regresje po przemianowaniu tabeli ==` w
`runtime_test.sql` dokłada dowód wykonawczy i zastawia pułapkę na regresję:
gdyby ktoś przywrócił tenant-ślepe polityki, asercja o niewidoczności wiersza
dryfującego pada natychmiast (sprawdzone mutacją przy pisaniu tej sekcji).

## Uruchomienie

```bash
bun run check:tenant-isolation      # albo: bash scripts/tenant-isolation-harness/run.sh
bash scripts/tenant-isolation-harness/run.sh --keep   # zostawia baze do debugu
```

## Czego NIE sprawdza

Nie zastepuje statycznej bramki `src/lib/ci/__tests__/tenantIsolationPolicies.test.ts`
(stan koncowy polityk we WSZYSTKICH migracjach) ani `check:sql-owner-tenant-scope`.
Atrapa odtwarza tylko otoczenie potrzebne do wykonania tych trzech polityk.

Poza zakresem od 2026-09-01 (płaszczyzna czatu), z podaniem powodu:

- KANAŁ REALTIME (`realtime.messages`: „pisze…", obecność). Polityki kanałów
  wiążą tenanta TEMATEM kanału, a nie kolumną wiersza, i wymagają schematu
  `realtime` z `realtime.topic()`. Atrapa go nie ma - podsumowanie
  `runtime_test.sql` asertuje wprost, że schematu `realtime` NIE MA, żeby brak
  pokrycia był widoczny, a nie milczący. Kształt tych sześciu polityk pilnuje
  bramka statyczna.
- TRIGGERY STEMPLUJĄCE (`messages_before_insert`, `message_reactions_before_insert`,
  `message_stars_before_insert`). W produkcji nadpisują `tenant_id` i
  `conversation_id` wartościami z rozmowy albo z wiadomości - to DRUGA kładka.
  Gdyby stały w atrapie, każda asercja „zapis z obcym `tenant_id` jest odrzucany"
  przechodziłaby dzięki TRIGGEROWI, a polityka nie zostałaby wykonana ani razu.
  Uprząż mierzy wyłącznie pierwszą kładkę.
- RPC ZAPISU (`get_or_create_direct_conversation`, `create_group_conversation`,
  `chat_set_nickname`, `chat_clear_history`, `send_expert_request`). Uprząż
  dowodzi, że dla `authenticated` NIE MA innej drogi zapisu; tego, co robią same
  funkcje, nie sprawdza.
- RLS NA `public.profiles`. Atrapa daje `authenticated` odczyt profili, ale nie
  modeluje polityki odczytu własnego wiersza. To jedyne miejsce, w którym forma
  funkcyjna (`current_tenant_id()`, SECURITY DEFINER) i podzapytaniowa
  (biegnie jako wołający) mogą się rozjechać - i ta różnica jest przypięta
  statycznie w `chatPolicyContract.test.ts`.
- `user_blocks.tenant_id` NIE MA DEFAULT-u w całym łańcuchu migracji, więc
  równoważności obu form wyznaczania tenanta nie da się pokazać wartością
  domyślną kolumny. Zamiast tego uprząż dowodzi jej OBIEGIEM ZAPIS-ODCZYT na
  jednym wierszu: kasuje go polityka `DELETE` (forma funkcyjna), wstawia z
  powrotem polityka `INSERT` (forma podzapytaniowa), po czym wiersz znów widać.
