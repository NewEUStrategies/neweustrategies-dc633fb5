// Wspólna kontrolka prezentacji autora: co redakcja klika -> co ląduje w treści.
//
// Kontrolka jest jedynym miejscem, które ZAPISUJE ustawienia autora, więc to
// tutaj musi być przypięte, że:
//   * obie osie widoczności są niezależne (klik w zdjęcie nie gasi nazwiska),
//   * razem z kluczami kanonicznymi lecą spójne klucze historyczne - dokument
//     otwarty w starszym wydaniu aplikacji nadal wygląda tak samo,
//   * pola rozmiaru i etykiety pojawiają się dokładnie tam, gdzie mają sens.
import { describe, it, expect, vi, afterEach } from "vitest";
// Prawdziwe zasoby i18n: bez tego `t()` zwraca GOŁY KLUCZ, a asercje na
// widoczny tekst przechodziły wyłącznie dzięki `defaultValue` wpisanemu przy
// wywołaniu - czyli test sprawdzał kopię napisu z kodu, a nie to, co widzi
// użytkownik. Import wciąga rdzeń słownika (nakładki `i18n-*` dociąga sam
// komponent), więc asercja mierzy teraz wartość ze słownika.
import "@/lib/i18n";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Json, WidgetContent } from "@/lib/builder/types";

// BEZ atrapy `react-i18next`: prawdziwy hak na prawdziwym słowniku (import
// `@/lib/i18n` wyżej). Atrapa zwracała `opts.defaultValue ?? key`, czyli test
// czytał kopię napisu wpisaną w kodzie komponentu, a nie wartość ze słownika -
// po zdjęciu zapasowych tekstów nie miała już czego zwracać. Mockować się jej
// nie da: `@/lib/i18n` sam importuje `react-i18next`, więc atrapa sięgająca po
// słownik zamyka cykl importów i test wisi bez komunikatu.

import { AuthorDisplayControl } from "../AuthorDisplayControl";

function renderControl(
  c: WidgetContent = {},
  defaults?: Parameters<typeof AuthorDisplayControl>[0]["defaults"],
) {
  const setContent = vi.fn<(k: string, v: Json) => void>();
  const view = render(
    <AuthorDisplayControl c={c} lang="pl" setContent={setContent} defaults={defaults} />,
  );
  const written = (): Record<string, Json> =>
    Object.fromEntries(setContent.mock.calls.map(([k, v]) => [k, v]));
  return { ...view, setContent, written };
}

afterEach(cleanup);

describe("AuthorDisplayControl - zapis widoczności", () => {
  it("wyłączenie zdjęcia zostawia nazwisko i przechodzi w tryb etykiety", () => {
    const { written } = renderControl();
    fireEvent.click(screen.getByRole("switch", { name: /Zdjęcie autora/ }));

    expect(written()).toMatchObject({
      showAuthorAvatar: false,
      showAuthorName: true,
      // Klucze historyczne utrzymane w spójności.
      showAuthor: true,
      authorDisplay: "label",
      showAuthorLabel: true,
    });
  });

  it("wyłączenie nazwiska zostawia samo zdjęcie (tryb niewyrażalny w trójstanie)", () => {
    const { written } = renderControl();
    fireEvent.click(screen.getByRole("switch", { name: /Imię i nazwisko autora/ }));

    expect(written()).toMatchObject({
      showAuthorName: false,
      showAuthorAvatar: true,
      showAuthor: true,
    });
  });

  it("wyłączenie obu osi gasi całą sekcję także dla starszych rendererów", () => {
    const { written } = renderControl({ showAuthorName: false });
    fireEvent.click(screen.getByRole("switch", { name: /Zdjęcie autora/ }));

    expect(written()).toMatchObject({
      showAuthorName: false,
      showAuthorAvatar: false,
      showAuthor: false,
      authorDisplay: "none",
    });
  });
});

describe("AuthorDisplayControl - pola zależne od stanu", () => {
  it("domyślnie oferuje oba rozmiary z wartościami 12 / 20", () => {
    renderControl();
    const nameSize = screen.getByLabelText("Rozmiar czcionki autora (px)");
    const avatarSize = screen.getByLabelText("Rozmiar zdjęcia autora (px)");
    expect(nameSize).toHaveValue(12);
    expect(avatarSize).toHaveValue(20);
  });

  it("etykieta pojawia się WYŁĄCZNIE bez zdjęcia (wtedy byline to sam tekst)", () => {
    const withAvatar = renderControl();
    expect(screen.queryByLabelText("Etykieta autora (i18n)")).toBeNull();
    withAvatar.unmount();

    renderControl({ showAuthorAvatar: false });
    expect(screen.getByLabelText("Etykieta autora (i18n)")).toBeInTheDocument();
  });

  it("rozmiar zdjęcia znika, gdy zdjęcia nie ma", () => {
    renderControl({ showAuthorAvatar: false });
    expect(screen.queryByLabelText("Rozmiar zdjęcia autora (px)")).toBeNull();
    expect(screen.getByLabelText("Rozmiar czcionki autora (px)")).toBeInTheDocument();
  });

  it("widget bez zdjęcia autora nie dostaje osi awatara wcale", () => {
    render(<AuthorDisplayControl c={{}} lang="pl" setContent={() => {}} avatarSupported={false} />);
    expect(screen.queryByRole("switch", { name: /Zdjęcie autora/ })).toBeNull();
    expect(screen.getByRole("switch", { name: /Imię i nazwisko autora/ })).toBeInTheDocument();
  });
});

describe("AuthorDisplayControl - przywracanie domyślnych", () => {
  it("wraca do 12 px / 20 px i obu osi widocznych", () => {
    const { written } = renderControl({
      showAuthorName: false,
      authorSizePx: 22,
      authorAvatarSizePx: 60,
    });
    fireEvent.click(screen.getByRole("button", { name: /Przywróć domyślne/ }));

    expect(written()).toMatchObject({
      showAuthorName: true,
      showAuthorAvatar: true,
      authorSizePx: 12,
      authorAvatarSizePx: 20,
    });
  });
});

describe("AuthorDisplayControl - zapis rozmiarów", () => {
  it.each([
    ["rozmiar czcionki", "Rozmiar czcionki autora (px)", "18", "authorSizePx", 18],
    ["rozmiar zdjęcia", "Rozmiar zdjęcia autora (px)", "48", "authorAvatarSizePx", 48],
  ])("zapisuje %s", (_label, field, typed, key, expected) => {
    const { written } = renderControl();
    fireEvent.change(screen.getByLabelText(field), { target: { value: typed } });
    expect(written()[key]).toBe(expected);
  });

  it.each([
    ["rozmiar czcionki", "Rozmiar czcionki autora (px)", "authorSizePx", 12],
    ["rozmiar zdjęcia", "Rozmiar zdjęcia autora (px)", "authorAvatarSizePx", 20],
  ])("wyczyszczenie pola wraca do wartości domyślnej: %s", (_label, field, key, fallback) => {
    const { written } = renderControl({ authorSizePx: 22, authorAvatarSizePx: 60 });
    fireEvent.change(screen.getByLabelText(field), { target: { value: "" } });
    // Pusty rozmiar autora nie może zostać w dokumencie jako `undefined`:
    // renderer wstawiłby wtedy `undefinedpx` do arkusza instancji. Zamiast tego
    // wracamy do wartości bazowej.
    expect(written()[key]).toBe(fallback);
  });

  it("baseline widgetu nadpisuje wartości globalne w polach i w resecie", () => {
    const { written } = renderControl({}, { nameSizePx: 16, avatarSizePx: 40 });
    expect(screen.getByLabelText("Rozmiar czcionki autora (px)")).toHaveValue(16);
    expect(screen.getByLabelText("Rozmiar zdjęcia autora (px)")).toHaveValue(40);
    fireEvent.click(screen.getByRole("button", { name: /Przywróć domyślne/ }));
    // „Przywróć” musi wrócić do baseline WIDGETU (np. slider ma większe
    // zdjęcie), a nie do globalnych 12/20.
    expect(written()).toMatchObject({ authorSizePx: 16, authorAvatarSizePx: 40 });
  });

  it("baseline widgetu z ukrytymi osiami też jest respektowany przez reset", () => {
    const { written } = renderControl(
      { showAuthorName: true, showAuthorAvatar: true },
      { showName: false, showAvatar: false },
    );
    fireEvent.click(screen.getByRole("button", { name: /Przywróć domyślne/ }));
    expect(written()).toMatchObject({ showAuthorName: false, showAuthorAvatar: false });
  });
});

describe("AuthorDisplayControl - etykieta autora", () => {
  it("zapisuje etykietę pod klucz języka treści", () => {
    const { written } = renderControl({ showAuthorAvatar: false });
    fireEvent.change(screen.getByLabelText("Etykieta autora (i18n)"), {
      target: { value: "Tekst" },
    });
    expect(written().authorLabel_pl).toBe("Tekst");
  });

  it("dla treści angielskiej zapisuje klucz angielski", () => {
    const setContent = vi.fn<(k: string, v: Json) => void>();
    render(
      <AuthorDisplayControl c={{ showAuthorAvatar: false }} lang="en" setContent={setContent} />,
    );
    fireEvent.change(screen.getByLabelText("Etykieta autora (i18n)"), {
      target: { value: "Written by" },
    });
    expect(setContent).toHaveBeenCalledWith("authorLabel_en", "Written by");
  });

  it("czyta zapisaną etykietę i podpowiada domyślną", () => {
    renderControl({ showAuthorAvatar: false, authorLabel_pl: "Redakcja" });
    const field = screen.getByLabelText("Etykieta autora (i18n)") as HTMLInputElement;
    expect(field.value).toBe("Redakcja");
    expect(field.placeholder).toBe("Autor");
  });

  it("etykieta nietekstowa w dokumencie daje puste pole", () => {
    renderControl({ showAuthorAvatar: false, authorLabel_pl: 7 });
    expect((screen.getByLabelText("Etykieta autora (i18n)") as HTMLInputElement).value).toBe("");
  });

  it("wyczyszczenie etykiety zapisuje pusty napis", () => {
    const { written } = renderControl({ showAuthorAvatar: false, authorLabel_pl: "Redakcja" });
    fireEvent.change(screen.getByLabelText("Etykieta autora (i18n)"), { target: { value: "" } });
    // Pusty napis, nie brak klucza - renderer rozumie to jako „użyj domyślnej”.
    expect(written().authorLabel_pl).toBe("");
  });

  it("znacznik trybu prezentacji jedzie w atrybucie danych", () => {
    const { container } = renderControl({ showAuthorAvatar: false });
    // Bramka wierności ustawień czyta ten atrybut, żeby porównać obietnicę
    // panelu z tym, co renderuje widget.
    expect(container.querySelector("[data-author-display-control]")).toHaveAttribute(
      "data-author-display-control",
      "label",
    );
  });

  it("bez nazwy autora nie ma ani rozmiaru, ani etykiety", () => {
    renderControl({ showAuthorName: false, showAuthorAvatar: false });
    expect(screen.queryByLabelText("Rozmiar czcionki autora (px)")).toBeNull();
    expect(screen.queryByLabelText("Etykieta autora (i18n)")).toBeNull();
  });
});
