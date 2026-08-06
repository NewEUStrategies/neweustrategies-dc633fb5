# Wdrożenie: robots.txt - odzyskanie trasy przesłoniętej plikiem statycznym

**Data:** 2026-08-06 · **Zakres audytu:** wiersz `robots.txt` · **Ocena:** `9 → 4 → 9`

---

## 1. Punkt wyjścia i luka

Wiersz audytu brzmiał dokładnie tak:

| Funkcja    | Ocena     | Mocne                                                                                                        | Luka                                                                      | Rekomendacja                            |
| ---------- | --------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------- |
| robots.txt | **9 → 4** | Klasyfikacja hosta wspólna z kanonizacją, zakaz dla aliasów, `X-Robots-Tag`, indeks + news sitemap, kontrakt | **W produkcji trasa jest nieosiągalna** - `public/robots.txt` ją zasłania | Usunąć plik + test broniący tej ścieżki |

Sedno luki nie było w logice trasy, a w **precedencji warstwy hostingu**:
`public/robots.txt` (4 linie) jest kopiowany do `.output/public/`, a ten katalog jest
związany jako assety Workera bez `run_worker_first` dla tej ścieżki - **asset wygrywa z
workerem**. Trasa `src/routes/robots[.]txt.ts` nigdy nie była wykonywana na produkcji, a
crawler dostawał:

```
User-agent: *
Allow: /

Sitemap: https://neweuropeanstrategies.com/sitemap.xml
```

Czyli: `Allow: /` dla **każdego** hosta (a więc również dla aliasów hostingu, które
jednocześnie dostają 301 na origin kanoniczny - zaproszenie do indeksowania duplikatu),
brak news sitemap, brak `X-Robots-Tag`, zero logiki per tenant. Testy jednostkowe trasy
przechodziły, bo testowały kod, którego nikt nie wykonywał. Ta sama precedencja obowiązuje
na dev-serverze Vite (statyka z `publicDir` idzie przed SSR), więc błąd był identyczny
lokalnie i na produkcji - i przez to niewidoczny w obu miejscach.

---

## 2. Co zostało wdrożone

### 2.1 Usunięcie przesłonięcia

`public/robots.txt` usunięty. Trasa odpowiada od razu - potwierdzone na żywo:

```
$ curl -si http://127.0.0.1:4173/robots.txt
x-robots-tag: noindex, nofollow          # nagłówek wystawia WYŁĄCZNIE trasa
# Legacy / preview host - not the canonical domain.
User-agent: *
Disallow: /
```

### 2.2 Bramka CI: asset nie może przesłaniać trasy

`src/lib/ci/staticAssetShadowing.ts` (czysta logika) + `src/lib/ci/__tests__/staticAssetShadowing.test.ts`
(inwariant repozytorium). Bramka jest **generyczna**, nie „o robots.txt":

- wylicza adresy URL wszystkich plików z `public/` (dla `index.html` także adres katalogu -
  najgroźniejszy przypadek, bo zabija SSR całej strony, nie jednej końcówki);
- czyta ścieżki tras z `createFileRoute("…")` w `src/routes/**` (obsługuje escape'y `[.]`
  i segmenty parametryczne - statyczny `public/sitemaps/core.xml` przesłoniłby shard
  `/sitemaps/$section` i to też jest błąd);
- catch-all (`/$`) NIE jest liczony jako przesłonięty - asset ma wygrywać z trasą 404;
- wyjątki wymagają wpisu w `SHADOWING_ALLOWLIST` (dziś pusta), więc świadoma decyzja
  wdrożeniowa jest widoczna w diffie, a przypadkowy plik nie przechodzi.

Weryfikacja negatywna (bramka faktycznie łapie): po przywróceniu `public/robots.txt`
2 testy padają z komunikatem
`/robots.txt: public/robots.txt przesłania trasę /robots.txt (src/routes/robots[.]txt.ts)`.

### 2.3 Test e2e pochodzenia odpowiedzi

`e2e/seo.spec.ts` - nowy test sprawdza, że `/robots.txt` odpowiada **z trasy**, nie z pliku:
`X-Robots-Tag` jest znacznikiem pochodzenia (statyczny asset nigdy go nie wystawi) i
jednocześnie sygnałem dla crawlera. Test jest niezależny od hosta, na którym jedzie suita:
weryfikuje **spójność nagłówka z treścią** (`all` ⇒ `Allow: /` + `Disallow: /admin/` +
`Sitemap:`, `noindex` ⇒ `Disallow: /` i zero deklaracji sitemap). Bez poprawki pada na
brakującym nagłówku - sprawdzone.

### 2.4 Domena własna tenanta przestała być deindeksowana (`tenant_id`)

Trasa uznawała za kanoniczne **wyłącznie** dwa hosty marki, więc własna domena drugiego
tenanta (`tenants.domain`) wpadała w gałąź „nieznany host" → `Disallow: /`. Tymczasem ten
host serwuje swój serwis (nie dostaje 301 na markę), a jego `/sitemap.xml` odpowiada 200 z
adresami na jego originie. robots.txt sam kasował z indeksu cały serwis tenanta.

Decyzja jest teraz czysta i testowalna - `robotsModeFor` w `src/lib/seo/robots.ts`:

| Fakt o hoście                               | Tryb        | Dlaczego                                                                        |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| host kanoniczny marki                       | `canonical` | twarda lista w źródle - awaria bazy nie odcina marki od indeksu                 |
| alias hostingu / legacy / podgląd / lokalny | `legacy`    | alias dostaje 301, więc nie wolno go indeksować (wygrywa nawet nad zgłoszeniem) |
| własna domena tenanta (`tenants.domain`)    | `canonical` | serwuje swój serwis, jego mapa odpowiada 200 na tym originie                    |
| katalog domen pusty / nieosiągalny          | `canonical` | patrz 2.5                                                                       |
| host niezgłoszony przez nikogo (katalog OK) | `unknown`   | fail-closed: obca domena nie reklamuje cudzej treści                            |

Origin, na którym ogłaszamy mapy, liczy **ta sama** funkcja co dla samych map -
`crawlerPublishOrigin` w `src/lib/http/host.ts`, używana teraz i przez robots.txt, i przez
`sitemapRequest.server.ts`. Wcześniej reguła istniała w dwóch kopiach; rozjazd oznaczałby
mapę ogłoszoną pod originem spoza właściwości (Search Console taką mapę odrzuca).

### 2.5 Awaria warstwy danych nie może deindeksować serwisu

`Disallow: /` **podany na żywo** jest respektowany natychmiast (inaczej niż 5xx na
robots.txt, gdzie Google przez kilka godzin korzysta z ostatniej znanej kopii). Poprzedni
kod przy nieosiągalnym katalogu domen wystawiałby dla domeny tenanta pełny zakaz - czyli
awaria bazy zamieniałaby się w deindeksację. Degradacja jest teraz jawnym faktem
(`directoryDegraded`) i prowadzi do trybu kanonicznego, spójnie z resztą planu crawlera
(mapa oddaje wtedy szkielet na 200, a nie 404 - `crawlerDegradeIsSafe`).

### 2.6 Polityka crawlerów AI przestała być martwym kodem

`aiCrawlerDirectives()` w `src/lib/seo/settings.ts` była kompletna i przetestowana, panel
`/admin/settings/seo` miał oba przełączniki - ale **nikt tej funkcji nie wołał**:
„wpuszczaj crawlery wyszukiwawcze / treningowe" nie zmieniało ani jednego bajtu robots.txt.
Builder przyjmuje teraz gotowe grupy `User-agent` i dokleja je **po** grupie globalnej,
a rekordy `Sitemap` (bezgrupowe) zostają na końcu pliku. Kolejność jest objęta testem, bo
crawler stosuje najbardziej szczegółową grupę, która go dotyczy.

Podpowiedź w panelu mówi teraz prawdę (PL + EN, `admin.seoSettings.aiCrawlersHint`):
wyłączenie grupy dopisuje jej blok zakazu do `/robots.txt`.

### 2.7 Jeden przebieg I/O na żądanie

`src/lib/server/robotsPolicy.server.ts` skupia całą decyzję: klasyfikacja hosta, jedno
rozstrzygnięcie tenanta i **jeden** odczyt ustawień SEO (oba za cache'em per-izolat),
z których powstają i lista sitemap, i polityka AI. Host marki oraz alias nie pytają
katalogu w ogóle - decyzja jest już podjęta. Kontrakt modułu: **nigdy nie rzuca**.

---

## 3. Pliki

| Plik                                                | Zmiana                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `public/robots.txt`                                 | **usunięty** - przesłaniał trasę                                       |
| `src/lib/ci/staticAssetShadowing.ts`                | nowy - czysta logika bramki precedencji assetów                        |
| `src/lib/ci/__tests__/staticAssetShadowing.test.ts` | nowy - inwariant repozytorium + testy jednostkowe (13)                 |
| `src/lib/server/robotsPolicy.server.ts`             | nowy - polityka crawlerów dla hosta (tenant + ustawienia, best-effort) |
| `src/lib/server/__tests__/robotsPolicy.test.ts`     | nowy - granica host → tenant, degradacja, polityka AI (13)             |
| `src/lib/seo/robots.ts`                             | `robotsModeFor` + grupy `User-agent` w builderze                       |
| `src/lib/http/host.ts`                              | `crawlerPublishOrigin` - jedna reguła originu dla map i robots.txt     |
| `src/lib/server/sitemapRequest.server.ts`           | używa `crawlerPublishOrigin` (koniec z drugą kopią reguły)             |
| `src/lib/server/tenant.server.ts`                   | `resolveClaimedTenantForHost` - „czyja to własna domena"               |
| `src/routes/robots[.]txt.ts`                        | trasa woła politykę; komentarz o precedencji assetów                   |
| `e2e/seo.spec.ts`                                   | test pochodzenia odpowiedzi (`X-Robots-Tag`)                           |
| `src/lib/locale/{pl,en}.ts`                         | podpowiedź o crawlerach AI zgodna z zachowaniem (parytet PL/EN)        |
| `.github/workflows/ci.yml`                          | bramka precedencji + testy polityki w kroku kontraktu SEO              |

---

## 4. Weryfikacja

| Sprawdzenie                                    | Wynik                                                      |
| ---------------------------------------------- | ---------------------------------------------------------- |
| `bunx tsc --noEmit`                            | czysto                                                     |
| `vitest run` (kontrakty SEO, host, CI, server) | 497 → 523 testów, wszystkie przechodzą                     |
| Bramka przy przywróconym `public/robots.txt`   | pada z nazwą pliku i trasy (weryfikacja negatywna)         |
| `playwright test -g robots` na dev-serverze    | 2 przechodzą; bez poprawki test pochodzenia pada           |
| `curl -si /robots.txt`                         | odpowiada trasa: `x-robots-tag`, tryb podglądowy zamknięty |
