// Selektor układu sekcji "Powiązane wpisy" - `RelatedLayoutPreview`.
//
// CO TEN PLIK PRZYPINA I DLACZEGO.
//   1. TO JEST GRUPA RADIO, NIE SZEŚĆ NIEZALEŻNYCH PRZYCISKÓW. Kafelki
//      wyglądają jak karty, ale semantycznie są wyborem jednokrotnym:
//      `role="radiogroup"` + sześć `role="radio"` z `aria-checked`. Redaktor
//      czytający ekranem musi wiedzieć, KTÓRY układ jest teraz wybrany -
//      sam obrys na kafelku nie mówi mu nic.
//   2. KLIKNIĘCIE ODDAJE KLUCZ UKŁADU, A NIE ETYKIETĘ. `onChange` dostaje
//      `"magazine"`, nie "Magazyn" - to ta sama wartość, którą renderer
//      publiczny czyta z konfiguracji (`RelatedLayout`). Pomyłka na tej
//      granicy to sekcja powiązanych wpisów rysowana innym układem, niż
//      redaktor wybrał, i to bez żadnego komunikatu.
//   3. JĘZYK PANELU DECYDUJE O CAŁEJ WARSTWIE TEKSTOWEJ. Komponent nie
//      korzysta ze słownika i18n - trzyma własną tablicę `LABELS` i wybiera
//      kolumnę po `i18n.language`. Wariant PL i EN to więc DWA osobne
//      przypadki: nazwa układu, opis pod nazwą, etykieta stanu
//      ("Aktywny"/"Active") ORAZ `aria-label` całej grupy.
//   4. WSZYSTKIE SZEŚĆ MINIATUR SIĘ RYSUJE. `Thumb` to `switch` po układzie
//      bez gałęzi domyślnej - dorzucenie siódmego układu do typu
//      `RelatedLayout` bez gałęzi w `switch` da pusty kafel. Test liczy
//      węzły `<svg>`, więc taki brak wychodzi natychmiast.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: samego rysunku miniatur (liczby, współrzędne
// i kolory prostokątów SVG to dekoracja bez kontraktu) ani reguł składania
// konfiguracji powiązanych wpisów - te mają własne testy w `lib/relatedPosts`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { RelatedLayout } from "@/lib/relatedPosts";

const h = vi.hoisted(() => ({ language: "pl" }));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.language),
);

const { RelatedLayoutPreview } = await import("@/components/admin/RelatedLayoutPreview");

/** Kolejność kafelków jest kontraktem widoku - powtarzamy ją jawnie. */
const KOLEJNOSC: RelatedLayout[] = ["grid", "list", "slider", "cards", "magazine", "timeline"];

function renderuj(value: RelatedLayout, language = "pl") {
  h.language = language;
  const onChange = vi.fn<(v: RelatedLayout) => void>();
  const utils = render(<RelatedLayoutPreview value={value} onChange={onChange} />);
  return { ...utils, onChange };
}

describe("RelatedLayoutPreview - semantyka wyboru jednokrotnego", () => {
  it("wystawia grupę radio z sześcioma kafelkami i miniaturą w każdym", () => {
    const { container } = renderuj("grid");

    const grupa = screen.getByRole("radiogroup", { name: "Układ powiązanych wpisów" });
    const kafelki = within(grupa).getAllByRole("radio");
    expect(kafelki).toHaveLength(KOLEJNOSC.length);
    // Każdy kafelek ma własną miniaturę - `Thumb` nie ma gałęzi domyślnej,
    // więc brak gałęzi dla nowego układu zostawiłby pusty kafel.
    expect(container.querySelectorAll("svg")).toHaveLength(KOLEJNOSC.length);
  });

  it("zaznacza dokładnie jeden kafelek - ten z propa `value`", () => {
    renderuj("magazine");

    const kafelki = screen.getAllByRole("radio");
    const zaznaczone = kafelki.filter((el) => el.getAttribute("aria-checked") === "true");
    expect(zaznaczone).toHaveLength(1);
    expect(within(zaznaczone[0]).getByText("Magazyn")).toBeInTheDocument();
    // Etykieta stanu pojawia się WYŁĄCZNIE na kafelku aktywnym.
    expect(screen.getAllByText("Aktywny")).toHaveLength(1);
  });

  it.each(KOLEJNOSC)("kliknięcie kafelka %s oddaje klucz układu, nie etykietę", (uklad) => {
    const { onChange } = renderuj("grid");

    const kafelki = screen.getAllByRole("radio");
    fireEvent.click(kafelki[KOLEJNOSC.indexOf(uklad)]);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(uklad);
  });

  it("kliknięcie kafelka już aktywnego też emituje zmianę (komponent jest bezstanowy)", () => {
    const { onChange } = renderuj("list");

    fireEvent.click(screen.getAllByRole("radio")[KOLEJNOSC.indexOf("list")]);

    expect(onChange).toHaveBeenCalledWith("list");
  });
});

describe("RelatedLayoutPreview - warstwa tekstowa idzie za językiem panelu", () => {
  it("po polsku pokazuje polskie nazwy, opisy i etykietę stanu", () => {
    renderuj("cards", "pl");

    expect(
      screen.getByRole("radiogroup", { name: "Układ powiązanych wpisów" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lista")).toBeInTheDocument();
    expect(screen.getByText("Karty")).toBeInTheDocument();
    expect(screen.getByText("Oś czasu")).toBeInTheDocument();
    expect(screen.getByText("Kolor kategorii + ikona")).toBeInTheDocument();
    expect(screen.getByText("Aktywny")).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  it("po angielsku pokazuje angielskie nazwy, opisy i etykietę stanu", () => {
    renderuj("cards", "en");

    expect(screen.getByRole("radiogroup", { name: "Related posts layout" })).toBeInTheDocument();
    expect(screen.getByText("List")).toBeInTheDocument();
    expect(screen.getByText("Cards")).toBeInTheDocument();
    expect(screen.getByText("Timeline")).toBeInTheDocument();
    expect(screen.getByText("Category color + icon")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText("Aktywny")).not.toBeInTheDocument();
  });

  it("wariant regionalny angielskiego (en-GB) też liczy się jako angielski", () => {
    // Bramka to `startsWith("en")`, a nie równość - inaczej admin z `en-GB`
    // dostawałby polskie nazwy układów przy angielskim panelu.
    renderuj("grid", "en-GB");

    expect(screen.getByRole("radiogroup", { name: "Related posts layout" })).toBeInTheDocument();
    expect(screen.getByText("Equal thumbnail grid")).toBeInTheDocument();
  });
});
