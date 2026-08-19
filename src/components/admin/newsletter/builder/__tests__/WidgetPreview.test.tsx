// Podgląd widgetu w kanwie buildera - JEDEN test na typ widgetu.
//
// PO CO OSOBNY TEST NA KAŻDY TYP. Podgląd jest tym, na co operator patrzy,
// układając formularz albo popup. Typ, który renderuje się jako `null`, nie
// wywala aplikacji - po prostu ZNIKA z kanwy. Operator dodaje pole zgody,
// nie widzi go, dodaje drugie, i kończy z dokumentem, w którym jest dwa razy
// to samo pole - albo rezygnuje, uznając, że builder nie umie tego widgetu.
//
// Dlatego test przechodzi po CAŁYM rejestrze i wymaga, żeby każdy typ z
// biblioteki coś wyrenderował. Osobne przypadki dopinają to, co w podglądzie
// niesie znaczenie: sanityzację HTML, oznaczenie pola wymaganego i etykiety
// w obu językach.
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WidgetPreview } from "@/components/admin/newsletter/builder/WidgetPreview";
import { makeWidget } from "@/lib/newsletter-builder/defaults";
import { WIDGET_REGISTRY } from "@/lib/newsletter-builder/registry";
import type { NlWidget } from "@/lib/newsletter-builder/types";

/** Renderuje podgląd i oddaje kontener. */
function show(widget: NlWidget | null, lang: "pl" | "en" = "pl") {
  return render(<WidgetPreview widget={widget} lang={lang} />);
}

afterEach(() => {
  cleanup();
});

describe("kontrakt z rejestrem", () => {
  it("KAŻDY typ z biblioteki coś renderuje - żaden nie znika z kanwy", () => {
    const puste: string[] = [];

    for (const item of WIDGET_REGISTRY) {
      const { container, unmount } = show(makeWidget(item.type));
      if (container.innerHTML.trim() === "") puste.push(item.type);
      unmount();
    }

    expect(puste).toEqual([]);
    expect(WIDGET_REGISTRY.length).toBeGreaterThan(10);
  });

  it("każdy typ renderuje się też w wersji angielskiej", () => {
    const puste: string[] = [];
    const zPolskim: string[] = [];

    for (const item of WIDGET_REGISTRY) {
      const { container, unmount } = show(makeWidget(item.type), "en");
      if (container.innerHTML.trim() === "") puste.push(item.type);
      // Podgląd angielski nie może pokazywać polskich domyślnych etykiet.
      if (/Wybierz|Dolacz|Zamknij|Twoj kod/.test(container.textContent ?? ""))
        zPolskim.push(item.type);
      unmount();
    }

    expect(puste).toEqual([]);
    expect(zPolskim).toEqual([]);
  });

  it("brak widgetu nie renderuje niczego, zamiast wywalać kanwę", () => {
    const { container } = show(null);

    expect(container.innerHTML).toBe("");
    expect(container.childElementCount).toBe(0);
  });

  it("typ nieznany podglądowi renderuje pustkę, a nie wyjątek", () => {
    const { container } = show({ id: "x", type: "nie-ma-takiego" } as unknown as NlWidget);

    expect(container.innerHTML).toBe("");
    expect(container.textContent).toBe("");
  });
});

describe("nagłówek", () => {
  it("poziom nagłówka steruje znacznikiem HTML", () => {
    const widget = { ...makeWidget("heading"), level: 2, text: { pl: "Tytuł", en: "Title" } };
    show(widget as NlWidget);

    const heading = screen.getByText("Tytuł");
    expect(heading.tagName).toBe("H2");
    // Poziom 2 to NIE H1 - hierarchia w mailu ma znaczenie dla czytników.
    expect(document.querySelector("h1")).toBeNull();
  });

  it("pusty tekst pokazuje kreskę - element nie znika bez śladu", () => {
    const widget = { ...makeWidget("heading"), text: { pl: "", en: "" } };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("-")).toBeTruthy();
    expect(container.querySelector("h1,h2,h3")?.textContent).toBe("-");
  });

  it("wyrównanie i kolor trafiają do stylu", () => {
    const widget = {
      ...makeWidget("heading"),
      text: { pl: "Tytuł", en: "Title" },
      align: "center",
      color: "#ff0000",
    };
    show(widget as NlWidget);

    const heading = screen.getByText("Tytuł");
    expect(heading.style.textAlign).toBe("center");
    expect(heading.style.color).toBeTruthy();
  });

  it("język przełącza treść nagłówka", () => {
    const widget = { ...makeWidget("heading"), text: { pl: "Tytuł", en: "Title" } };
    const { unmount } = show(widget as NlWidget, "pl");
    expect(screen.getByText("Tytuł")).toBeTruthy();
    expect(screen.queryByText("Title")).toBeNull();
    unmount();

    show(widget as NlWidget, "en");
    expect(screen.getByText("Title")).toBeTruthy();
    expect(screen.queryByText("Tytuł")).toBeNull();
  });
});

describe("akapit", () => {
  it("treść HTML jest SANITYZOWANA - podgląd nie wykonuje skryptu", () => {
    const widget = {
      ...makeWidget("paragraph"),
      html: {
        pl: '<a href="https://example.test">link</a><script>alert(1)</script>',
        en: "x",
      },
    };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("link")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });

  it("rozmiar tekstu idzie za ustawieniem", () => {
    const small = { ...makeWidget("paragraph"), size: "sm", html: { pl: "mały", en: "small" } };
    const { container } = show(small as NlWidget);

    expect(container.querySelector("p")?.className).toContain("text-xs");
    expect(container.querySelector("p")?.textContent).toBe("mały");
  });
});

describe("obraz", () => {
  it("z adresem renderuje obraz z tekstem alternatywnym", () => {
    const widget = {
      ...makeWidget("image"),
      url: "https://example.test/a.png",
      alt: "Opis obrazu",
    };
    show(widget as NlWidget);

    const img = screen.getByAltText("Opis obrazu") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://example.test/a.png");
    expect(img.getAttribute("alt")).toBe("Opis obrazu");
  });

  it("BEZ adresu pokazuje zastępczy placeholder, nie pustą dziurę", () => {
    const widget = { ...makeWidget("image"), url: "" };
    const { container } = show(widget as NlWidget);

    expect(container.querySelector("img")).toBeNull();
    // Placeholder musi być WIDOCZNYM prostokątem, nie pustym div-em bez wymiaru.
    expect(container.firstElementChild?.className).toContain("border-dashed");
    expect(container.textContent?.trim()).not.toBe("");
  });
});

describe("separator i odstęp", () => {
  it("separator respektuje grubość", () => {
    const widget = { ...makeWidget("divider"), thickness: 3 };
    const { container } = show(widget as NlWidget);

    const hr = container.querySelector("hr");
    expect(hr).toBeTruthy();
    expect(hr?.style.borderTopWidth).toBe("3px");
  });

  it("odstęp ma wysokość i jest UKRYTY dla czytnika ekranu", () => {
    const widget = { ...makeWidget("spacer"), size: 40 };
    const { container } = show(widget as NlWidget);

    const spacer = container.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(spacer).toBeTruthy();
    expect(spacer.style.height).toBe("40px");
  });
});

describe("pola formularza", () => {
  it("pole e-mail jest oznaczone jako WYMAGANE", () => {
    const { container } = show(makeWidget("field.email"));

    // Gwiazdka to jedyny sygnał wymagalności w podglądzie.
    expect(screen.getByText("*")).toBeTruthy();
    expect(container.querySelector("input")?.getAttribute("type")).toBe("email");
  });

  it("pole tekstowe pokazuje swoją etykietę", () => {
    const widget = { ...makeWidget("field.text"), label: { pl: "Imię", en: "First name" } };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText(/Imię/)).toBeTruthy();
    // Pole nieobowiązkowe nie dostaje gwiazdki.
    expect(container.textContent).not.toContain("*");
  });

  it("checkbox zgody renderuje swoją treść jako HTML", () => {
    const widget = {
      ...makeWidget("field.checkbox"),
      html: { pl: "<span>Zgoda marketingowa</span>", en: "<span>Consent</span>" },
    };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("Zgoda marketingowa")).toBeTruthy();
    // Treść zgody idzie przez sanityzację - znacznik ma zostać, skryptu nie ma.
    expect(container.querySelector("span")).toBeTruthy();
  });

  it("lista wyboru pokazuje etykietę, podpowiedź i WSZYSTKIE opcje", () => {
    const { container } = show(makeWidget("field.select"));

    expect(screen.getByText("Wybierz")).toBeTruthy();
    const opcje = [...container.querySelectorAll("option")].map((o) => o.textContent);
    expect(opcje).toEqual(["Wybierz opcje...", "Opcja 1", "Opcja 2"]);
    // Podgląd nie może być klikalny - to atrapa, nie działający formularz.
    expect(container.querySelector("select")?.hasAttribute("disabled")).toBe(true);
  });

  it("wybór list mailingowych mówi, SKĄD wezmą się listy i jak je pokaże", () => {
    const { container } = show(makeWidget("field.mailing-lists"));

    expect(screen.getByText("Interesuja mnie tematy")).toBeTruthy();
    // Domyślnie checkboxy - operator musi to widzieć bez wchodzenia w ustawienia.
    expect(container.textContent).toContain("(checkboxes)");
    expect(container.textContent).toContain("Listy z ustawien newslettera");
  });

  it("wybór list w trybie listy rozwijanej mówi to wprost", () => {
    const widget = { ...makeWidget("field.mailing-lists"), display: "select" };
    const { container } = show(widget as NlWidget);

    expect(container.textContent).toContain("(dropdown)");
    expect(container.textContent).not.toContain("(checkboxes)");
  });
});

describe("akcje", () => {
  it("przycisk wysyłki pokazuje swoją etykietę", () => {
    const widget = { ...makeWidget("submit"), label: { pl: "Zapisz się", en: "Subscribe" } };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("Zapisz się")).toBeTruthy();
    expect(container.querySelector("button")).toBeTruthy();
  });

  it("komunikat sukcesu pokazuje swoją treść", () => {
    const widget = { ...makeWidget("success-message"), text: { pl: "Gotowe", en: "Done" } };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("Gotowe")).toBeTruthy();
    // Komunikat sukcesu jest zielony - inaczej wygląda jak zwykły akapit.
    expect(container.firstElementChild?.className).toContain("emerald");
  });

  it("przycisk CTA pokazuje etykietę i domyślnie jest wyśrodkowany", () => {
    const { container } = show(makeWidget("cta-button"));

    expect(screen.getByText("Dowiedz sie wiecej")).toBeTruthy();
    expect(container.firstElementChild?.className).toContain("justify-center");
  });

  it("CTA na pełną szerokość dostaje klasę pełnej szerokości", () => {
    const widget = { ...makeWidget("cta-button"), fullWidth: true, align: "left" };
    const { container } = show(widget as NlWidget);

    expect(container.querySelector("span")?.className).toContain("w-full");
    expect(container.firstElementChild?.className).toContain("justify-start");
  });

  it("CTA BEZ etykiety pokazuje kreskę, a nie puste pudełko", () => {
    const widget = { ...makeWidget("cta-button"), label: { pl: "", en: "" } };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("-")).toBeTruthy();
    expect(container.querySelector("span")?.textContent).toBe("-");
  });
});

describe("widgety popupowe", () => {
  it("przycisk zamknięcia ma etykietę dla czytnika ekranu", () => {
    show(makeWidget("close-button"));

    const btn = screen.getByLabelText("Zamknij popup");
    expect(btn.getAttribute("aria-label")).toBe("Zamknij popup");
    // W kanwie to CELOWO atrapa (span), nie przycisk - podgląd jest nieklikalny.
    // Prawdziwe zamknięcie w PopupHost i SignupPopupPanel to <button>, co
    // sprawdzają ich własne testy.
    expect(btn.tagName).toBe("SPAN");
  });

  it("etykieta zamknięcia jest tłumaczona", () => {
    show(makeWidget("close-button"), "en");

    expect(screen.getByLabelText("Close popup")).toBeTruthy();
    expect(screen.queryByLabelText("Zamknij popup")).toBeNull();
  });

  it("wariant ikonowy pokazuje glif, nie tekst", () => {
    const widget = { ...makeWidget("close-button"), variant: "icon-x", label: { pl: "Nie teraz", en: "Not now" } };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("✕")).toBeTruthy();
    // Wariant ikonowy nie pokazuje etykiety tekstowej obok glifu.
    expect(container.textContent).not.toContain("Nie teraz");
  });

  it("wariant tekstowy pokazuje etykietę", () => {
    const widget = {
      ...makeWidget("close-button"),
      variant: "text",
      label: { pl: "Nie teraz", en: "Not now" },
    };
    const { container } = show(widget as NlWidget);

    expect(screen.getByText("Nie teraz")).toBeTruthy();
    expect(container.textContent).not.toContain("✕");
  });

  it("pozycja w narożniku zmienia wyrównanie", () => {
    const corner = { ...makeWidget("close-button"), position: "top-right" };
    const { container } = show(corner as NlWidget);

    expect(container.firstElementChild?.className).toContain("justify-end");
    expect(container.firstElementChild?.className).not.toContain("justify-start");
  });

  it("licznik czasu pokazuje CZTERY pola z jednostkami, dwucyfrowo", () => {
    const { container } = show(makeWidget("countdown"));

    // Domyślny termin to 7 dni od teraz, więc pole dni ma pokazać 06 albo 07.
    const jednostki = [...container.querySelectorAll(".uppercase")].map((n) => n.textContent);
    expect(jednostki).toEqual(["dni", "godz.", "min", "sek"]);
    const liczby = [...container.querySelectorAll(".font-bold")].map((n) => n.textContent ?? "");
    expect(liczby).toHaveLength(4);
    expect(liczby.every((n) => /^\d{2}$/.test(n))).toBe(true);
  });

  it("jednostki licznika są tłumaczone", () => {
    const { container } = show(makeWidget("countdown"), "en");

    const jednostki = [...container.querySelectorAll(".uppercase")].map((n) => n.textContent);
    expect(jednostki).toEqual(["days", "hrs", "min", "sec"]);
    expect(container.textContent).not.toContain("godz.");
  });

  it("termin w PRZESZŁOŚCI pokazuje zera, nie liczby ujemne", () => {
    const widget = { ...makeWidget("countdown"), deadline: "2020-01-01T00:00:00.000Z" };
    const { container } = show(widget as NlWidget);

    const liczby = [...container.querySelectorAll(".font-bold")].map((n) => n.textContent);
    expect(liczby).toEqual(["00", "00", "00", "00"]);
    expect(container.textContent).not.toContain("-");
  });

  it("dowód społeczny WSTAWIA liczbę w miejsce znacznika {count}", () => {
    const { container } = show(makeWidget("social-proof"));

    expect(container.textContent).toBe("Dolacz do 1200+ subskrybentow");
    // Znacznik nie może wyciec do treści widocznej dla odbiorcy.
    expect(container.textContent).not.toContain("{count}");
  });

  it("brak liczby zastępczej daje zero, a nie „undefined”", () => {
    const widget = { ...makeWidget("social-proof"), fallbackCount: undefined };
    const { container } = show(widget as NlWidget);

    expect(container.textContent).toBe("Dolacz do 0+ subskrybentow");
    expect(container.textContent).not.toContain("undefined");
  });

  it("kod rabatowy pokazuje etykietę, SAM KOD i przycisk kopiowania", () => {
    show(makeWidget("coupon"));

    expect(screen.getByText("Twoj kod rabatowy")).toBeTruthy();
    expect(screen.getByText("PROMO10")).toBeTruthy();
    expect(screen.getByText("Kopiuj")).toBeTruthy();
  });

  it("przycisk kopiowania kodu jest tłumaczony", () => {
    show(makeWidget("coupon"), "en");

    expect(screen.getByText("Copy")).toBeTruthy();
    expect(screen.queryByText("Kopiuj")).toBeNull();
  });

  it("styl „boxed” daje pełną ramkę, domyślny - przerywaną", () => {
    const { container: dashed, unmount } = show(makeWidget("coupon"));
    expect(dashed.firstElementChild?.className).toContain("border-dashed");
    unmount();

    const boxed = { ...makeWidget("coupon"), style: "boxed" };
    const { container } = show(boxed as NlWidget);
    expect(container.firstElementChild?.className).not.toContain("border-dashed");
    expect(container.firstElementChild?.className).toContain("border-2");
  });
});
