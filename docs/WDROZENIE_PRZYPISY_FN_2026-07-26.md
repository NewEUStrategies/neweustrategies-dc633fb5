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

## Pozostaje otwarte

- **Strona główna** (`src/routes/index.tsx:303`) nadal woła `BuilderRenderer` bez
  `prepareContentForRender`, więc `[fn]` w widgecie tekstowym homepage renderuje
  się dosłownie. To dług **sprzed** unifikacji (§2.3 audytu), nie regresja -
  dlatego nie mieszam go do tej zmiany. Poprawka to przepuszczenie dokumentu
  homepage przez ten sam helper.
- **Blocks ma nadal własną implementację** (`components/blocks/renderer/footnotes.ts`),
  utrzymywaną w zgodzie z `lib/footnotes.ts` komentarzem, nie kodem. Wyjście jest
  dziś identyczne, ale to nadal dwa miejsca do zmiany przy każdej modyfikacji
  kontraktu. Docelowo warto, żeby blocks wołało `expandFootnotes`.
- **Zasięg**: 19 z 73 widgetów i 6 z 100 typów bloków. Jeśli przypisy mają
  działać wszędzie, trzeba rozszerzyć mapę i listę typów; jeśli nie - warto to
  napisać w podpowiedzi przycisku na pasku narzędzi.
