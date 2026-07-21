# Rekomendacje: nowe funkcje i funkcjonalności — wpisy i strony

Data: 2026-07-20 · Zakres: moduły wpisów (posty/analizy) i stron (builder) oraz ich styk z dystrybucją.

Metoda: pełny inwentarz kodu (322 migracje, ~150 tabel, ~83 trasy admina, 2 silniki treści), zestawiony z
`AUDYT_PLATFORMY_2026-07-13.md`, `OCENA_MODULOW_2026-07-20.md`, `OCENA_KONKURENCYJNA_MODULOW_2026-07-20.md`
i aktywnym planem `.lovable/plan.md`. Każda pozycja oznaczona „nowa" została zweryfikowana przeciw kodowi
(grep po rejestrach bloków/widgetów, schemacie `types.ts`, trasach) — żadna nie dubluje istniejącej funkcji.

**Zasada przewodnia:** platforma funkcjonalnie wyprzedza całą stawkę think-tankową (śr. 8,3 za wpisy w ocenie
konkurencyjnej); wartość dodają dziś (1) funkcje, które eksponują istniejący silnik i dorobek, (2) domknięcia
pętli już w połowie zbudowanych, (3) higiena z audytu. Nie: kolejne duże moduły.

---

## 0. Co jest już zarekomendowane gdzie indziej (nie dublujemy)

| Dokument                                    | Pozycje tam przypisane                                                                                                                                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OCENA_MODULOW_2026-07-20.md` (P0–P2)       | tryb czytania artykułu; „pisz od razu" w edytorze; diff rewizji; inline editing na kanwie buildera; miniatury w palecie widgetów; style presets; alerty zapisanych wyszukiwań; multi-select faset; pgvector |
| `.lovable/plan.md` (fazy 1–4)               | scalenie kategorii + merge tool; walidator SEO w edytorze; sugestie linków wewnętrznych; dashboard Search Console                                                                                           |
| `OCENA_KONKURENCYJNA_MODULOW_2026-07-20.md` | 2–3 flagowe digital features / microsites (dorobek, nie zdolność); A/B na lejkach subskrypcji                                                                                                               |

Niniejszy dokument jest trzecim filarem: **backlog nowych funkcji produktowych** wpisów i stron.

---

## A. Wpisy — funkcje dla czytelnika

### A1. „Cytuj tę analizę" — P0, koszt niski, nowa

Box pod artykułem z gotowym cytowaniem w stylach **Chicago / APA / BibTeX** + przycisk kopiowania, plus tagi
`citation_*` (Highwire) w `<head>`. Wszystkie dane już są (`post_authors`, `published_at`, kanoniczny URL).
Standard Brookings/Bruegel, a w stawce PL/CEE prawie nieobecny; wzmacnia cytowalność w Google Scholar
i w odpowiedziach AI (spójne z istniejącą strategią `llms.txt`/GEO). Chicago zgodne z wewnętrznym standardem
przypisów NES. Opcja na później: DOI przez Zenodo/Crossref dla flagowych raportów.

### A2. Markowy PDF / policy brief do pobrania — P1, koszt średni, rozszerzenie

Dziś istnieje tylko `window.print()` w pasku udostępniania (`FloatingShareBar.tsx:329`) + bazowe style print.
Nowość: **serwerowo renderowany PDF** (Chromium już jest w stacku e2e) z okładką NES, stopką, numeracją stron
i przypisami końcowymi, per język. Wariant „pobierz PDF za e-mail" = lead magnet wpięty w istniejący CRM
i lead scoring. Decydenci i administracja wciąż obiegają PDF-y; ligi TT PL/RU/CN w praktyce żyją PDF-ami —
to pomost między „platformą" a ich kanałem dystrybucji.

### A3. Udostępnianie zaznaczonego cytatu — P1, koszt średni, nowa

Zaznaczenie tekstu → popover „Udostępnij na X / LinkedIn / kopiuj" + generowana **karta cytatu** (reuse
istniejącego generatora kart OG `ogCardCanvas.ts`, 1200×630, z logo i autorem). Mechanika znana z Medium/NYT,
nieobecna u żadnego konkurenta TT; bezpośrednio karmi kanały social (najkrótsza droga analiza → post).

### A4. Publiczna historia aktualizacji analizy — P1, koszt niski/średni, rozszerzenie

`content_revisions` już istnieją (snapshoty, restore). Nowość: opcjonalny publiczny changelog
(„Zaktualizowano 20.07: dodano dane za Q2") + `correction`/`dateModified` w JSON-LD. Buduje zaufanie do
„żywych" analiz i odróżnia od statycznych PDF-ów konkurencji; naturalne dopełnienie diffu rewizji (P2
w `OCENA_MODULOW`).

### A5. Blok ankiety w treści wpisu — P0, koszt niski, domknięcie

Moduł ankiet istnieje end-to-end (`/polls`, admin, RPC `vote_poll` — `publicQueries.ts:173`), ale wśród ~99
bloków edytora **nie ma bloku ankiety** — nie da się jej osadzić w analizie. Jeden nowy blok w rejestrze =
sondowanie czytelników w środku tekstu (zaangażowanie + materiał do kolejnych analiz).

### A6. Kontrolki audio: prędkość, ±15 s, wznowienie — P0, koszt niski, domknięcie

Luka wprost z audytu. TTS per artykuł to wyróżnik 9,0 vs 1,0–2,0 całej stawki — warto dociągnąć odtwarzacz
do standardu aplikacji podcastowych (prędkość 0.8–2×, skok ±15 s, zapamiętanie pozycji dla zalogowanych).
Mały koszt, chroni najbardziej rozpoznawalną przewagę modułu wpisów.

### A7. Słowniczek pojęć z tooltipami — P2, koszt średni, nowa

Tabela `glossary_terms` (PL/EN) + auto-podlinkowanie pierwszego wystąpienia terminu w treści, tooltip w
mechanice już istniejących dymków przypisów, strona zbiorcza słowniczka + JSON-LD `DefinedTerm`. Dla
czytelnika spoza bańki („akt delegowany", „TSI", „dual-use") obniża próg wejścia; SEO-owo zdobywa long-tail.

### A8. Serie / dossier — P2, koszt średni, nowa

Lekka taksonomia `series`: nagłówek „część 2 z 5" na wpisie, nawigacja poprzednia/następna w ramach serii,
strona serii składana builderem. Format flagowy think-tanków (cykle przedwyborcze, sankcyjne, energetyczne);
dziś osiągalny tylko ręcznie przez kategorie, bez sekwencji i licznika.

### A9. „Czy ta analiza była przydatna?" — P2, koszt niski, nowa

Jednokliknięciowy feedback (przydatne / nie) na końcu wpisu. Sygnał zasila istniejące wagi rekomendacji
(`related_posts_config` → popularity) i behawioralny lead scoring CRM. Tania pętla jakości bez komentarzy.

---

## B. Wpisy — funkcje dla redakcji

### B1. Kalendarz redakcyjny — P1, koszt średni, nowa

Widok kalendarza/kanbanu nad istniejącymi statusami i `publish_at`, z przeciąganiem wpisu na inną datę.
Jedyny kalendarz w adminie dotyczy dziś wydarzeń community. Standard newsroomowy; przy 5-statusowym
workflow i publikacji planowanej brak tego widoku jest najbardziej odczuwalną luką planowania.

### B2. Checklista przed publikacją — P0, koszt niski, domknięcie

Scoring kompletności SEO już istnieje w `/admin/seo` — wystarczy go zsyntetyzować w edytorze jako bramkę
przy „Publikuj": okładka, kategoria, zajawka, takeaways, SEO title/desc, wersja EN. Komplementarne wobec
walidatora SEO z fazy 2 `.lovable/plan.md` (tam liczniki znaków, tu kompletność wpisu).

### B3. Panel parytetu językowego PL/EN — P0, koszt niski, nowa

Test `lang-parity` jest dziś `describe.skip` (martwy w CI). Widok „wpisy bez wersji EN" + odznaka w liście
wpisów + filtr. Dwujęzyczność to ocena 9,0 i realny wyróżnik — ale bez pomiaru parytet będzie dryfował.

### B4. Robocze tłumaczenie AI PL→EN — P1, koszt średni, nowa

Przycisk w edytorze wypełniający pola `*_en` szkicem tłumaczenia (LLM), z flagą „wymaga weryfikacji
redakcyjnej". Platforma już używa zewnętrznego AI (ElevenLabs dla TTS) — analogiczna integracja. Przy
dwujęzycznym schemacie każdy wpis to dziś podwójna praca; to jest mnożnik tempa publikacji EN.

### B5. Linki podglądu z tokenem (embargo / prasa) — P1, koszt niski/średni, nowa

Podpisany, wygasający token → podgląd draftu bez konta. Kluczowy think-tankowy przepływ: udostępnienie
raportu dziennikarzom/partnerom/radzie przed premierą. Dziś draft widzi tylko zalogowany staff.

### B6. Duplikuj wpis / zapisz jako szablon — P0, koszt niski, nowa

Builder ma system szablonów, wpisy nie mają nawet „duplikuj". Dla powtarzalnych formatów (cotygodniowy
monitoring, format brief) to codzienna oszczędność.

### B7. Monitor martwych linków wychodzących — P2, koszt średni, nowa

Odwrotność istniejącego monitora 404/redirectów (tamten łapie ruch przychodzący): cron sprawdzający linki
zewnętrzne w opublikowanych wpisach + raport w adminie. Link rot to plaga starych analiz i cichy koszt
wiarygodności przypisów.

---

## C. Strony / builder

### C1. Biblioteka publikacji z fasetami — P1, koszt średni, nowa (flagowa dla stron)

Publiczny hub `/publikacje`: filtry typ / program / region / rok / język + pełnotekstowe wyszukiwanie.
Taksonomie (`post_programs`, `post_regions`, kategorie, tagi) i FTS już istnieją; to głównie kompozycja +
multi-select faset (zbieżne z P1 w `OCENA_MODULOW`). Ocena konkurencyjna nazywa NES „najmłodszą biblioteką"
— ta strona sprawia, że rosnący dorobek będzie widoczny od pierwszego dnia, tak jak u Bruegela/CSIS.

### C2. Uniwersalny form builder → CRM — P1, koszt średni, rozszerzenie

Widget „formularz niestandardowy" (pola definiowane w adminie → lead w CRM + webhook przez istniejący
outbox). Odblokowuje rejestracje na wydarzenia specjalne, pobrania raportów, zapytania o partnerstwo —
bez developera. CRM z lead scoringiem już jest; brakuje mu frontowych drzwi innych niż kontakt/newsletter.

### C3. Publikacja planowana stron — P0, koszt niski, wyrównanie

Wpisy mają `publish_at` + cron `publish_due_posts()`; strony mają tylko status i `published_at` (w schemacie
`pages` brak `publish_at`). Wyrównanie umożliwia punktualne premiery kampanii i landing pages.

### C4. Microsites jako produkt — P2, koszt wyższy, rozszerzenie

Domknięcie kierunku z `DIGITAL_FEATURES.md`: pakiet „microsite" = szablon landing + własna nawigacja +
własna paleta + subścieżka, składany w builderze. To infrastrukturalna połowa rekomendacji „2–3 flagowe
digital features" z oceny konkurencyjnej (tam treść, tu zdolność, by każdy kolejny kosztował popołudnie).

Rekomendacje UX buildera (inline editing, miniatury palety, style presets) — patrz `OCENA_MODULOW` §2.5.

---

## D. Dystrybucja i zasięg (styk wpisów z resztą platformy)

### D1. Subskrypcje tematyczne + alerty — P0/P1, koszt niski/średni, domknięcie (flagowa)

Wzorzec FT/myFT wskazany w ocenie konkurencyjnej jako najlepszy w kategorii. Wszystkie składniki istnieją:
obserwowanie (`follows`), widget `customize-interests`, digest/notyfikacje, segmenty newslettera
(`meta.mailing_lists` — wg audytu zapisywane, ale **nigdzie nie czytane**). Domknięcie pętli: obserwuj
program/temat/autora → alert lub cotygodniowy digest e-mail. Dla think-tanku to najważniejszy pojedynczy
mechanizm retencji — czytelnik polityki energetycznej nie chce całego firehose'a.

### D2. Auto-dystrybucja po publikacji — P1, koszt średni, domknięcie

Szyna zdarzeń i outbox integracji już istnieją; wg audytu brakuje UI zarządzania endpointami i adapterów
per serwis. Zdarzenie `post.published` → kolejka postów do LinkedIn/X/Slack (draft do akceptacji, nie
auto-publish). Skraca drogę publikacja → social, spójnie ze strategią komunikacji NES.

### D3. RSS per kategoria / program / tag — P0, koszt niski, rozszerzenie

Infrastruktura feedów (RSS per język, news-sitemap, podcast RSS) już jest — dodać kanały tematyczne.
Odbiorcy: agregatory, redakcje, power-userzy; niski koszt, a domyka obraz „technicznej dystrybucji 9,0".

### D4. Uporządkowanie web push — P2, koszt niski/średni, higiena

Audyt: działa jedna ścieżka push+digest, druga (`push_outbox` + npm `web-push`) jest martwa. Usunąć martwą,
zostawić jedną — dopiero potem ewentualne pushe „nowa analiza w obserwowanym temacie" (po D1).

---

## E. Najpierw dokończyć (higiena z audytu 13.07 dotycząca wpisów/stron)

Stan do weryfikacji — część mogła zostać naprawiona w commitach „security findings" po 13.07:

- reklamy renderują się na 2/7 zadeklarowanych typów stron; sloty `html`/`script` = stored-XSS w rękach edytora,
- przełączniki moderacji komentarzy (`moderate_new_comments`, `require_login_to_comment`) — no-op; konflikt okien edycji 5 vs 15 min,
- martwe ustawienia („zapisują, nikt nie czyta"): permalinki, `posts_per_page`, crop-sizes, `menu_primary`, defaulty karuzeli,
- blok `code` bez zapowiadanego kolorowania składni (stub w `registry.tsx:164`),
- daty w wersji EN formatowane `en-US` zamiast konwencji europejskiej,
- `ImageSlot` buildera omija rejestr mediów (uploady niewidoczne w bibliotece i cleanupie),
- TTS: sprawdzić obecność `has_content_access()` w `post-tts.ts` (potencjalny bypass paywalla),
- komentarze: wątkowanie tylko 1 poziom.

Zasada wdrożeniowa: każdy sprint funkcyjny zabiera 1–2 pozycje higieny.

---

## Tabela zbiorcza priorytetów

| P     | Pozycja                             | Moduł       | Koszt        | Charakter           |
| ----- | ----------------------------------- | ----------- | ------------ | ------------------- |
| P0    | A1 Cytuj tę analizę                 | wpisy       | niski        | nowa                |
| P0    | A5 Blok ankiety w treści            | wpisy       | niski        | domknięcie          |
| P0    | A6 Kontrolki audio                  | wpisy       | niski        | domknięcie          |
| P0    | B2 Checklista przed publikacją      | redakcja    | niski        | domknięcie          |
| P0    | B3 Parytet PL/EN                    | redakcja    | niski        | nowa                |
| P0    | B6 Duplikuj wpis                    | redakcja    | niski        | nowa                |
| P0    | C3 `publish_at` dla stron           | strony      | niski        | wyrównanie          |
| P0    | D3 RSS tematyczne                   | dystrybucja | niski        | rozszerzenie        |
| P0/P1 | D1 Subskrypcje tematyczne + alerty  | dystrybucja | niski/średni | domknięcie, flagowa |
| P1    | C1 Biblioteka publikacji z fasetami | strony      | średni       | nowa, flagowa       |
| P1    | A2 Markowy PDF / policy brief       | wpisy       | średni       | rozszerzenie        |
| P1    | A3 Udostępnianie cytatu             | wpisy       | średni       | nowa                |
| P1    | A4 Publiczny changelog analizy      | wpisy       | niski/średni | rozszerzenie        |
| P1    | B1 Kalendarz redakcyjny             | redakcja    | średni       | nowa                |
| P1    | B4 Tłumaczenie AI PL→EN             | redakcja    | średni       | nowa                |
| P1    | B5 Linki podglądu (embargo)         | redakcja    | niski/średni | nowa                |
| P1    | C2 Form builder → CRM               | strony      | średni       | rozszerzenie        |
| P1    | D2 Auto-dystrybucja po publikacji   | dystrybucja | średni       | domknięcie          |
| P2    | A7 Słowniczek pojęć                 | wpisy       | średni       | nowa                |
| P2    | A8 Serie / dossier                  | wpisy       | średni       | nowa                |
| P2    | A9 „Czy przydatne?"                 | wpisy       | niski        | nowa                |
| P2    | B7 Monitor linków wychodzących      | redakcja    | średni       | nowa                |
| P2    | C4 Microsites jako produkt          | strony      | wyższy       | rozszerzenie        |
| P2    | D4 Porządek w web push              | dystrybucja | niski/średni | higiena             |

---

## Rekomendowany pakiet startowy

1. **Sprint 1 — P0 (wszystkie niskim kosztem, czysto addytywne):** A1 cytowanie, A5 blok ankiety, A6 audio,
   B2 checklista, B3 parytet EN, B6 duplikuj, C3 publish_at stron, D3 RSS tematyczne. Równolegle z „trybem
   czytania" (P0 z `OCENA_MODULOW`) — razem domykają doświadczenie artykułu z obu stron.
2. **Sprint 2 — dwie flagowe:** D1 subskrypcje tematyczne (retencja) i C1 biblioteka publikacji (ekspozycja
   dorobku). Obie zamieniają istniejącą, niewidoczną infrastrukturę w widoczną wartość.
3. **Dalej wg potrzeb redakcji:** A2 PDF i B5 embargo (obieg decydencko-prasowy), B1 kalendarz + B4
   tłumaczenia (tempo), A3 quote-share + D2 auto-dystrybucja (zasięg).

Spójność strategiczna: pakiet nie konkuruje z „trzema mostami" z oceny konkurencyjnej (tryb czytania,
flagowe digital features, alerty wyszukiwarki) — uzupełnia je od strony produktu wydawniczego: wiarygodność
(cytowania, changelog), obieg poza web (PDF, embargo), retencja tematyczna (subskrypcje) i ekspozycja
dorobku (biblioteka).
