# Swapcard Studio — inwentarz elementów interfejsu (pełny, ze zrzutów)

Data: 2026-08-23 · Status: **inwentarz wykonawczy** (co dokładnie jest na ekranie)
Źródło: ~70 zrzutów ekranu wydarzenia `european-strategies-congress`
Dokumenty powiązane:

- `PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` — architektura, model danych, etapy
- `MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md` — mapowanie na platformę + wnioski

## Po co ten dokument

Dziennik mapowania odpowiada na pytanie **„co to znaczy dla NES"**. Ten dokument
odpowiada na pytanie **„co dokładnie jest na ekranie"**: każde pole, etykieta,
przełącznik, kolumna tabeli, komunikat walidacji, limit znaków i wymóg obrazka.
Jest to lista kontrolna do implementacji i do porównań ofertowych — nie ma tu
interpretacji, są dane.

## Konwencje zapisu

| Skrót      | Znaczenie                                               |
| ---------- | ------------------------------------------------------- |
| `txt`      | pole tekstowe jednoliniowe                              |
| `txt-i18n` | pole tekstowe z przełącznikiem języka (flaga)           |
| `area`     | pole wieloliniowe                                       |
| `rte`      | edytor sformatowany (bogaty tekst)                      |
| `sel`      | lista rozwijana (jeden wybór)                           |
| `multi`    | lista wielokrotnego wyboru / checkboxy                  |
| `radio`    | grupa radiowa (jeden z kilku)                           |
| `sw`       | przełącznik dwustanowy (toggle)                         |
| `chk`      | pole wyboru (checkbox)                                  |
| `num`      | pole liczbowe (ze strzałkami)                           |
| `date`     | data / data z godziną                                   |
| `time`     | godzina                                                 |
| `file`     | wgranie pliku / obrazu                                  |
| `btn`      | przycisk                                                |
| `lnk`      | odnośnik tekstowy                                       |
| `tbl`      | tabela                                                  |
| `badge`    | plakietka statusu                                       |
| `ro`       | pole tylko do odczytu (np. identyfikator z kopiowaniem) |
| 💎         | funkcja płatna u Swapcarda (`Add-on`)                   |

Etykiety podaję **dosłownie po angielsku** (tak jak w panelu), treści danych
wydarzenia po polsku (tak jak wprowadziła redakcja).

---

## 0. Chrome aplikacji (wspólne dla wszystkich ekranów)

### 0.1 Górny pasek

| Element                  | Typ              | Treść / stan                                                                  |
| ------------------------ | ---------------- | ----------------------------------------------------------------------------- |
| logo produktu + `Studio` | `lnk`            | powrót do listy wydarzeń                                                      |
| przełącznik planu        | `sel`            | `Free Trial` (z ikoną)                                                        |
| podgląd                  | `btn`            | `Preview event` (ikona ▷); na ekranie formularza zmienia się w `Preview form` |
| publikacja               | `btn`            | `Publish event` (kontur zielony)                                              |
| konto                    | `avatar` + `sel` | menu użytkownika                                                              |

### 0.2 Lewy sidebar — dwa poziomy

**Poziom społeczności** (ekrany `Event builder`): `Open event` (link),
wyszukiwarka `Search within the event…`, pozycje menu.

**Poziom wydarzenia** (pozostałe ekrany): `< Back to the community`, nazwa
wydarzenia (`European Strategies Congress`), data (`November 26th 2025, 9:00 am`),
`Open event`, wyszukiwarka, pozycje menu.

Pełna lista pozycji z podpozycjami:

| Pozycja                         | Podpozycje                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Overview`                      | —                                                                                                                         |
| `Event builder`                 | `General information` · `Pages & menu` (`New`) · `Groups & permissions` · `Branding` · `Sponsors & advertising` · `Terms` |
| `In-App registration`           | `Registration settings` · `Tickets` · `Codes` · `Form`                                                                    |
| `Content`                       | `People` · `Sessions` · `Exhibitors` · `Items` · `Documents & Links` · `Feed channels` · `Discussions`                    |
| `Exhibitor Marketplace` (`New`) | —                                                                                                                         |
| `Meetings`                      | `All meetings` · `Slots` · `Locations` · `Request rules` · `Hosted buyer & Smart Meetings` (`New`)                        |
| `Communications`                | `Emails` · `Notifications`                                                                                                |
| `Onsite`                        | `Lead generation` 💎 · `Badge templates` · `Session scanning` 💎 · `Checkpoints` 💎 · `Self check-in` 💎                  |
| `Integrations`                  | —                                                                                                                         |
| `Analytics`                     | `Dashboard` · `Reports`                                                                                                   |
| `Add-on features`               | — (ikona diamentu, kolor wyróżniony)                                                                                      |
| `Help`                          | —                                                                                                                         |

### 0.3 Wzorce powtarzalne

| Wzorzec                                 | Gdzie występuje                            | Opis                                                                              |
| --------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `Learn how ›`                           | prawie każdy ekran                         | odnośnik do pomocy, plakietka z ikoną                                             |
| pasek zapisu                            | Branding, edytory                          | `Reset to community branding` · `Discard changes` · `Save` (nieaktywny bez zmian) |
| `Internal ID` / `Event ID` / `Email ID` | wydarzenie, sesja, dokument, e-mail, grupa | `ro` + przycisk kopiowania, wartość base64                                        |
| paginacja tabeli                        | wszystkie listy                            | `Nb / page` (`sel`, domyślnie `10`) · `Page` (`sel`) · `1 – N of M` · strzałki    |
| filtr w nagłówku kolumny                | tabele                                     | ikona lejka przy nazwie kolumny                                                   |
| sortowanie kolumny                      | tabele                                     | ikona strzałek A↕Z                                                                |
| zaznaczanie wierszy                     | tabele                                     | `chk` w nagłówku i w wierszach                                                    |
| plakietka `Add-on` 💎                   | funkcje płatne                             | żółta plakietka + `Get feature`                                                   |
| stan pusty z instrukcją                 | listy                                      | zdanie „co zrobić" + `btn` akcji                                                  |
| licznik w przycisku akcji masowej       | generatory                                 | `Create 40 slots`, `Create 1 location`                                            |
| „…" menu wiersza                        | tabele                                     | akcje kontekstowe                                                                 |
| ikona kolejności (drag)                 | listy sekcji                               | uchwyt przeciągania                                                               |

---

## 1. Event builder → General information (`/details`)

### 1.1 Sekcja `Basics`

| Element | Typ                  | Etykieta / treść | Wartość / stan                                                | Pomoc / walidacja                                |
| ------- | -------------------- | ---------------- | ------------------------------------------------------------- | ------------------------------------------------ |
| nazwa   | `txt-i18n`           | `* Event name`   | `European Strategies Congress`                                | flaga języka po prawej                           |
| —       | tekst                | —                | —                                                             | „An event cannot exceed 90 days." + `Click here` |
| URL     | `txt` + ikona ołówka | `Event URL`      | `https://app.swapcard.com/event/european-strategies-congress` | edycja slugu po kliknięciu ołówka                |
| start   | `date`               | `* Begins`       | `11/26/2025, 09:00 AM`                                        | —                                                |
| koniec  | `date`               | `* Ends`         | `11/27/2025, 07:00 PM`                                        | —                                                |
| strefa  | `sel`                | `* Time zone`    | `Europe/Warsaw`                                               | —                                                |

### 1.2 Sekcja `Cover`

| Element    | Typ              | Etykieta                  | Wartość / stan                         | Pomoc                                                                                                                                          |
| ---------- | ---------------- | ------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| okładka    | `file` + podgląd | `Event image` (ikona „i") | miniatura „Geopolityczna Gra Mocarstw" | „You can also use a video header that will replace the image banner… However, the image will still be required and used for thumbnails views." |
| kadrowanie | `btn`            | `Crop`                    | —                                      | —                                                                                                                                              |
| usunięcie  | `btn`            | `Delete`                  | —                                      | —                                                                                                                                              |

### 1.3 Sekcja `Video header`

| Element       | Typ   | Etykieta               | Wartość                                        |
| ------------- | ----- | ---------------------- | ---------------------------------------------- |
| platforma     | `sel` | `Streaming platform`   | `YouTube`                                      |
| identyfikator | `txt` | `Video ID` (ikona „i") | placeholder `https://www.youtube.com/watch?v=` |

### 1.4 Sekcja `Format`

| Element | Typ                         | Opcje                              | Stan             | Pomoc                                                                                                                                                   |
| ------- | --------------------------- | ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| format  | `radio` (3 kafle z ikonami) | `Hybrid` · `In-person` · `Virtual` | `Hybrid` wybrany | „By default, virtual event formats will display all dates according to the participant's time zone. However, users can display the dates as they wish." |

### 1.5 Sekcja `Location`

| Element | Typ   | Etykieta                        | Wartość                                        |
| ------- | ----- | ------------------------------- | ---------------------------------------------- |
| miejsce | `txt` | (bez etykiety, pierwszy wiersz) | `Warszawa`                                     |
| adres   | `txt` | `Street address`                | puste (placeholder `Street address`)           |
| miasto  | `txt` | `City`                          | `Warszawa`                                     |
| region  | `txt` | `State`                         | `Mazowieckie`                                  |
| kod     | `txt` | `ZIP Code`                      | `03`                                           |
| kraj    | `txt` | `Country`                       | `Polska`                                       |
| reset   | `lnk` | `Reset location`                | —                                              |
| —       | tekst | —                               | „Let your participants know where to show up." |

### 1.6 Sekcja `Information`

| Element | Typ                  | Pasek narzędzi                                             | Treść                                              |
| ------- | -------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| opis    | `rte` + flaga języka | **B** · **U** · lista punktowana · lista numerowana · link | treść polska o kongresie (akapity z pogrubieniami) |

### 1.7 Pozostałe pola ekranu

| Element         | Typ               | Etykieta                             | Wartość / opcje                                                    | Pomoc                                                                                                                                                      |
| --------------- | ----------------- | ------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hashtag         | `txt`             | `X (ex-Twitter) hashtag` (ikona „i") | placeholder `# yourhashtag`                                        | —                                                                                                                                                          |
| języki          | `multi` (`chk`)   | `Languages`                          | `English` ✓; dalej: `Arabic`, `Bulgarian`, `Catalan`, `Chinese`, … | „Add other languages if you want to translate your content. **Important: changing the default language will clear all your email content modifications.**" |
| e-mail wsparcia | `txt`             | `Support email`                      | `office@neweuropeanstrategies.com`                                 | „Your audience will be redirected to this email for all non-platform related questions that usually come to our support team."                             |
| identyfikator   | `ro` + kopiowanie | `Event ID`                           | `RXZlbnRfMTM2MTg5NQ==`                                             | —                                                                                                                                                          |

---

## 2. Event builder → Pages & menu (`/content`)

| Element                | Typ                             | Etykieta / opcje                                                    | Stan                                         | Pomoc                                                                                                                                                                                 |
| ---------------------- | ------------------------------- | ------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| projekt strony głównej | `radio` (2 kafle)               | `Advanced` (ikona „i") · `Standard` (ikona „i")                     | `Standard` wybrany                           | `Advanced`: „Full control and a customizable design"; `Standard`: „Limited, fixed design and layout"                                                                                  |
| dostosowanie           | `btn`                           | `Customize page`                                                    | przy `Advanced`                              | —                                                                                                                                                                                     |
| tryb wyświetlania      | `radio` (2 kafle z miniaturami) | `Grid` · `List`                                                     | `List` wybrany                               | „Your pages are also displayed on the home page, you can choose here to displayed them as Grid or List."                                                                              |
| grupa menu             | `btn`                           | `Create menu group` (ikona folderu)                                 | —                                            | —                                                                                                                                                                                     |
| nowa strona            | `btn`                           | `Create page` (ikona dokumentu, zielony)                            | —                                            | —                                                                                                                                                                                     |
| zakładki listy         | `tabs`                          | `Menu pages` · `Other pages`                                        | `Menu pages` aktywna                         | —                                                                                                                                                                                     |
| lista stron            | lista z ikonami                 | `Uczestnicy` · `Prelegenci` · `Partnerzy` · `Agenda` (dalej ucięte) | każda z kolorową kwadratową ikoną            | —                                                                                                                                                                                     |
| onboarding             | widget                          | `Exhibitor Marketplace Checklist`                                   | `4 steps · About 17 minutes` + pasek postępu | —                                                                                                                                                                                     |
| —                      | tekst                           | nagłówek sekcji `Pages`                                             | —                                            | „Manage how your event content is displayed by creating pages and organizing them in your menu. For each page, customize the design, the visibility and the data where it redirects." |

---

## 3. Event builder → Groups & permissions (`/groups-and-permissions`)

### 3.1 Ekran główny

| Element              | Typ       | Treść                                                                                                                                                              | Stan                                                                                                                                                                                                                                                                                                                            |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lista grup           | lista     | `Exhibitors` (`People: 1 · Exhibitors: 4`) · `Speakers` (`People: 21`) · `Attendees` (`People: 1`)                                                                 | każda z ikoną ołówka (edycja) i ikoną suwaków (reguły)                                                                                                                                                                                                                                                                          |
| dodanie grupy        | `btn`     | `Add a group` (zielony)                                                                                                                                            | —                                                                                                                                                                                                                                                                                                                               |
| pomoc                | plakietka | `Learn how ›`                                                                                                                                                      | —                                                                                                                                                                                                                                                                                                                               |
| opis sekcji          | tekst     | „Segment your database to assign different rules (visibility, meetings, lead retrieval, etc.) or use it to target sent emails, notifications, and advertisements." | —                                                                                                                                                                                                                                                                                                                               |
| tryb gościa          | `sw`      | `Guest mode`                                                                                                                                                       | **włączony**                                                                                                                                                                                                                                                                                                                    |
| —                    | tekst     | —                                                                                                                                                                  | „Guest mode allows you to make your event publicly visible, offering a dedicated landing page that showcases key event details. This feature helps attract web visitors and encourages them to register. You can fully control which parts of your content are visible by adjusting your Pages settings and Guests visibility." |
| widoczność dla gości | `btn`     | `Manage visibility`                                                                                                                                                | —                                                                                                                                                                                                                                                                                                                               |
| —                    | tekst     | —                                                                                                                                                                  | „Manage the visibility of the event content by people who are not registered for the event or not logged in. Make sure that the content is accessible to them if you display it publicly on your website thanks to our widget."                                                                                                 |

### 3.2 Szuflada grupy `Exhibitors` — zakładka `General`

| Element              | Typ           | Etykieta                             | Wartość / stan                              | Pomoc                                                                                               |
| -------------------- | ------------- | ------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| nazwa                | `txt`         | `* Group name`                       | `Exhibitors` (wyszarzone — grupa systemowa) | —                                                                                                   |
| grupa nadrzędna      | `sel`         | `Community parent group` (ikona „i") | `Exhibitors · Community`                    | —                                                                                                   |
| nagłówek bloku       | tekst         | `Who and what they can see`          | —                                           | —                                                                                                   |
| karta `People`       | karta + `sel` | `People` (ikona „i") → `Groups`      | `All` (rozwijalne)                          | —                                                                                                   |
| widoczność wystawców | `sw` + `lnk`  | `Exhibitors` (ikona „i")             | **włączony** + `Add condition`              | —                                                                                                   |
| widoczność sesji     | `sw` + `lnk`  | `Sessions` (ikona „i")               | **włączony** + `Add condition`              | —                                                                                                   |
| widoczność items     | `sw` + `lnk`  | `Items` (ikona „i")                  | **włączony** + `Add condition`              | —                                                                                                   |
| czat przy stoisku 💎 | `btn`         | `Chat with exhibitors` + `Add-on`    | `Get feature`                               | „Add a live chat to exhibitors' virtual booths to let them communicate with visitors in real time." |
| identyfikator        | `txt`/`ro`    | `Internal ID`                        | (ucięte na zrzucie)                         | —                                                                                                   |

### 3.3 Szuflada grupy — zakładka `Exhibitor profile`

| Element                       | Typ   | Etykieta                                                                                                                                                                       | Stan                                                                                                                                       |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| nagłówek                      | tekst | `Company fields`                                                                                                                                                               | „Define here the fields that exhibitors can edit on their company profiles."                                                               |
| wyłącz wszystko               | `lnk` | `Disable all`                                                                                                                                                                  | —                                                                                                                                          |
| pola firmy (12 przełączników) | `sw`  | `Name` · `Logo` · `Header image` · `Video header` · `Advertising` · `Background image` · `Description` · `Address` · `Website` · `Email` · `Phone numbers` · `Social networks` | **wszystkie włączone**                                                                                                                     |
| dokumenty 💎                  | `btn` | `Documents & Links` + `Add-on`                                                                                                                                                 | `Get feature` — „Give exhibitors a way to include documents and links to outside resources on their company profile page."                 |
| items 💎                      | `btn` | `Items` + `Add-on`                                                                                                                                                             | `Get feature` — „Provide each exhibitor with a dedicated area where they can promote products, services, or anything at all to attendees." |

### 3.4 Szuflada grupy — zakładka `Lead generation`

| Element               | Typ   | Etykieta                                 | Stan          | Pomoc                                                                                                                                                                                                   |
| --------------------- | ----- | ---------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zbieranie leadów 💎   | `btn` | `Lead capture` + `Add-on`                | `Get feature` | „Use the app to scan participant badges for simple lead collection and sharing."                                                                                                                        |
| kwalifikacja 💎       | `btn` | `Lead qualification` + `Add-on`          | `Get feature` | „Add value to exhibitors' lead collection by giving them a way to qualify leads by criteria they define."                                                                                               |
| QR do profilu         | `sw`  | `Allow to download QR code`              | **wyłączony** | „When selected, exhibitors can download a QR code from Exhibitor Center that goes to their exhibitor profile page. Displaying this QR code on site drives more traffic and leads."                      |
| pulpity i eksporty 💎 | `btn` | `Lead dashboards and exports` + `Add-on` | `Get feature` | „Offer exhibitors comprehensive dashboards with AI recommended leads. Support lead assignments to members and enable data exports through Excel or seamless CRM synchronization via the Exhibitor API." |

### 3.5 Szuflada grupy — zakładka `Members`

| Element                    | Typ  | Etykieta                          | Stan          | Pomoc                                                                                                                                                   |
| -------------------------- | ---- | --------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dodawanie zarejestrowanych | `sw` | `Allow to add registered members` | **włączony**  | „…exhibitors in this group can add colleagues to their team. **Only people already registered for the event can be added as members.**"                 |
| rejestrowanie nowych       | `sw` | `Allow to register members`       | **wyłączony** | „…exhibitors can share a registration link with their staff. Anyone who registers through the link is automatically assigned to the exhibitor's booth." |

---

## 4. Event builder → Branding (`/branding`)

| Element                          | Typ                                                                              | Etykieta                                   | Wartość / stan              | Pomoc                                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| motyw                            | `radio` (2 kafle z podglądem karty osoby „Jenny Wilson / Marketing Coordinator") | `Light` · `Dark` + plakietka `Beta`        | `Light` wybrany             | „Customize the look, feel and color of your event on mobile and web apps."                                                         |
| kolor nawigacji                  | `txt` (hex) + próbnik                                                            | `Navigation`                               | `# 01112F`                  | „Color of the menu (navigation bar)."                                                                                              |
| kolor akcji                      | `txt` (hex) + próbnik                                                            | `Main actions`                             | `# FA9346`                  | „Color of the major buttons. Tip: set the same color than »My event« button."                                                      |
| kolor tekstu                     | `txt` (hex) + próbnik                                                            | `Text`                                     | `# 01112F`                  | „Color of all written content."                                                                                                    |
| tło bloków                       | `txt` (hex) + próbnik                                                            | `Content blocks background (desktop only)` | `# FFFFFF`                  | —                                                                                                                                  |
| tło                              | `file`                                                                           | `Background`                               | (ucięte)                    | „Set your background color or select a background image. It will appear on all pages, **including the In-App registration form**." |
| powrót do brandingu społeczności | `lnk`                                                                            | `Reset to community branding`              | —                           | —                                                                                                                                  |
| odrzucenie zmian                 | `btn`                                                                            | `Discard changes`                          | —                           | —                                                                                                                                  |
| zapis                            | `btn`                                                                            | `Save`                                     | **nieaktywny** (brak zmian) | —                                                                                                                                  |
| podgląd                          | makieta + paginacja                                                              | —                                          | wskaźnik `1 / 4`            | makieta układu strony wydarzenia po prawej                                                                                         |

---

## 5. Event builder → Sponsors & advertising (`/sponsors-and-advertising`)

### 5.1 Sekcja `Sponsors`

| Element            | Typ        | Treść                                                                                                                                                                                                                                         |
| ------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis               | tekst      | „Improve sponsor visibility within the platform. Sponsors and ads are great ways to monetize."                                                                                                                                                |
| nowa sekcja        | `btn`      | `Create a sponsor section`                                                                                                                                                                                                                    |
| sekcje sponsorskie | lista kart | `Premium Partner` (2 logo: Security Shield, Ship Tech) · `Silver Partner` (3: Globekey, Cyber Tech, Goshieldex) · `Bronze Partner` (5: Warner & Spencer, GlobeWork, Lion King, Conikos, Pandaros) · `Partners` (2: Starrioc, Historic Castle) |
| akcje sekcji       | ikony      | ołówek (edycja) · ikona kolejności                                                                                                                                                                                                            |

### 5.2 Sekcja `Event home ad`

| Element | Typ   | Treść                                                                                                                                                                                                                                                       |
| ------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis    | tekst | „If you add multiple ads that target the same group, they will display randomly. On web desktop, the image is displayed in a **vertical banner ad on the right side of the home page**. On mobile, the image appears as a **full screen interstitial ad**." |
| plan    | `btn` | `Upgrade plan`                                                                                                                                                                                                                                              |
| tabela  | `tbl` | kolumny: `Image` · `Targeted groups` · `Number of views` · `Number of clicks`                                                                                                                                                                               |
| wiersz  | dane  | kreacja (plakat kongresu) · `Attendees, Speakers, Exhibitors, Guests` · `42` · `-`                                                                                                                                                                          |

### 5.3 Sekcja `Advanced banner ads` 💎

| Element    | Typ             | Treść                                                                        |
| ---------- | --------------- | ---------------------------------------------------------------------------- |
| opis       | tekst           | „Deliver more exposure and value to sponsors with additional in-app ads."    |
| akcja      | `btn`           | `Get feature`                                                                |
| stan pusty | makieta + tekst | „You haven't added any advanced banner yet" (makieta wielu formatów banerów) |

---

## 6. Event builder → Terms (`/terms`) — „Create a term"

| Element             | Typ                  | Etykieta                            | Wartość / opcje                                                              | Pomoc / walidacja                                                                                                                                                                                        |
| ------------------- | -------------------- | ----------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wskazówka           | tekst                | —                                   | —                                                                            | „For lengthy terms, it is recommended that you use a short description and provide an external link."                                                                                                    |
| etykieta wewnętrzna | `txt`                | `* Label` + `(Only visible to you)` | placeholder `Enter a term label (only visible to you)`                       | —                                                                                                                                                                                                        |
| treść               | `rte` + flaga języka | `* Term description`                | placeholder `Enter a short description`                                      | pasek: **B** · **U** · lista punktowana · lista numerowana · link                                                                                                                                        |
| gdzie pokazać       | `radio`              | `Where to display`                  | `Only on event access` (wybrany) · `On in-app registration and event access` | 1. „Your term will appear once your attendees access the event." 2. „Your term is displayed on the first page of the registration form, and also at the event access if consent has not yet been given." |
| wymagalność         | `sw`                 | `Make this term required`           | **wyłączony**                                                                | —                                                                                                                                                                                                        |
| zapis               | `btn`                | `Create a term`                     | **nieaktywny** do wypełnienia pól                                            | —                                                                                                                                                                                                        |

---

## 7. In-App registration → Registration settings (`/registration-mode`)

| Element               | Typ               | Etykieta / opcje                                                    | Stan                                                                             | Pomoc                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ----------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tryb rejestracji      | `radio` (3 kafle) | `In-App registration` · `External registration` · `No registration` | `In-App registration` wybrany                                                    | 1. „Create your tickets, form, and badge templates directly in the Studio. You will also be able to use **Swapcard Go services** to manage access and badge printing on-site." 2. „You will need to provide your external registration link to which non-registrants will be redirected while interacting with the event in guest mode. Have a look to our `Integrations` or to our `Developer Portal` to connect your external registration tool." 3. „Invite people manually by adding them in the content section." |
| —                     | tekst + plakietka | —                                                                   | —                                                                                | „Select the registration mode for your event. Choose 'In-App registration' to take advantage of our registration features…" + `Learn how ›`                                                                                                                                                                                                                                                                                                                                                                            |
| adres rejestracji     | `ro` + kopiowanie | `Registration URL`                                                  | `https://app.swapcard.com/login/event/european-strategies-congress/registration` | „Use this link to redirect your audience to register."                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| przekierowanie gościa | `radio` (2 kafle) | `Guest mode redirection`: `In-App registration` · `External URL`    | `In-App registration` wybrany                                                    | „Define the registration path for guests browsing your event. Direct them to the Swapcard registration flow or a custom external URL."                                                                                                                                                                                                                                                                                                                                                                                 |
| widget rejestracji    | sekcja            | `Registration widget`                                               | —                                                                                | „Let your audience register directly on your own website with our embeddable widget."                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| — bilety w widgecie   | `sel`             | `Tickets`                                                           | `All tickets`                                                                    | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| — język widgetu       | `sel`             | `Language`                                                          | `Automatic (browser language)`                                                   | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| — kod HTML            | tekst + `lnk`     | „Copy and paste the HTML code into your website"                    | `Preview`                                                                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## 8. In-App registration → Tickets (`/registration/ticket-types`)

### 8.1 Lista biletów

| Element              | Typ               | Treść                                                                                                                                                          |
| -------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis                 | tekst             | „Use a single ticket type or multiple based on your event. Tickets can have a limited quantity, bounded by dates, and **assign your registrants to a group**." |
| ustawienia płatności | `lnk` (ikona „i") | `Payment settings`                                                                                                                                             |
| nowy bilet           | `btn`             | `Create a ticket` (zielony)                                                                                                                                    |
| tabela               | `tbl`             | kolumny: `Ticket name` · `Status` (filtr) · `Price` · `Uses` · `Valid from` · `Valid until` · `Group` (filtr) · `Visibility` (filtr) · ikona kolejności · `…`  |
| wiersz 1             | dane              | `Partner` · `● Ended` · `Free` · `0/Unlimited` · `Mar 26, 2025 9:00 AM` · `Mar 27, 2025 7:00 PM` · `Exhibitors` · 👁 `Visible`                                 |
| wiersz 2             | dane              | `Uczestnik` · `● Ended` · `Free` · `0/Unlimited` · j.w. · `Attendees` · `Visible`                                                                              |
| wiersz 3             | dane              | `Prelegent` · `● Ended` · `Free` · `0/Unlimited` · j.w. · `Speakers` · `Visible`                                                                               |

### 8.2 „Create a ticket" — sekcja `Basics`

| Element          | Typ               | Etykieta              | Wartość / opcje                | Pomoc / limit                                                                                                                                        |
| ---------------- | ----------------- | --------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| nazwa            | `txt-i18n`        | `* Ticket name`       | placeholder `Ticket name`      | flaga języka                                                                                                                                         |
| —                | tekst             | —                     | —                              | „Tickets will be available during the specified dates. **Hidden tickets can be accessed via a direct registration link or selected within Studio.**" |
| start sprzedaży  | `date`            | `* Start date`        | `08/23/2026, 12:00 AM`         | —                                                                                                                                                    |
| koniec sprzedaży | `date`            | `* End date`          | `09/23/2026, 12:00 AM`         | —                                                                                                                                                    |
| liczba           | `num`             | `Quantity`            | placeholder `No limit`         | strzałki góra/dół                                                                                                                                    |
| widoczność       | `radio` (2 kafle) | `* Ticket visibility` | `Visible` (wybrany) · `Hidden` | —                                                                                                                                                    |

### 8.3 „Create a ticket" — sekcja `Ticket type`

| Element        | Typ               | Etykieta                  | Wartość            | Pomoc / limit                                                                                    |
| -------------- | ----------------- | ------------------------- | ------------------ | ------------------------------------------------------------------------------------------------ |
| rodzaj         | `radio` (2 kafle) | `Free` (wybrany) · `Paid` | —                  | „Select if this ticket is free or paid. If free, you can customize the label."                   |
| pokaż etykietę | `sw`              | `Show label`              | **włączony**       | „When enabled, a label will be displayed to your registrants. When disabled, it will be hidden." |
| etykieta       | `txt-i18n`        | `Label`                   | placeholder `Free` | `0/40 characters`                                                                                |

### 8.4 „Create a ticket" — sekcja `Other settings`

| Element                | Typ           | Etykieta                            | Wartość                                                     | Pomoc / limit                                                                                                                              |
| ---------------------- | ------------- | ----------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| grupa                  | `sel`         | `* Assigned event group`            | placeholder `Select group`                                  | „Choose the group to which attendees purchasing this ticket will be assigned. Groups help manage permissions and communications."          |
| opis                   | `rte` + flaga | `Description (optional)`            | placeholder `Enter a short description for this ticket`     | `0/500 characters`                                                                                                                         |
| moderacja 💎           | `btn`         | `Moderated Registration` + `Add-on` | `Get feature`                                               | „Registrations with this ticket will stay in **pending** status until approved or rejected, giving you full control over attendee access." |
| rejestracja grupowa 💎 | `btn`         | `Group registration` + `Add-on`     | `Get feature`                                               | „Allow your attendees to purchase multiple tickets and register a group on their behalf."                                                  |
| podgląd                | karta         | `Ticket preview`                    | `Ticket name` / `Free` / `Available until wt., 22 wrz 2026` | „View how the ticket appears to registrants."                                                                                              |
| stopka                 | `btn`         | `Cancel` · `Create`                 | `Create` nieaktywny                                         | —                                                                                                                                          |

## 9. In-App registration → Codes (`/registration/promo-codes`)

| Element    | Typ        | Treść                                                                                                                                                                                                                                                                     |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst      | `Welcome to` **`Registration codes`**                                                                                                                                                                                                                                     |
| opis       | tekst      | „Create and manage codes for **discounts or event access**, boosting customer acquisition and engagement. Target specific segments with tailored discounts to enhance the purchasing experience and foster long-term loyalty."                                            |
| akcje      | `btn`      | `Create a code` (zielony) · `Learn more`                                                                                                                                                                                                                                  |
| instrukcja | 3 kroki    | **1 Create codes** („Easily generate discount or access codes with customizable options") · **2 Share your codes** („Distribute your codes with potential registrants") · **3 Monitor usage** („Track code redemptions and analyze their impact on sales and attendance") |
| grafika    | ilustracja | przykładowe kody: `MEMBERS28 −$10`, `EVENTVIP25 −20%`, `LINKEDINDAY −$15`                                                                                                                                                                                                 |

## 10. In-App registration → Form (`/registration/forms`)

### 10.1 Kanwa formularza

| Element           | Typ                               | Treść / stan                                                                                                                                                                                                                                                                |
| ----------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis              | tekst                             | „Build your registration form by adding pages and fields. **The First name, Last name, and Email cannot be modified.** The form background can be modified on the `branding page`." + `Learn how ›`                                                                         |
| widok             | `radio`                           | `Expand` (aktywny) · `Collapse`                                                                                                                                                                                                                                             |
| górny pasek       | `btn`                             | `Preview form` (zamiast `Preview event`) · `Publish event`                                                                                                                                                                                                                  |
| strona formularza | karta                             | tytuł `Event registration`                                                                                                                                                                                                                                                  |
| pola na kanwie    | podglądy pól                      | `* Email` · `* First name` · `* Last name` · `* Job title` · `* Company` · `* Mobile phone` (z wyborem kraju — flaga PL) · `Website` · `LinkedIn` (placeholder `Paste a valid url`) · `Profile picture`                                                                     |
| zdjęcie profilowe | `file` (kółko z „+")              | „Import a nice picture in **240x240px minimum** and **no larger than 1MB**."                                                                                                                                                                                                |
| nowa strona       | `btn`/`lnk`                       | `+ Add a new page`                                                                                                                                                                                                                                                          |
| ekran końcowy     | karta z ikoną ✓ i ołówkiem edycji | **„Thank you for registering"** / „We've sent you an email with a link that will connect you to the event once it's live." / kafel wydarzenia (okładka + `European Strategies Congress` + `Wed, Nov 26, 2025 9:00 AM - Thu, Nov 27, 2025 7:00 PM`) / `btn` `Open the event` |

### 10.2 Panel prawy `Add fields`

| Element         | Typ                       | Treść                                                                                                                                                                                             |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| instrukcja      | tekst + ikona             | „Drag and drop fields at the desired position on the form preview."                                                                                                                               |
| `Basic fields`  | lista pól (✓ = już użyte) | `First name` ✓ · `Last name` ✓ · `Email` ✓ · `Job title` ✓ · `Company` ✓ · `Biography` · `Mobile phone` ✓ · `Landline` · `Website` ✓ · `Address` · `Profile picture` ✓ · `Text block` (ikona „i") |
| `Custom fields` | lista                     | `LinkedIn` ✓ · `Type`                                                                                                                                                                             |
| nowe pole       | `btn`                     | `+ Create custom field`                                                                                                                                                                           |

---

## 11. Content → People (`/people`)

### 11.1 Lista osób

| Element             | Typ                    | Treść                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| opis                | tekst                  | „Easily manage attendees by adding, editing, or deleting profiles. Import attendee lists, assign groups, and control their visibility, ensuring efficient organization and streamlined attendee management." + `Learn how ›`                                                                                                                                                                                 |
| kafle KPI           | 4 kafle (z filtrami)   | `0 Registered` (filtr) · `0 Checked-in` · `0 Canceled` (filtr) · `0 Abandoned` + `Add-on` 💎                                                                                                                                                                                                                                                                                                                 |
| wyszukiwanie        | `txt`                  | placeholder `Search people`                                                                                                                                                                                                                                                                                                                                                                                  |
| ustawienia          | `lnk` (ikona koła)     | `People settings`                                                                                                                                                                                                                                                                                                                                                                                            |
| eksport             | `lnk` (ikona pobrania) | `Export`                                                                                                                                                                                                                                                                                                                                                                                                     |
| tworzenie           | `btn`                  | `Create people` (zielony)                                                                                                                                                                                                                                                                                                                                                                                    |
| tabela              | `tbl`                  | `chk` · `Onsite` (2 ikony statusu) · `Reg status` (filtr) · (filtr bez nazwy) · avatar · `First name` (sort) · `Last name` (sort) · `Emails` (filtr) · `Groups` (filtr) · `Job title` (sort) · `Company` · `Member of` · `Registered…`                                                                                                                                                                       |
| przykładowe wiersze | dane                   | Dorota Matuszak-Jasik · `No account` · `Speakers` · `dr` · New European Strategies · – · –                                                                                                                                                                                                                                                                                                                   |
|                     |                        | Igor Miasnikow · `office@neweuropeanstrategies.com` · `Attendees + 2 groups` · `CEO` · New European Strategies · `New European Strategies` · –                                                                                                                                                                                                                                                               |
|                     |                        | Jacek Bartosiak (`No account`, `Speakers`, `CEO`, Strategy & Future) · Jakub Wiśniewski (OECD, `Stały Przedstawiciel RP`) · Jakub Sawulski (PIE, `Główny ekonomista`) · Jarosław Grzywiński (NASK, `Prezes`) · Konrad Muzyka (Rochan Consulting) · Krzysztof Kalicki (Deutsche Bank w Polsce) · Lech Kurkliński (SGH, `Profesor`) · Ludwik Kotecki (Rada Polityki Pieniężnej, `Doradca Marszałka Senatu RP`) |
| paginacja           | —                      | `Nb / page 10` · `Page 1` · `1 - 10 of 21`                                                                                                                                                                                                                                                                                                                                                                   |

### 11.2 `People settings` → zakładka `Basic fields edition`

| Element                           | Typ                       | Etykieta                                                                                                                                                                                                                   | Stan                                                                                                                                                                                                                            |
| --------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| zakładki                          | `tabs`                    | `Custom fields` · `Basic fields edition` (aktywna)                                                                                                                                                                         | —                                                                                                                                                                                                                               |
| nagłówek                          | tekst                     | `People editable fields`                                                                                                                                                                                                   | „Define which information people can add or edit in their profile. **The settings are applied universally across all events within the community.**"                                                                            |
| włącz wszystko                    | `lnk`                     | `Enable all`                                                                                                                                                                                                               | —                                                                                                                                                                                                                               |
| pola (11 przełączników z ikonami) | `sw`                      | `Profile picture` **ON** · `First name` **OFF** · `Last name` **OFF** · `Job title` ON · `Company` ON · `Biography` ON · `Profile email` **OFF** · `Address` ON · `Phone numbers` ON · `Social networks` ON · `Website` ON | —                                                                                                                                                                                                                               |
| nota prawna                       | tekst w ramce (ikona „i") | —                                                                                                                                                                                                                          | „These fields may contain personal data, for which you, as organizer are the **data controller** and responsible as such for compliance with applicable rules, including **possibility for users to rectify** the information." |

### 11.3 Dialog `Create people` → `Create manually`

| Element      | Typ                | Etykieta                                             | Wartość / opcje                                                            | Pomoc                                                                                                                              |
| ------------ | ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| nawigacja    | strzałka `←` + `×` | —                                                    | powrót do wyboru metody / zamknięcie                                       | (druga metoda: import)                                                                                                             |
| grupa        | `sel`              | `* Group`                                            | placeholder `Select group`; opcje: `Exhibitors` · `Speakers` · `Attendees` | —                                                                                                                                  |
| e-mail konta | `txt`              | `* Primary account email (login and communications)` | placeholder j.w.                                                           | „Filling out this field will automatically populate their profile email with the same email address visible to their connections." |
| imię         | `txt`              | `* First name`                                       | placeholder `Add a first name`                                             | —                                                                                                                                  |
| nazwisko     | `txt`              | `* Last name`                                        | placeholder `Add a last name`                                              | —                                                                                                                                  |
| stanowisko   | `txt`              | `Job title`                                          | placeholder `Add a job title`                                              | —                                                                                                                                  |
| firma        | `txt`              | `Company`                                            | placeholder `Add a company`                                                | —                                                                                                                                  |
| zapis        | `btn`              | `Create people`                                      | nieaktywny do wypełnienia                                                  | —                                                                                                                                  |

---

## 12. Content → Sessions (`/plannings`)

### 12.1 Lista sesji

| Element                                       | Typ   | Treść                                                                                                                                                              |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| opis                                          | tekst | „Allow people to plan their schedule, save time and keep them informed on the latest updates." + `Learn how ›`                                                     |
| wyszukiwanie                                  | `txt` | `Search sessions`                                                                                                                                                  |
| ustawienia                                    | `lnk` | `Session settings`                                                                                                                                                 |
| eksport                                       | `lnk` | `Export`                                                                                                                                                           |
| tworzenie                                     | `btn` | `Create sessions` (zielony, **liczba mnoga**)                                                                                                                      |
| tabela                                        | `tbl` | `chk` · `Format` (filtr) · `Title` (sort) · `Description` · `Date` (sort) · `Type` · `Location` · `Topics` · `Speakers` (sort) · `Exhibitors` (sort) · `Attendees` |
| wiersze (6, wszystkie `In-person (no video)`) | dane  | `Uroczyste otwarcie konferencji…` 9:00–9:05 · Speakers 1 · Exhibitors 1 · Attendees –                                                                              |
|                                               |       | `Aktywność Polski w organizacjach…` 9:05–10:00 · 4 · 2 · 1                                                                                                         |
|                                               |       | `Bezpieczeństwo Europy – NATO czy budowa…` 10:00–11:45 · 4 · 1 · –                                                                                                 |
|                                               |       | `Innowacyjna bankowość, a gdzie przedsiębiorcy?` 12:00–13:45 · 4 · 1 · 1                                                                                           |
|                                               |       | `Przyszłość reguł fiskalnych w Unii…` 14:00–15:45 · 4 · 1 · 1                                                                                                      |
|                                               |       | `Mobilność wojskowa państw na wschodniej…` 16:00–17:45 · 4 · 3 · –                                                                                                 |
| paginacja                                     | —     | `1 - 6 of 6`                                                                                                                                                       |

### 12.2 Szczegóły sesji — zakładki

`Details` · `Format & video` · `Speakers (1)` · `Exhibitors (1)` · `Attendees` ·
`Sessions` · `Documents & Links` · `Preferences` (+ `‹ Back to sessions`)

### 12.3 Zakładka `Details` — sekcja `Basics`

| Element | Typ                                  | Etykieta         | Wartość                                                       | Pomoc                                                                                                         |
| ------- | ------------------------------------ | ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| obraz   | `file` + podgląd + kadrowanie + kosz | `Header picture` | okładka kongresu                                              | „Import a rectangular image (**16:9 ratio**), size of **1920x1080px** and **no larger than 1MB** is perfect." |
| nazwa   | `txt-i18n`                           | `* Session name` | `Uroczyste otwarcie konferencji "Geopolityczna Gra Mocarstw"` | —                                                                                                             |
| data    | `date`                               | `* Date`         | `Wed, Nov 27, 2024`                                           | —                                                                                                             |
| start   | `time`                               | `* Start time`   | `9:00:00 AM`                                                  | —                                                                                                             |
| koniec  | `time`                               | `* End time`     | `9:05:00 AM`                                                  | —                                                                                                             |

### 12.4 Zakładka `Details` — sekcja `Information` (pola własne)

| Element     | Typ           | Etykieta                       | Wartość                                    | Akcja                                                                                                                                                                                                                                         |
| ----------- | ------------- | ------------------------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —           | tekst         | —                              | —                                          | „Fill the custom fields you created in **Session Settings**. This allows you to define specific categories, filters or details about this session and give more information to your attendees when they navigate through the whole schedule." |
| typ         | `sel`         | `Type`                         | `None`                                     | `Edit field`                                                                                                                                                                                                                                  |
| lokalizacja | `sel`         | `Location`                     | `None`                                     | `Edit field`                                                                                                                                                                                                                                  |
| tematy      | `multi`       | `Topics`                       | placeholder `Select one or several values` | `Edit field`                                                                                                                                                                                                                                  |
| słownik     | `lnk`         | `Manage session custom fields` | —                                          | —                                                                                                                                                                                                                                             |
| opis        | `rte` + flaga | `Description`                  | pusty                                      | pasek: B · U · listy · link                                                                                                                                                                                                                   |

### 12.5 Zakładka `Details` — sekcja `Live interactions`

| Element           | Typ                | Etykieta                                                       | Wartość / stan                 | Pomoc / limit                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------ | -------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —                 | tekst              | —                                                              | —                              | „The Live interaction box enables participants to chat, ask questions to speakers, and respond to polls. Additionally, it integrates seamlessly with third-party tools such as **Slido, Sparkup, Validar, Captello, LiveVoice, and Interprefy**… Please note that **you can't have more than 5 features tabs enabled**." + `Learn how ›` |
| etykieta skrzynki | `txt-i18n`         | `Interaction box label`                                        | placeholder `Live interaction` | `0/30 characters maximum`                                                                                                                                                                                                                                                                                                                |
| czat              | `sw` + uchwyt drag | `Chat` — „Allow audience to send messages"                     | **włączony**                   | —                                                                                                                                                                                                                                                                                                                                        |
| pytania           | `sw` + uchwyt      | `Questions` — „Allow audience to ask and **upvote** questions" | **włączony**                   | —                                                                                                                                                                                                                                                                                                                                        |
| ankiety           | `sw` + uchwyt      | `Polls` — „Allow audience to answer polls and quizes"          | **włączony**                   | —                                                                                                                                                                                                                                                                                                                                        |
| integracja        | `btn`              | `+ Embed third-party service`                                  | —                              | —                                                                                                                                                                                                                                                                                                                                        |
| usunięcie         | `btn` (czerwony)   | `Remove live interactions`                                     | —                              | —                                                                                                                                                                                                                                                                                                                                        |

### 12.6 Zakładka `Details` — `Resources` i `IDs`

| Element         | Typ               | Etykieta               | Wartość                    | Pomoc                                                                                                                           |
| --------------- | ----------------- | ---------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| link istniejący | `sel`/`txt`       | `Add an existing link` | —                          | „Add redirecting links to your session. For example, to an interactivity tool, a feedback form, or any website of your choice." |
| nowy            | `lnk`             | `Or create new`        | —                          | —                                                                                                                               |
| identyfikator   | `ro` + kopiowanie | `Internal IDs`         | `UGxhbm5pbmdfMjAwNDQzMg==` | —                                                                                                                               |

### 12.7 Modal `Select format & video`

| Opcja                             | Ikona            | Opis                                                                                                                                 | Stan            |
| --------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `No video`                        | osoby            | „Create a simple session without video. Adapted to in-person events."                                                                | **wybrany** (✓) |
| `Swapcard Backstage`              | kamera           | „Use our live broadcasting studio, accessible in one click by the speakers, and in which you moderate who is on stage in real-time." | dostępny        |
| `RTMP stream from 3rd-party tool` | walizka          | „Connect with RTMP an external broadcast software like OBS, Zoom, or Restream, that will be stream on our player."                   | **wyszarzony**  |
| `Embedded video hosting platform` | ogniwo           | „Embed an external online video provider like YouTube, Vimeo or any other that provides iframe."                                     | dostępny        |
| `Video file`                      | plik wideo       | „Upload a video file that will be available on-demand or streamed as live at a scheduled time."                                      | dostępny        |
| `Roundtable`                      | karta osoby      | „Create a meeting room where your participants will be able to join."                                                                | dostępny        |
| —                                 | tekst na ekranie | „The format determines the purpose and usage of your session." + `Learn how ›`                                                       | —               |

### 12.8 Zakładka `Speakers (1)`

| Element    | Typ                       | Treść                                                                                                       |
| ---------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| opis       | tekst                     | „Link contributors to the session in order to highlight them on the app and let participants contact them." |
| role       | `btn` (ikona linku zewn.) | `Manage roles`                                                                                              |
| grupa roli | nagłówek karty            | `Wykładowcy`                                                                                                |
| osoba      | karta                     | avatar · `Igor Miasnikow` · `CEO` · `New European Strategies`                                               |
| dodanie    | `btn`/`lnk`               | `+ Add people`                                                                                              |

### 12.9 Zakładka `Exhibitors (1)`

| Element      | Typ   | Treść                                                            |
| ------------ | ----- | ---------------------------------------------------------------- |
| wyszukiwanie | `txt` | placeholder `Search among exhibitors to add them to the session` |
| firma        | karta | logo · `New European Strategies` · ikona ołówka · ikona kosza    |

### 12.10 Zakładka `Attendees`

| Element    | Typ         | Treść                                                                                                                                         |
| ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| dodanie    | `btn`/`lnk` | `+ Add one person` · `+ Add several at once`                                                                                                  |
| tabela     | `tbl`       | `chk` · `Email` · `Groups` · `First name` (sort) · `Last name` (sort) · `Job title` (sort) · `Company` · `Member of` · `Registered at` (sort) |
| stan pusty | tekst       | „Nobody is yet registered"                                                                                                                    |

### 12.11 Zakładka `Sessions` (powiązania)

| Element          | Typ   | Treść                                                     |
| ---------------- | ----- | --------------------------------------------------------- |
| nowe powiązanie  | `lnk` | `Create a new link`                                       |
| istniejąca sesja | `sel` | placeholder `Link an existing session` (nieaktywne/puste) |

### 12.12 Zakładka `Documents & Links`

| Element      | Typ   | Treść                |
| ------------ | ----- | -------------------- |
| wyszukiwanie | `txt` | placeholder `Search` |
| nowy         | `lnk` | `Or create new`      |

### 12.13 Zakładka `Preferences`

| Sekcja         | Element               | Typ   | Etykieta                                                     | Stan          | Pomoc                                                                                                                                                                                                    |
| -------------- | --------------------- | ----- | ------------------------------------------------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Registration` | zapis grup wydarzenia | `sw`  | `Allow all event members to register at event level`         | **ON**        | „When this option is enabled, all event groups to register or unregister for this session."                                                                                                              |
|                | limit miejsc          | `sw`  | `Limit the number of registrations`                          | **OFF**       | „When the option is enabled, you can define an attendee capacity limit. Attendees won't be able to register for the session once the limit has been reached."                                            |
|                | kolizje               | `sw`  | `Allow overlap`                                              | **ON**        | „When the option is **disabled**, participants will not be able to register for the session if they are already registered for another session at the same time **that also has this option disabled**." |
|                | zapis społeczności    | `sw`  | `Allow all community members to register at community level` | **ON**        | „When this option is enabled, all community members can register or unregister for this session."                                                                                                        |
| `Onsite`       | skanowanie 💎         | `btn` | `Onsite access tracking with SwapAccess` + `Add-on`          | `Get feature` | „Scan participant badges at the entrance and/or exit of sessions to record their attendance or to control access with `SwapAccess App`."                                                                 |
| `Visibility`   | sesja prywatna        | `sw`  | `Make the session private`                                   | **OFF**       | „…the session is visible only to the attendees who have registered for it."                                                                                                                              |
|                | ukrycie zapisanych    | `sw`  | `Hide registered people`                                     | **OFF**       | „…participants who have registered for the session are not visible to others."                                                                                                                           |
| `Engagement`   | ocena po sesji        | `sw`  | `Ask for feedback after the session`                         | **ON**        | „…people who registered for the session can provide a **private rating and comment**. Notifications that encourage registrants to provide feedback will be…" (ucięte)                                    |

---

## 13. Content → Exhibitors (`/exhibitors`)

### 13.1 Lista firm

| Element      | Typ   | Treść                                                                                                                                       |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| opis         | tekst | „Give your exhibitors more value and improve their ROI with dedicated Exhibitor Profiles and access to the Exhibitor Area." + `Learn how ›` |
| wyszukiwanie | `txt` | `Search`                                                                                                                                    |
| ustawienia   | `lnk` | `Exhibitor settings`                                                                                                                        |
| eksport      | `lnk` | `Export`                                                                                                                                    |
| tworzenie    | `btn` | `Create exhibitors`                                                                                                                         |
| tabela       | `tbl` | `chk` · `Logo` · `Name` (sort) · `Group` (filtr) · `Location` · `Type` · `Members` · `Created on` (sort) · `Description` (sort) · `Website` |
| wiersze (4)  | dane  | `Bank Pekao S.A.` · `Exhibitors` · 0 · `Friday, June 21, 2024 at 1:04 PM` · opis PL · –                                                     |
|              |       | `Forbes Polska` · `Exhibitors` · 0 · `1:08 PM` · opis PL · `https://www.forbes.pl`                                                          |
|              |       | `New European Strategies` · `Exhibitors` · **1** · `1:20 PM` · opis EN · `https://neweuropeanstrategies.com/`                               |
|              |       | `Parlament Europejski` · `Exhibitors` · 0 · `12:46 PM` · opis PL · `https://www.warsaw.europarl.eur…`                                       |
| paginacja    | —     | `1 - 4 of 4`                                                                                                                                |

### 13.2 `Exhibitor settings` — 4 zakładki

| Zakładka                           | Elementy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Custom fields`                    | opis: „Here you can manage the custom fields and main content of your event. This includes any of the information on pages that you will sort into sections. **Creating fields with single or multiple choice formats will allow you to create search filters.**" + `Learn how ›`; `txt` z ikoną lupy: `Add a custom field used in other events within this Community`; `sel` języka: `Polish` (z flagą); sekcja `Default custom fields` („Displayed on top of exhibitor details page") → pole `Type` (ikona radiowa); sekcja `Information` → `+ Create custom field` |
| `Export condition`                 | opis: „To exclude specific leads from the exports downloaded by exhibitors, add a condition such as a **custom field or a term consent**. This condition will be applied to all exhibitors of the event." + `Learn how`; `btn` `Add condition` (zielony)                                                                                                                                                                                                                                                                                                              |
| `Home message`                     | opis: „You can customize the home message of the **Exhibitor Center** here."; `rte` z paskiem: `Aa` · **B** · _I_ · U · lista punktowana · lista numerowana · `---` · link · obraz · plik + flaga języka; treść: nagłówek „Welcome to the Exhibitor Center" + wideo z ikoną głośnika                                                                                                                                                                                                                                                                                  |
| `Similar exhibitor recommendation` | `sw` `Display similar exhibitors - for the community` **ON** („…a list of similar exhibitors **generated by AI** is displayed on each Exhibitor page on your community"); `sw` `Display similar exhibitors - for this event` **ON** („…on each Exhibitor page")                                                                                                                                                                                                                                                                                                       |

### 13.3 Profil firmy (`Forbes Polska`) — zakładki

`Details` · `Contact details` · `Members` · `Documents & Links` · `Exhibitors` ·
`Permissions` + plakietka **`Events (1)`** przy nazwie + `‹ Back to exhibitors`

### 13.4 Zakładka `Details`

| Sekcja            | Element        | Typ                                  | Etykieta              | Wartość                                                                             | Pomoc                                                                                                                                                                                                                                                                                                                         |
| ----------------- | -------------- | ------------------------------------ | --------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `General`         | —              | tekst                                | —                     | —                                                                                   | „Add the booth name, a brief description, and the location to inform and engage participants."                                                                                                                                                                                                                                |
|                   | nazwa          | `txt-i18n`                           | `* Name`              | `Forbes Polska`                                                                     | —                                                                                                                                                                                                                                                                                                                             |
|                   | opis           | `rte` + flaga                        | `Description`         | tekst PL o Forbesie                                                                 | B · U · listy · link                                                                                                                                                                                                                                                                                                          |
|                   | lokalizacja    | `sel` + `lnk`                        | `Location`            | placeholder `Search or select an existing location`                                 | `Create new`                                                                                                                                                                                                                                                                                                                  |
| `Branding`        | —              | tekst                                | —                     | —                                                                                   | „Customize the virtual booth with a header, logo, and background image to showcase the brand and make a lasting impression."                                                                                                                                                                                                  |
|                   | obraz nagłówka | `file` + podgląd                     | `Header image`        | okładka „Lista 100 najbogatszych Polaków"                                           | „Add a header image or video on the exhibitor page. For image, we recommend using a **1200x675px (16:9 ratio)** image, **no larger than 1MB**. For video, it can be live or pre-recorded and hosted on YouTube, Vimeo or any other provider. Choose the provider and paste the ID or SRC link." + `lnk` `Use a video instead` |
|                   | logo           | `file` + podgląd + kadrowanie + kosz | (logo)                | logotyp `Forbes`                                                                    | —                                                                                                                                                                                                                                                                                                                             |
|                   | tło            | `file` (kafel z „+")                 | `Background image`    | puste                                                                               | „Import a **2560x1600px (16:10 ratio)** image, **no larger than 1MB**."                                                                                                                                                                                                                                                       |
| `Custom fields`   | typ            | `sel` + `lnk`                        | `Type`                | `None`                                                                              | `Edit field`; „Add new fields to collect specific information. Custom fields are crucial to boost **searchability and AI recommendations**."                                                                                                                                                                                  |
|                   | nowe pole      | `btn`                                | `Create custom field` | —                                                                                   | —                                                                                                                                                                                                                                                                                                                             |
| `Social networks` | 4 pola         | `txt` z ikonami                      | `Social networks`     | `linkedin.com/company/` · `x.com/forbespolska` · `instagram.com/` · `facebook.com/` | `lnk` `See all social networks`                                                                                                                                                                                                                                                                                               |
| `IDs`             | identyfikator  | `ro`                                 | `Internal IDs`        | (base64)                                                                            | —                                                                                                                                                                                                                                                                                                                             |

### 13.5 Zakładka `Contact details`

| Element             | Typ                  | Etykieta       | Wartość                                              | Pomoc                                                                                                                  |
| ------------------- | -------------------- | -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| —                   | tekst                | —              | —                                                    | „Attendees can view the exhibitor's contact details, but **in Guest mode and on widgets, only the country is shown**." |
| telefon             | `txt` + `sel` kraju  | `Mobile phone` | placeholder `Enter a mobile phone number` (flaga PL) | —                                                                                                                      |
| telefon stacjonarny | `txt` + `sel` kraju  | `Landline`     | placeholder `Enter a landline phone number`          | —                                                                                                                      |
| e-mail              | `txt`                | `Email`        | placeholder `Email`                                  | —                                                                                                                      |
| adres               | `txt` (lupa) + `lnk` | `Address`      | placeholder `Search for a venue or address`          | `Add manually`                                                                                                         |
| strona              | `txt`                | `Website`      | `https://www.forbes.pl`                              | —                                                                                                                      |

### 13.6 Zakładka `Members`

| Element | Typ          | Etykieta                                                             | Stan          | Pomoc                                                                                                                                                            |
| ------- | ------------ | -------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dodanie | `txt` (lupa) | placeholder `Add a member by searching among people with an account` | —             | —                                                                                                                                                                |
| role 💎 | `btn`        | `Members role` + `Add-on`                                            | `Get feature` | „By default, members are assigned the **'Admin'** role, granting them full access to the Exhibitor Center. Change their role to **'Limited'** for more control." |

### 13.7 Zakładka `Documents & Links` 💎

| Element | Typ   | Treść                                                                                                                                                      |
| ------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dodatek | `btn` | `Documents & Links` + `Add-on` → `Get feature`; „Give exhibitors a way to include documents and links to outside resources on their company profile page." |

### 13.8 Zakładka `Permissions`

| Sekcja              | Element         | Typ           | Etykieta / opcje                                                                                                                                                               | Stan             | Pomoc                                                                                                                                                   |
| ------------------- | --------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Groups`            | grupa           | `sel` + `lnk` | `Group` = `Exhibitors`; `Edit group's settings`                                                                                                                                | —                | „**By default the exhibitor has the permissions of the group it belongs to. By editing, it will apply a specific permission for the exhibitor.**"       |
| `Exhibitor profile` | pola firmy      | 12 × `sw`     | `Name` · `Logo` · `Header image` · `Video header` · `Advertising` · `Background image` · `Description` · `Address` · `Website` · `Email` · `Phone numbers` · `Social networks` | **wszystkie ON** | „Define which information exhibitors can add or edit in Exhibitor Center." / „Define the fields that the exhibitor can edit on their company profile."  |
|                     | dokumenty 💎    | `btn`         | `Documents & Links` + `Add-on`                                                                                                                                                 | `Get feature`    | —                                                                                                                                                       |
|                     | items 💎        | `btn`         | `Items` + `Add-on`                                                                                                                                                             | `Get feature`    | „Provide each exhibitor with a dedicated area where they can promote products, services, or anything at all to attendees."                              |
| `Lead generation`   | —               | tekst         | —                                                                                                                                                                              | —                | „Choose which lead generation capabilities exhibitors can use" + `Learn how ›`                                                                          |
|                     | zbieranie 💎    | `btn`         | `Lead capture` + `Add-on`                                                                                                                                                      | `Get feature`    | —                                                                                                                                                       |
|                     | kwalifikacja 💎 | `btn`         | `Lead qualification` + `Add-on`                                                                                                                                                | `Get feature`    | —                                                                                                                                                       |
|                     | QR              | `sw`          | `Allow to download QR code`                                                                                                                                                    | **OFF**          | —                                                                                                                                                       |
|                     | pulpity 💎      | `btn`         | `Lead dashboards and exports` + `Add-on`                                                                                                                                       | `Get feature`    | —                                                                                                                                                       |
| `Members`           | dodawanie       | `sw`          | `Allow to add registered members`                                                                                                                                              | **ON**           | „…the exhibitor can add members to their team from the Exhibitor Center. Only people already registered for the event can be added as members."         |
|                     | rejestrowanie   | `sw`          | `Allow to register members`                                                                                                                                                    | **OFF**          | „…exhibitors can share a registration link with their staff. Anyone who registers through the link is automatically assigned to the exhibitor's booth." |

---

## 14. Content → Items (`/products`) — „Create items"

| Element  | Typ                   | Treść                                                                                                                                                                                                                     |
| -------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis     | tekst                 | „Showcase any type of items (**Products, Projects, Job Offers**, etc.) that participants will be able to browse and **bookmark**. Your exhibitors will be able to import them from the Exhibitor Center." + `Learn how ›` |
| metoda 1 | karta (ikona Excela)  | **`Import via Excel file`** — „Download and update our pre-filled Excel template to add or edit items in bulk."                                                                                                           |
| metoda 2 | karta (ikona wgrania) | **`Import from another event in the Community`** — „Attach existing content from an event within the same community to this event."                                                                                       |
| metoda 3 | karta (ikona edycji)  | **`Create manually`** — „Add an item on the next screen."                                                                                                                                                                 |
| metoda 4 | karta (ikona koła)    | **`Item settings`** — „Create item types, subcategories and custom fields. Choose if a list of similar items generated by AI is displayed on each item page."                                                             |

## 15. Content → Documents & Links (`/documents`)

### 15.1 Lista

| Element      | Typ   | Treść                                                                                                 |
| ------------ | ----- | ----------------------------------------------------------------------------------------------------- |
| opis         | tekst | „Add any document for **sessions & exhibitors** and get all **download statistics**." + `Learn how ›` |
| wyszukiwanie | `txt` | `Search`                                                                                              |
| dodanie      | `btn` | `Add a document` (zielony)                                                                            |
| tabela       | `tbl` | `chk` · `Title of the document` · `Attached to` · `Description` · `Type` · `URL`                      |
| wiersze (2)  | dane  | `Spotkania Chatham House` · – · – · `Link` · `https://bit.ly/3V8srNS`                                 |
|              |       | `Konferencja Geopolityczna Gra Mocarstw` · – · – · `Link` · `https://bit.ly/4bIcXHr`                  |

### 15.2 Szczegóły dokumentu

| Element       | Typ               | Etykieta                      | Wartość                                                                      | Uwagi                                                      |
| ------------- | ----------------- | ----------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| adres         | `txt` + 3 ikony   | `* URL of the document`       | `https://bit.ly/3V8srNS`                                                     | ikony: podgląd (oko) · usuń (kosz) · wgraj plik (strzałka) |
| tytuł         | `txt`             | `* Title of the document`     | `Spotkania Chatham House`                                                    | —                                                          |
| opis          | `area`            | `Description of the document` | placeholder `Add a few words to describe the document (max. 160 characters)` | licznik/ikona zapisu                                       |
| identyfikator | `ro` + kopiowanie | `Internal ID`                 | `RG9jdW1lbnRfMjMxNzk3Mw==`                                                   | —                                                          |
| usunięcie     | `btn` (czerwony)  | `Delete`                      | —                                                                            | —                                                          |

## 16. Content → Feed channels (`/feed-channels`)

| Element          | Typ    | Treść                                                                                         |
| ---------------- | ------ | --------------------------------------------------------------------------------------------- |
| wyszukiwanie     | `txt`  | `Search`                                                                                      |
| tworzenie        | `btn`  | `Create channel` (zielony)                                                                    |
| tabela           | `tbl`  | `chk` · `Name` (sort) · `Created on` · `Posts` · `Displayed on`                               |
| wiersz           | dane   | `Czy wiedział_ś, że …` · `Friday, June 21, 2024 at 12:36 PM` · `0` · `Dyskusje`               |
| szczegóły kanału | `tabs` | `Details` · `Posts` · `Settings`; w `Details`: `* Name` (`txt-i18n`) = `Czy wiedział_ś, że …` |

## 17. Content → Discussions (`/chatrooms`)

| Element         | Typ   | Treść                                                                                                                                                                                                                                                      |
| --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis            | tekst | „Get your attendees engaging on specific topics or a general forum. **For better engagement, we recommend using the News Feed feature instead.**" + `Learn how ›`                                                                                          |
| wyszukiwanie    | `txt` | `Search`                                                                                                                                                                                                                                                   |
| tworzenie       | `btn` | `New discussion` (zielony)                                                                                                                                                                                                                                 |
| tabela          | `tbl` | `Name` · `Description` · `Members` · `Messages`                                                                                                                                                                                                            |
| wiersz          | dane  | `Rekomendacje fiskalne dla Polski` · – · `1` · `0`                                                                                                                                                                                                         |
| szuflada edycji | pola  | `Picture` (`file`, „We recommend using an image of **256 x 256 px** and **no larger than 300kb**.") · `* Discussion name` = `Rekomendacje fiskalne dla Polski` · `Description` (`area`, placeholder `Add a short description`) · `btn` `Delete` (czerwony) |

---

## 18. Exhibitor Marketplace (`/exhibitor-marketplace`)

### 18.1 Ekran powitalny (przed utworzeniem)

| Element    | Typ     | Treść                                                                                                                                                                                                                                                                                                |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst   | `Welcome to the` **`Exhibitor Marketplace`**                                                                                                                                                                                                                                                         |
| opis       | tekst   | „Generate new revenue by enabling exhibitors to purchase extras directly in the Exhibitor Center, whether Swapcard features such as **Lead Capture** or **in-app Advertising**, or any **on-site services** you offer (e.g. parking spaces or Wi-Fi access)."                                        |
| akcje      | `btn`   | `Create marketplace` (zielony) · `Learn more`                                                                                                                                                                                                                                                        |
| instrukcja | 3 kroki | **1 Connect your Stripe account** („Connect your Stripe account to enable seamless payments") · **2 Create & price your extras** („Customize pricing for each extra to match your monetization strategy") · **3 Track purchase data** („Monitor sales and revenue with real-time purchase insights") |
| materiał   | wideo   | miniatura z przyciskiem odtwarzania                                                                                                                                                                                                                                                                  |

### 18.2 Modal `Set currency`

| Element     | Typ                | Treść                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ostrzeżenie | ramka (ikona „i")  | „**This currency applies to both Marketplace and In-app registration. Currency changes require support assistance.**"                                                                                                                                                                                                                                                                                               |
| lista walut | `sel` (rozwinięta) | `Euro (EUR)` · `US Dollar (USD)` ✓ · `Canadian Dollar (CAD)` · `United Arab Emirates Dirham (AED)` · `British Pound (GBP)` · `Singapore Dollar (SGD)` · `Japanese Yen (JPY)` · `Swedish Krona (SEK)` · `Australian Dollar (AUD)` · `South African Rand (ZAR)` · `Danish Krone (DKK)` · **`Polish Zloty (PLN)`** (podświetlony) · `Swiss Franc (CHF)` · `Norwegian Krone (NOK)` · … (strzałka w dół — lista dłuższa) |

### 18.3 Ekran główny marketplace

| Element   | Typ           | Treść                                                                                                                                                                                         |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| baner     | ramka + `lnk` | „🚀 **New Feature Release!** Easily customize the marketplace for your exhibitors. Try it out and share your feedback." + `Provide feedback`                                                  |
| opis      | tekst         | „Offer exhibitors tailored add-ons to enhance their event presence with additional services and products, creating valuable monetization opportunities and boosting revenue." + `Learn how ›` |
| zakładki  | `tabs`        | `Extras` (aktywna) · `Orders` · `Revenue team`                                                                                                                                                |
| akcje     | `lnk`/`btn`   | `Payment settings` (ikona) · `Marketplace settings` (ikona koła) · `Create an extra` (zielony)                                                                                                |
| tabela    | `tbl`         | `Status` · `Extra name` · `Related permission` · `Price` · `Units sold` · ikona kolejności · `…`                                                                                              |
| wiersz 1  | dane          | `● Disabled` · `Lead Capture (LC)` · `Lead capture` · `532,90 zł` · `0`                                                                                                                       |
| wiersz 2  | dane          | `● Disabled` · `Lead Qualification` · `Lead qualification` · `103,24 zł` · `0`                                                                                                                |
| paginacja | —             | `1 - 2 of 2`                                                                                                                                                                                  |

### 18.4 Szczegóły dodatku `Lead Capture (LC)`

| Sekcja                          | Element     | Typ                | Etykieta                                                                            | Wartość                                                                                                               | Pomoc / limit                                                                                                                                                                                          |
| ------------------------------- | ----------- | ------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| nagłówek                        | —           | plakietki + `btn`  | `Lead Capture (LC)` · `0 sold` · `● Disabled` · `▷ Enable extra`                    | —                                                                                                                     | `‹ Back to exhibitor marketplace`                                                                                                                                                                      |
| baner                           | —           | ramka + `lnk`      | „**Collect payments** — Connect your Stripe account to accept payments for extras." | `Set gateway`                                                                                                         | —                                                                                                                                                                                                      |
| `Basics`                        | nazwa       | `txt-i18n`         | `* Extra name`                                                                      | `Lead Capture (LC)`                                                                                                   | `17/50 characters maximum`; „Define the name and description of your extra. Manage image visibility on the `Marketplace settings`."                                                                    |
|                                 | opis        | `area` + flaga     | `* Description`                                                                     | „Exhibitor members will be able to use the mobile app to scan participants badges, saving their contact information." | `115/500 characters maximum`                                                                                                                                                                           |
|                                 | obraz       | `file` (ikona „i") | `Image`                                                                             | ilustracja skanowania                                                                                                 | —                                                                                                                                                                                                      |
|                                 | liczba      | `num`              | `Quantity`                                                                          | placeholder `No limit`                                                                                                | —                                                                                                                                                                                                      |
| `Permissions`                   | uprawnienia | `multi` (`chk`)    | `Related permissions` (ikona „i")                                                   | `Lead capture` ✓ · `Lead qualification` ☐                                                                             | „Define the permissions for this extra and choose which group can view it."                                                                                                                            |
|                                 | grupy       | `multi` (`chk`)    | `* Assigned groups`                                                                 | `Exhibitors` ✓                                                                                                        | —                                                                                                                                                                                                      |
| `Price`                         | cena        | `num`              | `* Price (before tax)`                                                              | `532,9`                                                                                                               | „Set a price for your extra. Your payout will be displayed next to it. To learn more about fees, click the link next to the field."; „**Minimum price set to PLN 531.90, matching the Swapcard fee.**" |
|                                 | wypłata     | `ro` + `lnk`       | `Estimated payout`                                                                  | `PLN 64.53`                                                                                                           | `How fees work`                                                                                                                                                                                        |
| `Additional settings`           | link        | `txt`              | `"Learn more" link` (ikona „i")                                                     | placeholder `Add a link so the exhibitor can find out more about this extra`                                          | —                                                                                                                                                                                                      |
| `After purchase email campaign` | kampania    | `btn`              | `Create campaign`                                                                   | —                                                                                                                     | „Create an email in the email manager for this extra. Customize it to send more information to your exhibitors about their purchase."                                                                  |
| `Preview`                       | podgląd     | karta              | —                                                                                   | ilustracja + treść dodatku                                                                                            | „View how the ticket appears to registrants" (analogicznie)                                                                                                                                            |
| stopka                          | —           | `btn`              | `Cancel` · `Save` (nieaktywny)                                                      | —                                                                                                                     | —                                                                                                                                                                                                      |

---

## 19. Meetings

### 19.1 `All meetings` (`/meetings/schedule`)

| Element    | Typ                | Treść                                                                                                            |
| ---------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| opis       | tekst              | „Make sure people can meet at the time and place that's convenient for them." + `Learn how ›`                    |
| stan pusty | ilustracja + tekst | „**No meetings scheduled, make sure you create slots, locations, generate condition and/or add request rules.**" |
| akcja      | `btn`              | `Create locations` (zielony)                                                                                     |

### 19.2 `Locations` — formularz „Create locations" (`/meetings/places`)

| Element   | Typ          | Etykieta             | Wartość / placeholder                     | Pomoc                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------------ | -------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —         | tekst        | —                    | —                                         | „Create meeting locations to define where your participants can meet. **'Category'** allows you to apply an area (floor, hall, zone) to the room name. **'Meeting capacity'** is the capacity of meetings that can occur **at the same time** for the location. A capacity set to '1' means the location can only hold one meeting at a time." |
| kategoria | `txt` (lupa) | `Category`           | placeholder `e.g. "Hall 2" or "Level 3"`  | —                                                                                                                                                                                                                                                                                                                                              |
| nazwa     | `txt`        | `* Name`             | placeholder `e.g. "Blue room" or "Table"` | —                                                                                                                                                                                                                                                                                                                                              |
| pojemność | `num`        | `* Meeting capacity` | `3`                                       | —                                                                                                                                                                                                                                                                                                                                              |
| wirtualne | `sw`         | `Virtual`            | **wyłączony**                             | —                                                                                                                                                                                                                                                                                                                                              |
| zapis     | `btn`        | `Create 1 location`  | nieaktywny do wypełnienia                 | licznik w etykiecie                                                                                                                                                                                                                                                                                                                            |

### 19.3 `Locations` — lista

| Element      | Typ                | Treść                                                                                                                                                               |
| ------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| wyszukiwanie | `txt`              | placeholder `Search an exhibitor`                                                                                                                                   |
| ustawienie   | `lnk` (ikona koła) | `Default meeting location capacity`                                                                                                                                 |
| dodanie      | `btn`              | `Add locations` (zielony)                                                                                                                                           |
| tabela       | `tbl`              | `chk` · `Category` · `Name` (sort) · `Meeting capacity` · `Exhibitors` (filtr) · `Confirmed` · `Confirmed - past` · `Pending` · `Canceled` · `Expired` · `Not held` |
| wiersz       | dane               | `d` · `d` · `3` · – · `0` · `0` · `0` · `0` · `0` · `0`                                                                                                             |

### 19.4 `Slots` — lista (`/meetings/slots`)

| Element     | Typ   | Treść                                                                                                        |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| dodanie     | `btn` | `Add slots` (zielony)                                                                                        |
| tabela      | `tbl` | `chk` · `Date` (sort) · `Duration` · `Confirmed` · `Pending` · `Canceled` · `Expired` · `Not held` · `Draft` |
| wiersze (4) | dane  | `November 27, 2024 11:00 PM - 11:30 PM` · `30 minutes` · zera                                                |
|             |       | `March 27, 2025 12:00 AM - 3:30 PM` · **`930 minutes`** · zera                                               |
|             |       | `March 27, 2025 12:00 AM - 5:30 PM` · **`1050 minutes`** · zera                                              |
|             |       | `March 27, 2025 10:00 AM - 10:30 AM` · `30 minutes` · zera                                                   |
| paginacja   | —     | `1 - 4 of 4`                                                                                                 |

### 19.5 Modal „Create meeting slots" (generator partii)

| Element        | Typ                                    | Etykieta                                       | Wartość                                                                                                                                                                                                                                                                        |
| -------------- | -------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| —              | tekst                                  | —                                              | „Create slots where you want your participants to meet. **Each batch allows you to create several consecutive slots of the same duration**, for which you have to define the date, the start time of the first slot, the end time of the last one, as well as their duration." |
| partia 1       | `date` · `time` · `time` · `sel` + `×` | `Day` · `Start time` · `End time` · `Duration` | `11/26/2025` · `9:00 AM` · `7:00 PM` · `30 minutes`                                                                                                                                                                                                                            |
| partia 2       | j.w.                                   | j.w.                                           | `11/27/2025` · `9:00 AM` · `7:00 PM` · `30 minutes`                                                                                                                                                                                                                            |
| kolejna partia | `lnk`                                  | `Add another batch`                            | —                                                                                                                                                                                                                                                                              |
| zapis          | `btn`                                  | **`Create 40 slots`**                          | licznik wyliczony z partii                                                                                                                                                                                                                                                     |

### 19.6 `Request rules` — „Create rule" (`/meetings/rules`)

| Sekcja                             | Element      | Typ                     | Etykieta                                                                                                 | Wartość / opcje                               | Pomoc                                                                                                                                                                                                 |
| ---------------------------------- | ------------ | ----------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —                                  | —            | tekst                   | —                                                                                                        | —                                             | „Create a request rule to define **who can request meeting (requesters)**, **to whom (invitees)** and **in which locations**. Select all groups if you do not want any restrictions." + `Learn how ›` |
| `Rule name`                        | nazwa        | `txt`                   | `* Rule name`                                                                                            | placeholder `e.g. "Business meetings"`        | „This name is only visible to you"                                                                                                                                                                    |
| `Who should meet with whom?`       | zapraszający | `multi` (`chk`) + `lnk` | `* Requesters` + `Select all`                                                                            | `Exhibitors` ☐ · `Speakers` ☐ · `Attendees` ☐ | „People of groups Requesters will be able to send meeting requests to the people **and exhibiting companies** of groups Invitees."                                                                    |
|                                    | zapraszani   | `multi` (`chk`) + `lnk` | `* Invitees` + `Select all`                                                                              | `Exhibitors` ☐ · `Speakers` ☐ · `Attendees` ☐ | —                                                                                                                                                                                                     |
| `Where and when should they meet?` | ostrzeżenie  | ramka + `lnk`           | „**Time slots must be created first**"                                                                   | `Add time slots`                              | „Select the locations where participants can meet, as well as the time slots when each location is available."                                                                                        |
| `Meeting request expiration`       | wygaśnięcie  | `radio` + `num` + `sel` | `The meeting requests expire`: `After a time period of` (wybrany) `3` `Day(s)` · `At meeting start date` | —                                             | „Define the meeting request expiration time; **changes impact only new meeting requests. A 2 to 4-day expiration boosts acceptance rates.**"                                                          |
| stopka                             | zapis        | `btn`                   | `Create request rule`                                                                                    | nieaktywny                                    | —                                                                                                                                                                                                     |

### 19.7 `Hosted buyer & Smart Meetings` 💎 (`/meetings/hosted-buyer`)

| Element   | Typ                   | Treść                                                                                                                                                                                 |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| plakietka | `badge`               | `Add-on`                                                                                                                                                                              |
| nagłówek  | tekst                 | `Welcome to the` **`Hosted buyer & Smart meetings`**                                                                                                                                  |
| opis      | tekst                 | „Let participants choose who they want to meet, and **our algorithm will generate their best agenda** to optimize business time."                                                     |
| akcja     | `btn`                 | `Get feature` (nieaktywny)                                                                                                                                                            |
| sekcja    | nagłówek              | `Ready for next-level networking?`                                                                                                                                                    |
| —         | karta (ikona kursora) | **`Let participants choose`** — „Create a **selection page** where participants can choose their preferred meetings by marking others as **»Highly Interested«** or **»Interested«**" |
| —         | karta (ikona iskier)  | **`Smart meeting scheduling`** — „Use AI to generate meetings based on **preferences, availability, and selection criteria**, ensuring an optimized schedule for all participants."   |
| materiał  | wideo                 | `How does it work?` + odtwarzacz z napisami                                                                                                                                           |

### 19.8 Ekrany z materiału wideo (konfiguracja strony wyboru)

| Ekran                              | Elementy                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Define access and display groups` | „The meeting selection page lets participants choose who they'd like to meet." + `View an example page`; `Who can access the page?` → `* Select groups` (`chk`: `Exhibitors`, `Speakers`, `Attendees`, **`Buyers`**, **`Sellers`**) + `Select all`; `Who is displayed on the page?` → `* Select groups` (te same + `Buyers`) + `Select all`; górny pasek: `▷ Preview` · plakietka `● Published`                                                                                  |
| konfiguracja strony                | `What is the page's name?` → `txt-i18n` = `Meet buyers` (flaga EN) + `txt` koloru = `# CF386B` z próbnikiem; `Icon` → paleta **~50 ikon** (osoby, VIP, mikrofon, kalendarz, gwiazdka, serce, dzwonek, pin, puchar, wykresy, QR, kod paskowy, chmura, muzyka, kamera, koszyk, globus, Facebook, Instagram, LinkedIn, Messenger, X, YouTube, tag, koło zębate…); `Button background image` → `file` („We recommend using an image of **600x200px** and **no larger than 300kb**.") |
| filtry                             | `Which filters should be available?` → `Filters` (`chk`): `Industry` · `Size` · `Location` · `Job Function` · `Purchase role` … + `Select all`; „Select the fields you want displayed as search filters. You can create new ones and manage their order in the `custom fields settings`."                                                                                                                                                                                        |
| czas i miejsce                     | `Define meeting times and locations`; `When should they meet?` → `* Meeting time slots` + `Select all`: dni jako sekcje rozwijane z `chk` (`Monday, September 15, 2030`, `Tuesday, September 16, 2030`, `Wednesday, September 17, 2030`), w środku **kafle slotów** `9:00 AM / 30 mins` … `6:30 PM / 30 mins` (część aktywna, część nie); „Define when participants can meet by enabling the desired time slots."; niżej `* Meeting locations` („Where should they meet?")       |
| napisy z filmu                     | „Define who can meet whom, when, and where," → „with matching custom rules on category," → „and give preference to your top VIP buyers."                                                                                                                                                                                                                                                                                                                                         |

---

## 20. Communications → Emails (`/emails`)

### 20.1 Lista kampanii

| Element          | Typ                                          | Treść                                                                                                                                                                                                       |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis             | tekst                                        | „Manage and personalize attendee communications. **Target specific groups** with customized content, ensuring timely, relevant information to boost engagement and enhance the experience." + `Learn how ›` |
| akcje            | `btn`                                        | `Email templates` · `Email header` · `Create a campaign` (zielony)                                                                                                                                          |
| grupa kampanii 1 | sekcja (ikona „i") + `…` + strzałka zwijania | **`Campaign for Registration`**                                                                                                                                                                             |
| tabela           | `tbl`                                        | `chk` · `Status` · `Subject` · `Date` · `Type` · `Sent` · `Opened` · `Clicked` (ikona „i")                                                                                                                  |
| wiersz           | dane                                         | `● Disabled` · `Registration confirmation` · – · **`Registration`** · – · – · –                                                                                                                             |
| grupa kampanii 2 | sekcja + plakietka grupy + `btn`             | **`Campaign for Attendees`** [`Attendees`] + `+ Create email`                                                                                                                                               |
| wiersze (4)      | dane                                         | `Curious about who you'll meet?` · `Nov 17, 2024 · 9:00 AM (CEST)` · **`Continuous`**                                                                                                                       |
|                  |                                              | `Have you joined your event community?` · `Nov 24, 2024 · 9:00 AM (CEST)` · `One-time`                                                                                                                      |
|                  |                                              | `It's almost go-time! Are you ready?` · `Nov 26, 2024` · `One-time`                                                                                                                                         |
|                  |                                              | `Let's keep the momentum going!` · `Nov 28, 2024` · `One-time`                                                                                                                                              |
| grupa kampanii 3 | sekcja + plakietka                           | **`Campaign for Exhibitors`** [`Exhibitors`] + `+ Create email`                                                                                                                                             |
| wiersze (4)      | dane                                         | `Want qualified leads and a higher ROI?` (`Continuous`) · `Qualified prospects are waiting to meet you!` · `Your prospects have the app - do you?` · `Stay in touch with your new contacts.`                |
| grupa kampanii 4 | sekcja + plakietka                           | **`Campaign for Speakers`** [`Speakers`] + `+ Create email`                                                                                                                                                 |
| wiersze (4)      | dane                                         | `Your audience looks forward to your session!` (`Continuous`) · `Want to see who's attending your session?` · `Are you engaging with your audience?` · `Make the most of your new connections.`             |
| stan wszystkich  | `badge`                                      | `● Disabled`, statystyki `-`                                                                                                                                                                                |

### 20.2 Edytor e-maila — nagłówek i podgląd

| Element        | Typ     | Treść                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nawigacja      | `lnk`   | `‹ Back to emails`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| tytuł          | tekst   | `Your audience looks forward to your session!`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| akcje          | `btn`   | `+ Save as template` · `▷ Send test email`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| instrukcja     | tekst   | „Modify the template by selecting the content you wish to change." + `Learn how ›`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| zakładki       | `tabs`  | `Properties` · `Content` · `Blocks`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| podgląd        | `radio` | `Desktop` (aktywny) · `Mobile`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| treść podglądu | render  | logo `swapcard` + grafika nagłówkowa; `European Strategies Congress`; „Hello Jane, You've been added to the event app for **European Strategies Congress** as a speaker. Join the app to **increase your visibility** and **start engaging with your audience**."; `btn` `ACCESS MY PROFILE` (pomarańczowy); sekcja `Highlight your profile` z dwiema kolumnami: `Get visibility` („Please verify your profile so it displays the right information. If missing, add your picture and a short bio.") i `Grow your audience` („Add social networks to get more followers and enable attendees to easily interact with you.") |

### 20.3 Zakładka `Properties`

| Element       | Typ               | Etykieta                 | Wartość                                        | Walidacja                                                                    |
| ------------- | ----------------- | ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| temat         | `txt`             | `* Subject`              | `Your audience looks forward to your session!` | —                                                                            |
| nadawca       | `txt`             | `* From (sender's name)` | **`{{{ event_name }}}`**                       | —                                                                            |
| data wysyłki  | `date`            | `* Email sending date`   | `11/17/2024, 09:00 AM`                         | **„The selected date has passed. Please define the hour first."** (czerwony) |
| identyfikator | `ro` + kopiowanie | `Email ID`               | `RW1haWxfNTk3NDY0`                             | —                                                                            |

### 20.4 Zakładka `Content`

| Element                  | Typ                           | Etykieta                              | Wartość                                                                                                                                                                                                                           |
| ------------------------ | ----------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typ obrazu               | `sel`                         | `Image type`                          | `Default email header image`                                                                                                                                                                                                      |
| przekierowanie obrazu    | `sel`                         | `Redirection when clicking on image`  | `Event Home`                                                                                                                                                                                                                      |
| typ tytułu               | `sel`                         | `Title type`                          | `Event name`                                                                                                                                                                                                                      |
| treść                    | `rte` z **chipami zmiennych** | —                                     | „Hello [`First name`] , You've been added to the event app for [`Event name`] as a speaker. Join the app to **increase your visibility** and **start engaging with your audience**." (pasek: B · U · listy · link · ikona bloków) |
| przekierowanie przycisku | `sel`                         | `Redirection when clicking on button` | `Event Home`                                                                                                                                                                                                                      |
| tekst przycisku          | `txt`                         | `Button text`                         | `Access My Profile`                                                                                                                                                                                                               |

## 21. Communications → Notifications (`/notifications`)

| Element    | Typ     | Treść                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst   | `Welcome to` **`Notifications scheduler`**                                                                                                                                                                                                                                                                                                                                                                                            |
| opis       | tekst   | „Send timely and relevant notifications about your content or updates to keep people informed and engaged." + `lnk` `Learn how to increase your audience interaction`                                                                                                                                                                                                                                                                 |
| akcja      | `btn`   | `Schedule your first notification` (zielony)                                                                                                                                                                                                                                                                                                                                                                                          |
| instrukcja | 3 kroki | **1 Select the redirection** („Select a page to redirect your users to when they click on your notification. Multiple options are available for you to highlight your content.") · **2 Set the target** („Target specific people by **custom field, groups** and more to make sure you reach the right audience.") · **3 Plan the date & time** („Schedule your notifications in advance to be ready even before your event starts.") |

---

## 22. Onsite

### 22.1 `Lead generation` 💎 (`/lead-generation`)

| Element    | Typ           | Treść                                                                                                                                                                                                                                                           |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst         | `Unlock the power of` **`Lead generation`**                                                                                                                                                                                                                     |
| opis       | tekst         | „Allow your **attendees and exhibitors** to collect valuable leads, enhancing networking opportunities and optimizing event outcomes with our intuitive badge scanning."                                                                                        |
| karta 1 💎 | karta + `btn` | `Lead capture` — „Use the app to scan participant badges for simple lead collection and sharing." + `Get feature`                                                                                                                                               |
| karta 2 💎 | karta + `btn` | `Lead qualification` — „Add value to exhibitors' lead collection by giving them a way to qualify leads by criteria they define." + `Get feature`                                                                                                                |
| baner      | ramka + `btn` | „**Boost revenue by selling extras in the marketplace!** Offer exhibitors tailored products to enhance their event presence with additional services and products, creating valuable monetization opportunities and boosting your revenue." + `Set marketplace` |

### 22.2 `Badge templates` — edytor badge'a (`/registration/badge-templates`)

**Podgląd (kanwa, skala 1:1, format pionowy do złożenia):**

| Element badge'a    | Treść                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------- |
| grafika nagłówkowa | okładka „Geopolityczna Gra Mocarstw"                                                         |
| imię i nazwisko    | `First name Last name` (największa czcionka)                                                 |
| stanowisko         | `Job title`                                                                                  |
| firma              | **`Company`** (pogrubione)                                                                   |
| kod                | **QR**                                                                                       |
| pasek partnerów    | trzy bloki logotypów: `PARTNERZY HONOROWI` · `PARTNERZY MEDIALNI` · `PARTNERZY MERYTORYCZNI` |
| stopka             | „Badge generated by **swapcard**" (także w odbiciu lustrzanym na dolnej połowie)             |
| instrukcja druku   | „How to double fold your badge" + 3 miniatury składania                                      |

**Panel prawy `Badge customization`:**

| Element        | Typ    | Etykieta                        | Wartość           | Uwagi                                                                                                                  |
| -------------- | ------ | ------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------- |
| —              | tekst  | —                               | —                 | „Personalize your badge template. **Default badge is associated to all tickets which haven't a template associated.**" |
| zakładki       | `tabs` | `General` · `Design` · `Fields` | `General` aktywna | —                                                                                                                      |
| nazwa szablonu | `txt`  | `* Badge template name`         | `Default badge`   | plakietka `Default` przy tytule                                                                                        |
| menu           | `…`    | —                               | —                 | akcje szablonu                                                                                                         |

**Panel elementu (po zaznaczeniu obrazu na kanwie) — `Picture`:**

| Element       | Typ                          | Etykieta                            | Wartość                               |
| ------------- | ---------------------------- | ----------------------------------- | ------------------------------------- |
| nawigacja     | strzałka `←` + `…`           | `Picture`                           | —                                     |
| obraz         | `file` + podgląd (ikona „i") | `Header image`                      | pasek logotypów partnerów             |
| szerokość     | `sel` (jednostka) + `num`    | `Width`                             | `%` · `100`                           |
| wyrównanie    | `sel`                        | `Alignment`                         | `Center`                              |
| odstęp        | `num`                        | `Distance from previous (cm)`       | `0,54`                                |
| nawigacja pól | `btn`                        | `← Previous field` · `Next field →` | —                                     |
| na kanwie     | etykieta wymiaru             | —                                   | `0.54(cm)` przy zaznaczonym elemencie |

### 22.3 `Session scanning` 💎 (`/onsite/sessions`)

| Element    | Typ     | Treść                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst   | `Unlock the power of` **`Session scanning`**                                                                                                                                                                                                                                                                                                                                                                                                                    |
| opis       | tekst   | „Scan attendee badges at the **entrance or exit** of a session to **control access** or **track attendance** with SwapAccess App." + `btn` `Get feature`                                                                                                                                                                                                                                                                                                        |
| instrukcja | 3 kroki | **1 Attendance tracking** („Scan participant badges at the entrances or exits of sessions to control access and measure attendance.") · **2 Access control** („Manage access with precision using the SwapAccess App. Ensure only authorized attendees enter specific sessions or areas.") · **3 Data driven insights** („Analyze attendance patterns, session popularity, and participant flow to optimize future events and enhance overall event planning.") |

### 22.4 `Checkpoints` 💎

| Element    | Typ     | Treść                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst   | `Unlock the power of` **`Checkpoints`**                                                                                                                                                                                                                                                                                                                                                                                                |
| opis       | tekst   | „Track or control access to any part of your event with badge scanning checkpoints with SwapAccess App." + `btn` `Get feature`                                                                                                                                                                                                                                                                                                         |
| instrukcja | 3 kroki | **1 Create checkpoints** („Create as many checkpoints as you want to monitor or track access to certain areas of your event.") · **2 Create SwapAccess credentials** („Set up credentials to login to the SwapAccess App. **These credentials can be used to log in on multiple devices.**") · **3 Scan with SwapAccess** („Download the SwapAccess app and scan attendees' badges **at the entrance and exit** of your checkpoints.") |

### 22.5 `Self check-in` 💎 (`/self-check-in`)

| Element    | Typ     | Treść                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| nagłówek   | tekst   | `Unlock the power of` **`Self check-in and badge printing`**                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| opis       | tekst   | „**Swapcard GO** delivers all the necessary equipment to easily allow people with an In-App registration ticket to do self check-in and have their badge automatically printed." + `btn` `Get feature` + wideo                                                                                                                                                                                                                                                                                     |
| instrukcja | 3 kroki | **1 Use In-App registration** („Configure your registration form and start collecting registrations. **Self Check-in only works for people registered with In-App Registration.**") · **2 Request a Swapcard GO box** („Experience the simplicity of event check-in with Swapcard GO! Everything you need will be delivered to you." + `btn` `Request a box`) · **3 Use SwapAccess** („Generate a login code for accessing the SwapAccess app on the **iPads** included in your Swapcard GO box.") |

---

## 23. Analytics

### 23.1 `Dashboard` (`/analytics`)

| Element     | Typ                       | Treść                                                                                                       |
| ----------- | ------------------------- | ----------------------------------------------------------------------------------------------------------- |
| opis        | tekst                     | „Insightful metrics and analytics to better understand your audience and measure your ROI." + `Learn how ›` |
| ostrzeżenie | ramka (ikona „i") + `lnk` | „**You are seeing dummy data on this dashboard.**" + `Show my event data`                                   |
| sekcja 1    | nagłówek                  | `In-App registration`                                                                                       |
| kafle (4)   | KPI                       | `48,820 Registered` · `28,501 Checked-in` · `350 Canceled*` · `15 Abandoned` + `Add-on` 💎                  |
| sekcja 2    | nagłówek                  | `Paid tickets*`                                                                                             |
| kafle (4)   | KPI                       | `349 Paid tickets sold` · `$4,890.00 Total revenue` · `$522.00 Total refunds` · `$350.00 Total balance due` |
| przypis     | tekst                     | „\*Group filtering is not considered for the these metrics."                                                |
| wykres      | nagłówek + `radio`        | `Registration over time`: `Confirmed registrations` (aktywny) · `All registrations`                         |
| —           | wykres liniowy            | oś Y `0 … 34,000`, oś X `Jun 14 … Jun 30`, tooltip `Jun 22 — Registration over time : 10000`                |

### 23.2 `Reports` (`/reports`)

| Element              | Typ       | Treść                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| opis                 | tekst     | „Access comprehensive reports that provide valuable insights into every aspect of your event." + `Learn how ›`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| plan                 | `btn`     | `Upgrade plan` (wszystkie pozycje wyszarzone)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| sekcja bez nazwy     | 2 pozycje | **`General metrics`** („Networking summary for attendees and exhibitors, active users and platform usage information") · **`Transactions`** („List of all credit card transactions, including customer and payment details, status, and verification information")                                                                                                                                                                                                                                                                                                                                             |
| `SESSIONS`           | 5 pozycji | **`Session registrations, attendance, and feedback`** („List of people registered for sessions, with **scan in and out dates**, their ratings, and comments (if any).") · **`Live session interaction messages and questions`** („List of messages and questions sent in the live interaction of sessions.") · **`Poll answers`** („List of people who answered polls during sessions with their results.") · **`Video streaming`** („List of people who watched the session's streaming video, **with dates and durations**.") · **`Roundtables`** („List of people who joined the roundtables, with dates.") |
| `EXHIBITORS & ITEMS` | 2 pozycje | **`Exhibitors' pages, ads, docs, and items views and bookmarks`** („List of people who have seen or bookmarked the exhibitors or their items, seen or clicked on their ads, or downloaded their documents.") · **`Item views and bookmarks`** („List of people who have seen or bookmarked items, and list of items with total number of views and bookmarks.")                                                                                                                                                                                                                                                |
| `SPONSORS & ADS`     | 2 pozycje | **`Ads clicks and views`** („List of people who have seen or clicked on the event home advertising or the advanced banner ads views.") · **`Event home sponsors`** („List of people who clicked on the event home sponsors.")                                                                                                                                                                                                                                                                                                                                                                                  |

---

## Załącznik A — wszystkie wymogi obrazów

| Miejsce                       | Wymóg                                                             |
| ----------------------------- | ----------------------------------------------------------------- |
| okładka wydarzenia            | wymagana także przy nagłówku wideo (miniatury)                    |
| nagłówek sesji                | **16:9**, `1920x1080px`, ≤ **1 MB**                               |
| nagłówek firmy                | **16:9**, `1200x675px`, ≤ **1 MB** (albo wideo z YouTube/Vimeo)   |
| tło firmy                     | **16:10**, `2560x1600px`, ≤ **1 MB**                              |
| zdjęcie profilowe (formularz) | min. `240x240px`, ≤ **1 MB**                                      |
| obraz dyskusji                | `256x256px`, ≤ **300 kB**                                         |
| tło przycisku strony wyboru   | `600x200px`, ≤ **300 kB**                                         |
| reklama „event home"          | pion (desktop, prawa kolumna) + pełny ekran (mobile interstitial) |

## Załącznik B — wszystkie limity znaków

| Pole                         | Limit                        |
| ---------------------------- | ---------------------------- |
| etykieta biletu (`Label`)    | `0/40 characters`            |
| opis biletu (`Description`)  | `0/500 characters`           |
| nazwa dodatku (`Extra name`) | `17/50 characters maximum`   |
| opis dodatku (`Description`) | `115/500 characters maximum` |
| etykieta skrzynki interakcji | `0/30 characters maximum`    |
| opis dokumentu               | `max. 160 characters`        |

## Załącznik C — wszystkie zbiory statusów

| Encja               | Statusy                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| bilet               | `Ended` (wyliczany z okna sprzedaży), widoczność: `Visible` / `Hidden`             |
| e-mail / dodatek    | `Disabled` / (`Enabled`)                                                           |
| rejestracja (kafle) | `Registered` · `Checked-in` · `Canceled` · `Abandoned` 💎                          |
| spotkanie (miejsca) | `Confirmed` · `Confirmed - past` · `Pending` · `Canceled` · `Expired` · `Not held` |
| spotkanie (sloty)   | `Confirmed` · `Pending` · `Canceled` · `Expired` · `Not held` · `Draft`            |
| typ e-maila         | `Registration` · `Continuous` · `One-time`                                         |
| format sesji        | `In-person (no video)` (+ 5 pozostałych z modala)                                  |
| strona              | `Published` (plakietka w podglądzie)                                               |

## Załącznik D — katalog kolumn tabel (do projektu list w panelu)

| Tabela               | Kolumny                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Pages                | (lista z ikoną i nazwą; zakładki `Menu pages` / `Other pages`)                                                                                 |
| Tickets              | `Ticket name` · `Status`⚙ · `Price` · `Uses` · `Valid from` · `Valid until` · `Group`⚙ · `Visibility`⚙                                         |
| People               | `Onsite` · `Reg status`⚙ · `First name`↕ · `Last name`↕ · `Emails`⚙ · `Groups`⚙ · `Job title`↕ · `Company` · `Member of` · `Registered…`       |
| Sessions             | `Format`⚙ · `Title`↕ · `Description` · `Date`↕ · `Type` · `Location` · `Topics` · `Speakers`↕ · `Exhibitors`↕ · `Attendees`                    |
| Session → Attendees  | `Email` · `Groups` · `First name`↕ · `Last name`↕ · `Job title`↕ · `Company` · `Member of` · `Registered at`↕                                  |
| Exhibitors           | `Logo` · `Name`↕ · `Group`⚙ · `Location` · `Type` · `Members` · `Created on`↕ · `Description`↕ · `Website`                                     |
| Documents            | `Title of the document` · `Attached to` · `Description` · `Type` · `URL`                                                                       |
| Feed channels        | `Name`↕ · `Created on` · `Posts` · `Displayed on`                                                                                              |
| Discussions          | `Name` · `Description` · `Members` · `Messages`                                                                                                |
| Marketplace → Extras | `Status` · `Extra name` · `Related permission` · `Price` · `Units sold`                                                                        |
| Meetings → Locations | `Category` · `Name`↕ · `Meeting capacity` · `Exhibitors`⚙ · `Confirmed` · `Confirmed - past` · `Pending` · `Canceled` · `Expired` · `Not held` |
| Meetings → Slots     | `Date`↕ · `Duration` · `Confirmed` · `Pending` · `Canceled` · `Expired` · `Not held` · `Draft`                                                 |
| Emails               | `Status` · `Subject` · `Date` · `Type` · `Sent` · `Opened` · `Clicked`                                                                         |
| Event home ad        | `Image` · `Targeted groups` · `Number of views` · `Number of clicks`                                                                           |

⚙ = filtr w nagłówku · ↕ = sortowanie

## Załącznik E — pełna lista funkcji płatnych (`Add-on`) u Swapcarda

`Chat with exhibitors` · `Documents & Links` (wystawcy) · `Items` · `Lead capture` ·
`Lead qualification` · `Lead dashboards and exports` · `Members role` ·
`Moderated Registration` · `Group registration` · `Advanced banner ads` ·
`Abandoned` (metryka) · `Onsite access tracking with SwapAccess` ·
`Session scanning` · `Checkpoints` · `Self check-in` · `Lead generation` ·
`Hosted buyer & Smart Meetings` · raporty (`Upgrade plan`) ·
`Event home ad` (rozszerzenia — `Upgrade plan`)

## Załącznik F — wszystkie komunikaty walidacji i ostrzeżenia

| Komunikat                                                                                                         | Miejsce                      |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| „An event cannot exceed 90 days."                                                                                 | General information          |
| „Important: changing the default language will clear all your email content modifications."                       | Languages                    |
| „The selected date has passed. Please define the hour first."                                                     | edytor e-maila, data wysyłki |
| „Time slots must be created first"                                                                                | Request rules                |
| „Minimum price set to PLN 531.90, matching the Swapcard fee."                                                     | Marketplace, cena dodatku    |
| „This currency applies to both Marketplace and In-app registration. Currency changes require support assistance." | Set currency                 |
| „You are seeing dummy data on this dashboard."                                                                    | Analytics → Dashboard        |
| „\*Group filtering is not considered for the these metrics."                                                      | Analytics → Dashboard        |
| „These fields may contain personal data, for which you, as organizer are the data controller…"                    | People settings              |
| „The First name, Last name, and Email cannot be modified."                                                        | Form                         |
| „Self Check-in only works for people registered with In-App Registration."                                        | Self check-in                |
| „you can't have more than 5 features tabs enabled"                                                                | Live interactions            |
| „changes impact only new meeting requests. A 2 to 4-day expiration boosts acceptance rates."                      | Request rules                |
| „Default badge is associated to all tickets which haven't a template associated."                                 | Badge templates              |
| „Hidden tickets can be accessed via a direct registration link or selected within Studio."                        | Create a ticket              |
| „in Guest mode and on widgets, only the country is shown"                                                         | Contact details firmy        |
| „For better engagement, we recommend using the News Feed feature instead."                                        | Discussions                  |
