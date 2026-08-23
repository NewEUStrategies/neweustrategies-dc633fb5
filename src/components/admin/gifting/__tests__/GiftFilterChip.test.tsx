// Atom przycisku filtra (linki i audyt) - CO ZNACZY „WYBRANY".
//
// CO TEN PLIK DOWODZI.
//   1. FILTR WYBRANY WYGLĄDA INACZEJ NIŻ NIEWYBRANY. Przed ekstrakcją ten
//      markup stał w DWÓCH miejscach trasy; jedna kopia znaczy, że „jak wygląda
//      wybrany filtr" jest jedną decyzją, której nie da się rozjechać między
//      zakładką linków i audytu.
//   2. KLIK ODDAJE DECYZJĘ WOŁAJĄCEMU - atom nie trzyma stanu filtra, bo stan
//      filtra jest jednocześnie kluczem cache i parametrem zapytania (patrz
//      organizmy). Atom, który zapamiętałby wybór u siebie, rozjechałby oba.
//   3. To jest PRZYCISK (`type="button"`), nie link i nie div: filtr nie może
//      wysłać formularza ani zmienić adresu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Kompletności zestawu filtrów i tego, że filtr
// jedzie do zapytania oraz do klucza cache - to `GiftLinksPanel.test.tsx`
// i `GiftAuditPanel.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GiftFilterChip } from "@/components/admin/gifting/atoms/GiftFilterChip";

describe("przycisk filtra gifting", () => {
  it("stan wybrany ma inną klasę niż niewybrany", () => {
    const { unmount } = render(<GiftFilterChip label="Wszystkie" active onSelect={vi.fn()} />);
    const wybrany = screen.getByRole("button", { name: "Wszystkie" }).className;
    unmount();

    render(<GiftFilterChip label="Wszystkie" active={false} onSelect={vi.fn()} />);
    const niewybrany = screen.getByRole("button", { name: "Wszystkie" }).className;

    expect(wybrany).not.toBe(niewybrany);
    expect(wybrany).toContain("bg-brand");
    expect(niewybrany).not.toContain("bg-brand");
  });

  it("klik woła domknięcie wołającego DOKŁADNIE raz", () => {
    const onSelect = vi.fn();
    render(<GiftFilterChip label="Cofnięte" active={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Cofnięte" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("jest przyciskiem typu button - nie wyśle formularza wokół tabeli", () => {
    render(<GiftFilterChip label="Aktywne" active={false} onSelect={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Aktywne" }).getAttribute("type")).toBe("button");
  });
});
