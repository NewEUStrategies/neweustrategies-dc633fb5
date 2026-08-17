# Wdrożenie: organizacja przy wpisie + oznaczenie materiału komercyjnego

_17.08.2026 · atrybucja organizacyjna w kroku 1 edytora wpisu oraz ujawnienie
komercyjne zgodne z prawem UE i polskim_

---

## 0. Co zostało zrobione

| #   | Pozycja                                                | Stan przed                                             | Stan po                                                                       |
| --- | ------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | Przypisanie organizacji do wpisu                       | brak - `posts` nie miało żadnej kolumny organizacyjnej | droplista + dialog w kroku 1, migawka na wpisie, karta atrybucji pod treścią  |
| 2   | Dodanie brakującej organizacji do CRM z edytora wpisu  | tylko `/admin/companies`, wyłącznie dla stafu CRM      | rozbudowany dialog z logo, działa też dla roli `author`                       |
| 3   | Logo organizacji w katalogu                            | kolumna `logo_url` istniała, ale RPC jej nie znały     | oba RPC katalogu czytają i zapisują logo                                      |
| 4   | Oznaczenie materiału komercyjnego                      | brak jakiegokolwiek pojęcia na poziomie wpisu          | pełne ujawnienie: pasek nad treścią, badge na listach, JSON-LD, ślad audytowy |
| 5   | Osierocony token `sponsor-label` w kolorach globalnych | zdefiniowany, zero konsumentów                         | zasila etykietę ujawnienia (tematyzowalna z Kokpitu bez nowej pracy)          |

Nowe pliki: migracja `20260817090000`, `src/lib/content/sponsored.ts`,
`src/lib/i18n-sponsored.ts`, trzy komponenty publiczne, dwie molekuły edytora.

---

## 1. Dlaczego organizacja jest MIGAWKĄ, a nie joinem

`crm_companies` jest czytelne wyłącznie dla stafu CRM
(`crm_companies_staff_read`, migracja `20260724053906`: `tenant_id =
current_tenant_id() AND (admin OR super_admin OR editor)`). Publiczny artykuł
renderuje się dla roli `anon`, więc join do tej tabeli zwróciłby `NULL`:

> karta organizacji byłaby **pusta na produkcji i pełna w panelu** - defekt
> widoczny dopiero po publikacji.

Rozwiązaniem NIE było dopisanie `anon` do polityki CRM - to wystawiłoby cały
katalog firm (z leadami po kluczu obcym) publicznie. Wpis niesie więc własną
kopię trzech pól prezentacyjnych: `organization_name`, `organization_logo_url`,
`organization_website`, plus `organization_id` jako referencję do CRM.

Kopia ma drugą, niezależną zaletę: jest **dowodem z chwili publikacji**.
Zmiana nazwy albo logo firmy w CRM nie przepisuje retroaktywnie tego, co
czytelnik realnie zobaczył. Odświeżenie migawki jest świadomą czynnością
redakcji (przycisk „Odśwież dane z CRM"), nie automatem.

`ON DELETE SET NULL` na `organization_id`: usunięcie firmy z CRM nie kasuje
atrybucji na opublikowanym wpisie.

---

## 2. Dlaczego dialog chodzi po RPC, a nie po `listCrmCompanies`

Serwerowe funkcje CRM stoją za `requireCrmStaff` (admin / editor /
super_admin), a wpisy pisze **także rola `author`**. Zdjęcie middleware'u nic by
nie dało - polityki RLS na `crm_companies` wymagają tych samych rol.

Właściwą ścieżką były istniejące funkcje `SECURITY DEFINER`, zawężone do
najemcy i nadane `authenticated` (migracja `20260725182640`, dziś używane przez
`components/profile/CompanyPickerDialog.tsx`):

- `search_companies_public(_query, _limit)` - pola prezentacyjne, **bez leadów
  i bez pipeline'u**, więc autor nie dostaje wglądu w sprzedaż;
- `create_company_self_service(...)` - ustawia `tenant_id` / `created_by` po
  stronie bazy, idempotentne po `(tenant_id, name_norm)`.

Obie powstały przed kolumną `logo_url` (`20260722093241`), więc katalog nie
umiał ani zwrócić logo, ani go zapisać - bez tego „dodanie organizacji wraz z
logo" było dla autora niewykonalne. Migracja `20260817090000` podnosi obie
(DROP + CREATE, bo zmiana `RETURNS TABLE` nie przechodzi przez `CREATE OR
REPLACE`), z ponownym `GRANT EXECUTE`.

Konsekwencja idempotencji, którą trzeba było obsłużyć w UI: gdy firma o tej
nazwie już istniała, RPC zwraca **jej** id i nie nadpisuje pól. Dialog dociąga
więc kanoniczny wiersz i buduje migawkę z bazy, nie z formularza - inaczej wpis
miałby adres, którego w CRM nie ma.

---

## 3. Ujawnienie komercyjne: co wymusiło jaki kształt

Pełne uzasadnienie z artykułami żyje w nagłówku migracji `20260817090000`
i w `src/lib/content/sponsored.ts`. Skrót mapujący przepis na pole:

| Podstawa                                            | Wymóg                                                                       | Realizacja                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Prawo prasowe art. 36 ust. 3                        | oznaczenie „nie budzące wątpliwości, iż nie stanowi materiału redakcyjnego" | pasek **nad** treścią, wersaliki, zdanie wprost w wariancie reklamowym                       |
| UPNPR art. 7 pkt 11 (zał. I pkt 11 dyr. 2005/29/WE) | oznaczenie w treści, rozpoznawalne **bez interakcji**                       | brak `<details>`, brak „pokaż więcej", render serwerowy                                      |
| UPNPR art. 7 pkt 11a                                | oznaczenie płatnych pozycji **w zestawieniach**                             | `SponsoredBadge` w `PostListCard` i w widgecie `post-list` + kolumny w trzech selectach list |
| UZNK art. 16 ust. 1 pkt 4                           | zakaz kryptoreklamy                                                         | render fail-safe (patrz §4)                                                                  |
| dyr. 2005/29/WE art. 7 ust. 2                       | korzyść **niepieniężna** też podlega ujawnieniu                             | wariant `barter` + niezależna flaga `sponsored_affiliate`                                    |
| uśude art. 9 ust. 1 pkt 1 (dyr. 2000/31/WE art. 6)  | podmiot zlecający **oraz jego adresy elektroniczne**                        | `sponsored_advertiser_url` w bramce publikacji, nie „opcjonalny"                             |
| Rekomendacje UOKiK (2022)                           | reguła dwuczęściowa CO + KTO; zakaz skrótów; język odbiorcy                 | etykieta z `sponsored_kind` (nie do wpisania ręcznie), `lng` przypięty do języka materiału   |
| DSA (2022/2065) art. 26 ust. 1 lit. b-c             | w czyim imieniu **oraz** kto zapłacił, gdy to inny podmiot                  | osobne `sponsored_payer_name`                                                                |
| rozp. (UE) 2024/900 art. 11 ust. 1                  | reklama polityczna: że to reklama, sponsor, podmiot kontrolujący, proces    | `sponsored_political*`, `sponsored_sponsor_controller`                                       |

Powierzchnie list, na których oznaczenie się pojawia: wspólna karta
`components/molecules/PostListCard` (strona główna, `/blog`, archiwa kategorii,
tagów i autora, publikacje, programy, serie - osiem miejsc wywołania) oraz
widget `post-list` buildera, przez współdzielony `TitleSpan` - jedyny punkt,
przez który przechodzą wszystkie jedenaście wariantów tego widgetu. Trzy
selecty musiały urosnąć o `is_sponsored, sponsored_kind, sponsored_affiliate`:
`blogArchiveQueryOptions` (`queries/public.ts`), `POST_COLS`
(`queries/archives.ts`) i select widgetu (`builder/postListQuery.ts`).

Dwie rzeczy warte podkreślenia:

**Rozporządzenie 2024/900 wiąże wydawcę BEZPOŚREDNIO** - inaczej niż DSA
art. 26, który adresuje „platformy internetowe" (serwis wydawcy nią nie jest,
por. art. 3 lit. i i motyw 13). Dla redakcji o polityce europejskiej to
najbardziej prawdopodobny reżim wiążący, bo art. 3 ust. 2 obejmuje przekazy
mogące wpłynąć **na proces legislacyjny lub regulacyjny**, a nie tylko na
wybory. DSA art. 26 przyjmujemy jako standard TREŚCI ujawnienia, bo jest
ostrzejszy niż minimum krajowe.

**Etykiety głównej nie da się wpisać ręcznie.** Redakcja wybiera RODZAJ relacji,
brzmienie przychodzi ze słownika. Pole tekstowe zapraszałoby do wpisania „#współpraca",
czyli dokładnie formy, którą UOKiK odrzuca. Do wyjaśnień ponad kanon służy
`sponsored_note_pl/_en` - **doklejane, nigdy zastępujące**.

---

## 4. Gdzie stoi która bramka (i dlaczego nie wszystkie w bazie)

Pierwsza wersja migracji wymagała `CHECK`-iem nazwy reklamodawcy przy każdej
wartości `is_sponsored = true`. To był **defekt, nie surowość**:

> `updatePost` jest ścieżką AUTOZAPISU (debounce 1500 ms). Redaktor, który
> zaznacza „materiał sponsorowany" i zaczyna wpisywać nazwę, ma przez kilka
> sekund stan „flaga bez nazwy" - a odrzucenie dotyczy **całego wiersza**, więc
> razem z deklaracją nie zapisałyby się niezwiązane zmiany tytułu i treści
> z tej samej migawki.

Twardy warunek na polu, które POWSTAJE PRZEZ PISANIE, blokuje edytor. Podział,
który z tego wynikł:

| Warstwa                                  | Czego pilnuje                                                                               | Dlaczego tam                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CHECK` w bazie                          | niezmienniki STRUKTURALNE: allowlista rodzajów, „flaga ⇒ rodzaj", „polityczna ⇒ komercyjna" | UI ustawia je jednym atomowym patchem, więc przejściowe naruszenie jest nieosiągalne            |
| serwer (`disclosureGaps` w `updatePost`) | kompletność pól TEKSTOWYCH, **tylko dla `published` / `scheduled`**                         | wersja robocza z niedokończoną deklaracją nikogo nie wprowadza w błąd; opublikowana - wprowadza |
| checklista publikacji                    | ta sama reguła, pokazana **przed** próbą publikacji                                         | redaktor widzi brak w karcie, nie dopiero w komunikacie błędu                                   |
| render (`resolveDisclosure`)             | etykieta ZAWSZE, gdy flaga włączona - nawet bez nazwy                                       | fail-safe, patrz niżej                                                                          |

**Fail-safe w stronę ujawnienia.** Gdy flaga jest włączona, a nazwy brakuje
(wiersz sprzed migracji, deklaracja w toku), etykieta pokazuje się mimo to - z
samym rodzajem relacji. Odwrotny wybór („brak nazwy ⇒ nie renderuj") wyglądał
na ostrożny, a dawał najgorszy możliwy stan: materiał opłacony **bez żadnego
oznaczenia**, czyli kryptoreklamę. Niepełna etykieta narusza regułę
dwuczęściową; brak etykiety narusza zakaz z listy czarnej. Wybieramy mniejsze.

Ta sama asymetria rządzi duplikowaniem wpisu: `duplicatePost` **kopiuje**
ujawnienie. Kopia z nadmiarową etykietą to pomyłka redakcyjna widoczna w karcie
i zdejmowana jednym kliknięciem; kopia bez etykiety to advertorial opublikowany
bez oznaczenia. Numer zlecenia się nie kopiuje - dotyczy jednej publikacji.

---

## 5. Warstwa maszynowa i granice, których nie przekroczyliśmy

Rekomendacje UOKiK mówią o oznaczeniu **dwupoziomowym**: widoczna etykieta plus
mechanizm platformy. Dla wydawcy drugim poziomem są dane strukturalne:

- `sponsor` (schema.org/CreativeWork) - niesie relację nawet gdy `@type`
  zostaje `NewsArticle`;
- `@type: AdvertiserContentArticle` **tylko** dla wariantu `advertisement`.
  Sponsoring z zachowaną niezależnością redakcyjną JEST materiałem redakcyjnym,
  więc podmiana typu byłaby nadgorliwa i zaniżałaby jego wartość w wyszukiwarce;
- `rel="sponsored nofollow noopener"` na linku reklamodawcy.

Czego pasek **nie** robi:

- nie przechodzi przez `allowAd()` ani budżet slotów reklamowych - legalne
  oznaczenie nie może zniknąć, bo wyczerpał się budżet albo czytelnik włączył
  tryb czytania;
- nie stoi wewnątrz `.article-body` - to selektor `speakable` oraz paywallowego
  `hasPart` w JSON-LD, więc etykieta byłaby czytana przez asystentów głosowych
  jako początek artykułu i traktowana przez Google jako treść płatna;
- nie zmienia `robots` ani nie wymusza `noindex`.

`sponsored_order_ref`, `sponsored_marked_by` i `sponsored_marked_at` są
**celowo** poza publicznym selectem i poza grantem kolumnowym - to ślad
rozliczalności dla redakcji, nie treść dla czytelnika.

---

## 6. Do rozstrzygnięcia przez redakcję (nie kod)

**Kolizja z zasadami współpracy.** `src/lib/i18n-community.ts` deklaruje
publicznie: _„Nie akceptujemy materiałów zleconych ani sponsorowanych"_ /
_„We do not accept sponsored or commissioned content"_ (klucz
`contributors.guidelinesBody`). To wprost sprzeczne z uruchomieniem tej
funkcji. Copy **nie zostało ruszone** - to decyzja redakcyjno-biznesowa, nie
techniczna. Do wyboru: zawężenie zasad do materiałów redakcyjnych od
kontrybutorów zewnętrznych, albo zdjęcie zdania.

**Retencja przy reklamie politycznej.** Rozp. 2024/900 art. 12 ust. 4 wymaga
przechowywania noty przejrzystości i jej zmian **7 lat** po ostatniej
publikacji. Dziś nota jest wyprowadzalna z kolumn wpisu (deterministycznie:
rodzaj + reklamodawca + proces + słownik), a historia zmian idzie przez
`content_revisions`. Jeśli audyt ma odtwarzać dokładny **tekst** pokazany
w danym dniu, a nie przeliczać go z dzisiejszego słownika - potrzebna jest
migawka renderowanej noty. Świadomie nieuwzględnione w tym wdrożeniu.

**Targetowanie.** Art. 26 ust. 1 lit. d DSA wymagałby ujawnienia parametrów
targetowania obok materiału. Materiały sponsorowane nie są dziś targetowane, co
spełnia ten punkt w sposób trywialny. Włączenie targetowania sponsorowanych
pozycji wymaga dołożenia tego bloku do paska.

---

## 7. Bramki

Zmiana przechodzi wszystkie bramki `check:*` wpięte w CI. Warte odnotowania:

- `check:types-freshness` - 14 kolumn dopisanych ręcznie do `posts.Row/Insert/Update`
  w `src/integrations/supabase/types.ts` (regeneracja to osobna zmiana, patrz
  nagłówek `scripts/check-generated-types-freshness.ts`);
- `check:i18n-overlay-imports` - `usePostEditorForm.ts` z 4 braków zszedł do 0,
  baseline zratchetowany w dół;
- `check:i18n-parity` + `post-editor/i18nParity.test.ts` - dwa nowe
  podnamespace'y (`organization`, `sponsored`) wpisane w `ADDED_NAMESPACES`,
  bo rozjazd PL/EN w oświadczeniu prawnym to nie kosmetyka;
- `PostDetailsNav.test.tsx` - 12 → 13 zakładek.

Nowe testy: `content/__tests__/sponsored.test.ts` (21 przypadków, każdy pilnuje
konkretnego wymogu prawnego), `post/__tests__/SponsoredDisclosure.test.tsx`
(12), `post-editor/molecules/__tests__/PostSponsoredCard.test.tsx` (9 - w tym
inwariant atomowego patcha z §4).
