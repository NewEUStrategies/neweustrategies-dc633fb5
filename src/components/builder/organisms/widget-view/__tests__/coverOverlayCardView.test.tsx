// Widok widgetu „Karta z okładką": każde ustawienie panelu MUSI być widoczne
// w DOM-ie, treść musi respektować język, a adresy - sanityzację.
//
// Test celuje w renderer (organizm + molekuła), nie w kanwę buildera: kanwa ma
// własne testy warstwy sterowania.
import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CoverOverlayCardView } from "../CoverOverlayCardView";
import type { WidgetContent } from "@/lib/builder/types";

const base: WidgetContent = {
  title_pl: "Jak ustawić meble",
  title_en: "How to position your furniture",
  excerpt_pl: "Krótki opis po polsku.",
  excerpt_en: "A short English blurb.",
  image: "https://images.example.org/cover.jpg",
  imageAlt_pl: "Biurko przy oknie",
  imageAlt_en: "A desk by the window",
  date: "2022-10-10",
  showDate: true,
  href: "https://example.org/wpis",
};

const card = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>("[data-cover-overlay-card]");
  if (!el) throw new Error("test: brak karty w DOM-ie");
  return el;
};

const overlay = (): HTMLElement => {
  const el = card().querySelector<HTMLElement>(".coc-overlay");
  if (!el) throw new Error("test: brak nakładki");
  return el;
};

describe("CoverOverlayCardView", () => {
  it("renderuje treść w języku widoku (PL)", () => {
    render(<CoverOverlayCardView c={base} lang="pl" />);
    expect(screen.getByRole("heading", { name: "Jak ustawić meble" })).toBeTruthy();
    expect(screen.getByText("Krótki opis po polsku.")).toBeTruthy();
    expect(screen.getByAltText("Biurko przy oknie")).toBeTruthy();
    cleanup();
  });

  it("renderuje treść w języku widoku (EN)", () => {
    render(<CoverOverlayCardView c={base} lang="en" />);
    expect(screen.getByRole("heading", { name: "How to position your furniture" })).toBeTruthy();
    expect(screen.getByText("A short English blurb.")).toBeTruthy();
    expect(screen.getByAltText("A desk by the window")).toBeTruthy();
  });

  it("data jedzie jako <time> z maszynowym datetime i napisem w języku widoku", () => {
    render(<CoverOverlayCardView c={base} lang="en" />);
    const time = card().querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2022-10-10");
    expect(time?.textContent).toBe("10 Oct 2022");
  });

  it("wyłączona data znika z karty, ale reszta zostaje", () => {
    render(<CoverOverlayCardView c={{ ...base, showDate: false }} lang="en" />);
    expect(card().querySelector("time")).toBeNull();
    expect(screen.getByRole("heading", { name: /furniture/ })).toBeTruthy();
  });

  it("data spoza ISO jedzie jako zwykły tekst, bez pustego atrybutu datetime", () => {
    render(<CoverOverlayCardView c={{ ...base, date: "wkrótce" }} lang="pl" />);
    expect(card().querySelector("time")).toBeNull();
    expect(screen.getByText("wkrótce")).toBeTruthy();
  });

  it("tytuł jest linkiem tylko przy bezpiecznym adresie", () => {
    render(<CoverOverlayCardView c={base} lang="pl" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.org/wpis");
    cleanup();

    render(<CoverOverlayCardView c={{ ...base, href: "javascript:alert(1)" }} lang="pl" />);
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();

    render(<CoverOverlayCardView c={{ ...base, href: "" }} lang="pl" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("okładka bez tekstu alternatywnego jest dekoracją", () => {
    render(<CoverOverlayCardView c={{ ...base, imageAlt_pl: "", imageAlt_en: "" }} lang="pl" />);
    const img = card().querySelector("img");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("brak okładki nie wywraca renderu - zostaje sama płaszczyzna", () => {
    render(<CoverOverlayCardView c={{ ...base, image: "" }} lang="pl" />);
    expect(card().querySelector("img")).toBeNull();
    expect(overlay()).toBeTruthy();
  });

  it("adres obrazu jest sanityzowany", () => {
    render(<CoverOverlayCardView c={{ ...base, image: "javascript:alert(1)" }} lang="pl" />);
    expect(card().querySelector("img")).toBeNull();
  });

  it("ustawienia prezentacji są widoczne w stylu węzłów", () => {
    render(
      <CoverOverlayCardView
        c={{
          ...base,
          overlayColor: "#ff0000",
          overlayAlphaTop: 0.1,
          overlayAlphaBottom: 0.9,
          mediaMinHeight: 320,
          radius: 20,
          maxWidth: 600,
          clampLines: 5,
        }}
        lang="pl"
      />,
    );
    const frame = card();
    expect(frame.style.borderRadius).toBe("20px");
    expect(frame.style.maxWidth).toBe("600px");
    const ov = overlay();
    expect(ov.style.getPropertyValue("--coc-overlay-color")).toBe("#ff0000");
    expect(ov.style.getPropertyValue("--coc-overlay-top")).toBe("10%");
    expect(ov.style.getPropertyValue("--coc-overlay-bottom")).toBe("90%");
    expect(ov.style.paddingTop).toBe("320px");
    const excerpt = frame.querySelector<HTMLElement>(".coc-clamp");
    expect(excerpt?.style.getPropertyValue("--coc-clamp-lines")).toBe("5");
  });

  it("wartości spoza zakresu są przycinane, nie przepuszczane", () => {
    render(
      <CoverOverlayCardView
        c={{ ...base, overlayAlphaTop: 9, radius: -5, clampLines: 99, maxWidth: 0 }}
        lang="pl"
      />,
    );
    expect(overlay().style.getPropertyValue("--coc-overlay-top")).toBe("100%");
    expect(card().style.borderRadius).toBe("0px");
    expect(card().style.maxWidth).toBe("");
    expect(
      card().querySelector<HTMLElement>(".coc-clamp")?.style.getPropertyValue("--coc-clamp-lines"),
    ).toBe("6");
  });

  it("uniesienie na hoverze da się wyłączyć", () => {
    render(<CoverOverlayCardView c={base} lang="pl" />);
    expect(card().classList.contains("coc-lift")).toBe(true);
    cleanup();
    render(<CoverOverlayCardView c={{ ...base, hoverLift: false }} lang="pl" />);
    expect(card().classList.contains("coc-lift")).toBe(false);
  });
});
