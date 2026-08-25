# Front wydarzeń, skaner on-site, katalog giełdy i poczta zgłoszeń

Data: 2026-08-25 · Status: **wdrożone** · Gałąź: `claude/event-page-scanner-gaps-b14pec`

Dokument opisuje, co powstało, na czym stoi i czego świadomie NIE zrobiono.
Uzasadnienia decyzji żyją w nagłówkach plików - tutaj jest mapa i te rzeczy,
których nie da się zapisać w jednym pliku, bo dotyczą kilku naraz.

---

## 0. Znalezisko, które zmienia sposób czytania reszty

**Strona wydarzenia była nieosiągalna z przeglądarki.** Nie „niedokończona" -
nieosiągalna. `src/routes/events.tsx` rysowało listę wydarzeń i miało dzieci
(`events.$slug`, `events.$slug_.register`), a w TanStack Router `Match`
renderuje ALBO `component` rodzica, ALBO `<Outlet />`:

```js
const Comp = route.options.component ?? router.options.defaultComponent;
return Comp ? jsx(Comp) : jsx(Outlet);
```

Rodzic bez `<Outlet />` montuje się sam i na tym kończy. Każde wejście na
`/events/<slug>` pokazywało więc LISTĘ. Defekt nie zapalał żadnej bramki:
typy się zgadzały, generator drzewa był zadowolony, testy komponentów
przechodziły - bo komponent strony wydarzenia jest poprawny, tylko nikt go nie
montował.

Naprawa jest kanoniczna i taka sama jak w panelu (`admin.events.tsx` +
`admin.events.index.tsx`): `events.tsx` staje się UKŁADEM z `<Outlet />`,
a lista przenosi się do `events.index.tsx` (adres bez zmian).

Regresję zamyka bramka `src/routes/__tests__/parentRoutesRenderOutlet.gate.test.ts`.
Bramka znalazła **cztery kolejne trasy tej samej klasy**, spoza zakresu tej
zmiany - są zamrożone jako dług z listą konkretnych nieosiągalnych adresów:

| Rodzic bez `<Outlet />`          | Nieosiągalne adresy                                    |
| -------------------------------- | ------------------------------------------------------ |
| `src/routes/admin.organizations` | `/admin/organizations/$id`, `/admin/organizations/new` |
| `src/routes/admin.seo`           | `/admin/seo/search-console`                            |
| `src/routes/network`             | `/network/mutual/$userId`                              |
| `src/routes/qa`                  | `/qa/$slug`                                            |

Naprawa każdej jest mechaniczna (podział na układ + `index`), ale należy do
właścicieli tamtych modułów: doklejenie czterech osobnych regresji do zmiany
o wydarzeniach ukryłoby je w jednym przeglądzie.

---

## 1. Powierzchnia uczestnika (`/events/<slug>`)

### Warstwa czysta

| Moduł                           | Odpowiada za                                                                |
| ------------------------------- | --------------------------------------------------------------------------- |
| `lib/events/eventSections.ts`   | model `event_sections`: kolejność, nadpisane nagłówki, ZAMKI, `has_content` |
| `lib/events/agendaSurface.ts`   | model `event_agenda`: dni w strefie wydarzenia, nurty, kontrolka zapisu     |
| `lib/events/sponsorsSurface.ts` | model migawki partnerów: poziomy, rozmiary logotypów, materiały             |
| `lib/events/manageToken.ts`     | kształt i adres klucza samoobsługi zgłoszenia                               |

### Dostęp i hooki

`lib/events/publicEventApi.ts` (osiem RPC w jednym module - wspólny kontrakt
najemcy przez `public_tenant_id()`), `lib/events/publicEventErrors.ts`
(odmowa -> zdanie z następnym krokiem), `lib/events/usePublicEvent.ts`
(jedna fabryka kluczy; użytkownik JEST częścią klucza, bo `event_sections`
i `event_agenda` personalizują odpowiedź).

### Komponenty (atomic design)

```
components/events/public/
  atoms/      SessionStateBadge, SponsorLogo
  molecules/  SectionLockCard, EventBookmarkButton, AgendaSessionCard
  organisms/  EventAgendaSection, EventSponsorsSection, EventMaterialsSection,
              EventPageSections (orkiestrator sekcji), SavedEventsList
```

Sekcje rysuje `EventPageSections` W KOLEJNOŚCI Z BAZY i z zamkami z bazy -
dzięki temu przełączniki sekcji w panelu organizatora przestały być ozdobą.
Sekcja prelegentów ma własny nagłówek, więc jej zamek rozstrzyga trasa
(inaczej strona miałaby dwa nagłówki „Prelegenci").

### Nowe adresy

| Adres                           | Rola                                        |
| ------------------------------- | ------------------------------------------- |
| `/events/<slug>/manage?token=…` | samoobsługa zgłoszenia dla gościa BEZ konta |
| `/events/saved`                 | prywatna lista zapamiętanych wydarzeń       |

Strona `manage` NIGDY nie odwołuje udziału przy wejściu - skanery w klientach
pocztowych odwiedzają każdy adres z wiadomości, więc rezygnacja wymaga
drugiego, świadomego kliknięcia (ten sam wzorzec, co wypisanie z newslettera).

---

## 2. Skaner on-site (`/scanner`)

Instalowalna aplikacja (PWA) płaszczyzny URZĄDZENIA: nie loguje się jako
człowiek, tylko przedstawia się tokenem, z którego baza wyprowadza najemcę,
wydarzenie, zakresy i przypięty punkt kontrolny.

| Moduł                          | Odpowiada za                                                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `lib/events/scannerSession.ts` | poświadczenie, zakresy -> tryby, punkty, kierunki, termin ważności        |
| `lib/events/scannerOutbox.ts`  | kolejka skanów bez sieci: sklejanie leadów, wycofanie, limit prób         |
| `lib/events/scannerStorage.ts` | token w `localStorage`, kolejka w IndexedDB (z uczciwym stanem awaryjnym) |
| `lib/events/scannerApi.ts`     | pięć RPC bramki + lista leadów                                            |
| `lib/events/useScanner.ts`     | środowisko uruchomieniowe: sieć, kolejka, wysyłka szeregowa               |
| `hooks/useBarcodeScanner.ts`   | natywny `BarcodeDetector` - ZERO nowych zależności                        |
| `lib/events/onsiteEnums.ts`    | zamknięte słowniki modułu, wspólne z panelem                              |

### Trzy decyzje, które warto znać

1. **Czytnik ma trzy drogi**: aparat (`BarcodeDetector`, brak w Safari),
   czytnik sprzętowy „na klawiaturę" (zawsze działa - pole samo odzyskuje
   kursor) i ręczne wpisanie. Dekoder QR w JS ważyłby 60-200 kB w pakiecie,
   który ma wstać na telefonie przy słabym zasięgu.
2. **Offline TYLKO dla odprawy i leadów.** `event_checkin_record` przyjmuje
   `client_scan_uid`, więc ponowienie nie tworzy drugiej odprawy. Rejestr
   wydruków wstawia NOWY wiersz przy każdym wywołaniu i jest dokumentem
   rozliczenia z drukarnią - dlatego druk wymaga sieci i mówi o tym wprost.
3. **Parowanie kodem QR.** Panel pokazuje kod prowadzący do `/scanner?t=…`;
   trasa czyta token raz i natychmiast czyści go z paska adresu. Przepisanie
   32 znaków base64url z laptopa na telefon nie jest realistyczne.

Bramka `check:public-assets` przeszła z nowym katalogiem `public/scanner/`
i workerem `public/scanner-sw.js` (zasięg `/scanner`, osobny od `push-sw.js`).

---

## 3. Katalog uczestników giełdy spotkań

Brakujące ogniwo: `event_meeting_invite` chce `counterpart_registration_id`,
a płaszczyzna uczestnika nie miała skąd go wziąć - można było przełożyć
rozmowę z kimś, kogo się już zna, i nie można było zacząć żadnej nowej.

Migracja `20260825200000_event_meeting_directory.sql` dodaje:

- `event_meeting_directory(jsonb)` - lista filtrowana **tą samą regułą**, co
  zaproszenie (`_event_meeting_can_invite`), więc każdy przycisk „Zaproś" na
  liście naprawdę działa;
- `_event_meeting_directory_scope(...)` - PIERWSZY konsument istniejących od
  dawna kolumn `event_groups.can_see_attendees` i `attendee_visibility`;
- `event_registrations.directory_opt_out` + `event_meeting_directory_visibility_set(jsonb)` -
  jedyne miejsce, w którym o obecności na liście decyduje CZŁOWIEK, a nie
  organizator.

Katalog nie oddaje ani jednego pola kontaktowego: adres i telefon należą do
ścieżki zgody partnerskiej (`event_lead_scans`), nie do listy uczestników.

UI: zakładka „Uczestnicy" w `MeetingExchangeBoard` + `ParticipantDirectoryPanel`

- `MeetingInviteDialog` (terminy liczy `event_meeting_free_slots`, nie ekran).

---

## 4. Poczta zgłoszeń i eksport listy uczestników

Cztery nowe typy maila transakcyjnego (`event_registration_received`,
`event_registration_approved`, `event_registration_rejected`,
`event_waitlist_promoted`) w `tx-copy.ts`, z wpisami w macierzy wykluczeń
(`suppressionPolicy.ts`, wymuszone przez `Record<TxEmailType, …>`) i w podglądzie
panelu (`tx-preview.server.ts`).

Dwie drogi wysyłki, bo są dwaj różni nadawcy:

| Ścieżka                               | Kto woła             | Uwierzytelnienie                               |
| ------------------------------------- | -------------------- | ---------------------------------------------- |
| `registrationSelfNotify.functions.ts` | uczestnik po zapisie | `manage_token` (ten sam sekret, co rezygnacja) |
| `registrationNotify.functions.ts`     | organizator w panelu | rola redakcyjna w RPC (`assert_editor_tenant`) |

Przycisk „powiadom o awansie" **wysyła**, a nie tylko odznacza: pieczęć
`waitlist_notified_at` stawia dopiero udana wysyłka. Decyzja (przyjęcie /
odmowa) wysyła mail od razu po zapisie, fail-soft.

Eksport CSV listy uczestników (`registrationsCsv.ts`) bierze **cały przekrój
filtra**, a nie widoczną stronę, i cytuje przez `lib/crm/csv` - jedyny wariant
w repo, który neutralizuje formuły arkusza w polach wpisanych przez uczestnika.

---

## 5. Dług i rzeczy do zrobienia po tej zmianie

1. **`src/routeTree.gen.ts` jest edytowany ręcznie.** Generator
   (`@tanstack/router-generator`) nie instaluje się w tym środowisku (pakiety
   `@lovable.dev/*` z prywatnego rejestru są niedostępne), więc drzewo zostało
   dopisane w formacie generatora, wpis po wpisie. **Pierwsze uruchomienie
   `vite dev` albo `vite build` przepisze ten plik** - i powinno dać ten sam
   wynik. Zweryfikować `git diff` po pierwszym buildzie.
2. **Typy Supabase dopisane ręcznie** dla trzech nowych funkcji i jednej
   kolumny (`directory_opt_out`). Przy najbliższej regeneracji
   (`supabase gen types typescript --linked`) wpisy powinny się pokryć.
3. **Cztery trasy bez `<Outlet />`** - patrz §0.
4. **Sekcja `materials`** jest domyślnie niewidoczna
   (`_event_default_sections()` daje jej `is_visible = false`); organizator
   musi ją włączyć, żeby materiały partnerów pojawiły się na stronie.
