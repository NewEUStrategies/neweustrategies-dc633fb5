// Konfiguracja bramki wierności ustawień: stany próbek + jawne zwolnienia.
//
// Bramka (`settingsFidelity.gate.test.tsx`) porównuje zbiór kluczy treści, które
// panel oferuje redakcji, ze zbiorem kluczy, które renderer naprawdę czyta.
// Ten moduł zawiera DWIE rzeczy i trzeba je ostro rozdzielać:
//
//  1. `WIDGET_PROBE_STATES` - FIXTURA. Mówi, w jakim stanie postawić widget, by
//     jego warunkowa gałąź się otworzyła ("slider ze źródłem manual"). Nie
//     wymienia kluczy, więc nie potrafi niczego zamaskować: ustawienie
//     nieczytane w ŻADNYM stanie nadal wywala bramkę.
//
//  2. `FIDELITY_WAIVERS` - ZWOLNIENIA. Wymieniają konkretne klucze, dla których
//     rozjazd jest zamierzony. Reguły:
//       - POWÓD JEST OBOWIĄZKOWY (bramka odrzuca puste stringi),
//       - ZWOLNIENIE, KTÓRE PRZESTAŁO BYĆ POTRZEBNE, WALI TESTEM - gdy pole
//         zaczyna być czytane albo pojawia się w panelu, wpis MUSI zniknąć,
//       - NIE ZWALNIAJ, ŻEBY ODBLOKOWAĆ WDROŻENIE: martwe pole usuwa się ze
//         schematu, ukryte - dodaje do schematu.
import type { WidgetType } from "../types";
import type { WidgetFidelityWaiver, WidgetProbeState } from "./settingsFidelity";

/**
 * Stany, w których trzeba postawić widget, żeby panel narysował całą swoją
 * powierzchnię, a renderer wszedł we wszystkie gałęzie.
 *
 * Stosowane po OBU stronach inwariantu, więc nie da się nimi "dosypać" odczytów
 * tylko rendererowi ani tylko panelowi. Stan, który nie odblokowuje żadnego
 * nowego klucza, jest zgłaszany jako martwy - lista nie gnije.
 */
export const WIDGET_PROBE_STATES: Partial<Record<WidgetType, ReadonlyArray<WidgetProbeState>>> = {
  // Edytor prelegentów rysuje picker wydarzenia tylko dla źródła "event",
  // a limit/paginację tylko dla katalogu.
  speakers: [
    { label: "source=event", patch: { source: "event", eventId: "stub-event" } },
    // Tryb paginacji (`pageMode`) pojawia się tylko przy niezerowym `pageSize`.
    { label: "source=directory+paged", patch: { source: "directory", pageSize: 8 } },
  ],
  // Rezerwacja spotkań: tryb wydarzenia to inny zestaw pól niż domyślny tryb
  // hosta (ten pokrywają już próbki bazowe).
  "meeting-booking": [{ label: "mode=event", patch: { mode: "event", eventId: "stub-event" } }],
  "event-countdown": [{ label: "mode=event", patch: { mode: "event", eventId: "stub-event" } }],
  "event-countdown-card": [
    { label: "mode=event", patch: { mode: "event", eventId: "stub-event" } },
  ],
  // Mega menu: szerokość "fixed" odsłania suwak szerokości w px.
  "mega-menu": [{ label: "width=fixed", patch: { width: "fixed", widthPx: 900 } }],
  // Slider: samo `source: "manual"` NIE WYSTARCZA - `sliderUsesPostsSource`
  // traktuje listę bez powiązanego zdjęcia/wpisu jak stan nieskonfigurowany i
  // routuje slider do trybu wpisów. Ręczna gałąź otwiera się dopiero na
  // slajdzie z realną treścią.
  slider: [
    {
      label: "source=manual+slides",
      patch: {
        source: "manual",
        items: [
          { image: "https://example.org/probe-1.jpg", title_pl: "Slajd", title_en: "Slide" },
          { image: "https://example.org/probe-2.jpg", title_pl: "Slajd 2", title_en: "Slide 2" },
        ],
      },
    },
  ],
  // Lista z oceną: źródło dynamiczne odsłania filtry zapytania, a każdy tryb
  // przewijania - własne pole (wysokość okna vs rozmiar strony).
  "rated-list": [
    { label: "source=dynamic", patch: { source: "dynamic" } },
    { label: "scrollingMode=scroll", patch: { source: "dynamic", scrollingMode: "scroll" } },
    { label: "scrollingMode=loadmore", patch: { source: "dynamic", scrollingMode: "loadmore" } },
  ],
};

/**
 * Widgety, których renderer przekazuje CAŁĄ treść dalej (`{...content}`), więc
 * czyta każdy klucz naraz. Dla nich bramka nie potrafi wykryć martwego
 * ustawienia - i właśnie dlatego muszą być tu wymienione: luka w pokryciu ma
 * być widoczna, a nie milcząca.
 *
 * Docelowo każdy z nich powinien czytać jawną listę kluczy (jak
 * `authFormSettings.ts` po PR #141) - wtedy wpis znika, a bramka zaczyna go
 * pilnować w pełni.
 */
export const RENDERER_ENUMERATES_CONTENT: Partial<Record<WidgetType, string>> = {
  newsletter:
    "WidgetView buduje config formularza przez `{...content}` (newsletterFormConfig), " +
    "żeby zmapować historyczny `placeholder_*` na `emailPlaceholder_*`. Do rozbicia na " +
    "jawną listę kluczy - wtedy ten wpis znika.",
};

/** Zwolnienia per typ widgetu. Brak wpisu = widget jest w pełni pod bramką. */
export const FIDELITY_WAIVERS: Partial<Record<WidgetType, WidgetFidelityWaiver>> = {
  newsletter: {
    hidden: {
      size: "Odczyt `Set.size` we wspólnej dropliście tematów (TopicsDroplist), nie ustawienie widgetu.",
    },
  },
  button: {
    hidden: {
      widthPx: "Ustawiane uchwytem zmiany rozmiaru na kanwie (ResizableBox), nie kontrolką panelu.",
      heightPx:
        "Ustawiane uchwytem zmiany rozmiaru na kanwie (ResizableBox), nie kontrolką panelu.",
    },
  },
  cta: {
    hidden: {
      ctaWidthPx: "Uchwyt zmiany rozmiaru na kanwie (ResizableBox) - patrz WidgetView case 'cta'.",
      ctaHeightPx: "Uchwyt zmiany rozmiaru na kanwie (ResizableBox) - patrz WidgetView case 'cta'.",
    },
  },
  // Widget "Dołącz do nas": panel przeszedł na treści zlokalizowane
  // (`<klucz>_pl|_en`), a renderer czyta klucz BEZJĘZYKOWY wyłącznie jako
  // fallback dla dokumentów sprzed tej migracji - i tylko wtedy, gdy nie ma
  // ŻADNEJ wersji językowej (`pickStrict` w WidgetView, case "join-us").
  //
  // Ten sam kształt co `toc.items` niżej, tylko szerszy: migracja objęła cały
  // zestaw treści widgetu naraz. Żadna z dwóch "normalnych" dróg nie jest tu
  // poprawna:
  //   * wystawienie kluczy bezjęzykowych w panelu COFNĘŁOBY naprawę - to
  //     dokładnie one powodowały przeciek treści między PL i EN,
  //   * usunięcie fallbacku z renderera skasowałoby redakcji treść wpisaną
  //     przed migracją (cicha utrata danych na istniejących stronach).
  //
  // Reguła precedencji, na którą powołuje się to zwolnienie, JEST przykryta
  // testem: `src/components/admin/builder/__tests__/joinUsLegacyContent.test.tsx`
  // (zlokalizowane wygrywa, legacy tylko przy zerze wersji językowych, puste
  // wartości nie liczą się jako wersja). Bez tego testu zwolnienie byłoby
  // deklaracją bez pokrycia.
  "join-us": {
    hidden: Object.fromEntries(
      [
        "title",
        "subtitle",
        "perk1",
        "perk2",
        "perk3",
        "interestsLabel",
        "submitLabel",
        "submittingLabel",
        "consentText",
        "successText",
        "namePlaceholder",
        "emailPlaceholder",
        "firstNamePlaceholder",
        "lastNamePlaceholder",
        "positionPlaceholder",
        "linkedinPlaceholder",
        "phonePlaceholder",
        "companyPlaceholder",
        "countryPlaceholder",
      ].map((key) => [
        key,
        `Klucz historyczny (bez języka): panel oferuje \`${key}_pl|_en\`, renderer czyta ` +
          "`" +
          key +
          "` tylko wtedy, gdy dokument nie ma ŻADNEJ wersji językowej - żeby treść sprzed " +
          "migracji na i18n nie zniknęła. Wystawienie go w panelu cofnęłoby naprawę przecieku " +
          "PL/EN. Precedencję pilnuje joinUsLegacyContent.test.tsx.",
      ]),
    ),
  },
  toc: {
    hidden: {
      items:
        "Klucz historyczny: kontrolka pisała `items` (bez języka), zanim panel przeszedł na " +
        "`items_pl|_en`. Renderer czyta go jako fallback, żeby stare dokumenty nie zgubiły " +
        "ręcznych pozycji. Nie wystawiamy go w panelu - to by cofnęło naprawę.",
    },
  },
  "team-member": {
    dead: {
      authorId:
        "Klucz techniczny wybranego eksperta: panel hydratuje z niego pozostałe pola, " +
        "renderer linkuje po `authorSlug`. Nie jest ustawieniem prezentacji.",
    },
    hidden: {
      image: "Alias historyczny pola `photo` (dokumenty przed ujednoliceniem nazwy).",
    },
  },
  "author-profile-card": {
    dead: {
      authorId:
        "Klucz techniczny wybranego eksperta: panel hydratuje z niego pozostałe pola, " +
        "renderer linkuje po `authorSlug`. Nie jest ustawieniem prezentacji.",
    },
  },
  contact: {
    hidden: {
      showName:
        "Alias historyczny: jeden przełącznik gasił imię i nazwisko razem. Dziś panel ma " +
        "`showFirstName`/`showLastName`, a renderer czyta stary klucz jako domyślną wartość obu.",
    },
  },
  "contact-form": {
    hidden: {
      showName:
        "Alias historyczny: jeden przełącznik gasił imię i nazwisko razem. Dziś panel ma " +
        "`showFirstName`/`showLastName`, a renderer czyta stary klucz jako domyślną wartość obu.",
    },
  },
  // `post-list` / `carousel` NIE MAJĄ już zwolnień dla pary avatar/etykieta:
  // panel i renderer czytają dziś TEN SAM rezolwer (`resolveAuthorDisplay`),
  // więc oba końce widzą identyczny zbiór kluczy autora - bramka pilnuje ich
  // w pełni, bez odstępstw.
  donations: {
    hidden: {
      quickDonate:
        "Alias historyczny: przed wprowadzeniem pola `mode` szybka darowizna była booleanem. " +
        "Renderer czyta go tylko jako domyślną wartość `mode`.",
    },
  },
};
