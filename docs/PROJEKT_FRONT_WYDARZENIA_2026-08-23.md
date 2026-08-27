# Front publiczny wydarzenia (aplikacja uczestnika) — mapowanie na nasz layout

Data: 2026-08-23 · Status: **projekt na artefaktach repo**
Materiał źródłowy: **10 zrzutów frontu** (paczka 1: 5 ekranów, paczka 2: 5 ekranów)

Dokumenty powiązane:

- `PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` — panel administracyjny i model danych
- `ANALIZA_BRAKUJACYCH_EKRANOW_2026-08-23.md` — kontrakt danych rzeczywistych (§9) i braki
- `INWENTARZ_ELEMENTOW_UI_SWAPCARD_2026-08-23.md` — inwentarz elementów panelu
- `MICROSITES.md` — wzorzec poddrzewa stron z własnym nagłówkiem
- `ARCHITECTURE.md` §2 — silniki treści (blocks vs builder)

## 0. Zasada tego dokumentu

Zamówienie brzmiało: **„dostosowane do naszego layoutu"**. Nie odwzorowuję więc
cudzego interfejsu — mapuję każdy element frontu na **istniejący artefakt NES**
(komponent, widget, tabela, RPC) i wprost nazywam to, czego nie ma. Obowiązuje
ta sama reguła co w analizie braków: **żadnego elementu bez rzeczywistego źródła**.

Cztery stopnie dopasowania, konsekwentnie w całym dokumencie:

| Znacznik | Znaczenie                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| ✅       | **jest** — artefakt istnieje i nadaje się bez zmian; podana ścieżka i nazwa eksportu                                      |
| 🟡       | **wymaga rozszerzenia** — artefakt istnieje, brakuje mu konkretnego pola/trybu (nazwanego)                                |
| 🔵       | **tylko wzorzec** — kod istnieje, ale jest prywatny w pliku trasy albo przypisany innej encji; do reuse trzeba go wynieść |
| ⛔       | **brak** — nie ma artefaktu; jest zadanie z proponowanym kształtem                                                        |

Ustalenie nadrzędne: **ok. 70% frontu uczestnika da się złożyć z rzeczy, które już
mamy.** Brakujące 30% to sześć nazwanych rzeczy (§11), nie „nowa aplikacja".

---

## 1. Dziesięć ekranów — co na nich jest

### Paczka 1

| #   | Ekran                    | Elementy widoczne na zrzucie                                                                                                                                                                       |
| --- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Strona główna wydarzenia | układ **trzykolumnowy**: lewa karta profilu · środek (okładka, lista kafli menu z kolorowymi ikonami i chevronem, poziomy sponsorskie, blok opisu z datą/strefą/adresem) · prawa kolumna z banerem |
| 2   | Kafle menu (zbliżenie)   | pozycje: `Uczestnicy`, `Prelegenci`, `Partnerzy`, `Agenda`, `Dyskusje` — każda: **ikona w kolorowym boksie** + etykieta + `chevron` po prawej                                                      |
| 3   | Zakładka Uczestnicy      | pole wyszukiwania · przełącznik **„Moja widoczność"** z opisem · lista osób · karuzela **„AI wybrane dla Ciebie"** z powodem dopasowania i przyciskiem odrzucenia                                  |
| 4   | Strona osoby             | avatar ze wskaźnikiem online · imię i nazwisko · stanowisko · firma · sekcje profilu · akcje kontaktu                                                                                              |
| 5   | Blok opisu wydarzenia    | data z ikoną zegara · **strefa czasowa z ikoną globusa** · adres z pinezką · treść opisu                                                                                                           |

### Paczka 2

| #   | Ekran                                          | Elementy widoczne na zrzucie                                                                                                                                                                    |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | Strona firmy / wystawcy                        | logo · nazwa · opis · sekcja **„Możesz także lubić"** · **zakładka (bookmark)**                                                                                                                 |
| 7   | Prelegenci — siatka                            | karty osób w siatce, każda: zdjęcie · imię · stanowisko · firma                                                                                                                                 |
| 8   | Partnerzy — lista                              | logotypy z nazwami, każdy z **zakładką**                                                                                                                                                        |
| 9   | Strona sesji                                   | **„Przekaż swoją opinię"** — 5 gwiazdek, opis „poufne" · **„Możesz także lubić"** (inne sesje) · **„Wykładowcy"** · **„Zarejestrowani uczestnicy"** · pływający przycisk **„Dyskusja na żywo"** |
| 10  | Mój profil / kontakty / harmonogram / zakładki | menu czterech sekcji · widok **Lista / Kalendarz** · **„Strefa czasowa i format"** · **„Połącz Kalendarz Google"**                                                                              |

---

## 2. Decyzja architektoniczna: front wydarzenia to **poddrzewo stron**, nie druga aplikacja

To rozstrzygnięcie było już podjęte w rozmowie („sekcja `/events/<slug>/…`
w serwisie, nie osobne microsite") — tu je uzasadniam artefaktami.

### 2.1 Co dziś jest publiczną powierzchnią wydarzenia [R]

| Trasa                                        | Co robi                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/routes/events.tsx`                      | lista wydarzeń                                                                           |
| `src/routes/events.$slug.tsx`                | **jedna** twarda strona szczegółów z RSVP i biletami; siatka dopiero od `lg` (linia 335) |
| `src/routes/club.$clubSlug.e.$eventSlug.tsx` | wydarzenie w kontekście klubu                                                            |

Nie ma **żadnej** trasy-układu dla wydarzenia — ani podstron, ani menu, ani kolumn.

### 2.2 Dlaczego poddrzewo `pages`, a nie nowe tabele

Wszystko, czego wymaga front z 10 zrzutów, silnik stron **już ma**:

| Potrzeba                                          | Artefakt                                                                                                                 | Stan            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- |
| Drzewo podstron (Agenda / Partnerzy / Prelegenci) | `pages.parent_id` + `pages.menu_order` + RPC `page_full_path`, `page_full_paths`, `page_breadcrumbs`; `PageParentSelect` | ✅              |
| Układ trzykolumnowy                               | `StructurePicker` → `STRUCTURES` zawiera **`{spans:[3,6,3]}`** („1/4 · 1/2 · 1/4") — dosłownie ten układ                 | ✅              |
| Render kolumn z kolejnością per breakpoint        | `BuilderRenderer` (`resolveSpan`, `resolveOrder`, `deviceForWidth`); na mobile `gridColumn:'auto'` → stos                | ✅              |
| Silnik sekcja → kolumna → widget                  | `SectionNode`, `ColumnNode`, `WidgetNode`, `BuilderDocument`, `ResponsiveValue<T>` (`src/lib/builder/types.ts`)          | ✅              |
| Własny nagłówek per strona                        | `pages.header_override` (`default` \| `transparent` \| `hidden`) + `BuilderPageShell`                                    | 🟡 (patrz §3.4) |
| Gotowa kompozycja startowa                        | `STARTER_TEMPLATES` → `starter-event-page` (`src/lib/builder/starterTemplates.ts:285`) + wzorzec `page.event`            | ✅              |
| Edytor                                            | `/admin/pages/$slug` z osadzonym `<Builder>`                                                                             | ✅              |

**Wniosek [P]:** budowanie osobnej powierzchni (`/event/$slug/uczestnicy` jako
rodzina tras React) oznaczałoby porzucenie buildera, edytora, wersjonowania,
SEO i i18n — i napisanie ich po raz drugi. Front wydarzenia to **strona-rodzic
z podstronami**, złożona z widgetów, z jednym wyjątkiem: zakładki wymagające
danych osobowych i sesji (`Uczestnicy`, `Dyskusje`) są **widgetami z bramką**
`advanced.access.auth`, a nie osobnymi trasami.

> ### ⟲ KOREKTA (2026-08-27): pięć zakładek to jednak osobne trasy
>
> **Co stało wyżej.** Że zakładki wydarzenia są widgetami w dokumencie
> buildera, a `Uczestnicy` i `Dyskusje` — widgetami z bramką `access.auth`;
> osobna rodzina tras React została odrzucona jako porzucenie edytora i SEO.
>
> **Co jest.** Pięć zakładek to **osobne trasy** pod `/events/<slug>/…`:
> `participants`, `speakers`, `partners`, `agenda`, `discussions`.
> `events.$slug.tsx` stał się powłoką z `<Outlet />`, przegląd zjechał do
> `events.$slug.index.tsx`. Segment trasy **jest wartością `event_pages.module`**
> — nie nazwą wymyśloną w kodzie (słownik: `src/lib/events/eventModules.ts`,
> zbiór domknięty CHECK-iem `event_pages_module_values` z migracji
> `20260826181500`).
>
> **Dlaczego decyzja się odwróciła.** Nie dlatego, że powyższa analiza była
> błędna — jej przesłanka przestała obowiązywać. Widgety modułowe
> (`speakers`, `event-schedule`, `event-sponsors`) **nadal czytają ręcznie
> wpisany JSON, nie bazę** (`src/lib/builder/registry.tsx`: `source: "manual"`,
> `eventId: ""`), bo `src/lib/builder/eventContext.ts` (EB-902) **nie istnieje**.
> Zakładka „Uczestnicy” jako widget pokazywałaby więc atrapę nazwisk zamiast
> listy z `event_attendees`, a bramka `advanced.access.auth` sprawdzałaby
> wyłącznie _zalogowanie_ — podczas gdy reguła jest ostrzejsza: lista wychodzi
> tylko uczestnikowi **zapisanemu na to wydarzenie**, a Chatham House twardo
> wyłącza nazwiska (egzekwuje to SQL w `20260826182500`, nie front).
>
> **Czego korekta NIE porzuca.** Edytora i SEO nie tracimy: strony modułowe
> pozostają **prawdziwymi wierszami `pages`** z dokumentem buildera (nagłówek
> `h1` + zdanie wstępu), a trasa zakładki renderuje ten dokument **tą samą
> drogą, co każda inna strona serwisu** (`resolvedContentQueryOptions` →
> `ContentRenderer`, wspólny klucz cache z trasą splat) i dopiero **pod nim**
> dokłada organizm z danymi. Redaktor edytuje w studiu tekst, który uczestnik
> naprawdę widzi. Wraz z EB-902 widget modułowy będzie mógł wejść do tego
> samego dokumentu — korekta tego nie zamyka.
>
> **Skutek uboczny, którego ten PR NIE naprawia.** Strona modułowa ma przez to
> **dwa adresy**: trasę zakładki (`/events/<slug>/speakers`) i ścieżkę strony
> CMS pod trasą splat (`/<korzeń-wydarzenia>/prelegenci`). Menu wydarzenia
> prowadzi **wyłącznie** do pierwszego (`EventPageLink` wybiera adres po
> znaczniku `module`), więc drugi jest osiągalny, ale nielinkowany — i pokazuje
> sam wstęp, bez danych. Kanonizacja (przekierowanie splata albo `rel=canonical`
> na zakładkę) wymaga, żeby **rezolwer ścieżek niósł znacznik `module`** — czyli
> zmiany w warstwie wspólnej dla całego CMS-u (`src/lib/queries/public.ts` oraz
> `src/routes/$.tsx`), a nie w module wydarzeń. Nie da się tego zrobić jednym
> `select`: `event_pages` ma RLS „staff read” i **żaden `GRANT` nie obejmuje
> roli `anon`** (`20260826120000:145,180`), więc odwzorowanie
> `page_id → (module, slug wydarzenia)` musi przejść przez **nowe RPC
> `SECURITY DEFINER`**, a każde rozwiązanie ścieżki w serwisie zapłaciłoby za nie
> round-tripem. Świadomie odłożone do osobnego zadania.

### 2.3 Czego do tego brakuje w danych ⛔

| Brak                                               | Sprawdzone                                                                                                                                                                                     | Zadanie                                                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pages.event_id`                                   | blok `pages` w typach — kolumny nie ma; `events` nie ma `builder_data` ani `home_page_id`                                                                                                      | **EB-901**: `alter table pages add column event_id uuid references events(id)` + `events.root_page_id`                         |
| Kontekst wydarzenia dla widgetów (dynamiczne tagi) | tagi dynamiczne istnieją **wyłącznie** dla wpisu i archiwum (`post-title`, `post-cover`, `archive-title`…); brak jakiegokolwiek `event-*`                                                      | **EB-902**: `src/lib/builder/eventContext.ts` na wzór `archiveContext.ts` + widgety `event-title`, `event-cover`, `event-info` |
| `menus.event_id`                                   | `menus` ma tylko `(id, key, name, tenant_id, created_at, updated_at)`                                                                                                                          | **EB-903**: kolumna `event_id` + rozwiązywanie `menu_key: "@event"` z kontekstu                                                |
| Szablon strony „aplikacja wydarzenia"              | `PAGE_TEMPLATES` ma 5 wpisów, żaden 3-kolumnowy; strony z `editor='builder'` **w ogóle** nie przechodzą przez wybór szablonu (`$.tsx:1341` zwraca `BuilderPageShell` przed `findPageTemplate`) | **EB-904**: nowy starter `starter-event-front-3col` (spans `[3,6,3]`) — tańsze niż nowy szablon shellu                         |

---

## 3. Chrome i układ

### 3.1 Nagłówek i stopka wokół frontu wydarzenia

| Element                                  | Artefakt                                                                                                                                    | Stan | Uwaga                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nagłówek serwisu jako dokument buildera  | `AppearanceBuilderPane` (`settingsKey="header"`, `scope="header"`), `site_settings` klucz `header` (+ historia w `site_settings_revisions`) | ✅   | `Header.tsx` renderuje `<BuilderRenderer doc={cfg.builder_data}/>` — nagłówek to zwykły dokument                                                          |
| Wyjście z chrome per trasa               | `showsSiteChrome`, `resolveHeaderMode`, `isReadingSurface`                                                                                  | ✅   | mechanizm „ta trasa ma inny nagłówek" **już istnieje**                                                                                                    |
| **Osobny nagłówek aplikacji wydarzenia** | `Builder` prop `scope` to **zamknięta unia** `"page" \| "header" \| "footer" \| "menu" \| "popup"`                                          | ⛔   | **EB-905**: dodać `"event-header"` + klucz `site_settings.event_header` + `defaultDocFor` + trasa `admin.appearance.event-header.tsx` (kopia istniejącej) |

### 3.2 Górne menu wydarzenia (`Strona główna` · `Uczestnicy` · `Prelegenci` · …)

| Element                                    | Artefakt                                                                                                                                                                                      | Stan | Uwaga                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| Struktura pozycji + render                 | `SiteMenu` (`menuKey`, `lang`, `mobile`) + widget `menu`; tabele `menus`, `menu_items` (`label_pl/en`, `href`, `icon`, `target`, `item_type`, `parent_id`, `position`, `css_class`, `mega_*`) | ✅   | dane są; brakuje tylko zakresu wydarzenia (§2.3, EB-903)                        |
| Reguły menu (drzewo, aktywna pozycja)      | `buildPublicMenuTree`, `pickMenuLabel`, `menuItemHref`, `isMenuPathActive`, `activeMenuIndex`, `panelGeometry` (`src/lib/menus/siteMenu.ts`)                                                  | ✅   | podświetlenie aktywnej zakładki **bez pisania nowej logiki**                    |
| Zarządzanie w panelu                       | `MenuManager` (`menuKey`), `AddItemPanel`, trasa `/admin/appearance/menu` z selektorem menu                                                                                                   | 🟡   | wystarczy, żeby menu wydarzenia było na liście `menus`                          |
| Alternatywa: zakładki w jednym dokumencie  | `SectionTabsConfig`, `SectionTabItem` (**ma `label_pl/en`, `icon` i `color`!**), `SectionTabsVariant` (11 wariantów), `SectionTabsBar`, `TabsPane`; `ColumnNode.tabId`                        | 🟡   | jedyne miejsce w repo, gdzie pozycja nawigacji **ma własny kolor** — patrz §4.2 |
| Wzorzec działającej nawigacji sekcji encji | `ClubHubSectionBar`, `ClubHubRail`, `ClubWorkspaceRail` + tablica `SECTIONS` i `visibleSections`                                                                                              | 🔵   | trasy zakodowane na sztywno (`/club/$clubSlug/...`) + gate `canSeeMembers`      |

### 3.3 Trzy kolumny

| Element                              | Artefakt                                                                                                                                                                                                            | Stan | Uwaga                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wstawienie układu `[3,6,3]`          | `StructurePicker` → `STRUCTURES` (linie 12-28)                                                                                                                                                                      | ✅   | dosłownie „1/4 · 1/2 · 1/4"                                                                                                                                   |
| Render + kolejność per breakpoint    | `BuilderRenderer` (`gridColumn` 638, `resolveOrder` 639)                                                                                                                                                            | ✅   | mobile: `gridColumn:'auto'` → automatyczny stos                                                                                                               |
| Wzorzec 3 kolumn na froncie          | `ClubHub`: `lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_20rem]`, lewy `<aside>` sticky, prawy sticky                                                                                       | 🔵   | dosłownie ten układ, ale hardkodowany dla klubów — **nie z buildera**                                                                                         |
| **Kolumna przyklejona (sticky)**     | `SectionLayout` i `ColumnNode` **nie mają** pola `sticky`/`position`; `advanced.customCss` jest stosowany tylko na poziomie widgetu (`WidgetView.tsx:245`), `BuilderRenderer` nie stosuje go dla sekcji ani kolumny | ⛔   | **EB-906**: `ColumnNode.sticky?: { enabled, offsetPx? }` + kontrolka w `ColumnProperties`; bez tego lewa karta profilu i prawy baner nie podążają za scrollem |
| Powłoka podstrony (404/403/skeleton) | `ClubWorkspaceLayout` + `ClubErrorNotice` + `ClubDetailSkeleton`; trasa-rodzic z bramką modułu `club.tsx`                                                                                                           | 🔵   | gotowy wzorzec „jedna powłoka dla N podstron encji"                                                                                                           |

### 3.4 Defekt do naprawy po drodze

`header_override='transparent'` jest **martwe**: selektory w `src/styles.css:1133`
i `:1137` celują w `[data-header-override="transparent"]` oraz `[data-template="landing"]`,
a kod emituje `data-page-header-override` (`BuilderPageShell.tsx:50`, `$.tsx:1405`)
i `data-page-template`. Grep po repo: **żaden** komponent nie ustawia
`data-header-override` ani `data-template`.

To jest warunek wstępny przezroczystego nagłówka nad okładką wydarzenia — czyli
dokładnie tego, co widać na zrzucie 1. **EB-907**: poprawić selektory na
`body:has([data-page-header-override="transparent"]) header[data-site-header]`.

---

## 4. Strona główna — kolumna środkowa

### 4.1 Okładka i opis wydarzenia

| Element frontu                                   | Artefakt                                                                                                                                                                                 | Stan | Uwaga                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Okładka — dane                                   | `events.cover_url`; już w `EVENT_COLUMNS` (`src/lib/community/publicQueries.ts:40`) i `EVENT_LIST_COLUMNS` (`src/lib/builder/eventsQuery.ts:33`)                                         | ✅   | nic nie trzeba dodawać do zapytań                                                                                                                                                   |
| Okładka — render dzisiejszy                      | blok w `events.$slug.tsx:302`                                                                                                                                                            | 🟡   | surowy `<img>` w `aspect-video`, **bez** `OptimizedImage`, bez `sizes`/`srcset`                                                                                                     |
| Okładka jako komponent                           | `ClubCover` (`url`, `variant: 'banner' \| 'card'`, używa `OptimizedImage`)                                                                                                               | 🟡   | ikona zastępnika zaszyta na `MessagesSquare` — do reuse trzeba dołożyć prop ikony/aspektu                                                                                           |
| Okładka jako **widget**                          | brak `event-cover`; `post-cover` czyta kontekst **wpisu** (`useCurrentPostCtx`), `image` wymaga stałego URL                                                                              | ⛔   | część **EB-902** (kontekst wydarzenia)                                                                                                                                              |
| Treść opisu                                      | render w `events.$slug.tsx:366`: `prose prose-neutral whitespace-pre-line` z `description_pl/en`                                                                                         | 🟡   | kolumny `events.description_*` są typu **`text`** — to zwykły tekst, nie HTML; rich wymagałby widgetu `rich-text` albo nowej kolumny                                                |
| Wiersz meta „ikona + etykieta + wartość"         | `MetaRow` — funkcja **lokalna, nieeksportowana** (`events.$slug.tsx:572`); użycia: `Calendar` (data, 336), `MapPin` (location, 343), `Users`, `Ticket`, `ShieldQuestion` (Chatham House) | 🔵   | dokładnie ten kształt co na zrzucie 5, ale prywatny                                                                                                                                 |
| **Strefa czasowa z ikoną globusa**               | dziś: strefa dopisywana jako **goły tekst** `` ` (${ev.timezone})` `` (`events.$slug.tsx:341`) — bez ikony i bez konwersji; ikony `Globe` nie użyto nigdzie w kontekście strefy          | ⛔   | patrz §4.4                                                                                                                                                                          |
| Blok „data + adres + liczniki + CTA" jako widget | widget `event-countdown-card` + `EventCountdownCardView` — tryb `mode:'event'` (`eventId`) ciągnie `events` przez `eventByIdQueryOptions`                                                | 🟡   | **brakuje**: opisu (`description_*`), strefy czasowej, ikony globusa; datę liczy `toLocaleDateString(uiLocale)` **bez** `timeZone`                                                  |
| Źródło danych dla całej kolumny                  | `fetchPublicEventBySlug` + `PublicEvent` (`publicQueries.ts:77`), `eventByIdQueryOptions` / `eventsListQueryOptions` / `eventRsvpCountsQueryOptions` (`eventsQuery.ts:113`)              | ✅   | zwraca `cover_url`, `timezone`, `location`, `description_*`, `starts_at`, `ends_at`, `kind`, `capacity`, `visibility` (`join_url`/`recording_url` odcięte grantem); cache edge 60 s |

**⛔ EB-908 — widget `event-info`** („Informacje o wydarzeniu"): tryb `event`
(`eventId`, docelowo z kontekstu §2.3) albo `custom`; wiersze: data (`Clock`),
**strefa czasowa (`Globe`)**, adres (`MapPin`), opis. Renderer wynosi
publiczny odpowiednik `MetaRow` do `src/components/events/`.

### 4.2 Kafle menu z **kolorowymi** ikonami — najważniejszy brak tej kolumny

Kształt ze zrzutu 2 (ikona w kolorowym boksie + etykieta + chevron) istnieje
w repo **jako CSS i jako prywatny komponent**, ale nie jako widget:

| Kandydat                                | Co ma                                                                                                                                            | Czego brakuje                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `SubmenuItem` + klasy `.menu-card-item` | **dokładnie** ten kształt: `.menu-card-item__icon` z `DynamicIcon`, `__label`, `__chevron` (`SiteMenu.tsx:168`; styl `src/styles.css:6431-6535`) | funkcja lokalna, nieeksportowana; **brak koloru per pozycja**                                                 |
| widget `menu`                           | `menu_key`, pełne dane z `menu_items`                                                                                                            | renderuje **poziomy pasek nagłówka**, nie pionową listę kafli; brak wariantu `tiles`                          |
| widget `nav-link`                       | `label_pl/en`, `href`, `target`, `variant` (5), `iconName` (typ pola `'icon'`)                                                                   | **jeden link = jeden widget**; brak koloru ikony w treści, brak chevronu                                      |
| widget `interactive-circle`             | `items[]` z `icon`, `label_pl/en`, `desc_pl/en`, `href` — ikona i link **per pozycja są**                                                        | kolory (`itemBg`, `itemColor`, `activeBg`, `activeColor`) są **wspólne dla wszystkich** pozycji; układ okręgu |
| `AccountMenuWidget` (`account-link`)    | ikona + etykieta + opis + `ChevronRight` z animacją (`:360`)                                                                                     | akcent globalny `--account-accent` z `config.panelAccent`; brak koloru per pozycja                            |
| `SectionTabItem`                        | **`label_pl/en` + `icon` + `color` per pozycja** — jedyne miejsce w repo z kolorem na pozycję                                                    | to zakładki sekcji buildera, nie lista kafli-linków                                                           |
| `ClubHubRail` → `SectionTile`           | ikona w chipie 8×8 + etykieta + licznik, stan aktywny `data-[status=active]`                                                                     | `SECTIONS` to twarda tablica z trasami klubu; brak chevronu i koloru                                          |

Infrastruktura ikon jest **kompletna**: `LucideIconPicker` (katalog
`LUCIDE_ICON_NODES`, kategorie + szukajka, zapis nazwy kebab-case), `DynamicIcon`
(~150 ikon eager + lazy, nieznana nazwa → `HelpCircle`, SSR-safe), typ pola `'icon'`
w schematach widgetów, `BrandIcon` + tabela `icon_library` dla ikon własnych.
Brakuje **wyłącznie koloru na pozycję**:

- `node.style.iconColor` / `iconHoverColor` / `iconActiveColor` działa na **cały widget** (reguły CSS na `[data-w-id]`, `WidgetView.tsx:255`);
- `menu_items` **nie ma** kolumny koloru;
- `icon_library` też nie — kolor jest wypalony w pliku (`url_light`/`url_dark`), a render to `<img>`, więc CSS `color` nie działa.

**⛔ EB-909 — widget `menu-tiles`**: `items[]` = `{ icon, iconColor, label_pl/en, desc_pl/en, href, badge }`,
plus `columns` i `variant`. Kolor przez typ pola `'color'` z walidacją
`safeWidgetColor` (`src/lib/builder/cssColor.ts`). Wizualnie: **klasy
`.menu-card-item` już istnieją** — widget je reużywa, nie tworzy nowego stylu.

**⛔ EB-910 (opcjonalne) — `menu_items.icon_color`**: gdyby kafle miały brać się
z menu witryny, a nie z treści widgetu: `alter table menu_items add column
icon_color text not null default ''` + pole w `MenuManager` + przekazanie do
`SubmenuItem`.

### 4.3 Poziomy sponsorskie / partnerzy — **jedyny blok gotowy w 100%**

| Element                         | Artefakt                                                                                                                                                                                                                                                                       | Stan |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Widget                          | `event-sponsors` (`registry.tsx:1438`); typ w `WidgetType` (`types.ts:423`)                                                                                                                                                                                                    | ✅   |
| Model treści                    | `tiers[] = { id, name_pl, name_en, size: 'lg'\|'md'\|'sm', sponsors[] = { id, name, logo, url, description_pl/en } }` + `heading_*`, `intro_*`, `accentColor`, `grayscale`                                                                                                     | ✅   |
| Render                          | `EventSponsorsView` (`:97`): `GRID_BY_SIZE` (lg 1/2 kol., md 2/3/4, sm 3/4/6), `LOGO_H_BY_SIZE` (h-16/h-12/h-8), nazwa poziomu z ikoną `Handshake` + linia, grayscale → kolor na hover, opis tylko przy `size='lg'`, akcent przez `--speakers-accent`, pusty stan z instrukcją | ✅   |
| Parser                          | `parseSponsorTiers`, `SponsorEntry`, `SponsorTier`, `SponsorTierSize` (`src/lib/events/sponsors.ts:32`) — odporny na śmieci (sponsor bez `name` i `logo` odpada, nieznany `size` → `'md'`)                                                                                     | ✅   |
| Edytor                          | `SponsorsEditor`, podpięty w `WidgetProperties.tsx:1669`                                                                                                                                                                                                                       | ✅   |
| Alternatywa: pas logotypów      | widget `logo-cloud` (`logos[]`, `speedSeconds`, `pauseOnHover`, `fadeEdges`, `grayscale`)                                                                                                                                                                                      | 🔵   |
| **Sponsorzy _tego_ wydarzenia** | `event-sponsors` trzyma `tiers` **wyłącznie w JSON treści widgetu** — brak pola `eventId` i trybu `'event'` (inaczej niż `speakers` z `source:'event'` i `event-countdown-card` z `mode:'event'`); w bazie brak tabeli `event_sponsors`                                        | ⛔   |

**⛔ EB-911 — tabela `event_sponsors` + tryb `source:'event'` w widgecie.**
Wzorzec do skopiowania istnieje: widget `speakers` ma pola
`source: 'manual' | 'directory' | 'event'` + `eventId` (`registry.tsx:1303`) — to
jedyny w repo wzorzec „widget zasilany danymi wskazanego wydarzenia" i on rozstrzyga
kształt rozwiązania. Zgodnie z decyzją klienta („zsynchronizowane z CRM firm")
sponsor wskazuje `crm_companies`, a nie powtarza nazwy i logo.

### 4.4 Strefa czasowa — jedna funkcja, cztery miejsca do naprawy

To jest najmniejsza zmiana z największym efektem, bo dotyczy **każdej** daty
wydarzenia na froncie.

| Miejsce                  | Co robi dziś                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EventsListView.tsx:52`  | `formatEventDate` / `dateBlockParts` / `eventTimeZone` / `DEFAULT_EVENT_TZ` — **jedyne** miejsce, gdzie data liczy się z `timeZone: row.timezone` (fallback `Europe/Warsaw`, `try/catch` na `RangeError`, SSR-safe). Funkcje **lokalne, nieeksportowane** |
| `src/lib/i18n/format.ts` | `formatDate`, `formatDateShort`, `formatDateTime` — `pl-PL` / `en-GB`, **żadna nie przyjmuje `timeZone`**                                                                                                                                                 |
| `events.$slug.tsx:341`   | dokleja `` ` (${ev.timezone})` `` jako goły tekst — bez ikony, bez konwersji                                                                                                                                                                              |
| `EventCountdownCardView` | **ignoruje** `timezone` całkowicie                                                                                                                                                                                                                        |

**⛔ EB-912 — `src/lib/events/timezone.ts`**: `EVENT_DEFAULT_TZ`,
`eventTimeZone(row)`, `formatEventDateTime(startsAt, timezone, lang, opts)`,
`tzLabel(timezone, lang)`. Potem przepiąć wszystkie cztery miejsca na jedno
źródło. Bez tego uczestnik z Brukseli widzi godzinę warszawską bez ostrzeżenia —
a to jest dokładnie ta klasa błędu, którą zrzuty referencyjne Swapcarda pokazują
(sesje z 2024 w wydarzeniu z 2025).

---

## 5. Strona główna — kolumna lewa: karta mojego profilu

### 5.1 Avatar ze wskaźnikiem online

| Element                          | Artefakt                                                                                                                                                                                                        | Stan | Uwaga                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| Avatar + zielona kropka          | `ChatAvatar` (`name`, `avatarUrl`, `online`, `size`, `to`) — `Avatar` `rounded-[6px]` + `PresenceDot` w prawym dolnym rogu, kadrowanie twarzą przez `useFaceAwarePosition`                                      | ✅   | w `people.tsx` używany dokładnie tak: `to={person.slug ? \`/author/${person.slug}\` : undefined}` |
| Sama kropka                      | `PresenceDot` (`{ online }`) — `null` gdy offline, `bg-emerald-500` + `ring-2 ring-background`                                                                                                                  | ✅   |                                                                                                   |
| Źródło stanu online              | `useOnlineUsers` (`src/lib/chat/presence.ts`) — `ReadonlySet<string>` w obrębie **tenanta**, jeden prywatny kanał `presence:<tenant>`, refcount, `TEARDOWN_GRACE_MS=2000`                                       | 🟡   | **brak zakresu per wydarzenie** — „kto jest teraz na tym wydarzeniu" wymaga osobnego kanału       |
| Brama prywatności kropki         | `notification_preferences.show_online_status` (boolean NOT NULL DEFAULT true) + RPC `chat_show_online_status`; klient bramkuje `track`, **baza egzekwuje niezależnie** (polityka INSERT na `realtime.messages`) | ✅   | wzorcowe: bramka jest w dwóch warstwach                                                           |
| Obecność per encja (alternatywa) | `PresenceIndicator` + `useEntityPresence`, kanały `presence:<tenant>:<typ>:<id>`; `PresenceEntityType` = `post \| page \| crm_lead \| conversation \| media` — **bez `event`**                                  | 🔵   | stos inicjałów, nie kropka; do „kto oglada tę sesję" trzeba dodać `'event'`/`'session'`           |

### 5.2 Dane karty (imię, stanowisko, firma) i link „Edytuj"

| Element                     | Artefakt                                                                                                                                                                                                                                                                                                           | Stan |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Tabela źródłowa             | `profiles` — **wszystkie** potrzebne kolumny są: `display_name`, `first_name`, `last_name`, `job_title`, `current_company` (+ `current_company_id` → `crm_companies`), `avatar_url`, `slug`, `specialization`, `location`, `verified_at`, `discoverable`, `hide_avatar`, `profile_view_mode`, `completeness_score` | ✅   |
| Odczyt pełny + zapis pola   | `useProfileEditor`, `profileEditorKey`, `ProfileEditorRow` — jedno zapytanie z cache (`staleTime` 5 min / `gcTime` 30 min) + `saveField()` z aktualizacją optymistyczną                                                                                                                                            | ✅   |
| Odczyt lekki do nagłówka    | `useHeaderProfile` → `HeaderProfile` — **tylko** `first_name`, `last_name`, `display_name`, `avatar_url`                                                                                                                                                                                                           | 🟡   |
| Projekcja publiczna         | widok `profiles_public` — avatar maskowany (`CASE WHEN hide_avatar THEN NULL`), bez e-maila, `security_invoker = off`                                                                                                                                                                                              | ✅   |
| Kontener karty              | `ProfileCard` + `PROFILE_CARD_DEFAULTS` + `readProfileCardStyle` (`imageSize`, `overlap`, `cardMaxWidth`, `shadow`, `socialStyle`, `socialSize`, `mobileAlign`, `animate`)                                                                                                                                         | 🟡   |
| Odznaki przy nazwisku       | `ProfileBadges`, `ProfileBadge`, `VerifiedProfileBadge`, `useBadgesForUsers`; `ProfileBadgeKind` = `verified \| expert \| staff \| contributor`                                                                                                                                                                    | ✅   |
| Miernik kompletności        | `ProfileCompletenessCard` (zasilany `profiles.completeness_score`, wagi w `src/lib/profile/completeness.ts`)                                                                                                                                                                                                       | ✅   |
| Edycja w miejscu            | `InlineText`, `InlineTextarea` (Enter/blur = zapis, Esc = anuluj; textarea: Ctrl/Cmd+Enter) — używane w `profile.index.tsx` razem z `saveField`                                                                                                                                                                    | ✅   |
| Cel linku „Edytuj"          | trasa `/profile/edit` (zakładki basic/social/expert)                                                                                                                                                                                                                                                               | ✅   |
| Najbliższy istniejący układ | blok w `ProfileLayout` (`profile.tsx:176-200`): avatar 8×8 `rounded-[6px]` + `initialsFrom` + `display_name` + etykieta członkostwa                                                                                                                                                                                | 🔵   |

Braki `ProfileCard` wobec karty ze zrzutu 4: (1) **nie ma osobnego pola „firma"** —
jest tylko `title`; (2) brak wskaźnika online; (3) brak linku „Edytuj";
(4) `clampNum(maxWidth)` ma dolny limit **480 px**, czyli geometria dużej karty
autora, nie karty w wąskiej kolumnie.

**⛔ EB-913 — `src/components/molecules/MyProfileCard.tsx`**: avatar
(`ChatAvatar` z `online`) + imię i nazwisko + `job_title` + `current_company` +
link „Edytuj" → `/profile/edit`. Dane z `useProfileEditor`, prezentacja przez
istniejące atomy. Żaden istniejący komponent nie składa tych pięciu elementów,
a dwa najbliższe układy (`profile.tsx:176-200`, `PersonCard` w `people.tsx`) są
**prywatne w plikach tras**.

**⛔ EB-914 — widget `my-profile-card`**: render `MyProfileCardWidget` z bramką
`advanced.access.auth = 'user'`. Uzasadnienie: `author-profile-card` renderuje
**tylko** dane wpisane w treść węzła (komentarz w `AuthorProfileCardWidget.tsx`:
„renderer nie wykonuje żadnych zapytań sieciowych"), a `account-link` to popover
w nagłówku, nie karta.

### 5.3 Zakładka Uczestnicy: wyszukiwanie i „Moja widoczność"

| Element                                                        | Artefakt                                                                                                                                                                                                                                                         | Stan |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Przełącznik „Moja widoczność" — stan i zapis                   | `useDiscoverable`, `useSetDiscoverable` (kolumna `profiles.discoverable`, `src/lib/chat/useDiscoverable.ts`); `onSuccess` invaliduje `['chat','people']`                                                                                                         | ✅   |
| Teksty pod przełącznikiem                                      | klucze i18n **już istnieją**: `people.discoverBannerOnTitle/Body`, `profilePrivacy.discoverableOn/Off/Hint/externalNote` — PL: „Inni zarejestrowani użytkownicy mogą Cię znaleźć i napisać do Ciebie."                                                           | ✅   |
| Gotowy banner (ikona `Eye`/`EyeOff` + tytuł + opis + `Switch`) | `DiscoverabilityBanner` — funkcja **lokalna** w `people.tsx:122-163`                                                                                                                                                                                             | 🔵   |
| Wersja „hub prywatności"                                       | `VisibilityAndContactSection` — eksportowany, ale renderuje **9 wierszy** (`discoverable`, `hide_avatar`, `expert_requests_enabled`, `allow_messages_from`, `allow_connections_from`, `read_receipts`, `typing`, `show_online_status`)                           | 🟡   |
| Nota „widoczny także poza platformą"                           | `PublicExposureNotice` + `usePublicExposure` — ekspozycja publiczna jest **niezależna** od `discoverable`, dlatego osobny odczyt                                                                                                                                 | ✅   |
| Wiersz ustawienia                                              | `SettingRow` (`label`, `hint`, `note`, `control`, `controlWidth`) + `Switch` (Radix)                                                                                                                                                                             | ✅   |
| Pole wyszukiwania osób                                         | blok w `PeopleInner` (`people.tsx:443-456` input, `:331-349` debounce 250 ms **do URL-a**) — surowy `<input type="search">` + ikona `Search`                                                                                                                     | 🔵   |
| Wyszukiwanie — RPC                                             | `search_people` (`p_query`, `p_specialization`, `p_company`, `p_job_title`, `p_location`, `p_open_to`, `p_verified_only`, `p_embedding`, `p_limit`, `p_offset`)                                                                                                  | 🟡   |
| Podpięcie + fasety                                             | `usePeopleDirectory`, `usePeopleFacets` (RPC `people_filter_options`), `PeopleFilters`, `shouldEmbedPeopleQuery` — `useInfiniteQuery`, tryb semantyczny gdy jest embedding                                                                                       | 🟡   |
| Karta osoby na liście                                          | `PersonCard` — funkcja **lokalna** (`people.tsx:202-321`): `ChatAvatar(online)` + `display_name` + `DegreeBadge` + `ProfileBadges` + „`job_title` — `current_company`" + `specialization`/`location` + intencje + `ProfileLinkButton` + `MessageOrConnectButton` | 🔵   |

**Ustalenie [P]:** zakładka „Uczestnicy" to w 90% **trasa `/people` zawężona do
wydarzenia**. Rozszerzenie to jeden parametr zakresu przekazany do `search_people`
i `people_filter_options` — a nie nowy katalog osób. Warunkiem jest jednak, żeby
„uczestnik wydarzenia" był w ogóle zapytywalny, czyli `event_rsvps` (dziś) lub
`event_people` (docelowo, dla osób bez konta).

**⛔ EB-915 — wyniesienie trzech prywatnych komponentów** z `people.tsx` do
`src/components/people/`: `PersonCard`, `DiscoverabilityBanner`, pole wyszukiwania.
Bez tego zakładka wydarzenia albo je zduplikuje, albo będzie wyglądać inaczej niż
katalog osób.

---

## 6. „AI wybrane dla Ciebie" — karuzela rekomendacji z powodem i odrzuceniem

To najbardziej zaskakujące ustalenie całego mapowania: **silnik rekomendacji osób
w NES już istnieje i jest bogatszy niż to, co widać na zrzucie 3.** Brakuje
warstwy prezentacji i jednej rzeczy w kontrakcie RPC.

### 6.1 Co działa dzisiaj [R]

| Element frontu                       | Artefakt                                                                                                                                                                                                                                                                    | Stan | Uwaga                                                                                                                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kogo pokazać (silnik)                | RPC `connection_suggestions(p_limit)` + `useConnectionSuggestions` / `ConnectionSuggestionRow`                                                                                                                                                                              | 🟡   | zwraca **dokładnie** pola karty: `user_id`, `display_name`, `avatar_url`, `job_title`, `current_company`, `specialization`, `location`, `slug`, `verified`, `mutual_count`, `shared_follows`, `shared_events`, `degree`, `bridge_*`, `open_to`, `completeness_score` |
| Przycisk `X` (odrzucenie)            | RPC `dismiss_connection_suggestion(p_user_id)` + `useDismissSuggestion`                                                                                                                                                                                                     | ✅   | trwałe ukrycie, `ON CONFLICT DO NOTHING`, walidacja tenanta                                                                                                                                                                                                          |
| Pamięć odrzuceń                      | `connection_suggestion_dismissals` — PK `(user_id, dismissed_user_id)`, CHECK `user_id <> dismissed_user_id`                                                                                                                                                                | ✅   | **RPC-only**: `REVOKE ALL` od `anon`/`authenticated`, brak polityk klienckich → odrzucony nie widzi, że go odrzucono                                                                                                                                                 |
| „Przywróć ukryte (N)"                | RPC `restore_connection_suggestions()` + `my_dismissed_suggestions_count()`                                                                                                                                                                                                 | ✅   | przycisk **już zaimplementowany** w `SuggestionsTab` (`network.tsx:587-604`)                                                                                                                                                                                         |
| Cała sekcja (karty + powód + X)      | `SuggestionsTab` — funkcja **lokalna** w `network.tsx:578-694`                                                                                                                                                                                                              | 🔵   | zachowanie 1:1 ze zrzutem (avatar, imię, stanowisko, firma, linia powodu w propsie `meta`, `X` z toastem, `aria-label`), ale: nieeksportowana, układ to `grid sm:grid-cols-2 lg:grid-cols-3` (nie pas ze strzałką), brak „Jak to działa?"                            |
| Karta jednej osoby                   | `PersonRow` — funkcja **lokalna** (`network.tsx:122`), propsy: `userId`, `displayName`, `avatarUrl`, `jobTitle`, `company`, `location`, `slug`, `verified`, `online`, `meta?`, `degree?`, `bridge?`, `highlighted`, `intents`, `children` (**slot akcji** — tam siedzi `X`) | 🔵   | slot akcji to dokładnie ten wzorzec, którego wymaga `X`                                                                                                                                                                                                              |
| Powód: 3 gotowe rodzaje              | linia `meta` z `mutual_count` / `shared_follows` / `shared_events` + klucze `network.mutual`, `network.sharedDossiers`, `network.sharedEvents` (PL i EN)                                                                                                                    | 🟡   | brak powodów „Powiązana praca" i „Podobieństwa profili" — patrz §6.3                                                                                                                                                                                                 |
| Stopień oddalenia jako uzasadnienie  | `DegreeBadge`, `ConnectionPathTrail`, `NetworkDistance`, `readDegree`/`normalizeDegree`/`toBridge`                                                                                                                                                                          | ✅   | `degree` (1/2/3+) i `bridge_id/name/slug/avatar` przychodzą **wprost** z `connection_suggestions` — do wpięcia bez zmian                                                                                                                                             |
| Klik w powód „N wspólnych kontaktów" | RPC `mutual_connections(p_user_id)` + pełna trasa `/network/mutual/$userId` (noindex)                                                                                                                                                                                       | ✅   | naturalny cel linku z powodu                                                                                                                                                                                                                                         |
| Sygnał „wspólne wydarzenia"          | `event_rsvps` jako CTE `shared_events` w `connection_suggestions` (`status IN ('going','interested')` po obu stronach)                                                                                                                                                      | ✅   | **jedyny istniejący pomost** między rekomendacją osób i wydarzeniem                                                                                                                                                                                                  |
| Sygnał „wspólne dossier"             | `eu_policy_follows` jako CTE `shared_follows`, sufit `LEAST(...,5)`, waga ×2                                                                                                                                                                                                | ✅   |                                                                                                                                                                                                                                                                      |
| Warstwa wektorowa („AI")             | `profile_embeddings` (`profile_id` PK, `embedding vector(768)`, HNSW `vector_cosine_ops`) + RPC `semantic_search_profiles`                                                                                                                                                  | 🟡   | RLS ON, `REVOKE ALL` od `anon`/`authenticated`, `GRANT ALL` tylko `service_role` — **klient nie może odczytać własnego wektora**                                                                                                                                     |
| Źródło tekstu embeddingu             | RPC `nes_profile_embedding_source(p_user_id)` — składa stanowisko, firmę, specjalizację, lokalizację, oba bio, intencje (`open_to` PL+EN), umiejętności i role z `profile_experiences`; sufit 2000 znaków                                                                   | ✅   | to jest baza powodu „Powiązana praca"                                                                                                                                                                                                                                |
| Utrzymanie wektorów w tle            | `runProfileSemanticIndexBatch`, `PROFILE_EMBEDDING_MIN_COMPLETENESS = 40`, `EMBEDDING_DIMS = 768` + RPC `profiles_needing_embeddings`, `prune_profile_embeddings`                                                                                                           | ✅   | profil poniżej 40 pkt kompletności **nie dostaje wektora** — celowo, żeby nie zaśmiecał sąsiedztwa                                                                                                                                                                   |
| Wzorzec sekcji z tokenem imienia     | widget `tailored-must-reads` (`registry.tsx:613-629`, schema `schemas.ts:3612-3658`) — token `{name}` z **wołaczem PL** (`toPlVocative`), kicker „Polecane dla ciebie", fallback dla gości, prop `audience` (`auth\|all\|guest`), limit 1-9, kolumny 1-4                    | 🔵   | wzorzec 1:1 dla sekcji AI, ale renderuje **wpisy**                                                                                                                                                                                                                   |
| Wzorzec RPC zwracającego powody      | `get_recommended_posts_v2(...)` → kolumna **`reasons text[]`** + `RecommendationReason`                                                                                                                                                                                     | 🔵   | jedyne miejsce w repo, gdzie RPC rekomendacji jawnie zwraca powody — kontrakt do skopiowania                                                                                                                                                                         |
| Wzorzec „który powód pokazać"        | `reasonBadgeKey` + `REASON_PRIORITY` (`src/components/readingList/atoms/reasonBadge.ts`) — zwraca **klucz i18n**, nieznany kod nie renderuje badge'a                                                                                                                        | 🔵   | ta sama logika, ale dla wpisów (`author\|category\|tag\|history\|fresh`)                                                                                                                                                                                             |
| Chip powodu na karcie                | `IntentChip` w trybie `readOnly` — już używany w `/people` i na karcie sugestii                                                                                                                                                                                             | ✅   | prezentacja powodu może go użyć bez zmian; brakuje tylko słownika etykiet                                                                                                                                                                                            |
| Poziomy pas przewijany               | `ClubHubRail:263`: `-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]`                                                                                                                                                                                      | 🔵   | gotowy pas; strzałka „następna strona" — wzorzec `showArrows` z `circular-carousel`                                                                                                                                                                                  |

### 6.2 Czego **nie ma** — i dlaczego to nie jest „dodanie AI"

Trzy tabele wektorowe (`post_embeddings`, `profile_embeddings`,
`club_thread_embeddings`) są czytane **wyłącznie** przez `semantic_search_*`
z wektorem zapytania podanym z zewnątrz. **Nie ma zapytania profil-do-profilu.**
To jedyna brakująca część „AI" — reszta stoi.

| Brak                                       | Zadanie                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Powód „Powiązana praca"                    | **EB-916**: zgodność firmy i specjalizacji jest już liczona w `connection_suggestions`, ale **wyłącznie w `ORDER BY`** (`CASE WHEN lower(btrim(c.current_company)) = lower(btrim(my_company)) THEN 2 ELSE 0 END`). Wersja v4 wynosi te same wyrażenia z `ORDER BY` do `SELECT` jako `company_match`, `specialization_match`, `location_match`, `intent_overlap` (boolean). **Zero nowej logiki — tylko cztery kolumny wyjściowe.** |
| Powód „Podobieństwa profili"               | **EB-917**: RPC `similar_profiles(p_limit)` SECURITY DEFINER — czyta `pe.embedding WHERE pe.profile_id = auth.uid()` i szuka sąsiadów w tym samym tenancie (`discoverable`, bez siebie). Klient **nigdy** nie widzi wektora.                                                                                                                                                                                                       |
| Jeden RPC sekcji                           | **EB-918**: `ai_people_for_you(p_event_id uuid DEFAULT NULL, p_limit int DEFAULT 12)` → pola karty + `reasons text[]` + `similarity real`. Blend sygnałów grafowych i wektorowych **liczy baza** (lekcja z `search_people` v3), odsiew przez `connection_suggestion_dismissals`.                                                                                                                                                   |
| Zawężenie do jednego wydarzenia            | część **EB-918**: `p_event_id` → `EXISTS (SELECT 1 FROM event_rsvps r WHERE r.event_id = p_event_id AND r.user_id = c.id AND r.status IN ('going','interested'))`                                                                                                                                                                                                                                                                  |
| Słownik etykiet powodów                    | **EB-919**: `src/lib/network/peopleReason.ts` z `PEOPLE_REASON_PRIORITY = ['work','profileSimilarity','mutual','sharedEvents','sharedDossiers']` + klucze `network.aiReasons.*` (PL+EN, pod bramkę parytetu i18n)                                                                                                                                                                                                                  |
| Karuzela zasilana z RPC                    | **EB-920**: `AiPeopleCarousel` — wszystkie trzy karuzele buildera mają `items` **wpisywane ręcznie**, żadna nie ma źródła dynamicznego; pas z `ClubHubRail:263` + strzałka z `circular-carousel`                                                                                                                                                                                                                                   |
| Widget buildera dla osób                   | **EB-921**: typ `ai-people-for-you`. Uzasadnienie: w 96 wpisach rejestru **nie ma żadnego** widgetu renderującego osoby z RPC (`speakers` czyta prelegentów, `tailored-must-reads` wpisy); brak też `people`/`members`/`participants`/`attendees`/`directory`                                                                                                                                                                      |
| **Publiczna lista uczestników wydarzenia** | **EB-922**: brak RPC listującego uczestników. `events.$slug.tsx` czyta `event_rsvps` **tylko dla siebie** (RLS „rsvps owner read", `:96-112`) plus liczniki agregatowe. Potrzebne `event_attendees(p_event_id, p_limit, p_offset)` SECURITY DEFINER — tylko profile `discoverable`, `status IN ('going','interested')`                                                                                                             |
| Link „Jak to działa?"                      | **EB-923**: wyjaśnienie istnieje jako **akapit inline** (`network.suggestionsHint`: „Sugestie łączą wspólne kontakty, wspólne dossier i wydarzenia oraz afiniczność profilu w Twojej organizacji"). Do popovera + treść: co wchodzi do rankingu, że `X` jest trwały i odwracalny, że wektory liczą się od 40 pkt kompletności                                                                                                      |
| Sekcja AI w panelu                         | **EB-924**: `PersonalizedSettings` ma dokładnie trzy sekcje (`saved`/`followed`/`recommended`) — wszystkie dla wpisów; dodać `sections.recommendedPeople` + czwartą zakładkę w `/admin/personalized` (klucz `personalized_system`, `deepMerge` ignoruje stare wiersze)                                                                                                                                                             |
| Pomiar skuteczności                        | **EB-925** (niski priorytet): `related_post_clicks` mierzy tylko wpisy; odrzucenia osób nie są raportowane w żadnym panelu. Wzorzec pary `related_post_clicks` / `related_posts_signals(_since_days)`                                                                                                                                                                                                                              |

### 6.3 Ostrzeżenie [P] — nazwa „AI" musi być prawdziwa

Zrzut 3 pokazuje etykietę „AI wybrane dla Ciebie". Dziś `connection_suggestions`
to **sygnały grafowe** (wspólne kontakty, dossier, wydarzenia) plus dopasowanie
firmy w `ORDER BY` — to jest dobra rekomendacja, ale **nie jest AI**. Wektory
(`profile_embeddings`) istnieją i są utrzymywane, ale **nie są wejściem do tej
sekcji**.

Dwie uczciwe drogi: albo nazwać sekcję tym, czym jest („Osoby, które warto poznać"),
albo domknąć EB-917 + EB-918 i wtedy nazwa „AI" ma pokrycie. Sekcja z etykietą
„AI", która pod spodem liczy `count(*)` wspólnych znajomych, jest tą samą klasą
nieuczciwości co kafel `48 820 Registered` przy wydarzeniu z 21 osobami
(`ANALIZA_BRAKUJACYCH_EKRANOW` §9.1) — tylko trudniejsza do wykrycia.

---

## 7. Paczka 2 — strony encji: firma, prelegenci, partnerzy

### 7.1 Strona firmy / wystawcy (zrzut 6) — **największa luka danych w całym froncie**

Decyzja klienta: wystawcy „zsynchronizowane z CRM firm", bez osobnego modułu.
Weryfikacja pokazuje, że to rozstrzygnięcie ma jeden twardy warunek, dziś niespełniony.

| Element frontu                                | Artefakt                                                                                                                                                                                                                                                     | Stan | Uwaga                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------- |
| Dane firmy: nazwa, logo, opis, branża, miasto | `member_organizations` — ma **wszystko**: `name`, `slug`, `description`, `sector`, `city`, `country`, `logo_h_light`, `logo_h_dark`, `logo_v_light`, `logo_v_dark`, `logo_favicon`, `brand_primary`, `brand_accent`, `brand_ink`, `crm_company_id`, `status` | 🟡   | zestaw pól jest kompletny, **ale niedostępny publicznie**                         |
| Dostęp do tych danych                         | RLS: `orgs admin all` (staff) + `orgs seat read` — `EXISTS (SELECT 1 FROM organization_seats os WHERE os.org_id = … AND os.user_id = auth.uid())`                                                                                                            | ⛔   | czyta **tylko członek tej organizacji**; anonim i inny uczestnik wydarzenia — nic |
| Alternatywne źródło                           | `crm_companies` — polityka `crm_companies_staff_read`; komentarz w `src/lib/queries/public.ts:38-39` mówi to wprost: „tamta tabela jest czytelna wyłącznie dla stafu CRM, więc dla anonimowego czytelnika join zwracałby NULL"                               | ⛔   | CRM **nie jest** i nie może być źródłem publicznym                                |
| Trasa publiczna firmy                         | `ls src/routes \| grep -i compan` → **tylko** `admin.companies.*` i `admin.organizations.*`; publicznej trasy firmy nie ma                                                                                                                                   | ⛔   |                                                                                   |
| Zakładka (bookmark)                           | `user_bookmarks` + `useBookmarks` / `useToggleBookmark` + `SaveArticleButton`                                                                                                                                                                                | 🟡   | CHECK: `entity_type IN ('post','page')` — patrz §9.3                              |
| „Możesz także lubić"                          | silnik powiązanych: `related_posts_config` (wagi: `weight_author`, `weight_categories`, `weight_tags`, `weight_popularity`, …), `related_post_clicks`, RPC `related_posts_signals`                                                                           | 🔵   | cały silnik dotyczy **wpisów**; dla firm nie ma ani wag, ani telemetrii           |

**⛔ EB-926 — publiczna projekcja organizacji.** Wzorzec jest w repo i jest
sprawdzony: widok `profiles_public` (wąska projekcja `profiles`, maskowanie
`hide_avatar`, `security_invoker = off`). Analogicznie `member_organizations_public`:
`id`, `slug`, `name`, `description`, `sector`, `city`, `country`, logotypy, kolory
marki — **bez** `contact_email`, `seats_*`, `provider_subscription_id`,
`crm_company_id`, `note`. Bez tego widoku strona firmy albo nie powstanie, albo
powstanie na danych, których nie wolno pokazać.

**⛔ EB-927 — `event_companies`**: która firma jest na **którym** wydarzeniu i w jakiej
roli (sponsor / partner / wystawca). Dziś nie ma żadnego wiązania firmy z wydarzeniem
(§4.3). Ta tabela jest wspólnym warunkiem dla strony firmy, listy partnerów (§7.3)
i sponsorów w kolumnie środkowej.

### 7.2 Prelegenci — siatka (zrzut 7): **gotowe**

| Element | Artefakt | Stan |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| Dane karty | RPC `get_public_speakers(p_event_id, p_limit, p_user_ids)` → `display_name`, `avatar_url`, `job_title`, `company`, `slug`, `sort_order`, `is_expert`, `has_speaker_profile`, `headline_pl/en`, `topics_pl/en`, `rating`, `reviews_count`, `talks_count` | ✅ |
| Widget siatki | `speakers` z polami `source: 'manual' \| 'directory' \| 'event'` + `eventId` | ✅ |
| Kolejność | `event_speakers.sort_order` (przenumerowanie całej listy — `EventSpeakersManager.tsx:78-94`) | ✅ |
| Cel linku z karty | `/author/$slug` | ✅ |
| Odznaki | `ProfileBadges`, `is_expert` z `profile_badges.badge='expert'` | ✅ |
| Grupowanie po roli („Wykładowcy") | ⛔ — `event_speakers` nie ma `role_id` | ⛔ | → `ANALIZA_BRAKUJACYCH_EKRANOW` §6 (EB dla `event_speaker_roles`) |

**To jedyny ekran z paczki 2, który da się złożyć dziś, bez migracji.**

### 7.3 Partnerzy — lista (zrzut 8)

| Element              | Artefakt                       | Stan | Uwaga                                                                    |
| -------------------- | ------------------------------ | ---- | ------------------------------------------------------------------------ |
| Lista logotypów      | widget `event-sponsors` (§4.3) | ✅   | `size='sm'` daje siatkę 3/4/6 kolumn — dokładnie układ ze zrzutu         |
| Nazwa pod logotypem  | `SponsorEntry.name`            | ✅   |                                                                          |
| Zakładka per partner | `user_bookmarks`               | ⛔   | wymaga `entity_type='company'` (§9.3) **i** encji firmy (EB-926, EB-927) |
| Źródło = wydarzenie  | treść widgetu, nie baza        | ⛔   | EB-911 + EB-927                                                          |

---

## 8. Paczka 2 — strona sesji (zrzut 9)

Cały ekran stoi na jednym warunku: **tabela sesji**. Dziś sesja nie jest encją
(`ANALIZA_BRAKUJACYCH_EKRANOW` §5.4 — agenda ma typowany kontrakt w
`src/lib/events/schedule.ts`, ale żyje w treści widgetu). Poniżej co z elementów
tej strony ma źródło **niezależnie** od tego warunku.

| Element frontu                          | Artefakt / stan                                                                                                                                   | Stan | Uwaga                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Tytuł, opis, czas, sala sesji           | `ScheduleSession` (`schedule.ts:30-43`) — **12 pól**, w tym `room` i `kind: "session" \| "break"`                                                 | 🟡   | kontrakt jest; brak tabeli i adresu URL sesji                                                                                              |
| **„Przekaż swoją opinię" — 5 gwiazdek** | `speaker_profiles.rating numeric(2,1) CHECK (0..5)` + `reviews_count integer CHECK (>=0)` — kolumny **istnieją**, `get_public_speakers` je zwraca | ⛔   | **nic ich nie zapisuje** — grep na `expert_review\|speaker_review\|session_feedback\|event_feedback` = **0 trafień**. To liczba bez źródła |
| Najbliższy istniejący mechanizm opinii  | `post_feedback` — `{ post_id, helpful boolean, voter_hash, tenant_id, created_at }`                                                               | 🔵   | **binarny** („pomocne / nie"), anonimizowany przez `voter_hash`; nie 5-gwiazdkowy i nie dla sesji                                          |
| „poufne" (opinia nie jest publiczna)    | wzorzec `voter_hash` w `post_feedback` (brak `user_id`) + `chatham_house` na wydarzeniu                                                           | 🔵   | wzorzec anonimizacji jest, semantyka „poufne" wymaga decyzji: anonimowa czy tylko nieujawniana prelegentowi                                |
| „Wykładowcy" sesji                      | `ScheduleSession.speakers: ScheduleSpeakerRef[]` (z `userId` wiążącym do profilu)                                                                 | 🟡   | policzalne **w kliencie** przez `parseScheduleDays`, **nie w SQL**                                                                         |
| „Zarejestrowani uczestnicy" sesji       | `event_rsvps` jest **na poziomie wydarzenia**; rejestracji na sesję nie ma                                                                        | ⛔   | wymaga `event_session_registrations`                                                                                                       |
| Widoczność tej listy                    | RLS „rsvps owner read" — uczestnik widzi **tylko swój** wiersz; staff widzi wszystko (`rsvps staff read`)                                         | ⛔   | publiczna lista wymaga RPC SECURITY DEFINER z filtrem `discoverable` — to samo EB-922 co dla zakładki Uczestnicy                           |
| „Możesz także lubić" (inne sesje)       | silnik `related_posts_*` (wagi + telemetria + panel `/admin/related-posts`)                                                                       | 🔵   | wzorzec kompletny, ale wyłącznie dla wpisów                                                                                                |
| **Pływająca „Dyskusja na żywo"**        | `events.conversation_id` → `conversations` (FK) + RPC `create_event_group(p_event_id)`; czat ma TTL wiadomości (`default_message_ttl_seconds`)    | 🟡   | wątek jest **na poziomie wydarzenia**, nie sesji; brak `event_sessions.conversation_id`                                                    |
| Alternatywa: Q&A                        | `qa_sessions.event_id` (nullable) + `qa_questions.status` — moderowane pytania z upvote                                                           | 🟡   | to samo: wiązanie z wydarzeniem, nie z sesją                                                                                               |
| Wzorzec pływającego panelu              | `FloatingShareBar` (`src/components/share/FloatingShareBar.tsx`) — już używa `user_bookmarks`                                                     | 🔵   | gotowy wzorzec elementu pływającego przy treści                                                                                            |

**⛔ EB-928 — `event_session_feedback`**: `{ session_id, user_id, rating smallint CHECK (1..5), comment text, created_at }`
z `UNIQUE (session_id, user_id)`. Warunek RODO: opinia jest **poufna wobec
prelegenta** — prelegent widzi wyłącznie agregat (`avg`, `count`), nigdy wiersz.
To rozstrzyga też, skąd wreszcie wziąć `speaker_profiles.rating`: z agregatu
tej tabeli, przez trigger albo `MATERIALIZED VIEW` — dziś ta kolumna jest
obietnicą bez pokrycia.

---

## 9. Paczka 2 — „Mój profil / Moje kontakty / Mój harmonogram / Moje zakładki" (zrzut 10)

### 9.1 Cztery sekcje — trzy z nich istnieją jako trasy

| Sekcja frontu       | Artefakt                                                                                                                                                                                                                                 | Stan |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Mój profil          | `/profile` + `/profile/edit` (+ `ProfileNav`, `ProfileLayout` z sidebarem)                                                                                                                                                               | ✅   |
| Moje kontakty       | `/network` (zakładki), `user_connections` (`requester_id`, `addressee_id`, `status`, `message`, `responded_at`) — **zero grantów klienckich**, wyłącznie przez RPC z `20260717123000_connections_network.sql`; `/network/mutual/$userId` | ✅   |
| Moje zakładki       | `/profile/bookmarks` — zakładki (tabs) z licznikami, obsługa treści usuniętych („niedostępne" + sprzątnięcie), `ListHydrationNotice`                                                                                                     | ✅   |
| **Mój harmonogram** | brak trasy; `AddToCalendar` istnieje jako komponent na stronie wydarzenia                                                                                                                                                                | ⛔   |

### 9.2 Widok Lista / Kalendarz — wzorzec jest wzorcowy

`ClubCalendar` (`src/components/clubs/organisms/ClubCalendar.tsx`) to
**siatka miesiąca + agenda obok**, z uzasadnieniem decyzji zapisanym w kodzie:

> „DWA WIDOKI NA RAZ, i to jest decyzja, nie przypadek. Siatka odpowiada na pytanie
> »jak gęsty jest ten miesiąc«, agenda — »co konkretnie mnie czeka«."
> „TYDZIEŃ ZACZYNA SIĘ W PONIEDZIAŁEK. Serwis jest europejski w obu językach."
> „ZAKRES ZAPYTANIA obejmuje CAŁY widoczny miesiąc plus horyzont agendy, więc
> przewijanie miesięcy to nowe zapytanie (klucz zawiera zakres), a nie filtr po
> stronie klienta na niepełnych danych."

Te trzy decyzje obowiązują też w harmonogramie uczestnika — nie ma powodu ich
podważać. Komponent jest jednak **przypisany klubowi** (`ClubEventForm`, uprawnienia
moderatora, trasy klubu), więc: 🔵 **wzorzec**, nie reuse.

**⛔ EB-929 — `/profile/schedule`** („Mój harmonogram"): źródło = `event_rsvps`
(`status IN ('going','interested')`) ⨝ `events` + `meeting_bookings` ⨝ `meeting_slots`
(`slot.event_id`) + sesje, gdy powstaną. Przełącznik Lista / Kalendarz na wzór
`ClubCalendar` po wyniesieniu siatki do `src/components/calendar/`.

### 9.3 „Moje zakładki" — jedna migracja odblokowuje cztery ekrany

| Element          | Stan faktyczny                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tabela           | `user_bookmarks` = `{ id, user_id, tenant_id, entity_type, entity_id, created_at }`, `UNIQUE (user_id, entity_type, entity_id)`                                                                                                                                       |
| **Ograniczenie** | `CHECK (entity_type IN ('post','page'))` — `20260601055702_…:83`                                                                                                                                                                                                      |
| RLS              | trzy polityki właściciela: `select` / `insert` / `delete` na `user_id = auth.uid()`; brak `update` (zakładki się nie edytuje)                                                                                                                                         |
| Indeks           | `idx_user_bookmarks_user(user_id, created_at DESC)`                                                                                                                                                                                                                   |
| Kontrakt TS      | `BookmarkEntityType = "post" \| "page"` (`src/hooks/useBookmarks.ts:5`)                                                                                                                                                                                               |
| Konsumenci       | `useBookmarks`, `useToggleBookmark`, `useSaveArticle`, `SaveArticleButton`, `FloatingShareBar`, `SavedSection`, `/profile/bookmarks`, `/admin/personalized`, eksport profilu (`src/lib/profile/export.functions.ts`), scalanie personalizacji gościa (`anonMerge.ts`) |

**⛔ EB-930 — rozszerzenie `entity_type`** o `'person'`, `'company'`, `'session'`,
`'event'`: jedna migracja CHECK-a + rozszerzenie unii TS + gałęzie hydratacji
w `/profile/bookmarks`. To odblokowuje zakładki na stronie firmy (zrzut 6), liście
partnerów (zrzut 8), stronie osoby (zrzut 4) i sesji (zrzut 9) — **cztery ekrany
z jednej zmiany**. Uwaga: `user_bookmarks.entity_id` nie ma FK (celowo, bo encja
jest polimorficzna), więc gałąź „niedostępne" w `/profile/bookmarks` musi obsłużyć
nowe typy tak samo jak dziś obsługuje usunięte wpisy.

### 9.4 „Strefa czasowa i format" — ustawienia, których **nie ma**

| Element                    | Stan faktyczny                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Strefa czasowa użytkownika | ⛔ kolumna `timezone` istnieje **wyłącznie** na `events` (i w zwrotach RPC eventowych); `profiles` jej nie ma          |
| Format daty / 12h vs 24h   | ⛔ brak jakiegokolwiek ustawienia; `src/lib/i18n/format.ts` wiąże format z **językiem** (`pl-PL` / `en-GB`)            |
| Język interfejsu           | ✅ istnieje (i18n, `uiLang`)                                                                                           |
| Preferencje powiadomień    | ✅ `notification_preferences` (m.in. `show_online_status`, `enabled_club`) — wzorzec tabeli preferencji per użytkownik |

**⛔ EB-931 — `profiles.timezone text` + `profiles.time_format text`** (`'24h'`/`'12h'`),
z fallbackiem `Intl.DateTimeFormat().resolvedOptions().timeZone` przy pierwszym
zapisie. Bez tego „Strefa czasowa i format" nie ma czego pokazać — a w połączeniu
z EB-912 (§4.4) to ta sama praca: **jedno źródło prawdy o czasie**, po jednej stronie
wydarzenie (`events.timezone`), po drugiej uczestnik (`profiles.timezone`).

### 9.5 „Połącz Kalendarz Google" — dwa różne mechanizmy, nie jeden

| Co to może znaczyć                            | Stan faktyczny                                                                                                                                                                                                                                                                                                                                | Stan |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| **Dodaj to wydarzenie** do kalendarza         | `src/lib/community/calendar.ts` — ICS (RFC 5545) + głębokie linki Google/Outlook; `DTSTART`/`DTEND` w UTC (bez `VTIMEZONE` — klient przelicza), **stabilny UID** (`id@host`, ponowny import aktualizuje wpis), escaping i łamanie linii po **75 oktetach** (nie znakach — polskie diakrytyki nie mogą się rozciąć); komponent `AddToCalendar` | ✅   |
| **Dwukierunkowa synchronizacja** konta Google | `integration_endpoints.integration` dopuszcza `'gcal'` — ale to **integracja wychodząca tenanta** (nasz serwer → cudzy kalendarz), nie połączenie konta uczestnika; brak OAuth per użytkownik (0 trafień na `oauth` w typach)                                                                                                                 | ⛔   |

**Ustalenie [P]:** przycisk „Połącz Kalendarz Google" jest **dwuznaczny** i trzeba
go rozstrzygnąć przed implementacją. Wersja pierwsza jest **gotowa dziś** i pokrywa
90% potrzeby („mam to w kalendarzu"). Wersja druga to OAuth per użytkownik, tokeny
odświeżające w Vault, obsługa odwołania zgody i synchronizacja różnicowa — czyli
osobny projekt, nie przycisk. Rekomendacja: etykieta „Dodaj do kalendarza
(Google / Outlook / .ics)" i istniejący `AddToCalendar`; synchronizacja konta jako
odrębna decyzja.

---

## 10. Strona osoby (zrzut 4) — u nas **bogatsza** niż na zrzucie

To drugi po sponsorach obszar, w którym NES ma więcej niż front referencyjny.
Publiczna strona osoby (`/author/$slug` → `ExpertHubPage`) jest w pełni
konfigurowalna, ma **edycję inline z publicznej strony** i jedno RPC na całość.

### 10.1 Szkielet strony — istnieje i jest konfigurowalny [R]

| Element                               | Artefakt                                                                                                                                                                                           | Stan |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Trasa publiczna                       | `/author/$slug` → `ExpertHubPage` (slug **albo** UUID)                                                                                                                                             | 🟡   |
| Dane jednym zapytaniem                | RPC `get_expert_hub(_slug_or_id)` → jsonb; klient `fetchExpertHubFromRpc`, `expertHubQueryOptions`                                                                                                 | 🟡   |
| Katalog sekcji                        | `EXPERT_SECTIONS` = **10 sekcji**: `hero_cover`, `expertise_bar`, `details`, `social_row`, `contact_card`, `media_mentions`, `podcast_strip`, `materials`, `cv`, `programs`                        | ✅   |
| Kolejność i widoczność sekcji         | `ExpertLayoutSettings`: `section_order` + `show_*` per sekcja + `DEFAULT_EXPERT_SECTION_ORDER`; `visibleExpertSections()`                                                                          | ✅   |
| Nadpisanie per osoba                  | `author_profiles.layout_overrides` scalane przez `mergeExpertLayout`                                                                                                                               | ✅   |
| Presety wizualne                      | presety z `heroKind` (`card` / `editorial` / …), `sidebar`, `hasCover`, `centeredContent`                                                                                                          | ✅   |
| Kolory i skala typografii             | `hero_bg_color(_dark)`, `hero_text_color(_dark)`, `accent_color(_dark)`, `bio_bullet_color(_dark)`, `name_size_base/lg`, `role_size_base/lg`, `max_width`                                          | ✅   |
| CSS w zasięgu                         | `expertLayoutCssVars`, `expertLayoutScopeCss(scopeId, settings)`                                                                                                                                   | ✅   |
| **Edycja inline z publicznej strony** | `ExpertLayoutInlineEditor` (lazy) montowany na `/author/$slug` za bramką `canEditLayout` (właściciel profilu **albo** admin tenanta), `:576`; `useSaveExpertLayoutOverrides`, `overridesSignature` | ✅   |

To jest jedyne w repo miejsce, gdzie **publiczna** strona ma tryb edycji — czyli
gotowy precedens dla „Edytuj wydarzenie" / „Edytuj tę stronę" z §3.

### 10.2 Sekcje ze zrzutu 4 — mapowanie 1:1

| Sekcja frontu                                | Artefakt                                                                                                                                                                                                          | Stan | Uwaga                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| „O mnie"                                     | `ExpertSectionRenderer` case `"details"`: nagłówek + ikona `BookOpen` + `full_bio_{lang} \|\| bio_{lang}`, `htmlToPlainText`, `whitespace-pre-line`                                                               | ✅   | widoczność przez `isSectionVisible(settings, "details")`                                                                                                                                 |
| Bio jako punkty pod nazwiskiem               | `ExpertLayoutHero` — rozbija bio na **max 5 punktów** (linie lub zdania), `VerifiedProfileBadge`, linia „`job_title` · `company`", slot `action` na przyciski sieci                                               | ✅   |                                                                                                                                                                                          |
| „Media społecznościowe"                      | `SocialRow` — obsługuje **dokładnie**: `website`, `linkedin`, `x` (z `twitter_url`), `email` (mailto) + opcjonalny blok `media_contact_email`/`media_contact_phone`                                               | 🟡   | **nie czyta** `facebook`/`instagram`/`spotify` ani `author_profiles.custom_socials`; ikony przez `BrandIcon` z aliasami z `/admin/ikony`                                                 |
| Blok „Media społecznościowe" z placeholderem | `ExpertSectionRenderer` case `"social_row"` — nagłówek + ikona `Layers`, znacznik „placeholder" gdy brak danych (**tylko w trybie podglądu**)                                                                     | ✅   | wzorcowe: puste dane nie udają treści na produkcji                                                                                                                                       |
| „Dane kontaktowe"                            | `ExpertSectionRenderer` case `"contact_card"` — dwa pola: `contact_email` + `website_url`                                                                                                                         | 🟡   | w praktyce publicznie zostaje **tylko WWW**, bo `contact_email` nie wychodzi z `get_expert_hub`                                                                                          |
| Telefon w kontakcie                          | `ContactInline` **już obsługuje** telefon (czyta `(expert as {phone?}).phone`, renderuje `tel:`)                                                                                                                  | 🟡   | ale `buildExpertProfile` (`src/lib/experts/normalize.ts:87-121`) **nie mapuje** pola `phone`, a `author_profiles.phone` jest odcięty od projekcji publicznej → telefon jest zawsze pusty |
| Zachęta „Dodaj swój numer telefonu"          | `InlineText` z propem `emptyLabel` — wzorzec **już działa** dla telefonu na `/profile` (`profile.index.tsx:~481-500`)                                                                                             | ✅   |                                                                                                                                                                                          |
| „Występuje na" (wydarzenia osoby)            | `speakerEngagementsQueryOptions` + `fetchSpeakerEngagements` + `SpeakerEngagement`; oraz `speaker_events` w payloadzie `get_expert_hub` → `eventRowToMaterial` → `ExpertMaterialsExplorer` (filtr `kind="event"`) | 🟡   | złączenie **klienckie**: `event_speakers` → `events(status='published')`, `limit 8`, **bez `ends_at`** w selekcie; zwraca wydarzenia, nie sesje                                          |
| Render wiersza „Występuje na"                | `EngagementRow` — funkcja **lokalna** w `SpeakerProfileDialog` (ikona `CalendarClock`, data `dateStyle:'long' timeStyle:'short'`, `MapPin`, link `/events/{slug}`, podział upcoming/past)                         | 🔵   |                                                                                                                                                                                          |
| „Jest członkiem" — prezentacja               | `PostOrganizationCard` (logo 44×44 w ramce, fallback `Building2`, nazwa, link)                                                                                                                                    | 🔵   | czyta **migawkę z wpisu** (`organization_name`/`organization_logo_url`/`organization_website`), nie relację osoba→organizacja                                                            |
| „Jest członkiem" — dane                      | `profiles.current_company_id` → `crm_companies` (`name`, `logo_url`, `website`, `city`, `country`) — relacja i logo **istnieją**                                                                                  | ⛔   | `crm_companies` jest **staff-only**; `CompanyPickerDialog` celowo chodzi po RPC, nie po tabeli → publicznie zostaje goły tekst `company`                                                 |
| „Jest członkiem" — B2B                       | `member_organizations` + `organization_seats` + RPC `my_organization()`                                                                                                                                           | 🟡   | `my_organization()` zwraca dane **tylko dla wywołującego** — nie nadaje się do cudzego profilu (→ EB-926)                                                                                |
| Zakładka przy osobie                         | `SaveArticleButton` + `useSaveArticle` + `user_bookmarks`                                                                                                                                                         | ⛔   | CHECK `entity_type IN ('post','page')` → EB-930 (§9.3)                                                                                                                                   |

### 10.3 Elementy prelegenta gotowe do reuse [R]

| Artefakt                             | Co robi                                                                                                                                                                                                                           | Stan |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `SpeakerAvatar`                      | rozmiary `sm/md/lg/xl`, `rounded-[6px]` (spec produktu), fallback = inicjały, `OptimizedImage`                                                                                                                                    | ✅   |
| `SpeakerChip`                        | trzy semantyki: `button` (otwiera dialog), `AppLink` (href), statyczny `span`; prop `trailing` na odznakę                                                                                                                         | ✅   |
| `SpeakerStars`                       | 0–5 gwiazdek, kolor z `--speakers-accent` z fallbackiem `--brand`                                                                                                                                                                 | ✅   |
| `SpeakerProfileDialog`               | awatar, nazwisko, odznaka „Ekspert", headline, „`job_title` · `company`", języki, **3 statystyki** (`talks_count` / `rating` + `SpeakerStars` / `reviews_count`), bio, chipy tematów, lista wystąpień, link „Zobacz pełny profil" | 🟡   |
| `EventSpeakersSection`               | `speakersQueryOptions({source:"event", eventId, limit:50})` → siatka `SpeakerChip` → klik otwiera dialog; odznaka `ShieldCheck` dla `is_expert`; użyta w `events.$slug.tsx:383`                                                   | ✅   |
| `speakerProfileQueryOptions(userId)` | pojedyncza osoba (`p_user_ids=[id]`, `limit 1`), `edgeTtlCache` 60 s, `staleTime` 2 min — **gotowe źródło dla strony osoby**                                                                                                      | ✅   |

**Uwaga wiążąca:** `SpeakerStars` i trzy statystyki w dialogu pokazują
`speaker_profiles.rating` / `reviews_count` — kolumny, których **nic nie zapisuje**
(§8, EB-928). Dziś na stronie prelegenta świecą się więc gwiazdki liczone z zera.
To jest dokładnie zakazany wzorzec z `ANALIZA_BRAKUJACYCH_EKRANOW` §9.1 („kafel
bez rzeczywistego źródła") — i trzeba to rozstrzygnąć albo przez EB-928 (źródło),
albo przez ukrycie sekcji, dopóki źródła nie ma.

### 10.4 Czego brakuje na stronie osoby w kontekście wydarzenia

| Brak                                  | Zadanie                                                                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kontekst wydarzenia na stronie osoby  | **EB-932**: `/author/$slug` nie wie, że osoba jest prelegentem **tego** wydarzenia — brak górnego menu wydarzenia i breadcrumbu „← wróć do wydarzenia". Rozwiązanie: parametr wyszukiwania `?event=<slug>` + gałąź chrome, bez duplikowania trasy |
| Telefon i pełny kontakt publicznie    | **EB-933**: dołożyć `phone` do `buildExpertProfile` i do projekcji `get_expert_hub`, z jawną zgodą osoby (`show_phone` w `layout_overrides`) — `ContactInline` już umie to wyrenderować                                                           |
| Sieci społecznościowe poza LinkedIn/X | **EB-934**: `SocialRow` czyta 4 pola; `author_profiles.custom_socials` istnieje i nie jest używane                                                                                                                                                |
| Karta organizacji na profilu          | **EB-935**: `PostOrganizationCard` jako wzorzec + `member_organizations_public` (EB-926) jako źródło                                                                                                                                              |
| `ends_at` w „Występuje na"            | **EB-936** (drobne): dołożyć `ends_at` do selektu w `fetchSpeakerEngagements`, żeby dało się pokazać „od–do" zamiast tylko godziny startu                                                                                                         |

---

## 11. Prawa kolumna (baner z CTA) i pasek zakładek

### 11.1 System reklamowy — kompletny, brakuje **dwóch** rzeczy

| Element frontu | Artefakt | Stan |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kreacja (pionowy baner 300×600) | `ad_slots`: `kind` (`html`/`script`/`image`), `image_url`, `image_link`, `image_alt`, `width`, `height`, `requires_consent`, `targeting`, `status` | ✅ |
| Pozycja „prawa kolumna" | enum `ad_position` wariant **`sidebar`** + `AD_POSITION_LABEL_KEYS['sidebar']` | ✅ |
| Render strefy | `<AdZone position="sidebar" pageType="all" pageId={event.id} limit={1} />` — **bez żadnych zmian w kodzie strefy** | ✅ |
| Render kreacji + zliczanie | `AdSlotView` (memo); `kind='image'` → `<img>` w `<a target="_blank" rel="sponsored noopener noreferrer">`; `html`/`script` → `SandboxedAdFrame` | ✅ |
| Bezpieczny HTML z własnym CTA | `SandboxedAdFrame` — iframe `sandbox` **bez** `allow-same-origin`, prop `onEngage` | ✅ |
| Bramka zgody marketingowej | `useMarketingConsent()` + `ad_slots.requires_consent` → `AdContainer state="blocked"` z `t('ads.consentBlocked')`; zapis: `localStorage 'consent:v2'` + cookie + `profiles.prefs.consent` + rejestr `user_consents`; GPC honorowany | ✅ |
| Zero CLS (rezerwacja miejsca) | `AdContainer` (`role="complementary"`, `data-ad-position`, `data-ad-state`) + `reserveStyle()`; przy podanych `width`+`height` rezerwacja przez `aspect-ratio` — dla 300×600 **działa poprawnie** | ✅ |
| Leniwe ładowanie (nie konkuruje z LCP) | `useDeferredAd({ rootMargin, idleTimeout })` — dwie bramki: idle po pierwszym paincie + `IntersectionObserver` z `rootMargin` 200 px | ✅ |
| Telemetria | `beaconAdEvent('impression'\|'click', slotId, placementId)` → `POST /api/public/ad-event` → `ad_events` (`kind CHECK IN ('impression','click')`, `path`) | ✅ |
| Baner jako widget w dowolnej kolumnie | widget `ad-slot` (`defaults { slotId: '' }`) → `AdSlotById` | 🟡 | `AdSlotById` buduje syntetyczny placement z **zaszytym** `position:'top_of_post'` → rezerwacja liczy się jak dla `top_of_post` (250 px), nie dla skyscrapera |
| Wybór kreacji do emisji | `useAdPlacements` + `fetchPlacements`: `.eq(position)` + `.in(page_type, ['all', pageType])` + `.eq(active,true)` + `.eq(slot.status,'active')` + okno `starts_at`/`ends_at` + `.order(sort_order)`, potem klientowo `page_id` i `targeting` | ✅ |
| Przypięcie do konkretnej encji | `ad_placements.page_id` (uuid, **bez FK**) — honorowane przez `fetchPlacements` | 🟡 |

Dwa braki, oba drobne:

**⛔ EB-937 — `ad_page_type` bez wariantu `'event'`.** Enum ma 8 wartości
(`all`, `home`, `post`, `page`, `category`, `tag`, `archive`, `search`).
Bez `'event'` baner na stronie wydarzenia można emitować tylko jako `page_type='all'`,
czyli wszędzie. Dodatkowo `adPageTypeForLocation` **nie zna** `/events/*` i zwraca
`'all'`. Zakres: `ALTER TYPE` + regeneracja typów + `AdPageType` i
`AD_PAGE_TYPE_LABEL_KEYS` w `src/lib/ads/types.ts` + gałąź w `pageType.ts`.

**⛔ EB-938 — brak pola `page_id` w formularzu `/admin/ads`.** Kolumna działa,
ale redaktor nie ma jak wskazać wydarzenia: `admin.ads.tsx:65` ustawia w draftcie
`page_id: null` i to jedyne wystąpienie tego pola w pliku. Bez tego „baner tego
wydarzenia" jest nieosiągalny z panelu.

Opcjonalnie **EB-939**: `ad_slots.cta_label_pl/_en` — dziś kreacja graficzna jest
klikalna **w całości** i nie ma kolumny na tekst przycisku „Dowiedz się więcej";
alternatywa bez migracji to `kind='html'` w izolowanym iframe.
Oraz **EB-940**: konwencja `config` dla `position='sidebar'`
(`{ sticky?: boolean, offset_top?: number }`) — udokumentowane klucze istnieją
tylko dla `mid_post`, `in_feed` i `footer_slideup`.

### 11.2 Prawa kolumna jako kontener

| Wzorzec                      | Artefakt                                                                                                                                                                                  | Stan |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Sidebar archiwum             | `ArchiveSidebar` — `SidebarWidgetKey` = `popular \| related \| newsletter \| ads`; widget `ads` renderuje `<AdZone position="sidebar" …>`; ustawienia `sidebar_position`, `show_sidebar`  | 🔵   |
| Konfigurowalny sidebar wpisu | `PostSidebarRenderer` (`SidebarWidgetType` = `reading-panel \| tags \| author-card \| related-posts \| newsletter \| ad-slot`) + tabela `sidebar_layouts` (`widgets` jsonb, `is_default`) | 🔵   |
| Sidebar wydarzenia           | ⛔ nie istnieje; `PAGE_TEMPLATES` **nie ma** wariantu z prawą kolumną, w repo nie ma żadnego `sticky` wrappera dla reklamy                                                                | ⛔   |

Prawa kolumna wydarzenia rozwiązuje się **przez builder** (kolumna `[3,6,3]`
z widgetem `ad-slot`), a nie przez nowy shell — pod warunkiem EB-906 (sticky na
kolumnie). Dwa istniejące sidebary są dowodem, że wzorzec jest przetestowany,
ale oba są przypisane innym encjom.

### 11.3 Pasek zakładek wydarzenia

| Wzorzec | Artefakt | Stan |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Najbliższy wzorzec** (trasowe, aktywna w ramce) | `ClubHubSectionBar` — poziomy pasek `<Link>` po poddrzewie encji, aktywny stan `data-[status=active]:border-primary`, `activeOptions={{exact}}`, przewijanie poziome na mobile | 🔵 |
| Zakładki bez zmiany trasy | `ClubWorkspaceTabs` + `ClubWorkspaceTab` — `role="tablist"`, sticky `top-16`, strzałki/Home/End, `aria-selected`, roving `tabIndex`, aktywna: `border-primary/40 bg-primary/10`, badge | 🔵 |
| Zakładki konfigurowane z panelu | `SectionTabsBar` + `SectionTabsConfig`, wariant **`bordered`** (border 1 px `activeColor`, `borderRadius` 8, tło `color-mix` 6%); `SectionTabItem` z `label_pl/en`, `icon`, **`color`** | 🔵 |
| Zakładki ze stanem w URL | `SearchSectionTabs` (`role="tablist"`, `SEARCH_TABS`, stan w query paramie `tab`) | 🔵 |
| Ścieżka/hierarchia | `Breadcrumbs` + `fetchPageBreadcrumbs` → RPC `page_breadcrumbs(_page_id)`, `buildBreadcrumbs` | ✅ |
| Źródło pozycji z poddrzewa stron | `publicPagesTreeQueryOptions()` → `pages(id, slug, title_pl, title_en, parent_id, menu_order)` filtrowane `status='published'`, `seo_noindex=false`, `deleted_at is null` | ✅ |
| Pasek dolny na telefonie | `MobileBottomBarView` (props: `config`, `items`, `activeIndex`, …) + `MobileBottomBarItem` (`icon` Lucide kebab-case, `href`, `color`, `badge`) | 🟡 | komponent nadaje się wprost, ale konfiguracja jest **globalna**: jeden wiersz `site_settings[key='mobile_bottom_bar']` na tenanta |

Trzy braki:

**⛔ EB-941 — `EventTopTabs`**: `/events/$slug` (590 linii) to **jedna** strona
(RSVP, bilety, prelegenci inline przez `EventSpeakersSection`) — bez paska zakładek
i bez podstron; w `src/routes` nie ma żadnego pliku `events.$slug.*` poza nią samą.
Komponent składa się z gotowych części: pasek z `ClubHubSectionBar`, `aria-current`
i `Breadcrumbs`. Źródłem pozycji jest `publicPagesTreeQueryOptions()` (gdy podstrony
są stronami CMS) albo stała `EVENT_TABS`.

**⛔ EB-942 — nie da się utworzyć menu per wydarzenie.** `saveMenuItems` rzuca
„Menu 'x' nie istnieje", a `INSERT INTO public.menus` występuje **wyłącznie**
w migracji seedującej `key='main'`. `src/lib/menus/menu.functions.ts` ma tylko
`listMenuSummaries`, `fetchMenuWithItems`, `saveMenuItems` — **brak `createMenu`**.
To rozstrzyga wybór: albo dodać tworzenie menu (i wtedy EB-903 ma sens), albo
oprzeć zakładki wydarzenia na poddrzewie `pages` i stałej `EVENT_TABS` z flagami
widoczności. **Rekomendacja: poddrzewo stron** — mniej ruchomych części i za darmo
dostajemy breadcrumby, SEO i i18n tytułów.

**⛔ EB-943 — `SiteMenu` nie wie, na której trasie stoi.** Zero wystąpień
`aria-current`, `activeProps`, `activeOptions`, `data-status` w
`src/components/menu/SiteMenu.tsx` — mimo że logika istnieje w
`src/lib/menus/siteMenu.ts` (`isMenuPathActive`, `activeMenuIndex`). Bez tego
zakładka aktywna nie ma ramki, a czytnik ekranu nie wie, gdzie jest użytkownik.
To defekt dostępności **istniejącego** menu, nie tylko brak dla wydarzenia.

---

## 12. Zestawienie braków — 43 zadania w siedmiu grupach

Kolumna „koszt" to skala względna: **S** = jeden plik / jedna kolumna,
**M** = komponent + podpięcie albo migracja z UI, **L** = tabela + RPC + UI + RLS.

### 12.1 Fundament (bez tego nie ma frontu wydarzenia)

| Zadanie    | Co                                                                     | Koszt | Blokuje                                |
| ---------- | ---------------------------------------------------------------------- | ----- | -------------------------------------- |
| **EB-901** | `pages.event_id` + `events.root_page_id`                               | S     | wszystko                               |
| **EB-902** | `eventContext.ts` + widgety `event-title`, `event-cover`, `event-info` | M     | §4.1, §4.2                             |
| **EB-904** | starter `starter-event-front-3col` (spans `[3,6,3]`)                   | S     | §3.3                                   |
| **EB-906** | `ColumnNode.sticky` + kontrolka                                        | M     | lewa karta i prawy baner (§3.3, §11.2) |
| **EB-941** | `EventTopTabs` + podstrony jako poddrzewo `pages`                      | M     | §3.2, §11.3                            |

### 12.2 Kolumna środkowa

| Zadanie    | Co                                                                                         | Koszt |
| ---------- | ------------------------------------------------------------------------------------------ | ----- |
| **EB-908** | widget `event-info` (data · **strefa z globusem** · adres · opis)                          | M     |
| **EB-909** | widget `menu-tiles` (`items[]` z `iconColor`) — reużywa istniejące klasy `.menu-card-item` | M     |
| **EB-910** | `menu_items.icon_color` (opcjonalne, gdy kafle mają iść z menu witryny)                    | S     |
| **EB-911** | tryb `source:'event'` w widgecie `event-sponsors`                                          | M     |
| **EB-912** | `src/lib/events/timezone.ts` + przepięcie **czterech** miejsc                              | M     |

### 12.3 Osoby i rekomendacje

| Zadanie    | Co                                                                                     | Koszt |
| ---------- | -------------------------------------------------------------------------------------- | ----- |
| **EB-913** | `MyProfileCard` (avatar+online, imię, stanowisko, firma, „Edytuj")                     | M     |
| **EB-914** | widget `my-profile-card` z bramką `advanced.access.auth`                               | M     |
| **EB-915** | wyniesienie `PersonCard`, `DiscoverabilityBanner` i pola wyszukiwania z `people.tsx`   | S     |
| **EB-916** | `connection_suggestions` v4 — 4 kolumny wyjściowe z `ORDER BY` do `SELECT`             | S     |
| **EB-917** | RPC `similar_profiles(p_limit)` (wektor własny, `SECURITY DEFINER`)                    | M     |
| **EB-918** | RPC `ai_people_for_you(p_event_id, p_limit)` — blend + `reasons text[]`                | L     |
| **EB-919** | `peopleReason.ts` + klucze `network.aiReasons.*` (PL/EN)                               | S     |
| **EB-920** | `AiPeopleCarousel` (pas + strzałka)                                                    | M     |
| **EB-921** | widget `ai-people-for-you`                                                             | M     |
| **EB-922** | RPC `event_attendees(p_event_id, p_limit, p_offset)` — filtr `discoverable`            | M     |
| **EB-923** | popover „Jak to działa?"                                                               | S     |
| **EB-924** | sekcja `recommendedPeople` w `PersonalizedSettings` + zakładka w `/admin/personalized` | S     |
| **EB-925** | `people_suggestion_clicks` + `people_suggestion_signals` (niski priorytet)             | M     |
| **EB-932** | kontekst wydarzenia na `/author/$slug` (`?event=<slug>` + breadcrumb)                  | S     |
| **EB-933** | `phone` w `buildExpertProfile` i `get_expert_hub` + zgoda `show_phone`                 | M     |
| **EB-934** | `SocialRow`: `author_profiles.custom_socials`                                          | S     |
| **EB-936** | `ends_at` w `fetchSpeakerEngagements`                                                  | S     |

### 12.4 Firmy i partnerzy

| Zadanie    | Co                                                                     | Koszt |
| ---------- | ---------------------------------------------------------------------- | ----- |
| **EB-926** | widok `member_organizations_public` (wzorzec `profiles_public`)        | M     |
| **EB-927** | `event_companies` (firma × wydarzenie × rola sponsor/partner/wystawca) | L     |
| **EB-935** | karta organizacji na profilu osoby (wzorzec `PostOrganizationCard`)    | S     |

### 12.5 Sesje

| Zadanie    | Co                                                                                                                      | Koszt |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ----- |
| **EB-928** | `event_session_feedback` (1–5, poufne wobec prelegenta) + agregat zasilający `speaker_profiles.rating`                  | L     |
| —          | `event_sessions` i `event_session_registrations` — **poza zakresem tego dokumentu**, patrz specyfikacja panelu (E3, E5) | L     |

### 12.6 Profil uczestnika

| Zadanie    | Co                                                                         | Koszt |
| ---------- | -------------------------------------------------------------------------- | ----- |
| **EB-929** | trasa `/profile/schedule` + wyniesienie siatki kalendarza z `ClubCalendar` | M     |
| **EB-930** | `user_bookmarks.entity_type` += `person`/`company`/`session`/`event`       | S     |
| **EB-931** | `profiles.timezone` + `profiles.time_format`                               | S     |

### 12.7 Chrome, reklama, defekty

| Zadanie    | Co                                                                                       | Koszt |
| ---------- | ---------------------------------------------------------------------------------------- | ----- |
| **EB-903** | `menus.event_id` — **tylko jeśli** odrzucimy rekomendację z EB-942                       | M     |
| **EB-905** | `scope: "event-header"` w `Builder` + `site_settings.event_header` + trasa panelu        | M     |
| **EB-907** | **defekt**: martwe selektory `[data-header-override]` / `[data-template]` w `styles.css` | S     |
| **EB-937** | `ad_page_type` += `'event'` + gałąź w `adPageTypeForLocation`                            | S     |
| **EB-938** | pole `page_id` w formularzu `/admin/ads`                                                 | S     |
| **EB-939** | `ad_slots.cta_label_pl/_en` (opcjonalne)                                                 | S     |
| **EB-940** | konwencja `config` dla `position='sidebar'`                                              | S     |
| **EB-942** | `createMenu` — **albo** decyzja „zakładki z poddrzewa stron" (rekomendowana)             | M / 0 |
| **EB-943** | **defekt dostępności**: `aria-current`/`activeProps` w `SiteMenu`                        | S     |

---

## 13. Kolejność wdrożenia

Kolejność wynika z zależności, nie z układu ekranu. Każdy etap kończy się czymś,
co da się pokazać.

| Etap    | Zadania                                                | Co po nim działa                                                                                         |
| ------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **F1**  | EB-901, EB-904, EB-906, EB-907                         | strona wydarzenia w układzie `[3,6,3]` z przyklejonymi kolumnami i działającym przezroczystym nagłówkiem |
| **F2**  | EB-902, EB-908, EB-912                                 | okładka, tytuł i **poprawna strefa czasowa** jako widgety — koniec z twardą trasą `events.$slug`         |
| **F3**  | EB-941, EB-943 (+ decyzja EB-942)                      | zakładki wydarzenia z aktywnym stanem i breadcrumbami; podstrony jako strony CMS                         |
| **F4**  | EB-909, EB-910                                         | kafle menu z kolorowymi ikonami (zrzut 2)                                                                |
| **F5**  | EB-913, EB-914, EB-915                                 | lewa kolumna: karta mojego profilu + wyniesione komponenty osób                                          |
| **F6**  | EB-922, EB-916, EB-919, EB-920, EB-921, EB-923, EB-924 | zakładka Uczestnicy + sekcja rekomendacji **z uczciwą nazwą** (bez „AI", dopóki nie ma EB-917/918)       |
| **F7**  | EB-926, EB-927, EB-911, EB-935                         | strony firm, lista partnerów, sponsorzy z bazy zamiast z JSON-a widgetu                                  |
| **F8**  | EB-930, EB-931, EB-929                                 | zakładki na czterech typach encji, strefa i format użytkownika, „Mój harmonogram"                        |
| **F9**  | EB-937, EB-938, EB-939, EB-940                         | baner przypięty do wydarzenia z pełną telemetrią                                                         |
| **F10** | EB-917, EB-918, EB-925                                 | rekomendacje wektorowe — **wtedy** nazwa „AI wybrane dla Ciebie" ma pokrycie                             |
| **F11** | EB-905, EB-932, EB-933, EB-934, EB-936                 | osobny nagłówek aplikacji wydarzenia, strona osoby w kontekście wydarzenia, pełny kontakt                |
| **F12** | EB-928                                                 | opinie o sesjach i **prawdziwe** źródło `speaker_profiles.rating`                                        |

### 13.1 Trzy rzeczy do rozstrzygnięcia przed startem

1. **Zakładki wydarzenia: poddrzewo stron czy menu w bazie?** (EB-941 vs EB-903/942).
   Rekomendacja: poddrzewo stron — breadcrumby, SEO i i18n tytułów dostajemy za darmo,
   a `createMenu` w ogóle nie istnieje.
2. **„Połącz Kalendarz Google": dodanie do kalendarza czy synchronizacja konta?**
   (§9.5). Pierwsze jest gotowe dziś, drugie to osobny projekt z OAuth per użytkownik.
3. **Nazwa sekcji rekomendacji.** Do domknięcia EB-917/918 etykieta „AI" nie ma
   pokrycia w danych (§6.3). Alternatywa: „Osoby, które warto poznać".

### 13.2 Co da się zrobić **dziś**, bez ani jednej migracji

- **Siatka prelegentów** (zrzut 7) — widget `speakers` z `source:'event'` (§7.2).
- **Lista partnerów i poziomy sponsorskie** (zrzut 8, część zrzutu 1) — widget
  `event-sponsors` z treścią wpisaną ręcznie (§4.3).
- **Baner w prawej kolumnie** — `<AdZone position="sidebar" …>` (§11.1), o ile
  przyjmiemy `page_type='all'` do czasu EB-937.
- **Strona osoby** (zrzut 4) — `/author/$slug` już działa i jest bogatsza niż
  ekran referencyjny (§10), z jednym zastrzeżeniem: gwiazdki bez źródła (EB-928).
- **„Moje zakładki", „Moje kontakty", „Mój profil"** (część zrzutu 10) — trasy
  `/profile/bookmarks`, `/network`, `/profile` istnieją (§9.1).

To jest realny **demo end-to-end w jednym sprincie**, na prawdziwych danych,
bez ani jednego pola-atrapy.
