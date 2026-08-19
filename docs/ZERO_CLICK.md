# Zero-click - strategia projektowania wpisów

Jak projektować wpisy tak, żeby rozwiązywały problem czytelnika TAM, gdzie się
z nimi styka - w wyniku wyszukiwania, w odpowiedzi AI, w feedzie - zamiast
ciągnąć go na stronę. Dokument opisuje regułę po regule, mówi, co platforma
robi automatycznie, a co musi zrobić redaktor, i gdzie w edytorze to widać.

Warstwa techniczna (JSON-LD, sitemapy, llms.txt, robots) jest opisana osobno w
[`SEO.md`](./SEO.md). Tutaj chodzi o KSZTAŁT tekstu, którego żaden schema nie
naprawi.

## Co platforma robi sama

Te rzeczy dzieją się bez udziału redakcji - nie ma czego „włączać" przy wpisie:

| Warstwa                             | Gdzie                                       | Co daje                                                     |
| ----------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `NewsArticle` + `abstract`          | `lib/seo/meta.ts` (`buildArticleJsonLd`)    | Streszczenie wpisu z punktów „Dowiesz się…" dla silników AI |
| `SpeakableSpecification`            | `lib/seo/meta.ts`                           | Wskazanie H1, sekcji „Dowiesz się…" i pierwszego akapitu    |
| `FAQPage`                           | `components/blocks/FaqBlockView.tsx`        | Dane strukturalne bloku FAQ (szansa na PAA)                 |
| `robots: max-snippet:-1`            | `lib/seo/fields.ts` (`resolveRobotsMeta`)   | Zgoda na pełny fragment w SERP i w odpowiedzi AI            |
| `llms.txt`, `NewsMediaOrganization` | `routes/llms[.]txt.ts`, `lib/seo/jsonld.ts` | Kanoniczne cytowanie marki przez asystentów                 |

Wniosek z audytu (2026-08): warstwa MASZYNOWA była kompletna, brakowało warstwy
REDAKCYJNEJ. Schema opisuje treść, ale nie zmusi jej, żeby odpowiadała w
pierwszym akapicie ani żeby nagłówki były pytaniami. Stąd ściągawka i checklista
w edytorze.

## Sześć reguł

Kolejność jest kolejnością pracy - tak samo w ściągawce i w checkliście.
Budżety liczbowe mają jedno źródło: `ZERO_CLICK_BUDGETS` w
`src/lib/seo/zeroClick.ts`. Zmiana progu tam przestawia i pomiar, i komunikat.

### 1. Akapit definicyjny na starcie (40-70 słów)

Pierwszy akapit odpowiada na pytanie z tytułu: definicja, po co to komu, dla
kogo. To jest ten fragment, który wyszukiwarka podnosi do snippetu, a model do
odpowiedzi.

- **Rób:** „Zero-click marketing to strategia, w której…".
- **Nie rób:** „W dzisiejszych czasach…". Rozbiegówka o właściwej długości jest
  gorsza niż zły metraż - nie ma czego zacytować. Checklista wykrywa ją osobno
  (`reason: "filler"`), bo to inna praca niż dopisanie słów.

### 2. Nagłówki w formie pytań

H2/H3 zapisane pełnym pytaniem trafiają w realne frazy i w sekcję „Podobne
pytania". Każda sekcja zaczyna się od krótkiej odpowiedzi, rozwinięcie idzie
niżej.

Próg to 40% nagłówków H2/H3, nie 100%: wpis analityczny ma prawo mieć nagłówki
narracyjne. Liczy się też nagłówek pytaniowy BEZ pytajnika („Jak działa X") -
tak pisze większość polskich redakcji i karanie za to byłoby fałszywym alarmem.

### 3. FAQ jako blok, nie jako proza

Blok FAQ (Widgety → FAQ) dokłada `FAQPage`. Ręcznie napisana sekcja pytań
wygląda dla czytelnika identycznie i jest **niewidoczna dla crawlera** -
checklista pokazuje wtedy `warn`, nie `ok`.

### 4. Odpowiedzi w FAQ do 60 słów

Dłuższa odpowiedź przestaje być cytowalna w całości - zostaje przycięta w
losowym miejscu. Rozwinięcie zostaje w treści, w FAQ idzie rozstrzygnięcie.

### 5. Punkty „Dowiesz się…" (3-5)

Lądują w JSON-LD jako `abstract` i w `speakable`. Każdy punkt ma być
samodzielnym zdaniem („Zero-click nie znosi CTA - przenosi je do profilu"), nie
zapowiedzią („Omówimy też metryki"). Zapowiedź nic nie wnosi do streszczenia.

### 6. Lista kroków albo checklista

Wypunktowanie to format, który silniki i modele wyciągają najchętniej, bo nie
wymaga streszczania. Jedna lista kroków lub warunków na wpis to minimum.

## Ślad marki zamiast twardego CTA

Zero-click nie znaczy „bez konwersji" - konwersja przenosi się z przycisku do
pamięci czytelnika:

1. Nazwa marki i własnej metody wpleciona w definicję, nie doklejona na końcu.
2. Wzmianka, że istnieje pełny raport / kurs / narzędzie - bez „kliknij teraz".
3. Twarde CTA w profilu, bio i przypiętym poście; wpis zostaje samodzielny.

## Kiedy zero-click, a kiedy klasyczny wpis

Rozdziel tory PRZED pisaniem, inaczej wpis sprzedażowy oddaje wiedzę za darmo,
a edukacyjny straszy przyciskiem:

| Rodzaj frazy                               | Cel            | Kształt wpisu                                        |
| ------------------------------------------ | -------------- | ---------------------------------------------------- |
| Informacyjna („czym jest…", „jak działa…") | cytowanie      | pełna odpowiedź w treści, FAQ, punkty kluczowe       |
| Komercyjna („cennik", „konsultacja")       | klik           | wpis prowadzi do decyzji, mocne CTA                  |
| Mieszana                                   | jedno i drugie | odpowiedź w treści + głębsza warstwa (dane, szablon) |

## Miary

CTR na wpisach zero-click spada z definicji. Zestaw, który nie skłamie:
obecność w snippetach / PAA / AI Overview, cytowania domeny w odpowiedziach
asystentów, wyszukiwania brandowe i wejścia bezpośrednie, zapisy i
udostępnienia zamiast samych odsłon.

## Gdzie to widać w edytorze

Ściągawka i checklista są **wyłącznie** w edytorze wpisu (`/admin/posts/$slug`,
zakładka „Zero-click" w grupie SEO). Edytor stron ich nie widzi - pilnuje tego
bramka na źródłach w
`components/admin/post-editor/organisms/__tests__/zeroClickSection.test.tsx`.

| Element                      | Plik                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| Reguły + analizator (czysty) | `src/lib/seo/zeroClick.ts`                                           |
| Komunikaty checklisty        | `src/components/admin/post-editor/lib/zeroClickMessages.ts`          |
| Ściągawka (PL/EN)            | `src/components/admin/post-editor/molecules/ZeroClickCheatSheet.tsx` |
| Checklista jednego języka    | `src/components/admin/post-editor/molecules/ZeroClickChecklist.tsx`  |
| Zakładka (montaż)            | `src/components/admin/post-editor/organisms/ZeroClickSection.tsx`    |
| Słownik PL/EN                | `src/lib/i18n-admin-zero-click.ts`                                   |

Dodatkowo podpowiedzi kontekstowe (`InfoHint`) stoją przy polach, których reguła
dotyczy: zapowiedź PL/EN w zakładce „Ogólne", punkty w zakładce „Dowiesz się…",
opis SEO w zakładce „SEO".

Checklista liczy się **osobno dla PL i EN**: wersja angielska bywa
tłumaczeniem, które zgubiło nagłówki-pytania albo blok FAQ.

## Czego checklista NIE robi

Mierzy kształt tekstu, nie jego jakość. Zielony wiersz nie znaczy, że akapit
definicyjny jest dobry - znaczy, że ma 40-70 słów i nie zaczyna się
rozbiegówką. Redakcji nie zastępuje.
