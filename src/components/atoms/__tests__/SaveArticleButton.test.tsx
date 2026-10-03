// „ZAPISZ NA PÓŹNIEJ" - jeden przycisk zapisu artykułu dla całej platformy.
//
// CO DOWODZI TEN PLIK. Atom stał na 1/12 linii: testy pasków czytania
// atrapowały go w całości. A on niesie kontrakt, dla którego powstał -
// KAŻDY pasek i panel czyta i zapisuje TĘ SAMĄ prawdę przez `useSaveArticle`:
//   * adres artykułu: jawny `url` wygrywa, bez niego - `window.location` PO
//     montażu (SSR i hydratacja renderują ten sam znacznik), odświeżany przy
//     zmianie artykułu (nawigacja wpis->wpis reużywa poddrzewo);
//   * stan „zapisano" jest w `aria-pressed`, a etykieta dostępna mówi, co
//     klik ZROBI („Usuń z zapisanych"), nie tylko jaki jest stan;
//   * dwa warianty: ikonowy (paski) i z etykietą (panele).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  isSaved: false,
  toggle: vi.fn(),
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useSaveArticle", () => ({
  useSaveArticle: (args: Record<string, unknown>) => {
    h.calls.push(args);
    return { isSaved: h.isSaved, toggle: h.toggle };
  },
}));

import { SaveArticleButton } from "../SaveArticleButton";

beforeEach(() => {
  h.isSaved = false;
  h.toggle.mockReset();
  h.calls.length = 0;
});

afterEach(cleanup);

describe("SaveArticleButton", () => {
  it("niezapisany: etykieta mówi, co klik zrobi, a klik przełącza zapis", () => {
    render(<SaveArticleButton title="Wpis" lang="pl" entityId="p1" url="https://example.com/a" />);
    const button = screen.getByRole("button", { name: "Zapisz na później" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("data-saved")).toBe("false");
    fireEvent.click(button);
    expect(h.toggle).toHaveBeenCalledTimes(1);
  });

  it("zapisany: stan w `aria-pressed`, etykieta - usunięcie", () => {
    h.isSaved = true;
    render(<SaveArticleButton title="Wpis" lang="pl" url="https://example.com/a" />);
    const button = screen.getByRole("button", { name: "Usuń z zapisanych" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("data-saved")).toBe("true");
  });

  it("wariant z etykietą pokazuje tekst stanu obok ikony", () => {
    const { rerender } = render(
      <SaveArticleButton title="Wpis" lang="pl" url="https://example.com/a" variant="labelled" />,
    );
    expect(screen.getByRole("button").textContent).toBe("Zapisz na później");
    h.isSaved = true;
    rerender(
      <SaveArticleButton title="Wpis" lang="pl" url="https://example.com/a" variant="labelled" />,
    );
    expect(screen.getByRole("button").textContent).toBe("Zapisano");
  });

  it("wariant ikonowy nie ma tekstu - nazwa idzie wyłącznie przez `aria-label`", () => {
    render(<SaveArticleButton title="Wpis" lang="en" url="https://example.com/a" />);
    const button = screen.getByRole("button", { name: "Save for later" });
    expect(button.textContent).toBe("");
    expect(button.getAttribute("title")).toBe("Save for later");
  });

  it("po angielsku: etykiety stanu zapisanego", () => {
    h.isSaved = true;
    render(
      <SaveArticleButton title="Post" lang="en" url="https://example.com/a" variant="labelled" />,
    );
    expect(screen.getByRole("button", { name: "Remove from saved" }).textContent).toBe("Saved");
  });

  it("jawny adres i typ encji idą do zapisu bez zmian", () => {
    render(
      <SaveArticleButton
        title="Strona"
        lang="pl"
        entityId="pg1"
        entityType="page"
        url="https://example.com/strona"
      />,
    );
    expect(h.calls.at(-1)).toEqual({
      entityId: "pg1",
      entityType: "page",
      url: "https://example.com/strona",
      title: "Strona",
      lang: "pl",
    });
  });

  it("bez adresu bierze `window.location` PO montażu, a typ encji domyślnie to wpis", () => {
    render(<SaveArticleButton title="Wpis" lang="pl" entityId="p1" />);
    // Pierwszy render (jak SSR) idzie z pustym adresem - dopiero efekt go ustala.
    expect(h.calls[0]?.url).toBe("");
    expect(h.calls.at(-1)).toMatchObject({ url: window.location.href, entityType: "post" });
  });

  it("zmiana artykułu przy reużytym poddrzewie odświeża adres", () => {
    const { rerender } = render(
      <SaveArticleButton title="A" lang="pl" url="https://example.com/a" />,
    );
    rerender(<SaveArticleButton title="B" lang="pl" url="https://example.com/b" />);
    expect(h.calls.at(-1)).toMatchObject({ url: "https://example.com/b", title: "B" });
  });
});
