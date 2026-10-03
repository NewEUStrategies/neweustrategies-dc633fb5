// Molekuła `TravelRouteCard` - karta trasy z polubieniem pamiętanym
// w przeglądarce odwiedzającego. Sklejenie z treścią widgetu i i18n ma
// osobny plik (`widget-view/__tests__/travelRouteCard.test.tsx`); tu stoi
// sama molekuła: pamięć, dostępność i ustawienia geometrii.
//
// CO TEN PLIK DOWODZI.
//   1. POLUBIENIE PRZEŻYWA PRZEŁADOWANIE i jest odczytywane DOPIERO PO
//      zamontowaniu (pierwszy render = HTML serwera), a niedostępny
//      `localStorage` (tryb prywatny, zablokowane dane) degraduje do stanu
//      w pamięci, nie do wyjątku.
//   2. TA SAMA TRASA W INNEJ KARCIE PRZEGLĄDARKI idzie za zmianą (zdarzenie
//      `storage`, także wyczyszczenie całej pamięci witryny).
//   3. CZYTNIK EKRANU słyszy przycisk przełącznika z pełną liczbą polubień
//      i dystans raz, w całości; mapa bez opisu jest dekoracją.
//   4. Każde ustawienie geometrii ma przycięcie, które widać w DOM.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TravelRouteCard,
  type TravelRouteCardLabels,
  type TravelRouteCardProps,
} from "@/components/ui/travel-route-card";

const LABELS: TravelRouteCardLabels = {
  like: "Polub trasę",
  unlike: "Cofnij polubienie",
  likesCount: "{{n}} polubień",
  distance: "Dystans: {{v}}",
  mapAlt: "Mapa trasy",
};

const KLUCZ = "nes:trc:like:test";

function karta(props: Partial<TravelRouteCardProps> = {}) {
  return render(
    <TravelRouteCard
      title="Pętla nad Wisłą"
      author="Anna"
      distance="12K"
      distanceCaption="km"
      initialLikes={1527}
      labels={LABELS}
      {...props}
    />,
  );
}

const ramka = (c: HTMLElement) =>
  c.querySelector<HTMLElement>("[data-travel-route-card]") as HTMLElement;
const polub = () => screen.getByRole("button");

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TravelRouteCard - polubienie", () => {
  it("przycisk jest przełącznikiem z pełną liczbą polubień w nazwie", () => {
    karta();
    expect(polub()).toHaveAttribute("aria-pressed", "false");
    expect(polub()).toHaveAccessibleName("Polub trasę, 1527 polubień");
    expect(polub().textContent).toBe("1.5K");
    fireEvent.click(polub());
    expect(polub()).toHaveAttribute("aria-pressed", "true");
    expect(polub()).toHaveAccessibleName("Cofnij polubienie, 1528 polubień");
    expect(polub().dataset.liked).toBe("true");
    expect(polub().className).toContain("trc-pill-liked");
    expect(polub().querySelector("svg")?.getAttribute("class")).toContain("trc-pop");
  });

  it("zapisuje polubienie w przeglądarce i usuwa je po cofnięciu", () => {
    karta({ storageKey: KLUCZ });
    fireEvent.click(polub());
    expect(window.localStorage.getItem(KLUCZ)).toBe("1");
    fireEvent.click(polub());
    expect(window.localStorage.getItem(KLUCZ)).toBeNull();
  });

  it("polubienie z poprzedniej wizyty wraca po zamontowaniu, ale nie w HTML-u serwera", () => {
    window.localStorage.setItem(KLUCZ, "1");
    const html = renderToString(
      <TravelRouteCard
        title="T"
        author=""
        distance=""
        initialLikes={3}
        labels={LABELS}
        storageKey={KLUCZ}
      />,
    );
    expect(html).toContain('aria-pressed="false"');
    karta({ storageKey: KLUCZ, initialLikes: 3 });
    expect(polub()).toHaveAttribute("aria-pressed", "true");
    expect(polub().textContent).toBe("4");
  });

  it("bez klucza pamięci (kanwa buildera) nie dotyka `localStorage`", () => {
    const set = vi.spyOn(window.localStorage, "setItem");
    const get = vi.spyOn(window.localStorage, "getItem");
    karta({ storageKey: null });
    fireEvent.click(polub());
    expect(polub()).toHaveAttribute("aria-pressed", "true");
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    // Kontrola sondy: z kluczem ten sam szpieg widzi odczyt.
    karta({ storageKey: KLUCZ });
    expect(get).toHaveBeenCalledWith(KLUCZ);
    for (const szpieg of [get, set]) szpieg.mockRestore();
  });

  it("niedostępna pamięć przeglądarki nie wywraca karty, polubienie żyje w pamięci", () => {
    const get = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("zablokowane", "SecurityError");
    });
    const set = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("pełne", "QuotaExceededError");
    });
    const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("zablokowane", "SecurityError");
    });
    karta({ storageKey: KLUCZ });
    expect(get).toHaveBeenCalledWith(KLUCZ);
    expect(polub()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(polub());
    expect(polub()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(polub());
    expect(polub()).toHaveAttribute("aria-pressed", "false");
    expect(set).toHaveBeenCalledWith(KLUCZ, "1");
    expect(remove).toHaveBeenCalledWith(KLUCZ);
    // Szpiegi na instancji `localStorage` happy-dom nie wracają przez
    // `restoreAllMocks` - zdejmujemy je jawnie, żeby nie rzucały w kolejnym teście.
    for (const szpieg of [get, set, remove]) szpieg.mockRestore();
  });

  it("polubienie z innej karty przeglądarki dociera bez przeładowania", () => {
    karta({ storageKey: KLUCZ });
    window.localStorage.setItem(KLUCZ, "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KLUCZ, newValue: "1" }));
    });
    expect(polub()).toHaveAttribute("aria-pressed", "true");
    window.localStorage.setItem("inny-klucz", "1");
    window.localStorage.removeItem(KLUCZ);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "inny-klucz", newValue: "1" }));
    });
    expect(polub()).toHaveAttribute("aria-pressed", "true");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(polub()).toHaveAttribute("aria-pressed", "false");
  });

  it("odmontowana karta przestaje słuchać zdarzeń pamięci", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = karta({ storageKey: KLUCZ });
    unmount();
    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it("licznik ignoruje ujemną, ułamkową i nieskończoną bazę", () => {
    const { rerender } = karta({ initialLikes: -5 });
    expect(polub().textContent).toBe("0");
    rerender(<TravelRouteCard title="" author="" distance="" initialLikes={7.9} labels={LABELS} />);
    expect(polub().textContent).toBe("7");
    rerender(
      <TravelRouteCard title="" author="" distance="" initialLikes={Infinity} labels={LABELS} />,
    );
    expect(polub().textContent).toBe("0");
  });

  it("kolor pigułki po polubieniu: z panelu albo czerwień wzorca", () => {
    const { rerender } = karta();
    expect(polub().style.getPropertyValue("--trc-like-color")).toBe("#ef4444");
    rerender(
      <TravelRouteCard
        title=""
        author=""
        distance=""
        initialLikes={0}
        labels={LABELS}
        likeAccentColor="#22c55e"
      />,
    );
    expect(polub().style.getPropertyValue("--trc-like-color")).toBe("#22c55e");
  });

  it("licznik można wyłączyć", () => {
    karta({ showLikes: false });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TravelRouteCard - treść i dostępność", () => {
  it("tytuł, autor i dystans; dystans dla czytnika ekranu jeden raz, z jednostką", () => {
    const { container } = karta();
    expect(screen.getByRole("heading", { level: 3, name: "Pętla nad Wisłą" })).toBeTruthy();
    expect(screen.getByText("Anna")).toBeTruthy();
    expect(screen.getByText("Dystans: 12K km").className).toBe("sr-only");
    const widoczny = container.querySelector('[aria-hidden="true"].flex-col') as HTMLElement;
    expect(widoczny.textContent).toBe("12Kkm");
  });

  it("bez jednostki dystans jest czytany sam, a bez dystansu kolumny nie ma", () => {
    const { rerender } = karta({ distanceCaption: "" });
    expect(screen.getByText("Dystans: 12K")).toBeTruthy();
    rerender(<TravelRouteCard title="T" author="" distance="" initialLikes={0} labels={LABELS} />);
    expect(screen.queryByText(/Dystans/)).toBeNull();
  });

  it("brak tytułu i autora nie zostawia pustych węzłów", () => {
    karta({ title: "", author: "" });
    expect(screen.queryByRole("heading")).toBeNull();
    expect(document.querySelector(".cms-post-excerpt")).toBeNull();
  });

  it("mapa bez opisu jest dekoracją, z opisem jest obrazem", () => {
    const { container, rerender } = karta({ imageUrl: "/mapy/wisla.jpg" });
    const tlo = container.querySelector(".absolute.inset-0.z-0") as HTMLElement;
    expect(tlo).toHaveAttribute("aria-hidden", "true");
    rerender(
      <TravelRouteCard
        title="T"
        author=""
        distance=""
        initialLikes={0}
        labels={LABELS}
        imageUrl="/mapy/wisla.jpg"
        imageAlt="Mapa pętli"
      />,
    );
    expect(tlo).not.toHaveAttribute("aria-hidden");
    expect(screen.getByRole("img", { name: "Mapa pętli" })).toHaveAttribute("loading", "lazy");
  });

  it("bez zdjęcia tło jest płaszczyzną motywu", () => {
    const { container } = karta();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".bg-muted")).not.toBeNull();
  });

  it("karta-link ma nazwę z tytułu albo z etykiety mapy, a polubienie nie nawiguje", () => {
    const { container, rerender } = karta({ href: "/trasy/wisla" });
    expect(screen.getByRole("link", { name: "Pętla nad Wisłą" })).toHaveAttribute(
      "href",
      "/trasy/wisla",
    );
    expect(container.querySelector(".z-20")?.className).toContain("pointer-events-none");
    expect(polub().className).toContain("pointer-events-auto");
    rerender(
      <TravelRouteCard
        title=""
        author=""
        distance=""
        initialLikes={0}
        labels={LABELS}
        href="/trasy/wisla"
      />,
    );
    expect(screen.getByRole("link", { name: "Mapa trasy" })).toBeTruthy();
  });

  it("bez adresu karta nie jest linkiem", () => {
    const { container } = karta();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector(".z-20")?.className).not.toContain("pointer-events-none");
  });
});

describe("TravelRouteCard - geometria i ruch", () => {
  it("domyślnie: 6 px zaokrąglenia, 448 px szerokości, nakładka marki 60%, wejście i uniesienie", () => {
    const { container } = karta();
    const r = ramka(container);
    expect(r.style.borderRadius).toBe("6px");
    expect(r.style.maxWidth).toBe("448px");
    expect(r.style.minHeight).toBe("224px");
    expect(r.className).toContain("trc-rise");
    expect(r.className).toContain("trc-lift");
    const nakladka = container.querySelector(".trc-overlay") as HTMLElement;
    expect(nakladka.style.getPropertyValue("--trc-overlay-color")).toBe("var(--brand)");
    expect(nakladka.style.getPropertyValue("--trc-overlay-alpha")).toBe("60%");
  });

  it("przycina ustawienia spoza zakresu", () => {
    const { container } = karta({
      minHeight: 10,
      radius: -4,
      maxWidth: 0,
      overlayAlpha: 3,
      overlayColor: "#123456",
      distanceSizePx: 2,
      animate: false,
      hoverLift: false,
      className: "moja-karta",
    });
    const r = ramka(container);
    expect(r.style.minHeight).toBe("120px");
    expect(r.style.borderRadius).toBe("0px");
    expect(r.style.maxWidth).toBe("");
    expect(r.className).not.toContain("trc-rise");
    expect(r.className).not.toContain("trc-lift");
    expect(r.className).toContain("moja-karta");
    const nakladka = container.querySelector(".trc-overlay") as HTMLElement;
    expect(nakladka.style.getPropertyValue("--trc-overlay-color")).toBe("#123456");
    expect(nakladka.style.getPropertyValue("--trc-overlay-alpha")).toBe("100%");
    expect(screen.getByText("12K").style.fontSize).toBe("12px");
  });

  it("ujemne krycie nakładki to zero", () => {
    const { container } = karta({ overlayAlpha: -1 });
    const nakladka = container.querySelector(".trc-overlay") as HTMLElement;
    expect(nakladka.style.getPropertyValue("--trc-overlay-alpha")).toBe("0%");
  });
});
