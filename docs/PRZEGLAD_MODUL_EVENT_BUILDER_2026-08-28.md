# Event Builder — przegląd funkcjonalny i wyniki testów

Data: 2026-08-28 · Gałąź: `claude/event-builder-review-q8kjc9` · HEAD: `9997ac0`
Zakres: front publiczny, panel administracyjny, warstwa bazy, styki z pozostałymi modułami, testy.
Dokumenty odniesienia: `docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` (etapy E1–E7, ryzyka, dług),
`docs/MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md` (mapowanie ekran po ekranie).

---

## 0. Wniosek w trzech zdaniach

Moduł jest w dobrym stanie inżynierskim. **Wszystkie kryteria odbioru etapów E4–E7, które da się
sprawdzić w kodzie, są spełnione po stronie serwera** — kolizja czasowa sesji odrzucana pod blokadą
doradczą, „typ biletu nadaje grupę”, trzy ograniczenia `EXCLUDE` przeciw podwójnej rezerwacji,
deduplikacja powtórnego skanu, izolacja leadów partnera po `sponsor_id` i zgodzie. Ciężar problemów
przesunął się z poprawności na **domknięcie i pokrycie**: łańcuch zaproszeń na miejsca w pakiecie
urywa się na brakującej trasie, dziesięć funkcji RPC żyje w bazie bez wywołania z aplikacji, jedyna
bramka wykonująca SQL modułu nie jest podpięta do CI, a bramka pilnująca zdarzeń domenowych jest
zielona, bo jej wyrażenie regularne nie dopasowuje nazw używanych przez ten moduł.

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

| Kryterium                                                            | Gdzie egzekwowane                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E4** — kolizja czasowa sesji odrzucana serwerowo                   | `event_session_signup`: `pg_advisory_xact_lock` na parze (wydarzenie, użytkownik), porównanie `time_range && time_range` z flagą `allow_overlap`. Kolizja sali osobno, przez `EXCLUDE USING gist`.                                          |
| **E5** — typ biletu nadaje grupę                                     | `event_register`: `v_group_id := v_ticket.group_id`, z powrotem do grupy domyślnej gdy bilet jej nie niesie.                                                                                                                                |
| **E5** — walidacja formularza po stronie serwera                     | `event_register`: pola wymagane, zgody wymagane (`is_true`, nie „obecne”), regulaminy wymagane, limit 64 kB ładunku, wzorzec e-mail, okno sprzedaży biletu, ranga warstwy, kod dostępu po SHA-256, `rate_limit_hit` 12/10, blokada wiersza. |
| **E6** — brak podwójnej rezerwacji                                   | Trzy `EXCLUDE USING gist`: miejsce przy stole, uczestnik, okno dostępności. Reguły czasu i pojemności w `tg_event_meetings_validate`.                                                                                                       |
| **E7** — powtórny skan odrzucany                                     | `event_checkins`: `EXCLUDE USING gist` po (najemca, punkt, osoba, `dedupe_range`) z filtrem na `result = 'granted'` i kierunek.                                                                                                             |
| **E7** — partner widzi wyłącznie własne leady                        | `event_lead_scans_list` uwierzytelnia po `token_hash`, filtruje po `sponsor_id` urządzenia i **dodatkowo** zeruje pola osobowe bez `consent_partner_sharing_at`.                                                                            |
| **Ryzyko nr 3** — wyciek `join_url` / `recording_url` / `stream_url` | Granty na `public.events` są kolumnowe i wyliczają wyłącznie kolumny publiczne; kolumny dodane 26 sierpnia dopisano tym samym wzorcem. Żaden grant nie obejmuje kolumn linkowych.                                                           |
| Higiena warstwy bazy                                                 | 42/42 tabel z RLS. Domyślna odmowa + dostęp wyłącznie przez `SECURITY DEFINER`. **Każda** funkcja `SECURITY DEFINER` modułu ma `search_path`. Żadna `admin_event_*` nie ma `GRANT EXECUTE` dla `anon`.                                      |
| Poświadczenia                                                        | Token skanera i `manage_token`: 24 losowe bajty base64url (192 bity), w bazie wyłącznie SHA-256, odwołanie, wygaśnięcie, blokada po serii błędów, zakresy. Strona samoobsługi z `noindex, nofollow`.                                        |

---

## 4. Ustalenia

Każde sprawdzone w kodzie. Waga oddaje realną osiągalność scenariusza.

### Waga wysoka

**U-14 · Sześć zdarzeń domenowych modułu jest niewidocznych dla frontu — i dla bramki, która miała tego pilnować**

Baza emituje `event.registration.created.v1`, `.updated.v1`, `.decided.v1`, `.cancelled.v1`,
`.promoted.v1` i `.payment.v1`. Żadnego z tych sześciu nie ma w `DOMAIN_EVENT_TYPES` ani
w `eventInvalidationMap`. Bramka `src/lib/realtime/__tests__/domainEventCatalog.test.ts:12`,
napisana dokładnie po to, żeby to złapać, jest zielona — bo jej wyrażenie
`/'([a-z_]+\.[a-z_]+\.v\d+)'/` ma **dwa** człony przed `.vN`, a te nazwy mają trzy. To jedyne sześć
trzyczłonowych nazw w całym repozytorium (63 rodzaje zdarzeń łącznie), więc luka nie ujawniła się
w żadnym innym module.

Skutek jest dokładnie tym, przed którym ostrzega komentarz w nagłówku tej bramki:
`invalidationKeysFor()` (`eventInvalidationMap.ts:332`) nie znajduje reguły i zwraca `[]`, czyli
**cicho nie robi nic**. Administrator rozstrzyga zgłoszenie, uczestnik się zapisuje, ktoś awansuje
z listy rezerwowej — a otwarte w innym oknie listy zgłoszeń, liczniki miejsc i „moje zgłoszenia”
nie odświeżają się na żywo. Nie ma błędu, nie ma czerwonego testu.

Naprawa, w tej kolejności: poprawić wyrażenie na `/'([a-z_]+(?:\.[a-z_]+)+\.v\d+)'/` — bramka
natychmiast zczerwienieje i pokaże komplet braków; potem dopisać sześć wpisów do
`DOMAIN_EVENT_TYPES` i sześć reguł inwalidacji.

---

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

Waga jest niska, bo te ścieżki są zablokowane walidacją klienta (np. `isAnswered`
w `registrationSubmitDraft.ts:88–96` wymaga `value === "true"` dla zgody, więc
`missing_required_consents` jest osiągalne wyłącznie z pominięciem interfejsu). To luka w obronie
w głąb, nie defekt zwykłego przebiegu. Docelowo: test porównujący zbiór `RAISE EXCEPTION` funkcji
modułu ze zbiorem kluczy nakładek — dziś nic tego nie pilnuje.

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

Ułożona tak, żeby najpierw odzyskać sygnał, potem domknąć funkcje, na końcu dobudować pokrycie.

1. **Odblokować bramki.** `bun run format` i `bun run generate:authz-snapshot`, potem
   `bun run verify:static` w całości — dopiero wtedy widać, co mówią 24 bramki dziś nieuruchamiane.
   Dwa polecenia, dwa czerwone znikają. _(U-06, U-10)_
2. **Naprawić wyrażenie w bramce zdarzeń domenowych i dopisać sześć brakujących rodzajów.**
   Jednoznakowa poprawka regexu przywraca sygnał bramce zielonej bez powodu; sześć wpisów w katalogu
   przywraca odświeżanie na żywo najczęściej używanemu przebiegowi modułu. _(U-14)_
3. **Podpiąć harness wydarzeń do CI.** Jedna linia w `package.json`, jeden krok w `ci.yml`. 884
   asercje istnieją i przechodzą — dziś nikt ich nie uruchamia poza ręcznym wywołaniem. _(U-02)_
4. **Domknąć trasę zaproszenia.** Bez niej pakiety miejsc są funkcją, której nie da się użyć do końca,
   mimo że backend jest kompletny. _(U-01)_
5. **Rozstrzygnąć dziesięć osieroconych funkcji RPC.** Każda dostaje ekran albo migrację usuwającą.
   Przy okazji zapada decyzja, która z dwóch wycen zakupu zostaje. _(U-04, U-05)_
6. **Dopisać `50_onsite.sql` i `60_meetings.sql`.** Po kroku 3 mają gdzie się uruchamiać, a chronią to,
   co w tym module najdroższe do naprawienia po fakcie: dane osobowe leadów i integralność
   rezerwacji. _(U-03)_
7. **Sześć importów nakładki i 23 klucze błędów.** Tanie, a zdejmuje klasę usterek, których żadna
   bramka nie widzi. _(U-07, U-11)_
8. **Testy paneli, od tych, które zapisują.** Pięć paneli o największej liczbie pól. _(U-08)_
9. **Decyzje produktowe, nie kod:** `source: "event"` dla widgetów agendy i sponsorów oraz czy
   `event_capabilities()` powstaje, czy dług zostaje świadomie zamknięty. _(U-09, U-12)_
