// Powierzchnie pomocnicze modułu klubów: szkielety ładowania, motyw granatowy
// i okładka klubu.
//
// CO TO DOWODZI.
//
// (1) SZKIELET MA KSZTAŁT TREŚCI, KTÓRĄ ZASTĘPUJE. To jest cała teza obu
//     plików szkieletów (patrz ich nagłówki): stan ładowania nie jest jednym
//     szarym prostokątem, tylko układem o tej samej liczbie elementów i tych
//     samych kolumnach co treść docelowa - inaczej dojście danych PODSKAKUJE.
//     Ta obietnica jest sprawdzalna wyłącznie przez LICZBĘ prymitywów
//     `Shimmer` i liczbę kart w każdym wariancie, więc test jedzie tabelami:
//     pomyłka w kształcie (np. karta bez pasa obrazu, edytorial liczony jak
//     karty) nie zmienia niczego, co widać w recenzji kodu, a psuje dokładnie
//     to, po co ten kod powstał.
//
// (2) KAŻDY PROPS Z DOMYŚLNĄ WARTOŚCIĄ MA DWIE DROGI. `layout = "cards"`,
//     `count = 6`, `count = 5`, `count = 4` - test przechodzi wariant DOMYŚLNY
//     i JAWNY osobno, bo to dwie różne gałęzie i tylko jedna z nich jest
//     używana przez trasy. Osobno wchodzi `count={0}`: szkielet ma wtedy
//     narysować zero elementów i NIE MOŻE rzucić (trasa liczy `count`
//     z parametrów strony, więc zero jest osiągalne).
//
// (3) SZKIELET OGŁASZA SIĘ JAKO ZAJĘTY I NIE CZYTA SIĘ JAKO TREŚĆ. Każda
//     powierzchnia wystawia `aria-busy="true"` i ma PUSTĄ treść tekstową -
//     szkielet, który przecieka napis zastępczy, czytnik ekranu przeczyta jako
//     prawdziwą treść.
//
// (4) MOTYW GRANATOWY SPRZĄTA PO SOBIE. `ClubNavyTheme` nakłada klasę na
//     `<html>`, czyli poza drzewo Reacta - brak zdjęcia klasy przy
//     odmontowaniu zostawia paletę klubu na CAŁYM serwisie (header, stopka,
//     wszystkie inne trasy) i jest to błąd, którego nie widać w żadnym teście
//     samej trasy klubu. Test dowodzi nałożenia, zdjęcia i tego, że zdejmowana
//     jest TYLKO ta jedna klasa.
//
// (5) OKŁADKA RÓŻNI SIĘ ZACHOWANIEM, NIE KOSMETYKĄ. `banner` bez zdjęcia nie
//     rysuje NIC (pusty pas 3:1 nad tytułem to gorsza strona niż brak pasa),
//     `card` bez zdjęcia rysuje zastępnik ukryty przed czytnikiem (siatka
//     z kaflami różnej wysokości rozjeżdża się). Strażnik jest ścisły co do
//     treści adresu: `null`, `undefined`, `""` i same białe znaki to „brak
//     okładki". Baner jest kandydatem na LCP (ładowany `eager`), kafel katalogu
//     nie (`lazy`) - kilkanaście kafli ładowanych zachłannie to ta sama regresja
//     transferu, którą `responsive` miał usunąć.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) `OptimizedImage` (budowa `srcSet`, awaria ładowania, warianty `hoverEffect`,
//     `buildImageSrcSet`/`isSupabaseStorageUrl`) ma własne suity - tutaj wchodzi
//     tylko to, co `ClubCover` do niego WKŁADA: adres, `responsive`, `sizes`
//     zależne od wariantu, `priority` zależne od wariantu i `alt=""`.
// (b) Wyglądu klas Tailwinda. Asercje idą po fragmentach klas, które są nośnikiem
//     ZNACZENIA (liczba kolumn siatki, proporcja pasa, wysokość kafla pomiaru),
//     a nie po całym atrybucie `class`, który wolno przeformatować.
// (c) Reguł CSS motywu granatowego (`src/styles.css`) - test warstwy React
//     dowodzi obecności klasy, a nie tego, jakie tokeny ona nadpisuje.
// (d) I18n: żadna z tych powierzchni nie tłumaczy ani jednego napisu (szkielet
//     jest bez tekstu, `alt` okładki jest celowo pusty), więc nie ma tu atrapy
//     `react-i18next` ani asercji na kluczach - nie ma czego asertować.
// (e) `layout` spoza zbioru `ClubLayout` - sygnatura przyjmuje unię, więc taka
//     wartość wymagałaby rzutowania, którego reguły repozytorium zabraniają.
//     Zawężanie napisu z RPC to `toClubLayout` w `lib/clubs/types` i tam leży
//     jego dowód.
// (f) `count` ujemnego - `Array.from({ length: -1 })` daje w JS pustą tablicę,
//     więc to ten sam przypadek co `count={0}`, tylko zapisany inaczej.
//
// ZNANE OGRANICZENIE, KTÓRE TEST UTRWALA JAKO STAN FAKTYCZNY: kontenery
// szkieletów mają `aria-busy`, ale NIE mają `role="status"` ani `aria-hidden`,
// a same paski `Shimmer` nie są ukryte przed czytnikiem ekranu. Etap 2 nie
// zmienia kodu produkcyjnego, więc jest to zgłoszone w raporcie, a nie
// naprawione tutaj.
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import { render } from "@testing-library/react";

import {
  ClubDetailSkeleton,
  ClubDirectorySkeleton,
  ClubHeaderSkeleton,
  ClubThreadListSkeleton,
  Shimmer,
} from "@/components/clubs/atoms/ClubSkeletons";
import {
  ClubCalendarSkeleton,
  ClubDocumentsSkeleton,
  ClubInsightsSkeleton,
  ClubScheduleSkeleton,
} from "@/components/clubs/atoms/ClubWorkspaceSkeletons";
import { CLUB_NAVY_CLASS, ClubNavyTheme } from "@/components/clubs/atoms/ClubNavyTheme";
import { ClubCover } from "@/components/clubs/atoms/ClubCover";
import { CLUB_LAYOUTS, type ClubLayout } from "@/lib/clubs/types";

/**
 * Prymityw `Shimmer` rozpoznajemy po `animate-pulse` - to jedyna klasa, którą
 * nadaje wyłącznie on, i jednocześnie nośnik jego funkcji (jedno tempo animacji
 * dla całego modułu). Liczba tych węzłów JEST kształtem szkieletu.
 */
function shimmers(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".animate-pulse"));
}

/** Karty/wiersze szkieletu - każda ma tło `bg-card`. */
function cards(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll(".bg-card"));
}

function busyRegions(container: HTMLElement): Element[] {
  return Array.from(container.querySelectorAll('[aria-busy="true"]'));
}

describe("Shimmer - prymityw szkieletu", () => {
  it("dokłada klasę wywołującego do własnych klas animacji", () => {
    const { container } = render(<Shimmer className="h-4 w-16" />);
    const bar = container.firstElementChild;
    expect(bar).not.toBeNull();
    expect(bar?.classList.contains("animate-pulse")).toBe(true);
    expect(bar?.classList.contains("h-4")).toBe(true);
    expect(bar?.classList.contains("w-16")).toBe(true);
  });

  it("bez klasy wywołującego nie wpisuje w atrybut napisu 'undefined'", () => {
    const { container } = render(<Shimmer />);
    const bar = container.firstElementChild;
    expect(bar?.classList.contains("animate-pulse")).toBe(true);
    expect(bar?.getAttribute("class")).not.toContain("undefined");
  });

  it("jest pustym paskiem - nie wnosi treści do czytnika ekranu", () => {
    const { container } = render(<Shimmer className="h-3 w-8" />);
    expect(container.textContent).toBe("");
    expect(container.firstElementChild?.childElementCount).toBe(0);
  });
});

describe("ClubDirectorySkeleton - kształt wybranego układu huba", () => {
  /**
   * Ile pasków `Shimmer` ma szkielet KAŻDEGO układu przy `count` elementach.
   * Karta: pas obrazu + tytuł + dwie linie opisu + trzy liczniki (7).
   * Wiersz listy: miniatura + trzy linie (4).
   * Magazyn: jeden blok wiodący (4) + reszta jako wiersze.
   * Edytorial: karta z belką znacznika, czyli o pasek więcej niż karta (8).
   */
  const SHIMMERS_PER_LAYOUT: Array<[ClubLayout, (count: number) => number]> = [
    ["list", (count) => 4 * count],
    ["cards", (count) => 7 * count],
    ["magazine", (count) => 4 + 4 * Math.max(count - 1, 0)],
    ["editorial", (count) => 8 * count],
  ];

  it.each(SHIMMERS_PER_LAYOUT)(
    "układ %s rysuje kształt swojej siatki dla JAWNEGO count",
    (layout, expected) => {
      const { container } = render(<ClubDirectorySkeleton layout={layout} count={3} />);
      expect(shimmers(container)).toHaveLength(expected(3));
      expect(busyRegions(container)).toHaveLength(1);
    },
  );

  it.each(SHIMMERS_PER_LAYOUT)(
    "układ %s z DOMYŚLNYM count rysuje sześć pozycji",
    (layout, expected) => {
      const { container } = render(<ClubDirectorySkeleton layout={layout} />);
      expect(shimmers(container)).toHaveLength(expected(6));
    },
  );

  it("bez żadnego propsa bierze układ kart i sześć pozycji", () => {
    const { container } = render(<ClubDirectorySkeleton />);
    expect(cards(container)).toHaveLength(6);
    expect(shimmers(container)).toHaveLength(42);
  });

  it("domyślny układ przyjmuje jawny count (kart tyle, ile poproszono)", () => {
    const { container } = render(<ClubDirectorySkeleton count={2} />);
    expect(cards(container)).toHaveLength(2);
    expect(shimmers(container)).toHaveLength(14);
  });

  /**
   * Liczba kolumn siatki to jedyna rzecz, która odróżnia szkielety kart
   * i edytorialu bez zaglądania w treść - a pomyłka tutaj daje stan ładowania
   * o innej liczbie kolumn niż treść, czyli dokładnie ten podskok układu,
   * któremu szkielet ma zapobiegać.
   */
  const GRID_MARK: Array<[ClubLayout, string]> = [
    ["list", "flex-col"],
    ["cards", "xl:grid-cols-4"],
    ["magazine", "space-y-3"],
    ["editorial", "xl:grid-cols-3"],
  ];

  it.each(GRID_MARK)("układ %s ma własny kontener siatki (%s)", (layout, mark) => {
    const { container } = render(<ClubDirectorySkeleton layout={layout} count={2} />);
    const root = container.firstElementChild;
    expect(root?.getAttribute("class")).toContain(mark);
  });

  it("magazyn ma DOKŁADNIE jeden blok wiodący dwukolumnowy, resztę jako wiersze", () => {
    const { container } = render(<ClubDirectorySkeleton layout="magazine" count={4} />);
    expect(container.querySelectorAll('[class*="md:grid-cols-2"]')).toHaveLength(1);
    // Blok wiodący + trzy wiersze; wiersz ma 4 paski, blok wiodący 4.
    expect(cards(container)).toHaveLength(4);
  });

  it.each(CLUB_LAYOUTS)("układ %s z count=0 nie rzuca i nie rysuje pozycji", (layout) => {
    const { container } = render(<ClubDirectorySkeleton layout={layout} count={0} />);
    expect(busyRegions(container)).toHaveLength(1);
    // Magazyn jest wyjątkiem świadomym: blok wiodący jest bezwarunkowy, więc
    // zostają jego cztery paski. Pozostałe układy nie rysują nic.
    expect(shimmers(container)).toHaveLength(layout === "magazine" ? 4 : 0);
  });
});

describe("ClubHeaderSkeleton - nagłówek klubu", () => {
  it("rysuje pas okładki, tytuł z opisem, trzy akcje i dwa liczniki", () => {
    const { container } = render(<ClubHeaderSkeleton />);
    const root = container.firstElementChild;
    expect(root?.tagName).toBe("HEADER");
    expect(root?.getAttribute("aria-busy")).toBe("true");
    expect(shimmers(container)).toHaveLength(8);
    expect(container.querySelectorAll('[class*="aspect-[5/1]"]')).toHaveLength(1);
  });
});

describe("ClubThreadListSkeleton - lista wątków", () => {
  it("bez propsa rysuje pięć kart wątku", () => {
    const { container } = render(<ClubThreadListSkeleton />);
    expect(cards(container)).toHaveLength(5);
    expect(shimmers(container)).toHaveLength(25);
  });

  it.each([
    [1, 5],
    [2, 10],
    [7, 35],
  ])("count=%i daje kart tyle, ile poproszono (%i pasków)", (count, expected) => {
    const { container } = render(<ClubThreadListSkeleton count={count} />);
    expect(cards(container)).toHaveLength(count);
    expect(shimmers(container)).toHaveLength(expected);
  });

  it("count=0 zostawia sam kontener zajętości, bez kart i bez wyjątku", () => {
    const { container } = render(<ClubThreadListSkeleton count={0} />);
    expect(busyRegions(container)).toHaveLength(1);
    expect(cards(container)).toHaveLength(0);
    expect(shimmers(container)).toHaveLength(0);
  });
});

describe("ClubDetailSkeleton - cała strona klubu przy pierwszym pobraniu", () => {
  it("składa nagłówek, pasek narzędzi i domyślną listę wątków", () => {
    const { container } = render(<ClubDetailSkeleton />);
    expect(container.querySelectorAll("header")).toHaveLength(1);
    // Nagłówek (8) + trzy pola paska narzędzi + pięć kart wątku po 5 pasków.
    expect(shimmers(container)).toHaveLength(36);
    expect(cards(container)).toHaveLength(5);
    // Dwa niezależne obszary zajętości: nagłówek i lista.
    expect(busyRegions(container)).toHaveLength(2);
  });
});

describe("ClubDocumentsSkeleton - lista dokumentów", () => {
  it("bez propsa rysuje pięć wierszy z ikoną, tytułem i dwoma znacznikami", () => {
    const { container } = render(<ClubDocumentsSkeleton />);
    expect(cards(container)).toHaveLength(5);
    expect(shimmers(container)).toHaveLength(25);
  });

  it("jawny count zmienia liczbę wierszy, nie ich kształt", () => {
    const { container } = render(<ClubDocumentsSkeleton count={2} />);
    expect(cards(container)).toHaveLength(2);
    expect(shimmers(container)).toHaveLength(10);
  });

  it("count=0 nie rysuje wierszy i nie rzuca", () => {
    const { container } = render(<ClubDocumentsSkeleton count={0} />);
    expect(cards(container)).toHaveLength(0);
    expect(busyRegions(container)).toHaveLength(1);
  });
});

describe("ClubCalendarSkeleton - siatka miesiąca plus nadchodzące", () => {
  it("rysuje jedną siatkę miesiąca i cztery pozycje listy nadchodzących", () => {
    const { container } = render(<ClubCalendarSkeleton />);
    expect(cards(container)).toHaveLength(4);
    // Siatka miesiąca (1) + cztery pozycje po trzy paski.
    expect(shimmers(container)).toHaveLength(13);
    expect(container.querySelectorAll('[class*="aspect-[7/6]"]')).toHaveLength(1);
  });

  it("ma dwie kolumny: kalendarz i panel boczny", () => {
    const { container } = render(<ClubCalendarSkeleton />);
    const root = container.firstElementChild;
    expect(root?.getAttribute("class")).toContain("lg:grid-cols-[minmax(0,1fr)_22rem]");
    expect(root?.getAttribute("aria-busy")).toBe("true");
  });
});

describe("ClubScheduleSkeleton - os czasu harmonogramu", () => {
  it("bez propsa rysuje cztery kroki, każdy z kropką na osi", () => {
    const { container } = render(<ClubScheduleSkeleton />);
    expect(cards(container)).toHaveLength(4);
    expect(shimmers(container)).toHaveLength(16);
    // Kropka osi jest okrągła i stoi POZA kartą - stąd osobny licznik.
    expect(container.querySelectorAll('[class*="rounded-full"]').length).toBeGreaterThanOrEqual(4);
  });

  it.each([
    [1, 4],
    [6, 24],
  ])("count=%i daje tyle kroków (%i pasków)", (count, expected) => {
    const { container } = render(<ClubScheduleSkeleton count={count} />);
    expect(cards(container)).toHaveLength(count);
    expect(shimmers(container)).toHaveLength(expected);
  });

  it("count=0 nie rysuje kroków i nie rzuca", () => {
    const { container } = render(<ClubScheduleSkeleton count={0} />);
    expect(cards(container)).toHaveLength(0);
    expect(shimmers(container)).toHaveLength(0);
    expect(busyRegions(container)).toHaveLength(1);
  });
});

describe("ClubInsightsSkeleton - pulpit pomiaru", () => {
  it("rysuje cztery kafle liczników, wykres główny i dwa wykresy poboczne", () => {
    const { container } = render(<ClubInsightsSkeleton />);
    expect(container.querySelectorAll(".h-24")).toHaveLength(4);
    expect(container.querySelectorAll(".h-64")).toHaveLength(1);
    expect(container.querySelectorAll(".h-56")).toHaveLength(2);
    expect(shimmers(container)).toHaveLength(7);
    expect(busyRegions(container)).toHaveLength(1);
  });
});

describe("szkielety - kontrakt dostępności wspólny dla wszystkich powierzchni", () => {
  const SURFACES: Array<[string, () => ReactElement]> = [
    ["ClubDirectorySkeleton", () => <ClubDirectorySkeleton />],
    ["ClubHeaderSkeleton", () => <ClubHeaderSkeleton />],
    ["ClubThreadListSkeleton", () => <ClubThreadListSkeleton />],
    ["ClubDetailSkeleton", () => <ClubDetailSkeleton />],
    ["ClubDocumentsSkeleton", () => <ClubDocumentsSkeleton />],
    ["ClubCalendarSkeleton", () => <ClubCalendarSkeleton />],
    ["ClubScheduleSkeleton", () => <ClubScheduleSkeleton />],
    ["ClubInsightsSkeleton", () => <ClubInsightsSkeleton />],
  ];

  it.each(SURFACES)(
    "%s ogłasza zajętość i nie przecieka ani jednego znaku treści",
    (_nazwa, element) => {
      const { container } = render(element());
      expect(busyRegions(container).length).toBeGreaterThan(0);
      expect(container.textContent).toBe("");
    },
  );
});

describe("ClubNavyTheme - paleta klubu na całym dokumencie", () => {
  /** Klasa jest kontraktem z `src/styles.css` - zmiana napisu zabija override. */
  it("wystawia klasę override pod stałą nazwą", () => {
    expect(CLUB_NAVY_CLASS).toBe("club-navy");
  });

  it("nakłada klasę na <html> po zamontowaniu i renderuje pusto", () => {
    expect(document.documentElement.classList.contains(CLUB_NAVY_CLASS)).toBe(false);
    const { container } = render(<ClubNavyTheme />);
    expect(container.firstChild).toBeNull();
    expect(document.documentElement.classList.contains(CLUB_NAVY_CLASS)).toBe(true);
  });

  it("zdejmuje klasę przy odmontowaniu i nie rusza pozostałych klas dokumentu", () => {
    const root = document.documentElement;
    root.classList.add("dark");
    try {
      const view = render(<ClubNavyTheme />);
      expect(root.classList.contains(CLUB_NAVY_CLASS)).toBe(true);
      view.unmount();
      expect(root.classList.contains(CLUB_NAVY_CLASS)).toBe(false);
      expect(root.classList.contains("dark")).toBe(true);
    } finally {
      root.classList.remove("dark");
    }
  });
});

/** Adres w kształcie, który `OptimizedImage` umie skalować (Supabase Storage). */
const COVER_URL = "https://przyklad.supabase.co/storage/v1/object/public/media/klub-korytarz.jpg";

describe("ClubCover - wariant banner", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same białe znaki", "   "],
  ])("bez okładki (%s) nie rysuje NIC", (_nazwa, url) => {
    const { container } = render(<ClubCover url={url} variant="banner" />);
    expect(container.firstChild).toBeNull();
  });

  it("z okładką rysuje pas 3:1 i obraz kandydujący do LCP", () => {
    const { container } = render(<ClubCover url={COVER_URL} variant="banner" />);
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe(COVER_URL);
    // `alt` celowo pusty: nazwa klubu stoi obok w nagłówku.
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("loading")).toBe("eager");
    expect(image?.getAttribute("sizes")).toBe("(min-width: 1024px) 64rem, 100vw");
    expect(container.firstElementChild?.getAttribute("class")).toContain("aspect-[3/1]");
  });

  it("dokłada klasę wywołującego do pasa z okładką", () => {
    const { container } = render(<ClubCover url={COVER_URL} variant="banner" className="mb-4" />);
    expect(container.firstElementChild?.classList.contains("mb-4")).toBe(true);
  });
});

describe("ClubCover - wariant card", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["pusty napis", ""],
    ["same białe znaki", "\n \t"],
  ])("bez okładki (%s) rysuje zastępnik ukryty przed czytnikiem ekranu", (_nazwa, url) => {
    const { container } = render(<ClubCover url={url} variant="card" />);
    const placeholder = container.firstElementChild;
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
    // Zastępnik trzyma tę samą proporcję co okładka, więc kafle w siatce
    // zostają równej wysokości.
    expect(placeholder?.getAttribute("class")).toContain("aspect-[16/9]");
    expect(placeholder?.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector("img")).toBeNull();
  });

  it("dokłada klasę wywołującego do zastępnika", () => {
    const { container } = render(<ClubCover url={null} variant="card" className="border-b" />);
    expect(container.firstElementChild?.classList.contains("border-b")).toBe(true);
  });

  it("z okładką rysuje obraz leniwy i węższe `sizes` niż baner", () => {
    const { container } = render(<ClubCover url={COVER_URL} variant="card" />);
    const image = container.querySelector("img");
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("sizes")).toBe(
      "(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw",
    );
    expect(container.firstElementChild?.getAttribute("class")).toContain("rounded-t-lg");
  });

  it("prosi o warianty szerokości - kafel katalogu nie ściąga pełnej rozdzielczości", () => {
    const { container } = render(<ClubCover url={COVER_URL} variant="card" />);
    const srcSet = container.querySelector("img")?.getAttribute("srcset") ?? "";
    expect(srcSet).not.toBe("");
    expect(srcSet).toContain("width=");
  });
});
