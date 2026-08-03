// Wspólna kontrolka prezentacji autora: co redakcja klika -> co ląduje w treści.
//
// Kontrolka jest jedynym miejscem, które ZAPISUJE ustawienia autora, więc to
// tutaj musi być przypięte, że:
//   * obie osie widoczności są niezależne (klik w zdjęcie nie gasi nazwiska),
//   * razem z kluczami kanonicznymi lecą spójne klucze historyczne - dokument
//     otwarty w starszym wydaniu aplikacji nadal wygląda tak samo,
//   * pola rozmiaru i etykiety pojawiają się dokładnie tam, gdzie mają sens.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Json, WidgetContent } from "@/lib/builder/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { AuthorDisplayControl } from "../AuthorDisplayControl";

function renderControl(c: WidgetContent = {}) {
  const setContent = vi.fn<(k: string, v: Json) => void>();
  const view = render(<AuthorDisplayControl c={c} lang="pl" setContent={setContent} />);
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
