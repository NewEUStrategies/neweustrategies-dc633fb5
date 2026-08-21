// Molekuła wiersza katalogu taksonomii - ZNACZNIKI I TRZY AKCJE.
//
// CO TEN PLIK DOWODZI.
//   1. KOSZ JEST ODCIĘTY, GDY WOŁAJĄCY TAK POWIE, i wtedy kliknięcie NIE woła
//      niczego. To jedyna obrona wpisu systemowego i wpisu w użyciu: znacznik
//      informuje, ale nie chroni, a wiersz usunięty z katalogu zabiera etykietę
//      z archiwum.
//   2. PRZEŁĄCZNIK ODDAJE NOWĄ WARTOŚĆ, NIE ZDARZENIE - i to w OBU kierunkach
//      (włączam wyłączony, wyłączam włączony). Odwrócona wartość jest błędem,
//      którego nie widać na ekranie: przełącznik skacze, a stan bazy nie.
//   3. WPIS WYŁĄCZONY JEST PRZYGASZONY I OZNACZONY, wpis systemowy - oznaczony.
//      Oba znaczniki są niezależne, więc wiersz systemowy i wyłączony pokazuje
//      dwa.
//   4. PRZEŁĄCZNIK MA DOSTĘPNĄ NAZWĘ z nazwą wpisu - bez niej dziewięć wierszy
//      brzmi dla czytnika ekranu identycznie.
//   5. ZNAK WIODĄCY I AKCJA DODATKOWA SĄ OPCJONALNE: katalog obszarów ich nie
//      podaje, katalog specjalizacji podaje ikonę i podgląd strony publicznej.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguły odcięcia kosza (`catalogDeleteBlocked`,
// `clubTopicUsage`, `clubSpecializationUsage`) -
// `lib/clubs/__tests__/adminTaxonomyCatalog.test.ts`; tutaj dowodzimy, że wiersz
// SŁUCHA tej decyzji. (2) Mutacji przełączenia - to organizmy
// (`ClubTopicsManager.test.tsx`, `ClubSpecializationsManager.test.tsx`).
// (3) Chipu obszaru (`ClubTopicChip`) ani ikony specjalizacji - wiersz dostaje
// je jako gotową treść.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";

import { ClubCatalogRow } from "@/components/admin/clubs/molecules/ClubCatalogRow";

function wiersz(props: Partial<Parameters<typeof ClubCatalogRow>[0]> = {}) {
  // Atrapy są TYPOWANE sygnaturą, której oczekuje molekuła - dzięki temu
  // asercja na argumencie przełącznika nie przejdzie z byle wartością.
  const domknięcia = {
    onToggle: vi.fn<(isActive: boolean) => void>(),
    onEdit: vi.fn<() => void>(),
    onDelete: vi.fn<() => void>(),
  };
  const { container } = render(
    <ClubCatalogRow
      isActive
      isSystem={false}
      systemLabel="systemowy"
      disabledLabel="wyłączony"
      title={<span>Energetyka</span>}
      meta={<>energy · kluby: 2</>}
      toggleLabel="Włącz lub wyłącz obszar Energetyka"
      onToggle={domknięcia.onToggle}
      editLabel="Edytuj obszar"
      onEdit={domknięcia.onEdit}
      deleteLabel="Usuń obszar"
      deleteDisabled={false}
      onDelete={domknięcia.onDelete}
      {...props}
    />,
  );
  return { container, ...domknięcia };
}

function przełącznik(): HTMLElement {
  return screen.getByRole("switch", { name: "Włącz lub wyłącz obszar Energetyka" });
}

describe("treść wiersza", () => {
  it("pokazuje tytuł i linię metryki, bez znaczników dla wpisu włączonego", () => {
    wiersz();

    expect(screen.getByText("Energetyka")).toBeTruthy();
    expect(screen.getByText("energy · kluby: 2")).toBeTruthy();
    expect(screen.queryByText("systemowy")).toBeNull();
    expect(screen.queryByText("wyłączony")).toBeNull();
  });

  it("wpis WYŁĄCZONY jest przygaszony i oznaczony", () => {
    const { container } = wiersz({ isActive: false });

    expect(screen.getByText("wyłączony")).toBeTruthy();
    expect(container.querySelector(".opacity-70")).toBeTruthy();
    expect(przełącznik().getAttribute("aria-checked")).toBe("false");
  });

  it("wpis SYSTEMOWY I WYŁĄCZONY pokazuje DWA znaczniki naraz", () => {
    wiersz({ isActive: false, isSystem: true });

    expect(screen.getByText("systemowy")).toBeTruthy();
    expect(screen.getByText("wyłączony")).toBeTruthy();
  });

  it("wiersz BEZ znaku wiodącego i bez akcji dodatkowej nie pokazuje pustki", () => {
    const { container } = wiersz();

    expect(screen.queryByTestId("ikona")).toBeNull();
    expect(screen.queryByTestId("podglad")).toBeNull();
    expect(container.textContent).not.toContain("undefined");
  });

  it("znak wiodący i akcja dodatkowa trafiają na ekran, gdy je podano", () => {
    const leading: ReactNode = <span data-testid="ikona" />;
    const extraActions: ReactNode = <button type="button" data-testid="podglad" />;

    wiersz({ leading, extraActions });

    expect(screen.getByTestId("ikona")).toBeTruthy();
    expect(screen.getByTestId("podglad")).toBeTruthy();
  });
});

describe("trzy akcje wiersza", () => {
  it("przełącznik wpisu WYŁĄCZONEGO oddaje włączenie", () => {
    const { container, onToggle } = wiersz({ isActive: false });

    fireEvent.click(within(container).getByRole("switch"));

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("przełącznik wpisu WŁĄCZONEGO oddaje wyłączenie - wartość, nie zdarzenie", () => {
    const { container, onToggle } = wiersz();

    fireEvent.click(within(container).getByRole("switch"));

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("przełącznik zablokowany na czas zapisu nie oddaje niczego", () => {
    const { onToggle } = wiersz({ toggleDisabled: true });

    fireEvent.click(przełącznik());

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("ołówek otwiera edycję", () => {
    const { onEdit } = wiersz();

    fireEvent.click(screen.getByRole("button", { name: "Edytuj obszar" }));

    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("kosz pyta o usunięcie, gdy wpis wolno usunąć", () => {
    const { onDelete } = wiersz();

    fireEvent.click(screen.getByRole("button", { name: "Usuń obszar" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("kosz ODCIĘTY jest nieaktywny i kliknięcie nie woła niczego", () => {
    const { onDelete } = wiersz({ deleteDisabled: true });
    const kosz = screen.getByRole("button", { name: "Usuń obszar" });

    expect(kosz.hasAttribute("disabled")).toBe(true);
    fireEvent.click(kosz);

    expect(onDelete).not.toHaveBeenCalled();
  });
});
