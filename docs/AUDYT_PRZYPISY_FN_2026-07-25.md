# Audyt przypisów dolnych `[fn]…[/fn]` - spójność CMS ↔ publiczny obieg (2026-07-25)

**Pytanie:** czy shortcode `[fn] tekst [/fn]` wpisany w CMS zachowuje się tak samo w publicznym
obiegu?

**Odpowiedź: nie.** Shortcode jest przetwarzany **tylko na jednej trasie** (publiczny wpis/strona)
i **tylko w części pojemników treści**; poza tym renderuje się dosłownie. Dodatkowo dwa silniki
przetwarzają go **innym kodem**, który daje inny markup i inaczej traktuje pusty przypis.

> Uwaga: nagranie ekranu dołączone do zgłoszenia nie było w tym środowisku odtwarzalne (brak
> ffmpeg), więc audyt opiera się wyłącznie na kodzie i odtworzonych wyjściach obu implementacji.
> Jeśli nagranie pokazuje objaw, którego nie ma na poniższej liście - proszę o jedno zdanie opisu,
> sprawdzę ten konkretny przepływ.

## Dobra wiadomość na wstępie

Spacje w `[fn] tekst [/fn]` **nie są problemem**. Oba silniki robią `content.trim()`, więc
`[fn]tekst[/fn]` i `[fn] tekst [/fn]` dają identyczny wynik. Regex jest też nie-zachłanny
(`[\s\S]*?`), więc kilka przypisów w jednym akapicie numeruje się poprawnie.

---

## 1. Architektura - dwie niezależne implementacje

| Silnik treści                 | Kod przetwarzający                                                                         | Gdzie wołany                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **blocks** (Gutenberg-style)  | `src/components/blocks/renderer/footnotes.ts` (`precomputeFootnotes` / `replaceFootnotes`) | wewnątrz `BlocksRenderer.tsx:53` - **samowystarczalny** |
| **builder** (Elementor-style) | `src/lib/footnotes.ts` (`processDocFootnotes`)                                             | **tylko** `src/routes/$.tsx:596`                        |
| **richtext / markdown**       | `src/lib/footnotes.ts` (`processHtmlFootnotes`)                                            | **tylko** `src/routes/$.tsx:597`                        |

Kluczowa konsekwencja architektury zapisana wprost w komentarzu `ContentRenderer.tsx:13-15`:

> „Footnote/TOC processing happens **upstream in the route**; this component is purely the
> strategy switch."

Czyli: dla buildera i richtextu **trasa musi sama** wywołać pipeline. Blocks radzi sobie sam.
Poniższa tabela pokazuje, że robi to jedna trasa z trzech.

| Trasa                                             | `processDocFootnotes` / `processHtmlFootnotes` | `FootnotesList` | Skutek                                                            |
| ------------------------------------------------- | ---------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| `src/routes/$.tsx` (publiczny wpis/strona)        | ✔                                              | ✔               | działa dla wszystkich trzech silników                             |
| `src/routes/preview.$token.tsx` (podgląd roboczy) | ✘                                              | ✘               | **builder i richtext: dosłowny shortcode, brak sekcji przypisów** |
| `src/routes/index.tsx` (strona główna)            | ✘                                              | ✘               | **builder: dosłowny shortcode**                                   |

---

## 2. Rozjazd CMS ↔ publiczny obieg - pięć miejsc

### 2.1 Podgląd wersji roboczej nie pokazuje przypisów (builder / richtext)

`src/routes/preview.$token.tsx:64-96` przekazuje do `ContentRenderer` **surowe** dane:

```tsx
const builderDoc = parseBuilderDoc(post.builder_data);   // bez processDocFootnotes
...
html={rawHtml ? sanitizeHtml(rawHtml) : ""}              // bez processHtmlFootnotes
```

Nie renderuje też `FootnotesList`. Efekt dla treści w builderze albo richtekście: w podglądzie
widać dosłowne `[fn] tekst [/fn]` i **żadnej** sekcji „Przypisy źródłowe", a po publikacji ten sam
wpis pokazuje `[1]` i pełną listę. Treść blokowa działa w podglądzie poprawnie, bo `BlocksRenderer`
ma własny pipeline - co czyni rozjazd jeszcze bardziej mylącym (zależy od silnika, nie od treści).

To najważniejsze z ustaleń, bo dotyczy dokładnie tego przepływu, o który pyta zgłoszenie:
redaktor wpisuje shortcode, sprawdza w podglądzie, widzi surowy tekst i ma podstawy sądzić, że
funkcja nie działa.

### 2.2 Kanwa buildera w adminie też go nie rozwija

Widget `text` renderuje się (poza trybem edycji) przez `RichHtmlView`, który **świadomie** nie
dotyka `[fn]` - obsługuje wyłącznie „zapieczone" przypisy z migracji WordPressa
(`RichHtmlView.tsx:7-9`: „The render-time `[fn]` pipeline never sees that baked markup"). Razem
z 2.1 oznacza to, że autor **nie ma żadnego miejsca**, w którym zobaczyłby swój przypis przed
opublikowaniem strony.

### 2.3 Strona główna renderuje shortcode dosłownie

`src/routes/index.tsx:303` woła `BuilderRenderer` bez upstream processingu, więc `[fn]` w widgecie
tekstowym strony głównej trafia do publicznego obiegu jako dosłowny tekst.

### 2.4 Widget globalny gubi przypis po hydratacji

`WidgetView.tsx:114-118` nakłada na instancję **żywy** rekord globalnego widgetu
(`mergeGlobalIntoInstance`), podmieniając całe `content`. `processDocFootnotes` przetworzyło
wcześniej **snapshot** w dokumencie. Dla globalnego widgetu `text`/`heading` z `[fn]`:

1. SSR / pierwsze malowanie: treść ze snapshotu → widać `[1]`,
2. po rozwiązaniu zapytania o rekord globalny: `content` podmieniony na **surowy** → w tym samym
   miejscu pojawia się dosłowne `[fn] tekst [/fn]`,
3. sekcja przypisów (zebrana ze snapshotu) zostaje z **osieroconym** wpisem, do którego nie ma już
   odsyłacza w treści.

### 2.5 Zasięg: 6 z 100 typów bloków, 2 z 73 widgetów

| Silnik  | Obsługiwane pojemniki                                                                                                                                      | Reszta                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| blocks  | `paragraph`, `html`, `heading`, `quote` (`text` + `cite`), `list` (elementy), `table` (komórki); rekursja przez `columns`, `group`, `row`, `stack`, `grid` | pozostałe **94** typy bloków → dosłowny shortcode |
| builder | `text`, `heading` (`processDocFootnotes` → `if (w.type !== "text" && w.type !== "heading") return w`)                                                      | pozostałe **71** widgetów → dosłowny shortcode    |

Obchód drzewa buildera jest przy tym **kompletny** (sekcje → kolumny/wiersze → widgety);
`WidgetNode` nie ma dzieci-widgetów, więc nie ma tu luki zagnieżdżenia. Ograniczeniem jest
wyłącznie lista typów.

Praktyczny wniosek: przypis wpisany w akapicie zadziała, ten sam przypis wpisany np. w bloku
callout, akordeonie, karcie czy podpisie obrazka - nie.

---

## 3. Różnice zachowania między silnikami (nawet tam, gdzie działa)

Odtworzone wyjścia obu implementacji dla tego samego wejścia:

| Wejście                   | blocks (`replaceFootnotes`)                                                                                                                                         | builder / richtext (`processHtmlFootnotes`)                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Tekst[fn] przypis [/fn]` | `<sup class="fn-ref"><a … data-fn="1" **title="przypis"** aria-describedby="footnotes-heading" **class="text-primary no-underline hover:underline"**>[1]</a></sup>` | `<sup class="fn-ref"><a … data-fn="1" aria-describedby="footnotes-heading">[1]</a></sup>` |
| `Puste[fn][/fn]`          | `Puste` - znacznik usunięty, brak przypisu                                                                                                                          | `Puste<sup…>[1]</sup>` + **pusty wpis** w liście                                          |
| `Biale[fn]   [/fn]`       | `Biale` - jak wyżej                                                                                                                                                 | jak wyżej - **numer zużyty**                                                              |

Dwie realne konsekwencje:

1. **Inny wygląd i inne zachowanie po najechaniu.** Wersja blokowa niesie atrybut `title`, czyli
   dodatkowo **natywny tooltip przeglądarki**, i jawnie stylowany odsyłacz. Wersja
   builder/richtext nie ma ani `title`, ani klas - wygląd zależy od CSS `prose`. Interaktywna
   bąbelkowa podpowiedź (`FootnoteTooltips`) działa w obu, bo opiera się na `data-fn`.
2. **Pusty przypis rozjeżdża numerację.** W builderze/richtekście `[fn][/fn]` zużywa numer, więc
   następny realny przypis dostaje `[2]`, a w blokach `[1]`. Ponieważ platforma wspiera konwersję
   wpisu między silnikami w obie strony, ta sama treść po konwersji **przenumerowuje przypisy** -
   a wcześniej udostępnione linki `#fn-N` przestają wskazywać ten sam przypis. Dodatkowo
   `parseBakedFootnotes` (ścieżka migrowana) **odfiltrowuje** puste wpisy (`if (html.trim())`),
   więc trzecia ścieżka traktuje ten przypadek jeszcze inaczej.

---

## 4. Co jest zrobione dobrze

Żeby obraz był uczciwy - te rzeczy są w porządku i nie wymagają zmian:

- **Pre-pass przed renderem.** `precomputeFootnotes` zbiera przypisy zanim zacznie się render,
  więc sekcja przypisów jest kompletna już w SSR (komentarz w `footnotes.ts:5-9` opisuje
  wcześniejszy bug, gdy kolektor mutowano w trakcie renderu dziecka).
- **Sanityzacja.** Treść przypisu przechodzi przez `sanitizeHtml` przy renderze listy i tooltipa
  (`Footnotes.tsx:39`, `:111`), a `title` jest escapowany i pozbawiony tagów
  (`footnotes.ts:39`). Nie znalazłem tu wektora XSS.
- **A11y.** Odsyłacze mają `aria-describedby="footnotes-heading"`, lista ma powrotne `↩`
  z `aria-label`, tooltip ma `role="tooltip"`, a bąbelki są progresywnym ulepszeniem (statyczne
  odsyłacze i lista renderują się bez JS).
- **Numeracja w kolejności renderu**, także przez kolumny (lewa → prawa) i kontenery.
- **Ochrona przed podwójną listą**: `$.tsx:603-608` celowo zeruje `notes` dla silnika blokowego,
  żeby zaległe `[fn]` w `content_pl/en` nie wygenerowało drugiej sekcji z duplikatami `#fn-`.

---

## 5. Rekomendacje (w kolejności opłacalności)

1. **Wyrównać podgląd roboczy do publicznego** - w `preview.$token.tsx` wywołać
   `processDocFootnotes` / `processHtmlFootnotes` i wyrenderować `FootnotesList` + `FootnoteTooltips`,
   dokładnie jak `$.tsx`. To zamyka główny objaw ze zgłoszenia. Najlepiej wyciągając wspólny
   helper (np. `prepareContentForRender(body, lang)`), żeby trzecia trasa nie rozjechała się
   ponownie - dziś ta wiedza jest zduplikowana w `$.tsx` i nieobecna w dwóch pozostałych.
2. **Jedna implementacja zamiast dwóch.** `replaceFootnotes` i `processHtmlFootnotes` robią to samo
   dwoma kodami o różnym wyjściu. Zostawić jedną (wariant blokowy jest bogatszy: `title` + klasy)
   i wołać ją z obu silników. To jednym ruchem usuwa różnicę wyglądu **i** rozjazd numeracji.
3. **Odrzucać pusty przypis w obu silnikach** - `if (!text) return ""` z wariantu blokowego
   przenieść do `processHtmlFootnotes`.
4. **Strona główna** - dodać ten sam pre-pass w `index.tsx` albo (lepiej) użyć helpera z pkt 1.
5. **Widget globalny** - przetwarzać `[fn]` po nałożeniu żywego rekordu (w `WidgetView`, na
   `node.content`), a nie tylko na snapshocie dokumentu.
6. **Zasięg pojemników** - jeśli przypisy mają być „wszędzie", rozszerzyć listę typów; jeśli nie,
   udokumentować ograniczenie w podpowiedzi przycisku na pasku narzędzi (dziś mówi tylko
   „Wstaw przypis [fn]…[/fn]", `WordStyleToolbar.tsx:367`, i nie sugeruje, że poza akapitem/
   nagłówkiem/listą/cytatem/tabelą shortcode nie zadziała).

Ustalenia 1-5 są niewielkie objętościowo i każde da się pokryć testem; pkt 2 jest jednocześnie
sprzątaniem długu (usuwa jedną z dwóch równoległych implementacji).
