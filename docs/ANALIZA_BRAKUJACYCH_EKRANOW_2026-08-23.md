# Brakujące ekrany Event Buildera — analiza na dowodach

Data: 2026-08-23 · Status: **analiza w toku** (część A: dowody; część B: realne źródła danych)
Dokumenty powiązane:

- `INWENTARZ_ELEMENTOW_UI_SWAPCARD_2026-08-23.md` — inwentarz elementów z ~70 zrzutów
- `MAPOWANIE_SWAPCARD_EVENT_BUILDER_ZRZUTY.md` — dziennik 16 partii zrzutów
- `PROJEKT_MODUL_EVENT_BUILDER_2026-08-23.md` — specyfikacja i model danych

## 0. Zasada tego dokumentu: zero danych zmyślonych

Tych ekranów **nie widziałem na zrzutach**. Dlatego nie opisuję, „co na nich jest" —
opisuję wyłącznie to, co da się udowodnić, i wprost oznaczam, czego nie wiemy.
Trzy poziomy pewności, konsekwentnie w całym dokumencie:

| Znacznik | Znaczenie                                                                   | Weryfikowalność                          |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------- |
| **[D]**  | **dowód ze zrzutu** — dosłowny cytat kontrolki, która odsyła do tego ekranu | numer zrzutu w dzienniku                 |
| **[R]**  | **fakt z repo** — istniejąca tabela, kolumna, RPC, trasa, komponent         | ścieżka pliku + dokładna nazwa           |
| **[P]**  | **propozycja NES** — decyzja projektowa nasza, nie opis Swapcarda           | uzasadnienie, nigdy „bo tak ma Swapcard" |

Czego w tym dokumencie **nie ma i nie będzie**: wymyślonych etykiet Swapcarda,
zgadywanych układów ekranów, kafli z liczbami bez źródła, przykładowych danych
„na razie". Jeśli metryka nie ma źródła w istniejącej tabeli — jest wypisana
w sekcji „czego brakuje", a nie na projekcie ekranu.

**Reguła nadrzędna dla implementacji** (wprost z antywzorca Swapcarda, zrzut 16.1,
gdzie dashboard pokazuje 48 820 rejestracji przy wydarzeniu z 21 osobami):
kafel bez rzeczywistego źródła nie wchodzi na ekran. Pusty stan z instrukcją
(„brak rejestracji — otwórz sprzedaż biletów") jest zawsze lepszy od liczby,
której nie da się obronić przy zarządzie.

---

## 1. Skąd wiemy, że te ekrany istnieją — inwentarz dowodów

Każdy z brakujących ekranów jest **wywoływany z ekranu, który mamy na zrzucie**.
To jedyny pewny materiał: znamy dokładną etykietę kontrolki odsyłającej i kontekst,
w którym stoi.

| Ekran                               | Dowód [D] — dosłowna kontrolka odsyłająca                                                                                                                                                                                                                                         | Skąd (zrzut)      | Co z tego wynika                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `Overview`                          | pozycja sidebara `Overview` — pierwsza, nad `Event builder`                                                                                                                                                                                                                       | wszystkie zrzuty  | istnieje pulpit wydarzenia; **zawartości nie znamy**                                                             |
| `Integrations`                      | pozycja sidebara `Integrations`; w trybie rejestracji zewnętrznej: „Have a look to our `Integrations` or to our `Developer Portal` to connect your external registration tool."                                                                                                   | 3.4               | integracje służą m.in. **podłączeniu zewnętrznej rejestracji**; istnieje też portal dla programistów             |
| `Add-on features`                   | pozycja sidebara `Add-on features` (ikona diamentu, wyróżniony kolor) + 19 plakietek `Add-on` + `Get feature` rozsianych po panelu                                                                                                                                                | zał. E inwentarza | to **katalog funkcji płatnych**, nie moduł produktowy                                                            |
| `Session settings`                  | `lnk` **`Manage session custom fields`** oraz zdanie „Fill the custom fields you created in **Session Settings**. This allows you to define specific categories, filters or details about this session…"                                                                          | 6.2               | ekran definiuje **pola własne sesji**: `Type`, `Location`, `Topics` widziane na sesji to jego produkty           |
| `Manage roles`                      | `btn` **`Manage roles`** z ikoną linku zewnętrznego, obok listy prelegentów sesji z nagłówkiem grupy roli `Wykładowcy`                                                                                                                                                            | 7.1               | ekran definiuje **słownik ról prelegentów**; „Wykładowcy" to jedna z nich, nazwana po polsku                     |
| `Manage visibility`                 | `btn` **`Manage visibility`** pod tekstem „Manage the visibility of the event content by people who are **not registered** for the event **or not logged in**. Make sure that the content is accessible to them if you display it publicly on your website thanks to our widget." | 1.5               | macierz dotyczy **gościa** (nie zalogowany / niezarejestrowany) i ma związek z **widgetem na obcej stronie**     |
| `Add condition`                     | `lnk`/`btn` **`Add condition`** w **trzech różnych miejscach**: przy widoczności `Exhibitors`/`Sessions`/`Items` w grupie (2.1), przy `Export condition` wystawców („add a condition such as a **custom field or a term consent**", 8.3) i w opisie reguł spotkań                 | 2.1, 8.3          | jeden silnik warunków, **trzy zastosowania**; warunki opierają się o **pola własne** i **zgody**                 |
| `Edit group's settings`             | `lnk` `Edit group's settings` obok `Group` = `Exhibitors` w uprawnieniach firmy                                                                                                                                                                                                   | 8.9               | prowadzi do **szuflady grupy z partii 2** — czyli ten ekran **znamy**                                            |
| `Item settings`                     | karta **`Item settings`** — „Create item types, subcategories and custom fields. Choose if a list of similar items generated by AI is displayed on each item page."                                                                                                               | 9.1               | ekran definiuje **typy, podkategorie i pola własne** items; poza zakresem NES (§0.4)                             |
| `Marketplace settings`              | `lnk` `Marketplace settings` (ikona koła) obok `Payment settings`; w szczegółach dodatku: „Manage image visibility on the `Marketplace settings`."                                                                                                                                | 11.3, 11.4        | steruje m.in. **widocznością obrazów** pozycji; poza zakresem NES                                                |
| `Payment settings`                  | `lnk` `Payment settings` przy liście biletów **i** przy liście dodatków                                                                                                                                                                                                           | 3.5, 11.3         | **wspólna** konfiguracja płatności dla biletów i dodatków — potwierdza, że to nie jest ustawienie per wydarzenie |
| `Email templates` / `Email header`  | dwa `btn` obok `Create a campaign`                                                                                                                                                                                                                                                | 14.1              | biblioteka szablonów i wspólny nagłówek e-maili — u nas odpowiedniki **istnieją** (§2 poniżej)                   |
| `Default meeting location capacity` | `lnk` (ikona koła) nad listą miejsc spotkań                                                                                                                                                                                                                                       | 19.3              | domyślna **pojemność równoległa** nowego miejsca                                                                 |
| `custom fields settings`            | „You can create new ones and manage their order in the `custom fields settings`." (przy filtrach strony wyboru spotkań)                                                                                                                                                           | 13.4              | ten sam słownik pól własnych rządzi **kolejnością filtrów**                                                      |
| `example page`                      | `lnk` `View an example page` przy stronie wyboru spotkań                                                                                                                                                                                                                          | 13.3              | Swapcard ma publiczny przykład tej strony                                                                        |

### 1.1 Czego z tych dowodów **nie wynika** (i czego nie wolno dopisać)

- **Nie znamy** ani jednej etykiety pola z wnętrza tych ekranów.
- **Nie znamy** liczby ani rodzaju kontrolek, układu sekcji, wartości domyślnych.
- **Nie znamy** operatorów silnika warunków (`równa się`, `zawiera`, `jest jednym z`…) —
  wiemy tylko, na czym warunki operują: **pola własne** i **zgody** [D 8.3].
- **Nie znamy** zawartości `Overview` — ani jednego kafla. Sidebar to jedyny dowód.

### 1.2 Wzorzec adresów (inferencja z 31 potwierdzonych URL-i)

Z 31 zrzutów mamy potwierdzone ścieżki, m.in. `/people/settings/profile-edition`
oraz cztery zakładki `/exhibitors/settings/…`. Stąd **inferencja** [P] o wzorcu
`/(<moduł>)/settings/<zakładka>` — i dopóki nie ma zrzutu, pozostaje inferencją:

| Ekran              | Ścieżka potwierdzona                                      | Ścieżka prawdopodobna [P]                                                                                |
| ------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| People settings    | `…/people/settings/profile-edition` ✅                    | (druga zakładka `Custom fields` — inna końcówka)                                                         |
| Exhibitor settings | `…/exhibitors/settings/cu…`, `…/re…`, `…/ho…`, `…/si…` ✅ | pełne nazwy zakładek                                                                                     |
| Session settings   | —                                                         | `…/plannings/settings/…`                                                                                 |
| Manage roles       | —                                                         | `…/plannings/settings/roles` lub osobny moduł (ikona linku **zewnętrznego** sugeruje inny obszar panelu) |
| Manage visibility  | —                                                         | `…/groups-and-permissions/visibility`                                                                    |
| Overview           | —                                                         | `…/overview` lub `…/` (korzeń wydarzenia)                                                                |
| Integrations       | —                                                         | `…/integrations`                                                                                         |
| Add-on features    | —                                                         | `…/add-ons`                                                                                              |

**Wniosek praktyczny:** ikona **linku zewnętrznego** przy `Manage roles` [D 7.1] jest
sygnałem, że słownik ról **nie mieszka w studiu wydarzenia**, a w obszarze
społeczności (jak `Community parent group` z 2.1). To jedyne, co można o tym
ekranie powiedzieć bez zrzutu — i to ma bezpośredni skutek dla naszego modelu:
role prelegentów powinny być słownikiem **tenanta**, nie wydarzenia.

---

## 9. Reguła „rzeczywiste dane" — kontrakt dla implementacji

Ta sekcja jest wymogiem zamawiającego postawionym wprost: **dane mają być
rzeczywiste, elementy mają istnieć**. Poniżej kontrakt, który to egzekwuje.

### 9.1 Trzy zakazy

| Zakaz                                                   | Uzasadnienie                                                                                                                                            | Jak sprawdzić                                                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Zakaz danych demonstracyjnych** w panelu produkcyjnym | Swapcard pokazuje `48,820 Registered` przy wydarzeniu z 21 osobami [D 16.1]; liczba z dashboardu trafia potem do raportu dla zarządu                    | żaden komponent panelu nie może zawierać liczb literalnych w JSX poza `0` w stanie pustym                                        |
| **Zakaz kafla bez źródła**                              | kafel, którego nie da się policzyć z istniejącej tabeli, jest obietnicą bez pokrycia (jak dziś `speaker_profiles.rating` — kolumna jest, źródła nie ma) | każdy kafel na projekcie ma wskazaną tabelę i szkic zapytania; brak → kafel wypada z zakresu do etapu, w którym powstanie źródło |
| **Zakaz metryki częściowo filtrowanej**                 | Swapcard: „\*Group filtering is not considered for the these metrics." [D 16.1] — część kafli respektuje filtr, część nie                               | filtr grupy obowiązuje we wszystkich kaflach sekcji albo w żadnym; kafle niefiltrowalne stoją w osobnej sekcji z jawnym podpisem |

### 9.2 Trzy nakazy

1. **Pusty stan mówi, co zrobić.** Wzorzec ze Swapcarda jest tu dobry i warto go
   skopiować: „No meetings scheduled, make sure you create slots, locations,
   generate condition and/or add request rules." [D 19.1] — zdanie wymienia
   **wszystkie brakujące warunki wstępne**, a nie tylko stwierdza pustkę.
2. **Liczba w przycisku akcji masowej jest treścią potwierdzenia.**
   `Create 40 slots` [D 19.5], `Create 1 location` [D 19.2] — dokładnie tyle,
   ile powstanie. Ta zasada jest już zapisana w repo dla kampanii segmentowych
   (`src/lib/clubs/adminSegment.ts` §4) i obowiązuje w całym module.
3. **Ostrzeżenie zamiast cichego przyjęcia śmieci.** Dane referencyjne Swapcarda
   zawierają slot o długości **1050 minut** i sesje z **2024** roku w wydarzeniu
   z 2025 [D 19.4, 6.2]. Panel musi ostrzegać przy dacie poza zakresem wydarzenia
   i przy nienaturalnym czasie trwania — inaczej uczestnik dostaje takie „terminy".

### 9.3 Test odbioru dla każdego nowego ekranu

Ekran przechodzi odbiór, gdy dla **każdego** widocznego elementu da się odpowiedzieć:

- z jakiej tabeli/kolumny bierze się wartość (albo: to stan pusty),
- co widzi administrator, gdy danych nie ma **wcale**,
- co widzi, gdy danych jest **za dużo** (paginacja, limity),
- czy element respektuje filtr grupy i bramkę widoczności (`chatham_house`).

---

## 10. Czego zamówić na zrzutach (lista zamknięta)

Poniżej dokładnie to, czego brakuje, żeby domknąć mapowanie. Kolejność według
wpływu na model danych, nie według układu sidebara.

| Priorytet | Ekran                                                                  | Dlaczego to blokuje                                                                                                                    | Co konkretnie sfotografować                                                                                                       |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **1**     | `Add condition` — rozwinięty (dowolne z trzech miejsc)                 | jedyny mechanizm, którego kształtu nie znamy, a występuje w trzech modułach: widoczność grupy, eksport leadów, reguły spotkań          | modal/panel po kliknięciu `Add condition`: **operatory**, wybór pola, wartości, łączenie warunków (I/LUB), podgląd liczby trafień |
| **2**     | `Session settings` (przez `Manage session custom fields`)              | definiuje `Type`, `Location`, `Topics` sesji; decyduje, czy nasz jeden mechanizm pól własnych (§4.12 specyfikacji) ma właściwy kształt | lista pól, formularz nowego pola: **typy pól**, sekcje, czy pole jest filtrem, kolejność, zakres (wydarzenie / społeczność)       |
| **3**     | `Manage visibility`                                                    | macierz widoczności gościa — u nas najbardziej ryzykowna część uprawnień (Chatham House)                                               | pełna macierz: **wiersze** (sekcje treści) × **kolumny** (kto widzi), stany domyślne                                              |
| **4**     | `Manage roles`                                                         | rozstrzyga, czy słownik ról prelegentów jest per wydarzenie czy per społeczność (ikona linku zewnętrznego sugeruje drugie)             | lista ról, formularz roli, czy role mają kolejność i i18n nazw                                                                    |
| **5**     | `Overview`                                                             | pulpit, który u nas ma pokazywać **wyłącznie rzeczywiste** dane — trzeba wiedzieć, jakie pytania zadaje organizator                    | wszystkie kafle i sekcje, checklisty onboardingu, skróty do zadań                                                                 |
| **6**     | `Integrations`                                                         | dowiemy się, czy „zewnętrzna rejestracja" to webhook, API czy gotowe konektory                                                         | lista integracji, ekran konfiguracji jednej z nich                                                                                |
| **7**     | `Add-on features`                                                      | katalog funkcji płatnych — przydatny do porównań ofertowych, nie do modelu                                                             | lista pozycji z cenami/opisami                                                                                                    |
| 8         | `People settings → Custom fields`                                      | druga zakładka ekranu, który już mamy                                                                                                  | formularz pola własnego osoby                                                                                                     |
| 9         | `Email templates`, `Email header`                                      | u nas odpowiedniki istnieją; zrzut potwierdziłby zakres                                                                                | lista szablonów, edytor nagłówka                                                                                                  |
| 10        | `Default meeting location capacity`                                    | jedno pole                                                                                                                             | modal ustawienia                                                                                                                  |
| —         | `Item settings`, `Marketplace settings`, `Hosted buyer` (konfiguracja) | **poza zakresem** NES (§0.4) — mapujemy tylko dla kompletności obrazu                                                                  | —                                                                                                                                 |

### 10.1 Alternatywa dla zrzutów: publiczna dokumentacja

Przy `Add condition` i `Manage visibility` (priorytety 1 i 3) sensowną drogą jest
też publiczna dokumentacja Swapcarda (`Learn how ›` prowadzi do ich bazy wiedzy).
Jeśli wolisz, mogę z niej wyciągnąć opis mechanizmu — ale zaznaczę wtedy, że to
**dokumentacja producenta, nie zrzut z działającego panelu**, bo dokumentacja bywa
starsza niż interfejs.
