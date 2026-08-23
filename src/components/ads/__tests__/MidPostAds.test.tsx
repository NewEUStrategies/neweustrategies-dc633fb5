// Wstrzykiwanie reklam W ŚRODEK czytanego tekstu - jedyna powierzchnia, która
// dopisuje węzły do cudzego DOM-u (treść wpisu renderuje się poza Reactem).
// Ryzyko jest dwustronne: za mało wstawek to utracony przychód, za dużo -
// czytelnik dostaje tor przeszkód, a osierocone kontenery zostają w treści.
//
// CO TEN PLIK DOWODZI.
//   1. SUFIT DWÓCH WSTAWEK DZIAŁA NA POZIOMIE DOM I JEST CICHY. Cztery
//      skonfigurowane placementy (paragraf 2, 3, 5, 9) dają DWA kontenery
//      `data-ad-mid-host`; 5 i 9 nie zostawiają ani węzła, ani wpisu
//      w konsoli. Redakcja widzi w panelu cztery wstawki i nie ma jak się
//      dowiedzieć, że dwie nigdy nie poszły.
//   2. `Math.min` PRZYKLEJA REKLAMĘ DO KOŃCA WPISU. `paragraph: 40` przy
//      trzech akapitach nie jest pomijane - kontener staje po OSTATNIM
//      akapicie, czyli wstawka "śródtekstowa" leży pod tekstem.
//   3. ŚMIECIOWA KONFIGURACJA KRADNIE MIEJSCE W LIMICIE. Placement z
//      `paragraph: "co drugi"` przechodzi przez sortowanie i cap, a przy
//      wstawianiu jest pomijany (`paragraphs[NaN]`), więc z TRZECH kampanii
//      czytelnik widzi JEDNĄ reklamę. Nic tego nie zgłasza.
//   4. KOLEJNOŚĆ W DOM JEST ODWRÓCONA przy dwóch wstawkach na ten sam
//      paragraf - `insertBefore(host, target.nextSibling)` wkłada drugi
//      kontener PRZED pierwszym.
//   5. PRZEBUDOWA NIE MNOŻY KONTENERÓW, a odmontowanie ich sprząta - dwie
//      niezależne ścieżki czyszczenia (`querySelectorAll(...).remove()`
//      w efekcie i `el.remove()` w cleanupie).
//   6. DEFEKT: TREŚĆ ZAMONTOWANA PO PIERWSZYM PRZEBIEGU EFEKTU NIE DOSTAJE
//      REKLAM. `articleRef` jest w tablicy zależności, ale ref to STABILNY
//      OBIEKT - jego wypełnienie nie budzi efektu. Jeśli `articleRef.current`
//      jest `null` w chwili pierwszego przebiegu (treść ładowana leniwie,
//      warunkowo renderowany artykuł), mid-post nie pojawia się już nigdy,
//      dopóki czegoś nie zmieni `scanKey` albo tożsamość listy placementów.
//      Zapisane jako `it.fails` - patrz sekcja na końcu pliku.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Czysta logika wyboru (sortowanie, cap,
// przycinanie indeksu) ma własny plik `src/lib/ads/__tests__/injection.test.ts`
// - tutaj sprawdzamy WYNIK W DOM, nie tabelkę przypadków.
//
// ATRAPY I DLACZEGO.
//   * `@/components/AdSlot` - podmieniony na znacznik z `data-placement-id`
//     i `data-slot-id`. Prawdziwy `AdSlotView` ma własny plik testowy
//     (`AdSlotView.test.tsx`) i wciąga bramki zgody, IntersectionObserver
//     oraz `requestIdleCallback`; przedmiotem dowodu jest tutaj TO, CO i GDZIE
//     jest montowane, a nie jak wygląda kreacja.
//   * `@/lib/ads/queries` - `useAdPlacements` ma 100% pokrycia we własnym
//     pliku; atrapa jest jedynym sposobem, żeby podać konkretne konfiguracje
//     placementów. Logika WYBORU wstawek NIE jest zamockowana - liczy ją
//     prawdziwy kod produkcyjny.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { cleanup, render } from "@testing-library/react";
import type { AdPlacementWithSlot, AdSlot } from "@/lib/ads/types";

// --- Atrapy -------------------------------------------------------------

let placements: AdPlacementWithSlot[] | undefined = [];
const wywolaniaZapytania: unknown[][] = [];

vi.mock("@/lib/ads/queries", () => ({
  useAdPlacements: (...args: unknown[]) => {
    wywolaniaZapytania.push(args);
    return { data: placements };
  },
}));

vi.mock("@/components/AdSlot", () => ({
  AdSlotView: ({ placement }: { placement: AdPlacementWithSlot }) => (
    <div
      data-testid="reklama"
      data-placement-id={placement.id}
      data-slot-id={placement.slot.id}
      data-position={placement.position}
    >
      {placement.slot.name}
    </div>
  ),
}));

import { MidPostAds } from "@/components/ads/MidPostAds";

// --- Fixtures -----------------------------------------------------------

function slot(id: string): AdSlot {
  return {
    id,
    tenant_id: "t1",
    name: `Kreacja ${id}`,
    kind: "html",
    status: "active",
    html: "<b>reklama</b>",
    script: null,
    image_url: null,
    image_link: null,
    image_alt: null,
    width: 300,
    height: 250,
    requires_consent: false,
    targeting: {},
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function placement(id: string, config: Record<string, unknown> = {}): AdPlacementWithSlot {
  return {
    id,
    tenant_id: "t1",
    slot_id: `s-${id}`,
    position: "mid_post",
    page_type: "post",
    page_id: null,
    config,
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    slot: slot(`s-${id}`),
  };
}

// --- Harness ------------------------------------------------------------

interface HarnessProps {
  akapity?: number;
  htmlTresci?: string;
  scanKey?: string | number;
  /** Symuluje treść, która pojawia się DOPIERO po pierwszym renderze. */
  trescZamontowana?: boolean;
}

/**
 * Odwzorowuje układ z trasy `$.tsx`: `MidPostAds` stoi OBOK kontenera treści
 * i dostaje do niego `ref`. Dzięki temu ref jest wypełniony przed pierwszym
 * przebiegiem efektu - dokładnie tak, jak w produkcji przy treści renderowanej
 * synchronicznie.
 */
function Harness({ akapity = 5, htmlTresci, scanKey, trescZamontowana = true }: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div>
      {trescZamontowana &&
        (htmlTresci === undefined ? (
          <div ref={ref} data-testid="tresc">
            {Array.from({ length: akapity }, (_, i) => (
              <p key={i} data-akapit={String(i + 1)}>
                Akapit {i + 1}
              </p>
            ))}
          </div>
        ) : (
          <div ref={ref} data-testid="tresc" dangerouslySetInnerHTML={{ __html: htmlTresci }} />
        ))}
      <MidPostAds
        articleRef={ref}
        pageType="post"
        pageId="wpis-1"
        scanKey={scanKey}
        content={{ categorySlugs: ["polityka"], tagSlugs: ["ue"] }}
      />
    </div>
  );
}

const hosty = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[data-ad-mid-host]"));
const idHostow = (root: HTMLElement) => hosty(root).map((h) => h.getAttribute("data-ad-mid-host"));
/** Numer akapitu, PO którym stoi kontener (atrybut `data-akapit`). */
const poAkapicie = (host: HTMLElement) =>
  (host.previousElementSibling as HTMLElement | null)?.getAttribute("data-akapit") ?? null;

beforeEach(() => {
  placements = [];
  wywolaniaZapytania.length = 0;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// --- Ile reklam i gdzie -------------------------------------------------

describe("MidPostAds - ile wstawek trafia do treści", () => {
  it("cztery skonfigurowane wstawki dają DWA kontenery: paragraf 2 i 3, a 5 i 9 znikają bez ostrzeżenia", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    placements = [
      placement("na-9", { paragraph: 9 }),
      placement("na-2", { paragraph: 2 }),
      placement("na-5", { paragraph: 5 }),
      placement("na-3", { paragraph: 3 }),
    ];

    const { container } = render(<Harness akapity={12} />);

    expect(idHostow(container)).toEqual(["na-2", "na-3"]);
    expect(hosty(container).map(poAkapicie)).toEqual(["2", "3"]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("kreacja renderuje się PRZEZ PORTAL wewnątrz swojego kontenera, a nie obok treści", () => {
    placements = [placement("na-2", { paragraph: 2 })];

    const { container } = render(<Harness akapity={6} />);

    const host = hosty(container)[0];
    const kreacja = host.querySelector<HTMLElement>("[data-testid='reklama']");
    expect(kreacja).not.toBeNull();
    expect(kreacja?.getAttribute("data-placement-id")).toBe("na-2");
    expect(kreacja?.getAttribute("data-slot-id")).toBe("s-na-2");
    expect(host.className).toBe("my-8");
    // Poza kontenerami nie ma ani jednej kreacji.
    expect(container.querySelectorAll("[data-testid='reklama']")).toHaveLength(1);
  });

  it("reklama zaplanowana na paragraf 40 przy trzech akapitach leży POD OSTATNIM - na końcu wpisu", () => {
    placements = [placement("na-40", { paragraph: 40 })];

    const { container, getByTestId } = render(<Harness akapity={3} />);

    const host = hosty(container)[0];
    expect(poAkapicie(host)).toBe("3");
    expect(getByTestId("tresc").lastElementChild).toBe(host);
  });

  it("paragraph 0 znaczy 'po pierwszym akapicie', a nie 'nie wstawiaj'", () => {
    placements = [placement("zero", { paragraph: 0 })];

    const { container } = render(<Harness akapity={4} />);

    expect(poAkapicie(hosty(container)[0])).toBe("1");
  });

  it("brak config.paragraph wstawia po CZWARTYM akapicie - domyślna wartość mieszka w kodzie renderera", () => {
    placements = [placement("bez-konfiguracji")];

    const { container } = render(<Harness akapity={9} />);

    expect(poAkapicie(hosty(container)[0])).toBe("4");
  });

  it("nieliczbowy paragraf nie tworzy kontenera i nie zostawia śladu w konsoli", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    placements = [placement("co-drugi", { paragraph: "co drugi" })];

    const { container } = render(<Harness akapity={6} />);

    expect(hosty(container)).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='reklama']")).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("śmieciowa konfiguracja KRADNIE miejsce w limicie: z trzech kampanii widać JEDNĄ reklamę", () => {
    // `co-drugi` zostaje pierwszy po sortowaniu (komparator zwraca NaN),
    // wchodzi do limitu razem z `na-2`, a przy wstawianiu przepada.
    // `na-3` nie ma już szans - i nikt się o tym nie dowie.
    placements = [
      placement("co-drugi", { paragraph: "co drugi" }),
      placement("na-2", { paragraph: 2 }),
      placement("na-3", { paragraph: 3 }),
    ];

    const { container } = render(<Harness akapity={8} />);

    expect(idHostow(container)).toEqual(["na-2"]);
    expect(container.querySelectorAll("[data-testid='reklama']")).toHaveLength(1);
  });

  it("dwie wstawki na TEN SAM akapit leżą w DOM w kolejności ODWRÓCONEJ względem konfiguracji", () => {
    // insertBefore(host, target.nextSibling): drugi kontener wchodzi PRZED
    // pierwszym, bo `nextSibling` akapitu to już host poprzedniej wstawki.
    placements = [placement("pierwszy", { paragraph: 2 }), placement("drugi", { paragraph: 2 })];

    const { container } = render(<Harness akapity={5} />);

    expect(idHostow(container)).toEqual(["drugi", "pierwszy"]);
    expect(poAkapicie(hosty(container)[0])).toBe("2");
  });

  it("komponent pyta o pozycję mid_post i przekazuje identyfikator strony oraz kontekst treści", () => {
    placements = [placement("na-1", { paragraph: 1 })];

    render(<Harness akapity={3} />);

    expect(wywolaniaZapytania[0]).toEqual([
      "mid_post",
      "post",
      "wpis-1",
      { categorySlugs: ["polityka"], tagSlugs: ["ue"] },
    ]);
  });
});

// --- Brak wstawek -------------------------------------------------------

describe("MidPostAds - kiedy treść zostaje nietknięta", () => {
  it("zapytanie w toku (data undefined) nie dotyka treści", () => {
    placements = undefined;

    const { container, getByTestId } = render(<Harness akapity={5} />);

    expect(hosty(container)).toHaveLength(0);
    expect(getByTestId("tresc").querySelectorAll("p")).toHaveLength(5);
  });

  it("pusta lista placementów nie dotyka treści", () => {
    placements = [];

    const { container, getByTestId } = render(<Harness akapity={5} />);

    expect(hosty(container)).toHaveLength(0);
    expect(getByTestId("tresc").querySelectorAll("p")).toHaveLength(5);
  });

  it("treść bez ani jednego akapitu nie dostaje kontenera (indeks -1, nie 'ostatni element')", () => {
    placements = [placement("na-4", { paragraph: 4 })];

    const { container } = render(<Harness akapity={0} />);

    expect(hosty(container)).toHaveLength(0);
  });
});

// --- Sprzątanie ---------------------------------------------------------

describe("MidPostAds - sprzątanie kontenerów", () => {
  it("trzy przebudowy przez scanKey nie mnożą kontenerów - nadal dokładnie dwa", () => {
    placements = [placement("na-2", { paragraph: 2 }), placement("na-4", { paragraph: 4 })];

    const { container, rerender } = render(<Harness akapity={8} scanKey="pl" />);
    expect(idHostow(container)).toEqual(["na-2", "na-4"]);

    rerender(<Harness akapity={8} scanKey="en" />);
    rerender(<Harness akapity={8} scanKey="pl" />);
    rerender(<Harness akapity={8} scanKey={7} />);

    expect(idHostow(container)).toEqual(["na-2", "na-4"]);
    expect(container.querySelectorAll("[data-testid='reklama']")).toHaveLength(2);
  });

  it("host z poprzedniego renderu treści jest usuwany RAZEM z zawartością, zanim policzone zostaną akapity", () => {
    // Serwer/poprzedni przebieg zostawił w treści kontener z własnym <p>.
    // Gdyby przetrwał, byłby liczony jako akapit i przesunąłby wstawkę.
    placements = [placement("na-2", { paragraph: 2 })];
    const html =
      "<p data-akapit='1'>pierwszy</p>" +
      "<div data-ad-mid-host='stary'><p>stara kreacja</p></div>" +
      "<p data-akapit='2'>drugi</p>";

    const { container, getByTestId } = render(<Harness htmlTresci={html} />);

    expect(idHostow(container)).toEqual(["na-2"]);
    expect(getByTestId("tresc").querySelectorAll("p")).toHaveLength(2);
    expect(poAkapicie(hosty(container)[0])).toBe("2");
  });

  it("odmontowanie widoku wyjmuje kontener z drzewa treści (bez osieroconych węzłów)", () => {
    placements = [placement("na-2", { paragraph: 2 })];

    const { container, unmount } = render(<Harness akapity={5} />);
    const host = hosty(container)[0];
    expect(host.parentNode).not.toBeNull();

    unmount();

    expect(host.parentNode).toBeNull();
  });
});

// --- Defekt: treść zamontowana po pierwszym przebiegu efektu ------------

describe("MidPostAds - treść pojawiająca się po pierwszym renderze", () => {
  it.fails(
    "OCZEKIWANE: treść zamontowana po pierwszym przebiegu efektu też dostaje wstawkę mid-post; " +
      "DZIŚ: articleRef to stabilny obiekt, więc efekt się nie budzi i reklama nie wchodzi NIGDY",
    () => {
      placements = [placement("na-2", { paragraph: 2 })];

      // Pierwszy przebieg efektu: articleRef.current === null (artykuł jeszcze
      // nie zamontowany - leniwa treść, warunkowy render, hydracja).
      const { container, rerender } = render(<Harness akapity={5} trescZamontowana={false} />);
      expect(hosty(container)).toHaveLength(0);

      // Treść się pojawia i ref zostaje wypełniony, ale tablica zależności
      // [articleRef, sorted, scanKey] nie zmienia się ani o jotę.
      rerender(<Harness akapity={5} trescZamontowana={true} />);

      expect(idHostow(container)).toEqual(["na-2"]);
    },
  );

  it("jedynym ratunkiem dla spóźnionej treści jest zmiana scanKey - dopiero ona budzi efekt", () => {
    placements = [placement("na-2", { paragraph: 2 })];

    const { container, rerender } = render(
      <Harness akapity={5} trescZamontowana={false} scanKey="v1" />,
    );
    expect(hosty(container)).toHaveLength(0);

    rerender(<Harness akapity={5} trescZamontowana={true} scanKey="v1" />);
    expect(hosty(container)).toHaveLength(0);

    rerender(<Harness akapity={5} trescZamontowana={true} scanKey="v2" />);
    expect(idHostow(container)).toEqual(["na-2"]);
  });

  it("zniknięcie treści (ref znów pusty) przy zmianie scanKey zabiera kontenery", () => {
    placements = [placement("na-2", { paragraph: 2 })];

    const { container, rerender } = render(<Harness akapity={5} scanKey="v1" />);
    expect(idHostow(container)).toEqual(["na-2"]);

    rerender(<Harness akapity={5} trescZamontowana={false} scanKey="v2" />);

    expect(hosty(container)).toHaveLength(0);
    expect(container.querySelectorAll("[data-testid='reklama']")).toHaveLength(0);
  });
});
