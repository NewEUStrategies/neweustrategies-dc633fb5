# Analiza systemowa: NES na tle 38 konkurentów — oceny indywidualne z uzasadnieniami

**Data:** 2026-07-20 · **Gałąź:** `claude/struktura-modulow-funkcji-38atfr` (PR #46)
**Status:** dokument nadrzędny; zastępuje `OCENA_KONKURENCI_INDYWIDUALNIE_2026-07-20.md` (wersja z ocenami
grupowo-uśrednionymi i modułem „czat/społeczność" łączącym komunikator z funkcjami pokrewnymi).

---

## 0. Metodologia

### 0.1 Zakres i sposób pomiaru

Oceniam **pięć modułów** (wpisy, strony, wyszukiwarka, czat, profile) u **NES i 38 konkurentów**:
think-tanki z Polski, Europy Zachodniej, Rosji, Chin, Japonii i USA oraz publiczne serwisy mediów.
Wykluczone: osobne platformy premium mediów (Politico PRO, Bloomberg Terminal/BGOV/Law, Reuters
Eikon/Connect, Axios Pro, Euractiv Pro)[^1]. Skala 0–10, krok 0,5; różnice <0,5 nierozstrzygające.

### 0.2 Korekty względem poprzednich wersji (na czym polega „urealnienie")

1. **Czat oceniany sensu stricto.** Moduł „czat" = komunikator użytkownik–użytkownik na platformie
   (rozmowy 1:1/grupowe, historia, powiadomienia). Komentarze pod artykułami, newslettery, fora
   członkowskie i sekcje Q&A to funkcje INNYCH modułów lub relacja czytelnik–redakcja — **nie podnoszą
   noty czatu**. Skutek: **wszystkich 38 konkurentów ma w module czat 0,0**, bo żaden — łącznie z FT,
   CFR i Euractiv — nie udostępnia komunikatora między użytkownikami. Funkcje pokrewne opisuję w profilu
   każdego podmiotu tam, gdzie przynależą.
2. **NES oceniany za mechanizm × realność.** Wcześniejsze oceny mierzyły jakość silnika (z kodu). Nota
   analityczna musi uwzględniać: dorobek (silnik digital features bez opublikowanych produktów to nie to
   samo co ChinaPower), dane (rekomender bez historii czytelniczej działa gorzej niż na papierze), masę
   krytyczną (sieć kontaktów bez użytkowników ma wartość opcyjną, nie realną) i dojrzałość operacyjną
   (moduły czatu/wyszukiwarki mają 4–8 dni produkcyjnego życia). Skutek: **średnia NES spada z 8,0 do
   7,5**, z największą korektą w module stron (dorobek interaktywny 6,5 → 4,0).
3. **Uzasadnienie każdej noty.** Każdy podmiot ma indywidualną tabelę: moduł → ocena → dlaczego.

### 0.3 Kryteria składowe modułów (do których odwołują się uzasadnienia)

- **Wpisy:** czytanie · szerokość formatów · paywall/monetyzacja · personalizacja · audio/TTS ·
  wielojęzyczność · SEO/dystrybucja · live.
- **Strony:** huby tematyczne · microsites/interaktywne raporty (dorobek) · builder self-service ·
  wydajność techniczna · landingi konwersji · testy A/B.
- **Wyszukiwarka:** trafność · fasety · autosugestie/„czy chodziło o…" · wyszukiwanie ekspertów ·
  zapisane wyszukiwania/alerty · składnia zaawansowana.
- **Czat:** istnienie i jakość komunikatora użytkownik–użytkownik (0 = brak funkcji).
- **Profile:** strony ekspertów · katalog ekspertów · profile czytelników · networking online ·
  zaufanie (weryfikacja/odznaki/rekomendacje) · prywatność/RODO.

### 0.4 Źródła i ograniczenia

NES: kod repozytorium i audyty wewnętrzne[^2]. Konkurenci: ich publiczne serwisy według stanu wiedzy do
połowy 2026[^1] — bez dostępu do pełnej treści za paywallami i portalami członkowskimi; serwisy rosyjskie
bywają geoblokowane w UE; chińskie instytuty prowadzą realną dystrybucję w ekosystemie WeChat, którego ta
analiza nie mierzy bezpośrednio. Oceny są eksperckie (analiza funkcji widocznych), nie pomiarowe; przed
użyciem zewnętrznym rekomendowana weryfikacja u źródła. Nie oceniam skali redakcji, wolumenu treści ani
autorytetu marki — to odrębny wymiar konkurencji, w którym relacje są odwrotne do platformowych.

---

## 1. NES — New European Strategies[^2]

**Profil systemowy.** Dwujęzyczna (PL/EN) platforma analityczno-wydawnicza na TanStack Start + Supabase:
dwa silniki treści (bloki + builder), paywall na grantach kolumnowych Postgresa, warstwy członkostwa
i sprzedaż per-publikacja (Stripe), wyszukiwarka FTS z fasetami, komunikator czasu rzeczywistego, profile
z siecią kontaktów, CRM, newsletter, multi-tenant. Model komercyjny (subskrypcje + członkostwo + darowizny),
bez finansowania państwowego/grantowego. Słabość systemowa: platforma młodsza niż jej silnik — dorobek
treściowy, dane behawioralne i społeczność dopiero się budują.

| Moduł        | Ocena   | Dlaczego taka nota (korekta vs ocena silnika)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | **7,7** | Silnik kompletny: workflow redakcyjny 3-warstwowy, rewizje, paywall per-item (8,5), TTS per artykuł (8,0 — ElevenLabs z limitami kosztowymi, zmienna jakość głosów PL), pełny mechanizm dwujęzyczności (8,5 — pokrycie zależy od dyscypliny redakcji). W dół: czytanie 6,5 (strona artykułu przeładowana — 11 odwołań do komponentów reklamowych w `$.tsx`), personalizacja 7,0 (rekomender SQL realny, ale zimny start bez historii czytelniczej), live 6,0 (moduł jest, warsztat redakcyjny nieudowodniony), SEO 8,5 (zestaw agencyjny, efekty niezweryfikowane w Search Console). Poprzednio 8,3 — korekta −0,6 za różnicę mechanizm/praktyka. |
| Strony       | **7,3** | Builder self-service 9,0 (jedyny w całym zestawieniu; minus brak edycji inline i ekosystemu szablonów), A/B na sekcjach 8,0 (mechanizm pełny, brak śladów systematycznego użycia), wydajność 8,5 (SSR + streaming; budżet bundle bywał przekraczany[^2]). Kluczowa korekta: **dorobek microsites 4,0** (poprzednio 6,5) — widgety digital features istnieją w kodzie, ale opublikowanych produktów klasy ChinaPower/Coalition Explorer brak; oceniam dorobek, nie potencjał. Landingi 6,5 (pricing przebudowany, nieoptymalizowany danymi). Poprzednio 8,2 — korekta −0,9.                                                                        |
| Wyszukiwarka | **7,1** | Trafność 7,5 (FTS z wagami + trigram + lekki stemmer PL — to heurystyka sufiksowa, nie pełna lematyzacja; brak warstwy semantycznej), fasety 7,5 (hierarchiczne, ale jednokrotnego wyboru), autosugestie 8,0 (4 koszyki, ARIA wzorcowe), eksperci 7,5 (zależne od wypełnienia profili i opt-in `discoverable`), **alerty 4,0** (zapisane wyszukiwania bez powiadomień), składnia 8,0. Moduł ma 6 dni produkcyjnego życia (wdrożenia 14–19.07) — bez danych o realnej trafności na żywym ruchu. Poprzednio 7,5 — korekta −0,4.                                                                                                                     |
| Czat         | **7,5** | Jedyny komunikator w zestawieniu: 1:1 + grupy, potwierdzenia z wzajemną prywatnością, głosówki, znikające wiadomości, personalizacja, prywatność egzekwowana w RLS. Minusy realne: brak wyszukiwania w treści rozmów, brak E2E (treści czytelne dla operatora), brak połączeń audio/wideo, produkt ma ~tydzień i zero zweryfikowanej skali. Nota 7,5 to ocena funkcji; wartość biznesowa zależy od zasiedlenia.                                                                                                                                                                                                                                   |
| Profile      | **7,8** | Strony ekspertów 8,5 (konfigurowalne per tenant, dorobek agregowany automatycznie — powyżej Brookings mechanizmem), katalog 7,5, profile czytelników 7,5, prywatność/RODO 8,5 (tryby, eksport, usunięcie konta, granty kolumnowe). Networking 7,0 — funkcje kompletne (zaproszenia, ciche odrzucenia, rekomendacje), ale **sieć bez masy krytycznej ma wartość opcyjną**; nota za mechanizm, z dyskontem za pustkę. Poprzednio 8,3 — korekta −0,5.                                                                                                                                                                                                |
| **Średnia**  | **7,5** | Poprzednio 8,0; korekta −0,5 wynika w całości z rozdzielenia mechanizmu od dorobku/danych/skali.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

---

## 2. Think-tanki polskie

### 2.1 PISM — Polski Instytut Spraw Międzynarodowych[^3]

**Profil.** Państwowy instytut podległy MSZ; wysoka kadencja biuletynów i komentarzy, pełne lustro PL/EN.
Platforma = dwujęzyczny portal publikacyjny bez warstwy produktowej (brak paywalla — finansowanie budżetowe,
brak kont użytkowników poza newsletterem).

| Moduł        | Ocena   | Dlaczego                                                                                                                                                                         |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 3,2     | Czytanie 4,5 (czysto, ale dated); jedyny mocny punkt: wielojęzyczność 7,0 (pełne lustro PL/EN). Paywall/personalizacja/audio ~1 (nie istnieją — model budżetowy ich nie wymaga). |
| Strony       | 2,3     | Statyczne strony programów (3,5); zero microsites, builder = deweloper/agencja, brak landingów konwersji (nie zbiera pieniędzy online).                                          |
| Wyszukiwarka | 2,1     | Prosta wyszukiwarka CMS z filtrami typu publikacji (fasety 3,5); bez podpowiedzi, alertów, składni.                                                                              |
| Czat         | 0,0     | Brak komunikatora; brak nawet komentarzy pod publikacjami.                                                                                                                       |
| Profile      | 2,3     | Statyczne bio analityków z listą publikacji (4,0); brak katalogu z wyszukiwarką, kont czytelników, networkingu.                                                                  |
| **Średnia**  | **2,0** |                                                                                                                                                                                  |

### 2.2 OSW — Ośrodek Studiów Wschodnich[^4]

**Profil.** Państwowy ośrodek analityczny; najwyższa kadencja publikacyjna w polskiej lidze, silny kanał
YouTube i podcasty. Portal dwujęzyczny, funkcjonalny, bez warstwy produktowej.

| Moduł        | Ocena   | Dlaczego                                                                                                                                               |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wpisy        | 3,5     | Formaty 5,5 (analizy, raporty, podcast, wideo — najszerzej w PL), języki 7,0 (PL/EN), czytanie 5,0. Zero monetyzacji/personalizacji (model budżetowy). |
| Strony       | 2,5     | Porządne strony tematyczne (4,0), techniczna poprawność (4,5); brak microsites i konwersji.                                                            |
| Wyszukiwarka | 2,3     | Filtry po regionie/typie (4,0) ponad standard PL; reszta kryteriów śladowa.                                                                            |
| Czat         | 0,0     | Brak komunikatora i komentarzy; społeczność żyje na YouTube (poza platformą).                                                                          |
| Profile      | 2,3     | Bio analityków z dorobkiem (4,0); bez katalogu przeszukiwalnego i jakichkolwiek funkcji użytkownika.                                                   |
| **Średnia**  | **2,1** |                                                                                                                                                        |

### 2.3 Klub Jagielloński[^5]

**Profil.** Stowarzyszenie z centrum analiz i magazynem opinii; finansowanie obywatelskie (darowizny, 1,5%,
Patronite) + granty. Realna społeczność członkowska — ale offline; portal to WordPress z tekstami i mocnym
podcastem.

| Moduł        | Ocena   | Dlaczego                                                                                                           |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------ |
| Wpisy        | 2,7     | Formaty 4,5 (podcasty/YT mocne), monetyzacja 2,5 (darowizny/Patronite to nie paywall produktowy), języki 2,0 (PL). |
| Strony       | 2,4     | Landing wsparcia istnieje (3,0 — realnie zbierają pieniądze online); reszta statyczna.                             |
| Wyszukiwarka | 1,6     | Domyślna wyszukiwarka WordPressa.                                                                                  |
| Czat         | 0,0     | Brak komunikatora; klub członkowski działa na spotkaniach i w mediach społecznościowych, nie na platformie.        |
| Profile      | 1,9     | Bio autorów (3,5); brak funkcji użytkownika.                                                                       |
| **Średnia**  | **1,7** |                                                                                                                    |

### 2.4 Nowa Konfederacja[^6]

**Profil.** „Thinkzine" — think-tank + magazyn; model mecenatu obywatelskiego z częściowym paywallem
(najbliżej modelu produktowego w polskiej lidze, choć technicznie prosto).

| Moduł        | Ocena   | Dlaczego                                                                                                             |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 2,8     | Paywall 4,0 — jedyny częściowy paywall treści w PL lidze (prosty technicznie); formaty 4,5 (podcast/YT); języki 2,0. |
| Strony       | 2,4     | Landing mecenatu 3,5 (rdzeń modelu); reszta portalu konwencjonalna.                                                  |
| Wyszukiwarka | 1,6     | Standard WordPressa.                                                                                                 |
| Czat         | 0,0     | Brak komunikatora i realnych komentarzy.                                                                             |
| Profile      | 1,9     | Bio autorów; brak warstwy użytkownika.                                                                               |
| **Średnia**  | **1,7** |                                                                                                                      |

### 2.5 INE — Instytut Nowej Europy[^7]

**Profil.** Młody, mały instytut (bezpieczeństwo/polityka zagraniczna); dwujęzyczny, finansowany
z Patronite i grantów. Strona podstawowa.

| Moduł        | Ocena   | Dlaczego                                                                               |
| ------------ | ------- | -------------------------------------------------------------------------------------- |
| Wpisy        | 2,7     | Języki 6,0 (PL/EN — rzadkie w tej skali); pozostałe kryteria podstawowe lub nieobecne. |
| Strony       | 2,1     | Prosty WordPress; landing wsparcia zewnętrzny (Patronite).                             |
| Wyszukiwarka | 1,3     | Najprostsza w całym zestawieniu.                                                       |
| Czat         | 0,0     | Brak.                                                                                  |
| Profile      | 1,8     | Krótkie bio zespołu.                                                                   |
| **Średnia**  | **1,6** |                                                                                        |

### 2.6 Zbiorcza — Polska (NES jako punkt odniesienia)

| Podmiot           | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| ----------------- | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES**           | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| OSW               | 3,5     | 2,5     | 2,3      | 0,0     | 2,3     | 2,1     |
| PISM              | 3,2     | 2,3     | 2,1      | 0,0     | 2,3     | 2,0     |
| Klub Jagielloński | 2,7     | 2,4     | 1,6      | 0,0     | 1,9     | 1,7     |
| Nowa Konfederacja | 2,8     | 2,4     | 1,6      | 0,0     | 1,9     | 1,7     |
| INE               | 2,7     | 2,1     | 1,3      | 0,0     | 1,8     | 1,6     |

**Wniosek sekcji:** przewaga NES nad całą polską ligą jest kategorialna (5,4–5,9 pkt) i nie wynika
z jednego modułu, lecz z faktu, że żaden polski podmiot nie buduje platformy produktowej. Jedyne polskie
punkty warte odnotowania: pełne lustra językowe PISM/OSW i częściowy paywall NK. (Sobieski, WEI, Batory —
cyfrowo ≈ poziom KJ/NK, pominięci jako niedystynktywni.)

---

## 3. Think-tanki zachodnioeuropejskie

### 3.1 ECFR — European Council on Foreign Relations[^8]

**Profil.** Paneuropejski think-tank (7 biur), treść darmowa (finansowanie fundacyjne). Najmocniejsza
w Europie warstwa ekspercka (katalog z tematami i językami roboczymi) i interaktywy (EU Coalition Explorer,
Scorecard).

| Moduł        | Ocena   | Dlaczego                                                                                                                                                         |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 3,8     | Czytanie 6,5 (nowoczesny layout), formaty 6,0 (podcasty, komentarze, raporty); zero monetyzacji (świadomie — 1,0), personalizacji (1,5) i audio artykułów (2,0). |
| Strony       | 4,5     | Dorobek interaktywny 7,0 (Coalition Explorer — wzorzec kategorii); huby programów 6,5; wszystko budowane przez deweloperów (builder 2,5), bez A/B (1,5).         |
| Wyszukiwarka | 3,8     | Filtry temat/region/ekspert (fasety 5,5, eksperci 6,0 — najlepsze w EU lidze); bez podpowiedzi z prawdziwego zdarzenia (3,0), alertów (1,5) i składni (1,5).     |
| Czat         | 0,0     | Brak komunikatora; interakcja = wydarzenia i newslettery.                                                                                                        |
| Profile      | 3,8     | Strony ekspertów 7,5 (tematy, języki, kontakt medialny — benchmark EU); katalog 6,5. Zero profili czytelników (1,0) i networkingu (1,0).                         |
| **Średnia**  | **3,2** |                                                                                                                                                                  |

### 3.2 Bruegel[^9]

**Profil.** Brukselski think-tank ekonomiczny; członkostwo państw i korporacji (finansowanie), treść
otwarta. Wyróżnik: otwarte zbiory danych i trackery do pobrania.

| Moduł        | Ocena   | Dlaczego                                                                                                                                       |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 3,7     | Czytanie 6,5 (czysty design), formaty 6,0 (working papers, podcast, datasety); monetyzacja treści 2,0 (członkostwo instytucjonalne ≠ paywall). |
| Strony       | 4,4     | Datasety/trackery 6,5 (np. Clean Tech Tracker), huby 6,0, technika 6,0; bez buildera i A/B.                                                    |
| Wyszukiwarka | 3,7     | Solidne filtry publikacji (5,5/5,5); brak podpowiedzi/alertów/składni.                                                                         |
| Czat         | 0,0     | Brak.                                                                                                                                          |
| Profile      | 3,7     | Strony badaczy 7,0 z dorobkiem; katalog 6,0; zero warstwy użytkownika.                                                                         |
| **Średnia**  | **3,1** |                                                                                                                                                |

### 3.3 Chatham House[^10]

**Profil.** Królewski Instytut Spraw Międzynarodowych; model członkowski (indywidualne + korporacyjne),
250+ wydarzeń rocznie, journal International Affairs (via OUP). Platforma solidna, konserwatywna.

| Moduł        | Ocena   | Dlaczego                                                                                                                                    |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 4,0     | Paywall/członkostwo 5,5 (realna bramka: journal, część treści, nagrania); czytanie 6,0; live 3,0 (transmisje wydarzeń).                     |
| Strony       | 4,1     | Landing członkostwa 6,0 (realnie sprzedaje); huby 5,5; dorobek interaktywny skromny (4,0).                                                  |
| Wyszukiwarka | 3,3     | Poprawne filtry (4,5); nic ponad standard.                                                                                                  |
| Czat         | 0,0     | Brak komunikatora; „społeczność" to sale eventowe i portal członkowski (konta, zapisy, nagrania) — nie komunikacja między członkami online. |
| Profile      | 3,7     | Eksperci 6,5, katalog 5,5; konta członków (2,0 w profilach czytelników — logowanie i preferencje, nie profil publiczny).                    |
| **Średnia**  | **3,0** |                                                                                                                                             |

### 3.4 RUSI — Royal United Services Institute[^11]

**Profil.** Najstarszy think-tank obronny świata (1831); członkostwo z portalem my.rusi.org (archiwum
nagrań za bramką), journal via Taylor & Francis, sieć podcastów, badania OSINT.

| Moduł        | Ocena   | Dlaczego                                                                                                          |
| ------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 3,9     | Członkostwo/paywall 6,0 (najtwardsza bramka treści w EU lidze); formaty 5,5 (podcasty, komentarze); czytanie 5,5. |
| Strony       | 3,9     | Landing członkostwa 6,0; projekty danych OSINT 4,0; reszta klasyczna.                                             |
| Wyszukiwarka | 3,0     | Standardowe filtry; bez inteligencji.                                                                             |
| Czat         | 0,0     | Brak komunikatora; portal członkowski = dostęp do treści, nie komunikacja.                                        |
| Profile      | 3,5     | Eksperci 6,0, katalog 5,0, konta członkowskie (2,0).                                                              |
| **Średnia**  | **2,9** |                                                                                                                   |

### 3.5 SWP — Stiftung Wissenschaft und Politik[^12]

**Profil.** Niemiecki instytut doradzający rządowi i Bundestagowi; finansowanie federalne, treść darmowa,
pełne wersje DE/EN. Cyfrowo: archiwum publikacji wysokiej jakości, zero produktu.

| Moduł        | Ocena   | Dlaczego                                                                          |
| ------------ | ------- | --------------------------------------------------------------------------------- |
| Wpisy        | 3,3     | Języki 6,0 (DE/EN); czytanie 5,0; reszta nieobecna z założenia (model budżetowy). |
| Strony       | 2,8     | Poprawne technicznie strony badań (4,5); bez interaktywów i konwersji.            |
| Wyszukiwarka | 3,1     | Filtry publikacji 4,5; standard biblioteczny.                                     |
| Czat         | 0,0     | Brak.                                                                             |
| Profile      | 3,3     | Strony badaczy 5,5, prywatność 5,5 (niemiecka kultura RODO).                      |
| **Średnia**  | **2,5** |                                                                                   |

### 3.6 CEPS — Centre for European Policy Studies[^13]

**Profil.** Brukselski think-tank; członkostwo korporacyjne, wydarzenia, treść otwarta. Platforma
przeciętna dla ligi brukselskiej.

| Moduł        | Ocena   | Dlaczego                                                                  |
| ------------ | ------- | ------------------------------------------------------------------------- |
| Wpisy        | 3,1     | Czytanie 5,0, formaty 4,5; monetyzacja 2,5 (członkostwo instytucjonalne). |
| Strony       | 3,2     | Landing członkostwa 4,0; huby 4,5.                                        |
| Wyszukiwarka | 3,0     | Filtry standardowe.                                                       |
| Czat         | 0,0     | Brak.                                                                     |
| Profile      | 3,2     | Eksperci 5,5/katalog 5,0.                                                 |
| **Średnia**  | **2,5** |                                                                           |

### 3.7 Zbiorcza — Europa Zachodnia

| Podmiot       | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| ------------- | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES**       | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| ECFR          | 3,8     | 4,5     | 3,8      | 0,0     | 3,8     | 3,2     |
| Bruegel       | 3,7     | 4,4     | 3,7      | 0,0     | 3,7     | 3,1     |
| Chatham House | 4,0     | 4,1     | 3,3      | 0,0     | 3,7     | 3,0     |
| RUSI          | 3,9     | 3,9     | 3,0      | 0,0     | 3,5     | 2,9     |
| SWP           | 3,3     | 2,8     | 3,1      | 0,0     | 3,3     | 2,5     |
| CEPS          | 3,1     | 3,2     | 3,0      | 0,0     | 3,2     | 2,5     |

**Wniosek sekcji:** liga EU dzieli się na model interaktywno-otwarty (ECFR/Bruegel — dorobek danych,
zero monetyzacji) i członkowsko-bramkowy (Chatham/RUSI — realne przychody, konserwatywna platforma).
NES łączy oba modele w jednym systemie; realną lekcją od tej ligi jest wyłącznie dorobek interaktywny
ECFR/Bruegel. (IFRI, Clingendael — cyfrowo ≈ poziom SWP.)

---

## 4. Think-tanki rosyjskie

### 4.1 Klub Wałdajski[^14]

**Profil.** Klub dyskusyjny powiązany z Kremlem; codzienne komentarze eksperckie, doroczne zjazdy, pełne
lustro RU/EN. Najbardziej dopracowany serwis w lidze; cel: zasięg narracyjny, nie przychód.

| Moduł        | Ocena   | Dlaczego                                                                                                                                                   |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 3,6     | Języki 7,5 (pełne lustro RU/EN — najlepsze w całej stawce think-tanków), live 3,0 (relacje ze zjazdów); zero monetyzacji/personalizacji (model państwowy). |
| Strony       | 2,8     | Okazjonalne infografiki (3,5); reszta klasyczna.                                                                                                           |
| Wyszukiwarka | 2,9     | Taksonomia tematów/ekspertów (4,5); bez inteligencji.                                                                                                      |
| Czat         | 0,0     | Brak.                                                                                                                                                      |
| Profile      | 2,7     | Strony ekspertów z agregacją komentarzy (5,5); prywatność 2,0 (brak reżimu RODO).                                                                          |
| **Średnia**  | **2,4** |                                                                                                                                                            |

### 4.2 RIAC — Russian International Affairs Council[^15]

**Profil.** Rada powołana dekretem prezydenckim; duży dwujęzyczny portal z rozbudowanym katalogiem
ekspertów i (historycznie) blogami użytkowników — najbliżej „platformy" w rosyjskiej lidze.

| Moduł        | Ocena   | Dlaczego                                                                                     |
| ------------ | ------- | -------------------------------------------------------------------------------------------- |
| Wpisy        | 3,3     | Języki 7,0 (RU/EN); wolumen wysoki, czytanie 4,5 (gęsto, dated).                             |
| Strony       | 2,6     | Infografiki sporadyczne; brak konwersji.                                                     |
| Wyszukiwarka | 3,3     | Taksonomia + katalog ekspertów przeszukiwalny (5,5 — wyróżnik ligi).                         |
| Czat         | 0,0     | Brak komunikatora (blogi/komentarze użytkowników to publikacja, nie komunikacja prywatna).   |
| Profile      | 3,2     | Katalog ekspertów 6,0 (największy w lidze RU), szczątkowe konta użytkowników-blogerów (2,5). |
| **Średnia**  | **2,5** |                                                                                              |

### 4.3 IMEMO im. Primakowa[^16]

**Profil.** Akademicki instytut RAN (tradycja od 1956); serwis instytucjonalny, technicznie przestarzały,
częściowe EN.

| Moduł        | Ocena   | Dlaczego                                                     |
| ------------ | ------- | ------------------------------------------------------------ |
| Wpisy        | 2,4     | Języki 5,5 (RU + częściowe EN); czytanie 3,0 (archiwum PDF). |
| Strony       | 1,8     | Struktura instytutowa lat 2010.                              |
| Wyszukiwarka | 2,0     | Katalog biblioteczny.                                        |
| Czat         | 0,0     | Brak.                                                        |
| Profile      | 2,1     | Katalog pracowników naukowych (4,0) bez warstwy produktowej. |
| **Średnia**  | **1,7** |                                                              |

### 4.4 Russia in Global Affairs (SVOP)[^17]

**Profil.** Czasopismo Rady Polityki Zagranicznej i Obronnej; RU/EN, format journalowy.

| Moduł        | Ocena   | Dlaczego                                                                        |
| ------------ | ------- | ------------------------------------------------------------------------------- |
| Wpisy        | 2,9     | Języki 6,5; czytanie 4,5 (porządny serwis czasopisma); monetyzacja śladowa 1,5. |
| Strony       | 2,0     | Serwis numerów i tekstów; nic ponad.                                            |
| Wyszukiwarka | 2,1     | Archiwum z filtrami podstawowymi.                                               |
| Czat         | 0,0     | Brak.                                                                           |
| Profile      | 1,9     | Bio autorów.                                                                    |
| **Średnia**  | **1,8** |                                                                                 |

### 4.5 Zbiorcza — Rosja

| Podmiot                  | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| ------------------------ | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES**                  | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| RIAC                     | 3,3     | 2,6     | 3,3      | 0,0     | 3,2     | 2,5     |
| Klub Wałdajski           | 3,6     | 2,8     | 2,9      | 0,0     | 2,7     | 2,4     |
| Russia in Global Affairs | 2,9     | 2,0     | 2,1      | 0,0     | 1,9     | 1,8     |
| IMEMO                    | 2,4     | 1,8     | 2,0      | 0,0     | 2,1     | 1,7     |

**Wniosek sekcji:** liga zbudowana pod zasięg narracyjny finansowany przez państwo: wolumen i pełna
dwujęzyczność RU/EN (jedyne kryterium konkurencyjne wobec NES), technika ~dekadę wstecz, zero monetyzacji
i warstwy użytkownika. Kontekst: Carnegie Moscow Center zamknięte w 2022[^18]; serwisy bywają geoblokowane
w UE, co dodatkowo ogranicza ich konkurencyjność na rynku europejskim.

---

## 5. Think-tanki chińskie

Uwaga systemowa: chińskie instytuty prowadzą realną dystrybucję i interakcję na oficjalnych kontach
WeChat/Weibo — ich strony www to wizytówki. Ocena dotyczy stron (jak u wszystkich); ekosystem WeChat
odnotowuję w profilach, bez wliczania do not[^1].

### 5.1 CICIR — China Institutes of Contemporary International Relations[^19]

**Profil.** Instytut powiązany z aparatem bezpieczeństwa; strona chińskojęzyczna z ograniczonym EN,
publikacje PDF.

| Moduł        | Ocena   | Dlaczego                                                               |
| ------------ | ------- | ---------------------------------------------------------------------- |
| Wpisy        | 1,9     | Czytanie 2,5, języki 3,5 (EN wybiórcze); brak wszystkiego pozostałego. |
| Strony       | 1,7     | Statyczna witryna instytucjonalna.                                     |
| Wyszukiwarka | 1,7     | Prosty indeks.                                                         |
| Czat         | 0,0     | Brak (interakcja na WeChat — poza własną platformą).                   |
| Profile      | 1,6     | Listy badaczy.                                                         |
| **Średnia**  | **1,4** |                                                                        |

### 5.2 CIIS — China Institute of International Studies[^20]

**Profil.** Instytut MSZ ChRL; CN/EN, serwis statyczny.

| Moduł        | Ocena   | Dlaczego                              |
| ------------ | ------- | ------------------------------------- |
| Wpisy        | 1,9     | Jak CICIR; EN nieco pełniejsze (4,0). |
| Strony       | 1,7     | Statyka.                              |
| Wyszukiwarka | 1,7     | Indeks.                               |
| Czat         | 0,0     | Brak.                                 |
| Profile      | 1,6     | Listy badaczy.                        |
| **Średnia**  | **1,4** |                                       |

### 5.3 SIIS — Shanghai Institutes for International Studies[^21]

**Profil.** Szanghajski instytut; profil jak CIIS.

| Moduł        | Ocena   | Dlaczego       |
| ------------ | ------- | -------------- |
| Wpisy        | 1,9     | Jak CIIS.      |
| Strony       | 1,7     | Statyka.       |
| Wyszukiwarka | 1,7     | Indeks.        |
| Czat         | 0,0     | Brak.          |
| Profile      | 1,6     | Listy badaczy. |
| **Średnia**  | **1,4** |                |

### 5.4 CCG — Center for China and Globalization[^22]

**Profil.** Największy niezależny (formalnie) think-tank ChRL; najaktywniejszy anglojęzycznie (wydarzenia,
książki, delegacje), silne kanały WeChat/newslettery EN.

| Moduł        | Ocena   | Dlaczego                                                  |
| ------------ | ------- | --------------------------------------------------------- |
| Wpisy        | 2,4     | Języki 5,0 (aktywne EN), formaty 3,5 (wideo/wydarzenia).  |
| Strony       | 2,0     | Serwis żywszy od instytutów państwowych, wciąż statyczny. |
| Wyszukiwarka | 1,8     | Podstawowa.                                               |
| Czat         | 0,0     | Brak na platformie (społeczności WeChat — poza nią).      |
| Profile      | 1,8     | Bio zespołu i rady.                                       |
| **Średnia**  | **1,6** |                                                           |

### 5.5 Zbiorcza — Chiny

| Podmiot | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| ------- | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES** | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| CCG     | 2,4     | 2,0     | 1,8      | 0,0     | 1,8     | 1,6     |
| CICIR   | 1,9     | 1,7     | 1,7      | 0,0     | 1,6     | 1,4     |
| CIIS    | 1,9     | 1,7     | 1,7      | 0,0     | 1,6     | 1,4     |
| SIIS    | 1,9     | 1,7     | 1,7      | 0,0     | 1,6     | 1,4     |

**Wniosek sekcji:** najniższe noty zestawienia — ale to artefakt pomiaru „własnej platformy": realna gra
tych podmiotów toczy się w WeChat, gdzie mają zasięgi i społeczności nieosiągalne dla zachodnich stron www.
Lekcja dla NES jest dystrybucyjna (obecność tam, gdzie odbiorca), nie platformowa.

---

## 6. Think-tanki japońskie

### 6.1 JIIA — Japan Institute of International Affairs[^23]

**Profil.** Instytut afiliowany przy MSZ Japonii; JP/EN, komentarze i journal, serwis przestarzały.

| Moduł        | Ocena   | Dlaczego                          |
| ------------ | ------- | --------------------------------- |
| Wpisy        | 2,6     | Języki 5,5 (JP/EN); czytanie 3,5. |
| Strony       | 2,1     | Statyka instytucjonalna.          |
| Wyszukiwarka | 1,8     | Indeks publikacji.                |
| Czat         | 0,0     | Brak.                             |
| Profile      | 1,9     | Listy badaczy.                    |
| **Średnia**  | **1,7** |                                   |

### 6.2 Sasakawa Peace Foundation (SPF)[^24]

**Profil.** Duża fundacja z programami międzynarodowymi; najnowocześniejszy serwis w lidze JP.

| Moduł        | Ocena   | Dlaczego                                                               |
| ------------ | ------- | ---------------------------------------------------------------------- |
| Wpisy        | 2,9     | Języki 6,0, czytanie 4,5 (świeży design); brak monetyzacji (fundacja). |
| Strony       | 2,6     | Strony programów 4,0.                                                  |
| Wyszukiwarka | 2,2     | Filtry podstawowe.                                                     |
| Czat         | 0,0     | Brak.                                                                  |
| Profile      | 2,2     | Bio + programy.                                                        |
| **Średnia**  | **2,0** |                                                                        |

### 6.3 RIETI — Research Institute of Economy, Trade and Industry[^25]

**Profil.** Rządowy instytut ekonomiczny; głęboka, ustrukturyzowana baza working papers (autor/temat/rok)
— najlepszy „system biblioteczny" ligi japońskiej.

| Moduł        | Ocena   | Dlaczego                                                                |
| ------------ | ------- | ----------------------------------------------------------------------- |
| Wpisy        | 2,9     | Języki 6,0, SEO 4,5 (indeksowalna baza); formaty kolumny+papery.        |
| Strony       | 2,3     | Strony danych 3,0; reszta statyczna.                                    |
| Wyszukiwarka | 3,0     | Baza z realnymi filtrami (5,0/5,0) — wyróżnik; bez podpowiedzi/alertów. |
| Czat         | 0,0     | Brak.                                                                   |
| Profile      | 2,3     | Strony fellow z pełną listą prac (4,5).                                 |
| **Średnia**  | **2,1** |                                                                         |

### 6.4 NIDS — National Institute for Defense Studies[^26]

**Profil.** Instytut ministerstwa obrony; flagowy China Security Report, serwis archiwalny PDF.

| Moduł        | Ocena   | Dlaczego                      |
| ------------ | ------- | ----------------------------- |
| Wpisy        | 2,3     | Języki 5,5; reszta minimalna. |
| Strony       | 1,8     | Statyka.                      |
| Wyszukiwarka | 1,6     | Indeks.                       |
| Czat         | 0,0     | Brak.                         |
| Profile      | 1,7     | Listy badaczy.                |
| **Średnia**  | **1,5** |                               |

### 6.5 Genron NPO[^27]

**Profil.** Organizacja dialogu publicznego; unikatowy format: cykliczne sondaże opinii (JP–CN, JP–KR)
i transmitowane debaty.

| Moduł        | Ocena   | Dlaczego                                                          |
| ------------ | ------- | ----------------------------------------------------------------- |
| Wpisy        | 2,7     | Formaty 4,0 (sondaże + debaty wideo), live 2,5.                   |
| Strony       | 2,2     | Wizualizacje sondaży 2,5.                                         |
| Wyszukiwarka | 1,6     | Podstawowa.                                                       |
| Czat         | 0,0     | Brak (debaty to format redakcyjny, nie komunikacja użytkowników). |
| Profile      | 1,8     | Bio.                                                              |
| **Średnia**  | **1,7** |                                                                   |

### 6.6 Zbiorcza — Japonia

| Podmiot     | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| ----------- | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES**     | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| RIETI       | 2,9     | 2,3     | 3,0      | 0,0     | 2,3     | 2,1     |
| Sasakawa PF | 2,9     | 2,6     | 2,2      | 0,0     | 2,2     | 2,0     |
| JIIA        | 2,6     | 2,1     | 1,8      | 0,0     | 1,9     | 1,7     |
| Genron NPO  | 2,7     | 2,2     | 1,6      | 0,0     | 1,8     | 1,7     |
| NIDS        | 2,3     | 1,8     | 1,6      | 0,0     | 1,7     | 1,5     |

**Wniosek sekcji:** głębokie, dwujęzyczne archiwa przy cienkiej warstwie produktowej; jedyny element godny
uwagi to ustrukturyzowana baza RIETI (wzór dyscypliny bibliotecznej, nie technologii).

---

## 7. Think-tanki amerykańskie

### 7.1 CSIS — Center for Strategic and International Studies[^28]

**Profil.** Czołowy instytut bezpieczeństwa; własne studio cyfrowe (iDeas Lab) i trwałe microsites-produkty
(ChinaPower, Missile Threat, AMTI). Model grantowy — wszystko darmowe, zero warstwy użytkownika.

| Moduł        | Ocena   | Dlaczego                                                                                                                                                            |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 4,3     | Formaty 8,0 (sieć podcastów, wideo, transkrypty, microsites), czytanie 7,0, SEO 7,0; monetyzacja 1,5 i personalizacja 2,0 — nieobecne z założenia (model grantowy). |
| Strony       | 5,4     | Dorobek microsites 9,0 — najlepszy wśród think-tanków świata (ChinaPower = wzorzec kategorii); huby 7,5. Wszystko przez studio (builder 3,0), bez A/B (2,0).        |
| Wyszukiwarka | 4,4     | Porządne filtry (6,0/6,0), podpowiedzi 4,0; bez alertów i składni.                                                                                                  |
| Czat         | 0,0     | Brak komunikatora; interakcja = wydarzenia i newslettery.                                                                                                           |
| Profile      | 3,8     | Eksperci 7,5, katalog 6,5; zero warstwy użytkownika (1,0).                                                                                                          |
| **Średnia**  | **3,6** |                                                                                                                                                                     |

### 7.2 Brookings Institution[^29]

**Profil.** Największy amerykański think-tank generalistyczny; wzorcowe strony ekspertów, ogromne archiwum,
model grantowy.

| Moduł        | Ocena   | Dlaczego                                                                                             |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| Wpisy        | 4,3     | Czytanie 7,0, SEO 7,5, formaty 7,0 (podcasty, komentarze, raporty); brak monetyzacji/personalizacji. |
| Strony       | 4,8     | Huby 7,0, dorobek interaktywny 6,0 (wykresy, kalkulatory); bez buildera/A-B.                         |
| Wyszukiwarka | 4,6     | Filtry 6,5, eksperci 6,5 — czołówka TT; bez alertów/składni.                                         |
| Czat         | 0,0     | Brak.                                                                                                |
| Profile      | 4,0     | Strony ekspertów 8,0 (najlepsze po NES: pełny dorobek, tematy, media); katalog 7,0.                  |
| **Średnia**  | **3,5** |                                                                                                      |

### 7.3 Carnegie Endowment for International Peace[^30]

**Profil.** Sieć globalnych centrów (Waszyngton, Bruksela, Bejrut, Delhi, Berlin-Rosja/Eurazja[^18]);
publikacje w kilku językach — jedyny TT USA z realną wielojęzycznością.

| Moduł        | Ocena   | Dlaczego                                          |
| ------------ | ------- | ------------------------------------------------- |
| Wpisy        | 4,3     | Języki 6,0 (unikat w USA), czytanie 7,0, SEO 7,0. |
| Strony       | 4,6     | Huby centrów 6,5, dorobek 5,5.                    |
| Wyszukiwarka | 4,1     | Filtry 5,5, eksperci 6,0.                         |
| Czat         | 0,0     | Brak.                                             |
| Profile      | 3,8     | Eksperci 7,5/katalog 6,5.                         |
| **Średnia**  | **3,4** |                                                   |

### 7.4 CFR — Council on Foreign Relations[^31]

**Profil.** Organizacja członkowska z dopracowanym serwisem edytorskim; trwałe produkty referencyjne
(Global Conflict Tracker, Backgrounders, World101). Magazyn Foreign Affairs — osobny byt (poza oceną).

| Moduł        | Ocena   | Dlaczego                                                                                             |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------- |
| Wpisy        | 4,4     | Czytanie 7,5 (najlepsze w TT), formaty 7,5 (backgroundery, trackery, podcasty), SEO 7,5.             |
| Strony       | 5,2     | Dorobek 8,0 (Conflict Tracker, InfoGuides — produkty referencyjne), huby 7,0.                        |
| Wyszukiwarka | 4,3     | Filtry 5,5, podpowiedzi 4,0.                                                                         |
| Czat         | 0,0     | Brak komunikatora — członkostwo CFR to wydarzenia i dostęp, nie komunikacja online między członkami. |
| Profile      | 3,7     | Eksperci 7,0/katalog 6,0.                                                                            |
| **Średnia**  | **3,5** |                                                                                                      |

### 7.5 RAND Corporation[^32]

**Profil.** Instytut badawczy (kontrakty publiczne); największa fasetowa baza badań w świecie think-tanków

- alerty e-mailowe na tematy — funkcjonalnie najbliżej „produktu wyszukiwania".

| Moduł        | Ocena   | Dlaczego                                                                                                                                                  |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 3,9     | SEO 7,5 (wzorcowa indeksowalność), czytanie 6,5; formaty raportowe.                                                                                       |
| Strony       | 4,6     | Narzędzia danych 5,5, technika 6,5.                                                                                                                       |
| Wyszukiwarka | 5,6     | **Najlepsza wyszukiwarka think-tankowa świata**: fasety 8,0 (bije NES o 0,5), trafność 7,5 (remis z NES), alerty tematyczne 4,0 (remis); podpowiedzi 5,0. |
| Czat         | 0,0     | Brak.                                                                                                                                                     |
| Profile      | 3,8     | Eksperci 7,0/katalog 6,5.                                                                                                                                 |
| **Średnia**  | **3,6** |                                                                                                                                                           |

### 7.6 Atlantic Council[^33]

**Profil.** Waszyngtoński think-tank z dashboardami danych (GeoEconomics Center: sanctions dashboards)
i DFRLab; serwis WP-owy, model grantowy.

| Moduł        | Ocena   | Dlaczego                                                    |
| ------------ | ------- | ----------------------------------------------------------- |
| Wpisy        | 4,0     | Formaty 7,0 (dashboardy, trackery, podcasty); czytanie 6,5. |
| Strony       | 4,8     | Dorobek 7,5 (sanctions dashboards); huby 6,5.               |
| Wyszukiwarka | 3,9     | Filtry 5,0–5,5.                                             |
| Czat         | 0,0     | Brak.                                                       |
| Profile      | 3,7     | Eksperci 7,0/katalog 6,0.                                   |
| **Średnia**  | **3,3** |                                                             |

### 7.7 CNAS — Center for a New American Security[^34]

**Profil.** Średniej wielkości instytut bezpieczeństwa; czysty serwis, okazjonalne interaktywy (gry wojenne,
trackery sankcji).

| Moduł        | Ocena   | Dlaczego                  |
| ------------ | ------- | ------------------------- |
| Wpisy        | 3,4     | Czytanie 6,0, SEO 6,0.    |
| Strony       | 3,9     | Dorobek 4,5.              |
| Wyszukiwarka | 3,5     | Filtry 4,5–5,0.           |
| Czat         | 0,0     | Brak.                     |
| Profile      | 3,5     | Eksperci 6,5/katalog 5,5. |
| **Średnia**  | **2,9** |                           |

### 7.8 Zbiorcza — USA

| Podmiot          | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| ---------------- | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES**          | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| CSIS             | 4,3     | 5,4     | 4,4      | 0,0     | 3,8     | 3,6     |
| RAND             | 3,9     | 4,6     | 5,6      | 0,0     | 3,8     | 3,6     |
| CFR              | 4,4     | 5,2     | 4,3      | 0,0     | 3,7     | 3,5     |
| Brookings        | 4,3     | 4,8     | 4,6      | 0,0     | 4,0     | 3,5     |
| Carnegie         | 4,3     | 4,6     | 4,1      | 0,0     | 3,8     | 3,4     |
| Atlantic Council | 4,0     | 4,8     | 3,9      | 0,0     | 3,7     | 3,3     |
| CNAS             | 3,4     | 3,9     | 3,5      | 0,0     | 3,5     | 2,9     |

**Wniosek sekcji:** najsilniejsza cyfrowo liga think-tanków — ale w modelu grantowym: wszystko darmowe,
zero monetyzacji, personalizacji i warstwy użytkownika (stąd pułap ~3,6 mimo świetnych stron ekspertów
i microsites). Dwa realne benchmarki dla NES: **dorobek CSIS/CFR** (9,0/8,0 vs 4,0 NES — największa
pojedyncza luka NES w całym zestawieniu) i **fasety RAND** (8,0 vs 7,5 — jedyny think-tank bijący NES
w jakimkolwiek kryterium wyszukiwarki).

---

## 8. Media — serwisy publiczne (bez platform premium)

### 8.1 Reuters[^35]

**Profil.** Globalna agencja (~190 biur); serwis publiczny z metered paywallem i rejestracją, MyNews
(obserwowane tematy), zespół Reuters Graphics. Komentarze usunięte lata temu.

| Moduł        | Ocena   | Dlaczego                                                                                                                                                                           |
| ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 7,3     | Live 9,5 i SEO 9,0 (rdzeń agencyjny — poza zasięgiem każdego w zestawieniu), czytanie 8,0, języki 8,0 (edycje językowe), personalizacja 6,0 (MyNews); audio artykułów słabe (3,0). |
| Strony       | 6,7     | Reuters Graphics 8,5 (interaktywne specjalne), technika 8,0, lejek subskrypcji 7,0, A/B 7,0 (paywalle są testowane systematycznie).                                                |
| Wyszukiwarka | 3,6     | Zaskakująco podstawowa jak na skalę: filtr sekcja/data (5,0), bez ekspertów (2,0 — strony autorów), bez alertów wyszukiwań (2,5).                                                  |
| Czat         | 0,0     | Brak komunikatora; brak nawet komentarzy. Relacja z czytelnikiem = aplikacja/push/newslettery.                                                                                     |
| Profile      | 3,2     | Strony autorów 4,5, konto czytelnika 3,0 (preferencje MyNews); zero networkingu.                                                                                                   |
| **Średnia**  | **4,2** |                                                                                                                                                                                    |

### 8.2 Politico (.eu / .com)[^36]

**Profil.** Dziennikarstwo polityczne: rdzeń darmowy z reklamami + flagowe newslettery (Brussels Playbook)

- Politico Live. Bez PRO (poza oceną) brak trackerów legislacyjnych i alertów.

| Moduł        | Ocena   | Dlaczego                                                                                                                                                              |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 5,8     | Live 8,0, SEO 8,5, formaty 7,5 (newslettery to osobna klasa); paywall 4,0 (rdzeń darmowy — model reklamowo-eventowy), języki 4,5 (EN + edycje DE/FR w newsletterach). |
| Strony       | 5,8     | Poll of Polls i interaktywy wyborcze 7,0; lejki 5,5; A/B 6,0.                                                                                                         |
| Wyszukiwarka | 3,4     | Tagi i prosta wyszukiwarka (4,5–5,0); nic premium (to sprzedają w PRO).                                                                                               |
| Czat         | 0,0     | Brak komunikatora i komentarzy.                                                                                                                                       |
| Profile      | 3,2     | Strony dziennikarzy 5,0; konto = preferencje newsletterów (2,5).                                                                                                      |
| **Średnia**  | **3,6** |                                                                                                                                                                       |

### 8.3 Bloomberg.com[^37]

**Profil.** Serwis publiczny grupy (bez Terminala); najlepsze czytanie i grafika danych w kategorii
(Bloomberg Graphics), audio artykułów, metered paywall.

| Moduł        | Ocena   | Dlaczego                                                                                                                                                        |
| ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 7,5     | Czytanie 9,0 (benchmark), audio 7,0 (lektor/AI w aplikacji i web), live 8,5, paywall 8,0; personalizacja 5,5 (konto+newslettery; watchlisty głównie finansowe). |
| Strony       | 7,3     | Bloomberg Graphics 9,5 — światowy szczyt interaktywnego storytellingu; lejek subskrypcji 8,0; A/B 8,0.                                                          |
| Wyszukiwarka | 4,0     | Porządna, ale płytka (6,0/5,5); wyszukiwanie zaawansowane żyje w Terminalu (poza oceną).                                                                        |
| Czat         | 0,0     | Brak komunikatora i komentarzy.                                                                                                                                 |
| Profile      | 3,2     | Strony autorów 4,5; konto czytelnika 3,0.                                                                                                                       |
| **Średnia**  | **4,4** |                                                                                                                                                                 |

### 8.4 Financial Times[^38]

**Profil.** Wzorzec modelu subskrypcyjnego; myFT (obserwowanie tematów/autorów z alertami), jedyna
w mediach żywa kultura komentarzy pod artykułami, zespół wizualny.

| Moduł        | Ocena   | Dlaczego                                                                                                                                                                                           |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wpisy        | 7,7     | Czytanie 9,0, paywall 9,0 (benchmark branżowy), personalizacja 9,0 (myFT — najlepszy system obserwowania w kategorii), audio 6,5 (audio artykułów + podcasty); języki 4,0 (EN + wydanie chińskie). |
| Strony       | 7,0     | Visual storytelling 8,5; lejek subskrypcji 8,5 (dekada optymalizacji); A/B 8,0.                                                                                                                    |
| Wyszukiwarka | 4,8     | Najlepsza w mediach publicznych: przyzwoita trafność 6,5, podpowiedzi 5,0 i — unikatowo — **alerty tematów myFT 6,0** (jedyne kryterium wyszukiwarki, w którym ktokolwiek bije NES).               |
| Czat         | 0,0     | **Brak czatu między użytkownikami.** Komentarze pod artykułami (najlepsze w mediach) to dyskusja publiczna pod treścią — funkcja innego rodzaju; nie podnosi noty czatu.                           |
| Profile      | 3,7     | Konto myFT 4,0 (obserwowani autorzy/tematy — najbliżej „profilu czytelnika" w mediach), strony autorów 5,5, prywatność 6,5; zero networkingu.                                                      |
| **Średnia**  | **4,6** |                                                                                                                                                                                                    |

### 8.5 The Economist[^39]

**Profil.** Tygodnik subskrypcyjny; pełne wydanie audio (unikat), Espresso, modele danych (prognozy
wyborcze, Big Mac Index). Celowa anonimowość autorów; komentarze zlikwidowane.

| Moduł        | Ocena   | Dlaczego                                                                                                     |
| ------------ | ------- | ------------------------------------------------------------------------------------------------------------ |
| Wpisy        | 6,5     | Audio 9,0 (całe wydanie czytane — lider stawki), czytanie 8,5, paywall 8,5; live 4,0 (tygodnik), języki 2,5. |
| Strony       | 6,6     | Interaktywy danych 7,5, lejek 8,0, A/B 7,5.                                                                  |
| Wyszukiwarka | 3,6     | Standard serwisowy (5,0–5,5); bez ekspertów (anonimowość!).                                                  |
| Czat         | 0,0     | Brak komunikatora; komentarze usunięte.                                                                      |
| Profile      | 2,7     | Brak stron autorów z zasady (3,0/1,5); konto czytelnika 3,0.                                                 |
| **Średnia**  | **3,9** |                                                                                                              |

### 8.6 Axios[^40]

**Profil.** Model „smart brevity": newslettery jako rdzeń, serwis lekki i szybki; bez Axios Pro (poza
oceną) brak głębi archiwum.

| Moduł        | Ocena   | Dlaczego                                                                                      |
| ------------ | ------- | --------------------------------------------------------------------------------------------- |
| Wpisy        | 4,6     | Czytanie 7,5 (format skanowalny), SEO 7,5, live 5,5; paywall 3,0 (rdzeń darmowy), języki 2,0. |
| Strony       | 5,1     | Technika 7,0; wizualy proste (5,0).                                                           |
| Wyszukiwarka | 2,8     | Minimalna — archiwum nie jest produktem.                                                      |
| Czat         | 0,0     | Brak.                                                                                         |
| Profile      | 2,9     | Strony autorów 4,5; konto = newslettery.                                                      |
| **Średnia**  | **3,1** |                                                                                               |

### 8.7 Euractiv[^41]

**Profil.** Sieć mediów polityki UE z kilkunastoma edycjami językowymi; część treści premium
(bez Euractiv Pro — poza oceną). Technicznie średnia półka.

| Moduł        | Ocena   | Dlaczego                                                                                           |
| ------------ | ------- | -------------------------------------------------------------------------------------------------- |
| Wpisy        | 4,8     | Języki 7,0 (sieć edycji krajowych — wyróżnik), SEO 7,0, paywall 4,5 (część premium); czytanie 5,5. |
| Strony       | 3,9     | Sekcje polityk 5,0; skromne interaktywy.                                                           |
| Wyszukiwarka | 2,7     | Podstawowa.                                                                                        |
| Czat         | 0,0     | **Brak czatu** (i komentarzy); relacja = newslettery sektorowe.                                    |
| Profile      | 2,8     | Strony autorów 4,0; konto subskrybenta 2,0.                                                        |
| **Średnia**  | **2,8** |                                                                                                    |

### 8.8 Zbiorcza — Media

| Podmiot         | Wpisy   | Strony  | Szukajka | Czat    | Profile | **Śr.** |
| --------------- | ------- | ------- | -------- | ------- | ------- | ------- |
| **NES**         | **7,7** | **7,3** | **7,1**  | **7,5** | **7,8** | **7,5** |
| Financial Times | 7,7     | 7,0     | 4,8      | 0,0     | 3,7     | 4,6     |
| Bloomberg.com   | 7,5     | 7,3     | 4,0      | 0,0     | 3,2     | 4,4     |
| Reuters         | 7,3     | 6,7     | 3,6      | 0,0     | 3,2     | 4,2     |
| The Economist   | 6,5     | 6,6     | 3,6      | 0,0     | 2,7     | 3,9     |
| Politico        | 5,8     | 5,8     | 3,4      | 0,0     | 3,2     | 3,6     |
| Axios           | 4,6     | 5,1     | 2,8      | 0,0     | 2,9     | 3,1     |
| Euractiv        | 4,8     | 3,9     | 2,7      | 0,0     | 2,8     | 2,8     |

**Wniosek sekcji:** media to jedyna grupa z parytetem w module wpisów (FT 7,7 = NES 7,7; Bloomberg 7,5
włos niżej) i zbliżeniem w stronach (Bloomberg 7,3 = NES 7,3) — ale ich serwisy publiczne mają zaskakująco
słabe wyszukiwarki (zaawansowane szukanie sprzedają w produktach premium), szczątkowe profile i **zero
komunikacji między użytkownikami**. Model relacji mediów to nadawanie (push/newsletter), nie platforma.

---

## 9. Ranking końcowy i synteza

### 9.1 Ranking (39 podmiotów, czat sensu stricto, NES urealniony)

| #   | Podmiot                  | Typ       | Wpisy | Strony | Szukajka | Czat | Profile | **Śr.** |
| --- | ------------------------ | --------- | ----- | ------ | -------- | ---- | ------- | ------- |
| —   | **NES**                  | platforma | 7,7   | 7,3    | 7,1      | 7,5  | 7,8     | **7,5** |
| 1   | Financial Times          | media     | 7,7   | 7,0    | 4,8      | 0,0  | 3,7     | **4,6** |
| 2   | Bloomberg.com            | media     | 7,5   | 7,3    | 4,0      | 0,0  | 3,2     | **4,4** |
| 3   | Reuters                  | media     | 7,3   | 6,7    | 3,6      | 0,0  | 3,2     | **4,2** |
| 4   | The Economist            | media     | 6,5   | 6,6    | 3,6      | 0,0  | 2,7     | **3,9** |
| 5   | Politico                 | media     | 5,8   | 5,8    | 3,4      | 0,0  | 3,2     | **3,6** |
| 6   | CSIS                     | TT USA    | 4,3   | 5,4    | 4,4      | 0,0  | 3,8     | **3,6** |
| 7   | RAND                     | TT USA    | 3,9   | 4,6    | 5,6      | 0,0  | 3,8     | **3,6** |
| 8   | CFR                      | TT USA    | 4,4   | 5,2    | 4,3      | 0,0  | 3,7     | **3,5** |
| 9   | Brookings                | TT USA    | 4,3   | 4,8    | 4,6      | 0,0  | 4,0     | **3,5** |
| 10  | Carnegie                 | TT USA    | 4,3   | 4,6    | 4,1      | 0,0  | 3,8     | **3,4** |
| 11  | Atlantic Council         | TT USA    | 4,0   | 4,8    | 3,9      | 0,0  | 3,7     | **3,3** |
| 12  | ECFR                     | TT EU     | 3,8   | 4,5    | 3,8      | 0,0  | 3,8     | **3,2** |
| 13  | Axios                    | media     | 4,6   | 5,1    | 2,8      | 0,0  | 2,9     | **3,1** |
| 14  | Bruegel                  | TT EU     | 3,7   | 4,4    | 3,7      | 0,0  | 3,7     | **3,1** |
| 15  | Chatham House            | TT EU     | 4,0   | 4,1    | 3,3      | 0,0  | 3,7     | **3,0** |
| 16  | RUSI                     | TT EU     | 3,9   | 3,9    | 3,0      | 0,0  | 3,5     | **2,9** |
| 17  | CNAS                     | TT USA    | 3,4   | 3,9    | 3,5      | 0,0  | 3,5     | **2,9** |
| 18  | Euractiv                 | media     | 4,8   | 3,9    | 2,7      | 0,0  | 2,8     | **2,8** |
| 19  | RIAC                     | TT RU     | 3,3   | 2,6    | 3,3      | 0,0  | 3,2     | **2,5** |
| 20  | CEPS                     | TT EU     | 3,1   | 3,2    | 3,0      | 0,0  | 3,2     | **2,5** |
| 21  | SWP                      | TT EU     | 3,3   | 2,8    | 3,1      | 0,0  | 3,3     | **2,5** |
| 22  | Klub Wałdajski           | TT RU     | 3,6   | 2,8    | 2,9      | 0,0  | 2,7     | **2,4** |
| 23  | OSW                      | TT PL     | 3,5   | 2,5    | 2,3      | 0,0  | 2,3     | **2,1** |
| 24  | RIETI                    | TT JP     | 2,9   | 2,3    | 3,0      | 0,0  | 2,3     | **2,1** |
| 25  | PISM                     | TT PL     | 3,2   | 2,3    | 2,1      | 0,0  | 2,3     | **2,0** |
| 26  | Sasakawa PF              | TT JP     | 2,9   | 2,6    | 2,2      | 0,0  | 2,2     | **2,0** |
| 27  | Russia in Global Affairs | TT RU     | 2,9   | 2,0    | 2,1      | 0,0  | 1,9     | **1,8** |
| 28  | Klub Jagielloński        | TT PL     | 2,7   | 2,4    | 1,6      | 0,0  | 1,9     | **1,7** |
| 29  | Nowa Konfederacja        | TT PL     | 2,8   | 2,4    | 1,6      | 0,0  | 1,9     | **1,7** |
| 30  | Genron NPO               | TT JP     | 2,7   | 2,2    | 1,6      | 0,0  | 1,8     | **1,7** |
| 31  | IMEMO                    | TT RU     | 2,4   | 1,8    | 2,0      | 0,0  | 2,1     | **1,7** |
| 32  | JIIA                     | TT JP     | 2,6   | 2,1    | 1,8      | 0,0  | 1,9     | **1,7** |
| 33  | CCG                      | TT CN     | 2,4   | 2,0    | 1,8      | 0,0  | 1,8     | **1,6** |
| 34  | INE                      | TT PL     | 2,7   | 2,1    | 1,3      | 0,0  | 1,8     | **1,6** |
| 35  | NIDS                     | TT JP     | 2,3   | 1,8    | 1,6      | 0,0  | 1,7     | **1,5** |
| 36  | CICIR                    | TT CN     | 1,9   | 1,7    | 1,7      | 0,0  | 1,6     | **1,4** |
| 37  | CIIS                     | TT CN     | 1,9   | 1,7    | 1,7      | 0,0  | 1,6     | **1,4** |
| 38  | SIIS                     | TT CN     | 1,9   | 1,7    | 1,7      | 0,0  | 1,6     | **1,4** |

### 9.2 Gdzie konkurenci realnie biją urealniony NES (poziom kryteriów)

| Kryterium              | Kto bije NES                                                                                                                                                                    | Wynik vs NES | Uwaga                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------- |
| Czytanie artykułu      | Bloomberg, FT (9,0), Economist (8,5), Reuters (8,0), CFR/Axios (7,5), CSIS/Brookings/Carnegie/Politico (7,0)                                                                    | vs **6,5**   | najszerzej przegrywane kryterium NES      |
| **Dorobek microsites** | Bloomberg (9,5), CSIS (9,0), Reuters/FT (8,5), CFR (8,0), AC/Economist (7,5), ECFR/Politico (7,0), Bruegel (6,5), Brookings (6,0), Carnegie/RAND (5,5), Axios (5,0), CNAS (4,5) | vs **4,0**   | największa pojedyncza luka po urealnieniu |
| Live                   | Reuters (9,5), Bloomberg (8,5), FT/Politico (8,0)                                                                                                                               | vs 6,0       | rdzeń agencyjny, poza modelem NES         |
| Landingi konwersji     | FT (8,5), Bloomberg/Economist (8,0), Reuters (7,0)                                                                                                                              | vs 6,5       | dekada optymalizacji lejków               |
| Personalizacja         | FT — myFT (9,0)                                                                                                                                                                 | vs 7,0       | jedyny podmiot                            |
| Alerty wyszukiwania    | FT — myFT (6,0)                                                                                                                                                                 | vs 4,0       | jedyny podmiot; RAND remisuje (4,0)       |
| Fasety wyszukiwania    | RAND (8,0)                                                                                                                                                                      | vs 7,5       | jedyny think-tank                         |
| Audio                  | Economist (9,0)                                                                                                                                                                 | vs 8,0       | pełne wydanie audio                       |
| Paywall                | FT (9,0)                                                                                                                                                                        | vs 8,5       | wzorzec metered; Economist remisuje (8,5) |
| SEO                    | Reuters (9,0)                                                                                                                                                                   | vs 8,5       | Bloomberg/FT/Politico remisują (8,5)      |

**Nikt z 38 nie bije NES w żadnym kryterium czatu (wszyscy 0,0) ani profili** (najbliżej: Brookings —
strony ekspertów 8,0 vs 8,5, FT — profile czytelników 4,0 vs 7,5).

### 9.3 Synteza

1. **Po urealnieniu przewaga NES maleje (7,5 vs 4,6 lidera), ale nie znika w żadnym module** — nawet
   w najbardziej konkurencyjnych wpisach FT jedynie remisuje (7,7). Struktura przewagi się jednak zmienia:
   mniej „NES wygrywa wszystko", więcej „NES wygrywa integracją i modułami bez odpowiednika (czat 7,5 vs
   0,0; profile 7,8 vs 4,0), a przegrywa dorobkiem i wykończeniem".
2. **Dwie luki systemowe NES po urealnieniu:** dorobek interaktywny (4,0 — 15 podmiotów wyżej) i czytanie
   (6,5 — 10 podmiotów wyżej). Obie naprawialne bez nowej technologii: pierwsza treścią (2–3 flagowe digital
   features na istniejących widgetach), druga decyzją redakcyjną (tryb czytania).
3. **Moduły bez konkurencji (czat, profile) są przewagą warunkową** — ich noty (7,5/7,8) mierzą funkcje;
   wartość rynkowa = funkcje × użytkownicy. Przy pustej sieci realna wartość dziś jest bliższa opcji na
   przyszłość. Priorytet: zasiedlenie, nie rozbudowa.
4. **Właściwe benchmarki per moduł:** wpisy — FT; strony (dorobek) — Bloomberg Graphics/CSIS; wyszukiwarka
   — RAND (fasety) i FT (alerty); czat — brak (benchmarki tylko poza kategorią: WhatsApp/Slack, patrz
   `OCENA_MODULOW_2026-07-20.md`); profile — Brookings (eksperci) i… nikt (czytelnicy/networking).

---

## Przypisy

[^1]:
    Metodologia i ograniczenia: oceny eksperckie na podstawie publicznie dostępnych serwisów według
    stanu wiedzy do lipca 2026; brak dostępu do pełnej treści za paywallami (FT, Bloomberg, Economist, Reuters,
    Politico premium newsletters) i portalami członkowskimi (my.rusi.org, Chatham House members); serwisy
    rosyjskie bywają geoblokowane w UE; chińskie instytuty dystrybuują treść głównie przez oficjalne konta
    WeChat/Weibo, których ta analiza nie mierzy. Wykluczone produkty premium: politicopro.com,
    bloomberg.com/professional (Terminal), about.bgov.com, pro.bloomberglaw.com, reutersagency.com (Connect/
    Eikon), axios.com/pro, euractiv.com/pro, fpanalytics.foreignpolicy.com. Przed użyciem zewnętrznym
    (materiały inwestorskie, publikacje) zweryfikować szczegóły u źródła.

[^2]:
    NES: repozytorium NewEUStrategies/neweustrategies-dc633fb5 (HEAD `3ad0b40`, 2026-07-20); audyty
    wewnętrzne: `docs/OCENA_MODULOW_2026-07-20.md`, `docs/OCENA_UX_UI.md` (2026-07-11),
    `docs/AUDYT_PLATFORMY_2026-07-13.md`, `docs/OCENA_PLATFORMY.md`, `docs/ARCHITECTURE.md`; przekroczenia
    budżetu bundle udokumentowane w `docs/OCENA_UX_UI.md` (sekcja końcowa).

[^3]: pism.pl (wersje PL/EN).

[^4]: osw.waw.pl (PL/EN); kanał YouTube OSW.

[^5]: klubjagiellonski.pl; centrum analiz CAKJ; pismo „Pressje".

[^6]: nowakonfederacja.pl (mecenat, częściowy paywall).

[^7]: ine.org.pl (PL/EN).

[^8]: ecfr.eu; EU Coalition Explorer (ecfr.eu/special/eucoalitionexplorer); European Foreign Policy Scorecard.

[^9]: bruegel.org; sekcja Datasets (bruegel.org/datasets), np. European Clean Tech Tracker.

[^10]: chathamhouse.org; journal „International Affairs" (OUP); członkostwo indywidualne i korporacyjne.

[^11]: rusi.org; portal członkowski my.rusi.org; „RUSI Journal" (Taylor & Francis).

[^12]: swp-berlin.org (DE/EN).

[^13]: ceps.eu.

[^14]: valdaiclub.com / ru.valdaiclub.com (pełne lustro EN/RU).

[^15]: russiancouncil.ru (RU/EN); katalog ekspertów i historycznie blogi użytkowników.

[^16]: imemo.ru (RU, częściowe EN).

[^17]: globalaffairs.ru / eng.globalaffairs.ru („Russia in Global Affairs", SVOP).

[^18]:
    Carnegie Moscow Center zamknięte w kwietniu 2022; kontynuacja jako Carnegie Russia Eurasia Center
    (Berlin) w ramach carnegieendowment.org.

[^19]: cicir.ac.cn (CN, ograniczone EN).

[^20]: ciis.org.cn (CN/EN).

[^21]: siis.org.cn (CN/EN).

[^22]: ccg.org.cn / en.ccg.org.cn.

[^23]: jiia.or.jp (JP/EN); JIIA „Japan Review".

[^24]: spf.org (JP/EN).

[^25]: rieti.go.jp (JP/EN); baza working papers z filtrami autor/temat/rok.

[^26]: nids.mod.go.jp (JP/EN); „China Security Report".

[^27]: genron-npo.net (JP/EN); coroczne sondaże japońsko-chińskie i japońsko-koreańskie.

[^28]: csis.org; iDeas Lab; microsites: chinapower.csis.org, missilethreat.csis.org, amti.csis.org.

[^29]: brookings.edu.

[^30]: carnegieendowment.org (centra: DC, Europe, India, China–do 2023, Middle East, Russia Eurasia).

[^31]:
    cfr.org; Global Conflict Tracker (cfr.org/global-conflict-tracker); Backgrounders; World101
    (education.cfr.org). Magazyn „Foreign Affairs" (foreignaffairs.com) — odrębny produkt, poza oceną.

[^32]: rand.org; baza publikacji z fasetami i alertami tematycznymi (rand.org/pubs).

[^33]: atlanticcouncil.org; GeoEconomics Center (Global Sanctions Dashboard, Russia Sanctions Database); DFRLab.

[^34]: cnas.org.

[^35]:
    reuters.com; rejestracja + metered paywall (od 2021); MyNews; Reuters Graphics
    (reuters.com/graphics); komentarze wycofane.

[^36]:
    politico.eu / politico.com; newslettery (Brussels Playbook i in.); Politico Live; Poll of Polls
    (politico.eu/europe-poll-of-polls).

[^37]:
    bloomberg.com; metered paywall; Bloomberg Graphics (bloomberg.com/graphics); audio artykułów
    w aplikacji/na stronie dla subskrybentów.

[^38]:
    ft.com; myFT (obserwowanie tematów i autorów z powiadomieniami); komentarze pod artykułami dla
    subskrybentów; FT Visual Journalism; wydanie chińskie ftchinese.com.

[^39]:
    economist.com; pełne wydanie audio dla subskrybentów; Espresso; modele danych (prognozy wyborcze,
    Big Mac Index). Artykuły bez podpisów autorskich (polityka redakcyjna).

[^40]: axios.com; format „smart brevity"; rdzeń darmowy + newslettery.

[^41]: euractiv.com + edycje krajowe (m.in. .pl, .fr, .de); część treści premium.
