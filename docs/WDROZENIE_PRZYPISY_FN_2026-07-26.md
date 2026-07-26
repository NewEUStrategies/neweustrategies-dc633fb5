# Wdrożenie: trzy regresje w zunifikowanym silniku przypisów (2026-07-26)

> Kontekst: `AUDYT_PRZYPISY_FN_2026-07-25.md` wykazał, że `[fn]…[/fn]` działa tylko
> na jednej trasie i różni się między silnikami. Unifikacja została wdrożona
> niezależnie (na `main`: „Unified engine footnotes", „Naprawiono overlay
> hydratacji"). Weryfikacja tej implementacji ujawniła **trzy nowe defekty**
> wprowadzone razem z poprawką. Ten dokument je zamyka.
>
> Wszystkie trzy były **niewidoczne dla CI**: typecheck przechodził, suite był
> zielony (330 plików / 2885 testów), a bramka pokrycia nie protestowała -
> ponieważ nowy centralny helper `prepareContentForRender` nie miał **ani jednego**
> testu.

## Co w zunifikowanej wersji było zrobione dobrze (zachowane bez zmian)

Warto to odnotować, bo poprawki poniżej nie ruszają żadnego z tych rozwiązań:

- **Jeden kontrakt wyjścia** dla wszystkich silników; blocks dopasowany do
  `lib/footnotes.ts`, klasy Tailwind zastąpione tokenem globalnych kolorów
  `fn-ref` (`globalColors.ts:690`) - czyli wygląd markera jest konfigurowalny
  w adminie, a nie zaszyty w kodzie.
- **Puste `[fn][/fn]` nie zużywa numeru** - w obu silnikach.
- **Wspólny helper** `prepareContentForRender` używany przez trasę publiczną
  i podgląd roboczy - to zamknęło główne ustalenie audytu (§2.1).
- **Zasięg widgetów 2 → 19** przez deklaratywną mapę `WIDGET_TEXT_FIELDS`,
  z obsługą tablic obiektów (`accordion.items[]`, `tabs`, `timeline`, …).
- Dorzucone `role="doc-noteref"`.

---

## A. Wpis richtext/markdown gubił CAŁĄ sekcję przypisów (wysoka)

`src/lib/content/prepareContent.ts`

`processDocFootnotes` zwraca `notes: col.notes` - **tę samą tablicę**, którą niesie
kolektor. Przy wspólnym liczniku dla buildera i HTML-a wyglądało to tak:

```ts
const col = createCounter(1);
const { notes: builderNotes } = processDocFootnotes(builderDoc, lang, col); // alias na col.notes
const expandedHtml = expandFootnotes(rawHtml ?? "", col); // dopisuje do TEJ SAMEJ tablicy
const htmlNotes = col.notes.slice(builderNotes.length); // slice od końca → ZAWSZE []
```

Ponieważ `builderNotes` i `col.notes` to jeden obiekt, po passie HTML
`builderNotes.length === col.notes.length`, więc `htmlNotes` było zawsze puste.

**Objaw w publicznym obiegu:** wpis richtext/markdown pokazywał w treści markery
`[1]`, `[2]` linkujące do `#fn-1` / `#fn-2`, których na stronie **nie było** -
`FootnotesList` przy pustej tablicy zwraca `null`, a `FootnoteTooltips` nie ma co
mapować. Czyli odsyłacze w nikąd i zero przypisów. Przed unifikacją ta ścieżka
działała (`processHtmlFootnotes` zwracał własną tablicę).

Odtworzone przed poprawką:

```
engine: html
markery w HTML: data-fn="1", data-fn="2"
footnotes[]   : []          ← sekcja pusta
```

## B. Zaległe `content_pl/en` dopisywało przypisy-widma (średnia)

Ta sama przyczyna, drugi objaw. Rekord renderowany **builderem**, ale z
niewyczyszczonym legacy HTML-em zawierającym `[fn]`, dostawał w liście przypisów
noty z treści, która **nie jest wyświetlana**:

```
footnotes: ["z buildera", "z legacy HTML"]   ← druga bez odsyłacza w treści
```

To wariant dokładnie tego zagrożenia, przed którym zabezpieczał się poprzedni
komentarz w `$.tsx` („a legacy content_pl/en field that still contains [fn]
markers would emit a SECOND, mismatched footnotes list").

### Poprawka A + B: osobny kolektor per silnik

Premisa wspólnego licznika („builder + html mają ciągłą numerację") nie miała
odbiorcy: `ContentRenderer` renderuje **dokładnie jeden** silnik
(builder ⊕ blocks ⊕ html). Dwa niezależne kolektory zamykają oba objawy i dodają
gwarancję, że renderowany silnik **zawsze numeruje od `[1]`**, niezależnie od
zaległych danych drugiego:

```ts
const { doc: preparedDoc, notes: builderNotes } = processDocFootnotes(
  builderDoc,
  lang,
  createCounter(1),
);
const htmlCol = createCounter(1);
const expandedHtml = expandFootnotes(rawHtml ?? "", htmlCol);
const htmlNotes = htmlCol.notes;
```

## C. Marker w globalnym widgecie kolidował z numeracją dokumentu (niska/średnia)

`src/lib/footnotes.ts`

Poprawka overlayu hydratacji słusznie przepuszcza żywy rekord globalnego widgetu
przez silnik przypisów, ale robiła to z **własnym licznikiem od 1** i pełnym
kotwiczeniem markera. Globalny widget jest reużywalny między stronami, więc jego
przypisy **nie wchodzą** do dokumentowej sekcji końcowej - kotwiczenie było więc
aktywnie szkodliwe. Na stronie mającej własny przypis nr 1:

| Atrybut        | Skutek                                            |
| -------------- | ------------------------------------------------- |
| `id="fnref-1"` | **zduplikowany id w DOM** (niepoprawny HTML)      |
| `href="#fn-1"` | marker skacze do **cudzego** przypisu dokumentu   |
| `data-fn="1"`  | `FootnoteTooltips` pokazuje **treść cudzej noty** |

Zamierzenie autora poprawki („marker + tooltip w atrybucie `title` wystarczy do
UX") było słuszne - brakowało tylko odcięcia kotwic.

### Poprawka C: drugi wariant markera

`expandFootnotes` dostało opcję `anchored`. `processWidgetFootnotes` domyślnie
używa `anchored: false`, więc emituje marker samodzielny:

```html
<sup class="fn-ref"><span title="…" role="note">[N]</span></sup>
```

Bez `href`, `id` i `data-fn` - żadnych duplikatów, żadnego skoku w cudze miejsce,
a treść przypisu nadal dostępna jako natywny tooltip przeglądarki. Obchód
dokumentu buildera pozostaje **kotwiczony** (domyślne `anchored: true`), bo tam
sekcja końcowa istnieje.

---

## Testy (14 nowych)

`src/lib/content/__tests__/prepareContent.test.ts` (7) - **pierwsze w ogóle** testy
centralnego helpera. Pilnują kontraktu, którego brak wpuścił regresję A:
renderowany silnik numeruje od `[1]`; liczba wpisów w sekcji zgadza się z liczbą
markerów w treści (brak odsyłaczy w nikąd i brak widm); dane nierenderowanego
silnika nie wyciekają - w obie strony (zaległy `content_pl` przy builderze
**oraz** zaległy `builder_data` przy richtekście); blocks nie dubluje sekcji;
puste `[fn][/fn]` bez zużycia numeru; przekazywanie `hasManualToc`.

`src/lib/__tests__/footnoteMarkers.test.ts` (7) - granica między wariantami
markera: kotwiczony niesie `href`/`id`/`data-fn`/`role="doc-noteref"`, samodzielny
**żadnego z nich** przy zachowanym `title`; jawny test, że globalny widget nie
produkuje `id` mogącego zderzyć się z dokumentem; możliwość wymuszenia
kotwiczenia; wspólne reguły (puste przypisy, escapowanie `title` w obu
wariantach).

## Weryfikacja

| Sprawdzenie                                   | Wynik  |
| --------------------------------------------- | ------ |
| `tsc --noEmit`                                | czysto |
| `eslint` (4 pliki)                            | czysto |
| `prettier --check`                            | czysto |
| `vitest` - `prepareContent.test.ts`           | 7/7    |
| `vitest` - `footnoteMarkers.test.ts`          | 7/7    |
| `bun run test:coverage` (pełny suite + progi) | exit 0 |

Odtworzone po poprawce:

```
A) richtext  markery: data-fn="1", data-fn="2"  | sekcja: ["zrodlo A","zrodlo B"]
B) builder   sekcja: ["z buildera"]              ← bez widma z legacy HTML
C) globalny  kotwice: BRAK                       | title="nota globalna"
```

---

# Domknięcie trzech pozostałych punktów

Po wdrożeniu A-C zostały trzy punkty; ten rozdział zamyka wszystkie.

## D. Strona główna przechodzi przez wspólny helper

`src/routes/index.tsx`

Homepage to zwykły dokument buildera, ale renderowała `BuilderRenderer`
bezpośrednio, więc `[fn]` w widgecie tekstowym trafiał do publicznego obiegu
dosłownie. Teraz przechodzi przez `prepareContentForRender` i renderuje
`FootnotesList` + `FootnoteTooltips` - identycznie jak wpis i podgląd roboczy.
Tym samym **wszystkie trzy trasy renderujące treść** (wpis/strona, podgląd,
homepage) mają jedno wejście; tabela z §1 audytu jest w całości zamknięta.

Dwie rzeczy przy okazji, bo to najczęściej odwiedzana trasa serwisu:

- parsowanie i pre-pass siedzą w **jednym** `useMemo` kluczowanym surowym
  `builder_data`. Trzymanie `parseBuilderDoc()` poza memo unieważniałoby je w
  każdym renderze (funkcja zwraca nowy obiekt), czyli pre-pass biegłby bez
  potrzeby przy każdym renderze homepage,
- sekcja przypisów siedzi w kontenerze `max-w-[1400px] mx-auto px-4 lg:px-8`,
  czyli tej samej siatce co reszta strony (spójna responsywność).

Poprawiono też dwie pauzy „—" na dywiz w tekstach pustego stanu (reguła projektu).

## E. Blocks nie ma już własnej implementacji

`src/components/blocks/renderer/footnotes.ts`, `src/components/blocks/BlocksRenderer.tsx`

Warstwa bloków niosła **drugą** kopię rozwijania `[fn]`, utrzymywaną w zgodzie z
`lib/footnotes.ts` komentarzem, nie kodem - dwa miejsca do zmiany przy każdej
modyfikacji kontraktu i stała możliwość cichego rozjazdu (dokładnie taki rozjazd

- `title` i klasy Tailwind tylko po stronie bloków - opisał audyt).

Teraz `replaceFootnotes` to cienki alias na `expandFootnotes`, a `FootnoteCollector`
to alias na wspólny `FootnoteCounter`. Skutki uboczne, wszystkie na plus:

| Było                                               | Jest                                      |
| -------------------------------------------------- | ----------------------------------------- |
| własny `escapeHtml` w warstwie bloków              | jedno `escapeAttr` w `lib/footnotes`      |
| numeracja z `fn.notes.length` (długość tablicy)    | jawne `id` z kolektora                    |
| `<li id={`fn-${i+1}`}>` - numer z indeksu w widoku | `<li id={`fn-${n.id}`}>` - numer z danych |
| `tooltipNotes` mapowane ze stringów na obiekty     | kolektor od razu niesie `Footnote[]`      |

Zniknięcie mapowania indeksów jest istotne: id przypisu nie zależy już od tego,
w jakiej kolejności widok iteruje tablicę.

## F. Zasięg - naprawiony niezmiennik, nie zwiększona liczba

Tu wniosek z analizy jest inny niż „dodać brakujące 54 widgety i 94 bloki", i
warto to zapisać, bo liczby z audytu mogą mylić.

**Marker przypisu jest znacznikiem HTML** (`<sup class="fn-ref">…`). Pole
renderowane jako węzeł tekstowy React (`{label}`) pokaże go **dosłownie** -
czytelnik zobaczy `<sup class="fn-ref"><span title="…">[1]</span></sup>` jako
tekst na stronie. To gorsze niż nierozwinięty shortcode. Przypisy mogą więc
działać **wyłącznie** w polach wstawianych przez `dangerouslySetInnerHTML`.

Przegląd wszystkich takich miejsc dał twardą listę:

| Warstwa | Pola renderowane jako HTML                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------ |
| blocks  | `paragraph`, `html`, **`spoiler`**, `heading:text`, `quote:text/cite`, `list:item`, `table:cell`                         |
| builder | `text.html`, `tabs.items[].html`, `accordion.items[].a`, `interactive-circle.desc` (widget + element), `team-member.bio` |

Na tej podstawie:

- **dodano `spoiler`** do pre-passu bloków i podpięto `renderSpoiler` do mapy
  `fnHtml` - jedyny blok renderujący HTML, który wypadał z pre-passu,
- **poprawiono mapę widgetów**, która była błędna **w obie strony**:

| Problem                      | Przykład                                                                                   | Skutek                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| obejmowała pola **tekstowe** | `button.label`, `team-member.name`, `image.caption`, `heading.title`, `timeline`, `cta`, … | widoczne `<sup class="fn-ref">…` jako tekst na stronie |
| **złe nazwy** pól            | `accordion.items[].{title,content,body}` - renderer czyta `a_*`                            | przypisy w akordeonie nie działały mimo „pokrycia"     |
| **brakowało** pól HTML       | `tabs.items[].html`, `accordion.items[].a`, `interactive-circle.desc`, `team-member.bio`   | przypisy tam nie działały                              |

Efekt netto: liczba wpisów zmalała z 19 do 5 widgetów, ale liczba pól, w których
przypisy **realnie działają**, wzrosła - a zniknęło ryzyko widocznego tag soup.
Odtworzone zachowanie:

```
text.html_pl                ROZWINIETE (pole HTML)      notes=1
team-member.bio_pl          ROZWINIETE (pole HTML)      notes=1
team-member.name_pl         NIETKNIETE (pole tekstowe)  notes=0
interactive-circle.desc_pl  ROZWINIETE (pole HTML)      notes=1
tabs.items[].html_pl        ROZWINIETE (pole HTML)      notes=1
tabs.items[].label_pl       NIETKNIETE (pole tekstowe)  notes=0
accordion.items[].a_pl      ROZWINIETE (pole HTML)      notes=1
accordion.items[].q_pl      NIETKNIETE (pole tekstowe)  notes=0
button.label_pl             NIETKNIETE (pole tekstowe)  notes=0
image.caption_pl            NIETKNIETE (pole tekstowe)  notes=0
```

Niezmiennik jest teraz **egzekwowany testem**
(`src/lib/builder/__tests__/widgetTextFields.test.ts`): lista widgetów jest
zamrożona wprost, a osobne przypadki sprawdzają, że pole tekstowe zostaje
nietknięte, a pole HTML zostaje rozwinięte. Dopisanie widgetu wymaga świadomej
zmiany testu razem z odsyłaczem do miejsca renderu - mapa nie rozjedzie się po
cichu drugi raz.

## Weryfikacja domknięcia (D-F)

| Sprawdzenie                                   | Wynik  |
| --------------------------------------------- | ------ |
| `tsc --noEmit`                                | czysto |
| `eslint` (8 plików)                           | czysto |
| `prettier --check`                            | czysto |
| `bun run test:coverage` (pełny suite + progi) | exit 0 |

## Pozostaje otwarte (świadomie)

- **Widget `heading` buildera** renderuje tytuł jako tekst, więc przypisy tam nie
  działają - inaczej niż w bloku `heading`, który ma gałąź HTML. Zrównanie
  wymagałoby zmiany semantyki renderu widgetu (tytuł jako HTML), co jest decyzją
  produktową, nie poprawką błędu.
- **Podpowiedź na pasku narzędzi** (`WordStyleToolbar.tsx`) mówi tylko „Wstaw
  przypis [fn]…[/fn]" i nie sygnalizuje, że shortcode działa w treści bogatej,
  a nie w etykietach. Warto to dopisać, gdy dotykamy tego panelu.
