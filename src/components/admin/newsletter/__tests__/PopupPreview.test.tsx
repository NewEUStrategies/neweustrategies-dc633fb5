// Podgląd popupu w panelu administracyjnym.
//
// PO CO. To jedyne miejsce, w którym operator widzi popup przed wypuszczeniem go
// na stronę. Podgląd, który renderuje INNY markup niż produkcja, jest gorszy niż
// brak podglądu: operator zatwierdza coś, czego odwiedzający nie zobaczy.
// Dlatego wariant „showcase" idzie DOKŁADNIE tym samym komponentem co strona
// publiczna, a dokument z buildera - tym samym rendererem dokumentu.
//
// Testy sprawdzają WYBÓR ŚCIEŻKI (showcase / dokument z buildera / stary układ)
// i przekazanie palety oraz zaokrąglenia, bo to one decydują, czy podgląd jest
// 1:1 z produkcją.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// Panel publiczny i renderer dokumentu mają WŁASNE testy; tutaj liczy się to,
// KTÓRY z nich został użyty i z jakimi parametrami.
vi.mock("@/components/popups/SignupPopupPanel", () => ({
  SignupPopupPanel: ({ lang, mode, source }: Record<string, unknown>) => (
    <div data-testid="panel-publiczny">
      {String(lang)}/{String(mode)}/{String(source)}
    </div>
  ),
}));
vi.mock("@/components/newsletter/NewsletterDocRenderer", () => ({
  NewsletterDocRenderer: ({ lang, source }: Record<string, unknown>) => (
    <div data-testid="renderer-dokumentu">
      {String(lang)}/{String(source)}
    </div>
  ),
}));

import { PopupPreview } from "@/components/admin/newsletter/PopupPreview";
import { defaultNewsletterSettings, type NewsletterSettings } from "@/hooks/useNewsletterSettings";
import type { NlDoc } from "@/lib/newsletter-builder/types";

function settings(overrides: Partial<NewsletterSettings> = {}): NewsletterSettings {
  return {
    ...defaultNewsletterSettings(),
    popup_enabled: true,
    popup_title_pl: "Zapisz się na newsletter",
    popup_title_en: "Subscribe to our newsletter",
    popup_description_pl: "Analizy z Brukseli",
    popup_description_en: "Analyses from Brussels",
    popup_cta_pl: "Zapisuję się",
    popup_cta_en: "Sign me up",
    ...overrides,
  };
}

function popupDoc(): NlDoc {
  return { version: 1, variant: "popup", sections: [{ id: "s1", widgets: [] }], popup: {} };
}

function mount(
  args: { settings?: NewsletterSettings; lang?: "pl" | "en"; mode?: "light" | "dark" } = {},
) {
  return render(
    <PopupPreview
      settings={args.settings ?? settings()}
      lang={args.lang ?? "pl"}
      mode={args.mode}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("popup wyłączony", () => {
  it("mówi wprost, że popupu nie ma - zamiast pokazywać pustą ramkę", () => {
    const { container } = mount({ settings: settings({ popup_enabled: false }) });

    expect(container.textContent?.trim().length).toBeGreaterThan(0);
    expect(screen.queryByTestId("panel-publiczny")).toBeNull();
  });

  it("nie renderuje ANI panelu publicznego, ANI dokumentu", () => {
    mount({ settings: settings({ popup_enabled: false, popup_doc: popupDoc() }) });

    expect(screen.queryByTestId("panel-publiczny")).toBeNull();
    expect(screen.queryByTestId("renderer-dokumentu")).toBeNull();
  });

  it("komunikat o wyłączeniu jest TEN SAM niezależnie od języka panelu", () => {
    // CHARAKTERYSTYKA STANU OBECNEGO, nie zatwierdzenie: napis jest wpisany na
    // sztywno po polsku, więc angielski operator widzi polski komunikat.
    // Poprawka idzie osobnym commitem (i18n to bramka blokująca).
    const { container: pl } = mount({ settings: settings({ popup_enabled: false }), lang: "pl" });
    const polski = pl.textContent;
    cleanup();

    const { container: en } = mount({ settings: settings({ popup_enabled: false }), lang: "en" });

    expect(en.textContent).toBe(polski);
  });
});

describe("wariant showcase", () => {
  it("renderuje DOKŁADNIE ten sam panel co strona publiczna", () => {
    // Drugi, uproszczony markup rozjechałby się z produkcją bez żadnego sygnału.
    mount({ settings: settings({ popup_layout: "showcase" }) });

    expect(screen.getByTestId("panel-publiczny")).toBeTruthy();
    expect(screen.queryByTestId("renderer-dokumentu")).toBeNull();
  });

  it("panel dostaje język podglądu i źródło „admin-preview”", () => {
    // Źródło trafia do telemetrii - podgląd nie może udawać ruchu ze strony.
    mount({ settings: settings({ popup_layout: "showcase" }), lang: "en" });

    expect(screen.getByTestId("panel-publiczny").textContent).toBe("en/dark/admin-preview");
  });

  it("wymuszony wariant jasny jest honorowany 1:1", () => {
    mount({ settings: settings({ popup_layout: "showcase" }), mode: "light" });

    expect(screen.getByTestId("panel-publiczny").textContent).toContain("light");
  });

  it("showcase wygrywa nad dokumentem z buildera", () => {
    mount({ settings: settings({ popup_layout: "showcase", popup_doc: popupDoc() }) });

    expect(screen.getByTestId("panel-publiczny")).toBeTruthy();
    expect(screen.queryByTestId("renderer-dokumentu")).toBeNull();
  });
});

describe("dokument z buildera", () => {
  it("jest renderowany tym samym rendererem co front", () => {
    mount({ settings: settings({ popup_doc: popupDoc() }) });

    expect(screen.getByTestId("renderer-dokumentu")).toBeTruthy();
    expect(screen.queryByTestId("panel-publiczny")).toBeNull();
  });

  it("renderer dostaje język i źródło podglądu", () => {
    mount({ settings: settings({ popup_doc: popupDoc() }), lang: "en" });

    expect(screen.getByTestId("renderer-dokumentu").textContent).toBe("en/admin-preview");
  });

  it("styl okna z DOKUMENTU nadpisuje ustawienia tenanta", () => {
    // Dokument jest źródłem prawdy dla wyglądu popupu - inaczej podgląd
    // pokazywałby kolory, których odwiedzający nie zobaczy.
    const doc: NlDoc = {
      ...popupDoc(),
      popup: { bg: "#112233", fg: "#445566", radius: 24 },
    };
    const { container } = mount({
      settings: settings({ popup_doc: doc, popup_bg_color: "#000000", popup_border_radius_px: 4 }),
    });

    const card = container.querySelector('[style*="border-radius: 24px"]') as HTMLElement;
    expect(card).toBeTruthy();
    expect(card.style.backgroundColor).toBeTruthy();
  });

  it("dokument BEZ stylu okna schodzi na paletę tenanta", () => {
    const { container } = mount({
      settings: settings({ popup_doc: popupDoc(), popup_border_radius_px: 12 }),
    });

    expect(container.querySelector('[style*="border-radius: 12px"]')).toBeTruthy();
  });
});

describe("stary układ (tenanci bez dokumentu)", () => {
  it("pokazuje tytuł, opis i przycisk z ustawień", () => {
    mount();

    expect(screen.getByText("Zapisz się na newsletter")).toBeTruthy();
    expect(screen.getByText("Analizy z Brukseli")).toBeTruthy();
    expect(screen.getByText("Zapisuję się")).toBeTruthy();
  });

  it("treść idzie za językiem podglądu", () => {
    mount({ lang: "en" });

    expect(screen.getByText("Subscribe to our newsletter")).toBeTruthy();
    expect(screen.queryByText("Zapisz się na newsletter")).toBeNull();
  });

  it("BRAK tytułu pokazuje kreskę - pusty nagłówek wygląda jak awaria", () => {
    mount({ settings: settings({ popup_title_pl: "", popup_title_en: "" }) });

    expect(screen.getByText("-")).toBeTruthy();
  });

  it("brak opisu nie zostawia pustego akapitu", () => {
    // Klauzula RODO też jest akapitem, więc liczymy tylko akapit opisu.
    const { container } = mount({
      settings: settings({
        popup_description_pl: "",
        popup_description_en: "",
        policy_html_pl: null,
        policy_html_en: null,
      }),
    });

    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(screen.getByText("Zapisz się na newsletter")).toBeTruthy();
  });

  it("BRAK etykiety przycisku schodzi na tekst awaryjny, w obu językach", () => {
    // Przycisk bez podpisu jest nieklikalny dla operatora i dla odwiedzającego.
    mount({ settings: settings({ popup_cta_pl: "", popup_cta_en: "" }), lang: "pl" });
    expect(screen.getByText("Zapisz się")).toBeTruthy();
    cleanup();

    mount({ settings: settings({ popup_cta_pl: "", popup_cta_en: "" }), lang: "en" });
    expect(screen.getByText("Subscribe")).toBeTruthy();
  });

  it("pole e-mail ma podpowiedź w języku podglądu i jest TYLKO do odczytu", () => {
    // Podgląd nie może zbierać adresów.
    const { container } = mount({ lang: "en" });

    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.placeholder).toBe("you@email.com");
    expect(input.readOnly).toBe(true);
  });

  it("OKŁADKA jest pokazana, gdy ustawiona", () => {
    const { container } = mount({
      settings: settings({ popup_cover_url: "https://example.test/cover.png" }),
    });

    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/cover.png",
    );
  });

  it("bez okładki nie ma pustego obrazka", () => {
    const { container } = mount({ settings: settings({ popup_cover_url: null }) });

    expect(container.querySelector("img")).toBeNull();
  });

  it("klauzula RODO jest SANITYZOWANA - podgląd nie wykonuje skryptu", () => {
    const { container } = mount({
      settings: settings({
        policy_html_pl: '<a href="https://example.test">Polityka</a><script>alert(1)</script>',
      }),
    });

    expect(screen.getByText("Polityka")).toBeTruthy();
    expect(container.querySelector("script")).toBeNull();
  });

  it("brak klauzuli nie zostawia pustego bloku", () => {
    const { container } = mount({ settings: settings({ policy_html_pl: null }) });

    expect(container.querySelector("[class*='text-[10px]']")).toBeNull();
  });

  it("ZAOKRĄGLENIE pola i przycisku jest ograniczone - popup o promieniu 40 px nie daje owalnych pól", () => {
    const { container } = mount({ settings: settings({ popup_border_radius_px: 40 }) });

    const input = container.querySelector("input") as HTMLElement;
    expect(input.style.borderRadius).toBe("8px");
  });

  it("ujemne zaokrąglenie schodzi na zero, a nie na wartość ujemną w stylu", () => {
    const { container } = mount({ settings: settings({ popup_border_radius_px: -8 }) });

    const card = container.querySelector('[style*="border-radius: 0px"]');
    expect(card).toBeTruthy();
    expect((container.querySelector("input") as HTMLElement).style.borderRadius).toBe("0px");
  });
});
