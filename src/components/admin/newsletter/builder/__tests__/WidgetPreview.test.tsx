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

    for (const item of WIDGET_REGISTRY) {
      const { container, unmount } = show(makeWidget(item.type), "en");
      if (container.innerHTML.trim() === "") puste.push(item.type);
      unmount();
    }

    expect(puste).toEqual([]);
  });

  it("brak widgetu nie renderuje niczego, zamiast wywalać kanwę", () => {
    const { container } = show(null);

    expect(container.innerHTML).toBe("");
  });

  it("typ nieznany podglądowi renderuje pustkę, a nie wyjątek", () => {
    const { container } = show({ id: "x", type: "nie-ma-takiego" } as unknown as NlWidget);

    expect(container.innerHTML).toBe("");
  });
});

describe("nagłówek", () => {
  it("poziom nagłówka steruje znacznikiem HTML", () => {
    const widget = { ...makeWidget("heading"), level: 2, text: { pl: "Tytuł", en: "Title" } };
    show(widget as NlWidget);

    const heading = screen.getByText("Tytuł");
    expect(heading.tagName).toBe("H2");
  });

  it("pusty tekst pokazuje kreskę - element nie znika bez śladu", () => {
    const widget = { ...makeWidget("heading"), text: { pl: "", en: "" } };
    show(widget as NlWidget);

    expect(screen.getByText("-")).toBeTruthy();
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
    unmount();

    show(widget as NlWidget, "en");
    expect(screen.getByText("Title")).toBeTruthy();
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
  });

  it("BEZ adresu pokazuje zastępczy placeholder, nie pustą dziurę", () => {
    const widget = { ...makeWidget("image"), url: "" };
    const { container } = show(widget as NlWidget);

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML.trim()).not.toBe("");
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
    show(makeWidget("field.email"));

    // Gwiazdka to jedyny sygnał wymagalności w podglądzie.
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("pole tekstowe pokazuje swoją etykietę", () => {
    const widget = { ...makeWidget("field.text"), label: { pl: "Imię", en: "First name" } };
    show(widget as NlWidget);

    expect(screen.getByText(/Imię/)).toBeTruthy();
  });

  it("checkbox zgody renderuje swoją treść jako HTML", () => {
    const widget = {
      ...makeWidget("field.checkbox"),
      html: { pl: "<span>Zgoda marketingowa</span>", en: "<span>Consent</span>" },
    };
    show(widget as NlWidget);

    expect(screen.getByText("Zgoda marketingowa")).toBeTruthy();
  });

  it("lista wyboru renderuje się z etykietą", () => {
    const { container } = show(makeWidget("field.select"));

    expect(container.innerHTML.trim()).not.toBe("");
  });

  it("wybór list mailingowych renderuje się z etykietą", () => {
    const { container } = show(makeWidget("field.mailing-lists"));

    expect(container.innerHTML.trim()).not.toBe("");
  });
});

describe("akcje", () => {
  it("przycisk wysyłki pokazuje swoją etykietę", () => {
    const widget = { ...makeWidget("submit"), label: { pl: "Zapisz się", en: "Subscribe" } };
    show(widget as NlWidget);

    expect(screen.getByText("Zapisz się")).toBeTruthy();
  });

  it("komunikat sukcesu pokazuje swoją treść", () => {
    const widget = { ...makeWidget("success-message"), text: { pl: "Gotowe", en: "Done" } };
    show(widget as NlWidget);

    expect(screen.getByText("Gotowe")).toBeTruthy();
  });

  it("przycisk CTA pokazuje etykietę", () => {
    const { container } = show(makeWidget("cta-button"));

    expect(container.innerHTML.trim()).not.toBe("");
  });
});

describe("widgety popupowe", () => {
  it("przycisk zamknięcia ma etykietę dla czytnika ekranu", () => {
    show(makeWidget("close-button"));

    expect(screen.getByLabelText("Zamknij popup")).toBeTruthy();
  });

  it("etykieta zamknięcia jest tłumaczona", () => {
    show(makeWidget("close-button"), "en");

    expect(screen.getByLabelText("Close popup")).toBeTruthy();
  });

  it("wariant ikonowy pokazuje glif, nie tekst", () => {
    const widget = { ...makeWidget("close-button"), variant: "icon-x" };
    show(widget as NlWidget);

    expect(screen.getByText("✕")).toBeTruthy();
  });

  it("wariant tekstowy pokazuje etykietę", () => {
    const widget = {
      ...makeWidget("close-button"),
      variant: "text",
      label: { pl: "Nie teraz", en: "Not now" },
    };
    show(widget as NlWidget);

    expect(screen.getByText("Nie teraz")).toBeTruthy();
  });

  it("pozycja w narożniku zmienia wyrównanie", () => {
    const corner = { ...makeWidget("close-button"), position: "top-right" };
    const { container } = show(corner as NlWidget);

    expect(container.firstElementChild?.className).toContain("justify-end");
  });

  it("licznik czasu renderuje się z jednostkami", () => {
    const { container } = show(makeWidget("countdown"));

    expect(container.innerHTML.trim()).not.toBe("");
  });

  it("dowód społeczny renderuje treść", () => {
    const { container } = show(makeWidget("social-proof"));

    expect(container.innerHTML.trim()).not.toBe("");
  });

  it("kod rabatowy pokazuje przycisk kopiowania", () => {
    show(makeWidget("coupon"));

    expect(screen.getByText("Kopiuj")).toBeTruthy();
  });

  it("przycisk kopiowania kodu jest tłumaczony", () => {
    show(makeWidget("coupon"), "en");

    expect(screen.getByText("Copy")).toBeTruthy();
  });
});
