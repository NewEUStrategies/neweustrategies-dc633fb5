# Wdrożenie: kanał RSS trackera + domknięcie kontraktu sekcji „dowiesz się, że..." (2026-08-03)

**Data:** 2026-08-03 · **Baza:** `08f65f4` (gałąź audytu `claude/modules-audit-competition-analysis-lzudv2`,
PR #143) · **Gałąź:** `claude/tracker-rss-takeaways-contract-2026-08-03`

Mandat: dwie **korekty** z `OCENA_FUNKCJI_TABELE_2026-08-03.md` (audyt przyznał się do dwóch własnych
błędów) plus polecenie „optymalizuj i napraw". Ten dokument opisuje, co realnie zostało zbudowane -
i **co przy okazji wyszło jako trzeci, dotąd nieopisany defekt**.

---

## 1. Punkt wyjścia: co z korekt było prawdą, a co nie

| Zapis audytu                                                    | Weryfikacja na kodzie                                                                                                                                                                | Wniosek                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| „Tracker: obserwacje nikogo nie powiadamiają"                   | `tg_eu_policy_update_applied` robi fan-out `enqueue_notification` do `eu_policy_follows` + `emit_domain_event('policy.updated.v1')`; gałąź `'tracker'` jest w mapie preferencji      | **nieprawda - wycofane** |
| „brakuje e-mailowego digestu"                                   | `DIGEST_SECTIONS` w `lib/notifications/digestEmail.ts` ma sekcję `tracker` **jako pierwszą**, `dispatchDueDigests` wysyła przez `claim_due_digests` z listą wykluczeń i idempotencją | **nieprawda - wycofane** |
| „brak `tracker.rss.xml`"                                        | brak trasy, brak handlera, brak autodiscovery - potwierdzone                                                                                                                         | **prawda → wdrożone**    |
| „Key takeaways: dla stron gałąź renderu nigdy ich nie pokazuje" | kolumny + trigger na `pages`, loader je selectuje, render bez bramki `isPost`                                                                                                        | **nieprawda - wycofane** |

Z czterech zarzutów alertowo-takeawayowych realny był **jeden**. To nie znaczy, że nie było co naprawiać -
weryfikacja odkryła **defekt, którego żaden audyt nie widział** (§3).

## 2. Kanał RSS trackera (`/tracker/rss.xml`, `/en/tracker/rss.xml`)

Tracker był najbardziej „kanałową" treścią w serwisie bez kanału: kategoria, tag, program i podcast
mają feed od dawna, strumień zmian legislacyjnych - nie. RSS jest jedyną formą alertu, która **nie
wymaga konta** i którą czytają agregatory oraz redakcje.

### Architektura (warstwy, nie jeden plik)

| Warstwa        | Plik                                                                      | Odpowiedzialność                                                                                                                  |
| -------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Model czysty   | `src/lib/tracker/feed.ts`                                                 | scalanie dwóch strumieni, lokalizacja, GUID-y, porządek, limit. Zero React / Supabase / requestu                                  |
| Czytnik danych | `src/lib/server/publishedContent.server.ts` → `fetchTrackerFeedSources()` | service role + **jawny filtr tenanta**, `status='published'`, edge cache 60 s, degradacja do pustych list                         |
| Handler        | `src/lib/tracker/feed.server.ts`                                          | zaufany host → tenant **fail-closed (404)**, bramka `rss_enabled`, język z prefiksu URL, nagłówki cache 1:1 z pozostałymi feedami |
| Trasa          | `src/routes/tracker.rss[.]xml.ts`                                         | 12 linii - tylko GET → handler                                                                                                    |
| Atom UI        | `src/components/tracker/TrackerFeedLink.tsx`                              | wejście dla człowieka (i18n PL/EN, `hrefLang`, ikona, tytuł opisujący zawartość)                                                  |

### Decyzje projektowe (i dlaczego takie)

**Jeden kanał, dwa strumienie.** Pozycje to nowe opublikowane dossier **oraz** wpisy osi czasu, scalone
w jeden porządek czasowy. Czytelnik feedu chce jednej odpowiedzi na „co się zmieniło", nie dwóch
subskrypcji.

**Jawne GUID-y, `isPermaLink="false"`.** Wiele aktualizacji dzieli **jeden** adres dossier. Kanał z
guid=permalink wyglądałby dla czytnika jak duplikaty i po pierwszej pozycji przestałby pokazywać
alerty. Dlatego `RssItem` dostał opcjonalne pole `guid` (`tracker:item:<id>` / `tracker:update:<id>`),
a builder emituje `isPermaLink="false"` tylko wtedy, gdy je podano - **pozostałe feedy bez zmian**
(puste/whitespace guid degraduje do permalinku, co też jest przetestowane).

**Kotwica zamiast obietnicy.** Pozycje-aktualizacje linkują do `#update-<id>`. Taki cel **nie istniał**
w dokumencie, więc `<li>` osi czasu w `tracker.$slug.tsx` dostało `id` + `scroll-mt-24` (pod sticky
nagłówek). Kanał nie obiecuje czegoś, czego strona nie ma - to dokładnie klasa błędu, którą audyt
wypunktował w buderze (PR #141).

**Sieroty są odrzucane.** Aktualizacja bez swojego dossier na liście nie wchodzi do kanału. Nawet gdyby
czytnik kiedyś zwrócił wpis dossier nieopublikowanego albo z obcego tenanta, jego **treść nie wycieknie**

- to obrona w drugiej warstwie, obok filtra tenanta i RLS.

**Porządek deterministyczny.** Malejąco po dacie, remis rozstrzyga guid. Bez tiebreakera dwa wpisy z tej
samej sekundy zamieniałyby się miejscami między requestami i mrugały w czytnikach.

**Limit po scaleniu.** Okno dossier z bazy jest szersze niż limit kanału (`limit × 4`, min. 100), bo
starsze dossier musi być dostępne jako **kontekst** swojej świeżej aktualizacji (tytuł, obszar, etap).
Inaczej wpis osi czasu wypadłby z kanału jako sierota.

**Wielojęzyczność w obie strony.** Kanał ma osobne PL/EN (tytuł, opis, etykiety etapów i obszarów,
kwalifikator zmiany „etap: Parlament -> Rada" / „stage: Parliament -> Council"). Tu - inaczej niż w
sekcji takeaways - **jest** fallback na drugi język: pusty tytuł byłby pozycją-widmem w czytniku.

### Odkrywalność

- `<link rel="alternate" type="application/rss+xml">` w `<head>` **obu** tras trackera (indeks i dossier) -
  wzorzec z `category.$slug` / `tag.$slug`.
- Widoczny link (`TrackerFeedLink`) w nagłówku `/tracker` obok „explorer" i „co się zmieniło" oraz przy
  nagłówku osi czasu na stronie dossier.
- Wpis w `llms.txt` (PL i EN) - dla asystentów AI to najgęstsze źródło „co się zmieniło w prawie UE"
  w całym serwisie.

### Tenant, bezpieczeństwo

- Service role omija RLS → **oba** zapytania filtrują `tenant_id` tenanta właściciela hosta; nieznany
  host = 404 (fail-closed), identycznie jak `/rss.xml` i feedy taksonomii.
- Aktualizacje zawężone dodatkowo do id dossier, które przeszły `status='published'`.
- Kontrakt pgTAP (`supabase/tests/tracker_feed_tenant_isolation_test.sql`, 8 asercji): kolumny tenanta,
  przepisanie `tenant_id` aktualizacji z dossier nadrzędnego przez trigger, oraz **fail-closed RLS dla
  anon w tę samą stronę** - żeby przepisanie czytnika na klienta anonimowego też nie przeciekło.
- Zero `any` / `as any`; brak nowych zależności.

## 3. Trzeci defekt - rozjazd limitów sekcji „dowiesz się, że..." (nieopisany w żadnym audycie)

Weryfikując korektę nr 2 (która okazała się nieprawdą), znalazłem realny błąd **obok** niej. Limit
punktów żył w trzech warstwach i rozjechał się w każdej:

| Warstwa                                                             | Stan przed                                      | Skutek                                                    |
| ------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Trigger DB (`posts_validate_takeaways`, `pages_validate_takeaways`) | **7** (migracja `20260709100809` podniosła z 6) | -                                                         |
| Schemat zod (`content.functions.ts`, wpisy **i** strony)            | `.max(6)`                                       | **siódmego punktu nie dało się zapisać** - błąd walidacji |
| Panel edytora (`PostSettingsMetabox`)                               | licznik `/6`, przycisk blokowany na 6           | redakcja nie miała jak dojść do 7                         |
| Podpowiedź w tym samym panelu (PL i EN)                             | „Max **7** punktów"                             | **panel kłamał**                                          |

Naprawa: jedna stała w module czystym `src/lib/keyTakeaways/limits.ts`
(`KEY_TAKEAWAYS_MAX_ITEMS = 7`, `KEY_TAKEAWAYS_MAX_ITEM_LENGTH = 500`, rekomendacje długości), importowana
przez **wszystkie** warstwy TS, plus `normalizeTakeaways()` jako kanoniczna normalizacja (trim, usuń
puste, obetnij długość, obetnij liczbę - nadmiar **obcinany**, nie odrzucany: wklejenie ośmiu linijek ma
dać siedem punktów, nie błąd bez wskazania winnej linijki).

Podpowiedź panelu interpoluje teraz limit (`{{max}}`, `{{min}}`, `{{rec}}`), więc **nie może** znów
skłamać. Stronę bazy przypina kontrakt pgTAP
(`supabase/tests/takeaways_limits_contract_test.sql`, 10 asercji): 7 przechodzi, 8 rzuca `P0001` z
jawnym komunikatem, punkt >500 znaków odrzucony - **symetrycznie dla wpisów i stron**.

## 4. Domknięcie kontraktu, żeby korekta nr 2 nie wróciła

Sekcja działała, ale dwa audyty z rzędu orzekły odwrotnie - znak, że kod nie dawał się przeczytać
jednoznacznie. Trzy zmiany, każda testowana:

1. **Jeden seam rozstrzygania** - `src/lib/keyTakeaways/resolve.ts` (`resolveTakeaways(entity, lang)`),
   używany przez `routes/$.tsx` w `head()` (JSON-LD) i w body. Wcześniej to samo wyrażenie było
   policzone dwa razy w jednym pliku. Świadomie **bez** fallbacku między językami: polskie bullety na
   `/en` byłyby gorsze niż brak sekcji (i tak zachowywał się kod - teraz to decyzja zapisana i pilnowana).
2. **Nazwany kontrakt kolumn** - `ENTITY_SELECT_COLS` (`post` / `page` / `homepage`) + stała
   `TAKEAWAYS_SELECT_COLS` w `lib/queries/public.ts`. Najcieńsze ogniwo tej funkcji to select **stron**;
   test (`selectContract.test.ts`) pilnuje, że wszystkie trzy encje pobierają kolumny sekcji, że select
   strony niesie własne pola stron, i że **żaden** select encji nie ciągnie kolumn body (te idą wyłącznie
   przez gated RPC `get_entity_content`).
   Uwaga techniczna zapisana w kodzie: każdy wpis MUSI być jednym literałem szablonowym - konkatenacja
   `+` rozszerza typ do `string`, klient Supabase traci typowanie wiersza i wynik degraduje do
   `GenericStringError` (przejściowo wywołało to 6 błędów `tsc`, stąd komentarz-ostrzeżenie).
3. **Test symetrii wpis/strona** - `resolve.test.ts` przechodzi oba kształty encji jawnie.

## 5. i18n (PL/EN) - dług spłacony przy okazji

Zakładka „Dowiesz się, że..." miała **9 stringów zaszytych po polsku** (legenda wariantu, etykiety i
opisy czterech wariantów, tytuł podglądu, „Aktywny wariant:", puste stany, komunikaty długości,
placeholder, `aria-label` przycisku usuwania). Wszystkie mają teraz klucze **z realnymi wpisami PL i EN**
w `i18n-admin-extras.ts` - nie tylko `defaultValue`, bo klucz bez wpisu degraduje cicho do polskiego
tekstu (dokładnie ta pułapka, którą bramka `builderI18nKeys` złapała w PR #141).

Nowe klucze trackera (`tracker.feed.link`, `tracker.feed.title`) w `i18n-tracker.ts` w obu drzewach -
test parytetu bundli (`i18nSupportBundles.test.ts`) przechodzi.

`reports/i18n-parity.json`: `untranslated` 382 → 383 (klucz `variant.ghost` = „Ghost" w obu językach -
nazwa wariantu, świadomie identyczna).

## 6. Sygnały (zmierzone na tej gałęzi)

| Sygnał                                                | Wynik                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `vitest run`                                          | **4665 pass / 0 fail / 50 skip** (511 plików) - +40 testów wobec bazy                |
| `tsc --noEmit`                                        | czysto                                                                               |
| `eslint` + `prettier --check` na plikach tej zmiany   | czysto                                                                               |
| `check:sql-tenant-scope` / `app-role` / `anon-insert` | ✓ / ✓ / ✓ (504 funkcje, 870 literałów, 518 polityk)                                  |
| Nowe pliki pgTAP                                      | 2 (18 asercji) - odpalą się w jobie `pgtap`                                          |
| Nowe/zmienione testy jednostkowe                      | 26 asercji kanału, 20 limitów/rozstrzygania, 8 kontraktu selectu, 4 guid RSS, 1 llms |

## 7. Czego świadomie NIE zrobiłem

- **Import EUR-Lex/OEIL i diff wersji** - to jedyne pozostałe realne braki trackera, ale każdy z nich
  jest osobnym projektem (zewnętrzne API, harmonogram, mapowanie identyfikatorów procedur; diff wymaga
  wersjonowania treści dossier). Rozdzielone świadomie, żeby ten PR dał się zweryfikować.
- **Kanał per-dossier** (`/tracker/<slug>/rss.xml`) - jedno dossier dostaje wpis raz na tygodnie, więc
  byłby to kanał martwy; strona dossier wskazuje kanał całego trackera (autodiscovery + link).
- **Zmiany w pozostałych feedach** - rozszerzenie `RssItem` jest wstecznie zgodne; podcast/kategoria/tag
  emitują guid=permalink dokładnie jak dotąd (asercje w `rss.test.ts` bez zmian).

---

_Dokument towarzyszy `OCENA_FUNKCJI_TABELE_2026-08-03.md` (korekty 1, 1b i 2 zaktualizowane w tabelach
M1, M7 i M8). Treść artykułów pozostaje poza zakresem oceny - ten PR dotyczy wyłącznie mechaniki
platformy._
