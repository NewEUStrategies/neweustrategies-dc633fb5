# Wdrożenie: izolacja tenanta w bramce eksperta, komplet eksportu RODO, doręczenia zapytań, pokrycie modułu

Data: 2026-08-06 · Zakres: cztery findingi audytu (izolacja tenanta, RODO, doręczenia, pokrycie testowe)

---

## 1. Predykaty „ekspert"/„VIP" nieskalowane tenantem - obejście bramki tiera czatu

### Stan zastany

`public.is_expert_user(uuid)` (migracja 20260723090707) i `public.is_vip_user(uuid)`
(20260723092200) rozstrzygały status **globalnie**, bez ani jednego predykatu na
`tenant_id`:

| funkcja          | źródła statusu                                                                                    | predykat tenanta |
| ---------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| `is_expert_user` | `author_profiles`, `event_speakers`, `podcast_episode_people`, `user_roles` (admin/editor/author) | **brak**         |
| `is_vip_user`    | `membership_grants`, `user_subscriptions` + `access_plans`                                        | **brak**         |

Obie funkcje siedzą w **każdej** bramce tiera czatu jako obejście:

- `get_or_create_direct_conversation` - `chat: tier disabled` oraz
  `chat: expert requires inmail`,
- `create_group_conversation` - `chat: tier disabled`,
- `my_expert_request_quota` - flaga `direct` (pula 100 000 zamiast 1-3).

Skutek: **jedno** autorstwo albo **jeden** grant VIP w obszarze roboczym cudzej
firmy otwierało w naszym obszarze pełny czat, bezpośredni DM do ekspertów i
praktycznie nielimitowane zapytania - bez wykupionego progu. Bramka
monetyzacyjna była obchodzona danymi spoza tenanta, czyli dokładnie tym, czego
izolacja obszarów roboczych ma zabraniać.

### Wdrożenie - `20260806160003_tenant_scoped_expert_vip_predicates.sql`

1. **Warianty dwuargumentowe** `(_uid, _tenant)` - kanoniczne, jawnie skalowane.
   Każde źródło dostaje predykat na tenanta; `event_speakers` nie ma własnej
   kolumny, więc idzie przez `events.tenant_id` (jak polityka RLS z 20260714112155).
   Dotyczy `is_expert_user`, `is_vip_user`, `is_gated_recipient`.
2. **Warianty jednoargumentowe** zostają (są w wielu ciałach), ale delegują do
   (1) z rozstrzygniętym tenantem: `COALESCE(current_tenant_id(), tenant domowy
PODMIOTU)`. Pierwszeństwo ma obszar **wywołania**; fallback działa tam, gdzie
   nie ma kontekstu HTTP (trigger, cron, `service_role`). Nigdy „gdziekolwiek".
3. **Konsumenci przekazują tenanta jawnie** - `get_or_create_direct_conversation`,
   `create_group_conversation`, `my_expert_request_quota`, `send_expert_request`.
   W ciele, które i tak wyliczyło `v_tenant`, jawny argument czyni bramkę
   czytelną i odporną na przyszłą zmianę semantyki wariantu 1-arg.

### Przy okazji: dwie nazwy, jeden poziom zabezpieczeń

Rodzina RPC zapytań do ekspertów żyje pod nazwą kanoniczną (`*_expert_request*`,
po rebrandingu z 20260723180000) i zastaną (`*_inmail*`, wciąż wołaną przez
klienta - `src/lib/chat/useExpertRequests.ts`). Poprawki z 20260724090500
(wyścig TOCTOU pod advisory lockiem + domknięcie obejścia puli przez
`send → cancel → send`) dostała **wyłącznie** gałąź kanoniczna, więc ścieżka
realnie używana przez UI została z obiema dziurami.

Migracja nadaje obu nazwom **jedno ciało** (poprawione i tenant-scoped),
budowane dynamicznie wokół relacji, która realnie istnieje
(`expert_requests` po rebrandingu, `expert_inmails` na produkcji - patrz
`SUPERSEDED` w `scripts/check-db-contract.ts`). Pula czyta
`features.expert_request_quota` z fallbackiem na zastane flagi boolowskie
(`chat_inmail_quota_5/2`), bo katalog progów bywa nierówno zmigrowany między
obszarami, a użytkownik nie może za to płacić utratą puli.

### Dowód

`supabase/tests/expert_tenant_scope_notifications_test.sql` - 34 asercje, w tym
pełna macierz „status w A ≠ status w B" dla wszystkich źródeł, wariant 1-arg
pytany z obcego kontekstu, `NULL` tenant, ACL oraz bramka strukturalna na
ciałach czterech konsumentów.

---

## 2. Eksport RODO deklarował komplet, pomijał czat i wszystkie rozszerzenia profilu

### Stan zastany

`exportMyData` miał 17 sekcji i podpisywał się jako komplet - w komentarzu
(„zwraca komplet danych") oraz w podtytule na `/profile/security`. Pomijał:

- **cały czat** - rozmowy, uczestnictwo, własne wiadomości, przezwiska, blokady,
- **cały moduł zapytań do ekspertów** - obie skrzynki,
- **komplet rozszerzeń profilu** - profil autora (z PII odciętym grantem
  kolumnowym), doświadczenie, wykształcenie, umiejętności, wyróżnienia,
  zainteresowania, pliki CV, wzmianki medialne,
- **reputację zawodową** - rekomendacje (otrzymane i napisane), poparcia
  umiejętności, wyświetlenia profilu, wprowadzenia,
- skrzynkę powiadomień i wysłane zaproszenia.

Osoba, której dane dotyczą, dostawała plik podpisany jako komplet i nie miała
jak zauważyć, czego w nim nie ma.

### Wdrożenie

Poprawka jest **strukturalna, nie redakcyjna**:

- `src/lib/profile/exportManifest.ts` - czysty moduł: rejestr sekcji pogrupowany
  dziedzinowo (`identity`, `profile_extensions`, `activity`, `network`, `chat`,
  `expert_requests`, `commerce`, `preferences`), świadome wyłączenia z
  uzasadnieniem PL/EN oraz funkcje `buildExportManifest` / `diffExportManifest`.
- `src/lib/profile/export.functions.ts` - **44 sekcje** (było 17), format
  podbity do `nes.personal-data-export.v2`. Payload niesie **własny manifest**:
  co miało być, co w tym przebiegu poległo (`manifest.failed`, spójne z sekcją
  `errors`) i czego świadomie nie ma.
- Wyłączenia są nazwane w pliku razem z podstawą prawną - m.in. wiadomości
  napisane przez rozmówców (art. 15 ust. 4 RODO), treść binarna załączników
  (metadane i ścieżki są), zdarzenia analityczne bez identyfikatora konta
  (art. 4 pkt 1), logi bezpieczeństwa (art. 17 ust. 3 lit. e).
- Profil autora idzie przez `get_own_author_profile()`, a nie przez tabelę -
  inaczej eksport oddawałby użytkownikowi mniej, niż o nim trzymamy (telefon i
  kontakt medialny są odcięte grantem kolumnowym).
- Podtytuł na `/profile/security` opisuje realny zakres i mówi wprost, że plik
  niesie manifest (PL/EN).

### Dowód

`src/lib/profile/__tests__/exportManifest.test.ts` - bramka rozjazdu
**rejestr ⇄ server fn** (klucze literału `sections` muszą być identyczne z
rejestrem), lista sekcji wcześniej pomijanych wypisana wprost jako regresja,
kontrola braku `select("*")` poza wierszem preferencji, kompletność uzasadnień
wyłączeń w obu językach.

---

## 3. Brak powiadomień o zapytaniach do ekspertów

### Stan zastany

Moduł „Zapytanie do eksperta" nie miał **ani jednego** producenta powiadomień:

- ekspert dowiadywał się o zapytaniu tylko wtedy, gdy sam wszedł na
  `/messages?view=requests` albo `/profile/expert-requests` - a zakładka
  „Zapytania" w `/messages` jest **ukryta**, dopóki lista nie zwróci wiersza,
  więc pierwsze w życiu zapytanie było praktycznie niewidoczne;
- nadawca (płacący progiem Plus/Pro z policzalnej puli miesięcznej) nie dostawał
  sygnału o przyjęciu, odpowiedzi ani odrzuceniu.

Formalny kanał kontaktu z ekspertem był kanałem bez doręczenia.

### Wdrożenie - `20260806161000_expert_request_notifications.sql`

1. **Nowy rodzaj `expert_request`** jako pełnoprawny obywatel katalogu: kolumna
   `notification_preferences.enabled_expert_request`, wpis w
   `notifications_kind_check`, gałąź w `CASE` producenta `enqueue_notification`.
   Odpowiednik po stronie klienta w `src/lib/notifications/preferences.ts`
   (typ, domyślne, lista przełączalnych) plus etykiety PL/EN i ikona zapasowa
   w dzwonku.
2. **Trigger `tg_expert_request_notify`** (SECURITY DEFINER, bo
   `enqueue_notification` nie ma grantu dla ról klienckich):
   `INSERT` → odbiorca; `UPDATE OF status` → nadawca (przyjęte / odpowiedziane /
   odrzucone, z powodem eksperta w treści) albo odbiorca (wycofane przez
   nadawcę). Reakcja wyłącznie na **realną** zmianę statusu.
3. **`href` niesie identyfikator zapytania i fragment statusu.** To nie ozdoba:
   producent deduplikuje po `(user, kind, href)` w oknie 5 minut, a jeden wątek
   potrafi w tym oknie zmienić status dwa razy (`approved → answered`,
   `wysłane → wycofane`). Bez rozróżnienia drugie zdarzenie przepadałoby po
   cichu. Fragment nie trafia do zapytania HTTP, więc kontrakt parametrów
   pozostaje nienaruszony.
4. **Głęboki link działa.** Trasa `/profile/expert-requests` dostała
   `validateSearch` (`?box=received|sent&r=<uuid>`, walidator w czystym module
   `src/lib/chat/expertRequestsSearch.ts`), wybór zakładki z adresu oraz
   wyróżnienie i przewinięcie do wskazanego zapytania.

Doręczenie jest najlepszym staraniem: całość trigger-a jest w `EXCEPTION`, bo
brak powiadomienia jest gorszy niż brak powiadomienia **plus** utrata zapytania.

---

## 4. Pokrycie modułu 15,4% - `src/lib/network` i `src/components/profile` na 0%

| powierzchnia                | przed | po                                                       |
| --------------------------- | ----- | -------------------------------------------------------- |
| `src/lib/network/**`        | 0%    | **89,7% instrukcji · 70,8% gałęzi · 100% funkcji/linii** |
| `src/components/profile/**` | 0%    | **26,2% instrukcji · 27,3% gałęzi · 27,1% funkcji**      |

Nowe pliki testowe (11 plików, 194 testy):

- `src/lib/network/__tests__/networkKeys.test.ts` - izolacja kont w kluczach
  cache (dwa konta nigdy nie dzielą wpisu; brak sesji degraduje do jawnego
  `anon`; kolejność identyfikatorów nie tworzy nowego wpisu).
- `src/lib/network/__tests__/useConnections.test.tsx` - kontrakt RPC, odsiew
  statusu spoza słownika, stronicowanie, zakres unieważnień po mutacji oraz
  nasłuch **sygnałów pośrednich** (tabela `user_connections` świadomie nie jest
  w publikacji Realtime, więc łatwo to zepsuć niezauważenie).
- `src/lib/network/__tests__/networkProfileHooks.test.tsx` - poparcia
  (optymistyczne liczniki + rollback), wprowadzenia (granice wiadomości przed
  RPC), wyświetlenia profilu (normalizacja trybu widoczności), rekomendacje
  (mapowanie wiersza, słownik czasowników).
- `src/components/profile/__tests__/` - atomy edycji „w miejscu", etykieta pola,
  odznaki, bramka sesji, nawigacja profilu, podgląd mediów, sekcje CV,
  obecność w mediach.
- `src/lib/chat/__tests__/expertRequestsSearch.test.ts` - kontrakt adresu
  skrzynki zapytań.

Progi per-ścieżka w `vitest.config.ts` (zapora przed powrotem do zera):
`src/lib/network/**`, `src/lib/profile/exportManifest.ts` (100%),
`src/components/profile/**`.

### Znaleziska wyprodukowane przez pisanie tych testów

Testy nie były formalnością - wypchnęły cztery realne poprawki:

1. **Klucz cache rekomendacji nie niósł oglądającego.** Ta sama lista wygląda
   inaczej zależnie od pytającego (autor widzi swoje `hidden`/`declined` jako
   `pending` - prywatność moderacji), więc jeden wpis w cache obsługiwał dwie
   różne odpowiedzi. Klucz uzupełniony o id oglądającego, zgodnie z regułą
   `networkKeys`.
2. **Atomy edycji „w miejscu" zostawiały wiszące odrzucenie.** `commit()` jest
   odpalany z `void` (klawiatura, blur), więc wyjątek z `onSave` wypływał jako
   `unhandledrejection` do globalnego przechwytywania błędów i raportował
   nieudany zapis pola jako awarię platformy.
3. **Etykiety formularzy bez powiązania z polami** (`MiniField`/`MiniArea` w
   sekcjach CV oraz komplet pól „Obecności w mediach"): czytnik ekranu czytał
   „pole edycji" bez nazwy, a kliknięcie w etykietę nie ustawiało fokusu.
   Naprawione przez `useId()` + `htmlFor`/`id`.
4. **Dedup powiadomień zjadałby drugie zdarzenie w wątku** - patrz sekcja 3,
   punkt 3 (wykryte przy pisaniu asercji cyklu życia).

---

## Weryfikacja

```bash
bun run test                      # 6842 testy zielone
bun run check:sql-tenant-scope    # 559 funkcji, inwariant OK
bun run check:sql-app-role        # 890 literałów, inwariant OK
bun run check:sql-anon-insert     # 518 polityk, inwariant OK
bun run check:sql-migration-replay
bun run check:sql-owner-tenant-scope
bun run generate:authz-snapshot   # snapshot bramek odświeżony po zmianie ciał
supabase test db                  # pgTAP, w tym nowy plik (34 asercje)
```

Migracje zweryfikowano dodatkowo funkcjonalnie na czystym Postgresie 16
(predykaty zwracają `false` poza obszarem statusu; trigger doręcza komplet
powiadomień cyklu życia, także dwa zdarzenia w tym samym oknie dedupu).
