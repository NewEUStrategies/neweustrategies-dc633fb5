# Ocena UX / UI / funkcjonalności pięciu modułów — wpisy, profile, wyszukiwarka, czat, strony

**Data:** 2026-07-20 · **HEAD:** `3ad0b40` · **Gałąź:** `claude/struktura-modulow-funkcji-38atfr`

Ocena kontynuuje metodologię `OCENA_UX_UI.md` (2026-07-11, werdykt 5,9/10) i `OCENA_KONKURENCYJNA_2026-07-13.md`:
skala 0–10 przyznawana surowo, punkt odniesienia to nie „czy działa", tylko „czy prowadzi użytkownika lepiej niż
konkurencja". Każdy moduł oceniam w trzech płaszczyznach (funkcjonalność / UX / UI) i przyrównuję do właściwych
dla niego konkurentów — innych dla czatu (WhatsApp/Messenger), innych dla buildera (Elementor/Webflow), innych
dla wyszukiwarki (Algolia, Politico Pro).

**Kontekst zmian:** od audytu 11.07 platforma przeszła „tydzień higieny" (menedżer nakładek, dark mode wg systemu,
jedna warstwa błędów i18n, overlay wyszukiwania przepięty na FTS, klawiatura w MegaMenu, wymiana wszystkich
`window.prompt`, cele dotykowe 44px) **oraz trzy duże przebudowy modułów**: wyszukiwarka premium (14–19.07: fasety,
autosugestie, ludzie/organizacje, składnia zaawansowana), czat klasy WhatsApp (12–16.07: potwierdzenia, głosówki,
grupy, znikające wiadomości, personalizacja) i sieć kontaktów w profilach (17–18.07: połączenia, rekomendacje,
endorsements). Dodano też tury onboardingowe buildera/edytora bloków (`src/lib/onboarding/`) i rozbudowano
`/pricing` (49 → 339 linii). Te zmiany realnie podnoszą oceny względem 11.07 — co odnotowuję wprost.

**Metodologia:** ocena z kodu (struktura, przepływy, stany, a11y, i18n) + wcześniejsze audyty empiryczne;
profile konkurentów ze stanu wiedzy publicznej (bez dostępu do ich kodu). To ocena ekspercka, nie badanie
z użytkownikami.

---

## Tabela zbiorcza

| Moduł            | Funkcjonalność | UX                                 | UI      | **Łącznie** |
| ---------------- | -------------- | ---------------------------------- | ------- | ----------- |
| Wpisy            | **9,0**        | 6,8 (czytelnik 6,5 / redakcja 7,0) | 7,0     | **7,6**     |
| Strony (builder) | **8,5**        | 7,0 (publiczny 7,5 / edytor 6,5)   | 7,0     | **7,5**     |
| Wyszukiwarka     | **8,5**        | **8,0**                            | 7,5     | **8,0**     |
| Czat             | **8,5**        | **8,0**                            | **8,0** | **8,2**     |
| Profile          | **8,5**        | 6,5                                | 7,0     | **7,3**     |
| **Średnia**      | **8,6**        | **7,3**                            | **7,3** | **7,7**     |

Progresja względem 11.07: UX/UI ogółem ~5,9 → ~7,3. Wzrost jest zasłużony (naprawy + przebudowy czatu
i wyszukiwarki), ale nierównomierny — moduły „społecznościowe najnowszej generacji" (czat, szukajka) są dziś
lepsze doświadczeniowo niż rdzeń wydawniczy (strona artykułu, IA profilu), który wciąż nosi stare długi.

---

# 1. WPISY — funkcjonalność 9,0 · UX 6,8 · UI 7,0

## 1.1 Funkcjonalność: 9,0 — szerokość, jakiej nie ma żaden bezpośredni konkurent

Co jest (dowody w kodzie):

- **Dwa silniki treści + dwa legacy** z jednym punktem decyzyjnym renderu (`contentEngine.ts`): bloki
  Gutenberg-style (~110 typów), builder Elementor-style, richtext/markdown; konwertery w obie strony.
- **Pełny workflow redakcyjny** (`draft → pending_review → scheduled → published → archived`) egzekwowany
  w trzech warstwach (UI / server-fn / trigger DB), publikacja planowana pg_cron, kosz z przywracaniem.
- **Rewizje** (snapshoty z throttlingiem, limit 50, restore niedestrukcyjny) + **presence współedycji**
  (Realtime, soft-lock) + autosave + undo/redo.
- **Paywall klasy produktowej**: treść fizycznie odcięta grantami kolumnowymi, wydawana przez RPC
  `get_entity_content`; tryby public/members/paid/password; zakup per-publikacja.
- **Warstwa okołoartykułowa**: spis treści (3 układy, nadpisania per wpis), key takeaways (3 warianty),
  przypisy z tooltipami, related posts v2 (konfigurowalne wagi + IDF + profil czytelnika), czas czytania,
  custom meta, breadcrumby, prev/next, auto-doczytywanie następnego wpisu.
- **TTS/audio**: własne MP3 per język + synteza ElevenLabs przez publiczny, paywall-aware endpoint z cache
  (`api/public/post-tts.ts`) — login-wall z audytu 11.07 usunięty.
- **Formaty satelickie**: live blog, Web Stories (AMP), importer WordPress, komentarze z moderacją,
  zakładki, śledzenie wyświetleń + trending.
- **SEO klasy agencyjnej** per wpis: pola tytuł/opis/canonical/noindex, generowane karty OG, JSON-LD,
  auto-301 przy zmianie sluga.

Czego brakuje (to trzyma ocenę poniżej 10): realtime współedycja to soft-lock, nie CRDT (Google Docs/Notion
edytują równolegle); brak diffu wizualnego między rewizjami (tylko lista + restore); brak asysty AI w edytorze
(dziś standard w Ghost/WordPress/Notion); brak komentarzy redakcyjnych per blok (Notion/Google Docs); listy
adminowe bez paginacji serwerowej (wszystkie posty do pamięci).

## 1.2 UX: czytelnik 6,5 · redakcja 7,0

**Czytelnik — mocne:** przypisy z tooltipami, LCP preload okładki 1:1 ze srcset, morph okładki (View
Transitions), auto-load next post z podmianą URL, TTS bez logowania, nakładki wreszcie zorkiestrowane
(`overlayCoordinator`: zgody → max 1 marketingowa, cooldown 30 s).

**Czytelnik — słabe (aktualne):** strona artykułu to nadal **kaskada konkurujących elementów** — w samym
`$.tsx` jest 11 odwołań do komponentów reklamowych (AdZone/MidPostAds/FooterSlideup), do tego inline TOC +
panel czytania w sidebarze, newsletter, komentarze, popup. Medium/Substack wygrywają czytanie właśnie
minimalizmem; tu czytelnik premium dostaje tor przeszkód. To najdroższy nienaprawiony defekt z audytu 11.07
(świadomie odłożony jako decyzja redakcyjna — podtrzymuję, że kosztuje ~1 pkt UX).

**Redakcja — mocne:** autosave + presence + rewizje + command palette (⌘K) to warsztat klasy Linear/Notion;
tury coachmark dla buildera i edytora bloków (nowość po 11.07); dialogi aplikacyjne zamiast `window.prompt`
(21 wywołań wymienionych); filtry pokrycia językowego w listach (ponadstandardowe).

**Redakcja — słabe:** edytor to monolit ~1400 linii z ~12 zakładkami metadanych zanim padnie pierwsze zdanie
tekstu (Ghost: piszesz od razu, metadane w wysuwanym panelu); 4 typy edytora w selekcie eksponują dług
techniczny na redaktora; 54 bloki w kubełku „advanced" w inserterze.

## 1.3 UI: 7,0

Motion pozostaje klasą premium (morph, shimmer, reveal, `prefers-reduced-motion` wszędzie). Po tygodniu higieny
typografia ma poprawny fallback, a Key Takeaways/TOC kolory marki zamiast indygo. Wciąż jednak: jedna rodzina
pisma na wszystko (brak kontrastu edytorskiego tytuł/proza, który definiuje wygląd The Verge/Politico), a rdzeń
komponentów to rozpoznawalny shadcn — poprawny, nie wyróżniający.

## 1.4 Porównanie z konkurencją (0–10)

| Kryterium                                               | **NES** | WordPress + wtyczki | Ghost | Medium/Substack | Serwisy think-tanków (ECFR/RUSI) |
| ------------------------------------------------------- | ------- | ------------------- | ----- | --------------- | -------------------------------- |
| Edytor treści (pisanie)                                 | 8       | 9                   | 8     | 7               | 5                                |
| Workflow redakcyjny (review, planowanie)                | **9**   | 7                   | 6     | 4               | 6                                |
| Rewizje i współpraca                                    | 7       | 7                   | 5     | 5               | 5                                |
| Paywall / monetyzacja treści                            | **9**   | 6                   | 8     | 7               | 5                                |
| Doświadczenie czytania                                  | 6,5     | 6                   | 8     | **9**           | 7                                |
| Formaty okołoartykułowe (TTS, live, stories, takeaways) | **9**   | 6                   | 4     | 3               | 6                                |
| SEO techniczne                                          | **9**   | 8                   | 7     | 6               | 6                                |
| Dwujęzyczność treści                                    | **9**   | 7                   | 4     | 2               | 6                                |
| Personalizacja / rekomendacje                           | 8       | 4                   | 4     | 8               | 3                                |
| **Średnia**                                             | **8,3** | 6,7                 | 6,0   | 5,7             | 5,4                              |

**Werdykt:** funkcjonalnie NES bije każdego z tych konkurentów z osobna (nikt nie ma naraz workflow + paywalla
kolumnowego + dwujęzyczności + TTS + live + stories). Przegrywa dokładnie tam, gdzie konkurencja jest najprostsza:
**czystością samego czytania** (Medium/Substack) i **prostotą pisania** (Ghost).

## 1.5 Rekomendacje

1. **Odchudzić stronę artykułu do „trybu czytania":** 1 TOC, 1 wskaźnik postępu, maks 2 strefy reklam dla
   niezalogowanych i 0–1 dla płacących (płacący nie powinien dostawać toru przeszkód).
2. **„Pisz od razu":** wejście do edytora prosto w treść, metadane jako wysuwany panel — wzorzec Ghost.
3. **Diff rewizji** (wizualne porównanie snapshotów) — niski koszt, duży zysk zaufania redakcji.

---

# 2. STRONY (builder) — funkcjonalność 8,5 · UX 7,0 · UI 7,0

## 2.1 Funkcjonalność: 8,5 — funkcjonalnie blisko Elementora, z przewagami nie do kupienia u niego

Co jest:

- **Drzewo sekcja → kolumna → widget, ~90 typów widgetów**, w tym kategoria „NES Digital Features"
  (timeline, sankey, macierz ryzyka, mapa korytarzy, porównywarka państw…) — format interaktywnych raportów
  think-tankowych, którego nie ma żaden page builder z półki.
- **System stylów**: wartości responsywne per breakpoint, wartości tematyczne jasny/ciemny, tła
  (obraz/gradient/wideo/slideshow), overlaye, shape dividers, motion presets, typografia per widget.
- **A/B testy sekcji** (bucketing + zdarzenia exposure/conversion) i **kontrola dostępu per sekcja**
  (gość/zalogowany/rola) — w Elementorze to płatne dodatki, w Webflow tego nie ma.
- **Widgety globalne** (live overlay + snapshot), **popupy z własnym builderem**, **wzorce startowe**,
  szablony stron (default/full_width/landing/archive_listing/contact), hierarchia stron z anty-cyklem
  i auto-301 przy przenoszeniu poddrzewa.
- Builder komponuje też **header/footer/menu** (chrome całego serwisu) i treści kampanii — jeden silnik,
  wiele powierzchni.
- **Wydajność publikacji**: SSR + streaming sekcji poniżej fold, budżet bundle w CI, brak CLS.

Czego brakuje: system klas/stylów globalnych jak w Webflow (styl definiowany per widget, nie per klasa —
skalowanie spójności na dziesiątkach stron jest droższe); brak niestandardowych breakpointów; edycja tekstu
głównie w panelu bocznym/modalu (`rich-text` otwiera edytor bloków w modalu), a Elementor/Webflow edytują
inline na kanwie; brak ekosystemu szablonów/marketplace (Elementor żyje z ekosystemu); brak collections/CMS
designer w stylu Webflow (tu zastępuje go osobny system wpisów — uczciwy trade-off).

## 2.2 UX: publiczny 7,5 · edytor 6,5

**Publiczny (odbiorca stron):** szybki SSR, streaming, zero CLS na reklamach, sekcje above-fold prefetchowane —
lepsze niż typowa strona Elementorowa o rząd wielkości (Elementor = najcięższe strony w ekosystemie WP).

**Edytor:** navigator drzewa, skróty, breakpointy, dark preview, undo/redo, autosave, tury onboardingowe
(nowość — audyt 11.07 wytykał „zero onboardingu") — to poziom rynkowy. Ograniczenia: drag&drop na natywnym
HTML5 DnD (mniej „miękki" niż dopracowany DnD Elementora/Framera), edycja treści nie-inline, właściwości
rozbite na 3 zakładki (content/style/advanced) z długimi listami bez wyszukiwarki właściwości.

## 2.3 UI: 7,0

Kanwa i panele czyste, spójne z resztą admina; podgląd responsywny i tematyczny wbudowany. Braki kosmetyczne:
paleta widgetów bez podglądów wizualnych (same ikony+nazwy; Elementor pokazuje miniatury), brak biblioteki
gotowych sekcji z podglądem (wzorce są, ale skromne).

## 2.4 Porównanie z konkurencją (0–10)

| Kryterium                               | **NES Builder** | Elementor | Webflow | WordPress FSE | Framer |
| --------------------------------------- | --------------- | --------- | ------- | ------------- | ------ |
| Zakres widgetów/bloków                  | 8               | **9**     | 8       | 7             | 7      |
| Swoboda projektowa (klasy, breakpointy) | 6               | 7         | **10**  | 6             | 9      |
| Responsywność (kontrola per breakpoint) | 8               | 8         | **9**   | 6             | **9**  |
| Wydajność publikowanych stron           | **9**           | 4         | 8       | 7             | 8      |
| A/B testy + kontrola dostępu sekcji     | **9**           | 5         | 4       | 2             | 5      |
| Widgety danych / digital features       | **9**           | 4         | 5       | 3             | 5      |
| Szablony i wzorce startowe              | 6               | **9**     | 8       | 7             | 8      |
| Dwujęzyczność stron                     | **9**           | 6         | 7       | 5             | 7      |
| Krzywa uczenia / onboarding             | 6               | 7         | 5       | 6             | 6      |
| Ekosystem / marketplace                 | 2               | **10**    | 8       | 9             | 6      |
| **Średnia**                             | **7,2**         | 6,9       | 7,2     | 5,8           | 7,0    |

**Werdykt:** NES gra w jednej lidze z Elementorem i Webflow, ale inną strategią: przegrywa swobodę projektową
i ekosystem, wygrywa wydajność publikacji, eksperymenty/dostęp per sekcja i widgety danych. Dla platformy
wydawniczej (nie agencji tworzącej dowolne strony) to właściwy kompromis.

## 2.5 Rekomendacje

1. **Inline editing tekstu na kanwie** (heading/text/button) — największa pojedyncza różnica odczuwalna
   względem Elementora/Webflow.
2. **Podglądy wizualne w palecie widgetów i wzorców** (miniatury zamiast ikon) — tani skok postrzeganej jakości.
3. **Globalne style/klasy** (choćby „style presets" per typ widgetu) — bez tego spójność wielu stron wisi na
   dyscyplinie redaktora.

---

# 3. WYSZUKIWARKA — funkcjonalność 8,5 · UX 8,0 · UI 7,5

Największy skok od 11.07: z oceny **5,0** (dwa silniki, zero podpowiedzi) do **8,0** — moduł przebudowany
w rundach 14–19.07 do klasy „premium search".

## 3.1 Funkcjonalność: 8,5

Co jest:

- **Postgres FTS z wagami** (A tytuł / B zajawka+takeaways / C treść, łącznie z tekstem z JSON bloków
  i buildera), `unaccent`, **lekki stemmer polski** (`nes_pl_light_stem` — fleksja), **fallback trigramowy**
  przy zerze wyników (tolerancja literówek), „did-you-mean" (`search_suggest`).
- **Fasety z hierarchią** (specjalizacja, typ publikacji, region→kraj, temat, projekt, seria, organizacja +
  autor, format, język, dostęp, rok) liczone po pełnym zbiorze trafień; sortowanie trafność/najnowsze/popularne;
  dokładny `total_count`; „load more" do 300.
- **Składnia zaawansowana**: `"fraza"`, `-wykluczenie`, tryby all/any/phrase, zakres tytuł/całość + ściąga
  składni w panelu.
- **Wyszukiwanie osób i organizacji** (`search_people_orgs`: eksperci z dorobkiem + organizacje, tylko profile
  `discoverable`) — wymiar, którego nie ma żaden polski konkurent.
- **Autosugestie w 4 koszykach** (tytuły / typy / tematy / ludzie i organizacje), popularne wyszukiwania,
  ostatnie wyszukiwania (localStorage), **zapisane wyszukiwania** dla zalogowanych.
- **Cztery powierzchnie, jeden silnik**: strona `/search`, overlay w nagłówku, widget buildera, globalna
  paleta ⌘K — wszystkie na tych samych RPC (defekt „dwóch silników" z 11.07 naprawiony).
- **Analityka zapytań** (`search_query_log` z rate-limit i deduplikacją → popularne frazy).
- **Cały stan w URL** (Zod) — wyniki linkowalne; SEO hreflang na stronie wyników.

Czego brakuje: **semantyki/AI** (wektory, synonimy, parafrazy — Algolia NeuralSearch, wyszukiwarki AI
Politico Pro/BGOV to dziś czoło stawki); fasety **jednokrotnego wyboru** per wymiar (brak multi-select OR);
**zapisane wyszukiwania nie mają alertów** (u Politico Pro alerty to rdzeń produktu — a mechanika notyfikacji
w platformie już jest!); brak wyszukiwania w załącznikach/PDF.

## 3.2 UX: 8,0

Mocne: autosugestie z klawiaturą i ARIA combobox/`aria-activedescendant`, chipy aktywnych filtrów z etykietami
rozwiązywanymi z faset, zakładki sekcji z licznikami, panel zaawansowany z edukacją składni, ratowanie zera
wyników (did-you-mean + popularne), stany ładowania szkieletowe, pełna dwujęzyczność. Debounce'y przemyślane
(180/200 ms), race-guard na odpowiedziach.

Słabe: jednokrotny wybór w wymiarze faset zaskakuje przy próbie zaznaczenia dwóch tematów; „load more" bez
wirtualizacji przy 300 wynikach; cztery powierzchnie wejścia mogą rozmywać nawyk (⌘K vs overlay vs widget —
do rozważenia konsolidacja wizualna).

## 3.3 UI: 7,5

Spójna z systemem, czytelna hierarchia wyników, podświetlenia `<mark>` z serwerowego `ts_headline` (bez
`dangerouslySetInnerHTML` — wzorowo). Karty osób/organizacji z awatarami i weryfikacją. Do dopracowania:
gęstość panelu faset na mobile.

## 3.4 Porównanie z konkurencją (0–10)

| Kryterium                       | **NES** | Algolia/Typesense (SaaS) | Politico Pro / BGOV | Typowy WordPress | Serwisy think-tanków |
| ------------------------------- | ------- | ------------------------ | ------------------- | ---------------- | -------------------- |
| Trafność (wagi, język polski)   | 8       | **9**                    | 8                   | 3                | 4                    |
| Literówki / fleksja             | 7       | **9**                    | 7                   | 2                | 3                    |
| Fasety / filtry                 | 8       | **9**                    | **9**               | 3                | 5                    |
| Autosugestie                    | 8       | **9**                    | 8                   | 2                | 4                    |
| Składnia zaawansowana           | **8**   | 7                        | **9**               | 2                | 3                    |
| Wyszukiwanie osób / organizacji | **8**   | n/d                      | 8                   | 1                | 6                    |
| Ratowanie zera wyników          | **8**   | 8                        | 7                   | 1                | 2                    |
| Zapisane wyszukiwania / alerty  | 5       | n/d                      | **10**              | 1                | 2                    |
| Analityka wyszukiwań            | 7       | **9**                    | 8                   | 1                | 2                    |
| Semantyka / AI                  | 2       | 8                        | **8**               | 1                | 1                    |
| **Średnia**                     | **6,9** | 8,5                      | 8,2                 | 1,8              | 3,2                  |

**Werdykt:** na tle CMS-ów i całej ligi think-tankowej (polskiej i większości zachodniej) wyszukiwarka NES jest
**bezapelacyjnie lepsza** — to poziom, który zwykle osiąga się dopiero wpinając Algolię. Do ligi „policy
intelligence" brakuje dwóch rzeczy: **alertów na zapisane wyszukiwania** (tanie — mechanika jest) i **warstwy
semantycznej** (drogie — świadoma decyzja inwestycyjna).

## 3.5 Rekomendacje

1. **Alerty do zapisanych wyszukiwań** (nowe wyniki → notyfikacja/digest) — najtańszy krok w stronę Politico Pro,
   infrastruktura powiadomień i digestów już istnieje.
2. **Multi-select w fasetach** (OR w wymiarze, AND między wymiarami) — standard Algolii.
3. Rozważyć **embeddingi na tytuł+zajawkę** (pgvector) jako drugi sygnał rankingu — umiarkowany koszt,
   duży skok trafności zapytań naturalnych.

---

# 4. CZAT — funkcjonalność 8,5 · UX 8,0 · UI 8,0

Najlepiej oceniany moduł platformy. Przebudowa 12–16.07 podniosła go z prostego komunikatora do klasy
WhatsApp/Messenger — z jedną fundamentalną różnicą (brak E2E) i dwiema lukami funkcyjnymi (wyszukiwanie
w treści, połączenia).

## 4.1 Funkcjonalność: 8,5

Co jest (wszystko egzekwowane w bazie, nie w UI):

- **DM + grupy „kręgi"** (do 50 osób, role, przekazanie własności, kandydaci filtrowani serwerowo).
- **Potwierdzenia** pending→sent→delivered→read z **wzajemną prywatnością** (ticki „read" tylko gdy obie
  strony mają włączone — WhatsApp robi to samo, Messenger nie daje wyboru), w grupie minimum po wszystkich.
- **Wskaźniki pisania** (grupowe, z wygasaniem per użytkownik), **presence online** z opcją ukrycia.
- **Edycja 5 min / cofnięcie wysłania** (tombstone + fizyczne usunięcie załącznika ze storage), **reakcje**,
  **odpowiedzi z przeskokiem**, **przekazywanie** (tekst), **prywatne gwiazdki**, **szkice per rozmowa**.
- **Załączniki** 30 MB z podpisami, galeria mediów (zdjęcia/pliki/oznaczone), lightbox, podgląd PDF;
  **głosówki do 10 min** z inline playerem.
- **Wiadomości znikające** (24h/7d/90d) wycinane już w RLS + twardy purge pg_cron; **czyszczenie „u mnie"**.
- **Personalizacja**: 7 motywów, tapety, szybkie emoji, pseudonimy per rozmowa (semantyka Messengera).
- **Prywatność**: `allow_messages_from` (wszyscy/istniejące/nikt), blokady niewidoczne dla blokowanego,
  discoverability opt-in, kanały Realtime prywatne (autoryzacja na `realtime.messages` — nikt spoza rozmowy
  nie podsłucha typing/presence).
- **Moderacja adminowa** per tenant (podgląd, ukrycie wiadomości, kasowanie rozmów, purge) + rate-limity
  i kwoty uploadu w DB.
- Integracja z powiadomieniami (fan-out z poszanowaniem wyciszeń, generyczny podgląd przy TTL), toasty,
  liczniki nieprzeczytanych utrzymywane triggerami.

Czego brakuje: **szyfrowanie E2E** (treści czytelne dla operatora bazy — dla platformy społecznościowej
think-tanku akceptowalne, ale to kategoria różnicy wobec WhatsApp; wymaga uczciwej komunikacji w polityce
prywatności); **wyszukiwanie w treści rozmów** (potwierdzone grep-em — jest tylko filtr listy rozmów po nazwie);
**połączenia audio/wideo** (LinkedIn/Messenger mają); brak wątków (Slack), przypinania wiadomości w rozmowie,
podglądów linków (OG unfurl).

## 4.2 UX: 8,0

Mocne: trzy powierzchnie spójnie (pełna skrzynka `/messages`, dock 1–3 okien, dzwonek z listą i wyszukiwarką
osób); optymistyczne wysyłanie z retry/discard przy błędzie; separatory dni, divider nieprzeczytanych, pigułka
„przewiń na dół" z licznikiem; staged attachments z podpisem przed uploadem; mikrofon morfujący w przycisk
wysyłki; **demo-bot** jako stan pusty (pokazuje możliwości zanim ktoś napisze pierwszą wiadomość — rzadki,
dobry pomysł). Deep-linki `?c=<id>` z powiadomień.

Słabe: brak wyszukiwania w historii to najbardziej odczuwalna luka codzienna; przekazywanie tylko tekstu
(zrozumiałe technicznie — ścieżki storage per rozmowa — ale użytkownik tego nie wie); brak wskaźnika
„wiadomość przeczytana przez X z Y" w grupach (jest tylko minimum).

## 4.3 UI: 8,0

Messengerowa klasa detalu: grupowane rogi dymków, powiększanie samych emoji, hover-bar szybkich reakcji,
ticki, motywy i tapety na żywo, awatary z presence. Emoji picker lazy (nie obciąża bundla). To najbardziej
„własny" wizualnie moduł platformy.

## 4.4 Porównanie z konkurencją (0–10)

| Kryterium                                   | **NES** | WhatsApp | Messenger | LinkedIn Messaging | Slack  |
| ------------------------------------------- | ------- | -------- | --------- | ------------------ | ------ |
| Podstawy (edycja, cofanie, reply, reakcje)  | **9**   | 9        | 9         | 6                  | 9      |
| Potwierdzenia + wzajemność prywatności      | **9**   | 9        | 8         | 7                  | 6      |
| Grupy                                       | 8       | 9        | 9         | 4                  | **10** |
| Załączniki / media / galeria                | 8       | 9        | 9         | 6                  | 9      |
| Głosówki                                    | 8       | **9**    | 9         | 5                  | 7      |
| Wiadomości znikające                        | **9**   | 9        | 8         | 1                  | 4      |
| Personalizacja (motywy, tapety, pseudonimy) | 8       | 6        | **9**     | 1                  | 4      |
| Wyszukiwanie w treści rozmów                | 1       | 9        | 8         | 6                  | **10** |
| Szyfrowanie E2E                             | 1       | **10**   | 7         | 3                  | 3      |
| Połączenia audio/wideo                      | 0       | **9**    | 9         | 5                  | 8      |
| Prywatność/kontrola (blokady, kto pisze)    | **9**   | 8        | 7         | 6                  | 5      |
| Moderacja platformy (admin, tenant)         | **8**   | n/d      | n/d       | n/d                | 9      |
| **Średnia**                                 | **6,5** | 8,7      | 8,3       | 4,5                | 7,0    |

**Werdykt:** porównanie z WhatsApp jest celowo bezlitosne (to komunikatory-produkty z tysiącami inżynierów) —
i mimo to NES wypada godnie, a **LinkedIn Messaging, faktycznego konkurenta w kategorii „czat wewnątrz platformy
profesjonalnej", bije wyraźnie** (6,5 vs 4,5). Żaden think-tank ani polski portal analityczny nie ma niczego
porównywalnego — w swojej rzeczywistej kategorii ten czat jest bezkonkurencyjny.

## 4.5 Rekomendacje

1. **Wyszukiwanie w treści rozmów** (FTS po `messages.body` z RLS już przefiltrowanym per członkostwo —
   infrastruktura FTS w platformie jest) — luka nr 1 w codziennym użyciu.
2. **Podgląd linków (OG unfurl)** po stronie serwera z cache — duży zysk odczuwalnej jakości za mały koszt.
3. Zakomunikować wprost w polityce prywatności model szyfrowania (TLS + RLS, bez E2E) — odbiorcy „policy"
   o to zapytają.

---

# 5. PROFILE — funkcjonalność 8,5 · UX 6,5 · UI 7,0

## 5.1 Funkcjonalność: 8,5 — LinkedIn-lite + strona eksperta think-tanku w jednym

Co jest:

- **Pakiet CV**: doświadczenie, edukacja, umiejętności (poziomy 1–5), nagrody, hobby, plik CV z wersjami —
  publicznie widoczne tylko gdy profil ma slug (`profile_is_public()`).
- **Sieć kontaktów klasy LinkedIn**: zaproszenia z wiadomością, **ciche odrzucenia** (nie do odczytania przez
  proszącego — wyłącznie RPC, zero grantów klienckich), sugestie „może znasz", wzajemne kontakty,
  **prośby o przedstawienie** (introductions), **endorsements umiejętności** i **pisemne rekomendacje**
  (tylko między połączonymi).
- **Hub eksperta** `/author/$slug`: tożsamość + funkcje w organizacjach + programy + obszary ekspertyzy +
  kontakt dla mediów + „w mediach" + filtrowany dorobek (artykuły/raporty/wideo/podcasty/wydarzenia),
  **układ konfigurowalny per tenant** (`expert_layout_settings`); katalogi `/experts` i `/people`.
- **Zaufanie**: odznaki (verified/expert/contributor/staff) nadawane przez admina z audytem, weryfikacja
  zawodowa, zgłoszenia i blokady.
- **Prywatność/RODO**: tryby widoczności oglądania profili (public/anonymous/private), discoverability opt-in,
  granty kolumnowe na email/prefs, **eksport danych i usunięcie konta** (art. 15/20), MFA, brute-force guard.
- **Personalizacja**: zainteresowania (kategorie/tagi, goście w localStorage z merge po zalogowaniu),
  obserwowanie autorów/kategorii/tagów, test osobowości Big Five z historią.
- **Analityka**: „kto oglądał mój profil" (dedupe 1h, respektuje tryb oglądającego), statystyki wyświetleń.

Czego brakuje: aktywności/postów użytkowników (LinkedIn feed — świadomie poza zakresem platformy wydawniczej);
stron organizacji jako profili (organizacje istnieją tylko jako taksonomia w szukajce); wskaźnika kompletności
profilu z podpowiedziami (LinkedIn „profile strength" — najtańszy mechanizm napędzania uzupełnień); CV nie
generuje się do PDF.

## 5.2 UX: 6,5 — najbogatszy moduł z najbardziej rozmytą architekturą informacji

Mocne: edycja inline per pole z optymistycznym zapisem (`useProfileEditor`), podgląd „jak widzi gość"
(`guestPreviewStore` — świetny wzorzec), przycisk połączenia jako jedna maszyna stanów wszędzie
(`ConnectButton`), onboarding zainteresowań po rejestracji (powitalna notyfikacja → `/profile/interests`).

Słabe (podtrzymane z audytu 11.07 — tu zmian nie było): **IA panelu jest przeciążona** — kilkanaście pozycji
nawigacji w 3 grupach, a tożsamość edytuje się w **trzech miejscach** (`/profile/account` dane podstawowe,
`/profile/author` profil ekspercki, `/profile/social` linki+bio kanoniczne) plus inline na `/profile`;
użytkownik nie wie, gdzie „mieszka" jego bio (jest `profiles.bio_pl/en` kanoniczne i legacy w
`author_profiles`). `profile.index.tsx` to ~1200-liniowy podwójny widok/edytor. Sieć (`/network`) i wiadomości
(`/messages`) wiszą poza panelem jako linki — szew architektoniczny widoczny dla użytkownika. Brak wskaźnika
kompletności profilu, który prowadziłby przez to bogactwo.

## 5.3 UI: 7,0

Karty CV, odznaki, siatka ekspertów — czysto i spójnie; hub eksperta z konfigurowalnym hero robi wrażenie
„produktu": to wizytówka, którą ekspert chce linkować. Panel samoobsługowy wizualnie poprawny, ale gęsty
(długie formularze bez sekcji-kotwic).

## 5.4 Porównanie z konkurencją (0–10)

| Kryterium                                     | **NES** | LinkedIn | ResearchGate | Strony ekspertów TT (ECFR/Brookings) | X   |
| --------------------------------------------- | ------- | -------- | ------------ | ------------------------------------ | --- |
| Tożsamość / CV                                | 8       | **10**   | 7            | 4                                    | 2   |
| Sieć kontaktów (zaproszenia, sugestie, intro) | 8       | **10**   | 6            | 0                                    | 5   |
| Endorsements / rekomendacje                   | 8       | **9**    | 5            | 0                                    | 0   |
| Profil eksperta + dorobek (publikacje, media) | **9**   | 6        | **9**        | 8                                    | 3   |
| Odznaki / weryfikacja                         | **8**   | 7        | 5            | 5                                    | 6   |
| Prywatność (tryby, RODO, granty kolumnowe)    | **9**   | 7        | 6            | 5                                    | 5   |
| Analityka profilu („kto oglądał")             | 7       | **9**    | 8            | 0                                    | 7   |
| Personalizacja treści z profilu               | 8       | **9**    | 7            | 2                                    | 8   |
| Onboarding / kompletność profilu              | 5       | **9**    | 6            | n/d                                  | 6   |
| **Średnia**                                   | **7,8** | 8,4      | 6,6          | 3,0                                  | 4,7 |

**Werdykt:** NES zbudował coś, czego nie ma nikt w jego lidze: **stronę eksperta klasy ECFR/Brookings
połączoną z siecią kontaktów klasy LinkedIn i prywatnością lepszą od obu**. Do LinkedIna brakuje przede
wszystkim mechaniki napędzania kompletności profilu i domknięcia IA — nie funkcji.

## 5.5 Rekomendacje

1. **Konsolidacja edycji tożsamości**: jedno miejsce edycji profilu (zakładki: podstawowe / ekspercki / social),
   reszta tras jako przekierowania — usuwa główny zamęt.
2. **Wskaźnik kompletności profilu** z listą kroków („dodaj zdjęcie", „poproś o rekomendację") — najtańszy
   wzrost jakości danych w katalogu ekspertów.
3. **Eksport CV do PDF** z huba eksperta — domyka pętlę wartości dla eksperta (powód, by uzupełniać profil).

---

# Wnioski przekrojowe

## Ranking modułów (łączna ocena)

| #   | Moduł        | Ocena   | Jedno zdanie                                                                                                               |
| --- | ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | Czat         | **8,2** | W swojej realnej kategorii (czat platformy profesjonalnej) bezkonkurencyjny; luki: wyszukiwanie w treści, E2E, połączenia. |
| 2   | Wyszukiwarka | **8,0** | Klasa „wpiętej Algolii" bez Algolii; brakuje alertów i semantyki, nie jakości.                                             |
| 3   | Wpisy        | **7,6** | Najszerszy funkcjonalnie silnik w stawce; czytanie wciąż przeładowane, pisanie zaczyna się od 12 zakładek.                 |
| 4   | Strony       | **7,5** | Liga Elementor/Webflow innym kosztem: mniej swobody projektowej, więcej wydajności i danych.                               |
| 5   | Profile      | **7,3** | Najbogatszy zestaw funkcji, najbardziej rozmyta architektura informacji.                                                   |

## Trzy obserwacje strategiczne

1. **Nowe moduły są lepsze od starych.** Czat i wyszukiwarka (przebudowane w ostatnich 10 dniach) mają
   spójność i wykończenie, których brakuje rdzeniowi wydawniczemu projektowanemu wcześniej (strona artykułu,
   panel profilu). Wzorce z tych przebudów (stany puste z demo, ratowanie zera wyników, prywatność w RLS,
   czyste maszyny stanów) warto przenieść wstecz na starsze moduły.
2. **Funkcjonalność wyprzedza UX o ~1,3 pkt** (8,6 vs 7,3). To ta sama diagnoza co 11.07, tylko na wyższym
   poziomie: platforma nadal „ma więcej niż pokazuje". Największe pojedyncze dźwignie: odchudzenie strony
   artykułu, konsolidacja edycji tożsamości profilu, wyszukiwanie w czacie, alerty wyszukiwarki.
3. **Względem konkurencji NES wygrywa integracją, nie pojedynczym modułem.** Medium czyta lepiej, Webflow
   projektuje swobodniej, WhatsApp szyfruje, LinkedIn napędza profile — ale nikt nie ma tych pięciu modułów
   naraz, w dwóch językach, na jednym paywallu, z jedną tożsamością i szyną zdarzeń. Ta integracja jest fosą;
   kolejne inwestycje powinny ją eksponować (np. wyniki czatu/profili w ⌘K, alerty szukajki w powiadomieniach,
   dorobek z wpisów na profilu — częściowo już się dzieje).

## Priorytety (koszt → efekt)

| Priorytet | Zadanie                                                           | Moduł         | Szacunkowy koszt           |
| --------- | ----------------------------------------------------------------- | ------------- | -------------------------- |
| P0        | Wyszukiwanie w treści rozmów                                      | Czat          | niski (FTS jest)           |
| P0        | Alerty do zapisanych wyszukiwań (notyfikacje/digest już są)       | Wyszukiwarka  | niski                      |
| P0        | Tryb czytania: 1 TOC, 1 progres, limit stref reklam               | Wpisy         | niski (decyzja redakcyjna) |
| P1        | Konsolidacja edycji tożsamości + wskaźnik kompletności            | Profile       | średni                     |
| P1        | Inline editing na kanwie buildera                                 | Strony        | średni                     |
| P1        | Multi-select faset; podgląd linków w czacie                       | Szukajka/Czat | średni                     |
| P2        | Warstwa semantyczna wyszukiwania (pgvector); diff rewizji; CV→PDF | różne         | wyższy                     |

**Realistyczny pułap po P0–P1: ~8,3/10 łącznie** — bez budowania nowych funkcji, wyłącznie przez domknięcie
doświadczenia wokół już istniejącego silnika.
