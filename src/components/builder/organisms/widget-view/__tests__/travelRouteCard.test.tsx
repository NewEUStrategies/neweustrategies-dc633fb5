// Widget „Karta trasy" - odwzorowanie wzorca + wymagania platformy.
//
// Cztery klasy defektu, które ten plik zamyka:
//
//  1. ODWZOROWANIE ROZJEŻDŻAJĄCE SIĘ Z WZORCEM. Siatka 2/3 + 1/3, nakładka nad
//     zdjęciem, „pigułka" polubienia ze skracanym licznikiem i wielka liczba
//     dystansu to sedno wklejonej karty. Świadome odstępstwa (6 px zamiast
//     16 px, kolor marki zamiast niebieskiego, rozmiar liczby z panelu) też są
//     przypięte - „poprawka" w dowolną stronę psuje ustalenie.
//  2. I18N BEZ OSTATNIEGO OGNIWA. Treść wpisana wyłącznie po angielsku musi być
//     widoczna w podglądzie PL (`pickI18n`: język -> PL -> EN), a napisy dla
//     czytnika ekranu muszą iść za językiem widoku, nie za językiem treści.
//  3. USTAWIENIE, KTÓRE NIC NIE ROBI. Każde pole panelu ma tu asercję na realny
//     DOM - bramka wierności widzi sam ODCZYT klucza, nie jego skutek.
//  4. TREŚĆ PRZYKŁADOWA W PRODUKCJI. Pusta karta rysuje samą płaszczyznę:
//     żadnego „12K", „By Pak Eko" ani innej zmyślonej trasy.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { WidgetContent } from "@/lib/builder/types";
import { travelRouteLikeKey } from "@/lib/builder/travelRouteCard";
import { TravelRouteCardView } from "../TravelRouteCardView";

const NODE_ID = "trc-1";

const BASE: WidgetContent = {
  title_pl: "Trasa po mieście z widokami",
  title_en: "In-town route with a view",
  author_pl: "Autor: Paweł",
  author_en: "By Paul",
  distance: "12K",
  distanceCaption_pl: "km",
  distanceCaption_en: "km",
  image: "https://images.example.org/mapa.jpg",
  likes: 1527,
  showLikes: true,
};

function draw(content: WidgetContent, lang: "pl" | "en" = "pl", editable = false) {
  return render(
    <TravelRouteCardView c={content} lang={lang} nodeId={NODE_ID} editable={editable} />,
  );
}

const card = (root: HTMLElement): HTMLElement => {
  const el = root.querySelector<HTMLElement>("[data-travel-route-card]");
  if (!el) throw new Error("nie znaleziono karty trasy");
  return el;
};

const likeButton = (): HTMLElement => screen.getByRole("button");

/** Nakładka niesie kolor i krycie jako własności niestandardowe. */
const overlayVar = (name: string): string => {
  const el = document.querySelector<HTMLElement>(".trc-overlay");
  if (!el) throw new Error("nie znaleziono nakładki");
  return el.style.getPropertyValue(name).trim();
};

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(cleanup);

describe("treść i i18n", () => {
  it("rysuje tytuł, autora, dystans i podpis w języku widoku (PL)", () => {
    draw(BASE, "pl");
    expect(screen.getByRole("heading", { name: "Trasa po mieście z widokami" })).toBeTruthy();
    expect(screen.getByText("Autor: Paweł")).toBeTruthy();
    expect(screen.getByText("12K")).toBeTruthy();
    expect(screen.getByText("km")).toBeTruthy();
  });

  it("widok EN bierze swoją treść, nie polską", () => {
    draw(BASE, "en");
    expect(screen.getByRole("heading", { name: "In-town route with a view" })).toBeTruthy();
    expect(screen.getByText("By Paul")).toBeTruthy();
  });

  it("widok PL bierze treść EN, gdy PL nie istnieje (pełny łańcuch fallbacków)", () => {
    draw({ title_en: "English only route", author_en: "By Paul", distance: "9K" }, "pl");
    expect(screen.getByRole("heading", { name: "English only route" })).toBeTruthy();
    expect(screen.getByText("By Paul")).toBeTruthy();
  });

  it("etykiety dla czytnika ekranu idą za językiem widoku", () => {
    const { unmount } = draw(BASE, "pl");
    expect(likeButton().getAttribute("aria-label")).toBe("Polub trasę, polubienia: 1527");
    expect(screen.getByText("Dystans: 12K km")).toBeTruthy();
    unmount();

    draw(BASE, "en");
    expect(likeButton().getAttribute("aria-label")).toBe("Like this route, likes: 1527");
    expect(screen.getByText("Distance: 12K km")).toBeTruthy();
  });

  it("pusta karta nie pokazuje ŻADNEJ treści przykładowej", () => {
    const { container } = draw({});
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelector("p")).toBeNull();
    expect(container.textContent).not.toContain("12K");
    // Sama płaszczyzna z nakładką nadal się rysuje - karta istnieje.
    expect(card(container)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("polubienia (odwzorowanie wzorca)", () => {
  it("skraca licznik i przełącza stan w obie strony", () => {
    draw(BASE);
    expect(screen.getByText("1.5K")).toBeTruthy();

    fireEvent.click(likeButton());
    expect(likeButton().getAttribute("aria-pressed")).toBe("true");
    expect(likeButton().className).toContain("trc-pill-liked");
    expect(likeButton().getAttribute("aria-label")).toBe(
      "Cofnij polubienie trasy, polubienia: 1528",
    );

    fireEvent.click(likeButton());
    expect(likeButton().getAttribute("aria-pressed")).toBe("false");
    expect(likeButton().getAttribute("aria-label")).toBe("Polub trasę, polubienia: 1527");
  });

  it("serce wypełnia się dopiero po polubieniu", () => {
    const { container } = draw(BASE);
    const heart = () => container.querySelector<SVGElement>("svg");
    expect(heart()?.style.fill).toBe("transparent");
    fireEvent.click(likeButton());
    expect(heart()?.style.fill?.toLowerCase()).toBe("currentcolor");
  });

  it("polubienie przeżywa przeładowanie strony (pamięć przeglądarki)", () => {
    const { unmount } = draw(BASE);
    fireEvent.click(likeButton());
    expect(window.localStorage.getItem(travelRouteLikeKey(NODE_ID))).toBe("1");
    unmount();

    draw(BASE);
    expect(likeButton().getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1.5K")).toBeTruthy();
  });

  it("kanwa buildera NIE zapisuje polubienia redaktora", () => {
    draw(BASE, "pl", true);
    fireEvent.click(likeButton());
    expect(likeButton().getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(travelRouteLikeKey(NODE_ID))).toBeNull();
  });

  it("wyłączenie polubień usuwa cały przycisk", () => {
    draw({ ...BASE, showLikes: false });
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ujemna liczba startowa nie wycieka do licznika", () => {
    draw({ ...BASE, likes: -5 });
    expect(screen.getByText("0")).toBeTruthy();
  });
});

describe("ustawienia panelu mają skutek w DOM", () => {
  it("nakładka używa koloru i krycia z panelu, a domyślnie koloru marki", () => {
    const { unmount } = draw(BASE);
    expect(overlayVar("--trc-overlay-color")).toBe("var(--brand)");
    expect(overlayVar("--trc-overlay-alpha")).toBe("60%");
    unmount();

    draw({ ...BASE, overlayColor: "#123456", overlayAlpha: 0.25 });
    expect(overlayVar("--trc-overlay-color")).toBe("#123456");
    expect(overlayVar("--trc-overlay-alpha")).toBe("25%");
  });

  it("odrzuca kolor, którego nie da się bezpiecznie wstawić do CSS", () => {
    draw({ ...BASE, overlayColor: "red; background:url(javascript:1)" });
    expect(overlayVar("--trc-overlay-color")).toBe("var(--brand)");
  });

  it("kolor polubionej pigułki też przechodzi przez whitelistę", () => {
    const { unmount } = draw({ ...BASE, likeAccentColor: "#00ff00" });
    expect(likeButton().style.getPropertyValue("--trc-like-color")).toBe("#00ff00");
    unmount();

    draw({ ...BASE, likeAccentColor: "url(javascript:1)" });
    expect(likeButton().style.getPropertyValue("--trc-like-color")).toBe("#ef4444");
  });

  it("wysokość, zaokrąglenie i maksymalna szerokość jadą z panelu", () => {
    const { container } = draw({ ...BASE, minHeight: 320, radius: 16, maxWidth: 640 });
    const style = card(container).style;
    expect(style.minHeight).toBe("320px");
    expect(style.borderRadius).toBe("16px");
    expect(style.maxWidth).toBe("640px");
  });

  it("domyślne zaokrąglenie to platformowe 6 px, nie 16 px ze wzorca", () => {
    const { container } = draw(BASE);
    expect(card(container).style.borderRadius).toBe("6px");
  });

  it("zero w maksymalnej szerokości znaczy pełną szerokość kolumny", () => {
    const { container } = draw({ ...BASE, maxWidth: 0 });
    expect(card(container).style.maxWidth).toBe("");
  });

  it("rozmiar liczby dystansu jest ustawieniem, nie stałą", () => {
    const { container } = draw({ ...BASE, distanceSizePx: 48 });
    expect(screen.getByText("12K").style.fontSize).toBe("48px");
    expect(container).toBeTruthy();
  });

  it("wyłączone animacje zdejmują klasy ruchu", () => {
    const { container, unmount } = draw(BASE);
    expect(card(container).className).toContain("trc-rise");
    expect(card(container).className).toContain("trc-lift");
    unmount();

    const off = draw({ ...BASE, animate: false, hoverLift: false });
    expect(card(off.container).className).not.toContain("trc-rise");
    expect(card(off.container).className).not.toContain("trc-lift");
  });
});

describe("obraz, odnośnik i dostępność", () => {
  it("mapa bez własnego opisu jest dekoracją", () => {
    const { container } = draw(BASE);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://images.example.org/mapa.jpg");
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.closest("[aria-hidden='true']")).toBeTruthy();
  });

  it("opis wpisany przez redakcję trafia do atrybutu alt i zdejmuje aria-hidden", () => {
    const { container } = draw({ ...BASE, imageAlt_pl: "Mapa pętli wokół Starego Miasta" });
    const img = container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe("Mapa pętli wokół Starego Miasta");
    expect(img?.closest("[aria-hidden='true']")).toBeNull();
  });

  it("adres obrazka spoza dozwolonych schematów nie trafia do DOM", () => {
    const { container } = draw({ ...BASE, image: "javascript:alert(1)" });
    expect(container.querySelector("img")).toBeNull();
  });

  it("karta bez adresu nie jest linkiem", () => {
    const { container } = draw(BASE);
    expect(container.querySelector("a")).toBeNull();
  });

  it("karta z adresem dostaje kotwicę nazwaną tytułem, a przycisk zostaje klikalny", () => {
    const { container } = draw({ ...BASE, href: "https://example.org/trasa" });
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.org/trasa");
    expect(link?.getAttribute("aria-label")).toBe("Trasa po mieście z widokami");
    expect(likeButton().className).toContain("pointer-events-auto");

    fireEvent.click(likeButton());
    expect(likeButton().getAttribute("aria-pressed")).toBe("true");
  });

  it("adres `javascript:` nie zamienia karty w link", () => {
    const { container } = draw({ ...BASE, href: "javascript:alert(1)" });
    expect(container.querySelector("a")).toBeNull();
  });
});

describe("typografia widgetu steruje kartą", () => {
  it("tytuł i autor niosą platformowe haki rozmiaru", () => {
    const { container } = draw(BASE);
    expect(container.querySelector("h3")?.className).toContain("cms-post-title");
    expect(container.querySelector("p")?.className).toContain("cms-post-excerpt");
  });

  it("liczba dystansu i pigułka polubienia są z niej wyłączone", () => {
    const { container } = draw(BASE);
    expect(screen.getByText("12K").hasAttribute("data-typography-exempt")).toBe(true);
    expect(likeButton().hasAttribute("data-typography-exempt")).toBe(true);
    expect(container.querySelector("h1")).toBeNull();
  });
});
