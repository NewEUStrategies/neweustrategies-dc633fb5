// Molekuła nawigacji zakładek panelu gifting - CZY CZYTNIK EKRANU WIE, GDZIE JEST.
//
// CO TEN PLIK DOWODZI.
//   1. ZAKŁADKI SĄ ZROBIONE NA PRZYCISKACH, NIE NA RADIKSIE, więc dostępność
//      nie przychodzi z biblioteki: `role="tablist"`, `role="tab"` i
//      `aria-selected` to JEDYNA informacja dla czytnika ekranu o tym, która
//      zakładka jest otwarta. Podkreślenie brandowe mówi to tylko widzącym -
//      i dokładnie ten błąd przechodzi przez tsc, recenzję i każdy snapshot.
//   2. DOKŁADNIE JEDNA zakładka jest zaznaczona naraz - `aria-selected` na
//      dwóch elementach jest gorsze niż na żadnym.
//   3. KLIK ODDAJE ID WOŁAJĄCEMU (nie indeks, nie etykietę): to id jest potem
//      częścią klucza cache w organizmach.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Tego, że kafle statystyk zostają zamontowane
// przy każdej zakładce, i że przełączenie faktycznie odpala zapytanie - to
// `src/routes/__tests__/adminGiftingRoute.test.tsx`.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GiftTabNav } from "@/components/admin/gifting/molecules/GiftTabNav";

const ZAKŁADKI = [
  { id: "settings" as const, label: "Ustawienia" },
  { id: "links" as const, label: "Linki" },
  { id: "audit" as const, label: "Audyt" },
];

function nawigacja(active: "settings" | "links" | "audit" = "settings") {
  const onSelect = vi.fn();
  render(<GiftTabNav tabs={ZAKŁADKI} active={active} onSelect={onSelect} />);
  return { onSelect };
}

describe("nawigacja zakładek gifting", () => {
  it("ogłasza listę zakładek rolą tablist, a nie samym układem", () => {
    nawigacja();

    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("DOKŁADNIE JEDNA zakładka ma aria-selected=true i jest to zakładka aktywna", () => {
    nawigacja("links");

    const wybrane = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(wybrane).toHaveLength(1);
    expect(wybrane[0].textContent).toBe("Linki");
  });

  it("klik oddaje ID zakładki, nie jej etykietę ani indeks", () => {
    const { onSelect } = nawigacja("settings");

    fireEvent.click(screen.getByRole("tab", { name: "Audyt" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("audit");
  });

  it("stan wybrany różni się także wizualnie - podkreślenie tylko na aktywnej", () => {
    nawigacja("audit");

    const audyt = screen.getByRole("tab", { name: "Audyt" });
    const linki = screen.getByRole("tab", { name: "Linki" });
    expect(audyt.className).toContain("border-brand");
    expect(linki.className).not.toContain("border-brand");
  });
});
