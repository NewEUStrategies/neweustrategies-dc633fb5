// Molekuła trzech stanów listy katalogu - CZTERY WIDOKI I ICH KOLEJNOŚĆ.
//
// CO TEN PLIK DOWODZI.
//   1. WCZYTYWANIE, AWARIA I PUSTKA MAJĄ TRZY RÓŻNE WIDOKI, a lista pojawia się
//      dopiero jako czwarty. Każdy z tych stanów znaczy dla administratora coś
//      innego: „jeszcze nie wiem” kontra „zapytanie padło” kontra „katalog jest
//      pusty". Zlanie ich w jeden komunikat kończy się drugim wpisem o tej samej
//      nazwie (bo pierwszy „nie istniał”).
//   2. KOLEJNOŚĆ WARUNKÓW JEST REGUŁĄ: wczytywanie bije awarię, awaria bije
//      pustkę. Ponowna próba po nieudanym zapytaniu pokazuje POSTĘP, a nie stary
//      błąd; nieudane zapytanie pokazuje BŁĄD, a nie „brak wpisów”, bo brak
//      wpisów byłby nieprawdą o stanie bazy.
//   3. AWARIA NIESIE TREŚĆ Z BAZY - to jedyna diagnostyka, jaką administrator
//      dostaje bez zaglądania do logów.
//   4. W ŻADNYM ze stanów zastępczych nie renderuje się ani jeden wiersz listy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Tego, skąd biorą się flagi - to zapytania
// panelu (`useAdminClubTopics`, `useAdminClubSpecializations`) mockowane
// w testach organizmów. (2) Wyglądu wiersza - `ClubCatalogRow.test.tsx`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { ClubCatalogListState } from "@/components/admin/clubs/molecules/ClubCatalogListState";

function stan(props: Partial<Parameters<typeof ClubCatalogListState>[0]> = {}) {
  return render(
    <ClubCatalogListState
      isLoading={false}
      loadingLabel="Wczytywanie obszarów..."
      errorMessage={null}
      isEmpty={false}
      emptyLabel="Nie ma jeszcze żadnych obszarów."
      {...props}
    >
      <ul>
        <li>pierwszy wpis</li>
      </ul>
    </ClubCatalogListState>,
  );
}

describe("cztery widoki listy katalogu", () => {
  it("zapytanie W LOCIE pokazuje postęp i NIE rysuje wierszy", () => {
    stan({ isLoading: true });

    expect(screen.getByText("Wczytywanie obszarów...")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("AWARIA pokazuje treść z bazy, a nie komunikat pustki", () => {
    stan({ errorMessage: "permission denied for function admin_club_topics_list" });

    expect(screen.getByText("permission denied for function admin_club_topics_list")).toBeTruthy();
    expect(screen.queryByText("Nie ma jeszcze żadnych obszarów.")).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("PUSTKA mówi to wprost i nie rysuje ani jednego wiersza", () => {
    stan({ isEmpty: true });

    expect(screen.getByText("Nie ma jeszcze żadnych obszarów.")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("dane PEŁNE oddają listę wołającego bez żadnego komunikatu", () => {
    stan();

    expect(screen.getByText("pierwszy wpis")).toBeTruthy();
    expect(screen.queryByText("Wczytywanie obszarów...")).toBeNull();
    expect(screen.queryByText("Nie ma jeszcze żadnych obszarów.")).toBeNull();
  });
});

describe("kolejność warunków", () => {
  it("wczytywanie BIJE awarię - ponowna próba pokazuje postęp, nie stary błąd", () => {
    stan({ isLoading: true, errorMessage: "stary błąd", isEmpty: true });

    expect(screen.getByText("Wczytywanie obszarów...")).toBeTruthy();
    expect(screen.queryByText("stary błąd")).toBeNull();
  });

  it("awaria BIJE pustkę - „brak wpisów” po błędzie byłby nieprawdą", () => {
    stan({ errorMessage: "statement timeout", isEmpty: true });

    expect(screen.getByText("statement timeout")).toBeTruthy();
    expect(screen.queryByText("Nie ma jeszcze żadnych obszarów.")).toBeNull();
  });
});
