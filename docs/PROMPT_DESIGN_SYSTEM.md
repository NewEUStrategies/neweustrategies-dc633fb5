# ZLECENIE: PRZEKROJOWE - design system (`src/components/ui`)

> **HEAD pomiaru: `967cec9`.** Każda liczba statyczna w tym dokumencie została zmierzona na tym commicie.
> Jeżeli pracujesz na nowszym `main`, **przemierz przed startem** - i jeśli któraś liczba się rozjechała,
> napisz o tym w opisie PR-a zamiast dopasowywać się do nieaktualnego zlecenia. Ta uwaga stoi tu,
> bo w wydaniu 10 trzy z siedmiu pozycji erraty wykonawcy wzięły się z czytania zlecenia na innym HEAD,
> niż powstało (rozdz. 8.5 audytu, pozycja 16).
>
> **Sprawdzisz aktualność tego zlecenia jednym poleceniem:**
> `git diff --name-only 967cec9..HEAD -- src/components/ui/ src/lib/i18n-download-button.ts` ma nie wypisać nic.

---

## OSTRZEŻENIE O ZAKRESIE DOWODU - przeczytaj przed rozdziałem 0

**Procenty pokrycia w tym zleceniu NIE zostały zmierzone. Zostały przepisane z wydania 10 audytu
i są opatrzone HEAD-em, na którym powstały.** Powód jest konkretny i sprawdzalny: sesja, w której
powstało to zlecenie, **nie mogła zainstalować zależności**. `bun.lock` przypina 384 rozstrzygnięcia
do lustra `europe-west1-npm.pkg.dev` i `europe-west4-npm.pkg.dev` (`lovable-core-prod`), a polityka
egresu organizacji odrzuca ten host odpowiedzią **403 na CONNECT**. Bez `node_modules` nie ma
`vitest run --coverage`, więc nie ma świeżych procentów.

**Co z tego wynika dla Ciebie, wykonawco:**

1. **Pierwszą czynnością tego zlecenia jest pomiar**, nie kodowanie:
   `bun install && bun run test:coverage`, a potem `node scripts/taxonomy/report.mjs` z filtrem
   na tę powierzchnię. Dopiero ta liczba jest podstawą kryterium odbioru z rozdz. 7.
2. **Liczby statyczne rozdz. 0, 0.1 i 0.2 są zmierzone na `967cec9`** i nie zależą od instalacji
   zależności: liczba plików, liczba wierszy, liczba plików testowych, liczba progów per-ścieżka,
   lista plików bez importu w korpusie testowym. Te obowiązują.
3. **Wszystkie cztery defekty z rozdz. 1-2 są zweryfikowane czytaniem kodu**, nie pomiarem
   pokrycia, więc ich dowód nie zależy od instalacji zależności. Każdy przeszedł **niezależną
   próbę obalenia przez osobnego agenta**, a wszystkie cztery sprawdziłem dodatkowo ręcznie.
4. **Żaden defekt nie został obalony, ale próba obalenia zmieniła treść trzech z czterech.**
   W A1 zmieniła opis objawu (kliknięcie nie jest zgubione, tylko odroczone). W A2 **obaliła
   większość uzasadnienia wagi**: formularze logowania, rejestracji i kontaktu oraz cały panel
   administracyjny są poza defektem, a realna powierzchnia to siedem plików, nie „ponad trzydzieści".
   W A4 obniżyła wagę do niskiej i wykazała, że miejsc jest pięć, nie cztery. Te sprostowania
   stoją w treści pozycji. Czytaj je: pierwsza redakcja tego zlecenia była w tych punktach
   po prostu błędna.

Nie jest to ta sama sytuacja co w zleceniu modułu 1, gdzie liczby pokrycia były świeże. Zapisuję
różnicę wprost, bo zlecenie, które udaje mocniejszy dowód, niż ma, jest gorsze od zlecenia,
które swój dowód ogranicza.

---

## 0. Stan wyjściowy

### 0.1. Zmierzone na `967cec9` - obowiązuje

| Metryka                                      | Wartość                       |
| -------------------------------------------- | ----------------------------- |
| Pliki produkcyjne                            | **45** (4 792 wiersze)        |
| Pliki testowe                                | **2**                         |
| Trasy                                        | 0                             |
| Progi per-ścieżka obejmujące tę powierzchnię | **0**                         |
| Pliki bez importu w całym korpusie testowym  | **12** (1 445 wierszy, 30,2%) |

Dwa pliki testowe na czterdzieści pięć plików produkcyjnych to cała warstwa testowa tej powierzchni:

- `src/components/ui/__tests__/floatingInputPlaceholder.test.tsx`
- `src/components/ui/__tests__/tooltip.test.tsx`

### 0.2. Przepisane z wydania 10 audytu (HEAD `5fd13461c`) - do przemierzenia

| Metryka            | Wartość wg audytu |
| ------------------ | ----------------- |
| Instrukcje         | 79,46%            |
| Gałęzie            | 71,67%            |
| Funkcje            | 75,00%            |
| **Linie**          | **81,48%**        |
| Plików na zerze    | 3                 |
| Niepokrytych linii | 138               |

**Design system jest najniżej pokrytą powierzchnią całego repozytorium** - niżej niż moduł 10
(83,65%) i niżej niż moduł 1 (84,65%), który dostał własne zlecenie jako „trzecia najsłabsza
powierzchnia". Ta powierzchnia jest pierwsza.

**Powierzchnia nie ruszyła się od HEAD-a pomiaru zlecenia modułu 1.** Między `7a780b1`
(origin/main, HEAD pomiaru modułu 1) a `967cec9` w `src/components/ui/` zmieniło się **zero plików**.
Sprawdzenie: `git diff --name-only 7a780b1..967cec9 -- src/components/ui/` nie wypisuje nic.

Jedna rozbieżność do odnotowania, nie do naprawiania w tym PR: tabela 9.1 audytu podaje dla tej
powierzchni **44 pliki i 4 559 wierszy**, a pomiar na `967cec9` daje **45 plików i 4 792 wiersze**.
Audyt sam oznacza rozdz. 9.1 jako rozjechany z kodem (sprostowanie z 2026-09-05), a źródłem prawdy
jest wykonywalna mapa `scripts/taxonomy/moduleMap.mjs`. Przyrost mieści się w oknie
`5fd13461c..7a780b1`, którego nie da się przemierzyć w tym klonie (jest płytki, 227 commitów,
a `5fd13461c` jest poza nim).

### 0.3. Czego dziś NIE pilnuje żaden próg

**Wszystkiego.** Na `967cec9` `vitest.config.ts` ma **694 unikalne klucze progów per-ścieżka**
i **ani jeden z nich nie obejmuje `src/components/ui/`**. Wszystkie 45 plików i wszystkie
4 792 wiersze tej powierzchni stoją wyłącznie pod progiem globalnym.

To nie jest odkrycie tego zlecenia, tylko potwierdzenie, że stan opisany w audycie trwa. Rozdział 6
audytu notował: „design system (`components/ui`) i słowniki i18n - wszystkie trzy mają ZERO progów".
Od tamtego pomiaru liczba progów w repozytorium urosła z 684 do 694, a ta powierzchnia dostała
z tego **zero**.

Sprawdzenie: `grep -c "components/ui" vitest.config.ts` zwraca `0`.

---

## 1. Pozycja BLOKUJĄCA

### A1. Nawigacja karuzeli `ProgressSlider` nie przełącza slajdu: kliknięcie zapisuje wyłącznie refy, a pętla animacji w tym momencie nie działa

**Gdzie:** `src/components/ui/progressive-carousel.tsx:88-96` (warunek `autoPlay` i wczesny powrót
z efektu), `:124-136` (`handleButtonClick`), `:145-153` (sekcja z `onMouseEnter`/`onFocusCapture`).
Konsument produkcyjny: `src/components/builder/organisms/widget-view/ProgressCarouselView.tsx`.

**Co jest:** postęp slajdu liczy efekt oparty o `requestAnimationFrame`, który startuje wyłącznie
wtedy, gdy `autoPlay` jest prawdą:

```tsx
const autoPlay = !paused && !reducedMotion && !hovered && values.length > 1;

useEffect(() => {
  if (!autoPlay && fastTarget.current === null) {
    setProgress(0);
    return;
  }
  ...
}, [autoPlay, active, values, duration, fastDuration]);
```

`hovered` ustawia się na `true` przy `onMouseEnter` **oraz** `onFocusCapture` na sekcji, wewnątrz
której leży cała grupa przycisków nawigacyjnych. Żeby kliknąć przycisk, kursor musi najpierw wejść
w sekcję albo przycisk musi dostać ognisko - w obu przypadkach `hovered` jest już `true`,
więc `autoPlay` jest `false`, a efekt zdążył wykonać wczesny powrót i **żadna pętla nie jest w biegu**.

`handleButtonClick` nie zmienia żadnego stanu - zapisuje wyłącznie dwa refy:

```tsx
fastTarget.current = value;
startedAt.current = typeof window === "undefined" ? 0 : performance.now();
```

Zapis do refa nie powoduje ponownego renderu, więc efekt się nie uruchamia i nikt tych refów
nie odczyta.

**Uściślenie, którego nie ma w zgłoszeniu pierwotnym i które zmienia opis objawu:** stan nie jest
trwały bezwarunkowo. Gdy kursor **opuści** karuzelę, `hovered` wraca na `false`, efekt biegnie
ponownie i tym razem `fastTarget.current` nie jest już `null`, więc wczesny powrót nie zadziała
i pętla wystartuje. Objaw dla użytkownika jest więc taki: **kliknięcie nie robi nic, a slajd
przeskakuje dopiero po odsunięciu kursora od karuzeli.** Dla obsługi klawiaturą odpowiednikiem
jest utrata ogniska. To jest zachowanie bardziej mylące niż zwykły brak reakcji, nie mniej.

Wyjątek: przy `reducedMotion` klik działa poprawnie, bo `handleButtonClick` woła wtedy `setActive`
bezpośrednio. Defekt dotyczy więc ustawienia domyślnego, czyli większości użytkowników.

**Polecenie dowodu:**

```bash
sed -n '88,96p;124,136p;145,153p' src/components/ui/progressive-carousel.tsx
grep -n "ProgressSlider\|SliderBtnGroup" src/components/builder/organisms/widget-view/ProgressCarouselView.tsx
```

**Dlaczego to jest blokujące:** widget karuzeli na stronie publicznej ma listę przycisków
z tytułami slajdów i jest to **jedyna** nawigacja tej karuzeli. Redakcja konfiguruje slajdy
w panelu, a czytelnik nie jest w stanie do nich dotrzeć inaczej niż przez odsunięcie kursora.
Dla użytkownika klawiatury samo przejście `Tab`-em na przycisk blokuje mechanizm, zanim padnie `Enter`.

**Co zrobić:** przenieść `fastTarget` ze stanu refowego do stanu Reacta, albo zawołać
`setProgress(0)` w `handleButtonClick`, żeby wymusić render i ponowne uruchomienie efektu.
Nie wystarczy dopisać `fastTarget.current` do tablicy zależności efektu: zmiana refu nie jest
obserwowalna przez Reacta i tablica zależności jej nie zauważy.

**Czego NIE robić:** nie usuwaj `!hovered` z warunku `autoPlay` - to zatrzymanie autoodtwarzania
pod kursorem jest celowe i poprawne; problemem jest wznowienie pętli przy kliknięciu, nie samo
zatrzymanie.

**Kryterium odbioru:** test komponentu, który renderuje karuzelę z trzema slajdami, wywołuje
`mouseEnter` na sekcji, klika przycisk drugiego slajdu i sprawdza, że aktywny slajd zmienił się
**bez** zdarzenia `mouseLeave`. Drugi test na tej samej ścieżce dla klawiatury: `focus` na przycisku,
`Enter`, zmiana slajdu bez `blur`.

---

## 2. Pozycje zwykłe

### A2. `FloatingInput` generuje identyfikatory z licznika modułowego zamiast z `useId`, więc serwer i klient wypisują różne `id` i `for`

**Gdzie:** `src/components/ui/floating-input.tsx:54-57`.

**Co jest:**

```tsx
let __fidCounter = 0;
function useFallbackId(prefix: string, provided?: string) {
  const [id] = React.useState(() => provided ?? `${prefix}-${++__fidCounter}`);
  return id;
}
```

Licznik stoi w zakresie **modułu**. Na serwerze moduł żyje przez całe życie izolatu, więc licznik
rośnie przez wszystkie obsłużone żądania i nigdy się nie zeruje. W przeglądarce ten sam moduł
startuje od zera, więc **od drugiego żądania w izolacie** render klienta produkuje inny
identyfikator niż przysłany HTML. Ten sam atom osadza identyfikator w `id` pola, `htmlFor` etykiety
i w powiązaniu z komunikatem błędu.

Reszta repozytorium robi to poprawnie: `src/components/ui/switch.tsx:20` używa
`React.useId().replace(...)`.

**Polecenie dowodu:**

```bash
grep -n "__fidCounter" src/components/ui/floating-input.tsx
grep -n "useId" src/components/ui/switch.tsx
grep -n "ssr: false" src/routes/admin.tsx
```

**Jaka jest realna powierzchnia tego defektu, bo pierwsza redakcja tego zlecenia ją zawyżyła.**
Niezależna próba obalenia wykazała, że uzasadnienie wagi było w większości błędne. Sprawdziłem
każdy zarzut ręcznie i prostuję, bo **te sprostowania przesuwają połowę argumentu**:

1. **Formularze uwierzytelniania są POZA defektem.** Wszystkie osiem wywołań
   `FloatingInput`/`FloatingTextarea` w `src/components/blocks/AuthFormBlocks.tsx` (wiersze 181,
   370, 383, 508, 899, 927, 1056, 1194) przekazuje **jawne `id`** (`"auth-email"`, `"reg-confirm"`,
   `"lost-email"`, `"rs-confirm"`, `{name}`, `{field.def.id}`). Ścieżka licznika tam nie wchodzi.
2. **Formularz kontaktowy jest POZA defektem.** Wszystkie trzy pola
   `src/components/pages/ContactForm.tsx` (106, 113, 123) dostają `id` wyliczone z `useId()`.
3. **Cały panel administracyjny jest POZA defektem.** `src/routes/admin.tsx:12` ustawia
   `ssr: false` dla całego poddrzewa `/admin`, z komentarzem wyjaśniającym powód. Bez SSR-owego
   HTML-a nie ma czego rozjechać przy hydracji. To wyklucza największe pozycje listy użyć,
   w tym `admin.web-stories.tsx` (15 pól) i `admin.newsletter.campaigns.$id.tsx` (9).
4. **Skutek dostępnościowy na produkcji nie zachodzi.** React porównuje atrybuty przy hydracji
   wyłącznie w buildzie deweloperskim i nigdy ich nie nadpisuje. W produkcji użytkownik czytnika
   ekranu nie traci powiązania etykiety z polem.

**Zmierzone na `967cec9`, po odrzuceniu wystąpień w komentarzach:** `FloatingInput` ma **30 plików
konsumujących i 131 użyć**, z czego **113 bez jawnego `id`**. Po odjęciu poddrzewa `/admin`
(`ssr: false`) realna powierzchnia SSR to **siedem plików i czterdzieści pól**:

| Plik                                                     | Pól bez `id` |
| -------------------------------------------------------- | -----------: |
| `src/routes/club.apply.tsx`                              |           16 |
| `src/components/interests/JoinUsForm.tsx`                |            9 |
| `src/components/careers/organisms/CareersApplyForm.tsx`  |            6 |
| `src/components/chat/ExpertRequestDialog.tsx`            |            5 |
| `src/components/checkout/GuestCheckoutGate.tsx`          |            2 |
| `src/components/billing/molecules/InvoiceLookupCard.tsx` |            1 |
| `src/components/comments/CommentsSection.tsx`            |            1 |

**Dlaczego to mimo zawężenia jest defekt:** mutacja stanu modułu w fazie renderu jest niezgodna
z modelem współbieżnego Reacta niezależnie od tego, czy dzisiejszy build to zauważa. Konsekwencje,
które zostają po odrzuceniu zawyżonych zarzutów: ostrzeżenia hydratacji w buildzie deweloperskim
na siedmiu publicznych ścieżkach (w tym wniosek o członkostwo w klubie i bramka gościa w kasie),
rozjazd `id` między HTML-em serwera a drzewem klienta, oraz złamanie reguły, którą reszta
repozytorium stosuje konsekwentnie. To jest dług o wadze średniej, wart jednej linii zmiany.

**Co zrobić:** zastąpić `useFallbackId` wywołaniem `React.useId()`, wzorem `switch.tsx:20`,
zachowując możliwość podania `provided` z zewnątrz. Jedna zmiana zamyka wszystkie siedem plików
naraz i nie wymaga ruszania żadnego konsumenta.

**Czego NIE robić:** nie dopisuj jawnych `id` w siedmiu plikach konsumujących zamiast naprawy
w atomie. To jest ta sama praca wykonana siedem razy i zostawia pułapkę dla ósmego konsumenta.

**Kryterium odbioru:** test, w którym dwa niezależnie zamontowane `FloatingInput` mają różne
identyfikatory, `htmlFor` etykiety równa się `id` pola, a identyfikator **nie zależy od liczby
wcześniejszych zamontowań w tym samym module** (zamontuj i odmontuj komponent, potem zamontuj
ponownie i sprawdź, że test nie zależy od wartości licznika).

### A3. Trzy martwe pliki, w tym słownik i18n utrzymywany wyłącznie przez martwy komponent

**Gdzie:** `src/components/ui/download-button.tsx` (110 wierszy),
`src/components/ui/form-link.tsx` (28 wierszy), `src/lib/i18n-download-button.ts` (25 wierszy).

**Co jest:** `download-button.tsx` eksportuje `DownloadButton` (wiersz 27) i typ
`DownloadButtonProps` (wiersz 7). **W całym `src/` nie ma ani jednego importu tego pliku.**
W repozytorium nie ma też `src/components/ui/index.ts`, więc nie istnieje barrel, przez który
komponent mógłby być konsumowany pośrednio.

Jedyny plik, który się do niego odwołuje, to **sam martwy komponent**: `download-button.tsx:5`
wykonuje `import "@/lib/i18n-download-button";`. Ten słownik istnieje wyłącznie po to, żeby
obsłużyć komponent, którego nikt nie renderuje.

`form-link.tsx` eksportuje `FormLink` i `export default FormLink`. Importerów zero. Jednocześnie
`src/components/blocks/AuthFormBlocks.tsx` realizuje tę samą rolę ręcznie w **czterech miejscach**
(wiersze 544, 569, 976, 1076) wzorcem `<Link ... className="form-link">`. Klasa CSS nosi nazwę
komponentu, którego kod pominięto.

**Uwaga na fałszywy trop, żeby nie szukać go drugi raz:** `CvDownloadButton`
w `src/components/author/CvPrintSheet.tsx:82` to **inny komponent**, należący do modułu 1.
Nie jest konsumentem `DownloadButton`.

**Polecenie dowodu (pierwsze trzy mają nie zwrócić nic poza plikiem definicji):**

```bash
grep -rn "components/ui/download-button" src --include="*.ts" --include="*.tsx"
grep -rn "components/ui/form-link"      src --include="*.ts" --include="*.tsx"
grep -rn "i18n-download-button"         src --include="*.ts" --include="*.tsx"
ls src/components/ui/index.ts   # ma nie istnieć
```

**Dlaczego to jest defekt:** 163 martwe wiersze to 3,4% wierszy tej powierzchni, wliczane
do mianownika pomiaru najsłabiej pokrytej powierzchni repozytorium. Druga strona jest utrzymaniowa:
`form-link.tsx` to gotowy komponent dostępnościowy, który istnieje i jest omijany przez cztery
ręczne powtórzenia w formularzach logowania i rejestracji.

**Uwaga o wadze:** przy pierwszej redakcji oceniłem tę pozycję jako blokującą i obniżam ją tutaj
do średniej. Powód: w odróżnieniu od A1 nikt nie jest tu wprowadzany w błąd - to jest dług
utrzymaniowy i zaszumiony mianownik pomiaru, a nie funkcja, która kłamie o swoim działaniu.

**Co zrobić - wybierz JEDNĄ z dwóch dróg i uzasadnij wybór w opisie PR-a:**

- **(a) usunąć martwy kod:** skasować `download-button.tsx` i `i18n-download-button.ts` razem
  (drugi nie ma innego konsumenta niż pierwszy) oraz `form-link.tsx`.
- **(b) podłączyć to, co ma wartość:** `FormLink` podłączyć w `AuthFormBlocks.tsx` w czterech
  wskazanych miejscach i dopiero wtedy otestować jeden komponent zamiast czterech powtórzeń.
  `DownloadButton` podłączyć wyłącznie wtedy, gdy wskażesz realne miejsce w produkcie, które
  go potrzebuje; w przeciwnym razie zastosuj dla niego drogę (a).

**Czego NIE robić:** nie dopisuj testu do pliku, który zamierzasz usunąć, i nie zostawiaj
`i18n-download-button.ts` po usunięciu komponentu - to zamieni martwy kod na martwy słownik
w innym kubełku taksonomii.

**Kryterium odbioru:** przy drodze (a) trzy pliki nie istnieją, a `grep -rn "DownloadButton\|FormLink" src`
nie zwraca nic poza `CvDownloadButton`. Przy drodze (b) dla `FormLink`: cztery wystąpienia
`className="form-link"` w `AuthFormBlocks.tsx` zniknęły na rzecz komponentu, a test komponentu
sprawdza atrybuty dostępnościowe kotwicy.

---

### A4. Pięć miejsc w produkcie nie ustawia ogniska na siatce dni kalendarza: cztery przekazują martwy prop, piąte nie przekazuje żadnego (niski)

**Gdzie:** `src/components/ui/datetime-picker.tsx:103-112` (prop w wierszu 110),
`src/components/admin/blocks/AdminCalendar.tsx:39-45` (prop w 45),
`src/components/admin/coupons/DatePickerField.tsx:92-96` (prop w 96),
`src/routes/search.tsx:117-121` (prop w 121),
`src/components/admin/analytics/TimeRangeFilter.tsx:163` (**bez żadnego z dwóch propów**).

**Co jest:** w zainstalowanej `react-day-picker` **9.14.0** nazwa `initialFocus` występuje wyłącznie
w dwóch plikach deklaracji typów (`dist/esm/types/props.d.ts`, `dist/cjs/types/props.d.ts`),
oznaczona jako `@private` i `@deprecated`, i **nie jest odczytywana przez żaden plik implementacji**.
Mechanizm ogniska czyta `autoFocus`:

```js
const { autoFocus } = props;
const [focusedDay, setFocused] = useState(autoFocus ? focusTarget : undefined);
```

Prop przechodzi przez rozwinięcie `{...props}` i jest po cichu ignorowany.

**Polecenie dowodu:**

```bash
grep -rl "initialFocus" node_modules/react-day-picker/dist/     # tylko dwa pliki .d.ts
grep -n "autoFocus" node_modules/react-day-picker/dist/esm/useFocus.js
grep -rn "initialFocus" src --include="*.tsx"                   # cztery miejsca
grep -rn "<Calendar$" src --include="*.tsx" | grep -v __tests__ # piąte miejsce w TimeRangeFilter
```

**Jaki jest realny skutek, bo pierwotne zgłoszenie go zawyżyło.** Niezależna próba obalenia
wykazała trzy nieścisłości i wszystkie trzy prostuję, bo zmieniają one wagę pozycji:

1. **Ognisko trafia do popovera**, a nie „donikąd". Radix przenosi je efektem montowania także
   przy nieuwięzionym ognisku, a pierwszym elementem tabowalnym w DOM wersji 9 jest przycisk
   „poprzedni miesiąc", bo nawigacja renderuje się przed siatkami miesięcy. Ognisko ląduje więc
   **o jeden `Tab` za wcześnie**, a nie poza komponentem.
2. **Nie ma pułapki klawiatury ani treści nieosiągalnej.** Dzień będący celem ogniska ma
   `tabIndex = 0`, a jego `onFocus` ustawia stan ogniska, więc dokładnie jedno naciśnięcie `Tab`
   wprowadza do siatki i od tego momentu strzałki działają normalnie. **Nie jest to naruszenie
   WCAG 2.1.1 ani 2.4.3.**
3. **Waga jest niska, nie średnia.** To jest martwa konfiguracja i degradacja o jedno naciśnięcie
   klawisza, a nie zablokowana funkcja.

**Dlaczego mimo to warto to zamknąć:** prop jest oznaczony `@deprecated` i zniknie w kolejnym
wydaniu głównym biblioteki. Dług trzeba spłacić zanim wymusi go aktualizacja, a nie dlatego,
że użytkownik klawiatury jest dziś zablokowany. Drugi powód jest czytelniczy: osoba czytająca kod
widzi zabezpieczenie, którego nie ma, i komentarz w
`src/components/admin/blocks/__tests__/adminCalendar.test.tsx:42` utrwala to nieporozumienie.

**Uwaga o zakresie, bo to jedyny wyjątek od reguły 6 z rozdz. 5:** cztery z pięciu miejsc leżą
**poza** design systemem (panel bloków, kupony, analityka, wyszukiwarka). Naprawa samego
`datetime-picker.tsx` zostawi cztery pozostałe w tym samym stanie. Wolno Ci ruszyć te pliki
w tym PR-ze, ale **wyłącznie** w zakresie propa ogniska; wszystko inne w nich zostaw.

**Co zrobić:** w czterech miejscach zamienić `initialFocus` na `autoFocus`; w `TimeRangeFilter.tsx:163`
**dodać** `autoFocus`, którego tam nie ma wcale. Zweryfikuj przy okazji, czy dla trybu zakresu
z dwoma miesiącami `autoFocus` daje sensowny cel ogniska.

**Czego NIE robić:** nie zostawiaj `TimeRangeFilter.tsx` poza zmianą tylko dlatego, że nie pasuje
do diagnozy „martwy prop". To jest dokładnie to samo zachowanie dla użytkownika, wynikające
z innej przyczyny.

**Kryterium odbioru:** test wyboru daty, który otwiera popover i sprawdza, że ognisko jest
w siatce dni, a nie na przycisku nawigacji miesiąca. Jeżeli środowisko testowe nie ma silnika
ogniska (komentarz w `adminCalendar.test.tsx:42` mówi, że happy-dom go nie ma), sprawdź
przynajmniej, że do kalendarza trafia prop o nazwie, którą biblioteka faktycznie czyta,
i że trafia we wszystkich pięciu miejscach.

## 3. Pozycje pokryciowe - dług, który nie jest defektem

Dwanaście plików tej powierzchni **nie jest importowanych przez żaden plik w korpusie testowym**.
To jest **dolna granica** długu pokryciowego, nie cały dług: plik zaimportowany przez test może
nadal mieć niewykonane gałęzie.

| Plik                                         | Wiersze |
| -------------------------------------------- | ------: |
| `src/components/ui/signup-showcase.tsx`      |     448 |
| `src/components/ui/progressive-carousel.tsx` |     241 |
| `src/components/ui/context-menu.tsx`         |     190 |
| `src/components/ui/command.tsx`              |     142 |
| `src/components/ui/download-button.tsx`      |     110 |
| `src/components/ui/breadcrumb.tsx`           |     101 |
| `src/components/ui/grid-pattern.tsx`         |      62 |
| `src/components/ui/field-box.tsx`            |      50 |
| `src/components/ui/subscribe-button.tsx`     |      36 |
| `src/components/ui/hover-card.tsx`           |      30 |
| `src/components/ui/form-link.tsx`            |      28 |
| `src/components/ui/skeleton.tsx`             |       7 |

**Kolejność pracy jest podyktowana liczbą konsumentów produkcyjnych, nie liczbą wierszy.**
Zmierzone na `967cec9`:

- **`skeleton.tsx` - 18 konsumentów, 7 wierszy.** Najtańszy test w całej tabeli i największa
  dźwignia regresyjna. Zacznij od niego.
- **`field-box.tsx` - 10 konsumentów, 50 wierszy.** Element formularzy.
- **`subscribe-button.tsx` - 9 konsumentów, 36 wierszy.**
- **`context-menu.tsx` (2), `breadcrumb.tsx` (2), `hover-card.tsx` (2)** - komponenty nawigacyjne
  i menu; tu testuj dostępność (rola, `aria-*`, obsługa klawiatury, pułapka ogniskowania),
  bo to jest warstwa, w której regresja jest niewidoczna wzrokowo.
- **`signup-showcase.tsx` (448 wierszy, 1 konsument: `src/components/popups/SignupPopupPanel.tsx`)** -
  największy plik powierzchni. **Nie jest martwy**, sprawdzone. Ma jednego konsumenta i nie ma testu.
- **`progressive-carousel.tsx` (1 konsument: `widget-view/ProgressCarouselView.tsx`)**,
  **`command.tsx` (1: `search/CommandPalette.tsx`)**, **`grid-pattern.tsx` (1: `ui/grid-card.tsx`)** -
  wszystkie mają realnego konsumenta w produkcie.
- **`download-button.tsx` i `form-link.tsx`** - zero konsumentów; **nie pisz do nich testów**,
  są przedmiotem A3.

**B1. Powierzchnia musi dostać próg per-ścieżka.** Bez tego każda praca z tego zlecenia jest
odwracalna następnym commitem bez sygnału z CI. Próg ustaw metodą tego repozytorium: **zmierz,
a potem postaw zaporę tuż pod zmierzonym poziomem**, nigdy odwrotnie. Wzorzec stoi
w `vitest.config.ts` przy `src/components/network/**` i `src/lib/network/**`.

---

## 4. Czego dowód nie obejmuje - do rozstrzygnięcia, nie do wykonania

1. **Procenty pokrycia tej powierzchni na `967cec9`.** Nie zmierzone (patrz ostrzeżenie na górze).
   Liczby audytu pochodzą z `5fd13461c`, a okna `5fd13461c..7a780b1` nie da się przemierzyć
   w płytkim klonie. Pewne jest tylko, że okno `7a780b1..967cec9` nie ruszyło tej powierzchni.
2. **Które 3 pliki stoją na zerze.** Audyt podaje liczbę, nie nazwy. Lista z rozdz. 3 jest listą
   plików bez importu w testach, co jest kryterium pokrewnym, ale nie tożsamym z `lines.covered === 0`.
3. **Czy 45 plików to właściwy mianownik.** Rozbieżność z tabelą 9.1 audytu (44 pliki / 4 559 wierszy)
   nie została rozstrzygnięta co do przyczyny; wskazana jako obserwacja, nie jako zadanie.

---

## 5. Zasady, których nie wolno złamać

1. **Nie obniżaj żadnego progu w `vitest.config.ts`.** Progi w tym repozytorium są zapadką: wolno
   je wyłącznie podnosić. Jeżeli próg blokuje Twoją zmianę, to zmiana jest do poprawy, nie próg.
2. **Nie pomijaj, nie wyłączaj i nie kwarantannuj testu**, żeby uzyskać zieleń. Żaden `it.skip`,
   `describe.skip` ani bezwarunkowe pominięcie. Wydanie 9 odnotowało pierwsze bezwarunkowe
   pominięcie w serii jako regres wobec własnego zapisu audytu; wydanie 10 je zdjęło.
3. **Nie dopisuj `as any` ani `: any`.** Repozytorium ma zmierzone zero `as any` w kodzie pisanym
   ręcznie i jedną adnotację `: any`. Nie dokładaj drugiej.
4. **Nie zamrażaj zegara przez `vi.setSystemTime` w bloku `describe`** bez odmrożenia - to jest
   otwarta pozycja audytu (bomba w darowiznach, rozdz. 14.9 pozycja 2).
5. **Nie licz na to, że test renderujący bez asercji coś mierzy.** Pokrycie jest ślepe na test,
   który padł na asercji, ale nie jest ślepe na kod, do którego nigdy nie dojechał. Test bez
   asercji podnosi procent i nie chroni niczego.
6. **Nie rozszerzaj zakresu PR-a poza tę powierzchnię.** Wyjątek: `src/lib/i18n-download-button.ts`,
   który jest częścią A3 i bez którego A3 nie da się domknąć. Drugim wyjątkiem są cztery pliki
   spoza design systemu wskazane w A4, wyłącznie w zakresie propa ogniska.
7. **Nie używaj znaku U+2014 (długiej kreski) w plikach tego repozytorium.** Sprawdzisz siebie
   poleceniem `LC_ALL=C.UTF-8 grep -nP "\x{2014}" <plik>` - ma nie wypisać nic. Znak podaję kodem,
   a nie dosłownie, właśnie po to, żeby ten dokument nie łamał reguły, którą stawia. Prefiks
   `LC_ALL` nie jest ozdobnikiem: bez niego `grep -P` w tym obrazie odpowiada
   `character code point value in \x{} or \o{} is too large` i kontrola tylko wygląda na wykonaną.

---

## 6. Standard kodu

- Test komponentu dostępnościowego sprawdza **rolę, atrybuty `aria-*`, obsługę klawiatury
  i zarządzanie ogniskiem**, nie tylko obecność tekstu w drzewie.
- Nazwy testów po polsku, w trybie orzekającym, opisujące **zachowanie**, nie implementację.
- Jeden plik testowy na jeden komponent, w `src/components/ui/__tests__/`.
- Nie mockuj tego, co możesz wyrenderować. Mock biblioteki interfejsu jest ostatecznością.
- `prettier --check .` i `eslint .` mają przechodzić przed wysłaniem PR-a.

---

## 7. Kryterium odbioru całości

1. **A1 zamknięty** (blokujący) oraz **A2, A3 i A4 zamknięte** albo świadomie odłożone
   z uzasadnieniem w opisie PR-a. Przy A3 uzasadnij wybór jednej z dwóch dróg.
2. **Powierzchnia ma próg per-ścieżka** dla `src/components/ui/**`, wyznaczony tuż pod poziomem
   zmierzonym po Twojej pracy, nie przed nią.
3. **Zero plików bez importu w korpusie testowym**, poza tymi, które A3 usunął.
4. **Pokrycie linii powierzchni nie niższe niż 92%** i **funkcji nie niższe niż 90%**, zmierzone
   poleceniem z rozdz. 0 tego zlecenia po Twojej pracy. Jeżeli pomiar wyjściowy na `967cec9`
   okaże się istotnie inny niż 81,48% z audytu, **podaj obie liczby w opisie PR-a** i przyjmij
   za punkt odniesienia własny pomiar, nie liczbę z tego zlecenia.
5. **`bun run verify:blocking` przechodzi.**
